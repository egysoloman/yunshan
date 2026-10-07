import { terrainHeight } from './world';
import type { NetworkEdge, Vec3, WorldDefinition } from './types';

export function deckWidth(edge: NetworkEdge): number {
  if (edge.id.includes('airport-runway-strip')) return 44;
  if (edge.mode === 'bridge') return 9;
  if (['maglev', 'lightRail'].includes(edge.mode)) return 6;
  return 10;
}
export function guardrailOffset(edge: NetworkEdge): number {
  if (edge.mode === 'bridge') return 4.1;
  if (['maglev', 'lightRail'].includes(edge.mode)) return 2.75;
  return edge.id.includes('airport-runway-strip') ? 21.75 : 4.75;
}
export const GUARDRAIL_THICKNESS = .2;
export const BRIDGE_OPEN_END = 6;
export const STREET_GUARD_JOIN_VERSION = 'actual-same-grade-deck-joins-within-participating-segments-v2';
const SAME_GRADE_TOLERANCE = .26;
const JOIN_BODY_CLEARANCE = .35;
interface GuardInterval { start: number; end: number }
interface GuardLayout { length: number; lengths: number[]; preceding: number[]; intervals: GuardInterval[] }
interface GuardSegment { edge: NetworkEdge; a: Vec3; b: Vec3; dx: number; dz: number; horizontal: number; length: number; along: number; cells: string[] }
const layouts = new WeakMap<WorldDefinition, { edgeCount: number; joinRevision?: 2; edges: Map<NetworkEdge, GuardLayout> }>();

/** Explicit future geometry edits must invalidate shared renderer/body data. */
export function invalidateTransportGeometry(world: WorldDefinition): void { layouts.delete(world); }

function guardLayouts(world: WorldDefinition): Map<NetworkEdge, GuardLayout> {
  const joinRevision = world.referenceCityRecipe?.streetGuardJoinRevision;
  const cached = layouts.get(world); if (cached?.edgeCount === world.edges.length && cached.joinRevision === joinRevision) return cached.edges;
  const edges = new Map<NetworkEdge, GuardLayout>(), cuts = new Map<NetworkEdge, GuardInterval[]>(), segments: GuardSegment[] = [], grid = new Map<string, number[]>();
  const cellSize = 64;
  for (const edge of world.edges) {
    const lengths = edge.points.slice(1).map((point, index) => Math.hypot(point.x - edge.points[index].x, point.y - edge.points[index].y, point.z - edge.points[index].z));
    let length = 0; const preceding = lengths.map(value => { const start = length; length += value; return start; });
    edges.set(edge, { length, lengths, preceding, intervals: length > BRIDGE_OPEN_END * 2 ? [{ start: BRIDGE_OPEN_END, end: length - BRIDGE_OPEN_END }] : [] });
    if (!['road', 'bridge'].includes(edge.mode) || edge.id.includes('airport-runway-strip')) continue;
    cuts.set(edge, []);
    for (let index = 1; index < edge.points.length; index++) {
      const a = edge.points[index - 1], b = edge.points[index], dx = b.x - a.x, dz = b.z - a.z, horizontal = Math.hypot(dx, dz); if (horizontal < 1e-8) continue;
      const cells: string[] = [], id = segments.length;
      for (let x = Math.floor(Math.min(a.x, b.x) / cellSize); x <= Math.floor(Math.max(a.x, b.x) / cellSize); x++) for (let z = Math.floor(Math.min(a.z, b.z) / cellSize); z <= Math.floor(Math.max(a.z, b.z) / cellSize); z++) { const cell = `${x}:${z}`, entries = grid.get(cell) ?? []; entries.push(id); grid.set(cell, entries); cells.push(cell); }
      segments.push({ edge, a, b, dx, dz, horizontal, length: lengths[index - 1], along: preceding[index - 1], cells });
    }
  }
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index], candidates = new Set(segment.cells.flatMap(cell => grid.get(cell) ?? []));
    for (const candidate of candidates) {
      if (candidate <= index) continue; const other = segments[candidate];
      // Only the new reference recipe opens real same-grade bends of its own
      // polyline. Their intersecting deck footprint needs the same clearance
      // as a join between separate edges. Renderer and body read these exact
      // intervals; old recipes retain their original complete rail spans.
      if (other.edge === segment.edge && joinRevision !== 2) continue;
      const cross = segment.dx * other.dz - segment.dz * other.dx; if (Math.abs(cross) < 1e-8) continue;
      const dx = other.a.x - segment.a.x, dz = other.a.z - segment.a.z;
      const t = (dx * other.dz - dz * other.dx) / cross, u = (dx * segment.dz - dz * segment.dx) / cross;
      if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) continue;
      const y = segment.a.y + (segment.b.y - segment.a.y) * t, otherY = other.a.y + (other.b.y - other.a.y) * u;
      if (Math.abs(y - otherY) > SAME_GRADE_TOLERANCE + 1e-8) continue;
      const sin = Math.abs(cross) / (segment.horizontal * other.horizontal), cos = Math.abs(segment.dx * other.dx + segment.dz * other.dz) / (segment.horizontal * other.horizontal);
      const cut = (current: GuardSegment, crossing: GuardSegment, progress: number) => {
        // Both side rails share an opening large enough for the crossing's
        // real deck and a body, including where an oblique deck meets each side.
        const half = (deckWidth(crossing.edge) / 2 + JOIN_BODY_CLEARANCE + guardrailOffset(current.edge) * cos) / sin * current.length / current.horizontal;
        const center = current.along + current.length * progress;
        const opening = { start: center - half, end: center + half };
        if (joinRevision === 2 && current.edge === crossing.edge) {
          // The intersecting deck belongs to these two physical segments.
          // A shallow-angle bound may otherwise erase rails on later bends
          // of the same edge which do not participate in this junction.
          opening.start = Math.max(opening.start, current.along);
          opening.end = Math.min(opening.end, current.along + current.length);
        }
        cuts.get(current.edge)!.push(opening);
      };
      cut(segment, other, t); cut(other, segment, u);
    }
  }
  for (const [edge, openings] of cuts) {
    const layout = edges.get(edge)!; let intervals = layout.intervals;
    for (const opening of openings) intervals = intervals.flatMap(interval => opening.end <= interval.start || opening.start >= interval.end ? [interval] : [
      ...(opening.start > interval.start ? [{ start: interval.start, end: Math.min(opening.start, interval.end) }] : []),
      ...(opening.end < interval.end ? [{ start: Math.max(opening.end, interval.start), end: interval.end }] : []),
    ]);
    layout.intervals = intervals;
  }
  layouts.set(world, { edgeCount: world.edges.length, joinRevision, edges }); return edges;
}

/** Renderer posts and body collision consume the same closed guard intervals. */
export function hasGuardrailAt(world: WorldDefinition, edge: NetworkEdge, along: number): boolean {
  return guardLayouts(world).get(edge)?.intervals.some(interval => along >= interval.start && along <= interval.end) ?? false;
}

/** Multiple spans are needed when a real same-level street crosses a side rail. */
export function guardrailSpans(world: WorldDefinition, edge: NetworkEdge, segmentIndex: number): { a: Vec3; b: Vec3 }[] {
  const a = edge.points[segmentIndex - 1], b = edge.points[segmentIndex]; if (!a || !b) return [];
  if (!['road', 'bridge'].includes(edge.mode)) return [{ a, b }];
  const layout = guardLayouts(world).get(edge); if (!layout) return [];
  const preceding = layout.preceding[segmentIndex - 1], length = layout.lengths[segmentIndex - 1]; if (length < 1e-8) return [];
  const at = (along: number): Vec3 => { const t = (along - preceding) / length; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; };
  return layout.intervals.flatMap(interval => { const start = Math.max(interval.start, preceding), end = Math.min(interval.end, preceding + length); return end > start + 1e-8 ? [{ a: at(start), b: at(end) }] : []; });
}

/** Closest point includes distance along the real three-dimensional polyline. */
function nearest(edge: NetworkEdge, p: Vec3) {
  let result = { distance: Infinity, y: 0, along: 0, length: 0 }, along = 0;
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const segment = Math.hypot(dx, b.y - a.y, dz), t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const distance = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
    if (distance < result.distance) result = { distance, y: a.y + (b.y - a.y) * t, along: along + segment * t, length: 0 };
    along += segment;
  }
  result.length = along; return result;
}

/** Railings block bodies at deck level; openings at joins let pedestrians enter. */
export function blocksTransportBarrier(world: WorldDefinition, from: Vec3, to: Vec3, bodyRadius = .35): boolean {
  for (const edge of world.edges) {
    if (!['road', 'bridge'].includes(edge.mode) || edge.id.includes('airport-runway-strip')) continue;
    const a = nearest(edge, from); if (a.distance > guardrailOffset(edge) + bodyRadius + 1 || Math.abs(a.y - from.y) > 1.1) continue;
    if (!hasGuardrailAt(world, edge, a.along)) continue;
    if (edge.mode === 'road' && a.y - terrainHeight(world, from.x, from.z) <= 4) continue;
    const b = nearest(edge, to), inner = guardrailOffset(edge) - GUARDRAIL_THICKNESS / 2 - bodyRadius;
    if (a.distance <= inner && b.distance > inner || a.distance >= guardrailOffset(edge) + bodyRadius && b.distance < guardrailOffset(edge) + bodyRadius) return true;
  }
  return false;
}

/** The visible handrail leaves the same six metres open at network joins. */
export function guardrailSegment(edge: NetworkEdge, segmentIndex: number): { a: Vec3; b: Vec3 } | null {
  const a = edge.points[segmentIndex - 1], b = edge.points[segmentIndex];
  if (!a || !b) return null;
  if (!['bridge', 'road'].includes(edge.mode)) return { a, b };
  const lengths = edge.points.slice(1).map((p, i) => Math.hypot(p.x - edge.points[i].x, p.y - edge.points[i].y, p.z - edge.points[i].z));
  const total = lengths.reduce((sum, n) => sum + n, 0), preceding = lengths.slice(0, segmentIndex - 1).reduce((sum, n) => sum + n, 0), length = lengths[segmentIndex - 1];
  const start = Math.max(0, Math.min(1, (BRIDGE_OPEN_END - preceding) / (length || 1)));
  const end = Math.max(0, Math.min(1, (total - BRIDGE_OPEN_END - preceding) / (length || 1)));
  if (end <= start) return null;
  const at = (t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  return { a: at(start), b: at(end) };
}
