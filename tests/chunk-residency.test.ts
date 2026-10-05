import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createWorld } from '../src/world.ts';
import { BUILDING_RENDER_CHUNK_SIZE, NEAR_CHUNK_CAPACITY, NearChunkResidency, buildingChunkBodyDistance, buildingChunkDistance, createBuildingRenderChunks, disposeNearChunkGroup, selectNearBuildingChunks, type BuildingRenderChunk } from '../src/rendering/chunk-residency.ts';
import type { Building, Vec3 } from '../src/types.ts';

const world = createWorld(), evidence: Record<string, unknown>[] = [];
let initialHashes: Record<string, string>;
async function sourceHashes() {
  const paths = ['src/rendering/chunk-residency.ts', 'src/world.ts', 'src/access.ts', 'src/types.ts', 'tests/chunk-residency.test.ts'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')])));
}
before(async () => { initialHashes = await sourceHashes(); });
after(async () => { await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true }); await writeFile(new URL('../artifacts/chunk-residency-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), environment: 'Node Three.js actual geometry/instance disposal and far matrices; no WebGL or renderer integration claim', initialHashes, finalHashes: await sourceHashes(), evidence }, null, 2)); });
interface Ref { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; floor: number; roof: boolean }
interface Resource { group: THREE.Group; refs: Map<string, Ref[]> }

function fixture(chunks: BuildingRenderChunk[]) {
  const sites = chunks.flatMap(chunk => [...chunk.buildings]), scene = new THREE.Scene(), palette = new THREE.MeshStandardMaterial(), refs = new Map<string, Ref[]>(), far = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), palette, sites.length);
  const farRefs = new Map<string, { index: number; matrix: THREE.Matrix4 }>();
  sites.forEach((site, index) => { const matrix = new THREE.Matrix4().makeTranslation(site.position.x, site.position.y, site.position.z); far.setMatrixAt(index, matrix); farRefs.set(site.id, { index, matrix }); }); scene.add(far);
  let live = 0, maxLive = 0, geometryDisposals = 0, instanceDisposals = 0, materialDisposals = 0, budget = 18;
  let inside: { id: string | null; floor: number } = { id: null, floor: 0 }, failCreate = false, failActivate = false;
  palette.addEventListener('dispose', () => materialDisposals++);
  const manager = new NearChunkResidency(chunks, {
    create(chunk): Resource {
      if (failCreate) { failCreate = false; throw new Error('factory failed before allocation'); }
      assert(live < budget, 'eviction must precede GPU allocation'); live++; maxLive = Math.max(maxLive, live);
      const group = new THREE.Group(), local = new Map<string, Ref[]>(), geometry = new THREE.BoxGeometry(1, 1, 1);
      geometry.addEventListener('dispose', () => geometryDisposals++);
      for (const site of chunk.buildings) {
        const count = site.floors * 2, mesh = new THREE.InstancedMesh(geometry, palette, count), references: Ref[] = [];
        mesh.addEventListener('dispose', () => instanceDisposals++);
        for (let floor = 0; floor < site.floors; floor++) for (const roof of [false, true]) {
          const index = floor * 2 + Number(roof), matrix = new THREE.Matrix4().makeTranslation(site.position.x, site.position.y + floor * site.height / site.floors + Number(roof), site.position.z);
          mesh.setMatrixAt(index, matrix); references.push({ mesh, index, matrix, floor, roof });
        }
        local.set(site.id, references); group.add(mesh);
      }
      return { group, refs: local };
    },
    activate(chunk, resource, near) {
      for (const id of chunk.buildingIds) {
        const proxy = farRefs.get(id)!; far.setMatrixAt(proxy.index, near ? new THREE.Matrix4().makeScale(0, 0, 0) : proxy.matrix);
        if (near) {
          refs.set(id, resource.refs.get(id)!);
          // Apply the current room to every new resource; there is deliberately
          // no setInterior call or changed-id guard in this integration stub.
          for (const ref of refs.get(id)!) if (id === inside.id && (ref.floor > inside.floor || ref.roof && ref.floor >= inside.floor)) ref.mesh.setMatrixAt(ref.index, new THREE.Matrix4().makeScale(0, 0, 0));
        } else refs.delete(id);
      }
      far.instanceMatrix.needsUpdate = true;
      if (near) scene.add(resource.group); else resource.group.removeFromParent();
      if (near && failActivate) { failActivate = false; throw new Error('publication failed after scene/ref changes'); }
    },
    release(_chunk, resource) { disposeNearChunkGroup(resource.group); resource.refs.clear(); live--; },
  });
  return { manager, scene, refs, far, sites, setInside: (id: string | null, floor = 0) => { inside = { id, floor }; }, setBudget: (value: number) => { budget = value; }, failCreate: () => { failCreate = true; }, failActivate: () => { failActivate = true; }, stats: () => ({ live, maxLive, geometryDisposals, instanceDisposals, materialDisposals }),
    checkFar() { for (const site of sites) { const ref = farRefs.get(site.id)!, matrix = new THREE.Matrix4(); far.getMatrixAt(ref.index, matrix); if (manager.hasBuilding(site.id)) assert.equal(matrix.elements[0], 0); else assert.deepEqual(matrix.elements, ref.matrix.elements.map(Math.fround)); } },
    dispose() { manager.dispose(); far.dispose(); far.geometry.dispose(); scene.clear(); palette.dispose(); } };
}

test('building metadata partitions the unchanged authority without allocating any near geometry', () => {
  const before = JSON.stringify(world.buildings), chunks = createBuildingRenderChunks(world.buildings), f = fixture(chunks);
  try {
    assert(chunks.length > NEAR_CHUNK_CAPACITY.high); assert.equal(chunks.flatMap(chunk => [...chunk.buildings]).length, world.buildings.length);
    for (const chunk of chunks) for (const site of chunk.buildings) {
      assert.equal(chunk.id, `${Math.floor(site.position.x / BUILDING_RENDER_CHUNK_SIZE)}:${Math.floor(site.position.z / BUILDING_RENDER_CHUNK_SIZE)}`);
      assert.equal(world.buildings.find(building => building.id === site.id), site); assert(chunk.minY <= site.position.y - (site.basements ?? 0) * site.height / site.floors);
      assert(chunk.maxY >= site.position.y + site.height); assert(chunk.radius >= Math.hypot(site.position.x - chunk.center.x, site.position.z - chunk.center.z));
    }
    assert.equal(f.manager.getStats().created, 0); assert.equal(f.scene.children.length, 1); assert.equal(f.refs.size, 0); assert.equal(JSON.stringify(world.buildings), before);
    evidence.push({ check: 'metadata-only-startup', buildings: world.buildings.length, chunks: chunks.length, nearGroups: f.manager.getStats().resident, interiorRefs: f.refs.size });
  } finally { f.dispose(); }
});

test('actual near resources remain bounded while travel unloads geometry, interior refs and instance buffers', () => {
  const before = JSON.stringify(world.buildings), f = fixture(createBuildingRenderChunks(world.buildings));
  try {
    for (let index = 0; index < 25; index++) {
      const site = world.buildings[index * 23 % world.buildings.length]; f.manager.update({ ...site.door, y: site.door.y + 1.7 }, { quality: 'high' });
      assert(f.manager.getStats().resident <= 18); assert.equal(f.stats().live, f.manager.getStats().resident); assert.equal(f.scene.children.length, f.stats().live + 1);
      const residentIds = new Set(f.manager.residents().flatMap(entry => [...entry.chunk.buildingIds])); assert.deepEqual(new Set(f.refs.keys()), residentIds); f.checkFar();
    }
    assert(f.stats().geometryDisposals > 0); assert(f.stats().instanceDisposals > 0); assert.equal(f.stats().materialDisposals, 0);
    f.manager.update({ x: 100000, y: 100000, z: 100000 }, { quality: 'high' });
    assert.equal(f.refs.size, 0); assert.equal(f.scene.children.length, 1); assert.equal(f.stats().live, 0); f.checkFar(); assert.equal(JSON.stringify(world.buildings), before);
    evidence.push({ check: 'real-resource-travel-release', ...f.manager.getStats(), ...f.stats(), materialDisposalsBeforePaletteShutdown: f.stats().materialDisposals });
  } finally { f.dispose(); }
});

test('inside priority and every recreated resource preserve the current high-floor room cutaway', () => {
  const core = world.buildings.find(site => site.id === 'core-main')!, f = fixture(createBuildingRenderChunks(world.buildings));
  try {
    f.setInside(core.id, 25); f.setBudget(8);
    const remote = { x: 100000, y: 100000, z: 100000 }; f.manager.update(remote, { quality: 'low', insideBuildingId: core.id }); assert(f.manager.hasBuilding(core.id));
    const check = () => {
      let visible = 0, hidden = 0;
      for (const ref of f.refs.get(core.id)!) { const matrix = new THREE.Matrix4(); ref.mesh.getMatrixAt(ref.index, matrix); if (ref.floor > 25 || ref.roof && ref.floor >= 25) { assert.equal(matrix.elements[0], 0); hidden++; } else { assert.equal(matrix.elements[0], 1); visible++; } }
      assert(visible > 0 && hidden > 0);
    };
    check(); const first = f.manager.residents().find(entry => entry.chunk.buildingIds.has(core.id))!.resource;
    f.manager.update(remote, { quality: 'low', insideBuildingId: null }); assert.equal(f.refs.size, 0);
    f.manager.update(remote, { quality: 'low', insideBuildingId: core.id }); check();
    assert.notEqual(f.manager.residents().find(entry => entry.chunk.buildingIds.has(core.id))!.resource, first); assert.equal(first.group.children.length, 0); assert.equal(first.refs.size, 0); f.checkFar();
    evidence.push({ check: 'inside-priority-and-recreated-floor25-cutaway', ...f.manager.getStats() });
  } finally { f.dispose(); }
});

test('shell distance includes real upper and underground floors instead of the ground-center height', () => {
  const core = world.buildings.find(site => site.id === 'core-main')!, chunks = createBuildingRenderChunks([core]), chunk = chunks[0];
  const upper = { x: core.position.x, y: core.position.y + core.height * 25.5 / core.floors, z: core.position.z };
  const basement = { x: core.position.x, y: core.position.y - (core.basements ?? 0) * core.height / core.floors + 1, z: core.position.z };
  assert.equal(buildingChunkDistance(chunk, upper), 0); assert.equal(buildingChunkDistance(chunk, basement), 0);
  assert.equal(selectNearBuildingChunks(chunks, upper, { quality: 'low' }).length, 1); assert.equal(selectNearBuildingChunks(chunks, basement, { quality: 'low' }).length, 1);
  assert.equal(selectNearBuildingChunks(chunks, { ...upper, y: chunk.maxY + 500 }, { quality: 'high' }).length, 0);
});

test('real residential door exit keeps its near geometry and every rotated city entrance is covered at low quality', () => {
  const chunks = createBuildingRenderChunks(world.buildings), home = world.buildings.find(site => site.id === 'market-b21')!, f = fixture(chunks);
  assert.equal(home.kind, 'home');
  try {
    f.setBudget(8); f.setInside(home.id, 0);
    f.manager.update({ x: -445, y: 43, z: 546 }, { quality: 'low', insideBuildingId: home.id });
    const entry = f.manager.residents().find(entry => entry.chunk.buildingIds.has(home.id))!.resource;
    f.setInside(null); f.manager.update({ x: -445, y: 43, z: 550 }, { quality: 'low' });
    assert(f.manager.hasBuilding(home.id)); assert.equal(f.manager.residents().find(entry => entry.chunk.buildingIds.has(home.id))!.resource, entry); assert(f.refs.has(home.id)); f.checkFar();
    // This uses the authority's real rotated south entrances, independent of
    // the selector's chunk-center/radius formula and its current resident cache.
    for (const site of world.buildings) {
      const outside = { x: site.door.x - Math.sin(site.rotation) * 2.2, y: site.door.y + 1.7, z: site.door.z + Math.cos(site.rotation) * 2.2 };
      assert(selectNearBuildingChunks(chunks, outside, { quality: 'low' }).some(chunk => chunk.buildingIds.has(site.id)), `${site.id}: low quality dropped the real entrance`);
    }
    evidence.push({ check: 'actual-residential-exit-and-all-rotated-entrances', siteId: home.id, door: home.door, exit: { x: -445, y: 43, z: 550 }, resourceReused: true, testedEntrances: world.buildings.length, missingEntranceChunks: 0 });
  } finally { f.dispose(); }
});

test('a rotated wide building bounding circle cannot outrank the actual nearby body', () => {
  const base = world.buildings.find(site => site.kind === 'home')!;
  const wide: Building = { ...base, id: 'wide', position: { x: 0, y: 20, z: 0 }, door: { x: 0, y: 20, z: 6 }, width: 100, depth: 10, height: 80, floors: 10, floorFootprints: undefined, rotation: Math.PI / 4 };
  const close: Building = { ...base, id: 'close', position: { x: 0, y: 20, z: 40 }, door: { x: 0, y: 20, z: 46 }, width: 10, depth: 10, height: 80, floors: 10, floorFootprints: undefined, rotation: 0 };
  const chunks = createBuildingRenderChunks([wide, close], 1), point = { x: 0, y: 50, z: 40 };
  const rotatedInside = new THREE.Vector3(35, 30, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(wide.rotation)).add(new THREE.Vector3(wide.position.x, wide.position.y, wide.position.z));
  assert.equal(buildingChunkBodyDistance(chunks[0], rotatedInside), 0, 'the priority footprint must follow the actual Three.js renderer rotation');
  assert.equal(buildingChunkDistance(chunks[0], point), 0); assert.equal(buildingChunkDistance(chunks[1], point), 0);
  assert(buildingChunkBodyDistance(chunks[0], point) > 20); assert.equal(buildingChunkBodyDistance(chunks[1], point), 0);
  assert.equal(selectNearBuildingChunks(chunks, point, { quality: 'low' })[0].buildingIds.has(close.id), true);
});

test('a finite exit margin prevents boundary churn and still releases or rebuilds real resources', () => {
  const chunks = createBuildingRenderChunks([world.buildings[0]]), chunk = chunks[0], f = fixture(chunks), camera = (distance: number): Vec3 => ({ x: chunk.center.x + chunk.radius + distance, y: chunk.minY + 1, z: chunk.center.z });
  try {
    f.manager.update(camera(119)); const resource = f.manager.get(chunk.id)!; assert(resource);
    assert.equal(selectNearBuildingChunks(chunks, camera(121)).length, 0); f.manager.update(camera(121)); assert.equal(f.manager.get(chunk.id), resource);
    f.manager.update(camera(143)); assert.equal(f.manager.get(chunk.id), resource); f.manager.update(camera(145)); assert.equal(f.manager.get(chunk.id), undefined); assert.equal(resource.group.children.length, 0);
    f.manager.update(camera(119)); assert.notEqual(f.manager.get(chunk.id), resource); assert.equal(f.manager.getStats().created, 2); assert.equal(f.manager.getStats().released, 1); f.checkFar();
  } finally { f.dispose(); }
});

test('quality reduction and a new inside chunk evict before allocating, with a strict live capacity', () => {
  const base = world.buildings.find(site => site.kind === 'home')!, sites: Building[] = Array.from({ length: 22 }, (_, index) => ({ ...base, id: `site-${index}`, position: { x: index < 20 ? index * 2 : 1000 + index * 100, y: 20, z: 0 } }));
  const f = fixture(createBuildingRenderChunks(sites, 1));
  try {
    f.manager.update({ x: 20, y: 22, z: 0 }, { quality: 'high' }); assert.equal(f.stats().live, 18);
    f.setBudget(8); f.manager.update({ x: 20, y: 22, z: 0 }, { quality: 'low', insideBuildingId: 'site-20' }); assert.equal(f.stats().live, 8); assert(f.manager.hasBuilding('site-20'));
    f.manager.update({ x: 20, y: 22, z: 0 }, { quality: 'low', insideBuildingId: 'site-21' }); assert.equal(f.stats().live, 8); assert(f.manager.hasBuilding('site-21')); assert(!f.manager.hasBuilding('site-20')); f.checkFar();
    evidence.push({ check: 'quality-and-inside-capacity', highCapacity: 18, lowCapacity: 8, maximumAllocated: f.stats().maxLive, ...f.manager.getStats() });
  } finally { f.dispose(); }
});

test('failed creation/publication retains the far silhouette and rolls back owned resources and indices', () => {
  const chunks = createBuildingRenderChunks([world.buildings[0]]), f = fixture(chunks), camera = chunks[0].center;
  try {
    f.failCreate(); f.manager.update(camera); assert.equal(f.stats().live, 0); assert.equal(f.refs.size, 0); f.checkFar();
    f.failActivate(); f.manager.update(camera); assert.equal(f.stats().live, 0); assert.equal(f.refs.size, 0); assert.equal(f.scene.children.length, 1); assert.equal(f.stats().geometryDisposals, 1); f.checkFar();
    f.manager.update(camera); assert.equal(f.stats().live, 1); assert.equal(f.manager.getStats().failures, 2); f.checkFar();
    const before = f.manager.getStats(); assert.throws(() => f.manager.update({ x: NaN, y: 20, z: 0 }), /相机位置/); assert.deepEqual(f.manager.getStats(), before);
    f.manager.dispose(); f.manager.dispose(); assert.equal(f.manager.update(camera).length, 0); assert.equal(f.stats().live, 0); assert.equal(f.stats().materialDisposals, 0); f.checkFar();
    evidence.push({ check: 'failed-build-publication-recovery', ...f.manager.getStats(), ...f.stats() });
  } finally { f.dispose(); }
});
