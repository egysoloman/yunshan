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
function pinReader(sim: Simulation, citizen: Citizen, building: Building, activity: 'social' | 'work' = 'social') {
  citizen.education = 2; citizen.role = 'teacher'; citizen.workId = building.id;
  sim.onPhase('traffic', () => {
    citizen.position = { x: building.position.x, y: building.position.y + .6, z: building.position.z + 1.2 }; citizen.destinationId = building.id; citizen.route = []; citizen.routeIndex = 0; citizen.needs = { hunger: 100, fatigue: 100, social: 80, fun: 50 };
    // Isolate the actual activity being tested, without adding attendance or a wage claim.
    const runtime = Reflect.get(sim, 'runtime'); runtime.activities[citizen.id] = activity; runtime.decisionAt[citizen.id] = sim.state.day * 1440 + sim.state.hour * 60 + 10;
  });
}
function publicWorker(sim: Simulation) { const worker = sim.state.citizens.find(person => person.role !== '学生' && sim.state.extension!.actorProfiles[person.id].age >= 18 && !sim.state.shops.some(shop => shop.ownerId === person.id || shop.buildingId === person.workId)); assert.ok(worker, 'the service fixture requires an existing adult public worker, never a private shop owner'); return worker; }

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

/** The deadline is a valid saved boundary; all signatures are acquired in the people phase. */
function queuedService(topic: 'education' | 'health' | 'transport') {
  const sim = create(), hall = site(sim, 'hall');
  for (const citizen of sim.state.citizens) if (['官员', '财政官', 'official', '议员', 'council'].includes(citizen.role)) citizen.role = '档案员';
  move(sim, hall); ok(sim, { type: 'filePetition', targetId: topic, title: '具体公共服务', text: BODY });
  const petition = sim.state.culture!.petitions[0];
  for (const citizen of sim.state.citizens.slice(2, 5)) pinReader(sim, citizen, hall);
  advance(sim, 4); assert.ok(petition.signerIds.length >= 3);
  const delta = petition.replyAt - 2 - sim.state.culture!.lastUpdate;
  sim.state.extension!.lastUpdate += delta; sim.state.family!.lastUpdate += delta; sim.state.culture!.lastUpdate += delta;
  sim.step(.25);
  const order = sim.state.culture!.orders[0]; assert.ok(order); assert.equal(petition.executionId, order.id); assert.equal(order.state, 'awaitingReview');
  return { sim, petition, order };
}
function mayorApprove(sim: Simulation, petitionId: string) {
  const core = site(sim, 'core');
  reject(sim, { type: 'reviewPetition', targetId: petitionId });
  sim.state.player.role = 'mayor'; sim.state.player.identities = ['traveler', 'mayor'];
  move(sim, core); reject(sim, { type: 'reviewPetition', targetId: petitionId });
  sim.setFocus({ x: core.position.x, y: core.position.y + 6.6, z: core.position.z }, 'walk');
  ok(sim, { type: 'reviewPetition', targetId: petitionId });
}

test('an actual petition produces a distinct authorized service order and conserved finite procurement receipts', () => {
  const { sim, petition, order } = queuedService('education');
  const treasury = sim.state.treasury; assert.equal(order.spent, 0); assert.equal(order.receivedUnits, 0); assert.equal(order.servedIds.length, 0);
  mayorApprove(sim, petition.id); assert.equal(order.authorizedCap, 40); assert.deepEqual(order.approvedBy, ['player']);
  assert.equal(sim.state.treasury, treasury, 'authorization is an expense limit, never newly created cash');
  reject(sim, { type: 'reviewPetition', targetId: petition.id });
  advance(sim, 2); assert.equal(order.state, 'active'); assert.equal(order.spent, 24); assert.equal(order.receivedUnits, 6); assert.equal(order.consumedUnits, 0);
  assert.ok(order.receipts.length > 0); assert.equal(order.receipts.reduce((sum, receipt) => sum + receipt.paid, 0), order.spent);
  for (const receipt of order.receipts) {
    assert.equal(receipt.budgetId, order.id); assert.ok(receipt.lots.every(lot => sim.state.shops.some(shop => shop.id === lot.shopId)));
    assert.ok(Math.abs(receipt.paid - receipt.tax - receipt.lots.reduce((sum, lot) => sum + lot.net, 0)) < 1e-8);
    for (const lot of receipt.lots) assert.ok(Math.abs(lot.gross - lot.quantity * lot.unitPrice) < 1e-8);
  }
  assert.equal(order.servedIds.length, 0, 'a reply, authorization and purchase do not complete actual education');
  restore(sim);
});

test('public education needs staff, material and real attendance; leaving pauses and restored instances continue identically', () => {
  const { sim, petition, order } = queuedService('education'); mayorApprove(sim, petition.id); advance(sim, 2);
  const school = site(sim, 'school'), worker = publicWorker(sim);
  move(sim, school); sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  ok(sim, { type: 'attendService', targetId: order.id });
  const education = sim.state.player.education;
  for (const citizen of sim.state.citizens) if (citizen.workId === school.id) citizen.role = '档案员';
  advance(sim, 20); assert.equal(order.serviceMinutes.player ?? 0, 0); assert.equal(order.consumedUnits, 0);
  pinReader(sim, worker, school, 'work'); worker.role = '老师';
  advance(sim, 20); assert.equal(order.serviceMinutes.player, 20); assert.equal(sim.state.player.education, education);
  move(sim, site(sim, 'home')); advance(sim, 10); assert.equal(order.serviceMinutes.player, 20);
  move(sim, school);
  const clean = restore(sim), next = restore(sim);
  // Saved state resumes naturally; identical real staff positioning hooks isolate this boundary.
  for (const instance of [clean, next]) { const person = instance.state.citizens.find(citizen => citizen.id === worker.id)!; pinReader(instance, person, school, 'work'); person.role = '老师'; }
  for (let index = 0; index < 20; index++) { clean.step(.25); next.step(.25); }
  same(clean, next);
  const completed = clean.state.culture!.orders.find(item => item.id === order.id)!;
  assert.ok(completed.servedIds.includes('player')); assert.equal(completed.serviceMinutes.player, 60); assert.equal(clean.state.player.education, education + 1); assert.ok(completed.consumedUnits >= 1);
  reject(clean, { type: 'attendService', targetId: order.id }); restore(clean);
});

test('actual public clinical treatment consumes a funded unit after doctor attendance and twenty minutes', () => {
  const { sim, petition, order } = queuedService('health'); mayorApprove(sim, petition.id); advance(sim, 2);
  const clinic = site(sim, 'clinic'), doctor = publicWorker(sim);
  pinReader(sim, doctor, clinic, 'work'); doctor.role = '医生';
  move(sim, clinic); sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100; sim.state.extension!.actorProfiles.player.health = 50;
  ok(sim, { type: 'attendService', targetId: order.id });
  advance(sim, 18); assert.equal(order.servedIds.includes('player'), false); assert.equal(order.consumedUnits, 0);
  const health = sim.state.extension!.actorProfiles.player.health; advance(sim, 2);
  assert.ok(order.servedIds.includes('player')); assert.equal(order.serviceMinutes.player, 20); assert.ok(sim.state.extension!.actorProfiles.player.health > health + 24.8, 'the same twenty-minute material-backed clinical protocol applies to public and paid patients');
  assert.equal(order.consumedUnits, order.servedIds.length); assert.ok(order.spent >= order.consumedUnits * 4);
  restore(sim);
});

test('zero discretionary cash or supplier stock waits without free service and retries after a genuine donor payment', () => {
  const { sim, petition, order } = queuedService('health'); mayorApprove(sim, petition.id);
  sim.state.treasury = 0; advance(sim, 2); assert.equal(order.receivedUnits, 0); assert.equal(order.spent, 0); assert.equal(order.state, 'awaitingBudget');
  const clean = restore(sim), next = restore(sim); for (let index = 0; index < 20; index++) { clean.step(.25); next.step(.25); } same(clean, next);
  // A real existing citizen funds the public account; the next automatic purchase still uses the same authorization.
  const donor = sim.state.citizens[8], contribution = Math.min(donor.money, 100); donor.money -= contribution; sim.state.treasury += contribution;
  for (const shop of sim.state.shops) shop.inventory = 0;
  sim.state.trade!.ownedLots = {};
  advance(sim, 62); assert.equal(order.receivedUnits, 0); assert.equal(order.consumedUnits, 0); assert.equal(order.servedIds.length, 0);
  restore(sim);
});

test('dynamic supply quotes buy only actual material within the approved cap and preserve an unfinished partial service', () => {
  const { sim, petition, order } = queuedService('health'); mayorApprove(sim, petition.id);
  const producer = sim.state.shops.find(shop => site(sim, 'workshop').id === shop.buildingId)!;
  // An expensive historical production window is a quote fixture; it cannot pay for procurement.
  sim.state.trade!.activity[producer.id] = [{ at: Math.floor(sim.state.culture!.lastUpdate / 10) * 10, sold: 0, supplied: 0, labor: 60, produced: 4, shortages: 0, earnedLaborCost: 40, actualUtilities: 0 }];
  advance(sim, 2); assert.equal(order.spent, 40); assert.ok(order.receivedUnits > 3 && order.receivedUnits < 4); assert.equal(order.targetUnits, 6); assert.equal(order.consumedUnits, 0);
  const receipt = order.receipts[0]; assert.ok(receipt.lots[0].unitPrice > 10); assert.equal(receipt.reason, 'budget'); assert.ok(Math.abs(receipt.quantity * receipt.lots[0].unitPrice - receipt.paid) < 1e-7);
  reject(sim, { type: 'reviewPetition', targetId: petition.id, value: 80 }); assert.equal(order.authorizedCap, 40, 'the family/culture layer cannot increase a previously approved public cap');
  const clinic = site(sim, 'clinic'), doctor = publicWorker(sim); pinReader(sim, doctor, clinic, 'work'); doctor.role = '医生';
  for (const patient of sim.state.citizens.slice(12, 14)) { pinReader(sim, patient, clinic); sim.state.extension!.actorProfiles[patient.id].health = 50; }
  move(sim, clinic); sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100; sim.state.extension!.actorProfiles.player.health = 50; ok(sim, { type: 'attendService', targetId: order.id });
  advance(sim, 62); assert.equal(order.consumedUnits, 3); assert.equal(order.servedIds.length, 3); assert.ok(order.servedIds.includes('player')); assert.equal(order.state, 'awaitingBudget'); assert.equal(order.completedAt, null); assert.match(order.lastReason, /授权额度已经耗尽/);
  assert.equal(order.spent, 40); assert.ok(order.receivedUnits < order.targetUnits); const clean = restore(sim), next = restore(sim);
  for (let index = 0; index < 24; index++) { clean.step(.25); next.step(.25); } same(clean, next);
});

test('station upkeep consumes actual parts and attended work before any future dispatch maintenance exists', () => {
  const { sim, petition, order } = queuedService('transport'); mayorApprove(sim, petition.id); advance(sim, 2);
  const station = site(sim, 'station'), driver = publicWorker(sim); pinReader(sim, driver, station, 'work'); driver.role = '驾驶员';
  for (let attempt = 0; attempt < 5 && !sim.isOnDuty(driver.id, station.id); attempt++) advance(sim, 2);
  assert.equal(sim.isOnDuty(driver.id, station.id), true, 'the newly assigned worker must actually begin duty before the sixty-minute maintenance window');
  const startedMinutes = order.serviceMinutes[driver.id] ?? 0;
  advance(sim, 58 - startedMinutes); assert.equal(order.serviceMinutes[driver.id], 58); assert.equal(sim.state.culture!.transportMaintenance[station.id], undefined); assert.equal(order.consumedUnits, 0);
  advance(sim, 2); assert.equal(order.state, 'fulfilled', JSON.stringify({ minutes: order.serviceMinutes, staff: order.staffIds, driverId: driver.id, driverState: driver.state, duty: sim.isOnDuty(driver.id, station.id), reason: order.lastReason })); assert.equal(order.consumedUnits, 4); assert.equal(order.spent, 16);
  const record = sim.state.culture!.transportMaintenance[station.id]; assert.equal(record.orderId, order.id); assert.equal(record.maintainedUntil, order.completedAt! + 7 * 1440); assert.ok(order.staffIds.includes(driver.id));
  const clean = restore(sim), next = restore(sim); for (let i = 0; i < 24; i++) { clean.step(.25); next.step(.25); } same(clean, next);
});

test('forged service receipts, materials, authorizations, actor references and completed timings reject atomically', () => {
  const { sim, petition, order } = queuedService('education'); mayorApprove(sim, petition.id); advance(sim, 2);
  const mutate: ((save: any) => void)[] = [
    save => { save.state.culture.orders[0].spent++; },
    save => { save.state.culture.orders[0].receivedUnits++; },
    save => { save.state.culture.orders[0].approvedBy = ['absent']; },
    save => { save.state.culture.orders[0].receipts[0].lots[0].shopId = 'absent'; },
    save => { save.state.culture.orders[0].receipts[0].lots[0].unitPrice++; },
    save => { save.state.culture.orders[0].serviceMinutes.player = 60; save.state.culture.orders[0].servedIds = ['player']; save.state.culture.orders[0].consumedUnits = 1; },
    save => { save.state.culture.petitions[0].executionId = 'service-999'; },
    save => { save.state.culture.transportMaintenance[order.siteId] = { orderId: order.id, maintainedUntil: sim.state.culture!.lastUpdate + 7 * 1440, units: 4 }; },
  ];
  for (const change of mutate) { const before = sim.exportSave(), save = JSON.parse(before); change(save); assert.equal(sim.importSave(JSON.stringify(save)).ok, false); assert.equal(sim.exportSave(), before); }
  restore(sim);
});
