/** The city files its own repair for a road closure nobody has asked to repair (2026-10-28, new cities).
 * A storm closure used to stay closed until the player paid for it or a resident found no detour at all;
 * in audit v9z6 the market dock bridge stood closed from day 2 to day 14. In a declared city, once a
 * closure has stood MUNICIPAL_REPAIR_DELAY game minutes with no open repair order, the city files a public
 * order for it (requested by 'city'). Everything after that is the existing public order: two officials
 * on duty at one hall, treasury or bank approve and fund it, a resident worker takes it on, buys the
 * material at a workshop, carries it to the worksite and works the 60 minutes, and the road reopens.
 * No cash, material or minute is created. Old saves and undeclared cities keep waiting as before. */
export const MUNICIPAL_REPAIR_POLICY = 'municipal-repair-v1' as const;
export type MunicipalRepairPolicy = typeof MUNICIPAL_REPAIR_POLICY;
export const MUNICIPAL_REPAIR_POLICIES: readonly MunicipalRepairPolicy[] = [MUNICIPAL_REPAIR_POLICY];
export const MUNICIPAL_REPAIR_DELAY = 240;

export function validateMunicipalRepairPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'municipalRepairPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'municipalRepairPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !MUNICIPAL_REPAIR_POLICIES.includes(data.municipalRepairPolicyId)
    || data.runtime.municipalRepairPolicyId !== data.municipalRepairPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：municipal repair policy pair。');
}
