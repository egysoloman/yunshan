import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { FAMILY_RESERVE, GAME_DAY, GAME_YEAR, GESTATION_MINUTES, SCHOOL_MINUTES_PER_LEVEL, validateFamilyState } from '../src/simulation/family.ts';
import type { BuildingKind, Citizen, Command, WorldDefinition } from '../src/types.ts';

function fixture(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'school', 'market', 'workshop', 'clinic', 'bank', 'pavilion', 'hall', 'station'];
  const district = { id: 'family-district', name: '家庭测试街坊', kind: 'residential', center: { x: 0, y: 0, z: 0 }, radius: 600, color: '#8abba4', population: 384 };
  const buildings = kinds.map((kind, index) => ({ id: `family-${kind}`, kind, districtId: district.id, name: `家庭${kind}`, position: { x: index * 30, y: 0, z: 0 }, door: { x: index * 30, y: 0, z: 6 }, width: 12, depth: 12, height: 12, floors: 2, rotation: 0, capacity: 128, seed: index }));
  const nodes = [0, 1].map(index => ({ id: `family-node-${index}`, name: `家庭驿站${index}`, districtId: district.id, position: { x: index * 240, y: 0, z: 20 }, station: true }));
  return { seed: 711, voxelSize: .2, size: 2000, districts: [district], buildings, nodes, edges: [{ id: 'family-road', from: nodes[0].id, to: nodes[1].id, mode: 'road', length: 240, capacity: 30, points: nodes.map(node => node.position) }], mountains: [], spawn: { ...buildings[0].door }, river: [], waterfall: { top: { x: 600, y: 60, z: 600 }, bottom: { x: 600, y: 0, z: 600 }, width: 20 } };
}
function create() {
  const sim = new Simulation(fixture());
  assert.ok(sim.state.family, 'normal constructor must install the real family extension');
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  return sim;
}
function ok(sim: Simulation, command: Command) { const result = sim.command(command); assert.equal(result.ok, true, result.message); }
function reject(sim: Simulation, command: Command) { const before = sim.exportSave(), result = sim.command(command); assert.equal(result.ok, false, result.message); assert.equal(sim.exportSave(), before, 'rejection must leave all wallets, genealogy and timers unchanged'); }
function restoredFrom(sim: Simulation) { const restored = new Simulation(sim.worldDefinition), result = restored.importSave(sim.exportSave()); assert.equal(result.ok, true, result.message); assert.deepEqual(restored.state, sim.state); return restored; }
function sameSave(first: Simulation, second: Simulation) {
  const left = first.exportSave(), right = second.exportSave();
  if (left === right) return;
  const find = (a: any, b: any, path: string): string | null => {
    if (Object.is(a, b)) return null;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const diff = find(a[key], b[key], `${path}.${key}`); if (diff) return diff; }
    return null;
  };
  assert.fail(find(JSON.parse(left), JSON.parse(right), 'save') ?? 'serialization order differs');
}
function cashAssets(sim: Simulation) { return sim.state.player.money + sim.state.citizens.reduce((sum, person) => sum + person.money, 0) + sim.state.treasury + sim.state.extension!.companies.reduce((sum, company) => sum + company.capital, 0) + sim.state.family!.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0); }
/** A stable pre-existing marriage is a fixture; commands still enforce real conditions. */
function married() {
  const sim = create(), spouse = sim.state.citizens.find(person => person.id === 'citizen-2')!, home = sim.worldDefinition.buildings[0];
  sim.state.player.homeId = home.id; sim.state.player.partnerId = spouse.id; sim.state.player.position = { ...home.door };
  spouse.homeId = home.id; spouse.position = { ...home.door }; spouse.partnerId = 'player';
  sim.state.player.money = 1000; spouse.money = 1000;
  sim.state.player.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  spouse.needs = { ...sim.state.player.needs };
  for (const id of ['player', spouse.id]) Object.assign(sim.state.extension!.actorProfiles[id], { age: 28, health: 100, mood: 80, stress: 10 });
  sim.state.relationships.push({ npcId: spouse.id, affection: 90, trust: 90, type: 'spouse', encounters: 20, memories: [], tags: ['共同生活'], romanceStage: 'family', romanceSince: 0, hostilityStage: 'none', consent: true });
  sim.state.extension!.lastUpdate = sim.state.family!.lastUpdate = 8 * GAME_DAY;
  sim.state.culture!.lastUpdate = sim.state.extension!.lastUpdate;
  return { sim, spouse, home };
}
/** Move a valid saved pregnancy close to its real deadline to test delivery boundaries. */
function birthFixture() {
  const { sim, spouse, home } = married();
  ok(sim, { type: 'planFamily', targetId: spouse.id });
  const pregnancy = sim.state.family!.pregnancies[0];
  assert.equal(pregnancy.dueAt - pregnancy.startedAt, GESTATION_MINUTES);
  sim.state.extension!.lastUpdate = sim.state.family!.lastUpdate = pregnancy.dueAt - 2;
  sim.state.culture!.lastUpdate = sim.state.extension!.lastUpdate;
  sim.step(.25);
  const child = sim.state.citizens.find(person => person.id === 'resident-1')!;
  assert.ok(child, 'birth must add an actual citizen, rather than a relationship tag');
  return { sim, spouse, home, child };
}
/** A saved age boundary, with birth/parent ages advanced by the same elapsed years. */
function ageFixture(sim: Simulation, child: Citizen, age: number) {
  const life = sim.state.extension!.actorProfiles[child.id], years = age - life.age;
  sim.state.extension!.lastUpdate += years * GAME_YEAR; sim.state.family!.lastUpdate = sim.state.extension!.lastUpdate;
  sim.state.culture!.lastUpdate = sim.state.extension!.lastUpdate;
  for (const person of Object.values(sim.state.extension!.actorProfiles)) if (person.alive) person.age += years;
  life.age = age;
}

test('family installation adds real student guardians without minting money or moving homes and jobs', () => {
  const sim = create(), f = sim.state.family!;
  const students = sim.state.citizens.filter(person => person.role === '学生');
  assert.equal(Object.keys(f.studentGuardians).length, students.length);
  for (const student of students) {
    const guardians = f.studentGuardians[student.id];
    assert.ok(guardians.length > 0);
    for (const id of guardians) {
      assert.ok(sim.state.citizens.some(person => person.id === id && person.role !== '学生'));
      assert.ok(sim.state.extension!.actorProfiles[id].family.includes(student.id));
      assert.ok(sim.state.extension!.actorProfiles[student.id].family.includes(id));
    }
  }
  assert.equal(sim.state.extension!.publicLedger.filter(row => row.purpose.includes('扶养')).length, 0, 'registering a family must not emit an income payment');
  restoredFrom(sim);
});

test('family planning requires marriage time, bilateral willingness, real shared space and two funded adults', () => {
  const { sim, spouse } = married(), relationship = sim.state.relationships.find(item => item.npcId === spouse.id)!;
  relationship.consent = false; reject(sim, { type: 'planFamily', targetId: spouse.id }); relationship.consent = true;
  relationship.romanceSince = sim.state.family!.lastUpdate; reject(sim, { type: 'planFamily', targetId: spouse.id }); relationship.romanceSince = 0;
  sim.state.extension!.actorProfiles[spouse.id].mood = 10; reject(sim, { type: 'planFamily', targetId: spouse.id }); sim.state.extension!.actorProfiles[spouse.id].mood = 80;
  spouse.position.x += 100; reject(sim, { type: 'planFamily', targetId: spouse.id }); spouse.position.x -= 100;
  spouse.money = 199; reject(sim, { type: 'planFamily', targetId: spouse.id }); spouse.money = 1000;
  const assets = cashAssets(sim), ownCash = sim.state.player.money, spouseCash = spouse.money;
  ok(sim, { type: 'planFamily', targetId: spouse.id });
  assert.equal(sim.state.player.money, ownCash - FAMILY_RESERVE); assert.equal(spouse.money, spouseCash - FAMILY_RESERVE);
  assert.equal(sim.state.family!.pregnancies[0].escrow, 200); assert.equal(cashAssets(sim), assets, 'escrow is funded from the two actual wallets');
  reject(sim, { type: 'planFamily', targetId: spouse.id });
  const restored = restoredFrom(sim);
  for (let index = 0; index < 20; index++) { sim.step(.25); restored.step(.25); }
  sameSave(restored, sim);
  assert.equal(sim.state.family!.pregnancies.length, 1); assert.equal(Object.keys(sim.state.family!.children).length, 0);
});

test('time-of-day controls cannot skip gestation, and delivery persists a zero-age citizen and conserves escrow', () => {
  const { sim, spouse } = married(); ok(sim, { type: 'planFamily', targetId: spouse.id });
  const deadline = sim.state.family!.pregnancies[0].dueAt, clock = sim.state.family!.lastUpdate;
  for (const value of [23, 0, 18, 8]) ok(sim, { type: 'setTime', value });
  assert.equal(sim.state.family!.lastUpdate, clock); assert.equal(sim.state.family!.pregnancies[0].dueAt, deadline);
  sim.state.extension!.lastUpdate = sim.state.family!.lastUpdate = deadline - 2;
  sim.state.culture!.lastUpdate = sim.state.extension!.lastUpdate;
  const restored = restoredFrom(sim), before = cashAssets(sim), population = sim.state.citizens.length;
  let afterPeopleAssets = 0; sim.onPhase('people', () => { afterPeopleAssets = cashAssets(sim); });
  sim.step(.25); restored.step(.25);
  assert.equal(sim.state.citizens.length, population + 1); assert.ok(sim.state.family!.pregnancies.every(pregnancy => !pregnancy.parentIds.includes('player')));
  const child = sim.state.citizens.find(person => person.id === 'resident-1')!;
  assert.equal(child.money, 100); assert.equal(child.role, '幼儿'); assert.equal(child.workId, child.homeId);
  assert.equal(sim.state.extension!.actorProfiles[child.id].age, 0);
  assert.deepEqual(sim.state.family!.children[child.id].parentIds, ['player', spouse.id]);
  assert.equal(afterPeopleAssets, before, 'delivery moves escrow into child cash and the real public medical account');
  for (let index = 0; index < 16; index++) { sim.step(.25); restored.step(.25); }
  sameSave(restored, sim);
  assert.deepEqual(child.route, []); assert.equal(child.destinationId, null); assert.equal(child.position.x, sim.worldDefinition.buildings[0].door.x);
  assert.ok(sim.state.extension!.actorProfiles[child.id].age > 0 && sim.state.extension!.actorProfiles[child.id].age < .001);
  restoredFrom(sim);
});

test('student support debits a real guardian, keeps reserves and cannot be repeated within its saved daily interval', () => {
  const sim = create(), student = sim.state.citizens.find(person => person.role === '学生')!, guardianId = sim.state.family!.studentGuardians[student.id][0], guardian = sim.state.citizens.find(person => person.id === guardianId)!;
  student.money = 0; guardian.money = 160;
  // Make every other dependent solvent so the same actual guardian has a single charge.
  for (const person of sim.state.citizens) if (person.id !== student.id) person.money = person.id === guardian.id ? 160 : 1000;
  sim.state.family!.nextSupportAt[student.id] = sim.state.family!.lastUpdate;
  student.needs.hunger = guardian.needs.hunger = 100; student.needs.fatigue = guardian.needs.fatigue = 100;
  sim.step(.25);
  assert.equal(student.money, 60); assert.equal(guardian.money, 100);
  const payments = sim.state.extension!.publicLedger.filter(row => row.purpose === '家庭日常扶养转账');
  assert.equal(payments.filter(row => row.actorId === guardian.id).reduce((sum, row) => sum + row.amount, 0), -60);
  assert.equal(payments.filter(row => row.actorId === student.id).reduce((sum, row) => sum + row.amount, 0), 60);
  assert.equal(payments.reduce((sum, row) => sum + row.amount, 0), 0);
  const restored = restoredFrom(sim);
  for (let index = 0; index < 20; index++) { sim.step(.25); restored.step(.25); }
  sameSave(restored, sim);
  assert.equal(sim.state.extension!.publicLedger.filter(row => row.purpose === '家庭日常扶养转账').length, payments.length);
});

test('infants consume transferred real food and personal child support never creates cash', () => {
  const { sim, spouse, home, child } = birthFixture();
  sim.state.player.inventory.food = 1; (spouse as Citizen & { food: number }).food = 0;
  spouse.position.x += 100; child.needs.hunger = 40; sim.state.player.position = { ...home.door };
  sim.step(.25);
  assert.equal(sim.state.player.inventory.food, 0); assert.equal((child as Citizen & { food: number }).food, 1);
  let consumed = false;
  for (let index = 0; index < 20; index++) { sim.step(.25); if ((child as Citizen & { food: number }).food === 0 && child.needs.hunger > 80) consumed = true; }
  assert.ok(consumed, 'the core must consume the transferred portion, rather than grant free infant nutrition');
  const own = sim.state.player.money, childCash = child.money;
  ok(sim, { type: 'supportFamily', targetId: child.id, value: 20 });
  assert.equal(sim.state.player.money, own - 20); assert.equal(child.money, childCash + 20);
  reject(sim, { type: 'supportFamily', targetId: child.id, value: -1 });
  reject(sim, { type: 'supportFamily', targetId: sim.state.citizens[3].id, value: 20 });
  restoredFrom(sim);
});

test('enrollment needs a real child at the school; only healthy attended lessons accumulate education and adulthood enables work', () => {
  const { sim, spouse, child } = birthFixture(), school = sim.worldDefinition.buildings.find(site => site.kind === 'school')!, data = sim.state.family!.children[child.id];
  reject(sim, { type: 'enrollChild', targetId: child.id });
  ageFixture(sim, child, 6); spouse.money = 100; // Child at the age boundary; no NPC fee available.
  sim.state.player.position.x -= 100;
  reject(sim, { type: 'enrollChild', targetId: child.id });
  sim.state.player.position = { ...school.door }; child.position = { ...school.door };
  const cash = sim.state.player.money, treasury = sim.state.treasury;
  ok(sim, { type: 'enrollChild', targetId: child.id });
  assert.equal(sim.state.player.money, cash - 40); assert.equal(sim.state.treasury, treasury + 40);
  assert.equal(child.workId, school.id); assert.equal(child.education, 0);
  reject(sim, { type: 'enrollChild', targetId: child.id });
  // Actual arrival and attendance are exercised through the existing people phase.
  ok(sim, { type: 'setTime', value: 8 });
  sim.onPhase('traffic', () => { child.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; });
  for (let index = 0; index < 130; index++) sim.step(.25);
  assert.ok(data.attendanceMinutes > 0); assert.ok(data.attendanceMinutes <= 240, 'one day cannot manufacture unlimited completed lessons');
  assert.equal(child.education, 0); assert.equal(child.role, '学生', 'children must never become autonomous adult researchers');
  const attendance = data.attendanceMinutes;
  sim.onPhase('traffic', () => { child.position.x = school.door.x + 100; child.needs.hunger = 0; });
  for (let index = 0; index < 8; index++) sim.step(.25);
  assert.equal(data.attendanceMinutes, attendance, 'remote or starving children cannot receive education');
  data.attendanceMinutes = 3 * SCHOOL_MINUTES_PER_LEVEL; child.education = 3;
  ageFixture(sim, child, 18);
  sim.step(.25);
  assert.equal(child.role, '工人'); assert.equal(sim.worldDefinition.buildings.find(site => site.id === child.workId)!.kind, 'workshop');
  assert.ok(data.graduatedAt !== null); restoredFrom(sim);
});

test('death transfers exact cash and integer shares to the living spouse and child, then remains deterministic after reload', () => {
  const { sim, spouse, child } = birthFixture();
  sim.state.player.identities = ['traveler', 'merchant']; sim.state.player.role = 'merchant';
  const site = sim.worldDefinition.buildings.find(site => site.kind === 'market')!; sim.state.player.position = { ...site.door };
  ok(sim, { type: 'foundCompany', targetId: site.id, value: 500 });
  const company = sim.state.extension!.companies[0];
  assert.ok(company); company.shareholders = { [spouse.id]: 999, player: 1 }; company.shares = 1000; company.ownerId = spouse.id;
  spouse.money = 301; const own = sim.state.player.money, childCash = child.money;
  sim.state.extension!.actorProfiles[spouse.id].health = 0;
  let assetsAfterPeople = 0; sim.onPhase('people', () => { assetsAfterPeople = sim.state.player.money + child.money + spouse.money; });
  sim.step(.25);
  const estate = sim.state.family!.estates[spouse.id];
  assert.ok(estate); assert.deepEqual(estate.heirIds, ['player', child.id].sort()); assert.equal(estate.cash, 301);
  assert.equal(assetsAfterPeople, own + childCash + 301);
  assert.equal(spouse.money, 0); assert.equal(sim.state.player.partnerId, null); assert.equal(spouse.partnerId, null);
  assert.equal(company.shareholders[spouse.id], 0); assert.equal(Object.values(company.shareholders).reduce((sum, value) => sum + value, 0), 1000);
  assert.equal(company.shareholders.player, 501); assert.equal(company.shareholders[child.id], 499);
  assert.ok(sim.state.extension!.actorProfiles[child.id].historyTags.includes('悼念亲人'));
  const restored = restoredFrom(sim), cash = estate.cash;
  for (let index = 0; index < 20; index++) { sim.step(.25); restored.step(.25); }
  sameSave(restored, sim); assert.equal(estate.cash, cash, 'the estate principal cannot be distributed twice');
});

test('six actual school days complete lessons without commands or fabricated education increments', () => {
  const { sim, spouse, child } = birthFixture(), school = sim.worldDefinition.buildings.find(site => site.kind === 'school')!;
  ageFixture(sim, child, 6); spouse.money = 100;
  sim.state.player.position = { ...school.door }; child.position = { ...school.door };
  ok(sim, { type: 'enrollChild', targetId: child.id }); ok(sim, { type: 'speed', value: 16 });
  sim.onPhase('traffic', () => { child.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; });
  const start = sim.state.family!.lastUpdate;
  for (let index = 0; index < 6 * GAME_DAY / 4; index++) sim.step(.25);
  assert.ok(sim.state.family!.lastUpdate - start >= 6 * GAME_DAY);
  const schooling = sim.state.family!.children[child.id];
  assert.ok(schooling.attendanceMinutes >= 3 * SCHOOL_MINUTES_PER_LEVEL, `${schooling.attendanceMinutes} minutes of actual attended lessons`);
  assert.ok((child.education ?? 0) >= 3); assert.equal(child.role, '学生'); assert.equal(schooling.graduatedAt, null);
  assert.ok(sim.state.extension!.actorProfiles[child.id].age < 7, 'attending six days must not jump the child to adulthood');
  restoredFrom(sim);
});

test('an adult without enrolled schooling can seek a real unskilled job without a fabricated graduation', () => {
  const { sim, child } = birthFixture(); ageFixture(sim, child, 18);
  sim.step(.25);
  assert.ok(['工人', '农民'].includes(child.role)); assert.notEqual(child.workId, child.homeId);
  assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].graduatedAt, null);
  restoredFrom(sim);
});

test('invalid population, ancestry, timer, escrow and deceased-estate references reject atomically', () => {
  const { sim, child } = birthFixture();
  const mutations: ((data: any) => void)[] = [
    data => { delete data.state.family.children[child.id]; },
    data => { data.state.family.nextResidentId = 1; },
    data => { data.state.family.children[child.id].parentIds[0] = child.id; },
    data => { data.state.family.children[child.id].parentIds[0] = 'absent'; },
    data => { data.state.family.children[child.id].schoolId = 'family-market'; },
    data => { data.state.extension.actorProfiles[child.id].age = 18; },
    data => { data.state.family.lastUpdate += 1; },
    data => { data.state.family.estates[child.id] = { settledAt: data.state.family.lastUpdate, heirIds: ['player'], cash: 0, shares: {} }; },
  ];
  for (const mutate of mutations) { const data = JSON.parse(sim.exportSave()), before = sim.exportSave(); mutate(data); const result = sim.importSave(JSON.stringify(data)); assert.equal(result.ok, false, result.message); assert.equal(sim.exportSave(), before); }
  const pending = married(); ok(pending.sim, { type: 'planFamily', targetId: pending.spouse.id });
  for (const mutate of [
    (data: any) => { data.state.family.pregnancies[0].dueAt--; },
    (data: any) => { data.state.family.pregnancies[0].escrow = 1; },
  ]) { const data = JSON.parse(pending.sim.exportSave()), before = pending.sim.exportSave(); mutate(data); assert.equal(pending.sim.importSave(JSON.stringify(data)).ok, false); assert.equal(pending.sim.exportSave(), before); }
  validateFamilyState(sim.state, sim.worldDefinition);
});

test('a carrier death refunds real pregnancy escrow before inheritance and never produces a phantom child', () => {
  const { sim, spouse } = married(); ok(sim, { type: 'planFamily', targetId: spouse.id });
  sim.state.extension!.actorProfiles[spouse.id].health = 0;
  const own = sim.state.player.money;
  sim.step(.25);
  assert.equal(sim.state.family!.pregnancies.length, 0); assert.equal(Object.keys(sim.state.family!.children).length, 0);
  assert.equal(sim.state.family!.estates[spouse.id].cash, 1000, 'refund restores the carrier’s pre-escrow wealth before the one legal heir inherits');
  assert.ok(sim.state.player.money >= own + 1100, 'the living parent receives their own escrow refund and the spouse’s actual estate');
  restoredFrom(sim);
});
