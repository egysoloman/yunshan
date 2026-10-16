import { crowdSpots, crowdSpotTarget } from './rendering/crowd-spots';
import type { SimState, Vec3, WorldDefinition } from './types';

/** Where a first-day step can be done right now, for a one-click walk there:
 * eat — the nearest open market with food in stock; work — the nearest open
 * market (its counter offers the 60-minute shift); meet — the public venue at
 * the nearest of the busiest places people are out now. Null when nothing qualifies. */
export type FirstDayStep = 'eat' | 'work' | 'meet';
export function firstDayTarget(state: SimState, world: WorldDefinition, position: Vec3, step: FirstDayStep): string | null {
  if (step === 'meet') {
    // The nearest of the busiest places: a first meeting should not need a cross-city trip.
    const profiles = state.extension?.actorProfiles, spot = crowdSpots(state.citizens.map(c => ({ position: c.position, state: c.state, alive: profiles?.[c.id]?.alive !== false })))
      .sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z))[0];
    return spot ? crowdSpotTarget(world.buildings, spot) : null;
  }
  const buildings = new Map(world.buildings.map(b => [b.id, b]));
  const far = (id: string) => { const door = buildings.get(id)!.door; return Math.hypot(door.x - position.x, door.z - position.z); };
  const open = state.shops.filter(shop => shop.open && buildings.get(shop.buildingId)?.kind === 'market' && (step === 'work' || shop.inventory >= 1));
  return open.map(shop => shop.buildingId).sort((a, b) => far(a) - far(b) || (a < b ? -1 : 1))[0] ?? null;
}
