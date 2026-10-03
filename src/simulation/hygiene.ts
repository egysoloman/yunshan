import type { Simulation } from '../simulation';
import { blocksFloorPlanMovement, getBuildingBody } from '../architecture-floor-plan';
import { clinicalAtSite, clinicalDoctorWorkWindows, clinicalDoctorUsedWorkWindows, clinicalServiceStationsAtPosition } from './clinical';
import { actorActivityAvailable, claimActorActivityMinutes } from './activity-minutes';
import { collectActorActivityClaims, type ActorActivityClaim } from './activity-capacity';
import { powerSupplyAt } from './power';
import { homeRestPointBlockedByVoxels } from './home-rest';
import { recordWasteContact, yv1WasteSourceAt } from './pathology';
import { findPublicHealthConsumption, publicHealthConsumption } from './culture';
import type { Building, Citizen, CommandResult, SimState, Vec3, WorldDefinition } from '../types';

/** Gameplay units, not chemical mass or a licensed terminal disposal facility. */
export const HYGIENE_RULESET = 'clinic-manual-disinfection-v1' as const;
const EPS = 1e-7, MINUTES = 10, CAPACITY = 8, CASH_LIMIT = 1e9, HISTORY = 64, MAX_STAFF = 16, MAX_WITNESSES = 2048;
const clock = (state: SimState) => state.extension!.lastUpdate;
const terminal = (job: DisinfectionJob) => job.state === 'completed' || job.state === 'cancelled';
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export interface ClinicalWasteSourceReceipt { kind?: undefined; orderId: string; patientId: string; completedAt: number; clinicalConsumedAtSite: number; quantity: 1 }
export interface PublicHealthWasteSourceReceipt { kind: 'public-health'; sourceId: string; orderId: string; patientId: string; completedAt: number; publicConsumedAtOrder: number; quantity: 1 }
export type WasteSourceReceipt = ClinicalWasteSourceReceipt | PublicHealthWasteSourceReceipt;
export interface WasteSourceArchive { count: number; firstOrderId: string | null; lastOrderId: string | null; firstAt: number | null; lastAt: number | null }
export interface WastePathogenSource { pathogenId: 'YV1'; episodeId: string; actorId: string; rootReceiptId: string; infectiousFrom: number; infectiousUntil: number; contaminatedAt: number }
export interface WasteBatch {
  sourceKind?: 'public-health';
  id: string; siteId: string; floor: number; pointId: string; point: Vec3; patientId: string;
  material: 'used-clinical-material'; hazard: 'used-material' | 'YV1'; pathogenSource: WastePathogenSource | null;
  generatedUnits: number; contaminatedUnits: number; reservedUnits: number; sealedUnits: number; cleaningResidualUnits: number;
  containedUnits: number; archivedProcessedUnits: number; sourceReceipts: WasteSourceReceipt[]; sourceArchive: WasteSourceArchive; firstAt: number; lastAt: number;
}
export interface HygieneReceipt { shopId: string; purchasedAt: number; quantity: 1; unitPrice: number; gross: number; net: number; tax: number }
export interface HygieneStaffWindow { startedAt: number; endedAt: number; workedMinutes: number; siteId: string; role: '医生' | 'doctor'; ageAtStart: number }
export interface DisinfectionJob {
  id: string; batchId: string; siteId: string; payerId: 'player'; startedAt: number; lastObservedAt: number;
  state: 'awaitingSupply' | 'waiting' | 'processing' | 'refundPending' | 'completed' | 'cancelled'; reason: string;
  funded: number; escrow: number; purchasePaid: number; refunded: number; receipt: HygieneReceipt | null;
  receivedUnits: number; reusedUnits: number; reservedUnits: number; consumedUnits: number;
  requiredMinutes: 10; workedMinutes: number; staffMinutes: Record<string, number>; staffWindows: Record<string, HygieneStaffWindow>; retryAt: number;
  completedAt: number | null; cancelledAt: number | null;
}
export interface HygieneStock { receivedUnits: number; availableUnits: number; consumedUnits: number; archivedReceived: number; archivedConsumed: number }
export interface HygieneTotals { funded: number; purchasePaid: number; refunded: number; workedMinutes: number; completed: number; cancelled: number }
export interface HygieneState {
  version: 1; rulesetId: typeof HYGIENE_RULESET; nextBatchId: number; nextJobId: number; activatedAt: number; lastObservedAt: number;
  clinicalBaseline: Record<string, number>; batches: WasteBatch[]; jobs: DisinfectionJob[]; stock: Record<string, HygieneStock>;
  stats: HygieneTotals; archived: HygieneTotals & { count: number }; capacityHistory: ActorActivityClaim[];
}
const zero = (): HygieneTotals => ({ funded: 0, purchasePaid: 0, refunded: 0, workedMinutes: 0, completed: 0, cancelled: 0 });
const emptyArchive = (): WasteSourceArchive => ({ count: 0, firstOrderId: null, lastOrderId: null, firstAt: null, lastAt: null });
const observations = new WeakMap<Simulation, { state: SimState; consumed: Map<string, number> }>();
const contacts = new WeakMap<SimState, { tick: number; at: number; records: Map<string, { actorId: string; batchId: string; ranges: { start: number; end: number }[] }> }>();
/** Detached current-phase certification. A direct observer cannot manufacture
 * a wage/arrival window or revive a historical contact after load. */
export function hygieneContactWindows(simulation: Simulation, actorId: string, operationId: string, batchId: string): readonly Readonly<{ start: number; end: number }>[] {
  const state = simulation.state, phase = contacts.get(state), record = phase?.records.get(operationId);
  if (!phase || phase.tick !== state.tick || phase.at !== clock(state) || !record || record.actorId !== actorId || record.batchId !== batchId) return Object.freeze([]);
  return Object.freeze(record.ranges.map(range => Object.freeze({ ...range })));
}
function observed(simulation: Simulation) {
  let item = observations.get(simulation);
  if (!item || item.state !== simulation.state) {
    item = { state: simulation.state, consumed: new Map(Object.entries(simulation.state.clinical?.stock ?? {}).map(([id, stock]) => [id, stock.consumedUnits])) };
    observations.set(simulation, item);
  }
  return item;
}
function activate(simulation: Simulation): HygieneState {
  const state = simulation.state;
  if (!state.hygiene) {
    state.hygiene = { version: 1, rulesetId: HYGIENE_RULESET, nextBatchId: 1, nextJobId: 1, activatedAt: clock(state), lastObservedAt: clock(state), clinicalBaseline: Object.fromEntries([...observed(simulation).consumed].filter(([, units]) => units > 0)), batches: [], jobs: [], stock: {}, stats: zero(), archived: { ...zero(), count: 0 }, capacityHistory: [] };
    Reflect.set(Reflect.get(simulation, 'runtime'), 'hygieneVersion', 1);
  }
  return state.hygiene;
}
function stock(state: SimState, siteId: string): HygieneStock { return state.hygiene!.stock[siteId] ??= { receivedUnits: 0, availableUnits: 0, consumedUnits: 0, archivedReceived: 0, archivedConsumed: 0 }; }
function actorIdentity(_person: Citizen) { return { role: 'traveler' as const, identities: ['traveler' as const] }; }
function batchStation(simulation: Simulation, batch: WasteBatch, position: Vec3, person: SimState['player'] | Citizen): boolean {
  const site = simulation.worldDefinition.buildings.find(site => site.id === batch.siteId);
  if (!site || site.kind !== 'clinic' || homeRestPointBlockedByVoxels(position, simulation.state.voxels)) return false;
  const identity = person === simulation.state.player ? simulation.state.player : actorIdentity(person as Citizen);
  if (getBuildingBody(site)) return clinicalServiceStationsAtPosition(site, position, identity, simulation.state.voxels).some(point => point.id === batch.pointId && point.floor === batch.floor && distance(point.position, batch.point) < EPS && !blocksFloorPlanMovement(site, point.floor, position, position, .35, 1.72) && !blocksFloorPlanMovement(site, point.floor, point.position, point.position, .35, 1.72));
  const id = person === simulation.state.player ? 'player' : (person as Citizen).id;
  return clinicalAtSite(simulation, site, id) && Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors))) === batch.floor && distance(position, batch.point) <= 2;
}
/** Fine processing affects only qualified existing staff attached to real jobs. */
export function hygieneNeedsContinuousPeople(state: SimState, person: Citizen): boolean {
  const profile = state.extension?.actorProfiles[person.id];
  return ['医生', 'doctor'].includes(person.role) && !!profile?.alive && profile.age >= 18 && !!state.hygiene?.jobs.some(job => !terminal(job) && job.cancelledAt === null && job.siteId === person.workId);
}
function occupied(state: SimState, batch: WasteBatch): number { return state.hygiene!.batches.filter(other => other.siteId === batch.siteId && other.pointId === batch.pointId && other.floor === batch.floor).reduce((sum, other) => sum + other.containedUnits, 0); }
function collectNewUnits(state: SimState, batch: WasteBatch, units: number): void { batch.containedUnits += Math.min(units, Math.max(0, CAPACITY - occupied(state, batch))); }
function ledger(simulation: Simulation, job: DisinfectionJob, amount: number, purpose: string): void {
  const state = simulation.state, districtId = simulation.worldDefinition.buildings.find(site => site.id === job.siteId)!.districtId;
  state.extension!.publicLedger.push({ tick: state.tick, actorId: 'player', amount, purpose, account: 'household', districtId });
  if (state.extension!.publicLedger.length > 512) state.extension!.publicLedger.splice(0, state.extension!.publicLedger.length - 512);
}
function refund(simulation: Simulation, job: DisinfectionJob): void {
  const amount = Math.min(job.escrow, Math.max(0, CASH_LIMIT - simulation.state.player.money));
  if (amount > 0) { simulation.state.player.money += amount; job.escrow -= amount; job.refunded += amount; simulation.state.hygiene!.stats.refunded += amount; ledger(simulation, job, amount, '卫生采购未花托管款退款'); }
}
function stop(simulation: Simulation, job: DisinfectionJob): void {
  const state = simulation.state;
  if (job.cancelledAt === null) {
    job.cancelledAt = clock(state); state.hygiene!.stats.cancelled++;
    state.hygiene!.batches.find(batch => batch.id === job.batchId)!.reservedUnits--;
    stock(state, job.siteId).availableUnits += job.reservedUnits; job.reservedUnits = 0;
  }
  refund(simulation, job); job.state = job.escrow > 0 ? 'refundPending' : 'cancelled';
  job.reason = job.state === 'refundPending' ? '处理已停止；钱包容量不足，原资金继续托管。' : '处理已取消；已赚分钟保留，原污染用品和已购物料仍由诊所保管。';
}
function finishRefund(simulation: Simulation, job: DisinfectionJob): void { refund(simulation, job); if (job.escrow === 0) job.state = job.completedAt !== null ? 'completed' : 'cancelled'; }
function archive(state: SimState): void {
  const h = state.hygiene!;
  while (h.jobs.length > HISTORY) {
    const index = h.jobs.findIndex(job => terminal(job) && job.escrow === 0); if (index < 0) break;
    const [job] = h.jobs.splice(index, 1), s = stock(state, job.siteId); h.archived.count++;
    for (const [actorId, period] of Object.entries(job.staffWindows)) h.capacityHistory.push({ id: `hygiene:${job.id}:${actorId}`, actorId, startedAt: period.startedAt, endedAt: period.endedAt, workedMinutes: period.workedMinutes });
    if (job.completedAt !== null) h.batches.find(batch => batch.id === job.batchId)!.archivedProcessedUnits++;
    for (const key of ['funded', 'purchasePaid', 'refunded', 'workedMinutes'] as const) h.archived[key] += job[key];
    h.archived.completed += Number(job.completedAt !== null); h.archived.cancelled += Number(job.cancelledAt !== null);
    s.archivedReceived += job.receivedUnits; s.archivedConsumed += job.consumedUnits;
  }
}
function procure(simulation: Simulation, job: DisinfectionJob): void {
  const state = simulation.state;
  if (job.reservedUnits || job.retryAt > clock(state)) return;
  const s = stock(state, job.siteId);
  if (s.availableUnits >= 1) { s.availableUnits--; job.reusedUnits = 1; job.reservedUnits = 1; job.state = 'waiting'; return; }
  job.retryAt = clock(state) + 60;
  const site = simulation.worldDefinition.buildings.find(site => site.id === job.siteId)!;
  const offers = state.shops.filter(shop => simulation.shopCommodity(shop) === 'materials' && shop.inventory >= 1).map(shop => ({ shop, quote: simulation.quoteSupply(shop.id, 1) })).filter(({ shop, quote }) => quote.quantity >= 1 && Number.isFinite(quote.unitPrice) && quote.unitPrice > 0 && quote.unitPrice <= job.escrow && simulation.shopFunds(shop) + quote.unitPrice * (1 - state.taxRate) <= CASH_LIMIT).sort((a, b) => Number(b.shop.districtId === site.districtId) - Number(a.shop.districtId === site.districtId) || a.quote.unitPrice - b.quote.unitPrice || a.shop.id.localeCompare(b.shop.id));
  const offer = offers[0]; if (!offer) { job.reason = '等候真实工作坊材料和托管预算；没有免费消毒用品。'; return; }
  const gross = offer.quote.unitPrice, tax = gross * state.taxRate, net = gross - tax;
  offer.shop.inventory--; simulation.transferShopFunds(offer.shop, net); offer.shop.revenue += gross; offer.shop.profit += net;
  job.escrow -= gross; job.purchasePaid += gross; job.receivedUnits = 1; job.reservedUnits = 1; job.state = 'waiting'; s.receivedUnits++; state.hygiene!.stats.purchasePaid += gross;
  job.receipt = { shopId: offer.shop.id, purchasedAt: clock(state), quantity: 1, unitPrice: gross, gross, net, tax };
  ledger(simulation, job, -gross, '卫生独立真实材料采购');
  simulation.emitEvent({ type: 'wholesale', shopId: offer.shop.id, districtId: offer.shop.districtId, amount: gross, quantity: 1, unitPrice: gross, siteId: job.siteId, procurementId: `${job.id}:materials`, purpose: 'hygiene-material' });
}
export function beginDisinfection(simulation: Simulation, batchId: string, budget = 20): CommandResult {
  const state = simulation.state, h = state.hygiene, batch = h?.batches.find(batch => batch.id === batchId);
  const fail = (message: string): CommandResult => ({ ok: false, message });
  if (!batch || batch.contaminatedUnits - batch.reservedUnits < 1) return fail('当前没有可认领的真实用后材料。');
  if (!state.extension!.actorProfiles.player.alive || state.extension!.actorProfiles.player.age < 18 || !batchStation(simulation, batch, state.player.position, state.player) || state.player.vehicleId || state.aviation?.activeAircraftId) return fail('请到原诊所废物保管的真实公共服务站提交采购。');
  if (!Number.isFinite(budget) || budget <= 0 || budget > 1e6 || state.player.money < budget || state.player.money > CASH_LIMIT) return fail('请提供钱包可支付的有限卫生采购托管预算。');
  if (h!.jobs.filter(job => !terminal(job)).length >= HISTORY || h!.nextJobId >= 1e9 || h!.capacityHistory.length >= MAX_WITNESSES - HISTORY * MAX_STAFF || h!.jobs.some(job => job.batchId === batch.id && !terminal(job))) return fail('原批次处理、退款或劳动容量档案尚未结清，不能重复认领。');
  if (!state.citizens.some(person => person.workId === batch.siteId && ['医生', 'doctor'].includes(person.role) && state.extension!.actorProfiles[person.id]?.alive && state.extension!.actorProfiles[person.id].age >= 18)) return fail('原诊所没有在册成年操作人员。');
  const s = stock(state, batch.siteId), reuse = Math.min(1, s.availableUnits);
  const job: DisinfectionJob = { id: `disinfection-${h!.nextJobId++}`, batchId, siteId: batch.siteId, payerId: 'player', startedAt: clock(state), lastObservedAt: clock(state), state: reuse ? 'waiting' : 'awaitingSupply', reason: '采购预算已真实托管；等候独立材料、供能与在场工作人员10个已计薪分钟。', funded: budget, escrow: budget, purchasePaid: 0, refunded: 0, receipt: null, receivedUnits: 0, reusedUnits: reuse, reservedUnits: reuse, consumedUnits: 0, requiredMinutes: MINUTES, workedMinutes: 0, staffMinutes: {}, staffWindows: {}, retryAt: clock(state), completedAt: null, cancelledAt: null };
  state.player.money -= budget; s.availableUnits -= reuse; batch.reservedUnits++; h!.jobs.push(job); h!.stats.funded += budget; ledger(simulation, job, -budget, '卫生采购预算进入托管');
  return { ok: true, message: job.reason };
}
export function installHygiene(simulation: Simulation): void {
  observed(simulation);
  simulation.onLoad(() => { observations.delete(simulation); observed(simulation); });
  simulation.onEvent('clinical-completed', event => {
    const state = simulation.state, order = state.clinical?.orders.find(order => order.id === event.procurementId), prior = observed(simulation);
    if (!order || order.state !== 'completed' || order.consumedUnits !== 1 || order.completedAt !== clock(state) || event.siteId !== order.siteId || event.citizenId !== order.patientId || event.quantity !== 1) return;
    const consumed = state.clinical!.stock[order.siteId]?.consumedUnits ?? 0, previous = prior.consumed.get(order.siteId) ?? 0;
    if (consumed !== previous + 1) return;
    const person = order.patientId === 'player' ? state.player : state.citizens.find(person => person.id === order.patientId), site = simulation.worldDefinition.buildings.find(site => site.id === order.siteId);
    if (!person || !site) return;
    const identity = person === state.player ? state.player : actorIdentity(person as Citizen), station = clinicalServiceStationsAtPosition(site, person.position, identity, state.voxels)[0];
    // Legacy treatment has no trusted marked station. Preserve its actual
    // completion position; never invent an authoritative furniture ID.
    const floor = station?.floor ?? Math.floor((person.position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors))), pointId = station?.id ?? `legacy:${floor}`, point = station?.position ?? person.position;
    const h = activate(simulation), pathogenSource = yv1WasteSourceAt(state, order.patientId, clock(state)), hazard = pathogenSource ? 'YV1' : 'used-material';
    let batch = h.batches.find(batch => batch.sourceKind === undefined && batch.siteId === site.id && batch.floor === floor && batch.pointId === pointId && batch.patientId === order.patientId && batch.hazard === hazard && distance(batch.point, point) < EPS && (!pathogenSource || batch.pathogenSource?.episodeId === pathogenSource.episodeId && batch.pathogenSource.contaminatedAt === pathogenSource.contaminatedAt));
    if (!batch) { batch = { id: `waste-${h.nextBatchId++}`, siteId: site.id, floor, pointId, point: { ...point }, patientId: order.patientId, material: 'used-clinical-material', hazard, pathogenSource, generatedUnits: 0, contaminatedUnits: 0, reservedUnits: 0, sealedUnits: 0, cleaningResidualUnits: 0, containedUnits: 0, archivedProcessedUnits: 0, sourceReceipts: [], sourceArchive: emptyArchive(), firstAt: clock(state), lastAt: clock(state) }; h.batches.push(batch); }
    batch.generatedUnits++; batch.contaminatedUnits++; batch.lastAt = clock(state); if (pathogenSource) batch.pathogenSource = pathogenSource; collectNewUnits(state, batch, 1);
    batch.sourceReceipts.push({ orderId: order.id, patientId: order.patientId, completedAt: clock(state), clinicalConsumedAtSite: consumed, quantity: 1 });
    if (batch.sourceReceipts.length > HISTORY) { const old = batch.sourceReceipts.shift()!, a = batch.sourceArchive; a.count++; a.firstOrderId ??= old.orderId; a.firstAt ??= old.completedAt; a.lastOrderId = old.orderId; a.lastAt = old.completedAt; }
    prior.consumed.set(site.id, consumed); h.lastObservedAt = clock(state);
    simulation.emitEvent({ type: 'hygiene-waste-generated', citizenId: order.patientId, siteId: site.id, procurementId: order.id, quantity: 1, purpose: batch.id });
  });
  simulation.onEvent('public-health-consumed', event => {
    const source = publicHealthConsumption(simulation, event); if (!source) return;
    const state = simulation.state;
    if (state.hygiene?.batches.some(batch => batch.sourceReceipts.some(receipt => receipt.kind === 'public-health' && receipt.sourceId === source.id))) return;
    const h = activate(simulation), pathogenSource = yv1WasteSourceAt(state, source.patientId, source.consumedAt);
    // Each public consumption retains its own immutable source, including the
    // original pathogen time. It never changes paid clinical stock counters.
    const batch: WasteBatch = { sourceKind: 'public-health', id: `waste-${h.nextBatchId++}`, siteId: source.siteId, floor: source.floor, pointId: source.pointId, point: { ...source.point }, patientId: source.patientId, material: 'used-clinical-material', hazard: pathogenSource ? 'YV1' : 'used-material', pathogenSource, generatedUnits: 1, contaminatedUnits: 1, reservedUnits: 0, sealedUnits: 0, cleaningResidualUnits: 0, containedUnits: 0, archivedProcessedUnits: 0, sourceReceipts: [{ kind: 'public-health', sourceId: source.id, orderId: source.orderId, patientId: source.patientId, completedAt: source.consumedAt, publicConsumedAtOrder: source.consumptionIndex, quantity: 1 }], sourceArchive: emptyArchive(), firstAt: source.consumedAt, lastAt: source.consumedAt };
    h.batches.push(batch); collectNewUnits(state, batch, 1); h.lastObservedAt = clock(state);
    simulation.emitEvent({ type: 'hygiene-waste-generated', citizenId: source.patientId, siteId: source.siteId, procurementId: source.orderId, quantity: 1, purpose: batch.id });
  });
  simulation.registerCommandHandler(command => {
    if (command.type === 'disinfectWaste') return beginDisinfection(simulation, command.targetId ?? '', command.value ?? 20);
    if (command.type !== 'cancelDisinfection') return null;
    const job = simulation.state.hygiene?.jobs.find(job => job.id === command.targetId);
    if (!job || terminal(job) || job.completedAt !== null || job.cancelledAt !== null) return { ok: false, message: '没有可取消的原处理任务。' };
    stop(simulation, job); return { ok: true, message: job.reason };
  });
  const working = new WeakMap<SimState, { tick: number; ranges: Map<string, { start: number; end: number }[]> }>();
  simulation.onPhase('people', (state, minutes) => {
    const h = state.hygiene; if (!h) return; h.lastObservedAt = clock(state);
    let occupiedWork = working.get(state); if (!occupiedWork || occupiedWork.tick !== state.tick) { occupiedWork = { tick: state.tick, ranges: new Map() }; working.set(state, occupiedWork); }
    const phaseContacts = { tick: state.tick, at: clock(state), records: new Map<string, { actorId: string; batchId: string; ranges: { start: number; end: number }[] }>() }; contacts.set(state, phaseContacts);
    const freeWindows = (person: Citizen, siteId: string, elapsed: number, startedAt: number) => subtractWindows(clinicalDoctorWorkWindows(simulation, person, siteId, elapsed, startedAt), [...clinicalDoctorUsedWorkWindows(simulation, person.id), ...(occupiedWork!.ranges.get(person.id) ?? [])]);
    for (const job of h.jobs) {
      if (terminal(job)) continue;
      const elapsed = Math.min(minutes, Math.max(0, clock(state) - job.lastObservedAt)); job.lastObservedAt = clock(state);
      if (job.completedAt !== null || job.cancelledAt !== null) { finishRefund(simulation, job); continue; }
      if (!state.extension!.actorProfiles.player.alive) { stop(simulation, job); continue; }
      const batch = h.batches.find(batch => batch.id === job.batchId)!, site = simulation.worldDefinition.buildings.find(site => site.id === job.siteId)!;
      const district = state.districts.find(district => district.id === site.districtId);
      if (!job.reservedUnits || elapsed <= 0 || !powerSupplyAt(state, site.id) || !district || district.energy <= 0) { job.state = job.reservedUnits ? 'waiting' : 'awaitingSupply'; job.reason = '材料与废物仍保管；等候真实供能、材料和到场劳动。'; continue; }
      const worker = state.citizens.find(person => (job.staffWindows[person.id] || Object.keys(job.staffWindows).length < MAX_STAFF) && person.workId === site.id && ['医生', 'doctor'].includes(person.role) && state.extension!.actorProfiles[person.id]?.alive && state.extension!.actorProfiles[person.id].age >= 18 && state.extension!.actorProfiles[person.id].health >= 45 && person.needs.hunger >= 40 && person.needs.fatigue >= 35 && batchStation(simulation, batch, person.position, person) && freeWindows(person, site.id, elapsed, job.startedAt).length > 0 && actorActivityAvailable(simulation, person.id, minutes) > EPS);
      if (!worker) { job.state = 'waiting'; job.reason = '等待原站点合资格工作人员的真实已计薪剩余劳动窗口。'; continue; }
      const selected = takeWindows(freeWindows(worker, site.id, elapsed, job.startedAt), Math.min(MINUTES - job.workedMinutes, elapsed, actorActivityAvailable(simulation, worker.id, minutes))), requested = selected.reduce((sum, range) => sum + range.end - range.start, 0);
      const worked = claimActorActivityMinutes(simulation, worker.id, job.id, requested, minutes); if (worked <= EPS) continue;
      if (Math.abs(worked - requested) > EPS) throw new Error('已界定卫生劳动认领不一致。');
      occupiedWork.ranges.set(worker.id, [...(occupiedWork.ranges.get(worker.id) ?? []), ...selected]);
      job.workedMinutes = Math.min(MINUTES, job.workedMinutes + worked); job.staffMinutes[worker.id] = (job.staffMinutes[worker.id] ?? 0) + worked; h.stats.workedMinutes += worked; job.state = 'processing';
      const period = job.staffWindows[worker.id] ??= { startedAt: selected[0].start, endedAt: selected[selected.length - 1].end, workedMinutes: 0, siteId: site.id, role: worker.role as '医生' | 'doctor', ageAtStart: state.extension!.actorProfiles[worker.id].age }; period.startedAt = Math.min(period.startedAt, selected[0].start); period.endedAt = Math.max(period.endedAt, selected[selected.length - 1].end); period.workedMinutes += worked;
      phaseContacts.records.set(job.id, { actorId: worker.id, batchId: batch.id, ranges: selected });
      // Processing has a purchased barrier-practice material, not a fabricated
      // glove commodity or claimed real-world sterilisation efficacy.
      for (const range of selected) recordWasteContact(simulation, worker.id, batch, job.id, range.start, range.end, .25);
      if (job.workedMinutes < MINUTES - EPS) continue;
      job.workedMinutes = MINUTES; job.reservedUnits--; job.consumedUnits++; stock(state, site.id).consumedUnits++;
      batch.reservedUnits--; batch.contaminatedUnits--; batch.sealedUnits++; batch.cleaningResidualUnits++; collectNewUnits(state, batch, 1);
      job.completedAt = clock(state); h.stats.completed++; refund(simulation, job); job.state = job.escrow > 0 ? 'refundPending' : 'completed';
      job.reason = '真实处理已完成；原用品与清洁耗材的密封残留仍在原站点保管，尚无终端处置设施。';
      simulation.emitEvent({ type: 'hygiene-disinfection-completed', citizenId: worker.id, siteId: site.id, procurementId: job.id, quantity: 1, minutes: MINUTES, purpose: batch.id });
    }
  });
  simulation.onPhase('finance', state => {
    if (!state.hygiene) return;
    for (const job of state.hygiene.jobs) { if (terminal(job)) continue; if (job.completedAt !== null || job.cancelledAt !== null) finishRefund(simulation, job); else if (!state.extension!.actorProfiles.player.alive) stop(simulation, job); else procure(simulation, job); }
    archive(state);
    const current = [...collectActorActivityClaims(state), ...hygieneActivityClaims(state)];
    state.hygiene.capacityHistory = state.hygiene.capacityHistory.filter(witness => current.some(claim => claim.id !== witness.id && claim.actorId === witness.actorId && claim.startedAt < witness.endedAt - EPS && claim.endedAt > witness.startedAt + EPS));
  });
  simulation.registerSaveValidator(state => validateHygieneState(state, simulation.worldDefinition));
}

export function validateHygieneState(state: SimState, world: WorldDefinition): void {
  const publicSources = state.culture?.orders?.flatMap(order => order.healthConsumptions ?? []) ?? [];
  const h = state.hygiene; if (h === undefined) { if (publicSources.length) throw new Error('卫生存档无效：公共耗用缺少真实废物。'); return; }
  const ensure = (condition: unknown, label: string): void => { if (!condition) throw new Error(`卫生存档无效：${label}`); };
  const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
  const number = (value: unknown, min: number, max: number, label: string, integer = false): void => ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const close = (a: number, b: number, label: string) => ensure(Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b)), label);
  const now = clock(state), sites = new Map(world.buildings.map(site => [site.id, site])), actorIds = new Set(['player', ...state.citizens.map(person => person.id)]), workshops = new Set(state.shops.filter(shop => sites.get(shop.buildingId)?.kind === 'workshop').map(shop => shop.id));
  ensure(object(h) && h.version === 1 && h.rulesetId === HYGIENE_RULESET, '版本和游戏规则'); number(h.nextBatchId, 1, 1e9, '批次序号', true); number(h.nextJobId, 1, 1e9, '任务序号', true); number(h.activatedAt, 0, now, '激活时间'); number(h.lastObservedAt, h.activatedAt, now, '已观察时钟');
  ensure(object(h.clinicalBaseline) && object(h.stock) && Array.isArray(h.batches) && h.batches.length <= 100000 && Array.isArray(h.jobs) && h.jobs.length <= HISTORY * 2 && Array.isArray(h.capacityHistory) && h.capacityHistory.length <= MAX_WITNESSES, '容器');
  const batchIds = new Set<string>(), sourceIds = new Set<string>(), generated = new Map<string, number>(), capacities = new Map<string, number>(), completed = new Map<string, number>(), reserved = new Map<string, number>();
  for (const b of h.batches) {
    ensure(object(b) && /^waste-[1-9]\d*$/.test(b.id) && !batchIds.has(b.id) && Number(b.id.slice(6)) < h.nextBatchId, '唯一批次'); batchIds.add(b.id);
    const site = sites.get(b.siteId); ensure(site?.kind === 'clinic' && actorIds.has(b.patientId) && b.material === 'used-clinical-material' && (b.sourceKind === undefined || b.sourceKind === 'public-health'), '真实用品来源主体');
    number(b.floor, 0, site!.floors - 1, '真实楼层', true); ensure(typeof b.pointId === 'string' && b.pointId.length <= 240 && object(b.point) && [b.point.x, b.point.y, b.point.z].every(value => typeof value === 'number' && Number.isFinite(value)), '实际站点');
    if (getBuildingBody(site!)) ensure(clinicalServiceStationsAtPosition(site!, b.point, { role: 'traveler', identities: ['traveler'] }, []).some(point => point.id === b.pointId && point.floor === b.floor && distance(point.position, b.point) < EPS), '可信公共服务站');
    else ensure(b.pointId === `legacy:${b.floor}` && clinicalAtSitePosition(site!, b.point, b.floor), '旧设施实际位置');
    ensure(['used-material', 'YV1'].includes(b.hazard) && (b.hazard === 'YV1') === (b.pathogenSource !== null), '不从普通污物产生病毒');
    if (b.pathogenSource) { const p = b.pathogenSource; ensure(object(p) && p.pathogenId === 'YV1' && p.actorId === b.patientId && /^yv1-episode-[1-9]\d*$/.test(p.episodeId) && Number(p.episodeId.slice(12)) < (state.pathology?.nextEpisodeId ?? 0) && typeof p.rootReceiptId === 'string' && !!state.pathology?.sourceReceipts.some(receipt => receipt.id === p.rootReceiptId), '具名病原来源'); number(p.infectiousFrom, 0, now, '传染开始'); number(p.infectiousUntil, p.infectiousFrom, 1e12, '传染结束'); number(p.contaminatedAt, p.infectiousFrom, Math.min(now, p.infectiousUntil), '真实污染时间'); ensure(p.contaminatedAt < p.infectiousUntil && b.generatedUnits === 1 && b.sourceReceipts.length === 1 && b.sourceArchive.count === 0 && b.firstAt === p.contaminatedAt && b.lastAt === p.contaminatedAt, '每次具名感染用品保留原污染来源'); const episode = [...Object.values(state.pathology!.episodes), ...state.pathology!.history].find(episode => episode.id === p.episodeId); if (episode) ensure(episode.actorId === p.actorId && episode.rootReceiptId === p.rootReceiptId && episode.infectiousFrom === p.infectiousFrom && episode.infectiousUntil === p.infectiousUntil, '尚保留病例来源对账'); }
    for (const key of ['generatedUnits', 'contaminatedUnits', 'reservedUnits', 'sealedUnits', 'cleaningResidualUnits', 'containedUnits', 'archivedProcessedUnits'] as const) number(b[key], 0, 1e9, key, true);
    ensure(b.generatedUnits >= 1 && b.reservedUnits <= b.contaminatedUnits && b.cleaningResidualUnits === b.sealedUnits && b.containedUnits <= b.generatedUnits + b.cleaningResidualUnits, '废物保管数量'); close(b.generatedUnits, b.contaminatedUnits + b.sealedUnits, '原用品不消失');
    number(b.firstAt, h.activatedAt, now, '最初废物时间'); number(b.lastAt, b.firstAt, now, '末次废物时间'); ensure(Array.isArray(b.sourceReceipts) && b.sourceReceipts.length <= HISTORY && object(b.sourceArchive), '源回执容器'); number(b.sourceArchive.count, 0, 1e9, '聚合源计数', true);
    if (b.sourceArchive.count === 0) ensure(b.sourceArchive.firstOrderId === null && b.sourceArchive.lastOrderId === null && b.sourceArchive.firstAt === null && b.sourceArchive.lastAt === null, '空源归档'); else { ensure(/^clinical-[1-9]\d*$/.test(b.sourceArchive.firstOrderId ?? '') && /^clinical-[1-9]\d*$/.test(b.sourceArchive.lastOrderId ?? ''), '源归档名称'); number(b.sourceArchive.firstAt, b.firstAt, b.lastAt, '归档开始'); number(b.sourceArchive.lastAt, b.sourceArchive.firstAt!, b.lastAt, '归档结束'); }
    if (b.sourceKind === 'public-health') ensure(b.generatedUnits === 1 && b.sourceReceipts.length === 1 && b.sourceReceipts[0].kind === 'public-health' && b.sourceArchive.count === 0, '公共源保留单份不可变原件，不作临床聚合归档');
    let previous = b.sourceArchive.lastAt ?? b.firstAt;
    for (const r of b.sourceReceipts) {
      ensure(object(r) && r.patientId === b.patientId && r.quantity === 1, '真实消耗主体');
      number(r.completedAt, previous, b.lastAt, '源时钟'); previous = r.completedAt;
      if (r.kind === 'public-health') {
        ensure(b.sourceKind === 'public-health' && typeof r.sourceId === 'string' && !sourceIds.has(r.sourceId) && b.generatedUnits === 1 && b.sourceReceipts.length === 1 && b.sourceArchive.count === 0 && b.firstAt === r.completedAt && b.lastAt === r.completedAt, '唯一公共耗用原件'); sourceIds.add(r.sourceId);
        const source = findPublicHealthConsumption(state, r.sourceId);
        ensure(source && source.orderId === r.orderId && source.patientId === r.patientId && source.siteId === b.siteId && source.consumedAt === r.completedAt && source.consumptionIndex === r.publicConsumedAtOrder && source.floor === b.floor && source.pointId === b.pointId && distance(source.point, b.point) < EPS, '公共订单耗用及站点对账');
      } else {
        ensure(r.kind === undefined && b.sourceKind === undefined && /^clinical-[1-9]\d*$/.test(r.orderId) && !sourceIds.has(r.orderId), '唯一真实临床消耗回执'); sourceIds.add(r.orderId);
        number(r.clinicalConsumedAtSite, 1, state.clinical?.stock[b.siteId]?.consumedUnits ?? 0, '实际累计消耗', true);
        const order = state.clinical?.orders.find(order => order.id === r.orderId); if (order) ensure(order.state === 'completed' && order.patientId === r.patientId && order.siteId === b.siteId && order.completedAt === r.completedAt && order.consumedUnits === 1, '仍保留源订单对账');
      }
    }
    close(b.generatedUnits, b.sourceArchive.count + b.sourceReceipts.length, '源单位与批次数'); if (b.sourceKind === undefined) generated.set(b.siteId, (generated.get(b.siteId) ?? 0) + b.generatedUnits);
    const key = `${b.siteId}:${b.floor}:${b.pointId}`; capacities.set(key, (capacities.get(key) ?? 0) + b.containedUnits); completed.set(b.id, b.archivedProcessedUnits); reserved.set(b.id, 0);
  }
  ensure(h.nextBatchId === h.batches.length + 1, '批次从不删除'); for (const value of capacities.values()) ensure(value <= CAPACITY, '有限原站点容器');
  ensure(publicSources.every(source => sourceIds.has(source.id)), '每份新公共耗用都保留废物，不倒填旧单位');
  for (const [siteId, baseline] of Object.entries(h.clinicalBaseline)) { ensure(sites.get(siteId)?.kind === 'clinic', '迁移源设施'); number(baseline, 0, state.clinical?.stock[siteId]?.consumedUnits ?? 0, '迁移消费水位', true); }
  for (const [siteId, s] of Object.entries(state.clinical?.stock ?? {})) close(s.consumedUnits, (h.clinicalBaseline[siteId] ?? 0) + (generated.get(siteId) ?? 0), '只记激活后的真实临床消耗');
  ensure(object(h.stats) && object(h.archived), '累计账'); for (const totals of [h.stats, h.archived]) for (const key of ['funded', 'purchasePaid', 'refunded', 'workedMinutes', 'completed', 'cancelled'] as const) number(totals[key], 0, 1e12, `累计${key}`, key === 'completed' || key === 'cancelled'); number(h.archived.count, 0, 1e9, '已结归档数', true); close(h.archived.count, h.archived.completed + h.archived.cancelled, '归档状态'); close(h.archived.funded, h.archived.purchasePaid + h.archived.refunded, '归档托管守恒');
  const totals = { ...h.archived }, jobIds = new Set<string>(), batchesPending = new Set<string>(), inputs = new Map<string, { received: number; consumed: number; reserved: number }>(); let completedJobs = h.archived.completed;
  for (const j of h.jobs) {
    ensure(object(j) && /^disinfection-[1-9]\d*$/.test(j.id) && !jobIds.has(j.id) && Number(j.id.slice(13)) < h.nextJobId && j.payerId === 'player' && batchIds.has(j.batchId) && h.batches.find(b => b.id === j.batchId)!.siteId === j.siteId, '真实处理订单'); jobIds.add(j.id);
    ensure(['awaitingSupply', 'waiting', 'processing', 'refundPending', 'completed', 'cancelled'].includes(j.state) && typeof j.reason === 'string' && j.reason.length <= 240 && j.requiredMinutes === MINUTES, '固定处理合同'); number(j.startedAt, h.activatedAt, now, '开始'); number(j.lastObservedAt, j.startedAt, now, '已观察任务'); number(j.retryAt, j.startedAt, now + 60, '采购重试'); number(j.funded, 0, 1e6, '实际预算'); ensure(j.funded > 0, '正额实付预算'); for (const key of ['escrow', 'purchasePaid', 'refunded'] as const) number(j[key], 0, j.funded, key); ensure(Math.abs(j.funded - j.escrow - j.purchasePaid - j.refunded) <= 1e-8, '资金不生成');
    for (const key of ['receivedUnits', 'reusedUnits', 'reservedUnits', 'consumedUnits'] as const) number(j[key], 0, 1, key, true); ensure(j.receivedUnits + j.reusedUnits <= 1 && j.reservedUnits + j.consumedUnits <= j.receivedUnits + j.reusedUnits, '原料分配'); number(j.workedMinutes, 0, MINUTES, '真实分钟'); ensure(j.workedMinutes <= j.lastObservedAt - j.startedAt + EPS && object(j.staffMinutes) && object(j.staffWindows) && Object.keys(j.staffMinutes).length <= MAX_STAFF && Object.keys(j.staffMinutes).length === Object.keys(j.staffWindows).length, '处理时间因果');
    let staffed = 0; for (const [id, minutes] of Object.entries(j.staffMinutes)) { const person = state.citizens.find(person => person.id === id), period = j.staffWindows[id]; ensure(person && object(period) && period.siteId === j.siteId && ['医生', 'doctor'].includes(period.role), '真实劳动当时任职记录'); number(period.ageAtStart, 18, 130, '当时成年年龄'); ensure(state.extension!.actorProfiles[id]?.age >= period.ageAtStart, '人员年龄不倒退'); number(minutes, EPS, MINUTES, '操作人分钟'); number(period.startedAt, j.startedAt, j.lastObservedAt, '实际劳动起点'); number(period.endedAt, period.startedAt, j.lastObservedAt, '实际劳动末点'); number(period.workedMinutes, EPS, period.endedAt - period.startedAt + EPS, '劳动必要容量'); close(minutes as number, period.workedMinutes, '已记录窗口时数'); staffed += minutes as number; } close(staffed, j.workedMinutes, '已计薪操作人时数');
    if (j.receipt) { const r = j.receipt; ensure(object(r) && workshops.has(r.shopId) && r.quantity === 1, '实际工作坊'); number(r.purchasedAt, j.startedAt, now, '采购时钟'); number(r.gross, EPS, j.funded, '采购实费'); number(r.unitPrice, EPS, j.funded, '实际报价数值'); number(r.net, 0, r.gross, '供应净款'); number(r.tax, 0, r.gross, '实际税'); close(r.unitPrice, r.gross, '实际报价'); close(r.gross, r.net + r.tax, '净税守恒'); close(j.purchasePaid, r.gross, '采购总账'); ensure(j.receivedUnits === 1 && j.reusedUnits === 0, '真实收货'); } else ensure(j.purchasePaid === 0 && j.receivedUnits === 0, '无回执不买料');
    if (j.completedAt !== null) number(j.completedAt, j.startedAt + MINUTES, now, '完成时钟'); if (j.cancelledAt !== null) number(j.cancelledAt, j.startedAt, now, '停止时钟'); ensure(!(j.completedAt !== null && j.cancelledAt !== null), '结算唯一');
    if (j.completedAt !== null) { ensure(j.workedMinutes === MINUTES && j.consumedUnits === 1 && j.reservedUnits === 0 && ['completed', 'refundPending'].includes(j.state), '处理完成实物'); completedJobs++; completed.set(j.batchId, completed.get(j.batchId)! + 1); }
    else if (j.cancelledAt !== null) ensure(j.workedMinutes < MINUTES && j.consumedUnits === 0 && j.reservedUnits === 0 && ['cancelled', 'refundPending'].includes(j.state), '取消不伪消耗');
    else { ensure(!terminal(j) && j.state !== 'refundPending' && j.workedMinutes < MINUTES && j.refunded === 0 && j.consumedUnits === 0 && j.receivedUnits + j.reusedUnits === j.reservedUnits && !batchesPending.has(j.batchId), '活动处理唯一'); batchesPending.add(j.batchId); reserved.set(j.batchId, reserved.get(j.batchId)! + 1); if (j.state === 'awaitingSupply') ensure(j.reservedUnits === 0 && j.workedMinutes === 0, '缺料不可处理'); }
    ensure((j.state === 'refundPending') === (j.escrow > 0 && (j.completedAt !== null || j.cancelledAt !== null)), '退款继续托管'); if (terminal(j)) ensure(j.escrow === 0, '结算清账');
    const input = inputs.get(j.siteId) ?? { received: 0, consumed: 0, reserved: 0 }; input.received += j.receivedUnits; input.consumed += j.consumedUnits; input.reserved += j.reservedUnits; inputs.set(j.siteId, input);
    for (const key of ['funded', 'purchasePaid', 'refunded', 'workedMinutes'] as const) totals[key] += j[key]; totals.completed += Number(j.completedAt !== null); totals.cancelled += Number(j.cancelledAt !== null);
  }
  close(h.nextJobId, h.archived.count + h.jobs.length + 1, '任务无重复兑付'); for (const key of ['funded', 'purchasePaid', 'refunded', 'workedMinutes', 'completed', 'cancelled'] as const) close(h.stats[key], totals[key], `累计${key}`);
  close(completedJobs, h.batches.reduce((sum, b) => sum + b.sealedUnits, 0), '每次处理只封存一个源单位'); for (const b of h.batches) { close(b.reservedUnits, reserved.get(b.id)!, '污染单位认领'); close(b.sealedUnits, completed.get(b.id)!, '原批次处理与封存'); }
  let consumedInputs = 0; for (const [siteId, s] of Object.entries(h.stock)) { ensure(sites.get(siteId)?.kind === 'clinic' && object(s), '原料保管设施'); for (const key of ['receivedUnits', 'availableUnits', 'consumedUnits', 'archivedReceived', 'archivedConsumed'] as const) number(s[key], 0, 1e9, key, true); const input = inputs.get(siteId) ?? { received: 0, consumed: 0, reserved: 0 }; close(s.receivedUnits, s.archivedReceived + input.received, '采购原料账'); close(s.consumedUnits, s.archivedConsumed + input.consumed, '清洁用后材料账'); close(s.receivedUnits, s.availableUnits + s.consumedUnits + input.reserved, '清洁材料守恒'); consumedInputs += s.consumedUnits; }
  for (const siteId of inputs.keys()) ensure(!!h.stock[siteId], '不漏原料站点'); close(consumedInputs, completedJobs, '每次处理产生独立清洁残留');
  let archivedWitnessMinutes = 0; const witnessIds = new Set<string>(); for (const witness of h.capacityHistory) { ensure(object(witness) && /^hygiene:disinfection-[1-9]\d*:[^:]+$/.test(witness.id) && !witnessIds.has(witness.id) && actorIds.has(witness.actorId) && witness.id.endsWith(`:${witness.actorId}`), '旧劳动见证'); const id = witness.id.split(':')[1]; ensure(!jobIds.has(id) && Number(id.slice(13)) < h.nextJobId && h.archived.count > 0, '见证必须源自已归档任务'); witnessIds.add(witness.id); number(witness.startedAt, h.activatedAt, now, '见证起点'); number(witness.endedAt, witness.startedAt, now, '见证末点'); number(witness.workedMinutes, EPS, Math.min(MINUTES, witness.endedAt - witness.startedAt + EPS), '旧真实劳动分钟'); archivedWitnessMinutes += witness.workedMinutes; } ensure(archivedWitnessMinutes <= h.archived.workedMinutes + EPS, '归档见证不超过原已赚分钟');
  validateHygieneCapacity(state);
}
type WorkWindow = { start: number; end: number };
function subtractWindows(ranges: readonly Readonly<WorkWindow>[], used: readonly Readonly<WorkWindow>[]): WorkWindow[] {
  const result: WorkWindow[] = [];
  for (const range of ranges) { const cuts = [range.start, range.end, ...used.flatMap(item => [item.start, item.end]).filter(at => at > range.start && at < range.end)].sort((a, b) => a - b); for (let i = 1; i < cuts.length; i++) { const start = cuts[i - 1], end = cuts[i]; if (end - start > EPS && !used.some(item => item.start <= start && item.end >= end)) result.push({ start, end }); } }
  return result;
}
function takeWindows(ranges: WorkWindow[], minutes: number): WorkWindow[] { const selected: WorkWindow[] = []; for (const range of ranges) { const actual = Math.min(Math.max(0, minutes), range.end - range.start); if (actual > EPS) { selected.push({ start: range.start, end: range.start + actual }); minutes -= actual; } } return selected; }
export function hygieneActivityClaims(state: SimState): ActorActivityClaim[] { return [...(state.hygiene?.capacityHistory ?? []), ...(state.hygiene?.jobs ?? []).flatMap(job => Object.entries(job.staffWindows).map(([actorId, period]) => ({ id: `hygiene:${job.id}:${actorId}`, actorId, ...period })))]; }
function validateHygieneCapacity(state: SimState): void {
  const claims = [...collectActorActivityClaims(state), ...hygieneActivityClaims(state)], unique = new Map<string, ActorActivityClaim>(), now = clock(state);
  for (const claim of claims) { const old = unique.get(claim.id); if (old && (old.actorId !== claim.actorId || old.startedAt !== claim.startedAt || old.endedAt !== claim.endedAt || Math.abs(old.workedMinutes - claim.workedMinutes) > EPS)) throw new Error('卫生共同劳动见证不一致。'); if (![claim.startedAt, claim.endedAt, claim.workedMinutes].every(Number.isFinite) || claim.startedAt < 0 || claim.endedAt > now || claim.endedAt < claim.startedAt || claim.workedMinutes < 0 || claim.workedMinutes > claim.endedAt - claim.startedAt + EPS) throw new Error('卫生共同劳动时窗无效。'); unique.set(claim.id, claim); }
  const actors = new Map<string, ActorActivityClaim[]>(); for (const claim of unique.values()) { const list = actors.get(claim.actorId) ?? []; list.push(claim); actors.set(claim.actorId, list); }
  for (const list of actors.values()) for (const start of new Set(list.map(claim => claim.startedAt))) { let minutes = 0; for (const claim of [...list].sort((a, b) => a.endedAt - b.endedAt)) { if (claim.startedAt < start) continue; minutes += claim.workedMinutes; if (minutes > claim.endedAt - start + EPS) throw new Error('同一人物卫生、课程、科研和维修必要时窗超过真实容量。'); } }
}
function clinicalAtSitePosition(site: Building, point: Vec3, floor: number): boolean {
  const dx = point.x - site.position.x, dz = point.z - site.position.z, x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation), dimensions = site.floorFootprints?.[floor] ?? site;
  return Math.floor((point.y - site.position.y + .01) / (site.height / Math.max(1, site.floors))) === floor && (floor === 0 && distance(point, site.door) <= 2 || Math.abs(x) <= dimensions.width / 2 && Math.abs(z) <= dimensions.depth / 2);
}
