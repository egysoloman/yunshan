import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { applyShopLifecycleCommand, shopLifecycleHeldCash, shopLifecycleOpportunities } from '../src/simulation/shop_lifecycle';
import type { BuildingKind, Citizen, Shop, WorldDefinition } from '../src/types';

// Controlled account/stock/capacity cases below are not a natural-economy claim.
// The final two route cases use initial real wallets, skills and needs, one seller
// consent placement, and normal schedules thereafter; no buyer placement or pin.
function world(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: site.districtId, name: site.id, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const, length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261003, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '本人有限补款验证', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
const runtime = (simulation: Simulation) => Reflect.get(simulation, 'runtime');
const clock = (simulation: Simulation) => simulation.state.extension!.lastUpdate;
const near = (a: number, b: number) => assert(Math.abs(a - b) <= 1e-6, `${a} != ${b}`);
function ok(simulation: Simulation, type: 'suspendShop' | 'listShopForSale' | 'listShopForLease' | 'leaseShop', targetId: string, actorId: string, value?: number) {
  const result = applyShopLifecycleCommand(simulation, { type, targetId, value }, actorId)!; assert(result.ok, result.message);
}
function base() {
  const simulation = new Simulation(world()), shop = simulation.state.shops.find(shop => shop.buildingId === 'market')!;
  const seller = simulation.state.citizens.find(citizen => citizen.id === shop.ownerId)!;
  seller.position = { ...simulation.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.door };
  return { simulation, shop, seller };
}
function fixture(kind: 'owner' | 'lease' = 'owner') {
  const { simulation, shop, seller } = base(); ok(simulation, 'suspendShop', shop.id, seller.id);
  let operator = seller;
  if (kind === 'lease') {
    ok(simulation, 'listShopForLease', shop.id, seller.id, 25);
    operator = simulation.state.citizens.find(citizen => citizen.id !== seller.id && shopLifecycleOpportunities(simulation, citizen).some(offer => offer.destination.id === shop.buildingId))!;
    assert(operator, 'an initial eligible resident can actually afford the named lease');
    // A single controlled transaction placement for the account boundary tests.
    operator.position = { ...seller.position };
    ok(simulation, 'leaseShop', simulation.state.shopLifecycle!.listings.at(-1)!.id, operator.id, 200);
  }
  // Move existing operating cash back to this same operator: no minted cash.
  operator.money += simulation.shopFunds(shop); simulation.transferShopFunds(shop, -simulation.shopFunds(shop));
  return { simulation, shop, seller, operator, title: simulation.state.shopLifecycle!.titles[shop.id] };
}
function arrive(simulation: Simulation, shop: Shop, operator: Citizen) {
  simulation.emitEvent({ type: 'shop-lifecycle-arrived', citizenId: operator.id, shopId: shop.id });
}
function supply(simulation: Simulation) {
  const state = simulation.state, extension = state.extension!;
  return state.treasury + runtime(simulation).taxes + state.player.money + state.citizens.reduce((sum, citizen) => sum + citizen.money, 0)
    + state.shops.filter(shop => !extension.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + extension.companies.reduce((sum, company) => sum + company.capital, 0) + extension.organizations.reduce((sum, organization) => sum + organization.funds, 0)
    + state.banking!.cash + state.banking!.legacyInvestmentCash + (state.playerLabor?.job?.escrow ?? 0)
    + state.family!.households.reduce((sum, household) => sum + household.balance, 0) + state.family!.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0)
    + (state.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0) + (state.education?.course?.escrow ?? 0) + shopLifecycleHeldCash(state);
}

for (const kind of ['owner', 'lease'] as const) test(`a solvent ${kind} chooses one exact limited wallet contribution rather than failing solely on the operating account`, () => {
  const { simulation, shop, operator, title } = fixture(kind), material = simulation.state.shops.find(row => row.buildingId === 'workshop')!;
  const protectedFunds = simulation.shopProtectedFunds(shop), wallet = operator.money, materialStock = material.inventory, inventory = shop.inventory, cash = supply(simulation);
  assert.equal(simulation.shopFunds(shop), 0); assert.equal(simulation.shopCommittedPayroll(shop), 0); assert(wallet >= protectedFunds + 4 + 20 * 8 / 24 + 100);
  const before = simulation.exportSave();
  assert.equal(applyShopLifecycleCommand(simulation, { type: 'restartShop', targetId: shop.id }, operator.id)!.ok, false);
  assert.equal(simulation.exportSave(), before, 'the public restart API still requires an already funded account');
  arrive(simulation, shop, operator);
  assert.equal(title.state, 'reopening'); assert.equal(title.listingId, null); assert.equal(title.reopen!.workedMinutes, 0);
  assert.equal(title.reopen!.labor.length, 0); assert.equal(title.materialsHeld, 1); assert.equal(shop.open, false);
  const capital = simulation.state.shopLifecycle!.receipts.filter(row => row.kind === 'capital' && row.actorId === operator.id && row.payeeId === shop.id).at(-1)!;
  near(capital.amount, kind === 'owner' ? 10.67 : 35.67); near(operator.money, wallet - capital.amount); assert(operator.money >= 100);
  assert(simulation.shopFunds(shop) - simulation.shopProtectedFunds(shop) >= 20 * 8 / 24);
  near(simulation.shopProtectedFunds(shop), protectedFunds); near(material.inventory, materialStock - 1); near(shop.inventory, inventory); near(supply(simulation), cash);
  if (kind === 'lease') near(simulation.state.shopLifecycle!.leases[0].advanceInitial, 200 + capital.amount);
  const after = simulation.exportSave(); arrive(simulation, shop, operator); assert.equal(simulation.exportSave(), after, 'a pending repair does not repeat the contribution');
});

test('rounded noninteger quotes, tax and protected debt leave the literal reserve intact, including large-balance cancellation', () => {
  let exactGapCancellationObserved = false;
  for (const row of [{ price: 4.01, tax: .073, debt: 17.3333333333333, cash: 0 }, { price: 12.37, tax: .137, debt: .123456789, cash: 0 }, { price: 4.99, tax: .099, debt: 900000000.1234567, cash: 900000000.1234567 }]) {
    const { simulation, shop, operator, title } = fixture('lease'), material = simulation.state.shops.find(shop => shop.buildingId === 'workshop')!;
    // Explicit synthetic cost-history/debt/cap fixtures; quote and procurement
    // still use the original finite supplier and its unmodified public API.
    simulation.state.taxRate = row.tax;
    simulation.state.trade!.activity[material.id] = [{ at: clock(simulation), sold: 0, supplied: 0, labor: 0, produced: 1, shortages: 0, earnedLaborCost: row.price * (1 - row.tax), actualUtilities: 0 }];
    runtime(simulation).wageArrears.push({ citizenId: operator.id, shopId: shop.id, amount: row.debt });
    shop.cash = row.cash;
    const quote = simulation.quoteSupply(material.id, 1), protectedFunds = simulation.shopProtectedFunds(shop), funds = simulation.shopFunds(shop);
    near(quote.quantity, 1); near(quote.unitPrice, row.price);
    const required = quote.unitPrice + 20 * 8 / 24, exactGap = required - (funds - protectedFunds), wallet = operator.money, cash = supply(simulation), debt = structuredClone(runtime(simulation).wageArrears);
    exactGapCancellationObserved ||= funds + exactGap - protectedFunds < required;
    assert(wallet - exactGap >= 100); arrive(simulation, shop, operator); assert.equal(title.state, 'reopening');
    const contribution = simulation.state.shopLifecycle!.receipts.at(-1)!.amount;
    assert(contribution >= exactGap && contribution - exactGap <= .010001, 'at most a cent of explained upward payment rounding');
    assert(operator.money >= 100); near(operator.money, wallet - contribution);
    assert(simulation.shopFunds(shop) - simulation.shopProtectedFunds(shop) >= 20 * 8 / 24, 'actual subtraction passes the original literal threshold');
    assert.deepEqual(runtime(simulation).wageArrears, debt); near(supply(simulation), cash); assert.equal(title.reopen!.workedMinutes, 0);
  }
  assert(exactGapCancellationObserved, 'the fixtures reproduce an exact-gap literal rejection, not only hypothetical rounding');
});

test('one limited contribution purchases actual finite food and material while keeping the new FIFO basis and old debts', () => {
  const { simulation, shop, operator, title } = fixture('lease'), farm = simulation.state.shops.find(row => row.buildingId === 'farm')!, material = simulation.state.shops.find(row => row.buildingId === 'workshop')!;
  const ownedFood = simulation.state.trade!.ownedLots![shop.id].reduce((sum, lot) => sum + lot.quantity, 0);
  near(ownedFood, shop.inventory); shop.inventory -= ownedFood; farm.inventory += ownedFood; simulation.state.trade!.ownedLots![shop.id] = [];
  // Controlled cost-history fixtures exercise original quoteSupply for both
  // commodities; existing physical food was relocated, never synthesized.
  simulation.state.taxRate = .19;
  for (const [supplier, price] of [[farm, 6.29], [material, 8.31]] as const) simulation.state.trade!.activity[supplier.id] = [{ at: clock(simulation), sold: 0, supplied: 0, labor: 0, produced: 1, shortages: 0, earnedLaborCost: price * .81, actualUtilities: 0 }];
  runtime(simulation).wageArrears.push({ citizenId: operator.id, shopId: shop.id, amount: 5.125 });
  const food = shop.inventory + farm.inventory, materials = material.inventory + title.materialsHeld, cash = supply(simulation), protectedFunds = simulation.shopProtectedFunds(shop);
  arrive(simulation, shop, operator); assert.equal(title.state, 'reopening');
  near(title.reopen!.purchases.filter(row => row.commodity === 'food').reduce((sum, row) => sum + row.quantity, 0), 2);
  near(title.reopen!.purchases.filter(row => row.commodity === 'materials').reduce((sum, row) => sum + row.quantity, 0), 1);
  near(title.reopen!.purchases.reduce((sum, row) => sum + row.gross, 0), 20.89);
  near(shop.inventory + farm.inventory, food); near(material.inventory + title.materialsHeld, materials); near(supply(simulation), cash);
  near(simulation.state.trade!.ownedLots![shop.id].reduce((sum, lot) => sum + lot.quantity * lot.unitPrice, 0), 12.58);
  near(simulation.shopProtectedFunds(shop), protectedFunds); assert(simulation.shopFunds(shop) - protectedFunds >= 20 * 8 / 24); assert(operator.money >= 100); assert.equal(title.reopen!.workedMinutes, 0);
});

test('a nominal decimal reserve boundary rejects atomically before spending below one hundred; the next cent is payable', () => {
  const { simulation, shop, operator, title } = fixture('lease');
  operator.money = 135.67; // Controlled decimal boundary; binary subtraction is below100.
  assert(operator.money - 35.67 < 100);
  const before = simulation.exportSave(); arrive(simulation, shop, operator);
  assert.equal(simulation.exportSave(), before, 'do not spend below the literal wallet reserve by a few ulps');
  operator.money = 135.68; // Separate explicit payable opening, not natural income.
  const cash = supply(simulation); arrive(simulation, shop, operator);
  assert.equal(title.state, 'reopening'); assert(operator.money >= 100); near(operator.money, 100.01); near(supply(simulation), cash);
});

test('actual earned and signed original payroll remain protected by the contribution', () => {
  const { simulation, shop, seller } = base();
  for (let i = 0; i < 40; i++) simulation.step(.25);
  assert(simulation.shopPayrollDebt(shop) > 0, 'ordinary onsite employees earned a real original wage claim');
  seller.position = { ...simulation.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.door };
  ok(simulation, 'suspendShop', shop.id, seller.id);
  seller.money += simulation.shopFunds(shop); simulation.transferShopFunds(shop, -simulation.shopFunds(shop));
  const claims = structuredClone(runtime(simulation).wageAccruals), shifts = structuredClone(runtime(simulation).privateLabor), protectedFunds = simulation.shopProtectedFunds(shop);
  assert(seller.money >= protectedFunds + 4 + 20 * 8 / 24 + 100); arrive(simulation, shop, seller);
  assert.equal(simulation.state.shopLifecycle!.titles[shop.id].state, 'reopening');
  assert.deepEqual(runtime(simulation).wageAccruals, claims); assert.deepEqual(runtime(simulation).privateLabor, shifts);
  near(simulation.shopProtectedFunds(shop), protectedFunds); assert(simulation.shopFunds(shop) - protectedFunds >= 20 * 8 / 24);
});

test('wallet reserve, real material, worker, qualification, cash cap, advance cap, receipt cap and rent guards refuse before any contribution', () => {
  for (const issue of ['wallet', 'materials', 'worker', 'qualification', 'cash-cap', 'advance-cap', 'receipt-cap', 'rent-default', 'rent-expired', 'contribution-cap'] as const) {
    const { simulation, shop, operator } = fixture('lease'), lifecycle = simulation.state.shopLifecycle!, lease = lifecycle.leases[0];
    if (issue === 'wallet') operator.money = 100 + 35.66;
    if (issue === 'materials') { const material = simulation.state.shops.find(row => row.buildingId === 'workshop')!; simulation.state.player.inventory.materials = material.inventory; material.inventory = 0; }
    if (issue === 'worker') shop.employees = 0;
    if (issue === 'qualification') simulation.state.extension!.actorProfiles[operator.id].health = 44;
    if (issue === 'cash-cap') { shop.cash = 1e9; runtime(simulation).wageArrears.push({ citizenId: operator.id, shopId: shop.id, amount: 1e9 }); }
    if (issue === 'advance-cap') lease.advanceInitial = 1e9;
    if (issue === 'receipt-cap') { const template = lifecycle.receipts.at(-1)!; lifecycle.receipts = Array.from({ length: 4096 }, (_, index) => ({ ...template, id: index + 1 })); lifecycle.nextReceiptId = 4097; }
    if (issue === 'rent-default') { lease.state = 'defaulted'; lease.arrears = 25; }
    if (issue === 'rent-expired') lease.endsAt = clock(simulation);
    if (issue === 'contribution-cap') { runtime(simulation).wageArrears.push({ citizenId: operator.id, shopId: shop.id, amount: 100001 }); operator.money = 200000; }
    const before = simulation.exportSave(); arrive(simulation, shop, operator);
    assert.equal(simulation.exportSave(), before, `${issue}: tenant refusal leaves the entire original save unchanged`);
  }
});

test('startup funding does not create unsigned labor or guarantee the sixty-minute completion', () => {
  const { simulation, shop, operator, title } = fixture(); arrive(simulation, shop, operator);
  assert.equal(simulation.shopCommittedPayroll(shop), 0);
  for (let i = 0; i < 80; i++) simulation.step(.25);
  assert.equal(title.state, 'reopening'); assert.equal(title.reopen!.workedMinutes, 0); assert.equal(title.reopen!.labor.length, 0); assert.equal(title.reopen!.consumedUnits, 0);
  assert.equal(title.materialsHeld, 1); assert.equal(shop.open, false);
  const save = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition), loaded = restored.importSave(save); assert(loaded.ok, loaded.message); assert.equal(restored.exportSave(), save);
  for (let i = 0; i < 24; i++) { simulation.step(.25); restored.step(.25); assert.equal(restored.exportSave(), simulation.exportSave()); }
});

for (const kind of ['sale', 'lease'] as const) test(`an initially affordable ${kind} offer is selected through the normal resident route and transaction`, () => {
  const { simulation, shop, seller } = base(); ok(simulation, 'suspendShop', shop.id, seller.id);
  ok(simulation, kind === 'sale' ? 'listShopForSale' : 'listShopForLease', shop.id, seller.id, kind === 'sale' ? 100 : 25);
  const listing = simulation.state.shopLifecycle!.listings.at(-1)!;
  assert(simulation.state.citizens.some(citizen => citizen.id !== seller.id && shopLifecycleOpportunities(simulation, citizen).some(offer => offer.destination.id === shop.buildingId)));
  const starting = new Map(simulation.state.citizens.map(citizen => [citizen.id, { ...citizen.position }])), routes = new Set<string>();
  for (let i = 0; i < 800 && listing.state === 'offered'; i++) {
    simulation.step(.25);
    for (const citizen of simulation.state.citizens) if (citizen.destinationId === shop.buildingId && runtime(simulation).activities[citizen.id] === 'shopLifecycle' && citizen.route!.length > 1) routes.add(citizen.id);
  }
  assert.equal(listing.state, 'accepted'); assert(listing.acceptedBy && listing.acceptedBy !== 'player' && listing.acceptedBy !== seller.id);
  const buyer = simulation.state.citizens.find(citizen => citizen.id === listing.acceptedBy)!;
  assert(routes.has(buyer.id), 'the named eventual buyer had an ordinary route before acceptance'); assert.notDeepEqual(buyer.position, starting.get(buyer.id));
  assert.equal(buyer.workId, shop.buildingId); assert.equal(buyer.role, 'merchant');
  assert(simulation.state.shopLifecycle!.receipts.some(receipt => receipt.actorId === buyer.id && receipt.payeeId === seller.id && receipt.kind === (kind === 'sale' ? 'sale' : 'lease-start') && receipt.amount === listing.price));
  assert.equal(simulation.state.shopLifecycle!.titles[shop.id].assetOwnerId, kind === 'sale' ? buyer.id : seller.id);
  if (kind === 'lease') { const lease = simulation.state.shopLifecycle!.leases[0]; near(lease.depositEscrow, 50); near(lease.advanceInitial, 200); }
});
