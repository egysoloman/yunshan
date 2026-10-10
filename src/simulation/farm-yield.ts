import type { BuildingKind } from '../types';

export const STAFFED_FARM_YIELD_POLICY = 'staffed-farm-yield-v1' as const;
/** v2 (balance, user-authorised 2026-10-08): 4 minutes per unit and a 240-unit producer store. */
export const STAFFED_FARM_YIELD_POLICY_V2 = 'staffed-farm-yield-v2' as const;
/** v3 (user direction 2026-10-10: industry supplies agriculture). Workshop
 * materials become farm and fishery inputs: tools, nets, fertiliser. The
 * 14-day audit 5 sold 0 of 5,783 workshop units to anyone but the treasury,
 * and workshops held 84% of all production minutes. A v3 food producer keeps
 * the v2 rate and store while it holds inputs, consuming FARM_INPUT_PER_UNIT
 * per unit; labour without inputs yields at half that rate. Producers buy
 * inputs from workshops with their own cash, as a taxed wholesale. */
export const STAFFED_FARM_YIELD_POLICY_V3 = 'staffed-farm-yield-v3' as const;
export type FarmYieldPolicy = typeof STAFFED_FARM_YIELD_POLICY | typeof STAFFED_FARM_YIELD_POLICY_V2 | typeof STAFFED_FARM_YIELD_POLICY_V3;
export const FARM_YIELD_POLICIES: readonly FarmYieldPolicy[] = [STAFFED_FARM_YIELD_POLICY, STAFFED_FARM_YIELD_POLICY_V2, STAFFED_FARM_YIELD_POLICY_V3];
export const FARM_INPUT_PER_UNIT = .1;
/** A producer reorders below this input stock, up to FARM_INPUT_ORDER_TARGET. */
export const FARM_INPUT_REORDER = 6;
export const FARM_INPUT_ORDER_TARGET = 24;
export const UNAIDED_FOOD_RATE = .5;
export const farmInputsUsed = (policy: FarmYieldPolicy | undefined) => policy === STAFFED_FARM_YIELD_POLICY_V3;

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
  return policy === STAFFED_FARM_YIELD_POLICY_V2 || policy === STAFFED_FARM_YIELD_POLICY_V3 ? STAFFED_FOOD_LABOR_MINUTES_PER_UNIT_V2 : policy === STAFFED_FARM_YIELD_POLICY ? STAFFED_FOOD_LABOR_MINUTES_PER_UNIT : LEGACY_LABOR_MINUTES_PER_UNIT;
}
/** Production and food hiring stop at this producer stock. */
export function producerStockCap(policy: FarmYieldPolicy | undefined, kind: BuildingKind): number {
  return (policy === STAFFED_FARM_YIELD_POLICY_V2 || policy === STAFFED_FARM_YIELD_POLICY_V3) && food(kind) ? STAFFED_FOOD_PRODUCER_STOCK_CAP_V2 : LEGACY_PRODUCER_STOCK_CAP;
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

/** v3 output from labour that would yield `potential` units with inputs:
 * inputs are used first; the remaining labour yields at the unaided rate;
 * `room` is the producer's free store. */
export function foodOutputWithInputs(potential: number, inputs: number, room: number): { units: number; inputsUsed: number } {
  const aided = Math.min(Math.max(0, potential), Math.max(0, inputs) / FARM_INPUT_PER_UNIT);
  const units = Math.min(Math.max(0, room), aided + (Math.max(0, potential) - aided) * UNAIDED_FOOD_RATE);
  return { units, inputsUsed: Math.min(aided, units) * FARM_INPUT_PER_UNIT };
}
