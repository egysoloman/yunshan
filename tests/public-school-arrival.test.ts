import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../src/simulation.ts';
import { blocksFloorPlanMovement,floorPlanSupport,getBuildingUsePoints,getFloorPlanStairPosition } from '../src/architecture-floor-plan.ts';
import { NpcStairMotion } from '../src/simulation/npc-stair-motion.ts';
import { educationNeedsContinuousPeople } from '../src/simulation/education.ts';
import { assembleSave,partitionSave } from '../src/persistence/partition.ts';
import { advance,at,attachControls,close,finitePublicShift,fixture,pin,publicEducation,publicLearner,publicOnly,restrictRemainingShift,runtime,station,type Controls } from './education-fixture.ts';
const evidence=(name:string,value:unknown)=>{const root=process.env.YUNSHAN_PUBLIC_SCHOOL_EVIDENCE;if(root){mkdirSync(root,{recursive:true});writeFileSync(join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}};
// Only opening location/needs controls are used; the native mover, finite
// teacher wage source, public procurement and classroom allocator all run.
function shortLearner(context:ReturnType<typeof publicOnly>,distance=.84){
 const {sim,site}=context,learner=publicLearner(context),point=station(site);context.controls.delete(learner.id);
 sim.onPhase('traffic',()=>{learner.position={...point,x:point.x+distance};learner.destinationId=site.id;learner.route=[{...point}];learner.routeIndex=0;learner.needs={hunger:100,fatigue:100,social:100,fun:100};runtime(sim).activities[learner.id]='service';runtime(sim).decisionAt[learner.id]=sim.state.day*1440+sim.state.hour*60+10;});return learner;
}
test('a real .84m learner leg leaves .05 of the quarter-minute phase for public teaching',()=>{
 const context=publicOnly(), {sim,order,site}=context,learner=shortLearner(context),before=order.serviceMinutes[learner.id]??0;
 sim.step(.25);assert.equal(learner.routeIndex,1);assert.deepEqual(learner.position,station(site));close((order.serviceMinutes[learner.id]??0)-before,.05);
 assert.equal(order.consumedUnits,0);assert.equal(sim.state.family!.formalLearning?.[learner.id],undefined);evidence('short-arrival.json',{actorId:learner.id,expected:.05,actual:(order.serviceMinutes[learner.id]??0)-before,consumedUnits:order.consumedUnits});
});
test('a learner still walking cannot use endpoint proximity to begin a public class',()=>{
 const context=publicOnly(), {sim,order}=context,learner=shortLearner(context,1.68),before=learner.education;
 sim.step(.25);assert.equal(learner.routeIndex,0);assert.notDeepEqual(learner.position,station(context.site),'actual body has not reached the end of its unfinished leg');assert.equal(order.serviceMinutes[learner.id]??0,0);assert.equal(order.consumedUnits,0);assert.equal(learner.education,before);
});
test('a real paid teacher prefix before a late learner arrival cannot be counted as a common class window',()=>{
 const context=publicOnly(), {sim,site,teacher,order}=context,plan=finitePublicShift(context);advance(sim,1);assert.ok(Number.isInteger(plan.assignment.workedMinutes));
 const learner=publicLearner(context),point=station(site);context.controls.delete(learner.id);restrictRemainingShift(plan,1);assert(sim.command({type:'speed',value:8}).ok);
 const directions=[[1,0],[-1,0],[0,1],[0,-1]];
 const from=directions.map(([x,z])=>({...point,x:point.x+x*5.04,z:point.z+z*5.04})).find(p=>floorPlanSupport(site,0,p,.35)&&!blocksFloorPlanMovement(site,0,p,point,.35,1.72));assert(from,'actual classroom has a full-body-clear 1.2-minute approach');
 sim.onPhase('traffic',()=>{learner.position={...from};learner.destinationId=site.id;learner.route=[{...point}];learner.routeIndex=0;learner.needs={hunger:100,fatigue:100,social:100,fun:100};runtime(sim).activities[learner.id]='service';runtime(sim).decisionAt[learner.id]=sim.state.day*1440+sim.state.hour*60+10;});
 const before=runtime(sim).attendance[teacher.id],grade=learner.education;sim.step(.25);close(runtime(sim).attendance[teacher.id]-before,1);assert.equal(learner.routeIndex,1);assert.deepEqual(learner.position,point);
 assert.equal(order.serviceMinutes[learner.id]??0,0,'funded interval [0,1] does not meet learner interval [1.2,2]');assert.equal(order.consumedUnits,0);assert.equal(learner.education,grade);
 evidence('disjoint-teacher-learner.json',{paidTeacherMinutes:1,learnerArrivalMinutes:1.2,phaseMinutes:2,classMinutes:0});
});
function nativeContext(){
 const world=fixture(),site=world.buildings.find(b=>b.kind==='school')!;site.stairGeometryRevision=2;site.functionPoints=Array.from({length:site.floors},(_,floor)=>getBuildingUsePoints(site,floor)).flat();
 const sim=new Simulation(world),controls:Controls=new Map(),teacher=sim.state.citizens.find(p=>p.role==='老师'&&p.workId===site.id&&sim.state.extension!.actorProfiles[p.id].age>=18)!;assert(teacher);
 let minutes=0,amount=0;sim.onEvent('wage-earned',e=>{if(e.citizenId===teacher.id){minutes+=e.minutes??0;amount+=e.amount??0;}});
 for(const person of sim.state.citizens){const home=world.buildings.find(b=>b.id===person.homeId)!;pin(sim,controls,person.id,home,home.door);}
 pin(sim,controls,teacher.id,site,station(site),'work');attachControls(sim,controls);sim.setFocus(station(site),'walk');advance(sim,4);assert(sim.isOnDuty(teacher.id,site.id));
 const context={sim,controls,teacher,site,earned:()=>({minutes,amount})},order=publicEducation(context);return {...context,order};
}
test('an actual native stair return counts only its physically remaining arrival tail and restores full and partition saves through 24 ticks',()=>{
 const context=nativeContext(),{sim,site,order}=context,learner=publicLearner(context);context.controls.delete(learner.id);const grade=learner.education;
 learner.position=getFloorPlanStairPosition(site,1);learner.destinationId=null;learner.route=[];learner.routeIndex=0;runtime(sim).activities[learner.id]='service';runtime(sim).decisionAt[learner.id]=at(sim)+1000;Reflect.get(sim,'setDestination').call(sim,learner,site,true);assert.notEqual(learner.state,'unreachable');
 const motion=Reflect.get(sim,'npcStairMotion') as NpcStairMotion,initial=motion.remaining(learner.route!,learner.routeIndex!,learner.position);assert(Number.isFinite(initial)&&initial>0);assert(sim.command({type:'speed',value:16}).ok);const started=at(sim),paidBefore=context.earned().minutes;
 let steps=0;while(learner.routeIndex!<learner.route!.length){sim.step(.25);const arrived=learner.routeIndex!>=learner.route!.length,tail=arrived?Math.max(0,at(sim)-started-initial/4.2):0;close(order.serviceMinutes[learner.id]??0,tail);assert(++steps<20);}
 const tail=at(sim)-started-initial/4.2;assert(tail>0&&tail<4);assert.equal(runtime(sim).npcMotionVersion,2);assert.equal(order.consumedUnits,0);assert.equal(learner.education,grade);assert(context.earned().minutes-paidBefore>=tail-1e-7);
 const saved=sim.exportSave();evidence('native-arrived.save.json',saved);const assembled=assembleSave(partitionSave(saved,sim.worldDefinition));assert.equal(assembled,saved);
 const full=new Simulation(sim.worldDefinition),partitioned=new Simulation(sim.worldDefinition);for(const [reader,text]of [[full,saved],[partitioned,assembled]] as const){const result=reader.importSave(text);assert(result.ok,result.message);assert.equal(reader.exportSave(),saved);attachControls(reader,context.controls);}
 for(let tick=0;tick<24;tick++){sim.step(.25);full.step(.25);partitioned.step(.25);assert.equal(full.exportSave(),sim.exportSave(),`full continuation ${tick+1}`);assert.equal(partitioned.exportSave(),sim.exportSave(),`partition continuation ${tick+1}`);}
 evidence('native-arrival.json',{actorId:learner.id,initialPhysicalDistance:initial,started,arrivalTail:tail,steps,postArrival24Exact:true,teacherEarnedMinutes:context.earned().minutes-paidBefore,scope:'controlled native stair origin; no learner movement/arrival hook; original physical route, wages and finite material'});evidence('native-future24.save.json',sim.exportSave());
});
test('an endpoint injection and a generic arrival event without a core movement window cannot produce public class time',()=>{
 const context=publicOnly(),{sim,site,teacher,order}=context,learner=sim.state.citizens.find(p=>p.id==='citizen-1')!,grade=learner.education;
 // Deliberate malformed endpoint observer, not a natural movement proof. This
 // runs after this earlier-index learner was actually processed at home.
 sim.onEvent('wage-earned',e=>{if(e.citizenId===teacher.id){learner.position={...station(site)};sim.emitEvent({type:'education-arrived',citizenId:learner.id,siteId:site.id,minutes:.25});}});
 sim.step(.25);assert.deepEqual(learner.position,station(site));assert.equal(order.serviceMinutes[learner.id]??0,0);assert.equal(order.consumedUnits,0);assert.equal(learner.education,grade);
});
test('fine public school processing requires an existing alive same-school intent and keeps the tier unchanged',()=>{
 const context=publicOnly(),{sim,order,site}=context,learner=publicLearner(context),tier=learner.tier;assert(educationNeedsContinuousPeople(sim.state,learner));assert.equal(learner.tier,tier);
 learner.destinationId=null;assert.equal(educationNeedsContinuousPeople(sim.state,learner),false);learner.destinationId=site.id;order.servedIds.push(learner.id);assert.equal(educationNeedsContinuousPeople(sim.state,learner),false);order.servedIds.pop();sim.state.extension!.actorProfiles[learner.id].alive=false;assert.equal(educationNeedsContinuousPeople(sim.state,learner),false);
});
