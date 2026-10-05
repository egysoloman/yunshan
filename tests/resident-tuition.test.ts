import assert from 'node:assert/strict';
import test from 'node:test';
import { residentEducationPaidInterval, validateResidentEducationState } from '../src/simulation/resident-education.ts';
import { applyPublicEducationCredential } from '../src/simulation/education.ts';
import { isFamilyDependent } from '../src/simulation/family.ts';
import { residentCourse, residentTuitionCash, residentTuitionFixture, continueResident24, stepUntil, validateBalance, close, pin, runtime, station, at } from './resident-tuition-fixture.ts';

// Controlled contract evidence. These fixtures pin physical positions/needs;
// native actor cash, roles, workId, wage authority and material remain untouched.
// Independent actual-save audit is required to claim natural commuting.
test('adult paid arrival tail intersects the genuine funded front before applying remaining-minute cap',()=>{
  assert.deepEqual(residentEducationPaidInterval(598,600,598,599,598,600,1),{start:598,end:599},'last remaining minute uses the funded front');
  assert.deepEqual(residentEducationPaidInterval(598,600,598,600,598,600,1),{start:598,end:599},'remaining capacity trims actual intersection from its front');
  assert.equal(residentEducationPaidInterval(598,600,598,599,599,600),null);
  assert.equal(residentEducationPaidInterval(598,600,590,598,598,600),null);
  assert.equal(residentEducationPaidInterval(598,600,598,600,600,600),null);
});
test('original adult student signs forty own cash, buys one textbook and earns one formal grade only after sixty minutes',async()=>{
  const context=await residentTuitionFixture(),{sim,student,teacher,study}=context,before=residentTuitionCash(sim),grade=student.education!,own=student.money;
  assert.ok(sim.state.extension!.actorProfiles[student.id].age>=18);assert.ok(isFamilyDependent(sim.state,student.id,sim.state.family!.studentGuardians[student.id][0]),'old support link is retained but does not authorize minor tuition');
  study(student);stepUntil(sim,()=>!!sim.state.residentEducation);const c=residentCourse(sim,student.id);
  assert.equal(c.actorId,c.payerId);assert.equal(c.signing.role,'学生');assert.equal(c.signing.education,grade);assert.equal(c.signing.moneyBefore-c.signing.moneyAfter,40);assert.ok(c.signing.moneyAfter>=100);assert.ok(c.signing.moneyBefore<=own+1e-6 || student.money>=c.signing.moneyAfter,'any intervening ordinary family support retains its real wallet source');
  assert.equal(c.workedMinutes,0,'signing phase cannot retrospectively teach');assert.equal(student.education,grade);validateBalance(sim,before);
  stepUntil(sim,()=>c.reservedUnits===1);assert.equal(c.receivedUnits,1);assert.ok(c.receipt && c.purchasePaid>0);assert.equal(c.receipt!.gross,c.purchasePaid);close(c.receipt!.net+c.receipt!.tax,c.receipt!.gross);validateBalance(sim,before);
  stepUntil(sim,()=>c.workedMinutes>=59.75);assert.equal(c.workedMinutes,59.75);assert.equal(student.education,grade);assert.equal(c.consumedUnits,0);
  sim.step(.25);assert.equal(c.status,'completed');assert.equal(c.workedMinutes,60);assert.equal(c.consumedUnits,1);assert.equal(c.escrow,0);assert.equal(student.education,grade+1);assert.equal(student.role,'学生','unchanged identity decision occurs next people phase');
  assert.equal(sim.state.family!.formalLearningVersion,3);const record=sim.state.family!.formalLearning![student.id];assert.equal(record.residentTuitionPages!.flat().length,1);assert.equal(record.residentTuitionPages![0][0].minutesPerLevel,60);assert.equal(record.residentTuitionPages![0][0].teacherId,teacher.id);assert.equal(record.earnedMinutes,60);assert.ok(c.lessons.length>0);close(c.lessons.reduce((n,l)=>n+l.endAt-l.startAt,0),60);close(c.purchasePaid+c.serviceFees,40);validateBalance(sim,before);
  assert.equal(sim.validateSave(sim.exportSave()).ok,true);continueResident24(context);assert.equal(student.role,'scientist');assert.equal(record.residentTuitionPages!.flat().length,1);
});
test('generic presence/wage events cannot admit or teach and a missing real teacher leaves own escrow intact',async()=>{
  const context=await residentTuitionFixture(),{sim,student,teacher,site,controls,study}=context,home=sim.worldDefinition.buildings.find(b=>b.id===teacher.homeId)!;
  sim.emitEvent({type:'resident-education-presence',citizenId:student.id,siteId:site.id,activityWindowStartAt:at(sim)-.25,activityWindowEndAt:at(sim)});assert.equal(sim.state.residentEducation,undefined);
  pin(sim,controls,teacher.id,home,home.door);study(student);stepUntil(sim,()=>!!sim.state.residentEducation);const c=residentCourse(sim,student.id),before=residentTuitionCash(sim);
  for(let i=0;i<16;i++){sim.emitEvent({type:'wage-earned',citizenId:teacher.id,siteId:site.id,amount:1,minutes:.25,creditedWorkStartAt:at(sim)-.25,creditedWorkEndAt:at(sim)});sim.step(.25);}
  assert.equal(c.workedMinutes,0);assert.equal(student.education,c.signing.education);assert.equal(c.lessons.length,0);validateBalance(sim,before);
});
test('absence pauses and on-site return resumes original course below renewed140 reserve without double funding or catch-up',async()=>{
  const context=await residentTuitionFixture(),{sim,site,controls,study}=context;
  const student=sim.state.citizens.find(p=>p.role==='学生' && (p.education ?? 0)<3 && p.money>=140 && p.money<180)!;assert.ok(student,'native own wallet naturally falls below140 after first40');
  study(student);stepUntil(sim,()=>!!sim.state.residentEducation);const c=residentCourse(sim,student.id);stepUntil(sim,()=>c.workedMinutes>=1);const worked=c.workedMinutes,held=c.escrow,funded=sim.state.residentEducation!.totals.funded;
  const home=sim.worldDefinition.buildings.find(b=>b.id===student.homeId)!;pin(sim,controls,student.id,home,home.door);for(let i=0;i<4;i++)sim.step(.25);assert.equal(c.status,'paused');assert.equal(c.workedMinutes,worked);assert.equal(c.escrow,held);
  study(student);sim.step(.25);assert.equal(c.workedMinutes,worked,'resume observation credits no previous absence or resume phase');assert.equal(sim.state.residentEducation!.totals.funded,funded);stepUntil(sim,()=>c.workedMinutes>worked,16);assert.equal(c.funded,40);assert.ok(c.workedMinutes<=worked+1);
  assert.equal(sim.validateSave(sim.exportSave()).ok,true);continueResident24(context);
});
test('native death refunds unearned own escrow and retains textbook without borrowing estate age clock',async()=>{
  const context=await residentTuitionFixture(),{sim,student,study}=context;study(student);stepUntil(sim,()=>!!sim.state.residentEducation);const c=residentCourse(sim,student.id);stepUntil(sim,()=>c.workedMinutes>=1);const before=residentTuitionCash(sim),grade=student.education!,escrow=c.escrow;
  // Explicit single health-zero causal fixture; no disease, cash, debt, role,
  // material or paid attendance is injected. NPC has no native loan command.
  sim.state.extension!.actorProfiles[student.id].health=0;sim.step(.25);
  assert.equal(c.status,'cancelled');assert.equal(c.refunded,escrow);assert.equal(c.escrow,0);assert.equal(c.consumedUnits,0);assert.equal(sim.state.residentEducation!.stock[c.siteId].availableUnits,1);assert.equal(student.education,grade);validateBalance(sim,before);
  const source=sim.state.residentEducation!.ageClocks[student.id];assert.equal(source.deathAgeIncrement,false);assert.equal(source.ageClockAt,source.deathObservedAt!-.25);assert.equal(sim.validateSave(sim.exportSave()).ok,true);continueResident24(context);
});
test('four genuine students share the original teacher seats and a fifth waits',async()=>{
  const context=await residentTuitionFixture(),{sim,site,teacher,study}=context,students=sim.state.citizens.filter(p=>p.role==='学生' && p.workId===site.id && (p.education ?? 0)<3 && p.money>=140).slice(0,5);assert.equal(students.length,5);
  students.forEach(study);stepUntil(sim,()=>sim.state.residentEducation?.active.length===5);stepUntil(sim,()=>sim.state.residentEducation!.active.every(c=>c.reservedUnits===1));
  const old=new Map(sim.state.residentEducation!.active.map(c=>[c.id,c.workedMinutes]));sim.step(.25);const gained=sim.state.residentEducation!.active.map(c=>c.workedMinutes-old.get(c.id)!);assert.equal(gained.filter(n=>n>0).length,4);close(gained.reduce((n,m)=>n+m,0),1);assert.ok(sim.state.residentEducation!.active.every(c=>Object.keys(c.staffMinutes).every(id=>id===teacher.id)));
  validateResidentEducationState(sim.state,sim.worldDefinition);
});
test('completed source, policy, module markers, real lessons and adult grade corruptions reject atomically',async()=>{
  const context=await residentTuitionFixture(),{sim,student,study}=context;study(student);stepUntil(sim,()=>residentCourseIfAny());
  function residentCourseIfAny(){return !!sim.state.residentEducation?.active.some(c=>c.actorId===student.id);}
  const c=residentCourse(sim,student.id);stepUntil(sim,()=>c.status==='completed',300);const raw=sim.exportSave();
  for(const corrupt of [
    (d:any)=>{delete d.residentTuitionPolicyId;},(d:any)=>{delete d.runtime.residentTuitionPolicyId;},(d:any)=>{delete d.runtime.residentEducationVersion;},(d:any)=>{d.runtime.persistedModules=d.runtime.persistedModules.filter((n:string)=>n!=='residentEducation');},
    (d:any)=>{d.state.family.formalLearningVersion=1;d.state.family.formalLearning[student.id].earnedMinutes=0;},(d:any)=>{delete d.state.residentEducation;delete d.runtime.residentEducationVersion;d.runtime.persistedModules=d.runtime.persistedModules.filter((n:string)=>n!=='residentEducation');},
    (d:any)=>{d.state.residentEducation.pages[0][0].signing.moneyAfter+=1;},(d:any)=>{d.state.residentEducation.pages[0][0].signing.age=17;},(d:any)=>{d.state.residentEducation.pages[0][0].lessons[0].paidEndAt=d.state.residentEducation.pages[0][0].lessons[0].startAt;},
    (d:any)=>{d.state.family.formalLearning[student.id].residentTuitionPages[0][0].educationGain=0;},(d:any)=>{d.state.citizens.find((p:any)=>p.id===student.id).education+=1;},(d:any)=>{d.state.residentEducation.ageClocks[student.id].ageClockAt-=1;},
  ]){const doc=JSON.parse(raw);corrupt(doc);assert.equal(sim.importSave(JSON.stringify(doc)).ok,false);assert.equal(sim.exportSave(),raw);}
  assert.equal(applyPublicEducationCredential(sim,{} as any,student.id),false,'direct old helper cannot fabricate adult self-source');
});

test('native final remaining minute at phase2 retains the actual paid and arrival front with no extra charge',async()=>{
  const context=await residentTuitionFixture(),{sim,student,study}=context;study(student);stepUntil(sim,()=>!!sim.state.residentEducation);const c=residentCourse(sim,student.id);stepUntil(sim,()=>c.workedMinutes>=59);assert.equal(c.workedMinutes,59);
  const funded=sim.state.residentEducation!.totals.funded,previous=at(sim);assert.equal(sim.command({type:'speed',value:8}).ok,true);sim.step(.25);
  assert.equal(at(sim)-previous,2);assert.equal(c.workedMinutes,60);assert.equal(c.status,'completed');const last=c.lessons.at(-1)!;assert.ok(last.startAt<=previous);assert.equal(last.endAt,previous+1);assert.ok(last.paidEndAt>=last.endAt && last.arrivalEndAt>=last.endAt);assert.equal(sim.state.residentEducation!.totals.funded,funded);assert.equal(sim.validateSave(sim.exportSave()).ok,true);
});

test('existing real player E1 and new adult self-pay use the same four current teacher seats',async()=>{
  const context=await residentTuitionFixture(),{sim,site,teacher,study}=context,students=sim.state.citizens.filter(p=>p.role==='学生' && p.workId===site.id && (p.education ?? 0)<3 && p.money>=140).slice(0,4);assert.equal(students.length,4);
  students.forEach(study);stepUntil(sim,()=>sim.state.residentEducation?.active.length===4);stepUntil(sim,()=>sim.state.residentEducation!.active.every(c=>c.reservedUnits===1));
  sim.setFocus(station(site),'walk');const start=sim.command({type:'exam',targetId:'study'});assert.equal(start.ok,true,start.message);const original=sim.state.education!.course!;stepUntil(sim,()=>original.reservedUnits===1);
  const beforePlayer=original.workedMinutes,beforeAdult=new Map(sim.state.residentEducation!.active.map(c=>[c.id,c.workedMinutes]));sim.step(.25);
  const playerGain=original.workedMinutes-beforePlayer,adultGain=sim.state.residentEducation!.active.map(c=>c.workedMinutes-beforeAdult.get(c.id)!);assert.equal(playerGain,.25);assert.equal(adultGain.filter(m=>m>0).length,3);close(playerGain+adultGain.reduce((n,m)=>n+m,0),1);assert.ok(sim.state.residentEducation!.active.every(c=>Object.keys(c.staffMinutes).every(id=>id===teacher.id)));
  assert.equal(sim.validateSave(sim.exportSave()).ok,true);
});
