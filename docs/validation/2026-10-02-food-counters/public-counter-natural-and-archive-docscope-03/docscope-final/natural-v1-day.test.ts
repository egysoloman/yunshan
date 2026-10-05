import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation';
import { foodDistributionController } from '../src/simulation/food-distribution';
import { foodCounterWorld } from '../tests/helpers/food-counter-world';
const out='/tmp/yunshan-food-counter-lifecycle-natural-v1-20261002';
mkdirSync(out,{recursive:true});
const world=foodCounterWorld();
const rt=(sim:Simulation):any=>Reflect.get(sim,'runtime');
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function cash(sim:Simulation){const s=sim.state;return s.treasury+rt(sim).taxes+s.player.money+(s.banking?.cash??0)+(s.banking?.legacyInvestmentCash??0)+s.citizens.reduce((n,c)=>n+c.money,0)+s.shops.filter(shop=>!s.extension!.companies.some(c=>c.buildingId===shop.buildingId)).reduce((n,s)=>n+(s.cash??0),0)+s.extension!.companies.reduce((n,c)=>n+c.capital,0)+s.extension!.organizations.reduce((n,o)=>n+o.funds,0)+(s.playerLabor?.job?.escrow??0)+(s.clinical?.orders.reduce((n,o)=>n+o.escrow,0)??0)+(s.family?.pregnancies.reduce((n,p)=>n+p.escrow,0)??0)+(s.family?.households.reduce((n,h)=>n+h.balance,0)??0);}
function food(sim:Simulation){return sim.state.shops.filter(s=>sim.shopCommodity(s)==='food').reduce((n,s)=>n+s.inventory,0)+sim.state.vehicles.reduce((n,v)=>n+v.cargo,0)+Object.values(rt(sim).freight as Record<string,number>).reduce((n,q)=>n+q,0)+sim.state.citizens.reduce((n,c)=>n+(c.food??0),0)+(sim.state.player.inventory.food??0)+sim.state.foodDistribution!.counters.reduce((n,c)=>n+c.stocks.reduce((n,s)=>n+s.remaining,0),0);}
test('genuine paid v1 migrates and naturally commutes to a legally approved next-day counter continuation',()=>{
 const old=readFileSync(new URL('../tests/fixtures/food-counter-paid-v1.json',import.meta.url),'utf8'),sim=new Simulation(world),load=sim.importSave(old);
 assert.equal(load.ok,true,load.message);const api=foodDistributionController(sim),c=sim.state.foodDistribution!.counters[0],workerId=c.tasks[0].citizenId,officials=[...c.approvedBy];
 const baseline={cash:cash(sim),food:food(sim),jobs:sim.state.citizens.map(p=>[p.id,p.role,p.workId]),legacy:JSON.stringify(c.tasks[0]),stock:JSON.stringify(c.stocks)},rows:any[]=[],requests:any[]=[],events:any[]=[];
 sim.onEvent('wage-earned',e=>events.push({...e,time:sim.state.extension!.lastUpdate}));sim.onEvent('wage-paid',e=>events.push({...e,time:sim.state.extension!.lastUpdate}));
 const observe=()=>({time:sim.state.extension!.lastUpdate,day:sim.state.day,hour:sim.state.hour,epoch:sim.state.foodDistribution!.payroll.epoch,treasury:sim.state.treasury,actors:[workerId,...officials].map(id=>{const p=sim.state.citizens.find(c=>c.id===id)!;return{id,role:p.role,workId:p.workId,position:{...p.position},state:p.state,destination:p.destinationId,route:[...(p.route??[])],routeIndex:p.routeIndex,activity:rt(sim).activities[id],decisionAt:rt(sim).decisionAt[id],attendance:rt(sim).attendance[id]??0,needs:{...p.needs},food:p.food??0,money:p.money,life:structuredClone(sim.state.extension!.actorProfiles[id]),onDuty:sim.isOnDuty(id,p.workId)}}),counter:structuredClone(c),publicLabor:structuredClone(rt(sim).publicLabor??null)});
 rows.push(observe());writeFileSync(`${out}/migrated-start-save.json`,sim.exportSave());
 let lastHour=-1,successfulPlan=false,successfulAccept=false;
 while(sim.state.extension!.lastUpdate<2040){sim.step(.25);const hour=Math.floor(sim.state.extension!.lastUpdate/60);if(hour!==lastHour){rows.push(observe());lastHour=hour;}
  if(Math.floor(sim.state.extension!.lastUpdate/1440)>=1&&sim.state.hour>=8&&sim.state.hour<17){
   if(!successfulPlan){const result=api.planNextDay(c.id,officials);requests.push({type:'planNextDay',time:sim.state.extension!.lastUpdate,result});successfulPlan=result.ok;}
   if(!successfulAccept){const result=api.accept(c.id,workerId);requests.push({type:'accept',time:sim.state.extension!.lastUpdate,result});successfulAccept=result.ok;}
  }
 }
 const save=sim.exportSave(),clone=new Simulation(world),restored=clone.importSave(save);assert.equal(restored.ok,true,restored.message);assert.equal(clone.exportSave(),save);writeFileSync(`${out}/natural-day1-save.json`,save);
 for(let i=0;i<24;i++){sim.step(.25);clone.step(.25);}const exact=clone.exportSave()===sim.exportSave();writeFileSync(`${out}/natural-day1-plus24-save.json`,sim.exportSave());
 const proof={scope:'genuine old v1 fixture; natural .step(.25), no setTime, wallet/needs/roles/jobs/positions/deadlines assignments; original fixture timer freezes preserved',fixtureSha256:hash(old),baseline,final:{cash:cash(sim),food:food(sim),jobs:sim.state.citizens.map(p=>[p.id,p.role,p.workId])},cashResidual:cash(sim)-baseline.cash,foodResidual:food(sim)-baseline.food,originalTaskUnchanged:JSON.stringify(c.tasks[0])===baseline.legacy,fullImportExportExact:true,clone24TicksExact:exact,successfulPlan,successfulAccept,rows,requests,events};writeFileSync(`${out}/natural-day1-proof.json`,JSON.stringify(proof,null,2)+'\n');
 assert.ok(Math.abs(proof.cashResidual)<1e-7);assert.ok(Math.abs(proof.foodResidual)<1e-7);assert.deepEqual(proof.final.jobs,baseline.jobs);assert.ok(exact);assert.ok(successfulPlan,'two original officials must naturally reach lawful same-site review with actual needs and funded attendance');assert.ok(successfulAccept,'original paid worker must naturally reach a funded healthy counter continuation');
});
