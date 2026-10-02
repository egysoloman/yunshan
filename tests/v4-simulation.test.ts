import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { planWalkingJourney } from '../src/journey';
import { canAccessFloor } from '../src/access';
import { blocksFloorPlanMovement, buildingWorldPosition, containsUnion, floorPlanSupport, getBuildingEntrance, getBuildingFloorPlan, getBuildingUsePoints, getFloorPlanStairRoute } from '../src/architecture-floor-plan';
import type { Building, Vec3, WorldDefinition } from '../src/types';

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function fixture(marked = true): WorldDefinition {
  const kinds: Building['kind'][] = ['home','market','clinic','school','station','workshop','bank'];
  const buildings = kinds.map((kind,index): Building => {
    const building: Building = {id:`v4-${kind}`,districtId:'town',name:kind,kind,position:{x:index*120,y:0,z:0},width:40,depth:32,height:12,floors:3,rotation:0,door:{x:index*120,y:.6,z:16},capacity:50,seed:index+7};
    if(marked){building.floorPlanProfile='v4-program-bodies-02';building.door=getBuildingEntrance(building);building.functionPoints=Array.from({length:building.floors},(_,floor)=>getBuildingUsePoints(building,floor)).flat();}
    return building;
  });
  const nodes=buildings.flatMap(building=>[{id:`${building.id}-door`,name:building.name,districtId:'town',position:{...building.door},station:false},{id:`${building.id}-street`,name:building.name,districtId:'town',position:{x:building.position.x,y:.6,z:35},station:building.kind==='station'}]);
  const edges:WorldDefinition['edges']=buildings.map((building,index)=>({id:`door-road-${building.id}`,from:nodes[index*2].id,to:nodes[index*2+1].id,mode:'road',length:distance(nodes[index*2].position,nodes[index*2+1].position),capacity:20,points:[{...nodes[index*2].position},{...nodes[index*2+1].position}]}));
  for(let index=1;index<buildings.length;index++)edges.push({id:`street-${index}`,from:nodes[index*2-1].id,to:nodes[index*2+1].id,mode:'road',length:120,capacity:20,points:[{...nodes[index*2-1].position},{...nodes[index*2+1].position}]});
  return {seed:911,voxelSize:.2,size:4000,districts:[{id:'town',name:'小城',kind:'market',center:{x:360,y:0,z:0},radius:1200,color:'#888888',population:384}],buildings,nodes,edges,mountains:[],spawn:{...nodes[1].position},waterfall:{top:{x:1800,y:100,z:1800},bottom:{x:1800,y:0,z:1800},width:10},river:[{x:1800,y:0,z:1800},{x:1800,y:0,z:1900}]};
}
function courtPoint(building: Building): Vec3 {
  const plan=getBuildingFloorPlan(building,0)!;
  const local=plan.courtyard.map(r=>({x:(r.x0+r.x1)/2,z:(r.z0+r.z1)/2})).find(point=>!containsUnion(plan.interior,point.x,point.z)&&!containsUnion(plan.circulation,point.x,point.z)&&floorPlanSupport(building,0,buildingWorldPosition(building,{...point,y:plan.y}))?.kind==='courtyard');
  assert(local,'fixture must offer an actually supported courtyard away from rooms and fixtures');
  return buildingWorldPosition(building,{...local,y:plan.y});
}
function assertClear(building: Building, points: Vec3[]) {
  for(let index=1;index<points.length;index++){
    const a=points[index-1],b=points[index];if(Math.abs(a.y-b.y)>.001)continue;
    const floor=Math.round((a.y-building.position.y-.6)/(building.height/building.floors));
    assert.equal(blocksFloorPlanMovement(building,floor,a,b,.35,1.72),false,`route segment crosses a real wall/fixture: ${JSON.stringify({a,b})}`);
  }
}

test('v4 supported courtyard is outside a facility and cannot purchase through the old door radius',()=>{
  const world=fixture(),sim=new Simulation(world),market=world.buildings.find(b=>b.kind==='market')!,shop=sim.state.shops.find(shop=>shop.buildingId===market.id)!,courtyard=courtPoint(market);
  assert.equal(floorPlanSupport(market,0,courtyard)?.kind,'courtyard');
  assert.equal(sim.isNearBuilding(market,courtyard,0),false);
  assert.equal(sim.isNearBuilding(market,courtyard,32),false);
  sim.setFocus(courtyard,'walk');const before=sim.exportSave();
  assert.equal(sim.command({type:'purchase',targetId:shop.id}).ok,false);assert.equal(sim.exportSave(),before,'denial must not transfer money or consume food');
  const sale=market.functionPoints!.find(point=>point.purpose==='sale')!;sim.setFocus(sale.position,'walk');
  assert.equal(sim.isAtBuildingFunctionPoint(market,sale.position,'sale'),true);
  assert.equal(sim.command({type:'purchase',targetId:shop.id}).ok,true);
});

test('v4 actual NPC meal route ends at a real sale point and advances only at the existing walking speed',()=>{
  const world=fixture(),sim=new Simulation(world),market=world.buildings.find(b=>b.kind==='market')!,citizen=sim.state.citizens[0];
  citizen.needs={hunger:15,fatigue:100,social:100,fun:100};citizen.money=200;sim.setFocus(citizen.position,'walk');
  let customerCount=0;sim.onEvent('customer',event=>{if(event.citizenId===citizen.id){customerCount++;assert(sim.isAtBuildingFunctionPoint(market,citizen.position,'sale',{role:'traveler',identities:['traveler']}));}});
  const money=citizen.money;
  for(let tick=0;tick<500&&!customerCount;tick++){
    const before={...citizen.position};sim.step(.25);
    assert(distance(before,citizen.position)<=1.05+1e-7,'ordinary active movement must retain4.2m/minute and avoid teleportation');
    if(citizen.destinationId===market.id&&citizen.route?.length){assertClear(market,citizen.route);assert(market.functionPoints!.some(point=>point.purpose==='sale'&&distance(point.position,citizen.route!.at(-1)!)<1e-8));}
    if(!customerCount)assert.equal(citizen.money,money,'unfinished physical route cannot sell a meal');
  }
  assert(customerCount>0,'citizen must actually arrive at the public sale point');
  assert.equal(citizen.state,'shopping');assert(citizen.needs.hunger<30,'the customer event precedes the real commerce-stage purchase');
});

test('v4 public exit guidance uses a wall-free route from both a room and the ground courtyard',()=>{
  const world=fixture(),market=world.buildings.find(b=>b.kind==='market')!,room=market.functionPoints!.find(p=>p.floor===1&&p.purpose==='work')!.position;
  for(const origin of [courtPoint(market),room]){
    const route=planWalkingJourney(world,origin,'v4-home');assert(route,'the legal occupied origin must connect to its real door and public street');
    assert.deepEqual(route.points[0],origin);assert(route.points.some(point=>distance(point,market.door)<1e-8));assertClear(market,route.points);
    assert.equal(route.stairsFromFloor,origin===room?1:null);
  }
});

test('v4 guidance replans from an actual mid-flight stair tread without flattening the actor to a floor',()=>{
  const world=fixture(),market=world.buildings.find(b=>b.kind==='market')!,stairs=getFloorPlanStairRoute(market,0,1)!;
  const lower=stairs.find(point=>point.y>market.position.y+1.4&&point.y<market.position.y+2.5&&floorPlanSupport(market,0,point)?.link),upper=[...stairs].reverse().find(point=>point.y>market.position.y+3&&point.y<market.position.y+4.4&&floorPlanSupport(market,0,point)?.link);
  assert(lower&&upper,'fixture must provide body-supported treads on both real flights');
  for(const origin of [lower,upper]){
    const support=floorPlanSupport(market,0,origin)!;assert.equal(support.kind,'stairs');assert(Math.abs(support.y-origin.y)<1e-8);
    const route=planWalkingJourney(world,origin,'v4-home');assert(route,'a genuine supported stair origin must connect to the public door');
    assert.deepEqual(route.points[0],origin,'replanning must retain the actual height on the current tread');
    const first=route.points.find(point=>distance(point,origin)>.001);assert(first,'an exit must advance through real stairway points');
    assert(distance(origin,first)<1,'the first step cannot jump from the middle of a stair flight to its base floor');
    assert(route.points.some(point=>distance(point,market.door)<1e-8));assertClear(market,route.points);
  }
});

test('v4 work commands require the real accessible work point, while unmarked room proximity remains unchanged',()=>{
  const world=fixture(),sim=new Simulation(world),site=world.buildings.find(b=>b.kind==='school')!,points=site.functionPoints!,work=points.find(p=>p.purpose==='work')!;
  assert(canAccessFloor(site,work.floor,{role:'traveler',identities:['traveler']}));
  assert(sim.isAtBuildingFunctionPoint(site,work.position,'work',{role:'traveler',identities:['traveler']}));
  const room=buildingWorldPosition(site,{x:-17,y:0,z:-10});assert(sim.isNearBuilding(site,room,0));assert.equal(sim.isAtBuildingFunctionPoint(site,room,'work'),false);
  sim.setFocus(room,'walk');const before=sim.exportSave();assert.equal(sim.command({type:'work',targetId:site.id}).ok,false);assert.equal(sim.exportSave(),before);
  sim.setFocus(work.position,'walk');assert.equal(sim.command({type:'work',targetId:site.id}).ok,false,'a traveller at the work point still lacks the teaching qualification');
  sim.state.player.identities=['traveler','teacher'];
  assert.equal(sim.command({type:'work',targetId:site.id}).ok,true);assert.equal(sim.state.playerLabor!.job!.siteId,site.id);assert.equal(sim.state.playerLabor!.job!.workedMinutes,0,'starting at the real point cannot pay or fabricate work minutes');
  const oldWorld=fixture(false),oldSim=new Simulation(oldWorld),oldMarket=oldWorld.buildings.find(b=>b.kind==='market')!;
  assert.equal(getBuildingFloorPlan(oldMarket,0),null);assert(oldSim.isNearBuilding(oldMarket,{...oldMarket.position,y:.6},0));
});

test('v4 qualified teaching work earns only at its work point and pauses in another real room',()=>{
  const world=fixture(),sim=new Simulation(world),school=world.buildings.find(b=>b.kind==='school')!;
  const work=school.functionPoints!.find(point=>point.floor===0&&point.purpose==='work')!,otherRoom=buildingWorldPosition(school,{x:-17,y:0,z:-10});
  sim.state.player.identities=['traveler','teacher'];sim.setFocus(work.position,'walk');
  const initialMoney=sim.state.player.money;
  assert.equal(sim.command({type:'work',targetId:school.id}).ok,true);
  for(let tick=0;tick<12;tick++)sim.step(.25);
  const job=sim.state.playerLabor!.job!;
  assert(job.workedMinutes>0&&job.paidNet>0&&sim.state.player.money>initialMoney,'ordinary clock ticks at the actual work point must earn real wages');
  const earned={minutes:job.workedMinutes,net:job.paidNet,tax:job.paidTax,escrow:job.escrow,money:sim.state.player.money};
  sim.setFocus(otherRoom,'walk');assert(sim.isNearBuilding(school,otherRoom,0),'the comparison position is a legal room in the same building');
  assert.equal(sim.isAtBuildingFunctionPoint(school,otherRoom,'work'),false);
  for(let tick=0;tick<12;tick++)sim.step(.25);
  assert.equal(job.status,'paused');assert.match(job.pauseReason,/暂停/);
  assert.deepEqual({minutes:job.workedMinutes,net:job.paidNet,tax:job.paidTax,escrow:job.escrow,money:sim.state.player.money},earned,'being elsewhere in the same legal room footprint must not earn time or wages');
  sim.setFocus(work.position,'walk');for(let tick=0;tick<12;tick++)sim.step(.25);
  assert.equal(job.status,'working');assert(job.workedMinutes>earned.minutes&&job.paidNet>earned.net&&job.escrow<earned.escrow);
  assert(Math.abs(job.paidNet+job.paidTax+job.escrow-job.gross)<1e-7,'resuming preserves actual wage custody and taxes');
});

test('v4 upper work points preserve floor permissions even for a qualified teacher',()=>{
  const world=fixture(),school=world.buildings.find(b=>b.kind==='school')!;
  school.publicFloors=1;school.floorPermissions=['public','mayor','mayor'];
  school.functionPoints=Array.from({length:school.floors},(_,floor)=>getBuildingUsePoints(school,floor)).flat();
  const upper=school.functionPoints.find(point=>point.floor===1&&point.purpose==='work')!,sim=new Simulation(world);
  sim.state.player.identities=['traveler','teacher'];sim.setFocus(upper.position,'walk');
  assert(sim.isNearBuilding(school,upper.position,0),'the restricted point occupies an actual supported room');
  assert.equal(sim.isAtBuildingFunctionPoint(school,upper.position,'work'),false);
  const before=sim.exportSave();assert.equal(sim.command({type:'work',targetId:school.id}).ok,false);assert.equal(sim.exportSave(),before,'a real point cannot bypass its floor permission or reserve wages');
  sim.state.player.identities.push('mayor');
  assert(sim.isAtBuildingFunctionPoint(school,upper.position,'work'));
  assert.equal(sim.command({type:'work',targetId:school.id}).ok,true,'the same physical point works only after the controlled fixture has its actual floor permission');
});

test('v4 an urgent need in the same building reroutes a real stair-bound citizen to the correct ground service point',()=>{
  const world=fixture(),sim=new Simulation(world),market=world.buildings.find(b=>b.kind==='market')!,stairs=getFloorPlanStairRoute(market,0,1)!;
  const origin=[...stairs].reverse().find(point=>point.y>3&&point.y<4.4&&floorPlanSupport(market,0,point)?.link)!;
  const citizen=sim.state.citizens[0],oldTarget=market.functionPoints!.find(point=>point.floor===1&&point.purpose==='work')!;
  // A controlled lawful mid-route fixture isolates a needs change; its body
  // starts on a real tread and the next position comes only from normal ticks.
  citizen.position={...origin};citizen.workId=market.id;citizen.destinationId=market.id;citizen.state='moving';citizen.money=200;
  citizen.route=[{...origin},...stairs.filter(point=>point.y>origin.y),{...oldTarget.position}];citizen.routeIndex=1;
  citizen.needs={hunger:15,fatigue:100,social:100,fun:100};
  Reflect.get(sim,'runtime').activities[citizen.id]='work';Reflect.get(sim,'runtime').decisionAt[citizen.id]=0;
  sim.setFocus(origin,'walk');const wallet=citizen.money;sim.step(.25);
  assert.equal(citizen.destinationId,market.id);assert.equal(citizen.state,'moving');assert.deepEqual(citizen.route![0],origin);
  assert(market.functionPoints!.some(point=>point.floor===0&&point.purpose==='sale'&&distance(point.position,citizen.route!.at(-1)!)<1e-8),'changing purpose within the same building must change its physical endpoint');
  assert(distance(origin,citizen.position)<=1.05+1e-7);assert(citizen.position.y<origin.y,'the real person must walk down the stair flight rather than continue toward the old upper workplace');
  assert.equal(citizen.money,wallet,'the changed intention cannot buy food before actual arrival');assertClear(market,citizen.route!);
});
