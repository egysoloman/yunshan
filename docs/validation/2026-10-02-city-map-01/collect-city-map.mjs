import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const source='/tmp/yunshan-system-coherent-08/source',out='/tmp/yunshan-current-city-map-01';
const plan=JSON.parse(await readFile('/tmp/yunshan-first-night-home-audit-01/plan-inputs.json','utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(Object.keys(plan.expectedSourceHashes).map(async p=>[p,sha(await readFile(join(source,p)))])));
const save=(name,v)=>writeFile(join(out,name),JSON.stringify(v,null,2)+'\n');
try { await access(join(out,'world-native.json')); throw new Error('Native world already exists; do not create another world or overwrite evidence.'); }
catch(e){ if(e.code!=='ENOENT')throw e; }
const startedAt=new Date().toISOString(),began=performance.now();
const before=await hashes();assert.deepEqual(before,plan.expectedSourceHashes);await save('source-start.json',before);
const load=async p=>import(pathToFileURL(join(source,p)).href);
const {createWorld,terrainHeight,getWaterfallPath}=await load('src/world.ts');
const {getBuildingFloorPlan,buildingWorldPosition,wallPanels}=await load('src/architecture-floor-plan.ts');
const {getFloorDimensions}=await load('src/access.ts');
const {savedWorldFingerprint}=await load('src/persistence/world-layout.ts');
// Exactly one static world construction. No Simulation import or ticking.
const world=createWorld(20261001),raw=JSON.stringify(world);await writeFile(join(out,'world-native.json'),raw+'\n');
const nativeWorldSHA256=sha(raw+'\n'),fingerprint=savedWorldFingerprint(world);
const rectCoords=(b,r)=>[[r.x0,r.z0],[r.x1,r.z0],[r.x1,r.z1],[r.x0,r.z1],[r.x0,r.z0]].map(([x,z])=>{const p=buildingWorldPosition(b,{x,y:0,z});return [p.x,p.z];});
const buildingData=world.buildings.map(b=>{
 const p=getBuildingFloorPlan(b,0),d=getFloorDimensions(b,0);
 const areas=p?[...p.interior.map(rect=>({kind:'room',rect})),...p.circulation.map(rect=>({kind:'gallery',rect})),...wallPanels(p).filter(v=>v.top>0).map(v=>({kind:v.kind==='glass'?'glass-wall':'wall',rect:v.rect}))]:[{kind:'legacy-floor',rect:{x0:-d.width/2,x1:d.width/2,z0:-d.depth/2,z1:d.depth/2}}];
 const polygons=areas.map(v=>({kind:v.kind,coordinates:rectCoords(b,v.rect)}));
 const courtyards=(p?.courtyard??[]).map(r=>rectCoords(b,r));
 const commercial=['market','bank'].includes(b.kind);
 return {id:b.id,name:b.name,kind:b.kind,districtId:b.districtId,x:b.position.x,y:b.position.y,z:b.position.z,
  width:b.width,depth:b.depth,bodyHeight:b.height,floors:b.floors,basements:b.basements??0,rotationRad:b.rotation,rotationDeg:b.rotation*180/Math.PI,
  floorPlanProfile:b.floorPlanProfile??null,commercial,commercialHighrise:commercial&&(b.height>=80||b.floors>=20),
  commercialSkyscraper:commercial&&b.height>=150,allUseTallReview:b.height>=80||b.floors>=20,polygons,courtyards,
  footprintAuthority:p?'current-v4 provider floor0 room/gallery/wall descriptors; courtyards separate':'legacy getFloorDimensions floor0 with native rotation'};
});
const features=[];
for(const b of buildingData){for(const [i,p]of b.polygons.entries())features.push({type:'Feature',id:`${b.id}:${p.kind}:${i}`,properties:{layer:'building-floor0',buildingId:b.id,kind:b.kind,districtId:b.districtId,heightM:b.bodyHeight,floors:b.floors,partKind:p.kind},geometry:{type:'Polygon',coordinates:[p.coordinates]}});
 for(const [i,p]of b.courtyards.entries())features.push({type:'Feature',id:`${b.id}:court:${i}`,properties:{layer:'courtyard-open',buildingId:b.id},geometry:{type:'Polygon',coordinates:[p]}});}
for(const e of world.edges)features.push({type:'Feature',id:e.id,properties:{layer:'transport',mode:e.mode,from:e.from,to:e.to,length3dM:e.length},geometry:{type:'LineString',coordinates:e.points.map(p=>[p.x,p.z,p.y])}});
for(const n of world.nodes)features.push({type:'Feature',id:n.id,properties:{layer:'node',name:n.name,station:n.station,districtId:n.districtId},geometry:{type:'Point',coordinates:[n.position.x,n.position.z,n.position.y]}});
features.push({type:'Feature',id:'native-river',properties:{layer:'river'},geometry:{type:'LineString',coordinates:world.river.map(p=>[p.x,p.z,p.y])}});
features.push({type:'Feature',id:'native-waterfall',properties:{layer:'waterfall',dropM:world.waterfall.top.y-world.waterfall.bottom.y,widthM:world.waterfall.width},geometry:{type:'LineString',coordinates:getWaterfallPath(world).map(p=>[p.x,p.z,p.y])}});
const count=(items,key)=>Object.fromEntries([...new Set(items.map(v=>v[key]))].sort().map(k=>[k,items.filter(v=>v[key]===k).length]));
const districts=world.districts.map(d=>({id:d.id,name:d.name,kind:d.kind,center:d.center,radius:d.radius,
  buildings:buildingData.filter(b=>b.districtId===d.id).length,kinds:count(buildingData.filter(b=>b.districtId===d.id),'kind'),
  maxBodyHeightM:Math.max(...buildingData.filter(b=>b.districtId===d.id).map(b=>b.bodyHeight)),maxFloors:Math.max(...buildingData.filter(b=>b.districtId===d.id).map(b=>b.floors))}));
const runway=world.edges.find(e=>e.id==='road-airport-runway-strip');
const stats={seed:world.seed,recipe:world.layoutVersion,worldSizeM:world.size,voxelSizeM:world.voxelSize,
 buildings:world.buildings.length,kinds:count(world.buildings,'kind'),districts,nodes:world.nodes.length,edges:world.edges.length,transportModes:count(world.edges,'mode'),
 transportLength3dM:Object.fromEntries([...new Set(world.edges.map(e=>e.mode))].sort().map(mode=>[mode,world.edges.filter(e=>e.mode===mode).reduce((a,e)=>a+e.length,0)])),
 mountains:world.mountains.length,riverPoints:world.river.length,waterfall:{...world.waterfall,dropM:world.waterfall.top.y-world.waterfall.bottom.y},
 runway:runway?{id:runway.id,length3dM:runway.length,points:runway.points}:null,
 bodyHeightBins:[{label:'<15m',min:0,max:15},{label:'15–30m',min:15,max:30},{label:'30–60m',min:30,max:60},{label:'60–100m',min:60,max:100},{label:'100–150m',min:100,max:150},{label:'>=150m',min:150,max:Infinity}].map(v=>({...v,max:Number.isFinite(v.max)?v.max:null,count:buildingData.filter(b=>b.bodyHeight>=v.min&&b.bodyHeight<v.max).length})),
 topBuildings:[...buildingData].sort((a,b)=>b.bodyHeight-a.bodyHeight).slice(0,15).map(({polygons,courtyards,...b})=>b),
 commercialDefinition:'actual kind market or bank only; no dedicated office/commercial tower kind in this World',
 highriseReviewThreshold:'market/bank with body height >=80m OR floors>=20; map review threshold, not a legal classification',
 skyscraperReviewThreshold:'commercial body height >=150m; map review threshold',
 commercialBuildingCount:buildingData.filter(b=>b.commercial).length,commercialHighrises:buildingData.filter(b=>b.commercialHighrise).map(b=>b.id),commercialSkyscrapers:buildingData.filter(b=>b.commercialSkyscraper).map(b=>b.id),
 allUseTallBuildings:buildingData.filter(b=>b.allUseTallReview).map(({polygons,courtyards,...b})=>b),
 commercialMaxHeightM:Math.max(...buildingData.filter(b=>b.commercial).map(b=>b.bodyHeight)),commercialMaxFloors:Math.max(...buildingData.filter(b=>b.commercial).map(b=>b.floors)),
 npcCount:'NOT_PRESENT_IN_STATIC_WORLD; Simulation not constructed',units:'X/Z local coordinates in metres, Y authoritative terrain altitude; no geographic CRS or true north assertion'};
await save('city-census.json',stats);await save('building-footprints.json',buildingData);await save('city-layers.geojson',{type:'FeatureCollection',coordinateSystem:'LOCAL_X_Z_METRES; not geographic GeoJSON WGS84',features});
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const columns=['id','name','kind','districtId','x','y','z','width','depth','bodyHeight','floors','basements','rotationDeg','commercial','commercialHighrise','commercialSkyscraper','footprintAuthority'];
await writeFile(join(out,'buildings.csv'),[columns.join(','),...buildingData.map(b=>columns.map(k=>csv(b[k])).join(','))].join('\n')+'\n');
const ecols=['id','mode','from','to','length','capacity','pointCount'];await writeFile(join(out,'transport-edges.csv'),[ecols.join(','),...world.edges.map(e=>ecols.map(k=>csv(k==='pointCount'?e.points.length:e[k])).join(','))].join('\n')+'\n');
const grid={xMin:-2300,xMax:2300,zMin:-2300,zMax:2300,stepM:50,nx:93,nz:93,sourceFunction:'terrainHeight(world,x,z) default includeBasements=true',orientation:'row0 zMin; columns increasing +X; plotting uses -Z at top, +Z at bottom',storage:'Float64 little endian',noBelow50mResolutionClaim:true};
const heights=new Float64Array(grid.nx*grid.nz);let hmin=Infinity,hmax=-Infinity;
for(let j=0;j<grid.nz;j++)for(let i=0;i<grid.nx;i++){const h=terrainHeight(world,grid.xMin+i*grid.stepM,grid.zMin+j*grid.stepM);heights[j*grid.nx+i]=h;hmin=Math.min(hmin,h);hmax=Math.max(hmax,h);}
await writeFile(join(out,'terrain-height-f64.bin'),Buffer.from(heights.buffer));await save('terrain-grid.json',{...grid,samples:heights.length,minHeightM:hmin,maxHeightM:hmax});
assert.equal(JSON.stringify(world),raw,'terrain/provider queries must not mutate actual world');
const after=await hashes();await save('source-end.json',after);assert.deepEqual(after,before);
await save('collection-manifest.json',{startedAt,endedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-began)/1000,sourceRoot:source,sourceCount:Object.keys(before).length,
 sourceManifestSHA256:sha(await readFile('/tmp/yunshan-system-coherent-08/source-snapshot.json')),nativeWorldSHA256,fingerprint,worldConstructions:1,simulationImports:0,simulationConstructions:0,ticks:0,GPU:0,sourceUnchanged:true,worldUnchanged:true,terrainSamples:heights.length,terrainGridStepM:50});
console.log(JSON.stringify({status:'STATIC_WORLD_MAP_DATA_READY',out,elapsedSeconds:(performance.now()-began)/1000,worldSHA256:nativeWorldSHA256,fingerprint,stats},null,2));
