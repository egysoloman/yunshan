import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller.ts';
import { FLOOR_PLAN_PROFILE, getBuildingBody } from '../src/architecture-floor-plan.ts';
import { JourneyNavigation, planTransitJourney, planWalkingJourney, publicDepartures } from '../src/journey.ts';
import { closeRoadFromDisaster, isRoadOpen, releaseRoadExitPermit, roadExitPermit, roadExitRoute, roadRevision } from '../src/roads.ts';
import type { SimState, Vec3, WorldDefinition } from '../src/types.ts';

const point=(x:number,z=0,y=.6):Vec3=>({x,y,z});
function fixture():WorldDefinition {
  return {
    seed:1,voxelSize:.2,size:1000,mountains:[],buildings:[],spawn:point(0),
    waterfall:{top:point(900,900),bottom:point(900,900),width:1},river:[point(50,-400,0),point(50,400,0)],
    districts:[{id:'town',name:'镇口',kind:'market',center:point(50),radius:100,color:'#fff',population:0},{id:'annex',name:'北口',kind:'market',center:point(50,200),radius:100,color:'#fff',population:0}],
    nodes:[{id:'A',name:'A',districtId:'town',position:point(0),station:true},{id:'B',name:'B',districtId:'town',position:point(100),station:true},{id:'E',name:'E',districtId:'annex',position:point(0,200),station:true},{id:'F',name:'F',districtId:'annex',position:point(100,200),station:true}],
    edges:[{id:'town-bridge',from:'A',to:'B',mode:'bridge',length:100,capacity:20,points:[point(0),point(50),point(100)]},{id:'annex-bridge',from:'E',to:'F',mode:'bridge',length:100,capacity:20,points:[point(0,200),point(50,200),point(100,200)]}],
  };
}
function stateAt(position=point(0)):SimState {
  // Controlled small-world state; no Simulation tick, money, role or needs
  // intervention is required to exercise a derived navigation consumer.
  return {day:0,hour:8,tick:0,energy:100,visibility:1,voxels:[],citizens:[],vehicles:[],events:[],player:{position:{...position},vehicleId:null,inventory:{food:2},money:100,role:'traveler',identities:['traveler'],needs:{hunger:100,fatigue:100,social:100,fun:100}},journey:{version:1,targetId:'B',preference:'walk',startedAt:480,arrivedAt:null,status:'walking',vehicleId:null,nextStopNodeId:null,visitedStopIds:[],lastArrival:null}} as unknown as SimState;
}
function close(world:WorldDefinition,state:SimState,districtId='town') {
  // Explicit controlled canonical-source adapter. Production uses the
  // environment module's private WeakSet, never a caller-created permit.
  const event={type:'environment-disaster' as const,eventId:1,districtId,severity:20,occurredAt:480};
  const canonical=new WeakSet<object>([event]);
  const host:Parameters<typeof closeRoadFromDisaster>[0]={worldDefinition:world,state,emitEvent:()=>{}};
  const closed=closeRoadFromDisaster(host,event,{isCanonicalDisaster:input=>canonical.has(input)});
  assert(closed,'controlled canonical river disaster must close its actual existing crossing');
  assert.equal(isRoadOpen(state,districtId==='town'?'town-bridge':'annex-bridge'),false);
  return closed;
}
function body(world:WorldDefinition,state:SimState,run:(controller:PlayerController)=>void,withState=true) {
  const keyboard=Object.assign(new EventTarget(),{closest:()=>null}),documentTarget=Object.assign(new EventTarget(),{pointerLockElement:null});
  const priorWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{value:keyboard,configurable:true});Object.defineProperty(globalThis,'document',{value:documentTarget,configurable:true});
  const controller=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,world,()=>{},()=>true,()=>state.voxels,withState?()=>state:undefined);
  controller.setMode('walk',state.player.position);const down=new Event('keydown');Object.assign(down,{code:'KeyW',repeat:false});keyboard.dispatchEvent(down);
  try{run(controller);}finally{controller.dispose();if(priorWindow)Object.defineProperty(globalThis,'window',priorWindow);else Reflect.deleteProperty(globalThis,'window');if(priorDocument)Object.defineProperty(globalThis,'document',priorDocument);else Reflect.deleteProperty(globalThis,'document');}
}
function aim(controller:PlayerController,target:Vec3) {const p=controller.position;controller.yaw=Math.atan2(p.x-target.x,p.z-target.z);}

test('legacy walking API and an old state without roadNetwork retain the same route and actual movement',()=>{
  const world=fixture(),state=stateAt(),before=JSON.stringify({world,state});
  const legacy=planWalkingJourney(world,state.player.position,'B');assert(legacy);
  assert.deepEqual(planWalkingJourney(world,state.player.position,'B',state),legacy);
  assert.equal(JSON.stringify({world,state}),before);assert.equal('roadNetwork' in state,false);
  body(world,state,c=>{aim(c,point(10));c.step(.1,false);assert(c.position.x>.4);},false);
  body(world,state,c=>{aim(c,point(10));c.step(.1,false);assert(c.position.x>.4);});
});

test('a caller outside the closed crossing cannot acquire a projection anchor or an exit permit',()=>{
  const world=fixture(),state=stateAt(point(50,8));close(world,state);
  assert.equal(roadExitPermit(state,'player'),null);
  const before=JSON.stringify({world,state});
  assert.equal(planWalkingJourney(world,state.player.position,'B',state),null);
  assert.equal(planTransitJourney(world,state,state.player.position,'B'),null);
  assert.equal(roadExitPermit(state,'player'),null);assert.equal(JSON.stringify({world,state}),before);
});

test('the App navigation consumer invalidates a primed route on closure while preserving destination and actual custody',()=>{
  const world=fixture(),state=stateAt(),navigation=new JourneyNavigation(world);
  const primed=navigation.read(state);assert(primed.walking);assert.equal(navigation.read(state),primed);
  const intent=JSON.stringify(state.journey),player=JSON.stringify(state.player);close(world,state);
  const before=JSON.stringify(state),closed=navigation.read(state);
  assert.notEqual(closed,primed);assert.equal(closed.walking,null);assert.equal(closed.transit,null);
  assert.equal(closed.destination?.id,'B');assert.equal(closed.destination?.districtId,'town');assert(closed.unavailable?.includes('目的地已保留'));
  assert.equal(JSON.stringify(state.journey),intent);assert.equal(JSON.stringify(state.player),player);assert.equal(JSON.stringify(state),before);
});

test('a loaded state with the same revision and different closed edge invalidates the App cache',()=>{
  const world=fixture(),closedTown=stateAt(),closedAnnex=stateAt();close(world,closedTown);close(world,closedAnnex,'annex');
  assert.equal(roadRevision(closedTown),roadRevision(closedAnnex));
  const navigation=new JourneyNavigation(world),blocked=navigation.read(closedTown);assert.equal(blocked.walking,null);
  const before=JSON.stringify(closedAnnex),restored=navigation.read(closedAnnex);
  assert.notEqual(restored,blocked);assert(restored.walking);assert.deepEqual(restored.walking.edgeIds,['town-bridge']);assert.equal(restored.unavailable,null);
  assert.equal(JSON.stringify(closedAnnex),before);
});

test('a genuinely occupied body receives only its captured exit prefix without mutating intent or position',()=>{
  const world=fixture(),state=stateAt(point(50));close(world,state);
  const exit=roadExitRoute(world,state,'player',state.player.position);assert(exit);assert.equal(exit.edgeId,'town-bridge');
  const before=JSON.stringify(state),route=planWalkingJourney(world,state.player.position,exit.exitNodeId,state);assert(route);
  assert.equal(route.originNodeId,exit.exitNodeId);assert.deepEqual(route.edgeIds,['town-bridge']);assert.deepEqual(route.points,exit.points);
  assert.equal(JSON.stringify(state),before);
});

for(const profiled of [false,true])test(`actual WASD ${profiled?'floor plan':'legacy'} body stops at the closed-road endpoint without entering its interior`,()=>{
  const world=fixture();
  if(profiled){world.buildings=[{id:'gallery-site',name:'街旁楼',kind:'station',districtId:'town',position:point(0,14,0),width:32,depth:24,height:8,floors:2,rotation:0,door:point(0,26),capacity:20,seed:1,floorPlanProfile:FLOOR_PLAN_PROFILE}];assert(getBuildingBody(world.buildings[0]),'the profiled fixture must actually use a floor plan body');}
  const open=stateAt();body(world,open,c=>{aim(c,point(10));c.step(.1,false);assert(c.position.x>.4,'open control proves this actual physical branch can walk here');});
  const closed=stateAt();close(world,closed);assert.equal(roadExitPermit(closed,'player'),null);
  const original={...closed.player.position},before=JSON.stringify(closed);
  body(world,closed,c=>{aim(c,point(10));for(let step=0;step<4;step++)c.step(.1,false);assert(c.position.x<=original.x+.35+1e-7,'the original endpoint pad is permitted, the closed interior is not');assert(Math.abs(c.position.z-original.z)<1e-7);assert(c.blockedAccess?.includes('道路已关闭'));});
  assert.equal(JSON.stringify(closed),before);
});

test('actual captured walking permits forward exit, blocks reversal and cannot be reused for reentry',()=>{
  const world=fixture(),state=stateAt(point(50));close(world,state);const exit=roadExitRoute(world,state,'player',state.player.position);assert(exit);
  const endpoint=world.nodes.find(n=>n.id===exit.exitNodeId)!;
  body(world,state,c=>{
    aim(c,endpoint.position);c.step(.1,false);state.player.position=c.position;
    assert(Math.hypot(c.position.x-endpoint.position.x,c.position.z-endpoint.position.z)<50);
    const advanced=c.position;aim(c,point(50));c.step(.1,false);assert(Math.hypot(c.position.x-advanced.x,c.position.y-advanced.y,c.position.z-advanced.z)<1e-7);
    for(let step=0;step<150;step++){
      const distance=Math.hypot(c.position.x-endpoint.position.x,c.position.z-endpoint.position.z);if(distance<.01)break;
      aim(c,endpoint.position);c.step(Math.min(.1,distance/4.8),false);state.player.position=c.position;
    }
    assert(Math.hypot(c.position.x-endpoint.position.x,c.position.z-endpoint.position.z)<.01);
    assert.equal(releaseRoadExitPermit(world,state,'player',state.player.position),true);assert.equal(roadExitPermit(state,'player'),null);
    const arrived=c.position;aim(c,point(50));c.step(.1,false);assert(Math.hypot(c.position.x-arrived.x,c.position.y-arrived.y,c.position.z-arrived.z)<1e-7);
  });
  assert.equal(state.journey?.targetId,'B');assert.equal(state.player.money,100);assert.equal(state.player.inventory.food,2);
});

test('a valid flight remains a transit plan when the complete walking connection is closed',()=>{
  const world=fixture();world.nodes.push({id:'G',name:'G',districtId:'town',position:point(-20),station:false},{id:'H',name:'H',districtId:'town',position:point(120),station:false});
  world.edges.push({id:'origin-street',from:'G',to:'A',mode:'road',length:20,capacity:20,points:[point(-20),point(0)]},{id:'destination-street',from:'B',to:'H',mode:'road',length:20,capacity:20,points:[point(100),point(120)]},{id:'flight-ab',from:'A',to:'B',mode:'flight',length:100,capacity:20,points:[point(0),point(100)]});
  const state=stateAt();state.journey!.preference='transit';state.vehicles=[{id:'aircraft',kind:'flight',edgeId:'flight-ab',position:point(0),progress:0,direction:1,speed:50,state:'waiting',nextDeparture:480,passengers:2,cargo:3}];close(world,state);
  assert.equal(planWalkingJourney(world,state.player.position,'B',state),null);
  const before=JSON.stringify(state),navigation=new JourneyNavigation(world).read(state);assert(navigation.transit);assert(navigation.walking);
  assert.deepEqual(navigation.transit.legs.map(l=>l.mode),['flight']);assert.equal(navigation.destination?.id,'B');assert.equal(navigation.walking.destination.id,'A');assert.equal(navigation.unavailable,null);
  assert.equal(JSON.stringify(state),before);
});

test('a door tail without edgeIds cannot append a free walk through a closed crossing',()=>{
  const world=fixture();world.nodes.push({id:'G',name:'G',districtId:'town',position:point(-20),station:false});
  world.edges.push({id:'origin-street',from:'G',to:'A',mode:'road',length:20,capacity:20,points:[point(-20),point(0)]});
  const pavilion={id:'crossing-door',name:'桥边亭',kind:'pavilion' as const,districtId:'town',position:point(50,-6,0),width:10,depth:12,height:4,floors:1,rotation:0,door:point(50),capacity:20,seed:1};world.buildings=[pavilion];
  const state=stateAt(),open=planWalkingJourney(world,state.player.position,pavilion.id,state);assert(open);assert.deepEqual(open.points.at(-1),pavilion.door);
  close(world,state);const before=JSON.stringify(state);
  assert.equal(planWalkingJourney(world,state.player.position,pavilion.id,state),null);
  assert.equal(planTransitJourney(world,state,state.player.position,pavilion.id),null);assert.equal(JSON.stringify(state),before);
});

test('a real body that steps across its captured exit releases the permit without landing exactly on the node',()=>{
  const world=fixture();world.nodes.push({id:'H',name:'H',districtId:'town',position:point(120),station:false});
  world.edges.push({id:'destination-street',from:'B',to:'H',mode:'road',length:20,capacity:20,points:[point(100),point(120)]});
  const state=stateAt(point(99.5));close(world,state);assert(roadExitPermit(state,'player'));
  body(world,state,c=>{
    aim(c,point(120));c.step(.1,false);c.step(.1,false);state.player.position=c.position;
    assert(c.position.x>100.35,'actual default-speed steps must pass the small endpoint pad');
    assert.equal(releaseRoadExitPermit(world,state,'player',state.player.position),true);
    assert.equal(roadExitPermit(state,'player'),null);
    const before=c.position;aim(c,point(120));c.step(.1,false);assert(c.position.x>before.x);
  });
  assert.equal(state.journey?.targetId,'B');
});

test('the live board suppresses closed-road times without clearing passengers, cargo or original direction',()=>{
  const world=fixture();world.edges[0].mode='road';const state=stateAt();
  state.vehicles=[{id:'bus',kind:'road',edgeId:'town-bridge',position:point(50),progress:.5,direction:1,speed:10,state:'moving',nextDeparture:475,passengers:2,cargo:7}];close(world,state);
  const before=JSON.stringify(state),row=publicDepartures(world,state)[0];assert(row);
  assert.equal(row.departureAt,null);assert.equal(row.arrivalAt,null);assert(row.reason?.includes('道路已关闭'));assert.equal(row.to.id,'B');assert.equal(row.passengers,2);
  assert.equal(state.vehicles[0].cargo,7);assert.equal(JSON.stringify(state),before);
});
