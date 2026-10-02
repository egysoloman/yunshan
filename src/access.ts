import type { Building, Player, Role } from './types';
import { getBuildingBody,getFloorPlanStairPosition } from './architecture-floor-plan';

/** Actual occupiable footprint; underground rooms retain the structural base. */
export function getFloorDimensions(building: Building, floor: number): { width: number; depth: number } {
  return floor >= 0 ? building.floorFootprints?.[floor] ?? building : building;
}

/** The shared vertical shaft stays inside every level, including stepped towers. */
export function getStairPosition(building: Building, floor: number): { x: number; y: number; z: number } {
  if(getBuildingBody(building))return getFloorPlanStairPosition(building,floor);
  const footprints = building.floorFootprints?.length ? building.floorFootprints : [building];
  const width = Math.min(building.width, ...footprints.map(level => level.width));
  const depth = Math.min(building.depth, ...footprints.map(level => level.depth));
  return { x: building.position.x - width * 0.32, y: building.position.y + 0.6 + floor * building.height / building.floors, z: building.position.z - depth * 0.25 };
}

/** Shared by physical access and authoritative actions so they enforce the same permissions. */
export function canAccessFloor(building: Building, floor: number, player: Pick<Player, 'role' | 'identities'>): boolean {
  if (!Number.isInteger(floor) || floor < -(building.basements ?? 0) || floor >= building.floors) return false;
  const identities = new Set([player.role, ...(player.identities ?? [])]);
  const has = (...roles: Role[]) => roles.some(role => identities.has(role));
  if (floor < 0) return floor === -1 ? has('mayor', 'official', 'police', 'scientist', 'teacher') : has('mayor', 'official');
  const permission = building.floorPermissions?.[floor];
  if (permission === 'public') return true;
  if (building.publicFloors === undefined || floor < building.publicFloors) return true;
  // The observation deck is public; executive actions still have their own permissions.
  if (building.id === 'core-main' && floor === building.floors - 1) return true;
  const required = permission ?? building.requiredPermission;
  if (!required || has('mayor')) return true;
  const packages: Record<string, Role[]> = {
    official: ['official', 'council', 'scientist'],
    driver: ['driver', 'scientist', 'official'],
    police: ['police', 'soldier', 'official'],
    teacher: ['teacher', 'scientist', 'official'],
    mayor: [],
  };
  return (packages[required] ?? [required as Role]).some(role => identities.has(role));
}
