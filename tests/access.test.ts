import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessFloor, getFloorDimensions, getStairPosition } from '../src/access.ts';
import type { Building } from '../src/types.ts';

const civic = { id: 'core-main', floors: 10, basements: 2, publicFloors: 3, requiredPermission: 'mayor', floorPermissions: ['public', 'public', 'public', 'official', 'council', 'scientist', 'police', 'driver', 'mayor', 'public'] } as Building;

test('civic halls and observation deck remain public while office and underground access require earned permissions', () => {
  const traveler = { role: 'traveler' as const, identities: ['traveler' as const] };
  for (const floor of [0, 1, 2, 9]) assert(canAccessFloor(civic, floor, traveler));
  for (const floor of [-2, -1, 3, 4, 5, 6, 7, 8]) assert(!canAccessFloor(civic, floor, traveler));
  assert(!canAccessFloor(civic, -3, traveler));
  assert(!canAccessFloor(civic, 10, traveler));
  assert(!canAccessFloor(civic, 1.5, traveler));
});

test('identity packages accumulate and preserve access across a change of displayed profession', () => {
  const citizen = { role: 'merchant' as const, identities: ['traveler', 'police', 'scientist', 'merchant'] as const };
  const player = { ...citizen, identities: [...citizen.identities] };
  assert(canAccessFloor(civic, 5, player));
  assert(canAccessFloor(civic, 6, player));
  assert(canAccessFloor(civic, -1, player));
  assert(!canAccessFloor(civic, -2, player));
  assert(!canAccessFloor(civic, 8, player));
  const mayor = { ...player, identities: [...player.identities, 'mayor' as const] };
  for (let floor = -2; floor < 10; floor++) assert(canAccessFloor(civic, floor, mayor));
});

test('stepped occupied floors use a shared vertical shaft while underground retains its full footprint', () => {
  const building = { ...civic, width: 144, depth: 112, height: 78, position: { x: 430, y: 254, z: -250 }, floorFootprints: Array.from({ length: 10 }, (_, floor) => ({ width: floor < 5 ? 144 : 72, depth: floor < 5 ? 112 : 56 })) };
  assert.deepEqual(getFloorDimensions(building, 0), { width: 144, depth: 112 });
  assert.deepEqual(getFloorDimensions(building, 9), { width: 72, depth: 56 });
  assert.equal(getFloorDimensions(building, -1).width, 144);
  const basement = getStairPosition(building, -2);
  const top = getStairPosition(building, 9);
  assert.equal(basement.x, top.x);
  assert.equal(basement.z, top.z);
  assert(Math.abs(top.y - basement.y - 11 * 7.8) < 1e-9);
  assert(Math.abs(top.x - building.position.x) < 72 / 2 - 3);
  assert(Math.abs(top.z - building.position.z) < 56 / 2 - 5);
});
