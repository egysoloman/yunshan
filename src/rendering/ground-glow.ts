import type { WorldDefinition } from '../types';
import { lanternGlows } from './lantern-glow';

/** Display only: warm pools of light on the ground under street lamps and doorway
 * lamps after dusk, below each lantern-glow point (lantern-glow.ts). A street pool
 * lies on its road segment (tilted along the slope, as `along` gives); a door pool
 * lies flat on the sill. Shared by the web renderer and Unity (Core/GroundGlow.cs). */
export const STREET_LAMP_HEIGHT = 3.6, DOOR_LAMP_HEIGHT = 2.2, GROUND_LIFT = .06;
export const STREET_POOL_RADIUS = 4.5, DOOR_POOL_RADIUS = 2.6;
/** along: unit direction of the road at the pool (x, y, z); null for a flat pool. */
export interface GroundPool { x: number; y: number; z: number; radius: number; along: [number, number, number] | null }

export function groundPools(world: WorldDefinition, streetSpacing = 36): GroundPool[] {
  const out: GroundPool[] = [];
  for (const g of lanternGlows(world, streetSpacing)) if (g.kind === 'door') out.push({ x: g.x, y: g.y - DOOR_LAMP_HEIGHT + GROUND_LIFT, z: g.z, radius: DOOR_POOL_RADIUS, along: null });
  // The street lamps of lanternGlows, with the direction of the segment each stands on.
  for (const edge of world.edges) {
    if ((edge.mode !== 'road' && edge.mode !== 'bridge') || edge.id.includes('runway')) continue;
    let carry = streetSpacing / 2;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      for (; carry <= seg; carry += streetSpacing) {
        const t = carry / seg;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + GROUND_LIFT, z: a.z + (b.z - a.z) * t, radius: STREET_POOL_RADIUS, along: [(b.x - a.x) / seg, (b.y - a.y) / seg, (b.z - a.z) / seg] });
      }
      carry -= seg;
    }
  }
  return out;
}
