import assert from 'node:assert/strict';
import test from 'node:test';
import { getCanonicalNpcFullSettlement, isCanonicalNpcWage, type Simulation } from '../src/simulation';
import type { SimState, WorldDefinition } from '../src/types';
import {
  hydroMaintenanceActivityClaims, hydroMaintenanceReadyAt, hydroMaintenanceTaskActorIds,
  hydroMaintenanceTaskPoint, installHydroMaintenance, isCanonicalHydroMaintenanceReady,
  isCanonicalHydroMaintenanceState,
  validateHydroMaintenanceDefinition, validateHydroMaintenanceState,
  type HydroMaintenanceJob, type HydroMaintenanceLaborReceipt, type HydroMaintenanceState,
} from '../src/simulation/hydro-maintenance';
import { validateJointActorActivityCapacity } from '../src/simulation/activity-capacity';
import { hydroMaintenanceWorld } from './hydro-maintenance-fixture';

const ACTOR = 'citizen-3', SITE = 'other-city-hydro-core';
const position = () => ({ x: 20, y: .6, z: .3 });
const point = () => ({ id: 'legacy:' + SITE + ':0', floor: 0, position: position() });
const clone = <T>(value: T): T => structuredClone(value);
const jobOf = (state: SimState): HydroMaintenanceJob => state.hydroMaintenance!.job!;

/** Controlled, self-consistent rule input only. These records were not earned,
 * bought or paid by a running city. There is no Simulation construction, step,
 * import or exported save here; the cold validator cannot mint provenance.
 */
function coldFixture(): { world: WorldDefinition; state: SimState } {
  const world = hydroMaintenanceWorld();
  const laborReceipts: HydroMaintenanceLaborReceipt[] = Array.from({ length: 15 }, (_, index) => {
    const startAt = 480 + index * 4, endAt = startAt + 4;
    return {
      actorId: ACTOR, siteId: SITE, role: '工程师', tick: index + 1, at: endAt,
      phaseMinutes: 4, startAt, endAt, minutes: 4, position: position(), point: point(),
      age: 30, health: 100, hunger: 80, fatigue: 80,
      source: { citizenId: ACTOR, siteId: SITE, shopId: null, startAt, endAt,
        minutes: 4, amount: .4, ratePerMinute: .1 },
    };
  });
  const job: HydroMaintenanceJob = {
    id: 'hydro-maintenance-1', payerId: 'player', startedAt: 480, startedTick: 0,
    lastObservedAt: 540, status: 'completed', reason: 'Controlled complete cold history.',
    technicianId: ACTOR, point: point(), requiredMinutes: 60, workedMinutes: 60,
    funded: 100, escrow: 0, purchasePaid: 4, serviceFees: 96, refunded: 0,
    receivedUnits: 1, reservedUnits: 0, consumedUnits: 1, returnedUnits: 0,
    receipts: [{ purchasedAt: 480, tick: 0, shopId: 'shop-other-city-workshop',
      quantity: 1, unitPrice: 4, gross: 4, net: 3.68, tax: .32, taxRate: .08 }],
    laborReceipts,
    payment: { citizenId: ACTOR, shopId: null, amount: 45, requestedAmount: 45,
      net: 41.4, tax: 3.6, at: 1020, tick: 135, settledThroughAt: 1020 },
    laborCompletedAt: 540, completedAt: 1020, completedTick: 135, cancelledAt: null, retryAt: 540,
  };
  const body: HydroMaintenanceState = { version: 1, kind: 'paid-hydro-maintenance',
    sourceId: 'other-hydro', operatorSiteId: SITE, activatedAt: 480, job };
  const state = {
    tick: 136, day: 0, hour: 1024 / 60, hydroMaintenance: body, voxels: [],
    treasury: 80000, taxRate: .08,
    shops: [{ id: 'shop-other-city-workshop', buildingId: 'other-city-workshop',
      districtId: 'other-city', inventory: 89, price: 8, revenue: 4, profit: 3.68,
      customers: 0, open: true, employees: 1, cash: 303.68 }],
    citizens: [{ id: ACTOR, name: 'Controlled engineer', districtId: 'other-city',
      homeId: 'other-city-home', workId: SITE, role: '工程师', position: position(),
      state: 'working', destinationId: SITE, money: 341.4,
      needs: { hunger: 80, fatigue: 80, social: 80, fun: 80 }, tier: 'active' }],
    player: { position: position(), role: 'traveler', identities: ['traveler'], money: 500,
      vehicleId: null, needs: { hunger: 80, fatigue: 80, social: 80, fun: 80 } },
    extension: { lastUpdate: 1024, publicLedger: [],
      actorProfiles: { [ACTOR]: { alive: true, age: 30, health: 100 },
        player: { alive: true, age: 24, health: 100 } } },
  } as unknown as SimState;
  return { world, state };
}

function awaitingPayment(state: SimState): HydroMaintenanceJob {
  const job = jobOf(state);
  job.payment = null; job.completedAt = null; job.completedTick = null; job.serviceFees = 0; job.escrow = 96;
  job.status = 'awaitingWageSettlement';
  return job;
}

function partialLabor(state: SimState, count: number): HydroMaintenanceJob {
  const job = awaitingPayment(state);
  job.laborReceipts = job.laborReceipts.slice(0, count); job.workedMinutes = count * 4;
  job.laborCompletedAt = null; job.consumedUnits = 0; job.reservedUnits = 1;
  job.status = 'working'; job.lastObservedAt = 480 + count * 4;
  if (count === 0) { job.technicianId = null; job.point = null; }
  return job;
}

function expectRejected(mutate: (state: SimState, world: WorldDefinition) => void): void {
  const { state, world } = coldFixture();
  validateHydroMaintenanceState(state, world);
  mutate(state, world);
  assert.throws(() => validateHydroMaintenanceState(state, world), /水电维护契约/);
}

test('maintenance definition binds one declared hydro machine to its original energy workplace', () => {
  const world = hydroMaintenanceWorld();
  validateHydroMaintenanceDefinition(world);
  const mutations: ((copy: WorldDefinition) => void)[] = [
    copy => { Reflect.deleteProperty(copy.hydroMaintenance!, 'sourceId'); },
    copy => { Reflect.set(copy.hydroMaintenance!, 'extra', true); },
    copy => { Reflect.set(copy.hydroMaintenance!, 'kind', 'unknown-maintenance'); },
    copy => { Reflect.set(copy.hydroMaintenance!, 'version', 2); },
    copy => { Reflect.set(copy.hydroMaintenance!, 'initialNeedsRepair', false); },
    copy => { Reflect.set(copy.hydroMaintenance!, 'requiredMinutes', 59); },
    copy => { Reflect.set(copy.hydroMaintenance!, 'materialUnits', 2); },
    copy => { Reflect.set(copy.hydroMaintenance!, 'playerEscrow', 99); },
    copy => { copy.hydroMaintenance!.sourceId = 'different-machine'; },
    copy => { copy.hydroMaintenance!.operatorSiteId = 'other-city-workshop'; },
    copy => { copy.buildings.find(site => site.id === SITE)!.facility = 'data'; },
    copy => { const grid = copy.powerGrid!; if (grid.version === 2) grid.sources.push(clone(grid.sources[0])); },
    copy => { Reflect.set(copy.powerGrid!, 'version', 1); },
  ];
  for (const mutate of mutations) {
    const copy = clone(world); mutate(copy);
    assert.throws(() => validateHydroMaintenanceDefinition(copy), /水电维护契约/);
  }
});

test('undeclared domains reject transplanted maintenance state; declared null jobs stay stopped', () => {
  const { state, world } = coldFixture();
  delete world.hydroMaintenance;
  assert.throws(() => validateHydroMaintenanceState(state, world), /未声明域/);
  delete state.hydroMaintenance;
  validateHydroMaintenanceState(state, world);
  const declared = coldFixture(); declared.state.hydroMaintenance!.job = null;
  validateHydroMaintenanceState(declared.state, declared.world);
  assert.equal(hydroMaintenanceReadyAt(declared.state, 1024), false);
  assert.equal(isCanonicalHydroMaintenanceReady(declared.state, 1024), false);
  assert.equal(hydroMaintenanceActivityClaims(declared.state).length, 0);
  assert.equal(hydroMaintenanceTaskActorIds(declared.state).size, 0);
  delete declared.state.hydroMaintenance;
  assert.throws(() => validateHydroMaintenanceState(declared.state, declared.world), /声明域/);
});

test('cold complete history becomes selectable strictly after payment completion, never canonical', () => {
  const { state, world } = coldFixture(), before = JSON.stringify(state);
  validateHydroMaintenanceState(state, world);
  assert.equal(JSON.stringify(state), before, 'validation is read-only');
  assert.equal(hydroMaintenanceReadyAt(state, 1019), false);
  assert.equal(hydroMaintenanceReadyAt(state, 1020), false, 'earlier energy in the payment tick stays stopped');
  assert.equal(hydroMaintenanceReadyAt(state, 1024), true);
  for (const invalidAt of [NaN, Infinity, -Infinity]) assert.equal(hydroMaintenanceReadyAt(state, invalidAt), false);
  assert.equal(isCanonicalHydroMaintenanceReady(state, 1024), false);
  const copy = clone(state); validateHydroMaintenanceState(copy, world);
  assert.equal(hydroMaintenanceReadyAt(copy, 1024), true);
  assert.equal(isCanonicalHydroMaintenanceReady(copy, 1024), false, 'valid copied history does not mint a live capability');
});

test('independent lawful display and extension clocks cannot enable the earlier energy phase of the payment tick', () => {
  const { state, world } = coldFixture();
  state.tick = 135; state.hour = (1020 + 1e-8) / 60; state.extension!.lastUpdate = 1020;
  validateHydroMaintenanceState(state, world);
  assert.equal(hydroMaintenanceReadyAt(state, 1020 + 1e-8, 135), false);
  assert.equal(hydroMaintenanceReadyAt(state, 1020 + 1e-8), false, 'default request uses the current native tick');
  assert.equal(hydroMaintenanceReadyAt(state, 1024, 136), true);
  state.hour = 17; state.extension!.lastUpdate = 1020 + 1e-8;
  jobOf(state).completedAt = 1020 + 1e-8; jobOf(state).payment!.at = 1020 + 1e-8;
  validateHydroMaintenanceState(state, world);
  assert.equal(hydroMaintenanceReadyAt(state, 1020, 135), false);
  assert.equal(hydroMaintenanceReadyAt(state, 1024, 136), true);
  expectRejected(copy => { jobOf(copy).completedTick = 134; });
  expectRejected(copy => { jobOf(copy).completedTick = null; });
});

test('all sixty funded minutes and consumed material still await actual salary settlement', () => {
  const { state, world } = coldFixture(), job = awaitingPayment(state);
  validateHydroMaintenanceState(state, world);
  assert.equal(job.workedMinutes, 60); assert.equal(job.consumedUnits, 1);
  assert.equal(job.escrow, 96); assert.equal(job.serviceFees, 0);
  assert.equal(hydroMaintenanceReadyAt(state, 1024), false);
  assert.equal(hydroMaintenanceTaskActorIds(state).size, 0, 'waiting for cash does not claim more onsite minutes');
  assert.equal(hydroMaintenanceTaskPoint(state, ACTOR, SITE), null);
  expectRejected(copy => { awaitingPayment(copy).status = 'working'; });
});

test('completion rejects deleted purchase, labor, source and settlement evidence', () => {
  const mutations: ((state: SimState) => void)[] = [
    state => { jobOf(state).payment = null; },
    state => { jobOf(state).laborReceipts = []; },
    state => { jobOf(state).laborReceipts.pop(); },
    state => { Reflect.deleteProperty(jobOf(state).laborReceipts[0], 'source'); },
    state => { Reflect.deleteProperty(jobOf(state).laborReceipts[0].source, 'ratePerMinute'); },
    state => { jobOf(state).receipts = []; },
    state => { jobOf(state).laborCompletedAt = null; },
    state => { jobOf(state).technicianId = 'unknown-resident'; },
    state => { jobOf(state).point = null; },
  ];
  for (const mutate of mutations) expectRejected(mutate);
});

test('only whole salary covering earned slices and their cutoff can settle maintenance', () => {
  expectRejected(state => {
    const payment = jobOf(state).payment!;
    payment.amount = 22.5; payment.net = 20.7; payment.tax = 1.8;
  });
  expectRejected(state => {
    const payment = jobOf(state).payment!;
    payment.amount = payment.requestedAmount = 5; payment.net = 4.6; payment.tax = .4;
  });
  expectRejected(state => { jobOf(state).payment!.settledThroughAt = 539; });
  expectRejected(state => { jobOf(state).payment!.at = 539; });
  expectRejected(state => { jobOf(state).payment!.tick = 14; });
  expectRejected(state => { jobOf(state).payment!.citizenId = 'another-engineer'; });
  expectRejected(state => { jobOf(state).payment!.net++; });
});

test('labor cannot overlap, precede materials, borrow a wage window or exceed one phase', () => {
  expectRejected(state => {
    const receipt = jobOf(state).laborReceipts[1];
    receipt.startAt = receipt.source.startAt = 483; receipt.endAt = receipt.source.endAt = 487;
  });
  expectRejected(state => { jobOf(state).receipts[0].purchasedAt = 481; });
  expectRejected(state => {
    const source = jobOf(state).laborReceipts[0].source;
    source.endAt = 483; source.minutes = 3; source.amount = .3;
  });
  expectRejected(state => { jobOf(state).laborReceipts[0].source.siteId = 'other-city-workshop'; });
  expectRejected(state => { jobOf(state).laborReceipts[0].source.amount = .8; });
  expectRejected(state => { jobOf(state).laborReceipts[0].phaseMinutes = 4.01; });
});

test('historical labor retains engineer qualifications and complete supported bodies', () => {
  expectRejected(state => { jobOf(state).laborReceipts[0].role = 'official'; });
  expectRejected(state => { jobOf(state).laborReceipts[0].position.x = 21.2; });
  expectRejected(state => { jobOf(state).laborReceipts[0].position.y = .9; });
  expectRejected(state => { jobOf(state).laborReceipts[0].point.id = 'legacy:wrong-site:0'; });
  expectRejected(state => { jobOf(state).laborReceipts[0].age = 17; });
  expectRejected(state => { jobOf(state).laborReceipts[0].health = 0; });
  expectRejected(state => { jobOf(state).laborReceipts[0].hunger = 11; });
  expectRejected(state => { jobOf(state).laborReceipts[0].fatigue = 14; });
});

test('strict data readers reject accessors under shallow freezing and sparse receipt arrays', () => {
  let calls = 0;
  const definitionWorld = hydroMaintenanceWorld();
  Object.defineProperty(definitionWorld.hydroMaintenance!, 'requiredMinutes', {
    enumerable: true, get() { calls++; return 60; },
  });
  assert.throws(() => validateHydroMaintenanceDefinition(definitionWorld), /只接受数据字段/);
  assert.equal(calls, 0, 'definition accessor is rejected before it runs');
  const shallow = coldFixture();
  Object.freeze(shallow.state.hydroMaintenance);
  Object.defineProperty(jobOf(shallow.state).laborReceipts[0].source, 'amount', {
    enumerable: true, get() { calls++; return .4; },
  });
  assert.throws(() => validateHydroMaintenanceState(shallow.state, shallow.world), /只接受数据字段/);
  assert.equal(calls, 0, 'a frozen parent cannot hide a nested accessor');
  expectRejected(state => { delete jobOf(state).laborReceipts[2]; });
  expectRejected(state => { delete jobOf(state).receipts[0]; });
  expectRejected(state => { Reflect.set(jobOf(state).laborReceipts, 'hidden', true); });
  expectRejected(state => { Object.setPrototypeOf(jobOf(state).payment!, { forged: true }); });
});

test('exact maintenance slices share actor capacity and unfinished tasks select only their retained station', () => {
  const { state, world } = coldFixture();
  validateHydroMaintenanceState(state, world);
  const claims = hydroMaintenanceActivityClaims(state);
  assert.equal(claims.length, 15);
  assert.equal(claims.reduce((sum, claim) => sum + claim.workedMinutes, 0), 60);
  assert.deepEqual(claims.map(claim => [claim.startedAt, claim.endedAt]),
    Array.from({ length: 15 }, (_, index) => [480 + index * 4, 484 + index * 4]));
  validateJointActorActivityCapacity(state);
  const overlap = clone(state);
  overlap.familyEducation = { pages: [[{ id: 'controlled-course', actorId: ACTOR,
    startedAt: 480, completedAt: 540, workedMinutes: 60 }]], active: [] } as unknown as NonNullable<SimState['familyEducation']>;
  assert.throws(() => validateJointActorActivityCapacity(overlap), /共同期限窗口/);
  partialLabor(state, 1); validateHydroMaintenanceState(state, world);
  assert.deepEqual([...hydroMaintenanceTaskActorIds(state)], [ACTOR]);
  assert.deepEqual(hydroMaintenanceTaskPoint(state, ACTOR, SITE), point());
  assert.equal(hydroMaintenanceTaskPoint(state, 'another-engineer', SITE), null);
  assert.equal(hydroMaintenanceTaskPoint(state, ACTOR, 'other-city-workshop'), null);
});

type NativeEvent = Parameters<Parameters<Simulation['onEvent']>[1]>[0];
type NativeCommand = Parameters<Parameters<Simulation['registerCommandHandler']>[0]>[0];
function listenerEnvelope() {
  const fixture = coldFixture();
  delete fixture.state.hydroMaintenance;
  fixture.state.tick = 0; fixture.state.hour = 8; fixture.state.extension!.lastUpdate = 480;
  const phases = new Map<string, ((state: SimState, minutes: number) => void)[]>();
  const events = new Map<string, ((event: NativeEvent) => void)[]>();
  const loads: (() => void)[] = [], validators: ((state: SimState) => void)[] = [];
  const commands: ((command: NativeCommand) => unknown)[] = [];
  const sim = {
    state: fixture.state, worldDefinition: fixture.world,
    onPhase(name: string, callback: (state: SimState, minutes: number) => void) {
      const rows = phases.get(name) ?? []; rows.push(callback); phases.set(name, rows);
    },
    onEvent(name: string, callback: (event: NativeEvent) => void) {
      const rows = events.get(name) ?? []; rows.push(callback); events.set(name, rows);
    },
    registerCommandHandler(callback: (command: NativeCommand) => unknown) { commands.push(callback); }, registerSaveValidator(callback: (state: SimState) => void) { validators.push(callback); }, onLoad(callback: () => void) { loads.push(callback); },
  } as unknown as Simulation;
  installHydroMaintenance(sim);
  return { ...fixture, sim, phases, events, loads, validators, commands };
}

test('the installed successful load hook deeply freezes the completed source, including unfamiliar shallow parents', () => {
  const envelope = listenerEnvelope(), loaded = coldFixture();
  Object.freeze(loaded.state.hydroMaintenance);
  assert.equal(Object.isFrozen(jobOf(loaded.state)), false);
  envelope.sim.state = loaded.state;
  for (const callback of envelope.loads) callback();
  const body = loaded.state.hydroMaintenance!, job = body.job!;
  assert.equal(isCanonicalHydroMaintenanceState(loaded.state), true);
  for (const value of [body, job, job.payment, job.receipts, job.receipts[0], job.laborReceipts,
    job.laborReceipts[0], job.laborReceipts[0].source, job.laborReceipts[0].point,
    job.laborReceipts[0].point.position, job.laborReceipts[0].position])
    assert.equal(Object.isFrozen(value), true, 'the complete source and all nested evidence are immutable');
  assert.equal(isCanonicalHydroMaintenanceReady(loaded.state, 1024, 136), true);
  assert.equal(isCanonicalHydroMaintenanceReady(loaded.state, 1020 + 1e-8, 135), false);
  assert.equal(Reflect.deleteProperty(job, 'payment'), false);
  assert.equal(Reflect.set(job.laborReceipts[0].source, 'amount', 100), false);
  assert.equal(isCanonicalHydroMaintenanceReady(loaded.state, 1024, 136), true);
  const copied = clone(loaded.state); validateHydroMaintenanceState(copied, loaded.world);
  assert.equal(isCanonicalHydroMaintenanceReady(copied, 1024, 136), false);
  assert.equal(isCanonicalHydroMaintenanceState(copied), false);
  const transplanted = { ...loaded.state, hydroMaintenance: body };
  assert.equal(isCanonicalHydroMaintenanceReady(transplanted, 1024, 136), false);
  envelope.sim.state = copied;
  assert.equal(isCanonicalHydroMaintenanceReady(loaded.state, 1024, 136), false, 'state replacement invalidates the former owner');
});

test('an undeclared gridless installer only registers its independent transplant guard', () => {
  const { state, world } = coldFixture(); delete world.hydroMaintenance; delete world.powerGrid;
  const validators: ((candidate: SimState) => void)[] = [];
  const before = JSON.stringify(world);
  const sim = { worldDefinition: world, registerSaveValidator(callback: (candidate: SimState) => void) { validators.push(callback); } } as unknown as Simulation;
  installHydroMaintenance(sim);
  assert.equal(JSON.stringify(world), before);
  assert.equal(validators.length, 1);
  assert.throws(() => validators[0](state), /未声明域/);
  delete state.hydroMaintenance; validators[0](state);
});

test('matching generic current wage objects cannot advance a material-ready engineer contract', () => {
  const envelope = listenerEnvelope(), prepared = coldFixture();
  envelope.state.hydroMaintenance!.job = partialLabor(prepared.state, 0);
  envelope.state.tick = 1; envelope.state.hour = 484 / 60; envelope.state.extension!.lastUpdate = 484;
  // This mock invokes the installed successful load hook after cold validation;
  // it does not claim these controlled records were earned by native runtime.
  for (const callback of envelope.loads) callback();
  const job = jobOf(envelope.state);
  const funds = JSON.stringify([envelope.state.treasury, envelope.state.player.money,
    envelope.state.citizens[0].money, envelope.state.shops[0].inventory, job.escrow, job.purchasePaid]);
  for (const callback of envelope.phases.get('time')!) callback(envelope.state, 4);
  const fake = Object.freeze({ type: 'wage-earned', citizenId: ACTOR, siteId: SITE,
    districtId: 'other-city', minutes: 4, amount: .4, ratePerMinute: .1,
    creditedWorkStartAt: 480, creditedWorkEndAt: 484 });
  assert.equal(isCanonicalNpcWage(fake, envelope.sim), false);
  for (const callback of envelope.events.get('wage-earned')!) callback(fake);
  for (const callback of envelope.phases.get('people')!) callback(envelope.state, 4);
  assert.equal(job.workedMinutes, 0); assert.equal(job.laborReceipts.length, 0);
  assert.equal(job.technicianId, null); assert.equal(job.reservedUnits, 1); assert.equal(job.consumedUnits, 0);
  assert.equal(JSON.stringify([envelope.state.treasury, envelope.state.player.money,
    envelope.state.citizens[0].money, envelope.state.shops[0].inventory, job.escrow, job.purchasePaid]), funds);
  validateHydroMaintenanceState(envelope.state, envelope.world);
});

test('a complete-looking generic salary payment leaves full labor awaiting actual cash provenance', () => {
  const envelope = listenerEnvelope(), prepared = coldFixture();
  envelope.state.hydroMaintenance!.job = awaitingPayment(prepared.state);
  envelope.state.tick = 135; envelope.state.hour = 17; envelope.state.extension!.lastUpdate = 1020;
  for (const callback of envelope.loads) callback();
  const before = JSON.stringify(envelope.state);
  const fake = Object.freeze({ type: 'wage-paid', citizenId: ACTOR, districtId: 'other-city',
    amount: 45, requestedAmount: 45, net: 41.4, tax: 3.6,
    at: 1020, tick: 135, settledThroughAt: 1020 });
  assert.equal(getCanonicalNpcFullSettlement(fake, envelope.sim), null);
  for (const event of [fake, clone(fake)])
    for (const callback of envelope.events.get('wage-paid')!) callback(event);
  for (const callback of envelope.phases.get('finance')!) callback(envelope.state, 4);
  assert.equal(JSON.stringify(envelope.state), before);
  assert.equal(jobOf(envelope.state).payment, null);
  assert.equal(jobOf(envelope.state).status, 'awaitingWageSettlement');
  assert.equal(hydroMaintenanceReadyAt(envelope.state, 1024), false);
  assert.equal(isCanonicalHydroMaintenanceReady(envelope.state, 1024), false);
  validateHydroMaintenanceState(envelope.state, envelope.world);
});

test('raw body, job, header and progress replacements cannot be reattested by later own writers', () => {
  const mutations: ((state: SimState) => void)[] = [
    state => { state.hydroMaintenance = clone(state.hydroMaintenance!); },
    state => { state.hydroMaintenance!.job = clone(jobOf(state)); },
    state => { state.hydroMaintenance!.sourceId = 'other-machine'; },
    state => { state.hydroMaintenance!.operatorSiteId = 'other-city-workshop'; },
    state => { jobOf(state).workedMinutes = 60; jobOf(state).status = 'awaitingWageSettlement'; },
    state => { jobOf(state).laborReceipts[0].source.amount = 999; },
    state => { jobOf(state).receipts.pop(); },
  ];
  for (const mutate of mutations) {
    const envelope = listenerEnvelope(), prepared = coldFixture();
    envelope.state.hydroMaintenance!.job = partialLabor(prepared.state, 1);
    envelope.state.tick = 1; envelope.state.hour = 484 / 60; envelope.state.extension!.lastUpdate = 484;
    for (const callback of envelope.loads) callback();
    assert.equal(isCanonicalHydroMaintenanceState(envelope.state), true);
    mutate(envelope.state);
    assert.equal(isCanonicalHydroMaintenanceState(envelope.state), false);
    const before = JSON.stringify(envelope.state);
    for (const phase of ['people', 'finance'])
      for (const callback of envelope.phases.get(phase)!)
        assert.throws(() => callback(envelope.state, 4), /私有见证/);
    for (const callback of envelope.commands)
      assert.throws(() => callback({ type: 'cancelEnergy', targetId: 'hydro-maintenance-1' }), /私有见证/);
    assert.equal(JSON.stringify(envelope.state), before, 'rejected writers change neither asset history nor finite funds');
    assert.equal(isCanonicalHydroMaintenanceReady(envelope.state, 1024, 136), false);
  }
});

test('private progress comparison rejects nested and header accessors without running them', () => {
  let calls = 0;
  for (const target of ['body', 'job', 'nested']) {
    const envelope = listenerEnvelope(), prepared = coldFixture();
    envelope.state.hydroMaintenance!.job = partialLabor(prepared.state, 1);
    envelope.state.tick = 1; envelope.state.hour = 484 / 60; envelope.state.extension!.lastUpdate = 484;
    for (const callback of envelope.loads) callback();
    if (target === 'body') Object.defineProperty(envelope.state, 'hydroMaintenance', { enumerable: true, get() { calls++; return prepared.state.hydroMaintenance; } });
    else if (target === 'job') Object.defineProperty(envelope.state.hydroMaintenance!, 'job', { enumerable: true, get() { calls++; return prepared.state.hydroMaintenance!.job; } });
    else Object.defineProperty(jobOf(envelope.state).laborReceipts[0].source, 'amount', { enumerable: true, get() { calls++; return .4; } });
    assert.equal(isCanonicalHydroMaintenanceState(envelope.state), false);
    for (const callback of envelope.phases.get('finance')!) assert.throws(() => callback(envelope.state, 4), /私有见证/);
    assert.equal(calls, 0);
  }
});
