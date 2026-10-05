import assert from 'node:assert/strict';
import test from 'node:test';
import { boundaryLoops, getBuildingBody, getBuildingFloorPlan, type Rect } from '../src/architecture-floor-plan';
import type { Building } from '../src/types';
function fixture(){
  const b:Building={id:'selection',districtId:'test',name:'test',kind:'home',floorPlanProfile:'v4-program-bodies-02',position:{x:0,y:0,z:0},width:24,depth:24,height:12,floors:3,basements:1,rotation:0,door:{x:0,y:0,z:0},capacity:1,seed:7};
  return {b,body:getBuildingBody(b)!};
}
test('floor selection retains first-match order after public duplicate, nested edit, replacement and removal',()=>{
  const {b,body}=fixture(),first=body.floorPlans[0],ground=getBuildingFloorPlan(b,0)!;
  assert.strictEqual(ground,body.floorPlans.find(p=>p.floor===0));
  first.floor=0;assert.strictEqual(getBuildingFloorPlan(b,0),first);
  body.floorPlans.reverse();assert.strictEqual(getBuildingFloorPlan(b,0),ground);
  body.floorPlans=body.floorPlans.filter(p=>p.floor!==0);assert.equal(getBuildingFloorPlan(b,0),null);
  body.floorPlans.push(ground);assert.strictEqual(getBuildingFloorPlan(b,0),ground);
});
test('floor selection retains Array.find sparse visits and captured-length behavior',()=>{
  const {b,body}=fixture(),ground=getBuildingFloorPlan(b,0)!;
  body.floorPlans=[ground];body.floorPlans.length=2;assert.strictEqual(getBuildingFloorPlan(b,0),ground,'an earlier match does not visit a later sparse slot');
  assert.throws(()=>getBuildingFloorPlan(b,20),TypeError,'find does visit a missing slot before a match');
  const first=structuredClone(ground);Object.defineProperty(first,'floor',{get(){body.floorPlans.length=1;return -1;},configurable:true});
  body.floorPlans=[first,ground];assert.throws(()=>getBuildingFloorPlan(b,0),TypeError,'length captured before a descriptor getter shortened its collection');
});
test('rectangle union boundaries preserve exact edge order, holes, fresh mutable coordinates and invalid geometry rejection',()=>{
  const r:Rect={x0:-2,x1:2,z0:-2,z1:2},hole:Rect={x0:-1,x1:1,z0:-1,z1:1};
  assert.deepEqual(boundaryLoops([r],[hole]),[[[-2,-2],[2,-2],[2,2],[-2,2]],[[-1,-1],[-1,1],[1,1],[1,-1]]]);
  r.x1=3;assert.deepEqual(boundaryLoops([r]),[[[-2,-2],[3,-2],[3,2],[-2,2]]]);
  r.x1=-3;assert.throws(()=>boundaryLoops([r]),/invalid region/);
  r.x1=NaN;assert.throws(()=>boundaryLoops([r]),/invalid region/);
  r.x1=3;
  assert.throws(()=>boundaryLoops([r,...Array<Rect>(1)]),TypeError);
  assert.deepEqual(boundaryLoops([]),[]);
});

test('boundary occupancy retains the repeated-read path for public coordinate accessors',()=>{
  let reads=0;
  const r={get x0(){reads++;return -2;},x1:2,z0:-2,z1:2},hole={x0:-1,x1:1,z0:-1,z1:1};
  assert.deepEqual(boundaryLoops([r],[hole]),[[[-2,-2],[2,-2],[2,2],[-2,2]],[[-1,-1],[-1,1],[1,1],[1,-1]]]);
  assert.equal(reads,32,'original coordinate reads remain observable for accessors');
});
