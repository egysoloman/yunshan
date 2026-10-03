import type { Simulation } from '../simulation';
import type { Building, Role, SimState } from '../types';
import { canAccessFloor } from '../access';
import { getBuildingBody } from '../architecture-floor-plan';

export interface PlayerLaborEmployer { kind: 'shop' | 'public'; siteId: string; districtId: string; shopId: string | null }
export interface PlayerLaborJob {
  id: string; siteId: string; role: Role; employer: PlayerLaborEmployer;
  startedAt: number; requiredMinutes: number; workedMinutes: number;
  gross: number; ratePerMinute: number; paidGross: number; paidNet: number; paidTax: number; escrow: number; refundedGross: number;
  status: 'working' | 'paused' | 'refundPending' | 'completed' | 'cancelled';
  pauseReason: string; endedAt: number | null; endReason: 'cancelled' | 'worker-deceased' | null;
}
export interface PlayerLaborState {
  version: 1; nextId: number; nextAvailableAt: number; lastObservedAt: number;
  job: PlayerLaborJob | null; history: PlayerLaborJob[];
  stats: { reservedGross: number; paidGross: number; refundedGross: number; workedMinutes: number; completed: number };
}
export interface PlayerLaborAccounting {
  reserve(siteId: string, gross: number): PlayerLaborEmployer | null;
  refund(employer: PlayerLaborEmployer, amount: number): boolean;
  pay(job: PlayerLaborJob, gross: number, minutes: number, interval: { startAt: number; endAt: number }): void;
}
const EPS = 1e-7, SHIFT_MINUTES = 60;
const ROLE_KINDS: Record<Role, string[]> = {
  traveler: ['market', 'workshop', 'farm', 'dock'], police: ['police'], soldier: ['police', 'starport'],
  teacher: ['school'], driver: ['station', 'airport', 'starport', 'dock'], merchant: ['market', 'workshop', 'farm'],
  mayor: ['hall', 'core'], scientist: ['school', 'core', 'workshop', 'data', 'energy'],
  official: ['hall', 'core', 'administration', 'emergency', 'embassy', 'archives', 'energy'],
  council: ['hall', 'core', 'council', 'administration'],
};
const FACILITY_ROLES: Record<string, Role[]> = {
  mayor: ['mayor', 'official', 'council', 'scientist'], council: ['council', 'official', 'mayor'],
  administration: ['official', 'council', 'mayor'], data: ['scientist', 'official', 'mayor'],
  energy: ['driver', 'scientist', 'official', 'mayor'], emergency: ['police', 'soldier', 'official', 'mayor'],
  embassy: ['official', 'council', 'mayor'], archives: ['teacher', 'scientist', 'official', 'mayor'], treasury: ['official', 'mayor'],
};
function permittedRole(site: Building, role: Role): boolean {
  return (ROLE_KINDS[role].includes(site.kind) || !!site.facility && ROLE_KINDS[role].includes(site.facility))
    && (!site.facility || (FACILITY_ROLES[site.facility] ?? []).includes(role));
}
const now = (state: SimState) => state.extension!.lastUpdate;
const atSite = (simulation: Simulation, site: Building) => simulation.isNearBuilding(site, simulation.state.player.position, 2)
  && canAccessFloor(site, Math.floor((simulation.state.player.position.y - site.position.y + .01) / (site.height / site.floors)), simulation.state.player)
  && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site, simulation.state.player.position, 'work'));

/** Wages are held cash until the player actually performs the agreed work. */
export function installPlayerLabor(simulation: Simulation, accounting: PlayerLaborAccounting): void {
  const initialize = (): PlayerLaborState => {
    const state = simulation.state, clock = now(state), runtime = Reflect.get(simulation, 'runtime') as { workAt: number };
    const legacyCooldown = Math.max(0, Math.min(SHIFT_MINUTES, SHIFT_MINUTES - (state.day * 1440 + state.hour * 60 - runtime.workAt)));
    return { version: 1, nextId: 1, nextAvailableAt: clock + legacyCooldown, lastObservedAt: clock, job: null, history: [],
      stats: { reservedGross: 0, paidGross: 0, refundedGross: 0, workedMinutes: 0, completed: 0 } };
  };
  simulation.state.playerLabor = initialize();
  Reflect.set(Reflect.get(simulation, 'runtime'), 'playerLaborVersion', 1);
  const labor = () => simulation.state.playerLabor!;
  const archive = (job: PlayerLaborJob, completed: boolean) => {
    job.status = completed ? 'completed' : 'cancelled'; job.endedAt = now(simulation.state); job.pauseReason = '';
    labor().history.push(job); if (labor().history.length > 64) labor().history.shift(); labor().job = null;
    if (completed) {
      labor().stats.completed++; simulation.state.player.experience++; simulation.state.player.reputation += .8;
      simulation.appendNotice('work', `已在现场完成${SHIFT_MINUTES}分钟劳动，实际税前工资${job.paidGross.toFixed(1)}文已结算。`, job.employer.districtId);
    }
  };
  const cancel = (reason: 'cancelled' | 'worker-deceased') => {
    const job = labor().job!; job.endReason = reason; job.status = 'refundPending'; job.pauseReason = '未赚取工资等待原雇主接收退款。';
    if (job.escrow === 0 || accounting.refund(job.employer, job.escrow)) {
      labor().stats.refundedGross += job.escrow; job.refundedGross += job.escrow; job.escrow = 0; archive(job, false);
    }
  };
  simulation.registerCommandHandler(command => {
    if (command.type !== 'work' && command.type !== 'cancelWork') return null;
    if (command.type === 'cancelWork') {
      if (!labor().job) return { ok: false, message: '当前没有进行中的工班。' };
      cancel('cancelled'); return { ok: true, message: labor().job ? '已停止劳动，未赚取工资仍由托管保留，等待原雇主实际接收退款。' : '已停止工班，未赚取的托管工资原额退回雇主；已赚工资保留。' };
    }
    if (labor().job) return { ok: false, message: '已有工班。回到原工作地点继续，或先取消；不能重复领取工资。' };
    const state = simulation.state, roles = [state.player.role, ...(state.player.identities ?? [])];
    const sites = simulation.worldDefinition.buildings.filter(site => (!command.targetId || site.id === command.targetId) && atSite(simulation, site));
    const site = sites.find(site => roles.some(role => permittedRole(site, role)));
    if (!site) return { ok: false, message: '请亲自进入有相应职业资质的工作设施，或走到入口两米内。' };
    if (state.player.vehicleId || state.aviation?.activeAircraftId) return { ok: false, message: '请先下车或退出航空载具，再进入工作场所。' };
    if (state.hour < 6 || state.hour >= 21 || now(state) + EPS < labor().nextAvailableAt) return { ok: false, message: '请在日间工作时段开始工班，并等候既有工班冷却结束。' };
    if (!state.extension!.actorProfiles.player.alive || state.player.needs.hunger < 12 || state.player.needs.fatigue < 15) return { ok: false, message: '请先进食、休息，保持能够劳动的身体状态。' };
    const role = roles.find(role => permittedRole(site, role))!, gross = role === 'traveler' ? 35 : role === 'mayor' ? 95 : 62;
    const employer = accounting.reserve(site.id, gross);
    if (!employer) return { ok: false, message: '雇主没有可支持本班的现金；既有工资债务、已承诺班次与必要运营资金继续保留。' };
    labor().job = { id: `player-work-${labor().nextId++}`, siteId: site.id, role, employer, startedAt: now(state), requiredMinutes: SHIFT_MINUTES,
      workedMinutes: 0, gross, ratePerMinute: gross / SHIFT_MINUTES, paidGross: 0, paidNet: 0, paidTax: 0, escrow: gross, refundedGross: 0,
      status: 'working', pauseReason: '', endedAt: null, endReason: null };
    labor().stats.reservedGross += gross; labor().nextAvailableAt = now(state); labor().lastObservedAt = now(state);
    return { ok: true, message: `已开始${site.name}的${SHIFT_MINUTES}分钟现场工班，${gross}文工资由真实现金托管；离场暂停，按实际劳动结算。` };
  });
  simulation.onPhase('people', (state, minutes) => {
    const elapsed = Math.min(minutes, Math.max(0, now(state) - labor().lastObservedAt)); labor().lastObservedAt = now(state);
    const job = labor().job; if (!job) return;
    if (job.status === 'refundPending') { cancel(job.endReason ?? 'cancelled'); return; }
    if (!state.extension!.actorProfiles.player.alive) { cancel('worker-deceased'); return; }
    const site = simulation.worldDefinition.buildings.find(site => site.id === job.siteId)!;
    const reason = !atSite(simulation, site) ? '离开原工作场所，工班暂停。'
      : state.player.vehicleId || state.aviation?.activeAircraftId ? '乘车期间不能计入现场劳动。'
      : !simulation.hasIdentity(job.role) ? '缺少本班职业资质。'
      : state.player.needs.hunger < 12 || state.player.needs.fatigue < 15 ? '需要进食或休息，工班暂停。' : '';
    if (reason) { job.status = 'paused'; job.pauseReason = reason; return; }
    // Clip actual elapsed time to the daily operating interval, including a
    // tick that crosses 21:00. Display-time changes cannot advance this clock.
    const end = state.hour * 60, start = end - elapsed;
    const openMinutes = Math.max(0, Math.min(end, 21 * 60) - Math.max(start, 6 * 60));
    const credited = Math.min(openMinutes, job.requiredMinutes - job.workedMinutes);
    if (credited <= 0) { job.status = 'paused'; job.pauseReason = '场所已结束日间工作，回到日间可继续原班。'; return; }
    const worked = job.workedMinutes + credited, earned = worked === job.requiredMinutes ? job.gross : worked * job.ratePerMinute, gross = earned - job.paidGross;
    if (state.player.money + gross * (1 - state.taxRate) > 1e9) { job.status = 'paused'; job.pauseReason = '钱包已达上限，工资托管保留，待能接收时继续。'; return; }
    const tax = gross * state.taxRate;
    job.workedMinutes = worked; job.paidGross = earned; job.paidNet += gross - tax; job.paidTax += tax; job.escrow = job.gross - earned;
    labor().stats.workedMinutes += credited; labor().stats.paidGross += gross; job.status = 'working'; job.pauseReason = '';
    const creditedStartAt = now(state) - elapsed + Math.max(0, 6 * 60 - start);
    accounting.pay(job, gross, credited, { startAt: creditedStartAt, endAt: creditedStartAt + credited });
    state.player.needs.fatigue = Math.max(0, state.player.needs.fatigue - credited * .2);
    state.player.needs.hunger = Math.max(0, state.player.needs.hunger - credited * (7 / SHIFT_MINUTES));
    if (worked === job.requiredMinutes) archive(job, true);
  });
  simulation.registerSaveValidator(candidate => validatePlayerLabor(candidate, simulation.worldDefinition.buildings));
  simulation.onLoad(() => {
    if (!simulation.state.playerLabor) simulation.state.playerLabor = initialize();
    Reflect.set(Reflect.get(simulation, 'runtime'), 'playerLaborVersion', 1);
  });
}

export function validatePlayerLabor(state: SimState, sites: Building[]): void {
  const labor = state.playerLabor; if (!labor) return;
  const ensure = (value: unknown, text: string) => { if (!value) throw new Error(`玩家劳动存档无效：${text}。`); };
  const number = (value: unknown, max = 1e12): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  ensure(labor.version === 1 && Number.isInteger(labor.nextId) && labor.nextId > 0 && labor.nextId <= 1e9 && state.extension, '版本/编号');
  ensure(number(labor.nextAvailableAt) && labor.nextAvailableAt <= now(state) + SHIFT_MINUTES + EPS && number(labor.lastObservedAt) && labor.lastObservedAt <= now(state) + EPS, '单调时钟');
  ensure(Array.isArray(labor.history) && labor.history.length <= 64 && (labor.job === null || typeof labor.job === 'object'), '工班记录');
  const ids = new Set<string>();
  for (const job of [...labor.history, ...(labor.job ? [labor.job] : [])]) {
    ensure(job && /^player-work-[1-9][0-9]*$/.test(job.id) && Number(job.id.slice(12)) < labor.nextId && !ids.has(job.id), '工班身份'); ids.add(job.id);
    const site = sites.find(site => site.id === job.siteId);
    ensure(site && ROLE_KINDS[job.role] && permittedRole(site, job.role), '岗位与资格');
    ensure(job.employer && job.employer.siteId === job.siteId && job.employer.districtId === site!.districtId && ['shop', 'public'].includes(job.employer.kind), '原雇主');
    const shop = state.shops.find(shop => shop.id === job.employer.shopId);
    ensure(job.employer.kind === 'shop' ? shop?.buildingId === job.siteId : job.employer.shopId === null && !state.shops.some(shop => shop.buildingId === job.siteId), '真实经营账户');
    ensure(number(job.startedAt) && job.startedAt <= now(state) + EPS && job.requiredMinutes === SHIFT_MINUTES && number(job.workedMinutes, SHIFT_MINUTES), '真实劳动时间');
    ensure(job.workedMinutes <= now(state) - job.startedAt + EPS, '劳动不能超过实际经过的时间');
    const expectedGross = job.role === 'traveler' ? 35 : job.role === 'mayor' ? 95 : 62;
    ensure(job.gross === expectedGross && number(job.ratePerMinute) && Math.abs(job.ratePerMinute - job.gross / SHIFT_MINUTES) <= EPS, '冻结薪率');
    ensure(number(job.paidGross, job.gross) && number(job.paidNet, job.gross) && number(job.paidTax, job.gross)
      && Math.abs(job.paidNet + job.paidTax - job.paidGross) <= EPS && number(job.escrow, job.gross) && number(job.refundedGross, job.gross)
      && Math.abs(job.paidGross - job.workedMinutes * job.ratePerMinute) <= EPS && Math.abs(job.paidGross + job.escrow + job.refundedGross - job.gross) <= EPS, '托管/劳动/付款守恒');
    ensure(['working', 'paused', 'refundPending', 'completed', 'cancelled'].includes(job.status) && typeof job.pauseReason === 'string' && job.pauseReason.length <= 100
      && [null, 'cancelled', 'worker-deceased'].includes(job.endReason), '状态');
    if (job === labor.job) ensure(['working', 'paused', 'refundPending'].includes(job.status) && job.endedAt === null && (job.status === 'refundPending') === (job.endReason !== null), '进行中工班');
    else ensure(['completed', 'cancelled'].includes(job.status) && job.escrow === 0 && number(job.endedAt) && job.endedAt >= job.startedAt && job.endedAt <= now(state) + EPS
      && (job.status === 'completed' ? job.workedMinutes === SHIFT_MINUTES && job.endReason === null : job.endReason !== null), '已结束工班');
  }
  ensure(labor.stats && ['reservedGross', 'paidGross', 'refundedGross', 'workedMinutes', 'completed'].every(key => number(labor.stats[key as keyof typeof labor.stats])), '统计');
  ensure(Number.isInteger(labor.stats.completed) && labor.stats.completed < labor.nextId && Math.abs(labor.stats.reservedGross - labor.stats.paidGross - labor.stats.refundedGross - (labor.job?.escrow ?? 0)) <= Math.max(EPS, labor.stats.reservedGross * 1e-10), '累计真实托管现金');
}
