import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { chooseNearestTiedMeal } from '../src/simulation/meal-route';
import { createArchivedProductCity, createCurrentProductCity } from '../src/product-city';
import { upgradeMealRoute } from '../src/host/upgrade-meal-route';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';

test('equal meal scores use real travel without changing a higher-score activity or a non-food winner', () => {
  const far = { activity: 'eat', score: 210, travel: 3947 }, near = { activity: 'eat', score: 210, travel: 1793 };
  const rest = { activity: 'rest', score: 210, travel: 25 };
  assert.equal(chooseNearestTiedMeal([far, rest, near]), near);
  assert.equal(chooseNearestTiedMeal([rest, far, near]), rest);
  const higher = { ...rest, score: 211 };
  assert.equal(chooseNearestTiedMeal([higher, near]), higher);
  const ranked = [far, rest, near];
  chooseNearestTiedMeal(ranked); assert.deepEqual(ranked, [far, rest, near], 'the original ranking is not mutated');
});

test('meal policy preserves source actors at cutover and cannot disappear in full or partitioned imports', async () => {
  const world = civicFixtureWorld(), sim = createArchivedProductCity(world), original = sim.exportSave();
  const hash = createHash('sha256').update(original).digest('hex');
  assert.equal((await upgradeMealRoute(sim, '0'.repeat(64))).ok, false);
  assert.equal(sim.exportSave(), original);
  assert.equal((await upgradeMealRoute(sim, hash)).ok, true);
  assert.equal(sim.mealRoutePolicyId, 'nearby-food-v1');
  assert.equal(sim.referenceCollisionPolicyId, 'legacy', 'the policies are independently declared');
  const next = sim.exportSave(), doc = JSON.parse(next);
  delete doc.mealRoutePolicyId; delete doc.runtime.mealRoutePolicyId;
  assert.equal(JSON.stringify(doc), original, 'only two policy declarations change, not old routes or needs');
  assert.equal(assembleSave(partitionSave(next, world)), next);
  for (const change of [
    (d: any) => delete d.mealRoutePolicyId,
    (d: any) => delete d.runtime.mealRoutePolicyId,
    (d: any) => d.mealRoutePolicyId = 'unknown',
    (d: any) => d.runtime.mealRoutePolicyId = 'unknown',
    (d: any) => d.motionVersion = 1,
    (d: any) => d.version = 3,
  ]) {
    const d = JSON.parse(next); change(d);
    assert.equal(sim.importSave(JSON.stringify(d)).ok, false);
    assert.equal(sim.exportSave(), next);
    assert.throws(() => partitionSave(JSON.stringify(d), world));
  }
  for (const path of ['', 'runtime', 'both']) {
    const parts = partitionSave(next, world), g = JSON.parse(parts[0].json);
    for (const key of path === 'both' ? ['', 'runtime'] : [path]) g.layout.order[key] = g.layout.order[key].filter((k: string) => k !== 'mealRoutePolicyId');
    parts[0].json = JSON.stringify(g); assert.throws(() => assembleSave(parts));
  }
  assert.equal(sim.importSave(original).ok, true);
  assert.equal(sim.exportSave(), original);
  assert.equal(sim.mealRoutePolicyId, 'legacy');
  const current = createCurrentProductCity(world);
  assert.equal(current.mealRoutePolicyId, 'nearby-food-v1');
  assert.equal(current.referenceCollisionPolicyId, 'continuous-upright-v1');
  assert.equal(current.importSave(original).ok, true);
  assert.equal(current.exportSave(), original, 'loading a new factory does not activate either policy');
});
