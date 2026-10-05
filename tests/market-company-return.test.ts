import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation';
import { applyShopLifecycleCommand, shopLifecycleAssetOwnerId, shopLifecycleCanDispose, shopLifecycleAllowsShareholding, shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import type { BuildingKind, WorldDefinition } from '../src/types';

// Identical trusted geometry to the actual native writer in final-target01.
function world(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind, position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 }, width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: 'district', name: site.id, position: { ...site.door }, station: true }));
  return { seed: 20261003, voxelSize: .2, size: 1000, buildings, nodes, edges: nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road', length: 30, capacity: 20, points: [nodes[i].position, node.position] })), mountains: [], districts: [{ id: 'district', name: '原市场公司权利验证', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }], spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
function read(kind: 'sale' | 'lease' = 'lease') {
  const saved = readFileSync(new URL(`./fixtures/market-company-current-${kind}.json`, import.meta.url), 'utf8'), sim = new Simulation(world());
  const result = sim.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), saved);
  return sim;
}
const runtime = (sim: Simulation): any => Reflect.get(sim, 'runtime');
function cash(sim: Simulation) {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money + s.citizens.reduce((n, c) => n + c.money, 0)
    + s.shops.filter(shop => !e.companies.some(c => c.buildingId === shop.buildingId && Reflect.get(c, 'shopBindingReleasedAt') === undefined)).reduce((n, shop) => n + (shop.cash ?? 0), 0)
    + e.companies.reduce((n, c) => n + c.capital, 0) + e.organizations.reduce((n, org) => n + org.funds, 0) + s.banking!.cash + s.banking!.legacyInvestmentCash + shopLifecycleHeldCash(s)
    + s.family!.households.reduce((n, h) => n + h.balance, 0) + s.family!.pregnancies.reduce((n, p) => n + p.escrow, 0) + (s.playerLabor?.job?.escrow ?? 0) + (s.education?.course?.escrow ?? 0)
    + (s.clinical?.orders.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.hygiene?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.power?.repairs.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.roadworks?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0);
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function record(name: string, value: string | object) { const dir = process.env.MARKET_RETURN_ARTIFACT_ROOT; if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2)); } }
function exact24(sim: Simulation, name: string) {
  const saved = sim.exportSave(); record(name + '-before24.save.json', saved); assert.equal(assembleSave(partitionSave(saved, sim.worldDefinition)), saved);
  const clone = new Simulation(world()), result = clone.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(clone.exportSave(), saved);
  for (let i = 0; i < 24; i++) { sim.step(.25); clone.step(.25); assert.equal(sim.exportSave(), clone.exportSave(), `${name} tick${i + 1}`); }
  record(name + '-after24.save.json', sim.exportSave());
}
function spousePremise(sim: Simulation, id: string) {
  const npc = sim.state.citizens.find(c => c.id === id)!; assert.equal(npc.partnerId, null);
  // Controlled one-time reciprocal marriage/terminal health premise, no money,
  // title, company share, estate or employment is written by the fixture.
  sim.state.player.partnerId = id; npc.partnerId = 'player';
  sim.state.relationships.push({ npcId: id, affection: 90, trust: 90, type: 'spouse', encounters: 1, memories: [], tags: [], romanceStage: 'married', consent: true });
  sim.state.extension!.actorProfiles.player.family = [id]; sim.state.extension!.actorProfiles[id].family = ['player'];
  const clone = new Simulation(world()), saved = sim.exportSave(), result = clone.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(clone.exportSave(), saved);
}

test('a fully settled leased company returns the original operating asset while keeping its capital and shares', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, company = sim.state.extension!.companies[0], seller = sim.state.citizens.find(c => c.id === 'citizen-6')!;
  const total = cash(sim), stock = shop.inventory, trade = structuredClone(sim.state.trade), originalShares = structuredClone(company.shareholders), originalCapital = company.capital;
  const ended = sim.command({ type: 'endShopLease', targetId: shop.id }); assert.equal(ended.ok, true, ended.message); assert.deepEqual(sim.state.trade, trade, 'the actual end command moves no goods or cost basis'); sim.step(.25);
  const lease = sim.state.shopLifecycle!.leases[0]; record('live-lease-ended.save.json', sim.exportSave());
  assert.equal(lease.state, 'ended'); assert.equal(lease.advanceRefunded, 200); assert.equal(lease.arrears, 0); assert.equal(lease.depositEscrow, 0); near(cash(sim), total);
  assert.equal(company.capital, originalCapital - 200); assert.deepEqual(company.shareholders, originalShares); assert.equal(shop.inventory, stock); assert.deepEqual(sim.state.trade!.lots[shop.id], trade!.lots[shop.id]); assert.deepEqual(sim.state.trade!.ownedLots![shop.id], trade!.ownedLots![shop.id]);
  assert.equal(shopLifecycleAssetOwnerId(sim.state, shop), seller.id); assert.equal(shopLifecycleCanDispose(sim.state, shop.id), true, 'real ended and fully settled lease must not retain a tenant-company lock');
  assert.equal(sim.shopOwnerId(shop), seller.id); assert.equal(sim.shopFunds(shop), shop.cash);
  seller.position = { ...sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door }; // single controlled original holder presence
  const listing = applyShopLifecycleCommand(sim, { type: 'listShopForLease', targetId: shop.id, value: 3 }, seller.id)!; assert.equal(listing.ok, true, listing.message);
  exact24(sim, 'returned-live-owner');
});

test('native lessor death inherits the returned business instead of leaving it on a dead asset holder', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, company = sim.state.extension!.companies[0];
  spousePremise(sim, 'citizen-6'); const total = cash(sim), shares = structuredClone(company.shareholders), capital = company.capital;
  sim.state.extension!.actorProfiles['citizen-6'].health = 0; record('lessor-native-death-before.save.json', sim.exportSave());
  for (let i = 0; i < 4; i++) sim.step(.25);
  record('lessor-native-death-after.save.json', sim.exportSave()); const estate = sim.state.family!.estates['citizen-6'];
  assert.equal(sim.state.extension!.actorProfiles['citizen-6'].alive, false); assert.deepEqual(estate.heirIds, ['player']);
  assert.equal(estate.businesses?.[shop.id], 'player', 'returned original business must be included in native estate');
  assert.equal(shopLifecycleAssetOwnerId(sim.state, shop), 'player'); assert.equal(shop.ownerId, 'player'); assert.equal(sim.shopOwnerId(shop), 'player');
  assert.deepEqual(company.shareholders, shares); assert.equal(company.capital, capital - 200); near(cash(sim), total); exact24(sim, 'returned-lessor-estate');
});

test('a live original lease cannot return an asset, overwrite its tenant or manufacture a release witness', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, lease = sim.state.shopLifecycle!.leases[0], company = sim.state.extension!.companies[0];
  const before = sim.exportSave(); assert.equal(sim.transferBusinessOwnership(shop.id, lease.lessorId), false); assert.equal(sim.exportSave(), before);
  assert.equal(shopLifecycleCanDispose(sim.state, shop.id), false); assert.equal(company.shopBindingReleasedAt, undefined);
  assert.equal(sim.state.shopLifecycle!.titles[shop.id].corporationHistory, undefined); exact24(sim, 'live-lease-no-release');
});

test('actual unpaid labor and signed future minutes retain the old employer account after lease exit', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, company = sim.state.extension!.companies[0];
  const begun = sim.command({ type: 'restartShop', targetId: shop.id }); assert.equal(begun.ok, true, begun.message);
  for (let i = 0; (sim.shopCommittedPayroll(shop) < 1e-7 || sim.shopPayrollDebt(shop) < 1e-7) && i < 300; i++) sim.step(.25);
  assert(sim.shopCommittedPayroll(shop) > 0, 'the original onsite employer must really authorize this payroll, no promise is inserted');
  assert(sim.shopPayrollDebt(shop) > 0, 'normal people movement must earn actual prior wage debt');
  const plan = structuredClone(runtime(sim).privateLabor.shifts[shop.id]), debt = sim.shopPayrollDebt(shop), total = cash(sim);
  const ended = sim.command({ type: 'endShopLease', targetId: shop.id }); assert.equal(ended.ok, true, ended.message); sim.step(.25);
  assert.equal(company.shopBindingReleasedAt, undefined); assert.equal(sim.state.shopLifecycle!.titles[shop.id].corporation!.companyId, company.id);
  assert.equal(sim.shopFunds(shop), company.capital); assert.equal(shopLifecycleCanDispose(sim.state, shop.id), false);
  assert.deepEqual(runtime(sim).privateLabor.shifts[shop.id], plan); near(sim.shopPayrollDebt(shop), debt); near(cash(sim), total);
  record('pending-real-wage-and-contract.save.json', sim.exportSave()); exact24(sim, 'pending-real-wage-and-contract');
});

test('a returned shop restarts from its actual original holder wallet and never consumes the detached company capital', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, company = sim.state.extension!.companies[0], seller = sim.state.citizens.find(c => c.id === 'citizen-6')!;
  const ended = sim.command({ type: 'endShopLease', targetId: shop.id }); assert.equal(ended.ok, true, ended.message); sim.step(.25);
  seller.position = { ...sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door }; // one original-holder arrival premise
  const total = cash(sim), capital = company.capital, wallet = seller.money, shopCash = sim.shopFunds(shop);
  const funded = applyShopLifecycleCommand(sim, { type: 'fundShop', targetId: shop.id, value: 20 }, seller.id)!; assert.equal(funded.ok, true, funded.message);
  assert.equal(seller.money, wallet - 20); near(sim.shopFunds(shop), shopCash + 20); assert.equal(company.capital, capital); near(cash(sim), total);
  const supplier = sim.state.shops.find(s => s.buildingId === 'workshop')!, stock = supplier.inventory;
  const reopened = applyShopLifecycleCommand(sim, { type: 'restartShop', targetId: shop.id }, seller.id)!; assert.equal(reopened.ok, true, reopened.message);
  assert.equal(supplier.inventory, stock - 1); assert.equal(sim.state.shopLifecycle!.titles[shop.id].reopen!.workedMinutes, 0);
  assert.equal(company.capital, capital); near(cash(sim), total); exact24(sim, 'returned-native-restart');
  assert.equal(company.capital, capital, 'detached company cannot fund new shop wages, material or receive its sales');
});

test('native tenant death retains the company shares for the heir and separately returns the landlord business', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, company = sim.state.extension!.companies[0];
  spousePremise(sim, 'citizen-6'); const total = cash(sim); sim.state.extension!.actorProfiles.player.health = 0;
  for (let i = 0; i < 4; i++) sim.step(.25);
  assert.equal(sim.state.family!.estates.player.shares[company.id], 1000); assert.equal(company.shareholders['citizen-6'], 1000); assert.equal(company.ownerId, 'citizen-6');
  assert.equal(company.capital, 300); assert.equal(shopLifecycleAssetOwnerId(sim.state, shop), 'citizen-6'); assert.equal(shopLifecycleCanDispose(sim.state, shop.id), true);
  assert.equal(sim.shopFunds(shop), shop.cash); near(cash(sim), total); exact24(sim, 'native-tenant-death');
});

test('a real heir may register the returned shop anew while the previous tenant company remains a separate entity', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, original = sim.state.extension!.companies[0];
  spousePremise(sim, 'citizen-6'); sim.state.extension!.actorProfiles['citizen-6'].health = 0; for (let i = 0; i < 4; i++) sim.step(.25);
  const total = cash(sim), priorCapital = original.capital, shares = structuredClone(original.shareholders), stock = shop.inventory;
  const registered = sim.command({ type: 'foundCompany', targetId: shop.buildingId, value: 300 }); assert.equal(registered.ok, true, registered.message);
  const active = sim.state.extension!.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)!;
  assert.notEqual(active.id, original.id); assert.equal(active.capital, 300); assert.equal(original.capital, priorCapital); assert.deepEqual(original.shareholders, shares);
  assert.equal(original.inventory, 0); assert.equal(shop.inventory, stock); assert.equal(sim.shopFunds(shop), active.capital); near(cash(sim), total);
  exact24(sim, 'returned-new-company');
});

test('deleted, duplicated or forged return history rejects atomically without reviving the old company site', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!; assert.equal(sim.command({ type: 'endShopLease', targetId: shop.id }).ok, true); sim.step(.25);
  const saved = sim.exportSave(), target = read(), mutations: ((s: any) => void)[] = [
    s => { delete s.state.shopLifecycle.titles[shop.id].corporationHistory; },
    s => { delete s.state.extension.companies[0].shopBindingReleasedAt; },
    s => { s.state.shopLifecycle.titles[shop.id].corporationHistory.push(s.state.shopLifecycle.titles[shop.id].corporationHistory[0]); },
    s => { s.state.shopLifecycle.receipts = s.state.shopLifecycle.receipts.filter((r: any) => r.kind !== 'corporate-site-return'); },
    s => { s.state.shopLifecycle.titles[shop.id].corporationHistory[0].release.at -= 1; },
    s => { s.state.shopLifecycle.titles[shop.id].corporationHistory[0].release.capital += 1; },
    s => { s.state.extension.companies[0].inventory = 1; },
    s => { s.state.shopLifecycle.leases[0].advanceRefunded -= 1; },
    s => { s.state.shopLifecycle.titles[shop.id].corporationHistory[0].release.wageDebt = 1; },
  ];
  for (let i = 0; i < mutations.length; i++) { const forged = JSON.parse(saved); mutations[i](forged); const before = target.exportSave(); assert.equal(target.importSave(JSON.stringify(forged)).ok, false, `return forgery ${i}`); assert.equal(target.exportSave(), before); record(`bad-return-${i}.json`, forged); }
  assert.equal(target.importSave(saved).ok, true); exact24(target, 'return-archive');
});


test('a later real tenant contract governs its own company shares without claiming the detached historical company', () => {
  const sim = read(), shop = sim.state.shops.find(s => s.id === 'shop-market')!, original = sim.state.extension!.companies[0];
  spousePremise(sim, 'citizen-6'); sim.state.extension!.actorProfiles['citizen-6'].health = 0; for (let i = 0; i < 4; i++) sim.step(.25);
  const buyer = sim.state.citizens.find(c => c.id === 'citizen-12')!, profile = sim.state.extension!.actorProfiles[buyer.id];
  assert.equal(buyer.role, '商人'); assert(profile.alive && profile.age >= 18 && profile.skill >= 45 && (buyer.education ?? 0) >= 1); assert(buyer.money >= 330 && buyer.needs.hunger >= 40 && buyer.needs.fatigue >= 35);
  buyer.position = { ...sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door }; // only one original qualified buyer/seller arrival premise
  const total = cash(sim), capital = original.capital, shares = structuredClone(original.shareholders);
  const listing = sim.command({ type: 'listShopForSale', targetId: shop.id, value: 10 }); assert.equal(listing.ok, true, listing.message);
  const sale = applyShopLifecycleCommand(sim, { type: 'buyShop', targetId: sim.state.shopLifecycle!.listings.at(-1)!.id }, buyer.id)!; assert.equal(sale.ok, true, sale.message);
  const offered = applyShopLifecycleCommand(sim, { type: 'listShopForLease', targetId: shop.id, value: 3 }, buyer.id)!; assert.equal(offered.ok, true, offered.message);
  const leased = sim.command({ type: 'leaseShop', targetId: sim.state.shopLifecycle!.listings.at(-1)!.id }); assert.equal(leased.ok, true, leased.message);
  const registered = sim.command({ type: 'foundCompany', targetId: shop.buildingId, value: 300 }); assert.equal(registered.ok, true, registered.message);
  const current = sim.state.extension!.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)!;
  const before = sim.exportSave(); const proposed = { ...original.shareholders, player: 0, [buyer.id]: original.shares };
  assert.equal(shopLifecycleAllowsShareholding(sim.state, original, proposed), true, 'the later personal lease cannot acquire control over the retained historical company');
  assert.equal(shopLifecycleAllowsShareholding(sim.state, current, { ...current.shareholders, player: 0, [buyer.id]: current.shares }), false, 'the actual new tenant still needs majority control of its own company');
  assert.equal(sim.exportSave(), before, 'proposed share queries are read-only'); assert.equal(original.capital, capital); assert.deepEqual(original.shareholders, shares); near(cash(sim), total);
  record('later-native-lease-and-company.save.json', sim.exportSave()); exact24(sim, 'later-lease-share-boundary');
});
