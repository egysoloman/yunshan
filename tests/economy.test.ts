import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { completePaidCourse } from './education-fixture';
import type { Building, BuildingKind, Citizen, Shop, WorldDefinition } from '../src/types';

function fixture(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(b => ({ id: `${b.id}-door`, districtId: 'district', name: b.id, position: { ...b.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const,
    length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261001, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '经济测试', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 384 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
function placeAtWork(sim: Simulation, worker: Citizen, shop: Shop) {
  const building = sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!;
  worker.position = { ...building.position, y: building.position.y + .6 }; worker.destinationId = building.id;
  worker.route = []; worker.routeIndex = 0; worker.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  runtime(sim).activities[worker.id] = 'work'; runtime(sim).decisionAt[worker.id] = 10000;
  sim.setFocus(worker.position, 'drone');
  const owner = shop.ownerId === 'player' ? sim.state.player : sim.state.citizens.find(citizen => citizen.id === shop.ownerId)!;
  owner.position = { ...building.door }; owner.needs.hunger = 100; owner.needs.fatigue = 100;
  Reflect.get(sim, 'refreshWorkforce').call(sim);
  if (runtime(sim).privateLabor) runtime(sim).privateLabor.nextReviewAt = sim.state.extension!.lastUpdate;
  Reflect.get(sim, 'reviewPrivateShifts').call(sim);
}
function moneySupply(sim: Simulation) {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + runtime(sim).investment) + (s.family?.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0) ?? 0) + (s.family?.households?.reduce((sum, household) => sum + household.balance, 0) ?? 0) + s.citizens.reduce((sum, c) => sum + c.money, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.education?.course?.escrow ?? 0) + (s.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0)
    + s.shops.filter(shop => !e.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + e.companies.reduce((sum, company) => sum + company.capital, 0) + e.organizations.reduce((sum, org) => sum + org.funds, 0);
}

test('generated neighbours are assigned jobs by the walkable graph, including mountain detours', () => {
  const sim = new Simulation(createWorld()), buildings = new Map(sim.worldDefinition.buildings.map(b => [b.id, b]));
  const walk = (citizen: Citizen, destination: typeof sim.worldDefinition.buildings[number]) => Reflect.get(sim, 'walkingDistance').call(sim, citizen, destination) as number;
  for (const citizen of sim.state.citizens.filter(c => c.role !== '学生')) {
    const assigned = walk(citizen, buildings.get(citizen.workId)!);
    assert.ok(Number.isFinite(assigned));
    const jobs = sim.worldDefinition.buildings.filter(b => b.districtId === citizen.districtId && ['market', 'workshop', 'farm', 'bank', 'hall', 'police', 'school', 'clinic', 'station', 'airport', 'starport', 'dock', 'core'].includes(b.kind));
    const nearby = jobs.some(b => walk(citizen, b) <= 500);
    if (nearby) assert.ok(assigned <= 500, `${citizen.id}: ${assigned}m job despite a reachable neighbourhood offer`);
  }
});

test('an underfunded private employer pays its real cash proportionally and settles each wage once', () => {
  const sim = new Simulation(fixture()), shop = sim.state.shops.find(s => s.buildingId === 'market')!;
  const workers = sim.state.citizens.filter(c => c.workId === shop.buildingId && c.role !== '学生').slice(0, 2);
  assert.equal(workers.length, 2); shop.cash = 30;
  const before = workers.map(c => c.money), supply = moneySupply(sim), profit = shop.profit;
  for (const worker of workers) sim.emitEvent({ type: 'wage', citizenId: worker.id, districtId: worker.districtId, amount: 20 });
  workers[0].workId = 'school'; // Changing jobs cannot move an already earned employer obligation.
  sim.step(.25);
  assert.ok(Math.abs(shop.cash) < 1e-8);
  for (let i = 0; i < workers.length; i++) assert.ok(Math.abs(workers[i].money - before[i] - 15 * .92) < 1e-8);
  assert.equal(shop.profit, profit - 40, 'all earned wages are expenses even when ten remain unpaid'); assert.equal(runtime(sim).wages.length, 0);
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-7, 'salary, tax and supplier procurement all have funded counterparties');
  assert.equal(sim.shopPayrollDebt(shop), 10, 'an unfunded earned wage remains owed to the actual workers');
  const restored = new Simulation(sim.worldDefinition), result = restored.importSave(sim.exportSave()); assert.equal(result.ok, true, result.message);
  assert.equal(restored.exportSave(), sim.exportSave());
  const proprietor = restored.state.citizens.find(c => c.id === shop.ownerId)!;
  proprietor.money -= 10; restored.transferShopFunds(restored.state.shops.find(s => s.id === shop.id)!, 10);
  const beforeRepayment = restored.state.citizens.filter(c => workers.some(worker => worker.id === c.id)).map(c => c.money);
  restored.step(.25);
  const repaid = restored.state.citizens.filter(c => workers.some(worker => worker.id === c.id));
  for (let i = 0; i < repaid.length; i++) assert.ok(Math.abs(repaid[i].money - beforeRepayment[i] - 5 * .92) < 1e-8);
  assert.equal(restored.shopPayrollDebt(restored.state.shops.find(s => s.id === shop.id)!), 0);
  assert.ok(Math.abs(moneySupply(restored) - supply) < 1e-7);
});

test('production requires actual attendance and technology improves that labour instead of producing unattended stock', () => {
  const sim = new Simulation(fixture()), shop = sim.state.shops.find(s => s.buildingId === 'workshop')!;
  shop.inventory = 0; shop.employees = 0; sim.state.extension!.technologies.find(t => t.sector === 'manufacturing')!.level = 3;
  let produced = 0, attended = 0; sim.onEvent('production', e => { if (e.shopId === shop.id) { produced += e.amount ?? 0; attended += e.minutes ?? 0; } });
  sim.step(.25); assert.equal(produced, 0); assert.equal(shop.inventory, 0);
  const worker = sim.state.citizens.find(c => c.workId === shop.buildingId && c.role !== '学生')!;
  shop.employees = sim.state.citizens.filter(c => c.workId === shop.buildingId && c.role !== '学生').length;
  placeAtWork(sim, worker, shop); runtime(sim).commerceAt = sim.state.day * 1440 + sim.state.hour * 60;
  sim.step(.25); assert.ok(produced > 0); assert.ok(attended > 0);
  assert.ok(produced <= attended / 30 * 1.36 + 1e-8, 'every unit has finite productive labour and energy');
});

test('public operations consume existing goods and credit their real supplier without creating money', () => {
  const sim = new Simulation(fixture()), supplier = sim.state.shops.find(s => s.buildingId === 'workshop')!;
  for (const shop of sim.state.shops) shop.inventory = shop === supplier ? 10 : shop.buildingId === 'market' ? 90 : shop.buildingId === 'farm' ? 12 : 0;
  const food = sim.state.shops.find(shop => shop.buildingId === 'farm')!;
  let purchase = 0, units = 0; sim.onEvent('public-procurement', event => { purchase += event.amount ?? 0; units += event.quantity ?? 0; assert.equal(event.shopId, supplier.id); });
  const supply = moneySupply(sim), funds = sim.shopFunds(supplier), treasury = sim.state.treasury;
  sim.step(.25);
  assert.ok(purchase > 0); assert.ok(Math.abs(supplier.inventory - (10 - units)) < 1e-8);
  assert.ok(Math.abs(sim.shopFunds(supplier) - funds - purchase * .92) < 1e-8);
  assert.ok(Math.abs(sim.state.treasury - treasury + purchase * .92) < 1e-8);
  assert.equal(food.inventory, 12, 'public upkeep cannot consume residents\' food stock');
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-7);
});

test('native meals consume one portion, carry only the remainder, and workshop purchases stay material', () => {
  const sim = new Simulation(fixture()), market = sim.state.shops.find(shop => shop.buildingId === 'market')!, workshop = sim.state.shops.find(shop => shop.buildingId === 'workshop')!;
  sim.state.player.needs.hunger = 10;
  sim.setFocus(sim.worldDefinition.buildings.find(building => building.id === market.buildingId)!.door, 'walk');
  const cash = moneySupply(sim), stock = market.inventory, money = sim.state.player.money;
  let consumed = 0; sim.onEvent('food-consumed', event => { if (event.citizenId === 'player') consumed += event.amount ?? 0; });
  assert.equal(sim.command({ type: 'purchase', value: 2 }).ok, true);
  assert.equal(market.inventory, stock - 2); assert.equal(sim.state.player.money, money - market.price * 2);
  assert.equal(sim.state.player.inventory.food, 1); assert.equal(sim.state.player.needs.hunger, 62); assert.equal(consumed, 1);
  const bought = sim.exportSave(), restored = new Simulation(fixture()); assert.equal(restored.importSave(bought).ok, true); assert.equal(restored.exportSave(), bought);
  assert.equal(sim.command({ type: 'eat', targetId: 'food' }).ok, true);
  assert.equal(sim.state.player.inventory.food, 0); assert.equal(sim.state.player.needs.hunger, 100); assert.equal(consumed, 2);
  const empty = sim.exportSave(); assert.equal(sim.command({ type: 'eat', targetId: 'food' }).ok, false); assert.equal(sim.exportSave(), empty);
  sim.setFocus(sim.worldDefinition.buildings.find(building => building.id === workshop.buildingId)!.door, 'walk');
  const materials = workshop.inventory, funds = sim.shopFunds(workshop), hunger = sim.state.player.needs.hunger;
  assert.equal(sim.command({ type: 'purchase', value: 2 }).ok, true);
  assert.equal(workshop.inventory, materials - 2); assert.equal(sim.state.player.inventory.material, 2); assert.equal(sim.state.player.inventory.food, 0);
  assert.equal(sim.state.player.needs.hunger, hunger); assert.equal(consumed, 2);
  assert.ok(Math.abs(sim.shopFunds(workshop) - funds - workshop.price * 2 * .92) < 1e-8);
  assert.ok(Math.abs(moneySupply(sim) - cash) < 1e-7);
});

test('food freight leaves industrial material with its real producer', () => {
  const world = fixture();
  for (const building of world.buildings) { building.position.x *= 10; building.door.x *= 10; }
  for (const node of world.nodes) node.position.x *= 10;
  for (const edge of world.edges) edge.length *= 10;
  const sim = new Simulation(world), workshop = sim.state.shops.find(shop => shop.buildingId === 'workshop')!;
  for (const shop of sim.state.shops) if (sim.shopCommodity(shop) === 'food') shop.inventory = 0;
  sim.state.trade!.ownedLots = {};
  const carrier = sim.state.vehicles.find(vehicle => vehicle.kind === 'road')!;
  carrier.cargo = 1; carrier.progress = .99999; carrier.direction = 1; carrier.state = 'moving';
  runtime(sim).signalOverrides[world.edges.find(edge => edge.id === carrier.edgeId)!.to] = 1;
  const material = workshop.inventory, cash = moneySupply(sim); let upkeep = 0;
  sim.onEvent('public-procurement', event => { if (event.shopId === workshop.id) upkeep += event.quantity ?? 0; });
  sim.step(.25);
  assert.equal(carrier.cargo, 0, 'the empty food chain cannot load industrial stock onto a food carrier');
  assert.ok(Math.abs(workshop.inventory - material + upkeep) < 1e-8);
  assert.ok(Math.abs(moneySupply(sim) - cash) < 1e-7);
});

test('a stored meal is consumed after closing time and does not credit money or create food', () => {
  const sim = new Simulation(fixture()), citizen = sim.state.citizens.find(c => c.role !== '学生')!;
  sim.command({ type: 'setTime', value: 23 }); citizen.food = 1; citizen.needs.hunger = 10; sim.setFocus(citizen.position, 'drone');
  const money = citizen.money; sim.step(.25);
  assert.equal(citizen.food, 0); assert.ok(citizen.needs.hunger > 61); assert.equal(citizen.money, money);
  citizen.needs.hunger = 10; sim.step(.25); assert.ok(citizen.needs.hunger < 10); assert.equal(citizen.food, 0);
});

test('legacy accounts migrate from real proprietor savings and new ownership and cash survive exact continuation', () => {
  const world = fixture(), sim = new Simulation(world), legacy = JSON.parse(sim.exportSave());
  for (const shop of legacy.state.shops) { delete shop.cash; delete shop.ownerId; }
  for (const citizen of legacy.state.citizens) delete citizen.food;
  delete legacy.runtime.shopLabor; delete legacy.runtime.freightLots; delete legacy.runtime.cargoSources;
  const before = legacy.state.treasury + legacy.state.player.money + legacy.state.citizens.reduce((sum: number, c: Citizen) => sum + c.money, 0)
    + legacy.state.extension.companies.reduce((sum: number, c: { capital: number }) => sum + c.capital, 0);
  const restored = new Simulation(world); const result = restored.importSave(JSON.stringify(legacy)); assert.equal(result.ok, true, result.message);
  assert.ok(Math.abs(moneySupply(restored) - before) < 1e-7);
  for (const shop of restored.state.shops) assert.ok(shop.cash !== undefined && shop.cash >= 0);
  const site = restored.state.shops[0]; restored.state.player.identities = ['traveler', 'merchant']; restored.state.player.money = 1000;
  restored.setFocus(restored.worldDefinition.buildings.find(b => b.id === site.buildingId)!.door, 'walk');
  assert.equal(restored.command({ type: 'foundCompany', targetId: site.buildingId, value: 300 }).ok, true);
  assert.equal(site.ownerId, 'player');
  const again = new Simulation(world); const loaded = again.importSave(restored.exportSave()); assert.equal(loaded.ok, true, loaded.message);
  assert.equal(again.exportSave(), restored.exportSave());
  for (let i = 0; i < 40; i++) { restored.step(.25); again.step(.25); }
  assert.equal(again.exportSave(), restored.exportSave());
});


test('funded clinical care consumes one real material and cannot heal from an empty supplier', () => {
  const sim = new Simulation(fixture()), supplier = sim.state.shops.find(shop => shop.buildingId === 'workshop')!, profile = sim.state.extension!.actorProfiles.player;
  profile.health = 40;
  // The private patient's funded escrow remains usable even when the public
  // operator cannot buy any of the clinic's finite material first.
  sim.state.treasury = 0;
  Reflect.get(sim.state.extension!, 'runtime').nextCompanyAt = sim.state.extension!.lastUpdate + 1e6;
  for (const shop of sim.state.shops) shop.inventory = 0;
  for (const vehicle of sim.state.vehicles) vehicle.cargo = 0;
  sim.state.trade!.ownedLots = {};
  const clinic = sim.worldDefinition.buildings.find(building => building.kind === 'clinic')!;
  const doctor = sim.state.citizens.find(c => c.role === '医生')!; assert.ok(doctor);
  sim.onPhase('traffic', () => {
    doctor.position = { ...clinic.door }; doctor.destinationId = clinic.id; doctor.route = []; doctor.routeIndex = 0;
    doctor.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; runtime(sim).activities[doctor.id] = 'work'; runtime(sim).decisionAt[doctor.id] = 1e9;
  });
  sim.setFocus(clinic.door, 'walk');
  let payment = 0, consumed = 0;
  sim.onEvent('wholesale', event => { if (event.purpose !== 'clinical-material') return; payment += event.amount ?? 0; consumed += event.quantity ?? 0; assert.equal(event.shopId, supplier.id); });
  const supply = moneySupply(sim);
  assert.equal(sim.command({ type: 'heal' }).ok, true);
  sim.step(.25);
  assert.equal(payment, 0); assert.ok(profile.health < 41, 'empty medical supply cannot provide a full treatment');
  assert.equal(sim.state.clinical!.orders[0].escrow, 30);
  supplier.inventory = 1; supplier.employees = 0; const funds = sim.shopFunds(supplier), health = profile.health;
  // Isolate clinical cash from ordinary upkeep purchases and producers' own
  // output. No material is created during treatment by this boundary fixture.
  runtime(sim).financeAt = runtime(sim).relationshipClock + 1e6;
  for (let tick = 0; tick < 500 && sim.state.clinical!.orders[0].state !== 'completed'; tick++) sim.step(.25);
  assert.equal(payment, 4); assert.equal(consumed, 1); assert.equal(supplier.inventory, 0);
  assert.equal(sim.state.clinical!.orders[0].workedMinutes, 20); assert.equal(sim.state.clinical!.orders[0].consumedUnits, 1);
  assert.ok(profile.health >= health + 25, 'only a completed real twenty-minute treatment provides the full health improvement');
  assert.ok(Math.abs(sim.shopFunds(supplier) - funds - 4 * .92) < 1e-8);
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-7);
});


test('actual attendance retains its employer and promised wage rate across mid-shift changes and save/load', () => {
  const world = fixture(), sim = new Simulation(world), first = sim.state.shops.find(shop => shop.buildingId === 'market')!, second = sim.state.shops.find(shop => shop.buildingId === 'workshop')!;
  const worker = sim.state.citizens.find(c => c.workId === first.buildingId && c.role !== '学生')!;
  placeAtWork(sim, worker, first); sim.step(.25);
  const original = { ...runtime(sim).wageAccruals.find((claim: { citizenId: string }) => claim.citizenId === worker.id) };
  assert.equal(original.shopId, first.id); assert.ok(original.minutes > 0);
  sim.state.districts[0].prosperity = 10; sim.step(.25);
  const same = runtime(sim).wageAccruals.find((claim: { citizenId: string }) => claim.citizenId === worker.id);
  assert.equal(same.ratePerMinute, original.ratePerMinute, 'the promised rate cannot be repriced after work');
  worker.workId = second.buildingId; second.employees++; placeAtWork(sim, worker, second); sim.step(.25);
  const claims = runtime(sim).wageAccruals.filter((claim: { citizenId: string }) => claim.citizenId === worker.id);
  assert.equal(claims.length, 2); assert.equal(claims[0].shopId, first.id); assert.equal(claims[1].shopId, second.id);
  assert.ok(claims[1].ratePerMinute < claims[0].ratePerMinute);
  const restored = new Simulation(world), result = restored.importSave(sim.exportSave()); assert.equal(result.ok, true, result.message); assert.equal(restored.exportSave(), sim.exportSave());
  const employerDue = claims.map((claim: { amount: number }) => claim.amount), before = restored.state.citizens.find(c => c.id === worker.id)!.money;
  const restoredFirst = restored.state.shops.find(shop => shop.id === first.id)!, restoredSecond = restored.state.shops.find(shop => shop.id === second.id)!;
  const funds = [restored.shopFunds(restoredFirst), restored.shopFunds(restoredSecond)], profits = [restoredFirst.profit, restoredSecond.profit];
  const receipts = new Map<string, number>();
  restored.onEvent('public-procurement', event => { if (event.shopId) receipts.set(event.shopId, (receipts.get(event.shopId) ?? 0) + (event.amount ?? 0) * (1 - restored.state.taxRate)); });
  restored.state.citizens.find(c => c.id === worker.id)!.role = '学生'; // Earned wages survive loss of employment.
  for (const citizen of restored.state.citizens) citizen.needs.hunger = 100;
  runtime(restored).payrollAt = restored.state.hour * 60;
  restored.step(.25);
  assert.ok(Math.abs(restored.state.citizens.find(c => c.id === worker.id)!.money - before - employerDue.reduce((sum: number, owed: number) => sum + owed, 0) * .92) < 1e-8);
  assert.ok(Math.abs(restored.shopFunds(restoredFirst) - funds[0] + employerDue[0] - (receipts.get(restoredFirst.id) ?? 0)) < 1e-8);
  assert.ok(Math.abs(restored.shopFunds(restoredSecond) - funds[1] + employerDue[1] - (receipts.get(restoredSecond.id) ?? 0)) < 1e-8);
  assert.equal(restoredFirst.profit, profits[0] + (receipts.get(restoredFirst.id) ?? 0), 'paying an accrued salary does not charge the expense twice');
  assert.equal(restoredSecond.profit, profits[1] + (receipts.get(restoredSecond.id) ?? 0));
});

test('wage contracts reject changed amounts and employers atomically, while legacy unpaid expense migrates once', () => {
  const world = fixture(), sim = new Simulation(world), shop = sim.state.shops.find(shop => shop.buildingId === 'market')!, worker = sim.state.citizens.find(c => c.workId === shop.buildingId && c.role !== '学生')!;
  placeAtWork(sim, worker, shop); sim.step(.25);
  for (const corrupt of [(save: any) => { save.runtime.wageAccruals[0].amount++; }, (save: any) => { save.runtime.wageAccruals[0].shopId = null; }, (save: any) => { save.runtime.attendance[save.runtime.wageAccruals[0].citizenId]++; }]) {
    const save = JSON.parse(sim.exportSave()); corrupt(save); const prior = sim.exportSave(); assert.equal(sim.importSave(JSON.stringify(save)).ok, false); assert.equal(sim.exportSave(), prior);
  }
  const legacy = JSON.parse(new Simulation(world).exportSave()), target = legacy.state.shops.find((item: Shop) => item.id === shop.id);
  delete legacy.runtime.accountingVersion; delete legacy.runtime.wageAccruals; legacy.runtime.wageArrears = [{ citizenId: worker.id, shopId: shop.id, amount: 25 }];
  const restored = new Simulation(world), result = restored.importSave(JSON.stringify(legacy)); assert.equal(result.ok, true, result.message);
  assert.equal(restored.state.shops.find(item => item.id === shop.id)!.profit, target.profit - 25);
  const again = new Simulation(world), loaded = again.importSave(restored.exportSave()); assert.equal(loaded.ok, true, loaded.message); assert.equal(again.exportSave(), restored.exportSave());
});

test('share repurchases reserve both unpaid and not-yet-due actual wages', () => {
  const sim = new Simulation(fixture()), shop = sim.state.shops.find(item => item.buildingId === 'market')!;
  sim.state.player.identities = ['traveler', 'merchant']; sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door, 'walk'); assert.equal(sim.command({ type: 'foundCompany', targetId: shop.buildingId, value: 300 }).ok, true);
  const company = sim.state.extension!.companies.find(company => company.buildingId === shop.buildingId)!;
  assert.ok(company); const worker = sim.state.citizens.find(c => c.workId === shop.buildingId && c.role !== '学生')!;
  company.listed = true; company.shareholders = { player: 900, [worker.id]: 100 }; company.sharePrice = 1; company.capital = 20;
  placeAtWork(sim, worker, shop); sim.step(.25); company.capital = 20; company.sharePrice = 1;
  sim.emitEvent({ type: 'wage', citizenId: worker.id, districtId: worker.districtId, shopId: shop.id, amount: 15 });
  const debt = sim.shopPayrollDebt(shop); assert.ok(debt > 15);
  const protectedCash = sim.shopProtectedFunds(shop); assert.ok(protectedCash > debt, 'already accepted future wages are protected too');
  const recapitalization = protectedCash + 5 - company.capital; sim.state.player.money -= recapitalization; company.capital += recapitalization;
  const bank = sim.worldDefinition.buildings.find(building => building.kind === 'bank')!; sim.setFocus(bank.door, 'walk');
  const before = sim.exportSave(); assert.equal(sim.command({ type: 'sellShares', targetId: company.id, value: 10 }).ok, false); assert.equal(sim.exportSave(), before);
  assert.equal(sim.command({ type: 'sellShares', targetId: company.id, value: 4 }).ok, true); assert.ok(Math.abs(company.capital - protectedCash - 1) < 1e-8); assert.equal(sim.shopPayrollDebt(shop), debt);
});

test('native housing, education, qualifications and police rewards have actual public counterparties', () => {
  const sim = new Simulation(fixture()), home = sim.worldDefinition.buildings.find(b => b.kind === 'home')!, school = sim.worldDefinition.buildings.find(b => b.kind === 'school')!;
  const cash = moneySupply(sim), treasury = sim.state.treasury;
  sim.setFocus(home.door, 'walk'); assert.equal(sim.command({ type: 'rent', targetId: home.id }).ok, true);
  assert.equal(sim.state.treasury, treasury + 80, 'original rent fee enters the real public account');
  const wallet = sim.state.player.money, grade = sim.state.player.education, taught = completePaidCourse(sim, school);
  assert.equal(sim.state.player.money, wallet - 40); assert.equal(sim.state.player.education, grade + 1);
  assert.equal(taught.workedMinutes, 60); assert.equal(taught.consumedUnits, 1); assert.ok(Math.abs(taught.purchasePaid + taught.serviceFees - 40) < 1e-7);
  const examTreasury = sim.state.treasury, examWallet = sim.state.player.money;
  assert.equal(sim.command({ type: 'exam', targetId: 'teacher' }).ok, true);
  assert.equal(sim.state.treasury, examTreasury + 80); assert.equal(sim.state.player.money, examWallet - 80); assert.ok(Math.abs(moneySupply(sim) - cash) < 1e-7);
  sim.state.player.identities!.push('police'); const crime = { id: 'crime-funded-test', districtId: 'district', position: { ...school.door }, severity: 2, status: 'open' as const, createdAt: 480, responseAt: 0 };
  sim.state.crimes.push(crime); const before = sim.state.player.money, publicBefore = sim.state.treasury;
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, true); assert.equal(sim.state.treasury, publicBefore - 36); assert.equal(sim.state.player.money, before + 36 * .92); assert.ok(Math.abs(moneySupply(sim) - cash) < 1e-7);
});


test('future public shifts require actual departmental witnesses and reserve past promises before authorizing cash', () => {
  const world = fixture(), template = world.buildings.find(b => b.kind === 'bank')!;
  world.buildings.push({ ...template, id: 'hall', name: 'hall', kind: 'hall', position: { x: 210, y: 20, z: 0 }, door: { x: 210, y: 20, z: 5 } });
  world.nodes.push({ id: 'hall-door', districtId: 'district', name: 'hall', position: { x: 210, y: 20, z: 5 }, station: true });
  world.edges.push({ id: 'road-hall', from: 'bank-door', to: 'hall-door', mode: 'road', length: 30, capacity: 20, points: [{ x: 180, y: 20, z: 5 }, { x: 210, y: 20, z: 5 }] });
  const sim = new Simulation(world), officials = sim.state.citizens.filter(c => c.workId === 'hall' && c.role === '官员').slice(0, 2);
  assert.equal(officials.length, 2); sim.state.treasury = 3000;
  const cash = moneySupply(sim), policy = { taxRate: sim.state.taxRate, policeBudget: sim.state.policeBudget }, review = () => { runtime(sim).publicLaborReviewAt = 0; if (runtime(sim).publicLabor) runtime(sim).publicLabor.nextReviewAt = 0; Reflect.get(sim, 'reviewPublicShifts').call(sim); };
  review(); assert.equal(runtime(sim).publicLabor.shifts.length, 0, 'no onsite officers means no approval');
  for (const official of officials) { official.position = { x: 210, y: 20.6, z: 0 }; official.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; }
  review(); const plan = runtime(sim).publicLabor.shifts[0]; assert.ok(plan); assert.equal(plan.day, 1); assert.deepEqual(plan.approvedBy, officials.map(official => official.id));
  assert.equal(plan.cap, 0, 'standing wages and essential upkeep consume the available cash before a future commitment');
  assert.equal(sim.state.treasury, 3000); assert.equal(moneySupply(sim), cash); assert.deepEqual({ taxRate: sim.state.taxRate, policeBudget: sim.state.policeBudget }, policy);
  const worker = sim.state.citizens.find(c => c.workId === 'school' && c.role === '老师')!;
  sim.state.day = 1; sim.state.hour = 8; sim.state.extension!.lastUpdate += 1440; sim.state.family!.lastUpdate += 1440; sim.state.culture!.lastUpdate += 1440; sim.state.banking!.nextInterestAt = sim.state.extension!.lastUpdate + 60;
  let publicEarned = 0; sim.onEvent('wage-earned', event => { if (event.citizenId === worker.id) publicEarned += event.amount ?? 0; });
  placeAtWork(sim, worker, { ...sim.state.shops[0], buildingId: 'school' }); sim.step(.25);
  assert.equal(publicEarned, 0, 'an unfunded future shift cannot demand new unpaid labour'); assert.equal(sim.state.extension!.actorProfiles[worker.id].alive, true);
  const save = sim.exportSave(), restored = new Simulation(world), result = restored.importSave(save); assert.equal(result.ok, true, result.message); assert.equal(restored.exportSave(), save);
  for (const mutate of [(bad: any) => { bad.runtime.publicLabor.shifts[0].cap++; }, (bad: any) => { bad.runtime.publicLabor.shifts[0].approvedBy = [worker.id, officials[0].id]; }, (bad: any) => { bad.runtime.publicLabor.shifts[0].assignments[0].workedMinutes = 1; }]) { const bad = JSON.parse(save); mutate(bad); assert.equal(restored.importSave(JSON.stringify(bad)).ok, false); assert.equal(restored.exportSave(), save); }
});

test('construction purchases finite material and completes only after attended work, without saleable stock creation', () => {
  const sim = new Simulation(fixture()), shop = sim.state.shops.find(item => item.buildingId === 'market')!, worker = sim.state.citizens.find(c => c.workId === shop.buildingId && c.role !== '学生')!;
  sim.state.player.identities = ['traveler', 'merchant']; sim.state.player.money = 2000; sim.setFocus(sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!.door, 'walk');
  assert.equal(sim.command({ type: 'foundCompany', targetId: shop.buildingId, value: 500 }).ok, true);
  const company = sim.state.extension!.companies.find(item => item.buildingId === shop.buildingId)!, baseline = company.capital, stock = shop.inventory, cash = moneySupply(sim);
  const producers = sim.state.shops.filter(item => ['farm', 'workshop'].includes(item.buildingId)), unitsBefore = producers.reduce((sum, item) => sum + item.inventory, 0);
  assert.equal(sim.command({ type: 'expandCompany', targetId: company.id, value: 300 }).ok, true);
  const job = Reflect.get(sim.state.extension!, 'runtime').constructionJobs[company.id]; assert.equal(company.level, 1); assert.equal(company.capital, baseline + 180); assert.equal(shop.inventory, stock); assert.equal(job.materialUnits, 22.5);
  assert.equal(producers.reduce((sum, item) => sum + item.inventory, 0), unitsBefore - 22.5); assert.ok(Math.abs(moneySupply(sim) - cash) < 1e-7);
  const restored = new Simulation(sim.worldDefinition), loaded = restored.importSave(sim.exportSave()); assert.equal(loaded.ok, true, loaded.message); assert.equal(restored.exportSave(), sim.exportSave());
  placeAtWork(sim, worker, shop); assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  for (let ticks = 0; company.level < 2 && ticks < 100; ticks++) sim.step(.25);
  assert.equal(company.level, 2); assert.equal(job.workedMinutes, 60); assert.equal(job.consumedUnits, 22.5); assert.notEqual(job.completedAt, null);
  assert.ok(shop.inventory <= stock, 'construction stock never enters the food inventory'); assert.ok(Math.abs(moneySupply(sim) - cash) < 1e-7);
  const empty = new Simulation(fixture()); empty.state.player.identities = ['traveler', 'merchant']; empty.state.player.money = 2000; const site = empty.state.shops.find(item => item.buildingId === 'market')!; empty.setFocus(empty.worldDefinition.buildings.find(b => b.id === site.buildingId)!.door, 'walk'); assert.equal(empty.command({ type: 'foundCompany', targetId: site.buildingId, value: 500 }).ok, true);
  for (const item of empty.state.shops) item.inventory = 0; empty.state.trade!.ownedLots = {};
  const before = empty.exportSave(), target = empty.state.extension!.companies.find(item => item.buildingId === site.buildingId)!; assert.equal(empty.command({ type: 'expandCompany', targetId: target.id, value: 300 }).ok, false); assert.equal(empty.exportSave(), before);
});

test('private employers approve only onsite cash-backed minutes and preserve losses, old claims and future cash protection', () => {
  const sim = new Simulation(fixture()), shop = sim.state.shops.find(item => item.buildingId === 'workshop')!, site = sim.worldDefinition.buildings.find(building => building.id === shop.buildingId)!;
  const workers = sim.state.citizens.filter(citizen => citizen.workId === site.id && citizen.role !== '学生').slice(0, 2); assert.equal(workers.length, 2);
  for (const citizen of sim.state.citizens.filter(citizen => citizen.workId === site.id && !workers.includes(citizen))) citizen.role = '学生';
  shop.employees = 2; sim.transferBusinessOwnership(shop.id, workers[0].id);
  // The owner takes back only unpromised opening capital; no account is topped up.
  const withdrawn = sim.shopFunds(shop) - 20; sim.transferShopFunds(shop, -withdrawn); workers[0].money += withdrawn;
  shop.profit = -900; sim.emitEvent({ type: 'wage', citizenId: workers[1].id, shopId: shop.id, districtId: shop.districtId, amount: 10 });
  Reflect.get(sim, 'refreshWorkforce').call(sim); const supply = moneySupply(sim), loss = shop.profit;
  Reflect.get(sim, 'reviewPrivateShifts').call(sim); assert.equal(sim.shopCommittedPayroll(shop), 0, 'an absent owner cannot promise new wages');
  workers[0].position = { ...site.door }; workers[0].needs.hunger = 100; workers[0].needs.fatigue = 100;
  runtime(sim).privateLabor.nextReviewAt = sim.state.extension!.lastUpdate; Reflect.get(sim, 'reviewPrivateShifts').call(sim);
  const plan = runtime(sim).privateLabor.shifts[shop.id]; assert.ok(plan.reviews.length > 0);
  assert.ok(sim.shopCommittedPayroll(shop) > 0 && sim.shopCommittedPayroll(shop) <= 20 - 10 - 20 * 8 / 24 + 1e-8);
  assert.ok(plan.assignments.every((item: { minutesCap: number }) => item.minutesCap < 480), 'limited cash cannot authorize a full roster shift');
  const minutes = plan.assignments.find((item: { citizenId: string }) => item.citizenId === workers[0].id).minutesCap;
  Reflect.get(sim, 'registerAttendance').call(sim, workers[0], 480);
  assert.equal(runtime(sim).attendance[workers[0].id], minutes, 'only accepted minutes can become actual earned labor');
  const earned = runtime(sim).wageAccruals.find((item: { citizenId: string }) => item.citizenId === workers[0].id).amount;
  assert.ok(Math.abs(shop.profit - loss + earned) < 1e-8, 'recovery does not reset historical losses or omit new labor cost');
  assert.equal(runtime(sim).wages[0].amount, 10, 'the original creditor keeps the complete previously earned claim');
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-7, 'review and labor accrual cannot create cash');
  const save = sim.exportSave(), restored = new Simulation(fixture()); assert.equal(restored.importSave(save).ok, true); assert.equal(restored.exportSave(), save);
  for (const corrupt of [(data: any) => { data.runtime.privateLabor.shifts[shop.id].assignments[0].minutesCap += 1; }, (data: any) => { data.runtime.privateLabor.shifts[shop.id].reviews[0].ownerPosition.x += 300; }, (data: any) => { data.runtime.privateLabor.shifts[shop.id].reviews[0].cash = 0; }]) {
    const data = JSON.parse(save); corrupt(data); const before = restored.exportSave(); assert.equal(restored.importSave(JSON.stringify(data)).ok, false); assert.equal(restored.exportSave(), before);
  }
  const remaining = sim.shopCommittedPayroll(shop), recapitalization = 50; workers[0].money -= recapitalization; sim.transferShopFunds(shop, recapitalization);
  runtime(sim).privateLabor.nextReviewAt = sim.state.extension!.lastUpdate; Reflect.get(sim, 'reviewPrivateShifts').call(sim);
  assert.ok(sim.shopCommittedPayroll(shop) > remaining, 'only a real new receipt can fund an amended shift');
  assert.equal(shop.profit, loss - earned); assert.equal(runtime(sim).wages[0].amount, 10); assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-7);
});

test('a capped worker wallet retains its wage claim until a real receiving capacity is available', () => {
  const sim = new Simulation(fixture()), shop = sim.state.shops.find(item => item.buildingId === 'workshop')!, worker = sim.state.citizens.find(citizen => citizen.workId === shop.buildingId && citizen.role !== '学生')!;
  worker.money = 1e9; const supply = moneySupply(sim), funds = sim.shopFunds(shop);
  let receipts = 0; sim.onEvent('public-procurement', event => { if (event.shopId === shop.id) receipts += (event.amount ?? 0) * (1 - sim.state.taxRate); });
  sim.emitEvent({ type: 'wage', citizenId: worker.id, shopId: shop.id, districtId: shop.districtId, amount: 10 });
  const profit = shop.profit; sim.step(.25);
  assert.equal(worker.money, 1e9); assert.equal(sim.shopFunds(shop), funds + receipts);
  assert.equal(runtime(sim).wageArrears.find((item: { citizenId: string }) => item.citizenId === worker.id).amount, 10);
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-6, 'a capped recipient cannot burn the funded wage');
  const recipient = sim.state.citizens.find(citizen => citizen.id !== worker.id)!; worker.money -= 10; recipient.money += 10;
  sim.step(.25); assert.ok(Math.abs(worker.money - (1e9 - 10 + 10 * .92)) < 1e-7);
  assert.ok(!runtime(sim).wageArrears.some((item: { citizenId: string }) => item.citizenId === worker.id)); assert.ok(Math.abs(shop.profit - profit - receipts) < 1e-8, 'deferred payment does not charge the original wage expense twice');
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-6);
});

function freightFixture(): WorldDefinition { const kinds = ['farm', 'market', 'home'] as const; const buildings: Building[] = kinds.map((kind, i) => ({ id: kind, kind, name: kind, districtId: i ? 'customers' : 'growers', position: { x: i * 300, y: 20, z: 0 }, door: { x: i * 300, y: 20, z: 5 }, width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 80, seed: i })); const nodes = buildings.map(b => ({ id: b.id + '-door', districtId: b.districtId, name: b.name, position: { ...b.door }, station: true })); return { seed: 20261001, voxelSize: .2, size: 1600, buildings, nodes, edges: [{ id: 'food-road', from: nodes[0].id, to: nodes[1].id, mode: 'road', length: 300, capacity: 20, points: [nodes[0].position, nodes[1].position] }, { id: 'home-road', from: nodes[1].id, to: nodes[2].id, mode: 'bridge', length: 300, capacity: 20, points: [nodes[1].position, nodes[2].position] }], mountains: [], districts: [{ id: 'growers', name: 'growers', kind: 'river', center: { x: 0, y: 20, z: 0 }, radius: 300, color: '#aaa', population: 12 }, { id: 'customers', name: 'customers', kind: 'market', center: { x: 450, y: 20, z: 0 }, radius: 400, color: '#bbb', population: 12 }], spawn: { ...buildings[2].door }, waterfall: { top: { x: 900, y: 50, z: 0 }, bottom: { x: 900, y: 20, z: 0 }, width: 10 }, river: [] }; }
function foodSupply(s: Simulation) { return s.state.shops.filter(shop => s.shopCommodity(shop) === 'food').reduce((n, shop) => n + shop.inventory, 0) + s.state.vehicles.reduce((n, v) => n + v.cargo, 0) + Object.values(runtime(s).freight as Record<string, number>).reduce((n, q) => n + q, 0) + s.state.citizens.reduce((n, c) => n + (c.food ?? 0), 0) + (s.state.player.inventory.food ?? 0); }
function prepareFreightFixture() { const s = new Simulation(freightFixture()), farm = s.state.shops.find(shop => shop.buildingId === 'farm')!, market = s.state.shops.find(shop => shop.buildingId === 'market')!, truck = s.state.vehicles.find(v => v.id === 'vehicle-food-road-1')!; for (const c of s.state.citizens)
    c.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; for (const v of s.state.vehicles) {
    v.cargo = 0;
    if (v !== truck)
        v.nextDeparture = 1e6;
} farm.inventory = 80; farm.employees = 0; market.inventory = 0; market.employees = 0; s.state.trade!.ownedLots = {}; const owner = s.state.citizens.find(c => c.id === market.ownerId)!; const refund = s.shopFunds(market); s.transferShopFunds(market, -refund); owner.money += refund; truck.nextDeparture = 480; s.command({ type: 'speed', value: 8 }); return { s, farm, market, truck, owner }; }
const stepUntil = (s: Simulation, condition: () => boolean, cap = 1200) => { let i = 0; for (; i < cap && !condition(); i++)
    s.step(.25); assert.ok(condition(), `actual carrier condition unmet after ${i} ticks`); return i; };
test('an empty existing freight carrier loads at the real farm, delivers owner custody, and loads again after exact restoration', () => {
    const { s, farm, market, truck, owner } = prepareFreightFixture(), initialCash = moneySupply(s), initialGoods = foodSupply(s), initialLoss = farm.profit;
    let loaded = 0, delivered = 0, wholesale = 0, quantity = 0;
    const hook = (sim: Simulation) => { sim.onEvent('cargo-loaded', e => { if (e.vehicleId === truck.id) {
        assert.equal(e.shopId, farm.id);
        assert.equal(e.nodeId, 'farm-door');
        assert.ok(sim.isNearBuilding(sim.worldDefinition.buildings.find(b => b.id === 'farm')!, sim.state.vehicles.find(v => v.id === truck.id)!.position, 2));
        loaded++;
    } }); sim.onEvent('cargo-arrived', e => { if (e.shopId === farm.id)
        delivered += e.amount ?? 0; }); sim.onEvent('wholesale', e => { if (e.shopId === farm.id) {
        wholesale += e.amount ?? 0;
        quantity += e.quantity ?? 0;
    } }); };
    hook(s);
    stepUntil(s, () => loaded === 1);
    assert.equal(truck.cargo, 28);
    assert.equal(farm.inventory, 52);
    assert.equal(runtime(s).cargoSources[truck.id], farm.id);
    assert.equal(moneySupply(s), initialCash);
    assert.equal(foodSupply(s), initialGoods);
    assert.equal(farm.profit, initialLoss);
    const saved = s.exportSave();
    let restored = new Simulation(freightFixture());
    const result = restored.importSave(saved);
    assert.equal(result.ok, true, result.message);
    assert.equal(restored.exportSave(), saved);
    hook(restored);
    const buyer = restored.state.shops.find(shop => shop.id === market.id)!, proprietor = restored.state.citizens.find(c => c.id === owner.id)!, producer = restored.state.shops.find(shop => shop.id === farm.id)!;
    proprietor.money -= 40;
    restored.transferShopFunds(buyer, 40);
    const producerFunds = restored.shopFunds(producer), beforeProfit = buyer.profit;
    stepUntil(restored, () => delivered === 28 && wholesale >= 40);
    assert.equal(wholesale, 40);
    assert.equal(quantity, 10);
    assert.equal(buyer.inventory, 10);
    assert.equal(runtime(restored).freightLots.customers[0].shopId, farm.id);
    assert.equal(runtime(restored).freightLots.customers[0].quantity, 18);
    assert.ok(Math.abs(restored.shopFunds(producer) - producerFunds - 36.8) < 1e-8);
    assert.equal(runtime(restored).taxes, 0);
    assert.ok(Math.abs(foodSupply(restored) - initialGoods) < 1e-8);
    assert.ok(Math.abs(moneySupply(restored) - initialCash) < 1e-7);
    assert.equal(buyer.profit, beforeProfit, 'acquiring stock capitalizes its paid cost, not another profit expense');
    assert.equal(restored.state.trade!.ownedLots![buyer.id][0].quantity, 10);
    assert.equal(restored.state.trade!.ownedLots![buyer.id][0].unitPrice, 4);
    const emptySave = restored.exportSave();
    assert.equal(restored.state.vehicles.find(v => v.id === truck.id)!.cargo, 0);
    const afterEmptySave = new Simulation(freightFixture());
    const emptyLoad = afterEmptySave.importSave(emptySave);
    assert.equal(emptyLoad.ok, true, emptyLoad.message);
    assert.equal(afterEmptySave.exportSave(), emptySave);
    hook(afterEmptySave);
    restored = afterEmptySave;
    stepUntil(restored, () => loaded === 2);
    assert.equal(restored.state.vehicles.find(v => v.id === truck.id)!.cargo, 28);
    assert.equal(restored.state.shops.find(x => x.id === producer.id)!.inventory, 24);
    assert.equal(runtime(restored).cargoSources[truck.id], producer.id);
    assert.ok(Math.abs(foodSupply(restored) - initialGoods) < 1e-8);
    assert.ok(Math.abs(moneySupply(restored) - initialCash) < 1e-7);
});
test('a passenger bus cannot load nearby farm stock and freight cannot load a remote same-district farm', () => {
    const { s, farm, truck } = prepareFreightFixture();
    const bus = s.state.vehicles.find(v => v.id === 'vehicle-food-road-0')!;
    truck.nextDeparture = 1e6;
    bus.nextDeparture = 480;
    bus.direction = -1;
    bus.progress = .5;
    let busLoads = 0;
    s.onEvent('cargo-loaded', e => { if (e.vehicleId === bus.id)
        busLoads++; });
    const start = farm.inventory;
    for (let i = 0; i < 120; i++)
        s.step(.25);
    assert.equal(bus.cargo, 0);
    assert.equal(busLoads, 0);
    assert.equal(farm.inventory, start);
    const remoteWorld = freightFixture();
    remoteWorld.buildings.find(b => b.id === 'farm')!.districtId = 'customers';
    remoteWorld.nodes.find(n => n.id === 'farm-door')!.districtId = 'customers';
    const remote = new Simulation(remoteWorld), remoteFarm = remote.state.shops.find(x => x.buildingId === 'farm')!, carrier = remote.state.vehicles.find(v => v.id === 'vehicle-food-road-1')!;
    for (const v of remote.state.vehicles) {
        v.cargo = 0;
        if (v !== carrier)
            v.nextDeparture = 1e6;
    }
    remoteFarm.employees = 0;
    remoteFarm.inventory = 80;
    remote.state.shops.find(x => x.buildingId === 'market')!.inventory = 0;
    remote.state.trade!.ownedLots = {};
    carrier.nextDeparture = 480;
    carrier.direction = 1;
    carrier.progress = .99999;
    runtime(remote).signalOverrides['market-door'] = 1;
    let loads = 0;
    remote.onEvent('cargo-loaded', () => loads++);
    remote.step(.25);
    assert.equal(carrier.cargo, 0);
    assert.equal(loads, 0, 'the stock at a different node cannot teleport into a truck');
});
test('both loaded and empty generated freight carriers resume the exact same 24 ticks', () => {
    for (const loaded of [false, true]) {
        const { s, truck } = prepareFreightFixture();
        if (loaded)
            stepUntil(s, () => truck.cargo === 28);
        const saved = s.exportSave(), restored = new Simulation(freightFixture());
        const result = restored.importSave(saved);
        assert.equal(result.ok, true, result.message);
        assert.equal(restored.exportSave(), saved);
        for (let tick = 0; tick < 24; tick++) {
            s.step(.25);
            restored.step(.25);
            assert.equal(restored.exportSave(), s.exportSave(), `${loaded ? 'loaded' : 'empty'} carrier, tick ${tick + 1}`);
        }
    }
});
test('real ten-seat passengers and their driver keep their places when a freight pickup would require two seats', () => {
    const { s, farm, truck } = prepareFreightFixture();
    const market = s.worldDefinition.buildings.find(b => b.id === 'market')!;
    truck.position = { ...market.door };
    truck.progress = 1;
    truck.direction = -1;
    s.state.player.identities = ['traveler', 'driver'];
    s.setFocus(market.door, 'walk');
    assert.equal(s.command({ type: 'drive', targetId: truck.id }).ok, true);
    const passengers = s.state.citizens.slice(0, 9), beforeFares = s.state.treasury;
    for (const passenger of passengers) {
        passenger.position = { ...market.door };
        passenger.destinationId = 'farm';
        passenger.route = [];
        passenger.routeIndex = 0;
        passenger.needs = { hunger: 15, fatigue: 100, social: 100, fun: 100 };
        passenger.food = 0;
        runtime(s).activities[passenger.id] = 'eat';
        runtime(s).decisionAt[passenger.id] = 10000;
    }
    s.step(.25);
    assert.equal(truck.passengers, 10, 'nine people actually bought native tickets, plus the driver');
    assert.equal(s.state.treasury - beforeFares, 36);
    for (const passenger of passengers) {
        assert.equal(runtime(s).riders[passenger.id].vehicleId, truck.id);
        // These paid passengers take a round trip. The stop is a real referenced
        // node; the existing rider model keeps them aboard at intermediate nodes.
        runtime(s).riders[passenger.id].stopNodeId = 'market-door';
    }
    let pickupArrival = false, pickups = 0;
    s.onEvent('cargo-loaded', () => pickups++);
    s.onPhase('traffic', () => {
        if (truck.progress === 0 && truck.edgeId === 'food-road' && truck.direction === 1)
            pickupArrival = true;
    });
    s.driveInput(1, 0, false);
    stepUntil(s, () => pickupArrival, 120);
    assert.equal(truck.cargo, 0);
    assert.equal(farm.inventory, 80);
    assert.equal(pickups, 0);
    assert.equal(truck.passengers, 10);
    assert.equal(s.state.player.vehicleId, truck.id);
    assert.equal(runtime(s).driving.vehicleId, truck.id);
    assert.equal(runtime(s).driving.throttle, 1);
    for (const passenger of passengers)
        assert.equal(runtime(s).riders[passenger.id].arrived, undefined);
    const saved = s.exportSave(), restored = new Simulation(freightFixture());
    const result = restored.importSave(saved);
    assert.equal(result.ok, true, result.message);
    assert.equal(restored.exportSave(), saved);
    for (let tick = 0; tick < 24; tick++) {
        s.step(.25);
        restored.step(.25);
    }
    assert.equal(restored.exportSave(), s.exportSave(), 'driver and paid passenger contracts survive exact continuation');
    const remainingTicks = stepUntil(s, () => pickups > 0, 120);
    for (let tick = 0; tick < remainingTicks; tick++)
        restored.step(.25);
    assert.equal(restored.exportSave(), s.exportSave());
    assert.ok(pickups > 0, 'after the actual paid passengers finish their round trip, the driver can collect the existing stock');
});
test('a saved passenger bus carrying existing stock never gains a generated freight role', () => {
    const { s, farm, truck } = prepareFreightFixture();
    const bus = s.state.vehicles.find(v => v.id === 'vehicle-food-road-0')!;
    truck.nextDeparture = 1e6;
    bus.nextDeparture = 480;
    bus.direction = -1;
    bus.progress = .5;
    farm.inventory -= 7;
    bus.cargo = 7;
    runtime(s).cargoSources[bus.id] = farm.id;
    const stock = foodSupply(s), cash = moneySupply(s), saved = s.exportSave();
    const restored = new Simulation(freightFixture());
    const result = restored.importSave(saved);
    assert.equal(result.ok, true, result.message);
    assert.equal(restored.exportSave(), saved);
    let pickups = 0;
    restored.onEvent('cargo-loaded', () => pickups++);
    stepUntil(restored, () => (runtime(restored).freight.growers ?? 0) === 7);
    assert.equal(restored.state.vehicles.find(v => v.id === bus.id)!.cargo, 0);
    assert.equal(restored.state.shops.find(shop => shop.id === farm.id)!.inventory, 73);
    assert.equal(pickups, 0);
    assert.equal(runtime(restored).freightLots.growers[0].shopId, farm.id);
    assert.ok(Math.abs(foodSupply(restored) - stock) < 1e-8);
    assert.ok(Math.abs(moneySupply(restored) - cash) < 1e-8);
});
