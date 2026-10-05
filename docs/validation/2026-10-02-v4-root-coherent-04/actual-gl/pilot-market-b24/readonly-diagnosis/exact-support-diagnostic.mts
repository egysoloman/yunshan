import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createWorld} from '/tmp/yunshan-v4-root-coherent-04/src/world.ts';
import * as original from '/tmp/yunshan-v4-root-coherent-04/src/architecture-floor-plan.ts';
import * as p from './architecture-floor-plan-exposed.ts';
const eps=1e-7;
const world=createWorld(20261001,'current-v4'),b=world.buildings.find(b=>b.id==='market-b24')!;
const cause=JSON.parse(await readFile('/workspace/yunshan/artifacts/v4-coherent04-pilot-market-b24/stairs-12-cpu-cause.json','utf8'));
const from=cause.from, actual=cause.variants[0].point;
const sourcePath='/tmp/yunshan-v4-root-coherent-04/src/architecture-floor-plan.ts';
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const startSHA=sha(await readFile(sourcePath));
function examine(floor:number,point:any){
  const plan=p.getBuildingFloorPlan(b,floor)!;
  const local=p.buildingLocalPosition(b,point),surfaces=p.stairSurfaces(b,plan);
  const base=p.getFloorPlanSlabRegions(plan);
  const selectedSurfaces=surfaces.filter(s=>s.top<=local.y+.22+eps&&s.top>=local.y-.42-eps);
  const footprint=[...base,...selectedSurfaces.map(s=>s.rect)];
  const edges=p.boundaryLoops(footprint).flatMap(loop=>loop.map((a,i)=>{
    const z=loop[(i+1)%loop.length];return {a,b:z,distance:Math.sqrt(p.segmentDistanceSquared(local.x,local.z,a,z))};
  })).sort((a,z)=>a.distance-z.distance);
  const diskSupported=p.containsUnion(footprint,local.x,local.z)&&edges.every(e=>e.distance**2>=.35**2-eps);
  const choices:any[]=[];
  if(!surfaces.some(s=>p.contains(s.rect,local.x,local.z)&&s.top>plan.y+eps&&s.top<=local.y+.22+eps&&s.top>=local.y-.42-eps)&&diskSupported&&p.containsUnion(base,local.x,local.z)&&Math.abs(plan.y-local.y)<=.42+eps)
    choices.push({top:plan.y,kind:p.contains(plan.stairLanding,local.x,local.z)?'stairs':p.containsUnion(plan.interior,local.x,local.z)?'room':p.containsUnion(plan.circulation,local.x,local.z)?'gallery':'courtyard',floor:plan.floor});
  if(surfaces.some(s=>p.contains(s.rect,local.x,local.z)))for(const s of surfaces){
    if(!p.contains(s.rect,local.x,local.z)||!diskSupported||s.top>local.y+.22+eps||s.top<local.y-.42-eps)continue;
    const target=p.getBuildingFloorPlan(b,s.toFloor)!;
    choices.push({id:s.id,fromFloor:s.fromFloor,toFloor:s.toFloor,rect:s.rect,top:s.top,kind:'stairs',floor:s.top>=target.y-eps?s.toFloor:s.fromFloor});
  }
  for(const f of plan.fixtures)if(p.contains(f.rect,local.x,local.z)&&Math.abs(local.y-(plan.y+f.top))<.01)choices.push({top:plan.y+f.top,kind:'room',floor});
  choices.sort((a,z)=>Math.abs(a.top-local.y)-Math.abs(z.top-local.y)||z.top-a.top);
  const solids=p.localSolids(b,plan);
  const verdicts=choices.map(c=>({...c,rejectedBy:solids.filter(s=>s.top>c.top+(s.steppable?.22:.01)&&s.bottom<c.top+1.72-eps&&p.circleRectDistanceSquared(local.x,local.z,s.rect)<.35**2-eps)}));
  const support=p.floorPlanSupport(b,floor,point,.35),untouched=original.floorPlanSupport(b,floor,point,.35);
  assert.deepEqual(support,untouched,'Export-only diagnostic copy must match unmodified frozen provider');
  return {floor,point,local,bodyRadius:.35,oldFeetHeightThreshold:[local.y-.42,local.y+.22],
    centerInsideFootprint:p.containsUnion(footprint,local.x,local.z),diskSupported,
    nearestBoundaryEdges:edges.slice(0,10),selectedSurfaces,
    choices:verdicts,bodySupport:support,centerSupport:p.floorPlanSupport(b,floor,point,0),
    nearbySolids:solids.filter(s=>p.circleRectDistanceSquared(local.x,local.z,s.rect)<.35**2-eps),
    movementBlockedAtOldY:p.blocksFloorPlanMovement(b,floor,from,point,.35,1.72)};
}
const probes=[
  {label:'actual last supported browser pose',floor:1,point:from},
  {label:'actual blocked next .072m step, current old feet height',floor:1,point:actual},
  {label:'read-only hypothetical first-tread raised pose, NOT assigned to actor',floor:1,point:{...actual,y:80.2}},
  {label:'same local stair edge on ground floor, original earlier PASS scope',floor:0,point:{...actual,y:76.6}}
].map(v=>({label:v.label,...examine(v.floor,v.point)}));
const endSHA=sha(await readFile(sourcePath));assert.equal(startSHA,endSHA);
const record={scope:'Pure read-only exact frozen provider helpers; no controller stepping, actor movement, source mutation or browser',sourcePath,sourceStartSHA:startSHA,sourceEndSHA:endSHA,exportOnlyCopySHA:sha(await readFile('/tmp/yunshan-v4-pilot-stair-readonly-01/architecture-floor-plan-exposed.ts')),buildingId:b.id,probes};
const out='/tmp/yunshan-v4-pilot-stair-readonly-01/exact-support-diagnostic.json';
await writeFile(out,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({out,sha:sha(await readFile(out)),sourceStartSHA:startSHA,sourceEndSHA:endSHA,probes:probes.map(q=>({label:q.label,local:q.local,diskSupported:q.diskSupported,nearestEdge:q.nearestBoundaryEdges[0],choices:q.choices.map(c=>({top:c.top,id:c.id,rejectedBy:c.rejectedBy})),bodySupport:q.bodySupport}))},null,2));
