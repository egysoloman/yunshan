import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation.ts';
import { beginClinicalTreatment, clinicalDoctorMinutes, clinicalDoctorUsedWorkWindows, clinicalDoctorWorkWindows, clinicalTaskActorIds } from '../src/simulation/clinical.ts';
import { actorActivityAvailable } from '../src/simulation/activity-minutes.ts';
import { fixture } from './clinical-presence-fixture.ts';
import { EPS, assertActualPair, assertSupplied, beginNativeNpcOrder, captureWages, clock, currentWageWindow, initialIntent, nativeContext } from './clinical-arrival-fixture.ts';

const oldSave = (name: string): string => readFileSync(new URL(`./fixtures/clinical-arrival-old-${name}.json`, import.meta.url), 'utf8');
function imported(name: string): Simulation {
  const sim = new Simulation(fixture()), raw = oldSave(name), result = sim.importSave(raw);
  assert.equal(result.ok, true, result.message);
  assert.equal(sim.exportSave(), raw, 'unmarked old order load must not add markers or rewrite history');
  return sim;
}
function restore24(sim: Simulation): void {
  const saved = sim.exportSave(), copy = new Simulation(sim.worldDefinition), result = copy.importSave(saved);
  assert.equal(result.ok, true, result.message); assert.equal(copy.exportSave(), saved);
  for (let tick = 0; tick < 24; tick++) {
    sim.step(.25); copy.step(.25);
    assert.equal(copy.exportSave(), sim.exportSave(), `exact full-tick continuation ${tick + 1}`);
  }
}
for (const caseId of ['D1', 'D2'] as const) test(`genuine unmarked old ${caseId} pending order keeps load bytes and future late care uses one minute`, () => {
  const sim = imported(`${caseId}-measurement-before-step`), order = sim.state.clinical!.orders[0], site = sim.worldDefinition.buildings.find(site => site.id === order.siteId)!;
  const doctor = sim.state.citizens.find(person => person.id === 'citizen-4')!, cash = sim.state.player.money, reserved = order.reservedUnits, purchased = order.purchasePaid;
  assert.equal(order.timingVersion, undefined); assert.equal(order.workedMinutes, 0);
  const wages = captureWages(sim, doctor.id), before = clock(sim);
  const arrived: { actorId?: string; siteId?: string; start?: number; end?: number; tick?: number; observedClock?: number }[] = [];
  sim.onEvent('clinical-activity-window', event => arrived.push({ actorId: event.citizenId, siteId: event.siteId, start: event.activityWindowStartAt, end: event.activityWindowEndAt, tick: event.activityObservedTick, observedClock: event.activityObservedClock }));
  sim.step(.25);
  const lateId = caseId === 'D1' ? doctor.id : order.patientId, late = arrived.find(row => row.actorId === lateId)!;
  assert.ok(late); assert.equal(late.siteId, site.id); assert.equal(late.tick, sim.state.tick); assert.equal(late.observedClock, clock(sim));
  assert.ok(Math.abs(late.start! - (before + 3)) <= EPS); assert.equal(late.end, clock(sim));
  assert.equal(clock(sim) - before, 4);
  assert.ok(Math.abs(order.workedMinutes - 1) <= EPS, 'the actual old route must provide one real overlapping minute');
  assert.equal(order.reservedUnits, reserved); assert.equal(order.purchasePaid, purchased); assert.equal(order.consumedUnits, 0); assert.equal(sim.state.player.money, cash);
  const earned = currentWageWindow(wages, sim, site), windows = clinicalDoctorWorkWindows(sim, doctor, site.id, 4);
  assert.ok(windows.every(window => window.start >= Math.max(before, earned.start) && window.end <= earned.end));
  assert.ok(clinicalDoctorMinutes(sim, doctor, site.id, 4) > 0);
  assert.ok(Object.isFrozen(windows[0]));
  const covered = clinicalDoctorUsedWorkWindows(sim, doctor.id);
  assert.equal(covered.length, 1); assert.ok(Math.abs(covered[0].start - (before + 3)) <= EPS); assert.equal(covered[0].end, clock(sim));
  assert.ok(Object.isFrozen(covered[0]), 'used doctor ranges must expose the actual late tail, not a scalar prefix');
  // Returned ranges are detached; modifying the list must not alter authority.
  const detached = windows.slice(); detached.pop(); assert.equal(clinicalDoctorWorkWindows(sim, doctor, site.id, 4).length, windows.length);
  restore24(sim);
});

test('genuine old already credited progress is preserved, then only new current work is added', () => {
  const sim = imported('D1-measurement-after-step'), order = sim.state.clinical!.orders[0], oldWorked = order.workedMinutes, purchased = order.purchasePaid;
  assert.equal(oldWorked, 4); assert.equal(order.timingVersion, undefined);
  sim.step(.25);
  assert.equal(order.workedMinutes, oldWorked + 4);
  assert.equal(order.purchasePaid, purchased); assert.equal(order.receipts.length, 1);
  restore24(sim);
});

test('new marked timing version is validated atomically without granting future or duplicate care', () => {
  const context = nativeContext(), { sim, doctor, site, point } = context;
  initialIntent(sim, doctor, site, point.position, 'work'); const order = beginNativeNpcOrder(context);
  assert.equal(order.timingVersion, 2); const before = sim.exportSave(), data = JSON.parse(before);
  data.state.clinical.orders[0].timingVersion = 3;
  const rejected = sim.importSave(JSON.stringify(data)); assert.equal(rejected.ok, false); assert.equal(sim.exportSave(), before);
  sim.step(.25); assertSupplied(order);
  const suppliedSave = sim.exportSave(), borrowed = JSON.parse(suppliedSave);
  borrowed.state.clinical.orders[0].workedMinutes = 1; borrowed.state.clinical.orders[0].staffMinutes[doctor.id] = 1; borrowed.state.clinical.orders[0].state = 'inTreatment';
  const invalidTime = sim.importSave(JSON.stringify(borrowed)); assert.equal(invalidTime.ok, false); assert.equal(sim.exportSave(), suppliedSave, 'marked care cannot predate genuine material arrival');
  sim.step(.25); assert.equal(order.workedMinutes, 4);
  const completedTick = sim.exportSave(); sim.command({ type: 'setTime', value: 10 });
  assert.equal(order.workedMinutes, 4, 'display-time command cannot grant medical time');
  assert.notEqual(sim.exportSave(), completedTick); restore24(sim);
});

test('two genuine paid patients share one doctor clock while a third retains material and escrow', () => {
  const context = nativeContext(), { sim, site, doctor, point } = context;
  initialIntent(sim, doctor, site, point.position, 'work');
  const patients = sim.state.citizens.filter(person => person.id !== doctor.id && !['医生', 'doctor'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 3);
  assert.equal(patients.length, 3); const beforeCash = sim.state.player.money;
  const orders = patients.map(person => {
    initialIntent(sim, person, site, point.position, 'heal');
    const result = beginClinicalTreatment(sim, { patientId: person.id, payerId: 'player', siteId: site.id }); assert.equal(result.ok, true, result.message);
    return sim.state.clinical!.orders.at(-1)!;
  });
  assert.equal(sim.state.player.money, beforeCash - 90);
  sim.step(.25); for (const order of orders) assertSupplied(order);
  const wages = captureWages(sim, doctor.id); sim.step(.25);
  assert.equal(currentWageWindow(wages, sim, site).minutes, 4);
  assert.deepEqual(orders.map(order => order.workedMinutes), [4, 4, 0]);
  assert.equal(actorActivityAvailable(sim, doctor.id, 4), 0, 'two full concurrent patients consume a four-minute doctor union, not eight');
  assert.equal(orders[2].reservedUnits, 1); assert.equal(orders[2].consumedUnits, 0); assert.equal(orders[2].escrow + orders[2].purchasePaid, 30);
  restore24(sim);
});

test('statistical medical commitments complete twenty actual minutes without changing tier or erasing pending elapsed', () => {
  const context = nativeContext(), { sim, site, doctor, patient, point } = context;
  // Genuine focus/tier processing away from this clinic; no manually assigned tier.
  sim.setFocus({ x: -1500, y: .6, z: -1500 }, 'drone');
  for (let tick = 0; tick < 8; tick++) sim.step(.25);
  assert.equal(doctor.tier, 'statistical'); assert.equal(patient.tier, 'statistical');
  sim.setFocus(point.position, 'walk');
  initialIntent(sim, doctor, site, point.position, 'work'); const order = beginNativeNpcOrder(context);
  const alive = sim.state.extension!.actorProfiles[doctor.id].alive;
  const actorIds = clinicalTaskActorIds(sim.state); assert.ok(actorIds.has(doctor.id)); assert.ok(actorIds.has(patient.id));
  // Keep focus distant without moving the payer from their actual admission point.
  sim.setFocus({ x: -1500, y: .6, z: -1500 }, 'drone');
  const tiers = [doctor.tier, patient.tier]; assert.deepEqual(tiers, ['statistical', 'statistical']);
  sim.step(.25); assertSupplied(order); assert.deepEqual([doctor.tier, patient.tier], tiers);
  const first = clock(sim), wages = captureWages(sim, doctor.id);
  for (let tick = 0; tick < 5; tick++) { sim.step(.25); assert.equal(order.workedMinutes, (tick + 1) * 4); assert.deepEqual([doctor.tier, patient.tier], tiers); }
  assert.equal(clock(sim) - first, 20); assert.equal(order.state, 'completed'); assert.equal(order.consumedUnits, 1);
  assert.equal(sim.state.extension!.actorProfiles[doctor.id].alive, alive); assert.deepEqual([doctor.tier, patient.tier], tiers);
  assert.ok(wages.every(row => row.minutes === 4 && row.end! - row.start! === 4));
  restore24(sim);
});
