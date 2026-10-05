import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { NpcStairMotion } from '../src/simulation/npc-stair-motion';
import { canAccessFloor } from '../src/access';
import { blocksFloorPlanMovement, floorPlanSupport, getFloorPlanStairPosition, findBuildingFloorPlanRoute, getFloorPlanStairRoute } from '../src/architecture-floor-plan';
import { selectSavedWorld } from '../src/persistence/world-layout';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { CitySession } from '../adapters/rpg-maker/bridge';
import type { Citizen, Vec3 } from '../src/types';

const dist=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const runtime=(s:Simulation)=>Reflect.get(s,'runtime');
const motion=(s:Simulation)=>Reflect.get(s,'npcStairMotion') as NpcStairMotion;
const record=(name:string,value:unknown)=>{const dir=process.env.YUNSHAN_NPC_NATIVE_EVIDENCE;if(!dir)return;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
function setup(){
 const world=createWorld(20261001,'current-v6'),sim=new Simulation(world),bank=world.buildings.find(b=>b.id==='market-b6')!,worker=sim.state.citizens.find(c=>c.id==='citizen-562')!;
 // Controlled premise on one existing citizen. Route writing and every body
 // position afterwards are production operations; money/needs remain native.
 worker.workId=bank.id;worker.position=getFloorPlanStairPosition(bank,36);runtime(sim).activities[worker.id]='work';Reflect.get(sim,'setDestination').call(sim,worker,bank,true);
 return {world,sim,bank,worker};
}
function body(s:Simulation,c:Citizen){
 const cursor=runtime(s).npcStairCursors[c.id];
 if(cursor) motion(s).validate(c.route!,cursor,c.position);
}

test('native production motion traverses commercial real tread faces with full 3D distance, actual residual minutes and no per-step pose projection',()=>{
 const {sim,bank,worker}=setup(),initialMoney=worker.money,needs={...worker.needs},route=structuredClone(worker.route!),goal={...route.at(-1)!};
 const m=motion(sim),physicalLength=m.remaining(worker.route!,worker.routeIndex!,worker.position),referenceLength=route.slice(1).reduce((d,p,i)=>d+dist(route[i],p),0);
 assert(physicalLength>referenceLength+.5,'every .2m riser contributes its actual distance');
 const rows=[];let charged=0,callCount=0,middleSave='';
 while(worker.routeIndex!<worker.route!.length){
  const before={...worker.position};const arrived=Reflect.get(sim,'moveCitizen').call(sim,worker,.01) as boolean;
  const cursor=runtime(sim).npcStairCursors[worker.id],description=m.describe(worker.route!,worker.routeIndex!);
  body(sim,worker);const moved=dist(before,worker.position);
  assert(moved>1e-10||arrived,`native body stalled ${worker.state} at ${worker.routeIndex}`);assert(moved<=.04200001);
  const floor=Math.min(39,Math.max(0,Math.floor((worker.position.y-bank.position.y-.6+1e-7)/4.4))),support=floorPlanSupport(bank,floor,worker.position,.35);
  assert(support,'actual body has a shared full-footprint supporting stair/landing');assert(Math.abs(support.y-worker.position.y)<=.20000001,'finite vertical transition stays between the two existing step faces');
  assert.equal(blocksFloorPlanMovement(bank,floor,worker.position,worker.position,.35,1.72),false,'actual .35m/1.72m body clearance');
  const residual=Reflect.get(sim,'citizenArrivalMinutes').get(worker) as number;
  charged+=.042-(arrived?residual*4.2:0);rows.push({before,after:{...worker.position},routeIndex:worker.routeIndex,moved,cursor:cursor?structuredClone(cursor):null,phase:description.kind==='physical'&&cursor?description.leg.parts[cursor.piece]?.kind:null,residual});
  if(!middleSave&&cursor&&description.kind==='physical'&&description.leg.parts[cursor.piece]?.kind==='riser'&&cursor.offset>0) middleSave=sim.exportSave();
  assert(++callCount<4000);
 }
 assert.deepEqual(worker.position,goal);assert(Math.abs(charged-physicalLength)<1e-8,'no free vertical or epsilon completion');assert.equal(worker.money,initialMoney);assert.deepEqual(worker.needs,needs);assert(middleSave);
 const saved=JSON.parse(middleSave);assert.equal(saved.version,2);assert.equal(saved.runtime.npcMotionVersion,2);
 record('native-commercial-mid-riser.save.json',middleSave);record('native-commercial-motion.json',rows);record('native-commercial-motion-receipt.json',{callCount,physicalLength,referenceLength,charged,goal,stats:m.stats(),scope:'CPU original citizen controlled legal start/work assignment, actual native destination writer and private mover; does not claim naturally earned assignment or long-run economy'});
});

test('new native actual mid-riser writer survives complete, partition, selector and RPG bridge reconstruction for 24 real simulation ticks',()=>{
 const {world,sim,worker}=setup();let calls=0;
 while(true){Reflect.get(sim,'moveCitizen').call(sim,worker,.01);const cursor=runtime(sim).npcStairCursors[worker.id],d=motion(sim).describe(worker.route!,worker.routeIndex!);if(cursor&&d.kind==='physical'&&d.leg.parts[cursor.piece]?.kind==='riser'&&cursor.offset>0)break;assert(++calls<1000);}
 const save=sim.exportSave(),parts=partitionSave(save,world),assembled=assembleSave(parts);assert.equal(assembled,save);assert.equal(selectSavedWorld(save).layout,'current-v6');
 const full=new Simulation(world),partition=new Simulation(selectSavedWorld(assembled).world);for(const reader of [full,partition]){const loaded=reader.importSave(save);assert.equal(loaded.ok,true,loaded.message);assert.equal(reader.exportSave(),save);}
 const bridge=new CitySession({save}),bridgeReopened=new CitySession({save:bridge.exportSave()});assert.equal(bridge.metadata.saveVersion,2);assert.equal(bridgeReopened.exportCoreSave(),save);
 const rows=[];for(let tick=0;tick<24;tick++){for(const s of [sim,full,partition])s.step(.25);const next=sim.exportSave();assert.equal(full.exportSave(),next,`complete tick${tick+1}`);assert.equal(partition.exportSave(),next,`partition tick${tick+1}`);assert.equal(assembleSave(partitionSave(next,world)),next);assert(Math.max(...sim.state.citizens.map(c=>c.route?.length??0))<=1024);rows.push({tick:sim.state.tick,sha256:createHash('sha256').update(next).digest('hex'),cursors:Object.keys(runtime(sim).npcStairCursors).length});}
 record('native-writer-opening.save.json',save);record('native-writer-after24.save.json',sim.exportSave());record('native-writer-parts.json',parts);record('native-writer24.json',rows);
});

test('native actual cursor bytes reject deleted, wrong-version, off-route, NaN, detached phase and unknown identity atomically; old real reader refuses version2',async()=>{
 const {world,sim,worker}=setup();let calls=0;while(true){Reflect.get(sim,'moveCitizen').call(sim,worker,.01);const c=runtime(sim).npcStairCursors[worker.id],d=motion(sim).describe(worker.route!,worker.routeIndex!);if(c&&d.kind==='physical'&&d.leg.parts[c.piece]?.kind==='riser'&&c.offset>0)break;assert(++calls<1000);}
 const save=sim.exportSave(),base=JSON.parse(save),reader=new Simulation(world);assert(reader.importSave(save).ok);const before=reader.exportSave();
 const cases:Record<string,(d:any)=>void>={deleted:d=>delete d.runtime.npcStairCursors[worker.id],mapDeleted:d=>delete d.runtime.npcStairCursors,versionDeleted:d=>delete d.runtime.npcMotionVersion,wrongNativeVersion:d=>d.runtime.npcMotionVersion=3,wrongEnvelope:d=>d.version=1,unknownActor:d=>d.runtime.npcStairCursors['ghost']=d.runtime.npcStairCursors[worker.id],unknownKey:d=>d.runtime.npcStairCursors[worker.id].credit=2,wrongCursorVersion:d=>d.runtime.npcStairCursors[worker.id].version=2,NaN:d=>d.runtime.npcStairCursors[worker.id].offset=NaN,negative:d=>d.runtime.npcStairCursors[worker.id].offset=-1,pieceOverflow:d=>d.runtime.npcStairCursors[worker.id].piece=999,routeMismatch:d=>d.runtime.npcStairCursors[worker.id].to.z+=.01,bodyMismatch:d=>d.state.citizens.find((c:any)=>c.id===worker.id).position.y+=.001,bodyString:d=>d.state.citizens.find((c:any)=>c.id===worker.id).position.y=String(worker.position.y),indexMismatch:d=>d.runtime.npcStairCursors[worker.id].routeIndex++};
 const receipts=[];for(const [name,edit]of Object.entries(cases)){const d=structuredClone(base);edit(d);const text=JSON.stringify(d),result=reader.importSave(text);assert.equal(result.ok,false,name);assert.equal(reader.exportSave(),before,`${name}: atomic`);receipts.push({name,result,sha256:createHash('sha256').update(text).digest('hex')});record(`badcursor-${name}.save.json`,text);}
 const originalModulePath=process.env.YUNSHAN_NPC_OLD_READER;if(originalModulePath){const {Simulation:OldSimulation}=await import(originalModulePath);const old=new OldSimulation(world),oldBefore=old.exportSave();const result=old.importSave(save);assert.equal(result.ok,false);assert.equal(old.exportSave(),oldBefore);record('old244-rejects-native2.json',{result,atomic:true,originalModulePath});}
 record('badcursor-receipts.json',receipts);
});

test('raw canonical reference collision remains observable while actual production sampler recovers both up and down from a true riser position',()=>{
 const {world,sim,bank,worker}=setup();const canonical=getFloorPlanStairRoute(bank,36,37)!;let referenceBlocked=0;
 for(let i=1;i<canonical.length;i++){const a=canonical[i-1],b=canonical[i],n=Math.max(1,Math.ceil(dist(a,b)/.05));for(let j=0;j<=n;j++){const t=j/n,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};if(blocksFloorPlanMovement(bank,36,p,p,.35,1.72))referenceBlocked++;}}
 assert(referenceBlocked>0,'the preserved raw-line failure is not falsely called body-clear');
 let calls=0;while(true){Reflect.get(sim,'moveCitizen').call(sim,worker,.01);const c=runtime(sim).npcStairCursors[worker.id],d=motion(sim).describe(worker.route!,worker.routeIndex!);if(c&&d.kind==='physical'&&d.leg.parts[c.piece]?.kind==='riser'&&c.offset>0)break;assert(++calls<1000);}
 const actual={...worker.position},rows=[];
 for(const floor of [36,37]){
  const city=new Simulation(world),actor=city.state.citizens.find(c=>c.id===worker.id)!;actor.position={...actual};const target=getFloorPlanStairPosition(bank,floor);actor.route=findBuildingFloorPlanRoute(bank,36,floor,actual,target,.35)!;assert(actor.route);actor.routeIndex=1;actor.destinationId=bank.id;actor.state='moving';
  const expected=motion(city).remaining(actor.route,1,actor.position);assert(Number.isFinite(expected));let charged=0,n=0;
  while(actor.routeIndex!<actor.route.length){const before={...actor.position},arrived=Reflect.get(city,'moveCitizen').call(city,actor,.01);body(city,actor);assert(dist(before,actor.position)<=.04200001);assert(dist(before,actor.position)>1e-10||arrived);charged+=.042-(arrived?Reflect.get(city,'citizenArrivalMinutes').get(actor)*4.2:0);assert(++n<4000);}
  assert.deepEqual(actor.position,target);assert(Math.abs(charged-expected)<1e-8);rows.push({floor,expected,charged,calls:n,route:actor.route});
 }
 record('native-recovery-directions.json',{actual,referenceBlocked,rows});
});
