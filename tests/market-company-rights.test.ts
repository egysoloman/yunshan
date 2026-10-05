import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation';
import { applyShopLifecycleCommand, shopLifecycleHeldCash, shopLifecycleAllowsOperation, shopLifecycleAllowsSpaceUse } from '../src/simulation/shop_lifecycle';
import { bankingAvailableLoanCash } from '../src/simulation/banking';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import type { BuildingKind, Command, Shop, WorldDefinition } from '../src/types';

// PRE-constructor compact geometry. Qualification is one explicit player
// merchant fixture. All wallets, stock, NPC identities/needs and wages come
// from the original constructor; extra registration funds are actually earned.
function world(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: 'district', name: site.id, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const, length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261003, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '原市场公司权利验证', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
const runtime = (sim: Simulation): any => Reflect.get(sim, 'runtime');
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function ok(sim: Simulation, command: Command) { const result = sim.command(command); assert.equal(result.ok, true, result.message); }
function record(sim: Simulation, name: string, value: string | object = sim.exportSave()) {
  const directory = process.env.MARKET_COMPANY_ARTIFACT_ROOT; if (!directory) return;
  mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function cash(sim: Simulation) {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money + s.citizens.reduce((n, c) => n + c.money, 0)
    + s.shops.filter(shop => !e.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)).reduce((n, shop) => n + (shop.cash ?? 0), 0)
    + e.companies.reduce((n, c) => n + c.capital, 0) + e.organizations.reduce((n, org) => n + org.funds, 0)
    + s.banking!.cash + s.banking!.legacyInvestmentCash + shopLifecycleHeldCash(s)
    + s.family!.households.reduce((n, h) => n + h.balance, 0) + s.family!.pregnancies.reduce((n, p) => n + p.escrow, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.education?.course?.escrow ?? 0)
    + (s.clinical?.orders.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.hygiene?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + (s.power?.repairs.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.roadworks?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0);
}
function exact24(sim: Simulation, name: string) {
  const saved = sim.exportSave(); record(sim, name + '-before24.save.json', saved);
  assert.equal(assembleSave(partitionSave(saved, sim.worldDefinition)), saved);
  const next = new Simulation(sim.worldDefinition), loaded = next.importSave(saved);
  assert.equal(loaded.ok, true, loaded.message); assert.equal(next.exportSave(), saved);
  for (let i = 0; i < 24; i++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), `full saved continuation ${i + 1}`); }
  record(sim, name + '-after24.save.json');
}
function acquired(kind: 'sale' | 'lease') {
  const sim = new Simulation(world()), shop = sim.state.shops.find(shop => shop.buildingId === 'market')!;
  const events: unknown[] = []; for (const type of ['wage-earned', 'wage-paid', 'shop-contract-accepted', 'company-incorporated']) sim.onEvent(type, e => events.push(structuredClone(e)));
  sim.state.player.role = kind === 'sale' ? 'merchant' : 'traveler'; sim.state.player.identities = ['traveler', 'merchant']; // one explicit merchant qualification, never ownership or cash
  const initialCash = cash(sim), playerMoney = sim.state.player.money;
  const sellerId = shop.ownerId!, seller = sim.state.citizens.find(c => c.id === sellerId)!;
  const consent = () => {
    seller.position = { ...sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door }; // one initial actual seller fixture, no pin
    const stopped = applyShopLifecycleCommand(sim, { type: 'suspendShop', targetId: shop.id }, sellerId)!; assert.equal(stopped.ok, true, stopped.message);
    const offered = applyShopLifecycleCommand(sim, { type: kind === 'sale' ? 'listShopForSale' : 'listShopForLease', targetId: shop.id, value: kind === 'sale' ? 10 : 3 }, sellerId)!; assert.equal(offered.ok, true, offered.message);
    return sim.state.shopLifecycle!.listings.at(-1)!;
  };
  if (kind === 'sale') {
    sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === 'market')!.door, 'walk'); ok(sim, { type: 'work', targetId: 'market' });
    for (let i = 0; sim.state.playerLabor!.job && i < 300; i++) sim.step(.25);
    assert.equal(sim.state.playerLabor!.job, null); assert.equal(sim.state.playerLabor!.history.at(-1)!.workedMinutes, 60);
    near(sim.state.player.money, playerMoney + 62 * .92); near(cash(sim), initialCash);
  }
  // The lease starts before new shifts are promised; the old fully funded
  // lease below separately proves that registration cannot extract their cash.
  const listing = consent(); sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door, 'walk');
  const before = cash(sim); ok(sim, { type: kind === 'sale' ? 'buyShop' : 'leaseShop', targetId: listing.id }); near(cash(sim), before);
  if (kind === 'lease') {
    sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === 'bank')!.door, 'walk');
    for (let i = 0; bankingAvailableLoanCash(sim.state.banking!) < 10 && i < 300; i++) sim.step(.25);
    const beforeLoan = cash(sim), bankCash = sim.state.banking!.cash; ok(sim, { type: 'loan', targetId: 'bank', value: 10 });
    near(sim.state.banking!.cash, bankCash - 10); near(cash(sim), beforeLoan);
    sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door, 'walk');
  }
  assert.equal(shop.ownerId, 'player'); assert.ok(sim.state.player.money >= 350, 'ordinary paid work or an actual finite bank loan funds registration, never a wallet grant');
  record(sim, kind + '-acquired-before-company.save.json'); record(sim, kind + '-events.json', events);
  return { sim, shop, sellerId, seller, events };
}

test('a genuinely bought market registers its existing business with one company and keeps all original rights and cash', () => {
  const { sim, shop, events } = acquired('sale'), oldTitle = structuredClone(sim.state.shopLifecycle!.titles[shop.id]);
  const oldCash = sim.shopFunds(shop), total = cash(sim), wallet = sim.state.player.money, oldDebts = structuredClone(runtime(sim).wageAccruals), oldLots = structuredClone(sim.state.trade!.lots);
  const result = sim.command({ type: 'foundCompany', targetId: shop.buildingId, value: 300 }); record(sim, 'sale-found-result.json', result); assert.equal(result.ok, true, result.message);
  const company = sim.state.extension!.companies.find(c => c.buildingId === shop.buildingId)!;
  assert.equal(sim.state.player.money, wallet - 350); near(company.capital, 300 + oldCash); assert.equal(shop.cash, 0); near(cash(sim), total);
  assert.equal(company.shopBindingId, shop.id); assert.equal(sim.state.shopLifecycle!.titles[shop.id].assetOwnerId, oldTitle.assetOwnerId);
  assert.deepEqual(runtime(sim).wageAccruals, oldDebts); assert.deepEqual(sim.state.trade!.lots, oldLots);
  assert.equal(shopLifecycleAllowsOperation(sim.state, shop.id), false, 'registration does not skip actual reopening');
  record(sim, 'sale-incorporated.save.json'); exact24(sim, 'sale-incorporated');
  const materialSupplier = sim.state.shops.find(s => s.buildingId === 'workshop')!, beforeStock = materialSupplier.inventory;
  const beforeReopen = cash(sim); ok(sim, { type: 'restartShop', targetId: shop.id }); near(cash(sim), beforeReopen);
  const title = sim.state.shopLifecycle!.titles[shop.id], job = title.reopen!;
  assert.equal(materialSupplier.inventory, beforeStock - 1); assert.equal(job.workedMinutes, 0); assert.equal(title.materialsHeld, 1);
  for (let i = 0; job.completedAt === null && i < 800; i++) sim.step(.25);
  assert.equal(job.workedMinutes, 60); assert.equal(job.consumedUnits, 1); assert.equal(title.materialsHeld, 0);
  assert.ok(job.labor.length > 0 && job.labor.every(row => row.earned > 0 && row.minutes <= row.lastAt - job.startedAt + 1e-7));
  assert.equal(shopLifecycleAllowsOperation(sim.state, shop.id), true); near(cash(sim), beforeReopen);
  record(sim, 'sale-reopen-completed-before-meal.save.json');
  for (let i = 0; !shop.open && i < 40; i++) sim.step(.25);
  assert.ok(shop.open && shop.inventory >= 1, `normal commerce after actual repair: open=${shop.open}, inventory=${shop.inventory}`);
  const price = shop.price, beforeMeal = cash(sim), priorShopFunds = sim.shopFunds(shop), inventory = shop.inventory, walletBeforeMeal = sim.state.player.money;
  ok(sim, { type: 'purchase', targetId: shop.buildingId, value: 1 });
  assert.equal(shop.inventory, inventory - 1); near(sim.state.player.money, walletBeforeMeal - price); assert(sim.shopFunds(shop) > priorShopFunds); near(cash(sim), beforeMeal);
  record(sim, 'sale-reopened.save.json'); record(sim, 'sale-events.json', events); exact24(sim, 'sale-reopened');
});
test('a genuinely leased market keeps its real landlord and tenant claims when the tenant registers its company', () => {
  const { sim, shop, sellerId, seller, events } = acquired('lease'), lease = sim.state.shopLifecycle!.leases[0], originalLease = structuredClone(lease), originalCash = sim.shopFunds(shop), total = cash(sim);
  const result = sim.command({ type: 'foundCompany', targetId: shop.buildingId, value: 300 }); record(sim, 'lease-found-result.json', result); assert.equal(result.ok, true, result.message);
  const company = sim.state.extension!.companies.find(c => c.buildingId === shop.buildingId)!;
  const binding = sim.state.shopLifecycle!.titles[shop.id].corporation!;
  assert.equal(company.shopBindingId, shop.id); assert.equal(binding.leaseId, lease.id); assert.equal(binding.founderId, 'player');
  assert.equal(sim.state.shopLifecycle!.titles[shop.id].assetOwnerId, sellerId); assert.deepEqual(lease, originalLease);
  near(binding.ownerCashEscrow, Math.max(0, originalCash - lease.advanceInitial)); near(company.capital + binding.ownerCashEscrow, originalCash + 300); assert.equal(shop.cash, 0); near(cash(sim), total);
  record(sim, 'lease-incorporated.save.json'); exact24(sim, 'lease-incorporated');
  const landlordCash = seller.money, ownerRefund = binding.ownerCashEscrow, tenantDeposit = lease.depositEscrow, fundsBeforeEnd = company.capital, cashBeforeEnd = cash(sim), walletBeforeEnd = sim.state.player.money;
  ok(sim, { type: 'endShopLease', targetId: shop.id });
  near(seller.money, landlordCash + ownerRefund); near(sim.state.player.money, walletBeforeEnd + tenantDeposit);
  near(company.capital, fundsBeforeEnd); assert.equal(binding.ownerCashEscrow, 0); near(binding.ownerCashReturned, ownerRefund);
  assert.equal(lease.state, 'ended'); assert.equal(lease.advanceInitial, 200); assert.equal(lease.advanceRefunded, 0); assert.equal(shop.ownerId, sellerId);
  assert.equal(shopLifecycleAllowsSpaceUse(sim.state, shop.id), false); assert.equal(shopLifecycleAllowsOperation(sim.state, shop.id), false); near(cash(sim), cashBeforeEnd);
  for (const command of [{ type: 'restartShop', targetId: shop.id }, { type: 'listShopForSale', targetId: shop.id }, { type: 'foundCompany', targetId: shop.buildingId, value: 300 }] as Command[]) {
    const before = sim.exportSave(); assert.equal(sim.command(command).ok, false); assert.equal(sim.exportSave(), before);
  }
  record(sim, 'lease-ended-corporation.save.json'); record(sim, 'lease-events.json', events); exact24(sim, 'lease-ended-corporation');
});


test('true pre-binding purchase and lease saves import and continue without adding a company, marker, refund or money', () => {
  for (const kind of ['sale', 'lease']) {
    const saved = readFileSync(new URL(`./fixtures/market-company-old-${kind}.json`, import.meta.url), 'utf8'), sim = new Simulation(world());
    const result = sim.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), saved);
    assert.equal(sim.state.extension!.companies.some(c => c.shopBindingId), false); assert.equal(sim.state.shopLifecycle!.titles['shop-market'].corporation, undefined);
    exact24(sim, `old-${kind}-no-binding`);
  }
});

test('unowned markets and a previous asset owner cannot register or dispose the buyer corporation', () => {
  const sim = new Simulation(world()); sim.state.player.role = 'merchant'; sim.state.player.identities = ['traveler', 'merchant'];
  sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === 'market')!.door, 'walk');
  const initial = sim.exportSave(); assert.equal(sim.command({ type: 'foundCompany', targetId: 'market', value: 300 }).ok, false); assert.equal(sim.exportSave(), initial);
  const bought = acquired('sale'); ok(bought.sim, { type: 'foundCompany', targetId: bought.shop.buildingId, value: 300 });
  const before = bought.sim.exportSave(); const oldSellerAction = applyShopLifecycleCommand(bought.sim, { type: 'suspendShop', targetId: bought.shop.id }, bought.sellerId)!;
  assert.equal(oldSellerAction.ok, false); assert.equal(bought.sim.exportSave(), before);
  assert.equal(applyShopLifecycleCommand(bought.sim, { type: 'listShopForLease', targetId: bought.shop.id }, 'player')!.ok, false); assert.equal(bought.sim.exportSave(), before);
});

test('company/title/cash/lease corruption or deleting a new binding is rejected atomically', () => {
  for (const kind of ['sale', 'lease'] as const) {
    const { sim, shop } = acquired(kind); ok(sim, { type: 'foundCompany', targetId: shop.buildingId, value: 300 });
    const saved = sim.exportSave(), target = new Simulation(world()); assert.equal(target.importSave(saved).ok, true);
    const companyIndex = sim.state.extension!.companies.findIndex(c => c.buildingId === shop.buildingId);
    const mutations: ((s: any) => void)[] = [
      s => { delete s.state.extension.companies[companyIndex].shopBindingId; },
      s => { delete s.state.shopLifecycle.titles[shop.id].corporation; },
      s => { delete s.state.shopLifecycle; },
      s => { s.state.shopLifecycle.titles[shop.id].corporation.companyId = 'company-999'; },
      s => { s.state.extension.companies[companyIndex].shopBindingId = 'shop-farm'; },
      s => { s.state.shops.find((v: Shop) => v.id === shop.id).cash = 1; },
      s => { s.state.shopLifecycle.titles[shop.id].corporation.ownerCashEscrow += 1; },
      s => { s.state.shopLifecycle.titles[shop.id].corporation.capitalFunding += 1; },
      s => { s.state.shopLifecycle.titles[shop.id].corporation.registeredAt -= 1; },
      s => { s.state.shopLifecycle.titles[shop.id].corporation.leaseId = 'shop-lease-999'; },
    ];
    if (kind === 'lease') mutations.push(s => { const c = s.state.extension.companies[companyIndex]; c.shareholders = { player: 400, [s.state.shopLifecycle.leases[0].lessorId]: 600 }; c.ownerId = s.state.shopLifecycle.leases[0].lessorId; });
    for (let i = 0; i < mutations.length; i++) {
      const forged = JSON.parse(saved); mutations[i](forged); const before = target.exportSave();
      const loaded = target.importSave(JSON.stringify(forged)); assert.equal(loaded.ok, false, `${kind} forgery ${i}`); assert.equal(target.exportSave(), before);
      record(sim, `${kind}-bad-binding-${i}.json`, forged);
    }
  }
});


test('a live personal lease permits finite minority share trade but cannot silently transfer site control', () => {
  const { sim, shop, events } = acquired('lease'); ok(sim, { type: 'foundCompany', targetId: shop.buildingId, value: 300 });
  const company = sim.state.extension!.companies.find(c => c.buildingId === shop.buildingId)!, binding = structuredClone(sim.state.shopLifecycle!.titles[shop.id].corporation);
  // A real traveler work contract pays 35 from this company's cash; it does
  // not reuse the NPC repair wages. Its earned experience raises the native
  // bank credit limit, and all bank funding comes from real deposited cash.
  ok(sim, { type: 'restartShop', targetId: shop.id }); ok(sim, { type: 'work', targetId: shop.buildingId });
  const reopen = sim.state.shopLifecycle!.titles[shop.id].reopen!;
  for (let i = 0; (reopen.completedAt === null || sim.state.playerLabor!.job) && i < 800; i++) sim.step(.25);
  assert.equal(reopen.workedMinutes, 60); assert.equal(sim.state.playerLabor!.history.at(-1)!.workedMinutes, 60); assert.equal(sim.state.playerLabor!.history.at(-1)!.gross, 35);
  sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === 'bank')!.door, 'walk');
  const beforeLoan = cash(sim), bankCash = sim.state.banking!.cash; ok(sim, { type: 'loan', targetId: 'bank', value: 330 }); near(cash(sim), beforeLoan); near(sim.state.banking!.cash, bankCash - 330);
  sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === 'market')!.door, 'walk');
  ok(sim, { type: 'expandCompany', targetId: company.id, value: 100 });
  const job = Reflect.get(sim.state.extension!, 'runtime').constructionJobs[company.id];
  for (let i = 0; (job.completedAt === null || company.capital < 600) && i < 1200; i++) sim.step(.25);
  assert.equal(job.workedMinutes, 60); assert.equal(company.level, 2); assert.ok(company.capital >= 600, 'real subsequent sales fund listing, not a capital grant');
  sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === 'bank')!.door, 'walk'); ok(sim, { type: 'listCompany', targetId: company.id });
  const beforeTrade = cash(sim), holdings = company.shareholders.player, exchange = company.shareholders.exchange, capital = company.capital, wallet = sim.state.player.money;
  ok(sim, { type: 'sellShares', targetId: company.id, value: 10 }); ok(sim, { type: 'buyShares', targetId: company.id, value: 10 });
  assert.equal(company.shareholders.player, holdings); assert.equal(company.shareholders.exchange, exchange); near(company.capital, capital); near(sim.state.player.money, wallet); near(cash(sim), beforeTrade);
  const beforeControlChange = sim.exportSave(); const result = sim.command({ type: 'sellShares', targetId: company.id, value: 400 });
  assert.equal(result.ok, false); assert.match(result.message, /租约|承租/); assert.equal(sim.exportSave(), beforeControlChange);
  assert.deepEqual(sim.state.shopLifecycle!.titles[shop.id].corporation, binding); assert.equal(sim.state.shopLifecycle!.leases[0].tenantId, 'player');
  record(sim, 'lease-listed-minority-trade.save.json'); record(sim, 'lease-shares-events.json', events); exact24(sim, 'lease-listed-minority-trade');
});


test('leased registration cannot remove actual cash backing the old employer wage promises', () => {
  const saved = readFileSync(new URL('./fixtures/market-company-old-lease.json', import.meta.url), 'utf8'), sim = new Simulation(world());
  assert.equal(sim.importSave(saved).ok, true); const shop = sim.state.shops.find(s => s.id === 'shop-market')!;
  assert.ok(sim.shopPayrollDebt(shop) > 0); assert.ok(sim.shopProtectedFunds(shop) > 500, 'actual old public source, 60 ordinary minutes left real original wage promises');
  const prior = sim.exportSave(), supply = cash(sim), result = sim.command({ type: 'foundCompany', targetId: shop.buildingId, value: 300 });
  assert.equal(result.ok, false); assert.equal(sim.exportSave(), prior); near(cash(sim), supply);
  record(sim, 'legacy-funded-lease-registration-rejected.save.json');
});
