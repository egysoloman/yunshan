import assert from 'node:assert/strict';
import { test } from 'node:test';
import { townLaneDoorEdge } from '../src/simulation/town-lanes';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { CABLE_SPEED_METRES, CABLE_SPEED_POLICY, validateCableSpeedPolicy } from '../src/simulation/cable-speed';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a declared city creates its cable cars at the new pace; an undeclared one keeps the old', () => {
  const world = createProductWorld(), current = createCurrentProductCity(world), archived = createArchivedProductCity(world);
  const cable = (sim: typeof current) => sim.state.vehicles.filter(v => v.kind === 'cable');
  assert.ok(cable(current).length >= 2);
  assert.ok(cable(current).every(v => v.speed === CABLE_SPEED_METRES));
  assert.ok(cable(archived).every(v => v.speed === 6), 'old cities keep 6 m per game minute');
  // Nothing else in the fleet changes (town-lanes-v1 separately leaves out the market town's door carts).
  const lanes = new Set(world.edges.filter(e => townLaneDoorEdge(world, e)).map(e => e.id));
  assert.deepEqual(current.state.vehicles.filter(v => v.kind !== 'cable').map(v => [v.id, v.speed]), archived.state.vehicles.filter(v => v.kind !== 'cable' && !lanes.has(v.edgeId)).map(v => [v.id, v.speed]));
});

test('the policy is declared in the save, reads back exactly, and is refused when half missing', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  for (let i = 0; i < 8; i++) sim.step(.25);
  const saved = sim.exportSave(), doc = JSON.parse(saved);
  assert.equal(doc.cableSpeedPolicyId, CABLE_SPEED_POLICY); assert.equal(doc.runtime.cableSpeedPolicyId, CABLE_SPEED_POLICY);
  const reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  assert.throws(() => validateCableSpeedPolicy({ ...doc, cableSpeedPolicyId: undefined }), /cable speed/);
  assert.throws(() => validateCableSpeedPolicy({ ...doc, cableSpeedPolicyId: 'cable-speed-v0' }), /cable speed/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('cableSpeed'), false, 'an undeclared city carries no policy');
});

test('the cable ride up the mountain takes about a third of the time', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world), s = sim.state;
  sim.setFocus(world.spawn, 'walk');
  const cab = s.vehicles.find(v => v.edgeId === 'cable-core-station-summit-station')!;
  let left = -1, arrived = -1;
  for (let i = 0; i < 8000 && arrived < 0; i++) {
    sim.step(.25); const minute = s.day * 1440 + s.hour * 60;
    if (left < 0 && cab.state === 'moving') left = minute;
    if (left >= 0 && (cab.progress === 1 || cab.progress === 0) && cab.state !== 'moving') arrived = minute;
  }
  assert.ok(left >= 0 && arrived > left, 'it made the trip');
  // 1183 m at 18 m per game minute scaled by the power supply (≥ 0.3): well under the old six hours.
  assert.ok(arrived - left < 180, `${(arrived - left).toFixed(0)} game minutes`);
});
