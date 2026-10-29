import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { ARRIVAL_HOME_COUNT, ARRIVAL_HOMES_POLICY, arrivalHomes, validateArrivalHomesPolicy } from '../src/simulation/arrival-homes';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a declared city houses the arrival district near the arrival; everything else about its residents stays', () => {
  const world = createProductWorld(), current = createCurrentProductCity(world), archived = createArchivedProductCity(world), spawn = world.spawn;
  const homes = world.buildings.filter(b => b.kind === 'home'), arrival = arrivalHomes(homes, spawn)!;
  assert.equal(arrival.districtId, 'market'); assert.equal(arrival.homes.length, ARRIVAL_HOME_COUNT);
  const near = new Set(arrival.homes.map(h => h.id)), byId = new Map(world.buildings.map(b => [b.id, b]));
  const within = (sim: typeof current, r: number) => sim.state.citizens.filter(c => Math.hypot(byId.get(c.homeId)!.door.x - spawn.x, byId.get(c.homeId)!.door.z - spawn.z) < r).length;
  // current-v9's dense market town already houses most of its district near the arrival (18 in current-v8).
  // Students of a declared city live in the dormitories by the schools (student-dorm.ts); everyone else of the
  // arrival district lives near the arrival.
  const marketStudents = current.state.citizens.filter(c => c.districtId === 'market' && c.role === '学生').length;
  assert.equal(within(archived, 300), 53); assert.equal(within(current, 300), 56 - marketStudents, 'the arrival district lives within 300 m');
  for (const c of current.state.citizens.filter(c => c.districtId === 'market' && c.role !== '学生')) assert.ok(near.has(c.homeId), c.id);
  for (const h of arrival.homes) assert.ok(current.state.citizens.filter(c => c.homeId === h.id).length <= h.capacity);
  // Same people, same districts; other districts' homes are untouched.
  assert.deepEqual(current.state.citizens.map(c => [c.id, c.name, c.districtId]), archived.state.citizens.map(c => [c.id, c.name, c.districtId]));
  assert.deepEqual(current.state.citizens.filter(c => c.districtId !== 'market' && c.role !== '学生').map(c => c.homeId), archived.state.citizens.filter(c => c.districtId !== 'market' && c.role !== '学生').map(c => c.homeId));
});

test('the policy is declared in the save, reads back exactly, and is refused when half missing', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  for (let i = 0; i < 8; i++) sim.step(.25);
  const saved = sim.exportSave(), doc = JSON.parse(saved);
  assert.equal(doc.arrivalHomesPolicyId, ARRIVAL_HOMES_POLICY); assert.equal(doc.runtime.arrivalHomesPolicyId, ARRIVAL_HOMES_POLICY);
  const reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  assert.throws(() => validateArrivalHomesPolicy({ ...doc, arrivalHomesPolicyId: undefined }), /arrival homes/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('arrivalHomes'), false, 'an undeclared city carries no policy');
});
