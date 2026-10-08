import assert from 'node:assert/strict';
import test from 'node:test';
import type { Simulation } from '../src/simulation';
import type { Citizen, SimState, WorldDefinition } from '../src/types';
import { gridWorld } from './power-grid-fixture';
import { hydroGridWorld } from './power-grid-hydro-fixture';
import {
  createPowerGridState, dispatchPowerGrid, gridBuildingCanRequestInitialLoad,
  gridBuildingSupplyRatio,
} from '../src/simulation/power-grid';
import {
  beginNightRetail, installNightRetail, nightRetailOpportunities, nightRetailTask,
  nightRetailServedNow, shopScheduledOpen, type NightRetailAllowance,
} from '../src/simulation/night-retail';
import {
  createHydroGridState, dispatchHydroGrid, hydroGridClock, prepareHydroBeforeStep,
  prepareHydroBeforeTick, type HydroPowerGridDefinition,
} from '../src/simulation/power-grid-hydro';
import { pagedHydroEndAt } from '../src/simulation/power-hydro-runtime';

/** NOT_RUN draft. Synthetic module host and parameter-only grid windows: no
 * Simulation constructor, actual body route, native allowance or wage receipt.
 * beginNightRetail writes the job under explicit supplied account predicates;
 * this verifies the bootstrap contract, not natural NPC choice or full import.
 * Install next to existing fixtures after applying the candidate source patch.
 */
const MARKET = 'other-city-market', SHOP = 'bootstrap-shop', OWNER = 'bootstrap-owner';
const CUSTOMER = 'bootstrap-customer';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function parameters(world: WorldDefinition, withShop = true): SimState {
  const site = world.buildings.find(building => building.id === MARKET)!;
  const citizens: Citizen[] = [OWNER, CUSTOMER].map((id): Citizen => ({
    id, name: id, districtId: site.districtId, homeId: 'other-city-home', workId: MARKET,
    role: 'merchant', position: { ...site.door }, state: 'idle', destinationId: null,
    money: 10, needs: { hunger: 90, fatigue: 90, social: 90, fun: 90 }, tier: 'active',
  }));
  return {
    tick: 0, day: 0, hour: 8, citizens, vehicles: [], energy: 0,
    districts: [{ id: site.districtId, energy: 0 }],
    shops: withShop ? [{ id: SHOP, buildingId: MARKET, districtId: site.districtId,
      ownerId: OWNER, inventory: 4, price: 8, revenue: 0, profit: 0,
      customers: 0, open: false, employees: 1 }] : [],
    extension: { lastUpdate: 480, companies: [], actorProfiles: Object.fromEntries(citizens.map(actor =>
      [actor.id, { alive: true, age: 30, health: 100, mood: 90, stress: 0 }])) },
  } as unknown as SimState;
}

function moduleHost(world: WorldDefinition, state: SimState) {
  const allowance: NightRetailAllowance = { day: 0, assignmentKey: 'supplied-bootstrap-assignment',
    ratePerMinute: 1, approvedMinutes: 480, workedMinutes: 360, attendanceMinutes: 360,
    funds: 120, protectedFunds: 120 };
  let activations = 0;
  const simulation = { state, worldDefinition: world,
    onPhase: () => {}, onEvent: () => {}, onLoad: () => {}, registerSaveValidator: () => {},
  } as unknown as Simulation;
  installNightRetail(simulation, {
    activate: () => { activations++; }, allowance: () => allowance,
    atWork: () => true, demandIds: () => [CUSTOMER], actorBusy: () => false,
    canRequestInitialPower: (current, site) => gridBuildingCanRequestInitialLoad(current, site.id),
    powerAvailable: (current, site) => current.powerGrid
      ? gridBuildingSupplyRatio(current, site.id) > .25
      : (current.districts.find(district => district.id === site.districtId)?.energy ?? 0) > 25,
    isCanonicalWage: () => false, serving: () => false,
  });
  return { simulation, allowance, activations: () => activations };
}

function advanceHydro(world: WorldDefinition, state: SimState, minutes = 4): void {
  prepareHydroBeforeStep(world, state, minutes, 1); prepareHydroBeforeTick(world, state, minutes);
  const at = pagedHydroEndAt(hydroGridClock(state), minutes);
  state.tick++; state.day = Math.floor(at / 1440); state.hour = (at % 1440) / 60;
  state.extension!.lastUpdate = at;
  state.powerGrid = dispatchHydroGrid(world, state, minutes);
}

test('a zero-load live hydro meter permits declaration, then only measured supply permits a work task', () => {
  const world = hydroGridWorld({ zeroDemand: true }), grid = world.powerGrid as HydroPowerGridDefinition;
  grid.buildings.find(load => load.buildingId === MARKET)!.shopKW = .5;
  const state = parameters(world); state.powerGrid = createHydroGridState(world, state);
  for (let index = 0; index < 210; index++) advanceHydro(world, state);
  assert.equal(hydroGridClock(state), 1320);
  assert.equal(gridBuildingSupplyRatio(state, MARKET), 0);
  const beforeRead = JSON.stringify(state);
  assert.equal(gridBuildingCanRequestInitialLoad(state, MARKET), true);
  assert.equal(JSON.stringify(state), beforeRead, 'the planning predicate is read-only');
  const host = moduleHost(world, state), owner = state.citizens[0];
  const moneyStockAndAllowance = JSON.stringify([state.citizens.map(actor => actor.money), state.shops[0].inventory, host.allowance]);
  assert.equal(nightRetailOpportunities(host.simulation, owner).length, 1);
  assert.equal(beginNightRetail(host.simulation, OWNER).ok, true);
  assert.equal(host.activations(), 1);
  assert.equal(nightRetailTask(host.simulation, owner), null, 'declaration does not turn zero demand into delivered power');
  assert.equal(nightRetailServedNow(state, SHOP), false);
  assert.equal(shopScheduledOpen(state, world.buildings.find(site => site.id === MARKET)!, SHOP), false);
  assert.equal(state.nightRetail!.jobs[0].servedMinutes, 0);
  assert.equal(state.nightRetail!.jobs[0].lastServedAt, null);
  assert.equal(JSON.stringify([state.citizens.map(actor => actor.money), state.shops[0].inventory, host.allowance]), moneyStockAndAllowance);
  advanceHydro(world, state, .25);
  assert.ok(gridBuildingSupplyRatio(state, MARKET) > .25);
  assert.equal(nightRetailTask(host.simulation, owner), state.nightRetail!.jobs[0]);
  assert.equal(nightRetailServedNow(state, SHOP), false, 'even actual power alone supplies no wage witness');
  assert.equal(state.nightRetail!.jobs[0].servedMinutes, 0);
});

test('zero-load planning rejects absent, stale, copied, disconnected, exhausted and closed-port hydro meters', () => {
  const healthyWorld = hydroGridWorld({ zeroDemand: true }), healthy = parameters(healthyWorld, false);
  healthy.powerGrid = createHydroGridState(healthyWorld, healthy);
  assert.equal(gridBuildingCanRequestInitialLoad(healthy, MARKET), false, 'no dispatch yet');
  advanceHydro(healthyWorld, healthy);
  assert.equal(gridBuildingCanRequestInitialLoad(healthy, MARKET), true);
  assert.equal(gridBuildingCanRequestInitialLoad(healthy, 'missing-building'), false);
  assert.equal(gridBuildingCanRequestInitialLoad(clone(healthy), MARKET), false, 'a JSON clone has no live hydro capability');
  assert.equal(gridBuildingCanRequestInitialLoad({ ...healthy, tick: healthy.tick + 1 }, MARKET), false);
  assert.equal(gridBuildingCanRequestInitialLoad({ ...healthy, powerGrid: undefined }, MARKET), false);
  const variants: Array<[string, (world: WorldDefinition) => void]> = [
    ['no feeder', world => { (world.powerGrid as HydroPowerGridDefinition).buildings.find(load => load.buildingId === MARKET)!.nodeId = null; }],
    ['open feeder', world => { (world.powerGrid as HydroPowerGridDefinition).links.find(link => link.id === 'south-line')!.closed = false; }],
    ['zero node capacity', world => { (world.powerGrid as HydroPowerGridDefinition).nodes.find(node => node.id === 'south')!.capacityKW = 0; }],
    ['empty source', world => { (world.powerGrid as HydroPowerGridDefinition).sources[0].hydro.upstream.initialM3 = 0; }],
    ['closed intake', world => { (world.powerGrid as HydroPowerGridDefinition).sources[0].intake.open = false; }],
    ['closed outfall', world => { (world.powerGrid as HydroPowerGridDefinition).sources[0].outfall.open = false; }],
  ];
  for (const [label, mutate] of variants) {
    const world = hydroGridWorld({ zeroDemand: true }); mutate(world);
    const state = parameters(world, false); state.powerGrid = createHydroGridState(world, state);
    advanceHydro(world, state);
    assert.equal(gridBuildingCanRequestInitialLoad(state, MARKET), false, label);
  }
});

test('v1 current-meter planning can start a finite storage load while delivered supply remains zero until dispatch', () => {
  const world = gridWorld();
  for (const load of world.powerGrid!.buildings) load.baseP = load.nightP = 0;
  const state = parameters(world); state.tick = 1; state.hour = 22; state.extension!.lastUpdate = 1320;
  state.powerGrid = createPowerGridState(world);
  state.powerGrid = dispatchPowerGrid(world, state, .25);
  assert.equal(gridBuildingSupplyRatio(state, MARKET), 0);
  assert.equal(gridBuildingCanRequestInitialLoad(state, MARKET), true);
  const host = moduleHost(world, state);
  assert.equal(beginNightRetail(host.simulation, OWNER).ok, true);
  assert.equal(nightRetailTask(host.simulation, state.citizens[0]), null);
  const stored = state.powerGrid.storedPMinutes['battery-asset'];
  state.tick++; state.hour = 1320.25 / 60; state.extension!.lastUpdate = 1320.25;
  state.powerGrid = dispatchPowerGrid(world, state, .25);
  assert.equal(state.powerGrid.storedPMinutes['battery-asset'], stored - .125);
  assert.equal(gridBuildingSupplyRatio(state, MARKET), 1);
  assert.equal(nightRetailTask(host.simulation, state.citizens[0]), state.nightRetail!.jobs[0]);
  assert.equal(nightRetailServedNow(state, SHOP), false);
});

test('an existing nonzero demand cannot turn a known 25 percent shortfall into initial-load eligibility', () => {
  const world = hydroGridWorld({ zeroDemand: true }), grid = world.powerGrid as HydroPowerGridDefinition;
  grid.sources[0].hydro.maximumKW = .5;
  grid.buildings.find(load => load.buildingId === MARKET)!.baseKW = 2;
  const state = parameters(world, false); state.powerGrid = createHydroGridState(world, state);
  advanceHydro(world, state);
  assert.equal(gridBuildingSupplyRatio(state, MARKET), .25);
  assert.equal(gridBuildingCanRequestInitialLoad(state, MARKET), false);
});

test('legacy unmodeled low district energy keeps the original strict threshold', () => {
  for (const energy of [0, 25, 26]) {
    const world = gridWorld(); delete world.powerGrid;
    const state = parameters(world); state.hour = 22; state.extension!.lastUpdate = 1320;
    state.districts[0].energy = energy;
    const host = moduleHost(world, state);
    assert.equal(gridBuildingCanRequestInitialLoad(state, MARKET), false);
    assert.equal(nightRetailOpportunities(host.simulation, state.citizens[0]).length, energy > 25 ? 1 : 0);
    assert.equal(beginNightRetail(host.simulation, OWNER).ok, energy > 25);
    assert.equal(nightRetailServedNow(state, SHOP), false);
    if (energy <= 25) assert.equal(state.nightRetail, undefined);
  }
});
