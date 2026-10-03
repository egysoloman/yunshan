import assert from 'node:assert/strict';
import test from 'node:test';
import { buildingWorldPosition, floorPlanSupport, getBuildingBody, getFloorPlanSlabRegions, wallPanels, type Rect } from '../src/architecture-floor-plan';
import type { Building } from '../src/types';

const region=(x0=-5,x1=5,z0=-5,z1=5):Rect=>({x0,x1,z0,z1});
function fixture() {
  const b:Building={id:'empty-support',districtId:'test',name:'test',kind:'home',floorPlanProfile:'v4-program-bodies-02',position:{x:123.4,y:-4,z:456.8},width:24,depth:24,height:12,floors:3,basements:1,rotation:.73,door:{x:0,y:0,z:0},capacity:1,seed:7};
  const body=getBuildingBody(b)!;
  // Use cold descriptors rather than the caches populated during makeBody.
  body.floorPlans=structuredClone(body.floorPlans);
  for(const p of body.floorPlans) {
    p.y=p.floor*4;p.ceilingY=p.y+4;p.interior=[region()];p.circulation=[];p.courtyard=[];p.stairHole=null;p.stairLanding=region(-4,-3,-4,-3);
    p.fixtures=[];p.walls=[];p.stairTreads=[];p.stairLandings=[];
  }
  const p=body.floorPlans.find(p=>p.floor===0)!,upper=body.floorPlans.find(p=>p.floor===1)!;
  const support=(x=0,y=p.y,z=0,radius=.35)=>floorPlanSupport(b,p.floor,buildingWorldPosition(b,{x,y,z}),radius);
  return {b,body,p,upper,support};
}

test('empty positive-radius support preserves cold wall-all then upper-slab priming',()=>{
  const {body,p,upper,support}=fixture(),reads:string[]=[];
  for(const f of body.floorPlans.filter(f=>Math.abs(f.floor-p.floor)<=1)) {
    const walls=f.walls;Object.defineProperty(f,'walls',{get:()=>{reads.push(`walls:${f.floor}`);return walls;},configurable:true});
  }
  const interior=upper.interior;Object.defineProperty(upper,'interior',{get:()=>{reads.push('slab:1');return interior;},configurable:true});
  assert.equal(support(8),null);
  assert.deepEqual(reads,['walls:-1','walls:0','walls:1','slab:1']);
  for(const f of body.floorPlans.filter(f=>Math.abs(f.floor-p.floor)<=1)) {
    Object.defineProperty(f,'walls',{value:[{a:[-1,0],b:[1,0],height:2,thickness:1}],writable:true,configurable:true});
    assert.equal(wallPanels(f).length,0,'empty support still primes the existing raw-wall cache lifetime');
  }
  Object.defineProperty(upper,'interior',{value:[region(-5,.2)],writable:true,configurable:true});
  assert.equal(getFloorPlanSlabRegions(upper)[0].x1,5,'upper raw slab sources retain their existing cache lifetime');
});

test('empty nonpositive and nonfinite radii retain the existing descriptor priming',()=>{
  for(const radius of [0,-.35,Number.NaN,Number.POSITIVE_INFINITY]) {
    const {body,upper,support}=fixture();assert.equal(support(8,0,0,radius),null);
    for(const f of body.floorPlans.filter(f=>Math.abs(f.floor)<=1)) {
      f.walls.push({a:[-1,0],b:[1,0],height:2,thickness:1});assert.equal(wallPanels(f).length,0);
    }
    upper.interior=[region(-5,.2)];assert.equal(getFloorPlanSlabRegions(upper)[0].x1,5);
  }
});

test('an empty read cannot hide later fixture, panel, upper slab, height or membership edits',()=>{
  const {body,p,upper,support}=fixture(),empty=()=>assert.equal(support(8),null);
  assert(support());empty();
  const block={id:'live',kind:'table' as const,rect:region(-.5,.5,-.5,.5),bottom:0,top:1.5};p.fixtures.push(block);assert.equal(support(),null);
  empty();block.rect.x0=3;block.rect.x1=4;assert(support());
  empty();block.rect=region(-.5,.5,-.5,.5);assert.equal(support(),null);
  empty();block.bottom=2;block.top=3;assert(support());
  empty();p.fixtures.splice(0);const panels=wallPanels(p);panels.push({rect:region(-.5,.5,-.5,.5),bottom:0,top:1.5,kind:'glass'});assert.equal(support(),null);
  empty();panels.splice(0);upper.y=1;assert.equal(support(),null);
  empty();const slabs=getFloorPlanSlabRegions(upper);slabs[0].x0=3;slabs[0].x1=4;assert(support());
  empty();slabs[0]=region();assert.equal(support(),null);
  empty();upper.floor=10;assert(support());
  empty();upper.floor=1;body.floorPlans=body.floorPlans.filter(f=>f!==upper);assert(support());
  empty();body.floorPlans.push(upper);assert.equal(support(),null);
  empty();upper.y=4;assert(support());
});

test('empty positive-radius reads preserve malformed neighbor member throws',()=>{
  for(const warm of [false,true])for(const target of ['fixtures','panels'] as const)for(const member of [null,undefined,'hole']) {
    const {upper,support}=fixture();if(warm)assert(support());
    const members=target==='fixtures'?upper.fixtures:wallPanels(upper);
    members.length=1;if(member!=='hole')members[0]=member as unknown as (typeof members)[number];
    assert.throws(()=>support(8),TypeError,`${warm}/${target}/${member}`);
    assert.equal(support(8,0,0,0),null,'the original radius-zero branch does not inspect neighboring members');
    members.splice(0);assert(support(),'repairing the same public array is visible on the next valid read');
  }
});
