import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createProductWorld } from '../src/product-city';
import { BIRDS, birdFlocks, birdsAt } from '../src/rendering/bird-flocks';

test('a few birds circle above every district, clear of its tallest roof, flapping', () => {
  const world = createProductWorld(), flocks = birdFlocks(world);
  assert.equal(flocks.length, world.districts.length);
  for (const [i, f] of flocks.entries()) {
    const d = world.districts[i], roofs = world.buildings.filter(b => b.districtId === d.id).map(b => b.position.y + .6 + b.height);
    assert.equal(f.y, Math.max(d.center.y, ...roofs) + BIRDS.lift);
  }
  for (const t of [0, 10, 1000]) {
    const birds = birdsAt(flocks, t);
    assert.equal(birds.length, flocks.length * BIRDS.perFlock);
    for (const [n, b] of birds.entries()) {
      const f = flocks[Math.floor(n / BIRDS.perFlock)], r = Math.hypot(b.x - f.x, b.z - f.z);
      assert.ok(Math.abs(r - f.radius) <= BIRDS.spread + 1e-9, 'on its ring');
      assert.ok(b.y >= f.y - 3 - 1e-9, 'never below the flock height less its bob');
      assert.ok(Math.abs(b.flap) <= 1);
    }
  }
  // They move: the same bird is elsewhere a second later, about speed × radius along its ring.
  const [a] = birdsAt(flocks, 0), [b] = birdsAt(flocks, 1);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 3);
});

test('the C# parity fixture is current', () => {
  const fixture = JSON.parse(readFileSync('dotnet/Yunshan.Core.Tests/Parity/bird-flocks.json', 'utf8'));
  // Through JSON, as the C# test reads it (JSON has no −0).
  const json = (v: unknown) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(json(birdFlocks(createProductWorld())), fixture.flocks);
  for (const frame of fixture.frames) assert.deepEqual(json(birdsAt(fixture.flocks, frame.t)), frame.birds);
});
