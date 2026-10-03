import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { applyShopLifecycleCommand, shopLifecycleHeldCash, shopLifecycleAllowsOperation, shopLifecycleAllowsNewPayroll, shopLifecycleOpportunities } from '../src/simulation/shop_lifecycle';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import type { BuildingKind, Command, Shop, WorldDefinition } from '../src/types';

// A small trusted legacy map isolates the financial/permission contract. Player qualification and
// the one initial seller work-point placement are controlled fixtures, never claimed as natural play.
function world(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: site.districtId, name: site.id, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const, length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261003, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '经营合同验证', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
const runtime = (simulation: Simulation) => Reflect.get(simulation, 'runtime');
const clock = (simulation: Simulation) => simulation.state.extension!.lastUpdate;
const near = (actual: number, expected: number) => assert(Math.abs(actual - expected) <= 1e-6, `${actual} != ${expected}`);
const evidenceDirectory = new URL('../artifacts/shop-lifecycle-rev03/', import.meta.url);
function record(name: string, value: string | object) { mkdirSync(evidenceDirectory, { recursive: true }); writeFileSync(new URL(name, evidenceDirectory), typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }
function fixture(playerQualified = true) {
  const simulation = new Simulation(world()), shop = simulation.state.shops.find(shop => shop.buildingId === 'market')!;
  const sellerId = shop.ownerId!, seller = simulation.state.citizens.find(citizen => citizen.id === sellerId)!;
  seller.position = { ...simulation.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.door };
  if (playerQualified) { simulation.state.player.role = 'merchant'; simulation.state.player.identities = ['traveler', 'merchant']; }
  return { simulation, shop, sellerId, seller };
}
function consent(simulation: Simulation, shop: Shop, sellerId: string, kind: 'sale' | 'lease', price = kind === 'sale' ? 100 : 25) {
  const stopped = applyShopLifecycleCommand(simulation, { type: 'suspendShop', targetId: shop.id }, sellerId)!; assert(stopped.ok, stopped.message);
  const offered = applyShopLifecycleCommand(simulation, { type: kind === 'sale' ? 'listShopForSale' : 'listShopForLease', targetId: shop.id, value: price }, sellerId)!; assert(offered.ok, offered.message);
  return simulation.state.shopLifecycle!.listings.at(-1)!;
}
function playerAt(simulation: Simulation, siteId = 'market') { simulation.setFocus(simulation.worldDefinition.buildings.find(site => site.id === siteId)!.door, 'walk'); }
function commandOk(simulation: Simulation, command: Command) { const result = simulation.command(command); assert(result.ok, result.message); }
function moneySupply(simulation: Simulation) {
  const state = simulation.state, extension = state.extension!;
  return state.treasury + runtime(simulation).taxes + state.player.money + state.citizens.reduce((sum, citizen) => sum + citizen.money, 0)
    + state.shops.filter(shop => !extension.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + extension.companies.reduce((sum, company) => sum + company.capital, 0) + extension.organizations.reduce((sum, organization) => sum + organization.funds, 0)
    + state.banking!.cash + state.banking!.legacyInvestmentCash + (state.playerLabor?.job?.escrow ?? 0)
    + state.family!.households.reduce((sum, household) => sum + household.balance, 0) + state.family!.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0)
    + (state.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0) + (state.education?.course?.escrow ?? 0) + shopLifecycleHeldCash(state);
}
function runMinutes(simulation: Simulation, minutes: number) { for (let i = 0; i < minutes * 4; i++) simulation.step(.25); }
function runUntil(simulation: Simulation, targetClock: number) { for (let i = 0; clock(simulation) < targetClock && i < 10000; i++) simulation.step(.25); assert(clock(simulation) >= targetClock); }

test('missing consent, a different author, unqualified buyer and wrong site reject without changing one save byte', () => {
  const { simulation, shop, sellerId } = fixture(false);
  for (const command of [{ type: 'business', targetId: shop.buildingId }, { type: 'buyShop', targetId: shop.id }, { type: 'foundCompany', targetId: shop.buildingId, value: 300 }] as Command[]) {
    const before = simulation.exportSave(); assert.equal(simulation.command(command).ok, false); assert.equal(simulation.exportSave(), before);
  }
  playerAt(simulation); const before = simulation.exportSave();
  assert.equal(applyShopLifecycleCommand(simulation, { type: 'suspendShop', targetId: shop.id }, 'player')!.ok, false); assert.equal(simulation.exportSave(), before);
  const listing = consent(simulation, shop, sellerId, 'sale');
  const unqualified = simulation.exportSave(); assert.equal(simulation.command({ type: 'buyShop', targetId: listing.id }).ok, false); assert.equal(simulation.exportSave(), unqualified);
  simulation.state.player.role = 'merchant'; simulation.state.player.identities = ['traveler', 'merchant']; playerAt(simulation, 'home');
  const away = simulation.exportSave(); assert.equal(simulation.command({ type: 'buyShop', targetId: listing.id }).ok, false); assert.equal(simulation.exportSave(), away);
});

test('night and power shortage do not grant a title, listing, deposit or historical closure', () => {
  const { simulation, shop } = fixture();
  simulation.command({ type: 'setTime', value: 23 }); simulation.state.districts[0].energy = 20;
  simulation.step(.25); assert.equal(shop.open, false); assert.equal(simulation.state.shopLifecycle, undefined);
  const save = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition);
  assert(restored.importSave(save).ok); assert.equal(restored.exportSave(), save);
});

test('a funded sale pays original assets to seller, capital to old shop and fee to public, with one owner receipt and no free stock', () => {
  const { simulation, shop, sellerId, seller } = fixture(), listing = consent(simulation, shop, sellerId, 'sale'); playerAt(simulation);
  const supply = moneySupply(simulation), sellerCash = seller.money, shopCash = simulation.shopFunds(shop), inventory = shop.inventory, profit = shop.profit, treasury = simulation.state.treasury;
  record('sale-before.json', simulation.exportSave());
  commandOk(simulation, { type: 'buyShop', targetId: listing.id });
  near(seller.money, sellerCash + 100); near(simulation.shopFunds(shop), shopCash + 200); near(simulation.state.treasury, treasury + 50); near(moneySupply(simulation), supply);
  assert.equal(shop.ownerId, 'player'); assert.equal(shop.inventory, inventory); assert.equal(shop.profit, profit); assert.equal(shop.open, false);
  assert.equal(simulation.state.shopLifecycle!.titles[shop.id].assetOwnerId, 'player');
  record('sale-after.json', simulation.exportSave());
  const once = simulation.exportSave(); assert.equal(simulation.command({ type: 'buyShop', targetId: listing.id }).ok, false); assert.equal(simulation.exportSave(), once);
});

test('seller cash cap and destination capital cap reject every debit and ownership edit atomically', () => {
  for (const cap of ['seller', 'shop'] as const) {
    const { simulation, shop, sellerId, seller } = fixture(), listing = consent(simulation, shop, sellerId, 'sale'); playerAt(simulation);
    // Explicit synthetic opening balance at the configured 1e9 ceiling; this is a capacity fixture, not natural wealth.
    if (cap === 'seller') seller.money = 1e9; else shop.cash = 1e9;
    record(`capacity-${cap}-opening.json`, simulation.exportSave());
    const before = simulation.exportSave(); assert.equal(simulation.command({ type: 'buyShop', targetId: listing.id }).ok, false); assert.equal(simulation.exportSave(), before);
  }
});

test('real existing wage debt and consigned suppliers remain on the same shop after sale and during repair', () => {
  const { simulation, shop, sellerId, seller } = fixture(); runMinutes(simulation, 10);
  assert(simulation.shopPayrollDebt(shop) > 0, 'ordinary onsite workers earned an actual wage claim');
  seller.position = { ...simulation.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.door };
  // Controlled stock opening: relocate remaining owned food to the existing farm without changing total food.
  const farm = simulation.state.shops.find(shop => shop.buildingId === 'farm')!, owned = (simulation.state.trade!.ownedLots![shop.id] ?? []).reduce((sum, lot) => sum + lot.quantity, 0);
  shop.inventory -= owned; farm.inventory += owned; simulation.state.trade!.ownedLots![shop.id] = [];
  assert(simulation.supplyConsignment(shop.id, 4) > 0); const consignments = structuredClone(simulation.state.trade!.lots[shop.id]), claims = structuredClone(runtime(simulation).wageAccruals.filter((row: { shopId: string }) => row.shopId === shop.id));
  const listing = consent(simulation, shop, sellerId, 'sale'); playerAt(simulation); commandOk(simulation, { type: 'buyShop', targetId: listing.id });
  record('old-wages-consignment-after-sale.json', simulation.exportSave());
  assert.deepEqual(simulation.state.trade!.lots[shop.id], consignments); assert.deepEqual(runtime(simulation).wageAccruals.filter((row: { shopId: string }) => row.shopId === shop.id), claims);
  const inventory = shop.inventory, workshop = simulation.state.shops.find(shop => shop.buildingId === 'workshop')!, materials = workshop.inventory;
  commandOk(simulation, { type: 'restartShop', targetId: shop.id });
  assert.equal(workshop.inventory, materials - 1); assert.equal(shop.inventory, inventory); assert.deepEqual(simulation.state.trade!.lots[shop.id], consignments);
  const title = simulation.state.shopLifecycle!.titles[shop.id]; assert.equal(title.reopen!.workedMinutes, 0); assert.equal(title.materialsHeld, 1); assert.equal(shop.open, false);
  for (let i = 0; i < 800 && title.reopen!.completedAt === null; i++) simulation.step(.25);
  assert.equal(title.reopen!.workedMinutes, 60); assert.equal(title.materialsHeld, 0); assert.equal(title.reopen!.consumedUnits, 1);
  assert(title.reopen!.labor.every(row => row.minutes <= row.lastAt - title.reopen!.startedAt + 1e-7));
  assert(title.reopen!.labor.every(row => simulation.state.citizens.some(citizen => citizen.id === row.citizenId)));
  const genuine = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition); const loaded = restored.importSave(genuine); assert(loaded.ok, loaded.message);
  record('actual-repair-completed-genuine.json', genuine);
  const forged = JSON.parse(genuine); forged.state.shopLifecycle.titles[shop.id].reopen.completedAt = title.reopen!.startedAt;
  const before = restored.exportSave(); assert.equal(restored.importSave(JSON.stringify(forged)).ok, false); assert.equal(restored.exportSave(), before);
  record('actual-repair-completed-shortened-forged.json', forged);
});

test('a qualified resident selects a concrete authorized offer and walks the ordinary route before the shared transaction', () => {
  const { simulation, shop, sellerId } = fixture(false), listing = consent(simulation, shop, sellerId, 'sale');
  const candidates = simulation.state.citizens.filter(citizen => shopLifecycleOpportunities(simulation, citizen).some(offer => offer.destination.id === shop.buildingId));
  assert(candidates.some(citizen => citizen.id !== sellerId), 'initial real wallets, skills and needs can support an actual buyer');
  const startingPositions = new Map(simulation.state.citizens.map(citizen => [citizen.id, { ...citizen.position }]));
  record('natural-buyer-before.json', simulation.exportSave());
  const pathObserved = new Set<string>();
  const routes: Record<string, object> = {};
  for (let i = 0; i < 800 && listing.state === 'offered'; i++) {
    simulation.step(.25);
    for (const citizen of simulation.state.citizens) if (citizen.destinationId === shop.buildingId && runtime(simulation).activities[citizen.id] === 'shopLifecycle' && citizen.route!.length > 1) { pathObserved.add(citizen.id); routes[citizen.id] ??= { at: clock(simulation), position: { ...citizen.position }, destinationId: citizen.destinationId, route: structuredClone(citizen.route), routeIndex: citizen.routeIndex }; }
  }
  assert.equal(listing.state, 'accepted'); assert(listing.acceptedBy !== 'player' && listing.acceptedBy !== sellerId);
  const buyer = simulation.state.citizens.find(citizen => citizen.id === listing.acceptedBy)!;
  assert(pathObserved.has(buyer.id), 'the eventual buyer had an ordinary saved route to the named shop');
  assert.notDeepEqual(buyer.position, startingPositions.get(buyer.id)); assert.equal(buyer.workId, shop.buildingId); assert.equal(buyer.role, 'merchant');
  assert(simulation.state.shopLifecycle!.receipts.some(receipt => receipt.kind === 'sale' && receipt.actorId === buyer.id && receipt.payeeId === sellerId && receipt.amount === 100));
  record('natural-buyer-route.json', { buyerId: buyer.id, route: routes[buyer.id], startingPosition: startingPositions.get(buyer.id) }); record('natural-buyer-after.json', simulation.exportSave());
});

test('lease start separates title, operator, deposit escrow, periodic rent and tenant advance without creating cash', () => {
  const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'lease'); playerAt(simulation);
  const supply = moneySupply(simulation); commandOk(simulation, { type: 'leaseShop', targetId: listing.id }); near(moneySupply(simulation), supply);
  const title = simulation.state.shopLifecycle!.titles[shop.id], lease = simulation.state.shopLifecycle!.leases[0];
  assert.equal(title.assetOwnerId, sellerId); assert.equal(shop.ownerId, 'player'); assert.equal(lease.depositEscrow, 50); assert.equal(lease.advanceInitial, 200); assert.equal(lease.paidRent, 25);
  commandOk(simulation, { type: 'restartShop', targetId: shop.id }); assert.equal(title.reopen!.workedMinutes, 0);
  commandOk(simulation, { type: 'speed', value: 16 }); runUntil(simulation, lease.startedAt + 1440);
  assert.equal(lease.accruedPeriods, 2); assert.equal(lease.accruedRent, 50); assert.equal(lease.paidRent + lease.arrears, 50); assert.equal(lease.depositEscrow, 50);
  record('lease-second-period.json', simulation.exportSave());
});

test('early lease exit cancels repair with original material and wage history, refunds deposit once and keeps advance claim', () => {
  const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'lease'); playerAt(simulation); commandOk(simulation, { type: 'leaseShop', targetId: listing.id }); commandOk(simulation, { type: 'restartShop', targetId: shop.id });
  const title = simulation.state.shopLifecycle!.titles[shop.id], lease = simulation.state.shopLifecycle!.leases[0], materials = title.materialsHeld, wallet = simulation.state.player.money, claims = structuredClone(runtime(simulation).wageAccruals);
  commandOk(simulation, { type: 'endShopLease', targetId: shop.id });
  assert.equal(lease.state, 'ended'); assert.equal(lease.depositEscrow, 0); assert.equal(lease.depositRefunded, 50); assert.equal(simulation.state.player.money, wallet + 50);
  assert.equal(title.materialsHeld, materials); assert.equal(title.reopen!.cancelledAt, clock(simulation)); assert.equal(title.reopen!.consumedUnits, 0); assert.deepEqual(runtime(simulation).wageAccruals, claims);
  assert.equal(lease.advanceInitial - lease.advanceRefunded, 200); assert.equal(title.assetOwnerId, sellerId); assert.equal(shop.ownerId, sellerId);
  record('lease-ended-material-advance-kept.json', simulation.exportSave());
  const once = simulation.exportSave(); assert.equal(simulation.command({ type: 'endShopLease', targetId: shop.id }).ok, false); assert.equal(simulation.exportSave(), once);
});

test('expiry blocks commerce and new labor even when a capped refund recipient keeps deposit settlement pending', () => {
  const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'lease'); playerAt(simulation); commandOk(simulation, { type: 'leaseShop', targetId: listing.id });
  const lease = simulation.state.shopLifecycle!.leases[0];
  simulation.state.player.money = 1e9; // Explicit synthetic refund-cap opening boundary.
  commandOk(simulation, { type: 'speed', value: 16 }); runUntil(simulation, lease.endsAt);
  assert.equal(lease.depositEscrow, 50); assert.equal(shopLifecycleAllowsOperation(simulation.state, shop.id), false); assert.equal(shopLifecycleAllowsNewPayroll(simulation.state, shop.id), false); assert.equal(shop.open, false);
  assert.equal(simulation.state.shopLifecycle!.titles[shop.id].state, 'suspended');
  record('lease-expired-capped-refund-pending.json', simulation.exportSave());
  const before = simulation.exportSave(); assert.equal(simulation.command({ type: 'purchase', targetId: shop.buildingId }).ok, false); assert.equal(simulation.exportSave(), before);
  playerAt(simulation); const beforeFunding = simulation.exportSave();
  assert.equal(simulation.command({ type: 'fundShop', targetId: shop.id, value: 200 }).ok, false);
  assert.equal(simulation.exportSave(), beforeFunding, 'expired pending deposit cannot authorize cash movement, new advance or any other store edit');
  record('expired-new-advance-rejected.json', beforeFunding);
});

test('new finance state survives partition and 24 exact ticks; malformed lease/owner/escrow/module removal reject atomically', () => {
  const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'lease'); playerAt(simulation); commandOk(simulation, { type: 'leaseShop', targetId: listing.id }); commandOk(simulation, { type: 'restartShop', targetId: shop.id });
  const save = simulation.exportSave(), partitioned = assembleSave(partitionSave(save, simulation.worldDefinition)); assert.equal(partitioned, save);
  record('partition-roundtrip-input.json', save);
  const restored = new Simulation(simulation.worldDefinition); const imported = restored.importSave(partitioned); assert(imported.ok, imported.message); assert.equal(restored.exportSave(), save);
  for (let i = 0; i < 24; i++) { simulation.step(.25); restored.step(.25); assert.equal(restored.exportSave(), simulation.exportSave()); }
  record('partition-exact-24-after.json', simulation.exportSave());
  for (const mutate of [
    (document: any) => document.state.shopLifecycle.leases[0].depositEscrow++,
    (document: any) => document.state.shopLifecycle.titles[shop.id].assetOwnerId = 'player',
    (document: any) => document.state.shopLifecycle.leases[0].advanceInitial++,
    (document: any) => { document.state.shopLifecycle.titles[shop.id].reopen.completedAt = document.state.shopLifecycle.titles[shop.id].reopen.startedAt; },
    (document: any) => { delete document.state.shopLifecycle; delete document.runtime.shopLifecycleVersion; document.runtime.persistedModules = document.runtime.persistedModules.filter((name: string) => name !== 'shopLifecycle'); },
  ]) { const document = JSON.parse(simulation.exportSave()); mutate(document); const before = restored.exportSave(); assert.equal(restored.importSave(JSON.stringify(document)).ok, false); assert.equal(restored.exportSave(), before); }
});


test('an ended lease with outstanding tenant advance cannot be deleted while keeping the payment archive', () => {
  const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'lease'); playerAt(simulation); commandOk(simulation, { type: 'leaseShop', targetId: listing.id }); commandOk(simulation, { type: 'endShopLease', targetId: shop.id });
  const genuine = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition); assert(restored.importSave(genuine).ok);
  record('ended-lease-outstanding-advance-genuine.json', genuine);
  const document = JSON.parse(genuine); document.state.shopLifecycle.leases = []; for (const receipt of document.state.shopLifecycle.receipts) receipt.leaseId = null;
  const before = restored.exportSave(); assert.equal(restored.importSave(JSON.stringify(document)).ok, false); assert.equal(restored.exportSave(), before);
  record('ended-lease-deleted-forged.json', document);
  const wrongPayee = JSON.parse(genuine); wrongPayee.state.shopLifecycle.receipts.find((receipt: { kind: string }) => receipt.kind === 'deposit-refund').payeeId = sellerId;
  assert.equal(restored.importSave(JSON.stringify(wrongPayee)).ok, false); assert.equal(restored.exportSave(), before);
  record('ended-lease-wrong-refund-payee-forged.json', wrongPayee);
});

test('a fractional material shortage rejects before money, supplier inventory or repair title changes', () => {
  const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'sale'); playerAt(simulation); commandOk(simulation, { type: 'buyShop', targetId: listing.id });
  simulation.state.shops.find(shop => shop.buildingId === 'workshop')!.inventory = .99999995; // Explicit finite-stock opening boundary.
  const before = simulation.exportSave(); assert.equal(simulation.command({ type: 'restartShop', targetId: shop.id }).ok, false); assert.equal(simulation.exportSave(), before);
});

test('a zero-wage event cannot buy free repair minutes or produce an unreadable labor row', () => {
  const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'sale'); playerAt(simulation); commandOk(simulation, { type: 'buyShop', targetId: listing.id }); commandOk(simulation, { type: 'restartShop', targetId: shop.id });
  const worker = simulation.state.citizens.find(citizen => citizen.workId === shop.buildingId && citizen.role !== '学生')!;
  let observed = false;
  simulation.onPhase('people', () => {
    const job = simulation.state.shopLifecycle!.titles[shop.id].reopen!, before = JSON.stringify(job);
    // Controlled malformed/zero event is a negative contract fixture; successful labor comes from real attendance in the earlier case.
    simulation.emitEvent({ type: 'wage-earned', citizenId: worker.id, shopId: shop.id, amount: 0, minutes: .25, creditedWorkStartAt: clock(simulation) - .25, creditedWorkEndAt: clock(simulation) });
    assert.equal(JSON.stringify(job), before); observed = true;
  });
  simulation.step(.25); assert(observed); const restored = new Simulation(simulation.worldDefinition); const loaded = restored.importSave(simulation.exportSave()); assert(loaded.ok, loaded.message);
});


test('a deceased lease party rejects new tenant advance before any wallet, account or title mutation', () => {
  for (const party of ['lessor', 'tenant'] as const) {
    const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'lease'); playerAt(simulation);
    commandOk(simulation, { type: 'leaseShop', targetId: listing.id });
    const lease = simulation.state.shopLifecycle!.leases[0], id = party === 'lessor' ? sellerId : 'player';
    simulation.state.extension!.actorProfiles[id].alive = false; simulation.state.extension!.actorProfiles[id].health = 0; // Explicit command-boundary death fixture; no inheritance claim.
    const before = simulation.exportSave(), advance = lease.advanceInitial;
    assert.equal(simulation.command({ type: 'fundShop', targetId: shop.id, value: 200 }).ok, false);
    assert.equal(simulation.exportSave(), before); assert.equal(lease.advanceInitial, advance);
    record(`deceased-${party}-new-advance-rejected.json`, before);
  }
});

test('managed business ownership mirrors cannot grant authority or erase an actual player operating owner during load', () => {
  for (const ownedByPlayer of [false, true]) {
    const { simulation, shop, sellerId } = fixture(), listing = consent(simulation, shop, sellerId, 'sale');
    if (ownedByPlayer) { playerAt(simulation); commandOk(simulation, { type: 'buyShop', targetId: listing.id }); }
    const genuine = simulation.exportSave(), restored = new Simulation(world()); assert.equal(restored.importSave(genuine).ok, true); assert.equal(restored.exportSave(), genuine);
    const forged = JSON.parse(genuine); forged.runtime.playerBusinesses = ownedByPlayer ? forged.runtime.playerBusinesses.filter((id: string) => id !== shop.id) : [...forged.runtime.playerBusinesses, shop.id];
    record(`managed-mirror-${ownedByPlayer ? 'omitted' : 'forged'}-input.json`, forged);
    const before = restored.exportSave(); assert.equal(restored.importSave(JSON.stringify(forged)).ok, false); assert.equal(restored.exportSave(), before);
    assert.equal(restored.state.shops.find(item => item.id === shop.id)!.ownerId, ownedByPlayer ? 'player' : sellerId);
  }
});
