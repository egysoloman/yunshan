import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { civicSite, publicFloor } from '../src/simulation/culture.ts';
import type { Building, BuildingKind, Citizen, Command, WorldDefinition } from '../src/types.ts';

const BODY = '山城的读者沿着真实街道相遇，记录群山水岸与共同生活中的希望。';
function fixture(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'school', 'market', 'pavilion', 'hall', 'workshop', 'clinic', 'station', 'bank'];
  const district = { id: 'culture-district', name: '文澜测试街坊', kind: 'school', center: { x: 0, y: 0, z: 0 }, radius: 1000, color: '#779ab0', population: 384 };
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `culture-${kind}`, name: `文澜${kind}`, kind, districtId: district.id, position: { x: index * 70, y: 0, z: 0 }, door: { x: index * 70, y: 0, z: 6 }, width: 12, depth: 12, height: 12, floors: 2, rotation: 0, capacity: 128, seed: index }));
  buildings.push({ id: 'core-main', name: '天枢阁', kind: 'core', facility: 'mayor', districtId: district.id, position: { x: 700, y: 0, z: 0 }, door: { x: 700, y: 0, z: 6 }, width: 20, depth: 20, height: 18, floors: 3, publicFloors: 1, floorPermissions: ['public', 'mayor', 'public'], floorUses: ['市民公共大厅', '市长决策层', '公共观景'], rotation: 0, capacity: 100, seed: 99 });
  const nodes = [0, 1].map(index => ({ id: `culture-node-${index}`, name: `文澜驿站${index}`, districtId: district.id, position: { x: index * 700, y: 0, z: 20 }, station: true }));
  return { seed: 718, voxelSize: .2, size: 2500, districts: [district], buildings, nodes, edges: [{ id: 'culture-road', mode: 'road', from: nodes[0].id, to: nodes[1].id, length: 700, capacity: 40, points: nodes.map(node => node.position) }], mountains: [], spawn: { ...buildings[0].door }, river: [], waterfall: { top: { x: 800, y: 60, z: 800 }, bottom: { x: 800, y: 0, z: 800 }, width: 10 } };
}
function create() { const sim = new Simulation(fixture()); assert.ok(sim.state.culture, 'normal constructor must install culture'); sim.state.player.money = 2000; ok(sim, { type: 'speed', value: 8 }); return sim; }
function site(sim: Simulation, kind: BuildingKind) { return sim.worldDefinition.buildings.find(building => building.kind === kind)!; }
function move(sim: Simulation, building: Building) { sim.setFocus({ ...building.door }, 'walk'); }
function ok(sim: Simulation, command: Command) { const result = sim.command(command); assert.equal(result.ok, true, `${command.type}: ${result.message}`); }
function reject(sim: Simulation, command: Command) { const before = sim.exportSave(), result = sim.command(command); assert.equal(result.ok, false, `${command.type}: ${result.message}`); assert.equal(sim.exportSave(), before, 'rejected cultural operations must be atomic'); }
function advance(sim: Simulation, minutes: number) { const at = sim.state.culture!.lastUpdate + minutes; for (let i = 0; i < 10000 && sim.state.culture!.lastUpdate < at - 1e-7; i++) sim.step(.25); assert.ok(sim.state.culture!.lastUpdate >= at - 1e-7); }
function restore(sim: Simulation) { const next = new Simulation(sim.worldDefinition), result = next.importSave(sim.exportSave()); assert.equal(result.ok, true, result.message); assert.deepEqual(next.state, sim.state); return next; }
function same(first: Simulation, second: Simulation) { assert.ok(first.exportSave() === second.exportSave(), 'both instances must serialize identically after the same commands and steps'); }
function completedWork(genre = 'literature') { const sim = create(); move(sim, site(sim, 'school')); ok(sim, { type: 'createWork', targetId: genre, title: '山城长卷', text: BODY }); advance(sim, genre === 'literature' ? 120 : 180); assert.equal(sim.state.culture!.project, null); const work = sim.state.culture!.works[0]; assert.ok(work); return { sim, work }; }
/** Real resident and facility are fixed in place only to isolate the attendance boundary. */
function pinReader(sim: Simulation, citizen: Citizen, building: Building) {
  citizen.education = 2; citizen.role = 'teacher'; citizen.workId = building.id;
  sim.onPhase('traffic', () => { citizen.position = { x: building.position.x, y: building.position.y + .6, z: building.position.z + 1.2 }; citizen.destinationId = building.id; citizen.route = []; citizen.routeIndex = 0; citizen.needs = { hunger: 100, fatigue: 100, social: 80, fun: 50 }; });
}

test('creation requires a real public studio, money and text; leaving pauses actual work and save/load resumes it', () => {
  const sim = create(); reject(sim, { type: 'createWork', targetId: 'literature', title: '山城', text: BODY });
  const school = site(sim, 'school'); move(sim, school);
  reject(sim, { type: 'createWork', targetId: 'literature', title: '山城', text: '少于二十字' });
  reject(sim, { type: 'createWork', targetId: 'absent', title: '山城', text: BODY });
  const money = sim.state.player.money, treasury = sim.state.treasury;
  ok(sim, { type: 'createWork', targetId: 'literature', title: '山城', text: BODY });
  assert.equal(sim.state.player.money, money - 60); assert.equal(sim.state.treasury, treasury + 60);
  reject(sim, { type: 'createWork', targetId: 'art', title: '另一件', text: BODY });
  advance(sim, 20); assert.equal(sim.state.culture!.project!.workedMinutes, 20);
  move(sim, site(sim, 'home')); advance(sim, 30); assert.equal(sim.state.culture!.project!.workedMinutes, 20);
  move(sim, school); const next = restore(sim);
  for (let i = 0; i < 50; i++) { sim.step(.25); next.step(.25); }
  same(sim, next); assert.equal(sim.state.culture!.project, null);
  const work = sim.state.culture!.works[0]; assert.equal(work.text, BODY); assert.equal(work.workedMinutes, 120); assert.equal(work.publishedAt, null); assert.deepEqual(work.readIds, []);
});

test('publication spends actual funds and only completed on-site reading improves residents and author relationships', () => {
  const { sim, work } = completedWork('art'), pavilion = site(sim, 'pavilion'), reader = sim.state.citizens[2];
  reject(sim, { type: 'publishWork', targetId: work.id });
  move(sim, pavilion); const money = sim.state.player.money, treasury = sim.state.treasury;
  ok(sim, { type: 'publishWork', targetId: work.id }); assert.equal(sim.state.player.money, money - 20); assert.equal(sim.state.treasury, treasury + 20);
  reject(sim, { type: 'publishWork', targetId: work.id });
  pinReader(sim, reader, pavilion);
  const skill = sim.state.extension!.actorProfiles[reader.id].skill, reputation = sim.state.player.reputation;
  advance(sim, 12); assert.equal(work.readIds.includes(reader.id), false, 'a glance is not a finished reading');
  advance(sim, 4); assert.ok(work.readIds.includes(reader.id)); assert.ok(sim.state.extension!.actorProfiles[reader.id].skill > skill); assert.ok(sim.state.player.reputation > reputation);
  const relationship = sim.state.relationships.find(item => item.npcId === reader.id)!; assert.ok(relationship.trust > 0); assert.ok(relationship.memories.some(memory => memory.text.includes(work.title)));
  const trust = relationship.trust; advance(sim, 10); assert.equal(relationship.trust, trust, 'rereading the same copy cannot farm trust indefinitely');
  restore(sim);
});

test('published works naturally get real readers in the generated schedules, with no reader teleport or supplied skill', () => {
  const { sim, work } = completedWork();
  move(sim, site(sim, 'hall')); ok(sim, { type: 'publishWork', targetId: work.id });
  advance(sim, 120);
  assert.ok(work.readIds.length > 0, 'real office occupants and public visitors must be able to read the publication');
  for (const id of work.readIds) { assert.ok(sim.state.citizens.some(citizen => citizen.id === id)); assert.ok(work.readingMinutes[id] >= 15); }
  const next = restore(sim); for (let i = 0; i < 24; i++) { sim.step(.25); next.step(.25); } same(sim, next);
});

test('public reports preserve observed evidence and spread through actual nearby residents; truthful verification gives no cash reward', () => {
  const sim = create(), pavilion = site(sim, 'pavilion'); move(sim, pavilion);
  const value = sim.state.extension!.environment.waterQuality;
  ok(sim, { type: 'publishReport', targetId: 'water', text: BODY });
  const report = sim.state.culture!.reports[0]; assert.equal(report.claim, value); assert.equal(report.evidence.observedValue, value); assert.equal(report.status, 'unchecked');
  pinReader(sim, sim.state.citizens[2], pavilion);
  const listener = sim.state.citizens[3], hall = site(sim, 'hall'); listener.workId = hall.id; listener.role = 'official';
  sim.onPhase('traffic', () => { listener.position = { x: pavilion.position.x + 12, y: pavilion.position.y + .6, z: pavilion.position.z + 1.2 }; listener.destinationId = hall.id; listener.route = []; listener.routeIndex = 0; listener.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; });
  advance(sim, 32);
  assert.ok(report.readIds.length > 0); assert.ok(report.reachedIds.length >= report.readIds.length);
  assert.ok(report.reachedIds.includes(listener.id)); assert.equal(report.readIds.includes(listener.id), false, 'a physically nearby listener hears the report without being marked a direct reader');
  move(sim, site(sim, 'school')); const money = sim.state.player.money, treasury = sim.state.treasury;
  sim.state.extension!.environment.waterQuality = 30; // Later world changes do not rewrite the archived source.
  ok(sim, { type: 'verifyReport', targetId: report.id });
  assert.equal(report.status, 'verified'); assert.equal(sim.state.player.money, money - 10); assert.equal(sim.state.treasury, treasury + 10);
  assert.equal(report.evidence.observedValue, value); reject(sim, { type: 'verifyReport', targetId: report.id });
  restore(sim);
});

test('a claim contradicting real evidence is publicly marked false and an actual correction restores only part of reader trust', () => {
  const sim = create(), pavilion = site(sim, 'pavilion'), reader = sim.state.citizens[2]; move(sim, pavilion);
  ok(sim, { type: 'publishReport', targetId: 'water', value: 0, text: BODY });
  const report = sim.state.culture!.reports[0]; pinReader(sim, reader, pavilion); advance(sim, 12);
  move(sim, site(sim, 'school')); const reputation = sim.state.player.reputation;
  ok(sim, { type: 'verifyReport', targetId: report.id }); assert.equal(report.status, 'false'); assert.equal(sim.state.player.reputation, reputation - 3);
  advance(sim, 2); const relationship = sim.state.relationships.find(item => item.npcId === reader.id)!;
  assert.ok(relationship.trust < 0); const trust = relationship.trust;
  move(sim, pavilion); const money = sim.state.player.money;
  ok(sim, { type: 'correctReport', targetId: report.id }); assert.equal(sim.state.player.money, money - 5); assert.equal(report.originalClaim, 0); assert.equal(report.claim, report.evidence.observedValue);
  advance(sim, 6); assert.ok(report.correctionReadIds.includes(reader.id)); assert.ok(relationship.trust > trust && relationship.trust < 0);
  assert.ok(relationship.memories.some(memory => memory.text.includes('旧误报'))); reject(sim, { type: 'correctReport', targetId: report.id });
  restore(sim);
});

test('ordinary public petitions collect real on-site signatures, wait a full monotonic day and receive saved public replies', () => {
  const sim = create(), hall = site(sim, 'hall');
  reject(sim, { type: 'filePetition', targetId: 'education', title: '开放学堂', text: BODY }); move(sim, hall);
  const money = sim.state.player.money, treasury = sim.state.treasury, taxRate = sim.state.taxRate, budget = sim.state.policeBudget;
  ok(sim, { type: 'filePetition', targetId: 'education', title: '开放学堂', text: BODY });
  assert.equal(sim.state.player.money, money - 10); assert.equal(sim.state.treasury, treasury + 10);
  const petition = sim.state.culture!.petitions[0]; assert.equal(petition.replyAt - petition.filedAt, 1440);
  reject(sim, { type: 'filePetition', targetId: 'education', title: '重复备案', text: BODY });
  pinReader(sim, sim.state.citizens[3], hall); advance(sim, 10); assert.ok(petition.signerIds.includes(sim.state.citizens[3].id));
  for (const value of [23, 0, 17, 8]) ok(sim, { type: 'setTime', value }); assert.equal(petition.status, 'open'); assert.equal(petition.reply, null);
  // A pending saved procedure near its genuine one-day deadline isolates the reply boundary.
  const delta = petition.replyAt - 2 - sim.state.extension!.lastUpdate;
  sim.state.extension!.lastUpdate += delta; sim.state.family!.lastUpdate += delta; sim.state.culture!.lastUpdate += delta;
  const next = restore(sim); sim.step(.25); next.step(.25);
  assert.equal(petition.status, 'answered'); assert.ok(petition.reply!.includes('公开答复')); assert.ok(petition.reply!.includes('政策与预算调整仍须'));
  assert.equal(sim.state.taxRate, taxRate); assert.equal(sim.state.policeBudget, budget); assert.equal(sim.state.player.role, 'traveler');
  // The live fixture has a positioning hook; compare saved result and continue with identical saved hooks omitted.
  const clean = restore(sim), cleanNext = restore(sim); for (let i = 0; i < 24; i++) { clean.step(.25); cleanNext.step(.25); } same(clean, cleanNext);
});

test('the actual civic core public floor admits ordinary petitions while protected floors reject even a mayor publication', () => {
  const sim = create(), civic = sim.worldDefinition.buildings.find(site => site.id === 'core-main')!;
  assert.equal(civicSite(civic), true); assert.equal(publicFloor(civic, 0), true); assert.equal(publicFloor(civic, 1), false);
  move(sim, civic); ok(sim, { type: 'filePetition', targetId: 'health', title: '医疗服务', text: BODY });
  sim.state.player.identities = ['traveler', 'mayor']; sim.state.player.role = 'mayor'; sim.state.player.position = { x: civic.position.x, y: 6.6, z: 0 };
  reject(sim, { type: 'publishReport', targetId: 'budget', text: BODY });
  reject(sim, { type: 'filePetition', targetId: 'transport', title: '私人密议', text: BODY });
  restore(sim);
});

test('corrupted source conclusions, reader identities, completed work time and petition deadlines reject atomically', () => {
  const { sim, work } = completedWork(); move(sim, site(sim, 'hall'));
  ok(sim, { type: 'publishWork', targetId: work.id }); ok(sim, { type: 'publishReport', targetId: 'water', value: 0, text: BODY });
  ok(sim, { type: 'verifyReport', targetId: sim.state.culture!.reports[0].id }); ok(sim, { type: 'filePetition', targetId: 'health', title: '服务公开', text: BODY });
  const mutations: ((data: any) => void)[] = [
    data => { data.state.culture.lastUpdate++; },
    data => { data.state.culture.works[0].workedMinutes = 1; },
    data => { data.state.culture.works[0].readIds = ['absent']; data.state.culture.works[0].readingMinutes.absent = 15; },
    data => { data.state.culture.reports[0].status = 'verified'; },
    data => { data.state.culture.reports[0].evidence.public = false; },
    data => { data.state.culture.reports[0].correctionReadIds = ['citizen-2']; },
    data => { data.state.culture.petitions[0].replyAt--; },
    data => { data.state.culture.petitions[0].signerIds = ['absent']; },
  ];
  for (const mutate of mutations) { const before = sim.exportSave(), data = JSON.parse(before); mutate(data); assert.equal(sim.importSave(JSON.stringify(data)).ok, false); assert.equal(sim.exportSave(), before); }
  restore(sim);
});
