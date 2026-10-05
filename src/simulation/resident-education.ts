import type { Simulation } from '../simulation';
import type { Building, Citizen, SimState, Vec3, WorldDefinition } from '../types';
import { getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { actorActivityAvailable, claimActorActivityMinutes } from './activity-minutes';
import { validateJointActorActivityCapacity } from './activity-capacity';
import { educationAtPosition, educationPairAtStation, educationServiceStationsAtPosition, educationSlotAvailable, educationStaffMinutes, takeEducationSlot, type EducationReceipt } from './education';
import { FAMILY_RESERVE, GAME_YEAR } from './family';

export const RESIDENT_TUITION_POLICY = 'resident-formal-tuition-v1' as const;
export type ResidentTuitionPolicy = typeof RESIDENT_TUITION_POLICY;
const EPS = 1e-7, LIMIT = 1e9, MAX_ACTIVE = 16, MAX_PAGES = 128, PAGE_SIZE = 8, MAX_LESSONS = 512;
export interface ResidentEducationSigning {
  role: '学生'; age: number; education: number; workId: string; moneyBefore: number; moneyAfter: number;
  mood: number; stress: number; hunger: number; fatigue: number; health: number;
}
/** Current native paid and arrival intervals are retained together. Aggregated
 * envelopes alone cannot certify a learner tail against a teacher front. */
export interface ResidentEducationLesson {
  teacherId: string; teacherRole: '老师' | 'teacher'; teacherWorkId: string;
  startAt: number; endAt: number; paidStartAt: number; paidEndAt: number;
  arrivalStartAt: number; arrivalEndAt: number; observedTick: number;
}
export interface ResidentEducationCourse {
  id: string; actorId: string; payerId: string; signing: ResidentEducationSigning;
  siteId: string; pointId: string; point: Vec3; floor: number;
  startedAt: number; lastObservedAt: number; requiredMinutes: 60; workedMinutes: number; staffMinutes: Record<string, number>; lessons: ResidentEducationLesson[];
  status: 'awaitingSupply' | 'waiting' | 'studying' | 'paused' | 'refundPending' | 'completed' | 'cancelled'; reason: string; resumeRequired: boolean;
  funded: 40; escrow: number; purchasePaid: number; serviceFees: number; refunded: number;
  receivedUnits: number; reusedUnits: number; reservedUnits: number; consumedUnits: number; receipt: EducationReceipt | null;
  retryAt: number; completedAt: number | null; cancelledAt: number | null;
}
interface Stock { receivedUnits: number; consumedUnits: number; availableUnits: number }
interface Totals { funded: number; purchasePaid: number; serviceFees: number; refunded: number; workedMinutes: number; completed: number; cancelled: number }
export interface ResidentEducationAgeClock { baselineAt: number; baselineAge: number; observedAt: number; observedAge: number; ageClockAt: number; deathObservedAt: number | null; deathPhaseMinutes: number | null; deathAgeIncrement: boolean | null }
export interface ResidentEducationState { version: 1; nextId: number; lastObservedAt: number; active: ResidentEducationCourse[]; pages: ResidentEducationCourse[][]; stock: Record<string, Stock>; totals: Totals; ageClocks: Record<string, ResidentEducationAgeClock> }
const zero = (): Totals => ({ funded: 0, purchasePaid: 0, serviceFees: 0, refunded: 0, workedMinutes: 0, completed: 0, cancelled: 0 });
const clock = (s: SimState) => s.extension!.lastUpdate;
const identity = { role: 'traveler' as const, identities: ['traveler' as const] };
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const floorOf = (b: Building, p: Vec3) => Math.floor((p.y-b.position.y+.01)/(b.height/Math.max(1,b.floors)));
export function residentEducationCourses(s: SimState): ResidentEducationCourse[] { return [...(s.residentEducation?.pages.flat() ?? []), ...(s.residentEducation?.active ?? [])]; }
export function residentEducationHeldCash(s: SimState): number { return s.residentEducation?.active.reduce((sum,c)=>sum+c.escrow,0) ?? 0; }
export function residentEducationTaskActorIds(s: SimState): Set<string> { return new Set((s.residentEducation?.active ?? []).filter(c=>c.cancelledAt===null).map(c=>c.actorId)); }
export function residentEducationNeedsContinuousPeople(s: SimState, person: Citizen): boolean {
  return !!s.residentEducation?.active.some(c=>c.cancelledAt===null && (c.actorId===person.id || c.siteId===person.workId && ['老师','teacher'].includes(person.role)));
}
export function validateResidentTuitionPolicy(data: Record<string, any>): void {
  const own=(v:any,k:string)=>v && Object.hasOwn(v,k), top=own(data,'residentTuitionPolicyId'), runtime=own(data.runtime,'residentTuitionPolicyId');
  const formal= data.state?.family?.formalLearningVersion===3 || Object.values(data.state?.family?.formalLearning ?? {}).some((r:any)=>own(r,'residentTuitionPages'));
  const body=own(data.state,'residentEducation'), marker=own(data.runtime,'residentEducationVersion'), listed=Array.isArray(data.runtime?.persistedModules) && data.runtime.persistedModules.includes('residentEducation');
  const need=(v:unknown,m:string)=>{if(!v)throw new Error(`无效成年自费课程政策：${m}。`);};
  if(!top && !runtime){need(!body && !marker && !listed && !formal,'旧政策不能携带新课程');return;}
  need(top && runtime && data.residentTuitionPolicyId===RESIDENT_TUITION_POLICY && data.runtime.residentTuitionPolicyId===RESIDENT_TUITION_POLICY,'顶层与运行双声明');
  need(data.version===4 && data.motionVersion===2 && data.historyPolicyId==='civic-history-pages-v1','完整当前城市');
  need(body===marker && body===listed && (!body || data.state.residentEducation?.version===1 && data.runtime.residentEducationVersion===1 && data.runtime.persistedModules.filter((n:unknown)=>n==='residentEducation').length===1),'正文、版本和清单成对');
  need(!formal || body,'正式本人来源不能离开原课程正文');
}
interface NativeObservation { state: SimState; tick: number; arrivals: Map<string,{siteId:string;start:number;end:number}>; wages: Map<string,{siteId:string;start:number;end:number}[]> }
interface NativeSources { enabled(): boolean; isCanonicalPresence(event: object): boolean; isCanonicalWage(event: object): boolean; activate(): void }
function transported(sim: Simulation,id:string):boolean { const r=Reflect.get(sim,'runtime');return !!r.riders[id] || !!r.dispatches[id]; }
function lawful(s:SimState,c:ResidentEducationCourse):boolean { const p=s.citizens.find(p=>p.id===c.actorId),life=s.extension?.actorProfiles[c.actorId];return c.actorId===c.payerId && !!p && !!life?.alive && life.age>=18 && !s.family?.children[c.actorId] && p.role==='学生' && (p.education ?? 0)<3 && p.workId===c.siteId; }
function atCourse(sim:Simulation,c:ResidentEducationCourse):boolean {
  const p=sim.state.citizens.find(p=>p.id===c.actorId),site=sim.worldDefinition.buildings.find(b=>b.id===c.siteId);
  if(!p || !site || transported(sim,p.id) || p.state!=='studying' || !educationAtPosition(site,p.position,identity,sim.state.voxels))return false;
  return getBuildingBody(site)?educationServiceStationsAtPosition(site,p.position,identity,sim.state.voxels).some(p=>p.id===c.pointId && p.floor===c.floor && distance(p.position,c.point)<EPS):floorOf(site,p.position)===c.floor;
}
function stock(s:SimState,id:string):Stock{return s.residentEducation!.stock[id] ??= {receivedUnits:0,consumedUnits:0,availableUnits:0};}
function ledger(sim:Simulation,c:ResidentEducationCourse,amount:number,purpose:string,account:'public'|'household'):void{const rows=sim.state.extension!.publicLedger;rows.push({tick:sim.state.tick,actorId:c.payerId,amount,purpose,account,districtId:sim.worldDefinition.buildings.find(b=>b.id===c.siteId)!.districtId});if(rows.length>512)rows.splice(0,rows.length-512);}
function archive(s:SimState,c:ResidentEducationCourse):void{const e=s.residentEducation!;e.active.splice(e.active.indexOf(c),1);if(!e.pages.length || e.pages.at(-1)!.length===PAGE_SIZE)e.pages.push([]);e.pages.at(-1)!.push(c);}
function stop(sim:Simulation,c:ResidentEducationCourse):void {
  const s=sim.state,e=s.residentEducation!,payer=s.citizens.find(p=>p.id===c.payerId)!;
  if(c.cancelledAt===null){c.cancelledAt=clock(s);e.totals.cancelled++;stock(s,c.siteId).availableUnits+=c.reservedUnits;c.reservedUnits=0;}
  const refund=Math.min(c.escrow,Math.max(0,LIMIT-payer.money));
  if(refund>0){payer.money+=refund;c.escrow-=refund;c.refunded+=refund;e.totals.refunded+=refund;ledger(sim,c,refund,'成年本人课程未赚托管款退回原钱包','household');}
  c.resumeRequired=false;c.status=c.escrow>EPS?'refundPending':'cancelled';c.reason='原本人课程停止；未赚款退原钱包，未耗教材保留原学堂。';
  if(c.status==='cancelled'){c.escrow=0;archive(s,c);}
}
/** Pure interval intersection used by runtime and explicit controlled tests. */
export function residentEducationPaidInterval(start:number,end:number,paidStart:number,paidEnd:number,arrivalStart:number,arrivalEnd:number,maxMinutes=Infinity):{start:number;end:number}|null{
  if(![start,end,paidStart,paidEnd,arrivalStart,arrivalEnd].every(Number.isFinite))return null;
  const a=Math.max(start,paidStart,arrivalStart),b=Math.min(end,paidEnd,arrivalEnd,a+Math.max(0,maxMinutes));return b>a+EPS?{start:a,end:b}:null;
}
function award(sim:Simulation,c:ResidentEducationCourse,teacher:Citizen):void {
  const s=sim.state,f=s.family!,person=s.citizens.find(p=>p.id===c.actorId)!,existing=f.formalLearning?.[c.actorId];
  if(!lawful(s,c) || !atCourse(sim,c) || c.status!=='completed' || c.workedMinutes!==60 || c.consumedUnits!==1 || c.receivedUnits+c.reusedUnits!==1 || c.lessons.at(-1)?.teacherId!==teacher.id)throw new Error('成年正式课程完成来源失配。');
  const record=existing ?? {baselineEducation:person.education ?? 0,baselineAttendanceMinutes:0,earnedMinutes:0,receipts:[]};
  if(record.residentTuitionPages?.flat().some(r=>r.residentCourseId===c.id))throw new Error('成年正式课程重复来源。');
  if(!record.tuitionPages && !record.residentTuitionPages){const carry=(person.education ?? 0)-record.baselineEducation-record.receipts.reduce((n,r)=>n+r.educationGain,0);if(carry>EPS)record.legacyEducationCarry=carry;}
  const gain=Math.min(1,Math.max(0,20-(person.education ?? 0)));
  f.formalLearningVersion=3;f.formalLearning ??= {};f.formalLearning[c.actorId]=record;record.residentTuitionPages ??= [];
  if(!record.residentTuitionPages.length || record.residentTuitionPages.at(-1)!.length===8)record.residentTuitionPages.push([]);
  record.residentTuitionPages.at(-1)!.push({residentCourseId:c.id,siteId:c.siteId,teacherId:teacher.id,completedAt:c.completedAt!,minutes:60,minutesPerLevel:60,educationGain:gain});
  record.earnedMinutes+=60;person.education=(person.education ?? 0)+gain;
}
export function installResidentEducation(sim:Simulation,sources:NativeSources):void {
  let observed:NativeObservation|undefined;
  const phase=()=>{if(!observed || observed.state!==sim.state || observed.tick!==sim.state.tick)observed={state:sim.state,tick:sim.state.tick,arrivals:new Map(),wages:new Map()};return observed;};
  // No public arrival/award command exists. Generic emitted events lack core's
  // immutable city/frame witness and cannot admit, resume or earn a course.
  sim.onEvent('resident-education-presence',event=>{
    if(!sources.enabled() || !sources.isCanonicalPresence(event))return;
    const s=sim.state,p=s.citizens.find(p=>p.id===event.citizenId),site=sim.worldDefinition.buildings.find(b=>b.id===event.siteId);
    const start=event.activityWindowStartAt,end=event.activityWindowEndAt;
    if(!p || !site || site.kind!=='school' || p.state!=='studying' || transported(sim,p.id) || typeof start!=='number' || typeof end!=='number' || end!==clock(s) || start<end-.25*s.speed-EPS || start>=end || !educationAtPosition(site,p.position,identity,s.voxels))return;
    phase().arrivals.set(p.id,{siteId:site.id,start,end});
  });
  sim.onEvent('wage-earned',event=>{
    if(!sources.enabled() || !sources.isCanonicalWage(event) || !event.citizenId || !event.siteId || typeof event.creditedWorkStartAt!=='number' || typeof event.creditedWorkEndAt!=='number' || !event.minutes || !(event.amount!>0))return;
    const start=event.creditedWorkStartAt,end=event.creditedWorkEndAt,s=sim.state;
    if(start>=end || end>clock(s)+EPS || end<=clock(s)-.25*s.speed+EPS || Math.abs(end-start-event.minutes)>EPS)return;
    const ranges=phase().wages.get(event.citizenId) ?? [];ranges.push({siteId:event.siteId,start:Math.max(start,clock(s)-.25*s.speed),end});phase().wages.set(event.citizenId,ranges);
  });
  sim.onPhase('people',(s,minutes)=>{
    if(!sources.enabled())return;
    const current=phase();
    // Extension life age advances before this listener. A pre-increment death
    // freezes the previous life clock; estate settlement is a separate clock.
    for(const [id,source] of Object.entries(s.residentEducation?.ageClocks ?? {})){
      const life=s.extension!.actorProfiles[id];
      if(life.alive)source.ageClockAt=clock(s);
      else if(source.deathObservedAt===null){source.deathObservedAt=clock(s);source.deathPhaseMinutes=minutes;source.deathAgeIncrement=Math.abs(life.age-source.observedAge)>1e-12;source.ageClockAt=source.deathAgeIncrement?clock(s):source.observedAt;}
      source.observedAt=clock(s);source.observedAge=life.age;
    }
    for(const [id,window] of current.arrivals){
      const p=s.citizens.find(p=>p.id===id)!,life=s.extension!.actorProfiles[id],site=sim.worldDefinition.buildings.find(b=>b.id===window.siteId)!;
      const old=s.residentEducation?.active.find(c=>c.actorId===id);
      if(old){if(old.resumeRequired && old.cancelledAt===null && lawful(s,old) && atCourse(sim,old) && s.hour>=8 && s.hour<17){old.resumeRequired=false;old.lastObservedAt=clock(s);old.status=old.reservedUnits?'waiting':'awaitingSupply';old.reason='本人返回原课堂恢复；不重复收费，不追补离场学时。';}continue;}
      if(!life?.alive || life.age<18 || s.family!.children[id] || p.role!=='学生' || (p.education ?? 0)>=3 || p.workId!==site.id || p.money<FAMILY_RESERVE+40 || life.health<45 || life.mood<55 || life.stress>60 || p.needs.hunger<40 || p.needs.fatigue<40 || s.hour<8 || s.hour>=17 || (s.residentEducation?.active.length ?? 0)>=MAX_ACTIVE || (s.residentEducation?.nextId ?? 1)>MAX_PAGES*8 || (s.family!.formalLearning?.[id]?.residentTuitionPages?.flat().length ?? 0)>=3 || !s.citizens.some(t=>t.workId===site.id && ['老师','teacher'].includes(t.role) && s.extension!.actorProfiles[t.id]?.alive && s.extension!.actorProfiles[t.id].age>=18))continue;
      const e=s.residentEducation ??= {version:1,nextId:1,lastObservedAt:clock(s),active:[],pages:[],stock:{},totals:zero(),ageClocks:{}};sources.activate();
      const point=educationServiceStationsAtPosition(site,p.position,identity,s.voxels)[0],floor=floorOf(site,p.position),material=stock(s,site.id),reuse=Math.min(1,material.availableUnits),moneyBefore=p.money;
      const c:ResidentEducationCourse={id:`resident-course-${e.nextId++}`,actorId:id,payerId:id,signing:{role:'学生',age:life.age,education:p.education ?? 0,workId:p.workId,moneyBefore,moneyAfter:moneyBefore-40,mood:life.mood,stress:life.stress,hunger:p.needs.hunger,fatigue:p.needs.fatigue,health:life.health},siteId:site.id,pointId:point?.id ?? `legacy:${floor}`,point:{...(point?.position ?? p.position)},floor,startedAt:clock(s),lastObservedAt:clock(s),requiredMinutes:60,workedMinutes:0,staffMinutes:{},lessons:[],status:reuse?'waiting':'awaitingSupply',reason:'成年本人自愿实付40文；一份真实教材与六十分钟共同授课才获正式资格。',resumeRequired:false,funded:40,escrow:40,purchasePaid:0,serviceFees:0,refunded:0,receivedUnits:0,reusedUnits:reuse,reservedUnits:reuse,consumedUnits:0,receipt:null,retryAt:clock(s),completedAt:null,cancelledAt:null};
      e.ageClocks[id] ??= {baselineAt:clock(s),baselineAge:life.age,observedAt:clock(s),observedAge:life.age,ageClockAt:clock(s),deathObservedAt:null,deathPhaseMinutes:null,deathAgeIncrement:null};
      p.money-=40;material.availableUnits-=reuse;e.active.push(c);e.totals.funded+=40;ledger(sim,c,-40,'成年本人实付正式课程托管款','household');
    }
    const e=s.residentEducation;if(!e)return;e.lastObservedAt=clock(s);
    for(const c of [...e.active]){
      const prior=c.lastObservedAt,elapsed=Math.min(minutes,Math.max(0,clock(s)-prior));c.lastObservedAt=clock(s);
      if(c.cancelledAt!==null || !lawful(s,c)){stop(sim,c);continue;}
      if(!atCourse(sim,c)){c.status='paused';c.resumeRequired=true;c.reason='本人离开原课堂暂停，现场返回后只计未来窗口。';continue;}
      if(c.resumeRequired)continue;
      const p=s.citizens.find(p=>p.id===c.actorId)!,life=s.extension!.actorProfiles[p.id],arrival=current.arrivals.get(p.id),site=sim.worldDefinition.buildings.find(b=>b.id===c.siteId)!;
      const earliest=Math.max(prior,c.startedAt,c.receipt?.purchasedAt ?? c.startedAt),dayStart=clock(s)-s.hour*60;
      const available=life.health>=45 && p.needs.hunger>=40 && p.needs.fatigue>=35 && c.reservedUnits===1 && arrival?.siteId===site.id?Math.min(elapsed,60-c.workedMinutes,actorActivityAvailable(sim,p.id,minutes)):0;
      const options=s.citizens.filter(t=>educationPairAtStation(sim,site,t,p.id) && (!getBuildingBody(site) || educationServiceStationsAtPosition(site,t.position,{role:'teacher',identities:['teacher']},s.voxels).some(point=>point.id===c.pointId)) && educationSlotAvailable(sim,t.id,p.id)).flatMap(teacher=>(current.wages.get(teacher.id) ?? []).filter(w=>w.siteId===site.id).map(w=>({teacher,w,range:residentEducationPaidInterval(Math.max(earliest,clock(s)-elapsed,dayStart+480),Math.min(clock(s),dayStart+1020),w.start,w.end,arrival?.start ?? clock(s),arrival?.end ?? clock(s),available)}))).filter(o=>o.range && educationStaffMinutes(sim,o.teacher,site.id,minutes,true,o.range.start)>EPS).sort((a,b)=>(b.range!.end-b.range!.start)-(a.range!.end-a.range!.start) || a.teacher.id.localeCompare(b.teacher.id));
      const chosen=options[0],range=chosen?.range;
      if(!range){c.status=c.reservedUnits?'waiting':'awaitingSupply';c.reason='等待真实教材、本人当前抵达与同教室当前已付薪教师；无追赶学时。';continue;}
      const last=c.lessons.at(-1),merge=last?.teacherId===chosen.teacher.id && Math.abs(last.endAt-range.start)<EPS;
      if(!merge && c.lessons.length>=MAX_LESSONS){c.status='waiting';c.reason='真实教学区间档案已满，保留原学费与全部来源，不另收费。';continue;}
      const taught=range.end-range.start,worked=Math.min(60,c.workedMinutes+taught),earned=(40-c.purchasePaid)*worked/60,payment=earned-c.serviceFees;
      if(s.treasury+payment>LIMIT || payment>c.escrow+EPS)continue;
      const credited=claimActorActivityMinutes(sim,p.id,c.id,taught,minutes);if(Math.abs(credited-taught)>EPS || !takeEducationSlot(sim,chosen.teacher.id,p.id))continue;
      const lesson:ResidentEducationLesson={teacherId:chosen.teacher.id,teacherRole:chosen.teacher.role as '老师'|'teacher',teacherWorkId:site.id,startAt:range.start,endAt:range.end,paidStartAt:chosen.w.start,paidEndAt:chosen.w.end,arrivalStartAt:arrival!.start,arrivalEndAt:arrival!.end,observedTick:s.tick};
      if(merge){last!.endAt=lesson.endAt;last!.paidEndAt=lesson.paidEndAt;last!.arrivalEndAt=lesson.arrivalEndAt;last!.observedTick=s.tick;}else c.lessons.push(lesson);
      c.workedMinutes=worked;c.staffMinutes[chosen.teacher.id]=(c.staffMinutes[chosen.teacher.id] ?? 0)+credited;c.serviceFees=earned;c.escrow-=payment;s.treasury+=payment;Reflect.get(s.extension!,'runtime').lastTreasury+=payment;e.totals.serviceFees+=payment;e.totals.workedMinutes+=credited;ledger(sim,c,payment,'成年本人现场真实已赚课程服务费','public');c.status='studying';c.reason=`本人自费与已付薪教师共同授课${worked.toFixed(1)}/60分钟。`;
      if(worked<60-EPS)continue;c.workedMinutes=60;c.escrow=0;c.reservedUnits--;c.consumedUnits++;stock(s,c.siteId).consumedUnits++;c.status='completed';c.completedAt=clock(s);e.totals.completed++;award(sim,c,chosen.teacher);sim.appendNotice('resident-education','成年学生完成本人实付正式课：真实教材与六十分钟课堂资格。',site.districtId);archive(s,c);
    }
  });
  sim.onPhase('finance',s=>{
    if(!sources.enabled())return;const e=s.residentEducation;if(!e)return;
    for(const c of [...e.active]){
      if(c.cancelledAt!==null || !lawful(s,c)){stop(sim,c);continue;}
      if(c.reservedUnits>=1-EPS || clock(s)<c.retryAt-EPS)continue;c.retryAt=clock(s)+60;const material=stock(s,c.siteId);
      if(material.availableUnits>=1-EPS){material.availableUnits--;c.reusedUnits++;c.reservedUnits++;c.status='waiting';continue;}
      const site=sim.worldDefinition.buildings.find(b=>b.id===c.siteId)!;
      const options=s.shops.filter(shop=>sim.shopCommodity(shop)==='materials' && shop.inventory>=1).map(shop=>({shop,quote:sim.quoteSupply(shop.id,1)})).sort((a,b)=>Number(b.shop.districtId===site.districtId)-Number(a.shop.districtId===site.districtId) || a.quote.unitPrice-b.quote.unitPrice || a.shop.id.localeCompare(b.shop.id));
      const source=options.find(({shop,quote})=>quote.quantity>=1 && quote.unitPrice>0 && quote.unitPrice<=c.escrow && sim.shopFunds(shop)+quote.unitPrice*(1-s.taxRate)<=LIMIT && s.treasury+quote.unitPrice*s.taxRate<=LIMIT);
      if(!source){c.reason='原工坊教材库存、实价或收款容量不足；课程钱仍托管，不生成教材。';continue;}
      const gross=source.quote.unitPrice,net=gross*(1-s.taxRate),tax=gross-net;source.shop.inventory--;sim.transferShopFunds(source.shop,net);source.shop.revenue+=gross;source.shop.profit+=net;c.escrow-=gross;c.purchasePaid+=gross;e.totals.purchasePaid+=gross;c.receivedUnits++;c.reservedUnits++;material.receivedUnits++;c.receipt={purchasedAt:clock(s),shopId:source.shop.id,quantity:1,unitPrice:gross,gross,net,tax};c.status='waiting';
      sim.emitEvent({type:'wholesale',shopId:source.shop.id,districtId:source.shop.districtId,amount:gross,quantity:1,unitPrice:gross,siteId:site.id,procurementId:`${c.id}:textbook`,purpose:'education-material'});
    }
  });
  sim.registerSaveValidator(s=>validateResidentEducationState(s,sim.worldDefinition));
}
export function validateResidentEducationState(s:SimState,world:WorldDefinition):void {
  const e=s.residentEducation;if(e===undefined)return;
  const ensure=(x:unknown,label:string)=>{if(!x)throw new Error(`成年本人学费课程存档无效：${label}`);};
  const object=(x:unknown):x is Record<string,any>=>!!x && typeof x==='object' && !Array.isArray(x);
  const num=(x:unknown,min:number,max:number,label:string,integer=false)=>ensure(typeof x==='number' && Number.isFinite(x) && x>=min && x<=max && (!integer || Number.isInteger(x)),label);
  const close=(a:number,b:number,label:string)=>ensure(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=Math.max(EPS,Math.max(a,b)*1e-10),label);
  ensure(object(e) && e.version===1 && s.family && s.extension,'版本及原家庭');num(e.nextId,2,MAX_PAGES*8+1,'课程序号',true);num(e.lastObservedAt,0,clock(s),'观察');
  ensure(Array.isArray(e.active) && e.active.length<=MAX_ACTIVE && Array.isArray(e.pages) && e.pages.length<=MAX_PAGES,'有限当前与分页档案');e.pages.forEach((p,i)=>ensure(Array.isArray(p) && p.length>0 && p.length<=8 && (i===e.pages.length-1 || p.length===8),'逐笔学期归档不删源'));
  ensure(object(e.stock) && Object.keys(e.stock).length<=world.buildings.length && object(e.totals),'库存总账');
  const all=residentEducationCourses(s),ids=new Set<string>(),activeLearners=new Set<string>(),ordered=[...all].sort((a,b)=>Number(a.id.slice(16))-Number(b.id.slice(16))),totals=zero(),materials=new Map<string,{received:number;consumed:number;reserved:number}>(),learners=new Map<string,ResidentEducationCourse[]>();
  ensure(all.length===e.nextId-1,'每笔真实签约都保留全部来源');
  for(const [index,c] of ordered.entries()) {
    const site=world.buildings.find(b=>b.id===c.siteId),p=s.extension!.actorProfiles[c.payerId],child=s.extension!.actorProfiles[c.actorId],lifeClock=s.residentEducation!.ageClocks[c.actorId]?.ageClockAt;
    ensure(object(c) && c.id===`resident-course-${index+1}` && !ids.has(c.id) && site?.kind==='school' && c.actorId!=='player' && s.citizens.some(p=>p.id===c.actorId) && c.actorId===c.payerId,'原学校真实签約主体与连续编号');ids.add(c.id);
    num(c.startedAt,0,e.lastObservedAt,'签约');num(c.lastObservedAt,c.startedAt,e.lastObservedAt,'课程观察');
    // The module retains the original life clock, independently of later
    // estate accounting and both pre/post-increment death branches.
    ensure(!s.family!.children[c.actorId] && !!child,'首期仅原成年学生；出生学校480规则不变');
    const ageAt=child.age-(lifeClock-c.startedAt)/GAME_YEAR;
    ensure(ageAt>=18-EPS && object(c.signing) && c.signing.role==='学生' && c.signing.workId===c.siteId,'本人原成年学生签约');
    close(c.signing.age,ageAt,'真实历史年龄');num(c.signing.education,0,3-EPS,'原未达三级学历');
    num(c.signing.moneyBefore,FAMILY_RESERVE+40,LIMIT,'本人原有现金');num(c.signing.moneyAfter,FAMILY_RESERVE,LIMIT,'本人保留现金');close(c.signing.moneyBefore-c.signing.moneyAfter,40,'本人实付托管');
    num(c.signing.mood,55,100,'本人意愿');num(c.signing.stress,0,60,'压力');num(c.signing.health,45,100,'健康');num(c.signing.hunger,40,100,'饥饿');num(c.signing.fatigue,40,100,'体力');
    ensure(c.startedAt%1440>=480-EPS && c.startedAt%1440<1020,'本人开放时段自签');
    if(e.active.includes(c) && c.cancelledAt===null){ensure(lawful(s,c),'仍有效在世本人契约');ensure(!activeLearners.has(c.actorId),'本人唯一在办课程');activeLearners.add(c.actorId);}
    num(c.floor,0,site!.floors-1,'楼层',true);ensure(object(c.point) && [c.point.x,c.point.y,c.point.z].every(Number.isFinite),'真实课堂点');
    if(getBuildingBody(site!))ensure((site!.functionPoints ?? getBuildingUsePoints(site!,c.floor)).some(p=>p.id===c.pointId && p.purpose==='service' && p.floor===c.floor && distance(p.position,c.point)<EPS),'原公共课堂');else ensure(c.pointId===`legacy:${c.floor}`,'旧课堂');ensure(educationAtPosition(site!,c.point,identity,[]),'原公共、可达且受支持课堂');
    ensure(c.requiredMinutes===60 && c.funded===40 && ['awaitingSupply','waiting','studying','paused','refundPending','completed','cancelled'].includes(c.status) && typeof c.reason==='string' && c.reason.length<=1000 && typeof c.resumeRequired==='boolean','原配方及状态');num(c.workedMinutes,0,60,'实际学时');ensure(c.workedMinutes<=c.lastObservedAt-c.startedAt+EPS,'不追赶未观察时窗');num(c.retryAt,c.startedAt,1e12,'采购重试');
    for(const key of ['escrow','purchasePaid','serviceFees','refunded'] as const)num(c[key],0,40,'款项');close(40,c.escrow+c.purchasePaid+c.serviceFees+c.refunded,'学费资金守恒');close(c.serviceFees,(40-c.purchasePaid)*c.workedMinutes/60,'真实教师服务已赚款');
    ensure(object(c.staffMinutes) && Object.keys(c.staffMinutes).length<=s.citizens.length,'原教师分钟');let staff=0;for(const [id,m] of Object.entries(c.staffMinutes)){ensure(s.citizens.some(p=>p.id===id) && id!==c.actorId,'具名教师');num(m,EPS,60,'实教分钟');staff+=m;}close(staff,c.workedMinutes,'共同实际教学分钟');
    ensure(Array.isArray(c.lessons) && c.lessons.length<=MAX_LESSONS,'有限真实付薪到场区间');let taught=0,previousEnd=c.startedAt,previousTick=0;const staffProof:Record<string,number>={};
    for(const l of c.lessons){
      ensure(object(l) && ['老师','teacher'].includes(l.teacherRole) && l.teacherWorkId===c.siteId && s.citizens.some(p=>p.id===l.teacherId) && l.teacherId!==c.actorId,'具名原在册教师来源');
      num(l.startAt,Math.max(previousEnd,c.receipt?.purchasedAt ?? c.startedAt),c.lastObservedAt,'课时起点');num(l.endAt,l.startAt+EPS,c.lastObservedAt,'课时终点');
      num(l.paidStartAt,c.startedAt,c.lastObservedAt,'真实付薪起点');num(l.paidEndAt,l.paidStartAt,c.lastObservedAt,'真实付薪终点');num(l.arrivalStartAt,c.startedAt,c.lastObservedAt,'实际抵达起点');num(l.arrivalEndAt,l.arrivalStartAt,c.lastObservedAt,'实际抵达终点');
      ensure(l.startAt>=Math.max(l.paidStartAt,l.arrivalStartAt)-EPS && l.endAt<=Math.min(l.paidEndAt,l.arrivalEndAt)+EPS && Math.floor(l.startAt/1440)===Math.floor((l.endAt-EPS)/1440) && l.startAt%1440>=480-EPS && (l.endAt-EPS)%1440<1020,'只计同日开放时段双方真实交集');
      num(l.observedTick,previousTick,s.tick,'实际观察帧',true);previousTick=l.observedTick;previousEnd=l.endAt;taught+=l.endAt-l.startAt;staffProof[l.teacherId]=(staffProof[l.teacherId] ?? 0)+l.endAt-l.startAt;
    }
    close(taught,c.workedMinutes,'每分钟保留双方真实区间来源');ensure(Object.keys(staffProof).length===Object.keys(c.staffMinutes).length,'区间与教师同源');for(const [id,m] of Object.entries(staffProof))close(m,c.staffMinutes[id],'教师每分钟区间来源');

    for(const key of ['receivedUnits','reusedUnits','reservedUnits','consumedUnits'] as const)num(c[key],0,1,'教材',true);ensure(c.receivedUnits+c.reusedUnits<=1 && c.reservedUnits+c.consumedUnits<=c.receivedUnits+c.reusedUnits,'课程一份有限教材');
    if(c.receipt===null)ensure(c.receivedUnits===0 && c.purchasePaid===0,'无回执无采购');else {const r=c.receipt,shop=s.shops.find(shop=>shop.id===r.shopId);ensure(object(r) && world.buildings.find(b=>b.id===shop?.buildingId)?.kind==='workshop' && r.quantity===1 && c.receivedUnits===1,'原工坊真实教材回执');num(r.purchasedAt,c.startedAt,c.lastObservedAt,'采购时点');num(r.unitPrice,EPS,40,'实价');close(r.unitPrice,r.gross,'单份实价');close(r.gross,c.purchasePaid,'采购实付');num(r.net,0,r.gross,'实收');num(r.tax,0,r.gross,'税');close(r.gross,r.net+r.tax,'供应商和税款');}
    ensure(!c.workedMinutes || c.receivedUnits+c.reusedUnits===1,'真实教材后才能授课');
    if(c.status==='completed'){num(c.completedAt,c.startedAt+60-EPS,c.lastObservedAt,'真实完成');ensure(c.cancelledAt===null && c.workedMinutes===60 && c.consumedUnits===1 && c.reservedUnits===0 && c.refunded===0 && c.escrow===0 && !c.resumeRequired && !e.active.includes(c),'课程完成清结');ensure(s.family!.formalLearningVersion===3,'本人完成来源须正式版本三');const certificates=s.family!.formalLearning?.[c.actorId]?.residentTuitionPages?.flat().filter(r=>r.residentCourseId===c.id) ?? [];ensure(certificates.length===1 && certificates[0].completedAt===c.completedAt,'完整正式资格保留唯一实际课程来源');}
    else if(c.cancelledAt!==null){num(c.cancelledAt,c.startedAt,c.lastObservedAt,'取消');ensure(c.completedAt===null && c.workedMinutes<60 && c.reservedUnits===0 && c.consumedUnits===0 && (c.status==='refundPending'?c.escrow>EPS && e.active.includes(c):c.status==='cancelled' && c.escrow===0 && !e.active.includes(c)),'未赚款真实退款及无学历');}
    else ensure(e.active.includes(c) && c.completedAt===null && c.refunded===0 && c.workedMinutes<60 && c.reservedUnits===c.receivedUnits+c.reusedUnits,'在办原托管');
    const m=materials.get(c.siteId) ?? {received:0,consumed:0,reserved:0};m.received+=c.receivedUnits;m.consumed+=c.consumedUnits;m.reserved+=c.reservedUnits;materials.set(c.siteId,m);
    for(const key of ['funded','purchasePaid','serviceFees','refunded','workedMinutes'] as const)totals[key]+=c[key];totals.completed+=Number(c.status==='completed');totals.cancelled+=Number(c.cancelledAt!==null);const list=learners.get(c.actorId) ?? [];list.push(c);learners.set(c.actorId,list);
  }
  for(const [id,m] of materials){const material=e.stock[id];ensure(!!material,'每份课程实物都有原学校库存');}
  for(const [id,material] of Object.entries(e.stock)){ensure(world.buildings.find(b=>b.id===id)?.kind==='school' && object(material),'原学校库存');for(const key of ['receivedUnits','consumedUnits','availableUnits'] as const)num(material[key],0,MAX_PAGES*8,'全源库存',true);const m=materials.get(id) ?? {received:0,consumed:0,reserved:0};close(material.receivedUnits,m.received,'采购来源');close(material.consumedUnits,m.consumed,'消费来源');close(material.receivedUnits,material.consumedUnits+material.availableUnits+m.reserved,'教材采购减实耗及保管');}
  for(const key of Object.keys(totals) as (keyof Totals)[]){num(e.totals[key],0,1e8,'逐单总账');close(e.totals[key],totals[key],'总账每笔来源');}
  for(const list of learners.values())for(let i=1;i<list.length;i++){const old=list[i-1];ensure(list[i].startedAt+EPS>=Math.max(old.lastObservedAt,old.completedAt ?? 0,old.cancelledAt ?? 0),'原学时及退款清结后才开始下一课');}
  ensure(object(e.ageClocks) && Object.keys(e.ageClocks).length===learners.size,'全部历史本人保留生命年龄来源');
  for(const [id,source] of Object.entries(e.ageClocks)){
    const life=s.extension!.actorProfiles[id],first=ordered.find(c=>c.actorId===id);
    ensure(object(source) && !!life && !!first,'原本人生命来源');num(source.baselineAt,0,e.lastObservedAt,'生命基线钟');num(source.baselineAge,18,140,'原成年生命基线');close(source.baselineAt,first!.startedAt,'首签生命钟');close(source.baselineAge,first!.signing.age,'首签生命年龄');
    num(source.observedAt,source.baselineAt,e.lastObservedAt,'生命观察');close(source.observedAt,e.lastObservedAt,'持续观察已签全部生命');num(source.ageClockAt,source.baselineAt,source.observedAt,'年龄实增终点');close(source.observedAge,life.age,'原生命年龄');close(source.observedAge,source.baselineAge+(source.ageClockAt-source.baselineAt)/GAME_YEAR,'年龄只随实际生长');
    if(life.alive){ensure(source.deathObservedAt===null && source.deathPhaseMinutes===null && source.deathAgeIncrement===null,'在世无死亡来源');close(source.ageClockAt,clock(s),'在世年龄钟');}
    else{num(source.deathObservedAt,source.baselineAt,source.observedAt,'死亡观察');num(source.deathPhaseMinutes,EPS,4,'真实死亡帧');ensure(typeof source.deathAgeIncrement==='boolean','死亡是否实际生长');close(source.ageClockAt,source.deathObservedAt!-(source.deathAgeIncrement?0:source.deathPhaseMinutes!),'死亡保留真正年龄钟');}
  }
  validateResidentTeacherCapacity(all);
  validateJointActorActivityCapacity(s);
}

/** Exact new lesson records share the existing four-seat classroom limit. */
export function validateResidentTeacherCapacity(courses: readonly Pick<ResidentEducationCourse,'siteId'|'pointId'|'lessons'>[]):void {
  // Exact new resident lessons can prove their own historical shared capacity.
  // Older E1/public/minor formats retain aggregate histories; runtime still
  // uses their same allocator, without inventing old exact occupied intervals.
  const teacherWindows=new Map<string,{start:number;end:number;room:string}[]>();
  for(const c of courses)for(const l of c.lessons){const list=teacherWindows.get(l.teacherId) ?? [];list.push({start:l.startAt,end:l.endAt,room:c.siteId+':'+c.pointId});teacherWindows.set(l.teacherId,list);}
  for(const windows of teacherWindows.values()){
    const endpoints=windows.flatMap(w=>[{at:w.start,delta:1,room:w.room},{at:w.end,delta:-1,room:w.room}]).sort((a,b)=>a.at-b.at || a.delta-b.delta),rooms=new Map<string,number>();let seats=0;
    for(const point of endpoints){seats+=point.delta;rooms.set(point.room,(rooms.get(point.room) ?? 0)+point.delta);if(!rooms.get(point.room))rooms.delete(point.room);if(seats>4 || rooms.size>1)throw new Error('同一教师真实课程区间最多四席同室。');}
  }
}
