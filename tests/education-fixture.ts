import assert from 'node:assert/strict';
import { floorPlanSupport, getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import { Simulation } from '../src/simulation.ts';
import type { EducationCourse, EducationState } from '../src/simulation/education.ts';
import type { Building, BuildingKind, Citizen, Vec3, WorldDefinition } from '../src/types.ts';

// Static E1 test preparation: NOT_RUN. Position controls isolate classroom
// guards; they do not demonstrate natural commuting or autonomous coverage.
// No role, employment assignment, approved budget, attendance or wage claim is
// fabricated. Core people/finance/politics and real physical guards still run.
export function fixture(marked = true, dualStations = false, edgeStation = false): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank', 'hall', 'station'];
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `education-${kind}`, name: `课程测试${kind}`, kind, districtId: 'education-district', position: { x: index * 60, y: 0, z: 0 }, door: { x: index * 60, y: .6, z: kind === 'school' ? 19 : 6 }, width: kind === 'school' ? 50 : 12, depth: kind === 'school' ? 38 : 12, height: kind === 'school' ? 11.4 : 12, floors: kind === 'school' ? 3 : 2, rotation: 0, capacity: 100, seed: index }));
  const site = buildings.find(building => building.kind === 'school')!;
  if (marked) {
    site.floorPlanProfile = 'v4-program-bodies-02';
    site.functionPoints = Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
    if (dualStations || edgeStation) {
      const offsets = edgeStation ? [-8] : [-6, 6], z = edgeStation ? -10.8 : -12.92;
      site.functionPoints = [...site.functionPoints.filter(point => point.floor !== 0), ...offsets.flatMap(x => (['work', 'service'] as const).map(purpose => ({ id: `0:fixture-${x}:${purpose}`, purpose, floor: 0, position: { x: site.position.x + x, y: .6, z } })))];
    }
  }
  const nodes = buildings.map(building => ({ id: `${building.id}-door`, name: building.name, districtId: building.districtId, position: { ...building.door }, station: true }));
  return { seed: 20261001, voxelSize: .2, size: 2000, buildings, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `education-road-${index}`, mode: 'road', from: nodes[index].id, to: node.id, length: Math.hypot(node.position.x - nodes[index].position.x, node.position.y - nodes[index].position.y, node.position.z - nodes[index].position.z), capacity: 20, points: [nodes[index].position, node.position] })), mountains: [], river: [], waterfall: { top: { x: 1000, y: 60, z: 100 }, bottom: { x: 1000, y: 0, z: 100 }, width: 10 }, districts: [{ id: 'education-district', name: '课程测试街坊', kind: 'school', center: { x: 400, y: 0, z: 0 }, radius: 1000, color: '#aac', population: 384 }], spawn: { ...buildings[0].door } };
}

export type Course = EducationCourse;
export type Education = EducationState;
export const education = (sim: Simulation): Education | undefined => Reflect.get(sim.state, 'education');
export const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
export const at = (sim: Simulation) => sim.state.extension!.lastUpdate;
export function course(sim: Simulation, id?: string): Course {
  const data = education(sim); assert.ok(data, 'an accepted funded course creates the lazy education module');
  const found = id ? [data.course, ...data.history].find(item => item?.id === id) : data.course;
  assert.ok(found, `course ${id ?? '(active)'} must exist`); return found;
}
export const station = (site: Building, floor = 0, index = 0): Vec3 => site.floorPlanProfile
  ? (site.functionPoints ?? getBuildingUsePoints(site, floor)).filter(point => point.floor === floor && point.purpose === 'service')[index].position
  : { x: site.position.x, y: site.position.y + .6 + floor * site.height / site.floors, z: site.position.z + 1.2 };
type Pin = { siteId: string; position: Vec3; activity: 'work' | 'social' };
export type Controls = Map<string, Pin>;
export function pin(sim: Simulation, controls: Controls, id: string, site: Building, position: Vec3, activity: Pin['activity'] = 'social'): void {
  controls.set(id, { siteId: site.id, position: { ...position }, activity });
  const person = sim.state.citizens.find(person => person.id === id)!;
  person.position = { ...position }; person.destinationId = site.id; person.route = [{ ...position }]; person.routeIndex = 1;
  runtime(sim).activities[id] = activity; runtime(sim).decisionAt[id] = sim.state.day * 1440 + sim.state.hour * 60 + 10;
}
export function attachControls(sim: Simulation, controls: Controls): void {
  const original = Reflect.get(sim, 'setDestination');
  Reflect.set(sim, 'setDestination', (person: Citizen, destination: Building, rebuild = false) => {
    const value = controls.get(person.id);
    if (value?.siteId === destination.id) { person.destinationId = destination.id; person.route = [{ ...value.position }]; person.routeIndex = 1; return; }
    return original.call(sim, person, destination, rebuild);
  });
  sim.onPhase('traffic', () => {
    for (const [id, value] of controls) {
      const person = sim.state.citizens.find(person => person.id === id)!;
      person.position = { ...value.position }; person.destinationId = value.siteId; person.route = [{ ...value.position }]; person.routeIndex = 1;
      person.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
      runtime(sim).activities[id] = value.activity; runtime(sim).decisionAt[id] = sim.state.day * 1440 + sim.state.hour * 60 + 10;
    }
  });
}
export function advance(sim: Simulation, minutes: number): void {
  const deadline = at(sim) + minutes;
  for (let tick = 0; at(sim) < deadline - 1e-7 && tick < 10000; tick++) sim.step(.25);
  assert.ok(at(sim) >= deadline - 1e-7, 'bounded controlled advance reaches its actual simulation deadline');
}
export function setup(teacherFloor = 0, marked = true, dualStations = false, edgeStation = false) {
  const sim = new Simulation(fixture(marked, dualStations, edgeStation)), controls: Controls = new Map();
  const site = sim.worldDefinition.buildings.find(building => building.kind === 'school')!;
  assert.equal(sim.state.citizens.length, 384); assert.equal(sim.state.speed, 1);
  const teacher = sim.state.citizens.find(person => person.workId === site.id && person.role === '老师' && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  assert.ok(teacher, '384-person constructor provides an adult native school teacher');
  assert.ok(sim.buildingTravelDistance(teacher.homeId, site.id) <= 500);
  assert.equal(runtime(sim).attendance[teacher.id] ?? 0, 0);
  let earnedMinutes = 0, earnedAmount = 0;
  sim.onEvent('wage-earned', event => { if (event.citizenId === teacher.id) { earnedMinutes += event.minutes ?? 0; earnedAmount += event.amount ?? 0; } });
  for (const person of sim.state.citizens) {
    const home = sim.worldDefinition.buildings.find(building => building.id === person.homeId)!;
    pin(sim, controls, person.id, home, home.door);
  }
  if (marked) assert.equal(floorPlanSupport(site, teacherFloor, station(site, teacherFloor), .35)?.floor, teacherFloor);
  pin(sim, controls, teacher.id, site, station(site, teacherFloor), 'work'); attachControls(sim, controls);
  sim.setFocus(station(site), 'walk'); sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  advance(sim, 4);
  assert.ok(earnedMinutes > 0 && earnedAmount > 0, 'real people phase emits an actual funded earned wage');
  assert.ok(runtime(sim).wageAccruals.some((claim: { citizenId: string; minutes: number; amount: number }) => claim.citizenId === teacher.id && claim.minutes > 0 && claim.amount > 0));
  assert.equal(sim.isOnDuty(teacher.id, site.id), true, 'only actual funded attendance establishes duty');
  return { sim, controls, site, teacher, earned: () => ({ minutes: earnedMinutes, amount: earnedAmount }) };
}
export function begin(sim: Simulation): Course {
  const result = sim.command({ type: 'exam', targetId: 'study' }); assert.equal(result.ok, true, result.message);
  return course(sim);
}
export function fundedMaterial(sim: Simulation, id: string): Course {
  for (let tick = 0; course(sim, id).reservedUnits < 1 && tick < 16; tick++) sim.step(.25);
  const current = course(sim, id); assert.equal(current.reservedUnits, 1); return current;
}
export function restore24(sim: Simulation, controls: Controls): void {
  const next = new Simulation(sim.worldDefinition), saved = sim.exportSave(), loaded = next.importSave(saved);
  assert.equal(loaded.ok, true, loaded.message); assert.equal(next.exportSave(), saved);
  attachControls(next, controls);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), `exact course continuation tick ${tick + 1}`); }
}
export function cash(sim: Simulation): number {
  const state = sim.state, extension = state.extension!, data = education(sim);
  return state.treasury + runtime(sim).taxes + state.player.money + state.banking!.cash + state.banking!.legacyInvestmentCash +
    state.citizens.reduce((sum, person) => sum + person.money, 0) +
    state.shops.filter(shop => !extension.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0) +
    extension.companies.reduce((sum, company) => sum + company.capital, 0) + extension.organizations.reduce((sum, organization) => sum + organization.funds, 0) +
    state.family!.pregnancies.reduce((sum, item) => sum + item.escrow, 0) + state.family!.households.reduce((sum, item) => sum + item.balance, 0) +
    (state.playerLabor?.job?.escrow ?? 0) + state.clinical!.orders.reduce((sum, item) => sum + item.escrow, 0) +
    (data?.course?.escrow ?? 0) + (data?.history.reduce((sum, item) => sum + item.escrow, 0) ?? 0);
}
export function close(actual: number, expected: number, label = 'conserved amount'): void {
  assert.ok(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} differs from ${expected}`);
}
export function ledger(current: Course): void {
  close(current.funded, 40, 'one actual funding');
  close(current.purchasePaid + current.serviceFees + current.refunded + current.escrow, current.funded, 'course cash equation');
  close(Object.values(current.staffMinutes).reduce((sum, value) => sum + value, 0), current.workedMinutes, 'teacher contribution equals earned learning');
  assert.ok(current.workedMinutes >= 0 && current.workedMinutes <= 60);
}
export function publicEducation(context: ReturnType<typeof setup>) {
  const { sim, controls, site, teacher } = context, hall = sim.worldDefinition.buildings.find(building => building.kind === 'hall')!;
  assert.equal(education(sim), undefined, 'controlled public deadline jump occurs before a paid course exists');
  sim.setFocus(hall.door, 'walk');
  const filed = sim.command({ type: 'filePetition', targetId: 'education', title: '真实同站课堂', text: '居民请求在学校安排教材有限、教师真实出勤且学员共同到达课堂的公共教学。' });
  assert.equal(filed.ok, true, filed.message);
  const petition = sim.state.culture!.petitions.at(-1)!;
  const signers = sim.state.citizens.filter(person => person.id !== teacher.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 3);
  for (const person of signers) pin(sim, controls, person.id, hall, station(hall));
  advance(sim, 4); assert.ok(petition.signerIds.length >= 3);
  const officials = sim.state.citizens.filter(person => person.role === '官员' && person.workId === hall.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  assert.equal(officials.length, 2); assert.ok(officials.every(person => sim.buildingTravelDistance(person.homeId, hall.id) <= 500));
  for (const person of officials) pin(sim, controls, person.id, hall, station(hall), 'work');
  // Existing M1 saved-deadline control, not natural next-day/election evidence.
  const delta = petition.replyAt - 2 - at(sim);
  sim.state.extension!.lastUpdate += delta; sim.state.family!.lastUpdate += delta; sim.state.culture!.lastUpdate += delta;
  advance(sim, 2);
  const order = sim.state.culture!.orders.find(item => item.id === petition.executionId)!; assert.ok(order);
  for (let attempt = 0; attempt < 6 && order.state !== 'active'; attempt++) advance(sim, 2);
  assert.equal(order.state, 'active', order.lastReason); assert.equal(order.approvedBy.length, 2); assert.ok(order.receivedUnits >= 6);
  sim.setFocus(station(site), 'walk'); return order;
}

export function assertNoPaidCourse(sim: Simulation): void {
  assert.equal(education(sim), undefined, 'this is a public-only classroom, with no paid course or paid history');
  assert.equal(runtime(sim).educationVersion, undefined, 'paid custody must not explain teacher fine processing');
}
export function publicOnly() {
  const context = setup(), order = publicEducation(context); assertNoPaidCourse(context.sim);
  return { ...context, order };
}
export function publicLearner(context: ReturnType<typeof publicOnly>) {
  const { sim, controls, site, teacher } = context;
  const learner = sim.state.citizens.find(person => person.id !== teacher.id && !['老师', 'teacher'].includes(person.role) && person.workId !== site.id && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18);
  assert.ok(learner, 'a separate alive native adult participates in the real public order');
  pin(sim, controls, learner.id, site, station(site)); return learner;
}

export function finitePublicShift(context: ReturnType<typeof setup>) {
  const { sim, controls, teacher } = context, hall = sim.worldDefinition.buildings.find(building => building.kind === 'hall')!;
  assert.equal(education(sim), undefined);
  const reviewers = sim.state.citizens.filter(person => person.role === '官员' && person.workId === hall.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  assert.equal(reviewers.length, 2); for (const person of reviewers) pin(sim, controls, person.id, hall, station(hall), 'work');
  advance(sim, 4); assert.ok(reviewers.every(person => sim.isOnDuty(person.id, hall.id)));
  // Controlled fiscal precondition, then the actual core review computes its
  // native roster, true signatories, rates, cap and assignments. No wage,
  // attendance, role or employment is supplied by this fixture.
  const budget = sim.publicBudgetSnapshot();
  const target = budget.publicWagesDue + budget.publicWagesEarned + budget.authorizedRemaining + budget.essentialOperations + budget.forecastPayroll * 1.5;
  const beforeCash = cash(sim); assert.ok(target <= sim.state.treasury, 'this native fixture has existing public cash to transfer');
  const transferred = sim.state.treasury - target;
  sim.state.treasury -= transferred; sim.state.player.money += transferred;
  close(cash(sim), beforeCash, 'controlled public-cash transfer has an actual named wallet counterparty');
  runtime(sim).publicLaborReviewAt = at(sim); Reflect.get(sim, 'reviewPublicShifts').call(sim);
  const labor = runtime(sim).publicLabor, nextDay = Math.floor(at(sim) / 1440) + 1;
  assert.ok(labor); const shift = labor.shifts.find((item: { day: number }) => item.day === nextDay); assert.ok(shift);
  assert.equal(shift.approvedBy.length, 2); assert.ok(shift.approvedBy.every((id: string) => reviewers.some(person => person.id === id)));
  // Saved-deadline control before education exists, not natural next-day proof.
  sim.state.extension!.lastUpdate += 1440; sim.state.family!.lastUpdate += 1440; sim.state.culture!.lastUpdate += 1440;
  const assignment = shift.assignments.find((item: { citizenId: string }) => item.citizenId === teacher.id);
  assert.ok(assignment); assert.ok(assignment.minutesCap >= 4);
  return { labor, shift, assignment };
}
export function restrictRemainingShift(plan: ReturnType<typeof finitePublicShift>, remaining: number): void {
  const { labor, shift, assignment } = plan, oldCap = assignment.minutesCap;
  assignment.minutesCap = assignment.workedMinutes + remaining; assert.ok(Number.isInteger(assignment.minutesCap));
  shift.cap -= (oldCap - assignment.minutesCap) * assignment.ratePerMinute;
  labor.stats.approvedMinutes -= oldCap - assignment.minutesCap; labor.stats.unfundedMinutes += oldCap - assignment.minutesCap;
  close(shift.cap, shift.assignments.reduce((sum: number, item: { minutesCap: number; ratePerMinute: number }) => sum + item.minutesCap * item.ratePerMinute, 0), 'approved shift cash equals every finite commitment');
}

/** Minimal migration for an old qualification fixture: complete a genuinely
 * funded class with one native teacher, then remove all position controls.
 * Other residents retain their normal behavior. This is a controlled teacher
 * pairing helper, not a claim of naturally completed school commuting. */
export function completePaidCourse(sim: Simulation, site: Building): EducationCourse {
  assert.equal(site.kind, 'school');
  const teacher = sim.state.citizens.find(person => person.workId === site.id && ['老师', 'teacher'].includes(person.role) && sim.state.extension!.actorProfiles[person.id]?.alive && sim.state.extension!.actorProfiles[person.id].age >= 18);
  assert.ok(teacher, 'qualification fixture needs a native registered alive adult teacher');
  const controls: Controls = new Map(), point = site.floorPlanProfile ? station(site) : site.door;
  const originalDestination = Reflect.get(sim, 'setDestination');
  pin(sim, controls, teacher.id, site, point, 'work'); attachControls(sim, controls); sim.setFocus(point, 'walk');
  try {
    const money = sim.state.player.money, current = begin(sim); assert.equal(sim.state.player.money, money - 40);
    for (let tick = 0; course(sim, current.id).status !== 'completed' && tick < 10000; tick++) sim.step(.25);
    const finished = course(sim, current.id);
    assert.equal(finished.status, 'completed', finished.reason); assert.equal(finished.workedMinutes, 60); assert.equal(finished.consumedUnits, 1); ledger(finished);
    return finished;
  } finally {
    controls.clear(); Reflect.set(sim, 'setDestination', originalDestination);
  }
}
