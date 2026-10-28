// Read-only sweep: for every road edge a disaster could close (eligible, near the
// river), close it alone and check whether ordinary traffic on the other edges
// can still pass, with the simulation's own movement rule (lane position to the
// centreline point ahead) and the walker rule (route polyline segments).
// Usage: node --import tsx scripts/perf/closure-sweep.ts [--declared]  (--declared: a closure-traffic-v1 city)
import { createProductWorld } from '../../src/product-city';
import { roadMovementAllowed, type RoadNetworkState } from '../../src/roads';
import { CLOSURE_TRAFFIC_POLICY, closureTestsVehicle } from '../../src/simulation/closure-traffic';
import type { NetworkEdge, Vec3 } from '../../src/types';

const world = createProductWorld();
const policy = process.argv.includes('--declared') ? CLOSURE_TRAFFIC_POLICY : undefined;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function pointOn(edge: NetworkEdge, progress: number): Vec3 {
  const points = edge.points; let total = 0; for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  let remaining = Math.min(1, Math.max(0, progress)) * total;
  for (let i = 1; i < points.length; i++) { const length = distance(points[i - 1], points[i]); if (remaining <= length || i === points.length - 1) { const t = length ? Math.min(1, Math.max(0, remaining / length)) : 0; return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t, z: points[i - 1].z + (points[i].z - points[i - 1].z) * t }; } remaining -= length; }
  return { ...points[0] };
}
function lane(edge: NetworkEdge, progress: number, direction: 1 | -1): Vec3 {
  const p = pointOn(edge, progress), front = pointOn(edge, Math.min(1, progress + .001)), back = pointOn(edge, Math.max(0, progress - .001));
  const dx = front.x - back.x, dz = front.z - back.z, length = Math.hypot(dx, dz);
  if (length > .001) { p.x -= dz / length * direction * 1.3; p.z += dx / length * direction * 1.3; }
  return p;
}
// Same candidate rule as closeRoadFromDisaster: road/bridge, not the runway, within 80 m of the river.
const eligible = (e: NetworkEdge) => ['road', 'bridge'].includes(e.mode) && !e.id.includes('airport-runway-strip');
function segmentDistanceXZ(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const ps = (p: Vec3, s: Vec3, t: Vec3) => { const dx = t.x - s.x, dz = t.z - s.z, n = dx * dx + dz * dz, u = n === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.z - s.z) * dz) / n)); return Math.hypot(p.x - s.x - dx * u, p.z - s.z - dz * u); };
  const ax = b.x - a.x, az = b.z - a.z, cx = d.x - c.x, cz = d.z - c.z, den = ax * cz - az * cx;
  if (den !== 0) { const dx = c.x - a.x, dz = c.z - a.z, t = (dx * cz - dz * cx) / den, u = (dx * az - dz * ax) / den; if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0; }
  return Math.min(ps(a, c, d), ps(b, c, d), ps(c, a, b), ps(d, a, b));
}
const flood = (e: NetworkEdge) => { let best = Infinity; for (let i = 1; i < e.points.length; i++) for (let j = 1; j < world.river.length; j++) best = Math.min(best, segmentDistanceXZ(e.points[i - 1], e.points[i], world.river[j - 1], world.river[j])); return best; };
const candidates = world.edges.filter(e => eligible(e) && flood(e) <= 80).sort((a, b) => flood(a) - flood(b) || a.id.localeCompare(b.id));
const byNode = new Map<string, NetworkEdge[]>(); for (const e of world.edges) for (const id of [e.from, e.to]) { const list = byNode.get(id) ?? []; list.push(e); byNode.set(id, list); }
const roads = world.edges.filter(e => e.mode === 'road');

let jams = 0, walks = 0;
for (const closed of candidates) {
  const network: RoadNetworkState = { version: 1, activatedAt: 0, revision: 1, nextClosureId: 2, permits: {}, closures: [{ id: 'sweep', edgeId: closed.id, sourceEventId: 1, districtId: world.nodes.find(n => n.id === closed.from)!.districtId, occurredAt: 0, severity: 1, closedRevision: 1, worksiteNodeId: closed.from, worksite: { ...world.nodes.find(n => n.id === closed.from)!.position }, reopenedAt: null, repairedBy: null, reopenedRevision: null, occupants: [] }] };
  const state = { roadNetwork: network };
  // The traffic phase's own gate: the swept test applies only when closureTestsVehicle says so.
  const vehicleMay = (edge: NetworkEdge, from: Vec3, to: Vec3) => !closureTestsVehicle(policy, edge.id !== closed.id) || roadMovementAllowed(world, state, 'vehicle:sweep', from, to);
  const blocked: string[] = [];
  for (const edge of roads) {
    if (edge.id === closed.id) continue;
    const length = Math.max(1, edge.length), step = Math.min(.05, 2 / length);
    for (const direction of [1, -1] as const) {
      const start = direction > 0 ? 0 : 1, end = direction > 0 ? 1 : 0;
      for (let p = start; direction > 0 ? p < 1 : p > 0; p += direction * step) {
        const next = direction > 0 ? Math.min(1, p + step) : Math.max(0, p - step);
        if (!vehicleMay(edge, lane(edge, p, direction), pointOn(edge, next))) { blocked.push(`${edge.id} dir${direction} at ${(p * length).toFixed(0)}m`); break; }
      }
      const at = lane(edge, end, direction), nodeId = direction > 0 ? edge.to : edge.from;
      if (!vehicleMay(edge, at, pointOn(edge, end))) blocked.push(`${edge.id} dir${direction} waiting at ${nodeId}`);
      for (const out of (byNode.get(nodeId) ?? []).filter(o => o.mode === 'road' && o.id !== edge.id && o.id !== closed.id)) {
        const outward = out.from === nodeId ? 1 : -1, first = outward > 0 ? Math.min(1, 2 / Math.max(1, out.length)) : Math.max(0, 1 - 2 / Math.max(1, out.length));
        if (!vehicleMay(out, at, pointOn(out, first))) blocked.push(`${edge.id} dir${direction} turning into ${out.id} at ${nodeId}`);
      }
    }
  }
  const walkBlocked: string[] = [];
  for (const edge of world.edges.filter(e => ['road', 'bridge'].includes(e.mode) && e.id !== closed.id))
    for (let i = 1; i < edge.points.length; i++) if (!roadMovementAllowed(world, state, 'walker:sweep', edge.points[i - 1], edge.points[i])) { walkBlocked.push(`${edge.id} segment ${i}`); break; }
  if (blocked.length || walkBlocked.length) console.log(`closed ${closed.id} (river ${flood(closed).toFixed(0)} m): vehicles blocked ${blocked.length}${blocked.length ? ' — ' + blocked.slice(0, 6).join('; ') : ''}${walkBlocked.length ? ` | walkers blocked ${walkBlocked.length} — ${walkBlocked.slice(0, 4).join('; ')}` : ''}`);
  jams += blocked.length ? 1 : 0; walks += walkBlocked.length ? 1 : 0;
}
console.log(`${candidates.length} closable edges near the river; ${jams} would stop vehicles on another open road, ${walks} would stop walkers on another open path (${policy ?? 'undeclared city'}).`);
