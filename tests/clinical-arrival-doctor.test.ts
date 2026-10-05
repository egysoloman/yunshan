import assert from 'node:assert/strict';
import test from 'node:test';
import { EPS, assertActualLateRoute, assertActualPair, assertSupplied, beginNativeNpcOrder, captureWages, clock, currentWageWindow, initialIntent, intervalMinutes, lateStart, nativeContext, trace } from './clinical-arrival-fixture.ts';

test('M2 doctor genuine arrival: treatment cannot exceed actual current earned onsite window', () => {
  const context = nativeContext(), { sim, site, point, doctor, patient } = context;
  const order = beginNativeNpcOrder(context);
  sim.step(.25); // Original people followed by actual procurement in finance.
  assertSupplied(order);
  initialIntent(sim, doctor, site, lateStart(site), 'work');
  const originalTier = doctor.tier, role = doctor.role, workId = doctor.workId;
  const meters = assertActualLateRoute(sim, doctor, site, point.position);
  const speed = sim.state.weather === '雨' ? 3.1 : 4.2;
  const before = { clock: clock(sim), worked: order.workedMinutes, health: sim.state.extension!.actorProfiles[patient.id].health, money: sim.state.player.money, reserved: order.reservedUnits, consumed: order.consumedUnits };
  const wages = captureWages(sim, doctor.id);
  sim.step(.25); // No phase hook, pin, needs reset, or method replacement.
  assert.ok(Math.abs(clock(sim) - before.clock - 4) < EPS);
  assertActualPair(context); assert.equal(sim.isOnDuty(doctor.id, site.id), true);
  assert.equal(doctor.tier, originalTier); assert.equal(doctor.role, role); assert.equal(doctor.workId, workId);
  const earned = currentWageWindow(wages, sim, site);
  const phase = { start: before.clock, end: clock(sim) };
  const upper = intervalMinutes(earned, phase, { start: order.startedAt, end: clock(sim) });
  const routeUpper = Math.max(0, 4 - meters / speed);
  const delta = order.workedMinutes - before.worked;
  trace('M2_DOCTOR_LATE', { doctor: doctor.id, patient: patient.id, source: 'original core route + original wage-earned attestation', meters, speed, routeUpperBoundMinutes: routeUpper, phase, earned, actualTreatmentDeltaMinutes: delta, before, after: { clock: clock(sim), worked: order.workedMinutes, patientHealth: sim.state.extension!.actorProfiles[patient.id].health, money: sim.state.player.money, reserved: order.reservedUnits, consumed: order.consumedUnits } });
  assert.ok(upper > 0 && upper < 4 - EPS, 'the witness must distinguish genuine late work from a complete phase');
  assert.ok(earned.minutes <= routeUpper + EPS, 'original credited work may not exceed actual post-route time');
  assert.equal(order.reservedUnits, before.reserved); assert.equal(order.consumedUnits, before.consumed);
  assert.equal(sim.state.player.money, before.money);
  assert.ok(delta <= upper + EPS, 'treatment must not backdate the doctor into the travel part of this phase');
});
