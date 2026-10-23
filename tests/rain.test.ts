import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RAIN, rainActive, rainDrop } from '../src/rendering/rain';

test('rain falls only outdoors in rain, in a box around the camera, and keeps its place in the world as the camera moves', () => {
  assert.equal(rainActive('雨', false), true); assert.equal(rainActive('雨', true), false); assert.equal(rainActive('雾', false), false);
  const camera = { x: 120.5, y: 300, z: -80 };
  for (let i = 0; i < RAIN.count; i += 13) for (const t of [0, 2.7, 99.1]) {
    const d = rainDrop(i, t, camera);
    assert.ok(Math.abs(d.x - camera.x) <= RAIN.half && Math.abs(d.z - camera.z) <= RAIN.half, 'inside the box');
    assert.ok(d.y <= camera.y + RAIN.height - RAIN.below + 1e-9 && d.y > camera.y - RAIN.below - 1e-9, 'within the falling column');
  }
  const a = rainDrop(7, 3, camera), b = rainDrop(7, 3, { ...camera, x: camera.x + 5 });
  assert.ok(Math.abs(a.x - b.x) < 1e-9 || Math.abs(Math.abs(a.x - b.x) - RAIN.half * 2) < 1e-9, 'a small camera move does not drag the streak');
  const later = rainDrop(7, 3.1, camera); assert.ok(Math.abs(a.y - later.y - RAIN.fall * .1) < 1e-9 || later.y > a.y, 'it falls at RAIN.fall (or wraps to the top)');
});

test('the C# parity fixture is current', () => {
  const fixture = JSON.parse(readFileSync('dotnet/Yunshan.Core.Tests/Parity/rain.json', 'utf8'));
  assert.deepEqual(fixture.constants, { ...RAIN });
  for (const row of fixture.rows) assert.deepEqual(rainDrop(row.i, row.elapsed, row.camera), row.top);
});
