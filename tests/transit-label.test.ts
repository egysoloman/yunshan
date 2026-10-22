import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOARDING_REACH, departureLabel, eBoardsVehicle, rideArrivalLabel, freshRideStop, nextStopName, nextStopTitle, rideFare, stoppedVehicleFirst } from '../src/transit-label';
import type { Vehicle } from '../src/types';
import { createCurrentProductCity, createProductWorld } from '../src/product-city';

test('a stopped vehicle tells how long it still waits; the shown fare is the fare the city charges', () => {
  const at = { day: 0, hour: 8 };
  assert.equal(departureLabel({ state: 'boarding', nextDeparture: 486.2 }, at), ' · 约 7 分钟后开出');
  assert.equal(departureLabel({ state: 'waiting', nextDeparture: 480 }, at), ' · 即将开出');
  assert.equal(departureLabel({ state: 'moving', nextDeparture: 490 }, at), '');
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  sim.command({ type: 'speed', value: 8 });
  let vehicle = sim.state.vehicles.find(v => v.kind === 'road' && (v.state === 'boarding' || v.state === 'waiting'));
  for (let i = 0; i < 200 && !vehicle; i++) { sim.step(.25); vehicle = sim.state.vehicles.find(v => v.kind === 'road' && (v.state === 'boarding' || v.state === 'waiting')); }
  assert.ok(vehicle, 'a road vehicle stops to board');
  sim.state.player.position = { ...vehicle!.position };
  const before = sim.state.player.money, result = sim.command({ type: 'ride', targetId: vehicle!.id });
  assert.ok(result.ok, result.message);
  assert.equal(before - sim.state.player.money, rideFare(vehicle!.kind));
});

test('a stopped vehicle within reach and nearer than the door comes first', () => {
  const p = { x: 0, y: 0, z: 0 };
  const at = (x: number, state: Vehicle['state'] = 'waiting') => ({ state, position: { x, y: 0, z: 0 } }) as Pick<Vehicle, 'state' | 'position'>;
  assert.equal(stoppedVehicleFirst(p, at(5), { x: 7, y: 0, z: 0 }), true);
  assert.equal(stoppedVehicleFirst(p, at(5, 'boarding'), null), true);
  assert.equal(stoppedVehicleFirst(p, at(5, 'moving'), null), false);
  assert.equal(stoppedVehicleFirst(p, at(5), { x: 3, y: 0, z: 0 }), false);
  assert.equal(stoppedVehicleFirst(p, at(BOARDING_REACH + 0.5), null), false);
  assert.equal(stoppedVehicleFirst(p, null, null), false);
  // E follows the tab the panel shows: never boards on the place tab, boards on the vehicle tab even with the door nearer.
  assert.equal(eBoardsVehicle(p, at(5), { x: 7, y: 0, z: 0 }, 'building'), false);
  assert.equal(eBoardsVehicle(p, at(5), { x: 3, y: 0, z: 0 }, 'vehicle'), true);
  assert.equal(eBoardsVehicle(p, at(5, 'moving'), null, 'vehicle'), false);
  assert.equal(eBoardsVehicle(p, at(5), { x: 7, y: 0, z: 0 }, null), true);
  assert.equal(eBoardsVehicle(p, at(5), { x: 3, y: 0, z: 0 }, 'citizen'), false);
});

test('the next stop a stopped vehicle shows is where the simulation next brings it', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  sim.command({ type: 'speed', value: 8 });
  // Arrivals are announced only from mid-edge (a short spur crossed in one step is silent), so each
  // prediction is checked against the arrival that ends the leg it was read from.
  const predicted = new Map<string, { edgeId: string; stop: string }>(), checked: boolean[] = [];
  sim.onEvent('vehicle-arrived', event => {
    const { vehicleId, nodeId, fromEdgeId } = event as unknown as { vehicleId: string; nodeId: string; fromEdgeId: string };
    const p = predicted.get(vehicleId); predicted.delete(vehicleId);
    if (p?.edgeId === fromEdgeId) checked.push(world.nodes.find(n => n.id === nodeId)!.name === p.stop);
  });
  for (let i = 0; i < 400 && checked.length < 30; i++) {
    for (const v of sim.state.vehicles) if ((v.state === 'boarding' || v.state === 'waiting') && !predicted.has(v.id)) { const stop = nextStopName(v, world, sim.state); if (stop) predicted.set(v.id, { edgeId: v.edgeId, stop }); }
    sim.step(.25);
  }
  assert.ok(checked.length >= 30, `checked ${checked.length} arrivals`);
  assert.ok(checked.every(Boolean), `${checked.filter(x => !x).length} of ${checked.length} arrivals went elsewhere`);
  assert.equal(nextStopTitle({ edgeId: world.edges[0].id, direction: 1, progress: 1 }, world, sim.state), null, 'at the end it was heading for, the next leg is not chosen yet');
});

test('a ride that pulls in to a stop says once which stop it is and how to get off', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  sim.command({ type: 'speed', value: 8 });
  let vehicle = sim.state.vehicles.find(v => v.kind === 'road' && (v.state === 'boarding' || v.state === 'waiting'));
  for (let i = 0; i < 200 && !vehicle; i++) { sim.step(.25); vehicle = sim.state.vehicles.find(v => v.kind === 'road' && (v.state === 'boarding' || v.state === 'waiting')); }
  sim.state.player.position = { ...vehicle!.position };
  assert.ok(sim.command({ type: 'ride', targetId: vehicle!.id }).ok);
  let seen = freshRideStop(sim.state, world, null).seen;
  assert.equal(freshRideStop(sim.state, world, seen).notice, null, 'boarding a stopped vehicle is not news');
  const arrivals: string[] = []; sim.onEvent('vehicle-arrived', event => { const e = event as unknown as { vehicleId: string; nodeId: string }; if (e.vehicleId === vehicle!.id) arrivals.push(world.nodes.find(n => n.id === e.nodeId)!.name); });
  const notices: string[] = [];
  for (let i = 0; i < 800 && notices.length < 2; i++) { sim.step(.25); const r = freshRideStop(sim.state, world, seen); seen = r.seen; if (r.notice) notices.push(r.notice); }
  assert.ok(notices.length >= 1, 'the ride reached a stop');
  assert.match(notices[0], /^到站：.+。按 E 下车/);
  assert.ok(arrivals.some(name => notices[0].startsWith(`到站：${name}。`)), `${notices[0]} names a stop the vehicle really arrived at (${arrivals.join(', ')})`);
  assert.equal(freshRideStop(sim.state, world, seen).notice, null, 'said once per stop');
  const left = sim.command({ type: 'leaveVehicle' }); assert.ok(left.ok, left.message);
  assert.deepEqual(freshRideStop(sim.state, world, seen), { seen: { vehicleId: null, stopped: false }, notice: null });
});

test('the vehicle the player rides says about how long until its stop, by the movement rule', () => {
  const world = { edges: [{ id: 'cable-a-b', from: 'a', to: 'b', mode: 'cable', length: 1200, capacity: 1, points: [] }] } as any;
  const ride = (over: Record<string, unknown> = {}) => ({ id: 'cab', kind: 'cable', edgeId: 'cable-a-b', progress: .25, direction: 1, speed: 6, state: 'moving', nextDeparture: 0, passengers: 1, cargo: 0, position: { x: 0, y: 0, z: 0 }, ...over }) as any;
  const state = (over: Record<string, unknown> = {}) => ({ day: 0, hour: 10, energy: 50, player: { vehicleId: 'cab' }, ...over }) as any;
  // 900 m left at 6 × 0.5 = 3 m per game minute: 300 minutes.
  assert.equal(rideArrivalLabel(ride(), world, state()), '约 5 小时 0 分后到站');
  assert.equal(rideArrivalLabel(ride({ progress: .9 }), world, state({ energy: 100 })), '约 20 分钟后到站');
  assert.equal(rideArrivalLabel(ride({ progress: .25, direction: -1 }), world, state({ energy: 100 })), '约 50 分钟后到站', 'heading back toward progress 0');
  assert.equal(rideArrivalLabel(ride({ state: 'waiting', nextDeparture: 10 * 60 + 5, progress: 1, direction: -1 }), world, state({ energy: 100 })), '约 3 小时 25 分后到站', 'the wait before leaving counts too');
  assert.equal(rideArrivalLabel(ride(), world, state({ player: { vehicleId: 'other' } })), null, 'only for the vehicle the player rides');
  assert.equal(rideArrivalLabel(ride(), world, state({ energy: 10 })), null, 'without power it says nothing');
});
