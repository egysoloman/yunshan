import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { Simulation } from '../src/simulation.ts';
import { isRoadOpen } from '../src/roads.ts';
import { roadworksWorld, cash, exact24, until } from './roadworks-fixture.ts';
import { FLOOR_PLAN_PROFILE, getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import { core, workPoint } from './power-fixture.ts';

function setup(withOfficers = true, markedWarehouse = false) {
  const world = roadworksWorld();
  world.river = [{x:88,y:0,z:-30},{x:88,y:0,z:70}];
  world.edges = world.edges.filter(e => e.id !== 'power-road-10' && !e.id.startsWith('roadworks-detour-'));
  if(markedWarehouse){const warehouse=world.buildings.find(b=>b.id==='power-11')!;warehouse.floorPlanProfile=FLOOR_PLAN_PROFILE;warehouse.functionPoints=Array.from({length:warehouse.floors},(_,floor)=>getBuildingUsePoints(warehouse,floor)).flat();}
  const sim = new Simulation(world); sim.command({type:'speed',value:8});
  const actor = sim.state.citizens.find(c => c.workId === 'power-9' && sim.state.extension!.actorProfiles[c.id].age >= 18)!;
  assert(actor); actor.position={x:50,y:.6,z:19}; core(sim).activities[actor.id]='work'; core(sim).decisionAt[actor.id]=480+180;
  Reflect.get(sim,'setDestination').call(sim,actor,world.buildings.find(b=>b.id===actor.workId),true);
  const groups=new Map<string,typeof sim.state.citizens>();
  for(const c of sim.state.citizens){const b=world.buildings.find(b=>b.id===c.workId),p=sim.state.extension!.actorProfiles[c.id];
    if(b&&['hall','core','bank'].includes(b.kind)&&['官员','财政官','official','议员','council'].includes(c.role)&&p.alive&&p.age>=18){const rows=groups.get(b.id)??[];rows.push(c);groups.set(b.id,rows);}}
  const pair=[...groups.entries()].find(([,cs])=>cs.length>=2)!; assert(pair);
  const office=world.buildings.find(b=>b.id===pair[0])!,point=workPoint(office);
  for(const c of (withOfficers ? pair[1].slice(0,2) : [])){c.position={...point};c.destinationId=office.id;c.route=[{...point}];c.routeIndex=1;core(sim).activities[c.id]='work';core(sim).decisionAt[c.id]=480+180;}
  sim.state.weather='雨'; sim.state.extension!.environment.stormRisk=100;sim.state.extension!.environment.disasterAt=480;core(sim).weatherAt=10000;
  const random=sim.nextRandom.bind(sim);Reflect.set(sim,'nextRandom',()=>0);try{sim.step(.25);}finally{Reflect.set(sim,'nextRandom',random);}
  const closure=sim.state.roadNetwork!.closures[0],demand=sim.state.roadDemands!.demands.find(d=>d.actorId===actor.id)!;assert(demand);
  const job=sim.state.roadworks!.jobs.find(j=>j.id===demand.repairId)!; assert(job);
  if (!withOfficers) return {sim,job,closure,demand,originalWorker:null! as typeof sim.state.citizens[number],office};
  until(sim,()=>job.receivedUnits===1&&job.workedMinutes===0,200);
  const originalWorker=sim.state.citizens.find(c=>c.id===job.workerId)!;
  if(!markedWarehouse)until(sim,()=>job.workedMinutes===0&&Math.hypot(originalWorker.position.x-job.supplierPoint!.x,originalWorker.position.z-job.supplierPoint!.z)>3,20);
  assert.equal(job.funded,40);assert.equal(job.receipts.length,1);
  return {sim,job,closure,demand,originalWorker,office};
}

test('native resident repair preserves its identity and real material after carrier death, then a lawful replacement finishes',t=>{
  const {sim,job,closure,demand,originalWorker}=setup(),before=cash(sim),originalReceipt=structuredClone(job.receipts),originalWorld=JSON.stringify(sim.worldDefinition);
  mkdirSync(resolve('artifacts'),{recursive:true});const artifact=mkdtempSync(resolve('artifacts','roadwork-replacement-'));
  const save=(name:string)=>writeFileSync(resolve(artifact,name+'.json'),sim.exportSave());save('before-death');
  const witnesses:object[]=[];sim.onEvent('roadwork-presence',event=>witnesses.push(structuredClone(event)));
  t.after(()=>{save('final-observed');writeFileSync(resolve(artifact,'actual-presence.json'),JSON.stringify(witnesses,null,2)+'\n');});t.diagnostic('ROADWORK_REPLACEMENT_ARTIFACT '+artifact);
  const budgetId=job.budgetId,oldWorkerId=job.workerId,oldContract=structuredClone(job.contract),oldGross=job.paidGross,drop={...originalWorker.position};
  const profile=sim.state.extension!.actorProfiles[originalWorker.id];profile.health=0;profile.alive=false;
  sim.step(.25);
  assert.equal(job.cancelledAt,null,'resident demand is retained for lawful replacement, rather than cancellation/refunding its only material path');
  assert.equal(job.workerId,oldWorkerId,'original contractor and receipts are historical authority');
  assert.deepEqual(job.contract,oldContract);assert.deepEqual(job.receipts,originalReceipt);assert.equal(job.paidGross,oldGross);assert.equal(job.budgetId,budgetId);
  assert.equal(demand.repairId,job.id);assert.equal(isRoadOpen(sim.state,closure.edgeId),false);
  const material=sim.state.roadworks!.stock.find(l=>l.jobId===job.id)!;assert.equal(material.retained,true);assert.equal(material.quantity,1);assert.deepEqual(material.location,{kind:'ground',point:drop});
  assert.deepEqual(job.replacement!.contracts[0].retainedMaterial!.point,drop);save('after-death-before-pickup');
  writeFileSync(resolve(artifact,'after-death-parts.json'),JSON.stringify(partitionSave(sim.exportSave(),sim.worldDefinition)));
  exact24(sim, (name,live)=>{if(name==='tick24')save('reader24');});
  until(sim,()=>job.completedAt!==null,400);
  assert.equal(job.replacement!.contracts.length,2);assert.equal(job.replacement!.pickups.length,1);assert.deepEqual(job.replacement!.pickups[0].point,drop);assert.equal(job.replacement!.pickups[0].fromContractIndex,0);assert.equal(job.replacement!.pickups[0].toContractIndex,1);
  assert.equal(job.workedMinutes,60);assert.equal(job.receipts.length,1);assert.equal(job.consumedUnits,1);assert.equal(closure.repairedBy,job.id);
  assert.equal(isRoadOpen(sim.state,closure.edgeId),true);assert.equal(job.budgetId,budgetId);assert.equal(demand.resolvedAt,closure.reopenedAt);
  assert.equal(JSON.stringify(sim.worldDefinition),originalWorld);assert(Math.abs(cash(sim)-before)<1e-5,'actual escrow, material, wages, taxes and refunds conserve all money');
  exact24(sim);
});

function disableWorker(sim: Simulation, actor: typeof sim.state.citizens[number], dead = true) {
  const profile=sim.state.extension!.actorProfiles[actor.id];profile.health=dead ? 0 : 44;if(dead)profile.alive=false;
}

test('incapacity after partial paid work retains earned receipts and requires site pickup before remaining labor',()=>{
  const {sim,job,originalWorker}=setup();until(sim,()=>job.workedMinutes>=8&&job.workedMinutes<60,200);
  const paid=structuredClone(job.laborReceipts),gross=job.paidGross,minutes=job.workedMinutes,escrow=job.escrow,receipt=structuredClone(job.receipts),budget=structuredClone(core(sim).publicBudgets),before=cash(sim);
  disableWorker(sim,originalWorker,false);sim.step(.25);
  assert.equal(job.cancelledAt,null);assert.equal(job.paidGross,gross);assert.equal(job.escrow,escrow);assert.deepEqual(job.laborReceipts,paid);assert.deepEqual(job.receipts,receipt);
  assert.equal(job.replacement!.contracts[0].releaseReason,'incapable');assert.equal(job.replacement!.contracts[0].retainedMaterial!.kind,'worksite');assert.equal(job.reservedUnits,0);
  let picked=false;sim.onEvent('roadwork-presence',event=>{if(!picked&&job.replacement!.pickups.length){picked=true;assert.equal(job.workedMinutes,minutes,'the pickup phase itself cannot perform free remaining work');}});
  until(sim,()=>job.completedAt!==null,400);assert(picked);assert.equal(job.workedMinutes,60);assert.equal(job.receipts.length,1);
  assert.deepEqual(job.laborReceipts.slice(0,paid.length),paid);assert.equal(job.replacement!.contracts.length,2);assert.equal(core(sim).publicBudgets.length,budget.length);
  assert.equal(core(sim).publicBudgets[0].cap,budget[0].cap);assert(Math.abs(cash(sim)-before)<1e-5);exact24(sim);
});

test('no qualified resident waits with the same task, unpaid escrow and physical retained material',()=>{
  const {sim,job,closure,originalWorker}=setup(),escrow=job.escrow,receipt=structuredClone(job.receipts),drop={...originalWorker.position};
  for(const actor of sim.state.citizens) if(['工人','工程师'].includes(actor.role)&&actor.id!==originalWorker.id)disableWorker(sim,actor,false);
  disableWorker(sim,originalWorker);sim.step(.25);const history=structuredClone(job.replacement!.contracts);
  exact24(sim);
  assert.equal(job.status,'awaitingWorker');assert.equal(job.replacement!.activeActorId,null);assert.deepEqual(job.replacement!.contracts,history);assert.equal(job.escrow,escrow);assert.deepEqual(job.receipts,receipt);
  assert.equal(job.paidGross,0);assert.equal(job.workedMinutes,0);assert.equal(job.cancelledAt,null);assert.equal(isRoadOpen(sim.state,closure.edgeId),false);
  assert.deepEqual(sim.state.roadworks!.stock[0].location,{kind:'ground',point:drop});assert.equal(sim.state.roadworks!.stock[0].retained,true);
});

test('a replacement incapacitated before pickup never rewrites the original custodian or retained point',()=>{
  const {sim,job,originalWorker}=setup();disableWorker(sim,originalWorker);sim.step(.25);
  const pending=structuredClone(job.replacement!.pendingPickup),origin=structuredClone(job.replacement!.contracts[0]);
  const replacement=sim.state.citizens.find(c=>c.id===job.replacement!.activeActorId)!;assert(replacement);assert.equal(job.replacement!.pickups.length,0);
  disableWorker(sim,replacement,false);sim.step(.25);
  assert.deepEqual(job.replacement!.pendingPickup,pending);assert.deepEqual(job.replacement!.contracts[0],origin);
  assert.equal(job.replacement!.contracts[1].retainedMaterial,null);assert.equal(job.replacement!.contracts[1].releaseReason,'incapable');
  until(sim,()=>job.completedAt!==null,400);assert.equal(job.receipts.length,1);assert.equal(job.replacement!.pickups[0].fromContractIndex,0);assert.equal(job.replacement!.pickups[0].toContractIndex,2);exact24(sim);
});

test('a real approved finite budget cannot promise unaffordable replacement minutes after current wage changes',()=>{
  const {sim,job,office}=setup(false);assert.equal(job.funded,0);
  // Explicit once-only mayor identity and real office placement fixture. Money,
  // skills, industrial stock and original wage/qualification formula stay real.
  sim.state.player.role='mayor';sim.state.player.identities=['traveler','mayor'];sim.setFocus(workPoint(office),'walk');
  const originalProsperity=sim.state.districts[0].prosperity,rate=32*(.7+originalProsperity/100)/480;
  const supplier=sim.state.shops.find(shop=>sim.shopCommodity(shop)==='materials')!,cap=sim.quoteSupply(supplier.id,1).unitPrice+60*rate+.3;
  const approved=sim.command({type:'approveRoadRepair',targetId:job.id,value:cap});assert.equal(approved.ok,true,approved.message);
  until(sim,()=>job.receivedUnits===1&&job.workedMinutes===0,200);const worker=sim.state.citizens.find(c=>c.id===job.workerId)!;
  until(sim,()=>job.workedMinutes===0&&Math.hypot(worker.position.x-job.supplierPoint!.x,worker.position.z-job.supplierPoint!.z)>3,20);
  disableWorker(sim,worker);sim.state.districts[0].prosperity=100;sim.step(.25);
  const escrow=job.escrow,history=structuredClone(job.replacement!.contracts),purchase=structuredClone(job.receipts);assert(60*32*1.7/480>escrow);
  exact24(sim);assert.equal(job.replacement!.activeActorId,null);assert.deepEqual(job.replacement!.contracts,history);assert.deepEqual(job.receipts,purchase);assert.equal(job.escrow,escrow);assert.equal(job.paidGross,0);assert.equal(job.funded,cap);assert.equal(job.cancelledAt,null);
});

test('public emitEvent forgery and same-phase replay cannot pick up or pay the retained lot',()=>{
  const {sim,job,originalWorker}=setup();disableWorker(sim,originalWorker);sim.step(.25);
  const actorId=job.replacement!.activeActorId!,pending=job.replacement!.pendingPickup!,clock=sim.state.extension!.lastUpdate;
  const forged={type:'roadwork-presence',citizenId:actorId,laborJobId:job.id,nodeId:pending.nodeId,purpose:'pickup',activityWindowStartAt:clock-2,activityWindowEndAt:clock,activityObservedTick:sim.state.tick,activityObservedClock:clock,activityPosition:{...pending.point}};
  const saved=sim.exportSave();sim.emitEvent(forged);assert.equal(sim.exportSave(),saved);
  let replayed=false;sim.onEvent('roadwork-presence',event=>{if(!replayed&&job.replacement!.pickups.length){replayed=true;const once=sim.exportSave();sim.emitEvent(event);sim.emitEvent({...event});assert.equal(sim.exportSave(),once);}});
  until(sim,()=>job.completedAt!==null,400);assert(replayed);assert.equal(job.replacement!.pickups.length,1);assert.equal(job.workedMinutes,60);exact24(sim);
});

test('corrupt crew, source point, replay, wages, module markers and ghost budgets reject atomically',t=>{
  const {sim,job,originalWorker}=setup();disableWorker(sim,originalWorker);sim.step(.25);until(sim,()=>job.workedMinutes>=8,300);
  const saved=sim.exportSave(),changes:((doc:any)=>void)[]=[
    d=>{delete d.state.roadworks.jobs[0].replacement;},d=>{delete d.state.roadworks.replacementVersion;},d=>{d.runtime.roadworksVersion=1;},
    d=>{d.state.roadworks.replacementFirstJobId='invented';},d=>{d.state.roadworks.jobs[0].replacement.activeActorId='invented';},
    d=>{d.state.roadworks.jobs[0].replacement.contracts[0].contract.craft=19;},d=>{d.state.roadworks.jobs[0].replacement.contracts[1].contract.ratePerMinute++;},
    d=>{d.state.roadworks.jobs[0].replacement.contracts[0].releasePosition.x++;},d=>{d.state.roadworks.jobs[0].replacement.contracts[0].retainedMaterial.point.x++;},
    d=>{d.state.roadworks.jobs[0].replacement.pickups[0].point.x++;},d=>{d.state.roadworks.jobs[0].replacement.pickups[0].fromContractIndex=1;},
    d=>{d.state.roadworks.jobs[0].replacement.pickups.push({...d.state.roadworks.jobs[0].replacement.pickups[0]});},d=>{d.state.roadworks.jobs[0].replacement.pickups=[];},
    d=>{d.state.roadworks.jobs[0].laborReceipts[0].actorId='invented';},d=>{d.state.roadworks.jobs[0].laborReceipts[0].gross++;},
    d=>{d.runtime.publicBudgets=d.runtime.publicBudgets.filter((budget:any)=>budget.purpose!=='road-repair');},
    d=>{d.state.roadworks.jobs[0].receipts=[];d.state.roadworks.jobs[0].receivedUnits=0;},d=>{d.state.roadworks.stock[0].quantity=0;},
  ];
  mkdirSync(resolve('artifacts'),{recursive:true});const artifact=mkdtempSync(resolve('artifacts','roadwork-replacement-bad-saves-'));writeFileSync(resolve(artifact,'valid-original.save.json'),saved);const results:object[]=[];t.after(()=>{writeFileSync(resolve(artifact,'actual-results.json'),JSON.stringify(results,null,2)+'\n');});t.diagnostic('ROADWORK_REPLACEMENT_BAD_SAVE_ARTIFACT '+artifact);
  for(const [index,change] of changes.entries()){const broken=JSON.parse(saved);change(broken);const bytes=JSON.stringify(broken);writeFileSync(resolve(artifact,'bad-'+index+'.save.json'),bytes);const result=sim.importSave(bytes);results.push({index,result,unchanged:sim.exportSave()===saved});assert.equal(result.ok,false,'atomic rejection '+index);assert.equal(sim.exportSave(),saved,'rejected save never alters live world '+index);}
  assert.equal(assembleSave(partitionSave(saved,sim.worldDefinition)),saved);exact24(sim);
});


test('cancelling a pending replacement returns only unearned escrow and never restocks the purchased unit',()=>{
  const {sim,job,office,originalWorker}=setup(),purchase=structuredClone(job.receipts),paid=job.paidGross;
  disableWorker(sim,originalWorker);sim.step(.25);const escrow=job.escrow,material=structuredClone(sim.state.roadworks!.stock[0]);
  const source=sim.state.shops.find(shop=>shop.id===job.supplierShopId)!,inventory=source.inventory,before=cash(sim),treasury=sim.state.treasury;
  sim.state.player.role='mayor';sim.state.player.identities=['traveler','mayor'];sim.setFocus(workPoint(office),'walk');
  const result=sim.command({type:'cancelRoadRepair',targetId:job.id});assert.equal(result.ok,true,result.message);
  assert.equal(job.status,'cancelled');assert.equal(job.refunded,escrow);assert.equal(job.escrow,0);assert.equal(sim.state.treasury,treasury+escrow);
  assert.equal(job.paidGross,paid);assert.deepEqual(job.receipts,purchase);assert.deepEqual(sim.state.roadworks!.stock[0],material);assert.equal(source.inventory,inventory);
  assert.equal(job.consumedUnits,0);assert(Math.abs(cash(sim)-before)<1e-5);exact24(sim);
});

test('an original lot inside a marked building remains retained until a lawful interior recovery route exists',()=>{
  const {sim,job,originalWorker}=setup(true,true),point={...originalWorker.position};disableWorker(sim,originalWorker);sim.step(.25);
  assert.equal(job.replacement!.activeActorId,null);assert.equal(job.replacement!.contracts.length,1);assert.equal(job.replacement!.pickups.length,0);const escrow=job.escrow;
  exact24(sim);assert.equal(job.replacement!.activeActorId,null);assert.equal(job.replacement!.pickups.length,0);assert.equal(job.workedMinutes,0);assert.equal(job.escrow,escrow);
  assert.deepEqual(sim.state.roadworks!.stock[0].location,{kind:'ground',point});assert.equal(sim.state.roadworks!.stock[0].retained,true);
});

test('true prior-candidate native version1 carry and death-cancelled originals load immediately and match their24 original future bytes',()=>{
  const base=resolve('tests/fixtures/roadwork-replacement-native-v1'),world=JSON.parse(readFileSync(resolve(base,'world.json'),'utf8'));
  for(const name of ['carry','death-cancelled']){
    const initial=readFileSync(resolve(base,name+'.save.json'),'utf8'),sim=new Simulation(world),result=sim.importSave(initial);assert.equal(result.ok,true,result.message);assert.equal(sim.exportSave(),initial);
    assert.equal(core(sim).roadworksVersion,1);assert.equal(sim.state.roadworks!.replacementVersion,undefined);assert.equal(sim.state.roadworks!.jobs[0].replacement,undefined);
    assert.equal(assembleSave(partitionSave(initial,world)),initial);
    const expected=JSON.parse(readFileSync(resolve(base,'actual-continuation.json'),'utf8')).rows.filter((row:any)=>row.name===name);
    const clone=new Simulation(world);assert(clone.importSave(initial).ok);
    for(const row of expected){sim.step(.25);clone.step(.25);assert.equal(sim.exportSave(),clone.exportSave());assert.equal(sim.state.tick,row.tick);assert.equal(createHash('sha256').update(sim.exportSave()).digest('hex'),row.sha256,'original source every future tick');}
    assert.equal(sim.exportSave(),readFileSync(resolve(base,name+'-after24.save.json'),'utf8'),'original source future24 bytes');
  }
});
