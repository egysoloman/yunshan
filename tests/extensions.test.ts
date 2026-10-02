import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { createWorld } from '../src/world.ts';
import type { Building, BuildingKind, CityExtensionState, Command, Company, Role, SimState, Technology, Vec3, WorldDefinition } from '../src/types.ts';

/** Actual facilities and two connected districts keep these tests independent of world generation. */
function fixture(): WorldDefinition {
  const facilities: { kind: BuildingKind; facility?: Building['facility'] }[] = [
    { kind: 'home' }, { kind: 'market' }, { kind: 'workshop' }, { kind: 'bank' },
    { kind: 'hall', facility: 'mayor' }, { kind: 'police' }, { kind: 'school' },
    { kind: 'clinic' }, { kind: 'station' }, { kind: 'core', facility: 'data' },
    { kind: 'pavilion' }, { kind: 'airport' }, { kind: 'starport' }, { kind: 'farm' },
    { kind: 'dock' }, { kind: 'hall', facility: 'administration' },
    { kind: 'hall', facility: 'treasury' }, { kind: 'hall', facility: 'archives' },
    { kind: 'core', facility: 'energy' }, { kind: 'hall', facility: 'council' },
    { kind: 'police', facility: 'emergency' },
  ];
  const districts = [0, 1].map(index => ({
    id: `extension-district-${index}`, name: `扩展测试城区 ${index}`,
    kind: index ? 'residential' : 'market', center: { x: index * 4000, y: index * 80, z: 0 },
    radius: 1800, color: '#77aabb', population: 120,
  }));
  const buildings = districts.flatMap((district, districtIndex) => facilities.map(({ kind, facility }, index) => {
    const position = { x: district.center.x + index * 70, y: district.center.y, z: 0 };
    return {
      id: `${district.id}-${facility ?? kind}`, districtId: district.id,
      name: `${district.name} ${facility ?? kind}`, kind, facility, position,
      door: { ...position, z: 5 }, width: 10, depth: 10, height: 12,
      floors: 2, rotation: 0, capacity: 30, seed: districtIndex * 100 + index,
    };
  }));
  const nodes = districts.flatMap(district => [0, 1].map(index => ({
    id: `${district.id}-node-${index}`, districtId: district.id, name: `交通节点 ${index}`,
    position: { x: district.center.x + index * 200, y: district.center.y, z: 20 }, station: true,
  })));
  const edges = [
    { id: 'extension-road', from: nodes[0].id, to: nodes[1].id, mode: 'road' as const, length: 200, capacity: 20, points: [nodes[0].position, nodes[1].position] },
    { id: 'extension-maglev', from: nodes[1].id, to: nodes[2].id, mode: 'maglev' as const, length: 3800, capacity: 80, points: [nodes[1].position, nodes[2].position] },
    { id: 'extension-flight', from: nodes[2].id, to: nodes[3].id, mode: 'flight' as const, length: 200, capacity: 30, points: [nodes[2].position, { x: 4100, y: 180, z: 20 }, nodes[3].position] },
  ];
  return {
    seed: 1977, voxelSize: 0.2, size: 6000, districts, buildings, nodes, edges,
    mountains: [], spawn: { x: 0, y: 0, z: 0 },
    waterfall: { top: { x: 300, y: 100, z: 100 }, bottom: { x: 300, y: 0, z: 100 }, width: 20 },
    river: [{ x: 300, y: 0, z: 100 }, { x: 300, y: 0, z: 500 }],
  };
}

function create() {
  const world = fixture();
  const sim = new Simulation(world);
  ok(sim, { type: 'speed', value: 8 });
  return { world, sim };
}

function extension(sim: Simulation): CityExtensionState {
  assert.ok(sim.state.extension, 'the extension must be installed by the normal Simulation constructor');
  return sim.state.extension;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function observeDividends(sim: Simulation) {
  const payments = new Map<string, number>();
  sim.onPhase('commerce', () => payments.clear());
  sim.onEvent('business-dividend', event => { if (event.citizenId) payments.set(event.citizenId, (payments.get(event.citizenId) ?? 0) + (event.amount ?? 0)); });
  return payments;
}
function walkTo(sim: Simulation, position: Vec3) { sim.setFocus({ ...position }, 'walk'); }
function pinClinicDoctor(sim: Simulation, patientId = 'player', doctorId?: string) {
  const clinic = building(sim.worldDefinition, 'clinic');
  const doctor = doctorId ? sim.state.citizens.find(c => c.id === doctorId)! : sim.state.citizens.find(c => c.id !== patientId && c.role !== '学生' && !sim.state.shops.some(shop => shop.buildingId === c.workId || sim.shopOwnerId(shop) === c.id))!;
  assert.ok(doctor, 'a real adult public employee must be available for the physician fixture');
  doctor.role = '医生'; doctor.workId = clinic.id; extension(sim).actorProfiles[doctor.id].health = 100;
  sim.onPhase('traffic', () => {
    doctor.position = { ...clinic.door }; doctor.destinationId = clinic.id; doctor.route = []; doctor.routeIndex = 0;
    doctor.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
    const core = Reflect.get(sim, 'runtime'); core.activities[doctor.id] = 'work'; core.decisionAt[doctor.id] = 1e9;
  });
  return doctor;
}
function building(world: WorldDefinition, kind: BuildingKind, districtIndex = 0): Building {
  const result = world.buildings.find(item => item.kind === kind && item.districtId === world.districts[districtIndex].id);
  assert.ok(result, `the fixture must provide a ${kind} facility`);
  return result;
}

function ok(sim: Simulation, command: Command) {
  const result = sim.command(command);
  assert.equal(result.ok, true, `${command.type}: ${result.message}`);
  return result;
}

function rejectWithoutMutation(sim: Simulation, command: Command) {
  const before = sim.exportSave();
  const result = sim.command(command);
  assert.equal(result.ok, false, `${command.type} must reject this operation`);
  assert.equal(sim.exportSave(), before, 'a rejected command must leave both state and runtime intact');
}

function advanceUntil(sim: Simulation, predicate: () => boolean, limit = 4000) {
  for (let index = 0; index < limit && !predicate(); index++) sim.step(0.25);
  assert.ok(predicate(), 'simulation did not reach the expected observable state');
}

function advanceMinutes(sim: Simulation, minutes: number, limit = 4000) {
  const deadline = extension(sim).lastUpdate + minutes;
  advanceUntil(sim, () => extension(sim).lastUpdate + 1e-7 >= deadline, limit);
}

function finishConstruction(sim: Simulation, company: Company) {
  const job = Reflect.get(extension(sim), 'runtime').constructionJobs[company.id], site = sim.worldDefinition.buildings.find(building => building.id === company.buildingId)!;
  const worker = sim.state.citizens.find(citizen => citizen.workId === site.id && citizen.role !== '学生' && extension(sim).actorProfiles[citizen.id].age >= 18)!;
  assert.ok(worker, 'construction needs an actual adult employee');
  const runtime = Reflect.get(sim, 'runtime');
  sim.onPhase('traffic', () => {
    if (job.completedAt !== null) return;
    worker.position = { ...site.door }; worker.destinationId = site.id; worker.route = []; worker.routeIndex = 0;
    worker.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
    runtime.activities[worker.id] = 'work'; runtime.decisionAt[worker.id] = sim.state.day * 1440 + sim.state.hour * 60 + 60;
  });
  walkTo(sim, site.door);
  const before = extension(sim).lastUpdate;
  advanceUntil(sim, () => job.completedAt !== null, 300);
  assert.equal(job.workedMinutes, 60); assert.equal(job.consumedUnits, job.materialUnits);
  assert.ok(extension(sim).lastUpdate > before, 'construction cannot finish in its authorizing command');
}

function residentResearchPayments(sim: Simulation) {
  const entries = extension(sim).publicLedger.filter(entry => entry.tick === sim.state.tick && entry.purpose.includes('居民科研投入'));
  for (const entry of entries) {
    assert.equal(entry.amount, 200, 'every autonomous experiment has the actual personal research cost');
    assert.ok(sim.state.citizens.some(citizen => citizen.id === entry.actorId), 'a resident investment must name a real payer');
  }
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

function approximately(actual: number, expected: number, message: string, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function sharesAreConserved(company: Company) {
  const holdings = Object.values(company.shareholders);
  assert.ok(holdings.every(shares => Number.isInteger(shares) && shares >= 0), 'all ownership stakes must be nonnegative whole shares');
  assert.equal(holdings.reduce((sum, shares) => sum + shares, 0), company.shares, 'issued company shares must equal recorded ownership');
}

function restoredFrom(sim: Simulation) {
  const restored = new Simulation(sim.worldDefinition);
  const result = restored.importSave(sim.exportSave());
  assert.equal(result.ok, true, `valid extension state must survive normal save/load: ${result.message}`);
  assert.deepEqual(restored.state, sim.state);
  return restored;
}

function finiteTree(value: unknown, path = 'extension') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} must remain finite`);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) finiteTree(item, `${path}.${key}`);
  }
}

function grant(sim: Simulation, identity: Role) {
  sim.state.player.identities = [...new Set([...(sim.state.player.identities ?? ['traveler']), identity])];
  sim.state.player.role = identity;
}

function foundCompany(sim: Simulation, world: WorldDefinition, districtIndex = 0) {
  const site = world.buildings.find(item => item.districtId === world.districts[districtIndex].id
    && ['market', 'workshop', 'farm', 'dock'].includes(item.kind)
    && !extension(sim).companies.some(company => company.buildingId === item.id));
  assert.ok(site, 'the fixture must contain an unoccupied commercial facility');
  walkTo(sim, site.door);
  ok(sim, { type: 'foundCompany', targetId: site.id, value: 500 });
  const company = extension(sim).companies.find(item => item.buildingId === site.id && item.ownerId === 'player');
  assert.ok(company, 'founding must attach a company to the actual local facility');
  return company;
}

test('extension installation supplies all research sectors and persistent profiles without changing the ten phase order', () => {
  const { sim } = create();
  const state = extension(sim);
  assert.deepEqual(state.technologies.map(item => item.sector).sort(),
    ['agriculture', 'energy', 'information', 'manufacturing', 'medicine', 'security', 'traffic']);
  assert.deepEqual(Object.keys(state.actorProfiles).sort(), ['player', ...sim.state.citizens.map(item => item.id)].sort());
  assert.ok(Object.values(state.actorProfiles).every(profile => profile.alive && profile.health > 0));
  assert.ok(state.organizations.length > 0, 'culture and social institutions must be real persistent organizations');
  finiteTree(state);
  for (const company of state.companies) sharesAreConserved(company);
  const before = state.lastUpdate;
  sim.step(0.25);
  approximately(state.lastUpdate - before, 2, 'extension timers use the same two simulated minutes as the base tick');
  assert.deepEqual(sim.state.lastSystemOrder,
    ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback']);
});

test('company founding and expansion require local merchant authority and move real money into recorded ownership', () => {
  const { sim, world } = create();
  const site = building(world, 'market');
  sim.state.player.money = 10_000;
  walkTo(sim, site.door);
  rejectWithoutMutation(sim, { type: 'foundCompany', targetId: site.id, value: 500 });
  grant(sim, 'merchant');
  walkTo(sim, { ...site.door, z: site.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'foundCompany', targetId: site.id, value: 500 });
  walkTo(sim, site.door);
  const money = sim.state.player.money;
  const company = foundCompany(sim, world);
  assert.equal(company.capital, 500);
  assert.equal(sim.state.player.money, money - 550, 'the founding capital and registration fee must be paid');
  assert.equal(company.shareholders.player, company.shares);
  assert.equal(company.districtId, site.districtId);
  sharesAreConserved(company);
  grant(sim, 'scientist');
  assert.equal(sim.state.player.role, 'scientist', 'the active identity may change while merchant authority remains stacked');
  rejectWithoutMutation(sim, { type: 'foundCompany', targetId: site.id, value: 500 });
  for (const value of [0, -1, 99, Number.NaN, Number.POSITIVE_INFINITY]) {
    rejectWithoutMutation(sim, { type: 'expandCompany', targetId: company.id, value });
  }
  const before = { capital: company.capital, money: sim.state.player.money, level: company.level };
  const treasury = sim.state.treasury, suppliersBefore = sim.state.shops.filter(shop => ['farm', 'workshop', 'dock'].includes(world.buildings.find(building => building.id === shop.buildingId)!.kind)).reduce((sum, shop) => sum + sim.shopFunds(shop), 0);
  ok(sim, { type: 'expandCompany', targetId: company.id, value: 300 });
  assert.equal(before.money - sim.state.player.money, 300);
  const suppliersAfter = sim.state.shops.filter(shop => ['farm', 'workshop', 'dock'].includes(world.buildings.find(building => building.id === shop.buildingId)!.kind)).reduce((sum, shop) => sum + sim.shopFunds(shop), 0);
  const job = Reflect.get(extension(sim), 'runtime').constructionJobs[company.id];
  approximately(company.capital - before.capital + sim.state.treasury - treasury + suppliersAfter - suppliersBefore + job.materialCost * sim.state.taxRate, 300,
    'expansion allocates working capital, actual supplier money, pending supplier tax and its public permit');
  assert.ok(company.capital > before.capital);
  assert.equal(company.level, before.level, 'physical construction must wait for actual onsite labor');
  finishConstruction(sim, company);
  assert.equal(company.level, before.level + 1);
  sharesAreConserved(company);
  walkTo(sim, { ...site.door, z: site.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'hire', targetId: company.id, value: 1 });
  walkTo(sim, site.door);
  const staff = company.employees;
  const capital = company.capital;
  const jobs = new Map(sim.state.citizens.map(citizen => [citizen.id, { workId: citizen.workId, skill: extension(sim).actorProfiles[citizen.id].skill }]));
  ok(sim, { type: 'hire', targetId: company.id, value: 2 });
  assert.equal(company.employees, staff + 2);
  assert.equal(company.capital, capital - 100);
  assert.equal(sim.state.shops.find(item => item.buildingId === site.id)!.employees, company.employees,
    'staffing the company must change the operating shop');
  const recruits = sim.state.citizens.filter(citizen => citizen.workId === site.id && jobs.get(citizen.id)!.workId !== site.id);
  assert.equal(recruits.length, 2, 'hiring must move two actual residents into the new jobs');
  for (const citizen of recruits) {
    assert.ok(citizen.historyTags!.includes('受雇于新公司'));
    assert.equal(extension(sim).actorProfiles[citizen.id].skill, jobs.get(citizen.id)!.skill + 1);
  }
});

test('a civic facility in a commercial building shape cannot create a private company or sell nonexistent food stock', async t => {
  for (const kind of ['workshop', 'market', 'farm'] as const) {
    await t.test(`public data facility in a ${kind}`, () => {
      const world = fixture();
      const lab = world.buildings.find(site => site.facility === 'data')!;
      lab.kind = kind;
      const sim = new Simulation(world);
      ok(sim, { type: 'speed', value: 8 });
      grant(sim, 'merchant');
      sim.state.player.money = 10_000;
      walkTo(sim, lab.door);
      assert.ok(sim.isNearBuilding(lab), 'the merchant must actually reach the civic facility');
      assert.equal(sim.state.shops.some(shop => shop.buildingId === lab.id), false,
        'the normal constructor must provide no private shop account for a public laboratory');
      rejectWithoutMutation(sim, { type: 'foundCompany', targetId: lab.id, value: 500 });
      if (kind !== 'workshop') rejectWithoutMutation(sim, { type: 'buyIngredient', targetId: 'grain', value: 1 });
      assert.equal(extension(sim).companies.some(company => company.buildingId === lab.id), false);
      assert.equal(sim.state.player.inventory['ingredient:grain'] ?? 0, 0);
    });
  }
});

test('a company records each actual shop sale once, and a saved city keeps the revenue cursor', () => {
  const { sim, world } = create();
  sim.state.player.money = 10_000;
  grant(sim, 'merchant');
  const company = foundCompany(sim, world);
  const shop = sim.state.shops.find(item => item.buildingId === company.buildingId)!;
  assert.ok(shop);
  const companyRevenue = company.revenue;
  const shopRevenue = shop.revenue;
  ok(sim, { type: 'buyIngredient', targetId: 'grain', value: 1 });
  assert.ok(shop.revenue > shopRevenue);
  advanceMinutes(sim, 10);
  approximately(company.revenue - companyRevenue, shop.revenue - shopRevenue,
    'company revenue must be derived from the same operating shop receipts');
  const restored = restoredFrom(sim);
  const restoredCompany = extension(restored).companies.find(item => item.id === company.id)!;
  const restoredShop = restored.state.shops.find(item => item.id === shop.id)!;
  const checkpoint = { company: restoredCompany.revenue, shop: restoredShop.revenue };
  for (let index = 0; index < 30; index++) {
    sim.step(0.25);
    restored.step(0.25);
    assert.deepEqual(restored.state, sim.state, 'loading must preserve the shop receipt cursor');
  }
  approximately(restoredCompany.revenue - checkpoint.company, restoredShop.revenue - checkpoint.shop,
    'previous sales must not be credited again on later finance ticks');
});

test('listing, share trading and acquisition conserve ownership and settle actual buyer and seller balances', () => {
  const { sim, world } = create();
  grant(sim, 'merchant');
  sim.state.player.money = 100_000;
  const company = foundCompany(sim, world);
  const bank = building(world, 'bank');
  walkTo(sim, bank.door);
  rejectWithoutMutation(sim, { type: 'listCompany', targetId: company.id });
  walkTo(sim, world.buildings.find(item => item.id === company.buildingId)!.door);
  ok(sim, { type: 'expandCompany', targetId: company.id, value: 300 });
  finishConstruction(sim, company);
  const initialShares = company.shares;
  const money = sim.state.player.money;
  walkTo(sim, bank.door);
  ok(sim, { type: 'listCompany', targetId: company.id });
  assert.equal(company.listed, true);
  assert.equal(sim.state.player.money, money - 200);
  assert.ok(company.shares > initialShares);
  assert.ok(company.shareholders.exchange > 0, 'IPO shares must create a finite tradeable supply');
  sharesAreConserved(company);
  rejectWithoutMutation(sim, { type: 'listCompany', targetId: company.id });
  for (const value of [0, -1, 0.5, company.shareholders.exchange + 1]) {
    rejectWithoutMutation(sim, { type: 'buyShares', targetId: company.id, value });
  }
  walkTo(sim, { ...bank.door, z: bank.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'buyShares', targetId: company.id, value: 10 });
  walkTo(sim, bank.door);
  const price = company.sharePrice;
  const before = { money: sim.state.player.money, capital: company.capital, owned: company.shareholders.player, exchange: company.shareholders.exchange };
  ok(sim, { type: 'buyShares', targetId: company.id, value: 10 });
  approximately(before.money - sim.state.player.money, price * 10, 'share purchase must pay the actual quoted price');
  approximately(company.capital - before.capital, price * 10, 'the company exchange account receives purchased shares');
  assert.equal(company.shareholders.player, before.owned + 10);
  assert.equal(company.shareholders.exchange, before.exchange - 10);
  sharesAreConserved(company);
  const salePrice = company.sharePrice;
  const sellMoney = sim.state.player.money;
  const sellCapital = company.capital;
  ok(sim, { type: 'sellShares', targetId: company.id, value: 10 });
  approximately(sim.state.player.money - sellMoney, salePrice * 10, 'the seller receives the actual sale quote');
  approximately(sellCapital - company.capital, salePrice * 10, 'the exchange must pay the sale from company funds');
  assert.equal(company.shareholders.player, before.owned);
  assert.equal(company.shareholders.exchange, before.exchange);
  sharesAreConserved(company);
  rejectWithoutMutation(sim, { type: 'sellShares', targetId: company.id, value: company.shareholders.player + 1 });
  const target = extension(sim).companies.find(item => item.id !== company.id && item.ownerId !== 'player' && !item.parentId);
  assert.ok(target, 'the initial city must include an independently owned company for acquisition');
  const targetBuilding = world.buildings.find(item => item.id === target.buildingId)!;
  rejectWithoutMutation(sim, { type: 'acquireCompany', targetId: target.id });
  walkTo(sim, targetBuilding.door);
  const wealth = () => sim.state.player.money + sim.state.citizens.reduce((sum, citizen) => sum + citizen.money, 0)
    + extension(sim).companies.reduce((sum, item) => sum + item.capital, 0);
  const beforeWealth = wealth();
  const beforePlayerMoney = sim.state.player.money;
  ok(sim, { type: 'acquireCompany', targetId: target.id });
  assert.ok(sim.state.player.money < beforePlayerMoney);
  approximately(wealth(), beforeWealth, 'acquisition payment must reach real selling shareholders');
  assert.equal(target.ownerId, 'player');
  assert.equal(target.parentId, company.id);
  assert.equal(target.shareholders.player, target.shares);
  sharesAreConserved(target);
  rejectWithoutMutation(sim, { type: 'acquireCompany', targetId: target.id });
});

test('research requires nearby scientific training and rejects unfunded or unknown projects atomically', () => {
  const { sim, world } = create();
  const lab = building(world, 'core');
  sim.state.player.money = 10_000;
  walkTo(sim, lab.door);
  rejectWithoutMutation(sim, { type: 'research', targetId: 'energy', value: 200 });
  grant(sim, 'scientist');
  rejectWithoutMutation(sim, { type: 'research', targetId: 'energy', value: 200 });
  sim.state.player.education = 3;
  walkTo(sim, { ...lab.door, z: lab.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'research', targetId: 'energy', value: 200 });
  walkTo(sim, lab.door);
  for (const value of [0, -1, 99, 2001, Number.NaN, Number.POSITIVE_INFINITY]) {
    rejectWithoutMutation(sim, { type: 'research', targetId: 'energy', value });
  }
  rejectWithoutMutation(sim, { type: 'research', targetId: 'unknown-sector', value: 200 });
  sim.state.player.money = 199;
  rejectWithoutMutation(sim, { type: 'research', targetId: 'energy', value: 200 });
});

test('each of the seven technologies spends resources and completes after elapsed research time', async t => {
  const sectors: Technology['sector'][] = ['traffic', 'energy', 'information', 'security', 'medicine', 'agriculture', 'manufacturing'];
  for (const sector of sectors) {
    await t.test(sector, () => {
      const { sim, world } = create();
      const technology = extension(sim).technologies.find(item => item.sector === sector)!;
      sim.state.player.money = 10_000;
      sim.state.player.education = 3;
      grant(sim, 'scientist');
      walkTo(sim, building(world, 'core').door);
      const before = { money: sim.state.player.money, level: technology.level, completed: extension(sim).stats.researchCompleted };
      ok(sim, { type: 'research', targetId: sector, value: 200 });
      assert.equal(sim.state.player.money, before.money - 200);
      assert.ok(technology.funding > 0);
      assert.equal(technology.level, before.level, 'paying for research must not instantly unlock a technology');
      advanceMinutes(sim, 60);
      assert.equal(technology.level, before.level, 'half of the stated research time is too early');
      assert.ok(technology.progress > 0 && technology.progress < 100);
      const restored = restoredFrom(sim);
      advanceMinutes(sim, 60);
      advanceMinutes(restored, 60);
      assert.deepEqual(restored.state, sim.state, 'research completion must keep its original timer across save/load');
      assert.equal(technology.level, before.level + 1);
      assert.equal(extension(sim).stats.researchCompleted, before.completed + 1);
      assert.ok(technology.sideEffect > 0, 'technology upgrades must record their environmental or social cost');
      finiteTree(extension(sim));
    });
  }
});

test('completed technologies change their connected city systems and expose ecological costs', async t => {
  const produced = new WeakMap<Simulation, { units: number; minutes: number }>();
  const effects: { sector: Technology['sector']; value: (sim: Simulation) => number }[] = [
    { sector: 'traffic', value: sim => sim.state.vehicles.reduce((sum, vehicle) => sum + vehicle.speed, 0) },
    { sector: 'energy', value: sim => sim.state.energy },
    { sector: 'information', value: sim => extension(sim).institutions.education },
    { sector: 'security', value: sim => sim.state.districts.reduce((sum, district) => sum + district.safety, 0) },
    { sector: 'medicine', value: sim => extension(sim).actorProfiles.player.health },
    { sector: 'agriculture', value: sim => produced.get(sim)!.units },
    { sector: 'manufacturing', value: sim => produced.get(sim)!.units },
  ];
  for (const effect of effects) {
    await t.test(effect.sector, () => {
      const { sim, world } = create();
      const control = create().sim;
      for (const city of [sim, control]) {
        city.state.player.money = 10_000;
        city.state.player.education = 3;
        grant(city, 'scientist');
        walkTo(city, building(world, 'core').door);
        extension(city).actorProfiles.player.health = 40;
        if (effect.sector === 'energy') {
          for (const district of city.state.districts) district.pollution = 100;
          ok(city, { type: 'setTime', value: 23 });
        }
        if (effect.sector === 'agriculture' || effect.sector === 'manufacturing') {
          // Compare actual output, including goods subsequently purchased by
          // residents or public services. Ending stock alone omits those goods.
          const kind = effect.sector === 'agriculture' ? 'farm' : 'workshop';
          for (const shop of city.state.shops.filter(shop => world.buildings.find(b => b.id === shop.buildingId)!.kind === kind)) shop.inventory = 0;
          const site = building(world, kind), shop = city.state.shops.find(shop => shop.buildingId === site.id)!;
          const worker = city.state.citizens.find(c => c.role !== '学生')!;
          worker.workId = site.id; worker.role = kind === 'farm' ? '农民' : '工人'; shop.employees++;
          worker.position = { ...site.position, y: site.position.y + .6 }; worker.destinationId = site.id; worker.route = []; worker.routeIndex = 0;
          worker.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
          const core = Reflect.get(city, 'runtime'); core.activities[worker.id] = 'work'; core.decisionAt[worker.id] = 10000;
          const ownerId = city.shopOwnerId(shop), owner = ownerId === 'player' ? city.state.player : city.state.citizens.find(c => c.id === ownerId)!;
          owner.position = clone(site.door); owner.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
          const capital = Math.max(0, 80 - city.shopFunds(shop));
          assert.ok(owner.money >= capital); owner.money -= capital; city.transferShopFunds(shop, capital);
          extension(city).actorProfiles[ownerId!].health = 100;
          const output = { units: 0, minutes: 0 }; produced.set(city, output);
          city.onEvent('production', event => { if (event.shopId === shop.id) { output.units += event.amount ?? 0; output.minutes += event.minutes ?? 0; } });
          city.onPhase('traffic', () => {
            // Controlled onsite staff receive a real employer-funded contract;
            // no wage, attendance, labour or output is injected by this fixture.
            owner.position = clone(site.door); worker.position = clone(site.door);
            worker.destinationId = site.id; worker.route = []; worker.routeIndex = 0;
            core.activities[worker.id] = 'work'; core.decisionAt[worker.id] = 10000;
          });
        }
      }
      ok(sim, { type: 'research', targetId: effect.sector, value: 200 });
      advanceMinutes(sim, effect.sector === 'agriculture' || effect.sector === 'manufacturing' ? 142 : 122);
      advanceMinutes(control, effect.sector === 'agriculture' || effect.sector === 'manufacturing' ? 142 : 122);
      assert.ok(effect.value(sim) > effect.value(control), `${effect.sector} research must benefit the connected running system (${effect.value(sim)} vs ${effect.value(control)}; labour ${JSON.stringify(produced.get(sim))} / ${JSON.stringify(produced.get(control))})`);
      if (produced.has(sim)) approximately(produced.get(sim)!.minutes, produced.get(control)!.minutes,
        'the technology comparison must use the same actual funded labour');
      const pollution = (city: Simulation) => city.state.districts.reduce((sum, district) => sum + district.pollution, 0);
      if (effect.sector !== 'energy') assert.ok(pollution(sim) > pollution(control), 'research externalities must feed back into actual district pollution');
      assert.ok(extension(sim).environment.biodiversity < extension(control).environment.biodiversity,
        'technology costs must affect ecology rather than remaining a display-only counter');
    });
  }
});

test('pausing freezes extension jobs and manually changing the hour does not complete paid research', () => {
  const { sim, world } = create();
  grant(sim, 'scientist');
  sim.state.player.money = 10_000;
  sim.state.player.education = 3;
  walkTo(sim, building(world, 'core').door);
  ok(sim, { type: 'research', targetId: 'medicine', value: 200 });
  const technology = extension(sim).technologies.find(item => item.sector === 'medicine')!;
  const timer = extension(sim).lastUpdate;
  ok(sim, { type: 'setTime', value: 23 });
  assert.equal(extension(sim).lastUpdate, timer, 'the clock slider must not spend research time');
  assert.equal(technology.progress, 0);
  ok(sim, { type: 'pause', value: 1 });
  const frozen = sim.exportSave();
  sim.step(30);
  assert.equal(sim.exportSave(), frozen);
  ok(sim, { type: 'pause', value: 0 });
  advanceMinutes(sim, 120);
  assert.ok(technology.level > 0);
});

function buyIngredient(sim: Simulation, ingredient: 'grain' | 'vegetable' | 'fish', count: number) {
  ok(sim, { type: 'buyIngredient', targetId: ingredient, value: count });
  return `ingredient:${ingredient}`;
}

test('ingredients come from real local shop stock and cooking consumes a recipe before a saved timer produces its meal', () => {
  const { sim, world } = create();
  const kitchen = building(world, 'market');
  const shop = sim.state.shops.find(item => item.buildingId === kitchen.id)!;
  sim.state.player.money = 10_000;
  walkTo(sim, { ...kitchen.door, z: kitchen.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'buyIngredient', targetId: 'grain', value: 1 });
  walkTo(sim, kitchen.door);
  for (const value of [0, -1, 0.5, 21, Number.NaN]) {
    rejectWithoutMutation(sim, { type: 'buyIngredient', targetId: 'grain', value });
  }
  rejectWithoutMutation(sim, { type: 'buyIngredient', targetId: 'imaginary-food', value: 1 });
  const before = { stock: shop.inventory, money: sim.state.player.money, revenue: shop.revenue };
  buyIngredient(sim, 'grain', 4);
  buyIngredient(sim, 'vegetable', 2);
  assert.equal(shop.inventory, before.stock - 6);
  assert.equal(sim.state.player.money, before.money - 4 * 8 - 2 * 6);
  assert.equal(shop.revenue, before.revenue + 4 * 8 + 2 * 6);
  assert.equal(sim.state.player.inventory['ingredient:grain'], 4);
  assert.equal(sim.state.player.inventory['ingredient:vegetable'], 2);
  rejectWithoutMutation(sim, { type: 'cook', targetId: 'fishSoup', value: 60 });
  rejectWithoutMutation(sim, { type: 'cook', targetId: 'rice', value: 101 });
  walkTo(sim, { ...kitchen.door, z: kitchen.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'cook', targetId: 'rice', value: 60 });
  walkTo(sim, kitchen.door);
  ok(sim, { type: 'cook', targetId: 'rice', value: 60 });
  assert.equal(sim.state.player.inventory['ingredient:grain'], 2);
  assert.equal(sim.state.player.inventory['ingredient:vegetable'], 1);
  assert.equal(sim.state.player.inventory['dish:rice'] ?? 0, 0);
  const job = extension(sim).cooking!;
  assert.ok(job);
  assert.equal(job.recipeId, 'rice');
  assert.equal(job.finishAt - job.startedAt, 30);
  assert.ok(job.quality >= 0 && job.quality <= 100);
  rejectWithoutMutation(sim, { type: 'cook', targetId: 'rice', value: 60 });
  const timer = extension(sim).lastUpdate;
  ok(sim, { type: 'setTime', value: 23 });
  assert.equal(extension(sim).lastUpdate, timer);
  assert.equal(extension(sim).cooking!.finishAt, job.finishAt);
  advanceMinutes(sim, 14);
  assert.equal(sim.state.player.inventory['dish:rice'] ?? 0, 0);
  const restored = restoredFrom(sim);
  advanceMinutes(sim, 16);
  advanceMinutes(restored, 16);
  assert.deepEqual(restored.state, sim.state);
  assert.equal(extension(sim).cooking, null);
  assert.equal(sim.state.player.inventory['dish:rice'], 1);
  assert.equal(extension(sim).stats.mealsCooked, 1);
  sim.state.player.needs.hunger = 5;
  const hunger = sim.state.player.needs.hunger;
  ok(sim, { type: 'eat', targetId: 'rice' });
  assert.equal(sim.state.player.inventory['dish:rice'], 0);
  assert.ok(sim.state.player.needs.hunger > hunger);
  rejectWithoutMutation(sim, { type: 'eat', targetId: 'rice' });
});

test('fish soup and festival meals use their own ingredients and stated preparation times', async t => {
  const recipes = [
    { id: 'fishSoup', grain: 0, vegetable: 2, fish: 1, minutes: 45 },
    { id: 'festivalMeal', grain: 2, vegetable: 2, fish: 1, minutes: 60 },
  ];
  for (const recipe of recipes) {
    await t.test(recipe.id, () => {
      const { sim, world } = create();
      sim.state.player.money = 10_000;
      walkTo(sim, building(world, 'market').door);
      for (const ingredient of ['grain', 'vegetable', 'fish'] as const) {
        if (recipe[ingredient]) buyIngredient(sim, ingredient, recipe[ingredient]);
      }
      ok(sim, { type: 'cook', targetId: recipe.id, value: 60 });
      assert.equal(extension(sim).cooking!.finishAt - extension(sim).cooking!.startedAt, recipe.minutes);
      for (const ingredient of ['grain', 'vegetable', 'fish'] as const) {
        assert.equal(sim.state.player.inventory[`ingredient:${ingredient}`] ?? 0, 0);
      }
      advanceMinutes(sim, recipe.minutes - 2);
      assert.equal(sim.state.player.inventory[`dish:${recipe.id}`] ?? 0, 0);
      advanceUntil(sim, () => extension(sim).cooking === null);
      assert.equal(sim.state.player.inventory[`dish:${recipe.id}`], 1);
    });
  }
});

test('cooking heat changes the quality of a meal while using the same actual ingredients', () => {
  const qualities: number[] = [];
  for (const heat of [0, 60]) {
    const { sim, world } = create();
    sim.state.player.money = 1000;
    walkTo(sim, building(world, 'market').door);
    buyIngredient(sim, 'grain', 2);
    buyIngredient(sim, 'vegetable', 1);
    ok(sim, { type: 'cook', targetId: 'rice', value: heat });
    qualities.push(extension(sim).cooking!.quality);
    assert.equal(sim.state.player.inventory['ingredient:grain'], 0);
    assert.equal(sim.state.player.inventory['ingredient:vegetable'], 0);
  }
  assert.ok(qualities[1] > qualities[0], 'the same rice recipe must respond to the chosen heat');
});

test('medical treatment pays an actual clinic fee and preserves its cooldown through save/load', () => {
  const { sim, world } = create();
  const clinic = building(world, 'clinic');
  sim.state.player.money = 1000;
  const doctor = pinClinicDoctor(sim);
  extension(sim).actorProfiles.player.health = 40;
  walkTo(sim, { ...clinic.door, z: clinic.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'heal', targetId: 'player' });
  walkTo(sim, clinic.door);
  const money = sim.state.player.money;
  ok(sim, { type: 'heal', targetId: 'player' });
  assert.equal(sim.state.player.money, money - 30);
  assert.equal(extension(sim).actorProfiles.player.health, 40, 'a payment only reserves real treatment; it does not heal immediately');
  rejectWithoutMutation(sim, { type: 'heal', targetId: 'player' });
  advanceUntil(sim, () => sim.state.clinical!.orders[0].state === 'completed');
  assert.ok(extension(sim).actorProfiles.player.health >= 65);
  assert.equal(sim.state.clinical!.orders[0].workedMinutes, 20);
  assert.equal(sim.state.clinical!.orders[0].consumedUnits, 1);
  const restored = restoredFrom(sim);
  pinClinicDoctor(restored, 'player', doctor.id);
  ok(restored, { type: 'setTime', value: 23 });
  rejectWithoutMutation(restored, { type: 'heal', targetId: 'player' });
  advanceMinutes(restored, 58);
  rejectWithoutMutation(restored, { type: 'heal', targetId: 'player' });
  advanceMinutes(restored, 2);
  const before = extension(restored).actorProfiles.player.health;
  ok(restored, { type: 'heal', targetId: 'player' });
  assert.equal(extension(restored).actorProfiles.player.health, before);
  ok(restored, { type: 'setTime', value: 8 });
  advanceUntil(restored, () => restored.state.clinical!.orders[1].state === 'completed');
  assert.ok(extension(restored).actorProfiles.player.health >= before + 25);
});

test('death ends an actor’s activities and treatment cannot revive them; aging follows elapsed simulated time', () => {
  const { sim, world } = create();
  const citizen = sim.state.citizens[0];
  const profile = extension(sim).actorProfiles[citizen.id];
  const age = extension(sim).actorProfiles.player.age;
  const clock = extension(sim).lastUpdate;
  ok(sim, { type: 'setTime', value: 23 });
  assert.equal(extension(sim).actorProfiles.player.age, age);
  profile.health = 0;
  sim.step(0.25);
  assert.equal(profile.alive, false);
  assert.equal(citizen.destinationId, null);
  assert.deepEqual(citizen.route ?? [], []);
  const position = clone(citizen.position);
  advanceMinutes(sim, 20);
  assert.deepEqual(citizen.position, position, 'a deceased NPC must not continue travelling');
  approximately(extension(sim).actorProfiles.player.age - age,
    (extension(sim).lastUpdate - clock) / (365 * 1440), 'aging must use elapsed minutes rather than clock slider movement');
  extension(sim).actorProfiles.player.health = 0;
  walkTo(sim, building(world, 'clinic').door);
  sim.step(0.25);
  assert.equal(extension(sim).actorProfiles.player.alive, false);
  rejectWithoutMutation(sim, { type: 'heal' });
  walkTo(sim, building(world, 'workshop').door);
  rejectWithoutMutation(sim, { type: 'work', targetId: building(world, 'workshop').id });
  const restored = restoredFrom(sim);
  assert.equal(extension(restored).actorProfiles.player.alive, false);
});

test('organizations retain membership, accept real donations, and run paid festivals with saved cooldowns', () => {
  const { sim, world } = create();
  const organization = extension(sim).organizations[0];
  assert.ok(organization);
  sim.state.player.money = 10_000;
  const hall = building(world, 'hall');
  walkTo(sim, { ...hall.door, z: hall.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'joinOrganization', targetId: organization.id });
  rejectWithoutMutation(sim, { type: 'donate', targetId: organization.id, value: 50 });
  rejectWithoutMutation(sim, { type: 'attendFestival', targetId: organization.id });
  walkTo(sim, hall.door);
  rejectWithoutMutation(sim, { type: 'joinOrganization', targetId: 'missing-organization' });
  const joiningMoney = sim.state.player.money;
  ok(sim, { type: 'joinOrganization', targetId: organization.id });
  assert.equal(sim.state.player.money, joiningMoney - 20);
  assert.equal(organization.members.filter(actor => actor === 'player').length, 1);
  rejectWithoutMutation(sim, { type: 'joinOrganization', targetId: organization.id });
  for (const value of [0, -1, 9, Number.NaN, sim.state.player.money + 1]) {
    rejectWithoutMutation(sim, { type: 'donate', targetId: organization.id, value });
  }
  const before = { money: sim.state.player.money, funds: organization.funds, donations: extension(sim).stats.donations };
  ok(sim, { type: 'donate', targetId: organization.id, value: 50 });
  assert.equal(sim.state.player.money, before.money - 50);
  assert.equal(organization.funds, before.funds + 50);
  assert.equal(extension(sim).stats.donations, before.donations + 50);
  rejectWithoutMutation(sim, { type: 'donate', targetId: organization.id, value: 50 });
  sim.state.player.needs.fun = 10;
  const fun = sim.state.player.needs.fun;
  const festivalMoney = sim.state.player.money;
  ok(sim, { type: 'attendFestival', targetId: organization.id });
  assert.equal(sim.state.player.money, festivalMoney - 20);
  assert.ok(sim.state.player.needs.fun > fun);
  assert.equal(extension(sim).stats.festivals, 1);
  rejectWithoutMutation(sim, { type: 'attendFestival', targetId: organization.id });
  const restored = restoredFrom(sim);
  ok(restored, { type: 'setTime', value: 23 });
  rejectWithoutMutation(restored, { type: 'donate', targetId: organization.id, value: 50 });
  rejectWithoutMutation(restored, { type: 'attendFestival', targetId: organization.id });
  advanceMinutes(restored, 60);
  ok(restored, { type: 'donate', targetId: organization.id, value: 50 });
  rejectWithoutMutation(restored, { type: 'attendFestival', targetId: organization.id });
  advanceMinutes(restored, 60);
  ok(restored, { type: 'attendFestival', targetId: organization.id });
  assert.equal(extension(restored).stats.festivals, 2);
});

test('pending research, cooking, companies and social actions resume deterministically with fractional frames', () => {
  const { sim, world } = create();
  sim.state.player.money = 100_000;
  grant(sim, 'merchant');
  const company = foundCompany(sim, world);
  buyIngredient(sim, 'grain', 2);
  buyIngredient(sim, 'vegetable', 1);
  ok(sim, { type: 'cook', targetId: 'rice', value: 60 });
  grant(sim, 'scientist');
  sim.state.player.education = 3;
  walkTo(sim, building(world, 'core').door);
  ok(sim, { type: 'research', targetId: 'energy', value: 200 });
  const organization = extension(sim).organizations[0];
  walkTo(sim, building(world, 'hall').door);
  ok(sim, { type: 'joinOrganization', targetId: organization.id });
  ok(sim, { type: 'donate', targetId: organization.id, value: 50 });
  ok(sim, { type: 'attendFestival', targetId: organization.id });
  sim.step(0.13);
  const restored = restoredFrom(sim);
  for (let index = 0; index < 240; index++) {
    const seconds = [0.07, 0.13, 0.41, 0.23][index % 4];
    sim.step(seconds);
    restored.step(seconds);
    assert.equal(restored.exportSave(), sim.exportSave(), `restored extension diverged on frame ${index}`);
  }
  assert.ok(extension(restored).stats.researchCompleted > 0);
  assert.ok(extension(restored).stats.mealsCooked > 0);
  sharesAreConserved(extension(restored).companies.find(item => item.id === company.id)!);
});

test('legacy core saves initialize extension state and remain playable', () => {
  const { sim } = create();
  sim.step(0.25);
  const legacy = JSON.parse(sim.exportSave()) as { state: SimState };
  Reflect.deleteProperty(legacy.state, 'extension');
  Reflect.deleteProperty(legacy.state, 'family');
  Reflect.deleteProperty(legacy.state, 'culture');
  for (const key of ['banking', 'trade', 'journey', 'aviation', 'playerLabor', 'clinical', 'homeRest']) Reflect.deleteProperty(legacy.state, key);
  for (const key of ['privateLabor', 'publicLabor', 'publicLaborReviewAt', 'publicBudgets', 'playerLaborVersion', 'persistedModules']) Reflect.deleteProperty(Reflect.get(legacy, 'runtime'), key);
  const restored = new Simulation(fixture());
  const result = restored.importSave(JSON.stringify(legacy));
  assert.equal(result.ok, true, result.message);
  assert.ok(extension(restored).actorProfiles.player);
  assert.equal(extension(restored).technologies.length, 7);
  assert.equal(restored.state.homeRest, undefined, 'the historical unmarked recipe does not acquire a physical v4 home-rest module');
  assert.equal(JSON.parse(restored.exportSave()).runtime.persistedModules.includes('homeRest'), false);
  const clock = extension(restored).lastUpdate;
  restored.step(0.25);
  assert.equal(extension(restored).lastUpdate, clock + 2);
  assert.equal(restored.state.homeRest, undefined, 'legacy people hooks remain safe without introducing new idle module data');
  finiteTree(restored.state);
});

test('a failed load hook rolls back extension actor caches and the complete running timeline', () => {
  const { sim, world } = create();
  sim.state.citizens[0].money = 100;
  extension(sim).actorProfiles[sim.state.citizens[0].id].health = 40;
  sim.step(0.13);
  const control = restoredFrom(sim);
  const candidate = JSON.parse(sim.exportSave()) as { state: SimState };
  candidate.state.citizens[0].money = 500;
  candidate.state.citizens[0].position = clone(building(world, 'clinic').door);
  candidate.state.citizens[0].workId = building(world, 'clinic').id;
  candidate.state.citizens[0].role = '医生';
  candidate.state.extension!.actorProfiles[candidate.state.citizens[0].id].health = 10;
  sim.onLoad(() => {
    sim.step(0.25); // A load consumer touches candidate actors and lazy caches before it fails.
    throw new Error('deliberate test load hook failure');
  });
  const previous = sim.state;
  const before = sim.exportSave();
  const result = sim.importSave(JSON.stringify(candidate));
  assert.equal(result.ok, false);
  assert.match(result.message, /deliberate test load hook failure/);
  assert.equal(sim.state, previous);
  assert.equal(sim.exportSave(), before, 'failure after candidate initialization must restore both authoritative objects');
  for (let index = 0; index < 120; index++) {
    const seconds = [0.07, 0.13, 0.41, 0.23][index % 4];
    sim.step(seconds);
    control.step(seconds);
    assert.equal(sim.exportSave(), control.exportSave(), `failed import changed later actor or RNG behavior on frame ${index}`);
  }
});

test('bereavement follows current partners and divorce removes stale life profile family associations', async t => {
  await t.test('current partner receives the memory', () => {
    const { sim } = create();
    const control = create().sim;
    for (const city of [sim, control]) {
      city.state.citizens[1].partnerId = null;
      city.state.citizens[0].partnerId = city.state.citizens[2].id;
      city.state.citizens[2].partnerId = city.state.citizens[0].id;
    }
    const victim = sim.state.citizens[0];
    const partner = sim.state.citizens[2];
    const former = sim.state.citizens[1];
    extension(sim).actorProfiles[victim.id].health = 0;
    sim.step(0.25);
    control.step(0.25);
    assert.ok(extension(sim).actorProfiles[victim.id].family.includes(partner.id));
    assert.equal(extension(sim).actorProfiles[victim.id].family.includes(former.id), false, 'former partners detach while actual guardians and descendants remain');
    assert.ok(extension(sim).actorProfiles[partner.id].historyTags.includes('悼念亲人'));
    assert.ok(extension(sim).actorProfiles[partner.id].mood < extension(control).actorProfiles[partner.id].mood - 15);
    assert.equal(extension(sim).actorProfiles[former.id].historyTags.includes('悼念亲人'), false);
    approximately(extension(sim).actorProfiles[former.id].mood, extension(control).actorProfiles[former.id].mood,
      'a former partner must not receive the current household grief effect');
    const restored = restoredFrom(sim);
    assert.ok(extension(restored).actorProfiles[partner.id].historyTags.includes('悼念亲人'));
  });
  await t.test('divorced partner is detached before death', () => {
    const { sim } = create();
    const [victim, former] = sim.state.citizens;
    victim.partnerId = null;
    former.partnerId = null;
    extension(sim).actorProfiles[victim.id].health = 0;
    sim.step(0.25);
    assert.equal(extension(sim).actorProfiles[victim.id].family.includes(former.id), false);
    assert.equal(extension(sim).actorProfiles[former.id].family.includes(victim.id), false);
    assert.equal(extension(sim).actorProfiles[former.id].historyTags.includes('悼念亲人'), false);
  });
});

test('extension validation rejects invalid resources, ownership, actor references and timers atomically', () => {
  const { sim, world } = create();
  sim.state.player.money = 100_000;
  grant(sim, 'merchant');
  foundCompany(sim, world);
  buyIngredient(sim, 'grain', 2);
  buyIngredient(sim, 'vegetable', 1);
  ok(sim, { type: 'cook', targetId: 'rice', value: 60 });
  sim.step(0.13);
  const valid = JSON.parse(sim.exportSave()) as { state: SimState; runtime: Record<string, unknown> };
  const corruptions: { label: string; corrupt: (state: SimState) => void }[] = [
    { label: 'extension version', corrupt: s => { s.extension!.version = 999; } },
    { label: 'missing technologies', corrupt: s => { s.extension!.technologies.pop(); } },
    { label: 'duplicate sectors', corrupt: s => { s.extension!.technologies[1].sector = s.extension!.technologies[0].sector; } },
    { label: 'unknown sector', corrupt: s => { s.extension!.technologies[0].sector = 'unrecognized' as Technology['sector']; } },
    { label: 'negative funding', corrupt: s => { s.extension!.technologies[0].funding = -1; } },
    { label: 'fractional technology level', corrupt: s => { s.extension!.technologies[0].level = 0.5; } },
    { label: 'progress beyond completion', corrupt: s => { s.extension!.technologies[0].progress = 101; } },
    { label: 'duplicate companies', corrupt: s => { s.extension!.companies.push(clone(s.extension!.companies[0])); } },
    { label: 'missing company facility', corrupt: s => { s.extension!.companies[0].buildingId = 'absent-building'; } },
    { label: 'mismatched company district', corrupt: s => { s.extension!.companies[0].districtId = world.districts.find(item => item.id !== s.extension!.companies[0].districtId)!.id; } },
    { label: 'missing proprietor', corrupt: s => { s.extension!.companies[0].ownerId = 'absent-actor'; } },
    { label: 'negative company capital', corrupt: s => { s.extension!.companies[0].capital = -1; } },
    { label: 'nonfinite company money', corrupt: s => { s.extension!.companies[0].capital = Number.POSITIVE_INFINITY; } },
    { label: 'share issuance mismatch', corrupt: s => { s.extension!.companies[0].shares += 1; } },
    { label: 'foreign shareholder', corrupt: s => { s.extension!.companies[0].shareholders['absent-actor'] = 1; } },
    { label: 'fractional share quantity', corrupt: s => { const c = s.extension!.companies[0]; c.shareholders[c.ownerId] -= 0.5; c.shareholders.exchange = 0.5; } },
    { label: 'missing parent company', corrupt: s => { s.extension!.companies[0].parentId = 'absent-company'; } },
    { label: 'company owns itself', corrupt: s => { s.extension!.companies[0].parentId = s.extension!.companies[0].id; } },
    { label: 'circular subsidiaries', corrupt: s => { const [a, b] = s.extension!.companies; a.parentId = b.id; b.parentId = a.id; } },
    { label: 'missing player life profile', corrupt: s => { Reflect.deleteProperty(s.extension!.actorProfiles, 'player'); } },
    { label: 'missing NPC life profile', corrupt: s => { Reflect.deleteProperty(s.extension!.actorProfiles, s.citizens[0].id); } },
    { label: 'foreign actor life profile', corrupt: s => { s.extension!.actorProfiles['absent-actor'] = clone(s.extension!.actorProfiles.player); } },
    { label: 'invalid health', corrupt: s => { s.extension!.actorProfiles.player.health = 101; } },
    { label: 'invalid lifespan', corrupt: s => { s.extension!.actorProfiles.player.age = -1; } },
    { label: 'foreign family member', corrupt: s => { s.extension!.actorProfiles.player.family = ['absent-actor']; } },
    { label: 'organization has a foreign member', corrupt: s => { s.extension!.organizations[0].members.push('absent-actor'); } },
    { label: 'duplicate organization membership', corrupt: s => { const o = s.extension!.organizations[0]; o.members.push(o.members[0]); } },
    { label: 'duplicate organization', corrupt: s => { s.extension!.organizations.push(clone(s.extension!.organizations[0])); } },
    { label: 'negative organization funds', corrupt: s => { s.extension!.organizations[0].funds = -1; } },
    { label: 'foreign audit suspect', corrupt: s => { s.extension!.audits.push({ id: 'audit-1', npcId: 'absent-actor', evidence: 60, diverted: 50, status: 'suspected', createdAt: s.extension!.lastUpdate, responseAt: 0 }); } },
    { label: 'ledger timestamp in the future', corrupt: s => { s.extension!.publicLedger.push({ tick: s.tick + 1, actorId: 'player', amount: 20, purpose: '正常账目', account: 'public', districtId: world.districts[0].id }); } },
    { label: 'ledger references a foreign actor', corrupt: s => { s.extension!.publicLedger.push({ tick: s.tick, actorId: 'absent-actor', amount: 20, purpose: '正常账目', account: 'public', districtId: world.districts[0].id }); } },
    { label: 'ledger references a foreign district', corrupt: s => { s.extension!.publicLedger.push({ tick: s.tick, actorId: 'player', amount: 20, purpose: '正常账目', account: 'public', districtId: 'absent-district' }); } },
    { label: 'unknown cooking recipe', corrupt: s => { s.extension!.cooking!.recipeId = 'unknown-recipe'; } },
    { label: 'cooking deadline precedes its start', corrupt: s => { s.extension!.cooking!.finishAt = s.extension!.cooking!.startedAt - 1; } },
    { label: 'cooking quality outside limits', corrupt: s => { s.extension!.cooking!.quality = 101; } },
    { label: 'negative elapsed clock', corrupt: s => { s.extension!.lastUpdate = -1; } },
    { label: 'invalid water quality', corrupt: s => { s.extension!.environment.waterQuality = 101; } },
    { label: 'invalid storm probability', corrupt: s => { s.extension!.environment.stormRisk = -1; } },
    { label: 'negative disaster deadline', corrupt: s => { s.extension!.environment.disasterAt = -1; } },
    { label: 'negative institutional capacity', corrupt: s => { s.extension!.institutions.welfare = -1; } },
    { label: 'negative meal count', corrupt: s => { s.extension!.stats.mealsCooked = -1; } },
    { label: 'fractional research count', corrupt: s => { s.extension!.stats.researchCompleted = 0.5; } },
  ];
  for (const { label, corrupt } of corruptions) {
    const broken = clone(valid);
    corrupt(broken.state);
    const before = sim.exportSave();
    const result = sim.importSave(JSON.stringify(broken));
    assert.equal(result.ok, false, `must reject ${label}: ${result.message}`);
    assert.equal(sim.exportSave(), before, `rejected ${label} must not alter state, RNG or fractional timers`);
  }
});

test('saved extension accounting cursors, cooldown identities and funded research jobs are validated before replacement', () => {
  const { sim, world } = create();
  grant(sim, 'merchant');
  sim.state.player.money = 100_000;
  foundCompany(sim, world);
  grant(sim, 'scientist');
  sim.state.player.education = 3;
  walkTo(sim, building(world, 'core').door);
  ok(sim, { type: 'research', targetId: 'medicine', value: 200 });
  const valid = JSON.parse(sim.exportSave()) as { state: SimState };
  type Runtime = {
    version: number; nextCompanyAt: number; nextCorruptionAt: number; nextLedgerAt: number; lastTreasury: number;
    cooldowns: Record<string, number>; researchJobs: Record<string, { startedAt: number; finishAt: number; budget: number; actorId?: string }>;
    companyCursors: Record<string, { revenue: number; profit: number }>; deprivation: Record<string, number>; diversions: Record<string, number>;
  };
  type SavedExtension = CityExtensionState & { runtime: Runtime };
  const corruptions: { label: string; corrupt: (e: SavedExtension) => void }[] = [
    { label: 'runtime version', corrupt: e => { e.runtime.version = 999; } },
    { label: 'negative company deadline', corrupt: e => { e.runtime.nextCompanyAt = -1; } },
    { label: 'negative corruption deadline', corrupt: e => { e.runtime.nextCorruptionAt = -1; } },
    { label: 'negative ledger deadline', corrupt: e => { e.runtime.nextLedgerAt = -1; } },
    { label: 'nonfinite treasury cursor', corrupt: e => { e.runtime.lastTreasury = Number.POSITIVE_INFINITY; } },
    { label: 'unknown cooldown identity', corrupt: e => { e.runtime.cooldowns['invalid-command'] = e.lastUpdate + 60; } },
    { label: 'foreign treatment target', corrupt: e => { e.runtime.cooldowns['heal:absent-actor'] = e.lastUpdate + 60; } },
    { label: 'foreign appointment target', corrupt: e => { e.runtime.cooldowns['appoint:absent-actor'] = e.lastUpdate + 60; } },
    { label: 'foreign resident research cooldown', corrupt: e => { e.runtime.cooldowns['research:absent-actor'] = e.lastUpdate + 1440; } },
    { label: 'foreign expansion target', corrupt: e => { e.runtime.cooldowns['expand:absent-company'] = e.lastUpdate + 60; } },
    { label: 'negative cooldown', corrupt: e => { e.runtime.cooldowns.audit = -1; } },
    { label: 'research job for an unknown sector', corrupt: e => { e.runtime.researchJobs['unknown-sector'] = clone(e.runtime.researchJobs.medicine); } },
    { label: 'research credits a foreign actor', corrupt: e => { e.runtime.researchJobs.medicine.actorId = 'absent-actor'; } },
    { label: 'research begins in the future', corrupt: e => { const job = e.runtime.researchJobs.medicine; job.startedAt = e.lastUpdate + 1; job.finishAt = job.startedAt + 120; } },
    { label: 'research deadline before start', corrupt: e => { e.runtime.researchJobs.medicine.finishAt = e.runtime.researchJobs.medicine.startedAt - 1; } },
    { label: 'research wrong duration', corrupt: e => { e.runtime.researchJobs.medicine.finishAt += 1; } },
    { label: 'research budget out of limits', corrupt: e => { e.runtime.researchJobs.medicine.budget = 99; } },
    { label: 'research funding and budget mismatch', corrupt: e => { e.runtime.researchJobs.medicine.budget = 201; } },
    { label: 'funding with no running project', corrupt: e => { Reflect.deleteProperty(e.runtime.researchJobs, 'medicine'); } },
    { label: 'missing company cursor', corrupt: e => { Reflect.deleteProperty(e.runtime.companyCursors, e.companies[0].id); } },
    { label: 'foreign company cursor', corrupt: e => { e.runtime.companyCursors['absent-company'] = { revenue: 0, profit: 0 }; } },
    { label: 'receipt cursor beyond actual revenue', corrupt: e => { const c = e.companies[0]; e.runtime.companyCursors[c.id].revenue = sim.state.shops.find(item => item.buildingId === c.buildingId)!.revenue + 1; } },
    { label: 'nonfinite company profit cursor', corrupt: e => { e.runtime.companyCursors[e.companies[0].id].profit = Number.POSITIVE_INFINITY; } },
    { label: 'foreign deprived actor', corrupt: e => { e.runtime.deprivation['absent-actor'] = 200; } },
    { label: 'negative deprivation timer', corrupt: e => { e.runtime.deprivation[sim.state.citizens[0].id] = -1; } },
    { label: 'foreign diversion actor', corrupt: e => { e.runtime.diversions['absent-actor'] = 50; } },
    { label: 'negative outstanding diversion', corrupt: e => { e.runtime.diversions[sim.state.citizens[0].id] = -1; } },
    { label: 'player recorded as an NPC suspect', corrupt: e => { e.runtime.diversions.player = 50; } },
    { label: 'company counter would reuse an existing ID', corrupt: e => { e.nextCompanyId = 1; } },
    { label: 'nonpositive audit counter', corrupt: e => { e.nextAuditId = 0; } },
    { label: 'dead actor retains positive health', corrupt: e => { e.actorProfiles.player.alive = false; } },
  ];
  for (const { label, corrupt } of corruptions) {
    const broken = clone(valid);
    corrupt(broken.state.extension as SavedExtension);
    const before = sim.exportSave();
    const result = sim.importSave(JSON.stringify(broken));
    assert.equal(result.ok, false, `must reject ${label}: ${result.message}`);
    assert.equal(sim.exportSave(), before, `${label} must not replace live state or hidden timers`);
  }
});

test('corruption moves actual public funds into an eligible poor actor, and evidence leads to delayed recovery rather than a reward', () => {
  const { sim, world } = create();
  const dividends = observeDividends(sim);
  const e = extension(sim);
  sim.state.player.money = 10_000;
  const publicActors = sim.state.citizens;
  for (const [index, citizen] of publicActors.entries()) {
    const workplaces = world.buildings.filter(site => site.districtId === citizen.districtId && ['hall', 'core', 'bank'].includes(site.kind));
    citizen.workId = workplaces[index % workplaces.length].id;
    citizen.role = 'official';
  }
  assert.ok(publicActors.length > 0);
  assert.equal(e.audits.length, 0, 'corruption must arise from resources and conduct rather than a preassigned NPC type');
  let transferred = false;
  let beforeFinance: { treasury: number; taxes: number; operatingCost: number; actorMoney: Record<string, number> } | null = null;
  sim.onPhase('time', () => {
    if (transferred) return;
    for (const citizen of publicActors) {
      citizen.money = 10;
      citizen.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
      e.actorProfiles[citizen.id].stress = 90;
    }
  });
  sim.onPhase('commerce', () => {
    const runtime = (JSON.parse(sim.exportSave()) as { runtime: { taxes: number; operatingCost: number } }).runtime;
    beforeFinance = {
      treasury: sim.state.treasury, taxes: runtime.taxes, operatingCost: runtime.operatingCost,
      actorMoney: Object.fromEntries(publicActors.map(citizen => [citizen.id, citizen.money])),
    };
  });
  sim.onPhase('finance', () => {
    if (transferred) return;
    const entries = e.publicLedger.filter(entry => entry.tick === sim.state.tick && entry.purpose.includes('挪用'));
    if (!entries.length) return;
    assert.ok(beforeFinance);
    const diverted = entries.reduce((sum, entry) => sum - entry.amount, 0);
    assert.ok(diverted > 0, 'the public ledger must record an actual outflow');
    approximately(sim.state.treasury,
      beforeFinance.treasury + beforeFinance.taxes - beforeFinance.operatingCost * (1 - sim.state.taxRate) - diverted,
      'corruption must debit treasury after normal city finance');
    for (const entry of entries) {
      const citizen = sim.state.citizens.find(item => item.id === entry.actorId)!;
      assert.ok(citizen);
      approximately(citizen.money - beforeFinance.actorMoney[citizen.id], -entry.amount + (dividends.get(citizen.id) ?? 0),
        'the named actor receives exactly diverted funds plus separately funded business dividends');
    }
    transferred = true;
  });
  advanceUntil(sim, () => transferred, 500);
  assert.equal(e.audits.length, 0, 'an anomalous transfer alone must not replace the evidence and report workflow');
  const hall = world.buildings.find(item => item.facility === 'administration' && item.districtId === world.districts[0].id)!;
  grant(sim, 'official');
  walkTo(sim, { ...hall.door, z: hall.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'audit' });
  walkTo(sim, hall.door);
  const auditMoney = sim.state.player.money;
  ok(sim, { type: 'audit' });
  assert.equal(sim.state.player.money, auditMoney - 40);
  assert.ok(e.audits.length > 0);
  assert.ok(e.publicLedger.filter(entry => entry.purpose.includes('挪用')).length > 128,
    'the fixture must stress the active case limit with more than 128 real diversions');
  assert.equal(e.audits.length, 128, 'unresolved cases must stay bounded while excess evidence remains queued');
  restoredFrom(sim);
  const queued = e.publicLedger.find(entry => entry.purpose.includes('挪用') && !e.audits.some(case_ => case_.npcId === entry.actorId));
  assert.ok(queued, 'capacity overflow must leave undiscovered real ledger evidence available');
  rejectWithoutMutation(sim, { type: 'reportCorruption', targetId: queued.actorId });
  const item = e.audits[0];
  assert.equal(item.status, 'suspected');
  assert.ok(item.diverted > 0 && item.evidence > 0);
  assert.ok(e.publicLedger.some(entry => entry.actorId === item.npcId && entry.purpose.includes('挪用')));
  rejectWithoutMutation(sim, { type: 'audit' });
  while (item.evidence < 60) {
    advanceMinutes(sim, 30);
    ok(sim, { type: 'audit' });
  }
  ok(sim, { type: 'reportCorruption', targetId: item.id });
  assert.equal(item.status, 'reported');
  assert.ok(item.responseAt > e.lastUpdate);
  rejectWithoutMutation(sim, { type: 'reportCorruption', targetId: item.id });
  walkTo(sim, building(world, 'police').door);
  rejectWithoutMutation(sim, { type: 'investigate', targetId: item.id });
  advanceMinutes(sim, 60);
  grant(sim, 'police');
  const suspect = sim.state.citizens.find(citizen => citizen.id === item.npcId)!;
  suspect.money = item.diverted / 2;
  ok(sim, { type: 'investigate', targetId: item.id });
  assert.equal(item.status, 'investigating');
  const finish = item.responseAt;
  assert.equal(finish - e.lastUpdate, 120);
  advanceMinutes(sim, 60);
  assert.equal(item.status, 'investigating', 'investigation and justice must take their stated response time');
  const restored = restoredFrom(sim);
  const restoredItem = extension(restored).audits.find(case_ => case_.id === item.id)!;
  assert.equal(restoredItem.responseAt, finish);
  const playerMoney = sim.state.player.money;
  const recovered = e.stats.corruptionRecovered;
  let lastSuspectMoney = suspect.money;
  sim.onPhase('finance', () => { lastSuspectMoney = suspect.money; });
  advanceMinutes(sim, 60);
  advanceMinutes(restored, 60);
  assert.deepEqual(restored.state, sim.state);
  assert.equal(item.status, 'prosecuted');
  const recoveredNow = e.stats.corruptionRecovered - recovered;
  approximately(recoveredNow, Math.min(item.diverted, lastSuspectMoney),
    'justice must recover only funds the actual actor can pay');
  approximately(lastSuspectMoney - suspect.money, recoveredNow, 'recovery debits the suspect’s remaining cash');
  assert.ok(e.publicLedger.some(entry => entry.actorId === suspect.id && entry.purpose.includes('追缴') && Math.abs(entry.amount - recoveredNow) < 1e-7));
  assert.equal(sim.state.player.money, playerMoney, 'the reporting player must not receive a fabricated bounty');
  rejectWithoutMutation(sim, { type: 'investigate', targetId: item.id });
  assert.ok(!['official', 'council', 'mayor', 'scientist', '官员', '钱庄职员', '工程师'].includes(suspect.role));
  assert.ok(['market', 'workshop', 'farm', 'home'].includes(world.buildings.find(site => site.id === suspect.workId)!.kind),
    'prosecution must revoke the actual public workplace as well as its role label');
  const revokedAt = sim.state.tick;
  sim.onPhase('time', () => {
    suspect.money = 10;
    suspect.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
    e.actorProfiles[suspect.id].stress = 90;
  });
  advanceMinutes(sim, 360);
  assert.equal(e.publicLedger.filter(entry => entry.tick > revokedAt && entry.actorId === suspect.id && entry.purpose.includes('挪用')).length, 0,
    'continuing poverty must not create another diversion after public authority is revoked');
});

test('public resource diversions require the real civic job in either language and exclude private employers and ordinary workers', async t => {
  const world = fixture();
  const data = world.buildings.find(site => site.facility === 'data')!;
  data.kind = 'workshop'; // The generated city's actual data laboratory is a civic workshop.
  const sim = new Simulation(world);
  const dividends = observeDividends(sim);
  ok(sim, { type: 'speed', value: 8 });
  const e = extension(sim);
  const cases = [
    { role: '科研员', facility: 'data', eligible: true },
    { role: '科学家', facility: 'data', eligible: true },
    { role: 'scientist', facility: 'data', eligible: true },
    { role: '议员', facility: 'council', eligible: true },
    { role: 'council', facility: 'council', eligible: true },
    { role: '财政官', facility: 'treasury', eligible: true },
    { role: 'official', facility: 'treasury', eligible: true },
    { role: '工程师', facility: 'energy', eligible: true },
    { role: 'mayor', facility: 'mayor', eligible: true },
    { role: '钱庄职员', kind: 'bank', eligible: false },
    { role: 'official', kind: 'bank', eligible: false },
    { role: 'scientist', kind: 'school', eligible: false },
    { role: 'scientist', kind: 'workshop', eligible: false },
    { role: '工人', facility: 'data', eligible: false },
    { role: '工人', facility: 'treasury', eligible: false },
  ];
  const subjects = cases.map((item, index) => {
    const citizen = sim.state.citizens[index];
    const workplace = world.buildings.find(site => item.facility ? site.facility === item.facility : site.kind === item.kind && !site.facility)!;
    assert.ok(workplace);
    citizen.role = item.role;
    citizen.workId = workplace.id;
    return { ...item, citizen, workplace };
  });
  const credited = new Map<string, number>();
  let actualProcurement = 0;
  sim.onEvent('public-procurement', event => { actualProcurement += event.amount ?? 0; });
  let before: { treasury: number; taxes: number; operatingCost: number; money: Map<string, number> } | null = null;
  sim.onPhase('time', () => {
    for (const { citizen, workplace } of subjects) {
      citizen.money = 10;
      citizen.position = clone(workplace.door);
      citizen.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
      e.actorProfiles[citizen.id].stress = 90;
    }
  });
  sim.onPhase('commerce', () => {
    const runtime = (JSON.parse(sim.exportSave()) as { runtime: { taxes: number; operatingCost: number } }).runtime;
    actualProcurement = 0;
    before = { treasury: sim.state.treasury, ...runtime, money: new Map(subjects.map(({ citizen }) => [citizen.id, citizen.money])) };
  });
  sim.onPhase('finance', () => {
    const entries = e.publicLedger.filter(entry => entry.tick === sim.state.tick && entry.purpose.includes('挪用'));
    if (!entries.length) return;
    assert.ok(before);
    approximately(sim.state.treasury, before.treasury + before.taxes - actualProcurement * (1 - sim.state.taxRate)
      + residentResearchPayments(sim) + entries.reduce((sum, entry) => sum + entry.amount, 0),
    'actual civic diversions and simultaneous research must settle the same treasury');
    for (const entry of entries) {
      const subject = subjects.find(({ citizen }) => citizen.id === entry.actorId);
      if (!subject) continue;
      assert.equal(subject.eligible, true, 'private workplaces or ordinary residents cannot withdraw city funds');
      assert.ok(entry.amount < 0);
      approximately(subject.citizen.money - before.money.get(entry.actorId)!, -entry.amount + (dividends.get(entry.actorId) ?? 0),
        'the civic actor receives exactly treasury funds plus observed funded business dividends');
      credited.set(entry.actorId, (credited.get(entry.actorId) ?? 0) - entry.amount);
    }
  });
  advanceMinutes(sim, 720);
  const runtime = e as CityExtensionState & { runtime: { deprivation: Record<string, number>; diversions: Record<string, number> } };
  for (const subject of subjects) {
    await t.test(`${subject.role} at ${subject.workplace.facility ?? subject.workplace.kind}`, () => {
      assert.ok(e.actorProfiles[subject.citizen.id].alive);
      assert.ok(runtime.runtime.deprivation[subject.citizen.id] >= 180, 'each control reaches the same genuine long poverty window');
      const entries = e.publicLedger.filter(entry => entry.actorId === subject.citizen.id && entry.purpose.includes('挪用'));
      if (subject.eligible) {
        assert.ok(entries.length > 0, 'the authorized civic occupation can encounter an actual procurement diversion');
        assert.ok(credited.get(subject.citizen.id)! > 0);
        approximately(runtime.runtime.diversions[subject.citizen.id], credited.get(subject.citizen.id)!,
          'the saved outstanding diversion equals the actual public funds credited');
      } else {
        assert.equal(entries.length, 0, 'job labels and poverty do not supply access to public treasury');
        assert.equal(runtime.runtime.diversions[subject.citizen.id] ?? 0, 0);
      }
    });
  }
  restoredFrom(sim);
});

test('charitable donations are spent from organization funds to actual poor residents', () => {
  const { sim, world } = create();
  const e = extension(sim);
  const relief = e.organizations.find(organization => organization.kind === 'charity')!;
  sim.state.player.money = 1000;
  for (const citizen of sim.state.citizens.slice(0, 8)) citizen.money = 0;
  walkTo(sim, building(world, 'clinic').door);
  ok(sim, { type: 'donate', targetId: relief.id, value: 50 });
  assert.equal(relief.funds, 50);
  const welfare = e.institutions.welfare;
  const dividends = observeDividends(sim);
  let before: { funds: number; wealth: number } | null = null;
  let paid = 0;
  sim.onPhase('commerce', () => {
    before = { funds: relief.funds, wealth: sim.state.citizens.reduce((sum, citizen) => sum + citizen.money, 0) };
  });
  sim.onPhase('finance', () => {
    assert.ok(before);
    const spending = before.funds - relief.funds;
    if (spending <= 0) return;
    paid += spending;
    const businessIncome = [...dividends.entries()].filter(([actorId]) => actorId !== 'player').reduce((sum, [, amount]) => sum + amount, 0);
    approximately(sim.state.citizens.reduce((sum, citizen) => sum + citizen.money, 0) - before.wealth + residentResearchPayments(sim) - businessIncome, spending,
      'social relief, actual business dividends and personally funded research must reconcile resident accounts');
  });
  advanceMinutes(sim, 60);
  assert.equal(paid, 50);
  assert.equal(relief.funds, 0);
  assert.ok(e.institutions.welfare > welfare);
  assert.ok(e.publicLedger.some(entry => entry.account === 'household' && entry.purpose.includes('救济') && entry.amount === -50));
  restoredFrom(sim);
});

test('NPCs use clinics autonomously and actual paid or authorized public treatment settles saved accounts', async t => {
  await t.test('resident paid treatment and saved follow-up deadline', () => {
    const { sim, world } = create(), e = extension(sim), clinic = building(world, 'clinic');
    const citizen = sim.state.citizens.find(c => c.role !== '学生')!;
    citizen.role = '工人'; citizen.money = 100; e.actorProfiles[citizen.id].health = 40;
    let otherIncome = 0;
    sim.onEvent('business-dividend', event => { if (event.citizenId === citizen.id) otherIncome += event.amount ?? 0; });
    const doctor = pinClinicDoctor(sim, citizen.id);
    const pinPatient = (city: Simulation, patientId: string, resetHealth = false) => {
      const patient = city.state.citizens.find(c => c.id === patientId)!;
      city.onPhase('traffic', () => {
        patient.position = clone(clinic.door); patient.destinationId = clinic.id; patient.route = []; patient.routeIndex = 0;
        patient.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
        const core = Reflect.get(city, 'runtime'); core.activities[patientId] = 'heal'; core.decisionAt[patientId] = 1e9;
        if (resetHealth) extension(city).actorProfiles[patientId].health = 40;
      });
    };
    pinPatient(sim, citizen.id); sim.step(.25);
    assert.equal(citizen.money, 70); assert.ok(e.actorProfiles[citizen.id].health < 41);
    const order = sim.state.clinical!.orders[0]; assert.equal(order.funded, 30);
    advanceUntil(sim, () => order.state === 'completed');
    assert.ok(e.actorProfiles[citizen.id].health >= 65); assert.equal(order.workedMinutes, 20); assert.equal(order.consumedUnits, 1);
    approximately(order.purchasePaid + order.serviceFee, 30, 'a completed fee pays real materials and the earned public service exactly once');
    const fee = e.publicLedger.find(entry => entry.actorId === citizen.id && entry.purpose === '现场20分钟诊疗已赚服务费');
    assert.ok(fee); assert.equal(fee.amount, order.serviceFee);
    const restored = restoredFrom(sim); pinClinicDoctor(restored, citizen.id, doctor.id); pinPatient(restored, citizen.id, true);
    restored.onEvent('business-dividend', event => { if (event.citizenId === citizen.id) otherIncome += event.amount ?? 0; });
    advanceMinutes(restored, 58); assert.equal(restored.state.clinical!.orders.length, 1);
    advanceMinutes(restored, 2); assert.equal(restored.state.clinical!.orders.length, 2);
    approximately(restored.state.citizens.find(c => c.id === citizen.id)!.money - otherIncome, 40, 'two paid visits debit exactly 60 while preserving independent earned business dividends');
    advanceUntil(restored, () => restored.state.clinical!.orders[1].state === 'completed');
    assert.equal(restored.state.clinical!.stats.completed, 2); assert.equal(restored.state.clinical!.stock[clinic.id].consumedUnits, 2);
    restoredFrom(restored);
  });
  await t.test('poor residents receive care only from actual authorized public service', () => {
    const world = fixture(), clinic = building(world, 'clinic'), hall = building(world, 'hall');
    hall.floorPermissions = ['public', 'mayor']; hall.publicFloors = 1;
    const sim = new Simulation(world); ok(sim, { type: 'speed', value: 8 });
    const patient = sim.state.citizens.find(c => c.role !== '学生')!;
    patient.role = '工人'; patient.money = 0; extension(sim).actorProfiles[patient.id].health = 40;
    pinClinicDoctor(sim, patient.id);
    sim.onPhase('traffic', () => {
      patient.position = clone(clinic.door); patient.destinationId = clinic.id; patient.route = []; patient.routeIndex = 0;
      patient.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
      const core = Reflect.get(sim, 'runtime'); core.activities[patient.id] = 'heal'; core.decisionAt[patient.id] = 1e9;
    });
    sim.step(.25); assert.equal(sim.state.clinical!.orders.length, 0);
    assert.ok(extension(sim).actorProfiles[patient.id].health < 41, 'poverty alone cannot create free medicine or unauthorised welfare spending');
    walkTo(sim, hall.door); ok(sim, { type: 'filePetition', targetId: 'health', title: '医疗照护', text: '请安排真实医师到场，为贫困居民采购耗材并提供公共医疗服务。' });
    const petition = sim.state.culture!.petitions[0];
    for (const signer of sim.state.citizens.filter(c => c.id !== patient.id && c.role !== '医生').slice(2, 5)) {
      sim.onPhase('traffic', () => {
        signer.position = clone(hall.door); signer.destinationId = hall.id; signer.route = []; signer.routeIndex = 0;
        signer.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
        const core = Reflect.get(sim, 'runtime'); core.activities[signer.id] = 'social'; core.decisionAt[signer.id] = 1e9;
      });
    }
    advanceMinutes(sim, 4); assert.ok(petition.signerIds.length >= 3);
    // A legitimate saved deadline isolates deliberation from city-wide supply;
    // signatures, authorisation, material payment and service still run normally.
    const delta = petition.replyAt - 2 - extension(sim).lastUpdate;
    extension(sim).lastUpdate += delta; sim.state.family!.lastUpdate += delta; sim.state.culture!.lastUpdate += delta;
    sim.step(.25); const order = sim.state.culture!.orders[0]; assert.ok(order);
    grant(sim, 'mayor'); sim.setFocus({ x: hall.position.x, y: hall.position.y + 6.6, z: hall.position.z }, 'walk');
    ok(sim, { type: 'reviewPetition', targetId: petition.id });
    advanceUntil(sim, () => order.servedIds.includes(patient.id));
    assert.equal(patient.money, 0); assert.ok(extension(sim).actorProfiles[patient.id].health >= 65);
    assert.equal(order.serviceMinutes[patient.id], 20); assert.ok(order.consumedUnits >= 1);
    assert.ok(order.spent > 0); approximately(order.receipts.reduce((sum, receipt) => sum + receipt.paid, 0), order.spent, 'public care must have conserved paid supplies');
    restoredFrom(sim);
  });
});

test('research and audits operate inside tall and underground facilities rather than requiring the ground floor doorway', () => {
  const world = fixture();
  const data = world.buildings.find(item => item.facility === 'data')!;
  const energy = world.buildings.find(item => item.facility === 'energy')!;
  const archives = world.buildings.find(item => item.facility === 'archives')!;
  const treasury = world.buildings.find(item => item.facility === 'treasury')!;
  for (const site of [data, energy]) {
    site.kind = 'hall'; site.height = 96; site.floors = 8; site.publicFloors = 1; site.requiredPermission = 'scientist';
  }
  for (const site of [archives, treasury]) {
    site.kind = 'home'; site.height = 24; site.floors = 2; site.basements = 8; site.requiredPermission = 'official';
  }
  const sim = new Simulation(world);
  ok(sim, { type: 'speed', value: 8 });
  sim.state.player.money = 10_000;
  sim.state.player.education = 3;
  grant(sim, 'scientist');
  const high = { ...data.position, y: data.position.y + 80 };
  assert.ok(Math.hypot(high.x - data.door.x, high.y - data.door.y, high.z - data.door.z) > 32);
  walkTo(sim, { ...high, x: high.x + data.width });
  rejectWithoutMutation(sim, { type: 'research', targetId: 'traffic', value: 200 });
  walkTo(sim, high);
  ok(sim, { type: 'research', targetId: 'traffic', value: 200 });
  walkTo(sim, { ...energy.position, y: energy.position.y + 80 });
  ok(sim, { type: 'research', targetId: 'energy', value: 200 });
  grant(sim, 'official');
  const underground = { ...archives.position, y: archives.position.y - 60 };
  assert.ok(Math.hypot(underground.x - archives.door.x, underground.y - archives.door.y, underground.z - archives.door.z) > 32);
  walkTo(sim, { ...underground, x: underground.x + archives.width });
  rejectWithoutMutation(sim, { type: 'audit' });
  walkTo(sim, underground);
  ok(sim, { type: 'audit' });
  advanceMinutes(sim, 30);
  walkTo(sim, { ...treasury.position, y: treasury.position.y - 60 });
  ok(sim, { type: 'audit' });
  const restored = new Simulation(clone(world));
  const result = restored.importSave(sim.exportSave());
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(restored.state.player.position, sim.state.player.position);
});

test('appointments require qualified nearby residents and spend treasury funds while preserving the real assigned job', () => {
  const { sim, world } = create();
  const mayorOffice = world.buildings.find(item => item.facility === 'mayor')!;
  const citizen = sim.state.citizens[0];
  citizen.education = 2;
  citizen.position = clone(mayorOffice.door);
  walkTo(sim, mayorOffice.door);
  rejectWithoutMutation(sim, { type: 'appoint', targetId: citizen.id, value: 0 });
  grant(sim, 'mayor');
  rejectWithoutMutation(sim, { type: 'appoint', targetId: citizen.id, value: 2 });
  rejectWithoutMutation(sim, { type: 'appoint', targetId: citizen.id, value: 3 });
  citizen.position = { ...mayorOffice.door, z: mayorOffice.door.z + 100 };
  rejectWithoutMutation(sim, { type: 'appoint', targetId: citizen.id, value: 0 });
  citizen.position = clone(mayorOffice.door);
  const funds = sim.state.treasury;
  ok(sim, { type: 'appoint', targetId: citizen.id, value: 0 });
  assert.equal(sim.state.treasury, funds - 100);
  assert.equal(citizen.role, 'official');
  assert.equal(citizen.workId, mayorOffice.id);
  assert.ok(citizen.historyTags!.includes('公共职务任命'));
  rejectWithoutMutation(sim, { type: 'appoint', targetId: citizen.id, value: 0 });
  const restored = restoredFrom(sim);
  rejectWithoutMutation(restored, { type: 'appoint', targetId: citizen.id, value: 0 });
  assert.equal(restored.state.citizens.find(item => item.id === citizen.id)!.workId, mayorOffice.id);
});

test('a trained student becomes a scientist and pays for research whose saved completion advances that resident’s skill', () => {
  const { sim, world } = create();
  const e = extension(sim);
  const scholar = sim.state.citizens[0];
  const school = building(world, 'school');
  scholar.role = '学生'; scholar.education = 3; scholar.money = 1000; scholar.workId = school.id;
  e.actorProfiles[scholar.id].skill = 35;
  type ResearchJob = { actorId?: string; startedAt: number; finishAt: number; budget: number };
  const runtime = () => (extension(sim) as CityExtensionState & { runtime: { researchJobs: Record<string, ResearchJob> } }).runtime;
  let funded = false;
  let before: { money: number; treasury: number; taxes: number; operatingCost: number } | null = null;
  sim.onPhase('traffic', () => {
    if (funded) return;
    scholar.position = clone(school.door);
    scholar.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  });
  sim.onPhase('commerce', () => {
    const coreRuntime = (JSON.parse(sim.exportSave()) as { runtime: { taxes: number; operatingCost: number } }).runtime;
    before = { money: scholar.money, treasury: sim.state.treasury, ...coreRuntime };
  });
  sim.onPhase('finance', () => {
    if (funded || !Object.values(runtime().researchJobs).some(job => job.actorId === scholar.id)) return;
    assert.ok(before);
    assert.equal(before.money - scholar.money, 200, 'resident research spends the researcher’s own cash');
    approximately(sim.state.treasury, before.treasury + before.taxes - before.operatingCost * (1 - sim.state.taxRate) + residentResearchPayments(sim),
      'the scholar and every simultaneous resident investment must reach the actual public research account');
    funded = true;
  });
  const playerMoney = sim.state.player.money;
  const playerSkill = e.actorProfiles.player.skill;
  sim.step(0.25);
  assert.equal(scholar.role, 'scientist');
  assert.ok(scholar.historyTags!.includes('学成参与科研'));
  assert.equal(scholar.workId, school.id);
  advanceUntil(sim, () => funded, 100);
  const [sector, job] = Object.entries(runtime().researchJobs).find(([, item]) => item.actorId === scholar.id)!;
  assert.ok(job);
  assert.equal(job.finishAt - job.startedAt, 120);
  const skill = e.actorProfiles[scholar.id].skill;
  const level = e.technologies.find(item => item.sector === sector)!.level;
  advanceMinutes(sim, 60);
  assert.equal(e.technologies.find(item => item.sector === sector)!.level, level);
  const restored = restoredFrom(sim);
  advanceMinutes(sim, 60);
  advanceMinutes(restored, 60);
  assert.deepEqual(restored.state, sim.state);
  assert.equal(e.technologies.find(item => item.sector === sector)!.level, level + 1);
  assert.ok(e.actorProfiles[scholar.id].skill >= skill + 2);
  assert.equal(e.actorProfiles.player.skill, playerSkill, 'resident research must credit the actual researcher rather than the player');
  assert.equal(sim.state.player.money, playerMoney);
  const investments = e.publicLedger.filter(entry => entry.actorId === scholar.id && entry.purpose.includes('居民科研投入')).length;
  advanceMinutes(sim, 60);
  assert.equal(e.publicLedger.filter(entry => entry.actorId === scholar.id && entry.purpose.includes('居民科研投入')).length, investments,
    'the actual researcher must respect the daily funding cooldown while other residents continue their work');
});

test('autonomous research respects personal reserves and urgent needs while accepting a trained Chinese research profession', async t => {
  const cases = [
    { name: '299 cash cannot fund research and keep its reserve', cash: 299, hunger: 100, fatigue: 100, funded: false },
    { name: 'hungry researcher first needs food', cash: 350, hunger: 39, fatigue: 100, funded: false },
    { name: 'exhausted researcher first needs rest', cash: 350, hunger: 100, fatigue: 39, funded: false },
    { name: '300 cash and satisfied needs allow the actual Chinese research profession', cash: 300, hunger: 100, fatigue: 100, funded: true },
  ];
  for (const item of cases) {
    await t.test(item.name, () => {
      const { sim, world } = create();
      const researcher = sim.state.citizens[0];
      const lab = building(world, 'core');
      researcher.role = '科研员'; researcher.workId = lab.id; researcher.education = 3; researcher.money = item.cash;
      extension(sim).actorProfiles[researcher.id].skill = 35;
      sim.onPhase('traffic', () => {
        researcher.position = clone(lab.door);
        researcher.needs = { hunger: item.hunger, fatigue: item.fatigue, social: 100, fun: 100 };
      });
      walkTo(sim, lab.door);
      advanceMinutes(sim, 60);
      const investment = extension(sim).publicLedger.find(entry => entry.actorId === researcher.id && entry.purpose.includes('居民科研投入'));
      assert.equal(!!investment, item.funded);
      if (item.funded) {
        assert.equal(investment!.amount, 200);
        assert.equal(researcher.money, 100, 'the actual personal cost leaves the stated living reserve');
        const runtime = extension(sim) as CityExtensionState & { runtime: { researchJobs: Record<string, { actorId?: string; budget: number }> } };
        assert.ok(Object.values(runtime.runtime.researchJobs).some(job => job.actorId === researcher.id && job.budget === 200));
      }
    });
  }
});

test('the generated city autonomously funds and completes research through actual trained residents and laboratories', t => {
  const world = createWorld();
  const sim = new Simulation(world);
  ok(sim, { type: 'speed', value: 8 });
  const buildings = new Map(world.buildings.map(site => [site.id, site]));
  const cashBeforeFinance = new Map<string, number>();
  const wagedThisTick = new Set<string>();
  const funded = new Map<string, { actorId: string; sector: string; finishAt: number; skill: number }>();
  let exactPersonalDebits = 0;
  const startMinute = extension(sim).lastUpdate;
  sim.setFocus(world.spawn, 'walk');
  sim.onPhase('time', () => { wagedThisTick.clear(); });
  sim.onEvent('wage', event => { if (event.citizenId) wagedThisTick.add(event.citizenId); });
  sim.onPhase('commerce', () => {
    for (const citizen of sim.state.citizens) cashBeforeFinance.set(citizen.id, citizen.money);
  });
  sim.onPhase('finance', () => {
    const e = extension(sim) as CityExtensionState & { runtime: { researchJobs: Record<string, { actorId?: string; budget: number; startedAt: number; finishAt: number }> } };
    for (const [sector, job] of Object.entries(e.runtime.researchJobs)) {
      const key = `${sector}:${job.actorId}:${job.startedAt}`;
      if (funded.has(key) || !job.actorId || job.actorId === 'player') continue;
      const citizen = sim.state.citizens.find(actor => actor.id === job.actorId)!;
      assert.ok(citizen, 'the generated research must name a real resident');
      const laboratory = buildings.get(citizen.workId)!;
      assert.ok(['scientist', '科研员', '科学家'].includes(citizen.role));
      assert.ok((citizen.education ?? 0) >= 3 && e.actorProfiles[citizen.id].skill >= 35);
      assert.ok(e.actorProfiles[citizen.id].alive);
      assert.ok(laboratory.kind === 'school' || laboratory.kind === 'core' || laboratory.facility === 'data');
      assert.ok(sim.isNearBuilding(laboratory, citizen.position), 'autonomous investment requires presence at the actual laboratory');
      assert.ok(citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 40);
      assert.ok(citizen.money >= 100, 'personal research must retain a living reserve');
      assert.equal(job.budget, 200);
      assert.equal(job.finishAt - job.startedAt, 120);
      assert.ok(e.publicLedger.some(entry => entry.tick === sim.state.tick && entry.actorId === citizen.id
        && entry.purpose.includes('居民科研投入') && entry.amount === 200), 'the named resident’s real investment reaches public research finance');
      if (!wagedThisTick.has(citizen.id)) {
        approximately(cashBeforeFinance.get(citizen.id)! - citizen.money, 200,
          'a research opportunity outside payday debits the actual resident’s cash');
        exactPersonalDebits++;
      }
      funded.set(key, { actorId: citizen.id, sector, finishAt: job.finishAt, skill: e.actorProfiles[citizen.id].skill });
    }
  });
  for (let index = 0; index < 6000 && (extension(sim).lastUpdate - startMinute < 3 * 1440 || extension(sim).stats.researchCompleted === 0); index++) {
    sim.step(0.25);
    if (index % 1000 === 0) {
      const district = world.districts[Math.floor(index / 1000) % world.districts.length];
      sim.setFocus(district.center, index % 2000 === 0 ? 'walk' : 'drone');
    }
  }
  assert.ok(extension(sim).lastUpdate - startMinute >= 3 * 1440, 'the natural city run must cover at least three actual game days');
  assert.ok(funded.size > 0, 'the default city must reach a real personal research opportunity without supplied cash, skills or identities');
  assert.ok(extension(sim).stats.researchCompleted > 0, 'at least one real experiment must finish during the multi-day city run');
  assert.ok(exactPersonalDebits > 0);
  const completion = [...funded.values()].find(job => extension(sim).lastUpdate + 1e-7 >= job.finishAt);
  assert.ok(completion);
  assert.ok(extension(sim).technologies.find(technology => technology.sector === completion.sector)!.level > 0);
  assert.ok(extension(sim).actorProfiles[completion.actorId].skill >= completion.skill + 2);
  t.diagnostic(`generated city: tick ${sim.state.tick}, ${funded.size} real resident investments, ${extension(sim).stats.researchCompleted} completed experiments, ${exactPersonalDebits} exact personal debits`);
  const restored = new Simulation(world);
  const result = restored.importSave(sim.exportSave());
  const routeDocument = JSON.parse(sim.exportSave());
  t.diagnostic(JSON.stringify({ generatedResearchSave: true, importResult: result, encoding: routeDocument.routeEncoding,
    poolExtents: routeDocument.routeEncoding === 'paged-v1' ? routeDocument.routePool.map((page: unknown[]) => page.length) : [routeDocument.routePool.length],
    maxActorRoute: Math.max(...routeDocument.state.citizens.map((citizen: any) => citizen.route?.length ?? 0)), saveBytes: Buffer.byteLength(sim.exportSave()) }));
  assert.equal(result.ok, true, result.message);
  for (let index = 0; index < 24; index++) { sim.step(0.25); restored.step(0.25); }
  assert.equal(restored.exportSave(), sim.exportSave(), 'the generated research result and its funding cooldown must continue deterministically');
});

test('a skilled worker uses accumulated personal savings to found a company with real capital and registration fees', () => {
  const { sim, world } = create();
  const e = extension(sim);
  const site = world.buildings.find(site => site.kind === 'market' && !site.facility
    && !e.companies.some(company => company.buildingId === site.id))!;
  const worker = sim.state.citizens.find(citizen => !e.companies.some(company => company.ownerId === citizen.id))!;
  assert.ok(site && worker, 'a first enterprise requires an unincorporated shop and a resident who does not already own a company');
  worker.role = '工人'; worker.workId = site.id; worker.education = 1; worker.money = 1000;
  e.actorProfiles[worker.id].skill = 45;
  let founded = false;
  let before: { money: number; treasury: number; taxes: number; operatingCost: number } | null = null;
  sim.onPhase('traffic', () => {
    if (founded) return;
    worker.position = clone(site.door);
    worker.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  });
  sim.onPhase('commerce', () => {
    const coreRuntime = (JSON.parse(sim.exportSave()) as { runtime: { taxes: number; operatingCost: number } }).runtime;
    before = { money: worker.money, treasury: sim.state.treasury, ...coreRuntime };
  });
  sim.onPhase('finance', () => {
    const company = e.companies.find(item => item.ownerId === worker.id);
    if (founded || !company) return;
    assert.ok(before);
    assert.equal(before.money - worker.money, 250);
    approximately(company.capital, 200 + sim.shopProtectedFunds(sim.state.shops.find(shop => shop.buildingId === company.buildingId)!), 'founding preserves wages and already accepted future labor promises in the sole company cash account');
    assert.ok(e.publicLedger.some(entry => entry.tick === sim.state.tick && entry.actorId === worker.id
      && entry.purpose === '居民创业登记费' && entry.amount === 50));
    approximately(sim.state.treasury, before.treasury + before.taxes - before.operatingCost * (1 - sim.state.taxRate) + 50 + residentResearchPayments(sim),
      'company registration and simultaneous personally funded research must settle the real treasury');
    sharesAreConserved(company);
    assert.equal(company.shareholders[worker.id], company.shares);
    founded = true;
  });
  const playerMoney = sim.state.player.money;
  advanceUntil(sim, () => founded, 100);
  assert.equal(worker.role, 'merchant');
  assert.ok(e.actorProfiles[worker.id].historyTags.includes('自主创业'));
  assert.equal(sim.state.player.money, playerMoney, 'the resident’s enterprise must not spend or reward player funds');
  const restored = restoredFrom(sim);
  advanceMinutes(sim, 60);
  advanceMinutes(restored, 60);
  assert.deepEqual(restored.state, sim.state);
  assert.equal(e.companies.filter(item => item.ownerId === worker.id).length, 1);
});

test('an ordinary traveler can report real ledger evidence before an audit case exists, with remote and repeated reports rejected atomically', () => {
  const { sim, world } = create();
  const e = extension(sim);
  const hall = building(world, 'hall');
  const actor = sim.state.citizens[0];
  actor.role = 'official'; actor.workId = hall.id;
  let diverted = false;
  sim.onPhase('time', () => {
    if (diverted) return;
    actor.money = 10;
    actor.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
    e.actorProfiles[actor.id].stress = 90;
  });
  sim.onPhase('finance', () => { diverted ||= e.publicLedger.some(entry => entry.actorId === actor.id && entry.purpose.includes('挪用')); });
  advanceUntil(sim, () => diverted, 500);
  assert.equal(e.audits.length, 0);
  assert.equal(sim.state.player.role, 'traveler');
  walkTo(sim, { ...hall.door, z: hall.door.z + 100 });
  rejectWithoutMutation(sim, { type: 'reportCorruption', targetId: actor.id });
  walkTo(sim, hall.door);
  rejectWithoutMutation(sim, { type: 'reportCorruption', targetId: 'absent-actor' });
  rejectWithoutMutation(sim, { type: 'reportCorruption', targetId: sim.state.citizens[1].id });
  const money = sim.state.player.money;
  ok(sim, { type: 'reportCorruption', targetId: actor.id });
  const item = e.audits.find(case_ => case_.npcId === actor.id)!;
  assert.ok(item);
  assert.equal(item.status, 'reported');
  assert.ok(item.evidence >= 35);
  assert.equal(item.responseAt - e.lastUpdate, 60);
  assert.equal(sim.state.player.money, money, 'reporting evidence must not create a fixed bounty');
  rejectWithoutMutation(sim, { type: 'reportCorruption', targetId: actor.id });
  rejectWithoutMutation(sim, { type: 'reportCorruption', targetId: item.id });
  const restored = restoredFrom(sim);
  assert.equal(extension(restored).audits.find(case_ => case_.id === item.id)!.responseAt, item.responseAt);
});

test('market share includes sales at actual competing city shops outside registered companies', () => {
  const { sim, world } = create();
  sim.state.player.money = 10_000;
  grant(sim, 'merchant');
  const company = foundCompany(sim, world);
  buyIngredient(sim, 'grain', 1);
  const competingMarket = building(world, 'market', 1);
  assert.equal(extension(sim).companies.some(item => item.buildingId === competingMarket.id), false);
  walkTo(sim, competingMarket.door);
  buyIngredient(sim, 'grain', 1);
  sim.step(0.25);
  const receipts = sim.state.shops.reduce((sum, shop) => sum + shop.revenue, 0);
  assert.ok(receipts > company.revenue);
  approximately(company.marketShare, company.revenue / receipts,
    'unregistered competing businesses still participate in the real market');
});

test('a deterministic mountain flood damages the district and residents and spends actual emergency funds', () => {
  const { sim } = create();
  const e = extension(sim);
  sim.state.weather = '雨';
  e.environment.stormRisk = 100;
  e.environment.disasterAt = e.lastUpdate;
  const before = clone({ treasury: sim.state.treasury, districts: sim.state.districts, profiles: e.actorProfiles, water: e.environment.waterQuality });
  const restored = restoredFrom(sim);
  sim.step(0.25);
  restored.step(0.25);
  assert.deepEqual(restored.state, sim.state, 'disaster selection and damage must use the saved city RNG');
  assert.ok(e.environment.lastDisaster.includes('山洪'));
  assert.ok(e.environment.disasterAt > e.lastUpdate);
  assert.ok(e.environment.waterQuality < before.water);
  assert.ok(sim.state.treasury < before.treasury);
  const expense = e.publicLedger.find(entry => entry.purpose.includes('救灾'));
  assert.ok(expense && expense.amount < 0, 'emergency spending must be recorded as a real public debit');
  const district = sim.state.districts.find(item => item.id === expense.districtId)!;
  assert.ok(district.prosperity < before.districts.find(item => item.id === district.id)!.prosperity);
  const resident = sim.state.citizens.find(item => item.districtId === district.id)!;
  assert.ok(e.actorProfiles[resident.id].health < before.profiles[resident.id].health);
  finiteTree(sim.state);
});

test('the extension remains finite, bounded, recoverable and deterministic over multiple accelerated game weeks', () => {
  const { sim } = create();
  ok(sim, { type: 'speed', value: 16 });
  const clock = extension(sim).lastUpdate;
  advanceMinutes(sim, 14 * 1440, 6000);
  assert.ok(extension(sim).lastUpdate - clock >= 14 * 1440, 'the run must cover at least two complete game weeks');
  finiteTree(sim.state);
  for (const profile of Object.values(extension(sim).actorProfiles)) {
    assert.ok(profile.health >= 0 && profile.health <= 100);
    assert.ok(profile.age >= 0 && profile.age <= 140);
    assert.ok(profile.stress >= 0 && profile.stress <= 100);
  }
  for (const company of extension(sim).companies) sharesAreConserved(company);
  assert.ok(extension(sim).publicLedger.length <= 512);
  assert.ok(extension(sim).audits.length <= 128);
  const restored = restoredFrom(sim);
  for (let index = 0; index < 100; index++) {
    sim.step(0.25);
    restored.step(0.25);
  }
  assert.equal(restored.exportSave(), sim.exportSave());
});
