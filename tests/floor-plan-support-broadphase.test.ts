import assert from 'node:assert/strict';
import test from 'node:test';
import { buildingWorldPosition, floorPlanSupport, getBuildingBody, getFloorPlanSlabRegions, wallPanels, type Rect } from '../src/architecture-floor-plan';
import type { Building } from '../src/types';

function fixture(){
  const b:Building={id:'support-live-bounds',districtId:'test',name:'test',kind:'home',floorPlanProfile:'v4-program-bodies-02',position:{x:0,y:0,z:0},width:24,depth:24,height:12,floors:3,basements:1,rotation:0,door:{x:0,y:0,z:0},capacity:1,seed:7};
  const body=getBuildingBody(b)!;
  for(const p of body.floorPlans){p.y=p.floor*4;p.interior=[{x0:-5,x1:5,z0:-5,z1:5}];p.circulation=[];p.courtyard=[];p.stairLanding={x0:-4,x1:-3,z0:-4,z1:-3};p.fixtures=[];p.stairTreads=[];p.stairLandings=[];wallPanels(p).splice(0);getFloorPlanSlabRegions(p).splice(0,Infinity,{x0:-5,x1:5,z0:-5,z1:5});}
  const p=body.floorPlans.find(p=>p.floor===0)!;
  const item={id:'live',kind:'table' as const,rect:{x0:3,x1:4,z0:3,z1:4},bottom:0,top:1.5};p.fixtures.push(item);
  const support=(x=0,z=0,r=.35)=>floorPlanSupport(b,0,buildingWorldPosition(b,{x,y:0,z}),r);
  return {p,item,support};
}

// The original full-circle distance, including its behavior for reversed and
// nonfinite rectangle coordinates. The query must retain that exact result.
const distance=(x:number,z:number,r:Rect)=>Math.max(r.x0-x,0,x-r.x1)**2+Math.max(r.z0-z,0,z-r.z1)**2;
test('support collision retains original full-disk outcomes at corners, tangencies and malformed rectangles',()=>{
  const {item,support}=fixture();
  const rects:Rect[]=[
    {x0:3,x1:4,z0:3,z1:4},{x0:-.5,x1:.5,z0:-.5,z1:.5},
    {x0:.35,x1:1,z0:-.1,z1:.1},{x0:.2,x1:1,z0:.2,z1:1},
    {x0:1,x1:-1,z0:-.5,z1:.5},{x0:-.5,x1:.5,z0:1,z1:-1},
    {x0:NaN,x1:1,z0:-1,z1:1},{x0:-1,x1:NaN,z0:-1,z1:1},
    {x0:Infinity,x1:Infinity,z0:-1,z1:1},{x0:-Infinity,x1:Infinity,z0:-1,z1:1},
    {x0:-1,x1:1,z0:-Infinity,z1:Infinity},
  ];
  for(const rect of rects)for(const x of [-1,0,.25,1])for(const z of [-1,0,.25,1])for(const radius of [.001,.35,1]){
    Object.assign(item.rect,rect);
    const blocked=distance(x,z,item.rect)<radius*radius-1e-7;
    assert.equal(support(x,z,radius)===null,blocked,JSON.stringify({rect,x,z,radius}));
  }
});

test('moving and replacing a distant live solid immediately updates support without trusting stored plan broadphase',()=>{
  const {p,item,support}=fixture();assert(support());
  Object.assign(item.rect,{x0:-.5,x1:.5,z0:-.5,z1:.5});assert.equal(support(),null);
  item.rect={x0:3,x1:4,z0:3,z1:4};assert(support());
  p.broadphase={x0:100,x1:101,z0:100,z1:101};
  item.rect={x0:-.5,x1:.5,z0:-.5,z1:.5};assert.equal(support(),null,'the unrelated public broadphase cannot hide a live wall/fixture');
  p.fixtures.splice(0);assert(support());
});

test('support rejection reads each public rectangle coordinate in the original order and count',()=>{
  const {item,support}=fixture(),reads:string[]=[];
  for(const [key,value] of Object.entries({x0:-.5,x1:.5,z0:-.5,z1:.5}))Object.defineProperty(item.rect,key,{get(){reads.push(key);return value;},configurable:true});
  assert.equal(support(),null);
  assert.deepEqual(reads,['x0','x1','z0','z1','x0','x1','z0','z1']);
});
