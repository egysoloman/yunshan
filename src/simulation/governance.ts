import type { Simulation } from '../simulation';
import { canAccessFloor, getFloorDimensions } from '../access';
import { blocksFloorPlanMovement, floorPlanSupport, getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { homeRestPointBlockedByVoxels } from './home-rest';
import type { Building, Citizen, Player, SimState, Vec3, WorldDefinition } from '../types';

/** These are game rules. Voting uses the city's civic information network;
 * it does not move citizens or fabricate a journey to a polling station. */
export const ELECTION_MINUTES = 120, MAYOR_TERM_MINUTES = 14 * 1440;
// Keep eight detailed rounds; lifetime votes, fees and decisions continue in
// the archive. A round contains real individual records rather than a scalar.
const EPS = 1e-7, HISTORY = 8;
interface Elector { actorId: string; districtId: string; age: number }
export interface CivicBallot { actorId: string; at: number; choice: 'candidate' | 'retain' | 'withdrawn'; score: number; threshold: number }
export interface CityElection {
  id: number; siteId: string; openedAt: number; closesAt: number; fee: 120;
  electorate: Elector[]; ballots: CivicBallot[]; countedAt: number | null;
  result: 'elected' | 'retained' | 'noQuorum' | 'candidateDied' | null;
}
interface CouncilSeat { actorId: string; workId: string }
export interface PolicyBallot { actorId: string; at: number; yes: boolean; workId: string; position: Vec3; score: number }
export interface PolicyMotion {
  id: number; siteId: string; openedAt: number; readyAt: number; expiresAt: number;
  taxRate: number; policeBudget: number; previousTaxRate: number; previousPoliceBudget: number;
  seats: CouncilSeat[]; quorum: number; ballots: PolicyBallot[];
  status: 'debating' | 'approved' | 'applied' | 'rejected'; decidedAt: number | null; appliedAt: number | null;
}
export interface GovernanceState {
  version: 1; activatedAt: number; legacyMandate: boolean; nextElectionId: number; nextMotionId: number;
  elections: CityElection[]; motions: PolicyMotion[];
  term: { electionId: number; startsAt: number; endsAt: number; endedAt: number | null; reason: 'expired' | 'death' | null } | null;
  archive: { elections: number; registrationFees: number; candidateVotes: number; retainVotes: number; withdrawn: number; motions: number; applied: number; rejected: number };
}
export interface GovernanceAccounting { activate(): void; legacyCampaignPending(): boolean; chargeRegistration(site: Building): void }
const now = (s: SimState) => s.extension!.lastUpdate;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const roleCouncil = (c: Citizen) => ['议员', 'council'].includes(c.role);
export function governanceSupported(world: WorldDefinition): boolean {
  return world.buildings.some(b => b.facility === 'data') && world.buildings.some(b => b.facility === 'council' || b.kind === 'hall' && !!getBuildingBody(b));
}
function voterThreshold(seed: number, electionId: number, actorId: string): number {
  let n = (seed ^ electionId) >>> 0;
  for (const character of actorId) { n ^= character.charCodeAt(0); n = Math.imul(n, 16777619) >>> 0; }
  return n / 0x100000000 * 100;
}
function ballotScore(state: SimState, citizen: Citizen): number {
  const district = state.districts.find(d => d.id === citizen.districtId)!, profile = state.extension!.actorProfiles[citizen.id];
  const relation = state.relationships.find(r => r.npcId === citizen.id), player = state.player;
  return clamp(state.support * .5 + district.safety * .12 + district.prosperity * .1 + district.employment * 10
    + player.reputation * .7 + player.education * .4 + (relation?.affection ?? 0) * .08 + (relation?.trust ?? 0) * .04
    + (profile.mood - 50) * .1 - profile.stress * .07 - (citizen.money < 20 ? 10 : 0) - (citizen.needs.hunger < 30 ? 8 : 0));
}
export function electionCounts(election: CityElection) {
  const candidate = election.ballots.filter(v => v.choice === 'candidate').length, retain = election.ballots.filter(v => v.choice === 'retain').length;
  const withdrawn = election.ballots.filter(v => v.choice === 'withdrawn').length;
  const eligible = election.electorate.length - withdrawn, turnout = candidate + retain;
  return { candidate, retain, withdrawn, eligible, turnout, quorum: Math.ceil(eligible / 2) };
}
function activate(sim: Simulation, accounting: GovernanceAccounting): GovernanceState {
  if (sim.state.governance) return sim.state.governance;
  accounting.activate();
  return sim.state.governance = { version: 1, activatedAt: now(sim.state), legacyMandate: sim.hasIdentity('mayor'), nextElectionId: 1, nextMotionId: 1,
    elections: [], motions: [], term: null, archive: { elections: 0, registrationFees: 0, candidateVotes: 0, retainVotes: 0, withdrawn: 0, motions: 0, applied: 0, rejected: 0 } };
}
function layoutAt(site: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>, workOnly = false): boolean {
  if (!getBuildingBody(site)) {
    const floor = Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)));
    if (!canAccessFloor(site, floor, person)) return false;
    if (floor === 0 && Math.hypot(position.x - site.door.x, position.y - site.door.y, position.z - site.door.z) <= 2) return true;
    const dx = position.x - site.position.x, dz = position.z - site.position.z, dimensions = getFloorDimensions(site, floor);
    const x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation);
    return Math.abs(x) <= dimensions.width / 2 && Math.abs(z) <= dimensions.depth / 2
      && position.y >= site.position.y - site.height / Math.max(1, site.floors) * (site.basements ?? 0) - .5 && position.y <= site.position.y + site.height + .5;
  }
  const supported = (at: Vec3, floor: number) => {
    const support = floorPlanSupport(site, floor, at, .35);
    return !!support && support.floor === floor && ['room', 'stairs'].includes(support.kind) && Math.abs(support.y - at.y) <= .26
      && !blocksFloorPlanMovement(site, floor, at, at, .35, 1.72);
  };
  const points = site.functionPoints ?? Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
  return points.some(point => (!workOnly || point.purpose === 'work') && canAccessFloor(site, point.floor, person)
    && Math.hypot(position.x - point.position.x, position.y - point.position.y, position.z - point.position.z) <= 2
    && supported(position, point.floor) && supported(point.position, point.floor));
}
function physicalAt(sim: Simulation, site: Building, position: Vec3, person: Pick<Player, 'role' | 'identities'>, workOnly = false): boolean {
  if (!sim.isNearBuilding(site, position, 2) || homeRestPointBlockedByVoxels(position, sim.state.voxels) || !layoutAt(site, position, person, workOnly)) return false;
  const points = site.functionPoints ?? Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
  return !getBuildingBody(site) || points.some(point => (!workOnly || point.purpose === 'work') && Math.hypot(position.x - point.position.x, position.y - point.position.y, position.z - point.position.z) <= 2 && !homeRestPointBlockedByVoxels(point.position, sim.state.voxels));
}
function venue(sim: Simulation, targetId?: string): Building | undefined {
  const player = sim.state.player;
  return sim.worldDefinition.buildings.find(b => (!targetId || b.id === targetId) && (b.kind === 'hall' || b.kind === 'core')
    && physicalAt(sim, b, player.position, player));
}
function expireTerm(sim: Simulation): void {
  const term = sim.state.governance?.term; if (!term || term.endedAt !== null) return;
  const dead = !sim.state.extension!.actorProfiles.player.alive;
  if (!dead && now(sim.state) < term.endsAt - EPS) return;
  term.endedAt = now(sim.state); term.reason = dead ? 'death' : 'expired';
  const player = sim.state.player;
  player.identities = (player.identities ?? [player.role]).filter(role => role !== 'mayor');
  if (player.role === 'mayor') player.role = player.identities.at(-1) ?? 'traveler';
  sim.appendNotice('mayor-term', dead ? '市长生命结束，任期终止；已批准的债务与预算仍保留。' : '本届市长任期结束，可在议事堂再次登记参选。');
}
function prune(state: GovernanceState): void {
  while (state.elections.length >= HISTORY) {
    const index = state.elections.findIndex(e => e.countedAt !== null && e.id !== state.term?.electionId);
    if (index < 0) break;
    const [election] = state.elections.splice(index, 1), counts = electionCounts(election);
    state.archive.elections++; state.archive.registrationFees += election.fee;
    state.archive.candidateVotes += counts.candidate; state.archive.retainVotes += counts.retain; state.archive.withdrawn += counts.withdrawn;
  }
  while (state.motions.length >= HISTORY) {
    const index = state.motions.findIndex(m => ['applied', 'rejected'].includes(m.status)); if (index < 0) break;
    const [motion] = state.motions.splice(index, 1); state.archive.motions++;
    if (motion.status === 'applied') state.archive.applied++; else state.archive.rejected++;
  }
}
function councilSeats(sim: Simulation): CouncilSeat[] {
  return sim.state.citizens.filter(c => roleCouncil(c) && sim.state.extension!.actorProfiles[c.id]?.alive
    && sim.state.extension!.actorProfiles[c.id].age >= 18 && sim.worldDefinition.buildings.some(b => b.id === c.workId && ['hall', 'core'].includes(b.kind)))
    .map(c => ({ actorId: c.id, workId: c.workId })).sort((a, b) => a.actorId.localeCompare(b.actorId));
}
function policyScore(sim: Simulation, motion: PolicyMotion, citizen: Citizen): number {
  const district = sim.state.districts.find(d => d.id === citizen.districtId)!, profile = sim.state.extension!.actorProfiles[citizen.id];
  return clamp(62 + (profile.mood - 60) * .2 - profile.stress * .08 - (motion.taxRate - motion.previousTaxRate) * 160
    + (motion.policeBudget - motion.previousPoliceBudget) * (70 - district.safety) * .4
    - (sim.publicBudgetSnapshot().available <= 0 && motion.policeBudget > motion.previousPoliceBudget ? 40 : 0));
}
export function installGovernance(sim: Simulation, accounting: GovernanceAccounting): void {
  sim.registerSaveValidator(candidate => validateGovernance(candidate, sim.worldDefinition));
  if (!governanceSupported(sim.worldDefinition)) return;
  let observedState = sim.state, observedTick = -1;
  const wages = new Map<string, { siteId: string; startAt: number; endAt: number }>();
  sim.onPhase('time', () => { observedState = sim.state; observedTick = sim.state.tick; wages.clear(); });
  sim.onEvent('wage-earned', event => {
    if (observedState !== sim.state || observedTick !== sim.state.tick || !event.citizenId || !event.siteId || !finite(event.minutes) || event.minutes <= 0
      || !finite(event.amount) || event.amount < 0 || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt)
      || Math.abs(event.creditedWorkEndAt - event.creditedWorkStartAt - event.minutes) > EPS) return;
    wages.set(event.citizenId, { siteId: event.siteId, startAt: event.creditedWorkStartAt, endAt: event.creditedWorkEndAt });
  });
  sim.onPhase('environment', () => expireTerm(sim));
  sim.onPhase('politics', (_state, minutes) => {
    const state = sim.state, government = state.governance; if (!government) return;
    expireTerm(sim);
    const election = government.elections.find(e => e.countedAt === null), clock = now(state);
    if (election) {
      const recorded = new Set(election.ballots.map(v => v.actorId));
      const network = sim.worldDefinition.buildings.some(b => b.facility === 'data' && (state.districts.find(d => d.id === b.districtId)?.energy ?? 0) > 0);
      if (clock <= election.closesAt + EPS) for (const elector of election.electorate) {
        if (recorded.has(elector.actorId)) continue;
        const profile = state.extension!.actorProfiles[elector.actorId], citizen = state.citizens.find(c => c.id === elector.actorId)!;
        if (!profile.alive) { election.ballots.push({ actorId: elector.actorId, at: clock, choice: 'withdrawn', score: 0, threshold: 0 }); continue; }
        if (!network || (state.districts.find(d => d.id === elector.districtId)?.energy ?? 0) <= 0) continue;
        const score = ballotScore(state, citizen), threshold = voterThreshold(state.seed, election.id, citizen.id);
        election.ballots.push({ actorId: citizen.id, at: clock, choice: score >= threshold ? 'candidate' : 'retain', score, threshold });
      }
      if (clock + EPS >= election.closesAt) {
        const counts = electionCounts(election); election.countedAt = clock;
        election.result = !state.extension!.actorProfiles.player.alive ? 'candidateDied'
          : counts.eligible === 0 || counts.turnout < counts.quorum ? 'noQuorum' : counts.candidate > counts.retain ? 'elected' : 'retained';
        if (election.result === 'elected') {
          state.player.identities = [...new Set([...(state.player.identities ?? ['traveler']), state.player.role, 'mayor' as const])]; state.player.role = 'mayor';
          state.player.reputation += 12;
          government.term = { electionId: election.id, startsAt: clock, endsAt: clock + MAYOR_TERM_MINUTES, endedAt: null, reason: null };
        }
        sim.appendNotice('city-election', `具名居民计票：支持${counts.candidate}、保留现治理${counts.retain}，投票${counts.turnout}/${counts.eligible}。${election.result === 'elected' ? '你已当选，任期十四个游戏日。' : '本次未当选，登记费不退还。'}`);
      }
    }
    const motion = government.motions.find(m => ['debating', 'approved'].includes(m.status)); if (!motion) return;
    if (motion.status === 'debating' && clock <= motion.expiresAt + EPS) for (const seat of motion.seats) {
      if (motion.ballots.some(v => v.actorId === seat.actorId)) continue;
      const actor = state.citizens.find(c => c.id === seat.actorId), wage = wages.get(seat.actorId), site = sim.worldDefinition.buildings.find(b => b.id === seat.workId);
      if (!actor || !site || !roleCouncil(actor) || actor.workId !== seat.workId || !state.extension!.actorProfiles[actor.id]?.alive
        || !wage || wage.siteId !== site.id || wage.endAt > clock + EPS || wage.endAt <= Math.max(clock - minutes, motion.openedAt) + EPS
        || actor.state !== 'working' || !physicalAt(sim, site, actor.position, { role: 'council', identities: ['council'] }, true)) continue;
      const score = policyScore(sim, motion, actor);
      motion.ballots.push({ actorId: actor.id, at: clock, yes: score >= 50, workId: seat.workId, position: { ...actor.position }, score });
    }
    const yes = motion.ballots.filter(v => v.yes).length, no = motion.ballots.length - yes;
    if (motion.status === 'debating' && yes >= motion.quorum) { motion.status = 'approved'; motion.decidedAt = clock; }
    else if (motion.status === 'debating' && (no > motion.seats.length - motion.quorum || clock + EPS >= motion.expiresAt)) {
      motion.status = 'rejected'; motion.decidedAt = clock;
      sim.appendNotice('council-policy', `政策未通过：赞成${yes}、反对${no}，需要${motion.quorum}名真实议员赞成。`);
    }
    if (motion.status === 'approved' && clock + EPS >= motion.readyAt) {
      state.taxRate = motion.taxRate; state.policeBudget = motion.policeBudget; motion.status = 'applied'; motion.appliedAt = clock;
      sim.appendNotice('council-policy', `政策经${yes}名具名议员现场表决后生效；税率${(motion.taxRate * 100).toFixed(0)}%、警务预算${(motion.policeBudget * 100).toFixed(0)}%。`);
    }
  });
  sim.registerCommandHandler(command => {
    if (!['election', 'policy'].includes(command.type)) return null;
    const site = venue(sim, command.targetId); if (!site) return { ok: false, message: '请到有权限的真实议事功能点办理。' };
    const state = sim.state, existing = state.governance;
    if (command.type === 'election') {
      if (sim.hasIdentity('mayor') || accounting.legacyCampaignPending() || existing?.elections.some(e => e.countedAt === null)) return { ok: false, message: '已有任期或未结竞选，不能重复登记。' };
      if (state.player.education < 2 || state.player.experience < 4 || state.player.reputation < 8) return { ok: false, message: '参选资格：教育2、经验4、声望8。' };
      if (state.player.money < 120 || state.treasury + 120 > 1e12) return { ok: false, message: '真实120文登记费或收款容量不足。' };
      const electorate = state.citizens.filter(c => state.extension!.actorProfiles[c.id]?.alive && state.extension!.actorProfiles[c.id].age >= 18)
        .map(c => ({ actorId: c.id, districtId: c.districtId, age: state.extension!.actorProfiles[c.id].age }));
      if (!electorate.length) return { ok: false, message: '没有已登记的成年在世居民，不能发起选举。' };
      const government = activate(sim, accounting); prune(government);
      if (government.elections.length >= HISTORY) return { ok: false, message: '选举档案尚未结清，不能重复登记。' };
      accounting.chargeRegistration(site);
      government.elections.push({ id: government.nextElectionId++, siteId: site.id, openedAt: now(state), closesAt: now(state) + ELECTION_MINUTES, fee: 120,
        electorate, ballots: [], countedAt: null, result: null });
      return { ok: true, message: '120文登记费已实付；居民通过市政信息网络各投一票，两个游戏小时后计票。' };
    }
    if (!sim.hasIdentity('mayor')) return { ok: false, message: '只有现任市长可提交政策议案。' };
    if (accounting.legacyCampaignPending() || state.policyPending || existing?.motions.some(m => ['debating', 'approved'].includes(m.status))) return { ok: false, message: '原竞选、政策或当前议案尚未处理，不能覆盖。' };
    const taxRate = command.taxRate ?? state.taxRate, policeBudget = command.policeBudget ?? state.policeBudget;
    if (!finite(taxRate) || taxRate < 0 || taxRate > .3 || !finite(policeBudget) || policeBudget < 0 || policeBudget > 1) return { ok: false, message: '税率范围0至30%，警务预算范围0至100%。' };
    const seats = councilSeats(sim); if (seats.length < 2) return { ok: false, message: '缺少至少两名现有成年在世议员；不能虚构议会或自动批准。' };
    const government = activate(sim, accounting); prune(government);
    if (government.motions.length >= HISTORY) return { ok: false, message: '议案档案尚未结清，不能提交。' };
    government.motions.push({ id: government.nextMotionId++, siteId: site.id, openedAt: now(state), readyAt: now(state) + 120, expiresAt: now(state) + 1440,
      taxRate, policeBudget, previousTaxRate: state.taxRate, previousPoliceBudget: state.policeBudget, seats, quorum: Math.max(2, Math.floor(seats.length / 2) + 1),
      ballots: [], status: 'debating', decidedAt: null, appliedAt: null });
    return { ok: true, message: '政策进入议会：具名在岗议员独立表决，过半且至少两票赞成，最早两个游戏小时后生效。' };
  });
  sim.onLoad(() => { observedState = sim.state; observedTick = -1; wages.clear(); });
}

export function validateGovernance(state: SimState, world: WorldDefinition): void {
  const government = state.governance; if (government === undefined) return;
  const ensure = (condition: unknown, label: string) => { if (!condition) throw new Error(`政治存档：${label}`); };
  const obj = (value: unknown, keys: string[], label: string) => ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)), label);
  const num = (value: unknown, lo: number, hi: number, label: string, integer = false) => ensure(finite(value) && value >= lo && value <= hi && (!integer || Number.isInteger(value)), label);
  const date = (value: unknown, lo: number, hi = now(state)) => num(value, lo, hi, '合法单调时点');
  const clock = now(state), citizens = new Map(state.citizens.map(c => [c.id, c])), sites = new Map(world.buildings.map(b => [b.id, b]));
  const site = (id: string) => ensure(sites.has(id) && ['hall', 'core'].includes(sites.get(id)!.kind), '真实议事场所');
  ensure(governanceSupported(world), '世界缺市政信息与议事功能');
  obj(government, ['version','activatedAt','legacyMandate','nextElectionId','nextMotionId','elections','motions','term','archive'], '模块结构');
  ensure(government.version === 1 && typeof government.legacyMandate === 'boolean', '版本/旧授权'); date(government.activatedAt, 0);
  num(government.nextElectionId, 1, 1e12, '选举计数', true); num(government.nextMotionId, 1, 1e12, '议案计数', true);
  ensure(Array.isArray(government.elections) && government.elections.length <= HISTORY && Array.isArray(government.motions) && government.motions.length <= HISTORY, '档案上限');
  let previous = 0, pending = 0;
  for (const election of government.elections) {
    obj(election, ['id','siteId','openedAt','closesAt','fee','electorate','ballots','countedAt','result'], '选举结构');
    num(election.id, previous + 1, government.nextElectionId - 1, '选举顺序', true); previous = election.id; site(election.siteId); date(election.openedAt, government.activatedAt);
    ensure(election.closesAt === election.openedAt + ELECTION_MINUTES && election.fee === 120, '原登记费/投票期');
    ensure(Array.isArray(election.electorate) && election.electorate.length > 0 && election.electorate.length <= citizens.size && Array.isArray(election.ballots) && election.ballots.length <= election.electorate.length, '选民/票数');
    const electors = new Set<string>(), votes = new Set<string>();
    for (const elector of election.electorate) {
      obj(elector, ['actorId','districtId','age'], '登记选民结构'); const person = citizens.get(elector.actorId);
      ensure(person && !electors.has(elector.actorId) && world.districts.some(d => d.id === elector.districtId), '登记选民身份'); electors.add(elector.actorId); num(elector.age, 18, 200, '成年登记');
    }
    for (const ballot of election.ballots) {
      obj(ballot, ['actorId','at','choice','score','threshold'], '票据结构'); ensure(electors.has(ballot.actorId) && !votes.has(ballot.actorId), '一人一票'); votes.add(ballot.actorId);
      date(ballot.at, election.openedAt, Math.min(clock, election.closesAt + EPS)); num(ballot.score, 0, 100, '民意分'); num(ballot.threshold, 0, 100, '个体偏好');
      ensure(ballot.choice === 'withdrawn' ? ballot.score === 0 && ballot.threshold === 0 && !state.extension!.actorProfiles[ballot.actorId].alive : ['candidate','retain'].includes(ballot.choice)
        && ballot.threshold === voterThreshold(state.seed, election.id, ballot.actorId) && ballot.choice === (ballot.score >= ballot.threshold ? 'candidate' : 'retain'), '票据选择守恒');
    }
    if (election.countedAt === null) { pending++; ensure(election.result === null, '未计票无结果'); }
    else {
      date(election.countedAt, election.closesAt); const counts = electionCounts(election);
      const expected = counts.eligible === 0 || counts.turnout < counts.quorum ? 'noQuorum' : counts.candidate > counts.retain ? 'elected' : 'retained';
      ensure(election.result === expected || election.result === 'candidateDied' && !state.extension!.actorProfiles.player.alive, '逐票结果/法定人数');
    }
  }
  ensure(pending <= 1, '不能重复未结竞选'); previous = 0; pending = 0;
  for (const motion of government.motions) {
    obj(motion, ['id','siteId','openedAt','readyAt','expiresAt','taxRate','policeBudget','previousTaxRate','previousPoliceBudget','seats','quorum','ballots','status','decidedAt','appliedAt'], '议案结构');
    num(motion.id, previous + 1, government.nextMotionId - 1, '议案顺序', true); previous = motion.id; site(motion.siteId); date(motion.openedAt, government.activatedAt);
    ensure(motion.readyAt === motion.openedAt + 120 && motion.expiresAt === motion.openedAt + 1440, '审议单调期限');
    for (const tax of [motion.taxRate, motion.previousTaxRate]) num(tax, 0, .3, '税率'); for (const police of [motion.policeBudget, motion.previousPoliceBudget]) num(police, 0, 1, '警务预算');
    ensure(Array.isArray(motion.seats) && motion.seats.length >= 2 && motion.seats.length <= citizens.size && Array.isArray(motion.ballots) && motion.ballots.length <= motion.seats.length, '议员/表决上限');
    ensure(motion.quorum === Math.max(2, Math.floor(motion.seats.length / 2) + 1), '真实议员过半法定人数');
    const seats = new Map<string, string>(), recorded = new Set<string>();
    for (const seat of motion.seats) { obj(seat, ['actorId','workId'], '议员席位'); ensure(citizens.has(seat.actorId) && !seats.has(seat.actorId), '已有居民议员'); site(seat.workId); seats.set(seat.actorId, seat.workId); }
    for (const ballot of motion.ballots) {
      obj(ballot, ['actorId','at','yes','workId','position','score'], '议员表决'); ensure(seats.get(ballot.actorId) === ballot.workId && !recorded.has(ballot.actorId), '议员不能重复表决'); recorded.add(ballot.actorId);
      date(ballot.at, motion.openedAt); ensure(ballot.at <= motion.expiresAt + EPS && typeof ballot.yes === 'boolean', '表决期/选择'); num(ballot.score, 0, 100, '表决分'); ensure(ballot.yes === (ballot.score >= 50), '独立表决结果');
      obj(ballot.position, ['x','y','z'], '真实表决位置'); for (const coordinate of Object.values(ballot.position)) num(coordinate, -1e5, 1e5, '位置');
      ensure(layoutAt(sites.get(ballot.workId)!, ballot.position, { role: 'council', identities: ['council'] }, true), '表决必须有原建筑内合法工作站位');
    }
    const yes = motion.ballots.filter(v => v.yes).length, no = motion.ballots.length - yes;
    ensure(['debating','approved','applied','rejected'].includes(motion.status), '议案状态');
    if (['debating','approved'].includes(motion.status)) pending++;
    if (motion.status === 'debating') ensure(motion.decidedAt === null && motion.appliedAt === null && yes < motion.quorum && no <= motion.seats.length - motion.quorum, '未决议案');
    else {
      date(motion.decidedAt, motion.openedAt);
      ensure(motion.ballots.every(ballot => ballot.at <= motion.decidedAt! + EPS), '决定后不追加表决');
      if (motion.status === 'rejected') ensure(motion.appliedAt === null && yes < motion.quorum && (no > motion.seats.length - motion.quorum || motion.decidedAt! + EPS >= motion.expiresAt), '拒绝依据');
      else ensure(yes >= motion.quorum && motion.decidedAt! <= motion.expiresAt + EPS && (motion.status === 'approved' ? motion.appliedAt === null : finite(motion.appliedAt) && motion.appliedAt >= Math.max(motion.readyAt, motion.decidedAt!) && motion.appliedAt <= clock), '具名议员批准和生效时点');
    }
  }
  ensure(pending <= 1, '不能覆盖未结议案');
  const mayor = state.player.role === 'mayor' || state.player.identities?.includes('mayor');
  if (mayor && !government.legacyMandate) ensure(government.term !== null && government.term.endedAt === null, '新市长身份必须有真实在任选举任期');
  if (government.term !== null) {
    obj(government.term, ['electionId','startsAt','endsAt','endedAt','reason'], '任期结构'); const term = government.term, election = government.elections.find(e => e.id === term.electionId);
    ensure(election?.result === 'elected' && term.startsAt === election.countedAt && term.endsAt === term.startsAt + MAYOR_TERM_MINUTES, '任期来自真实逐票当选');
    if (term.endedAt === null) ensure(term.reason === null && clock < term.endsAt + EPS && (state.player.role === 'mayor' || state.player.identities?.includes('mayor')), '在任身份和有限任期');
    else { date(term.endedAt, term.startsAt); ensure(term.reason === 'expired' ? term.endedAt + EPS >= term.endsAt : term.reason === 'death' && !state.extension!.actorProfiles.player.alive, '任期终止依据'); }
  }
  obj(government.archive, ['elections','registrationFees','candidateVotes','retainVotes','withdrawn','motions','applied','rejected'], '归档累计');
  for (const value of Object.values(government.archive)) num(value, 0, 1e12, '归档非负累计', true);
  ensure(government.archive.registrationFees === government.archive.elections * 120 && government.archive.elections + government.elections.length === government.nextElectionId - 1
    && government.archive.motions + government.motions.length === government.nextMotionId - 1 && government.archive.applied + government.archive.rejected === government.archive.motions, '归档记录/费用不复制');
}
