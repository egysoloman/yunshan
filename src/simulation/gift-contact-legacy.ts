import { canAccessFloor, getFloorDimensions } from '../access';
import { blocksSweptUprightCylinder } from '../geometry/upright-cylinder-sweep';
import type { Building, Player, Vec3, WorldDefinition } from '../types';
import { getWalkHeight } from '../world';

const BODY_RADIUS = .35;
const BODY_HEIGHT = 1.72;
const SUPPORT_TOLERANCE = .26;
const EPS = 1e-7;
const finitePoint = (point: Vec3): boolean => [point.x, point.y, point.z].every(Number.isFinite);

function validBuilding(building: Building): boolean {
  return finitePoint(building.position) && finitePoint(building.door)
    && [building.width, building.depth, building.height].every(value => Number.isFinite(value) && value > 0)
    && Number.isSafeInteger(building.floors) && building.floors > 0
    && Number.isSafeInteger(building.basements ?? 0) && (building.basements ?? 0) >= 0
    && Number.isFinite(building.height / building.floors) && building.height / building.floors > 0;
}

function dimensions(building: Building, floor: number): { width: number; depth: number } | null {
  const size = getFloorDimensions(building, floor);
  return [size.width, size.depth].every(value => Number.isFinite(value) && value > 0) ? size : null;
}

function insideFootprint(building: Building, point: Vec3, floor: number): boolean {
  const size = dimensions(building, floor);
  // Legacy walking uses axis-aligned footprints even when rotation is present.
  return !!size && Math.abs(point.x - building.position.x) < size.width / 2 - BODY_RADIUS
    && Math.abs(point.z - building.position.z) < size.depth / 2 - BODY_RADIUS;
}

/** Geometric centre ownership without ACL/body admission. A denied interior
 * must not become outdoor terrain merely because full presence returns null. */
export function legacyGiftFloorAt(building: Building, point: Vec3): number | null {
  if (!finitePoint(point) || !validBuilding(building)) return null;
  const storey = building.height / building.floors, base = building.position.y + .6;
  const floor = Math.round((point.y - base) / storey), y = base + floor * storey;
  if (!Number.isSafeInteger(floor) || floor < -(building.basements ?? 0) || floor >= building.floors
    || !Number.isFinite(y) || Math.abs(point.y - y) > SUPPORT_TOLERANCE) return null;
  const size = dimensions(building, floor);
  return size && Math.abs(point.x - building.position.x) <= size.width / 2 + EPS
    && Math.abs(point.z - building.position.z) <= size.depth / 2 + EPS ? floor : null;
}

/** A bodyless building keeps its original axis-aligned walking floor and ACL.
 * This is an interior standing pose, not an exterior door-radius admission. */
export function legacyGiftPresence(building: Building, point: Vec3, person: Pick<Player, 'role' | 'identities'>): { floor: number; y: number } | null {
  if (!finitePoint(point) || !validBuilding(building)) return null;
  const storey = building.height / building.floors, base = building.position.y + .6;
  const floor = legacyGiftFloorAt(building, point); if (floor === null) return null;
  const y = base + floor * storey;
  if (!canAccessFloor(building, floor, person)
    || point.y + BODY_HEIGHT > y + storey + EPS || !insideFootprint(building, point, floor)
    || blocksLegacyGiftSegment(building, point, point)) return null;
  return { floor, y };
}

/** The original open south ground door may share the complete foot disk with
 * the existing exterior walking plane; it does not open any other wall/layer. */
export function legacyGiftDoorPresence(world: WorldDefinition, building: Building, point: Vec3, person: Pick<Player, 'role' | 'identities'>): { floor: 0; y: number } | null {
  if (!finitePoint(point) || !validBuilding(building) || building.kind === 'pavilion' || !canAccessFloor(building, 0, person)) return null;
  const size = dimensions(building, 0); if (!size) return null;
  const y = building.position.y + .6, south = building.position.z + size.depth / 2;
  const halfDoor = Math.max(1.5, Math.min(2.7, building.width * .1));
  if (Math.abs(building.door.y - y) > EPS || Math.abs(building.door.z - south) > EPS
    || building.door.x - halfDoor <= building.position.x - size.width / 2 || building.door.x + halfDoor >= building.position.x + size.width / 2
    || Math.abs(point.y - y) > SUPPORT_TOLERANCE || Math.abs(point.z - south) > BODY_RADIUS + EPS
    || Math.abs(point.x - building.door.x) >= halfDoor || Math.abs(point.x - building.position.x) >= size.width / 2 - BODY_RADIUS
    || point.y + BODY_HEIGHT > y + building.height / building.floors + EPS) return null;
  if (point.z > south + EPS) {
    const centerHeight = getWalkHeight(world, point.x, point.z, point.y);
    if (!Number.isFinite(centerHeight) || Math.abs(centerHeight - point.y) > SUPPORT_TOLERANCE) return null;
  }
  const inside = { x: point.x, y, z: south - BODY_RADIUS }, outside = { x: point.x, y, z: south + BODY_RADIUS };
  if (blocksLegacyGiftSegment(building, point, point) || blocksLegacyGiftSegment(building, inside, point) || blocksLegacyGiftSegment(building, point, outside)) return null;
  // The interior portion is the original solid legacy ground rectangle.
  // Audit every .2m exterior terrain column touched by the remaining disk.
  for (let ix = Math.floor((point.x - BODY_RADIUS) / .2); ix <= Math.floor((point.x + BODY_RADIUS) / .2); ix++) for (let iz = Math.floor((point.z - BODY_RADIUS) / .2); iz <= Math.floor((point.z + BODY_RADIUS) / .2); iz++) {
    const x = ix * .2, z = iz * .2;
    if (Math.max(x - point.x, 0, point.x - x - .2) ** 2 + Math.max(z - point.z, 0, point.z - z - .2) ** 2 > BODY_RADIUS ** 2 + EPS) continue;
    for (const [sx, sz] of [[x, z], [x + .2, z], [x, z + .2], [x + .2, z + .2], [x + .1, z + .1]]) if (sz > south + EPS) {
      const height = getWalkHeight(world, sx, sz, y);
      if (!Number.isFinite(height) || Math.abs(height - y) > 2.6 + EPS) return null;
    }
  }
  return { floor: 0, y };
}

/** Complete contact barrier for the old axis walls. Only the original south
 * ground entrance is open. Pavilions have no enclosing wall contract. */
export function blocksLegacyGiftSegment(building: Building, from: Vec3, to: Vec3): boolean {
  if (!finitePoint(from) || !finitePoint(to) || !validBuilding(building)) return true;
  if (!Number.isFinite((to.x - from.x) ** 2 + (to.z - from.z) ** 2) || !Number.isFinite(to.y - from.y)) return true;
  if (building.kind === 'pavilion') return false;
  const storey = building.height / building.floors, base = building.position.y + .6;
  const fromFloor = Math.round((from.y - base) / storey), toFloor = Math.round((to.y - base) / storey);
  if (!Number.isFinite(base) || !Number.isSafeInteger(fromFloor) || !Number.isSafeInteger(toFloor)) return true;
  // Legacy floor changes use the existing stair action, not an open vertical
  // segment through overlapping storeys. Do not invent a gift-only shaft.
  if (fromFloor !== toFloor && insideFootprint(building, from, fromFloor) && insideFootprint(building, to, toFloor)) return true;
  const low = Math.max(-(building.basements ?? 0), Math.floor((Math.min(from.y, to.y) - base) / storey));
  const high = Math.min(building.floors - 1, Math.floor((Math.max(from.y, to.y) + BODY_HEIGHT - base) / storey));
  for (let floor = low; floor <= high; floor++) {
    const size = dimensions(building, floor); if (!size) return true;
    const x0 = building.position.x - size.width / 2, x1 = building.position.x + size.width / 2;
    const z0 = building.position.z - size.depth / 2, z1 = building.position.z + size.depth / 2;
    const bottom = base + floor * storey, top = bottom + storey;
    if (![x0, x1, z0, z1, bottom, top].every(Number.isFinite)) return true;
    // .7 / 1 are the controller's forbidden centre bands. Subtract the same
    // body's radius from each box so a sweep does not widen those bands again.
    const sideHalf = .7 - BODY_RADIUS, southHalf = 1 - BODY_RADIUS;
    const blocked = (left: number, right: number, near: number, far: number): boolean =>
      left < right && near < far && blocksSweptUprightCylinder(from, to, { x0: left, x1: right, z0: near, z1: far, bottom, top }, BODY_RADIUS, BODY_HEIGHT, .01);
    if (blocked(x0 - sideHalf, x0 + sideHalf, z0, z1)
      || blocked(x1 - sideHalf, x1 + sideHalf, z0, z1)
      || blocked(x0, x1, z0 - sideHalf, z0 + sideHalf)) return true;
    const halfDoor = Math.max(1.5, Math.min(2.7, building.width * .1));
    const realGroundDoor = floor === 0 && Math.abs(building.door.y - base) <= EPS
      && Math.abs(building.door.z - z1) <= EPS && building.door.x - halfDoor > x0 && building.door.x + halfDoor < x1;
    if (!realGroundDoor) {
      if (blocked(x0, x1, z1 - southHalf, z1 + southHalf)) return true;
    } else {
      // Opening is an old centre-path width; expand the empty box interval by
      // radius to preserve it when the continuous full-body test is applied.
      const left = building.door.x - halfDoor - BODY_RADIUS, right = building.door.x + halfDoor + BODY_RADIUS;
      if (blocked(x0, left, z1 - southHalf, z1 + southHalf)
        || blocked(right, x1, z1 - southHalf, z1 + southHalf)) return true;
    }
  }
  return false;
}
