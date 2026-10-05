import { Simulation } from './simulation';
import { createWorld } from './world';
import type { WorldDefinition } from './types';
import { CONTINUOUS_REFERENCE_COLLISION_POLICY } from './simulation/reference-collision';
import { ROAD_FOOD_PICKUP_POLICY } from './simulation/freight-access';
import { NEARBY_MEAL_ROUTE_POLICY } from './simulation/meal-route';
import { upgradeServiceMaterialScheduling } from './host/upgrade-service-material-scheduling';
import { upgradeFreightDelivery } from './host/upgrade-freight-delivery';
import { upgradeResidentTuition } from './host/upgrade-resident-tuition';

export const PRODUCT_CITY_LAYOUT = 'current-v6' as const;

/** Product recipe is explicit; compatibility createWorld() retains current-v6. */
export function createProductWorld(seed = 20261001): ReturnType<typeof createWorld> {
  return createWorld(seed, PRODUCT_CITY_LAYOUT);
}

/** Version-three recipe retained for hosts that explicitly selected its contract. */
export function createProductCity(world: WorldDefinition): Simulation {
  return new Simulation(world, { rulesetId: 'civic-local-v1' });
}

/** A separate explicit recipe; existing product/v3 readers never activate it on load. */
export function createArchivedProductCity(world: WorldDefinition): Simulation {
  return new Simulation(world, { rulesetId: 'civic-local-v1', historyPolicyId: 'civic-history-pages-v1' });
}

/** New cities select continuous ordinary reference legs; imports retain their
 * existing history, motion and collision contracts. */
export function createCurrentProductCity(world: WorldDefinition): Simulation {
  return new Simulation(world, { rulesetId: 'civic-local-v1', historyPolicyId: 'civic-history-pages-v1', referenceCollisionPolicyId: CONTINUOUS_REFERENCE_COLLISION_POLICY, mealRoutePolicyId: NEARBY_MEAL_ROUTE_POLICY, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY });
}

/** Fresh city-life recipe for both graphical and headless hosts. The policy's
 * origin is the actual complete new-city save, hashed before any step. Existing
 * synchronous recipes and subsequent imports keep their declared contracts. */
export async function createCityLifeProductCity(world: WorldDefinition): Promise<Simulation> {
  const simulation = createCurrentProductCity(world), before = simulation.exportSave();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(before));
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const result = await upgradeServiceMaterialScheduling(simulation, sha256);
  if (!result.ok) throw new Error(result.message);
  return simulation;
}

/** Fresh graphical/text recipe with real road delivery to food retailers.
 * Existing recipes retain their exact contracts. Loading a saved session into
 * this instance restores that save's declared rules, including legacy delivery.
 * The two declarations are added by the same production SHA-guarded upgrade
 * used for existing complete native sessions, before the first ordinary step. */
export async function createDeliveredCityLifeProductCity(world: WorldDefinition): Promise<Simulation> {
  const simulation = await createCityLifeProductCity(world), before = simulation.exportSave();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(before));
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const result = await upgradeFreightDelivery(simulation, sha256);
  if (!result.ok) throw new Error(result.message);
  return simulation;
}

/** New fresh recipe. Every earlier factory and imported policy remains intact. */
export async function createLearningCityLifeProductCity(world: WorldDefinition): Promise<Simulation> {
  const simulation = await createDeliveredCityLifeProductCity(world), before = simulation.exportSave();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(before));
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const result = await upgradeResidentTuition(simulation, sha256);
  if (!result.ok) throw new Error(result.message);
  return simulation;
}
