import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeDistanceLabel } from '../src/navigation-label';

test('the navigation strip reads arrived once the player is inside the goal building', () => {
  const at = (metres: number, insideGoal = false, inVehicle = false) => routeDistanceLabel({ goal: true, metres, inVehicle, insideGoal, districtRadius: 300 });
  assert.equal(at(14, true), '已到达 · 室内', 'the counter can be 14 m from the entrance');
  assert.equal(at(14), '14 m 至入口');
  assert.equal(at(5), '已到实际入口');
  assert.equal(at(5, false, true), '5 m 至入口', 'still riding');
  assert.equal(at(1234), '1,234 m 至入口');
  assert.equal(routeDistanceLabel({ goal: false, metres: 200, inVehicle: false, insideGoal: false, districtRadius: 300 }), '已抵达城区');
  assert.equal(routeDistanceLabel({ goal: false, metres: 2500, inVehicle: false, insideGoal: false, districtRadius: 300 }), '2.5 km');
});
