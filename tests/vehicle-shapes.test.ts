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
