import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { runtime } from './clinical-presence-fixture.ts';
import { publicEmploymentFixture } from './public-employment-fixture.ts';
import { publicTransferAssignment } from '../src/simulation/public-employment.ts';

const fixture = publicEmploymentFixture();
const original = JSON.parse(fixture.saved);
const labor = original.runtime.publicLabor;
const contract = labor.employment.contracts[0];
const actor = original.state.citizens.find((person:any)=>person.id===fixture.actorId);
const close = (actual:number,expected:number,message:string)=>assert.ok(Math.abs(actual-expected)<1e-6,`${message}: ${actual} != ${expected}`);
function loaded(raw=fixture.saved) {
  const sim=new Simulation(fixture.sim.worldDefinition),result=sim.importSave(raw);
  assert.equal(result.ok,true,result.message); assert.equal(sim.exportSave(),raw); return sim;
}
function atomicReject(label:string,change:(data:any)=>void) {
  const sim=loaded(),before=sim.exportSave(),data=JSON.parse(before);change(data);
  const result=sim.importSave(JSON.stringify(data));assert.equal(result.ok,false,label);
  assert.equal(sim.exportSave(),before,`atomic refusal: ${label}`);
}
function reserved(data:any) {
  const day=Math.floor(data.state.extension.lastUpdate/1440),labor=data.runtime.publicLabor;
  return labor.shifts.filter((shift:any)=>shift.day>=day).flatMap((shift:any)=>shift.assignments)
    .concat(labor.employment.contracts.filter((contract:any)=>contract.day>=day).map((contract:any)=>contract.assignment))
    .reduce((sum:number,assignment:any)=>sum+Math.max(0,assignment.minutesCap-assignment.workedMinutes)*assignment.ratePerMinute,0);
}

test('the employment resolver keeps a signed wage opportunity through same-employer role revisions, and never revives it after a real departure',()=>{
  // Pure history-boundary test from the genuinely approved native contract.
  // These descriptors do not execute appointments, time, fees or save import.
  const copy=structuredClone(labor),oldContracts=JSON.stringify(copy.employment.contracts),oldJobs=JSON.stringify(copy.jobs);
  const first=copy.employment.transfers[0],same={...first,revision:2,fromWorkId:actor.workId,priorPublicWorkId:actor.workId,toWorkId:actor.workId,fromRole:'council',toRole:'official'};
  copy.employment.transfers.push(same);
  assert.equal(publicTransferAssignment(copy,{...actor,role:'official'},1),copy.employment.contracts[0].assignment);
  copy.employment.transfers.push({...same,revision:3,fromRole:'official',toRole:'council'});
  assert.equal(publicTransferAssignment(copy,actor,1),copy.employment.contracts[0].assignment);
  assert.equal(JSON.stringify(copy.employment.contracts),oldContracts);assert.equal(JSON.stringify(copy.jobs),oldJobs);
  copy.employment.transfers.push({...same,revision:4,fromWorkId:actor.workId,toWorkId:'pair-bank'});
  copy.employment.transfers.push({...same,revision:5,fromWorkId:'pair-bank',toWorkId:actor.workId});
  assert.equal(publicTransferAssignment(copy,actor,1),undefined,'a genuine new employer entry cannot revive an old unused same-day promise');
  const privateReturn=structuredClone(labor);privateReturn.employment.transfers.push({...same,fromWorkId:'pair-market'});
  assert.equal(publicTransferAssignment(privateReturn,actor,1),undefined,'actual private employment before return breaks public continuity');
});

test('actual election,100-guild fee and native walking appointment preserve the base registry, historical shifts and earned old wages',()=>{
  assert.equal(fixture.sim.state.governance!.elections.at(-1)!.result,'elected');
  const appointed=JSON.parse(fixture.afterAppointment),r=appointed.runtime,l=r.publicLabor,t=l.employment.transfers[0];
  assert.equal(l.version,2);assert.equal(l.employment.version,2);assert.equal(l.employment.transfers.length,1);
  assert.deepEqual(l.jobs,fixture.before.jobs);assert.deepEqual(l.shifts,fixture.before.originalShifts);
  assert.deepEqual(r.wageAccruals.filter((claim:any)=>claim.citizenId===fixture.actorId),fixture.before.oldClaims);
  assert.equal(t.fromWorkId,fixture.before.oldWorkId);assert.equal(t.toWorkId,fixture.hall.id);
  assert.equal(t.treasuryBefore-t.treasuryAfter,100);assert.equal(t.guildAfter-t.guildBefore,100);
  const person=appointed.state.citizens.find((p:any)=>p.id===fixture.actorId);
  assert.equal(person.money,fixture.before.wallet);assert.equal(person.education,fixture.before.education);assert.deepEqual(person.skills,fixture.before.skills);
  // wage-paid is the original aggregated gross payment event; its site is
  // intentionally not invented. The original site claim disappeared only
  // after that actual complete gross payment.
  const oldPaid=fixture.paid.filter((event:any)=>event.citizenId===fixture.actorId) as any[];
  assert.ok(oldPaid.length>0,'real prior job wages were actually paid, not erased by reassignment');
  assert.ok(oldPaid.reduce((sum,event)=>sum+event.amount,0)>=(fixture.before.oldClaims as any[]).reduce((sum,claim)=>sum+claim.amount,0));
  assert.ok(!original.runtime.wageAccruals.some((claim:any)=>claim.citizenId===fixture.actorId && claim.workId===fixture.before.oldWorkId));
});

test('first actually funded departmental review creates a bounded new job contract and visible coverage without replacing old commitments',()=>{
  assert.ok(contract,'new-site actual review must approve a contract');
  assert.equal(contract.day,1);assert.equal(contract.approvedAt,2044);assert.equal(contract.assignment.workId,fixture.hall.id);
  assert.ok(contract.assignment.minutesCap>0 && contract.assignment.minutesCap<=480);
  assert.equal(contract.signatures.length,2);assert.equal(new Set(contract.signatures.map((s:any)=>s.actorId)).size,2);
  for(const signature of contract.signatures){assert.ok(signature.actualWageMinutes>0 && signature.actualWageMinutes<=480);
    assert.equal(signature.actualWageMinutes,original.runtime.attendance[signature.actorId]);
    assert.ok(original.runtime.wageAccruals.some((claim:any)=>claim.citizenId===signature.actorId && claim.workId===signature.workId && claim.minutes>0));}
  const sim=loaded(),before=sim.exportSave(),snapshot=sim.publicBudgetSnapshot(),coverage=sim.publicServiceCoverage();
  assert.equal(sim.exportSave(),before,'feedback and budget queries are read only');
  close(snapshot.reservedPayroll,reserved(original),'all old and transfer unused promises are protected exactly once');
  close(coverage.reservedCash,reserved(original),'coverage includes old and new commitments');
  assert.equal(coverage.transferPromisedMinutes,contract.assignment.minutesCap);assert.equal(coverage.transferContracts?.[0].workId,fixture.hall.id);
  assert.ok(coverage.shifts.some(shift=>shift.id===contract.id));
  close(contract.available,Math.max(0,contract.cash-contract.protectedCash),'real cash after protected commitments');
  assert.ok(contract.cap<=contract.available+1e-7);close(contract.cap,contract.assignment.ratePerMinute*contract.assignment.minutesCap,'real wage cap');
  assert.equal(Reflect.get(sim,'publicWorkAllowance').call(sim,sim.state.citizens.find(p=>p.id===fixture.actorId)),contract.assignment.minutesCap);
});

test('appointed and approved native saves preserve immediate, partition and every24 full future ticks while new wages require actual new-site work',()=>{
  for(const opening of [fixture.afterAppointment,fixture.saved]){
    const live=loaded(opening),reader=loaded(opening);assert.equal(assembleSave(partitionSave(opening,live.worldDefinition)),opening);
    for(let tick=1;tick<=24;tick++){
      live.step(.25);reader.step(.25);const raw=live.exportSave();assert.equal(reader.exportSave(),raw,`complete future tick ${tick}`);
      assert.equal(assembleSave(partitionSave(raw,live.worldDefinition)),raw,`partition future tick ${tick}`);
      const data=JSON.parse(raw),actual=new Map<string,number>();
      for(const shift of data.runtime.publicLabor.shifts)for(const assignment of shift.assignments){const key=`${shift.day}:${assignment.citizenId}`;actual.set(key,(actual.get(key)??0)+assignment.workedMinutes);}
      for(const item of data.runtime.publicLabor.employment.contracts){const key=`${item.day}:${item.assignment.citizenId}`;actual.set(key,(actual.get(key)??0)+item.assignment.workedMinutes);}
      for(const value of actual.values())assert.ok(value<=480+1e-6,'old and new actual labor share the existing daily480 limit');
      close(live.publicBudgetSnapshot().reservedPayroll,reserved(data),'future old/new commitment protection');
    }
    if(opening===fixture.saved){
      const claim=runtime(live).wageAccruals.find((claim:any)=>claim.citizenId===fixture.actorId && claim.workId===fixture.hall.id);
      assert.ok(claim && claim.minutes>0 && claim.amount>0,'the actual actor reached the new site and earned real new wages');
      const assignment=runtime(live).publicLabor.employment.contracts[0].assignment;
      const carried=original.runtime.wageAccruals.find((item:any)=>item.citizenId===fixture.actorId && item.workId===fixture.hall.id)?.minutes ?? 0;
      close(assignment.workedMinutes,claim.minutes-carried,'new attendance adds only matching actual contract minutes to the existing earned claim');
    }
  }
});

test('new historical transfer authority, original registry and prior signed assignments cannot be silently rewritten by a reader',()=>{
  atomicReject('hide new rights under v1',data=>data.runtime.publicLabor.version=1);
  atomicReject('drop employment proof',data=>delete data.runtime.publicLabor.employment);
  atomicReject('rewrite original job',data=>data.runtime.publicLabor.jobs[fixture.actorId]=fixture.hall.id);
  atomicReject('rewrite prior signed assignment',data=>data.runtime.publicLabor.shifts.find((s:any)=>s.day===1).assignments.find((a:any)=>a.citizenId===fixture.actorId).workId=fixture.hall.id);
  atomicReject('unpaid actual guild fee',data=>data.runtime.publicLabor.employment.transfers[0].guildAfter-=100);
  atomicReject('wrong old source job',data=>data.runtime.publicLabor.employment.transfers[0].fromWorkId=fixture.hall.id);
  atomicReject('invalid qualification',data=>data.runtime.publicLabor.employment.transfers[0].educationAtAppointment=1);
  atomicReject('later revision for old shift',data=>data.runtime.publicLabor.shifts.find((s:any)=>s.day===1).employmentRevision=1);
  atomicReject('duplicate reviewer',data=>data.runtime.publicLabor.employment.contracts[0].signatures[1]={...data.runtime.publicLabor.employment.contracts[0].signatures[0]});
  atomicReject('airborne reviewer',data=>data.runtime.publicLabor.employment.contracts[0].signatures[0].position.y+=40);
  atomicReject('reviewer with no funded work',data=>data.runtime.publicLabor.employment.contracts[0].signatures[0].actualWageMinutes=0);
  atomicReject('zero rate gives free allowance',data=>{const c=data.runtime.publicLabor.employment.contracts[0];c.assignment.ratePerMinute=0;c.cap=0;});
  atomicReject('tiny positive rate understates actual claim',data=>{const c=data.runtime.publicLabor.employment.contracts[0];c.assignment.ratePerMinute=1e-10;c.cap=221e-10;});
  atomicReject('normal range rate still differs from actual claim',data=>{const c=data.runtime.publicLabor.employment.contracts[0];c.assignment.ratePerMinute=.08;c.cap=c.assignment.minutesCap*.08;});
  atomicReject('hide real protected debt and commitments',data=>{const c=data.runtime.publicLabor.employment.contracts[0];for(const key of Object.keys(c.funding))c.funding[key]=0;c.protectedCash=0;c.available=c.cash;c.assignment.minutesCap=480;c.cap=480*c.assignment.ratePerMinute;});
  atomicReject('unfunded appointee signs own new wage',data=>{const c=data.runtime.publicLabor.employment.contracts[0];c.signatures[0]={...c.signatures[0],actorId:fixture.actorId,role:'council',actualWageMinutes:data.runtime.attendance[fixture.actorId],fundedWorkedMinutes:28};});
  atomicReject('exhausted funded signers cannot claim on-duty work',data=>{const c=data.runtime.publicLabor.employment.contracts[0],s=c.signatures[0],a=data.runtime.publicLabor.shifts.find((shift:any)=>shift.id===s.fundedShiftId).assignments.find((a:any)=>a.citizenId===s.actorId);a.workedMinutes=a.minutesCap;s.fundedWorkedMinutes=a.minutesCap;s.actualWageMinutes=a.minutesCap;});
  atomicReject('promise beyond real cash',data=>{const c=data.runtime.publicLabor.employment.contracts[0];c.cap=c.available+1;c.assignment.ratePerMinute=c.cap/c.assignment.minutesCap;});
  atomicReject('double actual480 attendance',data=>{const c=data.runtime.publicLabor.employment.contracts[0];c.assignment.minutesCap=480;c.assignment.workedMinutes=480;c.assignment.ratePerMinute=c.cap/480;data.runtime.publicLabor.shifts.find((s:any)=>s.day===1).assignments.find((a:any)=>a.citizenId===fixture.actorId).workedMinutes=1;});
});
