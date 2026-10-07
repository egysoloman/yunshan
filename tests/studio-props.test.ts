import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/world';
import { contains, getBuildingBody, getFloorPlanSlabRegions } from '../src/architecture-floor-plan';
import { buildProgramArchitecture } from '../src/rendering/architecture-bodies';
import { studioEmissiveFactor } from '../src/rendering/studio-props';
import { CEILING_LAMP, layoutStudioFixture, STATION_PLATFORM, STATION_SHELTER, STUDIO_ASSETS, STUDIO_FIXTURE_DRESSING, STUDIO_MIN_FIT_SCALE, studioDressesFixture, studioCeilingLampPlacements, studioDressing, studioStationPlacements } from '../src/rendering/studio-prop-layout';

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
      const placements = layoutStudioFixture(fixture, plan.floor, plan.y, undefined, building.kind); if (!placements) continue;
      const dressing = studioDressing(fixture.kind, building.kind)!, asset = STUDIO_ASSETS.find(a => a.id === dressing.asset)!;
      assert.equal(placements.length, dressing.copies);
      for (const p of placements) {
        assert.ok(p.scale >= STUDIO_MIN_FIT_SCALE && p.scale <= 1);
        const min = asset.boundsM.min.map(v => v * p.scale), max = asset.boundsM.max.map(v => v * p.scale);
        const lo = { x: p.local.x + min[0], y: p.local.y + min[1], z: p.local.z + min[2] }, hi = { x: p.local.x + max[0], y: p.local.y + max[1], z: p.local.z + max[2] };
        const r = fixture.rect, e = 1e-7;
        assert.ok(lo.x >= r.x0 - e && hi.x <= r.x1 + e && lo.z >= r.z0 - e && hi.z <= r.z1 + e, `${building.id}/${fixture.id} footprint`);
        assert.ok(Math.abs(lo.y - (plan.y + fixture.bottom)) < 1e-7 && hi.y <= plan.y + fixture.top + e, `${building.id}/${fixture.id} height`);
      }
      counts[dressing.asset] = (counts[dressing.asset] ?? 0) + 1;
    }
  }
  for (const id of ['LIFE-064', 'LIFE-032', 'LIFE-151', 'LIFE-111']) assert.ok((counts[id] ?? 0) > 0, `${id}: ${JSON.stringify(counts)}`);
  assert.equal(JSON.stringify(world), original);
  console.log(JSON.stringify({ scope: 'default-world', dressedFixtures: counts }));
});

test('skipFixture removes only the dressed fixture boxes; the default output is unchanged', () => {
  let compared = 0;
  for (const building of world.buildings) {
    const before = buildProgramArchitecture(building, 'near'); if (!before) continue;
    const plain = buildProgramArchitecture(building, 'near', {}), skipped = buildProgramArchitecture(building, 'near', { skipFixture: f => studioDressesFixture(f, building.kind) })!;
    assert.deepEqual(plain, before);
    const body = getBuildingBody(building)!;
    const dressed = body.floorPlans.flatMap(plan => plan.fixtures.filter(f => studioDressesFixture(f, building.kind)).map(f => ({ plan, f })));
    const inside = (part: (typeof before)[number]) => dressed.some(({ plan, f }) => part.purpose === 'furniture' && part.floor === plan.floor
      && part.position.x > f.rect.x0 && part.position.x < f.rect.x1 && part.position.z > f.rect.z0 && part.position.z < f.rect.z1);
    assert.deepEqual(skipped, before.filter(part => !inside(part)), building.id);
    compared++;
  }
  assert.ok(compared > 50);
});

test('station platform and shelter models occupy the original platform extent and its own canopy ports', () => {
  const placements = studioStationPlacements(world), stations = world.nodes.filter(node => node.station);
  assert.equal(placements.length, stations.length * 2);
  const platform = STUDIO_ASSETS.find(a => a.id === STATION_PLATFORM.asset)!, shelter = STUDIO_ASSETS.find(a => a.id === STATION_SHELTER.asset)!;
  for (const node of stations) {
    const p = node.position, base = placements.find(s => s.id === `${node.id}:platform`)!, roof = placements.find(s => s.id === `${node.id}:shelter`)!;
    // Original box: centre (x, y − .6, z), size 22 × 1 × 18.
    const lo = [base.position.x + platform.boundsM.min[0], base.position.y + platform.boundsM.min[1], base.position.z + platform.boundsM.min[2]];
    const hi = [base.position.x + platform.boundsM.max[0], base.position.y + platform.boundsM.max[1], base.position.z + platform.boundsM.max[2]];
    for (const [k, v] of [[0, p.x - 11], [1, p.y - 1.1], [2, p.z - 9]] as const) assert.ok(Math.abs(lo[k] - v) < 1e-6, `${node.id} min ${k}`);
    for (const [k, v] of [[0, p.x + 11], [1, p.y - .1], [2, p.z + 9]] as const) assert.ok(Math.abs(hi[k] - v) < 1e-6, `${node.id} max ${k}`);
    // Shelter feet (1.9|21.1, 0, 5) land on platform ports (1.4|20.6, 1, 8.5).
    for (const [foot, port] of [[[1.9, 0, 5], [1.4, 1, 8.5]], [[21.1, 0, 5], [20.6, 1, 8.5]]]) {
      assert.ok(Math.abs(roof.position.x + foot[0] - (base.position.x + port[0])) < 1e-6 && Math.abs(roof.position.y + foot[1] - (base.position.y + port[1])) < 1e-6 && Math.abs(roof.position.z + foot[2] - (base.position.z + port[2])) < 1e-6);
    }
    assert.ok(roof.position.y + shelter.boundsM.min[1] >= p.y - .1 - 1e-6, 'shelter stands on the platform top');
  }
});

test('ceiling lamps hang flush under a real slab above interior use points, clear of a standing eye', () => {
  const lamp = STUDIO_ASSETS.find(a => a.id === CEILING_LAMP.asset)!; let count = 0;
  for (const building of world.buildings) {
    const body = getBuildingBody(building); if (!body) continue;
    for (const p of studioCeilingLampPlacements(building)) {
      const plan = body.floorPlans.find(f => f.floor === p.floor)!, above = body.floorPlans.find(f => f.floor === p.floor + 1)!;
      const bottom = p.local.y + lamp.boundsM.min[1], top = p.local.y + lamp.boundsM.max[1];
      assert.ok(Math.abs(top - (plan.ceilingY - CEILING_LAMP.slabThickness)) < 1e-7, `${building.id} flush mount`);
      assert.ok(bottom >= plan.y + 1.72, `${building.id} eye clearance`);
      const slabs = getFloorPlanSlabRegions(above);
      for (const [x, z] of [[lamp.boundsM.min[0], lamp.boundsM.min[2]], [lamp.boundsM.max[0], lamp.boundsM.max[2]]]) assert.ok(slabs.some(r => contains(r, p.local.x + x, p.local.z + z)), `${building.id} slab cover`);
      count++;
    }
  }
  assert.ok(count > 500, String(count));
  console.log(JSON.stringify({ scope: 'default-world', ceilingLamps: count }));
});

test('studio lamp glow follows real power and daylight', () => {
  assert.equal(studioEmissiveFactor(1, 0), 0, 'no power, no glow');
  assert.equal(studioEmissiveFactor(0, 0), 0);
  assert.equal(studioEmissiveFactor(0, 1), 1, 'full power at night shows the authored maximum');
  assert.ok(studioEmissiveFactor(1, 1) < studioEmissiveFactor(.5, 1) && studioEmissiveFactor(.5, 1) < 1);
  assert.equal(studioEmissiveFactor(0, 2), 1, 'inputs are clamped');
});
