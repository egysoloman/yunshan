import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller';
import { blocksFloorPlanMovement, buildingLocalPosition, buildingWorldPosition, floorPlanSupport, getBuildingBody, getBuildingFloorPlan, getFloorPlanStairRoute, wallPanels } from '../src/architecture-floor-plan';
import type { Building, Vec3, WorldDefinition } from '../src/types';

// Immutable existing production world; never invoke createWorld or Simulation.
const worldFile=new URL('../../inputs/current-v4-20261001.world.json',import.meta.url);
const worldBytes=readFileSync(worldFile),world:WorldDefinition=JSON.parse(worldBytes.toString());
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const records:unknown[]=[];
after(()=>writeFileSync(process.env.STAIR_REPORT!,JSON.stringify({worldSHA256:sha(worldBytes),scope:'Existing actual buildings and normal W motor. One-site projection retains original mountain/water/road/transport data and exact tested building dimensions/floors/fixtures/stairs/roofs. Unrelated buildings omitted, so terrain fallback is not the complete-world terrain contract. Continuous stairs have full real provider support; no world regeneration, simulation or GL.',records},null,2)+'\n'));
const exactFrom={x:-404.59997341778063,y:80,z:308.791474723644};
const exactNext={...exactFrom,z:308.863474723644};
const actual=(id:string)=>{const b=world.buildings.find(b=>b.id===id);assert(b,`missing actual ${id}`);return b;};
function fixture(b:Building,start:Vec3,run:(c:PlayerController,keys:EventTarget)=>void,allowed:(_b:Building,f:number)=>boolean=()=>true) {
  const keys=Object.assign(new EventTarget(),{closest:()=>null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:keys,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
  const c=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,{...world,spawn:{...start},buildings:[b]},()=>{},allowed);
  try {assert.deepEqual(c.position,start,'initial restoration must not lift the body');run(c,keys);} finally {
    c.dispose();if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');
  }
}
function key(keys:EventTarget,down=true){const e=new Event(down?'keydown':'keyup');Object.assign(e,{code:'KeyW',repeat:false});keys.dispatchEvent(e);}
function walk(c:PlayerController,keys:EventTarget,points:Vec3[],steps:unknown[]) {
  key(keys);
  try {for(let i=1;i<points.length;i++){
    let count=0;const target=points[i];
    while(Math.hypot(c.position.x-target.x,c.position.z-target.z)>.025){
      const before=c.position,dx=target.x-before.x,dz=target.z-before.z,d=Math.hypot(dx,dz);
      c.yaw=Math.atan2(-dx,-dz);c.step(Math.min(.015,d/4.8),false);
      const after=c.position,move=Math.hypot(after.x-before.x,after.z-before.z),rise=after.y-before.y;
      steps.push({waypoint:i,before,after,floor:c.floor,inside:c.inside?.id,blockedAccess:c.blockedAccess});
      assert(move>.00001,`actual W blocked: ${JSON.stringify({before,target,floor:c.floor,blockedAccess:c.blockedAccess})}`);
      assert(move<=.072+1e-7,'normal 4.8m/s speed and .015s maximum sample');
      assert(rise<=.2+1e-7&&rise>=-.4-1e-7,'real .2m tread rise and original bounded descent');
      assert(c.inside,'stairs must remain within the actual supporting building');
      const supported=floorPlanSupport(c.inside,c.floor,after,.35);
      assert(supported&&Math.abs(supported.y-after.y)<1e-7,'every actual motor pose needs full .35m support');
      assert(++count<2000,'finite real progress');
    }
    assert(Math.abs(c.position.y-target.y)<1e-7,`waypoint actual elevation: ${JSON.stringify({actual:c.position,target})}`);
  }} finally {key(keys,false);}
}
test('original exact browser failure advances .072m onto the first 0.2m upper tread with normal W',()=>{
  const b=actual('market-b24');fixture(b,exactFrom,(c,keys)=>{
    assert.equal(c.floor,1);assert.equal(c.inside?.id,b.id);
    const preSupport=floorPlanSupport(b,1,exactNext,.35),center=floorPlanSupport(b,1,exactNext,0);
    key(keys);c.yaw=Math.PI;c.step(.015,false);key(keys,false);
    const row={case:'original exact browser failure',buildingId:b.id,from:exactFrom,requested:exactNext,preSupport,center,after:c.position,floor:c.floor,blockedAccess:c.blockedAccess};records.push(row);
    assert(Math.abs(c.position.z-exactNext.z)<1e-8,JSON.stringify(row));
    assert(Math.abs(c.position.y-80.2)<1e-7,'no manual foot-height assignment');
    assert.equal(c.floor,1);assert.equal(c.blockedAccess,null);
  });
});
// Original seven controlled-body IDs, exact failed home, an actual tall home,
// and the bank's distinct finance layout. Each climbs every real storey and
// then returns continuously; there is no E/useStairs/setMode/reset in a route.
for(const id of ['market-b24','river-b2','river-b1','workshop-b0','academy-b0','academy-b2','core-interchange','starport-b0','river-b34','market-b3']) {
  test(`actual ${id} W traverses all floors up and back without resetting feet`,()=>{
    const b=actual(id),body=getBuildingBody(b);assert(body);const bottom=body.floorPlans[0].floor,top=b.floors-1;
    const first=getFloorPlanStairRoute(b,bottom,bottom+1);assert(first);const steps:unknown[]=[],landings:unknown[]=[];
    const row={case:'continuous full-height round trip',id,kind:b.kind,family:body.family,height:b.height/b.floors,floors:b.floors,start:first[0],steps,landings};records.push(row);
    fixture(b,first[0],(c,keys)=>{
      for(let f=bottom;f<top;f++){
        const route=getFloorPlanStairRoute(b,f,f+1);assert(route);walk(c,keys,route,steps);
        assert.equal(c.floor,f+1);assert.equal(c.inside?.id,b.id);landings.push({direction:'up',floor:c.floor,position:c.position});
      }
      for(let f=top-1;f>=bottom;f--){
        const route=getFloorPlanStairRoute(b,f,f+1);assert(route);walk(c,keys,[...route].reverse(),steps);
        assert.equal(c.floor,f);assert.equal(c.inside?.id,b.id);landings.push({direction:'down',floor:c.floor,position:c.position});
      }
      assert(Math.hypot(c.position.x-first[0].x,c.position.z-first[0].z)<.03);assert(Math.abs(c.position.y-first[0].y)<1e-7);
    });
  });
}
test('upper stair hole and tread-side overhang remain real unsupported volume',()=>{
  const b=actual('market-b24'),p=getBuildingFloorPlan(b,1)!;assert(p.stairHole);
  const first=p.stairTreads.find(t=>t.id==='up-3')!;
  const side=buildingWorldPosition(b,{x:first.rect.x0+.1,y:first.top,z:(first.rect.z0+first.rect.z1)/2});
  assert(floorPlanSupport(b,1,side,0),'side-overhang center is on a real tread');
  assert.equal(floorPlanSupport(b,1,side,.35),null,'full .35m circle cannot acquire support in the shaft side void');
  const top=getBuildingFloorPlan(b,2)!,hole=top.stairHole!;
  const start=buildingWorldPosition(b,{x:top.stair.x,y:top.y,z:top.stair.z});
  fixture(b,start,(c,keys)=>{
    const target=buildingWorldPosition(b,{x:top.stair.x,y:top.y,z:(hole.z0+hole.z1)/2});
    assert.equal(floorPlanSupport(b,2,target,.35),null);
    const before=c.position;key(keys);c.yaw=Math.PI;for(let n=0;n<100;n++)c.step(.015,false);key(keys,false);
    const after=c.position,local=buildingLocalPosition(b,after);records.push({case:'top-level shaft W rejection',before,target,after,local,hole});
    assert(local.z<=hole.z0-.35+1e-7,'body stops entirely before the real shaft opening');
    assert(Math.abs(after.y-before.y)<1e-7);assert.equal(c.floor,2);
  });
  records.push({case:'real tread side overhang',side,radius:.35});
});
test('center requiring a .4m upward jump or a .6m drop is still rejected',()=>{
  const b=actual('market-b24'),p=getBuildingFloorPlan(b,1)!,t=p.stairTreads.find(t=>t.id==='up-2')!;
  const rise=buildingWorldPosition(b,{x:(t.rect.x0+t.rect.x1)/2,y:p.y,z:(t.rect.z0+t.rect.z1)/2});
  assert.equal(floorPlanSupport(b,1,rise,0),null);assert.equal(floorPlanSupport(b,1,rise,.35),null);
  const drop={...rise,y:rise.y+1};assert.equal(floorPlanSupport(b,1,drop,0),null);assert.equal(floorPlanSupport(b,1,drop,.35),null);
  records.push({case:'unreachable center surface',rise,drop,riseDifference:.4,dropDifference:-.6,radius:.35});
});
test('actual first upper riser is denied by floor2 permission before any height gain',()=>{
  const b=actual('market-b24');fixture(b,exactFrom,(c,keys)=>{
    key(keys);c.yaw=Math.PI;for(let n=0;n<15;n++)c.step(.015,false);key(keys,false);
    records.push({case:'actual denied upper floor',before:exactFrom,after:c.position,floor:c.floor,blockedAccess:c.blockedAccess});
    assert.deepEqual(c.position,exactFrom);assert.equal(c.floor,1);assert(c.blockedAccess);
  },(_b,f)=>f<2);
});
test('upper solid wall and glass window still block real W',()=>{
  const b=actual('market-b24'),p=getBuildingFloorPlan(b,1)!;
  const back=p.walls.find(w=>w.a[1]===-b.depth/2&&w.b[1]===-b.depth/2&&Math.abs(w.a[0]-w.b[0])>10)!;assert(back);
  const x=-8,start=buildingWorldPosition(b,{x,y:p.y,z:-b.depth/2+1});
  assert(floorPlanSupport(b,1,start,.35));assert(wallPanels(p).some(w=>w.kind==='glass'));
  fixture(b,start,(c,keys)=>{
    key(keys);c.yaw=0;for(let n=0;n<40;n++)c.step(.015,false);key(keys,false);
    const local=buildingLocalPosition(b,c.position);records.push({case:'actual upper closed facade W rejection',start,after:c.position,local});
    assert(local.z>=-b.depth/2+.55-1e-7,'.2m half-wall plus .35m body');assert.equal(c.floor,1);assert(Math.abs(c.position.y-start.y)<1e-7);
  });
});

test('normal W cannot leave a high real tread into the adjacent upper slab soffit',()=>{
  const b=actual('market-b24'),p=getBuildingFloorPlan(b,1)!,t=p.stairTreads.find(t=>t.id==='return-6')!;
  const start=buildingWorldPosition(b,{x:(t.rect.x0+t.rect.x1)/2,y:t.top,z:(t.rect.z0+t.rect.z1)/2});
  assert(floorPlanSupport(b,1,start,.35));
  const underSlab=buildingWorldPosition(b,{x:p.stairHole!.x1+.4,y:t.top,z:(t.rect.z0+t.rect.z1)/2});
  assert(blocksFloorPlanMovement(b,1,start,underSlab,.35,1.72),'real upper slab blocks the head-level move');
  fixture(b,start,(c,keys)=>{
    key(keys);c.yaw=-Math.PI/2;for(let n=0;n<60;n++)c.step(.015,false);key(keys,false);
    const local=buildingLocalPosition(b,c.position);records.push({case:'actual upper slab soffit W rejection',start,after:c.position,local,hole:p.stairHole,tread:t});
    assert(local.x<=p.stairHole!.x1-.35+1e-7,'actual body remains entirely inside the slab hole');
    assert(Math.abs(c.position.y-start.y)<1e-7);assert.equal(c.floor,1);
  });
});
test('rotated actual home clone traverses every floor without motor reset',()=>{
  const original=actual('market-b24'),b={...original,id:'rotation-boundary-home',rotation:Math.PI/2};
  const first=getFloorPlanStairRoute(b,0,1)!;const steps:unknown[]=[];records.push({case:'explicit rotated geometry boundary',rotation:b.rotation,sourceBuildingId:original.id,steps});
  fixture(b,first[0],(c,keys)=>{
    for(let f=0;f<2;f++)walk(c,keys,getFloorPlanStairRoute(b,f,f+1)!,steps);
    assert.equal(c.floor,2);
    for(let f=1;f>=0;f--)walk(c,keys,[...getFloorPlanStairRoute(b,f,f+1)!].reverse(),steps);
    assert.equal(c.floor,0);assert(Math.abs(c.position.y-first[0].y)<1e-7);
  });
});
test('profiled basement boundary clone walks -2→-1→0→1→2 and back with real holes',()=>{
  const original=actual('market-b24'),b={...original,id:'basement-boundary-home',basements:2};
  const first=getFloorPlanStairRoute(b,-2,-1)!;assert.equal(getBuildingFloorPlan(b,-2)!.stairHole,null);assert(getBuildingFloorPlan(b,-1)!.stairHole);
  const steps:unknown[]=[];records.push({case:'explicit basement geometry boundary',basements:2,sourceBuildingId:original.id,steps});
  fixture(b,first[0],(c,keys)=>{
    for(let f=-2;f<2;f++)walk(c,keys,getFloorPlanStairRoute(b,f,f+1)!,steps);
    assert.equal(c.floor,2);
    for(let f=1;f>=-2;f--)walk(c,keys,[...getFloorPlanStairRoute(b,f,f+1)!].reverse(),steps);
    assert.equal(c.floor,-2);assert(Math.abs(c.position.y-first[0].y)<1e-7);
  });
});
