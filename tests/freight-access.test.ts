import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freightPickupAccess } from '../src/simulation/freight-access';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import type { Building, SimState, Vehicle, WorldDefinition } from '../src/types';

function fixture() {
  const site: Building = { id: 'farm', districtId: 'growers', name: 'farm', kind: 'farm', position: { x: 0, y: 20, z: 0 },
    door: { x: 0, y: 20, z: 5 }, width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 20, seed: 1 };
  const world: WorldDefinition = { seed: 1, voxelSize: .2, size: 500, districts: [{ id: 'growers', name: 'growers', kind: 'river', center: site.position, radius: 200, color: '#aaa', population: 12 }], buildings: [site],
    nodes: [{ id: 'farm-door', districtId: 'growers', name: 'farm', position: { ...site.door }, station: false },
      { id: 'hub', districtId: 'growers', name: 'hub', position: { x: 0, y: 20, z: 205 }, station: true }],
    edges: [{ id: 'farm-road', from: 'farm-door', to: 'hub', mode: 'road', length: 200, capacity: 20, points: [{ ...site.door }, { x: 0, y: 20, z: 205 }] }],
    mountains: [], spawn: { x: 5, y: 20, z: 205 }, river: [], waterfall: { top: { x: 300, y: 50, z: 0 }, bottom: { x: 300, y: 20, z: 0 }, width: 5 } };
  const vehicle: Vehicle = { id: 'actual-carrier', kind: 'road', edgeId: 'farm-road', progress: 0, direction: -1, position: { x: 1.3, y: 20, z: 5 }, speed: 20, state: 'moving', passengers: 0, cargo: 0, nextDeparture: 480 };
  const state: Pick<SimState, 'vehicles' | 'shops' | 'roadNetwork'> = { vehicles: [vehicle], shops: [{ id: 'shop-farm', buildingId: 'farm', districtId: 'growers', inventory: 160, price: 8, revenue: 0, profit: 0, customers: 0, open: true, employees: 0 }] };
  return { world, state, vehicle, site, access: () => freightPickupAccess(world, state, vehicle, 'farm-door', site) };
}

test('pickup proves the actual native lane stop and producer identity without changing inventory, money or references', () => {
  const f = fixture(), before = JSON.stringify(f), witness = f.access();
  assert.ok(witness); assert.equal(witness.producerShopId, 'shop-farm'); assert.equal(witness.vehicleId, f.vehicle.id);
  assert.equal(JSON.stringify(f), before); assert.ok(Object.isFrozen(witness)); assert.ok(Object.isFrozen(witness.vehiclePosition));
  assert.notEqual(witness.vehiclePosition, f.vehicle.position);
});

test('nearby endpoints, wrong direction, remote bodies, different lanes and forged objects do not prove pickup', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.vehicle.progress = .0001; },
    (f: ReturnType<typeof fixture>) => { f.vehicle.direction = 1; },
    (f: ReturnType<typeof fixture>) => { f.vehicle.position.x = -1.3; },
    (f: ReturnType<typeof fixture>) => { f.vehicle.position.z += .02; },
    (f: ReturnType<typeof fixture>) => { f.vehicle.position.y += .01; },
    (f: ReturnType<typeof fixture>) => { f.vehicle.position.x = Number.NaN; },
    (f: ReturnType<typeof fixture>) => { f.world.nodes[0].id = 'nearby-node'; },
    (f: ReturnType<typeof fixture>) => { f.world.nodes[0].districtId = 'customers'; },
    (f: ReturnType<typeof fixture>) => { f.world.nodes[0].position.x += .01; },
    (f: ReturnType<typeof fixture>) => { f.world.edges[0].points[0].z += .01; },
    (f: ReturnType<typeof fixture>) => { f.world.edges[0].mode = 'flight'; },
  ]) { const f = fixture(); change(f); assert.equal(f.access(), null); }
  const f = fixture(); assert.equal(freightPickupAccess(f.world, f.state, { ...f.vehicle }, 'farm-door', f.site), null);
  assert.equal(freightPickupAccess(f.world, f.state, f.vehicle, 'farm-door', { ...f.site }), null);
});

test('existing cargo, missing or wrong producer, non-food sites and a closed road deny access without reattributing goods', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.vehicle.cargo = 28; },
    (f: ReturnType<typeof fixture>) => { f.state.shops[0].inventory = .999; },
    (f: ReturnType<typeof fixture>) => { f.state.shops[0].inventory = Number.NaN; },
    (f: ReturnType<typeof fixture>) => { f.state.shops[0].districtId = 'customers'; },
    (f: ReturnType<typeof fixture>) => { f.state.shops.length = 0; },
    (f: ReturnType<typeof fixture>) => { f.site.kind = 'workshop'; },
    (f: ReturnType<typeof fixture>) => { f.site.facility = 'data'; },
    (f: ReturnType<typeof fixture>) => { f.state.roadNetwork = { version: 1, activatedAt: 480, revision: 1, nextClosureId: 2, permits: {}, closures: [{ id: 'closure-1', edgeId: 'farm-road', sourceEventId: 1, districtId: 'growers', occurredAt: 480, severity: .5, closedRevision: 1, worksiteNodeId: 'farm-door', worksite: { ...f.site.door }, reopenedAt: null, repairedBy: null, reopenedRevision: null, occupants: [] }] }; },
  ]) { const f = fixture(); change(f); const before = JSON.stringify(f); assert.equal(f.access(), null); assert.equal(JSON.stringify(f), before); }
});

test('a reversed trusted path endpoint uses the original signed road lane and a flight needs its own exact endpoint', () => {
  const f = fixture(), edge = f.world.edges[0];
  [edge.from, edge.to] = [edge.to, edge.from]; edge.points.reverse(); f.vehicle.progress = 1; f.vehicle.direction = 1;
  assert.ok(f.access()); f.vehicle.kind = 'flight'; edge.mode = 'flight'; assert.equal(f.access(), null);
  f.vehicle.position = { ...f.site.door }; assert.ok(f.access());
});

test('the preserved default-city geometry has 47 finite legal pickup contacts while the original room predicate rejects the lanes', () => {
  const world = createWorld(20261001), sim = new Simulation(world), before = sim.exportSave();
  assert.equal(world.layoutVersion, 'current-v6');
  const pointOn = (edge: WorldDefinition['edges'][number], progress: number) => Reflect.get(sim, 'pointOn').call(sim, edge, progress) as Vehicle['position'];
  let sources = 0, contacts = 0, originalLaneRejections = 0;
  for (const site of world.buildings.filter(row => !row.facility && ['farm', 'dock'].includes(row.kind))) {
    sources++;
    for (const edge of world.edges.filter(row => row.mode === 'road' && [row.from, row.to].includes(`${site.id}-door`))) {
      const progress = edge.from === `${site.id}-door` ? 0 : 1, direction = progress === 0 ? -1 : 1;
      const position = { ...pointOn(edge, progress) }, front = pointOn(edge, Math.min(1, progress + .001)), back = pointOn(edge, Math.max(0, progress - .001));
      const dx = front.x - back.x, dz = front.z - back.z, length = Math.hypot(dx, dz);
      if (length > .001) { position.x -= dz / length * direction * 1.3; position.z += dx / length * direction * 1.3; }
      // A separate declared potential-arrival fixture, never inserted into sim.
      const vehicle: Vehicle = { id: `potential-${edge.id}`, kind: 'road', edgeId: edge.id, progress, direction, position, speed: 20, state: 'moving', passengers: 0, cargo: 0, nextDeparture: 480 };
      const state = { vehicles: [vehicle], shops: sim.state.shops, roadNetwork: sim.state.roadNetwork };
      assert.ok(freightPickupAccess(world, state, vehicle, `${site.id}-door`, site)); contacts++;
      assert.equal(sim.isNearBuilding(site, position, 2), false); originalLaneRejections++;
    }
  }
  assert.equal(sources, 47); assert.equal(contacts, 47); assert.equal(originalLaneRejections, 47);
  // Query actual original vehicles as well. No carrier, cargo, actor, clock,
  // observer, decision, position or RNG changes may be introduced by access.
  for (const vehicle of sim.state.vehicles) for (const site of world.buildings.filter(row => ['farm', 'dock'].includes(row.kind)))
    freightPickupAccess(world, sim.state, vehicle, `${site.id}-door`, site);
  assert.equal(sim.state.tick, 0); assert.equal(sim.exportSave(), before);
});

test('an original generated carrier really travels to the farm and the access observer preserves full saves and RNG', () => {
  const native = createWorld(20261001), farm = native.buildings.find(site => site.kind === 'farm')!;
  // Declared smaller world, with the unchanged native farm body and a native
  // 28-unit carrier recipe. No actor, cargo, needs, departure, money, stock,
  // attendance, decision, signal or speed is overwritten after construction.
  const world: WorldDefinition = { ...native, buildings: [farm], districts: native.districts.filter(district => district.id === farm.districtId).map(district => ({ ...district, population: 12 })),
    nodes: [{ id: `${farm.id}-door`, districtId: farm.districtId, name: farm.name, station: true, position: { ...farm.door } },
      { id: 'fixture-hub', districtId: farm.districtId, name: 'fixture-hub', station: true, position: { x: farm.door.x, y: farm.door.y, z: farm.door.z + 200 } }],
    edges: [{ id: 'actual-food-road', from: `${farm.id}-door`, to: 'fixture-hub', mode: 'road', length: 200, capacity: 20, points: [{ ...farm.door }, { x: farm.door.x, y: farm.door.y, z: farm.door.z + 200 }] }], spawn: { x: farm.door.x + 5, y: farm.door.y, z: farm.door.z + 205 } };
  const observed = new Simulation(world), control = new Simulation(world), carrierId = 'vehicle-actual-food-road-1';
  const carrier = observed.state.vehicles.find(vehicle => vehicle.id === carrierId)!;
  assert.equal(carrier.cargo, 28); assert.equal(carrier.progress, .5); assert.equal(carrier.direction, -1);
  assert.equal(Reflect.get(observed, 'freightCarriers').get(carrierId).cargoCapacity, 28);
  let contact: Record<string, unknown> | null = null, arrived = 0;
  observed.onEvent('vehicle-arrived', event => {
    if (event.vehicleId !== carrierId || event.nodeId !== `${farm.id}-door`) return;
    arrived++; const before = observed.exportSave(), witness = freightPickupAccess(world, observed.state, carrier, event.nodeId, farm);
    assert.equal(observed.exportSave(), before, 'real arrival query leaves full body, runtime and RNG unchanged');
    if (!witness) return;
    assert.equal(carrier.cargo, 0, 'the original anonymous cargo was first naturally unloaded');
    assert.equal(observed.isNearBuilding(farm, carrier.position, 2), false, 'original interior guard still rejects this actual native lane');
    contact = { tick: observed.state.tick, time: observed.state.extension!.lastUpdate, vehicleId: carrier.id, arrived,
      edgeId: carrier.edgeId, progress: carrier.progress, direction: carrier.direction, position: { ...carrier.position },
      cargo: carrier.cargo, inventory: observed.state.shops.find(shop => shop.buildingId === farm.id)!.inventory, witness };
  });
  for (let i = 0; i < 900 && !contact; i++) {
    observed.step(.25); control.step(.25); assert.equal(observed.exportSave(), control.exportSave(), `observer exact native tick ${i + 1}`);
  }
  assert.ok(contact, 'a real original empty carrier must return along its original route within the fixed 900-tick window');
  assert.ok(arrived >= 2, 'includes the initial anonymous-stock arrival and a later actually empty arrival');
  const saved = observed.exportSave(), restored = new Simulation(world), imported = restored.importSave(saved);
  assert.ok(imported.ok, imported.message); assert.equal(restored.exportSave(), saved);
  for (let i = 0; i < 24; i++) { observed.step(.25); restored.step(.25); assert.equal(observed.exportSave(), restored.exportSave()); }
  if (process.env.FREIGHT_ACCESS_ARTIFACTS) {
    mkdirSync(process.env.FREIGHT_ACCESS_ARTIFACTS, { recursive: true });
    writeFileSync(join(process.env.FREIGHT_ACCESS_ARTIFACTS, 'ACTUAL-NATIVE-ARRIVAL.json'), JSON.stringify({ scope: 'Declared one-native-farm / one 200m road / original 28-unit fleet recipe; real travel, zero post-constructor edits; pure observer only, product pickup consumer NOT installed.', contact, fullSaveObserverExact: true, restoredFuture24Exact: true }, null, 2));
    writeFileSync(join(process.env.FREIGHT_ACCESS_ARTIFACTS, 'ACTUAL-NATIVE-ARRIVAL.save.json'), saved);
  }
});
