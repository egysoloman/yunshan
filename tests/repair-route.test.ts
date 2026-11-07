import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { REPAIR_ROUTE_POLICY, validateRepairRoutePolicy } from '../src/simulation/repair-route';
import { assembleSave, partitionSave } from '../src/persistence/partition';

/** The city's own storm (extensions.ts) strikes the market district once and closes the market dock bridge. */
function stormOverMarket(sim: Simulation) {
  const environment = sim.state.extension!.environment, market = sim.state.districts.findIndex(d => d.id === 'market');
  sim.state.weather = '雨'; environment.stormRisk = 100; environment.disasterAt = sim.state.extension!.lastUpdate;
  Reflect.get(sim, 'runtime').weatherAt = sim.state.extension!.lastUpdate + 10000;
  const original = sim.nextRandom.bind(sim); Reflect.set(sim, 'nextRandom', () => (market + .5) / sim.state.districts.length);
  sim.step(.25); Reflect.set(sim, 'nextRandom', original);
  return sim.state.roadNetwork!.closures.at(-1)!;
}

test('a declared city picks the repair worker and materials counter by the whole trip, worker to counter to worksite', () => {
  const world = createProductWorld(), { repairRoutePolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS, trips: number[] = [];
  for (const declared of [true, false]) {
    const sim = declared ? createCurrentProductCity(world) : new Simulation(world, withoutRule);
    assert.equal(sim.repairRoutePolicyId, declared ? REPAIR_ROUTE_POLICY : undefined);
    sim.command({ type: 'speed', value: 16 }); sim.setFocus(world.spawn, 'walk');
    const closure = stormOverMarket(sim);
    assert.equal(closure.edgeId, 'bridge-market-dock-market-station');
    const job = () => sim.state.roadworks?.jobs.find(row => row.closureId === closure.id);
    // Measured the moment a worker accepts: their walk to the counter plus the counter's carry to the worksite.
    let trip = Infinity;
    for (let i = 0; i < 400 && !job()?.workerId; i++) {
      sim.step(.25);
      const accepted = job(); if (!accepted?.workerId) continue;
      const tree = (from: string) => (Reflect.get(sim, 'walkingTree') as (start: string) => { costs: Map<string, number> }).call(sim, from);
      const toCounter = (Reflect.get(sim, 'roadworkTravelCost') as (c: string, n: string, p: object) => number).call(sim, accepted.workerId, accepted.supplierNodeId!, accepted.supplierPoint!);
      trip = toCounter + (tree(accepted.supplierNodeId!).costs.get(accepted.worksiteNodeId) ?? Infinity);
    }
    assert.ok(Number.isFinite(trip), 'a resident worker accepted the city order');
    trips.push(trip);
    if (declared) {
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
    }
  }
  // Same storm, same closure: only the rule differs (36.1 h -> 15.6 h to reopen the bridge in this city).
  assert.ok(trips[0] < trips[1], `${Math.round(trips[0])} m with the rule, ${Math.round(trips[1])} m without`);
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.repairRoutePolicyId, REPAIR_ROUTE_POLICY); assert.equal(doc.runtime.repairRoutePolicyId, REPAIR_ROUTE_POLICY);
  assert.throws(() => validateRepairRoutePolicy({ ...doc, repairRoutePolicyId: undefined }), /repair route/);
  assert.throws(() => validateRepairRoutePolicy({ ...doc, runtime: { ...doc.runtime, repairRoutePolicyId: undefined } }), /repair route/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('repairRoute'), false);
});
