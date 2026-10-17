import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { buildingLocalPosition, getBuildingBody, getBuildingEntrance } from '../src/architecture-floor-plan';

// current-v8 low-rise town: streets come first and buildings take lots facing
// a street, north or south (a half turn), so every door/room rule must hold in both directions.
const world = createWorld(20261001, 'current-v8');
const inside = (b: typeof world.buildings[number], x: number, z: number, margin = 0) => Math.abs(x - b.position.x) < b.width / 2 - margin && Math.abs(z - b.position.z) < b.depth / 2 - margin;

test('v8 is a low-rise town whose doors face their streets, half of them turned', () => {
  const turned = world.buildings.filter(b => b.rotation !== 0);
  assert.ok(turned.length > 150, `${turned.length} turned`);
  assert.ok(turned.every(b => b.rotation === Math.PI && b.floorPlanProfile && b.door.z < b.position.z));
  // Most doors join their street with one short level link.
  const short = world.edges.filter(e => e.from.endsWith('-door') && e.points.length === 2 && e.length < 20);
  assert.ok(short.length >= world.buildings.length * .8, `${short.length} short door links`);
  for (const b of world.buildings) if (b.kind !== 'core' && !b.id.startsWith('core-')) assert.ok(b.floors <= (b.kind === 'starport' ? 6 : 7), `${b.id} has ${b.floors} floors`);
});

test('every v8 door is its floor-plan entrance on the front wall, opening outwards', () => {
  for (const b of world.buildings.filter(b => b.floorPlanProfile)) {
    const entrance = getBuildingEntrance(b), n = { x: Math.round(Math.sin(b.rotation)), z: Math.round(Math.cos(b.rotation)) };
    assert.ok(Math.hypot(entrance.x - b.door.x, entrance.z - b.door.z) < 1e-6 && Math.abs(entrance.y - b.door.y) < 1e-6, `${b.id} door is the entrance`);
    const local = buildingLocalPosition(b, b.door);
    assert.ok(local.z > 0, `${b.id} door lies on the local front (+z) side`);
    assert.ok(!inside(b, b.door.x + n.x * 2, b.door.z + n.z * 2), `${b.id} two metres out of the door is outside`);
    assert.ok(inside(b, b.door.x - n.x * 2, b.door.z - n.z * 2), `${b.id} two metres in from the door is inside`);
  }
});

test('every v8 function point is inside its building at a real floor', () => {
  for (const b of world.buildings.filter(b => b.functionPoints?.length)) {
    const body = getBuildingBody(b);
    assert.ok(body, `${b.id} has a body`);
    for (const point of b.functionPoints!) {
      assert.ok(inside(b, point.position.x, point.position.z), `${b.id} ${point.purpose} point inside the footprint`);
      assert.ok(point.floor >= -(b.basements ?? 0) && point.floor < b.floors, `${b.id} point floor ${point.floor}`);
    }
  }
});
