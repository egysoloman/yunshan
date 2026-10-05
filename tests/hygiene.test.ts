import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation.ts';
import type { Building, BuildingKind, WorldDefinition } from '../src/types.ts';
import { beginDisinfection, type HygieneState } from '../src/simulation/hygiene.ts';
import { clinicalDoctorWorkWindows, clinicalDoctorUsedWorkWindows } from '../src/simulation/clinical.ts';
import { recordWasteContact, seedControlledYV1Source, yv1DoseInWindow, YV1_RULES } from '../src/simulation/pathology.ts';
import { settleDeceasedAccount } from '../src/simulation/banking.ts';
import { partitionSave, assembleSave } from '../src/persistence/partition.ts';
import { advance, at, begin, cash as existingCash, setup, pin, station, attachControls, runtime } from './clinical-presence-fixture.ts';
import { finitePublicShift, restrictRemainingShift, fixture as educationWorld } from './education-fixture.ts';
import { assertSupplied, beginNativeNpcOrder, initialIntent, nativeContext } from './clinical-arrival-fixture.ts';

// Existing M1 native-employment fixture deliberately controls standing positions
// and needs. It still executes real payroll/allowance/stock/finance; these cases
// do not claim natural commuting, ordinary controls or default-city outbreaks.
const cash = (sim: Simulation) => existingCash(sim) + (sim.state.hygiene?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0) + (sim.state.education?.course?.escrow ?? 0) + (sim.state.power?.repairs.reduce((sum, job) => sum + job.escrow, 0) ?? 0);
const currentHygiene = (simulation: Simulation): HygieneState | undefined => simulation.state.hygiene;
function completeCare(context: ReturnType<typeof setup>, patientId = 'player') { const order = begin(context.sim, context.site, patientId); for (let tick = 0; order.state !== 'completed' && tick < 1000; tick++) context.sim.step(.25); assert.equal(order.state, 'completed', order.lastReason); return order; }
function completeCleaning(sim: Simulation, id: string) { const job = sim.state.hygiene!.jobs.find(job => job.id === id)!; for (let tick = 0; job.completedAt === null && tick < 1000; tick++) sim.step(.25); assert.equal(job.state, 'completed', job.reason); return job; }
function start(context: ReturnType<typeof setup>, batchId = context.sim.state.hygiene!.batches[0].id) { const result = context.sim.command({ type: 'disinfectWaste', targetId: batchId }); assert.equal(result.ok, true, result.message); return context.sim.state.hygiene!.jobs.at(-1)!; }
function restore24(context: ReturnType<typeof setup>) { const { sim, controls } = context, saved = sim.exportSave(), next = new Simulation(sim.worldDefinition), loaded = next.importSave(saved); assert.equal(loaded.ok, true, loaded.message); assert.equal(next.exportSave(), saved); attachControls(next, controls); for (let tick = 0; tick < 24; tick++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), `completed-tick continuation ${tick + 1}`); } }
function reject(sim: Simulation, mutate: (data: any) => void) { const before = sim.exportSave(), data = JSON.parse(before); mutate(data); const result = sim.importSave(JSON.stringify(data)); assert.equal(result.ok, false, 'malformed authority must be rejected'); assert.equal(sim.exportSave(), before, 'rejected save is atomic'); }

test('native partial treatment restored before first waste keeps actual activation and twenty-four future ticks byte-identical', () => {
  // One declared native initial route intent, without phase hooks or persistent
  // controls; both instances then use the original people/payroll/finance paths.
  const context = nativeContext(), { sim, doctor, site, point } = context;
  initialIntent(sim, doctor, site, point.position, 'work');
  const order = beginNativeNpcOrder(context);
  sim.step(.25); assertSupplied(order);
  sim.step(.25); assert.equal(order.workedMinutes, 4);
  assert.equal(order.consumedUnits, 0); assert.equal(sim.state.clinical!.stock[site.id].consumedUnits, 0);
  assert.equal(sim.state.hygiene, undefined); assert.equal(sim.state.pathology, undefined);
  const saved = sim.exportSave(), copy = new Simulation(sim.worldDefinition), loaded = copy.importSave(saved);
  assert.equal(loaded.ok, true, loaded.message); assert.equal(copy.exportSave(), saved);
  let observedFirstWaste = false;
  for (let tick = 0; tick < 24; tick++) {
    sim.step(.25); copy.step(.25);
    assert.equal(copy.exportSave(), sim.exportSave(), `native pre-waste continuation ${tick + 1}`);
    const hygiene = currentHygiene(sim);
    if (hygiene && !observedFirstWaste) {
      observedFirstWaste = true;
      assert.equal(order.state, 'completed'); assert.equal(order.workedMinutes, 20); assert.equal(order.consumedUnits, 1);
      const batches = hygiene.batches.filter(batch => batch.sourceReceipts.some(receipt => receipt.orderId === order.id));
      assert.equal(batches.length, 1); assert.equal(batches[0].generatedUnits, 1);
      assert.deepEqual(hygiene.clinicalBaseline, {});
      assert.deepEqual(copy.state.hygiene!.clinicalBaseline, {});
    }
  }
  assert.equal(observedFirstWaste, true, 'actual clinical consumption must activate hygiene during the continuation');
});

test('generic health change and repeated completion events cannot create waste or YV1', () => {
  const context = setup(), { sim, site } = context;
  assert.equal(sim.state.hygiene, undefined); assert.equal(sim.state.pathology, undefined);
  sim.state.extension!.actorProfiles.player.health = 40; advance(sim, 4); assert.equal(sim.state.hygiene, undefined); assert.equal(sim.state.pathology, undefined);
  sim.emitEvent({ type: 'clinical-completed', citizenId: 'player', siteId: site.id, procurementId: 'clinical-missing', quantity: 1 }); assert.equal(sim.state.hygiene, undefined);
  const order = completeCare(context), h = sim.state.hygiene!, snapshot = sim.exportSave();
  assert.equal(h.batches.length, 1); assert.equal(h.batches[0].generatedUnits, 1); assert.equal(h.batches[0].hazard, 'used-material'); assert.equal(sim.state.pathology, undefined);
  sim.emitEvent({ type: 'clinical-completed', citizenId: 'player', siteId: site.id, procurementId: order.id, quantity: 1 }); assert.equal(sim.exportSave(), snapshot);
});

test('one real clinical consumption becomes one named, station-held waste unit; separate material and wages retain two sealed units', () => {
  const context = setup(), { sim, site, doctor } = context, before = cash(sim); const order = completeCare(context), batch = sim.state.hygiene!.batches[0];
  assert.equal(batch.sourceReceipts[0].orderId, order.id); assert.equal(batch.pointId, site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'service')!.id); assert.equal(batch.contaminatedUnits, 1);
  const money = sim.state.player.money, job = start(context); assert.equal(sim.state.player.money, money - 20); assert.equal(job.workedMinutes, 0);
  const wageMinutes: number[] = []; sim.onEvent('wage-earned', event => { if (event.citizenId === doctor.id) wageMinutes.push(event.minutes ?? 0); });
  completeCleaning(sim, job.id);
  assert.equal(job.workedMinutes, 10); assert.equal(job.consumedUnits, 1); assert.equal(job.staffMinutes[doctor.id], 10); assert.ok(wageMinutes.reduce((sum, minutes) => sum + minutes, 0) >= 10 - 1e-7);
  assert.equal(job.funded, job.purchasePaid + job.refunded); assert.equal(job.escrow, 0); assert.equal(batch.contaminatedUnits, 0); assert.equal(batch.sealedUnits, 1); assert.equal(batch.cleaningResidualUnits, 1); assert.equal(batch.generatedUnits + batch.cleaningResidualUnits, 2); assert.equal(batch.containedUnits, 2);
  assert.ok(Math.abs(cash(sim) - before) < 1e-5, 'all existing accounts, tax and both escrows conserve actual cash');
  assert.equal(assembleSave(partitionSave(sim.exportSave(), sim.worldDefinition)), sim.exportSave()); restore24(context);
});

test('cancellation preserves original contamination, actual purchased stock and earned history without repeated refunds', () => {
  const context = setup(), { sim } = context; completeCare(context); const before = cash(sim), batch = sim.state.hygiene!.batches[0], job = start(context);
  advance(sim, 6); assert.ok(job.purchasePaid > 0 && job.workedMinutes > 0 && job.workedMinutes < 10); const earned = job.workedMinutes;
  const cancelled = sim.command({ type: 'cancelDisinfection', targetId: job.id }); assert.equal(cancelled.ok, true, cancelled.message);
  assert.equal(job.state, 'cancelled'); assert.equal(job.workedMinutes, earned); assert.equal(batch.contaminatedUnits, 1); assert.equal(batch.reservedUnits, 0); assert.equal(batch.sealedUnits, 0); assert.equal(sim.state.hygiene!.stock[batch.siteId].availableUnits, 1); assert.equal(job.consumedUnits, 0); assert.ok(Math.abs(cash(sim) - before) < 1e-5);
  const after = sim.exportSave(); assert.equal(sim.command({ type: 'cancelDisinfection', targetId: job.id }).ok, false); assert.equal(sim.exportSave(), after);
  const reuse = start(context); assert.equal(reuse.reusedUnits, 1); assert.equal(reuse.workedMinutes, 0); completeCleaning(sim, reuse.id); assert.equal(reuse.receivedUnits, 0); assert.equal(reuse.purchasePaid, 0); assert.equal(reuse.refunded, 20); assert.equal(batch.sealedUnits, 1); restore24(context);
});

test('missing supply, another floor, death or aggregate energy loss cannot manufacture processing minutes', () => {
  for (const mode of ['supply', 'floor', 'dead', 'energy'] as const) {
    const context = setup(), { sim, site, doctor, controls } = context; completeCare(context); const job = start(context);
    if (mode === 'supply') sim.onPhase('traffic', () => { for (const shop of sim.state.shops) if (sim.shopCommodity(shop) === 'materials') shop.inventory = 0; });
    if (mode === 'floor') pin(sim, controls, doctor.id, site, station(site, 1), 'work');
    if (mode === 'dead') sim.state.extension!.actorProfiles[doctor.id].health = 0;
    if (mode === 'energy') sim.onPhase('traffic', () => { sim.state.districts.find(d => d.id === site.districtId)!.energy = 0; });
    advance(sim, 12); assert.equal(job.workedMinutes, 0); assert.equal(job.consumedUnits, 0); assert.equal(sim.state.hygiene!.batches[0].sealedUnits, 0); assert.equal(sim.state.hygiene!.batches[0].contaminatedUnits, 1);
  }
});

test('real front wage windows subtract the medical tail before hygiene; no invented clock-minus-work suffix', () => {
  const context = setup(), { sim, doctor, site } = context; completeCare(context); const job = start(context); advance(sim, 2);
  sim.onPhase('people', (_state, minutes) => { const wage = clinicalDoctorWorkWindows(sim, doctor, site.id, minutes), covered = clinicalDoctorUsedWorkWindows(sim, doctor.id); for (const range of covered) assert.ok(wage.some(item => item.start <= range.start && item.end >= range.end)); });
  advance(sim, 4); const period = job.staffWindows[doctor.id]; assert.ok(period && period.workedMinutes === job.staffMinutes[doctor.id]); assert.ok(period.workedMinutes <= period.endedAt - period.startedAt + 1e-7);
  // Strong late-arrival and capped-front fixtures are added after M2's actual
  // source has been integrated. This case alone is not late-arrival evidence.
});

for (const backlog of [60, 0]) test(`controlled finite native public shift with ${backlog} old minutes credits only its original funded front`, () => {
  const context = setup(), { sim, doctor, site } = context;
  // Reuse the actual reviewers/finite public approval and equal-counterparty
  // cash transfer contract. This is a controlled fiscal/deadline boundary.
  const plan = finitePublicShift({ ...context, teacher: doctor, earned: () => ({ minutes: runtime(sim).attendance[doctor.id] ?? 0, amount: runtime(sim).wageAccruals.find((claim: { citizenId: string }) => claim.citizenId === doctor.id)?.amount ?? 0 }) });
  completeCare(context); const job = start(context); advance(sim, 2); assert.equal(job.reservedUnits, 1); assert.equal(job.workedMinutes, 0);
  assert.ok(Number.isInteger(plan.assignment.workedMinutes)); const beforeCash = cash(sim); restrictRemainingShift(plan, 2); assert.equal(cash(sim), beforeCash);
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true); runtime(sim).peopleElapsed ??= {}; runtime(sim).peopleElapsed[doctor.id] = backlog;
  const attendance = runtime(sim).attendance[doctor.id], wages: { start: number; end: number; minutes: number }[] = [];
  sim.onEvent('wage-earned', event => { if (event.citizenId === doctor.id) { assert.ok(typeof event.creditedWorkStartAt === 'number' && typeof event.creditedWorkEndAt === 'number' && typeof event.minutes === 'number'); wages.push({ start: event.creditedWorkStartAt, end: event.creditedWorkEndAt, minutes: event.minutes }); } });
  sim.step(.25); assert.ok(Math.abs(runtime(sim).attendance[doctor.id] - attendance - 2) < 1e-7); assert.equal(wages.length, 1); assert.equal(wages[0].minutes, 2); assert.equal(wages[0].end - wages[0].start, 2); assert.equal(sim.isOnDuty(doctor.id, site.id), false);
  if (backlog) { assert.ok(wages[0].end <= at(sim) - 4); assert.equal(job.workedMinutes, 0); assert.equal(job.staffWindows[doctor.id], undefined); }
  else { assert.equal(job.workedMinutes, 2); assert.equal(job.staffWindows[doctor.id].startedAt, wages[0].start); assert.equal(job.staffWindows[doctor.id].endedAt, wages[0].end); assert.equal(job.staffWindows[doctor.id].workedMinutes, 2); }
  assert.equal(job.consumedUnits, 0); restore24(context);
});

test('two separate real waste orders cannot import the same two-minute doctor envelope twice', () => {
  const context = setup(), { sim, site, doctor, controls } = context; completeCare(context);
  const patient = sim.state.citizens.find(person => person.id !== doctor.id && !['医生', '学生'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  pin(sim, controls, patient.id, site, station(site, 0)); sim.state.extension!.actorProfiles[patient.id].health = 50; completeCare(context, patient.id);
  const first = start(context, sim.state.hygiene!.batches[0].id), second = start(context, sim.state.hygiene!.batches[1].id); advance(sim, 4);
  assert.equal(first.workedMinutes, 2); assert.equal(second.workedMinutes, 0); const period = first.staffWindows[doctor.id]; assert.equal(period.endedAt - period.startedAt, 2);
  reject(sim, data => { const job = data.state.hygiene.jobs.find((job: { id: string }) => job.id === second.id); job.workedMinutes = 2; job.staffMinutes[doctor.id] = 2; job.staffWindows[doctor.id] = { ...period }; data.state.hygiene.stats.workedMinutes += 2; }); restore24(context);
});

test('nine actual treatment consumptions preserve overflow instead of deleting waste from an eight-unit station', () => {
  const context = setup(), { sim, controls, site, doctor } = context;
  const patients = sim.state.citizens.filter(person => person.id !== doctor.id && !['医生', '学生'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 9); assert.equal(patients.length, 9);
  for (const patient of patients) { pin(sim, controls, patient.id, site, station(site, 0)); sim.state.extension!.actorProfiles[patient.id].health = 50; completeCare(context, patient.id); }
  const batches = sim.state.hygiene!.batches; assert.equal(batches.reduce((sum, batch) => sum + batch.generatedUnits, 0), 9); assert.equal(batches.reduce((sum, batch) => sum + batch.containedUnits, 0), 8); assert.equal(batches.reduce((sum, batch) => sum + batch.generatedUnits + batch.cleaningResidualUnits - batch.containedUnits, 0), 1); assert.equal(sim.state.clinical!.stock[site.id].consumedUnits, 9); restore24(context);
});

test('two protected actual waste-handling jobs create traceable exposure then incubation; generic health is a separate state', () => {
  const context = setup(), { sim, doctor } = context, source = seedControlledYV1Source(sim, 'player', 'controlled YV1 origin for real handling chain'); assert.ok(source);
  completeCare(context); advance(sim, 60); sim.state.extension!.actorProfiles.player.health = 50; completeCare(context);
  const [batch, laterBatch] = sim.state.hygiene!.batches; assert.equal(batch.generatedUnits, 1); assert.equal(laterBatch.generatedUnits, 1); assert.equal(batch.hazard, 'YV1'); assert.equal(laterBatch.hazard, 'YV1'); assert.notEqual(batch.pathogenSource!.contaminatedAt, laterBatch.pathogenSource!.contaminatedAt);
  const first = start(context); completeCleaning(sim, first.id); assert.equal(sim.state.pathology!.episodes[doctor.id], undefined);
  const second = start(context, laterBatch.id); completeCleaning(sim, second.id); const episode = sim.state.pathology!.episodes[doctor.id]; assert.ok(episode);
  assert.equal(episode.origin, 'waste-contact'); assert.equal(episode.phase, 'incubating'); assert.equal(episode.exposureReceipts.reduce((sum, receipt) => sum + receipt.effectiveDose, 0), YV1_RULES.infectiousDose); assert.equal(episode.infectiousFrom, episode.exposedAt + YV1_RULES.incubationMinutes); assert.equal(episode.rootReceiptId, source.rootReceiptId);
  assert.ok(episode.exposureReceipts.every(receipt => receipt.siteId === batch.siteId && receipt.floor === batch.floor && receipt.pointId === batch.pointId && (receipt.operationId === first.id || receipt.operationId === second.id)));
  const health = sim.state.extension!.actorProfiles[doctor.id].health; assert.ok(health > 45); advance(sim, YV1_RULES.incubationMinutes); assert.equal(episode.phase, 'symptomatic'); assert.equal(episode.severity, 40); assert.equal(episode.discoveredAt, null); restore24(context);
});

for (const speed of [.25, 1, 16]) test(`real protected contact dose survives complete ${speed}x time slices without losing its 60-minute window`, () => {
  const context = setup(), { sim, doctor } = context; assert.ok(seedControlledYV1Source(sim, 'player', 'controlled source for speed-invariant actual handling'));
  completeCare(context); advance(sim, 60); sim.state.extension!.actorProfiles.player.health = 50; completeCare(context);
  assert.equal(sim.command({ type: 'speed', value: speed }).ok, true);
  const [firstBatch, secondBatch] = sim.state.hygiene!.batches;
  const first = start(context, firstBatch.id); completeCleaning(sim, first.id);
  assert.equal(sim.state.pathology!.episodes[doctor.id], undefined);
  const pending = sim.state.pathology!.pendingDose[doctor.id]; assert.ok(pending.length > 0); assert.ok(Math.abs(pending.reduce((sum, receipt) => sum + receipt.effectiveDose, 0) - 2.5) < 1e-7);
  reject(sim, data => { data.state.pathology.pendingDose[doctor.id].push({ ...data.state.pathology.pendingDose[doctor.id][0] }); });
  const second = start(context, secondBatch.id); completeCleaning(sim, second.id);
  const episode = sim.state.pathology!.episodes[doctor.id]; assert.ok(episode); assert.equal(episode.phase, 'incubating'); assert.ok(Math.abs(episode.exposureReceipts.reduce((sum, receipt) => sum + receipt.effectiveDose, 0) - 5) < 1e-7);
  assert.equal(episode.exposureReceipts.reduce((sum, receipt) => sum + receipt.endAt - receipt.startAt, 0), 20);
  reject(sim, data => { data.state.pathology.episodes[doctor.id].exposureReceipts.push({ ...data.state.pathology.episodes[doctor.id].exposureReceipts[0] }); });
  reject(sim, data => { const r = data.state.pathology.contacts[0]; r.protectionFactor = 1; r.effectiveDose *= 4; data.state.pathology.stats.contactDose += r.effectiveDose * .75; });
  restore24(context);
});

test('a direct contact observer or stale imported phase has no certified actual hygiene work', () => {
  const context = setup(), { sim, doctor } = context; assert.ok(seedControlledYV1Source(sim, 'player', 'controlled source for contact authority'));
  completeCare(context); const batch = sim.state.hygiene!.batches[0], job = start(context); advance(sim, 2); assert.equal(job.reservedUnits, 1); assert.equal(job.workedMinutes, 0);
  const before = sim.exportSave(); recordWasteContact(sim, doctor.id, batch, job.id, at(sim) - 2, at(sim), .25); assert.equal(sim.exportSave(), before);
  advance(sim, 2); assert.equal(job.workedMinutes, 2);
  const receipt = sim.state.pathology!.contacts[0], next = new Simulation(sim.worldDefinition); assert.equal(next.importSave(sim.exportSave()).ok, true); const loaded = next.exportSave();
  recordWasteContact(next, doctor.id, next.state.hygiene!.batches[0], job.id, receipt.startAt, receipt.endAt, .25); assert.equal(next.exportSave(), loaded);
});

test('a genuine four-minute contact keeps its three still-valid minutes at the rolling-window boundary', () => {
  const context = setup(), { sim } = context; assert.ok(seedControlledYV1Source(sim, 'player', 'controlled source for exact rolling-window projection')); completeCare(context);
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true); const job = start(context); advance(sim, 8); assert.equal(job.workedMinutes, 4);
  const receipt = sim.state.pathology!.contacts[0], unchanged = JSON.stringify(receipt); assert.equal(receipt.endAt - receipt.startAt, 4);
  // Read-only projection of the authentic receipt. This synthetic inquiry time
  // does not advance the city or manufacture another contact/episode.
  assert.equal(yv1DoseInWindow([receipt], receipt.startAt + 61), .75); assert.equal(JSON.stringify(receipt), unchanged); assert.equal(yv1DoseInWindow([receipt], receipt.endAt + 60), 0);
  // Mathematical immunity-cutoff input only, not a forged city history or
  // claimed actual natural reinfection: of a four-minute range, three precede U.
  assert.equal(yv1DoseInWindow([{ ...receipt, susceptibleFrom: receipt.startAt + 3 }], receipt.endAt), .25);
});

test('a genuine prior-episode immunity witness survives contacts, import and 24 ticks without reinfection', () => {
  const context = setup(), { sim, doctor } = context, prior = seedControlledYV1Source(sim, doctor.id, 'controlled prior episode for genuine immunity qualification'); assert.ok(prior);
  assert.ok(seedControlledYV1Source(sim, 'player', 'controlled source for contact during existing immunity')); completeCare(context);
  const job = start(context); completeCleaning(sim, job.id); const contacts = sim.state.pathology!.contacts; assert.ok(contacts.length > 0);
  for (const receipt of contacts) { assert.equal(receipt.immunityWitness!.episodeId, prior.id); assert.equal(receipt.immunityWitness!.immuneUntil, prior.immuneUntil); assert.equal(receipt.susceptibleFrom, prior.immuneUntil); }
  assert.equal(sim.state.pathology!.episodes[doctor.id].id, prior.id); assert.equal(sim.state.pathology!.pendingDose[doctor.id], undefined);
  reject(sim, data => { data.state.pathology.contacts[0].susceptibleFrom = 0; }); reject(sim, data => { for (const receipt of data.state.pathology.contacts) { receipt.immunityWitness = null; receipt.susceptibleFrom = 0; } }); restore24(context);
});

test('fictional symptom burden uses actual intervals and paid clinical support reduces burden without clearing infection', () => {
  const context = setup(), baseline = setup(), { sim } = context, health = sim.state.extension!.actorProfiles.player.health;
  const episode = seedControlledYV1Source(sim, 'player', 'controlled source for real health burden'); assert.ok(episode); assert.equal(sim.state.extension!.actorProfiles.player.health, health);
  advance(sim, 4); advance(baseline.sim, 4); assert.ok(Math.abs(episode.healthBurden - .08) < 1e-7); assert.ok(Math.abs(baseline.sim.state.extension!.actorProfiles.player.health - sim.state.extension!.actorProfiles.player.health - episode.healthBurden) < 1e-7);
  const infectiousUntil = episode.infectiousUntil; const order = completeCare(context); assert.equal(episode.supportReceipts[0].orderId, order.id); assert.equal(episode.symptomRelief, 15); assert.equal(episode.infectiousUntil, infectiousUntil);
  const burden = episode.healthBurden; advance(sim, 4); assert.ok(Math.abs(episode.healthBurden - burden - .05) < 1e-7);
  const observed = episode.burdenObservedAt, realClock = at(sim); assert.equal(sim.command({ type: 'setTime', value: 20 }).ok, true); assert.equal(at(sim), realClock); assert.equal(episode.burdenObservedAt, observed); restore24(context);
});

test('a native deposit funds real borrowing; hygiene escrow delays estate debt loss until the original refund reaches cash', () => {
  const context = setup(), { sim, controls, site, doctor } = context; completeCare(context);
  const bankSite = sim.worldDefinition.buildings.find(site => site.kind === 'bank')!, bank = sim.state.banking!;
  const depositor = sim.state.citizens.find(person => person.id !== doctor.id && !person.partnerId && person.money > 400 && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18 && !bank.accounts[person.id] && at(sim) >= (bank.nextVisitAt[person.id] ?? 0))!; assert.ok(depositor);
  const supply = cash(sim), originalMoney = depositor.money; pin(sim, controls, depositor.id, bankSite, bankSite.door); advance(sim, 2);
  assert.equal(bank.accounts[depositor.id].deposits, 100); assert.ok(depositor.money <= originalMoney - 100 + 1e-7); assert.equal(bank.cash, 100); assert.ok(Math.abs(cash(sim) - supply) < 1e-5);
  sim.setFocus(bankSite.door, 'walk');
  for (const type of ['deposit', 'withdraw'] as const) { const result = sim.command({ type, targetId: bankSite.id, value: 10 }); assert.equal(result.ok, true, result.message); }
  assert.equal(bank.accounts.player.deposits, 0); const loan = sim.command({ type: 'loan', targetId: bankSite.id, value: 50 }); assert.equal(loan.ok, true, loan.message); assert.equal(sim.state.loan, 50);
  sim.setFocus(station(site, 0), 'walk'); const budget = sim.state.player.money, begun = beginDisinfection(sim, sim.state.hygiene!.batches[0].id, budget); assert.equal(begun.ok, true, begun.message); const job = sim.state.hygiene!.jobs.at(-1)!; assert.equal(sim.state.player.money, 0); advance(sim, 4); assert.equal(job.workedMinutes, 2);
  // Controlled death boundary with the original Life/save invariant intact:
  // a dead actor has health0. No funds, account history or heirs are injected.
  const held = job.escrow, earned = job.workedMinutes; sim.state.extension!.actorProfiles.player.health = 0; sim.state.extension!.actorProfiles.player.alive = false;
  const before = cash(sim), estate = settleDeceasedAccount(sim, 'player', []); assert.equal(estate.closed, false); assert.equal(estate.unpaidLoss, 0); assert.equal(bank.stats.losses, 0); assert.equal(sim.state.loan, 50); assert.equal(job.escrow, held);
  advance(sim, 2); assert.equal(job.state, 'cancelled'); assert.equal(job.refunded, held); assert.equal(job.workedMinutes, earned); assert.equal(job.escrow, 0); assert.equal(sim.state.loan, 0); assert.equal(bank.stats.losses, 0); assert.equal(sim.state.family!.estates.player.bankSettlement!.debtPaid, 50); assert.equal(sim.state.family!.estates.player.status, 'awaitingExecutor'); assert.ok(sim.state.player.money > 0, 'without invented heirs the remaining original estate cash stays owned'); assert.ok(Math.abs(cash(sim) - before) < 1e-5);
  restore24(context);
});

test('hygiene module/marker/material/time authority rejects atomically', () => {
  const context = setup(), { sim } = context; completeCare(context); start(context); advance(sim, 4);
  reject(sim, data => { delete data.state.hygiene; }); reject(sim, data => { delete data.runtime.hygieneVersion; }); reject(sim, data => { data.runtime.persistedModules = data.runtime.persistedModules.filter((name: string) => name !== 'hygiene'); });
  reject(sim, data => { data.state.hygiene.batches[0].generatedUnits++; }); reject(sim, data => { data.state.hygiene.batches[0].containedUnits = 9; }); reject(sim, data => { data.state.hygiene.jobs.at(-1).escrow++; }); reject(sim, data => { data.state.hygiene.jobs.at(-1).staffWindows[context.doctor.id].workedMinutes++; });
  assert.equal(assembleSave(partitionSave(sim.exportSave(), sim.worldDefinition)), sim.exportSave()); restore24(context);
});

test('controlled YV1 origin stays explicit, uses real consumed source and changes neither legacy health nor infectious clock on care', () => {
  const context = setup(), { sim } = context, source = seedControlledYV1Source(sim, 'player', 'H2 controlled infectious source; no natural incoming actor'); assert.ok(source);
  const infectiousUntil = source.infectiousUntil, order = completeCare(context), batch = sim.state.hygiene!.batches[0];
  assert.equal(batch.hazard, 'YV1'); assert.equal(batch.pathogenSource!.episodeId, source.id); assert.equal(batch.sourceReceipts[0].orderId, order.id); assert.equal(source.infectiousUntil, infectiousUntil); assert.equal(source.supportReceipts[0].orderId, order.id); assert.equal(source.discoveredAt, null);
  const episodeId = source.id; sim.state.extension!.actorProfiles.player.health = 100; advance(sim, 4); assert.equal(sim.state.pathology!.episodes.player.id, episodeId); assert.equal(sim.state.pathology!.episodes.player.infectiousUntil, infectiousUntil);
  const display = sim.state.pathology!.episodes.player.lastObservedAt; assert.equal(sim.command({ type: 'setTime', value: 20 }).ok, true); assert.equal(sim.state.pathology!.episodes.player.lastObservedAt, display);
  reject(sim, data => { data.state.pathology.sourceReceipts[0].kind = 'city-flight'; }); reject(sim, data => { delete data.runtime.pathologyVersion; }); restore24(context);
  reject(sim, data => { data.state.pathology.lastObservedAt -= 1; }); reject(sim, data => { data.state.pathology.episodes.player.burdenObservedAt -= 1; });
});

test('old genuine clinical save imports without new waste, pathogen body or backfilled historical consumption', () => {
  // Repository-owned original fixture, not an export generated by this H2
  // candidate with the new modules already active.
  const original = readFileSync(new URL('./fixtures/clinical-legacy-heal-ee3e7a1.json', import.meta.url), 'utf8'), source = JSON.parse(original), sim = new Simulation(legacyClinicalWorld());
  assert.equal(source.state.clinical, undefined); assert.equal(source.state.player.money, 570); assert.equal(source.state.extension.actorProfiles.player.health, 75); assert.equal(source.state.extension.runtime.cooldowns['heal:player'], 540);
  const imported = sim.importSave(original); assert.equal(imported.ok, true, imported.message);
  assert.equal(sim.state.hygiene, undefined); assert.equal(sim.state.pathology, undefined); const out = JSON.parse(sim.exportSave()); assert.equal(out.runtime.hygieneVersion, undefined); assert.equal(out.runtime.pathologyVersion, undefined);
  const next = new Simulation(legacyClinicalWorld()); assert.equal(next.importSave(original).ok, true); assert.equal(next.exportSave(), sim.exportSave());
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), `genuine clinical old-save continuation ${tick + 1}`); }
});

test('genuine repository course/research bytes import without empty H2 state and continue exactly for 24 ticks', () => {
  const original = readFileSync(new URL('./fixtures/education-same-start.save.json', import.meta.url), 'utf8');
  const a = new Simulation(educationWorld()), b = new Simulation(educationWorld());
  for (const sim of [a, b]) { const result = sim.importSave(original); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), original); assert.equal(sim.state.hygiene, undefined); assert.equal(sim.state.pathology, undefined); }
  for (let tick = 0; tick < 24; tick++) { a.step(.25); b.step(.25); assert.equal(a.exportSave(), b.exportSave()); assert.equal(a.state.hygiene, undefined); assert.equal(a.state.pathology, undefined); }
});
/** Exact trusted test recipe used by the original clinical.test.ts old-save
 * capture. The genuine old JSON is read unchanged; no body is stripped from a
 * current export, and no current source is used to regenerate that fixture. */
function legacyClinicalWorld(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank', 'hall', 'station'];
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `clinical-${kind}`, name: `诊疗测试${kind}`, kind, districtId: 'clinical-district', position: { x: index * 30, y: 0, z: 0 }, door: { x: index * 30, y: 0, z: 5 }, width: 12, depth: 12, height: 12, floors: 2, rotation: 0, capacity: 100, seed: index }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, name: site.name, districtId: site.districtId, position: { ...site.door }, station: true }));
  return { seed: 20261001, voxelSize: .2, size: 1000, buildings, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `clinical-road-${index}`, mode: 'road', from: nodes[index].id, to: node.id, length: 30, capacity: 20, points: [nodes[index].position, node.position] })), mountains: [], river: [], waterfall: { top: { x: 300, y: 60, z: 100 }, bottom: { x: 300, y: 0, z: 100 }, width: 10 }, districts: [{ id: 'clinical-district', name: '诊疗测试街坊', kind: 'school', center: { x: 120, y: 0, z: 0 }, radius: 500, color: '#aac', population: 384 }], spawn: { ...buildings[0].door } };
}
