import assert from 'node:assert/strict';
import test from 'node:test';
import { closeRoadFromDisaster, completeRoadRepair, installRoadNetwork, isRoadOpen, releaseRoadExitPermit, roadExitPermit, roadExitRoute, roadMovementAllowed, roadRevision, validateRoadNetwork, type RoadDisasterEvent, type RoadHost } from '../src/roads.ts';
import { findPath } from '../src/world.ts';
import { savedWorldFingerprint } from '../src/persistence/world-layout.ts';
import type { Citizen, SimState, Vec3, WorldDefinition } from '../src/types.ts';

const p = (x: number, z = 0, y = 0): Vec3 => ({ x,y,z });
function fixture() {
  // Authority/geometry unit fixture, not a generated city or a claimed
  // natural flood. Canonical identity is provided by a controlled WeakSet.
  const world: WorldDefinition = { seed: 1, voxelSize: .2, size: 1000, mountains: [], buildings: [], spawn: p(20),
    waterfall: { top:p(50,-100),bottom:p(50,100),width:3 }, river:[p(50,-100),p(50,100)],
    districts:[{id:'town',name:'町',kind:'market',center:p(50),radius:300,color:'#ffffff',population:0}],
    nodes:[{id:'A',name:'A',districtId:'town',position:p(0),station:true},{id:'B',name:'B',districtId:'town',position:p(100),station:true},{id:'C',name:'C',districtId:'town',position:p(0,200),station:true}],
    edges:[{id:'road-ab',from:'A',to:'B',mode:'road',length:100,capacity:10,points:[p(0),p(100)]},
      {id:'road-ac',from:'A',to:'C',mode:'road',length:200,capacity:10,points:[p(0),p(0,200)]},
      {id:'road-cb',from:'C',to:'B',mode:'road',length:Math.hypot(100,200),capacity:10,points:[p(0,200),p(100)]}] };
  const person = (id:string,at:Vec3,next:Vec3): Citizen => ({id,name:id,districtId:'town',homeId:'home',workId:'work',role:'traveler',position:at,state:'commuting',destinationId:'work',money:30,
    needs:{hunger:70,fatigue:60,social:50,fun:40},tier:'statistical',route:[next],routeIndex:0});
  const state: SimState = { version:1,seed:1,tick:0,day:0,hour:8,paused:false,speed:1,weather:'雨',visibility:1,energy:80,treasury:1000,taxRate:.1,policeBudget:.3,support:50,bankBalance:0,loan:0,gdp:0,lastSystemOrder:[],voxels:[],districts:[],shops:[],relationships:[],crimes:[],events:[],
    citizens:[person('walking',p(40),p(100)),person('nearby',p(40,6),p(100)),person('upper',p(40,0,12),p(100,0,12)),person('crossing',p(40),p(0,200))],
    vehicles:[{id:'bus',kind:'road',position:p(60,1.3),edgeId:'road-ab',progress:.6,direction:1,speed:18,state:'moving',passengers:2,cargo:1,nextDeparture:480}],
    player:{position:p(20),role:'traveler',money:100,reputation:0,needs:{hunger:80,fatigue:80,social:80,fun:80},inventory:{},homeId:null,education:0,experience:0,partnerId:null,vehicleId:null},metrics:{trades:0,commutes:0,crimesResolved:0,freight:0,flights:0} };
  const canonical = new WeakSet<object>(), events: RoadDisasterEvent[] = [], handlers = new Map<string,(e:RoadDisasterEvent)=>void>(), validators:((s:SimState)=>void)[]=[];
  let activate = 0;
  const host: RoadHost = {state,worldDefinition:world,onEvent(type,handler){handlers.set(type,handler);},onPhase(){},registerSaveValidator(v){validators.push(v);},emitEvent(e){events.push(e);} };
  const accounting={isCanonicalDisaster:(e:object)=>canonical.has(e),activate(){activate++;}};
  const event = {type:'environment-disaster',eventId:1,districtId:'town',occurredAt:480,severity:8};
  const close=()=>{canonical.add(event);return closeRoadFromDisaster(host,event,accounting);};
  return {world,state,host,accounting,event,canonical,events,handlers,validators,close,activated:()=>activate};
}
test('cold install and forged disaster do not create road state or modify old bytes',()=>{
  const f=fixture(),before=JSON.stringify(f.state);installRoadNetwork(f.host,f.accounting);assert.equal(JSON.stringify(f.state),before);assert.equal(f.activated(),0);
  f.handlers.get('environment-disaster')!(f.event);assert.equal(JSON.stringify(f.state),before);assert.equal(f.state.roadNetwork,undefined);assert.equal(f.validators.length,1);f.validators[0](f.state);
});
test('one canonical closure preserves geometry, source cash, needs, people and cargo and captures only true occupants',()=>{
  const f=fixture(),geometry=JSON.stringify(f.world),fingerprint=savedWorldFingerprint(f.world),actors=JSON.stringify({citizens:f.state.citizens,vehicles:f.state.vehicles,player:f.state.player,treasury:f.state.treasury});
  const c=f.close();assert(c);assert.equal(c.edgeId,'road-ab');assert.equal(roadRevision(f.state),1);assert.equal(f.activated(),1);assert.deepEqual(Object.keys(f.state.roadNetwork!.permits).sort(),['player','vehicle:bus','walking']);
  assert.equal(JSON.stringify(f.world),geometry);assert.equal(savedWorldFingerprint(f.world),fingerprint);assert.equal(JSON.stringify({citizens:f.state.citizens,vehicles:f.state.vehicles,player:f.state.player,treasury:f.state.treasury}),actors);
  validateRoadNetwork(f.state,f.world);const before=JSON.stringify(f.state);assert.equal(f.close(),null);assert.equal(JSON.stringify(f.state),before);assert.equal(f.events.length,1);
});
test('routing uses a true open detour while omitted overlay retains original path',()=>{
  const f=fixture();assert.deepEqual(findPath(f.world,'A','B','road').map(n=>n.id),['A','B']);f.close();assert.equal(isRoadOpen(f.state,'road-ab'),false);
  assert.deepEqual(findPath(f.world,'A','B','road',f.state).map(n=>n.id),['A','C','B']);assert.deepEqual(findPath(f.world,'A','B','road').map(n=>n.id),['A','B']);
  f.world.edges=f.world.edges.slice(0,1);assert.deepEqual(findPath(f.world,'A','B','road',f.state),[]);
});
test('new entry and side cutting fail; captured exit is one direction and another elevation stays independent',()=>{
  const f=fixture();f.close();assert.equal(roadMovementAllowed(f.world,f.state,'new',p(0),p(1)),false);assert.equal(roadMovementAllowed(f.world,f.state,'nearby',p(40,6),p(40)),false);
  assert.equal(roadMovementAllowed(f.world,f.state,'player',p(20),p(10)),true);assert.equal(roadMovementAllowed(f.world,f.state,'player',p(20),p(21)),false);
  assert.equal(roadMovementAllowed(f.world,f.state,'upper',p(40,0,12),p(50,0,12)),true);assert.equal(roadExitRoute(f.world,f.state,'new',p(20)),null);
  assert.equal(roadExitRoute(f.world,f.state,'walking',p(40))!.exitNodeId,'B');assert.deepEqual(roadExitRoute(f.world,f.state,'walking',p(40))!.points.at(-1),p(100));
});
test('shared open junction is usable and true endpoint crossing releases without hitting its exact centre',()=>{
  const f=fixture();f.close();assert.equal(roadMovementAllowed(f.world,f.state,'new',p(0),p(-10)),true);assert.equal(roadMovementAllowed(f.world,f.state,'new',p(0),p(0,10)),true);
  assert.equal(releaseRoadExitPermit(f.world,f.state,'walking',p(70)),false);assert.equal(releaseRoadExitPermit(f.world,f.state,'walking',p(100.6)),false,'future coordinates cannot release the actual middle occupant');
  // Controlled geometry unit movement; ordinary controller/Simulation movement
  // and save+24 are integration cases owned by the routing tests.
  f.state.citizens[0].position=p(100.6);assert.equal(releaseRoadExitPermit(f.world,f.state,'walking',f.state.citizens[0].position),true);assert.equal(roadExitPermit(f.state,'walking'),null);
  assert.equal(roadMovementAllowed(f.world,f.state,'walking',p(100.6),p(99)),false);f.state.vehicles[0].position=p(100,1.3);f.state.vehicles[0].progress=1;assert.equal(releaseRoadExitPermit(f.world,f.state,'vehicle:bus',f.state.vehicles[0].position),true);
});
test('a captured actor on a bent edge cannot use its permit to jump across the empty chord',()=>{
  const f=fixture();f.world.edges[0].points=[p(0),p(0,100),p(100,100),p(100)];f.world.edges[0].length=300;
  f.state.citizens[0].position=p(0,50);f.state.citizens[0].route=[p(0,100)];f.close();assert(roadExitPermit(f.state,'walking'));
  assert.equal(roadMovementAllowed(f.world,f.state,'walking',p(0,50),p(0,60)),true);
  assert.equal(roadMovementAllowed(f.world,f.state,'walking',p(0,50),p(100,50)),false);
});
test('a real diagonal open branch remains usable without opening the closed branch centre',()=>{
  const f=fixture();f.world.nodes[2].position=p(200,200);f.world.edges[1].points=[p(0),p(200,200)];f.world.edges[1].length=Math.hypot(200,200);f.world.edges[2].points=[p(200,200),p(100)];f.world.edges[2].length=Math.hypot(100,200);
  f.close();assert.equal(isRoadOpen(f.state,'road-ac'),true);assert.equal(roadMovementAllowed(f.world,f.state,'new',p(0),p(10,10)),true);
  assert.equal(roadMovementAllowed(f.world,f.state,'new',p(0),p(10)),false);
});
test('closed snapshot validation rejects forged references, direction, revision and false position without mutating input',()=>{
  const f=fixture();f.close();const original=JSON.stringify(f.state);
  for(const corrupt of [(s:SimState)=>{s.roadNetwork!.revision++;},(s:SimState)=>{s.roadNetwork!.closures[0].edgeId='invented';},(s:SimState)=>{s.roadNetwork!.permits.walking.direction=-1;},
    (s:SimState)=>{s.roadNetwork!.permits.walking.closedRevision++;},(s:SimState)=>{s.citizens[0].position=p(40,0,12);},(s:SimState)=>{s.vehicles[0].progress=.8;},
    (s:SimState)=>{s.roadNetwork!.closures[0].worksite=p(400);},(s:SimState)=>{s.roadNetwork!.permits.nearby={...s.roadNetwork!.permits.walking,actorId:'nearby'};}]) {
    const candidate=JSON.parse(original) as SimState;corrupt(candidate);const before=JSON.stringify(candidate);assert.throws(()=>validateRoadNetwork(candidate,f.world),/道路/);assert.equal(JSON.stringify(candidate),before);
  }
  assert.equal(JSON.stringify(f.state),original);validateRoadNetwork(f.state,f.world);
});
test('missing or unpaid repair proof cannot reopen a closed edge or increment revision',()=>{
  const f=fixture(),c=f.close()!,before=JSON.stringify(f.state);assert.equal(completeRoadRepair(f.host,c.id,'fake'),false);assert.equal(JSON.stringify(f.state),before);
  Reflect.set(f.state,'roadworks',{jobs:[{id:'fake',closureId:c.id,edgeId:c.edgeId,status:'completed',requiredMinutes:60,workedMinutes:60,consumedUnits:1,completedAt:540,funded:0,purchasePaid:0,paidGross:0,escrow:0,refunded:0,serviceFees:0,receipts:[],contributions:{}}]});
  const candidate=JSON.stringify(f.state);assert.equal(completeRoadRepair(f.host,c.id,'fake'),false);assert.equal(JSON.stringify(f.state),candidate);assert.equal(isRoadOpen(f.state,c.edgeId),false);
});
test('completed onsite proof can reopen while an actual excess refund remains in escrow',()=>{
  // Pure cross-module proof fixture. This verifies the completed/refundPending
  // interface, not earned payroll, material purchase or a natural repair.
  const f=fixture(),c=f.close()!;f.state.hour=9;
  const job={id:'proof',closureId:c.id,edgeId:c.edgeId,status:'refundPending',requiredMinutes:60,workedMinutes:60,consumedUnits:1,completedAt:540,cancelledAt:null,
    funded:20,purchasePaid:4,paidGross:12,escrow:4,refunded:0,serviceFees:0,receipts:[{quantity:1}],contributions:{walking:{workedMinutes:60,gross:12}}};
  Reflect.set(f.state,'roadworks',{jobs:[job]});const finance=JSON.stringify(job);assert.equal(completeRoadRepair(f.host,c.id,job.id),true);assert.equal(JSON.stringify(job),finance);
  assert.equal(c.reopenedAt,540);assert.equal(c.repairedBy,'proof');assert.equal(roadRevision(f.state),2);assert.equal(isRoadOpen(f.state,c.edgeId),true);assert.deepEqual(f.state.roadNetwork!.permits,{});
  validateRoadNetwork(f.state,f.world);assert.equal(completeRoadRepair(f.host,c.id,job.id),false);
});
test('no affected district river edge leaves the module cold even for a canonical event',()=>{
  const f=fixture();f.world.river=[p(1000,-100),p(1000,100)];assert.equal(f.close(),null);assert.equal(f.state.roadNetwork,undefined);assert.equal(f.activated(),0);
});
test('true interior river crossings tie by stable edge ID regardless of polyline sampling',()=>{
  for(const split of [false,true]) {
    const f=fixture();
    if(split) {f.world.edges[0].points=[p(0),p(40),p(60),p(100)];f.world.river=[p(50,-100),p(50,-7),p(50,63),p(50,100)];}
    assert.equal(f.close()!.edgeId,'road-ab','AB and CB both intersect the river: extra vertices cannot select CB instead');
    assert.equal(isRoadOpen(f.state,'road-cb'),true);validateRoadNetwork(f.state,f.world);
  }
});
test('the real 80 metre segment distance is inclusive and a separated segment stays outside reach',()=>{
  for(const [z,expected] of [[80,'road-ab'],[80.0001,null]] as const) {
    const f=fixture();f.world.edges=f.world.edges.slice(0,1);f.world.river=[p(50,z),p(50,z+20)];
    assert.equal(f.close()?.edgeId??null,expected);
  }
  const f=fixture();f.world.edges=f.world.edges.slice(0,1);f.world.river=[p(150,79),p(150,100)];
  assert.equal(f.close(),null,'infinite line extensions are not finite segment intersections');assert.equal(f.state.roadNetwork,undefined);
});
test('collinear overlap and a degenerate river point use finite segment distance',()=>{
  const overlap=fixture();overlap.world.river=[p(45),p(55)];assert.equal(overlap.close()!.edgeId,'road-ab');
  for(const duplicated of [false,true]) {
    const f=fixture();f.world.edges=f.world.edges.slice(0,1);f.world.edges[0].points=[p(0),p(0),p(100)];
    f.world.river=duplicated?[p(50,80),p(50,80)]:[p(50,80)];assert.equal(f.close()!.edgeId,'road-ab');validateRoadNetwork(f.state,f.world);
  }
});
test('parallel disjoint river segments and nearly parallel distant lines do not become crossings',()=>{
  const near=fixture();near.world.edges=near.world.edges.slice(0,1);near.world.river=[p(0,79),p(100,79)];assert.equal(near.close()!.edgeId,'road-ab');
  const far=fixture();far.world.edges=far.world.edges.slice(0,1);far.world.river=[p(0,80.0001),p(100,80.0001+1e-10)];assert.equal(far.close(),null);
});
test('a completed terminal route on the real deck captures only its nearest original exit',()=>{
  // Controlled authority/geometry fixture. Genuine police arrival, dispatch
  // release and ordinary movement/save+24 are separate core integration cases.
  for(const [x,exit,direction] of [[40,'A',-1],[80,'B',1],[50,'A',-1]] as const) {
    const f=fixture(),actor=f.state.citizens[0];actor.position=p(x);actor.state='investigating';actor.route=[p(0),p(x)];actor.routeIndex=actor.route.length;
    const before=JSON.stringify(actor),c=f.close()!,witness=c.occupants.find(row=>row.actorId===actor.id)!;
    assert(witness);assert.equal(witness.routeIndex,2);assert.equal(witness.nextPoint,null);assert.equal(witness.vehicleProgress,null);
    assert.equal(witness.exitNodeId,exit);assert.equal(witness.direction,direction);assert.equal(JSON.stringify(actor),before);
    assert.equal(roadExitRoute(f.world,f.state,actor.id,actor.position)!.exitNodeId,exit);
    assert.equal(roadMovementAllowed(f.world,f.state,actor.id,p(x),p(x+direction)),true);
    assert.equal(roadMovementAllowed(f.world,f.state,actor.id,p(x),p(x-direction)),false);validateRoadNetwork(f.state,f.world);
  }
});
test('empty unfinished stale off-deck dead riding and interior routes do not gain stationary permits',()=>{
  const cases:[string,(f:ReturnType<typeof fixture>,actor:Citizen)=>void][]=[
    ['empty',(_f,a)=>{a.route=[];a.routeIndex=0;}],['unfinished',(_f,a)=>{a.routeIndex=0;}],
    ['past-end',(_f,a)=>{a.routeIndex=2;}],['negative',(_f,a)=>{a.routeIndex=-1;}],['fractional',(_f,a)=>{a.routeIndex=.5;}],
    ['stale-tail',(_f,a)=>{a.route=[p(41)];}],['crossing-next',(_f,a)=>{a.route=[p(40),p(0,200)];a.routeIndex=1;}],
    ['off-deck',(_f,a)=>{a.position=p(40,6);a.route=[{...a.position}];}],['upper',(_f,a)=>{a.position=p(40,0,12);a.route=[{...a.position}];}],
    ['riding',(_f,a)=>{a.state='riding';}],['dead',(f,a)=>{Reflect.set(f.state,'extension',{lastUpdate:480,actorProfiles:{[a.id]:{alive:false}}});}],
    ['interior',(f)=>{f.world.buildings.push({id:'inside',name:'inside',kind:'home',districtId:'town',position:p(40,0,-.6),door:p(45),width:10,depth:10,height:6,floors:1,rotation:0,capacity:2,seed:1});}]
  ];
  for(const [label,change] of cases) {
    const f=fixture(),actor=f.state.citizens[0];actor.state='investigating';actor.route=[{...actor.position}];actor.routeIndex=1;change(f,actor);
    const before=JSON.stringify(actor);f.close();assert.equal(roadExitPermit(f.state,actor.id),null,label);assert.equal(JSON.stringify(actor),before,label);
  }
});
test('completed route snapshots reject zero length false direction and malformed witness atomically',()=>{
  const f=fixture(),actor=f.state.citizens[0];actor.route=[{...actor.position}];actor.routeIndex=1;f.close();const original=JSON.stringify(f.state);
  for(const corrupt of [(s:SimState)=>{s.roadNetwork!.closures[0].occupants.find(w=>w.actorId===actor.id)!.routeIndex=0;},
    (s:SimState)=>{s.roadNetwork!.closures[0].occupants.find(w=>w.actorId===actor.id)!.routeIndex=1025;},
    (s:SimState)=>{const w=s.roadNetwork!.closures[0].occupants.find(w=>w.actorId===actor.id)!;w.direction=1;w.exitNodeId='B';const permit=s.roadNetwork!.permits[actor.id];permit.direction=1;permit.exitNodeId='B';},
    (s:SimState)=>{Reflect.deleteProperty(s.roadNetwork!.closures[0].occupants.find(w=>w.actorId===actor.id)!,'nextPoint');},
    (s:SimState)=>{s.roadNetwork!.closures[0].occupants.find(w=>w.actorId===actor.id)!.nextPoint=p(40);},
    (s:SimState)=>{s.roadNetwork!.closures[0].occupants.find(w=>w.actorId===actor.id)!.vehicleProgress=.5;}]) {
    const candidate=JSON.parse(original) as SimState;corrupt(candidate);const before=JSON.stringify(candidate);assert.throws(()=>validateRoadNetwork(candidate,f.world),/道路/);assert.equal(JSON.stringify(candidate),before);
  }
  assert.equal(JSON.stringify(f.state),original);
});
test('historical completed snapshot survives a later intent change and disappears only after actual exit',()=>{
  const f=fixture(),actor=f.state.citizens[0];actor.route=[{...actor.position}];actor.routeIndex=1;f.close();
  actor.route=[];actor.routeIndex=0;actor.destinationId=null;actor.state='idle';const saved=JSON.stringify(f.state),restored=JSON.parse(saved) as SimState;
  validateRoadNetwork(restored,f.world);assert.equal(JSON.stringify(restored),saved);assert.equal(roadExitRoute(f.world,restored,actor.id,p(40))!.exitNodeId,'A');
  assert.equal(releaseRoadExitPermit(f.world,restored,actor.id,p(0)),false,'proposed future coordinates do not release current occupancy');
  restored.citizens[0].position=p(0);assert.equal(releaseRoadExitPermit(f.world,restored,actor.id,restored.citizens[0].position),true);
  assert.equal(roadExitPermit(restored,actor.id),null);assert.equal(roadMovementAllowed(f.world,restored,actor.id,p(0),p(1)),false);
});
