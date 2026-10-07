import type { Citizen } from '../types';

export const NEARBY_MEAL_ROUTE_POLICY = 'nearby-food-v1' as const;
export type MealRoutePolicy = typeof NEARBY_MEAL_ROUTE_POLICY;

/** Observe a critical meal's final approach before a coarse actor window can
 * outlast the counter's stock. Longer journeys and other activities retain
 * their scheduling. The bound is the earliest original meal decision interval
 * (25 minutes), using the unchanged walking rate and full reference polyline;
 * native stair traversal still owns its actual distance and movement budget.
 * Observed rider arrivals also receive one timely people update, retaining
 * the original arrival-time movement guard even on a longer onward route. */
export function mealNeedsContinuousPeople(policy: MealRoutePolicy | undefined,
  citizen: Pick<Citizen, 'needs' | 'food' | 'position' | 'route' | 'routeIndex'>,
  elapsed: number, age: number, activity: string | undefined, arrivedRider: boolean, walkingSpeed: number): boolean {
  if (policy !== NEARBY_MEAL_ROUTE_POLICY || age < 6 || activity !== 'eat'
    || (citizen.food ?? 0) >= 1 || citizen.needs.hunger - elapsed * .05 >= 30) return false;
  if (arrivedRider) return true;
  if (!Number.isFinite(walkingSpeed) || walkingSpeed <= 0) return false;
  const route = citizen.route, index = citizen.routeIndex ?? 0;
  if (!route?.length || index < 0 || index > route.length || !Number.isInteger(index)) return false;
  const limit = walkingSpeed * 25; let remaining = 0, position = citizen.position;
  for (let at = Math.min(index, route.length - 1); at < route.length; at++) {
    const point = route[at]; remaining += Math.hypot(point.x - position.x, point.y - position.y, point.z - position.z);
    if (!Number.isFinite(remaining) || remaining > limit) return false;
    position = point;
  }
  return true;
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
  if (!envelope || !runtime || data.mealRoutePolicyId !== NEARBY_MEAL_ROUTE_POLICY
    || data.runtime.mealRoutePolicyId !== NEARBY_MEAL_ROUTE_POLICY
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：meal route policy pair。');
}
