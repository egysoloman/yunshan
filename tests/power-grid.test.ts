import assert from 'node:assert/strict';
import test from 'node:test';
import { createPowerGridState, dispatchPowerGrid, gridBuildingSupplyRatio, gridPoweredWorkMinutes, powerGridCommandBoundary, powerGridStatus, validatePowerGridDefinition, validatePowerGridState } from '../src/simulation/power-grid';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { gridState, gridWorld } from './power-grid-fixture';

const close = (a: number, b: number) => assert(Math.abs(a - b) <= 1e-8, `${a} != ${b}`);
function run(world = gridWorld(), minutes = .25) { const state = gridState(world), before = JSON.stringify({ world, state }); const next = dispatchPowerGrid(world, state, minutes); assert.equal(JSON.stringify({ world, state }), before, 'dispatch reads input parameters without editing them'); state.powerGrid = next; validatePowerGridState(state, world); return { world, state, next, dispatch: next.dispatch! }; }

test('another-city IDs route each load through its own feeder and finite storage', () => {
  const { dispatch, next, world } = run(); close(dispatch.demandP, 8); close(dispatch.servedP, 8); close(dispatch.links['north-line'], 2); close(dispatch.links['south-line'], 4); close(next.storedPMinutes['battery-asset'], 9998); close(next.consumedPMinutes['battery-asset'], 2); assert.equal(powerGridStatus(world).generationImplemented, false);
  close(dispatch.availableP, dispatch.servedP + dispatch.curtailedP); close(dispatch.demandP, dispatch.servedP + dispatch.unservedP); assert.deepEqual(dispatch.diagnostics.islandNodeIds, ['island']);
});
test('an open northern feeder isolates its actual farm while southern services remain supplied', () => {
  const world = gridWorld(); world.powerGrid!.links[0].closed = false; const { state, dispatch } = run(world); close(dispatch.buildings['other-city-farm'].servedP, 0); close(dispatch.buildings['other-city-market'].servedP, 2); close(dispatch.buildings['other-city-clinic'].servedP, 2); close(dispatch.links['north-line'], 0); assert.equal(gridBuildingSupplyRatio(state, 'other-city-farm'), 0); assert.equal(gridBuildingSupplyRatio(state, 'other-city-clinic'), 1); assert(dispatch.diagnostics.islandNodeIds.includes('north'));
});
test('wire and substation constraints independently cap actual downstream load', () => {
  const world = gridWorld(); world.powerGrid!.links[1].capacityP = 1.5; const cable = run(world).dispatch; close(cable.buildings['other-city-clinic'].servedP + cable.buildings['other-city-market'].servedP, 1.5); assert(cable.diagnostics.constrainedLinkIds.includes('south-line'));
  world.powerGrid!.links[1].capacityP = 100; world.powerGrid!.nodes.find(node => node.id === 'south')!.capacityP = 1; const station = run(world).dispatch; close(station.nodes.south, 1); close(station.buildings['other-city-clinic'].servedP + station.buildings['other-city-market'].servedP, 1); assert(station.diagnostics.constrainedNodeIds.includes('south')); close(station.buildings['other-city-farm'].servedP, 2);
});
test('finite storage runs out across real declared dispatch intervals and never refills', () => {
  const world = gridWorld(); world.powerGrid!.storage[0].initialStoredPMinutes = 1; const state = gridState(world); state.powerGrid = dispatchPowerGrid(world, state, .25); close(state.powerGrid.storedPMinutes['battery-asset'], 0); close(state.powerGrid.dispatch!.servedP, 4); close(state.powerGrid.dispatch!.unservedP, 4); validatePowerGridState(state, world);
  state.tick++; state.hour += .25 / 60; state.powerGrid = dispatchPowerGrid(world, state, .25); close(state.powerGrid.dispatch!.servedP, 0); close(state.powerGrid.dispatch!.unservedP, 8); close(state.powerGrid.consumedPMinutes['battery-asset'], 1); assert.deepEqual(state.powerGrid.dispatch!.diagnostics.exhaustedStorageIds, ['battery-asset']); validatePowerGridState(state, world);
});
test('null building feeder, missing transport feeder and zero declared supply stay explicitly unserved', () => {
  const world = gridWorld(); world.powerGrid!.buildings.find(load => load.buildingId === 'other-city-clinic')!.nodeId = null; world.powerGrid!.transport = []; const state = gridState(world); state.vehicles = [{ id: 'train', kind: 'maglev', edgeId: world.edges[0].id, position: world.nodes[0].position, progress: 0, direction: 1, speed: 10, state: 'waiting', passengers: 0, cargo: 0, nextDeparture: 480 }]; state.powerGrid = dispatchPowerGrid(world, state, .25); assert.deepEqual(state.powerGrid.dispatch!.diagnostics.unconnectedBuildings, ['other-city-clinic']); assert.deepEqual(state.powerGrid.dispatch!.diagnostics.unconnectedVehicles, ['train']); close(state.powerGrid.dispatch!.vehicles.train.servedP, 0); validatePowerGridState(state, world);
  world.powerGrid!.storage = []; const none = run(world).dispatch; close(none.availableP, 0); close(none.servedP, 0); close(none.unservedP, none.demandP);
});
test('capacitated cycles and several finite sources conserve every node and cable', () => {
  const world = gridWorld(), grid = world.powerGrid!; grid.links.push({ id: 'cross', from: 'north', to: 'south', capacityP: 3, closed: true, points: [grid.nodes[1].position, grid.nodes[2].position] }); grid.storage[0].maximumP = 3; grid.storage.push({ id: 'northern-battery', buildingId: 'other-city-farm', nodeId: 'north', maximumP: 3, initialStoredPMinutes: 10 }); const { dispatch } = run(world); close(dispatch.servedP, 6); close(dispatch.unservedP, 2); assert(Math.abs(dispatch.links.cross) <= 3);
});
test('same energy phase is idempotent and stale building meters cannot grant service work', () => {
  const { world, state } = run(); const before = JSON.stringify(state); assert.equal(dispatchPowerGrid(world, state, .25), state.powerGrid); assert.equal(JSON.stringify(state), before); state.tick++; assert.equal(gridBuildingSupplyRatio(state, 'other-city-farm'), 0); assert.equal(gridBuildingSupplyRatio(state, 'missing'), 0);
});
test('bad capabilities reject rather than mint or silently rebind a power source', () => {
  const variants = [(world: ReturnType<typeof gridWorld>) => { world.powerGrid!.storage[0].nodeId = 'missing'; }, (world: ReturnType<typeof gridWorld>) => { world.powerGrid!.links[0].points[0] = { x: 999, y: 0, z: 0 }; }, (world: ReturnType<typeof gridWorld>) => { world.powerGrid!.buildings.pop(); }, (world: ReturnType<typeof gridWorld>) => { world.powerGrid!.storage[0].initialStoredPMinutes = -1; }, (world: ReturnType<typeof gridWorld>) => { world.powerGrid!.nodes[0].capacityP = Infinity; }, (world: ReturnType<typeof gridWorld>) => { world.powerGrid!.buildings[0].nodeId = 'missing'; }];
  for (const mutate of variants) { const world = gridWorld(); mutate(world); assert.throws(() => validatePowerGridDefinition(world), /电网契约/); }
});
test('saved assets and physical flows reject free energy, open-wire delivery and swapped meters', () => {
  const { state, world } = run(); const mutations = [(copy: typeof state) => { copy.powerGrid!.storedPMinutes['battery-asset']++; }, (copy: typeof state) => { copy.powerGrid!.dispatch!.links['north-line'] = 200; }, (copy: typeof state) => { copy.powerGrid!.dispatch!.buildings['other-city-farm'].nodeId = 'south'; }, (copy: typeof state) => { copy.powerGrid!.dispatch!.sources['battery-asset'].suppliedP++; }, (copy: typeof state) => { copy.powerGrid!.totals.servedPMinutes++; }]; for (const mutate of mutations) { const copy = structuredClone(state); mutate(copy); assert.throws(() => validatePowerGridState(copy, world), /电网契约/); }
});
test('declared geometry and stocks bind saves while absent old contracts keep the original fingerprint', () => {
  const world = gridWorld(), old = structuredClone(world); delete old.powerGrid; const legacyFingerprint = savedWorldFingerprint(old); assert.equal(savedWorldFingerprint(structuredClone(old)), legacyFingerprint); assert.equal(createPowerGridState(old), undefined); assert.equal(powerGridStatus(old).mode, 'legacy-unmodeled'); const fingerprint = savedWorldFingerprint(world); world.powerGrid!.storage[0].initialStoredPMinutes++; assert.notEqual(savedWorldFingerprint(world), fingerprint); delete world.powerGrid; assert.equal(savedWorldFingerprint(world), legacyFingerprint);
});

test('forged zero-demand green and fabricated healthy diagnostics are rejected', () => {
  const { world, state } = run(); const bad = structuredClone(state); bad.powerGrid!.dispatch!.buildings['other-city-farm'].demandP = 0; assert.throws(() => validatePowerGridState(bad, world), /电网契约/); const hidden = structuredClone(state); hidden.powerGrid!.dispatch!.diagnostics.islandNodeIds = []; assert.throws(() => validatePowerGridState(hidden, world), /电网契约/); const zero = gridWorld(); for (const load of zero.powerGrid!.buildings) load.baseP = load.nightP = load.shopP = 0; const result = run(zero); assert.equal(gridBuildingSupplyRatio(result.state, 'other-city-farm'), 0, 'no delivered energy cannot grant powered service');
});

test('a running map cannot reset stored assets or retain a stale dispatch', () => {
  const world = gridWorld(), state = gridState(world); const cold = structuredClone(state); assert.throws(() => validatePowerGridState(cold, world), /电网契约/); state.powerGrid = dispatchPowerGrid(world, state, .25); const stale = structuredClone(state); stale.powerGrid!.dispatch!.tick = 0; assert.throws(() => validatePowerGridState(stale, world), /电网契约/);
});

test('parameter dispatch rejects forged starting assets before offering power or returning an idempotent phase', () => {
  const world = gridWorld(), state = gridState(world); state.powerGrid!.consumedPMinutes['battery-asset'] = 1; assert.throws(() => dispatchPowerGrid(world, state, .25), /电网契约/); const genuine = run(world).state; genuine.powerGrid!.storedPMinutes['battery-asset']++; assert.throws(() => dispatchPowerGrid(world, genuine, .25), /电网契约/);
});

test('transport meters retain the real energy-phase edge across a later traffic feeder change', () => {
  const world = gridWorld(); world.powerGrid!.transport[0].nodeId = 'north'; world.powerGrid!.transport[1].nodeId = 'south'; const state = gridState(world); state.vehicles = [{ id: 'train', kind: 'maglev', edgeId: world.edges[0].id, position: world.nodes[0].position, progress: 0, direction: 1, speed: 10, state: 'waiting', passengers: 0, cargo: 0, nextDeparture: 480 }]; state.powerGrid = dispatchPowerGrid(world, state, .25); assert.equal(state.powerGrid.dispatch!.vehicles.train.edgeId, world.edges[0].id); assert.equal(state.powerGrid.dispatch!.vehicles.train.nodeId, 'north'); state.vehicles[0].edgeId = world.edges[1].id; validatePowerGridState(state, world); const bad = structuredClone(state); bad.powerGrid!.dispatch!.vehicles.train.nodeId = 'south'; assert.throws(() => validatePowerGridState(bad, world), /电网契约/); const missing = structuredClone(state); missing.powerGrid!.dispatch!.vehicles.train.edgeId = 'missing'; assert.throws(() => validatePowerGridState(missing, world), /电网契约/);
});
test('far-tier paid historical front cannot receive the present energy window; actual overlaps remain finite', () => {
  const world = gridWorld(), state = gridState(world); state.tick = 64; state.hour = 544 / 60; state.powerGrid = dispatchPowerGrid(world, state, 4); assert.equal(gridPoweredWorkMinutes(state, 'other-city-farm', { startAt: 480, endAt: 512 }, 32), 0, 'all original credited front precedes current 540..544 power window'); assert.equal(gridPoweredWorkMinutes(state, 'other-city-farm', { startAt: 542, endAt: 544 }, 2), 2); assert.equal(gridPoweredWorkMinutes(state, 'other-city-farm', { startAt: 539, endAt: 541 }, 2), 1); assert.equal(gridPoweredWorkMinutes(state, 'other-city-farm', { startAt: 544, endAt: 548 }, 4), 0); const unconnected = structuredClone(state); unconnected.powerGrid!.dispatch!.buildings['other-city-farm'].nodeId = null; assert.equal(gridPoweredWorkMinutes(unconnected, 'other-city-farm', { startAt: 540, endAt: 544 }, 4), 0);
});

test('daytime permitted zero-base shops request real load even while cold closed; midnight requests none', () => {
  const world = gridWorld(); for (const load of world.powerGrid!.buildings) load.baseP = load.nightP = 0; const state = gridState(world); state.shops = [{ id: 'shop-farm', buildingId: 'other-city-farm', districtId: 'other-city', inventory: 1, price: 8, revenue: 0, profit: 0, customers: 0, open: false, employees: 1 }]; state.powerGrid = dispatchPowerGrid(world, state, .25); assert.equal(state.powerGrid.dispatch!.demandP, .5); assert.equal(state.powerGrid.dispatch!.buildings['other-city-farm'].servedP, .5); assert.equal(gridBuildingSupplyRatio(state, 'other-city-farm'), 1); validatePowerGridState(state, world); const night = gridState(world); night.tick = 1; night.hour = 23; night.shops = state.shops; night.powerGrid = dispatchPowerGrid(world, night, .25); assert.equal(night.powerGrid.dispatch!.demandP, 0); assert.equal(gridBuildingSupplyRatio(night, 'other-city-farm'), 0);
});

test('declared finite grids reject native clock jumps without granting history; absent legacy maps leave their original command path', () => {
  const world = gridWorld(), before = JSON.stringify(world);
  const result = powerGridCommandBoundary(world, { type: 'setTime', value: 10 });
  assert.equal(result?.ok, false); assert.match(result!.message, /逐相位结算实际用电/);
  assert.equal(JSON.stringify(world), before, 'pure command boundary does not mutate map assets');
  assert.equal(powerGridCommandBoundary(world, { type: 'speed', value: 4 }), null);
  const legacy = structuredClone(world); delete legacy.powerGrid;
  assert.equal(powerGridCommandBoundary(legacy, { type: 'setTime', value: 10 }), null, 'legacy native implementation still handles the original clock command');
});
