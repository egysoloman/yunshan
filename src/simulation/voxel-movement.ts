import { blocksSweptUprightCylinder } from '../geometry/upright-cylinder-sweep';

export interface MovementPoint { x: number; y: number; z: number }
export interface MovementVoxel { readonly position: MovementPoint }

const HALF = .1, RADIUS = .35, HEIGHT = 1.72, FOOT = .01;
const OVERLAP_SQUARED_EPS = 1e-7;
const finitePoint = (p: MovementPoint) => [p.x, p.y, p.z].every(Number.isFinite);
const residual = (value: number, half: number) => value > half ? value - half : value < -half ? value + half : 0;
const squareDistance = (x: number, z: number, half: number) => residual(x, half) ** 2 + residual(z, half) ** 2;

/** Exact existing standing predicate, kept local only to classify each cube.
 * Standing/rest/meal consumers must keep homeRestPointBlockedByVoxels unchanged. */
function standingOverlap(feet: MovementPoint, cube: MovementPoint): boolean {
  if (cube.y + HALF <= feet.y + FOOT || cube.y - HALF >= feet.y + HEIGHT) return false;
  const x = Math.max(Math.abs(cube.x - feet.x) - HALF, 0);
  const z = Math.max(Math.abs(cube.z - feet.z) - HALF, 0);
  return x * x + z * z < RADIUS * RADIUS - OVERLAP_SQUARED_EPS;
}

/** AABB derivative is half the derivative of squared distance. For a convex
 * distance-squared function, a nonnegative initial derivative certifies that
 * the entire straight segment cannot move closer to the AABB. */
function boxDistanceDoesNotDecrease(x: number, z: number, dx: number, dz: number, half: number): boolean {
  const derivative = residual(x, half) * dx + residual(z, half) * dz;
  return Number.isFinite(derivative) && derivative >= 0;
}

function roundoffBudget(from: MovementPoint, cube: MovementPoint): number {
  // Used only for center/active-face degeneracy; never for radial overlap,
  // Y contact, negative outward derivatives, or an endpoint progress margin.
  return Number.EPSILON * 8 * Math.max(1, Math.abs(from.x), Math.abs(from.z), Math.abs(cube.x), Math.abs(cube.z));
}

function startsInsideAndDoesNotCrossCube(x: number, z: number, dx: number, dz: number, ulp: number): boolean {
  // Includes the closed faces/corners: a face must not enter the solid first.
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return true;
  const cx = Math.abs(x) <= ulp ? 0 : x, cz = Math.abs(z) <= ulp ? 0 : z;
  // Extra conservative rule inside the actual solid: no nondegenerate axis
  // may initially approach/cross its center plane. A true center can exit
  // either way. This prevents shallow sideways passage through the cube.
  if (cx * dx < 0 || cz * dz < 0) return false;
  const max = Math.max(Math.abs(cx), Math.abs(cz));
  const active: number[] = [];
  if (max - Math.abs(cx) <= ulp) active.push(cx === 0 ? Math.abs(dx) : Math.sign(cx) * dx);
  if (max - Math.abs(cz) <= ulp) active.push(cz === 0 ? Math.abs(dz) : Math.sign(cz) * dz);
  // M(t)=max(|x(t)|,|z(t)|) is convex. M'(0+)>=0 proves that signed
  // interior depth HALF-M(t) does not grow anywhere in the segment.
  const derivative = Math.max(...active);
  return Number.isFinite(derivative) && derivative >= 0;
}

function canLeaveExistingOverlap(from: MovementPoint, to: MovementPoint, cube: MovementPoint): boolean {
  // No vertical projection/step/gravity exemption for an embedded body.
  if (from.y !== to.y) return false;
  const x = from.x - cube.x, z = from.z - cube.z;
  const endX = to.x - cube.x, endZ = to.z - cube.z;
  const dx = to.x - from.x, dz = to.z - from.z;
  const startRadius = x * x + z * z, endRadius = endX * endX + endZ * endZ;
  if (!Number.isFinite(startRadius) || !Number.isFinite(endRadius) || !(endRadius > startRadius)) return false;
  const ulp = roundoffBudget(from, cube);
  const cx = Math.abs(x) <= ulp ? 0 : x, cz = Math.abs(z) <= ulp ? 0 : z;
  const centerDerivative = cx * dx + cz * dz;
  if (!Number.isFinite(centerDerivative) || centerDerivative < 0) return false;
  if (!boxDistanceDoesNotDecrease(x, z, dx, dz, HALF)) return false;
  // The radius-expanded AABB is a conservative broad phase. Its central
  // zero-distance plateau alone says nothing about outward movement.
  if (!boxDistanceDoesNotDecrease(x, z, dx, dz, HALF + RADIUS)) return false;
  return startsInsideAndDoesNotCrossCube(x, z, dx, dz, ulp);
}

function possibleVerticalOverlap(from: MovementPoint, to: MovementPoint, cube: MovementPoint): boolean {
  // Original exact contact broad phase only. The complete 3D sweep below
  // still correlates its open vertical interval with the actual XZ segment.
  return !(cube.y + HALF <= Math.min(from.y, to.y) + FOOT
    || cube.y - HALF >= Math.max(from.y, to.y) + HEIGHT);
}

function fullSweepHitsCube(from: MovementPoint, to: MovementPoint, cube: MovementPoint): boolean {
  // Only XZ changes coordinate frame. Y and the cube's vertical boundaries
  // remain the original world values, so a clear graded segment is not
  // rejected merely because its XZ and Y projections overlap at other times.
  // Production pure sweep tests the WHOLE segment, without 0.05m sampling.
  return blocksSweptUprightCylinder(
    { x: from.x - cube.x, y: from.y, z: from.z - cube.z },
    { x: to.x - cube.x, y: to.y, z: to.z - cube.z },
    { x0: -HALF, x1: HALF, z0: -HALF, z1: HALF, bottom: cube.y - HALF, top: cube.y + HALF },
    RADIUS, HEIGHT, FOOT);
}

/** Movement-only permission to leave an already intersected placed cube.
 * Every cube is checked independently. It rejects every new overlap along
 * a complete sweep, even when both endpoints are clear or another cube is
 * already intersected. Existing overlaps require horizontal, strictly
 * outward center progress, no decrease in radial clearance, and no deeper
 * entry/passage inside the actual cube. No actor/voxel/cache mutation.
 *
 * This is only the voxel subguard: callers must still run the unchanged
 * walls, support, floor permissions, doors, counters, and road checks.
 * Invalid arithmetic fails closed. No policy/save/runtime fields are added. */
export function blocksVoxelMovement(from: MovementPoint, to: MovementPoint, voxels: readonly MovementVoxel[]): boolean {
  if (!finitePoint(from) || !finitePoint(to)) return true;
  if (![to.x - from.x, to.y - from.y, to.z - from.z].every(Number.isFinite)) return true;
  if (!Number.isFinite((to.x - from.x) ** 2 + (to.z - from.z) ** 2)) return true;
  for (const voxel of voxels) {
    const cube = voxel.position;
    if (!finitePoint(cube)) return true;
    const x = from.x - cube.x, z = from.z - cube.z;
    const endX = to.x - cube.x, endZ = to.z - cube.z;
    if (![x, z, endX, endZ, squareDistance(x, z, HALF), squareDistance(endX, endZ, HALF)].every(Number.isFinite)) return true;
    // Validate the exact frame/arithmetic consumed by the pure sweep, not
    // merely its individual finite inputs. A large cube Y can collapse its
    // ±0.1 box, and finite translated endpoints can overflow delta squared.
    if (!Number.isFinite((endX - x) ** 2 + (endZ - z) ** 2)
      || !Number.isFinite(cube.y - HALF) || !Number.isFinite(cube.y + HALF)
      || !(cube.y - HALF < cube.y + HALF)) return true;
    if (standingOverlap(from, cube)) {
      if (!canLeaveExistingOverlap(from, to, cube)) return true;
      continue;
    }
    if (standingOverlap(to, cube)) return true;
    if (possibleVerticalOverlap(from, to, cube)) {
      try { if (fullSweepHitsCube(from, to, cube)) return true; }
      catch (error) { if (error instanceof RangeError) return true; throw error; }
    }
  }
  return false;
}
