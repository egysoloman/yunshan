import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createCurrentProductCity, createProductWorld } from '../src/product-city';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
/** A budget that stops the tick after every `every` units of work (between handlers and between residents). */
const stopping = (every: number) => { let n = 0; return () => ++n % every !== 0; };

test('a tick spread over many calls ends exactly as one step() ends it', () => {
  const world = createProductWorld(), whole = createCurrentProductCity(world), sliced = createCurrentProductCity(world);
  for (const sim of [whole, sliced]) sim.setFocus(world.spawn, 'walk');
  const more = stopping(37); let calls = 0;
  for (let tick = 1; tick <= 40; tick++) {
    whole.step(.25);
    sliced.stepSliced(.25, more); calls++;
    while (sliced.tickOpen) { sliced.stepSliced(0, more); calls++; }
    assert.equal(sliced.state.tick, whole.state.tick);
    assert.equal(sha(sliced.exportSave()), sha(whole.exportSave()), `tick ${tick}`);
  }
  assert.ok(calls > 40 * 5, `the ticks really were spread (${calls} calls)`);
});

test('a command, save or focus change made inside a tick lands after it, as with step()', () => {
  const world = createProductWorld(), whole = createCurrentProductCity(world), sliced = createCurrentProductCity(world);
  for (const sim of [whole, sliced]) sim.setFocus(world.spawn, 'walk');
  for (let i = 0; i < 4; i++) { whole.step(.25); sliced.step(.25); }
  whole.step(.25); whole.command({ type: 'speed', value: 3 }); whole.setFocus({ ...world.spawn, x: world.spawn.x + 4 }, 'walk');
  sliced.stepSliced(.25, stopping(5)); assert.ok(sliced.tickOpen, 'stopped part-way');
  sliced.command({ type: 'speed', value: 3 }); assert.equal(sliced.tickOpen, false, 'the command finished the tick first');
  sliced.setFocus({ ...world.spawn, x: world.spawn.x + 4 }, 'walk');
  assert.equal(sha(sliced.exportSave()), sha(whole.exportSave()));
  for (let i = 0; i < 6; i++) { whole.step(.25); sliced.stepSliced(.25, stopping(11)); sliced.finishTick(); }
  assert.equal(sha(sliced.exportSave()), sha(whole.exportSave()), 'and the two cities stay identical afterwards');
});

test('an open tick that has fallen behind says so, so a slow frame rate never slows the city', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  sim.setFocus(world.spawn, 'walk');
  sim.stepSliced(.25, () => false);
  assert.ok(sim.tickOpen); assert.equal(sim.tickBehind, false, 'the next tick is not yet due');
  sim.stepSliced(.25, () => false);
  assert.equal(sim.tickBehind, true, 'another quarter second has passed with the tick still open');
  // The main loop's budget then runs it to the end in one call, and the next due tick as well.
  sim.stepSliced(0, () => sim.tickBehind);
  assert.equal(sim.state.tick, 2, 'the first tick ended and the next due one began (its time phase counts it)'); assert.ok(sim.tickOpen, 'and stopped part-way, no longer behind');
});
