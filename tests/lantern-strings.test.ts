import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { cachedWorld } from '../src/persistence/world-cache';
import { LANTERN_SPAN, lanternStrings } from '../src/rendering/lantern-strings';

test('千灯市集 lantern strings cross v8 market streets above the carriageway; older layouts have none', () => {
  assert.deepEqual(lanternStrings(cachedWorld(20261001, 'current-v6')), []);
  const world = createWorld(20261001, 'current-v8'), strings = lanternStrings(world);
  assert.deepEqual(lanternStrings(world), strings, 'deterministic');
  assert.ok(strings.length > 40, `${strings.length} strings`);
  for (const s of strings) {
    const [a, b] = s.poles, span = Math.hypot(a.x - b.x, a.z - b.z);
    assert.ok(span > 9 && span < 14, 'poles stand just outside both kerbs');
    assert.equal(s.lanterns.length, 5);
    for (const l of s.lanterns) assert.ok(l.y - Math.min(a.y, b.y) > 4.4, 'lanterns hang above vehicle and walking height');
  }
  assert.equal(LANTERN_SPAN, 24);
});
