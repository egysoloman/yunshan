import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessFloor } from '../src/access';
import { buildingLocalPosition, buildingWorldPosition, canStandInFloorPlan, floorPlanSupport, getBuildingFloorPlan } from '../src/architecture-floor-plan';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { applyShopLifecycleCommand } from '../src/simulation/shop_lifecycle';
import { completePaidCourse } from './education-fixture';
import type { Building, BuildingFunctionPoint, Command, Company, Role, Vec3 } from '../src/types';

const world=createWorld(20261001,'current-v4');
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const close=(a:number,b:number)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
/** Actual generated buildings; position selection is a controlled CPU fixture,
 * not a normal player journey. No trusted geometry, stock or clock is changed. */
function places(sim:Simulation,kind:Building['kind'],purpose:BuildingFunctionPoint['purpose'],predicate:(b:Building)=>boolean=()=>true){
  for(const site of world.buildings.filter(b=>b.kind===kind&&b.floorPlanProfile==='v4-program-bodies-02'&&predicate(b))){
    const plan=getBuildingFloorPlan(site,0)!;
    if(!canAccessFloor(site,0,sim.state.player))continue;
    const point=site.functionPoints!.find(p=>p.floor===0&&p.purpose===purpose&&sim.isAtBuildingFunctionPoint(site,p.position,purpose));
    if(!point)continue;
    const local=buildingLocalPosition(site,point.position);if(!canStandInFloorPlan(plan,local.x,local.z,.35))continue;
    let farRoom:Vec3|null=null,court:Vec3|null=null;
    for(const room of plan.interior)for(let z=room.z0+.6;z<room.z1-.6&&!farRoom;z+=1.2)for(let x=room.x0+.6;x<room.x1-.6&&!farRoom;x+=1.2){
      if(!canStandInFloorPlan(plan,x,z,.35))continue;
      const position=buildingWorldPosition(site,{x,y:plan.y,z}),support=floorPlanSupport(site,0,position);
      if(support?.kind==='room'&&site.functionPoints!.every(p=>distance(p.position,position)>2.1))farRoom=position;
    }
    for(const courtyard of plan.courtyard){
      const position=buildingWorldPosition(site,{x:(courtyard.x0+courtyard.x1)/2,y:plan.y,z:(courtyard.z0+courtyard.z1)/2});
      if(floorPlanSupport(site,0,position)?.kind==='courtyard')court=position;
    }
    if(farRoom)return {site,point,farRoom,court};
  }
  assert.fail(`generated ${kind} must have a true ${purpose} point and another legal room`);
}
function fresh(){const sim=new Simulation(world);assert.equal(sim.state.player.money,600);assert.deepEqual(sim.state.player.identities,['traveler']);assert.equal(sim.state.hour,8);return sim;}
function at(sim:Simulation,p:Vec3){sim.setFocus({...p},'walk');}
function ok(sim:Simulation,c:Command){const result=sim.command(c);assert.equal(result.ok,true,`${c.type}: ${result.message}`);}
function denied(sim:Simulation,c:Command){const before=sim.exportSave();const result=sim.command(c);assert.equal(result.ok,false,`${c.type} must deny another place: ${result.message}`);assert.equal(sim.exportSave(),before,'denial must preserve every state/runtime field');}
function qualify(sim:Simulation,role:'merchant'|'scientist'){
  const school=places(sim,'school','work');at(sim,school.point.position);
  for(let n=0;n<(role==='scientist'?3:1);n++)completePaidCourse(sim,school.site);
  const venue=role==='merchant'?places(sim,'market','work'):school;at(sim,venue.point.position);ok(sim,{type:'exam',targetId:role});
  assert(sim.state.player.identities!.includes(role));assert.equal(sim.state.player.money,role==='merchant'?480:400);
}
function physicalCash(sim:Simulation){return sim.state.player.money+sim.state.citizens.reduce((n,c)=>n+c.money,0)+sim.state.shops.reduce((n,s)=>n+sim.shopFunds(s),0)+sim.state.treasury+Reflect.get(sim,'runtime').taxes+sim.state.banking!.cash;}
/** A financial fixture uses an explicit equal debit/credit from existing adult
 * residents to fund several independent transactions. It is not NPC research
 * setup or a claim that ordinary play offers this transfer. */
function fundedMerchant(){const sim=fresh();qualify(sim,'merchant');const before=physicalCash(sim);let remaining=2000;
  for(const c of sim.state.citizens){const amount=Math.min(remaining,Math.max(0,c.money-100));c.money-=amount;sim.state.player.money+=amount;remaining-=amount;if(!remaining)break;}
  assert.equal(remaining,0);close(physicalCash(sim),before);return sim;
}
/** One initial seller presence fixture, followed by actual authorized sale,
 * real 200 operating contribution and 50 fee. No ownership/cash/stock is written.
 * The unfunded founding case borrows only from real existing bank deposits. */
function acquireMarket(sim:Simulation,location:ReturnType<typeof places>){
  at(sim,location.point.position);denied(sim,{type:'foundCompany',targetId:location.site.id,value:300});
  if(sim.state.player.money<601){const bank=places(sim,'bank','service');at(sim,bank.point.position);const before=physicalCash(sim);ok(sim,{type:'loan',targetId:bank.site.id,value:Math.ceil(601-sim.state.player.money)});close(physicalCash(sim),before);}
  const shop=sim.state.shops.find(s=>s.buildingId===location.site.id)!,sellerId=shop.ownerId!,seller=sim.state.citizens.find(c=>c.id===sellerId)!;
  seller.position={...location.point.position}; // controlled one-time original seller, no role/needs/skill edit
  const before=physicalCash(sim),sellerCash=seller.money,wallet=sim.state.player.money,shopCash=sim.shopFunds(shop),treasury=sim.state.treasury;
  const stopped=applyShopLifecycleCommand(sim,{type:'suspendShop',targetId:shop.id},sellerId)!;assert(stopped.ok,stopped.message);
  const listed=applyShopLifecycleCommand(sim,{type:'listShopForSale',targetId:shop.id,value:1},sellerId)!;assert(listed.ok,listed.message);
  at(sim,location.point.position);ok(sim,{type:'buyShop',targetId:sim.state.shopLifecycle!.listings.at(-1)!.id,value:200});
  assert.equal(seller.money,sellerCash+1);assert.equal(sim.state.player.money,wallet-251);assert.equal(sim.shopFunds(shop),shopCash+200);assert.equal(sim.state.treasury,treasury+50);assert.equal(shop.ownerId,'player');close(physicalCash(sim),before);
}
function companyAt(sim:Simulation){const location=places(sim,'market','work',b=>!sim.state.extension!.companies.some(c=>c.buildingId===b.id));acquireMarket(sim,location);at(sim,location.point.position);const before=physicalCash(sim),wallet=sim.state.player.money,treasury=sim.state.treasury;ok(sim,{type:'foundCompany',targetId:location.site.id,value:300});const company=sim.state.extension!.companies.find(c=>c.buildingId===location.site.id)!;
  assert.equal(sim.state.player.money,wallet-350);assert.equal(sim.state.treasury,treasury+50);assert.equal(company.shareholders.player,1000);assert.equal(company.shares,1000);close(physicalCash(sim),before);return {...location,company};
}

test('v4 founding denies a supported far room and its exterior entrance before spending qualified personal cash',()=>{
  const sim=fresh();qualify(sim,'merchant');const p=places(sim,'market','work',b=>!sim.state.extension!.companies.some(c=>c.buildingId===b.id));
  at(sim,p.farRoom);assert(sim.isNearBuilding(p.site,p.farRoom,0));assert(!sim.isAtBuildingFunctionPoint(p.site,p.farRoom,'work'));denied(sim,{type:'foundCompany',targetId:p.site.id,value:300});
  at(sim,p.site.door);assert(sim.isNearBuilding(p.site));assert(!sim.isAtBuildingFunctionPoint(p.site,p.site.door,'work'));denied(sim,{type:'foundCompany',targetId:p.site.id,value:300});
  if(p.court){at(sim,p.court);assert.equal(floorPlanSupport(p.site,0,p.court)!.kind,'courtyard');denied(sim,{type:'foundCompany',targetId:p.site.id,value:300});}
  acquireMarket(sim,p);at(sim,p.point.position);const before=physicalCash(sim),wallet=sim.state.player.money,treasury=sim.state.treasury;ok(sim,{type:'foundCompany',targetId:p.site.id,value:300});assert.equal(sim.state.player.money,wallet-350);assert.equal(sim.state.treasury,treasury+50);close(physicalCash(sim),before);
});

test('v4 expansion and hiring use the real company work point without free materials, payroll or completion',()=>{
  const sim=fundedMerchant(),p=companyAt(sim);
  at(sim,p.farRoom);denied(sim,{type:'expandCompany',targetId:p.company.id,value:100});denied(sim,{type:'hire',targetId:p.company.id,value:1});
  at(sim,p.point.position);const before=physicalCash(sim),wallet=sim.state.player.money,level=p.company.level;ok(sim,{type:'expandCompany',targetId:p.company.id,value:100});assert.equal(sim.state.player.money,wallet-100);assert.equal(p.company.level,level);close(physicalCash(sim),before);
  const job=Reflect.get(sim.state.extension!,'runtime').constructionJobs[p.company.id];assert.equal(job.requiredMinutes,60);assert.equal(job.workedMinutes,0);assert.equal(job.consumedUnits,0);assert.equal(job.completedAt,null);assert(job.materialCost>0&&job.materialUnits>0);
  const hires=sim.state.citizens.filter(c=>c.workId!==p.site.id&&['工人','农民','搬运工','merchant','商人','居民'].includes(c.role)&&sim.state.extension!.actorProfiles[c.id].alive&&sim.buildingTravelDistance(c.homeId,p.site.id)<=500);
  assert(hires.length>0,'a genuine reachable existing resident must be available');
  const money=sim.state.player.money,capital=p.company.capital,treasury=sim.state.treasury,employees=p.company.employees,cash=physicalCash(sim);ok(sim,{type:'hire',targetId:p.company.id,value:1});assert.equal(sim.state.player.money,money);assert.equal(p.company.capital,capital-50);assert.equal(sim.state.treasury,treasury+50);assert.equal(p.company.employees,employees+1);close(physicalCash(sim),cash);
});

test('v4 financial fixture uses a real bank service point for listing and finite issued share exchange',()=>{
  const sim=fundedMerchant(),p=companyAt(sim),bank=places(sim,'bank','service');
  // Financial precondition only: an existing second-level issuer. We do not
  // claim this fixture completed physical building work or accelerate its timer.
  p.company.level=2;const transfer=700,donor=sim.state.citizens.find(c=>c.money>=100+transfer);
  if(donor){donor.money-=transfer;p.company.capital+=transfer;}else{assert(sim.state.player.money>=transfer+300);sim.state.player.money-=transfer;p.company.capital+=transfer;}
  assert(p.company.capital>=600);
  at(sim,bank.farRoom);denied(sim,{type:'listCompany',targetId:p.company.id});
  at(sim,bank.point.position);const cash=physicalCash(sim),wallet=sim.state.player.money,treasury=sim.state.treasury;ok(sim,{type:'listCompany',targetId:p.company.id});assert.equal(sim.state.player.money,wallet-200);assert.equal(sim.state.treasury,treasury+200);assert.equal(p.company.shares,1250);assert.equal(p.company.shareholders.exchange,250);close(physicalCash(sim),cash);
  at(sim,bank.farRoom);denied(sim,{type:'buyShares',targetId:p.company.id,value:10});denied(sim,{type:'sellShares',targetId:p.company.id,value:10});
  at(sim,bank.point.position);const quoted=p.company.sharePrice*10,money=sim.state.player.money,capital=p.company.capital,owned=p.company.shareholders.player,exchange=p.company.shareholders.exchange;
  ok(sim,{type:'buyShares',targetId:p.company.id,value:10});close(sim.state.player.money,money-quoted);close(p.company.capital,capital+quoted);assert.equal(p.company.shareholders.player,owned+10);assert.equal(p.company.shareholders.exchange,exchange-10);close(physicalCash(sim),cash);
  ok(sim,{type:'sellShares',targetId:p.company.id,value:10});close(sim.state.player.money,money);close(p.company.capital,capital);assert.equal(p.company.shareholders.player,owned);assert.equal(p.company.shareholders.exchange,exchange);assert.equal(Object.values(p.company.shareholders).reduce((n,q)=>n+q,0),p.company.shares);close(physicalCash(sim),cash);
});

test('v4 acquisition denies another room and settles actual shareholders at the target work point',()=>{
  const sim=fundedMerchant(),parent=companyAt(sim),target=sim.state.extension!.companies.find(c=>c.ownerId!=='player'&&!c.parentId)!;
  assert(target);const p=places(sim,world.buildings.find(b=>b.id===target.buildingId)!.kind,'work',b=>b.id===target.buildingId);
  at(sim,p.farRoom);denied(sim,{type:'acquireCompany',targetId:target.id});
  at(sim,p.point.position);const cash=physicalCash(sim),wallet=sim.state.player.money,cost=(target.shares-(target.shareholders.player??0))*target.sharePrice*1.2;ok(sim,{type:'acquireCompany',targetId:target.id});close(sim.state.player.money,wallet-cost);assert.equal(target.ownerId,'player');assert.equal(target.parentId,parent.company.id);assert.equal(target.shareholders.player,target.shares);close(physicalCash(sim),cash);
});

test('v4 ingredients deny the far room and doorway, then debit a true sale point and actual supplier stock once',()=>{
  const sim=fresh(),p=places(sim,'market','sale');
  at(sim,p.farRoom);assert(sim.isNearBuilding(p.site));denied(sim,{type:'buyIngredient',targetId:'grain',value:1});
  at(sim,p.site.door);denied(sim,{type:'buyIngredient',targetId:'grain',value:1});
  if(p.court){at(sim,p.court);denied(sim,{type:'buyIngredient',targetId:'grain',value:1});}
  at(sim,p.point.position);const shop=sim.state.shops.find(s=>s.buildingId===p.site.id)!,cash=physicalCash(sim),wallet=sim.state.player.money,stock=shop.inventory,revenue=shop.revenue;ok(sim,{type:'buyIngredient',targetId:'grain',value:1});assert.equal(sim.state.player.money,wallet-8);assert.equal(shop.inventory,stock-1);assert.equal(shop.revenue,revenue+8);assert.equal(sim.state.player.inventory['ingredient:grain'],1);close(physicalCash(sim),cash);
});

test('v4 qualified personal research denies another laboratory room and its door without altering the original 120-minute budget',()=>{
  const sim=fresh();qualify(sim,'scientist');const p=places(sim,'school','work');
  at(sim,p.farRoom);assert(sim.isNearBuilding(p.site));denied(sim,{type:'research',targetId:'medicine',value:200});
  at(sim,p.site.door);denied(sim,{type:'research',targetId:'medicine',value:200});
  at(sim,p.point.position);const before=physicalCash(sim),wallet=sim.state.player.money,treasury=sim.state.treasury;ok(sim,{type:'research',targetId:'medicine',value:200});assert.equal(sim.state.player.money,wallet-200);assert.equal(sim.state.treasury,treasury+200);const job=Reflect.get(sim.state.extension!,'runtime').researchJobs.medicine;assert.equal(job.finishAt-job.startedAt,120);assert.equal(job.budget,200);assert.equal(sim.state.extension!.technologies.find(t=>t.sector==='medicine')!.progress,0);close(physicalCash(sim),before);
});


test('generated v4 open courtyard is outdoors and cannot buy ingredients or open a company',()=>{
  const sim=fresh(),p=places(sim,'market','sale');assert(p.court,'the generated market has a real supported open courtyard');at(sim,p.court);
  assert.equal(floorPlanSupport(p.site,0,p.court)!.kind,'courtyard');assert(!sim.isAtBuildingFunctionPoint(p.site,p.court,'sale'));denied(sim,{type:'buyIngredient',targetId:'grain',value:1});
  // Obtain the merchant identity by actual course/exam charges, then return to
  // the same genuine outdoor court; no identity or cash is injected.
  qualify(sim,'merchant');at(sim,p.court);denied(sim,{type:'foundCompany',targetId:p.site.id,value:300});
});
