import type { Simulation } from '../simulation';
import type { Building, Citizen, CommandResult, Player, SimState, Vec3, WorldDefinition } from '../types';
import { getBuildingBody, getBuildingUsePoints } from '../architecture-floor-plan';
import { actorActivityAvailable, claimActorActivityMinutes } from './activity-minutes';
import { validateJointActorActivityCapacity } from './activity-capacity';
import { applyFamilyEducationCredential, educationAtPosition, educationOpenMinutes, educationPairAtStation, educationServiceStationsAtPosition, educationSlotAvailable, educationStaffMinutes, takeEducationSlot, type EducationReceipt } from './education';
import { FAMILY_RESERVE, GAME_YEAR, isFamilyDependent } from './family';

/** Eight real sixty-minute classes form one 480-minute school level. Pages
 * retain every terminal contract; reaching finite storage rejects admission,
 * never evicts tuition, a child's certificate, wages or material origins. */
export const FAMILY_COURSE_FEE = 40, FAMILY_COURSE_MINUTES = 60, FAMILY_COURSE_PAGE_SIZE = 8;
const EPS = 1e-7, LIMIT = 1e9, MAX_PAGES = 128, MAX_ACTIVE = 16;
export interface FamilyEducationCourse {
  id: string; actorId: string; payerId: string; guardianKind: 'parent' | 'care' | 'student'; guardianIds: string[];
  siteId: string; pointId: string; point: Vec3; floor: number;
  startedAt: number; lastObservedAt: number; requiredMinutes: 60; workedMinutes: number; staffMinutes: Record<string, number>;
  status: 'awaitingSupply' | 'waiting' | 'studying' | 'paused' | 'refundPending' | 'completed' | 'cancelled'; reason: string; resumeRequired: boolean;
  funded: 40; escrow: number; purchasePaid: number; serviceFees: number; refunded: number;
  receivedUnits: number; reusedUnits: number; reservedUnits: number; consumedUnits: number; receipt: EducationReceipt | null;
  retryAt: number; completedAt: number | null; cancelledAt: number | null;
}
interface FamilyEducationStock { receivedUnits: number; consumedUnits: number; availableUnits: number }
interface Totals { funded: number; purchasePaid: number; serviceFees: number; refunded: number; workedMinutes: number; completed: number; cancelled: number }
export interface FamilyEducationState { version: 1; nextId: number; lastObservedAt: number; active: FamilyEducationCourse[]; pages: FamilyEducationCourse[][]; stock: Record<string, FamilyEducationStock>; totals: Totals }
const zero = (): Totals => ({ funded: 0, purchasePaid: 0, serviceFees: 0, refunded: 0, workedMinutes: 0, completed: 0, cancelled: 0 });
const clock = (s: SimState) => s.extension!.lastUpdate;
const actor = (s: SimState, id: string): Citizen | Player | undefined => id === 'player' ? s.player : s.citizens.find(person => person.id === id);
const identity = (p: Citizen | Player) => 'identities' in p ? p as Player : { role: 'traveler' as const, identities: ['traveler' as const] };
const floorOf = (b: Building, p: Vec3) => Math.floor((p.y - b.position.y + .01) / (b.height / Math.max(1, b.floors)));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
export function familyEducationCourses(s: SimState): FamilyEducationCourse[] { return [...(s.familyEducation?.pages.flat() ?? []), ...(s.familyEducation?.active ?? [])]; }
/** Original guardians' unearned cash, including pending refunds. Terminal
 * archived contracts hold zero; no module means no new account or save field. */
export function familyEducationHeldCash(s: SimState): number {
  return s.familyEducation?.active.reduce((sum, course) => sum + course.escrow, 0) ?? 0;
}
export function familyEducationTaskActorIds(s: SimState): Set<string> { return new Set((s.familyEducation?.active ?? []).filter(c => c.cancelledAt === null).map(c => c.actorId)); }
function guardians(s: SimState, id: string): { kind: FamilyEducationCourse['guardianKind']; ids: string[] }[] {
  const f = s.family, child = f?.children[id];
  return child ? [{ kind: 'parent', ids: child.parentIds }, { kind: 'care', ids: f!.careGuardians[id] ?? [] }] : [{ kind: 'student', ids: f?.studentGuardians[id] ?? [] }];
}
function transported(sim: Simulation, id: string): boolean {
  const runtime = Reflect.get(sim, 'runtime');
  return id === 'player' ? !!sim.state.player.vehicleId || !!sim.state.aviation?.activeAircraftId : !!runtime.riders[id] || !!runtime.dispatches[id];
}
function lawful(s: SimState, id: string, payerId: string): boolean {
  const payer = s.extension?.actorProfiles[payerId], learner = s.extension?.actorProfiles[id];
  return id !== payerId && !!payer?.alive && payer.age >= 18 && !!learner?.alive && learner.age >= 6 && learner.age < 18 && isFamilyDependent(s, id, payerId);
}
function siteFor(sim: Simulation, id: string): Building | undefined {
  const person = sim.state.citizens.find(p => p.id === id), siteId = sim.state.family?.children[id]?.schoolId ?? (person?.role === '学生' ? person.workId : undefined);
  return sim.worldDefinition.buildings.find(b => b.id === siteId && b.kind === 'school');
}
function atCourse(sim: Simulation, c: FamilyEducationCourse): boolean {
  const person = actor(sim.state, c.actorId), site = sim.worldDefinition.buildings.find(b => b.id === c.siteId);
  if (!person || !site || transported(sim,c.actorId) || !educationAtPosition(site, person.position, identity(person), sim.state.voxels)) return false;
  return getBuildingBody(site) ? educationServiceStationsAtPosition(site, person.position, identity(person), sim.state.voxels).some(p => p.id === c.pointId && p.floor === c.floor && distance(p.position, c.point) < EPS) : floorOf(site, person.position) === c.floor;
}
interface Presence { state: SimState; tick: number; windows: Map<string, { siteId: string; start: number; end: number }> }
const presence = new WeakMap<Simulation, Presence>();
function observation(sim: Simulation): Presence {
  let p = presence.get(sim); if (!p || p.state !== sim.state || p.tick !== sim.state.tick) { p = { state: sim.state, tick: sim.state.tick, windows: new Map() }; presence.set(sim, p); } return p;
}
/** Called by core only after its actual movement and arrival processing. */
export function observeFamilyEducationArrival(sim: Simulation, person: Citizen, site: Building, minutes: number): void {
  if (!sim.state.familyEducation || !familyEducationTaskActorIds(sim.state).has(person.id) || site.kind !== 'school' || !['studying', 'attendingService'].includes(person.state) || !Number.isFinite(minutes) || minutes <= 0 || !educationAtPosition(site, person.position, identity(person), sim.state.voxels)) return;
  observation(sim).windows.set(person.id, { siteId: site.id, start: clock(sim.state) - minutes, end: clock(sim.state) });
}
function stock(s: SimState, siteId: string): FamilyEducationStock { return s.familyEducation!.stock[siteId] ??= { receivedUnits: 0, consumedUnits: 0, availableUnits: 0 }; }
function ledger(sim: Simulation, c: FamilyEducationCourse, amount: number, purpose: string, account: 'public' | 'household'): void {
  const e = sim.state.extension!; e.publicLedger.push({ tick: sim.state.tick, actorId: c.payerId, amount, purpose, account, districtId: sim.worldDefinition.buildings.find(b => b.id === c.siteId)!.districtId });
  if (e.publicLedger.length > 512) e.publicLedger.splice(0, e.publicLedger.length - 512);
}
function archive(s: SimState, c: FamilyEducationCourse): void {
  const e = s.familyEducation!; e.active.splice(e.active.indexOf(c), 1);
  if (!e.pages.length || e.pages[e.pages.length-1].length === FAMILY_COURSE_PAGE_SIZE) e.pages.push([]);
  e.pages[e.pages.length-1].push(c);
}
function stop(sim: Simulation, c: FamilyEducationCourse): void {
  const s = sim.state, e = s.familyEducation!, payer = actor(s, c.payerId)!;
  if (c.cancelledAt === null) { c.cancelledAt = clock(s); e.totals.cancelled++; stock(s,c.siteId).availableUnits += c.reservedUnits; c.reservedUnits = 0; }
  const refund = Math.min(c.escrow, Math.max(0, LIMIT - payer.money));
  if (refund > 0) { payer.money += refund; c.escrow -= refund; c.refunded += refund; e.totals.refunded += refund; ledger(sim,c,refund,'监护人课程未赚托管款退回原付款钱包','household'); }
  c.resumeRequired = false; c.status = c.escrow > EPS ? 'refundPending' : 'cancelled'; c.reason = '课程停止；已赚服务保留，未赚款退原付款人，未耗真实教材保留原学堂。';
  if (c.status === 'cancelled') { c.escrow = 0; archive(s,c); }
}
const fail = (message: string): CommandResult => ({ ok: false, message });
export function enrollFamilyCourse(sim: Simulation, childId: string, payerId = 'player'): CommandResult {
  const s = sim.state, site = siteFor(sim,childId), child = actor(s,childId), payer = actor(s,payerId);
  if (!lawful(s,childId,payerId) || !child || !payer || !site) return fail('须由在世成年父母或已登记法定监护人，为已入学的6至17岁子女签约。');
  if (transported(sim,childId) || transported(sim,payerId) || !educationAtPosition(site,child.position,identity(child),s.voxels) || !educationAtPosition(site,payer.position,identity(payer),s.voxels) || distance(child.position,payer.position) > 2 || s.hour < 8 || s.hour >= 17) return fail('监护人与子女须在8至17点共同来到原学堂公共课堂办理。');
  if (s.familyEducation?.active.some(c => c.actorId === childId)) return fail('原课程及待退款须先清结，不能重复承诺子女的时间。');
  if ((s.familyEducation?.active.length ?? 0) >= MAX_ACTIVE || (s.familyEducation?.nextId ?? 1) > MAX_PAGES * FAMILY_COURSE_PAGE_SIZE) return fail('完整课程来源档案已达容量，未扣款；请保留全部原权利。');
  if ((s.family?.formalLearning?.[childId]?.tuitionPages?.flat().length ?? 0) >= 160 || (child.education ?? 0) >= 20) return fail('子女二十级正式课程记录已完整，不能再收费。');
  if (payer.money < FAMILY_COURSE_FEE) return fail('付款人的真实现金不足40文，未签约未扣款。');
  if (!s.citizens.some(p => p.workId === site.id && ['老师','teacher'].includes(p.role) && s.extension!.actorProfiles[p.id]?.alive && s.extension!.actorProfiles[p.id].age >= 18)) return fail('原学堂没有在册成年教师，不能承诺授课。');
  const proof = guardians(s,childId).find(g => g.ids.includes(payerId))!;
  const e = s.familyEducation ??= { version: 1, nextId: 1, lastObservedAt: clock(s), active: [], pages: [], stock: {}, totals: zero() };
  Reflect.set(Reflect.get(sim,'runtime'),'familyEducationVersion',1);
  const point = educationServiceStationsAtPosition(site,child.position,identity(child),s.voxels)[0], floor = floorOf(site,child.position), material = stock(s,site.id), reuse = Math.min(1,material.availableUnits);
  const c: FamilyEducationCourse = { id: `family-course-${e.nextId++}`, actorId:childId,payerId,guardianKind:proof.kind,guardianIds:[...proof.ids],siteId:site.id,pointId:point?.id ?? `legacy:${floor}`,point:{...(point?.position ?? child.position)},floor,startedAt:clock(s),lastObservedAt:clock(s),requiredMinutes:60,workedMinutes:0,staffMinutes:{},status:reuse ? 'waiting':'awaitingSupply',reason:'40文由法定监护人实付托管；每课须真实教材和教师共同六十分钟。',resumeRequired:false,funded:40,escrow:40,purchasePaid:0,serviceFees:0,refunded:0,receivedUnits:0,reusedUnits:reuse,reservedUnits:reuse,consumedUnits:0,receipt:null,retryAt:clock(s),completedAt:null,cancelledAt:null };
  payer.money -= FAMILY_COURSE_FEE; material.availableUnits -= reuse; e.active.push(c); e.totals.funded += FAMILY_COURSE_FEE; e.lastObservedAt = clock(s); ledger(sim,c,-FAMILY_COURSE_FEE,'监护人实付学堂课程托管款','household');
  return { ok:true,message:c.reason };
}
export function cancelFamilyCourse(sim: Simulation, courseId: string, payerId = 'player'): CommandResult {
  const c=sim.state.familyEducation?.active.find(c=>c.id===courseId); if (!c || c.payerId!==payerId || !sim.state.extension?.actorProfiles[payerId]?.alive || sim.state.extension.actorProfiles[payerId].age<18) return fail('只有原在世成年付款监护人可取消其课程。'); stop(sim,c); return {ok:true,message:c.reason};
}
export function resumeFamilyCourse(sim: Simulation, courseId: string, payerId = 'player'): CommandResult {
  const c=sim.state.familyEducation?.active.find(c=>c.id===courseId), site=c&&sim.worldDefinition.buildings.find(b=>b.id===c.siteId), payer=actor(sim.state,payerId);
  if (!c || c.cancelledAt!==null || c.payerId!==payerId || !lawful(sim.state,c.actorId,payerId) || !site || !payer || transported(sim,payerId) || !atCourse(sim,c) || !educationAtPosition(site,payer.position,identity(payer),sim.state.voxels) || distance(payer.position,actor(sim.state,c.actorId)!.position)>2) return fail('原监护人与子女须返回原课堂恢复原课程，不能追补离场时间。');
  c.resumeRequired=false;c.lastObservedAt=clock(sim.state);c.status=c.reservedUnits?'waiting':'awaitingSupply';c.reason='原课程现场恢复，不重复收费；只计之后的真实教师与子女共同窗口。';return {ok:true,message:c.reason};
}
export function familyEducationOpportunities(sim: Simulation, person: Citizen): {destination:Building;activity:'social';score:number}[] {
  const s=sim.state,p=s.extension?.actorProfiles[person.id];
  if (!p?.alive || p.age<18 || p.mood<55 || p.stress>60 || person.needs.hunger<40 || person.needs.fatigue<40 || s.hour<8 || s.hour>=17) return [];
  const resume=(s.familyEducation?.active ?? []).filter(c=>c.payerId===person.id && c.cancelledAt===null && c.resumeRequired && lawful(s,c.actorId,person.id)).map(c=>sim.worldDefinition.buildings.find(b=>b.id===c.siteId)).filter((b):b is Building=>!!b);
  const fresh=person.money>=FAMILY_RESERVE+40 ? Object.keys(s.family?.children ?? {}).filter(id=>lawful(s,id,person.id) && (actor(s,id) as Citizen).education!<3 && !(s.familyEducation?.active ?? []).some(c=>c.actorId===id)).map(id=>siteFor(sim,id)).filter((b):b is Building=>!!b) : [];
  return [...new Map([...resume,...fresh].filter(b=>sim.buildingTravelDistance(person.homeId,b.id)<=500).map(b=>[b.id,b])).values()].map(destination=>({destination,activity:'social',score:85}));
}
export function installFamilyEducation(sim: Simulation): void {
  sim.registerCommandHandler(command=> command.type==='enrollFamilyCourse'?enrollFamilyCourse(sim,command.targetId ?? ''):command.type==='cancelFamilyCourse'?cancelFamilyCourse(sim,command.targetId ?? ''):command.type==='resumeFamilyCourse'?resumeFamilyCourse(sim,command.targetId ?? ''):null);
  sim.onPhase('people',(s,minutes)=>{
    // Autonomous guardians use the same lawful physical signing entry as player.
    for (const person of s.citizens) for (const opportunity of familyEducationOpportunities(sim,person)) {
      if (person.state!=='socializing' || !educationAtPosition(opportunity.destination,person.position,identity(person),s.voxels)) continue;
      const paused=s.familyEducation?.active.find(c=>c.payerId===person.id && c.siteId===opportunity.destination.id && c.cancelledAt===null && c.resumeRequired);
      if (paused) { resumeFamilyCourse(sim,paused.id,person.id); continue; }
      const childId=Object.keys(s.family!.children).find(id=>lawful(s,id,person.id) && siteFor(sim,id)?.id===opportunity.destination.id && (actor(s,id) as Citizen).education!<3 && !s.familyEducation?.active.some(c=>c.actorId===id));
      if (childId) enrollFamilyCourse(sim,childId,person.id);
    }
    const e=s.familyEducation;if (!e)return;e.lastObservedAt=clock(s);
    for (const c of [...e.active]) {
      const elapsed=Math.min(minutes,Math.max(0,clock(s)-c.lastObservedAt));c.lastObservedAt=clock(s);
      if (c.cancelledAt!==null || !lawful(s,c.actorId,c.payerId) || siteFor(sim,c.actorId)?.id!==c.siteId) {stop(sim,c);continue;}
      if (!atCourse(sim,c)) {c.status='paused';c.resumeRequired=true;c.reason='离开原课堂暂停；已赚分钟保留，监护人现场恢复后只计新窗口。';continue;}
      if (c.resumeRequired)continue;
      const person=actor(s,c.actorId) as Citizen,profile=s.extension!.actorProfiles[c.actorId],window=observation(sim).windows.get(c.actorId),site=sim.worldDefinition.buildings.find(b=>b.id===c.siteId)!;
      const actual=window?.siteId===c.siteId ? Math.min(elapsed,window.end-Math.max(window.start,c.startedAt)) : 0;
      const available=person.needs.hunger>=40 && person.needs.fatigue>=35 && profile.health>=45 && c.reservedUnits>=1-EPS ? Math.min(actual,educationOpenMinutes(s,actual),60-c.workedMinutes,actorActivityAvailable(sim,c.actorId,minutes)) : 0;
      const options=s.citizens.filter(teacher=>educationPairAtStation(sim,site,teacher,c.actorId) && educationSlotAvailable(sim,teacher.id,c.actorId)).map(teacher=>({teacher,minutes:Math.min(available,educationStaffMinutes(sim,teacher,site.id,actual,true,Math.max(c.startedAt,window?.start ?? clock(s))))})).sort((a,b)=>b.minutes-a.minutes || a.teacher.id.localeCompare(b.teacher.id));
      const chosen=options[0],taught=chosen?.minutes ?? 0;
      if (taught<=EPS) {c.status=c.reservedUnits?'waiting':'awaitingSupply';c.reason='等待真实教材、子女当前抵达窗口与同教室已付薪教师；无追赶学时。';continue;}
      const worked=Math.min(60,c.workedMinutes+taught),earned=(40-c.purchasePaid)*worked/60,payment=earned-c.serviceFees;
      if(s.treasury+payment>LIMIT)continue;
      const credited=claimActorActivityMinutes(sim,c.actorId,c.id,taught,minutes);if(credited!==taught || !takeEducationSlot(sim,chosen.teacher.id,c.actorId))continue;
      c.workedMinutes=worked;c.staffMinutes[chosen.teacher.id]=(c.staffMinutes[chosen.teacher.id]??0)+credited;c.serviceFees=earned;c.escrow-=payment;s.treasury+=payment;Reflect.get(s.extension!,'runtime').lastTreasury+=payment;e.totals.serviceFees+=payment;e.totals.workedMinutes+=credited;ledger(sim,c,payment,'子女现场真实已赚课程服务费','public');c.status='studying';c.reason=`子女与已付薪教师共同授课${worked.toFixed(1)}/60分钟。`;
      if(worked<60-EPS)continue;c.workedMinutes=60;c.escrow=0;c.reservedUnits--;c.consumedUnits++;stock(s,c.siteId).consumedUnits++;c.status='completed';c.completedAt=clock(s);e.totals.completed++;
      if(!applyFamilyEducationCredential(sim,c))throw new Error('真实家庭课程完成后正式资格来源无法登记。');
      sim.appendNotice('family-education','完成一份真实家庭学费课：60正式学时，累计480分钟才提升学校学历。',site.districtId);archive(s,c);
    }
  });
  sim.onPhase('finance',s=>{
    const e=s.familyEducation;if(!e)return;
    for(const c of [...e.active]) {
      if(c.cancelledAt!==null || !lawful(s,c.actorId,c.payerId)){stop(sim,c);continue;}
      if(c.reservedUnits>=1-EPS || clock(s)<c.retryAt-EPS)continue;c.retryAt=clock(s)+60;const material=stock(s,c.siteId);
      if(material.availableUnits>=1-EPS){material.availableUnits--;c.reusedUnits++;c.reservedUnits++;c.status='waiting';continue;}
      const site=sim.worldDefinition.buildings.find(b=>b.id===c.siteId)!;
      const options=s.shops.filter(shop=>sim.shopCommodity(shop)==='materials' && shop.inventory>=1).map(shop=>({shop,quote:sim.quoteSupply(shop.id,1)})).sort((a,b)=>Number(b.shop.districtId===site.districtId)-Number(a.shop.districtId===site.districtId) || a.quote.unitPrice-b.quote.unitPrice || a.shop.id.localeCompare(b.shop.id));
      const source=options.find(({shop,quote})=>quote.quantity>=1 && quote.unitPrice>0 && quote.unitPrice<=c.escrow && sim.shopFunds(shop)+quote.unitPrice*(1-s.taxRate)<=LIMIT);
      if(!source){c.reason='原工坊教材库存、真实报价或付款容量不足，课程钱仍托管；不生成教材。';continue;}
      const gross=source.quote.unitPrice,net=gross*(1-s.taxRate),tax=gross-net;source.shop.inventory--;sim.transferShopFunds(source.shop,net);source.shop.revenue+=gross;source.shop.profit+=net;c.escrow-=gross;c.purchasePaid+=gross;e.totals.purchasePaid+=gross;c.receivedUnits++;c.reservedUnits++;material.receivedUnits++;c.receipt={purchasedAt:clock(s),shopId:source.shop.id,quantity:1,unitPrice:gross,gross,net,tax};c.status='waiting';
      sim.emitEvent({type:'wholesale',shopId:source.shop.id,districtId:source.shop.districtId,amount:gross,quantity:1,unitPrice:gross,siteId:site.id,procurementId:`${c.id}:textbook`,purpose:'education-material'});
    }
  });
  sim.registerSaveValidator(s=>validateFamilyEducationState(s,sim.worldDefinition));
}
export function validateFamilyEducationState(s:SimState,world:WorldDefinition):void {
  const e=s.familyEducation;if(e===undefined)return;
  const ensure=(x:unknown,label:string)=>{if(!x)throw new Error(`家庭学费课程存档无效：${label}`);};
  const object=(x:unknown):x is Record<string,any>=>!!x && typeof x==='object' && !Array.isArray(x);
  const num=(x:unknown,min:number,max:number,label:string,integer=false)=>ensure(typeof x==='number' && Number.isFinite(x) && x>=min && x<=max && (!integer || Number.isInteger(x)),label);
  const close=(a:number,b:number,label:string)=>ensure(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=Math.max(EPS,Math.max(a,b)*1e-10),label);
  ensure(object(e) && e.version===1 && s.family && s.extension,'版本及原家庭');num(e.nextId,2,MAX_PAGES*8+1,'课程序号',true);num(e.lastObservedAt,0,clock(s),'观察');
  ensure(Array.isArray(e.active) && e.active.length<=MAX_ACTIVE && Array.isArray(e.pages) && e.pages.length<=MAX_PAGES,'有限当前与分页档案');e.pages.forEach((p,i)=>ensure(Array.isArray(p) && p.length>0 && p.length<=8 && (i===e.pages.length-1 || p.length===8),'逐笔学期归档不删源'));
  ensure(object(e.stock) && Object.keys(e.stock).length<=world.buildings.length && object(e.totals),'库存总账');
  const all=familyEducationCourses(s),ids=new Set<string>(),activeLearners=new Set<string>(),ordered=[...all].sort((a,b)=>Number(a.id.slice(14))-Number(b.id.slice(14))),totals=zero(),materials=new Map<string,{received:number;consumed:number;reserved:number}>(),learners=new Map<string,FamilyEducationCourse[]>();
  ensure(all.length===e.nextId-1,'每笔真实签约都保留全部来源');
  for(const [index,c] of ordered.entries()) {
    const site=world.buildings.find(b=>b.id===c.siteId),p=s.extension!.actorProfiles[c.payerId],child=s.extension!.actorProfiles[c.actorId],lifeClock=child?.alive?clock(s):s.family!.estates[c.actorId]?.settledAt ?? clock(s);
    ensure(object(c) && c.id===`family-course-${index+1}` && !ids.has(c.id) && site?.kind==='school' && c.actorId!=='player' && !!actor(s,c.actorId) && !!actor(s,c.payerId) && c.actorId!==c.payerId,'原学校真实签約主体与连续编号');ids.add(c.id);
    num(c.startedAt,0,e.lastObservedAt,'签约');num(c.lastObservedAt,c.startedAt,e.lastObservedAt,'课程观察');
    // A death freezes profile age before the later estate registration phase.
    // Born residents retain the exact original birth clock, so historic
    // contracting age never borrows that later financial settlement clock.
    const bornChild=s.family!.children[c.actorId],bornPayer=s.family!.children[c.payerId];
    const ageAt=bornChild?(c.startedAt-bornChild.bornAt)/GAME_YEAR:child.age-(lifeClock-c.startedAt)/GAME_YEAR,payerClock=p.alive?clock(s):s.family!.estates[c.payerId]?.settledAt ?? clock(s),payerAge=bornPayer?(c.startedAt-bornPayer.bornAt)/GAME_YEAR:p.age-(payerClock-c.startedAt)/GAME_YEAR;
    ensure(ageAt>=6-EPS && ageAt<18 && payerAge>=18-EPS,'儿童不能签成年契约');ensure(['parent','care','student'].includes(c.guardianKind) && Array.isArray(c.guardianIds) && c.guardianIds.length>0 && c.guardianIds.length<=2 && new Set(c.guardianIds).size===c.guardianIds.length && c.guardianIds.includes(c.payerId) && c.guardianIds.every(id=>!!s.extension!.actorProfiles[id]),'具名法定监护签约见证');
    if(c.guardianKind==='parent')ensure(s.family!.children[c.actorId]?.parentIds.every(id=>c.guardianIds.includes(id)),'真实不可变亲生谱系');
    else if(c.guardianKind==='student')ensure(s.family!.studentGuardians[c.actorId]?.includes(c.payerId),'原法定学生监护');
    if(e.active.includes(c) && c.cancelledAt===null){ensure(lawful(s,c.actorId,c.payerId),'仍有效在世法定监护');ensure(!activeLearners.has(c.actorId),'子女唯一在办课程');activeLearners.add(c.actorId);}
    num(c.floor,0,site!.floors-1,'楼层',true);ensure(object(c.point) && [c.point.x,c.point.y,c.point.z].every(Number.isFinite),'真实课堂点');
    if(getBuildingBody(site!))ensure((site!.functionPoints ?? getBuildingUsePoints(site!,c.floor)).some(p=>p.id===c.pointId && p.purpose==='service' && p.floor===c.floor && distance(p.position,c.point)<EPS),'原公共课堂');else ensure(c.pointId===`legacy:${c.floor}`,'旧课堂');
    ensure(c.requiredMinutes===60 && c.funded===40 && ['awaitingSupply','waiting','studying','paused','refundPending','completed','cancelled'].includes(c.status) && typeof c.reason==='string' && c.reason.length<=1000 && typeof c.resumeRequired==='boolean','原配方及状态');num(c.workedMinutes,0,60,'实际学时');ensure(c.workedMinutes<=c.lastObservedAt-c.startedAt+EPS,'不追赶未观察时窗');num(c.retryAt,c.startedAt,1e12,'采购重试');
    for(const key of ['escrow','purchasePaid','serviceFees','refunded'] as const)num(c[key],0,40,'款项');close(40,c.escrow+c.purchasePaid+c.serviceFees+c.refunded,'学费资金守恒');close(c.serviceFees,(40-c.purchasePaid)*c.workedMinutes/60,'真实教师服务已赚款');
    ensure(object(c.staffMinutes) && Object.keys(c.staffMinutes).length<=s.citizens.length,'原教师分钟');let staff=0;for(const [id,m] of Object.entries(c.staffMinutes)){ensure(s.citizens.some(p=>p.id===id) && id!==c.actorId,'具名教师');num(m,EPS,60,'实教分钟');staff+=m;}close(staff,c.workedMinutes,'共同实际教学分钟');
    for(const key of ['receivedUnits','reusedUnits','reservedUnits','consumedUnits'] as const)num(c[key],0,1,'教材',true);ensure(c.receivedUnits+c.reusedUnits<=1 && c.reservedUnits+c.consumedUnits<=c.receivedUnits+c.reusedUnits,'课程一份有限教材');
    if(c.receipt===null)ensure(c.receivedUnits===0 && c.purchasePaid===0,'无回执无采购');else {const r=c.receipt,shop=s.shops.find(shop=>shop.id===r.shopId);ensure(object(r) && world.buildings.find(b=>b.id===shop?.buildingId)?.kind==='workshop' && r.quantity===1 && c.receivedUnits===1,'原工坊真实教材回执');num(r.purchasedAt,c.startedAt,c.lastObservedAt,'采购时点');num(r.unitPrice,EPS,40,'实价');close(r.unitPrice,r.gross,'单份实价');close(r.gross,c.purchasePaid,'采购实付');num(r.net,0,r.gross,'实收');num(r.tax,0,r.gross,'税');close(r.gross,r.net+r.tax,'供应商和税款');}
    ensure(!c.workedMinutes || c.receivedUnits+c.reusedUnits===1,'真实教材后才能授课');
    if(c.status==='completed'){num(c.completedAt,c.startedAt+60-EPS,c.lastObservedAt,'真实完成');ensure(c.cancelledAt===null && c.workedMinutes===60 && c.consumedUnits===1 && c.reservedUnits===0 && c.refunded===0 && c.escrow===0 && !c.resumeRequired && !e.active.includes(c),'课程完成清结');const certificates=s.family!.formalLearning?.[c.actorId]?.tuitionPages?.flat().filter(r=>r.courseId===c.id) ?? [];ensure(certificates.length===1 && certificates[0].completedAt===c.completedAt,'完整正式资格保留唯一实际课程来源');}
    else if(c.cancelledAt!==null){num(c.cancelledAt,c.startedAt,c.lastObservedAt,'取消');ensure(c.completedAt===null && c.workedMinutes<60 && c.reservedUnits===0 && c.consumedUnits===0 && (c.status==='refundPending'?c.escrow>EPS && e.active.includes(c):c.status==='cancelled' && c.escrow===0 && !e.active.includes(c)),'未赚款真实退款及无学历');}
    else ensure(e.active.includes(c) && c.completedAt===null && c.refunded===0 && c.workedMinutes<60 && c.reservedUnits===c.receivedUnits+c.reusedUnits,'在办原托管');
    const m=materials.get(c.siteId) ?? {received:0,consumed:0,reserved:0};m.received+=c.receivedUnits;m.consumed+=c.consumedUnits;m.reserved+=c.reservedUnits;materials.set(c.siteId,m);
    for(const key of ['funded','purchasePaid','serviceFees','refunded','workedMinutes'] as const)totals[key]+=c[key];totals.completed+=Number(c.status==='completed');totals.cancelled+=Number(c.cancelledAt!==null);const list=learners.get(c.actorId) ?? [];list.push(c);learners.set(c.actorId,list);
  }
  for(const [id,m] of materials){const material=e.stock[id];ensure(!!material,'每份课程实物都有原学校库存');}
  for(const [id,material] of Object.entries(e.stock)){ensure(world.buildings.find(b=>b.id===id)?.kind==='school' && object(material),'原学校库存');for(const key of ['receivedUnits','consumedUnits','availableUnits'] as const)num(material[key],0,MAX_PAGES*8,'全源库存',true);const m=materials.get(id) ?? {received:0,consumed:0,reserved:0};close(material.receivedUnits,m.received,'采购来源');close(material.consumedUnits,m.consumed,'消费来源');close(material.receivedUnits,material.consumedUnits+material.availableUnits+m.reserved,'教材采购减实耗及保管');}
  for(const key of Object.keys(totals) as (keyof Totals)[]){num(e.totals[key],0,1e8,'逐单总账');close(e.totals[key],totals[key],'总账每笔来源');}
  for(const list of learners.values())for(let i=1;i<list.length;i++){const old=list[i-1];ensure(list[i].startedAt+EPS>=Math.max(old.lastObservedAt,old.completedAt ?? 0,old.cancelledAt ?? 0),'原学时及退款清结后才开始下一课');}
  validateJointActorActivityCapacity(s);
}
