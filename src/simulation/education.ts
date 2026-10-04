import { powerSupplyAt, powerHasCapacityRoom } from './power';
import { validateJointActorActivityCapacity } from './activity-capacity';
import type { Simulation } from '../simulation';
import { canAccessFloor, getFloorDimensions } from '../access';
import { blocksFloorPlanMovement, floorPlanSupport, getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { homeRestPointAt, homeRestPointBlockedByVoxels } from './home-rest';
import { actorActivityAvailable, claimActorActivityMinutes } from './activity-minutes';
import type { Building, BuildingFunctionPoint, Citizen, CommandResult, Player, Role, SimState, Vec3, WorldDefinition } from '../types';
import type { ServiceOrder } from './culture';
import type { FamilyEducationCourse } from './family-education';
import { SCHOOL_MINUTES_PER_LEVEL } from './family';

export interface EducationReceipt { purchasedAt: number; shopId: string; quantity: 1; unitPrice: number; gross: number; net: number; tax: number }
export interface EducationCourse {
  id: string; actorId: 'player'; payerId: 'player'; siteId: string; pointId: string; floor: number; point: Vec3;
  startedAt: number; lastObservedAt: number; requiredMinutes: 60; workedMinutes: number; staffMinutes: Record<string, number>;
  status: 'awaitingSupply' | 'waiting' | 'studying' | 'paused' | 'refundPending' | 'completed' | 'cancelled'; reason: string; resumeRequired: boolean;
  funded: 40; escrow: number; purchasePaid: number; serviceFees: number; refunded: number;
  receivedUnits: number; reusedUnits: number; reservedUnits: number; consumedUnits: number; receipt: EducationReceipt | null;
  retryAt: number; completedAt: number | null; cancelledAt: number | null;
}
export interface EducationStock { receivedUnits: number; consumedUnits: number; availableUnits: number; archivedReceived: number; archivedConsumed: number }
export interface EducationTotals { funded: number; purchasePaid: number; serviceFees: number; refunded: number; workedMinutes: number; completed: number; cancelled: number }
export interface EducationState { version: 1; nextId: number; lastObservedAt: number; course: EducationCourse | null; history: EducationCourse[]; stock: Record<string, EducationStock>; stats: EducationTotals; archived: EducationTotals & { count: number } }
const EPS = 1e-7, FEE = 40, MINUTES = 60, MONEY_LIMIT = 1e9;
const roles = ['老师', 'teacher'];
const clock = (state: SimState) => state.extension!.lastUpdate;
const floorOf = (site: Building, position: Vec3) => Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const identity = (person: Citizen | Player): Pick<Player, 'role' | 'identities'> => {
  if ('identities' in person) return person as Player;
  const role: Role = roles.includes(person.role) ? 'teacher' : ['traveler', 'police', 'soldier', 'driver', 'merchant', 'mayor', 'scientist', 'official', 'council'].includes(person.role) ? person.role as Role : 'traveler';
  return { role, identities: [role] };
};
const zero = (): EducationTotals => ({ funded: 0, purchasePaid: 0, serviceFees: 0, refunded: 0, workedMinutes: 0, completed: 0, cancelled: 0 });
const ended = (course: EducationCourse) => course.status === 'completed' || course.status === 'cancelled';
const schoolPublic = (site: Building, floor: number, person: Pick<Player, 'role' | 'identities'>) => site.kind === 'school' && floor >= 0 && floor < site.floors && (site.floorPermissions?.[floor] ? site.floorPermissions[floor] === 'public' : site.publicFloors === undefined || floor < site.publicFloors) && canAccessFloor(site, floor, person);
/** Marked schools use the same supported public room for work and service.
 * Generated work/service IDs differ; their physical station is identical. */
export function educationServiceStationsAtPosition(site: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>, voxels: readonly { position: Vec3 }[]): BuildingFunctionPoint[] {
  if (!getBuildingBody(site) || ![position.x, position.y, position.z].every(Number.isFinite)) return [];
  const floor = floorOf(site, position);
  if (!schoolPublic(site, floor, person) || homeRestPointBlockedByVoxels(position, voxels)) return [];
  const supported = (at: Vec3) => { const support = floorPlanSupport(site, floor, at, .35); return !!support && support.floor === floor && ['room', 'stairs'].includes(support.kind) && Math.abs(support.y - at.y) <= .26 && !blocksFloorPlanMovement(site, floor, at, at, .35, 1.72) && !homeRestPointBlockedByVoxels(at, voxels); };
  if (!supported(position)) return [];
  return (site.functionPoints ?? getBuildingUsePoints(site, floor)).filter(point => point.purpose === 'service' && point.floor === floor && supported(point.position) && distance(position, point.position) <= 2);
}
export function educationAtPosition(site: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>, voxels: readonly { position: Vec3 }[] = []): boolean {
  if (![position.x, position.y, position.z].every(Number.isFinite) || !schoolPublic(site, floorOf(site, position), person)) return false;
  if (getBuildingBody(site)) return educationServiceStationsAtPosition(site, position, person, voxels).length > 0;
  const floor = floorOf(site, position), size = getFloorDimensions(site, floor), dx = position.x - site.position.x, dz = position.z - site.position.z;
  const x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation);
  return floor === 0 && distance(position, site.door) <= 2 || Math.abs(x) <= size.width / 2 && Math.abs(z) <= size.depth / 2;
}
export function educationPairAtStation(simulation: Simulation, site: Building, teacher: Citizen, actorId: string): boolean {
  const state = simulation.state, person = actorId === 'player' ? state.player : state.citizens.find(person => person.id === actorId);
  if (!person || actorId === teacher.id || !educationAtPosition(site, person.position, identity(person), state.voxels)) return false;
  if (!getBuildingBody(site)) return true;
  const staff = educationServiceStationsAtPosition(site, teacher.position, identity(teacher), state.voxels), student = educationServiceStationsAtPosition(site, person.position, identity(person), state.voxels);
  return staff.some(a => student.some(b => a.floor === b.floor && a.id === b.id && distance(a.position, b.position) < 1e-8));
}
interface WorkInterval { start: number; end: number; siteId?: string }
interface TeachingPhase { state: SimState; tick: number; clock: number; wages: Map<string, WorkInterval[]>; teachers: Map<string, number>; students: Set<string>; studentTeachers: Map<string, string>; blockedPlayer: boolean }
const teaching = new WeakMap<Simulation, TeachingPhase>();
function phase(simulation: Simulation): TeachingPhase {
  let item = teaching.get(simulation);
  if (!item || item.state !== simulation.state || item.tick !== simulation.state.tick) { item = { state: simulation.state, tick: simulation.state.tick, clock: clock(simulation.state), wages: new Map(), teachers: new Map(), students: new Set(), studentTeachers: new Map(), blockedPlayer: false }; teaching.set(simulation, item); }
  return item;
}
function classroomInterval(state: SimState, minutes: number, startedAt = 0): WorkInterval {
  const end = clock(state), dayStart = end - state.hour * 60;
  return { start: Math.max(end - Math.max(0, minutes), dayStart + 8 * 60, startedAt), end: Math.min(end, dayStart + 17 * 60) };
}
export function educationStaffMinutes(simulation: Simulation, teacher: Citizen, siteId: string, phaseMinutes: number, _paid = false, startedAt = 0): number {
  if (!powerSupplyAt(simulation.state, siteId)) return 0;
  const profile = simulation.state.extension!.actorProfiles[teacher.id], intervals = phase(simulation).wages.get(teacher.id), window = classroomInterval(simulation.state, phaseMinutes, startedAt);
  if (teacher.workId !== siteId || !roles.includes(teacher.role) || !profile?.alive || profile.age < 18 || profile.health < 45 || teacher.needs.hunger < 40 || teacher.needs.fatigue < 35 || teacher.state !== 'working') return 0;
  // Core attests the original credited front interval. Clip that interval,
  // rather than borrowing old deferred wages or losing the last funded slice.
  const ranges = (intervals ?? []).filter(item => item.siteId === siteId).map(item => ({ start: Math.max(item.start, window.start), end: Math.min(item.end, window.end) })).filter(item => item.end > item.start).sort((a, b) => a.start - b.start);
  let actual = 0, lastEnd = window.start;
  for (const item of ranges) { actual += Math.max(0, item.end - Math.max(lastEnd, item.start)); lastEnd = Math.max(lastEnd, item.end); }
  return Math.min(phaseMinutes, actual);
}
export function educationSlotAvailable(simulation: Simulation, teacherId: string, actorId: string): boolean { const p = phase(simulation); return !p.students.has(actorId) && (p.teachers.get(teacherId) ?? 0) < 4 && teacherId !== actorId; }
export function takeEducationSlot(simulation: Simulation, teacherId: string, actorId: string): boolean {
  if (!educationSlotAvailable(simulation, teacherId, actorId)) return false;
  const p = phase(simulation); p.teachers.set(teacherId, (p.teachers.get(teacherId) ?? 0) + 1); p.students.add(actorId); p.studentTeachers.set(actorId, teacherId); return true;
}
/** Public tuition earns credentials only after the actual allocator consumed
 * this order's textbook and the current funded, same-station teacher slot.
 * A plain emitted event, attendance tick or saved timer cannot award a degree.
 * Legacy qualifications and attended minutes remain the admission baseline. */
export function applyPublicEducationCredential(simulation: Simulation, order: ServiceOrder, actorId: string): boolean {
  const state = simulation.state, family = state.family, person = state.citizens.find(person => person.id === actorId), profile = state.extension?.actorProfiles[actorId];
  const site = simulation.worldDefinition.buildings.find(site => site.id === order.siteId), teacherId = phase(simulation).studentTeachers.get(actorId), teacher = state.citizens.find(person => person.id === teacherId);
  if (!family || !person || !profile?.alive || profile.age < 6 || !site || !teacher || order.topic !== 'education' || order.state !== 'active'
    || !state.culture?.orders.includes(order) || !order.servedIds.includes(actorId) || (order.serviceMinutes[actorId] ?? 0) < MINUTES - EPS
    || order.consumedUnits < 1 || order.receivedUnits < order.consumedUnits || order.receipts.reduce((sum, receipt) => sum + receipt.quantity, 0) < order.consumedUnits - EPS
    || !order.staffIds.includes(teacher.id) || !educationPairAtStation(simulation, site, teacher, actorId)
    || educationStaffMinutes(simulation, teacher, site.id, .25 * state.speed) <= 0) return false;
  const child = family.children[actorId];
  if (child && child.schoolId !== site.id) return false;
  const existing = family.formalLearning?.[actorId];
  if (existing?.receipts.some(receipt => receipt.orderId === order.id)) return false;
  const record = existing ?? { baselineEducation: person.education ?? 0, baselineAttendanceMinutes: child?.attendanceMinutes ?? 0, earnedMinutes: 0, receipts: [] };
  const minutesPerLevel = child || profile.age < 18 ? SCHOOL_MINUTES_PER_LEVEL : MINUTES;
  const priorSchoolMinutes = (record.receipts.filter(receipt => receipt.minutesPerLevel === SCHOOL_MINUTES_PER_LEVEL).length + (record.tuitionPages?.flat().length ?? 0)) * MINUTES;
  const levels = minutesPerLevel === MINUTES ? 1 : Math.floor((priorSchoolMinutes + MINUTES) / SCHOOL_MINUTES_PER_LEVEL) - Math.floor(priorSchoolMinutes / SCHOOL_MINUTES_PER_LEVEL);
  const educationGain = Math.min(levels, Math.max(0, 20 - (person.education ?? 0)));
  family.formalLearningVersion ??= 1; family.formalLearning ??= {}; family.formalLearning[actorId] = record;
  record.earnedMinutes += MINUTES;
  record.receipts.push({ orderId: order.id, siteId: site.id, teacherId: teacher.id, completedAt: clock(state), minutes: MINUTES, minutesPerLevel, educationGain });
  person.education = (person.education ?? 0) + educationGain;
  if (child) child.attendanceMinutes += MINUTES;
  return true;
}
/** Only the real tuition allocator's terminal course and current teacher
 * slot can create a school certificate. All prior public/private sources share
 * the original 480-minute level boundary; neither route double-awards it. */
export function applyFamilyEducationCredential(simulation: Simulation, course: FamilyEducationCourse): boolean {
  const state = simulation.state, family = state.family, person = state.citizens.find(p => p.id === course.actorId), profile = state.extension?.actorProfiles[course.actorId];
  const teacherId = phase(simulation).studentTeachers.get(course.actorId), teacher = state.citizens.find(p => p.id === teacherId), site = simulation.worldDefinition.buildings.find(b => b.id === course.siteId);
  if (!family || !person || !profile?.alive || profile.age < 6 || profile.age >= 18 || !teacher || !site || !state.familyEducation?.active.includes(course) || course.status !== 'completed' || course.workedMinutes !== MINUTES || course.consumedUnits !== 1 || course.receivedUnits + course.reusedUnits !== 1 || (course.staffMinutes[teacher.id] ?? 0) <= 0 || !educationPairAtStation(simulation, site, teacher, course.actorId) || educationStaffMinutes(simulation, teacher, site.id, .25 * state.speed) <= 0) return false;
  const child = family.children[course.actorId], existing = family.formalLearning?.[course.actorId];
  if (existing?.tuitionPages?.flat().some(receipt => receipt.courseId === course.id)) return false;
  const record = existing ?? { baselineEducation: person.education ?? 0, baselineAttendanceMinutes: child?.attendanceMinutes ?? 0, earnedMinutes: 0, receipts: [] };
  const prior = (record.receipts.filter(receipt => receipt.minutesPerLevel === SCHOOL_MINUTES_PER_LEVEL).length + (record.tuitionPages?.flat().length ?? 0)) * MINUTES;
  const gain = Math.min(Math.floor((prior + MINUTES) / SCHOOL_MINUTES_PER_LEVEL) - Math.floor(prior / SCHOOL_MINUTES_PER_LEVEL), Math.max(0, 20 - (person.education ?? 0)));
  // v1 explicitly accepts an already-held higher legacy qualification. Keep
  // its original baseline and public receipts; activation cannot revoke it or
  // label it as newly earned tuition. Later private records remain exact.
  if (!record.tuitionPages) {
    const carry = (person.education ?? 0) - record.baselineEducation - record.receipts.reduce((sum, receipt) => sum + receipt.educationGain, 0);
    if (carry > EPS) record.legacyEducationCarry = carry;
  }
  family.formalLearningVersion = 2; family.formalLearning ??= {}; family.formalLearning[course.actorId] = record; record.tuitionPages ??= [];
  if (!record.tuitionPages.length || record.tuitionPages[record.tuitionPages.length - 1].length === 8) record.tuitionPages.push([]);
  record.tuitionPages[record.tuitionPages.length - 1].push({ courseId: course.id, siteId: course.siteId, teacherId: teacher.id, completedAt: course.completedAt!, minutes: MINUTES, minutesPerLevel: SCHOOL_MINUTES_PER_LEVEL, educationGain: gain });
  record.earnedMinutes += MINUTES; person.education = (person.education ?? 0) + gain; if (child) child.attendanceMinutes += MINUTES;
  return true;
}
/** Teachers attached to an actual paid/public classroom need fine task
 * processing. Tier labels and all physical speeds remain unchanged. */
export function educationNeedsContinuousPeople(state: SimState, person: Citizen): boolean {
  const course = state.education?.course, profile = state.extension?.actorProfiles[person.id];
  if (!roles.includes(person.role) || !profile?.alive || profile.age < 18) return false;
  return !!course && !ended(course) && course.status !== 'refundPending' && person.workId === course.siteId
    || !!state.culture?.orders.some(order => order.topic === 'education' && order.state === 'active' && order.siteId === person.workId)
    || !!state.familyEducation?.active.some(course => course.cancelledAt === null && course.siteId === person.workId);
}
export function educationOpenMinutes(state: SimState, minutes: number): number { const window = classroomInterval(state, minutes); return Math.max(0, window.end - window.start); }
function courseAt(simulation: Simulation, course: EducationCourse): boolean {
  const site = simulation.worldDefinition.buildings.find(site => site.id === course.siteId)!;
  if (!educationAtPosition(site, simulation.state.player.position, simulation.state.player, simulation.state.voxels)) return false;
  return getBuildingBody(site) ? educationServiceStationsAtPosition(site, simulation.state.player.position, simulation.state.player, simulation.state.voxels).some(point => point.id === course.pointId && point.floor === course.floor && distance(point.position, course.point) < 1e-8) : floorOf(site, simulation.state.player.position) === course.floor;
}
function otherPlayerSession(simulation: Simulation): boolean {
  const state = simulation.state, player = state.player;
  if (!state.extension?.actorProfiles.player.alive || player.vehicleId || state.aviation?.activeAircraftId) return false;
  const atSite = (id: string, purpose?: 'work' | 'service') => {
    const site = simulation.worldDefinition.buildings.find(site => site.id === id);
    return !!site && simulation.isNearBuilding(site, player.position, 2) && canAccessFloor(site, floorOf(site, player.position), player)
      && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site, player.position, purpose));
  };
  const job = state.playerLabor?.job;
  const plannedWork = job ? Math.min(.25 * state.speed, job.requiredMinutes - job.workedMinutes) * job.ratePerMinute * (1 - state.taxRate) : 0;
  if (job && ['working', 'paused'].includes(job.status) && job.workedMinutes < job.requiredMinutes && job.escrow > 0 && simulation.hasIdentity(job.role) && state.hour >= 6 && state.hour < 21 && player.needs.hunger >= 12 && player.needs.fatigue >= 15 && player.money + plannedWork <= MONEY_LIMIT && atSite(job.siteId, 'work')) return true;
  const rest = state.homeRest?.session, home = rest && simulation.worldDefinition.buildings.find(site => site.id === rest.buildingId);
  if (rest?.state === 'active' && home && player.homeId === home.id && homeRestPointAt(home, player.position, player, rest.pointId) && !homeRestPointBlockedByVoxels(player.position, state.voxels)) return true;
  const project = state.culture?.project;
  if (project && project.workedMinutes < project.requiredMinutes && state.hour >= 7 && state.hour < 22 && player.needs.hunger >= 40 && player.needs.fatigue >= 40 && atSite(project.siteId)) return true;
  // A stale service pointer or an order at another site is not activity.
  const service = state.culture?.orders.find(order => order.id === state.culture?.playerServiceId);
  // Public education already runs first and claims exact learner minutes plus
  // the shared teacher slot. Predicting it here would create a second lock.
  const staffRoles = service?.topic === 'health' ? ['医生', 'doctor'] : ['驾驶员', 'driver', '工程师'];
  if (service && service.topic !== 'education' && service.state === 'active' && !service.servedIds.includes('player') && service.receivedUnits - service.consumedUnits >= 1 && state.hour >= 8 && state.hour < 17 && player.needs.hunger >= 40 && player.needs.fatigue >= 35 && atSite(service.siteId, 'service') && state.citizens.some(person => staffRoles.includes(person.role) && simulation.isOnDuty(person.id, service.siteId) && person.needs.hunger >= 40 && person.needs.fatigue >= 35 && state.extension!.actorProfiles[person.id]?.health >= 45)) return true;
  // Clinic/home activities need their actual own site. Distinct school sites
  // cannot be blocked by a paused-away treatment/rest record.
  return !!state.clinical?.orders.some(order => order.patientId === 'player' && !['completed', 'cancelled', 'refundPending'].includes(order.state) && order.reservedUnits >= 1 && state.hour >= 8 && state.hour < 17 && state.extension!.actorProfiles.player.health < 100 && player.needs.hunger >= 20 && player.needs.fatigue >= 15 && atSite(order.siteId, 'service') && state.citizens.some(doctor => doctor.workId === order.siteId && ['医生', 'doctor'].includes(doctor.role) && simulation.isOnDuty(doctor.id, order.siteId)));
}
function eligibleCourseMinutes(simulation: Simulation, minutes: number): number {
  const state = simulation.state, course = state.education?.course;
  if (!course || ended(course) || course.status === 'refundPending' || course.resumeRequired || course.reservedUnits < 1 - EPS || !state.extension!.actorProfiles.player.alive || phase(simulation).blockedPlayer || otherPlayerSession(simulation) || state.player.vehicleId || state.aviation?.activeAircraftId || state.player.needs.hunger < 40 || state.player.needs.fatigue < 35 || state.player.education >= 1e8 || state.player.experience >= 1e8 || !courseAt(simulation, course)) return 0;
  const site = simulation.worldDefinition.buildings.find(site => site.id === course.siteId)!, available = Math.min(educationOpenMinutes(state, minutes), MINUTES - course.workedMinutes);
  return Math.max(0, ...state.citizens.filter(teacher => educationPairAtStation(simulation, site, teacher, 'player') && educationSlotAvailable(simulation, teacher.id, 'player')).map(teacher => Math.min(available, educationStaffMinutes(simulation, teacher, site.id, minutes, true, course.startedAt))));
}
function stock(state: SimState, siteId: string): EducationStock { return state.education!.stock[siteId] ??= { receivedUnits: 0, consumedUnits: 0, availableUnits: 0, archivedReceived: 0, archivedConsumed: 0 }; }
function ledger(simulation: Simulation, course: EducationCourse, amount: number, purpose: string, account: 'household' | 'public'): void {
  const state = simulation.state, districtId = simulation.worldDefinition.buildings.find(site => site.id === course.siteId)!.districtId;
  state.extension!.publicLedger.push({ tick: state.tick, actorId: 'player', amount, purpose, account, districtId });
  if (state.extension!.publicLedger.length > 512) state.extension!.publicLedger.splice(0, state.extension!.publicLedger.length - 512);
}
function archive(simulation: Simulation, course: EducationCourse): void {
  const e = simulation.state.education!;
  if (simulation.state.power) simulation.emitEvent({ type: 'education-ended-work', citizenId: course.actorId, siteId: course.siteId, minutes: course.workedMinutes });
  e.history.push(course); e.course = null;
  if (e.history.length > 64) {
    const old = e.history.shift()!, s = stock(simulation.state, old.siteId); e.archived.count++;
    for (const key of ['funded', 'purchasePaid', 'serviceFees', 'refunded', 'workedMinutes'] as const) e.archived[key] += old[key];
    e.archived.completed += Number(old.status === 'completed'); e.archived.cancelled += Number(old.status === 'cancelled'); s.archivedReceived += old.receivedUnits; s.archivedConsumed += old.consumedUnits;
  }
}
function stop(simulation: Simulation, course: EducationCourse): void {
  const state = simulation.state, e = state.education!;
  if (course.cancelledAt === null) { course.cancelledAt = clock(state); e.stats.cancelled++; stock(state, course.siteId).availableUnits += course.reservedUnits; course.reservedUnits = 0; }
  const amount = Math.min(course.escrow, Math.max(0, MONEY_LIMIT - state.player.money));
  if (amount > 0) { state.player.money += amount; course.escrow -= amount; course.refunded += amount; e.stats.refunded += amount; ledger(simulation, course, amount, '学堂未赚课程托管款退款', 'household'); }
  course.status = course.escrow > 0 ? 'refundPending' : 'cancelled'; course.resumeRequired = false;
  course.reason = course.status === 'refundPending' ? '课程已停止；钱包容量不足，未赚款继续由原课程托管。' : '课程已取消；已赚分钟仅保留在历史，未赚款已退款，已购物料留在学校。';
  if (course.status === 'cancelled') { course.escrow = 0; archive(simulation, course); }
}
export function installEducation(simulation: Simulation): void {
  const world = simulation.worldDefinition;
  // No empty education state or marker is added on construction/load. Exact
  // course-free continuation is based on new/already migrated S1 saves.
  simulation.onPhase('time', () => { phase(simulation).blockedPlayer = otherPlayerSession(simulation); });
  simulation.onEvent('wage-earned', event => {
    if (event.citizenId === 'player') {
      const job = simulation.state.playerLabor?.job, phaseMinutes = Reflect.get(simulation, 'minutes');
      if (job?.status === 'working' && Number.isFinite(event.minutes) && event.minutes! > 0 && Number.isFinite(event.amount) && event.amount! >= 0 && event.ratePerMinute === job.ratePerMinute && (event.shopId ?? null) === job.employer.shopId && Math.abs(event.amount! - event.minutes! * job.ratePerMinute) <= EPS && Number.isFinite(phaseMinutes) && phaseMinutes > 0) claimActorActivityMinutes(simulation, 'player', `paid-work:${job.id}`, event.minutes!, phaseMinutes);
      return;
    }
    const worker = event.citizenId && simulation.state.citizens.find(person => person.id === event.citizenId);
    const p = phase(simulation);
    if (worker && p.tick === simulation.state.tick && p.clock === clock(simulation.state) && event.siteId === worker.workId && Number.isFinite(event.minutes) && event.minutes! > 0 && Number.isFinite(event.amount) && event.amount! >= 0 && Number.isFinite(event.creditedWorkStartAt) && event.creditedWorkStartAt! >= 0 && Number.isFinite(event.creditedWorkEndAt) && event.creditedWorkEndAt! <= p.clock + EPS && event.creditedWorkEndAt! > event.creditedWorkStartAt! && Math.abs(event.creditedWorkEndAt! - event.creditedWorkStartAt! - event.minutes!) <= EPS) {
      const intervals = p.wages.get(worker.id) ?? [];
      intervals.push({ start: event.creditedWorkStartAt!, end: event.creditedWorkEndAt!, siteId: event.siteId }); p.wages.set(worker.id, intervals);
    }
  });
  simulation.registerCommandHandler(command => {
    if (command.type !== 'cancelStudy' && !(command.type === 'exam' && command.targetId === 'study')) return null;
    const state = simulation.state, current = state.education?.course;
    const fail = (message: string): CommandResult => ({ ok: false, message });
    if (command.type === 'cancelStudy') {
      if (!current || current.cancelledAt !== null || command.targetId && command.targetId !== current.id) return fail('当前没有可取消的课程。');
      stop(simulation, current); return { ok: true, message: current.reason };
    }
    if (current) {
      if (current.status === 'refundPending') return fail('原课程未赚退款尚未清结，不能再承诺课程。');
      if (!courseAt(simulation, current)) return fail('请回到原课程的公共课堂站点继续。');
      if (otherPlayerSession(simulation)) return fail('当前正在原场所劳动、休息或服务，请先结束，再继续原课程。');
      if (state.player.vehicleId || state.aviation?.activeAircraftId || state.player.needs.hunger < 40 || state.player.needs.fatigue < 35) return fail('请保持食物与体力、下车后继续原课程。');
      current.resumeRequired = false; current.status = current.reservedUnits ? 'waiting' : 'awaitingSupply'; current.reason = '已继续原课程；等待实际教师与教材，不再收费。'; current.lastObservedAt = clock(state);
      return { ok: true, message: current.reason };
    }
    const site = world.buildings.filter(site => simulation.isNearBuilding(site) && educationAtPosition(site, state.player.position, state.player, state.voxels)).sort((a, b) => distance(a.door, state.player.position) - distance(b.door, state.player.position))[0];
    if (!site) return fail('请到学堂可访问公共课堂的实际服务点学习。');
    if (state.player.money < FEE) return fail('学习费用需要40云币。');
    if (state.player.education >= 1e8 || state.player.experience >= 1e8) return fail('教育或经验记录已达容量，不能再承诺课程。');
    if (state.player.vehicleId || state.aviation?.activeAircraftId || state.player.needs.hunger < 40 || state.player.needs.fatigue < 35 || state.hour < 8 || state.hour >= 17) return fail('请在8至17点保持食物与体力、下车后开始课程。');
    if (!state.citizens.some(teacher => teacher.workId === site.id && roles.includes(teacher.role) && state.extension!.actorProfiles[teacher.id]?.alive && state.extension!.actorProfiles[teacher.id].age >= 18)) return fail('学校没有在册成年教师，不能承诺课程。');
    if (otherPlayerSession(simulation)) return fail('当前正在原场所劳动、休息或服务，请先结束，再报名课程。');
    if (!powerHasCapacityRoom(state)) return fail('仍有交叉劳动强引用，见证档案容量不足；未扣课程款。');
    if (state.education && state.education.nextId >= 1e9) return fail('课程记录编号已达容量，请保留当前记录。');
    const e = state.education ??= { version: 1, nextId: 1, lastObservedAt: clock(state), course: null, history: [], stock: {}, stats: zero(), archived: { ...zero(), count: 0 } };
    Reflect.set(Reflect.get(simulation, 'runtime'), 'educationVersion', 1);
    const point = educationServiceStationsAtPosition(site, state.player.position, state.player, state.voxels)[0], floor = floorOf(site, state.player.position), s = stock(state, site.id), reuse = Math.min(1, s.availableUnits);
    const course: EducationCourse = { id: `course-${e.nextId++}`, actorId: 'player', payerId: 'player', siteId: site.id, pointId: point?.id ?? `legacy:${floor}`, point: { ...(point?.position ?? state.player.position) }, floor, startedAt: clock(state), lastObservedAt: clock(state), requiredMinutes: MINUTES, workedMinutes: 0, staffMinutes: {}, status: reuse ? 'waiting' : 'awaitingSupply', reason: '40文已进入课程托管；真实教师、教材和60有效分钟共同完成才提高学历。', resumeRequired: false, funded: FEE, escrow: FEE, purchasePaid: 0, serviceFees: 0, refunded: 0, receivedUnits: 0, reusedUnits: reuse, reservedUnits: reuse, consumedUnits: 0, receipt: null, retryAt: clock(state), completedAt: null, cancelledAt: null };
    state.player.money -= FEE; s.availableUnits -= reuse; e.course = course; e.stats.funded += FEE; e.lastObservedAt = clock(state); ledger(simulation, course, -FEE, '学堂40文课程费进入真实托管', 'household');
    return { ok: true, message: course.reason };
  });
  simulation.onPhase('people', (state, minutes) => {
    const e = state.education; if (!e) return;
    const course = e.course; e.lastObservedAt = clock(state); if (!course) return;
    const elapsed = Math.min(minutes, Math.max(0, clock(state) - course.lastObservedAt)); course.lastObservedAt = clock(state);
    if (course.cancelledAt !== null || !state.extension!.actorProfiles.player.alive) { stop(simulation, course); return; }
    if (!courseAt(simulation, course) || state.player.vehicleId || state.aviation?.activeAircraftId) { course.status = 'paused'; course.resumeRequired = true; course.reason = '离开原课堂，已赚分钟保留；回到原点须显式继续。'; return; }
    if (course.resumeRequired) return;
    const available = Math.min(elapsed, eligibleCourseMinutes(simulation, elapsed), actorActivityAvailable(simulation, 'player', minutes));
    if (available <= 0) { course.status = course.reservedUnits ? 'waiting' : 'awaitingSupply'; course.reason = '等候教材、营业时间、身体条件及同课堂教师的真实出勤；当前不累积分钟。'; return; }
    const site = world.buildings.find(site => site.id === course.siteId)!, teacher = state.citizens.find(teacher => educationStaffMinutes(simulation, teacher, site.id, elapsed, true, course.startedAt) >= available - EPS && educationPairAtStation(simulation, site, teacher, 'player') && educationSlotAvailable(simulation, teacher.id, 'player'))!;
    const worked = Math.min(MINUTES, course.workedMinutes + available), earned = (FEE - course.purchasePaid) * worked / MINUTES, payment = earned - course.serviceFees;
    if (state.treasury + payment > MONEY_LIMIT) { course.status = 'waiting'; course.reason = '公库收款容量已满，未赚服务款保留托管。'; return; }
    const credited = claimActorActivityMinutes(simulation, 'player', course.id, available, minutes);
    if (credited !== available || !takeEducationSlot(simulation, teacher.id, 'player')) return;
    course.workedMinutes = worked; course.staffMinutes[teacher.id] = (course.staffMinutes[teacher.id] ?? 0) + credited; course.serviceFees = earned; course.escrow -= payment; state.treasury += payment;
    Reflect.get(state.extension!, 'runtime').lastTreasury += payment; e.stats.workedMinutes += credited; e.stats.serviceFees += payment; ledger(simulation, course, payment, '学堂现场已赚课程服务费', 'public');
    course.status = 'studying'; course.reason = `真实教师共同授课${worked.toFixed(1)}/60分钟。`;
    if (worked < MINUTES) return;
    course.workedMinutes = MINUTES; course.escrow = 0; course.reservedUnits--; course.consumedUnits++; stock(state, site.id).consumedUnits++;
    state.player.education++; state.player.experience++; course.status = 'completed'; course.completedAt = clock(state); course.reason = '完成学堂课程：60有效分钟与1份真实教材，教育与经验各提升1。'; e.stats.completed++;
    simulation.appendNotice('study', course.reason, site.districtId); simulation.emitEvent({ type: 'education-completed', citizenId: 'player', siteId: site.id, minutes: MINUTES, amount: course.serviceFees, quantity: 1 }); archive(simulation, course);
  });
  simulation.onPhase('finance', state => {
    const e = state.education, course = e?.course; if (!e || !course) return;
    if (course.cancelledAt !== null || !state.extension!.actorProfiles.player.alive) { stop(simulation, course); return; }
    if (course.reservedUnits >= 1 - EPS || clock(state) < course.retryAt - EPS) return;
    course.retryAt = clock(state) + 60; const s = stock(state, course.siteId);
    if (s.availableUnits >= 1 - EPS) { s.availableUnits--; course.reusedUnits++; course.reservedUnits++; course.status = 'waiting'; return; }
    const site = world.buildings.find(site => site.id === course.siteId)!;
    const sources = state.shops.filter(shop => simulation.shopCommodity(shop) === 'materials' && shop.inventory >= 1).map(shop => ({ shop, quote: simulation.quoteSupply(shop.id, 1) })).sort((a, b) => Number(b.shop.districtId === site.districtId) - Number(a.shop.districtId === site.districtId) || a.quote.unitPrice - b.quote.unitPrice || a.shop.id.localeCompare(b.shop.id));
    const source = sources.find(({ shop, quote }) => quote.quantity >= 1 && quote.unitPrice > 0 && quote.unitPrice <= course.escrow && simulation.shopFunds(shop) + quote.unitPrice * (1 - state.taxRate) <= MONEY_LIMIT);
    if (!source) { course.reason = '真实教材库存、可付报价或供应商收款容量不足，托管保留。'; return; }
    const gross = source.quote.unitPrice, net = gross * (1 - state.taxRate), tax = gross - net;
    source.shop.inventory--; simulation.transferShopFunds(source.shop, net); source.shop.revenue += gross; source.shop.profit += net; course.escrow -= gross; course.purchasePaid += gross; e.stats.purchasePaid += gross; course.receivedUnits++; course.reservedUnits++; s.receivedUnits++;
    course.receipt = { purchasedAt: clock(state), shopId: source.shop.id, quantity: 1, unitPrice: gross, gross, net, tax }; course.status = 'waiting';
    simulation.emitEvent({ type: 'wholesale', shopId: source.shop.id, districtId: source.shop.districtId, amount: gross, quantity: 1, unitPrice: gross, siteId: site.id, procurementId: `${course.id}:textbook`, purpose: 'education-material' });
  });
  simulation.registerSaveValidator(candidate => validateEducationState(candidate, world));
}

export function validateEducationState(state: SimState, world: WorldDefinition): void {
  const e = state.education; if (e === undefined) return;
  const ensure = (value: unknown, label: string) => { if (!value) throw new Error(`教育存档无效：${label}`); };
  const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
  const num = (value: unknown, min: number, max: number, label: string, integer = false): void => ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const close = (a: number, b: number, label: string) => ensure(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(EPS, Math.max(a, b) * 1e-10), label);
  const sites = new Map(world.buildings.map(site => [site.id, site])), actors = new Set(state.citizens.map(person => person.id)), shops = new Map(state.shops.map(shop => [shop.id, shop]));
  ensure(object(e) && e.version === 1 && state.extension, '版本'); num(e.nextId, 1, 1e9, '编号', true); num(e.lastObservedAt, 0, clock(state), '观察时间');
  ensure(Array.isArray(e.history) && e.history.length <= 64 && (e.course === null || object(e.course)), '历史与当前'); ensure(object(e.stock) && Object.keys(e.stock).length <= world.buildings.length, '库存');
  const ids = new Set<string>(), materials = new Map<string, { received: number; consumed: number; reserved: number }>(), totals = zero();
  for (const course of [...e.history, ...(e.course ? [e.course] : [])]) {
    const site = sites.get(course.siteId);
    ensure(object(course) && /^course-[1-9][0-9]*$/.test(course.id) && Number(course.id.slice(7)) < e.nextId && !ids.has(course.id) && course.actorId === 'player' && course.payerId === 'player' && site?.kind === 'school', '课程身份'); ids.add(course.id);
    num(course.floor, 0, site!.floors - 1, '楼层', true); ensure(object(course.point) && [course.point.x, course.point.y, course.point.z].every(Number.isFinite), '课堂点');
    if (getBuildingBody(site!)) ensure((site!.functionPoints ?? getBuildingUsePoints(site!, course.floor)).some(point => point.id === course.pointId && point.purpose === 'service' && point.floor === course.floor && distance(point.position, course.point) < 1e-8), '真实原课堂'); else ensure(course.pointId === `legacy:${course.floor}`, '旧课堂');
    num(course.startedAt, 0, clock(state), '起始'); num(course.lastObservedAt, course.startedAt, clock(state), '观察'); ensure(course.requiredMinutes === MINUTES && course.funded === FEE, '原费用与时数'); num(course.workedMinutes, 0, MINUTES, '已赚分钟'); ensure(course.workedMinutes <= course.lastObservedAt - course.startedAt + EPS, '分钟不能超过经过时间');
    ensure(['awaitingSupply', 'waiting', 'studying', 'paused', 'refundPending', 'completed', 'cancelled'].includes(course.status) && typeof course.resumeRequired === 'boolean' && typeof course.reason === 'string' && course.reason.length <= 1000, '状态');
    for (const key of ['escrow', 'purchasePaid', 'serviceFees', 'refunded'] as const) num(course[key], 0, FEE, key);
    close(course.funded, course.escrow + course.purchasePaid + course.serviceFees + course.refunded, '托管资金守恒'); close(course.serviceFees, (FEE - course.purchasePaid) * course.workedMinutes / MINUTES, '有效授课已赚服务费');
    ensure(object(course.staffMinutes) && Object.keys(course.staffMinutes).length <= state.citizens.length, '具名教师'); let staffMinutes = 0;
    for (const [id, minutes] of Object.entries(course.staffMinutes)) { ensure(actors.has(id), '教师引用'); num(minutes, 0, MINUTES, '教师时数'); staffMinutes += minutes; } close(staffMinutes, course.workedMinutes, '教师共同分钟');
    for (const key of ['receivedUnits', 'reusedUnits', 'reservedUnits', 'consumedUnits'] as const) num(course[key], 0, 1, key, true);
    ensure(course.receivedUnits + course.reusedUnits <= 1 && course.reservedUnits + course.consumedUnits <= course.receivedUnits + course.reusedUnits, '一份材料');
    if (course.receipt === null) ensure(course.receivedUnits === 0 && course.purchasePaid === 0, '无回执无采购'); else { const r = course.receipt; ensure(object(r) && sites.get(shops.get(r.shopId)?.buildingId ?? '')?.kind === 'workshop' && r.quantity === 1 && course.receivedUnits === 1, '真实工业教材供应商回执'); num(r.purchasedAt, course.startedAt, course.lastObservedAt, '采购时间'); num(r.gross, EPS, FEE, '采购gross'); num(r.unitPrice, EPS, FEE, '报价'); close(r.gross, r.unitPrice, '实价'); close(r.gross, course.purchasePaid, '实付'); num(r.net, 0, r.gross, '供应商收款'); num(r.tax, 0, r.gross, '税'); close(r.gross, r.net + r.tax, '采购收税守恒'); }
    ensure(!course.workedMinutes || course.receivedUnits + course.reusedUnits === 1, '有教材才有时数'); num(course.retryAt, course.startedAt, 1e12, '采购重试');
    if (course === e.course) ensure(!ended(course) && course.completedAt === null, '当前不能已完成'); else ensure(ended(course) && course.escrow === 0, '历史已清结');
    if (course.status === 'completed') { num(course.completedAt, course.startedAt + MINUTES, clock(state), '完成时间'); ensure(course.cancelledAt === null && course.workedMinutes === MINUTES && course.consumedUnits === 1 && course.reservedUnits === 0 && course.refunded === 0 && !course.resumeRequired, '完成只发生一次'); }
    else if (['cancelled', 'refundPending'].includes(course.status)) { num(course.cancelledAt, course.startedAt, clock(state), '取消'); ensure(course.completedAt === null && course.reservedUnits === 0 && course.consumedUnits === 0 && course.workedMinutes < MINUTES && (course.status === 'refundPending' ? course.escrow > 0 : course.escrow === 0), '停止后不可继续'); }
    else ensure(course.cancelledAt === null && course.completedAt === null && course.workedMinutes < MINUTES && course.refunded === 0 && course.reservedUnits + course.consumedUnits === course.receivedUnits + course.reusedUnits, '未完成');
    const m = materials.get(course.siteId) ?? { received: 0, consumed: 0, reserved: 0 }; m.received += course.receivedUnits; m.consumed += course.consumedUnits; m.reserved += course.reservedUnits; materials.set(course.siteId, m);
    for (const key of ['funded', 'purchasePaid', 'serviceFees', 'refunded', 'workedMinutes'] as const) totals[key] += course[key]; totals.completed += Number(course.status === 'completed'); totals.cancelled += Number(course.cancelledAt !== null);
  }
  ensure(object(e.stats) && object(e.archived), '统计'); num(e.archived.count, 0, e.nextId - 1, '归档数', true);
  ensure(e.archived.count + e.history.length + Number(e.course !== null) === e.nextId - 1, '所有课程记录均有来源');
  for (const key of Object.keys(totals) as (keyof EducationTotals)[]) { const integer = key === 'completed' || key === 'cancelled'; num(e.stats[key], 0, 1e12, '总账', integer); num(e.archived[key], 0, e.stats[key], '历史总账', integer); close(e.stats[key], totals[key] + e.archived[key], '统计来自课程'); }
  close(e.archived.funded, e.archived.count * FEE, '归档原课程款'); close(e.archived.funded, e.archived.purchasePaid + e.archived.serviceFees + e.archived.refunded, '归档已清结资金');
  ensure(e.archived.completed + e.archived.cancelled === e.archived.count && e.archived.workedMinutes >= e.archived.completed * MINUTES && e.archived.workedMinutes <= e.archived.count * MINUTES, '归档终态与分钟');
  const orderedCourses = [...e.history, ...(e.course ? [e.course] : [])];
  orderedCourses.forEach((course, index) => {
    ensure(course.id === `course-${e.archived.count + index + 1}`, '原顺序课程编号');
    if (index === 0) return;
    const previous = orderedCourses[index - 1];
    // Only one paid course can remain current. A later admission must follow
    // the previous observed/terminal clearing, including delayed refunds.
    // Archived aggregates have no retained timestamps and are not invented.
    const clearedAt = Math.max(previous.lastObservedAt, previous.completedAt ?? 0, previous.cancelledAt ?? 0);
    ensure(course.startedAt + EPS >= clearedAt, '后一课程须在前课程观察及终结清结后开始');
  });
  ensure(e.stats.completed + e.stats.cancelled + (e.course && e.course.cancelledAt === null ? 1 : 0) === e.nextId - 1, '每笔课程只有一种完成归属');
  let received = 0, consumed = 0;
  for (const [id, s] of Object.entries(e.stock)) { ensure(sites.get(id)?.kind === 'school' && object(s), '学校库存'); for (const key of ['receivedUnits', 'consumedUnits', 'availableUnits', 'archivedReceived', 'archivedConsumed'] as const) num(s[key], 0, 1e12, '实物数量', true); const m = materials.get(id) ?? { received: 0, consumed: 0, reserved: 0 }; close(s.receivedUnits, m.received + s.archivedReceived, '采购来源'); close(s.consumedUnits, m.consumed + s.archivedConsumed, '消耗来源'); close(s.receivedUnits, s.consumedUnits + s.availableUnits + m.reserved, '材料守恒'); received += s.archivedReceived; consumed += s.archivedConsumed; materials.delete(id); }
  ensure(materials.size === 0 && received <= e.archived.count && consumed === e.archived.completed, '归档来源');
  if (state.power) { validateJointActorActivityCapacity(state); return; }
  // Only explicit new records contribute a necessary saved-time bound. Old
  // public education, grandfather research and archived aggregate statistics
  // have no compatible attended intervals and receive no invented labor.
  const attended: { startedAt: number; workedMinutes: number }[] = [...e.history, ...(e.course ? [e.course] : [])];
  const research = Reflect.get(state.extension!, 'runtime')?.researchJobs;
  for (const job of Object.values(research ?? {}) as { laborVersion?: number; actorId?: string; startedAt: number; workedMinutes: number }[]) {
    if (job.laborVersion === 1 && job.actorId === 'player') attended.push(job);
  }
  for (const cutoff of new Set(attended.map(item => item.startedAt))) {
    const worked = attended.filter(item => item.startedAt >= cutoff).reduce((sum, item) => sum + item.workedMinutes, 0);
    ensure(worked <= clock(state) - cutoff + EPS, '玩家课程与标记科研共同起始后缀分钟容量');
  }
}
