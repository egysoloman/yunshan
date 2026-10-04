import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation.ts';
import { roadworkTask, roadworksStatus } from '../src/simulation/roadworks.ts';
import { roadClosure, isRoadOpen } from '../src/roads.ts';
import { roadworksWorld, setupRoadworks, request, cash, exact24, until, publicContext } from './roadworks-fixture.ts';
import { core } from './power-fixture.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';

// The original root23 failures remain in their immutable run directories.
// Artifact observers below never modify a resident, clock, route, or account.
test('untouched old world has no empty roadworks body or marker and saves exactly',()=>{
  const sim=new Simulation(roadworksWorld());assert.equal(sim.state.roadworks,undefined);assert.equal(core(sim).roadworksVersion,undefined);exact24(sim);
});
test('canonical closed road order conserves actual escrow and refuses duplicate/remote/forged presence',()=>{
  const context=setupRoadworks(),{sim,closure}=context, before=cash(sim);
  const job=request(context);assert.ok(Math.abs(cash(sim)-before)<1e-6);
  const saved=sim.exportSave();assert.equal(sim.command({type:'requestRoadRepair',targetId:closure.edgeId}).ok,false);assert.equal(sim.exportSave(),saved);
  sim.emitEvent({type:'roadwork-presence',citizenId:job.workerId??undefined,laborJobId:job.id,nodeId:job.worksiteNodeId,activityWindowStartAt:sim.state.extension!.lastUpdate-2,activityWindowEndAt:sim.state.extension!.lastUpdate,activityObservedTick:sim.state.tick,activityObservedClock:sim.state.extension!.lastUpdate,activityPosition:job.worksite});
  assert.equal(sim.exportSave(),saved,'manually broadcast site data is not canonical native arrival');assert.equal(isRoadOpen(sim.state,closure.edgeId),false);exact24(sim);
});
test('native worker physically picks one original material, carries it on open roads and earns60minutes before reopen',t=>{
  const context=setupRoadworks(),{sim,closure}=context;
  const artifactRoot=resolve('artifacts');mkdirSync(artifactRoot,{recursive:true});
  const artifact=mkdtempSync(resolve(artifactRoot,'roadwork-lifecycle-'));
  const hashes=Object.fromEntries(['src/simulation.ts','src/simulation/roadworks.ts','src/simulation/banking.ts','src/roads.ts','tests/roadworks-fixture.ts','tests/roadworks.test.ts'].map(name=>[name,createHash('sha256').update(readFileSync(resolve(name))).digest('hex')]));
  writeFileSync(resolve(artifact,'observed-inputs.json'),JSON.stringify(hashes,null,2)+'\n');
  const save=(name:string,source=sim)=>writeFileSync(resolve(artifact,name+'.json'),source.exportSave());
  const trace: Record<string,unknown>[]=[];
  let pickedUp=false,started=false,midpoint=false,completed=false;
  const wageEvents: Record<string,unknown>[]=[];sim.onEvent('roadwork-wage-paid',e=>wageEvents.push(structuredClone(e)));
  t.after(()=>{writeFileSync(resolve(artifact,'stage-trace.json'),JSON.stringify(trace,null,2)+'\n');writeFileSync(resolve(artifact,'actual-payment-events.json'),JSON.stringify(wageEvents,null,2)+'\n');save('final-observed');});
  t.diagnostic('ROADWORK_LIFECYCLE_ARTIFACT '+artifact);
  const job=request(context);assert.ok(job.workerId,'fixture has a real willing original qualified worker');
  save('request');
  sim.onPhase('feedback',()=>{
    const stock=sim.state.roadworks!.stock.find(row=>row.jobId===job.id),actualWorker=sim.state.citizens.find(c=>c.id===job.workerId);
    trace.push({tick:sim.state.tick,clock:sim.state.extension!.lastUpdate,status:job.status,workerId:job.workerId,workerPosition:actualWorker?{...actualWorker.position}:null,
      stage:stock?.location.kind??'unbought',materialStage:roadworksStatus(sim.state,closure.edgeId).materialStage,received:job.receivedUnits,consumed:job.consumedUnits,
      minutes:job.workedMinutes,escrow:job.escrow,purchasePaid:job.purchasePaid,paidGross:job.paidGross,paidNet:job.paidNet,paidTax:job.paidTax,refunded:job.refunded,cash:cash(sim),revision:sim.state.roadNetwork!.revision});
    if(!pickedUp&&job.receivedUnits===1){pickedUp=true;save('pickup');}
    if(!started&&job.workedMinutes>0){started=true;save('work-start');}
    if(!midpoint&&job.workedMinutes>=23){midpoint=true;save('work-mid-first-at-least23');}
    if(!completed&&job.completedAt!==null){completed=true;save('complete');}
  });
  const observeClone=(scope:string)=>(name:string,live:Simulation,clone?:Simulation)=>{
    if(name==='before-clone'){
      const saved=live.exportSave(),parts=partitionSave(saved,live.worldDefinition);
      writeFileSync(resolve(artifact,scope+'-parts.json'),JSON.stringify(parts,null,2)+'\n');
      writeFileSync(resolve(artifact,scope+'-assembled.json'),assembleSave(parts));
    }
    if(name==='before-clone'||name==='after-import'||name==='tick24')save(scope+'-'+name+'-live',live);
    if(clone&&(name==='after-import'||name==='tick24'))save(scope+'-'+name+'-clone',clone);
    if(clone&&live.exportSave()!==clone.exportSave()) {save(scope+'-first-different-'+name+'-live',live);save(scope+'-first-different-'+name+'-clone',clone);}
  };
  const worker=sim.state.citizens.find(c=>c.id===job.workerId)!, primary={role:worker.role,workId:worker.workId,homeId:worker.homeId};
  const routeSites=['power-1','power-2'], closedDistance=sim.buildingTravelDistance(routeSites[0],routeSites[1]);assert.ok(closedDistance>context.openDistance,'actual river road closure invalidates the primed route tree and uses the dry detour');
  assert.equal(job.receivedUnits,0);assert.equal(job.workedMinutes,0);assert.equal(roadworkTask(sim,job.workerId!)!.stage,'pickup');
  until(sim,()=>job.receivedUnits===1);
  assert.equal(job.receipts.length,1);assert.equal(job.receipts[0].workerId,job.workerId);assert.equal(job.workedMinutes,0,'buying at supplier cannot remotely labor');
  assert.equal(roadworkTask(sim,job.workerId!)!.stage,'worksite');assert.equal(roadworksStatus(sim.state,closure.edgeId).materialStage,'carried');
  exact24(sim,observeClone('carried'));save('carried-plus24');until(sim,()=>job.status==='completed');
  assert.equal(job.requiredMinutes,60);assert.equal(job.workedMinutes,60);assert.equal(job.consumedUnits,1);assert.equal(job.escrow,0);
  assert.ok(job.completedAt!>=job.startedAt+60);assert.ok(Math.abs(job.paidGross-60*job.ratePerMinute)<1e-7);assert.ok(Math.abs(job.paidNet+job.paidTax-job.paidGross)<1e-7);
  assert.ok(Math.abs(job.purchasePaid+job.paidGross+job.refunded-100)<1e-7);assert.equal(job.serviceFees,0);
  assert.equal(isRoadOpen(sim.state,closure.edgeId),true);assert.equal(sim.state.roadNetwork!.closures.find(c=>c.id===closure.id)!.repairedBy,job.id);
  assert.deepEqual({role:worker.role,workId:worker.workId,homeId:worker.homeId},primary);
  assert.equal(sim.buildingTravelDistance(routeSites[0],routeSites[1]),context.openDistance,'same closed cached query restores original short distance after genuine paid repair revision');
  assert.ok(job.laborReceipts.some(row=>row.paymentCount>1),'consecutive actual payments coalesce without losing their total');
  assert.equal(wageEvents.length,job.laborReceipts.reduce((sum,row)=>sum+row.paymentCount,0));
  assert.ok(Math.abs(wageEvents.reduce((sum,e)=>sum+Number(e.amount),0)-job.paidGross)<1e-7);
  assert.ok(Math.abs(wageEvents.reduce((sum,e)=>sum+Number(e.minutes),0)-60)<1e-7);
  t.diagnostic('ORIGINAL_ROADWORK_PAYMENT_EVENTS '+JSON.stringify(wageEvents));save('reopened-before-clone');exact24(sim,observeClone('reopened'));save('reopened-plus24');
});
test('unbought cancellation returns actual100 without inventing receipts, wages or reopening',()=>{
  const context=setupRoadworks(),{sim,closure}=context,money=sim.state.player.money, before=cash(sim),job=request(context);
  assert.equal(sim.command({type:'cancelRoadRepair',targetId:job.id}).ok,true);
  assert.equal(sim.state.player.money,money);assert.equal(job.refunded,100);assert.equal(job.receipts.length,0);assert.equal(job.paidGross,0);
  assert.equal(cash(sim),before);assert.equal(roadClosure(sim.state,closure.edgeId)?.id,closure.id);exact24(sim);
});
test('partial paid cancellation keeps old wages and a real retained material at its actual location',()=>{
  const context=setupRoadworks(),{sim,closure}=context,job=request(context);until(sim,()=>job.workedMinutes>0&&job.workedMinutes<60);
  const paid=job.paidGross,receipt=structuredClone(job.receipts), before=cash(sim);
  assert.equal(sim.command({type:'cancelRoadRepair',targetId:job.id}).ok,true);
  assert.equal(job.paidGross,paid);assert.deepEqual(job.receipts,receipt);assert.equal(job.consumedUnits,0);assert.equal(job.status,'cancelled');
  assert.equal(sim.state.roadworks!.stock.find(l=>l.jobId===job.id)!.quantity,1);assert.equal(sim.state.roadworks!.stock.find(l=>l.jobId===job.id)!.retained,true);
  assert.ok(Math.abs(cash(sim)-before)<1e-6);assert.equal(isRoadOpen(sim.state,closure.edgeId),false);exact24(sim);
});
test('new module, escrow, custody, road target and actual wage receipts cannot be deleted or forged',()=>{
  const context=setupRoadworks(),{sim}=context,job=request(context);until(sim,()=>job.workedMinutes>0);
  const saved=sim.exportSave();
  const changes=[(s:any)=>{delete s.state.roadworks;},(s:any)=>{delete s.runtime.roadworksVersion;},(s:any)=>{s.state.roadworks.jobs[0].escrow+=1;},(s:any)=>{s.state.roadworks.stock=[];},(s:any)=>{s.state.roadworks.jobs[0].worksiteNodeId='absent';},(s:any)=>{s.state.roadworks.jobs[0].laborReceipts[0].point.x+=20;},(s:any)=>{s.state.roadworks.jobs[0].laborReceipts[0].minutes+=1;},(s:any)=>{s.state.roadworks.jobs[0].contributions={};}];
  for(const change of changes){const broken=JSON.parse(saved);change(broken);assert.equal(sim.importSave(JSON.stringify(broken)).ok,false);assert.equal(sim.exportSave(),saved);}
});

test('public request waits for two real paid original-office signatures and draws only40 protected cash',()=>{
  const context=publicContext(), {sim,closure,staff}=context, wallet=sim.state.player.money, before=cash(sim), treasury=sim.state.treasury;
  const result=sim.command({type:'requestRoadRepair',targetId:closure.edgeId,value:1});assert.equal(result.ok,true,result.message);
  const job=roadworksStatus(sim.state,closure.edgeId).job!;assert.equal(job.funded,0);assert.equal(job.escrow,0);assert.equal(sim.state.player.money,wallet);assert.equal(cash(sim),before);
  let genuineWages=0;sim.onEvent('wage-earned',e=>{if(staff.some(c=>c.id===e.citizenId)&&e.siteId===context.site.id)genuineWages++;});
  const startTick=sim.state.tick,flow={publicWages:0,procurement:0,directIncome:0,remittedTaxes:0};
  let queuedTax=0,financeTax=0;
  // Observe the actual source transactions. A lawful new resident filing fee
  // is income, so treasury's net delta need not equal this one protected40.
  sim.onEvent('wage-paid',e=>{const gross=e.amount??0;if(!e.shopId)flow.publicWages+=gross;if(sim.state.lastSystemOrder.at(-1)==='finance')financeTax+=gross*sim.state.taxRate;});
  for(const type of ['public-procurement','security-procurement','medical-procurement','emergency-procurement','civic-procurement'])sim.onEvent(type,e=>{flow.procurement+=e.amount??0;if(sim.state.lastSystemOrder.at(-1)==='finance')financeTax+=(e.amount??0)*sim.state.taxRate;});
  for(const type of ['business-expense','transit-fare'])sim.onEvent(type,e=>{flow.directIncome+=e.amount??0;});
  sim.onPhase('commerce',()=>{queuedTax=core(sim).taxes;financeTax=0;});
  sim.onPhase('finance',()=>{flow.remittedTaxes+=queuedTax+financeTax-core(sim).taxes;});
  until(sim,()=>job.approvedAt!==null,20);
  assert.ok(genuineWages>=2,'the original people phase produces real office duty, not seeded payroll');
  assert.deepEqual([...job.approvedBy].sort(),staff.map(c=>c.id).sort());assert.equal(job.authorizedCap,40);assert.equal(job.funded,40);assert.equal(job.escrow,40);
  const budget=core(sim).publicBudgets.find((b:any)=>b.id===job.id);assert.equal(budget.spent,40);assert.equal(budget.closedAt,null);
  assert.ok(sim.state.extension!.publicLedger.some(row=>row.account==='public'&&row.amount===-40&&row.purpose.includes('道路')));
  const entries=sim.state.extension!.publicLedger.filter(row=>row.account==='public'&&row.tick>startTick);
  const roadTransfers=entries.filter(row=>row.purpose==='道路修复授权资金真实划入工地托管');assert.equal(roadTransfers.length,1);assert.equal(roadTransfers[0].amount,-40);
  const income=entries.filter(row=>row.amount>0).reduce((sum,row)=>sum+row.amount,0),ledgerNet=entries.reduce((sum,row)=>sum+row.amount,0);
  for(const fee of entries.filter(row=>row.purpose==='居民公共请愿备案费')){const petition=sim.state.culture!.petitions.find(p=>p.authorId===fee.actorId&&p.residentOrigin&&p.filedAt>context.closure.occurredAt);assert(petition?.residentOrigin);assert.equal(fee.amount,10);assert.equal(petition.residentOrigin.feePaid,10);assert.equal(petition.residentOrigin.moneyBefore-petition.residentOrigin.moneyAfter,10);}
  const expectedTreasury=treasury+ledgerNet+flow.directIncome+flow.remittedTaxes-flow.procurement-flow.publicWages;
  assert.ok(Math.abs(sim.state.treasury-expectedTreasury)<1e-6,'every actual public income, tax, wage, procurement and protected40 reconciles');
  assert.ok(Math.abs(cash(sim)-before)<1e-6);assert.ok(sim.state.treasury<=treasury+income+flow.directIncome+flow.remittedTaxes-40+1e-7,'protected40 cannot be skipped or invented when a real filing fee enters treasury');
  const legal=sim.exportSave();
  for(const change of [(s:any)=>{delete s.state.roadworks;},(s:any)=>{s.runtime.publicBudgets.find((b:any)=>b.id===job.id).spent=0;},(s:any)=>{s.runtime.publicBudgets=s.runtime.publicBudgets.filter((b:any)=>b.id!==job.id);},(s:any)=>{s.state.roadworks.jobs[0].approvedBy=['player'];}]) { const broken=JSON.parse(legal);change(broken);assert.equal(sim.importSave(JSON.stringify(broken)).ok,false);assert.equal(sim.exportSave(),legal); }
  exact24(sim);const escrow=job.escrow,spent=budget.spent,oldCash=cash(sim),oldTreasury=sim.state.treasury;
  assert.equal(sim.command({type:'cancelRoadRepair',targetId:job.id}).ok,true);assert.equal(job.refunded,escrow);assert.equal(job.escrow,0);assert.equal(budget.spent,spent-escrow);assert.notEqual(budget.closedAt,null);
  assert.equal(sim.state.treasury,oldTreasury+escrow);assert.ok(Math.abs(cash(sim)-oldCash)<1e-6);exact24(sim);
});
test('mayor cannot reserve public repair money already promised to wages, operations or another legal budget',()=>{
  const context=setupRoadworks(), {sim,closure}=context;
  sim.state.player.role='mayor';sim.state.player.identities=[...new Set([...(sim.state.player.identities??[]),'mayor' as const])];
  assert.equal(sim.command({type:'requestRoadRepair',targetId:closure.edgeId,value:1}).ok,true);const job=roadworksStatus(sim.state,closure.edgeId).job!;
  const site=sim.worldDefinition.buildings.find(b=>b.kind==='hall')!,point=sim.worldDefinition.buildings.find(b=>b.id===site.id)!;
  sim.setFocus({x:point.position.x,y:point.position.y+.6,z:point.position.z+1.2},'walk');
  const available=sim.publicBudgetSnapshot().available;assert.ok(available>40);
  assert.equal(sim.authorizePublicBudget({id:'protected-road-test',siteId:site.id,purpose:'existing-contract',cap:available-20,approvedAt:sim.state.extension!.lastUpdate,approvedBy:['player']}),true);
  assert.ok(Math.abs(sim.publicBudgetSnapshot().available-20)<1e-7);assert.ok(sim.publicBudgetSnapshot().reserve>0);
  const saved=sim.exportSave(),old=cash(sim);assert.equal(sim.command({type:'approveRoadRepair',targetId:job.id,value:40}).ok,false);assert.equal(sim.exportSave(),saved);assert.equal(cash(sim),old);
});
test('a completed physical repair reopens despite a capped refund receiver and keeps its money obligation',()=>{
  const context=setupRoadworks(),{sim,closure}=context,job=request(context);until(sim,()=>job.workedMinutes>=58&&job.workedMinutes<60);
  // Explicit receiver-cap boundary fixture, not an economic city or created
  // capital proof. Capture the cash AFTER this schema-valid cap manipulation.
  sim.state.player.money=1e9;const before=cash(sim);until(sim,()=>job.completedAt!==null);
  assert.equal(job.status,'refundPending');assert.ok(job.escrow>0);assert.equal(job.workedMinutes,60);assert.equal(job.consumedUnits,1);assert.equal(isRoadOpen(sim.state,closure.edgeId),true);
  assert.ok(Math.abs(cash(sim)-before)<1e-6);const pending=job.escrow,complete=job.completedAt;exact24(sim);assert.equal(job.escrow,pending);assert.equal(job.completedAt,complete);
  const bankSite=sim.worldDefinition.buildings.find(b=>b.kind==='bank')!;
  // Explicit one-time native bank counter transaction placement; this proves
  // refund accounting, not a player walking journey. The command issues its
  // genuine deposit receipt/claim instead of manually editing a bank pool.
  sim.setFocus(bankSite.door,'walk');const cashBefore=cash(sim);
  const deposit=sim.command({type:'deposit',targetId:bankSite.id,value:pending});assert.equal(deposit.ok,true,deposit.message);assert.ok(Math.abs(cash(sim)-cashBefore)<1e-6);sim.step(.25);assert.equal(job.status,'completed');assert.equal(job.escrow,0);assert.equal(job.refunded,pending);assert.equal(job.completedAt,complete);assert.ok(Math.abs(cash(sim)-cashBefore)<1e-6);exact24(sim);
});
test('death of the actual carrier preserves purchased material and prior paid wages rather than making a new worker',()=>{
  const context=setupRoadworks(),{sim,closure}=context,job=request(context);until(sim,()=>job.workedMinutes>0&&job.workedMinutes<60);
  const worker=sim.state.citizens.find(c=>c.id===job.workerId)!, profile=sim.state.extension!.actorProfiles[worker.id],oldGross=job.paidGross,oldReceipt=structuredClone(job.receipts),before=cash(sim);
  // One explicit mortality boundary fixture; no fake source disaster/role/cash,
  // and this is not claimed to be natural mortality during a default city run.
  profile.health=0;profile.alive=false;sim.step(.25);
  assert.equal(job.status,'cancelled');assert.equal(job.workerId,worker.id);assert.equal(job.paidGross,oldGross);assert.deepEqual(job.receipts,oldReceipt);assert.equal(job.consumedUnits,0);
  const material=sim.state.roadworks!.stock.find(l=>l.jobId===job.id)!;assert.equal(material.quantity,1);assert.equal(material.retained,true);assert.equal(isRoadOpen(sim.state,closure.edgeId),false);
  assert.ok(Math.abs(cash(sim)-before)<1e-6);exact24(sim);
});

test('original remote warehouse shortage never credits material or onsite wages and retains cancellation rights',t=>{
  const context=setupRoadworks(false),{sim,closure}=context,job=request(context);assert.ok(job.workerId);
  const artifactRoot=resolve('artifacts');mkdirSync(artifactRoot,{recursive:true});const artifact=mkdtempSync(resolve(artifactRoot,'roadwork-remote-scarcity-'));
  const save=(name:string)=>writeFileSync(resolve(artifact,name+'.json'),sim.exportSave());save('request');
  const procurementEvents: Record<string,unknown>[]=[];
  t.after(()=>{save('final-observed');writeFileSync(resolve(artifact,'actual-procurement-events.json'),JSON.stringify(procurementEvents,null,2)+'\n');});t.diagnostic('ROADWORK_SCARCITY_ARTIFACT '+artifact);
  const supplier=sim.state.shops.find(s=>s.id===job.supplierShopId)!;assert.equal(supplier.buildingId,'power-11');
  const actualInitial=supplier.inventory;assert.ok(actualInitial>=1);let receivedByOrdinaryProcurement=0;
  for(const type of ['public-procurement','security-procurement','emergency-procurement','civic-procurement','medical-procurement'])sim.onEvent(type,e=>{if(e.shopId===supplier.id){receivedByOrdinaryProcurement+=e.quantity??0;procurementEvents.push(structuredClone(e));}});
  until(sim,()=>supplier.inventory<1,120);save('material-depleted');assert.ok(receivedByOrdinaryProcurement>actualInitial-1,'original funded supply competition actually consumes the finite warehouse goods');
  const worker=sim.state.citizens.find(c=>c.id===job.workerId)!;until(sim,()=>Math.hypot(worker.position.x-job.supplierPoint!.x,worker.position.y-job.supplierPoint!.y,worker.position.z-job.supplierPoint!.z)<.05,120);save('actual-supplier-arrival');
  assert.equal(job.receivedUnits,0);assert.equal(job.receipts.length,0);assert.equal(job.paidGross,0);assert.equal(job.workedMinutes,0);assert.equal(job.escrow,100);assert.equal(isRoadOpen(sim.state,closure.edgeId),false);exact24(sim);
  const before=cash(sim);assert.equal(sim.command({type:'cancelRoadRepair',targetId:job.id}).ok,true);save('cancelled');assert.equal(job.refunded,100);assert.equal(job.status,'cancelled');assert.ok(Math.abs(cash(sim)-before)<1e-6);exact24(sim);save('cancelled-plus24');
});
