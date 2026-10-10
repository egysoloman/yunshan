import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity } from '../src/product-city';
import { closeFiscalDay, COUNCIL_TAX_CEILING, COUNCIL_TAX_FLOOR, councilTaxRate, PROFIT_TAX_SHARE, profitTaxSplit, reliefPayments, SHOP_PROFIT_TAX_POLICY, validatePublicFinancePolicy } from '../src/simulation/public-finance';
import { hasCityRulesetDeclaration } from '../src/simulation/city-ruleset';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';

type Flow = { type: string; shopId?: string; amount?: number };
const listen = (sim: Simulation) => {
  const flows: Flow[] = [], bus = (sim as unknown as { bus: { on(type: string, f: (e: Flow) => void): void } }).bus;
  for (const type of ['profit-tax', 'business-dividend']) bus.on(type, e => flows.push({ ...e, type }));
  return flows;
};
const total = (flows: Flow[], type: string, shopId?: string) => flows.filter(f => f.type === type && (!shopId || f.shopId === shopId)).reduce((n, f) => n + (f.amount ?? 0), 0);

test('public finance policy keeps absence and requires a matched explicit v4 native-motion pair', () => {
  for (const version of [1, 2, 3, 4]) validatePublicFinancePolicy({ version, runtime: {} });
  const declared = { version: 4, motionVersion: 2, publicFinancePolicyId: SHOP_PROFIT_TAX_POLICY, runtime: { npcMotionVersion: 2, publicFinancePolicyId: SHOP_PROFIT_TAX_POLICY } };
  validatePublicFinancePolicy(declared);
  assert.equal(hasCityRulesetDeclaration(declared), true);
  for (const body of [{ ...declared, publicFinancePolicyId: 'invented' }, { ...declared, version: 3 }, { ...declared, motionVersion: 1 }, { ...declared, runtime: {} },
    { ...declared, runtime: { npcMotionVersion: 1, publicFinancePolicyId: SHOP_PROFIT_TAX_POLICY } }])
    assert.throws(() => validatePublicFinancePolicy(body), /public finance policy pair/);
  assert.throws(() => new Simulation(civicFixtureWorld(), { rulesetId: 'civic-local-v1', publicFinancePolicyId: SHOP_PROFIT_TAX_POLICY }), /不支持的显式城市规则版本/);
});

test('the profit tax takes its share of the distributable amount and the owner receives the rest', () => {
  assert.deepEqual(profitTaxSplit(undefined, 100), { tax: 0, dividend: 100 });
  const split = profitTaxSplit(SHOP_PROFIT_TAX_POLICY, 100);
  assert.equal(split.tax, 100 * PROFIT_TAX_SHARE); assert.equal(split.tax + split.dividend, 100);
});

test('a new product city declares the policy and keeps it through save, partitions and import; an archive does not acquire it', () => {
  const world = civicFixtureWorld(), city = createCurrentProductCity(world), saved = city.exportSave(), doc = JSON.parse(saved);
  assert.equal(city.publicFinancePolicyId, SHOP_PROFIT_TAX_POLICY);
  assert.equal(doc.publicFinancePolicyId, SHOP_PROFIT_TAX_POLICY); assert.equal(doc.runtime.publicFinancePolicyId, SHOP_PROFIT_TAX_POLICY);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  const reader = createCurrentProductCity(world); assert.equal(reader.importSave(saved).ok, true); assert.equal(reader.exportSave(), saved);
  for (let tick = 0; tick < 12; tick++) { city.step(.25); reader.step(.25); assert.equal(reader.exportSave(), city.exportSave()); }
  const archive = createArchivedProductCity(world);
  assert.equal(archive.publicFinancePolicyId, 'legacy'); assert.equal(Object.hasOwn(JSON.parse(archive.exportSave()), 'publicFinancePolicyId'), false);
  const forged = { ...doc, runtime: { ...doc.runtime } }; delete forged.runtime.publicFinancePolicyId;
  assert.equal(createCurrentProductCity(world).importSave(JSON.stringify(forged)).ok, false, 'a half declaration is rejected');
});

test('an owner shop with surplus cash pays the public its share at the hourly settlement', () => {
  const world = civicFixtureWorld();
  for (const [make, taxed] of [[createCurrentProductCity, true], [createArchivedProductCity, false]] as const) {
    const sim = make(world), flows = listen(sim);
    sim.command({ type: 'speed', value: 8 });
    // Controlled surplus in one owner shop (not a company shop); every flow after it is the simulator's own.
    // Whole-city money conservation is checked by the economy audit (moneyConservationResidual).
    const companies = new Set(sim.state.extension!.companies.filter(c => c.shopBindingReleasedAt === undefined).map(c => c.buildingId));
    const shop = sim.state.shops.find(s => s.ownerId && s.ownerId !== 'player' && !companies.has(s.buildingId))!; assert.ok(shop);
    shop.cash = (shop.cash ?? 0) + 2000; shop.profit = Math.max(shop.profit, 2000);
    for (let tick = 0; tick < 60 && !flows.some(f => f.shopId === shop.id && f.type === 'business-dividend'); tick++) sim.step(.25);
    const dividend = total(flows, 'business-dividend', shop.id), tax = total(flows, 'profit-tax', shop.id);
    assert.ok(dividend > 0, 'the surplus shop paid its owner');
    if (taxed) assert.ok(Math.abs(tax - dividend * PROFIT_TAX_SHARE / (1 - PROFIT_TAX_SHARE)) < 1e-6, `tax ${tax} is the policy share of the distribution (dividend ${dividend})`);
    else assert.equal(total(flows, 'profit-tax'), 0, 'an archived city keeps untaxed dividends');
  }
});

test('the council raises the rate by the shortfall share of turnover, capped, and lowers it only above the founding treasury', () => {
  assert.equal(councilTaxRate(.08, -1000, 50000, 40000), .1, 'a 1,000 shortfall on 50,000 turnover adds two points');
  assert.equal(councilTaxRate(.08, -100000, 50000, 40000), .13, 'at most five points a day');
  assert.equal(councilTaxRate(.29, -5000, 50000, 40000), COUNCIL_TAX_CEILING);
  assert.equal(councilTaxRate(.2, 5000, 50000, 40000), .2, 'a surplus below the founding treasury rebuilds it');
  assert.equal(councilTaxRate(.2, 500, 50000, 90000), .19);
  assert.equal(councilTaxRate(.09, 5000, 50000, 90000), COUNCIL_TAX_FLOOR);
  assert.equal(councilTaxRate(.1, -1000, 0, 40000), .1, 'no turnover, no basis for a change');
  assert.deepEqual(closeFiscalDay({ day: 1, treasury: 10000, tax: 800, net: 0, base: 0 }, .08, 9000), { net: -1000, base: 10000 });
  assert.deepEqual(closeFiscalDay({ day: 2, treasury: 10000, tax: 800, net: -3000, base: 20000 }, .08, 11000), { net: -1000, base: 15000 });
});

test('a non-mayor city adjusts its tax at the day boundary; a player mayor keeps the rate', () => {
  for (const mayor of [false, true]) {
    const sim = createCurrentProductCity(civicFixtureWorld()), runtime = (sim as unknown as { runtime: { fiscalDay: { day: number; treasury: number; tax: number; net: number; base: number } } }).runtime;
    if (mayor) (sim as unknown as { addIdentity(role: string): void }).addIdentity('mayor');
    sim.command({ type: 'speed', value: 8 });
    // Controlled history: yesterday ran a 1,000 shortfall on 50,000 taxed turnover.
    runtime.fiscalDay = { day: sim.state.day, treasury: sim.state.treasury + 1000, tax: 50000 * sim.state.taxRate, net: 0, base: 0 };
    const before = sim.state.taxRate, day = sim.state.day;
    for (let tick = 0; tick < 900 && sim.state.day === day; tick++) sim.step(.25);
    assert.notEqual(sim.state.day, day);
    if (mayor) assert.equal(sim.state.taxRate, before, 'the mayor alone sets the rate');
    else assert.ok(sim.state.taxRate > before, `the council raised ${before} to ${sim.state.taxRate}`);
  }
});

test('relief tops the poorest up to the floor first and never exceeds the available cash', () => {
  assert.deepEqual(reliefPayments([{ id: 'b', money: 10 }, { id: 'a', money: 2 }, { id: 'c', money: 40 }], 30, 1000), [{ id: 'a', amount: 28 }, { id: 'b', amount: 20 }]);
  assert.deepEqual(reliefPayments([{ id: 'b', money: 10 }, { id: 'a', money: 2 }], 30, 35), [{ id: 'a', amount: 28 }, { id: 'b', amount: 7 }]);
  assert.deepEqual(reliefPayments([{ id: 'a', money: 2 }], 30, 0), []);
});

test('at the day boundary a declared city pays relief to a resident below two meals; an archived city does not', () => {
  for (const [make, declared] of [[createCurrentProductCity, true], [createArchivedProductCity, false]] as const) {
    const sim = make(civicFixtureWorld()), flows: { citizenId?: string; amount?: number }[] = [];
    (sim as unknown as { bus: { on(type: string, f: (e: { citizenId?: string; amount?: number }) => void): void } }).bus.on('public-relief', e => flows.push(e));
    sim.command({ type: 'speed', value: 8 });
    const person = sim.state.citizens.find(c => c.role !== '学生')!; person.money = 1; // controlled poverty; the rest is the simulator's own
    const day = sim.state.day;
    for (let tick = 0; tick < 900 && sim.state.day === day; tick++) sim.step(.25);
    const paid = flows.filter(f => f.citizenId === person.id).reduce((n, f) => n + (f.amount ?? 0), 0);
    if (declared) assert.ok(paid > 0, 'the poor resident received relief'); else assert.equal(flows.length, 0);
  }
});
