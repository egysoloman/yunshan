import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {getBuildingBody,getFloorPlanSlabRegions,getFloorPlanFixtures,wallPanels,getFloorPlanRoofRegions,getBuildingUsePoints,buildingWorldPosition} from '/tmp/yunshan-v4-root-coherent-04/src/architecture-floor-plan.ts';
import {buildProgramArchitecture} from '/tmp/yunshan-v4-root-coherent-04/src/rendering/architecture-bodies.ts';
import {buildArchitectureDetails,architectureProgramRoofEdges,architectureProgramSignPlacement} from '/tmp/yunshan-v4-root-coherent-04/src/rendering/architecture-detail.ts';
import {getWalkHeight,terrainHeight} from '/tmp/yunshan-v4-root-coherent-04/src/world.ts';

const started=performance.now(), output='/tmp/yunshan-home-pilot-bom-01';
const snapshot='/tmp/yunshan-v4-root-coherent-04';
const worldFile='/tmp/yunshan-v5-market-block-01/prototype-01/diagnostics/legacy-worlds/baseline/current-v4-20261001.world.json';
const saveFile='/workspace/yunshan/docs/validation/2026-10-02-food-counters/public-counter-natural-and-archive-docscope-03/normal-v1-writer-capture/initial-city-save.json';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sourceFiles=['src/architecture-floor-plan.ts','src/rendering/architecture-bodies.ts','src/rendering/architecture-detail.ts','src/world.ts','src/renderer.ts','src/simulation.ts','src/ui.ts'];
const hashes=()=>Object.fromEntries(sourceFiles.map(p=>[p,sha(path.join(snapshot,p))]));
const sourceStart=hashes(), world=JSON.parse(fs.readFileSync(worldFile,'utf8'));
const building=world.buildings.find(b=>b.id==='market-b24');
if(!building||building.kind!=='home'||building.floors!==3)throw Error('The selected real pilot does not match the requested three-floor home.');
const body=getBuildingBody(building), near=buildProgramArchitecture(building,'near');
if(!body||!near)throw Error('No real shared body/near geometry.');
const rounded=n=>Math.round(n*1e8)/1e8;
const normalize=value=>typeof value==='number'?rounded(value):Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k])])):value;
const key=p=>JSON.stringify(normalize(p));
const bounds=p=>Object.fromEntries(['x','y','z'].map(a=>[a,[rounded(p.position[a]-p.size[a]/2),rounded(p.position[a]+p.size[a]/2)]]));
const hist=(rows,field)=>Object.fromEntries([...new Set(rows.map(row=>row[field]))].sort().map(k=>[k,rows.filter(row=>row[field]===k).length]));
const nearParts=near.map((part,index)=>({id:`near:${index}`,part,bounds:bounds(part)}));
const detailsByView=body.floorPlans.map(p=>({nearFloor:p.floor,quality:'balanced',limit:576,parts:buildArchitectureDetails(building,p.floor,576)}));
const uniqueDetail=new Map();
for(const view of detailsByView)for(const [index,part] of view.parts.entries()){
 const k=key(part), existing=uniqueDetail.get(k), ref={nearFloor:view.nearFloor,index};
 if(existing)existing.references.push(ref);else uniqueDetail.set(k,{id:`detail:${uniqueDetail.size}`,part,bounds:bounds(part),references:[ref]});
}
const detailParts=[...uniqueDetail.values()], roofs=getFloorPlanRoofRegions(body), roofEdges=architectureProgramRoofEdges(building);
const floorData=body.floorPlans.map(p=>({
 floor:p.floor,y:p.y,ceilingY:p.ceilingY,permission:p.permission,program:p.program,
 interiorRectangles:p.interior.length,circulationRectangles:p.circulation.length,courtyardRectangles:p.courtyard.length,
 slabRegions:getFloorPlanSlabRegions(p),slabNearPartIds:nearParts.filter(row=>row.part.floor===p.floor&&row.part.purpose==='floor').map(row=>row.id),
 walls:p.walls.map((w,index)=>({id:`floor:${p.floor}:wall:${index}`,...w})),panels:wallPanels(p),
 doors:p.walls.flatMap((w,index)=>w.opening?[{id:`floor:${p.floor}:wall:${index}:opening`,wallIndex:index,...w.opening,worldCenter:buildingWorldPosition(building,{x:w.a[0]+(w.b[0]-w.a[0])*(w.opening.from+w.opening.to)/2/Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1]),y:p.y,z:w.a[1]+(w.b[1]-w.a[1])*(w.opening.from+w.opening.to)/2/Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1])})}]:[]),
 windows:p.walls.flatMap((w,index)=>(w.windows??[]).map((win,wi)=>({id:`floor:${p.floor}:wall:${index}:window:${wi}`,wallIndex:index,...win}))),
 fixtures:getFloorPlanFixtures(building,p).map(f=>({...f,id:`floor:${p.floor}:fixture:${f.id}`,sourceId:f.id})),
 stairTreads:p.stairTreads,stairLandings:p.stairLandings,stairHole:p.stairHole,stairBaseLanding:p.stairLanding,
 stairFlights:p.stairTreads.length?[{id:`floor:${p.floor}:flight:up`,treads:p.stairTreads.filter(t=>t.id.startsWith('up-'))},{id:`floor:${p.floor}:flight:return`,treads:p.stairTreads.filter(t=>t.id.startsWith('return-'))}]:[]
}));
const allDoors=floorData.flatMap(p=>p.doors), allWindows=floorData.flatMap(p=>p.windows), allFixtures=floorData.flatMap(p=>p.fixtures);
const usePoints=body.floorPlans.flatMap(p=>getBuildingUsePoints(building,p.floor)), spatialUses=[...new Map(usePoints.map(p=>[key(p.position),p.position])).values()];
const save=JSON.parse(fs.readFileSync(saveFile,'utf8'));
const existingResidents=save.state.citizens.filter(c=>c.homeId===building.id).map(c=>({id:c.id,name:c.name,homeId:c.homeId,position:c.position,state:c.state,route:c.route,routeIndex:c.routeIndex}));
const brackets=detailParts.filter(row=>row.part.purpose==='bracket');
const doorHeads=detailParts.filter(row=>row.part.purpose==='door'&&row.part.color==='#b89763');
const trimCaps=detailParts.filter(row=>row.part.purpose==='window'&&row.part.color==='#b89763'&&row.part.size.y<=.20000001&&Math.max(row.part.size.x,row.part.size.z)>1.8);
const boundsAll=Object.fromEntries(['x','y','z'].map(a=>[a,[Math.min(...nearParts.map(p=>p.bounds[a][0])),Math.max(...nearParts.map(p=>p.bounds[a][1]))]]));
const doorSamples=[2,1,0,-1,-2].map(dz=>({offsetZ:dz,position:{...building.door,z:building.door.z+dz},walkHeight:getWalkHeight(world,building.door.x,building.door.z+dz,building.door.y),terrainHeight:terrainHeight(world,building.door.x,building.door.z+dz)}));
const sourceEnd=hashes();
const data={
 status:'BOM_DATA_COLLECTED_NO_NEW_MODEL_NO_RENDER_NO_SIMULATION',
 scope:'One existing real current-v4 building. Original provider/near/detail emitters queried on CPU. No createWorld, no new Simulation/tick, no GPU, no new visual asset, no Library.',
 building,body,floorData,nearParts,detailsByView,uniqueDetailParts:detailParts,roofRegions:roofs,roofEdges,signPlacement:architectureProgramSignPlacement(building),usePoints,spatialUsePositions:spatialUses,
 summary:{
  nearPartCount:nearParts.length,nearUniquePartCount:new Set(near.map(key)).size,nearByPurpose:hist(near,'purpose'),nearByMaterial:hist(near,'material'),
  detailViewCounts:detailsByView.map(v=>({nearFloor:v.nearFloor,count:v.parts.length,byPurpose:hist(v.parts,'purpose')})),detailRawAcrossViews:detailsByView.reduce((sum,v)=>sum+v.parts.length,0),detailUniqueCount:detailParts.length,detailUniqueByPurpose:hist(detailParts.map(row=>row.part),'purpose'),
  wallDescriptors:floorData.reduce((n,p)=>n+p.walls.length,0),wallPanelCount:floorData.reduce((n,p)=>n+p.panels.length,0),doorOpenings:allDoors.length,entranceOpenings:allDoors.filter(p=>p.use==='entrance').length,courtyardOpenings:allDoors.filter(p=>p.use==='courtyard').length,windowOpenings:allWindows.length,
  slabRegionCount:floorData.reduce((n,p)=>n+p.slabRegions.length,0),stairFlights:floorData.reduce((n,p)=>n+p.stairFlights.length,0),stairTreads:floorData.reduce((n,p)=>n+p.stairTreads.length,0),stairLandings:floorData.reduce((n,p)=>n+p.stairLandings.length,0),stairBaseLandings:floorData.length,
  fixturesByKind:hist(allFixtures,'kind'),roofRegionsByKind:hist(roofs,'kind'),roofRegionCount:roofs.length,roofEdgeCount:roofEdges.length,logicalUseAliasCount:usePoints.length,spatialUsePositionCount:spatialUses.length,
  nearLocalBounds:boundsAll,nearWorldYBounds:boundsAll.y.map(y=>building.position.y+.6+y),
  existingBracketAnchorCount:brackets.length,existingDoorHeadAnchorCount:doorHeads.length,existingLongEdgeWindowTrimCount:trimCaps.length
 },
 mountCandidates:{dougong:brackets.map(row=>({source:row.id,part:row.part,bounds:row.bounds,supportBottomWorld:buildingWorldPosition(building,{...row.part.position,y:row.bounds.y[0]}),verticalSlotHeight:row.part.size.y,fullSizePrototypeFitsVerticalSlot:row.part.size.y>=.8-1e-7,uniformScaleHalfFitsVerticalSlot:row.part.size.y>=.4-1e-7,uniformScaleHalfFitsExistingBox:['x','y','z'].every((axis,i)=>[.6,.4,.5][i]<=row.part.size[axis]+1e-7),fullSizeFitsExistingBox:['x','y','z'].every((axis,i)=>[1.2,.8,1][i]<=row.part.size[axis]+1e-7),maxUniformScaleInsideExistingBox:Math.min(row.part.size.x/1.2,row.part.size.y/.8,row.part.size.z/1)})),lintel:doorHeads.map(row=>({source:row.id,part:row.part,bounds:row.bounds,worldCenter:buildingWorldPosition(building,row.part.position),fullSizePrototypeHeight:.4,existingHeadHeight:row.part.size.y,modelReady:false})),approvedMeshMounts:0,reason:'No real mesh, triangle protection validation or assembly adapter exists. Existing anchors are counted; they are not approved mounts.'},
 entranceHeightSamples:doorSamples,
 residenceEvidence:{existingV3Save:{path:saveFile,sha256:sha(saveFile),worldFingerprint:save.worldFingerprint,layout:'current-v3',citizens:existingResidents},currentV4PilotActualSaveEvidence:null,currentV4PilotNaturalEntryEvidence:null,currentV4PilotBedUseEvidence:null,limitations:['V3 bindings do not prove V4 occupancy.','No controlled or native market-b24 route/room screenshot was found in examined coherent04 artifacts.','Current rest is service-point/ownership logic; no bed-target interaction is implemented.','Rule/UI six-family evidence for other building IDs cannot replace this pilot proof.']},
 provenance:{snapshot,sourceManifestSHA256:sha(snapshot+'/source-snapshot.json'),worldFile,worldFileSHA256:sha(worldFile),worldSeed:world.seed,layout:world.layoutVersion,sourceStart,sourceEnd,sourceHashesUnchanged:JSON.stringify(sourceStart)===JSON.stringify(sourceEnd),deduplication:'Canonical emitted descriptor with floor/purpose/position/size/color/roof/luminous/rotation; floats rounded1e-8; repeated floor views deduplicated. Logical same-position work/service aliases separately counted from spatial mounts.',elapsedMilliseconds:performance.now()-started}
};
fs.writeFileSync(output+'/raw-counts.json',JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({summary:data.summary,byFloor:floorData.map(p=>({floor:p.floor,wallDescriptors:p.walls.length,panels:p.panels.length,doors:p.doors.length,windows:p.windows.length,slabNearParts:p.slabNearPartIds.length,fixtures:p.fixtures,flights:p.stairFlights.length,treads:p.stairTreads.length,landings:p.stairLandings.length})),mountCandidates:data.mountCandidates,elapsedMilliseconds:data.provenance.elapsedMilliseconds,sourceHashesUnchanged:data.provenance.sourceHashesUnchanged},null,2));
