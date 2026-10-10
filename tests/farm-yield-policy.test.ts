import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { LEGACY_LABOR_MINUTES_PER_UNIT, LEGACY_PRODUCER_STOCK_CAP, laborMinutesPerUnit, producerStockCap, STAFFED_FARM_YIELD_POLICY, STAFFED_FARM_YIELD_POLICY_V2, STAFFED_FARM_YIELD_POLICY_V3, FARM_INPUT_PER_UNIT, foodOutputWithInputs, UNAIDED_FOOD_RATE, STAFFED_FOOD_LABOR_MINUTES_PER_UNIT, STAFFED_FOOD_LABOR_MINUTES_PER_UNIT_V2, STAFFED_FOOD_PRODUCER_STOCK_CAP_V2, validateFarmYieldPolicy } from '../src/simulation/farm-yield';
import { hasCityRulesetDeclaration } from '../src/simulation/city-ruleset';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';

test('farm yield policy keeps absence and requires a matched explicit v4 native-motion pair', () => {
  for (const version of [1, 2, 3, 4]) validateFarmYieldPolicy({ version, runtime: {} });
  const declared = { version: 4, motionVersion: 2, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY, runtime: { npcMotionVersion: 2, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY } };
  validateFarmYieldPolicy(declared);
  validateFarmYieldPolicy({ ...declared, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY_V2, runtime: { ...declared.runtime, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY_V2 } });
  assert.throws(() => validateFarmYieldPolicy({ ...declared, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY_V2 }), /farm yield policy pair/, 'envelope and runtime must name the same version');
  assert.equal(hasCityRulesetDeclaration(declared), true);
  assert.equal(hasCityRulesetDeclaration({ version: 1, state: {}, runtime: { farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY } }), true);
  for (const body of [{ ...declared, farmYieldPolicyId: undefined }, { ...declared, farmYieldPolicyId: 'invented' }, { ...declared, version: 3 }, { ...declared, motionVersion: 1 },
    { ...declared, runtime: {} }, { ...declared, runtime: { npcMotionVersion: 1, farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY } }, { version: 4, motionVersion: 2, runtime: declared.runtime }])
    assert.throws(() => validateFarmYieldPolicy(body), /farm yield policy pair/);
});

test('only food producers of a declared city change yield; workshops and legacy cities keep 30 minutes', () => {
  assert.equal(laborMinutesPerUnit(undefined, 'farm'), LEGACY_LABOR_MINUTES_PER_UNIT);
  assert.equal(laborMinutesPerUnit(STAFFED_FARM_YIELD_POLICY, 'farm'), STAFFED_FOOD_LABOR_MINUTES_PER_UNIT);
  assert.equal(laborMinutesPerUnit(STAFFED_FARM_YIELD_POLICY, 'dock'), STAFFED_FOOD_LABOR_MINUTES_PER_UNIT);
  assert.equal(laborMinutesPerUnit(STAFFED_FARM_YIELD_POLICY, 'workshop'), LEGACY_LABOR_MINUTES_PER_UNIT);
  assert.equal(laborMinutesPerUnit(STAFFED_FARM_YIELD_POLICY_V2, 'dock'), STAFFED_FOOD_LABOR_MINUTES_PER_UNIT_V2);
  assert.equal(laborMinutesPerUnit(STAFFED_FARM_YIELD_POLICY_V2, 'workshop'), LEGACY_LABOR_MINUTES_PER_UNIT);
  assert.equal(producerStockCap(STAFFED_FARM_YIELD_POLICY_V2, 'farm'), STAFFED_FOOD_PRODUCER_STOCK_CAP_V2);
  for (const [policy, kind] of [[STAFFED_FARM_YIELD_POLICY, 'farm'], [undefined, 'dock'], [STAFFED_FARM_YIELD_POLICY_V2, 'workshop']] as const) assert.equal(producerStockCap(policy, kind), LEGACY_PRODUCER_STOCK_CAP);
  assert.throws(() => new Simulation(civicFixtureWorld(), { rulesetId: 'civic-local-v1', farmYieldPolicyId: STAFFED_FARM_YIELD_POLICY }), /不支持的显式城市规则版本/);
});

test('a new product city declares the policy and keeps it through save, partitions and import; an archive does not acquire it', () => {
  const world = civicFixtureWorld(), city = createCurrentProductCity(world), saved = city.exportSave(), doc = JSON.parse(saved);
  assert.equal(city.farmYieldPolicyId, STAFFED_FARM_YIELD_POLICY_V3);
  assert.equal(doc.farmYieldPolicyId, STAFFED_FARM_YIELD_POLICY_V3); assert.equal(doc.runtime.farmYieldPolicyId, STAFFED_FARM_YIELD_POLICY_V3);
  assert.deepEqual(doc.runtime.farmInputs, {}, 'a v3 city starts with no farm inputs');
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  const reader = createCurrentProductCity(world); assert.equal(reader.importSave(saved).ok, true); assert.equal(reader.exportSave(), saved);
  for (let tick = 0; tick < 12; tick++) { city.step(.25); reader.step(.25); assert.equal(reader.exportSave(), city.exportSave()); }
  const archive = createArchivedProductCity(world), original = archive.exportSave();
  assert.equal(archive.farmYieldPolicyId, 'legacy'); assert.equal(Object.hasOwn(JSON.parse(original), 'farmYieldPolicyId'), false);
  const current = createCurrentProductCity(world); assert.equal(current.importSave(original).ok, true); assert.equal(current.farmYieldPolicyId, 'legacy'); assert.equal(current.exportSave(), original);
  const forged = { ...doc, runtime: { ...doc.runtime } }; delete forged.runtime.farmYieldPolicyId;
  assert.equal(createCurrentProductCity(world).importSave(JSON.stringify(forged)).ok, false, 'a half declaration is rejected');
});

test('v3 food output uses inputs first and yields at the unaided rate without them, within the store', () => {
  assert.equal(laborMinutesPerUnit(STAFFED_FARM_YIELD_POLICY_V3, 'farm'), STAFFED_FOOD_LABOR_MINUTES_PER_UNIT_V2);
  assert.equal(producerStockCap(STAFFED_FARM_YIELD_POLICY_V3, 'dock'), STAFFED_FOOD_PRODUCER_STOCK_CAP_V2);
  assert.equal(laborMinutesPerUnit(STAFFED_FARM_YIELD_POLICY_V3, 'workshop'), LEGACY_LABOR_MINUTES_PER_UNIT);
  assert.deepEqual(foodOutputWithInputs(10, 5, 100), { units: 10, inputsUsed: 10 * FARM_INPUT_PER_UNIT });
  assert.deepEqual(foodOutputWithInputs(10, 0, 100), { units: 10 * UNAIDED_FOOD_RATE, inputsUsed: 0 });
  const partial = foodOutputWithInputs(10, .4, 100); // 4 aided units, 6 unaided
  assert.ok(Math.abs(partial.units - (4 + 6 * UNAIDED_FOOD_RATE)) < 1e-9 && Math.abs(partial.inputsUsed - .4) < 1e-9);
  assert.deepEqual(foodOutputWithInputs(10, 5, 3), { units: 3, inputsUsed: 3 * FARM_INPUT_PER_UNIT }, 'a full store consumes only what it produced');
});

test('v3 staffed food producers buy workshop materials as taxed wholesale inputs and use them', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world), internals = sim as unknown as { runtime: { farmInputs: Record<string, number> }; bus: { on(type: string, f: (e: { purpose?: string; amount?: number; quantity?: number }) => void): void } };
  const bought: { amount: number; quantity: number }[] = [];
  internals.bus.on('wholesale', e => { if (e.purpose === 'farm-inputs') bought.push({ amount: e.amount ?? 0, quantity: e.quantity ?? 0 }); });
  sim.command({ type: 'speed', value: 8 });
  const materials = () => sim.state.shops.filter(s => world.buildings.find(b => b.id === s.buildingId)?.kind === 'workshop').reduce((n, s) => n + s.inventory, 0);
  for (let tick = 0; tick < 240 && !bought.length; tick++) sim.step(.25);
  assert.ok(bought.length > 0 && bought.every(b => b.quantity >= 1 && b.amount > 0), 'a producer paid for inputs');
  const held = Object.values(internals.runtime.farmInputs).reduce((a, b) => a + b, 0);
  assert.ok(held > 0 && held <= bought.reduce((n, b) => n + b.quantity, 0) + 1e-9, 'inputs held never exceed what was bought');
  assert.ok(Number.isFinite(materials()));
  const saved = sim.exportSave(), reader = createCurrentProductCity(world);
  assert.equal(reader.importSave(saved).ok, true); assert.equal(reader.exportSave(), saved);
});
