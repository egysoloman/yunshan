import { getBuildingEntrance } from '../architecture-floor-plan';
import { getPublicStreetBirthWalkHeight } from './public-street-birth-check';
import { PUBLIC_STREET_BIRTH_RECIPE_VERSION } from './public-street-birth';
import type { Building, Vec3, WorldDefinition } from '../types';

export const REFERENCE_STREET_EXIT_VERSION = 'reference-declared-arrival-supported-door-exit-v1' as const;
export const REFERENCE_STREET_EXIT_DISTANCE = 2;
export type ReferenceStreetExit = { status: 'not-applicable' } | { status: 'rejected'; reason: string } | { status: 'selected'; point: Vec3; outwardTarget: Vec3 };
const samePoint = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= 1e-7;
const finitePoint = (p: Vec3) => !!p && [p.x, p.y, p.z].every(Number.isFinite);

/** Select only the explicitly declared reference arrival's exterior landing. This
 * reads a trusted regenerated world, changes no actor/body/spawn, and cannot
 * silently fall back to the historical straight landing after a failed check.
 * The owner still checks the real door crossing, access and road closure. */
export function referenceStreetExit(world: WorldDefinition, building: Building): ReferenceStreetExit {
  const layout = (world as WorldDefinition & { layoutVersion?: string }).layoutVersion;
  if (layout !== 'current-v8') return { status: 'not-applicable' };
  const reject = (reason: string): ReferenceStreetExit => ({ status: 'rejected', reason });
  const arrival = world.referenceCityRecipe?.arrival;
  if (!arrival) return reject('此参考街道入口声明已失效，不能使用未经核对的出口。');
  if (arrival.buildingId !== building.id) return { status: 'not-applicable' };
  if (arrival.recipe !== PUBLIC_STREET_BIRTH_RECIPE_VERSION
    || building.kind !== 'market' || building.districtId !== 'market' || world.buildings.find(b => b.id === building.id) !== building)
    return reject('此参考街道入口声明已失效，不能使用未经核对的出口。');
  const path = arrival.pathToDoor, door = getBuildingEntrance(building);
  if (path.length !== 2 || !path.every(finitePoint) || !finitePoint(door) || !samePoint(door, building.door)
    || !samePoint(path[1], door) || !samePoint(path[0], world.spawn) || !samePoint(arrival.lookTarget, door))
    return reject('此参考街道的实际门口与原通路不一致，不能使用未经核对的出口。');
  const dx = path[0].x - door.x, dz = path[0].z - door.z, length = Math.hypot(dx, dz);
  if (!(length > REFERENCE_STREET_EXIT_DISTANCE) || !Number.isFinite(length)) return reject('实际门外通路没有足够的连续长度。');
  const x = door.x + dx / length * REFERENCE_STREET_EXIT_DISTANCE, z = door.z + dz / length * REFERENCE_STREET_EXIT_DISTANCE;
  let y: number | null;
  try { y = getPublicStreetBirthWalkHeight(world, x, z); }
  catch { return reject('实际门外几何不支持完整脚圆，暂时不能走出此入口。'); }
  if (y === null || !Number.isFinite(y)) return reject('实际门外落脚点没有完整脚圆支持，暂时不能走出此入口。');
  return { status: 'selected', point: { x, y, z }, outwardTarget: { ...path[0] } };
}
