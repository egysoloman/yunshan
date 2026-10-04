import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation.ts';
import { applyFamilyEducationCredential } from '../src/simulation/education.ts';
import { cancelFamilyCourse, enrollFamilyCourse, familyEducationCourses, familyEducationOpportunities, resumeFamilyCourse, type FamilyEducationCourse } from '../src/simulation/family-education.ts';
import { publicEducation, begin, fundedMaterial } from './education-fixture.ts';
import { advance, ageBoundary, at, attachControls, attachOrdinaryShifts, close, earnTravelerShift, familyFeeCash, familyFeeFixture, fixture, partitionContinue24, pin, runtime, setup, station } from './family-fee-education-fixture.ts';

// These are contract regressions with controlled physical positions, needs and
// explicit saved age boundaries. All successful payments, original jobs,
// current teacher wage windows and textbook purchases run through the original
// simulator. No cash, material, attendance or qualification is added to pass.
type Context = ReturnType<typeof familyFeeFixture>;
const output = 'output/family-fee-education';
mkdirSync(output, { recursive: true });
function lesson(sim: Simulation, id?: string): FamilyEducationCourse {
  const current = id ? familyEducationCourses(sim.state).find(course => course.id === id) : sim.state.familyEducation?.active[0];
  assert.ok(current, `family course ${id ?? '(active)'} has an actual contract`); return current;
}
function admit(context: Context, payerId = 'player'): FamilyEducationCourse {
  const { sim, controls, site, child } = context;
  if (sim.state.hour < 8 || sim.state.hour >= 17) advance(sim, (24 - sim.state.hour + 8) * 60);
  pin(sim, controls, child.id, site, station(site)); sim.setFocus(station(site), 'walk');
  const payer = payerId === 'player' ? sim.state.player : sim.state.citizens.find(person => person.id === payerId)!;
  if (payerId !== 'player') pin(sim, controls, payerId, site, station(site));
  const money = payer.money, result = payerId === 'player'
    ? sim.command({ type: 'enrollFamilyCourse', targetId: child.id }) : enrollFamilyCourse(sim, child.id, payerId);
  assert.equal(result.ok, true, result.message); assert.equal(payer.money, money - 40);
  const current = lesson(sim); assert.equal(current.actorId, child.id); assert.equal(current.payerId, payerId);
  assert.equal(current.funded, 40); assert.equal(current.escrow, 40); assert.equal(current.workedMinutes, 0);
  return current;
}
function material(context: Context, current: FamilyEducationCourse): void {
  for (let tick = 0; current.reservedUnits < 1 && tick < 16; tick++) context.sim.step(.25);
  assert.equal(current.reservedUnits, 1, current.reason); assert.ok(current.receipt || current.reusedUnits === 1);
}
function courseLedger(current: FamilyEducationCourse): void {
  close(current.funded, current.escrow + current.purchasePaid + current.serviceFees + current.refunded, 'real tuition cash equation');
  close(current.serviceFees, (40 - current.purchasePaid) * current.workedMinutes / 60, 'only actual teaching earns its service fraction');
  close(Object.values(current.staffMinutes).reduce((sum, minutes) => sum + minutes, 0), current.workedMinutes, 'named teacher minutes equal earned learner minutes');
  if (current.receipt) { assert.equal(current.receipt.quantity, 1); close(current.receipt.gross, current.receipt.net + current.receipt.tax); close(current.purchasePaid, current.receipt.gross); }
}
function finish(context: Context, current: FamilyEducationCourse): void {
  const { sim, teacher } = context, deadline = at(sim) + 30 * 60;
  let ticks = 0;
  while (current.status !== 'completed' && at(sim) < deadline - 1e-7 && ticks++ < 10000) {
    if (current.resumeRequired && sim.state.hour >= 8 && sim.state.hour < 17) {
      // The native child's overnight routine can really leave the room. The
      // original payer personally returns to the original public station and
      // explicitly restores the same contract; no lost night is backfilled.
      sim.setFocus(station(context.site), 'walk');
      if (current.payerId !== 'player') pin(sim, context.controls, current.payerId, context.site, station(context.site));
      const result = resumeFamilyCourse(sim, current.id, current.payerId);
      if (result.ok) assert.equal(current.resumeRequired, false);
    }
    sim.step(.25);
  }
  if (current.status !== 'completed') console.log(JSON.stringify({ evidence: 'bounded-family-course', course: current, day: sim.state.day, hour: sim.state.hour, teacher, teacherAge: sim.state.extension!.actorProfiles[teacher.id].age, teacherAttendance: runtime(sim).attendance[teacher.id], publicBudget: sim.publicBudgetSnapshot(), publicLabor: runtime(sim).publicLabor, suppliers: sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials') }));
  assert.equal(current.status, 'completed', current.reason); assert.equal(current.workedMinutes, 60);
  assert.equal(current.consumedUnits, 1); assert.equal(current.reservedUnits, 0); assert.equal(current.escrow, 0);
  assert.ok(current.completedAt! >= current.startedAt + 60 - 1e-7); assert.ok(current.staffMinutes[teacher.id] > 0);
  assert.ok(current.receipt && current.receivedUnits === 1 || current.reusedUnits === 1);
  courseLedger(current);
}
function syncBirthAges(context: Context): void {
  for (const [id, record] of Object.entries(context.sim.state.family!.children)) if (context.sim.state.extension!.actorProfiles[id].alive)
    context.sim.state.extension!.actorProfiles[id].age = (at(context.sim) - record.bornAt) / 525600;
}

test('course-free pre-module save preserves exact legacy bytes and twenty-four actual 1x continuation ticks', () => {
  const { sim, controls } = setup(), original = readFileSync(new URL('./fixtures/family-fee/before.save.json', import.meta.url), 'utf8');
  assert.equal(sim.exportSave(), original, 'fresh old-course-free fixture exactly matches captured original source');
  assert.equal(sim.state.familyEducation, undefined); assert.equal(runtime(sim).familyEducationVersion, undefined);
  const loaded = new Simulation(fixture()), result = loaded.importSave(original); assert.equal(result.ok, true, result.message);
  assert.equal(loaded.exportSave(), original); attachControls(loaded, controls);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); loaded.step(.25); assert.equal(loaded.exportSave(), sim.exportSave()); }
  assert.equal(sim.exportSave(), readFileSync(new URL('./fixtures/family-fee/after24.save.json', import.meta.url), 'utf8'));
});

test('lawful parent admission places its own forty cash in custody without giving formal credit or issuing another contract', () => {
  const context = familyFeeFixture(), { sim, child } = context, before = familyFeeCash(sim), current = admit(context);
  assert.equal(runtime(sim).familyEducationVersion, 1); assert.equal(current.guardianKind, 'parent');
  assert.deepEqual(current.guardianIds, sim.state.family!.children[child.id].parentIds);
  assert.equal(current.receivedUnits, 0); assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0);
  close(familyFeeCash(sim), before, 'admission moves existing wallet cash into course custody');
  const saved = sim.exportSave(), duplicate = enrollFamilyCourse(sim, child.id); assert.equal(duplicate.ok, false); assert.equal(sim.exportSave(), saved);
  courseLedger(current);
});

test('a native legal NPC parent pays from its own wallet and the child never becomes the adult contracting actor', () => {
  const context = familyFeeFixture(), { sim, child, spouse } = context, playerCash = sim.state.player.money;
  const current = admit(context, spouse.id); assert.equal(current.payerId, spouse.id); assert.equal(sim.state.player.money, playerCash);
  const saved = sim.exportSave(); assert.equal(enrollFamilyCourse(sim, child.id, child.id).ok, false); assert.equal(sim.exportSave(), saved);
  assert.equal(cancelFamilyCourse(sim, current.id, 'player').ok, false, 'the other parent cannot take the original payer refund');
  assert.equal(sim.exportSave(), saved);
});

for (const [name, setupGuard] of [
  ['unrelated same-home adult with family/social profile links', (context: Context) => { const outsider = context.sim.state.citizens.find(person => !context.sim.state.family!.children[context.child.id].parentIds.includes(person.id))!; outsider.homeId = context.child.homeId; outsider.position = { ...station(context.site) }; context.sim.state.extension!.actorProfiles[outsider.id].family.push(context.child.id); return outsider.id; }],
  ['recorded parent who is currently a minor', (context: Context) => { context.sim.state.extension!.actorProfiles.player.age = 17; return 'player'; }],
  ['recorded parent who is deceased', (context: Context) => { Object.assign(context.sim.state.extension!.actorProfiles.player, { alive: false, health: 0 }); return 'player'; }],
  ['child attempting to sign its own adult contract', (context: Context) => context.child.id],
] as const) test(`admission rejects ${name} without creating a module or debiting cash`, () => {
  const context = familyFeeFixture(), { sim, child } = context, payerId = setupGuard(context), before = sim.exportSave();
  assert.equal(enrollFamilyCourse(sim, child.id, payerId).ok, false); assert.equal(sim.exportSave(), before);
  assert.equal(sim.state.familyEducation, undefined); assert.equal(runtime(sim).familyEducationVersion, undefined);
});

test('a guardian deposit leaves thirty-nine actual wallet cash and tuition admission fails without consuming its bank rights', () => {
  const context = familyFeeFixture(), { sim, child, site } = context, bank = sim.worldDefinition.buildings.find(building => building.kind === 'bank')!;
  const cashBefore = familyFeeCash(sim), amount = sim.state.player.money - 39; assert.ok(amount > 0);
  sim.setFocus(bank.door, 'walk'); const deposit = sim.command({ type: 'deposit', value: amount }); assert.equal(deposit.ok, true, deposit.message);
  assert.equal(sim.state.player.money, 39); close(familyFeeCash(sim), cashBefore, 'lack of wallet funds is a real deposit, not destruction of cash');
  const rights = sim.state.banking!.accounts.player.deposits; sim.setFocus(station(site), 'walk'); const before = sim.exportSave();
  assert.equal(enrollFamilyCourse(sim, child.id).ok, false); assert.equal(sim.exportSave(), before);
  assert.equal(sim.state.banking!.accounts.player.deposits, rights); assert.equal(sim.state.familyEducation, undefined);
});

test('child and guardian must both be physically at the same original accessible school station when signing', () => {
  const context = familyFeeFixture(true), { sim, child, site, controls, home } = context;
  sim.setFocus(home.door, 'walk'); const away = sim.exportSave(); assert.equal(enrollFamilyCourse(sim, child.id).ok, false); assert.equal(sim.exportSave(), away);
  sim.setFocus(station(site, 0, 1), 'walk'); const otherRoom = sim.exportSave(); assert.equal(enrollFamilyCourse(sim, child.id).ok, false); assert.equal(sim.exportSave(), otherRoom);
  pin(sim, controls, child.id, site, station(site, 1)); sim.setFocus(station(site), 'walk'); const otherFloor = sim.exportSave();
  assert.equal(enrollFamilyCourse(sim, child.id).ok, false); assert.equal(sim.exportSave(), otherFloor);
});

test('absence of any current legal guardian and absence of registered live teachers both reject admission before custody exists', () => {
  for (const absent of ['guardian', 'teacher'] as const) {
    const context = familyFeeFixture(), { sim, child, spouse } = context;
    if (absent === 'guardian') { delete sim.state.family!.children[child.id]; delete sim.state.family!.studentGuardians[child.id]; delete sim.state.family!.careGuardians[child.id]; }
    else for (const teacher of sim.state.citizens.filter(person => person.workId === context.site.id && ['老师', 'teacher'].includes(person.role))) Object.assign(sim.state.extension!.actorProfiles[teacher.id], { alive: false, health: 0 });
    const before = sim.exportSave(); assert.equal(enrollFamilyCourse(sim, child.id).ok, false); assert.equal(sim.exportSave(), before);
    assert.equal(sim.state.familyEducation, undefined); assert.equal(runtime(sim).familyEducationVersion, undefined);
  }
});

for (const [name, relocate] of [
  ['away at home', (context: Context) => pin(context.sim, context.controls, context.teacher.id, context.home, context.home.door)],
  ['at a different supported floor', (context: Context) => pin(context.sim, context.controls, context.teacher.id, context.site, station(context.site, 1), 'work')],
  ['at a different supported classroom on the same floor', (context: Context) => pin(context.sim, context.controls, context.teacher.id, context.site, station(context.site, 0, 1), 'work')],
] as const) test(`a funded textbook cannot teach a child when the original teacher is ${name}`, () => {
  const context = familyFeeFixture(name.includes('classroom')), { sim, child } = context, current = admit(context); material(context, current);
  const before = current.workedMinutes; relocate(context); advance(sim, 4);
  assert.equal(current.workedMinutes, before); assert.equal(current.consumedUnits, 0); assert.equal(child.education, 0);
  assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0); courseLedger(current);
});

test('controlled absence of all genuine material inventory retains the original fee in custody and awards no minutes', () => {
  const context = familyFeeFixture(), { sim, child } = context;
  for (const supplier of sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials')) supplier.inventory = 0;
  const current = admit(context); advance(sim, 4);
  assert.equal(current.receivedUnits, 0); assert.equal(current.receipt, null); assert.equal(current.escrow, 40);
  assert.equal(current.workedMinutes, 0); assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0);
  courseLedger(current);
});

test('an original teacher whose real funded daily four-hundred-eighty-minute allowance is exhausted cannot teach using an old wage event', () => {
  const context = familyFeeFixture(), { sim, child, teacher } = context; attachOrdinaryShifts(context);
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true); advance(sim, 480);
  assert.equal(runtime(sim).attendance[teacher.id], 480, 'actual original paid attendance exhausts the native daily limit');
  const current = admit(context); material(context, current); const paid = context.earned().minutes; advance(sim, 8);
  assert.equal(context.earned().minutes, paid, 'no new current wage is earned after the real daily allowance');
  assert.equal(current.workedMinutes, 0); assert.equal(current.consumedUnits, 0); assert.equal(child.education, 0);
  assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0); courseLedger(current);
});

test('only the post-arrival remainder of the current real people phase can earn family tuition minutes', () => {
  const context = familyFeeFixture(), { sim, site, child } = context, current = admit(context); material(context, current);
  context.controls.delete(child.id); const point = station(site);
  sim.onPhase('traffic', () => { child.position = { ...point, x: point.x + .84 }; child.destinationId = site.id; child.route = [{ ...point }]; child.routeIndex = 0; runtime(sim).activities[child.id] = 'study'; runtime(sim).decisionAt[child.id] = sim.state.day * 1440 + sim.state.hour * 60 + 10; });
  const before = current.workedMinutes; sim.step(.25); close(current.workedMinutes - before, .05, '0.84m of actual 4.2m/min walking spends .20 of a .25 minute phase');
  assert.equal(child.routeIndex, 1); assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0);
  courseLedger(current);
});

test('sixty real paid-teacher minutes and one purchased textbook earn sixty child school minutes without an immediate level', () => {
  const context = familyFeeFixture(), { sim, child, teacher } = context; attachOrdinaryShifts(context);
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true); const current = admit(context), teacherPaidBefore = context.earned().minutes;
  finish(context, current);
  assert.ok(context.earned().minutes - teacherPaidBefore >= 60 - 1e-7);
  assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 60); assert.equal(child.education, 0);
  const record = sim.state.family!.formalLearning![child.id]; assert.equal(record.earnedMinutes, 60); assert.equal(record.receipts.length, 0);
  assert.equal(record.tuitionPages!.flat().length, 1); assert.equal(record.tuitionPages![0][0].courseId, current.id);
  assert.equal(current.staffMinutes[teacher.id], 60); assert.equal(sim.state.familyEducation!.pages[0][0], current);
  partitionContinue24(context);
});

test('leaving a partially taught child course pauses its exact earned prefix and requires lawful explicit restoration without charging again', () => {
  const context = familyFeeFixture(), { sim, child, controls, site, home } = context, current = admit(context); material(context, current); advance(sim, 8);
  const earned = current.workedMinutes; assert.ok(earned > 0 && earned < 60);
  pin(sim, controls, child.id, home, home.door); advance(sim, 4); assert.equal(current.workedMinutes, earned); assert.equal(current.resumeRequired, true);
  pin(sim, controls, child.id, site, station(site)); advance(sim, 4); assert.equal(current.workedMinutes, earned, 'presence alone cannot resume the old paid promise');
  sim.setFocus(station(site), 'walk'); const cashBefore = sim.state.player.money;
  const result = sim.command({ type: 'resumeFamilyCourse', targetId: current.id }); assert.equal(result.ok, true, result.message);
  assert.equal(sim.state.player.money, cashBefore); advance(sim, 4); assert.ok(current.workedMinutes > earned); courseLedger(current);
});

test('partial cancellation refunds only its unearned original escrow and preserves the paid material for a real later reuse', () => {
  const context = familyFeeFixture(), { sim, child } = context, current = admit(context); material(context, current); advance(sim, 8);
  const refundable = current.escrow, wallet = sim.state.player.money, supplierPaid = current.purchasePaid; assert.ok(current.workedMinutes > 0 && current.workedMinutes < 60);
  const cancelled = sim.command({ type: 'cancelFamilyCourse', targetId: current.id }); assert.equal(cancelled.ok, true, cancelled.message);
  close(sim.state.player.money - wallet, refundable); close(current.refunded, refundable); assert.equal(current.purchasePaid, supplierPaid);
  assert.equal(current.status, 'cancelled'); assert.equal(current.escrow, 0); assert.equal(current.consumedUnits, 0);
  assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0); courseLedger(current);
  const again = admit(context); assert.equal(again.reusedUnits, 1); assert.equal(again.reservedUnits, 1); assert.equal(again.purchasePaid, 0); assert.equal(again.receipt, null);
  assert.equal(sim.state.familyEducation!.stock[context.site.id].availableUnits, 0);
  partitionContinue24(context);
});

test('a plain civic event or direct unfinished-course credential call cannot mint a formal school receipt', () => {
  const context = familyFeeFixture(), { sim, child, site } = context, current = admit(context);
  const before = sim.exportSave(); assert.equal(applyFamilyEducationCredential(sim, current), false); assert.equal(sim.exportSave(), before);
  sim.emitEvent({ type: 'civic-service', citizenId: child.id, siteId: site.id, purpose: 'education', minutes: 480, quantity: 8 });
  assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0); assert.equal(sim.state.family!.formalLearning?.[child.id], undefined);
});

test('a duly completed child course cannot issue its credential a second time through direct helper replay', () => {
  const context = familyFeeFixture(), { sim } = context; attachOrdinaryShifts(context); assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const current = admit(context); finish(context, current); const before = sim.exportSave();
  assert.equal(applyFamilyEducationCredential(sim, current), false); assert.equal(sim.exportSave(), before);
});

test('the trusted reader rejects partial markers, forged tuition money, textbook sources and detached qualifications atomically', async t => {
  const context = familyFeeFixture(), { sim, child } = context; attachOrdinaryShifts(context); assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const current = admit(context); finish(context, current); const good = sim.exportSave(), reader = new Simulation(sim.worldDefinition);
  const loaded = reader.importSave(good); assert.equal(loaded.ok, true, loaded.message); assert.equal(reader.exportSave(), good);
  const mutations: [string, (data: any) => void][] = [
    ['module body without its marker', data => { delete data.runtime.familyEducationVersion; }],
    ['module marker without its body', data => { delete data.state.familyEducation; }],
    ['formal tuple body without its marker', data => { delete data.state.family.formalLearningVersion; }],
    ['formal tuple marker without its body', data => { delete data.state.family.formalLearning; }],
    ['tuition pages omitted', data => { delete data.state.family.formalLearning[child.id].tuitionPages; }],
    ['completed contract removed from the full terminal source archive', data => { data.state.familyEducation.pages[0].pop(); }],
    ['phantom escrow cent', data => { data.state.familyEducation.pages[0][0].escrow += .01; }],
    ['phantom tuition refund', data => { data.state.familyEducation.pages[0][0].refunded += 1; }],
    ['food supplier disguised as a genuine textbook workshop', data => { data.state.familyEducation.pages[0][0].receipt.shopId = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'food')!.id; }],
    ['missing actual teacher contribution', data => { data.state.familyEducation.pages[0][0].staffMinutes = {}; }],
    ['duplicate private credential', data => { data.state.family.formalLearning[child.id].tuitionPages[0].push({ ...data.state.family.formalLearning[child.id].tuitionPages[0][0] }); }],
    ['credential detached from its real completed course', data => { data.state.family.formalLearning[child.id].tuitionPages[0][0].courseId = 'family-course-999'; }],
    ['one real sixty-minute course inflated into a level', data => { data.state.citizens.find((person: any) => person.id === child.id).education += 1; }],
    ['school minutes inflated without a paid source', data => { data.state.family.children[child.id].attendanceMinutes += 60; }],
    ['forty-minute paper course lowered from the real sixty-minute recipe', data => { data.state.familyEducation.pages[0][0].requiredMinutes = 40; }],
    ['extra consumed textbook without an actual purchase', data => { data.state.familyEducation.pages[0][0].consumedUnits += 1; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const data = JSON.parse(good); mutate(data); const result = reader.importSave(JSON.stringify(data));
    assert.equal(result.ok, false, `${name} must be refused`); assert.equal(reader.exportSave(), good, `${name} cannot replace the trusted state`);
  });
});

test('public classes, the original player E1 course and child tuition together share four current teacher seats and one learner time budget', () => {
  const context = familyFeeFixture(), { sim, site, teacher, child, controls } = context, publicOrder = publicEducation(context); syncBirthAges(context);
  const childCourse = admit(context), playerCourse = begin(sim); fundedMaterial(sim, playerCourse.id); material(context, childCourse);
  const learners = sim.state.citizens.filter(person => person.id !== child.id && person.id !== teacher.id && person.role !== '老师' && person.workId !== site.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 3);
  for (const learner of learners) pin(sim, controls, learner.id, site, station(site));
  const ids = [...learners.map(person => person.id), child.id, 'player'];
  for (let tick = 0; tick < 8; tick++) {
    const publicBefore = ids.reduce((sum, id) => sum + (publicOrder.serviceMinutes[id] ?? 0), 0), playerBefore = playerCourse.workedMinutes, childBefore = childCourse.workedMinutes, childPublicBefore = publicOrder.serviceMinutes[child.id] ?? 0;
    sim.step(.25);
    const publicGain = ids.reduce((sum, id) => sum + (publicOrder.serviceMinutes[id] ?? 0), 0) - publicBefore, playerGain = playerCourse.workedMinutes - playerBefore, childGain = childCourse.workedMinutes - childBefore;
    assert.ok(publicGain + playerGain + childGain > 0); assert.ok(publicGain + playerGain + childGain <= 4 * .25 + 1e-7, 'all three actual services share the same four teacher seats');
    assert.ok(childGain + (publicOrder.serviceMinutes[child.id] ?? 0) - childPublicBefore <= .25 + 1e-7, 'one child cannot reuse a current learning minute in public and tuition');
  }
  courseLedger(childCourse); assert.equal(child.education, 0);
});

test('eight genuine guardian-paid courses earn one school level and retain every one of the eight rights sources', () => {
  const context = familyFeeFixture(), { sim, child } = context; attachOrdinaryShifts(context); assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const completed: FamilyEducationCourse[] = [];
  for (let index = 1; index <= 8; index++) {
    const current = admit(context); finish(context, current); completed.push(current);
    assert.equal(sim.state.family!.children[child.id].attendanceMinutes, index * 60); assert.equal(child.education, Math.floor(index / 8));
    const record = sim.state.family!.formalLearning![child.id]; assert.equal(record.earnedMinutes, index * 60); assert.equal(record.tuitionPages!.flat().length, index);
  }
  assert.equal(sim.state.familyEducation!.pages.length, 1); assert.equal(sim.state.familyEducation!.pages[0].length, 8);
  assert.equal(sim.state.familyEducation!.totals.funded, 320); assert.equal(sim.state.familyEducation!.totals.completed, 8);
  assert.equal(completed.reduce((sum, current) => sum + current.consumedUnits, 0), 8);
  writeFileSync(`${output}/eight-family-courses.metrics.json`, JSON.stringify({ status: 'PASS', initialPopulation: 384, population: sim.state.citizens.length, tuition: 320, formalMinutes: 480, qualification: child.education, courses: completed, source: 'native opening player wallet after genuine pregnancy/enrollment fees', physicalControls: true, naturalEighteenYears: false }, null, 2));
  writeFileSync(`${output}/eight-family-courses.save.json`, sim.exportSave()); partitionContinue24(context);
});

test('twenty-four actual courses funded by original guardians and actual traveler work retain three full terms and permit graduation only at the controlled adult boundary', () => {
  const context = familyFeeFixture(), { sim, child, spouse, controls, home, site } = context; attachOrdinaryShifts(context); assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const completed: FamilyEducationCourse[] = [], wages: ReturnType<typeof earnTravelerShift>[] = [], opening = { player: sim.state.player.money, guardian: spouse.money };
  // This is an explicit real supplemental earnings demonstration. Do not
  // artificially suppress the other guardian's lawful original job to force
  // a later poverty condition; earn the original traveler shift while an
  // original employer can genuinely reserve its finite thirty-five cash.
  wages.push(earnTravelerShift(context));
  for (let index = 1; index <= 24; index++) {
    let payer = sim.state.player.money >= 40 ? 'player' : spouse.money >= 140 ? spouse.id : '';
    if (!payer) { wages.push(earnTravelerShift(context)); payer = sim.state.player.money >= 40 ? 'player' : ''; }
    // A native 32.2-net wage may require two real shifts when the prior wallet
    // was near zero; never replace the missing cash with a fixture grant.
    if (!payer) { wages.push(earnTravelerShift(context)); payer = 'player'; }
    const current = admit(context, payer); finish(context, current); completed.push(current);
    assert.equal(sim.state.family!.children[child.id].attendanceMinutes, index * 60); assert.equal(child.education, Math.floor(index / 8));
    assert.equal(sim.state.family!.formalLearning![child.id].tuitionPages!.flat().length, index);
    assert.equal(sim.state.family!.children[child.id].graduatedAt, null, 'minor cannot use academic completion as an adult labor contract');
  }
  assert.ok(wages.length > 0, 'at least one completed original traveler shift supplies real supplemental tuition cash');
  assert.ok(wages.every(job => job.workedMinutes === 60 && job.gross === 35 && job.employerId));
  assert.equal(sim.state.familyEducation!.pages.length, 3); assert.ok(sim.state.familyEducation!.pages.every(page => page.length === 8));
  const record = sim.state.family!.formalLearning![child.id]; assert.equal(record.earnedMinutes, 1440); assert.equal(record.receipts.length, 0); assert.equal(record.tuitionPages!.length, 3);
  assert.equal(sim.state.familyEducation!.totals.funded, 960); assert.equal(sim.state.familyEducation!.totals.completed, 24);
  assert.equal(completed.reduce((sum, course) => sum + course.consumedUnits, 0), 24);
  const evidence = { status: 'PASS', initialPopulation: 384, population: sim.state.citizens.length, tuition: 960, opening, wages, nativeGuardianWages: context.guardianWages(), paidTeacher: context.earned(), formalMinutes: 1440, qualification: child.education, courses: completed, physicalControls: true, naturalEighteenYears: false };
  writeFileSync(`${output}/twenty-four-family-courses.metrics.json`, JSON.stringify(evidence, null, 2));
  writeFileSync(`${output}/twenty-four-family-courses.save.json`, sim.exportSave()); partitionContinue24(context);
  ageBoundary(sim, child, 18); pin(sim, controls, child.id, home, home.door); advance(sim, 1);
  assert.ok(sim.state.family!.children[child.id].graduatedAt !== null); assert.ok(['工人', '农民'].includes(child.role));
  assert.notEqual(child.workId, site.id); assert.ok(sim.buildingTravelDistance(child.homeId, child.workId) <= 500);
  writeFileSync(`${output}/controlled-adult-graduation.save.json`, sim.exportSave());
});

test('a native lawful guardian actually signs through the people-phase social school intention and later resumes its paid course even when its real wallet cannot buy a new one', () => {
  const context = familyFeeFixture(false, 'limited'), { sim, site, spouse, child, controls, home } = context;
  attachOrdinaryShifts(context);
  // Selecting an original 240..260 wallet yields a real 140..160 balance after
  // the normal hundred birth reserve. Two completed40 classes plus a third40
  // custody deposit can legitimately leave less than40; nothing is injected.
  assert.ok(spouse.money >= 140 && spouse.money < 160);
  assert.ok(familyEducationOpportunities(sim, spouse).some(opportunity => opportunity.destination.id === site.id && opportunity.activity === 'social'));
  sim.onPhase('traffic', () => { pin(sim, controls, spouse.id, site, station(site), 'social'); });
  const wallet = spouse.money; assert.equal(sim.state.familyEducation, undefined);
  sim.step(.25);
  const first = lesson(sim); assert.equal(first.payerId, spouse.id); assert.equal(spouse.money, wallet - 40);
  assert.equal(first.workedMinutes, 0, 'the actual signing tick cannot backfill already observed school presence');
  assert.equal(spouse.state, 'socializing'); assert.equal(sim.state.familyEducation!.totals.funded, 40);
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true); finish(context, first);
  const second = admit(context, spouse.id); finish(context, second);
  const third = admit(context, spouse.id); material(context, third); advance(sim, 2);
  assert.ok(spouse.money < 40); const beforePause = third.workedMinutes; assert.ok(beforePause > 0);
  pin(sim, controls, child.id, home, home.door); advance(sim, 4);
  assert.equal(third.resumeRequired, true); assert.equal(third.workedMinutes, beforePause);
  assert.ok(familyEducationOpportunities(sim, spouse).some(opportunity => opportunity.destination.id === site.id && opportunity.activity === 'social'), 'a real already-funded pause retains its school return intention without a new fee reserve');
  pin(sim, controls, child.id, site, station(site)); const beforeResume = third.workedMinutes, money = spouse.money;
  sim.step(.25);
  assert.equal(third.resumeRequired, false, 'actual social school people phase restores the original payer course without a direct command');
  assert.equal(spouse.money, money); assert.equal(third.workedMinutes, beforeResume, 'the restoration tick resets observed time without catching up the absence');
  assert.equal(sim.state.familyEducation!.totals.funded, 120); assert.equal(sim.state.familyEducation!.nextId, 4);
  sim.step(.25); assert.ok(third.workedMinutes > beforeResume); courseLedger(third);
  writeFileSync(`${output}/native-guardian-auto-sign-and-resume.metrics.json`, JSON.stringify({ status: 'PASS', openingWallet: context.openingSpouse, birthReserve: 100, guardianCashAfterRealTuition: money, tuitionFunded: 120, courses: familyEducationCourses(sim.state), signatureMinuteCredit: 0, resumeMinuteCredit: 0, physicalControls: true, naturalCommute: false }, null, 2));
});

// Fatal-health and adult age boundaries are declared fixture controls.
// Original estate, care-guardian selection, refund and trusted-reader phases
// perform the real resulting transitions; biological parent IDs are retained.
for (const cause of ['original NPC payer death', 'child death', 'child controlled adult boundary'] as const)
test(`a real ${cause} stops unfinished tuition, preserves source material, refunds original custody and restores for twenty-four ticks`, () => {
  const context = familyFeeFixture(), { sim, child, spouse, site, controls } = context;
  const payerId = cause === 'original NPC payer death' ? spouse.id : 'player';
  if (payerId !== 'player') pin(sim, controls, payerId, site, station(site));
  const enrolled = enrollFamilyCourse(sim, child.id, payerId); assert.equal(enrolled.ok, true, enrolled.message);
  const course = sim.state.familyEducation!.active[0];
  for (let tick = 0; course.reservedUnits !== 1 && tick < 16; tick++) sim.step(.25);
  assert.equal(course.reservedUnits, 1); advance(sim, 4); assert.ok(course.workedMinutes > 0 && course.workedMinutes < 60);
  const physicalCash = familyFeeCash(sim), refundable = course.escrow, purchasePaid = course.purchasePaid, earned = course.workedMinutes;
  if (cause === 'child controlled adult boundary') ageBoundary(sim, child, 18);
  else sim.state.extension!.actorProfiles[cause === 'child death' ? child.id : spouse.id].health = 0;
  // This is a controlled fatal-health/age boundary. The ordinary extension,
  // family estate executor and tuition phase perform all resulting changes.
  sim.step(.25);
  assert.equal(course.status, 'cancelled'); assert.equal(course.cancelledAt !== null, true);
  assert.equal(course.workedMinutes, earned); assert.equal(course.purchasePaid, purchasePaid);
  close(course.refunded, refundable, 'only unearned original custody is returned'); assert.equal(course.escrow, 0);
  assert.equal(course.reservedUnits, 0); assert.equal(course.consumedUnits, 0); assert.equal(sim.state.familyEducation!.stock[site.id].availableUnits, 1);
  assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0);
  close(familyFeeCash(sim), physicalCash, 'death/adulthood, refund and inheritance conserve all physical accounts');
  if (cause === 'original NPC payer death') {
    assert.equal(sim.state.extension!.actorProfiles[spouse.id].alive, false);
    assert.ok(sim.state.family!.estates[spouse.id]); assert.equal(spouse.money, 0, 'the original family finance executor passes the refunded deceased wallet cash to its actual heirs');
  } else if (cause === 'child death') {
    assert.equal(sim.state.extension!.actorProfiles[child.id].alive, false); assert.ok(sim.state.family!.estates[child.id]);
  } else assert.equal(sim.state.extension!.actorProfiles[child.id].alive, true);
  writeFileSync(`output/family-fee-education/endpoint-${cause.replaceAll(' ', '-')}.save.json`, sim.exportSave());
  writeFileSync(`output/family-fee-education/endpoint-${cause.replaceAll(' ', '-')}.metrics.json`, JSON.stringify({ status:'PASS', cause, course, physicalCash, refundable, availableMaterial:1, formalMinutes:0, qualification:0, controlledBoundary:true, naturalEighteenYears:false },null,2));
  partitionContinue24(context); close(familyFeeCash(sim), physicalCash);
});

test('the ordinary family executor legally replaces a deceased care guardian and the old payer course ends without rewriting biological parents', () => {
  const context = familyFeeFixture(), { sim, child, spouse, teacher, site, controls } = context;
  const parents = [...sim.state.family!.children[child.id].parentIds];
  sim.state.extension!.actorProfiles.player.health = 0; sim.state.extension!.actorProfiles[spouse.id].health = 0;
  sim.step(.25);
  assert.equal(sim.state.extension!.actorProfiles.player.alive, false); assert.equal(sim.state.extension!.actorProfiles[spouse.id].alive, false);
  assert.deepEqual(sim.state.family!.children[child.id].parentIds, parents);
  assert.ok(sim.state.family!.careGuardians[child.id].includes(teacher.id), 'the native adult teacher is the actual nearby healthy solvent same-home guardian selected by the original executor');
  const accepted = enrollFamilyCourse(sim, child.id, teacher.id); assert.equal(accepted.ok, true, accepted.message);
  const course = sim.state.familyEducation!.active[0]; assert.equal(course.guardianKind, 'care');
  for (let tick = 0; course.reservedUnits !== 1 && tick < 16; tick++) sim.step(.25); advance(sim, 2);
  const physicalCash = familyFeeCash(sim), refundable = course.escrow, outsider = sim.state.citizens.find(person => person.id !== teacher.id && person.id !== spouse.id && !['学生', '老师'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].alive && person.money >= 120 && sim.state.extension!.actorProfiles[person.id].mood >= 60 && sim.state.extension!.actorProfiles[person.id].health >= 60)!;
  assert.ok(outsider); pin(sim, controls, outsider.id, site, station(site));
  const before = sim.exportSave(); assert.equal(cancelFamilyCourse(sim, course.id, outsider.id).ok, false); assert.equal(sim.exportSave(), before);
  sim.state.extension!.actorProfiles[teacher.id].health = 0; sim.step(.25);
  assert.equal(sim.state.extension!.actorProfiles[teacher.id].alive, false);
  assert.ok(sim.state.family!.careGuardians[child.id].includes(outsider.id), 'a real nearby eligible living adult replaces the deceased caretaker through the original family rule');
  assert.deepEqual(sim.state.family!.children[child.id].parentIds, parents);
  assert.equal(course.status, 'cancelled'); close(course.refunded, refundable);
  assert.equal(course.consumedUnits, 0); assert.equal(sim.state.familyEducation!.stock[site.id].availableUnits, 1);
  assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0); close(familyFeeCash(sim), physicalCash);
  writeFileSync('output/family-fee-education/legal-care-guardian-transition.save.json', sim.exportSave()); partitionContinue24(context);
});
