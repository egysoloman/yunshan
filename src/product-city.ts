import { Simulation } from './simulation';
import { PLAYER_BOARDING_HOLD_POLICY } from './simulation/boarding-hold';
import { PLAYER_YIELD_POLICY } from './simulation/player-yield';
import { CABLE_SPEED_POLICY } from './simulation/cable-speed';
import { CLOSURE_TRAFFIC_POLICY } from './simulation/closure-traffic';
import { ARRIVAL_HOMES_POLICY } from './simulation/arrival-homes';
import { MUNICIPAL_REPAIR_POLICY } from './simulation/municipal-repair';
import { COMPANY_DIVIDEND_POLICY } from './simulation/company-dividend';
import { STUDENT_DORM_POLICY } from './simulation/student-dorm';
import { cachedWorld } from './persistence/world-cache';
import { createWorld } from './world';
import type { WorldDefinition } from './types';
import { CONTINUOUS_REFERENCE_COLLISION_POLICY } from './simulation/reference-collision';
import { ROAD_FOOD_PICKUP_POLICY } from './simulation/freight-access';
import { WORKING_LUNCH_ROUTE_POLICY } from './simulation/meal-route';
import { STAFFED_FARM_YIELD_POLICY_V4 } from './simulation/farm-yield';
import { SHOP_PROFIT_TAX_POLICY_V8 } from './simulation/public-finance';
import { FOREIGN_TRADE_POLICY_V2 } from './simulation/foreign-trade';
import { NPC_MOTION_COARSE_POLICY } from './simulation/npc-motion-coarse';
import { DEMAND_FOOD_FREIGHT_POLICY_V3 } from './simulation/freight-delivery';
import { upgradeServiceMaterialScheduling } from './host/upgrade-service-material-scheduling';

export const PRODUCT_CITY_LAYOUT = 'current-v9' as const;

/** Product recipe is explicit; compatibility createWorld() retains current-v6. */
export function createProductWorld(seed = 20261001): ReturnType<typeof createWorld> {
  return cachedWorld(seed, PRODUCT_CITY_LAYOUT) as ReturnType<typeof createWorld>;
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
  return new Simulation(world, { rulesetId: 'civic-local-v1', historyPolicyId: 'civic-history-pages-v1', referenceCollisionPolicyId: CONTINUOUS_REFERENCE_COLLISION_POLICY, mealRoutePolicyId: WORKING_LUNCH_ROUTE_POLICY, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY_V4, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY_V3, publicFinancePolicyId: SHOP_PROFIT_TAX_POLICY_V8, foreignTradePolicyId: FOREIGN_TRADE_POLICY_V2, npcMotionPolicyId: NPC_MOTION_COARSE_POLICY, boardingHoldPolicyId: PLAYER_BOARDING_HOLD_POLICY, playerYieldPolicyId: PLAYER_YIELD_POLICY, cableSpeedPolicyId: CABLE_SPEED_POLICY, closureTrafficPolicyId: CLOSURE_TRAFFIC_POLICY, arrivalHomesPolicyId: ARRIVAL_HOMES_POLICY, municipalRepairPolicyId: MUNICIPAL_REPAIR_POLICY, companyDividendPolicyId: COMPANY_DIVIDEND_POLICY, studentDormPolicyId: STUDENT_DORM_POLICY });
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
