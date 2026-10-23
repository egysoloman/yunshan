import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../src/world';
import { lanternGlows } from '../src/rendering/lantern-glow';
import { groundPools, DOOR_LAMP_HEIGHT, GROUND_LIFT, STREET_LAMP_HEIGHT } from '../src/rendering/ground-glow';

test('ground pools lie under every door and street lamp, street pools along their road', () => {
  const world = createWorld(20261001, 'current-v8'), glows = lanternGlows(world), pools = groundPools(world);
  const doors = glows.filter(g => g.kind === 'door'), streets = glows.filter(g => g.kind === 'street');
  assert.equal(pools.length, doors.length + streets.length);
  pools.slice(0, doors.length).forEach((p, i) => { assert.equal(p.along, null); assert.ok(Math.abs(p.y - (doors[i].y - DOOR_LAMP_HEIGHT + GROUND_LIFT)) < 1e-9); });
  pools.slice(doors.length).forEach((p, i) => {
    const lamp = streets[i]; assert.ok(Math.abs(p.x - lamp.x) < 1e-9 && Math.abs(p.z - lamp.z) < 1e-9 && Math.abs(p.y - (lamp.y - STREET_LAMP_HEIGHT + GROUND_LIFT)) < 1e-9, 'directly under its lamp');
    assert.ok(p.along && Math.abs(Math.hypot(...p.along) - 1) < 1e-9 && Math.abs(p.along[1]) < .5, 'a unit road direction');
  });
});
