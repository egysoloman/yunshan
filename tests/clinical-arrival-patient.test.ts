import assert from 'node:assert/strict';
import test from 'node:test';
import { EPS, assertActualLateRoute, assertActualPair, assertSupplied, beginNativeNpcOrder, captureWages, clock, currentWageWindow, initialIntent, intervalMinutes, lateStart, nativeContext, trace } from './clinical-arrival-fixture.ts';

test('M2 NPC patient genuine arrival: treatment cannot reuse the walking portion of the patient budget', () => {
  const context = nativeContext(), { sim, site, point, doctor, patient } = context;
  initialIntent(sim, doctor, site, point.position, 'work');
  const order = beginNativeNpcOrder(context);
  sim.step(.25); // Actual funded attendance and procurement; no supplied-material injection.
  assertSupplied(order); assert.equal(sim.isOnDuty(doctor.id, site.id), true);
  initialIntent(sim, patient, site, lateStart(site), 'heal');
  const originalTier = patient.tier, role = patient.role, workId = patient.workId;
  const meters = assertActualLateRoute(sim, patient, site, point.position);
  const speed = sim.state.weather === '雨' ? 3.1 : 4.2;
  const before = { clock: clock(sim), worked: order.workedMinutes, health: sim.state.extension!.actorProfiles[patient.id].health, money: sim.state.player.money, reserved: order.reservedUnits, consumed: order.consumedUnits };
  const wages = captureWages(sim, doctor.id);
  sim.step(.25);
  assert.ok(Math.abs(clock(sim) - before.clock - 4) < EPS);
  assertActualPair(context); assert.equal(sim.isOnDuty(doctor.id, site.id), true);
  assert.equal(patient.tier, originalTier); assert.equal(patient.role, role); assert.equal(patient.workId, workId);
  const earned = currentWageWindow(wages, sim, site);
  const routeUpper = Math.max(0, 4 - meters / speed);
  // Baseline has no actual patient-window event. This is explicitly the exact
  // route-distance upper bound, not an invented actualConsumed observation.
  const derivedPatientWindow = { start: clock(sim) - routeUpper, end: clock(sim) };
  const upper = intervalMinutes(earned, derivedPatientWindow, { start: before.clock, end: clock(sim) }, { start: order.startedAt, end: clock(sim) });
  const delta = order.workedMinutes - before.worked;
  trace('M2_NPC_PATIENT_LATE', { doctor: doctor.id, patient: patient.id, meters, speed, patientWindowSource: 'derivedUpperBound: original real route distance / unchanged core speed', derivedPatientWindow, earned, actualTreatmentDeltaMinutes: delta, before, after: { clock: clock(sim), worked: order.workedMinutes, patientHealth: sim.state.extension!.actorProfiles[patient.id].health, money: sim.state.player.money, reserved: order.reservedUnits, consumed: order.consumedUnits } });
  assert.ok(upper > 0 && upper < 4 - EPS);
  assert.equal(order.reservedUnits, before.reserved); assert.equal(order.consumedUnits, before.consumed);
  assert.equal(sim.state.player.money, before.money);
  assert.ok(delta <= upper + EPS, 'the late NPC patient must not receive retroactive care while still walking');
});
