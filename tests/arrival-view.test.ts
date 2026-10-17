import assert from 'node:assert/strict';
import test from 'node:test';
import { arrivalLook, fleetStarts, NEAR_CONE, VIEW_CONE } from '../src/rendering/arrival-view';
import { createProductWorld } from '../src/product-city';

const bearing = (s: { x: number; z: number }, p: { x: number; z: number }) => Math.atan2(p.z - s.z, p.x - s.x);
const within = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= VIEW_CONE + 1e-9;

test('the arrival camera faces the most market doors at a distance, never a wall up close', () => {
  const shop = (id: string, x: number, z: number, w = 10) => ({ id, kind: 'market', districtId: 'market', position: { x, y: 0, z }, door: { x, y: 0, z }, width: w, depth: w }) as any;
  const spawn = { x: 0, y: 0, z: 0 };
  // Two shops far to the east, one far to the west, and a wall right beside the spawn to the west.
  const world = { edges: [], buildings: [shop('a', 50, 0), shop('b', 60, 5), shop('c', -50, 0)] } as any;
  assert.ok(within(bearing(spawn, arrivalLook(world, spawn)), 0), 'east, where two doors are');
  const blocked = { ...world, buildings: [...world.buildings, shop('wall', 6, 0, 6)] };
  assert.ok(within(bearing(spawn, arrivalLook(blocked, spawn)), Math.PI), 'a close wall turns the view to the open side');
  const parked = { ...world, edges: [{ id: 'road-van', mode: 'road', from: 'a', to: 'b', points: [{ x: 4, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }] }], fleetPlan: [{ edgeId: 'road-van', vehicles: 1, stationRoad: false }] };
  assert.ok(within(bearing(spawn, arrivalLook(parked, spawn)), Math.PI), 'a van waiting 4 m away turns the view too');
});

test('in the product city the first view shows market doors and no building body within 8 m', () => {
  const world = createProductWorld(), s = world.spawn, look = arrivalLook(world, s), h = bearing(s, look);
  const doors = world.buildings.filter(b => b.kind === 'market' && b.districtId === 'market' && within(bearing(s, b.door), h) && Math.hypot(b.door.x - s.x, b.door.z - s.z) >= 25 && Math.hypot(b.door.x - s.x, b.door.z - s.z) <= 80);
  assert.ok(doors.length > 0, 'market doors in view');
  assert.ok(!world.buildings.some(b => within(bearing(s, b.position), h) && Math.hypot(b.position.x - s.x, b.position.z - s.z) - Math.max(b.width, b.depth) / 2 < 8));
  const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= NEAR_CONE + 1e-9;
  assert.ok(!fleetStarts(world).some(p => near(bearing(s, p), h) && Math.hypot(p.x - s.x, p.z - s.z) < 10), 'no waiting vehicle up close');
});
