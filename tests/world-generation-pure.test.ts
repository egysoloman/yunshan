import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { WorldGenerationHost, generationSHA256, generationWorldSHA256 } from '../src/host/world-generation';
import { gridWorld } from './power-grid-fixture';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const guard = () => {
  let calls = 0;
  return { services: { resolveWorld() { calls++; throw new Error('no trusted world registered'); },
    stageConsumers() { calls++; return undefined; }, releaseConsumers() { calls++; } }, calls: () => calls };
};
const envelope = () => {
  const save = JSON.stringify({ format: 'yunshan-save', version: 2, worldFingerprint: '1234' });
  return { format: 'yunshan-world-generation', version: 1, revision: 0, worldSHA256: 'a'.repeat(64), baseWorldFingerprint: '1234', saveSHA256: sha(save), save };
};
// These resource/envelope checks instantiate zero Simulation objects. They are
// not standalone native saves or evidence of paid work or valid city accounts.
test('generation hashes bind exact UTF-8 bytes and custom-world parameters outside the old short fingerprint', async () => {
  for (const text of ['云山世代', 'a\nb', '\u0000', '']) assert.equal(await generationSHA256(text), sha(text));
  const world = gridWorld(), before = JSON.stringify(world), original = await generationWorldSHA256(world);
  assert.equal(JSON.stringify(world), before);
  const other = structuredClone(world); other.buildings[0].capacity++;
  assert.notEqual(await generationWorldSHA256(other), original);
  other.buildings[0].capacity--; other.districts[0].population++;
  assert.notEqual(await generationWorldSHA256(other), original);
  assert.equal(await generationWorldSHA256(structuredClone(world)), original);
});
test('untrusted checkpoint digest rejects before any resolver or Simulation is called', async () => {
  const guarded = guard(), json = JSON.stringify(envelope());
  await assert.rejects(WorldGenerationHost.restore(json, 'b'.repeat(64), guarded.services), /SHA/);
  assert.equal(guarded.calls(), 0);
});
test('unknown geometry, prototype fields and invalid revisions cannot become checkpoint instructions', async () => {
  for (const alteration of [{ world: gridWorld() }, { revision: -1 }, { revision: 1e9 + 1 }, { version: 2 }, { saveSHA256: 'x' }]) {
    const guarded = guard(), json = JSON.stringify({ ...envelope(), ...alteration });
    await assert.rejects(WorldGenerationHost.restore(json, sha(json), guarded.services), /字段/);
    assert.equal(guarded.calls(), 0);
  }
  const guarded = guard(), json = JSON.stringify(envelope()).replace('"format":', '"__proto__":{},"format":');
  await assert.rejects(WorldGenerationHost.restore(json, sha(json), guarded.services), /字段/); assert.equal(guarded.calls(), 0);
});
test('business original SHA and base-world fingerprint mismatch reject without native construction', async () => {
  for (const alteration of [{ saveSHA256: 'b'.repeat(64) }, { baseWorldFingerprint: '9999' }]) {
    const guarded = guard(), json = JSON.stringify({ ...envelope(), ...alteration });
    await assert.rejects(WorldGenerationHost.restore(json, sha(json), guarded.services), /SHA|指纹/);
    assert.equal(guarded.calls(), 0);
  }
});
test('a well-shaped checkpoint still requires a trusted resolver and never falls back to a new city', async () => {
  const guarded = guard(), json = JSON.stringify(envelope());
  await assert.rejects(WorldGenerationHost.restore(json, sha(json), guarded.services), /no trusted world registered/);
  assert.equal(guarded.calls(), 1);
});

test('full World SHA detects publicly mutable wall and slab caches as well as the recipe body', async () => {
  const { FLOOR_PLAN_PROFILE, getBuildingBody, wallPanels, getFloorPlanSlabRegions } = await import('../src/architecture-floor-plan');
  for (const cache of ['wall', 'slab'] as const) {
    const world = gridWorld(); Object.assign(world.buildings[0], { floorPlanProfile: FLOOR_PLAN_PROFILE, width: 12, depth: 12 });
    const body = getBuildingBody(world.buildings[0])!; assert(body);
    const before = await generationWorldSHA256(world), definition = JSON.stringify(world);
    const values = cache === 'wall' ? wallPanels(body.floorPlans[0]) : getFloorPlanSlabRegions(body.floorPlans[0]);
    assert(values.length > 0); values.splice(0, 1);
    assert.equal(JSON.stringify(world), definition, 'cache mutation is independent of World inputs');
    assert.notEqual(await generationWorldSHA256(world), before, `${cache} physical cache is included in the binding`);
  }
});


test('World binding covers body stairs, fixtures, floor voids, roofs, landing pads and input rail points', async () => {
  const geometry = await import('../src/architecture-floor-plan');
  const { getAviationPads } = await import('../src/aviation');
  const edits = ['stair', 'fixture', 'void', 'roof', 'panels', 'slabs', 'floor-membership'] as const;
  for (const kind of edits) {
    const world = gridWorld(); Object.assign(world.buildings[0], { floorPlanProfile: geometry.FLOOR_PLAN_PROFILE, width: 20, depth: 20, height: 9, floors: 3, stairGeometryRevision: 2 });
    const body = geometry.getBuildingBody(world.buildings[0])!, before = await generationWorldSHA256(world), plan = body.floorPlans[0];
    if (kind === 'stair') { const tread = body.floorPlans.flatMap(p => p.stairTreads)[0]; assert(tread); tread.rect.x0 += .2; }
    if (kind === 'fixture') { assert(plan.fixtures.length); plan.fixtures[0].rect.z0 += .2; }
    if (kind === 'void') { const hole = body.floorPlans.find(p => p.stairHole)?.stairHole; assert(hole); hole.x1 += .2; }
    if (kind === 'roof') { const roof = geometry.getFloorPlanRoofRegions(body); assert(roof.length); roof[0].rect.x1 += .2; }
    if (kind === 'panels') geometry.wallPanels(plan)[0].top += .2;
    if (kind === 'slabs') geometry.getFloorPlanSlabRegions(plan)[0].x1 += .2;
    if (kind === 'floor-membership') body.floorPlans.splice(1, 1);
    assert.notEqual(await generationWorldSHA256(world), before, kind);
  }
  const padsWorld = gridWorld(); padsWorld.nodes[0].station = true;
  const pads = getAviationPads(padsWorld); assert(pads.length); const beforePads = await generationWorldSHA256(padsWorld), definition = JSON.stringify(padsWorld);
  pads[0].position.x += 1;
  assert.equal(JSON.stringify(padsWorld), definition); assert.notEqual(await generationWorldSHA256(padsWorld), beforePads);
  const railWorld = gridWorld(), beforeRail = await generationWorldSHA256(railWorld); railWorld.edges[0].points[0].y += .2;
  assert.notEqual(await generationWorldSHA256(railWorld), beforeRail);
});
