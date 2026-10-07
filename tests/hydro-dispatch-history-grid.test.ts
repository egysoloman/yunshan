import assert from 'node:assert/strict';
import test from 'node:test';
import type { SimState, WorldDefinition, Vehicle } from '../src/types';
import { hydroGridWorld } from './power-grid-hydro-fixture';
import { pagedHydroEndAt } from '../src/simulation/power-hydro-runtime';
import {
  bindHydroGridAfterLoad, createHydroGridState, dispatchHydroGrid, hydroGridClock,
  hydroGridWindows, isCanonicalHydroDispatch, prepareHydroBeforeStep,
  prepareHydroBeforeTick, validateHydroGridDefinition, validateHydroGridState,
  type HydroPowerGridDefinition, type HydroPowerGridState,
} from '../src/simulation/power-grid-hydro';

// Parameter-only grid contract tests: no Simulation, payroll, body movement or
// assertion that these supplied vehicle parameters are native city residents.
const grid = (world: WorldDefinition) => world.powerGrid as HydroPowerGridDefinition;
const body = (state: SimState) => state.powerGrid as HydroPowerGridState;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function initial(world: WorldDefinition, vehicles: Vehicle[] = []): SimState {
  const state = { tick: 0, day: 0, hour: 8, shops: [], vehicles, energy: 0, districts: [] } as unknown as SimState;
  state.powerGrid = createHydroGridState(world, state); return state;
}
function step(world: WorldDefinition, state: SimState, minutes = .25): void {
  prepareHydroBeforeStep(world, state, minutes, 1); prepareHydroBeforeTick(world, state, minutes);
  const at = pagedHydroEndAt(hydroGridClock(state), minutes);
  state.tick++; state.day = Math.floor(at / 1440); state.hour = (at % 1440) / 60;
  state.powerGrid = dispatchHydroGrid(world, state, minutes);
}
function shared(options: Parameters<typeof hydroGridWorld>[0] = {}): WorldDefinition {
  const world = hydroGridWorld(options); grid(world).historyEncoding = 'shared-dispatch-v1'; return world;
}

test('shared encoding is explicit; omitted v2 retains exactly seven state keys', () => {
  const oldWorld = hydroGridWorld(), oldState = initial(oldWorld);
  assert.deepEqual(Object.keys(body(oldState)), ['version', 'kind', 'unit', 'hydro', 'dispatch', 'totals', 'history']);
  assert(!Object.hasOwn(grid(oldWorld), 'historyEncoding'));
  const world = shared(), state = initial(world);
  assert.equal(body(state).historyEncoding, 'shared-dispatch-v1');
  assert.equal(body(state).snapshots!.count, 0);
  validateHydroGridState(state, world);
  assert.deepEqual([...hydroGridWindows(body(state))], []);
});

test('unsupported and accessor encoding cannot silently select legacy v2', () => {
  const world = hydroGridWorld(); Reflect.set(grid(world), 'historyEncoding', 'unknown');
  assert.throws(() => validateHydroGridDefinition(world), /共享|编码/);
  const withGetter = hydroGridWorld(); let invoked = false;
  Object.defineProperty(grid(withGetter), 'historyEncoding', { enumerable: true, get() { invoked = true; return 'shared-dispatch-v1'; } });
  assert.throws(() => validateHydroGridDefinition(withGetter), /数据字段/); assert.equal(invoked, false);
});

test('every old and shared dispatch field, water and totals match at mixed exact native clocks', () => {
  const oldWorld = hydroGridWorld({ nativeVehicle: true }), world = shared({ nativeVehicle: true });
  const supplied = { id: 'controlled-train', kind: 'maglev', edgeId: world.edges[0].id,
    position: { ...world.nodes[0].position }, progress: 0, direction: 1, speed: 10,
    state: 'waiting', passengers: 0, cargo: 0, nextDeparture: 480 } as Vehicle;
  const oldState = initial(oldWorld, [clone(supplied)]), state = initial(world, [clone(supplied)]);
  for (let index = 0; index < 160; index++) {
    const minutes = [.0625, .25, 1, 4][index % 4];
    if (index % 7 === 0) {
      const edge = world.edges[index % world.edges.length].id;
      state.vehicles[0].edgeId = oldState.vehicles[0].edgeId = edge;
    }
    step(oldWorld, oldState, minutes); step(world, state, minutes);
    assert.equal(JSON.stringify(body(state).dispatch), JSON.stringify(body(oldState).dispatch));
    assert.equal(JSON.stringify(body(state).hydro), JSON.stringify(body(oldState).hydro));
    assert.deepEqual(body(state).totals, body(oldState).totals);
  }
  assert.equal(JSON.stringify([...hydroGridWindows(body(state))]), JSON.stringify([...hydroGridWindows(body(oldState))]));
  validateHydroGridState(state, world);
  assert(body(state).snapshots!.count < body(state).history.count);
});

test('depletion, missing feeders, zero demand and closed ports replay original physical arithmetic', () => {
  for (const options of [{ upstreamM3: 1 }, { farmFeeder: false }, { clinicConnected: false }, { zeroDemand: true }, { outfallOpen: false }]) {
    const oldWorld = hydroGridWorld(options), world = shared(options);
    const oldState = initial(oldWorld), state = initial(world);
    for (let index = 0; index < 8; index++) { step(oldWorld, oldState, 4); step(world, state, 4); }
    assert.equal(JSON.stringify([...hydroGridWindows(body(state))]), JSON.stringify([...hydroGridWindows(body(oldState))]));
    validateHydroGridState(state, world);
  }
});

test('shared budget admits complete history beyond the original conservative boundary', () => {
  const oldWorld = hydroGridWorld(), world = shared(), oldState = initial(oldWorld), state = initial(world);
  const bound = 8192 + oldWorld.buildings.length * 1024 + grid(oldWorld).nodes.length * 512 + grid(oldWorld).links.length * 512;
  const limit = Math.floor(4_000_000 / bound);
  for (let index = 0; index < limit; index++) { step(oldWorld, oldState); step(world, state); }
  const before = JSON.stringify(oldState);
  assert.throws(() => prepareHydroBeforeStep(oldWorld, oldState, .25, 1), /预算/);
  assert.equal(JSON.stringify(oldState), before);
  for (let index = 0; index < 40; index++) step(world, state);
  assert.equal(body(state).history.count, limit + 40);
  assert(JSON.stringify(body(state)).length < 4_000_000);
  validateHydroGridState(state, world);
});

test('whole-step reservation includes potentially new snapshots and fails before any parameter changes', () => {
  const world = shared(), state = initial(world), before = JSON.stringify(state);
  assert.throws(() => prepareHydroBeforeStep(world, state, .25, 480), /预算/);
  assert.equal(JSON.stringify(state), before);
  step(world, state); validateHydroGridState(state, world);
});

test('read-only validation gives no live source; full binding freezes and preserves future full outputs', () => {
  const world = shared(), state = initial(world);
  for (let index = 0; index < 12; index++) step(world, state);
  const restored = clone(state), restoredBefore = JSON.stringify(restored);
  validateHydroGridState(restored, world); assert.equal(JSON.stringify(restored), restoredBefore);
  assert.equal(isCanonicalHydroDispatch(restored), false);
  assert.throws(() => prepareHydroBeforeStep(world, restored, .25, 1), /拒绝通用复制、异城、可变或变换后的资产与拓扑/);
  bindHydroGridAfterLoad(world, restored); assert(isCanonicalHydroDispatch(restored));
  assert.throws(() => { body(restored).snapshots!.pages[0][0].windows[0].buildings['other-city-farm'].servedKW = 0; }, TypeError);
  for (let index = 0; index < 24; index++) { step(world, state); step(world, restored); assert.equal(JSON.stringify(restored), JSON.stringify(state)); }
});

test('cold state cannot transplant encoding, discard refs or fake historical generation', () => {
  const world = shared(), state = initial(world); step(world, state);
  const before = JSON.stringify(state);
  for (const mutate of [
    (value: SimState) => { Reflect.deleteProperty(body(value), 'historyEncoding'); },
    (value: SimState) => { Reflect.deleteProperty(body(value), 'snapshots'); },
    (value: SimState) => { Reflect.set(body(value), 'history', { count: 0, pages: [] }); },
    (value: SimState) => { Reflect.set(body(value).history.pages[0][0].windows[0], 'generatedKWh', 1000); },
  ]) {
    const bad = clone(state); mutate(bad); assert.throws(() => validateHydroGridState(bad, world));
    assert.equal(JSON.stringify(state), before);
  }
  const oldWorld = hydroGridWorld(); assert.throws(() => validateHydroGridState(clone(state), oldWorld));
});

test('shared cold history counters and public encoding selectors reject getters without invoking them', () => {
  const world = shared(), state = initial(world); step(world, state);
  const bad = clone(state); let counterInvoked = false, tagInvoked = false;
  Object.defineProperty(body(bad).history, 'count', { enumerable: true, get() { counterInvoked = true; return 1; } });
  assert.throws(() => validateHydroGridState(bad, world), /数据字段/);
  assert.equal(counterInvoked, false);
  const publicBad = clone(body(state));
  Object.defineProperty(publicBad, 'historyEncoding', { enumerable: true, get() { tagInvoked = true; return 'shared-dispatch-v1'; } });
  assert.throws(() => [...hydroGridWindows(publicBad)], /数据编码/);
  assert.equal(tagInvoked, false);
});
