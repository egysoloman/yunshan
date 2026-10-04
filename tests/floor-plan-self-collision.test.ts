import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import {
  blocksFloorPlanMovement, buildingLocalPosition, buildingWorldPosition,
  canStandInFloorPlan, containsUnion, floorPlanSupport, getBuildingBody,
  getBuildingEntrance, getBuildingFloorPlan, getBuildingUsePoints,
  getFloorPlanRoofRegions, getFloorPlanSlabRegions, getFloorPlanStairRoute,
  wallPanels, type Rect,
} from '../src/architecture-floor-plan';
import type { Vec3 } from '../src/types';

const world=createWorld(20261001,'current-v6');
const home=world.buildings.find(b=>b.id==='market-b18')!;
const radius=.35,eyeHeight=1.72;
const region=(x0:number,x1:number,z0:number,z1:number):Rect=>({x0,x1,z0,z1});

/** Isolate one real public descriptor's solid geometry. No Simulation runs,
 * no city geometry is changed, and the production body radius stays .35m. */
function solidFixture(rotation=0) {
  const b=structuredClone(home);b.rotation=rotation;
  const body=getBuildingBody(b)!,p=body.floorPlans.find(p=>p.floor===0)!;
  body.floorPlans=[p];p.interior=[region(-5,5,-5,5)];p.circulation=[];p.courtyard=[];
  p.stairHole=null;p.stairTreads=[];p.stairLandings=[];
  p.stairLanding=region(-4,-3,-4,-3);p.fixtures=[{id:'isolated-table',kind:'table',rect:region(0,1,0,1),bottom:0,top:1.5}];
  wallPanels(p).splice(0);getFloorPlanSlabRegions(p).splice(0,Infinity,region(-5,5,-5,5));getFloorPlanRoofRegions(body).splice(0);
  const pose=(x:number,z:number,y=p.y)=>buildingWorldPosition(b,{x,y,z});
  const blocked=(a:Vec3,z=a,r=radius,height=eyeHeight)=>blocksFloorPlanMovement(b,p.floor,a,z,r,height);
  return {b,p,pose,blocked};
}

test('native v6 wall-adjacent self query agrees with short motion and full-body stance rejection',()=>{
  const before=JSON.stringify(world),bodyBefore=JSON.stringify(getBuildingBody(home)),p=getBuildingFloorPlan(home,0)!;
  const panel=wallPanels(p)[0];assert.deepEqual(panel.rect,{x0:-17.4,x1:-15.8,z0:-14.6,z1:-14.2});
  const local={x:panel.rect.x1+.2,y:p.y,z:panel.rect.z1+.2},point=buildingWorldPosition(home,local);
  assert(containsUnion(getFloorPlanSlabRegions(p),local.x,local.z),'the centre has actual slab support');
  assert.equal(canStandInFloorPlan(p,local.x,local.z,0),true,'a radius-zero centre is outside the wall');
  assert.equal(canStandInFloorPlan(p,local.x,local.z,radius),false,'the unchanged .35m body overlaps the wall');
  assert.equal(floorPlanSupport(home,0,point,radius),null);
  const nearby=buildingWorldPosition(home,{...local,x:local.x+.001});
  assert.equal(blocksFloorPlanMovement(home,0,point,nearby,radius,eyeHeight),true);
  assert.equal(blocksFloorPlanMovement(home,0,point,point,radius,eyeHeight),true,'a stationary body cannot evade the same wall');
  assert.equal(JSON.stringify(world),before);assert.equal(JSON.stringify(getBuildingBody(home)),bodyBefore);
});

test('stationary .35m disk detects every outside corner and side of a real solid',()=>{
  for(const rotation of [0,.73,-.61]) {
    const {b,p,pose,blocked}=solidFixture(rotation);
    for(const [sx,sz] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const x=(sx<0?0:1)+sx*.2,z=(sz<0?0:1)+sz*.2,point=pose(x,z);
      assert.equal(blocked(point),true,`${rotation}/${sx}/${sz}: .2828m corner gap is inside .35m`);
      assert.equal(floorPlanSupport(b,p.floor,point,radius),null);
      assert.equal(blocked(point,point,.25),false,'the smaller disk stays outside the same corner');
      assert.equal(blocked(point,point,0),false,'radius zero retains centre-only collision');
      const clear=pose((sx<0?0:1)+sx*.3,(sz<0?0:1)+sz*.3);
      assert.equal(blocked(clear),false);assert(floorPlanSupport(b,p.floor,clear,radius));
    }
    for(const [x,z] of [[-.2,.5],[1.2,.5],[.5,-.2],[.5,1.2]])assert.equal(blocked(pose(x,z)),true,'every side uses the full body disk');
    assert.equal(blocked(pose(.5,.5),pose(.5,.5),0),true,'a centre inside a solid is always blocked');
  }
});

test('stationary radius threshold keeps the original tolerance without an epsilon-length shortcut',()=>{
  const {pose,blocked}=solidFixture();
  assert.equal(blocked(pose(1.349,.5)),true);
  assert.equal(blocked(pose(1.35,.5)),false,'exact tangency retains the existing radius-squared tolerance');
  assert.equal(blocked(pose(1.351,.5)),false);
  for(const delta of [1e-4,1e-6,1e-8]) {
    const inside=pose(1.2,1.2),short=pose(1.2+delta,1.2);
    assert.equal(blocked(inside,short),true);assert.equal(blocked(short,inside),true);
    const outside=pose(1.3,1.3),clear=pose(1.3+delta,1.3);
    assert.equal(blocked(outside,clear),false);assert.equal(blocked(clear,outside),false);
  }
});

test('zero horizontal displacement still respects actual feet and head clearances',()=>{
  const {p,pose,blocked}=solidFixture(),beside=pose(1.2,.5);
  assert.equal(blocked(beside,pose(1.2,.5,p.y+.1)),true,'vertical-only motion has a point footprint');
  const top=pose(1.2,.5,p.y+1.5);assert.equal(blocked(top),false,'a body already above the solid is not blocked');
  p.fixtures[0].bottom=1.6;p.fixtures[0].top=2;
  assert.equal(blocked(beside,beside,radius,1.5),false,'an obstacle above the actual head is clear');
  assert.equal(blocked(beside,beside,radius,eyeHeight),true,'the unchanged 1.72m body reaches the overhead obstacle');
});

test('ordinary sweeps retain intersection, corner projection, reversal and clear-path results',()=>{
  const {pose,blocked}=solidFixture(.73);
  const crossing=[pose(-1,.5),pose(2,.5)],glancing=[pose(1.1,1.3),pose(1.3,1.1)],clear=[pose(1.5,1.5),pose(2,2)];
  assert.equal(blocked(crossing[0],crossing[1]),true);assert.equal(blocked(crossing[1],crossing[0]),true);
  assert.equal(blocked(glancing[0],glancing[1],.3),true,'the projected corner gap .2828m is less than .3m even though both endpoint gaps exceed .3m');
  assert.equal(blocked(glancing[1],glancing[0],.3),true);
  assert.equal(blocked(glancing[0],glancing[1],.28),false);
  assert.equal(blocked(clear[0],clear[1]),false);assert.equal(blocked(clear[1],clear[0]),false);
});

test('native open door remains clear while a glass centre remains solid',()=>{
  const b=world.buildings.find(b=>b.kind==='market')!,p=getBuildingFloorPlan(b,0)!,entrance=getBuildingEntrance(b),door=buildingLocalPosition(b,entrance);
  assert.equal(blocksFloorPlanMovement(b,0,entrance,entrance,radius,eyeHeight),false);
  assert.equal(blocksFloorPlanMovement(b,0,buildingWorldPosition(b,{...door,z:door.z+.5}),buildingWorldPosition(b,{...door,z:door.z-.5}),radius,eyeHeight),false);
  const pane=wallPanels(p).find(w=>w.kind==='glass'&&w.bottom<eyeHeight&&w.top>.05)!;assert(pane);
  const point=buildingWorldPosition(b,{x:(pane.rect.x0+pane.rect.x1)/2,y:p.y,z:(pane.rect.z0+pane.rect.z1)/2});
  assert.equal(blocksFloorPlanMovement(b,0,point,point,radius,eyeHeight),true);
});

test('native service and work stances keep actual full-body support and self clearance',()=>{
  let checked=0;
  for(const kind of ['home','market','workshop','hall','school','clinic','bank','station'] as const) {
    const b=world.buildings.find(b=>b.kind===kind)!;
    for(const floor of [0,Math.min(1,b.floors-1)])for(const point of getBuildingUsePoints(b,floor)) {
      const support=floorPlanSupport(b,floor,point.position,radius);assert(support,`${b.id}/${point.id}`);
      assert.equal(blocksFloorPlanMovement(b,floor,point.position,point.position,radius,eyeHeight),false,`${b.id}/${point.id}`);checked++;
    }
  }
  assert(checked>=24);
});

test('native continuous staircase actual support-height stances remain clear through both flights and landing',()=>{
  const route=getFloorPlanStairRoute(home,0,1)!;assert(route);let checked=0,stairs=0;
  for(let i=1;i<route.length;i++) {
    const a=route[i-1],z=route[i],steps=Math.max(1,Math.ceil(Math.hypot(a.x-z.x,a.y-z.y,a.z-z.z)/.05));
    for(let j=0;j<=steps;j++) {
      const t=j/steps,reference={x:a.x+(z.x-a.x)*t,y:a.y+(z.y-a.y)*t,z:a.z+(z.z-a.z)*t};
      const support=[0,1].map(floor=>floorPlanSupport(home,floor,reference,radius)).find(s=>s&&Math.abs(s.y-reference.y)<=.22000001);assert(support,'a real nearby tread or slab must support the full disk');
      const feet={...reference,y:support.y};
      assert.equal(blocksFloorPlanMovement(home,support.floor,feet,feet,radius,eyeHeight),false,'test actual tread-height feet rather than a sloping waypoint reference');
      checked++;if(support.kind==='stairs')stairs++;
    }
  }
  assert(checked>100&&stairs>100,'both real stair flights and their landing were sampled');
});
