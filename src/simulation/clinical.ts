import { isCanonicalClinicalPresence, isCanonicalNpcWage, type Simulation } from '../simulation';
import { canAccessFloor, getFloorDimensions } from '../access';
import { floorPlanSupport, getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { homeRestPointAt, homeRestPointBlockedByVoxels } from './home-rest';
import { actorActivityAvailable, claimActorActivityMinutes } from './activity-minutes';
import { gridBuildingSupplyRatio } from './power-grid';
import { PAID_CLINICAL_TRIAGE_POLICY, paidClinicalTriageOrders, type PaidClinicalTriageSelection } from './clinical-paid-triage';
import type { Building, BuildingFunctionPoint, Citizen, CommandResult, Player, Role, SimState, Vec3, WorldDefinition } from '../types';

export interface ClinicalReceipt { commodity: 'materials'; procurementId: string; purchasedAt: number; paid: number; quantity: number; tax: number; lots: { shopId: string; quantity: number; unitPrice: number; gross: number; net: number }[] }
export interface ClinicalOrder {
  timingVersion?: 2;
  id: string; patientId: string; payerId: string; siteId: string; startedAt: number;
  state: 'awaitingSupply' | 'awaitingDoctor' | 'inTreatment' | 'refundPending' | 'completed' | 'cancelled';
  funded: number; escrow: number; purchasePaid: number; serviceFee: number; refunded: number;
  receivedUnits: number; reusedUnits: number; reservedUnits: number; consumedUnits: number;
  workedMinutes: number; requiredMinutes: 20; staffMinutes: Record<string, number>; receipts: ClinicalReceipt[];
  completedAt: number | null; cancelledAt: number | null; retryAt: number; lastReason: string;
}
export interface ClinicStock { receivedUnits: number; consumedUnits: number; availableUnits: number; archivedPurchasedUnits: number; archivedConsumedUnits: number }
export interface ClinicalTotals { funded: number; purchasePaid: number; serviceFees: number; refunded: number; completed: number; cancelled: number }
export interface ClinicalState {
  version: 1 | 2; paidTriage?: PaidClinicalTriageSelection;
  nextOrderId: number; orders: ClinicalOrder[]; stock: Record<string, ClinicStock>; nextVisitAt: Record<string, number>;
  stats: ClinicalTotals; archived: ClinicalTotals & { count: number };
}
const EPS = 1e-7, LIMIT = 256, FEE = 30, MINUTES = 20, MONEY_LIMIT = 1e9;
const zeroTotals = (): ClinicalTotals => ({ funded: 0, purchasePaid: 0, serviceFees: 0, refunded: 0, completed: 0, cancelled: 0 });
const initialize = (): ClinicalState => ({ version: 1, nextOrderId: 1, orders: [], stock: {}, nextVisitAt: {}, stats: zeroTotals(), archived: { ...zeroTotals(), count: 0 } });
const clock = (s: SimState) => s.extension!.lastUpdate;
const profile = (s: SimState, id: string) => s.extension!.actorProfiles[id];
/** Old paid/NPC healing timers remain binding when a pre-clinical save migrates. */
export function clinicalVisitDeadline(s: SimState, patientId: string): number {
  const runtime = Reflect.get(s.extension!, 'runtime') as { cooldowns?: Record<string, number> };
  return Math.max(s.clinical?.nextVisitAt[patientId] ?? 0, runtime.cooldowns?.[`heal:${patientId}`] ?? 0);
}
export function clinicalHealthGain(s: SimState): number { return 25 + s.extension!.technologies.find(technology => technology.sector === 'medicine')!.level; }
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const terminal = (order: ClinicalOrder) => order.state === 'completed' || order.state === 'cancelled';
const actorCache = new WeakMap<SimState, { citizens: Citizen[]; length: number; actors: Map<string, { person: Citizen; index: number }> }>();
function actor(s: SimState, id: string): Citizen | Player | undefined {
  if (id === 'player') return s.player;
  let cached = actorCache.get(s);
  const known = cached?.actors.get(id);
  if (!cached || cached.citizens !== s.citizens || cached.length !== s.citizens.length || known && (s.citizens[known.index] !== known.person || known.person.id !== id)) {
    cached = { citizens: s.citizens, length: s.citizens.length, actors: new Map(s.citizens.map((person, index) => [person.id, { person, index }])) }; actorCache.set(s, cached);
  }
  return cached.actors.get(id)?.person;
}
const roleOf = (person: Citizen | Player): Role => (['traveler', 'police', 'soldier', 'teacher', 'driver', 'merchant', 'mayor', 'scientist', 'official', 'council'].includes(person.role) ? person.role : 'traveler') as Role;
export function clinicalPublicFloor(site: Building, level: number, person: Pick<Player, 'role' | 'identities'>): boolean {
  return site.kind === 'clinic' && level >= 0 && level < site.floors && (site.floorPermissions?.[level] ? site.floorPermissions[level] === 'public' : site.publicFloors === undefined || level < site.publicFloors) && canAccessFloor(site, level, person);
}
const servicePoints = (site: Building, floor: number) => (site.functionPoints ?? getBuildingUsePoints(site, floor)).filter(point => point.floor === floor && point.purpose === 'service');
/** Live marked-clinic station eligibility is shared by routing and treatment.
 * Both the actor's standing body and the real public station must be supported
 * and free of placed cubes. The two-metre station radius is unchanged. */
export function clinicalServiceStationsAtPosition(site: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>, voxels: readonly { position: Vec3 }[]): BuildingFunctionPoint[] {
  if (!getBuildingBody(site) || ![position.x, position.y, position.z].every(Number.isFinite)) return [];
  const level = Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)));
  if (!clinicalPublicFloor(site, level, person) || homeRestPointBlockedByVoxels(position, voxels)) return [];
  const support = floorPlanSupport(site, level, position, .35);
  if (!support || support.floor !== level || !['room', 'stairs'].includes(support.kind)) return [];
  return servicePoints(site, level).filter(point => {
    const stationSupport = floorPlanSupport(site, level, point.position, .35);
    return clinicalPublicFloor(site, point.floor, person) && !!stationSupport && stationSupport.floor === level && ['room', 'stairs'].includes(stationSupport.kind) &&
      !homeRestPointBlockedByVoxels(point.position, voxels) && Math.hypot(point.position.x - position.x, point.position.y - position.y, point.position.z - position.z) <= 2;
  });
}
/** UI and rules share the same rotated floor footprint and two-metre doorway. */
export function clinicalAtPosition(site: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>): boolean {
  if (![position.x, position.y, position.z].every(Number.isFinite)) return false;
  const level = Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)));
  if (!clinicalPublicFloor(site, level, person)) return false;
  if (getBuildingBody(site)) {
    const support = floorPlanSupport(site, level, position);
    return !!support && (support.kind === 'room' || support.kind === 'stairs') &&
      servicePoints(site, level).some(point => Math.hypot(point.position.x - position.x, point.position.y - position.y, point.position.z - position.z) <= 2);
  }
  if (level === 0 && Math.hypot(position.x - site.door.x, position.y - site.door.y, position.z - site.door.z) <= 2) return true;
  const dx = position.x - site.position.x, dz = position.z - site.position.z, x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation), size = getFloorDimensions(site, level);
  return Math.abs(x) <= size.width / 2 && Math.abs(z) <= size.depth / 2 && position.y >= site.position.y - .5 && position.y <= site.position.y + site.height + .5;
}
/** All treatment uses public clinical floors, including NPC patients and staff. */
export function clinicalAtSite(simulation: Simulation, site: Building, actorId = 'player'): boolean {
  const person = actor(simulation.state, actorId); if (!person || site.kind !== 'clinic' || !simulation.isNearBuilding(site, person.position, 2)) return false;
  return clinicalAtPosition(site, person.position, actorId === 'player' ? simulation.state.player : { role: roleOf(person), identities: [roleOf(person)] });
}
/** Marked clinics treat at one real, supported public service station. This
 * adds no doctor-patient distance limit: each uses the existing two-metre
 * station admission. Callers still prove funded duty, needs and capacity.
 * Unmarked worlds retain their saved treatment contract. */
export function clinicalPairAtServiceStation(simulation: Simulation, site: Building, doctorId: string, patientId: string): boolean {
  const doctor = actor(simulation.state, doctorId), patient = actor(simulation.state, patientId);
  if (site.kind !== 'clinic' || !doctor || !patient || doctorId === patientId) return false;
  if (!getBuildingBody(site)) return true;
  const identity = (person: Citizen | Player, id: string) => id === 'player' ? simulation.state.player : { role: roleOf(person), identities: [roleOf(person)] };
  const doctorStations = clinicalServiceStationsAtPosition(site, doctor.position, identity(doctor, doctorId), simulation.state.voxels);
  const patientStations = clinicalServiceStationsAtPosition(site, patient.position, identity(patient, patientId), simulation.state.voxels);
  return doctorStations.some(point => patientStations.some(other => point.id === other.id && point.floor === other.floor &&
    Math.hypot(point.position.x - other.position.x, point.position.y - other.position.y, point.position.z - other.position.z) < 1e-8));
}
function doctors(simulation: Simulation, site: Building, onDuty: boolean, phaseMinutes = 0): Citizen[] {
  const s = simulation.state;
  return s.citizens.filter(person => person.workId === site.id && ['医生', 'doctor'].includes(person.role) && profile(s, person.id)?.alive && profile(s, person.id).age >= 18 && (!onDuty || person.needs.hunger >= 40 && person.needs.fatigue >= 35 && profile(s, person.id).health >= 45 && clinicalAtSite(simulation, site, person.id) && clinicalDoctorMinutes(simulation, person, site.id, phaseMinutes) > 0));
}
interface CareInterval { start: number; end: number }
interface SiteInterval extends CareInterval { siteId: string }
interface ArrivalInterval extends SiteInterval { purpose: string; position: Vec3 }
interface CarePhase {
  state: SimState; tick: number; clock: number; wages: Map<string, SiteInterval[]>;
  arrivals: Map<string, ArrivalInterval>; playerStations: Map<string, Set<string>>; blockedPlayer: boolean;
  doctors: Map<string, number>; patients: Set<string>; covered: Map<string, CareInterval[]>; serial: number;
}
const carePhases = new WeakMap<Simulation, CarePhase>();
function carePhase(simulation: Simulation): CarePhase {
  let item = carePhases.get(simulation);
  const state = simulation.state;
  if (!item || item.state !== state || item.tick !== state.tick || item.clock !== clock(state)) {
    item = { state, tick: state.tick, clock: clock(state), wages: new Map(), arrivals: new Map(), playerStations: new Map(), blockedPlayer: false, doctors: new Map(), patients: new Set(), covered: new Map(), serial: 0 };
    carePhases.set(simulation, item);
  }
  return item;
}
function careInterval(state: SimState, minutes: number, earliestAt = 0): CareInterval {
  const end = clock(state), dayStart = end - state.hour * 60;
  return { start: Math.max(end - Math.max(0, minutes), dayStart + 8 * 60, earliestAt), end: Math.min(end, dayStart + 17 * 60) };
}
/** A phase crossing closing time retains only its actual pre-closing tail.
 * This admission check grants no wages, presence, material or care minutes. */
export function clinicalOpenMinutes(state: SimState, minutes: number, earliestAt = 0): number {
  const window = careInterval(state, minutes, earliestAt);
  return Math.max(0, window.end - window.start);
}
function intersection(...ranges: CareInterval[]): CareInterval { return { start: Math.max(...ranges.map(range => range.start)), end: Math.min(...ranges.map(range => range.end)) }; }
function union(ranges: CareInterval[]): CareInterval[] {
  const merged: CareInterval[] = [];
  for (const range of ranges.filter(range => range.end > range.start).sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end); else merged.push({ ...range });
  }
  return merged;
}
const length = (ranges: readonly CareInterval[]) => ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
function stationKeys(simulation: Simulation, site: Building, person: Citizen | Player, id: string): Set<string> {
  if (!clinicalAtSite(simulation, site, id)) return new Set();
  if (!getBuildingBody(site)) return new Set([`legacy:${Math.floor((person.position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)))}`]);
  const identity = id === 'player' ? simulation.state.player : { role: roleOf(person), identities: [roleOf(person)] };
  return new Set(clinicalServiceStationsAtPosition(site, person.position, identity, simulation.state.voxels).map(point => `${point.floor}:${point.id}`));
}
/** Active conflicts are read at the start and end of this phase. A completed
 * final work slice cannot disappear before the later medical observer. */
function playerCareConflict(simulation: Simulation): boolean {
  const state = simulation.state, player = state.player;
  if (player.vehicleId || state.aviation?.activeAircraftId) return true;
  const at = (id: string, purpose?: 'work' | 'service') => {
    const site = simulation.worldDefinition.buildings.find(site => site.id === id);
    return !!site && simulation.isNearBuilding(site, player.position, 2) && canAccessFloor(site, Math.floor((player.position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors))), player)
      && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site, player.position, purpose));
  };
  const job = state.playerLabor?.job;
  const planned = job ? Math.min(.25 * state.speed, job.requiredMinutes - job.workedMinutes) * job.ratePerMinute * (1 - state.taxRate) : 0;
  if (job && ['working', 'paused'].includes(job.status) && job.workedMinutes < job.requiredMinutes && job.escrow > 0 && simulation.hasIdentity(job.role) && state.hour >= 6 && state.hour < 21 && player.needs.hunger >= 12 && player.needs.fatigue >= 15 && player.money + planned <= MONEY_LIMIT && at(job.siteId, 'work')) return true;
  const rest = state.homeRest?.session, home = rest && simulation.worldDefinition.buildings.find(site => site.id === rest.buildingId);
  if (rest?.state === 'active' && home && player.homeId === home.id && homeRestPointAt(home, player.position, player, rest.pointId) && !homeRestPointBlockedByVoxels(player.position, state.voxels)) return true;
  const project = state.culture?.project;
  return !!project && project.workedMinutes < project.requiredMinutes && state.hour >= 7 && state.hour < 22 && player.needs.hunger >= 40 && player.needs.fatigue >= 40 && at(project.siteId);
}
function actorArrivalWindow(simulation: Simulation, site: Building, id: string, minutes: number, purpose: 'work' | 'service', earliestAt = 0): CareInterval | null {
  const person = actor(simulation.state, id), p = carePhase(simulation);
  if (!person || !profile(simulation.state, id)?.alive || !clinicalAtSite(simulation, site, id)) return null;
  if (id === 'player') {
    if (p.blockedPlayer || playerCareConflict(simulation)) return null;
    const before = p.playerStations.get(site.id), current = stationKeys(simulation, site, person, id);
    if (!before || ![...current].some(key => before.has(key))) return null;
    return careInterval(simulation.state, minutes, earliestAt);
  }
  const observed = p.arrivals.get(id);
  if (!observed || observed.siteId !== site.id || observed.purpose !== purpose || Math.hypot(person.position.x - observed.position.x, person.position.y - observed.position.y, person.position.z - observed.position.z) > EPS) return null;
  return intersection(careInterval(simulation.state, minutes, earliestAt), observed);
}
function doctorWindows(simulation: Simulation, doctor: Citizen, siteId: string, minutes: number, earliestAt = 0): CareInterval[] {
  const state = simulation.state, site = simulation.worldDefinition.buildings.find(site => site.id === siteId), info = profile(state, doctor.id);
  if (!site || site.kind !== 'clinic' || doctor.workId !== siteId || !['医生', 'doctor'].includes(doctor.role) || !info?.alive || info.age < 18 || info.health < 45 || doctor.needs.hunger < 40 || doctor.needs.fatigue < 35 || doctor.state !== 'working') return [];
  const arrival = actorArrivalWindow(simulation, site, doctor.id, minutes, 'work', earliestAt);
  if (!arrival) return [];
  return union((carePhase(simulation).wages.get(doctor.id) ?? []).filter(range => range.siteId === siteId).map(range => intersection(range, arrival)));
}
/** Genuine current core credited front windows, never isOnDuty fallback or
 * an inferred suffix of an old accumulated attendance event. */
export function clinicalDoctorWorkWindows(simulation: Simulation, doctor: Citizen, siteId: string, phaseMinutes: number, earliestAt = 0): readonly Readonly<CareInterval>[] {
  return doctorWindows(simulation, doctor, siteId, phaseMinutes, earliestAt).map(range => Object.freeze({ ...range }));
}
export function clinicalDoctorMinutes(simulation: Simulation, doctor: Citizen, siteId: string, phaseMinutes: number, earliestAt = 0): number {
  return length(clinicalDoctorWorkWindows(simulation, doctor, siteId, phaseMinutes, earliestAt));
}
/** Real served interval union for other activities. Scalar used minutes alone
 * cannot locate a late patient's occupied tail in the doctor's work window. */
export function clinicalDoctorUsedWorkWindows(simulation: Simulation, doctorId: string): readonly Readonly<CareInterval>[] {
  return (carePhase(simulation).covered.get(doctorId) ?? []).map(range => Object.freeze({ ...range }));
}
function slotAvailable(simulation: Simulation, doctorId: string, patientId: string): boolean {
  const p = carePhase(simulation);
  return doctorId !== patientId && !p.patients.has(patientId) && (p.doctors.get(doctorId) ?? 0) < 2;
}
/** Public and paid care retain two concurrent patients per real doctor. */
export function takeClinicalDoctorSlot(simulation: Simulation, doctorId: string, patientId: string): boolean {
  if (!slotAvailable(simulation, doctorId, patientId)) return false;
  const p = carePhase(simulation); p.doctors.set(doctorId, (p.doctors.get(doctorId) ?? 0) + 1); p.patients.add(patientId); return true;
}
// A declared clinic load must be fully supplied before an indivisible care
// operation. Unconfigured legacy worlds retain their original care contract.
export function clinicalPowerAvailable(state: SimState, siteId: string): boolean {
  return !state.powerGrid || gridBuildingSupplyRatio(state, siteId) >= 1 - EPS;
}
/** Claim one patient window and only the previously uncovered union of the
 * doctor's work intervals. Two overlapping patients consume one doctor clock. */
export function claimClinicalCareMinutes(simulation: Simulation, site: Building, doctor: Citizen, patientId: string, phaseMinutes: number, earliestAt: number, remainingMinutes: number): number {
  if (!clinicalPowerAvailable(simulation.state, site.id)) return 0;
  if (!slotAvailable(simulation, doctor.id, patientId) || !clinicalPairAtServiceStation(simulation, site, doctor.id, patientId)) return 0;
  const patient = actor(simulation.state, patientId);
  if (!patient || patient.needs.hunger < 20 || patient.needs.fatigue < 15) return 0;
  const arrival = actorArrivalWindow(simulation, site, patientId, phaseMinutes, 'service', earliestAt);
  if (!arrival) return 0;
  const ranges = union(doctorWindows(simulation, doctor, site.id, phaseMinutes, earliestAt).map(range => intersection(range, arrival)));
  const p = carePhase(simulation), key = doctor.id, covered = p.covered.get(key) ?? [];
  let patientLeft = Math.min(Math.max(0, remainingMinutes), actorActivityAvailable(simulation, patientId, phaseMinutes)), doctorLeft = actorActivityAvailable(simulation, doctor.id, phaseMinutes);
  const selected: CareInterval[] = [];
  let newlyUsed = 0;
  for (const range of ranges) {
    const cuts = [range.start, range.end, ...covered.flatMap(item => [item.start, item.end]).filter(at => at > range.start && at < range.end)].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length && patientLeft > EPS; i++) {
      const start = cuts[i - 1], end = cuts[i], shared = covered.some(item => item.start <= start && item.end >= end);
      const used = Math.min(end - start, patientLeft, shared ? Infinity : doctorLeft);
      if (used <= EPS) continue;
      selected.push({ start, end: start + used }); patientLeft -= used;
      if (!shared) { newlyUsed += used; doctorLeft -= used; }
    }
  }
  const actual = length(selected);
  if (actual <= EPS) return 0;
  // There are no callbacks between these deterministic, already bounded claims.
  if (newlyUsed > EPS && claimActorActivityMinutes(simulation, doctor.id, `clinical-doctor:${site.id}:${key}:${p.serial++}`, newlyUsed, phaseMinutes) !== newlyUsed) return 0;
  if (claimActorActivityMinutes(simulation, patientId, `clinical-patient:${patientId}`, actual, phaseMinutes) !== actual || !takeClinicalDoctorSlot(simulation, doctor.id, patientId)) return 0;
  p.covered.set(key, union([...covered, ...selected])); return actual;
}
/** Persisted medical commitments request fine people processing without
 * changing anyone's tier, speed, accumulated needs or wage allowance. */
export function clinicalTaskActorIds(state: SimState): ReadonlySet<string> {
  const ids = new Set<string>(), sites = new Set<string>();
  for (const order of state.clinical?.orders ?? []) if (['awaitingSupply', 'awaitingDoctor', 'inTreatment'].includes(order.state)) { sites.add(order.siteId); ids.add(order.patientId); }
  for (const order of state.culture?.orders ?? []) if (order.topic === 'health' && order.state === 'active') sites.add(order.siteId);
  for (const citizen of state.citizens) {
    const info = state.extension?.actorProfiles[citizen.id];
    if (!info?.alive) continue;
    const doctor = sites.has(citizen.workId) && ['医生', 'doctor'].includes(citizen.role) && info.age >= 18;
    const publicPatient = !!citizen.destinationId && state.culture?.orders.some(order => order.topic === 'health' && order.state === 'active' && order.siteId === citizen.destinationId);
    if (doctor || publicPatient) ids.add(citizen.id);
  }
  ids.delete('player'); return ids;
}
function installCareWindows(simulation: Simulation): void {
  simulation.onPhase('time', () => {
    const p = carePhase(simulation); p.blockedPlayer = playerCareConflict(simulation);
    for (const site of simulation.worldDefinition.buildings) if (site.kind === 'clinic' && simulation.isNearBuilding(site, simulation.state.player.position, 2)) {
      const keys = stationKeys(simulation, site, simulation.state.player, 'player'); if (keys.size) p.playerStations.set(site.id, keys);
    }
  });
  simulation.onEvent('wage-earned', event => {
    if (!isCanonicalNpcWage(event, simulation)) return;
    const worker = event.citizenId && simulation.state.citizens.find(person => person.id === event.citizenId), p = carePhase(simulation);
    if (!worker || !['医生', 'doctor'].includes(worker.role) || !simulation.worldDefinition.buildings.some(site => site.id === worker.workId && site.kind === 'clinic') || event.siteId !== worker.workId || !Number.isFinite(event.minutes) || event.minutes! <= 0 || !Number.isFinite(event.amount) || event.amount! <= 0 || !Number.isFinite(event.creditedWorkStartAt) || event.creditedWorkStartAt! < 0 || !Number.isFinite(event.creditedWorkEndAt) || event.creditedWorkEndAt! > p.clock + EPS || event.creditedWorkEndAt! <= event.creditedWorkStartAt! || Math.abs(event.creditedWorkEndAt! - event.creditedWorkStartAt! - event.minutes!) > EPS) return;
    const ranges = p.wages.get(worker.id) ?? []; ranges.push({ start: event.creditedWorkStartAt!, end: event.creditedWorkEndAt!, siteId: event.siteId }); p.wages.set(worker.id, ranges);
  });
  simulation.onEvent('clinical-activity-window', event => {
    if (!isCanonicalClinicalPresence(event, simulation)) return;
    const worker = event.citizenId && simulation.state.citizens.find(person => person.id === event.citizenId), p = carePhase(simulation), position = event.activityPosition;
    if (!worker || !event.siteId || !position || ![position.x, position.y, position.z].every(Number.isFinite) || event.activityObservedTick !== p.tick || event.activityObservedClock !== p.clock || event.activityWindowEndAt !== p.clock || !Number.isFinite(event.activityWindowStartAt) || event.activityWindowStartAt! < 0 || event.activityWindowStartAt! >= p.clock || !['work', 'service'].includes(event.purpose ?? '') || Math.hypot(worker.position.x - position.x, worker.position.y - position.y, worker.position.z - position.z) > EPS) return;
    p.arrivals.set(worker.id, { start: event.activityWindowStartAt!, end: p.clock, siteId: event.siteId, purpose: event.purpose!, position: { ...position } });
  });
  simulation.onLoad(() => carePhases.delete(simulation));
}
function ledger(simulation: Simulation, order: ClinicalOrder, amount: number, purpose: string, account: 'household' | 'public'): void {
  const s = simulation.state, districtId = simulation.worldDefinition.buildings.find(site => site.id === order.siteId)!.districtId;
  s.extension!.publicLedger.push({ tick: s.tick, actorId: order.payerId, amount, purpose, account, districtId });
  if (s.extension!.publicLedger.length > 512) s.extension!.publicLedger.splice(0, s.extension!.publicLedger.length - 512);
}
function stock(s: SimState, siteId: string): ClinicStock { return s.clinical!.stock[siteId] ??= { receivedUnits: 0, consumedUnits: 0, availableUnits: 0, archivedPurchasedUnits: 0, archivedConsumedUnits: 0 }; }
function refund(simulation: Simulation, order: ClinicalOrder): void {
  const person = actor(simulation.state, order.payerId)!;
  const amount = Math.min(order.escrow, Math.max(0, MONEY_LIMIT - person.money));
  if (amount > 0) { person.money += amount; order.escrow -= amount; order.refunded += amount; simulation.state.clinical!.stats.refunded += amount; ledger(simulation, order, amount, '诊疗未赚托管款退款', 'household'); simulation.emitEvent({ type: 'clinical-refund', citizenId: order.payerId, amount, siteId: order.siteId, procurementId: order.id }); }
  order.state = order.escrow > 0 ? 'refundPending' : 'cancelled';
  order.lastReason = order.state === 'refundPending' ? '未赚资金仍在托管，付款人钱包达到容量；待实际退款后再清算遗产。' : '订单停止；未赚资金已退款，已购物料保留在诊所。';
}
function stop(simulation: Simulation, order: ClinicalOrder): void {
  if (order.cancelledAt === null) { order.cancelledAt = clock(simulation.state); simulation.state.clinical!.stats.cancelled++; stock(simulation.state, order.siteId).availableUnits += order.reservedUnits; order.reservedUnits = 0; }
  refund(simulation, order);
}
function archive(s: SimState): void {
  const c = s.clinical!; if (c.orders.length < 192) return;
  c.orders = c.orders.filter(order => {
    if (!terminal(order) || order.escrow > 0 || clock(s) - (order.completedAt ?? order.cancelledAt ?? clock(s)) < 1440) return true;
    const a = c.archived, material = stock(s, order.siteId); a.count++; a.funded += order.funded; a.purchasePaid += order.purchasePaid; a.serviceFees += order.serviceFee; a.refunded += order.refunded; a.completed += Number(order.state === 'completed'); a.cancelled += Number(order.state === 'cancelled'); material.archivedPurchasedUnits += order.receivedUnits; material.archivedConsumedUnits += order.consumedUnits; return false;
  });
}
/** Existing heal commands and real NPC clinic arrivals call this same entry. */
export function beginClinicalTreatment(simulation: Simulation, request: { patientId: string; payerId: string; siteId: string }): CommandResult {
  const s = simulation.state, c = s.clinical, site = simulation.worldDefinition.buildings.find(site => site.id === request.siteId), patient = actor(s, request.patientId), payer = actor(s, request.payerId);
  const fail = (message: string): CommandResult => ({ ok: false, message });
  if (!c || !site || site.kind !== 'clinic' || !patient || !payer || !profile(s, request.patientId)?.alive || profile(s, request.patientId).health <= 0 || profile(s, request.patientId).health >= 100 || !profile(s, request.payerId)?.alive || profile(s, request.payerId).age < 18) return fail('诊疗须有存活伤患、成年付款人和真实诊所。');
  if (!clinicalAtSite(simulation, site, request.patientId) || !clinicalAtSite(simulation, site, request.payerId)) return fail('伤患和付款人须共同到达诊所公共诊疗层。');
  if (!doctors(simulation, site, false).some(doctor => doctor.id !== request.patientId)) return fail('该诊所没有已任职的成年医生，不能承诺诊疗。');
  if (payer.money < FEE || c.orders.length >= LIMIT || c.nextOrderId >= 1e9) return fail('需要30文真实托管款，且诊所订单队列须有空位。');
  if (c.orders.some(order => order.patientId === request.patientId && !terminal(order)) || clinicalVisitDeadline(s, request.patientId) > clock(s)) return fail('该患者已有未结订单或尚在已保存复诊间隔内。');
  const material = stock(s, site.id), reuse = Math.min(1, material.availableUnits);
  const order: ClinicalOrder = { timingVersion: 2, id: `clinical-${c.nextOrderId++}`, ...request, startedAt: clock(s), state: reuse ? 'awaitingDoctor' : 'awaitingSupply', funded: FEE, escrow: FEE, purchasePaid: 0, serviceFee: 0, refunded: 0, receivedUnits: 0, reusedUnits: reuse, reservedUnits: reuse, consumedUnits: 0, workedMinutes: 0, requiredMinutes: MINUTES, staffMinutes: {}, receipts: [], completedAt: null, cancelledAt: null, retryAt: clock(s), lastReason: reuse ? '已分配诊所现有物料，等待实际医生与患者到场。' : '30文进入托管；等待实际采购一份诊疗材料。' };
  payer.money -= FEE; material.availableUnits -= reuse; c.orders.push(order); c.stats.funded += FEE; ledger(simulation, order, -FEE, '诊疗30文进入真实托管', 'household'); simulation.emitEvent({ type: 'clinical-start', citizenId: request.patientId, amount: FEE, siteId: site.id, procurementId: order.id });
  return { ok: true, message: '诊疗已登记；材料到货、医生与患者共同完成20分钟后才恢复健康。' };
}
export function cancelClinicalTreatment(simulation: Simulation, orderId: string, payerId = 'player'): CommandResult {
  const order = simulation.state.clinical?.orders.find(item => item.id === orderId);
  if (!order || order.payerId !== payerId || !profile(simulation.state, payerId)?.alive || terminal(order) || order.cancelledAt !== null) return { ok: false, message: '只有存活的付款人可以停止自己的未完成订单。' };
  stop(simulation, order); return { ok: true, message: order.lastReason };
}
function procure(simulation: Simulation, order: ClinicalOrder, site: Building): void {
  const s = simulation.state, c = s.clinical!;
  if (order.reservedUnits >= 1 - EPS || clock(s) + EPS < order.retryAt) return;
  order.retryAt = clock(s) + 60;
  const material = stock(s, site.id);
  if (material.availableUnits >= 1 - EPS) { material.availableUnits--; order.reusedUnits++; order.reservedUnits++; order.state = 'awaitingDoctor'; return; }
  const sources = s.shops.filter(shop => simulation.shopCommodity(shop) === 'materials' && shop.inventory >= 1).map(shop => ({ shop, quote: simulation.quoteSupply(shop.id, 1) })).sort((a, b) => Number(b.shop.districtId === site.districtId) - Number(a.shop.districtId === site.districtId) || a.quote.unitPrice - b.quote.unitPrice || a.shop.id.localeCompare(b.shop.id));
  const source = sources.find(({ shop, quote }) => quote.quantity >= 1 && quote.unitPrice <= order.escrow && quote.unitPrice > 0 && simulation.shopFunds(shop) + quote.unitPrice * (1 - s.taxRate) <= MONEY_LIMIT);
  if (!source) { order.state = 'awaitingSupply'; order.lastReason = sources.length ? '实际报价超出未赚托管款或收款账户容量；等待真实可负担供货。' : '供应商没有一份可用实物，诊疗材料不能凭空生成。'; return; }
  const gross = source.quote.unitPrice, net = gross * (1 - s.taxRate), tax = gross - net;
  source.shop.inventory -= 1; order.escrow -= gross; simulation.transferShopFunds(source.shop, net); source.shop.revenue += gross; source.shop.profit += net;
  order.purchasePaid += gross; order.receivedUnits++; order.reservedUnits++; material.receivedUnits++; c.stats.purchasePaid += gross;
  const receipt: ClinicalReceipt = { commodity: 'materials', procurementId: `${order.id}:receipt-1`, purchasedAt: clock(s), paid: gross, quantity: 1, tax, lots: [{ shopId: source.shop.id, quantity: 1, unitPrice: gross, gross, net }] }; order.receipts.push(receipt);
  simulation.emitEvent({ type: 'wholesale', shopId: source.shop.id, districtId: source.shop.districtId, amount: gross, quantity: 1, unitPrice: gross, siteId: site.id, procurementId: receipt.procurementId, purpose: 'clinical-material' });
  order.state = 'awaitingDoctor'; order.lastReason = clinicalPowerAvailable(s, site.id) ? '实物已购入并为患者保留；等待医生实际在岗。' : '已购材料和托管款保留；声明电网未足额供给该诊所，等候当前真实供能。';
}
/** Explicit new-city host choice. Existing/imported contracts are never
 * upgraded by module import, phase processing, or load. The selector creates
 * no patients, stock, doctors, cash, time, role or public-budget authority. */
export function selectPaidClinicalTriageForNewCity(simulation: Simulation, siteId: string): CommandResult {
  const s = simulation.state, c = s.clinical, site = simulation.worldDefinition.buildings.find(site => site.id === siteId);
  if (s.tick !== 0 || clock(s) !== 480 || !c || JSON.stringify(c) !== JSON.stringify(initialize()))
    return { ok: false, message: '只可为尚未推进且没有临床权利的新城显式选择分诊；旧档不自动升级。' };
  if (!site || site.kind !== 'clinic') return { ok: false, message: '须选择此世界的一个实际诊所。' };
  s.clinical = { ...c, version: 2, paidTriage: { policyId: PAID_CLINICAL_TRIAGE_POLICY, siteId } };
  return { ok: true, message: '此具名诊所的既有付费订单按实际严重度和登记等候时间派发原容量；公共服务规则保留。' };
}

export function installClinical(simulation: Simulation): void {
  const sites = new Map(simulation.worldDefinition.buildings.map(site => [site.id, site]));
  simulation.state.clinical = initialize();
  installCareWindows(simulation);
  simulation.onPhase('people', (s, minutes) => {
    const c = s.clinical!;
    const availableDoctors = new Map<string, Citizen[]>();
    // Only the declared paid queue changes its actual claim order. The saved
    // insertion order stays intact; public patients retain their original
    // earlier hooks and share the unchanged two-slot/doctor-time allocator.
    const treatmentOrder = paidClinicalTriageOrders(c.orders, c.version === 2 ? c.paidTriage : undefined, clock(s), order => {
      const patient = profile(s, order.patientId), payer = profile(s, order.payerId), episode = s.pathology?.episodes[order.patientId];
      const currentSymptoms = episode && episode.lastObservedAt === clock(s)
        && ['symptomatic', 'recovering'].includes(episode.phase) ? episode.severity : 0;
      return { alive: patient?.alive ?? false, payerAlive: payer?.alive ?? false, health: patient?.health ?? NaN, symptomSeverity: currentSymptoms };
    });
    for (const order of treatmentOrder) {
      if (terminal(order)) continue;
      if (order.cancelledAt !== null || !profile(s, order.patientId).alive || !profile(s, order.payerId).alive) { stop(simulation, order); continue; }
      const site = sites.get(order.siteId)!;
      if (order.reservedUnits < 1 - EPS) continue;
      if (!clinicalPowerAvailable(s, site.id)) { order.state = 'awaitingDoctor'; order.lastReason = '已购材料和托管款保留；声明电网未足额供给该诊所，等候当前真实供能。'; continue; }
      const patient = actor(s, order.patientId)!;
      if (clinicalVisitDeadline(s, order.patientId) > clock(s)) { order.state = 'awaitingDoctor'; order.lastReason = '既有公共或付费诊疗复诊间隔尚未结束；物料与托管款保留。'; continue; }
      if (clock(s) <= order.startedAt + EPS || clinicalOpenMinutes(s, minutes) <= 0 || !clinicalAtSite(simulation, site, order.patientId) || patient.needs.hunger < 20 || patient.needs.fatigue < 15) { order.state = 'awaitingDoctor'; order.lastReason = '已购材料保留；等候开放时间、患者在场和体力恢复。'; continue; }
      if (!availableDoctors.has(site.id)) availableDoctors.set(site.id, doctors(simulation, site, true, minutes));
      // Check finite settlement before consuming any shared activity or slot.
      if (s.treasury + order.escrow > MONEY_LIMIT) { order.state = 'awaitingDoctor'; order.lastReason = '公库收款容量已满；未赚服务费保留托管。'; continue; }
      const earliest = Math.max(order.startedAt, order.receipts[0]?.purchasedAt ?? order.startedAt);
      let worked = 0;
      const doctor = availableDoctors.get(site.id)!.find(person => (worked = claimClinicalCareMinutes(simulation, site, person, order.patientId, minutes, earliest, MINUTES - order.workedMinutes)) > EPS);
      if (!doctor) { order.state = 'awaitingDoctor'; order.lastReason = '材料保留；没有合资格医生与患者同站的真实到场计薪交集，或当下诊疗容量已满。'; continue; }
      order.workedMinutes += worked; order.staffMinutes[doctor.id] = (order.staffMinutes[doctor.id] ?? 0) + worked; order.state = 'inTreatment'; order.lastReason = `医生与患者共同诊疗${order.workedMinutes.toFixed(1)}/20分钟；离場暂停。`;
      if (order.workedMinutes < MINUTES - EPS) continue;
      order.reservedUnits--; order.consumedUnits++; stock(s, site.id).consumedUnits++;
      profile(s, order.patientId).health = clamp(profile(s, order.patientId).health + clinicalHealthGain(s)); profile(s, order.patientId).stress = clamp(profile(s, order.patientId).stress - 8);
      const earned = order.escrow; order.escrow = 0; order.serviceFee += earned; c.stats.serviceFees += earned; s.treasury += earned;
      const runtime = Reflect.get(s.extension!, 'runtime') as { lastTreasury: number }; runtime.lastTreasury += earned; ledger(simulation, order, earned, '现场20分钟诊疗已赚服务费', 'public');
      order.state = 'completed'; order.completedAt = clock(s); c.stats.completed++; c.nextVisitAt[order.patientId] = clock(s) + 60; order.lastReason = '医生与患者已完成20分钟，耗用一份真实材料；服务费已入公库。';
      simulation.emitEvent({ type: 'clinical-completed', citizenId: order.patientId, quantity: 1, amount: earned, minutes: MINUTES, siteId: site.id, procurementId: order.id });
    }
  });
  simulation.onPhase('finance', s => {
    for (const order of s.clinical!.orders) {
      if (terminal(order)) continue;
      if (order.cancelledAt !== null || !profile(s, order.patientId).alive || !profile(s, order.payerId).alive) stop(simulation, order);
      else procure(simulation, order, sites.get(order.siteId)!);
    }
    archive(s);
  });
  simulation.registerCommandHandler(command => command.type === 'cancelTreatment' ? cancelClinicalTreatment(simulation, command.targetId ?? '') : null);
  simulation.registerSaveValidator(candidate => validateClinicalState(candidate, simulation.worldDefinition));
  simulation.onLoad(() => { if (!simulation.state.clinical) simulation.state.clinical = initialize(); });
}

export function validateClinicalState(s: SimState, world: WorldDefinition): void {
  const c = s.clinical; if (c === undefined) return;
  const ensure = (condition: unknown, label: string): void => { if (!condition) throw new Error(`临床存档无效：${label}`); };
  const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
  const number = (value: unknown, min: number, max: number, label: string, integer = false): void => ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const close = (a: number, b: number, label: string) => ensure(Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b)), label);
  const sites = new Map(world.buildings.map(site => [site.id, site])), ids = new Set(['player', ...s.citizens.map(person => person.id)]), sourceIds = new Set(s.shops.filter(shop => sites.get(shop.buildingId)!.kind === 'workshop').map(shop => shop.id)), now = clock(s);
  ensure(object(c) && (c.version === 1 || c.version === 2), '版本');
  if (c.version === 1) ensure(c.paidTriage === undefined, '旧临床版本没有隐式分诊');
  else ensure(object(c.paidTriage) && Object.keys(c.paidTriage).length === 2
    && c.paidTriage.policyId === PAID_CLINICAL_TRIAGE_POLICY && sites.get(c.paidTriage.siteId)?.kind === 'clinic', '单诊所显式付费分诊来源'); number(c.nextOrderId, 1, 1e9, '订单序号', true); ensure(Array.isArray(c.orders) && c.orders.length <= LIMIT && object(c.stock) && object(c.nextVisitAt), '容器');
  ensure(object(c.stats) && object(c.archived), '累计回执');
  for (const totals of [c.stats, c.archived]) for (const key of ['funded', 'purchasePaid', 'serviceFees', 'refunded', 'completed', 'cancelled'] as const) number(totals[key], 0, 3e10, `累计${key}`, key === 'completed' || key === 'cancelled');
  number(c.archived.count, 0, 1e9, '归档计数', true); close(c.archived.completed + c.archived.cancelled, c.archived.count, '归档状态'); close(c.archived.funded, c.archived.count * FEE, '归档真实资金'); close(c.archived.funded, c.archived.purchasePaid + c.archived.serviceFees + c.archived.refunded, '归档款项守恒');
  const seen = new Set<string>(), pending = new Set<string>(), sums = { ...c.archived }, materials = new Map<string, { received: number; consumed: number; reserved: number }>();
  for (const o of c.orders) {
    ensure(object(o) && /^clinical-[1-9]\d*$/.test(o.id) && !seen.has(o.id) && Number(o.id.slice(9)) < c.nextOrderId, '订单身份'); seen.add(o.id);
    ensure(ids.has(o.patientId) && ids.has(o.payerId) && sites.get(o.siteId)?.kind === 'clinic' && profile(s, o.payerId)?.age >= 18, '主体与诊所引用');
    ensure(o.timingVersion === undefined || o.timingVersion === 2, '到场计时版本');
    ensure(['awaitingSupply', 'awaitingDoctor', 'inTreatment', 'refundPending', 'completed', 'cancelled'].includes(o.state), '订单状态'); number(o.startedAt, 0, now, '开始时间'); number(o.retryAt, o.startedAt, now + 60, '供货重试');
    if (!terminal(o)) { ensure(!pending.has(o.patientId), '患者重复未结订单'); pending.add(o.patientId); }
    ensure(typeof o.lastReason === 'string' && o.lastReason.length <= 240 && o.requiredMinutes === MINUTES && o.funded === FEE, '固定条件');
    for (const key of ['escrow', 'purchasePaid', 'serviceFee', 'refunded'] as const) number(o[key], 0, FEE, key);
    close(o.funded, o.escrow + o.purchasePaid + o.serviceFee + o.refunded, '订单真实资金守恒');
    for (const key of ['receivedUnits', 'reusedUnits', 'reservedUnits', 'consumedUnits'] as const) number(o[key], 0, 1, key, true);
    ensure(o.receivedUnits + o.reusedUnits <= 1 && o.reservedUnits + o.consumedUnits <= o.receivedUnits + o.reusedUnits, '物料分配'); number(o.workedMinutes, 0, MINUTES, '现场时数'); ensure(o.workedMinutes <= now - o.startedAt + EPS, '时间因果');
    ensure(object(o.staffMinutes) && Object.keys(o.staffMinutes).length <= ids.size && Array.isArray(o.receipts) && o.receipts.length <= 1, '履约回执容器');
    let staffed = 0; for (const [id, value] of Object.entries(o.staffMinutes)) { ensure(id !== 'player' && ids.has(id) && id !== o.patientId, '医生引用'); number(value, EPS, MINUTES, '医生时数'); staffed += value as number; } close(staffed, o.workedMinutes, '医患共同现场时数');
    let paid = 0, received = 0;
    for (const receipt of o.receipts) {
      ensure(object(receipt) && receipt.commodity === 'materials' && receipt.procurementId === `${o.id}:receipt-1` && Array.isArray(receipt.lots) && receipt.lots.length === 1, '采购引用'); number(receipt.purchasedAt, o.startedAt, now, '采购时间'); number(receipt.paid, EPS, FEE, '采购实费'); ensure(receipt.quantity === 1, '一份实物'); number(receipt.tax, 0, receipt.paid, '实际税款');
      const lot = receipt.lots[0]; ensure(object(lot) && sourceIds.has(lot.shopId) && lot.quantity === 1, '真实供应引用'); number(lot.unitPrice, EPS, FEE, '实际报价'); number(lot.gross, EPS, FEE, '实际货款'); close(lot.gross, lot.unitPrice, '报价货款'); number(lot.net, 0, lot.gross, '供应净款'); close(receipt.paid, lot.gross, '采购货款'); close(receipt.tax, lot.gross - lot.net, '货款税守恒'); paid += receipt.paid; received += receipt.quantity;
    }
    close(paid, o.purchasePaid, '累计采购支出'); close(received, o.receivedUnits, '累计实物到货');
    if (o.timingVersion === 2) ensure(o.workedMinutes <= now - Math.max(o.startedAt, o.receipts[0]?.purchasedAt ?? o.startedAt) + EPS, '新订单不得借采购前时间');
    if (o.completedAt !== null) number(o.completedAt, o.startedAt + MINUTES, now, '完成时间'); if (o.cancelledAt !== null) number(o.cancelledAt, o.startedAt, now, '停止时间');
    if (o.state === 'completed') ensure(o.completedAt !== null && o.cancelledAt === null && o.workedMinutes === MINUTES && o.consumedUnits === 1 && o.reservedUnits === 0 && o.escrow === 0 && o.refunded === 0 && o.serviceFee === FEE - o.purchasePaid, '完成闭环');
    else if (o.state === 'cancelled' || o.state === 'refundPending') ensure(o.cancelledAt !== null && o.completedAt === null && o.serviceFee === 0 && o.consumedUnits === 0 && o.reservedUnits === 0 && o.workedMinutes < MINUTES && (o.state === 'cancelled' ? o.escrow === 0 : o.escrow > 0), '取消与退款');
    else { ensure(o.completedAt === null && o.cancelledAt === null && o.serviceFee === 0 && o.refunded === 0 && o.consumedUnits === 0 && o.workedMinutes < MINUTES && o.receivedUnits + o.reusedUnits === o.reservedUnits, '待履约闭环'); if (o.state === 'awaitingSupply') ensure(o.reservedUnits === 0 && o.workedMinutes === 0, '缺料不能诊疗'); if (o.state === 'inTreatment') ensure(o.workedMinutes > 0 && o.reservedUnits === 1, '治疗资格'); }
    const material = materials.get(o.siteId) ?? { received: 0, consumed: 0, reserved: 0 }; material.received += o.receivedUnits; material.consumed += o.consumedUnits; material.reserved += o.reservedUnits; materials.set(o.siteId, material);
    sums.funded += o.funded; sums.purchasePaid += o.purchasePaid; sums.serviceFees += o.serviceFee; sums.refunded += o.refunded; sums.completed += Number(o.state === 'completed'); sums.cancelled += Number(o.cancelledAt !== null);
  }
  for (const key of ['funded', 'purchasePaid', 'serviceFees', 'refunded', 'completed', 'cancelled'] as const) close(c.stats[key], sums[key], `累计${key}对账`);
  ensure(c.nextOrderId === c.archived.count + c.orders.length + 1, '队列序号连续');
  let archivedReceived = 0, archivedConsumed = 0;
  for (const [siteId, item] of Object.entries(c.stock)) {
    ensure(sites.get(siteId)?.kind === 'clinic' && object(item), '物料库存场所'); for (const key of ['receivedUnits', 'consumedUnits', 'availableUnits', 'archivedPurchasedUnits', 'archivedConsumedUnits'] as const) number(item[key], 0, 1e9, `库存${key}`, true);
    const material = materials.get(siteId) ?? { received: 0, consumed: 0, reserved: 0 };
    close(item.receivedUnits, material.received + item.archivedPurchasedUnits, '实物到货对账'); close(item.consumedUnits, material.consumed + item.archivedConsumedUnits, '实物耗用对账'); close(item.receivedUnits, item.consumedUnits + item.availableUnits + material.reserved, '实物库存守恒'); archivedReceived += item.archivedPurchasedUnits; archivedConsumed += item.archivedConsumedUnits; materials.delete(siteId);
  }
  ensure(materials.size === 0, '订单库存缺失'); ensure(archivedReceived <= c.archived.count && archivedConsumed === c.archived.completed, '归档实物守恒');
  for (const [id, at] of Object.entries(c.nextVisitAt)) { ensure(ids.has(id), '复诊主体'); number(at, 0, now + 60, '复诊时钟'); }
}
