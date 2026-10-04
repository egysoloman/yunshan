import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation';
import { createWorld, naturalTerrainHeight, terrainHeight, getWalkHeight, getWaterfallPath, GEOLOGICAL_GEOMETRY_VERSION } from '../src/world';
import { canAccessFloor, getFloorDimensions, getStairPosition } from '../src/access';
import { savedWorldFingerprint, selectSavedWorld } from '../src/persistence/world-layout';
import { partitionSave, assembleSave } from '../src/persistence/partition';

const evidence: Record<string,unknown>[] = [];
let initialHashes: Record<string,string>;
function sourceHashes() {
  const files = readdirSync(new URL('../src/',import.meta.url),{recursive:true}).filter(path=>typeof path==='string' && path.endsWith('.ts')).map(path=>`src/${path}`);
  files.push('tests/world-layout.test.ts','tests/world-v4.test.ts',...['20261001','7','2024'].flatMap(seed=>[`tests/fixtures/world-layout/current-v2-${seed}.json.gz`,`tests/fixtures/world-layout/current-v2-r5-${seed}.json.gz`,`tests/fixtures/world-layout/current-v3-${seed}.json.gz`]),'tests/fixtures/world-layout/legacy-main-proofs.json.gz','tests/fixtures/world-layout/r5-native-ui-export-coherent02.json.gz');
  return Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(new URL(`../${path}`,import.meta.url))).digest('hex')]));
}
before(()=>{initialHashes=sourceHashes();});
after(()=>{const finalHashes=sourceHashes(),dir=new URL('../artifacts/',import.meta.url);mkdirSync(dir,{recursive:true});writeFileSync(new URL(process.env.YUNSHAN_WORLD_LAYOUT_EVIDENCE??'world-layout-results.json',dir),JSON.stringify({at:new Date().toISOString(),environment:'Node trusted world regeneration, independent frozen Git-source JSON/height samples and real Simulation save/24-tick continuation; no WebGL or r5 browser-profile access',initialHashes,finalHashes,evidence},null,2));assert.deepEqual(finalHashes,initialHashes,'world/save evidence must belong to one unchanged source and fixture snapshot');});

test('new journeys use the current layout and its fingerprint matches the simulation save contract', () => {
  const selected = selectSavedWorld(); assert.equal(selected.layout, 'current-v6');
  const sim = new Simulation(selected.world);
  assert.equal(savedWorldFingerprint(selected.world), JSON.parse(sim.exportSave()).worldFingerprint);
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const readFrozen = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/world-layout/${name}.json.gz`, import.meta.url))).toString('utf8'));
const frozenV2 = [20261001, 7, 2024].map(seed => readFrozen(`current-v2-${seed}`));
const frozenR5 = [20261001, 7, 2024].map(seed => readFrozen(`current-v2-r5-${seed}`));
const frozenV3 = [20261001, 7, 2024].map(seed => readFrozen(`current-v3-${seed}`));
const legacyProofs = readFrozen('legacy-main-proofs');
const near = (actual: number, expected: number, label: string) => assert(Math.abs(actual - expected) <= 1e-8, `${label}: ${actual} != ${expected}`);

test('all three v2 worlds retain their frozen full JSON, fingerprints and authoritative terrain and walking surfaces', () => {
  for (const frozen of frozenV2) {
    const world = createWorld(frozen.seed, 'current-v2');
    assert.equal(sha256(JSON.stringify(world)), frozen.worldSha256); assert.deepEqual(world, frozen.world);
    assert.equal(savedWorldFingerprint(world), frozen.fingerprint);
    assert.equal(frozen.grid.length, 841); assert.equal(frozen.doors.length, world.buildings.length * 2); assert(frozen.decks.length > 10000);
    for (const [x,z,natural,ground,uncut,walk,referencedWalk] of frozen.grid) {
      const label = `${frozen.seed}:v2 grid(${x},${z})`;
      near(naturalTerrainHeight(world,x,z),natural,label); near(terrainHeight(world,x,z),ground,label); near(terrainHeight(world,x,z,false),uncut,label);
      near(getWalkHeight(world,x,z),walk,label); near(getWalkHeight(world,x,z,ground),referencedWalk,label);
    }
    for (const [id,outside,x,y,z,ground,uncut,walk] of frozen.doors) {
      near(terrainHeight(world,x,z),ground,`${id}:${outside}:ground`); near(terrainHeight(world,x,z,false),uncut,`${id}:${outside}:uncut`); near(getWalkHeight(world,x,z,y),walk,`${id}:${outside}:walk`);
    }
    for (const [edgeIndex,pointIndex,x,y,z,ground,walk,referencedWalk] of frozen.decks) {
      const label = `${frozen.seed}:${world.edges[edgeIndex].id}:${pointIndex}`;
      near(terrainHeight(world,x,z),ground,label); near(getWalkHeight(world,x,z),walk,label); near(getWalkHeight(world,x,z,y),referencedWalk,label);
    }
    for (const [edgeIndex,pointIndex,grade] of frozen.grades) {
      const edge = world.edges[edgeIndex],a=edge.points[pointIndex-1],b=edge.points[pointIndex];
      near(Math.abs(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z),grade,`${edge.id}:${pointIndex}:grade`);
    }
    for (const [floor,x,y,z,walk] of frozen.floors) near(getWalkHeight(world,x,z,y),walk,`${frozen.seed}:core floor${floor}`);
    for (const [x,y,z,ground,walk] of frozen.water) { near(terrainHeight(world,x,z),ground,`${frozen.seed}:water${y}`); near(getWalkHeight(world,x,z),walk,`${frozen.seed}:water walk${y}`); }
    evidence.push({check:'frozen-current-v2-physical-world',seed:frozen.seed,fingerprint:frozen.fingerprint,fullWorldSha256:frozen.worldSha256,completeJsonIdentical:true,gridSamples:frozen.grid.length,doorSamples:frozen.doors.length,deckSamples:frozen.decks.length,gradeSamples:frozen.grades.length,floorSamples:frozen.floors.length,waterSamples:frozen.water.length});
  }
});

test('legacy worlds retain full main and checkpoint JSON plus their independently captured physical samples', () => {
  for (const proof of legacyProofs.records) {
    assert.equal(proof.mainCheckpointExact,true); assert.equal(proof.legacyBodyExact,true); assert.equal(proof.mismatchCount,0);
    const world = createWorld(proof.seed,'legacy-ee3e7a1'),{layoutVersion,...body}=world;
    assert.equal(sha256(JSON.stringify(body)),proof.mainWorldSha256); assert.equal(proof.mainWorldSha256,proof.checkpointWorldSha256); assert.equal(savedWorldFingerprint(world),proof.fingerprint);
    for (const [x,z,ground,walk,referencedWalk] of proof.grid) { near(terrainHeight(world,x,z),ground,'legacy grid ground'); near(getWalkHeight(world,x,z),walk,'legacy grid walk'); near(getWalkHeight(world,x,z,ground),referencedWalk,'legacy grid reference'); }
    for (const [, ,x,y,z,ground,walk,referencedWalk] of [...proof.doors,...proof.decks]) { near(terrainHeight(world,x,z),ground,'legacy physical ground'); near(getWalkHeight(world,x,z),walk,'legacy physical walk'); near(getWalkHeight(world,x,z,y),referencedWalk,'legacy physical reference'); }
    evidence.push({check:'independently-captured-original-main-physical-world',seed:proof.seed,fingerprint:proof.fingerprint,sourceRevisions:legacyProofs.sourceRevisions,mainWorldSha256:proof.mainWorldSha256,checkpointWorldSha256:proof.checkpointWorldSha256,legacyJsonIdentical:true,gridSamples:proof.grid.length,doorSamples:proof.doors.length,deckSamples:proof.decks.length,maximumObservedDifference:0});
  }
});

test('the historical r5 recipe reproduces every old world byte, fingerprint and sampled physical surface across three seeds', () => {
  for(const frozen of frozenR5){
    const world=createWorld(frozen.seed,'current-v2-r5');
    assert.equal(world.layoutVersion,'current-v2','the historical recipe preserves its original world metadata');
    assert.equal(sha256(JSON.stringify(world)),frozen.worldSha256);assert.deepEqual(world,frozen.world);assert.equal(savedWorldFingerprint(world),frozen.fingerprint);
    assert.notEqual(savedWorldFingerprint(world),savedWorldFingerprint(createWorld(frozen.seed,'current-v2')));
    for(const [x,z,natural,ground,uncut,walk,referencedWalk] of frozen.grid){near(naturalTerrainHeight(world,x,z),natural,'r5 natural');near(terrainHeight(world,x,z),ground,'r5 ground');near(terrainHeight(world,x,z,false),uncut,'r5 uncut');near(getWalkHeight(world,x,z),walk,'r5 walk');near(getWalkHeight(world,x,z,ground),referencedWalk,'r5 referenced walk');}
    for(const [id,outside,x,y,z,ground,uncut,walk] of frozen.doors){near(terrainHeight(world,x,z),ground,`${id}:${outside}:r5 ground`);near(terrainHeight(world,x,z,false),uncut,`${id}:${outside}:r5 uncut`);near(getWalkHeight(world,x,z,y),walk,`${id}:${outside}:r5 walk`);}
    for(const [, ,x,y,z,ground,walk,referencedWalk] of frozen.decks){near(terrainHeight(world,x,z),ground,'r5 deck ground');near(getWalkHeight(world,x,z),walk,'r5 deck walk');near(getWalkHeight(world,x,z,y),referencedWalk,'r5 referenced deck');}
    evidence.push({check:'frozen-actual-r5-historical-source-world',seed:frozen.seed,historicalRecipe:'current-v2-r5',originalLayout:world.layoutVersion,fingerprint:frozen.fingerprint,fullWorldSha256:frozen.worldSha256,completeJsonIdentical:true,gridSamples:frozen.grid.length,doorSamples:frozen.doors.length,deckSamples:frozen.decks.length});
  }
});

test('v3 identifies the changed physical heightfield even when every building, road and station matches v2', () => {
  for (const frozen of frozenV2) {
    const v2 = createWorld(frozen.seed,'current-v2'),v3 = createWorld(frozen.seed,'current-v3');
    assert.deepEqual(v3.buildings,v2.buildings); assert.deepEqual(v3.nodes,v2.nodes); assert.deepEqual(v3.edges,v2.edges);
    assert.notEqual(savedWorldFingerprint(v3),savedWorldFingerprint(v2));
    let changedGround = 0,changedWalking = 0;
    for (const [x,z,,ground,,walk] of frozen.grid) {
      if(Math.abs(terrainHeight(v3,x,z)-ground)>1e-8)changedGround++;
      if(Math.abs(getWalkHeight(v3,x,z)-walk)>1e-8)changedWalking++;
    }
    assert(changedGround>0,'the new identity must belong to an actually changed collision heightfield'); assert(changedWalking>0,'the authoritative walking ground must share the changed visible terrain');
    evidence.push({check:'v3-real-physical-heightfield-has-distinct-identity',seed:frozen.seed,v2Fingerprint:savedWorldFingerprint(v2),v3Fingerprint:savedWorldFingerprint(v3),buildingsGraphIdentical:true,gridSamples:frozen.grid.length,changedGround,changedWalking});
  }
});

test('v3 fingerprints cover physical geology inputs and ignore untrusted extra descriptor fields', () => {
  const world = createWorld(20261001,'current-v3'),original=savedWorldFingerprint(world);
  const changes = [
    {...world,mountains:world.mountains.map((mountain,i)=>i===0?{...mountain,height:mountain.height+1}:mountain)},
    {...world,districts:world.districts.map((district,i)=>i===0?{...district,center:{...district.center,y:district.center.y+1}}:district)},
    {...world,waterfall:{...world.waterfall,bottom:{...world.waterfall.bottom,y:world.waterfall.bottom.y+1}}},
    {...world,river:world.river.map((point,i)=>i===1?{...point,y:point.y+1}:point)},
    {...world,buildings:world.buildings.map(site=>site.id==='core-main'?{...site,basements:3}:site)},
  ];
  for(const changed of changes)assert.notEqual(savedWorldFingerprint(changed),original);
  assert.equal(savedWorldFingerprint({...world,terrainRecipe:'foreign-data',geologicalGeometryVersion:'foreign-data'} as typeof world),original);
});

test('all three v3 worlds keep their full frozen JSON and every captured physical sample after v4 is introduced', () => {
  for (const frozen of frozenV3) {
    const world=createWorld(frozen.seed,'current-v3');
    assert.deepEqual(world,frozen.world);assert.equal(sha256(JSON.stringify(world)),frozen.worldSha256);assert.equal(savedWorldFingerprint(world),frozen.fingerprint);
    assert(world.buildings.every(b=>!Object.hasOwn(b,'floorPlanProfile')&&!Object.hasOwn(b,'functionPoints')));
    for(const [x,z,natural,ground,uncut,walk,referenced]of frozen.grid){near(naturalTerrainHeight(world,x,z),natural,'v3 natural');near(terrainHeight(world,x,z),ground,'v3 ground');near(terrainHeight(world,x,z,false),uncut,'v3 uncut');near(getWalkHeight(world,x,z),walk,'v3 walk');near(getWalkHeight(world,x,z,ground),referenced,'v3 referenced');}
    for(const [, ,x,y,z,ground,uncut,referenced,walk,natural]of frozen.doors){near(terrainHeight(world,x,z),ground,'v3 door ground');near(terrainHeight(world,x,z,false),uncut,'v3 door uncut');near(getWalkHeight(world,x,z,y),referenced,'v3 door reference');near(getWalkHeight(world,x,z),walk,'v3 door walk');near(naturalTerrainHeight(world,x,z),natural,'v3 door natural');}
    for(const [, ,x,y,z,ground,walk,referenced,uncut,natural]of frozen.decks){near(terrainHeight(world,x,z),ground,'v3 deck ground');near(getWalkHeight(world,x,z),walk,'v3 deck walk');near(getWalkHeight(world,x,z,y),referenced,'v3 deck reference');near(terrainHeight(world,x,z,false),uncut,'v3 deck uncut');near(naturalTerrainHeight(world,x,z),natural,'v3 deck natural');}
    for(const [edgeIndex,pointIndex,grade]of frozen.grades){const e=world.edges[edgeIndex],a=e.points[pointIndex-1],b=e.points[pointIndex];near(Math.abs(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z),grade,'v3 road grade');}
    const core=world.buildings.find(b=>b.id==='core-main')!;
    const details=frozen.floorDetails.map((p:{floor:number})=>({floor:p.floor,dimensions:getFloorDimensions(core,p.floor),stair:getStairPosition(core,p.floor)}));
    assert.deepEqual(JSON.parse(JSON.stringify(details)),frozen.floorDetails,'original basement dimension objects and exact stairs stay unchanged');
    for(const [,x,y,z,referenced,ground,uncut,walk]of frozen.floors){near(getWalkHeight(world,x,z,y),referenced,'v3 core floor');near(terrainHeight(world,x,z),ground,'v3 core ground');near(terrainHeight(world,x,z,false),uncut,'v3 core uncut');near(getWalkHeight(world,x,z),walk,'v3 core walk');}
    assert.deepEqual(world.river,frozen.river);assert.deepEqual(getWaterfallPath(world),frozen.waterfallPath);
    for(const [x,y,z,ground,walk,referenced,uncut,natural]of frozen.water){near(terrainHeight(world,x,z),ground,'v3 water ground');near(getWalkHeight(world,x,z),walk,'v3 water walk');near(getWalkHeight(world,x,z,y),referenced,'v3 water reference');near(terrainHeight(world,x,z,false),uncut,'v3 water uncut');near(naturalTerrainHeight(world,x,z),natural,'v3 water natural');}
    const terrain={algorithm:GEOLOGICAL_GEOMETRY_VERSION,voxelSize:world.voxelSize,size:world.size,mountains:world.mountains,districts:world.districts.map(d=>[d.id,d.center,d.radius]),waterfall:world.waterfall,river:world.river,buildingPhysics:world.buildings.map(b=>[b.id,b.rotation,b.floors,b.basements])};
    assert.equal(sha256(JSON.stringify(terrain)),frozen.terrainDescriptorSha256);assert.deepEqual(JSON.parse(JSON.stringify(terrain)),frozen.terrainDescriptor);
    evidence.push({check:'frozen-current-v3-full-world-and-physical-samples',seed:frozen.seed,fingerprint:frozen.fingerprint,completeJsonIdentical:true,worldSha256:frozen.worldSha256,terrainDescriptorSha256:frozen.terrainDescriptorSha256,gridSamples:frozen.grid.length,doorSamples:frozen.doors.length,deckSamples:frozen.decks.length,gradeSamples:frozen.grades.length,floorSamples:frozen.floors.length,waterSamples:frozen.water.length});
  }
});

test('a complete v3 save retains its actual upper floor, voxel edits, finances and routes instead of acquiring the v4 rooms', () => {
  const world=createWorld(20261001,'current-v3'),sim=new Simulation(world),core=world.buildings.find(b=>b.id==='core-main')!;
  const position={x:core.position.x,y:core.position.y+.6+29*core.height/core.floors,z:core.position.z};assert(canAccessFloor(core,29,sim.state.player));sim.setFocus(position,'walk');
  for(let tick=0;tick<24;tick++)sim.step(.25);
  sim.state.voxels.push({id:'v3-preserved-edit',position:{x:world.spawn.x,y:world.spawn.y+.2,z:world.spawn.z},color:'#665544'});
  const before=sim.exportSave(),selected=selectSavedWorld(before);assert.equal(selected.layout,'current-v3');assert.deepEqual(selected.world,world);
  const restored=new Simulation(selected.world),loaded=restored.importSave(before);assert(loaded.ok,loaded.message);assert.equal(restored.exportSave(),before);assert.deepEqual(restored.state.player.position,position);
  const current=new Simulation(createWorld()),currentBefore=current.exportSave();assert.equal(current.importSave(before).ok,false);assert.equal(current.exportSave(),currentBefore);
  const disguised=JSON.parse(before);disguised.layoutVersion='current-v4';disguised.architecture={algorithm:'external',floorPlanProfile:'v4-program-bodies-02',rooms:[]};disguised.world=createWorld();
  assert.equal(selectSavedWorld(JSON.stringify(disguised)).layout,'current-v3');
  for(let tick=0;tick<24;tick++){sim.step(.25);restored.step(.25);}assert.equal(restored.exportSave(),sim.exportSave());
  evidence.push({check:'actual-v3-full-save-after-v4-upper-floor-voxel-finance-route-preservation',originalSha256:sha256(before),continuationSha256:sha256(sim.exportSave()),exactRoundTrip:true,continuationTicks:24,exactFullContinuation:true,newV4ImportAtomicRejected:true,externalArchitectureIgnored:true});
});

test('v2 and historical r5 saves keep their surface, upper floor, voxel edit and entire financial state after v4', () => {
  for(const recipe of ['current-v2','current-v2-r5'] as const){
  const world = createWorld(20261001,recipe),sim=new Simulation(world),core=world.buildings.find(site=>site.id==='core-main')!;
  const publicFloor=core.floors-1;assert(canAccessFloor(core,publicFloor,sim.state.player),'the traveler fixture uses the actual public observation floor');
  const position={x:core.position.x,y:core.position.y+core.height/core.floors*publicFloor+.6,z:core.position.z};sim.setFocus(position,'walk');
  for(let tick=0;tick<24;tick++)sim.step(.25);
  sim.state.voxels.push({id:'v2-edit-fixture',position:{x:world.spawn.x,y:world.spawn.y+.2,z:world.spawn.z},color:'#665544'});
  const routedCitizens=sim.state.citizens.filter(person=>person.route && person.route.length>1).length;assert(routedCitizens>0,'the original save must contain actual chosen city routes');
  const before=sim.exportSave(),selected=selectSavedWorld(before);assert.equal(selected.layout,recipe);assert.deepEqual(selected.world,world);
  const restored=new Simulation(selected.world),loaded=restored.importSave(before);assert(loaded.ok,loaded.message);assert.equal(restored.exportSave(),before);assert.deepEqual(restored.state.player.position,position);
  for(let tick=0;tick<24;tick++){sim.step(.25);restored.step(.25);}assert.equal(restored.exportSave(),sim.exportSave());
  for(const layout of ['current-v3','current-v4'] as const){const newCity=new Simulation(createWorld(20261001,layout)),newCityBefore=newCity.exportSave();assert.equal(newCity.importSave(before).ok,false);assert.equal(newCity.exportSave(),newCityBefore,`a v2 profile cannot be partially loaded or teleported into a ${layout} city`);}
  const disguised=JSON.parse(before);disguised.layoutVersion='current-v4';disguised.terrain={algorithm:'foreign',heightfield:[1,2,3]};disguised.architecture={algorithm:'foreign',floorPlanProfile:'v4-program-bodies-02'};disguised.world={...createWorld(20261001,'current-v4')};
  assert.equal(selectSavedWorld(JSON.stringify(disguised)).layout,recipe);
  const original=JSON.parse(before);evidence.push({check:'actual-v2-full-save-upper-floor-voxel-finance-routes-continuation',layout:selected.layout,worldFingerprint:original.worldFingerprint,originalPosition:position,restoredPosition:JSON.parse(restored.exportSave()).state.player.position,wallet:original.state.player.money,treasury:original.state.treasury,bankCash:original.state.banking.cash,fullSaveSha256:sha256(before),chosenRoutes:routedCitizens,voxelEdits:original.state.voxels.length,exactFullRoundTrip:true,continuationTicks:24,exactFullContinuation:true,wrongV3ImportAtomicRejected:true,wrongV4ImportAtomicRejected:true,foreignLabelsIgnored:true});
  }
});

test('a known legacy journey keeps its geometry, financial state, routes, upper floor and edited blocks', () => {
  const world = createWorld(20261001, 'legacy-ee3e7a1'), sim = new Simulation(world);
  assert.equal(savedWorldFingerprint(world), 'c519111b', 'trusted original main and ee3e7a1 geometry, checked against both Git sources');
  const core = world.buildings.find(site => site.id === 'core-main')!;
  const position = { x: core.position.x, y: core.position.y + core.height / core.floors * 25 + .6, z: core.position.z };
  sim.setFocus(position, 'walk');
  const firstCitizen = sim.state.citizens[0], home = world.buildings.find(site => site.id === firstCitizen.homeId)!;
  sim.state.voxels.push({ id: 'voxel-legacy-fixture', position: { x: home.position.x, y: home.position.y + .2, z: home.position.z }, color: '#665544' });
  const before = sim.exportSave(), selected = selectSavedWorld(before);
  assert.equal(selected.layout, 'legacy-ee3e7a1');
  assert.deepEqual(selected.world.buildings, world.buildings); assert.deepEqual(selected.world.edges, world.edges);
  const restored = new Simulation(selected.world), result = restored.importSave(before); assert.equal(result.ok, true, result.message);
  assert.equal(restored.exportSave(), before); assert.deepEqual(restored.state.player.position, position);
  assert.equal(restored.state.voxels[0].position.y, home.position.y + .2);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), sim.exportSave());
  const current=new Simulation(createWorld()),currentBefore=current.exportSave();assert.equal(current.importSave(before).ok,false);assert.equal(current.exportSave(),currentBefore);
  const disguised=JSON.parse(before);disguised.layoutVersion='current-v4';disguised.architecture={algorithm:'external'};disguised.world=createWorld();assert.equal(selectSavedWorld(JSON.stringify(disguised)).layout,'legacy-ee3e7a1');
  evidence.push({check:'actual-legacy-full-save-after-v4-upper-floor-voxel-finance-route-preservation',originalSha256:sha256(before),continuationSha256:sha256(sim.exportSave()),exactRoundTrip:true,continuationTicks:24,exactFullContinuation:true,newV4ImportAtomicRejected:true,externalArchitectureIgnored:true});
});

test('a legacy public-floor traveler save includes actual chosen routes and exact partitioned 24-tick continuation', () => {
  const world=createWorld(20261001,'legacy-ee3e7a1'),sim=new Simulation(world),core=world.buildings.find(b=>b.id==='core-main')!,publicFloor=core.floors-1;
  assert(canAccessFloor(core,publicFloor,sim.state.player));const position={x:core.position.x,y:core.position.y+.6+publicFloor*core.height/core.floors,z:core.position.z};sim.setFocus(position,'walk');
  for(let tick=0;tick<24;tick++)sim.step(.25);
  const chosenRoutes=sim.state.citizens.filter(person=>person.route&&person.route.length>1).length;assert(chosenRoutes>0);
  const json=sim.exportSave(),selected=selectSavedWorld(json);assert.equal(selected.layout,'legacy-ee3e7a1');assert.deepEqual(selected.world,world);assert.equal(assembleSave(partitionSave(json,world)),json);
  const restored=new Simulation(selected.world),loaded=restored.importSave(json);assert(loaded.ok,loaded.message);assert.equal(restored.exportSave(),json);assert.deepEqual(restored.state.player.position,position);
  const start=sim.state.tick;for(let tick=0;tick<24;tick++){sim.step(.25);restored.step(.25);}assert.equal(sim.state.tick,start+24);assert.equal(restored.exportSave(),sim.exportSave());assert.equal(assembleSave(partitionSave(sim.exportSave(),world)),sim.exportSave());
  evidence.push({check:'actual-legacy-public-floor-routes-and-partitioned-continuation',publicFloor,chosenRoutes,originalSha256:sha256(json),continuationSha256:sha256(sim.exportSave()),exactRoundTrip:true,exactPartitionReassembly:true,continuationTicks:24,exactFullContinuation:true,scope:'CPU fixture at an authorized public floor; not normal browser walking'});
});

test('the original native r5 export selects its historical recipe and continues 24 actual ticks after v4', () => {
  const json=gunzipSync(readFileSync(new URL('./fixtures/world-layout/r5-native-ui-export-coherent02.json.gz',import.meta.url))).toString('utf8');
  const originalSha256='7ba76f550f9f5413cd712022b751599340cc24e9e48327674f88b2c122af6fe9';assert.equal(Buffer.byteLength(json),1798521);assert.equal(sha256(json),originalSha256);
  const saved=JSON.parse(json),selected=selectSavedWorld(json);assert.equal(selected.layout,'current-v2-r5');assert.equal(selected.world.layoutVersion,'current-v2');assert.equal(savedWorldFingerprint(selected.world),'c70ebca5');
  const left=new Simulation(selected.world),right=new Simulation(selected.world);for(const sim of [left,right]){const loaded=sim.importSave(json);assert(loaded.ok,loaded.message);assert.equal(sim.exportSave(),json);}
  const parts=partitionSave(json,selected.world);assert.equal(assembleSave(parts),json);
  const player=JSON.parse(parts.find(p=>p.id==='player')!.json);assert.deepEqual(player.values['state.player'],saved.state.player);assert.deepEqual(player.values['state.playerLabor'],saved.state.playerLabor);assert.deepEqual(player.arrays['state.clinical.orders'],[]);
  const current=new Simulation(createWorld()),before=current.exportSave();assert.equal(current.importSave(json).ok,false);assert.equal(current.exportSave(),before);
  const disguised=JSON.parse(json);disguised.layoutVersion='current-v4';disguised.architecture={algorithm:'foreign'};disguised.world=createWorld();assert.equal(selectSavedWorld(JSON.stringify(disguised)).layout,'current-v2-r5');
  for(const sim of [left,right])assert(sim.command({type:'pause',value:0}).ok);
  const ticks=[];for(let index=0;index<24;index++){left.step(.25);right.step(.25);const actual=left.exportSave();assert.equal(actual,right.exportSave());assert.equal(left.state.tick,saved.state.tick+index+1);ticks.push({tick:left.state.tick,sha256:sha256(actual)});}
  assert.equal(assembleSave(partitionSave(left.exportSave(),selected.world)),left.exportSave());
  evidence.push({check:'original-native-r5-browser-export-after-v4-actual-continuation',originalSha256,bytes:Buffer.byteLength(json),historicalRecipe:selected.layout,worldFingerprint:saved.worldFingerprint,actualOriginalPosition:saved.state.player.position,wallet:saved.state.player.money,homeId:saved.state.player.homeId,tick:saved.state.tick,day:saved.state.day,hour:saved.state.hour,exactRoundTrip:true,exactPartitionReassembly:true,newV4ImportAtomicRejected:true,externalArchitectureIgnored:true,continuation:'CPU instances unpaused by the public pause command; not browser walking',ticks});
});

test('an imported label or arbitrary geometry cannot relax unknown-world or corrupt-save rejection', () => {
  const world = createWorld(20261001, 'legacy-ee3e7a1'), sim = new Simulation(world), before = sim.exportSave();
  const known = JSON.parse(before); known.layoutVersion = 'invented'; known.world = { buildings: [] };
  assert.equal(selectSavedWorld(JSON.stringify(known)).layout, 'legacy-ee3e7a1', 'only the regenerated fingerprint selects a world');
  for (const change of [
    (data: any) => { data.worldFingerprint = 'ffffffff'; },
    (data: any) => { data.worldSeed++; },
    (data: any) => { data.worldSeed = -1; data.state.seed = -1; },
    (data: any) => { data.worldSeed = Number.MAX_SAFE_INTEGER; data.state.seed = data.worldSeed; },
    (data: any) => { data.format = 'other'; },
    (data: any) => { data.version++; },
  ]) {
    const invalid = JSON.parse(before); change(invalid);
    assert.throws(() => selectSavedWorld(JSON.stringify(invalid))); assert.equal(sim.exportSave(), before);
  }
  const corrupt = JSON.parse(before); corrupt.state.player.money = -1;
  const selected = selectSavedWorld(JSON.stringify(corrupt));
  const restored = new Simulation(selected.world), original = restored.exportSave();
  assert.equal(restored.importSave(JSON.stringify(corrupt)).ok, false); assert.equal(restored.exportSave(), original);
});
