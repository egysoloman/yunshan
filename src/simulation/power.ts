import type { Simulation, PublicPurchaseReceipt } from '../simulation';
import type { Building, BuildingFunctionPoint, Citizen, CommandResult, Player, Role, SimState, Vec3, WorldDefinition } from '../types';
import { getWalkHeight } from '../world';
import { claimFundedActorWork } from './funded-work';
import { canAccessFloor, getFloorDimensions } from '../access';
import { blocksFloorPlanMovement, floorPlanSupport, getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { homeRestPointBlockedByVoxels } from './home-rest';
import { collectActorActivityClaims, validateJointActorActivityCapacity, type ActivityCapacityWitness } from './activity-capacity';

const EPS = 1e-7, REPAIR_MINUTES = 60, REPAIR_P = 5, MATERIAL_UNITS = 1, PLAYER_ESCROW = 100;
const MAX_REPAIRS = 64, MAX_WITNESSES = 1024;
export interface LegacyEnergyContract { version: 1; capturedAt: number; sourceDisplayNow: number; sourceDisplayDeadline: number; duration: number; endsAt: number }
export interface PowerFault { id: number; occurredAt: number; districtId: string; severity: number; addedLossP: number; repairedP: number }
export interface PowerReceipt { purchasedAt: number; shopId: string; quantity: number; unitPrice: number; gross: number; net: number; tax: number }
export interface PowerContribution { startedAt: number; endedAt: number; workedMinutes: number }
export interface PowerControlPoint { id: string; floor: number; position: Vec3 }
export interface PowerRepair {
  id: string; payerId: 'player' | 'public'; startedAt: number; lastObservedAt: number;
  status: 'awaitingBudget' | 'awaitingSupply' | 'awaitingTechnician' | 'working' | 'paused' | 'completed' | 'cancelled' | 'refundPending'; reason: string;
  technicianId: string | null; point: PowerControlPoint | null;
  restoreP: number; faultUnits: { faultId: number; quantityP: number }[];
  requiredMinutes: 60; workedMinutes: number; contributions: Record<string, PowerContribution>;
  funded: number; escrow: number; purchasePaid: number; serviceFees: number; refunded: number;
  receipts: PowerReceipt[]; receivedUnits: number; reusedUnits: number; reservedUnits: number; consumedUnits: number; reservedAt: number | null; returnedAt: number | null;
  budgetId: string | null; approvedAt: number | null; approvedBy: string[]; authorizedCap: number;
  completedAt: number | null; cancelledAt: number | null; retryAt: number;
}
export interface PowerMeter { demandP: number; servedP: number; unservedP: number }
export interface PowerDispatch {
  tick: number; at: number; minutes: number; baseP: number; equipmentLossP: number; legacyP: number; publicSupply: number;
  availableP: number; demandP: number; servedP: number; unservedP: number; curtailedP: number;
}
export interface PowerState {
  version: 1; activatedAt: number; sourceSiteId: 'core-main'; operatorSiteId: 'core-energy-south'; networkKind: 'legacy-city-bus';
  faults: PowerFault[]; lossP: number; nextRepairId: number; repairs: PowerRepair[];
  stock: { receivedUnits: number; consumedUnits: number; availableUnits: number };
  dispatch: PowerDispatch | null; buildingMeters: Record<string, PowerMeter>; vehicleMeters: Record<string, PowerMeter>;
  totals: { suppliedPMinutes: number; demandedPMinutes: number; unservedPMinutes: number; curtailedPMinutes: number };
  capacityHistory: ActivityCapacityWitness[];
  capacityArchive: { count: number; minutes: number; researchCount: number; educationCount: number };
  researchBaseline: number; unobservedResearchCompletions: number; nextPublicReviewAt: number;
}
interface PowerEvent { type: string; citizenId?: string; siteId?: string; eventId?: number; districtId?: string; severity?: number; occurredAt?: number; minutes?: number; amount?: number; creditedWorkStartAt?: number; creditedWorkEndAt?: number; purpose?: string }
export interface PowerAccounting {
  activate(): void;
  legacy(): LegacyEnergyContract | null;
  publicSupply(): number;
  isCanonicalDisaster(event: object): boolean;
  isCanonicalResearchCompletion(event: object): boolean;
}
const clock = (state: SimState) => state.extension!.lastUpdate;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const bounded = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const ended = (job: PowerRepair) => ['completed', 'cancelled'].includes(job.status);
const identity = (actor: Citizen | Player): Pick<Player, 'role' | 'identities'> => 'id' in actor ? { role: 'scientist', identities: ['scientist'] } : actor;
const floorOf = (site: Building, position: Vec3) => Math.floor((position.y - site.position.y + .01) / (site.height / site.floors));
export function powerBinding(world: WorldDefinition): { source: Building; operator: Building } | null {
  const source = world.buildings.find(site => site.id === 'core-main' && site.kind === 'core' && site.facility === 'mayor');
  const operator = world.buildings.find(site => site.id === 'core-energy-south' && site.kind === 'workshop' && site.facility === 'energy');
  return source && operator && world.districts.some(d => d.id === source.districtId) && world.districts.some(d => d.id === operator.districtId) ? { source, operator } : null;
}
function points(site: Building): BuildingFunctionPoint[] { return site.functionPoints ?? Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat(); }
function legacyBodyAt(sim: Simulation, site: Building, floor: number, position: Vec3): boolean {
  const dimensions = getFloorDimensions(site, floor), dx = position.x - site.position.x, dz = position.z - site.position.z;
  const x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation);
  return Math.abs(x) + .35 <= dimensions.width / 2 && Math.abs(z) + .35 <= dimensions.depth / 2 && site.height / site.floors >= 1.72
    && Math.abs(getWalkHeight(sim.worldDefinition, position.x, position.z, position.y) - position.y) <= .26 && !homeRestPointBlockedByVoxels(position, sim.state.voxels);
}
function bodyAt(sim: Simulation, site: Building, point: PowerControlPoint, actor: Citizen | Player): boolean {
  const person = identity(actor);
  if (!canAccessFloor(site, point.floor, person) || floorOf(site, actor.position) !== point.floor || distance(actor.position, point.position) > 2) return false;
  if (!getBuildingBody(site)) return legacyBodyAt(sim, site, point.floor, actor.position) && legacyBodyAt(sim, site, point.floor, point.position) && sim.isNearBuilding(site, actor.position, 2);
  const supported = (at: Vec3) => {
    const support = floorPlanSupport(site, point.floor, at, .35);
    if (!support) return false;
    return support.floor === point.floor && ['room', 'stairs'].includes(support.kind) && Math.abs(support.y - at.y) <= .26
      && !blocksFloorPlanMovement(site, point.floor, at, at, .35, 1.72) && !homeRestPointBlockedByVoxels(at, sim.state.voxels);
  };
  return points(site).some(p => p.id === point.id && p.purpose === 'work' && p.floor === point.floor && distance(p.position, point.position) < EPS)
    && supported(actor.position) && supported(point.position);
}
function actualPoint(sim: Simulation, site: Building, actor: Citizen | Player): PowerControlPoint | null {
  if (!sim.isNearBuilding(site, actor.position, 2)) return null;
  const floor = floorOf(site, actor.position);
  if (!getBuildingBody(site)) return canAccessFloor(site, floor, identity(actor)) && legacyBodyAt(sim, site, floor, actor.position) ? { id: 'legacy:' + site.id + ':' + floor, floor, position: copy(actor.position) } : null;
  for (const point of points(site).filter(p => p.purpose === 'work' && p.floor === floor).sort((a, b) => distance(actor.position, a.position) - distance(actor.position, b.position) || a.id.localeCompare(b.id))) {
    const value = { id: point.id, floor: point.floor, position: copy(point.position) };
    if (bodyAt(sim, site, value, actor)) return value;
  }
  return null;
}
export function powerRepairPoint(state: SimState, citizenId: string, siteId: string): PowerControlPoint | null {
  if (siteId !== state.power?.operatorSiteId) return null;
  return state.power.repairs.find(job => !ended(job) && job.status !== 'refundPending' && job.technicianId === citizenId)?.point ?? null;
}
export function powerTaskActorIds(state: SimState): ReadonlySet<string> {
  return new Set((state.power?.repairs ?? []).filter(job => !ended(job) && job.status !== 'refundPending' && job.technicianId && job.technicianId !== 'player').map(job => job.technicianId!));
}
export function powerHasCapacityRoom(state: SimState): boolean { return !state.power || state.power.capacityHistory.length < MAX_WITNESSES - 16; }
export function powerSupplyAt(state: SimState, siteId: string): boolean {
  if (!state.power) return true;
  const dispatch = state.power.dispatch, meter = state.power.buildingMeters[siteId];
  return !!dispatch && dispatch.tick === state.tick && Math.abs(dispatch.at - clock(state)) <= EPS && !!meter && meter.servedP > EPS;
}
export function powerStatus(sim: Simulation) {
  const binding = powerBinding(sim.worldDefinition), state = sim.state.power;
  return !binding ? { supported: false, reason: '缺少真实 core-main 或 core-energy-south 功能引用；保持旧聚合契约。' }
    : { supported: true, activated: !!state, lossP: state?.lossP ?? 0, sourceSiteId: binding.source.id, operatorSiteId: binding.operator.id, dispatch: state?.dispatch ?? null, repair: state?.repairs.find(job => !ended(job)) ?? null };
}
function ensureCapacityWitness(state: SimState, witness: ActivityCapacityWitness): void {
  const power = state.power!;
  const previous = power.capacityHistory.find(item => item.id === witness.id);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(witness)) throw new Error('已完成劳动见证不一致。');
    return;
  }
  power.capacityHistory.push(witness);
}
function pruneCapacity(state: SimState): void {
  const power = state.power; if (!power) return;
  // New tasks start at the present clock. A settled earlier witness cannot
  // overlap a future task; any older unfinished claim prevents compression.
  const claimsByActor = new Map<string, ReturnType<typeof collectActorActivityClaims>>();
  for (const claim of collectActorActivityClaims(state)) { const rows = claimsByActor.get(claim.actorId) ?? []; rows.push(claim); claimsByActor.set(claim.actorId, rows); }
  power.capacityHistory = power.capacityHistory.filter(item => {
    if ((claimsByActor.get(item.actorId) ?? []).some(claim => claim.id !== item.id && claim.actorId === item.actorId && claim.startedAt < item.endedAt && claim.endedAt > item.startedAt)) return true;
    const retained = state.education?.history.some(course => 'education:' + course.id === item.id);
    if (retained) return true;
    power.capacityArchive.count++; power.capacityArchive.minutes += item.workedMinutes;
    if (item.kind === 'research') power.capacityArchive.researchCount++; else power.capacityArchive.educationCount++;
    return false;
  });
}
function activate(sim: Simulation, accounting: PowerAccounting): PowerState {
  if (sim.state.power) return sim.state.power;
  if (!powerBinding(sim.worldDefinition)) throw new Error('无法登记不存在的能源设施。');
  const state = sim.state, now = clock(state);
  accounting.legacy(); accounting.activate();
  const power: PowerState = { version: 1, activatedAt: now, sourceSiteId: 'core-main', operatorSiteId: 'core-energy-south', networkKind: 'legacy-city-bus',
    faults: [], lossP: 0, nextRepairId: 1, repairs: [], stock: { receivedUnits: 0, consumedUnits: 0, availableUnits: 0 }, dispatch: null, buildingMeters: {}, vehicleMeters: {},
    totals: { suppliedPMinutes: 0, demandedPMinutes: 0, unservedPMinutes: 0, curtailedPMinutes: 0 }, capacityHistory: [],
    capacityArchive: { count: 0, minutes: 0, researchCount: 0, educationCount: 0 }, researchBaseline: state.extension!.stats.researchCompleted, unobservedResearchCompletions: 0, nextPublicReviewAt: now };
  state.power = power;
  // Explicit retained records have genuine start/end data. Old archived
  // aggregates and already-deleted research receive no invented history.
  for (const course of state.education?.history ?? []) ensureCapacityWitness(state, { id: 'education:' + course.id, kind: 'education', actorId: course.actorId, siteId: course.siteId, startedAt: course.startedAt, endedAt: course.completedAt ?? course.cancelledAt!, workedMinutes: course.workedMinutes });
  return power;
}
function ledger(sim: Simulation, amount: number, purpose: string, account: 'public' | 'household'): void {
  const extension = sim.state.extension!, districtId = powerBinding(sim.worldDefinition)!.source.districtId;
  extension.publicLedger.push({ tick: sim.state.tick, actorId: 'player', amount, purpose, account, districtId });
  if (extension.publicLedger.length > 512) extension.publicLedger.splice(0, extension.publicLedger.length - 512);
  if (account === 'public') Reflect.get(extension, 'runtime').lastTreasury += amount;
}
function dispatchPower(sim: Simulation, minutes: number, accounting: PowerAccounting): void {
  const state = sim.state, power = state.power; if (!power) return;
  if (power.dispatch?.tick === state.tick && power.dispatch.at === clock(state)) return;
  const world = sim.worldDefinition, night = state.hour < 6 || state.hour >= 19, baseP = 93 + Math.sin((state.day * 1440 + state.hour * 60) / 130) * 3;
  const old = accounting.legacy(), legacyP = old && clock(state) < old.endsAt ? 20 : 0, publicSupply = accounting.publicSupply();
  const availableP = (Math.max(0, baseP - power.lossP) + legacyP) * (.35 + .65 * publicSupply);
  const demandP = 53 + (night ? 19 : 8) + state.shops.filter(shop => shop.open).length * .08 + state.vehicles.length * .08;
  const servedP = Math.min(availableP, demandP), unservedP = demandP - servedP, curtailedP = Math.max(0, availableP - demandP), ratio = demandP > 0 ? servedP / demandP : 1;
  const buildings = [...world.buildings].sort((a, b) => a.id.localeCompare(b.id)), homeCounts = new Map<string, number>();
  for (const citizen of state.citizens) homeCounts.set(citizen.homeId, (homeCounts.get(citizen.homeId) ?? 0) + 1);
  const homeTotal = state.citizens.length, meters: Record<string, PowerMeter> = {}, vehicles: Record<string, PowerMeter> = {};
  for (const site of buildings) {
    const residential = homeTotal ? (night ? 19 : 8) * (homeCounts.get(site.id) ?? 0) / homeTotal : site.id === power.sourceSiteId ? (night ? 19 : 8) : 0;
    const shopLoad = state.shops.filter(shop => shop.buildingId === site.id && shop.open).length * .08;
    const demand = 53 / buildings.length + residential + shopLoad;
    meters[site.id] = { demandP: demand, servedP: demand * ratio, unservedP: demand * (1 - ratio) };
  }
  for (const vehicle of state.vehicles) vehicles[vehicle.id] = { demandP: .08, servedP: .08 * ratio, unservedP: .08 * (1 - ratio) };
  const allocated = Object.values(meters).reduce((sum, item) => sum + item.demandP, 0) + Object.values(vehicles).reduce((sum, item) => sum + item.demandP, 0);
  const residual = demandP - allocated, last = meters[power.sourceSiteId]; last.demandP += residual; last.servedP += residual * ratio; last.unservedP += residual * (1 - ratio);
  power.buildingMeters = meters; power.vehicleMeters = vehicles;
  power.dispatch = { tick: state.tick, at: clock(state), minutes, baseP, equipmentLossP: power.lossP, legacyP, publicSupply, availableP, demandP, servedP, unservedP, curtailedP };
  power.totals.suppliedPMinutes += servedP * minutes; power.totals.demandedPMinutes += demandP * minutes; power.totals.unservedPMinutes += unservedP * minutes; power.totals.curtailedPMinutes += curtailedP * minutes;
  const baseIndex = bounded(availableP / Math.max(1, demandP) * 78 - state.districts.reduce((sum, d) => sum + d.pollution, 0) / Math.max(1, state.districts.length) * .08);
  const environment = state.extension!.environment, level = state.extension!.technologies.find(t => t.sector === 'energy')!.level;
  const bonus = level * 1.2 - (100 - environment.waterQuality) * .05 - environment.stormRisk * .03;
  state.energy = bounded(baseIndex + bonus);
  for (const district of state.districts) district.energy = bounded(bounded(baseIndex - district.pollution * .04) + bonus);
}
function createRepair(sim: Simulation, payerId: 'player' | 'public'): CommandResult {
  const state = sim.state, power = state.power;
  if (!power || power.lossP <= EPS) return { ok: false, message: '既有能源设备没有可修复的真实损伤，未收费。' };
  if (power.repairs.some(job => !ended(job))) return { ok: false, message: '既有维修或退款尚未结清。' };
  if (power.repairs.length >= MAX_REPAIRS || !powerHasCapacityRoom(state)) return { ok: false, message: '维修/劳动档案达到保护上限，旧权利保留；不能新开任务。' };
  if (payerId === 'player' && state.player.money < PLAYER_ESCROW) return { ok: false, message: '100文真实维修托管不足。' };
  let remaining = Math.min(REPAIR_P, power.lossP);
  const faultUnits: PowerRepair['faultUnits'] = [];
  for (const fault of power.faults) { const quantityP = Math.min(remaining, fault.addedLossP - fault.repairedP); if (quantityP > EPS) { faultUnits.push({ faultId: fault.id, quantityP }); remaining -= quantityP; } if (remaining <= EPS) break; }
  const restoreP = faultUnits.reduce((sum, item) => sum + item.quantityP, 0); if (restoreP <= EPS) return { ok: false, message: '没有未修复故障量。' };
  const now = clock(state), job: PowerRepair = { id: 'power-repair-' + power.nextRepairId++, payerId, startedAt: now, lastObservedAt: now,
    status: payerId === 'public' ? 'awaitingBudget' : 'awaitingSupply', reason: '等候真实材料、工班与现场技术员。', technicianId: null, point: null,
    restoreP, faultUnits, requiredMinutes: 60, workedMinutes: 0, contributions: {}, funded: payerId === 'player' ? PLAYER_ESCROW : 0, escrow: payerId === 'player' ? PLAYER_ESCROW : 0,
    purchasePaid: 0, serviceFees: 0, refunded: 0, receipts: [], receivedUnits: 0, reusedUnits: 0, reservedUnits: 0, consumedUnits: 0, reservedAt: null, returnedAt: null,
    budgetId: null, approvedAt: null, approvedBy: [], authorizedCap: 0, completedAt: null, cancelledAt: null, retryAt: now };
  if (payerId === 'player') { state.player.money -= PLAYER_ESCROW; ledger(sim, -PLAYER_ESCROW, '能源维修真实托管划入', 'household'); }
  power.repairs.push(job); sim.appendNotice('energy', '已有损失登记维修：60实际技术员分钟、1份工业材料，恢复至多' + restoreP.toFixed(2) + 'P。');
  return { ok: true, message: payerId === 'player' ? '100文进入维修托管；设备尚未修好。' : '公共维修等候法定材料预算；没有100文环形收费。' };
}
function cancelRepair(sim: Simulation, job: PowerRepair): void {
  const power = sim.state.power!;
  if (job.cancelledAt === null) {
    job.cancelledAt = clock(sim.state); power.stock.availableUnits += job.reservedUnits; if (job.reservedUnits > 0) job.returnedAt = clock(sim.state); job.reservedUnits = 0;
    if (job.budgetId) sim.closePublicBudget(job.budgetId);
  }
  if (job.payerId === 'player') {
    const refund = Math.min(job.escrow, Math.max(0, 1e9 - sim.state.player.money));
    if (refund > 0) { sim.state.player.money += refund; job.escrow -= refund; job.refunded += refund; ledger(sim, refund, '能源维修未购未赚款退还', 'household'); }
  }
  job.status = job.escrow > 0 ? 'refundPending' : 'cancelled'; job.reason = '维修停止，已购物料留在真实资产库存；已赚工资不撤销。';
}
function addReceipts(sim: Simulation, job: PowerRepair, receipt: PublicPurchaseReceipt): void {
  const power = sim.state.power!, at = clock(sim.state);
  job.purchasePaid += receipt.paid; job.receivedUnits += receipt.quantity;
  for (const lot of receipt.lots) job.receipts.push({ purchasedAt: at, ...lot, tax: lot.gross - lot.net });
  power.stock.receivedUnits += receipt.quantity; power.stock.availableUnits += receipt.quantity;
}
function supplyRepair(sim: Simulation, job: PowerRepair): void {
  const state = sim.state, power = state.power!;
  if (job.reservedUnits >= MATERIAL_UNITS || ended(job) || job.status === 'refundPending') return;
  if (power.stock.availableUnits >= MATERIAL_UNITS - EPS) {
    power.stock.availableUnits = Math.max(0, power.stock.availableUnits - MATERIAL_UNITS); job.reservedUnits = MATERIAL_UNITS; job.reservedAt = clock(state); job.reusedUnits = Math.max(0, MATERIAL_UNITS - job.receivedUnits); job.status = 'awaitingTechnician'; return;
  }
  if (job.receipts.length + state.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory > 0).length > 512) { job.status = 'awaitingSupply'; job.reason = '真实采购收据已达保存上限；保留全部款料，不再采购。'; return; }
  const missing = MATERIAL_UNITS - power.stock.availableUnits;
  if (job.payerId === 'public') {
    if (!job.budgetId) { job.status = 'awaitingBudget'; return; }
    const quotes = state.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory > 0)
      .map(shop => ({ shopId: shop.id, funds: sim.shopFunds(shop), quote: sim.quoteSupply(shop.id, missing) }))
      .filter(row => row.quote.quantity >= missing - EPS && row.funds + row.quote.unitPrice * missing * (1 - state.taxRate) <= 1e9);
    const fullSupplier = quotes.filter(row => row.quote.unitPrice * missing <= job.authorizedCap - job.purchasePaid + EPS)
      .sort((a, b) => a.quote.unitPrice - b.quote.unitPrice || a.shopId.localeCompare(b.shopId))[0];
    if (quotes.length && !fullSupplier) { job.status = 'awaitingBudget'; job.reason = '实际一份材料报价超过已授权余额；原额度不自动扩大，等待法定新预算。'; return; }
    // The actual purchase must use the full affordable quote just selected.
    // Without a full source, keep the original honest partial-supply path.
    const receipt = sim.purchasePublicSupplyReceipt({ supplierShopIds: fullSupplier ? [fullSupplier.shopId] : undefined, requestedGross: job.authorizedCap - job.purchasePaid, requestedQuantity: missing, districtId: powerBinding(sim.worldDefinition)!.source.districtId,
      siteId: power.operatorSiteId, purpose: 'power-repair', procurementId: job.id, budgetId: job.budgetId, eventType: 'civic-procurement' });
    if (receipt.paid > 0) { addReceipts(sim, job, receipt); job.funded += receipt.paid; ledger(sim, -receipt.paid, '能源维修实际工业材料采购', 'public'); }
    job.reason = receipt.reason === 'budget' ? '真实材料预算不足，已经购买的库存保留。' : '等候工业材料真实供给。';
  } else {
    const suppliers = state.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory >= missing).sort((a, b) => Number(b.districtId === powerBinding(sim.worldDefinition)!.source.districtId) - Number(a.districtId === powerBinding(sim.worldDefinition)!.source.districtId) || a.id.localeCompare(b.id));
    for (const source of suppliers) {
      const quote = sim.quoteSupply(source.id, missing), gross = missing * quote.unitPrice, tax = gross * state.taxRate, net = gross - tax;
      if (quote.quantity + EPS < missing || gross > job.escrow || sim.shopFunds(source) + net > 1e9) continue;
      source.inventory -= missing; sim.transferShopFunds(source, net); source.revenue += gross; source.profit += net;
      job.escrow -= gross; addReceipts(sim, job, { paid: gross, quantity: missing, tax, lots: [{ shopId: source.id, quantity: missing, unitPrice: quote.unitPrice, gross, net }] });
      sim.emitEvent({ type: 'wholesale', shopId: source.id, districtId: source.districtId, amount: gross, quantity: missing, unitPrice: quote.unitPrice, siteId: power.operatorSiteId, procurementId: job.id, purpose: 'power-repair' }); break;
    }
  }
  if (power.stock.availableUnits >= MATERIAL_UNITS - EPS) {
    power.stock.availableUnits = Math.max(0, power.stock.availableUnits - MATERIAL_UNITS); job.reservedUnits = MATERIAL_UNITS; job.reservedAt = clock(state); job.reusedUnits = Math.max(0, MATERIAL_UNITS - job.receivedUnits); job.status = 'awaitingTechnician'; job.reason = '一份材料已实际预约，等候原有技术员履约。';
  } else job.status = job.payerId === 'public' && job.authorizedCap - job.purchasePaid <= EPS ? 'awaitingBudget' : 'awaitingSupply';
}
function approve(sim: Simulation, job: PowerRepair, approvedBy: string[], cap = 40): boolean {
  if (job.payerId !== 'public' || job.budgetId || ended(job) || job.status === 'refundPending') return false;
  const approvedAt = clock(sim.state), id = job.id;
  if (!sim.authorizePublicBudget({ id, siteId: sim.state.power!.operatorSiteId, purpose: 'power-repair', cap, approvedAt, approvedBy })) return false;
  job.budgetId = id; job.authorizedCap = cap; job.approvedAt = approvedAt; job.approvedBy = [...approvedBy]; job.status = 'awaitingSupply'; return true;
}
function requestAt(sim: Simulation, binding: ReturnType<typeof powerBinding>, targetId?: string): boolean {
  if (!binding) return false;
  return [binding.source, binding.operator].some(site => (!targetId || targetId === site.id) && sim.isNearBuilding(site) && canAccessFloor(site, floorOf(site, sim.state.player.position), sim.state.player)
    && (!getBuildingBody(site) || sim.isAtBuildingFunctionPoint(site)));
}
export function installPower(sim: Simulation, accounting: PowerAccounting): void {
  const world = sim.worldDefinition, binding = powerBinding(world);
  let observedState = sim.state, phaseTick = -1, phaseClock = -1;
  const wages = new Map<string, { start: number; end: number; siteId: string; paidWorkClaim?: string }[]>();
  sim.onPhase('time', () => { observedState = sim.state; phaseTick = sim.state.tick; phaseClock = clock(sim.state); wages.clear(); if (sim.state.power) pruneCapacity(sim.state); });
  sim.onEvent('environment-disaster', event => {
    const e = event as PowerEvent;
    if (!binding || !accounting.isCanonicalDisaster(event) || e.districtId !== binding.source.districtId || !finite(e.eventId) || !finite(e.severity) || !finite(e.occurredAt)
      || e.occurredAt !== clock(sim.state) || e.severity < 5 || e.severity > 17 || !Number.isInteger(e.eventId)) return;
    const power = activate(sim, accounting); if (power.faults.some(fault => fault.id === e.eventId)) return;
    const addedLossP = Math.min(96 - power.lossP, e.severity * .93);
    if (addedLossP <= EPS) return;
    power.faults.push({ id: e.eventId, occurredAt: e.occurredAt, districtId: e.districtId, severity: e.severity, addedLossP, repairedP: 0 }); power.lossP += addedLossP;
    sim.appendNotice('power-fault', '真实山洪损伤既有水能设备，持久可用量减少' + addedLossP.toFixed(2) + 'P。', binding.source.districtId);
  });
  sim.onEvent('wage-earned', event => {
    if (!binding || observedState !== sim.state || phaseTick !== sim.state.tick || phaseClock !== clock(sim.state) || event.siteId !== binding.operator.id
      || !event.citizenId || event.citizenId === 'player' && event.purpose !== 'scientist' || !finite(event.minutes) || event.minutes <= 0 || !finite(event.amount) || event.amount < 0
      || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt) || Math.abs(event.creditedWorkEndAt - event.creditedWorkStartAt - event.minutes) > EPS
      || event.creditedWorkEndAt > phaseClock + EPS) return;
    const rows = wages.get(event.citizenId) ?? []; rows.push({ start: event.creditedWorkStartAt, end: event.creditedWorkEndAt, siteId: event.siteId, ...(event.citizenId === 'player' && event.laborJobId ? { paidWorkClaim: 'paid-work:' + event.laborJobId } : {}) }); wages.set(event.citizenId, rows);
  });
  sim.onPhase('energy', (_state, minutes) => dispatchPower(sim, minutes, accounting));
  sim.onPhase('people', (state, minutes) => {
    const power = state.power; if (!power || !binding) return;
    const job = power.repairs.find(item => !ended(item)); if (!job) return;
    const elapsed = Math.max(0, Math.min(minutes, clock(state) - job.lastObservedAt)); job.lastObservedAt = clock(state);
    if (job.status === 'refundPending' || job.payerId === 'player' && !state.extension!.actorProfiles.player.alive) { cancelRepair(sim, job); return; }
    if (job.reservedUnits < MATERIAL_UNITS || elapsed <= 0) { job.reason = '没有预约真实材料，不累积维修分钟。'; return; }
    const candidates: (Citizen | Player)[] = [
      ...state.citizens.filter(actor => actor.workId === binding.operator.id && ['工程师', 'scientist', '科学家'].includes(actor.role)),
      ...(state.playerLabor?.job?.siteId === binding.operator.id && state.playerLabor.job.role === 'scientist' || wages.has('player') ? [state.player] : []),
    ];
    if (job.technicianId) candidates.sort((a, b) => Number(('id' in b ? b.id : 'player') === job.technicianId) - Number(('id' in a ? a.id : 'player') === job.technicianId));
    let credited = 0;
    for (const actor of candidates) {
      const actorId = 'id' in actor ? actor.id : 'player', profile = state.extension!.actorProfiles[actorId];
      if (!profile?.alive || profile.age < 18 || profile.health <= 0 || actor.needs.hunger < 12 || actor.needs.fatigue < 15 || actorId !== 'player' && (actor as Citizen).state !== 'working'
        || actorId === 'player' && (state.player.vehicleId || state.aviation?.activeAircraftId || !sim.hasIdentity('scientist'))) continue;
      const point = job.point ?? actualPoint(sim, binding.operator, actor); if (!point || !bodyAt(sim, binding.operator, point, actor)) continue;
      const lower = Math.max(job.startedAt, clock(state) - elapsed), ranges = (wages.get(actorId) ?? []).map(row => ({ start: Math.max(lower, row.start), end: Math.min(clock(state), row.end) })).filter(row => row.end > row.start).sort((a, b) => a.start - b.start);
      let actual = 0, last = lower;
      for (const row of ranges) { actual += Math.max(0, row.end - Math.max(last, row.start)); last = Math.max(last, row.end); }
      const available = Math.min(elapsed, actual, REPAIR_MINUTES - job.workedMinutes); if (available <= 0) continue;
      if (job.workedMinutes + available >= REPAIR_MINUTES - EPS && job.payerId === 'player' && state.treasury + job.escrow > 1e12) continue;
      const paidClaim = actorId === 'player' ? (wages.get(actorId) ?? []).find(row => row.paidWorkClaim)?.paidWorkClaim : undefined;
      credited = claimFundedActorWork(sim, actorId, job.id, ranges.map(row => ({ startAt: row.start, endAt: row.end })), available, minutes, paidClaim).minutes; if (credited <= 0) continue;
      job.point = point; job.technicianId = actorId; job.workedMinutes += credited;
      const contribution = job.contributions[actorId] ?? { startedAt: Math.max(job.startedAt, clock(state) - minutes), endedAt: clock(state), workedMinutes: 0 }; contribution.endedAt = clock(state); contribution.workedMinutes += credited; job.contributions[actorId] = contribution;
      job.status = 'working'; job.reason = '原岗位真实技术员正在已许可的控制工作点履约。'; break;
    }
    if (credited <= 0) { job.status = 'paused'; job.reason = '本相位没有同一工作点的真实计薪分钟或活动余额；过去债/离场时间不补。'; return; }
    if (job.workedMinutes < REPAIR_MINUTES - EPS) return;
    job.workedMinutes = REPAIR_MINUTES; job.reservedUnits--; job.consumedUnits++; power.stock.consumedUnits++;
    for (const allocation of job.faultUnits) { const fault = power.faults.find(item => item.id === allocation.faultId)!; fault.repairedP += allocation.quantityP; }
    power.lossP = power.faults.reduce((sum, fault) => sum + fault.addedLossP - fault.repairedP, 0);
    if (job.payerId === 'player') { job.serviceFees += job.escrow; state.treasury += job.escrow; ledger(sim, job.escrow, '能源60分钟控制维修已赚服务费', 'public'); job.escrow = 0; }
    if (job.budgetId) sim.closePublicBudget(job.budgetId);
    job.completedAt = clock(state); job.status = 'completed'; job.reason = '已耗1份工业材料并完成60实际分钟；下个energy阶段只恢复既有损失。';
    sim.appendNotice('power-repaired', job.reason, binding.source.districtId);
  });
  sim.onPhase('finance', () => {
    const job = sim.state.power?.repairs.find(item => !ended(item)); if (!job) return;
    if (job.status === 'refundPending') { cancelRepair(sim, job); return; }
    if (clock(sim.state) + EPS >= job.retryAt) { job.retryAt = clock(sim.state) + 60; supplyRepair(sim, job); }
  });
  sim.onPhase('politics', () => {
    const state = sim.state, power = state.power; if (!power || !binding || clock(state) < power.nextPublicReviewAt) return;
    power.nextPublicReviewAt = clock(state) + 60;
    if (!power.repairs.some(job => !ended(job)) && power.lossP > EPS) createRepair(sim, 'public');
    const job = power.repairs.find(item => !ended(item)); if (!job || job.payerId !== 'public' || job.budgetId) return;
    const groups = new Map<string, string[]>();
    for (const actor of state.citizens) {
      const site = world.buildings.find(b => b.id === actor.workId);
      if (!site || !['hall', 'core', 'bank'].includes(site.kind) || !['官员', '财政官', 'official', '议员', 'council'].includes(actor.role) || !sim.isOnDuty(actor.id, site.id)) continue;
      const ids = groups.get(site.id) ?? []; ids.push(actor.id); groups.set(site.id, ids);
    }
    for (const ids of groups.values()) if (ids.length >= 2 && approve(sim, job, ids.slice(0, 2))) break;
  });
  sim.onEvent('research-completed-work', event => {
    if (!sim.state.power || !accounting.isCanonicalResearchCompletion(event)) return;
    const sector = event.purpose!, jobs = Reflect.get(sim.state.extension!, 'runtime').researchJobs, job = jobs[sector];
    if (job?.laborVersion !== 1) { sim.state.power.unobservedResearchCompletions++; return; }
    ensureCapacityWitness(sim.state, { id: 'research:' + sector + ':' + job.startedAt, kind: 'research', actorId: job.actorId, siteId: job.siteId,
      startedAt: job.startedAt, endedAt: clock(sim.state), workedMinutes: job.workedMinutes, sector, level: sim.state.extension!.technologies.find(t => t.sector === sector)!.level, budget: job.budget });
  });
  sim.onEvent('education-ended-work', event => {
    const state = sim.state, course = state.education?.course;
    if (!state.power || !course || course.escrow !== 0 || !['completed', 'cancelled'].includes(course.status) || event.citizenId !== 'player' || event.siteId !== course.siteId) return;
    ensureCapacityWitness(state, { id: 'education:' + course.id, kind: 'education', actorId: course.actorId, siteId: course.siteId, startedAt: course.startedAt, endedAt: course.completedAt ?? course.cancelledAt!, workedMinutes: course.workedMinutes });
  });
  sim.registerCommandHandler(command => {
    if (!['energy', 'cancelEnergy', 'requestEnergyRepair', 'approveEnergyRepair'].includes(command.type)) return null;
    if (!binding) return command.type === 'energy' ? null : { ok: false, message: powerStatus(sim).reason! };
    if (command.type === 'energy') {
      if (!['mayor', 'driver', 'soldier', 'scientist', 'official'].some(role => sim.hasIdentity(role as Role))) return { ok: false, message: '需要原公共工程操作资格。' };
      if (!requestAt(sim, binding, command.targetId)) return { ok: false, message: '请到能源核心或控制院合法功能点申请。' };
      return createRepair(sim, 'player');
    }
    if (command.type === 'requestEnergyRepair') {
      if (!requestAt(sim, binding, command.targetId)) return { ok: false, message: '请在原能源设施现场提交维修需求。' };
      return createRepair(sim, 'public');
    }
    const job = sim.state.power?.repairs.find(item => item.id === command.targetId && !ended(item));
    if (!job) return { ok: false, message: '没有该未结清维修任务。' };
    if (command.type === 'approveEnergyRepair') return { ok: approve(sim, job, ['player'], command.value ?? 40), message: '只有原法定市长现场预算授权成功时材料预算才生效。' };
    if (job.payerId !== 'player' && !sim.hasIdentity('mayor')) return { ok: false, message: '仅原出资人或法定市长可停止该任务。' };
    if (job.payerId === 'public' && !world.buildings.some(site => ['hall', 'core'].includes(site.kind) && sim.isNearBuilding(site) && sim.isAtBuildingFunctionPoint(site))) return { ok: false, message: '公共任务须在法定议事功能点停止。' };
    cancelRepair(sim, job); return { ok: true, message: job.reason };
  });
  sim.registerSaveValidator(candidate => { validatePowerState(candidate, world); if (candidate.power) validateJointActorActivityCapacity(candidate); });
  sim.onLoad(() => { observedState = sim.state; phaseTick = -1; phaseClock = -1; wages.clear(); accounting.legacy(); });
}

/** The old paid boost is a frozen monotonic contract, never a new generator. */
export function validateLegacyEnergyContract(runtime: Record<string, any>, state: SimState, world: WorldDefinition): void {
  const mark = runtime.legacyEnergyContractVersion, old = runtime.legacyEnergyContract;
  if (mark === undefined && old === undefined) {
    if (state.power?.dispatch && state.power.dispatch.legacyP !== 0) throw new Error('供给分表中的旧增能缺少原已付合同。');
    return;
  }
  if (mark !== 1 || !old || typeof old !== 'object' || Array.isArray(old) || !powerBinding(world)) throw new Error('旧增能合同标记或设施引用不完整。');
  const keys = ['version', 'capturedAt', 'sourceDisplayNow', 'sourceDisplayDeadline', 'duration', 'endsAt'];
  if (Object.keys(old).length !== keys.length || Object.keys(old).some(key => !keys.includes(key)) || old.version !== 1) throw new Error('旧增能合同结构无效。');
  const now = clock(state);
  for (const key of keys.filter(key => key !== 'version')) if (!finite(old[key]) || old[key] < 0 || old[key] > 1e12) throw new Error('旧增能合同时间无效。');
  if (old.capturedAt > now || old.duration <= 0 || old.duration > 240 + EPS || old.sourceDisplayDeadline !== runtime.energyBoostUntil
    || Math.abs(old.sourceDisplayDeadline - old.sourceDisplayNow - old.duration) > EPS || Math.abs(old.endsAt - old.capturedAt - old.duration) > EPS)
    throw new Error('旧增能合同期限不守恒；不得续加四小时。');
  const dispatch = state.power?.dispatch;
  if (dispatch && dispatch.legacyP !== (old.capturedAt <= dispatch.at && dispatch.at < old.endsAt ? 20 : 0))
    throw new Error('供给分表旧增能必须属于当时有效的原已付合同。');
}
export function validatePowerState(state: SimState, world: WorldDefinition): void {
  const power = state.power; if (power === undefined) return;
  const ensure = (value: unknown, label: string) => { if (!value) throw new Error('能源存档：' + label); };
  const object = (value: unknown, keys: string[], label: string) => ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)), label);
  const num = (value: unknown, min: number, max: number, label: string, integer = false) => ensure(finite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const close = (a: number, b: number, label: string) => ensure(Math.abs(a - b) < EPS * Math.max(1, Math.abs(a), Math.abs(b)), label);
  const list = <T>(value: unknown, max: number, label: string): T[] => { ensure(Array.isArray(value) && value.length <= max, label); return value as T[]; };
  const binding = powerBinding(world), now = clock(state), actors = new Set(['player', ...state.citizens.map(actor => actor.id)]), sites = new Map(world.buildings.map(site => [site.id, site]));
  ensure(binding, '真实能源设施缺失');
  object(power, ['version','activatedAt','sourceSiteId','operatorSiteId','networkKind','faults','lossP','nextRepairId','repairs','stock','dispatch','buildingMeters','vehicleMeters','totals','capacityHistory','capacityArchive','researchBaseline','unobservedResearchCompletions','nextPublicReviewAt'], '主结构');
  ensure(power.version === 1 && power.sourceSiteId === binding!.source.id && power.operatorSiteId === binding!.operator.id && power.networkKind === 'legacy-city-bus', '资产身份');
  num(power.activatedAt, 0, now, '激活时刻'); num(power.lossP, 0, 96, '真实损失'); num(power.nextRepairId, 1, MAX_REPAIRS + 1, '维修计数', true); num(power.nextPublicReviewAt, 0, now + 60 + EPS, '下次审议');
  const faults = list<PowerFault>(power.faults, 256, '故障数量'), ids = new Set<number>(); let previous = -1;
  for (const fault of faults) {
    object(fault, ['id','occurredAt','districtId','severity','addedLossP','repairedP'], '故障结构'); num(fault.id, 1, 1e12, '灾害事件身份', true);
    ensure(fault.id > previous && !ids.has(fault.id), '灾害事件次序'); ids.add(fault.id); previous = fault.id;
    num(fault.occurredAt, power.activatedAt, now, '灾害时刻'); ensure(fault.districtId === binding!.source.districtId, '源城区灾害'); num(fault.severity, 5, 17, '实际严重度'); num(fault.addedLossP, 0, fault.severity * .93, '新增损失'); num(fault.repairedP, 0, fault.addedLossP + EPS, '修复不得超损');
  }
  const lossEvents = [...faults.map(fault => ({ at: fault.occurredAt, kind: 0, fault, restored: 0 })), ...power.repairs.filter(job => job.status === 'completed').map(job => ({ at: job.completedAt!, kind: 1, fault: null, restored: job.restoreP }))].sort((a,b) => a.at - b.at || a.kind - b.kind);
  let chronologicalLoss = 0; for (const event of lossEvents) { if (event.fault) { close(event.fault.addedLossP, Math.min(96 - chronologicalLoss, event.fault.severity * .93), '原生严重度与当时剩余容量'); chronologicalLoss += event.fault.addedLossP; } else chronologicalLoss -= event.restored; ensure(chronologicalLoss >= -EPS && chronologicalLoss <= 96 + EPS, '故障修复时间前缀'); }
  close(chronologicalLoss, power.lossP, '当时损伤不能借未来修复');
  close(power.lossP, faults.reduce((sum, fault) => sum + fault.addedLossP - fault.repairedP, 0), '损失与故障守恒');
  const repaired = new Map<number, number>(), repairs = list<PowerRepair>(power.repairs, MAX_REPAIRS, '维修任务数量'), jobIds = new Set<string>(); let active = 0, received = 0, consumed = 0, reserved = 0;
  for (let index = 0; index < repairs.length; index++) {
    const job = repairs[index];
    object(job, ['id','payerId','startedAt','lastObservedAt','status','reason','technicianId','point','restoreP','faultUnits','requiredMinutes','workedMinutes','contributions','funded','escrow','purchasePaid','serviceFees','refunded','receipts','receivedUnits','reusedUnits','reservedUnits','consumedUnits','reservedAt','returnedAt','budgetId','approvedAt','approvedBy','authorizedCap','completedAt','cancelledAt','retryAt'], '维修结构');
    if (index > 0) ensure(job.startedAt >= (repairs[index - 1].completedAt ?? repairs[index - 1].cancelledAt ?? now), '旧任务先结清再开新任务');
    ensure(job.id === 'power-repair-' + (index + 1) && !jobIds.has(job.id), '维修身份'); jobIds.add(job.id);
    ensure(['player','public'].includes(job.payerId) && ['awaitingBudget','awaitingSupply','awaitingTechnician','working','paused','completed','cancelled','refundPending'].includes(job.status), '维修状态');
    ensure(typeof job.reason === 'string' && job.reason.length <= 1000, '暂停原因'); num(job.startedAt, power.activatedAt, now, '任务起点'); num(job.lastObservedAt, job.startedAt, now, '观察时刻'); num(job.retryAt, 0, now + 60 + EPS, '采购重试');
    num(job.restoreP, EPS, REPAIR_P, '最多恢复5P'); ensure(job.requiredMinutes === REPAIR_MINUTES, '明确60分钟配方'); num(job.workedMinutes, 0, REPAIR_MINUTES, '已赚分钟');
    const allocations = list<{faultId: number;quantityP: number}>(job.faultUnits, faults.length, '故障预约'); const seen = new Set<number>(); let restoring = 0;
    for (const allocation of allocations) { object(allocation, ['faultId','quantityP'], '故障份额'); const fault = faults.find(item => item.id === allocation.faultId); ensure(fault && fault.occurredAt <= job.startedAt && !seen.has(allocation.faultId), '预约已经发生的故障引用'); seen.add(allocation.faultId); num(allocation.quantityP, EPS, fault!.addedLossP, '预约损失'); restoring += allocation.quantityP; if (job.status === 'completed') repaired.set(allocation.faultId, (repaired.get(allocation.faultId) ?? 0) + allocation.quantityP); }
    close(job.restoreP, restoring, '恢复预约守恒');
    ensure(job.contributions && typeof job.contributions === 'object' && !Array.isArray(job.contributions) && Object.keys(job.contributions).length <= actors.size, '贡献者集合'); let worked = 0;
    for (const [actorId, contribution] of Object.entries(job.contributions)) { ensure(actors.has(actorId), '真实劳动者引用'); object(contribution, ['startedAt','endedAt','workedMinutes'], '贡献结构'); num(contribution.startedAt, job.startedAt, now, '贡献起点'); num(contribution.endedAt, contribution.startedAt, job.completedAt ?? job.cancelledAt ?? now, '贡献真实终点'); num(contribution.workedMinutes, EPS, Math.min(REPAIR_MINUTES, contribution.endedAt - contribution.startedAt) + EPS, '贡献分钟容量'); worked += contribution.workedMinutes; }
    close(worked, job.workedMinutes, '维修劳动守恒');
    ensure(job.technicianId === null ? job.point === null && job.workedMinutes === 0 : actors.has(job.technicianId) && job.point !== null && Object.hasOwn(job.contributions, job.technicianId), '技术员及工作点');
    if (job.point) { object(job.point, ['id','floor','position'], '工作点结构'); ensure(typeof job.point.id === 'string' && job.point.id.length <= 160, '工作点身份'); num(job.point.floor, -(binding!.operator.basements ?? 0), binding!.operator.floors - 1, '工作点楼层', true); object(job.point.position, ['x','y','z'], '工作点坐标'); for (const key of ['x','y','z'] as const) num(job.point.position[key], -world.size * 2, world.size * 2, '工作点范围');
      if (getBuildingBody(binding!.operator)) ensure(points(binding!.operator).some(point => point.id === job.point!.id && point.purpose === 'work' && point.floor === job.point!.floor && distance(point.position, job.point!.position) < EPS), '权威控制工作点');
      else ensure(job.point.id === 'legacy:' + binding!.operator.id + ':' + job.point.floor, '旧未标工作点契约');
    }
    for (const key of ['funded','escrow','purchasePaid','serviceFees','refunded','authorizedCap'] as const) num(job[key], 0, 1e6, '资金.' + key);
    close(job.funded, job.escrow + job.purchasePaid + job.serviceFees + job.refunded, '托管资金守恒');
    if (job.payerId === 'player') ensure(job.funded === PLAYER_ESCROW && job.budgetId === null && job.approvedAt === null && job.approvedBy.length === 0 && job.authorizedCap === 0, '玩家实付100契约');
    else { ensure(job.escrow === 0 && job.serviceFees === 0 && job.refunded === 0 && job.funded === job.purchasePaid, '公共仅实际材料款'); ensure(job.budgetId === null ? job.approvedAt === null && job.approvedBy.length === 0 && job.authorizedCap === 0 : job.budgetId === job.id && job.approvedAt !== null && job.authorizedCap > 0 && job.purchasePaid <= job.authorizedCap + EPS, '材料预算标记'); if (job.approvedAt !== null) num(job.approvedAt, job.startedAt, job.completedAt ?? job.cancelledAt ?? now, '授权不得晚于结清'); }
    ensure(Array.isArray(job.approvedBy) && job.approvedBy.length <= 16 && new Set(job.approvedBy).size === job.approvedBy.length && job.approvedBy.every(id => actors.has(id)), '原署名人');
    const receipts = list<PowerReceipt>(job.receipts, 512, '实际材料收据'); let paid = 0, units = 0;
    for (const receipt of receipts) { object(receipt, ['purchasedAt','shopId','quantity','unitPrice','gross','net','tax'], '收据结构'); const shop = state.shops.find(shop => shop.id === receipt.shopId), site = shop && sites.get(shop.buildingId); ensure(site && site.kind === 'workshop' && !site.facility, '真实工业材料来源'); num(receipt.purchasedAt, job.startedAt, job.completedAt ?? job.cancelledAt ?? now, '采购不得晚于结清'); num(receipt.quantity, EPS, MATERIAL_UNITS + EPS, '有限采购量'); num(receipt.unitPrice, 4, 1e6, '实际议价'); num(receipt.gross, EPS, 1e6, '实际付款'); num(receipt.net, 0, receipt.gross, '供应商净款'); num(receipt.tax, 0, receipt.gross * .3 + EPS, '当时税款'); close(receipt.gross, receipt.quantity * receipt.unitPrice, '成交价'); close(receipt.gross, receipt.net + receipt.tax, '净款税守恒'); paid += receipt.gross; units += receipt.quantity; }
    close(paid, job.purchasePaid, '收据付款来源'); close(units, job.receivedUnits, '收据物料来源');
    for (const key of ['receivedUnits','reusedUnits','reservedUnits','consumedUnits'] as const) num(job[key], 0, MATERIAL_UNITS + EPS, '任务材料.' + key);
    ensure(job.reservedUnits === 0 || job.reservedUnits === MATERIAL_UNITS, '只有完整材料预约'); ensure(job.consumedUnits === 0 || job.consumedUnits === MATERIAL_UNITS, '只有完整材料耗用');
    ensure(job.reservedAt === null ? job.reservedUnits === 0 && job.consumedUnits === 0 && job.reusedUnits === 0 && job.returnedAt === null : finite(job.reservedAt) && job.reservedAt >= job.startedAt && job.reservedAt <= (job.completedAt ?? job.cancelledAt ?? now), '预约真实时刻');
    ensure(job.returnedAt === null || job.returnedAt === job.cancelledAt && job.reservedAt !== null, '退库真实时刻');
    if (job.reservedUnits + job.consumedUnits > 0) close(job.receivedUnits + job.reusedUnits, MATERIAL_UNITS, '新购与复用份额');
    if (job.status === 'completed') { ensure(job.completedAt !== null && job.cancelledAt === null && job.workedMinutes === REPAIR_MINUTES && job.consumedUnits === MATERIAL_UNITS && job.reservedUnits === 0 && job.escrow === 0, '已完成实际配方'); num(job.completedAt, job.startedAt + REPAIR_MINUTES - EPS, now, '完成最早时刻'); }
    else { ensure(job.completedAt === null && job.consumedUnits === 0, '未完成不得恢复设备'); if (['cancelled','refundPending'].includes(job.status)) { ensure(job.cancelledAt !== null && job.reservedUnits === 0, '停止退库'); num(job.cancelledAt, job.startedAt, now, '停止时刻'); ensure(job.status === 'refundPending' ? job.escrow > 0 : job.escrow === 0, '真实退款待办'); } else { active++; ensure(job.cancelledAt === null && job.workedMinutes < REPAIR_MINUTES, '在办状态'); } }
    if (job.status === 'refundPending') active++;
    received += job.receivedUnits; consumed += job.consumedUnits; reserved += job.reservedUnits;
  }
  const materialEvents: { at: number; delta: number; order: number }[] = [];
  for (const job of repairs) { for (const receipt of job.receipts) materialEvents.push({ at: receipt.purchasedAt, delta: receipt.quantity, order: 0 }); if (job.reservedAt !== null) materialEvents.push({ at: job.reservedAt, delta: -MATERIAL_UNITS, order: 1 }); if (job.returnedAt !== null) materialEvents.push({ at: job.returnedAt, delta: MATERIAL_UNITS, order: 0 }); }
  let availableAtTime = 0; for (const event of materialEvents.sort((a, b) => a.at - b.at || a.order - b.order)) { availableAtTime += event.delta; ensure(availableAtTime >= -EPS, '时间前缀不能借未来购料'); }
  close(availableAtTime, power.stock.availableUnits, '库存时间前缀与当前一致');
  ensure(active <= 1 && power.nextRepairId === repairs.length + 1, '仅一项未结任务');
  for (const fault of faults) close(fault.repairedP, repaired.get(fault.id) ?? 0, '修复仅来自已完成配方');
  object(power.stock, ['receivedUnits','consumedUnits','availableUnits'], '物料库存'); for (const value of Object.values(power.stock)) num(value, 0, MAX_REPAIRS, '库存数量'); close(power.stock.receivedUnits, received, '库存采购来源'); close(power.stock.consumedUnits, consumed, '库存耗用来源'); close(received, consumed + reserved + power.stock.availableUnits, '全物料守恒');
  object(power.totals, ['suppliedPMinutes','demandedPMinutes','unservedPMinutes','curtailedPMinutes'], '计量统计'); for (const value of Object.values(power.totals)) num(value, 0, 1e15, '计量范围'); close(power.totals.demandedPMinutes, power.totals.suppliedPMinutes + power.totals.unservedPMinutes, '累计用电需求守恒');
  if (power.dispatch === null) ensure(Object.keys(power.buildingMeters).length === 0 && Object.keys(power.vehicleMeters).length === 0 && Object.values(power.totals).every(value => value === 0), '首次真实供给前不得虚计');
  else {
    const dispatch = power.dispatch; object(dispatch, ['tick','at','minutes','baseP','equipmentLossP','legacyP','publicSupply','availableP','demandP','servedP','unservedP','curtailedP'], '供给结构'); num(dispatch.tick, 0, state.tick, '计量相位', true); num(dispatch.at, power.activatedAt, now, '计量时刻'); num(dispatch.minutes, EPS, 4, '计量分钟'); num(dispatch.baseP, 90, 96, '唯一原93±3来源'); num(dispatch.equipmentLossP, 0, 96, '当时设备损失'); ensure(dispatch.legacyP === 0 || dispatch.legacyP === 20, '旧单独增能合同'); num(dispatch.publicSupply, 0, 1, '原运维覆盖');
    for (const key of ['availableP','demandP','servedP','unservedP','curtailedP'] as const) num(dispatch[key], 0, 1e6, '计量.' + key);
    close(dispatch.availableP, (Math.max(0, dispatch.baseP - dispatch.equipmentLossP) + dispatch.legacyP) * (.35 + .65 * dispatch.publicSupply), '无第二电源'); close(dispatch.availableP, dispatch.servedP + dispatch.curtailedP, '供给去向'); close(dispatch.demandP, dispatch.servedP + dispatch.unservedP, '需求去向');
    const meterMap = (map: Record<string, PowerMeter>, expected: Set<string>): number[] => { ensure(map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length === expected.size && Object.keys(map).every(id => expected.has(id)), '计量实体引用'); let demanded = 0, served = 0, unserved = 0; for (const meter of Object.values(map)) { object(meter, ['demandP','servedP','unservedP'], '计量实体'); for (const value of Object.values(meter)) num(value, 0, 1e6, '计量实体值'); close(meter.demandP, meter.servedP + meter.unservedP, '实体需求守恒'); demanded += meter.demandP; served += meter.servedP; unserved += meter.unservedP; } return [demanded,served,unserved]; };
    const a = meterMap(power.buildingMeters, new Set(world.buildings.map(site => site.id))), b = meterMap(power.vehicleMeters, new Set(state.vehicles.map(vehicle => vehicle.id))); close(a[0] + b[0], dispatch.demandP, '分表总需求'); close(a[1] + b[1], dispatch.servedP, '分表总实供'); close(a[2] + b[2], dispatch.unservedP, '分表总缺口');
  }
  const history = list<ActivityCapacityWitness>(power.capacityHistory, MAX_WITNESSES, '有界劳动见证'), witnessIds = new Set<string>(); let research = 0;
  for (const witness of history) {
    const keys = ['id','kind','actorId','siteId','startedAt','endedAt','workedMinutes', ...(witness.kind === 'research' ? ['sector','level','budget'] : [])]; object(witness, keys, '劳动见证结构'); ensure(!witnessIds.has(witness.id) && actors.has(witness.actorId) && sites.has(witness.siteId), '劳动见证身份'); witnessIds.add(witness.id); num(witness.startedAt, 0, now, '见证起点'); num(witness.endedAt, witness.startedAt, now, '真实终点'); num(witness.workedMinutes, 0, witness.endedAt - witness.startedAt + EPS, '实际分钟必要容量');
    if (witness.kind === 'research') { research++; ensure(state.extension!.technologies.some(tech => tech.sector === witness.sector) && witness.id === 'research:' + witness.sector + ':' + witness.startedAt, '科研事件引用'); num(witness.level, 1, 20, '完成等级', true); num(witness.budget, 100, 2000, '原科研预算', true); ensure(state.extension!.technologies.find(tech => tech.sector === witness.sector)!.level >= witness.level!, '完成见证不早于实际科技等级'); close(witness.workedMinutes, 120, '完成科研实际劳动'); }
    else { ensure(witness.kind === 'education' && witness.actorId === 'player' && witness.id.startsWith('education:'), '原课程见证'); const course = [...(state.education?.history ?? []), ...(state.education?.course ? [state.education.course] : [])].find(course => 'education:' + course.id === witness.id); if (course) ensure(course.siteId === witness.siteId && course.startedAt === witness.startedAt && course.workedMinutes === witness.workedMinutes && (course.completedAt ?? course.cancelledAt) === witness.endedAt, '保留课程交叉'); }
  }
  object(power.capacityArchive, ['count','minutes','researchCount','educationCount'], '仅已结清统计归档'); for (const key of ['count','researchCount','educationCount'] as const) num(power.capacityArchive[key], 0, 1e10, '归档次数', true); num(power.capacityArchive.minutes, 0, 1e12, '归档分钟'); ensure(power.capacityArchive.count === power.capacityArchive.researchCount + power.capacityArchive.educationCount, '归档种类');
  num(power.researchBaseline, 0, state.extension!.stats.researchCompleted, '不伪造旧科研历史', true); num(power.unobservedResearchCompletions, 0, 1e10, '旧合同无劳动史', true); ensure(power.researchBaseline + research + power.capacityArchive.researchCount + power.unobservedResearchCompletions === state.extension!.stats.researchCompleted, '新完成科研见证不得遗漏');
}
/** Kept in core's pre-commit import validation because its budgets are private runtime. */
export function validatePowerBudgetCrossReferences(state: SimState, budgets: { id: string;siteId: string;purpose: string;cap: number;spent: number;approvedAt: number;approvedBy: string[];closedAt: number | null }[]): void {
  const relevant = budgets.filter(budget => budget.purpose === 'power-repair');
  if (!state.power && relevant.length) throw new Error('维修预算缺少真实任务。');
  for (const job of state.power?.repairs ?? []) if (job.budgetId) {
    const budget = relevant.find(budget => budget.id === job.budgetId);
    if (!budget || budget.siteId !== state.power!.operatorSiteId || budget.cap !== job.authorizedCap || Math.abs(budget.spent - job.purchasePaid) > EPS || budget.approvedAt !== job.approvedAt || JSON.stringify([...budget.approvedBy].sort()) !== JSON.stringify([...job.approvedBy].sort()) || (budget.closedAt !== null) !== (ended(job) || job.status === 'refundPending')) throw new Error('维修材料预算与在办/结清任务不一致。');
  }
  for (const budget of relevant) if (!state.power?.repairs.some(job => job.budgetId === budget.id)) throw new Error('维修授权缺少任务引用。');
}
