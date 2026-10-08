/** A fictional game queue rule, not a diagnosis or a source of care capacity.
 * The clinical caller retains all original material, arrival, funded-doctor,
 * power and settlement guards. No public-service candidate enters this list. */
export const PAID_CLINICAL_TRIAGE_POLICY = 'paid-clinical-severity-wait-v1' as const;
export interface PaidClinicalTriageSelection {
  policyId: typeof PAID_CLINICAL_TRIAGE_POLICY;
  siteId: string;
}
export interface PaidClinicalQueueOrder {
  id: string; patientId: string; siteId: string; startedAt: number;
  state: string; funded: number; reservedUnits: number;
  workedMinutes: number; requiredMinutes: number;
  completedAt: number | null; cancelledAt: number | null;
}
export interface PaidClinicalPatientNow {
  alive: boolean; payerAlive: boolean; health: number; symptomSeverity: number;
}
const finite = (n: number) => Number.isFinite(n);
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Reorders only eligible paid-order positions of the selected clinic.
 * Missing policy returns the original array and does not read any patient.
 * Invalid/no-material/dead orders and every other clinic keep their position,
 * so original cancellation, procurement and treatment guards still run.
 * startedAt is the existing real registration clock; this rule does not add
 * or claim continuous physical waiting minutes while a person is away. */
export function paidClinicalTriageOrders<T extends PaidClinicalQueueOrder>(
  orders: readonly T[], selection: PaidClinicalTriageSelection | undefined,
  now: number, patientNow: (order: T) => PaidClinicalPatientNow,
): readonly T[] {
  if (!selection) return orders;
  if (selection.policyId !== PAID_CLINICAL_TRIAGE_POLICY || !selection.siteId || !finite(now) || now < 0) throw new Error('无效的显式付费临床分诊选择。');
  const ranked: { order: T; severity: number; waiting: number; index: number }[] = [];
  for (let index = 0; index < orders.length; index++) {
    const order = orders[index];
    if (order.siteId !== selection.siteId || !['awaitingDoctor', 'inTreatment'].includes(order.state)
      || order.completedAt !== null || order.cancelledAt !== null || order.funded !== 30 || order.reservedUnits !== 1
      || order.requiredMinutes !== 20 || !finite(order.workedMinutes) || order.workedMinutes < 0 || order.workedMinutes >= 20
      || !finite(order.startedAt) || order.startedAt < 0 || order.startedAt > now) continue;
    const current = patientNow(order);
    if (!current.alive || !current.payerAlive || !finite(current.health) || current.health <= 0 || current.health > 100
      || !finite(current.symptomSeverity) || current.symptomSeverity < 0 || current.symptomSeverity > 100) continue;
    ranked.push({ order, severity: Math.max(100 - current.health, current.symptomSeverity), waiting: now - order.startedAt, index });
  }
  if (ranked.length < 2) return orders;
  const positions = ranked.map(row => row.index);
  ranked.sort((a, b) => b.severity - a.severity || b.waiting - a.waiting
    || compareId(a.order.patientId, b.order.patientId) || compareId(a.order.id, b.order.id) || a.index - b.index);
  const result = orders.slice();
  positions.forEach((position, index) => { result[position] = ranked[index].order; });
  return result;
}
