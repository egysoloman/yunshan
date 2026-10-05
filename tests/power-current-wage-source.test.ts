import assert from 'node:assert/strict';
import test from 'node:test';
import { isCanonicalNpcWage, isCanonicalPlayerLaborWage } from '../src/simulation';
import type { Simulation } from '../src/simulation';
import { installPower } from '../src/simulation/power';
import type { PowerRepair, PowerState } from '../src/simulation/power';
import type { SimState } from '../src/types';
import { at, powerWorld, setupPaid, workPoint } from './power-fixture';

/** A controlled installed-listener envelope, not a native save or a world run.
 * The explicitly supplied supported body, fixture task/material/funds and
 * working identity make all the OLD numeric/physical checks pass. Nothing
 * in this fixture earned a wage. No Simulation/step/import is invoked here.
 * Thus generic claimed windows must not advance the otherwise ready repair.
 */
export function genericRepairEnvelope(actorKind: 'npc' | 'player') {
  const world = powerWorld(), site = world.buildings.find(b => b.id === 'core-energy-south')!;
  const point = workPoint(site), actorId = actorKind === 'npc' ? 'fixture-technician' : 'player';
  const job: PowerRepair = { id: 'power-repair-1', payerId: 'player', startedAt: 480, lastObservedAt: 480,
    status: 'working', reason: 'controlled ready task', technicianId: null, point: null,
    restoreP: 5, faultUnits: [{ faultId: 1, quantityP: 5 }], requiredMinutes: 60, workedMinutes: 0, contributions: {},
    funded: 100, escrow: 96, purchasePaid: 4, serviceFees: 0, refunded: 0,
    receipts: [{ purchasedAt: 480, shopId: 'controlled-material', quantity: 1, unitPrice: 4, gross: 4, net: 3.68, tax: .32 }],
    receivedUnits: 1, reusedUnits: 0, reservedUnits: 1, consumedUnits: 0, reservedAt: 480, returnedAt: null,
    budgetId: null, approvedAt: null, approvedBy: [], authorizedCap: 0,
    completedAt: null, cancelledAt: null, retryAt: 540 };
  const power: PowerState = { version: 1, activatedAt: 480, sourceSiteId: 'core-main', operatorSiteId: site.id as 'core-energy-south', networkKind: 'legacy-city-bus',
    faults: [{ id: 1, occurredAt: 480, districtId: site.districtId, severity: 10, addedLossP: 9.3, repairedP: 0 }], lossP: 9.3,
    nextRepairId: 2, repairs: [job], stock: { receivedUnits: 1, consumedUnits: 0, availableUnits: 0 },
    dispatch: null, buildingMeters: {}, vehicleMeters: {}, totals: { suppliedPMinutes: 0, demandedPMinutes: 0, unservedPMinutes: 0, curtailedPMinutes: 0 },
    capacityHistory: [], capacityArchive: { count: 0, minutes: 0, researchCount: 0, educationCount: 0 },
    researchBaseline: 0, unobservedResearchCompletions: 0, nextPublicReviewAt: 540 };
  const citizen = { id: 'fixture-technician', role: '工程师', workId: site.id, state: 'working', position: { ...point },
    money: 300, needs: { hunger: 100, fatigue: 100, social: 100, fun: 100 } };
  const state = { tick: 1, day: 0, hour: 482 / 60, power, voxels: [], citizens: [citizen], treasury: 1000,
    player: { position: { ...point }, role: 'scientist', identities: ['traveler', 'scientist'], money: 600, needs: { hunger: 100, fatigue: 100, social: 100, fun: 100 } },
    extension: { lastUpdate: 482, actorProfiles: { 'fixture-technician': { alive: true, age: 30, health: 100 }, player: { alive: true, age: 30, health: 100 } }, stats: { researchCompleted: 0 } },
  } as unknown as SimState;
  const phases = new Map<string, ((state: SimState, minutes: number) => void)[]>(), events = new Map<string, ((event: any) => void)[]>();
  const sim = { state, worldDefinition: world,
    onPhase(name: string, callback: (state: SimState, minutes: number) => void) { const rows = phases.get(name) ?? []; rows.push(callback); phases.set(name, rows); },
    onEvent(name: string, callback: (event: any) => void) { const rows = events.get(name) ?? []; rows.push(callback); events.set(name, rows); },
    onLoad() {}, registerCommandHandler() {}, registerSaveValidator() {},
    isNearBuilding(_site: unknown, position = state.player.position, radius = 2) { return Math.hypot(position.x - point.x, position.y - point.y, position.z - point.z) <= radius; },
    hasIdentity(role: string) { return state.player.identities?.includes(role as 'scientist') ?? false; },
  } as unknown as Simulation;
  return { sim, state, job, power, point, actorId, phases, events };
}

for (const actorKind of ['npc', 'player'] as const) {
  test(`generic ${actorKind} funded-looking window cannot change repair, resources or wages`, () => {
    for (const zero of [false, true]) {
      const f = genericRepairEnvelope(actorKind);
      installPower(f.sim, { activate() {}, legacy() { return null; }, publicSupply() { return 1; }, isCanonicalDisaster() { return false; }, isCanonicalResearchCompletion() { return false; } });
      const before = JSON.stringify({ loss: f.power.lossP, faults: f.power.faults, stock: f.power.stock, reserved: f.job.reservedUnits, consumed: f.job.consumedUnits,
        funds: [f.state.treasury, f.state.player.money, f.state.citizens[0].money, f.job.funded, f.job.escrow, f.job.purchasePaid, f.job.serviceFees], contributions: f.job.contributions });
      for (const callback of f.phases.get('time')!) callback(f.state, 2);
      const fake = Object.freeze({ type: 'wage-earned', citizenId: f.actorId, siteId: 'core-energy-south', purpose: 'scientist',
        minutes: 2, amount: zero ? 0 : 1, creditedWorkStartAt: 480, creditedWorkEndAt: 482 });
      for (const callback of f.events.get('wage-earned')!) callback(fake);
      for (const callback of f.phases.get('people')!) callback(f.state, 2);
      assert.equal(f.job.workedMinutes, 0, 'a matching current clock and real work point do not authenticate a wage');
      assert.equal(f.job.technicianId, null);
      assert.equal(JSON.stringify({ loss: f.power.lossP, faults: f.power.faults, stock: f.power.stock, reserved: f.job.reservedUnits, consumed: f.job.consumedUnits,
        funds: [f.state.treasury, f.state.player.money, f.state.citizens[0].money, f.job.funded, f.job.escrow, f.job.purchasePaid, f.job.serviceFees], contributions: f.job.contributions }), before);
    }
  });
}

function materialReady(sim: Simulation, job: PowerRepair) {
  for (let step = 0; step < 90 && job.reservedUnits !== 1; step++) sim.step(.25);
  assert.equal(job.reservedUnits, 1, job.reason);
}
function repairComplete(sim: Simulation, job: PowerRepair) {
  for (let step = 0; step < 90 && job.status !== 'completed'; step++) sim.step(.25);
  assert.equal(job.status, 'completed', job.reason); assert.equal(job.workedMinutes, 60);
  assert.equal(job.consumedUnits, 1); assert.equal(job.reservedUnits, 0);
}

// These two positives reuse the ORIGINAL declared controls in power-fixture:
// generated staff, fixed named body/needs, controlled native rain branch and
// player initial identities. Original wages, actual finite procurement and
// task rules execute. They prove a functional contract, not natural city life.
test('actual generated technician positive wage keeps the original material and60-minute repair', () => {
  const { sim, presence, job } = setupPaid(); let count = 0, retained: object | undefined;
  sim.onEvent('wage-earned', event => {
    if (event.citizenId !== presence.actor.id || event.siteId !== presence.site.id) return;
    assert.ok((event.amount ?? 0) > 0); assert.ok(Object.isFrozen(event));
    assert.equal(isCanonicalNpcWage(event, sim), true);
    assert.equal(isCanonicalNpcWage({ ...event }, sim), false);
    assert.equal(isCanonicalNpcWage(event, { state: sim.state } as Simulation), false);
    assert.equal(isCanonicalPlayerLaborWage(event, sim), false);
    count++; retained = event;
  });
  materialReady(sim, job); repairComplete(sim, job); assert.ok(count > 0);
  const completed = job.workedMinutes, previous = retained!; sim.step(.25);
  assert.equal(isCanonicalNpcWage(previous, sim), false, 'retained original object cannot certify the next frame');
  assert.equal(job.workedMinutes, completed);
});

test('actual player cash writer certifies the original funded shift for one repair without duplicate wages', () => {
  const { sim, presence, job } = setupPaid(); presence.leave(); sim.setFocus(presence.point, 'walk');
  materialReady(sim, job); let count = 0, retained: object | undefined;
  sim.onEvent('wage-earned', event => {
    if (event.citizenId !== 'player' || event.siteId !== presence.site.id) return;
    assert.ok((event.amount ?? 0) > 0); assert.ok(Object.isFrozen(event));
    assert.equal(isCanonicalPlayerLaborWage(event, sim), true);
    assert.equal(isCanonicalPlayerLaborWage({ ...event }, sim), false);
    assert.equal(isCanonicalPlayerLaborWage(event, { state: sim.state } as Simulation), false);
    assert.equal(isCanonicalNpcWage(event, sim), false);
    count++; retained = event;
  });
  const started = sim.command({ type: 'work', targetId: presence.site.id }); assert.ok(started.ok, started.message);
  const gross = sim.state.playerLabor!.job!.gross, start = at(sim);
  for (let step = 0; step < 30; step++) sim.step(.25);
  assert.equal(at(sim), start + 60); assert.equal(job.status, 'completed'); assert.equal(job.workedMinutes, 60);
  const shift = sim.state.playerLabor!.history.at(-1)!;
  assert.equal(shift.workedMinutes, 60); assert.ok(Math.abs(shift.paidGross - gross) < 1e-6);
  assert.equal(shift.escrow, 0); assert.equal(job.consumedUnits, 1); assert.ok(count > 0);
  const previous = retained!; sim.step(.25); assert.equal(isCanonicalPlayerLaborWage(previous, sim), false);
});
