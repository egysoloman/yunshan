import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { freightPickupAccess, ROAD_FOOD_PICKUP_POLICY, validateFreightPickupPolicy } from '../src/simulation/freight-access';
import { createWorld } from '../src/world';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { hasCityRulesetDeclaration } from '../src/simulation/city-ruleset';
import type { SimState, Vehicle, WorldDefinition } from '../src/types';

const fixture = new URL('./fixtures/freight-road-door-parameters.json', import.meta.url);

test('pickup policy preserves absence and requires matched explicit v4 native-motion declarations', () => {
  for (const version of [1, 2, 3, 4]) validateFreightPickupPolicy({ version, runtime: {} });
  const declared = { version: 4, motionVersion: 2, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY,
    runtime: { npcMotionVersion: 2, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY } };
  const before = JSON.stringify(declared); validateFreightPickupPolicy(declared); assert.equal(JSON.stringify(declared), before);
  assert.equal(hasCityRulesetDeclaration(declared), true);
  assert.equal(hasCityRulesetDeclaration({ version: 1, state: {}, runtime: { freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY } }), true);
  const invalid = [
    { ...declared, freightPickupPolicyId: undefined }, { ...declared, freightPickupPolicyId: 'invented' },
    { ...declared, version: 3 }, { ...declared, motionVersion: 1 },
    { ...declared, runtime: {} }, { ...declared, runtime: { npcMotionVersion: 1, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY } },
    { ...declared, runtime: { npcMotionVersion: 2, freightPickupPolicyId: 'invented' } },
    { version: 4, motionVersion: 2, runtime: declared.runtime },
  ];
  for (const body of invalid) assert.throws(() => validateFreightPickupPolicy(body), /freight pickup policy pair/);
});

test('47 preserved producer road-door parameter contacts pass without Simulation or changing preserved producer parameters', () => {
  const world: WorldDefinition = createWorld(20261001);
  const original = readFileSync(fixture, 'utf8'), probe = JSON.parse(original);
  assert.equal(savedWorldFingerprint(world), probe.worldFingerprint);
  assert.equal(probe.rows.length, 47);
  const body = { state: { shops: probe.shops, roadNetwork: undefined } };
  const before = JSON.stringify(body), worldBefore = JSON.stringify(world);
  let contacts = 0;
  for (const row of probe.rows) {
    const site = world.buildings.find(site => site.id === row.buildingId)!;
    // Explicit potential arrival parameters derived from the actual road; no
    // carrier is inserted into the imported save and no travel is asserted.
    const vehicle: Vehicle = { id: `potential-${row.edgeId}`, kind: 'road', edgeId: row.edgeId,
      progress: row.direction === 1 ? 1 : 0, direction: row.direction,
      position: { ...row.roadEndpointLanePosition }, speed: 20, state: 'moving', passengers: 0, cargo: 0, nextDeparture: 1920 };
    const state: Pick<SimState, 'vehicles' | 'shops' | 'roadNetwork'> = { vehicles: [vehicle], shops: body.state.shops, roadNetwork: body.state.roadNetwork };
    const witness = freightPickupAccess(world, state, vehicle, row.nodeId, site);
    assert.ok(witness); assert.equal(witness.producerShopId, row.shopId); assert.equal(witness.edgeId, row.edgeId); contacts++;
    assert.ok(Object.isFrozen(witness)); assert.ok(Object.isFrozen(witness.vehiclePosition));
    assert.equal(vehicle.cargo, 0); assert.equal(freightPickupAccess(world, state, { ...vehicle }, row.nodeId, site), null);
  }
  assert.equal(contacts, 47); assert.equal(JSON.stringify(body), before); assert.equal(JSON.stringify(world), worldBefore);
  assert.equal(readFileSync(fixture, 'utf8'), original);
});
