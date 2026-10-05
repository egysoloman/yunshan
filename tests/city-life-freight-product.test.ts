import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createCityLifeProductCity, createDeliveredCityLifeProductCity } from '../src/product-city';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { fixture } from './clinical-presence-fixture';

test('fresh delivered product keeps the original city-life ledger and old imported rule contract', async () => {
  const world = fixture(false), original = await createCityLifeProductCity(world), fresh = await createDeliveredCityLifeProductCity(world);
  const raw = original.exportSave(), added = JSON.parse(fresh.exportSave());
  assert.equal(fresh.freightDeliveryPolicyId, 'road-food-delivery-v1');
  assert.equal(added.freightDeliveryPolicyId, 'road-food-delivery-v1');
  assert.equal(added.runtime.freightDeliveryPolicyId, 'road-food-delivery-v1');
  delete added.freightDeliveryPolicyId; delete added.runtime.freightDeliveryPolicyId;
  assert.equal(JSON.stringify(added), raw, 'Only the declared delivery rule changes; no funds, stock, identity, bodies or time');
  assert.equal(original.freightDeliveryPolicyId, 'legacy');
  assert.equal(fresh.importSave(raw).ok, true);
  assert.equal(fresh.freightDeliveryPolicyId, 'legacy');
  assert.equal(fresh.exportSave(), raw);
  for (let i = 0; i < 24; i++) {
    original.step(.25); fresh.step(.25);
    assert.equal(fresh.exportSave(), original.exportSave(), `Original rule future frame ${i + 1}`);
  }
});

test('fresh delivered product whole and partition native restores continue with exactly the same future', async () => {
  const world = fixture(false), fresh = await createDeliveredCityLifeProductCity(world), raw = fresh.exportSave();
  const whole = new Simulation(world), parts = new Simulation(world);
  assert.equal(whole.importSave(raw).ok, true);
  const assembled = assembleSave(partitionSave(raw, world));
  assert.equal(assembled, raw); assert.equal(parts.importSave(assembled).ok, true);
  for (let i = 0; i < 24; i++) {
    fresh.step(.25); whole.step(.25); parts.step(.25);
    assert.equal(whole.exportSave(), fresh.exportSave());
    assert.equal(parts.exportSave(), fresh.exportSave());
    assert.equal(fresh.freightDeliveryPolicyId, 'road-food-delivery-v1');
  }
});
