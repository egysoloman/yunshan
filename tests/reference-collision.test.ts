import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { blocksFloorPlanMovement, blocksFloorPlanReferenceMovement, getBuildingFloorPlan, wallPanels } from '../src/architecture-floor-plan';
import { blocksSweptUprightCylinder } from '../src/geometry/upright-cylinder-sweep';
import { createArchivedProductCity, createCurrentProductCity, createProductCity } from '../src/product-city';
import { upgradeReferenceCollision } from '../src/host/upgrade-reference-collision';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';
import type { Building, Vec3 } from '../src/types';

const policy = 'continuous-upright-v1';
const fixtureBytes = readFileSync(new URL('./fixtures/reference-collision/root14-fourteen-legs.json', import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), '6e5956b5f907f95c0e2f016f2909fe14885527206192dfd3ac711e4842034413');
const rows: { id: string; building: Building; from: Vec3; to: Vec3 }[] = JSON.parse(fixtureBytes.toString()).rows;

for (const row of rows) test(`reference policy clears original sloping doorway ${row.id}`, () => {
  assert.equal(blocksFloorPlanMovement(row.building, 0, row.from, row.to), true);
  assert.equal(blocksFloorPlanReferenceMovement(row.building, 0, row.from, row.to), false);
  assert.equal(blocksFloorPlanReferenceMovement(row.building, 0, row.to, row.from), false);
  const low = structuredClone(row.building), plan = getBuildingFloorPlan(low, 0)!;
  // Generated plans have already materialized their shared panel view while
  // placing furniture. Change the actual rendered/colliding door header,
  // rather than an earlier recipe field behind that established cache.
  const header = wallPanels(plan).find(panel => panel.kind === 'solid' && panel.bottom === 2.8 && panel.rect.x0 <= 0 && panel.rect.x1 >= 0 && Math.abs(panel.rect.z0 - low.depth / 2) < .21)!;
  assert.ok(header, 'original physical door header exists');
  header.bottom = 1.6;
  assert.equal(blocksFloorPlanReferenceMovement(low, 0, row.from, row.to), true, 'a physically low door still rejects the full body');
});

test('same-time overlap keeps walls, descent, vertical motion and closed zero-width faces blocking', () => {
  const box = { x0: -.1, x1: .1, z0: -.1, z1: .1, bottom: 0, top: 3 };
  assert.equal(blocksSweptUprightCylinder({ x: -2, y: .6, z: 0 }, { x: 2, y: .6, z: 0 }, box), true);
  assert.equal(blocksSweptUprightCylinder({ x: -2, y: 4, z: 0 }, { x: 2, y: 0, z: 0 }, box), true);
  assert.equal(blocksSweptUprightCylinder({ x: 0, y: 4, z: 0 }, { x: 0, y: .6, z: 0 }, box), true);
  assert.equal(blocksSweptUprightCylinder({ x: -2, y: .6, z: 0 }, { x: 2, y: .6, z: 0 }, { ...box, x0: 0, x1: 0 }), true);
  assert.equal(blocksSweptUprightCylinder({ x: 0, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }, box), false, 'floor contact alone is not penetration');
});

test('new factory selects a paired policy; older imports and malformed pairs cannot silently change it', async () => {
  const world = civicFixtureWorld(), current = createCurrentProductCity(world), old = createArchivedProductCity(world);
  assert.equal(current.referenceCollisionPolicyId, policy);
  const fresh = current.exportSave(), oldSave = old.exportSave();
  assert.equal(old.referenceCollisionPolicyId, 'legacy');
  assert.equal(current.importSave(oldSave).ok, true);
  assert.equal(current.referenceCollisionPolicyId, 'legacy');
  assert.equal(current.exportSave(), oldSave);
  assert.equal(current.importSave(fresh).ok, true);
  assert.equal(current.exportSave(), fresh);
  for (const change of [
    (d: any) => delete d.referenceCollisionPolicyId,
    (d: any) => delete d.runtime.referenceCollisionPolicyId,
    (d: any) => d.referenceCollisionPolicyId = 'unknown',
    (d: any) => d.runtime.referenceCollisionPolicyId = 'unknown',
    (d: any) => d.motionVersion = 1,
    (d: any) => d.runtime.npcMotionVersion = 1,
    (d: any) => d.version = 3,
  ]) {
    const candidate = JSON.parse(fresh); change(candidate);
    assert.equal(current.importSave(JSON.stringify(candidate)).ok, false);
    assert.equal(current.exportSave(), fresh, 'a rejected import is atomic');
    assert.throws(() => partitionSave(JSON.stringify(candidate), world));
  }
  const parts = partitionSave(fresh, world);
  assert.equal(assembleSave(parts), fresh);
  for (const path of ['', 'runtime', 'both']) {
    const corrupt = structuredClone(parts), global = JSON.parse(corrupt[0].json);
    for (const key of path === 'both' ? ['', 'runtime'] : [path]) global.layout.order[key] = global.layout.order[key].filter((k: string) => k !== 'referenceCollisionPolicyId');
    corrupt[0].json = JSON.stringify(global);
    assert.throws(() => assembleSave(corrupt), 'ordering cannot silently discard a declared policy');
  }
  assert.equal(current.importSave(oldSave).ok, true);
  const hash = createHash('sha256').update(oldSave).digest('hex');
  assert.equal((await upgradeReferenceCollision(current, '0'.repeat(64))).ok, false);
  assert.equal(current.exportSave(), oldSave);
  assert.equal((await upgradeReferenceCollision(current, hash)).ok, true);
  const upgraded = JSON.parse(current.exportSave());
  delete upgraded.referenceCollisionPolicyId; delete upgraded.runtime.referenceCollisionPolicyId;
  assert.equal(JSON.stringify(upgraded), oldSave, 'cutover changes only the two declared policy fields');
  assert.equal((await upgradeReferenceCollision(current, hash)).ok, false, 'an existing policy is never upgraded twice');
  const v3 = createProductCity(world), v3Save = v3.exportSave();
  assert.equal((await upgradeReferenceCollision(v3, createHash('sha256').update(v3Save).digest('hex'))).ok, false);
  assert.equal(v3.exportSave(), v3Save);
});
