import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../src/simulation.ts';
import type { PublicHealthConsumptionReceipt, ServiceOrder } from '../src/simulation/culture.ts';
import type { HygieneState } from '../src/simulation/hygiene.ts';
import { seedControlledYV1Source } from '../src/simulation/pathology.ts';
import { partitionSave, assembleSave } from '../src/persistence/partition.ts';
import { advance, at, begin, cash as existingCash, setup, pin, publicCare, station, attachControls } from './clinical-presence-fixture.ts';

// Controlled public authorization/deadline and standing positions use the
// existing declared nine-building/384-person fixture. Actual procurement,
// wages, two doctor slots, twenty care minutes and consumption remain original
// business paths. This is not default-city autonomy or a natural YV1 outbreak.
const cash = (sim: Simulation) => existingCash(sim) + (sim.state.hygiene?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0) + (sim.state.education?.course?.escrow ?? 0) + (sim.state.power?.repairs.reduce((sum, job) => sum + job.escrow, 0) ?? 0);
const hygiene = (sim: Simulation): HygieneState | undefined => sim.state.hygiene;
function prepare() { const context = setup(), order = publicCare(context); return { ...context, order }; }
function attend(context: ReturnType<typeof prepare>) { const result = context.sim.command({ type: 'attendService', targetId: context.order.id }); assert.equal(result.ok, true, result.message); }
function finish(context: ReturnType<typeof prepare>) { attend(context); advance(context.sim, 20); assert.equal(context.order.serviceMinutes.player, 20); assert.ok(context.order.servedIds.includes('player')); assert.equal(context.order.consumedUnits, 1); }
function restore24(context: ReturnType<typeof prepare>) {
  const { sim, controls } = context, saved = sim.exportSave(), copy = new Simulation(sim.worldDefinition), result = copy.importSave(saved);
  assert.equal(result.ok, true, result.message); assert.equal(copy.exportSave(), saved);
  attachControls(copy, controls);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); copy.step(.25); assert.equal(copy.exportSave(), sim.exportSave(), `whole-save continuation ${tick + 1}`); }
}
function reject(sim: Simulation, label: string, mutate: (data: any) => void) {
  const original = sim.exportSave(), data = JSON.parse(original); mutate(data);
  assert.equal(sim.importSave(JSON.stringify(data)).ok, false, label); assert.equal(sim.exportSave(), original, `${label}: atomic`);
}
function publicBatch(sim: Simulation, order: ServiceOrder) { const batch = hygiene(sim)?.batches.find(batch => batch.sourceReceipts.some(receipt => receipt.orderId === order.id)); assert.ok(batch, 'actual public care must retain its consumed material as waste'); return batch; }

test('actual public twenty-minute care produces one immutable source and waste unit without touching paid stock', () => {
  const context = prepare(), { sim, order, site } = context, total = cash(sim), paidConsumed = sim.state.clinical!.stock[site.id]?.consumedUnits ?? 0;
  assert.equal(hygiene(sim), undefined); assert.equal(order.consumedUnits, 0); assert.ok(order.spent > 0); assert.ok(order.receipts.length > 0);
  const purchased = order.receivedUnits; finish(context);
  // Kept before accesses to new fields so the same bytes are a causal behavior
  // failure against the original runtime, not a missing-export failure.
  const batch = publicBatch(sim, order);
  assert.equal(batch.generatedUnits, 1); assert.equal(batch.contaminatedUnits, 1); assert.equal(batch.containedUnits, 1); assert.equal(batch.sourceKind, 'public-health');
  assert.equal(batch.sourceReceipts.length, 1); assert.equal(batch.sourceArchive.count, 0); assert.equal(batch.hazard, 'used-material'); assert.equal(batch.pathogenSource, null);
  assert.equal(order.receivedUnits, purchased); assert.equal(sim.state.clinical!.stock[site.id]?.consumedUnits ?? 0, paidConsumed);
  assert.equal(order.healthWasteVersion, 1); assert.equal(order.healthConsumptionBaseline, 0); assert.equal(order.healthConsumptions!.length, 1);
  const source = order.healthConsumptions![0]; assert.equal(source.patientId, 'player'); assert.equal(source.consumptionIndex, 1); assert.equal(source.minutes, 20); assert.equal(source.quantity, 1); assert.equal(source.siteId, site.id);
  assert.equal(batch.pointId, source.pointId); assert.deepEqual(batch.point, source.point); assert.ok(Object.isFrozen(source) && Object.isFrozen(source.point));
  assert.equal(sim.state.pathology, undefined); assert.ok(Math.abs(cash(sim) - total) < 1e-5);
  assert.equal(assembleSave(partitionSave(sim.exportSave(), sim.worldDefinition)), sim.exportSave()); restore24(context);
});

test('public and paid patients retain two simultaneous doctor slots and distinct material sources', () => {
  const context = prepare(), { sim, controls, site, doctor, order } = context;
  const person = sim.state.citizens.find(person => person.id !== doctor.id && !['官员', '医生'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  assert.ok(person); pin(sim, controls, person.id, site, station(site, 0)); sim.state.extension!.actorProfiles[person.id].health = 70;
  const total = cash(sim), paid = begin(sim, site), publicUnits = order.receivedUnits;
  advance(sim, 22);
  assert.equal(order.serviceMinutes[person.id], 20); assert.equal(order.consumedUnits, 1); assert.equal(paid.workedMinutes, 20); assert.equal(paid.state, 'completed'); assert.equal(paid.consumedUnits, 1);
  assert.equal(order.receivedUnits, publicUnits); assert.equal(paid.purchasePaid + paid.serviceFee, 30);
  assert.equal(sim.state.clinical!.stock[site.id].consumedUnits, 1);
  const h = hygiene(sim)!; assert.equal(h.batches.length, 2); assert.equal(h.batches.reduce((sum, batch) => sum + batch.generatedUnits, 0), 2);
  assert.equal(publicBatch(sim, order).patientId, person.id); assert.equal(h.batches.filter(batch => batch.sourceKind === undefined).length, 1); assert.deepEqual(h.clinicalBaseline, {});
  assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(context);
});

test('controlled existing YV1 receives actual public nursing and original contaminated source without a cure', () => {
  const context = prepare(), { sim, order } = context;
  seedControlledYV1Source(sim, 'player', 'controlled public-care source; not a default outbreak');
  const episode = sim.state.pathology!.episodes.player, original = { infectiousFrom: episode.infectiousFrom, infectiousUntil: episode.infectiousUntil, recoveryAt: episode.recoveryAt, immuneUntil: episode.immuneUntil, rootReceiptId: episode.rootReceiptId };
  finish(context); const batch = publicBatch(sim, order), receipt = episode.supportReceipts[0];
  assert.equal(batch.hazard, 'YV1'); assert.equal(batch.pathogenSource!.episodeId, episode.id); assert.equal(batch.pathogenSource!.contaminatedAt, order.healthConsumptions![0].consumedAt);
  assert.equal(receipt.kind, 'public-health'); assert.equal(receipt.orderId, order.id); assert.equal(receipt.minutes, 20); assert.equal(episode.symptomRelief, 15);
  assert.deepEqual({ infectiousFrom: episode.infectiousFrom, infectiousUntil: episode.infectiousUntil, recoveryAt: episode.recoveryAt, immuneUntil: episode.immuneUntil, rootReceiptId: episode.rootReceiptId }, original);
  assert.equal(episode.discoveredAt, null); restore24(context);
});

test('public waste uses the existing funded disinfection and retains both sealed units after ten paid minutes', () => {
  const context = prepare(), { sim, order, doctor } = context; finish(context);
  const batch = publicBatch(sim, order), total = cash(sim), wallet = sim.state.player.money;
  const result = sim.command({ type: 'disinfectWaste', targetId: batch.id }); assert.equal(result.ok, true, result.message);
  const job = sim.state.hygiene!.jobs.at(-1)!; assert.equal(job.funded, 20); assert.equal(sim.state.player.money, wallet - 20); assert.equal(job.workedMinutes, 0);
  for (let tick = 0; job.completedAt === null && tick < 30; tick++) sim.step(.25);
  assert.equal(job.state, 'completed', job.reason); assert.equal(job.workedMinutes, 10); assert.equal(job.staffMinutes[doctor.id], 10);
  assert.equal(job.consumedUnits, 1); assert.equal(job.receivedUnits, 1); assert.ok(job.purchasePaid > 0); assert.equal(job.receipt!.quantity, 1);
  assert.equal(job.funded, job.purchasePaid + job.refunded); assert.equal(job.escrow, 0);
  assert.equal(batch.generatedUnits, 1); assert.equal(batch.contaminatedUnits, 0); assert.equal(batch.sealedUnits, 1); assert.equal(batch.cleaningResidualUnits, 1); assert.equal(batch.containedUnits, 2);
  assert.equal(order.consumedUnits, 1); assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(context);
});

test('forged public consumption, generic health, education and transport events create neither waste nor nursing', () => {
  const context = prepare(), { sim, site, order } = context;
  seedControlledYV1Source(sim, 'player', 'controlled negative event source');
  const before = sim.exportSave();
  for (const type of ['public-health-consumed', 'civic-service', 'health-change', 'clinical-completed', 'education-completed', 'transport-maintained']) {
    sim.emitEvent({ type, citizenId: 'player', siteId: site.id, procurementId: order.id, budgetId: `public-health:${order.id}:1`, quantity: 1, minutes: 20, occurredAt: at(sim) });
  }
  assert.equal(sim.exportSave(), before); assert.equal(hygiene(sim), undefined); assert.equal(order.healthWasteVersion, undefined); assert.equal(sim.state.pathology!.episodes.player.symptomRelief, 0);
});

test('replaying the real source event, copying it, and replaying it after load cannot duplicate a unit', () => {
  const context = prepare(), { sim, order } = context;
  seedControlledYV1Source(sim, 'player', 'controlled replay source');
  const events: Parameters<Simulation['emitEvent']>[0][] = [];
  sim.onEvent('public-health-consumed', event => events.push(event)); finish(context);
  assert.equal(events.length, 1); const event = events[0], saved = sim.exportSave();
  sim.emitEvent(event); sim.emitEvent({ ...event }); assert.equal(sim.exportSave(), saved);
  const copy = new Simulation(sim.worldDefinition), loaded = copy.importSave(saved); assert.equal(loaded.ok, true, loaded.message); assert.equal(copy.exportSave(), saved);
  copy.emitEvent(event); assert.equal(copy.exportSave(), saved);
  assert.equal(publicBatch(sim, order).generatedUnits, 1); assert.equal(sim.state.pathology!.episodes.player.supportReceipts.length, 1);
});

test('public source/order/site/floor/beneficiary and waste/support references reject atomically', () => {
  const context = prepare(), { sim } = context; seedControlledYV1Source(sim, 'player', 'controlled save reference source'); finish(context);
  for (const [label, change] of [
    ['partial marker', (d: any) => { delete d.state.culture.orders[0].healthConsumptionBaseline; }],
    ['wrong topic', (d: any) => { d.state.culture.orders[0].healthWasteVersion = 2; }],
    ['bad actor', (d: any) => { d.state.culture.orders[0].healthConsumptions[0].patientId = 'citizen-missing'; }],
    ['bad index', (d: any) => { d.state.culture.orders[0].healthConsumptions[0].consumptionIndex = 2; }],
    ['future source', (d: any) => { d.state.culture.orders[0].healthConsumptions[0].consumedAt += 1; }],
    ['wrong floor', (d: any) => { d.state.culture.orders[0].healthConsumptions[0].point.y += 3.8; }],
    ['bad source', (d: any) => { d.state.hygiene.batches[0].sourceReceipts[0].sourceId = 'public-health:service-999:1'; }],
    ['wrong waste beneficiary', (d: any) => { d.state.hygiene.batches[0].sourceReceipts[0].patientId = 'citizen-1'; }],
    ['missing waste body', (d: any) => { delete d.state.hygiene; delete d.runtime.hygieneVersion; d.runtime.persistedModules = d.runtime.persistedModules.filter((m: string) => m !== 'hygiene'); }],
    ['missing waste unit', (d: any) => { d.state.hygiene.batches = []; d.state.hygiene.nextBatchId = 1; }],
    ['public archive placeholder', (d: any) => {
      const order = d.state.culture.orders[0]; delete order.healthWasteVersion; delete order.healthConsumptionBaseline; delete order.healthConsumptions;
      const batch = d.state.hygiene.batches[0]; batch.sourceReceipts = []; batch.sourceArchive = { count: 1, firstOrderId: 'clinical-999', lastOrderId: 'clinical-999', firstAt: batch.firstAt, lastAt: batch.lastAt };
      const episode = d.state.pathology.episodes.player; episode.supportReceipts = []; episode.symptomRelief = 0;
    }],
    ['wrong support source', (d: any) => { d.state.pathology.episodes.player.supportReceipts[0].sourceId = 'public-health:service-999:1'; }],
  ] as const) reject(sim, label, change);
  restore24(context);
});

test('partial public care imports without new fields and completes through identical twenty-four future ticks', () => {
  const context = prepare(), { sim, order } = context; attend(context); advance(sim, 4);
  assert.equal(order.serviceMinutes.player, 4); assert.equal(order.consumedUnits, 0); assert.equal(order.healthWasteVersion, undefined); assert.equal(hygiene(sim), undefined);
  restore24(context); const current = sim.state.culture!.orders.find(item => item.id === order.id)!;
  assert.equal(current.consumedUnits, 1); assert.equal(publicBatch(sim, current).generatedUnits, 1);
});

// An actual ORIGINAL-source pending is captured only when that source is run
// with the explicit writer path. Candidate import never manufactures history.
test('old public source writer captures actual fulfilled care without backfilling a receipt', { skip: !process.env.YUNSHAN_PUBLIC_HEALTH_OLD_WRITE_DIR }, () => {
  const context = prepare(); finish(context);
  assert.equal(context.order.healthWasteVersion, undefined, 'writer must run against the original runtime'); assert.equal(hygiene(context.sim), undefined);
  const directory = process.env.YUNSHAN_PUBLIC_HEALTH_OLD_WRITE_DIR!; mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'old-public-care-save.json'), context.sim.exportSave());
  writeFileSync(join(directory, 'old-public-care-controls.json'), JSON.stringify([...context.controls]));
});

test('actual old-origin care stays byte-identical, and only a future public patient creates new waste', { skip: !process.env.YUNSHAN_PUBLIC_HEALTH_OLD_READ_DIR }, () => {
  const directory = process.env.YUNSHAN_PUBLIC_HEALTH_OLD_READ_DIR!, context = prepare(), { sim, controls, site, doctor } = context;
  const saved = readFileSync(join(directory, 'old-public-care-save.json'), 'utf8'), imported = sim.importSave(saved);
  assert.equal(imported.ok, true, imported.message); assert.equal(sim.exportSave(), saved); assert.equal(hygiene(sim), undefined);
  controls.clear(); for (const [id, control] of JSON.parse(readFileSync(join(directory, 'old-public-care-controls.json'), 'utf8'))) controls.set(id, control);
  const order = sim.state.culture!.orders[0], previous = order.consumedUnits; assert.equal(previous, 1); assert.equal(order.healthWasteVersion, undefined);
  const person = sim.state.citizens.find(person => person.id !== doctor.id && !['官员', '医生'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  pin(sim, controls, person.id, site, station(site, 0)); sim.state.extension!.actorProfiles[person.id].health = 70;
  advance(sim, 20); assert.equal(order.consumedUnits, previous + 1); assert.equal(order.healthConsumptionBaseline, previous); assert.equal(order.healthConsumptions!.length, 1);
  assert.equal(publicBatch(sim, order).patientId, person.id); assert.equal(hygiene(sim)!.batches.length, 1); restore24({ ...context, order });
});

function incubatingPublicCare() {
  const context = prepare(), { sim, site, doctor, controls, order } = context;
  // This case intentionally isolates two manual material/contact contracts.
  // The public-care approval is already real; reviewers return home so the
  // new autonomous housekeeping does not consume the pending manual units.
  for (const person of sim.state.citizens.filter(person => ['官员', '财政官', 'official', '议员', 'council'].includes(person.role))) {
    const home = sim.worldDefinition.buildings.find(site => site.id === person.homeId)!; pin(sim, controls, person.id, home, home.door);
  }
  assert.ok(seedControlledYV1Source(sim, 'player', 'controlled primary source for actual incubating public care'));
  finish(context); advance(sim, sim.state.clinical!.nextVisitAt.player - at(sim));
  const paid = begin(sim, site); for (let tick = 0; paid.state !== 'completed' && tick < 30; tick++) sim.step(.25);
  assert.equal(paid.state, 'completed', paid.lastReason);
  const batches = sim.state.hygiene!.batches.slice(); assert.equal(batches.length, 2); assert.ok(batches.every(batch => batch.hazard === 'YV1'));
  for (const batch of batches) {
    const started = sim.command({ type: 'disinfectWaste', targetId: batch.id }); assert.equal(started.ok, true, started.message);
    const job = sim.state.hygiene!.jobs.at(-1)!;
    for (let tick = 0; job.completedAt === null && tick < 30; tick++) sim.step(.25);
    assert.equal(job.state, 'completed', job.reason); assert.equal(job.workedMinutes, 10); assert.equal(job.staffMinutes[doctor.id], 10);
  }
  const episode = sim.state.pathology!.episodes[doctor.id];
  assert.ok(episode); assert.equal(episode.origin, 'waste-contact'); assert.equal(episode.phase, 'incubating'); assert.equal(episode.exposureReceipts.reduce((sum, receipt) => sum + receipt.effectiveDose, 0), 5);
  const second = sim.state.citizens.find(person => person.id !== doctor.id && person.workId === site.id && ['医生', 'doctor'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18 && sim.state.extension!.actorProfiles[person.id].health >= 45);
  assert.ok(second, 'the constructor must supply the other existing adult doctor');
  assert.ok(sim.state.extension!.actorProfiles[doctor.id].health < 95, 'the incubating patient retains its real generic public-care need');
  pin(sim, controls, doctor.id, site, station(site, 0), 'social'); pin(sim, controls, second.id, site, station(site, 0), 'work');
  advance(sim, 20); assert.ok(order.servedIds.includes(doctor.id)); assert.equal(order.serviceMinutes[doctor.id], 20);
  const source = order.healthConsumptions!.find(receipt => receipt.patientId === doctor.id)!;
  assert.ok(source); assert.ok(source.consumedAt >= episode.exposedAt && source.consumedAt < episode.infectiousFrom);
  assert.equal(episode.phase, 'incubating'); assert.equal(episode.supportReceipts.length, 0); assert.equal(episode.symptomRelief, 0);
  return { ...context, episode, source };
}

test('actual incubating public care cannot import forged symptomatic nursing even with a real consumption source', () => {
  // Controlled seed/standing only. Two real material-backed ten-paid-minute
  // handling jobs produce incubation; a second original doctor provides real
  // public care before symptoms. Only the bad-save assertion mutates authority.
  const context = incubatingPublicCare(), { sim, doctor, source } = context;
  const valid = sim.exportSave(), imported = sim.importSave(valid);
  assert.equal(imported.ok, true, imported.message); assert.equal(sim.exportSave(), valid);
  reject(sim, 'incubating public source cannot credit symptomatic/recovery support', data => {
    const e = data.state.pathology.episodes[doctor.id]; e.symptomRelief = 15;
    e.supportReceipts.push({ kind: 'public-health', sourceId: source.id, orderId: source.orderId, siteId: source.siteId, completedAt: source.consumedAt, publicConsumptionIndex: source.consumptionIndex, consumedUnits: 1, minutes: 20, relief: 15 });
  });
  restore24(context);
});

test('legal historical public nursing survives a later real lifecycle death and exact save continuation', () => {
  const context = prepare(), { sim } = context;
  assert.ok(seedControlledYV1Source(sim, 'player', 'controlled source for later-death historical nursing'));
  finish(context); const episode = sim.state.pathology!.episodes.player, support = JSON.stringify(episode.supportReceipts);
  assert.equal(episode.supportReceipts.length, 1); assert.equal(episode.symptomRelief, 15);
  const receipt = episode.supportReceipts[0]; assert.ok(receipt.completedAt >= episode.infectiousFrom && receipt.completedAt < episode.recoveryAt);
  // Explicit health-zero input isolates core life/estate processing. It does
  // not fabricate a death flag, episode phase or historical nursing receipt.
  sim.state.extension!.actorProfiles.player.health = 0; sim.step(.25);
  assert.equal(sim.state.extension!.actorProfiles.player.alive, false); assert.equal(episode.phase, 'dead'); assert.equal(JSON.stringify(episode.supportReceipts), support);
  restore24(context); assert.equal(JSON.stringify(sim.state.pathology!.episodes.player.supportReceipts), support);
});
