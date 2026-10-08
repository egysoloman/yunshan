import type { Simulation } from '../simulation';
import type { Building, Citizen, CommandResult, Shop, SimState, WorldDefinition } from '../types';
import { shopLifecycleAllowsOperation, shopLifecycleAllowsNewPayroll } from './shop_lifecycle';

/** Finite night service uses existing wages, stock, roles and geometry.
 * Core remains the sole movement/attendance/retail writer. */
export interface NightRetailAllowance {
  day: number; assignmentKey: string; ratePerMinute: number;
  approvedMinutes: number; workedMinutes: number; attendanceMinutes: number;
  funds: number; protectedFunds: number;
}
export interface NightRetailAccounts {
  /** Root's one-line lazy runtime.nightRetailVersion=1 source marker. */
  activate(): void;
  /** Read the original private plan and original attendance, never amend them. */
  allowance(state: SimState, citizen: Citizen, shop: Shop): NightRetailAllowance | null;
  /** Full work-point ACL, .35 support,1.72 clearance and current voxel guard. */
  atWork(citizen: Citizen, site: Building): boolean;
  /** Current ordinary needs/route/wallet evidence; no20:00 hiring cutoff. */
  demandIds(shop: Shop, endsAt: number): readonly string[];
  /** Dispatch, rider, committed clinical/care tasks cannot be commandeered. */
  actorBusy(citizen: Citizen): boolean;
  /** Zero-load declaration only; this callback never grants service or wages. */
  canRequestInitialPower(state: SimState, site: Building): boolean;
  /** Current native energy dispatch, not a prior commerce.open flag. */
  powerAvailable(state: SimState, site: Building): boolean;
  /** isCanonicalNpcWage(event, simulation), including state/tick/clock. */
  isCanonicalWage(event: object): boolean;
  /** Only the core's current nightRetail branch, not a forged state string. */
  serving(citizenId: string, jobId: string): boolean;
}
export interface NightRetailJob {
  id: string; shopId: string; buildingId: string; operatorId: string;
  startedAt: number; endsAt: number; lastServedAt: number | null;
  lastObservedTick: number | null; lastObservedAt: number | null;
  servedMinutes: number; status: 'active' | 'paused' | 'completed' | 'cancelled';
  pauseReason: string; endedAt: number | null; demandIds: string[];
  funding: { kind: 'existing-private-assignment'; day: number; assignmentKey: string;
    ratePerMinute: number; approvedMinutes: number; workedMinutesAtStart: number;
    attendanceMinutesAtStart: number; fundsAtStart: number; protectedFundsAtStart: number };
}
export interface NightRetailState { version: 1; nextId: number; shopIds: string[]; jobs: NightRetailJob[] }
type NightState = SimState & { nightRetail?: NightRetailState };
type NightShop = Shop & { nightRetailVersion?: 1 };
interface WageEvent { citizenId?: string; shopId?: string; siteId?: string; minutes?: number;
  amount?: number; ratePerMinute?: number; creditedWorkStartAt?: number; creditedWorkEndAt?: number }
interface ServiceWitness { tick: number; at: number; jobId: string }
const EPS = 1e-7, MAX_JOBS = 128, MAX_DEMANDS = 128, MAX_WINDOW = 120;
const installations = new WeakMap<Simulation, NightRetailAccounts>();
const serviceWitnesses = new WeakMap<SimState, Map<string, ServiceWitness>>();
const observedWages = new WeakSet<object>();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clock = (state: SimState): number => state.extension?.lastUpdate ?? state.day *1440 + state.hour *60;
const dictionary = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactFields = (value: unknown, keys: readonly string[]): boolean => dictionary(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const night = (at: number): boolean => at %1440 >= 22*60 || at %1440 < 6*60;
const liveOperator = (state: SimState, citizen: Citizen): boolean => {
  const profile = state.extension?.actorProfiles[citizen.id];
  return !!profile?.alive && profile.age >=18 && profile.health >=45 && profile.mood >=55
    && profile.stress <=55 && ['merchant','商人'].includes(citizen.role)
    && citizen.needs.hunger >=50 && citizen.needs.fatigue >=45;
};
const operatorId = (state: SimState, shop: Shop): string | undefined => state.extension?.companies
  .find(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)?.ownerId ?? shop.ownerId;
const remaining = (proof: NightRetailAllowance | null, at: number): number => {
  if (!proof || !Number.isSafeInteger(proof.day) || proof.day !== Math.floor(at /1440)
    || !proof.assignmentKey || !finite(proof.ratePerMinute) || proof.ratePerMinute <0
    || !finite(proof.approvedMinutes) || proof.approvedMinutes <0 || proof.approvedMinutes >480
    || !finite(proof.workedMinutes) || proof.workedMinutes <0 || proof.workedMinutes >proof.approvedMinutes +EPS
    || !finite(proof.attendanceMinutes) || proof.attendanceMinutes <0 || proof.attendanceMinutes >480 +EPS
    || !finite(proof.funds) || proof.funds <0 || proof.funds >1e9
    || !finite(proof.protectedFunds) || proof.protectedFunds <0 || proof.protectedFunds >proof.funds +EPS) return 0;
  return Math.max(0, Math.min(proof.approvedMinutes -proof.workedMinutes, 480 -proof.attendanceMinutes));
};
const currentJob = (state: SimState, shopId: string): NightRetailJob | undefined => (state as NightState).nightRetail?.jobs
  .find(job => job.shopId === shopId && (job.status === 'active' || job.status === 'paused') && job.endsAt >=clock(state) -EPS);

function eligibility(simulation: Simulation, citizen: Citizen, allowInitialPower = false): { shop: Shop; site: Building;
  allowance: NightRetailAllowance; endsAt: number; demandIds: string[] } | null {
  const accounts = installations.get(simulation), state = simulation.state, at = clock(state);
  if (!accounts || !night(at) || !liveOperator(state, citizen) || accounts.actorBusy(citizen)) return null;
  const shop = state.shops.find(item => item.buildingId === citizen.workId && operatorId(state,item) === citizen.id);
  const site = shop && simulation.worldDefinition.buildings.find(item => item.id === shop.buildingId);
  if (!shop || !site || site.kind !== 'market' || site.facility || shop.inventory <1
    || !shopLifecycleAllowsOperation(state,shop.id) || !shopLifecycleAllowsNewPayroll(state,shop.id)
    || !accounts.atWork(citizen,site) || (!accounts.powerAvailable(state,site)
      && !(allowInitialPower && accounts.canRequestInitialPower(state,site)))) return null;
  const allowance = accounts.allowance(state,citizen,shop), minutes = remaining(allowance,at);
  if (!allowance || minutes <=EPS) return null;
  // Original private plans are day-bound. Stop at midnight; never mint next day.
  const dayEnd = (Math.floor(at /1440) +1)*1440;
  const six = Math.floor(at /1440)*1440 +(at %1440 <6*60 ? 6*60 : 30*60);
  const endsAt = Math.min(at +MAX_WINDOW, at +minutes, dayEnd, six);
  const known = new Set(state.citizens.map(actor => actor.id));
  const demandIds = [...new Set(accounts.demandIds(shop,endsAt))].filter(id => known.has(id)).slice(0,MAX_DEMANDS);
  if (!demandIds.length || endsAt <=at +EPS) return null;
  return {shop,site,allowance,endsAt,demandIds};
}

export function nightRetailTask(simulation: Simulation, citizen: Citizen): NightRetailJob | null {
  const state = simulation.state, at = clock(state);
  const job = (state as NightState).nightRetail?.jobs.find(item => item.operatorId === citizen.id
    && (item.status === 'active' || item.status === 'paused') && item.endsAt >=at -EPS);
  if (!job || !eligibility(simulation,citizen)) return null;
  return job;
}
export function nightRetailNeedsContinuousPeople(simulation: Simulation, citizen: Citizen): boolean {
  return !!eligibility(simulation,citizen,true);
}
export function nightRetailOpportunities(simulation: Simulation, citizen: Citizen):
  { destination: Building; activity: 'nightRetail'; score: number }[] {
  const eligible = eligibility(simulation,citizen,true);
  // A voluntary merchant response competes with the unchanged140-night-rest
  // preference. Only finite available meals and named reachable demand count.
  const interest = eligible ? Math.min(30,Math.min(Math.floor(eligible.shop.inventory),eligible.demandIds.length*2)*5) :0;
  return eligible ? [{destination: eligible.site, activity: 'nightRetail', score: 165 +interest}] : [];
}

/** Core calls only after choosing the actual voluntary opportunity. */
export function beginNightRetail(simulation: Simulation, citizenId: string): CommandResult {
  const citizen = simulation.state.citizens.find(item => item.id === citizenId);
  const eligible = citizen && eligibility(simulation,citizen,true);
  if (!eligible || !citizen) return {ok:false,message:'夜间柜台需要本人商人资格、真实工作点、有限需求与原已资助剩余工时。'};
  const state = simulation.state as NightState, at = clock(state), existing = currentJob(state,eligible.shop.id);
  if (existing) return existing.operatorId === citizenId ? {ok:true,message:'继续原有限夜班，不另签工资或刷新期限。'}
    : {ok:false,message:'原柜台已有另一具名夜班，不能覆盖。'};
  if (state.nightRetail?.jobs.some(job => job.operatorId === citizenId && ['active','paused'].includes(job.status)
    && job.endsAt >at +EPS)) return {ok:false,message:'同一经营者不能同时承诺两个夜间柜台。'};
  const terminal = state.nightRetail?.jobs.findIndex(job => job.status === 'completed' || job.status === 'cancelled') ?? -1;
  if ((state.nightRetail?.jobs.length ??0) >=MAX_JOBS && terminal <0) return {ok:false,message:'夜间经营记录容量已满，原活动承诺保留。'};
  const body = state.nightRetail ??= {version:1,nextId:1,shopIds:[],jobs:[]};
  if (body.jobs.length >=MAX_JOBS) body.jobs.splice(terminal,1);
  if (!body.shopIds.includes(eligible.shop.id)) body.shopIds.push(eligible.shop.id);
  (eligible.shop as NightShop).nightRetailVersion =1;
  installations.get(simulation)!.activate();
  const p = eligible.allowance;
  body.jobs.push({id:`night-retail-${body.nextId++}`,shopId:eligible.shop.id,buildingId:eligible.site.id,operatorId:citizenId,
    startedAt:at,endsAt:eligible.endsAt,lastServedAt:null,lastObservedTick:null,lastObservedAt:null,
    servedMinutes:0,status:'active',pauseReason:'等待下一实际到场计薪窗口。',endedAt:null,demandIds:eligible.demandIds,
    funding:{kind:'existing-private-assignment',day:p.day,assignmentKey:p.assignmentKey,ratePerMinute:p.ratePerMinute,
      approvedMinutes:p.approvedMinutes,workedMinutesAtStart:p.workedMinutes,attendanceMinutesAtStart:p.attendanceMinutes,
      fundsAtStart:p.funds,protectedFundsAtStart:p.protectedFunds}});
  return {ok:true,message:'已声明有限夜班，只使用原资助剩余工时；尚未计薪服务时不开放柜台。'};
}

export function stopNightRetail(simulation: Simulation, citizenId: string): CommandResult {
  const state = simulation.state as NightState, at = clock(state), job = state.nightRetail?.jobs.find(item =>
    item.operatorId === citizenId && ['active','paused'].includes(item.status) && item.endsAt >at +EPS);
  if (!job) return {ok:false,message:'没有本人的未结夜班。'};
  job.status ='cancelled'; job.endedAt =at; job.pauseReason ='本人停止夜班；原工资债和已签原额度保留。';
  serviceWitnesses.get(state)?.delete(job.shopId);
  return {ok:true,message:'已停止柜台；不退款虚构本金、不撤销已赚工资。'};
}

/** Planned consumption is independent of last commerce.open and service cache.
 * Energy runs before people. Persist the resulting planned flag in new power
 * load-source schema; old histories must keep their old-hour interpretation. */
export function nightRetailPlannedOpen(state: SimState, shopId: string, at = clock(state)): boolean {
  const shop = state.shops.find(item => item.id === shopId), job = (state as NightState).nightRetail?.jobs.find(item =>
    item.shopId === shopId && ['active','paused'].includes(item.status) && at >=item.startedAt && at <=item.endsAt +EPS);
  const citizen = job && state.citizens.find(item => item.id === job.operatorId);
  return !!shop && !!job && !!citizen && night(at) && liveOperator(state,citizen)
    && operatorId(state,shop) ===job.operatorId && shopLifecycleAllowsOperation(state,shopId);
}
export function shopScheduledOpen(state: SimState, building: Building, shopId: string, at = clock(state)): boolean {
  // Preserve the actual legacy display-time schedule, including setTime.
  const dayOpen = state.hour >=6 && state.hour <(building.kind ==='market' ?22:20);
  return dayOpen || building.kind ==='market' && at ===clock(state) && nightRetailServedNow(state,shopId);
}
export function shopPlannedOpen(state: SimState, building: Building, shopId: string, at =clock(state)): boolean {
  const dayOpen =state.hour >=6 && state.hour <(building.kind ==='market' ?22:20);
  return dayOpen || building.kind ==='market' && nightRetailPlannedOpen(state,shopId,at);
}
export function nightRetailServedNow(state: SimState, shopId: string): boolean {
  const witness = serviceWitnesses.get(state)?.get(shopId);
  const job = (state as NightState).nightRetail?.jobs.find(item => item.id ===witness?.jobId);
  const shop =job && state.shops.find(item => item.id ===shopId), citizen =job && state.citizens.find(item => item.id ===job.operatorId);
  // The final earned slice is usable in this commerce phase; no next-phase
  // witness survives the time hook, even when the original cap is now0.
  return !!witness && !!job && !!shop && !!citizen && job.status ==='active' && witness.tick ===state.tick
    && witness.at ===clock(state) && clock(state) <=job.endsAt +EPS && liveOperator(state,citizen)
    && operatorId(state,shop) ===job.operatorId && shopLifecycleAllowsOperation(state,shopId);
}

function observeWage(simulation: Simulation, event: WageEvent & object, minutes: number): void {
  const accounts = installations.get(simulation), state = simulation.state, at = clock(state);
  if (!accounts || observedWages.has(event) || !accounts.isCanonicalWage(event) || !event.citizenId || !event.shopId
    || !finite(minutes) || minutes <=0 || minutes >4 || !finite(event.minutes) || event.minutes <=0
    || !finite(event.amount) || event.amount <0 || !finite(event.ratePerMinute) || event.ratePerMinute <0
    || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt)
    || event.creditedWorkStartAt >event.creditedWorkEndAt || event.creditedWorkEndAt >at +EPS
    || Math.abs(event.creditedWorkEndAt -event.creditedWorkStartAt -event.minutes) >EPS) return;
  const job = currentJob(state,event.shopId), citizen = state.citizens.find(item => item.id ===event.citizenId);
  const site = job && simulation.worldDefinition.buildings.find(item => item.id ===job.buildingId);
  if (!job || !citizen || !site || job.operatorId !==citizen.id || event.siteId !==site.id
    || event.ratePerMinute !==job.funding.ratePerMinute || citizen.workId !==site.id
    || !accounts.serving(citizen.id,job.id) || accounts.actorBusy(citizen) || !liveOperator(state,citizen)
    || !accounts.atWork(citizen,site) || !accounts.powerAvailable(state,site) || !shopLifecycleAllowsOperation(state,job.shopId)) return;
  const start = Math.max(at -minutes,job.startedAt,event.creditedWorkStartAt,job.lastServedAt ??job.startedAt);
  const end = Math.min(at,job.endsAt,event.creditedWorkEndAt);
  const capacity = Math.min(job.funding.approvedMinutes -job.funding.workedMinutesAtStart,
    480 -job.funding.attendanceMinutesAtStart,job.endsAt -job.startedAt) -job.servedMinutes;
  if (end <=start +EPS || end -start >capacity +EPS) return;
  observedWages.add(event); job.servedMinutes +=end -start; job.lastServedAt =end;
  job.lastObservedTick =state.tick; job.lastObservedAt =at; job.status ='active'; job.pauseReason ='';
  let cache = serviceWitnesses.get(state); if (!cache) serviceWitnesses.set(state,cache =new Map());
  cache.set(job.shopId,{tick:state.tick,at,jobId:job.id});
}

/** Saved history is bounded provenance, not cryptographic tamper proof. Core
 * must additionally call validateNightRetailFunding with parsed private plan. */
export function validateNightRetailState(state: SimState, world: WorldDefinition): void {
  const body = (state as NightState).nightRetail, marked = state.shops.filter(shop => (shop as NightShop).nightRetailVersion !==undefined);
  const need = (value: unknown, message: string): void => {if (!value) throw new Error(`无效夜间经营存档：${message}`);};
  if (body ===undefined) {need(!marked.length,'缺少被声明店铺的模块');return;}
  need(exactFields(body,['version','nextId','shopIds','jobs']) && body.version ===1 && Number.isSafeInteger(body.nextId) && body.nextId >=1,'版本/编号/字段');
  need(Array.isArray(body.shopIds) && body.shopIds.length <=state.shops.length && new Set(body.shopIds).size ===body.shopIds.length,'店铺登记');
  need(Array.isArray(body.jobs) && body.jobs.length <=MAX_JOBS,'有限夜班历史');
  const shops = new Map(state.shops.map(shop => [shop.id,shop])), actors = new Set(state.citizens.map(actor => actor.id));
  for (const id of body.shopIds) {const shop = shops.get(id), site = shop && world.buildings.find(item => item.id ===shop.buildingId);
    need(shop && (shop as NightShop).nightRetailVersion ===1 && site?.kind ==='market' && !site.facility,'原市集及marker');}
  need(marked.length ===body.shopIds.length,'marker双向对应');
  const ids = new Set<string>(), liveShops = new Set<string>(), liveActors = new Set<string>(), at = clock(state);
  for (const job of body.jobs) {
    need(exactFields(job,['id','shopId','buildingId','operatorId','startedAt','endsAt','lastServedAt','lastObservedTick','lastObservedAt','servedMinutes','status','pauseReason','endedAt','demandIds','funding']) && /^night-retail-[1-9][0-9]*$/.test(job.id) && Number(job.id.slice(13)) <body.nextId && !ids.has(job.id),'唯一夜班编号/字段'); ids.add(job.id);
    const shop = shops.get(job.shopId), site = shop && world.buildings.find(item => item.id ===job.buildingId), p =job.funding;
    need(shop && site && shop.buildingId ===site.id && body.shopIds.includes(job.shopId) && actors.has(job.operatorId),'楼/店/具名居民引用');
    need(finite(job.startedAt) && job.startedAt >=0 && job.startedAt <=at && night(job.startedAt)
      && finite(job.endsAt) && job.endsAt >job.startedAt && job.endsAt -job.startedAt <=MAX_WINDOW +EPS
      && job.endsAt <=(Math.floor(job.startedAt /1440) +1)*1440 +EPS
      && (job.startedAt %1440 >=22*60 || job.endsAt <=Math.floor(job.startedAt /1440)*1440 +6*60 +EPS),'真实有限夜间窗口');
    need(exactFields(p,['kind','day','assignmentKey','ratePerMinute','approvedMinutes','workedMinutesAtStart','attendanceMinutesAtStart','fundsAtStart','protectedFundsAtStart']) && p.kind ==='existing-private-assignment' && p.day ===Math.floor(job.startedAt /1440)
      && typeof p.assignmentKey ==='string' && p.assignmentKey.length >0 && p.assignmentKey.length <=200
      && finite(p.ratePerMinute) && p.ratePerMinute >=0 && finite(p.approvedMinutes) && p.approvedMinutes >=0 && p.approvedMinutes <=480
      && finite(p.workedMinutesAtStart) && p.workedMinutesAtStart >=0 && p.workedMinutesAtStart <=p.approvedMinutes
      && finite(p.attendanceMinutesAtStart) && p.attendanceMinutesAtStart >=0 && p.attendanceMinutesAtStart <=480
      && finite(p.fundsAtStart) && p.fundsAtStart >=0 && p.fundsAtStart <=1e9 && finite(p.protectedFundsAtStart)
      && p.protectedFundsAtStart >=0 && p.protectedFundsAtStart <=p.fundsAtStart +EPS,'原已资助班次声明');
    need(finite(job.servedMinutes) && job.servedMinutes >=0 && job.servedMinutes <=Math.min(p.approvedMinutes-p.workedMinutesAtStart,
      480-p.attendanceMinutesAtStart,job.endsAt-job.startedAt,at-job.startedAt) +EPS,'服务不能超原工时/时间');
    need(['active','paused','completed','cancelled'].includes(job.status) && typeof job.pauseReason ==='string' && job.pauseReason.length <=300,'状态/原因');
    need(Array.isArray(job.demandIds) && job.demandIds.length >0 && job.demandIds.length <=MAX_DEMANDS && new Set(job.demandIds).size ===job.demandIds.length && job.demandIds.every(id => actors.has(id)),'有限原需求身份');
    if (job.servedMinutes ===0) need(job.lastServedAt ===null && job.lastObservedAt ===null && job.lastObservedTick ===null,'零服务不造见证');
    else need(finite(job.lastServedAt) && job.lastServedAt >=job.startedAt && job.lastServedAt <=Math.min(at,job.endsAt)
      && finite(job.lastObservedAt) && job.lastObservedAt >=job.lastServedAt && job.lastObservedAt <=at
      && Number.isSafeInteger(job.lastObservedTick) && job.lastObservedTick! >=0 && job.lastObservedTick! <=state.tick,'历史服务时刻');
    if (job.status ==='active' || job.status ==='paused') {need(job.endedAt ===null && job.endsAt >at -EPS && !liveShops.has(job.shopId) && !liveActors.has(job.operatorId),'唯一未结经营承诺');liveShops.add(job.shopId);liveActors.add(job.operatorId);}
    else need(finite(job.endedAt) && job.endedAt >=job.startedAt && job.endedAt <=at,'真实终态时间');
  }
}
export interface NightRetailParsedPrivateLabor {
  shifts: Record<string,{day:number;assignments:{citizenId:string;ratePerMinute:number;minutesCap:number;workedMinutes:number}[]}>;
}
/** Core calls with the parsed runtime before committing an imported state. */
export function validateNightRetailMarker(state: SimState, runtimeVersion: unknown): void {
  const body =(state as NightState).nightRetail;
  if (body ===undefined ? runtimeVersion !==undefined : runtimeVersion !==1)
    throw new Error('无效夜间经营存档：惰性运行标记与模块必须双向对应');
}
export function validateNightRetailFunding(state: SimState, labor: NightRetailParsedPrivateLabor | undefined,
  attendance: Readonly<Record<string,number>>): void {
  const body =(state as NightState).nightRetail; if (!body) return;
  for (const job of body.jobs) {
    if (!['active','paused'].includes(job.status)) continue;
    const plan =labor?.shifts[job.shopId], item =plan?.assignments.find(row => row.citizenId ===job.operatorId), p =job.funding;
    if (!plan || plan.day !==p.day || !item || item.ratePerMinute !==p.ratePerMinute || item.minutesCap <p.approvedMinutes
      || item.workedMinutes +EPS <p.workedMinutesAtStart +job.servedMinutes
      || (attendance[job.operatorId] ??0) +EPS <p.attendanceMinutesAtStart +job.servedMinutes)
      throw new Error('无效夜间经营存档：原私人资助/出勤来源不一致');
  }
}

export function installNightRetail(simulation: Simulation, accounts: NightRetailAccounts): void {
  if (installations.has(simulation)) throw new Error('夜间经营模块不得重复安装。');
  installations.set(simulation,accounts);
  let phaseMinutes =0, phaseTick =-1, phaseClock =-1;
  simulation.onPhase('time',(state,minutes) => {phaseMinutes =minutes;phaseTick =state.tick;phaseClock =clock(state);serviceWitnesses.delete(state);});
  simulation.onEvent('wage-earned',event => {
    if (phaseTick ===simulation.state.tick && phaseClock ===clock(simulation.state)) observeWage(simulation,event,phaseMinutes);
  });
  simulation.onPhase('feedback',state => {
    const body =(state as NightState).nightRetail; if (!body) return;const at =clock(state);
    for (const job of body.jobs) {
      if (!['active','paused'].includes(job.status)) continue;
      const shop =state.shops.find(item => item.id ===job.shopId), citizen =state.citizens.find(item => item.id ===job.operatorId);
      if (!shop || !citizen || state.extension?.actorProfiles[citizen.id]?.alive !==true || operatorId(state,shop) !==job.operatorId || citizen.workId !==job.buildingId) {
        job.status ='cancelled';job.endedAt =at;job.pauseReason ='原经营者死亡、经营权或岗位变化；历史服务与工资债保留。';serviceWitnesses.get(state)?.delete(job.shopId);continue;
      }
      if (at >=job.endsAt -EPS) {job.status ='completed';job.endedAt =at;job.pauseReason ='原有限夜班到期，未修改日班额度或旧工资债。';serviceWitnesses.get(state)?.delete(job.shopId);continue;}
      if (!nightRetailServedNow(state,job.shopId)) {job.status ='paused';job.pauseReason ='没有当前真实到场资助工资，柜台暂停。';}
    }
  });
  simulation.registerSaveValidator(candidate => validateNightRetailState(candidate,simulation.worldDefinition));
  simulation.onLoad(() => {phaseMinutes =0;phaseTick =-1;phaseClock =-1;serviceWitnesses.delete(simulation.state);});
}
