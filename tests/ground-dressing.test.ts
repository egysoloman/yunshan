import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createWorld, terrainHeight } from '../src/world';
import { createGroundClearance, GROUND_DRESSING_FOOTPRINT, groundDressing, woodlandLayout } from '../src/rendering/woodland-layout';

const manifest = JSON.parse(readFileSync('src/rendering/studio-assets.json', 'utf8')) as { assets: { id: string; boundsM: { min: number[]; max: number[] } }[] };

test('studio ground dressing stays on cleared ground at original size and never floats', () => {
  const world = createWorld(), items = groundDressing(world, woodlandLayout(world).trees), clear = createGroundClearance(world);
  assert.equal(items.length, 658);
  const byId = new Map(manifest.assets.map(a => [a.id, a]));
  for (const item of items) {
    const asset = byId.get(item.asset), f = GROUND_DRESSING_FOOTPRINT[item.asset];
    assert.ok(asset, `${item.asset} imported`);
    // The footprint table is the imported bounds centre.
    assert.ok(Math.abs((asset.boundsM.min[0] + asset.boundsM.max[0]) / 2 - f.cx) < .11 && Math.abs((asset.boundsM.min[2] + asset.boundsM.max[2]) / 2 - f.cz) < .11, item.asset);
    const c = Math.cos(item.yaw), s = Math.sin(item.yaw), cx = item.x + c * f.cx + s * f.cz, cz = item.z - s * f.cx + c * f.cz;
    assert.ok(clear(cx, cz, f.radius - .01), `${item.asset} ${item.id} off buildings, roads and water`);
    // Origin at the lowest ground under the footprint: the model base is never above the terrain.
    assert.ok(item.y <= terrainHeight(world, cx, cz, true) + .11, `${item.asset} ${item.id} grounded`);
  }
});
