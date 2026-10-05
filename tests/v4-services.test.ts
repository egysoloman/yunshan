import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessFloor } from '../src/access';
import { buildingLocalPosition, buildingWorldPosition, canStandInFloorPlan, floorPlanSupport, getBuildingFloorPlan } from '../src/architecture-floor-plan';
import { Simulation } from '../src/simulation';
import { bankingBalanceSheet } from '../src/simulation/banking';
import { publicFloor } from '../src/simulation/culture';
import { createWorld } from '../src/world';
import type { Building, BuildingFunctionPoint, Vec3 } from '../src/types';

const BODY='沿着真实街道记录山城读者的日常生活、山水与邻里共同经历，这些文字需要真实现场时间完成。';
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const world=createWorld(20261001,'current-v4');

/** Real generated geometry is used without changing the world. Positioning is
 * a controlled CPU fixture, not a claim that a normal player walked here. */
function facility(kind:Building['kind'],purpose:BuildingFunctionPoint['purpose']):{site:Building;point:BuildingFunctionPoint;farRoom:Vec3} {
  const visitor={role:'traveler' as const,identities:['traveler' as const]};
  for(const site of world.buildings.filter(building=>building.kind===kind&&building.floorPlanProfile==='v4-program-bodies-02')){
    const plan=getBuildingFloorPlan(site,0)!;
    if(!publicFloor(site,0)||!canAccessFloor(site,0,visitor))continue;
    const point=site.functionPoints!.find(item=>item.floor===0&&item.purpose===purpose);
    if(!point)continue;const local=buildingLocalPosition(site,point.position);
    if(!canStandInFloorPlan(plan,local.x,local.z,.35))continue;
    for(const room of plan.interior)for(let z=room.z0+.6;z<room.z1-.6;z+=1.2)for(let x=room.x0+.6;x<room.x1-.6;x+=1.2){
      if(!canStandInFloorPlan(plan,x,z,.35))continue;
      const position=buildingWorldPosition(site,{x,y:plan.y,z}),support=floorPlanSupport(site,0,position);
      if(support?.kind==='room'&&Math.abs(support.y-position.y)<1e-8&&site.functionPoints!.every(item=>distance(item.position,position)>2.1))return {site,point,farRoom:position};
    }
  }
  assert.fail(`a generated public ${kind} must have a supported real room away from all actual function points`);
}
function create():Simulation {
  const simulation=new Simulation(world);
  assert.deepEqual(simulation.state.player.identities,['traveler']);assert.equal(simulation.state.player.money,600);
  assert.equal(simulation.state.hour,8);assert.equal(simulation.state.speed,1);
  assert.equal(simulation.state.player.needs.hunger,85);assert.equal(simulation.state.player.needs.fatigue,90);
  return simulation;
}

test('generated v4 bank rejects another real room atomically and its actual service point transfers a 20文 deposit',()=>{
  const {site,point,farRoom}=facility('bank','service'),simulation=create(),state=simulation.state,bank=state.banking!;
  simulation.setFocus(farRoom,'walk');assert(simulation.isNearBuilding(site,farRoom,0));
  const rejected=simulation.exportSave(),denied=simulation.command({type:'deposit',targetId:site.id,value:20});
  assert.equal(denied.ok,false,denied.message);assert.equal(simulation.exportSave(),rejected,'being in the same real bank room must not reserve money or create claims');
  simulation.setFocus(point.position,'walk');
  const before={wallet:state.player.money,cash:bank.cash,deposits:bank.accounts.player.deposits,treasury:state.treasury,ledger:state.extension!.publicLedger.length,receipts:bank.receipts.length};
  assert.equal(before.cash,0,'a new bank has no grant');
  const result=simulation.command({type:'deposit',targetId:site.id,value:20});assert.equal(result.ok,true,result.message);
  assert.equal(state.player.money,before.wallet-20);assert.equal(bank.cash,before.cash+20);assert.equal(bank.accounts.player.deposits,before.deposits+20);assert.equal(state.bankBalance,20);
  assert.equal(state.player.money+bank.cash,before.wallet+before.cash,'deposit claims must not be counted as additional physical cash');
  assert.equal(state.treasury,before.treasury);assert.equal(state.extension!.publicLedger.length,before.ledger);assert.equal(bank.receipts.length,before.receipts+1);
  const receipt=bank.receipts.at(-1)!;assert.equal(receipt.actorId,'player');assert.equal(receipt.kind,'deposit');assert.equal(receipt.amount,20);assert.equal(receipt.cashBefore,before.cash);assert.equal(receipt.cashAfter,bank.cash);
  const balance=bankingBalanceSheet(bank);assert.equal(balance.assets,20);assert.equal(balance.liabilities,20);assert.equal(balance.equity,0);
});

test('generated v4 school charges real creation fees only at its point and ordinary clock work pauses in another supported room',()=>{
  const {site,point,farRoom}=facility('school','work'),simulation=create(),state=simulation.state,culture=state.culture!;
  const command={type:'createWork' as const,targetId:'literature',title:'山城真实日常',text:BODY};
  simulation.setFocus(farRoom,'walk');assert(simulation.isNearBuilding(site,farRoom,0));
  const rejected=simulation.exportSave(),denied=simulation.command(command);assert.equal(denied.ok,false,denied.message);assert.equal(simulation.exportSave(),rejected,'another legal school room must not pay fees or create a project');
  simulation.setFocus(point.position,'walk');
  const before={wallet:state.player.money,treasury:state.treasury,ledger:state.extension!.publicLedger.length,bankCash:state.banking!.cash};
  const result=simulation.command(command);assert.equal(result.ok,true,result.message);
  assert.equal(state.player.money,before.wallet-60);assert.equal(state.treasury,before.treasury+60);assert.equal(state.player.money+state.treasury,before.wallet+before.treasury);assert.equal(state.banking!.cash,before.bankCash);
  assert.equal(state.extension!.publicLedger.length,before.ledger+1);
  const payment=state.extension!.publicLedger.at(-1)!;assert.equal(payment.actorId,'player');assert.equal(payment.amount,60);assert.equal(payment.account,'public');assert.equal(payment.districtId,site.districtId);assert.match(payment.purpose,/创作/);
  const project=culture.project!;assert.equal(project.siteId,site.id);assert.equal(project.paid,60);assert.equal(project.workedMinutes,0);assert.equal(project.requiredMinutes,120);
  const start=state.extension!.lastUpdate;
  for(let tick=0;tick<4;tick++)simulation.step(.25);
  assert.equal(state.extension!.lastUpdate-start,1);assert.equal(project.workedMinutes,1,'the original 1× clock must credit exactly its actual on-site minute');assert.equal(culture.works.length,0);
  simulation.setFocus(farRoom,'walk');const earned=project.workedMinutes,wallet=state.player.money;
  for(let tick=0;tick<4;tick++)simulation.step(.25);
  assert.equal(project.workedMinutes,earned,'being in another legitimate school room must pause creation');assert.equal(state.player.money,wallet);assert.equal(culture.works.length,0);
  simulation.setFocus(point.position,'walk');for(let tick=0;tick<4;tick++)simulation.step(.25);
  assert.equal(project.workedMinutes,earned+1);assert.equal(project.paid,60);assert.equal(state.player.money,before.wallet-60,'returning must not charge another fee');assert.equal(culture.works.length,0,'three elapsed minutes cannot fabricate a 120-minute completed work');
});
