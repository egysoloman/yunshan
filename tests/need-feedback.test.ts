import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCurrentProductCity, createProductWorld } from '../src/product-city';
import { freshNeedNotice } from '../src/need-feedback';

test('falling hungry or tired is said once, with where to go, and re-arms only after recovering', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world), at = { ...world.spawn };
  const needs = sim.state.player.needs;
  let r = freshNeedNotice(sim.state, world, at, null);
  assert.equal(r.notice, null, 'the first reading is a baseline');
  needs.hunger = 25;
  r = freshNeedNotice(sim.state, world, at, r.seen);
  assert.match(r.notice ?? '', /^有些饿了（饱腹 25）：最近营业的.+，约 \d+ 米，可去买份吃的。$/);
  assert.equal(freshNeedNotice(sim.state, world, at, r.seen).notice, null, 'said once');
  needs.hunger = 40; r = freshNeedNotice(sim.state, world, at, r.seen); assert.equal(r.notice, null, 'not re-armed below 50');
  needs.hunger = 60; r = freshNeedNotice(sim.state, world, at, r.seen); assert.equal(r.notice, null);
  sim.state.player.inventory.food = 2; needs.hunger = 20; r = freshNeedNotice(sim.state, world, at, r.seen);
  assert.match(r.notice ?? '', /随身还有 2 份食物/);
  needs.fatigue = 20; r = freshNeedNotice(sim.state, world, at, r.seen);
  assert.match(r.notice ?? '', /^有些困了（精力 20）：到住宅租一处住所/);
  needs.fatigue = 70; r = freshNeedNotice(sim.state, world, at, r.seen); sim.state.player.homeId = world.buildings.find(b => b.kind === 'home')!.id; needs.fatigue = 10;
  assert.match(freshNeedNotice(sim.state, world, at, r.seen).notice ?? '', /回住处床旁歇一歇/);
  const loaded = freshNeedNotice(sim.state, world, at, null);
  assert.equal(loaded.notice, null, 'a loaded low need is not announced');
  assert.deepEqual(loaded.seen, { hungry: true, tired: true });
});
