/** Road decks that overlap in plan at head-clearance height without meeting:
 * two ground roads whose 10 m decks touch while one is 0.5–4.8 m above the
 * other (a walker on the lower one stands under the upper deck). Samples every
 * 2 m; points within 14 m of a node the two edges share are ignored.
 *   npx tsx scripts/roads/deck-clashes.ts [layout] */
import { createWorld, type CityLayoutVersion } from '../../src/world';
import type { NetworkEdge, Vec3 } from '../../src/types';
import { deckWidth } from '../../src/transport-geometry';

export interface DeckClash { a: string; b: string; at: Vec3; dy: number; gap: number }
export function deckClashes(edges: NetworkEdge[], nodes: { id: string; position: Vec3 }[]): DeckClash[] {
  const roads = edges.filter(e => e.mode === 'road' && !e.id.includes('runway')), cell = 20, grid = new Map<string, [NetworkEdge, Vec3][]>();
  const at = new Map(nodes.map(n => [n.id, n.position]));
  for (const e of roads) for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
    for (let s = 0; s <= n; s++) { const t = s / n, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push([e, p]); }
  }
  const found = new Map<string, DeckClash>();
  for (const [key, list] of grid) {
    const [cx, cz] = key.split(',').map(Number), near: [NetworkEdge, Vec3][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) near.push(...(grid.get(`${cx + dx},${cz + dz}`) ?? []));
    for (const [e, p] of list) for (const [f, q] of near) {
      if (e.id >= f.id) continue;
      const gap = Math.hypot(p.x - q.x, p.z - q.z), dy = Math.abs(p.y - q.y);
      if (gap >= (deckWidth(e) + deckWidth(f)) / 2 || dy < .5 || dy > 4.8) continue;
      const shared = [e.from, e.to].filter(id => id === f.from || id === f.to).map(id => at.get(id)!);
      if (shared.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 14)) continue;
      const k = `${e.id}|${f.id}`, old = found.get(k);
      if (!old || dy - gap * .1 > old.dy - old.gap * .1) found.set(k, { a: e.id, b: f.id, at: p, dy, gap });
    }
  }
  return [...found.values()];
}

if (process.argv[1]?.endsWith('deck-clashes.ts')) {
  const layout = (process.argv[2] ?? 'current-v8') as CityLayoutVersion, world = createWorld(20261001, layout), list = deckClashes(world.edges, world.nodes);
  console.log(JSON.stringify({ layout, clashes: list.length, headHeight: list.filter(c => c.dy < 3).length }));
  if (process.argv[3]) for (const c of list.sort((a, b) => a.dy - b.dy)) console.log(c.a, c.b, c.at.x.toFixed(0), c.at.z.toFixed(0), 'dy', c.dy.toFixed(2), 'gap', c.gap.toFixed(1));
}
