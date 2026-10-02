import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PerspectiveCamera } from 'three';
import { planTransitJourney, planWalkingJourney, publicDepartures } from '../src/journey.ts';
import { Simulation } from '../src/simulation.ts';
import { createWorld, getWalkHeight, terrainHeight } from '../src/world.ts';
import { canAccessFloor, getStairPosition } from '../src/access.ts';
import { PlayerController } from '../src/controller.ts';
import { selectSavedWorld } from '../src/persistence/world-layout.ts';
import { marketCounters } from '../src/site-fixtures.ts';
import type { SimState, WorldDefinition } from '../src/types.ts';

const point = (x: number, y = 0, z = 0) => ({ x, y, z });
const mini: WorldDefinition = {
  seed: 1, voxelSize: .2, size: 200, mountains: [], buildings: [], spawn: point(0), river: [],
  waterfall: { top: point(0), bottom: point(0), width: 1 },
  districts: [{ id: 'town', name: '谷口', kind: 'market', center: point(0), radius: 100, color: '#ffffff', population: 0 }],
  nodes: ['A', 'B', 'C'].map((id, i) => ({ id, name: id, districtId: 'town', position: point(i * 50), station: true })),
  edges: [
    { id: 'road-ac', from: 'A', to: 'C', mode: 'road', length: 100, capacity: 20, points: [point(0), point(100)] },
    { id: 'bridge-cb', from: 'C', to: 'B', mode: 'bridge', length: 50, capacity: 20, points: [point(100), point(50)] },
    { id: 'air-shortcut', from: 'A', to: 'B', mode: 'flight', length: 1, capacity: 20, points: [point(0), point(50)] },
  ],
};

test('walking guidance follows real roads and bridges rather than a shorter aircraft route', () => {
  const origin = { ...mini.spawn }, route = planWalkingJourney(mini, origin, 'B');
  assert(route);
  assert.deepEqual(route.edgeIds, ['road-ac', 'bridge-cb']);
  assert.equal(route.metres, 150);
  assert.deepEqual(route.points.at(-1), mini.nodes[1].position);
  assert.deepEqual(origin, mini.spawn);
  assert.equal(planWalkingJourney(mini, origin, 'invented-stop'), null);
});

test('starting midway along a bent road retains its remaining vertices before graph routing', () => {
  const world={...mini,edges:[{...mini.edges[0],length:160,points:[point(0),point(0,0,30),point(100,0,30),point(100)]},...mini.edges.slice(1)]};
  const from=point(50,0,30),route=planWalkingJourney(world,from,'B');assert(route);
  assert.deepEqual(route.points,[from,point(100,0,30),point(100),point(50)]);
  assert.deepEqual(route.edgeIds,['road-ac','bridge-cb']);assert.equal(route.metres,130);
  assert.equal(route.originNodeId,'C');assert.deepEqual(from,point(50,0,30));
});

test('overlapping road levels join the actual walking surface rather than a nearby lower node', () => {
  const world={...mini,nodes:[{...mini.nodes[0],position:point(0,10)},{...mini.nodes[1],position:point(100,10)},{...mini.nodes[2],position:point(45,0)}],edges:[
    {id:'upper-road',from:'A',to:'B',mode:'road' as const,length:100,capacity:20,points:[point(0,10),point(50,10),point(100,10)]},
    {id:'lower-road',from:'C',to:'B',mode:'road' as const,length:56,capacity:20,points:[point(45,0),point(100,10)]},
  ]};
  const from=point(45,10,2),route=planWalkingJourney(world,from,'B');assert(route);
  assert.deepEqual(route.points[1],point(45,10));assert.deepEqual(route.points[2],point(50,10));
  assert(route.points.every(p=>p.y===10));assert.deepEqual(route.edgeIds,['upper-road']);assert.equal(route.metres,57);
  const state={day:0,hour:8,energy:100,visibility:1,player:{position:from,vehicleId:null,inventory:{},money:100},vehicles:[]}as unknown as SimState;
  const before=JSON.stringify(state),transit=planTransitJourney(world,state,from,'B');assert(transit);
  assert.deepEqual(transit.approach.points,route.points);assert.equal(transit.walkingMetres,route.metres);assert.equal(JSON.stringify(state),before);
});

function walkingBody(world:WorldDefinition,player:SimState['player'],blocks:SimState['voxels'],run:(controller:PlayerController)=>void) {
  const keyboard=Object.assign(new EventTarget(),{closest:()=>null}),documentTarget=Object.assign(new EventTarget(),{pointerLockElement:null});
  const priorWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:keyboard,configurable:true});Object.defineProperty(globalThis,'document',{value:documentTarget,configurable:true});
  const controller=new PlayerController(new PerspectiveCamera(),new EventTarget()as HTMLCanvasElement,world,()=>{},(building,floor)=>canAccessFloor(building,floor,player),()=>blocks);
  controller.setMode('walk',player.position);const down=new Event('keydown');Object.assign(down,{code:'KeyW',repeat:false});keyboard.dispatchEvent(down);
  try{run(controller);}finally{controller.dispose();if(priorWindow)Object.defineProperty(globalThis,'window',priorWindow);else Reflect.deleteProperty(globalThis,'window');if(priorDocument)Object.defineProperty(globalThis,'document',priorDocument);else Reflect.deleteProperty(globalThis,'document');}
}
function follow(controller:PlayerController,target:{x:number;y:number;z:number}) {
  for(let step=0;step<1000;step++){
    const from=controller.position,dx=target.x-from.x,dz=target.z-from.z,distance=Math.hypot(dx,dz);if(distance<.03)return;
    controller.yaw=Math.atan2(-dx,-dz);controller.step(Math.min(.1,distance/4.8),false);
  }
  assert(Math.hypot(controller.position.x-target.x,controller.position.z-target.z)<.03,`actual walking body cannot reach ${JSON.stringify(target)} from ${JSON.stringify(controller.position)}`);
}

test('a counter-side origin rejects the direct street connector that the actual walking body cannot cross', () => {
  const market={id:'test-market',name:'街边市集',kind:'market' as const,districtId:'town',position:point(0),width:32,depth:24,height:8,floors:2,rotation:0,door:point(0,.6,12),capacity:50,seed:1};
  const world:WorldDefinition={...mini,size:4400,buildings:[market],spawn:point(0,.6,14),waterfall:{top:point(500,100,500),bottom:point(500,0,500),width:10},river:[point(500,0,500)],nodes:[
    {...mini.nodes[0],position:market.door,station:false},{...mini.nodes[1],position:point(0,.6,40)},
  ],edges:[{id:'market-street',from:'A',to:'B',mode:'road',length:28,capacity:20,points:[market.door,point(0,.6,40)]}]};
  const counter=marketCounters(world,market)[0];assert(counter);
  const x=counter.position.x-counter.size.x/2-2,z=counter.position.z,from=point(x,getWalkHeight(world,x,z,market.door.y),z);
  assert.equal(counter.position.y-counter.size.y/2,getWalkHeight(world,counter.position.x,counter.position.z,market.door.y));
  const projection=point(0,.6,z),player={position:from,inventory:{},identities:['traveler'],role:'traveler'}as unknown as SimState['player'];
  walkingBody(world,player,[],controller=>{
    controller.yaw=Math.atan2(from.x-projection.x,from.z-projection.z);
    for(let step=0;step<100;step++)controller.step(.1,false);
    assert(controller.position.x<counter.position.x-counter.size.x/2-.35+.001);
    assert(Math.hypot(controller.position.x-projection.x,controller.position.z-projection.z)>5);
    assert.equal(controller.inside,null);
  });
  const state={day:0,hour:8,energy:100,visibility:1,player,vehicles:[]}as unknown as SimState,before=JSON.stringify({world,state,from});
  // This world offers one perpendicular join, through the counter. The planner
  // has no free-terrain detour contract, so both suggestions must reject it.
  assert.equal(planWalkingJourney(world,from,'B'),null);
  assert.equal(planTransitJourney(world,state,from,'B'),null);
  assert.equal(JSON.stringify({world,state,from}),before);
});

test('actual r7 native body rejoins its upper street and reaches the endpoint using the unchanged controller', () => {
  const bytes=gunzipSync(readFileSync(new URL('./fixtures/journey/r7-native-ui-export-coherent02.json.gz',import.meta.url)));
  assert.equal(bytes.length,1537646);assert.equal(createHash('sha256').update(bytes).digest('hex'),'669e7bc4ed83c970ee942ab34f557ed92669d8b2d34c5eb108478efca305a76b');
  const saved=JSON.parse(bytes.toString('utf8')),{world,layout}=selectSavedWorld(bytes.toString('utf8'));assert.equal(layout,'current-v2-r5');
  const from={...saved.state.player.position},route=planWalkingJourney(world,from,'academy-b13');assert(route);
  assert.deepEqual(from,{x:-379.7179431004984,y:49.707051422487545,z:516.9469250512725});
  assert.equal(route.points[1].z,512);assert(Math.abs(route.points[1].y-from.y)<1e-8);
  assert.equal(route.edgeIds[0],'road-market-quarter-1-market-station');assert.equal(route.originNodeId,'market-station');
  assert(!route.points.slice(0,8).some(p=>p.y<49));
  const endpoint=world.nodes.find(node=>node.id===route.originNodeId)!;const endIndex=route.points.findIndex(p=>Math.hypot(p.x-endpoint.position.x,p.y-endpoint.position.y,p.z-endpoint.position.z)<.01);assert(endIndex>1);
  walkingBody(world,saved.state.player,saved.state.voxels,controller=>{
    for(const p of route.points.slice(1,endIndex+1))follow(controller,p);
    assert(Math.hypot(controller.position.x-endpoint.position.x,controller.position.z-endpoint.position.z)<.03);
    assert(Math.abs(controller.position.y-endpoint.position.y)<.26);assert.equal(controller.inside,null);
  });
  const state=saved.state as SimState,before=JSON.stringify(state),transit=planTransitJourney(world,state,from,'academy-b13');assert(transit);
  assert.equal(transit.approach.points[1].z,512);assert.deepEqual(transit.approach.points[0],from);
  assert.equal(JSON.stringify(state),before);assert.deepEqual(from,saved.state.player.position);assert.equal(state.paused,true);
});

test('bridge access stays on the genuine dry deck and does not offer a riverbed shortcut', () => {
  const world:WorldDefinition={...mini,waterfall:{top:point(1000),bottom:point(1000),width:1},river:[point(0,0,-100),point(0,0,100)],nodes:[{...mini.nodes[0],position:point(10,.6,-20)},{...mini.nodes[1],position:point(10,.6,20)}],edges:[{id:'bridge-ab',from:'A',to:'B',mode:'bridge',length:40,capacity:20,points:[point(10,.6,-20),point(10,.6,0),point(10,.6,20)]}]};
  const from=point(10,.6,0),route=planWalkingJourney(world,from,'B');assert(route);assert.equal(route.metres,20);assert.deepEqual(route.edgeIds,['bridge-ab']);
  assert.equal(getWalkHeight(world,from.x,from.z,from.y),.6);assert(terrainHeight(world,from.x,from.z)<0);
  assert.equal(planWalkingJourney(world,point(0,terrainHeight(world,0,0),0),'B'),null);
});

test('every generated district has a walking route and explicit building guidance reaches its real door', () => {
  const world = createWorld();
  for (const district of world.districts) {
    const route = planWalkingJourney(world, world.spawn, district.id);
    assert(route, district.id);
    assert(route.edgeIds.every(id => ['road', 'bridge'].includes(world.edges.find(e => e.id === id)!.mode)));
  }
  const school = world.buildings.find(b => b.kind === 'school')!, route = planWalkingJourney(world, world.spawn, school.id);
  assert(route);
  assert.deepEqual(route.points.at(-1), school.door);
});

test('upper-floor guidance includes the shared stair shaft and entrance before joining the street', () => {
  const world = createWorld(), core = world.buildings.find(b => b.id === 'core-main')!;
  const origin = getStairPosition(core, 17), route = planWalkingJourney(world, origin, 'airport');
  assert(route);
  assert.equal(route.stairsFromFloor, 17);
  assert.deepEqual(route.points[2], getStairPosition(core, 0));
  assert.deepEqual(route.points[3], core.door);
  assert.deepEqual(origin, getStairPosition(core, 17));
});

test('public timetable uses the actual direction, departure clock and current energy', () => {
  const state = { day: 0, hour: 8, energy: 100, player: { vehicleId: null, inventory: {} }, vehicles: [{ id: 'train', kind: 'flight', edgeId: 'air-shortcut', position: point(50), progress: 1, direction: -1, speed: 10, state: 'waiting', passengers: 2, cargo: 0, nextDeparture: 530 }] } as unknown as SimState;
  const row = publicDepartures(mini, state)[0];
  assert.equal(row.from.id, 'B'); assert.equal(row.to.id, 'A');
  assert.equal(row.departureAt, 530); assert.equal(row.arrivalAt, 530.1);
  assert.equal(row.passengers, 2);
  state.vehicles[0].state = 'grounded';
  const grounded = publicDepartures(mini, state)[0];
  assert.equal(grounded.departureAt, null); assert.equal(grounded.arrivalAt, null);
  assert(grounded.reason);
});

test('a departing vehicle publishes its genuine next stop without inventing a new departure', () => {
  const state = { day: 0, hour: 8, energy: 100, player: { vehicleId: null, inventory: {} }, vehicles: [{ id: 'car', kind: 'road', edgeId: 'road-ac', position: point(50), progress: .5, direction: 1, speed: 10, state: 'moving', passengers: 1, cargo: 0, nextDeparture: 475 }] } as unknown as SimState;
  const row = publicDepartures(mini, state, 'C')[0];
  assert.equal(row.departed, true); assert.equal(row.departureAt, null);
  assert.equal(row.to.id, 'C'); assert(row.arrivalAt! > 480);
  assert.equal(publicDepartures(mini, state, 'B').length, 0);
});


test('public route connects real services and transfer stops without booking or changing any actor', () => {
  const routeWorld:WorldDefinition={...mini,nodes:[{...mini.nodes[0]},{...mini.nodes[1],position:point(1000)},{...mini.nodes[2],position:point(500)}],edges:[
    {id:'road-ac',from:'A',to:'C',mode:'road',length:500,capacity:20,points:[point(0),point(500)]},
    {id:'road-cb',from:'C',to:'B',mode:'road',length:500,capacity:20,points:[point(500),point(1000)]},
    {id:'cable-ac',from:'A',to:'C',mode:'cable',length:500,capacity:20,points:[point(0),point(500)]},
    {id:'rail-cb',from:'C',to:'B',mode:'maglev',length:500,capacity:20,points:[point(500),point(1000)]},
  ]};
  const state={day:0,hour:8,energy:100,visibility:1,player:{position:point(0),vehicleId:null,inventory:{},money:100},vehicles:[
    {id:'cable',kind:'cable',edgeId:'cable-ac',position:point(0),progress:0,direction:1,speed:20,state:'waiting',nextDeparture:500,passengers:0,cargo:0},
    {id:'rail',kind:'maglev',edgeId:'rail-cb',position:point(500),progress:0,direction:1,speed:50,state:'waiting',nextDeparture:480,passengers:0,cargo:0},
  ]} as unknown as SimState;
  const before=JSON.stringify(state),plan=planTransitJourney(routeWorld,state,point(0),'B');assert(plan);
  assert.deepEqual(plan.legs.map(l=>l.mode),['cable','maglev']);assert.equal(plan.transfers,1);assert.equal(plan.fare,8);
  assert.equal(plan.approach.destination.id,'A');assert.equal(JSON.stringify(state),before);
  state.vehicles[1].state='noPower';const outage=planTransitJourney(routeWorld,state,point(0),'B');assert(outage);
  assert.deepEqual(outage.legs.map(l=>l.mode),['cable','walk']);assert.equal(outage.fare,4);
});

test('journey intentions persist exact actual targets and malformed references reject atomically', () => {
  const world=createWorld(78),sim=new Simulation(world),target=world.buildings.find(b=>b.kind==='school')!;
  const money=sim.state.player.money,position={...sim.state.player.position};
  assert.equal(sim.command({type:'planJourney',targetId:target.id,value:1}).ok,true);
  assert.equal(sim.state.journey!.targetId,target.id);assert.equal(sim.state.journey!.preference,'transit');
  assert.equal(sim.state.player.money,money);assert.deepEqual(sim.state.player.position,position);
  const save=sim.exportSave(),restored=new Simulation(world),loaded=restored.importSave(save);assert.equal(loaded.ok,true,loaded.message);assert.equal(restored.exportSave(),save);
  const bad=JSON.parse(save);bad.state.journey.lastArrival={vehicleId:sim.state.vehicles[0].id,nodeId:world.nodes[0].id,edgeId:'invented-edge',at:sim.state.extension!.lastUpdate};
  assert.equal(restored.importSave(JSON.stringify(bad)).ok,false);assert.equal(restored.exportSave(),save);
  assert.equal(sim.command({type:'cancelJourney'}).ok,true);assert.equal(sim.state.journey!.targetId,null);assert.deepEqual(sim.state.player.position,position);assert.equal(sim.state.player.money,money);
  const legacy=JSON.parse(save);delete legacy.state.journey;
  // Pre-module-manifest saves can acquire navigation; current declared modules
  // must retain their exact persisted bodies.
  delete legacy.runtime.persistedModules;
  assert.equal(restored.importSave(JSON.stringify(legacy)).ok,true);assert.equal(restored.state.journey!.status,'none');
});

test('a current save declaring journey rejects a missing intent without replacing state', () => {
  const world=createWorld(78),sim=new Simulation(world),target=world.buildings.find(b=>b.kind==='school')!;
  assert.equal(sim.command({type:'planJourney',targetId:target.id,value:1}).ok,true);
  const before=sim.exportSave(),damaged=JSON.parse(before);
  assert(damaged.runtime.persistedModules.includes('journey'));
  delete damaged.state.journey;
  assert.equal(sim.importSave(JSON.stringify(damaged)).ok,false);
  assert.equal(sim.exportSave(),before);
});

test('riding records the actual reached node before a vehicle turns and no navigation command pays fares', () => {
  const world=createWorld(79),sim=new Simulation(world),vehicle=sim.state.vehicles.find(v=>v.kind==='cable')!,edge=world.edges.find(e=>e.id===vehicle.edgeId)!,to=world.nodes.find(n=>n.id===edge.to)!;
  vehicle.progress=.999;vehicle.direction=1;vehicle.position={...to.position};vehicle.state='waiting';vehicle.nextDeparture=sim.state.day*1440+sim.state.hour*60;
  sim.state.player.position={...vehicle.position};const cash=sim.state.player.money,treasury=sim.state.treasury;
  assert.equal(sim.command({type:'planJourney',targetId:to.id,value:1}).ok,true);assert.equal(sim.state.player.money,cash);assert.equal(sim.state.treasury,treasury);
  assert.equal(sim.command({type:'ride',targetId:vehicle.id}).ok,true);assert.equal(sim.state.player.money,cash-4);assert.equal(sim.state.treasury,treasury+4);
  sim.step(.25);const observed=sim.state.journey!;
  assert.equal(observed.lastArrival?.nodeId,to.id);assert.equal(observed.lastArrival?.edgeId,edge.id);assert.equal(observed.vehicleId,vehicle.id);assert.equal(observed.status,'atStop');assert(observed.visitedStopIds.includes(to.id));
  assert.equal(sim.command({type:'leaveVehicle'}).ok,true);sim.step(.25);assert.equal(sim.state.journey!.status,'arrived');assert.equal(sim.state.player.vehicleId,null);
  const restored=new Simulation(world),result=restored.importSave(sim.exportSave());assert.equal(result.ok,true,result.message);assert.equal(restored.exportSave(),sim.exportSave());
});
