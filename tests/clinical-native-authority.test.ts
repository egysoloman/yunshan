import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulation, isCanonicalClinicalPresence, isCanonicalNpcWage } from '../src/simulation';
import { clinicalDoctorWorkWindows } from '../src/simulation/clinical';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { fixture, setup, begin, advance, cash } from './clinical-presence-fixture';
import { finitePublicShift, restrictRemainingShift } from './education-fixture';
import { EPS, nativeContext, initialIntent, beginNativeNpcOrder, assertSupplied, clock } from './clinical-arrival-fixture';

// PREPARED / NOT_RUN until the root grants a single execution window.
// These are controlled original nine-building fixtures and immutable original
// M2 saves, not natural illness, default commuting or the current 616 city.
// No new cash, role, employer, pathogen, material receipt or earned wage is
// invented. The bounded-pay case reuses the explicitly controlled, cash-neutral
// fiscal setup; genuine core attendance still issues the one funded minute.
const oldD2 = () => readFileSync(new URL('./fixtures/clinical-arrival-old-D2-measurement-before-step.json', import.meta.url), 'utf8');
const validate = (sim: Simulation) => {
  const result = sim.validateSave(sim.exportSave()); assert.equal(result.ok, true, result.message);
};

test('a pretty generic patient arrival cannot replace the real late movement tail', () => {
  const sim = new Simulation(fixture()), saved = oldD2(), loaded = sim.importSave(saved);
  assert.equal(loaded.ok, true, loaded.message); assert.equal(sim.exportSave(), saved);
  const order = sim.state.clinical!.orders[0], before = structuredClone(order);
  const seen: { native: boolean; originalStart: number; forgedStart: number }[] = [];
  sim.onEvent('clinical-activity-window', event => {
    if (event.citizenId !== order.patientId || !isCanonicalClinicalPresence(event, sim)) return;
    assert.ok(Object.isFrozen(event) && Object.isFrozen(event.activityPosition));
    const forged = { ...event, activityPosition: { ...event.activityPosition! }, activityWindowStartAt: clock(sim) - 4 };
    assert.equal(isCanonicalClinicalPresence(forged, sim), false);
    seen.push({ native: true, originalStart: event.activityWindowStartAt!, forgedStart: forged.activityWindowStartAt });
    sim.emitEvent(forged);
  });
  sim.step(.25);
  assert.equal(seen.length, 1); assert.equal(clock(sim) - seen[0].originalStart, 1);
  assert.equal(clock(sim) - seen[0].forgedStart, 4);
  assert.ok(Math.abs(order.workedMinutes - before.workedMinutes - 1) <= EPS,
    'only the original one-minute arrival tail overlaps the real paid doctor');
  assert.equal(order.purchasePaid, before.purchasePaid); assert.equal(order.escrow, before.escrow);
  assert.equal(order.consumedUnits, 0); assert.equal(order.reservedUnits, 1);
  validate(sim);
});

test('one genuinely funded minute cannot be expanded by a pretty generic wage', () => {
  const context = setup(), { sim, site, doctor } = context;
  const plan = finitePublicShift({ ...context, teacher: doctor,
    earned: () => ({ minutes: Reflect.get(sim, 'runtime').attendance[doctor.id] ?? 0, amount: 0 }) });
  const order = begin(sim, site);
  advance(sim, 4);
  assert.equal(order.receivedUnits, 1); assert.equal(order.reservedUnits, 1);
  assert.ok(order.workedMinutes < 20); assert.equal(order.receipts.length, 1);
  restrictRemainingShift(plan, 1);
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const before = order.workedMinutes, money = cash(sim), purchases = order.purchasePaid;
  let originalMinutes = 0, falseEvents = 0;
  sim.onEvent('wage-earned', event => {
    if (event.citizenId !== doctor.id || !isCanonicalNpcWage(event, sim)) return;
    originalMinutes += event.minutes!;
    const forged = { ...event, minutes: 2, amount: event.amount! * 2 / event.minutes!,
      creditedWorkStartAt: clock(sim) - 2, creditedWorkEndAt: clock(sim) };
    assert.equal(isCanonicalNpcWage(forged, sim), false); falseEvents++; sim.emitEvent(forged);
  });
  sim.step(.25);
  assert.equal(falseEvents, 1); assert.ok(Math.abs(originalMinutes - 1) <= EPS);
  assert.ok(Math.abs(order.workedMinutes - before - 1) <= EPS,
    'the original funded front grants one minute, not the forged whole two-minute phase');
  assert.equal(order.purchasePaid, purchases); assert.equal(order.consumedUnits, 0);
  assert.ok(Math.abs(cash(sim) - money) < 1e-5); validate(sim);
});

test('current authority binds the original object, city, state, tick and clock', () => {
  const context = nativeContext(), { sim, site, point, doctor, patient } = context;
  const other = new Simulation(fixture());
  initialIntent(sim, doctor, site, point.position, 'work');
  beginNativeNpcOrder(context);
  let presence: Parameters<Simulation['emitEvent']>[0] | undefined;
  let wage: Parameters<Simulation['emitEvent']>[0] | undefined;
  sim.onEvent('clinical-activity-window', event => {
    if (event.citizenId !== patient.id) return;
    assert.equal(isCanonicalClinicalPresence(event, sim), true);
    assert.equal(isCanonicalClinicalPresence(event, other), false);
    assert.equal(isCanonicalClinicalPresence(structuredClone(event), sim), false);
    assert.equal(Reflect.set(event, 'activityWindowStartAt', 0), false);
    assert.equal(Reflect.set(event.activityPosition!, 'x', 0), false); presence = event;
  });
  sim.onEvent('wage-earned', event => {
    if (event.citizenId !== doctor.id) return;
    assert.equal(isCanonicalNpcWage(event, sim), true);
    assert.equal(isCanonicalNpcWage(event, other), false);
    assert.equal(isCanonicalNpcWage(structuredClone(event), sim), false); wage = event;
  });
  sim.step(.25); assert.ok(presence && wage);
  const firstPresence = presence, firstWage = wage;
  // A later original tick cannot reuse a once-genuine notification.
  sim.step(.25);
  assert.equal(isCanonicalClinicalPresence(firstPresence, sim), false);
  assert.equal(isCanonicalNpcWage(firstWage, sim), false);
  const saved = sim.exportSave(), latestPresence = presence!;
  assert.equal(isCanonicalClinicalPresence(latestPresence, sim), true);
  const loaded = sim.importSave(saved); assert.equal(loaded.ok, true, loaded.message);
  assert.equal(sim.exportSave(), saved);
  assert.equal(isCanonicalClinicalPresence(latestPresence, sim), false,
    'imported state has no inherited transient arrival authority');
});

test('real paid staff, purchased material and original onsite movement still complete ordinary care', () => {
  const context = nativeContext(), { sim, site, point, doctor } = context;
  initialIntent(sim, doctor, site, point.position, 'work');
  const order = beginNativeNpcOrder(context), money = cash(sim);
  let genuineWages = 0, genuineArrivals = 0;
  sim.onEvent('wage-earned', event => {
    if (event.citizenId === doctor.id && isCanonicalNpcWage(event, sim)) genuineWages += event.minutes!;
  });
  sim.onEvent('clinical-activity-window', event => {
    if (event.citizenId === order.patientId && isCanonicalClinicalPresence(event, sim)) genuineArrivals++;
  });
  sim.step(.25); assertSupplied(order); validate(sim);
  const healthBefore = sim.state.extension!.actorProfiles[order.patientId].health;
  for (let i = 0; i < 6 && order.state !== 'completed'; i++) { sim.step(.25); validate(sim); }
  assert.equal(order.state, 'completed'); assert.equal(order.workedMinutes, 20);
  assert.equal(order.consumedUnits, 1); assert.equal(order.reservedUnits, 0); assert.equal(order.escrow, 0);
  assert.equal(order.purchasePaid + order.serviceFee, 30); assert.equal(order.receipts.length, 1);
  assert.ok(genuineWages >= 20 && genuineArrivals >= 6);
  assert.ok(sim.state.extension!.actorProfiles[order.patientId].health > healthBefore);
  assert.ok(Math.abs(cash(sim) - money) < 1e-5);
  assert.ok(clinicalDoctorWorkWindows(sim, doctor, site.id, 4).every(window => window.end <= clock(sim)));
});

test('unchanged old pending source reloads whole and physical parts, then stays byte-identical for 24 native ticks', () => {
  const original = new Simulation(fixture()), whole = new Simulation(fixture()), parts = new Simulation(fixture());
  const saved = oldD2(), nativeParts = partitionSave(saved, original.worldDefinition);
  const directory = mkdtempSync(join(tmpdir(), 'ROOT20-medical-parts-'));
  let writtenBytes = 0, assembled: string;
  try {
    const fromDisk = nativeParts.map((part, index) => {
      const bytes = JSON.stringify(part), filename = join(directory, `${index}.json`);
      writtenBytes += Buffer.byteLength(bytes); assert.ok(writtenBytes <= 16 * 1024 * 1024);
      writeFileSync(filename, bytes); const returned = JSON.parse(readFileSync(filename, 'utf8'));
      assert.equal(returned.id, part.id); assert.equal(returned.json, part.json); return returned;
    });
    assembled = assembleSave(fromDisk);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  assert.equal(assembled, saved);
  for (const [sim, raw] of [[original, saved], [whole, saved], [parts, assembled]] as const) {
    const loaded = sim.importSave(raw); assert.equal(loaded.ok, true, loaded.message);
    assert.equal(sim.exportSave(), saved);
  }
  for (let i = 0; i < 24; i++) {
    for (const sim of [original, whole, parts]) { sim.step(.25); validate(sim); }
    assert.equal(whole.exportSave(), original.exportSave()); assert.equal(parts.exportSave(), original.exportSave());
  }
});
