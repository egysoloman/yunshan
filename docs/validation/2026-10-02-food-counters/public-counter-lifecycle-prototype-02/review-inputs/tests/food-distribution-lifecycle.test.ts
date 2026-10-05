import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { foodDistributionController, type FoodCounter, type CounterStock } from '../src/simulation/food-distribution';
import { foodCounterWorld } from './helpers/food-counter-world';
const world = foodCounterWorld();
const runtime = (sim: Simulation): any => Reflect.get(sim, 'runtime');
const counter = (sim: Simulation): FoodCounter => sim.state.foodDistribution!.counters[0];
function cash(sim: Simulation) {
 const s = sim.state;
 return s.treasury + runtime(sim).taxes + s.player.money + s.banking!.cash + s.banking!.legacyInvestmentCash + s.citizens.reduce((n,c)=>n+c.money,0)
  + s.shops.filter(shop=>!s.extension!.companies.some(c=>c.buildingId===shop.buildingId)).reduce((n,s)=>n+(s.cash??0),0)
  + s.extension!.companies.reduce((n,c)=>n+c.capital,0)+s.extension!.organizations.reduce((n,o)=>n+o.funds,0)
  +(s.playerLabor?.job?.escrow??0)+(s.clinical?.orders.reduce((n,o)=>n+o.escrow,0)??0)+(s.family?.pregnancies.reduce((n,p)=>n+p.escrow,0)??0)+(s.family?.households.reduce((n,h)=>n+h.balance,0)??0);
}
function setup() {
 const sim=new Simulation(world),r=runtime(sim);sim.command({type:'speed',value:16});
 for(const v of sim.state.vehicles)v.nextDeparture=1e6;
 r.commerceAt=r.financeAt=r.socialAt=r.crimeAt=1e6; // Payroll deliberately keeps the real 17:00 deadline.
 for(const c of sim.state.citizens){c.needs={hunger:100,fatigue:100,social:100,fun:100};r.activities[c.id]='social';r.decisionAt[c.id]=1e6;c.destinationId=c.homeId;c.route=[];c.routeIndex=0;}
 const staff=sim.state.citizens.find(c=>c.workId==='school'&&c.role==='老师')!;
 const relief=sim.state.citizens.find(c=>c.workId==='school'&&c.role==='老师'&&c.id!==staff.id)!;
 const signers=sim.state.citizens.filter(c=>c.workId==='hall'&&c.role==='官员').slice(0,2);
 for(const c of [staff,relief,...signers]){c.position={...world.buildings.find(b=>b.id===c.workId)!.door};c.destinationId=c.workId;c.state='working';r.activities[c.id]='work';}
 const carrier=sim.state.vehicles.find(v=>v.id==='vehicle-food-road-1')!;carrier.progress=.999;carrier.direction=1;carrier.nextDeparture=480;r.signalOverrides['market-door']=1;sim.step(.25);carrier.nextDeparture=1e6;
 const api=foodDistributionController(sim);assert.equal(api.register('school',signers.map(c=>c.id)).ok,true);assert.equal(api.procure(counter(sim).id).ok,true);assert.equal(api.accept(counter(sim).id,staff.id).ok,true);
 return {sim,api,staff,relief,signers};
}
function restore(sim:Simulation){const save=sim.exportSave(),other=new Simulation(world),r=other.importSave(save);assert.equal(r.ok,true,r.message);assert.equal(other.exportSave(),save);return other;}

test('paid original attendance can be saved after setting the visible clock back before 17:00',()=>{
 const {sim,api,staff}=setup(),initialCash=cash(sim);let paid=0;sim.onEvent('wage-paid',e=>{if(e.citizenId===staff.id)paid+=e.amount??0;});
 while(sim.state.hour<17)sim.step(.25);
 assert.ok(paid>0,'actual original 17:00 payroll has paid this worker');assert.equal(runtime(sim).attendance[staff.id],undefined);const gross=counter(sim).tasks[0].earned;
 assert.ok(gross>0);assert.ok(Math.abs(cash(sim)-initialCash)<1e-7);restore(sim); writeFileSync(`artifacts/paid-before-clock-v${sim.state.foodDistribution!.version}-save.json`,sim.exportSave());
 assert.equal(sim.command({type:'setTime',value:10}).ok,true);const before=sim.exportSave(),other=new Simulation(world),loaded=other.importSave(before);
 writeFileSync(`artifacts/payroll-clock-v${sim.state.foodDistribution!.version}-${loaded.ok ? 'fixed' : 'failed'}.json`,JSON.stringify({source:'actual .step to 17:00; no money/attendance/payroll deadline writes',paidGross:paid,taskEarned:gross,attendance:runtime(sim).attendance[staff.id]??null,monotonicTime:sim.state.extension!.lastUpdate,visibleHour:sim.state.hour,importResult:loaded,cashResidual:cash(sim)-initialCash,task:counter(sim).tasks[0]},null,2)+'\n');
 assert.equal(loaded.ok,true,loaded.message);assert.equal(other.exportSave(),before);
 assert.equal(sim.state.foodDistribution!.payroll.dayUsed['0'][staff.id],480);assert.equal(api.accept(counter(sim).id,staff.id).ok,false);assert.equal(api.resume(counter(sim).id).ok,false);
 const earnedBefore=counter(sim).tasks.reduce((n,t)=>n+t.earned,0);for(let i=0;i<24;i++)sim.step(.25);
 assert.equal(counter(sim).tasks.reduce((n,t)=>n+t.earned,0),earnedBefore);assert.equal(sim.state.foodDistribution!.payroll.dayUsed['0'][staff.id],480);restore(sim);
});

function open() { const f=setup();for(let i=0;i<200&&counter(f.sim).tasks.at(-1)!.stage!=='serve';i++)f.sim.step(.25);assert.equal(counter(f.sim).tasks.at(-1)!.stage,'serve');return f; }
function food(sim:Simulation){return sim.state.shops.filter(s=>sim.shopCommodity(s)==='food').reduce((n,s)=>n+s.inventory,0)+sim.state.vehicles.reduce((n,v)=>n+v.cargo,0)+Object.values(runtime(sim).freight as Record<string,number>).reduce((n,q)=>n+q,0)+sim.state.citizens.reduce((n,c)=>n+(c.food??0),0)+(sim.state.player.inventory.food??0)+counter(sim).stocks.reduce((n,s)=>n+s.remaining,0);}
function stockOnShelf(stock:CounterStock){return stock.location==='counter';}
function counterClosed(c:FoodCounter){return c.state==='closed';}
function counts(sim:Simulation){return {cash:cash(sim),food:food(sim),jobs:sim.state.citizens.map(c=>[c.id,c.workId,c.role]),material:counter(sim).materialConsumed};}
function stable(a:number,b:number,label:string){assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} vs ${b}`);}
function stepped(sim:Simulation,n=24){const other=restore(sim);for(let i=0;i<n;i++){sim.step(.25);other.step(.25);}assert.equal(other.exportSave(),sim.exportSave());return other;}

test('real two-official cash reservation creates day1 original assignments; next day continues new segment without erasing paid day0',()=>{
 const {sim,api,staff,signers}=open(),c=counter(sim),before=counts(sim),wallet=staff.money,treasury=sim.state.treasury;
 assert.equal(api.planNextDay(c.id,[signers[0].id]).ok,false,'one signature cannot create a plan');
 assert.equal(api.planNextDay(c.id,signers.map(s=>s.id)).ok,true);
 const plan=runtime(sim).publicLabor.shifts.find((s:any)=>s.day===1),assignment=plan.assignments.find((a:any)=>a.citizenId===staff.id);
 assert.equal(assignment.workId,'school');assert.equal(assignment.minutesCap,480);assert.equal(assignment.workedMinutes,0);assert.equal(sim.state.treasury,treasury,'reservation moves no cash');
 assert.equal(api.planNextDay(c.id,signers.map(s=>s.id)).ok,false,'original plan cannot be duplicate funded');
 while(sim.state.extension!.lastUpdate<1440)sim.step(.25);assert.equal(Math.floor(sim.state.extension!.lastUpdate/1440),1);
 assert.ok(staff.money>wallet,'actual 17 pay occurred');assert.equal(c.tasks[0].stage,'finished');assert.equal(c.tasks[0].workedMinutes,476);assert.equal(c.tasks[0].contract.id,'standing-day-0');const historic=JSON.stringify(c.tasks[0]);
 assert.equal(sim.command({type:'setTime',value:8}).ok,true);assert.equal(api.accept(c.id,staff.id).ok,false,'sleeping body at home cannot start a counter task');
 // Existing worker walks the original home-to-work route; no position or job is changed.
 runtime(sim).activities[staff.id]='work';staff.destinationId=staff.workId;runtime(sim).decisionAt[staff.id]=sim.state.day*1440+sim.state.hour*60+60;
 for(let i=0;i<20&&!sim.isOnDuty(staff.id,c.siteId);i++)sim.step(.25);
 assert.equal(sim.isOnDuty(staff.id,c.siteId),true,'original real workplace interior is reached before counter continuation');const beforeMinutes=assignment.workedMinutes;assert.equal(api.accept(c.id,staff.id).ok,true);
 const t=c.tasks.at(-1)!;assert.equal(t.continuationOf,c.tasks[0].id);assert.equal(t.contract.id,'public-shift-1');assert.equal(t.contract.payrollEpoch,1);assert.equal(t.stage,'serve');
 assert.equal(t.workedMinutes,0);sim.step(.25);assert.equal(t.workedMinutes,4);assert.equal(assignment.workedMinutes,beforeMinutes+4);assert.equal(sim.state.foodDistribution!.payroll.dayUsed['1'][staff.id],beforeMinutes+4);assert.equal(JSON.stringify(c.tasks[0]),historic);
 stable(cash(sim),before.cash,'cash');stable(food(sim),before.food,'food');assert.deepEqual(sim.state.citizens.map(c=>[c.id,c.workId,c.role]),before.jobs);assert.equal(c.materialConsumed,1);
 stepped(sim);writeFileSync('artifacts/day1-continuation-proof.json',JSON.stringify({plan,oldTask:c.tasks[0],newTask:c.tasks.at(-1),payroll:sim.state.foodDistribution!.payroll,foodResidual:food(sim)-before.food,cashResidual:cash(sim)-before.cash},null,2)+'\n');
});

test('handover requires actual same-site two original workers; each spends one minute and keeps goods, jobs, pay rate',()=>{
 const {sim,api,staff,relief}=open(),c=counter(sim),before=counts(sim),stock=JSON.stringify(c.stocks),prior=structuredClone(c.tasks[0]);
 const position={...relief.position};relief.position.x+=1;const remote=sim.exportSave();assert.equal(api.handover(c.id,relief.id).ok,false);assert.equal(sim.exportSave(),remote);relief.position=position;
 const earned=runtime(sim).wageAccruals.filter((w:any)=>[staff.id,relief.id].includes(w.citizenId)).map((w:any)=>({...w}));assert.equal(api.handover(c.id,relief.id).ok,true);
 assert.equal(api.quote(c.id,sim.state.citizens.find(b=>b.workId!=='school')!.id)!.staffed,false);const h=c.handovers[0];assert.equal(h.requiredMinutes,1);assert.equal(h.completedAt,null);assert.equal(c.tasks[0].workedMinutes,prior.workedMinutes);
 sim.command({type:'speed',value:1});sim.step(.25);assert.equal(h.completedAt,null);const snapshot=restore(sim);for(let i=0;i<12;i++){sim.step(.25);snapshot.step(.25);}assert.equal(sim.exportSave(),snapshot.exportSave());
 assert.ok(h.completedAt!==null);const from=c.tasks.find(t=>t.id===h.fromTaskId)!,to=c.tasks.find(t=>t.id===h.toTaskId)!;assert.equal(from.allocated.staffHandover,1);assert.equal(to.allocated.staffHandover,1);assert.equal(from.stage,'finished');assert.equal(to.stage,'serve');
 assert.equal(JSON.stringify(c.stocks),stock);assert.deepEqual(sim.state.citizens.map(b=>[b.id,b.workId,b.role]),before.jobs);assert.equal(c.materialConsumed,before.material);stable(cash(sim),before.cash,'cash');stable(food(sim),before.food,'food');
 for(const task of [from,to]){const original=earned.find((w:any)=>w.citizenId===task.citizenId)!;const claim=runtime(sim).wageAccruals.find((w:any)=>w.citizenId===task.citizenId);assert.ok(claim.amount-original.amount>=task.earned-1e-7);assert.equal(task.contract.ratePerMinute,original.ratePerMinute);}
 writeFileSync('artifacts/two-staff-handover-proof.json',JSON.stringify({handover:h,from,to,priorTaskUnchanged:JSON.stringify(c.tasks[0])===JSON.stringify({...prior,stage:'finished',endedAt:h.requestedAt,endReason:'onsite-handover-started'}),foodResidual:food(sim)-before.food,cashResidual:cash(sim)-before.cash},null,2)+'\n');restore(sim);
});

test('leaving a pending handover pauses actual transfer and cancellation retains every already earned minute',()=>{
 const {sim,api,staff,relief}=open(),c=counter(sim),before=counts(sim);assert.equal(api.handover(c.id,relief.id).ok,true);sim.command({type:'speed',value:1});sim.step(.25);
 const h=c.handovers[0],from=c.tasks.find(t=>t.id===h.fromTaskId)!,to=c.tasks.find(t=>t.id===h.toTaskId)!;const minutes=from.workedMinutes+to.workedMinutes;assert.ok(minutes>0&&minutes<2);
 const stock=JSON.stringify(c.stocks);relief.position.x+=10;for(let i=0;i<4;i++)sim.step(.25);assert.equal(h.completedAt,null);assert.equal(from.workedMinutes+to.workedMinutes,minutes);assert.equal(JSON.stringify(c.stocks),stock);
 assert.equal(api.close(c.id).ok,false,'uncompleted people handover cannot discard carrier responsibility');assert.equal(api.cancelHandover(c.id).ok,true);assert.equal(h.cancelledAt,sim.state.extension!.lastUpdate);assert.equal(from.workedMinutes+to.workedMinutes,minutes);assert.equal(from.earned+to.earned,minutes*from.contract.ratePerMinute);assert.equal(c.tasks.at(-1)!.citizenId,staff.id);stable(cash(sim),before.cash,'cash');stable(food(sim),before.food,'food');restore(sim);
});

test('new handover cannot borrow absent staff, fake emit payouts or consumed original daily minutes',()=>{
 const {sim,api,staff,relief}=open(),c=counter(sim);const save=sim.exportSave();assert.equal(api.handover(c.id,staff.id).ok,false);assert.equal(sim.exportSave(),save);
 const ledger=JSON.stringify(sim.state.foodDistribution!.payroll);sim.emitEvent({type:'wage-paid',citizenId:staff.id,amount:100});assert.equal(JSON.stringify(sim.state.foodDistribution!.payroll),ledger,'public event cannot settle actual debt evidence');
 while(sim.state.hour<17)sim.step(.25);sim.command({type:'setTime',value:10});const before=sim.exportSave();assert.equal(api.handover(c.id,relief.id).ok,false);assert.equal(sim.exportSave(),before);restore(sim);
});

test('closed period, day cap, future-plan and handover mutations reject without changing the destination',()=>{
 const {sim,api,staff,relief,signers}=open(),c=counter(sim);assert.equal(api.planNextDay(c.id,signers.map(s=>s.id)).ok,true);assert.equal(api.handover(c.id,relief.id).ok,true);sim.command({type:'speed',value:1});sim.step(.25);
 const pending=sim.exportSave(),target=new Simulation(world),baseline=target.exportSave();const changes:[string,(s:any)=>void][]=[
  ['missing payroll',s=>delete s.state.foodDistribution.payroll],['missing marker',s=>delete s.runtime.foodDistributionVersion],['forged day allowance',s=>s.state.foodDistribution.payroll.dayUsed['0'][staff.id]=0],
  ['handover people same',s=>s.state.foodDistribution.counters[0].tasks[2].citizenId=staff.id],['false handling duration',s=>s.state.foodDistribution.counters[0].handovers[0].requiredMinutes=2],['wrong custodian',s=>s.state.foodDistribution.counters[0].stocks[0].carrierId=s.state.citizens.find((x:any)=>x.id!==staff.id&&x.id!==relief.id).id],['remote witness',s=>s.state.foodDistribution.counters[0].handovers[0].toPosition.x+=1],['false completion',s=>s.state.foodDistribution.counters[0].handovers[0].completedAt=s.state.extension.lastUpdate],
  ['erased formal plan',s=>s.runtime.publicLabor.shifts=[]],['future worked',s=>s.runtime.publicLabor.shifts[0].assignments[0].workedMinutes=1],['new task as old',s=>s.state.foodDistribution.counters[0].tasks[2].contract.payrollEpoch=null],
 ];for(const [name,change]of changes){const s=JSON.parse(pending);change(s);assert.equal(target.importSave(JSON.stringify(s)).ok,false,name);assert.equal(target.exportSave(),baseline,name);}
 api.cancelHandover(c.id);sim.command({type:'speed',value:16});while(sim.state.hour<17)sim.step(.25);const paid=sim.exportSave();for(const [name,change]of [
  ['erased periods',(s:any)=>s.state.foodDistribution.payroll.periods=[]],['changed period',(s:any)=>s.state.foodDistribution.counters[0].tasks[0].contract.payrollEpoch=1],['rewritten paid amount',(s:any)=>s.state.foodDistribution.payroll.periods[0].claims.find((w:any)=>w.citizenId===staff.id).paidGross=0],
  ['old claim reused after close',(s:any)=>{const t=s.state.foodDistribution.counters[0].tasks[0];t.acceptedAt=s.state.extension.lastUpdate;t.lastObservedAt=s.state.extension.lastUpdate;t.endedAt=s.state.extension.lastUpdate;}],
 ] as [string,(s:any)=>void][]){const s=JSON.parse(paid);change(s);assert.equal(target.importSave(JSON.stringify(s)).ok,false,name);assert.equal(target.exportSave(),baseline,name);}
});

test('real old v1 paid snapshot migrates restricted old evidence without guessing paid history or inventing a same-day renewal',()=>{
 const old=readFileSync(new URL('./fixtures/food-counter-paid-v1.json',import.meta.url),'utf8'),sim=new Simulation(world),loaded=sim.importSave(old);assert.equal(loaded.ok,true,loaded.message);
 const c=counter(sim),original=JSON.parse(old).state.foodDistribution.counters[0],p=sim.state.foodDistribution!.payroll;assert.equal(p.legacyTaskIds.length,1);assert.equal(p.legacyBlockedDay,0);assert.equal(c.tasks[0].contract.payrollEpoch,null);assert.equal(c.tasks[0].workedMinutes,original.tasks[0].workedMinutes);assert.equal(c.tasks[0].earned,original.tasks[0].earned);assert.deepEqual(c.stocks,original.stocks);assert.deepEqual(c.receipts,original.receipts);
 const api=foodDistributionController(sim);sim.command({type:'setTime',value:10});assert.equal(api.accept(c.id,c.tasks[0].citizenId).ok,false);assert.equal(api.resume(c.id).ok,false);stepped(sim);writeFileSync('artifacts/legacy-v1-migration-proof.json',JSON.stringify({cash:cash(sim),legacyTask:c.tasks[0],payroll:p},null,2)+'\n');
});


test('real carried food changes custodian only after two onsite handling minutes for both original staff',()=>{
 const {sim,api,staff,relief}=setup(),c=counter(sim),before=counts(sim);
 while(!c.stocks.length)sim.step(.25);assert.equal(c.stocks[0].location,'carrier');sim.command({type:'speed',value:1});
 for(let i=0;i<800&&Math.hypot(staff.position.x-c.point.x,staff.position.y-c.point.y,staff.position.z-c.point.z)>.05;i++)sim.step(.25);
 assert.equal(c.stocks[0].location,'carrier','partial actual unloading still has its original carrier');assert.equal(c.stocks[0].carrierId,staff.id);assert.ok(c.tasks[0].handoffMinutes<2);
 // The other original teacher returns from the ordinary room point to this actual counter point using the same real movement API via its normal route.
 relief.destinationId=null;runtime(sim).activities[relief.id]='work';runtime(sim).decisionAt[relief.id]=1e6;
 // Fixture began both at this doorway; core ordinary work moves the relief to an interior work point. No teleport is used: follow an explicit real door route.
 relief.destinationId=c.siteId;relief.route=[{...c.point}];relief.routeIndex=0;
 for(let i=0;i<30&&Math.hypot(relief.position.x-c.point.x,relief.position.y-c.point.y,relief.position.z-c.point.z)>.05;i++)sim.step(.25);
 assert.ok(sim.isOnDuty(relief.id,c.siteId));assert.equal(api.handover(c.id,relief.id).ok,true);
 const stock=c.stocks[0],origin=JSON.stringify(stock.origin),h=c.handovers[0];assert.equal(h.requiredMinutes,2);assert.equal(stock.carrierId,staff.id);
 stepped(sim,4);assert.equal(h.completedAt,null);assert.equal(stock.carrierId,staff.id);for(let i=0;i<30&&h.completedAt===null;i++)sim.step(.25);
 assert.ok(h.completedAt!==null);assert.equal(stock.carrierId,relief.id);assert.equal(JSON.stringify(stock.origin),origin);assert.equal(stock.remaining,8);assert.equal(stock.location,'carrier');
 for(let i=0;i<30&&!stockOnShelf(stock);i++)sim.step(.25);assert.equal(stock.location,'counter');assert.equal(stock.remaining,8);assert.equal(stock.sold,0);assert.equal(stock.returned,0);stable(cash(sim),before.cash,'cash');stable(food(sim),before.food,'food');assert.deepEqual(sim.state.citizens.map(c=>[c.id,c.workId,c.role]),before.jobs);restore(sim);
});

test('17:00 interrupted handover retains the old custodian, and next funded day walks closing food back',()=>{
 const {sim,api,staff,relief,signers}=open(),c=counter(sim),before=counts(sim);assert.equal(api.planNextDay(c.id,signers.map(c=>c.id)).ok,true);const source=c.stocks[0].sourceLotId;
 assert.equal(api.handover(c.id,relief.id).ok,true);sim.command({type:'speed',value:1});sim.step(.25);assert.equal(api.pause(c.id,relief.id).ok,true);
 runtime(sim).activities[relief.id]='rest';runtime(sim).decisionAt[relief.id]=1e6;
 Reflect.get(sim,'setDestination').call(sim,relief,world.buildings.find(b=>b.id===relief.homeId),true);const leave={...relief.position};for(let i=0;i<12;i++)sim.step(.25);assert.ok(Math.hypot(relief.position.x-leave.x,relief.position.z-leave.z)>0,'paused worker really walks away');
 assert.equal(c.handovers[0].completedAt,null);const outgoing=c.tasks.find(t=>t.id===c.handovers[0].fromTaskId)!;sim.command({type:'speed',value:16});
 while(sim.state.hour<17)sim.step(.25);assert.equal(c.tasks[0].stage,'finished');const paidHistory=JSON.stringify(c.tasks[0]);assert.equal(c.handovers[0].reason,'payroll-period-ended');assert.equal(c.handovers[0].completedAt,null);assert.equal(outgoing.stage,'finished');assert.equal(api.close(c.id).ok,true);assert.equal(c.state,'closing');assert.equal(c.stocks[0].remaining,8);
 const arrivals:any[]=[];sim.onEvent('cargo-arrived',event=>{if(event.districtId==='customers')arrivals.push(structuredClone(event));});const freight=runtime(sim).freight.customers,budget=runtime(sim).publicBudgets.find((b:any)=>b.id===c.budgetId);assert.ok(budget.closedAt!==null);assert.equal(budget.spent,4);restore(sim);
 while(sim.state.extension!.lastUpdate<1440)sim.step(.25);sim.command({type:'setTime',value:8});assert.equal(api.accept(c.id,staff.id).ok,false);
 runtime(sim).activities[staff.id]='work';staff.destinationId=staff.workId;runtime(sim).decisionAt[staff.id]=sim.state.day*1440+sim.state.hour*60+60;
 for(let i=0;i<20&&!sim.isOnDuty(staff.id,c.siteId);i++)sim.step(.25);assert.equal(api.accept(c.id,staff.id).ok,true);assert.equal(c.tasks.at(-1)!.stage,'return');assert.equal(c.tasks.at(-1)!.contract.id,'public-shift-1');assert.equal(c.tasks.at(-1)!.continuationOf,outgoing.id,'uncompleted incoming staff never acquires responsibility');assert.equal(runtime(sim).freight.customers,freight);
 const returns:any[]=[];sim.onEvent('counter-food-returned',event=>returns.push(structuredClone(event)));stepped(sim,4);for(let i=0;i<200&&!counterClosed(c);i++)sim.step(.25);writeFileSync('artifacts/return-quantity-fixed-proof.json',JSON.stringify({source,stock:c.stocks[0],freightBefore:freight,freight:runtime(sim).freight,lots:runtime(sim).freightLots,origins:runtime(sim).freightTracking.origins,returns,arrivals},null,2)+'\n');assert.equal(c.state,'closed');assert.equal(c.stocks[0].returned,8);assert.equal(c.stocks[0].remaining,0);assert.equal(runtime(sim).freightLots.customers.find((l:any)=>l.id===source).quantity,28);assert.equal(returns.length,1);assert.equal(returns[0].quantity,8);assert.equal(arrivals.reduce((n,e)=>n+e.amount,0),56,'clock re-scheduled two existing real 28-unit vehicles');assert.equal(runtime(sim).freight.customers,freight+8+56);assert.equal(JSON.stringify(c.tasks[0]),paidHistory);stable(cash(sim),before.cash,'cash');stable(food(sim),before.food,'food');assert.deepEqual(sim.state.citizens.map(c=>[c.id,c.workId,c.role]),before.jobs);assert.equal(c.materialConsumed,1);restore(sim);
});
