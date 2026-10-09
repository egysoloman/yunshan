import type { BuildingKind } from '../types';

export const STAFFED_FARM_YIELD_POLICY = 'staffed-farm-yield-v1' as const;
/** v2 (balance, user-authorised 2026-10-08): 4 minutes per unit and a 240-unit producer store. */
export const STAFFED_FARM_YIELD_POLICY_V2 = 'staffed-farm-yield-v2' as const;
export type FarmYieldPolicy = typeof STAFFED_FARM_YIELD_POLICY | typeof STAFFED_FARM_YIELD_POLICY_V2;
export const FARM_YIELD_POLICIES: readonly FarmYieldPolicy[] = [STAFFED_FARM_YIELD_POLICY, STAFFED_FARM_YIELD_POLICY_V2];

/** Original rule: every producer turns 30 attended, powered labour minutes into one unit. */
export const LEGACY_LABOR_MINUTES_PER_UNIT = 30;
/** Declared new-city rule for food producers only. The 14-day product audit
 * (98c4ea2) measured 2,362 food units from 109,898 farm and dock minutes
 * against 11,017 units sold: about one fifth of what residents ate, so every
 * city exhausted its opening stock. A staffed farm or dock now yields one
 * unit per 6 attended minutes. Workshops, wages, prices, hours, power,
 * inventory caps and the movement of every actor are unchanged. */
export const STAFFED_FOOD_LABOR_MINUTES_PER_UNIT = 6;
/** v2 balance: the third audit (food freight routing) still ended with
 * starving outer districts, and the user authorised raising farm and fishery
 * output: 4 attended minutes per unit, and farms and docks may hold 240 units
 * (the original store is 120) so a carrier visit finds a full load. */
export const STAFFED_FOOD_LABOR_MINUTES_PER_UNIT_V2 = 4;
export const LEGACY_PRODUCER_STOCK_CAP = 120;
export const STAFFED_FOOD_PRODUCER_STOCK_CAP_V2 = 240;
const food = (kind: BuildingKind) => kind === 'farm' || kind === 'dock';

export function laborMinutesPerUnit(policy: FarmYieldPolicy | undefined, kind: BuildingKind): number {
  if (!food(kind)) return LEGACY_LABOR_MINUTES_PER_UNIT;
  return policy === STAFFED_FARM_YIELD_POLICY_V2 ? STAFFED_FOOD_LABOR_MINUTES_PER_UNIT_V2 : policy === STAFFED_FARM_YIELD_POLICY ? STAFFED_FOOD_LABOR_MINUTES_PER_UNIT : LEGACY_LABOR_MINUTES_PER_UNIT;
}
/** Production and food hiring stop at this producer stock. */
export function producerStockCap(policy: FarmYieldPolicy | undefined, kind: BuildingKind): number {
  return policy === STAFFED_FARM_YIELD_POLICY_V2 && food(kind) ? STAFFED_FOOD_PRODUCER_STOCK_CAP_V2 : LEGACY_PRODUCER_STOCK_CAP;
}

/** The envelope and runtime declare the same explicit new-city policy. */
export function validateFarmYieldPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'farmYieldPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'farmYieldPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !FARM_YIELD_POLICIES.includes(data.farmYieldPolicyId)
    || data.runtime.farmYieldPolicyId !== data.farmYieldPolicyId
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：farm yield policy pair。');
}
