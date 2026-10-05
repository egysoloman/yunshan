import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../src/world';
import { blocksFloorPlanMovement, buildingWorldPosition, floorPlanSupport, getBuildingBody, getFloorPlanRoofRegions, getFloorPlanSlabRegions, wallPanels, type Rect, type StairSurface } from '../src/architecture-floor-plan';

// Public descriptor mutation is a supported input to these geometry queries.
// These CPU fixtures isolate geometry; they do not instantiate Simulation.
const region=(x0=-5,x1=5,z0=-5,z1=5):Rect=>({x0,x1,z0,z1});
function fixture(){
  const source=createWorld(7,'current-v4').buildings.find(b=>b.kind==='home')!;
  const b={...structuredClone(source),width:24,depth:24,height:12,floors:3,basements:1,position:{x:0,y:0,z:0},rotation:.73,floorFootprints:undefined};
  const body=getBuildingBody(b)!;
  for(const p of body.floorPlans){p.y=p.floor*4;p.ceilingY=p.y+4;p.interior=[region()];p.circulation=[];p.courtyard=[];p.stairLanding=region(-4,-3,-4,-3);p.fixtures=[];p.stairTreads=[];p.stairLandings=[];wallPanels(p).splice(0);getFloorPlanSlabRegions(p).splice(0,Infinity,region());}
  getFloorPlanRoofRegions(body).splice(0);
  const p=body.floorPlans.find(f=>f.floor===0)!,upper=body.floorPlans.find(f=>f.floor===1)!;
  const support=(x=0,y=p.y,z=0,radius=.35)=>floorPlanSupport(b,p.floor,buildingWorldPosition(b,{x,y,z}),radius);
  const move=(y=0)=>blocksFloorPlanMovement(b,0,buildingWorldPosition(b,{x:-1,y,z:0}),buildingWorldPosition(b,{x:1,y,z:0}));
  return {b,body,p,upper,support,move};
}

test('live fixture member, rect and height edits change collision and support after priming',()=>{
  const {p,support,move}=fixture();assert(support());assert.equal(move(),false);
  const block={id:'live',kind:'table' as const,rect:region(-.5,.5,-.5,.5),bottom:0,top:1.5};p.fixtures.push(block);
  assert.equal(support(),null);assert.equal(move(),true);
  block.rect.x0=3;block.rect.x1=4;assert(support());assert.equal(move(),false,'nested rect edits are live');
  block.rect=region(-.5,.5,-.5,.5);assert.equal(support(),null);assert.equal(move(),true,'replacing a rect is live');
  block.bottom=2;block.top=3;assert(support());assert.equal(move(),false,'copied heights invalidate');
  p.fixtures=[{...block,bottom:0,top:1.5}];assert.equal(support(),null);assert.equal(move(),true);
  p.fixtures.splice(0);assert(support());assert.equal(move(),false,'same array removal invalidates');
});

test('returned wall panel mutations are live while raw wall cache lifetime stays unchanged',()=>{
  const {p,support,move}=fixture(),panels=wallPanels(p);assert(support());assert.equal(move(),false);
  panels.push({rect:region(-.5,.5,-.5,.5),bottom:0,top:1.5,kind:'solid'});assert.equal(support(),null);assert.equal(move(),true);
  panels[0].rect.z0=3;panels[0].rect.z1=4;assert(support());assert.equal(move(),false);
  panels[0].rect=region(-.5,.5,-.5,.5);panels[0].bottom=2;panels[0].top=3;assert(support());assert.equal(move(),false);
  panels[0]={rect:region(-.5,.5,-.5,.5),bottom:0,top:1.5,kind:'glass'};assert.equal(support(),null);assert.equal(move(),true);
  panels.splice(0);p.walls=[{a:[-.5,0],b:[.5,0],height:2,thickness:1}];assert.strictEqual(wallPanels(p),panels);assert.equal(move(),false,'raw walls do not silently rebuild the existing panel cache');
  const cold=fixture();cold.body.floorPlans=structuredClone(cold.body.floorPlans);for(const f of cold.body.floorPlans){f.walls=[];f.stairHole=null;}
  const coldPlan=cold.body.floorPlans.find(f=>f.floor===0)!,coldUpper=cold.body.floorPlans.find(f=>f.floor===1)!,feet=buildingWorldPosition(cold.b,{x:0,y:0,z:0});
  assert(floorPlanSupport(cold.b,0,feet,0));coldPlan.walls.push({a:[-1,0],b:[1,0],height:2,thickness:1});coldUpper.interior=[region(-5,.2)];
  assert.equal(wallPanels(coldPlan).length,0,'a cold radius-zero read primes the existing panel lifetime');assert.equal(getFloorPlanSlabRegions(coldUpper)[0].x1,5,'a cold radius-zero read also primes the original upper slab lifetime');assert(floorPlanSupport(cold.b,0,feet));
});

test('support footprint boundaries follow nested returned slab edits and preserve radius zero and old slab lifetime',()=>{
  const {p,support}=fixture(),base=getFloorPlanSlabRegions(p);assert(support());
  base[0].x1=.2;assert.equal(support(),null,'a .35 disk cannot hang over the live .2 edge');assert(support(0,0,0,0),'radius zero retains its center-only branch');
  base[0]=region();assert(support(),'replacing a region invalidates its old boundaries');
  p.y=.2;assert(support(0,.2));assert(support(1,.2,1,.2),'position and radius are evaluated again at an unchanged footprint');p.y=0;assert(support());
  base.push(region(10,11,10,11));assert(support());delete base[1];assert.throws(()=>support());assert(support(0,0,0,0),'zero radius does not eagerly derive invalid hole boundaries');
  base.splice(1);p.interior[0].x0=10;p.interior[0].x1=20;p.stairHole=region(-1,1,-1,1);assert.strictEqual(getFloorPlanSlabRegions(p),base);assert(support(),'raw slab sources retain the existing slab cache lifetime');
});

test('live upper slab height, region and floor list membership preserve head clearance',()=>{
  const {body,upper,support,move}=fixture();assert(support());assert.equal(move(),false);
  upper.y=1;assert.equal(support(),null);assert.equal(move(),true,'real overhead slab blocks the 1.72 body');
  const slabs=getFloorPlanSlabRegions(upper);slabs[0].x0=3;slabs[0].x1=4;assert(support());assert.equal(move(),false);
  slabs[0]=region();assert.equal(support(),null);upper.floor=10;assert(support());assert.equal(move(),false,'nested floor changes remove far plans');
  upper.floor=1;assert.equal(support(),null);body.floorPlans=body.floorPlans.filter(p=>p!==upper);assert(support());
  body.floorPlans.push(upper);assert.equal(support(),null);body.floorPlans.reverse();assert.equal(support(),null);body.floorPlans.sort((a,b)=>a.floor-b.floor);delete body.floorPlans[body.floorPlans.indexOf(upper)];assert(support(),'the original filter skips sparse floor plan slots after the queried floor');
});

test('live tread and landing edits preserve exact rise, descent, full disk and head obstacle checks',()=>{
  const {p,support}=fixture();getFloorPlanSlabRegions(p).splice(0,Infinity,region(-5,-.2),region(.2,5));
  const stair:StairSurface={id:'live-step',rect:region(-1,1,-1,1),bottom:0,top:.2,fromFloor:0,toFloor:1,kind:'tread'};p.stairTreads.push(stair);
  assert.equal(support(0,0)?.kind,'stairs');assert.equal(support(0,.6)?.kind,'stairs');assert.equal(support(0,.6200002),null,'-.42 and eps remain exact');
  stair.top=.2200002;assert.equal(support(0,0),null,'+.22 and eps remain exact');stair.top=.2;
  stair.rect.x1=0;assert.equal(support(0,0),null,'the full .35 footprint is required across a real .2-lattice gap');assert(support(0,0,0,0));stair.rect=region(-1,1,-1,1);assert(support(0,0));
  p.stairTreads=[];assert.equal(support(0,0),null);p.stairLandings=[{...stair,kind:'landing'}];assert(support(0,0),'landing membership is also live');
  p.fixtures=[{id:'head',kind:'shelf',rect:region(-.5,.5,-.5,.5),bottom:1.5,top:2}];assert.equal(support(0,0),null,'real head obstacles still reject the stair choice');
});
