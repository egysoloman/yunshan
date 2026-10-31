import type { SimState, WorldDefinition } from '../types';

/** How much of each building's windows are lit after dark, from who is
 * actually there (index = the building's position in world.buildings):
 * a home by the share of its residents at home and awake (sleepers keep their
 * rooms dark), an open shop mostly lit, any other building by the people
 * inside it at work, study or service. A small floor keeps a lived-in city
 * from going wholly black. */
export const WINDOW_LIGHT_FLOOR = .06, OPEN_SHOP_LIGHT = .8;
const AWAKE_AT_HOME = new Set(['atHome']), INSIDE_ACTIVE = new Set(['working', 'studying', 'shopping', 'attendingService', 'healing', 'reviewingBudget', 'reviewingBusiness', 'socializing']);
export function windowLightLevels(state: SimState, world: WorldDefinition): Float32Array {
  const index = new Map(world.buildings.map((b, i) => [b.id, i])), residents = new Float32Array(world.buildings.length), awake = new Float32Array(world.buildings.length), present = new Float32Array(world.buildings.length);
  const profiles = state.extension?.actorProfiles;
  for (const c of state.citizens) {
    if (profiles?.[c.id]?.alive === false || c.state === 'dead') continue;
    const home = index.get(c.homeId); if (home !== undefined) { residents[home]++; if (AWAKE_AT_HOME.has(c.state)) awake[home]++; }
    const at = c.destinationId ? index.get(c.destinationId) : undefined; if (at !== undefined && INSIDE_ACTIVE.has(c.state)) present[at]++;
  }
  const open = new Set(state.shops.filter(shop => shop.open).map(shop => shop.buildingId)), out = new Float32Array(world.buildings.length);
  world.buildings.forEach((b, i) => {
    const level = b.kind === 'home' ? (residents[i] ? awake[i] / residents[i] : 0) : Math.max(open.has(b.id) ? OPEN_SHOP_LIGHT : 0, Math.min(1, present[i] / Math.max(4, b.capacity * .25)));
    out[i] = Math.max(WINDOW_LIGHT_FLOOR, Math.min(1, level));
  });
  return out;
}
