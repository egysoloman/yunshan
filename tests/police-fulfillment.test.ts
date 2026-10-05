import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';
import type { BuildingKind, Citizen, Crime, WorldDefinition } from '../src/types';

// Synthetic PRE-constructor geometry. People, qualifications, cash, goods,
// wages and needs all come from the unchanged constructor. An explicit open
// incident isolates dispatch; it is not presented as a natural crime sample.
function world(foodOnly = false): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'hall', 'police', foodOnly ? 'dock' : 'workshop', 'farm', 'school', 'core'];
  const buildings = kinds.map((kind, index) => ({ id: `site-${index}`, districtId: 'district', name: kind, kind,
    ...(kind === 'core' ? { facility: 'council' as const } : {}),
    position: { x: index * 24, y: 20, z: 0 }, door: { x: index * 24, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: index }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: 'district', name: site.name, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const, length: 24, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261003, voxelSize: .2, size: 1000, districts: [{ id: 'district', name: '警務履约测试', kind: 'market', center: { x: 48, y: 20, z: 5 }, radius: 500, population: 384, color: '#abc' }], buildings, nodes, edges, mountains: [], spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 500, y: 40, z: 500 }, bottom: { x: 500, y: 20, z: 500 }, width: 10 }, river: [] };
}
const runtime = (sim: Simulation): any => Reflect.get(sim, 'runtime');
const call = (sim: Simulation, key: string, ...args: unknown[]): any => Reflect.get(sim, key).call(sim, ...args);
function cash(sim: Simulation): number {
  const s = sim.state, e = s.extension!, r = runtime(sim);
  return s.treasury + r.taxes + s.player.money + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + r.investment)
    + s.citizens.reduce((sum, person) => sum + person.money, 0) + e.organizations.reduce((sum, org) => sum + org.funds, 0)
    + e.companies.reduce((sum, company) => sum + company.capital, 0)
    + s.shops.filter(shop => !e.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + shopLifecycleHeldCash(s) + (s.hygiene?.jobs.reduce((sum, item) => sum + item.escrow, 0) ?? 0) + (s.family?.pregnancies.reduce((sum, item) => sum + item.escrow, 0) ?? 0)
    + (s.family?.households?.reduce((sum, item) => sum + item.balance, 0) ?? 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.education?.course?.escrow ?? 0) + (s.clinical?.orders.reduce((sum, item) => sum + item.escrow, 0) ?? 0)
    + (s.power?.repairs.reduce((sum, item) => sum + item.escrow, 0) ?? 0) + (s.roadworks?.jobs.reduce((sum, item) => sum + item.escrow, 0) ?? 0);
}
function observe(sim: Simulation, scope: string) {
  const events: unknown[] = [], root = process.env.POLICE_ARTIFACT_ROOT;
  for (const kind of ['security-procurement', 'dispatch', 'officer-arrived', 'wage-earned', 'wage-paid', 'crime-resolved', 'police-supply-consumed', 'police-response-withdrawn', 'public-shift-authorized']) sim.onEvent(kind, event => events.push(structuredClone(event)));
  const save = (name: string) => { if (root) { mkdirSync(root, { recursive: true }); writeFileSync(resolve(root, `${scope}-${name}.save.json`), sim.exportSave()); writeFileSync(resolve(root, `${scope}-events.json`), JSON.stringify(events, null, 2)); } };
  return { events, save };
}
function incident(sim: Simulation): Crime {
  const site = sim.worldDefinition.buildings.find(site => site.kind === 'police')!;
  const crime: Crime = { id: `crime-${++runtime(sim).crimeId}`, districtId: site.districtId, position: { ...site.door }, severity: 1, status: 'open', responseAt: 0 };
  sim.state.crimes.push(crime); sim.state.districts[0].crimeCount++; return crime;
}
// Only a controlled expiry boundary; it creates NO signed minutes or wages.
// Positive minutes below are created exclusively by native two-official review.
function expiredStanding(sim: Simulation): void {
  assert.equal(runtime(sim).publicLabor, undefined);
  runtime(sim).publicLabor = { version: 1, standingUntilDay: 0, nextReviewAt: 480,
    jobs: Object.fromEntries(sim.state.citizens.filter(person => person.role !== '学生' && !sim.state.shops.some(shop => shop.buildingId === person.workId)).map(person => [person.id, person.workId])),
    shifts: [], stats: { approvedMinutes: 0, unfundedMinutes: 0, workedMinutes: 0, privateMoves: 0 } };
}
function reviewers(sim: Simulation, role: string): Citizen[] {
  const actors = sim.state.citizens.filter(person => person.role === role && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  assert.equal(actors.length, 2, 'two genuinely qualified constructor actors');
  for (const actor of actors) {
    const site = sim.worldDefinition.buildings.find(site => site.id === actor.workId)!;
    actor.position = { ...site.door }; actor.destinationId = site.id; actor.route = []; actor.routeIndex = 0;
    runtime(sim).activities[actor.id] = 'work'; runtime(sim).decisionAt[actor.id] = 10000;
    assert.equal(call(sim, 'isNearBuilding', site, actor.position, 2), true);
  } // One initial position and intent fixture; never pinned again.
  return actors;
}
function exact24(sim: Simulation, label: string): void {
  const saved = sim.exportSave(), parts = partitionSave(saved, sim.worldDefinition);
  assert.equal(assembleSave(parts), saved, 'real partition/assembly is byte exact');
  const restored = new Simulation(sim.worldDefinition), result = restored.importSave(saved);
  assert.equal(result.ok, true, result.message); assert.equal(restored.exportSave(), saved, 'immediate full save exact');
  for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave(), `${label} tick ${i + 1}`); }
}

test('police never procures or responds without an actual standing or signed public work allowance', t => {
  const sim = new Simulation(world()), crime = incident(sim), o = observe(sim, 'no-wages'); expiredStanding(sim);
  const police = sim.state.citizens.filter(person => person.role === '警察'); assert.ok(police.length > 0); assert.ok(police.every(person => call(sim, 'publicWorkAllowance', person) === 0));
  const before = sim.exportSave(), money = cash(sim), inventory = sim.state.shops.map(shop => shop.inventory); o.save('before'); t.after(() => o.save('after'));
  call(sim, 'security');
  assert.equal(crime.status, 'open'); assert.deepEqual(runtime(sim).dispatches, {}); assert.deepEqual(sim.state.shops.map(shop => shop.inventory), inventory);
  assert.equal(cash(sim), money); assert.equal(sim.exportSave(), before, 'reject has no ledger, cash, materials or contract mutation');
  exact24(sim, 'no-wages');
});
test('food-only inventory cannot authorize an industrial police dispatch or a zero-paid response', t => {
  const sim = new Simulation(world(true)), crime = incident(sim), o = observe(sim, 'food-only'), before = sim.exportSave(); o.save('before'); t.after(() => o.save('after'));
  assert.ok(sim.state.shops.every(shop => sim.shopCommodity(shop) === 'food')); assert.ok(sim.state.shops.reduce((sum, shop) => sum + shop.inventory, 0) >= 3);
  call(sim, 'security'); assert.equal(crime.status, 'open'); assert.equal(sim.exportSave(), before); assert.equal(runtime(sim).policeSuppliesVersion, undefined);
});
test('two original officials sign actual wages before ordinary officer travel, one funded kit and resolution', t => {
  const sim = new Simulation(world()), crime = incident(sim), o = observe(sim, 'signed'), initialCash = cash(sim); expiredStanding(sim); reviewers(sim, '官员');
  call(sim, 'reviewPublicShifts');
  const plans = runtime(sim).publicLabor.shifts; assert.equal(plans.length, 2); assert.ok(plans[0].assignments.some((a: any) => a.workId === 'site-2' && a.minutesCap > 0));
  const supplier = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'materials')!, sourceUnits = supplier.inventory, sourceCash = sim.shopFunds(supplier), before = sim.state.treasury;
  o.save('before'); t.after(() => o.save('after')); call(sim, 'security'); assert.equal(crime.status, 'responding');
  const dispatched = Object.entries(runtime(sim).dispatches)[0]; assert.ok(dispatched); const officer = sim.state.citizens.find(person => person.id === dispatched[0])!, origin = { ...officer.position }, oldContract = structuredClone(plans);
  assert.ok(call(sim, 'publicWorkAllowance', officer) > 0); assert.equal(supplier.inventory, sourceUnits - 3); assert.ok(Math.abs(sim.shopFunds(supplier) - sourceCash - 11.04) < 1e-7); assert.equal(sim.state.treasury, before - 12);
  assert.equal(runtime(sim).policeSupplies.kits[crime.id].receivedUnits, 3); assert.equal(runtime(sim).policeSupplies.kits[crime.id].consumedUnits, 0); assert.ok(Math.abs(cash(sim) - initialCash) < 1e-7); o.save('responding');
  exact24(sim, 'responding');
  for (let i = 0; i < 200 && String(crime.status) !== 'resolved'; i++) sim.step(.25);
  assert.equal(crime.status, 'resolved'); assert.notDeepEqual(officer.position, origin, 'ordinary graph traversal reaches the incident');
  assert.ok(o.events.some((e: any) => e.type === 'officer-arrived' && e.crimeId === crime.id));
  const laborEvents = o.events.filter((e: any) => e.type === 'wage-earned' && e.citizenId === officer.id) as { amount: number; minutes: number }[];
  assert.ok(laborEvents.length > 0 && laborEvents.every(e => e.amount > 0 && e.minutes > 0));
  assert.equal(runtime(sim).policeSupplies.kits[crime.id].consumedUnits, 3); assert.equal(runtime(sim).policeSupplies.totals.gross, 12); assert.ok(!Object.values(runtime(sim).dispatches).some((d: any) => d.crimeId === crime.id));
  assert.equal(plans[1].cap, oldContract[1].cap, 'future signed wages are unchanged'); assert.ok(Math.abs(cash(sim) - initialCash) < 1e-6); o.save('resolved'); exact24(sim, 'resolved');
});
test('a partial real purchase stays public stock, pays its supplier, and never registers responding', t => {
  const sim = new Simulation(world()), supplier = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'materials')!;
  const initialCash = cash(sim); assert.equal(sim.purchasePublicSupplies(356, 'district', 'public-procurement'), 356); assert.equal(supplier.inventory, 1);
  const crime = incident(sim), o = observe(sim, 'partial'), funds = sim.shopFunds(supplier), treasury = sim.state.treasury; o.save('before'); t.after(() => o.save('after'));
  call(sim, 'security'); assert.equal(crime.status, 'open'); assert.equal(supplier.inventory, 0);
  const kit = runtime(sim).policeSupplies.kits[crime.id]; assert.equal(kit.receivedUnits, 1); assert.equal(kit.consumedUnits, 0); assert.equal(kit.gross, 4);
  assert.ok(Math.abs(sim.shopFunds(supplier) - funds - 3.68) < 1e-7); assert.equal(sim.state.treasury, treasury - 4); assert.ok(Math.abs(cash(sim) - initialCash) < 1e-7);
  const after = sim.exportSave(); call(sim, 'security'); assert.equal(sim.exportSave(), after, 'no material means no repeated expense'); exact24(sim, 'partial');
});
test('expiry withdraws an officer but preserves the paid kit; real review permits reassigning without another purchase', t => {
  const sim = new Simulation(world()), crime = incident(sim), o = observe(sim, 'retained'), initialCash = cash(sim); o.save('before'); t.after(() => o.save('after'));
  call(sim, 'security'); assert.equal(crime.status, 'responding'); assert.equal(runtime(sim).policeSupplies.totals.gross, 12);
  expiredStanding(sim); sim.step(.25); assert.equal(crime.status, 'open'); assert.deepEqual(runtime(sim).dispatches, {}); assert.ok(o.events.some((e: any) => e.type === 'police-response-withdrawn' && e.crimeId === crime.id && e.quantity === 3 && e.purpose === 'work-allowance'));
  assert.equal(runtime(sim).policeSupplies.kits[crime.id].receivedUnits, 3); assert.equal(runtime(sim).policeSupplies.kits[crime.id].consumedUnits, 0); o.save('withdrawn'); exact24(sim, 'retained');
  reviewers(sim, '官员'); runtime(sim).publicLabor.nextReviewAt = sim.state.extension!.lastUpdate; runtime(sim).publicLaborReviewAt = sim.state.extension!.lastUpdate; call(sim, 'reviewPublicShifts');
  assert.ok(runtime(sim).publicLabor.shifts.length > 0); call(sim, 'security'); assert.equal(crime.status, 'responding'); assert.equal(runtime(sim).policeSupplies.totals.gross, 12);
  assert.equal(o.events.filter((e: any) => e.type === 'security-procurement').length, 1); assert.ok(Math.abs(cash(sim) - initialCash) < 1e-6); exact24(sim, 'reassigned');
});
test('real two-councillor authorization protects its cash from police procurement and leaves existing wage claims intact', t => {
  const sim = new Simulation(world()), approvers = reviewers(sim, '议员'); sim.step(.25);
  assert.ok(approvers.every(actor => sim.isOnDuty(actor.id, actor.workId)), 'actual core people attendance, not fabricated paid windows');
  const snapshot = sim.publicBudgetSnapshot(), amount = snapshot.available - 8;
  assert.ok(amount > 40); assert.equal(sim.authorizePublicBudget({ id: 'police-guard-budget', siteId: approvers[0].workId, purpose: 'reserved-test', cap: amount, approvedAt: sim.state.extension!.lastUpdate, approvedBy: approvers.map(actor => actor.id) }), true);
  const crime = incident(sim), o = observe(sim, 'budget'), treasury = sim.state.treasury, wages = JSON.stringify(runtime(sim).wageAccruals); o.save('before'); t.after(() => o.save('after'));
  call(sim, 'security'); assert.equal(crime.status, 'open'); assert.ok(Math.abs(sim.state.treasury - treasury + 8) < 1e-7); assert.equal(JSON.stringify(runtime(sim).wageAccruals), wages);
  assert.equal(runtime(sim).publicBudgets[0].spent, 0); assert.equal(sim.publicBudgetSnapshot().authorizedRemaining, amount); assert.equal(runtime(sim).policeSupplies.kits[crime.id].receivedUnits, 2); exact24(sim, 'protected-budget');
});
test('new public material body, source receipts and dispatch refs are strictly validated before atomic load', () => {
  const sim = new Simulation(world()), crime = incident(sim); call(sim, 'security'); const saved = sim.exportSave();
  const mutations = [
    (d: any) => { delete d.runtime.policeSupplies; }, (d: any) => { delete d.runtime.policeSuppliesVersion; },
    (d: any) => { delete d.runtime.policeSupplies.kits[crime.id]; },
    (d: any) => { d.runtime.policeSupplies.kits[crime.id].receipts[0].shopId = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'food')!.id; },
    (d: any) => { d.runtime.policeSupplies.kits[crime.id].receipts[0].quantity += 1; },
    (d: any) => { d.runtime.policeSupplies.kits[crime.id].receipts[0].paidAt += 1; },
    (d: any) => { d.runtime.policeSupplies.kits[crime.id].consumedAt = sim.state.extension!.lastUpdate; d.runtime.policeSupplies.kits[crime.id].consumedUnits = 3; },
  ];
  for (const mutate of mutations) { const bad = JSON.parse(saved); mutate(bad); const result = sim.importSave(JSON.stringify(bad)); assert.equal(result.ok, false, result.message); assert.equal(sim.exportSave(), saved, 'bad load is byte-atomic'); }
});
test('player resolution consumes existing incident stock once and clears NPC refs without changing original reward', () => {
  const sim = new Simulation(world()), crime = incident(sim); call(sim, 'security');
  sim.state.player.role = 'police'; sim.state.player.identities = ['traveler', 'police']; // One explicit player authority fixture, no NPC qualifications changed.
  sim.setFocus(crime.position, 'walk'); const money = sim.state.player.money, before = cash(sim);
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, true); assert.equal(sim.state.player.money, money + 18 * .92);
  assert.equal(runtime(sim).policeSupplies.kits[crime.id].consumedUnits, 3); assert.deepEqual(runtime(sim).dispatches, {}); assert.ok(Math.abs(cash(sim) - before) < 1e-7);
  const done = sim.exportSave(); assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, false); assert.equal(sim.exportSave(), done); exact24(sim, 'player');
});
test('untouched old saves retain absent police metadata and byte-exact continuation without historical backfill', () => {
  const sim = new Simulation(world()), saved = sim.exportSave(), restored = new Simulation(sim.worldDefinition);
  assert.equal(runtime(sim).policeSupplies, undefined); assert.equal(restored.importSave(saved).ok, true); assert.equal(restored.exportSave(), saved);
  for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave()); }
  assert.equal(runtime(restored).policeSupplies, undefined);
});


// Original trade cost boundary: native onsite employer review, one real funded
// 480-minute attendance accounting window, native production and paid utilities
// at explicitly controlled 56% energy. This is NOT a natural 480-minute run.
// The main signed patrol test above uses ordinary actual walking/ticks.
function pricedSetup(): Simulation {
  const map = world(), home = map.buildings[0];
  for (let i = 0; i < 40; i++) {
    const position = { x: 220 + i % 10 * 24, y: 20, z: 30 + Math.floor(i / 10) * 24 };
    const site = { ...map.buildings[1], id: `quote-hall-${i}`, position, door: { ...position, z: position.z + 5 }, seed: 100 + i };
    map.buildings.push(site);
    const node = { id: site.id + '-door', districtId: 'district', name: site.id, position: { ...site.door }, station: false };
    map.nodes.push(node); map.edges.push({ id: 'quote-road-' + i, from: home.id + '-door', to: node.id, mode: 'road', capacity: 20, length: Math.hypot(node.position.x - home.door.x, node.position.z - home.door.z), points: [home.door, node.position] });
  }
  const sim = new Simulation(map), supplier = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'materials')!, site = map.buildings.find(site => site.id === supplier.buildingId)!;
  const beforeCash = cash(sim); sim.setFocus(site.door, 'walk');
  for (const quantity of [30, 20]) { const purchase = sim.command({ type: 'purchase', targetId: supplier.id, value: quantity }); assert.equal(purchase.ok, true, purchase.message); }
  const owner = sim.state.citizens.find(person => person.id === supplier.ownerId)!;
  owner.position = { ...site.door }; // one initial existing proprietor placement
  call(sim, 'reviewPrivateShifts');
  const plan = runtime(sim).privateLabor.shifts[supplier.id], assignment = plan.assignments.find((a: any) => a.citizenId === owner.id);
  assert.equal(assignment.minutesCap, 480, 'real player purchase and original owner capital fund this shift; no cash grant or roster shrink');
  assert.equal(sim.state.extension!.technologies.find(t => t.sector === 'manufacturing')!.level, 0);
  sim.state.districts[0].energy = 56; // explicit cost-model supply boundary only
  runtime(sim).commerceAt = 10; call(sim, 'registerAttendance', owner, 480); call(sim, 'commerce');
  const quote = sim.quoteSupply(supplier.id, 3); assert.equal(quote.unitPrice, 6.17); assert.equal(quote.earnedLaborCost, 44.16); assert.ok(Math.abs(quote.costWindowUnits - 8.96) < 1e-8);
  assert.ok(Math.abs(cash(sim) - beforeCash) < 1e-7); return sim;
}
test('real 6.17 industrial quote buys three finite units, credits exact net and tax without a stale 12-coin cap', t => {
  const sim = pricedSetup(), crime = incident(sim), o = observe(sim, 'dynamic-funded'), supplier = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'materials')!;
  const inventory = supplier.inventory, funds = sim.shopFunds(supplier), tax = runtime(sim).taxes, treasury = sim.state.treasury, total = cash(sim); o.save('before'); t.after(() => o.save('after'));
  call(sim, 'security'); assert.equal(crime.status, 'responding');
  const kit = runtime(sim).policeSupplies.kits[crime.id]; assert.ok(Math.abs(kit.receivedUnits - 3) < 1e-8); assert.ok(Math.abs(kit.gross - 18.51) < 1e-8);
  assert.equal(kit.receipts[0].unitPrice, 6.17); assert.ok(Math.abs(inventory - supplier.inventory - 3) < 1e-8); assert.ok(Math.abs(sim.shopFunds(supplier) - funds - 18.51 * .92) < 1e-8);
  assert.ok(Math.abs(runtime(sim).taxes - tax - 18.51 * .08) < 1e-8); assert.ok(Math.abs(sim.state.treasury - treasury + 18.51) < 1e-8); assert.ok(Math.abs(cash(sim) - total) < 1e-7); exact24(sim, 'dynamic-funded');
});
test('6.17 quote with eight spendable coins waits and reuses its partial goods after legal budget release', t => {
  const sim = pricedSetup(), officials = reviewers(sim, '议员'); sim.step(.25); assert.ok(officials.every(actor => sim.isOnDuty(actor.id, actor.workId)));
  const cap = sim.publicBudgetSnapshot().available - 8, total = cash(sim);
  assert.equal(sim.authorizePublicBudget({ id: 'dynamic-held-budget', siteId: officials[0].workId, purpose: 'reserved-test', cap, approvedAt: sim.state.extension!.lastUpdate, approvedBy: officials.map(actor => actor.id) }), true);
  const crime = incident(sim), o = observe(sim, 'dynamic-partial'); o.save('before'); t.after(() => o.save('after')); call(sim, 'security');
  assert.equal(crime.status, 'open'); const kit = runtime(sim).policeSupplies.kits[crime.id]; assert.ok(Math.abs(kit.gross - 8) < 1e-7); assert.ok(Math.abs(kit.receivedUnits - 8 / 6.17) < 1e-7); assert.equal(kit.consumedUnits, 0);
  const before = sim.exportSave(); call(sim, 'security'); assert.equal(sim.exportSave(), before, 'ten-minute retry cannot spend twice in the same observation');
  assert.equal(sim.closePublicBudget('dynamic-held-budget'), true); // native legal release of unused authorisation, no cash mutation
  for (let i = 0; i < 80 && String(crime.status) !== 'responding'; i++) sim.step(.25);
  assert.equal(crime.status, 'responding'); assert.equal(kit.receivedUnits, 3); assert.equal(kit.receipts.length, 2);
  assert.ok(Math.abs(kit.receipts[0].quantity + kit.receipts[1].quantity - 3) < 1e-8); assert.ok(Math.abs(kit.receipts[1].quantity - (3 - 8 / 6.17)) < 1e-7, 'only missing units were purchased');
  assert.ok(Math.abs(cash(sim) - total) < 1e-6); exact24(sim, 'dynamic-partial');
});
test('saved arrival at a distant position cannot consume paid public material or resolve the incident', () => {
  const sim = new Simulation(world()), crime = incident(sim); call(sim, 'security');
  const officerId = Object.keys(runtime(sim).dispatches)[0]; assert.ok(officerId); assert.ok(Math.hypot(sim.state.citizens.find(c => c.id === officerId)!.position.x - crime.position.x) > 3);
  const saved = sim.exportSave(), bad = JSON.parse(saved); bad.runtime.dispatches[officerId].arrived = true;
  assert.equal(sim.importSave(JSON.stringify(bad)).ok, false); assert.equal(sim.exportSave(), saved);
  runtime(sim).dispatches[officerId].arrived = true; crime.responseAt = 0; call(sim, 'security');
  assert.equal(crime.status, 'responding'); assert.equal(runtime(sim).policeSupplies.kits[crime.id].consumedUnits, 0, 'runtime stale arrival does not prove presence');
});
test('resolved-kit receipt chronology and impossible zero-case history reject atomically', () => {
  const sim = new Simulation(world()), crime = incident(sim); call(sim, 'security');
  sim.state.player.role = 'police'; sim.state.player.identities = ['traveler', 'police']; sim.setFocus(crime.position, 'walk'); assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, true);
  sim.step(.25); const saved = sim.exportSave(), bad = JSON.parse(saved);
  bad.runtime.policeSupplies.kits[crime.id].receipts[0].paidAt = bad.runtime.policeSupplies.kits[crime.id].consumedAt + .1;
  assert.equal(sim.importSave(JSON.stringify(bad)).ok, false); assert.equal(sim.exportSave(), saved);
  const impossible = JSON.parse(saved), stock = impossible.runtime.policeSupplies;
  stock.archived.receivedUnits = stock.archived.consumedUnits = 100; stock.archived.gross = 400; stock.archived.tax = 32;
  stock.totals.receivedUnits += 100; stock.totals.consumedUnits += 100; stock.totals.gross += 400; stock.totals.tax += 32;
  assert.equal(sim.importSave(JSON.stringify(impossible)).ok, false); assert.equal(sim.exportSave(), saved);
});
test('genuine old response remains exact; new kit activation and actual appointment withdrawal can reassign without a legacy conflict', t => {
  const file = new URL('./fixtures/police-legacy-response-3ca77b8.json', import.meta.url); // untouched genuine baseline writer, SHA in delivery
  const saved = readFileSync(file, 'utf8'), sim = new Simulation(world()), result = sim.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), saved);
  assert.equal(runtime(sim).policeSupplies, undefined); assert.equal(runtime(sim).policeSuppliesVersion, undefined);
  const crime = sim.state.crimes[0], oldOfficerId = Object.keys(runtime(sim).dispatches)[0], oldOfficer = sim.state.citizens.find(c => c.id === oldOfficerId)!;
  assert.equal(crime.status, 'responding'); assert.ok((oldOfficer.education ?? 0) >= 2); assert.equal(call(sim, 'publicWorkAllowance', oldOfficer), 0);
  reviewers(sim, '官员'); call(sim, 'reviewPublicShifts'); const otherCrime = incident(sim), o = observe(sim, 'legacy-reassigned'); o.save('before'); t.after(() => o.save('after'));
  call(sim, 'security'); assert.equal(otherCrime.status, 'responding'); assert.ok(runtime(sim).policeSupplies.legacyResponses.includes(crime.id)); assert.equal(runtime(sim).policeSupplies.kits[crime.id], undefined);
  sim.state.player.role = 'mayor'; sim.state.player.identities = ['traveler', 'mayor']; // one initial player authority fixture
  sim.setFocus(sim.worldDefinition.buildings[1].door, 'walk'); const total = cash(sim), roleBefore = oldOfficer.role;
  const appointed = sim.command({ type: 'appoint', targetId: oldOfficerId, value: 1 }); assert.equal(appointed.ok, true, appointed.message); assert.notEqual(oldOfficer.role, roleBefore); assert.equal(call(sim, 'publicWorkAllowance', oldOfficer), 0);
  sim.step(.25); assert.equal(crime.status, 'responding'); assert.equal(runtime(sim).policeSupplies.kits[crime.id].receivedUnits, 3); assert.ok(!runtime(sim).policeSupplies.legacyResponses.includes(crime.id));
  assert.ok(Math.abs(cash(sim) - total) < 1e-6); o.save('new-actual-kit'); exact24(sim, 'legacy-reassigned');
});

test('controlled resolved-history boundary archives only actually paid and consumed material after native trimming', () => {
  const sim = new Simulation(world()), crime = incident(sim); call(sim, 'security');
  sim.state.player.role = 'police'; sim.state.player.identities = ['traveler', 'police']; sim.setFocus(crime.position, 'walk');
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, true);
  // Non-financial controlled history-size boundary, NOT 121 observed crimes.
  // Only the one case above has any procurement, payout or consumed stock.
  for (let i = 0; i < 121; i++) sim.state.crimes.push({ ...crime, id: 'crime-' + ++runtime(sim).crimeId });
  const before = cash(sim); call(sim, 'security'); assert.equal(sim.state.crimes.length, 60);
  const stock = runtime(sim).policeSupplies; assert.deepEqual(stock.kits, {}); assert.equal(stock.archived.cases, 1);
  assert.equal(stock.archived.receivedUnits, 3); assert.equal(stock.archived.consumedUnits, 3); assert.equal(stock.archived.gross, 12);
  assert.equal(stock.totals.receivedUnits, 3); assert.equal(stock.totals.consumedUnits, 3); assert.equal(cash(sim), before);
  exact24(sim, 'archive');
});
