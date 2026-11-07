import type { NetworkEdge, Vec3, WorldDefinition } from '../types';
import { terrainHeight } from '../world';
import { isStreetLayout } from '../street-layouts';

/** Display-only ropeway rope (2026-10-30, street layouts current-v8/v9). A cable edge's path rises point by point
 * over terrain and roofs, and its rope was drawn as that jagged line 9 m above it. Here the rope hangs from the
 * real supports — the edge's two ends and its lattice towers (the network's own tower rule, every
 * CABLE_TOWER_SPACING m where the path stands 6–240 m above the ground) — at CABLE_ROPE.top above the path, and
 * sags between them by CABLE_ROPE.sag of the span (a parabola), never closer than CABLE_ROPE.clearance above the
 * path: a cabin roof is 7.1 m above it and the grip meets the rope 0.4 m below its top line, so the arm is at least 0.4 m long. Cabins stay at their authoritative positions; their grip arm reaches
 * the rope above them. Nothing here enters the simulation. */
export const CABLE_ROPE = { top: 9, sag: .035, clearance: 7.9, sample: 6, towerSpacing: 120 } as const;
/** The grip arm meets the rope this far below the rope's top line (the old fixed rope was 9 m, the arm 8.6 m). */
export const CABLE_ROPE_GRIP = .4;

interface Profile { edge: NetworkEdge; cumulative: number[]; supports: { along: number; y: number }[]; total: number }
const cache = new WeakMap<WorldDefinition, Map<string, Profile | null>>();

/** Horizontal distance along the edge to each of its points. */
function cumulativeOf(edge: NetworkEdge) {
  const out = [0]; for (let i = 1; i < edge.points.length; i++) out.push(out[i - 1] + Math.hypot(edge.points[i].x - edge.points[i - 1].x, edge.points[i].z - edge.points[i - 1].z)); return out;
}
function profileOf(world: WorldDefinition, edgeId: string): Profile | null {
  let byEdge = cache.get(world); if (!byEdge) { byEdge = new Map(); cache.set(world, byEdge); }
  if (byEdge.has(edgeId)) return byEdge.get(edgeId)!;
  const edge = world.edges.find(e => e.id === edgeId);
  if (!edge || edge.mode !== 'cable' || edge.points.length < 2 || !isStreetLayout((world as WorldDefinition & { layoutVersion?: string }).layoutVersion)) { byEdge.set(edgeId, null); return null; }
  const cumulative = cumulativeOf(edge), supports = [{ along: 0, y: edge.points[0].y + CABLE_ROPE.top }];
  // The same towers as emitNetworkStructures: every CABLE_TOWER_SPACING m carried across the edge's segments.
  let remainder = 0;
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i], length = cumulative[i] - cumulative[i - 1];
    for (let along = CABLE_ROPE.towerSpacing - remainder; along <= length; along += CABLE_ROPE.towerSpacing) {
      const t = along / Math.max(.01, length), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, top = a.y + (b.y - a.y) * t + CABLE_ROPE.top, tall = top - terrainHeight(world, x, z);
      if (tall > 6 && tall < 240) supports.push({ along: cumulative[i - 1] + along, y: top });
    }
    remainder = (remainder + length) % CABLE_ROPE.towerSpacing;
  }
  const total = cumulative.at(-1)!; supports.push({ along: total, y: edge.points.at(-1)!.y + CABLE_ROPE.top });
  const profile = { edge, cumulative, supports, total }; byEdge.set(edgeId, profile); return profile;
}
function pathY(profile: Profile, along: number) {
  const { edge, cumulative } = profile; let i = 1; while (i < cumulative.length - 1 && cumulative[i] < along) i++;
  const span = cumulative[i] - cumulative[i - 1], t = span > 0 ? Math.min(1, Math.max(0, (along - cumulative[i - 1]) / span)) : 0;
  return edge.points[i - 1].y + (edge.points[i].y - edge.points[i - 1].y) * t;
}
function ropeY(profile: Profile, along: number) {
  const { supports } = profile; let k = 1; while (k < supports.length - 1 && supports[k].along < along) k++;
  const a = supports[k - 1], b = supports[k], span = b.along - a.along, u = span > 0 ? Math.min(1, Math.max(0, (along - a.along) / span)) : 0;
  return Math.max(pathY(profile, along) + CABLE_ROPE.clearance, a.y + (b.y - a.y) * u - CABLE_ROPE.sag * span * 4 * u * (1 - u));
}

/** The rope's top line as points every CABLE_ROPE.sample m (and at every support), or null when the layout keeps the plain rope. */
export function cableRopeLine(world: WorldDefinition, edgeId: string): Vec3[] | null {
  const profile = profileOf(world, edgeId); if (!profile) return null;
  const { edge, cumulative, total } = profile, marks = new Set<number>([...profile.supports.map(s => s.along)]);
  for (let along = 0; along < total; along += CABLE_ROPE.sample) marks.add(along);
  return [...marks].sort((a, b) => a - b).map(along => {
    let i = 1; while (i < cumulative.length - 1 && cumulative[i] < along) i++;
    const span = cumulative[i] - cumulative[i - 1], t = span > 0 ? Math.min(1, Math.max(0, (along - cumulative[i - 1]) / span)) : 0, a = edge.points[i - 1], b = edge.points[i];
    return { x: a.x + (b.x - a.x) * t, y: ropeY(profile, along), z: a.z + (b.z - a.z) * t };
  });
}

/** The rope's top height above a point on a cable edge (its nearest place along the edge), or null without a hung rope. */
export function cableRopeHeightAt(world: WorldDefinition, edgeId: string, position: Vec3): number | null {
  const profile = profileOf(world, edgeId); if (!profile) return null;
  const { edge, cumulative } = profile; let best = { d: Infinity, along: 0 };
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i], dx = b.x - a.x, dz = b.z - a.z, n = dx * dx + dz * dz, t = n > 0 ? Math.min(1, Math.max(0, ((position.x - a.x) * dx + (position.z - a.z) * dz) / n)) : 0;
    const d = Math.hypot(position.x - a.x - dx * t, position.z - a.z - dz * t); if (d < best.d) best = { d, along: cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t };
  }
  return ropeY(profile, best.along);
}

/** A cabin's grip arm (the cable shape's trim, from its roof up) stretched to the hung rope above the cabin at
 * height `rope`: the arm's centre and height relative to the cabin position (y), keeping its foot on the roof. */
export function cableGripArm(trim: { y: number; height: number }, y: number, rope: number): { y: number; height: number } {
  const foot = trim.y - trim.height / 2, top = rope - CABLE_ROPE_GRIP - y;
  return { y: (foot + top) / 2, height: Math.max(.1, top - foot) };
}
