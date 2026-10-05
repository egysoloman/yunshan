import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { getBuildingBody, wallPanels, type WallPanel } from '../src/architecture-floor-plan';
import { buildProgramArchitecture, partitionProgramWallFinish, PROGRAM_WALL_FINISH_PANEL_BUDGET, type ProgramArchitecturePart } from '../src/rendering/architecture-bodies';

const volume = (r: { x0: number; x1: number; z0: number; z1: number }, low: number, high: number) => (r.x1 - r.x0) * (r.z1 - r.z0) * (high - low);
const bounds = (part: ProgramArchitecturePart) => ({ x0: part.position.x - part.size.x / 2, x1: part.position.x + part.size.x / 2,
  z0: part.position.z - part.size.z / 2, z1: part.position.z + part.size.z / 2, low: part.position.y - part.size.y / 2, high: part.position.y + part.size.y / 2 });
const contains = (part: ProgramArchitecturePart, x: number, y: number, z: number) => {
  const b = bounds(part); return x > b.x0 + 1e-8 && x < b.x1 - 1e-8 && y > b.low + 1e-8 && y < b.high - 1e-8 && z > b.z0 + 1e-8 && z < b.z1 - 1e-8;
};
// Material seams belong to the closed union of wall solids. Doorway emptiness
// below deliberately retains the stricter interior predicate above.
const covers = (part: ProgramArchitecturePart, x: number, y: number, z: number) => {
  const b = bounds(part); return x >= b.x0 - 1e-8 && x <= b.x1 + 1e-8 && y >= b.low - 1e-8 && y <= b.high + 1e-8 && z >= b.z0 - 1e-8 && z <= b.z1 + 1e-8;
};

test('timber finishes partition the same opaque wall volume without overlap or projection', () => {
  for (const alongX of [true, false]) for (const span of [.4, .8, 1.6, 3.2, 17.6]) for (const height of [.2, .4, 1.4, 3.2]) {
    const rect = alongX ? { x0: -4.8, x1: -4.8 + span, z0: -2.2, z1: -1.8 } : { x0: 1.8, x1: 2.2, z0: -4.8, z1: -4.8 + span };
    const panel: WallPanel = { rect, bottom: .8, top: .8 + height, kind: 'solid' }, pieces = partitionProgramWallFinish(panel, panel.bottom, panel.top);
    assert.ok(Math.abs(pieces.reduce((sum, p) => sum + volume(p.rect, p.bottom, p.top), 0) - volume(rect, panel.bottom, panel.top)) < 1e-7);
    for (const piece of pieces) {
      assert.ok(piece.rect.x0 >= rect.x0 - 1e-8 && piece.rect.x1 <= rect.x1 + 1e-8 && piece.rect.z0 >= rect.z0 - 1e-8 && piece.rect.z1 <= rect.z1 + 1e-8 && piece.bottom >= panel.bottom - 1e-8 && piece.top <= panel.top + 1e-8);
      assert.ok(volume(piece.rect, piece.bottom, piece.top) > 0);
    }
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j], intersection = Math.max(0, Math.min(a.rect.x1, b.rect.x1) - Math.max(a.rect.x0, b.rect.x0)) * Math.max(0, Math.min(a.rect.z1, b.rect.z1) - Math.max(a.rect.z0, b.rect.z0)) * Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
      assert.ok(intersection < 1e-8, 'finish solids cannot duplicate the volume they are meant to retain');
    }
    assert.deepEqual(partitionProgramWallFinish({ ...panel, kind: 'glass' }, panel.bottom, panel.top), [], 'the wall finish cannot convert a physical window into timber or plaster');
  }
});

const world = createWorld();
test('native home and market walls retain covered solids, real windows and empty doorways', () => {
  for (const kind of ['home', 'market'] as const) {
    const building = world.buildings.find(b => b.kind === kind && getBuildingBody(b))!, body = getBuildingBody(building)!, before = JSON.stringify(body);
    const parts = buildProgramArchitecture(building, 'near')!;
    for (const plan of body.floorPlans) {
      const panels = wallPanels(plan), opaque = panels.filter(p => p.kind === 'solid'), actual = parts.filter(p => p.floor === plan.floor && p.purpose === 'wall');
      const expectedVolume = opaque.reduce((sum, p) => sum + volume(p.rect, p.bottom, p.top), 0), actualVolume = actual.reduce((sum, p) => sum + p.size.x * p.size.y * p.size.z, 0);
      assert.ok(Math.abs(actualVolume - expectedVolume) < 1e-6, `${building.id} floor${plan.floor}: physical wall volume changed`);
      for (const part of actual) {
        const b = bounds(part);
        assert.ok(opaque.some(p => b.x0 >= p.rect.x0 - 1e-7 && b.x1 <= p.rect.x1 + 1e-7 && b.z0 >= p.rect.z0 - 1e-7 && b.z1 <= p.rect.z1 + 1e-7 && b.low >= plan.y + p.bottom - 1e-7 && b.high <= plan.y + p.top + 1e-7), `${building.id}: new finish escaped an actual opaque wall panel`);
      }
      for (const p of opaque) for (const u of [.17, .5, .83]) for (const v of [.17, .5, .83]) {
        const x = p.rect.x0 + (p.rect.x1 - p.rect.x0) * u, z = (p.rect.z0 + p.rect.z1) / 2, y = plan.y + p.bottom + (p.top - p.bottom) * v;
        assert.ok(actual.some(part => covers(part, x, y, z)), `${building.id} floor${plan.floor} (${x},${y},${z}): the retained wall contains an uncovered finish hole`);
      }
      const expectedGlass = panels.filter(p => p.kind === 'glass').map(p => ({ position: { x: (p.rect.x0 + p.rect.x1) / 2, y: plan.y + (p.bottom + p.top) / 2, z: (p.rect.z0 + p.rect.z1) / 2 }, size: { x: p.rect.x1 - p.rect.x0, y: p.top - p.bottom, z: p.rect.z1 - p.rect.z0 } }));
      assert.deepEqual(parts.filter(p => p.floor === plan.floor && p.purpose === 'window').map(p => ({ position: p.position, size: p.size })), expectedGlass, `${building.id}: original window dimensions or cuts changed`);
      for (const wall of plan.walls.filter(w => w.opening)) {
        const opening = wall.opening!, length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
        for (const u of [.17, .5, .83]) for (const y of [.2, opening.height / 2, opening.height - .2]) {
          const along = opening.from + (opening.to - opening.from) * u, x = wall.a[0] + (wall.b[0] - wall.a[0]) * along / length, z = wall.a[1] + (wall.b[1] - wall.a[1]) * along / length;
          assert.ok(!actual.some(part => contains(part, x, plan.y + y, z)), `${building.id}: timber finish sealed a real doorway`);
        }
      }
    }
    assert.equal(JSON.stringify(body), before, 'the renderer must not mutate floor plans, use points or permissions');
  }
});

test('closed wall coverage includes the native material seam and rejects an actual gap', () => {
  const building = world.buildings.find(b => b.id === 'river-b1')!, parts = buildProgramArchitecture(building, 'near')!.filter(p => p.floor === 0 && p.purpose === 'wall');
  const point = { x: 16.672, y: 3, z: -5 };
  assert.ok(parts.some(p => covers(p, point.x, point.y, point.z)), 'the actual native timber/plaster seam is covered by the closed solids');
  assert.ok(!parts.some(p => contains(p, point.x, point.y, point.z)), 'this exercises the original strict-interior false failure');
  // A 0.2mm gap is far larger than the 1e-8m numerical tolerance. Shorten only
  // the cloned solids that touch this point; production geometry is unchanged.
  const separated = parts.map(part => {
    if (!covers(part, point.x, point.y, point.z)) return part;
    const b = bounds(part), upper = Math.abs(b.low - point.y) < 1e-8;
    return { ...part, position: { ...part.position, y: part.position.y + (upper ? .00005 : -.00005) }, size: { ...part.size, y: part.size.y - .0001 } };
  });
  assert.ok(!separated.some(p => covers(p, point.x, point.y, point.z)), 'closed coverage cannot mask a real gap');
});

test('the explicit wall finish cap holds for every native target building', () => {
  let capped = 0, checked = 0;
  for (const building of world.buildings.filter(b => b.kind === 'home' || b.kind === 'market')) {
    if (!getBuildingBody(building)) continue;
    const count = buildProgramArchitecture(building, 'near')!.filter(p => p.purpose === 'wall' && p.material === 'wood').length;
    assert.ok(count <= PROGRAM_WALL_FINISH_PANEL_BUDGET * 3, `${building.id}: actual timber instance count exceeded its per-building cap`);
    if (count === PROGRAM_WALL_FINISH_PANEL_BUDGET * 3) capped++;
    checked++;
  }
  assert.ok(checked > 250, 'the native target set was actually generated');
  assert.ok(capped > 0, 'a real building must reach the budget limit so the cap is exercised');
});
