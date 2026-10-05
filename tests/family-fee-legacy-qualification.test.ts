import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Simulation} from '../src/simulation';
import {assembleSave,partitionSave} from '../src/persistence/partition';
import {familyFeeFixture,advance,station,at,pin,attachOrdinaryShifts,familyFeeCash,close} from './family-fee-education-fixture';
import {publicEducation,fixture} from './education-fixture';
import {enrollFamilyCourse,resumeFamilyCourse} from '../src/simulation/family-education';

const out='output/family-fee-education';mkdirSync(out,{recursive:true});
test('the original v1 reader legal oracles retain all three declared legacy qualifications and old public sources byte exactly',()=>{
  const metadata=JSON.parse(readFileSync(new URL('./fixtures/family-fee-v1/metadata.json',import.meta.url),'utf8'));
  for(const item of metadata.files){
    const saved=gunzipSync(readFileSync(new URL(`./fixtures/family-fee-v1/${item.file}`,import.meta.url))).toString('utf8');
    const sim=new Simulation(fixture()),result=sim.importSave(saved);assert.equal(result.ok,true,result.message);assert.equal(sim.exportSave(),saved);
    assert.equal(sim.state.family!.formalLearningVersion,1);assert.equal(sim.state.familyEducation,undefined);
    assert.equal(assembleSave(partitionSave(saved,sim.worldDefinition)),saved);
  }
});
function accepted(sim:Simulation):void {
  const saved=sim.exportSave(),next=new Simulation(sim.worldDefinition),result=next.importSave(saved);
  assert.equal(result.ok,true,result.message);assert.equal(next.exportSave(),saved);
  assert.equal(assembleSave(partitionSave(saved,sim.worldDefinition)),saved);
}
function learnedPublic(peer=false) {
  const context=familyFeeFixture(),{sim,child,site,teacher,controls}=context;
  const order=publicEducation(context);
  for(const [id,birth]of Object.entries(sim.state.family!.children))sim.state.extension!.actorProfiles[id].age=(at(sim)-birth.bornAt)/525600;
  const other=peer?sim.state.citizens.find(person=>person.id!==child.id&&person.id!==teacher.id&&person.role!=='学生'&&sim.state.extension!.actorProfiles[person.id].age>=18)!:null;
  if(other)pin(sim,controls,other.id,site,station(site));
  advance(sim,64);
  assert.equal(order.serviceMinutes[child.id],60);
  assert.equal(sim.state.family!.formalLearningVersion,1);
  if(other)assert.equal(order.serviceMinutes[other.id],60);
  return {...context,other};
}
function realCourse(context:ReturnType<typeof learnedPublic>):void {
  const {sim,child,site}=context;
  if(sim.state.hour<8||sim.state.hour>=17)advance(sim,(24-sim.state.hour+8)*60);
  sim.setFocus(station(site),'walk');
  const payer=sim.state.player.money>=40?'player':context.spouse.id;
  if(payer!=='player')pin(sim,context.controls,payer,site,station(site));
  const signed=payer==='player'?sim.command({type:'enrollFamilyCourse',targetId:child.id}):enrollFamilyCourse(sim,child.id,payer);assert.equal(signed.ok,true,signed.message);
  const course=sim.state.familyEducation!.active[0],cash=familyFeeCash(sim),deadline=at(sim)+30*60;
  while(course.status!=='completed'&&at(sim)<deadline){
    if(course.resumeRequired&&sim.state.hour>=8&&sim.state.hour<17){sim.setFocus(station(site),'walk');if(payer!=='player')pin(sim,context.controls,payer,site,station(site));resumeFamilyCourse(sim,course.id,payer);}
    sim.step(.25);
  }
  assert.equal(course.status,'completed',course.reason);assert.equal(course.workedMinutes,60);assert.equal(course.consumedUnits,1);
  assert.ok(course.receipt&&Object.values(course.staffMinutes).reduce((sum,m)=>sum+m,0)===60);
  close(familyFeeCash(sim),cash,'legacy compatibility neither funds nor destroys real cash');
}

// A declared already-held v1 qualification is accepted by that old reader.
// These assertions never label the declared legacy degree as newly earned.
test('first genuine child tuition preserves its own and another resident\'s old v1 held qualifications and every original public source',()=>{
  const context=learnedPublic(true),{sim,child,other}=context,record=sim.state.family!.formalLearning![child.id],foreign=sim.state.family!.formalLearning![other!.id];
  child.education!++;other!.education!++;
  const held={child:child.education,other:other!.education},prior={baseline:record.baselineEducation,public:JSON.stringify(record.receipts),foreign:JSON.stringify(foreign)};
  accepted(sim);writeFileSync(`${out}/legacy-held-both.before.save.json`,sim.exportSave());
  realCourse(context);
  assert.equal(child.education,held.child);assert.equal(other!.education,held.other);
  assert.equal(record.baselineEducation,prior.baseline);assert.equal(JSON.stringify(record.receipts),prior.public);assert.equal(JSON.stringify(foreign),prior.foreign);
  assert.equal(record.legacyEducationCarry,1);assert.equal(record.tuitionPages!.flat()[0].educationGain,0);assert.equal(record.earnedMinutes,120);
  accepted(sim);writeFileSync(`${out}/legacy-held-both.after.save.json`,sim.exportSave());
  const forged=JSON.parse(sim.exportSave());forged.state.citizens.find((p:any)=>p.id===child.id).education++;
  const receiver=new Simulation(sim.worldDefinition),before=receiver.exportSave();assert.equal(receiver.importSave(JSON.stringify(forged)).ok,false);assert.equal(receiver.exportSave(),before);
});

for(const [heldDegree,courseCount]of [[19.5,7],[18.5,15]]as const)test(`a legal fractional v1 held qualification ${heldDegree} caps actual school awards at twenty without altering earlier public receipts`,()=>{
  const context=learnedPublic(),{sim,child}=context,record=sim.state.family!.formalLearning![child.id],originalPublic=JSON.stringify(record.receipts);
  child.education=heldDegree;accepted(sim);attachOrdinaryShifts(context);assert.equal(sim.command({type:'speed',value:8}).ok,true);
  for(let index=0;index<courseCount;index++){realCourse(context);accepted(sim);}
  assert.equal(child.education,20);assert.equal(record.legacyEducationCarry,heldDegree);assert.equal(record.earnedMinutes,(courseCount+1)*60);
  assert.equal(record.baselineEducation,0);assert.equal(JSON.stringify(record.receipts),originalPublic);
  assert.equal(record.tuitionPages!.flat().at(-1)!.educationGain,.5);
  const cash=familyFeeCash(sim),saved=sim.exportSave(),declined=sim.command({type:'enrollFamilyCourse',targetId:child.id});assert.equal(declined.ok,false);assert.equal(sim.exportSave(),saved);close(familyFeeCash(sim),cash);
  writeFileSync(`${out}/legacy-held-near-cap-${heldDegree}.save.json`,saved);
  writeFileSync(`${out}/legacy-held-near-cap-${heldDegree}.metrics.json`,JSON.stringify({status:'PASS',legacyQualification:heldDegree,actualNewAward:20-heldDegree,qualification:child.education,formalMinutes:record.earnedMinutes,purchasedAndConsumed:courseCount,pages:record.tuitionPages,scope:'Declared old v1 degree, finite genuine private courses and one original genuine public class. No free new degree or funding.'},null,2));
});
