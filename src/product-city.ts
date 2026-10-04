import { Simulation } from './simulation';
import { createWorld } from './world';
import type { WorldDefinition } from './types';

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

/** New cities use complete history; importSave retains each existing envelope. */
export function createCurrentProductCity(world: WorldDefinition): Simulation {
  return createArchivedProductCity(world);
}
