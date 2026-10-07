import type { BuildingKind } from '../types';

export const STAFFED_FARM_YIELD_POLICY = 'staffed-farm-yield-v1' as const;
export type FarmYieldPolicy = typeof STAFFED_FARM_YIELD_POLICY;

/** Original rule: every producer turns 30 attended, powered labour minutes into one unit. */
export const LEGACY_LABOR_MINUTES_PER_UNIT = 30;
/** Declared new-city rule for food producers only. The 14-day product audit
 * (98c4ea2) measured 2,362 food units from 109,898 farm and dock minutes
 * against 11,017 units sold: about one fifth of what residents ate, so every
 * city exhausted its opening stock. A staffed farm or dock now yields one
 * unit per 6 attended minutes. Workshops, wages, prices, hours, power,
 * inventory caps and the movement of every actor are unchanged. */
export const STAFFED_FOOD_LABOR_MINUTES_PER_UNIT = 6;

export function laborMinutesPerUnit(policy: FarmYieldPolicy | undefined, kind: BuildingKind): number {
  return policy === STAFFED_FARM_YIELD_POLICY && (kind === 'farm' || kind === 'dock') ? STAFFED_FOOD_LABOR_MINUTES_PER_UNIT : LEGACY_LABOR_MINUTES_PER_UNIT;
}

/** The envelope and runtime declare the same explicit new-city policy. */
export function validateFarmYieldPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'farmYieldPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'farmYieldPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || data.farmYieldPolicyId !== STAFFED_FARM_YIELD_POLICY
    || data.runtime.farmYieldPolicyId !== STAFFED_FARM_YIELD_POLICY
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：farm yield policy pair。');
}
