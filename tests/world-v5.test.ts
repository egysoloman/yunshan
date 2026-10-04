import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createWorld, CURRENT_CITY_LAYOUT, type CityLayoutVersion } from '../src/world.ts';
import { getBuildingBody, buildingWorldPosition, floorPlanSupport, findBuildingFloorPlanRoute } from '../src/architecture-floor-plan.ts';
import { Simulation } from '../src/simulation.ts';
import { savedWorldFingerprint, selectSavedWorld } from '../src/persistence/world-layout.ts';
import { partitionSave, assembleSave } from '../src/persistence/partition.ts';

test('all five original recipes retain native captured complete world bytes and fingerprints at three seeds', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/world-layout/continuous-stairs-parent-3ca77b8.json', import.meta.url), 'utf8'));
  assert.equal(captured.originalCommit, '3ca77b861bc8a2c33820b49396ad788e7d94e137');
  assert.equal(captured.records.length, 15);
  for (const record of captured.records) {
    const world = createWorld(record.seed, record.layout as CityLayoutVersion), text = JSON.stringify(world);
    assert.equal(Buffer.byteLength(text), record.bytes);
    assert.equal(createHash('sha256').update(text).digest('hex'), record.sha256);
    assert.equal(savedWorldFingerprint(world), record.fingerprint);
    assert.ok(world.buildings.every(site => site.stairGeometryRevision === undefined));
  }
});

test('new journeys select v6 while explicit v5 preserves its continuous-stair identity', () => {
  assert.equal(CURRENT_CITY_LAYOUT, 'current-v6');
  const selected = selectSavedWorld(); assert.equal(selected.layout, 'current-v6');
  assert.equal(selected.world.buildings.filter(b => b.commercialGeometryRevision === 1).length, 5);
  const world = createWorld(20261001, 'current-v5');
  assert.equal(world.layoutVersion, 'current-v5');
  assert.equal(world.buildings.length, 612);
  assert.ok(world.buildings.every(site => site.stairGeometryRevision === 2));
  assert.notEqual(savedWorldFingerprint(world), savedWorldFingerprint(createWorld(world.seed, 'current-v4')));
  const changed = structuredClone(world);
  delete changed.buildings[0].stairGeometryRevision;
  assert.notEqual(savedWorldFingerprint(changed), savedWorldFingerprint(world), 'revision is a bound physical input');
});

test('new generated west and east real slabs and lower links support original failure coordinates at full body radius', () => {
  const world = createWorld(20261001, 'current-v5');
  const west = world.buildings.find(site => site.id === 'west-b34')!;
  const east = world.buildings.find(site => site.id === 'east-b42')!;
  const positions = [
    [west, { x: -13.16, y: 5, z: -3.3963915 }],
    [east, { x: -12.648, y: 3.4, z: -7.026981 }],
  ] as const;
  for (const [site, local] of positions) {
    const point = buildingWorldPosition(site, local);
    assert.ok(floorPlanSupport(site, 1, point, .35), `${site.id}: no floating floor0 substitute`);
    assert.ok(findBuildingFloorPlanRoute(site, 1, 0, point, site.door, .35), `${site.id}: original stair point can reach the real door`);
  }
  assert.ok(getBuildingBody(west));
});

test('v5 full and partitioned reader preserve complete state and24future steps; layout labels cannot migrate old geometry', () => {
  const world = createWorld(20261001, 'current-v5'), live = new Simulation(world), reader = new Simulation(world);
  assert.equal(live.state.citizens.length, 616);
  const original = live.exportSave(), envelope = JSON.parse(original);
  assert.equal(reader.importSave(original).ok, true);
  assert.equal(reader.exportSave(), original);
  const parts = partitionSave(original, world);
  assert.equal(assembleSave(parts), original);
  envelope.layoutVersion = 'current-v4'; envelope.world = createWorld(world.seed, 'current-v4');
  assert.equal(selectSavedWorld(JSON.stringify(envelope)).layout, 'current-v5');
  const before = reader.exportSave();
  envelope.worldFingerprint = savedWorldFingerprint(envelope.world);
  assert.equal(reader.importSave(JSON.stringify(envelope)).ok, false, 'old v4 geometry never auto-teleports into v5');
  assert.equal(reader.exportSave(), before);
  assert.equal(selectSavedWorld(JSON.stringify(envelope)).layout, 'current-v4');
  for (let tick = 0; tick < 24; tick++) {
    live.step(.25); reader.step(.25);
    assert.equal(reader.exportSave(), live.exportSave(), `complete future step ${tick + 1}`);
  }
});
