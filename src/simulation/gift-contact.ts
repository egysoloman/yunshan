import { canAccessFloor } from '../access';
import { boundaryLoops, blocksFloorPlanReferenceMovement, buildingLocalPosition, buildingWorldPosition, containsUnion, floorPlanSupport, getBuildingBody, getBuildingEntrance, getBuildingFloorPlan, getFloorPlanRoofRegions, getFloorPlanRoofSupport, getFloorPlanSlabRegions, type FloorPlan, type FloorSupport } from '../architecture-floor-plan';
import { blocksSweptUprightCylinder } from '../geometry/upright-cylinder-sweep';
import { marketCounters } from '../site-fixtures';
import type { Building, Player, Vec3, WorldDefinition } from '../types';
import { getWalkHeight } from '../world';
import { blocksLegacyGiftSegment, legacyGiftDoorPresence, legacyGiftFloorAt, legacyGiftPresence } from './gift-contact-legacy';

type ContactActor = Pick<Player, 'position' | 'role' | 'identities'>;
interface Presence { building?: Building; floor: number; indoor: boolean }
const RADIUS = .35, HEIGHT = 1.72, EPS = 1e-7, FEET_TOLERANCE = .26;
export const GIFT_CONTACT_METRES = 2;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finitePosition = (world: WorldDefinition, p: Vec3) => {
  const limit = Math.max(10000, world.size * 3);
  return !!p && [p.x, p.y, p.z].every(Number.isFinite) && Math.abs(p.x) <= limit && Math.abs(p.z) <= limit && p.y >= -1000 && p.y <= limit;
};
const nearby = (b: Building, p: Vec3) => {
  const local = buildingLocalPosition(b, p);
  return Math.abs(local.x) <= b.width / 2 + 2 && Math.abs(local.z) <= b.depth / 2 + 2;
};

/** Same open ground slab/terrain union used by Controller.groundEdgeSupport.
 * The audited exterior columns never supply an interior shaft or upper void. */
function groundEdgeSupport(world: WorldDefinition, b: Building, plan: FloorPlan, point: Vec3, center: FloorSupport | null): FloorSupport | null {
  if (plan.floor !== 0 || !center) return null;
  const local = buildingLocalPosition(b, point), stone = getFloorPlanSlabRegions(plan);
  const entrance = buildingLocalPosition(b, getBuildingEntrance(b)), opening = plan.walls.find(wall => wall.opening?.use === 'entrance')?.opening;
  const doorEdge = !!opening && Math.abs(local.z - entrance.z) <= RADIUS + .21 && Math.abs(local.x - entrance.x) < (opening.to - opening.from) / 2 - RADIUS;
  if (!['courtyard', 'gallery'].includes(center.kind) && !(center.kind === 'room' && doorEdge)) return null;
  const x0 = Math.min(...stone.map(r => r.x0)), x1 = Math.max(...stone.map(r => r.x1)), z0 = Math.min(...stone.map(r => r.z0)), z1 = Math.max(...stone.map(r => r.z1));
  if (Math.min(local.x - x0, x1 - local.x, local.z - z0, z1 - local.z) >= RADIUS) return null;
  const outside = (x: number, z: number) => x < x0 - EPS || x > x1 + EPS || z < z0 - EPS || z > z1 + EPS;
  for (let ix = Math.floor((local.x - RADIUS) / .2); ix <= Math.floor((local.x + RADIUS) / .2); ix++) for (let iz = Math.floor((local.z - RADIUS) / .2); iz <= Math.floor((local.z + RADIUS) / .2); iz++) {
    const cx = ix * .2, cz = iz * .2;
    if (Math.max(cx - local.x, 0, local.x - cx - .2) ** 2 + Math.max(cz - local.z, 0, local.z - cz - .2) ** 2 > RADIUS ** 2 + EPS) continue;
    for (const [x, z] of [[cx, cz], [cx + .2, cz], [cx, cz + .2], [cx + .2, cz + .2], [cx + .1, cz + .1]]) if (outside(x, z)) {
      const at = buildingWorldPosition(b, { x, y: plan.y, z }), height = getWalkHeight(world, at.x, at.z, center.y);
      if (!Number.isFinite(height) || Math.abs(height - center.y) > 2.6 + EPS) return null;
    }
  }
  const range = .6, loX = local.x - range, hiX = local.x + range, loZ = local.z - range, hiZ = local.z + range;
  const terrain = [{ x0: loX, x1: x0, z0: loZ, z1: hiZ }, { x0: x1, x1: hiX, z0: loZ, z1: hiZ }, { x0: loX, x1: hiX, z0: loZ, z1: z0 }, { x0: loX, x1: hiX, z0: z1, z1: hiZ }].filter(r => r.x1 > r.x0 && r.z1 > r.z0);
  for (const loop of boundaryLoops([...stone, ...terrain])) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], to = loop[(i + 1) % loop.length], dx = to[0] - a[0], dz = to[1] - a[1], t = Math.max(0, Math.min(1, ((local.x - a[0]) * dx + (local.z - a[1]) * dz) / (dx * dx + dz * dz)));
    if ((local.x - a[0] - t * dx) ** 2 + (local.z - a[1] - t * dz) ** 2 < RADIUS ** 2 - EPS) return null;
  }
  return center;
}

/** Outdoor feet stay on the existing walking surface. Audit the complete .2m
 * terrain columns touched by the disk, using the controller's 2.6m cliff bound. */
function outdoorSupported(world: WorldDefinition, point: Vec3): boolean {
  const center = getWalkHeight(world, point.x, point.z, point.y);
  if (!Number.isFinite(center) || Math.abs(center - point.y) > FEET_TOLERANCE) return false;
  for (let ix = Math.floor((point.x - RADIUS) / .2); ix <= Math.floor((point.x + RADIUS) / .2); ix++) for (let iz = Math.floor((point.z - RADIUS) / .2); iz <= Math.floor((point.z + RADIUS) / .2); iz++) {
    const x = ix * .2, z = iz * .2;
    if (Math.max(x - point.x, 0, point.x - x - .2) ** 2 + Math.max(z - point.z, 0, point.z - z - .2) ** 2 > RADIUS ** 2 + EPS) continue;
    for (const [sx, sz] of [[x, z], [x + .2, z], [x, z + .2], [x + .2, z + .2], [x + .1, z + .1]]) {
      const height = getWalkHeight(world, sx, sz, point.y);
      if (!Number.isFinite(height) || Math.abs(height - center) > 2.6 + EPS) return false;
    }
  }
  return true;
}

function roofDiskSupported(b: Building, point: Vec3, support: FloorSupport): boolean {
  const local = buildingLocalPosition(b, point);
  const regions = getFloorPlanRoofRegions(getBuildingBody(b)!).filter(roof => roof.floor === support.floor && roof.bottom <= local.y + EPS && roof.top >= local.y - .42 - EPS).map(roof => roof.rect);
  if (!containsUnion(regions, local.x, local.z)) return false;
  for (const loop of boundaryLoops(regions)) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], z = loop[(i + 1) % loop.length], dx = z[0] - a[0], dz = z[1] - a[1];
    const t = Math.max(0, Math.min(1, ((local.x - a[0]) * dx + (local.z - a[1]) * dz) / (dx * dx + dz * dz)));
    if ((local.x - a[0] - t * dx) ** 2 + (local.z - a[1] - t * dz) ** 2 < RADIUS ** 2 - EPS) return false;
  }
  return true;
}

function actorPresence(world: WorldDefinition, actor: ContactActor): Presence | null {
  const point = actor.position;
  let found: Presence | null = null;
  for (const b of world.buildings) {
    if (getBuildingBody(b)) {
      if (!nearby(b, point)) continue;
      const nominal = Math.round((point.y - b.position.y - .6) / (b.height / b.floors));
      let supportedHere = false;
      for (const floor of [nominal, nominal - 1, nominal + 1]) {
        const plan = getBuildingFloorPlan(b, floor);
        if (!plan) continue;
        const center = floorPlanSupport(b, floor, point, 0);
        const support = floorPlanSupport(b, floor, point, RADIUS) ?? groundEdgeSupport(world, b, plan, point, center);
        if (support && Math.abs(support.y - point.y) <= FEET_TOLERANCE) {
          const indoor = support.kind === 'room' || support.kind === 'stairs';
          if (indoor && (!canAccessFloor(b, support.floor, actor) || support.link && support.y > b.position.y + .6 + getBuildingFloorPlan(b, support.link.fromFloor)!.y + .01 && !canAccessFloor(b, support.link.toFloor, actor))) return null;
          if (!found || indoor && !found.indoor) found = { building: b, floor: support.floor, indoor };
          supportedHere = true;
          break;
        }
        // Radius-zero walking height cannot turn a clipped disk over a wall,
        // shaft, courtyard edge or upper slab into full-body support.
        if (center && Math.abs(center.y - point.y) <= FEET_TOLERANCE) return null;
      }
      if (supportedHere) continue;
      const roof = getFloorPlanRoofSupport(b, point, RADIUS);
      if (roof && Math.abs(roof.y - point.y) <= FEET_TOLERANCE) { if (!roofDiskSupported(b, point, roof)) return null; if (!found) found = { building: b, floor: roof.floor, indoor: false }; continue; }
      const centerRoof = getFloorPlanRoofSupport(b, point, 0);
      if (centerRoof && Math.abs(centerRoof.y - point.y) <= FEET_TOLERANCE) return null;
    } else {
      const presence = legacyGiftPresence(b, point, actor) ?? legacyGiftDoorPresence(world, b, point, actor);
      if (presence) { const indoor = b.kind !== 'pavilion' && legacyGiftFloorAt(b, point) !== null; if (!found || indoor && !found.indoor) found = { building: b, floor: presence.floor, indoor }; continue; }
      if (b.kind !== 'pavilion' && legacyGiftFloorAt(b, point) !== null) return null;
    }
  }
  // Do not let an earlier courtyard support hide another matching room ACL.
  return found ?? (outdoorSupported(world, point) ? { floor: 0, indoor: false } : null);
}

function segmentBlocked(world: WorldDefinition, from: Vec3, to: Vec3, voxels: readonly { position: Vec3 }[]): boolean {
  // Saved voxel y is the bottom: Controller collision and the .2m renderer
  // translated by y + .1 share this actual placed-block box.
  for (const v of voxels) {
    const p = v.position;
    if (blocksSweptUprightCylinder(from, to, { x0: p.x - .1, x1: p.x + .1, z0: p.z - .1, z1: p.z + .1, bottom: p.y, top: p.y + .2 }, RADIUS, HEIGHT, .01)) return true;
  }
  for (const b of world.buildings) {
    const body = getBuildingBody(b);
    if (body) {
      const a = buildingLocalPosition(b, from), z = buildingLocalPosition(b, to);
      if (Math.min(a.x, z.x) > b.width / 2 + 2 || Math.max(a.x, z.x) < -b.width / 2 - 2 || Math.min(a.z, z.z) > b.depth / 2 + 2 || Math.max(a.z, z.z) < -b.depth / 2 - 2) continue;
      let checked = false;
      for (const plan of body.floorPlans) if (plan.y <= Math.max(a.y, z.y) + HEIGHT && plan.ceilingY >= Math.min(a.y, z.y)) {
        checked = true;
        if (blocksFloorPlanReferenceMovement(b, plan.floor, from, to, RADIUS, HEIGHT)) return true;
      }
      // Roof support can be above every storey ceiling. Retain the existing
      // roof barrier contract even when the floor-height filter has no match.
      if (!checked && body.floorPlans.length && blocksFloorPlanReferenceMovement(b, body.floorPlans[0].floor, from, to, RADIUS, HEIGHT)) return true;
    } else {
      if (blocksLegacyGiftSegment(b, from, to)) return true;
      for (const counter of marketCounters(world, b)) {
        const local = (p: Vec3) => {
          const x = p.x - counter.position.x, z = p.z - counter.position.z;
          return { x: x * Math.cos(counter.rotation) - z * Math.sin(counter.rotation), y: p.y, z: z * Math.cos(counter.rotation) + x * Math.sin(counter.rotation) };
        };
        if (blocksSweptUprightCylinder(local(from), local(to), { x0: -counter.size.x / 2, x1: counter.size.x / 2, z0: -counter.size.z / 2, z1: counter.size.z / 2, bottom: counter.position.y - counter.size.y / 2, top: counter.position.y + counter.size.y / 2 }, RADIUS, HEIGHT, .01)) return true;
      }
    }
  }
  return false;
}

/** Read-only admission for manual food handover; no relationship is created. */
export function giftContactReason(world: WorldDefinition, from: ContactActor, to: ContactActor, voxels: readonly { position: Vec3 }[]): string | null {
  if (!finitePosition(world, from.position) || !finitePosition(world, to.position)) return '双方须在城市中的真实落脚点递交食物。';
  if (voxels.some(v => !finitePosition(world, v.position))) return '现场体素位置无效，无法确认食物交接空间。';
  if (distance(from.position, to.position) > GIFT_CONTACT_METRES + EPS) return '请走到对方两米以内，亲手递交食物。';
  const a = actorPresence(world, from), b = actorPresence(world, to);
  if (!a || !b) return '双方须站在可访问楼层或实际室外落脚点递交食物。';
  if (a.indoor && b.indoor && (a.building !== b.building || a.floor !== b.floor)) return '请到对方所在的同一实际楼层递交食物。';
  if (a.indoor !== b.indoor) {
    const inside = a.indoor ? a : b;
    if (inside.floor !== 0 || !canAccessFloor(inside.building!, inside.floor, from) || !canAccessFloor(inside.building!, inside.floor, to)) return '请通过有权限的地面门口，与对方实际会面后递交食物。';
  }
  if (segmentBlocked(world, from.position, from.position, voxels) || segmentBlocked(world, to.position, to.position, voxels) || segmentBlocked(world, from.position, to.position, voxels)) return '食物不能隔着墙体、玻璃、家具或放置体素递交；请沿实际门口会面。';
  return null;
}
