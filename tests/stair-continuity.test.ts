import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller';
import { createWorld } from '../src/world';
import { canAccessFloor } from '../src/access';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { buildingWorldPosition, buildingLocalPosition, blocksFloorPlanMovement, canStandInFloorPlan, findBuildingFloorPlanRoute, findFloorPlanRoute, floorPlanSupport, getBuildingBody, getBuildingFloorPlan, getFloorPlanStairPosition, getFloorPlanStairRoute } from '../src/architecture-floor-plan';
import { homeRestPoints } from '../src/simulation/home-rest';
import type { Building, Vec3, WorldDefinition } from '../src/types';

const nativeWorld = createWorld(20261001,'current-v4');
const east = nativeWorld.buildings.find(b=>b.id==='east-b42')!;
const west = nativeWorld.buildings.find(b=>b.id==='west-b34')!;
const eastPose = {x:1389.9520000000002,y:220.20000000000002,z:-243.62698100608847};
const westPose = {x:-1019.76,y:281.6,z:-754.5963915022352};
/** New trusted recipe input, never an imported save's arbitrary geometry. */
function continuous(b:Building):Building { return Object.assign(structuredClone(b),{stairGeometryRevision:2 as const}); }
function fixture(b:Building,run:(c:PlayerController,keys:EventTarget)=>void,allowed:(b:Building,f:number)=>boolean=()=>true) {
  const keys=Object.assign(new EventTarget(),{closest:()=>null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:keys,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
  const outside=buildingWorldPosition(b,{x:0,y:0,z:20});
  const world:WorldDefinition={seed:911,voxelSize:.2,size:4000,districts:[{id:'town',name:'小城',kind:'market',center:{x:0,y:0,z:0},radius:1200,color:'#888',population:50}],buildings:[b],nodes:[],edges:[{id:'door-road',from:'door',to:'street',mode:'road',length:4,capacity:20,points:[b.door,outside]}],mountains:[],spawn:outside,waterfall:{top:{x:1800,y:100,z:1800},bottom:{x:1800,y:0,z:1800},width:10},river:[{x:1800,y:0,z:1800},{x:1800,y:0,z:1900}]};
  const c=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,world,()=>{},allowed);
  try {run(c,keys);}finally{c.dispose();if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');}
}
function key(keys:EventTarget,code:string,down=true){const event=new Event(down?'keydown':'keyup');Object.assign(event,{code,repeat:false});keys.dispatchEvent(event);}
const insideId=(c:PlayerController)=>c.inside?.id;
/** Every move is actual keyboard W plus the normal 4.8m/s controller motor.
 * Heading chooses a shared route waypoint; feet are never reset between points. */
function walk(c:PlayerController,keys:EventTarget,points:Vec3[]) {
  key(keys,'KeyW');
  try{for(let index=1;index<points.length;index++){
    const target=points[index];let count=0;
    while(Math.hypot(c.position.x-target.x,c.position.z-target.z)>.025){
      const before=c.position,dx=target.x-before.x,dz=target.z-before.z,distance=Math.hypot(dx,dz);
      c.yaw=Math.atan2(-dx,-dz);c.step(Math.min(.015,distance/4.8),false);
      assert(Math.hypot(c.position.x-before.x,c.position.z-before.z)<=.072+1e-7,'fixed walking speed must remain unchanged');
      assert(Math.hypot(c.position.x-before.x,c.position.z-before.z)>.00001,`actual motor blocked at waypoint ${index}: ${JSON.stringify({before,target,inside:insideId(c),floor:c.floor})}`);
      assert(++count<2000,'route must make finite physical progress');
    }
  }}finally{key(keys,'KeyW',false);}
}



test('exact terminal east-b42 same-height lower-link recovers to door and both bed floors',()=>{
 const b=continuous(east), p=getBuildingFloorPlan(b,1)!;
 const support=floorPlanSupport(b,1,eastPose,.35);assert(support?.link);assert(Math.abs(support.y-eastPose.y)<1e-7);
 const local=buildingLocalPosition(b,eastPose);assert.equal(canStandInFloorPlan(p,local.x,local.z,.35),false,'the lower link is in the real slab opening');
 const targets=[{floor:0,position:b.door},...([1,2].map(floor=>({floor,position:homeRestPoints(b,floor)[0].position})))];
 for(const target of targets){const route=findBuildingFloorPlanRoute(b,1,target.floor,eastPose,target.position,.35);assert(route,`same-height lower-link must route to floor ${target.floor}`);assert.deepEqual(route[0],eastPose);}
 assert(findFloorPlanRoute(b,1,eastPose,targets[1].position,.35),'same-floor API must share recovery');
 assert.equal(findBuildingFloorPlanRoute(b,1,0,eastPose,b.door,.35,()=>true),null,'blocked first segment is still rejected');
});

test('exact terminal west-b34 full disk is supported across up8 to the real half-turn',()=>{
 const b=continuous(west),p=getBuildingFloorPlan(b,1)!,up=p.stairTreads.find(t=>t.id==='up-8')!,turn=p.stairLandings.find(t=>t.id==='half-turn')!;
 assert.equal(up.rect.z1,turn.rect.z0,'adjacent actual surfaces share the identical lattice boundary');
 const support=floorPlanSupport(b,1,westPose,.35);assert(support,'the saved body must be supported by actual upper stair surfaces');assert.equal(support.floor,1);assert(Math.abs(support.y-westPose.y)<1e-7);
 assert.equal(blocksFloorPlanMovement(b,1,westPose,westPose,.35,1.72),false);
 fixture(b,(c,keys)=>{c.setMode('walk',westPose);assert.deepEqual(c.position,westPose);assert.equal(c.floor,1);const target=getFloorPlanStairPosition(b,2),route=findBuildingFloorPlanRoute(b,1,2,c.position,target,.35);assert(route);walk(c,keys,route);assert.equal(c.floor,2);const back=findBuildingFloorPlanRoute(b,2,1,c.position,getFloorPlanStairPosition(b,1),.35);assert(back);walk(c,keys,back);assert.equal(c.floor,1);});
});

test('lower floor slab cannot hold an upper body disk over a real hole or stair side',()=>{
 const b=continuous(west),p=getBuildingFloorPlan(b,1)!,up=p.stairTreads.find(t=>t.id==='up-8')!;
 const partial=buildingWorldPosition(b,{x:up.rect.x0+.1,y:up.top,z:(up.rect.z0+up.rect.z1)/2});
 assert(floorPlanSupport(b,1,partial,0),'center is on a real tread');
 for(const floor of [0,1])assert.equal(floorPlanSupport(b,floor,partial,.35),null,'a low slab must not invent full support at a different height');
 const top=getBuildingFloorPlan(b,b.floors-1)!,empty=buildingWorldPosition(b,{x:top.stair.x-1,y:top.y,z:top.stair.z+2});
 assert.equal(floorPlanSupport(b,top.floor,empty,.35),null,'top shaft stays physically open');
});

for(const original of [east,west])test(`real ${original.id} continuous W traverses every floor up then down without reset`,()=>{
 const b=continuous(original);fixture(b,(c,keys)=>{const first=getFloorPlanStairPosition(b,0);c.setMode('walk',first);assert.deepEqual(c.position,first);
 for(let floor=0;floor<b.floors-1;floor++){const route=getFloorPlanStairRoute(b,floor,floor+1)!;walk(c,keys,route);assert.equal(c.floor,floor+1);assert(Math.abs(c.position.y-getFloorPlanStairPosition(b,floor+1).y)<1e-7);}
 for(let floor=b.floors-1;floor>0;floor--){walk(c,keys,[...getFloorPlanStairRoute(b,floor-1,floor)!].reverse());assert.equal(c.floor,floor-1);}
 assert(Math.hypot(c.position.x-first.x,c.position.z-first.z)<.03);
 });
});

test('continuous stairs retain upper ACL and the original .35m body and 1.72m head clearance',()=>{
 const b=continuous(west);fixture(b,(c,keys)=>{const route=getFloorPlanStairRoute(b,1,2)!;c.setMode('walk',route[0]);const start={...c.position};key(keys,'KeyW');c.yaw=Math.atan2(-(route[2].x-start.x),-(route[2].z-start.z));for(let i=0;i<40;i++)c.step(.015,false);key(keys,'KeyW',false);assert(Math.abs(c.position.y-start.y)<1e-7);assert(c.blockedAccess);},(site,floor)=>floor<=1&&canAccessFloor(site,floor,{role:'traveler',identities:['traveler']}));
 const p=getBuildingFloorPlan(b,1)!,ceiling=buildingWorldPosition(b,{x:p.usePoint.x,y:p.y+.2,z:p.usePoint.z});
 assert.equal(blocksFloorPlanMovement(b,1,ceiling,{...ceiling,y:p.ceilingY+b.position.y+.6-1},.35,1.72),true,'true upper slab blocks a tall body');
});

test('legacy stair descriptor and current-v4 fingerprint remain exactly trusted old geometry',()=>{
 assert.equal(savedWorldFingerprint(nativeWorld),'80cd31e2');
 const p=getBuildingFloorPlan(west,1)!,up=p.stairTreads.find(t=>t.id==='up-8')!,turn=p.stairLandings.find(t=>t.id==='half-turn')!;
 assert(Math.abs(turn.rect.z0-up.rect.z1-.2)<1e-7,'the old recipe descriptor is intentionally not silently rewritten');
 const old=JSON.stringify(getBuildingBody(west));const clone=structuredClone(west);assert.equal(JSON.stringify(getBuildingBody(clone)),old);
 const revised=continuous(west);assert.notEqual(JSON.stringify(getBuildingBody(revised)),old);
});


test('exact east lower-link also recovers on the preserved v4 descriptor and actual W reaches its door',()=>{
 const b=structuredClone(east);const route=findBuildingFloorPlanRoute(b,1,0,eastPose,b.door,.35);assert(route);
 fixture(b,(c,keys)=>{c.setMode('walk',eastPose);assert.deepEqual(c.position,eastPose);assert.equal(c.floor,1);walk(c,keys,route);assert.equal(c.floor,0);assert(Math.hypot(c.position.x-b.door.x,c.position.z-b.door.z)<.03);});
});

test('same-height recovery reaches the actual legal bedside by normal W without replacing its starting pose',()=>{
 const b=continuous(east),point=homeRestPoints(b,1)[0];assert(point);fixture(b,(c,keys)=>{c.setMode('walk',eastPose);assert.deepEqual(c.position,eastPose);const route=findFloorPlanRoute(b,1,c.position,point.position,.35);assert(route);walk(c,keys,route);assert.equal(c.floor,1);assert(Math.hypot(c.position.x-point.position.x,c.position.z-point.position.z)<.03);});
});

test('continuous stair opt-in can be removed without polluting an existing v4 body cache',()=>{
 const b=structuredClone(west),old=JSON.stringify(getBuildingBody(b));Object.assign(b,{stairGeometryRevision:2});assert.notEqual(JSON.stringify(getBuildingBody(b)),old);Reflect.deleteProperty(b,'stairGeometryRevision');assert.equal(JSON.stringify(getBuildingBody(b)),old);
});
