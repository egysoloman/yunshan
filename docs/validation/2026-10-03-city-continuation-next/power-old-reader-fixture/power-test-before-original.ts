// Named functional controls do not establish natural/default-city coverage.
// Actual run scopes, immutable sources and preserved failures are in delivery receipts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation.ts';
import { createWorld } from '../src/world.ts';
import { powerStatus } from '../src/simulation/power.ts';
import { claimFundedActorWork } from '../src/simulation/funded-work.ts';
import { actorActivityAvailable, claimActorActivityMinutes } from '../src/simulation/activity-minutes.ts';
import { validateJointActorActivityCapacity } from '../src/simulation/activity-capacity.ts';
import { partitionSave, assembleSave } from '../src/persistence/partition.ts';
import { powerWorld, core, at, ticks, controlTechnician, genuineFault, setupPaid, restore, cash, workPoint } from './power-fixture.ts';
const near = (a:number,b:number,label:string) => assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} != ${b}`);
function ready(sim:Simulation) {const job=sim.state.power!.repairs.at(-1)!;for(let i=0;i<90&&job.reservedUnits!==1;i++)sim.step(.25);assert.equal(job.reservedUnits,1,job.reason);return job;}
function finish(sim:Simulation) {const job=sim.state.power!.repairs.at(-1)!;for(let i=0;i<90&&job.status!=='completed';i++)sim.step(.25);assert.equal(job.status,'completed',job.reason);return job;}
function bad(sim:Simulation,edit:(save:any)=>void) {const before=sim.exportSave(),data=JSON.parse(before);edit(data);const result=sim.importSave(JSON.stringify(data));assert.equal(result.ok,false,result.message);assert.equal(sim.exportSave(),before,'failed import is atomic');}

test('cold supported world has no power body or optional old-boost fields, exact clone 24 ticks',()=>{
 const sim=new Simulation(powerWorld());assert.equal(sim.state.power,undefined);assert.equal(core(sim).powerVersion,undefined);assert.equal(core(sim).legacyEnergyContract,undefined);
 const next=restore(sim);for(let i=0;i<24;i++){sim.step(.25);next.step(.25);}assert.equal(next.exportSave(),sim.exportSave());
});
test('healthy original energy command does not take 100 or create damage/material/elapsed work',()=>{
 const sim=new Simulation(powerWorld()),source=sim.worldDefinition.buildings.find(b=>b.id==='core-main')!;sim.state.player.role='scientist';sim.state.player.identities=['traveler','scientist'];sim.setFocus(workPoint(source),'walk');
 const before=sim.exportSave(),result=sim.command({type:'energy',targetId:source.id});assert.equal(result.ok,false);assert.equal(sim.exportSave(),before);assert.equal(sim.state.power,undefined);
});
test('unsupported map stays on original aggregate contract without empty fake assets',()=>{
 const world=powerWorld(false);world.buildings.find(b=>b.id==='core-main')!.facility='archives';const sim=new Simulation(world);assert.equal(powerStatus(sim).supported,false);ticks(sim,24);assert.equal(sim.state.power,undefined);assert.equal(core(sim).powerVersion,undefined);restore(sim);
});
test('a forged ordinary event cannot activate a canonical equipment fault',()=>{
 const sim=new Simulation(powerWorld()),before=sim.exportSave();sim.emitEvent({type:'environment-disaster',eventId:1,districtId:'power-district',severity:17,occurredAt:at(sim)});assert.equal(sim.exportSave(),before);
});
test('real original controlled rain branch creates persistent loss and one original city demand envelope',()=>{
 const sim=new Simulation(powerWorld()),power=genuineFault(sim),fault=power.faults[0];near(fault.addedLossP,fault.severity*.93,'approved damage recipe');near(power.lossP,fault.addedLossP,'persistent loss');
 const d=power.dispatch!;near(d.baseP,93+Math.sin((sim.state.day*1440+sim.state.hour*60)/130)*3,'single source');near(d.demandP,53+(sim.state.hour<6||sim.state.hour>=19?19:8)+sim.state.shops.filter(s=>s.open).length*.08+sim.state.vehicles.length*.08,'original demand');
 near(d.availableP,(Math.max(0,d.baseP-power.lossP)+d.legacyP)*(.35+.65*d.publicSupply),'damaged source');near(d.demandP,d.servedP+d.unservedP,'load balance');near(d.availableP,d.servedP+d.curtailedP,'supply balance');
 near(Object.values(power.buildingMeters).reduce((s,m)=>s+m.demandP,0)+Object.values(power.vehicleMeters).reduce((s,m)=>s+m.demandP,0),d.demandP,'meter sum');
 const measured=power.totals.demandedPMinutes;sim.emitEvent({type:'system:energy'});assert.equal(power.totals.demandedPMinutes,measured,'no same tick meter replay');restore(sim);
});
test('player real 100 escrow buys finite industrial material and only 60 funded control minutes restore at most5P',()=>{
 const {sim,presence,job}=setupPaid(),initialCash=cash(sim),loss=sim.state.power!.lossP,started=job.startedAt;assert.equal(job.workedMinutes,0);assert.equal(job.purchasePaid,0);assert.equal(sim.state.power!.lossP,loss);
 const stockBefore=sim.state.shops.filter(s=>sim.shopCommodity(s)==='materials').reduce((n,s)=>n+s.inventory,0);ready(sim);assert.equal(job.receivedUnits,1);assert.equal(job.reservedUnits,1);assert.equal(job.consumedUnits,0);assert.ok(job.purchasePaid>=4);near(job.funded,job.escrow+job.purchasePaid,'pending escrow');assert.ok(sim.isOnDuty(presence.actor.id,presence.site.id));
 // Source production can legitimately run concurrently; receipt/source quotes
 // and the strict global Power stock equation establish the one-unit purchase.
 assert.ok(stockBefore>0);near(cash(sim),initialCash,'cash after purchase');finish(sim);assert.equal(job.workedMinutes,60);assert.ok(job.completedAt!>=started+60-1e-7);assert.equal(job.consumedUnits,1);assert.equal(job.escrow,0);near(job.funded,job.purchasePaid+job.serviceFees,'funded final fee');near(sim.state.power!.lossP,loss-job.restoreP,'restore only existing loss');assert.ok(job.restoreP<=5);near(cash(sim),initialCash,'cash after earned fee');restore(sim);
});
test('leaving and placed voxel pause real labor, no clock-jump catchup, then legitimate return continues',()=>{
 const {sim,presence,job}=setupPaid();ready(sim);ticks(sim,3);const work=job.workedMinutes;assert.ok(work>0);presence.leave();ticks(sim,3);assert.equal(job.workedMinutes,work);
 const old=at(sim);sim.command({type:'setTime',value:12});assert.equal(at(sim),old);assert.equal(job.workedMinutes,work);presence.enter();
 // Schema-valid complete fixture cube: this is not an actual build command.
 sim.state.voxels.push({id:'block-power-fixture',position:{x:presence.point.x,y:presence.point.y+.8,z:presence.point.z},color:'#444444'});ticks(sim,3);assert.equal(job.workedMinutes,work);restore(sim);
 sim.state.voxels=[];ticks(sim,1);assert.ok(job.workedMinutes>work);assert.ok(job.workedMinutes<=work+2+1e-7);
});
test('cancel refunds unearned escrow and returns one reserved material, never erases wages or fault',()=>{
 const {sim,presence,job}=setupPaid();ready(sim);ticks(sim,3);const worked=job.workedMinutes,loss=sim.state.power!.lossP,money=sim.state.player.money,escrow=job.escrow,total=cash(sim),paid=job.purchasePaid,wages=core(sim).wageAccruals.filter((a:any)=>a.citizenId===presence.actor.id).reduce((n:number,a:any)=>n+a.amount,0);
 const result=sim.command({type:'cancelEnergy',targetId:job.id});assert(result.ok,result.message);assert.equal(job.workedMinutes,worked);assert.equal(job.escrow,0);near(sim.state.player.money,money+escrow,'real refund');assert.equal(job.purchasePaid,paid);assert.equal(sim.state.power!.stock.availableUnits,1);assert.equal(job.reservedUnits,0);assert.equal(sim.state.power!.lossP,loss);assert.equal(core(sim).wageAccruals.filter((a:any)=>a.citizenId===presence.actor.id).reduce((n:number,a:any)=>n+a.amount,0),wages);near(cash(sim),total,'cancel cash');restore(sim);
});
test('private active and full final save restore and 24 actual ticks are exact with identical named controls',()=>{
 const {sim,presence}=setupPaid();ready(sim);ticks(sim,3);const clone=restore(sim,presence.actor.id);for(let i=0;i<24;i++){sim.step(.25);clone.step(.25);}assert.equal(clone.exportSave(),sim.exportSave());finish(sim);const done=restore(sim,presence.actor.id);for(let i=0;i<24;i++){sim.step(.25);done.step(.25);}assert.equal(done.exportSave(),sim.exportSave());
});
test('new body/marker/manifest and causal receipt/fault deletion or future mutations atomically reject',()=>{
 const {sim}=setupPaid();ready(sim);finish(sim);ticks(sim,6);const terminal=sim.state.power!.repairs.find(j=>j.payerId==='player')!;assert.ok(at(sim)>terminal.completedAt!+2);
 bad(sim,s=>{delete s.state.power;});bad(sim,s=>{delete s.runtime.powerVersion;});bad(sim,s=>{s.runtime.persistedModules=s.runtime.persistedModules.filter((x:string)=>x!=='power');});bad(sim,s=>{s.state.power.faults[0].occurredAt=terminal.startedAt+1;});bad(sim,s=>{s.state.power.repairs.find((j:any)=>j.id===terminal.id).receipts[0].purchasedAt=terminal.completedAt!+1;});bad(sim,s=>{s.state.power.stock.availableUnits+=1;});bad(sim,s=>{s.state.power.repairs.find((j:any)=>j.id===terminal.id).workedMinutes=59;});
});
test('real native player work minutes can be apportioned once to repair without a second wage or free activity budget',()=>{
 const {sim,presence,job}=setupPaid();presence.leave();sim.state.player.role='scientist';sim.state.player.identities=['traveler','scientist','mayor'];sim.setFocus(presence.point,'walk');ready(sim);
 const before=cash(sim),stock=sim.state.shops.map(s=>s.inventory),result=sim.command({type:'work',targetId:presence.site.id});assert(result.ok,result.message);const shift=sim.state.playerLabor!.job!;const gross=shift.gross;
 ticks(sim,30);assert.equal(job.status,'completed');assert.equal(job.workedMinutes,60);assert.equal(sim.state.playerLabor!.history.at(-1)!.workedMinutes,60);near(sim.state.playerLabor!.history.at(-1)!.paidGross,gross,'one wage');near(cash(sim),before,'apportioned wages cash');assert.ok(stock.every(Number.isFinite));restore(sim);
});
test('shared funded-front interval cannot be consumed by both maintenance and research',()=>{
 const host={state:new Simulation(powerWorld()).state},now=host.state.extension!.lastUpdate,ranges=[{startAt:now-2,endAt:now-1}];
 const maintenance=claimFundedActorWork(host,'test-actor','repair',ranges,2,2),science=claimFundedActorWork(host,'test-actor','research',ranges,2,2);assert.equal(maintenance.minutes,1);assert.equal(science.minutes,0);assert.equal(actorActivityAvailable(host,'test-actor',2),1,'unused unfunded phase is not a funded labor source');
});
test('same native paid-work reservation is partitioned, not paid twice or released for research',()=>{
 const host={state:new Simulation(powerWorld()).state},now=host.state.extension!.lastUpdate;assert.equal(claimActorActivityMinutes(host,'player','paid-work:job',2,2),2);
 const repair=claimFundedActorWork(host,'player','repair',[{startAt:now-2,endAt:now}],2,2,'paid-work:job');assert.equal(repair.minutes,2);assert.equal(actorActivityAvailable(host,'player',2),0);assert.equal(claimActorActivityMinutes(host,'player','research',1,2),0);
});
test('terminal release/deadline capacity cannot be bypassed by a later save clock',()=>{
 const state=new Simulation(powerWorld()).state;state.extension!.lastUpdate=220;
 // Pure envelope-validator unit fixture, not invented live course/cash history.
 const unitEducation={history:[{id:'a',actorId:'player',startedAt:100,completedAt:160,cancelledAt:null,workedMinutes:60},{id:'b',actorId:'player',startedAt:100,completedAt:160,cancelledAt:null,workedMinutes:60}],course:null};Reflect.set(state,'education',unitEducation);assert.throws(()=>validateJointActorActivityCapacity(state),/容量/);
 unitEducation.history[1].startedAt=160;unitEducation.history[1].completedAt=220;assert.doesNotThrow(()=>validateJointActorActivityCapacity(state));
});
test('partition retains real player escrow and mandatory meter/entity maps, missing payer/body refuses reassembly',()=>{
 const {sim}=setupPaid();ready(sim);const save=sim.exportSave(),parts=partitionSave(save,sim.worldDefinition);assert.equal(assembleSave(parts),save);const player=parts.find(p=>p.id==='player')!,parsed=JSON.parse(player.json);assert.ok(parsed.arrays['state.power.repairs'].length);parsed.arrays['state.power.repairs']=[];const badParts=parts.map(p=>p.id==='player'?{...p,json:JSON.stringify(parsed)}:p);assert.throws(()=>assembleSave(badParts));
});
test('actual old paid boost is converted once for original remaining minutes; display rewind cannot renew it',()=>{
 // Required first input: drivers/capture-native-old-energy.ts on immutable
 // before/. Missing raw fixture is an explicit NOT_CAPTURED failure, not skip.
 const raw=readFileSync(new URL('./fixtures/power-native-old-energy-paid-v1.json',import.meta.url),'utf8'),sim=new Simulation(createWorld());const result=sim.importSave(raw);assert(result.ok,result.message);const contract={...core(sim).legacyEnergyContract};assert.equal(contract.duration,240);assert.equal(sim.state.power,undefined);assert.equal(core(sim).powerVersion,undefined);
 const migrated=sim.exportSave(),next=restore(sim);assert.equal(next.exportSave(),migrated);sim.command({type:'setTime',value:0});assert.equal(core(sim).legacyEnergyContract.endsAt,contract.endsAt);assert.equal(core(sim).legacyEnergyContract.duration,240);assert.equal(at(sim),contract.capturedAt);bad(sim,s=>{delete s.runtime.legacyEnergyContract;});bad(sim,s=>{delete s.runtime.legacyEnergyContractVersion;});bad(sim,s=>{s.runtime.legacyEnergyContract.endsAt+=240;});
 sim.command({type:'speed',value:16});for(let n=0;at(sim)<contract.endsAt+1&&n<1000;n++)sim.step(.25);assert.ok(at(sim)>contract.endsAt);assert.equal(core(sim).legacyEnergyContract.endsAt,contract.endsAt);restore(sim);
});

test('public repair uses two existing actually paid officials, cap40 material budget and original technician wages, no circular100',()=>{
 const sim=new Simulation(powerWorld());sim.command({type:'speed',value:8});const technician=controlTechnician(sim);const power=genuineFault(sim),job=power.repairs[0],source=sim.worldDefinition.buildings.find(b=>b.id==='core-main')!,point=workPoint(source);
 const officials=sim.state.citizens.filter(c=>c.workId===source.id&&['官员','财政官','official','议员','council'].includes(c.role)&&sim.state.extension!.actorProfiles[c.id].alive&&sim.state.extension!.actorProfiles[c.id].age>=18).slice(0,2);assert.equal(officials.length,2,'fixture needs two generated officials with their real civic job');
 // Only named function-point presence/needs controls; core actual attendance,
 // shift money/rates, original quorum authorization and finite purchases run.
 const place=()=>{for(const actor of officials){actor.position={...point};actor.destinationId=source.id;actor.route=[{...point}];actor.routeIndex=1;actor.needs={hunger:100,fatigue:100,social:100,fun:100};core(sim).activities[actor.id]='work';core(sim).decisionAt[actor.id]=sim.state.day*1440+sim.state.hour*60+10;}};place();sim.onPhase('traffic',place);
 const original=Reflect.get(sim,'setDestination');Reflect.set(sim,'setDestination',(actor:any,destination:any,rebuild=false)=>{if(officials.some(c=>c.id===actor.id)&&destination.id===source.id){actor.destinationId=source.id;actor.route=[{...point}];actor.routeIndex=1;return;}return original.call(sim,actor,destination,rebuild);});
 const player=sim.state.player.money,total=cash(sim);for(let i=0;i<90&&!job.budgetId;i++)sim.step(.25);assert(job.budgetId,job.reason);const budget=core(sim).publicBudgets.find((b:any)=>b.id===job.budgetId);assert.equal(budget.cap,40);assert.equal(budget.signatures.length,2);assert.ok(budget.signatures.every((s:any)=>officials.some(c=>c.id===s.actorId)&&s.siteId===source.id));ready(sim);assert.equal(job.escrow,0);assert.equal(job.funded,job.purchasePaid);assert.ok(job.purchasePaid>0&&job.purchasePaid<=40);assert.equal(job.serviceFees,0);assert.equal(sim.state.player.money,player);assert.ok(sim.isOnDuty(technician.actor.id,technician.site.id));near(cash(sim),total,'public actual purchase cash');restore(sim);
 bad(sim,s=>{s.runtime.publicBudgets.find((b:any)=>b.id===job.budgetId).spent=0;});bad(sim,s=>{delete s.state.power;});
});
test('recorded reservation cannot borrow later stock or a future fault, all cash and past wage principals unchanged',()=>{
 const {sim,job}=setupPaid();ready(sim);ticks(sim,3);sim.command({type:'cancelEnergy',targetId:job.id});const source=sim.worldDefinition.buildings.find(b=>b.id==='core-main')!;sim.setFocus(workPoint(source),'walk');const result=sim.command({type:'energy',targetId:source.id});assert(result.ok,result.message);const reused=sim.state.power!.repairs.at(-1)!;ready(sim);assert.equal(reused.reusedUnits,1);assert.equal(reused.receivedUnits,0);finish(sim);ticks(sim,6);
 bad(sim,s=>{const first=s.state.power.repairs.find((j:any)=>j.id===job.id);first.receipts[0].purchasedAt=reused.completedAt!+1;});
 bad(sim,s=>{const terminal=s.state.power.repairs.find((j:any)=>j.id===reused.id);terminal.reservedAt=job.startedAt-1;});
});


test('declared power dispatch cannot invent an extra20 from a missing legacy paid contract',()=>{
 const sim=new Simulation(powerWorld()),power=genuineFault(sim);assert.equal(core(sim).legacyEnergyContract,undefined);assert.equal(power.dispatch!.legacyP,0);
 bad(sim,save=>{const d=save.state.power.dispatch,bonus=20*(.35+.65*d.publicSupply);d.legacyP=20;d.availableP+=bonus;d.curtailedP+=bonus;});
});
test('public full affordable source is selected before an expensive partial source without enlarging its budget',()=>{
 // Procurement/quote oracle fixture: real finite source inventories, net funds,
 // tax queue, protected public budget and Power stock still execute. H100/H4
 // are named test price overrides, not a natural producer cost observation.
 const sim=new Simulation(powerWorld());sim.command({type:'speed',value:8});controlTechnician(sim);const source=sim.worldDefinition.buildings.find(b=>b.id==='core-main')!,point=workPoint(source);
 sim.state.player.role='mayor';sim.state.player.identities=['traveler','mayor'];sim.setFocus(point,'walk');
 const materials=sim.state.shops.filter(shop=>sim.shopCommodity(shop)==='materials'&&shop.inventory>=1);assert.ok(materials.length>=2,'two existing finite material sources required');
 const expensive=materials.sort((a,b)=>b.inventory-a.inventory)[0],affordable=materials.find(shop=>shop.id!==expensive.id)!;const original=sim.quoteSupply.bind(sim);
 Reflect.set(sim,'quoteSupply',(id:string,q:number)=>({...original(id,q),unitPrice:id===affordable.id?4:100}));
 // Bind the named price oracle before the native flood consumes finite stock.
 // No stock is reset: both suppliers must still genuinely have one full unit.
 genuineFault(sim);const job=sim.state.power!.repairs[0];assert.equal(job.budgetId,null);
 assert.ok(expensive.inventory>=1&&affordable.inventory>=1,'actual flood must leave both existing sources finite');
 // Verify the actual single budget transfer synchronously; the same live tick
 // also runs genuine upkeep purchases which must not be charged to this repair.
 const procurement=sim.purchasePublicSupplyReceipt.bind(sim),transfers:{net:number;stock:number;cashBefore:number;cashAfter:number;paid:number;tax:number}[]=[];
 Reflect.set(sim,'purchasePublicSupplyReceipt',(request:Parameters<Simulation['purchasePublicSupplyReceipt']>[0])=>{
  if(request.budgetId!==job.budgetId)return procurement(request);
  const funds=sim.shopFunds(affordable),stock=affordable.inventory,cashBefore=cash(sim),receipt=procurement(request);
  transfers.push({net:sim.shopFunds(affordable)-funds,stock:stock-affordable.inventory,cashBefore,cashAfter:cash(sim),paid:receipt.paid,tax:receipt.tax});return receipt;
 });
 const stock=affordable.inventory,total=cash(sim);const approved=sim.command({type:'approveEnergyRepair',targetId:job.id,value:40});assert(approved.ok,approved.message);
 ready(sim);assert.equal(job.receipts.length,1);assert.equal(job.receipts[0].shopId,affordable.id);assert.equal(job.purchasePaid,4);assert.equal(job.receivedUnits,1);assert.equal(job.reservedUnits,1);assert.equal(job.authorizedCap,40);assert.equal(transfers.length,1);near(transfers[0].net,4*(1-sim.state.taxRate),'selected supplier actual net');near(transfers[0].stock,1,'selected supplier actual one-unit withdrawal');near(transfers[0].paid,4,'selected actual gross');near(transfers[0].tax,4*sim.state.taxRate,'selected actual tax');near(transfers[0].cashAfter,transfers[0].cashBefore,'single funded transfer cash');assert.ok(affordable.inventory<=stock,'finite original source stock');near(cash(sim),total,'selected source cash identity');
 const budget=core(sim).publicBudgets.find((b:any)=>b.id===job.budgetId);assert.equal(budget.spent,4);restore(sim);
});
