import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world.ts';
import { getFloorDimensions } from '../src/access.ts';
import { CityRenderer } from '../src/renderer.ts';
import { createRoofGeometry, type RoofProfile } from '../src/rendering/architecture-layout.ts';
import { ArchitectureDetailManager, buildArchitectureDetails, ARCHITECTURE_DETAIL_INSTANCES, architectureFunctionLabel, architectureSignPlacement } from '../src/rendering/architecture-detail.ts';
import type { Building } from '../src/types.ts';

const world = createWorld();

test('near architecture generates no city instances at startup, caps its live budget and releases distant buffers', () => {
  const manager = new ArchitectureDetailManager(world.buildings);
  assert.equal(manager.group.children.length, 0); assert.equal(manager.getStats().instances, 0);
  const building = world.buildings.find(site => site.kind === 'market')!;
  manager.update({ ...building.door, y: building.door.y + 1.7 });
  const active = manager.getStats(); assert(active.activeBuildings > 0); assert(active.activeBuildings <= 8); assert(active.instances <= 8 * ARCHITECTURE_DETAIL_INSTANCES);
  let disposedBuffers = 0;
  manager.group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.addEventListener('dispose', () => disposedBuffers++); });
  manager.update({ x: 100000, y: 100000, z: 100000 });
  assert.equal(manager.getStats().instances, 0); assert.equal(manager.group.children.length, 0); assert.equal(manager.getStats().released, active.activeBuildings); assert(disposedBuffers > 0);
  manager.dispose(); manager.dispose();
  manager.update(building.door); assert.equal(manager.getStats().activeBuildings, 0);
});

test('human-scale facade details leave every generated building south doorway and approach clear', () => {
  for (const building of world.buildings.filter(site => site.kind !== 'pavilion')) {
    const doorWidth = Math.min(5, building.width * .22), fh = building.height / building.floors, doorHeight = Math.min(4.4, Math.max(2.4, fh - .5) * .72);
    const parts = buildArchitectureDetails(building);
    assert(parts.length <= ARCHITECTURE_DETAIL_INSTANCES); assert(parts.some(part => part.purpose === 'window'));
    for (const part of parts) {
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0])));
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(part.position.x, part.position.y, part.position.z), rotation, new THREE.Vector3(part.size.x, part.size.y, part.size.z));
      const bounds = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5)).applyMatrix4(matrix);
      const lowX = bounds.min.x, highX = bounds.max.x, lowY = bounds.min.y, highY = bounds.max.y, lowZ = bounds.min.z, highZ = bounds.max.z;
      const inApproach = lowZ < building.depth / 2 + 6 && highZ > building.depth / 2 - 1;
      const inBodyHeight = lowY < Math.min(doorHeight, 1.8) && highY > .5;
      const inDoorAxis = lowX < doorWidth / 2 && highX > -doorWidth / 2;
      assert(!(inApproach && inBodyHeight && inDoorAxis), `${building.id}: ${part.purpose} would obstruct its doorway`);
      for (const dimension of Object.values(part.size)) assert(Math.abs(dimension * 5 - Math.round(dimension * 5)) < 1e-8);
    }
  }
});

test('eave details touch the real structural roof rather than creating a second floating roof', () => {
  type RecordedBox = { key: string; bounds: THREE.Box3 };
  type BoxWriter = ((key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, floor?: number, roof?: boolean, color?: string) => void) & { profile?: (profile: RoofProfile) => void };
  const renderer = Object.create(CityRenderer.prototype) as { programRoof: (building: Building, box: BoxWriter, w: number, d: number, y: number, floor: number, magnitude: number, far: boolean) => void };
  const units = { hip: createRoofGeometry('hip'), gable: createRoofGeometry('gable') };
  const surfaceDistance = (profile: RoofProfile, point: THREE.Vector3): number => {
    const geometry = units[profile.form], vertices = geometry.getAttribute('position'), indices = geometry.index!;
    const transform = (index: number) => new THREE.Vector3(profile.x + vertices.getX(index) * (profile.width + profile.overhang * 2), profile.y + .4 + vertices.getY(index) * profile.rise, profile.z + vertices.getZ(index) * (profile.depth + profile.overhang * 2));
    let distance = Infinity;
    for (let index = 0; index < indices.count; index += 3) {
      const triangle = new THREE.Triangle(transform(indices.getX(index)), transform(indices.getX(index + 1)), transform(indices.getX(index + 2)));
      distance = Math.min(distance, triangle.closestPointToPoint(point, new THREE.Vector3()).distanceTo(point));
    }
    return distance;
  };
  for (const building of world.buildings.filter(site => site.kind !== 'pavilion')) {
    const top = building.floors - 1, parts = buildArchitectureDetails(building, top), tiles = parts.filter(part => part.purpose === 'tile');
    if (building.kind === 'bank' || building.kind === 'clinic') { assert.equal(tiles.length, 0); continue; }
    assert(tiles.length > 0, `${building.id}: roof detail missing`);
    const roofs = new Map<number, RecordedBox[]>();
    const surfaces = new Map<number, RoofProfile[]>();
    for (const floor of new Set(tiles.map(tile => tile.floor))) {
      const boxes: RecordedBox[] = [], dimension = getFloorDimensions(building, floor), last = floor === top;
      const profiles: RoofProfile[] = [];
      const record: BoxWriter = (key, x, y, z, sx, sy, sz) => boxes.push({ key, bounds: new THREE.Box3(new THREE.Vector3(x - sx / 2, y - sy / 2, z - sz / 2), new THREE.Vector3(x + sx / 2, y + sy / 2, z + sz / 2)) });
      record.profile = profile => profiles.push(profile);
      renderer.programRoof(building, record, dimension.width * (last ? 1 : 1.035), dimension.depth * (last ? 1 : 1.035), (floor + 1) * building.height / building.floors, floor, last ? 1 : .55, false);
      assert(profiles.length > 0, `${building.id}: must exercise the actual curved roof path`);
      roofs.set(floor, boxes.filter(box => box.key === 'roof' || box.key === 'wood'));
      surfaces.set(floor, profiles);
    }
    for (const tile of tiles) {
      const point = new THREE.Vector3(tile.position.x, tile.position.y, tile.position.z);
      assert(roofs.get(tile.floor)!.some(box => box.bounds.distanceToPoint(point) <= .6) || surfaces.get(tile.floor)!.some(profile => surfaceDistance(profile, point) <= .6), `${building.id}: eave floats away from the generated curved roof`);
    }
  }
  units.hip.dispose(); units.gable.dispose();
});

test('the open observation floor stays free of invented window walls', () => {
  const core = world.buildings.find(building => building.id === 'core-main')!, top = core.floors - 1;
  const parts = buildArchitectureDetails(core, top);
  assert(parts.some(part => part.floor === top && part.purpose === 'tile'));
  assert(parts.every(part => part.floor !== top || part.purpose !== 'window' && part.purpose !== 'frame'));
});

test('narrow physical plaques retain the full building name and release their own GPU resources', () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), text: string[] = [];
  const context = { fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '', textBaseline: '', font: '', fillRect() {}, strokeRect() {}, fillText(value: string) { text.push(value); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  const building = world.buildings.find(site => site.kind === 'market')!, manager = new ArchitectureDetailManager([building]);
  try {
    manager.update(building.door);
    let plaque: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | undefined;
    manager.group.traverse(object => { if (object instanceof THREE.Mesh && object.name.startsWith('门牌')) plaque = object; });
    assert(plaque); assert(plaque.geometry.parameters.width <= 1.2); assert(plaque.geometry.parameters.height >= 2.4);
    assert.equal(plaque.material.map!.image.width, 512); assert.equal(plaque.material.map!.image.height, 1024);
    assert(text.join('').includes(building.name));
    const placement = architectureSignPlacement(building), doorWidth = Math.min(5, building.width * .22);
    assert(Math.abs(placement.x) - placement.width / 2 > doorWidth / 2);
    let released = 0;
    for (const resource of [plaque.geometry, plaque.material, plaque.material.map!]) resource.addEventListener('dispose', () => released++);
    manager.update({ x: 100000, y: 100000, z: 100000 }); assert.equal(released, 3);
    manager.dispose(); assert.equal(released, 3);
  } finally {
    manager.dispose();
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('lanterns follow continuous daylight and actual power without adding point lights', () => {
  const building = world.buildings.find(site => site.kind === 'home')!, manager = new ArchitectureDetailManager([building]);
  manager.update(building.door);
  manager.setLighting(1, 1); const day = manager.getStats().lanternEmission;
  manager.setLighting(0, 1); const night = manager.getStats().lanternEmission;
  assert(night > day);
  manager.setLighting(0, .5); assert.equal(manager.getStats().lanternEmission, night / 2);
  manager.setLighting(0, 0); assert.equal(manager.getStats().lanternEmission, 0);
  let lights = 0, luminousMeshes = 0;
  manager.group.traverse(object => { if (object instanceof THREE.PointLight) lights++; if (object.name === '灯笼暖光') { luminousMeshes++; assert.equal((object as THREE.InstancedMesh).material instanceof THREE.MeshStandardMaterial, true); } });
  assert.equal(lights, 0); assert.equal(luminousMeshes, 1);
  manager.dispose();
});

test('high core floors attach their front lattice to the shared narrowed footprint', () => {
  const core = world.buildings.find(building => building.id === 'core-main')!, floor = 25, dimension = getFloorDimensions(core, floor);
  const parts = buildArchitectureDetails(core, floor).filter(part => part.floor === floor && part.purpose === 'window');
  assert(parts.length > 20);
  const front = parts.filter(part => part.position.z > dimension.depth / 2 && Math.abs(part.position.x) < dimension.width / 2);
  assert(front.length > 10); assert(front.every(part => part.position.z < dimension.depth / 2 + 1));
  assert.equal(dimension.width, 72); assert.equal(dimension.depth, 56);
});

test('interior cutaways hide tagged upper decorations and restore them on leaving', () => {
  const building = world.buildings.find(site => site.kind === 'home' && site.floors >= 3)!;
  const manager = new ArchitectureDetailManager([building]), camera = { ...building.door, y: building.position.y + .6 + building.height / building.floors * 1.1 };
  const matrices = (): THREE.Matrix4[] => { const result: THREE.Matrix4[] = []; manager.group.traverse(object => { if (object instanceof THREE.InstancedMesh) for (let index = 0; index < object.count; index++) { const matrix = new THREE.Matrix4(); object.getMatrixAt(index, matrix); result.push(matrix); } }); return result; };
  manager.update(camera); const before = matrices();
  manager.update(camera, { buildingId: building.id, floor: 0 }); const inside = matrices();
  assert.equal(before.length, inside.length); assert(inside.some(matrix => matrix.determinant() === 0));
  manager.update(camera, { buildingId: null }); const after = matrices();
  assert.deepEqual(after.map(matrix => matrix.elements), before.map(matrix => matrix.elements)); manager.dispose();
});

test('pavilions stay open and function signs describe actual building uses', () => {
  const pavilion = world.buildings.find(site => site.kind === 'pavilion')!;
  const parts = buildArchitectureDetails(pavilion);
  assert(parts.length > 20); assert(parts.every(part => part.purpose !== 'window' && part.purpose !== 'door'));
  assert.match(architectureFunctionLabel(world.buildings.find(site => site.kind === 'market')!), /买卖/);
  assert.match(architectureFunctionLabel(world.buildings.find(site => site.facility === 'data')!), /数据/);
});
