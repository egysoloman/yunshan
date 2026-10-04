import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {createWorld} from '../src/world.ts';
import {Simulation} from '../src/simulation.ts';
import {getBuildingUsePoints,getFloorPlanStairRoute,getFloorPlanStairPosition,floorPlanSupport,blocksFloorPlanMovement,findBuildingFloorPlanRoute} from '../src/architecture-floor-plan.ts';
import {savedWorldFingerprint} from '../src/persistence/world-layout.ts';
import {partitionSave,assembleSave} from '../src/persistence/partition.ts';
import {decodeCitizenRoutes} from '../src/persistence/route-encoding.ts';
import type {Vec3} from '../src/types.ts';

const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const record=(name:string,value:unknown)=>{
  const dir=process.env.YUNSHAN_COMMERCIAL_ROUTE_EVIDENCE;if(!dir)return;
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2));
};

test('real existing actor destination writer stays under1024, roundtrips complete/partition saves and24ordinary future ticks without raising generic bounds',()=>{
  const world=createWorld(20261001,'current-v6'),live=new Simulation(world),reader=new Simulation(world);
  const worker=live.state.citizens.find(c=>c.id==='citizen-562')!,original=structuredClone(worker),bank=world.buildings.find(b=>b.id==='market-b6')!;
  // A controlled employment premise on one existing actor isolates the route
  // boundary. It is not a native hiring/arrival or long economic stability proof.
  worker.workId=bank.id;Reflect.get(live,'runtime').activities[worker.id]='work';Reflect.get(live,'setDestination').call(live,worker,bank,true);
  assert.equal(worker.destinationId,bank.id);assert.ok(worker.route!.length<1024&&worker.route!.length>300);
  assert.equal(worker.money,original.money);assert.deepEqual(worker.needs,original.needs);assert.equal(worker.role,original.role);assert.equal(worker.homeId,original.homeId);assert.equal(live.state.citizens.length,616);
  const routePoints=worker.route!.length,opening=live.exportSave();record('production-route-opening.save.json',opening);record('actual-production-route.json',worker.route);
  assert.equal(reader.importSave(opening).ok,true);assert.equal(reader.exportSave(),opening);
  assert.equal(assembleSave(partitionSave(opening,world)),opening);
  const draft=JSON.parse(opening);draft.worldFingerprint='cdbd5357';const before=reader.exportSave();
  assert.equal(reader.importSave(JSON.stringify(draft)).ok,false);assert.equal(reader.exportSave(),before,'old unpublished route recipe cannot silently change identity');
  // The generic reader still rejects an over-limit route; compression does not
  // authorize unbounded arrays or counterfeit extra actor data.
  const bad=JSON.parse(opening);if(bad.routeEncoding!==undefined)decodeCitizenRoutes(bad.routeEncoding,bad.routePool,bad.state.citizens);delete bad.routeEncoding;delete bad.routePool;
  bad.state.citizens.find((c:any)=>c.id===worker.id).route=Array.from({length:1025},()=>({...bank.door}));
  record('generic-1025-negative.save.json',JSON.stringify(bad));
  const genericNegative=reader.importSave(JSON.stringify(bad));assert.equal(genericNegative.ok,false);assert.match(genericNegative.message,/route/);assert.equal(reader.exportSave(),before);
  const perTick=[];
  for(let tick=0;tick<24;tick++){
    live.step(.25);reader.step(.25);const text=live.exportSave();assert.equal(reader.exportSave(),text,`normal complete tick ${tick+1}`);
    const maxRoutePoints=Math.max(...live.state.citizens.map(c=>c.route?.length??0));assert.ok(maxRoutePoints<=1024);
    perTick.push({tick:live.state.tick,maxRoutePoints,workerPosition:{...worker.position},workerState:worker.state,workerDestination:worker.destinationId});
  }
  record('production-route-after24.save.json',live.exportSave());record('24tick-route-counts.json',perTick);
  const receipt={scope:'CPU controlled existing actor employment/work intent; actual destination writer and normal24 .25-minute simulation ticks; no native hiring/arrival/14-day claim',fingerprint:savedWorldFingerprint(world),workerId:worker.id,routePoints,goal:worker.route!.at(-1),ticks:24,completeAndPartitionExact:true,generic1025Rejected:true,genericNegative,priorDraftRejected:true};
  record('production-route-receipt.json',receipt);console.log(JSON.stringify(receipt));
});

test('commercial compact upper-flight NPC motion and mid-flight recovery retain actual .35 support and1.72 headroom in both directions',()=>{
  const world=createWorld(20261001,'current-v6'),sim=new Simulation(world),bank=world.buildings.find(b=>b.id==='market-b6')!,worker=sim.state.citizens.find(c=>c.id==='citizen-562')!;
  // One controlled legal start position and existing actor reassignment, then
  // only the unchanged destination writer/moveCitizen; no per-segment reset.
  worker.workId=bank.id;worker.position=getFloorPlanStairPosition(bank,36);Reflect.get(sim,'runtime').activities[worker.id]='work';Reflect.get(sim,'setDestination').call(sim,worker,bank,true);
  const goal=worker.route!.at(-1)!;assert.ok(goal.y>bank.position.y+.6+37*4.4-.01);
  const motion:Vec3[]=[{...worker.position}];let steps=0,maxRise=0,maxDistance=0;
  while((worker.routeIndex??0)<worker.route!.length){
    const before={...worker.position};Reflect.get(sim,'moveCitizen').call(sim,worker,.01);
    assert.ok(distance(before,worker.position)>1e-10,'real NPC mover advances on compact flight');
    const floor=Math.min(39,Math.max(0,Math.floor((worker.position.y-bank.position.y-.6+1e-7)/4.4)));
    assert.ok(floorPlanSupport(bank,floor,worker.position,.35),'full-body footprint supported by actual treads/landings');
    assert.equal(blocksFloorPlanMovement(bank,floor,worker.position,worker.position,.35,1.72),false);
    maxRise=Math.max(maxRise,Math.abs(worker.position.y-before.y));maxDistance=Math.max(maxDistance,distance(before,worker.position));motion.push({...worker.position});assert.ok(++steps<4000);
  }
  assert.ok(distance(worker.position,goal)<1e-7);assert.ok(maxRise<=.04200001&&maxDistance<=.04200001);
  const flight=getFloorPlanStairRoute(bank,36,37)!,a=flight[2],b=flight[3],middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2};
  const up=findBuildingFloorPlanRoute(bank,36,37,middle,getFloorPlanStairPosition(bank,37),.35)!,down=findBuildingFloorPlanRoute(bank,36,36,middle,getFloorPlanStairPosition(bank,36),.35)!;
  assert.ok(up&&down);assert.ok(up[1].y>=middle.y&&down[1].y<=middle.y,'segment recovery retains requested travel direction');
  for(const route of [up,down])for(let i=1;i<route.length;i++){
    const from=route[i-1],to=route[i],n=Math.max(1,Math.ceil(distance(from,to)/.05));
    for(let j=0;j<=n;j++){const t=j/n,p={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:from.z+(to.z-from.z)*t},floor=Math.min(39,Math.max(0,Math.floor((p.y-bank.position.y-.6+1e-7)/4.4)));
      assert.ok(floorPlanSupport(bank,floor,p,.35));assert.equal(blocksFloorPlanMovement(bank,floor,p,p,.35,1.72),false);
    }
  }
  record('upper-floor-real-npc-motion.json',motion);record('mid-flight-recovery-routes.json',{middle,up,down});
  const receipt={scope:'CPU single controlled original citizen start; unchanged real NPC destination/motion methods, not normalURL or earned native assignment',workerId:worker.id,fromFloor:36,goal,steps,maxRise,maxDistance,completeFootSupport:true,fullHeadroom:true,bothDirectionRecovery:true};record('upper-floor-npc-receipt.json',receipt);console.log(JSON.stringify(receipt));
});
