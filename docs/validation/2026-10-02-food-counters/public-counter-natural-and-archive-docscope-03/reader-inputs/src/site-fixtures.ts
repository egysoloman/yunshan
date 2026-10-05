import type { Building, Vec3, WorldDefinition } from './types';
import { getWalkHeight } from './world';

/** Public exterior objects use one physical description for drawing and walking.
 * These counters belong to the existing market, and create no shops or goods. */
export interface MarketCounter {
  id: string; buildingId: string; position: Vec3; localPosition: Vec3;
  size: Vec3; rotation: number;
}
const quantum = (value: number) => Math.round(value / .2) * .2;
const toWorld = (building: Building, x: number, z: number) => ({
  x: building.position.x + x * Math.cos(building.rotation) + z * Math.sin(building.rotation),
  z: building.position.z + z * Math.cos(building.rotation) - x * Math.sin(building.rotation),
});

export function marketCounters(world: WorldDefinition, building: Building): MarketCounter[] {
  if (building.kind !== 'market') return [];
  const width = quantum(Math.min(3.2, building.width * .18)), depth = 1.2;
  const result: MarketCounter[] = [];
  for (const side of [-1, 1]) {
    const x = quantum(side * building.width * .3), z = quantum(building.depth / 2 + 1.2);
    const center = toWorld(building, x, z);
    // A counter rests on the authoritative walking surface. A steep exterior
    // requires an actual terrace first; a floating display would be misleading.
    const supports = [[0, 0], [-width / 2, -depth / 2], [-width / 2, depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2]].map(([dx, dz]) => {
      const point = toWorld(building, x + dx, z + dz);
      return getWalkHeight(world, point.x, point.z, building.door.y);
    });
    if (Math.max(...supports) - Math.min(...supports) > .4 + 1e-7) continue;
    const base = Math.max(...supports);
    result.push({ id: `${building.id}-counter-${side < 0 ? 'west' : 'east'}`, buildingId: building.id,
      position: { ...center, y: base + .5 }, localPosition: { x, y: base + .5 - building.position.y, z },
      size: { x: width, y: 1, z: depth }, rotation: building.rotation });
  }
  return result;
}

/** A save made before these objects had collisions may start inside one. It
 * can walk outward, but cannot walk deeper or enter from outside. No teleport. */
export function blocksMarketCounter(counters: readonly MarketCounter[], from: Vec3, to: Vec3, radius = .35, height = 1.72): boolean {
  for (const counter of counters) {
    const bottom = counter.position.y - counter.size.y / 2, top = bottom + counter.size.y;
    if (from.y >= top - .01 || from.y + height <= bottom + .01) continue;
    const local = (p: Vec3) => {
      const dx = p.x - counter.position.x, dz = p.z - counter.position.z;
      return { x: dx * Math.cos(counter.rotation) - dz * Math.sin(counter.rotation), z: dz * Math.cos(counter.rotation) + dx * Math.sin(counter.rotation) };
    };
    const before = local(from), after = local(to), halfX = counter.size.x / 2 + radius, halfZ = counter.size.z / 2 + radius;
    const penetration = (p: { x: number; z: number }) => Math.min(halfX - Math.abs(p.x), halfZ - Math.abs(p.z));
    const radialDistance = (p: { x: number; z: number }) => (p.x / halfX) ** 2 + (p.z / halfZ) ** 2;
    const next = penetration(after);
    const escaping = penetration(before) > 1e-7 && (next < penetration(before) - 1e-7 || radialDistance(after) > radialDistance(before) + 1e-7);
    if (next > 1e-7 && !escaping) return true;
  }
  return false;
}

/** Display a bounded sample of actual whole food units; it never changes stock. */
export function marketDisplayUnits(inventory: number): number {
  return Number.isFinite(inventory) ? Math.max(0, Math.min(8, Math.floor(inventory))) : 0;
}
