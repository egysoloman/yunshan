import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulation } from '../src/simulation';
import { createCurrentProductCity } from '../src/product-city';
import { WorldGenerationHost, generationSHA256, generationWorldSHA256, type GenerationExpectation } from '../src/host/world-generation';
import { assembleSave, partitionSave, type SavePart } from '../src/persistence/partition';
import { FLOOR_PLAN_PROFILE, getBuildingBody, wallPanels, getFloorPlanSlabRegions } from '../src/architecture-floor-plan';
import { gridWorld } from './power-grid-fixture';
import type { BuildingKind, WorldDefinition } from '../src/types';

// Exact same code-owned parameter world as the existing native-repair fixture.
// We import its real finite lease/payroll save without altering any actor/need,
// cash, inventory, role, clock, speed, event, public budget or permission.
function repairWorld(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: site.districtId, name: site.id, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const, length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261003, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '原市场公司权利验证', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const output = process.env.GENERATION_ARTIFACT_DIR ?? mkdtempSync(join(tmpdir(), 'yunshan-generation-native-'));
mkdirSync(output, { recursive: true });
const raw = (name: string, text: string) => writeFileSync(join(output, name), text);
const artifact = (name: string, value: unknown) => raw(name, JSON.stringify(value, null, 2) + '\n');
let calls = 0, constructors = 0;
let confirmedHostConstructors = 0;
process.on('exit', code => artifact('native-progress.json', { exitCode: code, visibleConstructors: constructors, confirmedHostConstructors, confirmedConstructors: constructors + confirmedHostConstructors, stepCalls: calls }));
const construct = (world: WorldDefinition) => { constructors++; return new Simulation(world); };
const step = (sim: Simulation) => { calls++; sim.step(.25); };
interface Consumers { world: WorldDefinition; simulation: Simulation; id: number; released: boolean }

test('native generations reconstruct, reject stale/aliased candidates, restore real partitions and load trusted custom sessions without rewriting origin or any ledger', async () => {
  const original = readFileSync(new URL('./fixtures/shop-native-repair/controlled-reopening.save.json', import.meta.url), 'utf8');
  assert.equal(sha(original), '63670a12ece4f11c5d53d93f46fa48755bb2388522dd5b070867275823c801a2');
  const world = repairWorld(), source = construct(world), imported = source.importSave(original);
  assert(imported.ok, imported.message); assert.equal(source.exportSave(), original);
  const originalWorld = JSON.stringify(world), beforeDocument = JSON.parse(original);
  assert.equal(beforeDocument.state.shopLifecycle.leases[0].depositEscrow, 50);
  assert.equal(beforeDocument.state.shopLifecycle.leases[0].advanceInitial, 200);
  assert(beforeDocument.runtime.wageAccruals.some((claim: { amount: number }) => claim.amount > 0));
  let sourceEvents = 0;
  for (const phase of ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'] as const) source.onPhase(phase, () => { sourceEvents++; });
  const stagedSimulations = new Set<Simulation>();
  let consumerId = 0, mode: 'normal' | 'alias' | 'aliasPending' | 'throw' | 'mutate' | 'wait' | 'mutatePanel' | 'mutateSlab' = 'normal';
  const registry = new Map<string, WorldDefinition>();
  let host: WorldGenerationHost<Consumers>;
  let lastStaged: Consumers | undefined;
  let announceWaiting: (() => void) | undefined, finishWaiting: ((consumer: Consumers) => void) | undefined;
  const services = {
    resolveWorld(id: string) { const found = registry.get(id); if (!found) throw new Error('世界未登记'); return found; },
    stageConsumers(candidateWorld: WorldDefinition, simulation: Simulation): Consumers | Promise<Consumers> {
      assert(!stagedSimulations.has(simulation)); stagedSimulations.add(simulation); confirmedHostConstructors++;
      if (mode === 'wait') { announceWaiting!(); return new Promise(resolve => { finishWaiting = resolve; }); }
      if (mode === 'mutatePanel' || mode === 'mutateSlab') {
        const body = candidateWorld.buildings.map(getBuildingBody).find(body => body)!; assert(body);
        const values = mode === 'mutatePanel' ? wallPanels(body.floorPlans[0]) : getFloorPlanSlabRegions(body.floorPlans[0]);
        assert(values.length > 0); values.splice(0, 1);
      }
      if (mode === 'alias') return host.current.consumers;
      if (mode === 'aliasPending') return lastStaged!;
      if (mode === 'throw') throw new Error('consumer staging failed');
      if (mode === 'mutate') simulation.command({ type: 'pause', value: 1 });
      return lastStaged = { world: candidateWorld, simulation, id: ++consumerId, released: false };
    },
    releaseConsumers(consumers: Consumers) { assert.equal(consumers.released, false, 'a resource is released only once'); consumers.released = true; },
  };
  const first = { world, simulation: source, id: ++consumerId, released: false };
  host = await WorldGenerationHost.attach(source, first, services);
  const originalRepairWorldSHA256 = host.current.worldSHA256;
  registry.set(host.current.worldSHA256, world);
  const expect = async (): Promise<GenerationExpectation> => ({ revision: host.current.revision, worldSHA256: host.current.worldSHA256,
    sourceSaveSHA256: await generationSHA256(host.current.simulation.exportSave()) });
  const unchanged = (sim = source, saved = original, definition = world, text = originalWorld) => {
    assert.equal(sim.exportSave(), saved); assert.equal(JSON.stringify(definition), text);
  };
  const bad = await host.prepareRebuild({ ...await expect(), sourceSaveSHA256: '0'.repeat(64) });
  assert.equal(bad.ok, false); assert.equal(host.current.simulation, source); unchanged();
  mode = 'alias'; assert.equal((await host.prepareRebuild(await expect())).ok, false);
  assert.equal(first.released, false); unchanged();
  mode = 'throw'; assert.equal((await host.prepareRebuild(await expect())).ok, false); unchanged();
  mode = 'mutate'; assert.equal((await host.prepareRebuild(await expect())).ok, false); assert(lastStaged!.released); unchanged();
  mode = 'normal'; const cancelled = await host.prepareRebuild(await expect()); assert(cancelled.ok, cancelled.message);
  const pendingConsumer = lastStaged!;
  mode = 'aliasPending'; assert.equal((await host.prepareRebuild(await expect())).ok, false); assert.equal(pendingConsumer.released, false);
  assert(host.cancel(cancelled.prepared!).ok); assert(pendingConsumer.released); unchanged();
  // A separate true reader owns the intentional concurrent command. Its
  // legitimate notice remains; we never erase it or reset the original reader.
  mode = 'normal'; const staleSource = construct(world); assert(staleSource.importSave(original).ok);
  const staleConsumers = { world, simulation: staleSource, id: ++consumerId, released: false };
  const staleHost = await WorldGenerationHost.attach(staleSource, staleConsumers, services);
  const stale = await staleHost.prepareRebuild({ revision: 0, worldSHA256: staleHost.current.worldSHA256, sourceSaveSHA256: sha(original) }); assert(stale.ok, stale.message);
  staleSource.command({ type: 'pause', value: 1 }); const currentAfterCommand = staleSource.exportSave();
  assert.equal(staleHost.commit(stale.prepared!).ok, false); unchanged(staleSource, currentAfterCommand);
  staleHost.dispose(); unchanged();
  // Both delayed aliases outlive their original owner's release. A weak
  // ownership registry refuses them without disposing old resources twice.
  const raceSource = construct(world); assert(raceSource.importSave(original).ok);
  const raceConsumers = { world, simulation: raceSource, id: ++consumerId, released: false };
  const raceHost = await WorldGenerationHost.attach(raceSource, raceConsumers, services);
  const raceExpected = { revision: 0, worldSHA256: raceHost.current.worldSHA256, sourceSaveSHA256: sha(original) };
  let entered = new Promise<void>(resolve => { announceWaiting = resolve; }); mode = 'wait';
  const delayedOld = raceHost.prepareRebuild(raceExpected); await entered; mode = 'normal';
  const winner = await raceHost.prepareRebuild(raceExpected); assert(winner.ok, winner.message); assert(raceHost.commit(winner.prepared!).ok);
  assert(raceConsumers.released); finishWaiting!(raceConsumers); assert.equal((await delayedOld).ok, false);
  assert.equal(raceHost.cleanupFailures.length, 0); unchanged(raceSource);
  const nextRaceExpected = { revision: raceHost.current.revision, worldSHA256: raceHost.current.worldSHA256, sourceSaveSHA256: sha(original) };
  const doomed = await raceHost.prepareRebuild(nextRaceExpected); assert(doomed.ok, doomed.message); const doomedConsumer = lastStaged!;
  entered = new Promise<void>(resolve => { announceWaiting = resolve; }); mode = 'wait';
  const delayedCancelled = raceHost.prepareRebuild(nextRaceExpected); await entered;
  assert(raceHost.cancel(doomed.prepared!).ok); assert(doomedConsumer.released); finishWaiting!(doomedConsumer);
  assert.equal((await delayedCancelled).ok, false); assert.equal(raceHost.cleanupFailures.length, 0);
  raceHost.dispose(); mode = 'normal'; unchanged();
  const prepared = await host.prepareRebuild(await expect()); assert(prepared.ok, prepared.message);
  unchanged(); assert.equal(sourceEvents, 0, 'staging emitted no phase or work to the old Simulation');
  assert.equal(host.commit({ ...prepared.prepared! }).ok, false, 'a copy cannot forge an owned token');
  assert(host.commit(prepared.prepared!).ok); assert.equal(host.commit(prepared.prepared!).ok, false);
  assert.notEqual(host.current.simulation, source); assert.notEqual(host.current.world, world); assert.equal(host.current.revision, 1);
  assert.equal(host.current.consumers.world, host.current.world); assert.equal(host.current.consumers.simulation, host.current.simulation);
  assert(Object.isFrozen(host.current.world)); assert(Object.isFrozen(host.current.world.buildings));
  assert(first.released); assert.equal(host.current.simulation.exportSave(), original); unchanged();
  const checkpoint = await host.exportCheckpoint(); raw('repair-generation.checkpoint.json', checkpoint); artifact('repair-world.json', world);
  const restored = await WorldGenerationHost.restore(checkpoint, sha(checkpoint), services);
  assert.equal(restored.current.revision, 1); assert.equal(restored.current.simulation.exportSave(), original);
  const parts = partitionSave(original, host.current.world); artifact('repair-parts.index.json', parts.map(part => ({ id: part.id })));
  parts.forEach((part, index) => artifact(`repair-part-${index}.json`, part));
  const physicalParts = parts.map((_part, index) => JSON.parse(readFileSync(join(output, `repair-part-${index}.json`), 'utf8')) as SavePart);
  const assembled = assembleSave(physicalParts); assert.equal(assembled, original);
  const whole = construct(host.current.world), partitioned = construct(host.current.world);
  for (const [sim, save] of [[whole, original], [partitioned, assembled]] as const) { const result = sim.importSave(save); assert(result.ok, result.message); assert.equal(sim.exportSave(), original); }
  const futures: string[] = [];
  for (let tick = 0; tick < 24; tick++) {
    for (const sim of [host.current.simulation, restored.current.simulation, whole, partitioned]) step(sim);
    const actual = host.current.simulation.exportSave(); futures.push(sha(actual));
    for (const sim of [restored.current.simulation, whole, partitioned]) assert.equal(sim.exportSave(), actual, `future ${tick + 1}`);
  }
  assert.equal(await generationWorldSHA256(host.current.world), host.current.worldSHA256, 'ordinary native steps do not change the World binding');
  const repairAfter24 = host.current.simulation.exportSave(); raw('repair-after24.save.json', repairAfter24); artifact('future24-shas.json', futures);
  unchanged(); assert.equal(sourceEvents, 0, 'retired original instance remains exactly untouched');

  // This is a different complete native parameter city, explicitly selected by
  // its trusted full World SHA and native save SHA. It is not demolition or free
  // cash/roles granted to the outgoing repair city.
  const customWorld = gridWorld();
  // Choose an explicit marked two-floor clinic before constructing this city.
  const clinic = customWorld.buildings[3]; Object.assign(clinic, { floorPlanProfile: FLOOR_PLAN_PROFILE, stairGeometryRevision: 2, width: 12, depth: 12, height: 6, floors: 2 });
  clinic.position.x = 32; clinic.door = { x: 32, y: .6, z: 6 }; customWorld.nodes[3].position = { ...clinic.door };
  const lastEdge = customWorld.edges[2]; lastEdge.points[1] = { ...clinic.door };
  lastEdge.length = Math.hypot(lastEdge.points[1].x - lastEdge.points[0].x, lastEdge.points[1].y - lastEdge.points[0].y, lastEdge.points[1].z - lastEdge.points[0].z);
  const custom = createCurrentProductCity(customWorld); constructors++;
  const customSave = custom.exportSave(), customDocument = JSON.parse(customSave), customWorldSHA = await generationWorldSHA256(customWorld);
  assert.equal(customDocument.version, 4); assert(getBuildingBody(clinic)); registry.set(customWorldSHA, customWorld);
  const guardianConsumers = { world: customWorld, simulation: custom, id: ++consumerId, released: false };
  const guardian = await WorldGenerationHost.attach(custom, guardianConsumers, services);
  for (const mutation of ['mutatePanel', 'mutateSlab'] as const) {
    mode = mutation;
    assert.equal((await guardian.prepareRebuild({ revision: 0, worldSHA256: customWorldSHA, sourceSaveSHA256: sha(customSave) })).ok, false);
    assert(lastStaged!.released); assert.equal(custom.exportSave(), customSave); assert.equal(guardianConsumers.released, false);
    assert.equal(await generationWorldSHA256(customWorld), customWorldSHA);
  }
  mode = 'normal'; const disposedCheckpoint = guardian.exportCheckpoint(); guardian.dispose();
  await assert.rejects(disposedCheckpoint, /导出期间/); assert.equal(custom.exportSave(), customSave);
  const selected = await host.prepareLoad(await expect(), { worldSHA256: customWorldSHA, saveSHA256: sha(customSave), save: customSave });
  assert(selected.ok, selected.message); assert.equal(host.current.simulation.exportSave(), repairAfter24);
  assert(host.commit(selected.prepared!).ok); assert.equal(host.current.simulation.exportSave(), customSave);
  assert.deepEqual(JSON.parse(host.current.simulation.exportSave()).state.civicStaffing.enablement, customDocument.state.civicStaffing.enablement);
  assert.equal(custom.exportSave(), customSave); assert.equal(whole.exportSave(), repairAfter24);
  const customCheckpoint = await host.exportCheckpoint(); raw('custom-v4.checkpoint.json', customCheckpoint); artifact('custom-v4-world.json', customWorld);
  const customRestored = await WorldGenerationHost.restore(customCheckpoint, sha(customCheckpoint), services);
  assert.equal(customRestored.current.simulation.exportSave(), customSave);
  const markedFuture: string[] = [];
  for (let tick = 0; tick < 24; tick++) {
    step(host.current.simulation); step(customRestored.current.simulation);
    const future = host.current.simulation.exportSave(); assert.equal(customRestored.current.simulation.exportSave(), future); markedFuture.push(sha(future));
  }
  assert.equal(await generationWorldSHA256(host.current.world), customWorldSHA, 'ordinary marked-body steps preserve all physical authority bindings');
  assert.equal(await generationWorldSHA256(customRestored.current.world), customWorldSHA);
  artifact('marked-body-future24-shas.json', markedFuture); raw('marked-body-after24.save.json', host.current.simulation.exportSave());
  const customAfter24 = host.current.simulation.exportSave();

  // Preserve the real old writer's anonymous public budget/role approvals and
  // custody. No new policy, origin, title, funds or supplied actor is installed.
  const oldWorld = JSON.parse(readFileSync(new URL('./fixtures/roadwork-replacement-native-v1/world.json', import.meta.url), 'utf8')) as WorldDefinition;
  const oldSave = readFileSync(new URL('./fixtures/roadwork-replacement-native-v1/carry.save.json', import.meta.url), 'utf8'), oldDocument = JSON.parse(oldSave);
  assert.equal(oldDocument.version, 1); assert(oldDocument.runtime.publicBudgets.length > 0);
  const oldWorldSHA = await generationWorldSHA256(oldWorld); registry.set(oldWorldSHA, oldWorld);
  const oldSelected = await host.prepareLoad(await expect(), { worldSHA256: oldWorldSHA, saveSHA256: sha(oldSave), save: oldSave });
  assert(oldSelected.ok, oldSelected.message); assert.equal(host.current.simulation.exportSave(), customAfter24);
  assert(host.commit(oldSelected.prepared!).ok); assert.equal(host.current.simulation.exportSave(), oldSave);
  const actualOld = JSON.parse(host.current.simulation.exportSave());
  assert.deepEqual(actualOld.runtime.publicBudgets, oldDocument.runtime.publicBudgets);
  assert.deepEqual(actualOld.state.citizens.map((c: { id: string; role: string }) => [c.id, c.role]), oldDocument.state.citizens.map((c: { id: string; role: string }) => [c.id, c.role]));
  assert.equal(actualOld.state.civicStaffing, oldDocument.state.civicStaffing);
  assert.equal(actualOld.state.budgetAuthority, oldDocument.state.budgetAuthority);
  assert.equal(host.current.simulation.effectiveRuleset, 'legacy');
  const oldCheckpoint = await host.exportCheckpoint(); raw('legacy-budget.checkpoint.json', oldCheckpoint); artifact('legacy-budget-world.json', oldWorld);
  const oldRestored = await WorldGenerationHost.restore(oldCheckpoint, sha(oldCheckpoint), services);
  assert.equal(oldRestored.current.simulation.exportSave(), oldSave);
  assert.equal(host.cleanupFailures.length, 0); unchanged();
  artifact('native-result.json', { status: 'PASS', simulationConstructors: constructors + stagedSimulations.size, visibleConstructors: constructors, hostConstructors: stagedSimulations.size, stepCalls: calls,
    sourcePeople: source.state.citizens.length, sourceBuildingCount: world.buildings.length, originalSaveSHA256: sha(original),
    originalWorldSHA256: originalRepairWorldSHA256, repairAfter24SHA256: sha(repairAfter24), originalSourceEvents: sourceEvents,
    physicalPartCount: parts.length, future24Exact: true, leaseDepositEscrow: 50, leaseAdvanceInitial: 200,
    customNative4SaveSHA256: sha(customSave), customWorldSHA256: customWorldSHA, markedBodyFuture24SHA256: sha(customAfter24), markedBodyBindingStable: true, retiredConsumerLateAliasRejected: true, cancelledConsumerLateAliasRejected: true, publicDerivedPanelSlabMutationRejected: true, legacyPublicBudgetSaveSHA256: sha(oldSave), legacyBudget: oldDocument.runtime.publicBudgets,
    scope: 'trusted native session generations; no geometry patch, relocation, demolition, construction or GUI publication' });
  for (const instance of [host, restored, customRestored, oldRestored]) instance.dispose();
});
