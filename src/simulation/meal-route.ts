export const NEARBY_MEAL_ROUTE_POLICY = 'nearby-food-v1' as const;
/** v2 (2026-10-11, world rebuild decision 4: outdoor routines). v1 plus a
 * lunch break: between 11:30 and 13:00 a resident who is not full (hunger
 * below 80) values a food offer LUNCH_BONUS more, so workers and students
 * walk out to a nearby open food shop at midday, pay for the meal as usual
 * and return. A probe counted 41 of 616 residents outdoors at noon. Hunger
 * decay, meal recovery, prices, walking speed and routes are unchanged. */
export const NEARBY_LUNCH_MEAL_ROUTE_POLICY = 'nearby-food-v2' as const;
/** v3 (2026-10-11, outdoor routines, step 2). v2 plus an evening outing:
 * between 18:30 and 21:00 a resident who has eaten (hunger ≥ 65) and is not
 * tired (fatigue ≥ 45) values going out to socialise EVENING_BONUS more at
 * the pavilions, halls and docks already offered, or strolling past the open
 * counters of their own district's markets (no purchase, no money moves).
 * Need decay and recovery, prices, walking speed and routes are unchanged. */
export const NEARBY_EVENING_ROUTE_POLICY = 'nearby-food-v3' as const;
/** v4 (2026-10-15, outdoor routines, step 3). v3 plus street browsing: the
 * v3 evening stroll to a market walked into the shop and stood at its counter,
 * so the lantern streets stayed empty after dark. Under v4 a resident who is
 * not already inside browses on the street in front of the market instead: the
 * outing ends on its own walking route, BROWSE_MIN–BROWSE_MAX m short of the
 * door (spread per resident). Scores, needs, prices and speeds are v3's. */
export const STREET_BROWSE_ROUTE_POLICY = 'nearby-food-v4' as const;
/** v5 (2026-10-17, outdoor routines, step 4: market street stalls). v4 plus
 * street food: a resident who is not already inside a market buys a meal at
 * the stall on the street in front of it — the same BROWSE_MIN–BROWSE_MAX m
 * point on their own walking route that v4 browsers use — instead of walking
 * in to the indoor counter, and stays there until their next decision. A
 * probe counted 30–38 of ~650 residents outdoors between 10:30 and 17:00.
 * Price, quantity, stock, consignment, tax and every other v4 rule are
 * unchanged; only where the purchase happens moves. */
export const STREET_FOOD_ROUTE_POLICY = 'nearby-food-v5' as const;
/** v6 (2026-10-17, outdoor routines, step 5). v5 plus a short stall meal: a
 * 14-day audit of v5 kept GDP and sales but cost 4.8% of private working time
 * and 8.7% of production, because a resident who bought at a stall stood
 * there until their next decision (25–60 min). Under v6 the next decision
 * comes at most STALL_LINGER minutes after the stall sale. Everything else is v5's. */
export const SHORT_STALL_ROUTE_POLICY = 'nearby-food-v6' as const;
export const STALL_LINGER = 15;
/** v7 (2026-10-17, outdoor routines, step 6). v6 plus a working lunch: the v6
 * audit kept production but still cost 2.7% of private working time, and the
 * poor count rose 163 → 184, almost all of it shop staff (53 → 67). Under v7
 * an employed resident who buys at a stall before the end of the working day
 * (WORKDAY_END) decides again at once, so the shift resumes; everyone else
 * keeps v6's STALL_LINGER. Everything else is v6's. */
export const WORKING_LUNCH_ROUTE_POLICY = 'nearby-food-v7' as const;
export const WORKDAY_END = 17;
export type MealRoutePolicy = typeof NEARBY_MEAL_ROUTE_POLICY | typeof NEARBY_LUNCH_MEAL_ROUTE_POLICY | typeof NEARBY_EVENING_ROUTE_POLICY | typeof STREET_BROWSE_ROUTE_POLICY | typeof STREET_FOOD_ROUTE_POLICY | typeof SHORT_STALL_ROUTE_POLICY | typeof WORKING_LUNCH_ROUTE_POLICY;
export const MEAL_ROUTE_POLICIES: readonly MealRoutePolicy[] = [NEARBY_MEAL_ROUTE_POLICY, NEARBY_LUNCH_MEAL_ROUTE_POLICY, NEARBY_EVENING_ROUTE_POLICY, STREET_BROWSE_ROUTE_POLICY, STREET_FOOD_ROUTE_POLICY, SHORT_STALL_ROUTE_POLICY, WORKING_LUNCH_ROUTE_POLICY];
export const BROWSE_MIN = 2, BROWSE_MAX = 5;
export const browsesOnStreet = (policy: MealRoutePolicy | undefined) => policy === STREET_BROWSE_ROUTE_POLICY || policy === STREET_FOOD_ROUTE_POLICY || policy === SHORT_STALL_ROUTE_POLICY || policy === WORKING_LUNCH_ROUTE_POLICY;
/** v5: market meals are bought at the street stall in front of the door. */
export const eatsOnStreet = (policy: MealRoutePolicy | undefined) => policy === STREET_FOOD_ROUTE_POLICY || policy === SHORT_STALL_ROUTE_POLICY || policy === WORKING_LUNCH_ROUTE_POLICY;
/** v6: the stall meal ends within STALL_LINGER minutes of the sale. */
export const shortStallMeal = (policy: MealRoutePolicy | undefined) => policy === SHORT_STALL_ROUTE_POLICY || policy === WORKING_LUNCH_ROUTE_POLICY;
/** Minutes a stall meal holds the resident before the next decision (v6/v7). */
export function stallLinger(policy: MealRoutePolicy | undefined, employed: boolean, hour: number): number {
  return policy === WORKING_LUNCH_ROUTE_POLICY && employed && hour < WORKDAY_END ? 0 : STALL_LINGER;
}
/** The route ending `back` metres before its last point (the door), along the route itself. */
export function routeShortOfDoor<P extends { x: number; y: number; z: number }>(route: readonly P[], back: number): P[] {
  let left = back;
  for (let i = route.length - 1; i > 0; i--) {
    const b = route[i], a = route[i - 1], length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (length >= left - 1e-9) { const t = length > 1e-9 ? 1 - left / length : 0; return [...route.slice(0, i), { ...a, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }]; }
    left -= length;
  }
  return route.slice(0, 1);
}
export const EVENING_BONUS = 45;
export const LUNCH_BONUS = 90;
/** Both declared policies compare tied food offers by actual travel. */
export const nearestMealPolicy = (policy: MealRoutePolicy | undefined) => policy !== undefined && MEAL_ROUTE_POLICIES.includes(policy);
/** v2/v3 lunch preference for one food offer. */
export function lunchBonus(policy: MealRoutePolicy | undefined, hour: number, hunger: number): number {
  return (policy === NEARBY_LUNCH_MEAL_ROUTE_POLICY || policy === NEARBY_EVENING_ROUTE_POLICY || policy === STREET_BROWSE_ROUTE_POLICY || policy === STREET_FOOD_ROUTE_POLICY || policy === SHORT_STALL_ROUTE_POLICY || policy === WORKING_LUNCH_ROUTE_POLICY) && hour >= 11.5 && hour < 13 && hunger < 80 ? LUNCH_BONUS : 0;
}
/** v3 evening preference for one outing offer (0 outside the window). */
export function eveningBonus(policy: MealRoutePolicy | undefined, hour: number, hunger: number, fatigue: number): number {
  return (policy === NEARBY_EVENING_ROUTE_POLICY || policy === STREET_BROWSE_ROUTE_POLICY || policy === STREET_FOOD_ROUTE_POLICY || policy === SHORT_STALL_ROUTE_POLICY || policy === WORKING_LUNCH_ROUTE_POLICY) && hour >= 18.5 && hour < 21 && hunger >= 65 && fatigue >= 45 ? EVENING_BONUS : 0;
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
