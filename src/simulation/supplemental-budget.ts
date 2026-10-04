import type { Simulation } from '../simulation';
import { budgetAuthorityEnabled, currentCivicBudgetSignature, recordSupplementalBudgetRequest, type BudgetSignatureV2 } from './budget-authority';
import { validateCivicCouncilSourceProof } from './civic-staffing';
import type { CultureState, ServiceOrder } from './culture';
import type { SimState, Vec3, WorldDefinition } from '../types';
import { canAccessFloor } from '../access';
import { blocksFloorPlanMovement, floorPlanSupport, getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { homeRestPointBlockedByVoxels } from './home-rest';
import { SERVICE_MATERIAL_POLICY, serviceMaterialSchedulingEnabled } from './service-material-scheduling';

const EPS = 1e-7, LIMIT = 64, PER_ORDER = 4, CAP = 160;
export interface LegacySupplementalSignature { actorId: string; role: 'council' | 'mayor'; siteId: string; floor: number; position: Vec3 }
export type SupplementalSignature = LegacySupplementalSignature | BudgetSignatureV2;
/** A request estimate for the whole remaining need at an observed offer price.
 * quoteLots still describe only the actual stock available at request time;
 * this estimate reserves no goods and never changes a purchase price. */
export interface RemainingNeedQuote {
  version: 1; policyId: typeof SERVICE_MATERIAL_POLICY; requiredUnits: number; unitPrice: number; gross: number;
}
export interface SupplementalBudget {
  signatureVersion?: 2; id: string; orderId: string; requestedAt: number; missingUnits: number; receivedAtRequest: number;
  baseSpentAtRequest: number; quoteLots: { shopId: string; quantity: number; unitPrice: number }[];
  quotedGross: number; cap: number; approvedAt: number | null; signatures: SupplementalSignature[];
  spent: number; receiptIds: string[]; closedAt: number | null;
  remainingNeedQuote?: RemainingNeedQuote;
}
export interface SupplementalBudgetState { version: 1 | 2; requests: SupplementalBudget[] }
export const supplementalPurpose = (order: ServiceOrder) => `civic-${order.topic}-supplement`;
const now = (sim: Simulation) => sim.state.extension!.lastUpdate;
export function supplementalFor(culture: CultureState, orderId: string): SupplementalBudget[] {
  return culture.supplementalBudgets?.requests.filter(request => request.orderId === orderId) ?? [];
}
export function serviceTotalSpent(culture: CultureState, order: ServiceOrder): number {
  return order.spent + supplementalFor(culture, order.id).reduce((total, request) => total + request.spent, 0);
}
/** Observed stock backs each quote. An explicitly enabled policy may estimate
 * the whole remaining need at its highest observed price, never a receipt. */
export function proposeSupplementalBudget(sim: Simulation, order: ServiceOrder): void {
  const culture = sim.state.culture!, previous = supplementalFor(culture, order.id), natural = sim.effectiveRuleset === 'civic-local-v1';
  if (natural && !budgetAuthorityEnabled(sim)) return;
  if (!['education', 'health'].includes(order.topic) || order.approvedAt === null || ['fulfilled', 'rejected'].includes(order.state)
    || order.spent < order.authorizedCap - EPS || order.receivedUnits >= order.targetUnits - EPS
    || previous.length >= PER_ORDER || previous.some(r => r.closedAt === null && (r.approvedAt === null || r.spent < r.cap - EPS))
    || (culture.supplementalBudgets?.requests.length ?? 0) >= LIMIT) return;
  const site = sim.worldDefinition.buildings.find(b => b.id === order.siteId)!;
  let missing = order.targetUnits - order.receivedUnits;
  const quoteLots: SupplementalBudget['quoteLots'] = [];
  for (const shop of sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory > EPS)
    .sort((a, b) => Number(b.districtId === site.districtId) - Number(a.districtId === site.districtId) || b.inventory - a.inventory)) {
    if (missing <= EPS) break;
    const quote = sim.quoteSupply(shop.id, Math.min(missing, shop.inventory));
    if (!Number.isFinite(quote.quantity) || !Number.isFinite(quote.unitPrice) || quote.quantity <= EPS || quote.unitPrice <= 0 || quote.unitPrice > 1e6) continue;
    quoteLots.push({ shopId: shop.id, quantity: quote.quantity, unitPrice: quote.unitPrice }); missing -= quote.quantity;
  }
  const quotedGross = quoteLots.reduce((sum, lot) => sum + lot.quantity * lot.unitPrice, 0);
  if (!Number.isFinite(quotedGross) || quotedGross <= EPS) return;
  const requiredUnits = order.targetUnits - order.receivedUnits;
  const unitPrice = Math.max(...quoteLots.map(lot => lot.unitPrice));
  const remainingNeedQuote: RemainingNeedQuote | undefined = natural && serviceMaterialSchedulingEnabled(sim.state)
    ? { version: 1, policyId: SERVICE_MATERIAL_POLICY, requiredUnits, unitPrice, gross: requiredUnits * unitPrice } : undefined;
  const cap = Math.min(CAP, Math.ceil(remainingNeedQuote?.gross ?? quotedGross));
  const id = `${order.id}-supplement-${previous.length + 1}`;
  if (natural && !recordSupplementalBudgetRequest(sim, id)) return;
  const requests = (culture.supplementalBudgets ??= { version: natural ? 2 : 1, requests: [] }).requests;
  requests.push({ ...(natural ? { signatureVersion: 2 as const } : {}), id, orderId: order.id, requestedAt: now(sim), missingUnits: order.targetUnits - order.receivedUnits,
    receivedAtRequest: order.receivedUnits, baseSpentAtRequest: order.spent, quoteLots, quotedGross, cap, approvedAt: null, signatures: [], spent: 0, receiptIds: [], closedAt: null,
    ...(remainingNeedQuote ? { remainingNeedQuote } : {}) });
  order.lastReason = remainingNeedQuote
    ? '原授权不变；按现有工业实货报价估算全部剩余需求的追加上限，未来库存和价格不作保证，尚未拨款或采购。'
    : '原授权不变；剩余材料已按现有工业库存和真实报价提请议会追加审议，尚未拨款或采购。';
  const review = sim.effectiveRuleset === 'civic-local-v1' ? '仍需同厅两名在任地方议员实际在岗联审。' : '仍需议会或当选市长实际审批。';
  sim.appendNotice('supplemental-budget', `${site.name}缺${requiredUnits.toFixed(2)}份材料，申请独立最高${cap}文追加额度；${review}`, site.districtId);
}
function supported(world: WorldDefinition, siteId: string, position: Vec3, level: number, role: 'council' | 'mayor'): boolean {
  const site = world.buildings.find(b => b.id === siteId);
  if (!site || !['hall', 'core', 'bank'].includes(site.kind) || ![position.x, position.y, position.z].every(Number.isFinite)
    || level < 0 || level >= site.floors || Math.floor((position.y - site.position.y + .01) / (site.height / site.floors)) !== level
    || !canAccessFloor(site, level, { role, identities: [role] })) return false;
  if (!getBuildingBody(site)) {
    const dx = position.x - site.position.x, dz = position.z - site.position.z, dims = site.floorFootprints?.[level] ?? site;
    const x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation);
    return level === 0 && Math.hypot(position.x - site.door.x, position.y - site.door.y, position.z - site.door.z) <= 2 || Math.abs(x) <= dims.width / 2 && Math.abs(z) <= dims.depth / 2;
  }
  const points = site.functionPoints ?? Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
  if (!points.some(point => point.floor === level && (role === 'mayor' || point.purpose === 'work') && Math.hypot(position.x - point.position.x, position.y - point.position.y, position.z - point.position.z) <= 2)) return false;
  const support = floorPlanSupport(site, level, position, .35);
  return !!support && support.floor === level && ['room', 'stairs'].includes(support.kind) && Math.abs(support.y - position.y) <= .26
    && !blocksFloorPlanMovement(site, level, position, position, .35, 1.72);
}
function approve(sim: Simulation, request: SupplementalBudget, signatures: SupplementalSignature[]): boolean {
  const order = sim.state.culture!.orders.find(o => o.id === request.orderId)!;
  if (request.approvedAt !== null || request.closedAt !== null || ['fulfilled', 'rejected'].includes(order.state)) return false;
  const authorization = { id: request.id, siteId: order.siteId, purpose: supplementalPurpose(order), cap: request.cap, approvedAt: now(sim), approvedBy: signatures.map(s => s.actorId) };
  if (sim.effectiveRuleset === 'civic-local-v1') {
    if (request.signatureVersion !== 2 || !sim.authorizeCivicSupplementalBudget(authorization)) return false;
  } else {
    if (request.signatureVersion !== undefined || !sim.authorizePublicBudget(authorization)) return false;
    request.approvedAt = now(sim); request.signatures = signatures; order.retryAt = now(sim);
  }
  sim.appendNotice('supplemental-budget', `${order.id}独立追加${request.cap}文额度已审议；原${order.authorizedCap}文授权和采购历史保持，后续仍按真实库存逐笔采购。`);
  return true;
}
/** Politics invokes this directly; generic emitEvent cannot approve a budget. */
export function reviewSupplementalBudgets(sim: Simulation): void {
  const pending = sim.state.culture?.supplementalBudgets?.requests.filter(r => r.approvedAt === null && r.closedAt === null) ?? [];
  if (!pending.length || sim.state.hour < 8 || sim.state.hour >= 17) return;
  if (sim.effectiveRuleset === 'civic-local-v1') {
    if (!budgetAuthorityEnabled(sim)) return;
    const groups = new Map<string, BudgetSignatureV2[]>();
    for (const actor of [...sim.state.citizens].sort((a,b) => a.id.localeCompare(b.id))) {
      const signature = currentCivicBudgetSignature(sim, actor.id); if (!signature) continue;
      const group = groups.get(signature.siteId) ?? []; group.push(signature); groups.set(signature.siteId, group);
    }
    for (const request of pending) {
      const order = sim.state.culture!.orders.find(o => o.id === request.orderId)!;
      const district = sim.worldDefinition.buildings.find(b => b.id === order.siteId)!.districtId;
      const reviewers = [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0])).find(([id,actors]) => actors.length >= 2 && sim.worldDefinition.buildings.find(b => b.id === id)?.districtId === district);
      if (reviewers) approve(sim, request, reviewers[1].slice(0,2));
    }
    return;
  }
  const signatures = sim.state.citizens.filter(c => ['议员', 'council'].includes(c.role) && (sim.state.extension!.actorProfiles[c.id]?.age ?? 0) >= 18
    && sim.state.extension!.actorProfiles[c.id]?.alive === true && c.needs.hunger >= 40 && c.needs.fatigue >= 35 && sim.isOnDuty(c.id, c.workId)
    && !homeRestPointBlockedByVoxels(c.position, sim.state.voxels)).sort((a, b) => a.id.localeCompare(b.id)).flatMap(c => {
      const site = sim.worldDefinition.buildings.find(b => b.id === c.workId)!, floor = Math.floor((c.position.y - site.position.y + .01) / (site.height / site.floors));
      return supported(sim.worldDefinition, c.workId, c.position, floor, 'council') ? [{ actorId: c.id, role: 'council' as const, siteId: c.workId, floor, position: { ...c.position } }] : [];
    }).slice(0, 2);
  if (signatures.length !== 2) return;
  for (const request of pending) approve(sim, request, signatures);
}
/** A legacy mayor label is not an elected term. No time or cash is advanced. */
export function reviewSupplementalByMayor(sim: Simulation, id: string): boolean {
  // The new two-official consumer never falls back to the legacy mayor role.
  if (sim.effectiveRuleset === 'civic-local-v1') return false;
  const s = sim.state, term = s.governance?.term, election = s.governance?.elections.find(e => e.id === term?.electionId), player = s.player;
  if (!term || term.endedAt !== null || now(sim) < term.startsAt || now(sim) >= term.endsAt || election?.result !== 'elected' || !sim.hasIdentity('mayor')
    || !s.extension!.actorProfiles.player.alive || player.vehicleId || homeRestPointBlockedByVoxels(player.position, s.voxels)) return false;
  const site = sim.worldDefinition.buildings.find(b => b.facility === 'mayor' && sim.isNearBuilding(b));
  if (!site) return false;
  const floor = Math.floor((player.position.y - site.position.y + .01) / (site.height / site.floors));
  if (site.floorPermissions?.[floor] !== 'mayor' || !supported(sim.worldDefinition, site.id, player.position, floor, 'mayor') || !sim.isAtBuildingFunctionPoint(site)) return false;
  const request = s.culture?.supplementalBudgets?.requests.find(r => r.id === id);
  return !!request && approve(sim, request, [{ actorId: 'player', role: 'mayor', siteId: site.id, floor, position: { ...player.position } }]);
}
export function closeServiceSupplementalBudgets(sim: Simulation, order: ServiceOrder): void {
  for (const request of supplementalFor(sim.state.culture!, order.id)) if (request.closedAt === null) {
    if (request.approvedAt !== null) sim.closePublicBudget(request.id);
    request.closedAt = now(sim);
  }
}
interface BudgetProof { signatureVersion?: 2; id: string; siteId: string; purpose: string; cap: number; spent: number; approvedAt: number; approvedBy: string[]; closedAt: number | null; signatures: { actorId: string; role: string; siteId: string; signedAt: number }[] }
export function validateSupplementalBudgetCrossReferences(s: SimState, budgets: readonly BudgetProof[]): void {
  const requests = s.culture?.supplementalBudgets?.requests ?? [];
  const ensure = (condition: unknown) => { if (!condition) throw new Error('追加预算授权与原议程交叉引用无效'); };
  for (const r of requests.filter(r => r.approvedAt !== null)) {
    const order = s.culture!.orders.find(o => o.id === r.orderId)!, budget = budgets.find(b => b.id === r.id);
    if (r.signatureVersion === 2) ensure(budget?.signatureVersion === 2 && JSON.stringify(budget.signatures) === JSON.stringify(r.signatures));
    else ensure(budget?.signatureVersion === undefined);
    ensure(budget && budget.siteId === order.siteId && budget.purpose === supplementalPurpose(order) && budget.cap === r.cap && Math.abs(budget.spent - r.spent) < 1e-6
      && budget.approvedAt === r.approvedAt && budget.closedAt === r.closedAt && budget.approvedBy.length === r.signatures.length
      && budget.signatures.length === r.signatures.length && r.signatures.every(signature => budget.signatures.some(b => b.actorId === signature.actorId && b.role === signature.role && b.siteId === signature.siteId && b.signedAt === r.approvedAt)));
  }
  for (const b of budgets.filter(b => /^civic-(education|health)-supplement$/.test(b.purpose))) ensure(requests.some(r => r.id === b.id && r.approvedAt !== null));
}
export function validateSupplementalBudgetState(candidate: SimState, world: WorldDefinition): void {
  const body = candidate.culture?.supplementalBudgets; if (body === undefined) return;
  const ensure = (condition: unknown) => { if (!condition) throw new Error('追加预算保存合同无效'); };
  const num = (n: unknown, lo: number, hi: number) => ensure(typeof n === 'number' && Number.isFinite(n) && n >= lo - EPS && n <= hi + EPS);
  ensure(body && (body.version === 1 || body.version === 2) && Array.isArray(body.requests) && body.requests.length > 0 && body.requests.length <= LIMIT && candidate.culture!.version === 2);
  ensure(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['requests','version']));
  if (body.version === 2) ensure((candidate as SimState & { budgetAuthority?: { version: number } }).budgetAuthority?.version === 1);
  const ids = new Set<string>(), time = candidate.culture!.lastUpdate, perOrder = new Map<string, number>();
  for (const r of body.requests) {
    if (body.version === 1) ensure(r.signatureVersion === undefined && r.signatures.every(s => !('signatureVersion' in s)));
    else ensure(r.signatureVersion === 2 || r.signatureVersion === undefined && r.approvedAt !== null);
    const hasNeedQuote = Object.hasOwn(r, 'remainingNeedQuote');
    if (r.signatureVersion === 2) ensure(JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['signatureVersion','id','orderId','requestedAt','missingUnits','receivedAtRequest','baseSpentAtRequest','quoteLots','quotedGross','cap','approvedAt','signatures','spent','receiptIds','closedAt', ...(hasNeedQuote ? ['remainingNeedQuote'] : [])].sort()));
    if (hasNeedQuote) ensure(body.version === 2 && r.signatureVersion === 2 && serviceMaterialSchedulingEnabled(candidate)
      && r.requestedAt >= candidate.serviceMaterialScheduling!.enabledAt);
    const order = candidate.culture!.orders.find(o => o.id === r.orderId), round = (perOrder.get(r.orderId) ?? 0) + 1; perOrder.set(r.orderId, round);
    ensure(order && ['education', 'health'].includes(order.topic) && order.approvedAt !== null && round <= PER_ORDER && r.id === `${r.orderId}-supplement-${round}` && !ids.has(r.id)); ids.add(r.id);
    num(r.requestedAt, order!.approvedAt!, time); num(r.receivedAtRequest, 0, order!.receivedUnits); num(r.missingUnits, EPS, order!.targetUnits);
    ensure(Math.abs(r.missingUnits + r.receivedAtRequest - order!.targetUnits) < EPS); num(r.baseSpentAtRequest, order!.authorizedCap, order!.spent);
    const historical = order!.receipts.filter(receipt => receipt.purchasedAt <= r.requestedAt + EPS && receipt.budgetId !== r.id && !body.requests.slice(body.requests.indexOf(r) + 1).some(next => next.id === receipt.budgetId));
    ensure(Math.abs(historical.reduce((sum, receipt) => sum + receipt.quantity, 0) - r.receivedAtRequest) < 1e-6
      && Math.abs(historical.filter(receipt => receipt.budgetId === order!.id).reduce((sum, receipt) => sum + receipt.paid, 0) - r.baseSpentAtRequest) < 1e-6);
    ensure(Array.isArray(r.quoteLots) && r.quoteLots.length > 0 && r.quoteLots.length <= candidate.shops.length);
    let quantity = 0, gross = 0; const suppliers = new Set<string>();
    for (const lot of r.quoteLots) {
      const shop = candidate.shops.find(shop => shop.id === lot.shopId), building = world.buildings.find(b => b.id === shop?.buildingId);
      ensure(shop && building?.kind === 'workshop' && !suppliers.has(lot.shopId)); suppliers.add(lot.shopId);
      num(lot.quantity, EPS, r.missingUnits); num(lot.unitPrice, EPS, 1e6); quantity += lot.quantity; gross += lot.quantity * lot.unitPrice;
    }
    ensure(quantity <= r.missingUnits + EPS && Math.abs(gross - r.quotedGross) < 1e-6);
    let requestedGross = r.quotedGross;
    if (hasNeedQuote) {
      const basis = r.remainingNeedQuote;
      ensure(basis && typeof basis === 'object' && !Array.isArray(basis)
        && JSON.stringify(Object.keys(basis).sort()) === JSON.stringify(['version','policyId','requiredUnits','unitPrice','gross'].sort()));
      ensure(basis!.version === 1 && basis!.policyId === SERVICE_MATERIAL_POLICY);
      num(basis!.requiredUnits, EPS, r.missingUnits); num(basis!.unitPrice, EPS, 1e6); num(basis!.gross, EPS, r.missingUnits * 1e6);
      ensure(basis!.requiredUnits === r.missingUnits && basis!.unitPrice === Math.max(...r.quoteLots.map(lot => lot.unitPrice))
        && basis!.gross === basis!.requiredUnits * basis!.unitPrice);
      requestedGross = basis!.gross;
    }
    ensure(r.cap === Math.min(CAP, Math.ceil(requestedGross)));
    num(r.spent, 0, r.cap); ensure(Array.isArray(r.receiptIds) && new Set(r.receiptIds).size === r.receiptIds.length && r.receiptIds.length <= 64 && Array.isArray(r.signatures));
    const receipts = order!.receipts.filter(receipt => receipt.budgetId === r.id);
    ensure(receipts.length === r.receiptIds.length && receipts.every((receipt, index) => receipt.procurementId === r.receiptIds[index] && receipt.purchasedAt >= (r.approvedAt ?? Infinity) - EPS));
    ensure(Math.abs(receipts.reduce((sum, receipt) => sum + receipt.paid, 0) - r.spent) < 1e-6 && receipts.reduce((sum, receipt) => sum + receipt.quantity, 0) <= r.missingUnits + EPS);
    if (r.approvedAt === null) ensure(r.signatures.length === 0 && r.spent === 0 && !r.receiptIds.length);
    else {
      num(r.approvedAt, r.requestedAt, time);
      if (r.signatureVersion === 2) {
        ensure(r.signatures.length === 2 && new Set(r.signatures.map(s => s.actorId)).size === 2 && r.signatures.every(s => 'signatureVersion' in s && s.signatureVersion === 2 && s.role === 'council' && s.signedAt === r.approvedAt && validateCivicCouncilSourceProof(candidate, s.authority)));
        // The core independently checks exact v2 geometry/profession/paid
        // source; cross references require both copies to be identical.
      } else {
        ensure(r.signatures.length === 1 && r.signatures[0].actorId === 'player' && r.signatures[0].role === 'mayor' || r.signatures.length === 2 && r.signatures.every(s => s.role === 'council' && candidate.citizens.some(c => c.id === s.actorId)) && new Set(r.signatures.map(s => s.actorId)).size === 2);
        for (const signature of r.signatures) ensure(signature.position && Number.isInteger(signature.floor) && supported(world, signature.siteId, signature.position, signature.floor, signature.role));
      }
    }
    ensure(r.closedAt === null || Number.isFinite(r.closedAt) && r.closedAt >= (r.approvedAt ?? r.requestedAt) - EPS && r.closedAt <= time + EPS);
    ensure(['fulfilled', 'rejected'].includes(order!.state) ? r.closedAt === order!.completedAt : r.closedAt === null);
    const completions = order!.topic === 'health' ? (order!.healthConsumptions ?? []).map(source => ({ at: source.consumedAt, index: source.consumptionIndex }))
      : Object.entries(candidate.family?.formalLearning ?? {}).flatMap(([actorId, record]) => record.receipts.filter(receipt => receipt.orderId === order!.id).map(receipt => ({ at: receipt.completedAt, index: order!.servedIds.indexOf(actorId) + 1 })));
    for (const completion of completions) ensure(order!.receipts.filter(receipt => receipt.purchasedAt <= completion.at + EPS).reduce((sum, receipt) => sum + receipt.quantity, 0) >= completion.index - EPS);
  }
}
