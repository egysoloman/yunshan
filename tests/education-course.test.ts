import assert from 'node:assert/strict';
import test from 'node:test';
import { floorPlanSupport } from '../src/architecture-floor-plan.ts';
import { Simulation } from '../src/simulation.ts';
import { educationAtPosition, educationPairAtStation, educationServiceStationsAtPosition, educationSlotAvailable, educationStaffMinutes, takeEducationSlot } from '../src/simulation/education.ts';
import { actorActivityAvailable, claimActorActivityMinutes } from '../src/simulation/activity-minutes.ts';
import { researchProgressInfo } from '../src/simulation/extensions.ts';
import { advance, assertNoPaidCourse, at, begin, cash, close, completePaidCourse, course, education, finitePublicShift, fixture, fundedMaterial, ledger, pin, publicEducation, publicLearner, publicOnly, restore24, restrictRemainingShift, runtime, setup, station } from './education-fixture.ts';

// NOT_RUN: static candidate contracts. Every classroom position is controlled
// unless the individual test explicitly states it checks the default route.

for (const marked of [false, true]) test(`${marked ? 'marked' : 'unmarked'} paid class earns exactly sixty actual minutes, one textbook and one reward`, () => {
  const { sim, controls, site, teacher } = setup(0, marked), beforeCash = cash(sim), money = sim.state.player.money;
  const beforeEducation = sim.state.player.education, beforeExperience = sim.state.player.experience;
  assert.equal(education(sim), undefined);
  const current = begin(sim), id = current.id;
  assert.equal(sim.state.player.money, money - 40); assert.equal(current.escrow, 40); assert.equal(current.workedMinutes, 0);
  assert.equal(current.purchasePaid, 0); assert.equal(current.receipt, null); assert.equal(current.status, 'awaitingSupply');
  assert.equal(sim.state.player.education, beforeEducation); assert.equal(sim.state.player.experience, beforeExperience);
  ledger(current); close(cash(sim), beforeCash, 'cash includes the new forty escrow');
  const purchased = fundedMaterial(sim, id), receipt = purchased.receipt;
  assert.equal(current.receivedUnits, 1); assert.equal(current.reusedUnits, 0); assert.equal(current.consumedUnits, 0);
  assert.equal(current.workedMinutes, 0, 'procurement follows people; material cannot backfill its preceding phase');
  assert.ok(receipt); assert.equal(receipt.quantity, 1);
  assert.ok(sim.state.shops.some(shop => shop.id === receipt.shopId && sim.shopCommodity(shop) === 'materials'));
  close(receipt.gross, receipt.unitPrice); close(receipt.gross, receipt.net + receipt.tax);
  close(current.purchasePaid, receipt.gross); ledger(current); close(cash(sim), beforeCash, 'supplier net plus real wholesale tax');
  advance(sim, 59.75);
  close(current.workedMinutes, 59.75); assert.equal(current.consumedUnits, 0); assert.equal(sim.state.player.education, beforeEducation);
  close(current.serviceFees, (40 - current.purchasePaid) * 59.75 / 60, 'only already earned service fee');
  ledger(current); close(cash(sim), beforeCash);
  advance(sim, .25);
  const finished = course(sim, id); assert.equal(finished.status, 'completed'); assert.equal(finished.workedMinutes, 60);
  assert.equal(finished.consumedUnits, 1); assert.equal(finished.reservedUnits, 0); assert.equal(finished.escrow, 0);
  close(finished.purchasePaid + finished.serviceFees, 40); close(finished.staffMinutes[teacher.id], 60);
  assert.equal(sim.state.player.education, beforeEducation + 1); assert.equal(sim.state.player.experience, beforeExperience + 1);
  assert.equal(education(sim)!.stock[site.id].consumedUnits, 1); ledger(finished); close(cash(sim), beforeCash);
  restore24(sim, controls); advance(sim, 20);
  assert.equal(sim.state.player.education, beforeEducation + 1); assert.equal(sim.state.player.experience, beforeExperience + 1);
  assert.equal(course(sim, id).consumedUnits, 1); assert.equal(education(sim)!.stats.completed, 1);
});

test('finite empty real suppliers preserve forty escrow and earn neither minutes nor material', () => {
  const { sim } = setup();
  const suppliers = sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials'); assert.ok(suppliers.length);
  // Explicit controlled stock exhaustion, not a fabricated receipt or free
  // replacement material. Producers remain home and earn no production work.
  for (const shop of suppliers) shop.inventory = 0;
  const supply = cash(sim), current = begin(sim), grade = sim.state.player.education;
  advance(sim, 8);
  assert.equal(current.workedMinutes, 0); assert.equal(current.purchasePaid, 0); assert.equal(current.escrow, 40);
  assert.equal(current.receipt, null); assert.equal(current.receivedUnits, 0); assert.equal(current.consumedUnits, 0);
  assert.equal(sim.state.player.education, grade); ledger(current); close(cash(sim), supply);
});

test('an onsite course with zero textbooks cannot lock a genuinely qualified hundred-coin research admission', () => {
  // Qualifications are actually earned on joint S1+E1 source. No research
  // fields, roles or education levels are injected.
  const { sim, site } = setup();
  for (let index = 0; index < 3; index++) completePaidCourse(sim, site);
  assert.equal(sim.state.player.education, 3);
  const qualified = sim.command({ type: 'exam', targetId: 'scientist' }); assert.equal(qualified.ok, true, qualified.message);
  for (const shop of sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials')) shop.inventory = 0;
  const current = begin(sim), before = sim.state.player.money, level = sim.state.extension!.technologies.find(technology => technology.sector === 'medicine')!.level;
  assert.equal(current.reservedUnits, 0); assert.equal(current.workedMinutes, 0);
  const research = sim.command({ type: 'research', targetId: 'medicine', value: 100 }); assert.equal(research.ok, true, research.message);
  assert.equal(sim.state.player.money, before - 100);
  advance(sim, 4); assert.equal(current.workedMinutes, 0); assert.equal(current.escrow, 40);
  close(researchProgressInfo(sim.state, 'medicine')!.workedMinutes!, 4, 'zero-material paid intent consumes no research minutes');
  assert.ok(sim.state.extension!.technologies.find(technology => technology.sector === 'medicine')!.progress > 0);
  assert.equal(sim.state.extension!.technologies.find(technology => technology.sector === 'medicine')!.level, level);
  const home = sim.worldDefinition.buildings.find(building => building.kind === 'home')!;
  sim.setFocus(home.door, 'walk'); advance(sim, .25); sim.setFocus(station(site), 'walk');
  const money = sim.state.player.money, continued = sim.command({ type: 'exam', targetId: 'study' }); assert.equal(continued.ok, true, continued.message);
  assert.equal(course(sim).id, current.id); assert.equal(sim.state.player.money, money);
  assert.equal(current.workedMinutes, 0); ledger(current);
  const researchMinutes = researchProgressInfo(sim.state, 'medicine')!.workedMinutes!;
  advance(sim, 4); close(researchProgressInfo(sim.state, 'medicine')!.workedMinutes!, researchMinutes + 4, 'explicit course continue with zero material still leaves actual research time');
  assert.equal(current.workedMinutes, 0); assert.equal(current.escrow, 40); ledger(current);
});

test('public and paid waiting intentions leave research four actual minutes, then one real public class claims them', () => {
  const context = setup(), { sim, controls, site, teacher } = context, order = publicEducation(context);
  for (let index = 0; index < 3; index++) completePaidCourse(sim, site);
  const qualified = sim.command({ type: 'exam', targetId: 'scientist' }); assert.equal(qualified.ok, true, qualified.message);
  const attended = sim.command({ type: 'attendService', targetId: order.id }); assert.equal(attended.ok, true, attended.message);
  const home = sim.worldDefinition.buildings.find(building => building.id === teacher.homeId)!;
  pin(sim, controls, teacher.id, home, home.door);
  const current = begin(sim), before = sim.state.player.money, research = sim.command({ type: 'research', targetId: 'medicine', value: 100 });
  assert.equal(research.ok, true, research.message); assert.equal(sim.state.player.money, before - 100);
  assert.ok(order.receivedUnits - order.consumedUnits >= 1, 'public waiting classroom still has its genuinely purchased material');
  const publicBefore = order.serviceMinutes.player ?? 0;
  advance(sim, 4); close(researchProgressInfo(sim.state, 'medicine')!.workedMinutes!, 4);
  assert.equal(current.workedMinutes, 0); assert.equal(order.serviceMinutes.player ?? 0, publicBefore);
  pin(sim, controls, teacher.id, site, station(site), 'work');
  const researchBefore = researchProgressInfo(sim.state, 'medicine')!.workedMinutes!;
  advance(sim, 4); close((order.serviceMinutes.player ?? 0) - publicBefore, 4, 'real public teaching must actually progress');
  assert.equal(current.workedMinutes, 0, 'the same learner cannot also claim the paid course');
  assert.equal(researchProgressInfo(sim.state, 'medicine')!.workedMinutes, researchBefore, 'the same learner cannot also claim research');
  ledger(current);
});

test('an actual paid class owns this phase through its final archive, then research earns the next phase', () => {
  const { sim, site } = setup();
  for (let index = 0; index < 3; index++) completePaidCourse(sim, site);
  const qualified = sim.command({ type: 'exam', targetId: 'scientist' }); assert.equal(qualified.ok, true, qualified.message);
  const current = begin(sim), research = sim.command({ type: 'research', targetId: 'medicine', value: 100 });
  assert.equal(research.ok, true, research.message); fundedMaterial(sim, current.id);
  const researchBefore = researchProgressInfo(sim.state, 'medicine')!; assert.equal(researchBefore.legacy, false);
  const researchMinutes = researchBefore.workedMinutes!;
  advance(sim, 59.75); close(current.workedMinutes, 59.75);
  assert.equal(researchProgressInfo(sim.state, 'medicine')!.workedMinutes, researchMinutes, 'eligible paid teaching consumes actual minutes before research');
  advance(sim, .25); assert.equal(course(sim, current.id).status, 'completed'); assert.equal(education(sim)!.course, null);
  assert.equal(researchProgressInfo(sim.state, 'medicine')!.workedMinutes, researchMinutes, 'archive must not release the final earned course slice twice');
  advance(sim, .25); close(researchProgressInfo(sim.state, 'medicine')!.workedMinutes!, researchMinutes + .25, 'next actual phase is available for research');
  ledger(course(sim, current.id));
});

test('leaving the original point preserves minutes and fees until explicit continue without a second charge', () => {
  const { sim, controls, site, teacher } = setup(), current = begin(sim);
  fundedMaterial(sim, current.id); advance(sim, 10);
  const earned = current.workedMinutes, fees = current.serviceFees, paid = current.purchasePaid, money = sim.state.player.money;
  const home = sim.worldDefinition.buildings.find(building => building.kind === 'home')!;
  sim.setFocus(home.door, 'walk'); advance(sim, 4);
  assert.equal(current.status, 'paused'); assert.equal(current.resumeRequired, true);
  assert.equal(current.workedMinutes, earned); assert.equal(current.serviceFees, fees); assert.equal(current.purchasePaid, paid);
  sim.setFocus(station(site), 'walk'); advance(sim, 4);
  assert.equal(current.workedMinutes, earned, 'returning alone cannot silently continue');
  const continued = sim.command({ type: 'exam', targetId: 'study' }); assert.equal(continued.ok, true, continued.message);
  assert.equal(course(sim).id, current.id); assert.equal(sim.state.player.money, money);
  advance(sim, 1); close(current.workedMinutes, earned + 1); close(current.staffMinutes[teacher.id], earned + 1);
  ledger(current); restore24(sim, controls);
});

test('cancellation keeps paid work in history, refunds only unearned escrow and reuses a real unconsumed textbook', () => {
  const { sim, site } = setup(), supply = cash(sim), grade = sim.state.player.education, current = begin(sim);
  fundedMaterial(sim, current.id); advance(sim, 10);
  const refund = current.escrow, money = sim.state.player.money, minutes = current.workedMinutes, paid = current.purchasePaid, fees = current.serviceFees;
  const cancelled = sim.command({ type: 'cancelStudy', targetId: current.id }); assert.equal(cancelled.ok, true, cancelled.message);
  const stopped = course(sim, current.id);
  assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.workedMinutes, minutes); assert.equal(stopped.purchasePaid, paid);
  assert.equal(stopped.serviceFees, fees); close(stopped.refunded, refund); close(sim.state.player.money, money + refund);
  assert.equal(stopped.consumedUnits, 0); assert.equal(stopped.reservedUnits, 0); assert.equal(stopped.escrow, 0);
  assert.equal(education(sim)!.stock[site.id].availableUnits, 1); assert.equal(sim.state.player.education, grade); ledger(stopped); close(cash(sim), supply);
  const beforeDuplicate = sim.exportSave(); assert.equal(sim.command({ type: 'cancelStudy', targetId: current.id }).ok, false); assert.equal(sim.exportSave(), beforeDuplicate);
  const next = begin(sim); assert.notEqual(next.id, stopped.id); assert.equal(next.workedMinutes, 0);
  assert.equal(next.receivedUnits, 0); assert.equal(next.reusedUnits, 1); assert.equal(next.reservedUnits, 1);
  assert.equal(next.receipt, null); assert.equal(next.purchasePaid, 0); assert.equal(next.escrow, 40);
  advance(sim, 59.75); assert.equal(sim.state.player.education, grade); close(next.workedMinutes, 59.75);
  advance(sim, .25); assert.equal(course(sim, next.id).status, 'completed'); assert.equal(sim.state.player.education, grade + 1);
  assert.equal(course(sim, stopped.id).workedMinutes, minutes); assert.equal(education(sim)!.stock[site.id].receivedUnits, 1);
  assert.equal(education(sim)!.stock[site.id].consumedUnits, 1); close(cash(sim), supply);
});

test('bounded history archives only cleared terminal ledgers without losing forty-coin refunds', () => {
  const { sim, controls } = setup(), supply = cash(sim), money = sim.state.player.money;
  for (let count = 0; count < 67; count++) {
    const current = begin(sim); assert.equal(current.workedMinutes, 0); assert.equal(current.receivedUnits, 0);
    assert.equal(sim.command({ type: 'cancelStudy', targetId: current.id }).ok, true);
  }
  const data = education(sim)!; assert.equal(data.course, null); assert.equal(data.history.length, 64); assert.equal(data.archived.count, 3);
  assert.equal(data.stats.funded, 67 * 40); assert.equal(data.stats.refunded, 67 * 40); assert.equal(data.stats.cancelled, 67);
  assert.equal(data.archived.funded, 3 * 40); assert.equal(data.archived.refunded, 3 * 40); assert.equal(data.archived.cancelled, 3);
  assert.equal(data.stats.workedMinutes, 0); assert.equal(data.stats.completed, 0); assert.equal(sim.state.player.money, money);
  for (const stopped of data.history) { assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.escrow, 0); ledger(stopped); }
  close(cash(sim), supply); restore24(sim, controls);
});

test('an absent teacher and an actual working teacher upstairs cannot teach the paid ground classroom', () => {
  const { sim, controls, site, teacher } = setup(), current = begin(sim); fundedMaterial(sim, current.id); advance(sim, 2);
  const minutes = current.workedMinutes, staff = current.staffMinutes[teacher.id], home = sim.worldDefinition.buildings.find(building => building.id === teacher.homeId)!;
  pin(sim, controls, teacher.id, home, home.door); advance(sim, 4);
  assert.equal(sim.isOnDuty(teacher.id, site.id), false); assert.equal(current.workedMinutes, minutes);
  pin(sim, controls, teacher.id, site, station(site, 1), 'work'); advance(sim, 4);
  assert.equal(sim.isOnDuty(teacher.id, site.id), true, 'genuine upstairs work can still earn a wage');
  assert.equal(educationPairAtStation(sim, site, teacher, 'player'), false);
  assert.equal(current.workedMinutes, minutes); assert.equal(current.staffMinutes[teacher.id], staff); assert.equal(current.consumedUnits, 0);
  pin(sim, controls, teacher.id, site, station(site), 'work'); advance(sim, 1);
  close(current.workedMinutes, minutes + 1); ledger(current);
});

test('same floor requires the same station and keeps each actor within two metres of its station', () => {
  const { sim, controls, site, teacher } = setup(0, true, true), west = station(site), east = station(site, 0, 1);
  sim.setFocus(east, 'walk'); assert.equal(educationAtPosition(site, east, sim.state.player, sim.state.voxels), true);
  assert.equal(educationPairAtStation(sim, site, teacher, 'player'), false);
  const current = begin(sim); fundedMaterial(sim, current.id); advance(sim, 2); assert.equal(current.workedMinutes, 0);
  pin(sim, controls, teacher.id, site, east, 'work'); advance(sim, 1); close(current.workedMinutes, 1);
  pin(sim, controls, teacher.id, site, { ...east, x: east.x - 1.8 }, 'work');
  sim.setFocus({ ...east, x: east.x + 1.8 }, 'walk');
  assert.ok(Math.abs(teacher.position.x - sim.state.player.position.x) > 2, 'two metres limits station admission, not teacher-to-student separation');
  assert.equal(educationPairAtStation(sim, site, teacher, 'player'), true);
});

test('marked education rejects partial .35m support, wrong height and non-public classroom ACL', () => {
  const { sim, site } = setup(0, true, false, true), good = station(site);
  const partial = { ...good, x: good.x + 1.6, z: site.position.z - 10.1 };
  assert.ok(floorPlanSupport(site, 0, partial, 0), 'the point itself is within the real rear classroom');
  assert.equal(floorPlanSupport(site, 0, partial, .35), null, 'a full body intersects its real boundary wall');
  assert.ok(Math.hypot(good.x - partial.x, good.z - partial.z) < 2);
  for (const position of [partial, { ...good, y: good.y + 1 }, { ...good, x: site.position.x + site.width }]) {
    sim.setFocus(position, 'walk'); const before = sim.exportSave();
    assert.equal(educationAtPosition(site, position, sim.state.player, sim.state.voxels), false);
    assert.equal(sim.command({ type: 'exam', targetId: 'study' }).ok, false); assert.equal(sim.exportSave(), before);
    assert.equal(education(sim), undefined, 'failed physical admission stays lazy');
  }
  const restricted = { ...site, publicFloors: 0, floorPermissions: ['official', 'public', 'public'] };
  assert.equal(educationAtPosition(restricted, good, sim.state.player, sim.state.voxels), false);
});

test('a genuinely saved placed cube blocks the course station without spending or earning more', () => {
  const { sim, controls, site } = setup(), current = begin(sim); fundedMaterial(sim, current.id); advance(sim, 2);
  const beforeMinutes = current.workedMinutes, beforeFee = current.serviceFees, data = JSON.parse(sim.exportSave()), point = station(site);
  assert.ok(data.state.player.inventory.block >= 1);
  data.state.voxels.push({ id: `voxel-${++data.runtime.constructionId}`, position: { x: Math.round(point.x / .2) * .2, y: Math.round((point.y + .8) / .2) * .2, z: Math.round(point.z / .2) * .2 }, color: '#8fcdc9' });
  data.state.player.inventory.block--;
  const loaded = sim.importSave(JSON.stringify(data)); assert.equal(loaded.ok, true, loaded.message);
  assert.equal(educationServiceStationsAtPosition(site, point, sim.state.player, sim.state.voxels).length, 0);
  advance(sim, 4);
  assert.equal(course(sim, current.id).workedMinutes, beforeMinutes); assert.equal(course(sim, current.id).serviceFees, beforeFee);
  assert.equal(course(sim, current.id).consumedUnits, 0); restore24(sim, controls);
});

test('active partially taught saves roundtrip exactly and reject forged financial, material and time references atomically', () => {
  const { sim, controls, site, teacher } = setup(), current = begin(sim); fundedMaterial(sim, current.id); advance(sim, 3);
  restore24(sim, controls);
  const saved = sim.exportSave();
  type Saved = ReturnType<typeof JSON.parse>;
  const corruptions: [string, (data: Saved) => void][] = [
    ['body without manifest', data => { data.runtime.persistedModules = data.runtime.persistedModules.filter((name: string) => name !== 'education'); }],
    ['body without any manifest', data => { delete data.runtime.persistedModules; }],
    ['manifest without body', data => { delete data.state.education; }],
    ['missing module marker', data => { delete data.runtime.educationVersion; }],
    ['wrong module version', data => { data.runtime.educationVersion = 2; }],
    ['cash equation', data => { data.state.education.course.escrow += 1; }],
    ['receipt tax', data => { data.state.education.course.receipt.tax += 1; }],
    ['nonfinite receipt gross', data => { data.state.education.course.receipt.gross = Infinity; }],
    ['supplier reference', data => { data.state.education.course.receipt.shopId = 'missing-supplier'; }],
    ['existing non-material supplier', data => { data.state.education.course.receipt.shopId = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'food')!.id; }],
    ['existing food shop cannot supply a textbook', data => { const food = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'food')!; assert.ok(food); data.state.education.course.receipt.shopId = food.id; }],
    ['purchase before course', data => { data.state.education.course.receipt.purchasedAt = data.state.education.course.startedAt - 1; }],
    ['unsupported reference floor', data => { data.state.education.course.floor = site.floors; }],
    ['forged point', data => { data.state.education.course.point.x += .2; }],
    ['more than sixty minutes', data => { data.state.education.course.workedMinutes = 60.25; }],
    ['teacher reference', data => { data.state.education.course.staffMinutes.missing = data.state.education.course.staffMinutes[teacher.id]; delete data.state.education.course.staffMinutes[teacher.id]; }],
    ['material without source', data => { data.state.education.stock[site.id].availableUnits += 1; }],
    ['statistics without course', data => { data.state.education.stats.workedMinutes += 1; }],
    ['duplicate current in history', data => { data.state.education.history.push(data.state.education.course); }],
  ];
  for (const [label, corrupt] of corruptions) {
    const data = JSON.parse(saved); corrupt(data); const result = sim.importSave(JSON.stringify(data));
    assert.equal(result.ok, false, label); assert.equal(sim.exportSave(), saved, `${label} must leave live state and pending refunds untouched`);
  }
  const overflow = JSON.parse(saved); overflow.state.education.course.receipt.gross = 'EDUCATION_GROSS_OVERFLOW';
  assert.equal(sim.importSave(JSON.stringify(overflow).replace('"EDUCATION_GROSS_OVERFLOW"', '1e400')).ok, false, 'JSON numeric overflow cannot pass approximate cash equations');
  assert.equal(sim.exportSave(), saved);
});

test('one actual teacher shares four per-phase slots between public education and the paid course', () => {
  const context = setup(), { sim, controls, site, teacher } = context, order = publicEducation(context);
  const current = begin(sim); fundedMaterial(sim, current.id);
  const learners = sim.state.citizens.filter(person => person.id !== teacher.id && person.role !== '老师' && person.workId !== site.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 4);
  assert.equal(learners.length, 4);
  for (const person of learners) pin(sim, controls, person.id, site, station(site));
  const ids = learners.map(person => person.id), phaseMinutes = .25;
  for (let tick = 0; tick < 8; tick++) {
    const publicBefore = ids.reduce((sum, id) => sum + (order.serviceMinutes[id] ?? 0), 0), paidBefore = current.workedMinutes;
    sim.step(.25);
    assert.equal(sim.isOnDuty(teacher.id, site.id), true);
    const publicGain = ids.reduce((sum, id) => sum + (order.serviceMinutes[id] ?? 0), 0) - publicBefore, paidGain = current.workedMinutes - paidBefore;
    assert.ok(publicGain + paidGain > 0, 'real eligible education must make progress');
    assert.ok(publicGain + paidGain <= 4 * phaseMinutes + 1e-7, 'public and paid may not each award four teacher slots');
  }
  ledger(current); restore24(sim, controls);
});

test('shared slots and actor minutes reject duplicate claims and reset when actual tick or imported state changes', () => {
  const { sim, teacher } = setup(), ids = sim.state.citizens.filter(person => person.id !== teacher.id).slice(0, 5).map(person => person.id);
  for (const id of ids.slice(0, 4)) assert.equal(takeEducationSlot(sim, teacher.id, id), true);
  assert.equal(takeEducationSlot(sim, teacher.id, ids[0]), false); assert.equal(educationSlotAvailable(sim, teacher.id, ids[4]), false);
  assert.equal(takeEducationSlot(sim, teacher.id, ids[4]), false);
  assert.equal(claimActorActivityMinutes(sim, 'player', 'test-research', .15, .25), .15);
  close(actorActivityAvailable(sim, 'player', .25), .10);
  assert.equal(claimActorActivityMinutes(sim, 'player', 'test-research', .25, .25), 0);
  close(claimActorActivityMinutes(sim, 'player', 'test-course', .25, .25), .10);
  close(actorActivityAvailable(sim, 'player', .25), 0);
  const saved = sim.exportSave(), restored = sim.importSave(saved); assert.equal(restored.ok, true, restored.message);
  assert.equal(takeEducationSlot(sim, teacher.id, ids[4]), true); close(actorActivityAvailable(sim, 'player', .25), .25);
  sim.step(.25); assert.equal(takeEducationSlot(sim, teacher.id, ids[0]), true); close(actorActivityAvailable(sim, 'player', .25), .25);
});

test('after a real forty commitment the native marked teacher route prefers a supported ground station without creating attendance', () => {
  // This test installs no controlled setDestination override. It checks native
  // planner selection only; it does not establish autonomous route completion.
  const sim = new Simulation(fixture()), site = sim.worldDefinition.buildings.find(building => building.kind === 'school')!;
  const fnv = (text: string) => { let value = 2166136261; for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619); return value >>> 0; };
  const teacher = sim.state.citizens.find(person => person.role === '老师' && person.workId === site.id && sim.state.extension!.actorProfiles[person.id].age >= 18 && fnv(`${person.id}:${site.id}`) % site.floors !== 0)!;
  assert.ok(teacher, 'real native teacher has an old hashed upstairs first target');
  teacher.position = { ...site.door }; teacher.destinationId = null; teacher.route = []; teacher.routeIndex = 0; runtime(sim).activities[teacher.id] = 'work';
  const ground = site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'service')!;
  assert.equal(floorPlanSupport(site, 0, ground.position, .35)?.floor, 0);
  assert.ok(site.functionPoints!.some(point => point.purpose === 'work' && point.floor === 0 && Math.hypot(point.position.x - ground.position.x, point.position.y - ground.position.y, point.position.z - ground.position.z) < 1e-8));
  sim.setFocus(ground.position, 'walk'); const current = begin(sim); assert.equal(current.escrow, 40); assert.equal(current.workedMinutes, 0);
  Reflect.get(sim, 'setDestination').call(sim, teacher, site, true);
  assert.deepEqual(teacher.route!.at(-1), ground.position); assert.equal(runtime(sim).attendance[teacher.id] ?? 0, 0);
});

test('controlled existing finite public shift credits the old deferred prefix, never inventing a paid current tail', () => {
  const context = setup(), { sim, site, teacher } = context, plan = finitePublicShift(context), { assignment } = plan;
  const first = begin(sim); fundedMaterial(sim, first.id);
  advance(sim, Math.ceil(assignment.workedMinutes) - assignment.workedMinutes);
  assert.equal(sim.command({ type: 'cancelStudy', targetId: first.id }).ok, true);
  const current = begin(sim); assert.equal(current.reusedUnits, 1); assert.equal(current.workedMinutes, 0);
  // Controlled consistent contraction of this existing approved assignment
  // leaves exactly two earned-work minutes available. This is a saved-cap and
  // old backlog boundary, not naturally observed budget exhaustion/commuting.
  const oldCommitment = plan.shift.cap; restrictRemainingShift(plan, 2);
  assert.ok(plan.shift.cap < oldCommitment); assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  runtime(sim).peopleElapsed ??= {}; runtime(sim).peopleElapsed[teacher.id] = 60;
  sim.setFocus({ x: 1800, y: .6, z: 0 }, 'drone'); assert.equal(teacher.tier, 'statistical');
  const earnedBefore = runtime(sim).attendance[teacher.id], tier = teacher.tier, speed = sim.state.speed;
  const intervals: { minutes: number; start: number; end: number }[] = [];
  sim.onEvent('wage-earned', event => {
    if (event.citizenId === teacher.id) {
      assert.equal(typeof event.minutes, 'number'); assert.equal(typeof event.creditedWorkStartAt, 'number'); assert.equal(typeof event.creditedWorkEndAt, 'number');
      assert.ok(event.minutes !== undefined && event.creditedWorkStartAt !== undefined && event.creditedWorkEndAt !== undefined);
      intervals.push({ minutes: event.minutes, start: event.creditedWorkStartAt, end: event.creditedWorkEndAt });
    }
  });
  sim.step(.25);
  close(runtime(sim).attendance[teacher.id] - earnedBefore, 2, 'core registerAttendance credits only its funded two');
  assert.equal(intervals.length, 1); close(intervals[0].minutes, 2); close(intervals[0].end - intervals[0].start, 2);
  assert.ok(intervals[0].end <= at(sim) - 4, 'old paid prefix ends before this four-minute classroom phase');
  assert.equal(current.workedMinutes, 0); assert.equal(current.serviceFees, 0); assert.equal(current.consumedUnits, 0);
  assert.equal(sim.isOnDuty(teacher.id, site.id), false, 'exhausted allowance cannot be used as historical earned-tail proof');
  assert.equal(teacher.tier, tier); assert.equal(sim.state.speed, speed); ledger(current);
});

test('two current funded minutes teach even when their public allowance becomes zero in the same four-minute phase', () => {
  const context = setup(), { sim, site, teacher } = context, plan = finitePublicShift(context), current = begin(sim);
  fundedMaterial(sim, current.id); advance(sim, Math.ceil(plan.assignment.workedMinutes) - plan.assignment.workedMinutes);
  restrictRemainingShift(plan, 2); assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  const before = current.workedMinutes, attendance = runtime(sim).attendance[teacher.id];
  assert.equal(sim.isOnDuty(teacher.id, site.id), true); advance(sim, 4);
  close(runtime(sim).attendance[teacher.id] - attendance, 2); close(current.workedMinutes - before, 2);
  assert.equal(sim.isOnDuty(teacher.id, site.id), false, 'end-of-phase allowance zero does not erase its proved wage slice');
  const after = current.workedMinutes; advance(sim, 4); assert.equal(current.workedMinutes, after); ledger(current);
});

test('public-only teaching takes the same sixty actual minutes at active, regional and statistical camera tiers', () => {
  const durations: number[] = [];
  for (const [tier, offset] of [['active', 0], ['regional', 700], ['statistical', 1620]] as const) {
    const context = publicOnly(), { sim, controls, site, teacher, order } = context, learner = publicLearner(context);
    // Real camera distance selects tier; no tier field or update function is
    // replaced. Bodies remain explicitly controlled at their actual station.
    const point = station(site); sim.setFocus({ ...point, x: point.x + offset }, 'drone');
    assert.equal(teacher.tier, tier); assertNoPaidCourse(sim);
    assert.equal(order.serviceMinutes[learner.id] ?? 0, 0); const start = at(sim), grade = learner.education;
    const attendance = runtime(sim).attendance[teacher.id];
    advance(sim, 59.75);
    close(order.serviceMinutes[learner.id], 59.75); assert.equal(order.servedIds.includes(learner.id), false);
    assert.equal(order.consumedUnits, 0); assert.equal(learner.education, grade);
    close(runtime(sim).attendance[teacher.id] - attendance, 59.75, 'public teacher earns actual every-phase attendance at the unchanged tier');
    advance(sim, .25);
    assert.equal(order.serviceMinutes[learner.id], 60); assert.equal(order.servedIds.includes(learner.id), true); assert.equal(order.consumedUnits, 1);
    assert.equal(learner.education, (grade ?? 0) + 1); assert.equal(teacher.tier, tier); assertNoPaidCourse(sim);
    durations.push(at(sim) - start); restore24(sim, controls); assertNoPaidCourse(sim);
  }
  assert.deepEqual(durations, [60, 60, 60], 'fine classroom processing leaves physical tier and simulation speed intact');
});

test('public-only initial sixty-minute backlog with two funded prefix minutes teaches zero current minutes', () => {
  const context = publicOnly(), { sim, site, teacher, order } = context, plan = finitePublicShift(context);
  // There is no participant while the genuine public shift and its actual
  // whole-minute attendance precondition are established.
  advance(sim, 1); assert.ok(Number.isInteger(plan.assignment.workedMinutes));
  const learner = publicLearner(context); assert.equal(order.serviceMinutes[learner.id] ?? 0, 0); assertNoPaidCourse(sim);
  restrictRemainingShift(plan, 2); assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  // Explicit consistent old-backlog injection; no fake attendance, wage or
  // teacher role. The original core registerAttendance must earn its prefix.
  runtime(sim).peopleElapsed ??= {}; runtime(sim).peopleElapsed[teacher.id] = 60;
  sim.setFocus({ x: 1800, y: .6, z: 0 }, 'drone'); assert.equal(teacher.tier, 'statistical');
  const attendance = runtime(sim).attendance[teacher.id], intervals: { minutes: number; start: number; end: number }[] = [];
  sim.onEvent('wage-earned', event => {
    if (event.citizenId === teacher.id) {
      assert.ok(event.minutes !== undefined && event.creditedWorkStartAt !== undefined && event.creditedWorkEndAt !== undefined);
      intervals.push({ minutes: event.minutes, start: event.creditedWorkStartAt, end: event.creditedWorkEndAt });
    }
  });
  sim.step(.25);
  close(runtime(sim).attendance[teacher.id] - attendance, 2); assert.equal(intervals.length, 1);
  close(intervals[0].minutes, 2); close(intervals[0].end - intervals[0].start, 2);
  assert.ok(intervals[0].end <= at(sim) - 4, 'actual paid old prefix is outside the current public lesson window');
  assert.equal(order.serviceMinutes[learner.id] ?? 0, 0); assert.equal(order.consumedUnits, 0);
  assert.equal(sim.isOnDuty(teacher.id, site.id), false); assert.equal(teacher.tier, 'statistical'); assertNoPaidCourse(sim);
});

test('public-only current four-minute phase with two remaining funded minutes teaches exactly those two', () => {
  const context = publicOnly(), { sim, site, teacher, order } = context, plan = finitePublicShift(context);
  advance(sim, 1); assert.ok(Number.isInteger(plan.assignment.workedMinutes));
  const learner = publicLearner(context); assert.equal(order.serviceMinutes[learner.id] ?? 0, 0); assertNoPaidCourse(sim);
  assert.equal(runtime(sim).peopleElapsed?.[teacher.id] ?? 0, 0, 'this boundary has no old backlog');
  restrictRemainingShift(plan, 2); assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  sim.setFocus({ x: 1800, y: .6, z: 0 }, 'drone'); assert.equal(teacher.tier, 'statistical');
  const attendance = runtime(sim).attendance[teacher.id]; assert.equal(sim.isOnDuty(teacher.id, site.id), true);
  sim.step(.25);
  close(runtime(sim).attendance[teacher.id] - attendance, 2); close(order.serviceMinutes[learner.id], 2);
  assert.equal(order.consumedUnits, 0); assert.equal(sim.isOnDuty(teacher.id, site.id), false);
  assert.equal(teacher.tier, 'statistical'); assertNoPaidCourse(sim);
  sim.step(.25); close(order.serviceMinutes[learner.id], 2); assert.equal(order.consumedUnits, 0); assertNoPaidCourse(sim);
});

test('public-only observers without a current work attestation cannot borrow historical duty', () => {
  const context = publicOnly(), { sim, site, teacher, order } = context, learner = publicLearner(context);
  assertNoPaidCourse(sim); assert.equal(sim.isOnDuty(teacher.id, site.id), true);
  const claim = runtime(sim).wageAccruals.find((item: { citizenId: string }) => item.citizenId === teacher.id); assert.ok(claim);
  const minutes = claim.minutes, amount = claim.amount, attendance = runtime(sim).attendance[teacher.id], bus = Reflect.get(sim, 'bus'), original = Reflect.get(bus, 'emit');
  // Fault injection: silence only the current attestation metadata in delivery
  // of this teacher's real wage event. Core wage/attendance accounting executes
  // untouched; other wage observers still receive the actual amount/minutes.
  // This is not a natural commuting case or a manufactured earned-work event.
  Reflect.set(bus, 'emit', (event: { type: string; citizenId?: string; creditedWorkStartAt?: number; creditedWorkEndAt?: number }) => {
    if (event.type === 'wage-earned' && event.citizenId === teacher.id) {
      const { creditedWorkStartAt: _start, creditedWorkEndAt: _end, ...silent } = event;
      return original.call(bus, silent);
    }
    return original.call(bus, event);
  });
  try { sim.step(.25); } finally { Reflect.set(bus, 'emit', original); }
  close(runtime(sim).attendance[teacher.id] - attendance, .25); close(claim.minutes - minutes, .25);
  assert.ok(claim.amount > amount); assert.equal(sim.isOnDuty(teacher.id, site.id), true, 'actual funded work still happened');
  assert.equal(educationStaffMinutes(sim, teacher, site.id, .25), 0, 'observer cannot manufacture this missing current attestation');
  assert.equal(order.serviceMinutes[learner.id] ?? 0, 0); assert.equal(order.consumedUnits, 0); assertNoPaidCourse(sim);
  sim.step(.25); close(order.serviceMinutes[learner.id], .25, 'only the later normally attested phase earns learning'); assertNoPaidCourse(sim);
});
