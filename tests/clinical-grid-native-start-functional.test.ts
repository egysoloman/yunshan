import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation, isCanonicalNpcWage } from '../src/simulation';
import { beginClinicalTreatment, clinicalPairAtServiceStation } from '../src/simulation/clinical';
import { gridBuildingSupplyRatio } from '../src/simulation/power-grid';
import { fixture } from './clinical-presence-fixture';
import { clock, initialIntent } from './clinical-arrival-fixture';

// PREPARED ONLY until a root-coordinated actual window. These are declared
// controlled finite-storage maps, never modifications to the true after24.
// All bodies/time are initialized once; ordinary steps perform every wage,
// purchase, depletion and care claim. No resource or body reset follows.
const cases = [
  { name: 'full-native-open-prefix', start: 480, stored: 24, maximum: 2, connected: true, worked: [0, 4, 8, 8] },
  { name: 'one-percent-pauses', start: 480, stored: .32, maximum: .02, connected: true, worked: [0, 0, 0, 0] },
  { name: 'real-storage-exhaustion', start: 480, stored: 16, maximum: 2, connected: true, worked: [0, 4, 4, 4] },
  { name: 'null-clinic-feeder', start: 480, stored: 24, maximum: 2, connected: false, worked: [0, 0, 0, 0] },
];

for (const scenario of cases) test(scenario.name + ': finite power, original paid material and actual medical presence', () => {
  const world = fixture();
  const node = { id: 'declared-clinic-node', kind: 'substation' as const, position: { x: 300, y: 1, z: 0 }, capacityP: scenario.maximum };
  const provider = world.buildings.find(site => site.id === 'pair-workshop')!;
  const providerNode = { id: 'declared-provider-node', kind: 'substation' as const, position: { ...provider.position, y: 1 }, capacityP: 100 };
  // Original nine buildings all declarebase2, and originalthree operating
  // shops add .5each: 19.5Ptotal,17.5Poutsideclinic. Independent provider
  // asset17.5×fourreal4min=280PMinutes, not an infinite city supply.
  const providerDemandP = 17.5;
  world.powerGrid = { version: 1, kind: 'finite-storage-network', nodes: [node, providerNode], links: [],
    storage: [{ id: 'declared-finite-battery', buildingId: 'pair-clinic', nodeId: node.id, maximumP: scenario.maximum, initialStoredPMinutes: scenario.stored }, { id: 'declared-finite-provider-battery', buildingId: provider.id, nodeId: providerNode.id, maximumP: providerDemandP, initialStoredPMinutes: providerDemandP * 16 }],
    buildings: world.buildings.map(site => ({ buildingId: site.id, nodeId: site.id === 'pair-clinic' ? scenario.connected ? node.id : null : providerNode.id, baseP: 2, nightP: 1, shopP: .5 })),
    transport: [] };
  const sim = new Simulation(world);
  assert.equal(sim.state.shops.length, 3); assert.equal(sim.state.vehicles.length, 0);
  assert.equal(sim.state.shops.filter(shop => ['pair-market', 'pair-workshop', 'pair-farm'].includes(shop.buildingId)).length, 3);
  const site = sim.worldDefinition.buildings.find(site => site.id === 'pair-clinic')!;
  const point = site.functionPoints!.find(point => point.purpose === 'service' && point.floor === 0)!;
  const doctor = sim.state.citizens.find(person => person.id === 'citizen-4')!;
  const patient = sim.state.citizens.find(person => person.id === 'citizen-1')!;
  assert.equal(doctor.role, '医生'); assert.equal(doctor.workId, site.id);
  assert.ok(sim.state.extension!.actorProfiles[patient.id].health > 0 && sim.state.extension!.actorProfiles[patient.id].health < 100);
  sim.command({ type: 'speed', value: 16 });
  assert.equal(clock(sim), 480); assert.equal(sim.state.hour, 8);
  sim.setFocus(point.position, 'walk');
  initialIntent(sim, doctor, site, point.position, 'work');
  initialIntent(sim, patient, site, point.position, 'heal');
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, patient.id), true);
  const cash = sim.state.player.money;
  const begun = beginClinicalTreatment(sim, { patientId: patient.id, payerId: 'player', siteId: site.id });
  assert.equal(begun.ok, true, begun.message); assert.equal(sim.state.player.money, cash - 30);
  const order = sim.state.clinical!.orders.at(-1)!;
  const wages: any[] = [], arrivals: any[] = [], trace: unknown[] = [];
  sim.onEvent('wage-earned', event => { if (event.citizenId === doctor.id) wages.push({ tick: sim.state.tick, canonical: isCanonicalNpcWage(event), event: structuredClone(event) }); });
  sim.onEvent('clinical-activity-window', event => { if (event.citizenId === doctor.id) arrivals.push({ tick: sim.state.tick, event: structuredClone(event) }); });
  const output = process.env.ROOT17_GRID_FUNCTIONAL_OUTPUT;
  const record = (name: string, data: unknown) => {
    if (!output) return;
    const directory = join(output, scenario.name); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  };
  record('declared-initial.json', { scope: 'controlled original9-building/384-native-person fixture, original08:00/480 clock unchanged, with explicit finite power asset; not trueafter24 or naturalpublic6', scenario, world: sim.worldDefinition, clock: clock(sim), originalPatientHealth: sim.state.extension!.actorProfiles[patient.id].health, funded: 30 });
  let firstReceipt = '', purchasePaid = 0;
  for (let i = 0; i < 4; i++) {
    const start = clock(sim); sim.step(.25);
    const wage = wages.find(row => row.tick === sim.state.tick), arrival = arrivals.find(row => row.tick === sim.state.tick);
    const ratio = gridBuildingSupplyRatio(sim.state, site.id);
    assert.equal(gridBuildingSupplyRatio(sim.state, provider.id), 1, 'originalfinite material provider requires currentfullpower');
    assert.equal(sim.state.shops.find(shop => shop.buildingId === provider.id)!.open, true, 'material provider must trulyoperate beforeprocurement');
    trace.push({ tick: sim.state.tick, start, end: clock(sim), ratio, currentCanonicalWage: wage, actualArrival: arrival, actualPair: clinicalPairAtServiceStation(sim, site, doctor.id, patient.id), currentPower: structuredClone(sim.state.powerGrid), order: structuredClone(order), patientPosition: structuredClone(patient.position), doctorPosition: structuredClone(doctor.position), patientNeeds: structuredClone(patient.needs), doctorNeeds: structuredClone(doctor.needs) });
    record('trace.json', trace); record('tick-' + sim.state.tick + '.save.json', sim.exportSave());
    assert.ok(wage?.canonical && wage.event.amount > 0 && wage.event.minutes > 0, 'power rejection cannot be explained by a missing real paid doctor');
    assert.ok(arrival?.event.activityObservedTick === sim.state.tick && arrival.event.activityObservedClock === clock(sim));
    assert.equal(arrival.event.purpose, 'work'); assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, patient.id), true);
    assert.ok(Math.abs(order.workedMinutes - scenario.worked[i]) < 1e-7, 'only fully supplied actual intervals may count toward the original twenty minutes');
    assert.equal(order.receivedUnits, 1); assert.equal(order.reservedUnits, 1); assert.equal(order.consumedUnits, 0);
    if (i === 0) { assert.equal(order.receipts.length, 1); assert.ok(order.purchasePaid > 0); firstReceipt = JSON.stringify(order.receipts); purchasePaid = order.purchasePaid; }
    else { assert.equal(JSON.stringify(order.receipts), firstReceipt); assert.equal(order.purchasePaid, purchasePaid); }
    if (scenario.name === 'one-percent-pauses') assert.ok(ratio > 0 && ratio < 1 - 1e-7);
    if (scenario.name === 'null-clinic-feeder' || scenario.name === 'real-storage-exhaustion' && i >= 2) assert.equal(ratio, 0);
    if (ratio < 1 - 1e-7) assert.match(order.lastReason, /未足额/);
  }
  assert.equal(order.requiredMinutes, 20); assert.equal(order.completedAt, null); assert.equal(sim.state.clinical!.stats.completed, 0);
  assert.equal(sim.state.player.money, cash - 30);
  assert.ok(sim.state.powerGrid!.consumedPMinutes['declared-finite-battery'] <= scenario.stored + 1e-7);
  assert.ok(sim.state.powerGrid!.consumedPMinutes['declared-finite-provider-battery'] <= 280 + 1e-7);
  record('PASS-summary.json', { status: 'PASS_CONTROLLED_DECLARED_GRID_PARTIAL_OR_ZERO_PAUSES_FULL_NATIVE_OPEN_PREFIX_ONLY', scenario, nativeQuarterSteps: 4, speed: 16, actualWorkedMinutes: order.workedMinutes, requiredMinutes: 20, completed: false, reservedUnits: 1, consumedUnits: 0, currentPower: sim.state.powerGrid, order });
});
