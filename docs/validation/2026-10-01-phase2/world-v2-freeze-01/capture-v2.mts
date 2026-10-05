import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWorld, terrainHeight, naturalTerrainHeight, getWalkHeight, getWaterfallPath } from './src/world.ts';
import { savedWorldFingerprint } from './src/persistence/world-layout.ts';
import * as main from './git/26f0c69/src/world.ts';
import * as checkpoint from './git/ee3e7a1/src/world.ts';
import type { WorldDefinition } from './src/types.ts';

const seeds = [20261001, 7, 2024];
const output = '/workspace/yunshan/tests/fixtures/world-layout';
const archive = '/workspace/yunshan/docs/validation/2026-10-01-phase2/world-v2-freeze-01';
await mkdir(output, { recursive: true }); await mkdir(archive, { recursive: true });
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourceHashes = JSON.parse(await readFile('./manifest.json', 'utf8'));
const legacySources: Record<string, Record<string, string>> = {};
for (const rev of ['26f0c69','ee3e7a1']) legacySources[rev] = Object.fromEntries(await Promise.all(['src/world.ts','src/access.ts','src/types.ts'].map(async path => [path, sha(await readFile(`./git/${rev}/${path}`))])));
const gridCoordinates = Array.from({ length: 29 }, (_, i) => -2100 + i * 150);
const sample = (api: { terrainHeight: (world: any,x: number,z: number) => number; getWalkHeight: typeof getWalkHeight }, world: WorldDefinition, x: number, z: number, reference?: number) => [api.terrainHeight(world,x,z), api.getWalkHeight(world,x,z), api.getWalkHeight(world,x,z, reference ?? api.terrainHeight(world,x,z))];
const records: any[] = [], legacyRecords: any[] = [];
for (const seed of seeds) {
  const world = createWorld(seed, 'current-v2');
  const grid = gridCoordinates.flatMap(z => gridCoordinates.map(x => [x,z,naturalTerrainHeight(world,x,z),terrainHeight(world,x,z),terrainHeight(world,x,z,false),getWalkHeight(world,x,z),getWalkHeight(world,x,z,terrainHeight(world,x,z))]));
  const doors = world.buildings.flatMap(site => {
    const dx=site.door.x-site.position.x,dz=site.door.z-site.position.z,len=Math.hypot(dx,dz)||1;
    return [0,2.2].map(outside => {
      const x=site.door.x+dx/len*outside,z=site.door.z+dz/len*outside;
      return [site.id,outside,x,site.door.y,z,terrainHeight(world,x,z),terrainHeight(world,x,z,false),getWalkHeight(world,x,z,site.door.y)];
    });
  });
  const decks = world.edges.flatMap((edge,edgeIndex) => ['road','bridge'].includes(edge.mode) ? edge.points.flatMap((point,pointIndex) => {
    const rows = [[edgeIndex,pointIndex,point.x,point.y,point.z,...sample({terrainHeight,getWalkHeight},world,point.x,point.z,point.y)]];
    if (edge.mode === 'bridge' && pointIndex > 0) {
      const a=edge.points[pointIndex-1],x=(a.x+point.x)/2,y=(a.y+point.y)/2,z=(a.z+point.z)/2;
      rows.push([edgeIndex,pointIndex-.5,x,y,z,...sample({terrainHeight,getWalkHeight},world,x,z,y)]);
    }
    return rows;
  }) : []);
  const grades = world.edges.flatMap((edge,edgeIndex) => ['road','bridge'].includes(edge.mode) ? edge.points.slice(1).map((p,i) => [edgeIndex,i+1,Math.abs(p.y-edge.points[i].y)/Math.hypot(p.x-edge.points[i].x,p.z-edge.points[i].z)]) : []);
  const core = world.buildings.find(site=>site.id==='core-main')!;
  const floors = Array.from({length:core.floors+(core.basements??0)},(_,i) => i-(core.basements??0)).flatMap(floor => {
    const y=core.position.y+.6+floor*core.height/core.floors;
    return [0,50].map(dx => [floor,core.position.x+dx,y,core.position.z,getWalkHeight(world,core.position.x+dx,core.position.z,y)]);
  });
  const water = [...world.river,...getWaterfallPath(world)].map(p=>[p.x,p.y,p.z,terrainHeight(world,p.x,p.z),getWalkHeight(world,p.x,p.z)]);
  const record={seed,layout:'current-v2',worldSha256:sha(JSON.stringify(world)),fingerprint:savedWorldFingerprint(world),world,grid,doors,decks,grades,floors,water};
  await writeFile(`${output}/current-v2-${seed}.json`,JSON.stringify(record));
  records.push({seed,layout:'current-v2',worldSha256:record.worldSha256,fingerprint:record.fingerprint,buildings:world.buildings.length,nodes:world.nodes.length,edges:world.edges.length,gridSamples:grid.length,doorSamples:doors.length,deckSamples:decks.length,floorSamples:floors.length,waterSamples:water.length});
  const legacy=createWorld(seed,'legacy-ee3e7a1'), {layoutVersion,...legacyBody}=legacy;
  const oldMain=main.createWorld(seed), oldCheckpoint=checkpoint.createWorld(seed);
  const originalGrid=gridCoordinates.flatMap(z=>gridCoordinates.map(x=>[x,z,...sample(main,oldMain,x,z)]));
  const originalDoors=oldMain.buildings.flatMap(site=>[0,2.2].map(outside=>[site.id,outside,site.door.x,site.door.y,site.door.z+outside,...sample(main,oldMain,site.door.x,site.door.z+outside,site.door.y)]));
  const originalDecks=oldMain.edges.flatMap((edge,edgeIndex)=>['road','bridge'].includes(edge.mode)?edge.points.map((p,i)=>[edgeIndex,i,p.x,p.y,p.z,...sample(main,oldMain,p.x,p.z,p.y)]):[]);
  const mismatches:any[]=[]; let checkpointMax=0,legacyMax=0;
  for(const [kind,rows] of [['grid',originalGrid],['doors',originalDoors],['decks',originalDecks]] as const) for(const row of rows) {
    const offset=kind==='grid'?2:5,x=row[kind==='grid'?0:2] as number,z=row[kind==='grid'?1:4] as number,reference=kind==='grid'?undefined:row[3] as number;
    const expected=row.slice(offset) as number[], actual=sample({terrainHeight,getWalkHeight},legacy,x,z,reference),originalCheckpoint=sample(checkpoint,oldCheckpoint,x,z,reference);
    const difference=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i]))),cpDifference=Math.max(...originalCheckpoint.map((v,i)=>Math.abs(v-expected[i])));
    checkpointMax=Math.max(checkpointMax,cpDifference);legacyMax=Math.max(legacyMax,difference);
    if(difference>1e-8)mismatches.push({kind,coordinate:[x,z],expected,actual,difference});
  }
  legacyRecords.push({seed,fingerprint:savedWorldFingerprint(legacy),mainWorldSha256:sha(JSON.stringify(oldMain)),checkpointWorldSha256:sha(JSON.stringify(oldCheckpoint)),legacyBodySha256:sha(JSON.stringify(legacyBody)),mainCheckpointExact:JSON.stringify(oldMain)===JSON.stringify(oldCheckpoint),legacyBodyExact:JSON.stringify(oldMain)===JSON.stringify(legacyBody),checkpointMaximumDifference:checkpointMax,legacyMaximumDifference:legacyMax,mismatchCount:mismatches.length,firstMismatches:mismatches.slice(0,12),grid:originalGrid,doors:originalDoors,decks:originalDecks});
}
await writeFile(`${output}/legacy-main-proofs.json`,JSON.stringify({sourceRevisions:['26f0c69','ee3e7a1'],sourceHashes:legacySources,records:legacyRecords}));
const manifest={at:new Date().toISOString(),environment:'Node authoritative generator and terrain/getWalkHeight functions; no renderer or WebGL',frozenSourceHashes:sourceHashes,legacySourceHashes:legacySources,currentV2:records,legacy:legacyRecords.map(({grid,doors,decks,...record})=>({...record,gridSamples:grid.length,doorSamples:doors.length,deckSamples:decks.length})),limits:['Samples are CPU authority checks, not a browser collision walkthrough.','Fingerprints for legacy/v2 predate heightfield versioning; v3 requires a new authority descriptor.']};
await writeFile(`${archive}/manifest.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
