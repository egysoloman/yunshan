import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {PerspectiveCamera} from 'three';
import {createWorld} from './src/world.ts';
import {PlayerController} from './src/controller.ts';
import {getBuildingBody,getFloorPlanStairRoute,floorPlanSupport} from './src/architecture-floor-plan.ts';
const world=createWorld(20261001,'current-v4');
const selected=['river-b2','river-b1','workshop-b0','academy-b0','academy-b2','core-interchange','starport-b0'];
const keys=Object.assign(new EventTarget(),{closest:()=>null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
Object.defineProperty(globalThis,'window',{value:keys,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
const controller=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,world,()=>{},()=>true);
const results:any[]=[];
const key=(down:boolean)=>{const event=new Event(down?'keydown':'keyup');Object.assign(event,{code:'KeyW',repeat:false});keys.dispatchEvent(event);};
try{for(const id of selected){const b=world.buildings.find(b=>b.id===id)!;assert(b&&getBuildingBody(b));const route=getFloorPlanStairRoute(b,0,1)!;assert(route);
 controller.setMode('walk',route[0]);const start={...controller.position};let ticks=0,maxStep=0;
 for(const [name,points] of [['up',route],['down',[...route].reverse()]] as const){key(true);for(let index=1;index<points.length;index++){const target=points[index];let retry=0;while(Math.hypot(target.x-controller.position.x,target.z-controller.position.z)>.025){const before=controller.position,dx=target.x-before.x,dz=target.z-before.z;controller.yaw=Math.atan2(-dx,-dz);controller.step(Math.min(.015,Math.hypot(dx,dz)/4.8),false);const current=controller.position,step=Math.hypot(current.x-before.x,current.z-before.z);assert(step>.00001,`${id}/${name}/${index}: blocked ${JSON.stringify({before,target})}`);assert(step<=.072+1e-7);const support=floorPlanSupport(b,controller.floor,current);assert(support&&Math.abs(support.y-current.y)<1e-7,`${id} body must have actual support at every motor tick`);maxStep=Math.max(maxStep,step);ticks++;assert(++retry<2000);}}key(false);assert.equal(controller.floor,name==='up'?1:0);assert(Math.abs(controller.position.y-(b.position.y+.6+(name==='up'?b.height/b.floors:0)))<1e-7);}
 assert(Math.hypot(controller.position.x-start.x,controller.position.z-start.z)<.03);results.push({id,kind:b.kind,storey:b.height/b.floors,ticks,maxStep,start,end:controller.position,pass:true});}
 writeFileSync('actual-sites-motor.json',JSON.stringify({scope:'CPU full generated current-v4 world and genuine keyboard W/controller.step. One explicit initial platform placement per building and headings from authority route. No E/no intermediate body relocation/no GL/normal journey claim.',seed:world.seed,results},null,2)+'\n');console.log(JSON.stringify({passed:results.length,results}));
}finally{controller.dispose();}
