/** Ground road crossings that share no graph node (docs/设计/路网重做方案.md §2, §3.2 D).
 *   npx tsx scripts/roads/crossings.ts [layout] */
import { createWorld, type CityLayoutVersion } from '../../src/world';
import type { NetworkEdge, Vec3 } from '../../src/types';

export interface RoadCrossing { a: string; b: string; at: { x: number; z: number }; dy: number }
export function roadCrossings(edges: NetworkEdge[]): RoadCrossing[] {
  const roads = edges.filter(e => e.mode === 'road' && !e.id.includes('runway')), cell = 40, grid = new Map<string, [NetworkEdge, number][]>();
  for (const e of roads) for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i];
    for (let x = Math.floor(Math.min(a.x, b.x) / cell); x <= Math.floor(Math.max(a.x, b.x) / cell); x++) for (let z = Math.floor(Math.min(a.z, b.z) / cell); z <= Math.floor(Math.max(a.z, b.z) / cell); z++) (grid.get(`${x},${z}`) ?? grid.set(`${x},${z}`, []).get(`${x},${z}`)!).push([e, i]);
  }
  const found = new Map<string, RoadCrossing>();
  for (const list of grid.values()) for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
    const [e, i] = list[p], [f, j] = list[q];
    if (e === f || e.from === f.from || e.from === f.to || e.to === f.from || e.to === f.to) continue;
    const a = e.points[i - 1], b = e.points[i], c = f.points[j - 1], d = f.points[j];
    const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x); if (Math.abs(den) < 1e-9) continue;
    const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den, u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) continue;
    const key = [e.id, f.id].sort().join('|'); if (found.has(key)) continue;
    const y1 = a.y + (b.y - a.y) * t, y2 = c.y + (d.y - c.y) * u;
    found.set(key, { a: e.id, b: f.id, at: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dy: Math.abs(y1 - y2) });
  }
  return [...found.values()];
}

if (process.argv[1]?.endsWith('crossings.ts')) {
  const layout = (process.argv[2] ?? 'current-v8') as CityLayoutVersion, world = createWorld(20261001, layout), list = roadCrossings(world.edges);
  const door = (id: string) => id.includes('-door-');
  console.log(JSON.stringify({ layout, crossings: list.length, withDoorStub: list.filter(c => door(c.a) || door(c.b)).length, bothNonDoor: list.filter(c => !door(c.a) && !door(c.b)).length, level: list.filter(c => c.dy <= .26).length, ambiguous: list.filter(c => c.dy > .26 && c.dy < 4.8).length, separated: list.filter(c => c.dy >= 4.8).length }));
}
