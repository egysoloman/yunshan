import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { containsUnion, getBuildingBody, wallPanels, type FloorFixture, type WallPanel } from '../src/architecture-floor-plan';
import { createWorld } from '../src/world';
import { CityRenderer } from '../src/renderer';
import type { Building } from '../src/types';
import { buildProgramArchitecture, programLinenTemplate, type ProgramArchitecturePart } from '../src/rendering/architecture-bodies';
import { buildInteriorPropAsset, HOME_CURTAIN_WINDOW_BUDGET, interiorCurtainTemplate, officeDeskFixtureParts, windowCurtainParts, windowGlassBackingTemplate, type InteriorPropAssetId } from '../src/rendering/interior-props';

const ids: InteriorPropAssetId[] = ['office-desk', 'sofa', 'coffee-table', 'monitor', 'open-curtains'];
const min = (p: ProgramArchitecturePart) => ({ x: p.position.x - p.size.x / 2, y: p.position.y - p.size.y / 2, z: p.position.z - p.size.z / 2 });
const max = (p: ProgramArchitecturePart) => ({ x: p.position.x + p.size.x / 2, y: p.position.y + p.size.y / 2, z: p.position.z + p.size.z / 2 });

test('five reusable original assets have human-scale metre hulls and no invented interaction', () => {
  const expected = [{ x: 2.4, y: .8, z: 1.2 }, { x: 2.2, y: .8, z: .8 }, { x: 1.2, y: .4, z: .8 }, { x: .6, y: .6, z: .2 }, { x: 2, y: 1.4, z: .2 }];
  for (const [i, id] of ids.entries()) {
    const asset = buildInteriorPropAsset(id); assert.deepEqual(asset.dimensions, expected[i]);
    assert.equal(asset.interaction, 'none'); assert.equal(asset.placement, 'prepared-unplaced'); assert.equal(asset.version, 'interior-props-v1');
    assert.ok(asset.parts.length > 0 && asset.parts.length <= 8);
    for (const p of asset.parts) {
      const a = min(p), b = max(p); assert.ok(Object.values(p.size).every(n => Number.isFinite(n) && n > 0));
      for (const axis of ['x', 'y', 'z'] as const) assert.ok(a[axis] >= asset.logicalHull.min[axis] - 1e-8 && b[axis] <= asset.logicalHull.max[axis] + 1e-8, `${id} component escaped its metre hull`);
    }
  }
});

test('folded cloth is closed outward-facing finite geometry with a shared bounded template', () => {
  for (const axis of ['x', 'z'] as const) {
    const a = interiorCurtainTemplate(axis); assert.equal(interiorCurtainTemplate(axis), a); assert.equal(a.indices.length / 3, 52);
    assert.equal(a.positions.length, a.normals.length); assert.equal(a.uvs.length, a.positions.length / 3 * 2);
    assert.ok([...a.positions, ...a.normals, ...a.uvs].every(Number.isFinite));
    assert.ok(a.positions.every(x => x >= -.5 - 1e-8 && x <= .5 + 1e-8));
    let volume = 0;
    for (let i = 0; i < a.indices.length; i += 3) {
      const vs = a.indices.slice(i, i + 3).map(index => new THREE.Vector3(...a.positions.slice(index * 3, index * 3 + 3) as [number, number, number]));
      assert.ok(new THREE.Triangle(...vs as [THREE.Vector3, THREE.Vector3, THREE.Vector3]).getArea() > 1e-8);
      volume += vs[0].dot(new THREE.Vector3().crossVectors(vs[1], vs[2])) / 6;
    }
    assert.ok(volume > .1 && volume < .3, 'closed cloth normals face out rather than inside');
    for (let i = 0; i < a.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(...a.normals.slice(i, i + 3)) - 1) < 1e-6);
  }
});

test('desk adapter retains real table occupancy and rejects beds counters and undersized solids', () => {
  const fixture: FloorFixture = { id: 'actual-office-table', kind: 'table', rect: { x0: 3, x1: 5.4, z0: -4, z1: -2.8 }, bottom: 0, top: .8 };
  const before = JSON.stringify(fixture), plan = { floor: 6, y: 26.4 }, desk = officeDeskFixtureParts(fixture, plan); assert.equal(desk.length, 8);
  for (const p of desk) { const a = min(p), b = max(p); assert.equal(p.propHostId, fixture.id); assert.equal(p.propAssetId, 'office-desk'); assert.equal(p.floor, 6);
    assert.ok(a.x >= 3 - 1e-8 && b.x <= 5.4 + 1e-8 && a.z >= -4 - 1e-8 && b.z <= -2.8 + 1e-8 && a.y >= 26.4 - 1e-8 && b.y <= 27.2 + 1e-8); }
  for (const kind of ['bed', 'counter', 'shelf'] as const) assert.deepEqual(officeDeskFixtureParts({ ...fixture, kind }, plan), []);
  assert.deepEqual(officeDeskFixtureParts({ ...fixture, top: .2 }, plan), []); assert.deepEqual(officeDeskFixtureParts({ ...fixture, top: NaN }, plan), []);
  assert.equal(JSON.stringify(fixture), before);
});

test('both curtain orientations retain actual sealed window bounds and an open centre', () => {
  for (const thinX of [true, false]) {
    const panel: WallPanel = { kind: 'glass', bottom: .8, top: 2.2, rect: thinX ? { x0: 4, x1: 4.4, z0: -2, z1: -.4 } : { x0: -2, x1: -.4, z0: 4, z1: 4.4 } };
    const original = JSON.stringify(panel), parts = windowCurtainParts(panel, { floor: 0, y: 0 }, 'real-window'); assert.equal(parts.length, 3);
    for (const p of parts) { const a = min(p), b = max(p); assert.equal(p.purpose, 'curtain'); assert.equal(p.propHostId, 'real-window');
      assert.ok(a.x >= panel.rect.x0 - 1e-8 && b.x <= panel.rect.x1 + 1e-8 && a.z >= panel.rect.z0 - 1e-8 && b.z <= panel.rect.z1 + 1e-8 && a.y >= .8 - 1e-8 && b.y <= 2.2 + 1e-8); }
    const cloth = parts.filter(p => p.material === 'cloth'); assert.equal(cloth.length, 2);
    const centre = thinX ? (panel.rect.z0 + panel.rect.z1) / 2 : (panel.rect.x0 + panel.rect.x1) / 2;
    assert.ok(cloth.every(p => thinX ? max(p).z < centre || min(p).z > centre : max(p).x < centre || min(p).x > centre));
    assert.deepEqual(windowCurtainParts({ ...panel, kind: 'solid' }, { floor: 0, y: 0 }, 'not-a-window'), []);
    assert.equal(JSON.stringify(panel), original);
  }
});

test('actual city desk and curtain bindings preserve all authoritative geometry use points beds and far LOD', () => {
  const world = createWorld(), original = JSON.stringify(world), linen = JSON.stringify(programLinenTemplate()); let desks = 0, curtainWindows = 0, houses = 0;
  for (const building of world.buildings) {
    const body = getBuildingBody(building); if (!body) continue;
    const before = JSON.stringify(body), near = buildProgramArchitecture(building, 'near')!, far = buildProgramArchitecture(building, 'far')!;
    assert.ok(far.every(p => !p.propAssetId), 'prepared assets cannot grow the far renderer');
    for (const plan of body.floorPlans) {
      const desk = near.filter(p => p.floor === plan.floor && p.propAssetId === 'office-desk');
      if (desk.length) { assert.equal(building.commercialGeometryRevision, 1); assert.ok(plan.floor >= 2); assert.equal(desk.length % 8, 0); desks += desk.length / 8;
        for (const p of desk) { const fixture = plan.fixtures.find(f => f.id === p.propHostId)!; assert.ok(fixture); assert.equal(fixture.kind, 'table'); } }
      const curtains = near.filter(p => p.floor === plan.floor && p.purpose === 'curtain');
      if (curtains.length) { assert.equal(building.kind, 'home'); assert.equal(plan.floor, 0); assert.ok(curtains.length <= HOME_CURTAIN_WINDOW_BUDGET * 3); houses++; curtainWindows += curtains.length / 3;
        for (const p of curtains) { const index = Number(p.propHostId!.split(':')[1]), glass = wallPanels(plan)[index]; assert.equal(glass.kind, 'glass'); const a = min(p), b = max(p);
          assert.ok(a.x >= glass.rect.x0 - 1e-7 && b.x <= glass.rect.x1 + 1e-7 && a.z >= glass.rect.z0 - 1e-7 && b.z <= glass.rect.z1 + 1e-7 && a.y >= plan.y + glass.bottom - 1e-7 && b.y <= plan.y + glass.top + 1e-7); } }
    }
    assert.equal(JSON.stringify(body), before, 'semantic furniture and door/collision geometry cannot be edited by rendering');
    assert.ok(near.every(p => !['sofa', 'monitor', 'coffee-table'].includes(p.propAssetId ?? '')), 'missing authoritative hosts keep prepared models unplaced');
  }
  assert.ok(desks > 100 && houses > 100 && curtainWindows > 200); assert.equal(JSON.stringify(programLinenTemplate()), linen);
  assert.equal(JSON.stringify(world), original); assert.equal(createHash('sha256').update(original).digest('hex'), '2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512');
  console.log(JSON.stringify({ scope: 'pure-geometry-no-simulation', buildings: world.buildings.length, desks, houses, curtainWindows, unchangedWorld: true }));
});

test('legacy worlds without semantic programme bodies do not acquire free interior props', () => {
  const legacy = createWorld(20261001, 'current-v3'), before = JSON.stringify(legacy);
  for (const building of legacy.buildings) assert.equal(buildProgramArchitecture(building, 'near'), null);
  assert.equal(JSON.stringify(legacy), before);
});

// The production renderer entry point is exercised without constructing a
// renderer, browser, Simulation or GPU. The collecting batch sees its actual
// parameters, including the shared cloth geometry and real architectural parts.
test('production house rendering routes curtain cloth through the existing fabric finish', () => {
  const building = createWorld().buildings.find(b => b.kind === 'home')!;
  const parts = buildProgramArchitecture(building, 'near')!;
  const renderer = Object.create(CityRenderer.prototype) as { buildHouse(b: Building, batch: unknown, far: boolean): void };
  const calls: unknown[][] = [];
  renderer.buildHouse(building, { box: (...args: unknown[]) => calls.push(args) }, false);
  assert.equal(calls.length, parts.length); let cloth = 0;
  for (const [i, p] of parts.entries()) {
    assert.equal(calls[i][0], p.material === 'cloth' ? 'fabric' : p.material);
    assert.equal(calls[i][12], p.template);
    if (p.material === 'cloth') { cloth++; assert.equal(p.purpose, 'curtain'); assert.notEqual(p.template, programLinenTemplate()); }
  }
  assert.equal(cloth, 4);
});

test('actual sealed home windows show opaque curtains before their glass backing in CPU rays', () => {
  let rays = 0, windows = 0;
  const material = new THREE.MeshBasicMaterial();
  const mesh = (part: ProgramArchitecturePart, fullBox = false) => {
    const g = new THREE.BufferGeometry();
    if (part.template && !fullBox) { g.setAttribute('position', new THREE.Float32BufferAttribute(part.template.positions, 3)); g.setIndex(part.template.indices); }
    else { const b = new THREE.BoxGeometry(1, 1, 1); g.copy(b); b.dispose(); }
    const m = new THREE.Mesh(g, material); m.position.set(part.position.x, part.position.y, part.position.z); m.scale.set(part.size.x, part.size.y, part.size.z); m.updateMatrixWorld(true); return m;
  };
  try {
    for (const building of createWorld().buildings.filter(b => b.kind === 'home')) {
      const body = getBuildingBody(building)!; const plan = body.floorPlans.find(p => p.floor === 0)!;
      const parts = buildProgramArchitecture(building, 'near')!, curtains = parts.filter(p => p.purpose === 'curtain' && p.material === 'cloth');
      for (const hostId of new Set(curtains.map(p => p.propHostId!))) {
        const panel = wallPanels(plan)[Number(hostId.split(':')[1])], r = panel.rect, alongX = r.x1 - r.x0 >= r.z1 - r.z0;
        const glass = parts.find(p => p.material === 'glass' && p.floor === 0 && Math.abs(p.position.x - (r.x0 + r.x1) / 2) < 1e-7 && Math.abs(p.position.z - (r.z0 + r.z1) / 2) < 1e-7 && Math.abs(p.position.y - (plan.y + (panel.bottom + panel.top) / 2)) < 1e-7)!;
        assert.ok(glass.template); assert.equal(glass.template, windowGlassBackingTemplate(panel, plan));
        assert.equal(glass.template.indices.length / 3, 12); assert.ok(glass.template.positions.every(n => Number.isFinite(n) && n >= -.5 - 1e-8 && n <= .5 + 1e-8));
        const actualGlass = mesh(glass), oldFullBox = mesh(glass, true), hostCloth = curtains.filter(p => p.propHostId === hostId).map(p => mesh(p));
        const inset = Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2 + .2;
        const positive = containsUnion(plan.interior, glass.position.x + (alongX ? 0 : inset), glass.position.z + (alongX ? inset : 0)), side = positive ? 1 : -1;
        const direction = new THREE.Vector3(alongX ? 0 : -side, 0, alongX ? -side : 0);
        try {
          for (const cloth of hostCloth) {
            const origin = cloth.position.clone().addScaledVector(direction, -1), ray = new THREE.Raycaster(origin, direction);
            assert.equal(ray.intersectObjects([...hostCloth, oldFullBox], false)[0]?.object, oldFullBox, 'a full opaque glass box would actually hide this curtain');
            assert.equal(ray.intersectObjects([...hostCloth, actualGlass], false)[0]?.object, cloth, 'the real room ray sees cloth before the closed glass backing'); rays++;
          }
          const origin = new THREE.Vector3(glass.position.x, hostCloth[0].position.y, glass.position.z).addScaledVector(direction, -1);
          assert.equal(new THREE.Raycaster(origin, direction).intersectObjects([...hostCloth, actualGlass], false)[0]?.object, actualGlass, 'the open centre still has visible closed glass');
          windows++;
        } finally { actualGlass.geometry.dispose(); oldFullBox.geometry.dispose(); hostCloth.forEach(m => m.geometry.dispose()); }
      }
    }
    assert.ok(windows > 200 && rays === windows * 2);
    console.log(JSON.stringify({ scope: 'CPU-triangle-rays-no-GPU', windows, visibleClothRays: rays, oldOpaqueBoxOcclusionReproduced: true }));
  } finally { material.dispose(); }
});
