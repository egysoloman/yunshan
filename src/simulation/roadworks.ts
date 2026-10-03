import type { Simulation } from '../simulation';
import type { Building, BuildingFunctionPoint, Citizen, CommandResult, Role, SimState, Vec3, WorldDefinition } from '../types';
import { roadClosure, roadClosureById, completeRoadRepair } from '../roads';
import { FLOOR_PLAN_PROFILE, getBuildingUsePoints } from '../architecture-floor-plan';
import { canAccessFloor } from '../access';
import { getWalkHeight } from '../world';
import { homeRestPointBlockedByVoxels } from './home-rest';
import { claimActorActivityMinutes } from './activity-minutes';
import { roadRepairDemand, residentRoadRepairRequester } from './road-demands';
import { validateJointActorActivityCapacity, type ActorActivityClaim } from './activity-capacity';

const EPS = 1e-7, REQUIRED_MINUTES = 60, MATERIALS = 1, PLAYER_FUNDS = 100, MAX_JOBS = 128, MAX_LABOR_RECEIPTS = 256, MAX_MODULE_BYTES = 768 * 1024, NEW_ORDER_BYTES = 512 * 1024;
export interface RoadBudgetEscrowRequest { budgetId: string; siteId: string; purpose: 'road-repair'; amount: number }
export interface RoadworksAccounting {
  activate(): void;
  isCanonicalRoadworkPresence(event: object): boolean;
  travelCost(citizenId: string, nodeId: string, point: Vec3): number;
  takePublicEscrow(request: RoadBudgetEscrowRequest): boolean;
  returnPublicEscrow(request: RoadBudgetEscrowRequest): number;
  accrueTax(amount: number): void;
}
export interface RoadworksController { requestResidentDemand(demandId: string): string | null }
export interface RoadworkTask { jobId: string; nodeId: string; point: Vec3; stage: 'pickup' | 'worksite'; acceptedAt: number; buildingId?: string }
export interface RoadMaterialReceipt { at: number; shopId: string; workerId: string; nodeId: string; point: Vec3; quantity: 1; unitPrice: number; gross: number; net: number; tax: number; taxRate: number }
export interface RoadLaborReceipt { at: number; firstTick: number; lastTick: number; paymentCount: number; actorId: string; startAt: number; endAt: number; minutes: number; ratePerMinute: number; taxRate: number; gross: number; net: number; tax: number; nodeId: string; point: Vec3 }
export interface RoadMaterialLot {
  id: string; jobId: string; ownerId: 'player' | 'public'; quantity: number; retained: boolean;
  location: { kind: 'carried'; actorId: string } | { kind: 'worksite'; nodeId: string; point: Vec3 } | { kind: 'ground'; point: Vec3 } | { kind: 'consumed'; nodeId: string; point: Vec3 };
}
export interface RoadWorkerContract { actorId: string; at: number; role: string; craft: number; age: number; health: number; hunger: number; fatigue: number; districtId: string; prosperity: number; ratePerMinute: number }
export interface RoadContribution { startedAt: number; endedAt: number; workedMinutes: number; gross: number; net: number; tax: number }
export interface RoadRepairJob {
  id: string; closureId: string; edgeId: string; requestedBy: string; payerId: 'player' | 'public';
  worksiteNodeId: string; worksite: Vec3; startedAt: number; lastObservedAt: number;
  status: 'awaitingBudget' | 'awaitingSupply' | 'awaitingWorker' | 'carrying' | 'working' | 'paused' | 'refundPending' | 'completed' | 'cancelled'; reason: string;
  workerId: string | null; acceptedAt: number | null; ratePerMinute: number; contract: RoadWorkerContract | null;
  supplierShopId: string | null; supplierNodeId: string | null; supplierPoint: Vec3 | null;
  requiredMinutes: 60; workedMinutes: number; contributions: Record<string, RoadContribution>; laborReceipts: RoadLaborReceipt[];
  funded: number; escrow: number; purchasePaid: number; paidGross: number; paidNet: number; paidTax: number; refunded: number; serviceFees: 0;
  receipts: RoadMaterialReceipt[]; receivedUnits: number; reservedUnits: number; consumedUnits: number;
  budgetId: string | null; approvalSiteId: string | null; approvedAt: number | null; approvedBy: string[]; authorizedCap: number;
  completedAt: number | null; cancelledAt: number | null;
}
export interface RoadworksState { version: 1; activatedAt: number; nextId: number; jobs: RoadRepairJob[]; stock: RoadMaterialLot[]; capacityHistory: ActorActivityClaim[] }
type State = SimState & { roadworks?: RoadworksState };
interface Presence { citizenId?: string; laborJobId?: string; nodeId?: string; activityWindowStartAt?: number; activityWindowEndAt?: number; activityObservedTick?: number; activityObservedClock?: number; activityPosition?: Vec3 }
const body = (state: SimState) => (state as State).roadworks;
const clock = (state: SimState) => state.extension!.lastUpdate;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (p: Vec3): Vec3 => ({ ...p });
const ended = (job: RoadRepairJob) => job.status === 'completed' || job.status === 'cancelled';
const identity = (actor: Citizen): { role: Role; identities: Role[] } => { const role: Role = actor.role === '工程师' ? 'scientist' : 'traveler'; return { role, identities: [role] }; };
function capable(state: SimState, actor: Citizen): boolean {
  const profile = state.extension!.actorProfiles[actor.id];
  return !!profile?.alive && profile.age >= 18 && profile.health >= 45 && ['工人', '工程师'].includes(actor.role)
    && (actor.skills?.craft ?? 0) >= 20 && actor.needs.hunger >= 40 && actor.needs.fatigue >= 35;
}
/** V4 uses the authoritative declared/provider point set. Truly unmarked
 * saved worlds retain their existing actual door/proximity sale contract;
 * lack of a v4 body is not lack of an industrial supplier. */
function supplierPoints(site: Building): BuildingFunctionPoint[] {
  const points = site.functionPoints ?? Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
  if (points.length || site.floorPlanProfile === FLOOR_PLAN_PROFILE) return points;
  return [{ id: 'legacy-road-material-sale-door', purpose: 'sale', floor: 0, position: copy(site.door) }];
}
function floor(site: Building, p: Vec3) { return Math.floor((p.y - site.position.y + .01) / (site.height / site.floors)); }
function footClear(sim: Simulation, p: Vec3): boolean {
  return Math.abs(getWalkHeight(sim.worldDefinition, p.x, p.z, p.y) - p.y) <= .26 && !homeRestPointBlockedByVoxels(p, sim.state.voxels);
}
function atSupplier(sim: Simulation, job: RoadRepairJob, actor: Citizen): boolean {
  const shop = sim.state.shops.find(shop => shop.id === job.supplierShopId), site = shop && sim.worldDefinition.buildings.find(site => site.id === shop.buildingId);
  return !!site && !!job.supplierPoint && distance(actor.position, job.supplierPoint) <= 2 && sim.isNearBuilding(site, actor.position, 2)
    && canAccessFloor(site, floor(site, actor.position), identity(actor)) && sim.isAtBuildingFunctionPoint(site, actor.position, 'sale', identity(actor))
    && footClear(sim, actor.position) && footClear(sim, job.supplierPoint);
}
function ledger(sim: Simulation, actorId: string, amount: number, purpose: string, districtId: string, account: 'household' | 'company' = 'household'): void {
  const rows = sim.state.extension!.publicLedger;
  rows.push({ tick: sim.state.tick, actorId, amount, purpose, account, districtId });
  if (rows.length > 512) rows.splice(0, rows.length - 512);
}
function activate(sim: Simulation, accounting: RoadworksAccounting): RoadworksState {
  const state = sim.state as State;
  if (!state.roadworks) { state.roadworks = { version: 1, activatedAt: clock(state), nextId: 1, jobs: [], stock: [], capacityHistory: [] }; accounting.activate(); }
  return state.roadworks;
}
function lot(state: SimState, job: RoadRepairJob): RoadMaterialLot | undefined { return body(state)?.stock.find(item => item.jobId === job.id); }
function authorize(sim: Simulation, job: RoadRepairJob, ids: string[], cap: number, accounting: RoadworksAccounting): boolean {
  if (job.payerId !== 'public' || job.budgetId || ended(job) || job.cancelledAt !== null || !finite(cap) || cap <= 0 || cap > 1e6) return false;
  const site = sim.worldDefinition.buildings.find(site => ['hall', 'core', 'bank'].includes(site.kind)
    && ids.every(id => id === 'player' ? sim.isNearBuilding(site) : sim.state.citizens.find(actor => actor.id === id)?.workId === site.id));
  if (!site) return false;
  const now = clock(sim.state);
  if (!sim.authorizePublicBudget({ id: job.id, siteId: site.id, purpose: 'road-repair', cap, approvedAt: now, approvedBy: ids })) return false;
  // The approved budget protects this promise; if treasury cannot actually
  // fund it, preserve that authorization and retry without inventing cash.
  job.budgetId = job.id; job.approvalSiteId = site.id; job.approvedAt = now; job.approvedBy = [...ids]; job.authorizedCap = cap;
  if (accounting.takePublicEscrow({ budgetId: job.id, siteId: site.id, purpose: 'road-repair', amount: cap })) { job.funded = cap; job.escrow = cap; job.status = 'awaitingWorker'; }
  else { job.status = 'awaitingBudget'; job.reason = '合法预算已记录，但保护旧工资和必要运营后尚无可划入现金。'; }
  return true;
}
// No primary job, identity, education, needs, wallet or position is rewritten.
function acceptWorker(sim: Simulation, job: RoadRepairJob, accounting: RoadworksAccounting): void {
  if (job.workerId || !(job.escrow > 0) || job.cancelledAt !== null || ended(job)) return;
  const candidates = sim.state.citizens.filter(actor => capable(sim.state, actor) && actor.money < 450 && sim.state.extension!.actorProfiles[actor.id].stress < 75
    && !body(sim.state)!.jobs.some(other => !ended(other) && other.workerId === actor.id));
  let best: { actor: Citizen; shopId: string; nodeId: string; point: Vec3; cost: number; rate: number } | undefined;
  for (const actor of candidates) {
    const district = sim.state.districts.find(d => d.id === actor.districtId)!;
    const rate = 32 * (.7 + district.prosperity / 100) / 480;
    if (!finite(rate) || rate <= 0 || rate * REQUIRED_MINUTES >= job.escrow) continue;
    if (!finite(accounting.travelCost(actor.id, job.worksiteNodeId, job.worksite))) continue;
    for (const shop of sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory >= MATERIALS)) {
      const site = sim.worldDefinition.buildings.find(site => site.id === shop.buildingId)!;
      const quote = sim.quoteSupply(shop.id, MATERIALS), gross = quote.unitPrice;
      if (quote.quantity < MATERIALS || gross + REQUIRED_MINUTES * rate > job.escrow + EPS || sim.shopFunds(shop) + gross * (1 - sim.state.taxRate) > 1e9) continue;
      const node = [...sim.worldDefinition.nodes].sort((a,b) => distance(a.position, site.door) - distance(b.position, site.door) || a.id.localeCompare(b.id))[0];
      const points = supplierPoints(site);
      for (const point of points.filter(point => point.purpose === 'sale' && canAccessFloor(site, point.floor, identity(actor)))) {
        const cost = accounting.travelCost(actor.id, node.id, point.position);
        if (!finite(cost) || !footClear(sim, point.position) || !sim.isAtBuildingFunctionPoint(site, point.position, 'sale', identity(actor))) continue;
        if (!best || cost < best.cost) best = { actor, shopId: shop.id, nodeId: node.id, point: copy(point.position), cost, rate };
      }
    }
  }
  if (!best) { job.status = 'awaitingWorker'; job.reason = '等候自愿、身体和技能合格且可真实到供应商及工地的原居民；没有派生新工人。'; return; }
  job.workerId = best.actor.id; job.acceptedAt = clock(sim.state); job.ratePerMinute = best.rate;
  const p = sim.state.extension!.actorProfiles[best.actor.id], district = sim.state.districts.find(d => d.id === best.actor.districtId)!;
  job.contract = { actorId: best.actor.id, at: job.acceptedAt, role: best.actor.role, craft: best.actor.skills!.craft, age: p.age, health: p.health, hunger: best.actor.needs.hunger, fatigue: best.actor.needs.fatigue, districtId: best.actor.districtId, prosperity: district.prosperity, ratePerMinute: best.rate };
  job.supplierShopId = best.shopId; job.supplierNodeId = best.nodeId; job.supplierPoint = best.point;
  job.status = 'awaitingSupply'; job.reason = '具名工人接受真实工资合同，须先沿路到供应商合法售点领取原库存。';
  sim.emitEvent({ type: 'roadwork-accepted', citizenId: best.actor.id, laborJobId: job.id, amount: REQUIRED_MINUTES * best.rate, minutes: REQUIRED_MINUTES, ratePerMinute: best.rate });
}
export function roadworkTask(sim: Simulation, citizenId: string): RoadworkTask | null {
  const actor = sim.state.citizens.find(actor => actor.id === citizenId);
  if (!actor || !capable(sim.state, actor)) return null;
  const job = body(sim.state)?.jobs.find(job => !ended(job) && job.cancelledAt === null && job.workerId === citizenId && job.workedMinutes < REQUIRED_MINUTES);
  if (!job || job.status === 'refundPending' || job.escrow <= 0) return null;
  const material = lot(sim.state, job);
  if (!material) {
    const shop = sim.state.shops.find(shop => shop.id === job.supplierShopId);
    return shop && job.supplierNodeId && job.supplierPoint ? { jobId: job.id, nodeId: job.supplierNodeId, point: copy(job.supplierPoint), stage: 'pickup', acceptedAt: job.acceptedAt!, buildingId: shop.buildingId } : null;
  }
  return material.quantity >= MATERIALS && !material.retained ? { jobId: job.id, nodeId: job.worksiteNodeId, point: copy(job.worksite), stage: 'worksite', acceptedAt: job.acceptedAt! } : null;
}
function dropMaterial(sim: Simulation, job: RoadRepairJob): void {
  const material = lot(sim.state, job); if (!material || material.quantity === 0 || material.retained) return;
  if (material.location.kind === 'carried') {
    const carrierId = material.location.actorId;
    const actor = sim.state.citizens.find(actor => actor.id === carrierId)!;
    material.location = { kind: 'ground', point: copy(actor.position) };
  }
  material.retained = true; job.reservedUnits = 0;
}
function refund(sim: Simulation, job: RoadRepairJob, accounting: RoadworksAccounting): boolean {
  if (job.escrow <= EPS) { job.escrow = 0; return true; }
  let returned = 0;
  if (job.payerId === 'player') {
    returned = Math.min(job.escrow, Math.max(0, 1e9 - sim.state.player.money));
    sim.state.player.money += returned;
    if (returned > 0) ledger(sim, 'player', returned, '道路维修未购未赚托管退还', roadClosureById(sim.state, job.closureId)!.districtId);
  } else if (job.budgetId && job.approvalSiteId) returned = accounting.returnPublicEscrow({ budgetId: job.budgetId, siteId: job.approvalSiteId, purpose: 'road-repair', amount: job.escrow });
  job.escrow -= returned; job.refunded += returned;
  return job.escrow <= EPS;
}
function settle(sim: Simulation, job: RoadRepairJob, accounting: RoadworksAccounting): void {
  const finished = job.cancelledAt === null && job.workedMinutes === REQUIRED_MINUTES && job.consumedUnits === MATERIALS;
  if (finished && job.completedAt === null) job.completedAt = clock(sim.state);
  const refunded = refund(sim, job, accounting);
  job.status = refunded ? job.cancelledAt !== null ? 'cancelled' : 'completed' : 'refundPending';
  // An actual completed physical recipe reopens the road even when the payer's
  // cash cap leaves its unearned remainder in escrow. Cancellation never does.
  if (finished) {
    const closure = roadClosureById(sim.state, job.closureId)!;
    if (closure.reopenedAt === null && !completeRoadRepair(sim, job.closureId, job.id)) throw new Error('真实道路维修配方完成后，道路闭锁引用拒绝重开。');
  }
  if (!refunded) { job.reason = '实际资金仍留托管等合法退还；已履约道路可通行，取消项目仍关闭。'; return; }
  if (job.budgetId) sim.closePublicBudget(job.budgetId);
  if (job.cancelledAt !== null) return;
  job.reason = '原材料已到场耗用，60真实已付薪工地分钟已完成，原道路重新通行。';
}
function cancel(sim: Simulation, job: RoadRepairJob, accounting: RoadworksAccounting): void {
  if (job.cancelledAt === null) { job.cancelledAt = clock(sim.state); dropMaterial(sim, job); }
  job.reason = '施工停止；旧工资不撤销，已买物料保留在实际落点，未赚托管退还原付款方。'; settle(sim, job, accounting);
}
function purchase(sim: Simulation, job: RoadRepairJob, actor: Citizen, accounting: RoadworksAccounting): void {
  if (lot(sim.state, job) || !atSupplier(sim, job, actor)) return;
  const supplier = sim.state.shops.find(shop => shop.id === job.supplierShopId)!;
  const quote = sim.quoteSupply(supplier.id, MATERIALS), gross = quote.unitPrice, taxRate = sim.state.taxRate, tax = gross * taxRate, net = gross - tax;
  if (finite(gross) && gross + (REQUIRED_MINUTES - job.workedMinutes) * job.ratePerMinute > job.escrow + EPS) {
    job.status = 'awaitingBudget'; job.reason = '真实报价加已冻结施工工资超过实际托管；只能依法取消退款后重新批准，不能免费扩额。'; return;
  }
  if (sim.shopCommodity(supplier) !== 'materials' || supplier.inventory < MATERIALS || quote.quantity < MATERIALS || !finite(gross) || gross <= 0 || sim.shopFunds(supplier) + net > 1e9) {
    job.status = 'awaitingSupply'; job.reason = '当前真实材料或货主余额容量不允许成交；没有扣钱或造货。'; return;
  }
  supplier.inventory -= MATERIALS; sim.transferShopFunds(supplier, net); supplier.revenue += gross; supplier.profit += net;
  job.escrow -= gross; job.purchasePaid += gross; job.receivedUnits = MATERIALS; job.reservedUnits = MATERIALS;
  job.receipts.push({ at: clock(sim.state), shopId: supplier.id, workerId: actor.id, nodeId: job.supplierNodeId!, point: copy(job.supplierPoint!), quantity: 1, unitPrice: gross, gross, net, tax, taxRate });
  body(sim.state)!.stock.push({ id: job.id + '-material', jobId: job.id, ownerId: job.payerId, quantity: MATERIALS, retained: false, location: { kind: 'carried', actorId: actor.id } });
  sim.emitEvent({ type: 'wholesale', shopId: supplier.id, districtId: supplier.districtId, amount: gross, quantity: MATERIALS, unitPrice: gross, laborJobId: job.id, purpose: 'road-repair' });
  ledger(sim, supplier.ownerId ?? actor.id, net, '道路实际材料供应净款，毛款税详原收据', supplier.districtId, 'company');
  job.status = 'carrying'; job.reason = '已在真实售点付款取原材料；须沿开放路真实搬运至施工端。';
}
function moduleBytes(state: SimState): number { return new TextEncoder().encode(JSON.stringify(body(state) ?? {})).length; }
function canCoalesce(receipt: RoadLaborReceipt | undefined, actorId: string, rate: number, tax: number, nodeId: string, point: Vec3, startAt: number): receipt is RoadLaborReceipt {
  return !!receipt && receipt.actorId === actorId && receipt.ratePerMinute === rate && receipt.taxRate === tax && receipt.nodeId === nodeId
    && distance(receipt.point, point) < EPS && receipt.endAt === startAt;
}
function create(sim: Simulation, edgeId: string | undefined, payerId: 'player' | 'public', accounting: RoadworksAccounting, residentDemandId?: string): CommandResult {
  const closure = edgeId && roadClosure(sim.state, edgeId), state = sim.state;
  if (!closure || closure.reopenedAt !== null) return { ok: false, message: '该现有道路没有待修的真实关闭记录。' };
  const demand = residentDemandId ? roadRepairDemand(state, residentDemandId) : null;
  const resident = demand && state.citizens.find(actor => actor.id === demand.actorId);
  if (residentDemandId && (!demand || !resident || payerId !== 'public' || demand.closureId !== closure.id || demand.edgeId !== edgeId || demand.resolvedAt !== null || demand.repairId !== null || !state.extension?.actorProfiles[resident.id]?.alive)) return { ok: false, message: '没有该具名、真实受阻且尚未关联维修的居民需求。' };
  if (!demand && (distance(state.player.position, closure.worksite) > 2 || state.player.vehicleId || state.aviation?.activeAircraftId || !footClear(sim, state.player.position))) return { ok: false, message: '请到关闭道路安全端现场提出维修，不能遥控或穿过闭段。' };
  if (!demand && payerId === 'public' && !['official', 'council', 'mayor'].some(role => sim.hasIdentity(role as Role))) return { ok: false, message: '公共维修申请须由实际具备公共身份者提交，支出仍须合法审批。' };
  const current = body(state);
  if (moduleBytes(state) > NEW_ORDER_BYTES || new TextEncoder().encode(sim.exportSave()).length > 7 * 1024 * 1024) return { ok: false, message: '保存空间已接近保护上限；既有钱料和工资凭据保留，暂不接受新单。' };
  if (current && (current.jobs.length >= MAX_JOBS || current.jobs.some(job => !ended(job) && job.closureId === closure.id))) return { ok: false, message: '原在办/退款或128受保护档案仍保留，不能重复开单。' };
  if (!demand && !state.extension!.actorProfiles.player.alive || payerId === 'player' && state.player.money < PLAYER_FUNDS) return { ok: false, message: '存活申请者和真实100文托管余额不足。' };
  const works = activate(sim, accounting), now = clock(state), job: RoadRepairJob = {
    id: 'road-repair-' + works.nextId++, closureId: closure.id, edgeId: closure.edgeId, requestedBy: resident?.id ?? 'player', payerId,
    worksiteNodeId: closure.worksiteNodeId, worksite: copy(closure.worksite), startedAt: now, lastObservedAt: now,
    status: payerId === 'public' ? 'awaitingBudget' : 'awaitingWorker', reason: '等待有限材料经费、合法审批及真实居民自愿履约。', workerId: null, acceptedAt: null, ratePerMinute: 0, contract: null,
    supplierShopId: null, supplierNodeId: null, supplierPoint: null, requiredMinutes: 60, workedMinutes: 0, contributions: {}, laborReceipts: [],
    funded: payerId === 'player' ? PLAYER_FUNDS : 0, escrow: payerId === 'player' ? PLAYER_FUNDS : 0, purchasePaid: 0, paidGross: 0, paidNet: 0, paidTax: 0, refunded: 0, serviceFees: 0,
    receipts: [], receivedUnits: 0, reservedUnits: 0, consumedUnits: 0, budgetId: null, approvalSiteId: null, approvedAt: null, approvedBy: [], authorizedCap: 0, completedAt: null, cancelledAt: null,
  };
  if (payerId === 'player') { state.player.money -= PLAYER_FUNDS; ledger(sim, 'player', -PLAYER_FUNDS, '道路维修真实托管划入', closure.districtId); }
  works.jobs.push(job); acceptWorker(sim, job, accounting);
  return { ok: true, message: payerId === 'player' ? '100文进入原道路维修托管；材料、搬运、60真实工时尚待履约。' : '公共订单等待原合法身份实际审批，没有预扣或循环100文。' };
}
export function roadworksStatus(state: SimState, edgeId: string) {
  const closure = roadClosure(state, edgeId), job = body(state)?.jobs.slice().reverse().find(job => job.edgeId === edgeId) ?? null;
  const material = job ? lot(state, job) : undefined;
  return { supported: !!closure, closure: closure ?? null, job, materialStage: !material ? 'unbought' : material.retained ? 'retained' : material.location.kind === 'consumed' ? 'consumed' : material.location.kind === 'worksite' ? 'delivered' : 'carried' };
}
export function requestResidentRoadRepair(sim: Simulation, demandId: string, accounting: RoadworksAccounting): string | null {
  const demand = roadRepairDemand(sim.state,demandId), closure = demand && roadClosureById(sim.state,demand.closureId);
  if (!demand || !closure || closure.reopenedAt !== null || demand.resolvedAt !== null || !sim.state.extension?.actorProfiles[demand.actorId]?.alive) return null;
  if (demand.repairId !== null) { const linked = body(sim.state)?.jobs.find(job => job.id === demand.repairId && job.closureId === demand.closureId); return linked?.id ?? null; }
  const current = body(sim.state)?.jobs.find(job => !ended(job) && job.closureId === closure.id);
  if (current) return current.id;
  const result = create(sim,closure.edgeId,'public',accounting,demandId);
  return result.ok ? body(sim.state)!.jobs.at(-1)!.id : null;
}

export function installRoadworks(sim: Simulation, accounting: RoadworksAccounting): RoadworksController {
  let observedState = sim.state, phaseTick = -1, phaseClock = -1, phaseMinutes = 0;
  const seen = new WeakSet<object>();
  sim.onPhase('time', (state, minutes) => { observedState = state; phaseTick = state.tick; phaseClock = clock(state); phaseMinutes = minutes; });
  sim.registerCommandHandler(command => {
    const type = String(command.type);
    if (type === 'requestRoadRepair') { if (command.value !== undefined && ![0, 1].includes(command.value)) return { ok: false, message: '付款类型只接受0个人或1公共。' }; return create(sim, command.targetId, command.value === 1 ? 'public' : 'player', accounting); }
    if (!['approveRoadRepair', 'cancelRoadRepair'].includes(type)) return null;
    const job = body(sim.state)?.jobs.find(job => job.id === command.targetId && !ended(job));
    if (!job) return { ok: false, message: '没有该未结真实道路订单。' };
    if (type === 'approveRoadRepair') {
      if (!sim.hasIdentity('mayor')) return { ok: false, message: '玩家审批须为真实市长并在合法政务地点；普通居民不能造预算。' };
      return authorize(sim, job, ['player'], command.value ?? 40, accounting) ? { ok: true, message: '原经费已依法有限承诺；物料和工时未发生。' } : { ok: false, message: '预算/现场署名/旧工资保护不允许该审批。' };
    }
    if (job.payerId === 'public' && !sim.hasIdentity('mayor') && !sim.hasIdentity('official')) return { ok: false, message: '公共项目只能由合法执行身份停止。' };
    if (job.workedMinutes >= REQUIRED_MINUTES && job.cancelledAt === null) return { ok: false, message: '实际配方已履约，须先清算余款，不能撤回工人工资。' };
    cancel(sim, job, accounting); return { ok: true, message: job.reason };
  });
  sim.onEvent('roadwork-presence', event => {
    const row = event as Presence, state = sim.state;
    if (!accounting.isCanonicalRoadworkPresence(event) || seen.has(event) || observedState !== state || phaseTick !== state.tick || phaseClock !== clock(state)
      || row.activityObservedTick !== phaseTick || row.activityObservedClock !== phaseClock || !finite(row.activityWindowStartAt) || !finite(row.activityWindowEndAt)
      || row.activityWindowEndAt > phaseClock + EPS || row.activityWindowStartAt < phaseClock - phaseMinutes - EPS || row.activityWindowEndAt <= row.activityWindowStartAt || !row.activityPosition) return;
    seen.add(event);
    const job = body(state)?.jobs.find(job => !ended(job) && job.cancelledAt === null && job.id === row.laborJobId && job.workerId === row.citizenId);
    const actor = state.citizens.find(actor => actor.id === row.citizenId);
    if (!job || !actor || !capable(state, actor) || distance(actor.position, row.activityPosition) > EPS || !footClear(sim, actor.position)) return;
    if (!lot(state, job)) { if (row.nodeId === job.supplierNodeId) purchase(sim, job, actor, accounting); return; }
    const material = lot(state, job)!;
    if (row.nodeId !== job.worksiteNodeId || distance(actor.position, job.worksite) > 2 || material.retained || material.quantity < MATERIALS || !footClear(sim, job.worksite)) return;
    material.location = { kind: 'worksite', nodeId: job.worksiteNodeId, point: copy(job.worksite) };
    const startAt = Math.max(row.activityWindowStartAt, job.acceptedAt!, job.startedAt, job.receipts[0].at), endAt = row.activityWindowEndAt;
    const previous = job.laborReceipts.at(-1);
    const merge = canCoalesce(previous, actor.id, job.ratePerMinute, state.taxRate, job.worksiteNodeId, job.worksite, startAt);
    if (!merge && (job.laborReceipts.length >= MAX_LABOR_RECEIPTS || moduleBytes(state) > MAX_MODULE_BYTES - 2048)) {
      job.status = 'paused'; job.reason = '保存额度已满，原凭据和钱料不删除；暂停新劳动并保留未赚款。'; return;
    }
    const requested = Math.min(endAt - startAt, REQUIRED_MINUTES - job.workedMinutes, job.escrow / job.ratePerMinute, (1e9 - actor.money) / (job.ratePerMinute * (1 - state.taxRate)));
    if (!(requested > EPS)) { job.status = 'paused'; job.reason = '没有真实剩余现场分钟、可付工资或收款余额容量。'; return; }
    const minutes = claimActorActivityMinutes(sim, actor.id, job.id, requested, phaseMinutes); if (!(minutes > 0)) return;
    const gross = minutes * job.ratePerMinute, taxRate = state.taxRate, tax = gross * taxRate, net = gross - tax;
    job.escrow -= gross; actor.money += net; accounting.accrueTax(tax);
    job.workedMinutes += minutes; job.paidGross += gross; job.paidNet += net; job.paidTax += tax;
    const contribution = job.contributions[actor.id] ??= { startedAt: startAt, endedAt: startAt, workedMinutes: 0, gross: 0, net: 0, tax: 0 };
    contribution.endedAt = startAt + minutes; contribution.workedMinutes += minutes; contribution.gross += gross; contribution.net += net; contribution.tax += tax;
    if (merge) {
      previous!.at = clock(state); previous!.lastTick = state.tick; previous!.paymentCount++;
      previous!.endAt = startAt + minutes; previous!.minutes += minutes; previous!.gross += gross; previous!.net += net; previous!.tax += tax;
    } else job.laborReceipts.push({ at: clock(state), firstTick: state.tick, lastTick: state.tick, paymentCount: 1, actorId: actor.id, startAt, endAt: startAt + minutes, minutes, ratePerMinute: job.ratePerMinute, taxRate, gross, net, tax, nodeId: job.worksiteNodeId, point: copy(job.worksite) });
    ledger(sim, actor.id, net, '道路工地真实已赚工资；原办公室工资未复用', roadClosureById(state, job.closureId)!.districtId);
    sim.emitEvent({ type: 'roadwork-wage-paid', citizenId: actor.id, laborJobId: job.id, amount: gross, minutes, ratePerMinute: job.ratePerMinute, nodeId: job.worksiteNodeId, creditedWorkStartAt: startAt, creditedWorkEndAt: startAt + minutes, activityObservedTick: state.tick, activityObservedClock: clock(state), activityPosition: copy(actor.position) });
    job.status = 'working'; job.reason = '原居民在真实工地按冻结合同逐分钟获得净工资与税，未重复领取办公室工资。';
    if (job.workedMinutes >= REQUIRED_MINUTES - EPS) { job.workedMinutes = REQUIRED_MINUTES; job.reservedUnits = 0; job.consumedUnits = MATERIALS; material.quantity = 0; material.location = { kind: 'consumed', nodeId: job.worksiteNodeId, point: copy(job.worksite) }; settle(sim, job, accounting); }
  });
  sim.onPhase('people', state => {
    for (const job of body(state)?.jobs ?? []) {
      if (ended(job)) continue;
      job.lastObservedAt = clock(state);
      const actor = state.citizens.find(actor => actor.id === job.workerId);
      if (job.status === 'refundPending') { settle(sim, job, accounting); continue; }
      if (!state.extension!.actorProfiles.player.alive && job.payerId === 'player' || actor && !state.extension!.actorProfiles[actor.id].alive) { cancel(sim, job, accounting); continue; }
      if (actor && !capable(state, actor)) { job.status = 'paused'; job.reason = '居民需要进食、休息或医疗，自愿任务暂停；没有追赶分钟。'; }
    }
  });
  sim.onPhase('politics', state => {
    for (const job of body(state)?.jobs ?? []) {
      if (ended(job) || job.cancelledAt !== null || job.status === 'refundPending') continue;
      if (job.payerId === 'public' && !job.budgetId) {
        const groups = new Map<string, string[]>();
        for (const actor of state.citizens) {
          const site = sim.worldDefinition.buildings.find(site => site.id === actor.workId);
          if (!site || !['hall', 'core', 'bank'].includes(site.kind) || !['官员', '财政官', 'official', '议员', 'council'].includes(actor.role) || !sim.isOnDuty(actor.id, site.id)) continue;
          const ids = groups.get(site.id) ?? []; ids.push(actor.id); groups.set(site.id, ids);
        }
        for (const ids of groups.values()) if (ids.length >= 2 && authorize(sim, job, ids.slice(0, 2), 40, accounting)) break;
      }
      if (job.budgetId && job.funded === 0 && job.approvalSiteId && accounting.takePublicEscrow({ budgetId: job.budgetId, siteId: job.approvalSiteId, purpose: 'road-repair', amount: job.authorizedCap })) { job.funded = job.authorizedCap; job.escrow = job.authorizedCap; }
      acceptWorker(sim, job, accounting);
    }
  });
  sim.registerSaveValidator(state => validateRoadworksState(state, sim.worldDefinition));
  return { requestResidentDemand: demandId => requestResidentRoadRepair(sim,demandId,accounting) };
}

export function validateRoadworksState(candidate: SimState, world: WorldDefinition): void {
  const state = candidate as State, works = state.roadworks;
  if (works === undefined) return;
  const ensure = (yes: unknown, field: string): void => { if (!yes) throw new Error('道路工程存档无效：' + field); };
  const num = (n: unknown, lo: number, hi: number, field: string, integer = false): void => ensure(finite(n) && n >= lo && n <= hi && (!integer || Number.isInteger(n)), field);
  const close = (a: number, b: number, field: string): void => ensure(Math.abs(a - b) <= EPS, field);
  const object = (value: unknown, keys: string[], field: string): void => ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), field);
  const vector = (p: Vec3, field: string): void => { object(p, ['x','y','z'], field); for (const n of [p.x,p.y,p.z]) num(n,-1e5,1e5,field); };
  const array = <T>(a: T[], max: number, field: string): T[] => { ensure(Array.isArray(a) && a.length <= max, field); return a; };
  const now = clock(state), actors = new Map(state.citizens.map(actor => [actor.id, actor]));
  object(works, ['version','activatedAt','nextId','jobs','stock','capacityHistory'], '模块结构');
  ensure(works.version === 1, '版本'); ensure(moduleBytes(state) <= MAX_MODULE_BYTES, '道路模块保存容量'); num(works.activatedAt,0,now,'激活时间'); num(works.nextId,1,MAX_JOBS+1,'下个身份',true);
  const jobs = array(works.jobs, MAX_JOBS, '任务数量'), seen = new Set<string>();
  for (let i=0; i<jobs.length; i++) {
    const job = jobs[i];
    object(job, ['id','closureId','edgeId','requestedBy','payerId','worksiteNodeId','worksite','startedAt','lastObservedAt','status','reason','workerId','acceptedAt','ratePerMinute','contract','supplierShopId','supplierNodeId','supplierPoint','requiredMinutes','workedMinutes','contributions','laborReceipts','funded','escrow','purchasePaid','paidGross','paidNet','paidTax','refunded','serviceFees','receipts','receivedUnits','reservedUnits','consumedUnits','budgetId','approvalSiteId','approvedAt','approvedBy','authorizedCap','completedAt','cancelledAt'], '任务结构');
    ensure(job.id === 'road-repair-'+(i+1) && !seen.has(job.id), '顺序身份'); seen.add(job.id);
    const closure = roadClosureById(state,job.closureId), edge = world.edges.find(edge=>edge.id===job.edgeId);
    ensure(closure && edge && closure.edgeId===edge.id && ['road','bridge'].includes(edge.mode), '真实关闭与现有道路引用');
    ensure(job.worksiteNodeId===closure!.worksiteNodeId && distance(job.worksite,closure!.worksite)<EPS, '原安全端工地'); vector(job.worksite,'工地坐标');
    ensure(['player','public'].includes(job.payerId) && (job.requestedBy==='player' || job.payerId==='public' && actors.has(job.requestedBy) && residentRoadRepairRequester(state,job.id,job.requestedBy,job.closureId)), '原请求与付款主体/具名受阻需求');
    ensure(['awaitingBudget','awaitingSupply','awaitingWorker','carrying','working','paused','refundPending','completed','cancelled'].includes(job.status) && typeof job.reason==='string' && job.reason.length<=1000, '状态');
    num(job.startedAt,Math.max(works.activatedAt,closure!.occurredAt),now,'下单时间'); num(job.lastObservedAt,job.startedAt,now,'观察时间');
    const stop = job.completedAt ?? job.cancelledAt ?? now;
    if (job.completedAt!==null) num(job.completedAt,job.startedAt+REQUIRED_MINUTES-EPS,now,'完成实际期限');
    if (job.cancelledAt!==null) num(job.cancelledAt,job.startedAt,now,'取消时间');
    ensure(job.requiredMinutes===REQUIRED_MINUTES && job.serviceFees===0, '实际60分钟且无循环服务费'); num(job.workedMinutes,0,REQUIRED_MINUTES,'已赚分钟');
    for(const key of ['funded','escrow','purchasePaid','paidGross','paidNet','paidTax','refunded','authorizedCap'] as const) num(job[key],0,1e6,'资金'+key);
    close(job.funded,job.escrow+job.purchasePaid+job.paidGross+job.refunded,'托管资金守恒'); close(job.paidGross,job.paidNet+job.paidTax,'工资净款与税');
    if(job.payerId==='player') ensure(job.funded===PLAYER_FUNDS && job.budgetId===null && job.approvalSiteId===null && job.approvedAt===null && job.approvedBy.length===0 && job.authorizedCap===0,'原实付100');
    else {
      ensure(job.budgetId===null ? job.funded===0 && job.approvalSiteId===null && job.approvedAt===null && job.approvedBy.length===0 && job.authorizedCap===0 : job.budgetId===job.id && world.buildings.some(site=>site.id===job.approvalSiteId) && job.approvedAt!==null && job.authorizedCap>0 && (job.funded===0 || job.funded===job.authorizedCap),'公共授权与有限真实划入');
      if(job.approvedAt!==null) num(job.approvedAt,job.startedAt,stop,'授权时序');
    }
    array(job.approvedBy,16,'署名数量'); ensure(new Set(job.approvedBy).size===job.approvedBy.length && job.approvedBy.every(id=>id==='player'||actors.has(id)),'真实署名身份');
    if(job.workerId===null) ensure(job.acceptedAt===null && job.contract===null && job.ratePerMinute===0 && job.supplierShopId===null && job.supplierNodeId===null && job.supplierPoint===null && job.workedMinutes===0,'尚未接受不得生造工人/工资');
    else {
      ensure(actors.has(job.workerId) && job.acceptedAt!==null && job.contract,'具名原居民'); num(job.acceptedAt,job.startedAt,stop,'真实接受时间');
      const c=job.contract!; object(c,['actorId','at','role','craft','age','health','hunger','fatigue','districtId','prosperity','ratePerMinute'],'接受时资格和工资');
      ensure(c.actorId===job.workerId && c.at===job.acceptedAt && ['工人','工程师'].includes(c.role) && world.districts.some(d=>d.id===c.districtId),'原角色/区');
      num(c.craft,20,100,'接受技能');num(c.age,18,140,'接受成年');num(c.health,45,100,'接受健康');num(c.hunger,40,100,'接受饥饿');num(c.fatigue,35,100,'接受疲劳');num(c.prosperity,0,100,'接受区薪率');
      close(c.ratePerMinute,32*(.7+c.prosperity/100)/480,'冻结工资原公式');close(job.ratePerMinute,c.ratePerMinute,'同一冻结工资');
      const supplier=state.shops.find(shop=>shop.id===job.supplierShopId),site=supplier&&world.buildings.find(site=>site.id===supplier.buildingId);
      ensure(site&&site.kind==='workshop'&&!site.facility&&world.nodes.some(node=>node.id===job.supplierNodeId)&&job.supplierPoint,'真实工业供货地点');
      const nearest=[...world.nodes].sort((a,b)=>distance(a.position,site!.door)-distance(b.position,site!.door)||a.id.localeCompare(b.id))[0];ensure(nearest&&job.supplierNodeId===nearest.id,'真实供货楼最近原节点');vector(job.supplierPoint!,'领取点');
      const points=supplierPoints(site!);
      ensure(points.some(point=>point.purpose==='sale'&&distance(point.position,job.supplierPoint!)<EPS),'原实际售点，不接受门外虚拟成交');
    }
    let materialGross=0;
    for(const receipt of array(job.receipts,1,'一份原材料收据')) {
      object(receipt,['at','shopId','workerId','nodeId','point','quantity','unitPrice','gross','net','tax','taxRate'],'真实采购收据');
      ensure(receipt.quantity===MATERIALS&&receipt.shopId===job.supplierShopId&&receipt.workerId===job.workerId&&receipt.nodeId===job.supplierNodeId&&job.supplierPoint&&distance(receipt.point,job.supplierPoint)<EPS,'原供给者与实际领取点');
      num(receipt.at,job.acceptedAt!,stop,'采购不得晚于结清');num(receipt.unitPrice,4,1e6,'真实动态材料价');num(receipt.taxRate,0,.5,'成交税率');
      close(receipt.gross,receipt.unitPrice,'一份成交额');close(receipt.tax,receipt.gross*receipt.taxRate,'采购税');close(receipt.net+receipt.tax,receipt.gross,'货主净款税守恒');materialGross+=receipt.gross;
    }
    close(materialGross,job.purchasePaid,'采购实付');ensure(job.receivedUnits===job.receipts.length,'材料不得无来源');
    for(const key of ['receivedUnits','reservedUnits','consumedUnits'] as const) num(job[key],0,MATERIALS,key,true);
    let minutes=0,gross=0,net=0,tax=0; const perActor=new Map<string,{minutes:number;gross:number;net:number;tax:number;start:number;end:number}>();
    let lastEnd=job.acceptedAt??job.startedAt, lastTick=-1;
    for(const receipt of array(job.laborReceipts,MAX_LABOR_RECEIPTS,'真实现场工资凭据')) {
      object(receipt,['at','firstTick','lastTick','paymentCount','actorId','startAt','endAt','minutes','ratePerMinute','taxRate','gross','net','tax','nodeId','point'],'工资凭据结构');
      ensure(receipt.actorId===job.workerId&&receipt.nodeId===job.worksiteNodeId&&distance(receipt.point,job.worksite)<EPS&&job.receipts.length===1,'原具名工地，不引用office工资');
      num(receipt.startAt,Math.max(lastEnd,job.receipts[0].at),stop,'到货后劳动起点');num(receipt.endAt,receipt.startAt,stop,'当次劳动终点');num(receipt.at,receipt.endAt,stop,'观察不得早于劳动');num(receipt.firstTick,lastTick+1,state.tick,'首付款tick',true);num(receipt.lastTick,receipt.firstTick,state.tick,'末付款tick',true);num(receipt.paymentCount,1,receipt.lastTick-receipt.firstTick+1,'真实合并付款次数',true);num(receipt.minutes,EPS,REQUIRED_MINUTES,'分钟');
      close(receipt.endAt-receipt.startAt,receipt.minutes,'实际连续区间');close(receipt.ratePerMinute,job.ratePerMinute,'约定时薪');num(receipt.taxRate,0,.5,'工资实际税率');close(receipt.gross,receipt.minutes*receipt.ratePerMinute,'已赚工资');close(receipt.tax,receipt.gross*receipt.taxRate,'实际工资税');close(receipt.net+receipt.tax,receipt.gross,'工资净款与税');
      lastEnd=receipt.endAt;lastTick=receipt.lastTick;minutes+=receipt.minutes;gross+=receipt.gross;net+=receipt.net;tax+=receipt.tax;
      const row=perActor.get(receipt.actorId)??{minutes:0,gross:0,net:0,tax:0,start:receipt.startAt,end:receipt.endAt};row.minutes+=receipt.minutes;row.gross+=receipt.gross;row.net+=receipt.net;row.tax+=receipt.tax;row.end=receipt.endAt;perActor.set(receipt.actorId,row);
    }
    close(minutes,job.workedMinutes,'施工分钟');close(gross,job.paidGross,'实付gross');close(net,job.paidNet,'实收net');close(tax,job.paidTax,'工资税总');
    ensure(job.contributions&&typeof job.contributions==='object'&&!Array.isArray(job.contributions)&&Object.keys(job.contributions).length===perActor.size,'贡献者不可删改');
    for(const [id,row] of perActor) {const c=job.contributions[id];object(c,['startedAt','endedAt','workedMinutes','gross','net','tax'],'贡献区间');close(c.startedAt,row.start,'真实起点');close(c.endedAt,row.end,'真实终点');close(c.workedMinutes,row.minutes,'贡献分钟');close(c.gross,row.gross,'贡献工资');close(c.net,row.net,'贡献净款');close(c.tax,row.tax,'贡献税');}
    if(job.completedAt!==null) ensure(['completed','refundPending'].includes(job.status)&&job.cancelledAt===null&&job.workedMinutes===REQUIRED_MINUTES&&job.consumedUnits===MATERIALS&&job.reservedUnits===0&&closure!.repairedBy===job.id&&closure!.reopenedAt===job.completedAt,'真实完成配方与道路双向引用');
    else {ensure(job.status!=='completed'&&closure!.repairedBy!==job.id,'未完成不得重开');if(job.cancelledAt!==null) ensure(job.status==='cancelled'||job.status==='refundPending','取消状态');if(job.status==='cancelled') ensure(job.escrow===0&&job.reservedUnits===0,'取消先退款退料');}
    if(job.status==='completed') ensure(job.escrow===0,'已完成已清未赚款');
    if(job.status==='refundPending') ensure(job.escrow>0&&(job.completedAt!==null||job.cancelledAt!==null),'待退实款且有真实完成或取消原因');
    if(job.cancelledAt===null&&!ended(job)) ensure(!jobs.some(other=>other!==job&&!ended(other)&&other.closureId===job.closureId),'同一闭段不重复承诺');
  }
  ensure(works.nextId===jobs.length+1,'任务计数不重排');
  const lots=array(works.stock,MAX_JOBS,'真实物料批次'),lotIds=new Set<string>();
  for(const material of lots) {
    object(material,['id','jobId','ownerId','quantity','retained','location'],'物料批次');
    const job=jobs.find(job=>job.id===material.jobId);ensure(job&&material.id===job.id+'-material'&&!lotIds.has(material.id)&&material.ownerId===job.payerId,'真实物料货权');lotIds.add(material.id);
    ensure(job!.receivedUnits===MATERIALS,'物料必须真实采购');close(material.quantity+job!.consumedUnits,MATERIALS,'实物一份守恒');ensure(material.retained===(job!.cancelledAt!==null&&material.quantity>0),'取消物料保权');
    const location=material.location;
    if(location.kind==='carried'){object(location,['kind','actorId'],'携带状态');ensure(location.actorId===job!.workerId&&actors.has(location.actorId)&&job!.cancelledAt===null,'原工人真实携带');}
    else if(location.kind==='ground'){object(location,['kind','point'],'实际落点');vector(location.point,'物料落点');ensure(material.retained,'落点须保留物权');}
    else {object(location,['kind','nodeId','point'],'工地物料');ensure(['worksite','consumed'].includes(location.kind)&&location.nodeId===job!.worksiteNodeId&&distance(location.point,job!.worksite)<EPS,'原真实安全端');ensure(location.kind==='consumed'?material.quantity===0:material.quantity===MATERIALS,'实际材料状态');}
  }
  ensure(lots.length===jobs.filter(job=>job.receivedUnits===MATERIALS).length,'已购批次不可删除');
  ensure(Array.isArray(works.capacityHistory)&&works.capacityHistory.length===0,'128受保护原历史未压缩，不制造额外见证');
  validateJointActorActivityCapacity(state);
}
export function validateRoadworksBudgetCrossReferences(state: SimState, budgets: {id:string;siteId:string;purpose:string;cap:number;spent:number;approvedAt:number;approvedBy:string[];closedAt:number|null}[]): void {
  const relevant=budgets.filter(budget=>budget.purpose==='road-repair'), works=body(state);
  for(const job of works?.jobs??[]) if(job.budgetId) {
    const budget=relevant.find(budget=>budget.id===job.budgetId);
    if(!budget||budget.siteId!==job.approvalSiteId||budget.cap!==job.authorizedCap||Math.abs(budget.spent-(job.funded-job.refunded))>EPS||budget.approvedAt!==job.approvedAt||JSON.stringify([...budget.approvedBy].sort())!==JSON.stringify([...job.approvedBy].sort())||(budget.closedAt!==null)!==ended(job)) throw new Error('道路经费授权与真实托管/退款/结清不一致。');
  }
  for(const budget of relevant) if(!works?.jobs.some(job=>job.budgetId===budget.id)) throw new Error('道路经费缺少原任务，不能误当旧档迁移。');
}
