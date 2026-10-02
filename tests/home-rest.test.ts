import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { getBuildingBody, getBuildingEntrance, getBuildingUsePoints, getBuildingFloorPlan, floorPlanSupport, findFloorPlanRoute, getFloorPlanStairPosition } from '../src/architecture-floor-plan';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { HOME_REST_HISTORY_LIMIT, HOME_REST_MINUTES, homeRestPoints, homeRestPointAt, homeRestBedOccupied, homeRestBlockedReason, installHomeRest, validateHomeRest, type HomeRestSimulation, type HomeRestState } from '../src/simulation/home-rest';
import type { Building, Command, CommandResult, SimState, WorldDefinition } from '../src/types';

type State = SimState & { homeRest?: HomeRestState };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function home(): Building {
  const building: Building = { id: 'market-b24', districtId: 'market', name: '真实三层里居', kind: 'home', position: {x:-390.8,y:76,z:316.20000000000005}, width:40,depth:34.4,height:10.200000000000001,floors:3,rotation:0,door:{x:-390.8,y:76.60000000000001,z:333.40000000000003},capacity:129,seed:668619109,floorPlanProfile:'v4-program-bodies-02' };
  building.functionPoints = Array.from({length:building.floors},(_,floor)=>getBuildingUsePoints(building,floor)).flat(); return building;
}
/** Only this module's structural hooks run. No Simulation, NPC ticks or renderer.
 * The clock advances through fixed people callbacks; imported state replaces
 * the object only after every candidate validator succeeds, as core does. */
class Harness implements HomeRestSimulation {
  state: State;
  worldDefinition: {buildings: Building[]};
  phases: ((state: SimState, minutes: number)=>void)[]=[];
  handlers: ((command: Command)=>CommandResult|null)[]=[];
  validators: ((state: SimState)=>void)[]=[];
  loads: (()=>void)[]=[];
  constructor(building=home()) {
    this.worldDefinition={buildings:[building]}; const point=homeRestPoints(building,0)[0]; assert(point,'real original bed must have a clear connected side');
    this.state={version:1,seed:1,tick:0,day:0,hour:8,paused:false,speed:1,voxels:[],citizens:[],
      player:{position:{...point.position},role:'traveler',identities:['traveler'],money:520,homeId:building.id,vehicleId:null,needs:{hunger:90,fatigue:20,fun:10,social:70},inventory:{},reputation:0,education:0,experience:0,partnerId:null},
      extension:{lastUpdate:480,actorProfiles:{player:{alive:true}}}} as unknown as State;
    installHomeRest(this);
  }
  onPhase(_phase:'people',handler:(state:SimState,minutes:number)=>void){this.phases.push(handler);}
  registerCommandHandler(handler:(command:Command)=>CommandResult|null){this.handlers.push(handler);}
  registerSaveValidator(handler:(state:SimState)=>void){this.validators.push(handler);}
  onLoad(handler:()=>void){this.loads.push(handler);}
  command(type:string,targetId?:string){for(const handler of this.handlers){const result=handler({type,targetId} as Command);if(result)return result;}return null;}
  tick(minutes=.25){if(this.state.paused)return;this.state.extension!.lastUpdate+=minutes;this.state.tick++;for(const phase of this.phases)phase(this.state,minutes);}
  advance(minutes:number){for(let i=0;i<minutes*4;i++)this.tick();}
  save(){return JSON.stringify(this.state);}
  load(json:string){const candidate=JSON.parse(json) as State;for(const validator of this.validators)validator(candidate);this.state=candidate;for(const hook of this.loads)hook();}
  get rest(){return this.state.homeRest!;}
  get building(){return this.worldDefinition.buildings[0];}
}
const approximately=(a:number,b:number)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('real market-b24 beds derive connected .35-floor points through all three floors without touching geometry or fingerprint',()=>{
  const building=home(),body=getBuildingBody(building)!;
  const world={seed:1,voxelSize:.2,size:4000,buildings:[building],nodes:[],edges:[],districts:[],mountains:[],waterfall:{top:{x:0,y:1,z:0},bottom:{x:0,y:0,z:0},width:1},river:[],spawn:building.door,layoutVersion:'current-v4'} as WorldDefinition;
  const before=JSON.stringify({building,body}), fingerprint=savedWorldFingerprint(world),ids=new Set<string>(),beds=new Set<string>();
  for(let floor=0;floor<3;floor++) {
    const points=homeRestPoints(building,floor);assert(points.length>0);
    for(const point of points){assert(!ids.has(point.id));ids.add(point.id);beds.add(point.bedId);
      const support=floorPlanSupport(building,floor,point.position,.35)!;assert.equal(support.kind,'room');assert.equal(support.floor,floor);approximately(support.y,point.position.y);
      assert(findFloorPlanRoute(building,floor,getFloorPlanStairPosition(building,floor),point.position,.35));
      assert.equal(homeRestPointAt(building,point.position,{role:'traveler'})!.id,point.id);
      assert.equal(homeRestPointAt(building,{...point.position,y:point.position.y+.6},{role:'traveler'}),null,'bed-top elevation is not a legal floor standing point');
    }
  }
  assert.equal(beds.size,3,'the repeated home-bed fixture name must include floor');
  assert.equal(JSON.stringify({building,body}),before);assert.equal(savedWorldFingerprint(world),fingerprint);
  const old=clone(building);delete old.floorPlanProfile;delete old.functionPoints;assert.deepEqual(homeRestPoints(old,0),[]);
});

test('starting and repeating rest cannot instantly credit needs, minutes or money; exact onsite completion credits once',()=>{
  const h=new Harness(),initial=clone(h.state.player);
  assert.equal(h.command('rest',h.building.id)!.ok,true);assert.deepEqual(h.state.player,initial);assert.equal(h.rest.session!.progressMinutes,0);
  const running=h.save();assert.equal(h.command('rest',h.building.id)!.ok,false);assert.equal(h.save(),running);
  h.advance(19.75);approximately(h.rest.session!.progressMinutes,19.75);assert.equal(h.rest.history.length,0);
  h.tick();assert.equal(h.rest.session,null);assert.equal(h.rest.history.length,1);assert.equal(h.rest.history[0].state,'completed');assert.equal(h.rest.history[0].progressMinutes,HOME_REST_MINUTES);
  approximately(h.state.player.needs.fatigue,initial.needs.fatigue+38);approximately(h.state.player.needs.fun,initial.needs.fun+12);assert.equal(h.state.player.money,initial.money);
  assert.equal(homeRestBedOccupied(h.state,h.rest.history[0].bedId),false);validateHomeRest(h.state,h.worldDefinition.buildings);
});

test('leaving pauses without backfilling time; return requires an explicit legal resume with original progress',()=>{
  const h=new Harness();assert(h.command('rest')!.ok);const point={...h.state.player.position};h.advance(3);
  assert(homeRestBedOccupied(h.state,h.rest.session!.bedId));h.state.player.position={...h.building.door};
  assert.equal(homeRestBedOccupied(h.state,h.rest.session!.bedId),false,'actual departure releases a bed before the next phase');
  const before=clone(h.state.player.needs);h.tick();
  assert.equal(h.rest.session!.state,'paused');assert.equal(h.rest.session!.progressMinutes,3);assert.deepEqual(h.state.player.needs,before);
  h.advance(10);h.state.player.position=point;h.advance(5);assert.equal(h.rest.session!.progressMinutes,3);assert.deepEqual(h.state.player.needs,before);
  assert(h.command('rest')!.ok);assert.equal(h.rest.session!.progressMinutes,3);assert.deepEqual(h.state.player.needs,before);h.tick();approximately(h.rest.session!.progressMinutes,3.25);
});

test('display time, pause and missed callbacks grant no elapsed recovery or load catchup',()=>{
  const h=new Harness();assert(h.command('rest')!.ok);h.tick();const before=clone(h.rest.session),needs=clone(h.state.player.needs);
  h.state.hour=23;assert.deepEqual(h.rest.session,before);h.state.hour=1;h.state.paused=true;h.advance(10);assert.deepEqual(h.rest.session,before);assert.deepEqual(h.state.player.needs,needs);
  h.state.paused=false;h.state.extension!.lastUpdate+=100;h.tick();approximately(h.rest.session!.progressMinutes,.5);
  const after=h.save();for(const phase of h.phases)phase(h.state,.25);assert.equal(h.save(),after,'same clock cannot credit a second callback');
});

test('start rejects wrong ownership, feet height, permission, work, treatment and vehicles without mutating a save',()=>{
  const mutations: ((h:Harness)=>void)[]=[
    h=>{h.state.player.homeId=null;}, h=>{h.state.player.position.y+=.6;},
    h=>{h.building.publicFloors=0;h.building.requiredPermission='mayor';},
    h=>{h.state.player.vehicleId='vehicle';},h=>{h.state.aviation={activeAircraftId:'aircraft'} as State['aviation'];},
    h=>{h.state.extension!.actorProfiles.player.alive=false;},h=>{h.state.playerLabor={job:{status:'working'}} as State['playerLabor'];},
    h=>{h.state.clinical={orders:[{patientId:'player',state:'inTreatment'}]} as State['clinical'];},
    h=>{h.state.player.position={...h.building.functionPoints![0].position};},
    h=>{h.state.voxels=[{id:'blocking',position:{...h.state.player.position,y:h.state.player.position.y+.8},color:'#888'}];},
  ];
  for(const mutation of mutations){const h=new Harness();mutation(h);const before=h.save();assert.equal(h.command('rest',h.building.id)!.ok,false);assert.equal(h.save(),before);}
  const h=new Harness(),upper=homeRestPoints(h.building,1)[0];h.building.publicFloors=1;h.building.floorPermissions=['public','mayor','mayor'];
  assert.equal(homeRestPointAt(h.building,upper.position,h.state.player),null);
});

test('a rented v4 home does not intercept untargeted public rest, and cached points remain private',()=>{
  const h=new Harness(),points=homeRestPoints(h.building,0),original=clone(points);
  points[0].position.y+=100;points[0].bedId='changed-by-consumer';points.splice(1);
  assert.deepEqual(homeRestPoints(h.building,0),original,'NPC and player consumers cannot change the cache');
  h.state.player.position={x:900,y:20,z:100};const before=h.save();
  assert.equal(h.command('rest'),null,'core must select the actual nearby public facility');assert.equal(h.save(),before);
  assert.equal(h.command('rest',h.building.id)!.ok,false,'an explicit remote home still rejects');
  h.state.player.position={...original[0].position};assert(h.command('rest')!.ok);h.tick();h.state.player.position={x:900,y:20,z:100};
  const departed=h.save();assert.equal(h.command('rest'),null,'an active departure snapshot must also leave public rest to core');assert.equal(h.save(),departed);
  h.tick();const paused=h.save();assert.equal(h.command('rest'),null,'a paused home session must not block public rest');assert.equal(h.save(),paused);
});

test('loss of permissions or boarding interrupts actual active time; death or home change cancels without payout',()=>{
  for(const mutate of [
    (h:Harness)=>{h.state.player.vehicleId='vehicle';},
    (h:Harness)=>{h.building.publicFloors=0;h.building.requiredPermission='mayor';},
  ]) {const h=new Harness();assert(h.command('rest')!.ok);h.tick();const earned=h.rest.session!.progressMinutes,needs=clone(h.state.player.needs);mutate(h);h.tick();assert.equal(h.rest.session!.state,'paused');assert.equal(h.rest.session!.progressMinutes,earned);assert.deepEqual(h.state.player.needs,needs);}
  for(const mutate of [(h:Harness)=>{h.state.player.homeId=null;},(h:Harness)=>{h.state.extension!.actorProfiles.player.alive=false;}]) {
    const h=new Harness();assert(h.command('rest')!.ok);h.tick();const wallet=h.state.player.money;mutate(h);h.tick();assert.equal(h.rest.session,null);assert.equal(h.rest.history[0].state,'cancelled');assert.equal(h.state.player.money,wallet);validateHomeRest(h.state,h.worldDefinition.buildings);
  }
});

test('cancel is explicit, releases the physical bed, and keeps only a bounded completed tail',()=>{
  const h=new Harness();assert(h.command('rest')!.ok);h.tick();assert(h.command('cancelRest')!.ok);assert.equal(h.rest.session,null);assert.equal(h.rest.history[0].progressMinutes,.25);
  const before=h.save();assert.equal(h.command('cancelRest')!.ok,false);assert.equal(h.save(),before);
  for(let i=0;i<HOME_REST_HISTORY_LIMIT+4;i++){assert(h.command('rest')!.ok);assert(h.command('cancelRest')!.ok);}
  assert.equal(h.rest.history.length,HOME_REST_HISTORY_LIMIT);assert(h.command('rest')!.ok);assert(h.rest.session);assert.equal(h.rest.history.length,HOME_REST_HISTORY_LIMIT);validateHomeRest(h.state,h.worldDefinition.buildings);
});

test('active and paused save roundtrips resume byte-exactly for identical future people ticks',()=>{
  for(const paused of [false,true]) {
    const h=new Harness();assert(h.command('rest')!.ok);h.advance(4);if(paused){h.state.player.position={...h.building.door};h.tick();}
    const saved=h.save(),copy=new Harness();copy.load(saved);assert.equal(copy.save(),saved);
    for(let tick=0;tick<24;tick++){h.tick();copy.tick();assert.equal(copy.save(),h.save());}
  }
});

test('old module absence migrates to empty session; malformed clocks, bed ids, feet and progress are rejected atomically',()=>{
  const h=new Harness();const old=clone(h.state);delete old.homeRest;h.load(JSON.stringify(old));assert.equal(h.rest.session,null);assert.deepEqual(h.rest.history,[]);
  assert(h.command('rest')!.ok);h.advance(2);const valid=h.save();
  const corrupt: ((data:State)=>void)[]=[
    d=>{d.homeRest=null as unknown as HomeRestState;},d=>{d.homeRest!.version=2 as 1;},
    d=>{d.homeRest!.lastObservedAt=d.extension!.lastUpdate+1;},d=>{d.homeRest!.session!.lastObservedAt=d.extension!.lastUpdate+1;},
    d=>{d.homeRest!.session!.bedId='not-real-bed';},d=>{d.homeRest!.session!.pointId='not-real-point';},
    d=>{d.homeRest!.session!.point.y+=.2;},d=>{d.homeRest!.session!.progressMinutes=3;},
    d=>{d.homeRest!.session!.requiredMinutes=1;},d=>{d.homeRest!.history=[clone(d.homeRest!.session!)];},
  ];
  for(const mutate of corrupt){const data=JSON.parse(valid) as State;mutate(data);assert.throws(()=>h.load(JSON.stringify(data)));assert.equal(h.save(),valid);}
  h.advance(18);const completed=h.save(),data=JSON.parse(completed) as State;data.homeRest!.history[0].endedAt=data.homeRest!.history[0].startedAt;
  assert.throws(()=>h.load(JSON.stringify(data)));assert.equal(h.save(),completed,'past completion time cannot precede actual observed recovery');
});

test('real standing head obstruction cannot use a bed-side point even though the bed itself still exists',()=>{
  const h=new Harness(),point=homeRestPoints(h.building,0)[0],p=getBuildingFloorPlan(h.building,0)!;
  const x=point.position.x-h.building.position.x,z=point.position.z-h.building.position.z;
  p.fixtures.push({id:'blocking-shelf',kind:'shelf',rect:{x0:x-.2,x1:x+.2,z0:z-.2,z1:z+.2},bottom:1,top:1.6});
  assert.equal(homeRestPointAt(h.building,point.position,h.state.player),null);
  const before=h.save();assert.equal(h.command('rest',h.building.id)!.ok,false);assert.equal(h.save(),before);
});

test('a live NPC actually resting on the same bed blocks entry; a route, another floor or a dead NPC does not',()=>{
  const h=new Harness(),point=homeRestPoints(h.building,0)[0];
  const person={id:'npc',name:'住户',districtId:'market',homeId:h.building.id,workId:h.building.id,role:'traveler',position:{...point.position},state:'atHome',destinationId:h.building.id,money:10,needs:{hunger:90,fatigue:20,fun:10,social:70},tier:'active' as const};
  h.state.citizens=[person];const before=h.save();assert.match(homeRestBlockedReason(h.state,h.building),/已有居民实际到场/);assert.equal(h.command('rest',h.building.id)!.ok,false);assert.equal(h.save(),before);
  person.position={...homeRestPoints(h.building,1)[0].position};assert(h.command('rest',h.building.id)!.ok);assert(h.command('cancelRest')!.ok);
  person.position={...h.building.door};person.state='moving';Object.assign(person,{route:[{...point.position}],routeIndex:0});
  assert(h.command('rest',h.building.id)!.ok,'a future destination alone cannot occupy the physical bed');assert(h.command('cancelRest')!.ok);
  person.position={...point.position};person.state='sleeping';h.state.extension!.actorProfiles.npc={alive:false} as NonNullable<State['extension']>['actorProfiles'][string];
  assert(h.command('rest',h.building.id)!.ok,'deceased NPC is not an active bed occupant');
});

function integratedWorld(): WorldDefinition {
  const realHome=home(),kinds: Building['kind'][]=['market','clinic','school','station','workshop','bank'];
  const buildings=[realHome,...kinds.map((kind,index):Building=>{
    const site:Building={id:`rest-${kind}`,districtId:'market',name:kind,kind,position:{x:realHome.position.x+(index+1)*120,y:76,z:realHome.position.z},
      width:40,depth:32,height:10.2,floors:3,rotation:0,door:{x:0,y:0,z:0},capacity:50,seed:index+7,floorPlanProfile:'v4-program-bodies-02'};
    site.door=getBuildingEntrance(site);site.functionPoints=Array.from({length:site.floors},(_,floor)=>getBuildingUsePoints(site,floor)).flat();return site;
  })];
  const nodes=buildings.flatMap(building=>[{id:`${building.id}-door`,name:building.name,districtId:'market',position:{...building.door},station:false},
    {id:`${building.id}-street`,name:building.name,districtId:'market',position:{x:building.position.x,y:76.6,z:realHome.position.z+35},station:building.kind==='station'}]);
  const edges:WorldDefinition['edges']=buildings.map((building,index)=>({id:`door-${building.id}`,from:nodes[index*2].id,to:nodes[index*2+1].id,mode:'road',
    length:Math.hypot(nodes[index*2].position.z-nodes[index*2+1].position.z),capacity:20,points:[nodes[index*2].position,nodes[index*2+1].position]}));
  for(let index=1;index<buildings.length;index++)edges.push({id:`street-${index}`,from:nodes[index*2-1].id,to:nodes[index*2+1].id,mode:'road',length:120,capacity:20,points:[nodes[index*2-1].position,nodes[index*2+1].position]});
  return {seed:911,voxelSize:.2,size:4000,buildings,nodes,edges,districts:[{id:'market',name:'床侧状态契约',kind:'market',center:{x:0,y:76,z:320},radius:1200,color:'#888',population:384}],
    spawn:{...realHome.door},mountains:[],river:[],waterfall:{top:{x:1800,y:100,z:1800},bottom:{x:1800,y:0,z:1800},width:10}};
}
function integrated(world=integratedWorld()):Simulation {
  const sim=new Simulation(world),building=world.buildings[0];sim.state.player.homeId=building.id;sim.state.player.needs.fatigue=20;sim.state.player.needs.fun=10;
  sim.setFocus(homeRestPoints(building,0)[0].position,'walk');return sim;
}
function integratedMinutes(sim:Simulation,minutes:number){for(let i=0;i<minutes*4;i++)sim.step(.25);}

test('actual night NPC chooses a real reachable bed side; a player occupying that bed makes it choose another physical bed',()=>{
  const sim=integrated(),building=sim.worldDefinition.buildings[0],citizen=sim.state.citizens.find(person=>sim.state.extension!.actorProfiles[person.id].age>=18)!;
  assert(sim.command({type:'rest',targetId:building.id}).ok);const playerBed=sim.state.homeRest!.session!.bedId;
  citizen.position={...building.door};citizen.destinationId=null;citizen.state='atHome';citizen.role='traveler';citizen.needs={hunger:90,fatigue:20,fun:90,social:90};
  sim.command({type:'setTime',value:23});sim.step(.25);
  assert.equal(citizen.destinationId,building.id);assert(citizen.route?.length);const target=citizen.route!.at(-1)!;
  const point=Array.from({length:building.floors},(_,floor)=>homeRestPoints(building,floor)).flat().find(point=>Math.hypot(point.position.x-target.x,point.position.y-target.y,point.position.z-target.z)<1e-8);
  assert(point,'normal night decision must target a derived bed side, never the former table service point');assert.notEqual(point.bedId,playerBed);
  assert(floorPlanSupport(building,point.floor,point.position,.35));assert(findFloorPlanRoute(building,point.floor,getFloorPlanStairPosition(building,point.floor),point.position,.35));
  const phaseFatigue=citizen.needs.fatigue;
  assert.equal(citizen.state,'moving');assert(citizen.needs.fatigue<=20,'travelling toward a bed cannot receive onsite rest');
  citizen.position={...point.position};citizen.routeIndex=citizen.route!.length;citizen.state='sleeping';
  sim.setFocus(point.position,'walk');assert(sim.command({type:'cancelRest'}).ok);const before=sim.exportSave();
  assert.equal(sim.command({type:'rest',targetId:building.id}).ok,false,'player cannot claim a different side of an NPC occupied bed');assert.equal(sim.exportSave(),before);
  sim.step(.25);assert(citizen.needs.fatigue>phaseFatigue,'actual arrival permits the existing night recovery rule');
});

test('actual oversubscribed home at night reserves each bed once and sends overflow to public rest without travelling recovery',()=>{
  const sim=integrated(),building=sim.worldDefinition.buildings[0],points=Array.from({length:building.floors},(_,floor)=>homeRestPoints(building,floor)).flat();
  const beds=new Set(points.map(point=>point.bedId));assert.equal(beds.size,3);assert.equal(sim.state.citizens.length,384);
  assert(sim.state.citizens.every(person=>person.homeId===building.id),'native initialization genuinely exceeds the existing home beds');
  const originalHomes=sim.state.citizens.map(person=>person.homeId),fingerprint=savedWorldFingerprint(sim.worldDefinition);
  const activities=()=>Reflect.get(sim,'runtime').activities as Record<string,string>;
  const verifyReservations=()=>{
    const counts=new Map<string,number>();let publicTargets=0;
    for(const person of sim.state.citizens) {
      if(activities()[person.id]!=='rest')continue;
      const destination=sim.worldDefinition.buildings.find(site=>site.id===person.destinationId);assert(destination,'rest decision must retain a real destination');
      const target=person.route?.at(-1);assert(target,'rest decision must retain its actual route endpoint');
      if(destination.id===building.id) {
        const point=points.find(point=>Math.hypot(point.position.x-target.x,point.position.y-target.y,point.position.z-target.z)<1e-8);
        assert(point,'full home must not create an unreachable route ending at its doorway');
        counts.set(point.bedId,(counts.get(point.bedId)??0)+1);assert.equal(counts.get(point.bedId),1,'different sides of one bed still allow only one NPC reservation');
      } else {
        assert(['pavilion','station','clinic'].includes(destination.kind),'night overflow must use an advertised public rest facility');
        assert.equal(destination.districtId,person.districtId);assert(sim.isAtBuildingFunctionPoint(destination,target,'service'));
        assert.notEqual(person.state,'unreachable');publicTargets++;
      }
    }
    assert.equal(counts.size,beds.size,'all three existing beds are used without changing their geometry');assert(publicTargets>0,'overflow residents must select an actual public opportunity');
  };
  sim.command({type:'setTime',value:23});const startNeeds=new Map(sim.state.citizens.map(person=>[person.id,person.needs.fatigue]));sim.step(.25);verifyReservations();
  const overflow=sim.state.citizens.find(person=>activities()[person.id]==='rest'&&person.destinationId!==building.id&&person.state==='moving')!;
  assert(overflow,'normal fixed tick must start a public route from the naturally assigned home');
  const destination=overflow.destinationId,endpoint={...overflow.route!.at(-1)!},wallet=overflow.money;
  assert(overflow.needs.fatigue<=startNeeds.get(overflow.id)!,'the first travelling tick cannot recover fatigue');
  for(let i=0;i<3;i++) {
    const from={...overflow.position},fatigue=overflow.needs.fatigue;sim.step(.25);verifyReservations();
    assert.equal(overflow.destinationId,destination,'a full home cannot cause repeated unreachable-home selection');assert.deepEqual(overflow.route!.at(-1),endpoint);
    assert.equal(overflow.state,'moving');assert(overflow.needs.fatigue<=fatigue,'all elapsed minutes are still spent travelling');assert.equal(overflow.money,wallet);
    assert(Math.hypot(overflow.position.x-from.x,overflow.position.y-from.y,overflow.position.z-from.z)<=1.05+1e-7,'public fallback uses ordinary physical walking speed');
  }
  const valid=sim.exportSave(),copy=new Simulation(sim.worldDefinition);assert(copy.importSave(valid).ok);assert.equal(copy.exportSave(),valid);
  for(let i=0;i<2;i++){sim.step(.25);copy.step(.25);verifyReservations();assert.equal(copy.exportSave(),sim.exportSave());}
  assert.deepEqual(sim.state.citizens.map(person=>person.homeId),originalHomes,'overflow routing does not migrate housing or change old save assignments');
  assert.equal(savedWorldFingerprint(sim.worldDefinition),fingerprint);
});

test('actual Simulation home rest starts without instant credit and completes only after twenty real minutes',()=>{
  const sim=integrated(),building=sim.worldDefinition.buildings[0],before=clone(sim.state.player),fingerprint=savedWorldFingerprint(sim.worldDefinition);
  assert.equal(sim.command({type:'rest',targetId:building.id}).ok,true);assert.deepEqual(sim.state.player,before);
  integratedMinutes(sim,19.75);assert.equal(sim.state.homeRest!.session!.progressMinutes,19.75);assert.equal(sim.state.homeRest!.history.length,0);
  sim.step(.25);assert.equal(sim.state.homeRest!.session,null);assert.equal(sim.state.homeRest!.history[0].progressMinutes,20);
  approximately(sim.state.player.needs.fatigue,20+38-20*.018);approximately(sim.state.player.needs.fun,10+12-20*.009);
  assert.equal(sim.state.player.money,before.money);assert.equal(savedWorldFingerprint(sim.worldDefinition),fingerprint);
});

test('actual Simulation rejects the old desk point and preserves untargeted public station fees',()=>{
  const sim=integrated(),building=sim.worldDefinition.buildings[0];sim.setFocus(building.functionPoints![0].position,'walk');
  for(const command of [{type:'rest' as const},{type:'rest' as const,targetId:building.id}]){const before=sim.exportSave();assert.equal(sim.command(command).ok,false);assert.equal(sim.exportSave(),before);}
  const station=sim.worldDefinition.buildings.find(site=>site.kind==='station')!,point=station.functionPoints!.find(point=>point.purpose==='service'&&point.floor===0)!;
  sim.setFocus(point.position,'walk');const money=sim.state.player.money,fatigue=sim.state.player.needs.fatigue;
  assert.equal(sim.command({type:'rest'}).ok,true);assert.equal(sim.state.player.money,money-5);assert.equal(sim.state.player.needs.fatigue,fatigue+23);assert.equal(sim.state.homeRest!.session,null);
  sim.setFocus(homeRestPoints(building,0)[0].position,'walk');assert(sim.command({type:'rest'}).ok);sim.step(.25);
  const earned=sim.state.homeRest!.session!.progressMinutes;sim.setFocus(point.position,'walk');sim.command({type:'setTime',value:9});
  const activeWallet=sim.state.player.money;assert(sim.command({type:'rest'}).ok);assert.equal(sim.state.player.money,activeWallet-5);
  assert.equal(sim.state.homeRest!.session!.state,'active','public command never mutates a valid between-phase home snapshot');assert.equal(sim.state.homeRest!.session!.progressMinutes,earned);
  sim.step(.25);assert.equal(sim.state.homeRest!.session!.state,'paused');assert.equal(sim.state.homeRest!.session!.progressMinutes,earned);
  sim.command({type:'setTime',value:10});const pausedWallet=sim.state.player.money;assert(sim.command({type:'rest'}).ok);assert.equal(sim.state.player.money,pausedWallet-5);
  assert.equal(sim.state.homeRest!.session!.state,'paused');assert.equal(sim.state.homeRest!.session!.progressMinutes,earned,'public facilities cannot backfill home recovery');
});

test('actual Simulation active rest saves exactly, continues identically and rejects bad bed/manifest atomically',()=>{
  const sim=integrated();assert(sim.command({type:'rest'}).ok);integratedMinutes(sim,3);
  const valid=sim.exportSave(),copy=integrated(sim.worldDefinition);assert.equal(copy.importSave(valid).ok,true);assert.equal(copy.exportSave(),valid);
  for(const mutate of [
    (data:any)=>{data.state.homeRest.session.bedId='missing-bed';},
    (data:any)=>{data.state.homeRest.lastObservedAt=data.state.extension.lastUpdate+1;},
    (data:any)=>{delete data.state.homeRest;},
    (data:any)=>{data.runtime.persistedModules=data.runtime.persistedModules.filter((name:string)=>name!=='homeRest');},
  ]) {const data=JSON.parse(valid);mutate(data);assert.equal(sim.importSave(JSON.stringify(data)).ok,false);assert.equal(sim.exportSave(),valid);}
  for(let i=0;i<24;i++){sim.step(.25);copy.step(.25);assert.equal(copy.exportSave(),sim.exportSave());}
  const building=sim.worldDefinition.buildings[0],desk=building.functionPoints![0].position,earned=sim.state.homeRest!.session!.progressMinutes;
  sim.setFocus(desk,'walk');copy.setFocus(desk,'walk');
  const betweenUpdates=sim.exportSave();assert.equal(copy.importSave(betweenUpdates).ok,true,'active-but-just-departed is a lawful snapshot before people pauses it');
  const fatigue=sim.state.player.needs.fatigue;sim.step(.25);copy.step(.25);
  assert.equal(sim.state.homeRest!.session!.state,'paused');assert.equal(sim.state.homeRest!.session!.progressMinutes,earned);
  approximately(sim.state.player.needs.fatigue,fatigue-.25*.018);assert.equal(copy.exportSave(),sim.exportSave());
  const paused=sim.exportSave();assert.equal(copy.importSave(paused).ok,true);assert.equal(copy.exportSave(),paused);
  for(let i=0;i<4;i++){sim.step(.25);copy.step(.25);assert.equal(copy.exportSave(),sim.exportSave());assert.equal(sim.state.homeRest!.session!.progressMinutes,earned);}
  sim.setFocus(homeRestPoints(building,0)[0].position,'walk');copy.setFocus(homeRestPoints(building,0)[0].position,'walk');
  assert(sim.command({type:'rest'}).ok);assert(copy.command({type:'rest'}).ok);assert.equal(sim.state.homeRest!.session!.progressMinutes,earned);
  sim.step(.25);copy.step(.25);assert.equal(sim.state.homeRest!.session!.progressMinutes,earned+.25);assert.equal(copy.exportSave(),sim.exportSave());
  const old=JSON.parse(valid);delete old.state.homeRest;old.runtime.persistedModules=old.runtime.persistedModules.filter((name:string)=>name!=='homeRest');
  assert.equal(copy.importSave(JSON.stringify(old)).ok,true);assert.equal(copy.state.homeRest!.session,null);assert.deepEqual(copy.state.homeRest!.history,[]);
  assert.equal(copy.state.homeRest!.version,1);assert.equal(copy.state.homeRest!.nextId,1);
  assert.equal(copy.state.homeRest!.lastObservedAt,copy.state.extension!.lastUpdate,'a physical v4 home migrates an absent old module at its actual clock without inferred progress');
});
