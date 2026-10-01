import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world.ts';
import { getFloorDimensions } from '../src/access.ts';
import { ArchitectureDetailManager, buildArchitectureDetails, ARCHITECTURE_DETAIL_INSTANCES, architectureFunctionLabel } from '../src/rendering/architecture-detail.ts';

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
      const lowX = part.position.x - part.size.x / 2, highX = part.position.x + part.size.x / 2;
      const lowY = part.position.y - part.size.y / 2, highY = part.position.y + part.size.y / 2;
      const lowZ = part.position.z - part.size.z / 2, highZ = part.position.z + part.size.z / 2;
      const inApproach = lowZ < building.depth / 2 + 6 && highZ > building.depth / 2 - 1;
      const inBodyHeight = lowY < Math.min(doorHeight, 1.8) && highY > .5;
      const inDoorAxis = lowX < doorWidth / 2 && highX > -doorWidth / 2;
      assert(!(inApproach && inBodyHeight && inDoorAxis), `${building.id}: ${part.purpose} would obstruct its doorway`);
      for (const dimension of Object.values(part.size)) assert(Math.abs(dimension * 5 - Math.round(dimension * 5)) < 1e-8);
    }
  }
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
