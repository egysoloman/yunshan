import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { closeFiscalDay, COUNCIL_TAX_CEILING, COUNCIL_TAX_FLOOR, councilTaxRate, PROFIT_TAX_SHARE, dividendWaitsForPayroll, privateWageBase, profitTaxSplit, reliefPayments, SHOP_PROFIT_TAX_POLICY, SHOP_PROFIT_TAX_POLICY_V2, SHOP_PROFIT_TAX_POLICY_V3, SHOP_PROFIT_TAX_POLICY_V4, SHOP_PROFIT_TAX_POLICY_V5, SHOP_PROFIT_TAX_POLICY_V6, SHOP_PROFIT_TAX_POLICY_V7, ownersMayClose, OWNER_CLOSE_LOSS, shopStaffMayMove, STAFF_PROFIT_SHARE, STUDENT_BURSARY, STUDY_GRANT_CEILING, STUDY_GRANT_PER_MINUTE, staffProfitShare, studentBursaries, studyGrant, validatePublicFinancePolicy } from '../src/simulation/public-finance';
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
  assert.equal(city.publicFinancePolicyId, SHOP_PROFIT_TAX_POLICY_V7);
  assert.equal(doc.publicFinancePolicyId, SHOP_PROFIT_TAX_POLICY_V7); assert.equal(doc.runtime.publicFinancePolicyId, SHOP_PROFIT_TAX_POLICY_V7);
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

test('v2 keeps the 20% profit tax and pays dividends while wages are owed; v1 and legacy wait for none owed', () => {
  const split = profitTaxSplit(SHOP_PROFIT_TAX_POLICY_V2, 100);
  assert.equal(split.tax, 100 * PROFIT_TAX_SHARE); assert.equal(split.tax + split.dividend, 100);
  assert.equal(dividendWaitsForPayroll(SHOP_PROFIT_TAX_POLICY_V2), false);
  assert.equal(dividendWaitsForPayroll(SHOP_PROFIT_TAX_POLICY), true);
  assert.equal(dividendWaitsForPayroll(undefined), true);
});

test('v3 keeps v2 dividends and the 20% profit tax and raises only the private shop wage base', () => {
  assert.equal(privateWageBase(SHOP_PROFIT_TAX_POLICY_V3), 40);
  for (const policy of [SHOP_PROFIT_TAX_POLICY_V2, SHOP_PROFIT_TAX_POLICY, undefined]) assert.equal(privateWageBase(policy), 32);
  assert.equal(dividendWaitsForPayroll(SHOP_PROFIT_TAX_POLICY_V3), false);
  assert.equal(profitTaxSplit(SHOP_PROFIT_TAX_POLICY_V3, 100).tax, 100 * PROFIT_TAX_SHARE);
});

test('v4 keeps v3 and gives the shop staff an equal share of the owner dividend', () => {
  assert.equal(privateWageBase(SHOP_PROFIT_TAX_POLICY_V4), 40);
  assert.equal(dividendWaitsForPayroll(SHOP_PROFIT_TAX_POLICY_V4), false);
  assert.equal(profitTaxSplit(SHOP_PROFIT_TAX_POLICY_V4, 100).tax, 100 * PROFIT_TAX_SHARE);
  assert.deepEqual(staffProfitShare(SHOP_PROFIT_TAX_POLICY_V4, 100, 3), { owner: 100 - 100 * STAFF_PROFIT_SHARE, each: 100 * STAFF_PROFIT_SHARE / 3 });
  for (const [policy, staff] of [[SHOP_PROFIT_TAX_POLICY_V3, 3], [SHOP_PROFIT_TAX_POLICY_V4, 0], [undefined, 2]] as const) assert.deepEqual(staffProfitShare(policy, 100, staff), { owner: 100, each: 0 });
  const world = civicFixtureWorld(), sim = createCurrentProductCity(world), flows = listen(sim);
  sim.command({ type: 'speed', value: 8 });
  const companies = new Set(sim.state.extension!.companies.filter(c => c.shopBindingReleasedAt === undefined).map(c => c.buildingId));
  const shop = sim.state.shops.find(s => s.ownerId && s.ownerId !== 'player' && !companies.has(s.buildingId) && sim.state.citizens.some(c => c.workId === s.buildingId && c.id !== s.ownerId && c.role !== '学生'))!; assert.ok(shop, 'a staffed owner shop');
  const staff = sim.state.citizens.filter(c => c.workId === shop.buildingId && c.id !== shop.ownerId && c.role !== '学生');
  shop.cash = (shop.cash ?? 0) + 2000; shop.profit = Math.max(shop.profit, 2000);
  for (let tick = 0; tick < 60 && !flows.some(f => f.shopId === shop.id && f.type === 'business-dividend'); tick++) sim.step(.25);
  const paid = flows.filter(f => f.shopId === shop.id && f.type === 'business-dividend') as { citizenId?: string; amount?: number }[];
  const toStaff = paid.filter(f => staff.some(c => c.id === f.citizenId)).reduce((n, f) => n + (f.amount ?? 0), 0), all = paid.reduce((n, f) => n + (f.amount ?? 0), 0);
  assert.ok(all > 0 && Math.abs(toStaff - all * STAFF_PROFIT_SHARE) < 1e-6, `staff received ${toStaff} of ${all}`);
});

test('v5 keeps v4 and pays students below the ceiling a grant for minutes studied at school from available public cash', () => {
  assert.equal(privateWageBase(SHOP_PROFIT_TAX_POLICY_V5), 40);
  assert.equal(dividendWaitsForPayroll(SHOP_PROFIT_TAX_POLICY_V5), false);
  assert.equal(staffProfitShare(SHOP_PROFIT_TAX_POLICY_V5, 100, 2).each, 100 * STAFF_PROFIT_SHARE / 2);
  assert.equal(studyGrant(SHOP_PROFIT_TAX_POLICY_V5, 60, 1e6), 60 * STUDY_GRANT_PER_MINUTE);
  assert.equal(studyGrant(SHOP_PROFIT_TAX_POLICY_V5, 60, 1), 1, 'never more than the available cash');
  assert.equal(studyGrant(SHOP_PROFIT_TAX_POLICY_V5, 60, 1e6, STUDY_GRANT_CEILING - 2), 2, 'never past the ceiling');
  assert.equal(studyGrant(SHOP_PROFIT_TAX_POLICY_V5, 60, 1e6, STUDY_GRANT_CEILING + 5), 0, 'a student above the ceiling receives nothing');
  for (const policy of [SHOP_PROFIT_TAX_POLICY_V4, SHOP_PROFIT_TAX_POLICY, undefined]) assert.equal(studyGrant(policy, 60, 1e6), 0);
  // The civic fixture has no school; the product world's students study at real schools.
  const world = createProductWorld(), sim = createCurrentProductCity(world), grants: { citizenId?: string; amount?: number }[] = [];
  (sim as unknown as { bus: { on(type: string, f: (e: { citizenId?: string; amount?: number }) => void): void } }).bus.on('study-grant', e => grants.push(e));
  sim.command({ type: 'speed', value: 8 });
  const treasury = sim.state.treasury;
  sim.setFocus(world.spawn, 'walk');
  // Students start with 150–500 coins: every student is made poor, the grant's only qualifying condition.
  for (const c of sim.state.citizens) if (c.role === '学生') c.money = 0;
  for (let tick = 0; tick < 1200 && !grants.length; tick++) sim.step(.25);
  assert.ok(grants.length > 0, 'a student studying at school received a grant');
  assert.ok(grants.every(g => sim.state.citizens.find(c => c.id === g.citizenId)?.role === '学生'), 'only students');
  assert.ok(Number.isFinite(sim.state.treasury) && treasury > 0);
});

test('v5 pays each student below the ceiling a daily bursary, poorest first, never past the ceiling or the available cash', () => {
  const students = [{ id: 'a', money: 110 }, { id: 'b', money: 5 }, { id: 'c', money: 200 }];
  assert.deepEqual(studentBursaries(SHOP_PROFIT_TAX_POLICY_V5, students, 1e6), [{ id: 'b', amount: STUDENT_BURSARY }, { id: 'a', amount: STUDY_GRANT_CEILING - 110 }]);
  assert.deepEqual(studentBursaries(SHOP_PROFIT_TAX_POLICY_V5, students, 7), [{ id: 'b', amount: 7 }]);
  for (const policy of [SHOP_PROFIT_TAX_POLICY_V4, undefined]) assert.deepEqual(studentBursaries(policy, students, 1e6), []);
});

test('v6 keeps v5 and lets a poor worker leave a shop that cannot fund a day\'s wage for a funded offer', () => {
  assert.equal(privateWageBase(SHOP_PROFIT_TAX_POLICY_V6), 40);
  assert.equal(staffProfitShare(SHOP_PROFIT_TAX_POLICY_V6, 100, 2).each, 100 * STAFF_PROFIT_SHARE / 2);
  assert.equal(studyGrant(SHOP_PROFIT_TAX_POLICY_V6, 60, 1e6), 60 * STUDY_GRANT_PER_MINUTE);
  assert.equal(studentBursaries(SHOP_PROFIT_TAX_POLICY_V6, [{ id: 'a', money: 0 }], 1e6)[0].amount, STUDENT_BURSARY);
  assert.equal(shopStaffMayMove(SHOP_PROFIT_TAX_POLICY_V6), true);
  for (const policy of [SHOP_PROFIT_TAX_POLICY_V5, SHOP_PROFIT_TAX_POLICY_V4, undefined]) assert.equal(shopStaffMayMove(policy), false);
  const world = createProductWorld();
  for (const [policy, moves] of [[true, true], [false, false]] as const) {
    const sim = policy ? createCurrentProductCity(world) : createArchivedProductCity(world);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    // Controlled: every shop with staff but no owner among them is drained; its staff are made poor.
    const drained = sim.state.shops.filter(shop => sim.state.citizens.some(c => c.workId === shop.buildingId && c.id !== shop.ownerId && c.role !== '学生')).slice(0, 12);
    const staff = new Map(drained.flatMap(shop => sim.state.citizens.filter(c => c.workId === shop.buildingId && c.id !== shop.ownerId && c.role !== '学生').map(c => [c.id, shop.buildingId] as const)));
    // Below a day's wage but not empty: owners can still sign a few funded minutes, as summit-b8 did.
    for (const shop of drained) { shop.cash = 30; }
    for (const c of sim.state.citizens) if (staff.has(c.id)) c.money = 20;
    for (let tick = 0; tick < 600; tick++) sim.step(.25);
    const moved = sim.state.citizens.filter(c => staff.has(c.id) && c.workId !== staff.get(c.id));
    if (moves) assert.ok(moved.length > 0 && moved.every(c => sim.state.shops.some(shop => shop.buildingId === c.workId)), `${moved.length} of ${staff.size} moved to another shop`);
    else assert.equal(moved.filter(c => sim.state.shops.some(shop => shop.buildingId === c.workId)).length, 0, 'an archived city keeps shop staff where they are');
    const reader = policy ? createCurrentProductCity(world) : createArchivedProductCity(world), saved = sim.exportSave(), read = reader.importSave(saved);
    assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved, 'the city after moves saves and reads back exactly');
  }
});

test('v7 keeps v6 and lets the owner of a loss-making market close it; the city still saves and reads back', () => {
  assert.equal(ownersMayClose(SHOP_PROFIT_TAX_POLICY_V7), true);
  for (const policy of [SHOP_PROFIT_TAX_POLICY_V6, SHOP_PROFIT_TAX_POLICY_V5, undefined]) assert.equal(ownersMayClose(policy), false);
  assert.equal(shopStaffMayMove(SHOP_PROFIT_TAX_POLICY_V7), true);
  assert.equal(studyGrant(SHOP_PROFIT_TAX_POLICY_V7, 60, 1e6), 60 * STUDY_GRANT_PER_MINUTE);
  const world = createProductWorld();
  for (const [current, closes] of [[true, true], [false, false]] as const) {
    const sim = current ? createCurrentProductCity(world) : createArchivedProductCity(world);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    const companies = new Set(sim.state.extension!.companies.filter(c => c.shopBindingReleasedAt === undefined).map(c => c.buildingId));
    const markets = new Set(world.buildings.filter(b => b.kind === 'market' && !b.facility).map(b => b.id));
    // Controlled: a few NPC-owned markets have lost more than the v7 threshold (but far less than 600) and hold no spare cash.
    const shops = sim.state.shops.filter(shop => shop.ownerId && shop.ownerId !== 'player' && markets.has(shop.buildingId) && !companies.has(shop.buildingId)).slice(0, 6);
    for (const shop of shops) { shop.profit = -(OWNER_CLOSE_LOSS + 50); shop.cash = 0; }
    for (let tick = 0; tick < 900; tick++) sim.step(.25);
    const titles = (sim.state as unknown as { shopLifecycle?: { titles: Record<string, { state: string }> } }).shopLifecycle?.titles ?? {};
    const closed = shops.filter(shop => titles[shop.id]?.state === 'suspended' || titles[shop.id]?.state === 'reopening');
    if (closes) assert.ok(closed.length > 0, `owners closed ${closed.length} of ${shops.length} loss-making markets`);
    else assert.equal(closed.length, 0, 'an archived city keeps the original suspension rule (loss of 600 and no stock)');
    const reader = current ? createCurrentProductCity(world) : createArchivedProductCity(world), saved = sim.exportSave(), read = reader.importSave(saved);
    assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  }
});
