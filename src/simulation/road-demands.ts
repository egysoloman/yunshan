import type { Citizen, SimState, Vec3, WorldDefinition } from '../types';
import { roadClosureById, roadMovementAllowed, roadRevision, type RoadClosure, type RoadNetworkState } from '../roads';

const EPS = 1e-7, MAX_DEMANDS = 128, MAX_ROUTE_POINTS = 1024, MAX_SEGMENT = 12000, MAX_BYTES = 192 * 1024;
/** A snapshot of an existing ordinary journey, taken before closure replanning.
 * The source event attests that replanning subsequently found no legal route.
 * It does not assert that every closed road affects every nearby resident. */
export interface RoadBlockWitness {
  actorId: string; closureId: string; edgeId: string; goalId: string; purpose: string;
  firstBlockedAt: number; observedTick: number; closedRevision: number;
  position: Vec3; from: Vec3; to: Vec3; routeIndex: number; blockedSegmentIndex: number;
}
export interface RoadRepairDemand extends RoadBlockWitness {
  id: string; repairId: string | null; resolvedAt: number | null;
}
export interface RoadDemandsState { version: 1; activatedAt: number; nextId: number; demands: RoadRepairDemand[] }
export interface RoadBlockEvent { type: string; roadBlock?: RoadBlockWitness }
export interface RoadDemandsHost {
  state: SimState; readonly worldDefinition: WorldDefinition;
  onEvent(type: 'road-route-blocked', handler: (event: RoadBlockEvent) => void): void;
  onPhase(phase: 'feedback', handler: (state: SimState, minutes: number) => void): void;
  registerSaveValidator(validator: (state: SimState) => void): void;
}
export interface RoadDemandsAccounting {
  isCanonicalRoadBlock(event: object): boolean;
  activate(): void;
  /** Creates/joins an unfunded request only; original politics authorizes cash. */
  requestRepair(demandId: string): string | null;
}
type State = SimState & { roadDemands?: RoadDemandsState };
const body = (s: SimState) => (s as State).roadDemands;
const clock = (s: SimState) => s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60;
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const vector = (p: unknown): p is Vec3 => !!p && typeof p === 'object' && !Array.isArray(p)
  && Object.keys(p).length === 3 && ['x','y','z'].every(k => finite(Reflect.get(p,k)) && Math.abs(Reflect.get(p,k)) <= 1e5);
const routeTargetCaches = new WeakMap<WorldDefinition, Set<string>>();
const pointKey = (p: Vec3) => JSON.stringify([p.x,p.y,p.z]);
/** Necessary immutable source, not a reconstruction of the whole old route.
 * Network bends and slopes keep their original exact coordinates. Portal and
 * explicitly declared use points are sources too; arbitrary indoor BFS grid
 * points are outside this ordinary road/portal demand contract. */
function immutableRouteTarget(world: WorldDefinition, point: Vec3): boolean {
  if (!vector(point)) return false;
  let points = routeTargetCaches.get(world);
  if (!points) {
    points = new Set<string>();
    const add = (p: unknown): void => { if (vector(p)) points!.add(pointKey(p)); };
    for (const node of world.nodes) add(node.position);
    for (const edge of world.edges) if (['road','bridge'].includes(edge.mode)) for (const p of edge.points) add(p);
    for (const b of world.buildings) { add(b.door); for (const p of b.functionPoints ?? []) add(p.position); }
    routeTargetCaches.set(world,points);
  }
  return points.has(pointKey(point));
}
const clone = (w: RoadBlockWitness): RoadBlockWitness => ({ ...w, position: copy(w.position), from: copy(w.from), to: copy(w.to) });
const bytes = (s: SimState) => new TextEncoder().encode(JSON.stringify(body(s) ?? {})).length;

/** Reconstruct only recorded closure/occupancy authority at the source time.
 * Historical release timing is not inferred; the retained snapshot gives a
 * necessary geometry test, while the live event must pass the actual permit. */
function historicalRoads(s: SimState, at: number): RoadNetworkState | undefined {
  const network = s.roadNetwork; if (!network) return undefined;
  const closures = network.closures.filter(c => c.occurredAt <= at).map(c => ({ ...c, reopenedAt: c.reopenedAt !== null && c.reopenedAt <= at ? c.reopenedAt : null }));
  const permits: RoadNetworkState['permits'] = {};
  for (const c of closures) if (c.reopenedAt === null) for (const row of c.occupants) {
    const { routeIndex: _i, nextPoint: _p, vehicleProgress: _v, ...permit } = row;
    permits[row.actorId] = permit;
  }
  return { ...network, closures, permits };
}
function causedBy(world: WorldDefinition, network: RoadNetworkState | undefined, c: RoadClosure, actorId: string, from: Vec3, to: Vec3): boolean {
  if (!network || !vector(from) || !vector(to) || distance(from,to) > MAX_SEGMENT || distance(from,to) <= EPS) return false;
  if (roadMovementAllowed(world,{ roadNetwork: network },actorId,from,to)) return false;
  const opened = { ...network, closures: network.closures.map(row => row.id === c.id ? { ...row, reopenedAt: c.occurredAt } : row) };
  return roadMovementAllowed(world,{ roadNetwork: opened },actorId,from,to);
}

/** Pure capture; must run before core overwrites the original remaining route.
 * No actor, route, clock, identity, need or account is changed here. */
export function captureBlockedRoadIntent(world: WorldDefinition, s: SimState, actor: Citizen, closureId: string, purpose = 'travel'): RoadBlockWitness | null {
  const c = roadClosureById(s,closureId), now = clock(s), route = actor.route, index = actor.routeIndex;
  const profile = s.extension?.actorProfiles[actor.id];
  if (!c || c.reopenedAt !== null || c.occurredAt !== now || c.closedRevision !== roadRevision(s)
    || s.citizens.find(row => row.id === actor.id) !== actor || !profile?.alive || profile.age < 18 || actor.state !== 'moving'
    || !actor.destinationId || !world.buildings.some(b => b.id === actor.destinationId) || typeof purpose !== 'string' || !purpose.length || purpose.length > 40
    || !Array.isArray(route) || route.length > MAX_ROUTE_POINTS || !Number.isInteger(index) || index! < 0 || index! >= route.length || !vector(actor.position)) return null;
  let from = actor.position;
  for (let i = index!; i < route.length; i++) {
    const to = route[i]; if (!vector(to) || distance(from,to) > MAX_SEGMENT) return null;
    if (immutableRouteTarget(world,to) && causedBy(world,s.roadNetwork,c,actor.id,from,to)) return {
      actorId: actor.id, closureId: c.id, edgeId: c.edgeId, goalId: actor.destinationId, purpose,
      firstBlockedAt: now, observedTick: s.tick, closedRevision: c.closedRevision,
      position: copy(actor.position), from: copy(from), to: copy(to), routeIndex: index!, blockedSegmentIndex: i,
    };
    from = to;
  }
  return null;
}
/** Called after the original core replan. A dry detour and a lawful occupied
 * exit remain journeys, rather than pretending their residents are stranded. */
export function roadIntentStillBlocked(s: SimState, witness: RoadBlockWitness): boolean {
  const c = roadClosureById(s,witness.closureId), actor = s.citizens.find(row => row.id === witness.actorId);
  return !!c && c.reopenedAt === null && witness.observedTick === s.tick && witness.firstBlockedAt === clock(s)
    && !!actor && actor.destinationId === witness.goalId && s.extension?.actorProfiles[actor.id]?.alive === true && distance(actor.position,witness.position) <= EPS
    && ['unreachable','roadWaiting'].includes(actor.state) && (actor.route?.length ?? 0) <= 1;
}
/** Detached query: callers cannot mutate the recorded cause. */
export function roadRepairDemand(s: SimState, id: string): Readonly<RoadRepairDemand> | null {
  const row = body(s)?.demands.find(d => d.id === id); return row ? { ...clone(row), id: row.id, repairId: row.repairId, resolvedAt: row.resolvedAt } : null;
}
export function residentRoadRepairRequester(s: SimState, repairId: string, actorId: string, closureId: string): boolean {
  const origin = body(s)?.demands.find(d => d.repairId === repairId);
  return !!origin && origin.actorId === actorId && origin.closureId === closureId;
}

export function installRoadDemands(sim: RoadDemandsHost, accounting: RoadDemandsAccounting): void {
  const seen = new WeakSet<object>();
  sim.onEvent('road-route-blocked', event => {
    const w = event.roadBlock;
    if (!accounting.isCanonicalRoadBlock(event) || seen.has(event) || !w || !roadIntentStillBlocked(sim.state,w)) return;
    seen.add(event);
    const s = sim.state, c = roadClosureById(s,w.closureId)!;
    if (!validWitness(s,sim.worldDefinition,w,c) || body(s)?.demands.some(d => d.actorId === w.actorId && d.closureId === w.closureId && d.goalId === w.goalId)
      || (body(s)?.demands.length ?? 0) >= MAX_DEMANDS || bytes(s) > MAX_BYTES - 2048) return;
    const demands = body(s) ?? { version: 1 as const, activatedAt: clock(s), nextId: 1, demands: [] };
    if (!body(s)) { (s as State).roadDemands = demands; accounting.activate(); }
    const demand: RoadRepairDemand = { ...clone(w), id: 'road-demand-' + demands.nextId++, repairId: null, resolvedAt: null };
    demands.demands.push(demand);
    demand.repairId = accounting.requestRepair(demand.id);
  });
  sim.onPhase('feedback', s => {
    for (const d of body(s)?.demands ?? []) {
      const c = roadClosureById(s,d.closureId)!;
      if (c.reopenedAt !== null) { d.resolvedAt = c.reopenedAt; continue; }
      if (d.repairId === null && s.extension?.actorProfiles[d.actorId]?.alive) d.repairId = accounting.requestRepair(d.id);
    }
  });
  sim.registerSaveValidator(s => validateRoadDemandsState(s,sim.worldDefinition));
}

function validWitness(s: SimState, world: WorldDefinition, w: RoadBlockWitness, c: RoadClosure): boolean {
  const actor = s.citizens.find(row => row.id === w.actorId);
  return !!actor && world.buildings.some(b => b.id === w.goalId) && c.edgeId === w.edgeId && c.closedRevision === w.closedRevision
    && finite(w.firstBlockedAt) && w.firstBlockedAt === c.occurredAt && w.firstBlockedAt <= clock(s)
    && Number.isSafeInteger(w.observedTick) && w.observedTick >= 0 && w.observedTick <= s.tick
    && typeof w.purpose === 'string' && w.purpose.length > 0 && w.purpose.length <= 40
    && vector(w.position) && vector(w.from) && vector(w.to) && Number.isInteger(w.routeIndex) && w.routeIndex >= 0
    && Number.isInteger(w.blockedSegmentIndex) && w.blockedSegmentIndex >= w.routeIndex && w.blockedSegmentIndex < MAX_ROUTE_POINTS
    && (w.blockedSegmentIndex !== w.routeIndex || distance(w.from,w.position) <= EPS)
    && immutableRouteTarget(world,w.to) && causedBy(world,historicalRoads(s,w.firstBlockedAt),c,w.actorId,w.from,w.to);
}
export function validateRoadDemandsState(s: SimState, world: WorldDefinition): void {
  const ds = body(s); if (ds === undefined) return;
  const ensure = (yes: unknown, field: string): void => { if (!yes) throw new Error('道路居民需求存档无效：'+field); };
  const shape = (row: unknown, keys: string[], field: string): void => ensure(!!row && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).length === keys.length && keys.every(k => Object.hasOwn(row,k)),field);
  shape(ds,['version','activatedAt','nextId','demands'],'模块结构');
  ensure(ds.version === 1 && finite(ds.activatedAt) && ds.activatedAt >= 0 && ds.activatedAt <= clock(s) && bytes(s) <= MAX_BYTES,'版本/激活时间/容量');
  ensure(Array.isArray(ds.demands) && ds.demands.length > 0 && ds.demands.length <= MAX_DEMANDS && ds.nextId === ds.demands.length+1,'受保护身份与档案容量');
  const seen = new Set<string>();
  for (const [i,d] of ds.demands.entries()) {
    shape(d,['actorId','closureId','edgeId','goalId','purpose','firstBlockedAt','observedTick','closedRevision','position','from','to','routeIndex','blockedSegmentIndex','id','repairId','resolvedAt'],'需求结构');
    const c = roadClosureById(s,d.closureId), key = JSON.stringify([d.actorId,d.closureId,d.goalId]);
    ensure(d.id === 'road-demand-'+(i+1) && !seen.has(key),'顺序身份/去重'); seen.add(key);
    ensure(c && validWitness(s,world,d,c) && d.firstBlockedAt >= ds.activatedAt,'具名原目标/真实关闭/几何因果/时间');
    ensure(d.resolvedAt === null || finite(d.resolvedAt) && c!.reopenedAt === d.resolvedAt && d.resolvedAt >= d.firstBlockedAt && d.resolvedAt <= clock(s),'真实修复后结案');
    if (d.repairId !== null) {
      const job = s.roadworks?.jobs.find(j => j.id === d.repairId);
      ensure(typeof d.repairId === 'string' && job && job.closureId === d.closureId && job.edgeId === d.edgeId && job.startedAt >= c!.occurredAt && job.startedAt <= clock(s),'原维修引用/时序');
    }
  }
}
