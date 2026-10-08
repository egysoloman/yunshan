import assert from 'node:assert/strict';
import test from 'node:test';
import type { Citizen, Shop, SimState, WorldDefinition } from '../src/types';
import { gridState, gridWorld } from './power-grid-fixture';
import { hydroGridWorld } from './power-grid-hydro-fixture';
import { dispatchPowerGrid } from '../src/simulation/power-grid';
import { nightRetailPlannedOpen, nightRetailServedNow, type NightRetailJob } from '../src/simulation/night-retail';
import { sharedHydroAppendCharUpperBound } from '../src/simulation/hydro-grid-budget';
import { pagedHistoryWindows, pagedHydroEndAt } from '../src/simulation/power-hydro-runtime';
import {
  bindHydroGridAfterLoad, createHydroGridState, dispatchHydroGrid, hydroGridClock,
  hydroGridWindows, isCanonicalHydroDispatch, prepareHydroBeforeStep,
  prepareHydroBeforeTick, validateHydroGridState,
  type HydroPowerGridDefinition, type HydroPowerGridState, type HydroShopLoadSource,
} from '../src/simulation/power-grid-hydro';

/** Parameter-only regression draft. The shops, actors, profile fields and night
 * job below are explicitly synthetic inputs, NOT native NPC declarations,
 * wages, attendance, movement, sales or proof of full-save import. No Simulation
 * is constructed. The hydro clock advances only through bounded grid windows
 * from its required 480-minute origin; the storage case supplies a night clock.
 * bindHydroGridAfterLoad is exercised only as the module-level binding API.
 * This file must be installed beside the existing repository test fixtures.
 * Authoring status: NOT_RUN; the parent owns all execution and validation.
 */
const MARKET = 'other-city-market';
const SHOP = 'parameter-night-shop-a', OTHER_SHOP = 'parameter-night-shop-b';
const OPERATOR = 'parameter-night-operator', OTHER_OPERATOR = 'parameter-other-operator';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const body = (state: SimState): HydroPowerGridState => state.powerGrid as HydroPowerGridState;
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

function parameters(world: WorldDefinition, operatorId = OPERATOR): SimState {
  const site = world.buildings.find(building => building.id === MARKET)!;
  const shops: Shop[] = [SHOP, OTHER_SHOP].map(id => ({
    id, buildingId: MARKET, districtId: site.districtId, ownerId: operatorId,
    inventory: 1, price: 8, revenue: 0, profit: 0, customers: 0, open: false, employees: 1,
  }));
  const citizens: Citizen[] = [operatorId, OTHER_OPERATOR].map((id): Citizen => ({
    id, name: id, districtId: site.districtId, homeId: 'other-city-home', workId: MARKET,
    role: 'merchant', position: { ...site.door }, state: 'idle', destinationId: null,
    money: 0, needs: { hunger: 90, fatigue: 90, social: 90, fun: 90 }, tier: 'active',
  }));
  return {
    tick: 0, day: 0, hour: 8, shops, citizens, vehicles: [], energy: 0, districts: [],
    // Only selector inputs are supplied; this is not a complete extension save.
    extension: { companies: [], actorProfiles: Object.fromEntries(citizens.map(actor =>
      [actor.id, { alive: true, age: 30, health: 100, mood: 90, stress: 0 }])) },
  } as unknown as SimState;
}

function syntheticJob(state: SimState, endsAt = 1336, id = 'night-retail-1'): NightRetailJob {
  assert.equal(hydroGridClock(state), 1320);
  for (const shop of state.shops) shop.nightRetailVersion = 1;
  const job: NightRetailJob = {
    id, shopId: SHOP, buildingId: MARKET, operatorId: state.shops[0].ownerId!,
    startedAt: 1320, endsAt, lastServedAt: null, lastObservedTick: null,
    lastObservedAt: null, servedMinutes: 0, status: 'active',
    pauseReason: 'Synthetic grid input; no service witness.', endedAt: null,
    demandIds: [OTHER_OPERATOR], funding: {
      kind: 'existing-private-assignment', day: 0, assignmentKey: 'parameter-assignment',
      ratePerMinute: 1, approvedMinutes: 480, workedMinutesAtStart: 360,
      attendanceMinutesAtStart: 360, fundsAtStart: 120, protectedFundsAtStart: 120,
    },
  };
  state.nightRetail = { version: 1, nextId: Number(id.slice(13)) + 1,
    shopIds: [SHOP, OTHER_SHOP], jobs: [job] };
  return job;
}

function hydroFixture(shared = true, withVehicle = false, operatorId = OPERATOR) {
  const world = hydroGridWorld({ zeroDemand: true, nativeVehicle: withVehicle });
  const grid = world.powerGrid as HydroPowerGridDefinition;
  grid.buildings.find(load => load.buildingId === MARKET)!.shopKW = .5;
  if (shared) grid.historyEncoding = 'shared-dispatch-v1';
  const state = parameters(world, operatorId);
  if (withVehicle) state.vehicles = [{ id: 'parameter-train', kind: 'maglev',
    edgeId: world.edges[0].id, position: { ...world.nodes[0].position },
    progress: 0, direction: 1, speed: 10, state: 'waiting', passengers: 0,
    cargo: 0, nextDeparture: 480 }];
  state.powerGrid = createHydroGridState(world, state);
  return { world, state };
}

function gridStep(world: WorldDefinition, state: SimState, minutes = 4): void {
  prepareHydroBeforeStep(world, state, minutes, 1);
  prepareHydroBeforeTick(world, state, minutes);
  const at = pagedHydroEndAt(hydroGridClock(state), minutes);
  state.tick++; state.day = Math.floor(at / 1440); state.hour = (at % 1440) / 60;
  state.powerGrid = dispatchHydroGrid(world, state, minutes);
}

function nightFixture(withVehicle = false, operatorId = OPERATOR) {
  const result = hydroFixture(true, withVehicle, operatorId);
  for (let index = 0; index < 210; index++) gridStep(result.world, result.state);
  assert.equal(hydroGridClock(result.state), 1320);
  assert.equal(body(result.state).history.count, 210);
  return result;
}

function stampedSnapshots(state: SimState): HydroShopLoadSource[][] {
  return [...pagedHistoryWindows(body(state).snapshots!)].map(snapshot => snapshot.loadSources.shops)
    .filter(rows => rows.some(row => row.nightRetailPlan !== undefined));
}

test('synthetic planned night retail consumes finite storage before service and stops at its endpoint', () => {
  const world = gridWorld();
  for (const load of world.powerGrid!.buildings) load.baseP = load.nightP = 0;
  world.powerGrid!.storage[0].initialStoredPMinutes = .25;
  const state = Object.assign(gridState(world), parameters(world));
  state.hour = 22;
  const job = syntheticJob(state, 1321);
  assert.equal(nightRetailPlannedOpen(state, SHOP), true);
  assert.equal(nightRetailServedNow(state, SHOP), false);
  for (let index = 1; index <= 4; index++) {
    state.tick = index; state.hour = (1320 + index * .25) / 60;
    state.powerGrid = dispatchPowerGrid(world, state, .25);
    const dispatch = state.powerGrid.dispatch!;
    assert.equal(dispatch.buildings[MARKET].demandP, .5);
    assert.equal(dispatch.buildings[MARKET].servedP, index <= 2 ? .5 : 0);
    near(state.powerGrid.storedPMinutes['battery-asset'] + state.powerGrid.consumedPMinutes['battery-asset'], .25);
  }
  assert.equal(state.powerGrid!.storedPMinutes['battery-asset'], 0);
  assert.equal(state.powerGrid!.consumedPMinutes['battery-asset'], .25);
  state.tick++; state.hour = 1321.25 / 60;
  state.powerGrid = dispatchPowerGrid(world, state, .25);
  assert.equal(state.powerGrid.dispatch!.demandP, 0);
  assert.equal(nightRetailPlannedOpen(state, SHOP), false);
  assert.equal(nightRetailServedNow(state, SHOP), false);
  assert.equal(job.servedMinutes, 0);
});

test('synthetic planned night retail draws measured hydro water without a service witness', () => {
  const { world, state } = nightFixture();
  assert.equal(body(state).dispatch!.buildings[MARKET].demandKW, 0);
  assert.equal(body(state).dispatch!.loadSources.shops.some(row => Object.hasOwn(row, 'nightRetailPlan')), false);
  const job = syntheticJob(state, 1328), before = body(state).hydro;
  gridStep(world, state);
  const dispatch = body(state).dispatch!, source = dispatch.sources['other-hydro'];
  assert.equal(dispatch.buildings[MARKET].demandKW, .5);
  near(dispatch.buildings[MARKET].servedKW, .5);
  near(source.generatedKWh, .5 * dispatch.minutes / 60);
  assert.ok(source.transferredM3 > 0);
  near(before.upstreamM3 - body(state).hydro.upstreamM3, source.transferredM3);
  near(body(state).hydro.downstreamM3 - before.downstreamM3, source.transferredM3);
  assert.deepEqual(dispatch.loadSources.shops[0].nightRetailPlan,
    { jobId: job.id, operatorId: job.operatorId, startsAt: 1320, endsAt: 1328 });
  assert.equal(nightRetailServedNow(state, SHOP), false);
  gridStep(world, state); // The final finite energy interval includes endsAt.
  assert.equal(body(state).dispatch!.buildings[MARKET].demandKW, .5);
  const atEnd = body(state).hydro;
  gridStep(world, state);
  assert.equal(body(state).dispatch!.buildings[MARKET].demandKW, 0);
  assert.equal(body(state).hydro.upstreamM3, atEnd.upstreamM3);
  assert.equal(body(state).hydro.generatedKWh, atEnd.generatedKWh);
  assert.equal(job.servedMinutes, 0);
  validateHydroGridState(state, world);
});

test('legacy no-night history retains its exact field shape and shared expansion', () => {
  const legacy = hydroFixture(false), shared = hydroFixture(true);
  for (const minutes of [.25, 1, 4]) {
    gridStep(legacy.world, legacy.state, minutes); gridStep(shared.world, shared.state, minutes);
  }
  assert.deepEqual(Object.keys(body(legacy.state)), ['version', 'kind', 'unit', 'hydro', 'dispatch', 'totals', 'history']);
  assert.equal(Object.hasOwn(legacy.state, 'nightRetail'), false);
  assert.equal(Object.hasOwn(shared.state, 'nightRetail'), false);
  for (const fixture of [legacy, shared]) {
    for (const window of hydroGridWindows(body(fixture.state))) {
      assert.deepEqual(Object.keys(window.loadSources), ['shops']);
      assert.deepEqual(window.loadSources.shops, [SHOP, OTHER_SHOP].map(id =>
        ({ id, buildingId: MARKET, allowsOperation: true })));
      for (const row of window.loadSources.shops)
        assert.deepEqual(Object.keys(row), ['id', 'buildingId', 'allowsOperation']);
    }
    const cold = clone(fixture.state), before = JSON.stringify(cold);
    validateHydroGridState(cold, fixture.world);
    assert.equal(JSON.stringify(cold), before);
  }
  assert.equal(JSON.stringify([...hydroGridWindows(body(legacy.state))]),
    JSON.stringify([...hydroGridWindows(body(shared.state))]));
});

test('shared night history cold validation and module binding preserve exact future outputs', () => {
  const { world, state } = nightFixture(); syntheticJob(state, 1332);
  gridStep(world, state, .25); gridStep(world, state, .5);
  const cold = clone(state), before = JSON.stringify(cold);
  validateHydroGridState(cold, world);
  assert.equal(JSON.stringify(cold), before);
  assert.equal(isCanonicalHydroDispatch(cold), false);
  assert.throws(() => prepareHydroBeforeStep(world, cold, .25, 1), /复制|资产/);
  assert.equal(JSON.stringify(cold), before);
  bindHydroGridAfterLoad(world, cold);
  assert.equal(isCanonicalHydroDispatch(cold), true);
  assert.ok(Object.isFrozen(stampedSnapshots(cold)[0][0].nightRetailPlan));
  for (const minutes of [.0625, .25, 1, 4, 4, 4]) {
    gridStep(world, state, minutes); gridStep(world, cold, minutes);
    assert.equal(JSON.stringify(cold), JSON.stringify(state));
  }
  assert.ok(hydroGridClock(state) > 1332);
  assert.equal(body(state).dispatch!.buildings[MARKET].demandKW, 0);
  validateHydroGridState(cold, world);
});

test('retained and pruned job IDs keep one shop, operator, start and end across historical stamps', () => {
  const { world, state } = nightFixture(true); syntheticJob(state);
  gridStep(world, state);
  state.vehicles[0].edgeId = world.edges[1].id;
  gridStep(world, state);
  assert.equal(stampedSnapshots(state).length, 2, 'different supplied vehicle edges make two distinct night snapshots');
  validateHydroGridState(state, world);
  const mutations: Array<[string, (rows: HydroShopLoadSource[]) => void]> = [
    ['shop', rows => {
      const source = rows.find(row => row.nightRetailPlan)!;
      rows.find(row => row.id === OTHER_SHOP)!.nightRetailPlan = source.nightRetailPlan;
      delete source.nightRetailPlan; // Same building and load; only job ownership changes.
    }],
    ['operator', rows => { rows.find(row => row.nightRetailPlan)!.nightRetailPlan!.operatorId = OTHER_OPERATOR; }],
    ['start', rows => { rows.find(row => row.nightRetailPlan)!.nightRetailPlan!.startsAt = 1321; }],
    ['end', rows => { rows.find(row => row.nightRetailPlan)!.nightRetailPlan!.endsAt = 1335; }],
  ];
  const pruned = clone(state); pruned.nightRetail!.jobs = [];
  validateHydroGridState(pruned, world);
  const original = JSON.stringify(state), prunedOriginal = JSON.stringify(pruned);
  for (const [label, mutate] of mutations) {
    const retained = clone(state); mutate(stampedSnapshots(retained)[0]);
    assert.throws(() => validateHydroGridState(retained, world), /历史夜计划与保留声明一致/, label);
    // A uniform change is still locally well-formed and has identical electrical
    // demand once the synthetic live job has been removed. This guards against
    // an unrelated schema/Flow error masquerading as the identity regression.
    const consistent = clone(pruned);
    for (const rows of stampedSnapshots(consistent)) mutate(rows);
    mutate(body(consistent).dispatch!.loadSources.shops);
    validateHydroGridState(consistent, world);
    const inconsistent = clone(pruned); mutate(stampedSnapshots(inconsistent)[0]);
    assert.throws(() => validateHydroGridState(inconsistent, world), /历史确定性重演数值不符/, label);
  }
  assert.equal(JSON.stringify(state), original);
  assert.equal(JSON.stringify(pruned), prunedOriginal);
});

test('the first optional night stamp fits a JSON reserve computed before any night declaration', () => {
  const { world, state } = nightFixture(false, 'o'.repeat(120));
  assert.equal(Object.hasOwn(state, 'nightRetail'), false);
  const reserve = sharedHydroAppendCharUpperBound(world, state);
  const nonMarketWorld = clone(world);
  nonMarketWorld.buildings.find(site => site.id === MARKET)!.kind = 'farm';
  const withoutNightAllowance = sharedHydroAppendCharUpperBound(nonMarketWorld, state);
  const before = JSON.stringify(body(state)).length;
  prepareHydroBeforeStep(world, state, .25, 1);
  syntheticJob(state, 1440, 'night-retail-9007199254740990');
  assert.equal(sharedHydroAppendCharUpperBound(world, state), reserve, 'reserve must not depend on an already-created job');
  gridStep(world, state, .25);
  const row = body(state).dispatch!.loadSources.shops.find(source => source.nightRetailPlan)!;
  assert.ok(row.nightRetailPlan);
  const plain = { id: row.id, buildingId: row.buildingId, allowsOperation: row.allowsOperation };
  const metadataChars = JSON.stringify(row).length - JSON.stringify(plain).length;
  assert.ok(reserve - withoutNightAllowance >= 2 * metadataChars,
    'reserve includes the optional stamp in both full dispatch and new snapshot');
  assert.ok(JSON.stringify(body(state)).length - before <= reserve);
  assert.equal(stampedSnapshots(state).length, 1);
  validateHydroGridState(state, world);
});
