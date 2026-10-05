import { isCanonicalNpcWage } from '../simulation';
import type { Simulation } from '../simulation';
import type { Building, Citizen, SimState, Vec3, WorldDefinition } from '../types';
import { canAccessFloor } from '../access';
import { FLOOR_PLAN_PROFILE, blocksFloorPlanMovement, floorPlanSupport, getBuildingUsePoints } from '../architecture-floor-plan';
import { homeRestPointBlockedByVoxels } from './home-rest';
import { actorActivityAvailable, claimActorActivityMinutes } from './activity-minutes';
import { collectActorActivityClaims } from './activity-capacity';
import { appendCivicHistory, civicHistoryView, decodeCivicHistory } from './civic-history';

export const CIVIC_RULESET = 'civic-local-v1' as const;
export const CIVIC_REGISTRATION_FEE = 120;
export const CIVIC_LIVING_RESERVE = 100;
export const CIVIC_PROOF_MINUTES = 60;
export const CIVIC_POLL_MINUTES = 2 * 1440;
export const CIVIC_TERM_MINUTES = 14 * 1440;
export const CIVIC_DISTRICT_SEATS = 2;
const EPS = 1e-7, PROOF_LIMIT = 128, APPLICATION_LIMIT = 64, POLL_LIMIT = 32, TERM_LIMIT = 128;
const PAID_WINDOW_LIMIT = 64, ACTIVITY_WINDOW_LIMIT = 32, BALLOT_LIMIT = 4096;

export interface CivicEnablement {
  id: string; ruleVersion: 1; origin: 'new-city' | 'host-upgrade'; enabledAt: number; enabledTick: number;
  sourceSave?: { sha256: string; version: 1 | 2; motionVersion: 1 | 2 };
}
/** The core supplies verified cutover qualifications, never past work. */
export interface CivicOriginalOfficial {
  actorId: string; baseRole: '官员' | 'official'; workId: string; districtId: string; educationAtEnablement: number;
  source: { kind: 'initial-profession' } | { kind: 'public-employment'; revision: number };
}
export interface CivicPoint { floor: number; pointId: string; position: Vec3 }
export interface CivicPaidWindow extends CivicPoint {
  firstTick: number; lastTick: number; startAt: number; endAt: number; minutes: number; ratePerMinute: number; earned: number;
}
export interface CivicWorkProof {
  id: string; actorId: string; officeId: string; districtId: string; baseRole: '官员' | 'official'; day: number;
  enablementId: string; startedAt: number; completedAt: number | null; minutes: number; earned: number; windows: CivicPaidWindow[];
}
export interface CivicActivityWindow extends CivicPoint {
  tick: number; phaseMinutes: number; observedClock: number; displayHour: number; startAt: number; endAt: number;
  excludedPaid: { siteId: string; startAt: number; endAt: number; ratePerMinute: number; earned: number }[];
}
export interface CivicWitness extends CivicPoint {
  actorId: string; officeId: string; baseRole: '官员' | 'official'; signedAt: number;
  paid: { startAt: number; endAt: number; ratePerMinute: number; earned: number; tick: number };
}
export interface CivicRegistrationReceipt {
  paidAt: number; tick: number; displayHour: number; amount: 120; moneyBefore: number; moneyAfter: number; treasuryBefore: number; treasuryAfter: number;
  candidateAge: number; candidateEducation: number; witnesses: CivicWitness[];
}
export interface CivicApplication {
  id: string; actorId: string; officeId: string; districtId: string; proofId: string; startedAt: number;
  workedMinutes: number; windows: CivicActivityWindow[]; receipt: CivicRegistrationReceipt | null; pollId: string | null;
  cancelledAt: number | null; cancellationReason: '' | 'death' | 'profession-changed' | 'residency-changed' | 'expired-proof';
}
export interface CivicEligibleVoter { actorId: string; ageAtOpening: number; districtId: string }
export interface CivicOpeningCensus { actorId: string; districtId: string; ageAtOpening: number; aliveAtOpening: boolean }
export interface CivicWithdrawal { actorId: string; at: number; tick: number; reason: 'death' | 'residency-changed' }
export interface CivicVoteDecision { support: number; mood: number; stress: number; prosperity: number; candidateEducation: number }
export interface CivicBallot {
  actorId: string; choice: 'support' | 'retain'; decision: CivicVoteDecision;
  startedAt: number; completedAt: number | null; workedMinutes: number; windows: CivicActivityWindow[];
}
export interface CivicPoll {
  id: string; applicationId: string; candidateId: string; officeId: string; districtId: string; proofId: string;
  openedAt: number; closesAt: number; openingCensus: CivicOpeningCensus[]; eligible: CivicEligibleVoter[]; withdrawals: CivicWithdrawal[]; ballots: CivicBallot[];
  countedAt: number | null; result: 'open' | 'elected' | 'defeated' | 'no-quorum' | 'candidate-unavailable' | 'no-seat';
  count: { eligible: number; quorum: number; turnout: number; support: number; retain: number } | null; termId: string | null;
}
export interface CivicTerm {
  id: string; actorId: string; officeId: string; districtId: string; baseRole: '官员' | 'official';
  enablementId: string; pollId: string; proofId: string; startsAt: number; endsAt: number;
  endedAt: number | null; endedTick: number | null; endedReason: '' | 'expired' | 'death' | 'profession-changed' | 'residency-changed';
}
export interface CivicStaffingState {
  version: 1 | 2; historyId?: string; enablement: CivicEnablement; originalOfficials: CivicOriginalOfficial[];
  nextProofId: number; retiredProofCount: number; nextApplicationId: number; nextPollId: number; nextTermId: number;
  proofs: CivicWorkProof[]; applications: CivicApplication[]; polls: CivicPoll[]; terms: CivicTerm[];
}
export interface CivicCouncilSourceProof {
  version: 1; kind: 'local-council-term'; ruleId: typeof CIVIC_RULESET; enablementId: string;
  actorId: string; officeId: string; districtId: string; baseRole: '官员' | 'official';
  electionId: string; termId: string; proofId: string; signedAt: number; startsAt: number; endsAt: number;
}
export interface CivicStaffingHooks { enabled: () => boolean; isCanonicalPresence: (event: object) => boolean }
type CivicState = SimState & { civicStaffing?: CivicStaffingState };
type Presence = {
  citizenId: string; siteId: string; purpose: 'civicRegister' | 'civicVote'; activityObservedTick: number;
  activityObservedClock: number; activityWindowStartAt: number; activityWindowEndAt: number; activityPosition: Vec3;
};
type Paid = { siteId: string; startAt: number; endAt: number; ratePerMinute: number; earned: number; tick: number; point: CivicPoint };
interface Frame { state: SimState; tick: number; clock: number; minutes: number; paid: Map<string, Paid[]>; arrivals: Presence[]; reserved: Set<string> }
const frames = new WeakMap<Simulation, Frame>();
const installs = new WeakSet<Simulation>();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clock = (state: SimState) => state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
const body = (state: SimState) => (state as CivicState).civicStaffing;
const copy = (point: Vec3): Vec3 => ({ x: point.x, y: point.y, z: point.z });
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const same = (a: number, b: number) => Math.abs(a - b) <= EPS;
const officialRole = (role: string): role is CivicOriginalOfficial['baseRole'] => role === '官员' || role === 'official';

export function createCivicStaffingState(enablement: CivicEnablement, originalOfficials: CivicOriginalOfficial[]): CivicStaffingState {
  return { version: 1, enablement: structuredClone(enablement), originalOfficials: structuredClone(originalOfficials),
    nextProofId: 1, retiredProofCount: 0, nextApplicationId: 1, nextPollId: 1, nextTermId: 1, proofs: [], applications: [], polls: [], terms: [] };
}
function original(state: SimState, actorId: string): CivicOriginalOfficial | undefined { return body(state)?.originalOfficials.find(row => row.actorId === actorId); }
function originalAtCurrentJob(state: SimState, person: Citizen): CivicOriginalOfficial | undefined {
  const source = original(state, person.id);
  return source && person.role === source.baseRole && person.workId === source.workId && person.districtId === source.districtId ? source : undefined;
}
function able(state: SimState, person: Citizen, hunger = 40, fatigue = 35): boolean {
  const profile = state.extension?.actorProfiles[person.id];
  return !!profile?.alive && profile.age >= 18 && profile.health >= 45 && person.needs.hunger >= hunger && person.needs.fatigue >= fatigue;
}
/** Civic authority never adds council to the person's spatial identity. */
function publicPoint(state: SimState, site: Building, position: Vec3): CivicPoint | null {
  if (site.kind !== 'hall' || !canAccessFloor(site, 0, { role: 'traveler', identities: ['traveler'] })
    || homeRestPointBlockedByVoxels(position, state.voxels)) return null;
  if (site.floorPlanProfile !== FLOOR_PLAN_PROFILE) {
    if (Math.abs(position.y - site.position.y - .6) > .26 || distance(position, site.door) > Math.max(site.width, site.depth) + 2) return null;
    return { floor: 0, pointId: 'legacy:0:service', position: copy(position) };
  }
  const support = floorPlanSupport(site, 0, position, .35);
  if (!support || !['room', 'stairs'].includes(support.kind) || Math.abs(support.y - position.y) > .26
    || blocksFloorPlanMovement(site, 0, position, position, .35, 1.72)) return null;
  const point = (site.functionPoints ?? getBuildingUsePoints(site, 0)).find(point => point.floor === 0 && point.purpose === 'service' && distance(point.position, position) <= 2);
  return point ? { floor: 0, pointId: point.id, position: copy(position) } : null;
}
function workPoint(sim: Simulation, site: Building, person: Citizen): CivicPoint | null {
  if (!sim.isNearBuilding(site, person.position, 2) || !sim.isAtBuildingFunctionPoint(site, person.position, 'work', { role: 'official', identities: ['official'] })
    || homeRestPointBlockedByVoxels(person.position, sim.state.voxels)) return null;
  const floor = Math.floor((person.position.y - site.position.y + .01) / (site.height / site.floors));
  if (!canAccessFloor(site, floor, { role: 'official', identities: ['official'] })) return null;
  const point = (site.functionPoints ?? getBuildingUsePoints(site, floor)).find(point => point.floor === floor && point.purpose === 'work' && distance(point.position, person.position) <= 2);
  if (site.floorPlanProfile === FLOOR_PLAN_PROFILE && !point) return null;
  return { floor, pointId: point?.id ?? `legacy:${floor}:work`, position: copy(person.position) };
}
function hasLiveTerm(state: SimState, actorId: string, at: number): boolean {
  return !!body(state)?.terms.some(term => term.actorId === actorId && term.startsAt <= at && at < term.endsAt && (term.endedAt === null || at < term.endedAt));
}
function districtSeats(state: SimState, districtId: string, at: number): number {
  return civicHistoryView(state).terms.filter(term => term.districtId === districtId && term.startsAt <= at && at < term.endsAt && (term.endedAt === null || at < term.endedAt)).length ?? 0;
}
export function civicCouncilSourceProof(state: SimState, actorId: string, at = clock(state)): CivicCouncilSourceProof | null {
  const civic = body(state), person = state.citizens.find(person => person.id === actorId);
  if (!civic || !person || !same(at, clock(state)) || !state.extension?.actorProfiles[actorId]?.alive || !originalAtCurrentJob(state, person)) return null;
  const term = civic.terms.find(term => term.actorId === actorId && term.startsAt <= at && at < term.endsAt && (term.endedAt === null || at < term.endedAt));
  return term ? { version: 1, kind: 'local-council-term', ruleId: CIVIC_RULESET, enablementId: civic.enablement.id,
    actorId, officeId: term.officeId, districtId: term.districtId, baseRole: term.baseRole,
    electionId: term.pollId, termId: term.id, proofId: term.proofId, signedAt: at, startsAt: term.startsAt, endsAt: term.endsAt } : null;
}
/** Past valid signatures survive current death/expiry/job change. */
export function validateCivicCouncilSourceProof(state: SimState, source: CivicCouncilSourceProof): boolean {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).sort().join(',') !== ['version', 'kind', 'ruleId', 'enablementId', 'actorId', 'officeId', 'districtId', 'baseRole', 'electionId', 'termId', 'proofId', 'signedAt', 'startsAt', 'endsAt'].sort().join(',')) return false;
  const civic = body(state), term = civicHistoryView(state).terms.find(term => term.id === source.termId);
  return !!civic && !!term && source.version === 1 && source.kind === 'local-council-term' && source.ruleId === CIVIC_RULESET && source.enablementId === civic.enablement.id
    && source.actorId === term.actorId && source.officeId === term.officeId && source.districtId === term.districtId && source.baseRole === term.baseRole
    && source.electionId === term.pollId && source.proofId === term.proofId && source.startsAt === term.startsAt && source.endsAt === term.endsAt
    && finite(source.signedAt) && source.signedAt <= clock(state) + EPS && source.signedAt >= term.startsAt && source.signedAt < term.endsAt && (term.endedAt === null || source.signedAt < term.endedAt);
}
export function civicStaffingActorReservedThisTick(sim: Simulation, actorId: string): boolean {
  const frame = frames.get(sim);
  return !!body(sim.state) && !!frame && frame.state === sim.state && frame.tick === sim.state.tick && frame.reserved.has(actorId);
}

function openPoll(state: SimState, districtId: string): CivicPoll | undefined { return body(state)?.polls.find(poll => poll.districtId === districtId && poll.result === 'open'); }
function uncastPoll(state: SimState, person: Citizen): CivicPoll | undefined {
  return body(state)?.polls.find(poll => poll.result === 'open' && poll.closesAt > clock(state) && poll.districtId === person.districtId
    && poll.eligible.some(voter => voter.actorId === person.id) && !poll.withdrawals.some(row => row.actorId === person.id)
    && !poll.ballots.some(ballot => ballot.actorId === person.id && ballot.completedAt !== null));
}
function readyProof(state: SimState, person: Citizen): CivicWorkProof | undefined {
  const day = Math.floor(clock(state) / 1440);
  const view = civicHistoryView(state);
  return view.proofs.find(proof => proof.actorId === person.id && proof.day === day && proof.completedAt !== null
    && !view.applications.some(application => application.proofId === proof.id));
}
export function civicStaffingOpportunities(sim: Simulation, person: Citizen): { destination: Building; activity: 'civicRegister' | 'civicVote'; score: number }[] {
  const state = sim.state, civic = body(state), profile = state.extension?.actorProfiles[person.id];
  if (!civic || !able(state, person, 45, 40) || !profile || profile.mood < 55 || profile.stress > 55 || state.energy < 25) return [];
  const result: { destination: Building; activity: 'civicRegister' | 'civicVote'; score: number }[] = [];
  const at = clock(state), source = originalAtCurrentJob(state, person);
  if (source && source.educationAtEnablement >= 2 && (person.education ?? 0) >= 2 && state.hour >= 8 && state.hour < 17
    && !hasLiveTerm(state, person.id, at) && !openPoll(state, person.districtId) && districtSeats(state, person.districtId, at) < CIVIC_DISTRICT_SEATS
    && person.money >= CIVIC_REGISTRATION_FEE + CIVIC_LIVING_RESERVE) {
    const application = civic.applications.find(application => application.actorId === person.id && !application.receipt && application.cancelledAt === null);
    if (application || readyProof(state, person)) {
      const site = sim.worldDefinition.buildings.find(site => site.id === source.workId);
      if (site?.kind === 'hall' && canAccessFloor(site, 0, { role: 'traveler', identities: ['traveler'] })) result.push({ destination: site, activity: 'civicRegister', score: 83 + (profile.mood - 55) * .1 });
    }
  }
  // Ordinary jobs remain intact. Residents visit after their ordinary shift,
  // rather than pulling the last doctor or teacher from paid daytime duty.
  const poll = state.hour >= 17.5 && state.hour < 20 ? uncastPoll(state, person) : undefined;
  if (poll) {
    const site = sim.worldDefinition.buildings.find(site => site.id === poll.officeId);
    if (site && sim.buildingTravelDistance(person.homeId, site.id) <= 500) result.push({ destination: site, activity: 'civicVote', score: 76 + (profile.mood - 55) * .1 });
  }
  return result;
}
export function civicStaffingNeedsContinuousPeople(state: SimState, person: Citizen): boolean {
  const civic = body(state); if (!civic) return false;
  return civic.applications.some(application => application.actorId === person.id && !application.receipt && application.cancelledAt === null)
    || civic.polls.some(poll => poll.result === 'open' && poll.ballots.some(ballot => ballot.actorId === person.id && ballot.completedAt === null));
}

function observePaid(sim: Simulation, event: Parameters<Parameters<Simulation['onEvent']>[1]>[0]): void {
  const frame = frames.get(sim), state = sim.state, civic = body(state);
  if (!civic || !frame || frame.state !== state || frame.tick !== state.tick || !isCanonicalNpcWage(event)
    || !event.citizenId || !event.siteId || !finite(event.minutes) || event.minutes <= 0 || !finite(event.amount) || event.amount <= 0
    || !finite(event.ratePerMinute) || event.ratePerMinute <= 0 || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt)
    || !same(event.creditedWorkEndAt - event.creditedWorkStartAt, event.minutes) || !same(event.minutes * event.ratePerMinute, event.amount)
    || event.creditedWorkEndAt > frame.clock + EPS) return;
  const person = state.citizens.find(person => person.id === event.citizenId), site = sim.worldDefinition.buildings.find(site => site.id === event.siteId);
  if (!person || !site || person.workId !== site.id) return;
  const floor = Math.floor((person.position.y - site.position.y + .01) / (site.height / site.floors));
  const point = workPoint(sim, site, person) ?? { floor, pointId: `native:${floor}:work`, position: copy(person.position) };
  const paid: Paid = { siteId: site.id, startAt: event.creditedWorkStartAt, endAt: event.creditedWorkEndAt,
    ratePerMinute: event.ratePerMinute, earned: event.amount, tick: state.tick, point };
  const rows = frame.paid.get(person.id) ?? [];
  if (!rows.some(row => row.siteId === paid.siteId && same(row.startAt, paid.startAt) && same(row.endAt, paid.endAt))) { rows.push(paid); frame.paid.set(person.id, rows); }
  const source = originalAtCurrentJob(state, person);
  if (!source || source.educationAtEnablement < 2 || (person.education ?? 0) < 2 || !able(state, person) || site.kind !== 'hall'
    || !workPoint(sim, site, person) || event.shopId || person.state !== 'working') return;
  const day = Math.floor(frame.clock / 1440), lower = Math.max(civic.enablement.enabledAt, day * 1440, paid.startAt);
  const upper = Math.min(frame.clock, paid.endAt);
  if (upper <= lower + EPS) return;
  let proof = civicHistoryView(state).proofs.find(proof => proof.actorId === person.id && proof.day === day);
  if (!proof) {
    if (civic.proofs.length >= PROOF_LIMIT) return;
    proof = { id: `civic-proof-${civic.nextProofId++}`, actorId: person.id, officeId: source.workId, districtId: source.districtId,
      baseRole: source.baseRole, day, enablementId: civic.enablement.id, startedAt: lower, completedAt: null, minutes: 0, earned: 0, windows: [] };
    civic.proofs.push(proof);
  }
  if (proof.completedAt !== null) return;
  const last = proof.windows.at(-1), startAt = Math.max(lower, last?.endAt ?? lower);
  const minutes = Math.min(upper - startAt, CIVIC_PROOF_MINUTES - proof.minutes);
  if (!(minutes > EPS)) return;
  const canMerge = !!last && same(last.endAt, startAt) && same(last.ratePerMinute, paid.ratePerMinute)
    && last.floor === point.floor && last.pointId === point.pointId && distance(last.position, point.position) < EPS;
  if (!canMerge && proof.windows.length >= PAID_WINDOW_LIMIT) return;
  const endAt = startAt + minutes, earned = minutes * paid.ratePerMinute;
  if (canMerge) { last!.lastTick = state.tick; last!.endAt = endAt; last!.minutes += minutes; last!.earned += earned; }
  else proof.windows.push({ ...point, position: copy(point.position), firstTick: state.tick, lastTick: state.tick, startAt, endAt, minutes, ratePerMinute: paid.ratePerMinute, earned });
  proof.minutes += minutes; proof.earned += earned;
  if (proof.minutes >= CIVIC_PROOF_MINUTES - EPS) { proof.minutes = CIVIC_PROOF_MINUTES; proof.completedAt = endAt; }
}
function subtract(ranges: { startAt: number; endAt: number }[], used: { startAt: number; endAt: number }[]): { startAt: number; endAt: number }[] {
  let result = ranges;
  for (const row of used) result = result.flatMap(range => range.endAt <= row.startAt || range.startAt >= row.endAt ? [range] : [
    ...(range.startAt < row.startAt ? [{ startAt: range.startAt, endAt: row.startAt }] : []),
    ...(range.endAt > row.endAt ? [{ startAt: row.endAt, endAt: range.endAt }] : []),
  ]);
  return result;
}
function ballotDecision(state: SimState, poll: CivicPoll, person: Citizen): CivicVoteDecision {
  const profile = state.extension!.actorProfiles[person.id], district = state.districts.find(district => district.id === poll.districtId)!;
  const source = original(state, poll.candidateId)!;
  return { support: state.support, mood: profile.mood, stress: profile.stress, prosperity: district.prosperity, candidateEducation: source.educationAtEnablement };
}
function ballotChoice(decision: CivicVoteDecision): CivicBallot['choice'] {
  return decision.support + (decision.mood - 50) * .2 - decision.stress * .2 + (decision.prosperity - 50) * .1 + (decision.candidateEducation - 2) * 2 > 50 ? 'support' : 'retain';
}
function queueTie(actorId: string, tick: number): number {
  // Rotating a simultaneous station queue does not choose an office holder.
  let value = 2166136261 ^ tick; for (const letter of actorId) value = Math.imul(value ^ letter.charCodeAt(0), 16777619); return value >>> 0;
}
function consumeArrivals(sim: Simulation): void {
  const frame = frames.get(sim), state = sim.state, civic = body(state);
  if (!civic || !frame || frame.state !== state || frame.tick !== state.tick) return;
  const stationUsed = new Map<string, { startAt: number; endAt: number }[]>();
  for (const presence of [...frame.arrivals].sort((a, b) => a.activityWindowStartAt - b.activityWindowStartAt || queueTie(a.citizenId, frame.tick) - queueTie(b.citizenId, frame.tick))) {
    const person = state.citizens.find(person => person.id === presence.citizenId), site = sim.worldDefinition.buildings.find(site => site.id === presence.siteId);
    if (!person || !site || !able(state, person) || state.energy < 25 || presence.activityObservedTick !== frame.tick || !same(presence.activityObservedClock, frame.clock)
      || !same(presence.activityWindowEndAt, frame.clock) || !finite(presence.activityWindowStartAt) || presence.activityWindowStartAt >= presence.activityWindowEndAt
      || distance(person.position, presence.activityPosition) > EPS || !sim.isNearBuilding(site, person.position, 2)
      || !sim.isAtBuildingFunctionPoint(site, person.position, 'service', { role: 'traveler', identities: ['traveler'] })) continue;
    const point = publicPoint(state, site, person.position); if (!point) continue;
    let target: CivicApplication | CivicBallot | undefined, poll: CivicPoll | undefined;
    if (presence.purpose === 'civicRegister') {
      const source = originalAtCurrentJob(state, person);
      if (!source || source.workId !== site.id || source.educationAtEnablement < 2 || (person.education ?? 0) < 2 || state.hour < 8 || state.hour >= 17
        || person.money < CIVIC_REGISTRATION_FEE + CIVIC_LIVING_RESERVE || hasLiveTerm(state, person.id, frame.clock)
        || openPoll(state, person.districtId) || districtSeats(state, person.districtId, frame.clock) >= CIVIC_DISTRICT_SEATS) continue;
      target = civic.applications.find(application => application.actorId === person.id && !application.receipt && application.cancelledAt === null);
      if (!target) {
        const proof = readyProof(state, person); if (!proof || civic.applications.length >= APPLICATION_LIMIT) continue;
        target = { id: `civic-application-${civic.nextApplicationId++}`, actorId: person.id, officeId: site.id, districtId: person.districtId,
          proofId: proof.id, startedAt: Math.max(frame.clock - frame.minutes, presence.activityWindowStartAt, proof.completedAt!), workedMinutes: 0,
          windows: [], receipt: null, pollId: null, cancelledAt: null, cancellationReason: '' };
        civic.applications.push(target);
      }
    } else {
      if (state.hour < 8 || state.hour >= 20) continue;
      poll = uncastPoll(state, person); if (!poll || poll.officeId !== site.id || clock(state) >= poll.closesAt) continue;
      target = poll.ballots.find(ballot => ballot.actorId === person.id);
      if (!target) {
        if (civic.polls.reduce((sum, poll) => sum + poll.ballots.length, 0) >= BALLOT_LIMIT) continue;
        const decision = ballotDecision(state, poll, person);
        target = { actorId: person.id, choice: ballotChoice(decision), decision,
          startedAt: Math.max(frame.clock - frame.minutes, presence.activityWindowStartAt, poll.openedAt), completedAt: null, workedMinutes: 0, windows: [] };
        poll.ballots.push(target);
      }
    }
    if (target.workedMinutes >= 1 - EPS || target.windows.length >= ACTIVITY_WINDOW_LIMIT) continue;
    const paid = frame.paid.get(person.id) ?? [], used = stationUsed.get(site.id) ?? [];
    const lower = Math.max(frame.clock - frame.minutes, civic.enablement.enabledAt, presence.activityWindowStartAt, target.startedAt);
    const upper = Math.min(frame.clock, poll?.closesAt ?? frame.clock);
    const free = subtract(subtract(lower < upper ? [{ startAt: lower, endAt: upper }] : [], paid), used).slice(0, ACTIVITY_WINDOW_LIMIT - target.windows.length);
    const request = Math.min(1 - target.workedMinutes, free.reduce((sum, range) => sum + range.endAt - range.startAt, 0), actorActivityAvailable(sim, person.id, frame.minutes));
    const activityId = poll ? `civic-vote:${poll.id}:${person.id}` : `civic-register:${(target as CivicApplication).id}`;
    const credited = claimActorActivityMinutes(sim, person.id, activityId, request, frame.minutes);
    let remaining = credited;
    for (const range of free) {
      if (remaining <= EPS || target.windows.length >= ACTIVITY_WINDOW_LIMIT) break;
      const minutes = Math.min(remaining, range.endAt - range.startAt), endAt = range.startAt + minutes;
      target.windows.push({ ...point, position: copy(point.position), tick: frame.tick, phaseMinutes: frame.minutes, observedClock: frame.clock, displayHour: state.hour,
        startAt: range.startAt, endAt, excludedPaid: paid.map(row => ({ siteId: row.siteId, startAt: row.startAt, endAt: row.endAt, ratePerMinute: row.ratePerMinute, earned: row.earned })) });
      target.workedMinutes += minutes; remaining -= minutes; used.push({ startAt: range.startAt, endAt });
    }
    if (credited > EPS) { frame.reserved.add(person.id); stationUsed.set(site.id, used); }
    if (poll && target.workedMinutes >= 1 - EPS) { target.workedMinutes = 1; (target as CivicBallot).completedAt = target.windows.at(-1)!.endAt; }
  }
}
function registrationWitnesses(sim: Simulation, frame: Frame, application: CivicApplication): CivicWitness[] {
  const site = sim.worldDefinition.buildings.find(site => site.id === application.officeId)!;
  const witnesses: CivicWitness[] = [];
  for (const [actorId, rows] of frame.paid) {
    const person = sim.state.citizens.find(person => person.id === actorId);
    if (!person || actorId === application.actorId || !originalAtCurrentJob(sim.state, person) || person.workId !== site.id || person.state !== 'working' || !able(sim.state, person)) continue;
    const point = workPoint(sim, site, person), paid = rows.find(row => row.siteId === site.id && row.startAt < frame.clock && same(row.endAt, frame.clock));
    if (point && paid) {
      const startAt = Math.max(paid.startAt, frame.clock - frame.minutes, body(sim.state)!.enablement.enabledAt);
      if (startAt < paid.endAt) witnesses.push({ ...point, actorId, officeId: site.id, baseRole: person.role as CivicOriginalOfficial['baseRole'], signedAt: frame.clock,
        paid: { startAt, endAt: paid.endAt, ratePerMinute: paid.ratePerMinute, earned: (paid.endAt - startAt) * paid.ratePerMinute, tick: frame.tick } });
    }
  }
  return witnesses.sort((a, b) => a.paid.startAt - b.paid.startAt || queueTie(a.actorId, frame.tick) - queueTie(b.actorId, frame.tick)).slice(0, 2);
}
function completeRegistrations(sim: Simulation): void {
  const frame = frames.get(sim), state = sim.state, civic = body(state);
  if (!frame || !civic || frame.state !== state || frame.tick !== state.tick || state.hour < 8 || state.hour >= 17 || state.energy < 25) return;
  for (const application of civic.applications.filter(application => !application.receipt && application.cancelledAt === null && application.workedMinutes >= 1 - EPS)
    .sort((a, b) => a.windows.at(-1)!.endAt - b.windows.at(-1)!.endAt || queueTie(a.actorId, frame.tick) - queueTie(b.actorId, frame.tick))) {
    const person = state.citizens.find(person => person.id === application.actorId)!, source = originalAtCurrentJob(state, person);
    const present = frame.arrivals.some(presence => presence.citizenId === person.id && presence.siteId === application.officeId && presence.purpose === 'civicRegister');
    if (!source || !able(state, person) || !present || person.money < CIVIC_REGISTRATION_FEE + CIVIC_LIVING_RESERVE
      || openPoll(state, application.districtId) || hasLiveTerm(state, person.id, frame.clock) || districtSeats(state, application.districtId, frame.clock) >= CIVIC_DISTRICT_SEATS
      || civic.polls.length >= POLL_LIMIT || civic.terms.length >= TERM_LIMIT || state.treasury > 1e12 - CIVIC_REGISTRATION_FEE) continue;
    const witnesses = registrationWitnesses(sim, frame, application);
    if (witnesses.length !== 2 || Math.max(...witnesses.map(witness => witness.paid.startAt)) >= Math.min(...witnesses.map(witness => witness.paid.endAt))) continue;
    const profile = state.extension!.actorProfiles[person.id], before = person.money, treasury = state.treasury;
    person.money -= CIVIC_REGISTRATION_FEE; state.treasury += CIVIC_REGISTRATION_FEE;
    const extensionRuntime = Reflect.get(state.extension!, 'runtime'); if (extensionRuntime) extensionRuntime.lastTreasury += CIVIC_REGISTRATION_FEE;
    state.extension!.publicLedger.push({ tick: state.tick, actorId: person.id, amount: CIVIC_REGISTRATION_FEE,
      purpose: '本区居民补选本人登记费', account: 'public', districtId: application.districtId });
    if (state.extension!.publicLedger.length > 512) state.extension!.publicLedger.splice(0, state.extension!.publicLedger.length - 512);
    application.receipt = { paidAt: frame.clock, tick: state.tick, displayHour: state.hour, amount: CIVIC_REGISTRATION_FEE, moneyBefore: before, moneyAfter: person.money,
      treasuryBefore: treasury, treasuryAfter: state.treasury, candidateAge: profile.age, candidateEducation: person.education ?? 0, witnesses };
    const poll: CivicPoll = { id: `civic-poll-${civic.nextPollId++}`, applicationId: application.id, candidateId: person.id,
      officeId: application.officeId, districtId: application.districtId, proofId: application.proofId, openedAt: frame.clock, closesAt: frame.clock + CIVIC_POLL_MINUTES,
      openingCensus: state.citizens.map(voter => ({ actorId: voter.id, districtId: voter.districtId,
        ageAtOpening: state.extension!.actorProfiles[voter.id].age, aliveAtOpening: state.extension!.actorProfiles[voter.id].alive })),
      eligible: state.citizens.filter(voter => voter.districtId === application.districtId && state.extension!.actorProfiles[voter.id]?.alive && state.extension!.actorProfiles[voter.id].age >= 18)
        .map(voter => ({ actorId: voter.id, districtId: voter.districtId, ageAtOpening: state.extension!.actorProfiles[voter.id].age })),
      withdrawals: [], ballots: [], countedAt: null, result: 'open', count: null, termId: null };
    application.pollId = poll.id; civic.polls.push(poll);
    sim.appendNotice('civic-local-poll', `${person.name}已凭原岗位60分钟实薪来源、本人120文登记和同官署两名在岗官员见证开启本区两日现场补选。`, poll.districtId);
  }
}
function closeUnavailable(state: SimState): void {
  const civic = body(state); if (!civic) return;
  const at = clock(state);
  for (const application of civic.applications) {
    if (application.receipt || application.cancelledAt !== null) continue;
    const person = state.citizens.find(person => person.id === application.actorId)!, source = original(state, person.id)!;
    const reason: CivicApplication['cancellationReason'] = !state.extension!.actorProfiles[person.id]?.alive ? 'death'
      : person.role !== source.baseRole || person.workId !== source.workId ? 'profession-changed'
      : person.districtId !== source.districtId ? 'residency-changed'
      : Math.floor(at / 1440) !== civicHistoryView(state).proofs.find(proof => proof.id === application.proofId)!.day ? 'expired-proof' : '';
    if (reason) { application.cancelledAt = at; application.cancellationReason = reason; }
  }
  for (const term of civic.terms) {
    if (term.endedAt !== null) continue;
    const person = state.citizens.find(person => person.id === term.actorId)!;
    const reason: CivicTerm['endedReason'] = at >= term.endsAt ? 'expired' : !state.extension!.actorProfiles[person.id]?.alive ? 'death'
      : person.role !== term.baseRole || person.workId !== term.officeId ? 'profession-changed'
      : person.districtId !== term.districtId ? 'residency-changed' : '';
    if (reason) { term.endedAt = reason === 'expired' ? term.endsAt : at; term.endedTick = state.tick; term.endedReason = reason; }
  }
  for (const poll of civic.polls) {
    if (poll.result !== 'open') continue;
    for (const eligible of poll.eligible) {
      if (poll.withdrawals.some(row => row.actorId === eligible.actorId) || poll.ballots.some(ballot => ballot.actorId === eligible.actorId && ballot.completedAt !== null)) continue;
      const person = state.citizens.find(person => person.id === eligible.actorId)!;
      const reason: CivicWithdrawal['reason'] | '' = !state.extension!.actorProfiles[person.id]?.alive ? 'death' : person.districtId !== eligible.districtId ? 'residency-changed' : '';
      if (reason) poll.withdrawals.push({ actorId: person.id, at, tick: state.tick, reason });
    }
  }
}
function countPolls(sim: Simulation): void {
  const state = sim.state, civic = body(state); if (!civic) return;
  const at = clock(state);
  for (const poll of civic.polls) {
    if (poll.result !== 'open' || at < poll.closesAt - EPS) continue;
    const cast = poll.ballots.filter(ballot => ballot.completedAt !== null), eligible = poll.eligible.length - poll.withdrawals.length;
    const support = cast.filter(ballot => ballot.choice === 'support').length, retain = cast.length - support;
    poll.count = { eligible, quorum: Math.max(3, Math.ceil(eligible / 2)), turnout: cast.length, support, retain }; poll.countedAt = at;
    const person = state.citizens.find(person => person.id === poll.candidateId)!;
    if (!state.extension!.actorProfiles[person.id]?.alive || !originalAtCurrentJob(state, person)) poll.result = 'candidate-unavailable';
    else if (cast.length < poll.count.quorum) poll.result = 'no-quorum';
    else if (support <= retain) poll.result = 'defeated';
    else if (districtSeats(state, poll.districtId, at) >= CIVIC_DISTRICT_SEATS || civic.terms.length >= TERM_LIMIT) poll.result = 'no-seat';
    else {
      poll.result = 'elected';
      const source = original(state, person.id)!;
      const term: CivicTerm = { id: `civic-term-${civic.nextTermId++}`, actorId: person.id, officeId: poll.officeId, districtId: poll.districtId,
        baseRole: source.baseRole, enablementId: civic.enablement.id, pollId: poll.id, proofId: poll.proofId, startsAt: at, endsAt: at + CIVIC_TERM_MINUTES,
        endedAt: null, endedTick: null, endedReason: '' };
      civic.terms.push(term); poll.termId = term.id;
      sim.appendNotice('civic-local-term', `${person.name}经本区${cast.length}张实际现场票当选十四日地方议员副身份；原职业、雇主、工资和楼层许可保留。`, poll.districtId);
    }
  }
}
export function installCivicStaffing(sim: Simulation, hooks: CivicStaffingHooks): void {
  if (installs.has(sim)) return; installs.add(sim);
  sim.registerSaveValidator(candidate => validateCivicStaffing(candidate, sim.worldDefinition));
  sim.onLoad(() => { frames.delete(sim); });
  sim.onPhase('time', (_state, minutes) => {
    if (!hooks.enabled() || !body(sim.state)) { frames.delete(sim); return; }
    const civic = body(sim.state)!, day = Math.floor(clock(sim.state) / 1440);
    const view = civicHistoryView(sim.state);
    const pinned = new Set([...view.applications.map(row => row.proofId), ...view.polls.map(row => row.proofId), ...view.terms.map(row => row.proofId)]);
    const remaining = civic.proofs.filter(proof => proof.day >= day || pinned.has(proof.id));
    if (remaining.length !== civic.proofs.length) { civic.retiredProofCount += civic.proofs.length - remaining.length; civic.proofs = remaining; }
    frames.set(sim, { state: sim.state, tick: sim.state.tick, clock: clock(sim.state), minutes, paid: new Map(), arrivals: [], reserved: new Set() });
  });
  sim.onEvent('wage-earned', event => { if (hooks.enabled()) observePaid(sim, event); });
  sim.onEvent('civic-activity-window', event => {
    const frame = frames.get(sim);
    if (!hooks.enabled() || !frame || frame.state !== sim.state || frame.tick !== sim.state.tick || !hooks.isCanonicalPresence(event)
      || !finite(event.minutes) || !same(event.minutes, frame.minutes)
      || !event.citizenId || !event.siteId || !['civicRegister', 'civicVote'].includes(event.purpose ?? '') || !finite(event.activityObservedTick)
      || !finite(event.activityObservedClock) || !finite(event.activityWindowStartAt) || !finite(event.activityWindowEndAt) || !event.activityPosition
      || frame.arrivals.some(row => row.citizenId === event.citizenId)) return;
    frame.arrivals.push({ citizenId: event.citizenId, siteId: event.siteId, purpose: event.purpose as Presence['purpose'],
      activityObservedTick: event.activityObservedTick, activityObservedClock: event.activityObservedClock,
      activityWindowStartAt: event.activityWindowStartAt, activityWindowEndAt: event.activityWindowEndAt, activityPosition: copy(event.activityPosition) });
  });
  sim.onPhase('people', () => { if (!hooks.enabled()) return; closeUnavailable(sim.state); consumeArrivals(sim); completeRegistrations(sim); });
  sim.onPhase('politics', () => { if (!hooks.enabled()) return; closeUnavailable(sim.state); countPolls(sim); });
}

/** Business provenance validation runs before the core commits any imported
 * state. The core separately validates cutover profession against candidate
 * runtime/world origins, plus envelope/enablement/marker/manifest pairing. */
export function validateCivicStaffing(state: SimState, world: WorldDefinition): void {
  const civic = body(state); if (civic === undefined) return;
  function need(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(`civic staffing ${label}`); }
  const shape = (value: unknown, keys: string[], label: string) => need(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','), label);
  const number = (value: unknown, min: number, max: number, label: string, integer = false) => need(finite(value) && value >= min - EPS && value <= max + EPS && (!integer || Number.isInteger(value)), label);
  const string = (value: unknown, label: string, max = 240) => need(typeof value === 'string' && value.length > 0 && value.length <= max, label);
  const rows = <T>(value: unknown, max: number, label: string): T[] => { need(Array.isArray(value) && value.length <= max, label); return value as T[]; };
  const now = clock(state), actors = new Map(state.citizens.map(person => [person.id, person])), sites = new Map(world.buildings.map(site => [site.id, site]));
  const districts = new Set(world.districts.map(district => district.id));
  const position = (value: Vec3, label: string) => { shape(value, ['x', 'y', 'z'], label); for (const n of [value.x, value.y, value.z]) number(n, -1e8, 1e8, label); };
  const point = (value: CivicPoint, siteId: string, purpose: 'work' | 'service') => {
    const site = sites.get(siteId); need(site?.kind === 'hall', 'original hall'); number(value.floor, 0, site!.floors - 1, 'physical floor', true);
    string(value.pointId, 'point id'); position(value.position, 'original point position');
    const identity = purpose === 'service' ? 'traveler' : 'official'; need(canAccessFloor(site!, value.floor, { role: identity, identities: [identity] }), 'base spatial permission');
    if (purpose === 'service') need(value.floor === 0 && value.pointId !== 'native:0:work', 'public ground service point');
    if (site!.floorPlanProfile === FLOOR_PLAN_PROFILE) {
      const actual = (site!.functionPoints ?? getBuildingUsePoints(site!, value.floor)).find(actual => actual.id === value.pointId && actual.floor === value.floor && actual.purpose === purpose);
      const support = floorPlanSupport(site!, value.floor, value.position, .35);
      need(actual && distance(actual.position, value.position) <= 2 + EPS && support && ['room', 'stairs'].includes(support.kind)
        && Math.abs(support.y - value.position.y) <= .26 && !blocksFloorPlanMovement(site!, value.floor, value.position, value.position, .35, 1.72), 'saved actual function point');
    } else need(value.pointId === `legacy:${value.floor}:${purpose}` && Math.abs(value.position.y - site!.position.y - .6 - value.floor * site!.height / site!.floors) <= .26
      && Math.abs(value.position.x - site!.position.x) <= site!.width / 2 + 2 && Math.abs(value.position.z - site!.position.z) <= site!.depth / 2 + 2, 'saved legacy original point');
  };
  shape(civic, ['version', 'enablement', 'originalOfficials', 'nextProofId', 'retiredProofCount', 'nextApplicationId', 'nextPollId', 'nextTermId', 'proofs', 'applications', 'polls', 'terms', ...(civic.version === 2 ? ['historyId'] : [])], 'exact business body');
  need(civic.version === 1 || civic.version === 2, 'business version');
  if (civic.version === 1) need(state.civicHistory === undefined, 'legacy body cannot silently archive');
  else need(state.civicHistory && civic.historyId === state.civicHistory.id, 'history body paired identity');
  const enabled = civic.enablement;
  shape(enabled, ['id', 'ruleVersion', 'origin', 'enabledAt', 'enabledTick', ...(enabled?.sourceSave === undefined ? [] : ['sourceSave'])], 'enablement shape');
  string(enabled.id, 'enablement id'); need(enabled.ruleVersion === 1 && ['new-city', 'host-upgrade'].includes(enabled.origin), 'enablement rule');
  number(enabled.enabledAt, 0, now, 'cutover clock'); number(enabled.enabledTick, 0, state.tick, 'cutover tick', true);
  if (enabled.origin === 'new-city') need(enabled.sourceSave === undefined, 'new city cannot borrow migration provenance');
  else {
    const saved = enabled.sourceSave; shape(saved, ['sha256', 'version', 'motionVersion'], 'trusted upgrade original reference');
    need(saved && /^[a-f0-9]{64}$/.test(saved.sha256) && [1, 2].includes(saved.version) && [1, 2].includes(saved.motionVersion), 'upgrade reference format');
  }
  const originals = rows<CivicOriginalOfficial>(civic.originalOfficials, 896, 'cutover official metadata'), seenOriginals = new Set<string>();
  for (const source of originals) {
    shape(source, ['actorId', 'baseRole', 'workId', 'districtId', 'educationAtEnablement', 'source'], 'cutover profession shape');
    need(actors.has(source.actorId) && !seenOriginals.has(source.actorId) && officialRole(source.baseRole), 'unique original official'); seenOriginals.add(source.actorId);
    need(sites.get(source.workId)?.kind === 'hall' && sites.get(source.workId)?.districtId === source.districtId && districts.has(source.districtId), 'same district hall source');
    number(source.educationAtEnablement, 0, 12, 'cutover education', true);
    if (source.source?.kind === 'initial-profession') { shape(source.source, ['kind'], 'initial source shape'); need(enabled.origin === 'new-city', 'upgrade cannot invent initial source'); }
    else { shape(source.source, ['kind', 'revision'], 'employment source shape'); need(source.source.kind === 'public-employment', 'known official source'); number(source.source.revision, 0, 1024, 'employment revision', true); }
  }
  rows<CivicWorkProof>(civic.proofs, PROOF_LIMIT, 'bounded live work proofs');
  rows<CivicApplication>(civic.applications, APPLICATION_LIMIT, 'bounded live applications');
  rows<CivicPoll>(civic.polls, POLL_LIMIT, 'bounded live polls'); rows<CivicTerm>(civic.terms, TERM_LIMIT, 'bounded live terms');
  const cold = civic.version === 2 ? decodeCivicHistory(state.civicHistory!, enabled.id, now, state.tick) : { proofs: [], applications: [], polls: [], terms: [] };
  const { proofs: proofRows, applications, polls, terms } = civicHistoryView(state);
  if (civic.version === 2) {
    need(cold.proofs.every(proof => proof.completedAt !== null), 'immutable archived paid proof');
    need(cold.applications.every(application => application.cancelledAt !== null && application.receipt === null
      || application.receipt !== null && cold.polls.some(poll => poll.id === application.pollId && poll.result !== 'open' && poll.countedAt !== null)), 'immutable archived application');
    need(cold.polls.every(poll => poll.result !== 'open' && poll.countedAt !== null
      && cold.applications.some(application => application.id === poll.applicationId && application.receipt !== null)), 'immutable archived counted poll and paid application');
    need(cold.terms.every(term => term.endedAt !== null && term.endedTick !== null), 'immutable archived ended term');
    const history = state.civicHistory!, pages = new Map(history.pages.map(page => [page.id, page]));
    const sealed = (kind: 'proofs' | 'applications' | 'polls' | 'terms', id: string, endAt: number, endTick: number) => {
      const entry = history.index[kind].find(entry => entry.id === id), page = entry && pages.get(entry.parts[0].pageId);
      need(page && endAt <= page.sealedAt + EPS && endTick <= page.sealedTick, 'original record final before immutable sealing');
    };
    for (const proof of cold.proofs) {
      const closedAt = cold.applications.filter(application => application.proofId === proof.id).map(application => application.cancelledAt
        ?? cold.polls.find(poll => poll.id === application.pollId)?.countedAt ?? Number.POSITIVE_INFINITY);
      need(closedAt.length > 0 && closedAt.some(at => Number.isFinite(at)), 'archived proof belongs to a retained actually closed application');
      sealed('proofs', proof.id, Math.max(proof.completedAt!, Math.min(...closedAt)), proof.windows.at(-1)!.lastTick);
    }
    for (const application of cold.applications) sealed('applications', application.id, application.cancelledAt ?? cold.polls.find(poll => poll.id === application.pollId)!.countedAt!,
      application.receipt?.tick ?? application.windows.at(-1)?.tick ?? enabled.enabledTick);
    for (const poll of cold.polls) sealed('polls', poll.id, poll.countedAt!, Math.max(enabled.enabledTick,
      ...poll.withdrawals.map(row => row.tick), ...poll.ballots.flatMap(ballot => ballot.windows.map(window => window.tick))));
    for (const term of cold.terms) sealed('terms', term.id, term.endedAt!, term.endedTick!);
    const origin = state.civicHistory!.origin;
    need(origin.createdAt >= enabled.enabledAt && origin.createdTick >= enabled.enabledTick, 'history cannot precede enablement');
    if (origin.kind === 'new-city') need(enabled.origin === 'new-city' && origin.createdAt === enabled.enabledAt && origin.createdTick === enabled.enabledTick, 'history new-city origin');
    else {
      const counts = origin.sourceCounts;
      need(counts.nextProofId <= civic.nextProofId && counts.nextApplicationId <= civic.nextApplicationId && counts.nextPollId <= civic.nextPollId
        && counts.nextTermId <= civic.nextTermId && counts.retiredProofCount <= civic.retiredProofCount, 'immutable format cutover counters');
    }
  }
  const ids = <T extends { id: string }>(values: T[], prefix: string, next: number) => {
    number(next, values.length + 1, values.length + 1, `${prefix} contiguous counter`, true);
    for (const [index, value] of values.entries()) need(value.id === `${prefix}${index + 1}`, `${prefix} ordered identity`);
  };
  number(civic.retiredProofCount, 0, 1e9, 'retired unreferenced proof count', true);
  number(civic.nextProofId, proofRows.length + civic.retiredProofCount + 1, proofRows.length + civic.retiredProofCount + 1, 'monotonic proof counter', true);
  let proofNumber = 0;
  for (const proof of proofRows) { need(/^civic-proof-[1-9][0-9]*$/.test(proof.id), 'proof identity'); const id = Number(proof.id.slice('civic-proof-'.length)); need(id > proofNumber && id < civic.nextProofId, 'retained ordered monotonic proof identity'); proofNumber = id; }
  ids(applications, 'civic-application-', civic.nextApplicationId); ids(polls, 'civic-poll-', civic.nextPollId); ids(terms, 'civic-term-', civic.nextTermId);
  const proofDays = new Set<string>();
  for (const proof of proofRows) {
    shape(proof, ['id', 'actorId', 'officeId', 'districtId', 'baseRole', 'day', 'enablementId', 'startedAt', 'completedAt', 'minutes', 'earned', 'windows'], 'work proof shape');
    const source = originals.find(source => source.actorId === proof.actorId); need(source && source.educationAtEnablement >= 2 && proof.officeId === source.workId && proof.districtId === source.districtId && proof.baseRole === source.baseRole && proof.enablementId === enabled.id, 'work proof original profession');
    number(proof.day, Math.floor(enabled.enabledAt / 1440), Math.floor(now / 1440), 'proof actual day', true);
    const key = `${proof.actorId}:${proof.day}`; need(!proofDays.has(key), 'one proof per actual day'); proofDays.add(key);
    number(proof.startedAt, Math.max(enabled.enabledAt, proof.day * 1440), Math.min(now, (proof.day + 1) * 1440), 'proof after cutover');
    const windows = rows<CivicPaidWindow>(proof.windows, PAID_WINDOW_LIMIT, 'actual paid proof windows'); need(windows.length > 0, 'proof has actual wages');
    let minutes = 0, earned = 0, lastAt = proof.startedAt, lastTick = enabled.enabledTick;
    for (const paid of windows) {
      shape(paid, ['floor', 'pointId', 'position', 'firstTick', 'lastTick', 'startAt', 'endAt', 'minutes', 'ratePerMinute', 'earned'], 'actual paid proof shape');
      point(paid, proof.officeId, 'work'); number(paid.firstTick, lastTick, state.tick, 'paid first tick', true); number(paid.lastTick, paid.firstTick, state.tick, 'paid last tick', true); lastTick = paid.lastTick;
      number(paid.startAt, lastAt, Math.min(now, (proof.day + 1) * 1440), 'paid source start'); number(paid.endAt, paid.startAt, Math.min(now, (proof.day + 1) * 1440), 'paid source end');
      number(paid.minutes, EPS, CIVIC_PROOF_MINUTES, 'positive paid minutes'); number(paid.ratePerMinute, EPS, 1e9, 'real positive wage rate'); number(paid.earned, EPS, 1e12, 'earned wages');
      need(same(paid.endAt - paid.startAt, paid.minutes) && same(paid.minutes * paid.ratePerMinute, paid.earned), 'paid interval amount conservation');
      minutes += paid.minutes; earned += paid.earned; lastAt = paid.endAt;
    }
    number(proof.minutes, EPS, CIVIC_PROOF_MINUTES, 'bounded proof minutes'); number(proof.earned, EPS, 1e12, 'proof earned total');
    need(same(minutes, proof.minutes) && same(earned, proof.earned) && same(windows[0].startAt, proof.startedAt), 'proof cumulative actual source');
    if (proof.completedAt === null) need(proof.minutes < CIVIC_PROOF_MINUTES - EPS, 'unfinished proof cannot grant qualification');
    else need(same(proof.minutes, CIVIC_PROOF_MINUTES) && same(proof.completedAt, lastAt), 'completed exactly sixty real minutes');
  }
  const allActivity: { actorId: string; siteId: string; startAt: number; endAt: number }[] = [];
  const activity = (windowsValue: CivicActivityWindow[], actorId: string, siteId: string, lower: number, upper: number, total: number) => {
    const windows = rows<CivicActivityWindow>(windowsValue, ACTIVITY_WINDOW_LIMIT, 'bounded civic activity intervals');
    let worked = 0, lastAt = lower, lastTick = enabled.enabledTick;
    for (const window of windows) {
      shape(window, ['floor', 'pointId', 'position', 'tick', 'phaseMinutes', 'observedClock', 'displayHour', 'startAt', 'endAt', 'excludedPaid'], 'exact activity provenance'); point(window, siteId, 'service');
      number(window.tick, lastTick, state.tick, 'activity observed tick', true); lastTick = window.tick;
      number(window.phaseMinutes, .0625, 4, 'current core phase minutes'); number(window.observedClock, lower, now, 'actual observer clock');
      number(window.displayHour, 8, 20 - EPS, 'actual public schedule hour');
      number(window.startAt, Math.max(lastAt, window.observedClock - window.phaseMinutes, enabled.enabledAt), Math.min(upper, window.observedClock), 'real arrival tail start');
      number(window.endAt, window.startAt + EPS, Math.min(upper, window.observedClock), 'real arrival tail end');
      const excluded = rows<CivicActivityWindow['excludedPaid'][number]>(window.excludedPaid, 16, 'known concurrent canonical wages');
      for (const paid of excluded) {
        shape(paid, ['siteId', 'startAt', 'endAt', 'ratePerMinute', 'earned'], 'excluded paid source shape'); need(sites.has(paid.siteId), 'excluded original employer');
        number(paid.startAt, 0, window.observedClock, 'excluded paid start'); number(paid.endAt, paid.startAt + EPS, window.observedClock, 'excluded paid end');
        number(paid.ratePerMinute, EPS, 1e9, 'excluded paid rate'); number(paid.earned, EPS, 1e12, 'excluded earned amount'); need(same(paid.earned, (paid.endAt - paid.startAt) * paid.ratePerMinute), 'excluded real wages conservation');
        need(window.endAt <= paid.startAt + EPS || window.startAt >= paid.endAt - EPS, 'unpaid civic cannot overlap actual paid wages');
      }
      for (const proof of proofRows.filter(proof => proof.actorId === actorId)) for (const paid of proof.windows)
        need(window.endAt <= paid.startAt + EPS || window.startAt >= paid.endAt - EPS, 'unpaid civic cannot reuse recorded sixty-minute source');
      worked += window.endAt - window.startAt; lastAt = window.endAt; allActivity.push({ actorId, siteId, startAt: window.startAt, endAt: window.endAt });
    }
    number(total, 0, 1, 'single real minute'); need(same(worked, total) && (total > EPS ? windows.length > 0 : windows.length === 0), 'one minute actual interval sum');
    return lastAt;
  };
  const usedProofs = new Set<string>();
  for (const application of applications) {
    shape(application, ['id', 'actorId', 'officeId', 'districtId', 'proofId', 'startedAt', 'workedMinutes', 'windows', 'receipt', 'pollId', 'cancelledAt', 'cancellationReason'], 'application shape');
    const proof = proofRows.find(proof => proof.id === application.proofId); need(proof && proof.completedAt !== null && proof.actorId === application.actorId && proof.officeId === application.officeId && proof.districtId === application.districtId && !usedProofs.has(proof.id), 'application real unique completed proof'); usedProofs.add(proof.id);
    number(application.startedAt, proof.completedAt!, Math.min(now, (proof.day + 1) * 1440), 'application starts after real proof');
    const lastAt = activity(application.windows, application.actorId, application.officeId, application.startedAt, Math.min(now, (proof.day + 1) * 1440), application.workedMinutes);
    for (const window of application.windows) need(window.displayHour >= 8 && window.displayHour < 17, 'actual registration office hours');
    if (application.cancelledAt === null) need(application.cancellationReason === '', 'no imaginary cancellation');
    else { number(application.cancelledAt, lastAt, now, 'real cancellation observed clock'); need(['death', 'profession-changed', 'residency-changed', 'expired-proof'].includes(application.cancellationReason) && application.receipt === null && application.pollId === null, 'unfinished application termination'); }
    if (!application.receipt) { need(application.pollId === null, 'unpaid application creates no poll'); continue; }
    need(application.cancelledAt === null && same(application.workedMinutes, 1), 'registration requires real completed form');
    const receipt = application.receipt;
    shape(receipt, ['paidAt', 'tick', 'displayHour', 'amount', 'moneyBefore', 'moneyAfter', 'treasuryBefore', 'treasuryAfter', 'candidateAge', 'candidateEducation', 'witnesses'], 'registration real payment shape');
    number(receipt.paidAt, lastAt, Math.min(now, (proof.day + 1) * 1440), 'actual payment same proof day'); number(receipt.tick, application.windows.at(-1)!.tick, state.tick, 'payment tick', true);
    number(receipt.displayHour, 8, 17 - EPS, 'actual registration schedule hour');
    need(receipt.displayHour < 17, 'registration closes at seventeen');
    need(receipt.amount === CIVIC_REGISTRATION_FEE, 'original finite fee'); number(receipt.moneyBefore, CIVIC_REGISTRATION_FEE + CIVIC_LIVING_RESERVE, 1e9, 'payer original money'); number(receipt.moneyAfter, CIVIC_LIVING_RESERVE, 1e9, 'payer living reserve');
    number(receipt.treasuryBefore, 0, 1e12 - CIVIC_REGISTRATION_FEE, 'public receiver capacity'); number(receipt.treasuryAfter, CIVIC_REGISTRATION_FEE, 1e12, 'public actual balance');
    need(same(receipt.moneyBefore - receipt.moneyAfter, CIVIC_REGISTRATION_FEE) && same(receipt.treasuryAfter - receipt.treasuryBefore, CIVIC_REGISTRATION_FEE), 'resident fee debit equals public credit');
    number(receipt.candidateAge, 18, 140, 'adult candidate'); number(receipt.candidateEducation, 2, 12, 'original qualification');
    const witnesses = rows<CivicWitness>(receipt.witnesses, 2, 'two real officials'); need(witnesses.length === 2 && witnesses[0].actorId !== witnesses[1].actorId, 'two distinct witness people');
    for (const witness of witnesses) {
      shape(witness, ['floor', 'pointId', 'position', 'actorId', 'officeId', 'baseRole', 'signedAt', 'paid'], 'witness shape');
      const source = originals.find(source => source.actorId === witness.actorId); need(source && source.workId === application.officeId && source.baseRole === witness.baseRole && witness.actorId !== application.actorId && witness.officeId === application.officeId, 'same original institution and no self witnessing');
      point(witness, witness.officeId, 'work'); need(same(witness.signedAt, receipt.paidAt), 'witness actual signing time');
      shape(witness.paid, ['startAt', 'endAt', 'ratePerMinute', 'earned', 'tick'], 'witness real paid source'); need(witness.paid.tick === receipt.tick && same(witness.paid.endAt, receipt.paidAt), 'witness current paid tail');
      number(witness.paid.startAt, enabled.enabledAt, receipt.paidAt - EPS, 'witness paid start'); number(witness.paid.ratePerMinute, EPS, 1e9, 'witness actual rate'); number(witness.paid.earned, EPS, 1e12, 'witness positive earned wages');
      need(receipt.paidAt - witness.paid.startAt <= 4 + EPS, 'witness source clipped to one actual core phase');
      need(same(witness.paid.earned, (witness.paid.endAt - witness.paid.startAt) * witness.paid.ratePerMinute), 'witness paid minutes amount conservation');
    }
    need(Math.max(...witnesses.map(witness => witness.paid.startAt)) < Math.min(...witnesses.map(witness => witness.paid.endAt)), 'two simultaneous real paid witnesses');
    need(polls.some(poll => poll.id === application.pollId && poll.applicationId === application.id && same(poll.openedAt, receipt.paidAt)), 'fee has exactly its original poll');
  }
  if (civic.version === 2) {
    // The rolling ledger may retire old rows. Every retained fee row still has
    // its complete original receipt, and a nonfull ledger cannot hide a fee.
    const ledger = state.extension!.publicLedger, fees = ledger.filter(row => row.purpose === '本区居民补选本人登记费');
    for (const row of fees) need(row.account === 'public' && row.amount === CIVIC_REGISTRATION_FEE
      && applications.some(application => application.receipt?.tick === row.tick && application.actorId === row.actorId && application.districtId === row.districtId), 'retained public fee ledger actual receipt');
    const oldest = ledger.length ? Math.min(...ledger.map(row => row.tick)) : state.tick + 1;
    for (const application of applications.filter(application => application.receipt)) {
      const matching = fees.filter(row => row.tick === application.receipt!.tick && row.actorId === application.actorId && row.districtId === application.districtId);
      need(matching.length <= 1 && (ledger.length >= 512 && application.receipt!.tick <= oldest || matching.length === 1), 'exact retained public fee ledger custody');
    }
  }
  let ballotCount = 0;
  for (const poll of polls) {
    shape(poll, ['id', 'applicationId', 'candidateId', 'officeId', 'districtId', 'proofId', 'openedAt', 'closesAt', 'openingCensus', 'eligible', 'withdrawals', 'ballots', 'countedAt', 'result', 'count', 'termId'], 'poll shape');
    const application = applications.find(application => application.id === poll.applicationId); need(application?.receipt && application.pollId === poll.id && application.actorId === poll.candidateId && application.officeId === poll.officeId && application.districtId === poll.districtId && application.proofId === poll.proofId && same(poll.openedAt, application.receipt.paidAt), 'poll paid origin chain');
    number(poll.openedAt, enabled.enabledAt, now, 'poll opening'); need(same(poll.closesAt, poll.openedAt + CIVIC_POLL_MINUTES), 'full two day deadline');
    const census = rows<CivicOpeningCensus>(poll.openingCensus, 1024, 'complete opening census'), censusIds = new Set<string>(); need(census.length <= state.citizens.length && census.length >= world.districts.length, 'census finite original population');
    for (const resident of census) {
      shape(resident, ['actorId', 'districtId', 'ageAtOpening', 'aliveAtOpening'], 'opening census source'); need(actors.has(resident.actorId) && !censusIds.has(resident.actorId) && districts.has(resident.districtId), 'unique census resident'); censusIds.add(resident.actorId);
      number(resident.ageAtOpening, 0, 140, 'census real age'); need(typeof resident.aliveAtOpening === 'boolean', 'census real life state');
      const profile = state.extension!.actorProfiles[resident.actorId]; need(profile && resident.ageAtOpening <= profile.age + EPS && profile.age - resident.ageAtOpening <= (now - poll.openedAt) / (1440 * 365) + EPS, 'census age cannot invent eligibility');
      if (profile.alive) need(resident.aliveAtOpening, 'currently alive resident cannot be removed as previously dead');
    }
    // Core citizen IDs existing at opening are retained; later real children
    // may join only through their already-validated family birth source.
    for (const person of state.citizens) if (!censusIds.has(person.id)) need((state.family?.children[person.id]?.bornAt ?? -1) > poll.openedAt, 'cannot omit existing census citizen');
    const eligible = rows<CivicEligibleVoter>(poll.eligible, 896, 'frozen adult local voters');
    const derived = census.filter(resident => resident.aliveAtOpening && resident.ageAtOpening >= 18 && resident.districtId === poll.districtId);
    need(eligible.length === derived.length && eligible.every((resident, index) => {
      shape(resident, ['actorId', 'ageAtOpening', 'districtId'], 'eligible voter shape');
      return resident.actorId === derived[index].actorId && resident.districtId === derived[index].districtId && same(resident.ageAtOpening, derived[index].ageAtOpening);
    }), 'eligible exactly derived from complete frozen census');
    const withdrawals = rows<CivicWithdrawal>(poll.withdrawals, 896, 'unvoted resident withdrawals'), withdrawnIds = new Set<string>();
    for (const withdrawn of withdrawals) {
      shape(withdrawn, ['actorId', 'at', 'tick', 'reason'], 'withdrawal shape'); need(eligible.some(voter => voter.actorId === withdrawn.actorId) && !withdrawnIds.has(withdrawn.actorId) && ['death', 'residency-changed'].includes(withdrawn.reason), 'real eligible withdrawal'); withdrawnIds.add(withdrawn.actorId);
      number(withdrawn.at, poll.openedAt, Math.min(now, poll.countedAt ?? now), 'withdrawal observed time'); number(withdrawn.tick, enabled.enabledTick, state.tick, 'withdrawal observed tick', true);
      if (withdrawn.reason === 'death') need(!state.extension!.actorProfiles[withdrawn.actorId].alive, 'no invented voter death');
    }
    const ballots = rows<CivicBallot>(poll.ballots, 896, 'actual individual ballots'), voterIds = new Set<string>(); ballotCount += ballots.length;
    for (const ballot of ballots) {
      shape(ballot, ['actorId', 'choice', 'decision', 'startedAt', 'completedAt', 'workedMinutes', 'windows'], 'ballot shape');
      need(eligible.some(voter => voter.actorId === ballot.actorId) && !voterIds.has(ballot.actorId), 'one frozen person one ballot'); voterIds.add(ballot.actorId);
      shape(ballot.decision, ['support', 'mood', 'stress', 'prosperity', 'candidateEducation'], 'resident choice factors');
      for (const value of [ballot.decision.support, ballot.decision.mood, ballot.decision.stress, ballot.decision.prosperity]) number(value, 0, 100, 'real choice parameter');
      need(ballot.decision.candidateEducation === originals.find(source => source.actorId === poll.candidateId)!.educationAtEnablement && ballot.choice === ballotChoice(ballot.decision), 'support or retain from recorded resident opinion');
      number(ballot.startedAt, poll.openedAt, Math.min(now, poll.closesAt), 'ballot started within poll');
      const lastAt = activity(ballot.windows, ballot.actorId, poll.officeId, ballot.startedAt, Math.min(now, poll.closesAt), ballot.workedMinutes);
      if (ballot.completedAt === null) need(ballot.workedMinutes < 1 - EPS, 'unfinished ballot not cast');
      else { need(same(ballot.workedMinutes, 1) && same(ballot.completedAt, lastAt) && !withdrawnIds.has(ballot.actorId), 'one real minute completed before withdrawal'); }
      for (const window of ballot.windows) need(window.displayHour >= 8 && window.displayHour < 20, 'actual public polling hours');
    }
    if (poll.result === 'open') need(poll.countedAt === null && poll.count === null && poll.termId === null && now < poll.closesAt + EPS, 'open poll has not manufactured result');
    else {
      need(['elected', 'defeated', 'no-quorum', 'candidate-unavailable', 'no-seat'].includes(poll.result), 'known real result'); number(poll.countedAt, poll.closesAt, now, 'count only after full deadline');
      shape(poll.count, ['eligible', 'quorum', 'turnout', 'support', 'retain'], 'actual count shape');
      const cast = ballots.filter(ballot => ballot.completedAt !== null), support = cast.filter(ballot => ballot.choice === 'support').length;
      need(poll.count && poll.count.eligible === eligible.length - withdrawals.length && poll.count.quorum === Math.max(3, Math.ceil(poll.count.eligible / 2))
        && poll.count.turnout === cast.length && poll.count.support === support && poll.count.retain === cast.length - support, 'exact quorum turnout and individual vote totals');
      if (poll.result === 'elected') need(poll.count.turnout >= poll.count.quorum && poll.count.support > poll.count.retain && terms.some(term => term.id === poll.termId && term.pollId === poll.id), 'elected only by actual quorum and support');
      else { need(poll.termId === null && !terms.some(term => term.pollId === poll.id), 'failed poll creates no identity'); if (poll.result === 'no-quorum') need(poll.count.turnout < poll.count.quorum, 'true no quorum'); if (poll.result === 'defeated') need(poll.count.turnout >= poll.count.quorum && poll.count.support <= poll.count.retain, 'true retain or tie'); }
    }
  }
  need((civic.version === 1 ? ballotCount : civic.polls.reduce((sum, poll) => sum + poll.ballots.length, 0)) <= BALLOT_LIMIT, 'bounded live ballot custody');
  for (const term of terms) {
    shape(term, ['id', 'actorId', 'officeId', 'districtId', 'baseRole', 'enablementId', 'pollId', 'proofId', 'startsAt', 'endsAt', 'endedAt', 'endedTick', 'endedReason'], 'finite term shape');
    const poll = polls.find(poll => poll.id === term.pollId), source = originals.find(source => source.actorId === term.actorId);
    need(source && poll?.result === 'elected' && poll.termId === term.id && poll.candidateId === term.actorId && poll.officeId === term.officeId && poll.districtId === term.districtId && poll.proofId === term.proofId
      && term.baseRole === source.baseRole && term.enablementId === enabled.id && same(term.startsAt, poll.countedAt!), 'term comes only from its actual elected poll');
    need(same(term.endsAt, term.startsAt + CIVIC_TERM_MINUTES), 'exact fourteen day term');
    if (term.endedAt === null) {
      need(term.endedTick === null && term.endedReason === '' && now < term.endsAt && state.extension!.actorProfiles[term.actorId].alive, 'active term real life and deadline');
      const person = actors.get(term.actorId)!; need(person.role === term.baseRole && person.workId === term.officeId && person.districtId === term.districtId, 'current original occupation and residence');
    } else {
      number(term.endedAt, term.startsAt, Math.min(now, term.endsAt), 'real term end'); number(term.endedTick, enabled.enabledTick, state.tick, 'term end observed tick', true);
      need(['expired', 'death', 'profession-changed', 'residency-changed'].includes(term.endedReason), 'real term end reason');
      if (term.endedReason === 'expired') need(same(term.endedAt, term.endsAt), 'expiry preserves fixed deadline');
      if (term.endedReason === 'death') need(!state.extension!.actorProfiles[term.actorId].alive, 'past death not resurrected');
    }
  }
  for (const districtId of districts) for (const startsAt of terms.filter(term => term.districtId === districtId).map(term => term.startsAt))
    need(districtSeats(state, districtId, startsAt) <= CIVIC_DISTRICT_SEATS, 'at most two simultaneous local seats');
  for (const left of terms) for (const right of terms) if (left.id !== right.id && left.actorId === right.actorId)
    need(Math.min(left.endsAt, left.endedAt ?? left.endsAt) <= right.startsAt || Math.min(right.endsAt, right.endedAt ?? right.endsAt) <= left.startsAt, 'no duplicate simultaneous actor term');
  const occupied = new Map<string, typeof allActivity>();
  for (const window of allActivity) for (const key of [`actor:${window.actorId}`, `station:${window.siteId}`]) {
    const entries = occupied.get(key) ?? []; entries.push(window); occupied.set(key, entries);
  }
  for (const entries of occupied.values()) {
    const sorted = [...entries].sort((a, b) => a.startAt - b.startAt);
    for (let index = 1; index < sorted.length; index++) need(sorted[index - 1].endAt <= sorted[index].startAt + EPS, 'single actor and single hall station capacity');
  }
  const claims = [...collectActorActivityClaims(state), ...allActivity.map((window, index) => ({ id: `civic:${index}`, actorId: window.actorId,
    startedAt: window.startAt, endedAt: window.endAt, workedMinutes: window.endAt - window.startAt }))];
  const groups = new Map<string, typeof claims>();
  for (const claim of claims) { const group = groups.get(claim.actorId) ?? []; group.push(claim); groups.set(claim.actorId, group); }
  for (const group of groups.values()) {
    const deadlines = [...group].sort((a, b) => a.endedAt - b.endedAt);
    for (const start of new Set(group.map(claim => claim.startedAt))) {
      let used = 0; for (const claim of deadlines) if (claim.startedAt >= start) { used += claim.workedMinutes; need(used <= claim.endedAt - start + EPS, 'unpaid civic plus existing activities exceed real actor time'); }
    }
  }
}

/** Prepare a complete archive transaction; the caller validates budget pins and
 * commits both fields only after all consumers of the current tick have run. */
export function prepareCivicHistoryArchive(state: SimState, world: WorldDefinition): Pick<SimState, 'civicStaffing' | 'civicHistory'> | null {
  const civic = body(state); if (civic?.version !== 2 || !state.civicHistory) return null;
  const polls = civic.polls.filter(poll => poll.result !== 'open' && poll.countedAt !== null);
  const pollIds = new Set(polls.map(poll => poll.id));
  const applications = civic.applications.filter(application => application.cancelledAt !== null && !application.receipt
    || application.receipt !== null && application.pollId !== null && pollIds.has(application.pollId));
  const terms = civic.terms.filter(term => term.endedAt !== null && term.endedTick !== null);
  if (!polls.length && !applications.length && !terms.length) return null;
  validateCivicStaffing(state, world);
  const proofIds = new Set([...applications, ...polls, ...terms].map(row => row.proofId));
  const proofs = civic.proofs.filter(proof => proofIds.has(proof.id));
  const history = appendCivicHistory(state.civicHistory, { proofs, applications, polls, terms }, clock(state), state.tick);
  const applicationIds = new Set(applications.map(row => row.id)), termIds = new Set(terms.map(row => row.id));
  const next = { ...civic, proofs: civic.proofs.filter(row => !proofIds.has(row.id)), applications: civic.applications.filter(row => !applicationIds.has(row.id)),
    polls: civic.polls.filter(row => !pollIds.has(row.id)), terms: civic.terms.filter(row => !termIds.has(row.id)) };
  const candidate = { ...state, civicStaffing: next, civicHistory: history };
  validateCivicStaffing(candidate, world);
  return { civicStaffing: next, civicHistory: history };
}
