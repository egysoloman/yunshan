import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { buildLandscape } from '../src/rendering/terrain';
import { createWorld, terrainHeight, getWalkHeight, getWaterfallPath } from '../src/world';
import { CityRenderer } from '../src/renderer';
import { getFloorDimensions } from '../src/access';
let currentWorld: ReturnType<typeof createWorld> | undefined;
const renderWorld = () => currentWorld ??= createWorld();

test('trusted historical layouts retain their complete generated geometry', () => {
  // These full-world checksums were independently regenerated from both
  // git 26f0c69 and ee3e7a1, not read from an imported player's save.
  const fixtures = [
    [20261001, '6409c4b888dfdd8ca9fb19f479e5b8e37d51596dffcaf6383853a634f520b13b'],
    [78, 'fe9336aafec2001230c083b57118cf7521d0a2a9eeeabf194b166f60c3b6d74b'],
    [79, '9c1190b9fa759d664930991cab6ada39c68e27b21ad87c7f6226b82288e4276a'],
  ] as const;
  for (const [seed, checksum] of fixtures) {
    const { layoutVersion, ...geometry } = createWorld(seed, 'legacy-ee3e7a1');
    assert.equal(layoutVersion, 'legacy-ee3e7a1');
    assert.equal(createHash('sha256').update(JSON.stringify(geometry)).digest('hex'), checksum);
  }
});

test('actual instanced middle eaves and fascia leave every occupied upper storey clear', () => {
  const generated = renderWorld(), buildings = [generated.buildings.find(b => b.id === 'core-main')!, generated.buildings.find(b => b.kind === 'home' && b.floors >= 12)!, generated.buildings.find(b => b.kind === 'hall' && b.floors >= 7)!];
  const renderer = Object.create(CityRenderer.prototype) as any;
  renderer.world = { ...generated, buildings }; renderer.scene = new THREE.Scene(); renderer.chunks = []; renderer.interiors = new Map(); renderer.distantRefs = new Map();
  renderer.materials = Object.fromEntries(['wall', 'wood', 'stone', 'roof', 'glass', 'cyan', 'amber', 'red'].map(key => [key, new THREE.MeshStandardMaterial()]));
  renderer.buildCity();
  let verified = 0;
  try {
    assert.equal(renderer.interiors.size, 0, 'initial city construction allocates no near rooms');
    for (const building of buildings) {
      renderer.nearChunks.update(building.door, { quality: 'balanced', insideBuildingId: building.id });
      for (const ref of renderer.interiors.get(building.id)) {
      if (!ref.roof || ref.floor < 0 || ref.floor >= building.floors - 1) continue;
      const next = getFloorDimensions(building, ref.floor + 1), low = building.position.y + .6 + (ref.floor + 1) * building.height / building.floors + .3;
      const occupied = new THREE.Box3(new THREE.Vector3(building.position.x - next.width / 2 + .35, low, building.position.z - next.depth / 2 + .35), new THREE.Vector3(building.position.x + next.width / 2 - .35, low + building.height / building.floors - .6, building.position.z + next.depth / 2 - .35));
      const geometry = ref.mesh.geometry, position = geometry.getAttribute('position'), indices = geometry.index!;
      const vertex = (i: number) => new THREE.Vector3().fromBufferAttribute(position, indices.getX(i)).applyMatrix4(ref.matrix);
      for (let i = 0; i < indices.count; i += 3) assert.ok(!occupied.intersectsTriangle(new THREE.Triangle(vertex(i), vertex(i + 1), vertex(i + 2))), `${building.id} floor ${ref.floor}: the actual batched roof intrudes into the usable upper room`);
      verified++;
      }
    }
    assert.ok(verified > 20, 'shrinking landmark tiers and ordinary intermediate roofs were actually exercised');
    renderer.nearChunks.update(buildings[0].door, { quality: 'balanced', insideBuildingId: 'core-main' });
    const profiles = [...renderer.interiors.get('core-main')].filter(ref => ref.roof && ref.mesh.name.includes(':hip:'));
    assert.ok(new Set(profiles.map(ref => ref.mesh.geometry.uuid)).size >= 3, 'different normalized holes retain their actual geometry variants in the material batch');
  } finally { renderer.nearChunks.dispose(); renderer.scene.traverse((object: THREE.Object3D) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (object instanceof THREE.InstancedMesh) object.dispose(); } }); Object.values(renderer.materials).forEach((material: any) => material.dispose()); }
});

test('the actual low-quality doorway retains its open near shell and evicts real room buffers', () => {
  const world = renderWorld(), home = world.buildings.find(building => building.id === 'market-b21')!;
  assert.equal(home.kind, 'home');
  const renderer = Object.create(CityRenderer.prototype) as any;
  renderer.world = world; renderer.scene = new THREE.Scene(); renderer.chunks = []; renderer.interiors = new Map(); renderer.distantRefs = new Map();
  renderer.materials = Object.fromEntries(['wall', 'wood', 'stone', 'roof', 'glass', 'cyan', 'amber', 'red'].map(key => [key, new THREE.MeshStandardMaterial()]));
  renderer.buildCity();
  try {
    assert.equal(renderer.nearChunks.getStats().resident, 0);
    const eye = { x: home.door.x, y: home.door.y + 1.72, z: home.door.z + 2.2 };
    renderer.nearChunks.update(eye, { quality: 'low', renderDistance: 900, insideBuildingId: null });
    assert.ok(renderer.nearChunks.hasBuilding(home.id), 'standing two metres outside a real entrance keeps its open room shell');
    assert.ok(renderer.nearChunks.getStats().resident <= 8);
    const resident = renderer.nearChunks.residents().find((entry: any) => entry.chunk.buildingIds.has(home.id));
    resident.resource.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(eye.x, eye.y, eye.z), new THREE.Vector3(0, 0, -1), 0, 5.5);
    assert.equal(ray.intersectObject(resident.resource.group, true).length, 0, 'a visible solid proxy, roof or facade cannot plug the authoritative door corridor');
    let disposed = 0;
    resident.resource.group.traverse((object: THREE.Object3D) => { if (object instanceof THREE.Mesh) object.geometry.addEventListener('dispose', () => { disposed++; }); });
    renderer.nearChunks.update({ x: 3000, y: 1200, z: 3000 }, { quality: 'low', renderDistance: 900 });
    assert.equal(renderer.nearChunks.getStats().resident, 0); assert.equal(renderer.interiors.size, 0); assert.ok(disposed > 3);
    for (const ref of renderer.distantRefs.get(home.id)) { const actual = new THREE.Matrix4(); ref.mesh.getMatrixAt(ref.index, actual); actual.elements.forEach((value, i) => assert.ok(Math.abs(value - ref.matrix.elements[i]) < .0001, 'eviction restores the same far silhouette')); }
  } finally { renderer.nearChunks.dispose(); renderer.scene.traverse((object: THREE.Object3D) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (object instanceof THREE.InstancedMesh) object.dispose(); } }); Object.values(renderer.materials).forEach((material: any) => material.dispose()); }
});

test('the real dock bridge and intersecting station streets share walkable deck grades', () => {
  const world = renderWorld(), bridge = world.edges.find(edge => edge.id === 'bridge-river-dock-river-station')!;
  const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
  let checked = 0;
  for (let i = 1; i < bridge.points.length; i++) {
    const a = bridge.points[i - 1], b = bridge.points[i], dx = b.x - a.x, dz = b.z - a.z;
    for (const road of world.edges.filter(edge => edge.mode === 'road')) for (let j = 1; j < road.points.length; j++) {
      const c = road.points[j - 1], d = road.points[j], rx = d.x - c.x, rz = d.z - c.z, det = cross(dx, dz, rx, rz);
      if (Math.abs(det) < 1e-8) continue;
      const t = cross(c.x - a.x, c.z - a.z, rx, rz) / det, u = cross(c.x - a.x, c.z - a.z, dx, dz) / det;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const bridgeY = a.y + (b.y - a.y) * t, roadY = c.y + (d.y - c.y) * u, gap = Math.abs(bridgeY - roadY);
      assert.ok(gap <= .26 || gap >= 3, `${road.id}: crossing deck must be a usable small step or leave real headroom (${gap}m)`);
      checked++;
    }
  }
  assert.ok(checked > 5, 'the actual conflicting road network was exercised');
  assert.equal(getWalkHeight(world, -664, 1040, 18.6), 18.6, 'the former 1.5m transverse obstruction is now the shared 18.6m walk surface');
});

test('actual network handrails, posts and hangers leave the shared river crossing open at body height', () => {
  const world = renderWorld(), renderer = Object.create(CityRenderer.prototype) as any;
  renderer.world = world; renderer.scene = new THREE.Scene(); renderer.edges = new Map(); renderer.distanceDetails = [];
  renderer.materials = Object.fromEntries(['wall', 'wood', 'stone', 'roof', 'glass', 'cyan', 'amber', 'red'].map(key => [key, new THREE.MeshStandardMaterial()]));
  renderer.buildNetwork(); renderer.scene.updateMatrixWorld(true);
  try {
    for (const height of [.8, 1.1, 1.7]) for (const x of [-664.32, -664, -663.68]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 18.6 + height, 1034), new THREE.Vector3(0, 0, 1), 0, 12);
      assert.equal(ray.intersectObject(renderer.scene, true).length, 0, 'the authoritative crossroad opening also removes actual rail and suspension-post geometry');
    }
  } finally { renderer.scene.traverse((object: THREE.Object3D) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); if (object instanceof THREE.InstancedMesh) object.dispose(); } }); Object.values(renderer.materials).forEach((material: any) => material.dispose()); }
});

test('connected water and streamed ground retain topology, voxel heights and a bounded detail cache', () => {
  const world = renderWorld(), landscape = buildLandscape(world);
  try {
    const river = landscape.group.getObjectByName('瀑潭→清溪→水岸 · 共顶点连续水面') as THREE.Mesh;
    const geometry = river.geometry, indices = Array.from(geometry.index!.array);
    const connected = new Set<number>([0]);
    for (let pass = 0; pass < world.river.length; pass++) for (let i = 0; i < indices.length; i += 3) {
      const triangle = indices.slice(i, i + 3);
      if (triangle.some(vertex => connected.has(vertex))) triangle.forEach(vertex => connected.add(vertex));
    }
    assert.equal(connected.size, geometry.getAttribute('position').count, 'the water has one connected component through every bend');
    const surface = geometry.getAttribute('position');
    for (let i = 0; i < world.river.length; i++) {
      assert.ok(Math.abs((surface.getX(i * 2) + surface.getX(i * 2 + 1)) / 2 - world.river[i].x) < .001);
      assert.ok(Math.abs((surface.getZ(i * 2) + surface.getZ(i * 2 + 1)) / 2 - world.river[i].z) < .001);
    }
    const proxies = landscape.group.children.filter(object => object.name.startsWith('山形合批代理')) as THREE.Mesh[];
    assert.ok(proxies.reduce((sum, proxy) => sum + proxy.geometry.index!.count / 3, 0) <= 200000, 'the whole-world proxy and targeted cliff shoulder stay below their static triangle budget');
    const edges = new Map<string, { count: number; a: number[]; b: number[] }>();
    for (const proxy of proxies) {
      const points = proxy.geometry.getAttribute('position'), indices = proxy.geometry.index!;
      for (let i = 0; i < indices.count; i += 3) {
        const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
        for (let side = 0; side < 3; side++) {
          const a = triangle[side], b = triangle[(side + 1) % 3], pa = [points.getX(a), points.getY(a), points.getZ(a)], pb = [points.getX(b), points.getY(b), points.getZ(b)];
          const sa = pa.join(':'), sb = pb.join(':'), key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`, edge = edges.get(key);
          if (edge) edge.count++; else edges.set(key, { count: 1, a: pa, b: pb });
        }
      }
    }
    const extent = Math.ceil(world.size / 2 / 96) * 96;
    for (const edge of edges.values()) {
      const perimeter = Math.abs(edge.a[0]) === extent && edge.a[0] === edge.b[0] || Math.abs(edge.a[2]) === extent && edge.a[2] === edge.b[2];
      assert.equal(edge.count, perimeter ? 1 : 2, 'every actual interior 4/8/16m proxy edge has the same complete opposite edge; no T-junction can expose the sky');
    }
    edges.clear();
    // These exact sky-coloured pixels came from the failed immutable macro5
    // PNG, independently located before the geometry fix. Both-sided rays also
    // missed the old mesh, although the authoritative terrain was solid there.
    const camera = new THREE.PerspectiveCamera(48, 1440 / 900, .12, 18000);
    camera.position.set(440, 325, 640); camera.lookAt(210, 215, -45); camera.updateMatrixWorld(); landscape.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const [x, y] of [[960, 832], [927, 836], [1193, 491], [1004, 863], [1076, 893]]) {
      ray.setFromCamera(new THREE.Vector2((x + .5) / 1440 * 2 - 1, 1 - (y + .5) / 900 * 2), camera);
      const front = ray.intersectObjects(proxies, false)[0];
      assert.ok(front && front.distance > 480 && front.distance < 580, `the actual opaque rock face closes old sky pixel ${x}:${y}`);
      for (const proxy of proxies) (proxy.material as THREE.Material).side = THREE.DoubleSide;
      const double = ray.intersectObjects(proxies, false)[0];
      for (const proxy of proxies) (proxy.material as THREE.Material).side = THREE.FrontSide;
      assert.ok(double && Math.abs(double.distance - front.distance) < 1e-6, 'closure uses the correct face, without hiding the hole by disabling face culling');
    }
    const sharedNormals = new Map<string, THREE.Vector3>(), sharedColors = new Map<string, THREE.Vector3>(); let sewnVertices = 0;
    for (const proxy of proxies) {
      const points = proxy.geometry.getAttribute('position'), normals = proxy.geometry.getAttribute('normal'), colors = proxy.geometry.getAttribute('color');
      for (let i = 0; i < points.count; i++) {
        const id = `${points.getX(i)}:${points.getZ(i)}`, normal = new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)), prior = sharedNormals.get(id);
        assert.ok(Number.isFinite(normal.length()) && Math.abs(normal.length() - 1) < .0001);
        const color = new THREE.Vector3(colors.getX(i), colors.getY(i), colors.getZ(i));
        if (prior) { assert.ok(prior.distanceToSquared(normal) < 1e-10, 'the actual shared coarse vertex cannot create a false faceted seam'); assert.ok(sharedColors.get(id)!.distanceToSquared(color) < 1e-10, 'the actual shared coarse vertex cannot create a false triangular pigment seam'); sewnVertices++; } else { sharedNormals.set(id, normal); sharedColors.set(id, color); }
      }
    }
    assert.ok(sewnVertices > 100000, 'shared shading was checked over the actual complete landscape');
    const oldWorld = createWorld(world.seed, 'current-v2'); let physicalRelief = 0;
    for (const proxy of proxies) {
      const points = proxy.geometry.getAttribute('position');
      for (let i = 0; i < points.count; i += Math.max(1, Math.floor(points.count / 8))) {
        const x = points.getX(i), z = points.getZ(i), y = points.getY(i);
        assert.ok(Math.abs(y - terrainHeight(world, x, z, false)) <= .101, 'the actual v3 proxy samples the authoritative physical rock field');
        if (Math.abs(y - terrainHeight(oldWorld, x, z, false)) > 4) physicalRelief++;
      }
    }
    assert.ok(physicalRelief > 30, 'the rock formations are solid changed terrain, beyond a material or normal effect');
    assert.equal(landscape.group.children.filter(object => object.name.startsWith('岩崖与垂绿')).length, 0, 'the unsuccessful buried cuboids were removed instead of increasing phantom solid bodies');
    assert.ok(landscape.group.userData.woodland.stands >= 100); assert.equal(landscape.group.userData.woodland.trees, 5200);
    let trunks = 0, nearCrowns = 0, farCrowns = 0;
    landscape.vegetation.traverse(object => { if (object instanceof THREE.InstancedMesh) { if (object.name === '山林树干') trunks += object.count; if (object.name === '错层乔木冠') nearCrowns += object.count; if (object.name === '远林错层树冠代理') farCrowns += object.count; } });
    assert.equal(trunks, 5200); assert.equal(nearCrowns, trunks * 4); assert.equal(farCrowns, trunks * 2, 'real far crowns preserve the mass of every woodland stand');
    const before = proxies.map(proxy => Array.from(proxy.geometry.index!.array));
    landscape.update(world.spawn, 'balanced');
    assert.equal(landscape.group.userData.lod.visibleFineTiles, 9);
    const fine = landscape.group.getObjectByName(`近景岩土壳 ${Math.floor(world.spawn.x / 96)}:${Math.floor(world.spawn.z / 96)}`) as THREE.Mesh;
    const positions = fine.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) assert.ok(Math.abs(positions.getY(i) / .2 - Math.round(positions.getY(i) / .2)) < .001, 'close ground elevations remain on the 0.2m lattice');
    landscape.update({ x: world.spawn.x, y: 1500, z: world.spawn.z }, 'balanced');
    assert.equal(landscape.group.userData.lod.visibleFineTiles, 0);
    proxies.forEach((proxy, i) => assert.deepEqual(Array.from(proxy.geometry.index!.array), before[i], 'leaving the ground restores the original coarse indices'));
    for (let i = 0; i < 25; i++) { const x = -1700 + i * 120, z = i % 2 ? 1600 : -1600; landscape.update({ x, z, y: terrainHeight(world, x, z) + 1.72 }, 'low'); }
    assert.ok(landscape.group.userData.lod.cachedFineTiles <= 18);
    assert.ok(landscape.group.children.filter(object => object.name.startsWith('近景土石与植被')).length <= 18, 'old geometry is actually released, not merely reported as evicted');
    const bridge = world.edges.find(edge => edge.id === 'bridge-river-dock-river-station')!;
    const bridgePosition = bridge.points[Math.floor(bridge.points.length * .4)];
    const deckHeight = getWalkHeight(world, bridgePosition.x, bridgePosition.z, bridgePosition.y);
    assert.ok(terrainHeight(world, bridgePosition.x, bridgePosition.z) <= deckHeight - .5, 'solid ground remains below the usable bridge deck');
    landscape.update({ ...bridgePosition, y: deckHeight + 1.72 }, 'balanced');
    landscape.group.updateMatrixWorld(true);
    const downward = new THREE.Raycaster(new THREE.Vector3(bridgePosition.x, 100, bridgePosition.z), new THREE.Vector3(0, -1, 0));
    const ground = downward.intersectObject(landscape.group, true).find(hit => hit.object.name.startsWith('近景岩土壳'));
    assert.ok(ground && ground.point.y < deckHeight, 'the close render shell does not bury the player in the riverbank');
    landscape.update({ x: -145, y: 230, z: 290 }, 'balanced');
    landscape.group.updateMatrixWorld(true);
    const sheet = landscape.group.getObjectByName('云瀑 · 153m落差水帘')!;
    const [_, lip, drop] = getWaterfallPath(world);
    const origin = new THREE.Vector3(-145, 230, 290);
    for (const y of [130, 170, 210, 250]) {
      const t = (lip.y - y) / (lip.y - drop.y), target = new THREE.Vector3(lip.x, y + .8, lip.z + (drop.z - lip.z) * t);
      const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target) + 1);
      const hit = ray.intersectObject(landscape.group, true)[0];
      assert.equal(hit?.object.name, sheet.name, `the ${y}m sheet is optically in front of solid ground from the waterfall-front view`);
    }
  } finally { landscape.dispose(); }
  assert.equal(landscape.group.children.length, 0);
});
