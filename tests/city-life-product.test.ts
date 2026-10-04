import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createArchivedProductCity, createCityLifeProductCity, createCurrentProductCity } from '../src/product-city';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';

test('fresh city-life recipe records its actual original save and preserves all actors, funds, clocks and routes', async () => {
  const world = civicFixtureWorld(), original = createCurrentProductCity(world).exportSave();
  const city = await createCityLifeProductCity(world), saved = city.exportSave(), doc = JSON.parse(saved);
  assert.equal(city.referenceCollisionPolicyId, 'continuous-upright-v1');
  assert.equal(city.mealRoutePolicyId, 'nearby-food-v1');
  assert.equal(doc.state.serviceMaterialScheduling.policyId, 'authorized-service-materials-v1');
  assert.equal(doc.state.serviceMaterialScheduling.sourceSave.sha256, createHash('sha256').update(original).digest('hex'));
  delete doc.state.serviceMaterialScheduling; delete doc.runtime.serviceMaterialSchedulingVersion;
  doc.runtime.persistedModules = doc.runtime.persistedModules.filter((name: string) => name !== 'serviceMaterialScheduling');
  assert.equal(JSON.stringify(doc), original, 'only the service declaration is added to the actual fresh source');
  assert.equal(city.validateSave(saved).ok, true);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  const full = await createCityLifeProductCity(world), partitioned = await createCityLifeProductCity(world);
  assert.equal(full.importSave(saved).ok, true);
  assert.equal(partitioned.importSave(assembleSave(partitionSave(saved, world))).ok, true);
  for (let tick = 0; tick < 24; tick++) {
    city.step(.25); full.step(.25); partitioned.step(.25);
    assert.equal(full.exportSave(), city.exportSave()); assert.equal(partitioned.exportSave(), city.exportSave());
  }
});

test('loading an existing native-four archive into the city-life recipe keeps its bytes and future without new policies', async () => {
  const world = civicFixtureWorld(), old = createArchivedProductCity(world), original = old.exportSave();
  const current = await createCityLifeProductCity(world);
  assert.equal(current.importSave(original).ok, true); assert.equal(current.exportSave(), original);
  assert.equal(current.referenceCollisionPolicyId, 'legacy'); assert.equal(current.mealRoutePolicyId, 'legacy');
  assert.equal(current.state.serviceMaterialScheduling, undefined);
  for (let tick = 0; tick < 24; tick++) {
    old.step(.25); current.step(.25);
    assert.equal(current.exportSave(), old.exportSave());
  }
});
