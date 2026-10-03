import { Simulation } from '../../src/simulation';
import { createWorld, CURRENT_CITY_LAYOUT, CITY_LAYOUT_VERSIONS, getWalkHeight, type CityLayoutVersion } from '../../src/world';
import { selectSavedWorld, savedWorldFingerprint } from '../../src/persistence/world-layout';
import { getBuildingFloorPlan, floorPlanSupport, getBuildingBody } from '../../src/architecture-floor-plan';
import { getFloorDimensions, canAccessFloor } from '../../src/access';
import { releaseRoadExitPermit } from '../../src/roads';
import { setAircraftControls } from '../../src/aviation';
import { planWalkingJourney, planTransitJourney, publicDepartures } from '../../src/journey';
import type { AviationControls, Command, CommandResult, SimState, Vec3, WorldDefinition } from '../../src/types';
import { HeadlessWalker } from './headless-walker';

export const CORE_COMMIT = '6785ca7dcca09e8e97afd610cfd52176c7a1cfb1';
export const BRIDGE_VERSION = 1;
export const FIXED_STEP_SECONDS = 1 / 60;
export const COORDINATES = Object.freeze({ unit: 'metre', x: 'east', y: 'height', z: 'south', voxelSize: 0.2, floorIndex: 'ground=0; basements<0', walkSpeed: 4.8, sprintSpeed: 10 });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export interface MovementInput { x: number; z: number; sprint?: boolean }
export interface SessionOptions { seed?: number; layout?: CityLayoutVersion; save?: string }
export interface QueuedCommand { requestId: string; command: Command }
export interface BridgeCommandResult { requestId: string; command: Command; result: CommandResult; tick: number; clock: number }
interface BridgeSave { format: 'yunshan-mz-save'; version: 1; coreCommit: string; coreSave: string; realAccumulator: number; commands: QueuedCommand[]; results: BridgeCommandResult[]; nextRequestId: number }

/** The presentation gets copies. Only this session owns Simulation, its RNG,
 * clock and legal walking body; MZ event/tile coordinates never write state. */
export class CitySession {
  #simulation: Simulation;
  #world: WorldDefinition & { layoutVersion: CityLayoutVersion };
  #walker: HeadlessWalker;
  #realAccumulator = 0;
  #commands: QueuedCommand[] = [];
  #results: BridgeCommandResult[] = [];
  #nextRequestId = 1;

  constructor(options: SessionOptions = {}) {
    if (options.save !== undefined) {
      const parsed = this.#parseSave(options.save);
      this.#world = parsed.world;
      this.#simulation = parsed.simulation;
      if (parsed.bridge) this.#installBridgeState(parsed.bridge);
    } else {
      const seed = options.seed ?? 20261001, layout = options.layout ?? CURRENT_CITY_LAYOUT;
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !CITY_LAYOUT_VERSIONS.includes(layout)) throw new Error('Invalid trusted city recipe.');
      this.#world = createWorld(seed, layout);
      this.#simulation = new Simulation(this.#world);
    }
    this.#walker = this.#newWalker();
  }

  #newWalker(): HeadlessWalker { return new HeadlessWalker(this.#world, () => this.#simulation.state); }
  #clock(): number { return this.#simulation.state.extension?.lastUpdate ?? this.#simulation.state.day * 1440 + this.#simulation.state.hour * 60; }
  get metadata() { return { bridgeVersion: BRIDGE_VERSION, coreCommit: CORE_COMMIT, layout: this.#world.layoutVersion, worldSeed: this.#world.seed, worldFingerprint: savedWorldFingerprint(this.#world), saveFormat: 'yunshan-save', saveVersion: 1, fixedStepSeconds: FIXED_STEP_SECONDS, simulationTickSeconds: .25, coordinates: clone(COORDINATES) }; }
  worldSnapshot() { return clone(this.#world); }
  snapshot(): SimState { return clone(this.#simulation.state); }

  /** Queue order is authoritative. Zero-second advance flushes without ticking. */
  queueCommand(command: Command, requestId?: string): string {
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') throw new Error('Expected a core command.');
    if (this.#commands.length >= 256) throw new Error('Command queue is full.');
    const id = requestId ?? `mz-${this.#nextRequestId}`;
    if (typeof id !== 'string' || !id.length || id.length > 128 || this.#commands.some(item => item.requestId === id) || this.#results.some(item => item.requestId === id)) throw new Error('Request ID must be unique and nonempty.');
    const copy = clone(command);
    this.#commands.push({ requestId: id, command: copy });
    this.#nextRequestId++;
    return id;
  }

  #flushCommands() {
    while (this.#commands.length) {
      const queued = this.#commands.shift()!;
      const result = this.#simulation.command(queued.command);
      this.#walker.syncFromCore();
      this.#results.push({ ...queued, result, tick: this.#simulation.state.tick, clock: this.#clock() });
      if (this.#results.length > 256) this.#results.shift();
    }
  }
  drainResults(): BridgeCommandResult[] { const result = clone(this.#results); this.#results = []; return result; }

  advance(realSeconds: number, input: MovementInput = { x: 0, z: 0 }) {
    if (!finite(realSeconds) || realSeconds < 0 || realSeconds > 1 || !input || !finite(input.x) || !finite(input.z) || Math.abs(input.x) > 1 || Math.abs(input.z) > 1 || input.sprint !== undefined && typeof input.sprint !== 'boolean') throw new Error('Expected 0..1 real seconds and finite movement axes -1..1.');
    this.#flushCommands();
    this.#realAccumulator += realSeconds;
    let frames = 0;
    while (this.#realAccumulator + 1e-10 >= FIXED_STEP_SECONDS) {
      this.#realAccumulator = Math.max(0, this.#realAccumulator - FIXED_STEP_SECONDS);
      const state = this.#simulation.state;
      if (this.#canWalk()) {
        this.#walker.move(input.x, input.z, input.sprint ?? false, FIXED_STEP_SECONDS);
        this.#commitWalkingBody();
      }
      // This updates simulation frequency tiers using the already validated body.
      // A mode of drone/jet is only possible after a real core boarding command.
      const aircraft = state.aviation?.aircraft.find(a => a.id === state.aviation?.activeAircraftId);
      this.#simulation.setFocus(state.player.position, aircraft?.kind ?? 'walk');
      this.#simulation.step(FIXED_STEP_SECONDS);
      if (!this.#canWalk()) this.#walker.syncFromCore();
      frames++;
    }
    return { frames, tick: this.#simulation.state.tick, clock: this.#clock(), player: clone(this.#simulation.state.player), location: this.playerLocation(), blocked: this.#walker.consumeBlockedAccess() };
  }

  #canWalk(): boolean { const s = this.#simulation.state; return !s.player.vehicleId && !s.aviation?.activeAircraftId && s.extension?.actorProfiles.player?.alive !== false; }
  #commitWalkingBody() {
    this.#simulation.state.player.position = this.#walker.position;
    releaseRoadExitPermit(this.#world, this.#simulation.state, 'player', this.#simulation.state.player.position);
  }
  useDoor(buildingId: string): CommandResult {
    const building = this.#world.buildings.find(b => b.id === buildingId);
    const body = this.#simulation.state.player.position;
    // The 3D app selects a nearby entrance before calling its door motor. A
    // map event ID cannot replace that proximity gate or leave an upper floor.
    if (!this.#canWalk() || !building || Math.hypot(body.x - building.door.x, body.y - building.door.y, body.z - building.door.z) > 6 || !this.#walker.useDoor(building)) return { ok: false, message: this.#walker.consumeBlockedAccess() ?? '请走到实际入口附近再使用门。' };
    this.#commitWalkingBody();
    return { ok: true, message: this.#walker.inside ? `进入${building.name}。` : `走出${building.name}。` };
  }
  useStairs(): CommandResult {
    if (!this.#canWalk() || !this.#walker.useStairs()) return { ok: false, message: this.#walker.consumeBlockedAccess() ?? '请走到可访问的实际楼梯旁。' };
    this.#commitWalkingBody();
    return { ok: true, message: `抵达${this.#walker.floor < 0 ? `地下${-this.#walker.floor}层` : `${this.#walker.floor + 1}层`}。` };
  }
  driveInput(throttle: number, turn: number, brake: boolean): CommandResult {
    if (!finite(throttle) || !finite(turn) || Math.abs(throttle) > 1 || Math.abs(turn) > 1 || typeof brake !== 'boolean' || !this.#simulation.isDriving()) return { ok: false, message: '请先按身份规则登车驾驶。' };
    this.#simulation.driveInput(throttle, turn, brake);
    return { ok: true, message: '驾驶输入已接收。' };
  }
  aircraftInput(input: AviationControls): CommandResult {
    if (!input || !this.#simulation.state.aviation?.activeAircraftId || !['forward', 'strafe', 'climb', 'yaw', 'pitch', 'speed'].every(key => finite(input[key as keyof AviationControls])) || typeof input.boost !== 'boolean') return { ok: false, message: '请先租用或按身份规则登上真实航空载具。' };
    setAircraftControls(this.#simulation.state, clone(input));
    return { ok: true, message: '航空载具输入已接收。' };
  }

  #locate(position: Vec3) {
    for (const building of this.#world.buildings) {
      if (Math.hypot(position.x - building.position.x, position.z - building.position.z) > Math.hypot(building.width, building.depth) / 2 + 1) continue;
      const nominal = Math.round((position.y - building.position.y - .6) / (building.height / building.floors));
      for (const floor of [nominal, nominal - 1, nominal + 1]) {
        if (floor < -(building.basements ?? 0) || floor >= building.floors) continue;
        if (getBuildingBody(building)) {
          const support = floorPlanSupport(building, floor, position, 0);
          if (support && Math.abs(support.y - position.y) < .26) return { buildingId: building.id, floor: support.floor, space: support.kind };
        } else {
          const size = getFloorDimensions(building, floor);
          if (Math.abs(position.x - building.position.x) < size.width / 2 && Math.abs(position.z - building.position.z) < size.depth / 2 && Math.abs(position.y - building.position.y - .6 - floor * building.height / building.floors) < .26) return { buildingId: building.id, floor, space: 'room' };
        }
      }
    }
    return { buildingId: null, floor: null, space: 'outdoors' };
  }
  playerLocation() { return { ...this.#locate(this.#simulation.state.player.position), position: clone(this.#simulation.state.player.position) }; }
  actorsSnapshot() {
    const state = this.#simulation.state;
    return state.citizens.map(c => ({ id: c.id, name: c.name, districtId: c.districtId, homeId: c.homeId, workId: c.workId, role: c.role, socialIdentities: clone(c.socialIdentities ?? []), activity: c.state, destinationId: c.destinationId, position: clone(c.position), location: this.#locate(c.position), alive: state.extension?.actorProfiles[c.id]?.alive ?? true, tier: c.tier, needs: clone(c.needs), money: c.money }));
  }
  floorPlan(buildingId: string, floor: number) { const b = this.#world.buildings.find(b => b.id === buildingId); const plan = b && Number.isInteger(floor) ? getBuildingFloorPlan(b, floor) : null; return plan ? clone(plan) : null; }
  canAccessFloor(buildingId: string, floor: number): boolean { const b = this.#world.buildings.find(b => b.id === buildingId); return !!b && canAccessFloor(b, floor, this.#simulation.state.player); }
  atFunctionPoint(buildingId: string, purpose?: 'work' | 'service' | 'sale'): boolean { const b = this.#world.buildings.find(b => b.id === buildingId); return !!b && this.#simulation.isAtBuildingFunctionPoint(b, this.#simulation.state.player.position, purpose); }
  walkHeight(x: number, z: number, referenceHeight?: number): number { if (!finite(x) || !finite(z) || referenceHeight !== undefined && !finite(referenceHeight)) throw new Error('Invalid coordinate.'); return getWalkHeight(this.#world, x, z, referenceHeight); }
  navigation(targetId: string, preference: 'walk' | 'transit' = 'walk') { return clone(preference === 'transit' ? planTransitJourney(this.#world, this.#simulation.state, this.#simulation.state.player.position, targetId) : planWalkingJourney(this.#world, this.#simulation.state.player.position, targetId, this.#simulation.state)); }
  departures() { return clone(publicDepartures(this.#world, this.#simulation.state)); }
  eventsSince(eventId = 0) { return clone(this.#simulation.state.events.filter(e => e.id > eventId)); }

  exportCoreSave(): string { return this.#simulation.exportSave(); }
  exportSave(): string { return JSON.stringify({ format: 'yunshan-mz-save', version: 1, coreCommit: CORE_COMMIT, coreSave: this.exportCoreSave(), realAccumulator: this.#realAccumulator, commands: this.#commands, results: this.#results, nextRequestId: this.#nextRequestId } satisfies BridgeSave); }

  #parseSave(save: string) {
    if (typeof save !== 'string' || save.length > 10_000_000) throw new Error('Invalid save size.');
    const value = JSON.parse(save);
    const bridge: BridgeSave | null = value?.format === 'yunshan-mz-save' ? value : null;
    if (bridge && (bridge.version !== BRIDGE_VERSION || bridge.coreCommit !== CORE_COMMIT || !finite(bridge.realAccumulator) || bridge.realAccumulator < 0 || bridge.realAccumulator >= FIXED_STEP_SECONDS || !Array.isArray(bridge.commands) || bridge.commands.length > 256 || !Array.isArray(bridge.results) || bridge.results.length > 256 || !Number.isSafeInteger(bridge.nextRequestId) || bridge.nextRequestId < 1)) throw new Error('Incompatible bridge save.');
    if (bridge) {
      const ids = new Set<string>();
      for (const item of [...bridge.commands, ...bridge.results]) {
        if (!item || typeof item.requestId !== 'string' || !item.requestId.length || item.requestId.length > 128 || ids.has(item.requestId) || !item.command || typeof item.command.type !== 'string') throw new Error('Invalid saved command queue.');
        ids.add(item.requestId);
      }
      for (const item of bridge.results) if (!item.result || typeof item.result.ok !== 'boolean' || typeof item.result.message !== 'string' || !Number.isSafeInteger(item.tick) || item.tick < 0 || !finite(item.clock)) throw new Error('Invalid saved command result.');
    }
    const coreSave = bridge ? bridge.coreSave : save;
    const { world } = selectSavedWorld(coreSave);
    const simulation = new Simulation(world);
    const result = simulation.importSave(coreSave);
    if (!result.ok) throw new Error(result.message);
    return { world, simulation, bridge };
  }
  #installBridgeState(saved: BridgeSave) { this.#realAccumulator = saved.realAccumulator; this.#commands = clone(saved.commands); this.#results = clone(saved.results); this.#nextRequestId = saved.nextRequestId; }
  importSave(save: string): CommandResult {
    try {
      const parsed = this.#parseSave(save);
      this.#world = parsed.world; this.#simulation = parsed.simulation;
      this.#realAccumulator = 0; this.#commands = []; this.#results = []; this.#nextRequestId = 1;
      if (parsed.bridge) this.#installBridgeState(parsed.bridge);
      this.#walker = this.#newWalker();
      return { ok: true, message: '已恢复同一城市的完整模拟、随机数、队列与时钟。' };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '无法恢复存档。' }; }
  }
}

export function createSession(options: SessionOptions = {}): CitySession { return new CitySession(options); }
