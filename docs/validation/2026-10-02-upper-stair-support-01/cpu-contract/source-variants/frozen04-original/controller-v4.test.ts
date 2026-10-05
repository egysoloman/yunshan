import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller';
import { getStairPosition } from '../src/access';
import { getWalkHeight } from '../src/world';
import { buildingLocalPosition, buildingWorldPosition, containsUnion, findFloorPlanRoute, floorPlanSupport, getBuildingBody, getBuildingEntrance, getBuildingFloorPlan, getBuildingUsePoints, getFloorPlanRoofRegions, getFloorPlanRoofSupport, getFloorPlanStairRoute } from '../src/architecture-floor-plan';
import type { Building, Vec3, WorldDefinition } from '../src/types';

function building(kind: Building['kind']='market', floorHeight=4, rotation=0): Building {
  const b:Building={id:`actual-${kind}`,districtId:'town',name:kind,kind,position:{x:0,y:0,z:0},width:40,depth:32,height:floorHeight*3,floors:3,rotation,door:{x:0,y:.6,z:16},capacity:50,seed:7,floorPlanProfile:'v4-program-bodies-02'};
  b.door=getBuildingEntrance(b);b.functionPoints=Array.from({length:b.floors},(_,f)=>getBuildingUsePoints(b,f)).flat();return b;
}
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

test('v4 actual W crosses its real doorway and reaches all three market counters through shared routes',()=>{
  const b=building();fixture(b,(c,keys)=>{
    assert.equal(c.inside,null);const first=b.functionPoints!.find(p=>p.purpose==='sale')!;
    const route=findFloorPlanRoute(b,0,c.position,first.position);assert(route);walk(c,keys,route);assert.equal(insideId(c),b.id);assert(Math.abs(c.position.y-.6)<1e-8);
    assert.equal(getBuildingFloorPlan(b,0)!.fixtures.filter(f=>f.kind==='counter').length,3);
    for(const point of b.functionPoints!.filter(p=>p.purpose==='sale')){const next=findFloorPlanRoute(b,0,c.position,point.position);assert(next);walk(c,keys,next);assert(Math.hypot(c.position.x-point.position.x,c.position.z-point.position.z)<.03);}
  });
});

test('v4 courtyard is genuinely supported outdoor ground and continuous W returns through an actual opening',()=>{
  const b=building('home');fixture(b,(c,keys)=>{
    const p=getBuildingFloorPlan(b,0)!;
    const court=p.courtyard.map(r=>({x:(r.x0+r.x1)/2,y:0,z:(r.z0+r.z1)/2})).map(v=>buildingWorldPosition(b,v)).find(v=>floorPlanSupport(b,0,v)?.kind==='courtyard');assert(court);
    const original={...court};c.setMode('walk',court);assert.deepEqual(c.position,original,'restoration must not relocate the body');assert.equal(c.inside,null);
    const use=getBuildingUsePoints(b,0)[0].position,route=findFloorPlanRoute(b,0,court,use);assert(route);walk(c,keys,route);assert.equal(insideId(c),b.id);
    const returnRoute=findFloorPlanRoute(b,0,c.position,court);assert(returnRoute);walk(c,keys,returnRoute);assert.equal(c.inside,null);assert.equal(c.floor,0);
  });
});

for(const h of [3.4,6.6])test(`v4 actual W walks both stair flights up and down at ${h}m storey height without E or reset`,()=>{
  const b=building('market',h);fixture(b,(c,keys)=>{
    const stairs=getFloorPlanStairRoute(b,0,1)!;assert(stairs.length>20);c.setMode('walk',stairs[0]);const initial={...c.position};walk(c,keys,stairs);
    assert.equal(c.floor,1);assert(Math.abs(c.position.y-(.6+h))<1e-8);assert.equal(insideId(c),b.id);
    walk(c,keys,[...stairs].reverse());assert.equal(c.floor,0);assert(Math.abs(c.position.y-.6)<1e-8);assert(Math.hypot(c.position.x-initial.x,c.position.z-initial.z)<.03);
  });
});

test('v4 actual W rejects an unauthorized upper level before rising and E only selects a legal supported landing',()=>{
  const b=building();fixture(b,(c,keys)=>{
    const route=getFloorPlanStairRoute(b,0,1)!;c.setMode('walk',route[0]);key(keys,'KeyW');c.yaw=Math.atan2(-(route[1].x-c.position.x),-(route[1].z-c.position.z));for(let i=0;i<15;i++)c.step(.015,false);key(keys,'KeyW',false);
    const firstRise=route.find(point=>point.y>.6)!;c.yaw=Math.atan2(-(firstRise.x-c.position.x),-(firstRise.z-c.position.z));key(keys,'KeyW');for(let i=0;i<30;i++)c.step(.015,false);key(keys,'KeyW',false);
    assert.equal(c.position.y,.6);assert.equal(c.floor,0);assert(c.blockedAccess);assert.equal(c.useStairs(),false);
  },(_b,f)=>f===0);
  fixture(b,c=>{c.setMode('walk',getStairPosition(b,0));assert(c.useStairs());assert.deepEqual(c.position,getStairPosition(b,1));assert.equal(floorPlanSupport(b,1,c.position)?.kind,'stairs');});
});

test('v4 rotated entrance has the same physical local door and legacy E preserves arbitrary shaft x/z exactly',()=>{
  const b=building('market',4,Math.PI/2);fixture(b,(c,keys)=>{const target=getBuildingUsePoints(b,0)[0].position,route=findFloorPlanRoute(b,0,c.position,target);assert(route);walk(c,keys,route);assert.equal(insideId(c),b.id);});
  const old=building();delete old.floorPlanProfile;delete old.functionPoints;fixture(old,c=>{const shaft=getStairPosition(old,0),point={...shaft,x:shaft.x+1.2,z:shaft.z-1.1};c.setMode('walk',point);assert(c.useStairs());assert.equal(c.position.x,point.x);assert.equal(c.position.z,point.z);assert.equal(c.position.y,4.6);});
});

test('v4 exposed roof supports restored feet, blocks its actual volume and remains outside a room',()=>{
  const b=building('home');fixture(b,(c,keys)=>{
    const roof=getFloorPlanRoofRegions(getBuildingBody(b)!).find(r=>r.kind==='gable'&&r.floor===0);assert(roof);
    const center=buildingWorldPosition(b,{x:(roof.rect.x0+roof.rect.x1)/2,y:roof.top,z:(roof.rect.z0+roof.rect.z1)/2});
    assert(Math.abs(getFloorPlanRoofSupport(b,center,0)!.y-center.y)<1e-8);c.setMode('walk',center);assert.deepEqual(c.position,center);assert.equal(c.inside,null);
    const axis=roof.gableAxis==='x'?'z':'x',target={...center,[axis]:center[axis]+.5};walk(c,keys,[center,target]);assert.equal(c.inside,null);assert(Math.abs(c.position.y-center.y)<1e-7);
    const ground=buildingWorldPosition(b,{x:0,y:0,z:14});c.setMode('walk',ground);assert.deepEqual(c.position,ground,'changing view must preserve the saved lower body, not lift it to a roof');
  });
});

test('v4 actual W cannot pass the physical market counter or walk off the top-floor stair hole',()=>{
  const b=building();fixture(b,(c,keys)=>{
    const sale=b.functionPoints!.find(p=>p.purpose==='sale')!,counter=getBuildingFloorPlan(b,0)!.fixtures.find(f=>f.kind==='counter'&&Math.abs((f.rect.x0+f.rect.x1)/2-sale.position.x)<.1)!;assert(counter);
    c.setMode('walk',sale.position);c.yaw=0;key(keys,'KeyW');for(let i=0;i<25;i++)c.step(.015,false);key(keys,'KeyW',false);
    assert(c.position.z>=counter.rect.z1+.35-1e-7,'full body radius must stop outside the 1m counter');assert(c.position.z<sale.position.z,'the check must include actual forward movement');assert.equal(c.position.y,.6,'the cabinet is not a free automatic step');
    const plan=getBuildingFloorPlan(b,2)!,hole=plan.stairHole!,start=buildingWorldPosition(b,{x:plan.stair.x-1,y:plan.y,z:plan.stair.z+.1}),empty=buildingWorldPosition(b,{x:plan.stair.x-1,y:plan.y,z:plan.stair.z+2});
    assert(containsUnion([hole],plan.stair.x-1,plan.stair.z+2));assert.equal(floorPlanSupport(b,2,empty),null,'a real shaft hole cannot be classified as a flat occupied room');
    c.setMode('walk',start);assert.equal(insideId(c),b.id);c.yaw=Math.PI;key(keys,'KeyW');for(let i=0;i<35;i++)c.step(.015,false);key(keys,'KeyW',false);
    const local=buildingLocalPosition(b,c.position);assert(local.z<=hole.z0-.35+1e-7,'the body stays fully on the real upper platform');assert.equal(c.position.y,start.y);assert.equal(c.floor,2);
  });
});

test('v4 open ground courtyard merges actual adjacent terrain support while a real cliff remains impassable',()=>{
  const b=building();fixture(b,(c,keys)=>{
    const outside={x:18,y:0,z:17};c.setMode('walk',outside);c.yaw=0;key(keys,'KeyW');for(let i=0;i<40;i++)c.step(.015,false);key(keys,'KeyW',false);
    assert(c.position.z<15,'the actual motor must cross the open stone edge without using the main entrance');assert.equal(c.position.y,.6);assert.equal(c.inside,null,'open courtyard must stay outdoors');
    c.yaw=Math.PI;key(keys,'KeyW');for(let i=0;i<40;i++)c.step(.015,false);key(keys,'KeyW',false);assert(c.position.z>16.9);assert.equal(c.position.y,0,'leaving the stone edge returns to actual terrain');
  });
  fixture(building(),(c,keys)=>{
    c.world.edges.push({id:'elevated-deck',from:'deck-a',to:'deck-b',mode:'bridge',length:4,capacity:20,points:[{x:18,y:3.4,z:16.01},{x:18,y:3.4,z:20}]});
    assert.equal(getWalkHeight(c.world,18,16.5,.6),3.4,'the exterior must be an actual elevated deck rather than an unsupported test position');
    c.setMode('walk',{x:18,y:.6,z:15.2});assert.equal(floorPlanSupport(c.world.buildings[0],0,c.position)?.kind,'courtyard');
    c.yaw=Math.PI;key(keys,'KeyW');for(let i=0;i<40;i++)c.step(.015,false);key(keys,'KeyW',false);
    assert(c.position.z<=16-.35+1e-7,'a body cannot merge the stone slab with a deck more than2.6m above it');assert.equal(c.position.y,.6);assert.equal(c.inside,null);
  });
});
