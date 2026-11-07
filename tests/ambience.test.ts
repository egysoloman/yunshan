import assert from 'node:assert/strict';
import test from 'node:test';
import { ambienceLevels, daylight, type AmbienceInput } from '../src/audio/ambience';

const base: AmbienceInput = { hour: 12, position: { x: 0, y: 50, z: 0 }, ground: 50, waterDistance: 1000, nearbyPeople: 0, walkingSpeed: 0, inside: false, weather: '晴', paused: false };

test('daylight eases over dawn and dusk', () => {
  assert.equal(daylight(3), 0); assert.equal(daylight(6), .5); assert.equal(daylight(12), 1); assert.equal(daylight(19), .5); assert.equal(daylight(22), 0);
});

test('the soundscape follows the city: people, water, height, clock, steps and indoors', () => {
  const quiet = ambienceLevels(base), busy = ambienceLevels({ ...base, nearbyPeople: 12 });
  assert.equal(quiet.crowd, 0); assert.ok(busy.crowd > .6, 'real residents nearby make a murmur');
  assert.ok(busy.birds < quiet.birds, 'birds recede under a crowd');
  assert.ok(ambienceLevels({ ...base, waterDistance: 10 }).water > .7 && quiet.water === 0, 'the river is heard only near it');
  assert.ok(ambienceLevels({ ...base, position: { x: 0, y: 200, z: 0 } }).wind > quiet.wind, 'wind rises with height above the ground');
  const night = ambienceLevels({ ...base, hour: 23 });
  assert.equal(night.birds, 0); assert.ok(night.insects > 0);
  assert.equal(quiet.steps, 0); assert.ok(ambienceLevels({ ...base, walkingSpeed: 4 }).steps > 0);
  assert.equal(ambienceLevels({ ...base, walkingSpeed: 4, paused: true }).steps, 0, 'no steps while paused');
  const indoors = ambienceLevels({ ...base, inside: true, waterDistance: 10, hour: 23 });
  assert.equal(indoors.birds, 0); assert.equal(indoors.insects, 0); assert.ok(indoors.water < .2 && indoors.wind < .1);
  for (const levels of [quiet, busy, night, indoors]) for (const v of Object.values(levels)) assert.ok(v >= 0 && v <= 1);
});

test('rain is heard while it rains, muffled indoors, and silent otherwise', () => {
  const base = { hour: 12, position: { x: 0, y: 100, z: 0 }, ground: 100, waterDistance: 500, nearbyPeople: 0, walkingSpeed: 0, inside: false, weather: '雨', paused: false };
  assert.equal(ambienceLevels(base).rain, .8);
  assert.equal(ambienceLevels({ ...base, inside: true }).rain, .25);
  assert.equal(ambienceLevels({ ...base, weather: '晴' }).rain, 0);
});
