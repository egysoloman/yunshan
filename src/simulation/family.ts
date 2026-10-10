import type { Simulation } from '../simulation';
import { shopLifecycleAssetOwnerId, shopLifecycleCanDispose, shopLifecyclePendingEstateAssets } from './shop_lifecycle';
import { settleDeceasedAccount } from './banking';
import { publicFloor } from './culture';
import { quoteSupply } from './trade';
import type { Citizen, Command, CommandResult, SimState, WorldDefinition } from '../types';

export const GAME_DAY = 1440;
export const GAME_YEAR = 365 * GAME_DAY;
export const GESTATION_MINUTES = 270 * GAME_DAY;
export const FAMILY_RESERVE = 100;
export const SCHOOL_FEE = 40;
export const SCHOOL_MINUTES_PER_LEVEL = 480;

export interface Pregnancy {
  id: string;
  parentIds: [string, string];
  carrierId: string;
  homeId: string;
  startedAt: number;
  dueAt: number;
  escrow: number;
}
export interface FamilyChild {
  parentIds: [string, string];
  bornAt: number;
  homeId: string;
  schoolId: string | null;
  attendanceMinutes: number;
  studyToday: number;
  schoolDay: number;
  graduatedAt: number | null;
  schoolVisitId?: string | null;
  /** Personal study is useful, but is not a credential or funded teaching. */
  selfStudyMinutes?: number;
}
export interface FormalLearningReceipt {
  orderId: string; siteId: string; teacherId: string; completedAt: number;
  minutes: 60; minutesPerLevel: 60 | 480; educationGain: number;
}
export interface FamilyTuitionLearningReceipt {
  courseId: string; siteId: string; teacherId: string; completedAt: number;
  minutes: 60; minutesPerLevel: 480; educationGain: number;
}
export interface FormalLearningRecord {
  baselineEducation: number; baselineAttendanceMinutes: number;
  earnedMinutes: number; receipts: FormalLearningReceipt[]; tuitionPages?: FamilyTuitionLearningReceipt[][];
  /** Higher qualifications already admitted by the old v1 reader, retained
   * when this resident completes its first real tuition course. */
  legacyEducationCarry?: number;
}
export interface FamilyEstate {
  settledAt: number;
  heirIds: string[];
  cash: number;
  shares: Record<string, number>;
  status?: 'awaitingExecutor' | 'settled';
  bankSettlement?: { debtPaid: number; depositClaimsTransferred: number; unpaidLoss: number; closed: boolean };
  businesses?: Record<string, string>;
}
export interface EstateAssetSale { id: string; deceasedId: string; kind: 'shares' | 'business'; assetId: string; unitPrice: number; quantity: number; soldQuantity: number; proceeds: number; createdAt: number; state: 'offered' | 'sold' | 'withdrawn'; receipts: { buyerId: string; quantity: number; paid: number; at: number }[] }
export interface FamilyBond { actorIds: [string, string]; stage: 'courtship' | 'dating' | 'engaged' | 'married'; startedAt: number; since: number; sharedMinutes: number; affection: [number, number]; trust: [number, number]; consent: [boolean, boolean] }
export interface HouseholdMovePlan { actorIds: [string, string]; homeId: string; proposedAt: number; expiresAt: number; acceptedIds: string[]; state: 'pending' | 'agreed' | 'rejected'; reason: string }
export interface HouseholdAccount { id: string; actorIds: [string, string]; homeId: string; agreedAt: number; balance: number; contributions: Record<string, number>; spent: number; returned: number; closedAt: number | null; expenses: { recipientId: string; targetId: string; amount: number; quantity: number; at: number }[] }
export interface FamilyCeremony { id: string; kind: 'wedding' | 'funeral'; subjectId: string; organizerId: string; siteId: string; startedAt: number; workedMinutes: number; paid: number; materialUnits: number; guestIds: string[]; attendanceMinutes: Record<string, number>; completedAt: number | null }
export interface FamilyState {
  version: 1 | 2;
  lastUpdate: number;
  nextResidentId: number;
  nextPregnancyId: number;
  pregnancies: Pregnancy[];
  children: Record<string, FamilyChild>;
  studentGuardians: Record<string, string[]>;
  nextSupportAt: Record<string, number>;
  nextPlanAt: Record<string, number>;
  estates: Record<string, FamilyEstate>;
  bonds: FamilyBond[];
  movePlans: HouseholdMovePlan[];
  households: HouseholdAccount[];
  ceremonies: FamilyCeremony[];
  nextHouseholdId: number;
  nextCeremonyId: number;
  nextBondAt: number;
  careGuardians: Record<string, string[]>;
  estateSales: EstateAssetSale[];
  nextEstateSaleId: number;
  formalLearningVersion?: 1 | 2;
  formalLearning?: Record<string, FormalLearningRecord>;
}
type FamilySimState = SimState & { family?: FamilyState };
type ProvisionedCitizen = Citizen & { food?: number };
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Core supplies only the portion of its people interval actually spent at
 * the destination. The rest of a journey never becomes personal school time. */
export function recordSchoolSelfStudy(simulation: Simulation, citizen: Citizen, site: WorldDefinition['buildings'][number], arrivedMinutes: number): void {
  const state = simulation.state, child = state.family?.children[citizen.id], profile = state.extension?.actorProfiles[citizen.id];
  if (!child || child.schoolId !== site.id || site.kind !== 'school' || !profile?.alive || profile.age < 6 || profile.age >= 18
    || state.hour < 7.5 || state.hour >= 17.5 || citizen.needs.hunger < 40 || citizen.needs.fatigue < 40 || profile.health < 45
    || !simulation.isNearBuilding(site, citizen.position, 1) || !finite(arrivedMinutes) || arrivedMinutes <= 0) return;
  const day = Math.floor(state.extension!.lastUpdate / GAME_DAY);
  if (child.schoolDay !== day) { child.schoolDay = day; child.studyToday = 0; }
  const elapsed = Math.max(0, Math.min(arrivedMinutes, 240 - child.studyToday));
  child.studyToday += elapsed; child.selfStudyMinutes = (child.selfStudyMinutes ?? 0) + elapsed;
  if (citizen.skills) citizen.skills.learning = clamp((citizen.skills.learning ?? 0) + elapsed * .003);
}
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Only the recorded biological genealogy determines kinship; foster guardians do not. */
export function isCloseKin(state: SimState, firstId: string, secondId: string): boolean {
  if (firstId === secondId) return true;
  const children = state.family?.children ?? {};
  const ancestors = (id: string) => { const found = new Set([id]); const visit = (actorId: string, depth: number) => { if (!depth) return; for (const parent of children[actorId]?.parentIds ?? []) if (!found.has(parent)) { found.add(parent); visit(parent, depth - 1); } }; visit(id, 2); return found; };
  const first = ancestors(firstId), second = ancestors(secondId);
  return [...first].some(id => second.has(id));
}
export const publicFamilyVenue = (site: WorldDefinition['buildings'][number], position: { y: number }) => site.kind === 'pavilion' && publicFloor(site, Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors))));
export function isFamilyDependent(state: SimState, id: string, guardianId = 'player'): boolean { const f = state.family; return !!f && [...(f.children[id]?.parentIds ?? f.studentGuardians[id] ?? []), ...(f.careGuardians?.[id] ?? [])].includes(guardianId) && state.extension?.actorProfiles[id]?.alive === true; }
export function canHoldFamilyCeremony(state: SimState, subjectId: string): boolean {
  if (subjectId === 'wedding') { const partner = state.player.partnerId; return !!partner && state.extension?.actorProfiles[partner]?.alive === true && state.citizens.find(person => person.id === partner)?.partnerId === 'player' && state.relationships.find(item => item.npcId === partner)?.consent === true; }
  return state.extension?.actorProfiles[subjectId]?.alive === false && !!state.family?.estates[subjectId] && (state.extension.actorProfiles[subjectId].family.includes('player') || state.family.estates[subjectId].heirIds.includes('player'));
}
export function isEstateSaleVenue(state: SimState, sale: EstateAssetSale, site: WorldDefinition['buildings'][number], level: number): boolean {
  const business = sale.kind === 'business' ? state.shops.find(shop => shop.id === sale.assetId)?.buildingId : state.extension?.companies.find(company => company.id === sale.assetId)?.buildingId;
  return publicFloor(site, level) && (site.kind === 'bank' || site.id === business);
}

/** Family assets, timers and genealogy are authoritative saved state, never view data. */
export function installFamily(simulation: Simulation): void {
  const world = simulation.worldDefinition;
  const buildings = new Map(world.buildings.map(site => [site.id, site]));
  const state = () => simulation.state as FamilySimState;
  const family = () => state().family!;
  let indexedState: FamilySimState | undefined, indexedCitizens: Citizen[] | undefined, indexedCount = -1;
  let actors = new Map<string, { person: Citizen; index: number }>();
  const actor = (id: string) => {
    const current = state(); if (id === 'player') return current.player;
    const cached = actors.get(id);
    if (indexedState !== current || indexedCitizens !== current.citizens || indexedCount !== current.citizens.length
      || cached && (current.citizens[cached.index] !== cached.person || cached.person.id !== id)) {
      actors = new Map(current.citizens.map((person, index) => [person.id, { person, index }]));
      indexedState = current; indexedCitizens = current.citizens; indexedCount = current.citizens.length;
    }
    return actors.get(id)?.person;
  };
  const profile = (id: string) => state().extension!.actorProfiles[id];
  const alive = (id: string) => !!actor(id) && profile(id)?.alive === true;
  const now = () => state().extension!.lastUpdate;
  const notice = (text: string, districtId?: string) => { simulation.appendNotice('family', text, districtId); simulation.emitEvent({ type: 'extension:family', districtId }); };
  const record = (id: string, amount: number, purpose: string, districtId: string, account: 'household' | 'public' = 'household') => {
    const ledger = state().extension!.publicLedger;
    ledger.push({ tick: state().tick, actorId: id, amount, purpose, districtId, account });
    if (ledger.length > 512) ledger.splice(0, ledger.length - 512);
  };
  const transfer = (fromId: string, toId: string, amount: number, purpose: string) => {
    const from = actor(fromId)!, to = actor(toId)!;
    from.money -= amount; to.money += amount;
    const recipient = state().citizens.find(person => person.id === toId);
    const district = recipient?.districtId ?? buildings.get(to.homeId ?? '')?.districtId ?? world.districts[0].id;
    record(fromId, -amount, purpose, district); record(toId, amount, purpose, district);
  };
  const payPublic = (id: string, amount: number, purpose: string, district: string) => {
    state().treasury += amount;
    // Keep the extension's public reconciliation cursor aligned with explicit payments.
    const runtime = (state().extension as unknown as { runtime?: { lastTreasury: number } }).runtime;
    if (runtime) runtime.lastTreasury += amount;
    record(id, amount, purpose, district, 'public');
  };
  const connect = (first: string, second: string) => {
    for (const [id, relative] of [[first, second], [second, first]]) {
      const p = profile(id); if (p && !p.family.includes(relative) && p.family.length < 32) p.family.push(relative);
    }
  };
  const initialize = (): FamilyState => {
    const f: FamilyState = { version: 2, lastUpdate: now(), nextResidentId: 1, nextPregnancyId: 1, pregnancies: [], children: {}, studentGuardians: {}, nextSupportAt: {}, nextPlanAt: {}, estates: {}, bonds: [], movePlans: [], households: [], ceremonies: [], nextHouseholdId: 1, nextCeremonyId: 1, nextBondAt: now() + 60, careGuardians: {}, estateSales: [], nextEstateSaleId: 1 };
    const guardians = state().citizens.filter(person => person.role !== '学生' && profile(person.id).age >= 18 && alive(person.id));
    const wards = new Map<string, number>();
    for (const student of state().citizens.filter(person => person.role === '学生')) {
      const candidates = guardians.filter(person => person.id !== student.id && (wards.get(person.id) ?? 0) < 4)
        .sort((a, b) => Number(b.homeId === student.homeId) - Number(a.homeId === student.homeId)
          || Number(b.districtId === student.districtId) - Number(a.districtId === student.districtId)
          || (wards.get(a.id) ?? 0) - (wards.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      const guardian = candidates[0]; if (!guardian) continue;
      f.studentGuardians[student.id] = [guardian.id]; wards.set(guardian.id, (wards.get(guardian.id) ?? 0) + 1);
      connect(student.id, guardian.id); f.nextSupportAt[student.id] = now();
    }
    for (const person of state().citizens) if (person.partnerId) f.nextPlanAt[person.id] = now() + 30 * GAME_DAY;
    return f;
  };
  state().family = initialize();

  const guardiansOf = (id: string) => family().children[id] ? [...new Set([...family().children[id].parentIds, ...(family().careGuardians[id] ?? [])])] : family().studentGuardians[id] ?? [];
  const ready = (id: string) => {
    const a = actor(id), p = profile(id);
    return !!a && !!p && p.alive && p.age >= 18 && p.age <= 45 && p.health >= 70 && p.mood >= 55 && p.stress <= 50
      && a.needs.hunger >= 50 && a.needs.fatigue >= 50 && a.money >= 2 * FAMILY_RESERVE;
  };
  const eligiblePair = (firstId: string, secondId: string) => {
    const first = actor(firstId), second = actor(secondId), f = family();
    if (!first || !second || isCloseKin(state(), firstId, secondId) || first.partnerId !== secondId || second.partnerId !== firstId
      || !first.homeId || first.homeId !== second.homeId || buildings.get(first.homeId)?.kind !== 'home' || !ready(firstId) || !ready(secondId)) return false;
    if (state().citizens.length + f.pregnancies.length >= 1024 || f.pregnancies.some(job => job.parentIds.includes(firstId) || job.parentIds.includes(secondId))) return false;
    if (Object.values(f.children).filter(child => child.parentIds.includes(firstId) || child.parentIds.includes(secondId)).length >= 4) return false;
    if ((f.nextPlanAt[firstId] ?? 0) > now() + 1e-7 || (f.nextPlanAt[secondId] ?? 0) > now() + 1e-7) return false;
    if (firstId !== 'player' && secondId !== 'player') { const bond = f.bonds.find(bond => bond.actorIds.includes(firstId) && bond.actorIds.includes(secondId)); if (bond && (bond.stage !== 'married' || !bond.consent.every(Boolean) || now() - bond.since < 7 * GAME_DAY - 1e-7)) return false; }
    const home = buildings.get(first.homeId)!;
    return simulation.isNearBuilding(home, first.position, 12) && simulation.isNearBuilding(home, second.position, 12);
  };
  const begin = (firstId: string, secondId: string) => {
    const first = actor(firstId)!, second = actor(secondId)!, f = family(), home = buildings.get(first.homeId!)!;
    first.money -= FAMILY_RESERVE; second.money -= FAMILY_RESERVE;
    record(firstId, -FAMILY_RESERVE, '家庭生育储备转入托管', home.districtId); record(secondId, -FAMILY_RESERVE, '家庭生育储备转入托管', home.districtId);
    f.pregnancies.push({ id: `pregnancy-${f.nextPregnancyId++}`, parentIds: [firstId, secondId], carrierId: secondId, homeId: home.id, startedAt: now(), dueAt: now() + GESTATION_MINUTES, escrow: 2 * FAMILY_RESERVE });
    f.nextPlanAt[firstId] = f.nextPlanAt[secondId] = now() + GESTATION_MINUTES + 365 * GAME_DAY;
    connect(firstId, secondId); notice('双方同意家庭计划并各托管100文；孕期270个游戏日，生活与照护仍需持续。', home.districtId);
  };
  const enroll = (id: string, schoolId: string, payerId: string) => {
    const child = family().children[id], citizen = actor(id) as Citizen, payer = actor(payerId)!, school = buildings.get(schoolId)!;
    payer.money -= SCHOOL_FEE; payPublic(payerId, SCHOOL_FEE, '儿童学堂登记费', school.districtId);
    child.schoolId = school.id; citizen.workId = school.id; citizen.role = '学生'; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
    child.schoolVisitId = null;
    notice(`${citizen.name}登记${school.name}，由家长支付40文；到校实际学习才增加教育。`, citizen.districtId);
  };
  const homePossible = (ids: [string, string], homeId: string) => {
    const home = buildings.get(homeId); if (!home || home.kind !== 'home' || isCloseKin(state(), ids[0], ids[1])) return false;
    // Every condition is a pure check; the cheap personal ones run before the city-wide resident count.
    if (!ids.every(id => { const person = actor(id); return !!person && alive(id) && profile(id).age >= 18 && person.money >= 120 && (id === 'player' || simulation.buildingTravelDistance(home.id, (person as Citizen).workId) <= 500); })) return false;
    // Infants cannot independently travel; keep their established home until escorted travel exists.
    if (Object.entries(family().children).some(([id, child]) => alive(id) && profile(id).age < 6 && child.parentIds.some(parentId => ids.includes(parentId)) && actor(id)!.homeId !== home.id)) return false;
    let count = Number(alive('player') && state().player.homeId === home.id);
    for (const person of state().citizens) if (person.homeId === home.id && alive(person.id)) count++;
    return count + ids.filter(id => actor(id)?.homeId !== home.id).length <= home.capacity;
  };
  const moveTogether = (ids: [string, string], homeId: string): boolean => {
    const home = buildings.get(homeId);
    let account = family().households.find(item => item.closedAt === null && item.actorIds.every(id => ids.includes(id)));
    if (account?.homeId === homeId) return false;
    if (!home || !homePossible(ids, homeId) || ids.some(id => actor(id)?.partnerId !== ids.find(other => other !== id) || profile(id).mood < 55 || profile(id).stress > 50 || actor(id)!.needs.social < 40 || !simulation.isNearBuilding(home, actor(id)!.position, 12))) return false;
    for (const id of ids) {
      const person = actor(id)!; person.money -= 20; payPublic(id, 20, '共同住所登记与搬迁服务费', home.districtId);
      if (id !== 'player') { const citizen = person as Citizen; if (citizen.districtId !== home.districtId) { const old = state().districts.find(d => d.id === citizen.districtId); if (old) old.residents--; state().districts.find(d => d.id === home.districtId)!.residents++; citizen.districtId = home.districtId; } citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0; }
      person.homeId = home.id;
    }
    for (const pregnancy of family().pregnancies) if (pregnancy.parentIds.every(id => ids.includes(id))) pregnancy.homeId = home.id;
    if (!account) { account = { id: `household-${family().nextHouseholdId++}`, actorIds: ids, homeId: home.id, agreedAt: now(), balance: 0, contributions: Object.fromEntries(ids.map(id => [id, 0])), spent: 0, returned: 0, closedAt: null, expenses: [] }; family().households.push(account); }
    else account.homeId = home.id;
    connect(ids[0], ids[1]); notice('双方现场同意共同居住；保持原岗位及实际位置，住所变更已核对真实路网通勤。', home.districtId); return true;
  };
  const settleHouseholds = () => {
    for (const account of family().households) {
      if (account.closedAt !== null || account.actorIds.every(id => alive(id) && actor(id)?.partnerId === account.actorIds.find(other => other !== id))) continue;
      const amount = account.balance / 2;
      if (account.actorIds.some(id => actor(id)!.money + amount > 1e9)) continue;
      for (const id of account.actorIds) { actor(id)!.money += amount; record(id, amount, '共同资金终止均分退款', buildings.get(account.homeId)!.districtId); }
      account.returned += account.balance; account.balance = 0; account.closedAt = now();
    }
  };
  const updateSocialFamilies = (minutes: number) => {
    const f = family();
    if (now() >= f.nextBondAt - 1e-7 && f.bonds.length >= 64) f.bonds = f.bonds.filter(bond => bond.actorIds.every(alive) && (bond.stage !== 'married' || now() - bond.since < 7 * GAME_DAY));
    if (now() >= f.nextBondAt - 1e-7 && f.bonds.length < 64) {
      f.nextBondAt = now() + 60;
      const singles = state().citizens.filter(person => !person.partnerId && alive(person.id) && profile(person.id).age >= 18 && profile(person.id).age <= 45 && profile(person.id).mood >= 65 && profile(person.id).stress <= 35 && person.needs.social >= 50);
      // Courting actors: exactly those in an unmarried bond whose actors all live; new bonds join it below.
      const courting = new Set(f.bonds.filter(bond => bond.stage !== 'married' && bond.actorIds.every(alive)).flatMap(bond => bond.actorIds));
      const involved = (id: string) => courting.has(id);
      for (const first of singles) {
        if (involved(first.id)) continue;
        const second = singles.find(person => person.id !== first.id && !involved(person.id) && !isCloseKin(state(), first.id, person.id) && Math.abs(profile(first.id).age - profile(person.id).age) <= 15 && distance(first.position, person.position) <= 12);
        if (!second) continue;
        f.bonds.push({ actorIds: [first.id, second.id], stage: 'courtship', startedAt: now(), since: now(), sharedMinutes: 0, affection: [45, 45], trust: [35, 35], consent: [true, true] }); courting.add(first.id); courting.add(second.id);
        if (f.bonds.length >= 64) break;
      }
    }
    for (const bond of f.bonds) {
      const [firstId, secondId] = bond.actorIds, first = actor(firstId), second = actor(secondId);
      if (now() <= bond.startedAt + 1e-7) continue;
      if (!first || !second || !alive(firstId) || !alive(secondId) || bond.stage === 'married' || first.partnerId || second.partnerId || isCloseKin(state(), firstId, secondId)) continue;
      bond.consent = bond.actorIds.map(id => profile(id).mood >= 55 && profile(id).stress <= 50 && actor(id)!.needs.social >= 40 && actor(id)!.needs.hunger >= 40 && actor(id)!.needs.fatigue >= 35) as [boolean, boolean];
      if (!bond.consent.every(Boolean) || distance(first.position, second.position) > 12) continue;
      bond.sharedMinutes += minutes;
      for (let index = 0; index < 2; index++) { bond.affection[index] = clamp(bond.affection[index] + minutes * .04); bond.trust[index] = clamp(bond.trust[index] + minutes * .03); }
      const waiting = bond.stage === 'dating' ? 14 * GAME_DAY : 7 * GAME_DAY, shared = bond.stage === 'courtship' ? 60 : bond.stage === 'dating' ? 240 : 480;
      if (now() - bond.since < waiting - 1e-7 || bond.sharedMinutes < shared || bond.affection.some(value => value < (bond.stage === 'courtship' ? 45 : bond.stage === 'dating' ? 60 : 70)) || bond.trust.some(value => value < (bond.stage === 'courtship' ? 35 : bond.stage === 'dating' ? 50 : 60))) continue;
      if (bond.stage === 'courtship') bond.stage = 'dating'; else if (bond.stage === 'dating') bond.stage = 'engaged'; else { bond.stage = 'married'; first.partnerId = secondId; second.partnerId = firstId; f.nextPlanAt[firstId] = Math.max(f.nextPlanAt[firstId] ?? 0, now() + 7 * GAME_DAY); f.nextPlanAt[secondId] = Math.max(f.nextPlanAt[secondId] ?? 0, now() + 7 * GAME_DAY); connect(firstId, secondId); for (const id of bond.actorIds) if (!profile(id).historyTags.includes('自主婚姻登记')) profile(id).historyTags.push('自主婚姻登记'); notice('两位居民经过实际相处、双方意愿与阶段期限，完成自主婚姻登记。', (first as Citizen).districtId); }
      bond.since = now();
    }
    for (const plan of f.movePlans) {
      if (plan.state !== 'pending') continue;
      if (now() > plan.expiresAt || !homePossible(plan.actorIds, plan.homeId)) { plan.state = 'rejected'; plan.reason = '期限届满、住房容量或原岗位通勤不再可行。'; continue; }
      for (const id of plan.actorIds) if (!plan.acceptedIds.includes(id) && alive(id) && profile(id).mood >= 55 && profile(id).stress <= 50 && actor(id)!.needs.social >= 40 && simulation.isNearBuilding(buildings.get(plan.homeId)!, actor(id)!.position, 12)) plan.acceptedIds.push(id);
      if (plan.acceptedIds.length === 2 && moveTogether(plan.actorIds, plan.homeId)) { plan.state = 'agreed'; plan.reason = '双方实际赴住所办理，家庭账户已建立。'; }
    }
    for (const first of state().citizens) {
      if (!first.partnerId || first.partnerId === 'player' || first.id > first.partnerId || first.homeId === actor(first.partnerId)?.homeId || !alive(first.id) || !alive(first.partnerId) || f.movePlans.some(plan => plan.state === 'pending' && plan.actorIds.includes(first.id)) || f.movePlans.length >= 128) continue;
      const ids: [string, string] = [first.id, first.partnerId];
      const home = [first.homeId, actor(first.partnerId)!.homeId].find(homeId => homeId && homePossible(ids, homeId));
      if (home) f.movePlans.push({ actorIds: ids, homeId: home, proposedAt: now(), expiresAt: now() + 7 * GAME_DAY, acceptedIds: [], state: 'pending', reason: '双方可保留原岗位，等候晚间实际赴共同住所讨论。' });
    }
    settleHouseholds();
  };
  const remainingDebt = (id: string) => { const account = state().banking?.accounts[id]; return account ? account.loanPrincipal + account.loanInterest : 0; };
  const estateCounter = (sale: EstateAssetSale, buyerId: string) => {
    const person = actor(buyerId); if (!person) return false;
    return world.buildings.some(site => isEstateSaleVenue(state(), sale, site, Math.floor((person.position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)))) && simulation.isNearBuilding(site, person.position, 2));
  };
  const prepareEstateSales = (id: string) => {
    if (remainingDebt(id) < 1e-7 || family().estateSales.length >= 256) return;
    const add = (kind: EstateAssetSale['kind'], assetId: string, price: number, quantity: number) => {
      if (family().estateSales.length >= 256 || family().estateSales.some(sale => sale.deceasedId === id && sale.kind === kind && sale.assetId === assetId)) return;
      family().estateSales.push({ id: `estate-sale-${family().nextEstateSaleId++}`, deceasedId: id, kind, assetId, unitPrice: price, quantity, soldQuantity: 0, proceeds: 0, createdAt: now(), state: 'offered', receipts: [] });
    };
    for (const company of state().extension!.companies) if ((company.shareholders[id] ?? 0) > 0) add('shares', company.id, company.sharePrice, company.shareholders[id]);
    for (const shop of state().shops) if (shopLifecycleAssetOwnerId(state(), shop) === id && shopLifecycleCanDispose(state(), shop.id) && !state().extension!.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)) {
      const consigned = (state().trade?.lots[shop.id] ?? []).reduce((sum, lot) => sum + lot.quantity, 0);
      const ownedStockValue = buildings.get(shop.buildingId)!.kind === 'market' ? (state().trade?.ownedLots?.[shop.id] ?? []).reduce((sum, lot) => sum + lot.quantity * lot.unitPrice, 0) : Math.max(0, shop.inventory - consigned) * quoteSupply(simulation, shop.id, shop.inventory).unitPrice;
      add('business', shop.id, Math.max(1, simulation.shopFunds(shop) + ownedStockValue - simulation.shopPayrollDebt(shop)), 1);
    }
  };
  const executeEstateSale = (sale: EstateAssetSale, buyerId: string, quantity: number): boolean => {
    const buyer = actor(buyerId), deceased = actor(sale.deceasedId);
    const paid = quantity * sale.unitPrice;
    if (sale.state !== 'offered' || !buyer || !deceased || !alive(buyerId) || profile(buyerId).age < 18 || profile(sale.deceasedId)?.alive !== false || !Number.isInteger(quantity) || quantity < 1 || quantity > sale.quantity - sale.soldQuantity || sale.receipts.length >= 256 || remainingDebt(sale.deceasedId) - deceased.money < 1e-7 || sale.kind === 'shares' && quantity > Math.ceil((remainingDebt(sale.deceasedId) - deceased.money) / sale.unitPrice) || buyer.money < paid + FAMILY_RESERVE || deceased.money + paid > 1e9 || !estateCounter(sale, buyerId)) return false;
    const company = sale.kind === 'shares' ? state().extension!.companies.find(company => company.id === sale.assetId) : undefined;
    const shop = sale.kind === 'business' ? state().shops.find(shop => shop.id === sale.assetId) : undefined;
    if (company) { if ((company.shareholders[sale.deceasedId] ?? 0) < quantity) return false; }
    else if (!shop || shopLifecycleAssetOwnerId(state(), shop) !== sale.deceasedId || !shopLifecycleCanDispose(state(), shop.id) || !simulation.transferBusinessOwnership(shop.id, buyerId)) return false;
    transfer(buyerId, sale.deceasedId, paid, '遗产执行人变卖真实买方付款');
    if (company) {
      company.shareholders[sale.deceasedId] -= quantity; company.shareholders[buyerId] = (company.shareholders[buyerId] ?? 0) + quantity;
      company.ownerId = Object.entries(company.shareholders).filter(([id, quantity]) => id !== 'exchange' && quantity > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? company.ownerId;
    }
    sale.soldQuantity += quantity; sale.proceeds += paid; sale.receipts.push({ buyerId, quantity, paid, at: now() }); if (sale.soldQuantity === sale.quantity) sale.state = 'sold';
    simulation.emitEvent({ type: 'estate-asset-sale', citizenId: buyerId, amount: paid, quantity }); return true;
  };
  const liquidateEstate = (id: string, heirs: string[]) => {
    prepareEstateSales(id);
    for (const sale of family().estateSales.filter(sale => sale.deceasedId === id && sale.state === 'offered')) {
      const buyer = state().citizens.filter(person => person.id !== id && !heirs.includes(person.id) && ['商人', 'merchant', '钱庄职员'].includes(person.role) && alive(person.id) && profile(person.id).age >= 18 && profile(person.id).mood >= 65 && profile(person.id).stress <= 50 && person.needs.hunger >= 45 && person.needs.fatigue >= 45 && person.money >= 2 * FAMILY_RESERVE && estateCounter(sale, person.id)).sort((a, b) => b.money - a.money || a.id.localeCompare(b.id))[0];
      if (!buyer) continue;
      const quantity = sale.kind === 'business' ? 1 : Math.min(sale.quantity - sale.soldQuantity, Math.floor((buyer.money - FAMILY_RESERVE) / sale.unitPrice), Math.ceil(Math.max(0, remainingDebt(id) - actor(id)!.money) / sale.unitPrice));
      if (executeEstateSale(sale, buyer.id, quantity)) return;
    }
  };
  const distributeEstates = () => {
    const s = state(), f = family();
    for (const [id, p] of Object.entries(s.extension!.actorProfiles)) {
      if (p.alive) continue;
      const deceased = actor(id); if (!deceased) continue;
      let estate = f.estates[id];
      if (!estate) {
        const spouse = deceased.partnerId && alive(deceased.partnerId) && actor(deceased.partnerId)?.partnerId === id ? deceased.partnerId : null;
        const children = Object.entries(f.children).filter(([childId, child]) => child.parentIds.includes(id) && alive(childId)).map(([childId]) => childId);
        const parents = f.children[id]?.parentIds.filter(alive) ?? [];
        const heirs = [...new Set([...(spouse ? [spouse] : []), ...children])];
        if (!heirs.length) heirs.push(...parents);
        estate = f.estates[id] = { settledAt: now(), heirIds: [...new Set(heirs)].sort(), cash: 0, shares: {} };
        if (id !== 'player') {
          const district = s.districts.find(item => item.id === (deceased as Citizen).districtId);
          if (district) district.residents = Math.max(0, district.residents - 1);
        }
        for (const relative of p.family) connect(id, relative);
        if (spouse) {
          actor(spouse)!.partnerId = null; deceased.partnerId = null;
          if (spouse === 'player' || id === 'player') {
            const relation = s.relationships.find(item => item.npcId === (id === 'player' ? spouse : id));
            if (relation) { relation.type = 'relative'; relation.romanceStage = 'single'; relation.consent = false; relation.tags = [...new Set([...relation.tags, '亡故配偶'])].slice(-32); }
          }
        }
        notice(`${id === 'player' ? '旅人' : (deceased as Citizen).name}的遗产登记：${estate.heirIds.length ? '由在世配偶与子女继承' : '无在世法定继承人，资产保留待处理'}。`);
      }
      const heirs = estate.heirIds.filter(alive);
      let settlement = settleDeceasedAccount(simulation, id, heirs);
      if (!settlement.closed && remainingDebt(id) > 1e-7) { liquidateEstate(id, heirs); const afterSale = settleDeceasedAccount(simulation, id, heirs); settlement = { debtPaid: settlement.debtPaid + afterSale.debtPaid, depositClaimsTransferred: settlement.depositClaimsTransferred + afterSale.depositClaimsTransferred, unpaidLoss: settlement.unpaidLoss + afterSale.unpaidLoss, closed: afterSale.closed }; }
      estate.bankSettlement ??= { debtPaid: 0, depositClaimsTransferred: 0, unpaidLoss: 0, closed: false };
      estate.bankSettlement.debtPaid += settlement.debtPaid; estate.bankSettlement.depositClaimsTransferred += settlement.depositClaimsTransferred; estate.bankSettlement.unpaidLoss += settlement.unpaidLoss; estate.bankSettlement.closed = settlement.closed;
      estate.status = settlement.closed ? 'settled' : 'awaitingExecutor';
      if (!settlement.closed) continue;
      for (const sale of f.estateSales) if (sale.deceasedId === id && sale.state === 'offered') sale.state = 'withdrawn';
      if (!heirs.length) { if (deceased.money > 0 || s.extension!.companies.some(company => (company.shareholders[id] ?? 0) > 0) || s.shops.some(shop => shop.ownerId === id) || shopLifecyclePendingEstateAssets(s, id)) estate.status = 'awaitingExecutor'; continue; }
      // Later receipts cannot strand money in the deceased actor's inactive wallet.
      const cash = deceased.money;
      if (heirs.some(heir => actor(heir)!.money + cash / heirs.length > 1e9)) { estate.status = 'awaitingExecutor'; continue; }
      for (let index = 0, distributed = 0; index < heirs.length; index++) {
        const amount = index === heirs.length - 1 ? cash - distributed : cash / heirs.length;
        if (amount > 0) { transfer(id, heirs[index], amount, '家庭遗产现金继承'); estate.cash += amount; distributed += amount; }
      }
      for (const company of s.extension!.companies) {
        const shares = company.shareholders[id] ?? 0; if (!shares) continue;
        company.shareholders[id] = 0; const quotient = Math.floor(shares / heirs.length), remainder = shares % heirs.length;
        for (let index = 0; index < heirs.length; index++) company.shareholders[heirs[index]] = (company.shareholders[heirs[index]] ?? 0) + quotient + Number(index < remainder);
        estate.shares[company.id] = (estate.shares[company.id] ?? 0) + shares;
        const holders = Object.entries(company.shareholders).filter(([holder, amount]) => holder !== 'exchange' && amount > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        if (holders.length) company.ownerId = holders[0][0];
      }
      for (const shop of s.shops) if (shopLifecycleAssetOwnerId(s, shop) === id && shopLifecycleCanDispose(s, shop.id) && !s.extension!.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)) {
        const heir = [...heirs].sort((a, b) => Number(profile(b).age >= 18) - Number(profile(a).age >= 18) || a.localeCompare(b))[0];
        if (simulation.transferBusinessOwnership(shop.id, heir)) { estate.businesses ??= {}; estate.businesses[shop.id] = heir; }
      }
      if (shopLifecyclePendingEstateAssets(s, id)) estate.status = 'awaitingExecutor';
    }
  };

  simulation.onPhase('time', () => { family().lastUpdate = now(); });
  simulation.onPhase('people', (s, minutes) => {
    const f = family();
    for (let index = f.pregnancies.length - 1; index >= 0; index--) {
      const pregnancy = f.pregnancies[index];
      if (!alive(pregnancy.carrierId)) {
        if (pregnancy.parentIds.some(id => actor(id)!.money + pregnancy.escrow / 2 > 1e9)) continue;
        for (const id of pregnancy.parentIds) { actor(id)!.money += pregnancy.escrow / 2; record(id, pregnancy.escrow / 2, '生育中止托管退款', buildings.get(pregnancy.homeId)!.districtId); }
        f.pregnancies.splice(index, 1); notice('孕育因承孕者生命终结而中止，家庭托管余额原额退回并按遗产规则处理。'); continue;
      }
      if (now() + 1e-7 < pregnancy.dueAt || s.citizens.length >= 1024) continue;
      const home = buildings.get(pregnancy.homeId)!, id = `resident-${f.nextResidentId++}`;
      const child: ProvisionedCitizen = { id, name: `云山新生${id.slice(9)}`, districtId: home.districtId, homeId: home.id, workId: home.id, role: '幼儿', position: { ...home.door }, state: 'atHome', destinationId: null, money: pregnancy.escrow - FAMILY_RESERVE, food: 0, needs: { hunger: 85, fatigue: 95, social: 80, fun: 75 }, tier: s.districts.find(d => d.id === home.districtId)?.tier ?? 'statistical', route: [], routeIndex: 0, partnerId: null, skills: { craft: 0, learning: 0, social: 0 }, education: 0, socialIdentities: ['familyMember'], historyTags: ['云山出生'] };
      s.citizens.push(child); s.extension!.actorProfiles[id] = { age: 0, health: 90, mood: 80, stress: 0, alive: true, skill: 0, family: [], historyTags: ['云山出生'] };
      record(id, child.money, '生育托管转为儿童生活费', home.districtId);
      f.children[id] = { parentIds: pregnancy.parentIds, bornAt: now(), homeId: home.id, schoolId: null, schoolVisitId: null, attendanceMinutes: 0, studyToday: 0, schoolDay: Math.floor(now() / GAME_DAY), graduatedAt: null };
      for (const parentId of pregnancy.parentIds) connect(parentId, id);
      f.nextSupportAt[id] = now();
      const district = s.districts.find(item => item.id === child.districtId)!; district.residents++;
      payPublic(pregnancy.carrierId, FAMILY_RESERVE, '家庭分娩医疗费', home.districtId);
      profile(pregnancy.carrierId).health = clamp(profile(pregnancy.carrierId).health - 8);
      f.pregnancies.splice(index, 1); notice(`${child.name}出生并成为真实居民；100文托管余额留作儿童生活费，100文支付分娩医疗。`, home.districtId);
      simulation.emitEvent({ type: 'resident-born', citizenId: id, districtId: home.districtId });
    }
    for (const [id, child] of Object.entries(f.children)) {
      if (!alive(id)) continue;
      const citizen = actor(id) as ProvisionedCitizen, p = profile(id);
      if (p.age < 18 && !guardiansOf(id).some(alive)) {
        const guardian = state().citizens.filter(person => person.id !== id && alive(person.id) && profile(person.id).age >= 18 && profile(person.id).mood >= 60 && profile(person.id).health >= 60 && person.money >= 120 && person.homeId === citizen.homeId && distance(person.position, citizen.position) <= 24).sort((a, b) => Number(profile(b.id).family.includes(id)) - Number(profile(a.id).family.includes(id)) || a.id.localeCompare(b.id))[0];
        if (guardian) { f.careGuardians[id] = [guardian.id]; connect(guardian.id, id); notice('失去原照护者的儿童由同住且实际在场、愿意且有资源的成年居民接续监护；亲生谱系保留。', citizen.districtId); }
      }
      const parents = guardiansOf(id).filter(alive);
      if (p.age < 6) {
        const present = parents.filter(parentId => { const parent = actor(parentId)!; return parent.homeId === citizen.homeId && distance(parent.position, citizen.position) <= 24; });
        if (present.length) { citizen.needs.social = clamp(citizen.needs.social + minutes * .04); citizen.needs.fun = clamp(citizen.needs.fun + minutes * .03); }
        if ((citizen.food ?? 0) < 1 && citizen.needs.hunger < 55) for (const parentId of present) {
          const parent = actor(parentId)!;
          const inventory = parentId === 'player' ? state().player.inventory.food ?? 0 : (parent as ProvisionedCitizen).food ?? 0;
          if (inventory < 1 || parent.needs.hunger < 45) continue;
          if (parentId === 'player') state().player.inventory.food--; else (parent as ProvisionedCitizen).food = inventory - 1;
          citizen.food = (citizen.food ?? 0) + 1;
          simulation.emitEvent({ type: 'family-food', citizenId: id, amount: 1, districtId: citizen.districtId }); break;
        }
      }
      if (p.age >= 6 && p.age < 18 && !child.schoolId) {
        citizen.role = '儿童';
        const school = world.buildings.filter(site => site.kind === 'school' && simulation.buildingTravelDistance(citizen.homeId, site.id) <= 500).sort((a, b) => simulation.buildingTravelDistance(citizen.homeId, a.id) - simulation.buildingTravelDistance(citizen.homeId, b.id))[0];
        if (school) { child.schoolVisitId = school.id; citizen.workId = school.id; }
        const payer = school && parents.find(parentId => parentId !== 'player' && actor(parentId)!.money >= FAMILY_RESERVE + SCHOOL_FEE && simulation.isNearBuilding(school, actor(parentId)!.position, 2));
        if (payer && school && simulation.isNearBuilding(school, citizen.position, 2)) enroll(id, school.id, payer);
      }
      const school = child.schoolId ? buildings.get(child.schoolId) : null;
      const day = Math.floor(now() / GAME_DAY); if (child.schoolDay !== day) { child.schoolDay = day; child.studyToday = 0; }
      // Actual personal study is credited by core's arrived interval. Formal
      // school minutes and credentials require resource-backed tuition.
      if (p.age >= 18 && child.graduatedAt === null && child.attendanceMinutes >= 3 * SCHOOL_MINUTES_PER_LEVEL && (citizen.education ?? 0) >= 3) {
        const workplace = world.buildings.filter(site => ['workshop', 'farm', 'market'].includes(site.kind) && !site.facility && simulation.buildingTravelDistance(citizen.homeId, site.id) <= 500)
          .sort((a, b) => simulation.buildingTravelDistance(citizen.homeId, a.id) - simulation.buildingTravelDistance(citizen.homeId, b.id))[0];
        if (workplace) {
          child.graduatedAt = now(); citizen.role = workplace.kind === 'farm' ? '农民' : '工人'; citizen.workId = workplace.id; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
          citizen.historyTags = [...new Set([...(citizen.historyTags ?? []), '学成进入劳动市场'])].slice(-32); p.historyTags.push('学成进入劳动市场');
          notice(`${citizen.name}成年学成，开始寻找${workplace.name}的真实岗位。`, citizen.districtId);
        }
      }
      if (p.age >= 18 && ['幼儿', '儿童'].includes(citizen.role)) {
        const workplace = world.buildings.filter(site => ['workshop', 'farm', 'market'].includes(site.kind) && !site.facility && simulation.buildingTravelDistance(citizen.homeId, site.id) <= 500)
          .sort((a, b) => simulation.buildingTravelDistance(citizen.homeId, a.id) - simulation.buildingTravelDistance(citizen.homeId, b.id))[0];
        if (workplace) {
          citizen.role = workplace.kind === 'farm' ? '农民' : '工人'; citizen.workId = workplace.id;
          citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
          citizen.historyTags = [...new Set([...(citizen.historyTags ?? []), '成年谋生'])].slice(-32);
          notice(`${citizen.name}已成年，可从低技能岗位谋生；未完成的学业仍有保留记录。`, citizen.districtId);
        }
      }
    }
    updateSocialFamilies(minutes);
    for (const ceremony of f.ceremonies) {
      if (ceremony.completedAt !== null) continue;
      const site = buildings.get(ceremony.siteId)!, organizer = actor(ceremony.organizerId);
      if (!organizer || !alive(ceremony.organizerId) || !publicFamilyVenue(site, organizer.position) || !simulation.isNearBuilding(site, organizer.position, 2) || organizer.needs.hunger < 40 || organizer.needs.fatigue < 35) continue;
      const worked = Math.min(minutes, 30 - ceremony.workedMinutes); ceremony.workedMinutes += worked;
      for (const id of ['player', ...state().citizens.map(person => person.id)]) {
        if (!alive(id) || id !== ceremony.organizerId && !profile(ceremony.subjectId)?.family.includes(id) || !publicFamilyVenue(site, actor(id)!.position) || !simulation.isNearBuilding(site, actor(id)!.position, 2)) continue;
        ceremony.attendanceMinutes[id] = Math.min(30, (ceremony.attendanceMinutes[id] ?? 0) + worked);
        if (ceremony.attendanceMinutes[id] < 30 - 1e-7 || ceremony.guestIds.includes(id)) continue;
        ceremony.guestIds.push(id); profile(id).stress = clamp(profile(id).stress - (ceremony.kind === 'funeral' ? 4 : 2)); profile(id).mood = clamp(profile(id).mood + 3);
        const memory = ceremony.kind === 'funeral' ? '亲人葬礼实际到场' : '家庭婚礼实际到场'; if (!profile(id).historyTags.includes(memory)) profile(id).historyTags.push(memory);
        actor(id)!.needs.social = clamp(actor(id)!.needs.social + 5);
      }
      if (ceremony.workedMinutes >= 30 - 1e-7) { ceremony.completedAt = now(); notice(`${ceremony.kind === 'funeral' ? '葬礼' : '婚礼'}完成；实到${ceremony.guestIds.length}人，费用与用品已实际耗用，家庭记忆保留。`, site.districtId); }
    }
    distributeEstates();
  });
  simulation.onPhase('finance', () => {
    const f = family();
    const dependents = [...new Set([...Object.keys(f.children), ...Object.keys(f.studentGuardians)])];
    for (const id of dependents) {
      const dependent = actor(id) as Citizen | undefined;
      if (!dependent || !alive(id) || profile(id).age >= 18 && dependent.role !== '学生' || (f.nextSupportAt[id] ?? 0) > now() + 1e-7) continue;
      f.nextSupportAt[id] = now() + GAME_DAY;
      if (dependent.money >= 60) continue;
      let missing = 80 - dependent.money;
      for (const guardianId of guardiansOf(id).filter(alive)) {
        const guardian = actor(guardianId)!, amount = Math.min(missing, Math.max(0, guardian.money - FAMILY_RESERVE), 60);
        if (amount <= 0) continue; transfer(guardianId, id, amount, '家庭日常扶养转账'); missing -= amount;
        if (missing <= 1e-7) break;
      }
    }
    // Two autonomous adults each pass the same physical, resource and desire checks.
    for (const first of state().citizens) {
      if (!first.partnerId || first.partnerId === 'player' || first.id > first.partnerId || !eligiblePair(first.id, first.partnerId)) continue;
      const second = actor(first.partnerId)!;
      if (first.needs.social < 55 || second.needs.social < 55 || profile(first.id).mood < 60 || profile(first.partnerId).mood < 60) continue;
      begin(first.id, first.partnerId);
    }
    distributeEstates();
  });
  const handled = new Set(['planFamily', 'supportFamily', 'enrollChild', 'moveHousehold', 'fundHousehold', 'householdMeal', 'holdCeremony', 'buyEstateAsset']);
  simulation.registerCommandHandler((command: Command): CommandResult | null => {
    if (!handled.has(command.type)) return null;
    const fail = (message: string): CommandResult => ({ ok: false, message });
    if (command.targetId !== undefined && typeof command.targetId !== 'string') return fail('家庭目标须为有效居民标识。');
    if (!alive('player')) return fail('生命已结束，不能继续家庭操作。');
    if (command.type === 'buyEstateAsset') {
      const sale = family().estateSales.find(sale => sale.id === command.targetId), quantity = command.value ?? 1;
      if (!sale || !finite(quantity) || !executeEstateSale(sale, 'player', quantity)) return fail('请在真实钱庄公共层或该资产经营现场，按整数份额购买待清债遗产；需要足额自有现金并保留100文，且不能超卖清债所需股份。');
      return { ok: true, message: '真实购款已进入遗产待清债钱包，产权已转移；执行人下一账期先清银行债务再分剩余资产。' };
    }
    if (command.type === 'moveHousehold') {
      const partnerId = state().player.partnerId, homeId = command.targetId;
      const relation = state().relationships.find(item => item.npcId === partnerId);
      if (!partnerId || !homeId || !relation || !['married', 'family'].includes(relation.romanceStage ?? '') || relation.consent !== true || relation.affection < 70 || relation.trust < 60 || family().households.length >= 128 || !moveTogether(['player', partnerId], homeId)) return fail('双方须同意并真实来到住宅，各留有120文、住房有容量、原岗位实际路网通勤不超过500米；幼儿须保留既有家。');
      return { ok: true, message: '共同住所协议已登记；双方各支付20文，原岗位及实际位置保留，家庭共同资金可另行存入。' };
    }
    if (command.type === 'fundHousehold') {
      const account = family().households.find(item => item.id === command.targetId && item.closedAt === null && item.actorIds.includes('player')), amount = command.value ?? 20;
      if (!account || !account.actorIds.every(id => alive(id) && actor(id)?.partnerId === account.actorIds.find(other => other !== id)) || !simulation.isNearBuilding(buildings.get(account.homeId)!) || !finite(amount) || !Number.isInteger(amount) || amount < 1 || amount > 1000 || state().player.money < amount + FAMILY_RESERVE) return fail('请在有效共同住所存入1至1000整数家庭资金，并保留自己的100文生活储备。');
      state().player.money -= amount; account.balance += amount; account.contributions.player = (account.contributions.player ?? 0) + amount; record('player', -amount, '真实现金存入共同家庭账户', buildings.get(account.homeId)!.districtId);
      return { ok: true, message: `已存入共同资金${amount}文；消费有凭据，离婚或亡故时余额按双方各半结清。` };
    }
    if (command.type === 'holdCeremony') {
      const wedding = command.targetId === 'wedding', subjectId = wedding ? state().player.partnerId : command.targetId;
      const site = world.buildings.find(site => publicFamilyVenue(site, state().player.position) && simulation.isNearBuilding(site)), inventory = state().player.inventory, material = wedding ? 'food' : 'block';
      const relation = state().relationships.find(item => item.npcId === subjectId);
      if (!subjectId || !site || state().player.money < 30 || (inventory[material] ?? 0) < 2 || family().ceremonies.length >= 64 || family().ceremonies.some(item => item.kind === (wedding ? 'wedding' : 'funeral') && item.subjectId === subjectId) || (wedding ? !alive(subjectId) || actor(subjectId)?.partnerId !== 'player' || relation?.consent !== true || !simulation.isNearBuilding(site, actor(subjectId)!.position, 2) : alive(subjectId) || !family().estates[subjectId] || !profile(subjectId).family.includes('player') && !family().estates[subjectId].heirIds.includes('player'))) return fail('请到亭馆筹办：场地30文与两份食物（婚礼）或两块实际材料（葬礼）；婚礼需双方到场同意，葬礼需已故家属登记且不可重复。');
      state().player.money -= 30; payPublic('player', 30, '家庭仪式场地服务费', site.districtId); inventory[material] -= 2;
      family().ceremonies.push({ id: `ceremony-${family().nextCeremonyId++}`, kind: wedding ? 'wedding' : 'funeral', subjectId, organizerId: 'player', siteId: site.id, startedAt: now(), workedMinutes: 0, paid: 30, materialUnits: 2, guestIds: [], attendanceMinutes: {}, completedAt: null });
      return { ok: true, message: '仪式用品与费用已实际支付；筹办者留在现场30分钟完成，亲友须实际到场才得到记忆与情绪反馈。' };
    }
    if (command.type === 'planFamily') {
      const spouse = command.targetId ?? state().player.partnerId;
      if (!spouse || state().player.partnerId !== spouse) return fail('请与自己的配偶讨论家庭计划。');
      const relationship = state().relationships.find(item => item.npcId === spouse);
      if (!relationship || relationship.romanceStage !== 'family' || relationship.consent !== true || relationship.affection < 75 || relationship.trust < 70
        || now() - (relationship.romanceSince ?? now()) < 7 * GAME_DAY - 1e-7) return fail('婚后共同生活至少七日、好感75、信任70与双方同意，才能开始家庭计划。');
      if (!eligiblePair('player', spouse)) return fail('双方须在共同住所、成年且健康与心情稳定，各有200文；已有孕育、四名子女或生育间隔未满时须等待。');
      begin('player', spouse); return { ok: true, message: '双方同意家庭计划；已托管200文，270个游戏日后按真实生命状态生产。' };
    }
    const id = command.targetId, citizen = state().citizens.find(person => person.id === id);
    if (!id || !citizen || !guardiansOf(id).includes('player') || !alive(id)) return fail('此居民不是你仍在世的受养子女。');
    if (distance(state().player.position, citizen.position) > 24) return fail('请来到子女身边办理照护与入学。');
    if (command.type === 'householdMeal') {
      const account = family().households.find(item => item.closedAt === null && item.actorIds.includes('player') && item.homeId === citizen.homeId), player = state().player;
      if (!account || (citizen.food ?? 0) >= 6 || account.expenses.length >= 128) return fail('需要有效共同账户、真实受养子女和未满的食物储备。');
      const shop = state().shops.find(shop => shop.open && shop.inventory >= 1 && simulation.isNearBuilding(buildings.get(shop.buildingId)!));
      if (shop && account.balance >= shop.price) {
        const gross = shop.price, net = gross * (1 - state().taxRate), beforeInventory = shop.inventory;
        let quoted: { supplierGross: number }; try { quoted = simulation.quoteConsignmentSale(shop.id, 1, beforeInventory); } catch { return fail('寄售货主账本或收款容量不允许此交易；家庭资金未扣。'); }
        if (net < quoted.supplierGross - 1e-7 || simulation.shopFunds(shop) + net - quoted.supplierGross > 1e9) return fail('此价格不足覆盖真实寄售货款或商铺收款容量已满。');
        account.balance -= gross; account.spent += gross;
        account.expenses.push({ recipientId: shop.id, targetId: id, amount: gross, quantity: 1, at: now() }); shop.inventory--;
        const settled = simulation.settleConsignmentSale(shop.id, 1, beforeInventory); shop.revenue += gross; shop.profit += net - settled.inventoryCost; simulation.transferShopFunds(shop, net - settled.supplierGross);
        simulation.emitEvent({ type: 'sale', shopId: shop.id, amount: gross, quantity: 1, districtId: shop.districtId });
        citizen.food = (citizen.food ?? 0) + 1; simulation.emitEvent({ type: 'family-meal-purchase', citizenId: id, shopId: shop.id, amount: gross, quantity: 1, districtId: shop.districtId });
        return { ok: true, message: `共同资金支付${gross.toFixed(1)}文，真实商铺扣一份库存并将食物交给子女。` };
      }
      if (!simulation.isNearBuilding(buildings.get(account.homeId)!) || (player.inventory.food ?? 0) < 1) return fail('请与子女在商铺用足额共同资金购买，或在家交出实际背包食物。');
      player.inventory.food--; citizen.food = (citizen.food ?? 0) + 1;
      return { ok: true, message: '实际食物已交给子女；家庭账户余额不变。' };
    }
    if (command.type === 'supportFamily') {
      const amount = command.value ?? 20;
      if (!finite(amount) || !Number.isInteger(amount) || amount < 1 || amount > 1000 || state().player.money < amount || citizen.money + amount > 1e9) return fail('扶养金额须为1至1000的整数、有足额现金且子女钱包未超过上限。');
      transfer('player', id, amount, '玩家家庭扶养转账'); notice(`已从自己的现金拨给${citizen.name}${amount}文生活费。`, citizen.districtId);
      return { ok: true, message: `已拨给${citizen.name}${amount}文生活费。` };
    }
    const child = family().children[id];
    if (!child || profile(id).age < 6 || profile(id).age >= 18 || child.schoolId) return fail('入学需要六至十七岁的未登记子女。');
    const school = world.buildings.filter(site => site.kind === 'school' && simulation.isNearBuilding(site) && simulation.isNearBuilding(site, citizen.position)).sort((a, b) => distance(a.door, citizen.position) - distance(b.door, citizen.position))[0];
    if (!school || state().player.money < SCHOOL_FEE) return fail('请与子女到学堂现场，并准备40文登记费。');
    enroll(id, school.id, 'player'); return { ok: true, message: `${citizen.name}已入学，实际到校学习才会提高教育。` };
  });
  simulation.registerSaveValidator(candidate => validateFamilyState(candidate, world));
  simulation.onLoad(() => { if (!state().family) state().family = initialize(); else if (family().version === 1) Object.assign(family(), { version: 2, bonds: [], movePlans: [], households: [], ceremonies: [], nextHouseholdId: 1, nextCeremonyId: 1, nextBondAt: now() + 60, careGuardians: {}, estateSales: [], nextEstateSaleId: 1 }); });
}

/** Also gives the core a strict birth registry for its bounded dynamic population. */
export function validateFamilyState(candidate: SimState, world: WorldDefinition): void {
  const f = (candidate as FamilySimState).family; if (f === undefined) return;
  const ensure = (condition: unknown, label: string): void => { if (!condition) throw new Error(`家庭存档无效：${label}`); };
  const num = (value: unknown, min: number, max: number, label: string, integer = false) => ensure(finite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const dict = (value: unknown, max: number, label: string): Record<string, any> => { ensure(object(value) && Object.keys(value).length <= max, label); return value as Record<string, any>; };
  const array = (value: unknown, max: number, label: string): any[] => { ensure(Array.isArray(value) && value.length <= max, label); return value as any[]; };
  const ids = new Set(['player', ...candidate.citizens.map(person => person.id)]), sites = new Map(world.buildings.map(site => [site.id, site]));
  ensure(object(f) && [1, 2].includes(f.version) && !!candidate.extension, '版本与生命扩展');
  num(f.lastUpdate, 0, 1e12, '时钟'); ensure(Math.abs(f.lastUpdate - candidate.extension!.lastUpdate) < 1e-6, '时钟一致');
  num(f.nextResidentId, 1, 1e9, '居民序号', true); num(f.nextPregnancyId, 1, 1e9, '孕育序号', true);
  const children = dict(f.children, 1024, '出生登记');
  for (const [id, child] of Object.entries(children)) {
    ensure(/^resident-[1-9][0-9]*$/.test(id) && Number(id.slice(9)) < f.nextResidentId && ids.has(id) && object(child), '新居民登记');
    const parents = array(child.parentIds, 2, '双亲'); ensure(parents.length === 2 && new Set(parents).size === 2 && parents.every(parent => ids.has(parent) && parent !== id), '双亲引用');
    num(child.bornAt, 0, f.lastUpdate, '出生时间'); ensure(sites.get(child.homeId)?.kind === 'home', '出生住所');
    const life = candidate.extension!.actorProfiles[id], diedAt = f.estates?.[id]?.settledAt;
    const lifeClock = life?.alive === false && finite(diedAt) ? diedAt : f.lastUpdate;
    ensure(!!life && Math.abs(life.age - (lifeClock - child.bornAt) / GAME_YEAR) <= .00002, '居民年龄必须来自实际生长时间');
    for (const parentId of parents) if (children[parentId]) ensure(children[parentId].bornAt + 18 * GAME_YEAR <= child.bornAt + 1e-7, '双亲出生时成年');
    ensure(child.schoolId === null || sites.get(child.schoolId)?.kind === 'school', '学堂');
    ensure(child.schoolVisitId === undefined || child.schoolVisitId === null || sites.get(child.schoolVisitId)?.kind === 'school' && child.schoolId === null, '待现场入学学堂');
    num(child.attendanceMinutes, 0, 1e10, '实际学习分钟'); num(child.studyToday, 0, 240, '本日学时'); num(child.schoolDay, 0, Math.floor(f.lastUpdate / GAME_DAY), '学校日', true);
    if (child.selfStudyMinutes !== undefined) { ensure(f.version === 2, '旧家庭版本不能夹带新自习字段'); num(child.selfStudyMinutes, 0, 1e10, '个人实际自习分钟'); }
    ensure(child.graduatedAt === null || finite(child.graduatedAt) && child.graduatedAt >= child.bornAt && child.graduatedAt <= f.lastUpdate, '毕业时间');
    if (child.graduatedAt !== null) ensure(child.graduatedAt + 1e-7 >= child.bornAt + 18 * GAME_YEAR && child.attendanceMinutes >= 3 * SCHOOL_MINUTES_PER_LEVEL, '成年并实际学成后毕业');
    ensure(child.schoolId !== null || child.attendanceMinutes === 0, '未入学不得积累教育');
    const seen = new Set([id]), visit = (ancestor: string) => { ensure(!seen.has(ancestor), '谱系循环'); if (!children[ancestor]) return; seen.add(ancestor); for (const parent of children[ancestor].parentIds) visit(parent); seen.delete(ancestor); };
    for (const parent of parents) visit(parent);
  }
  ensure(candidate.citizens.filter(person => person.id.startsWith('resident-')).every(person => children[person.id]), '新增人口必须出生登记');
  const pregnancyIds = new Set<string>(), pregnantParents = new Set<string>();
  for (const pregnancy of array(f.pregnancies, 128, '孕育')) {
    ensure(object(pregnancy) && /^pregnancy-[1-9][0-9]*$/.test(pregnancy.id) && Number(pregnancy.id.slice(10)) < f.nextPregnancyId && !pregnancyIds.has(pregnancy.id), '孕育标识'); pregnancyIds.add(pregnancy.id);
    const parents = array(pregnancy.parentIds, 2, '孕育双亲'); ensure(parents.length === 2 && new Set(parents).size === 2 && parents.every(parent => ids.has(parent) && !pregnantParents.has(parent)), '孕育双亲引用'); parents.forEach(parent => pregnantParents.add(parent));
    ensure(!isCloseKin(candidate, parents[0], parents[1]), '近亲不能孕育');
    ensure(parents.includes(pregnancy.carrierId) && sites.get(pregnancy.homeId)?.kind === 'home', '承孕者与住所');
    num(pregnancy.startedAt, 0, f.lastUpdate, '孕育开始'); num(pregnancy.dueAt, pregnancy.startedAt, 1e12, '生产期限'); ensure(Math.abs(pregnancy.dueAt - pregnancy.startedAt - GESTATION_MINUTES) < 1e-6, '完整孕期'); num(pregnancy.escrow, 2 * FAMILY_RESERVE, 2 * FAMILY_RESERVE, '生育托管');
  }
  ensure(candidate.citizens.length + f.pregnancies.length <= 1024, '人口容量');
  for (const [id, guardians] of Object.entries(dict(f.studentGuardians, 1024, '学生家属'))) {
    ensure(ids.has(id) && id !== 'player' && !children[id], '初始学生标识'); const members = array(guardians, 2, '扶养家属');
    ensure(members.length > 0 && new Set(members).size === members.length && members.every(member => ids.has(member) && member !== id), '扶养家属引用');
  }
  for (const timers of [f.nextSupportAt, f.nextPlanAt]) for (const [id, at] of Object.entries(dict(timers, 1025, '家庭计时器'))) { ensure(ids.has(id), '家庭计时角色'); num(at, 0, 1e12, '家庭计时'); }
  const companyIds = new Set(candidate.extension!.companies.map(company => company.id));
  for (const [id, estate] of Object.entries(dict(f.estates, 1025, '遗产'))) {
    ensure(ids.has(id) && object(estate) && candidate.extension!.actorProfiles[id]?.alive === false, '亡故遗产主体'); num(estate.settledAt, 0, f.lastUpdate, '遗产登记时间'); num(estate.cash, 0, 1e12, '继承现金');
    const heirs = array(estate.heirIds, 32, '继承人'); ensure(new Set(heirs).size === heirs.length && heirs.every(heir => ids.has(heir) && heir !== id), '继承人引用');
    for (const [companyId, amount] of Object.entries(dict(estate.shares, 128, '继承股份'))) { ensure(companyIds.has(companyId), '遗产公司'); num(amount, 0, 1e8, '继承股份', true); }
    if (estate.bankSettlement !== undefined) { ensure(object(estate.bankSettlement) && typeof estate.bankSettlement.closed === 'boolean', '银行清算回执'); for (const key of ['debtPaid', 'depositClaimsTransferred', 'unpaidLoss']) num(estate.bankSettlement[key], 0, 1e12, '真实债务与存款权益清算'); ensure(['settled', 'awaitingExecutor'].includes(estate.status) && (estate.bankSettlement.closed || estate.status === 'awaitingExecutor'), '银行未结清前保留执行人待办'); }
    if (estate.businesses !== undefined) for (const [shopId, heirId] of Object.entries(dict(estate.businesses, candidate.shops.length, '经营权继承回执'))) ensure(candidate.shops.some(shop => shop.id === shopId) && heirs.includes(heirId), '实际经营权与法定继承人');
  }
  if (f.version === 1) { ensure([f.bonds, f.households, f.movePlans, f.ceremonies, f.careGuardians, f.estateSales, f.nextHouseholdId, f.nextCeremonyId, f.nextBondAt, f.nextEstateSaleId, f.formalLearningVersion, f.formalLearning].every(value => value === undefined), '旧家庭版本不能夹带未校验字段'); return; }
  ensure(f.formalLearningVersion === undefined ? f.formalLearning === undefined : [1, 2].includes(f.formalLearningVersion) && object(f.formalLearning), '正式授课版本与收据正文必须同时存在');
  if (f.formalLearningVersion === 2) ensure(!!candidate.familyEducation && Object.values(f.formalLearning!).some(record => record.tuitionPages?.flat().length), '正式家庭版本二须至少一份真实学费资格及原托管模块');
  if (f.formalLearning !== undefined) ensure(Object.keys(f.formalLearning).length > 0, '正式授课正文保留至少一份真实资格来源');
  if (f.formalLearning !== undefined) for (const [id, record] of Object.entries(dict(f.formalLearning, 1024, '正式授课学员'))) {
    ensure(id !== 'player' && ids.has(id) && object(record), '正式授课真实居民');
    num(record.baselineEducation, 0, 20, '保留原学历'); num(record.baselineAttendanceMinutes, 0, 1e10, '保留原学校学时'); num(record.earnedMinutes, 0, f.formalLearningVersion === 2 ? 10560 : 960, '真实新授课学时');
    const publicReceipts = array(record.receipts, 16, '正式公共授课收据'), tuitionPages = record.tuitionPages === undefined ? [] : array(record.tuitionPages, 20, '家庭学期资格页');
    ensure(record.tuitionPages === undefined || f.formalLearningVersion === 2 && tuitionPages.length > 0 && !!candidate.familyEducation, '新家庭正式来源须版本二及真实课程模块');
    ensure(record.legacyEducationCarry === undefined || f.formalLearningVersion === 2 && tuitionPages.length > 0, '保有旧学历差额须首次真实家庭课程来源');
    const legacyEducationCarry = record.legacyEducationCarry ?? 0;
    num(legacyEducationCarry, 0, 20, '保有旧学历差额');
    tuitionPages.forEach((page, index) => ensure(Array.isArray(page) && page.length > 0 && page.length <= 8 && (index === tuitionPages.length - 1 || page.length === 8), '每页八份课程权利全部保留'));
    const tuitionReceipts = tuitionPages.flat(), receipts = [...publicReceipts, ...tuitionReceipts].sort((a,b) => a.completedAt - b.completedAt), seen = new Set<string>(); let earned = 0, awarded = 0, schoolMinutes = 0, previousAt = 0, legacyActivated = false;
    const child = f.children[id], person = candidate.citizens.find(person => person.id === id)!;
    for (const receipt of receipts) {
      const tuition = 'courseId' in receipt, sourceId = tuition ? receipt.courseId : receipt.orderId;
      ensure(object(receipt) && !seen.has(sourceId) && receipt.minutes === 60 && [60, 480].includes(receipt.minutesPerLevel), '具名课程不重复且实际六十分钟'); seen.add(sourceId);
      let earliest = 0;
      if (tuition) {
        const course = [...(candidate.familyEducation?.pages.flat() ?? []), ...(candidate.familyEducation?.active ?? [])].find(course => course.id === sourceId);
        ensure(!!course && course.status === 'completed' && course.actorId === id && course.siteId === receipt.siteId && sites.get(receipt.siteId)?.kind === 'school' && course.completedAt === receipt.completedAt && course.workedMinutes === 60 && course.consumedUnits === 1 && course.receivedUnits + course.reusedUnits === 1 && (course.staffMinutes[receipt.teacherId] ?? 0) > 0, '家庭正式课对应真实实付教材、教学与完成合同');
        ensure(receipt.minutesPerLevel === 480, '家庭儿童仍须四百八十分钟一级'); earliest = Math.max(course!.startedAt, course!.receipt?.purchasedAt ?? course!.startedAt);
      } else {
        const order = candidate.culture?.orders.find(order => order.id === sourceId);
        ensure(!!order && order.topic === 'education' && order.siteId === receipt.siteId && sites.get(receipt.siteId)?.kind === 'school' && order.servedIds.includes(id) && (order.serviceMinutes[id] ?? 0) >= 60
          && order.consumedUnits >= 1 && order.receivedUnits >= order.consumedUnits && order.receipts.reduce((sum, purchase) => sum + purchase.quantity, 0) >= order.consumedUnits - 1e-7
          && ids.has(receipt.teacherId) && receipt.teacherId !== id && order.staffIds.includes(receipt.teacherId), '正式公共课对应已耗教材与实际教师服务');
        earliest = Math.max(order!.scheduledAt, order!.approvedAt ?? order!.scheduledAt, order!.receipts[0]?.purchasedAt ?? order!.scheduledAt);
      }
      num(receipt.completedAt, Math.max(previousAt, earliest), f.lastUpdate, '正式课程实际完成时点'); ensure(receipt.completedAt >= earliest + 60 - 1e-7, '正式课程不早于真实材料和六十分钟');
      const life = candidate.extension!.actorProfiles[id], lifeClock = life.alive === false ? f.estates[id]?.settledAt ?? f.lastUpdate : f.lastUpdate, ageAt = life.age - (lifeClock - receipt.completedAt) / GAME_YEAR;
      ensure(ageAt >= 6 - 1e-7 && receipt.minutesPerLevel === (child || ageAt < 18 - 1e-7 ? 480 : 60), '学校课程和成人资格保留真实年龄规则');
      const levels = receipt.minutesPerLevel === 60 ? 1 : Math.floor((schoolMinutes + 60) / SCHOOL_MINUTES_PER_LEVEL) - Math.floor(schoolMinutes / SCHOOL_MINUTES_PER_LEVEL);
      // The retained v1 qualification existed by its first tuition completion;
      // it constrains later gains, without rewriting earlier public receipts.
      legacyActivated ||= tuition;
      const expectedGain = Math.min(levels, Math.max(0, 20 - record.baselineEducation - awarded - (legacyActivated ? legacyEducationCarry : 0)));
      num(receipt.educationGain, 0, 1, '真实课程学历增量'); ensure(Math.abs(receipt.educationGain - expectedGain) < 1e-7, '学历只由全部完整正式课程合计增加');
      if (receipt.minutesPerLevel === 480) schoolMinutes += 60;
      earned += 60; awarded += receipt.educationGain; previousAt = receipt.completedAt;
    }
    ensure(receipts.length > 0 && earned === record.earnedMinutes && (tuitionPages.length > 0 ? Math.abs((person.education ?? 0) - record.baselineEducation - awarded - legacyEducationCarry) < 1e-7 : (person.education ?? 0) >= record.baselineEducation + awarded - 1e-7), '正式授课时数学历与历史基线一致');
    ensure(child ? Math.abs(child.attendanceMinutes - record.baselineAttendanceMinutes - earned) < 1e-7 : record.baselineAttendanceMinutes === 0, '学校新学时只能来自真实正式课');
  }
  num(f.nextHouseholdId, 1, 1e9, '共同账户序号', true); num(f.nextCeremonyId, 1, 1e9, '仪式序号', true); num(f.nextBondAt, 0, 1e12, '自主结识时钟');
  num(f.nextEstateSaleId, 1, 1e9, '遗产变卖序号', true);
  const pair = (value: unknown, label: string): string[] => { const result = array(value, 2, label); ensure(result.length === 2 && result[0] !== result[1] && result.every(id => ids.has(id)), label); return result; };
  const bondPairs = new Set<string>();
  for (const bond of array(f.bonds, 64, '自主双方关系')) {
    ensure(object(bond) && ['courtship', 'dating', 'engaged', 'married'].includes(bond.stage), '自主关系阶段'); const partners = pair(bond.actorIds, '自主恋人'); ensure(!partners.includes('player') && !isCloseKin(candidate, partners[0], partners[1]), '自主关系合法亲缘');
    const key = [...partners].sort().join(':'); ensure(!bondPairs.has(key), '自主关系唯一'); bondPairs.add(key);
    num(bond.startedAt, 0, f.lastUpdate, '初次实际结识'); num(bond.since, bond.startedAt, f.lastUpdate, '阶段开始'); num(bond.sharedMinutes, 0, f.lastUpdate - bond.startedAt + 1e-7, '实际共同相处');
    for (const metric of [bond.affection, bond.trust]) { const values = array(metric, 2, '双方情感'); ensure(values.length === 2, '双方情感'); for (const value of values) num(value, 0, 100, '双方情感'); }
    const consent = array(bond.consent, 2, '双方意愿'); ensure(consent.length === 2 && consent.every(value => typeof value === 'boolean'), '真实双方意愿');
    const minimumDays = { courtship: 0, dating: 7, engaged: 21, married: 28 }[bond.stage as FamilyBond['stage']]; ensure(bond.since - bond.startedAt >= minimumDays * GAME_DAY - 1e-7, '完整自主关系阶段时间');
    if (bond.stage === 'married') ensure(bond.sharedMinutes >= 480 && consent.every(Boolean), '自主婚姻需实际相处与双方同意');
  }
  for (const plan of array(f.movePlans, 128, '共同居住计划')) {
    ensure(object(plan), '共同居住计划'); const members = pair(plan.actorIds, '同住双人'); ensure(!isCloseKin(candidate, members[0], members[1]) && sites.get(plan.homeId)?.kind === 'home', '同住住所及亲缘'); num(plan.proposedAt, 0, f.lastUpdate, '实际同住提议'); num(plan.expiresAt, plan.proposedAt + 7 * GAME_DAY, plan.proposedAt + 7 * GAME_DAY, '同住计划期限');
    const accepted = array(plan.acceptedIds, 2, '到场接受者'); ensure(new Set(accepted).size === accepted.length && accepted.every(id => members.includes(id)) && ['pending', 'agreed', 'rejected'].includes(plan.state), '真实双向接受'); if (plan.state === 'agreed') ensure(accepted.length === 2, '同住必须双向接受');
    ensure(typeof plan.reason === 'string' && plan.reason.length > 0 && plan.reason.length <= 500, '同住原因');
  }
  const accountIds = new Set<string>(), shopIds = new Set(candidate.shops.map(shop => shop.id));
  for (const account of array(f.households, 128, '共同家庭资金')) {
    ensure(object(account) && /^household-[1-9][0-9]*$/.test(account.id) && Number(account.id.slice(10)) < f.nextHouseholdId && !accountIds.has(account.id), '共同账户唯一'); accountIds.add(account.id); const members = pair(account.actorIds, '共同产权双方'); ensure(sites.get(account.homeId)?.kind === 'home' && !isCloseKin(candidate, members[0], members[1]), '共同住房');
    num(account.agreedAt, 0, f.lastUpdate, '真实住所协议'); num(account.balance, 0, 1e12, '共同资金余额'); num(account.spent, 0, 1e12, '实际家庭支出'); num(account.returned, 0, 1e12, '实际均分退还');
    let contributed = 0; for (const [id, amount] of Object.entries(dict(account.contributions, 2, '真实出资'))) { ensure(members.includes(id), '仅双方自有现金出资'); num(amount, 0, 1e12, '累计实际出资'); contributed += amount; } ensure(Math.abs(contributed - account.balance - account.spent - account.returned) < 1e-6, '共同资金守恒');
    if (account.closedAt !== null) { num(account.closedAt, account.agreedAt, f.lastUpdate, '终止及退款时刻'); ensure(account.balance === 0, '关闭共同账户已结余额'); }
    let paid = 0; for (const expense of array(account.expenses, 128, '家庭真实购买')) { ensure(object(expense) && shopIds.has(expense.recipientId) && ids.has(expense.targetId), '家庭供货及受养人'); num(expense.at, account.agreedAt, f.lastUpdate, '家庭购买时刻'); num(expense.amount, 1e-7, 1e9, '家庭实际付款'); num(expense.quantity, 1, 1, '实际食品份数'); paid += expense.amount; } ensure(Math.abs(paid - account.spent) < 1e-6, '家庭支出均有真实收款方凭据');
  }
  const ceremonyIds = new Set<string>();
  for (const ceremony of array(f.ceremonies, 64, '家庭婚丧')) {
    ensure(object(ceremony) && /^ceremony-[1-9][0-9]*$/.test(ceremony.id) && Number(ceremony.id.slice(9)) < f.nextCeremonyId && !ceremonyIds.has(ceremony.id), '仪式唯一'); ceremonyIds.add(ceremony.id); ensure(['wedding', 'funeral'].includes(ceremony.kind) && ids.has(ceremony.subjectId) && ids.has(ceremony.organizerId) && sites.get(ceremony.siteId)?.kind === 'pavilion', '仪式主体与亭馆');
    num(ceremony.startedAt, 0, f.lastUpdate, '仪式开始'); num(ceremony.workedMinutes, 0, 30, '实际仪式时数'); ensure(ceremony.workedMinutes <= f.lastUpdate - ceremony.startedAt + 1e-7, '实际仪式投入'); num(ceremony.paid, 30, 30, '真实场地费用'); num(ceremony.materialUnits, 2, 2, '真实仪式用品'); if (ceremony.kind === 'funeral') ensure(!!f.estates[ceremony.subjectId], '葬礼需真实亡故登记');
    const guests = array(ceremony.guestIds, 1025, '实际到场亲友'); ensure(new Set(guests).size === guests.length && guests.every(id => ids.has(id)), '仪式亲友引用');
    for (const [id, minutes] of Object.entries(dict(ceremony.attendanceMinutes, 1025, '亲友现场时数'))) { ensure(ids.has(id), '出席主体'); num(minutes, 0, ceremony.workedMinutes, '亲友真实现场分钟'); } ensure(guests.every(id => ceremony.attendanceMinutes[id] >= 30 - 1e-7), '亲友必须实际到场');
    if (ceremony.completedAt === null) ensure(ceremony.workedMinutes < 30 - 1e-7, '未完成仪式'); else { num(ceremony.completedAt, ceremony.startedAt + 30, f.lastUpdate, '真实仪式完成'); ensure(ceremony.workedMinutes === 30, '完整现场仪式'); }
  }
  for (const [id, guardians] of Object.entries(dict(f.careGuardians, 1024, '接续照料监护'))) { ensure(!!children[id], '接续监护真实儿童'); const members = array(guardians, 2, '接续监护者'); ensure(members.length > 0 && new Set(members).size === members.length && members.every(member => ids.has(member) && member !== id && candidate.extension!.actorProfiles[member].age >= 18), '成年真实监护者'); }
  const saleIds = new Set<string>();
  for (const sale of array(f.estateSales, 256, '遗产执行变卖')) {
    ensure(object(sale) && /^estate-sale-[1-9][0-9]*$/.test(sale.id) && Number(sale.id.slice(12)) < f.nextEstateSaleId && !saleIds.has(sale.id) && !!f.estates[sale.deceasedId] && ['shares', 'business'].includes(sale.kind) && ['offered', 'sold', 'withdrawn'].includes(sale.state), '真实遗产执行标识'); saleIds.add(sale.id);
    ensure(sale.kind === 'shares' ? companyIds.has(sale.assetId) : shopIds.has(sale.assetId) && !candidate.extension!.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === candidate.shops.find(shop => shop.id === sale.assetId)!.buildingId), '可变卖产权');
    num(sale.unitPrice, 1e-7, 1e12, '真实变卖报价'); num(sale.quantity, 1, sale.kind === 'business' ? 1 : 1e8, '真实产权数量', true); num(sale.soldQuantity, 0, sale.quantity, '实卖数量', true); num(sale.proceeds, 0, 1e12, '真实买方款项'); num(sale.createdAt, f.estates[sale.deceasedId].settledAt, f.lastUpdate, '遗产执行排入时钟');
    let paid = 0, quantity = 0;
    for (const receipt of array(sale.receipts, 256, '真实买方付款回执')) { ensure(object(receipt) && ids.has(receipt.buyerId) && receipt.buyerId !== sale.deceasedId, '实际买方'); num(receipt.at, sale.createdAt, f.lastUpdate, '实际产权交易时间'); num(receipt.quantity, 1, sale.quantity, '实际购买整数份额', true); num(receipt.paid, 1e-7, 1e12, '实际买款'); ensure(Math.abs(receipt.paid - receipt.quantity * sale.unitPrice) < 1e-6, '报价不是现金，须有实际买方付款'); paid += receipt.paid; quantity += receipt.quantity; }
    ensure(Math.abs(paid - sale.proceeds) < 1e-6 && quantity === sale.soldQuantity && (sale.state !== 'sold' || sale.soldQuantity === sale.quantity), '产权售出数量与现金回执相符');
    if (sale.state === 'offered') ensure(sale.kind === 'shares' ? (candidate.extension!.companies.find(company => company.id === sale.assetId)!.shareholders[sale.deceasedId] ?? 0) >= sale.quantity - sale.soldQuantity : candidate.shops.find(shop => shop.id === sale.assetId)!.ownerId === sale.deceasedId, '待变卖产权实际仍属于遗产');
  }
}
