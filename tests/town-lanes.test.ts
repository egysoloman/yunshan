import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { TOWN_LANES_POLICY, townLaneDoorEdge, validateTownLanesPolicy } from '../src/simulation/town-lanes';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a declared city keeps no cart on the market town shop door links and every other vehicle as before', () => {
  const world = createProductWorld(), { townLanesPolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS;
  const declared = createCurrentProductCity(world), plain = new Simulation(world, withoutRule);
  assert.equal(declared.townLanesPolicyId, TOWN_LANES_POLICY); assert.equal(plain.townLanesPolicyId, undefined);
  const lanes = new Set(world.edges.filter(e => townLaneDoorEdge(world, e)).map(e => e.id));
  assert.equal(world.buildings.filter(b => b.kind === 'market' && b.districtId === 'market').length, 38);
  const onLane = (sim: Simulation) => sim.state.vehicles.filter(v => lanes.has(v.edgeId));
  assert.equal(onLane(declared).length, 0, 'no cart on a town door link');
  assert.equal(onLane(plain).length, 38, 'without the rule each of the 38 shops has its door cart');
  assert.deepEqual(declared.state.vehicles.map(v => v.id), plain.state.vehicles.filter(v => !lanes.has(v.edgeId)).map(v => v.id), 'every other vehicle is the same');
  declared.command({ type: 'speed', value: 8 }); declared.setFocus(world.spawn, 'walk');
  for (let i = 0; i < 40; i++) declared.step(.25);
  const saved = declared.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  assert.equal(onLane(reader).length, 0);
  // A reader built without options (as the audit and a plain load are) accepts the declared save, and a declared
  // reader accepts an undeclared one: the expected fleet follows the save, not the reader.
  const plainReader = new Simulation(world), plainRead = plainReader.importSave(saved);
  assert.ok(plainRead.ok, plainRead.message); assert.equal(plainReader.exportSave(), saved);
  for (let i = 0; i < 8; i++) plain.step(.25);
  const undeclared = plain.exportSave(), declaredReader = createCurrentProductCity(world), crossRead = declaredReader.importSave(undeclared);
  assert.ok(crossRead.ok, crossRead.message); assert.equal(declaredReader.exportSave(), undeclared);
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.townLanesPolicyId, TOWN_LANES_POLICY); assert.equal(doc.runtime.townLanesPolicyId, TOWN_LANES_POLICY);
  assert.throws(() => validateTownLanesPolicy({ ...doc, townLanesPolicyId: undefined }), /town lanes/);
  assert.throws(() => validateTownLanesPolicy({ ...doc, runtime: { ...doc.runtime, townLanesPolicyId: undefined } }), /town lanes/);
  const archived = createArchivedProductCity(world);
  assert.equal(archived.exportSave().includes('townLanes'), false);
});
