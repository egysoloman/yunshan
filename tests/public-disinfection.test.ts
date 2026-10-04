import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Simulation } from '../src/simulation.ts';
import type { Building, Citizen } from '../src/types.ts';
import { fixture, at, advance, begin, cash as originalCash, pin, station, runtime, type Controls } from './clinical-presence-fixture.ts';
import { finitePublicShift, restrictRemainingShift } from './education-fixture.ts';
import { partitionSave, assembleSave } from '../src/persistence/partition.ts';
import { seedControlledYV1Source } from '../src/simulation/pathology.ts';

// Position-only clinical fixture: no money/material/attendance/wage/needs are
// filled. Normal core wages, industrial stock, tax and medical capacity run.
// The explicit initial player injury and standing positions isolate these
// contracts; this is not default commuting or a natural pathogen outbreak.
function attach(sim: Simulation, controls: Controls) {
  const original = Reflect.get(sim, 'setDestination');
  Reflect.set(sim, 'setDestination', (person: Citizen, destination: Building, rebuild = false) => {
    const value = controls.get(person.id);
    if (value?.siteId === destination.id) { person.destinationId = destination.id; person.route = [{ ...value.position }]; person.routeIndex = 1; return; }
    return original.call(sim, person, destination, rebuild);
  });
  sim.onPhase('traffic', () => {
    for (const [id, value] of controls) {
      const person = sim.state.citizens.find(p => p.id === id)!;
      person.position = { ...value.position }; person.destinationId = value.siteId; person.route = [{ ...value.position }]; person.routeIndex = 1;
      runtime(sim).activities[id] = value.activity; runtime(sim).decisionAt[id] = sim.state.day * 1440 + sim.state.hour * 60 + 10;
    }
  });
}
const cash = (sim: Simulation) => originalCash(sim) + (sim.state.hygiene?.jobs.reduce((sum, j) => sum + j.escrow, 0) ?? 0) + (sim.state.education?.course?.escrow ?? 0) + (sim.state.power?.repairs.reduce((sum, j) => sum + j.escrow, 0) ?? 0);
function setup() {
  const sim = new Simulation(fixture()), controls: Controls = new Map(), site = sim.worldDefinition.buildings.find(b => b.kind === 'clinic')!, hall = sim.worldDefinition.buildings.find(b => b.kind === 'hall')!;
  const doctor = sim.state.citizens.find(p => p.workId === site.id && p.role === '医生' && sim.state.extension!.actorProfiles[p.id].age >= 18)!;
  const officials = sim.state.citizens.filter(p => p.workId === hall.id && p.role === '官员' && sim.state.extension!.actorProfiles[p.id].age >= 18).slice(0, 2);
  assert.ok(doctor); assert.equal(officials.length, 2); assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  for (const p of sim.state.citizens) { const home = sim.worldDefinition.buildings.find(b => b.id === p.homeId)!; pin(sim, controls, p.id, home, home.door); }
  pin(sim, controls, doctor.id, site, station(site, 0), 'work'); attach(sim, controls); sim.setFocus(station(site, 0), 'walk');
  sim.state.extension!.actorProfiles.player.health = 50;
  assert.ok(doctor.needs.hunger >= 40 && doctor.needs.fatigue >= 35); advance(sim, 4); assert.equal(sim.isOnDuty(doctor.id, site.id), true);
  return { sim, controls, site, doctor, hall, officials };
}
function waste(yv1 = false) {
  const c = setup(); if (yv1) assert.ok(seedControlledYV1Source(c.sim, 'player', 'controlled initial YV1 for original waste-contact guard'));
  const paid = begin(c.sim, c.site);
  for (let tick = 0; paid.completedAt === null && tick < 40; tick++) c.sim.step(.25);
  assert.equal(paid.state, 'completed', paid.lastReason); assert.equal(paid.consumedUnits, 1);
  const batch = c.sim.state.hygiene!.batches[0]; assert.equal(batch.generatedUnits, 1); assert.equal(batch.contaminatedUnits, 1);
  return { ...c, batch, paid };
}
function demand(c: ReturnType<typeof waste>) {
  advance(c.sim, 2);
  const d = c.sim.state.hygiene?.publicDemands?.[0];
  // Same test bytes against clean 3ca77b8 give a behavior FAIL here, rather
  // than relying on a missing-export/compiler error as the old counterexample.
  assert.ok(d, 'a present actually waged adult doctor must autonomously name the real waste demand');
  assert.equal(d.reporterId, c.doctor.id); assert.equal(d.batchId, c.batch.id); assert.equal(d.state, 'awaitingReview'); return d;
}
function approve(c: ReturnType<typeof waste>, n = 2) { for (const official of c.officials.slice(0, n)) pin(c.sim, c.controls, official.id, c.hall, station(c.hall, 0), 'work'); advance(c.sim, 2); }
function supplied(c: ReturnType<typeof waste>) {
  const d = demand(c); approve(c); assert.equal(d.approvedBy.length, 2); assert.equal(d.authorizedCap, 20);
  advance(c.sim, 2); assert.ok(d.jobId, d.reason); const job = c.sim.state.hygiene!.jobs.find(j => j.id === d.jobId)!;
  assert.equal(job.payerId, 'public'); assert.equal(job.receivedUnits, 1); assert.equal(job.escrow, 0); assert.equal(job.workedMinutes, 0); return { d, job };
}
function restored24(c: ReturnType<typeof waste>) {
  const save = c.sim.exportSave(), next = new Simulation(c.sim.worldDefinition), loaded = next.importSave(save); assert.equal(loaded.ok, true, loaded.message); assert.equal(next.exportSave(), save);
  assert.equal(assembleSave(partitionSave(save, c.sim.worldDefinition)), save); attach(next, c.controls);
  for (let t = 0; t < 24; t++) { c.sim.step(.25); next.step(.25); assert.equal(next.exportSave(), c.sim.exportSave(), `native full-save future ${t + 1}`); }
}
function reject(c: ReturnType<typeof waste>, mutate: (d: any) => void) {
  const save = c.sim.exportSave(), data = JSON.parse(save); mutate(data); const result = c.sim.importSave(JSON.stringify(data)); assert.equal(result.ok, false, 'invalid authority/material/capacity must be rejected'); assert.equal(c.sim.exportSave(), save, 'rejection is atomic');
}
function artifact(name: string, c: ReturnType<typeof waste>) { const folder = process.env.YUNSHAN_HYGIENE_ARTIFACT_DIR ?? 'evidence/artifacts'; mkdirSync(folder, { recursive: true }); writeFileSync(`${folder}/${name}.save.json`, c.sim.exportSave()); }

test('real waste autonomously requests dual approval, purchases one industrial unit and seals after ten remaining paid minutes', () => {
  const c = waste(), before = cash(c.sim), wallet = c.sim.state.player.money, stock = c.sim.state.shops.find(shop => c.sim.shopCommodity(shop) === 'materials')!;
  const inventory = stock.inventory, treasury = c.sim.state.treasury, { d, job } = supplied(c);
  assert.equal(c.sim.state.player.money, wallet, 'public funding never drains or tops up the traveler wallet'); assert.ok(d.spent > 0 && d.spent <= 20); assert.ok(c.sim.state.treasury < treasury); assert.ok(stock.inventory < inventory); assert.equal(d.receipt!.quantity, 1);
  advance(c.sim, 10); assert.equal(job.state, 'completed', job.reason); assert.equal(job.workedMinutes, 10); assert.equal(job.staffMinutes[c.doctor.id], 10); assert.equal(job.consumedUnits, 1); assert.equal(job.refunded, 0);
  assert.equal(d.state, 'completed'); assert.equal(runtime(c.sim).publicBudgets.find((b: any) => b.id === d.id).closedAt, job.completedAt);
  assert.equal(c.batch.generatedUnits, 1); assert.equal(c.batch.contaminatedUnits, 0); assert.equal(c.batch.sealedUnits, 1); assert.equal(c.batch.cleaningResidualUnits, 1); assert.equal(c.batch.containedUnits, 2);
  assert.ok(Math.abs(cash(c.sim) - before) < 1e-5, 'all real accounts/taxes/escrows retain original cash'); artifact('completed', c); restored24(c);
});

for (const mode of ['absent', 'other-floor', 'minor', 'dead', 'no-formal-wage'] as const) test(`public demand cannot originate from ${mode} doctor`, () => {
  const c = waste();
  if (mode === 'absent') { const home = c.sim.worldDefinition.buildings.find(b => b.id === c.doctor.homeId)!; pin(c.sim, c.controls, c.doctor.id, home, home.door); }
  if (mode === 'other-floor') pin(c.sim, c.controls, c.doctor.id, c.site, station(c.site, 1), 'work');
  if (mode === 'minor') c.sim.state.extension!.actorProfiles[c.doctor.id].age = 17;
  if (mode === 'dead') c.sim.state.extension!.actorProfiles[c.doctor.id].health = 0;
  if (mode === 'no-formal-wage') {
    const home = c.sim.worldDefinition.buildings.find(b => b.id === c.doctor.homeId)!; pin(c.sim, c.controls, c.doctor.id, home, home.door);
    const plan = finitePublicShift({ ...c, teacher: c.doctor, earned: () => ({ minutes: runtime(c.sim).attendance[c.doctor.id] ?? 0, amount: 0 }) }); restrictRemainingShift(plan, 0);
    pin(c.sim, c.controls, c.doctor.id, c.site, station(c.site, 0), 'work');
  }
  const earned = runtime(c.sim).attendance[c.doctor.id] ?? 0; advance(c.sim, 6);
  assert.equal(c.sim.state.hygiene!.publicDemands?.length ?? 0, 0); assert.equal(c.sim.state.hygiene!.jobs.length, 0); assert.equal(c.batch.contaminatedUnits, 1);
  if (mode === 'no-formal-wage') assert.equal(runtime(c.sim).attendance[c.doctor.id] ?? 0, earned);
});

for (const n of [0, 1]) test(`${n} actual official cannot approve public sanitation`, () => {
  const c = waste(), d = demand(c); approve(c, n); advance(c.sim, 6); assert.equal(d.state, 'awaitingReview'); assert.equal(d.approvedAt, null); assert.equal(d.jobId, null); assert.equal(d.spent, 0);
});

test('public budget protects actual wages and other commitments without adding any money', () => {
  const c = waste(), d = demand(c), before = cash(c.sim), snapshot = c.sim.publicBudgetSnapshot(), amount = c.sim.state.treasury - snapshot.reserve;
  assert.ok(amount > 0); c.sim.state.treasury -= amount; c.sim.state.player.money += amount; assert.ok(Math.abs(cash(c.sim) - before) < 1e-5);
  approve(c); advance(c.sim, 4); assert.equal(d.approvedAt, null); assert.equal(d.spent, 0); assert.equal(d.jobId, null); assert.equal(c.batch.contaminatedUnits, 1); assert.ok(Math.abs(cash(c.sim) - before) < 1e-5);
});

test('missing whole industrial unit cannot buy a fraction or work for free', () => {
  const c = waste(), d = demand(c); approve(c);
  // Negative stock fixture only removes inventory; it never supplies material.
  for (const shop of c.sim.state.shops) if (c.sim.shopCommodity(shop) === 'materials') shop.inventory = .5;
  c.sim.onPhase('traffic', s => { for (const shop of s.shops) if (c.sim.shopCommodity(shop) === 'materials') shop.inventory = Math.min(shop.inventory, .5); });
  const before = cash(c.sim); advance(c.sim, 12); assert.equal(d.spent, 0); assert.equal(d.receipt, null); assert.equal(d.jobId, null); assert.equal(c.batch.sealedUnits, 0); assert.ok(Math.abs(cash(c.sim) - before) < 1e-5); restored24(c);
});

test('purchased public material waits at the original station when doctor leaves and survives traveler death', () => {
  const c = waste(), { d, job } = supplied(c), home = c.sim.worldDefinition.buildings.find(b => b.id === c.doctor.homeId)!;
  pin(c.sim, c.controls, c.doctor.id, home, home.door); c.sim.state.extension!.actorProfiles.player.health = 0;
  advance(c.sim, 6); assert.equal(job.workedMinutes, 0); assert.equal(job.receivedUnits, 1); assert.equal(job.reservedUnits, 1); assert.equal(job.cancelledAt, null); assert.equal(d.state, 'processing');
  assert.equal(c.sim.command({ type: 'cancelDisinfection', targetId: job.id }).ok, false, 'traveler cannot cancel public authorization');
  pin(c.sim, c.controls, c.doctor.id, c.site, station(c.site, 0), 'work'); advance(c.sim, 10); assert.equal(job.workedMinutes, 10); assert.equal(job.state, 'completed'); assert.equal(d.state, 'completed'); restored24(c);
});

test('public disinfection retains original YV1 source and certified limited contact with sealed residues', () => {
  const c = waste(true), source = { ...c.batch.pathogenSource! }, { job } = supplied(c); advance(c.sim, 10);
  assert.equal(job.workedMinutes, 10); assert.equal(c.batch.hazard, 'YV1'); assert.deepEqual(c.batch.pathogenSource, source); assert.equal(c.batch.contaminatedUnits, 0); assert.equal(c.batch.sealedUnits, 1); assert.equal(c.batch.cleaningResidualUnits, 1);
  const contacts = c.sim.state.pathology!.contacts.filter(r => r.operationId === job.id && r.actorId === c.doctor.id);
  assert.ok(contacts.length > 0); assert.ok(contacts.every(r => r.protectionFactor === .25)); assert.ok(contacts.reduce((sum, r) => sum + r.endAt - r.startAt, 0) <= 10 + 1e-7); artifact('YV1-sealed', c); restored24(c);
});

test('forged requests/approval/completion events and repeated steps never replay procurement', () => {
  const c = waste(), { d, job } = supplied(c), save = c.sim.exportSave();
  for (const type of ['hygiene-public-demand', 'hygiene-public-approved', 'hygiene-disinfection-completed']) c.sim.emitEvent({ type, citizenId: c.doctor.id, siteId: c.site.id, procurementId: job.id, budgetId: d.id, quantity: 1, minutes: 10, purpose: c.batch.id });
  assert.equal(c.sim.exportSave(), save); advance(c.sim, 10); const paid = d.spent, next = c.sim.state.hygiene!.nextJobId; advance(c.sim, 10); assert.equal(d.spent, paid); assert.equal(c.sim.state.hygiene!.nextJobId, next); assert.equal(c.sim.state.hygiene!.publicDemands!.length, 1); restored24(c);
});

test('bad archive rejects ghost budgets, missing request/source/receipt and forged household refund atomically', () => {
  const c = waste(), { d, job } = supplied(c);
  for (const mutate of [
    (data: any) => { data.state.hygiene.publicDemands = []; data.state.hygiene.nextDemandId = 1; },
    (data: any) => { data.runtime.publicBudgets = data.runtime.publicBudgets.filter((b: any) => b.id !== d.id); },
    (data: any) => { data.runtime.publicBudgets.find((b: any) => b.id === d.id).spent += 1; },
    (data: any) => { data.state.hygiene.publicDemands[0].receipt.lots[0].quantity = 2; },
    (data: any) => { data.state.hygiene.publicDemands[0].reportWorkWindows[0].end = data.state.hygiene.publicDemands[0].reportWorkWindows[0].start; },
    (data: any) => { const j = data.state.hygiene.jobs.find((j: any) => j.id === job.id); j.payerId = 'player'; delete j.publicDemandId; },
    (data: any) => { data.state.hygiene.jobs.find((j: any) => j.id === job.id).escrow = 1; },
    (data: any) => { delete data.state.hygiene.jobs.find((j: any) => j.id === job.id).wageProofVersion; },
    (data: any) => { data.runtime.publicBudgets.push({ ...data.runtime.publicBudgets.find((b: any) => b.id === d.id), id: 'hygiene-demand-999' }); },
  ]) reject(c, mutate);
  artifact('partial', c); restored24(c);
});

test('controlled legacy-shaped clinical counters do not backfill missing waste on load', () => {
  const c = waste(), data = JSON.parse(c.sim.exportSave()); delete data.state.hygiene; delete data.runtime.hygieneVersion; data.runtime.persistedModules = data.runtime.persistedModules.filter((m: string) => m !== 'hygiene');
  const old = JSON.stringify(data), next = new Simulation(c.sim.worldDefinition), loaded = next.importSave(old); assert.equal(loaded.ok, true, loaded.message); assert.equal(next.exportSave(), old); attach(next, c.controls); advance(next, 6);
  assert.equal(next.state.clinical!.stock[c.site.id].consumedUnits, 1); assert.equal(next.state.hygiene, undefined);
});

test('traveler legal manual claim supersedes unpurchased public demand without duplicate budget spend', () => {
  const c = waste(), d = demand(c); approve(c); const result = c.sim.command({ type: 'disinfectWaste', targetId: c.batch.id }); assert.equal(result.ok, true, result.message);
  advance(c.sim, 2); assert.equal(d.state, 'superseded'); assert.equal(d.jobId, null); assert.equal(d.spent, 0); assert.equal(d.receipt, null); assert.equal(runtime(c.sim).publicBudgets.find((b: any) => b.id === d.id).closedAt, d.closedAt); restored24(c);
});


test('public job uses only the actual finite paid front and cannot infer an unpaid tail', () => {
  const c = waste(), { job } = supplied(c), home = c.sim.worldDefinition.buildings.find(b => b.id === c.doctor.homeId)!;
  pin(c.sim, c.controls, c.doctor.id, home, home.door);
  const plan = finitePublicShift({ ...c, teacher: c.doctor, earned: () => ({ minutes: runtime(c.sim).attendance[c.doctor.id] ?? 0, amount: 0 }) });
  restrictRemainingShift(plan, 2); pin(c.sim, c.controls, c.doctor.id, c.site, station(c.site, 0), 'work'); assert.equal(c.sim.command({ type: 'speed', value: 16 }).ok, true);
  const earned = runtime(c.sim).attendance[c.doctor.id], before = cash(c.sim); c.sim.step(.25);
  assert.equal(runtime(c.sim).attendance[c.doctor.id] - earned, 2); assert.equal(job.workedMinutes, 2); assert.equal(job.staffMinutes[c.doctor.id], 2);
  assert.equal(job.staffWindows[c.doctor.id].endedAt - job.staffWindows[c.doctor.id].startedAt, 2); advance(c.sim, 8); assert.equal(job.workedMinutes, 2); assert.equal(job.consumedUnits, 0); assert.ok(Math.abs(cash(c.sim) - before) < 1e-5); artifact('finite-paid-front', c); restored24(c);
});

test('the public job cannot reuse doctor minutes already consumed by actual clinical care', () => {
  const c = waste(), { job } = supplied(c), patient = c.sim.state.citizens.find(p => p.id !== c.doctor.id && !['医生', '学生'].includes(p.role) && c.sim.state.extension!.actorProfiles[p.id].age >= 18)!;
  pin(c.sim, c.controls, patient.id, c.site, station(c.site, 0)); c.sim.state.extension!.actorProfiles[patient.id].health = 50;
  const care = begin(c.sim, c.site, patient.id); advance(c.sim, 2);
  // The new care procures in finance, so its first phase has no material and
  // the public task may legitimately take that earlier two-minute wage slot.
  const prior = job.workedMinutes; advance(c.sim, 8); assert.equal(care.workedMinutes, 8); assert.equal(job.workedMinutes, prior, 'actual medical intervals leave no second hygiene capacity');
  const home = c.sim.worldDefinition.buildings.find(b => b.id === patient.homeId)!; pin(c.sim, c.controls, patient.id, home, home.door); advance(c.sim, 10); assert.equal(job.workedMinutes, 10); assert.equal(job.state, 'completed'); restored24(c);
});

test('authorized procurement still protects prior payroll when available public cash later disappears', () => {
  const c = waste(), d = demand(c); approve(c); assert.equal(d.approvedBy.length, 2);
  const before = cash(c.sim), snapshot = c.sim.publicBudgetSnapshot(), transfer = c.sim.state.treasury - snapshot.reserve; assert.ok(transfer > 0);
  c.sim.state.treasury -= transfer; c.sim.state.player.money += transfer; advance(c.sim, 6);
  assert.equal(d.jobId, null); assert.equal(d.spent, 0); assert.equal(d.receipt, null); assert.equal(c.batch.sealedUnits, 0); assert.ok(Math.abs(cash(c.sim) - before) < 1e-5); restored24(c);
});


test('original energy guard holds purchased public stock without free disinfection', () => {
  const c = waste(), { job } = supplied(c);
  c.sim.onPhase('traffic', state => { state.districts.find(d => d.id === c.site.districtId)!.energy = 0; });
  const before = cash(c.sim); advance(c.sim, 6); assert.equal(job.workedMinutes, 0); assert.equal(job.reservedUnits, 1); assert.equal(job.consumedUnits, 0); assert.equal(c.batch.contaminatedUnits, 1); assert.equal(c.batch.sealedUnits, 0); assert.ok(Math.abs(cash(c.sim) - before) < 1e-5);
});


test('a legal manual claim closes an unapproved demand without leaving a ghost agenda or budget', () => {
  const c = waste(), d = demand(c), result = c.sim.command({ type: 'disinfectWaste', targetId: c.batch.id }); assert.equal(result.ok, true, result.message);
  const manual = c.sim.state.hygiene!.jobs.at(-1)!; advance(c.sim, 2);
  assert.equal(d.state, 'superseded'); assert.equal(d.supersededByJobId, manual.id); assert.equal(d.approvedAt, null); assert.equal(d.spent, 0); assert.equal(d.receipt, null); assert.equal(runtime(c.sim).publicBudgets?.some((b: any) => b.id === d.id) ?? false, false);
  reject(c, data => { delete data.state.hygiene.publicDemands[0].supersededByJobId; }); restored24(c);
});


test('actual immutable old public save imports byte-identically and preserves no-backfill through native twenty-four ticks', () => {
  const saved = gunzipSync(readFileSync(new URL('./fixtures/public-disinfection-old-public-care-a1.json.gz', import.meta.url))).toString('utf8');
  assert.equal(createHash('sha256').update(saved).digest('hex'), '037f1bc6ae63ea062ada1268d737c22610473f9af2bfc845ab50175a87282618');
  // Original Git 3ca77b8 History ZIP member, not a current-save field deletion.
  // Its old controls file was lost in a /tmp reset and is not reconstructed.
  const live = new Simulation(fixture()), restored = new Simulation(fixture());
  for (const sim of [live, restored]) { const result = sim.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), saved); assert.equal(sim.state.hygiene, undefined); }
  const oldConsumed = live.state.culture!.orders[0].consumedUnits; assert.equal(oldConsumed, 1);
  for (let tick = 0; tick < 24; tick++) {
    live.step(.25); restored.step(.25); assert.equal(restored.exportSave(), live.exportSave(), `true-old native future ${tick + 1}`);
    const order = live.state.culture!.orders[0];
    assert.ok((order.healthConsumptions ?? []).every(r => r.consumptionIndex > oldConsumed), 'each new source is strictly after the real old consumed baseline');
    assert.ok((live.state.hygiene?.batches ?? []).every(b => b.sourceReceipts.every(r => r.kind !== 'public-health' || r.publicConsumedAtOrder > oldConsumed)), 'old consumed units never become new waste');
  }
  assert.equal(assembleSave(partitionSave(live.exportSave(), live.worldDefinition)), live.exportSave());
});


test('a same-phase forged wage event cannot give an unfunded doctor a public waste request', () => {
  const c = waste(), home = c.sim.worldDefinition.buildings.find(b => b.id === c.doctor.homeId)!; pin(c.sim, c.controls, c.doctor.id, home, home.door);
  const plan = finitePublicShift({ ...c, teacher: c.doctor, earned: () => ({ minutes: runtime(c.sim).attendance[c.doctor.id] ?? 0, amount: 0 }) }); restrictRemainingShift(plan, 0);
  pin(c.sim, c.controls, c.doctor.id, c.site, station(c.site, 0), 'work');
  let forged = 0; c.sim.onEvent('clinical-activity-window', event => {
    if (event.citizenId !== c.doctor.id || event.purpose !== 'work' || event.activityWindowEndAt! <= event.activityWindowStartAt!) return;
    forged++; c.sim.emitEvent({ type: 'wage-earned', citizenId: c.doctor.id, siteId: c.site.id, minutes: event.activityWindowEndAt! - event.activityWindowStartAt!, amount: .01, ratePerMinute: .01, creditedWorkStartAt: event.activityWindowStartAt, creditedWorkEndAt: event.activityWindowEndAt });
  });
  const attendance = runtime(c.sim).attendance[c.doctor.id]; advance(c.sim, 2); assert.ok(forged > 0, 'forgery must occur inside the genuine native work/arrival phase'); assert.equal(runtime(c.sim).attendance[c.doctor.id], attendance, 'no actual formal wage credit'); artifact('forged-unfunded-wage', c);
  assert.equal(c.sim.state.hygiene!.publicDemands?.length ?? 0, 0); assert.equal(c.sim.state.hygiene!.jobs.length, 0); assert.equal(c.batch.contaminatedUnits, 1);
});


test('a forged full phase cannot extend the real two-minute paid front to four sanitation minutes', () => {
  const c = waste(), { job } = supplied(c), home = c.sim.worldDefinition.buildings.find(b => b.id === c.doctor.homeId)!; pin(c.sim, c.controls, c.doctor.id, home, home.door);
  const plan = finitePublicShift({ ...c, teacher: c.doctor, earned: () => ({ minutes: runtime(c.sim).attendance[c.doctor.id] ?? 0, amount: 0 }) }); restrictRemainingShift(plan, 2);
  pin(c.sim, c.controls, c.doctor.id, c.site, station(c.site, 0), 'work'); assert.equal(c.sim.command({ type: 'speed', value: 16 }).ok, true);
  let forged = 0; c.sim.onEvent('clinical-activity-window', event => {
    if (event.citizenId !== c.doctor.id || event.purpose !== 'work' || event.activityWindowEndAt! <= event.activityWindowStartAt!) return;
    forged++; c.sim.emitEvent({ type: 'wage-earned', citizenId: c.doctor.id, siteId: c.site.id, minutes: event.activityWindowEndAt! - event.activityWindowStartAt!, amount: .01, ratePerMinute: .01, creditedWorkStartAt: event.activityWindowStartAt, creditedWorkEndAt: event.activityWindowEndAt });
  });
  const attendance = runtime(c.sim).attendance[c.doctor.id]; c.sim.step(.25); assert.ok(forged > 0); assert.equal(runtime(c.sim).attendance[c.doctor.id] - attendance, 2); artifact('forged-paid-front', c);
  assert.equal(job.workedMinutes, 2, 'only the native certified paid front can be spent on disinfection'); assert.equal(job.staffMinutes[c.doctor.id], 2); assert.equal(job.consumedUnits, 0);
  reject(c, data => { const forged = data.state.hygiene.jobs.find((j: any) => j.id === job.id); forged.workedMinutes = 4; forged.staffMinutes[c.doctor.id] = 4; forged.staffWindows[c.doctor.id].workedMinutes = 4; forged.staffWindows[c.doctor.id].endedAt += 2; data.state.hygiene.stats.workedMinutes += 2; });
});
