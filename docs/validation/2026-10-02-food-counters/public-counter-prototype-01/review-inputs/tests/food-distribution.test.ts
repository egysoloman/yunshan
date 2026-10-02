import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { foodDistributionController, type FoodCounter } from '../src/simulation/food-distribution';
import { foodCounterWorld } from './helpers/food-counter-world';

const world = foodCounterWorld();
const runtime = (sim: Simulation): any => Reflect.get(sim, 'runtime');
const counter = (sim: Simulation): FoodCounter => sim.state.foodDistribution!.counters[0];
function cash(sim: Simulation) {
  const s = sim.state;
  return s.treasury + runtime(sim).taxes + s.player.money + s.banking!.cash + s.banking!.legacyInvestmentCash + s.citizens.reduce((n, c) => n + c.money, 0)
    + s.shops.filter(shop => !s.extension!.companies.some(c => c.buildingId === shop.buildingId)).reduce((n, shop) => n + (shop.cash ?? 0), 0)
    + s.extension!.companies.reduce((n, c) => n + c.capital, 0) + s.extension!.organizations.reduce((n, o) => n + o.funds, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.clinical?.orders.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + (s.family?.pregnancies.reduce((n, p) => n + p.escrow, 0) ?? 0) + (s.family?.households.reduce((n, h) => n + h.balance, 0) ?? 0);
}
function food(sim: Simulation) {
  return sim.state.shops.filter(s => sim.shopCommodity(s) === 'food').reduce((n, s) => n + s.inventory, 0) + sim.state.vehicles.reduce((n, v) => n + v.cargo, 0)
    + Object.values(runtime(sim).freight as Record<string, number>).reduce((n, q) => n + q, 0) + sim.state.citizens.reduce((n, c) => n + (c.food ?? 0), 0) + (sim.state.player.inventory.food ?? 0)
    + (sim.state.foodDistribution?.counters.reduce((n, c) => n + c.stocks.reduce((n, s) => n + s.remaining, 0), 0) ?? 0);
}
function materials(sim: Simulation) { return sim.state.shops.filter(s => sim.shopCommodity(s) === 'materials').reduce((n, s) => n + s.inventory, 0) + (sim.state.foodDistribution?.counters.reduce((n, c) => n + c.materialReceived - c.materialConsumed, 0) ?? 0); }
function restore(sim: Simulation) { const save = sim.exportSave(), other = new Simulation(world), r = other.importSave(save); assert.equal(r.ok, true, r.message); assert.equal(other.exportSave(), save); return other; }
function fixture(privateFood = false) {
  const sim = new Simulation(world), r = runtime(sim);
  // Isolate the short original-contract scenario, not a macro performance run.
  // No cash, goods, IDs, staff jobs, capacities, wages or policy are added.
  sim.command({ type: 'speed', value: 8 });
  for (const v of sim.state.vehicles) v.nextDeparture = 1e6;
  r.commerceAt = r.financeAt = r.payrollAt = r.socialAt = r.crimeAt = 1e6;
  for (const c of sim.state.citizens) { c.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; r.activities[c.id] = 'social'; r.decisionAt[c.id] = 1e6; c.destinationId = c.homeId; c.route = []; c.routeIndex = 0; }
  const staff = sim.state.citizens.find(c => c.workId === 'school' && c.role === '老师')!;
  const signers = sim.state.citizens.filter(c => c.workId === 'hall' && c.role === '官员').slice(0, 2); assert.equal(signers.length, 2);
  for (const c of [staff, ...signers]) { c.position = { ...world.buildings.find(b => b.id === c.workId)!.door }; c.destinationId = c.workId; c.state = 'working'; r.activities[c.id] = 'work'; }
  const carrier = sim.state.vehicles.find(v => v.id === 'vehicle-food-road-1')!;
  // The public load begins as the ordinary native 28. For private ownership,
  // first actually unload that old public load and make a farm pickup later.
  const unload = (direction: 1 | -1) => { carrier.progress = direction === 1 ? .999 : .001; carrier.direction = direction; carrier.nextDeparture = sim.state.day * 1440 + sim.state.hour * 60; r.signalOverrides[direction === 1 ? 'market-door' : 'farm-door'] = direction === 1 ? 1 : 0; sim.step(.25); };
  unload(privateFood ? -1 : 1);
  if (privateFood) { assert.equal(r.cargoSources[carrier.id], 'shop-farm'); unload(1); }
  carrier.nextDeparture = 1e6;
  const api = foodDistributionController(sim), signed = api.register('school', signers.map(c => c.id)); assert.equal(signed.ok, true, signed.message);
  return { sim, api, staff, signers };
}
function open(privateFood = false) {
  const f = fixture(privateFood); assert.equal(f.api.procure(counter(f.sim).id).ok, true); assert.equal(f.api.accept(counter(f.sim).id, f.staff.id).ok, true);
  for (let i = 0; i < 250 && counter(f.sim).tasks.at(-1)!.stage !== 'serve'; i++) f.sim.step(.25);
  assert.equal(counter(f.sim).state, 'open'); assert.equal(counter(f.sim).tasks.at(-1)!.stage, 'serve'); return f;
}

test('license reserves actual cap; actual material payment and ten old-contract assembly minutes precede opening', () => {
  const { sim, api, staff } = fixture(), c = counter(sim), cashBefore = cash(sim), materialBefore = materials(sim), treasury = sim.state.treasury;
  assert.equal(c.spent, 0); assert.equal(api.accept(c.id, staff.id).ok, false, 'cannot assemble before having the actual input');
  const supplier = sim.state.shops.find(s => sim.shopCommodity(s) === 'materials')!, inventory = supplier.inventory, funds = sim.shopFunds(supplier), tax = runtime(sim).taxes;
  assert.equal(api.procure(c.id).ok, true); assert.equal(c.materialReceived, 1); assert.equal(supplier.inventory, inventory - 1); assert.equal(sim.state.treasury, treasury - 4); assert.ok(Math.abs(sim.shopFunds(supplier) - funds - 3.68) < 1e-8); assert.ok(Math.abs(runtime(sim).taxes - tax - .32) < 1e-8);
  assert.equal(materials(sim), materialBefore); assert.equal(c.materialConsumed, 0); assert.equal(api.accept(c.id, staff.id).ok, true);
  let upkeepQuantity = 0; sim.onEvent('public-procurement', e => upkeepQuantity += e.quantity ?? 0);
  const before = runtime(sim).attendance[staff.id], earned = runtime(sim).wageAccruals.find((w: any) => w.citizenId === staff.id).amount;
  for (let i = 0; i < 4; i++) sim.step(.25); assert.equal(c.state, 'assembling'); assert.equal(c.assemblyMinutes, 8); assert.equal(c.materialConsumed, 0);
  sim.step(.25); assert.equal(c.assemblyMinutes, 10); assert.equal(c.materialConsumed, 1); assert.equal(c.state, 'open'); assert.ok(Math.abs(upkeepQuantity - 3.6) < 1e-8); assert.ok(Math.abs(materials(sim) + upkeepQuantity - materialBefore + 1) < 1e-8);
  const t = c.tasks.at(-1)!; assert.equal(runtime(sim).attendance[staff.id] - before, 10); assert.ok(Math.abs(runtime(sim).wageAccruals.find((w: any) => w.citizenId === staff.id).amount - earned - t.earned) < 1e-8); assert.equal(sim.isOnDuty(staff.id, 'school'), false);
  assert.ok(Math.abs(cash(sim) - cashBefore) < 1e-7); restore(sim);
});

test('staff actually walks to the native node, loads finite food and returns before any shelf or checkout exists', () => {
  const f = fixture(), c = counter(f.sim), initialFood = food(f.sim), initialCash = cash(f.sim); f.api.procure(c.id); f.api.accept(c.id, f.staff.id);
  for (let i = 0; i < 5; i++) f.sim.step(.25);
  const departure = { ...f.staff.position }; f.sim.step(.25); assert.ok(Math.hypot(f.staff.position.x - departure.x, f.staff.position.z - departure.z) <= 8.4 + 1e-8); assert.equal(c.stocks.length, 0, 'road distance cannot be skipped');
  let carried = false; for (let i = 0; i < 250 && c.tasks.at(-1)!.stage !== 'serve'; i++) { f.sim.step(.25); if (c.stocks[0]?.location === 'carrier') { carried = true; assert.equal(c.stocks[0].deliveredAt, null); assert.equal(f.api.quote(c.id, f.signers[0].id)!.available, 0); } }
  assert.ok(carried); assert.equal(c.stocks[0].remaining, 8); assert.equal(c.stocks[0].origin.nodeId, 'market-door'); assert.equal(c.stocks[0].location, 'counter'); assert.deepEqual(f.staff.position, c.point);
  const t = c.tasks[0]; assert.ok(t.allocated.fetchTravel >= 330 / 4.2 - 1e-6); assert.ok(t.allocated.deliveryTravel >= 330 / 4.2 - 1e-6); assert.equal(t.allocated.loading, 2); assert.equal(t.allocated.handoff, 2);
  assert.ok(Math.abs(food(f.sim) - initialFood) < 1e-7); assert.ok(Math.abs(cash(f.sim) - initialCash) < 1e-7); restore(f.sim);
});

test('readonly quote and two-minute-per-unit public-food checkout split actual wallet without paying the public owner twice', () => {
  const { sim, api, staff } = open(), c = counter(sim), buyer = sim.state.citizens.find(c => c.id !== staff.id && c.role !== '学生' && c.workId !== 'hall')!;
  buyer.position = { ...c.point }; buyer.needs.hunger = 40; const save = sim.exportSave(); assert.ok(api.quote(c.id, buyer.id, 2)?.staffed); assert.equal(sim.exportSave(), save, 'quote cannot mutate state');
  const beforeMoney = buyer.money, beforeCash = cash(sim), beforeFood = food(sim), beforeTreasury = sim.state.treasury, beforeTax = runtime(sim).taxes;
  assert.equal(api.visit(c.id, buyer.id, 2).ok, true); assert.equal(buyer.money, beforeMoney);
  let upkeepPaid = 0, margin = 0; sim.onEvent('public-procurement', e => upkeepPaid += e.amount ?? 0); sim.onEvent('counter-margin', e => margin += e.amount ?? 0);
  let consumed = 0; sim.onEvent('food-consumed', e => { if (e.citizenId === buyer.id) consumed += e.amount ?? 0; });
  sim.step(.25); assert.equal(c.sales.length, 0, 'being on the same point does not mean the service elapsed');
  for (let i = 0; i < 10 && !c.sales.length; i++) sim.step(.25);
  assert.equal(c.sales.length, 1); assert.equal(c.queue[0].servedMinutes, 4); assert.equal(buyer.money, beforeMoney - 24); assert.equal(buyer.food, 1); assert.equal(consumed, 1);
  assert.ok(Math.abs(margin - 22.08) < 1e-8); assert.equal(c.sales[0].saleTax, 1.92); assert.equal(c.sales[0].supplierGross, 0);
  // finance remits both sale tax and actual upkeep tax in the same tick.
  assert.ok(Math.abs(sim.state.treasury - beforeTreasury - 24 + upkeepPaid * .92 - beforeTax) < 1e-8); assert.equal(runtime(sim).taxes, 0);
  assert.ok(Math.abs(food(sim) - beforeFood + 1) < 1e-8); assert.ok(Math.abs(cash(sim) - beforeCash) < 1e-7); restore(sim);
});

test('pause releases ordinary service and retains carried ownership; closing returns unsold stock to original FIFO without teleport', () => {
  const { sim, api, staff } = open(), c = counter(sim), foodBefore = food(sim), cashBefore = cash(sim), source = c.stocks[0].sourceLotId, total = runtime(sim).freight.customers;
  staff.needs.fatigue = 24; sim.step(.25); assert.equal(c.tasks[0].stage, 'paused'); const earned = c.tasks[0].earned;
  sim.step(.25); assert.equal(c.tasks[0].earned, earned); assert.equal(c.stocks[0].remaining, 8);
  staff.needs.fatigue = 100; assert.equal(api.resume(c.id).ok, true); assert.equal(api.close(c.id).ok, true); assert.equal(runtime(sim).freight.customers, total, 'closure itself cannot return goods');
  for (let i = 0; i < 250 && c.state !== 'closed'; i++) sim.step(.25);
  assert.equal(c.state, 'closed'); assert.equal(c.stocks[0].returned, 8); assert.equal(c.stocks[0].remaining, 0); assert.equal(runtime(sim).freight.customers, total + 8);
  assert.equal(runtime(sim).freightLots.customers.find((l: any) => l.id === source).quantity, 28); assert.equal(runtime(sim).publicBudgets.find((b: any) => b.id === c.budgetId).closedAt !== null, true);
  assert.ok(Math.abs(food(sim) - foodBefore) < 1e-7); assert.ok(Math.abs(cash(sim) - cashBefore) < 1e-7); restore(sim);
});

test('active carrying and open shelf save exactly and continue 24 real ticks', () => {
  const { sim, api, staff } = fixture(); api.procure(counter(sim).id); api.accept(counter(sim).id, staff.id);
  for (let i = 0; i < 200 && counter(sim).stocks[0]?.location !== 'carrier'; i++) sim.step(.25);
  assert.equal(counter(sim).stocks[0].location, 'carrier'); const other = restore(sim);
  for (let i = 0; i < 24; i++) { sim.step(.25); other.step(.25); } assert.equal(other.exportSave(), sim.exportSave());
  for (let i = 0; i < 200 && counter(sim).tasks[0].stage !== 'serve'; i++) sim.step(.25); const shelf = restore(sim);
  for (let i = 0; i < 24; i++) { sim.step(.25); shelf.step(.25); } assert.equal(shelf.exportSave(), sim.exportSave());
});

test('new custody/budget/assembly and module presence tampering reject atomically', () => {
  const { sim } = open(), original = sim.exportSave(), target = new Simulation(world), baseline = target.exportSave();
  const cases: [string, (s: any) => void][] = [
    ['module missing', s => delete s.state.foodDistribution], ['manifest entry missing', s => s.runtime.persistedModules = s.runtime.persistedModules.filter((v: string) => v !== 'foodDistribution')],
    ['duplicate lot', s => s.state.foodDistribution.counters[0].stocks.push(structuredClone(s.state.foodDistribution.counters[0].stocks[0]))],
    ['inflated remaining', s => s.state.foodDistribution.counters[0].stocks[0].remaining++], ['wrong node', s => s.state.foodDistribution.counters[0].stocks[0].origin.nodeId = 'home-door'],
    ['wrong vehicle', s => s.state.foodDistribution.counters[0].stocks[0].origin.vehicleId = 'vehicle-imaginary'], ['changed owner', s => s.state.foodDistribution.counters[0].stocks[0].origin.shopId = 'shop-farm'],
    ['spent erased', s => s.runtime.publicBudgets.find((b: any) => b.purpose === 'food-distribution').spent = 0], ['assembly erased', s => s.state.foodDistribution.counters[0].assemblyMinutes = 0],
    ['cost erased', s => s.state.foodDistribution.counters[0].receipts[0].lots[0].gross = 0], ['unfunded salary', s => s.state.foodDistribution.counters[0].tasks[0].earned++],
    ['sequence reused', s => s.state.foodDistribution.nextStockId = 1], ['counter teleported', s => s.state.foodDistribution.counters[0].point.x += 1],
  ];
  for (const [name, change] of cases) { const saved = JSON.parse(original); change(saved); assert.equal(target.importSave(JSON.stringify(saved)).ok, false, name); assert.equal(target.exportSave(), baseline, name); }
});

test('without a requested counter no new body exists and old save is byte exact', () => {
  const sim = new Simulation(world); assert.equal(sim.state.foodDistribution, undefined); const save = sim.exportSave(); assert.equal(JSON.parse(save).runtime.persistedModules.includes('foodDistribution'), false); restore(sim);
});

test('private food remains the actual supplier property until checkout, then real gross splits at frozen H4', () => {
  const { sim, api, staff } = open(true), c = counter(sim), stock = c.stocks[0], supplier = sim.state.shops.find(s => s.id === 'shop-farm')!;
  assert.equal(stock.origin.shopId, supplier.id); assert.equal(stock.unitPrice, 4);
  const buyer = sim.state.citizens.find(c => c.id !== staff.id && c.role !== '学生' && c.workId !== 'hall')!; buyer.position = { ...c.point }; buyer.needs.hunger = 40;
  const cashBefore = cash(sim), before = { supplier: sim.shopFunds(supplier), treasury: sim.state.treasury, taxes: runtime(sim).taxes, buyer: buyer.money };
  let upkeepPaid = 0, margin = 0; sim.onEvent('public-procurement', e => upkeepPaid += e.amount ?? 0); sim.onEvent('counter-margin', e => margin += e.amount ?? 0);
  assert.equal(api.visit(c.id, buyer.id, 2).ok, true); for (let i = 0; i < 24 && !c.sales.length; i++) sim.step(.25);
  assert.equal(c.sales.length, 1); assert.equal(buyer.money, before.buyer - 24); assert.ok(Math.abs(sim.shopFunds(supplier) - before.supplier - 7.36) < 1e-8);
  assert.ok(Math.abs(margin - 14.08) < 1e-8); assert.equal(c.sales[0].saleTax, 1.92); assert.equal(c.sales[0].supplierTax, .64);
  assert.ok(Math.abs(sim.state.treasury - before.treasury - 16.64 + upkeepPaid * .92 - before.taxes) < 1e-8); assert.equal(runtime(sim).taxes, 0); assert.equal(stock.sold, 2);
  assert.ok(Math.abs(cash(sim) - cashBefore) < 1e-7); restore(sim);
});

test('remaining original 1.5 funded minutes bound the task without creating another attendance or wage allowance', () => {
  const { sim, api, staff } = fixture(), c = counter(sim), r = runtime(sim); api.procure(c.id);
  // Walk the actual original classroom work schedule until only 1.5 funded
  // minutes remain. No attendance, wage claims or clock fields are injected.
  while ((r.attendance[staff.id] ?? 0) < 478) sim.step(.25);
  sim.command({ type: 'speed', value: 1 }); sim.step(.25); sim.step(.25);
  const before = r.attendance[staff.id]; assert.equal(before, 478.5); sim.command({ type: 'speed', value: 8 });
  assert.equal(api.accept(c.id, staff.id).ok, true); sim.step(.25); assert.equal(c.tasks[0].workedMinutes, 1.5); assert.equal(c.assemblyMinutes, 1.5); assert.equal(r.attendance[staff.id], 480);
  const wage = c.tasks[0].earned; sim.step(.25); assert.equal(c.tasks[0].stage, 'paused'); assert.equal(c.tasks[0].earned, wage); assert.equal(api.resume(c.id).ok, false); assert.equal(c.materialConsumed, 0);
  const saved = sim.exportSave(), other = restore(sim); assert.equal(other.exportSave(), saved);
});
