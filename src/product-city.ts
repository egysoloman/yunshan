import { Simulation } from './simulation';
import { createWorld } from './world';
import type { WorldDefinition } from './types';
import { CONTINUOUS_REFERENCE_COLLISION_POLICY } from './simulation/reference-collision';
import { ROAD_FOOD_PICKUP_POLICY } from './simulation/freight-access';
import { NEARBY_MEAL_ROUTE_POLICY } from './simulation/meal-route';
import { STAFFED_FARM_YIELD_POLICY_V2 } from './simulation/farm-yield';
import { SHOP_PROFIT_TAX_POLICY } from './simulation/public-finance';
import { DEMAND_FOOD_FREIGHT_POLICY_V2 } from './simulation/freight-delivery';
import { upgradeServiceMaterialScheduling } from './host/upgrade-service-material-scheduling';

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
  return new Simulation(world, { rulesetId: 'civic-local-v1', historyPolicyId: 'civic-history-pages-v1', referenceCollisionPolicyId: CONTINUOUS_REFERENCE_COLLISION_POLICY, mealRoutePolicyId: NEARBY_MEAL_ROUTE_POLICY, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY_V2, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY_V2, publicFinancePolicyId: SHOP_PROFIT_TAX_POLICY });
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
