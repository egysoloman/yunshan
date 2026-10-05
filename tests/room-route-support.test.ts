import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildingLocalPosition, canStandAlongFloorPlan, canStandInFloorPlan, findBuildingFloorPlanRoute, getBuildingFloorPlan, type FloorPlan } from '../src/architecture-floor-plan.ts';
import { NpcStairMotion } from '../src/simulation/npc-stair-motion.ts';
import type { Building, Vec3, WorldDefinition } from '../src/types.ts';

// Exact building parameters retained from World291. This pure geometry fixture
// is the real failing room; it does not simulate the full city's residents.
const building: Building = JSON.parse(readFileSync(new URL('./fixtures/room-route-starport-b0.json', import.meta.url), 'utf8'));
const from = { x: 1328.272, y: 408.40000000000003, z: -1416.5 };
const unsafeTo = { x: 1319.6, y: 408.40000000000003, z: -1414.2 };
const plan = getBuildingFloorPlan(building, 3)!;

test('the real starport shortcut misses support between all twenty-four former sample points', () => {
  const a = buildingLocalPosition(building, from), b = buildingLocalPosition(building, unsafeTo);
  const steps = Math.ceil(Math.hypot(a.x-b.x, a.z-b.z) / .4);
  assert.equal(steps, 23);
  for (let i=0;i<=steps;i++) assert.equal(canStandInFloorPlan(plan,a.x+(b.x-a.x)*i/steps,a.z+(b.z-a.z)*i/steps,.35),true);
  const lost = { x: a.x+(b.x-a.x)*44/180, z: a.z+(b.z-a.z)*44/180 };
  assert.equal(canStandInFloorPlan(plan,lost.x,lost.z,.35),false,'the swept body overlaps the actual stair-hole corner');
  assert.equal(canStandAlongFloorPlan(plan,a,b,.35),false);
  assert.equal(canStandAlongFloorPlan(plan,b,a,.35),false);
});

test('the real door-to-third-floor work route stays supported and passes every original native stair leg', () => {
  const target = building.functionPoints!.find(point=>point.purpose==='work' && point.floor===3)!.position;
  const route=findBuildingFloorPlanRoute(building,0,3,building.door,target,.35);
  assert.ok(route && route.length>3,'the lawful room is still reachable through its real stairs');
  assert.deepEqual(route[0],building.door);assert.deepEqual(route.at(-1),target);
  const motion=new NpcStairMotion({buildings:[building]} as WorldDefinition);
  let position=route[0],physical=0;
  for(let index=1;index<route.length;index++) {
    const description=motion.describe(route,index);
    assert.notEqual(description.kind,'blocked',`native leg ${index}`);
    if(description.kind==='physical') {
      const cursor=motion.opening(route,index)!;
      motion.validate(route,cursor,position);
      const advanced=motion.advance(route,cursor,description.leg.length + 1,()=>true);
      assert.ok(Math.abs(advanced.usedDistance-description.leg.length)<1e-7,'the finite spare travel budget is not spent beyond this physical leg');
      assert.equal(advanced.blocked,false);assert.equal(advanced.finishedLeg,true);
      position=advanced.position;physical++;
    } else position=route[index];
  }
  assert.ok(physical>100,'the complete multi-floor physical stair path is exercised');
  assert.deepEqual(position,target);
});

function emptyPlan():FloorPlan {
  return { floor:0,y:0,ceilingY:3,broadphase:{x0:0,x1:10,z0:0,z1:10},interior:[{x0:0,x1:10,z0:0,z1:10}],circulation:[],courtyard:[],stairHole:{x0:4,x1:6,z0:4,z1:6},stairLanding:{x0:0,x1:1,z0:0,z1:1},fixtures:[],stairTreads:[],stairLandings:[],walls:[],stair:{x:0,z:0},usePoint:{x:1,z:1},usePoints:[],program:'test',permission:'public' };
}
test('continuous support rejects hole crossings and preserves tangent and stationary supported disks', () => {
  const p=emptyPlan();
  assert.equal(canStandAlongFloorPlan(p,{x:2,z:5},{x:8,z:5},.35),false);
  assert.equal(canStandAlongFloorPlan(p,{x:2,z:3.65},{x:8,z:3.65},.35),true);
  assert.equal(canStandAlongFloorPlan(p,{x:2,z:2},{x:2,z:2},.35),true);
  assert.equal(canStandAlongFloorPlan(p,{x:5,z:5},{x:5,z:5},.35),false);
  assert.equal(canStandAlongFloorPlan(p,{x:2,z:5},{x:8,z:5},0),false);
  assert.equal(canStandAlongFloorPlan(p,{x:2,z:4},{x:8,z:4},0),true,'a zero-radius centre may remain on the supported boundary');
  assert.equal(canStandAlongFloorPlan(p,{x:2,z:5},{x:8,z:5},1e-5),false);
  assert.equal(canStandAlongFloorPlan(p,{x:2,z:2},{x:NaN,z:2}),false);
});
