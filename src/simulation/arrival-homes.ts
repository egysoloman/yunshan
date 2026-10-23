import type { Building, Vec3 } from '../types';

/** Residents at home near the arrival (2026-10-23, new cities). A new city's residents of the district the
 * player arrives in used to spread over all its homes, up to 650 m away; 300 m around the arrival lived
 * 18 people and its streets were empty at 08:00 (memo 2026-10-17). A declared city houses that district's
 * residents, in the same round-robin as before, among the ARRIVAL_HOME_COUNT homes of the district nearest
 * the arrival instead (each far below capacity). Who they are, how many, their district, and how their
 * work is chosen are unchanged. Old saves and undeclared cities are untouched. */
export const ARRIVAL_HOMES_POLICY = 'arrival-homes-v1' as const;
export type ArrivalHomesPolicy = typeof ARRIVAL_HOMES_POLICY;
export const ARRIVAL_HOMES_POLICIES: readonly ArrivalHomesPolicy[] = [ARRIVAL_HOMES_POLICY];
export const ARRIVAL_HOME_COUNT = 6;

/** The arrival district (that of the home nearest the arrival) and its ARRIVAL_HOME_COUNT nearest homes. */
export function arrivalHomes(homes: readonly Building[], spawn: Vec3): { districtId: string; homes: Building[] } | null {
  const far = (b: Building) => Math.hypot(b.door.x - spawn.x, b.door.z - spawn.z);
  const order = (a: Building, b: Building) => far(a) - far(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const nearest = [...homes].sort(order)[0]; if (!nearest) return null;
  return { districtId: nearest.districtId, homes: homes.filter(b => b.districtId === nearest.districtId).sort(order).slice(0, ARRIVAL_HOME_COUNT) };
}

export function validateArrivalHomesPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'arrivalHomesPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'arrivalHomesPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !ARRIVAL_HOMES_POLICIES.includes(data.arrivalHomesPolicyId)
    || data.runtime.arrivalHomesPolicyId !== data.arrivalHomesPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：arrival homes policy pair。');
}
