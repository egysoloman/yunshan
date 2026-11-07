import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedWorld } from '../src/persistence/world-cache';
import { CABLE_ROPE, CABLE_ROPE_GRIP, cableGripArm, cableRopeHeightAt, cableRopeLine } from '../src/rendering/cable-rope';
import { emitNetworkStructures, type NetworkSink } from '../src/rendering/network-structures';
import { vehicleShape } from '../src/rendering/vehicle-shapes';

const v9 = cachedWorld(20261001, 'current-v9'), cables = v9.edges.filter(e => e.mode === 'cable');

test('a hung rope stays above every cabin path point by the clearance and sags between its supports', () => {
  assert.equal(cables.length, 2);
  for (const edge of cables) {
    const line = cableRopeLine(v9, edge.id)!;
    assert.ok(line.length > 100, `${edge.id}: ${line.length} rope points`);
    for (const p of edge.points) assert.ok(cableRopeHeightAt(v9, edge.id, p)! - p.y >= CABLE_ROPE.clearance - 1e-9, `${edge.id}: rope clears the path`);
    // The rope leaves and reaches each station at the old rope height (path + 9 m).
    assert.ok(Math.abs(line[0].y - (edge.points[0].y + CABLE_ROPE.top)) < 1e-9 && Math.abs(line.at(-1)!.y - (edge.points.at(-1)!.y + CABLE_ROPE.top)) < 1e-9);
    // Somewhere the rope hangs lower than the old line 9 m above the path: it is not the jagged path line.
    assert.ok(edge.points.some(p => cableRopeHeightAt(v9, edge.id, p)! < p.y + CABLE_ROPE.top - .5), `${edge.id} sags`);
    for (let i = 1; i < line.length; i++) assert.ok(Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z) <= CABLE_ROPE.sample + 1e-6);
  }
  const v6 = cachedWorld(20261001, 'current-v6');
  assert.equal(cableRopeLine(v6, v6.edges.find(e => e.mode === 'cable')!.id), null, 'older layouts keep the rope along the path');
});

test('the network draws the hung rope in place of the path rope, and a cabin grip arm reaches it from the roof', () => {
  const segments: { a: { x: number; y: number; z: number }; lift: number; width: number }[] = [];
  const sink: NetworkSink = { box: () => {}, segment: (key, a, _b, width, _h, lift) => { if (key === 'wood' && width === .45 || key === 'cyan' && width === .15) segments.push({ a, lift: lift ?? 0, width }); } };
  emitNetworkStructures(v9, sink, { dressesStations: true, dressesRunway: true });
  const lines = cables.map(e => cableRopeLine(v9, e.id)!);
  assert.equal(segments.filter(s => s.lift === 9 || s.lift === 8.5).length, 0, 'no rope drawn along the path');
  assert.equal(segments.filter(s => s.width === .45).length, lines.reduce((n, l) => n + l.length - 1, 0));
  const trim = vehicleShape('cable').trim, edge = cables[0], p = edge.points[Math.floor(edge.points.length / 2)];
  const rope = cableRopeHeightAt(v9, edge.id, p)!, arm = cableGripArm(trim, p.y, rope);
  assert.ok(Math.abs(arm.y - arm.height / 2 - (trim.y - trim.height / 2)) < 1e-9, 'the arm keeps its foot on the cabin roof');
  assert.ok(Math.abs(p.y + arm.y + arm.height / 2 - (rope - CABLE_ROPE_GRIP)) < 1e-9, 'and its top on the rope');
  for (const e of cables) for (const q of e.points) assert.ok(cableGripArm(trim, q.y, cableRopeHeightAt(v9, e.id, q)!).height >= .4 - 1e-9, `${e.id}: the arm stays at least 0.4 m long`);
});
