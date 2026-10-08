import assert from 'node:assert/strict';
import test from 'node:test';
import { PAID_CLINICAL_TRIAGE_POLICY, paidClinicalTriageOrders, type PaidClinicalPatientNow, type PaidClinicalQueueOrder } from '../src/simulation/clinical-paid-triage.ts';
import { selectPaidClinicalTriageForNewCity, validateClinicalState } from '../src/simulation/clinical.ts';
import { Simulation } from '../src/simulation.ts';
import { cashSnapshot, foodCustodySnapshot } from '../scripts/economy-resume-custody.ts';
import { advance, at, attachControls, begin, cash, fixture, pin, runtime, station, type Controls } from './clinical-presence-fixture.ts';

// Pure rows are explicit synthetic
// contracts. Integration fixtures pin positions/needs and choose health once;
// they are neither autonomous commuting nor normal-player/GL journey evidence.
const selection = { policyId: PAID_CLINICAL_TRIAGE_POLICY, siteId: 'pair-clinic' };
const order = (id: string, startedAt = 480, fields: Partial<PaidClinicalQueueOrder> = {}): PaidClinicalQueueOrder => ({
  id, patientId: id, siteId: selection.siteId, startedAt, state: 'awaitingDoctor', funded: 30,
  reservedUnits: 1, workedMinutes: 0, requiredMinutes: 20, completedAt: null, cancelledAt: null, ...fields,
});
const person = (health: number, fields: Partial<PaidClinicalPatientNow> = {}): PaidClinicalPatientNow => ({ alive: true, payerAlive: true, health, symptomSeverity: 0, ...fields });
const ids = (rows: readonly PaidClinicalQueueOrder[]) => rows.map(row => row.id);

test('declaring a paid queue preserves physical custody and rejects hidden metadata wallets', () => {
  const sim = new Simulation(fixture()), world = sim.worldDefinition;
  const before = cashSnapshot(sim, world).total;
  assert.ok(selectPaidClinicalTriageForNewCity(sim, selection.siteId).ok);
  assert.equal(cashSnapshot(sim, world).total, before);
  const saved = JSON.parse(sim.exportSave());
  assert.ok(Number.isFinite(foodCustodySnapshot(saved, world).total));
  saved.state.clinical.paidTriage.wallet = 30;
  assert.throws(() => cashSnapshot(saved, world), /CUSTODY_UNKNOWN/);
  const original = sim.exportSave();
  assert.equal(sim.importSave(JSON.stringify(saved)).ok, false);
  assert.equal(sim.exportSave(), original);
});

test('paid triage sends a later, worse-health funded contract before a healthier old contract without mutating source', () => {
  const rows = [order('older', 480), order('severe', 499)], before = JSON.stringify(rows);
  const result = paidClinicalTriageOrders(rows, selection, 500, row => person(row.id === 'severe' ? 10 : 65));
  assert.deepEqual(ids(result), ['severe', 'older']); assert.equal(JSON.stringify(rows), before);
  assert.equal(result[0], rows[1]); assert.equal(result[1], rows[0]);
});

test('paid triage reads actual current symptom severity and recomputes rather than retaining a cached place', () => {
  const rows = [order('healthy'), order('symptomatic')];
  assert.deepEqual(ids(paidClinicalTriageOrders(rows, selection, 500, row => person(90, { symptomSeverity: row.id === 'symptomatic' ? 40 : 0 }))), ['symptomatic', 'healthy']);
  assert.deepEqual(ids(paidClinicalTriageOrders(rows, selection, 501, row => person(row.id === 'healthy' ? 20 : 90))), ['healthy', 'symptomatic']);
});

test('equal severity uses true registration waiting age then stable IDs without inventing waiting time', () => {
  const rows = [order('later', 490), order('older', 480)];
  assert.deepEqual(ids(paidClinicalTriageOrders(rows, selection, 500, () => person(50))), ['older', 'later']);
  const ties = [order('z', 480), order('a', 480)];
  assert.deepEqual(ids(paidClinicalTriageOrders(ties, selection, 500, () => person(50))), ['a', 'z']);
  assert.deepEqual(ids(paidClinicalTriageOrders(ties.slice().reverse(), selection, 500, () => person(50))), ['a', 'z']);
});

test('missing funds/material, dead payer, refunded or future contract cannot participate in priority', () => {
  const rows = [order('low'), order('no-material', 480, { reservedUnits: 0 }), order('dead-payer'), order('refund', 480, { state: 'refundPending', cancelledAt: 490 }), order('future', 501), order('unfunded', 480, { funded: 0 }), order('high')];
  const result = paidClinicalTriageOrders(rows, selection, 500, row => person(row.id === 'low' ? 65 : 10, { payerAlive: row.id !== 'dead-payer' }));
  assert.deepEqual(ids(result), ['high', 'no-material', 'dead-payer', 'refund', 'future', 'unfunded', 'low']);
  for (const index of [1, 2, 3, 4, 5]) assert.equal(result[index], rows[index]);
});

test('legacy paid queue is the same array and reads no new profile or symptom state', () => {
  const rows = [order('first'), order('second')], before = JSON.stringify(rows);
  assert.equal(paidClinicalTriageOrders(rows, undefined, NaN, () => { throw new Error('legacy must not read triage input'); }), rows);
  assert.equal(JSON.stringify(rows), before);
});

test('single-clinic sorting keeps another clinic and its original contract positions unchanged', () => {
  const rows = [order('mild'), order('other', 480, { siteId: 'other-clinic' }), order('severe')];
  const result = paidClinicalTriageOrders(rows, selection, 500, row => person(row.id === 'mild' ? 70 : 20));
  assert.deepEqual(ids(result), ['severe', 'other', 'mild']); assert.equal(result[1], rows[1]);
});

function controlledQueue(triage: boolean) {
  const sim = new Simulation(fixture()), controls: Controls = new Map();
  const site = sim.worldDefinition.buildings.find(site => site.kind === 'clinic')!;
  if (triage) assert.equal(selectPaidClinicalTriageForNewCity(sim, site.id).ok, true);
  const doctor = sim.state.citizens.find(row => row.workId === site.id && row.role === '医生' && sim.state.extension!.actorProfiles[row.id].age >= 18)!;
  assert.ok(doctor);
  const patients = sim.state.citizens.filter(row => row.id !== doctor.id && !['医生', '官员', '学生'].includes(row.role) && sim.state.extension!.actorProfiles[row.id].age >= 18).slice(0, 3);
  assert.equal(patients.length, 3);
  for (const row of sim.state.citizens) { const home = sim.worldDefinition.buildings.find(site => site.id === row.homeId)!; pin(sim, controls, row.id, home, home.door); }
  pin(sim, controls, doctor.id, site, station(site, 0), 'work');
  attachControls(sim, controls); sim.setFocus(station(site, 0), 'walk');
  sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  advance(sim, 4); assert.equal(sim.isOnDuty(doctor.id, site.id), true);
  // Keep patients at home until these explicit test registrations. Otherwise
  // an initially low-health native resident could have self-paid beforehand.
  for (const row of patients) pin(sim, controls, row.id, site, station(site, 0));
  patients.forEach((row, index) => { sim.state.extension!.actorProfiles[row.id].health = [65, 40, 20][index]; });
  const orders = patients.map(row => begin(sim, site, row.id));
  return { sim, controls, site, doctor, patients, orders };
}

test('controlled real paid-doctor integration gives the existing two slots to later severe paid patients, legacy keeps insertion order', () => {
  for (const triage of [false, true]) {
    const { sim, orders } = controlledQueue(triage), beforeIds = orders.map(row => row.id), money = cash(sim);
    advance(sim, 4);
    assert.deepEqual(sim.state.clinical!.orders.map(row => row.id), beforeIds, 'saved insertion order must remain intact');
    assert.ok(Math.abs(cash(sim) - money) < 1e-5);
    assert.equal(orders.filter(row => row.workedMinutes > 0).length, 2, 'no extra paid slot');
    assert.equal(orders[triage ? 0 : 2].workedMinutes, 0);
    assert.ok(orders[1].workedMinutes > 0); assert.ok(orders[triage ? 2 : 0].workedMinutes > 0);
    for (const row of orders) { assert.equal(row.reservedUnits, 1); assert.equal(row.consumedUnits, 0); assert.equal(row.funded, 30); assert.equal(row.requiredMinutes, 20); }
  }
});

test('severe patient on another real supported public floor cannot take the original same-station doctor slot', () => {
  const { sim, controls, site, patients, orders } = controlledQueue(true), money = cash(sim);
  pin(sim, controls, patients[2].id, site, station(site, 1));
  advance(sim, 4);
  assert.equal(orders[2].workedMinutes, 0); assert.equal(orders[2].consumedUnits, 0); assert.equal(orders[2].reservedUnits, 1);
  assert.ok(orders[0].workedMinutes > 0); assert.ok(orders[1].workedMinutes > 0);
  assert.ok(Math.abs(cash(sim) - money) < 1e-5);
});

test('triage activation is an explicit empty-new-city choice and rejects undeclared, wrong-version or wrong-site saved semantics', () => {
  const sim = new Simulation(fixture()), before = sim.exportSave(), site = sim.worldDefinition.buildings.find(site => site.kind === 'clinic')!;
  assert.equal(selectPaidClinicalTriageForNewCity(sim, 'missing').ok, false); assert.equal(sim.exportSave(), before);
  assert.equal(selectPaidClinicalTriageForNewCity(sim, site.id).ok, true);
  validateClinicalState(sim.state, sim.worldDefinition);
  const chosen = sim.exportSave(); assert.equal(selectPaidClinicalTriageForNewCity(sim, site.id).ok, false); assert.equal(sim.exportSave(), chosen);
  for (const patch of [{ version: 1 }, { paidTriage: undefined }, { paidTriage: { policyId: PAID_CLINICAL_TRIAGE_POLICY, siteId: 'missing' } }]) {
    const candidate = structuredClone(sim.state); Object.assign(candidate.clinical!, patch);
    assert.throws(() => validateClinicalState(candidate, sim.worldDefinition), /临床存档无效/);
  }
});

test('controlled triage cold reader retains exact save and two future ordinary calls without installing a hidden queue or changing legacy new city', () => {
  const { sim, controls, orders } = controlledQueue(true); advance(sim, 4);
  assert.equal(orders[0].workedMinutes, 0);
  const saved = sim.exportSave(), next = new Simulation(sim.worldDefinition), result = next.importSave(saved);
  assert.equal(result.ok, true, result.message); assert.equal(next.exportSave(), saved);
  assert.equal(next.state.clinical!.version, 2); assert.deepEqual(next.state.clinical!.paidTriage, selection);
  attachControls(next, controls);
  for (let tick = 0; tick < 2; tick++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave()); }
  const legacy = new Simulation(fixture()); assert.equal(legacy.state.clinical!.version, 1); assert.equal(legacy.state.clinical!.paidTriage, undefined);
  assert.ok(at(sim) > 480); assert.ok(runtime(sim).attendance);
});
