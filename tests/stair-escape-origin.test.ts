import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { canAccessFloor } from '../src/access';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { buildingLocalPosition, buildingWorldPosition, blocksFloorPlanMovement, canStandInFloorPlan, familyOf, findBuildingFloorPlanRoute, findFloorPlanRoute, floorPlanSupport, getBuildingFloorPlan, getFloorPlanStairPosition, getFloorPlanStairRoute, getBuildingEntrance } from '../src/architecture-floor-plan';
import { homeRestPoints, homeRestPointBlockedByVoxels } from '../src/simulation/home-rest';
import type { Building, Vec3, WorldDefinition } from '../src/types';

const captured=JSON.parse(fs.readFileSync(new URL('./fixtures/stair-escape-root07.json',import.meta.url),'utf8'));
const actual=captured.provenance.deathBeforePosition as Vec3;
const world=createWorld(captured.provenance.worldSeed,'current-v6');
const home=world.buildings.find(b=>b.id===captured.provenance.homeId)!;
assert.deepEqual(home,captured.building,'the actual native building is not silently repaired');
assert.equal(savedWorldFingerprint(world),captured.provenance.worldFingerprint);
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const evidence=(name:string,value:unknown)=>{
  const directory=process.env.YUNSHAN_STAIR_ESCAPE_EVIDENCE;if(!directory)return;
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name),typeof value==='string'?value:JSON.stringify(value,null,2));
};
/** Full .35m footprint and 1.72m clearance at every <=.05m sample. A route
 * ending at a ground door may extend onto its existing exterior approach;
 * that short segment is separately traversed by the actual controller below. */
function inspectRoute(b:Building,route:Vec3[],allowExteriorDoor=false) {
  let samples=0,exteriorSamples=0,maxRise=0,maxSupportGap=0,rawSegmentBlockedSamples=0;
  let previousFeet:Vec3|undefined;
  for(let index=1;index<route.length;index++){
    const a=route[index-1],z=route[index],steps=Math.max(1,Math.ceil(distance(a,z)/.05));let previousReference=a;
    for(let step=0;step<=steps;step++){
      const t=step/steps,p={x:a.x+(z.x-a.x)*t,y:a.y+(z.y-a.y)*t,z:a.z+(z.z-a.z)*t};
      const nominal=Math.round((p.y-b.position.y-.6)/(b.height/b.floors));
      const supported=[nominal,nominal-1,nominal+1].map(f=>floorPlanSupport(b,f,p,.35)).find(s=>s&&Math.abs(s.y-p.y)<=.22000001);
      let feet=p,floor=0;
      if(supported){
        floor=supported.floor;feet={...p,y:supported.y};maxSupportGap=Math.max(maxSupportGap,Math.abs(supported.y-p.y));
        // Canonical waypoint lines are reference positions between tread tops.
        // The normal controller stands at the real support height. Keep raw
        // collision observations separate rather than falsely calling them clear.
        if(blocksFloorPlanMovement(b,floor,previousReference,p,.35,1.72))rawSegmentBlockedSamples++;
      }else{
        const local=buildingLocalPosition(b,p),entrance=buildingLocalPosition(b,getBuildingEntrance(b));
        assert(allowExteriorDoor&&Math.abs(local.y)<1e-7&&local.z>=entrance.z-.35-1e-7&&local.z<=buildingLocalPosition(b,b.door).z+1e-7&&Math.abs(local.x-entrance.x)<1e-7,'no unsupported interior route');
        exteriorSamples++;
      }
      assert.equal(blocksFloorPlanMovement(b,floor,feet,feet,.35,1.72),false,`${b.id}: physical support-height body clearance`);
      if(previousFeet){
        assert.equal(blocksFloorPlanMovement(b,floor,previousFeet,feet,.35,1.72),false,`${b.id}: physical support-height movement ${JSON.stringify({index,step,previousFeet,feet,floor})}`);
        maxRise=Math.max(maxRise,Math.abs(feet.y-previousFeet.y));assert(maxRise<=.20000001,'physical stance never rises/falls beyond a .2m tread');
      }
      samples++;previousReference=p;previousFeet=feet;
    }
  }
  return {samples,exteriorSamples,maxRise,maxSupportGap,rawSegmentBlockedSamples,scope:'Physical support-height stances plus separate raw waypoint reference collision observations; exterior ground approach requires actual W proof'};
}

function controllerFixture(w:WorldDefinition,run:(controller:PlayerController,keys:EventTarget)=>void,allowed:(b:Building,f:number)=>boolean=()=>true){
  const keys=Object.assign(new EventTarget(),{closest:()=>null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:keys,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
  const controller=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,w,()=>{},allowed);
  try{run(controller,keys);}finally{controller.dispose();if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');}
}
function walk(c:PlayerController,keys:EventTarget,route:Vec3[]){
  const event=(type:string)=>{const e=new Event(type);Object.assign(e,{code:'KeyW',repeat:false});keys.dispatchEvent(e);};
  let steps=0,maxRise=0,maxHorizontal=0;event('keydown');
  try{for(let index=1;index<route.length;index++){
    const target=route[index];let segmentSteps=0;
    while(Math.hypot(c.position.x-target.x,c.position.z-target.z)>.025){
      const before=c.position,dx=target.x-before.x,dz=target.z-before.z,length=Math.hypot(dx,dz);
      c.yaw=Math.atan2(-dx,-dz);c.step(Math.min(.015,length/4.8),false);
      const horizontal=Math.hypot(c.position.x-before.x,c.position.z-before.z),rise=Math.abs(c.position.y-before.y);
      assert(horizontal>.00001,`actual W blocked: ${JSON.stringify({before,target,floor:c.floor})}`);
      assert(horizontal<=.07200001,'normal 4.8m/s speed');assert(rise<=.20000001,'real .2m treads');
      maxRise=Math.max(maxRise,rise);maxHorizontal=Math.max(maxHorizontal,horizontal);assert(++segmentSteps<3000);steps++;
    }
  }}finally{event('keyup');}
  return {steps,maxRise,maxHorizontal};
}

test('actual ROOT07 upper stair exit reaches every legal bed and ground door with complete physical routes',()=>{
  assert.equal(captured.provenance.deathTick,9559);
  const support=floorPlanSupport(home,1,actual,.35)!;
  assert.equal(support.kind,'stairs');assert.equal(support.floor,1);assert.equal(support.y,80);assert.equal(support.link,undefined,'unchanged slab-selected support descriptor');
  const local=buildingLocalPosition(home,actual);assert.equal(canStandInFloorPlan(getBuildingFloorPlan(home,1)!,local.x,local.z,.35),false);
  assert.equal(blocksFloorPlanMovement(home,1,actual,actual,.35,1.72),false);
  const beds=Array.from({length:home.floors},(_,f)=>homeRestPoints(home,f)).flat().filter(p=>canAccessFloor(home,p.floor,{role:'merchant',identities:['merchant']})&&!homeRestPointBlockedByVoxels(p.position,captured.terminalVoxels));
  assert.equal(beds.length,24);
  const paths=[];
  for(const bed of beds){
    const route=findBuildingFloorPlanRoute(home,1,bed.floor,actual,bed.position,.35);assert(route,`${bed.id}: supported top exit must escape`);
    assert.deepEqual(route[0],actual);assert.deepEqual(route.at(-1),bed.position);const inspection=inspectRoute(home,route);
    paths.push({target:bed,route,inspection});
  }
  const door=findBuildingFloorPlanRoute(home,1,0,actual,home.door,.35);assert(door);assert.deepEqual(door[0],actual);assert.deepEqual(door.at(-1),home.door);
  const doorInspection=inspectRoute(home,door,true);assert(findFloorPlanRoute(home,1,actual,beds.find(b=>b.floor===1)!.position,.35),'same-floor API shares the same escape');
  evidence('actual-root07-bed-and-door-routes.json',{scope:captured.provenance.scope,provenance:captured.provenance,unchangedSupport:support,paths,door,doorInspection});
});

test('generic real upper exits and lateral supported origins recover in both directions without skipping the checked connector',()=>{
  const families=['home','market','workshop','civic-academy','finance-health','transport-waterfront'];const selected:Building[]=[];
  for(const family of families){const site=world.buildings.find(b=>familyOf(b)===family&&b.floors>1&&getFloorPlanStairRoute(b,0,1));assert(site);selected.push(site);}
  selected.push(world.buildings.find(b=>b.commercialGeometryRevision===1)!);
  const rows=[];let recoveredWithoutLink=0,lateralOrigins=0;
  for(const b of selected){
    const canonical=getFloorPlanStairRoute(b,0,1)!,a=canonical.at(-3)!,z=canonical.at(-2)!;
    for(const fraction of [.15,.35,.6])for(const offset of [0,.15,-.15]){
      const local=buildingLocalPosition(b,{x:a.x+(z.x-a.x)*fraction,y:a.y+(z.y-a.y)*fraction,z:a.z+(z.z-a.z)*fraction});
      local.x+=offset;const origin=buildingWorldPosition(b,local),support=floorPlanSupport(b,1,origin,.35);
      if(!support||blocksFloorPlanMovement(b,1,origin,origin,.35,1.72))continue;
      for(const floor of [0,1]){
        const target=getFloorPlanStairPosition(b,floor),route=findBuildingFloorPlanRoute(b,1,floor,origin,target,.35);assert(route,`${b.id}/${fraction}/${offset}/${floor}`);
        assert.deepEqual(route[0],origin);assert.deepEqual(route.at(-1),target);const inspection=inspectRoute(b,route);
        rows.push({building:b.id,family:familyOf(b),commercial:b.commercialGeometryRevision===1,fraction,offset,floor,origin,support,route,inspection});
      }
      if(offset)lateralOrigins++;
      if(!support.link&&!canStandInFloorPlan(getBuildingFloorPlan(b,1)!,local.x,local.z,.35))recoveredWithoutLink++;
    }
  }
  assert(rows.length>=42,'all seven original building examples exercised both directions');assert(recoveredWithoutLink>0);assert(lateralOrigins>0);
  evidence('generic-upper-exit-and-lateral-routes.json',{scope:'Controlled samples on original trusted physical stair surfaces; no new world geometry',rows,recoveredWithoutLink,lateralOrigins});
});

test('actual upper exit escapes by continuous normal W to a bed and the real door, retaining upper ACL',()=>{
  const bed=homeRestPoints(home,1)[0];const counts:{target:string;steps:number;maxRise:number;maxHorizontal:number}[]=[];
  controllerFixture(world,(c,keys)=>{
    c.setMode('walk',actual);assert.deepEqual(c.position,actual);assert.equal(c.floor,1);
    const toBed=findBuildingFloorPlanRoute(home,1,1,c.position,bed.position,.35)!;assert(toBed);counts.push({target:'bed',...walk(c,keys,toBed)});
    assert.equal(c.floor,1);assert(distance(c.position,bed.position)<.03);
    const toDoor=findBuildingFloorPlanRoute(home,1,0,c.position,home.door,.35)!;assert(toDoor);counts.push({target:'door',...walk(c,keys,toDoor)});
    assert.equal(c.floor,0);assert(distance(c.position,home.door)<.03);
  },(_site,f)=>f<=1);
  controllerFixture(world,(c,keys)=>{
    c.setMode('walk',actual);const route=findBuildingFloorPlanRoute(home,1,2,c.position,getFloorPlanStairPosition(home,2),.35)!;assert(route);
    const e=new Event('keydown');Object.assign(e,{code:'KeyW',repeat:false});keys.dispatchEvent(e);
    let index=1;for(let step=0;step<500;step++){const target=route[index];if(Math.hypot(c.position.x-target.x,c.position.z-target.z)<.03){index++;if(index===route.length)break;continue;}c.yaw=Math.atan2(-(target.x-c.position.x),-(target.z-c.position.z));c.step(.015,false);}
    const up=new Event('keyup');Object.assign(up,{code:'KeyW',repeat:false});keys.dispatchEvent(up);assert.equal(c.floor,1);assert(c.blockedAccess,'same upper floor permission guard is retained');
  },(_site,f)=>f<=1);
  evidence('actual-W-bed-door-receipt.json',{scope:'One controlled legal actual start, CPU EventTarget W; no normal URL, natural economic or predeath replay claim',counts,noResetBetweenBedAndDoor:true});
});

test('unsupported openings and externally blocked recovery connectors remain rejected',()=>{
  assert.equal(findBuildingFloorPlanRoute(home,1,0,actual,home.door,.35,()=>true),null);
  assert.equal(findFloorPlanRoute(home,1,actual,homeRestPoints(home,1)[0].position,.35,()=>true),null);
  let blockedDoorSegments=0;
  assert.equal(findBuildingFloorPlanRoute(home,1,0,actual,home.door,.35,(_a,z)=>{const blocked=distance(z,home.door)<1e-7;if(blocked)blockedDoorSegments++;return blocked;}),null,'complete recovery guard includes the final door tail');
  assert(blockedDoorSegments>0,'the actual external tail was checked and refused');
  const top=getBuildingFloorPlan(home,home.floors-1)!,unsupported=buildingWorldPosition(home,{x:top.stair.x-1,y:top.y,z:top.stair.z+2});
  assert.equal(floorPlanSupport(home,top.floor,unsupported,.35),null);assert.equal(findBuildingFloorPlanRoute(home,top.floor,0,unsupported,home.door,.35),null);
  const partial=buildingWorldPosition(home,{x:top.stairHole!.x0+.1,y:top.y,z:top.stairHole!.z0+1});
  assert.equal(floorPlanSupport(home,top.floor,partial,.35),null);assert.equal(findBuildingFloorPlanRoute(home,top.floor,top.floor,partial,getFloorPlanStairPosition(home,top.floor),.35),null);
});

test('actual ROOT07 terminal full and partition readers preserve the existing death and complete24future ticks',()=>{
  const raw=gunzipSync(fs.readFileSync(new URL('./fixtures/stair-escape-root07-final.save.json.gz',import.meta.url))).toString('utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'),captured.provenance.terminalSaveSHA256);
  const live=new Simulation(world),reader=new Simulation(world);assert.equal(live.importSave(raw).ok,true);assert.equal(reader.importSave(raw).ok,true);
  assert.equal(live.exportSave(),raw);assert.equal(reader.exportSave(),raw);assert.equal(assembleSave(partitionSave(raw,world)),raw);
  assert.equal(live.state.extension!.actorProfiles[captured.provenance.deathId].alive,false,'a route fix does not revive a terminal death');
  const ticks=[];
  for(let tick=0;tick<24;tick++){
    live.step(.25);reader.step(.25);const text=live.exportSave();assert.equal(reader.exportSave(),text,`current reader full future tick ${tick+1}`);assert.equal(assembleSave(partitionSave(text,world)),text);
    assert.equal(live.state.extension!.actorProfiles[captured.provenance.deathId].alive,false);ticks.push({tick:live.state.tick,alive:live.state.citizens.filter(c=>live.state.extension!.actorProfiles[c.id].alive).length});
  }
  evidence('actual-terminal-after24.save.json',live.exportSave());evidence('actual-terminal-reader24-receipt.json',{scope:'True terminal old writer and current routing reader, no revived actor or predeath replay',openingSHA256:captured.provenance.terminalSaveSHA256,immediateExact:true,partitionExact:true,full24Exact:true,ticks});
});


test('partially blocked nearest attachment selects another fully supported real connector and malformed exit is finitely rejected',()=>{
  const origin={...actual,x:actual.x+.15},nearest={...actual};assert(floorPlanSupport(home,1,origin,.35));
  let rejected=0;
  const blockNearest=(a:Vec3,z:Vec3)=>{const blocked=distance(a,origin)<1e-7&&distance(z,nearest)<1e-7;if(blocked)rejected++;return blocked;};
  const target=getFloorPlanStairPosition(home,1),route=findBuildingFloorPlanRoute(home,1,1,origin,target,.35,blockNearest);assert(route);assert(rejected>0,'nearest legal static attachment was genuinely blocked by the caller');
  assert(distance(route[1],nearest)>1e-7,'actual returned route uses another checked connector');
  for(let i=1;i<route.length;i++)assert.equal(blockNearest(route[i-1],route[i]),false);
  const inspection=inspectRoute(home,route);
  // Public FloorPlan objects are mutable, so a controlled malformed descriptor
  // must fail at its non-planar canonical exit rather than recurse or snap feet.
  const malformed=structuredClone(home);for(const floor of [0,1])getBuildingFloorPlan(malformed,floor)!.stair.z+=.6;
  assert.equal(findBuildingFloorPlanRoute(malformed,1,1,actual,getFloorPlanStairPosition(malformed,1),.35),null);
  evidence('partial-block-and-malformed-exit.json',{scope:'Controlled callback refuses one attachment; distinct physical alternate retained. Separate controlled descriptor mutation is a negative input, not a world change.',origin,nearest,rejected,route,inspection,malformedRejected:true});
});

test('controlled fresh living native citizen uses ordinary needs scheduling to leave the actual stair point and rest at a real bed',()=>{
  const sim=new Simulation(world),citizen=sim.state.citizens.find(c=>c.id===captured.provenance.deathId)!,profile=sim.state.extension!.actorProfiles[citizen.id];
  const initial=structuredClone(citizen),initialProfile=structuredClone(profile);assert.equal(profile.alive,true);
  citizen.position={...actual};citizen.needs.fatigue=0;
  assert.equal(citizen.money,initial.money);assert.equal(citizen.role,initial.role);assert.equal(citizen.homeId,initial.homeId);assert.equal(citizen.workId,initial.workId);assert.deepEqual(profile,initialProfile);
  evidence('controlled-living-opening.save.json',sim.exportSave());
  const rows=[];let reached=false;
  for(let tick=0;tick<120;tick++){
    sim.step(.25);assert.equal(profile.alive,true);assert.notEqual(citizen.state,'unreachable','normal destination writer must not re-trap the supported actor');
    const atBed=homeRestPoints(home,Math.round((citizen.position.y-home.position.y-.6)/(home.height/home.floors))).some(p=>distance(p.position,citizen.position)<.4);
    rows.push({tick:sim.state.tick,position:{...citizen.position},state:citizen.state,destination:citizen.destinationId,fatigue:citizen.needs.fatigue,health:profile.health,atBed});
    if(atBed&&citizen.state==='atHome'&&citizen.needs.fatigue>.1){reached=true;break;}
  }
  evidence('controlled-living-after.save.json',sim.exportSave());evidence('controlled-living-ordinary-rest.json',{scope:'Fresh original living citizen and original wallet/role/home/work/health; controlled one initial legal pose and low fatigue, then only ordinary .25 minute ticks. This is not predeath tick9558 replay or a natural14day run.',initialMoney:initial.money,initialRole:initial.role,initialHealth:initialProfile.health,rows,reached});
  assert(reached,'actual bed-side arrival must earn real fatigue recovery within the bounded normal schedule');assert(citizen.needs.fatigue>.1);
});
