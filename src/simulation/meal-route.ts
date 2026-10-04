export const NEARBY_MEAL_ROUTE_POLICY = 'nearby-food-v1' as const;
export type MealRoutePolicy = typeof NEARBY_MEAL_ROUTE_POLICY;

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
  if (!envelope || !runtime || data.mealRoutePolicyId !== NEARBY_MEAL_ROUTE_POLICY
    || data.runtime.mealRoutePolicyId !== NEARBY_MEAL_ROUTE_POLICY
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：meal route policy pair。');
}
