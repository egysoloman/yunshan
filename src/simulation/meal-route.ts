export const NEARBY_MEAL_ROUTE_POLICY = 'nearby-food-v1' as const;
/** v2 (2026-10-11, world rebuild decision 4: outdoor routines). v1 plus a
 * lunch break: between 11:30 and 13:00 a resident who is not full (hunger
 * below 80) values a food offer LUNCH_BONUS more, so workers and students
 * walk out to a nearby open food shop at midday, pay for the meal as usual
 * and return. A probe counted 41 of 616 residents outdoors at noon. Hunger
 * decay, meal recovery, prices, walking speed and routes are unchanged. */
export const NEARBY_LUNCH_MEAL_ROUTE_POLICY = 'nearby-food-v2' as const;
export type MealRoutePolicy = typeof NEARBY_MEAL_ROUTE_POLICY | typeof NEARBY_LUNCH_MEAL_ROUTE_POLICY;
export const MEAL_ROUTE_POLICIES: readonly MealRoutePolicy[] = [NEARBY_MEAL_ROUTE_POLICY, NEARBY_LUNCH_MEAL_ROUTE_POLICY];
export const LUNCH_BONUS = 90;
/** Both declared policies compare tied food offers by actual travel. */
export const nearestMealPolicy = (policy: MealRoutePolicy | undefined) => policy === NEARBY_MEAL_ROUTE_POLICY || policy === NEARBY_LUNCH_MEAL_ROUTE_POLICY;
/** v2 lunch preference for one food offer. */
export function lunchBonus(policy: MealRoutePolicy | undefined, hour: number, hunger: number): number {
  return policy === NEARBY_LUNCH_MEAL_ROUTE_POLICY && hour >= 11.5 && hour < 13 && hunger < 80 ? LUNCH_BONUS : 0;
}

/** Preserve the original highest-score activity. Only when its winner is food
 * do equally scored food offers compare their actual finite travel cost. */
export function chooseNearestTiedMeal<T extends { activity: string; score: number; travel: number }>(ranked: readonly T[]): T | undefined {
  let chosen = ranked[0];
  if (chosen?.activity !== 'eat') return chosen;
  for (const offer of ranked) if (offer.activity === 'eat' && offer.score === chosen.score && offer.travel < chosen.travel) chosen = offer;
  return chosen;
}

/** Choose using existing needs, offers, routes and decision deadlines. This
 * policy neither supplies food nor changes walking speed or route geometry. */
export function validateMealRoutePolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'mealRoutePolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'mealRoutePolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !MEAL_ROUTE_POLICIES.includes(data.mealRoutePolicyId)
    || data.runtime.mealRoutePolicyId !== data.mealRoutePolicyId
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：meal route policy pair。');
}
