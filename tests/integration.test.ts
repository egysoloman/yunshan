import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { createWorld, getWalkHeight } from '../src/world.ts';
import { blocksTransportBarrier } from '../src/transport-geometry.ts';
import { activeAircraft, setAircraftControls } from '../src/aviation.ts';
import { GAME_DAY } from '../src/simulation/family.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { getBuildingBody, getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import type { Building, BuildingFunctionPoint, BuildingKind, Player, WorldDefinition } from '../src/types.ts';

const world = createWorld();
// Controlled onsite fixtures use the actual supported programme position.
// Their roles, money, tick limits and business/save assertions stay unchanged.
function fixturePoint(simulation: Simulation, building: Building, purpose: BuildingFunctionPoint['purpose'], person: Pick<Player, 'role' | 'identities'> = simulation.state.player) {
  if (!getBuildingBody(building)) return { ...building.door };
  const point = getBuildingUsePoints(building, 0).find(point => point.purpose === purpose && simulation.isAtBuildingFunctionPoint(building, point.position, purpose, person));
  assert.ok(point, `A controlled ${purpose} fixture requires a real accessible point in ${building.id}`);
  return { ...point.position };
}
const restore = (source: Simulation, sourceWorld: WorldDefinition = world) => {
  const saved = source.exportSave(), restored = new Simulation(sourceWorld);
  const result = restored.importSave(saved);
  assert.equal(result.ok, true, result.message);
  assert.equal(restored.exportSave(), saved, 'loading a current save must preserve its entire state');
  return restored;
};

test('the public river road remains walkable across the intersecting bridge apron', () => {
  const road = world.edges.find(edge => edge.id === 'road-river-quarter-3-river-station')!;
  assert(road.points.some((point, index) => index > 0 && point.x === -664 && road.points[index - 1].x === -664
    && Math.min(point.z, road.points[index - 1].z) <= 1035.4 && Math.max(point.z, road.points[index - 1].z) >= 1044));
  for (const [fromZ, toZ] of [[1035.4, 1036], [1036, 1035.4], [1040, 1044], [1044, 1040]]) {
    const from = { x: -664, y: getWalkHeight(world, -664, fromZ, 18.6), z: fromZ };
    const to = { x: -664, y: getWalkHeight(world, -664, toZ, from.y), z: toZ };
    assert.equal(blocksTransportBarrier(world, from, to), false, `an actual road step ${fromZ}→${toZ} must not be blocked by another network's railing`);
  }
});

test('a player-founded operating company keeps its proprietor and capital through exact reload', () => {
  const simulation = new Simulation(world);
  simulation.state.player.identities = ['traveler', 'merchant'];
  const site = world.buildings.find(site => ['market', 'workshop', 'farm', 'dock'].includes(site.kind)
    && !site.facility && !simulation.state.extension!.companies.some(company => company.buildingId === site.id))!;
  simulation.state.player.position = fixturePoint(simulation, site, 'work');
  const result = simulation.command({ type: 'foundCompany', targetId: site.id, value: 300 });
  assert.equal(result.ok, true, result.message);
  const shop = simulation.state.shops.find(shop => shop.buildingId === site.id)!;
  assert.equal(shop.ownerId, 'player');
  const company = simulation.state.extension!.companies.find(company => company.buildingId === site.id)!;
  const restored = restore(simulation);
  assert.equal(restored.state.shops.find(candidate => candidate.id === shop.id)?.ownerId, 'player');
  assert.equal(restored.state.extension!.companies.find(candidate => candidate.id === company.id)!.capital, company.capital);
  for (let tick = 0; tick < 16; tick++) { simulation.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), simulation.exportSave());
});

test('selling the last privately held company shares cannot produce an unreadable operating company', () => {
  const simulation = new Simulation(world);
  simulation.state.player.identities = ['traveler', 'merchant']; simulation.state.player.money = 10000;
  const site = world.buildings.find(site => ['market', 'workshop', 'farm', 'dock'].includes(site.kind)
    && !site.facility && !simulation.state.extension!.companies.some(company => company.buildingId === site.id))!;
  simulation.state.player.position = fixturePoint(simulation, site, 'work');
  let result = simulation.command({ type: 'foundCompany', targetId: site.id, value: 3000 }); assert.equal(result.ok, true, result.message);
  const company = simulation.state.extension!.companies.find(company => company.buildingId === site.id)!;
  result = simulation.command({ type: 'expandCompany', targetId: company.id, value: 100 }); assert.equal(result.ok, true, result.message);
  // Expansion now needs real construction time and attended labor before listing.
  assert.equal(company.level, 1);
  simulation.command({ type: 'speed', value: 8 });
  const shop = simulation.state.shops.find(shop => shop.buildingId === site.id)!, worker = simulation.state.citizens.find(person => simulation.state.extension!.actorProfiles[person.id].age >= 18)!;
  shop.employees = Math.max(1, shop.employees); company.employees = shop.employees;
  const workerPosition = fixturePoint(simulation, site, 'work', { role: 'traveler', identities: ['traveler'] });
  let pinAttendance = true;
  simulation.onPhase('traffic', () => {
    if (!pinAttendance) return;
    worker.workId = site.id; worker.role = '工人'; worker.position = { ...workerPosition };
    worker.destinationId = site.id; worker.route = []; worker.routeIndex = 0; worker.money = Math.min(worker.money, 100);
    worker.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  });
  for (let tick = 0; company.level < 2 && tick < 64; tick++) simulation.step(.25);
  pinAttendance = false; assert.equal(company.level, 2, 'a listing fixture must first finish actual on-site construction');
  simulation.state.player.position = fixturePoint(simulation, world.buildings.find(site => site.kind === 'bank')!, 'service');
  result = simulation.command({ type: 'listCompany', targetId: company.id }); assert.equal(result.ok, true, result.message);
  const before = simulation.exportSave();
  result = simulation.command({ type: 'sellShares', targetId: company.id, value: company.shareholders.player });
  assert.equal(result.ok, false, 'a company requires at least one real proprietor before its last private holding can be sold');
  assert.equal(simulation.exportSave(), before, 'a blocked final disposal must not change shares or either wallet');
  const restored = restore(simulation);
  for (let tick = 0; tick < 16; tick++) { simulation.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), simulation.exportSave());
});

/** Marriage/elapsed gestation are fixtures; birth, flight and persistence use the actual installed systems. */
function flyingFamily() {
  const simulation = new Simulation(world), state = simulation.state;
  simulation.command({ type: 'speed', value: 8 });
  const spouse = state.citizens.find(person => !person.partnerId && person.role !== '学生')!;
  const home = world.buildings.find(site => site.id === spouse.homeId)!;
  state.player.homeId = home.id; state.player.partnerId = spouse.id; state.player.position = { ...home.door };
  spouse.partnerId = 'player'; spouse.position = { ...home.door };
  state.player.money = spouse.money = 1000;
  state.player.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; spouse.needs = { ...state.player.needs };
  for (const id of ['player', spouse.id]) Object.assign(state.extension!.actorProfiles[id], { age: 28, health: 100, mood: 80, stress: 10 });
  state.relationships.push({ npcId: spouse.id, affection: 90, trust: 90, type: 'spouse', encounters: 20, memories: [], tags: ['共同生活'], romanceStage: 'family', romanceSince: 0, hostilityStage: 'none', consent: true });
  state.extension!.lastUpdate = state.family!.lastUpdate = 8 * GAME_DAY;
  state.culture!.lastUpdate = state.extension!.lastUpdate;
  const planned = simulation.command({ type: 'planFamily', targetId: spouse.id }); assert.equal(planned.ok, true, planned.message);
  state.extension!.lastUpdate = state.family!.lastUpdate = state.family!.pregnancies[0].dueAt - 2;
  state.culture!.lastUpdate = state.extension!.lastUpdate;
  const aircraft = state.aviation!.aircraft.find(craft => craft.kind === 'drone')!;
  state.player.position = { ...aircraft.position, x: aircraft.position.x + 2, y: aircraft.position.y - .6 };
  for (const type of ['rentAircraft', 'boardAircraft'] as const) { const result = simulation.command({ type, targetId: aircraft.id }); assert.equal(result.ok, true, result.message); }
  setAircraftControls(state, { forward: 0, strafe: 0, climb: 1, yaw: 0, pitch: 0, speed: 85, boost: false });
  simulation.step(.25);
  assert.equal(state.citizens.filter(person => person.id === 'resident-1').length, 1);
  return simulation;
}

test('an actual newborn and airborne passenger survive geographic partitioning and deterministic continuation together', () => {
  const simulation = flyingFamily(), saved = simulation.exportSave();
  const parts = partitionSave(saved, world), assembled = assembleSave(parts);
  assert.equal(assembled, saved);
  const restored = new Simulation(world), result = restored.importSave(assembled);
  assert.equal(result.ok, true, result.message);
  assert.equal(restored.exportSave(), saved);
  assert(restored.state.extension!.actorProfiles['resident-1'].alive);
  assert.equal(restored.state.family!.children['resident-1'].parentIds[0], 'player');
  assert(activeAircraft(restored.state));
  for (let tick = 0; tick < 24; tick++) { simulation.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), simulation.exportSave());
});

test('late dynamic-actor and flight reference validation rejects without changing live state or continuation', () => {
  const simulation = flyingFamily(), saved = simulation.exportSave(), twin = restore(simulation);
  for (const mutate of [
    (document: any) => { document.state.extension.actorProfiles['resident-1'].family.push('missing-relative'); },
    (document: any) => { document.state.family.children['resident-1'].parentIds[0] = 'missing-parent'; },
    (document: any) => { document.state.aviation.activeAircraftId = 'missing-aircraft'; },
  ]) {
    const document = JSON.parse(saved); mutate(document);
    assert.equal(simulation.importSave(JSON.stringify(document)).ok, false);
    assert.equal(simulation.exportSave(), saved, 'rejected data must leave clocks, wallets, genealogy and RNG unchanged');
  }
  for (let tick = 0; tick < 24; tick++) { simulation.step(.25); twin.step(.25); }
  assert.equal(simulation.exportSave(), twin.exportSave());
});

/** A small actual facility network isolates the cross-module financial save contract. */
function fundedPublicService() {
  const kinds: BuildingKind[] = ['home', 'school', 'market', 'pavilion', 'hall', 'workshop', 'clinic', 'station', 'bank'];
  const district = { id: 'integration-public', name: '公共履约集成街坊', kind: 'school', center: { x: 0, y: 0, z: 0 }, radius: 1000, color: '#779ab0', population: 384 };
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `integration-${kind}`, name: `集成${kind}`, kind, districtId: district.id, position: { x: index * 70, y: 0, z: 0 }, door: { x: index * 70, y: 0, z: 6 }, width: 12, depth: 12, height: 12, floors: 2, rotation: 0, capacity: 128, seed: index }));
  buildings.push({ id: 'integration-core', name: '集成市政阁', kind: 'core', facility: 'mayor', districtId: district.id, position: { x: 700, y: 0, z: 0 }, door: { x: 700, y: 0, z: 6 }, width: 20, depth: 20, height: 18, floors: 3, publicFloors: 1, floorPermissions: ['public', 'mayor', 'public'], floorUses: ['公共大厅', '市长决策层', '公共观景'], rotation: 0, capacity: 100, seed: 99 });
  const nodes = [0, 1].map(index => ({ id: `integration-node-${index}`, name: `集成驿站${index}`, districtId: district.id, position: { x: index * 700, y: 0, z: 20 }, station: true }));
  const localWorld: WorldDefinition = { seed: 718, voxelSize: .2, size: 2500, districts: [district], buildings, nodes, edges: [{ id: 'integration-road', mode: 'road', from: nodes[0].id, to: nodes[1].id, length: 700, capacity: 40, points: nodes.map(node => node.position) }], mountains: [], spawn: { ...buildings[0].door }, river: [], waterfall: { top: { x: 800, y: 60, z: 800 }, bottom: { x: 800, y: 0, z: 800 }, width: 10 } };
  const simulation = new Simulation(localWorld), state = simulation.state;
  simulation.command({ type: 'speed', value: 8 });
  const hall = buildings.find(building => building.kind === 'hall')!;
  simulation.setFocus({ ...hall.door }, 'walk');
  const filing = simulation.command({ type: 'filePetition', targetId: 'education', title: '实物与预算共同履约', text: '记录这个真实街坊的教育需求，公开联署并核对实际资金、材料、场所与服务人员。' });
  assert.equal(filing.ok, true, filing.message);
  // Fixed real residents isolate signature attendance, without bypassing the actual petition phase.
  simulation.onPhase('traffic', () => { for (const person of state.citizens.slice(2, 5)) { person.position = { x: hall.position.x, y: .6, z: 1.2 }; person.workId = hall.id; person.role = 'teacher'; person.destinationId = hall.id; person.route = []; person.routeIndex = 0; person.needs = { hunger: 100, fatigue: 100, social: 80, fun: 50 }; } });
  simulation.step(.25); simulation.step(.25);
  const petition = state.culture!.petitions[0]; assert.ok(petition.signerIds.length >= 3);
  state.extension!.lastUpdate = state.family!.lastUpdate = state.culture!.lastUpdate = petition.replyAt - 2;
  simulation.step(.25);
  const core = buildings.find(building => building.kind === 'core')!;
  state.player.identities = ['traveler', 'mayor']; state.player.role = 'mayor';
  simulation.setFocus({ x: core.position.x, y: core.position.y + 6.6, z: core.position.z }, 'walk');
  const approval = simulation.command({ type: 'reviewPetition', targetId: petition.id }); assert.equal(approval.ok, true, approval.message);
  simulation.step(.25);
  const order = state.culture!.orders[0]; assert.equal(order.state, 'active'); assert.equal(order.spent, 24); assert.equal(order.receivedUnits, 6);
  return { simulation, localWorld, order };
}

test('funded civic services and fiscal authorizations must survive together or reject atomically', () => {
  const { simulation, localWorld, order } = fundedPublicService(), saved = simulation.exportSave(), twin = restore(simulation, localWorld);
  const partitioned = assembleSave(partitionSave(saved, localWorld)); assert.equal(partitioned, saved);
  for (const mutate of [
    (document: any) => { document.runtime.publicBudgets = []; },
    (document: any) => { document.runtime.publicBudgets.find((budget: any) => budget.id === order.id).spent = 0; },
    (document: any) => { document.runtime.publicBudgets.find((budget: any) => budget.id === order.id).closedAt = document.state.culture.lastUpdate; },
    (document: any) => { document.state.culture.orders = []; document.state.culture.petitions[0].executionId = null; },
    (document: any) => { delete document.state.culture; },
    (document: any) => { const culture = document.state.culture; culture.version = 1; for (const key of ['orders', 'nextOrderId', 'playerServiceId', 'transportMaintenance']) delete culture[key]; for (const petition of culture.petitions) delete petition.executionId; },
  ]) {
    const document = JSON.parse(saved); mutate(document);
    const result = simulation.importSave(JSON.stringify(document)); assert.equal(result.ok, false, 'cash authorization, material receipts and service order cannot be separated in a save');
    assert.equal(simulation.exportSave(), saved, 'failed cross-module validation preserves all live data and RNG');
  }
  const clean = restore(simulation, localWorld);
  for (let tick = 0; tick < 24; tick++) { clean.step(.25); twin.step(.25); }
  assert.equal(clean.exportSave(), twin.exportSave(), 'rejected data cannot alter deterministic continuation');
});
