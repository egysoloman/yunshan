import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createWorld, getWalkHeight, terrainHeight, findPath } from '../src/world';
import { getBuildingBody, getBuildingFloorPlan, getBuildingEntrance, getBuildingUsePoints, floorPlanSupport, getFloorPlanRoofSupport, buildingWorldPosition, buildingLocalPosition, blocksFloorPlanMovement, findFloorPlanRoute } from '../src/architecture-floor-plan';
import { savedWorldFingerprint, selectSavedWorld } from '../src/persistence/world-layout';
import { canAccessFloor } from '../src/access';
import { Simulation } from '../src/simulation';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import type { Vec3 } from '../src/types';

const digest=(json:string)=>createHash('sha256').update(json).digest('hex');
const near=(a:number,b:number,label:string)=>assert(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);
const evidence:Record<string,unknown>[]=[];
after(()=>{const dir=new URL('../artifacts/',import.meta.url);mkdirSync(dir,{recursive:true});writeFileSync(new URL(process.env.YUNSHAN_WORLD_V4_EVIDENCE??'world-v4-results.json',dir),JSON.stringify({at:new Date().toISOString(),environment:'trusted generated world, CPU occupied surface queries and full Simulation save; no GL, browser-profile access or far-region statistical simulation',evidence},null,2));});

test('v4 is a deterministic physical building opt-in while inheriting the complete v3 landscape and graph', () => {
  for(const seed of [20261001,7,2024]){
    const world=createWorld(seed,'current-v4'),old=createWorld(seed,'current-v3');
    assert.equal(world.layoutVersion,'current-v4');assert.equal(world.buildings.length,612);
    const oldBodies=world.buildings.map(({floorPlanProfile,functionPoints,...original})=>original);
    assert.deepEqual(oldBodies,old.buildings,'the footprint placement, dimensions and real south entrances are retained');
    assert.deepEqual(world.nodes,old.nodes);assert.deepEqual(world.edges,old.edges);assert.deepEqual(world.spawn,old.spawn);
    assert.equal(digest(JSON.stringify(createWorld(seed,'current-v4'))),digest(JSON.stringify(world)));
    assert.notEqual(savedWorldFingerprint(world),savedWorldFingerprint(old));
    for(let z=-2100;z<=2100;z+=150)for(let x=-2100;x<=2100;x+=150)assert.equal(terrainHeight(world,x,z),terrainHeight(old,x,z),'v4 introduces rooms, not a second terrain revision');
    let markedBuildings=0,usePoints=0;
    for(const building of world.buildings){
      if(building.kind==='core'||building.kind==='pavilion'){
        assert.equal(getBuildingBody(building),null);assert(!Object.hasOwn(building,'floorPlanProfile'));assert(!Object.hasOwn(building,'functionPoints'));continue;
      }
      assert.equal(building.floorPlanProfile,'v4-program-bodies-02');assert(getBuildingBody(building));
      markedBuildings++;
      const entrance=getBuildingEntrance(building);near(entrance.x,building.door.x,'door x');near(entrance.y,building.door.y,'door y');near(entrance.z,building.door.z,'door z');
      const ground=getBuildingFloorPlan(building,0)!;assert(ground.walls.some(w=>w.opening?.use==='entrance'),'the entrance must be an actual wall opening, not a fallback copy of the old door');
      const localEntrance=buildingLocalPosition(building,entrance),inner=buildingWorldPosition(building,{...localEntrance,z:localEntrance.z-1}),outer=buildingWorldPosition(building,{...localEntrance,z:localEntrance.z+1});
      assert(floorPlanSupport(building,0,inner),'the actual doorway has a supported inner landing');assert(!blocksFloorPlanMovement(building,0,outer,inner,.35),'a full-radius body can cross the actual door cut');
      const node=world.nodes.find(n=>n.id===`${building.id}-door`)!;assert.deepEqual(node.position,building.door);
      const street=world.edges.find(e=>e.mode==='road'&&e.from===node.id)!;assert(street);assert.deepEqual(street.points[0],building.door);assert(findPath(world,node.id,'market-station').length>1);
      const declared=Array.from({length:building.floors},(_,floor)=>getBuildingUsePoints(building,floor)).flat();assert.deepEqual(building.functionPoints,declared);assert(declared.length>=building.floors);
      const ids=new Set<string>();
      for(const point of declared){
        usePoints++;
        assert(!ids.has(`${point.floor}:${point.id}`));ids.add(`${point.floor}:${point.id}`);assert(['work','service','sale'].includes(point.purpose));
        const support=floorPlanSupport(building,point.floor,point.position);assert(support,`${building.id}:${point.id}: use point has real body support`);
        near(getWalkHeight(world,point.position.x,point.position.z,point.position.y),support.y,`${building.id}:${point.id}: shared occupied surface`);
      }
    }
    evidence.push({check:'v4-actual-rooms-usepoints-and-real-door-road-connection',seed,worldSha256:digest(JSON.stringify(world)),v3Fingerprint:savedWorldFingerprint(old),v4Fingerprint:savedWorldFingerprint(world),markedBuildings,usePoints,unchangedTerrainSamples:841,oldUnmarkedFieldsAndGraphExact:true});
  }
});

test('the six v4 building families join their real ground use points to the city entrance through shared walls', () => {
  const world=createWorld(20261001,'current-v4'),ids=['west-b0','market-b0','workshop-b0','academy-b0','market-b3','river-b0'];
  for(const id of ids){const building=world.buildings.find(b=>b.id===id)!;assert(building.floorPlanProfile);const entrance=getBuildingEntrance(building);
    for(const point of building.functionPoints!.filter(p=>p.floor===0)){
      const route=findFloorPlanRoute(building,0,entrance,point.position,.35);assert(route&&route.length>=2,`${id}:${point.id} must be reachable through actual rooms`);
      assert.deepEqual(route[route.length-1],point.position);
      for(let index=1;index<route.length;index++)assert(!blocksFloorPlanMovement(building,0,route[index-1],route[index],.35),`${id}:${point.id} route cannot cross solid walls`);
    }
  }
  evidence.push({check:'six-v4-family-real-entrance-to-ground-use-point-routes',buildingIds:ids,bodyRadius:.35});
});

test('v4 upper courtyards and wings remove actual walking support instead of keeping rectangular ghost rooms', () => {
  const world=createWorld(20261001,'current-v4'),old=createWorld(20261001,'current-v3');
  const building=world.buildings.find(b=>b.id==='west-b0')!,oldBuilding=old.buildings.find(b=>b.id===building.id)!;
  const floor=building.floors-1,y=building.position.y+.6+floor*building.height/building.floors;
  let gap:{x:number;y:number;z:number}|null=null;
  for(let z=-building.depth/2+2;z<building.depth/2-2&&!gap;z+=2)for(let x=-building.width/2+2;x<building.width/2-2;x+=2){
    const point={x:building.position.x+x,y,z:building.position.z+z};
    if(!floorPlanSupport(building,floor,point,0)&&getWalkHeight(world,point.x,point.z,y)<y-1){gap=point;break;}
  }
  assert(gap,'the new roof/room outline must contain a real unsupported upper void');
  near(getWalkHeight(old,gap.x,gap.z,y),oldBuilding.position.y+.6+floor*oldBuilding.height/oldBuilding.floors,'the frozen v3 rectangle remains occupiable');
  const work=building.functionPoints!.find(p=>p.floor===floor)!;assert(floorPlanSupport(building,floor,work.position));near(getWalkHeight(world,work.position.x,work.position.z,work.position.y),work.position.y,'the retained room still has support');
  evidence.push({check:'v4-actual-upper-void-lacks-rectangle-support',buildingId:building.id,floor,point:gap,v3WalkingHeight:getWalkHeight(old,gap.x,gap.z,y),v4WalkingHeight:getWalkHeight(world,gap.x,gap.z,y),occupiedPoint:work});
});

test('an absent v4 upper wing exposes its real lower roof or open ground courtyard slab', () => {
  const world=createWorld(20261001,'current-v4'),building=world.buildings.find(b=>b.id==='west-b0')!,floor=building.floors-1;
  assert(floor>=2);const y=floor*building.height/building.floors;
  let room:Vec3|null=null,court:Vec3|null=null;
  for(let z=-building.depth/2+1;z<building.depth/2-1;z+=1)for(let x=-building.width/2+1;x<building.width/2-1;x+=1){
    const position=buildingWorldPosition(building,{x,y,z});
    if(floorPlanSupport(building,floor,position,0))continue;
    const lower=[];for(let candidate=floor-1;candidate>=0;candidate--){const support=floorPlanSupport(building,candidate,position,0);if(support){lower.push(support);break;}}
    const support=lower[0];
    if(!room&&support?.floor===1&&support.kind==='room'&&floorPlanSupport(building,1,{...position,y:support.y}))room=position;
    if(!court&&support?.floor===0&&support.kind==='courtyard'&&floorPlanSupport(building,0,{...position,y:support.y})&&!getFloorPlanRoofSupport(building,position,0))court=position;
  }
  assert(room,'the changed home outline has an upper void over an intact lower room');assert(court,'the open court reaches its real ground slab');
  const roomSupport=floorPlanSupport(building,1,room,0)!,courtSupport=floorPlanSupport(building,0,court,0)!;
  const roof=getFloorPlanRoofSupport(building,room,0);assert(roof&&roof.y>roomSupport.y,'the retained lower room has its actual exposed roof above the interior slab');
  near(getWalkHeight(world,room.x,room.z,room.y),roof.y,'the actual lower roof cannot be skipped');
  near(getWalkHeight(world,court.x,court.z,court.y),courtSupport.y,'a courtyard has its actual ground slab');
  evidence.push({check:'v4-upper-void-resolves-actual-lower-roof-and-court-slab',buildingId:building.id,upperFloor:floor,room:{point:room,support:roomSupport,roof},court:{point:court,support:courtSupport}});
});

test('v4 support uses the real yaw footprint and cannot pull feet up to a higher storey', () => {
  const world=createWorld(20261001,'current-v4'),building=world.buildings.find(b=>b.id==='airport-b0')!;
  const upper=building.functionPoints!.find(p=>p.floor===2&&floorPlanSupport(building,1,p.position,0)?.kind==='room')!;assert(upper);
  const reference=upper.position.y-.4*building.height/building.floors,lower=floorPlanSupport(building,1,{...upper.position,y:reference},0)!;assert(lower);
  near(getWalkHeight(world,upper.position.x,upper.position.z,reference),lower.y,'the upper slab is above the actual feet and is not an attractive surface');
  const rotated={...building,rotation:Math.PI/2};
  const point=Array.from({length:building.floors},(_,floor)=>getBuildingUsePoints(rotated,floor)).flat().find(p=>p.floor>0&&Math.abs(p.position.z-rotated.position.z)>rotated.depth/2+.5)!;assert(point,'a wide rotated body extends beyond the old unrotated depth');
  const isolated={...world,buildings:[rotated],nodes:[],edges:[]},support=floorPlanSupport(rotated,point.floor,point.position)!;assert(support);
  near(getWalkHeight(isolated,point.position.x,point.position.z,point.position.y),support.y,'the world broadphase retains the actual rotated wing');
  evidence.push({check:'v4-height-selection-and-yaw-broadphase',buildingId:building.id,reference,underlyingSupport:lower.y,rotatedPosition:point.position,rotatedSupport:support.y});
});

test('v4 fingerprints include generated rooms, permissions and functional points while imported descriptors stay untrusted', () => {
  const world=createWorld(20261001,'current-v4'),original=savedWorldFingerprint(world),first=world.buildings.find(b=>b.floorPlanProfile)!;
  const mutate=(site:typeof first)=>({...world,buildings:world.buildings.map(b=>b.id===site.id?site:b)});
  for(const site of [
    {...first,floorPlanProfile:undefined},
    {...first,seed:first.seed+1},
    {...first,rotation:Math.PI/2},
    {...first,floorPermissions:Array.from({length:first.floors},()=> 'mayor')},
    {...first,functionPoints:first.functionPoints!.map((p,i)=>i===0?{...p,position:{...p.position,x:p.position.x+.2}}:p)},
  ])assert.notEqual(savedWorldFingerprint(mutate(site)),original);
  const body=getBuildingBody(first)!,plan=body.floorPlans.find(p=>p.floor===0)!,opening=plan.walls.find(w=>w.opening?.use==='entrance')!.opening!;
  for(const [object,key]of [[opening,'height'],[plan.interior[0],'x0'],[plan.courtyard[0],'x0'],[plan.stair,'x']] as const){
    const record=object as unknown as Record<string,number>,previous=record[key];assert(Number.isFinite(previous));try{record[key]=previous+.2;assert.notEqual(savedWorldFingerprint(world),original,`actual ${key} geometry participates in the saved identity`);}finally{record[key]=previous;}
    assert.equal(savedWorldFingerprint(world),original);
  }
  assert.equal(savedWorldFingerprint({...world,architecture:{floorPlanProfile:'unknown',rooms:[]},terrain:{algorithm:'unknown'}}as typeof world),original);
  const sim=new Simulation(world),json=sim.exportSave(),foreign=JSON.parse(json);foreign.layoutVersion='legacy-ee3e7a1';foreign.world={buildings:[]};foreign.architecture={algorithm:'unknown',floorPlanProfile:'unknown'};
  const selected=selectSavedWorld(JSON.stringify(foreign));assert.equal(selected.layout,'current-v4');assert.deepEqual(selected.world,world);
  const bad=JSON.parse(json);bad.worldFingerprint=savedWorldFingerprint(mutate({...first,floorPlanProfile:undefined}));bad.layoutVersion='current-v4';bad.world=world;
  assert.throws(()=>selectSavedWorld(JSON.stringify(bad)));const before=sim.exportSave();assert.equal(sim.importSave(JSON.stringify(bad)).ok,false);assert.equal(sim.exportSave(),before);
  evidence.push({check:'v4-generated-body-permissions-points-identity-and-atomic-rejection',fingerprint:original,changedGeometryIdentitiesRejected:true,externalDescriptorsIgnored:true,exactStatePreservedOnFailure:true});
});

test('a complete v4 occupied-floor save reassembles byte-exact and continues every module for 24 ticks', () => {
  const world=createWorld(20261001,'current-v4'),sim=new Simulation(world),building=world.buildings.find(b=>b.id==='west-b0')!;
  const point=building.functionPoints!.find(p=>p.floor===building.floors-1)!;assert(canAccessFloor(building,point.floor,sim.state.player));sim.setFocus(point.position,'walk');
  for(let tick=0;tick<24;tick++)sim.step(.25);
  sim.state.voxels.push({id:'v4-occupied-floor-edit',position:{x:point.position.x+.2,y:point.position.y+.2,z:point.position.z},color:'#665544'});
  const json=sim.exportSave(),selected=selectSavedWorld(json);assert.equal(selected.layout,'current-v4');assert.deepEqual(selected.world,world);
  const partitioned=partitionSave(json,world);assert.equal(assembleSave(partitioned),json);
  const restored=new Simulation(selected.world),loaded=restored.importSave(json);assert(loaded.ok,loaded.message);assert.equal(restored.exportSave(),json);assert.deepEqual(restored.state.player.position,point.position);
  for(let tick=0;tick<24;tick++){sim.step(.25);restored.step(.25);}assert.equal(restored.exportSave(),sim.exportSave());
  assert(sim.state.clinical&&sim.state.banking&&sim.state.family&&sim.state.trade&&sim.state.playerLabor);
  const old=new Simulation(createWorld(20261001,'current-v3')),before=old.exportSave();assert.equal(old.importSave(json).ok,false);assert.equal(old.exportSave(),before);
  evidence.push({check:'v4-complete-occupied-floor-save-and-partition',worldFingerprint:savedWorldFingerprint(world),position:point.position,saveSha256:digest(json),continuationSha256:digest(sim.exportSave()),exactRoundTrip:true,exactPartitionReassembly:true,continuationTicks:24,exactFullContinuation:true,wrongV3ImportAtomicRejected:true});
});
