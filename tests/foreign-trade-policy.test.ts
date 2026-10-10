import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { allocateExports, EXPORT_UNITS_PER_HOUR, FOREIGN_TRADE_POLICY, MATERIAL_EXPORT_LINE, validateForeignTradePolicy } from '../src/simulation/foreign-trade';
import { hasCityRulesetDeclaration } from '../src/simulation/city-ruleset';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';

const trade = { enabled: true, exportedUnits: 0, exportGross: 0 };

test('foreign trade policy keeps absence and requires a matched explicit v4 native-motion pair with its state', () => {
  for (const version of [1, 2, 3, 4]) validateForeignTradePolicy({ version, runtime: {} });
  const declared = { version: 4, motionVersion: 2, foreignTradePolicyId: FOREIGN_TRADE_POLICY, runtime: { npcMotionVersion: 2, foreignTradePolicyId: FOREIGN_TRADE_POLICY, foreignTrade: trade } };
  validateForeignTradePolicy(declared);
  assert.equal(hasCityRulesetDeclaration(declared), true);
  for (const body of [{ ...declared, foreignTradePolicyId: 'invented' }, { ...declared, version: 3 }, { ...declared, runtime: { ...declared.runtime, foreignTrade: undefined } },
    { ...declared, runtime: { ...declared.runtime, foreignTrade: { ...trade, enabled: 'yes' } } }, { ...declared, runtime: { ...declared.runtime, foreignTrade: { ...trade, exportGross: -1 } } }])
    assert.throws(() => validateForeignTradePolicy(body), /foreign trade policy pair/);
  assert.throws(() => new Simulation(civicFixtureWorld(), { rulesetId: 'civic-local-v1', foreignTradePolicyId: FOREIGN_TRADE_POLICY }), /不支持的显式城市规则版本/);
});

test('the hour\'s cargo capacity goes to the largest surpluses first in whole units', () => {
  assert.deepEqual(allocateExports([{ shopId: 'a', surplus: 10.6, price: 6 }, { shopId: 'b', surplus: 50, price: 4.5 }, { shopId: 'c', surplus: -3, price: 6 }], 55),
    [{ shopId: 'b', quantity: 50, price: 4.5 }, { shopId: 'a', quantity: 5, price: 6 }]);
  assert.deepEqual(allocateExports([{ shopId: 'a', surplus: 10, price: 6 }], 0), []);
});

test('a new product city declares trade and keeps it through save, partitions and import; an archive does not acquire it', () => {
  const world = civicFixtureWorld(), city = createCurrentProductCity(world), saved = city.exportSave(), doc = JSON.parse(saved);
  assert.equal(city.foreignTradePolicyId, FOREIGN_TRADE_POLICY);
  assert.equal(doc.foreignTradePolicyId, FOREIGN_TRADE_POLICY); assert.deepEqual(doc.runtime.foreignTrade, trade);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  const reader = createCurrentProductCity(world); assert.equal(reader.importSave(saved).ok, true); assert.equal(reader.exportSave(), saved);
  const archive = createArchivedProductCity(world);
  assert.equal(archive.foreignTradePolicyId, 'legacy'); assert.equal(Object.hasOwn(JSON.parse(archive.exportSave()), 'foreignTradePolicyId'), false);
  assert.equal(archive.command({ type: 'foreignTrade', value: 0 }).ok, false);
});

test('surplus workshop materials are exported at the settlement hour as new taxed money; only a mayor may close trade', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world), internals = sim as unknown as { runtime: { taxes: number }; addIdentity(role: string): void; bus: { on(type: string, f: (e: { shopId?: string; amount?: number; quantity?: number }) => void): void } };
  const exports: { shopId?: string; amount?: number; quantity?: number }[] = []; internals.bus.on('foreign-export', e => exports.push(e));
  sim.command({ type: 'speed', value: 8 });
  // Controlled surplus in one workshop; every flow after it is the simulator's own.
  const shop = sim.state.shops.find(s => world.buildings.find(b => b.id === s.buildingId && b.kind === 'workshop' && !b.facility))!;
  shop.inventory = MATERIAL_EXPORT_LINE + 2000;
  for (let tick = 0; tick < 60 && !exports.some(e => e.shopId === shop.id); tick++) sim.step(.25);
  const mine = exports.filter(e => e.shopId === shop.id);
  assert.ok(mine.length > 0 && mine.every(e => (e.quantity ?? 0) >= 1 && (e.amount ?? 0) > 0), 'the surplus left on a cargo flight for money');
  assert.ok(exports.reduce((n, e) => n + (e.quantity ?? 0), 0) <= EXPORT_UNITS_PER_HOUR * Math.ceil(60 * .25 * 8 / 60), 'never more than the flights carry');
  assert.equal(sim.command({ type: 'foreignTrade', value: 0 }).ok, false, 'a non-mayor cannot close trade');
  internals.addIdentity('mayor');
  assert.equal(sim.command({ type: 'foreignTrade', value: 0 }).ok, true);
  const before = exports.length; shop.inventory = MATERIAL_EXPORT_LINE + 2000;
  for (let tick = 0; tick < 60; tick++) sim.step(.25);
  assert.equal(exports.length, before, 'a closed city exports nothing');
});
