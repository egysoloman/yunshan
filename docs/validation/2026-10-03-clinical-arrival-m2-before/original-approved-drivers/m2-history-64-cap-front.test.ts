import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Simulation } from '../source/src/simulation.ts';
import { clinicalPairAtServiceStation, clinicalServiceStationsAtPosition } from '../source/src/simulation/clinical.ts';
import type { Role, WorldDefinition } from '../source/src/types.ts';
import { EPS, captureWages, clock, currentWageWindow, intervalMinutes, remainingRouteMeters, runtime, trace } from './m2-fixture.ts';

// NOT_READY: no genuine native capped/deferred snapshot was provided during
// prep. This deliberately fails its input gate rather than fabricate a public
// cap, attendance, money, clock, material, role, needs, route or elapsed ledger.
// Only run later with a separately reviewed immutable native-origin bundle.
interface NativeOrigin {
  status: 'NATIVE_TICKS_CAPTURED';
  sourceSimulationSha256: string; worldPath: string; worldSha256: string;
  savePath: string; saveSha256: string; nativeCaptureReceiptPath: string;
  nativeCaptureReceiptSha256: string; doctorId: string; patientId: string;
  siteId: string; orderId: string;
  forbiddenStateInjectionCount: 0;
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
test('M2 genuine historical64/front-cap2: current clinical credit requires current joint interval', () => {
  const input = process.env.YUNSHAN_M2_AUTHENTIC_HISTORY_INPUT;
  assert.ok(input, 'NOT_READY: authentic native-origin history64/cap2 input is absent; no synthetic fallback is allowed');
  const origin = JSON.parse(readFileSync(resolve(input), 'utf8')) as NativeOrigin;
  assert.equal(origin.status, 'NATIVE_TICKS_CAPTURED'); assert.equal(origin.forbiddenStateInjectionCount, 0);
  assert.equal(origin.sourceSimulationSha256, 'f9eb39ebf076b8cde34c6e910cbe3e37d3170ff709553292b6dcc67271d4df85');
  const worldBytes = readFileSync(origin.worldPath), saveBytes = readFileSync(origin.savePath), nativeReceipt = readFileSync(origin.nativeCaptureReceiptPath);
  assert.equal(digest(worldBytes), origin.worldSha256); assert.equal(digest(saveBytes), origin.saveSha256); assert.equal(digest(nativeReceipt), origin.nativeCaptureReceiptSha256);
  const sim = new Simulation(JSON.parse(worldBytes.toString('utf8')) as WorldDefinition);
  const restored = sim.importSave(saveBytes.toString('utf8')); assert.equal(restored.ok, true, restored.message);
  assert.equal(sim.exportSave(), saveBytes.toString('utf8'), 'this new/marked completed-tick input must import without fixture mutation');
  const doctor = sim.state.citizens.find(p => p.id === origin.doctorId)!, patient = sim.state.citizens.find(p => p.id === origin.patientId)!;
  const site = sim.worldDefinition.buildings.find(b => b.id === origin.siteId)!, order = sim.state.clinical!.orders.find(o => o.id === origin.orderId)!;
  assert.ok(doctor && patient && site && order);
  assert.equal(doctor.role, '医生'); assert.equal(doctor.workId, site.id); assert.equal(doctor.state, 'working');
  assert.equal(doctor.tier, 'statistical'); assert.equal(sim.state.speed, 16); assert.equal(sim.state.paused, false);
  assert.equal((sim.state.tick + 1 + sim.state.citizens.indexOf(doctor)) % 16, 0, 'the next unmodified statistical phase must actually process this doctor');
  assert.ok(Math.abs((runtime(sim).peopleElapsed?.[doctor.id] ?? 0) - 60) < EPS);
  assert.equal(remainingRouteMeters(doctor), 0); assert.equal(remainingRouteMeters(patient), 0);
  assert.equal(order.patientId, patient.id); assert.equal(order.siteId, site.id); assert.equal(order.reservedUnits, 1); assert.ok(order.workedMinutes <= 16);
  assert.ok(['awaitingDoctor', 'inTreatment'].includes(order.state));
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, patient.id), true);
  const identity = { role: 'traveler' as Role, identities: ['traveler' as Role] };
  assert.ok(clinicalServiceStationsAtPosition(site, doctor.position, identity, sim.state.voxels).length > 0);
  assert.ok(clinicalServiceStationsAtPosition(site, patient.position, identity, sim.state.voxels).length > 0);
  const originalPublicAllowance = Reflect.get(sim, 'publicWorkAllowance') as (person: typeof doctor) => number;
  assert.ok(Math.abs(originalPublicAllowance.call(sim, doctor) - 2) < EPS, 'the existing real promise must already have exactly two minutes left');
  const wages = captureWages(sim, doctor.id), before = { clock: clock(sim), worked: order.workedMinutes, attendance: runtime(sim).attendance[doctor.id] ?? 0 };
  sim.step(.25); // Native catchup; preserve all original wages/needs/history.
  const earned = currentWageWindow(wages, sim, site);
  assert.ok(Math.abs(clock(sim) - before.clock - 4) < EPS);
  assert.ok(Math.abs(earned.minutes - 2) < EPS, 'the authentic two-minute cap must be observed in a real wage event');
  assert.ok(Math.abs((runtime(sim).attendance[doctor.id] ?? 0) - before.attendance - 2) < EPS);
  assert.ok(Math.abs(earned.start - (clock(sim) - 64)) < EPS);
  assert.ok(Math.abs(earned.end - (clock(sim) - 62)) < EPS);
  const current = { start: before.clock, end: clock(sim) };
  const overlap = intervalMinutes(earned, current, { start: order.startedAt, end: clock(sim) });
  const delta = order.workedMinutes - before.worked;
  trace('M2_AUTHENTIC_HISTORY64_CAP2', { origin, phase: current, earned, currentOverlapMinutes: overlap, actualTreatmentDeltaMinutes: delta, onDutyAfterCap: sim.isOnDuty(doctor.id, site.id) });
  assert.equal(overlap, 0); assert.ok(delta <= EPS, 'historical front credit must not be moved to the current clinical phase');
});
