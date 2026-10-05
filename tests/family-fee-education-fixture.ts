import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Simulation } from '../src/simulation.ts';
import { GAME_DAY, GAME_YEAR, GESTATION_MINUTES } from '../src/simulation/family.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import type { Citizen } from '../src/types.ts';
import { familyEducationCourses } from '../src/simulation/family-education.ts';
import { advance, at, attachControls, cash, close, fixture, pin, runtime, setup, station, type Controls } from './education-fixture.ts';
const ordinaryShifts = new WeakSet<Simulation>();

/** Test controls isolate native contracts. They do not establish autonomous
 * commuting, unassisted meals, natural conception, or eighteen years of life.
 * Money, textbook inventory, roles, jobs, teacher wages, formal minutes and
 * qualifications always retain their genuine constructor/contract sources. */
export function familyFeeFixture(dualStations = false, guardianCash: 'ample' | 'limited' = 'ample') {
  const context = setup(0, true, dualStations), { sim, controls, site, teacher } = context;
  const home = sim.worldDefinition.buildings.find(building => building.kind === 'home')!;
  const spouse = sim.state.citizens.filter(person => person.role !== '老师' && person.role !== '学生'
    && person.money >= 200 && (guardianCash !== 'limited' || person.money >= 240 && person.money < 260)
    && sim.state.extension!.actorProfiles[person.id].age >= 18 && !person.partnerId)
    .sort((a, b) => b.money - a.money)[0];
  assert.ok(spouse, 'native adult partner has enough real cash for the original birth reserve');
  assert.ok(sim.state.player.money >= 200);
  const openingPlayer = sim.state.player.money, openingSpouse = spouse.money;
  sim.state.player.homeId = home.id; sim.state.player.partnerId = spouse.id; sim.setFocus(home.door, 'walk');
  spouse.homeId = home.id; spouse.partnerId = 'player'; pin(sim, controls, spouse.id, home, home.door);
  sim.state.player.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; spouse.needs = { ...sim.state.player.needs };
  for (const id of ['player', spouse.id]) Object.assign(sim.state.extension!.actorProfiles[id], { age: 28, health: 100, mood: 80, stress: 10 });
  sim.state.relationships.push({ npcId: spouse.id, affection: 90, trust: 90, type: 'spouse', encounters: 20, memories: [], tags: ['共同生活'], romanceStage: 'family', romanceSince: 0, hostilityStage: 'none', consent: true });
  // Exactly the established family fixture's saved relationship/birth boundary;
  // the ordinary command debits both original wallets and the ordinary family
  // phase creates the actual child. No resident is fabricated in the fixture.
  sim.state.extension!.lastUpdate = sim.state.family!.lastUpdate = sim.state.culture!.lastUpdate = 8 * GAME_DAY;
  const planned = sim.command({ type: 'planFamily', targetId: spouse.id }); assert.equal(planned.ok, true, planned.message);
  assert.equal(sim.state.player.money, openingPlayer - 100); assert.equal(spouse.money, openingSpouse - 100);
  const pregnancy = sim.state.family!.pregnancies[0]; assert.equal(pregnancy.dueAt - pregnancy.startedAt, GESTATION_MINUTES);
  sim.state.extension!.lastUpdate = sim.state.family!.lastUpdate = sim.state.culture!.lastUpdate = pregnancy.dueAt - .25;
  sim.step(.25);
  const child = sim.state.citizens.find(person => person.id === 'resident-1')!; assert.ok(child);
  ageBoundary(sim, child, 6);
  // Birth does not reset teacher contracts or inject additional funding. A new
  // real people phase must create any wage attestation after this clock jump.
  sim.setFocus(site.door, 'walk'); child.position = { ...site.door };
  const beforeEnrollment = sim.state.player.money, enrolled = sim.command({ type: 'enrollChild', targetId: child.id });
  assert.equal(enrolled.ok, true, enrolled.message); assert.equal(sim.state.player.money, beforeEnrollment - 40);
  pin(sim, controls, child.id, site, station(site)); sim.setFocus(station(site), 'walk');
  sim.onPhase('traffic', () => { runtime(sim).activities[child.id] = 'study'; });
  assert.deepEqual(sim.state.family!.children[child.id].parentIds, ['player', spouse.id]);
  assert.equal(sim.state.family!.children[child.id].schoolId, site.id);
  assert.equal(child.education, 0); assert.equal(sim.state.family!.children[child.id].attendanceMinutes, 0);
  let guardianPaid = 0, guardianEarned = 0, guardianMinutes = 0;
  sim.onEvent('wage-earned', event => { if (event.citizenId === spouse.id) { guardianEarned += event.amount ?? 0; guardianMinutes += event.minutes ?? 0; } });
  sim.onEvent('wage-paid', event => { if (event.citizenId === spouse.id) guardianPaid += event.amount ?? 0; });
  return { ...context, home, spouse, child, openingPlayer, openingSpouse, guardianWages: () => ({ earned: guardianEarned, paidGross: guardianPaid, workedMinutes: guardianMinutes }) };
}

/** Declared saved age boundary: preserve child birth provenance and advance
 * every existing living profile and the family/culture clock together. */
export function ageBoundary(sim: Simulation, child: Citizen, age: number): void {
  const life = sim.state.extension!.actorProfiles[child.id], years = age - life.age;
  assert.ok(years >= 0);
  sim.state.extension!.lastUpdate += years * GAME_YEAR; sim.state.family!.lastUpdate = sim.state.culture!.lastUpdate = at(sim);
  for (const profile of Object.values(sim.state.extension!.actorProfiles)) if (profile.alive) profile.age += years;
  life.age = age;
}

/** Pin original industrial participants and the original public reviewers to
 * ordinary day shifts. Neither job assignment nor money/allowance is granted.
 * These physical controls prevent an off-hours pin spending tomorrow's native
 * 480-minute wage budget before the actual classroom opens. */
export function attachOrdinaryShifts(context: ReturnType<typeof familyFeeFixture>): void {
  const { sim, controls, site, teacher, spouse } = context;
  ordinaryShifts.add(sim);
  const hall = sim.worldDefinition.buildings.find(building => building.kind === 'hall')!;
  const reviewers = sim.state.citizens.filter(person => person.role === '官员' && person.workId === hall.id
    && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  assert.equal(reviewers.length, 2, 'native public payroll has its original two adult reviewers');
  const workshops = sim.worldDefinition.buildings.filter(building => building.kind === 'workshop');
  const producers = sim.state.citizens.filter(person => workshops.some(workshop => workshop.id === person.workId)
    && person.role !== '学生' && sim.state.extension!.actorProfiles[person.id].age >= 18);
  for (const shop of sim.state.shops.filter(shop => workshops.some(workshop => workshop.id === shop.buildingId))) {
    const roster = producers.filter(person => person.workId === shop.buildingId);
    assert.equal(roster.length, shop.employees);
    assert.ok(roster.some(person => person.id === sim.shopOwnerId(shop)));
    assert.ok(roster.every(person => sim.buildingTravelDistance(person.homeId, person.workId) <= 500));
  }
  sim.onPhase('traffic', () => {
    const open = sim.state.hour >= 8 && sim.state.hour < 17;
    for (const person of [...new Set([teacher, ...reviewers, ...producers, spouse])]) {
      // The real partner can earn original wages as an industrial participant;
      // only classroom signatures require that parent to be physically there.
      const workplace = sim.worldDefinition.buildings.find(building => building.id === person.workId)!;
      const home = sim.worldDefinition.buildings.find(building => building.id === person.homeId)!;
      const target = open ? workplace : home;
      pin(sim, controls, person.id, target, open && target.id === site.id ? station(target) : target.door, open ? 'work' : 'social');
    }
    sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  });
}

export function familyFeeCash(sim: Simulation): number {
  return cash(sim) + familyEducationCourses(sim.state).reduce((sum, item) => sum + item.escrow, 0);
}

/** Genuine original traveler job: the employer must reserve its own existing
 * cash, and only sixty actual on-site minutes can pay net tuition money. */
export function earnTravelerShift(context: ReturnType<typeof familyFeeFixture>): { jobId: string; gross: number; net: number; workedMinutes: number; employerId: string | null } {
  const { sim } = context, employers = sim.worldDefinition.buildings.filter(building => ['workshop', 'market', 'farm'].includes(building.kind));
  if (sim.state.hour < 6 || sim.state.hour >= 20) advance(sim, (24 - sim.state.hour + 8) * 60);
  sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  const funds = sim.state.player.money, rejections: { siteId: string; message: string }[] = [];
  let accepted = { ok: false, message: 'No native employer has accepted this actual traveler shift.' };
  for (const employer of employers) {
    sim.setFocus(employer.door, 'walk'); accepted = sim.command({ type: 'work', targetId: employer.id });
    if (accepted.ok) break; rejections.push({ siteId: employer.id, message: accepted.message });
  }
  if (!accepted.ok) {
    const evidence = { status: 'FAIL', cause: 'Every original native traveler employer refuses to reserve its own protected thirty-five cash.', rejections, player: sim.state.player.money, guardian: context.spouse.money, guardianWages: context.guardianWages(), completedCourses: familyEducationCourses(sim.state).filter(course => course.status === 'completed').length,
      formalMinutes: sim.state.family!.children[context.child.id].attendanceMinutes, qualification: context.child.education, employers: sim.state.shops.map(shop => ({ id: shop.id, cash: sim.shopFunds(shop), protected: Reflect.get(sim, 'shopProtectedFunds').call(sim, shop) })) };
    writeFileSync('output/family-fee-education/traveler-reserve-failure.metrics.json', JSON.stringify(evidence, null, 2));
    writeFileSync('output/family-fee-education/traveler-reserve-failure.save.json', sim.exportSave()); console.log(JSON.stringify(evidence));
  }
  assert.equal(accepted.ok, true, accepted.message);
  const job = sim.state.playerLabor!.job!; assert.equal(job.role, 'traveler'); assert.equal(job.gross, 35);
  assert.equal(job.escrow, 35); assert.equal(sim.state.player.money, funds, 'starting a funded job is not a cash grant');
  advance(sim, 60);
  assert.equal(job.status, 'completed'); assert.equal(job.workedMinutes, 60); assert.equal(job.paidGross, 35);
  assert.equal(job.escrow, 0); close(sim.state.player.money - funds, job.paidNet, 'net pay comes from the real completed shift');
  close(job.paidNet + job.paidTax, job.paidGross, 'actual net wage and tax exactly account for gross within the existing one-millionth currency tolerance');
  return { jobId: job.id, gross: job.paidGross, net: job.paidNet, workedMinutes: job.workedMinutes, employerId: job.employer.shopId };
}

export function partitionContinue24(context: ReturnType<typeof familyFeeFixture>): void {
  const { sim, controls } = context; assert.equal(sim.command({ type: 'speed', value: 1 }).ok, true);
  const saved = sim.exportSave(), assembled = assembleSave(partitionSave(saved, sim.worldDefinition)); assert.equal(assembled, saved);
  const next = new Simulation(sim.worldDefinition), loaded = next.importSave(assembled); assert.equal(loaded.ok, true, loaded.message);
  assert.equal(next.exportSave(), saved); attachControls(next, controls);
  // For this final short continuation the declared controls are unchanged and
  // no shift boundary is crossed. Recreate only the fixture's actual activity.
  next.onPhase('traffic', () => { runtime(next).activities[context.child.id] = 'study'; });
  if (ordinaryShifts.has(sim)) attachOrdinaryShifts({ ...context, sim: next,
    teacher: next.state.citizens.find(person => person.id === context.teacher.id)!,
    spouse: next.state.citizens.find(person => person.id === context.spouse.id)!,
    child: next.state.citizens.find(person => person.id === context.child.id)!,
  });
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), `family tuition exact continuation ${tick + 1}`); }
}

export { advance, at, attachControls, close, fixture, pin, runtime, setup, station, type Controls };
