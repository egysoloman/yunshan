import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { createWorld } from '../src/world.ts';
import { activeAircraft, setAircraftControls } from '../src/aviation.ts';
import { GAME_DAY } from '../src/simulation/family.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import type { WorldDefinition } from '../src/types.ts';

const world = createWorld();
const restore = (source: Simulation, sourceWorld: WorldDefinition = world) => {
  const saved = source.exportSave(), restored = new Simulation(sourceWorld);
  const result = restored.importSave(saved);
  assert.equal(result.ok, true, result.message);
  assert.equal(restored.exportSave(), saved, 'loading a current save must preserve its entire state');
  return restored;
};

test('a player-founded operating company keeps its proprietor and capital through exact reload', () => {
  const simulation = new Simulation(world);
  simulation.state.player.identities = ['traveler', 'merchant'];
  const site = world.buildings.find(site => ['market', 'workshop', 'farm', 'dock'].includes(site.kind)
    && !site.facility && !simulation.state.extension!.companies.some(company => company.buildingId === site.id))!;
  simulation.state.player.position = { ...site.door };
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
  simulation.state.player.position = { ...site.door };
  let result = simulation.command({ type: 'foundCompany', targetId: site.id, value: 3000 }); assert.equal(result.ok, true, result.message);
  const company = simulation.state.extension!.companies.find(company => company.buildingId === site.id)!;
  result = simulation.command({ type: 'expandCompany', targetId: company.id, value: 100 }); assert.equal(result.ok, true, result.message);
  simulation.state.player.position = { ...world.buildings.find(site => site.kind === 'bank')!.door };
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
