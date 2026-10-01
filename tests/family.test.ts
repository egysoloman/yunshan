import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { FAMILY_RESERVE, GAME_DAY, GAME_YEAR, GESTATION_MINUTES, SCHOOL_MINUTES_PER_LEVEL, isCloseKin, validateFamilyState } from '../src/simulation/family.ts';
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
function wholeCash(sim: Simulation) { return cashAssets(sim) + sim.state.shops.reduce((sum, shop) => sum + (shop.cash ?? 0), 0) + (sim.state.banking?.cash ?? 0) + (sim.state.banking?.legacyInvestmentCash ?? 0) + sim.state.family!.households.reduce((sum, account) => sum + account.balance, 0) + Reflect.get(sim, 'runtime').taxes; }
/** A stable pre-existing marriage is a fixture; commands still enforce real conditions. */
function married(sim = create()) {
  const spouse = sim.state.citizens.find(person => person.id === 'citizen-2')!, home = sim.worldDefinition.buildings[0];
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
function birthFixture(sim = create()) {
  const { spouse, home } = married(sim);
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

test('legacy family saves migrate existing guardians without new money and reject hidden version-two executor data atomically', () => {
  const sim = create(), saved = JSON.parse(sim.exportSave()), guardians = structuredClone(sim.state.family!.studentGuardians), money = wholeCash(sim);
  const fields = ['bonds', 'movePlans', 'households', 'ceremonies', 'careGuardians', 'estateSales', 'nextHouseholdId', 'nextCeremonyId', 'nextBondAt', 'nextEstateSaleId'];
  saved.state.family.version = 1; for (const field of fields) delete saved.state.family[field];
  const restored = new Simulation(sim.worldDefinition), imported = restored.importSave(JSON.stringify(saved)); assert.equal(imported.ok, true, imported.message); assert.equal(restored.state.family!.version, 2); assert.deepEqual(restored.state.family!.studentGuardians, guardians); assert.equal(wholeCash(restored), money); assert.deepEqual(restored.state.family!.estateSales, []);
  const before = restored.exportSave(); saved.state.family.estateSales = [{ id: 'unvalidated-old-executor' }]; assert.equal(restored.importSave(JSON.stringify(saved)).ok, false); assert.equal(restored.exportSave(), before);
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
  assert.equal(child.role, '工人'); assert.equal(child.workId, 'family-market', 'adult job search uses the feasible home commute, independent of the last school position');
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

test('new adult job searches use the actual home commute rather than proximity to a distant market', () => {
  const world = fixture(); world.edges[0].length = 5000;
  for (const site of world.buildings.filter(site => ['market', 'workshop'].includes(site.kind))) { site.position.x = site.kind === 'market' ? 160 : 180; site.door.x = site.position.x; }
  const farm = { ...world.buildings[3], id: 'family-reachable-farm', kind: 'farm' as const, position: { x: 50, y: 0, z: 0 }, door: { x: 50, y: 0, z: 6 } }; world.buildings.push(farm);
  const started = new Simulation(world); ok(started, { type: 'speed', value: 8 });
  const { sim, child } = birthFixture(started); ageFixture(sim, child, 18);
  const market = world.buildings.find(site => site.kind === 'market')!; child.position = { ...market.door };
  assert.ok(sim.buildingTravelDistance(child.homeId, market.id) > 5000); assert.ok(sim.buildingTravelDistance(child.homeId, farm.id) <= 500);
  sim.step(.25); assert.equal(child.workId, farm.id); assert.equal(child.role, '农民'); assert.equal(sim.state.family!.children[child.id].graduatedAt, null); restoredFrom(sim);
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

test('pregnancy refunds retain the real escrow at the wallet ceiling until actual bank repayment creates room', () => {
  const { sim, spouse } = married(); ok(sim, { type: 'planFamily', targetId: spouse.id });
  // Historical wealth at the supported ceiling is an explicit boundary fixture.
  sim.state.player.money = 1e9; spouse.money = 1e9 - 200;
  const bankSite = sim.worldDefinition.buildings.find(site => site.kind === 'bank')!; sim.state.player.position = { ...bankSite.door }; ok(sim, { type: 'deposit', value: 200 });
  const bank = sim.state.banking!, before = bank.cash; bank.cash -= 200; spouse.money += 200; bank.stats.loaned += 200; bank.nextInterestAt = sim.state.family!.lastUpdate + 60;
  bank.accounts[spouse.id] = { deposits: 0, loanPrincipal: 200, loanInterest: 0, interestDue: 0, closed: false };
  bank.receipts.push({ id: `bank-${bank.nextReceiptId++}`, tick: sim.state.tick, at: sim.state.family!.lastUpdate, actorId: spouse.id, kind: 'loan', amount: 200, cashBefore: before, cashAfter: bank.cash, principal: 200, interest: 0 });
  sim.state.extension!.actorProfiles[spouse.id].health = 0; const cash = wholeCash(sim); sim.step(.25);
  assert.equal(sim.state.family!.pregnancies.length, 1); assert.equal(sim.state.family!.pregnancies[0].escrow, 200); assert.equal(bank.accounts[spouse.id].loanPrincipal, 0); assert.equal(spouse.money, 1e9 - 200); assert.ok(Math.abs(wholeCash(sim) - cash) < 1e-6); restoredFrom(sim);
  sim.step(.25); assert.equal(sim.state.family!.pregnancies.length, 0); assert.equal(spouse.money, 1e9 - 100); assert.equal(sim.state.player.money, 1e9 - 100); assert.equal(sim.state.citizens.some(person => person.id === 'resident-1'), false); assert.ok(Math.abs(wholeCash(sim) - cash) < 1e-6); restoredFrom(sim);
});

test('biological kinship blocks courting and family planning while seeded foster support is a distinct relationship', () => {
  const { sim, child, spouse } = birthFixture();
  assert.equal(isCloseKin(sim.state, 'player', child.id), true); assert.equal(isCloseKin(sim.state, spouse.id, child.id), true); assert.equal(isCloseKin(sim.state, 'player', spouse.id), false);
  reject(sim, { type: 'court', targetId: child.id }); reject(sim, { type: 'propose', targetId: child.id });
  const initial = Object.entries(sim.state.family!.studentGuardians)[0]; assert.equal(isCloseKin(sim.state, initial[0], initial[1][0]), false, 'an actual foster support link must not fabricate a biological ancestor');
  restoredFrom(sim);
});

test('shared housing checks both adults, capacity and real commute, preserves position and jobs, and funds a conserved joint account', () => {
  const { sim, spouse, home } = married(), relation = sim.state.relationships.find(item => item.npcId === spouse.id)!;
  reject(sim, { type: 'moveHousehold', targetId: home.id }); // Existing fixture is deliberately overcrowded.
  home.capacity = 512; relation.consent = false; reject(sim, { type: 'moveHousehold', targetId: home.id }); relation.consent = true;
  spouse.position.x += 100; reject(sim, { type: 'moveHousehold', targetId: home.id }); spouse.position.x -= 100;
  const workId = spouse.workId, position = { ...spouse.position }, before = wholeCash(sim);
  ok(sim, { type: 'moveHousehold', targetId: home.id }); assert.equal(spouse.workId, workId); assert.deepEqual(spouse.position, position); assert.equal(wholeCash(sim), before);
  const account = sim.state.family!.households[0]; assert.ok(account); assert.equal(account.balance, 0); assert.equal(sim.state.player.money, 980); assert.equal(spouse.money, 980);
  reject(sim, { type: 'moveHousehold', targetId: home.id });
  const cash = sim.state.player.money; ok(sim, { type: 'fundHousehold', targetId: account.id, value: 100 }); assert.equal(sim.state.player.money, cash - 100); assert.equal(account.balance, 100); assert.equal(wholeCash(sim), before);
  reject(sim, { type: 'fundHousehold', targetId: account.id, value: -1 }); restoredFrom(sim);
});

test('a real bilateral household move keeps the ongoing gestation and registers delivery at the new shared home', () => {
  const world = fixture(), newHome = { ...world.buildings[0], id: 'family-new-home', position: { x: 24, y: 0, z: 40 }, door: { x: 24, y: 0, z: 46 }, capacity: 512 }; world.buildings.push(newHome);
  const sim = new Simulation(world); ok(sim, { type: 'speed', value: 8 }); const { spouse } = married(sim); ok(sim, { type: 'planFamily', targetId: spouse.id });
  const pregnancy = sim.state.family!.pregnancies[0], dueAt = pregnancy.dueAt, escrow = pregnancy.escrow;
  sim.state.player.position = { ...newHome.door }; spouse.position = { ...newHome.door }; const before = wholeCash(sim);
  ok(sim, { type: 'moveHousehold', targetId: newHome.id }); assert.equal(pregnancy.homeId, newHome.id); assert.equal(pregnancy.dueAt, dueAt); assert.equal(pregnancy.escrow, escrow); assert.ok(Math.abs(wholeCash(sim) - before) < 1e-7);
  const restored = restoredFrom(sim);
  for (const instance of [sim, restored]) { instance.state.extension!.lastUpdate = instance.state.family!.lastUpdate = instance.state.culture!.lastUpdate = dueAt - 2; instance.step(.25); }
  const child = sim.state.citizens.find(person => person.id === 'resident-1')!; assert.equal(child.homeId, newHome.id); assert.equal(sim.state.family!.children[child.id].homeId, newHome.id); assert.deepEqual(child.position, newHome.door); sameSave(sim, restored);
});

test('joint family food purchases pay an actual finite shop and divorce refunds the remaining joint property once', () => {
  const { sim, child, spouse, home } = birthFixture(); home.capacity = 512;
  ok(sim, { type: 'moveHousehold', targetId: home.id }); const account = sim.state.family!.households[0]; ok(sim, { type: 'fundHousehold', targetId: account.id, value: 100 });
  const market = sim.worldDefinition.buildings.find(site => site.kind === 'market')!, shop = sim.state.shops.find(shop => shop.buildingId === market.id)!;
  shop.open = true; shop.inventory = 10; sim.state.trade!.ownedLots![shop.id] = [{ quantity: 10, unitPrice: 4, createdAt: sim.state.family!.lastUpdate }]; sim.state.player.position = { ...market.door }; child.position = { ...market.door };
  const all = wholeCash(sim), inventory = shop.inventory, food = child.food ?? 0, balance = account.balance, gross = shop.price;
  ok(sim, { type: 'householdMeal', targetId: child.id }); assert.equal(shop.inventory, inventory - 1); assert.equal(child.food, food + 1); assert.equal(account.balance, balance - gross); assert.equal(account.spent, gross); assert.ok(Math.abs(wholeCash(sim) - all) < 1e-7);
  spouse.position = { ...market.door }; const own = sim.state.player.money, other = spouse.money, remaining = account.balance;
  ok(sim, { type: 'divorce', targetId: spouse.id }); assert.equal(account.closedAt, null, 'divorce registration is settled in the next authoritative people phase');
  let refunds = 0; sim.onPhase('people', () => { refunds = sim.state.player.money - own + spouse.money - other; }); sim.step(.25);
  assert.ok(account.closedAt !== null); assert.equal(account.balance, 0); assert.equal(account.returned, remaining); assert.ok(Math.abs(refunds - remaining) < 1e-7);
  const closed = account.returned; for (let i = 0; i < 4; i++) sim.step(.25); assert.equal(account.returned, closed); restoredFrom(sim);
});

test('weddings and funerals consume real supplies and public venue fees, then require thirty actual on-site minutes', () => {
  const { sim, spouse } = married(), pavilion = sim.worldDefinition.buildings.find(site => site.kind === 'pavilion')!;
  sim.state.player.inventory.food = 2; reject(sim, { type: 'holdCeremony', targetId: 'wedding' });
  sim.state.player.position = { ...pavilion.door }; spouse.position = { ...pavilion.door };
  const money = sim.state.player.money, treasury = sim.state.treasury; ok(sim, { type: 'holdCeremony', targetId: 'wedding' });
  assert.equal(sim.state.player.money, money - 30); assert.equal(sim.state.treasury, treasury + 30); assert.equal(sim.state.player.inventory.food, 0); reject(sim, { type: 'holdCeremony', targetId: 'wedding' });
  const wedding = sim.state.family!.ceremonies[0]; for (let i = 0; i < 5; i++) sim.step(.25); assert.equal(wedding.workedMinutes, 10);
  sim.state.player.position.x -= 100; for (let i = 0; i < 5; i++) sim.step(.25); assert.equal(wedding.workedMinutes, 10);
  sim.state.player.position = { ...pavilion.door }; for (let i = 0; i < 10; i++) sim.step(.25);
  assert.equal(wedding.workedMinutes, 30); assert.ok(wedding.completedAt !== null); assert.ok(wedding.guestIds.includes('player')); assert.ok(sim.state.extension!.actorProfiles.player.historyTags.includes('家庭婚礼实际到场'));
  sim.state.extension!.actorProfiles[spouse.id].health = 0; sim.step(.25);
  const blocks = sim.state.player.inventory.block; ok(sim, { type: 'holdCeremony', targetId: spouse.id }); assert.equal(sim.state.player.inventory.block, blocks - 2);
  for (let i = 0; i < 15; i++) sim.step(.25); const funeral = sim.state.family!.ceremonies[1]; assert.equal(funeral.workedMinutes, 30); assert.ok(funeral.completedAt !== null); assert.ok(sim.state.extension!.actorProfiles.player.historyTags.includes('亲人葬礼实际到场')); restoredFrom(sim);
});

test('NPC relationships arise from real proximity and bilateral willingness, with complete stage deadlines before marriage', () => {
  const sim = create(), first = sim.state.citizens[8], second = sim.state.citizens[9];
  for (const person of sim.state.citizens) if ([first.id, second.id].includes(person.partnerId ?? '')) person.partnerId = null;
  first.partnerId = second.partnerId = null;
  for (const person of [first, second]) { person.money = 500; Object.assign(sim.state.extension!.actorProfiles[person.id], { age: 28, mood: 80, stress: 10 }); }
  const home = sim.worldDefinition.buildings[0]; sim.state.family!.nextBondAt = sim.state.family!.lastUpdate;
  sim.onPhase('traffic', () => { for (const person of [first, second]) { person.position = { ...home.door }; person.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; } });
  // Prevent other singles in the dense fixture from forming an unrelated bond with the two subjects.
  for (const person of sim.state.citizens) if (![first.id, second.id].includes(person.id)) sim.state.extension!.actorProfiles[person.id].age = 60;
  sim.step(.25); const bond = sim.state.family!.bonds.find(item => item.actorIds.includes(first.id))!; assert.ok(bond); assert.equal(bond.stage, 'courtship');
  for (let i = 0; i < 30; i++) sim.step(.25); assert.ok(bond.sharedMinutes >= 60); assert.equal(bond.stage, 'courtship', 'sixty minutes cannot bypass seven real days');
  const advanceClock = (minutes: number) => { sim.state.extension!.lastUpdate += minutes; sim.state.family!.lastUpdate += minutes; sim.state.culture!.lastUpdate += minutes; };
  advanceClock(7 * GAME_DAY); sim.step(.25); assert.equal(bond.stage, 'dating');
  advanceClock(14 * GAME_DAY); for (let i = 0; i < 400; i++) sim.step(.25); assert.equal(bond.stage, 'engaged');
  advanceClock(7 * GAME_DAY); sim.step(.25); assert.equal(bond.stage, 'married'); assert.equal(first.partnerId, second.id); assert.equal(second.partnerId, first.id);
  assert.ok(bond.consent.every(Boolean)); assert.ok(bond.sharedMinutes >= 480); restoredFrom(sim);
});

test('shared accounts, autonomous relationship clocks, ceremonies and care references reject corrupted saves atomically', () => {
  const { sim, spouse, home } = married(); home.capacity = 512; ok(sim, { type: 'moveHousehold', targetId: home.id }); const account = sim.state.family!.households[0]; ok(sim, { type: 'fundHousehold', targetId: account.id, value: 50 });
  const mutations: ((save: any) => void)[] = [
    save => { save.state.family.households[0].balance++; },
    save => { save.state.family.households[0].actorIds[1] = 'absent'; },
    save => { save.state.family.households[0].closedAt = save.state.family.lastUpdate; },
    save => { save.state.family.careGuardians[spouse.id] = ['player']; },
    save => { save.state.family.bonds = [{ actorIds: [sim.state.citizens[7].id, sim.state.citizens[8].id], stage: 'married', startedAt: save.state.family.lastUpdate, since: save.state.family.lastUpdate, sharedMinutes: 0, affection: [100, 100], trust: [100, 100], consent: [true, true] }]; },
  ];
  for (const change of mutations) { const before = sim.exportSave(), save = JSON.parse(before); change(save); assert.equal(sim.importSave(JSON.stringify(save)).ok, false); assert.equal(sim.exportSave(), before); }
  restoredFrom(sim);
});

test('a nearby proposed home with a five-kilometre real detour is rejected without moving jobs or minting money', () => {
  const world = fixture(), original = world.buildings[0]; original.capacity = 512;
  const other = { ...original, id: 'family-detour-home', position: { x: 230, y: 0, z: 0 }, door: { x: 230, y: 0, z: 6 }, capacity: 8 }; world.buildings.push(other); world.edges[0].length = 5000;
  const { sim, spouse } = married(new Simulation(world)); spouse.role = '老师'; spouse.workId = 'family-school';
  sim.state.player.position = { ...other.door }; spouse.position = { ...other.door };
  assert.ok(Math.abs(other.door.x - world.buildings.find(site => site.id === spouse.workId)!.door.x) < 500); assert.ok(sim.buildingTravelDistance(other.id, spouse.workId) > 5000);
  const homeId = spouse.homeId, workId = spouse.workId; reject(sim, { type: 'moveHousehold', targetId: other.id }); assert.equal(spouse.homeId, homeId); assert.equal(spouse.workId, workId);
});

test('a willing established NPC couple reaches a feasible shared home on real routes before funding an autonomous pregnancy', () => {
  const world = fixture(), home = world.buildings[0]; home.capacity = 512;
  const otherHome = { ...home, id: 'family-second-home', position: { x: 160, y: 0, z: 0 }, door: { x: 160, y: 0, z: 6 } }; world.buildings.push(otherHome);
  const sim = new Simulation(world), first = sim.state.citizens[8], second = sim.state.citizens[9]; ok(sim, { type: 'speed', value: 8 }); ok(sim, { type: 'setTime', value: 18 });
  for (const person of sim.state.citizens) if ([first.id, second.id].includes(person.partnerId ?? '')) person.partnerId = null;
  first.partnerId = second.id; second.partnerId = first.id; first.homeId = home.id; second.homeId = otherHome.id;
  first.position = { ...home.door }; second.position = { ...otherHome.door };
  for (const person of [first, second]) { person.role = '老师'; person.workId = 'family-school'; person.money = 500; Object.assign(sim.state.extension!.actorProfiles[person.id], { age: 28, mood: 80, stress: 10 }); sim.state.family!.nextPlanAt[person.id] = 0; }
  sim.onPhase('traffic', () => { for (const person of [first, second]) person.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; });
  sim.step(.25); assert.notEqual(first.homeId, second.homeId); assert.equal(sim.state.family!.pregnancies.some(pregnancy => pregnancy.parentIds.includes(first.id)), false);
  const plan = sim.state.family!.movePlans.find(plan => plan.actorIds.includes(first.id))!; assert.ok(plan); const before = { ...second.position };
  for (let index = 0; index < 150 && plan.state === 'pending'; index++) sim.step(.25);
  assert.equal(plan.state, 'agreed'); assert.equal(first.homeId, second.homeId); assert.equal(first.workId, 'family-school'); assert.equal(second.workId, 'family-school'); assert.notDeepEqual(second.position, before);
  for (let index = 0; index < 20 && !sim.state.family!.pregnancies.some(pregnancy => pregnancy.parentIds.includes(first.id)); index++) sim.step(.25);
  const pregnancy = sim.state.family!.pregnancies.find(pregnancy => pregnancy.parentIds.includes(first.id))!; assert.ok(pregnancy); assert.equal(pregnancy.escrow, 200); assert.equal(pregnancy.dueAt - pregnancy.startedAt, GESTATION_MINUTES);
  restoredFrom(sim);
});

test('orphan care transfers real food from an actual present adult while retaining the deceased biological parents', () => {
  const { sim, child, spouse, home } = birthFixture(), guardian = sim.state.citizens[7];
  guardian.homeId = home.id; guardian.position = { ...home.door }; guardian.money = 500; guardian.food = 1; guardian.needs.hunger = 100;
  Object.assign(sim.state.extension!.actorProfiles[guardian.id], { age: 32, mood: 80, health: 100 });
  for (const person of sim.state.citizens) if (![guardian.id, spouse.id, child.id].includes(person.id)) person.position.x += 1000;
  sim.state.extension!.actorProfiles.player.health = 0; sim.state.extension!.actorProfiles[spouse.id].health = 0; child.needs.hunger = 40;
  sim.step(.25); assert.deepEqual(sim.state.family!.careGuardians[child.id], [guardian.id]); assert.deepEqual(sim.state.family!.children[child.id].parentIds, ['player', spouse.id]); assert.equal(guardian.food, 0); assert.equal(child.food, 1);
  assert.ok(sim.state.extension!.actorProfiles[guardian.id].family.includes(child.id)); assert.equal(isCloseKin(sim.state, guardian.id, child.id), false); restoredFrom(sim);
});

test('family customers settle actual consigned producers once and use the same retail cost as ordinary buyers', () => {
  const world = fixture(), workshop = world.buildings.find(site => site.kind === 'workshop')!;
  // This food purchase requires an actual farm; industrial parts cannot become a meal.
  world.buildings.push({ ...workshop, id: 'family-food-farm', name: '家庭食物农场', kind: 'farm', position: { x: 270, y: 0, z: 0 }, door: { x: 270, y: 0, z: 6 }, seed: 90 });
  const prepared = new Simulation(world); ok(prepared, { type: 'speed', value: 8 });
  const { sim, child, home } = birthFixture(prepared); home.capacity = 512; ok(sim, { type: 'moveHousehold', targetId: home.id });
  const account = sim.state.family!.households[0]; ok(sim, { type: 'fundHousehold', targetId: account.id, value: 100 });
  const market = sim.worldDefinition.buildings.find(site => site.kind === 'market')!, shop = sim.state.shops.find(shop => shop.buildingId === market.id)!;
  shop.open = true; shop.inventory = 0; delete sim.state.trade!.ownedLots![shop.id]; const supplied = sim.supplyConsignment(shop.id, 2); assert.equal(supplied, 2);
  const supplierId = sim.state.trade!.lots[shop.id][0].supplierId, supplier = sim.state.shops.find(shop => shop.id === supplierId)!;
  sim.state.player.position = { ...market.door }; child.position = { ...market.door };
  const producerCash = sim.shopFunds(supplier), retailCash = sim.shopFunds(shop), profit = shop.profit, all = wholeCash(sim), gross = shop.price;
  ok(sim, { type: 'householdMeal', targetId: child.id });
  assert.ok(Math.abs(sim.shopFunds(supplier) - producerCash - 4 * (1 - sim.state.taxRate)) < 1e-7);
  assert.ok(Math.abs(sim.shopFunds(shop) - retailCash - (gross * (1 - sim.state.taxRate) - 4)) < 1e-7);
  assert.ok(Math.abs(shop.profit - profit - (gross * (1 - sim.state.taxRate) - 4)) < 1e-7, 'supplier settlement must not deduct cost a second time');
  assert.ok(Math.abs(wholeCash(sim) - all) < 1e-6); assert.equal(sim.state.trade!.stats.settledUnits, 1); restoredFrom(sim);
});

test('family food uses the saved immutable FIFO purchase costs without paying the supplier a second time', () => {
  const { sim, child, home } = birthFixture(); home.capacity = 512; ok(sim, { type: 'moveHousehold', targetId: home.id });
  const account = sim.state.family!.households[0]; ok(sim, { type: 'fundHousehold', targetId: account.id, value: 100 });
  const market = sim.worldDefinition.buildings.find(site => site.kind === 'market')!, shop = sim.state.shops.find(shop => shop.buildingId === market.id)!;
  // Two historical paid purchases are an explicit stock/cost fixture, rather than a new cash payment.
  shop.open = true; shop.inventory = 2; sim.state.trade!.ownedLots![shop.id] = [{ quantity: 1, unitPrice: 8, createdAt: sim.state.family!.lastUpdate }, { quantity: 1, unitPrice: 10, createdAt: sim.state.family!.lastUpdate }];
  sim.state.player.position = { ...market.door }; child.position = { ...market.door };
  const all = wholeCash(sim), profit = shop.profit, cash = sim.shopFunds(shop), net = shop.price * (1 - sim.state.taxRate);
  ok(sim, { type: 'householdMeal', targetId: child.id }); assert.ok(Math.abs(shop.profit - profit - (net - 8)) < 1e-7); assert.equal(sim.state.trade!.ownedLots![shop.id][0].unitPrice, 10);
  ok(sim, { type: 'householdMeal', targetId: child.id }); assert.ok(Math.abs(shop.profit - profit - (2 * net - 18)) < 1e-7); assert.equal(shop.inventory, 0); assert.equal(sim.state.trade!.ownedLots![shop.id], undefined);
  assert.ok(Math.abs(sim.shopFunds(shop) - cash - 2 * net) < 1e-7); assert.ok(Math.abs(wholeCash(sim) - all) < 1e-6); restoredFrom(sim);
});

/** A financed, historically valid NPC loan is a fixture; its cash came from a real deposit. */
function indebtedEstate() {
  const { sim, spouse } = married();
  for (const citizen of sim.state.citizens) citizen.role = '档案员';
  const workplace = sim.worldDefinition.buildings.find(site => site.kind === 'workshop')!;
  sim.state.player.role = 'merchant'; sim.state.player.identities = ['traveler', 'merchant']; sim.state.player.position = { ...workplace.door };
  ok(sim, { type: 'foundCompany', targetId: workplace.id, value: 500 });
  const company = sim.state.extension!.companies[0]; company.shareholders = { [spouse.id]: 1000 }; company.ownerId = spouse.id;
  const bankSite = sim.worldDefinition.buildings.find(site => site.kind === 'bank')!; sim.state.player.position = { ...bankSite.door }; ok(sim, { type: 'deposit', value: 200 });
  const bank = sim.state.banking!, before = bank.cash; bank.cash -= 100; spouse.money += 100; bank.stats.loaned += 100; bank.nextInterestAt = sim.state.family!.lastUpdate + 60;
  bank.accounts[spouse.id] = { deposits: 0, loanPrincipal: 100, loanInterest: 0, interestDue: 0, closed: false };
  bank.receipts.push({ id: `bank-${bank.nextReceiptId++}`, tick: sim.state.tick, at: sim.state.family!.lastUpdate, actorId: spouse.id, kind: 'loan', amount: 100, cashBefore: before, cashAfter: bank.cash, principal: 100, interest: 0 });
  // The decedent spent all liquid cash with a real counterparty, retaining the company asset and debt.
  sim.state.player.money += spouse.money; spouse.money = 0; sim.state.extension!.actorProfiles[spouse.id].health = 0;
  sim.state.player.position = { ...sim.worldDefinition.buildings[0].door }; sim.step(.25);
  return { sim, spouse, company, bankSite };
}

test('a valuable but illiquid estate keeps its debt and assets until an actual on-site buyer pays, then clears debt before inheritance', () => {
  const { sim, spouse, company, bankSite } = indebtedEstate(), estate = sim.state.family!.estates[spouse.id], bank = sim.state.banking!;
  assert.equal(estate.status, 'awaitingExecutor'); assert.equal(estate.bankSettlement!.closed, false); assert.ok(bank.accounts[spouse.id].loanPrincipal > 99 && bank.accounts[spouse.id].loanPrincipal <= 100); assert.equal(bank.stats.losses, 0); assert.equal(company.shareholders[spouse.id], 1000);
  const sale = sim.state.family!.estateSales.find(sale => sale.deceasedId === spouse.id && sale.kind === 'shares')!; assert.ok(sale); assert.equal(sale.proceeds, 0);
  reject(sim, { type: 'buyEstateAsset', targetId: sale.id, value: 1 });
  const clean = restoredFrom(sim), next = restoredFrom(sim); for (let index = 0; index < 4; index++) { clean.step(.25); next.step(.25); } sameSave(clean, next);
  sim.state.player.position = { ...bankSite.door }; const total = wholeCash(sim), buyerCash = sim.state.player.money, bankCash = bank.cash, remaining = bank.accounts[spouse.id].loanPrincipal + bank.accounts[spouse.id].loanInterest, quantity = Math.ceil(remaining / sale.unitPrice), paid = quantity * sale.unitPrice;
  ok(sim, { type: 'buyEstateAsset', targetId: sale.id, value: quantity }); assert.equal(sim.state.player.money, buyerCash - paid); assert.equal(spouse.money, paid); assert.equal(company.shareholders.player, quantity); assert.equal(sale.proceeds, paid); assert.ok(Math.abs(wholeCash(sim) - total) < 1e-7);
  reject(sim, { type: 'buyEstateAsset', targetId: sale.id, value: 1 });
  sim.step(.25); assert.equal(estate.status, 'settled'); assert.ok(Math.abs(estate.bankSettlement!.debtPaid - 100) < 1e-7); assert.equal(bank.accounts[spouse.id].loanPrincipal, 0); assert.equal(bank.accounts[spouse.id].closed, true); assert.ok(Math.abs(bank.cash - bankCash - remaining) < 1e-7);
  assert.equal(company.shareholders[spouse.id], 0); assert.equal(company.shareholders.player, 1000); assert.equal(sale.state, 'withdrawn'); assert.equal(bank.stats.losses, 0); restoredFrom(sim);
});

test('noncorporate inheritance transfers actual ownership while operating cash, goods and consignment claims stay in the business', () => {
  const { sim, spouse } = married(), shop = sim.state.shops[0]; assert.equal(sim.transferBusinessOwnership(shop.id, spouse.id), true);
  const cash = sim.shopFunds(shop), inventory = shop.inventory; sim.state.extension!.actorProfiles[spouse.id].health = 0; sim.step(.25);
  const estate = sim.state.family!.estates[spouse.id]; assert.equal(shop.ownerId, 'player'); assert.equal(estate.businesses![shop.id], 'player'); assert.ok(sim.shopFunds(shop) >= cash, 'actual receipts can enter the business, but inheritance cannot extract its principal');
  assert.ok(shop.inventory <= inventory); assert.ok(Reflect.get(sim, 'runtime').playerBusinesses.includes(shop.id)); restoredFrom(sim);
});

test('forged executor receipts, nonexistent buyers and nonexistent business ownership reject without changing a pending estate', () => {
  const { sim } = indebtedEstate();
  const changes: ((save: any) => void)[] = [
    save => { save.state.family.estateSales[0].proceeds = 100; },
    save => { save.state.family.estateSales[0].receipts = [{ buyerId: 'absent', quantity: 1, paid: 1, at: save.state.family.lastUpdate }]; },
    save => { save.state.family.estateSales[0].assetId = 'absent'; },
    save => { save.state.family.estateSales[0].soldQuantity++; },
    save => { save.state.family.estateSales[0].state = 'sold'; },
  ];
  for (const change of changes) { const before = sim.exportSave(), data = JSON.parse(before); change(data); assert.equal(sim.importSave(JSON.stringify(data)).ok, false); assert.equal(sim.exportSave(), before); }
  restoredFrom(sim);
});
