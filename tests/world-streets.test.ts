import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreetWorld, createWorld, findPath } from '../src/world';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import type { Building, Vec3 } from '../src/types';
import { roadCrossings } from '../scripts/roads/crossings';
import { deckClashes } from '../scripts/roads/deck-clashes';

// R2 development street recipe (docs/设计/路网重做方案.md): the same world
// invariants as tests/world.test.ts, plus the street-shape targets of P1.
const EPSILON = 1e-8;
const worlds = [createStreetWorld(), createStreetWorld(7)];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lattice = (n: number) => Math.abs(n / .2 - Math.round(n / .2)) <= 1e-6;
function crossesInterior(a: Vec3, b: Vec3, building: Building): boolean {
  let start = 0, end = 1;
  for (const [axis, half] of [['x', building.width / 2], ['z', building.depth / 2]] as const) {
    const min = building.position[axis] - half + EPSILON, max = building.position[axis] + half - EPSILON, delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPSILON) { if (a[axis] < min || a[axis] > max) return false; }
    else { const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta; start = Math.max(start, Math.min(t1, t2)); end = Math.min(end, Math.max(t1, t2)); if (start > end) return false; }
  }
  return start <= end;
}

test('the street recipe leaves every registered layout untouched', () => {
  const v6 = createWorld(20261001, 'current-v6');
  assert.equal(v6.edges.filter(e => e.from.endsWith('-door')).length, v6.buildings.length);
  assert.ok(!v6.nodes.some(n => n.id.startsWith('junction-')));
  assert.notEqual(savedWorldFingerprint(worlds[0]), savedWorldFingerprint(v6));
});

test('street graph: lattice points, exact node endpoints, arc lengths, walkable grades, clear of buildings', () => {
  for (const world of worlds) {
    const nodes = new Map(world.nodes.map(n => [n.id, n]));
    assert.equal(nodes.size, world.nodes.length); assert.equal(new Set(world.edges.map(e => e.id)).size, world.edges.length);
    for (const edge of world.edges) {
      const from = nodes.get(edge.from)!, to = nodes.get(edge.to)!;
      assert.ok(from && to, edge.id);
      assert.ok(distance(edge.points[0], from.position) < EPSILON && distance(edge.points.at(-1)!, to.position) < EPSILON, `${edge.id} ends at its nodes`);
      assert.ok(Math.abs(edge.length - edge.points.slice(1).reduce((s, p, i) => s + distance(edge.points[i], p), 0)) < 1e-6, `${edge.id} arc length`);
      if (edge.mode !== 'road' && edge.mode !== 'bridge') continue;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], b = edge.points[i], horizontal = Math.hypot(b.x - a.x, b.z - a.z);
        assert.ok(lattice(b.x) && lattice(b.z) && lattice(b.y), `${world.seed}:${edge.id} point ${i} on the 0.2 m lattice`);
        assert.ok(horizontal > EPSILON && Math.abs(b.y - a.y) <= horizontal * .25 + EPSILON, `${world.seed}:${edge.id} segment ${i} grade`);
        for (const building of world.buildings) assert.ok(!crossesInterior(a, b, building), `${world.seed}:${edge.id} segment ${i} crosses ${building.id}`);
      }
    }
  }
});

test('every door joins the shared streets and reaches its district station', () => {
  for (const world of worlds) {
    const doors = world.edges.filter(e => e.from.endsWith('-door'));
    assert.equal(doors.length, world.buildings.length);
    for (const b of world.buildings) {
      const route = findPath(world, `${b.id}-door`, `${b.districtId}-station`, 'road');
      assert.ok(route.length >= 2 && route.at(-1)!.id === `${b.districtId}-station`, `${world.seed}:${b.id} reaches its station`);
    }
  }
});

test('streets meet the P1 shape targets', () => {
  for (const world of worlds) {
    const roads = world.edges.filter(e => e.mode === 'road' && !e.id.includes('runway'));
    let length = 0, axis = 0, right = 0;
    for (const e of roads) {
      let previous: { dx: number; dz: number; len: number } | null = null;
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1], b = e.points[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        length += len; if (Math.abs(dx) < 1e-6 || Math.abs(dz) < 1e-6) axis += len;
        if (previous) { const cos = (previous.dx * dx + previous.dz * dz) / (previous.len * len); if (Math.abs(cos) < Math.sin(5 * Math.PI / 180) && Math.abs(previous.dx * dz - previous.dz * dx) > 1e-6) right++; }
        previous = { dx, dz, len };
      }
    }
    assert.ok(right / (length / 1000) <= 3, `${world.seed}: ${(right / (length / 1000)).toFixed(2)} right-angle turns per km`);
    assert.ok(axis / length <= .2, `${world.seed}: axis share ${(axis / length).toFixed(3)}`);
    // Streets meet at junctions. Counting every interior crossing (also between
    // roads that share an end node elsewhere) v6 has 368 and v8 about 40.
    const crossings = roadCrossings(world.edges);
    assert.ok(crossings.length <= 34, `${world.seed}: ${crossings.length} street crossings without a junction`);
  }
});

test('door stubs keep out from under other streets\' decks', () => {
  // A walker on a stub stands under another street's deck when the two 10 m
  // decks overlap in plan with one 1.8–4.8 m above the other. v8 had 102.
  const world = worlds[0], overhead = deckClashes(world.edges, world.nodes).filter(c => c.dy >= 1.8 && c.gap < 8);
  assert.ok(overhead.length <= 32, `${overhead.length} overhead decks`);
});
