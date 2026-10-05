import { isCanonicalNpcWage, type PublicPurchaseReceipt, type Simulation } from '../simulation';
import { clinicalDoctorWorkWindows } from './clinical';
import type { DisinfectionJob, HygieneReceipt, WasteBatch } from './hygiene';
import type { Citizen, SimState, WorldDefinition } from '../types';

/** Public clinic housekeeping uses original finite wages and industrial goods.
 * It is a request/approval/consumption lifecycle, not terminal waste disposal. */
export const PUBLIC_DISINFECTION_PURPOSE = 'hygiene-disinfection' as const;
const EPS = 1e-7, LIMIT = 64, CAP = 20;
export interface PublicDisinfectionDemand {
  id: string; batchId: string; siteId: string; reporterId: string; reporterRole: '医生' | 'doctor'; reporterAge: number;
  reportedAt: number; observedGeneratedUnits: number; observedContaminatedUnits: number; observedReservedUnits: number;
  reportWorkWindows: { start: number; end: number }[];
  state: 'awaitingReview' | 'awaitingBudget' | 'awaitingSupply' | 'processing' | 'completed' | 'superseded';
  approvedAt: number | null; approvedBy: string[]; authorizedCap: number; spent: number;
  receipt: (PublicPurchaseReceipt & { procurementId: string; budgetId: string; purchasedAt: number }) | null;
  jobId: string | null; supersededByJobId?: string; retryAt: number; closedAt: number | null; reason: string;
}
interface Integration {
  atBatch: (batch: WasteBatch, person: Citizen) => boolean;
  workWindows: (person: Citizen, siteId: string, minutes: number, earliestAt: number) => readonly Readonly<{ start: number; end: number }>[];
  createJob: (demand: PublicDisinfectionDemand, receipt: HygieneReceipt) => DisinfectionJob;
}
const clock = (s: SimState) => s.extension!.lastUpdate;
const final = (d: PublicDisinfectionDemand) => d.state === 'completed' || d.state === 'superseded';

const certifiedWages = new WeakMap<SimState, { tick: number; at: number; seen: WeakSet<object>; ranges: Map<string, { start: number; end: number; siteId: string }[]> }>();
export function certifiedHygieneDoctorWorkWindows(simulation: Simulation, person: Citizen, siteId: string, minutes: number, earliestAt: number): readonly Readonly<{ start: number; end: number }>[] {
  const state = simulation.state, frame = certifiedWages.get(state);
  if (!frame || frame.tick !== state.tick || frame.at !== clock(state)) return [];
  const ranges = clinicalDoctorWorkWindows(simulation, person, siteId, minutes, earliestAt).flatMap(window => (frame.ranges.get(person.id) ?? []).filter(wage => wage.siteId === siteId).map(wage => ({ start: Math.max(window.start, wage.start), end: Math.min(window.end, wage.end) }))).filter(r => r.end - r.start > EPS).sort((a, b) => a.start - b.start || a.end - b.end);
  const union: { start: number; end: number }[] = [];
  for (const range of ranges) { const last = union.at(-1); if (last && last.end >= range.start - EPS) last.end = Math.max(last.end, range.end); else union.push({ ...range }); }
  return Object.freeze(union.map(range => Object.freeze(range)));
}
export function installPublicDisinfection(simulation: Simulation, integration: Integration): void {
  simulation.onPhase('time', s => certifiedWages.set(s, { tick: s.tick, at: clock(s), seen: new WeakSet(), ranges: new Map() }));
  simulation.onLoad(() => certifiedWages.delete(simulation.state));
  simulation.onEvent('wage-earned', event => {
    const s = simulation.state, frame = certifiedWages.get(s);
    if (!isCanonicalNpcWage(event) || !frame || frame.tick !== s.tick || frame.at !== clock(s) || frame.seen.has(event) || !event.citizenId || !event.siteId || !Number.isFinite(event.creditedWorkStartAt) || !Number.isFinite(event.creditedWorkEndAt) || event.creditedWorkEndAt! <= event.creditedWorkStartAt! || event.creditedWorkEndAt! > frame.at + EPS) return;
    frame.seen.add(event); const ranges = frame.ranges.get(event.citizenId) ?? []; ranges.push({ start: event.creditedWorkStartAt!, end: event.creditedWorkEndAt!, siteId: event.siteId }); frame.ranges.set(event.citizenId, ranges);
  });
  // There is deliberately no public command or generic-event request constructor.
  // Current native wages/arrival are read after the original people-phase work.
  simulation.onPhase('people', (s, minutes) => {
    const h = s.hygiene; if (!h) return;
    for (const batch of h.batches) {
      if (batch.contaminatedUnits - batch.reservedUnits < 1 || h.jobs.some(j => j.batchId === batch.id && !['completed', 'cancelled'].includes(j.state))
        || h.publicDemands?.some(d => d.batchId === batch.id && !final(d)) || (h.publicDemands?.length ?? 0) >= LIMIT || h.jobs.length >= LIMIT * 2 || h.nextJobId >= 1e9) continue;
      const reporter = s.citizens.find(person => integration.atBatch(batch, person) && integration.workWindows(person, batch.siteId, minutes, batch.firstAt).length > 0);
      if (!reporter) continue;
      const windows = integration.workWindows(reporter, batch.siteId, minutes, batch.firstAt);
      h.publicVersion ??= 1; h.nextDemandId ??= 1; h.publicDemands ??= [];
      const demand: PublicDisinfectionDemand = { id: `hygiene-demand-${h.nextDemandId++}`, batchId: batch.id, siteId: batch.siteId, reporterId: reporter.id, reporterRole: reporter.role as '医生' | 'doctor', reporterAge: s.extension!.actorProfiles[reporter.id].age,
        reportedAt: clock(s), observedGeneratedUnits: batch.generatedUnits, observedContaminatedUnits: batch.contaminatedUnits, observedReservedUnits: batch.reservedUnits, reportWorkWindows: windows.map(w => ({ ...w })), state: 'awaitingReview', approvedAt: null, approvedBy: [], authorizedCap: 0, spent: 0, receipt: null, jobId: null, retryAt: clock(s), closedAt: null, reason: '具名在场医生观察到真实用后材料；请求20文以内公共消毒采购，待双官实际在岗审核。' };
      h.publicDemands.push(demand);
      simulation.appendNotice('hygiene-demand', `${reporter.name}在原诊所提交${batch.id}卫生需求；现有${batch.contaminatedUnits}份待处理用品，封存残留仍须保管。`, simulation.worldDefinition.buildings.find(b => b.id === batch.siteId)!.districtId);
    }
    synchronize(simulation);
  });
  simulation.onPhase('politics', s => {
    for (const demand of s.hygiene?.publicDemands ?? []) {
      if (final(demand) || demand.approvedAt !== null) continue;
      const site = simulation.worldDefinition.buildings.find(b => b.id === demand.siteId)!;
      const offices = simulation.worldDefinition.buildings.filter(b => b.districtId === site.districtId && ['hall', 'core', 'bank'].includes(b.kind));
      let approved = false;
      for (const office of offices) {
        const signers = s.citizens.filter(p => p.workId === office.id && ['官员', '财政官', 'official', '议员', 'council'].includes(p.role) && s.extension!.actorProfiles[p.id]?.alive && s.extension!.actorProfiles[p.id].age >= 18 && simulation.isOnDuty(p.id, office.id)).slice(0, 2).map(p => p.id);
        if (signers.length !== 2 || !simulation.authorizePublicBudget({ id: demand.id, siteId: demand.siteId, purpose: PUBLIC_DISINFECTION_PURPOSE, cap: CAP, approvedAt: clock(s), approvedBy: signers })) continue;
        demand.approvedAt = clock(s); demand.approvedBy = signers; demand.authorizedCap = CAP; demand.state = 'awaitingSupply'; demand.retryAt = clock(s); demand.reason = '双官实际在岗已批准有限额度；采购保护既有工资、运维和其他授权。'; approved = true; break;
      }
      if (!approved) { demand.state = 'awaitingReview'; demand.reason = simulation.publicBudgetSnapshot().available < CAP ? '可分配财政不足20文；保留具名需求，不挪用工资与运维储备。' : '等候本区同一机构两名合资格官员真实在岗联审。'; }
    }
  });
  simulation.onPhase('finance', s => {
    synchronize(simulation);
    for (const demand of s.hygiene?.publicDemands ?? []) {
      if (final(demand) || demand.approvedAt === null || demand.jobId !== null || demand.retryAt > clock(s)) continue;
      const h = s.hygiene!, batch = h.batches.find(b => b.id === demand.batchId)!;
      if (batch.contaminatedUnits - batch.reservedUnits < 1 || h.jobs.some(j => j.batchId === batch.id && !['completed', 'cancelled'].includes(j.state))) {
        demand.state = 'superseded'; demand.supersededByJobId = h.jobs.find(j => j.batchId === batch.id && j.cancelledAt === null)!.id; demand.closedAt = clock(s); demand.reason = '原单位已有合法处理认领；本公共额度关闭，没有重复买料或处理。'; simulation.closePublicBudget(demand.id); continue;
      }
      if (h.jobs.length >= LIMIT * 2 || h.jobs.filter(j => !['completed', 'cancelled'].includes(j.state)).length >= LIMIT || h.capacityHistory.length >= 1024) { demand.reason = '现有有限订单与劳动档案容量尚未结清，采购暂停。'; continue; }
      demand.retryAt = clock(s) + 60;
      const site = simulation.worldDefinition.buildings.find(b => b.id === demand.siteId)!;
      const snapshot = simulation.publicBudgetSnapshot(), discretionary = Math.max(0, s.treasury - snapshot.reserve - (snapshot.authorizedRemaining - (demand.authorizedCap - demand.spent)));
      // Preflight a complete indivisible unit. The existing purchase API can
      // return fractional quantities; never buy a fraction and invent the rest.
      const offers = s.shops.filter(shop => simulation.shopCommodity(shop) === 'materials' && shop.inventory >= 1).map(shop => ({ shop, quote: simulation.quoteSupply(shop.id, 1) })).filter(({ shop, quote }) => quote.quantity >= 1 && Number.isFinite(quote.unitPrice) && quote.unitPrice > 0 && quote.unitPrice <= demand.authorizedCap - demand.spent && quote.unitPrice <= discretionary && simulation.shopFunds(shop) + quote.unitPrice * (1 - s.taxRate) <= 1e9).sort((a, b) => Number(b.shop.districtId === site.districtId) - Number(a.shop.districtId === site.districtId) || a.quote.unitPrice - b.quote.unitPrice || a.shop.id.localeCompare(b.shop.id));
      const offer = offers[0];
      if (!offer) { demand.state = discretionary <= EPS ? 'awaitingBudget' : 'awaitingSupply'; demand.reason = '等候一整份真实工业库存与受保护的公共现金；没有免费或部分拼造材料。'; continue; }
      const procurementId = `${demand.id}-materials`;
      const purchase = simulation.purchasePublicSupplyReceipt({ supplierShopIds: [offer.shop.id], requestedGross: offer.quote.unitPrice, requestedQuantity: 1, districtId: site.districtId, siteId: site.id, purpose: PUBLIC_DISINFECTION_PURPOSE, procurementId, budgetId: demand.id });
      if (purchase.quantity === 0) { demand.state = purchase.reason === 'budget' ? 'awaitingBudget' : 'awaitingSupply'; continue; }
      if (Math.abs(purchase.quantity - 1) > EPS || purchase.lots.length !== 1) throw new Error('公共消毒整份采购与预检不一致。');
      demand.receipt = { ...purchase, procurementId, budgetId: demand.id, purchasedAt: clock(s) }; demand.spent = purchase.paid;
      const lot = purchase.lots[0];
      const job = integration.createJob(demand, { shopId: lot.shopId, purchasedAt: clock(s), quantity: 1, unitPrice: lot.unitPrice, gross: lot.gross, net: lot.net, tax: purchase.tax });
      demand.jobId = job.id; demand.state = 'processing'; demand.reason = '已实付并取得一份工业材料；等待原医生到场且已计薪剩余窗口实际处理10分钟。';
    }
  });
  simulation.registerSaveValidator(s => validatePublicDisinfectionState(s, simulation.worldDefinition));
}
function synchronize(simulation: Simulation): void {
  const s = simulation.state;
  for (const demand of s.hygiene?.publicDemands ?? []) {
    if (final(demand)) continue;
    if (demand.jobId === null) {
      const claimed = s.hygiene!.jobs.find(j => j.batchId === demand.batchId && j.payerId === 'player' && j.cancelledAt === null && (j.reservedUnits > 0 || j.completedAt !== null));
      if (claimed) {
        if (demand.approvedAt !== null && !simulation.closePublicBudget(demand.id)) throw new Error('原公共额度未能按合法手动认领结清。');
        demand.state = 'superseded'; demand.supersededByJobId = claimed.id; demand.closedAt = clock(s); demand.reason = '原真实单位已由具名玩家实付合同认领；此需求结清，没有授权或重复采购。';
      }
      continue;
    }
    const job = s.hygiene!.jobs.find(j => j.id === demand.jobId);
    if (!job) throw new Error('公共消毒具名处理合同缺失。');
    if (job.completedAt === null) continue;
    demand.state = 'completed'; demand.closedAt = job.completedAt; demand.reason = '已完成10个真实计薪处理分钟；原用品与清洁耗材残留仍封存于原站点，尚无终端处置。';
    if (!simulation.closePublicBudget(demand.id)) throw new Error('公共消毒预算未能依法结清。');
  }
}

export function validatePublicDisinfectionState(s: SimState, world: WorldDefinition): void {
  const h = s.hygiene;
  const ensure = (value: unknown, text: string) => { if (!value) throw new Error(`公共消毒存档无效：${text}`); };
  if (h?.publicVersion === undefined) { ensure(!h?.publicDemands && h?.nextDemandId === undefined && !h?.jobs.some(j => j.payerId === 'public' || j.publicDemandId !== undefined), '无模块不得伪装公共订单'); return; }
  ensure(h.publicVersion === 1 && Array.isArray(h.publicDemands) && h.publicDemands.length <= LIMIT && Number.isInteger(h.nextDemandId) && h.nextDemandId === h.publicDemands.length + 1, '有限版本与具名序号');
  const number = (v: unknown, min: number, max: number) => ensure(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max, '有限数值');
  const close = (a: number, b: number) => ensure(Math.abs(a - b) <= EPS, '真实数量金额对账');
  const ids = new Set<string>(), jobs = new Set<string>(), now = clock(s);
  for (const d of h.publicDemands!) {
    ensure(d && typeof d === 'object' && d.id === `hygiene-demand-${ids.size + 1}` && !ids.has(d.id), '唯一顺序需求'); ids.add(d.id);
    const batch = h.batches.find(b => b.id === d.batchId), reporter = s.citizens.find(p => p.id === d.reporterId), site = world.buildings.find(b => b.id === d.siteId);
    ensure(batch && batch.siteId === d.siteId && site?.kind === 'clinic' && reporter && ['医生', 'doctor'].includes(d.reporterRole), '真实批次与具名医生');
    number(d.reporterAge, 18, 130); ensure(s.extension!.actorProfiles[d.reporterId].age >= d.reporterAge, '实际成年记录'); number(d.reportedAt, batch!.firstAt, now);
    for (const n of [d.observedGeneratedUnits, d.observedContaminatedUnits, d.observedReservedUnits]) ensure(Number.isInteger(n), '观测数量为整数');
    number(d.observedGeneratedUnits, 1, batch!.generatedUnits); number(d.observedContaminatedUnits, 1, d.observedGeneratedUnits); number(d.observedReservedUnits, 0, d.observedContaminatedUnits - 1);
    ensure(Array.isArray(d.reportWorkWindows) && d.reportWorkWindows.length > 0 && d.reportWorkWindows.length <= 16, '真实工资抵达交集');
    let previous = batch!.firstAt;
    for (const w of d.reportWorkWindows) { ensure(w && typeof w === 'object', '工资窗口'); number(w.start, previous, d.reportedAt); number(w.end, w.start + EPS, d.reportedAt); previous = w.end; }
    ensure(['awaitingReview', 'awaitingBudget', 'awaitingSupply', 'processing', 'completed', 'superseded'].includes(d.state) && typeof d.reason === 'string' && d.reason.length > 0 && d.reason.length <= 240 && Array.isArray(d.approvedBy) && new Set(d.approvedBy).size === d.approvedBy.length, '合同状态'); number(d.retryAt, d.reportedAt, now + 60);
    if (d.approvedAt === null) ensure(['awaitingReview', 'superseded'].includes(d.state) && d.approvedBy.length === 0 && d.authorizedCap === 0 && d.spent === 0 && d.receipt === null && d.jobId === null && (d.state === 'superseded' || d.closedAt === null), '未批不买料不劳动');
    else { ensure(d.state !== 'awaitingReview', '已批状态'); number(d.approvedAt, d.reportedAt, now); ensure(d.approvedBy.length === 2 && d.approvedBy.every(id => s.citizens.some(p => p.id === id)) && d.authorizedCap === CAP, '原双官有限额度'); }
    number(d.spent, 0, d.authorizedCap);
    if (d.jobId === null) ensure(d.receipt === null && d.spent === 0 && !['processing', 'completed'].includes(d.state), '无真实材料不得创建处理');
    else {
      ensure(!jobs.has(d.jobId), '处理不重放'); jobs.add(d.jobId);
      const job = h.jobs.find(j => j.id === d.jobId), r = d.receipt;
      ensure(job && job.payerId === 'public' && job.publicDemandId === d.id && job.batchId === d.batchId && job.siteId === d.siteId && r && d.approvedAt !== null, '具名原处理关联');
      ensure(r!.budgetId === d.id && r!.procurementId === `${d.id}-materials` && Array.isArray(r!.lots) && r!.lots.length === 1, '采购关联'); number(r!.purchasedAt, d.approvedAt!, now); close(r!.quantity, 1); close(r!.paid, d.spent); ensure(r!.paid > 0, '实际付款');
      const lot = r!.lots[0], receipt = job!.receipt; ensure(receipt && s.shops.some(shop => shop.id === lot.shopId && world.buildings.find(site => site.id === shop.buildingId)?.kind === 'workshop'), '真实工业供应'); close(lot.quantity, 1); close(lot.unitPrice, lot.gross); close(lot.gross, r!.paid); close(lot.gross, lot.net + r!.tax);
      ensure(lot.shopId === receipt!.shopId && r!.purchasedAt === receipt!.purchasedAt && job!.startedAt === r!.purchasedAt, '原采购时点'); close(lot.gross, receipt!.gross); close(lot.net, receipt!.net); close(lot.unitPrice, receipt!.unitPrice); close(r!.tax, receipt!.tax); close(job!.funded, d.spent); close(job!.purchasePaid, d.spent);
      ensure(job!.escrow === 0 && job!.refunded === 0 && job!.receivedUnits === 1 && job!.reusedUnits === 0 && job!.cancelledAt === null, '公共实付不转入玩家托管或退款');
      ensure(job!.wageProofVersion === 1, '新公共处理保留实际认证工资片段');
      for (const period of Object.values(job!.staffWindows)) {
        ensure(Array.isArray(period.paidWindows) && period.paidWindows.length > 0 && period.paidWindows.length <= 4096, '实际选用工资片段容器');
        let last = job!.startedAt, worked = 0;
        for (const window of period.paidWindows!) { number(window.start, last, period.endedAt); number(window.end, window.start + EPS, period.endedAt); ensure(window.start >= period.startedAt, '工资片段不越过原工作起点'); last = window.end; worked += window.end - window.start; }
        close(worked, period.workedMinutes); ensure(period.paidWindows![0].start === period.startedAt && last === period.endedAt, '保留真实选用片段边界');
      }
      ensure(job!.completedAt === null ? d.state === 'processing' && d.closedAt === null : d.state === 'completed' && d.closedAt === job!.completedAt, '处理结清一致');
    }
    if (d.state === 'superseded') {
      ensure(typeof d.supersededByJobId === 'string' && /^disinfection-[1-9]\d*$/.test(d.supersededByJobId) && Number(d.supersededByJobId.slice(13)) < h.nextJobId, '真实替代认领');
      const claimed = h.jobs.find(j => j.id === d.supersededByJobId);
      ensure(claimed ? claimed.payerId === 'player' && claimed.batchId === d.batchId && claimed.startedAt >= d.reportedAt && claimed.startedAt <= d.closedAt! : h.archived.count > 0, '尚存或已归档原手动合同');
    } else ensure(d.supersededByJobId === undefined, '替代认领只用于结清');
    if (final(d)) number(d.closedAt, d.approvedAt ?? d.reportedAt, now); else ensure(d.closedAt === null, '未结不造关闭');
  }
  for (const job of h.jobs) if (job.payerId === 'public' || job.publicDemandId !== undefined) ensure(job.payerId === 'public' && h.publicDemands!.some(d => d.id === job.publicDemandId && d.jobId === job.id), '公共处理必须有原需求');
}

export function validatePublicDisinfectionBudgetCrossReferences(s: SimState, budgets: readonly { id: string; siteId: string; purpose: string; approvedAt: number; approvedBy: string[]; cap: number; spent: number; closedAt: number | null }[]): void {
  const demands = s.hygiene?.publicDemands ?? [], ensure = (v: unknown) => { if (!v) throw new Error('公共消毒需求与授权、原实付材料或关闭时间不一致。'); };
  for (const d of demands) {
    const budget = budgets.find(b => b.id === d.id);
    if (d.approvedAt === null) { ensure(!budget); continue; }
    ensure(budget && budget.purpose === PUBLIC_DISINFECTION_PURPOSE && budget.siteId === d.siteId && budget.approvedAt === d.approvedAt && budget.cap === d.authorizedCap && Math.abs(budget.spent - d.spent) <= EPS && JSON.stringify([...budget.approvedBy].sort()) === JSON.stringify([...d.approvedBy].sort()) && budget.closedAt === d.closedAt);
  }
  for (const b of budgets.filter(b => b.purpose === PUBLIC_DISINFECTION_PURPOSE || /^hygiene-demand-/.test(b.id))) ensure(demands.some(d => d.id === b.id && d.approvedAt !== null));
}
