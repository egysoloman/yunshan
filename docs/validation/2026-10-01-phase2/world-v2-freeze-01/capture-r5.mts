import { createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createWorld,terrainHeight,naturalTerrainHeight,getWalkHeight,getWaterfallPath } from './src/world.ts';
import { savedWorldFingerprint } from './src/persistence/world-layout.ts';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const seeds=[20261001,7,2024],summary:any[]=[], source=JSON.parse(await readFile('./source-manifest.json','utf8'));
const gridCoordinates=Array.from({length:29},(_,i)=>-2100+i*150);
for(const seed of seeds){
  const world=createWorld(seed,'current-v2');
  const grid=gridCoordinates.flatMap(z=>gridCoordinates.map(x=>[x,z,naturalTerrainHeight(world,x,z),terrainHeight(world,x,z),terrainHeight(world,x,z,false),getWalkHeight(world,x,z),getWalkHeight(world,x,z,terrainHeight(world,x,z))]));
  const doors=world.buildings.flatMap(site=>{const dx=site.door.x-site.position.x,dz=site.door.z-site.position.z,len=Math.hypot(dx,dz)||1;return [0,2.2].map(outside=>{const x=site.door.x+dx/len*outside,z=site.door.z+dz/len*outside;return [site.id,outside,x,site.door.y,z,terrainHeight(world,x,z),terrainHeight(world,x,z,false),getWalkHeight(world,x,z,site.door.y)];});});
  const decks=world.edges.flatMap((edge,ei)=>['road','bridge'].includes(edge.mode)?edge.points.flatMap((p,pi)=>{const row=(x:number,y:number,z:number,index:number)=>[ei,index,x,y,z,terrainHeight(world,x,z),getWalkHeight(world,x,z),getWalkHeight(world,x,z,y)];const rows=[row(p.x,p.y,p.z,pi)];if(edge.mode==='bridge'&&pi>0){const a=edge.points[pi-1];rows.push(row((a.x+p.x)/2,(a.y+p.y)/2,(a.z+p.z)/2,pi-.5));}return rows;}):[]);
  const record={seed,layout:'current-v2',historicalRecipe:'current-v2-r5',fingerprint:savedWorldFingerprint(world),worldSha256:sha(JSON.stringify(world)),world,grid,doors,decks};
  const json=JSON.stringify(record),gzip=gzipSync(json,{level:9}),path=`/workspace/yunshan/tests/fixtures/world-layout/current-v2-r5-${seed}.json.gz`;
  await writeFile(path,gzip);summary.push({seed,fingerprint:record.fingerprint,worldSha256:record.worldSha256,gridSamples:grid.length,doorSamples:doors.length,deckSamples:decks.length,jsonSha256:sha(json),gzipSha256:sha(gzip),gzipBytes:gzip.length});
}
await writeFile('/workspace/yunshan/docs/validation/2026-10-01-phase2/world-v2-freeze-01/r5-source-manifest.json',JSON.stringify({at:new Date().toISOString(),source,records:summary,limits:['Trusted old source reconstruction only. No browser profile was opened, read or modified.','Actual native-UI r5 load/export remains a separate integration validation.']},null,2));
console.log(JSON.stringify(summary,null,2));
