import {writeFileSync} from 'node:fs';
import {after} from 'node:test';
const motorTraces:any[]=[];
after(()=>writeFileSync('/tmp/yunshan-v5-market-block-01/prototype-01/diagnostics/motor-telemetry.json',JSON.stringify({scope:'Controlled CPU actual Controller EventTarget KeyW, original 4.8m/s motor; not native browser or normal URL travel',bodyRadius:.35,sourceEyeHeight:1.72,sourceSnapshot:'candidate-fixed/source-snapshot.json',calls:motorTraces},null,2)+'\n'));
import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Raycaster, Vector3, Mesh } from 'three';
import { createWorld, CURRENT_CITY_LAYOUT, getWalkHeight, terrainHeight } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/world';
import { canAccessFloor } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/access';
import { planWalkingJourney } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/journey';
import { PlayerController } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/controller';
import { Simulation } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/simulation';
import { savedWorldFingerprint, selectSavedWorld } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/persistence/world-layout';
import { buildMarketBlock } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/rendering/market-block';
import { findFloorPlanRoute, findBuildingFloorPlanRoute, getBuildingUsePoints, getBuildingBody, floorPlanSupport } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/architecture-floor-plan';
import { blocksMarketBlockMovement, marketBlockAllowsVehicle, marketBlockHeight, marketBlockLegacyWorld, marketBlockSurfacePieces, marketSurfaceHeight, polygonArea } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/market-block';
import type { Vec3, WorldDefinition } from '/tmp/yunshan-v5-market-block-01/prototype-01/candidate-fixed/src/types';

const world=createWorld(20261001,'current-v5-market-block-01');
const base=marketBlockLegacyWorld(world),b0=world.buildings.find(b=>b.id==='market-b0')!;
function controlledMotor(run:(controller:PlayerController,keys:EventTarget)=>void){
  const keys=Object.assign(new EventTarget(),{closest:()=>null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:keys,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
  const c=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,world,()=>{},(b,f)=>canAccessFloor(b,f,{role:'traveler',identities:['traveler']}));
  try{run(c,keys);}finally{c.dispose();if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');}
}
function key(keys:EventTarget,down:boolean){const event=new Event(down?'keydown':'keyup');Object.assign(event,{code:'KeyW',repeat:false});keys.dispatchEvent(event);}
function walk(c:PlayerController,keys:EventTarget,points:Vec3[]){
 const trace:any={start:c.position,targets:points,steps:[]};motorTraces.push(trace);
  key(keys,true);try{for(const target of points){let iterations=0;while(Math.hypot(c.position.x-target.x,c.position.z-target.z)>.02){const before=c.position,dx=target.x-before.x,dz=target.z-before.z,d=Math.hypot(dx,dz);c.yaw=Math.atan2(-dx,-dz);const dt=Math.min(.02,d/4.8);c.step(dt,false);const after=c.position,camera=(c as unknown as {camera:PerspectiveCamera}).camera;trace.steps.push({before,after,dt,delta:{horizontal:Math.hypot(after.x-before.x,after.z-before.z),vertical:after.y-before.y},queryHeight:getWalkHeight(world,after.x,after.z,after.y),eye:{x:camera.position.x,y:camera.position.y,z:camera.position.z},inside:c.inside?.id??null,floor:c.floor});assert(Math.hypot(c.position.x-before.x,c.position.z-before.z)>.000001,`W blocked ${JSON.stringify({before,target,inside:c.inside?.id,floor:c.floor})}`);assert(Math.hypot(c.position.x-before.x,c.position.z-before.z)<=.0960001);assert(++iterations<4000);}}}finally{key(keys,false);}
}

test('v5 is opt-in and its sampled surfaces have real limited foundations; inherited body/water stay exact',()=>{
  assert.equal(CURRENT_CITY_LAYOUT,'current-v4');assert.equal(createWorld().layoutVersion,'current-v4');
  assert.equal(world.marketBlock!.version,'market-block-01-sampled-local-foundations-1');
  assert(world.marketBlock!.sampling.maxFillCut<=4);assert(world.marketBlock!.sampling.maxFoundationCut<=4);assert(world.marketBlock!.sampling.sampledPoints>1000);assert(world.marketBlock!.sampling.area<1500);
  assert.equal(JSON.stringify(world.buildings),JSON.stringify(base.buildings));assert.equal(JSON.stringify(world.river),JSON.stringify(base.river));assert.equal(JSON.stringify(world.waterfall),JSON.stringify(base.waterfall));assert.equal(JSON.stringify(getBuildingBody(b0)),JSON.stringify(getBuildingBody(base.buildings.find(b=>b.id===b0.id)!)));
  for(const surface of world.marketBlock!.surfaces){assert.equal(surface.bottom.length,surface.vertices.length);for(const [i,p]of surface.vertices.entries()){assert(Number.isFinite(p.y));assert(surface.bottom[i].y<p.y);assert(Math.abs(marketSurfaceHeight(surface,p)!-terrainHeight(base,p.x,p.z))<=4);}}
  for(const [x,z]of [[0,0],[400,-900],[1200,1000],[-740,980]])assert.equal(terrainHeight(world,x,z),terrainHeight(base,x,z));
});

test('ordinary fixed-speed W reaches all three actual sale points and the upper work floor; room/stock are real',()=>{
  const sim=new Simulation(world),shop=sim.state.shops.find(s=>s.buildingId===b0.id)!;
  controlledMotor((c,keys)=>{
    c.setMode('walk',{x:b0.position.x+5,y:b0.position.y+.6,z:b0.position.z+34.6});
    walk(c,keys,[{x:b0.door.x,y:b0.door.y,z:b0.position.z+34.6},{x:b0.door.x,y:b0.door.y,z:b0.door.z+3.9}]);
    const sales=getBuildingUsePoints(b0,0).filter(p=>p.purpose==='sale');assert.equal(sales.length,3);
    for(const sale of sales){const route=findFloorPlanRoute(b0,0,c.position,sale.position);assert(route);walk(c,keys,route);sim.state.player.position={...c.position};assert.equal(c.inside?.id,b0.id);assert(sim.isAtBuildingFunctionPoint(b0,sim.state.player.position,'sale'));const cash=sim.state.player.money,inventory=shop.inventory,revenue=shop.revenue,publicCash=sim.state.treasury;
      assert(sim.command({type:'purchase',targetId:shop.id,value:1}).ok);assert.equal(cash-sim.state.player.money,shop.price);assert.equal(shop.inventory,inventory-1);assert.equal(shop.revenue-revenue,shop.price);assert.equal(sim.state.treasury,publicCash,'retail payment is not invented public revenue');
    }
    const upstairs=getBuildingUsePoints(b0,1).find(p=>p.purpose==='work')!;
    const up=findBuildingFloorPlanRoute(b0,0,1,c.position,upstairs.position);assert(up);walk(c,keys,up);assert.equal(c.floor,1);assert.equal(c.inside?.id,b0.id);
  });
});


test('the new bank connection is a real 3.2m pedestrian road with same-height joins and normal W both ways',()=>{
  const edge=world.edges.find(e=>e.id===world.marketBlock!.bankEdgeId)!;
  assert.equal(edge.physicalWidth,3.2);assert.equal(edge.from,base.edges.find(e=>e.id===edge.id)!.from);assert.equal(edge.to,base.edges.find(e=>e.id===edge.id)!.to);
  assert.equal(edge.length,edge.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-edge.points[i].x,p.y-edge.points[i].y,p.z-edge.points[i].z),0));
  controlledMotor((c,keys)=>{const route=edge.points.slice(6,world.marketBlock!.bankJoinIndex+1);c.setMode('walk',route[0]);walk(c,keys,route);walk(c,keys,[...route].reverse());assert(Math.hypot(c.position.x-route[0].x,c.position.z-route[0].z)<.03);});
  const sim=new Simulation(world);assert(sim.state.vehicles.every(v=>marketBlockAllowsVehicle(world,v.edgeId)));for(const id of world.marketBlock!.pedestrianEdgeIds)assert(!marketBlockAllowsVehicle(world,id));
});

test('flower-bed rims and trunks are actual body blockers while the sales approach stays open',()=>{
  for(const tree of world.marketBlock!.trees){const y=b0.position.y+.6;assert(blocksMarketBlockMovement(world,{x:tree.position.x-2,y,z:tree.position.z},{x:tree.position.x+2,y,z:tree.position.z}));assert(!blocksMarketBlockMovement(world,{x:tree.position.x-2,y,z:tree.position.z+2},{x:tree.position.x+2,y,z:tree.position.z+2}));}
  assert(!blocksMarketBlockMovement(world,{x:b0.door.x,y:b0.door.y,z:b0.door.z+3},{x:b0.door.x,y:b0.door.y,z:b0.door.z}));
});

test('actual emitted near/far resident mesh tops match shared support; physical geometry changes identity',()=>{
  const group=buildMarketBlock(world);group.updateMatrixWorld(true);const ray=new Raycaster(),samples=[] as Vec3[];
  for(let i=0;i<world.marketBlock!.surfaces.length;i++)for(const piece of marketBlockSurfacePieces(world,i)){if(polygonArea(piece)<.5)continue;const p={x:piece.reduce((s,p)=>s+p.x,0)/piece.length,z:piece.reduce((s,p)=>s+p.z,0)/piece.length};samples.push({...p,y:marketSurfaceHeight(world.marketBlock!.surfaces[i],p)!});}
  for(const p of samples){ray.set(new Vector3(p.x,p.y+1,p.z),new Vector3(0,-1,0));const hits=ray.intersectObject(group,true).filter(h=>h.object.name.startsWith('真实铺面'));assert(hits.length,JSON.stringify(p));assert(Math.abs(hits[0].point.y-p.y)<.00005);assert(Math.abs(getWalkHeight(world,p.x,p.z,p.y)-p.y)<.00005);}
  const fp=savedWorldFingerprint(world),altered={...world,marketBlock:structuredClone(world.marketBlock)};altered.marketBlock!.solids[0].width+=.2;assert.notEqual(savedWorldFingerprint(altered),fp);
  const artGroup=buildMarketBlock(world);artGroup.traverse(o=>{if(o instanceof Mesh)o.material=Array.isArray(o.material)?o.material:o.material.clone();});assert.equal(savedWorldFingerprint(world),fp,'GPU/art state is outside the physical world');
});

test('native save matches the regenerated v5 fingerprint; unknown identity and wrong layout reject atomically',()=>{
  const sim=new Simulation(world),json=sim.exportSave(),restored=new Simulation(world);assert(restored.importSave(json).ok);assert.equal(restored.exportSave(),json);
  assert.equal(selectSavedWorld(json).layout,'current-v5-market-block-01');
  const wrong=new Simulation(base),before=wrong.exportSave();assert(!wrong.importSave(json).ok);assert.equal(wrong.exportSave(),before);
  const illegalCar=JSON.parse(json),car=illegalCar.state.vehicles.find((v:{kind:string})=>v.kind==='road');assert(car);car.edgeId='walk-market-b44-market-b0';car.position={...world.edges.find(e=>e.id===car.edgeId)!.points[0]};assert(!restored.importSave(JSON.stringify(illegalCar)).ok);assert.equal(restored.exportSave(),json);
  const damaged=JSON.parse(json);damaged.worldFingerprint='deadbeef';assert.throws(()=>selectSavedWorld(JSON.stringify(damaged)));assert.equal(restored.exportSave(),json);
  assert.equal(floorPlanSupport(b0,0,getBuildingUsePoints(b0,0).find(p=>p.purpose==='sale')!.position)?.kind,'room');
});


test('52m public street is physically continuous and the public planner consumes the real bank-to-market link',()=>{
  const link=world.edges.find(edge=>edge.id==='walk-market-b44-market-b0')!;assert.equal(link.capacity,0);assert.equal(link.physicalWidth,3.2);assert(!marketBlockAllowsVehicle(world,link.id));
  controlledMotor((c,keys)=>{c.setMode('walk',{x:b0.position.x-25.5,y:b0.door.y,z:b0.position.z+29.2});walk(c,keys,[{x:b0.position.x+25.5,y:b0.door.y,z:b0.position.z+29.2}]);assert(Math.abs(c.position.x-b0.position.x-25.5)<.03);});
  const bank=world.buildings.find(b=>b.id==='market-b44')!;
  const route=planWalkingJourney(world,bank.door,b0.id);assert(route);assert(route.edgeIds.includes(link.id),JSON.stringify(route.edgeIds));assert(route.metres>=link.length-1);assert(route.metres<link.length+10,'planner must use the actual local join rather than loop through the quarter');
  controlledMotor((c,keys)=>{c.setMode('walk',link.points[0]);walk(c,keys,link.points.slice(1));assert(Math.hypot(c.position.x-b0.door.x,c.position.z-b0.door.z)<.03);});
});
