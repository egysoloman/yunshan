import type { Simulation } from '../simulation';
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
}
export interface FamilyEstate {
  settledAt: number;
  heirIds: string[];
  cash: number;
  shares: Record<string, number>;
}
export interface FamilyState {
  version: 1;
  lastUpdate: number;
  nextResidentId: number;
  nextPregnancyId: number;
  pregnancies: Pregnancy[];
  children: Record<string, FamilyChild>;
  studentGuardians: Record<string, string[]>;
  nextSupportAt: Record<string, number>;
  nextPlanAt: Record<string, number>;
  estates: Record<string, FamilyEstate>;
}
type FamilySimState = SimState & { family?: FamilyState };
type ProvisionedCitizen = Citizen & { food?: number };
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Family assets, timers and genealogy are authoritative saved state, never view data. */
export function installFamily(simulation: Simulation): void {
  const world = simulation.worldDefinition;
  const buildings = new Map(world.buildings.map(site => [site.id, site]));
  const state = () => simulation.state as FamilySimState;
  const family = () => state().family!;
  const actor = (id: string) => id === 'player' ? state().player : state().citizens.find(person => person.id === id);
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
    const f: FamilyState = { version: 1, lastUpdate: now(), nextResidentId: 1, nextPregnancyId: 1, pregnancies: [], children: {}, studentGuardians: {}, nextSupportAt: {}, nextPlanAt: {}, estates: {} };
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

  const guardiansOf = (id: string) => family().children[id]?.parentIds ?? family().studentGuardians[id] ?? [];
  const ready = (id: string) => {
    const a = actor(id), p = profile(id);
    return !!a && !!p && p.alive && p.age >= 18 && p.age <= 45 && p.health >= 70 && p.mood >= 55 && p.stress <= 50
      && a.needs.hunger >= 50 && a.needs.fatigue >= 50 && a.money >= 2 * FAMILY_RESERVE;
  };
  const eligiblePair = (firstId: string, secondId: string) => {
    const first = actor(firstId), second = actor(secondId), f = family();
    if (!first || !second || firstId === secondId || first.partnerId !== secondId || second.partnerId !== firstId
      || !first.homeId || first.homeId !== second.homeId || buildings.get(first.homeId)?.kind !== 'home' || !ready(firstId) || !ready(secondId)) return false;
    if (state().citizens.length + f.pregnancies.length >= 1024 || f.pregnancies.some(job => job.parentIds.includes(firstId) || job.parentIds.includes(secondId))) return false;
    if (Object.values(f.children).filter(child => child.parentIds.includes(firstId) || child.parentIds.includes(secondId)).length >= 4) return false;
    if ((f.nextPlanAt[firstId] ?? 0) > now() + 1e-7 || (f.nextPlanAt[secondId] ?? 0) > now() + 1e-7) return false;
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
    notice(`${citizen.name}登记${school.name}，由家长支付40文；到校实际学习才增加教育。`, citizen.districtId);
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
      if (!heirs.length) continue;
      // Later receipts cannot strand money in the deceased actor's inactive wallet.
      const cash = deceased.money;
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
    }
  };

  simulation.onPhase('time', () => { family().lastUpdate = now(); });
  simulation.onPhase('people', (s, minutes) => {
    const f = family();
    for (let index = f.pregnancies.length - 1; index >= 0; index--) {
      const pregnancy = f.pregnancies[index];
      if (!alive(pregnancy.carrierId)) {
        for (const id of pregnancy.parentIds) { actor(id)!.money += pregnancy.escrow / 2; record(id, pregnancy.escrow / 2, '生育中止托管退款', buildings.get(pregnancy.homeId)!.districtId); }
        f.pregnancies.splice(index, 1); notice('孕育因承孕者生命终结而中止，家庭托管余额原额退回并按遗产规则处理。'); continue;
      }
      if (now() + 1e-7 < pregnancy.dueAt || s.citizens.length >= 1024) continue;
      const home = buildings.get(pregnancy.homeId)!, id = `resident-${f.nextResidentId++}`;
      const child: ProvisionedCitizen = { id, name: `云山新生${id.slice(9)}`, districtId: home.districtId, homeId: home.id, workId: home.id, role: '幼儿', position: { ...home.door }, state: 'atHome', destinationId: null, money: pregnancy.escrow - FAMILY_RESERVE, food: 0, needs: { hunger: 85, fatigue: 95, social: 80, fun: 75 }, tier: s.districts.find(d => d.id === home.districtId)?.tier ?? 'statistical', route: [], routeIndex: 0, partnerId: null, skills: { craft: 0, learning: 0, social: 0 }, education: 0, socialIdentities: ['familyMember'], historyTags: ['云山出生'] };
      s.citizens.push(child); s.extension!.actorProfiles[id] = { age: 0, health: 90, mood: 80, stress: 0, alive: true, skill: 0, family: [], historyTags: ['云山出生'] };
      record(id, child.money, '生育托管转为儿童生活费', home.districtId);
      f.children[id] = { parentIds: pregnancy.parentIds, bornAt: now(), homeId: home.id, schoolId: null, attendanceMinutes: 0, studyToday: 0, schoolDay: Math.floor(now() / GAME_DAY), graduatedAt: null };
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
      const citizen = actor(id) as ProvisionedCitizen, p = profile(id), parents = child.parentIds.filter(alive);
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
        const payer = parents.find(parentId => parentId !== 'player' && actor(parentId)!.money >= FAMILY_RESERVE + SCHOOL_FEE);
        const school = world.buildings.filter(site => site.kind === 'school').sort((a, b) => distance(a.door, citizen.position) - distance(b.door, citizen.position))[0];
        if (payer && school) enroll(id, school.id, payer);
      }
      const school = child.schoolId ? buildings.get(child.schoolId) : null;
      const day = Math.floor(now() / GAME_DAY); if (child.schoolDay !== day) { child.schoolDay = day; child.studyToday = 0; }
      if (school && citizen.state === 'studying' && simulation.isNearBuilding(school, citizen.position, 1) && s.hour >= 7.5 && s.hour < 17.5
        && citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 40 && p.health >= 45) {
        const elapsed = Math.max(0, Math.min(minutes, 240 - child.studyToday));
        child.studyToday += elapsed; child.attendanceMinutes += elapsed;
        citizen.education = Math.min(20, Math.floor(child.attendanceMinutes / SCHOOL_MINUTES_PER_LEVEL));
        citizen.skills!.learning = clamp((citizen.skills!.learning ?? 0) + elapsed * .003);
      }
      if (p.age >= 18 && child.graduatedAt === null && child.attendanceMinutes >= 3 * SCHOOL_MINUTES_PER_LEVEL && (citizen.education ?? 0) >= 3) {
        const workplace = world.buildings.filter(site => ['workshop', 'farm', 'market'].includes(site.kind) && !site.facility)
          .sort((a, b) => distance(a.door, citizen.position) - distance(b.door, citizen.position))[0];
        if (workplace) {
          child.graduatedAt = now(); citizen.role = workplace.kind === 'farm' ? '农民' : '工人'; citizen.workId = workplace.id; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
          citizen.historyTags = [...new Set([...(citizen.historyTags ?? []), '学成进入劳动市场'])].slice(-32); p.historyTags.push('学成进入劳动市场');
          notice(`${citizen.name}成年学成，开始寻找${workplace.name}的真实岗位。`, citizen.districtId);
        }
      }
      if (p.age >= 18 && ['幼儿', '儿童'].includes(citizen.role)) {
        const workplace = world.buildings.filter(site => ['workshop', 'farm', 'market'].includes(site.kind) && !site.facility)
          .sort((a, b) => distance(a.door, citizen.position) - distance(b.door, citizen.position))[0];
        if (workplace) {
          citizen.role = workplace.kind === 'farm' ? '农民' : '工人'; citizen.workId = workplace.id;
          citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
          citizen.historyTags = [...new Set([...(citizen.historyTags ?? []), '成年谋生'])].slice(-32);
          notice(`${citizen.name}已成年，可从低技能岗位谋生；未完成的学业仍有保留记录。`, citizen.districtId);
        }
      }
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
  const handled = new Set(['planFamily', 'supportFamily', 'enrollChild']);
  simulation.registerCommandHandler((command: Command): CommandResult | null => {
    if (!handled.has(command.type)) return null;
    const fail = (message: string): CommandResult => ({ ok: false, message });
    if (command.targetId !== undefined && typeof command.targetId !== 'string') return fail('家庭目标须为有效居民标识。');
    if (!alive('player')) return fail('生命已结束，不能继续家庭操作。');
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
    if (command.type === 'supportFamily') {
      const amount = command.value ?? 20;
      if (!finite(amount) || !Number.isInteger(amount) || amount < 1 || amount > 1000 || state().player.money < amount) return fail('扶养金额须为1至1000的整数且有足额现金。');
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
  simulation.onLoad(() => { if (!state().family) state().family = initialize(); });
}

/** Also gives the core a strict birth registry for its bounded dynamic population. */
export function validateFamilyState(candidate: SimState, world: WorldDefinition): void {
  const f = (candidate as FamilySimState).family; if (f === undefined) return;
  const ensure = (condition: unknown, label: string): void => { if (!condition) throw new Error(`家庭存档无效：${label}`); };
  const num = (value: unknown, min: number, max: number, label: string, integer = false) => ensure(finite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const dict = (value: unknown, max: number, label: string): Record<string, any> => { ensure(object(value) && Object.keys(value).length <= max, label); return value as Record<string, any>; };
  const array = (value: unknown, max: number, label: string): any[] => { ensure(Array.isArray(value) && value.length <= max, label); return value as any[]; };
  const ids = new Set(['player', ...candidate.citizens.map(person => person.id)]), sites = new Map(world.buildings.map(site => [site.id, site]));
  ensure(object(f) && f.version === 1 && !!candidate.extension, '版本与生命扩展');
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
    num(child.attendanceMinutes, 0, 1e10, '实际学习分钟'); num(child.studyToday, 0, 240, '本日学时'); num(child.schoolDay, 0, Math.floor(f.lastUpdate / GAME_DAY), '学校日', true);
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
  }
}
