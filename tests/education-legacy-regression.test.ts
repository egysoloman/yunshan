import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';

// NOT_RUN. This file has only the original Simulation source import. It can be
// copied unchanged to coherent15: failure must be the old instantaneous
// education reward, never a missing new API or missing education module.
function originalEntryWorld(): ConstructorParameters<typeof Simulation>[0] {
  type World = ConstructorParameters<typeof Simulation>[0];
  const kinds = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank', 'hall', 'station'] as const;
  const buildings: World['buildings'] = kinds.map((kind, index) => ({ id: `study-entry-${kind}`, name: `学习旧入口${kind}`, kind, districtId: 'study-entry-district', position: { x: index * 60, y: 0, z: 0 }, door: { x: index * 60, y: .6, z: kind === 'school' ? 19 : 6 }, width: kind === 'school' ? 50 : 12, depth: kind === 'school' ? 38 : 12, height: kind === 'school' ? 11.4 : 12, floors: kind === 'school' ? 3 : 2, rotation: 0, capacity: 100, seed: index }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, name: site.name, districtId: site.districtId, position: { ...site.door }, station: true }));
  return { seed: 20261001, voxelSize: .2, size: 2000, buildings, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `study-entry-road-${index}`, mode: 'road', from: nodes[index].id, to: node.id, length: Math.hypot(node.position.x - nodes[index].position.x, node.position.y - nodes[index].position.y, node.position.z - nodes[index].position.z), capacity: 20, points: [nodes[index].position, node.position] })), mountains: [], river: [], waterfall: { top: { x: 1000, y: 60, z: 100 }, bottom: { x: 1000, y: 0, z: 100 }, width: 10 }, districts: [{ id: 'study-entry-district', name: '旧入口街坊', kind: 'school', center: { x: 400, y: 0, z: 0 }, radius: 1000, color: '#aac', population: 384 }], spawn: { ...buildings[0].door } };
}

test('original successful study entry charges a real forty but cannot reward education at admission', () => {
  const sim = new Simulation(originalEntryWorld()), school = sim.worldDefinition.buildings.find(site => site.kind === 'school')!;
  assert.equal(sim.state.citizens.length, 384);
  assert.ok(sim.state.citizens.some(person => person.workId === school.id && person.role === '老师' && sim.state.extension!.actorProfiles[person.id].age >= 18));
  sim.setFocus({ ...school.door }, 'walk');
  const money = sim.state.player.money, education = sim.state.player.education, experience = sim.state.player.experience;
  const result = sim.command({ type: 'exam', targetId: 'study' });
  assert.equal(result.ok, true, result.message);
  assert.equal(sim.state.player.money, money - 40, 'an actual accepted course must deduct forty from the original wallet');
  assert.equal(sim.state.player.education, education, 'coherent15 fails here because its accepted old command immediately upgrades education');
  assert.equal(sim.state.player.experience, experience, 'experience also requires completed teaching');
});

test('a course-free simulation keeps education and its persistence marker absent across exact roundtrip', () => {
  // This checks lazy module compatibility on a course-free candidate save.
  // It is not labelled a genuine frozen coherent15 export; producing that new
  // execution artifact still requires the separate root CPU authorization.
  const world = originalEntryWorld(), sim = new Simulation(world), before = sim.exportSave();
  assert.equal(Reflect.get(sim.state, 'education'), undefined);
  const data = JSON.parse(before); assert.equal(data.runtime.educationVersion, undefined);
  assert.equal(data.runtime.persistedModules.includes('education'), false);
  assert.equal(data.runtime.persistedModules.length, 10);
  const legacy = JSON.parse(before); delete legacy.runtime.persistedModules;
  const withoutManifest = new Simulation(world), legacyLoaded = withoutManifest.importSave(JSON.stringify(legacy));
  assert.equal(legacyLoaded.ok, true, legacyLoaded.message); assert.equal(withoutManifest.exportSave(), before, 'course-free legacy manifest omission remains compatible');
  const next = new Simulation(world), result = next.importSave(before);
  assert.equal(result.ok, true, result.message); assert.equal(next.exportSave(), before);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), `course-free exact continuation tick ${tick + 1}`); }
  assert.equal(Reflect.get(next.state, 'education'), undefined);
});
