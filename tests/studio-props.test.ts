import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/world';
import { getBuildingBody } from '../src/architecture-floor-plan';
import { buildProgramArchitecture } from '../src/rendering/architecture-bodies';
import { layoutStudioFixture, STUDIO_ASSETS, STUDIO_FIXTURE_DRESSING, STUDIO_MIN_FIT_SCALE, studioDressesFixture } from '../src/rendering/studio-prop-layout';

const world = createWorld();

test('studio manifest matches the copied GLB files byte for byte', () => {
  assert.ok(STUDIO_ASSETS.length >= 2);
  for (const asset of STUDIO_ASSETS) {
    const glb = readFileSync(new URL(`../public/${asset.url}`, import.meta.url));
    assert.equal(createHash('sha256').update(glb).digest('hex'), asset.sha256, asset.id);
    assert.equal(glb.readUInt32LE(0), 0x46546c67, `${asset.id} is binary glTF`);
    assert.ok(asset.triangles > 0 && asset.boundsM.max.every((v, k) => v > asset.boundsM.min[k]));
  }
  for (const dressing of Object.values(STUDIO_FIXTURE_DRESSING)) assert.ok(STUDIO_ASSETS.some(asset => asset.id === dressing!.asset));
});

test('every studio placement stays inside its authoritative fixture solid at uniform scale', () => {
  const original = JSON.stringify(world), counts: Record<string, number> = {};
  for (const building of world.buildings) {
    const body = getBuildingBody(building); if (!body) continue;
    for (const plan of body.floorPlans) for (const fixture of plan.fixtures) {
      const placements = layoutStudioFixture(fixture, plan.floor, plan.y); if (!placements) continue;
      const dressing = STUDIO_FIXTURE_DRESSING[fixture.kind]!, asset = STUDIO_ASSETS.find(a => a.id === dressing.asset)!;
      assert.equal(placements.length, dressing.copies);
      for (const p of placements) {
        assert.ok(p.scale >= STUDIO_MIN_FIT_SCALE && p.scale <= 1);
        const min = asset.boundsM.min.map(v => v * p.scale), max = asset.boundsM.max.map(v => v * p.scale);
        const lo = { x: p.local.x + min[0], y: p.local.y + min[1], z: p.local.z + min[2] }, hi = { x: p.local.x + max[0], y: p.local.y + max[1], z: p.local.z + max[2] };
        const r = fixture.rect, e = 1e-7;
        assert.ok(lo.x >= r.x0 - e && hi.x <= r.x1 + e && lo.z >= r.z0 - e && hi.z <= r.z1 + e, `${building.id}/${fixture.id} footprint`);
        assert.ok(Math.abs(lo.y - (plan.y + fixture.bottom)) < 1e-7 && hi.y <= plan.y + fixture.top + e, `${building.id}/${fixture.id} height`);
      }
      counts[fixture.kind] = (counts[fixture.kind] ?? 0) + 1;
    }
  }
  assert.ok((counts.counter ?? 0) > 0 && (counts.table ?? 0) > 0, JSON.stringify(counts));
  assert.equal(JSON.stringify(world), original);
  console.log(JSON.stringify({ scope: 'default-world', dressedFixtures: counts }));
});

test('skipFixture removes only the dressed fixture boxes; the default output is unchanged', () => {
  let compared = 0;
  for (const building of world.buildings) {
    const before = buildProgramArchitecture(building, 'near'); if (!before) continue;
    const plain = buildProgramArchitecture(building, 'near', {}), skipped = buildProgramArchitecture(building, 'near', { skipFixture: studioDressesFixture })!;
    assert.deepEqual(plain, before);
    const body = getBuildingBody(building)!;
    const dressed = body.floorPlans.flatMap(plan => plan.fixtures.filter(f => studioDressesFixture(f)).map(f => ({ plan, f })));
    const inside = (part: (typeof before)[number]) => dressed.some(({ plan, f }) => part.purpose === 'furniture' && part.floor === plan.floor
      && part.position.x > f.rect.x0 && part.position.x < f.rect.x1 && part.position.z > f.rect.z0 && part.position.z < f.rect.z1);
    assert.deepEqual(skipped, before.filter(part => !inside(part)), building.id);
    compared++;
  }
  assert.ok(compared > 50);
});
