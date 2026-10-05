import type { Citizen, CommandResult, SimState, Vec3, WorldDefinition } from '../types';
import type { PublicPurchaseReceipt, Simulation } from '../simulation';

const EPS = 1e-7;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clone = <T>(x: T): T => structuredClone(x);
const result = (ok: boolean, message: string): CommandResult => ({ ok, message });
export interface NodeFreightOrigin {
  location: 'node'; districtId: string; shopId: string | null; receivedQuantity: number;
  nodeId: string; vehicleId: string; fromEdgeId: string; direction: 1 | -1; arrivedAt: number; position: Vec3;
}
export interface LocatedFood { id: string; quantity: number; origin: NodeFreightOrigin; unitPrice: number }
export interface TaskContract { id: string; day: number; workId: string; ratePerMinute: number; availableMinutes: number; payrollEpoch: number | null }
export interface PublicPayrollClaim { citizenId: string; workId: string; minutes: number; ratePerMinute: number; amount: number }
export interface PayrollPeriod { epoch: number; closedAt: number; claims: (PublicPayrollClaim & { paidGross: number })[] }
type WorkKind = 'assemblyTravel' | 'assembly' | 'fetchTravel' | 'deliveryTravel' | 'sales' | 'returnTravel' | 'loading' | 'handoff' | 'counterWait' | 'staffHandover';
export interface CounterTask {
  id: string; citizenId: string; contract: TaskContract; continuationOf: string | null; acceptedAt: number; lastObservedAt: number; endedAt: number | null; endReason: string;
  stage: 'assembly' | 'fetch' | 'deliver' | 'serve' | 'return' | 'handover' | 'paused' | 'finished'; resumeStage: 'assembly' | 'fetch' | 'deliver' | 'serve' | 'return' | 'handover';
  reason: string; nodeId: string | null; routeKey: string | null; workedMinutes: number; earned: number;
  pickup: { lotId: string; quantity: number; minutes: number } | null; handoffMinutes: number; returnLoadingMinutes: number; returnUnloadingMinutes: number;
  allocated: Record<WorkKind, number>;
}
export interface CounterStock {
  id: string; sourceLotId: string; origin: NodeFreightOrigin; unitPrice: number; received: number;
  remaining: number; sold: number; returned: number; pickedAt: number; deliveredAt: number | null;
  carrierId: string; location: 'carrier' | 'counter' | 'returned';
}
export interface CounterQueue {
  citizenId: string; quantity: number; requestedAt: number; arrivedAt: number | null; lastServiceAt: number;
  servedMinutes: number; status: 'walking' | 'waiting' | 'served' | 'cancelled';
}
export interface CounterSale {
  citizenId: string; staffId: string; at: number; quantity: number; gross: number; saleTax: number;
  supplierGross: number; supplierTax: number; publicMargin: number; taxRate: number;
  allocations: { stockId: string; quantity: number; gross: number }[];
}
export interface StaffHandover {
  fromTaskId: string; toTaskId: string; requestedAt: number; requiredMinutes: number;
  fromPosition: Vec3; toPosition: Vec3; carriedQuantity: number; stockIds: string[];
  completedAt: number | null; cancelledAt: number | null; reason: string;
}
export interface FoodCounter {
  id: string; siteId: string; districtId: string; point: Vec3; approvedAt: number; approvedBy: string[];
  signaturePositions: { actorId: string; position: Vec3 }[]; budgetId: string; cap: 40; price: 12;
  batchCap: 8; batchValueCap: 40; assemblyMinutesRequired: 10; serviceMinutesPerUnit: 2; handlingMinutesPerUnit: .25; opensAt: 8; closesAt: 17;
  state: 'awaitingMaterial' | 'assembling' | 'open' | 'closing' | 'closed';
  receipts: PublicPurchaseReceipt[]; spent: number; materialReceived: number; materialConsumed: number; assemblyMinutes: number;
  shiftPlans: { id: string; day: number; cap: number; siteId: string; approvedBy: string[] }[]; tasks: CounterTask[]; handovers: StaffHandover[]; stocks: CounterStock[]; queue: CounterQueue[]; sales: CounterSale[];
}
export interface FoodDistributionState { version: 2; nextCounterId: number; nextTaskId: number; nextStockId: number; counters: FoodCounter[]; payroll: { epoch: number; periods: PayrollPeriod[]; legacyDue: Record<string, number>; legacyTaskIds: string[]; dayUsed: Record<string, Record<string, number>>; legacyBlockedDay: number | null } }
type State = SimState & { foodDistribution?: FoodDistributionState };
export interface FoodDistributionAccounting {
  activate(): { legacyDue: Record<string, number>; dayUsed: Record<string, Record<string, number>> };
  onAttendance(handler: (citizenId: string, day: number, minutes: number) => void): void;
  onPayroll(handler: (claims: PublicPayrollClaim[]) => void): void;
  onPayment(handler: (citizenId: string, gross: number) => void): void;
  onCitizenActivity(handler: (citizen: Citizen, minutes: number) => boolean): void;
  contract(citizenId: string): TaskContract | null;
  allocate(citizenId: string, contract: TaskContract, minutes: number): number;
  move(citizenId: string, target: { siteId: string } | { nodeId: string }, minutes: number, key: string): { arrived: boolean; usedMinutes: number };
  foodAtNode(): LocatedFood[];
  nodeDistance(citizenId: string, nodeId: string): number;
  withdraw(citizenId: string, lotId: string, quantity: number): LocatedFood | null;
  restore(citizenId: string, stock: CounterStock): boolean;
  publicReceipt(amount: number, citizenId: string, districtId: string, purpose: string): void;
}
export interface CounterQuote { counterId: string; siteId: string; point: Vec3; price: number; available: number; staffed: boolean; open: boolean; waitingMinutes: number; affordable: boolean; reason: string }
const controllers = new WeakMap<Simulation, ReturnType<typeof createController>>();
const now = (sim: Simulation) => sim.state.extension!.lastUpdate;
const profile = (sim: Simulation, id: string) => sim.state.extension!.actorProfiles[id];
function createController(sim: Simulation, account: FoodDistributionAccounting) {
  const state = () => sim.state as State;
  const data = () => state().foodDistribution;
  const actor = (id: string) => sim.state.citizens.find(c => c.id === id);
  const counter = (id: string) => data()?.counters.find(c => c.id === id);
  const activeTask = (c: FoodCounter) => [...c.tasks].reverse().find(t => t.stage !== 'finished');
  const responsibleTask = (c: FoodCounter) => [...c.tasks].reverse().find(t => !c.handovers.some(h => h.toTaskId === t.id && h.completedAt === null));
  const healthy = (id: string) => { const c = actor(id), p = profile(sim, id); return !!c && !!p && p.alive && p.age >= 18 && p.health >= 45 && c.needs.hunger >= 30 && c.needs.fatigue >= 25; };
  const withinHours = (c: FoodCounter) => sim.state.hour >= c.opensAt && sim.state.hour < c.closesAt;
  const onSite = (id: string, c: FoodCounter) => !!actor(id) && dist(actor(id)!.position, c.point) <= .05;
  const held = (c: FoodCounter) => c.stocks.filter(s => s.location !== 'returned' && s.remaining > EPS);
  const shelf = (c: FoodCounter) => held(c).filter(s => s.location === 'counter');
  const amount = (lots: CounterStock[]) => lots.reduce((n, s) => n + s.remaining, 0);
  const working = (c: FoodCounter, t = activeTask(c)) => !!t && healthy(t.citizenId) && withinHours(c) && account.contract(t.citizenId)?.id === t.contract.id && account.contract(t.citizenId)?.payrollEpoch === t.contract.payrollEpoch && account.contract(t.citizenId)?.workId === t.contract.workId && Math.abs((account.contract(t.citizenId)?.ratePerMinute ?? 0) - t.contract.ratePerMinute) < 1e-9 && (account.contract(t.citizenId)?.availableMinutes ?? 0) > EPS;
  const spendTime = (c: FoodCounter, t: CounterTask, kind: WorkKind, minutes: number) => {
    const actual = account.allocate(t.citizenId, t.contract, Math.max(0, minutes));
    t.allocated[kind] += actual; t.workedMinutes += actual; t.earned += actual * t.contract.ratePerMinute;
    actor(t.citizenId)!.state = 'foodCounterDuty'; // Other staffed services cannot consume this same worker-minute.
    return actual;
  };
  const move = (c: FoodCounter, t: CounterTask, target: { siteId: string } | { nodeId: string }, dt: number, kind: WorkKind) => {
    const permitted = Math.min(dt, account.contract(t.citizenId)?.availableMinutes ?? 0);
    const movement = account.move(t.citizenId, target, permitted, `${t.id}:${JSON.stringify(target)}:${t.stage}`);
    spendTime(c, t, kind, movement.usedMinutes); return { ...movement, remaining: Math.max(0, permitted - movement.usedMinutes) };
  };
  function register(siteId: string, approvedBy: string[]): CommandResult {
    const site = sim.worldDefinition.buildings.find(b => b.id === siteId);
    if (!site || !['school', 'hall', 'station'].includes(site.kind) || Reflect.get(site, 'floorPlanProfile')) return result(false, '本原型只接受旧布局的既有学校、官署或车站公共入口；新布局需要权威使用点。');
    if (data()?.counters.some(c => c.siteId === siteId) || (data()?.counters.length ?? 0) >= 64) return result(false, '柜台已登记或登记档案已满。');
    const id = `food-counter-${data()?.nextCounterId ?? 1}`, time = now(sim);
    if (!sim.authorizePublicBudget({ id, siteId, purpose: 'food-distribution', cap: 40, approvedAt: time, approvedBy })) return result(false, '需要现有法定现场审批和未承诺的真实预算。');
    state().foodDistribution ??= { version: 2, nextCounterId: 1, nextTaskId: 1, nextStockId: 1, counters: [], payroll: { epoch: 0, periods: [], ...account.activate(), legacyTaskIds: [], legacyBlockedDay: null } };
    data()!.nextCounterId++;
    data()!.counters.push({ id, siteId, districtId: site.districtId, point: clone(site.door), approvedAt: time, approvedBy: [...approvedBy],
      signaturePositions: approvedBy.map(actorId => ({ actorId, position: clone(actorId === 'player' ? sim.state.player.position : actor(actorId)!.position) })), budgetId: id,
      cap: 40, price: 12, batchCap: 8, batchValueCap: 40, assemblyMinutesRequired: 10, serviceMinutesPerUnit: 2, handlingMinutesPerUnit: .25, opensAt: 8, closesAt: 17,
      state: 'awaitingMaterial', receipts: [], spent: 0, materialReceived: 0, materialConsumed: 0, assemblyMinutes: 0, shiftPlans: [], tasks: [], handovers: [], stocks: [], queue: [], sales: [] });
    return result(true, `已登记${id}；40文只作现有材料采购上限，登记不收费。`);
  }
  function procure(id: string): CommandResult {
    const c = counter(id); if (!c || !['awaitingMaterial', 'assembling'].includes(c.state)) return result(false, '柜台不在装配采购阶段。');
    const receipt = sim.purchasePublicSupplyReceipt({ requestedGross: c.cap - c.spent, requestedQuantity: Math.max(0, 1 - c.materialReceived), districtId: c.districtId, siteId: c.siteId, purpose: 'food-distribution', procurementId: `${id}-assembly-${c.receipts.length + 1}`, budgetId: c.budgetId });
    if (receipt.quantity > 0) { c.receipts.push(clone(receipt)); c.spent += receipt.paid; c.materialReceived += receipt.quantity; c.state = 'assembling'; }
    return result(receipt.quantity > 0, receipt.quantity >= 1 - EPS ? '一份真实工业材料已购入，等待原工班现场装配。' : '保留实际部分材料与付款，等待剩余预算及供货。');
  }
  const finish = (t: CounterTask, reason: string) => { if (t.stage !== 'finished') { if (t.stage !== 'paused') t.resumeStage = t.stage; t.stage = 'finished'; t.endedAt = now(sim); t.endReason = reason; } };
  const stageFor = (c: FoodCounter, citizenId: string): CounterTask['resumeStage'] => c.state === 'closing' ? 'return' : c.materialConsumed < 1 ? 'assembly' : held(c).some(s => s.location === 'carrier' && s.carrierId === citizenId) ? 'deliver' : shelf(c).length ? 'serve' : 'fetch';
  const newTask = (c: FoodCounter, citizenId: string, contract: TaskContract, stage: CounterTask['resumeStage'], continuationOf: string | null): CounterTask => {
    const t: CounterTask = { id: `food-task-${data()!.nextTaskId++}`, citizenId, contract: clone(contract), continuationOf, acceptedAt: now(sim), lastObservedAt: now(sim), endedAt: null, endReason: '', stage, resumeStage: stage, reason: '', nodeId: null, routeKey: null, workedMinutes: 0, earned: 0, pickup: null, handoffMinutes: 0, returnLoadingMinutes: 0, returnUnloadingMinutes: 0,
      allocated: { assemblyTravel: 0, assembly: 0, fetchTravel: 0, deliveryTravel: 0, sales: 0, returnTravel: 0, loading: 0, handoff: 0, counterWait: 0, staffHandover: 0 } };
    c.tasks.push(t); actor(citizenId)!.state = 'foodCounterDuty'; return t;
  };
  const busyElsewhere = (c: FoodCounter, citizenId: string) => data()!.counters.some(x => x !== c && x.tasks.some(t => t.stage !== 'finished' && t.citizenId === citizenId));
  const pendingHandover = (c: FoodCounter) => c.handovers.find(h => h.completedAt === null && h.cancelledAt === null);
  function accept(id: string, citizenId: string): CommandResult {
    const c = counter(id), worker = actor(citizenId), contract = account.contract(citizenId), previous = c && responsibleTask(c);
    if (!c || !worker || !contract || !healthy(citizenId) || !withinHours(c) || c.state === 'closed' || worker.workId !== c.siteId || !onSite(citizenId, c) && !sim.isOnDuty(citizenId, c.siteId)
      || c.materialReceived < 1 - EPS || pendingHandover(c) || busyElsewhere(c, citizenId) || c.tasks.length >= 256) return result(false, '只能由此设施已经真实在岗、有剩余已资助时数的成年工作人员接班。');
    const old = activeTask(c);
    if (old && (old.citizenId !== citizenId || old.contract.id === contract.id && old.contract.payrollEpoch === contract.payrollEpoch)) return result(false, '现有劳动段须先暂停恢复或现场交班；不得重置同日分钟。');
    if (previous && previous.citizenId !== citizenId || held(c).some(stock => stock.location === 'carrier' && stock.carrierId !== citizenId)) return result(false, '换人须由双方现场完成真实交班。');
    if (!previous && !sim.isOnDuty(citizenId, c.siteId)) return result(false, '初次工作人员须已经真实到岗。');
    if (old) finish(old, 'original-contract-ended');
    newTask(c, citizenId, contract, stageFor(c, citizenId), previous?.id ?? null);
    return result(true, previous ? '保留旧已赚劳动；按真正新日资助或结算周期创建续段。' : '使用原任职和原日工班；柜台没有新增工资或岗位。');
  }
  function planNextDay(id: string, approvedBy: string[]): CommandResult {
    const c = counter(id); if (!c || c.shiftPlans.length >= 256) return result(false, '柜台未登记或审议档案已满。');
    const ok = sim.authorizeNextPublicShifts(approvedBy);
    if (ok) c.shiftPlans.push(clone(sim.publicServiceCoverage().shifts.find(shift => shift.day === Math.floor(now(sim) / 1440) + 1)!));
    return result(ok, '来日班次须两名原任职官员实际现场审议，使用原财政保护与原岗位。');
  }
  function handover(id: string, toCitizenId: string): CommandResult {
    const c = counter(id), previous = c && responsibleTask(c), from = previous && actor(previous.citizenId), to = actor(toCitizenId);
    const fromContract = from && account.contract(from.id), toContract = to && account.contract(to.id);
    if (!c || !previous || !from || !to || from.id === to.id || !fromContract || !toContract || !healthy(from.id) || !healthy(to.id) || !withinHours(c) || c.state === 'closed'
      || from.workId !== c.siteId || to.workId !== c.siteId || !onSite(from.id, c) || !onSite(to.id, c) || !sim.isOnDuty(to.id, c.siteId) || pendingHandover(c) || busyElsewhere(c, from.id) || busyElsewhere(c, to.id) || c.tasks.length > 253 || c.handovers.length >= 256) return result(false, '两名原岗位人员须实际同在柜台、有真实资助工时且未兼任其他柜台。');
    const stockIds = held(c).map(s => s.id), carriedQuantity = amount(held(c).filter(s => s.location === 'carrier')), requiredMinutes = Math.max(1, carriedQuantity * c.handlingMinutesPerUnit);
    if (fromContract.availableMinutes + EPS < requiredMinutes || toContract.availableMinutes + EPS < requiredMinutes || held(c).some(s => s.location === 'carrier' && s.carrierId !== from.id)) return result(false, '双方工时须足够实际交班，原携货人不可缺席。');
    const continuation = previous.id; finish(previous, 'onsite-handover-started');
    const outgoing = newTask(c, from.id, fromContract, 'handover', continuation), incoming = newTask(c, to.id, toContract, 'handover', null);
    c.handovers.push({ fromTaskId: outgoing.id, toTaskId: incoming.id, requestedAt: now(sim), requiredMinutes, fromPosition: clone(from.position), toPosition: clone(to.position), carriedQuantity, stockIds, completedAt: null, cancelledAt: null, reason: '' });
    return result(true, '两人开始现场交班；各占原班分钟，货权、数量与冻结报价不变。');
  }
  function cancelHandover(id: string): CommandResult {
    const c = counter(id), h = c && pendingHandover(c); if (!c || !h) return result(false, '无未完交班。');
    h.cancelledAt = now(sim); h.reason = 'explicit-cancellation';
    const from = c.tasks.find(t => t.id === h.fromTaskId)!, to = c.tasks.find(t => t.id === h.toTaskId)!;
    finish(to, 'handover-cancelled'); finish(from, 'handover-cancelled');
    const contract = account.contract(from.citizenId);
    if (contract && healthy(from.citizenId) && onSite(from.citizenId, c) && withinHours(c)) newTask(c, from.citizenId, contract, stageFor(c, from.citizenId), from.id);
    return result(true, '保留实际已赚交班分钟；货物仍由原人员保管。');
  }
  function pause(id: string, citizenId?: string): CommandResult {
    const c = counter(id), t = c && (citizenId ? c.tasks.find(t => t.citizenId === citizenId && t.stage !== 'finished') : activeTask(c));
    if (!c || !t || t.stage === 'paused') return result(false, '没有可暂停的原劳动段。');
    t.resumeStage = t.stage as CounterTask['resumeStage']; t.stage = 'paused'; t.lastObservedAt = now(sim); t.reason = 'explicit-break';
    const worker = actor(t.citizenId)!; worker.state = 'offDuty'; worker.destinationId = null; worker.route = []; worker.routeIndex = 0;
    return result(true, '停止柜台占用，原需求行为继续；已赚分钟和实粮不变。');
  }
  function resume(id: string, citizenId?: string): CommandResult {
    const c = counter(id), t = c && (citizenId ? c.tasks.find(t => t.citizenId === citizenId && t.stage !== 'finished') : activeTask(c)); if (!c || !t || t.stage !== 'paused' || !working(c, t)) return result(false, '原工班没有恢复服务条件。');
    t.stage = t.resumeStage; t.lastObservedAt = now(sim); t.reason = ''; return result(true, '原工班继续；暂停时数不补发。');
  }
  function quote(id: string, citizenId: string, quantity = 1): CounterQuote | null {
    const c = counter(id), buyer = actor(citizenId); if (!c || !buyer) return null;
    const t = activeTask(c), staffed = !!t && t.stage === 'serve' && working(c, t) && onSite(t.citizenId, c), open = c.state === 'open' && withinHours(c);
    const available = Math.floor(amount(shelf(c)) + EPS), waitingMinutes = c.queue.filter(q => ['walking', 'waiting'].includes(q.status)).reduce((n, q) => n + q.quantity * c.serviceMinutesPerUnit - q.servedMinutes, 0);
    return { counterId: id, siteId: c.siteId, point: clone(c.point), price: c.price, available, staffed, open, waitingMinutes, affordable: Number.isInteger(quantity) && quantity > 0 && quantity <= 2 && buyer.money >= quantity * c.price, reason: !open ? '尚未装配或不在开放时段' : !staffed ? '原工作人员正在搬运、暂停或离岗' : available < quantity ? '现场实粮不足' : buyer.money < quantity * c.price ? '真实钱包不足' : '可以申请现场排队；尚未付款' };
  }
  function visit(id: string, citizenId: string, quantity = 1): CommandResult {
    const c = counter(id), q = quote(id, citizenId, quantity), buyer = actor(citizenId), p = profile(sim, citizenId);
    if (!c || !q || !q.open || !q.staffed || !q.affordable || q.available < quantity || !p?.alive || !buyer || (buyer.food ?? 0) + quantity - 1 > 6 || c.queue.length >= 256 || c.sales.length >= 256
      || data()!.counters.some(x => activeTask(x)?.citizenId === citizenId || x.queue.some(entry => entry.citizenId === citizenId && ['walking', 'waiting'].includes(entry.status)))) return result(false, q?.reason ?? '无法排队。');
    c.queue.push({ citizenId, quantity, requestedAt: now(sim), arrivedAt: null, lastServiceAt: now(sim), servedMinutes: 0, status: 'walking' });
    return result(true, '开始沿真实步行路线前往柜台，不预扣钱包。');
  }
  function close(id: string): CommandResult {
    const c = counter(id); if (!c || pendingHandover(c) || ['closing', 'closed'].includes(c.state)) return result(false, '柜台不存在或已关闭。');
    c.state = 'closing'; for (const q of c.queue) if (['walking', 'waiting'].includes(q.status)) q.status = 'cancelled';
    sim.closePublicBudget(c.budgetId); const t = activeTask(c);
    if (t) { t.stage = 'return'; t.resumeStage = 'return'; t.lastObservedAt = now(sim); }
    if (!held(c).length) { c.state = 'closed'; if (t) { t.stage = 'finished'; t.endedAt = now(sim); t.endReason = 'closed-and-empty'; } }
    return result(true, '关闭服务并释放未用授权；实粮等待原工班实际送回各自节点。');
  }
  function sale(c: FoodCounter, t: CounterTask, q: CounterQueue): boolean {
    const buyer = actor(q.citizenId); if (!buyer || !profile(sim, buyer.id)?.alive || !onSite(buyer.id, c) || !onSite(t.citizenId, c) || c.state !== 'open' || !working(c, t) || buyer.money < q.quantity * c.price || (buyer.food ?? 0) + q.quantity - 1 > 6) return false;
    let remaining = q.quantity; const allocations: CounterSale['allocations'] = [], credits = new Map<string, number>();
    const tax = sim.state.taxRate; let supplierGross = 0;
    for (const stock of shelf(c)) { const quantity = Math.min(remaining, stock.remaining); if (quantity <= EPS) continue; const gross = stock.origin.shopId === null ? 0 : quantity * stock.unitPrice; allocations.push({ stockId: stock.id, quantity, gross }); supplierGross += gross; if (stock.origin.shopId !== null) credits.set(stock.origin.shopId, (credits.get(stock.origin.shopId) ?? 0) + gross * (1 - tax)); remaining -= quantity; if (remaining <= EPS) break; }
    const gross = c.price * q.quantity, publicMargin = gross * (1 - tax) - supplierGross;
    if (remaining > EPS || publicMargin < -EPS || sim.state.treasury + publicMargin > 1e9 || [...credits].some(([id, net]) => { const shop = sim.state.shops.find(s => s.id === id); return !shop || sim.shopFunds(shop) + net > 1e9; })) return false;
    // Every preflight above is read-only. From this point all parties and stocks are known.
    buyer.money -= gross; buyer.food = (buyer.food ?? 0) + q.quantity - 1; buyer.needs.hunger = Math.min(100, buyer.needs.hunger + 52);
    for (const part of allocations) { const stock = c.stocks.find(s => s.id === part.stockId)!; stock.remaining -= part.quantity; stock.sold += part.quantity;
      if (stock.origin.shopId !== null) { const shop = sim.state.shops.find(s => s.id === stock.origin.shopId)!; sim.transferShopFunds(shop, part.gross * (1 - tax)); shop.revenue += part.gross; shop.profit += part.gross * (1 - tax); sim.emitEvent({ type: 'wholesale', shopId: shop.id, districtId: shop.districtId, amount: part.gross, quantity: part.quantity, unitPrice: stock.unitPrice }); }
    }
    account.publicReceipt(Math.max(0, publicMargin), buyer.id, c.districtId, '公共食粮柜台真实零售毛利入库');
    sim.emitEvent({ type: 'sale', citizenId: buyer.id, districtId: c.districtId, amount: gross, quantity: q.quantity, siteId: c.siteId, purpose: 'food-counter' });
    sim.emitEvent({ type: 'food-consumed', citizenId: buyer.id, districtId: c.districtId, amount: 1 });
    c.sales.push({ citizenId: buyer.id, staffId: t.citizenId, at: now(sim), quantity: q.quantity, gross, saleTax: gross * tax, supplierGross, supplierTax: supplierGross * tax, publicMargin, taxRate: tax, allocations }); q.status = 'served'; return true;
  }
  function work(c: FoodCounter, t: CounterTask, elapsed: number): boolean {
    const dt = Math.max(0, Math.min(elapsed, now(sim) - t.lastObservedAt)); t.lastObservedAt = now(sim);
    if (t.stage === 'paused') return false;
    if (t.stage === 'handover' && pendingHandover(c) && t.allocated.staffHandover >= pendingHandover(c)!.requiredMinutes - EPS && healthy(t.citizenId) && withinHours(c) && onSite(t.citizenId, c)) { actor(t.citizenId)!.state = 'foodCounterDuty'; return true; }
    if (!working(c, t)) { t.resumeStage = t.stage === 'finished' ? 'serve' : t.stage; t.stage = 'paused'; t.reason = '原工班时间、开放时段或身体条件不足'; const worker = actor(t.citizenId)!; worker.destinationId = null; worker.route = []; worker.routeIndex = 0; worker.state = 'offDuty'; return false; }
    actor(t.citizenId)!.state = 'foodCounterDuty'; if (dt <= EPS) return true;
    const beforeWorked = t.workedMinutes;
    const occupy = () => spendTime(c, t, 'counterWait', Math.max(0, dt - (t.workedMinutes - beforeWorked)));
    if (t.stage === 'handover') {
      const h = pendingHandover(c), from = h && c.tasks.find(x => x.id === h.fromTaskId), to = h && c.tasks.find(x => x.id === h.toTaskId);
      if (!h || !from || !to || !healthy(from.citizenId) || !healthy(to.citizenId) || !onSite(from.citizenId, c) || !onSite(to.citizenId, c) || (from.allocated.staffHandover < h.requiredMinutes - EPS && !working(c, from)) || (to.allocated.staffHandover < h.requiredMinutes - EPS && !working(c, to))) return true;
      spendTime(c, t, 'staffHandover', Math.min(dt, Math.max(0, h.requiredMinutes - t.allocated.staffHandover)));
      if (from.allocated.staffHandover + EPS >= h.requiredMinutes && to.allocated.staffHandover + EPS >= h.requiredMinutes) {
        for (const stock of held(c)) if (stock.location === 'carrier') stock.carrierId = to.citizenId;
        h.completedAt = now(sim); finish(from, 'onsite-handover-completed'); to.stage = stageFor(c, to.citizenId); to.resumeStage = to.stage;
      }
      return true; // Each participant is credited only by their own actual people callback.
    } else if (t.stage === 'assembly') {
      const movement = move(c, t, { siteId: c.siteId }, dt, 'assemblyTravel'); if (!movement.arrived || c.materialReceived < 1 - EPS) return (occupy(), true);
      const done = spendTime(c, t, 'assembly', Math.min(movement.remaining, c.assemblyMinutesRequired - c.assemblyMinutes)); c.assemblyMinutes += done;
      if (c.assemblyMinutes + EPS >= c.assemblyMinutesRequired) { c.materialConsumed = 1; c.state = 'open'; t.stage = 'fetch'; }
    } else if (t.stage === 'fetch') {
      const choices = account.foodAtNode().filter(lot => lot.origin.districtId === c.districtId && lot.quantity >= 1 && lot.unitPrice * (1 - sim.state.taxRate) >= 0 && lot.unitPrice <= c.price * (1 - sim.state.taxRate))
        .sort((a, b) => account.nodeDistance(t.citizenId, a.origin.nodeId) - account.nodeDistance(t.citizenId, b.origin.nodeId) || Number(a.id.slice(12)) - Number(b.id.slice(12)));
      const selected = t.nodeId ? choices.find(lot => lot.origin.nodeId === t.nodeId) : choices[0]; if (!selected) { t.nodeId = null; return (occupy(), true); }
      t.nodeId = selected.origin.nodeId; const moved = move(c, t, { nodeId: t.nodeId }, dt, 'fetchTravel'); if (!moved.arrived) return (occupy(), true);
      const qty = Math.floor(Math.min(selected.quantity, c.batchCap - amount(held(c)), c.batchValueCap / selected.unitPrice) + EPS); if (qty <= 0 || c.stocks.length >= 256) { t.stage = 'serve'; return (occupy(), true); }
      if (!t.pickup || t.pickup.lotId !== selected.id || t.pickup.quantity > qty) t.pickup = { lotId: selected.id, quantity: qty, minutes: 0 };
      t.pickup.minutes += spendTime(c, t, 'loading', Math.min(moved.remaining, t.pickup.quantity * c.handlingMinutesPerUnit - t.pickup.minutes));
      if (t.pickup.minutes + EPS < t.pickup.quantity * c.handlingMinutesPerUnit) return (occupy(), true);
      const receipt = account.withdraw(t.citizenId, t.pickup.lotId, t.pickup.quantity); if (!receipt) { t.pickup = null; return (occupy(), true); }
      c.stocks.push({ id: `counter-stock-${data()!.nextStockId++}`, sourceLotId: receipt.id, origin: clone(receipt.origin), unitPrice: receipt.unitPrice, received: receipt.quantity, remaining: receipt.quantity, sold: 0, returned: 0, pickedAt: now(sim), deliveredAt: null, carrierId: t.citizenId, location: 'carrier' }); t.pickup = null; t.handoffMinutes = 0; t.stage = 'deliver';
    } else if (t.stage === 'deliver') {
      const moved = move(c, t, { siteId: c.siteId }, dt, 'deliveryTravel'); if (!moved.arrived) return (occupy(), true);
      const carrying = held(c).filter(s => s.location === 'carrier' && s.carrierId === t.citizenId), required = amount(carrying) * c.handlingMinutesPerUnit;
      t.handoffMinutes += spendTime(c, t, 'handoff', Math.min(moved.remaining, Math.max(0, required - t.handoffMinutes)));
      if (t.handoffMinutes + EPS < required) return (occupy(), true);
      for (const stock of carrying) { stock.location = 'counter'; stock.deliveredAt = now(sim); } t.nodeId = null; t.handoffMinutes = 0; t.stage = 'serve';
    } else if (t.stage === 'serve') {
      if (!onSite(t.citizenId, c)) { move(c, t, { siteId: c.siteId }, dt, 'deliveryTravel'); return (occupy(), true); }
      const q = c.queue.find(entry => ['walking', 'waiting'].includes(entry.status));
      if (q?.status === 'waiting' && onSite(q.citizenId, c)) {
        const overlap = Math.min(dt, Math.max(0, now(sim) - Math.max(q.arrivedAt!, q.lastServiceAt))); q.lastServiceAt = now(sim);
        q.servedMinutes += spendTime(c, t, 'sales', Math.min(overlap, q.quantity * c.serviceMinutesPerUnit - q.servedMinutes));
        if (q.servedMinutes + EPS >= q.quantity * c.serviceMinutesPerUnit) { if (!sale(c, t, q)) q.status = 'cancelled'; }
      } else if (!q && amount(shelf(c)) < 1) t.stage = 'fetch';
    } else if (t.stage === 'return') {
      const stock = held(c)[0]; if (!stock) { t.stage = 'finished'; t.endedAt = now(sim); t.endReason = 'all-stock-returned'; c.state = 'closed'; return (occupy(), true); }
      if (stock.location === 'counter') {
        const moved = move(c, t, { siteId: c.siteId }, dt, 'returnTravel'); if (!moved.arrived) return (occupy(), true);
        t.returnLoadingMinutes += spendTime(c, t, 'loading', Math.min(moved.remaining, Math.max(0, stock.remaining * c.handlingMinutesPerUnit - t.returnLoadingMinutes)));
        if (t.returnLoadingMinutes + EPS < stock.remaining * c.handlingMinutesPerUnit) return (occupy(), true);
        stock.location = 'carrier'; stock.carrierId = t.citizenId; t.returnLoadingMinutes = 0; return (occupy(), true);
      }
      if (stock.carrierId !== t.citizenId) return (occupy(), true);
      const moved = move(c, t, { nodeId: stock.origin.nodeId }, dt, 'returnTravel'); if (!moved.arrived) return (occupy(), true);
      t.returnUnloadingMinutes += spendTime(c, t, 'handoff', Math.min(moved.remaining, Math.max(0, stock.remaining * c.handlingMinutesPerUnit - t.returnUnloadingMinutes)));
      if (t.returnUnloadingMinutes + EPS >= stock.remaining * c.handlingMinutesPerUnit && account.restore(t.citizenId, stock)) { stock.returned += stock.remaining; stock.remaining = 0; stock.location = 'returned'; t.returnUnloadingMinutes = 0; }
    }
    occupy(); return true;
  }
  account.onAttendance((citizenId, day, minutes) => { const p = data()?.payroll; if (!p) return; const used = p.dayUsed[String(day)] ??= {}; used[citizenId] = (used[citizenId] ?? 0) + minutes; });
  account.onPayroll(claims => {
    const p = data()?.payroll; if (!p) return;
    if (p.periods.length >= 256) throw new Error('柜台结算证据已满；保留已赚工资，须先扩展合法历史归档。');
    p.periods.push({ epoch: p.epoch, closedAt: now(sim), claims: claims.map(claim => ({ ...clone(claim), paidGross: 0 })) });
    for (const c of data()!.counters) { const h = pendingHandover(c); if (h) { h.cancelledAt = now(sim); h.reason = 'payroll-period-ended'; } for (const t of c.tasks) if (t.stage !== 'finished') finish(t, 'payroll-period-ended'); }
    p.epoch++;
  });
  account.onPayment((citizenId, gross) => {
    const p = data()?.payroll; if (!p) return;
    let available = gross, legacy = Math.min(available, p.legacyDue[citizenId] ?? 0); available -= legacy;
    if (legacy > 0) { p.legacyDue[citizenId] -= legacy; if (p.legacyDue[citizenId] <= EPS) delete p.legacyDue[citizenId]; }
    for (const period of p.periods) for (const claim of period.claims) if (claim.citizenId === citizenId) { const paid = Math.min(available, Math.max(0, claim.amount - claim.paidGross)); claim.paidGross += paid; available -= paid; }
  });
  sim.onLoad(() => {
    const old = data() as any; if (!old || old.version !== 1) return;
    const oldIds = old.counters.flatMap((c: FoodCounter) => c.tasks.map(t => t.id));
    old.version = 2; old.payroll = { epoch: 0, periods: [], ...account.activate(), legacyTaskIds: oldIds, legacyBlockedDay: Math.floor(now(sim) / 1440) };
    for (const c of old.counters) { c.handovers = []; c.shiftPlans = []; for (const t of c.tasks) { t.contract.payrollEpoch = null; t.continuationOf = null; t.allocated.staffHandover = 0; t.endedAt = null; t.endReason = 'legacy-evidence-unavailable'; } }
  });
  account.onCitizenActivity((citizen, elapsed) => {
    for (const c of data()?.counters ?? []) {
      const t = c.tasks.find(t => t.stage !== 'finished' && t.citizenId === citizen.id); if (t) return work(c, t, elapsed);
      const q = c.queue.find(entry => entry.citizenId === citizen.id && ['walking', 'waiting'].includes(entry.status)); if (!q) continue;
      if (!profile(sim, citizen.id)?.alive || c.state !== 'open' || !withinHours(c) || citizen.money < q.quantity * c.price) { q.status = 'cancelled'; return false; }
      citizen.state = 'foodCounterQueue';
      const movement = account.move(citizen.id, { siteId: c.siteId }, Math.max(0, Math.min(elapsed, now(sim) - q.lastServiceAt)), `${c.id}:buyer:${q.requestedAt}`);
      if (movement.arrived && q.arrivedAt === null) { q.arrivedAt = now(sim) - Math.max(0, Math.min(elapsed, now(sim) - q.lastServiceAt) - movement.usedMinutes); q.status = 'waiting'; }
      if (q.status === 'walking') q.lastServiceAt = now(sim); return true;
    }
    return false;
  });
  return { register, procure, accept, planNextDay, handover, cancelHandover, pause, resume, quote, visit, close };
}
export function installFoodDistribution(sim: Simulation, accounting: FoodDistributionAccounting) { const controller = createController(sim, accounting); controllers.set(sim, controller); return controller; }
export function foodDistributionController(sim: Simulation) { const controller = controllers.get(sim); if (!controller) throw new Error('食品柜台原型未安装'); return controller; }

/** Validated against the candidate runtime, never the currently loaded balances. */
export function validateFoodDistribution(candidate: State, runtime: any, world: WorldDefinition, nativeKinds: ReadonlyMap<string, string>): void {
  const value = candidate.foodDistribution, budgets: any[] = runtime.publicBudgets ?? [];
  const ensure: (condition: unknown, label: string) => asserts condition = (condition, label) => { if (!condition) throw new Error(`食品柜台存档字段：${label}`); };
  ensure(value !== undefined || !budgets.some(b => b.purpose === 'food-distribution'), '授权必须保留柜台生命周期'); if (!value) { ensure(runtime.foodDistributionVersion === undefined, '结算声明必须有主体'); return; }
  const num = (n: unknown, max = 1e12, integer = false) => ensure(typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max && (!integer || Number.isInteger(n)), '数值');
  const time = candidate.extension!.lastUpdate, citizens = new Set(candidate.citizens.map(c => c.id)), sites = new Map(world.buildings.map(b => [b.id, b])), nodes = new Map(world.nodes.map(n => [n.id, n])), edges = new Map(world.edges.map(e => [e.id, e]));
  const legacy = (value as any).version === 1;
  ensure((legacy || value.version === 2) && Array.isArray(value.counters) && value.counters.length <= 64 && Object.keys(value).length === (legacy ? 5 : 6), '版本与登记结构');
  ensure(legacy ? runtime.foodDistributionVersion === undefined : runtime.foodDistributionVersion === 2 && value.payroll, '结算主体与独立版本声明');
  for (const key of ['nextCounterId', 'nextTaskId', 'nextStockId'] as const) { num(value[key], 1e9, true); ensure(value[key] >= 1, '序号'); }
  const counters = new Set<string>(), tasks = new Set<string>(), stocks = new Set<string>(), activeStaff = new Set<string>(), openBuyers = new Set<string>(), sources = new Map<string, { origin: NodeFreightOrigin; remaining: number; sold: number }>();
  for (const c of value.counters) {
    ensure(/^food-counter-[1-9][0-9]*$/.test(c.id) && Number(c.id.slice(13)) < value.nextCounterId && !counters.has(c.id), '柜台序号'); counters.add(c.id);
    const site = sites.get(c.siteId), budget = budgets.find(b => b.id === c.budgetId);
    ensure(site && !Reflect.get(site, 'floorPlanProfile') && ['school', 'hall', 'station'].includes(site.kind) && c.districtId === site.districtId && JSON.stringify(c.point) === JSON.stringify(site.door), '真实公共入口');
    ensure(budget && c.budgetId === c.id && budget.siteId === c.siteId && budget.purpose === 'food-distribution' && budget.cap === c.cap && budget.approvedAt === c.approvedAt && JSON.stringify(budget.approvedBy) === JSON.stringify(c.approvedBy), '法定授权');
    ensure(c.cap === 40 && c.price === 12 && c.batchCap === 8 && c.batchValueCap === 40 && c.assemblyMinutesRequired === 10 && c.serviceMinutesPerUnit === 2 && c.handlingMinutesPerUnit === .25 && c.opensAt === 8 && c.closesAt === 17, '冻结有限条款');
    num(c.approvedAt, time); ensure(Array.isArray(c.signaturePositions) && c.signaturePositions.length === c.approvedBy.length && c.signaturePositions.every((s, i) => s.actorId === c.approvedBy[i] && [s.position.x, s.position.y, s.position.z].every(Number.isFinite)), '签署实际位置');
    ensure(['awaitingMaterial', 'assembling', 'open', 'closing', 'closed'].includes(c.state) && (['closing', 'closed'].includes(c.state) ? budget.closedAt !== null : budget.closedAt === null), '关闭授权');
    num(c.spent, 40); num(c.materialReceived, 1 + EPS); num(c.materialConsumed, 1, true); num(c.assemblyMinutes, 10 + EPS);
    ensure(Math.abs(c.spent - budget.spent) < EPS && c.materialConsumed <= c.materialReceived + EPS && (c.materialConsumed === 1) === (c.assemblyMinutes >= 10 - EPS), '物料装配');
    ensure(!['open'].includes(c.state) || c.materialConsumed === 1, '先装配后开柜');
    ensure(Array.isArray(c.receipts) && c.receipts.length <= 256, '真实采购收据'); let paid = 0, received = 0;
    for (const receipt of c.receipts) { num(receipt.paid, 40); num(receipt.quantity, 1 + EPS); num(receipt.tax, receipt.paid); ensure(Array.isArray(receipt.lots) && receipt.lots.length <= candidate.shops.length, '采购批次'); let gross = 0, quantity = 0, taxes = 0;
      for (const lot of receipt.lots) { const shop = candidate.shops.find(s => s.id === lot.shopId); ensure(shop && sites.get(shop.buildingId)?.kind === 'workshop', '真实工业来源'); num(lot.quantity, 1 + EPS); num(lot.unitPrice); ensure(lot.unitPrice >= 4 && Math.abs(lot.quantity * lot.unitPrice - lot.gross) < EPS && lot.net <= lot.gross, '采购成本'); num(lot.net, lot.gross); gross += lot.gross; quantity += lot.quantity; taxes += lot.gross - lot.net; }
      ensure(Math.abs(gross - receipt.paid) < EPS && Math.abs(quantity - receipt.quantity) < EPS && Math.abs(taxes - receipt.tax) < EPS, '采购资金物料恒等'); paid += gross; received += quantity;
    }
    ensure(Math.abs(paid - c.spent) < EPS && Math.abs(received - c.materialReceived) < EPS, '材料总账');
    ensure(Array.isArray(c.tasks) && c.tasks.length <= 256 && Array.isArray(c.stocks) && c.stocks.length <= 256 && Array.isArray(c.queue) && c.queue.length <= 256 && Array.isArray(c.sales) && c.sales.length <= 256, '有限生命周期');
    let assembly = 0; const staffIds = new Set<string>();
    for (const t of c.tasks) { ensure(/^food-task-[1-9][0-9]*$/.test(t.id) && Number(t.id.slice(10)) < value.nextTaskId && !tasks.has(t.id) && citizens.has(t.citizenId), '原职员任务'); tasks.add(t.id); staffIds.add(t.citizenId);
      ensure(t.contract.workId === c.siteId && (/^standing-day-[0-9]+$/.test(t.contract.id) || /^public-shift-[0-9]+$/.test(t.contract.id)), '原工班引用'); num(t.contract.day, Math.floor(time / 1440), true); ensure(t.contract.day === Math.floor(t.acceptedAt / 1440) && t.contract.id.endsWith(`-${t.contract.day}`), '原工班日程');
      if (t.contract.id.startsWith('standing-day-')) ensure(!runtime.publicLabor || t.contract.day < runtime.publicLabor.standingUntilDay, '已有站立拨款期限');
      else { const shift = runtime.publicLabor?.shifts.find((shift: any) => shift.id === t.contract.id), assignment = shift?.assignments.find((a: any) => a.citizenId === t.citizenId && a.workId === t.contract.workId); if (t.contract.day >= Math.floor(time / 1440) - 14) ensure(assignment && Math.abs(assignment.ratePerMinute - t.contract.ratePerMinute) < EPS && assignment.workedMinutes >= t.workedMinutes - EPS, '真实班次费率与分钟'); } num(t.contract.availableMinutes, 480); num(t.contract.ratePerMinute, 1); ensure(t.contract.ratePerMinute > 0, '原时薪');
      ensure(['assembly', 'fetch', 'deliver', 'serve', 'return', ...(legacy ? [] : ['handover']), 'paused', 'finished'].includes(t.stage) && ['assembly', 'fetch', 'deliver', 'serve', 'return', ...(legacy ? [] : ['handover'])].includes(t.resumeStage), '任务状态');
      num(t.acceptedAt, time); num(t.lastObservedAt, time); ensure(t.acceptedAt >= c.approvedAt && t.lastObservedAt >= t.acceptedAt, '任务时钟'); num(t.workedMinutes, t.contract.availableMinutes + EPS); num(t.earned, 480); let minutes = 0;
      ensure(Object.keys(t.allocated).length === (legacy ? 9 : 10), '时数分摊'); for (const key of ['assemblyTravel', 'assembly', 'fetchTravel', 'deliveryTravel', 'sales', 'returnTravel', 'loading', 'handoff', 'counterWait', ...(legacy ? [] : ['staffHandover' as const])] as const) { num(t.allocated[key], 480); minutes += t.allocated[key]; } assembly += t.allocated.assembly;
      ensure(Math.abs(minutes - t.workedMinutes) < EPS && Math.abs(t.earned - t.workedMinutes * t.contract.ratePerMinute) < EPS && t.workedMinutes <= t.lastObservedAt - t.acceptedAt + EPS, '原工班时数与工资');
      ensure(t.nodeId === null || nodes.has(t.nodeId), '搬运目标节点'); num(t.handoffMinutes, 2); num(t.returnLoadingMinutes, 2); num(t.returnUnloadingMinutes, 2);
      if (t.pickup !== null) { ensure(/^freight-lot-[1-9][0-9]*$/.test(t.pickup.lotId), '装载原货引用'); num(t.pickup.quantity, 8, true); num(t.pickup.minutes, t.pickup.quantity * .25 + EPS); ensure(t.pickup.quantity > 0, '装载数量'); } if (t.stage !== 'finished') { ensure(!activeStaff.has(t.citizenId), '同一工班不得两柜同时使用'); activeStaff.add(t.citizenId); }
    }
    if (!legacy) {
      ensure(Array.isArray(c.shiftPlans) && c.shiftPlans.length <= 256 && new Set(c.shiftPlans.map(s => s.id)).size === c.shiftPlans.length, '真实来日授权回执');
      for (const saved of c.shiftPlans) { num(saved.day, Math.floor(time / 1440) + 1, true); num(saved.cap, 1e9); ensure(saved.id === `public-shift-${saved.day}` && sites.has(saved.siteId) && Array.isArray(saved.approvedBy) && saved.approvedBy.length === 2 && new Set(saved.approvedBy).size === 2 && saved.approvedBy.every(id => citizens.has(id)), '原现场审批人员'); if (saved.day >= Math.floor(time / 1440) - 14) { const plan = runtime.publicLabor?.shifts.find((s: any) => s.id === saved.id); ensure(plan && plan.day === saved.day && plan.siteId === saved.siteId && plan.cap === saved.cap && JSON.stringify(plan.approvedBy) === JSON.stringify(saved.approvedBy), '真实原班承诺不得遗失或改额'); } }
      ensure(Array.isArray(c.handovers) && c.handovers.length <= 256, '人员交班档案'); const handoverTasks = new Set<string>();
      for (const h of c.handovers) {
        const from = c.tasks.find(t => t.id === h.fromTaskId), to = c.tasks.find(t => t.id === h.toTaskId);
        ensure(from && to && from.citizenId !== to.citizenId && !handoverTasks.has(from.id) && !handoverTasks.has(to.id) && from.contract.day === to.contract.day && from.contract.payrollEpoch === to.contract.payrollEpoch, '两名原班交班引用');
        handoverTasks.add(from.id); handoverTasks.add(to.id); num(h.requestedAt, time); num(h.carriedQuantity, 8); num(h.requiredMinutes, 2); ensure(h.requiredMinutes === Math.max(1, h.carriedQuantity * c.handlingMinutesPerUnit), '按实际携货数量占用交班工时'); ensure(h.requiredMinutes >= 1 && from.acceptedAt === h.requestedAt && to.acceptedAt === h.requestedAt && dist(h.fromPosition, c.point) <= .05 && dist(h.toPosition, c.point) <= .05, '双方真实同场交班');
        ensure(Array.isArray(h.stockIds) && new Set(h.stockIds).size === h.stockIds.length && h.stockIds.every(id => c.stocks.some(s => s.id === id && s.pickedAt <= h.requestedAt)), '交班原批次');
        ensure(from.allocated.staffHandover <= h.requiredMinutes + EPS && to.allocated.staffHandover <= h.requiredMinutes + EPS, '两人各一次有限工时');
        ensure(h.completedAt === null || Number.isFinite(h.completedAt) && h.completedAt >= h.requestedAt && h.completedAt <= time, '交班完成时钟'); ensure(h.cancelledAt === null || Number.isFinite(h.cancelledAt) && h.cancelledAt >= h.requestedAt && h.cancelledAt <= time, '交班取消时钟'); ensure(h.completedAt === null || h.cancelledAt === null, '不可完成后取消');
        if (h.completedAt !== null) ensure(from.stage === 'finished' && from.endedAt === h.completedAt && from.allocated.staffHandover >= h.requiredMinutes - EPS && to.allocated.staffHandover >= h.requiredMinutes - EPS && h.completedAt - h.requestedAt + EPS >= h.requiredMinutes, '两人实际足分钟才交接');
        if (h.completedAt === null && h.cancelledAt === null) ensure(from.stage !== 'finished' && to.stage !== 'finished' && (from.stage === 'handover' || from.stage === 'paused' && from.resumeStage === 'handover') && (to.stage === 'handover' || to.stage === 'paused' && to.resumeStage === 'handover') && h.stockIds.every(id => { const stock = c.stocks.find(s => s.id === id)!; return stock.location !== 'carrier' || stock.carrierId === from.citizenId; }), '未完交班保留原保管人');
      }
      for (const t of c.tasks) ensure(t.allocated.staffHandover === 0 || handoverTasks.has(t.id), '人员交班劳动须有真实双方回执');
    }
    ensure(Math.abs(assembly - c.assemblyMinutes) < EPS, '装配工时'); let live = 0;
    for (const s of c.stocks) { ensure(/^counter-stock-[1-9][0-9]*$/.test(s.id) && Number(s.id.slice(14)) < value.nextStockId && !stocks.has(s.id), '库存序号'); stocks.add(s.id);
      ensure(/^freight-lot-[1-9][0-9]*$/.test(s.sourceLotId) && runtime.freightTracking && Number(s.sourceLotId.slice(12)) < runtime.freightTracking.nextId, '真实卸货批次'); const o = s.origin, node = nodes.get(o.nodeId), edge = edges.get(o.fromEdgeId);
      ensure(o.location === 'node' && Object.keys(o).length === 10 && o.districtId === c.districtId && node?.districtId === c.districtId && edge && nativeKinds.get(o.vehicleId) === edge.mode && (o.direction === 1 ? edge.to : o.direction === -1 ? edge.from : null) === node?.id && dist(o.position, node!.position) <= (edge.mode === 'road' ? 1.300001 : 1e-6), '真实卸货位置货权'); num(o.arrivedAt, time); num(o.receivedQuantity, 10000); ensure(o.receivedQuantity > 0, '原入库量');
      const producer = candidate.shops.find(shop => shop.id === o.shopId); ensure(o.shopId === null || producer && ['farm', 'dock'].includes(sites.get(producer.buildingId)?.kind ?? ''), '食品来源'); num(s.unitPrice); ensure(s.unitPrice >= 4 && s.unitPrice <= 12 && s.received * s.unitPrice <= 40 + EPS, '实际冻结报价');
      for (const key of ['received', 'remaining', 'sold', 'returned'] as const) num(s[key], 8); ensure(s.received > 0 && Math.abs(s.received - s.remaining - s.sold - s.returned) < EPS && citizens.has(s.carrierId), '实粮库存恒等');
      num(s.pickedAt, time); ensure(s.pickedAt >= o.arrivedAt && s.pickedAt >= c.approvedAt, '真实先卸后取'); ensure(s.deliveredAt === null || Number.isFinite(s.deliveredAt) && s.deliveredAt >= s.pickedAt && s.deliveredAt <= time, '交接时间');
      ensure(['carrier', 'counter', 'returned'].includes(s.location) && (s.location !== 'counter' || s.deliveredAt !== null) && (s.location !== 'returned' || s.remaining === 0 && s.returned > 0), '实粮保管位置'); live += s.remaining;
      if (!legacy) { ensure(staffIds.has(s.carrierId), '保管人必须已有原岗位劳动段'); const responsible = [...c.tasks].reverse().find(t => !c.handovers.some(h => h.toTaskId === t.id && h.completedAt === null)); if (s.location === 'carrier') ensure(responsible?.citizenId === s.carrierId, '未完成交班不能换携货人'); }
      const total = sources.get(s.sourceLotId); if (total) { ensure(JSON.stringify(total.origin) === JSON.stringify(o), '不可重定位原货'); total.remaining += s.remaining; total.sold += s.sold; } else sources.set(s.sourceLotId, { origin: o, remaining: s.remaining, sold: s.sold });
    }
    ensure(live <= 8 + EPS && (c.state !== 'closed' || live === 0), '有限柜存与退货完成'); const salesByStock = new Map<string, number>(); let totalService = 0;
    for (const sale of c.sales) { ensure(citizens.has(sale.citizenId) && staffIds.has(sale.staffId), '实际买家工作人员'); num(sale.at, time); num(sale.quantity, 2, true); ensure(sale.quantity > 0, '成交数量'); num(sale.taxRate, .3); num(sale.gross, 24); num(sale.supplierGross, 24); num(sale.publicMargin, 24); num(sale.saleTax, 24); num(sale.supplierTax, 24); let q = 0, h = 0;
      for (const p of sale.allocations) { const stock = c.stocks.find(s => s.id === p.stockId); ensure(stock, '销售原货批次'); num(p.quantity, 2); ensure(Math.abs(p.gross - p.quantity * (stock.origin.shopId === null ? 0 : stock.unitPrice)) < EPS, '货主成交价'); q += p.quantity; h += p.gross; salesByStock.set(p.stockId, (salesByStock.get(p.stockId) ?? 0) + p.quantity); }
      ensure(Math.abs(q - sale.quantity) < EPS && Math.abs(h - sale.supplierGross) < EPS && sale.gross === sale.quantity * 12 && Math.abs(sale.saleTax - sale.gross * sale.taxRate) < EPS && Math.abs(sale.supplierTax - sale.supplierGross * sale.taxRate) < EPS && Math.abs(sale.publicMargin - sale.gross * (1 - sale.taxRate) + sale.supplierGross) < EPS, '买家支付分账恒等'); totalService += sale.quantity * 2;
    }
    for (const stock of c.stocks) ensure(Math.abs((salesByStock.get(stock.id) ?? 0) - stock.sold) < EPS, '售出实物批次');
    for (const q of c.queue) { ensure(citizens.has(q.citizenId) && ['walking', 'waiting', 'served', 'cancelled'].includes(q.status), '真实排队'); num(q.quantity, 2, true); ensure(q.quantity > 0, '排队数量'); num(q.requestedAt, time); num(q.lastServiceAt, time); ensure(q.requestedAt >= c.approvedAt && q.lastServiceAt >= q.requestedAt, '排队时钟'); num(q.servedMinutes, q.quantity * 2 + EPS);
      ensure(q.arrivedAt === null || Number.isFinite(q.arrivedAt) && q.arrivedAt >= q.requestedAt - EPS && q.arrivedAt <= time, '实际到场时间'); if (['walking', 'waiting'].includes(q.status)) { ensure(!openBuyers.has(q.citizenId) && !activeStaff.has(q.citizenId), '同一买家不可两处排队'); openBuyers.add(q.citizenId); }
      if (q.status === 'served') ensure(q.servedMinutes >= q.quantity * 2 - EPS && c.sales.some(s => s.citizenId === q.citizenId && s.at >= q.requestedAt), '完整工时才成交'); }
    ensure(c.tasks.reduce((n, t) => n + t.allocated.sales, 0) >= totalService - EPS, '销售占用原工班服务时数');
  }
  if (!legacy) {
    const p = value.payroll;
    ensure(p.dayUsed && typeof p.dayUsed === 'object' && !Array.isArray(p.dayUsed), '原日工班用量');
    ensure(p.legacyBlockedDay === null || Number.isInteger(p.legacyBlockedDay) && p.legacyBlockedDay >= 0 && p.legacyBlockedDay <= Math.floor(time / 1440), '旧无证日保留限制');
    for (const [day, used] of Object.entries(p.dayUsed)) { ensure(/^(0|[1-9][0-9]*)$/.test(day) && Number(day) <= Math.floor(time / 1440) && used && typeof used === 'object' && !Array.isArray(used), '单调原工班日'); for (const [id, minutes] of Object.entries(used)) { ensure(citizens.has(id), '日用量真实人员'); num(minutes, 480 + EPS); } }
    const byDay = new Map<string, number>();
    num(p.epoch, 256, true); ensure(Array.isArray(p.periods) && p.periods.length === p.epoch && p.legacyDue && typeof p.legacyDue === 'object' && Array.isArray(p.legacyTaskIds) && new Set(p.legacyTaskIds).size === p.legacyTaskIds.length, '真实结算期结构');
    const unverified = new Set<string>(), totals = new Map<string, { minutes: number; gross: number; rate: number }>();
    const outstanding = new Map<string, number>();
    for (const [id, amount] of Object.entries(p.legacyDue)) { ensure(citizens.has(id), '旧应付工资债权'); num(amount, 1e9); outstanding.set(id, amount); }
    for (const [i, period] of p.periods.entries()) { ensure(period.epoch === i && Array.isArray(period.claims) && period.claims.length <= 2048, '不可重用结算期'); num(period.closedAt, time); if (i) ensure(period.closedAt >= p.periods[i - 1].closedAt, '结算单调时钟'); const keys = new Set<string>();
      for (const claim of period.claims) { ensure(citizens.has(claim.citizenId) && sites.has(claim.workId) && !candidate.shops.some(s => s.buildingId === claim.workId), '原公共雇主'); const key = `${claim.citizenId}:${claim.workId}`; ensure(!keys.has(key), '结算债权唯一'); keys.add(key); num(claim.minutes, 480); num(claim.ratePerMinute, 1); num(claim.amount, 480); num(claim.paidGross, claim.amount + EPS); ensure(Math.abs(claim.amount - claim.minutes * claim.ratePerMinute) < EPS, '真实已赚合同恒等'); outstanding.set(claim.citizenId, (outstanding.get(claim.citizenId) ?? 0) + claim.amount - claim.paidGross); }
    }
    for (const c of value.counters) for (const t of c.tasks) { if (t.contract.payrollEpoch === null) { unverified.add(t.id); ensure(p.legacyTaskIds.includes(t.id), '旧任务必须保留迁移声明'); continue; }
      num(t.contract.payrollEpoch, p.epoch, true);
      if (t.contract.payrollEpoch < p.epoch) { const end = p.periods[t.contract.payrollEpoch].closedAt; ensure(t.stage === 'finished' && t.endedAt !== null && t.endedAt <= end && t.acceptedAt <= end, '旧结算劳动段已经真实结束'); }
      if (t.contract.payrollEpoch > 0) ensure(t.acceptedAt >= p.periods[t.contract.payrollEpoch - 1].closedAt, '新段不能借用过去结算分钟');
      const dayKey = `${t.contract.day}:${t.citizenId}`; byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + t.workedMinutes);
      if (t.continuationOf !== null) { const previous = c.tasks.find(x => x.id === t.continuationOf); ensure(previous && previous !== t && previous.citizenId === t.citizenId && previous.contract.workId === t.contract.workId && previous.stage === 'finished' && (previous.endedAt === null ? previous.contract.payrollEpoch === null : previous.endedAt <= t.acceptedAt) && Number(previous.id.slice(10)) < Number(t.id.slice(10)), '续班引用保留原劳动段'); }
      const key = `${t.contract.payrollEpoch}:${t.citizenId}:${t.contract.workId}`; const total = totals.get(key) ?? { minutes: 0, gross: 0, rate: t.contract.ratePerMinute }; ensure(Math.abs(total.rate - t.contract.ratePerMinute) < EPS, '原结算期冻结费率'); total.minutes += t.workedMinutes; total.gross += t.earned; totals.set(key, total);
      ensure(t.endedAt === null || Number.isFinite(t.endedAt) && t.endedAt >= t.acceptedAt && t.endedAt <= time, '任务实际结束时刻'); if (t.stage === 'finished') ensure(t.endedAt !== null && t.lastObservedAt <= t.endedAt && t.workedMinutes <= t.endedAt - t.acceptedAt + EPS, '新任务实际结束与工时证据');
    }
    for (const [key, minutes] of byDay) { const [day, id] = key.split(':'); ensure(minutes <= (p.dayUsed[day]?.[id] ?? 0) + EPS, '柜台与普通劳动共享原日授权'); }
    ensure(p.legacyTaskIds.length === unverified.size && p.legacyTaskIds.every(id => unverified.has(id)), '不可把新任务伪装成旧任务');
    for (const [key, total] of totals) { const [epoch, citizenId, workId] = key.split(':'); const period = Number(epoch) < p.epoch ? p.periods[Number(epoch)] : null; const claims = period ? period.claims : runtime.wageAccruals ?? []; const claim = claims.find((claim: any) => claim.citizenId === citizenId && claim.workId === workId && (period || claim.shopId === null)); ensure(total.minutes <= EPS || claim && claim.minutes + EPS >= total.minutes && claim.amount + EPS >= total.gross && Math.abs(claim.ratePerMinute - total.rate) < EPS, '任务必须属于真实原应计或已结算工资期'); }
    const usedByActor = new Map<string, number>(), claimedByActor = new Map<string, number>();
    for (const used of Object.values(p.dayUsed)) for (const [id, minutes] of Object.entries(used)) usedByActor.set(id, (usedByActor.get(id) ?? 0) + minutes);
    for (const claim of [...p.periods.flatMap(period => period.claims), ...(runtime.wageAccruals ?? []).filter((claim: any) => claim.shopId === null)]) claimedByActor.set(claim.citizenId, (claimedByActor.get(claim.citizenId) ?? 0) + claim.minutes);
    for (const [id, minutes] of claimedByActor) ensure(minutes <= (usedByActor.get(id) ?? 0) + EPS, '普通与柜台原已赚分钟都保留日用量');
    const dues = new Map<string, number>(); for (const owed of [...(runtime.wageArrears ?? []), ...(runtime.wages ?? [])]) if (owed.shopId === null) dues.set(owed.citizenId, (dues.get(owed.citizenId) ?? 0) + owed.amount);
    for (const [id, amount] of outstanding) ensure(amount <= (dues.get(id) ?? 0) + EPS, '未付工资保留真实原债权');
  }
  for (const [id, source] of sources) { const current = runtime.freightTracking.origins[id], lots = Object.values(runtime.freightLots ?? {}).flat() as any[]; const remaining = lots.filter(l => l.id === id).reduce((n, l) => n + l.quantity, 0);
    ensure(!current || JSON.stringify(current) === JSON.stringify(source.origin), '原区货与保管货同一收据'); ensure(remaining + source.remaining + source.sold <= source.origin.receivedQuantity + EPS, '跨保管数量不得超原卸货'); }
  for (const budget of budgets.filter(b => b.purpose === 'food-distribution')) ensure(value.counters.some(c => c.budgetId === budget.id), '不得丢失已签柜台');
}
