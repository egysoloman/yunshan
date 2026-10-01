import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildLandscape } from '../src/rendering/terrain';
import { createWorld, terrainHeight } from '../src/world';

test('connected water and streamed ground retain topology, voxel heights and a bounded detail cache', () => {
  const world = createWorld(), landscape = buildLandscape(world);
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
  } finally { landscape.dispose(); }
  assert.equal(landscape.group.children.length, 0);
});
