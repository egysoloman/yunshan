import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCanonicalNpcWage } from '../src/simulation.ts';
import { beginClinicalTreatment, clinicalDoctorWorkWindows, clinicalPairAtServiceStation } from '../src/simulation/clinical.ts';
import { clock, initialIntent, nativeContext } from './clinical-arrival-fixture.ts';

// Only the original nine-building/384-person fixture is initialized here.
// Unlike phase-pinning helpers, subsequent state changes come from normal
// core steps/commands. This is controlled private care, never naturalfull6.
test('original private-care caller credits only the real pre17 prefix and preserves purchased material after closing', () => {
  const { sim, site, point, doctor, patient } = nativeContext();
  const output = process.env.ROOT17_FUNCTIONAL_OUTPUT;
  const observations: unknown[] = [];
  const record = (name: string, value: unknown) => {
    if (!output) return;
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  };
  // One declared initial clock/intent; no clocks, bodies, needs, inventory,
  // role, employment, allowance or money are reset after the first step.
  sim.state.hour = 16 + 51 / 60;
  sim.state.extension!.lastUpdate = 16 * 60 + 51;
  sim.state.family!.lastUpdate = clock(sim);
  sim.state.culture!.lastUpdate = clock(sim);
  sim.state.playerLabor!.lastObservedAt = clock(sim);
  initialIntent(sim, doctor, site, point.position, 'work');
  initialIntent(sim, patient, site, point.position, 'heal');
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, patient.id), true);
  const money = sim.state.player.money, initialNeeds = structuredClone(patient.needs);
  const begun = beginClinicalTreatment(sim, { patientId: patient.id, payerId: 'player', siteId: site.id });
  assert.equal(begun.ok, true, begun.message);
  assert.equal(sim.state.player.money, money - 30);
  const order = sim.state.clinical!.orders.at(-1)!;
  assert.equal(order.workedMinutes, 0); assert.equal(order.consumedUnits, 0);
  const wages: { tick: number; clock: number; canonical: boolean; event: any }[] = [];
  const arrivals: { tick: number; clock: number; event: any }[] = [];
  sim.onEvent('wage-earned', event => {
    if (event.citizenId === doctor.id) wages.push({ tick: sim.state.tick, clock: clock(sim), canonical: isCanonicalNpcWage(event), event: structuredClone(event) });
  });
  sim.onEvent('clinical-activity-window', event => {
    if (event.citizenId === doctor.id) arrivals.push({ tick: sim.state.tick, clock: clock(sim), event: structuredClone(event) });
  });
  const step = (label: string) => {
    const startAt = clock(sim), before = order.workedMinutes;
    sim.step(.25);
    const windows = clinicalDoctorWorkWindows(sim, doctor, site.id, 4);
    const wage = wages.find(row => row.tick === sim.state.tick);
    const arrival = arrivals.find(row => row.tick === sim.state.tick);
    const row = { label, tick: sim.state.tick, startAt, endAt: clock(sim), beforeMinutes: before, workedMinutes: order.workedMinutes,
      patientPosition: structuredClone(patient.position), doctorPosition: structuredClone(doctor.position), patientNeeds: structuredClone(patient.needs),
      doctorNeeds: structuredClone(doctor.needs), sameStation: clinicalPairAtServiceStation(sim, site, doctor.id, patient.id),
      currentWage: wage, currentArrival: arrival, clippedDoctorWindows: windows, received: order.receivedUnits, reserved: order.reservedUnits,
      consumed: order.consumedUnits, purchasePaid: order.purchasePaid, receipts: structuredClone(order.receipts) };
    observations.push(row); record('trace.json', observations); record(label + '.save.json', sim.exportSave());
    assert.ok(Math.abs(clock(sim) - startAt - 4) <= 1e-7);
    assert.ok(wage?.canonical && wage.event.amount > 0 && wage.event.minutes > 0, 'real core current canonical positive doctor pay is required');
    assert.equal(wage.event.siteId, site.id);
    assert.ok(wage.event.creditedWorkStartAt >= startAt - 1e-7 && wage.event.creditedWorkEndAt <= clock(sim) + 1e-7);
    assert.ok(arrival && arrival.event.activityObservedTick === sim.state.tick && arrival.event.activityObservedClock === clock(sim));
    assert.equal(arrival.event.siteId, site.id); assert.equal(arrival.event.purpose, 'work');
    assert.deepEqual(arrival.event.activityPosition, doctor.position); assert.equal(row.sameStation, true);
    return row;
  };
  record('declared-initial.json', { scope: 'Controlled original clinic fixture; not natural patients or firstperson travel', clock: clock(sim), nativeDoctorId: doctor.id, nativePatientId: patient.id, originalPatientHealth: sim.state.extension!.actorProfiles[patient.id].health,
    initialPatientNeeds: initialNeeds, initialPatientMoney: money, actuallyEscrowed: money - sim.state.player.money, point, order: structuredClone(order) });
  step('procure1655');
  assert.equal(order.workedMinutes, 0, 'finance procurement after people cannot borrow prior care');
  assert.equal(order.receivedUnits, 1); assert.equal(order.reservedUnits, 1); assert.equal(order.receipts.length, 1);
  assert.ok(order.purchasePaid > 0 && order.escrow > 0);
  const paid = order.purchasePaid, receipt = JSON.stringify(order.receipts);
  step('care1659');
  assert.ok(Math.abs(order.workedMinutes - 4) <= 1e-7);
  const closing = step('closing1703');
  assert.ok(Math.abs(order.workedMinutes - 5) <= 1e-7, '16:59→17:03 must add exactly one actual pre-closing minute to the existing four');
  assert.equal(closing.clippedDoctorWindows.length, 1);
  assert.ok(Math.abs(closing.clippedDoctorWindows[0].start - (16 * 60 + 59)) <= 1e-7);
  assert.ok(Math.abs(closing.clippedDoctorWindows[0].end - 17 * 60) <= 1e-7);
  step('afterClose1707');
  assert.ok(Math.abs(order.workedMinutes - 5) <= 1e-7, '17:03→17:07 must add zero after-hours care');
  assert.equal(order.receivedUnits, 1); assert.equal(order.reservedUnits, 1); assert.equal(order.consumedUnits, 0);
  assert.equal(order.purchasePaid, paid); assert.equal(JSON.stringify(order.receipts), receipt);
  assert.equal(order.completedAt, null); assert.equal(sim.state.clinical!.stats.completed, 0);
  assert.equal(sim.state.player.money, money - 30, 'neither paused care nor preserved material refunds or pays the patient');
  record('PASS-summary.json', { status: 'PASS_CONTROLLED_PRIVATE_CLOSING_PREFIX_ONLY', fixtureBuildings: sim.worldDefinition.buildings.length, fixtureNpcCount: sim.state.citizens.length,
    initialClock: 16 * 60 + 51, endClock: clock(sim), originalQuarterSteps: 4, speed: 16, gainedCareMinutes: 5, actualClosingPrefixMinutes: 1,
    receivedUnits: order.receivedUnits, reservedUnits: order.reservedUnits, consumedUnits: order.consumedUnits, order: structuredClone(order),
    noPhasePinsOrSubsequentResets: true, currentCanonicalWages: wages, actualDoctorArrivals: arrivals,
    limitations: ['Controlled initial clock and same-station body intent', 'Paid private original caller; not autonomous public6 patients or normalfirstperson travel', 'No twenty-minute completion, consumed material or health benefit claimed'] });
});
