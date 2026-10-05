import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world';
import { getBuildingBody, getFloorPlanRoofRegions, wallPanels, type WallPanel } from '../src/architecture-floor-plan';
import { buildProgramArchitecture, partitionCivicWallFinish, CIVIC_WALL_FINISH_MAX_BAYS, CIVIC_WALL_FINISH_PANEL_BUDGET } from '../src/rendering/architecture-bodies';
import { ArchitectureDetailManager, buildArchitectureDetails } from '../src/rendering/architecture-detail';
import { cityShadowProfile } from '../src/rendering/city-lighting-profile';
import { installDetailSurfaceFinishes } from '../src/rendering/detail-surface-finishes';

const volume = (r: { x0: number; x1: number; z0: number; z1: number }, bottom: number, top: number) => (r.x1 - r.x0) * (r.z1 - r.z0) * (top - bottom);

test('civic bays partition opaque source panels exactly without projecting into a room or an opening', () => {
  for (const alongX of [true, false]) for (const span of [.4, .8, 1.2, 3.2, 7.6, 41.6]) for (const height of [.2, .8, 1, 3.2, 4.4]) {
    const rect = alongX ? { x0: -20.8, x1: -20.8 + span, z0: -2.2, z1: -1.8 } : { x0: 1.8, x1: 2.2, z0: -20.8, z1: -20.8 + span };
    const panel: WallPanel = { rect, bottom: .8, top: .8 + height, kind: 'solid' }, pieces = partitionCivicWallFinish(panel, panel.bottom, panel.top);
    assert.ok(Math.abs(pieces.reduce((sum, p) => sum + volume(p.rect, p.bottom, p.top), 0) - volume(rect, panel.bottom, panel.top)) < 1e-8);
    assert.ok(pieces.filter(p => p.material === 'wood').length <= CIVIC_WALL_FINISH_MAX_BAYS + 3);
    for (const p of pieces) {
      assert.ok(p.rect.x0 >= rect.x0 - 1e-8 && p.rect.x1 <= rect.x1 + 1e-8 && p.rect.z0 >= rect.z0 - 1e-8 && p.rect.z1 <= rect.z1 + 1e-8 && p.bottom >= panel.bottom - 1e-8 && p.top <= panel.top + 1e-8);
      assert.ok(volume(p.rect, p.bottom, p.top) > 0);
    }
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j];
      assert.ok(Math.max(0, Math.min(a.rect.x1, b.rect.x1) - Math.max(a.rect.x0, b.rect.x0)) * Math.max(0, Math.min(a.rect.z1, b.rect.z1) - Math.max(a.rect.z0, b.rect.z0)) * Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom)) < 1e-8);
    }
    assert.deepEqual(partitionCivicWallFinish({ ...panel, kind: 'glass' }, panel.bottom, panel.top), []);
  }
});

const world = createWorld();
test('native academy/public/police shells keep original wall volume, window cuts, roofs and immutable geometry', () => {
  let checked = 0;
  for (const building of world.buildings.filter(b => ['school', 'hall', 'police'].includes(b.kind))) {
    const body = getBuildingBody(building); if (!body) continue;
    const original = JSON.stringify(body), parts = buildProgramArchitecture(building, 'near')!;
    assert.ok(parts.filter(p => p.material === 'wood' && p.purpose === 'wall').length <= CIVIC_WALL_FINISH_PANEL_BUDGET * (CIVIC_WALL_FINISH_MAX_BAYS + 3));
    for (const plan of body.floorPlans) {
      const panels = wallPanels(plan), opaque = panels.filter(p => p.kind === 'solid'), actual = parts.filter(p => p.floor === plan.floor && p.purpose === 'wall');
      assert.ok(Math.abs(opaque.reduce((sum, p) => sum + volume(p.rect, p.bottom, p.top), 0) - actual.reduce((sum, p) => sum + p.size.x * p.size.y * p.size.z, 0)) < 1e-6, `${building.id}:${plan.floor}`);
      for (const part of actual) assert.ok(opaque.some(p => part.position.x - part.size.x / 2 >= p.rect.x0 - 1e-7 && part.position.x + part.size.x / 2 <= p.rect.x1 + 1e-7 && part.position.z - part.size.z / 2 >= p.rect.z0 - 1e-7 && part.position.z + part.size.z / 2 <= p.rect.z1 + 1e-7 && part.position.y - part.size.y / 2 >= plan.y + p.bottom - 1e-7 && part.position.y + part.size.y / 2 <= plan.y + p.top + 1e-7));
      // The baseline box writer has always omitted any dimension <=1e-7.
      // Native .2m window-panel endpoint snapping can retain a zero-thickness
      // descriptor; it cannot require an invisible zero-volume render box.
      const actualWindows = parts.filter(p => p.floor === plan.floor && p.purpose === 'window');
      assert.ok(actualWindows.every(p => Math.min(p.size.x, p.size.y, p.size.z) > 1e-7), `${building.id}:${plan.floor}: an emitted window must have all three real dimensions`);
      const emittedGlass = panels.filter(p => p.kind === 'glass' && Math.min(p.rect.x1 - p.rect.x0, p.top - p.bottom, p.rect.z1 - p.rect.z0) > 1e-7);
      assert.deepEqual(actualWindows.map(p => ({ position: p.position, size: p.size })), emittedGlass.map(p => ({ position: { x: (p.rect.x0 + p.rect.x1) / 2, y: plan.y + (p.bottom + p.top) / 2, z: (p.rect.z0 + p.rect.z1) / 2 }, size: { x: p.rect.x1 - p.rect.x0, y: p.top - p.bottom, z: p.rect.z1 - p.rect.z0 } })), `${building.id}:${plan.floor}: every nonzero original glass panel must keep its exact position, dimensions and order`);
    }
    const roofRegions = getFloorPlanRoofRegions(body), roofs = parts.filter(p => p.purpose === 'roof');
    assert.equal(roofs.length, roofRegions.length, `${building.id}: no real roof may disappear or acquire a second cover`);
    for (const [i, roof] of roofs.entries()) {
      const region = roofRegions[i], r = region.rect;
      assert.deepEqual({ position: roof.position, size: roof.size, floor: roof.floor, roof: roof.roof }, {
        position: { x: (r.x0 + r.x1) / 2, y: (region.bottom + region.top) / 2, z: (r.z0 + r.z1) / 2 },
        size: { x: r.x1 - r.x0, y: region.top - region.bottom, z: r.z1 - r.z0 }, floor: region.floor, roof: true,
      }, `${building.id}: roof footprint and height must stay bound to its real shared region`);
      if (region.kind === 'gable') {
        assert.ok(roof.template); assert.equal(roof.template.key, `program-gable-${region.gableAxis}-1`);
        const vertices = roof.template.positions;
        for (let j = 0; j < vertices.length; j += 3) {
          const x = roof.position.x + vertices[j] * roof.size.x, y = roof.position.y + vertices[j + 1] * roof.size.y, z = roof.position.z + vertices[j + 2] * roof.size.z;
          const span = region.gableAxis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
          const sharedTop = region.bottom + .4 + .8 * (1 - Math.abs(2 * span - 1));
          assert.ok(x >= r.x0 - 1e-7 && x <= r.x1 + 1e-7 && z >= r.z0 - 1e-7 && z <= r.z1 + 1e-7 && y >= region.bottom - 1e-7 && y <= sharedTop + 1e-7, `${building.id}: roof vertex escaped the shared triangular physical profile`);
        }
      } else assert.equal(roof.template, undefined, `${building.id}: a flat shared roof must stay flat`);
    }
    assert.equal(JSON.stringify(body), original); checked++;
  }
  assert.ok(checked >= 40);
});

test('detail batches own independent surface attributes and release their buffers without changing instances', () => {
  const manager = new ArchitectureDetailManager(world.buildings), home = world.buildings.find(b => b.kind === 'home')!;
  const geometries: THREE.BufferGeometry[] = [], bindings: THREE.BufferAttribute[] = [];
  try {
    manager.update(home.door);
    for (const entry of manager.group.children) for (const child of entry.children) if (child instanceof THREE.InstancedMesh && child.name.startsWith('木构开间')) {
      const attribute = child.geometry.getAttribute('instanceDetailSurface') as THREE.BufferAttribute;
      assert.equal(attribute.count, child.count); assert.ok(Array.from(attribute.array).every(v => v === 1 || v === 2 || v === 3));
      geometries.push(child.geometry); bindings.push(attribute);
      const id = manager.getStats().activeBuildingIds[manager.group.children.indexOf(entry)];
      const building = world.buildings.find(b => b.id === id)!;
      const floor = Math.max(0, Math.min(building.floors - 1, Math.floor((home.door.y - building.position.y - .6) / (building.height / building.floors))));
      assert.equal(child.count, buildArchitectureDetails(building, floor, 576).filter(p => !p.luminous).length);
    }
    assert.ok(geometries.length > 1); assert.equal(new Set(geometries).size, geometries.length); assert.equal(new Set(bindings).size, bindings.length);
    let disposed = 0; geometries.forEach(g => g.addEventListener('dispose', () => disposed++));
    manager.update({ x: 100000, y: 100000, z: 100000 }); assert.equal(disposed, geometries.length);
    manager.dispose(); assert.equal(disposed, geometries.length);
  } finally { manager.dispose(); }
});

test('street light slots follow real resident lantern matrices, continuous night and finite power', () => {
  const building = world.buildings.find(b => b.kind === 'market')!, manager = new ArchitectureDetailManager([building]);
  try {
    const before = JSON.stringify(building); manager.update(building.door);
    const dark = manager.getExteriorLightConfigurations({ ...building.door, y: building.door.y + 1.72 }, 0, 1), day = manager.getExteriorLightConfigurations({ ...building.door, y: building.door.y + 1.72 }, 1, 1);
    assert.ok(dark.length > 0 && dark.length <= 2); assert.equal(day.length, dark.length);
    const luminous = buildArchitectureDetails(building).filter(p => p.luminous);
    for (const [i, source] of dark.entries()) {
      assert.equal(source.source, 'resident-lantern'); assert.equal(source.distance, 7.5); assert.equal(source.decay, 2); assert.ok(source.intensity > day[i].intensity);
      const c = Math.cos(building.rotation), s = Math.sin(building.rotation);
      assert.ok(luminous.some(p => Math.hypot(source.position.x - (building.position.x + p.position.x * c + p.position.z * s), source.position.y - (building.position.y + .6 + p.position.y), source.position.z - (building.position.z + p.position.z * c - p.position.x * s)) < 1e-7));
    }
    assert.equal(manager.getExteriorLightConfigurations(building.door, 0, .5)[0].intensity, dark[0].intensity / 2);
    assert.deepEqual(manager.getExteriorLightConfigurations(building.door, 0, 0), []);
    assert.deepEqual(manager.getExteriorLightConfigurations({ x: 100000, y: 100000, z: 100000 }, 0, 1), []);
    assert.equal(JSON.stringify(building), before);
    let pointLights = 0; manager.group.traverse(o => { if (o instanceof THREE.PointLight) pointLights++; }); assert.equal(pointLights, 0);
    manager.dispose(); assert.deepEqual(manager.getExteriorLightConfigurations(building.door, 0, 1), []);
  } finally { manager.dispose(); }
});

test('shadow quality has a fixed local budget and detail shaders do not alter vertex positions', () => {
  const balanced = cityShadowProfile('balanced'), high = cityShadowProfile('high');
  assert.deepEqual([balanced.mapSize, high.mapSize], [1024, 2048]);
  assert.ok(balanced.metresPerTexel <= .125 && high.metresPerTexel <= .1); assert.ok(balanced.normalBias < .1);
  const material = new THREE.MeshStandardMaterial();
  try {
    installDetailSurfaceFinishes(material);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader as unknown as Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0], undefined as unknown as THREE.WebGLRenderer);
    assert.ok(shader.vertexShader.includes('instanceDetailSurface')); assert.ok(!shader.vertexShader.includes('transformed='));
    assert.equal(material.map, null); assert.equal(material.normalMap, null); assert.equal(material.displacementMap, null); assert.equal(material.metalness, 0);
    assert.ok(shader.fragmentShader.includes('detailRoughness=.91')); assert.ok(shader.fragmentShader.includes('detailRoughness=.55'));
  } finally { material.dispose(); }
});
