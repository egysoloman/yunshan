import type { NetworkEdge, SimState, Vec3, WorldDefinition } from './types';
import { FLOOR_PLAN_PROFILE, floorPlanSupport } from './architecture-floor-plan';

const EPS = 1e-7, BODY = .35, GRADE = .26, RIVER_REACH = 80, MAX_CLOSURES = 64;
export interface RoadExitPermit {
  actorId: string; kind: 'player' | 'citizen' | 'vehicle'; closureId: string; edgeId: string;
  closedRevision: number; exitNodeId: string; direction: 1 | -1; issuedAt: number;
  startAlong: number; startPosition: Vec3;
}
export interface RoadOccupantWitness extends RoadExitPermit { routeIndex: number | null; nextPoint: Vec3 | null; vehicleProgress: number | null }
export interface RoadClosure {
  id: string; edgeId: string; sourceEventId: number; districtId: string; occurredAt: number; severity: number;
  closedRevision: number; worksiteNodeId: string; worksite: Vec3;
  reopenedAt: number | null; repairedBy: string | null; reopenedRevision: number | null; occupants: RoadOccupantWitness[];
}
export interface RoadNetworkState { version: 1; activatedAt: number; revision: number; nextClosureId: number; closures: RoadClosure[]; permits: Record<string, RoadExitPermit> }
export interface RoadDisasterEvent { type: string; eventId?: number; districtId?: string; occurredAt?: number; severity?: number }
interface RoadLifecycleEvent extends RoadDisasterEvent { closureId: string; edgeId: string; revision: number; repairId?: string }
export interface RoadHost {
  state: SimState; readonly worldDefinition: WorldDefinition;
  onEvent(type: 'environment-disaster', handler: (event: RoadDisasterEvent) => void): void;
  onPhase(phase: 'feedback', handler: (state: SimState, minutes: number) => void): void;
  registerSaveValidator(validator: (state: SimState) => void): void;
  emitEvent?(event: RoadLifecycleEvent): void;
}
export interface RoadAccounting { isCanonicalDisaster(event: object): boolean; activate?(): void }
interface Projection { along: number; length: number; horizontal: number; height: number; point: Vec3; segment: number }
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clock = (s: SimState) => s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60;
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const eligible = (e: NetworkEdge) => ['road', 'bridge'].includes(e.mode) && !e.id.includes('airport-runway-strip');
const width = (e: NetworkEdge) => e.mode === 'bridge' ? 4.5 : 5;
const lengthOf = (e: NetworkEdge) => e.points.slice(1).reduce((sum, p, i) => sum + distance(e.points[i], p), 0);
const branchCaches = new WeakMap<WorldDefinition,{ source: NetworkEdge[]; count: number; branches: Map<string,NetworkEdge[]> }>();
function branches(world: WorldDefinition, edge: NetworkEdge): NetworkEdge[] {
  let cached=branchCaches.get(world);
  if (!cached || cached.source !== world.edges || cached.count !== world.edges.length) {
    const nodes=new Map<string,NetworkEdge[]>(), byEdge=new Map<string,NetworkEdge[]>();
    for(const row of world.edges) if(eligible(row)) for(const id of [row.from,row.to]) { const list=nodes.get(id) ?? [];list.push(row);nodes.set(id,list); }
    for(const row of world.edges) byEdge.set(row.id,[...new Set([...(nodes.get(row.from) ?? []),...(nodes.get(row.to) ?? [])])].filter(other=>other.id!==row.id));
    cached={source:world.edges,count:world.edges.length,branches:byEdge};branchCaches.set(world,cached);
  }
  return cached.branches.get(edge.id) ?? [];
}
function project(e: NetworkEdge, p: Vec3): Projection | null {
  const total = lengthOf(e); let preceding = 0, best = Infinity, result: Projection | null = null;
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i], dx = b.x - a.x, dz = b.z - a.z, n = dx * dx + dz * dz, length = distance(a, b);
    if (n > EPS && length > EPS) {
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / n));
      const q = { x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t }, horizontal = Math.hypot(p.x - q.x, p.z - q.z), height = Math.abs(p.y - q.y);
      if (Math.hypot(horizontal, height) < best) { best = Math.hypot(horizontal, height); result = { along: preceding + length * t, length: total, horizontal, height, point: q, segment: i }; }
    }
    preceding += length;
  }
  return result;
}
function onDeck(e: NetworkEdge, p: Vec3, body = BODY): Projection | null {
  const q = project(e, p); return q && q.horizontal + body <= width(e) + EPS && q.height <= GRADE + EPS ? q : null;
}
const nodePoint = (world: WorldDefinition, id: string) => world.nodes.find(n => n.id === id)?.position ?? null;
function pointSegmentDistanceXZ(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dz = b.z - a.z, n = dx * dx + dz * dz;
  const t = n === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / n));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}
function segmentDistanceXZ(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const ax = b.x - a.x, az = b.z - a.z, cx = d.x - c.x, cz = d.z - c.z;
  const denominator = ax * cz - az * cx;
  if (denominator !== 0) {
    const dx = c.x - a.x, dz = c.z - a.z;
    const t = (dx * cz - dz * cx) / denominator, u = (dx * az - dz * ax) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  // Parallel, collinear and point segments are covered by endpoint distances.
  // No sampling or near-zero tolerance may turn a separated segment into a hit.
  return Math.min(pointSegmentDistanceXZ(a,c,d), pointSegmentDistanceXZ(b,c,d), pointSegmentDistanceXZ(c,a,b), pointSegmentDistanceXZ(d,a,b));
}
function riverDistance(world: WorldDefinition, p: Vec3): number {
  let best = Infinity;
  if (world.river.length === 1) return Math.hypot(p.x-world.river[0].x,p.z-world.river[0].z);
  for (let i = 1; i < world.river.length; i++) best = Math.min(best, pointSegmentDistanceXZ(p,world.river[i-1],world.river[i]));
  return best;
}
function floodDistance(world: WorldDefinition, e: NetworkEdge): number {
  let best = Infinity;
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i];
    if (world.river.length === 1) best = Math.min(best, pointSegmentDistanceXZ(world.river[0],a,b));
    for (let j = 1; j < world.river.length; j++) best = Math.min(best, segmentDistanceXZ(a,b,world.river[j-1],world.river[j]));
  }
  return best;
}
export function roadRevision(s: Pick<SimState, 'roadNetwork'>): number { return s.roadNetwork?.revision ?? 0; }
export function roadClosure(s: Pick<SimState, 'roadNetwork'>, edgeId: string): RoadClosure | null { return [...(s.roadNetwork?.closures ?? [])].reverse().find(c => c.edgeId === edgeId && c.reopenedAt === null) ?? null; }
export function roadClosureById(s: Pick<SimState, 'roadNetwork'>, id: string): RoadClosure | null { return s.roadNetwork?.closures.find(c => c.id === id) ?? null; }
export function isRoadOpen(s: Pick<SimState, 'roadNetwork'>, edgeId: string): boolean { return roadClosure(s, edgeId) === null; }
export function roadExitPermit(s: Pick<SimState, 'roadNetwork'>, actorId: string): Readonly<RoadExitPermit> | null {
  const p = s.roadNetwork?.permits[actorId]; return p ? { ...p, startPosition: copy(p.startPosition) } : null;
}
function capture(world: WorldDefinition, state: SimState, c: RoadClosure, edge: NetworkEdge): RoadOccupantWitness[] {
  const rows: RoadOccupantWitness[] = [];
  const inside = (p: Vec3): boolean => world.buildings.some(b => {
    const storey = b.height / b.floors, floor = Math.floor((p.y-b.position.y-.6+.26)/storey);
    if (floor < 0 || floor >= b.floors) return false;
    if (b.floorPlanProfile === FLOOR_PLAN_PROFILE) { const support = floorPlanSupport(b,floor,p,BODY); return !!support && ['room','stairs'].includes(support.kind) && Math.abs(support.y-p.y) <= GRADE; }
    const dx = p.x-b.position.x, dz = p.z-b.position.z, x = dx*Math.cos(b.rotation)+dz*Math.sin(b.rotation), z = -dx*Math.sin(b.rotation)+dz*Math.cos(b.rotation);
    return Math.abs(x) < b.width/2 && Math.abs(z) < b.depth/2 && Math.abs(p.y-(b.position.y+.6+floor*storey)) <= GRADE;
  });
  const add = (actorId: string, kind: RoadExitPermit['kind'], position: Vec3, direction: 1 | -1, routeIndex: number | null, nextPoint: Vec3 | null, vehicleProgress: number | null) => {
    const q = onDeck(edge, position, kind === 'vehicle' ? 0 : BODY); if (!q || q.along <= BODY || q.along >= q.length - BODY) return;
    rows.push({ actorId, kind, closureId: c.id, edgeId: edge.id, closedRevision: c.closedRevision, exitNodeId: direction === 1 ? edge.to : edge.from, direction,
      issuedAt: c.occurredAt, startAlong: q.along, startPosition: copy(position), routeIndex, nextPoint: nextPoint ? copy(nextPoint) : null, vehicleProgress });
  };
  for (const v of state.vehicles) {
    const q = v.edgeId === edge.id ? project(edge, v.position) : null;
    if (v.progress <= 0 || v.progress >= 1 || ![1,-1].includes(v.direction) || !q || Math.abs(q.along / q.length - v.progress) > 1e-4 || q.horizontal > 1.31 || q.height > GRADE) continue;
    add('vehicle:' + v.id, 'vehicle', v.position, v.direction as 1 | -1, null, null, v.progress);
  }
  for (const actor of state.citizens) {
    if (actor.state === 'riding' || state.extension?.actorProfiles[actor.id]?.alive === false || inside(actor.position) || state.roadNetwork?.permits[actor.id]) continue;
    const q = onDeck(edge, actor.position), next = actor.route?.[actor.routeIndex ?? 0], target = next ? project(edge, next) : null;
    if (!q) continue;
    if (!next) {
      // A completed genuine route can leave an investigator standing on the
      // deck. Capture its terminal footprint once, never grant from proximity
      // or from an empty, unfinished or stale route.
      const route = actor.route, index = actor.routeIndex;
      if (route?.length && Number.isSafeInteger(index) && index === route.length && index <= 1024 && distance(route.at(-1)!,actor.position) <= EPS)
        add(actor.id, 'citizen', actor.position, q.along <= q.length/2 ? -1 : 1, index, null, null);
      continue;
    }
    if (!target || target.horizontal > EPS || target.height > GRADE || Math.abs(target.along - q.along) < EPS) continue;
    add(actor.id, 'citizen', actor.position, target.along > q.along ? 1 : -1, actor.routeIndex ?? 0, next!, null);
  }
  if (!state.player.vehicleId && state.extension?.actorProfiles.player?.alive !== false && !inside(state.player.position) && !state.roadNetwork?.permits.player) { const q = onDeck(edge, state.player.position); if (q) add('player', 'player', state.player.position, q.along <= q.length / 2 ? -1 : 1, null, null, null); }
  return rows;
}
/** Only original canonical environment objects can create a closure. The
 * snapshot is captured here once; movement queries never grant an exit. */
export function closeRoadFromDisaster(host: Pick<RoadHost, 'state' | 'worldDefinition' | 'emitEvent'>, event: RoadDisasterEvent, accounting: RoadAccounting): RoadClosure | null {
  const state = host.state, world = host.worldDefinition, now = clock(state);
  if (event.type !== 'environment-disaster' || !accounting.isCanonicalDisaster(event) || !Number.isSafeInteger(event.eventId) || event.eventId! < 0
    || !finite(event.occurredAt) || Math.abs(event.occurredAt - now) > EPS || !finite(event.severity) || event.severity <= 0 || event.severity > 100
    || !world.districts.some(d => d.id === event.districtId) || (state.roadNetwork?.closures.length ?? 0) >= MAX_CLOSURES || state.roadNetwork?.closures.some(c => c.sourceEventId === event.eventId)) return null;
  const nodes = new Map(world.nodes.map(n => [n.id,n]));
  const edge = world.edges.filter(e => eligible(e) && isRoadOpen(state, e.id) && lengthOf(e) > BODY * 2 && [e.from,e.to].some(id => nodes.get(id)?.districtId === event.districtId))
    .map(e => ({ edge: e, river: floodDistance(world,e) })).filter(r => r.river <= RIVER_REACH).sort((a,b) => a.river - b.river || a.edge.id.localeCompare(b.edge.id))[0]?.edge;
  if (!edge || !nodes.has(edge.from) || !nodes.has(edge.to)) return null;
  const network: RoadNetworkState = state.roadNetwork ?? { version: 1, activatedAt: now, revision: 0, nextClosureId: 1, closures: [], permits: {} };
  const ends = [nodes.get(edge.from)!,nodes.get(edge.to)!].sort((a,b) => riverDistance(world,b.position) - riverDistance(world,a.position) || a.id.localeCompare(b.id));
  const c: RoadClosure = { id: 'road-closure-' + network.nextClosureId, edgeId: edge.id, sourceEventId: event.eventId!, districtId: event.districtId!, occurredAt: now, severity: event.severity,
    closedRevision: network.revision + 1, worksiteNodeId: ends[0].id, worksite: copy(ends[0].position), reopenedAt: null, repairedBy: null, reopenedRevision: null, occupants: [] };
  c.occupants = capture(world,state,c,edge); network.revision++; network.nextClosureId++; network.closures.push(c);
  for (const row of c.occupants) { const { routeIndex: _r, nextPoint: _n, vehicleProgress: _v, ...permit } = row; network.permits[row.actorId] = permit; }
  state.roadNetwork = network; accounting.activate?.(); host.emitEvent?.({ type: 'road-edge-closed', eventId: event.eventId, districtId: event.districtId, occurredAt: now, closureId: c.id, edgeId: edge.id, revision: network.revision });
  return c;
}
function validPermit(world: WorldDefinition, s: Pick<SimState, 'roadNetwork'>, id: string, position: Vec3): { permit: RoadExitPermit; edge: NetworkEdge; q: Projection } | null {
  const permit = s.roadNetwork?.permits[id], c = permit ? roadClosureById(s,permit.closureId) : null, edge = permit ? world.edges.find(e => e.id === permit.edgeId) : null;
  if (!permit || !c || c.reopenedAt !== null || c.closedRevision !== permit.closedRevision || c.edgeId !== permit.edgeId || !edge) return null;
  const q = onDeck(edge,position,permit.kind === 'vehicle' ? 0 : BODY); return q && permit.direction * (q.along - permit.startAlong) >= -EPS ? { permit,edge,q } : null;
}
export function roadExitRoute(world: WorldDefinition, s: Pick<SimState, 'roadNetwork'>, id: string, position: Vec3): { exitNodeId: string; edgeId: string; points: Vec3[] } | null {
  const r = validPermit(world,s,id,position); if (!r) return null;
  const points = [copy(position)]; if (distance(position,r.q.point) > EPS) points.push(copy(r.q.point));
  points.push(...(r.permit.direction === 1 ? r.edge.points.slice(r.q.segment) : r.edge.points.slice(0,r.q.segment).reverse()).map(copy));
  const end = nodePoint(world,r.permit.exitNodeId); if (!end) return null;
  if (distance(points.at(-1)!,end) > EPS) points.push(copy(end)); return { exitNodeId: r.permit.exitNodeId, edgeId: r.edge.id, points };
}
function atEndpoint(world: WorldDefinition, edge: NetworkEdge, p: Vec3): boolean { return [edge.from,edge.to].some(id => { const q = nodePoint(world,id); return q && distance(q,p) <= BODY + EPS; }); }
function onOpenBranch(world: WorldDefinition, s: Pick<SimState,'roadNetwork'>, edge: NetworkEdge, p: Vec3, closed: Projection): boolean {
  return branches(world,edge).some(other => {
    if (!isRoadOpen(s,other.id)) return false;
    const q = onDeck(other,p);
    return !!q && q.along > BODY && q.along < q.length-BODY && q.horizontal + EPS < closed.horizontal;
  });
}
/** Swept .2m admission guard. Physical deck height and static geometry remain
 * unchanged; only the captured actor may move monotonically to its exit. */
export function roadMovementAllowed(world: WorldDefinition, s: Pick<SimState, 'roadNetwork'>, id: string, from: Vec3, to: Vec3): boolean {
  for (const c of s.roadNetwork?.closures.filter(c => c.reopenedAt === null) ?? []) {
    const edge = world.edges.find(e => e.id === c.edgeId); if (!edge) return false;
    const pieces = Math.max(1,Math.ceil(distance(from,to) / .2)); let intersects = false;
    for (let i = 0; i <= pieces; i++) { const p = { x: from.x + (to.x-from.x)*i/pieces, y: from.y + (to.y-from.y)*i/pieces, z: from.z + (to.z-from.z)*i/pieces }, q = project(edge,p);
      if (q && q.along > BODY && q.along < q.length - BODY && q.horizontal <= width(edge) + BODY && q.height <= GRADE && !atEndpoint(world,edge,p) && !onOpenBranch(world,s,edge,p,q)) { intersects = true; break; } }
    if (!intersects) continue;
    const r = validPermit(world,s,id,from), q = project(edge,to);
    if (!r || r.edge !== edge || !q || q.height > GRADE || q.horizontal > width(edge) + EPS || r.permit.direction * (q.along-r.q.along) < -EPS
      || !onDeck(edge,to,r.permit.kind === 'vehicle' ? 0 : BODY) && !atEndpoint(world,edge,to)) return false;
    // A permit is for the remaining real polyline, not a straight shortcut
    // between two far-apart points of a bent road.
    let previousAlong = r.q.along;
    for (let i = 1; i <= pieces; i++) {
      const point = { x: from.x+(to.x-from.x)*i/pieces, y: from.y+(to.y-from.y)*i/pieces, z: from.z+(to.z-from.z)*i/pieces };
      const at = onDeck(edge,point,r.permit.kind === 'vehicle' ? 0 : BODY);
      if (!at || r.permit.direction*(at.along-previousAlong) < -EPS) return false;
      previousAlong=at.along;
    }
  }
  return true;
}
export function releaseRoadExitPermit(world: WorldDefinition, s: SimState, id: string, position: Vec3): boolean {
  const network = s.roadNetwork, p = network?.permits[id]; if (!network || !p) return false;
  const actual = actorPosition(s,p); if (!actual || distance(actual,position) > EPS) return false;
  const edge = world.edges.find(e => e.id === p.edgeId), q = edge ? project(edge,position) : null;
  const reached = q && q.horizontal <= (p.kind === 'vehicle' ? 1.31 : width(edge!)-BODY) + EPS && q.height <= GRADE
    && (p.direction === 1 ? q.length-q.along : q.along) <= EPS && p.direction*(q.along-p.startAlong) >= -EPS;
  if (roadClosureById(s,p.closureId)?.reopenedAt !== null || reached) { delete network.permits[id]; return true; } return false;
}
interface RepairProof {
  id: string; closureId: string; edgeId: string; status: string; requiredMinutes: number; workedMinutes: number; consumedUnits: number; completedAt: number | null; cancelledAt: number | null;
  funded: number; purchasePaid: number; paidGross: number; escrow: number; refunded: number; serviceFees: number;
  receipts: { quantity: number }[]; contributions: Record<string,{workedMinutes:number;gross:number}>;
}
function repairProof(s: SimState, c: RoadClosure, id: string): RepairProof | null {
  const jobs = s.roadworks && Reflect.get(s.roadworks,'jobs'); if (!Array.isArray(jobs)) return null;
  const j = jobs.find((row: RepairProof) => row.id === id) as RepairProof | undefined;
  if (!j || j.closureId !== c.id || j.edgeId !== c.edgeId || !['completed','refundPending'].includes(j.status) || j.cancelledAt !== null || j.requiredMinutes !== 60 || !finite(j.workedMinutes) || Math.abs(j.workedMinutes-60) > EPS || j.consumedUnits !== 1
    || !finite(j.completedAt) || j.completedAt > clock(s)+EPS || j.completedAt < c.occurredAt+60-EPS || j.serviceFees !== 0
    || ![j.funded,j.purchasePaid,j.paidGross,j.escrow,j.refunded].every(n => finite(n) && n >= 0) || j.purchasePaid <= 0 || Math.abs(j.funded-j.purchasePaid-j.paidGross-j.escrow-j.refunded) > EPS
    || !Array.isArray(j.receipts) || !j.receipts.every(r => finite(r.quantity) && r.quantity > 0) || Math.abs(j.receipts.reduce((sum,r) => sum+r.quantity,0)-1) > EPS || !j.contributions
    || !Object.values(j.contributions).every(r => finite(r.workedMinutes) && r.workedMinutes > 0 && finite(r.gross) && r.gross >= 0)
    || Math.abs(Object.values(j.contributions).reduce((sum,r) => sum+r.workedMinutes,0)-60) > EPS
    || Math.abs(Object.values(j.contributions).reduce((sum,r) => sum+r.gross,0)-j.paidGross) > EPS || j.status === 'completed' && j.escrow !== 0) return null;
  return j;
}
export function completeRoadRepair(host: Pick<RoadHost,'state'|'worldDefinition'|'emitEvent'>, closureId: string, repairId: string): boolean {
  const c = roadClosureById(host.state,closureId), network = host.state.roadNetwork; if (!network || !c || c.reopenedAt !== null || !repairProof(host.state,c,repairId)) return false;
  c.reopenedAt = clock(host.state); c.repairedBy = repairId; c.reopenedRevision = ++network.revision;
  for (const [id,p] of Object.entries(network.permits)) if (p.closureId === c.id) delete network.permits[id];
  host.emitEvent?.({ type: 'road-edge-reopened', closureId: c.id, edgeId: c.edgeId, revision: network.revision, repairId, occurredAt: c.reopenedAt }); return true;
}
function actorPosition(s: SimState, p: RoadExitPermit): Vec3 | null {
  return p.kind === 'player' ? p.actorId === 'player' && !s.player.vehicleId ? s.player.position : null
    : p.kind === 'vehicle' ? s.vehicles.find(v => 'vehicle:'+v.id === p.actorId)?.position ?? null : s.citizens.find(c => c.id === p.actorId && c.state !== 'riding')?.position ?? null;
}
export function validateRoadNetwork(s: SimState, world: WorldDefinition): void {
  const n = s.roadNetwork; if (n === undefined) return;
  const require = (ok: unknown, label: string): void => { if (!ok) throw new Error('道路覆盖层无效：'+label); };
  require(n && n.version === 1 && Array.isArray(n.closures) && n.closures.length > 0 && n.closures.length <= MAX_CLOSURES,'body');
  require(finite(n.activatedAt) && n.activatedAt >= 0 && n.activatedAt <= clock(s) && Number.isSafeInteger(n.revision) && n.revision > 0 && n.revision <= MAX_CLOSURES*2
    && n.nextClosureId === n.closures.length+1 && n.permits && typeof n.permits === 'object' && !Array.isArray(n.permits),'revision');
  const revisions = new Set<number>(), events = new Set<number>(), closed = new Set<string>(), previous = new Map<string,RoadClosure>();
  for (const [i,c] of n.closures.entries()) {
    const edge = world.edges.find(e => e.id === c.edgeId); require(c.id === 'road-closure-'+(i+1) && edge && eligible(edge) && lengthOf(edge) > BODY*2,'edge');
    const prior = previous.get(c.edgeId); require(!prior || prior.reopenedAt !== null && prior.reopenedAt <= c.occurredAt && prior.reopenedRevision! < c.closedRevision,'overlapping closure'); previous.set(c.edgeId,c);
    require(Number.isSafeInteger(c.sourceEventId) && c.sourceEventId >= 0 && !events.has(c.sourceEventId),'source'); events.add(c.sourceEventId);
    require(world.districts.some(d => d.id === c.districtId) && world.nodes.some(node => [edge!.from,edge!.to].includes(node.id) && node.districtId === c.districtId)
      && floodDistance(world,edge!) <= RIVER_REACH+EPS && finite(c.severity) && c.severity > 0 && c.severity <= 100,'river/district');
    require(finite(c.occurredAt) && c.occurredAt >= n.activatedAt && c.occurredAt <= clock(s) && Number.isSafeInteger(c.closedRevision) && c.closedRevision > 0 && c.closedRevision <= n.revision && !revisions.has(c.closedRevision),'closure time'); revisions.add(c.closedRevision);
    const site = nodePoint(world,c.worksiteNodeId); require([edge!.from,edge!.to].includes(c.worksiteNodeId) && site && distance(site,c.worksite) <= EPS,'worksite');
    if (c.reopenedAt === null) { require(c.repairedBy === null && c.reopenedRevision === null && !closed.has(c.edgeId),'closed receipt'); closed.add(c.edgeId); }
    else { require(finite(c.reopenedAt) && c.reopenedAt <= clock(s) && c.reopenedAt >= c.occurredAt+60-EPS && typeof c.repairedBy === 'string' && Number.isSafeInteger(c.reopenedRevision)
      && c.reopenedRevision! > c.closedRevision && c.reopenedRevision! <= n.revision && !revisions.has(c.reopenedRevision!),'reopen time'); revisions.add(c.reopenedRevision!);
      require(repairProof(s,c,c.repairedBy!) && repairProof(s,c,c.repairedBy!)!.completedAt! <= c.reopenedAt,'repair proof'); }
    require(Array.isArray(c.occupants) && c.occupants.length <= s.citizens.length+s.vehicles.length+1 && new Set(c.occupants.map(p => p.actorId)).size === c.occupants.length,'occupant bound');
    for (const p of c.occupants) {
      const q = onDeck(edge!,p.startPosition,p.kind === 'vehicle' ? 0 : BODY);
      require(p.closureId === c.id && p.edgeId === c.edgeId && p.closedRevision === c.closedRevision && p.issuedAt === c.occurredAt && [1,-1].includes(p.direction)
        && p.exitNodeId === (p.direction === 1 ? edge!.to : edge!.from) && q && Math.abs(q!.along-p.startAlong) <= EPS && q!.along > BODY && q!.along < q!.length-BODY,'snapshot');
      if (p.kind === 'player') require(p.actorId === 'player' && p.routeIndex === null && p.nextPoint === null && p.vehicleProgress === null,'player snapshot');
      else if (p.kind === 'vehicle') require(s.vehicles.some(v => 'vehicle:'+v.id === p.actorId) && finite(p.vehicleProgress) && Math.abs(p.vehicleProgress!-q!.along/q!.length) <= 1e-4
        && q!.horizontal <= 1.31 && p.routeIndex === null && p.nextPoint === null,'vehicle snapshot');
      else {
        require(p.kind === 'citizen' && s.citizens.some(a => a.id === p.actorId) && Number.isSafeInteger(p.routeIndex) && p.routeIndex! >= 0 && p.routeIndex! <= 1024 && p.vehicleProgress === null,'route snapshot');
        if (p.nextPoint === null) require(p.routeIndex! > 0 && p.direction === (q!.along <= q!.length/2 ? -1 : 1),'completed route snapshot');
        else { const next = p.nextPoint && project(edge!,p.nextPoint); require(next && next.horizontal <= EPS && next.height <= GRADE && p.direction*(next.along-q!.along) > EPS,'route snapshot'); }
      }
    }
  }
  require(n.activatedAt === n.closures[0].occurredAt && revisions.size === n.revision && Array.from({length:n.revision},(_,i) => i+1).every(v => revisions.has(v)),'revision history');
  require(Object.keys(n.permits).length <= s.citizens.length+s.vehicles.length+1,'permit bound');
  for (const [id,p] of Object.entries(n.permits)) {
    const c = roadClosureById(s,p.closureId), witness = c?.occupants.find(a => a.actorId === id), position = actorPosition(s,p);
    require(p.actorId === id && c && c.reopenedAt === null && witness && position,'permit reference');
    for (const key of ['kind','closureId','edgeId','closedRevision','exitNodeId','direction','issuedAt','startAlong'] as const) require(p[key] === witness![key],'permit '+key);
    require(distance(p.startPosition,witness!.startPosition) <= EPS && validPermit(world,s,id,position!),'live occupancy');
    if (p.kind === 'vehicle') { const v = s.vehicles.find(v => 'vehicle:'+v.id === id)!, q = project(world.edges.find(e => e.id === p.edgeId)!,position!)!;
      require(v.edgeId === p.edgeId && v.direction === p.direction && Math.abs(q.along/q.length-v.progress) <= 1e-4 && q.horizontal <= 1.31,'vehicle progression'); }
  }
}
export function installRoadNetwork(host: RoadHost, accounting: RoadAccounting): void {
  host.onEvent('environment-disaster', event => { closeRoadFromDisaster(host,event,accounting); });
  // No constructor/load empty-body migration. Already-present road surface is
  // never removed, and spent permits are removed only after actual movement.
  host.onPhase('feedback', state => { for (const [id,p] of Object.entries(state.roadNetwork?.permits ?? {})) {
    const position = actorPosition(state,p); if (!position || p.kind !== 'vehicle' && state.extension?.actorProfiles[id]?.alive === false) delete state.roadNetwork!.permits[id];
    else releaseRoadExitPermit(host.worldDefinition,state,id,position);
  } });
  host.registerSaveValidator(state => { validateRoadNetwork(state,host.worldDefinition); });
}
