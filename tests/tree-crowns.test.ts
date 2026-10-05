import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createTreeCrownGeometry } from '../src/rendering/terrain';

test('both forest LODs keep the original crown envelope and shared-template budget', () => {
  for (const [lod, budget] of [['near', 60], ['far', 36]] as const) {
    const geometry = createTreeCrownGeometry(lod);
    try {
      const bounds = geometry.boundingBox!, positions = geometry.getAttribute('position'), colors = geometry.getAttribute('color');
      for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(Math.abs(bounds.min[axis] + .5) < 1e-6, `${lod} ${axis} lower extent changed`);
        assert.ok(Math.abs(bounds.max[axis] - .5) < 1e-6, `${lod} ${axis} upper extent changed`);
      }
      assert.ok(geometry.index!.count / 3 <= budget, `${lod} template exceeds its per-instance triangle budget`);
      assert.equal(positions.count, colors.count);
      for (let i = 0; i < positions.count; i++) for (const value of [positions.getX(i), positions.getY(i), positions.getZ(i), colors.getX(i), colors.getY(i), colors.getZ(i)]) assert.ok(Number.isFinite(value));
      assert.ok(colors.getX(0) > 0 && colors.getX(0) <= 1.1);
    } finally { geometry.dispose(); }
  }
});

test('near and far crowns expose stepped shoulders while retaining a closed centre', () => {
  for (const lod of ['near', 'far'] as const) {
    const geometry = createTreeCrownGeometry(lod), material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    try {
      const ray = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0), 0, 3).intersectObject(mesh);
      assert.equal(ray(.45, .45).length, 0, `${lod} still has the cuboid's square corner silhouette`);
      const centre = ray(0, 0), shoulder = ray(.4, 0);
      assert.ok(centre.length > 0 && shoulder.length > 0, `${lod} lost its central or projecting crown mass`);
      assert.ok(centre[0].point.y - shoulder[0].point.y > .1, `${lod} remains one broad flat top`);
    } finally { geometry.dispose(); material.dispose(); }
  }
});
