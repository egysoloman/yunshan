import type { Simulation } from '../simulation';
import type { SimState } from '../types';
import type { ServiceOrder } from './culture';

export const SERVICE_MATERIAL_POLICY = 'authorized-service-materials-v1' as const;
/** Explicit host cutover selects material priority and observed-price request
 * estimates for approved services. It grants no
 * service budget, material, wage, attendance, term or voting authority. */
export interface ServiceMaterialSchedulingState {
  version: 1; policyId: typeof SERVICE_MATERIAL_POLICY; enablementId: string;
  enabledAt: number; enabledTick: number; sourceSave: { version: 4; sha256: string };
}
type Document = Record<string, any>;
const object = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Document, key: string) => Object.hasOwn(value, key);
const need = (value: unknown) => { if (!value) throw new Error('无效存档字段：service material scheduling policy。'); };
const shape = (value: unknown, keys: string[]) => need(object(value) && Object.keys(value).sort().join(',') === keys.sort().join(','));
/** Nested estimates remain declarations even if all outer markers are deleted. */
export function hasServiceMaterialRequestEstimate(state: unknown): boolean {
  return object(state) && Array.isArray(state.culture?.supplementalBudgets?.requests)
    && state.culture.supplementalBudgets.requests.some((request: unknown) => object(request) && own(request, 'remainingNeedQuote'));
}
/** Both complete and partition readers use this exact optional declaration. */
export function validateServiceMaterialSchedulingEnvelope(data: Document): void {
  const state = data.state, runtime = data.runtime;
  if (!object(state) || !object(runtime)) { need(false); return; }
  const listed = Array.isArray(runtime.persistedModules) && runtime.persistedModules.includes('serviceMaterialScheduling');
  if (!own(state, 'serviceMaterialScheduling') && !own(runtime, 'serviceMaterialSchedulingVersion') && !listed && !hasServiceMaterialRequestEstimate(state)) return;
  need(data.version === 4 && listed && runtime.persistedModules.filter((name: unknown) => name === 'serviceMaterialScheduling').length === 1
    && runtime.serviceMaterialSchedulingVersion === 1 && state.civicStaffing?.version === 2 && state.civicHistory?.version === 1);
  const policy = state.serviceMaterialScheduling;
  shape(policy, ['version', 'policyId', 'enablementId', 'enabledAt', 'enabledTick', 'sourceSave']);
  shape(policy.sourceSave, ['version', 'sha256']);
  need(policy.version === 1 && policy.policyId === SERVICE_MATERIAL_POLICY && policy.enablementId === state.civicStaffing.enablement.id
    && policy.sourceSave.version === 4 && typeof policy.sourceSave.sha256 === 'string' && /^[0-9a-f]{64}$/.test(policy.sourceSave.sha256)
    && Number.isFinite(policy.enabledAt) && policy.enabledAt >= state.civicStaffing.enablement.enabledAt
    && policy.enabledAt <= (state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60)
    && Number.isSafeInteger(policy.enabledTick) && policy.enabledTick >= state.civicStaffing.enablement.enabledTick && policy.enabledTick <= state.tick);
  for (const request of state.culture?.supplementalBudgets?.requests ?? []) if (object(request) && own(request, 'remainingNeedQuote')) {
    const basis = request.remainingNeedQuote;
    shape(basis, ['version','policyId','requiredUnits','unitPrice','gross']);
    need(state.culture.supplementalBudgets.version === 2 && request.signatureVersion === 2 && Number.isFinite(request.requestedAt)
      && request.requestedAt >= policy.enabledAt && basis.version === 1 && basis.policyId === SERVICE_MATERIAL_POLICY
      && Number.isFinite(basis.requiredUnits) && basis.requiredUnits > 1e-7 && basis.requiredUnits === request.missingUnits
      && Number.isFinite(basis.unitPrice) && basis.unitPrice > 0 && basis.unitPrice <= 1e6
      && Number.isFinite(basis.gross) && basis.gross === basis.requiredUnits * basis.unitPrice
      && Array.isArray(request.quoteLots) && request.quoteLots.length > 0
      && request.quoteLots.every((lot: any) => object(lot) && Number.isFinite(lot.unitPrice) && lot.unitPrice > 0 && lot.unitPrice <= 1e6)
      && basis.unitPrice === Math.max(...request.quoteLots.map((lot: any) => lot.unitPrice)) && request.cap === Math.min(160, Math.ceil(basis.gross)));
  }
}
export function serviceMaterialSchedulingEnabled(state: SimState): boolean {
  const policy = state.serviceMaterialScheduling;
  return !!policy && policy.version === 1 && policy.policyId === SERVICE_MATERIAL_POLICY && state.civicStaffing?.version === 2
    && state.civicHistory?.version === 1 && policy.enablementId === state.civicStaffing.enablement.id;
}
const procurement = new WeakMap<Simulation, () => void>();
/** Installation grants no policy or budget. Core finance invokes the callback;
 * the existing generic system-event interface is unchanged. */
export function installServiceMaterialScheduling(simulation: Simulation, callback: () => void): void { procurement.set(simulation, callback); }
/** A real supplier offer can wake a stock-blocked service between clock retries.
 * An active service can also exhaust its last usable unit during people; its
 * remaining authorized consumers must not wait for the next clock retry.
 * An exhausted base budget without a pending or spendable supplement also
 * needs to observe a real offer before upkeep consumes it. This only wakes
 * the existing quote/request path; it grants no additional spending authority.
 * Otherwise a 60-minute retry can remain permanently out of phase with a
 * 12-minute commerce batch. Existing order state already persists this wait;
 * no new stock, quote, cash, authorization or minutes are created here. */
export function serviceMaterialOfferAvailable(simulation: Simulation, order: ServiceOrder): boolean {
  const requests = simulation.state.culture?.supplementalBudgets?.requests.filter(request => request.orderId === order.id) ?? [];
  const needsBudgetQuote = order.state === 'awaitingBudget'
    && Number.isFinite(order.authorizedCap) && order.authorizedCap > 1e-7
    && Number.isFinite(order.spent) && order.spent >= order.authorizedCap - 1e-7
    && order.receivedUnits - order.consumedUnits < 1 - 1e-7
    && !requests.some(request => request.closedAt === null && (request.approvedAt === null || request.spent < request.cap - 1e-7));
  const stockBlocked = order.state === 'awaitingSupply'
    || order.state === 'active' && order.receivedUnits - order.consumedUnits < 1 - 1e-7 || needsBudgetQuote;
  if (!serviceMaterialSchedulingEnabled(simulation.state) || !stockBlocked || order.approvedAt === null
    || !['education','health'].includes(order.topic) || order.receivedUnits >= order.targetUnits - 1e-7) return false;
  return simulation.state.shops.some(shop => {
    if (simulation.shopCommodity(shop) !== 'materials' || shop.inventory <= 1e-7) return false;
    const offer = simulation.quoteSupply(shop.id, order.targetUnits - order.receivedUnits);
    return Number.isFinite(offer.quantity) && offer.quantity > 1e-7
      && Number.isFinite(offer.unitPrice) && offer.unitPrice > 0;
  });
}
/** The core finance phase invokes existing approved service procurement before
 * upkeep. Original spending guards still protect payroll and all upkeep cash;
 * upkeep then consumes the actual remaining stock and reports its real cover. */
export function runScheduledServiceProcurement(simulation: Simulation): void {
  if (simulation.saveVersion === 4 && simulation.effectiveRuleset === 'civic-local-v1' && serviceMaterialSchedulingEnabled(simulation.state)) procurement.get(simulation)?.();
}
