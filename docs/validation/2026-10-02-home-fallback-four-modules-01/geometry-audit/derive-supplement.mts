import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {buildingLocalPosition,getFloorPlanStairRoute} from '/workspace/yunshan/src/architecture-floor-plan.ts';

const out='/tmp/yunshan-home-four-module-fit-01';
const sha=(p:string)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const contractPath=out+'/four-module-contract.json', rawPath='/tmp/yunshan-home-pilot-bom-01/raw-counts.json';
const c=JSON.parse(fs.readFileSync(contractPath,'utf8')),raw=JSON.parse(fs.readFileSync(rawPath,'utf8'));
const sources=()=>Object.fromEntries(Object.keys(c.sourceStart).map(p=>[p,sha('/workspace/yunshan/'+p)]));
const sourceStart=sources();assert.deepEqual(sourceStart,c.sourceStart);assert.equal(sha(rawPath),c.rawBOMSHA256);
const n=(v:any):any=>typeof v==='number'?Math.round(v*1e8)/1e8:Array.isArray(v)?v.map(n):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,n(x)])):v;
const box=(p:any)=>({min:{x:p.position.x-p.size.x/2,y:p.position.y-p.size.y/2,z:p.position.z-p.size.z/2},max:{x:p.position.x+p.size.x/2,y:p.position.y+p.size.y/2,z:p.position.z+p.size.z/2}});
const overlap=(a:any,b:any)=>{const min={x:Math.max(a.min.x,b.min.x),y:Math.max(a.min.y,b.min.y),z:Math.max(a.min.z,b.min.z)},max={x:Math.min(a.max.x,b.max.x),y:Math.min(a.max.y,b.max.y),z:Math.min(a.max.z,b.max.z)};return max.x-min.x>1e-7&&max.y-min.y>1e-7&&max.z-min.z>1e-7?{min,max}:null;};
const faceRect=(a:any,b:any)=>{const r={x0:Math.max(a.min.x,b.min.x),x1:Math.min(a.max.x,b.max.x),y0:Math.max(a.min.y,b.min.y),y1:Math.min(a.max.y,b.max.y)};return r.x1-r.x0>1e-7&&r.y1-r.y0>1e-7?r:null;};
function unionArea(rs:any[]) {const xs=[...new Set(rs.flatMap(r=>[r.x0,r.x1]))].sort((a,b)=>a-b),ys=[...new Set(rs.flatMap(r=>[r.y0,r.y1]))].sort((a,b)=>a-b);let area=0;for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){const x=(xs[i]+xs[i-1])/2,y=(ys[j]+ys[j-1])/2;if(rs.some(r=>x>r.x0-1e-7&&x<r.x1+1e-7&&y>r.y0-1e-7&&y<r.y1+1e-7))area+=(xs[i]-xs[i-1])*(ys[j]-ys[j-1]);}return area;}
const protectedStairSweeps=[];
for(let floor=0;floor<raw.building.floors-1;floor++) {
 const route=getFloorPlanStairRoute(raw.building,floor,floor+1);assert(route);
 const local=route.map(p=>buildingLocalPosition(raw.building,p));
 protectedStairSweeps.push({id:`stairs:${floor}->${floor+1}:body-conservative-bounds`,fromFloor:floor,toFloor:floor+1,source:'getFloorPlanStairRoute',bodyRadius:.35,bodyHeadHeight:1.72,worldRoute:route,buildingLocalRoute:local,min:{x:Math.min(...local.map(p=>p.x))-.35,y:Math.min(...local.map(p=>p.y)),z:Math.min(...local.map(p=>p.z))-.35},max:{x:Math.max(...local.map(p=>p.x))+.35,y:Math.max(...local.map(p=>p.y))+1.72,z:Math.max(...local.map(p=>p.z))+.35},scope:'Conservative full route body bound, includes turns and .35 disk. This is static exclusion, not a new W traversal.'});
}
const protectedVolumeExclusions=c.modules.map((m:any)=>{const conflicts=m.occupiedSolids.flatMap((a:any,i:number)=>[...m.protectedVolumes,...protectedStairSweeps].flatMap(p=>{const v=overlap(a,p);return v?[{occupiedIndex:i,protectedId:p.id,overlap:v}]:[]}));assert.equal(conflicts.length,0);return {moduleId:m.moduleId,status:'STATIC_PROPOSED_ENVELOPE_EXCLUDES_PROTECTED_VOLUMES',checkedOccupiedBoxes:m.occupiedSolids.length,checkedProtectedVolumes:m.protectedVolumes.length+protectedStairSweeps.length,conflicts};});
const door=c.modules.find((m:any)=>m.moduleId.startsWith('DOORFRAME'));
const frame=raw.uniqueDetailParts.filter((p:any)=>door.oldFrameSourceIds.includes(p.id));
const doorWallConflicts=[];
for(const row of raw.nearParts.filter((r:any)=>r.part.floor===0&&r.part.purpose==='wall')) {
 const native=box(row.part);if(Math.abs(native.max.z-17.4)>1e-7)continue;
 const pairs=frame.flatMap((f:any)=>{const fb=box(f.part),r=faceRect(native,fb);return r&&Math.abs(fb.max.z-17.4)<1e-7?[{detailId:f.id,rect:r,areaM2:(r.x1-r.x0)*(r.y1-r.y0),visualVolumeCut:overlap(native,fb)}]:[]});
 if(pairs.length)doorWallConflicts.push({nativePartId:row.id,nativeBounds:native,planeBuildingLocal:{axis:'z',value:17.4},planeWorld:{axis:'z',value:raw.building.position.z+17.4},pairs,unionFaceOverlapAreaM2:unionArea(pairs.map(p=>p.rect)),remainingOwner:'Keep every native region outside listed exact cuts. Fine module owns its frame; no duplicate exposed coplanar face. Collision wallPanels and hole remain unchanged.'});
}
assert(doorWallConflicts.length>0);
const references=[
 {relativePath:'../references/庭院建筑模块图鉴.png',sha256:'c3db472a46275e5072f9d0287c16834c80ff061cc4b97d39e7b96e2abef6fc31',actualPixelViewedByAuditor:true,components:12},
 {relativePath:'../references/立面与细部组件.png',sha256:'bffedd696fbaadff929d8e7cdbf21c6efedaf26aeaec45194d625bef7b5c0bbe',actualPixelViewedByAuditor:true,components:16}
];
for(const r of references)assert.equal(sha(path.resolve('/workspace/yunshan/docs/validation/2026-10-02-home-fallback-four-modules-01/geometry-audit',r.relativePath)),r.sha256);
const sourceEnd=sources();assert.deepEqual(sourceStart,sourceEnd);
const record={status:'STATIC_SUPPLEMENT_ONLY',contractPath:'four-module-contract.json',contractSHA256:sha(contractPath),rawBOMSHA256:sha(rawPath),sourceStart,sourceEnd,sourceUnchanged:true,approvedInstalls:0,returnedQualifiedMeshes:0,GL:'NOT_RUN',normalW:'NOT_RUN',fullSuite:'NOT_RUN',protectedStairSweeps,protectedVolumeExclusions,doorFrameOnly:{moduleId:door.moduleId,primarySample:'OPEN_FRAME_ONLY',fit:{status:'CANDIDATE_ONLY',staticEnvelope:'CALCULATED_EXISTING_MATCH',meshFit:'NOT_RUN'},dimensions:[5.6,3.2,.4],clearOpening:[4.8,2.8],oldDetailIds:door.oldFrameSourceIds,coplanarAudit:{planeLocalZ:17.4,planeWorldZ:raw.building.position.z+17.4,wallFaceConflicts:doorWallConflicts,unionFaceOverlapAreaM2:doorWallConflicts.reduce((s,p)=>s+p.unionFaceOverlapAreaM2,0),method:'Exact positive-area native wall/frame faces, no GL observation.'},renderReplacement:'Atomic: replace detail0..3; split/subtract their exact opaque frame cuts from these coarse wall parts, retain all remainder, one visible frame owner. Native/coarse/fine share distance/floor/cutaway masks. Renderer adapter is absent.',leaves:{status:'REQUIRES_AUTHORITY_CHANGE',notPartOfPrimarySample:true,authorityPresent:false,positiveVolumeSwingWitnesses:door.hypotheticalLeaves.swingConflicts,warning:'Original contract overall REQUIRES_AUTHORITY_CHANGE includes hypothetical leaves. It does not prevent a frame-only candidate; neither candidate is approved.'}},referenceStyleMapping:{references,authority:'STYLE_ONLY_NOT_CAD; 28 depicted components do not become 28 approved meshes.',modules:[{moduleId:c.modules[0].moduleId,referenceComponent:'REF-A08 solid wall bay',permitted:'Cream stone/dark grid/material/block language only.',constraint:'The exact selected wall1 is solid. No new hole or lattice-through opening; do not replace its authority with the pictured decorative bay dimensions.'},{moduleId:c.modules[1].moduleId,referenceComponent:'REF-B01 floor-to-ceiling window',permitted:'Frame/cyan/stone style derived for this windowsill window.',constraint:'Actual opening retains bottom.8/top2.2. This is not an approved floor-to-ceiling window; no lowered sill or new passage.'},{moduleId:door.moduleId,referenceComponent:'REF-A09 open entry frame; REF-B02 separate glass doors',permitted:'Open frame as primary static sample.',constraint:'REF-B02 door leaves remain separate and unapproved; shared state/hinge/collision and lantern sweep conflict unresolved.'},{moduleId:c.modules[3].moduleId,referenceComponent:'REF-B11 rectangular flower trough',permitted:'Vegetation and container material language only.',constraint:'The image is a long flower trough, not an exact .8m square independent pot. Pot/plant sockets and size are proposed production interfaces; no received hollow/container mesh fit.'}]}};
fs.writeFileSync(out+'/geometry-audit-supplement.json',JSON.stringify(n(record),null,2)+'\n');
console.log(JSON.stringify(n({status:record.status,sourceUnchanged:true,doorNativeCoplanarAreas:doorWallConflicts.map(p=>({id:p.nativePartId,area:p.unionFaceOverlapAreaM2})),doorTotalCoplanarArea:record.doorFrameOnly.coplanarAudit.unionFaceOverlapAreaM2,protectedStairSweeps:protectedStairSweeps.length,protectedModuleExclusions:protectedVolumeExclusions.map(p=>({module:p.moduleId,conflicts:p.conflicts.length})),approvedInstalls:0,GL:'NOT_RUN',normalW:'NOT_RUN'}),null,2));
