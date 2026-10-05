import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import * as old from './baseline/src/architecture-floor-plan.ts';
import * as next from './candidate/src/architecture-floor-plan.ts';
import { buildProgramArchitecture as oldRender } from './baseline/src/rendering/architecture-bodies.ts';
import { buildProgramArchitecture as nextRender } from './candidate/src/rendering/architecture-bodies.ts';
import { buildArchitectureDetails as oldDetail } from './baseline/src/rendering/architecture-detail.ts';
import { buildArchitectureDetails as nextDetail } from './candidate/src/rendering/architecture-detail.ts';
import { savedWorldFingerprint as oldFingerprint } from './baseline/src/persistence/world-layout.ts';
import { savedWorldFingerprint as nextFingerprint } from './candidate/src/persistence/world-layout.ts';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const world=JSON.parse(readFileSync(new URL('./inputs/current-v4-20261001.world.json',import.meta.url),'utf8'));
const ids=['market-b24','river-b2','river-b1','workshop-b0','academy-b0','academy-b2','core-interchange','starport-b0','river-b34','market-b3'];
const contracts=[];
for(const id of ids){
 const b=world.buildings.find((b:any)=>b.id===id);assert(b);const before=old.getBuildingBody(b),after=next.getBuildingBody(b);assert(before&&after);assert.deepEqual(after,before);
 const a={body:before,slabs:before.floorPlans.map(p=>old.getFloorPlanSlabRegions(p)),walls:before.floorPlans.map(p=>old.wallPanels(p)),roofs:old.getFloorPlanRoofRegions(before),uses:before.floorPlans.map(p=>old.getBuildingUsePoints(b,p.floor)),near:oldRender(b,'near'),far:oldRender(b,'far'),details:before.floorPlans.map(p=>oldDetail(b,p.floor,576))};
 const z={body:after,slabs:after.floorPlans.map(p=>next.getFloorPlanSlabRegions(p)),walls:after.floorPlans.map(p=>next.wallPanels(p)),roofs:next.getFloorPlanRoofRegions(after),uses:after.floorPlans.map(p=>next.getBuildingUsePoints(b,p.floor)),near:nextRender(b,'near'),far:nextRender(b,'far'),details:after.floorPlans.map(p=>nextDetail(b,p.floor,576))};
 assert.deepEqual(z,a);contracts.push({id,floors:b.floors,fullGeometryUseRenderDetailSHA256:sha(JSON.stringify(a))});
}
assert.equal(next.FLOOR_PLAN_GEOMETRY_VERSION,old.FLOOR_PLAN_GEOMETRY_VERSION);assert.equal(next.FLOOR_PLAN_PROFILE,old.FLOOR_PLAN_PROFILE);
const fixtureDir='/tmp/yunshan-v4-root-coherent-04/tests/fixtures/world-layout';
const legacy=[];
for(const file of readdirSync(fixtureDir).filter(f=>/^current-v[23].*\.json\.gz$/.test(f))){
 const bytes=readFileSync(fixtureDir+'/'+file),f=JSON.parse(gunzipSync(bytes).toString());
 for(const b of f.world.buildings){assert.equal(old.getBuildingBody(b),null);assert.equal(next.getBuildingBody(b),null);assert.equal(next.floorPlanSupport(b,0,b.door,.35),null);}
 const baselineFingerprint=oldFingerprint(f.world),candidateFingerprint=nextFingerprint(f.world);assert.equal(candidateFingerprint,baselineFingerprint);assert.equal(candidateFingerprint,f.fingerprint);
 legacy.push({file,inputSHA256:sha(bytes),layout:f.layout,seed:f.seed,fingerprint:f.fingerprint,baselineFingerprint,candidateFingerprint,worldSHA256:f.worldSha256,buildings:f.world.buildings.length,allBodiesAndSupportsRemainNull:true});
}
// Legacy-main is separately archived under its native older generation recipe.
const native=JSON.parse(gunzipSync(readFileSync(fixtureDir+'/legacy-main-proofs.json.gz')).toString());
const nativeWorlds=[];
for(const seed of [7,2024,20261001]){
 const file=`/tmp/yunshan-v5-market-block-01/prototype-01/diagnostics/legacy-worlds/baseline/legacy-ee3e7a1-${seed}.world.json`,bytes=readFileSync(file),w=JSON.parse(bytes.toString());
 for(const b of w.buildings){assert.equal(old.getBuildingBody(b),null);assert.equal(next.getBuildingBody(b),null);assert.equal(next.floorPlanSupport(b,0,b.door,.35),null);}
 const baselineFingerprint=oldFingerprint(w),candidateFingerprint=nextFingerprint(w);assert.equal(candidateFingerprint,baselineFingerprint);assert.equal(candidateFingerprint,native.records.find((r:any)=>r.seed===seed).fingerprint);
 nativeWorlds.push({file,inputSHA256:sha(bytes),seed,buildings:w.buildings.length,baselineFingerprint,candidateFingerprint,allBodiesAndSupportsRemainNull:true});
}
const fullV4FingerprintBefore=oldFingerprint(world),fullV4FingerprintAfter=nextFingerprint(world);assert.equal(fullV4FingerprintAfter,fullV4FingerprintBefore);
const sourceUnchanged=readdirSync(new URL('./baseline/src/',import.meta.url),{recursive:true}).filter(f=>typeof f==='string'&&f.endsWith('.ts')).map(f=>({path:String(f),baseline:sha(readFileSync(new URL('./baseline/src/'+f,import.meta.url))),candidate:sha(readFileSync(new URL('./candidate/src/'+f,import.meta.url)))}));
const changed=sourceUnchanged.filter(f=>f.baseline!==f.candidate);assert.deepEqual(changed.map(f=>f.path),['architecture-floor-plan.ts']);
writeFileSync(new URL('./artifacts/contract-protection-final.json',import.meta.url),JSON.stringify({scope:'No new world regeneration. Selected real shared geometry/near/far/detail exact; complete parsed v4 and archived 4 legacy recipe/3 seed saved fingerprints unchanged; legacy branch guards remain null. Does not repeat GL or baseline full renderer emissions.',geometryVersion:next.FLOOR_PLAN_GEOMETRY_VERSION,profile:next.FLOOR_PLAN_PROFILE,fullV4FingerprintBefore,fullV4FingerprintAfter,contracts,legacy,nativeWorlds,nativeProofArchiveKeys:Object.keys(native),nativeProofArchiveSHA256:sha(readFileSync(fixtureDir+'/legacy-main-proofs.json.gz')),runtimeSourceFiles:sourceUnchanged.length,changedRuntimeFiles:changed,sourceUnchanged},null,2)+'\n');
console.log(JSON.stringify({contracts:contracts.length,legacy:legacy.length,nativeWorlds:nativeWorlds.length,legacyBuildings:legacy.reduce((n,f)=>n+f.buildings,0)+nativeWorlds.reduce((n,f)=>n+f.buildings,0),geometryVersionUnchanged:true,fullV4FingerprintBefore,fullV4FingerprintAfter,runtimeSourceFiles:sourceUnchanged.length,changedRuntimeFiles:changed},null,2));
