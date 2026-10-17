import assert from 'node:assert/strict';
import { test } from 'node:test';
import { departureLabel, rideFare } from '../src/transit-label';
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
