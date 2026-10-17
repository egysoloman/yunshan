import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vehicleShape } from '../src/rendering/vehicle-shapes';

test('a road vehicle is a small truck: cab at the front, crates behind it on the bed, all within its length', () => {
  for (const kind of ['road', 'bridge'] as const) {
    const s = vehicleShape(kind), half = s.length / 2;
    assert.ok((s.head.z ?? 0) > 0 && (s.head.z ?? 0) + s.head.length / 2 <= half, 'the cab sits at the front');
    assert.ok(s.load && (s.load.z ?? 0) < 0 && (s.load.z ?? 0) - s.load.length / 2 >= -half, 'the load sits on the bed behind it');
    assert.ok(s.load!.z! + s.load!.length / 2 <= s.head.z! - s.head.length / 2 + 1e-9, 'load and cab do not overlap');
    assert.ok(s.load!.y - s.load!.height / 2 >= s.body.y + s.body.height / 2 - 1e-9, 'the load stands on the bed');
    assert.equal(s.wheels.length, 4);
  }
  for (const kind of ['maglev', 'lightRail', 'cable', 'ferry', 'flight'] as const) { const s = vehicleShape(kind); assert.equal(s.load, undefined); assert.equal(s.head.z, undefined); assert.equal(s.wheels.length, 0); }
});

test('a truck load is drawn as two crates with a gap, both on the bed and inside the load envelope', async () => {
  const { loadCrates } = await import('../src/rendering/vehicle-shapes');
  const load = vehicleShape('road').load!, [front, rear] = loadCrates(load), z = load.z!;
  assert.ok(Math.abs(front.length - 1.5) < 1e-9 && Math.abs(rear.length - 1.5) < 1e-9);
  assert.ok(Math.abs((front.z! - front.length / 2) - (rear.z! + rear.length / 2) - .2) < 1e-9, '0.2 m gap');
  assert.ok(Math.abs(front.z! + front.length / 2 - (z + load.length / 2)) < 1e-9 && Math.abs(rear.z! - rear.length / 2 - (z - load.length / 2)) < 1e-9, 'inside the envelope');
  const bed = vehicleShape('road').body; for (const c of [front, rear]) assert.ok(Math.abs(c.y - c.height / 2 - (bed.y + bed.height / 2)) < 1e-9, 'stands on the bed');
  assert.ok(Math.abs(front.z! - (z + .85)) < 1e-9 && Math.abs(rear.z! - (z - .85)) < 1e-9 && rear.height < front.height, 'the C# port uses ±0.85 m and a 0.2 m lower rear crate');
});
