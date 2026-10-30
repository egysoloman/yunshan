import { canAccessFloor } from '../access';
import { blocksFloorPlanMovement, buildingWorldPosition, findFloorPlanRoute, floorPlanSupport, getBuildingFloorPlan, getFloorPlanStairPosition, type Rect } from '../architecture-floor-plan';
import type { Building, Player, Vec3 } from '../types';
import { homeRestPoints, type HomeRestPoint } from './home-rest';

/** Sleeping mats at home (2026-10-30, new cities). A home's floor plan has one bed per floor, while homes are
 * filled by their capacity (a 2-floor current-v9 town home: 2 beds, room for 10). On the first night of a new
 * city 224 of 619 residents found no free bed at home and slept at a clinic, station or pavilion, many over a
 * kilometre away (38 of the town's 50 at the academy clinic), and woke there. In a declared city a resident
 * whose home has no free bed rests at home on a mat: a free floor spot in a room of the home, reachable from its
 * stair, kept clear of walls, doors, fixtures, stairs, use points and bed sides. A home holds at most its
 * capacity less its beds in mats, offered only while none of its beds is free. Rest itself (recovery per minute, sleep hours) is unchanged; the player's
 * bed-side rest and every floor plan, fixture and use point are untouched. */
export const HOME_MATS_POLICY = 'home-mats-v1' as const;
export type HomeMatsPolicy = typeof HOME_MATS_POLICY;
export const HOME_MATS_POLICIES: readonly HomeMatsPolicy[] = [HOME_MATS_POLICY];
/** Grid spacing of mat spots and their clearances (m). */
export const MAT_SPACING = 1.8, MAT_WALL_CLEARANCE = .8, MAT_DOOR_CLEARANCE = 1.4, MAT_FIXTURE_CLEARANCE = 1, MAT_STAIR_CLEARANCE = 1.2;

const EPS = 1e-7, BODY_RADIUS = .35, POINT_RADIUS = .4;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const q = (n: number) => Math.round(n * 5) / 5;
const rectDistance = (r: Rect, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
const segmentDistance = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, n = dx * dx + dz * dz, t = n > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / n)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
const cache = new WeakMap<Building, HomeRestPoint[]>();

/** A home's mats: free floor spots of its rooms, floor by floor, at most its capacity less its beds (derived
 * once per home; same point shape as a bed side, side 'mat', each mat its own sleeping place). */
export function homeMats(building: Building): HomeRestPoint[] {
  if (building.kind !== 'home') return [];
  const cached = cache.get(building); if (cached) return cached.map(p => ({ ...p, position: { ...p.position } }));
  const beds = Array.from({ length: building.floors }, (_, floor) => homeRestPoints(building, floor)).flat();
  const room = Math.max(0, Math.floor(building.capacity) - new Set(beds.map(b => b.bedId)).size), points: HomeRestPoint[] = [];
  for (let floor = 0; floor < building.floors && points.length < room; floor++) {
    const plan = getBuildingFloorPlan(building, floor); if (!plan) continue;
    const stairs = [plan.stairLanding, ...(plan.stairHole ? [plan.stairHole] : []), ...plan.stairTreads.map(t => t.rect), ...plan.stairLandings.map(t => t.rect)];
    const doors = plan.walls.filter(w => w.opening).map(w => { const length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), mid = (w.opening!.from + w.opening!.to) / 2; return [w.a[0] + (w.b[0] - w.a[0]) * mid / length, w.a[1] + (w.b[1] - w.a[1]) * mid / length]; });
    const stair = getFloorPlanStairPosition(building, floor);
    for (const region of plan.interior) for (let x = region.x0 + MAT_SPACING / 2; x <= region.x1 - MAT_SPACING / 2 + EPS && points.length < room; x += MAT_SPACING) for (let z = region.z0 + MAT_SPACING / 2; z <= region.z1 - MAT_SPACING / 2 + EPS && points.length < room; z += MAT_SPACING) {
      const lx = q(x), lz = q(z);
      if (plan.walls.some(w => segmentDistance(lx, lz, w.a[0], w.a[1], w.b[0], w.b[1]) < MAT_WALL_CLEARANCE) || doors.some(([dx, dz]) => Math.hypot(lx - dx, lz - dz) < MAT_DOOR_CLEARANCE)) continue;
      if (plan.fixtures.some(f => rectDistance(f.rect, lx, lz) < MAT_FIXTURE_CLEARANCE) || stairs.some(r => rectDistance(r, lx, lz) < MAT_STAIR_CLEARANCE) || plan.usePoints.some(p => Math.hypot(p.x - lx, p.z - lz) < MAT_FIXTURE_CLEARANCE)) continue;
      const position = buildingWorldPosition(building, { x: lx, y: plan.y, z: lz });
      if (beds.some(b => distance(b.position, position) < MAT_FIXTURE_CLEARANCE) || points.some(p => distance(p.position, position) < MAT_SPACING - EPS)) continue;
      const support = floorPlanSupport(building, floor, position, BODY_RADIUS);
      if (!support || support.kind !== 'room' || support.floor !== floor || Math.abs(support.y - position.y) > EPS) continue;
      if (blocksFloorPlanMovement(building, floor, position, position, BODY_RADIUS) || !findFloorPlanRoute(building, floor, stair, position, BODY_RADIUS)) continue;
      const id = `${building.id}:floor:${floor}:mat:${points.length}`;
      points.push({ id, bedId: id, buildingId: building.id, floor, fixtureId: 'mat', side: 'mat', position });
    }
  }
  cache.set(building, points); return points.map(p => ({ ...p, position: { ...p.position } }));
}

/** The mat a resident stands on, if any (within the bed-side point radius, its floors accessible). */
export function homeMatPointAt(building: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>): HomeRestPoint | null {
  return homeMats(building).filter(p => Array.from({ length: p.floor + 1 }, (_, f) => f).every(f => canAccessFloor(building, f, person)))
    .find(p => distance(p.position, position) <= POINT_RADIUS + EPS) ?? null;
}

export function validateHomeMatsPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'homeMatsPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'homeMatsPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !HOME_MATS_POLICIES.includes(data.homeMatsPolicyId)
    || data.runtime.homeMatsPolicyId !== data.homeMatsPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：home mats policy pair。');
}
