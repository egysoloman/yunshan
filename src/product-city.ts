import { Simulation } from './simulation';
import { createWorld } from './world';
import type { WorldDefinition } from './types';

export const PRODUCT_CITY_LAYOUT = 'current-v6' as const;

/** Product recipe is explicit; compatibility createWorld() retains current-v6. */
export function createProductWorld(seed = 20261001): ReturnType<typeof createWorld> {
  return createWorld(seed, PRODUCT_CITY_LAYOUT);
}

/** Explicit product default. Compatibility hosts may still use Simulation(world). */
export function createProductCity(world: WorldDefinition): Simulation {
  return new Simulation(world, { rulesetId: 'civic-local-v1' });
}
