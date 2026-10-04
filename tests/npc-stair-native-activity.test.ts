import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { buildingWorldPosition, blocksFloorPlanMovement, floorPlanSupport, getBuildingFloorPlan, getBuildingUsePoints, getFloorPlanStairPosition, getFloorPlanStairRoute } from '../src/architecture-floor-plan';
import { NpcStairMotion } from '../src/simulation/npc-stair-motion';
import { fixture as clinicalWorld } from './clinical-presence-fixture';
import { beginClinicalTreatment } from '../src/simulation/clinical';
import { fixture as educationWorld } from './education-fixture';
import { researchWorld } from './fixtures/research-city';
import type { Building, Citizen, Vec3, WorldDefinition } from '../src/types';
type WorkEvent={minutes?:number;creditedWorkStartAt?:number;creditedWorkEndAt?:number;citizenId?:string};
const runtime=(s:Simulation)=>Reflect.get(s,'runtime');
const m=(s:Simulation)=>Reflect.get(s,'npcStairMotion') as NpcStairMotion;
const dist=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const at=(s:Simulation)=>s.state.extension!.lastUpdate;
const near=(a:number,b:number)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const record=(name:string,value:unknown)=>{const dir=process.env.YUNSHAN_NPC_NATIVE_EVIDENCE;if(!dir)return;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
function intent(s:Simulation,c:Citizen,b:Building,start:Vec3,activity='work'){
 c.position={...start};runtime(s).activities[c.id]=activity;runtime(s).decisionAt[c.id]=at(s)+1000;Reflect.get(s,'setDestination').call(s,c,b,true);assert.equal(c.destinationId,b.id);assert.notEqual(c.state,'unreachable');
}
function marked(w:WorldDefinition,b:Building){b.stairGeometryRevision=2;b.functionPoints=Array.from({length:b.floors},(_,f)=>getBuildingUsePoints(b,f)).flat();return w;}
function measuredArrival(s:Simulation,c:Citizen,b:Building,start:Vec3,name:string,onStep?:(arrived:boolean,residual:number)=>void){
 intent(s,c,b,start);s.setFocus(start,'drone');assert.equal(c.tier,'active');assert(s.command({type:'speed',value:16}).ok);
 const initial=m(s).remaining(c.route!,c.routeIndex!,c.position),reference=c.route!.slice(c.routeIndex!).reduce((total,p,i,points)=>total+dist(i===0?c.position:points[i-1],p),0);
 assert(Number.isFinite(initial)&&initial>reference+.2,'real stair distance exceeds the unchanged reference codec');
 const started=at(s),wages:WorkEvent[]=[];s.onEvent('wage-earned',e=>{if(e.citizenId===c.id)wages.push(e);});let count=0;
 while(c.routeIndex!<c.route!.length){const route=c.route,clock=at(s);s.step(.25);assert.equal(c.route,route,'normal intent does not replace the measured route');const arrived=c.routeIndex!>=c.route!.length,residual=arrived?Math.max(0,at(s)-started-initial/4.2):0;
  const earned=wages.filter(e=>e.creditedWorkEndAt!>clock+1e-8).reduce((n,e)=>n+(e.minutes??0),0);near(earned,residual);onStep?.(arrived,residual);assert(++count<16);
 }
 assert.equal(c.state,'working');const actual=m(s).remaining(c.route!,c.routeIndex!,c.position);assert.equal(actual,0);
 const expected=at(s)-started-initial/4.2,total=wages.reduce((n,e)=>n+(e.minutes??0),0);near(total,expected);assert(expected>0&&expected<4);record(name,{actor:c.id,role:c.role,workId:c.workId,initial,reference,started,arrivedClock:at(s),actualResidual:expected,totalWageMinutes:total,wages,count,scope:'controlled actual supported leg start on one native employee; normal people/phases/time/earned labor; no runtime attendance or position hook'});return expected;
}

test('actual native commercial attendance excludes all real riser distance from its earned wage window',()=>{
 const world=createWorld(20261001,'current-v6'),s=new Simulation(world),b=world.buildings.find(b=>b.id==='market-b6')!,c=s.state.citizens.find(c=>c.id==='citizen-562')!;c.workId=b.id;
 measuredArrival(s,c,b,getFloorPlanStairPosition(b,36),'native-commercial-pay-window.json');
});

test('actual mid-riser appointment clears stale route at immediate save without changing feet; new destination pays its finite remaining rise',()=>{
 const world=createWorld(20261001,'current-v6'),s=new Simulation(world),b=world.buildings.find(b=>b.kind==='hall'&&b.floors>1)!,c=s.state.citizens.find(c=>(c.education??0)>=2&&s.state.extension!.actorProfiles[c.id].age>=18)!;
 c.position=getFloorPlanStairPosition(b,0);c.route=getFloorPlanStairRoute(b,0,1)!;c.routeIndex=1;c.destinationId=b.id;c.state='moving';let calls=0;
 while(true){Reflect.get(s,'moveCitizen').call(s,c,.01);const cursor=runtime(s).npcStairCursors[c.id],d=m(s).describe(c.route!,c.routeIndex!);if(cursor&&d.kind==='physical'&&d.leg.parts[cursor.piece]?.kind==='riser'&&cursor.offset>0)break;assert(++calls<1000);}
 const beforeFeet={...c.position},beforeTreasury=s.state.treasury,beforeGuild=s.state.extension!.organizations.find(o=>o.id==='org-guild')!.funds;
 s.state.player.role='mayor';s.state.player.identities=['traveler','mayor'];const point=getBuildingUsePoints(b,0).find(p=>p.purpose==='work')!;s.setFocus(point.position,'walk');assert(dist(s.state.player.position,c.position)<=24);
 const result=s.command({type:'appoint',targetId:c.id,value:0});assert(result.ok,result.message);assert.deepEqual(c.position,beforeFeet);assert.equal(c.route!.length,0);assert.equal(c.routeIndex,0);assert.equal(s.state.treasury,beforeTreasury-100);assert.equal(s.state.extension!.organizations.find(o=>o.id==='org-guild')!.funds,beforeGuild+100);
 const save=s.exportSave(),saved=JSON.parse(save);assert.equal(saved.runtime.npcStairCursors[c.id],undefined);const reader=new Simulation(world);assert(reader.importSave(save).ok);assert.equal(reader.exportSave(),save);assert.deepEqual(reader.state.citizens.find(x=>x.id===c.id)!.position,beforeFeet);
 runtime(s).activities[c.id]='work';Reflect.get(s,'setDestination').call(s,c,b,true);assert.deepEqual(c.position,beforeFeet);const expected=m(s).remaining(c.route!,c.routeIndex!,c.position);assert(Number.isFinite(expected));
 const before={...c.position};Reflect.get(s,'moveCitizen').call(s,c,.01);assert(dist(before,c.position)<=.04200001);assert(dist(before,c.position)>1e-10);const after=m(s).remaining(c.route!,c.routeIndex!,c.position,runtime(s).npcStairCursors[c.id]);near(expected-after,.042);const continuation=s.exportSave(),other=new Simulation(world);assert(other.importSave(continuation).ok);assert.equal(other.exportSave(),continuation);
 record('native-appointment-mid-riser.json',{result,beforeFeet,afterFeet:c.position,expectedRemaining:expected,afterRemaining:after,actualDistancePaid:expected-after,immediateExact:true,treasuryPaid:100,guildReceived:100});record('native-appointment-immediate.save.json',save);
});

test('native flat room reference legs obey the actual wall/furniture sweep without a stair cursor',()=>{
 const world=createWorld(20261001,'current-v6'),s=new Simulation(world),b=world.buildings.find(b=>b.id==='market-b6')!,plan=getBuildingFloorPlan(b,36)!;
 let from:Vec3|undefined,to:Vec3|undefined;
 for(const wall of plan.walls){const dx=wall.b[0]-wall.a[0],dz=wall.b[1]-wall.a[1],length=Math.hypot(dx,dz);if(length<2)continue;const x=(wall.a[0]+wall.b[0])/2,z=(wall.a[1]+wall.b[1])/2,offset=wall.thickness/2+.5;
  const a=buildingWorldPosition(b,{x:x-dz/length*offset,y:plan.y,z:z+dx/length*offset}),q=buildingWorldPosition(b,{x:x+dz/length*offset,y:plan.y,z:z-dx/length*offset});
  for(const [start,end]of [[a,q],[q,a]])if(floorPlanSupport(b,36,start,.35)&&!blocksFloorPlanMovement(b,36,start,start,.35,1.72)&&!blocksFloorPlanMovement(b,36,end,end,.35,1.72)&&blocksFloorPlanMovement(b,36,start,end,.35,1.72)&&m(s).describe([start,end],1).kind==='legacy'){from=start;to=end;break;}
  if(from)break;
 }
 assert(from&&to,'real wall produces a supported clear origin and a blocked full body crossing');const c=s.state.citizens.find(c=>c.id==='citizen-562')!;c.position={...from};c.route=[{...from},{...to}];c.routeIndex=1;c.destinationId=b.id;c.state='moving';const before={...c.position};assert.equal(Reflect.get(s,'moveCitizen').call(s,c,1),false);assert.equal(c.state,'physicalWaiting');assert.deepEqual(c.position,before);assert.equal(runtime(s).npcStairCursors[c.id],undefined);record('native-flat-wall.json',{from,to,after:c.position,state:c.state,actualSolidSweepBlocked:true});
});

test('real doctor finite stair commute limits paid clinical work to its actual arrived wage window',()=>{
 const world=clinicalWorld(),site=world.buildings.find(b=>b.kind==='clinic')!;marked(world,site);const s=new Simulation(world),doctor=s.state.citizens.find(c=>c.id==='citizen-4')!,patient=s.state.citizens.find(c=>c.id==='citizen-1')!,point=site.functionPoints!.find(p=>p.floor===0&&p.purpose==='service')!;
 assert.equal(doctor.role,'医生');assert.equal(doctor.workId,site.id);intent(s,doctor,site,point.position);intent(s,patient,site,point.position,'heal');s.setFocus(point.position,'walk');assert(s.command({type:'speed',value:16}).ok);
 const result=beginClinicalTreatment(s,{patientId:patient.id,payerId:'player',siteId:site.id});assert(result.ok,result.message);s.step(.25);const order=s.state.clinical!.orders.at(-1)!;assert.equal(order.receivedUnits,1);assert.equal(order.workedMinutes,0);const started=order.workedMinutes;
 const residual=measuredArrival(s,doctor,site,getFloorPlanStairPosition(site,1),'native-clinical-doctor-window.json',(arrived,minutes)=>{assert(order.workedMinutes-started<=minutes+1e-7);if(!arrived)assert.equal(order.workedMinutes,started);});assert(order.workedMinutes-started>0);assert(order.workedMinutes-started<=residual+1e-7);assert.equal(order.consumedUnits,0);
 record('native-clinical-order.json',{order,residual});
});

test('real teacher finite stair commute limits funded tuition and classroom minutes to its actual arrived wage window',()=>{
 const world=educationWorld(),site=world.buildings.find(b=>b.kind==='school')!;marked(world,site);const s=new Simulation(world),teacher=s.state.citizens.find(c=>c.workId===site.id&&c.role==='老师'&&s.state.extension!.actorProfiles[c.id].age>=18)!,point=site.functionPoints!.find(p=>p.floor===0&&p.purpose==='service')!;
 assert(teacher);teacher.position={...point.position};teacher.destinationId=site.id;teacher.route=[{...point.position}];teacher.routeIndex=1;teacher.state='working';runtime(s).activities[teacher.id]='work';runtime(s).decisionAt[teacher.id]=at(s)+1000;s.setFocus(point.position,'walk');assert(s.command({type:'speed',value:16}).ok);s.step(.25);assert(s.isOnDuty(teacher.id,site.id));const cash=s.state.player.money;const result=s.command({type:'exam',targetId:'study'});assert(result.ok,result.message);assert.equal(s.state.player.money,cash-40);s.step(.25);const course=s.state.education!.course!;assert.equal(course.receivedUnits,1);const before=course.workedMinutes;
 const residual=measuredArrival(s,teacher,site,getFloorPlanStairPosition(site,1),'native-teacher-window.json',(arrived,minutes)=>{assert(course.workedMinutes-before<=minutes+1e-7);if(!arrived)assert.equal(course.workedMinutes,before);});assert(course.workedMinutes-before>0);assert(course.workedMinutes-before<=residual+1e-7);assert.equal(course.consumedUnits,0);record('native-teacher-course.json',{course,residual,before});
});

test('native personally funded research counts actual paid arrival minutes after a finite stair return, with no fabricated investment or phase hook',()=>{
 const world=researchWorld(),site=world.buildings.find(b=>b.kind==='school')!;for(const b of world.buildings)marked(world,b);const s=new Simulation(world),actor=s.state.citizens.find(c=>c.workId===site.id&&c.role==='科研员'&&(c.education??0)>=3&&s.state.extension!.actorProfiles[c.id].skill>=35&&s.state.extension!.actorProfiles[c.id].age>=18&&c.money>=300)!;
 assert(actor);intent(s,actor,site,getFloorPlanStairPosition(site,0));const goal=actor.route!.at(-1)!;const point=site.functionPoints!.find(p=>p.purpose==='work'&&dist(p.position,goal)<1e-8)!;assert(point);actor.position={...point.position};actor.destinationId=site.id;actor.route=[{...point.position}];actor.routeIndex=1;actor.state='working';runtime(s).activities[actor.id]='work';runtime(s).decisionAt[actor.id]=at(s)+1000;s.setFocus(point.position,'walk');assert(s.command({type:'speed',value:16}).ok);const cash=actor.money;let job:any;for(let tick=0;tick<16&&!job;tick++){s.step(.25);job=Object.values(Reflect.get(s.state.extension!,'runtime').researchJobs).find((j:any)=>j?.actorId===actor.id);}assert(job,'real finance creates an actual own-cash research job');assert.equal(actor.money,cash-200);assert.equal(job.workedMinutes,0);const before=job.workedMinutes;
 // A controlled departure origin on the adjacent physical floor; actual route
 // selection preserves the original native hashed work station and job floor.
 const departure=job.floor===0?1:job.floor-1;
 const residual=measuredArrival(s,actor,site,getFloorPlanStairPosition(site,departure),'native-research-arrival-window.json',(arrived,minutes)=>{assert(job.workedMinutes-before<=minutes+1e-7);if(!arrived)assert.equal(job.workedMinutes,before);});assert(job.workedMinutes-before>0);assert(job.workedMinutes-before<=residual+1e-7);assert.equal(actor.money,cash-200);record('native-research-job.json',{job,residual,actualOwnCashInvestment:200});
});
