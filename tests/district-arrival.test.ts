import assert from 'node:assert/strict';
import { test } from 'node:test';
import { districtAt, freshDistrictArrival } from '../src/district-arrival';
import type { SimState } from '../src/types';

const world = { districts: [
  { id: 'a', name: '甲坊', kind: 'residential', center: { x: 0, y: 0, z: 0 }, radius: 100, color: '', population: 0 },
  { id: 'b', name: '乙市', kind: 'market', center: { x: 300, y: 0, z: 0 }, radius: 150, color: '', population: 0 },
] };
const state = { districts: [{ id: 'a', residents: 41.6 }, { id: 'b', residents: 0 }],
  shops: [{ districtId: 'b', open: true }, { districtId: 'b', open: true }, { districtId: 'b', open: false }, { districtId: 'a', open: false }] } as unknown as SimState;
const at = (x: number) => ({ x, y: 0, z: 0 });

test('the nearest district relative to its radius, inside the given share of it', () => {
  assert.equal(districtAt(world, at(10), .8), 'a');
  assert.equal(districtAt(world, at(190), .8), 'b', '110 m is .73 of b against 1.9 of a');
  assert.equal(districtAt(world, at(170), .8), null, '.87 of b is not yet inside it');
  assert.equal(districtAt(world, at(-90), .8), null);
});

test('entering another district says its name and liveliness once; the edge does not flicker', () => {
  let r = freshDistrictArrival(state, world, at(0), null);
  assert.equal(r.notice, null, 'the first reading is a baseline'); assert.equal(r.seen.id, 'a');
  r = freshDistrictArrival(state, world, at(95), r.seen); assert.equal(r.notice, null, 'still inside a until its full radius'); assert.equal(r.seen.id, 'a');
  r = freshDistrictArrival(state, world, at(110), r.seen); assert.equal(r.notice, null, 'between districts'); assert.equal(r.seen.id, null);
  r = freshDistrictArrival(state, world, at(200), r.seen); assert.equal(r.notice, '来到乙市：此刻 2 家店开着。');
  r = freshDistrictArrival(state, world, at(170), r.seen); assert.equal(r.notice, null, 'leaving b only beyond its radius');
  r = freshDistrictArrival(state, world, at(40), r.seen); assert.equal(r.notice, '来到甲坊：住着约 42 人，此刻店铺都已打烊。');
  r = freshDistrictArrival(state, world, at(41), r.seen); assert.equal(r.notice, null, 'said once');
});
