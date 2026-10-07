import assert from 'node:assert/strict';
import test from 'node:test';
import type { SimState, Vehicle, WorldDefinition } from '../src/types';
import {
  bindHydroGridAfterLoad, createHydroGridState, dispatchHydroGrid, hydroGridClock,
  hydroGridWindows, isCanonicalHydroDispatch, prepareHydroBeforeStep,
  prepareHydroBeforeTick, validateHydroGridDefinition, validateHydroGridState,
  type HydroPowerGridDefinition, type HydroPowerGridState,
} from '../src/simulation/power-grid-hydro';
import { pagedHydroEndAt } from '../src/simulation/power-hydro-runtime';
import { hydroGridWorld } from './power-grid-hydro-fixture';
import { buildingLightSupplyRatio } from '../src/rendering/building-light-supply';

const near = (actual: number, expected: number) => assert(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const grid = (world: WorldDefinition) => world.powerGrid as HydroPowerGridDefinition;
const body = (state: SimState) => state.powerGrid as HydroPowerGridState;
function initial(world: WorldDefinition, vehicles: Vehicle[] = []): SimState {
  const state = { tick: 0, day: 0, hour: 8, shops: [], vehicles, energy: 0, districts: [] } as unknown as SimState;
  state.powerGrid = createHydroGridState(world, state); return state;
}
function step(world: WorldDefinition, state: SimState, nativeMinutes = .25): HydroPowerGridState {
  prepareHydroBeforeStep(world, state, nativeMinutes, 1); prepareHydroBeforeTick(world, state, nativeMinutes);
  const at = pagedHydroEndAt(hydroGridClock(state), nativeMinutes); state.tick++; state.day = Math.floor(at / 1440); state.hour = (at % 1440) / 60;
  state.powerGrid = dispatchHydroGrid(world, state, nativeMinutes); return body(state);
}
function run(options: Parameters<typeof hydroGridWorld>[0] = {}) {
  const world = hydroGridWorld(options), state = initial(world), next = step(world, state); validateHydroGridState(state, world); return { world, state, next, dispatch: next.dispatch! };
}
function vehicle(world: WorldDefinition): Vehicle {
  return { id: 'controlled-train', kind: 'maglev', edgeId: world.edges[0].id, position: { ...world.nodes[0].position }, progress: 0, direction: 1, speed: 10, state: 'waiting', passengers: 0, cargo: 0, nextDeparture: 480 };
}

test('v2 actual source arc feeds named loads and transfers only its accepted kWh', () => {
  const { next, dispatch } = run(); near(dispatch.demandKW, 8); near(dispatch.servedKW, 8);
  const meter = dispatch.sources['other-hydro']; assert.equal(meter.generatedKWh, meter.suppliedKW * dispatch.minutes / 60);
  assert.equal(next.totals.servedKWh, dispatch.servedKW * dispatch.minutes / 60);
  near(next.hydro.generatedKWh, next.totals.servedKWh); near(next.hydro.transferredM3, meter.transferredM3);
  near(next.hydro.upstreamM3 + next.hydro.downstreamM3, 10000); assert.equal(next.history.count, 1);
});
test('numerically unresolved declared water cannot install an asset and reach a half tick', () => {
  const world = hydroGridWorld(), network = grid(world), source = network.sources[0];
  source.hydro.upstream.capacityM3 = source.hydro.upstream.initialM3 = 1e9;
  source.hydro.downstream.capacityM3 = 1e9; source.hydro.downstream.initialM3 = 5e8;
  source.hydro.headMeters = 1e4; source.hydro.efficiency = 1;
  source.intake.position.y = 1e4;
  for (const load of network.buildings) { load.baseKW = load.nightKW = load.shopKW = 0; }
  network.buildings[0].baseKW = 1e-7;
  const before = JSON.stringify(world);
  assert.throws(() => validateHydroGridDefinition(world), /浮点|分辨率/);
  assert.equal(JSON.stringify(world), before);
});
test('installation traverses an unfamiliar shallow frozen declaration before granting capability', () => {
  const world = hydroGridWorld(), network = grid(world);
  Object.freeze(network); Object.freeze(network.links);
  const state = initial(world);
  assert.throws(() => { network.links[0].capacityKW = 0; }, TypeError);
  assert.throws(() => { network.buildings[0].baseKW = 0; }, TypeError);
  step(world, state); validateHydroGridState(state, world);
});
test('fresh binding traverses shallow frozen restored meters and all history children', () => {
  const { world, state } = run(), restored = JSON.parse(JSON.stringify(state)) as SimState;
  Object.freeze(body(restored)); Object.freeze(body(restored).dispatch);
  bindHydroGridAfterLoad(world, restored);
  assert.throws(() => { body(restored).dispatch!.buildings['other-city-farm'].servedKW = 0; }, TypeError);
  assert.throws(() => { [...hydroGridWindows(body(restored))][0].loadSources.shops.push({ id: 'fake', buildingId: 'other-city-farm', allowsOperation: true }); }, TypeError);
  assert(isCanonicalHydroDispatch(restored)); step(world, restored); validateHydroGridState(restored, world);
});
test('a declared second version with an unsupported kind cannot silently disable the network', () => {
  const world = hydroGridWorld(); Reflect.set(grid(world), 'kind', 'unknown-network');
  assert.throws(() => validateHydroGridDefinition(world), /不支持/);
});
test('a resolvable tiny native flow retains positive water changes at the minimum native speed', () => {
  const world = hydroGridWorld({ zeroDemand: true }); grid(world).buildings[0].baseKW = 2e-8;
  const state = initial(world), next = step(world, state, .0625);
  assert(next.dispatch!.servedKW > 1e-8);
  assert(next.hydro.upstreamM3 < 10000); assert(next.hydro.downstreamM3 > 0);
  validateHydroGridState(state, world);
});
test('hydro building lights use their current local kW meter and reject stale or mismatched units', () => {
  const { world, state } = run({ farmCableKW: 1, clinicConnected: false }); state.energy = 100;
  const before = JSON.stringify(state);
  assert.equal(buildingLightSupplyRatio(world, state, 'other-city-farm'), .5);
  assert.equal(buildingLightSupplyRatio(world, state, 'other-city-clinic'), 0);
  assert.equal(buildingLightSupplyRatio(world, state, 'missing'), 0);
  assert.equal(JSON.stringify(state), before);
  assert.equal(buildingLightSupplyRatio(world, { ...state, tick: state.tick + 1 }, 'other-city-farm'), 0);
  assert.equal(buildingLightSupplyRatio(world, { ...state, hour: state.hour + 1 / 60 }, 'other-city-farm'), 0);
  assert.equal(buildingLightSupplyRatio(world, { ...state, powerGrid: undefined }, 'other-city-farm'), 0);
});
test('opening only the clinic feeder preserves independently supplied farm and market', () => {
  const { dispatch } = run({ clinicFeeder: false }); assert.equal(dispatch.buildings['other-city-clinic'].servedKW, 0);
  near(dispatch.buildings['other-city-farm'].servedKW, 2); near(dispatch.buildings['other-city-market'].servedKW, 2);
  assert.equal(dispatch.links['clinic-line'], 0); assert(dispatch.diagnostics.islandNodeIds.includes('clinic'));
});
test('cable and node throughput independently constrain the accepted source arc', () => {
  const cable = run({ farmCableKW: 1.5 }).dispatch; near(cable.buildings['other-city-farm'].servedKW, 1.5); assert(cable.diagnostics.constrainedLinkIds.includes('north-line'));
  const node = run({ farmNodeKW: 1 }).dispatch; near(node.buildings['other-city-farm'].servedKW, 1); assert(node.diagnostics.constrainedNodeIds.includes('north'));
});
test('explicit missing building and transport feeders remain locally unserved', () => {
  const world = hydroGridWorld({ farmConnected: false }); grid(world).transport = [];
  const state = initial(world, [vehicle(world)]), next = step(world, state); validateHydroGridState(state, world);
  assert.equal(next.dispatch!.buildings['other-city-farm'].servedKW, 0); assert.equal(next.dispatch!.vehicles['controlled-train'].servedKW, 0);
  assert.deepEqual(next.dispatch!.diagnostics.unconnectedVehicles, ['controlled-train']);
});
test('a zero-load phase retains both finite reservoirs and creates no electricity stock', () => {
  const world = hydroGridWorld({ zeroDemand: true }), state = initial(world); step(world, state); const next = step(world, state);
  assert.equal(next.hydro.upstreamM3, 10000); assert.equal(next.hydro.downstreamM3, 0); assert.equal(next.hydro.generatedKWh, 0);
  assert.equal(next.totals.servedKWh, 0); assert.equal(next.dispatch!.servedKW, 0); assert(next.dispatch!.availableKW > 0); validateHydroGridState(state, world);
});
test('exhausted upper reservoir, full lower reservoir and closed ports stop accepted generation', () => {
  const world = hydroGridWorld({ upstreamM3: .1 }), state = initial(world), first = step(world, state), second = step(world, state);
  assert(first.dispatch!.servedKW > 0 && first.dispatch!.servedKW < 8); assert.equal(second.dispatch!.servedKW, 0); near(second.hydro.upstreamM3, 0); validateHydroGridState(state, world);
  for (const options of [{ downstreamM3: 20000 }, { intakeOpen: false }, { outfallOpen: false }]) { const stopped = run(options); assert.equal(stopped.dispatch.servedKW, 0); assert.equal(stopped.next.hydro.transferredM3, 0); }
});
test('fractional native clock windows retain actual normalized minutes and exact cold replay', () => {
  const world = hydroGridWorld(), state = initial(world); step(world, state, .25 * 1.23456789); const next = step(world, state, .25 * 3.14159265);
  assert.equal(next.dispatch!.minutes, next.dispatch!.at - next.dispatch!.beforeAt);
  assert.equal(next.dispatch!.sources['other-hydro'].generatedKWh, next.dispatch!.servedKW * next.dispatch!.minutes / 60);
  validateHydroGridState(state, world); validateHydroGridState(JSON.parse(JSON.stringify(state)) as SimState, world);
});
test('same actual phase is idempotent and changing its native request is rejected', () => {
  const { world, state } = run(), before = JSON.stringify(state); assert.equal(dispatchHydroGrid(world, state, .25), body(state)); assert.equal(JSON.stringify(state), before);
  assert.throws(() => dispatchHydroGrid(world, state, .5), /同相位/); assert(isCanonicalHydroDispatch(state));
  state.tick++; assert.equal(isCanonicalHydroDispatch(state), false);
});
test('cold-only clones cannot borrow native dispatch capability; successful load binds a fresh owner', () => {
  const { world, state } = run(), copy = JSON.parse(JSON.stringify(state)) as SimState;
  validateHydroGridState(copy, world); assert.equal(isCanonicalHydroDispatch(copy), false);
  assert.throws(() => prepareHydroBeforeTick(world, copy, .25), /复制|资产|来源/);
  bindHydroGridAfterLoad(world, copy); assert(isCanonicalHydroDispatch(copy)); step(world, state); step(world, copy);
  assert.equal(JSON.stringify(copy), JSON.stringify(state));
});
test('a past altered demand or deleted load source rejects even when current water and meters stay intact', () => {
  const world = hydroGridWorld(), state = initial(world); step(world, state); step(world, state);
  const changed = JSON.parse(JSON.stringify(state)) as SimState; [...hydroGridWindows(body(changed))][0].buildings['other-city-farm'].demandKW = 0;
  assert.throws(() => validateHydroGridState(changed, world), /历史|重演|供电/);
  const erased = JSON.parse(JSON.stringify(state)) as SimState; Object.assign(body(erased).history, { count: 1 }); assert.throws(() => validateHydroGridState(erased, world), /历史|窗/);
});
test('shop demand snapshots cannot fabricate a closed legacy shop to erase earlier load', () => {
  const world = hydroGridWorld(), state = initial(world);
  state.shops = [{ id: 'controlled-shop', buildingId: 'other-city-market', districtId: 'other-city', inventory: 1, price: 8, revenue: 0, profit: 0, customers: 0, open: false, employees: 1 }];
  // Bootstrap after the fixture's explicit complete shop registry is declared.
  state.powerGrid = createHydroGridState(world, state); step(world, state); step(world, state);
  near(body(state).dispatch!.buildings['other-city-market'].demandKW, 2.5);
  const changed = JSON.parse(JSON.stringify(state)) as SimState; [...hydroGridWindows(body(changed))][0].loadSources.shops[0].allowsOperation = false;
  assert.throws(() => validateHydroGridState(changed, world), /商店|需求/);
});
test('historical vehicle meters retain the original energy edge after native traffic changes it', () => {
  const world = hydroGridWorld(); grid(world).transport[0].nodeId = 'north'; grid(world).transport[1].nodeId = 'south';
  const train = vehicle(world), state = initial(world, [train]); step(world, state); state.vehicles[0].edgeId = world.edges[1].id;
  validateHydroGridState(state, world); assert.equal(body(state).dispatch!.vehicles[train.id].nodeId, 'north');
  step(world, state); validateHydroGridState(state, world); assert.equal(body(state).dispatch!.vehicles[train.id].nodeId, 'south');
});
test('whole-step capacity rejection and transformed topology leave the original ledger and clock intact', () => {
  const world = hydroGridWorld(), state = initial(world), before = JSON.stringify(state);
  assert.throws(() => prepareHydroBeforeStep(world, state, 4, 480), /预算|容量/); assert.equal(JSON.stringify(state), before);
  world.nodes[0].position.x += 1; assert.throws(() => prepareHydroBeforeTick(world, state, .25), /拓扑|资产/); assert.equal(JSON.stringify(state), before);
});
test('trusted physical references reject missing source use, altered head and pipe endpoints', () => {
  for (const mutate of [(world: WorldDefinition) => { world.buildings.find(site => site.facility === 'energy')!.facility = 'data'; }, (world: WorldDefinition) => { grid(world).sources[0].hydro.headMeters++; }, (world: WorldDefinition) => { grid(world).sources[0].penstockPoints[0] = { x: 999, y: 10, z: 0 }; }]) {
    const world = hydroGridWorld(); mutate(world); assert.throws(() => validateHydroGridDefinition(world), /水力电网契约/);
  }
});
test('cold replay rejects current clock, source, cumulative energy and water edits exactly', () => {
  const { world, state } = run();
  for (const mutate of [(copy: SimState) => { copy.hour += .25 / 60; }, (copy: SimState) => { body(copy).dispatch!.sources['other-hydro'].generatedKWh += 1e-12; }, (copy: SimState) => { body(copy).totals.servedKWh += 1e-12; }, (copy: SimState) => { Object.assign(body(copy).hydro, { upstreamM3: body(copy).hydro.upstreamM3 + 1e-7 }); }]) {
    const copy = JSON.parse(JSON.stringify(state)) as SimState; mutate(copy); assert.throws(() => validateHydroGridState(copy, world), /契约/);
  }
});
