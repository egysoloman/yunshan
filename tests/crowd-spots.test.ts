import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CROWD_CELL, CROWD_LIMIT, CROWD_MIN, crowdSpots, crowdSpotTarget } from '../src/rendering/crowd-spots';

test('crowd spots count only residents who are out, by cell, busiest first', () => {
  const at = (x: number, z: number, state = 'moving', alive = true) => ({ position: { x, z }, state, alive });
  const people = [
    ...Array.from({ length: 7 }, (_, i) => at(10 + i, 20)),
    ...Array.from({ length: CROWD_MIN }, (_, i) => at(500 + i, 500, 'socializing')),
    ...Array.from({ length: 9 }, (_, i) => at(900 + i, 900, i % 3 === 0 ? 'sleeping' : i % 3 === 1 ? 'atHome' : 'dead')),
    at(1000, 1000, 'moving', false),
    ...Array.from({ length: CROWD_MIN - 1 }, (_, i) => at(-400 - i, 0)),
  ];
  const spots = crowdSpots(people);
  assert.deepEqual(spots.map(s => s.count), [7, CROWD_MIN], 'resting, dead and small groups are not crowds');
  assert.equal(spots[0].x, 13); assert.equal(spots[0].z, 20);
  assert.ok(crowdSpots(Array.from({ length: 20 }, (_, k) => Array.from({ length: CROWD_MIN }, (_, i) => at(k * CROWD_CELL * 2 + i, 0))).flat()).length === CROWD_LIMIT);
});

test('a crowd spot leads to the nearest public venue, or the nearest building when there is none', () => {
  const b = (id: string, kind: string, x: number) => ({ id, kind, door: { x, z: 0 } });
  assert.equal(crowdSpotTarget([b('home-1', 'home', 1), b('market-1', 'market', 30), b('pavilion-1', 'pavilion', -20)], { x: 0, z: 0 }), 'pavilion-1');
  assert.equal(crowdSpotTarget([b('home-2', 'home', 5), b('home-1', 'home', -5)], { x: 0, z: 0 }), 'home-1', 'ties by id');
  assert.equal(crowdSpotTarget([], { x: 0, z: 0 }), null);
});
