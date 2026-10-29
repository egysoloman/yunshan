import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { MUNICIPAL_REPAIR_DELAY, MUNICIPAL_REPAIR_POLICY, validateMunicipalRepairPolicy } from '../src/simulation/municipal-repair';
import { validateRoadworksState } from '../src/simulation/roadworks';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import type { Simulation } from '../src/simulation';

/** The city's own storm (extensions.ts) strikes the market district once and closes the market dock bridge. */
function stormOverMarket(sim: Simulation) {
  const environment = sim.state.extension!.environment, market = sim.state.districts.findIndex(d => d.id === 'market');
  sim.state.weather = '雨'; environment.stormRisk = 100; environment.disasterAt = sim.state.extension!.lastUpdate;
  Reflect.get(sim, 'runtime').weatherAt = sim.state.extension!.lastUpdate + 10000;
  const original = sim.nextRandom.bind(sim); Reflect.set(sim, 'nextRandom', () => (market + .5) / sim.state.districts.length);
  sim.step(.25); Reflect.set(sim, 'nextRandom', original);
  const closure = sim.state.roadNetwork!.closures.at(-1)!;
  assert.equal(closure.edgeId, 'bridge-market-dock-market-station');
  return closure;
}

test('a declared city files its own public repair once a closure has stood its delay, and officials on duty fund it', () => {
  const world = createProductWorld();
  for (const [sim, declared] of [[createCurrentProductCity(world), true], [createArchivedProductCity(world), false]] as const) {
    assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
    sim.setFocus(world.spawn, 'walk');
    const closure = stormOverMarket(sim), since = () => sim.state.extension!.lastUpdate - closure.occurredAt;
    const cityJobs = () => (sim.state.roadworks?.jobs ?? []).filter(job => job.requestedBy === 'city');
    while (since() < MUNICIPAL_REPAIR_DELAY - 8) { sim.step(.25); assert.equal(cityJobs().length, 0, 'nothing is filed before the delay'); }
    for (let i = 0; i < 20 && !cityJobs().length; i++) sim.step(.25);
    if (!declared) { assert.equal(cityJobs().length, 0, 'an undeclared city still waits for the player or a blocked resident'); continue; }
    const job = cityJobs()[0];
    assert.equal(job.requestedBy, 'city'); assert.equal(job.payerId, 'public'); assert.equal(job.closureId, closure.id);
    assert.ok(since() >= MUNICIPAL_REPAIR_DELAY);
    // The existing public order: two officials on duty at one site approve a funded cap.
    assert.equal(job.approvedBy.length, 2); assert.ok(job.funded > 0 && job.funded === job.authorizedCap);
    const approvers = job.approvedBy.map(id => sim.state.citizens.find(c => c.id === id)!);
    assert.ok(approvers.every(c => c.workId === job.approvalSiteId), 'both approvers work at the approving site');
    for (let i = 0; i < 10; i++) sim.step(.25);
    assert.equal(sim.state.roadworks!.jobs.filter(row => row.closureId === closure.id).length, 1, 'one open order per closure');
    assert.ok(job.workerId, 'a resident worker took it on');
    // A save with the city's order reads back exactly, whole and partitioned.
    const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
    assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
    assert.equal(assembleSave(partitionSave(saved, world)), saved);
    // A city order needs the module's own declaration; it cannot be pasted into an undeclared module.
    const forged = structuredClone(sim.state); delete forged.roadworks!.municipalVersion; delete forged.roadworks!.municipalActivatedAt;
    assert.throws(() => validateRoadworksState(forged, world), /道路工程存档无效/);
  }
});

test('the policy is declared in the save, reads back exactly, and is refused when half missing', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  for (let i = 0; i < 8; i++) sim.step(.25);
  const saved = sim.exportSave(), doc = JSON.parse(saved);
  assert.equal(sim.municipalRepairPolicyId, MUNICIPAL_REPAIR_POLICY);
  assert.equal(doc.municipalRepairPolicyId, MUNICIPAL_REPAIR_POLICY); assert.equal(doc.runtime.municipalRepairPolicyId, MUNICIPAL_REPAIR_POLICY);
  const reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  assert.throws(() => validateMunicipalRepairPolicy({ ...doc, municipalRepairPolicyId: undefined }), /municipal repair/);
  assert.throws(() => validateMunicipalRepairPolicy({ ...doc, municipalRepairPolicyId: 'municipal-repair-v0' }), /municipal repair/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('municipalRepair'), false, 'an undeclared city carries no policy');
});
