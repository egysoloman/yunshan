import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { cachedWorld } from '../src/persistence/world-cache';
import { LANTERN_SPAN, lanternStrings, TERRACE_LANTERN_SPAN, terraceLanternStrings } from '../src/rendering/lantern-strings';

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

test('terrace lantern strings cross the other districts\' stone streets, clear of buildings and doors', () => {
  assert.deepEqual(terraceLanternStrings(cachedWorld(20261001, 'current-v6')), []);
  const world = createWorld(20261001, 'current-v8'), strings = terraceLanternStrings(world), nodes = new Map(world.nodes.map(n => [n.id, n]));
  assert.ok(strings.length > 300, `${strings.length} strings`);
  assert.ok(world.edges.filter(e => e.id.includes('-terrace-') && nodes.get(e.from)?.districtId !== 'market').length > 0);
  for (const s of strings) {
    assert.equal(s.lanterns.length, 3);
    for (const pole of s.poles) for (const b of world.buildings) {
      const dx = pole.x - b.position.x, dz = pole.z - b.position.z, c = Math.cos(b.rotation), sn = Math.sin(b.rotation);
      assert.ok(!(Math.abs(dx * c - dz * sn) < b.width / 2 + .4 && Math.abs(dx * sn + dz * c) < b.depth / 2 + .4), `pole inside ${b.id}`);
      assert.ok(Math.hypot(pole.x - b.door.x, pole.z - b.door.z) >= 2.5, `pole at ${b.id}'s door`);
    }
  }
  assert.equal(TERRACE_LANTERN_SPAN, 36);
});
