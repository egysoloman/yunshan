import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation';
import { PlayerController } from '../src/controller';
import { canAccessFloor } from '../src/access';
import { foodDistributionController } from '../src/simulation/food-distribution';
import { foodCounterWorld } from '../tests/helpers/food-counter-world';
const out='/tmp/yunshan-food-counter-lifecycle-supported-v1-20261002';mkdirSync(out,{recursive:true});
const world=foodCounterWorld(),rt=(s:Simulation):any=>Reflect.get(s,'runtime');
function cash(sim:Simulation){const s=sim.state;return s.treasury+rt(sim).taxes+s.player.money+(s.banking?.cash??0)+(s.banking?.legacyInvestmentCash??0)+s.citizens.reduce((n,c)=>n+c.money,0)+s.shops.filter(shop=>!s.extension!.companies.some(c=>c.buildingId===shop.buildingId)).reduce((n,s)=>n+(s.cash??0),0)+s.extension!.companies.reduce((n,c)=>n+c.capital,0)+s.extension!.organizations.reduce((n,o)=>n+o.funds,0)+(s.playerLabor?.job?.escrow??0)+(s.clinical?.orders.reduce((n,o)=>n+o.escrow,0)??0)+(s.family?.pregnancies.reduce((n,p)=>n+p.escrow,0)??0)+(s.family?.households.reduce((n,h)=>n+h.balance,0)??0);}
function food(sim:Simulation){return sim.state.shops.filter(s=>sim.shopCommodity(s)==='food').reduce((n,s)=>n+s.inventory,0)+sim.state.vehicles.reduce((n,v)=>n+v.cargo,0)+Object.values(rt(sim).freight as Record<string,number>).reduce((n,q)=>n+q,0)+sim.state.citizens.reduce((n,c)=>n+(c.food??0),0)+(sim.state.player.inventory.food??0)+sim.state.foodDistribution!.counters.reduce((n,c)=>n+c.stocks.reduce((n,s)=>n+s.remaining,0),0);}
test('paid v1 actual native walk, purchase and gifts support natural day1 commute, lawful review and original-worker FIFO return',()=>{
 const keyboard=Object.assign(new EventTarget(),{closest:()=>null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
 const ow=Object.getOwnPropertyDescriptor(globalThis,'window'),od=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'window',{value:keyboard,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
 const sim=new Simulation(world),fixture=readFileSync(new URL('../tests/fixtures/food-counter-paid-v1.json',import.meta.url),'utf8'),loaded=sim.importSave(fixture);assert.equal(loaded.ok,true,loaded.message);
 const api=foodDistributionController(sim),c=sim.state.foodDistribution!.counters[0],worker=c.tasks[0].citizenId,ids=[worker,...c.approvedBy],initial={cash:cash(sim),food:food(sim),wallet:sim.state.player.money,source:structuredClone(c.stocks[0]),jobs:sim.state.citizens.map(p=>[p.id,p.role,p.workId]),legacyEarned:c.tasks[0].earned,legacyMinutes:c.tasks[0].workedMinutes},trace:any[]=[],actions:any[]=[],payments:any[]=[];
 const controller=new PlayerController(new PerspectiveCamera(),new EventTarget() as HTMLCanvasElement,world,()=>{},(b,f)=>canAccessFloor(b,f,sim.state.player),()=>sim.state.voxels);controller.setMode('walk',sim.state.player.position);
 const observe=(label:string)=>trace.push({label,time:sim.state.extension!.lastUpdate,hour:sim.state.hour,player:{position:controller.walkingPosition,money:sim.state.player.money,food:sim.state.player.inventory.food??0},actors:ids.map(id=>{const p=sim.state.citizens.find(p=>p.id===id)!;return{id,position:{...p.position},state:p.state,activity:rt(sim).activities[id],needs:{...p.needs},onDuty:sim.isOnDuty(id,p.workId),money:p.money,attendance:rt(sim).attendance[id]??0}}),tasks:structuredClone(c.tasks),publicLabor:structuredClone(rt(sim).publicLabor??null)});
 const execute=(command:any)=>{const before={money:sim.state.player.money,food:food(sim),bag:sim.state.player.inventory.food??0,stock:sim.state.shops.find(s=>s.id==='shop-farm')?.inventory},result=sim.command(command);actions.push({time:sim.state.extension!.lastUpdate,command,before,after:{money:sim.state.player.money,food:food(sim),bag:sim.state.player.inventory.food??0,stock:sim.state.shops.find(s=>s.buildingId==='farm')?.inventory},result});assert.equal(result.ok,true,result.message);};
 const key=(type:string,code:string)=>{const e=new Event(type);Object.assign(e,{code,repeat:false});keyboard.dispatchEvent(e)};
 const walk=(x:number,z:number)=>{key('keydown','KeyW');let count=0;while(Math.hypot(controller.position.x-x,controller.position.z-z)>.6&&count++<1500){const p=controller.position;controller.yaw=Math.atan2(-(x-p.x),-(z-p.z));controller.step(.1,false);sim.setFocus(controller.walkingPosition,'walk');sim.step(.1);if(count%100===0)observe('actual walking');}key('keyup','KeyW');assert.ok(Math.hypot(controller.position.x-x,controller.position.z-z)<=.6,`native route blocked to ${x},${z}: ${JSON.stringify(controller.position)}`);observe('actual route endpoint');};
 let successfulReview=false,successfulAccept=false,exact=false;
 try{
  sim.onEvent('wage-paid',e=>payments.push({...e,time:sim.state.extension!.lastUpdate}));observe('genuine imported start');execute({type:'speed',value:1});
  walk(600,7);walk(0,7);execute({type:'purchase',targetId:'farm',value:4});walk(600,7);
  execute({type:'speed',value:16});while(sim.state.extension!.lastUpdate<1380)sim.step(.25);observe('natural23 original home arrivals');
  for(const id of ids)execute({type:'gift',targetId:id});observe('three actual gifts');
  const firstFood=food(sim);assert.ok(Math.abs(firstFood-(initial.food-4))<1e-7,'one player meal and three gifts consume exactly four pre-existing units');assert.equal(sim.state.player.money,initial.wallet-32);
  const stock=JSON.stringify(c.stocks),legacyEarned=c.tasks[0].earned,legacyMinutes=c.tasks[0].workedMinutes;
  while(sim.state.extension!.lastUpdate<2100&&!(successfulAccept&&successfulReview)){
   sim.step(.25);if(sim.state.extension!.lastUpdate%60===0)observe('natural morning');
   if(sim.state.hour>=8&&sim.state.hour<17){if(!successfulReview&&c.approvedBy.every(id=>sim.isOnDuty(id,'hall'))){const result=api.planNextDay(c.id,[...c.approvedBy]);actions.push({time:sim.state.extension!.lastUpdate,type:'lawful planNextDay',result});successfulReview=result.ok;}
    if(!successfulAccept&&sim.isOnDuty(worker,c.siteId)){const result=api.accept(c.id,worker);actions.push({time:sim.state.extension!.lastUpdate,type:'original worker continuation',result});successfulAccept=result.ok;}
   }
  }
  observe('review/continuation result');assert.ok(successfulReview,'original two officials naturally meet funded on-duty and needs authority');assert.ok(successfulAccept,'original worker naturally reaches original job with true day1 allowance');
  const nextPlan=rt(sim).publicLabor.shifts.find((s:any)=>s.day===2);assert.ok(nextPlan);assert.deepEqual(nextPlan.approvedBy,c.approvedBy);assert.equal(c.tasks.at(-1)!.contract.id,'standing-day-1','v1 had no day1 formal plan; day1 existing standing authority and actual review funds day2');assert.equal(c.tasks.at(-1)!.continuationOf,c.tasks[0].id);assert.equal(c.tasks[0].earned,legacyEarned);assert.equal(c.tasks[0].workedMinutes,legacyMinutes);assert.equal(JSON.stringify(c.stocks),stock);
  assert.equal(api.close(c.id).ok,true);for(let i=0;i<120&&c.state!=='closed';i++)sim.step(.25);assert.equal(c.state,'closed','actual same worker returns original FIFO food along source road');
  const original=rt(sim).freightLots.customers.find((l:any)=>l.id===initial.source.sourceLotId);assert.ok(original);assert.equal(original.quantity,initial.source.origin.receivedQuantity);assert.equal(c.stocks[0].returned,8);assert.equal(c.stocks[0].remaining,0);observe('actual food returned');
  const save=sim.exportSave(),clone=new Simulation(world),restore=clone.importSave(save);assert.equal(restore.ok,true,restore.message);assert.equal(clone.exportSave(),save);writeFileSync(`${out}/returned-save.json`,save);for(let i=0;i<24;i++){sim.step(.25);clone.step(.25);}exact=clone.exportSave()===sim.exportSave();assert.ok(exact);writeFileSync(`${out}/returned-plus24-save.json`,sim.exportSave());
  assert.deepEqual(sim.state.citizens.map(p=>[p.id,p.role,p.workId]),initial.jobs);assert.ok(Math.abs(cash(sim)-initial.cash)<1e-7);assert.ok(Math.abs(food(sim)-(initial.food-4))<1e-7);assert.equal(c.materialConsumed,1);
 }finally{
  writeFileSync(`${out}/proof.json`,JSON.stringify({scope:'headless CPU PlayerController actual KeyW path and real purchase/gift; no setTime/teleport/new cash/stock/role/needs/payroll injections; genuine fixture timers kept; player intervention, not autonomous recovery',fixtureSha256:createHash('sha256').update(fixture).digest('hex'),initial,trace,actions,payments,successfulReview,successfulAccept,fullSaveClone24Exact:exact,finalCash:cash(sim),cashResidual:cash(sim)-initial.cash,foodResidualAfterFourRealConsumptions:food(sim)-initial.food+4,finalCounter:structuredClone(c)},null,2)+'\n');
  controller.dispose();if(ow)Object.defineProperty(globalThis,'window',ow);else Reflect.deleteProperty(globalThis,'window');if(od)Object.defineProperty(globalThis,'document',od);else Reflect.deleteProperty(globalThis,'document');
 }
});
