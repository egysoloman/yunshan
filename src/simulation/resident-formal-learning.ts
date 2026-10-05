import type { SimState, WorldDefinition } from '../types';
import { GAME_YEAR } from './family';

/** Only v3 is extended. family.ts keeps its original v1/v2 branch intact;
 * guardian courses still use 480, and birth-school histories remain 480. */
export function validateResidentFormalLearning(s:SimState,world:WorldDefinition):void {
  const f=s.family!,clock=s.extension!.lastUpdate,EPS=1e-7;
  const ensure=(x:unknown,label:string)=>{if(!x)throw new Error(`正式授课版本三无效：${label}。`);};
  const object=(x:unknown):x is Record<string,any>=>!!x && typeof x==='object' && !Array.isArray(x);
  const num=(x:unknown,min:number,max:number,label:string)=>ensure(typeof x==='number' && Number.isFinite(x) && x>=min && x<=max,label);
  const array=(x:unknown,max:number,label:string):any[]=>{ensure(Array.isArray(x) && x.length<=max,label);return x as any[];};
  const courses=[...(s.residentEducation?.pages.flat() ?? []),...(s.residentEducation?.active ?? [])];
  const familyCourses=[...(s.familyEducation?.pages.flat() ?? []),...(s.familyEducation?.active ?? [])];
  const records=f.formalLearning;
  ensure(f.formalLearningVersion===3 && !!s.residentEducation && object(records) && Object.keys(records!).length>0 && Object.keys(records!).length<=1024,'真实新课程正文与有限正式档案');
  ensure(Object.values(records!).some(r=>r.residentTuitionPages?.flat().length),'版本三须至少一份本人真实完成来源');
  const sites=new Map(world.buildings.map(b=>[b.id,b]));
  for(const [id,record] of Object.entries(records!)){
    const person=s.citizens.find(p=>p.id===id),life=s.extension!.actorProfiles[id],child=f.children[id];
    ensure(id!=='player' && !!person && !!life && object(record),'真实原居民');
    num(record.baselineEducation,0,20,'学历基线');num(record.baselineAttendanceMinutes,0,1e10,'学校基线');num(record.earnedMinutes,0,10740,'正式真实学时');
    const publicReceipts=array(record.receipts,16,'原公共来源'),minorPages=record.tuitionPages===undefined?[]:array(record.tuitionPages,20,'原监护课页'),adultPages=record.residentTuitionPages===undefined?[]:array(record.residentTuitionPages,1,'本人课程页');
    const pages=(pages:any[],label:string)=>pages.forEach((p,i)=>ensure(Array.isArray(p) && p.length>0 && p.length<=8 && (i===pages.length-1 || p.length===8),label));
    pages(minorPages,'原监护逐笔来源');pages(adultPages,'本人逐笔来源');
    ensure(record.tuitionPages===undefined || minorPages.length>0 && !!s.familyEducation,'原监护来源与真实托管');
    ensure(record.residentTuitionPages===undefined || adultPages.length>0 && !child && adultPages.flat().length<=3,'首期原成年本人，不改变出生学校规则');
    const privateSources=minorPages.length>0 || adultPages.length>0,carry=record.legacyEducationCarry ?? 0;
    ensure(record.legacyEducationCarry===undefined || privateSources,'旧资格差额只在首次真实私课保留');num(carry,0,20,'保留旧学历');
    const receipts=[...publicReceipts,...minorPages.flat(),...adultPages.flat()].sort((a,b)=>a.completedAt-b.completedAt),seen=new Set<string>();let earned=0,awarded=0,schoolMinutes=0,previousAt=0,legacyActivated=false;
    for(const receipt of receipts){
      ensure(object(receipt),'收据对象');const adult='residentCourseId' in receipt,minor='courseId' in receipt;
      ensure(!(adult && minor) && (adult?Object.keys(receipt).sort().join(',')==='completedAt,educationGain,minutes,minutesPerLevel,residentCourseId,siteId,teacherId':true),'本人明确来源形状');
      const sourceId=adult?receipt.residentCourseId:minor?receipt.courseId:receipt.orderId;
      ensure(typeof sourceId==='string' && !seen.has(sourceId) && receipt.minutes===60 && [60,480].includes(receipt.minutesPerLevel),'唯一具名六十分钟');seen.add(sourceId);let earliest=0;
      if(adult){
        const c=courses.find(c=>c.id===sourceId);
        ensure(!!c && c.status==='completed' && c.actorId===id && c.payerId===id && c.siteId===receipt.siteId && sites.get(c.siteId)?.kind==='school' && c.completedAt===receipt.completedAt && c.workedMinutes===60 && c.consumedUnits===1 && c.receivedUnits+c.reusedUnits===1 && c.lessons.at(-1)?.teacherId===receipt.teacherId && (c.staffMinutes[receipt.teacherId] ?? 0)>0,'本人实付完整教材与教学合同');
        ensure(!child && c!.signing.age>=18-EPS && c!.signing.role==='学生' && c!.signing.education<3 && receipt.minutesPerLevel===60,'原成年自签六十分钟一级');earliest=Math.max(c!.startedAt,c!.receipt?.purchasedAt ?? c!.startedAt);
      }else if(minor){
        const c=familyCourses.find(c=>c.id===sourceId);
        ensure(!!c && c.status==='completed' && c.actorId===id && c.siteId===receipt.siteId && sites.get(c.siteId)?.kind==='school' && c.completedAt===receipt.completedAt && c.workedMinutes===60 && c.consumedUnits===1 && c.receivedUnits+c.reusedUnits===1 && (c.staffMinutes[receipt.teacherId] ?? 0)>0,'原监护实付来源');
        ensure(receipt.minutesPerLevel===480,'原监护儿童四百八十分钟一级');earliest=Math.max(c!.startedAt,c!.receipt?.purchasedAt ?? c!.startedAt);
      }else{
        const order=s.culture?.orders.find(o=>o.id===sourceId);
        ensure(!!order && order.topic==='education' && order.siteId===receipt.siteId && sites.get(receipt.siteId)?.kind==='school' && order.servedIds.includes(id) && (order.serviceMinutes[id] ?? 0)>=60 && order.consumedUnits>=1 && order.receivedUnits>=order.consumedUnits && order.receipts.reduce((n,r)=>n+r.quantity,0)>=order.consumedUnits-EPS && s.citizens.some(p=>p.id===receipt.teacherId) && receipt.teacherId!==id && order.staffIds.includes(receipt.teacherId),'原公共教材与实际服务来源');
        earliest=Math.max(order!.scheduledAt,order!.approvedAt ?? order!.scheduledAt,order!.receipts[0]?.purchasedAt ?? order!.scheduledAt);
      }
      num(receipt.completedAt,Math.max(previousAt,earliest+60-EPS),f.lastUpdate,'正式完成时点');
      const lifeClock=adultPages.length?s.residentEducation!.ageClocks[id]?.ageClockAt:life.alive?clock:f.estates[id]?.settledAt ?? clock,ageAt=life.age-(lifeClock-receipt.completedAt)/GAME_YEAR;
      ensure(ageAt>=6-EPS && receipt.minutesPerLevel===(child || ageAt<18-EPS?480:60),'旧学校与真实年龄仍一致');
      const levels=receipt.minutesPerLevel===60?1:Math.floor((schoolMinutes+60)/480)-Math.floor(schoolMinutes/480);
      legacyActivated ||= adult || minor;
      const gain=Math.min(levels,Math.max(0,20-record.baselineEducation-awarded-(legacyActivated?carry:0)));
      num(receipt.educationGain,0,1,'学历增量');ensure(Math.abs(receipt.educationGain-gain)<EPS,'所有来源按原历史统一增量');
      if(receipt.minutesPerLevel===480)schoolMinutes+=60;earned+=60;awarded+=receipt.educationGain;previousAt=receipt.completedAt;
    }
    ensure(receipts.length>0 && earned===record.earnedMinutes && (privateSources?Math.abs((person!.education ?? 0)-record.baselineEducation-awarded-carry)<EPS:(person!.education ?? 0)>=record.baselineEducation+awarded-EPS),'全部原基线、学历与真实授课一致');
    ensure(child?Math.abs(child.attendanceMinutes-record.baselineAttendanceMinutes-earned)<EPS:record.baselineAttendanceMinutes===0,'出生学校累计不改变');
    // Self-signing qualification is bounded by all earlier sources, including
    // an existing public qualification; it is never a fresh invented baseline.
    for(const c of courses.filter(c=>c.actorId===id)){
      const earlier=receipts.filter(r=>r.completedAt<=c.startedAt+EPS).reduce((n,r)=>n+r.educationGain,0);
      ensure(Math.abs(c.signing.education-record.baselineEducation-earlier-carry)<EPS,'本人签约时保留所有已有正式资格');
    }
  }
}
