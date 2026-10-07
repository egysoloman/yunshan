/**
 * Native host for the authoritative simulation. The Unity client starts this
 * process and exchanges one JSON object per line on stdin/stdout. The rules,
 * saves and world recipe are the same TypeScript modules the web game runs;
 * the client only renders frames and forwards player input and commands.
 *
 * Request:  {"id":1,"op":"open","save":null}
 * Response: {"id":1,"ok":true,"result":{...}}  or  {"id":1,"ok":false,"error":"..."}
 */
import { createInterface } from 'node:readline';
import { Simulation } from '../simulation';
import { createCityLifeProductCity, PRODUCT_CITY_LAYOUT } from '../product-city';
import { savedWorldFingerprint, selectSavedWorld } from '../persistence/world-layout';
import { isRoadOpen, releaseRoadExitPermit, roadMovementAllowed } from '../roads';
import { activeAircraft, setAircraftControls } from '../aviation';
import { JourneyNavigation } from '../journey';
import { marketDisplayUnits } from '../site-fixtures';
import { shopLifecycleAllowsOperation } from '../simulation/shop_lifecycle';
import { contextModel, type ContextView } from './context-model';
import { panesModel } from './panes-model';
import type { AviationControls, Command, SimState, Vec3, ViewMode, WorldDefinition } from '../types';

export const HOST_PROTOCOL = 1;

export interface HostRequest { id?: number; op: string; [key: string]: unknown }
export interface HostResponse { id?: number; ok: boolean; result?: unknown; error?: string }

export interface HostFrameCitizen { id: string; name: string; role: string; state: string; position: Vec3; next: Vec3 | null; age: number; alive: boolean; mood: number; stress: number; seated: boolean }
export interface HostFrame {
  tick: number; day: number; hour: number; paused: boolean; speed: number; weather: string; visibility: number; energy: number; treasury: number; support: number;
  player: { position: Vec3; role: string; identities: string[]; money: number; reputation: number; needs: SimState['player']['needs']; inventory: Record<string, number>; homeId: string | null; vehicleId: string | null; education: number; driving: boolean; alive: boolean };
  aircraft: { id: string; kind: string; position: Vec3; yaw: number; pitch: number; status: string; active: boolean }[];
  citizens: HostFrameCitizen[];
  /** [id, kind, x, y, z, edgeId, progress, direction, state] */
  vehicles: (string | number)[][];
  signals: Record<string, number>;
  events: { id: number; tick: number; type: string; text: string }[];
  lastEventId: number;
  navigation: { destination: string | null; points: Vec3[]; unavailable: string | null } | null;
  /** Food units displayed on each open market's counters (web MarketGoodsPool rule). */
  marketUnits: Record<string, number>;
  /** Network edges currently closed (roads.ts isRoadOpen), for barriers and the map. */
  closedEdges: string[];
  /** Placed voxel positions, omitted (null) when unchanged since `voxelKey`. */
  voxels: number[][] | null; voxelKey: string;
  /** Set when the requested walking position crossed a closed road. */
  rejected?: string | null;
  stepMs: number; ticks: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const point = (p: Vec3): Vec3 => ({ x: round(p.x), y: round(p.y), z: round(p.z) });
const finiteVec = (v: unknown): v is Vec3 => !!v && typeof v === 'object' && ['x', 'y', 'z'].every(k => Number.isFinite((v as Record<string, unknown>)[k]));
const MODES: ViewMode[] = ['walk', 'drone', 'jet'];

export class SimHost {
  private sim: Simulation | null = null;
  private world: WorldDefinition | null = null;
  private navigation: JourneyNavigation | null = null;
  private layout = '';
  private marketIds: Set<string> | null = null;

  async handle(request: HostRequest): Promise<HostResponse> {
    const id = request.id;
    try { return { id, ok: true, result: await this.dispatch(request) }; }
    catch (error) { return { id, ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }

  private requireSim(): Simulation { if (!this.sim) throw new Error('模拟尚未打开：请先发送 open。'); return this.sim; }

  private async dispatch(request: HostRequest): Promise<unknown> {
    switch (request.op) {
      case 'hello': return { protocol: HOST_PROTOCOL, node: process.version };
      case 'open': return this.open(typeof request.save === 'string' && request.save ? request.save : null);
      case 'step': return this.step(request);
      case 'frame': return this.frame(request, 0, 0);
      case 'command': {
        const sim = this.requireSim(), command = request.command as Command;
        if (!command || typeof command !== 'object' || typeof command.type !== 'string') throw new Error('命令格式无效。');
        const result = sim.command(command);
        return { result, frame: this.frame(request, 0, 0) };
      }
      case 'context': return contextModel(this.requireSim(), this.world!, request.view as ContextView);
      case 'panes': return panesModel(this.requireSim(), this.world!, request.view as ContextView);
      case 'save': return { save: this.requireSim().exportSave() };
      case 'load': {
        const save = request.save;
        if (typeof save !== 'string' || !save) throw new Error('存档为空。');
        const selected = selectSavedWorld(save);
        if (savedWorldFingerprint(selected.world) !== savedWorldFingerprint(this.world!)) return { result: { ok: false, message: '存档属于另一座城市布局，需要以该存档重新打开。' }, reopen: true };
        const result = this.requireSim().importSave(save);
        return { result, reopen: false };
      }
      default: throw new Error(`未知操作：${request.op}`);
    }
  }

  private async open(save: string | null) {
    const selection = selectSavedWorld(save, PRODUCT_CITY_LAYOUT);
    const world = selection.world, sim = await createCityLifeProductCity(world);
    if (save) { const result = sim.importSave(save); if (!result.ok) throw new Error(result.message); }
    this.sim = sim; this.world = world; this.layout = selection.layout; this.navigation = new JourneyNavigation(world);
    this.marketIds = new Set(world.buildings.filter(b => b.kind === 'market').map(b => b.id));
    return { layout: this.layout, seed: world.seed, fingerprint: savedWorldFingerprint(world), buildings: world.buildings.length, nodes: world.nodes.length, edges: world.edges.length, citizens: sim.state.citizens.length, vehicles: sim.state.vehicles.length };
  }

  private step(request: HostRequest) {
    const sim = this.requireSim(), state = sim.state;
    const seconds = Number(request.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 2) throw new Error('步长须为 0 至 2 秒。');
    const mode = MODES.includes(request.mode as ViewMode) ? request.mode as ViewMode : 'walk';
    // Walking input is the player's body, exactly as the web App writes it each frame.
    // Road closures stay authoritative: a walk that crosses a closed carriageway
    // since the previous step is refused and the client is returned to its body.
    let rejected: string | null = null;
    if (finiteVec(request.player) && mode === 'walk' && !state.player.vehicleId && !activeAircraft(state)) {
      const to = { x: request.player.x, y: request.player.y, z: request.player.z };
      if (roadMovementAllowed(this.world!, state, 'player', state.player.position, to)) {
        state.player.position = to;
        releaseRoadExitPermit(this.world!, state, 'player', state.player.position);
      } else rejected = '道路已关闭；请等待通行，已在封闭路段内的行人须沿许可方向退出。';
    }
    const aviation = request.aviation as AviationControls | undefined;
    if (aviation && activeAircraft(state)) setAircraftControls(state, aviation);
    sim.setFocus(finiteVec(request.focus) ? request.focus : state.player.position, mode);
    const drive = sim as Simulation & { isDriving?: () => boolean; driveInput?: (throttle: number, turn: number, brake: boolean) => void };
    const driving = request.driving as { throttle?: number; turn?: number; brake?: boolean } | undefined;
    if (drive.isDriving?.()) drive.driveInput?.(Number(driving?.throttle ?? 0), Number(driving?.turn ?? 0), driving?.brake ?? true);
    const before = state.tick, started = performance.now();
    sim.step(seconds);
    return { ...this.frame(request, performance.now() - started, sim.state.tick - before), rejected };
  }

  frame(request: HostRequest, stepMs: number, ticks: number): HostFrame {
    const sim = this.requireSim(), state = sim.state, world = this.world!;
    const radius = Number.isFinite(request.radius) ? Math.max(20, Math.min(2000, Number(request.radius))) : 260;
    const since = Number.isFinite(request.sinceEventId) ? Number(request.sinceEventId) : 0;
    const focus = finiteVec(request.focus) ? request.focus : state.player.position;
    const profiles = state.extension?.actorProfiles ?? {};
    const buried = new Set((state.family?.ceremonies ?? []).filter(c => c.kind === 'funeral' && c.completedAt !== null).map(c => c.subjectId));
    const citizens: HostFrameCitizen[] = [];
    for (const c of state.citizens) {
      const profile = profiles[c.id], dead = profile?.alive === false || c.state === 'dead';
      if (buried.has(c.id) || !dead && c.tier === 'statistical') continue;
      if (Math.hypot(c.position.x - focus.x, c.position.y - focus.y, c.position.z - focus.z) > radius) continue;
      const next = c.route?.[c.routeIndex ?? 0];
      citizens.push({ id: c.id, name: c.name, role: c.role, state: c.state, position: point(c.position), next: next ? point(next) : null, age: profile?.age ?? 30, alive: !dead, mood: profile?.mood ?? 60, stress: profile?.stress ?? 20, seated: c.state === 'riding' });
    }
    const stations = new Set(world.nodes.filter(n => n.station).map(n => n.id)), signals: Record<string, number> = {};
    for (const [nodeId, phase] of Object.entries(state.signals ?? {})) if (stations.has(nodeId)) signals[nodeId] = phase;
    const plan = this.navigation!.read(state);
    const navPoints = plan.walking?.points ?? [];
    const lastEventId = state.events.at(-1)?.id ?? 0;
    const marketUnits: Record<string, number> = {};
    for (const shop of state.shops) {
      if (!this.marketIds!.has(shop.buildingId) || !shop.open || !shopLifecycleAllowsOperation(state, shop.id)) continue;
      const units = marketDisplayUnits(shop.inventory); if (units > 0) marketUnits[shop.buildingId] = units;
    }
    const voxels = (state as SimState & { voxels?: { position: Vec3 }[] }).voxels ?? [], lastVoxel = voxels.at(-1)?.position;
    const voxelKey = `${voxels.length}:${lastVoxel?.x}:${lastVoxel?.y}:${lastVoxel?.z}`;
    return {
      tick: state.tick, day: state.day, hour: round(state.hour), paused: state.paused, speed: state.speed, weather: state.weather, visibility: state.visibility, energy: round(state.energy), treasury: round(state.treasury), support: round(state.support),
      player: { position: point(state.player.position), role: state.player.role, identities: state.player.identities ?? [state.player.role], money: round(state.player.money), reputation: state.player.reputation, needs: state.player.needs, inventory: state.player.inventory, homeId: state.player.homeId, vehicleId: state.player.vehicleId, education: state.player.education, driving: !!(sim as Simulation & { isDriving?: () => boolean }).isDriving?.(), alive: profiles.player?.alive !== false },
      aircraft: (state.aviation?.aircraft ?? []).map(a => ({ id: a.id, kind: a.kind, position: point(a.position), yaw: round(a.yaw), pitch: round(a.pitch), status: a.status, active: state.aviation?.activeAircraftId === a.id })),
      citizens,
      vehicles: state.vehicles.map(v => [v.id, v.kind, round(v.position.x), round(v.position.y), round(v.position.z), v.edgeId, round(v.progress), v.direction, v.state]),
      signals,
      events: state.events.filter(e => e.id > since).map(e => ({ id: e.id, tick: e.tick, type: e.type, text: e.text })),
      lastEventId,
      navigation: plan.destination || plan.unavailable ? { destination: plan.destination?.name ?? null, points: navPoints.map(point), unavailable: plan.unavailable } : null,
      marketUnits,
      closedEdges: state.roadNetwork ? world.edges.filter(edge => !isRoadOpen(state, edge.id)).map(edge => edge.id) : [],
      voxels: request.voxelKey === voxelKey ? null : voxels.slice(0, 4096).map(v => [v.position.x, v.position.y, v.position.z]), voxelKey,
      stepMs: round(stepMs), ticks,
    };
  }
}

/** Line protocol main loop. Requests are processed strictly in order. */
export function runStdioHost(): void {
  const host = new SimHost();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  input.on('line', line => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let request: HostRequest;
      try { request = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ ok: false, error: '请求不是合法 JSON。' }) + '\n'); return; }
      if (request.op === 'quit') { process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: null }) + '\n'); process.exit(0); }
      const response = await host.handle(request);
      process.stdout.write(JSON.stringify(response) + '\n');
    });
  });
  input.on('close', () => { void queue.then(() => process.exit(0)); });
}

if (process.argv[1] && /sim-host\.(ts|mjs|js)$/.test(process.argv[1])) runStdioHost();
