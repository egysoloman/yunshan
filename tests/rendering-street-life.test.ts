import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../src/world';
import { getBuildingBody, type FloorFixture } from '../src/architecture-floor-plan';
import { buildProgramArchitecture, type ProgramArchitecturePart } from '../src/rendering/architecture-bodies';
import { MarketGoodsPool, createMarketFoodSampleGeometry } from '../src/rendering/market-goods';
import { installArchitecturalFinishes } from '../src/rendering/architectural-finishes';
import { CityRenderer } from '../src/renderer';
import type { SimState, Vec3, WorldDefinition } from '../src/types';

const world = createWorld();

test('all current furniture finishes stay within real fixture volumes and linen belongs only to beds', () => {
  const original = JSON.stringify(world); let furnitureCount = 0, linenCount = 0;
  for (const building of world.buildings) {
    const body = getBuildingBody(building), parts = buildProgramArchitecture(building, 'near');
    if (!body || !parts) continue;
    for (const plan of body.floorPlans) {
      const furniture: ProgramArchitecturePart[] = parts.filter(part => part.floor === plan.floor && part.purpose === 'furniture');
      assert.ok(furniture.length <= plan.fixtures.length * 8, `${building.id}/${plan.floor}: original eight-piece fixture bound`);
      for (let index = 0; index < furniture.length; index++) {
        const part: ProgramArchitecturePart = furniture[index];
        const min: Vec3 = { x: part.position.x - part.size.x / 2, y: part.position.y - part.size.y / 2, z: part.position.z - part.size.z / 2 };
        const max: Vec3 = { x: part.position.x + part.size.x / 2, y: part.position.y + part.size.y / 2, z: part.position.z + part.size.z / 2 };
        const host: FloorFixture | undefined = plan.fixtures.find(fixture => min.x >= fixture.rect.x0 - 1e-7 && max.x <= fixture.rect.x1 + 1e-7 && min.z >= fixture.rect.z0 - 1e-7 && max.z <= fixture.rect.z1 + 1e-7 && min.y >= plan.y + fixture.bottom - 1e-7 && max.y <= plan.y + fixture.top + 1e-7);
        assert.ok(host, `${building.id}/${plan.floor}: decorative finish must be hosted by a real fixture`);
        if (part.material === 'fabric') { assert.equal(host.kind, 'bed'); linenCount++; }
        furnitureCount++;
      }
    }
  }
  assert.ok(furnitureCount > 1000); assert.ok(linenCount > 100); assert.equal(JSON.stringify(world), original);
  console.log(JSON.stringify({ scope: 'current-world-only', buildings: world.buildings.length, furnitureParts: furnitureCount, linenParts: linenCount, unchangedWorld: true }));
});

test('wrapped food geometry retains the original sample bounds and has one finite reusable template', () => {
  const geometry = createMarketFoodSampleGeometry();
  try {
    assert.equal(geometry.getAttribute('position').count / 3, 48);
    for (const axis of ['x', 'y', 'z'] as const) { assert.ok(geometry.boundingBox!.min[axis] >= -.5 - 1e-7); assert.ok(geometry.boundingBox!.max[axis] <= .5 + 1e-7); }
    assert.equal(geometry.getAttribute('normal').count, geometry.getAttribute('position').count);
    assert.equal(geometry.getAttribute('color').count, geometry.getAttribute('position').count);
    assert.ok([...geometry.getAttribute('position').array].every(Number.isFinite));
  } finally { geometry.dispose(); }
});

test('food pool uploads only changed filtered slots and removes stock on closure, eviction, distance and expired lease', () => {
  const building = world.buildings.find(building => building.id === 'market-b0')!;
  const localWorld = { ...world, buildings: [building] } as WorldDefinition, scene = new THREE.Scene(), pool = new MarketGoodsPool(scene, localWorld);
  // Controlled render inputs: these cases claim no business transaction, actor
  // movement, rent payment or authority change in the live city.
  const state = { day: 1, hour: 0, shops: [{ id: 'display-shop', buildingId: building.id, open: true, inventory: 8 }], citizens: [{ id: 'lessor' }, { id: 'tenant' }], extension: { lastUpdate: 0, actorProfiles: { lessor: { alive: true }, tenant: { alive: true } } } } as unknown as SimState;
  const originalWorld = JSON.stringify(localWorld), savedView = JSON.stringify(state), resident = new Set([building.id]), camera = building.door;
  let geometryDisposed = 0, materialDisposed = 0, meshDisposed = 0;
  pool.mesh.geometry.addEventListener('dispose', () => geometryDisposed++);
  (pool.mesh.material as THREE.Material).addEventListener('dispose', () => materialDisposed++);
  pool.mesh.addEventListener('dispose', () => meshDisposed++);
  try {
    pool.update(state, camera, resident); assert.equal(pool.mesh.count, 8);
    const version = pool.mesh.instanceMatrix.version, colorVersion = pool.mesh.instanceColor!.version;
    for (let frame = 0; frame < 300; frame++) pool.update(state, camera, resident);
    assert.equal(pool.mesh.instanceMatrix.version, version); assert.equal(pool.mesh.instanceColor!.version, colorVersion); assert.equal(pool.mesh.userData.budget.uploads, 1);
    assert.equal(JSON.stringify(state), savedView);
    state.shops[0].inventory = 8.5; pool.update(state, camera, resident); assert.equal(pool.mesh.instanceMatrix.version, version);
    state.shops[0].inventory = 2; pool.update(state, camera, resident); assert.equal(pool.mesh.count, 2); assert.equal(pool.mesh.userData.budget.triangles, 96);
    pool.update(state, { ...camera, x: camera.x + 10000 }, resident); assert.equal(pool.mesh.count, 0);
    pool.update(state, camera, resident); assert.equal(pool.mesh.count, 2);
    pool.update(state, camera, new Set()); assert.equal(pool.mesh.count, 0);
    state.shops[0].open = false; pool.update(state, camera, resident); assert.equal(pool.mesh.count, 0);
    state.shops[0].open = true; state.shops[0].inventory = 0; pool.update(state, camera, resident); assert.equal(pool.mesh.count, 0);
    state.shops[0].inventory = 2;
    state.shopLifecycle = { version: 1, nextListingId: 1, nextLeaseId: 1, nextReceiptId: 1, titles: {}, listings: [], receipts: [], leases: [{ id: 'render-lease', listingId: 'render-offer', shopId: 'display-shop', state: 'active', tenantId: 'tenant', lessorId: 'lessor', endsAt: 10, rent: 0, periods: 1, startedAt: 0, nextDueAt: 10, accruedPeriods: 0, accruedRent: 0, paidRent: 0, arrears: 0, depositInitial: 0, depositEscrow: 0, depositToLessor: 0, depositRefunded: 0, advanceInitial: 0, advanceRefunded: 0, endedAt: null }] };
    pool.update(state, camera, resident); assert.equal(pool.mesh.count, 2);
    state.extension!.lastUpdate = 10; pool.update(state, camera, resident); assert.equal(pool.mesh.count, 0);
    assert.equal(JSON.stringify(localWorld), originalWorld);
  } finally { pool.dispose(); pool.dispose(); }
  assert.equal(scene.children.length, 0); assert.equal(geometryDisposed, 1); assert.equal(materialDisposed, 1); assert.equal(meshDisposed, 1);
});

test('procedural finishes retain inherited hooks and add no textures or vertex displacement', () => {
  const materials = Object.fromEntries(['wall', 'wood', 'stone', 'fabric'].map(key => [key, new THREE.MeshStandardMaterial()]));
  let called = 0;
  materials.wood.customProgramCacheKey = () => 'inherited-cabinet-v1';
  materials.wood.onBeforeCompile = shader => { called++; shader.fragmentShader += '\n// inherited cabinetry'; };
  installArchitecturalFinishes(materials as Parameters<typeof installArchitecturalFinishes>[0]);
  try {
    assert.ok(materials.wood.customProgramCacheKey().startsWith('inherited-cabinet-v1:'));
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    materials.wood.onBeforeCompile(shader as unknown as Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0], undefined as unknown as THREE.WebGLRenderer);
    assert.equal(called, 1); assert.ok(shader.fragmentShader.includes('// inherited cabinetry'));
    assert.ok(shader.vertexShader.includes('instanceBuildingFinish'));
    assert.ok(!shader.vertexShader.includes('transformed='));
    for (const material of Object.values(materials)) { assert.equal(material.map, null); assert.equal(material.normalMap, null); assert.equal(material.displacementMap, null); }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

test('renderer disposes unused palette and app navigation, preserving engine-shared sprite geometry', () => {
  const renderer = Object.create(CityRenderer.prototype) as any;
  renderer.scene = new THREE.Scene(); renderer.interiors = new Map();
  const emptyOwner = () => ({ dispose() {} });
  renderer.nearChunks = emptyOwner(); renderer.citizens = emptyOwner(); renderer.marketGoods = emptyOwner(); renderer.marketShopfront = emptyOwner(); renderer.architectureDetail = emptyOwner();
  renderer.roadClosures = { ...emptyOwner(), group: new THREE.Group() }; renderer.landscape = { ...emptyOwner(), group: new THREE.Group() };
  const unused = new THREE.MeshStandardMaterial(), attached = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry(1, 1, 1);
  renderer.materials = { fabric: unused, wood: attached }; renderer.scene.add(new THREE.Mesh(geometry, attached));
  const lineGeometry = new THREE.BufferGeometry(), lineMaterial = new THREE.LineBasicMaterial(), spriteMaterial = new THREE.SpriteMaterial();
  const sprite = new THREE.Sprite(spriteMaterial), otherSprite = new THREE.Sprite();
  assert.equal(sprite.geometry, otherSprite.geometry, 'Three.js module-shared geometry is borrowed');
  renderer.scene.add(new THREE.Line(lineGeometry, lineMaterial), sprite);
  let lineGeometryDisposed = 0, lineMaterialDisposed = 0, spriteMaterialDisposed = 0, sharedGeometryDisposed = 0;
  lineGeometry.addEventListener('dispose', () => lineGeometryDisposed++); lineMaterial.addEventListener('dispose', () => lineMaterialDisposed++);
  spriteMaterial.addEventListener('dispose', () => spriteMaterialDisposed++); sprite.geometry.addEventListener('dispose', () => sharedGeometryDisposed++);
  let unusedDisposed = 0, attachedDisposed = 0, geometryDisposed = 0, rendererDisposed = 0, canvasRemoved = 0;
  unused.addEventListener('dispose', () => unusedDisposed++); attached.addEventListener('dispose', () => attachedDisposed++); geometry.addEventListener('dispose', () => geometryDisposed++);
  renderer.renderer = { dispose() { rendererDisposed++; }, domElement: { remove() { canvasRemoved++; } } };
  renderer.dispose();
  assert.equal(unusedDisposed, 1); assert.equal(attachedDisposed, 1); assert.equal(geometryDisposed, 1); assert.equal(rendererDisposed, 1); assert.equal(canvasRemoved, 1); assert.equal(renderer.scene.children.length, 0);
  assert.equal(lineGeometryDisposed, 1); assert.equal(lineMaterialDisposed, 1); assert.equal(spriteMaterialDisposed, 1); assert.equal(sharedGeometryDisposed, 0);
  otherSprite.material.dispose();
});
