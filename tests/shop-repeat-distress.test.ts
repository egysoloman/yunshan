import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCanonicalNpcWage, Simulation } from '../src/simulation';
import { createProductCity } from '../src/product-city';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { applyShopLifecycleCommand, shopLifecycleCanDispose, shopLifecycleHeldCash, shopLifecycleOpportunities } from '../src/simulation/shop_lifecycle';
import { returnConsignment } from '../src/simulation/trade';
import type { BuildingKind, Citizen, Shop, Vec3, WorldDefinition } from '../src/types';

// Controlled trusted compact map with actual local industrial/food suppliers.
// It deliberately does not claim to repair the default 109-market supply gap.
// Before the principal simulation is constructed, an unticked template save
// assigns finite original market-owned food to its original adult roster and
// retains one original industrial material in the existing player inventory.
// These are controlled initial distributions, not natural shopping or cargo.
// No position, identity, needs, route or attendance is edited in the journey.
// Later economic openings below never refill food or material mid-journey.
function world(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: site.districtId, name: site.id, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const, length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261003, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '原市场公司权利验证', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
const runtime = (sim: Simulation): any => Reflect.get(sim, 'runtime');
const clock = (sim: Simulation) => sim.state.extension!.lastUpdate;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-6, `${a} != ${b}`);
function record(name: string, value: string | object) {
  const dir = resolve('artifacts/shop-repeat-distress'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function moneySupply(sim: Simulation) {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money + s.citizens.reduce((n, c) => n + c.money, 0)
    + s.shops.filter(shop => !e.companies.some(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)).reduce((n, shop) => n + (shop.cash ?? 0), 0)
    + e.companies.reduce((n, c) => n + c.capital, 0) + e.organizations.reduce((n, o) => n + o.funds, 0)
    + s.banking!.cash + s.banking!.legacyInvestmentCash + shopLifecycleHeldCash(s)
    + s.family!.households.reduce((n, h) => n + h.balance, 0) + s.family!.pregnancies.reduce((n, p) => n + p.escrow, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.education?.course?.escrow ?? 0)
    + (s.clinical?.orders.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.hygiene?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + (s.power?.repairs.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.roadworks?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0);
}
function goodsSupply(sim: Simulation) {
  const s = sim.state;
  assert(!s.clinical?.orders.length && !s.education?.course && !s.familyEducation?.active.length && !s.power?.repairs.length && !s.roadworks?.jobs.length,
    'this compact transaction ledger has no other live clinical, education, power or roadwork material store');
  return {
    food: s.shops.filter(row => sim.shopCommodity(row) === 'food').reduce((n, row) => n + row.inventory, 0)
      + s.citizens.reduce((n, row) => n + (row.food ?? 0), 0) + (s.player.inventory.food ?? 0)
      + s.vehicles.reduce((n, row) => n + (row.cargo ?? 0), 0) + Object.values(runtime(sim).freight as Record<string, number>).reduce((n, value) => n + value, 0),
    materials: s.shops.filter(row => sim.shopCommodity(row) === 'materials').reduce((n, row) => n + row.inventory, 0)
      + (s.player.inventory.materials ?? 0) + Object.values(s.shopLifecycle?.titles ?? {}).reduce((n, row) => n + row.materialsHeld, 0),
    repaired: Object.values(s.shopLifecycle?.titles ?? {}).reduce((n, row) => n + [...row.reopenHistory, ...(row.reopen ? [row.reopen] : [])].reduce((sum, job) => sum + job.consumedUnits, 0), 0),
  };
}
function fixture(product = true) {
  const template = product ? createProductCity(world()) : new Simulation(world());
  const original = template.exportSave(), document = JSON.parse(original), initial = JSON.parse(original), cash = moneySupply(template);
  assert.equal(clock(template), 480); assert.equal(template.state.tick, 0);
  const market = document.state.shops.find((row: Shop) => row.buildingId === 'market')!;
  const material = document.state.shops.find((row: Shop) => row.buildingId === 'workshop')!;
  const recipients = document.state.citizens.filter((row: Citizen) => row.workId === market.buildingId
    && document.state.extension.actorProfiles[row.id].alive && document.state.extension.actorProfiles[row.id].age >= 18);
  assert(recipients.some((row: Citizen) => row.id === market.ownerId)); assert(market.inventory >= recipients.length); assert(material.inventory >= 1);
  const totals = (data: typeof document) => ({
    food: data.state.shops.filter((row: Shop) => row.buildingId !== 'workshop').reduce((n: number, row: Shop) => n + row.inventory, 0)
      + data.state.citizens.reduce((n: number, row: Citizen) => n + (row.food ?? 0), 0) + (data.state.player.inventory.food ?? 0),
    materials: data.state.shops.find((row: Shop) => row.buildingId === 'workshop').inventory + (data.state.player.inventory.materials ?? 0),
  });
  const beforeTotals = totals(document), allocations = recipients.map((row: Citizen) => ({ actorId: row.id, sourceShopId: market.id, quantity: 1, originalAssetOwnerId: market.ownerId }));
  for (const row of recipients) row.food = (row.food ?? 0) + 1;
  market.inventory -= recipients.length;
  let remaining = recipients.length;
  for (const lot of document.state.trade.ownedLots[market.id]) { const quantity = Math.min(remaining, lot.quantity); lot.quantity -= quantity; remaining -= quantity; }
  near(remaining, 0); document.state.trade.ownedLots[market.id] = document.state.trade.ownedLots[market.id].filter((row: { quantity: number }) => row.quantity > 0);
  if (!document.state.trade.ownedLots[market.id].length) delete document.state.trade.ownedLots[market.id];
  material.inventory -= 1; document.state.player.inventory.materials = (document.state.player.inventory.materials ?? 0) + 1;
  assert.deepEqual(totals(document), beforeTotals);
  const restored = structuredClone(document);
  for (const row of recipients) restored.state.citizens.find((person: Citizen) => person.id === row.id).food -= 1;
  restored.state.shops.find((row: Shop) => row.id === market.id).inventory += recipients.length;
  restored.state.shops.find((row: Shop) => row.id === material.id).inventory += 1;
  restored.state.trade.ownedLots = structuredClone(initial.state.trade.ownedLots);
  if (initial.state.player.inventory.materials === undefined) delete restored.state.player.inventory.materials;
  else restored.state.player.inventory.materials -= 1;
  assert.deepEqual(restored, initial, 'only original finite food/material distributions change; cash, needs, identities, titles, clocks and paths remain exact');
  const opening = JSON.stringify(document), prefix = product ? 'controlled-product' : 'controlled-legacy-v2';
  record(`${prefix}-initial-unallocated.save.json`, original); record(`${prefix}-initial-allocated.save.json`, opening);
  record(`${prefix}-initial-allocation-diff.json`, { controlled: true, beforePrincipalConstructor: true, templateUnticked: true, clock: 480, tick: 0,
    description: 'finite original market-owned food assigned to its original adult owner/employees; one finite original workshop material retained in the existing player inventory; neither is natural shopping or freight; no mid-journey refill',
    allocations, materialAllocation: { sourceShopId: material.id, originalAssetOwnerId: material.ownerId, destination: 'player.inventory.materials', quantity: 1 },
    beforeTotals, afterTotals: totals(document), cash });
  const sim = product ? createProductCity(world()) : new Simulation(world()), loaded = sim.importSave(opening);
  assert(loaded.ok, loaded.message); assert.equal(sim.exportSave(), opening); near(moneySupply(sim), cash);
  const shop = sim.state.shops.find(row => row.buildingId === 'market')!;
  const owner = sim.state.citizens.find(row => row.id === shop.ownerId)!;
  assert.equal(owner.role, '商人'); assert.equal(owner.workId, shop.buildingId);
  return { sim, shop, owner };
}
function economicOpening(sim: Simulation, shop: Shop, owner: Citizen, name: string) {
  const before = sim.exportSave(), cash = moneySupply(sim), profiles = structuredClone(sim.state.extension!.actorProfiles);
  const citizens = structuredClone(sim.state.citizens), claims = structuredClone(runtime(sim).wageAccruals);
  const payroll = structuredClone(runtime(sim).privateLabor), lifecycle = structuredClone(sim.state.shopLifecycle);
  const protectedFunds = sim.shopProtectedFunds(shop), farm = sim.state.shops.find(row => row.buildingId === 'farm')!;
  const food = sim.state.shops.filter(row => sim.shopCommodity(row) === 'food').reduce((n, row) => n + row.inventory, 0);
  // Any unsold custody is returned through the original bounded API to its
  // named supplier. Its receipt statistics survive; no supplier claim is cut.
  const custody = structuredClone(sim.state.trade!.lots[shop.id] ?? []), returnedCustody = returnConsignment(sim, shop.id);
  near(returnedCustody, custody.reduce((n, row) => n + row.quantity, 0));
  const owned = sim.state.trade!.ownedLots![shop.id] ?? [];
  near(owned.reduce((n, row) => n + row.quantity, 0), shop.inventory);
  const transferredFood = shop.inventory; farm.inventory += transferredFood; shop.inventory = 0; delete sim.state.trade!.ownedLots![shop.id];
  const distribution = Math.max(0, sim.shopFunds(shop) - protectedFunds);
  owner.money += distribution; sim.transferShopFunds(shop, -distribution);
  shop.profit = Math.min(shop.profit, -600); // Explicit historical-loss parameter, not simulated causal proof.
  near(moneySupply(sim), cash); near(sim.shopProtectedFunds(shop), protectedFunds);
  near(sim.state.shops.filter(row => sim.shopCommodity(row) === 'food').reduce((n, row) => n + row.inventory, 0), food);
  assert.deepEqual(sim.state.extension!.actorProfiles, profiles); assert.deepEqual(runtime(sim).wageAccruals, claims);
  assert.deepEqual(runtime(sim).privateLabor, payroll); assert.deepEqual(sim.state.shopLifecycle, lifecycle);
  const expectedCitizens = structuredClone(citizens); expectedCitizens.find(row => row.id === owner.id)!.money += distribution;
  assert.deepEqual(sim.state.citizens, expectedCitizens, 'opening changes no position, need, identity, route or job');
  assert(shop.profit <= -600 && shop.inventory < 1e-7 && sim.shopFunds(shop) - protectedFunds < 20 * 8 / 24);
  record(`${name}-opening-before.save.json`, before); record(`${name}-opening-after.save.json`, sim.exportSave());
  record(`${name}-opening.json`, { controlled: true, description: 'original API returns all unsold custody to named suppliers; owned food moved to existing farm; free operating cash distributed to current owner; explicit historical-loss parameter', custodyReturned: custody, returnedCustody, transferredFood, distribution, protectedFunds, cashBefore: cash, cashAfter: moneySupply(sim), foodBefore: food, foodAfter: sim.state.shops.filter(row => sim.shopCommodity(row) === 'food').reduce((n, row) => n + row.inventory, 0) });
}
function observe(sim: Simulation, shop: Shop, owner: Citizen) {
  const routes: object[] = [], events: object[] = [], wages: object[] = [], marketRoutes: any[] = [], marketArrivals: any[] = [], contracts: any[] = [];
  const seen = new Set<string>(), supplyEvents: object[] = [], flow = { foodProduced: 0, foodConsumed: 0, materialProduced: 0, publicMaterialConsumed: 0 };
  const context = () => ({ at: clock(sim), treasury: sim.state.treasury, pendingTaxes: runtime(sim).taxes,
    wallets: Object.fromEntries(sim.state.citizens.map(row => [row.id, row.money])), funds: sim.shopFunds(shop), heldCash: shopLifecycleHeldCash(sim.state),
    shops: structuredClone(sim.state.shops), claims: structuredClone([...(runtime(sim).wageArrears ?? []), ...(runtime(sim).wageAccruals ?? []), ...runtime(sim).wages]),
    title: structuredClone(sim.state.shopLifecycle?.titles[shop.id]), leases: structuredClone(sim.state.shopLifecycle?.leases ?? []), receipts: structuredClone(sim.state.shopLifecycle?.receipts ?? []) });
  let previous = context();
  sim.onEvent('shop-lifecycle-arrived', event => {
    if (event.shopId === shop.id) {
      const actor = sim.state.citizens.find(row => row.id === event.citizenId)!, title = sim.state.shopLifecycle?.titles[shop.id];
      const key = `${actor.id}:${title?.state}:${title?.assetOwnerId}:${title?.leaseId}:${title?.reopen?.startedAt}:${title?.listingId}`;
      if (!seen.has(key)) { seen.add(key); marketArrivals.push({ ...event, at: clock(sim), position: { ...actor.position }, destinationId: actor.destinationId,
        route: structuredClone(actor.route), routeIndex: actor.routeIndex, activity: runtime(sim).activities[actor.id], title: structuredClone(title), leases: structuredClone(sim.state.shopLifecycle?.leases),
        listing: structuredClone(sim.state.shopLifecycle?.listings.find(row => row.id === title?.listingId)), after: context(), before: previous }); }
    }
    if (event.shopId === shop.id && event.citizenId === owner.id) {
      const title = sim.state.shopLifecycle?.titles[shop.id];
      events.push({ ...event, at: clock(sim), position: { ...owner.position }, destinationId: owner.destinationId, route: structuredClone(owner.route), routeIndex: owner.routeIndex, activity: runtime(sim).activities[owner.id], title: structuredClone(title), listing: structuredClone(sim.state.shopLifecycle?.listings.find(row => row.id === title?.listingId)) });
    }
  });
  sim.onEvent('wage-earned', event => {
    if (event.shopId === shop.id && event.amount! > 0) { assert(isCanonicalNpcWage(event)); wages.push({ ...event, at: clock(sim) }); }
  });
  sim.onEvent('shop-contract-accepted', event => { if (event.shopId === shop.id) contracts.push({ ...event, at: clock(sim), before: previous, after: context() }); });
  for (const type of ['production', 'stored-meal', 'sale', 'food-consumed', 'public-procurement', 'security-procurement', 'civic-procurement'] as const) sim.onEvent(type, event => {
    const source = sim.state.shops.find(row => row.id === event.shopId);
    if (type === 'production') { if (source && sim.shopCommodity(source) === 'food') flow.foodProduced += event.amount!; else flow.materialProduced += event.amount!; }
    else if (type === 'stored-meal' || type === 'food-consumed') flow.foodConsumed += event.amount!;
    else if (type === 'sale') { if (source && sim.shopCommodity(source) === 'food') flow.foodConsumed++; }
    else { assert(source && sim.shopCommodity(source) === 'materials'); flow.publicMaterialConsumed += event.quantity!; }
    supplyEvents.push({ ...event, at: clock(sim) });
  });
  function step() {
    previous = context();
    const prior = { ...owner.position }, initialTitle = structuredClone(sim.state.shopLifecycle?.titles[shop.id]);
    sim.step(.25);
    assert.deepEqual(sim.state.lastSystemOrder, ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback']);
    assert(distance(prior, owner.position) <= 1.05 + 1e-7, 'one active dry quarter-tick retains the original 3D metre budget');
    if (owner.destinationId === shop.buildingId && runtime(sim).activities[owner.id] === 'shopLifecycle' && owner.route!.length > 1) routes.push({ at: clock(sim), before: prior, position: { ...owner.position }, route: structuredClone(owner.route), routeIndex: owner.routeIndex });
    for (const actor of sim.state.citizens) if (actor.destinationId === shop.buildingId && runtime(sim).activities[actor.id] === 'shopLifecycle' && actor.route!.length > 1)
      marketRoutes.push({ at: clock(sim), actorId: actor.id, position: { ...actor.position }, route: structuredClone(actor.route), routeIndex: actor.routeIndex });
    if (!events.length && initialTitle) assert.deepEqual(sim.state.shopLifecycle?.titles[shop.id], initialTitle, 'no repeated authority change before actual arrival');
  }
  return { routes, events, wages, marketRoutes, marketArrivals, contracts, flow, supplyEvents, step };
}
function until(sim: Simulation, predicate: () => boolean, bound: number, step = () => sim.step(.25)) {
  for (let i = 0; i < bound && !predicate(); i++) step();
  if (!predicate()) {
    record(`bounded-failure-${sim.state.tick}-${clock(sim)}.save.json`, sim.exportSave());
    record(`bounded-failure-${sim.state.tick}-${clock(sim)}.json`, { clock: clock(sim), tick: sim.state.tick, bound,
      shops: sim.state.shops.map(row => ({ ...row, funds: sim.shopFunds(row), protectedFunds: sim.shopProtectedFunds(row) })),
      owner: sim.state.citizens.find(row => row.id === sim.state.shops.find(shop => shop.buildingId === 'market')!.ownerId) });
  }
  assert(predicate(), `ordinary bounded journey did not reach its declared state; tick=${sim.state.tick},clock=${clock(sim)}`);
}
const firstRepairSaves = new Map<boolean, string>();
function actualFirstRepair(product = true) {
  const cached = firstRepairSaves.get(product); if (cached) return cached;
  const { sim, shop, owner } = fixture(product), start = { ...owner.position }, cash = moneySupply(sim), prefix = product ? 'first' : 'first-legacy-v2';
  economicOpening(sim, shop, owner, prefix); const trace = observe(sim, shop, owner);
  until(sim, () => sim.state.shopLifecycle?.titles[shop.id]?.state === 'reopening', 800, trace.step);
  const title = sim.state.shopLifecycle!.titles[shop.id];
  assert(trace.events.length > 0 && trace.routes.length > 0, 'first owner advertises and actually walks the ordinary route');
  assert.notDeepEqual(owner.position, start); assert.equal(title.assetOwnerId, owner.id); assert.equal(title.reopen!.workedMinutes, 0);
  assert.equal(title.materialsHeld, 1); assert.equal(title.reopen!.consumedUnits, 0); assert(owner.money >= 100);
  near(moneySupply(sim), cash);
  // One explicitly controlled, actor-authorized extra contribution funds real
  // wage review. The natural limited restart is not claimed to buy labor too.
  const funded = applyShopLifecycleCommand(sim, { type: 'fundShop', targetId: shop.id, value: 20 }, owner.id)!;
  assert(funded.ok, funded.message); near(moneySupply(sim), cash);
  until(sim, () => title.state === 'operating', 800, trace.step);
  assert.equal(title.reopen!.workedMinutes, 60); assert.equal(title.reopen!.consumedUnits, 1); assert.equal(title.materialsHeld, 0);
  assert(title.reopen!.labor.length > 0 && title.reopen!.labor.every(row => row.earned > 0)); assert(trace.wages.length > 0);
  assert.equal(title.reopenHistory.length, 0); assert.equal(title.suspendedAt, null); near(moneySupply(sim), cash);
  record(`${prefix}-natural-route-and-paid-repair.json`, { controlledAdditionalFund: 20, startingPosition: start, ownerId: owner.id, routes: trace.routes, arrivedEvents: trace.events, actualWages: trace.wages, reopen: title.reopen, privateLabor: runtime(sim).privateLabor, cash });
  const saved = sim.exportSave(); firstRepairSaves.set(product, saved); record(`${prefix}-real-operating.save.json`, saved);
  const loaded = new Simulation(world()), result = loaded.importSave(saved); assert(result.ok, result.message); assert.equal(loaded.exportSave(), saved);
  return saved;
}
function repaired() {
  const sim = createProductCity(world()), result = sim.importSave(actualFirstRepair()); assert(result.ok, result.message);
  const shop = sim.state.shops.find(row => row.buildingId === 'market')!, owner = sim.state.citizens.find(row => row.id === shop.ownerId)!;
  return { sim, shop, owner, title: sim.state.shopLifecycle!.titles[shop.id] };
}
let morningSave: string | undefined;
function morningRepaired() {
  if (!morningSave) {
    const { sim, owner, title } = repaired(), firstJob = structuredClone(title.reopen), home = sim.worldDefinition.buildings.find(row => row.id === owner.homeId)!;
    // Natural evening/night and morning, without any setTime or actor writes.
    until(sim, () => clock(sim) >= 1440 + 7 * 60 && owner.destinationId === home.id
      && ['atHome', 'sleeping'].includes(owner.state) && sim.isNearBuilding(home, owner.position, 1), 7000);
    assert.equal(title.state, 'operating'); assert.deepEqual(title.reopen, firstJob); assert.deepEqual(title.reopenHistory, []);
    morningSave = sim.exportSave(); record('natural-next-morning-home.save.json', morningSave);
  }
  const sim = createProductCity(world()), result = sim.importSave(morningSave); assert(result.ok, result.message);
  const shop = sim.state.shops.find(row => row.buildingId === 'market')!, owner = sim.state.citizens.find(row => row.id === shop.ownerId)!;
  return { sim, shop, owner, title: sim.state.shopLifecycle!.titles[shop.id] };
}

test('first distress uses ordinary owner choice, a real work-point arrival, one controlled wage contribution and sixty real employee minutes', () => {
  const { sim, shop, title } = repaired();
  assert.equal(title.state, 'operating'); assert.equal(sim.effectiveRuleset, 'civic-local-v1');
  assert.equal(title.reopen!.workedMinutes, 60); assert(sim.shopPayrollDebt(shop) > 0);
});

test('second economic distress advertises only in the explicit new ruleset and remains read-only until arrival', () => {
  const { sim, shop, owner, title } = repaired(); economicOpening(sim, shop, owner, 'second-predicate');
  const before = sim.exportSave(), old = structuredClone(title);
  assert(shopLifecycleOpportunities(sim, owner).some(row => row.destination.id === shop.buildingId), 'an already registered operating title must not suppress the second legitimate owner intention');
  assert.equal(sim.exportSave(), before); assert.deepEqual(title, old);
  assert.equal(shopLifecycleCanDispose(sim.state, shop.id), true);
  for (const condition of ['profit', 'inventory', 'cash'] as const) {
    const copy = createProductCity(world()); assert(copy.importSave(before).ok);
    const target = copy.state.shops.find(row => row.id === shop.id)!, person = copy.state.citizens.find(row => row.id === owner.id)!;
    if (condition === 'profit') target.profit = -600 + 1e-6;
    if (condition === 'inventory') target.inventory = 1e-7;
    if (condition === 'cash') {
      const contribution = copy.shopProtectedFunds(target) + 20 * 8 / 24 + 1e-6 - copy.shopFunds(target);
      person.money -= contribution; copy.transferShopFunds(target, contribution);
      assert(copy.shopFunds(target) - copy.shopProtectedFunds(target) >= 20 * 8 / 24);
    }
    const snapshot = copy.exportSave(); assert(!shopLifecycleOpportunities(copy, person).some(row => row.destination.id === shop.buildingId), `${condition} is independently required`); assert.equal(copy.exportSave(), snapshot);
  }
});

test('repeated-owner advertising rejects the original desire boundaries, other authority and every unsettled site claim without edits', () => {
  const { sim, shop, owner } = repaired(); economicOpening(sim, shop, owner, 'guard'); const opening = sim.exportSave();
  // Single-field synthetic eligibility/claims probes are read-only boundaries,
  // not asserted to be loadable contracts or naturally created property.
  for (const issue of ['dead', 'minor', 'health', 'mood', 'stress', 'hunger', 'fatigue', 'night', 'other-asset-owner', 'other-operator', 'corporation', 'live-lease', 'rent-debt', 'deposit', 'advance'] as const) {
    const copy = createProductCity(world()); assert(copy.importSave(opening).ok);
    const target = copy.state.shops.find(row => row.id === shop.id)!, person = copy.state.citizens.find(row => row.id === owner.id)!, profile = copy.state.extension!.actorProfiles[person.id];
    const title = copy.state.shopLifecycle!.titles[target.id], other = copy.state.citizens.find(row => row.id !== person.id)!;
    if (issue === 'dead') profile.alive = false;
    if (issue === 'minor') profile.age = 17;
    if (issue === 'health') profile.health = 44.999;
    if (issue === 'mood') profile.mood = 54.999;
    if (issue === 'stress') profile.stress = 55.001;
    if (issue === 'hunger') person.needs.hunger = 49.999;
    if (issue === 'fatigue') person.needs.fatigue = 44.999;
    if (issue === 'night') copy.state.hour = 17;
    if (issue === 'other-asset-owner') title.assetOwnerId = other.id;
    if (issue === 'other-operator') target.ownerId = other.id;
    if (issue === 'corporation') title.corporation = { companyId: 'synthetic-corporation', founderId: person.id, registeredAt: clock(copy), leaseId: null, openingCash: 0, capitalFunding: 200, ownerCashReserved: 0, ownerCashEscrow: 0, ownerCashReturned: 0 };
    if (['live-lease', 'rent-debt', 'deposit', 'advance'].includes(issue)) {
      const document = JSON.parse(readFileSync(new URL('./fixtures/market-company-old-lease.json', import.meta.url), 'utf8'));
      const lease = structuredClone(document.state.shopLifecycle.leases[0]);
      lease.state = issue === 'live-lease' ? 'active' : 'ended'; lease.arrears = issue === 'rent-debt' ? 1 : 0;
      lease.depositEscrow = issue === 'deposit' ? 1 : 0; lease.advanceRefunded = issue === 'advance' ? lease.advanceInitial - 1 : lease.advanceInitial;
      copy.state.shopLifecycle!.leases.push(lease);
    }
    const before = copy.exportSave(); assert(!shopLifecycleOpportunities(copy, person).some(row => row.destination.id === target.buildingId), issue); assert.equal(copy.exportSave(), before);
  }
});

test('a forged repeated-distress arrival away from the work point or from a dead or minor current owner cannot suspend or list', () => {
  const { sim, shop } = repaired(); economicOpening(sim, shop, sim.state.citizens.find(row => row.id === shop.ownerId)!, 'arrival-guard'); const opening = sim.exportSave();
  for (const issue of ['wrong-position', 'dead', 'minor'] as const) {
    const copy = createProductCity(world()); assert(copy.importSave(opening).ok);
    const owner = copy.state.citizens.find(row => row.id === shop.ownerId)!;
    if (issue === 'wrong-position') owner.position = { x: -200, y: 20, z: 5 }; // Negative-only controlled pose.
    if (issue === 'dead') copy.state.extension!.actorProfiles[owner.id].alive = false;
    if (issue === 'minor') copy.state.extension!.actorProfiles[owner.id].age = 17;
    const before = copy.exportSave(); copy.emitEvent({ type: 'shop-lifecycle-arrived', citizenId: owner.id, shopId: shop.id }); assert.equal(copy.exportSave(), before, issue);
  }
});

test('second distress follows ordinary owner, buyer and tenant routes, settles finite sale and lease rights, and repairs the same shop with sixty real paid employee minutes', () => {
  const { sim, shop, owner, title } = morningRepaired(), firstJob = structuredClone(title.reopen), cash = moneySupply(sim), startingGoods = goodsSupply(sim);
  const originalWorkers = sim.state.citizens.filter(row => row.workId === shop.buildingId).map(row => ({ id: row.id, workId: row.workId, role: row.role }));
  const identity = { id: shop.id, buildingId: shop.buildingId, employees: shop.employees }, start = { ...owner.position };
  economicOpening(sim, shop, owner, 'second-journey'); assert.deepEqual(goodsSupply(sim), startingGoods);
  const trace = observe(sim, shop, owner), step = () => { trace.step(); near(moneySupply(sim), cash); };
  until(sim, () => title.state === 'reopening' && title.reopen!.startedAt > firstJob!.completedAt!, 1200, step);
  const firstArrival = trace.marketArrivals.find(row => row.citizenId === owner.id);
  assert(firstArrival && firstArrival.title.state === 'suspended' && firstArrival.title.reason === 'economic-distress');
  assert(firstArrival.listing && firstArrival.listing.sellerId === owner.id && firstArrival.listing.kind === 'sale' && firstArrival.listing.price === 100);
  assert.deepEqual(firstArrival.title.reopen, firstJob); assert.deepEqual(firstArrival.title.reopenHistory, []);
  assert(firstArrival.at >= 1440 + 7 * 60 && trace.routes.some((row: any) => row.routeIndex < row.route.length)); assert.notDeepEqual(firstArrival.position, start);
  assert.equal(trace.contracts.length, 2, 'a real sale and then a distinct real lease, without an ownership rewrite');
  const sale = trace.contracts.find(row => row.after.receipts.some((receipt: any) => receipt.at === row.at && receipt.kind === 'sale'))!;
  const rental = trace.contracts.find(row => row.after.receipts.some((receipt: any) => receipt.at === row.at && receipt.kind === 'lease-start'))!;
  assert(sale && rental && sale.at < rental.at); const assetBuyer = sale.citizenId as string, tenant = rental.citizenId as string;
  assert.notEqual(assetBuyer, owner.id); assert.notEqual(tenant, owner.id); assert.notEqual(tenant, assetBuyer);
  const saleReceipt = sale.after.receipts.find((row: any) => row.kind === 'sale' && row.at === sale.at)!;
  assert.equal(saleReceipt.actorId, assetBuyer); assert.equal(saleReceipt.payeeId, owner.id); assert.equal(saleReceipt.amount, 100);
  near(sale.before.wallets[assetBuyer] - sale.after.wallets[assetBuyer], 100 + 200 + 50);
  near(sale.after.wallets[owner.id] - sale.before.wallets[owner.id], 100); near(sale.after.funds - sale.before.funds, 200);
  near(sale.after.treasury - sale.before.treasury, 50); near(sale.after.heldCash, sale.before.heldCash);
  assert.equal(sale.after.title.assetOwnerId, assetBuyer); assert.equal(sale.after.shops.find((row: Shop) => row.id === shop.id).ownerId, assetBuyer);
  const lease = rental.after.leases.find((row: any) => row.id === rental.after.title.leaseId)!;
  assert.equal(lease.state, 'active'); assert.equal(lease.lessorId, assetBuyer); assert.equal(lease.tenantId, tenant); assert.equal(lease.rent, 25);
  assert.equal(lease.depositInitial, 50); assert.equal(lease.depositEscrow, 50); assert.equal(lease.advanceInitial, 200); assert.equal(lease.advanceRefunded, 0);
  near(rental.before.wallets[tenant] - rental.after.wallets[tenant], 25 + 50 + 200 + 50);
  near(rental.after.wallets[assetBuyer] - rental.before.wallets[assetBuyer], 25); near(rental.after.wallets[owner.id], rental.before.wallets[owner.id]);
  near(rental.after.funds - rental.before.funds, 200); near(rental.after.treasury - rental.before.treasury, 50); near(rental.after.heldCash - rental.before.heldCash, 50);
  for (const contract of [sale, rental]) {
    const actorId = contract.citizenId, arrival = trace.marketArrivals.find(row => row.citizenId === actorId && row.at === contract.at)!;
    assert(arrival && arrival.destinationId === shop.buildingId && arrival.activity === 'shopLifecycle');
    assert(trace.marketRoutes.some(row => row.actorId === actorId && row.at < contract.at && row.routeIndex < row.route.length), 'each distinct party walks its ordinary route before actual acceptance');
    const actor = sim.state.citizens.find(row => row.id === actorId)!; assert(sim.isAtBuildingFunctionPoint(sim.worldDefinition.buildings.find(row => row.id === shop.buildingId)!, arrival.position, 'work', { role: 'merchant', identities: ['merchant'] }));
    assert.equal(actor.workId, shop.buildingId); assert.equal(actor.role, 'merchant');
    for (const claim of contract.before.claims.filter((row: any) => row.amount > 0)) {
      const retained = contract.after.claims.find((row: any) => row.citizenId === claim.citizenId && row.shopId === claim.shopId);
      assert(retained && retained.amount + 1e-7 >= claim.amount, 'the old employer and actual earned wages survive each actual transaction');
    }
  }
  assert.equal(title.assetOwnerId, assetBuyer); assert.equal(shop.ownerId, tenant); assert.equal(title.reopen!.operatorId, tenant); assert.equal(title.leaseId, lease.id);
  assert.equal(title.listingId, null); assert.equal(title.materialsHeld, 1); assert.equal(title.reopen!.workedMinutes, 0); assert.equal(title.reopen!.consumedUnits, 0);
  assert.deepEqual(title.reopenHistory, [firstJob]); assert.equal(shopLifecycleCanDispose(sim.state, shop.id), false, 'the real tenant and deposit/advance rights prohibit another owner-only distress conversion');
  const purchases = title.reopen!.purchases; near(purchases.filter(row => row.commodity === 'materials').reduce((n, row) => n + row.quantity, 0), 1);
  near(purchases.filter(row => row.commodity === 'food').reduce((n, row) => n + row.quantity, 0), 2);
  assert(purchases.every(row => row.unitPrice > 0 && row.gross > 0 && row.quantity > 0 && sim.state.shops.find(source => source.id === row.supplierId)?.districtId === shop.districtId));
  assert.equal(purchases.find(row => row.commodity === 'materials')!.supplierId, sim.state.shops.find(row => row.buildingId === 'workshop')!.id);
  assert.equal(purchases.find(row => row.commodity === 'food')!.supplierId, sim.state.shops.find(row => row.buildingId === 'farm')!.id);
  assert.equal(sim.state.player.inventory.materials, 1, 'the explicitly reserved initial material never refills the real supplier or buys a repair');
  until(sim, () => title.state === 'operating', 2400, step);
  const job = title.reopen!; assert.equal(job.workedMinutes, 60); assert.equal(job.consumedUnits, 1); assert.equal(title.materialsHeld, 0);
  near(job.labor.reduce((n, row) => n + row.minutes, 0), 60); assert(job.labor.length > 0);
  for (const labor of job.labor) {
    assert(originalWorkers.some(row => row.id === labor.citizenId)); assert(labor.earned > 0 && labor.lastAt <= job.completedAt!);
    const actual = trace.wages.filter((row: any) => row.citizenId === labor.citizenId && row.at > job.startedAt && row.at <= job.completedAt!);
    assert(actual.length > 0); assert(actual.reduce((n: number, row: any) => n + row.amount, 0) + 1e-7 >= labor.earned);
    assert(actual.reduce((n: number, row: any) => n + row.minutes, 0) + 1e-7 >= labor.minutes);
  }
  assert.deepEqual(originalWorkers.map(row => { const actor = sim.state.citizens.find(person => person.id === row.id)!; return { id: actor.id, workId: actor.workId, role: actor.role }; }), originalWorkers);
  assert.deepEqual({ id: shop.id, buildingId: shop.buildingId, employees: shop.employees }, identity); assert.deepEqual(title.reopenHistory, [firstJob]);
  assert.equal(title.suspendedAt, null); assert.equal(title.reason, ''); assert.equal(title.corporation, undefined);
  assert.equal(sim.state.shopLifecycle!.receipts.filter(row => row.shopId === shop.id && row.kind === 'reopen').length, 2);
  const checkGoods = () => { const goods = goodsSupply(sim); near(goods.food - startingGoods.food, trace.flow.foodProduced - trace.flow.foodConsumed);
    near(goods.materials - startingGoods.materials + goods.repaired - startingGoods.repaired, trace.flow.materialProduced - trace.flow.publicMaterialConsumed); return goods; };
  const finalGoods = checkGoods(); near(moneySupply(sim), cash);
  record('second-sale-lease-complete-route-and-repair.json', { startingPosition: start, ownerId: owner.id, assetBuyer, tenant, originalWorkers, marketRoutes: trace.marketRoutes, arrivedEvents: trace.marketArrivals,
    actualContracts: trace.contracts, actualWages: trace.wages, firstJob, secondJob: job, secondRoundControlledAdditionalFund: 0, moneySupply: cash, startingGoods, finalGoods, flow: trace.flow, supplyEvents: trace.supplyEvents });
  exact24(sim, 'second-sale-lease-operating'); near(moneySupply(sim), cash); checkGoods();
});

test('second distress with unavailable real industrial stock produces only the current owner voluntary finite offer, without deleting the earlier paid job', () => {
  const { sim, shop, owner, title } = morningRepaired(), firstJob = structuredClone(title.reopen), cash = moneySupply(sim);
  const material = sim.state.shops.find(row => row.buildingId === 'workshop')!, amount = material.inventory;
  // Explicit supply-shortage opening: the original material is retained in an
  // existing inventory, not destroyed or newly generated to satisfy the case.
  sim.state.player.inventory.materials = (sim.state.player.inventory.materials ?? 0) + amount; material.inventory = 0;
  economicOpening(sim, shop, owner, 'second-no-material'); const trace = observe(sim, shop, owner);
  until(sim, () => trace.events.length > 0, 1200, trace.step);
  const observed = trace.events[0] as { title: typeof title; listing: NonNullable<typeof sim.state.shopLifecycle>['listings'][number] };
  assert(trace.routes.length > 0); assert.equal(observed.title.state, 'suspended'); assert.equal(observed.title.reason, 'economic-distress');
  assert.equal(observed.title.assetOwnerId, owner.id); assert.deepEqual(observed.title.reopen, firstJob); assert.deepEqual(observed.title.reopenHistory, []);
  assert(observed.listing && observed.listing.state === 'offered' && observed.listing.sellerId === owner.id && observed.listing.shopId === shop.id);
  assert.equal(observed.listing.kind, owner.money < 300 ? 'lease' : 'sale'); assert.equal(observed.listing.price, owner.money < 300 ? 25 : 100);
  assert(observed.title.suspendedAt! > firstJob!.completedAt!); near(moneySupply(sim), cash);
  record('second-unavailable-material-natural-offer.json', { controlledMaterialTransfer: amount, arrivedEvents: trace.events, routes: trace.routes, firstJob, moneySupply: cash });
  const save = sim.exportSave(), clone = new Simulation(world()), loaded = clone.importSave(save); assert(loaded.ok, loaded.message); assert.equal(clone.exportSave(), save);
  exact24(sim, 'second-original-owner-suspended-offer');
});

function exact24(sim: Simulation, name: string) {
  const saved = sim.exportSave(); record(`${name}-before24.save.json`, saved);
  assert.equal(JSON.parse(saved).version, 3); assert.equal(assembleSave(partitionSave(saved, sim.worldDefinition)), saved);
  const clone = new Simulation(world()), loaded = clone.importSave(saved); assert(loaded.ok, loaded.message); assert.equal(clone.exportSave(), saved);
  for (let i = 0; i < 24; i++) { sim.step(.25); clone.step(.25); assert.equal(clone.exportSave(), sim.exportSave(), `${name} tick ${i + 1}`); }
  record(`${name}-after24.save.json`, sim.exportSave());
}

test('old genuine version-one business fixtures clear a new host ruleset and retain every original future save byte', () => {
  for (const kind of ['sale', 'lease'] as const) {
    const saved = readFileSync(new URL(`./fixtures/market-company-old-${kind}.json`, import.meta.url), 'utf8'); assert.equal(JSON.parse(saved).version, 1);
    const legacy = new Simulation(world()), host = createProductCity(world());
    assert.equal(host.effectiveRuleset, 'civic-local-v1');
    for (const sim of [legacy, host]) { const loaded = sim.importSave(saved); assert(loaded.ok, loaded.message); assert.equal(sim.effectiveRuleset, 'legacy'); assert.equal(sim.exportSave(), saved); }
    for (let i = 0; i < 24; i++) { legacy.step(.25); host.step(.25); assert.equal(host.exportSave(), legacy.exportSave(), `${kind} old v1 future tick${i + 1}`); assert.equal(host.effectiveRuleset, 'legacy'); }
    record(`old-v1-${kind}-future24.save.json`, host.exportSave());
  }
});

test('a genuine legacy-version-two completed shop with repeated distress never enables the new rule after host import or ordinary first use', () => {
  const legacy = new Simulation(world()), loaded = legacy.importSave(actualFirstRepair(false)); assert(loaded.ok, loaded.message);
  const shop = legacy.state.shops.find(row => row.buildingId === 'market')!, owner = legacy.state.citizens.find(row => row.id === shop.ownerId)!;
  economicOpening(legacy, shop, owner, 'old-v2-second-distress'); const saved = legacy.exportSave(); assert.equal(JSON.parse(saved).version, 2);
  const host = createProductCity(world()), result = host.importSave(saved); assert(result.ok, result.message); assert.equal(host.exportSave(), saved);
  assert.equal(host.effectiveRuleset, 'legacy'); assert.equal(legacy.effectiveRuleset, 'legacy');
  for (const sim of [legacy, host]) {
    const person = sim.state.citizens.find(row => row.id === owner.id)!;
    assert(!shopLifecycleOpportunities(sim, person).some(row => row.destination.id === shop.buildingId)); assert.equal(sim.exportSave(), saved);
  }
  const oldTitle = structuredClone(legacy.state.shopLifecycle!.titles[shop.id]);
  for (let i = 0; i < 24; i++) {
    legacy.step(.25); host.step(.25); assert.equal(host.exportSave(), legacy.exportSave(), `old v2 repeated distress future tick${i + 1}`);
    assert.equal(host.effectiveRuleset, 'legacy'); assert.deepEqual(host.state.shopLifecycle!.titles[shop.id], oldTitle);
  }
  record('old-v2-second-distress-after24.save.json', host.exportSave());
});
