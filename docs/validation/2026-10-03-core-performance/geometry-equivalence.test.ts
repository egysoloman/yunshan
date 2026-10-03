import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import type { Building, Vec3 } from '../src/types';
import type { Rect } from '../src/architecture-floor-plan';

// The unmodified source is a distinct module path with its own private caches.
// No formula, route implementation or assertion is substituted in this oracle.
const before=await import('./before/architecture-floor-plan.ts');
const after=await import('../src/architecture-floor-plan.ts');
type Geometry=typeof after;
const region=(x0=-5,x1=5,z0=-5,z1=5):Rect=>({x0,x1,z0,z1});
function fixture(g:Geometry) {
  const b:Building={id:'equivalence',districtId:'test',name:'test',kind:'home',floorPlanProfile:'v4-program-bodies-02',position:{x:123.4,y:-4,z:456.8},width:24,depth:24,height:12,floors:3,basements:1,rotation:.73,door:{x:0,y:0,z:0},capacity:1,seed:7};
  const body=g.getBuildingBody(b)!;body.floorPlans=structuredClone(body.floorPlans);
  for(const p of body.floorPlans) {
    p.y=p.floor*4;p.ceilingY=p.y+4;p.interior=[region()];p.circulation=[];p.courtyard=[];p.stairHole=null;p.stairLanding=region(-4,-3,-4,-3);
    p.fixtures=[];p.walls=[];p.stairTreads=[];p.stairLandings=[];
  }
  g.getFloorPlanRoofRegions(body).splice(0);
  const p=body.floorPlans.find(p=>p.floor===0)!,upper=body.floorPlans.find(p=>p.floor===1)!;
  const world=(x:number,y=p.y,z=0)=>g.buildingWorldPosition(b,{x,y,z});
  const support=(x=0,y=p.y,z=0,radius=.35)=>g.floorPlanSupport(b,p.floor,world(x,y,z),radius);
  return {g,b,body,p,upper,world,support};
}

test('frozen before and candidate agree exactly for actual building families, floors, supports and routes',()=>{
  const world=createWorld(7,'current-v4'),byKind=new Map<Building['kind'],Building>();
  for(const b of world.buildings)if(!byKind.has(b.kind))byKind.set(b.kind,b);
  let supportQueries=0,routeQueries=0,supported=0,routed=0,empty=0;
  for(const source of byKind.values()) {
    const left=structuredClone(source),right=structuredClone(source),oldBody=before.getBuildingBody(left),newBody=after.getBuildingBody(right);
    assert.deepEqual(newBody,oldBody,`${source.kind}/body`);
    if(!oldBody) {
      assert.deepEqual(after.floorPlanSupport(right,0,right.door),before.floorPlanSupport(left,0,left.door));
      assert.deepEqual(after.findFloorPlanRoute(right,0,right.door,right.position),before.findFloorPlanRoute(left,0,left.door,left.position));continue;
    }
    const floors=[...new Set([oldBody.floorPlans[0].floor,0,oldBody.floorPlans.at(-1)!.floor])];
    for(const floor of floors) {
      const p=before.getBuildingFloorPlan(left,floor)!;
      const use=before.getBuildingUsePoints(left,floor)[0]?.position??before.getFloorPlanStairPosition(left,floor),stair=before.getFloorPlanStairPosition(left,floor);
      const outside=before.buildingWorldPosition(left,{x:p.broadphase.x1+2,y:p.y,z:p.broadphase.z1+2});
      const shaft=before.buildingWorldPosition(left,{x:p.stair.x,y:p.y,z:p.stair.z+2});
      const endpoints=[use,stair,outside,shaft,...(floor===0?[before.getBuildingEntrance(left)]:[])];
      for(const radius of [0,.35,-.35]) {
        for(const point of endpoints)for(const dy of [0,.2,.4200002]) {
          const at={...point,y:point.y+dy},old=before.floorPlanSupport(left,floor,at,radius),actual=after.floorPlanSupport(right,floor,at,radius);
          assert.deepEqual(actual,old,`${source.kind}/${floor}/support/${radius}/${dy}/${JSON.stringify(point)}`);
          supportQueries++;if(old)supported++;else empty++;
        }
        for(const target of endpoints) {
          const old=before.findFloorPlanRoute(left,floor,use,target,radius),actual=after.findFloorPlanRoute(right,floor,use,target,radius);
          assert.deepEqual(actual,old,`${source.kind}/${floor}/route/${radius}/${JSON.stringify(target)}`);routeQueries++;if(old)routed++;
        }
      }
    }
  }
  assert(supported>0&&empty>0&&routed>0);
  console.log(JSON.stringify({supportQueries,routeQueries,supported,empty,routed}));
});

test('empty reads followed by live valid descriptor edits agree with frozen before',()=>{
  const left=fixture(before),right=fixture(after),pair=[left,right];
  const check=(label:string)=>{
    for(const [x,y,z,radius] of [[8,0,0,.35],[0,0,0,.35],[0,0,0,0],[0,0,0,-.35],[0,.2,0,.35],[.1,0,.1,.35]]) {
      assert.deepEqual(right.support(x,y,z,radius),left.support(x,y,z,radius),`${label}/support/${x}/${y}/${z}/${radius}`);
    }
    for(const radius of [0,.35,-.35])for(const eye of [0,1.72,3]) {
      assert.equal(after.blocksFloorPlanMovement(right.b,0,right.world(-1),right.world(1),radius,eye),before.blocksFloorPlanMovement(left.b,0,left.world(-1),left.world(1),radius,eye),`${label}/movement/${radius}/${eye}`);
    }
    const from:Vec3=left.world(-2),to:Vec3=left.world(2);
    assert.deepEqual(after.findFloorPlanRoute(right.b,0,from,to),before.findFloorPlanRoute(left.b,0,from,to),`${label}/route`);
  };
  check('prime');
  const edits:{label:string;apply:(f:ReturnType<typeof fixture>)=>void}[]=[
    {label:'fixture add',apply:f=>{f.p.fixtures.push({id:'live',kind:'table',rect:region(-.5,.5,-.5,.5),bottom:0,top:1.5});}},
    {label:'fixture nested rect',apply:f=>{f.p.fixtures[0].rect.x0=3;f.p.fixtures[0].rect.x1=4;}},
    {label:'fixture rect replacement',apply:f=>{f.p.fixtures[0].rect=region(-.5,.5,-.5,.5);}},
    {label:'fixture heights',apply:f=>{f.p.fixtures[0].bottom=2;f.p.fixtures[0].top=3;}},
    {label:'fixture array replacement',apply:f=>{f.p.fixtures=[{...f.p.fixtures[0],bottom:0,top:1.5}];}},
    {label:'fixture removal',apply:f=>{f.p.fixtures.splice(0);}},
    {label:'returned panel membership',apply:f=>{f.g.wallPanels(f.p).push({rect:region(-.5,.5,-.5,.5),bottom:0,top:1.5,kind:'glass'});}},
    {label:'returned panel nested rect',apply:f=>{f.g.wallPanels(f.p)[0].rect.z0=3;f.g.wallPanels(f.p)[0].rect.z1=4;}},
    {label:'returned panel replacement',apply:f=>{f.g.wallPanels(f.p)[0]={rect:region(-.5,.5,-.5,.5),bottom:2,top:3,kind:'solid'};}},
    {label:'returned panel removal',apply:f=>{f.g.wallPanels(f.p).splice(0);}},
    {label:'upper height',apply:f=>{f.upper.y=1;}},
    {label:'upper slab nested rect',apply:f=>{const r=f.g.getFloorPlanSlabRegions(f.upper)[0];r.x0=3;r.x1=4;}},
    {label:'upper slab member replacement',apply:f=>{f.g.getFloorPlanSlabRegions(f.upper)[0]=region();}},
    {label:'upper floor number',apply:f=>{f.upper.floor=10;}},
    {label:'upper membership removal',apply:f=>{f.upper.floor=1;f.body.floorPlans=f.body.floorPlans.filter(p=>p!==f.upper);}},
    {label:'upper membership restore',apply:f=>{f.body.floorPlans.push(f.upper);}},
    {label:'upper height restore',apply:f=>{f.upper.y=4;}},
    {label:'base slab nested rect',apply:f=>{f.g.getFloorPlanSlabRegions(f.p)[0].x1=.2;}},
    {label:'base slab member replacement',apply:f=>{f.g.getFloorPlanSlabRegions(f.p)[0]=region();}},
    {label:'base slab member addition',apply:f=>{f.g.getFloorPlanSlabRegions(f.p).push(region(10,11,10,11));}},
    {label:'base slab member removal',apply:f=>{f.g.getFloorPlanSlabRegions(f.p).splice(1);}},
  ];
  for(const edit of edits) {
    for(const f of pair)edit.apply(f);
    assert.deepEqual(right.support(8),left.support(8),`${edit.label}/empty first`);check(edit.label);
  }
});

test('cold empty support preserves before cache-priming order and later raw-source cache lifetime',()=>{
  const run=(g:Geometry,radius:number)=>{
    const f=fixture(g),reads:string[]=[];
    for(const p of f.body.floorPlans.filter(p=>Math.abs(p.floor)<=1)) {
      const walls=p.walls;Object.defineProperty(p,'walls',{get:()=>{reads.push(`wall:${p.floor}`);return walls;},configurable:true});
    }
    const interior=f.upper.interior;Object.defineProperty(f.upper,'interior',{get:()=>{reads.push('slab:1');return interior;},configurable:true});
    const result=f.support(8,0,0,radius);
    for(const p of f.body.floorPlans)Object.defineProperty(p,'walls',{value:[{a:[-1,0],b:[1,0],height:2,thickness:1}],writable:true,configurable:true});
    Object.defineProperty(f.upper,'interior',{value:[region(-5,.2)],writable:true,configurable:true});
    return {result,reads,panels:f.body.floorPlans.filter(p=>Math.abs(p.floor)<=1).map(p=>g.wallPanels(p)),slabs:g.getFloorPlanSlabRegions(f.upper)};
  };
  for(const radius of [.35,0,-.35,Number.NaN,Number.POSITIVE_INFINITY])assert.deepEqual(run(after,radius),run(before,radius));
});
