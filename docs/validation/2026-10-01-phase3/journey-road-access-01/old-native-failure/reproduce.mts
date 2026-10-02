import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PerspectiveCamera } from 'three';
import { PlayerController } from './src/controller.ts';
import { selectSavedWorld } from './src/persistence/world-layout.ts';
import { planWalkingJourney } from './src/journey.ts';
import { getWalkHeight,terrainHeight } from './src/world.ts';
import { blocksTransportBarrier } from './src/transport-geometry.ts';
import { canAccessFloor } from './src/access.ts';

const native=readFileSync('./native-r7.json','utf8'),data=JSON.parse(native),from=data.state.player.position,{world,layout}=selectSavedWorld(native);
assert.equal(layout,'current-v2-r5');
const plan=planWalkingJourney(world,from,'academy-b13')!;
const keyboard=Object.assign(new EventTarget(),{closest:()=>null});
const doc=Object.assign(new EventTarget(),{pointerLockElement:null});
Object.defineProperty(globalThis,'window',{value:keyboard,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
const controller=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,world,()=>{},(building,floor)=>canAccessFloor(building,floor,data.state.player),()=>data.state.voxels);
controller.setMode('walk',from);
const target={x:-380.40000000000003,y:45.400000000000006,z:520};
const event=new Event('keydown');Object.assign(event,{code:'KeyW',repeat:false});keyboard.dispatchEvent(event);
const history=[];
for(let i=0;i<40;i++) {
  const before=controller.position,dx=target.x-before.x,dz=target.z-before.z,len=Math.hypot(dx,dz);
  controller.yaw=Math.atan2(-dx,-dz);const dt=Math.min(.1,len/4.8),candidate={x:before.x+dx/len*4.8*dt,y:before.y,z:before.z+dz/len*4.8*dt};
  controller.step(dt,false);history.push({i,before,after:controller.position,candidate,nextWalkHeight:getWalkHeight(world,candidate.x,candidate.z,before.y),terrain:terrainHeight(world,candidate.x,candidate.z),barrier:blocksTransportBarrier(world,before,candidate),heightDrop:before.y-getWalkHeight(world,candidate.x,candidate.z,before.y)});
}
const final=controller.position;controller.dispose();
assert(Math.hypot(final.x-target.x,final.z-target.z)>2.5);assert(Math.abs(final.z-from.z)<.01);assert(Math.abs(final.y-from.y)<.03);
const result={scope:'Actual r7 native UI export original body and old coherent02 production planner/controller. KeyW is dispatched to the real controller in a minimal DOM event fixture. No GL/profile/state/clock writes; no fabricated original body.',sourceSnapshot:'/tmp/yunshan-phase2-root-coherent-02',nativeSHA256:createHash('sha256').update(native).digest('hex'),actualFrom:from,oldPlanPrefix:plan.points.slice(0,9),oldPlanEdgeIds:plan.edgeIds,actualRecordedBlockedTarget:target,final,history,blocked:true,actualNativeStillPaused:data.state.paused};
writeFileSync('reproduction-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'OLD_FAILURE_REPRODUCED',nativeSHA256:result.nativeSHA256,from,final,remainingHorizontal:Math.hypot(final.x-target.x,final.z-target.z),firstCandidateHeightDrop:history[0].heightDrop,firstCandidateBarrier:history[0].barrier,oldPlanFirstNode:plan.points[1]},null,2));
