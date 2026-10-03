import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { isRoadOpen, roadExitPermit, roadRevision } from '../src/roads.ts';
import { FLOOR_PLAN_PROFILE, getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import { canAccessFloor } from '../src/access.ts';
import { getWalkHeight } from '../src/world.ts';
import { homeRestPointBlockedByVoxels } from '../src/simulation/home-rest.ts';
import { setupRoadworks, request, until } from './roadworks-fixture.ts';
import type { Citizen, Role, Vec3, WorldDefinition } from '../src/types.ts';

const point = (x: number, z = 0): Vec3 => ({ x, y: .6, z });
const core = (sim: Simulation): any => Reflect.get(sim, 'runtime');
const clock = (sim: Simulation) => sim.state.extension!.lastUpdate;
const separation = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Controlled miniature map, not a generated-city/natural-weather claim.
 * Original fleet, wallets, shops, residents, wages and ten phases are created
 * by Simulation. No cash, wage, stock, permit or closure is fabricated here. */
function roadWorld(detour = true, twoDistricts = false): WorldDefinition {
  const districts = [0, ...(twoDistricts ? [1] : [])].map(i => ({ id: 'road-district-' + i, name: '沿河街区 ' + i, kind: 'market', center: point(60, i * 160), radius: 300, color: '#aaaaaa', population: 384 }));
  const nodes = ['A', 'B', 'C', 'D'].map((id, i) => ({ id, name: id, districtId: districts[twoDistricts && i >= 2 ? 1 : 0].id, position: point(i % 2 * 120, i >= 2 ? 160 : 0), station: true }));
  const at = (id: string) => nodes.find(n => n.id === id)!.position;
  const edges: WorldDefinition['edges'] = [{ id: 'a-river-road', from: 'A', to: 'B', mode: 'road', points: [at('A'), at('B')], length: 120, capacity: 20 }];
  if (detour) for (const [id, from, to] of [['b-upper-road', 'C', 'D'], ['c-west-road', 'A', 'C'], ['d-east-road', 'D', 'B']]) edges.push({ id, from, to, mode: 'road', points: [at(from), at(to)], length: separation(at(from), at(to)), capacity: 20 });
  const buildings: WorldDefinition['buildings'] = [
    ['home-west', 'home', -25, 0, -20], ['home-upper', 'home', -25, 160, -20],
    ['civic-east', 'hall', 145, 0, 140], ['materials-west', 'workshop', -25, 160, -20],
    ['market-upper', 'market', 145, 160, 140], ['clinic-east', 'clinic', 175, 0, 170],
    ['school-upper', 'school', 175, 160, 170], ['pavilion-east', 'pavilion', 205, 0, 200],
  ].map(([id, kind, x, z, doorX], i) => ({ id: String(id), name: String(id), kind: kind as WorldDefinition['buildings'][number]['kind'], districtId: districts[twoDistricts && Number(z) >= 160 ? 1 : 0].id,
    position: { x: Number(x), y: 0, z: Number(z) }, door: point(Number(doorX), Number(z)), width: 10, depth: 10, height: 6, floors: 1, rotation: 0, capacity: 200, seed: i + 1 }));
  return { seed: 1977, size: 1000, voxelSize: .2, buildings, nodes, edges, districts, spawn: point(-20), mountains: [],
    river: [point(60, -10), point(60, 170)], waterfall: { top: { x: 900, y: 100, z: 900 }, bottom: { x: 900, y: 0, z: 900 }, width: 10 } };
}
function nativeFlood(sim: Simulation, district = 0): void {
  // One controlled original weather/probability input. Real emergency spending,
  // source event object, damage, capture and all ten phases still run.
  sim.state.weather = '雨'; sim.state.extension!.environment.stormRisk = 100;
  sim.state.extension!.environment.disasterAt = clock(sim); core(sim).weatherAt = clock(sim) + 10000;
  let call = 0; const original = sim.nextRandom.bind(sim);
  Reflect.set(sim, 'nextRandom', () => call++ === 0 ? 0 : (district + .25) / sim.state.districts.length);
  try { sim.step(.25); } finally { Reflect.set(sim, 'nextRandom', original); }
  assert.equal(sim.state.roadNetwork?.closures.length, 1, 'the real original environment source must close one actual edge');
}
function intent(sim: Simulation, position: Vec3, destinationId = 'civic-east'): Citizen {
  const npc = sim.state.citizens.find(c => c.workId === 'civic-east' && c.role !== '学生' && sim.state.extension!.actorProfiles[c.id].alive && sim.state.extension!.actorProfiles[c.id].age >= 18)!;
  assert(npc, 'select an original living adult employee; do not invent a role/qualification');
  // One declared initial position and existing employment intent, no pin hook.
  npc.position = { ...position }; npc.destinationId = destinationId;
  core(sim).activities[npc.id] = 'work'; core(sim).decisionAt[npc.id] = clock(sim) + 1000;
  Reflect.get(sim, 'setDestination').call(sim, npc, sim.worldDefinition.buildings.find(b => b.id === destinationId)!, true);
  return npc;
}
function clone(sim: Simulation): Simulation {
  const next = new Simulation(sim.worldDefinition), original = sim.exportSave(), result = next.importSave(original);
  assert(result.ok, result.message); assert.equal(next.exportSave(), original, 'immediate original full save is byte exact'); return next;
}

test('a cold old road map retains absent sparse modules and original full-save continuation', () => {
  const sim = new Simulation(roadWorld());
  assert.equal(sim.state.roadNetwork, undefined); assert.equal(core(sim).roadNetworkVersion, undefined);
  assert.equal(sim.state.roadworks, undefined); assert.equal(core(sim).roadworksVersion, undefined);
  const next = clone(sim); for (let i = 0; i < 24; i++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave()); }
});

test('primed graph and active NPC routes use the dry detour after one real source closure', () => {
  const sim = new Simulation(roadWorld()), before = sim.buildingTravelDistance('home-west', 'civic-east');
  assert.equal(before, 160); assert(Reflect.get(sim, 'walkingTrees').size > 0);
  const npc = intent(sim, point(0)); const destination = npc.destinationId, career = npc.workId, role = npc.role;
  assert(npc.route!.some(p => p.x === 120 && p.z === 0));
  nativeFlood(sim); assert.equal(isRoadOpen(sim.state, 'a-river-road'), false);
  assert.equal(roadExitPermit(sim.state, npc.id), null, 'standing at an endpoint is not occupied mid-edge permission');
  assert.equal(sim.buildingTravelDistance('home-west', 'civic-east'), 480, 'primed shortest-path cache excludes the closed short leg');
  assert(npc.route!.some(p => p.z === 160), 'the pre-existing route was rebuilt before ordinary people movement');
  assert.equal(npc.destinationId, destination); assert.equal(npc.workId, career); assert.equal(npc.role, role);
  assert.equal(npc.position.x, 0); assert(npc.position.z > 0 && npc.position.z <= 3.1 * .25 + 1e-7);
});

test('a genuinely captured mid-road NPC follows its original exit and releases before another leg', () => {
  const sim = new Simulation(roadWorld()), npc = intent(sim, point(0));
  // Explicit once-only current-edge occupancy on the already primed real route.
  npc.position = point(40); npc.routeIndex = npc.route!.findIndex(p => p.x === 120 && p.z === 0); assert(npc.routeIndex > 0);
  const originalTarget = npc.destinationId; nativeFlood(sim);
  const permit = roadExitPermit(sim.state, npc.id); assert(permit); assert.equal(permit.exitNodeId, 'B');
  assert(npc.position.x > 40); assert.equal(npc.position.z, 0); assert.equal(npc.destinationId, originalTarget);
  for (let i = 0; i < 150 && npc.position.x < 120; i++) sim.step(.25);
  assert(npc.position.x >= 120, 'ordinary 1x rain walking reaches the captured original endpoint');
  assert.equal(roadExitPermit(sim.state, npc.id), null); assert.equal(npc.destinationId, originalTarget);
  clone(sim);
});

test('an isolated old employment target waits without clearing intent or accruing office work and recovery', () => {
  const sim = new Simulation(roadWorld(false)), npc = intent(sim, point(0)), target = npc.destinationId;
  const accrued = () => core(sim).wageAccruals.filter((a: any) => a.citizenId === npc.id).reduce((n: number, a: any) => n + a.amount, 0);
  const wages = accrued(), fatigue = npc.needs.fatigue, education = npc.education, original = { ...npc.position };
  nativeFlood(sim); for (let i = 0; i < 8; i++) sim.step(.25);
  assert.equal(npc.state, 'roadWaiting'); assert.equal(npc.destinationId, target); assert.deepEqual(npc.position, original);
  assert.equal(accrued(), wages); assert(npc.needs.fatigue < fatigue); assert.equal(npc.education, education);
  assert.equal(sim.isOnDuty(npc.id, npc.workId), false);
});

test('a waiting endpoint vehicle receives no occupancy license or departure into the closed road', () => {
  const sim = new Simulation(roadWorld(false)), vehicle = sim.state.vehicles.find(v => v.edgeId === 'a-river-road' && v.progress === 0)!;
  const original = { edgeId: vehicle.edgeId, direction: vehicle.direction, progress: vehicle.progress, position: { ...vehicle.position }, cargo: vehicle.cargo, passengers: vehicle.passengers };
  nativeFlood(sim); for (let i = 0; i < 8; i++) sim.step(.25);
  assert.equal(roadExitPermit(sim.state, 'vehicle:' + vehicle.id), null); assert.equal(vehicle.state, 'roadClosed');
  for (const key of ['edgeId', 'direction', 'progress', 'cargo', 'passengers'] as const) assert.equal(vehicle[key], original[key]);
  assert.deepEqual(vehicle.position, original.position);
  sim.state.player.position = { ...vehicle.position }; const before = sim.exportSave(), rejected = sim.command({ type: 'ride', targetId: vehicle.id });
  assert.equal(rejected.ok, false); assert.equal(sim.exportSave(), before, 'closed departure refuses before fare or passenger mutation');
});

test('a real mid-road freight carrier exits without reversing, unloading cargo or clearing its original player rider', () => {
  const sim = new Simulation(roadWorld(false)), vehicle = sim.state.vehicles.find(v => v.edgeId === 'a-river-road' && v.progress === .5)!;
  sim.state.player.position = { ...vehicle.position }; const wallet = sim.state.player.money, boarding = sim.command({ type: 'ride', targetId: vehicle.id });
  assert(boarding.ok, boarding.message); assert.equal(sim.state.player.money, wallet - 4);
  const original = { cargo: vehicle.cargo, passengers: vehicle.passengers, direction: vehicle.direction, edgeId: vehicle.edgeId, source: core(sim).cargoSources?.[vehicle.id] };
  assert(original.cargo > 0, 'uses the original trusted generated freight stock, never added cargo'); nativeFlood(sim);
  assert(roadExitPermit(sim.state, 'vehicle:' + vehicle.id));
  for (let i = 0; i < 160 && vehicle.state !== 'roadClosed'; i++) sim.step(.25);
  assert.equal(vehicle.state, 'roadClosed'); assert.equal(vehicle.progress, 0); assert.equal(vehicle.direction, original.direction); assert.equal(vehicle.edgeId, original.edgeId);
  assert.equal(vehicle.cargo, original.cargo); assert.equal(core(sim).cargoSources?.[vehicle.id], original.source);
  assert.equal(vehicle.passengers, original.passengers); assert.equal(sim.state.player.vehicleId, vehicle.id); assert.deepEqual(sim.state.player.position, vehicle.position);
  assert.equal(roadExitPermit(sim.state, 'vehicle:' + vehicle.id), null); clone(sim);
});

test('a genuine closed active save and ordinary 24-step continuation keep full state byte exact', () => {
  const sim = new Simulation(roadWorld()), npc = intent(sim, point(0)); nativeFlood(sim); assert.equal(npc.destinationId, 'civic-east');
  const next = clone(sim); for (let i = 0; i < 24; i++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), 'same full original state after tick ' + i); }
});

test('loading another genuine closed set at the same revision invalidates already primed cached routes', () => {
  const world = roadWorld(true, true), first = new Simulation(world), second = new Simulation(world);
  nativeFlood(first, 0); nativeFlood(second, 1);
  assert.equal(roadRevision(first.state), roadRevision(second.state)); assert.equal(first.state.roadNetwork!.closures[0].edgeId, 'a-river-road'); assert.equal(second.state.roadNetwork!.closures[0].edgeId, 'b-upper-road');
  assert.equal(first.buildingTravelDistance('home-west', 'civic-east'), 480);
  const save = second.exportSave(), result = first.importSave(save); assert(result.ok, result.message); assert.equal(first.exportSave(), save);
  assert.equal(first.buildingTravelDistance('home-west', 'civic-east'), 160, 'state identity invalidates a cache even when revision numbers are equal');
});


test('a newly accepted real road task cannot spend pre-task deferred minutes on its first walking phase', () => {
  const context = setupRoadworks(), { sim } = context;
  assert(sim.command({ type: 'speed', value: 1 }).ok); sim.setFocus({ x: 9000, y: .6, z: 9000 }, 'drone');
  // Only ordinary pre-request ticks build the low-frequency backlog. Read the
  // actual adapter's costs to choose when its nearest willing candidate has a
  // real backlog; never write pending minutes, position, needs, skill or money.
  const bestAtThisClock = () => {
    let best: { actor: Citizen; cost: number } | undefined;
    for (const actor of sim.state.citizens) {
      const profile = sim.state.extension!.actorProfiles[actor.id];
      if (!profile.alive || profile.age < 18 || profile.health < 45 || !['工人', '工程师'].includes(actor.role) || (actor.skills?.craft ?? 0) < 20 || actor.needs.hunger < 40 || actor.needs.fatigue < 35 || actor.money >= 450 || profile.stress >= 75) continue;
      const cost = Reflect.get(sim, 'roadworkTravelCost'); if (!Number.isFinite(cost.call(sim, actor.id, context.closure.worksiteNodeId, context.closure.worksite))) continue;
      for (const shop of sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory >= 1)) {
        const site = sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!, node = [...sim.worldDefinition.nodes].sort((a,b) => separation(a.position, site.door) - separation(b.position, site.door) || a.id.localeCompare(b.id))[0];
        const quote = sim.quoteSupply(shop.id, 1), rate = 32 * (.7 + sim.state.districts.find(d => d.id === actor.districtId)!.prosperity / 100) / 480;
        if (quote.quantity < 1 || quote.unitPrice + 60 * rate > 100 + 1e-7 || sim.shopFunds(shop) + quote.unitPrice * (1 - sim.state.taxRate) > 1e9) continue;
        const provided = site.functionPoints ?? Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
        // The truly unmarked original supplier uses its real existing door
        // proximity contract. An absent v4 provider is not an absent supplier.
        const points = provided.length || site.floorPlanProfile === FLOOR_PLAN_PROFILE ? provided : [{ id: 'legacy-sale-door', purpose: 'sale' as const, floor: 0, position: site.door }];
        const role: Role = actor.role === '工程师' ? 'scientist' : 'traveler', person = { role, identities: [role] };
        for (const point of points.filter(p => p.purpose === 'sale' && canAccessFloor(site, p.floor, person))) {
          const actualCost = cost.call(sim, actor.id, node.id, point.position);
          if (!Number.isFinite(actualCost) || Math.abs(getWalkHeight(sim.worldDefinition, point.position.x, point.position.z, point.position.y) - point.position.y) > .26 || homeRestPointBlockedByVoxels(point.position, sim.state.voxels) || !sim.isAtBuildingFunctionPoint(site, point.position, 'sale', person)) continue;
          if (!best || actualCost < best.cost) best = { actor, cost: actualCost };
        }
      }
    }
    return best;
  };
  let chosen: Citizen | undefined;
  for (let i = 0; i < 64; i++) {
    const best = bestAtThisClock();
    if (best && (core(sim).peopleElapsed?.[best.actor.id] ?? 0) >= 1) { chosen = best.actor; break; }
    sim.step(.25);
  }
  assert(chosen, 'controlled low-frequency opening must have a truly deferred willing original worker before the single request');
  const pending = core(sim).peopleElapsed[chosen.id], before = { ...chosen.position }, identity = { role: chosen.role, workId: chosen.workId, homeId: chosen.homeId }, job = request(context);
  assert.equal(job.workerId, chosen.id, 'the real module, not a test assignment, accepts this original resident');
  assert.equal(job.acceptedAt, clock(sim)); assert(pending >= 1); assert.equal(chosen.tier, 'statistical');
  sim.step(.25);
  assert(separation(chosen.position, before) <= 3.1 * .25 + 1e-7, 'first actual task phase cannot reuse the older deferred street movement');
  assert.equal(job.workedMinutes, 0); assert.equal(job.paidGross, 0); assert.equal(job.receivedUnits, 0);
  assert.deepEqual({ role: chosen.role, workId: chosen.workId, homeId: chosen.homeId }, identity);
});


/** Controlled native crime/weather map. The second original workshop is
 * declared before construction so real emergency procurement leaves actual
 * materials for the original security dispatch. No runtime stock/money,
 * police qualification, Crime or dispatch event is created by the test. */
function dispatchWorld(): WorldDefinition {
  const world = roadWorld(false);
  world.districts[0].center = { x: 68.42525718268007, y: .6, z: -11.640410241670906 };
  world.nodes = [world.nodes[0], world.nodes[1], { id: 'P', name: '原警署', districtId: world.districts[0].id, position: point(-20, -40), station: false }];
  world.edges.push({ id: 'police-access', from: 'A', to: 'P', mode: 'road', length: Math.hypot(20, 40), capacity: 20, points: [point(0), point(-20, -40)] });
  world.river = [point(60, -10), point(60, 10)];
  world.buildings = [
    ['home-west', 'home', -25, 0, -20], ['police-west', 'police', -25, -40, -20],
    ['materials-east', 'workshop', 145, 0, 140], ['materials-east-reserve', 'workshop', 145, 40, 140],
  ].map(([id, kind, x, z, doorX], i) => ({ id: String(id), name: String(id), kind: kind as WorldDefinition['buildings'][number]['kind'], districtId: world.districts[0].id,
    position: { x: Number(x), y: 0, z: Number(z) }, door: point(Number(doorX), Number(z)), width: 10, depth: 10, height: 6, floors: 1, rotation: 0, capacity: 200, seed: i + 1 }));
  return world;
}
function nativeDispatch(sim: Simulation) {
  // The original security PRNG branch creates its Crime and selects the real
  // originally qualified, funded public police citizen. This timer/seed input
  // does not hand-emit either event or write any actor/financial attributes.
  core(sim).rng = 1; core(sim).crimeAt = clock(sim);
  const known = new Set(sim.state.crimes.map(c => c.id)); sim.step(.25);
  const crime = sim.state.crimes.find(c => !known.has(c.id)); assert(crime, 'the original security source must create the actual incident');
  const pair = Object.entries(core(sim).dispatches).find(([, d]: any) => d.crimeId === crime.id); assert(pair, 'the original security mechanism must assign its own police citizen');
  const officer = sim.state.citizens.find(c => c.id === pair[0])!, dispatch = core(sim).dispatches[officer.id];
  assert.equal(officer.role, '警察'); assert.equal(officer.workId, 'police-west');
  assert(sim.state.extension!.actorProfiles[officer.id].alive && sim.state.extension!.actorProfiles[officer.id].age >= 18);
  assert(Reflect.get(sim, 'publicWorkAllowance').call(sim, officer) > 0, 'uses the real original public wage allowance');
  assert.equal(officer.destinationId, 'home-west'); assert.equal(crime.position.x, 20); assert.equal(crime.position.z, 0);
  return { officer, crime, dispatch };
}
function responseAccrual(sim: Simulation, officer: Citizen) {
  return core(sim).wageAccruals.filter((r: any) => r.citizenId === officer.id).reduce((n: number, r: any) => n + r.amount, 0);
}

test('a native dispatch after closure cannot replace its unreachable real incident with a paid facility arrival', () => {
  const sim = new Simulation(dispatchWorld()); nativeFlood(sim);
  assert(sim.state.shops.reduce((sum, shop) => sum + shop.inventory, 0) >= 3, 'original constructor stock remains after actual emergency procurement');
  const { officer, crime, dispatch } = nativeDispatch(sim), position = { ...officer.position }, wage = responseAccrual(sim, officer);
  const identity = { role: officer.role, workId: officer.workId, homeId: officer.homeId, destinationId: officer.destinationId };
  assert(Number.isFinite(Reflect.get(sim, 'walkingDistance').call(sim, officer, sim.worldDefinition.buildings.find(b => b.id === 'home-west')!)), 'the nearest original facility really remains reachable');
  assert.equal(roadExitPermit(sim.state, officer.id), null); assert(officer.route!.some(p => separation(p, crime.position) < 1e-7));
  let arrivals = 0; sim.onEvent('officer-arrived', event => { if (event.citizenId === officer.id) arrivals++; });
  for (let i = 0; i < 240; i++) sim.step(.25);
  assert.equal(dispatch.arrived, false, 'a closed-deck incident cannot be falsely reached at the open facility');
  assert.equal(arrivals, 0); assert.equal(crime.status, 'responding'); assert.equal(officer.state, 'roadWaiting'); assert.deepEqual(officer.position, position);
  assert.equal(responseAccrual(sim, officer), wage, 'a blocked response, including its failed movement phase, earns no office wage');
  assert.deepEqual({ role: officer.role, workId: officer.workId, homeId: officer.homeId, destinationId: officer.destinationId }, identity);
  const next = clone(sim); for (let i = 0; i < 24; i++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), 'full real waiting dispatch continuation ' + (i + 1)); }
});

test('an existing native police response replans its complete physical incident tail when the actual road closes', () => {
  const sim = new Simulation(dispatchWorld()); sim.step(.25);
  const { officer, crime, dispatch } = nativeDispatch(sim), wage = responseAccrual(sim, officer), destination = officer.destinationId;
  assert.equal(officer.state, 'responding'); assert(officer.route!.some(p => separation(p, crime.position) < 1e-7));
  nativeFlood(sim); assert.equal(isRoadOpen(sim.state, 'a-river-road'), false); assert.equal(roadExitPermit(sim.state, officer.id), null);
  const afterClosure = { ...officer.position };
  for (let i = 0; i < 240; i++) sim.step(.25);
  assert.equal(dispatch.arrived, false); assert.equal(crime.status, 'responding'); assert.equal(officer.state, 'roadWaiting'); assert.equal(officer.destinationId, destination); assert.deepEqual(officer.position, afterClosure);
  assert.equal(responseAccrual(sim, officer), wage, 'the closure/route-rejection phase and waiting ticks do not count as public response work');
});


test('real paid road completion leaves every saved NPC route ready for an exact immediate reload and 24 ordinary ticks', () => {
  const context = setupRoadworks(), { sim, closure } = context, job = request(context);
  assert(job.workerId, 'the real module must accept its original qualified resident, without test assignment');
  const worker = sim.state.citizens.find(c => c.id === job.workerId)!, identity = { role: worker.role, workId: worker.workId, homeId: worker.homeId, destinationId: worker.destinationId };
  until(sim, () => job.workedMinutes === 60 && isRoadOpen(sim.state, closure.edgeId), 900);
  assert.equal(job.receivedUnits, 1); assert.equal(job.consumedUnits, 1); assert(job.paidGross > 0 && job.paidNet > 0); assert(Math.abs(job.paidGross - job.paidNet - job.paidTax) < 1e-8, 'all actual gross is paid net or collected tax');
  assert.deepEqual({ role: worker.role, workId: worker.workId, homeId: worker.homeId, destinationId: worker.destinationId }, identity, 'completion restores routing to the original saved employment/intent without changing identity');
  const next = clone(sim);
  for (let i = 0; i < 24; i++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), 'full real reopened phase continuation ' + (i + 1)); }
});


test('an originally arrived real investigator stays at its incident through a canonical road revision and exact 24-step reload', () => {
  const sim = new Simulation(dispatchWorld()); sim.step(.25);
  const { officer, crime, dispatch } = nativeDispatch(sim);
  for (let i = 0; i < 240 && !dispatch.arrived; i++) sim.step(.25);
  assert(dispatch.arrived, 'the original police must physically finish its original open-road response');
  assert.equal(crime.status, 'responding', 'the original responseAt timer still requires real onsite investigation');
  assert(separation(officer.position, crime.position) <= 3);
  const position = { ...officer.position }, destination = officer.destinationId, route = structuredClone(officer.route);
  nativeFlood(sim); assert.equal(isRoadOpen(sim.state, 'a-river-road'), false);
  assert.deepEqual(officer.position, position); assert.equal(officer.destinationId, destination); assert.deepEqual(officer.route, route); assert.equal(officer.state, 'investigating');
  const next = clone(sim);
  for (let i = 0; i < 24; i++) {
    sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), 'full real arrived investigator continuation ' + (i + 1));
    assert.deepEqual(officer.position, position, 'a routing revision creates no gratuitous incident-to-facility journey');
  }
  // Continue the same genuinely arrived officer and original closed-world
  // checkpoint above; no second dispatch, actor control or fabricated permit.
  assert.deepEqual(position, crime.position); assert.equal(officer.routeIndex, officer.route!.length);
  const permit = roadExitPermit(sim.state, officer.id); assert(permit, 'canonical closure captures the actual mid-edge finished-route body');
  assert.equal(permit.edgeId, 'a-river-road'); assert.equal(permit.exitNodeId, 'A'); assert.equal(permit.direction, -1);
  const witness = sim.state.roadNetwork!.closures[0].occupants.find(row => row.actorId === officer.id)!;
  assert(witness); assert.equal(witness.nextPoint, null); assert.equal(witness.routeIndex, route!.length); assert.deepEqual(witness.startPosition, position);
  const identity = { role: officer.role, workId: officer.workId, homeId: officer.homeId }, resolvedBefore = sim.state.metrics.crimesResolved;
  for (let i = 0; i < 64 && crime.status === 'responding'; i++) {
    sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), 'full real remaining onsite investigation ' + (i + 1));
    assert.deepEqual(officer.position, position, 'the original responseAt investigation remains at the actual incident');
  }
  assert.equal(crime.status, 'resolved', 'the original security timer resolves the actual investigated case'); assert.equal(sim.state.metrics.crimesResolved, resolvedBefore + 1);
  assert.equal(core(sim).dispatches[officer.id], dispatch, 'the real original assignment persists until the next ordinary people phase');
  const beforeDeparture = { ...officer.position }; sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), 'full real dispatch-release phase');
  assert.equal(core(sim).dispatches[officer.id], undefined, 'the original resolved-case lifecycle releases its own dispatch');
  assert(officer.position.x < beforeDeparture.x, 'ordinary 1x choice starts leaving toward the captured west exit');
  assert(separation(officer.position, beforeDeparture) <= 3.1 * .25 + 1e-7, 'the first real exit phase retains the original rainy walking speed');
  assert.equal(officer.position.z, 0); assert.equal(isRoadOpen(sim.state, 'a-river-road'), false); assert(roadExitPermit(sim.state, officer.id));
  for (let i = 0; i < 64 && roadExitPermit(sim.state, officer.id); i++) {
    const previous = { ...officer.position }; sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), 'full real captured departure ' + (i + 1));
    assert(separation(officer.position, previous) <= 3.1 * .25 + 1e-7, 'every ordinary exit phase keeps original speed without pins or teleporting');
  }
  assert.equal(roadExitPermit(sim.state, officer.id), null, 'actual body exit releases its original captured permission'); assert(officer.position.x <= 0); assert.equal(isRoadOpen(sim.state, 'a-river-road'), false, 'departure cannot silently reopen the road');
  assert.deepEqual({ role: officer.role, workId: officer.workId, homeId: officer.homeId }, identity);
  const afterExit = clone(sim);
  for (let i = 0; i < 24; i++) { sim.step(.25); afterExit.step(.25); assert.equal(afterExit.exportSave(), sim.exportSave(), 'full real finished-dispatch exit continuation ' + (i + 1)); }
});
