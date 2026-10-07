import assert from 'node:assert/strict';
import test from 'node:test';
import type { SimState, Vehicle } from '../src/types';
import { hydroGridWorld } from './power-grid-hydro-fixture';
import { sharedHydroAppendCharUpperBound } from '../src/simulation/hydro-grid-budget';
import { makeHydroSnapshot } from '../src/simulation/hydro-dispatch-history';
import { createHydroGridState, dispatchHydroGrid, hydroGridClock, prepareHydroBeforeStep,
  prepareHydroBeforeTick, validateHydroGridState, type HydroPowerGridDefinition } from '../src/simulation/power-grid-hydro';
import { pagedHydroEndAt } from '../src/simulation/power-hydro-runtime';

test('schema reserve covers actual append, variable clocks and all historical pages without depending on reuse', () => {
  const world = hydroGridWorld({ nativeVehicle: true });
  (world.powerGrid as HydroPowerGridDefinition).historyEncoding = 'shared-dispatch-v1';
  const vehicle = { id: 'parameter-train', kind: 'maglev', edgeId: world.edges[0].id, position: { ...world.nodes[0].position },
    progress: 0, direction: 1, speed: 10, state: 'waiting', passengers: 0, cargo: 0, nextDeparture: 480 } as Vehicle;
  const state = { tick: 0, day: 0, hour: 8, shops: [], vehicles: [vehicle], energy: 0, districts: [] } as unknown as SimState;
  state.powerGrid = createHydroGridState(world, state);
  const reserve = sharedHydroAppendCharUpperBound(world, state);
  for (let index = 0; index < 260; index++) {
    const before = JSON.stringify(state.powerGrid).length, minutes = [.0625, .25, 1, 4][index % 4];
    vehicle.edgeId = world.edges[index % world.edges.length].id;
    prepareHydroBeforeStep(world, state, minutes, 1); prepareHydroBeforeTick(world, state, minutes);
    const at = pagedHydroEndAt(hydroGridClock(state), minutes); state.tick++; state.day = Math.floor(at / 1440); state.hour = (at % 1440) / 60;
    state.powerGrid = dispatchHydroGrid(world, state, minutes);
    assert(JSON.stringify(state.powerGrid).length - before <= reserve);
  }
  assert.equal(state.powerGrid!.history.count, 260); validateHydroGridState(state, world);
});

test('future schema cost includes all legal edge IDs and all diagnostic identity sets', () => {
  const world = hydroGridWorld({ nativeVehicle: true }), grid = world.powerGrid as HydroPowerGridDefinition;
  const state = { shops: [{ id: 'shop-parameter', buildingId: world.buildings[0].id }], vehicles: [{ id: 'parameter-train' }] } as unknown as SimState;
  const before = sharedHydroAppendCharUpperBound(world, state);
  const oldEdge = world.edges[0].id; world.edges[0].id = 'e'.repeat(120);
  const longEdgeReserve = sharedHydroAppendCharUpperBound(world, state); assert(longEdgeReserve > before);
  // Longer permitted node IDs increase every future nullable meter and both
  // diagnostic arrays even when the present window is not on that node/edge.
  grid.nodes[0].id = 'n'.repeat(120); const longNodeReserve = sharedHydroAppendCharUpperBound(world, state);
  assert(longNodeReserve > longEdgeReserve); assert.notEqual(oldEdge, world.edges[0].id);
  assert.equal(state.vehicles.length, 1); assert.equal(state.shops.length, 1);
});

test('complete snapshot plus complete current dispatch remains below reserve even with all diagnostic arrays populated', () => {
  const world = hydroGridWorld(), grid = world.powerGrid as HydroPowerGridDefinition;
  const state = { tick: 0, day: 0, hour: 8, shops: [], vehicles: [], energy: 0, districts: [] } as unknown as SimState;
  state.powerGrid = createHydroGridState(world, state);
  prepareHydroBeforeStep(world, state, .25, 1); prepareHydroBeforeTick(world, state, .25);
  const at = pagedHydroEndAt(hydroGridClock(state), .25); state.tick++; state.hour = at / 60;
  state.powerGrid = dispatchHydroGrid(world, state, .25);
  const window = JSON.parse(JSON.stringify(state.powerGrid.dispatch!));
  // Pure character oracle only: this deliberately pessimistic diagnostic
  // combination is not asserted to be a physically possible city solution.
  window.diagnostics = { unconnectedBuildings: world.buildings.map(item => item.id), unconnectedVehicles: [],
    islandNodeIds: grid.nodes.map(item => item.id), exhaustedSourceIds: grid.sources.map(item => item.id),
    constrainedLinkIds: grid.links.map(item => item.id), constrainedNodeIds: grid.nodes.map(item => item.id) };
  const combined = JSON.stringify(window).length + JSON.stringify(makeHydroSnapshot(window)).length;
  assert(combined < sharedHydroAppendCharUpperBound(world, state));
});
