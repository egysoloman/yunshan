import { canAccessFloor } from '../access';
import { blocksFloorPlanMovement, buildingWorldPosition, findFloorPlanRoute, floorPlanSupport, getBuildingFloorPlan, getFloorPlanStairPosition } from '../architecture-floor-plan';
import type { Building, Command, CommandResult, Player, SimState, Vec3 } from '../types';

const EPS = 1e-7, BODY_RADIUS = .35, POINT_RADIUS = .4;
export const HOME_REST_MINUTES = 20;
// Preserve the former home's total +38/+12, spread over real onsite minutes.
export const HOME_REST_FATIGUE_PER_MINUTE = 38 / HOME_REST_MINUTES;
export const HOME_REST_FUN_PER_MINUTE = 12 / HOME_REST_MINUTES;
export const HOME_REST_HISTORY_LIMIT = 64;
export interface HomeRestPoint {
  id: string; bedId: string; buildingId: string; floor: number; fixtureId: string;
  side: 'x-minus' | 'x-plus' | 'z-minus' | 'z-plus'; position: Vec3;
}
export interface HomeRestSession {
  id: string; buildingId: string; bedId: string; floor: number; pointId: string; point: Vec3;
  startedAt: number; lastObservedAt: number; progressMinutes: number; requiredMinutes: number;
  state: 'active' | 'paused' | 'completed' | 'cancelled'; pauseReason: string; endedAt: number | null;
}
export interface HomeRestState {
  version: 1; nextId: number; lastObservedAt: number;
  session: HomeRestSession | null; history: HomeRestSession[];
}
type RestState = SimState & { homeRest?: HomeRestState };
/** Structural API: importing this module never imports the Simulation core. */
export interface HomeRestSimulation {
  state: RestState;
  readonly worldDefinition: { buildings: Building[] };
  onPhase(phase: 'people', handler: (state: SimState, minutes: number) => void): void;
  registerCommandHandler(handler: (command: Command) => CommandResult | null): void;
  registerSaveValidator(validator: (candidate: SimState) => void): void;
  onLoad(handler: () => void): void;
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const q = (n: number) => Math.round(n * 5) / 5;
const clock = (s: SimState) => s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60;
const emptyState = (s: SimState): HomeRestState => ({ version: 1, nextId: 1, lastObservedAt: clock(s), session: null, history: [] });
const pointCache = new WeakMap<Building, Map<number, HomeRestPoint[]>>();
const copyPoints = (points: readonly HomeRestPoint[]) => points.map(point => ({ ...point, position: { ...point.position } }));

/** Derived interaction points only: no edits to fixtures, plans or functionPoints.
 * A point must support the whole body on the floor and connect to the real shaft.
 * The bed top is deliberately not an interaction standing surface. */
export function homeRestPoints(building: Building, floor: number): HomeRestPoint[] {
  if (building.kind !== 'home' || !Number.isInteger(floor)) return [];
  const plan = getBuildingFloorPlan(building, floor); if (!plan) return [];
  let floors = pointCache.get(building);
  const cached = floors?.get(floor); if (cached) return copyPoints(cached);
  const points: HomeRestPoint[] = [];
  for (const bed of plan.fixtures.filter(f => f.kind === 'bed')) {
    const cx = q((bed.rect.x0 + bed.rect.x1) / 2), cz = q((bed.rect.z0 + bed.rect.z1) / 2);
    const candidates: [HomeRestPoint['side'], number, number][] = [
      ['z-plus', cx, q(bed.rect.z1 + .6)], ['z-minus', cx, q(bed.rect.z0 - .6)],
      ['x-plus', q(bed.rect.x1 + .6), cz], ['x-minus', q(bed.rect.x0 - .6), cz],
    ];
    const bedId = `${building.id}:floor:${floor}:bed:${encodeURIComponent(bed.id)}`;
    for (const [side, x, z] of candidates) {
      const position = buildingWorldPosition(building, { x, y: plan.y, z });
      const support = floorPlanSupport(building, floor, position, BODY_RADIUS);
      if (!support || support.kind !== 'room' || support.floor !== floor || Math.abs(support.y - position.y) > EPS) continue;
      if (!findFloorPlanRoute(building, floor, getFloorPlanStairPosition(building, floor), position, BODY_RADIUS)) continue;
      points.push({ id: `${bedId}:side:${side}`, bedId, buildingId: building.id, floor, fixtureId: bed.id, side, position });
    }
  }
  if (!floors) { floors = new Map(); pointCache.set(building, floors); }
  // World geometry is immutable during simulation. Permission and placed voxel
  // checks stay live; callers never receive the cached points themselves.
  floors.set(floor, points); return copyPoints(points);
}

export function homeRestPointAt(building: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>, pointId?: string): HomeRestPoint | null {
  const floor = Math.round((position.y - building.position.y - .6) / (building.height / building.floors));
  if (!Number.isInteger(floor) || !canAccessFloor(building, floor, person)) return null;
  const plan = getBuildingFloorPlan(building, floor); if (!plan || Math.abs(position.y - building.position.y - .6 - plan.y) > EPS) return null;
  const support = floorPlanSupport(building, floor, position, BODY_RADIUS);
  if (!support || support.kind !== 'room' || support.floor !== floor || Math.abs(support.y - position.y) > EPS) return null;
  if (blocksFloorPlanMovement(building, floor, position, position, BODY_RADIUS)) return null;
  return homeRestPoints(building, floor).filter(p => !pointId || p.id === pointId)
    .sort((a, b) => distance(a.position, position) - distance(b.position, position))
    .find(p => distance(p.position, position) <= POINT_RADIUS + EPS) ?? null;
}

/** Live placed cubes use the same standing body as player bed-side rest. */
export function homeRestPointBlockedByVoxels(position: Vec3, voxels: readonly { position: Vec3 }[]): boolean {
  return voxels.some(v => {
    if (v.position.y + .1 <= position.y + .01 || v.position.y - .1 >= position.y + 1.72) return false;
    const dx = Math.max(Math.abs(v.position.x - position.x) - .1, 0), dz = Math.max(Math.abs(v.position.z - position.z) - .1, 0);
    return dx * dx + dz * dz < BODY_RADIUS * BODY_RADIUS - EPS;
  });
}

/** NPC targets can avoid a player's actual occupied bed; sides are one bed. */
export function homeRestBedOccupied(state: RestState, bedId: string): boolean {
  const session = state.homeRest?.session, player = state.player;
  return !!session && session.state === 'active' && session.bedId === bedId && player.homeId === session.buildingId
    && Math.abs(player.position.y - session.point.y) <= EPS && distance(player.position, session.point) <= POINT_RADIUS + EPS
    && !player.vehicleId && !state.aviation?.activeAircraftId && state.extension?.actorProfiles.player?.alive !== false
    && state.playerLabor?.job?.status !== 'working'
    && !state.clinical?.orders.some(order => order.patientId === 'player' && order.state !== 'completed' && order.state !== 'cancelled');
}

/** One live eligibility query for commands, people phases and the UI. It does
 * not infer time, mutate sessions or reserve an NPC's future route. */
export function homeRestBlockedReason(state: SimState, building: Building, pointId?: string): string {
  const player = state.player;
  if (player.homeId !== building.id) return '已不再租住原住宅。';
  if (state.extension?.actorProfiles.player?.alive === false) return '角色生命已结束。';
  if (player.vehicleId || state.aviation?.activeAircraftId) return '乘坐或驾驶载具期间不能休息。';
  if (state.playerLabor?.job?.status === 'working') return '正在劳动，请先结束或离开工班。';
  if (state.clinical?.orders.some(o => o.patientId === 'player' && o.state !== 'completed' && o.state !== 'cancelled')) return '正在等候或接受治疗。';
  const point = homeRestPointAt(building, player.position, player, pointId);
  if (!point) return '已离开原床侧站点，或床位权限与完整身体支撑不再满足。';
  const bedSides = homeRestPoints(building, point.floor).filter(side => side.bedId === point.bedId);
  if (state.citizens.some(person => person.homeId === building.id && ['atHome', 'sleeping'].includes(person.state)
    && state.extension?.actorProfiles[person.id]?.alive !== false && Math.abs(person.position.y - point.position.y) <= EPS
    && bedSides.some(side => distance(side.position, person.position) <= POINT_RADIUS + EPS)
    && floorPlanSupport(building, point.floor, person.position, BODY_RADIUS)?.kind === 'room'
    && !blocksFloorPlanMovement(building, point.floor, person.position, person.position, BODY_RADIUS))) return '这张床已有居民实际到场休息，请选择另一床位。';
  if (homeRestPointBlockedByVoxels(player.position, state.voxels)) return '床侧站立体积被放置的体素阻挡。';
  return '';
}

export function installHomeRest(simulation: HomeRestSimulation): void {
  simulation.state.homeRest ??= emptyState(simulation.state);
  const archive = (session: HomeRestSession, state: 'completed' | 'cancelled', reason = '') => {
    const rest = simulation.state.homeRest!, now = clock(simulation.state);
    session.state = state; session.pauseReason = reason; session.lastObservedAt = now; session.endedAt = now;
    rest.history.push(session); if (rest.history.length > HOME_REST_HISTORY_LIMIT) rest.history.shift();
    rest.session = null; rest.lastObservedAt = now;
  };
  simulation.registerCommandHandler(command => {
    const type: string = command.type;
    if (type === 'cancelRest') {
      const session = simulation.state.homeRest?.session;
      if (!session) return { ok: false, message: '当前没有进行中的住宅休息。' };
      archive(session, 'cancelled', '主动结束休息。'); return { ok: true, message: '已结束住宅休息，已恢复的精力保留。' };
    }
    if (type !== 'rest') return null;
    const state = simulation.state;
    const building = simulation.worldDefinition.buildings.find(b => b.id === (command.targetId ?? state.player.homeId));
    // Keep non-home public facilities and all historical unmarked recipes on
    // the core's existing command branch; only physical v4 homes use this one.
    if (!building || building.kind !== 'home' || !getBuildingFloorPlan(building, 0)) return null;
    const rest = state.homeRest ??= emptyState(state);
    const session = rest.session;
    if (!command.targetId && !homeRestPointAt(building, state.player.position, state.player, session?.pointId)) return null;
    if (session?.state === 'active') return { ok: false, message: '住宅休息已开始，不能重复领取恢复。' };
    if (session && session.buildingId !== building.id) return { ok: false, message: '请先取消原住宅休息。' };
    const reason = homeRestBlockedReason(state, building, session?.pointId);
    if (reason) return { ok: false, message: reason };
    const point = homeRestPointAt(building, state.player.position, state.player, session?.pointId)!;
    const now = clock(state); rest.lastObservedAt = now;
    if (session) { session.state = 'active'; session.pauseReason = ''; session.lastObservedAt = now; }
    else rest.session = { id: `home-rest-${rest.nextId++}`, buildingId: building.id, bedId: point.bedId, floor: point.floor,
      pointId: point.id, point: { ...point.position }, startedAt: now, lastObservedAt: now, progressMinutes: 0,
      requiredMinutes: HOME_REST_MINUTES, state: 'active', pauseReason: '', endedAt: null };
    return { ok: true, message: `已${session ? '继续' : '开始'}床侧休息，按实际在场分钟恢复精力；离场暂停，再到原床旁可继续。` };
  });
  simulation.onPhase('people', (_state, minutes) => {
    const state = simulation.state, rest = state.homeRest!;
    // Genuine historical unmarked saves never had this module. Preserve their
    // immediate export and leave their existing public/home rest branch alone.
    if (!rest) return;
    const now = clock(state); if (!Number.isFinite(now) || now < rest.lastObservedAt) return;
    const elapsed = Math.min(Number.isFinite(minutes) ? Math.max(0, minutes) : 0, now - rest.lastObservedAt);
    rest.lastObservedAt = now; const session = rest.session; if (!session) return;
    session.lastObservedAt = now;
    const building = simulation.worldDefinition.buildings.find(b => b.id === session.buildingId);
    if (!building || state.player.homeId !== session.buildingId || state.extension?.actorProfiles.player?.alive === false) {
      archive(session, 'cancelled', !building || state.player.homeId !== session.buildingId ? '原住宅使用权已结束。' : '角色生命已结束。'); return;
    }
    if (session.state === 'paused') return;
    const reason = homeRestBlockedReason(state, building, session.pointId);
    if (reason) { session.state = 'paused'; session.pauseReason = reason; return; }
    const credited = Math.min(elapsed, HOME_REST_MINUTES - session.progressMinutes);
    session.progressMinutes = Math.round((session.progressMinutes + credited) * 1e8) / 1e8;
    state.player.needs.fatigue = Math.min(100, state.player.needs.fatigue + credited * HOME_REST_FATIGUE_PER_MINUTE);
    state.player.needs.fun = Math.min(100, state.player.needs.fun + credited * HOME_REST_FUN_PER_MINUTE);
    if (session.progressMinutes >= HOME_REST_MINUTES) archive(session, 'completed');
  });
  simulation.registerSaveValidator(candidate => validateHomeRest(candidate, simulation.worldDefinition.buildings));
  // Only a world with physical v4 homes needs the absent-module migration.
  // Existing module data is retained in every recipe; new games keep their
  // current constructor manifest, while historical unmarked exports stay exact.
  simulation.onLoad(() => {
    if (simulation.worldDefinition.buildings.some(building => building.kind === 'home' && getBuildingFloorPlan(building, 0))) {
      simulation.state.homeRest ??= emptyState(simulation.state);
    }
  });
}

/** Validate candidate data only. No writes or authoritative closure state before
 * core commits a loaded save, so rejected saves remain atomic. */
export function validateHomeRest(candidate: SimState, buildings: readonly Building[]): void {
  const rest = (candidate as RestState).homeRest; if (rest === undefined) return;
  const ensure = (ok: unknown, text: string) => { if (!ok) throw new Error(`住宅休息存档无效：${text}。`); };
  const number = (n: unknown, max = 1e12): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  const now = clock(candidate);
  ensure(number(now), '当前单调时钟');
  ensure(rest && rest.version === 1 && candidate.extension && number(rest.nextId, 1e9) && Number.isInteger(rest.nextId) && rest.nextId > 0, '版本与编号');
  ensure(number(rest.lastObservedAt) && rest.lastObservedAt <= now + EPS, '单调时钟');
  ensure(Array.isArray(rest.history) && rest.history.length <= HOME_REST_HISTORY_LIMIT && (rest.session === null || typeof rest.session === 'object'), '会话与历史');
  const ids = new Set<string>();
  for (const session of [...rest.history, ...(rest.session ? [rest.session] : [])]) {
    ensure(session && /^home-rest-[1-9][0-9]*$/.test(session.id) && Number(session.id.slice(10)) < rest.nextId && !ids.has(session.id), '会话身份'); ids.add(session.id);
    const building = buildings.find(b => b.id === session.buildingId);
    ensure(building && building.kind === 'home' && Number.isInteger(session.floor), '真实住宅与楼层');
    const point = building && homeRestPoints(building, session.floor).find(p => p.id === session.pointId && p.bedId === session.bedId);
    ensure(point && session.point && ['x', 'y', 'z'].every(k => typeof session.point[k as keyof Vec3] === 'number' && Number.isFinite(session.point[k as keyof Vec3]))
      && distance(point.position, session.point) <= EPS, '真实床位与床侧脚高');
    ensure(number(session.startedAt) && number(session.lastObservedAt) && session.startedAt <= session.lastObservedAt + EPS
      && session.lastObservedAt <= rest.lastObservedAt + EPS && session.lastObservedAt <= now + EPS, '会话时钟');
    ensure(session.requiredMinutes === HOME_REST_MINUTES && number(session.progressMinutes, HOME_REST_MINUTES)
      && session.progressMinutes <= session.lastObservedAt - session.startedAt + EPS, '实际休息分钟');
    ensure(['active', 'paused', 'completed', 'cancelled'].includes(session.state) && typeof session.pauseReason === 'string' && session.pauseReason.length <= 120, '状态与中断原因');
    if (session === rest.session) ensure(['active', 'paused'].includes(session.state) && session.endedAt === null && session.progressMinutes < HOME_REST_MINUTES
      && (session.state === 'active' ? session.pauseReason === '' : session.pauseReason.length > 0), '进行中会话');
    else ensure(['completed', 'cancelled'].includes(session.state) && number(session.endedAt) && session.endedAt >= session.startedAt
      && Math.abs(session.endedAt - session.lastObservedAt) <= EPS && session.endedAt <= now + EPS
      && (session.state !== 'completed' || session.progressMinutes === HOME_REST_MINUTES), '结束记录');
  }
}
