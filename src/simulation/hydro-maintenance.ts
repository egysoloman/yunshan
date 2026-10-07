import { getCanonicalNpcFullSettlement, isCanonicalNpcWage, type Simulation } from '../simulation';
import type { Building, CommandResult, SimState, Vec3, WorldDefinition } from '../types';
import { powerControlBodyAt, powerControlPointAt, type PowerControlPoint } from './power';
import { claimFundedActorWork } from './funded-work';
import type { ActorActivityClaim } from './activity-capacity';
import { canAccessFloor, getFloorDimensions } from '../access';
import { blocksFloorPlanMovement, floorPlanSupport, getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { getWalkHeight } from '../world';

/** An explicit initial fault of one declared machine, not a construction,
 * wear, refill or authority to alter the machine's physical declaration. */
export interface HydroMaintenanceDefinition {
  version: 1; kind: 'paid-hydro-maintenance'; sourceId: string; operatorSiteId: string;
  initialNeedsRepair: true; requiredMinutes: 60; materialUnits: 1; playerEscrow: 100;
}
export interface HydroMaintenanceReceipt {
  purchasedAt: number; tick: number; shopId: string; quantity: 1; unitPrice: number;
  gross: number; net: number; tax: number; taxRate: number;
}
export interface HydroMaintenanceLaborReceipt {
  actorId: string; siteId: string; role: string; tick: number; at: number; phaseMinutes: number;
  startAt: number; endAt: number; minutes: number; position: Vec3; point: PowerControlPoint;
  age: number; health: number; hunger: number; fatigue: number;
  source: { citizenId: string; siteId: string; shopId: null; startAt: number; endAt: number; minutes: number; amount: number; ratePerMinute: number };
}
export interface HydroMaintenancePayment {
  citizenId: string; shopId: null; amount: number; requestedAmount: number;
  net: number; tax: number; at: number; tick: number; settledThroughAt: number;
}
export interface HydroMaintenanceJob {
  id: 'hydro-maintenance-1'; payerId: 'player'; startedAt: number; startedTick: number; lastObservedAt: number;
  status: 'awaitingSupply' | 'working' | 'paused' | 'awaitingWageSettlement' | 'completed' | 'cancelled' | 'refundPending'; reason: string;
  technicianId: string | null; point: PowerControlPoint | null; requiredMinutes: 60; workedMinutes: number;
  funded: 100; escrow: number; purchasePaid: number; serviceFees: number; refunded: number;
  receivedUnits: number; reservedUnits: number; consumedUnits: number; returnedUnits: number;
  receipts: HydroMaintenanceReceipt[]; laborReceipts: HydroMaintenanceLaborReceipt[]; payment: HydroMaintenancePayment | null;
  laborCompletedAt: number | null; completedAt: number | null; completedTick: number | null; cancelledAt: number | null; retryAt: number;
}
export interface HydroMaintenanceState {
  version: 1; kind: 'paid-hydro-maintenance'; sourceId: string; operatorSiteId: string; activatedAt: 480;
  job: HydroMaintenanceJob | null;
}
const EPS = 1e-7, MAX_LABOR_RECEIPTS = 1024;
const DEFINITION_KEYS = ['version', 'kind', 'sourceId', 'operatorSiteId', 'initialNeedsRepair', 'requiredMinutes', 'materialUnits', 'playerEscrow'];
const STATE_KEYS = ['version', 'kind', 'sourceId', 'operatorSiteId', 'activatedAt', 'job'];
const JOB_KEYS = ['id', 'payerId', 'startedAt', 'startedTick', 'lastObservedAt', 'status', 'reason', 'technicianId', 'point', 'requiredMinutes', 'workedMinutes', 'funded', 'escrow', 'purchasePaid', 'serviceFees', 'refunded', 'receivedUnits', 'reservedUnits', 'consumedUnits', 'returnedUnits', 'receipts', 'laborReceipts', 'payment', 'laborCompletedAt', 'completedAt', 'completedTick', 'cancelledAt', 'retryAt'];
const LABOR_KEYS = ['actorId', 'siteId', 'role', 'tick', 'at', 'phaseMinutes', 'startAt', 'endAt', 'minutes', 'position', 'point', 'age', 'health', 'hunger', 'fatigue', 'source'];
const PAYMENT_KEYS = ['citizenId', 'shopId', 'amount', 'requestedAmount', 'net', 'tax', 'at', 'tick', 'settledThroughAt'];
const ROLES = ['工程师', 'scientist', '科学家'];
const clock = (state: SimState) => state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copyPoint = (point: PowerControlPoint): PowerControlPoint => ({ id: point.id, floor: point.floor, position: { ...point.position } });
const stopped = (job: HydroMaintenanceJob) => ['completed', 'cancelled', 'refundPending'].includes(job.status);
function need(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error('水电维护契约：' + reason); }
function data(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), '完整数据对象');
  need(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, '数据对象原型');
  const own = Reflect.ownKeys(value); need(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)), '完整字段不得缺失或新增');
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); need(descriptor && 'value' in descriptor && descriptor.enumerable, '只接受数据字段'); }
}
function array<T>(value: unknown, maximum: number): asserts value is T[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1, '完整有界数组');
  for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); need(descriptor && 'value' in descriptor && descriptor.enumerable, '数组不得缺项'); }
}
function number(value: unknown, maximum = 1e12, minimum = 0): asserts value is number { need(finite(value) && value >= minimum && value <= maximum, '有限范围数量'); }
function integer(value: unknown, maximum = 1e10, minimum = 0): asserts value is number { number(value, maximum, minimum); need(Number.isSafeInteger(value), '整数数量'); }
function identity(value: unknown): asserts value is string { need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), '实体身份'); }
function close(a: number, b: number): void { need(Math.abs(a - b) <= EPS + Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 128, '钱料工关系不闭合'); }
function vector(value: unknown): asserts value is Vec3 { data(value, ['x', 'y', 'z']); for (const part of Object.values(value)) need(finite(part) && Math.abs(part) <= 1e7, '空间点'); }
function control(value: unknown): asserts value is PowerControlPoint { data(value, ['id', 'floor', 'position']); identity(value.id); integer(value.floor, 64); vector(value.position); }

export function validateHydroMaintenanceDefinition(world: WorldDefinition): void {
  const definition = world.hydroMaintenance; if (definition === undefined) return;
  data(definition, DEFINITION_KEYS); identity(definition.sourceId); identity(definition.operatorSiteId);
  need(definition.version === 1 && definition.kind === 'paid-hydro-maintenance' && definition.initialNeedsRepair === true && definition.requiredMinutes === 60 && definition.materialUnits === 1 && definition.playerEscrow === 100, '明确单次初始故障配方');
  const grid = world.powerGrid;
  need(grid?.version === 2 && grid.kind === 'finite-hydro-network' && grid.sources.length === 1, '只绑定单机组有限双库水电');
  const source = grid.sources[0], site = world.buildings.find(building => building.id === definition.operatorSiteId);
  need(source.id === definition.sourceId && source.buildingId === definition.operatorSiteId && site?.facility === 'energy', '原声明能源岗位及机组身份');
}

/** Immutable physical geometry can be rechecked after loading. Placed cubes and
 * needs are checked at the live slice; later cubes cannot rewrite that past. */
function staticBody(world: WorldDefinition, site: Building, point: PowerControlPoint, position: Vec3): boolean {
  const person = { role: 'scientist' as const, identities: ['scientist' as const] };
  const floor = Math.floor((position.y - site.position.y + .01) / (site.height / site.floors));
  if (point.floor !== floor || !canAccessFloor(site, floor, person) || distance(position, point.position) > 2) return false;
  if (getBuildingBody(site)) {
    const points = site.functionPoints ?? Array.from({ length: site.floors }, (_, level) => getBuildingUsePoints(site, level)).flat();
    const supported = (at: Vec3) => { const support = floorPlanSupport(site, floor, at, .35); return !!support && support.floor === floor && ['room', 'stairs'].includes(support.kind) && Math.abs(support.y - at.y) <= .26 && !blocksFloorPlanMovement(site, floor, at, at, .35, 1.72); };
    return points.some(row => row.id === point.id && row.purpose === 'work' && row.floor === floor && distance(row.position, point.position) < EPS) && supported(position) && supported(point.position);
  }
  const supported = (at: Vec3) => { const dimensions = getFloorDimensions(site, floor), dx = at.x - site.position.x, dz = at.z - site.position.z, x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation); return Math.abs(x) + .35 <= dimensions.width / 2 && Math.abs(z) + .35 <= dimensions.depth / 2 && site.height / site.floors >= 1.72 && Math.abs(getWalkHeight(world, at.x, at.z, at.y) - at.y) <= .26; };
  return point.id === 'legacy:' + site.id + ':' + floor && supported(position) && supported(point.position);
}

export function validateHydroMaintenanceState(state: SimState, world: WorldDefinition): void {
  validateHydroMaintenanceDefinition(world);
  const definition = world.hydroMaintenance, body = state.hydroMaintenance;
  if (!definition) { need(body === undefined, '未声明域不得附加维护资产'); return; }
  need(body && state.extension && state.power === undefined, '声明域必须保留独立维护资产');
  data(body, STATE_KEYS); need(body.version === 1 && body.kind === definition.kind && body.sourceId === definition.sourceId && body.operatorSiteId === definition.operatorSiteId && body.activatedAt === 480, '可信初始故障绑定');
  const now = clock(state); number(now, 1e7, 480);
  const job = body.job; if (job === null) return;
  data(job, JOB_KEYS); need(job.id === 'hydro-maintenance-1' && job.payerId === 'player' && job.requiredMinutes === 60 && job.funded === 100, '固定单次合同');
  number(job.startedAt, now, 480); integer(job.startedTick, state.tick); number(job.lastObservedAt, now, job.startedAt); number(job.retryAt, now + 60, job.startedAt);
  need(typeof job.reason === 'string' && job.reason.length <= 200 && ['awaitingSupply', 'working', 'paused', 'awaitingWageSettlement', 'completed', 'cancelled', 'refundPending'].includes(job.status), '任务状态');
  for (const field of ['escrow', 'purchasePaid', 'serviceFees', 'refunded'] as const) number(job[field], 100);
  close(job.escrow + job.purchasePaid + job.serviceFees + job.refunded, job.funded);
  for (const field of ['receivedUnits', 'reservedUnits', 'consumedUnits', 'returnedUnits'] as const) integer(job[field], 1);
  close(job.receivedUnits, job.reservedUnits + job.consumedUnits + job.returnedUnits);
  array<HydroMaintenanceReceipt>(job.receipts, 1); let purchased = 0;
  for (const receipt of job.receipts) {
    data(receipt, ['purchasedAt', 'tick', 'shopId', 'quantity', 'unitPrice', 'gross', 'net', 'tax', 'taxRate']); identity(receipt.shopId); number(receipt.purchasedAt, now, job.startedAt); integer(receipt.tick, state.tick, job.startedTick);
    const supplier = state.shops.find(shop => shop.id === receipt.shopId), supplierSite = supplier && world.buildings.find(site => site.id === supplier.buildingId);
    need(supplierSite?.kind === 'workshop' && !supplierSite.facility && receipt.quantity === 1, '真实工业材料商铺及完整一份');
    number(receipt.unitPrice, 100, 4); number(receipt.gross, 100, 4); number(receipt.net, receipt.gross); number(receipt.tax, receipt.gross); number(receipt.taxRate, .5);
    close(receipt.gross, receipt.unitPrice); close(receipt.net + receipt.tax, receipt.gross); close(receipt.tax, receipt.gross * receipt.taxRate); purchased += receipt.gross;
  }
  close(job.purchasePaid, purchased); need(job.receivedUnits === job.receipts.length, '材料及采购收据不得删除');
  number(job.workedMinutes, 60); array<HydroMaintenanceLaborReceipt>(job.laborReceipts, MAX_LABOR_RECEIPTS);
  const site = world.buildings.find(building => building.id === definition.operatorSiteId)!;
  let worked = 0, earned = 0, end = job.startedAt, priorTick = job.startedTick, observedAt = job.startedAt;
  if (job.technicianId !== null) { identity(job.technicianId); need(state.citizens.some(actor => actor.id === job.technicianId), '原居民技术员'); }
  if (job.point !== null) control(job.point);
  need((job.technicianId === null) === (job.point === null) && (job.laborReceipts.length === 0) === (job.technicianId === null), '技术员与真实劳动点完整配对');
  for (const receipt of job.laborReceipts) {
    data(receipt, LABOR_KEYS); identity(receipt.actorId); need(receipt.actorId === job.technicianId && receipt.siteId === site.id && ROLES.includes(receipt.role), '同一原岗位技术员');
    integer(receipt.tick, state.tick, Math.max(job.startedTick + 1, priorTick));
    number(receipt.at, now, job.startedAt); need(receipt.tick === priorTick ? receipt.at === observedAt : receipt.at > observedAt, '同相位来源时钟及逐相位真实前进'); priorTick = receipt.tick; observedAt = receipt.at;
    number(receipt.phaseMinutes, 4, .0625); number(receipt.startAt, receipt.at, Math.max(end, job.startedAt, receipt.at - receipt.phaseMinutes)); number(receipt.endAt, receipt.at, receipt.startAt); number(receipt.minutes, receipt.phaseMinutes, Number.MIN_VALUE); close(receipt.endAt - receipt.startAt, receipt.minutes);
    need(receipt.endAt > receipt.startAt && job.receipts.length === 1 && job.receipts[0].purchasedAt <= receipt.startAt, '先有真实物料再有非重叠现场分钟');
    vector(receipt.position); control(receipt.point); need(job.point && receipt.point.id === job.point.id && receipt.point.floor === job.point.floor && receipt.point.position.x === job.point.position.x && receipt.point.position.y === job.point.position.y && receipt.point.position.z === job.point.position.z && staticBody(world, site, receipt.point, receipt.position), '原几何工作点及完整身体');
    number(receipt.age, 150, 18); number(receipt.health, 100, Number.MIN_VALUE); number(receipt.hunger, 100, 12); number(receipt.fatigue, 100, 15);
    const source = receipt.source; data(source, ['citizenId', 'siteId', 'shopId', 'startAt', 'endAt', 'minutes', 'amount', 'ratePerMinute']);
    need(source.citizenId === receipt.actorId && source.siteId === site.id && source.shopId === null, '原公共岗位工资来源');
    number(source.startAt, receipt.at); number(source.endAt, receipt.at, source.startAt); number(source.minutes, 480, Number.MIN_VALUE); number(source.amount, 1e9, Number.MIN_VALUE); number(source.ratePerMinute, 1e6, Number.MIN_VALUE);
    close(source.endAt - source.startAt, source.minutes); close(source.amount, source.minutes * source.ratePerMinute); need(receipt.startAt >= source.startAt && receipt.endAt <= source.endAt, '仅消费当前原生工资区间');
    worked += receipt.minutes; earned += receipt.minutes * source.ratePerMinute; end = receipt.endAt;
  }
  close(job.workedMinutes, worked); need(job.workedMinutes <= now - job.startedAt + EPS && job.lastObservedAt >= observedAt, '不补历史或未来工时，保留最后现场观察');
  if (job.laborCompletedAt !== null) { number(job.laborCompletedAt, now, end); need(job.workedMinutes === 60 && job.consumedUnits === 1 && job.reservedUnits === 0 && job.laborCompletedAt === observedAt, '完整劳动后才耗材料'); }
  else need(job.workedMinutes < 60 && job.consumedUnits === 0, '完成劳动时刻不得删除');
  if (job.payment !== null) {
    const payment = job.payment; data(payment, PAYMENT_KEYS); need(payment.citizenId === job.technicianId && payment.shopId === null && job.laborCompletedAt !== null, '完整原公共工资付款对象');
    number(payment.amount, 1e12, Number.MIN_VALUE); number(payment.requestedAmount, 1e12, Number.MIN_VALUE); need(payment.amount === payment.requestedAmount, '部分工资付款不得结清维护');
    number(payment.net, payment.amount); number(payment.tax, payment.amount); close(payment.net + payment.tax, payment.amount); number(payment.at, now, job.laborCompletedAt); integer(payment.tick, state.tick, priorTick); number(payment.settledThroughAt, payment.at, end); need(payment.amount + EPS >= earned, '真实整额付款须覆盖本合同已赚工资');
  }
  if (job.completedAt !== null) {
    number(job.completedAt, now, job.payment?.at ?? now + 1); need(job.status === 'completed' && job.payment !== null && job.laborCompletedAt !== null && job.cancelledAt === null && job.escrow === 0 && job.refunded === 0, '完成必须保留材料劳动及工资实付');
    integer(job.completedTick, state.tick, job.payment.tick);
    close(job.serviceFees, 100 - job.purchasePaid);
  } else need(job.status !== 'completed' && job.serviceFees === 0 && job.completedTick === null, '未完成不得赚维修服务费或登记完成相位');
  if (job.cancelledAt !== null) {
    number(job.cancelledAt, now, job.startedAt); need(['cancelled', 'refundPending'].includes(job.status) && job.completedAt === null && job.reservedUnits === 0, '取消保留有限物料及债权');
    need(job.returnedUnits === job.receivedUnits - job.consumedUnits && (job.status === 'refundPending') === (job.escrow > 0), '原额退款或保留退款债权');
  } else need(!['cancelled', 'refundPending'].includes(job.status) && job.refunded === 0 && job.returnedUnits === 0, '原未结束权利');
  if (job.status === 'awaitingSupply') need(job.receivedUnits === 0 && job.workedMinutes === 0, '缺材料不劳动');
  if (job.status === 'awaitingWageSettlement') need(job.laborCompletedAt !== null && job.completedAt === null && job.cancelledAt === null, '完整劳动等候工资实付');
  if (job.laborCompletedAt !== null && job.cancelledAt === null && job.completedAt === null) need(job.status === 'awaitingWageSettlement', '未实付不得提前投运');
}

export function hydroMaintenanceActivityClaims(state: SimState): ActorActivityClaim[] {
  const job = state.hydroMaintenance?.job; return (job?.laborReceipts ?? []).map((receipt, index) => ({ id: 'hydro-maintenance:' + job!.id + ':' + receipt.actorId + ':' + index, actorId: receipt.actorId, startedAt: receipt.startAt, endedAt: receipt.endAt, workedMinutes: receipt.minutes }));
}

export function hydroMaintenanceTaskActorIds(state: SimState): ReadonlySet<string> {
  const job = state.hydroMaintenance?.job;
  return new Set(job && !stopped(job) && job.status !== 'awaitingWageSettlement' && job.technicianId ? [job.technicianId] : []);
}
export function hydroMaintenanceTaskPoint(state: SimState, citizenId: string, siteId: string): PowerControlPoint | null {
  const body = state.hydroMaintenance, job = body?.job;
  return body?.operatorSiteId === siteId && job && !stopped(job) && job.status !== 'awaitingWageSettlement' && job.technicianId === citizenId ? job.point : null;
}

/** Cold history selector: completing in the people/finance phase cannot power
 * that tick's earlier energy window. Undeclared domains are selected by host. */
export function hydroMaintenanceReadyAt(state: SimState, at: number, tick = state.tick): boolean {
  const job = state.hydroMaintenance?.job;
  return finite(at) && Number.isSafeInteger(tick) && tick >= 0 && !!job && job.status === 'completed' && job.completedAt !== null && job.completedAt < at && job.completedTick !== null && job.completedTick < tick && job.payment !== null && job.payment.tick < tick;
}
interface Capability { sim: Simulation; owner: SimState; body: HydroMaintenanceState; job: HydroMaintenanceJob | null; completedAt: number | null; completedTick: number | null; journal: string }
const capabilities = new WeakMap<HydroMaintenanceState, Capability>();
/** Check descriptors before JSON reads: an accessor or toJSON function cannot
 * counterfeit the private progress journal or run while it is compared. */
function progressJournal(body: HydroMaintenanceState): string {
  const pending: { value: unknown; depth: number }[] = [{ value: body, depth: 0 }]; let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    need(++count <= 131072 && depth <= 16, '有界完整进度见证');
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') { need(Number.isFinite(value), '进度有限数值'); continue; }
    if (typeof value === 'string') { need(value.length <= 512, '进度有界文本'); continue; }
    need(typeof value === 'object', '进度仅数据字段');
    const isArray = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    need(isArray ? prototype === Array.prototype && value.length <= MAX_LABOR_RECEIPTS : prototype === Object.prototype || prototype === null, '进度数据原型');
    const keys = Reflect.ownKeys(value);
    if (isArray) need(keys.length === value.length + 1, '进度数组完整');
    for (const key of keys) {
      if (isArray && key === 'length') continue;
      need(typeof key === 'string' && key.length <= 120, '进度完整键');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      need(descriptor && 'value' in descriptor && descriptor.enumerable, '进度不接受访问器');
      pending.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
  return JSON.stringify(body);
}
function freezeCompleted(body: HydroMaintenanceState): void {
  if (body.job?.status !== 'completed') return;
  const pending: unknown[] = [body], seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop();
    if (value !== null && typeof value === 'object' && !seen.has(value)) { seen.add(value); pending.push(...Object.values(value)); Object.freeze(value); }
  }
}
function bind(sim: Simulation): void {
  const body = sim.state.hydroMaintenance!; freezeCompleted(body);
  capabilities.set(body, { sim, owner: sim.state, body, job: body.job, completedAt: body.job?.completedAt ?? null, completedTick: body.job?.completedTick ?? null, journal: progressJournal(body) });
}
export function isCanonicalHydroMaintenanceState(state: SimState): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(state, 'hydroMaintenance');
  const body = descriptor && 'value' in descriptor ? descriptor.value as HydroMaintenanceState | undefined : undefined;
  const capability = body && capabilities.get(body);
  if (!body || !capability || capability.owner !== state || capability.sim.state !== state || capability.body !== body) return false;
  const jobDescriptor = Object.getOwnPropertyDescriptor(body, 'job');
  if (!jobDescriptor || !('value' in jobDescriptor) || jobDescriptor.value !== capability.job) return false;
  const job = jobDescriptor.value as HydroMaintenanceJob | null;
  if (job !== null) {
    for (const field of ['completedAt', 'completedTick']) {
      const completion = Object.getOwnPropertyDescriptor(job, field);
      if (!completion || !('value' in completion)) return false;
    }
  }
  if ((job?.completedAt ?? null) !== capability.completedAt || (job?.completedTick ?? null) !== capability.completedTick) return false;
  if (capability.completedAt !== null && Object.isFrozen(body) && Object.isFrozen(job)) return true;
  try { return progressJournal(body) === capability.journal; } catch { return false; }
}
function recordProgress(sim: Simulation): void {
  const body = sim.state.hydroMaintenance!, capability = capabilities.get(body);
  need(capability && capability.sim === sim && capability.owner === sim.state && capability.body === body, '不能由generic或foreign进度重新铸造来源');
  capability.job = body.job; capability.completedAt = body.job?.completedAt ?? null; capability.completedTick = body.job?.completedTick ?? null; capability.journal = progressJournal(body);
}
function writeProgress<T>(sim: Simulation, operation: () => T): T {
  need(isCanonicalHydroMaintenanceState(sim.state), '当前维护进度不是原owner完整私有见证');
  const body = sim.state.hydroMaintenance!;
  const result = operation();
  need(sim.state.hydroMaintenance === body, '原writer不得接纳被替换的generic进度'); recordProgress(sim);
  return result;
}
export function isCanonicalHydroMaintenanceReady(state: SimState, at: number, tick = state.tick): boolean {
  if (!isCanonicalHydroMaintenanceState(state)) return false;
  const body = state.hydroMaintenance, capability = body && capabilities.get(body);
  return !!body && !!capability && Object.isFrozen(body) && body.job !== null && Object.isFrozen(body.job) && capability.completedAt !== null && hydroMaintenanceReadyAt(state, at, tick);
}

function ledger(sim: Simulation, amount: number, purpose: string, account: 'household' | 'public'): void {
  const extension = sim.state.extension!, site = sim.worldDefinition.buildings.find(row => row.id === sim.state.hydroMaintenance!.operatorSiteId)!;
  extension.publicLedger.push({ tick: sim.state.tick, actorId: 'player', amount, purpose, account, districtId: site.districtId });
  if (extension.publicLedger.length > 512) extension.publicLedger.splice(0, extension.publicLedger.length - 512);
  if (account === 'public') Reflect.get(extension, 'runtime').lastTreasury += amount;
}
function purchase(sim: Simulation, job: HydroMaintenanceJob): void {
  if (stopped(job) || job.receivedUnits === 1) return;
  const site = sim.worldDefinition.buildings.find(row => row.id === sim.state.hydroMaintenance!.operatorSiteId)!;
  const offers = sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory >= 1).map(shop => ({ shop, quote: sim.quoteSupply(shop.id, 1) })).filter(row => finite(row.quote.unitPrice) && row.quote.unitPrice >= 4 && row.quote.quantity >= 1 && row.quote.unitPrice <= job.escrow && sim.shopFunds(row.shop) + row.quote.unitPrice * (1 - sim.state.taxRate) <= 1e9).sort((a, b) => Number(b.shop.districtId === site.districtId) - Number(a.shop.districtId === site.districtId) || a.quote.unitPrice - b.quote.unitPrice || a.shop.id.localeCompare(b.shop.id));
  const offer = offers[0]; if (!offer) { job.status = 'awaitingSupply'; job.reason = '等候真实一份工业材料及可支付报价；没有补库存或现金。'; return; }
  const gross = offer.quote.unitPrice, tax = gross * sim.state.taxRate, net = gross - tax;
  offer.shop.inventory--; sim.transferShopFunds(offer.shop, net); offer.shop.revenue += gross; offer.shop.profit += net;
  job.escrow -= gross; job.purchasePaid = gross; job.receivedUnits = 1; job.reservedUnits = 1;
  job.receipts.push({ purchasedAt: clock(sim.state), tick: sim.state.tick, shopId: offer.shop.id, quantity: 1, unitPrice: gross, gross, net, tax, taxRate: sim.state.taxRate });
  job.status = 'paused'; job.reason = '材料已真实预约；等候原能源岗位技术员现场履约。';
  recordProgress(sim);
  sim.emitEvent({ type: 'wholesale', shopId: offer.shop.id, districtId: offer.shop.districtId, amount: gross, quantity: 1, unitPrice: gross, siteId: site.id, procurementId: job.id, purpose: 'hydro-maintenance' });
  need(isCanonicalHydroMaintenanceState(sim.state), '采购事件不得改写原维护进度');
}
function cancel(sim: Simulation, job: HydroMaintenanceJob): void {
  if (job.status === 'completed' || job.status === 'cancelled') return;
  if (job.cancelledAt === null) { job.cancelledAt = clock(sim.state); job.returnedUnits += job.reservedUnits; job.reservedUnits = 0; }
  const amount = Math.min(job.escrow, Math.max(0, 1e9 - sim.state.player.money));
  if (amount > 0) { sim.state.player.money += amount; job.escrow -= amount; job.refunded += amount; ledger(sim, amount, '有限水电未赚维护托管款退款', 'household'); }
  job.status = job.escrow > 0 ? 'refundPending' : 'cancelled'; job.reason = '维护停止，已购未耗材料保留；已赚工资债权不撤销，设备仍未投运。';
}
function finish(sim: Simulation, job: HydroMaintenanceJob): void {
  if (job.status !== 'awaitingWageSettlement' || !job.payment || sim.state.treasury + job.escrow > 1e12) return;
  const fee = job.escrow; sim.state.treasury += fee; job.serviceFees += fee; job.escrow = 0;
  ledger(sim, fee, '有限水电材料劳动及工资实付完成维护服务费', 'public');
  job.status = 'completed'; job.completedAt = clock(sim.state); job.completedTick = sim.state.tick; job.reason = '一份材料、60实际现场分钟和原工资整额实付已结清；下一能源窗恢复原有限机组。';
  bind(sim); sim.appendNotice('hydro-maintained', job.reason);
}

export function installHydroMaintenance(sim: Simulation): void {
  validateHydroMaintenanceDefinition(sim.worldDefinition);
  // Even a world without an energy grid must reject a smuggled maintenance
  // domain; registering this read-only validator adds no saved field or hook.
  sim.registerSaveValidator(candidate => validateHydroMaintenanceState(candidate, sim.worldDefinition));
  const definition = sim.worldDefinition.hydroMaintenance; if (!definition) return;
  need(sim.state.tick === 0 && clock(sim.state) === 480 && sim.state.hydroMaintenance === undefined, '只在可信新城初始声明故障');
  sim.state.hydroMaintenance = { version: 1, kind: definition.kind, sourceId: definition.sourceId, operatorSiteId: definition.operatorSiteId, activatedAt: 480, job: null }; bind(sim);
  let observed = sim.state, phaseTick = -1, phaseAt = -1;
  const wages = new Map<string, { startAt: number; endAt: number; minutes: number; amount: number; ratePerMinute: number }>();
  sim.onPhase('time', () => { observed = sim.state; phaseTick = sim.state.tick; phaseAt = clock(sim.state); wages.clear(); });
  sim.onEvent('wage-earned', event => {
    if (observed !== sim.state || phaseTick !== sim.state.tick || phaseAt !== clock(sim.state) || !isCanonicalNpcWage(event, sim) || !event.citizenId || event.citizenId === 'player' || event.siteId !== definition.operatorSiteId || event.shopId !== undefined || !finite(event.minutes) || event.minutes <= 0 || !finite(event.amount) || event.amount <= 0 || !finite(event.ratePerMinute) || event.ratePerMinute <= 0 || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt) || event.creditedWorkEndAt > phaseAt || Math.abs(event.creditedWorkEndAt - event.creditedWorkStartAt - event.minutes) > EPS || Math.abs(event.amount - event.minutes * event.ratePerMinute) > EPS) return;
    need(isCanonicalHydroMaintenanceState(sim.state), '原工资来源不得接纳被改写的维护进度');
    wages.set(event.citizenId, { startAt: event.creditedWorkStartAt, endAt: event.creditedWorkEndAt, minutes: event.minutes, amount: event.amount, ratePerMinute: event.ratePerMinute });
  });
  sim.onPhase('people', (state, minutes) => writeProgress(sim, () => {
    need(state === sim.state, '劳动相位必须属于当前原owner');
    const job = state.hydroMaintenance!.job; if (!job || stopped(job) || job.status === 'awaitingWageSettlement') return;
    const elapsed = Math.min(minutes, Math.max(0, clock(state) - job.lastObservedAt)); job.lastObservedAt = clock(state);
    if (!state.extension!.actorProfiles.player.alive) { cancel(sim, job); return; }
    if (job.reservedUnits !== 1 || elapsed <= 0 || job.laborReceipts.length >= MAX_LABOR_RECEIPTS) return;
    const site = sim.worldDefinition.buildings.find(row => row.id === definition.operatorSiteId)!;
    const actors = state.citizens.filter(actor => (!job.technicianId || actor.id === job.technicianId) && actor.workId === site.id && ROLES.includes(actor.role));
    for (const actor of actors) {
      const profile = state.extension!.actorProfiles[actor.id], wage = wages.get(actor.id);
      if (!wage || !profile?.alive || profile.age < 18 || profile.health <= 0 || actor.state !== 'working' || actor.needs.hunger < 12 || actor.needs.fatigue < 15) continue;
      const point = job.point ?? powerControlPointAt(sim, site, actor); if (!point || !powerControlBodyAt(sim, site, point, actor)) continue;
      const lower = Math.max(job.startedAt, clock(state) - elapsed, wage.startAt), upper = Math.min(clock(state), wage.endAt);
      if (upper <= lower) continue;
      const claimed = claimFundedActorWork(sim, actor.id, job.id, [{ startAt: lower, endAt: upper }], Math.min(upper - lower, 60 - job.workedMinutes), minutes);
      if (claimed.minutes <= 0) continue;
      need(job.laborReceipts.length + claimed.intervals.length <= MAX_LABOR_RECEIPTS, '完整劳动记录容量先于新增分钟');
      job.technicianId = actor.id; job.point = copyPoint(point);
      for (const interval of claimed.intervals) job.laborReceipts.push({ actorId: actor.id, siteId: site.id, role: actor.role, tick: state.tick, at: clock(state), phaseMinutes: minutes, startAt: interval.startAt, endAt: interval.endAt, minutes: interval.endAt - interval.startAt, position: { ...actor.position }, point: copyPoint(point), age: profile.age, health: profile.health, hunger: actor.needs.hunger, fatigue: actor.needs.fatigue, source: { citizenId: actor.id, siteId: site.id, shopId: null, ...wage } });
      job.workedMinutes += claimed.minutes; job.status = 'working'; job.reason = '原能源岗位技术员仅消费当前有来源且身体在场的工资区间。';
      if (job.workedMinutes >= 60 - EPS) { job.workedMinutes = 60; job.reservedUnits = 0; job.consumedUnits = 1; job.laborCompletedAt = clock(state); job.status = 'awaitingWageSettlement'; job.reason = '60现场分钟已完成；原NPC工资仍须实际整额结清，设备继续停机。'; }
      return;
    }
    job.status = 'paused'; job.reason = '本相位缺少原技术员当前工资来源、身体或共同活动余额；不补历史分钟。';
  }));
  sim.onEvent('wage-paid', event => {
    const receipt = getCanonicalNpcFullSettlement(event, sim); if (!receipt) return;
    writeProgress(sim, () => {
    const job = sim.state.hydroMaintenance!.job; if (!job || job.status !== 'awaitingWageSettlement' || job.payment) return;
    const earned = job.laborReceipts.reduce((sum, row) => sum + row.minutes * row.source.ratePerMinute, 0), last = Math.max(...job.laborReceipts.map(row => row.endAt));
    if (!receipt || receipt.citizenId !== job.technicianId || receipt.shopId !== null || receipt.amount !== receipt.requestedAmount || receipt.amount <= 0 || receipt.amount + EPS < earned || receipt.at < job.laborCompletedAt! || receipt.settledThroughAt < last) return;
    job.payment = { citizenId: receipt.citizenId, shopId: null, amount: receipt.amount, requestedAmount: receipt.requestedAmount, net: receipt.net, tax: receipt.tax, at: receipt.at, tick: receipt.tick, settledThroughAt: receipt.settledThroughAt }; finish(sim, job);
    });
  });
  sim.onPhase('finance', () => writeProgress(sim, () => {
    const job = sim.state.hydroMaintenance!.job; if (!job) return;
    if (job.status === 'refundPending') { cancel(sim, job); return; }
    if (job.status === 'awaitingWageSettlement') { finish(sim, job); return; }
    if (!stopped(job) && clock(sim.state) >= job.retryAt) { job.retryAt = clock(sim.state) + 60; purchase(sim, job); }
  }));
  sim.registerCommandHandler(command => {
    if (!['requestEnergyRepair', 'cancelEnergy'].includes(command.type)) return null;
    return writeProgress(sim, () => {
    const state = sim.state, body = state.hydroMaintenance!, site = sim.worldDefinition.buildings.find(row => row.id === definition.operatorSiteId)!;
    if (command.type === 'cancelEnergy') {
      if (!body.job || body.job.status === 'completed' || body.job.status === 'cancelled' || command.targetId && command.targetId !== body.job.id) return { ok: false, message: '没有该未结清单次水电维护。' };
      cancel(sim, body.job); return { ok: true, message: body.job.reason };
    }
    const player = state.player, profile = state.extension!.actorProfiles.player;
    const floor = Math.floor((player.position.y - site.position.y + .01) / (site.height / site.floors));
    if (command.targetId && command.targetId !== site.id || !sim.isNearBuilding(site, player.position, 2) || !canAccessFloor(site, floor, player) || !sim.isAtBuildingFunctionPoint(site) || player.vehicleId || state.aviation?.activeAircraftId || !profile?.alive || profile.age < 18) return { ok: false, message: '请由成年付款人在原能源设施合法现场提出维护；旅行者只出资，不取得操作身份。' };
    if (body.job) return { ok: false, message: '初始故障只有一个保留完整权利的维护合同，不能重复收费。' };
    if (player.money < 100) return { ok: false, message: '100文真实维护托管不足，未收费。' };
    const now = clock(state);
    const job: HydroMaintenanceJob = { id: 'hydro-maintenance-1', payerId: 'player', startedAt: now, startedTick: state.tick, lastObservedAt: now, status: 'awaitingSupply', reason: '100文实际托管；仍等候真实材料、原工程师现场劳动及工资实付。', technicianId: null, point: null, requiredMinutes: 60, workedMinutes: 0, funded: 100, escrow: 100, purchasePaid: 0, serviceFees: 0, refunded: 0, receivedUnits: 0, reservedUnits: 0, consumedUnits: 0, returnedUnits: 0, receipts: [], laborReceipts: [], payment: null, laborCompletedAt: null, completedAt: null, completedTick: null, cancelledAt: null, retryAt: now };
    player.money -= 100; body.job = job; ledger(sim, -100, '有限水电维护真实托管划入', 'household'); recordProgress(sim); purchase(sim, job);
    return { ok: true, message: job.reason } satisfies CommandResult;
    });
  });
  sim.onLoad(() => { validateHydroMaintenanceState(sim.state, sim.worldDefinition); observed = sim.state; phaseTick = -1; phaseAt = -1; wages.clear(); bind(sim); });
}
