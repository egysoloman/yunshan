import assert from 'node:assert/strict';
import test from 'node:test';
import { arrivalLook, fleetStarts, LANTERN_CONE, NEAR_CONE, POLE_CONE, POLE_NEAR, VIEW_CONE } from '../src/rendering/arrival-view';
import { lanternStrings, terraceLanternStrings } from '../src/rendering/lantern-strings';
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

test('in the product city the first view looks down a lantern street, with no wall, van or pole up close', () => {
  const world = createProductWorld(), s = world.spawn, look = arrivalLook(world, s), h = bearing(s, look);
  const across = (a: number, b: number, cone: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= cone + 1e-9;
  const strings = [...lanternStrings(world), ...terraceLanternStrings(world)];
  const ahead = strings.flatMap(x => x.lanterns).filter(p => across(bearing(s, p), h, LANTERN_CONE) && Math.hypot(p.x - s.x, p.z - s.z) >= 12 && Math.hypot(p.x - s.x, p.z - s.z) <= 90);
  assert.ok(ahead.length >= 10, `lanterns ahead: ${ahead.length}`);
  assert.ok(!strings.flatMap(x => x.poles).some(p => across(bearing(s, p), h, POLE_CONE) && Math.hypot(p.x - s.x, p.z - s.z) < POLE_NEAR), 'no lantern pole in the middle of the view');
  assert.ok(!world.buildings.some(b => within(bearing(s, b.position), h) && Math.hypot(b.position.x - s.x, b.position.z - s.z) - Math.max(b.width, b.depth) / 2 < 8));
  const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= NEAR_CONE + 1e-9;
  assert.ok(!fleetStarts(world).some(p => near(bearing(s, p), h) && Math.hypot(p.x - s.x, p.z - s.z) < 10), 'no waiting vehicle up close');
});
