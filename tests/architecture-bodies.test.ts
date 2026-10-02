import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world';
import { CityRenderer } from '../src/renderer';
import { buildingWorldPosition, canStandInFloorPlan, containsUnion, familyOf, getBuildingBody, getBuildingUsePoints, getFloorPlanRoofRegions, wallPanels } from '../src/architecture-floor-plan';
import { buildProgramArchitecture } from '../src/rendering/architecture-bodies';
import { blocksMarketCounter, marketCounters } from '../src/site-fixtures';
import { clinicalAtPosition } from '../src/simulation/clinical';
import type { Building, WorldDefinition } from '../src/types';

function harness(world: WorldDefinition, buildings: Building[]) {
  const renderer = Object.create(CityRenderer.prototype) as any;
  renderer.world = { ...world, buildings }; renderer.scene = new THREE.Scene(); renderer.chunks = []; renderer.interiors = new Map(); renderer.distantRefs = new Map();
  renderer.materials = Object.fromEntries(['wall', 'wood', 'stone', 'roof', 'glass', 'cyan', 'amber', 'red'].map(key => [key, new THREE.MeshStandardMaterial()]));
  renderer.buildCity();
  return { renderer, dispose() {
    renderer.nearChunks.dispose(); renderer.scene.traverse((object: THREE.Object3D) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (object instanceof THREE.InstancedMesh) object.dispose(); } });
    Object.values(renderer.materials).forEach((material: any) => material.dispose());
  } };
}
const world = createWorld();
const families = ['home', 'market', 'workshop', 'civic-academy', 'finance-health', 'transport-waterfront'] as const;
const buildings = families.map(family => world.buildings.find(b => getBuildingBody(b) && familyOf(b) === family)!);
const roofVertices = (refs: any[]) => refs.filter(ref => ref.roof).map(ref => {
  const positions = ref.mesh.geometry.getAttribute('position');
  const points = Array.from({ length: positions.count }, (_, i) => {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(ref.matrix);
    return [p.x, p.y, p.z].map(value => Math.round(value * 1000)).join(',');
  });
  return [...new Set(points)].sort().join('|');
}).sort();

test('all six production bodies retain the same actual instanced roofs in both levels of detail', () => {
  const { renderer, dispose } = harness(world, buildings);
  try {
    for (const building of buildings) {
      const far = roofVertices(renderer.distantRefs.get(building.id));
      renderer.nearChunks.update(building.door, { quality: 'balanced', insideBuildingId: building.id });
      const nearRefs = renderer.interiors.get(building.id), near = roofVertices(nearRefs);
      assert.ok(near.length > 1, `${building.id} has distinct roofs over actual wings`);
      assert.deepEqual(near, far, `${building.id}: switching LOD cannot move or fill a roof`);
      let gables = 0;
      for (const ref of nearRefs) {
        if (!ref.mesh.name.includes(':template:')) continue;
        const positions = ref.mesh.geometry.getAttribute('position'), indices = ref.mesh.geometry.index!;
        const centre = new THREE.Vector3().setFromMatrixPosition(ref.matrix); let volume = 0;
        for (let i = 0; i < indices.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i)).applyMatrix4(ref.matrix).sub(centre);
          const b = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + 1)).applyMatrix4(ref.matrix).sub(centre);
          const c = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + 2)).applyMatrix4(ref.matrix).sub(centre);
          volume += a.dot(b.clone().cross(c)) / 6;
        }
        assert.ok(volume > 0, `${building.id}: final batch faces point outwards`);
        const bounds = new THREE.Box3().setFromBufferAttribute(positions).applyMatrix4(ref.matrix);
        assert.ok(getFloorPlanRoofRegions(getBuildingBody(building)!).some(region => {
          const a = buildingWorldPosition(building, { x: region.rect.x0, y: region.bottom, z: region.rect.z0 });
          const z = buildingWorldPosition(building, { x: region.rect.x1, y: region.top, z: region.rect.z1 });
          return bounds.min.distanceTo(new THREE.Vector3(a.x, a.y, a.z)) < .001 && bounds.max.distanceTo(new THREE.Vector3(z.x, z.y, z.z)) < .001;
        }), `${building.id}: minimum-corner provider data must not be displaced by a centred batch matrix`);
        gables++;
      }
      assert.ok(gables > 0);
    }
  } finally { dispose(); }
});

test('real courts stay open above a standing body in both actual near and far meshes', () => {
  const { renderer, dispose } = harness(world, buildings);
  try {
    let courts = 0;
    for (const building of buildings) {
      const body = getBuildingBody(building)!, ground = body.floorPlans.find(p => p.floor === 0)!;
      let local: { x: number; y: number; z: number } | undefined;
      for (let z = ground.broadphase.z0 + 1; !local && z < ground.broadphase.z1 - 1; z += .8) for (let x = ground.broadphase.x0 + 1; x < ground.broadphase.x1 - 1; x += .8) {
        const underWall = body.floorPlans.some(p => wallPanels(p).some(panel => x >= panel.rect.x0 - .7 && x <= panel.rect.x1 + .7 && z >= panel.rect.z0 - .7 && z <= panel.rect.z1 + .7));
        // A doorway lintel belongs above its threshold. This probe selects an
        // open court, with full clearance from every actual wall at all levels.
        if (!underWall && canStandInFloorPlan(ground, x, z) && containsUnion(ground.courtyard, x, z) && !body.floorPlans.some(p => containsUnion([...p.interior, ...p.circulation], x, z))) { local = { x, y: ground.y + 1.72, z }; break; }
      }
      if (!local) continue; // A bank's two complete public floors have no court.
      const eye = buildingWorldPosition(building, local), ray = new THREE.Raycaster(new THREE.Vector3(eye.x, eye.y, eye.z), new THREE.Vector3(0, 1, 0), 0, building.height + 3);
      renderer.scene.updateMatrixWorld(true);
      assert.equal(ray.intersectObject(renderer.scene, true).length, 0, `${building.id}: far proxy cannot seal the court`);
      renderer.nearChunks.update(building.door, { quality: 'low', insideBuildingId: building.id }); renderer.scene.updateMatrixWorld(true);
      assert.equal(ray.intersectObject(renderer.scene, true).length, 0, `${building.id}: real near roofs cannot seal the court`);
      courts++;
      renderer.nearChunks.update({ x: 10000, y: 10000, z: 10000 }, { quality: 'low', renderDistance: 900 });
    }
    assert.ok(courts >= 5, 'actual market, home, workshop, academy and station courts were exercised');
  } finally { dispose(); }
});

test('actual intermediate roof triangles clear every occupied upper wing', () => {
  const { renderer, dispose } = harness(world, buildings); let roofs = 0;
  try {
    for (const building of buildings) {
      const body = getBuildingBody(building)!;
      renderer.nearChunks.update(building.door, { quality: 'balanced', insideBuildingId: building.id });
      for (const ref of renderer.interiors.get(building.id)) {
        if (!ref.roof || ref.floor < 0 || ref.floor >= building.floors - 1) continue;
        const next = body.floorPlans.find(p => p.floor === ref.floor + 1)!;
        const geometry = ref.mesh.geometry, positions = geometry.getAttribute('position'), indices = geometry.index!;
        for (const region of next.interior) {
          const a = buildingWorldPosition(building, { x: region.x0 + .35, y: next.y + .3, z: region.z0 + .35 });
          const b = buildingWorldPosition(building, { x: region.x1 - .35, y: next.ceilingY - .6, z: region.z1 - .35 });
          if (b.x <= a.x || b.z <= a.z) continue;
          const occupied = new THREE.Box3(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z));
          const vertex = (i: number) => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i)).applyMatrix4(ref.matrix);
          for (let i = 0; i < indices.count; i += 3) assert.ok(!occupied.intersectsTriangle(new THREE.Triangle(vertex(i), vertex(i + 1), vertex(i + 2))), `${building.id}: floor ${ref.floor} roof intersects a real upper wing`);
        }
        roofs++;
      }
    }
    assert.ok(roofs > 15, 'exposed lower wings and their occupied upper neighbours were actually exercised');
  } finally { dispose(); }
});

test('four historical recipes and preserved landmarks cannot acquire program geometry', () => {
  for (const recipe of ['legacy-ee3e7a1', 'current-v2-r5', 'current-v2', 'current-v3'] as const) {
    for (const building of createWorld(78, recipe).buildings) assert.equal(buildProgramArchitecture(building, 'near'), null);
  }
  assert.equal(buildProgramArchitecture(world.buildings.find(b => b.id === 'core-main')!, 'near'), null);
  for (const building of world.buildings.filter(b => b.kind === 'pavilion')) assert.equal(buildProgramArchitecture(building, 'near'), null);
});

test('v4 sale bays draw the same physical cabinets while keeping their real use points clear', () => {
  const building = buildings.find(b => b.kind === 'market')!, counters = marketCounters(world, building);
  assert.equal(counters.length, 3, 'the three actual shop bays each have a supported cabinet');
  const renderer = Object.create(CityRenderer.prototype) as any, boxes: any[][] = [];
  renderer.world = world; renderer.buildHouse(building, { box: (...args: any[]) => boxes.push(args) }, false);
  for (const counter of counters) {
    const matches = boxes.filter(([, x, , z, sx, , sz]) => Math.abs(x - counter.position.x) < 1e-7 && Math.abs(z - counter.position.z) < 1e-7 && Math.abs(sx - counter.size.x) < 1e-7 && Math.abs(sz - counter.size.z) < 1e-7);
    assert.ok(matches.some(([, , y, , , sy]) => Math.abs(sy - .8) < 1e-7 && Math.abs(y - sy / 2 - (counter.position.y - .5)) < 1e-7));
    assert.ok(matches.some(([, , y, , , sy]) => Math.abs(sy - .2) < 1e-7 && Math.abs(y + sy / 2 - (counter.position.y + .5)) < 1e-7));
  }
  const salePoints = getBuildingUsePoints(building, 0).filter(point => point.purpose === 'sale');
  assert.equal(salePoints.length, 3);
  for (const point of salePoints) assert.equal(blocksMarketCounter(counters, point.position, point.position), false, `${point.id}: the standing body must remain outside its cabinet`);
});

test('clinical UI and care require the actual public service point rather than an empty ward court', () => {
  const site = world.buildings.find(b => b.kind === 'clinic' && getBuildingBody(b))!, body = getBuildingBody(site)!, ground = body.floorPlans.find(p => p.floor === 0)!;
  const identity = { role: 'traveler' as const, identities: ['traveler' as const] };
  const service = getBuildingUsePoints(site, 0).find(point => point.purpose === 'service')!;
  assert.equal(clinicalAtPosition(site, service.position, identity), true);
  let openCourt: { x: number; y: number; z: number } | undefined;
  for (const r of ground.courtyard) {
    const point = { x: (r.x0 + r.x1) / 2, y: ground.y, z: (r.z0 + r.z1) / 2 };
    if (canStandInFloorPlan(ground, point.x, point.z) && !containsUnion(ground.interior, point.x, point.z)) { openCourt = point; break; }
  }
  assert.ok(openCourt, 'the generated clinic has a genuinely supported outdoor court');
  assert.equal(clinicalAtPosition(site, buildingWorldPosition(site, openCourt), identity), false);
  const last = body.floorPlans[body.floorPlans.length - 1];
  const restricted = { ...site, publicFloors: 1, floorPermissions: Array.from({ length: site.floors }, (_, i) => i === 0 ? 'public' : 'doctor') };
  const upperService = getBuildingUsePoints(restricted, last.floor).find(point => point.purpose === 'service')!;
  assert.equal(clinicalAtPosition(restricted, upperService.position, identity), false, 'geometry must preserve public clinical floor restrictions');
});
