import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world.ts';
import { containsUnion, getBuildingBody, getFloorPlanRoofRegions, wallPanels } from '../src/architecture-floor-plan.ts';
import { buildProgramArchitecture } from '../src/rendering/architecture-bodies.ts';
import { ArchitectureDetailManager, architectureProgramRoofEdges, architectureProgramSignPlacement, buildArchitectureDetails } from '../src/rendering/architecture-detail.ts';
import type { ArchitectureDetailPart } from '../src/rendering/architecture-detail.ts';

const world = createWorld(20261001, 'current-v4');
const bounds = (part: ArchitectureDetailPart) => new THREE.Box3(
  new THREE.Vector3(part.position.x - part.size.x / 2, part.position.y - part.size.y / 2, part.position.z - part.size.z / 2),
  new THREE.Vector3(part.position.x + part.size.x / 2, part.position.y + part.size.y / 2, part.position.z + part.size.z / 2));

test('v4 near lattice belongs to real glass openings and retains the voxel and instance limits', () => {
  for (const building of world.buildings) {
    const body = getBuildingBody(building); if (!body) continue;
    for (const floor of [0, building.floors - 1]) {
      const parts = buildArchitectureDetails(building, floor, 10000);
      assert(parts.length <= 640, `${building.id} exceeded the fixed budget`);
      assert(parts.some(part => part.purpose === 'window'), `${building.id} needs a real window bay`);
      for (const part of parts) {
        const box = bounds(part);
        for (const v of [...box.min.toArray(), ...box.max.toArray()]) assert(Math.abs(v * 5 - Math.round(v * 5)) < 1e-7, `${building.id}: final detail vertex is off .2m lattice`);
        if (part.purpose !== 'window') continue;
        const plan = body.floorPlans.find(plan => plan.floor === part.floor)!;
        const glass = wallPanels(plan).filter(panel => panel.kind === 'glass').map(panel => new THREE.Box3(
          new THREE.Vector3(panel.rect.x0, plan.y + panel.bottom, panel.rect.z0),
          new THREE.Vector3(panel.rect.x1, plan.y + panel.top, panel.rect.z1)));
        assert(glass.some(box => box.distanceToPoint(new THREE.Vector3(part.position.x, part.position.y, part.position.z)) <= .45), `${building.id}:${part.floor} drew a lattice away from real glass`);
      }
    }
  }
});

test('v4 all real door openings stay empty at body height and plaques mount on solid wall bays', () => {
  for (const building of world.buildings) {
    const body = getBuildingBody(building); if (!body) continue;
    const ground = body.floorPlans.find(plan => plan.floor === 0)!, parts = buildArchitectureDetails(building);
    for (const wall of ground.walls.filter(wall => wall.opening)) {
      const opening = wall.opening!, length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]), dx = (wall.b[0] - wall.a[0]) / length, dz = (wall.b[1] - wall.a[1]) / length;
      for (const part of parts.filter(part => part.floor === 0 && !part.roof)) {
        const box = bounds(part); if (box.min.y >= 1.72 || box.max.y <= .05) continue;
        const corners = [[box.min.x, box.min.z], [box.max.x, box.max.z], [box.min.x, box.max.z], [box.max.x, box.min.z]];
        const us = corners.map(([x, z]) => (x - wall.a[0]) * dx + (z - wall.a[1]) * dz), ns = corners.map(([x, z]) => (x - wall.a[0]) * dz - (z - wall.a[1]) * dx);
        assert(!(Math.min(...us) < opening.to - 1e-7 && Math.max(...us) > opening.from + 1e-7 && Math.min(...ns) < .4 && Math.max(...ns) > -.4), `${building.id}: ${part.purpose} obstructs actual ${opening.use} opening`);
      }
    }
    const plaque = architectureProgramSignPlacement(building); assert(plaque, `${building.id} lacks a genuine plaque attachment`);
    assert(![...(plaque.wall.opening ? [plaque.wall.opening] : []), ...(plaque.wall.windows ?? [])].some(gap => plaque.from - .2 < gap.to && plaque.to + .2 > gap.from), `${building.id}: plaque fills a real wall cut`);
  }
});

test('v4 eaves follow exposed shared roof boundaries and touch the actual rendered roof surface', () => {
  for (const building of world.buildings) {
    const body = getBuildingBody(building); if (!body) continue;
    const regions = getFloorPlanRoofRegions(body);
    for (const edge of architectureProgramRoofEdges(building)) {
      const dx = Math.sign(edge.b[0] - edge.a[0]), dz = Math.sign(edge.b[1] - edge.a[1]), x = (edge.a[0] + edge.b[0]) / 2, z = (edge.a[1] + edge.b[1]) / 2;
      const peers = regions.filter(region => region.floor === edge.floor && region.bottom === edge.region.bottom).map(region => region.rect);
      assert(containsUnion(peers, x - dz * .05, z + dx * .05));
      assert(!containsUnion(peers, x + dz * .05, z - dx * .05), `${building.id}: fascia decorates an internal roof-cover seam`);
    }
    const roofs = buildProgramArchitecture(building, 'near')!.filter(part => part.purpose === 'roof');
    for (const part of buildArchitectureDetails(building, building.floors - 1).filter(part => part.purpose === 'tile')) {
      const point = new THREE.Vector3(part.position.x, part.position.y, part.position.z);
      const close = roofs.some(roof => {
        if (roof.floor !== part.floor) return false;
        if (!roof.template) return new THREE.Box3(
          new THREE.Vector3(roof.position.x - roof.size.x / 2, roof.position.y - roof.size.y / 2, roof.position.z - roof.size.z / 2),
          new THREE.Vector3(roof.position.x + roof.size.x / 2, roof.position.y + roof.size.y / 2, roof.position.z + roof.size.z / 2)).distanceToPoint(point) <= .4;
        const { positions, indices } = roof.template;
        const vertex = (i: number) => new THREE.Vector3(roof.position.x + positions[i * 3] * roof.size.x, roof.position.y + positions[i * 3 + 1] * roof.size.y, roof.position.z + positions[i * 3 + 2] * roof.size.z);
        for (let i = 0; i < indices.length; i += 3) if (new THREE.Triangle(vertex(indices[i]), vertex(indices[i + 1]), vertex(indices[i + 2])).closestPointToPoint(point, new THREE.Vector3()).distanceTo(point) <= .4) return true;
        return false;
      });
      assert(close, `${building.id}: tile floats away from real provider roof`);
    }
  }
});

test('v4 near residency preserves eight-building budgets, cutaways and disposal', () => {
  const building = world.buildings.find(building => building.kind === 'home' && building.floors >= 3 && getBuildingBody(building))!;
  const manager = new ArchitectureDetailManager(world.buildings), camera = { ...building.door, y: building.position.y + .6 + building.height / building.floors * 1.1 };
  const matrices = () => { const result: number[][] = []; manager.group.traverse(object => { if (object instanceof THREE.InstancedMesh) for (let index = 0; index < object.count; index++) { const matrix = new THREE.Matrix4(); object.getMatrixAt(index, matrix); result.push(matrix.elements); } }); return result; };
  assert.equal(manager.getStats().instances, 0); manager.update(camera);
  assert(manager.getStats().activeBuildings <= 8); assert(manager.getStats().instances <= 8 * 640);
  const before = matrices(); manager.update(camera, { buildingId: building.id, floor: 0 });
  assert(matrices().some(matrix => new THREE.Matrix4().fromArray(matrix).determinant() === 0));
  manager.update(camera, { buildingId: null }); assert.deepEqual(matrices(), before);
  let disposed = 0; manager.group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.addEventListener('dispose', () => disposed++); });
  manager.update({ x: 100000, y: 100000, z: 100000 }); assert.equal(manager.getStats().instances, 0); assert(disposed > 0);
  manager.dispose(); manager.dispose();
});

test('v4 actual canvas plaques face the real mounting wall and release all private resources', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = { fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: '', textBaseline: '', font: '', fillRect() {}, strokeRect() {}, fillText() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
  const building = world.buildings.find(building => building.kind === 'market' && getBuildingBody(building))!, placement = architectureProgramSignPlacement(building)!;
  const manager = new ArchitectureDetailManager([building]);
  try {
    manager.update(building.door);
    const group = manager.group.children[0];
    const plaque = group.children.find(object => object.name.startsWith('门牌')) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    assert(plaque); assert.equal(plaque.geometry.parameters.width, placement.width); assert.equal(plaque.geometry.parameters.height, placement.height);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plaque.quaternion), length = Math.hypot(placement.wall.b[0] - placement.wall.a[0], placement.wall.b[1] - placement.wall.a[1]);
    assert(normal.distanceTo(new THREE.Vector3((placement.wall.b[1] - placement.wall.a[1]) / length, 0, -(placement.wall.b[0] - placement.wall.a[0]) / length)) < 1e-7);
    assert(plaque.position.distanceTo(new THREE.Vector3(placement.x, placement.y, placement.z)) < .021);
    let disposed = 0; for (const resource of [plaque.geometry, plaque.material, plaque.material.map!]) resource.addEventListener('dispose', () => disposed++);
    manager.update({ x: 100000, y: 100000, z: 100000 }); assert.equal(disposed, 3);
    manager.dispose(); assert.equal(disposed, 3);
  } finally {
    manager.dispose(); if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});
