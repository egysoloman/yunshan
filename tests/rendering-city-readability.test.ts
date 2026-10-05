import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world';
import { getBuildingBody } from '../src/architecture-floor-plan';
import { architecturePlaqueTitle } from '../src/rendering/architecture-detail';
import { buildProgramArchitecture, programLinenTemplate } from '../src/rendering/architecture-bodies';
import { describeStationBoard, stationWallBoards, StationWayfindingPool } from '../src/rendering/station-wayfinding';
import type { NetworkEdge, NetworkNode, SimState, WorldDefinition } from '../src/types';

const world = createWorld();

test('original linen geometry has outward faces, exact original box bounds and one reusable bounded template', () => {
  const template = programLinenTemplate(); assert.equal(programLinenTemplate(), template);
  assert.equal(template.indices.length / 3, 44); assert.equal(template.positions.length, template.normals.length);
  assert.ok([...template.positions, ...template.normals, ...template.uvs].every(Number.isFinite));
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(template.positions, 3)); geometry.setIndex(template.indices); geometry.computeBoundingBox();
  try {
    assert.deepEqual(geometry.boundingBox!.min.toArray(), [-.5, -.5, -.5]); assert.deepEqual(geometry.boundingBox!.max.toArray(), [.5, .5, .5]);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < template.indices.length; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, template.indices[i]);
      const b = new THREE.Vector3().fromBufferAttribute(positions, template.indices[i + 1]);
      const c = new THREE.Vector3().fromBufferAttribute(positions, template.indices[i + 2]);
      const centre = a.clone().add(b).add(c).divideScalar(3), normal = b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(normal.lengthSq() > 1e-10, `face ${i / 3} is not degenerate`);
      assert.ok(normal.dot(centre) > 0, `face ${i / 3} faces outwards`);
    }
  } finally { geometry.dispose(); }
});

test('native quilts and pillows use the new geometry inside their original fixture and standing-space volumes', () => {
  const original = JSON.stringify(world); let linen = 0;
  for (const building of world.buildings.filter(site => site.kind === 'home')) {
    const body = getBuildingBody(building), parts = buildProgramArchitecture(building, 'near'); if (!body || !parts) continue;
    for (const part of parts.filter(part => part.material === 'fabric')) {
      assert.equal(part.template, programLinenTemplate());
      const plan = body.floorPlans.find(plan => plan.floor === part.floor)!;
      const bed = plan.fixtures.find(fixture => fixture.kind === 'bed' && part.position.x - part.size.x / 2 >= fixture.rect.x0 - 1e-7
        && part.position.x + part.size.x / 2 <= fixture.rect.x1 + 1e-7 && part.position.z - part.size.z / 2 >= fixture.rect.z0 - 1e-7 && part.position.z + part.size.z / 2 <= fixture.rect.z1 + 1e-7);
      assert.ok(bed);
      for (let i = 0; i < part.template!.positions.length; i += 3) {
        const x = part.position.x + part.template!.positions[i] * part.size.x, y = part.position.y + part.template!.positions[i + 1] * part.size.y, z = part.position.z + part.template!.positions[i + 2] * part.size.z;
        assert.ok(x >= bed!.rect.x0 - 1e-7 && x <= bed!.rect.x1 + 1e-7 && z >= bed!.rect.z0 - 1e-7 && z <= bed!.rect.z1 + 1e-7);
        assert.ok(y >= plan.y + bed!.bottom - 1e-7 && y <= plan.y + bed!.top + 1e-7);
      }
      linen++;
    }
  }
  assert.ok(linen > 100); assert.equal(JSON.stringify(world), original);
});

test('every native station poster is a surface of its existing canopy post, never a street obstacle', () => {
  const original = JSON.stringify(world); let stations = 0;
  for (const node of world.nodes) {
    const boards = stationWallBoards(node); assert.equal(boards.length, node.station ? 4 : 0);
    for (const board of boards) {
      assert.ok(board.position.x - board.width / 2 >= board.host.position.x - board.host.size.x / 2 - 1e-7);
      assert.ok(board.position.x + board.width / 2 <= board.host.position.x + board.host.size.x / 2 + 1e-7);
      assert.ok(board.position.y - board.height / 2 >= board.host.position.y - board.host.size.y / 2 - 1e-7);
      assert.ok(board.position.y + board.height / 2 <= board.host.position.y + board.host.size.y / 2 + 1e-7);
      assert.ok(Math.abs(Math.abs(board.position.z - board.host.position.z) - board.host.size.z / 2 - .003) < 1e-7);
    }
    if (boards.length) stations++;
  }
  assert.ok(stations > 10); assert.equal(JSON.stringify(world), original);
});

function smallFixture(): { world: WorldDefinition; state: SimState; station: NetworkNode } {
  const station: NetworkNode = { id: 'test-station', name: '测试驿站', districtId: 'market', position: { x: 0, y: 0, z: 0 }, station: true };
  // Read-only rendering fixtures, not closure/vehicle transactions or a live
  // city: the test intentionally provides closed and distant observed states.
  const edges = ['road', 'maglev'].map((mode, i) => ({ id: `test-${mode}`, mode, from: station.id, to: `test-other-${i}` })) as NetworkEdge[];
  const state = { vehicles: [{ edgeId: 'test-road', position: { x: 0, y: 0, z: 0 } }, { edgeId: 'test-maglev', position: { x: 0, y: 20, z: 0 } }, { edgeId: 'unrelated', position: station.position }], signals: {}, roadNetwork: { closures: [] } } as unknown as SimState;
  return { world: { ...world, nodes: [station], edges }, state, station };
}

test('station status reads actual closure, signal and observed vehicle position while keeping its input state byte-identical', () => {
  const { world: fixture, state, station } = smallFixture(); let before = JSON.stringify(state);
  const first = describeStationBoard(fixture, state, station);
  assert.deepEqual(first.connections, ['道路', '磁悬浮']); assert.equal(first.signal, '信号未登记'); assert.equal(first.nearbyVehicles, 1); assert.equal(first.closed, 0);
  assert.equal(JSON.stringify(state), before);
  state.roadNetwork!.closures.push({ edgeId: 'test-road', reopenedAt: null } as any); state.signals![station.id] = 0; before = JSON.stringify(state);
  const closed = describeStationBoard(fixture, state, station);
  assert.deepEqual(closed.connections, ['磁悬浮']); assert.equal(closed.closed, 1); assert.equal(closed.total, 2); assert.equal(closed.signal, '路口等候'); assert.notEqual(first.signature, closed.signature);
  assert.equal(JSON.stringify(state), before);
  state.roadNetwork!.closures[0].reopenedAt = 42; state.signals![station.id] = 1;
  assert.deepEqual(describeStationBoard(fixture, state, station).connections, ['道路', '磁悬浮']); assert.equal(describeStationBoard(fixture, state, station).signal, '路口通行');
});

test('station art has a hard texture budget, reuses unchanged frames and disposes resources on eviction', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = { fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '', textBaseline: '', font: '', fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  const { world: fixture, state, station } = smallFixture();
  fixture.nodes = Array.from({ length: 12 }, (_, i) => ({ ...station, id: `${station.id}-${i}`, position: { x: i, y: 0, z: 0 } }));
  const scene = new THREE.Scene(), pool = new StationWayfindingPool(scene, fixture), initialState = JSON.stringify(state), initialWorld = JSON.stringify(fixture);
  let textureDisposals = 0, materialDisposals = 0, geometryDisposals = 0;
  try {
    pool.update(state, station.position, 500); assert.equal(pool.group.userData.budget.stations, 8); assert.equal(pool.group.userData.budget.textures, 8); assert.equal(pool.group.userData.budget.boards, 32);
    const meshes: THREE.Mesh[] = []; pool.group.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    const ids = meshes.map(mesh => mesh.uuid), textures = new Set<THREE.Texture>(), materials = new Set<THREE.MeshStandardMaterial>();
    for (const mesh of meshes) { const material = mesh.material as THREE.MeshStandardMaterial; materials.add(material); textures.add(material.map!); mesh.geometry.addEventListener('dispose', () => geometryDisposals++); }
    for (const texture of textures) texture.addEventListener('dispose', () => textureDisposals++); for (const material of materials) material.addEventListener('dispose', () => materialDisposals++);
    const versions = [...textures].map(texture => texture.version), paints = pool.group.userData.budget.paints;
    for (let i = 0; i < 300; i++) pool.update(state, station.position);
    const afterMeshes: THREE.Mesh[] = []; pool.group.traverse(object => { if (object instanceof THREE.Mesh) afterMeshes.push(object); });
    assert.deepEqual(afterMeshes.map(mesh => mesh.uuid), ids); assert.deepEqual([...textures].map(texture => texture.version), versions); assert.equal(pool.group.userData.budget.paints, paints);
    assert.equal(JSON.stringify(state), initialState); assert.equal(JSON.stringify(fixture), initialWorld);
    pool.update(state, { x: 10000, y: 0, z: 0 }); assert.equal(pool.group.userData.budget.stations, 0);
    assert.equal(textureDisposals, 8); assert.equal(materialDisposals, 8); assert.equal(geometryDisposals, 32);
    pool.update(state, station.position, 0); assert.equal(pool.group.userData.budget.stations, 0);
  } finally { pool.dispose(); pool.dispose(); if (prior) Object.defineProperty(globalThis, 'document', prior); else Reflect.deleteProperty(globalThis, 'document'); }
  assert.equal(scene.children.length, 0); assert.equal(textureDisposals, 8);
});

test('readable institution titles follow actual building uses without claiming an owner or changing its address', () => {
  const original = JSON.stringify(world);
  for (const building of world.buildings) {
    const title = architecturePlaqueTitle(building); assert.ok(Array.from(title).length <= 6); assert.ok(title.length > 0);
    if (building.facility === 'energy') assert.equal(title, '能源调度');
    if (building.kind === 'clinic') assert.equal(title, '医馆诊疗');
    if (building.kind === 'school') assert.equal(title, '书院学堂');
  }
  assert.equal(JSON.stringify(world), original);
});
