import type { Vec3, WorldDefinition } from '../types';
import { deckWidth } from '../transport-geometry';

/** R4 (docs/设计/美术与渲染改造方案.md §2.5): 千灯市集's strings of red
 * lanterns hung across its streets. Every LANTERN_SPAN metres along a market
 * district street (current-v8), two poles stand just outside the kerbs and a
 * sagging cord of lanterns crosses above the carriageway. Display only:
 * nothing here is walkable, collides or enters the simulation. */
export const LANTERN_SPAN = 24;
export interface LanternString { poles: [Vec3, Vec3]; lanterns: Vec3[] }

export function lanternStrings(world: WorldDefinition, districtId = 'market'): LanternString[] {
  if ((world as WorldDefinition & { layoutVersion?: string }).layoutVersion !== 'current-v8') return [];
  const nodes = new Map(world.nodes.map(n => [n.id, n])), out: LanternString[] = [];
  for (const edge of world.edges) {
    if (edge.mode !== 'road' || edge.id.includes('runway') || nodes.get(edge.from)?.districtId !== districtId || nodes.get(edge.to)?.districtId !== districtId) continue;
    const half = deckWidth(edge) / 2 + .8;
    let carry = LANTERN_SPAN / 2;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (; carry <= len; carry += LANTERN_SPAN) {
        const t = carry / len, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        const lanterns: Vec3[] = [];
        for (let k = 1; k <= 5; k++) { const u = k / 6 * 2 - 1; lanterns.push({ x: x + nx * half * u, y: y + 5.6 - (1 - u * u) * .9, z: z + nz * half * u }); }
        out.push({ poles: [{ x: x + nx * half, y, z: z + nz * half }, { x: x - nx * half, y, z: z - nz * half }], lanterns });
      }
      carry -= len;
    }
  }
  return out;
}
