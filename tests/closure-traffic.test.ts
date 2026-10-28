import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { CLOSURE_TRAFFIC_POLICY, closureTestsVehicle, validateClosureTrafficPolicy } from '../src/simulation/closure-traffic';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { isRoadOpen } from '../src/roads';
import type { Simulation } from '../src/simulation';

/** The city's own storm (extensions.ts) strikes the market district once: the canonical closure
 * is the edge there nearest the river, the market dock bridge. No closure is inserted directly. */
function stormOverMarket(sim: Simulation) {
  const environment = sim.state.extension!.environment, market = sim.state.districts.findIndex(d => d.id === 'market');
  sim.state.weather = '雨'; environment.stormRisk = 100; environment.disasterAt = sim.state.extension!.lastUpdate;
  Reflect.get(sim, 'runtime').weatherAt = sim.state.extension!.lastUpdate + 10000;
  const original = sim.nextRandom.bind(sim); Reflect.set(sim, 'nextRandom', () => (market + .5) / sim.state.districts.length);
  sim.step(.25); Reflect.set(sim, 'nextRandom', original);
  const closure = sim.state.roadNetwork?.closures.at(-1);
  assert.equal(closure?.edgeId, 'bridge-market-dock-market-station');
  return closure!;
}
/** Road vehicles at a standstill on an open edge, held by a closure. */
const heldOnOpenRoads = (sim: Simulation) => sim.state.vehicles.filter(v => v.kind === 'road' && v.state === 'roadClosed' && isRoadOpen(sim.state, v.edgeId));

test('only a vehicle on the closed edge is put to the swept closure test in a declared city', () => {
  assert.equal(closureTestsVehicle(undefined, true), true, 'undeclared cities test every vehicle as before');
  assert.equal(closureTestsVehicle(undefined, false), true);
  assert.equal(closureTestsVehicle(CLOSURE_TRAFFIC_POLICY, true), false);
  assert.equal(closureTestsVehicle(CLOSURE_TRAFFIC_POLICY, false), true, 'a vehicle on the closed deck still needs its exit permit');
});

test('after the market dock bridge closes, traffic into the market station keeps moving in a declared city and stops in an old one', () => {
  const world = createProductWorld(), station = world.nodes.find(n => n.id === 'market-station')!.position;
  const fromStation = (v: { position: { x: number; z: number } }) => Math.hypot(v.position.x - station.x, v.position.z - station.z);
  for (const [sim, declared] of [[createCurrentProductCity(world), true], [createArchivedProductCity(world), false]] as const) {
    assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
    sim.setFocus(world.spawn, 'walk');
    const closure = stormOverMarket(sim);
    // Vehicles that come up the river road into the market station, and those of them seen 5 m on.
    const arrived = new Set<string>(), passed = new Set<string>();
    sim.onEvent('vehicle-arrived', event => { if (event.nodeId === 'market-station' && event.fromEdgeId === 'road-river-station-market-station') arrived.add(event.vehicleId!); });
    for (let i = 0; i < 160 && (declared ? !passed.size : !heldOnOpenRoads(sim).length); i++) {
      sim.step(.25);
      for (const v of sim.state.vehicles) if (arrived.has(v.id) && fromStation(v) > 5) passed.add(v.id);
      if (declared) assert.deepEqual(heldOnOpenRoads(sim).map(v => v.id), [], 'no vehicle on an open road is held by the closed bridge');
    }
    assert.equal(isRoadOpen(sim.state, closure.edgeId), false, 'the bridge stays closed throughout');
    if (declared) assert.ok(passed.size > 0, 'a vehicle came up the river road, stopped at the station and drove on');
    else {
      // The old rule: a vehicle in its lane at the junction stands on the closed deck and is held there.
      const held = heldOnOpenRoads(sim);
      assert.ok(held.length > 0);
      assert.ok(held.every(v => fromStation(v) < 2), 'held in its lane at the market station');
    }
  }
});

test('the policy is declared in the save, reads back exactly, and is refused when half missing', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  for (let i = 0; i < 8; i++) sim.step(.25);
  const saved = sim.exportSave(), doc = JSON.parse(saved);
  assert.equal(sim.closureTrafficPolicyId, CLOSURE_TRAFFIC_POLICY);
  assert.equal(doc.closureTrafficPolicyId, CLOSURE_TRAFFIC_POLICY); assert.equal(doc.runtime.closureTrafficPolicyId, CLOSURE_TRAFFIC_POLICY);
  const reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  assert.throws(() => validateClosureTrafficPolicy({ ...doc, closureTrafficPolicyId: undefined }), /closure traffic/);
  assert.throws(() => validateClosureTrafficPolicy({ ...doc, closureTrafficPolicyId: 'closure-traffic-v0' }), /closure traffic/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('closureTraffic'), false, 'an undeclared city carries no policy');
});
