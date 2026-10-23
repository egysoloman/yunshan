import type { Building, Vec3, WorldDefinition } from '../types';
import { samplePolyline } from '../world';
import { lanternStrings, terraceLanternStrings } from './lantern-strings';

/** Where the arrival camera looks (display only). A first view straight at the
 * nearest shop door showed only a doorway at 15 m. Of 16 compass headings the
 * player faces the one scoring most: two points per market shop door 25–80 m away
 * inside a ±VIEW_CONE cone, and one per string lantern 12–90 m away inside the
 * middle ±LANTERN_CONE (2026-10-22: the reference town greets with lantern-hung
 * streets; the market spawn now looks down a lantern gate toward the terraces).
 * Never a heading with a building body within 8 m inside it (a wall filling the
 * screen), nor one where a road vehicle of the generated fleet waits within 10 m
 * at the start (vehicles start at progress 0, and 0.5 for the second, until 08:00),
 * nor one with a lantern-string pole within POLE_NEAR m in the middle ±POLE_CONE
 * (the market arrival faced a pole 13 m away in the centre of the screen). */
export const VIEW_CONE = 30 * Math.PI / 180;
export const POLE_NEAR = 16, POLE_CONE = 12 * Math.PI / 180, LANTERN_CONE = 15 * Math.PI / 180;
/** Close blockers are checked across the whole visible width (about ±37° at 1280×800). */
export const NEAR_CONE = 40 * Math.PI / 180;

/** Points along each generated road vehicle's waiting body (±3 m of its start, along its road). */
export function fleetStarts(world: Pick<WorldDefinition, 'edges' | 'fleetPlan'>): Vec3[] {
  const edges = new Map(world.edges.map(e => [e.id, e]));
  return (world.fleetPlan ?? []).flatMap(row => {
    const e = edges.get(row.edgeId); if (!e || e.length <= 0) return [];
    const length = e.points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - e.points[i].x, p.z - e.points[i].z), 0) || 1;
    return Array.from({ length: row.vehicles }, (_, i) => i / row.vehicles).flatMap(t => [-3, -2, -1, 0, 1, 2, 3].map(m => samplePolyline(e.points, Math.max(0, Math.min(1, t + m / length)))));
  });
}

export function arrivalLook(world: Pick<WorldDefinition, 'buildings' | 'edges' | 'fleetPlan'> & Partial<Pick<WorldDefinition, 'nodes'>>, spawn: Vec3, districtId = 'market'): Vec3 {
  const vehicles = fleetStarts(world).filter(p => Math.hypot(p.x - spawn.x, p.z - spawn.z) < 10);
  const full = world as WorldDefinition, strings = world.nodes ? [...lanternStrings(full), ...terraceLanternStrings(full)] : [];
  const poles = strings.flatMap(s => s.poles).filter(p => Math.hypot(p.x - spawn.x, p.z - spawn.z) < POLE_NEAR);
  const lanterns = strings.flatMap(s => s.lanterns).filter(p => { const d = Math.hypot(p.x - spawn.x, p.z - spawn.z); return d >= 12 && d <= 90; });
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  let best: { heading: number; score: number } | null = null;
  for (let k = 0; k < 16; k++) {
    const heading = k / 16 * Math.PI * 2;
    const inCone = (p: { x: number; z: number }, cone = VIEW_CONE) => Math.abs(wrap(Math.atan2(p.z - spawn.z, p.x - spawn.x) - heading)) <= cone;
    const corners = (b: Building) => [b.position, ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([u, v]) => ({ x: b.position.x + u * b.width / 2, z: b.position.z + v * b.depth / 2 }))];
    if (world.buildings.some((b: Building) => Math.hypot(b.position.x - spawn.x, b.position.z - spawn.z) - Math.max(b.width, b.depth) / 2 < 8 && corners(b).some(p => inCone(p, NEAR_CONE))) || vehicles.some(p => inCone(p, NEAR_CONE)) || poles.some(p => inCone(p, POLE_CONE))) continue;
    const doors = world.buildings.filter(b => b.kind === 'market' && b.districtId === districtId && inCone(b.door) && Math.hypot(b.door.x - spawn.x, b.door.z - spawn.z) >= 25 && Math.hypot(b.door.x - spawn.x, b.door.z - spawn.z) <= 80).length;
    const score = doors * 2 + lanterns.filter(p => inCone(p, LANTERN_CONE)).length;
    if (!best || score > best.score) best = { heading, score };
  }
  const heading = best?.heading ?? -Math.PI / 2;
  return { x: spawn.x + Math.cos(heading) * 60, y: spawn.y + 6, z: spawn.z + Math.sin(heading) * 60 };
}
