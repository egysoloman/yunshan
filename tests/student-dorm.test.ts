import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { DORM_HOME_COUNT, STUDENT_DORM_POLICY, dormHomes, validateStudentDormPolicy } from '../src/simulation/student-dorm';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a declared city houses its students by the schools; who they are, their district and everyone else stay', () => {
  const world = createProductWorld(), current = createCurrentProductCity(world), archived = createArchivedProductCity(world);
  const homes = world.buildings.filter(b => b.kind === 'home'), schools = world.buildings.filter(b => b.kind === 'school');
  const dorms = new Set(dormHomes(homes, schools).map(b => b.id)), byId = new Map(world.buildings.map(b => [b.id, b]));
  assert.equal(dorms.size, DORM_HOME_COUNT);
  const students = current.state.citizens.filter(c => c.role === '学生');
  assert.ok(students.length > 40);
  for (const s of students) assert.ok(dorms.has(s.homeId), s.id);
  for (const id of dorms) assert.ok(current.state.citizens.filter(c => c.homeId === id).length <= byId.get(id)!.capacity, `${id} within capacity`);
  // Each student's school is the one nearest the dormitory: a short walk to class.
  const far = (c: typeof students[number]) => Math.hypot(byId.get(c.homeId)!.door.x - byId.get(c.workId)!.door.x, byId.get(c.homeId)!.door.z - byId.get(c.workId)!.door.z);
  assert.ok(students.every(s => byId.get(s.workId)!.kind === 'school' && far(s) < 400));
  assert.ok(archived.state.citizens.filter(c => c.role === '学生').some(s => far(s) > 1000), 'an undeclared city keeps the long walks');
  // Arrival homes (arrival-homes.ts) already move the market district's other residents and their jobs.
  assert.deepEqual(current.state.citizens.map(c => [c.id, c.name, c.districtId, c.role === '学生']), archived.state.citizens.map(c => [c.id, c.name, c.districtId, c.role === '学生']));
  assert.deepEqual(current.state.citizens.filter(c => c.role !== '学生' && c.districtId !== 'market').map(c => [c.homeId, c.workId]), archived.state.citizens.filter(c => c.role !== '学生' && c.districtId !== 'market').map(c => [c.homeId, c.workId]));
});

test('the policy is declared in the save, reads back exactly, and is refused when half missing', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  for (let i = 0; i < 8; i++) sim.step(.25);
  const saved = sim.exportSave(), doc = JSON.parse(saved);
  assert.equal(sim.studentDormPolicyId, STUDENT_DORM_POLICY);
  assert.equal(doc.studentDormPolicyId, STUDENT_DORM_POLICY); assert.equal(doc.runtime.studentDormPolicyId, STUDENT_DORM_POLICY);
  const reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  assert.throws(() => validateStudentDormPolicy({ ...doc, studentDormPolicyId: undefined }), /student dorm/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('studentDorm'), false);
});
