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
    if (a.along < BRIDGE_OPEN_END || a.length - a.along < BRIDGE_OPEN_END) continue;
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
