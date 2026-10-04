import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { createWorld, CITY_LAYOUT_VERSIONS, CURRENT_CITY_LAYOUT } from '../src/world.ts';
import { savedWorldFingerprint, selectSavedWorld } from '../src/persistence/world-layout.ts';
import { COMMERCIAL_TOWER_SITES, commercialNetworkConflicts } from '../src/commercial-district.ts';
import { getBuildingBody, getBuildingFloorPlan, getBuildingEntrance, getBuildingUsePoints, getFloorPlanRoofRegions, getFloorPlanSlabRegions, buildingWorldPosition, floorPlanSupport, blocksFloorPlanMovement, findBuildingFloorPlanRoute, getFloorPlanStairRoute } from '../src/architecture-floor-plan.ts';
import { buildProgramArchitecture } from '../src/rendering/architecture-bodies.ts';
import { PlayerController } from '../src/controller.ts';
import { canAccessFloor } from '../src/access.ts';
import type { Vec3 } from '../src/types.ts';

const historical = JSON.parse(fs.readFileSync(new URL('./fixtures/world-layout/commercial-parent-v5-3ca.json', import.meta.url), 'utf8')) as {layout:(typeof CITY_LAYOUT_VERSIONS)[number];seed:number;sha256:string;bytes:number;fingerprint:string}[];
const distance = (a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const routeLength = (route:Vec3[])=>route.slice(1).reduce((sum,p,index)=>sum+distance(route[index],p),0);

test('all six inherited recipes preserve actual 18 native world texts and fingerprints; v6 stays opt-in',()=>{
  assert.equal(CURRENT_CITY_LAYOUT,'current-v6');
  assert.deepEqual(CITY_LAYOUT_VERSIONS.slice(0,6),['legacy-ee3e7a1','current-v2-r5','current-v2','current-v3','current-v4','current-v5']);
  for(const record of historical){
    const world=createWorld(record.seed,record.layout),text=JSON.stringify(world);
    assert.equal(Buffer.byteLength(text),record.bytes);
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'),record.sha256);
    assert.equal(savedWorldFingerprint(world),record.fingerprint);
    assert.ok(world.buildings.every(site=>site.commercialGeometryRevision===undefined));
    assert.ok(world.buildings.every(site=>site.commercialRouteRevision===undefined));
  }
});

test('v4 commercial high-rise0 remains a real negative; v6 changes only the five named existing banks',()=>{
  const base=createWorld(20261001,'current-v5'),old=createWorld(20261001,'current-v4'),world=createWorld(20261001,'current-v6');
  const commercial=old.buildings.filter(site=>site.kind==='bank'||site.kind==='market');
  assert.equal(commercial.length,141);assert.equal(Math.max(...commercial.map(site=>site.height)),66);
  assert.equal(commercial.filter(site=>site.height>80).length,0);
  assert.equal(world.buildings.length,612);
  const selected=new Set<string>(COMMERCIAL_TOWER_SITES.map(spec=>spec.id));
  for(const site of world.buildings){
    const original=base.buildings.find(b=>b.id===site.id)!;
    if(!selected.has(site.id)){assert.deepEqual(site,original);continue;}
    for(const field of ['id','districtId','name','kind','position','rotation','width','depth','door','capacity','seed'] as const)assert.deepEqual(site[field],original[field],`${site.id}/${field}`);
  }
  assert.deepEqual(world.edges,base.edges);assert.deepEqual(world.nodes,base.nodes);
  assert.deepEqual(world.districts,base.districts);assert.deepEqual(world.mountains,base.mountains);
  assert.deepEqual(world.river,base.river);assert.deepEqual(world.waterfall,base.waterfall);assert.deepEqual(world.spawn,base.spawn);
  const towers=world.buildings.filter(b=>b.commercialGeometryRevision===1);
  assert.equal(towers.filter(site=>site.height>80&&site.floors>=20).length,5);assert.equal(towers.filter(site=>site.height>150).length,1);
  assert.notEqual(savedWorldFingerprint(world),savedWorldFingerprint(base));
  const routeChanged=structuredClone(world);delete routeChanged.buildings.find(b=>b.commercialGeometryRevision===1)!.commercialRouteRevision;
  assert.notEqual(savedWorldFingerprint(world),savedWorldFingerprint(routeChanged),'trusted identity binds route authority');
  const changed=structuredClone(world);delete changed.buildings.find(b=>b.commercialGeometryRevision===1)!.commercialGeometryRevision;
  assert.notEqual(savedWorldFingerprint(changed),savedWorldFingerprint(world),'revision and derived physical descriptor are bound');
});

test('new actual upper floors keep inherited transport corridors clear; a track through a new office is rejected',()=>{
  for(const seed of [20261001,7,2024]){
    const world=createWorld(seed,'current-v6');assert.deepEqual(commercialNetworkConflicts(world),[]);
    const changed=structuredClone(world),site=changed.buildings.find(b=>b.id==='market-b6')!;
    changed.edges.push({id:'negative-track-through-office',from:'a',to:'b',mode:'maglev',length:120,capacity:50,points:[{x:site.position.x-60,y:site.position.y+100,z:site.position.z},{x:site.position.x+60,y:site.position.y+100,z:site.position.z}]});
    assert.ok(commercialNetworkConflicts(changed).some(c=>c.siteId===site.id&&c.edgeId==='negative-track-through-office'));
  }
});

test('every tower floor has physical slab/entry/stair authority and real unobstructed office points, with actual roof height',()=>{
  const world=createWorld(20261001,'current-v6');
  for(const spec of COMMERCIAL_TOWER_SITES){
    const site=world.buildings.find(b=>b.id===spec.id)!,body=getBuildingBody(site)!;
    assert.ok(Math.abs(site.height-spec.floors*spec.storeyHeight)<1e-7);assert.equal(site.stairGeometryRevision,2);assert.equal(body.floorPlans.length,spec.floors);
    assert.ok(distance(getBuildingEntrance(site),site.door)<1e-7,'same physical original entrance; native saved door bytes are compared separately');
    const roofs=getFloorPlanRoofRegions(body),roofTop=site.position.y+.6+Math.max(...roofs.map(roof=>roof.top));
    assert.ok(Math.abs(roofTop-site.position.y-(site.height+1.8))<1e-7,`${site.id}: ground to true gable peak`);
    for(let floor=0;floor<site.floors;floor++){
      const plan=getBuildingFloorPlan(site,floor)!;
      assert.ok(getFloorPlanSlabRegions(plan).length);assert.ok(Math.abs(plan.ceilingY-plan.y-4.4)<1e-7);
      assert.equal(canAccessFloor(site,floor,{role:'traveler'}),true);assert.equal(canAccessFloor(site,site.floors,{role:'traveler'}),false);
      const points=getBuildingUsePoints(site,floor).filter(p=>p.purpose==='work');assert.equal(points.length,floor<2?1:3);
      for(const point of points){
        assert.ok(floorPlanSupport(site,floor,point.position,.35),`${site.id}/${floor}/${point.id}: complete body support`);
        assert.equal(blocksFloorPlanMovement(site,floor,point.position,point.position,.35,1.72),false,'office clear, not a desk-top proxy');
      }
      if(floor+1<site.floors){
        assert.ok(plan.stairHole===null||plan.stairHole.z1>plan.stairHole.z0);
        const stair=getFloorPlanStairRoute(site,floor,floor+1)!;assert.equal(stair.length,10);assert.equal(plan.stairTreads.length,22);
        const before=structuredClone(site);delete before.commercialRouteRevision;
        const original=getFloorPlanStairRoute(before,floor,floor+1)!;assert.equal(original.length,28);
        assert.deepEqual(getBuildingBody(before),getBuildingBody(site),'route compression retains every physical descriptor');
        assert.ok(Math.abs(routeLength(stair)-routeLength(original))<1e-7,'same flight length and turns');
        for(const point of stair)assert.ok(original.some(p=>distance(p,point)<1e-7),'compact route only selects existing physical samples');
        for(const point of stair){
          const expectedFloor=Math.min(site.floors-1,Math.max(0,Math.floor((point.y-site.position.y-.6+1e-7)/4.4)));
          assert.ok(floorPlanSupport(site,expectedFloor,point,.35),`${site.id}: actual tread support ${floor} at ${JSON.stringify(point)}`);
          assert.equal(blocksFloorPlanMovement(site,expectedFloor,point,point,.35,1.72),false,'stairs retain full 1.72m headroom');
        }
      }
    }
    for(const lod of ['near','far'] as const){
      const parts=buildProgramArchitecture(site,lod)!;assert.ok(parts.length>0);
      assert.ok(Math.abs(Math.max(...parts.map(part=>part.position.y+part.size.y/2))-(site.height+1.2))<1e-7,'emitted local peak matches shared true roof');
      if(lod==='near'){assert.ok(parts.some(p=>p.material==='metal'));assert.ok(parts.some(p=>p.material==='glass'));assert.ok(parts.some(p=>p.purpose==='stairs'));}
    }
  }
});

test('continuous normal W traverses the full 40-floor stair route to a real top office and returns, without resetting along the path',()=>{
  const world=createWorld(20261001,'current-v6'),site=world.buildings.find(b=>b.id==='market-b6')!;
  const target=getBuildingUsePoints(site,39).find(p=>p.purpose==='work'&&p.id.includes('office-east'))!;
  const start={...site.door,z:site.door.z+1},route=findBuildingFloorPlanRoute(site,0,39,start,target.position,.35)!;
  assert.ok(route&&route.length>300&&route.length<1024);assert.ok(routeLength(route)>500);
  const keyboard=Object.assign(new EventTarget(),{closest:()=>null}),documentTarget=Object.assign(new EventTarget(),{pointerLockElement:null});
  const priorWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:keyboard,configurable:true});Object.defineProperty(globalThis,'document',{value:documentTarget,configurable:true});
  const controller=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,world,()=>{},(b,f)=>canAccessFloor(b,f,{role:'traveler'}));
  let steps=0,maxStep=0,maxRise=0;
  const event=(type:string)=>{const e=new Event(type);Object.assign(e,{code:'KeyW',repeat:false});keyboard.dispatchEvent(e);};
  const walk=(points:Vec3[])=>{
    for(const goal of points.slice(1)){
      let attempts=0;
      while(Math.hypot(goal.x-controller.position.x,goal.z-controller.position.z)>.035){
        const before={...controller.position},d=Math.hypot(goal.x-before.x,goal.z-before.z);controller.yaw=Math.atan2(-(goal.x-before.x),-(goal.z-before.z));
        controller.step(Math.min(.015,d/4.8),false);const after=controller.position;
        const advance=Math.hypot(after.x-before.x,after.z-before.z);maxStep=Math.max(maxStep,advance);maxRise=Math.max(maxRise,Math.abs(after.y-before.y));steps++;
        assert.ok(advance>1e-10,`W stalled ${site.id} floor=${controller.floor} before=${JSON.stringify(before)} goal=${JSON.stringify(goal)}`);
        assert.ok(attempts++<2000);assert.ok(Math.abs(after.y-before.y)<=.20000001,'no storey teleport');
      }
      assert.ok(Math.abs(controller.position.y-goal.y)<1e-7,`actual shared landing height ${JSON.stringify(goal)} ${JSON.stringify(controller.position)}`);
    }
  };
  try{
    controller.setMode('walk',start);event('keydown');walk(route);assert.equal(controller.floor,39);assert.ok(distance(controller.position,target.position)<.05);
    const back=findBuildingFloorPlanRoute(site,39,0,controller.position,start,.35)!;assert.ok(back);walk(back);event('keyup');
    assert.equal(controller.floor,0);assert.ok(distance(controller.position,start)<.05);assert.ok(steps>10000);assert.ok(maxStep<=.07200001);assert.ok(maxRise<=.20000001);
    console.log(JSON.stringify({scope:'CPU EventTarget controlled fixture, not GL/normalURL or natural NPC commute',siteId:site.id,steps,maxStep,maxRise,routeLength:routeLength(route),end:controller.position}));
  }finally{
    controller.dispose();if(priorWindow)Object.defineProperty(globalThis,'window',priorWindow);else Reflect.deleteProperty(globalThis,'window');
    if(priorDocument)Object.defineProperty(globalThis,'document',priorDocument);else Reflect.deleteProperty(globalThis,'document');
  }
});
