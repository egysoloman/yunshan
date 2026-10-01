import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import type { BuildingKind, Relationship, SimState, Vec3, WorldDefinition } from '../src/types.ts';

/** Two connected neighbourhoods isolate simulation rules from procedural world generation. */
function fixture(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'bank', 'hall', 'police', 'school', 'clinic', 'station', 'core', 'pavilion', 'airport', 'starport', 'farm', 'dock'];
  const districts = [0, 1].map(index => ({ id: `district-${index}`, name: `测试城区 ${index}`, kind: index ? 'residential' : 'market', center: { x: index * 4000, y: index * 80, z: 0 }, radius: 500, color: '#77aabb', population: 120 }));
  const buildings = districts.flatMap((district, districtIndex) => kinds.map((kind, index) => {
    const position = { x: district.center.x + index * 16, y: district.center.y, z: 0 };
    return { id: `${district.id}-${kind}`, districtId: district.id, name: `${district.name} ${kind}`, kind, position, door: { ...position, z: 5 }, width: 10, depth: 10, height: 12, floors: 2, rotation: 0, capacity: 30, seed: districtIndex * 100 + index };
  }));
  const nodes = districts.flatMap(district => [0, 1].map(index => ({ id: `${district.id}-node-${index}`, districtId: district.id, name: `站点 ${index}`, position: { x: district.center.x + index * 200, y: district.center.y, z: 20 }, station: true })));
  const edges = [
    { id: 'road', from: nodes[0].id, to: nodes[1].id, mode: 'road' as const, length: 200, capacity: 20, points: [nodes[0].position, nodes[1].position] },
    { id: 'maglev', from: nodes[1].id, to: nodes[2].id, mode: 'maglev' as const, length: 3800, capacity: 80, points: [nodes[1].position, nodes[2].position] },
    { id: 'flight', from: nodes[2].id, to: nodes[3].id, mode: 'flight' as const, length: 200, capacity: 30, points: [nodes[2].position, { x: 4100, y: 180, z: 20 }, nodes[3].position] },
  ];
  return { seed: 1977, voxelSize: 0.2, size: 5000, districts, buildings, nodes, edges, mountains: [], spawn: { x: 0, y: 0, z: 0 }, waterfall: { top: { x: 300, y: 100, z: 100 }, bottom: { x: 300, y: 0, z: 100 }, width: 20 }, river: [{ x: 300, y: 0, z: 100 }, { x: 300, y: 0, z: 500 }] };
}

function create() {
  const world = fixture();
  const sim = new Simulation(world); sim.command({ type: 'speed', value: 8 });
  return { world, sim };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function distance(a: Vec3, b: Vec3) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function walkTo(sim: Simulation, position: Vec3) { sim.setFocus({ ...position }, 'walk'); }
function advanceUntil(sim: Simulation, predicate: () => boolean, limit = 2000) {
  for (let index = 0; index < limit && !predicate(); index++) sim.step(0.25);
  assert.ok(predicate(), 'simulation did not reach the expected observable state');
}

test('ticks run all city systems in the required causal order, and pausing freezes the city', () => {
  const { sim } = create();
  const initialTick = sim.state.tick;
  advanceUntil(sim, () => sim.state.tick > initialTick);
  assert.deepEqual(sim.state.lastSystemOrder, ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback']);
  assert.equal(sim.command({ type: 'pause' }).ok, true);
  assert.equal(sim.state.paused, true);
  const paused = clone(sim.state);
  sim.step(10);
  assert.deepEqual(sim.state, paused, 'paused ticks must not spend funds, move vehicles, or advance needs');
  assert.equal(sim.command({ type: 'pause' }).ok, true);
  advanceUntil(sim, () => sim.state.tick > paused.tick);
});

test('the clock progresses continuously and wraps to a new day', () => {
  const { sim } = create();
  assert.equal(sim.command({ type: 'setTime', value: 23.99 }).ok, true);
  const day = sim.state.day;
  advanceUntil(sim, () => sim.state.day > day);
  assert.ok(sim.state.hour >= 0 && sim.state.hour < 1);
  assert.equal(sim.state.day, day + 1);
});

test('changing the time rebuilds citizen schedules and changes shop opening hours', () => {
  const { sim } = create();
  const citizen = sim.state.citizens.find(item => item.districtId === 'district-0' && item.workId !== item.homeId)!;
  assert.ok(citizen);
  walkTo(sim, citizen.position);
  citizen.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  assert.equal(sim.command({ type: 'setTime', value: 10 }).ok, true);
  sim.step(0.25);
  assert.ok(citizen.destinationId === citizen.workId || citizen.state === 'working', 'daytime schedule must lead to a real workplace');
  assert.ok(sim.state.shops.some(shop => shop.open));
  assert.equal(sim.command({ type: 'setTime', value: 23 }).ok, true);
  sim.step(0.25);
  assert.ok(citizen.destinationId === citizen.homeId || citizen.state === 'sleeping', 'night schedule must return citizens to their real homes');
  assert.ok(sim.state.shops.every(shop => !shop.open));
});

test('nearby purchases consume stock, pay the shop, and satisfy hunger; remote purchases have no effect', () => {
  const { sim, world } = create();
  assert.equal(sim.command({ type: 'setTime', value: 12 }).ok, true);
  sim.step(0.25);
  const shop = sim.state.shops[0];
  assert.ok(shop, 'a market must create a usable shop');
  const market = world.buildings.find(building => building.id === shop.buildingId)!;
  sim.state.player.money = 1000;
  sim.state.player.needs.hunger = 10;
  walkTo(sim, { x: market.door.x + 100, y: market.door.y, z: market.door.z });
  const remote = clone({ player: sim.state.player, shop });
  assert.equal(sim.command({ type: 'purchase', targetId: shop.id }).ok, false);
  assert.deepEqual({ player: sim.state.player, shop }, remote);
  walkTo(sim, market.door);
  const before = { money: sim.state.player.money, hunger: sim.state.player.needs.hunger, inventory: shop.inventory, revenue: shop.revenue };
  assert.equal(sim.command({ type: 'purchase', targetId: shop.id }).ok, true);
  assert.ok(sim.state.player.money < before.money);
  assert.ok(shop.inventory < before.inventory);
  assert.ok(shop.revenue > before.revenue);
  assert.ok(Math.abs((before.money - sim.state.player.money) - (shop.revenue - before.revenue)) < 1e-8, 'the shop must receive the amount paid by the buyer');
  assert.ok(sim.state.player.needs.hunger > before.hunger);
});

test('social encounters require proximity and retain relationship memories after leaving the neighbourhood', () => {
  const { sim, world } = create();
  const citizen = sim.state.citizens[0];
  assert.ok(citizen);
  walkTo(sim, { x: citizen.position.x + 100, y: citizen.position.y, z: citizen.position.z });
  assert.equal(sim.command({ type: 'socialize', targetId: citizen.id }).ok, false);
  assert.equal(sim.state.relationships.some(relationship => relationship.npcId === citizen.id), false);
  walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'socialize', targetId: citizen.id }).ok, true);
  const relationship = sim.state.relationships.find(relationship => relationship.npcId === citizen.id)!;
  assert.ok(relationship);
  assert.ok(relationship.encounters > 0);
  assert.ok(relationship.memories.length > 0);
  const memory = clone(relationship.memories[0]);
  walkTo(sim, world.districts[1].center);
  sim.step(1);
  walkTo(sim, citizen.position);
  assert.ok(sim.state.relationships.find(relationship => relationship.npcId === citizen.id)!.memories.some(item => item.tick === memory.tick && item.text === memory.text));
});

test('bank operations preserve account balances and reject unaffordable or invalid amounts', () => {
  const { sim, world } = create();
  const bank = world.buildings.find(building => building.kind === 'bank')!;
  walkTo(sim, bank.door);
  sim.state.player.money = 1000;
  const wealth = sim.state.player.money + sim.state.bankBalance;
  assert.equal(sim.command({ type: 'deposit', targetId: bank.id, value: 100 }).ok, true);
  assert.equal(sim.state.player.money + sim.state.bankBalance, wealth);
  assert.equal(sim.command({ type: 'withdraw', targetId: bank.id, value: 40 }).ok, true);
  assert.equal(sim.state.player.money + sim.state.bankBalance, wealth);
  for (const command of [
    { type: 'deposit' as const, value: -1 },
    { type: 'deposit' as const, value: Number.NaN },
    { type: 'withdraw' as const, value: sim.state.bankBalance + 1 },
  ]) {
    const before = clone(sim.state);
    assert.equal(sim.command({ ...command, targetId: bank.id }).ok, false);
    assert.deepEqual(sim.state, before, 'rejected bank transactions must not create or destroy money');
  }
});

test('work pays for an actual local shift and cannot be repeated immediately for unlimited income', () => {
  const { sim, world } = create();
  const workshop = world.buildings.find(building => building.kind === 'workshop')!;
  // Fund both shifts from a real wallet; the employer cannot pay an unfunded wage.
  const employer = sim.state.shops.find(shop => shop.buildingId === workshop.id)!;
  employer.employees = 0; // Isolate the player's funded contract from autonomous NPC commitments.
  sim.state.player.money -= 100; sim.transferShopFunds(employer, 100);
  walkTo(sim, workshop.door);
  const before = { money: sim.state.player.money, experience: sim.state.player.experience };
  assert.equal(sim.command({ type: 'work', targetId: workshop.id }).ok, true);
  assert.equal(sim.state.player.money, before.money, 'starting a shift reserves real cash without paying unperformed work');
  assert.equal(sim.state.player.experience, before.experience);
  const earned = sim.state.player.money;
  assert.equal(sim.command({ type: 'work', targetId: workshop.id }).ok, false);
  assert.equal(sim.state.player.money, earned);
  const tick = sim.state.tick;
  advanceUntil(sim, () => sim.state.tick >= tick + 30);
  assert.ok(sim.state.player.money > before.money); assert.equal(sim.state.player.experience, before.experience + 1);
  assert.equal(sim.state.playerLabor!.history.at(-1)!.workedMinutes, 60);
  assert.equal(sim.command({ type: 'work', targetId: workshop.id }).ok, true);
});

test('education and a local professional exam unlock police permissions', () => {
  const { sim, world } = create();
  const police = world.buildings.find(building => building.kind === 'police')!;
  const school = world.buildings.find(building => building.kind === 'school')!;
  const hall = world.buildings.find(building => building.kind === 'hall')!;
  sim.state.player.money = 1000;
  walkTo(sim, police.door);
  assert.equal(sim.state.player.role, 'traveler');
  assert.equal(sim.command({ type: 'exam', targetId: 'police' }).ok, false);
  walkTo(sim, school.door);
  assert.equal(sim.command({ type: 'exam', targetId: 'study' }).ok, true);
  assert.ok(sim.state.player.education >= 1);
  walkTo(sim, { x: police.door.x + 100, y: police.door.y, z: police.door.z });
  assert.equal(sim.command({ type: 'exam', targetId: 'police' }).ok, false);
  walkTo(sim, police.door);
  assert.equal(sim.command({ type: 'exam', targetId: 'police' }).ok, true);
  assert.equal(sim.state.player.role, 'police');
  walkTo(sim, hall.door);
  assert.equal(sim.command({ type: 'policy', taxRate: 0.2, policeBudget: 0.7 }).ok, false);
  assert.equal(sim.command({ type: 'exam', targetId: 'mayor' }).ok, false, 'mayoral authority requires an election');
});

test('only a nearby authorized officer can resolve a crime and receive the resulting credit', () => {
  const { sim } = create();
  const crime = { id: 'test-crime', districtId: 'district-0', position: { x: 0, y: 0, z: 0 }, severity: 0.5, status: 'open' as const, responseAt: 1000 };
  sim.state.crimes.push(crime);
  walkTo(sim, crime.position);
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, false);
  sim.state.player.role = 'police';
  walkTo(sim, { x: 100, y: 0, z: 0 });
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, false);
  walkTo(sim, crime.position);
  const resolved = sim.state.metrics.crimesResolved;
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, true);
  assert.equal(crime.status, 'resolved');
  assert.equal(sim.state.metrics.crimesResolved, resolved + 1);
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, false, 'the same case cannot award repeated credit');
});

test('public police dispatch and complete a funded response without player intervention', () => {
  const { sim, world } = create();
  const station = world.buildings.find(building => building.kind === 'police')!;
  const crime = { id: 'automatic-case', districtId: station.districtId, position: { ...station.door }, severity: 2, status: 'open' as 'open' | 'responding' | 'resolved', responseAt: 0 };
  sim.state.crimes.push(crime);
  const funds = sim.state.treasury;
  const resolved = sim.state.metrics.crimesResolved;
  sim.step(0.25);
  assert.equal(crime.status, 'responding');
  assert.ok(crime.responseAt > sim.state.day * 1440 + sim.state.hour * 60);
  assert.ok(sim.state.treasury < funds);
  advanceUntil(sim, () => crime.status === 'resolved');
  assert.equal(sim.state.metrics.crimesResolved, resolved + 1);
});

test('mayoral policies take effect after the stated delay and keep invalid policies out of the queue', () => {
  const { sim, world } = create();
  const hall = world.buildings.find(building => building.kind === 'hall')!;
  walkTo(sim, hall.door);
  sim.state.player.role = 'mayor';
  const submittedAt = sim.state.tick;
  const rates = { taxRate: sim.state.taxRate, policeBudget: sim.state.policeBudget };
  assert.equal(sim.command({ type: 'policy', taxRate: 0.23, policeBudget: 0.8 }).ok, true);
  assert.ok(sim.state.policyPending);
  assert.ok(sim.state.policyPending.applyAt > sim.state.tick);
  assert.equal(sim.state.taxRate, rates.taxRate);
  assert.equal(sim.state.policeBudget, rates.policeBudget);
  const pending = clone(sim.state.policyPending);
  assert.equal(sim.command({ type: 'policy', taxRate: 2, policeBudget: -1 }).ok, false);
  assert.deepEqual(sim.state.policyPending, pending);
  sim.step(0.25 * 30);
  assert.ok(sim.state.policyPending, 'one hour is too early for a two-hour policy implementation');
  assert.equal(sim.state.taxRate, rates.taxRate);
  assert.equal(sim.state.policeBudget, rates.policeBudget);
  advanceUntil(sim, () => !sim.state.policyPending);
  assert.equal(sim.state.tick, submittedAt + 60, 'a two-hour policy must apply after sixty two-minute ticks');
  assert.equal(sim.state.taxRate, 0.23);
  assert.equal(sim.state.policeBudget, 0.8);
});

test('an eligible local campaign takes time to win an election, including across save/load', () => {
  const { sim, world } = create();
  const hall = world.buildings.find(building => building.kind === 'hall')!;
  walkTo(sim, hall.door);
  assert.equal(sim.command({ type: 'election', targetId: hall.id }).ok, false);
  Object.assign(sim.state.player, { reputation: 12, education: 2, experience: 4, money: 1000 });
  sim.state.support = 80;
  const funds = sim.state.player.money;
  const campaignAt = sim.state.tick;
  assert.equal(sim.command({ type: 'election', targetId: hall.id }).ok, true);
  assert.ok(sim.state.player.money < funds);
  assert.equal(sim.state.player.role, 'traveler');
  sim.step(0.25 * 20);
  const restored = new Simulation(fixture());
  assert.equal(restored.importSave(sim.exportSave()).ok, true);
  assert.equal(restored.state.player.role, 'traveler');
  advanceUntil(restored, () => restored.state.player.role === 'mayor');
  assert.equal(restored.state.tick, campaignAt + 60, 'save/load must preserve the original two-hour vote count deadline');
});

test('saving preserves a paid work shift cooldown instead of allowing immediate duplicate payment', () => {
  const { sim, world } = create();
  const workshop = world.buildings.find(building => building.kind === 'workshop')!;
  // Fund both shifts from a real wallet; the employer cannot pay an unfunded wage.
  const employer = sim.state.shops.find(shop => shop.buildingId === workshop.id)!;
  employer.employees = 0; // Isolate the player's funded contract from autonomous NPC commitments.
  sim.state.player.money -= 100; sim.transferShopFunds(employer, 100);
  walkTo(sim, workshop.door);
  assert.equal(sim.command({ type: 'work', targetId: workshop.id }).ok, true);
  const restored = new Simulation(fixture());
  assert.equal(restored.importSave(sim.exportSave()).ok, true);
  const paid = restored.state.player.money;
  assert.equal(restored.command({ type: 'work', targetId: workshop.id }).ok, false);
  assert.equal(restored.state.player.money, paid);
  advanceUntil(restored, () => restored.state.tick >= sim.state.tick + 30);
  assert.equal(restored.command({ type: 'work', targetId: workshop.id }).ok, true);
});

test('a passenger follows a moving vehicle and can leave it without teleporting back to the boarding point', () => {
  const { sim } = create();
  const vehicle = sim.state.vehicles.find(item => item.kind === 'maglev') ?? sim.state.vehicles[0];
  assert.ok(vehicle);
  walkTo(sim, { x: vehicle.position.x + 100, y: vehicle.position.y, z: vehicle.position.z });
  assert.equal(sim.command({ type: 'ride', targetId: vehicle.id }).ok, false);
  walkTo(sim, vehicle.position);
  const boarding = { ...vehicle.position };
  assert.equal(sim.command({ type: 'ride', targetId: vehicle.id }).ok, true);
  assert.equal(sim.state.player.vehicleId, vehicle.id);
  advanceUntil(sim, () => distance(vehicle.position, boarding) > 1);
  assert.deepEqual(sim.state.player.position, vehicle.position);
  assert.equal(sim.command({ type: 'leaveVehicle' }).ok, false, 'a passenger must wait for a safe stop');
  advanceUntil(sim, () => vehicle.state === 'boarding' && distance(vehicle.position, boarding) > 100);
  const exit = { ...sim.state.player.position };
  assert.equal(sim.command({ type: 'leaveVehicle' }).ok, true);
  assert.equal(sim.state.player.vehicleId, null);
  assert.ok(distance(sim.state.player.position, exit) < 10);
});

test('driving requires the corresponding professional permission and an accessible vehicle', () => {
  const { sim } = create();
  const vehicle = sim.state.vehicles.find(item => item.kind === 'road')!;
  assert.ok(vehicle);
  walkTo(sim, vehicle.position);
  assert.equal(sim.command({ type: 'drive', targetId: vehicle.id }).ok, false);
  sim.state.player.role = 'driver';
  walkTo(sim, { x: vehicle.position.x + 100, y: vehicle.position.y, z: vehicle.position.z });
  assert.equal(sim.command({ type: 'drive', targetId: vehicle.id }).ok, false);
  walkTo(sim, vehicle.position);
  assert.equal(sim.command({ type: 'drive', targetId: vehicle.id }).ok, true);
  assert.equal(sim.state.player.vehicleId, vehicle.id);
});

test('persistent citizen identities and their home/work assignments survive simulation tier changes', () => {
  const { sim, world } = create();
  assert.ok(sim.state.citizens.length > 0);
  const citizens = sim.state.citizens.map(({ id, name, districtId, homeId, workId }) => ({ id, name, districtId, homeId, workId }));
  assert.equal(new Set(citizens.map(citizen => citizen.id)).size, citizens.length);
  const buildings = new Set(world.buildings.map(building => building.id));
  for (const citizen of citizens) {
    assert.ok(buildings.has(citizen.homeId), `${citizen.id} must have a real home`);
    assert.ok(buildings.has(citizen.workId), `${citizen.id} must have a real workplace`);
  }
  sim.setFocus(world.districts[1].center, 'walk');
  const tick = sim.state.tick;
  advanceUntil(sim, () => sim.state.tick >= tick + 12);
  sim.setFocus(world.spawn, 'walk');
  advanceUntil(sim, () => sim.state.tick >= tick + 24);
  assert.deepEqual(sim.state.citizens.map(({ id, name, districtId, homeId, workId }) => ({ id, name, districtId, homeId, workId })), citizens);
  assert.ok(sim.state.citizens.some(citizen => citizen.tier === 'active'));
  assert.ok(sim.state.citizens.some(citizen => citizen.tier !== 'active'));
});

test('remote camera focus changes simulation detail while walking moves the actual player', () => {
  const { sim, world } = create();
  const playerPosition = { ...sim.state.player.position };
  sim.setFocus(world.districts[1].center, 'drone');
  assert.deepEqual(sim.state.player.position, playerPosition);
  sim.setFocus(world.districts[1].center, 'jet');
  assert.deepEqual(sim.state.player.position, playerPosition);
  sim.setFocus(world.districts[1].center, 'walk');
  assert.deepEqual(sim.state.player.position, world.districts[1].center);
});

test('save/load resumes the same clock, random events, vehicle schedules, and fractional tick timer', () => {
  const { sim } = create();
  const tick = sim.state.tick;
  advanceUntil(sim, () => sim.state.tick >= tick + 17);
  sim.step(0.13);
  const restored = new Simulation(fixture());
  assert.equal(restored.importSave(sim.exportSave()).ok, true);
  assert.deepEqual(restored.state, sim.state);
  // Uneven frame durations exercise the saved partial-tick accumulator as well as the RNG.
  for (let index = 0; index < 160; index++) {
    const seconds = [0.07, 0.13, 0.41, 0.23][index % 4];
    sim.step(seconds);
    restored.step(seconds);
    assert.deepEqual(restored.state, sim.state, `restored city diverged on frame ${index}`);
  }
});

test('malformed and incompatible saves are rejected without partially replacing the live city', () => {
  const { sim } = create();
  const before = clone(sim.state);
  for (const save of ['{', 'null', '{}', '[]', '{"version":999,"state":{}}']) {
    assert.equal(sim.importSave(save).ok, false, `must reject ${save}`);
    assert.deepEqual(sim.state, before, 'a rejected import must leave the running city intact');
  }
});

test('save validation rejects corrupt numbers, foreign references, duplicate entities, and another world', () => {
  const { sim } = create();
  const valid = JSON.parse(sim.exportSave()) as { worldSeed: number; worldFingerprint: string; state: SimState; runtime: Record<string, unknown> };
  const corruptions: ((save: typeof valid) => void)[] = [
    save => { save.worldSeed += 1; },
    save => { save.worldFingerprint = 'unrelated-city'; },
    save => { save.state.hour = 24; },
    save => { save.state.player.money = Number.POSITIVE_INFINITY; },
    save => { save.state.citizens[0].homeId = 'missing-home'; },
    save => { save.state.citizens.push(clone(save.state.citizens[0])); },
    save => { save.state.player.vehicleId = 'missing-vehicle'; },
    save => { save.runtime.accumulator = -1; },
    save => { save.runtime.rng = 'invalid-rng'; },
    save => { Reflect.deleteProperty(save.state, 'player'); },
  ];
  for (const corrupt of corruptions) {
    const broken = clone(valid);
    corrupt(broken);
    const before = clone(sim.state);
    assert.equal(sim.importSave(JSON.stringify(broken)).ok, false);
    assert.deepEqual(sim.state, before);
  }
});

test('professional certificates accumulate and retain enforcement permissions after a new career', () => {
  const { sim, world } = create();
  walkTo(sim, world.buildings.find(b => b.kind === 'school')!.door);
  assert.equal(sim.command({ type: 'exam', targetId: 'study' }).ok, true);
  walkTo(sim, world.buildings.find(b => b.kind === 'police')!.door);
  assert.equal(sim.command({ type: 'exam', targetId: 'police' }).ok, true);
  walkTo(sim, world.buildings.find(b => b.kind === 'market')!.door);
  assert.equal(sim.command({ type: 'exam', targetId: 'merchant' }).ok, true);
  assert.equal(sim.state.player.role, 'merchant');
  assert.ok(sim.state.player.identities?.includes('police'));
  assert.ok(sim.state.player.identities?.includes('traveler'));
  const crime = { id: 'certificate-crime', districtId: world.districts[0].id, position: { ...sim.state.player.position }, severity: 1, status: 'open' as const, responseAt: 0 };
  sim.state.crimes.push(crime);
  assert.equal(sim.command({ type: 'resolveCrime', targetId: crime.id }).ok, true);
  assert.equal(crime.status, 'resolved');
});

test('facility utility lets urgent hunger override the default working schedule', () => {
  const { sim } = create();
  const citizen = sim.state.citizens[0];
  citizen.needs = { hunger: 0, fatigue: 100, social: 100, fun: 100 };
  citizen.money = 300;
  walkTo(sim, citizen.position);
  sim.command({ type: 'setTime', value: 10 });
  sim.step(.25);
  assert.ok(sim.state.shops.some(shop => shop.buildingId === citizen.destinationId));
  assert.notEqual(citizen.destinationId, citizen.workId);
});

test('sparse family relationships propagate the memory of harming a loved one', () => {
  const { sim } = create();
  const first = sim.state.citizens.find(c => c.partnerId && c.partnerId !== 'player')!;
  const partner = sim.state.citizens.find(c => c.id === first.partnerId)!;
  walkTo(sim, first.position);
  assert.equal(sim.command({ type: 'conflict', targetId: first.id }).ok, true);
  walkTo(sim, partner.position);
  assert.equal(sim.command({ type: 'socialize', targetId: partner.id }).ok, true);
  const relation = sim.state.relationships.find(r => r.npcId === partner.id)!;
  assert.ok(relation.affection <= 0, 'a first friendly exchange must retain the negative family impression');
  assert.ok(relation.trust < 5);
});

test('owned room voxel changes use a 0.2m grid and conserve construction material', () => {
  const { sim, world } = create();
  const home = world.buildings.find(b => b.kind === 'home')!;
  walkTo(sim, home.door);
  const position = { x: home.door.x + .63, y: home.door.y + .1, z: home.door.z };
  assert.equal(sim.command({ type: 'build', targetId: home.id, position }).ok, false);
  assert.equal(sim.command({ type: 'rent', targetId: home.id }).ok, true);
  const before = sim.state.player.inventory.block;
  assert.equal(sim.command({ type: 'build', targetId: home.id, position }).ok, true);
  assert.equal(sim.state.player.inventory.block, before - 1);
  const voxel = sim.state.voxels[0];
  for (const coordinate of Object.values(voxel.position)) assert.ok(Math.abs(coordinate / .2 - Math.round(coordinate / .2)) < 1e-8);
  assert.equal(sim.command({ type: 'build', targetId: home.id, position }).ok, false);
  assert.equal(sim.state.player.inventory.block, before - 1);
  assert.equal(sim.command({ type: 'demolish', targetId: home.id, position: voxel.position }).ok, true);
  assert.equal(sim.state.player.inventory.block, before);
  assert.equal(sim.state.voxels.length, 0);
});

test('traffic lights expose the same signal state used by vehicle rules and permissioned overrides', () => {
  const { sim, world } = create();
  const node = world.nodes[0];
  walkTo(sim, node.position);
  assert.equal(sim.command({ type: 'signal', targetId: node.id, value: 1 }).ok, false);
  sim.state.player.identities = ['traveler', 'police'];
  assert.equal(sim.command({ type: 'signal', targetId: node.id, value: 1 }).ok, true);
  sim.step(1);
  assert.equal(sim.state.signals?.[node.id], 1);
  assert.equal(sim.command({ type: 'signal', targetId: node.id, value: 0 }).ok, true);
  sim.step(.25);
  assert.equal(sim.state.signals?.[node.id], 0);
  assert.equal(sim.command({ type: 'signal', targetId: node.id, value: 2 }).ok, true);
  assert.ok(sim.state.signals?.[node.id] === 0 || sim.state.signals?.[node.id] === 1);
});

test('the complete city survives multiple days and restores a large genuine save deterministically', async () => {
  const { createWorld } = await import('../src/world.ts');
  const world = createWorld(), sim = new Simulation(world);
  sim.command({ type: 'speed', value: 8 });
  for (let i = 0; i < 1200; i++) sim.step(.25);
  assert.ok(sim.state.day >= 2);
  assert.ok(sim.state.citizens.length >= 384);
  assert.ok(sim.state.metrics.trades > 0);
  assert.ok(sim.state.metrics.freight > 0);
  assert.ok(sim.state.metrics.flights > 0);
  const saved = sim.exportSave(), restored = new Simulation(world);
  assert.ok(saved.length < 8_000_000);
  assert.equal(restored.importSave(saved).ok, true);
  for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); }
  assert.deepEqual(restored.state, sim.state);
});

test('manual driving obeys throttle and brake input rather than running an automatic passenger journey', () => {
  const { sim } = create();
  sim.command({ type: 'speed', value: 1 });
  const vehicle = sim.state.vehicles.find(v => v.kind === 'road' && v.direction > 0)!;
  sim.state.player.identities = ['traveler', 'driver'];
  walkTo(sim, vehicle.position);
  assert.equal(sim.command({ type: 'drive', targetId: vehicle.id }).ok, true);
  assert.equal(sim.isDriving(vehicle.id), true);
  const parkedProgress = vehicle.progress;
  sim.step(1);
  assert.equal(vehicle.progress, parkedProgress, 'a driver must press the accelerator before moving');
  sim.driveInput(1, 0, false);
  sim.step(2);
  assert.ok(vehicle.progress > parkedProgress);
  assert.deepEqual(sim.state.player.position, vehicle.position);
  sim.driveInput(0, 0, true);
  sim.step(2);
  const stoppedProgress = vehicle.progress;
  sim.step(1);
  assert.equal(vehicle.progress, stoppedProgress);
  assert.equal(vehicle.state, 'parked');
  const restored = new Simulation(fixture());
  assert.equal(restored.importSave(sim.exportSave()).ok, true);
  assert.equal(restored.isDriving(vehicle.id), true);
  sim.driveInput(1, 0, false); restored.driveInput(1, 0, false);
  for (let i = 0; i < 12; i++) { sim.step(.25); restored.step(.25); }
  assert.deepEqual(restored.state, sim.state);
});

test('manual intersection steering selects a real left or right branch of the road graph', () => {
  const world = fixture(), junction = world.nodes[1];
  world.nodes.push({ id: 'turn-left', districtId: 'district-0', name: '左转站', station: true, position: { x: 200, y: 0, z: -180 } }, { id: 'turn-right', districtId: 'district-0', name: '右转站', station: true, position: { x: 200, y: 0, z: 220 } });
  for (const suffix of ['left', 'right']) { const end = world.nodes.find(n => n.id === `turn-${suffix}`)!; world.edges.push({ id: `road-${suffix}`, from: junction.id, to: end.id, mode: 'road', length: 200, capacity: 20, points: [junction.position, end.position] }); }
  const sim = new Simulation(world);
  sim.state.player.identities = ['traveler', 'driver', 'police'];
  const vehicle = sim.state.vehicles.find(v => v.edgeId === 'road' && v.direction > 0)!;
  walkTo(sim, vehicle.position);
  assert.equal(sim.command({ type: 'drive', targetId: vehicle.id }).ok, true);
  walkTo(sim, junction.position); // A boarded player remains at the physical vehicle.
  sim.state.player.position = { ...junction.position };
  assert.equal(sim.command({ type: 'signal', targetId: junction.id, value: 1 }).ok, true);
  sim.state.player.position = { ...vehicle.position };
  sim.driveInput(1, -1, false);
  advanceUntil(sim, () => vehicle.edgeId !== 'road', 160);
  assert.equal(vehicle.edgeId, 'road-left');
});

test('large civic interiors and basement rooms retain local interactions while restricted floors require permission', () => {
  const world = fixture();
  const core = world.buildings.find(b => b.kind === 'core')!;
  core.width = 144; core.depth = 112; core.height = 234; core.floors = 30;
  core.basements = 2; core.publicFloors = 3; core.requiredPermission = 'mayor'; core.facility = 'mayor';
  const sim = new Simulation(world);
  const office = { x: core.position.x, y: core.position.y + 5 * core.height / core.floors + .6, z: core.position.z };
  walkTo(sim, office);
  assert.ok(distance(sim.state.player.position, core.door) > 32);
  assert.ok(sim.isNearBuilding(core));
  assert.equal(sim.command({ type: 'policy', targetId: core.id, taxRate: .1 }).ok, false);
  sim.state.player.identities = ['traveler', 'mayor'];
  assert.equal(sim.command({ type: 'policy', targetId: core.id, taxRate: .1 }).ok, true);
  assert.equal(sim.command({ type: 'work', targetId: core.id }).ok, true);
  walkTo(sim, { x: core.position.x, y: core.position.y - core.height / core.floors + .6, z: core.position.z });
  assert.ok(sim.isNearBuilding(core));
  assert.equal(sim.command({ type: 'policy', targetId: core.id, taxRate: .12 }).ok, true);
  walkTo(sim, { x: core.position.x + 180, y: office.y, z: core.position.z });
  assert.equal(sim.command({ type: 'policy', targetId: core.id, taxRate: .13 }).ok, false);
});

test('energy and data wings advertise their actual functions without granting public visitors staff powers', () => {
  const world = fixture();
  const wing = world.buildings.find(b => b.kind === 'workshop')!;
  wing.facility = 'energy'; wing.publicFloors = 1; wing.requiredPermission = 'driver';
  const sim = new Simulation(world);
  walkTo(sim, wing.door);
  assert.equal(sim.command({ type: 'work', targetId: wing.id }).ok, false);
  assert.equal(sim.command({ type: 'energy', targetId: wing.id }).ok, false);
  sim.state.player.identities = ['traveler', 'scientist'];
  assert.equal(sim.command({ type: 'energy', targetId: wing.id }).ok, true);
  assert.equal(sim.command({ type: 'work', targetId: wing.id }).ok, true);
});

test('a funded police response cannot close a distant case until a real dispatched officer arrives', () => {
  const { sim, world } = create();
  const crime = { id: 'physical-response', districtId: world.districts[0].id, position: { x: 330, y: 0, z: 20 }, severity: 1, status: 'open' as 'open' | 'responding' | 'resolved', responseAt: 0 };
  sim.state.crimes.push(crime);
  walkTo(sim, world.spawn);
  sim.step(.25);
  assert.equal(crime.status, 'responding');
  const officer = sim.state.citizens.find(c => c.state === 'responding' && c.route?.some(p => distance(p, crime.position) < .01))!;
  assert.ok(officer, 'dispatch must assign an actual police citizen and a path to the crime');
  // Even a mistaken or externally changed early prediction must not complete a
  // case while its assigned citizen remains on the actual route.
  crime.responseAt = sim.state.day * 1440 + sim.state.hour * 60 + 2;
  advanceUntil(sim, () => sim.state.day * 1440 + sim.state.hour * 60 > crime.responseAt);
  assert.equal(crime.status, 'responding', 'an elapsed ETA must not replace physical arrival');
  assert.ok(distance(officer.position, crime.position) > 3);
  advanceUntil(sim, () => crime.status === 'resolved');
  assert.ok(distance(officer.position, crime.position) <= 3);
});

test('mutual romance advances once to shared residence and divorce leaves lasting memories', () => {
  const { sim, world } = create();
  const citizen = sim.state.citizens.find(c => !c.partnerId)!;
  const home = world.buildings.find(b => b.kind === 'home')!;
  walkTo(sim, home.door);
  assert.equal(sim.command({ type: 'rent', targetId: home.id }).ok, true);
  const relation: Relationship = { npcId: citizen.id, affection: 70, trust: 60, type: 'closeFriend', encounters: 8, memories: [], tags: [] };
  sim.state.relationships.push(relation);
  walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'court', targetId: citizen.id }).ok, true);
  assert.equal(relation.romanceStage, 'pursuit');
  assert.equal(sim.state.player.partnerId, null);
  const afterCourt = clone(sim.state);
  assert.equal(sim.command({ type: 'court', targetId: citizen.id }).ok, false, 'the same declaration must not repeatedly grant affection');
  assert.deepEqual(sim.state, afterCourt);
  sim.step(7.5);
  walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'court', targetId: citizen.id }).ok, true);
  assert.equal(relation.romanceStage, 'dating');
  assert.equal(relation.type, 'lover');
  assert.equal(sim.command({ type: 'propose', targetId: citizen.id }).ok, false);
  sim.step(15);
  walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'propose', targetId: citizen.id }).ok, true);
  assert.equal(relation.romanceStage, 'engaged');
  assert.equal(relation.type, 'lover');
  assert.equal(sim.command({ type: 'propose', targetId: citizen.id }).ok, false);
  sim.step(15);
  walkTo(sim, citizen.position);
  const moneyBefore = sim.state.player.money + citizen.money;
  assert.equal(sim.command({ type: 'propose', targetId: citizen.id }).ok, true);
  assert.equal(relation.type, 'spouse');
  assert.equal(citizen.homeId, sim.state.player.homeId);
  assert.equal(citizen.partnerId, 'player');
  assert.equal(relation.romanceStage, 'married');
  assert.ok(Math.abs(sim.state.player.money + citizen.money - moneyBefore) < 1e-8, 'shared household funds are transferred, not created');
  sim.step(30);
  walkTo(sim, citizen.position);
  assert.equal(relation.romanceStage, 'family');
  assert.equal(sim.command({ type: 'divorce', targetId: citizen.id }).ok, true);
  assert.equal(sim.state.player.partnerId, null);
  assert.equal(citizen.partnerId, null);
  assert.notEqual(relation.type, 'spouse');
  assert.ok(relation.memories.some(memory => memory.text.includes('解除婚姻')));
});

test('stepped civic floors reject interactions in empty air outside the actual level footprint', () => {
  const world = fixture(), core = world.buildings.find(b => b.kind === 'core')!;
  core.width = 144; core.depth = 112; core.height = 234; core.floors = 30;
  core.floorFootprints = Array.from({ length: 30 }, (_, floor) => ({ width: floor < 10 ? 144 : floor < 20 ? 108 : 72, depth: floor < 10 ? 112 : floor < 20 ? 84 : 56 }));
  const sim = new Simulation(world); sim.state.player.identities = ['traveler', 'mayor'];
  const y = core.position.y + 25 * core.height / core.floors + .6;
  walkTo(sim, { x: core.position.x + 60, y, z: core.position.z });
  assert.equal(sim.isNearBuilding(core), false);
  assert.equal(sim.command({ type: 'policy', targetId: core.id }).ok, false);
  walkTo(sim, { x: core.position.x + 30, y, z: core.position.z });
  assert.equal(sim.isNearBuilding(core), true);
  assert.equal(sim.command({ type: 'policy', targetId: core.id }).ok, true);
});

test('a high affinity single citizen develops an autonomous crush without forcing mutual commitment', () => {
  const { sim } = create(), citizen = sim.state.citizens.find(c => !c.partnerId)!;
  sim.state.relationships.push({ npcId: citizen.id, affection: 68, trust: 58, type: 'closeFriend', encounters: 8, memories: [], tags: [] });
  walkTo(sim, citizen.position); sim.step(.25);
  const relationship = sim.state.relationships[0];
  assert.equal(relationship.romanceStage, 'crush');
  assert.equal(sim.state.player.partnerId, null);
  assert.equal(citizen.partnerId, null);
  assert.ok(relationship.tags.includes('心生爱慕'));
});

test('pausing and changing the displayed hour cannot bypass pursuit and engagement elapsed time', () => {
  const { sim } = create(), citizen = sim.state.citizens.find(c => !c.partnerId)!;
  const relationship: Relationship = { npcId: citizen.id, affection: 85, trust: 80, type: 'closeFriend', encounters: 10, memories: [], tags: [] };
  sim.state.relationships.push(relationship); walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'court', targetId: citizen.id }).ok, true);
  assert.equal(relationship.romanceStage, 'pursuit');
  sim.command({ type: 'pause', value: 1 }); sim.step(20);
  sim.command({ type: 'setTime', value: 18 });
  assert.equal(sim.command({ type: 'court', targetId: citizen.id }).ok, false);
  sim.command({ type: 'pause', value: 0 }); sim.step(7.25); walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'court', targetId: citizen.id }).ok, false);
  sim.step(.25); walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'court', targetId: citizen.id }).ok, true);
  assert.equal(relationship.romanceStage, 'dating');
  const saved = sim.exportSave(), restored = new Simulation(fixture());
  assert.equal(restored.importSave(saved).ok, true);
  assert.equal(restored.state.relationships[0].romanceStage, 'dating');
});

test('repeated real conflicts progress through all hostile stages and repairing severe harm requires time and restitution', () => {
  const { sim } = create(), citizen = sim.state.citizens.find(c => !c.partnerId)!;
  const expected = ['discontent', 'rivalry', 'feud', 'enemy', 'mortalEnemy'];
  for (const stage of expected) {
    walkTo(sim, citizen.position);
    assert.equal(sim.command({ type: 'conflict', targetId: citizen.id }).ok, true);
    assert.equal(sim.state.relationships[0].hostilityStage, stage);
    const after = clone(sim.state);
    assert.equal(sim.command({ type: 'conflict', targetId: citizen.id }).ok, false);
    assert.deepEqual(sim.state, after);
    sim.step(2.5);
  }
  const relationship = sim.state.relationships[0];
  walkTo(sim, citizen.position);
  assert.equal(sim.command({ type: 'socialize', targetId: citizen.id }).ok, false);
  assert.equal(sim.command({ type: 'reconcile', targetId: citizen.id }).ok, false);
  sim.step(12.5); walkTo(sim, citizen.position);
  const combined = sim.state.player.money + citizen.money;
  assert.equal(sim.command({ type: 'reconcile', targetId: citizen.id }).ok, true);
  assert.ok(Math.abs(sim.state.player.money + citizen.money - combined) < 1e-8);
  assert.equal(relationship.hostilityStage, 'mortalEnemy', 'a payment must not erase irreconcilable conflict');
  assert.equal(sim.command({ type: 'reconcile', targetId: citizen.id }).ok, false);
  const restored = new Simulation(fixture());
  assert.equal(restored.importSave(sim.exportSave()).ok, true);
  assert.equal(restored.state.relationships[0].hostilityStage, 'mortalEnemy');
  assert.equal(restored.command({ type: 'reconcile', targetId: citizen.id }).ok, false);
});

test('new relationship metadata rejects forged future timers and unknown stages atomically', () => {
  const { sim } = create(), citizen = sim.state.citizens[0]; walkTo(sim, citizen.position); sim.command({ type: 'socialize', targetId: citizen.id });
  const valid = JSON.parse(sim.exportSave());
  for (const mutate of [
    (data: any) => { data.state.relationships[0].romanceStage = 'forcedMarriage'; },
    (data: any) => { data.state.relationships[0].romanceSince = data.runtime.relationshipClock + 1; },
    (data: any) => { data.state.relationships[0].conflicts = -1; },
    (data: any) => { data.runtime.hostileAt['foreign-npc'] = 12; },
  ]) { const corrupted = clone(valid), before = clone(sim.state); mutate(corrupted); assert.equal(sim.importSave(JSON.stringify(corrupted)).ok, false); assert.deepEqual(sim.state, before); }
});

test('citizens use the shared narrow stair core and occupy rooms inside the selected upper floor', () => {
  const world = fixture(), core = world.buildings.find(b => b.kind === 'core')!;
  core.width = 144; core.depth = 112; core.height = 234; core.floors = 30;
  core.floorFootprints = Array.from({ length: 30 }, (_, floor) => ({ width: floor < 10 ? 144 : floor < 20 ? 108 : 72, depth: floor < 10 ? 112 : floor < 20 ? 84 : 56 }));
  const sim = new Simulation(world);
  sim.setFocus(core.position, 'drone');
  for (const citizen of sim.state.citizens) citizen.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  sim.command({ type: 'setTime', value: 10 }); sim.step(.25);
  const worker = sim.state.citizens.find(c => c.destinationId === core.id && c.route && c.route.at(-1)!.y > core.position.y + 20 * core.height / core.floors)!;
  assert.ok(worker, 'a persistent worker must actually choose a room on an upper floor');
  const room = worker.route!.at(-1)!, floor = Math.floor((room.y - core.position.y) / (core.height / core.floors));
  assert.ok(sim.isNearBuilding(core, room, 0));
  const stairX = core.position.x - 72 * .32, stairZ = core.position.z - 56 * .25;
  assert.ok(worker.route!.some(point => Math.abs(point.x - stairX) < 1e-8 && Math.abs(point.z - stairZ) < 1e-8 && point.y === core.position.y + .6));
  assert.ok(worker.route!.some(point => Math.abs(point.x - stairX) < 1e-8 && Math.abs(point.z - stairZ) < 1e-8 && Math.abs(point.y - (core.position.y + .6 + floor * core.height / core.floors)) < 1e-8));
});

test('student cohorts are distributed across every district and have a real school address', async () => {
  const { createWorld } = await import('../src/world.ts'); const world = createWorld(), sim = new Simulation(world);
  const counts = world.districts.map(d => sim.state.citizens.filter(c => c.districtId === d.id && c.role === '学生').length);
  assert.ok(counts.every(count => count > 0));
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'student selection must not alias the district cycle');
  const schools = new Set(world.buildings.filter(b => b.kind === 'school').map(b => b.id));
  assert.ok(sim.state.citizens.filter(c => c.role === '学生').every(c => schools.has(c.workId)));
});


test('the default clock and physical movement remain consistent across all simulation tiers', () => {
  const snapshots = [0, 800, 5000].map(focusX => {
    const sim = new Simulation(fixture()), citizen = sim.state.citizens[0];
    const runtime = Reflect.get(sim, 'runtime');
    sim.setFocus({ x: focusX, y: 0, z: 0 }, 'drone');
    citizen.position = { x: 0, y: 0, z: 0 }; citizen.destinationId = citizen.workId;
    citizen.route = [{ x: 0, y: 0, z: 0 }, { x: 600, y: 0, z: 0 }]; citizen.routeIndex = 1;
    citizen.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
    runtime.decisionAt[citizen.id] = 10000; runtime.activities[citizen.id] = 'study';
    sim.step(4);
    assert.ok(Math.abs(sim.state.hour - (8 + 4 / 60)) < 1e-8, 'four real seconds must advance four game minutes at 1×');
    return { tier: citizen.tier, position: citizen.position.x, energy: sim.state.districts[0].energy };
  });
  assert.deepEqual(snapshots.map(s => s.tier), ['active', 'regional', 'statistical']);
  for (const result of snapshots) assert.ok(Math.abs(result.position - 16.8) < 1e-8, `${result.tier} must travel the same 16.8 metres in four seconds`);
  assert.equal(snapshots[0].energy, snapshots[2].energy, 'observing a district cannot create power');
});

test('actual private wages are expensed once and initial staff counts refer to real non-student workers', () => {
  const { sim } = create(), shop = sim.state.shops[0];
  for (const item of sim.state.shops) assert.equal(item.employees, sim.state.citizens.filter(c => c.workId === item.buildingId && c.role !== '学生').length);
  const worker = sim.state.citizens.find(c => c.workId === shop.buildingId && c.role !== '学生')!;
  assert.ok(worker);
  const moneyBefore = worker.money, profitBefore = shop.profit;
  const runtime = Reflect.get(sim, 'runtime'), fundsBefore = sim.shopFunds(shop);
  let facilitiesPaid = 0; sim.onEvent('business-expense', event => { if (event.shopId === shop.id) facilitiesPaid += event.amount ?? 0; });
  sim.emitEvent({ type: 'wage', citizenId: worker.id, districtId: worker.districtId, amount: 32 });
  sim.step(.25);
  assert.ok(Math.abs(worker.money - moneyBefore - 32 * (1 - sim.state.taxRate)) < 1e-8);
  assert.ok(Math.abs(shop.profit - profitBefore + 32 + facilitiesPaid) < 1e-8, 'only the real salary and actual occupied facilities expense should reduce profit');
  assert.ok(Math.abs(sim.shopFunds(shop) - fundsBefore + 32 + facilitiesPaid) < 1e-8, 'private payroll and premises expense must come from its real operating account');
  assert.equal(runtime.wages.length, 0, 'settled salary cannot remain queued for a second payment');
});

test('public laboratory staff use the city budget and public wings cannot be bought as retail shops', () => {
  const world = fixture(), wing = world.buildings.find(b => b.kind === 'workshop')!;
  wing.facility = 'data'; wing.requiredPermission = 'scientist'; wing.publicFloors = 1;
  const sim = new Simulation(world);
  assert.equal(sim.state.shops.some(shop => shop.buildingId === wing.id), false);
  const worker = sim.state.citizens.find(c => c.workId === wing.id && c.role !== '学生')!;
  assert.ok(worker); assert.equal(worker.role, '科研员');
  const moneyBefore = worker.money, treasuryBefore = sim.state.treasury;
  let operationNet = 0; sim.onEvent('public-procurement', event => { operationNet += (event.amount ?? 0) * (1 - sim.state.taxRate); });
  sim.emitEvent({ type: 'wage', citizenId: worker.id, districtId: worker.districtId, amount: 40 });
  sim.step(.25);
  assert.ok(Math.abs(worker.money - moneyBefore - 40 * .92) < 1e-8);
  assert.ok(Math.abs(sim.state.treasury - treasuryBefore + 40 * .92 + operationNet) < 1e-8, 'city wages, their actual tax and supplied public operations must settle the public account');
  walkTo(sim, wing.door); sim.state.player.identities = ['traveler', 'merchant', 'scientist'];
  const cash = sim.state.player.money;
  assert.equal(sim.command({ type: 'purchase', targetId: wing.id }).ok, false);
  assert.equal(sim.command({ type: 'business', targetId: wing.id }).ok, false);
  assert.equal(sim.state.player.money, cash);
  const treasury = sim.state.treasury;
  assert.equal(sim.command({ type: 'work', targetId: wing.id }).ok, true);
  assert.equal(sim.state.treasury, treasury - 62, 'public payroll reserves the full shift from the same real employer source');
  assert.equal(sim.state.playerLabor!.job!.escrow, 62); assert.equal(sim.state.player.money, cash, 'unperformed public work does not pay immediately');
  assert.equal(sim.command({ type: 'cancelWork' }).ok, true); assert.equal(sim.state.treasury, treasury);
  sim.state.treasury = 0; sim.command({ type: 'setTime', value: 12 });
  const unpaid = sim.state.player.money;
  assert.equal(sim.command({ type: 'work', targetId: wing.id }).ok, false);
  assert.equal(sim.state.player.money, unpaid, 'a bankrupt employer must not create salary from nowhere');
});

test('Chinese and earned English scientific identities grant the same actual laboratory floor access', () => {
  const world = fixture(), lab = world.buildings.find(b => b.kind === 'workshop')!;
  lab.facility = 'data'; lab.requiredPermission = 'scientist'; lab.publicFloors = 1; lab.floors = 4; lab.height = 24;
  const sim = new Simulation(world);
  const scientist = sim.state.citizens.find(c => c.workId === lab.id && c.role !== '学生')!;
  const runtime = Reflect.get(sim, 'runtime'); runtime.activities[scientist.id] = 'work';
  Reflect.get(sim, 'setDestination').call(sim, scientist, lab);
  const chineseRoom = { ...scientist.route!.at(-1)! };
  scientist.role = 'scientist'; scientist.destinationId = null;
  Reflect.get(sim, 'setDestination').call(sim, scientist, lab);
  assert.deepEqual(scientist.route!.at(-1), chineseRoom);
});

test('ordinary initial jobs belong to each citizen residential district whenever it provides employment', async () => {
  const { createWorld } = await import('../src/world.ts'); const world = createWorld(), sim = new Simulation(world);
  const districtsWithJobs = new Set(world.buildings.filter(b => ['market', 'workshop', 'farm', 'bank', 'hall', 'police', 'school', 'clinic', 'station', 'airport', 'starport', 'dock', 'core'].includes(b.kind)).map(b => b.districtId));
  const adults = sim.state.citizens.filter(c => c.role !== '学生' && districtsWithJobs.has(c.districtId));
  assert.ok(adults.length > 500);
  assert.ok(adults.every(c => world.buildings.find(b => b.id === c.workId)!.districtId === c.districtId));
});


test('public transport fares conserve the actual payer and city balances, including flight tickets', () => {
  const sim = new Simulation(fixture());
  for (const kind of ['road', 'flight'] as const) {
    const vehicle = sim.state.vehicles.find(v => v.kind === kind)!;
    walkTo(sim, vehicle.position); const cash = sim.state.player.money, funds = sim.state.treasury, gdp = sim.state.gdp;
    assert.equal(sim.command({ type: 'ride', targetId: vehicle.id }).ok, true);
    const fare = kind === 'flight' ? 45 : 4;
    assert.equal(sim.state.player.money, cash - fare); assert.equal(sim.state.treasury, funds + fare);
    assert.equal(sim.state.player.money + sim.state.treasury, cash + funds);
    assert.equal(sim.state.gdp, gdp + fare, 'an actual paid transport service contributes its fare once');
    assert.equal(sim.command({ type: 'leaveVehicle' }).ok, true);
  }
  const vehicle = sim.state.vehicles.find(v => v.kind === 'road')!; walkTo(sim, vehicle.position); sim.state.player.money = 3;
  const before = sim.exportSave(); assert.equal(sim.command({ type: 'ride', targetId: vehicle.id }).ok, false);
  assert.equal(sim.exportSave(), before, 'an unaffordable ticket cannot change the vehicle, balances or timeline');
});

test('citizens pay a real fare before boarding and keep walking when they cannot afford it', () => {
  for (const cash of [5, 3]) {
    const sim = new Simulation(fixture()), citizen = sim.state.citizens[0], vehicle = sim.state.vehicles.find(v => v.kind === 'road' && v.direction === 1)!;
    const dock = sim.worldDefinition.buildings.find(b => b.kind === 'dock' && b.districtId === citizen.districtId)!;
    const runtime = Reflect.get(sim, 'runtime'); vehicle.nextDeparture = 481; // a real imminent boarding window
    citizen.position = { ...vehicle.position }; citizen.role = '工人'; citizen.workId = dock.id; citizen.destinationId = dock.id;
    citizen.money = cash; citizen.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
    citizen.route = [{ ...citizen.position }, { ...dock.door }]; citizen.routeIndex = 1;
    sim.state.shops.find(shop => shop.buildingId === dock.id)!.employees++;
    runtime.activities[citizen.id] = 'work'; runtime.decisionAt[citizen.id] = 10000;
    let paid = 0, ownFare = 0, operationNet = 0; sim.onEvent('transit-fare', e => { paid += e.amount ?? 0; if (e.citizenId === citizen.id) ownFare += e.amount ?? 0; });
    sim.onEvent('public-procurement', event => { operationNet += (event.amount ?? 0) * (1 - sim.state.taxRate); });
    const funds = sim.state.treasury; sim.setFocus(citizen.position, 'drone'); sim.step(.25);
    if (cash >= 4) { assert.equal(citizen.state, 'riding'); assert.equal(citizen.money, 1); assert.equal(ownFare, 4); }
    else { assert.notEqual(citizen.state, 'riding'); assert.equal(citizen.money, 3); assert.equal(ownFare, 0); }
    assert.ok(Math.abs(sim.state.treasury - funds - paid + operationNet) < 1e-8, 'actual tickets fund transit and actual supplied operations settle the public account');
  }
});

test('an exhausted or critically sick dispatched officer leaves the task and must actually recover before reassignment', () => {
  const sim = new Simulation(fixture()), officer = sim.state.citizens.find(c => c.role === '警察' && c.districtId === 'district-0')!;
  for (const citizen of sim.state.citizens.filter(c => c.role === '警察')) citizen.needs = { hunger: 0, fatigue: 0, social: 80, fun: 80 };
  officer.needs = { hunger: 80, fatigue: 80, social: 80, fun: 80 };
  sim.state.extension!.actorProfiles[officer.id].health = 90;
  sim.setFocus(officer.position, 'drone');
  const crime = { id: 'crime-1', districtId: officer.districtId, position: { x: 1100, y: 0, z: 100 }, severity: 1, status: 'open' as const, responseAt: 0 };
  sim.state.crimes.push(crime); Reflect.get(sim, 'runtime').crimeId = 1; sim.step(.25);
  assert.equal(crime.status, 'responding');
  const runtime = Reflect.get(sim, 'runtime'); assert.ok(runtime.dispatches[officer.id]);
  const route = officer.route!, index = officer.routeIndex!; let metres = 0;
  for (let i = index; i < route.length; i++) metres += distance(i === index ? officer.position : route[i - 1], route[i]);
  assert.ok(Math.abs(crime.responseAt - (sim.state.day * 1440 + sim.state.hour * 60) - 10 - metres / 4.2) < 1e-8, 'the response prediction must use the real assigned walking route');
  officer.needs.hunger = 10; officer.needs.fatigue = 10; sim.state.extension!.actorProfiles[officer.id].health = 32;
  const position = { ...officer.position }, money = officer.money;
  const attendance = runtime.attendance[officer.id] ?? 0;
  sim.step(.25);
  assert.equal(crime.status, 'open'); assert.equal(runtime.dispatches[officer.id], undefined);
  assert.equal(runtime.activities[officer.id], 'eat', 'a crisis should start a reachable food trip rather than immediately redispatch the officer');
  assert.ok(officer.needs.hunger <= 10 && officer.needs.fatigue <= 10, 'leaving a duty must not provide food or rest from nowhere');
  assert.equal(officer.money, money); assert.ok(distance(position, officer.position) <= 1.06, 'recovery cannot teleport to a clinic');
  assert.equal(runtime.attendance[officer.id] ?? 0, attendance, 'the tick that leaves duty to recover cannot add police attendance');
});

test('urgent citizens commit to one reachable food trip through repeated decision windows and buy actual stock', () => {
  const { sim } = create(), citizen = sim.state.citizens[0];
  citizen.needs = { hunger: 0, fatigue: 45, social: 100, fun: 100 }; citizen.money = 200;
  walkTo(sim, citizen.position); sim.command({ type: 'setTime', value: 8 });
  const runtime = Reflect.get(sim, 'runtime'); sim.step(.25);
  assert.equal(runtime.activities[citizen.id], 'eat'); const target = citizen.destinationId;
  assert.ok(target); const shop = sim.state.shops.find(s => s.buildingId === target)!;
  let arrived = false;
  sim.onEvent('sale', () => { if (citizen.needs.hunger > 30) arrived = true; });
  for (let tick = 0; tick < 250 && !arrived; tick++) { sim.step(.25); if (citizen.needs.hunger < 30) assert.equal(citizen.destinationId, target, 'a scan must not keep replacing the unfinished meal route'); }
  assert.ok(arrived); assert.ok(citizen.needs.hunger > 30); assert.ok(shop.revenue > 0); assert.ok(citizen.money < 200);
});


test('manual control leaves automatic departure waiting while a passenger cannot drive an early departure', () => {
  for (const command of ['drive', 'ride'] as const) {
    const sim = new Simulation(fixture()), vehicle = sim.state.vehicles.find(v => v.kind === 'road' && v.direction === 1)!;
    vehicle.nextDeparture = 8 * 60 + 75;
    sim.state.player.identities = ['traveler', 'driver']; walkTo(sim, vehicle.position);
    const start = { ...vehicle.position }; assert.equal(sim.command({ type: command, targetId: vehicle.id }).ok, true);
    sim.driveInput(1, 0, false); sim.step(2);
    if (command === 'drive') { assert.equal(sim.isDriving(vehicle.id), true); assert.ok(distance(start, vehicle.position) > 3, 'a real accelerator must move the controlled vehicle before the old public departure'); }
    else { assert.equal(sim.isDriving(vehicle.id), false); assert.equal(distance(start, vehicle.position), 0); assert.equal(vehicle.state, 'waiting'); assert.equal(vehicle.nextDeparture, 8 * 60 + 75); }
  }
});


test('arriving passengers keep a still feasible meal destination and replan only when its food service is unavailable', () => {
  for (const available of [true, false]) {
    const sim = new Simulation(fixture()), citizen = sim.state.citizens[0], vehicle = sim.state.vehicles.find(v => v.kind === 'road' && v.direction === 1)!;
    const market = sim.state.shops.find(shop => sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)?.kind === 'market' && shop.districtId === citizen.districtId)!;
    const edge = sim.worldDefinition.edges.find(e => e.id === vehicle.edgeId)!, stop = sim.worldDefinition.nodes.find(n => n.id === edge.to)!;
    const runtime = Reflect.get(sim, 'runtime');
    vehicle.progress = .9999; vehicle.position = { x: 199.98, y: 0, z: 20 }; vehicle.nextDeparture = 0; vehicle.passengers = 1;
    citizen.position = { ...vehicle.position }; citizen.state = 'riding'; citizen.destinationId = market.buildingId;
    citizen.needs = { hunger: 10, fatigue: 100, social: 100, fun: 100 }; citizen.money = 100;
    market.open = available; if (!available) {
      market.inventory = 0; market.profit = -700;
      delete sim.state.trade!.ownedLots![market.id];
      const owner = sim.state.citizens.find(c => c.id === sim.shopOwnerId(market))!;
      owner.money += sim.shopFunds(market); sim.transferShopFunds(market, -sim.shopFunds(market));
    }
    runtime.riders[citizen.id] = { vehicleId: vehicle.id, stopNodeId: stop.id };
    runtime.activities[citizen.id] = 'eat'; runtime.decisionAt[citizen.id] = 0;
    sim.setFocus(vehicle.position, 'drone'); sim.step(.25);
    assert.ok(distance(vehicle.position, stop.position) < 2, 'the actual vehicle must reach its lawful stop');
    if (available) { assert.equal(citizen.destinationId, market.buildingId); assert.equal(runtime.activities[citizen.id], 'eat'); assert.ok(citizen.route!.some(point => distance(point, stop.position) < .01)); }
    else assert.notEqual(citizen.destinationId, market.buildingId, 'a closed empty shop should release the meal commitment');
  }
});


test('a real police response records duty attendance and transfers its earned payroll from the public employer', () => {
  const sim = new Simulation(fixture()), officer = sim.state.citizens.find(c => c.role === '警察' && c.districtId === 'district-0')!;
  for (const other of sim.state.citizens.filter(c => c.role === '警察')) other.needs.hunger = 0;
  officer.needs = { hunger: 95, fatigue: 95, social: 90, fun: 90 };
  sim.state.extension!.actorProfiles[officer.id].health = 90;
  Reflect.get(sim.state.extension!, 'runtime').nextCompanyAt = 1e9; // isolate payroll from hourly entrepreneurial opportunities
  sim.setFocus(officer.position, 'drone'); sim.command({ type: 'setTime', value: 16 });
  const crime = { id: 'crime-1', districtId: officer.districtId, position: { x: 1100, y: 0, z: 100 }, severity: 1, status: 'open' as 'open' | 'responding' | 'resolved', responseAt: 0 };
  sim.state.crimes.push(crime); const runtime = Reflect.get(sim, 'runtime') as { crimeId: number; dispatches: Record<string, unknown>; wages: { citizenId: string; amount: number }[]; taxes: number; operatingCost: number; attendance: Record<string, number> }; runtime.crimeId = 1;
  sim.step(.25); assert.ok(runtime.dispatches[officer.id]);
  let payment = 0, earned = 0, attended = 0, cashBefore = 0, treasuryBefore = 0, expectedPublicCost = 0, taxes = 0, operations = 0, payrollObserved = false;
  sim.onEvent('wage-earned', event => { if (event.citizenId === officer.id) { earned += event.amount ?? 0; attended += event.minutes ?? 0; assert.ok(Math.abs((event.amount ?? 0) - (event.minutes ?? 0) * (event.ratePerMinute ?? 0)) < 1e-8); } });
  sim.onEvent('wage', event => { if (event.citizenId === officer.id) payment += event.amount ?? 0; });
  sim.onPhase('commerce', state => {
    if (!runtime.wages.some(wage => wage.citizenId === officer.id)) return;
    cashBefore = officer.money; treasuryBefore = state.treasury; taxes = runtime.taxes; operations = 0; expectedPublicCost = 0; payrollObserved = true;
  });
  sim.onEvent('public-procurement', event => { if (payrollObserved) { operations += event.amount ?? 0; taxes += (event.amount ?? 0) * sim.state.taxRate; } });
  sim.onEvent('wage-paid', event => { if (payrollObserved) { if (!event.shopId) expectedPublicCost += event.amount ?? 0; taxes += (event.amount ?? 0) * sim.state.taxRate; } });
  sim.onPhase('finance', state => {
    if (!payment) return;
    assert.ok(Math.abs(officer.money - cashBefore - payment * (1 - state.taxRate)) < 1e-8);
    assert.ok(Math.abs(state.treasury - treasuryBefore + expectedPublicCost - taxes + operations) < 1e-7, 'public duty pay and its actual tax must reconcile with treasury, rather than appearing for free');
  });
  advanceUntil(sim, () => payment > 0, 300);
  assert.equal(officer.state, 'responding', 'the officer must still be doing the actual long response, not an idle workplace fixture');
  assert.ok(Math.abs(attended - 59.75) < 1e-8, 'response credits only its actual attended fraction');
  assert.ok(Math.abs(payment - earned) < 1e-8, 'payroll settles the wage earned at the immutable contract rate');
  assert.equal(runtime.attendance[officer.id], undefined, 'settled attendance resets at payroll');
});


test('routine overnight business closing preserves the district prosperity of a functioning city', () => {
  const { sim } = create(); sim.command({ type: 'setTime', value: 22 });
  const prosperity = sim.state.districts.map(d => d.prosperity);
  sim.step(60); // eight game hours at the explicitly selected 8× observation speed
  assert.ok(sim.state.hour >= 5.99 && sim.state.hour <= 6.01);
  for (let i = 0; i < prosperity.length; i++) assert.ok(Math.abs(sim.state.districts[i].prosperity - prosperity[i]) < .02, 'an ordinary night must not be reported as a sequence of bankruptcies');
});

test('equal proportions of idle viable shops have equal commercial feedback regardless of building count', () => {
  const one = fixture(), two = fixture();
  for (const building of [...two.buildings].filter(b => ['market', 'workshop', 'farm', 'dock'].includes(b.kind))) two.buildings.push({ ...building, id: `${building.id}-second`, position: { ...building.position, z: 100 }, door: { ...building.door, z: 105 } });
  const small = new Simulation(one), large = new Simulation(two);
  for (const sim of [small, large]) { sim.command({ type: 'setTime', value: 12 }); Reflect.get(sim, 'commerce').call(sim); }
  assert.equal(large.state.shops.length, small.state.shops.length * 2);
  for (let i = 0; i < small.state.districts.length; i++) assert.ok(Math.abs(small.state.districts[i].prosperity - large.state.districts[i].prosperity) < 1e-10, 'a district index cannot multiply the same no-customer penalty by its number of buildings');
});

test('real insolvent businesses still close and reduce district prosperity through the normalized feedback', () => {
  const { sim } = create(); sim.command({ type: 'setTime', value: 12 });
  for (const shop of sim.state.shops) {
    shop.profit = -700; shop.inventory = 0;
    delete sim.state.trade!.ownedLots![shop.id];
    const owner = sim.state.citizens.find(c => c.id === sim.shopOwnerId(shop))!;
    owner.money += sim.shopFunds(shop); sim.transferShopFunds(shop, -sim.shopFunds(shop));
  }
  const before = sim.state.districts.map(d => d.prosperity);
  sim.step(12.5); // one hundred game minutes
  assert.ok(sim.state.shops.every(shop => !shop.open));
  for (let i = 0; i < before.length; i++) assert.ok(sim.state.districts[i].prosperity < before[i] - .5, 'actual insolvency must have a visible ongoing economic consequence');
});
