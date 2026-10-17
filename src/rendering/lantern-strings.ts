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

/** Beyond the market, every TERRACE_LANTERN_SPAN metres along the other
 * districts' current-v8 terrace streets a lighter string of three lanterns
 * crosses the stone stair street (the reference town's lantern lanes). A
 * string is left out when either pole would stand inside a building's
 * footprint (+0.4 m) or within 2.5 m of a door. Display only. */
export const TERRACE_LANTERN_SPAN = 36;
export function terraceLanternStrings(world: WorldDefinition): LanternString[] {
  if ((world as WorldDefinition & { layoutVersion?: string }).layoutVersion !== 'current-v8') return [];
  const nodes = new Map(world.nodes.map(n => [n.id, n])), out: LanternString[] = [];
  const blocked = (p: Vec3) => world.buildings.some(b => {
    const dx = p.x - b.position.x, dz = p.z - b.position.z, reach = b.width + b.depth + 8;
    if (dx * dx + dz * dz > reach * reach) return false;
    const c = Math.cos(b.rotation), s = Math.sin(b.rotation), lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ddx = p.x - b.door.x, ddz = p.z - b.door.z;
    return Math.abs(lx) < b.width / 2 + .4 && Math.abs(lz) < b.depth / 2 + .4 || ddx * ddx + ddz * ddz < 2.5 * 2.5;
  });
  for (const edge of world.edges) {
    if (edge.mode !== 'road' || !edge.id.includes('-terrace-') || nodes.get(edge.from)?.districtId === 'market' || nodes.get(edge.to)?.districtId === 'market') continue;
    const half = deckWidth(edge) / 2 + .6;
    let carry = TERRACE_LANTERN_SPAN / 2;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (; carry <= len; carry += TERRACE_LANTERN_SPAN) {
        const t = carry / len, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        const poles: [Vec3, Vec3] = [{ x: x + nx * half, y, z: z + nz * half }, { x: x - nx * half, y, z: z - nz * half }];
        if (blocked(poles[0]) || blocked(poles[1])) continue;
        const lanterns: Vec3[] = [];
        for (let k = 1; k <= 3; k++) { const u = k / 4 * 2 - 1; lanterns.push({ x: x + nx * half * u, y: y + 5.6 - (1 - u * u) * .6, z: z + nz * half * u }); }
        out.push({ poles, lanterns });
      }
      carry -= len;
    }
  }
  return out;
}
