import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import type { BuildingKind, Citizen, Shop, WorldDefinition } from '../src/types';

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
}
function moneySupply(sim: Simulation) {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money + s.citizens.reduce((sum, c) => sum + c.money, 0)
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
  assert.equal(shop.profit, profit - 30); assert.equal(runtime(sim).wages.length, 0);
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
  const sim = new Simulation(fixture()), supplier = sim.state.shops.find(s => s.buildingId === 'farm')!;
  for (const shop of sim.state.shops) shop.inventory = shop === supplier ? 10 : shop.buildingId === 'market' ? 90 : 0;
  let purchase = 0, units = 0; sim.onEvent('public-procurement', event => { purchase += event.amount ?? 0; units += event.quantity ?? 0; assert.equal(event.shopId, supplier.id); });
  const supply = moneySupply(sim), funds = sim.shopFunds(supplier), treasury = sim.state.treasury;
  sim.step(.25);
  assert.ok(purchase > 0); assert.ok(Math.abs(supplier.inventory - (10 - units)) < 1e-8);
  assert.ok(Math.abs(sim.shopFunds(supplier) - funds - purchase * .92) < 1e-8);
  assert.ok(Math.abs(sim.state.treasury - treasury + purchase * .92) < 1e-8);
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-7);
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


test('welfare treatment consumes finite medical supplies and cannot heal from an empty supplier', () => {
  const sim = new Simulation(fixture()), supplier = sim.state.shops.find(shop => shop.buildingId === 'farm')!;
  const citizen = sim.state.citizens.find(c => c.role !== '学生')!, profile = sim.state.extension!.actorProfiles[citizen.id];
  citizen.money = 0; profile.health = 40; citizen.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  for (const shop of sim.state.shops) shop.inventory = 0;
  const clinic = sim.worldDefinition.buildings.find(building => building.kind === 'clinic')!;
  sim.onPhase('traffic', () => { citizen.position = { ...clinic.door }; });
  let payment = 0, consumed = 0;
  sim.onEvent('medical-procurement', event => { payment += event.amount ?? 0; consumed += event.quantity ?? 0; assert.equal(event.shopId, supplier.id); });
  const supply = moneySupply(sim);
  sim.step(.25);
  assert.equal(payment, 0); assert.ok(profile.health < 41, 'empty medical supply cannot provide a full treatment');
  supplier.inventory = 1; const funds = sim.shopFunds(supplier), health = profile.health;
  sim.step(.25);
  assert.equal(payment, 4); assert.equal(consumed, 1); assert.equal(supplier.inventory, 0);
  assert.ok(profile.health > health + 3 && profile.health < health + 4, 'one available unit supplies exactly a fraction of the thirty-coin treatment');
  assert.ok(Math.abs(sim.shopFunds(supplier) - funds - 4 * .92) < 1e-8);
  assert.ok(Math.abs(moneySupply(sim) - supply) < 1e-7);
});
