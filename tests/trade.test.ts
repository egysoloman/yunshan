import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation.ts';
import { installTrade, supplyConsignment, quoteSupply, recordOwnedStockPurchase, quoteConsignmentSale, settleConsignmentSale, returnConsignment, tradeSignals, type TradeState } from '../src/simulation/trade.ts';
import type { BuildingKind, Shop, WorldDefinition } from '../src/types.ts';

const evidence: Record<string, unknown>[] = [];
const artifactDir = new URL('../artifacts/', import.meta.url);
let initialHashes: Record<string, string>;
let industrialArchive: { capturedAt: string; productionTradeSha256: string; world: WorldDefinition; retailId: string; supplierId: string; moved: number; save: string };
async function sourceHashes() {
  const paths = ['src/simulation/trade.ts', 'src/simulation.ts', 'src/simulation/extensions.ts', 'src/simulation/family.ts', 'src/simulation/clinical.ts', 'src/simulation/banking.ts', 'src/simulation/player-labor.ts', 'src/types.ts', 'tests/trade.test.ts', 'tests/fixtures/trade-industrial-v1.json'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')])));
}
before(async () => { initialHashes = await sourceHashes(); industrialArchive = JSON.parse(await readFile(new URL('./fixtures/trade-industrial-v1.json', import.meta.url), 'utf8')); });
after(async () => { await mkdir(artifactDir, { recursive: true }); await writeFile(new URL(process.env.YUNSHAN_TRADE_EVIDENCE ?? 'trade-results.json', artifactDir), JSON.stringify({ at: new Date().toISOString(), environment: 'Node real Simulation commands, attendance accounting, onsite employer review and commerce stage; no WebGL', initialHashes, finalHashes: await sourceHashes(), evidence }, null, 2)); });

function world(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: site.districtId, name: site.id, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const,
    length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261001, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '寄售测试', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
const runtime = (simulation: Simulation) => Reflect.get(simulation, 'runtime');
const trade = (simulation: Simulation) => (simulation.state as typeof simulation.state & { trade: TradeState }).trade;
function fixture(owned = 0, producerStock = 40) {
  const simulation = new Simulation(world()); installTrade(simulation);
  const retail = simulation.state.shops.find(shop => shop.buildingId === 'market')!, supplier = simulation.state.shops.find(shop => shop.buildingId === 'farm')!;
  for (const shop of simulation.state.shops) shop.inventory = shop === retail ? owned : shop === supplier ? producerStock : 0;
  trade(simulation).ownedLots = {}; if (owned > 0) recordOwnedStockPurchase(simulation, retail.id, owned, 4);
  return { simulation, retail, supplier };
}
function moneySupply(simulation: Simulation) {
  const state = simulation.state, extension = state.extension!;
  return state.treasury + runtime(simulation).taxes + state.player.money + state.citizens.reduce((sum, actor) => sum + actor.money, 0)
    + state.shops.filter(shop => !extension.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + extension.companies.reduce((sum, company) => sum + company.capital, 0) + extension.organizations.reduce((sum, organization) => sum + organization.funds, 0)
    + (state.banking?.cash ?? 0) + (state.banking?.legacyInvestmentCash ?? 0) + (state.playerLabor?.job?.escrow ?? 0)
    + (state.family?.households.reduce((sum, account) => sum + account.balance, 0) ?? 0)
    + (state.family?.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0) ?? 0)
    + (state.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0);
}
function actualSale(simulation: Simulation, retail: Shop, quantity: number, price = 12) {
  const cost = price * quantity, beforeInventory = retail.inventory;
  assert(simulation.state.player.money >= cost); assert(beforeInventory >= quantity);
  const quote = quoteConsignmentSale(simulation, retail.id, quantity, beforeInventory);
  assert(cost * (1 - simulation.state.taxRate) >= quote.supplierGross);
  simulation.state.player.money -= cost; retail.inventory -= quantity;
  const receipt = settleConsignmentSale(simulation, retail.id, quantity, beforeInventory), net = cost * (1 - simulation.state.taxRate);
  assert.equal(receipt.supplierGross, quote.supplierGross);
  simulation.transferShopFunds(retail, net - receipt.supplierGross); retail.revenue += cost; retail.profit += net - receipt.inventoryCost;
  simulation.emitEvent({ type: 'sale', amount: cost, shopId: retail.id, districtId: retail.districtId, quantity, citizenId: 'player' });
  return receipt;
}

test('a 12 coin sale of 4 coin consigned goods splits one funded receipt without creating cash', () => {
  const { simulation, retail, supplier } = fixture(), supply = moneySupply(simulation), retailCash = simulation.shopFunds(retail), supplierCash = simulation.shopFunds(supplier), taxes = runtime(simulation).taxes;
  const inventory = simulation.state.shops.reduce((sum, shop) => sum + shop.inventory, 0), wages = structuredClone(runtime(simulation).wageArrears);
  assert.equal(supplyConsignment(simulation, retail.id, 20), 4);
  assert.equal(tradeSignals(simulation, supplier.id).sold, 0, 'custody transfer has no paid buyer receipt');
  assert.equal(moneySupply(simulation), supply); assert.equal(simulation.shopFunds(retail), retailCash); assert.equal(simulation.shopFunds(supplier), supplierCash);
  assert.equal(simulation.state.shops.reduce((sum, shop) => sum + shop.inventory, 0), inventory);
  const receipt = actualSale(simulation, retail, 1);
  assert.equal(tradeSignals(simulation, supplier.id).sold, 1, 'only the actual frozen-price supplier receipt records its sold unit');
  assert.equal(receipt.supplierGross, 4);
  assert(Math.abs(simulation.shopFunds(retail) - retailCash - 7.04) < 1e-8);
  assert(Math.abs(simulation.shopFunds(supplier) - supplierCash - 3.68) < 1e-8);
  assert(Math.abs(runtime(simulation).taxes - taxes - 1.28) < 1e-8);
  assert(Math.abs(moneySupply(simulation) - supply) < 1e-8);
  assert.equal(simulation.state.shops.reduce((sum, shop) => sum + shop.inventory, 0), inventory - 1);
  assert.deepEqual(runtime(simulation).wageArrears, wages);
});

test('owned goods sell first and fractional owned stock keeps its actual ownership', () => {
  const { simulation, retail, supplier } = fixture(2), supplierCash = simulation.shopFunds(supplier);
  assert.equal(supplyConsignment(simulation, retail.id, 10), 2);
  assert.equal(actualSale(simulation, retail, 2).supplierGross, 0); assert.equal(simulation.shopFunds(supplier), supplierCash);
  assert.equal(actualSale(simulation, retail, 1).supplierGross, 4);
  assert.equal(trade(simulation).lots[retail.id][0].quantity, 1);
  const fractional = fixture(.5), cash = moneySupply(fractional.simulation);
  assert.equal(supplyConsignment(fractional.simulation, fractional.retail.id, 10), 3);
  assert.equal(actualSale(fractional.simulation, fractional.retail, 1).supplierGross, 2);
  assert.equal(trade(fractional.simulation).lots[fractional.retail.id][0].quantity, 2.5);
  assert(Math.abs(moneySupply(fractional.simulation) - cash) < 1e-8);
  const restored = new Simulation(fractional.simulation.worldDefinition); installTrade(restored);
  const result = restored.importSave(fractional.simulation.exportSave()); assert(result.ok, result.message);
  assert.equal(restored.exportSave(), fractional.simulation.exportSave());
});

test('an unsold lot returns to the same producer without transferring owned goods or earned wages', () => {
  const { simulation, retail, supplier } = fixture(2), supply = moneySupply(simulation), sourceStock = supplier.inventory;
  const worker = simulation.state.citizens.find(actor => actor.workId === retail.buildingId && actor.role !== '学生')!;
  simulation.emitEvent({ type: 'wage', citizenId: worker.id, shopId: retail.id, districtId: retail.districtId, amount: 20 });
  const wages = structuredClone(runtime(simulation).wages), owner = retail.ownerId;
  assert.equal(supplyConsignment(simulation, retail.id, 10), 2); const id = trade(simulation).lots[retail.id][0].id;
  assert.equal(returnConsignment(simulation, retail.id, 1), 1); assert.equal(trade(simulation).lots[retail.id][0].id, id);
  assert.equal(returnConsignment(simulation, retail.id), 1); assert.equal(retail.inventory, 2); assert.equal(supplier.inventory, sourceStock);
  assert.equal(trade(simulation).lots[retail.id], undefined); assert.equal(retail.ownerId, owner);
  assert.deepEqual(runtime(simulation).wages, wages); assert.equal(moneySupply(simulation), supply);
});

test('no producer stock gives no supply and repeated requests without customers stay within the small trial', () => {
  const empty = fixture(0, 0), snapshot = empty.simulation.exportSave(), supply = moneySupply(empty.simulation);
  assert.equal(supplyConsignment(empty.simulation, empty.retail.id, 70), 0); assert.equal(empty.retail.inventory, 0); assert.equal(moneySupply(empty.simulation), supply);
  assert.equal(tradeSignals(empty.simulation, empty.retail.id).shortages, 4);
  assert.equal(supplyConsignment(empty.simulation, empty.retail.id, NaN), 0);
  assert.equal(supplyConsignment(empty.simulation, empty.retail.id, -10), 0);
  const existing = fixture(0, 100);
  for (let i = 0; i < 20; i++) supplyConsignment(existing.simulation, existing.retail.id, 70);
  assert.equal(existing.retail.inventory, 4); assert.equal(existing.supplier.inventory, 96);
  assert.equal(tradeSignals(existing.simulation, existing.retail.id).sold, 0);
  assert(snapshot.length > 0);
});

test('recent demand and labour are measured from actual quantities and expire on the monotonic clock', () => {
  const { simulation, retail } = fixture(0, 100);
  for (let i = 0; i < 12; i++) { supplyConsignment(simulation, retail.id, 70); actualSale(simulation, retail, 1); }
  assert.equal(tradeSignals(simulation, retail.id).sold, 12);
  supplyConsignment(simulation, retail.id, 70); assert.equal(retail.inventory, 12);
  simulation.emitEvent({ type: 'wage-earned', shopId: retail.id, minutes: 30, amount: 2 });
  simulation.emitEvent({ type: 'production', shopId: retail.id, minutes: 30, amount: .75 });
  assert.equal(tradeSignals(simulation, retail.id).labor, 30); assert.equal(tradeSignals(simulation, retail.id).produced, .75);
  simulation.emitEvent({ type: 'sale', shopId: retail.id, amount: 100 });
  assert.equal(tradeSignals(simulation, retail.id).sold, 12, 'an amount without units cannot invent customer demand');
  simulation.state.extension!.lastUpdate += 200;
  assert.equal(tradeSignals(simulation, retail.id).sold, 0);
  assert.equal(supplyConsignment(simulation, retail.id, 70), 0, 'old unsold stock remains in place instead of being relabelled or duplicated');
});

test('live custody saves exactly, malformed lots reject atomically and legacy saves create an empty book', () => {
  const { simulation, retail, supplier } = fixture(); supplyConsignment(simulation, retail.id, 4); actualSale(simulation, retail, 1);
  const json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition); installTrade(restored);
  const result = restored.importSave(json); assert(result.ok, result.message); assert.equal(restored.exportSave(), json);
  const changes = [
    (document: any) => { document.state.trade.lots[retail.id][0].supplierId = 'missing-supplier'; },
    (document: any) => { document.state.trade.lots[retail.id][0].quantity = retail.inventory + 1; },
    (document: any) => { document.state.trade.lots[retail.id][0].unitPrice = 0; },
    (document: any) => { document.state.trade.lots[retail.id].push({ ...document.state.trade.lots[retail.id][0] }); },
    (document: any) => { document.state.trade.stats.suppliedUnits += 1; },
    (document: any) => { document.state.trade.activity[retail.id][0].sold = -1; },
  ];
  for (const change of changes) {
    const document = JSON.parse(json); change(document);
    assert.equal(restored.importSave(JSON.stringify(document)).ok, false); assert.equal(restored.exportSave(), json);
  }
  const missingModernModule = JSON.parse(json); delete missingModernModule.state.trade;
  assert.equal(restored.importSave(JSON.stringify(missingModernModule)).ok, false); assert.equal(restored.exportSave(), json);
  // A genuine archive predates the module manifest and has no consigned
  // ownership to erase. Its already owned inventory is only given cost metadata.
  const old = fixture(retail.inventory, supplier.inventory), legacy = JSON.parse(old.simulation.exportSave()); delete legacy.state.trade; delete legacy.runtime.persistedModules;
  const legacyResult = restored.importSave(JSON.stringify(legacy)); assert.equal(legacyResult.ok, true, legacyResult.message); assert.deepEqual(trade(restored).lots, {});
  assert.equal(restored.state.shops.find(shop => shop.id === retail.id)!.inventory, retail.inventory);
  assert.equal(restored.state.shops.find(shop => shop.id === supplier.id)!.inventory, supplier.inventory);
});

test('a rejected settlement cannot mutate lot ownership or supplier accounts', () => {
  const { simulation, retail, supplier } = fixture(); supplyConsignment(simulation, retail.id, 4);
  const snapshot = simulation.exportSave(), funds = simulation.shopFunds(supplier);
  assert.throws(() => settleConsignmentSale(simulation, retail.id, 1, retail.inventory), /库存扣减/);
  assert.equal(simulation.exportSave(), snapshot); assert.equal(simulation.shopFunds(supplier), funds);
});

test('quotations are read-only and preflight supplier capacity before any buyer debit', () => {
  const { simulation, retail, supplier } = fixture(); supplyConsignment(simulation, retail.id, 4);
  const snapshot = simulation.exportSave(); assert.equal(quoteConsignmentSale(simulation, retail.id, 1, retail.inventory).supplierGross, 4); assert.equal(simulation.exportSave(), snapshot);
  simulation.state.taxRate = .3; const lowMargin = simulation.exportSave(), quote = quoteConsignmentSale(simulation, retail.id, 1, retail.inventory);
  assert(5 * (1 - simulation.state.taxRate) < quote.supplierGross, 'the core can reject an unfunded wholesale split before touching cash');
  assert.equal(simulation.exportSave(), lowMargin);
  supplier.cash = 1e9; const capped = simulation.exportSave();
  assert.throws(() => quoteConsignmentSale(simulation, retail.id, 1, retail.inventory), /现金上限/);
  assert.equal(simulation.exportSave(), capped);
});

test('real purchase and ingredient commands split consigned receipts and persist their actual sale quantities', () => {
  const { simulation, retail, supplier } = fixture();
  simulation.state.player.position = { ...simulation.worldDefinition.buildings.find(site => site.id === retail.buildingId)!.door };
  retail.price = 12; assert.equal(simulation.supplyConsignment(retail.id, 4), 4);
  const cash = moneySupply(simulation), buyer = simulation.state.player.money, source = simulation.shopFunds(supplier), shop = simulation.shopFunds(retail), taxes = runtime(simulation).taxes;
  let consumed = 0; simulation.onEvent('food-consumed', event => { if (event.citizenId === 'player') consumed += event.amount ?? 0; });
  const food = simulation.command({ type: 'purchase', targetId: retail.id, value: 1 }); assert(food.ok, food.message);
  const ingredient = simulation.command({ type: 'buyIngredient', targetId: 'grain', value: 2 }); assert(ingredient.ok, ingredient.message);
  assert.equal(buyer - simulation.state.player.money, 28);
  assert.equal(simulation.state.player.inventory.food, 0); assert.equal(consumed, 1); assert.equal(simulation.state.player.needs.hunger, 100); assert.equal(simulation.state.player.inventory['ingredient:grain'], 2);
  assert.equal(retail.inventory, 1); assert.equal(trade(simulation).lots[retail.id][0].quantity, 1);
  assert(Math.abs(simulation.shopFunds(supplier) - source - 12 * .92) < 1e-8);
  assert(Math.abs(simulation.shopFunds(retail) - shop - (28 * .92 - 12)) < 1e-8);
  assert(Math.abs(runtime(simulation).taxes - taxes - (28 + 12) * .08) < 1e-8);
  assert(Math.abs(moneySupply(simulation) - cash) < 1e-8); assert.equal(tradeSignals(simulation, retail.id).sold, 3);
  evidence.push({ check: 'actual-food-and-ingredient-commands', buyerSpent: buyer - simulation.state.player.money, retailReceived: simulation.shopFunds(retail) - shop, supplierReceived: simulation.shopFunds(supplier) - source, taxesQueued: runtime(simulation).taxes - taxes, cashResidual: moneySupply(simulation) - cash, physicalStock: retail.inventory, soldUnits: tradeSignals(simulation, retail.id).sold, consumedFood: consumed });
  const json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition), loaded = restored.importSave(json);
  assert(loaded.ok, loaded.message); assert.equal(restored.exportSave(), json);
});

test('the real NPC commerce stage pays the supplier from its shopper receipt without an extra transfer', () => {
  const { simulation, retail, supplier } = fixture(); retail.cash = 0; retail.price = 12;
  assert.equal(simulation.supplyConsignment(retail.id, 4), 4);
  const customer = simulation.state.citizens[3], site = simulation.worldDefinition.buildings.find(site => site.id === retail.buildingId)!;
  customer.position = { ...site.door }; customer.destinationId = site.id; customer.state = 'shopping'; customer.needs.hunger = 30; customer.food = 1;
  const r = runtime(simulation); r.customers = { [customer.id]: retail.id }; r.shopLabor = {}; r.freight = {}; r.commerceAt = simulation.state.day * 1440 + simulation.state.hour * 60;
  const cash = moneySupply(simulation), buyer = customer.money, source = simulation.shopFunds(supplier), taxes = r.taxes;
  Reflect.get(simulation, 'commerce').call(simulation);
  assert.equal(buyer - customer.money, 12); assert.equal(retail.inventory, 3); assert.equal(customer.food, 1);
  assert(Math.abs(simulation.shopFunds(retail) - 7.04) < 1e-8);
  assert(Math.abs(simulation.shopFunds(supplier) - source - 3.68) < 1e-8);
  assert(Math.abs(r.taxes - taxes - 1.28) < 1e-8); assert(Math.abs(moneySupply(simulation) - cash) < 1e-8);
  assert.equal(tradeSignals(simulation, retail.id).sold, 1); assert.equal(trade(simulation).stats.settledUnits, 1);
});

test('real commands reject unfunded wholesale margins and capped suppliers before any wallet or inventory change', () => {
  const { simulation, retail, supplier } = fixture(); simulation.supplyConsignment(retail.id, 4);
  simulation.state.player.position = { ...simulation.worldDefinition.buildings.find(site => site.id === retail.buildingId)!.door };
  simulation.state.taxRate = .3; retail.price = 5;
  const lowMargin = simulation.exportSave(); assert.equal(simulation.command({ type: 'purchase', targetId: retail.id, value: 1 }).ok, false); assert.equal(simulation.exportSave(), lowMargin);
  supplier.cash = 1e9; const capped = simulation.exportSave();
  assert.equal(simulation.command({ type: 'buyIngredient', targetId: 'grain', value: 1 }).ok, false); assert.equal(simulation.exportSave(), capped);
});

function authorizeOneWorker(simulation: Simulation, supplier: Shop) {
  const worker = simulation.state.citizens.find(actor => actor.workId === supplier.buildingId && actor.role !== '学生' && simulation.state.extension!.actorProfiles[actor.id].age >= 18)!;
  const owner = supplier.ownerId === 'player' ? simulation.state.player : simulation.state.citizens.find(actor => actor.id === supplier.ownerId)!;
  const door = simulation.worldDefinition.buildings.find(site => site.id === supplier.buildingId)!.door;
  owner.position = { ...door }; owner.needs.hunger = 80; owner.needs.fatigue = 80; supplier.employees = 1;
  Reflect.get(simulation, 'reviewPrivateShifts').call(simulation);
  const assignment = runtime(simulation).privateLabor.shifts[supplier.id].assignments.find((item: any) => item.citizenId === worker.id);
  assert.equal(assignment.minutesCap, 480, 'the real onsite employer reserves this finite shift from its existing cash');
  return worker;
}
function observedProduction(simulation: Simulation, supplier: Shop) {
  simulation.state.districts[0].prosperity = 68;
  const worker = authorizeOneWorker(simulation, supplier);
  worker.position = { ...simulation.worldDefinition.buildings.find(site => site.id === supplier.buildingId)!.door }; worker.state = 'working';
  simulation.state.districts[0].energy = 56; simulation.state.districts[0].prosperity = 68;
  simulation.state.extension!.technologies.find(technology => technology.sector === 'manufacturing')!.level = 0;
  simulation.state.extension!.technologies.find(technology => technology.sector === 'agriculture')!.level = 0;
  const r = runtime(simulation); r.attendance = {}; r.shopLabor = {}; r.commerceAt = simulation.state.day * 1440 + simulation.state.hour * 60 - 470;
  Reflect.get(simulation, 'registerAttendance').call(simulation, worker, 480);
  Reflect.get(simulation, 'commerce').call(simulation);
}

test('producer quotes use real earned attendance, 56 percent energy production and paid utilities without mutating accounts', () => {
  const { simulation, retail, supplier } = fixture(0, 0); retail.cash = 0;
  observedProduction(simulation, supplier);
  const observed = tradeSignals(simulation, supplier.id), snapshot = simulation.exportSave(), quote = quoteSupply(simulation, supplier.id, 100);
  assert.equal(observed.labor, 480); assert(Math.abs(observed.earnedLaborCost - 44.16) < 1e-8); assert(Math.abs(observed.produced - 8.96) < 1e-8);
  assert(Math.abs(observed.actualUtilities - 20 / 3) < 1e-8);
  assert(Math.abs(quote.quantity - 8.96) < 1e-8); assert.equal(quote.unitPrice, 6.17);
  assert(quote.unitPrice * .92 * quote.costWindowUnits >= quote.earnedLaborCost + quote.actualUtilities);
  assert(4 * .92 * quote.costWindowUnits < quote.earnedLaborCost, 'the previous fixed offer fails even before utilities');
  assert.equal(simulation.exportSave(), snapshot, 'quotes cannot capitalize costs, erase wages or inject money');
  evidence.push({ check: 'onsite-funded-shift-production-cost-quote', laborMinutes: observed.labor, energy: simulation.state.districts[0].energy, ...quote, quoteUnchangedSave: simulation.exportSave() === snapshot });
  simulation.state.extension!.lastUpdate += 200;
  const oldInventory = quoteSupply(simulation, supplier.id, 100); assert.equal(oldInventory.unitPrice, 4); assert.equal(oldInventory.quantity, supplier.inventory);
  assert.equal(oldInventory.costWindowUnits, 0);
  const idle = fixture(0, 40); const worker = authorizeOneWorker(idle.simulation, idle.supplier);
  Reflect.get(idle.simulation, 'registerAttendance').call(idle.simulation, worker, 30);
  const idleQuote = quoteSupply(idle.simulation, idle.supplier.id, 4); assert.equal(idleQuote.quantity, 4); assert.equal(idleQuote.unitPrice, 4); assert(idleQuote.earnedLaborCost > 0);
});

test('old 4 coin custody contracts remain frozen beside new observed-price lots and settle their exact prices', () => {
  const { simulation, retail, supplier } = fixture(0, 4); retail.cash = 0; retail.price = 12;
  assert.equal(supplyConsignment(simulation, retail.id, 4), 4); const oldId = trade(simulation).lots[retail.id][0].id;
  actualSale(simulation, retail, 1); retail.cash = 0;
  observedProduction(simulation, supplier); const offered = quoteSupply(simulation, supplier.id, 1);
  assert.equal(offered.unitPrice, 6.17); assert.equal(supplyConsignment(simulation, retail.id, 1), 1);
  const lots = trade(simulation).lots[retail.id]; assert.equal(lots[0].id, oldId); assert.equal(lots[0].unitPrice, 4); assert.equal(lots[0].quantity, 3); assert.equal(lots[1].unitPrice, 6.17);
  assert.equal(actualSale(simulation, retail, 3).inventoryCost, 12);
  const before = simulation.shopFunds(supplier), profit = retail.profit, cash = moneySupply(simulation);
  const sale = actualSale(simulation, retail, 1); assert.equal(sale.supplierGross, 6.17); assert.equal(sale.inventoryCost, 6.17);
  assert(Math.abs(simulation.shopFunds(supplier) - before - 6.17 * .92) < 1e-8); assert(Math.abs(retail.profit - profit - (12 * .92 - 6.17)) < 1e-8);
  assert(Math.abs(moneySupply(simulation) - cash) < 1e-8); assert.deepEqual(trade(simulation).stats.settlementsByPrice, { '4.00': 4, '6.17': 1 });
  const json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition), imported = restored.importSave(json);
  assert(imported.ok, imported.message); assert.equal(restored.exportSave(), json);
  const bad = JSON.parse(json); bad.state.trade.stats.settlementsByPrice['6.17'] += 1;
  assert.equal(restored.importSave(JSON.stringify(bad)).ok, false); assert.equal(restored.exportSave(), json);
});

test('paid owned stock records actual purchase cost once, sells FIFO and rejects inconsistent save bases atomically', () => {
  const { simulation, retail, supplier } = fixture(2); const cash = moneySupply(simulation), source = simulation.shopFunds(supplier), profit = retail.profit;
  const quantity = 3, unitPrice = 6.17, gross = quantity * unitPrice;
  simulation.transferShopFunds(retail, -gross); simulation.transferShopFunds(supplier, gross * .92); supplier.inventory -= quantity; retail.inventory += quantity;
  simulation.emitEvent({ type: 'wholesale', shopId: supplier.id, districtId: supplier.districtId, amount: gross, quantity });
  recordOwnedStockPurchase(simulation, retail.id, quantity, unitPrice);
  assert.equal(retail.profit, profit); assert(Math.abs(simulation.shopFunds(supplier) - source - gross * .92) < 1e-8); assert(Math.abs(moneySupply(simulation) - cash) < 1e-8);
  const quote = quoteConsignmentSale(simulation, retail.id, 3, retail.inventory); assert.equal(quote.supplierGross, 0); assert.equal(quote.inventoryCost, 14.17);
  const supplierBeforeSale = simulation.shopFunds(supplier), receipt = actualSale(simulation, retail, 3);
  assert.equal(receipt.inventoryCost, 14.17); assert.equal(simulation.shopFunds(supplier), supplierBeforeSale); assert(Math.abs(retail.profit - profit - (36 * .92 - 14.17)) < 1e-8);
  assert.equal(trade(simulation).ownedLots![retail.id][0].quantity, 2); assert.equal(trade(simulation).ownedLots![retail.id][0].unitPrice, 6.17);
  const json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition); assert.equal(restored.importSave(json).ok, true); assert.equal(restored.exportSave(), json);
  for (const invalid of [(data: any) => data.state.trade.ownedLots[retail.id][0].quantity++, (data: any) => data.state.trade.ownedLots[retail.id][0].unitPrice = 0]) {
    const data = JSON.parse(json); invalid(data); assert.equal(restored.importSave(JSON.stringify(data)).ok, false); assert.equal(restored.exportSave(), json);
  }
  const missingStock = simulation.exportSave(); assert.throws(() => recordOwnedStockPurchase(simulation, retail.id, 1, 4), /真实库存增加/); assert.equal(simulation.exportSave(), missingStock);
});

test('legacy custody and owned inventory gain only historical cost metadata and keep all past profits and debts', () => {
  const { simulation, retail } = fixture(2); supplyConsignment(simulation, retail.id, 4); actualSale(simulation, retail, 1);
  const old = JSON.parse(simulation.exportSave()); old.state.trade.version = 1; delete old.state.trade.legacyIndustrialLotIds; delete old.state.trade.ownedLots; delete old.state.trade.stats.settlementsByPrice;
  for (const rows of Object.values(old.state.trade.activity) as any[][]) for (const row of rows) { delete row.earnedLaborCost; delete row.actualUtilities; }
  const restored = new Simulation(simulation.worldDefinition), result = restored.importSave(JSON.stringify(old)); assert(result.ok, result.message);
  const market = restored.state.shops.find(shop => shop.id === retail.id)!;
  assert.equal(market.profit, retail.profit); assert.equal(market.cash, retail.cash); assert.equal(market.inventory, retail.inventory);
  assert.deepEqual(runtime(restored).wageArrears, runtime(simulation).wageArrears);
  assert.equal(trade(restored).ownedLots![retail.id][0].quantity, 1); assert.equal(trade(restored).ownedLots![retail.id][0].unitPrice, 4);
  assert.equal(trade(restored).lots[retail.id][0].unitPrice, 4);
  actualSale(restored, market, 2); assert.deepEqual(trade(restored).stats.settlementsByPrice, { '4.00': 1 });
});

test('real observed-price wholesale purchases feed FIFO costs into actual player sales once', () => {
  const { simulation, retail, supplier } = fixture(0, 0); retail.cash = 0; observedProduction(simulation, supplier);
  retail.cash = 1000; const quote = quoteSupply(simulation, supplier.id, 70), bought = Math.floor(quote.quantity), gross = bought * quote.unitPrice;
  const cash = moneySupply(simulation), source = simulation.shopFunds(supplier), shop = simulation.shopFunds(retail), taxes = runtime(simulation).taxes;
  runtime(simulation).commerceAt = simulation.state.day * 1440 + simulation.state.hour * 60;
  Reflect.get(simulation, 'commerce').call(simulation);
  assert.equal(retail.inventory, bought); assert.equal(trade(simulation).ownedLots![retail.id][0].quantity, bought); assert.equal(trade(simulation).ownedLots![retail.id][0].unitPrice, 6.17);
  assert(Math.abs(simulation.shopFunds(retail) - shop + gross) < 1e-8); assert(Math.abs(simulation.shopFunds(supplier) - source - gross * .92) < 1e-8);
  assert(Math.abs(runtime(simulation).taxes - taxes - gross * .08) < 1e-8); assert(Math.abs(moneySupply(simulation) - cash) < 1e-8);
  simulation.state.player.position = { ...simulation.worldDefinition.buildings.find(site => site.id === retail.buildingId)!.door };
  const price = retail.price, profit = retail.profit, supplierBeforeSale = simulation.shopFunds(supplier);
  const sale = simulation.command({ type: 'purchase', targetId: retail.id, value: 3 }); assert(sale.ok, sale.message);
  assert.equal(retail.inventory, bought - 3); assert(Math.abs(retail.profit - profit - (price * 3 * .92 - 6.17 * 3)) < 1e-8);
  assert.equal(simulation.shopFunds(supplier), supplierBeforeSale, 'a paid supplier must not receive a second consignment receipt');
  assert(Math.abs(moneySupply(simulation) - cash) < 1e-8);
  evidence.push({ check: 'real-dynamic-wholesale-then-purchase', purchasedUnits: bought, purchaseUnitPrice: quote.unitPrice, purchaseGross: gross, soldUnits: 3, consumerGross: price * 3, inventoryCost: quote.unitPrice * 3, retailProfitChange: retail.profit - profit, supplierSecondReceipt: simulation.shopFunds(supplier) - supplierBeforeSale, cashResidual: moneySupply(simulation) - cash, remainingStock: retail.inventory });
  const json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition); const result = restored.importSave(json); assert(result.ok, result.message); assert.equal(restored.exportSave(), json);
});

test('real wholesale respects the buyer budget and supplier credit capacity before stock or funds change', () => {
  for (const cappedSupplier of [false, true]) {
    const { simulation, retail, supplier } = fixture(0, 0); retail.cash = 0; observedProduction(simulation, supplier);
    retail.inventory = 5; recordOwnedStockPurchase(simulation, retail.id, 5, 4);
    retail.cash = cappedSupplier ? 1000 : 6.16; if (cappedSupplier) supplier.cash = 1e9;
    assert.equal(quoteSupply(simulation, supplier.id, 1).unitPrice, 6.17); assert(supplier.inventory >= 1, 'the budget rejection must exercise real available producer goods');
    const snapshot = () => JSON.stringify({ money: moneySupply(simulation), shop: simulation.shopFunds(retail), source: simulation.shopFunds(supplier), stock: [retail.inventory, supplier.inventory], basis: trade(simulation).ownedLots, custody: trade(simulation).lots, taxes: runtime(simulation).taxes, wages: runtime(simulation).wageAccruals });
    const before = snapshot(); runtime(simulation).commerceAt = simulation.state.day * 1440 + simulation.state.hour * 60;
    Reflect.get(simulation, 'commerce').call(simulation);
    assert.equal(snapshot(), before, cappedSupplier ? 'a capped supplier cannot destroy the buyer paid gross through clamping' : 'a quote above spendable cash cannot become a purchase');
  }
});

test('market player work pays a real service wage without creating goods or charging their cost twice', () => {
  const { simulation, retail } = fixture(2);
  const investor = simulation.state.citizens.find(actor => actor.money >= 200)!;
  investor.money -= 200; simulation.transferShopFunds(retail, 200);
  simulation.state.player.needs = { hunger: 95, fatigue: 95, social: 90, fun: 90 };
  simulation.setFocus(simulation.worldDefinition.buildings.find(site => site.id === retail.buildingId)!.door, 'walk');
  const pay = simulation.payPlayerLabor.bind(simulation), payments: { gross: number; minutes: number; profitChange: number; stockChange: number; basisUnchanged: boolean }[] = [];
  simulation.payPlayerLabor = (job, gross, minutes, interval) => {
    const profitBefore = retail.profit, stockBefore = retail.inventory, basisBefore = JSON.stringify(trade(simulation).ownedLots);
    pay(job, gross, minutes, interval);
    const receipt = { gross, minutes, profitChange: retail.profit - profitBefore, stockChange: retail.inventory - stockBefore, basisUnchanged: JSON.stringify(trade(simulation).ownedLots) === basisBefore };
    assert(Math.abs(receipt.profitChange + gross) < 1e-8); assert.equal(receipt.stockChange, 0); assert.equal(receipt.basisUnchanged, true); payments.push(receipt);
  };
  const stock = retail.inventory, basis = JSON.stringify(trade(simulation).ownedLots), cash = moneySupply(simulation), profit = retail.profit, funds = simulation.shopFunds(retail), buyer = simulation.state.player.money;
  const worked = simulation.command({ type: 'work', targetId: retail.buildingId }); assert(worked.ok, worked.message);
  assert.equal(retail.inventory, stock); assert.equal(JSON.stringify(trade(simulation).ownedLots), basis); assert.equal(retail.profit, profit);
  assert.equal(simulation.state.player.money, buyer); assert.equal(simulation.state.playerLabor!.job!.escrow, 35);
  assert(Math.abs(simulation.shopFunds(retail) - funds + 35) < 1e-8); assert(Math.abs(moneySupply(simulation) - cash) < 1e-8);
  for (let tick = 0; tick < 239; tick++) simulation.step(.25);
  assert.equal(simulation.state.playerLabor!.job!.workedMinutes, 59.75); assert.equal(simulation.state.playerLabor!.stats.completed, 0);
  simulation.step(.25);
  assert.equal(simulation.state.playerLabor!.job, null); assert.equal(simulation.state.playerLabor!.stats.completed, 1);
  const ended = simulation.state.playerLabor!.history.at(-1)!; assert.equal(ended.workedMinutes, 60); assert.equal(ended.paidGross, 35); assert(Math.abs(ended.paidNet - 32.2) < 1e-8);
  const paid = payments.reduce((sum, payment) => sum + payment.gross, 0), expensed = payments.reduce((sum, payment) => sum - payment.profitChange, 0);
  assert.equal(payments.length, 240); assert(Math.abs(paid - 35) < 1e-8); assert(Math.abs(expensed - 35) < 1e-8);
  assert(Math.abs(simulation.state.player.money - buyer - 32.2) < 1e-8); assert(Math.abs(moneySupply(simulation) - cash) < 1e-8);
  assert.equal(tradeSignals(simulation, retail.id).produced, 0); assert(tradeSignals(simulation, retail.id).earnedLaborCost >= 35 - 1e-8);
  const json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition); assert.equal(restored.importSave(json).ok, true); assert.equal(restored.exportSave(), json);
  evidence.push({ check: 'real-sixty-minute-market-service-work', startedEscrow: 35, workedMinutes: ended.workedMinutes, paidGross: ended.paidGross, paidNet: ended.paidNet, paidTax: ended.paidTax, producedUnits: tradeSignals(simulation, retail.id).produced, actualPayments: payments.length, actualExpense: expensed, stockChangesAtPayment: payments.reduce((sum, payment) => sum + Math.abs(payment.stockChange), 0), basisUnchangedAtAllPayments: payments.every(payment => payment.basisUnchanged), cashResidual: moneySupply(simulation) - cash });
});

test('new food consignments exclude existing industrial stock while material quotes remain available', () => {
  const { simulation, retail, supplier: farm } = fixture(0, 0), industrial = simulation.state.shops.find(shop => shop.buildingId === 'workshop')!;
  industrial.inventory = 40;
  const custodySnapshot = () => JSON.stringify({ cash: moneySupply(simulation), shops: simulation.state.shops, lots: trade(simulation).lots, costs: trade(simulation).ownedLots, wages: runtime(simulation).wageArrears });
  const before = custodySnapshot();
  assert.equal(quoteSupply(simulation, industrial.id, 6).quantity, 6); assert.equal(quoteSupply(simulation, industrial.id, 6).unitPrice, 4);
  assert.equal(simulation.supplyConsignment(retail.id, 4), 0); assert.equal(custodySnapshot(), before);
  assert.equal(tradeSignals(simulation, industrial.id).sold, 0);
  farm.inventory = 4;
  assert.equal(simulation.supplyConsignment(retail.id, 4), 4); assert.equal(trade(simulation).lots[retail.id][0].supplierId, farm.id);
  assert.equal(industrial.inventory, 40); assert.deepEqual(trade(simulation).legacyIndustrialLotIds, []);
  const json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition), loaded = restored.importSave(json);
  assert(loaded.ok, loaded.message); assert.equal(restored.exportSave(), json);
});

test('an actual version-one industrial custody archive preserves its frozen rights through migration, sale and return', () => {
  const archived = JSON.parse(industrialArchive.save); assert.equal(archived.state.trade.version, 1);
  const simulation = new Simulation(industrialArchive.world), loaded = simulation.importSave(industrialArchive.save); assert(loaded.ok, loaded.message);
  const retail = simulation.state.shops.find(shop => shop.id === industrialArchive.retailId)!, supplier = simulation.state.shops.find(shop => shop.id === industrialArchive.supplierId)!;
  const oldLot = archived.state.trade.lots[retail.id][0];
  assert.equal(trade(simulation).version, 2); assert.deepEqual(trade(simulation).legacyIndustrialLotIds, [oldLot.id]);
  assert.deepEqual(trade(simulation).lots, archived.state.trade.lots); assert.deepEqual(simulation.state.shops, archived.state.shops);
  assert.deepEqual(runtime(simulation).wageArrears, archived.runtime.wageArrears); assert.deepEqual(runtime(simulation).wageAccruals, archived.runtime.wageAccruals);
  const json = simulation.exportSave(), restored = new Simulation(industrialArchive.world), reloaded = restored.importSave(json);
  assert(reloaded.ok, reloaded.message); assert.equal(restored.exportSave(), json);
  const uninterrupted = new Simulation(industrialArchive.world); assert(uninterrupted.importSave(json).ok);
  for (let tick = 0; tick < 24; tick++) { uninterrupted.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), uninterrupted.exportSave());
  const sourceCash = simulation.shopFunds(supplier), retailCash = simulation.shopFunds(retail), totalCash = moneySupply(simulation), taxes = runtime(simulation).taxes;
  retail.price = 12; simulation.state.player.position = { ...simulation.worldDefinition.buildings.find(site => site.id === retail.buildingId)!.door };
  const sale = simulation.command({ type: 'purchase', targetId: retail.id, value: 1 }); assert(sale.ok, sale.message);
  assert.equal(trade(simulation).lots[retail.id][0].id, oldLot.id); assert.equal(trade(simulation).lots[retail.id][0].unitPrice, oldLot.unitPrice); assert.equal(trade(simulation).lots[retail.id][0].quantity, 3);
  assert(Math.abs(simulation.shopFunds(supplier) - sourceCash - 3.68) < 1e-8); assert(Math.abs(simulation.shopFunds(retail) - retailCash - 7.04) < 1e-8);
  assert(Math.abs(runtime(simulation).taxes - taxes - 1.28) < 1e-8); assert(Math.abs(moneySupply(simulation) - totalCash) < 1e-8);
  assert.equal(returnConsignment(simulation, retail.id), 3); assert.equal(supplier.inventory, 39); assert.equal(retail.inventory, 0); assert.deepEqual(trade(simulation).legacyIndustrialLotIds, []);
  const afterReturnCash = moneySupply(simulation), sourceStock = supplier.inventory;
  assert.equal(supplyConsignment(simulation, retail.id, 4), 0); assert.equal(supplier.inventory, sourceStock); assert.equal(moneySupply(simulation), afterReturnCash);
  evidence.push({ check: 'actual-v1-industrial-custody-migration', capturedAt: industrialArchive.capturedAt, originalTradeSha256: industrialArchive.productionTradeSha256, lotId: oldLot.id, frozenUnitPrice: oldLot.unitPrice, initialUnits: industrialArchive.moved, migratedUnits: 4, soldUnits: 1, returnedUnits: 3, newIndustrialSupply: 0, exactModernRoundTrip: true, exactContinuationTicks: 24, cashResidual: moneySupply(simulation) - totalCash });
});

test('modern custody requires food source or an exact grandfathered industrial lot and its cost book', () => {
  const { simulation, retail } = fixture(); simulation.supplyConsignment(retail.id, 4);
  const industrial = simulation.state.shops.find(shop => shop.buildingId === 'workshop')!, json = simulation.exportSave(), restored = new Simulation(simulation.worldDefinition);
  assert(restored.importSave(json).ok);
  for (const change of [
    (document: any) => { document.state.trade.lots[retail.id][0].supplierId = industrial.id; },
    (document: any) => { delete document.state.trade.legacyIndustrialLotIds; },
    (document: any) => { document.state.trade.legacyIndustrialLotIds = [document.state.trade.lots[retail.id][0].id]; },
    (document: any) => { document.state.trade.legacyIndustrialLotIds = ['consignment-9999']; },
    (document: any) => { delete document.state.trade.ownedLots; }
  ]) {
    const document = JSON.parse(json); change(document);
    assert.equal(restored.importSave(JSON.stringify(document)).ok, false); assert.equal(restored.exportSave(), json);
  }
  const old = new Simulation(industrialArchive.world); assert(old.importSave(industrialArchive.save).ok);
  const oldJson = old.exportSave(), duplicate = JSON.parse(oldJson); duplicate.state.trade.legacyIndustrialLotIds.push(duplicate.state.trade.legacyIndustrialLotIds[0]);
  assert.equal(old.importSave(JSON.stringify(duplicate)).ok, false); assert.equal(old.exportSave(), oldJson);
});

test('actual public material receipts record producer demand once with the existing payments and taxes', () => {
  const { simulation, supplier: farm } = fixture(0, 0), industrial = simulation.state.shops.find(shop => shop.buildingId === 'workshop')!;
  industrial.inventory = 40; farm.inventory = 40;
  const initialCash = moneySupply(simulation), initialSourceCash = simulation.shopFunds(industrial), initialTax = runtime(simulation).taxes, initialTreasury = simulation.state.treasury;
  const eventTypes = ['public-procurement', 'security-procurement', 'emergency-procurement', 'medical-procurement', 'civic-procurement'];
  const emitted: { type: string; quantity: number; amount: number }[] = []; let extraWholesale = 0, extraSale = 0;
  for (const type of eventTypes) simulation.onEvent(type, event => emitted.push({ type, quantity: event.quantity!, amount: event.amount! }));
  simulation.onEvent('wholesale', () => extraWholesale++); simulation.onEvent('sale', () => extraSale++);
  let paid = 0, units = 0, tax = 0;
  for (const eventType of eventTypes) {
    const receipt = simulation.purchasePublicSupplyReceipt({ requestedGross: 8, requestedQuantity: 2, districtId: 'district', eventType });
    assert.equal(receipt.paid, 8); assert.equal(receipt.quantity, 2); assert.equal(receipt.lots[0].shopId, industrial.id);
    paid += receipt.paid; units += receipt.quantity; tax += receipt.tax;
    assert.equal(tradeSignals(simulation, industrial.id).sold, units); assert.equal(tradeSignals(simulation, farm.id).sold, 0);
  }
  assert.equal(emitted.length, 5); assert.equal(extraWholesale, 0); assert.equal(extraSale, 0);
  assert.equal(industrial.inventory, 30); assert.equal(farm.inventory, 40);
  assert(Math.abs(simulation.state.treasury - initialTreasury + paid) < 1e-8);
  assert(Math.abs(simulation.shopFunds(industrial) - initialSourceCash - paid * .92) < 1e-8); assert(Math.abs(runtime(simulation).taxes - initialTax - tax) < 1e-8);
  assert(Math.abs(moneySupply(simulation) - initialCash) < 1e-8);
  const signals = tradeSignals(simulation, industrial.id), json = simulation.exportSave();
  simulation.emitEvent({ type: 'civic-service', shopId: industrial.id, amount: 8, quantity: 2 });
  simulation.emitEvent({ type: 'public-procurement', shopId: industrial.id, amount: 8 });
  simulation.emitEvent({ type: 'public-procurement', shopId: industrial.id, quantity: 2 });
  assert.deepEqual(tradeSignals(simulation, industrial.id), signals); assert.equal(simulation.exportSave(), json);
  const restored = new Simulation(simulation.worldDefinition), loaded = restored.importSave(json); assert(loaded.ok, loaded.message); assert.equal(restored.exportSave(), json);
  evidence.push({ check: 'actual-public-material-receipts-producer-demand', eventTypes, quantities: emitted.map(event => event.quantity), supplierSoldUnits: signals.sold, supplierReceived: simulation.shopFunds(industrial) - initialSourceCash, publicGross: paid, paidTax: tax, extraWholesale, extraSale, foodStockUnchanged: farm.inventory, cashResidual: moneySupply(simulation) - initialCash });
});
