import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOARDING_REACH, departureLabel, rideFare, stoppedVehicleFirst } from '../src/transit-label';
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
});
