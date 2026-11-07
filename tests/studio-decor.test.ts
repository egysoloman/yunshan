import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { getBuildingBody } from '../src/architecture-floor-plan';
import { STUDIO_ASSETS, STUDIO_COURTYARD_DECOR, STUDIO_DECOR, studioDecorPlacements } from '../src/rendering/studio-prop-layout';

const byId = new Map(STUDIO_ASSETS.map(a => [a.id, a]));

test('display-only décor places every listed studio furniture asset at original size without touching walls, fixtures, use points or stairs', () => {
  const world = createWorld(), seen = new Set<string>();
  let total = 0;
  for (const building of world.buildings) {
    const body = getBuildingBody(building), decor = studioDecorPlacements(building);
    total += decor.length;
    for (const p of decor) {
      seen.add(p.asset); assert.equal(p.scale, 1);
      const plan = body!.floorPlans.find(f => f.floor === p.floor)!, b = byId.get(p.asset)!.boundsM;
      // Footprint centre back in building-local space (yaw is 0 or π).
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), mx = (b.min[0] + b.max[0]) / 2, mz = (b.min[2] + b.max[2]) / 2;
      const x = p.local.x + mx * c + mz * s, z = p.local.z - mx * s + mz * c;
      for (const point of [...plan.usePoints, plan.stair]) assert.ok(Math.hypot(point.x - x, point.z - z) > .9, `${building.id} ${p.fixtureId} keeps ${point.x},${point.z} clear`);
      for (const f of plan.fixtures) assert.ok(!(x > f.rect.x0 && x < f.rect.x1 && z > f.rect.z0 && z < f.rect.z1), `${building.id} ${p.fixtureId} outside fixture ${f.id}`);
    }
  }
  const listed = new Set([...Object.values(STUDIO_DECOR), STUDIO_COURTYARD_DECOR].flatMap(sets => sets!.flatMap(s => [s.base, ...(s.tops ?? []), ...(s.above ? [s.above] : []), ...(s.wear ?? [])])));
  assert.deepEqual([...listed].filter(id => !seen.has(id)), []);
  assert.equal(total, 22809);
});
