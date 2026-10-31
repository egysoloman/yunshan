import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { MIGRATION_PACE, MIGRATION_PACE_POLICY, validateMigrationPacePolicy } from '../src/simulation/migration-pace';
import { MIGRANTS_PER_DAY } from '../src/simulation/public-finance';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a declared city admits up to MIGRATION_PACE funded migrants at a day close, otherwise MIGRANTS_PER_DAY', () => {
  const world = createProductWorld(), { migrationPacePolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS, arrived: number[] = [];
  for (const declared of [true, false]) {
    const sim = declared ? createCurrentProductCity(world) : new Simulation(world, withoutRule);
    assert.equal(sim.migrationPacePolicyId, declared ? MIGRATION_PACE_POLICY : undefined);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    while (sim.state.day < 1 || sim.state.hour < 1) sim.step(.25);
    const migrants = Object.keys(sim.state.family?.migrants ?? {});
    arrived.push(migrants.length);
    // Every migrant took a shop job and a home, as before.
    for (const id of migrants) { const c = sim.state.citizens.find(c => c.id === id)!; assert.ok(sim.state.shops.some(s => s.buildingId === c.workId), `${id} works at a shop`); assert.ok(world.buildings.some(b => b.id === c.homeId && b.kind === 'home'), `${id} has a home`); }
    if (declared) {
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
    }
  }
  assert.ok(arrived[0] > MIGRANTS_PER_DAY && arrived[0] <= MIGRATION_PACE, `${arrived[0]} arrived with the rule`);
  assert.ok(arrived[1] <= MIGRANTS_PER_DAY, `${arrived[1]} arrived without the rule`);
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.migrationPacePolicyId, MIGRATION_PACE_POLICY); assert.equal(doc.runtime.migrationPacePolicyId, MIGRATION_PACE_POLICY);
  assert.throws(() => validateMigrationPacePolicy({ ...doc, migrationPacePolicyId: undefined }), /migration pace/);
  assert.throws(() => validateMigrationPacePolicy({ ...doc, runtime: { ...doc.runtime, migrationPacePolicyId: undefined } }), /migration pace/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('migrationPace'), false);
});
