import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { blocksSweptUprightCylinder, sweptUprightCylinderBoxEvidence, type UprightCylinderBox } from '../src/geometry/upright-cylinder-sweep';
import { buildingLocalPosition, buildingWorldPosition, blocksFloorPlanMovement, getBuildingBody, getBuildingFloorPlan, getFloorPlanRoofRegions, getFloorPlanSlabRegions, wallPanels } from '../src/architecture-floor-plan';
import type { Building, Vec3 } from '../src/types';

const root='/workspace/yunshan-work/ROOT14-building-sweep-implementation-20261004-01';
const bytes=readFileSync(root+'/FIXTURE-14-ORIGINAL-LEGS.json'), fixture=JSON.parse(bytes.toString());
const evidence: any[]=[];
interface IdentifiedBox extends UprightCylinderBox { kind: string; floor: number; allowance: number; id?: string }
function originalNearbyBoxes(site: Building,floor: number): IdentifiedBox[] {
  const body=getBuildingBody(site)!;
  const nearby=body.floorPlans.filter(p=>Math.abs(p.floor-floor)<=1),boxes: IdentifiedBox[]=[];
  for(const p of nearby) {
    for(const [index,s] of wallPanels(p).entries()) boxes.push({...s.rect,bottom:p.y+s.bottom,top:p.y+s.top,kind:'original-wall-'+s.kind,floor:p.floor,allowance:.01,id:String(index)});
    for(const s of p.fixtures) boxes.push({...s.rect,bottom:p.y+s.bottom,top:p.y+s.top,kind:'original-fixture',floor:p.floor,allowance:.01,id:s.id});
    for(const s of [...p.stairTreads,...p.stairLandings]) boxes.push({...s.rect,bottom:s.bottom,top:s.top,kind:'original-stair',floor:p.floor,allowance:.22,id:s.id});
    if(p.floor>floor) for(const [index,r] of getFloorPlanSlabRegions(p).entries()) boxes.push({...r,bottom:p.y-.2,top:p.y,kind:'original-upper-slab',floor:p.floor,allowance:.01,id:String(index)});
  }
  // Bounding boxes are stronger than the actual gable roof volume. Clear of
  // these original descriptors implies roof clearance for these fourteen
  // straight segments only; no generic gable collision implementation.
  for(const [index,r] of getFloorPlanRoofRegions(body).entries()) boxes.push({...r.rect,bottom:r.bottom,top:r.top,kind:'original-roof-bound-'+r.kind,floor:r.floor,allowance:0,id:String(index)});
  return boxes;
}
for(const row of fixture.rows) test('actual terminal '+row.id+' continuous same-time geometry against original floor boxes',()=>{
  const site=row.building as Building, from=row.from as Vec3,to=row.to as Vec3;
  const frozen=JSON.stringify(row);
  assert.equal(row.originalGuardAllows,false);
  assert.equal(blocksFloorPlanMovement(site,0,from,to,.35,1.72),true,'actual unchanged legacy guard blocks');
  const a=buildingLocalPosition(site,from),b=buildingLocalPosition(site,to);
  const boxes=originalNearbyBoxes(site,0);
  assert.ok(boxes.every(box=>box.x0<=box.x1&&box.z0<=box.z1&&box.bottom<box.top),JSON.stringify(boxes.filter(box=>!(box.x0<=box.x1&&box.z0<=box.z1&&box.bottom<box.top))));
  const headers=boxes.filter(box=>box.kind==='original-wall-solid'&&box.floor===0&&box.bottom===2.8&&a.x>=box.x0&&a.x<=box.x1&&Math.abs(box.z0-site.depth/2)<.21);
  assert.equal(headers.length,1,'actual exported original wallPanels entrance header');
  const hits=boxes.filter(box=>blocksSweptUprightCylinder(a,b,box,.35,1.72,box.allowance));
  assert.deepEqual(hits,[],'all original nearby panels, fixtures, stair surfaces, upper slabs and roof bounds clear continuously');
  const physicalHits=boxes.filter(box=>blocksSweptUprightCylinder(a,b,box,.35,1.72,0));
  assert.deepEqual(physicalHits,[],'true cylinder is clear without foot allowance');
  const header=headers[0], headerEvidence=sweptUprightCylinderBoxEvidence(a,b,header);
  assert.equal(headerEvidence.blocked,false);
  assert.equal(blocksSweptUprightCylinder(b,a,header),false,'reverse traversal also clear');
  assert.equal(blocksSweptUprightCylinder(a,b,{...header,bottom:1.6}),true,'a truly low header remains blocking');
  assert.equal(JSON.stringify(row),frozen,'money, needs, original body, role and fixture unchanged');
  evidence.push({id:row.id,buildingId:site.id,originalFrom:from,originalTo:to,localFrom:a,localTo:b,
    originalGuardBlocked:true,actualOriginalHeaderBox:header,headerEvidence,allOriginalBoxes:boxes,
    continuouslyBlockingBoxes:hits,strictPhysicalBlockingBoxes:physicalHits});
});
const wall={x0:-.2,x1:.2,z0:-2,z1:2,bottom:0,top:3};
test('real wall crossings cannot tunnel, including a thin wall between endpoints',()=>{
  assert.equal(blocksSweptUprightCylinder({x:-3,y:0,z:0},{x:3,y:0,z:0},wall),true);
  assert.equal(blocksSweptUprightCylinder({x:-3,y:0,z:0},{x:3,y:0,z:0},{...wall,x0:-.00001,x1:.00001}),true);
  assert.equal(blocksSweptUprightCylinder({x:-3,y:0,z:0},{x:3,y:0,z:0},{...wall,x0:0,x1:0}),true,'a valid zero-width closed face remains collidable');
});
test('stationary bodies and zero horizontal distance handle true overlap and floor/ceiling touching',()=>{
  const p={x:0,y:0,z:0};
  assert.equal(blocksSweptUprightCylinder(p,p,wall),true);
  assert.equal(blocksSweptUprightCylinder(p,p,{...wall,bottom:1.72,top:3}),false);
  assert.equal(blocksSweptUprightCylinder({x:0,y:3,z:0},{x:0,y:3,z:0},wall),false);
  assert.equal(blocksSweptUprightCylinder({x:3,y:0,z:0},{x:3,y:0,z:0},wall),false);
});
test('vertical lift meets a real overhead box while a separated shaft is clear',()=>{
  const ceiling={x0:-1,x1:1,z0:-1,z1:1,bottom:3,top:3.2};
  assert.equal(blocksSweptUprightCylinder({x:0,y:0,z:0},{x:0,y:4,z:0},ceiling),true);
  assert.equal(blocksSweptUprightCylinder({x:0,y:4,z:0},{x:0,y:0,z:0},ceiling),true);
  assert.equal(blocksSweptUprightCylinder({x:2,y:0,z:0},{x:2,y:4,z:0},ceiling),false);
});
test('rounded corners keep a diagonal clear while a closer body really intersects',()=>{
  const box={x0:0,x1:1,z0:0,z1:1,bottom:0,top:3};
  assert.equal(blocksSweptUprightCylinder({x:-.3,y:0,z:-.3},{x:-.3,y:0,z:-.3},box),false);
  assert.equal(blocksSweptUprightCylinder({x:-.2,y:0,z:-.2},{x:-.2,y:0,z:-.2},box),true);
});
test('strict vertical endpoint contact and arbitrarily small nonzero travel',()=>{
  const box={x0:0,x1:1,z0:0,z1:1,bottom:1.72,top:3};
  assert.equal(blocksSweptUprightCylinder({x:0,y:0,z:0},{x:0,y:-1,z:0},box),false);
  assert.equal(blocksSweptUprightCylinder({x:0,y:0,z:0},{x:0,y:1e-9,z:0},box),true);
  assert.equal(blocksSweptUprightCylinder({x:0,y:0,z:0},{x:0,y:0,z:0},box),false);
});
test('explicit foot allowance preserves its policy without becoming a time epsilon',()=>{
  const box={x0:-1,x1:1,z0:-1,z1:1,bottom:0,top:.2},p={x:0,y:0,z:0};
  assert.equal(blocksSweptUprightCylinder(p,p,box),true);
  assert.equal(blocksSweptUprightCylinder(p,p,box,.35,1.72,.22),false);
});
test('pure yaw-local transformation preserves original14 clearance and a real low door',()=>{
  const row=fixture.rows[0],site={...row.building,rotation:Math.PI*.37} as Building;
  const a=buildingLocalPosition(row.building,row.from),b=buildingLocalPosition(row.building,row.to);
  const worldA=buildingWorldPosition(site,a),worldB=buildingWorldPosition(site,b);
  const localA=buildingLocalPosition(site,worldA),localB=buildingLocalPosition(site,worldB);
  const header=originalNearbyBoxes(site,0).find(box=>box.kind==='original-wall-solid'&&box.floor===0&&box.bottom===2.8&&a.x>=box.x0&&a.x<=box.x1&&Math.abs(box.z0-site.depth/2)<.21)!;
  assert.equal(blocksSweptUprightCylinder(localA,localB,header),false);
  assert.equal(blocksSweptUprightCylinder(localA,localB,{...header,bottom:1.6}),true);
});
test('invalid and unsupported tiny or overflowing bodies fail explicitly',()=>{
  const p={x:0,y:0,z:0};
  assert.throws(()=>blocksSweptUprightCylinder(p,p,wall,0),RangeError);
  assert.throws(()=>blocksSweptUprightCylinder(p,p,wall,1e308),RangeError);
  assert.throws(()=>blocksSweptUprightCylinder(p,p,{...wall,x1:wall.x0-.1}),RangeError);
  assert.throws(()=>blocksSweptUprightCylinder(p,{...p,y:NaN},wall),RangeError);
});
test('export originalBox evidence after all14 actual source fixtures are present',()=>{
  assert.equal(evidence.length,14);
  writeFileSync(root+'/ORIGINAL-14-BOX-EVIDENCE.json',JSON.stringify({scope:'Pure helper tests on original terminal reference segments and actual source-generated floor-plan boxes. No Simulation, constructor, ticks, commands, arrival, purchasing or product adoption.',
    fixtureSHA256:createHash('sha256').update(bytes).digest('hex'),rows:evidence},null,2)+'\n');
});
