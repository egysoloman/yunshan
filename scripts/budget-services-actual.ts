import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { createArchivedProductCity } from '../src/product-city.ts';
import { isCanonicalNpcWage } from '../src/simulation.ts';
import { upgradeCivicHistoryFormat } from '../src/host/upgrade-civic-history-format.ts';
import { upgradeServiceMaterialScheduling } from '../src/host/upgrade-service-material-scheduling.ts';
import { currentCivicBudgetSignature, validateBudgetSignatureV2, type BudgetSignatureV2 } from '../src/simulation/budget-authority.ts';
import { civicHistoryView } from '../src/simulation/civic-history.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { familyEducationHeldCash } from '../src/simulation/family-education.ts';
import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle.ts';
const out = process.argv[2]; assert.ok(out); mkdirSync(out, { recursive: true });
const maxTicks = Number(process.argv[3] ?? 1100); assert.ok(Number.isInteger(maxTicks) && maxTicks > 0 && maxTicks <= 1100);
const base = new URL('../tests/fixtures/budget-authority/', import.meta.url);
const worldText = readFileSync(new URL('world.json', base), 'utf8'), world = JSON.parse(worldText);
const raw = gunzipSync(readFileSync(new URL('canonical-pair.save.json.gz', base))).toString('utf8');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const record = (name: string, value: unknown) => writeFileSync(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
const city = createArchivedProductCity(world), migrations: unknown[] = [];
assert.equal(city.importSave(raw).ok, true); assert.equal(city.exportSave(), raw);
record('opening-v3.save.json', raw); record('world.json', worldText);
let previous = city.exportSave(), result = await upgradeCivicHistoryFormat(city, hash(previous));
migrations.push({operation:'explicit-original-history-v3-to4', expectedSHA256:hash(previous), beforeSHA256:hash(previous), result, afterSHA256:hash(city.exportSave())});
assert.equal(result.ok, true, result.message); record('opening-history-v4.save.json', city.exportSave());
previous = city.exportSave(); result = await upgradeServiceMaterialScheduling(city, hash(previous));
migrations.push({operation:'explicit-current4-material-policy', expectedSHA256:hash(previous), beforeSHA256:hash(previous), result, afterSHA256:hash(city.exportSave())});
assert.equal(result.ok, true, result.message); record('opening-policy-v4.save.json', city.exportSave()); record('migrations.json', migrations);
const wages: any[] = [], procurement: any[] = [], transitions: any[] = [], preFinance: any[] = [], sourceSignatures: any[] = [], production: any[] = [], upkeep: any[] = [];
const teachers = new Set(city.state.citizens.filter(p => p.workId === 'civic-0-school' && ['老师','teacher'].includes(p.role)).map(p => p.id));
const materialWorkers = new Set(city.state.citizens.filter(p => p.workId === 'civic-0-workshop').map(p => p.id));
let last = '', lastRequests = '';
const moneySupply = () => {
  const s = city.state;
  const e = s.extension!, runtime = Reflect.get(city, 'runtime');
  return s.treasury + runtime.taxes + s.player.money + (s.banking ? s.banking.cash+s.banking.legacyInvestmentCash : s.bankBalance+(runtime.investment??0)) + s.citizens.reduce((sum,p)=>sum+p.money,0)
    + s.shops.filter(shop=>!e.companies.some(c=>c.shopBindingReleasedAt===undefined&&c.buildingId===shop.buildingId)).reduce((sum,shop)=>sum+(shop.cash??0),0)
    + e.companies.reduce((sum,c)=>sum+c.capital,0) + e.organizations.reduce((sum,org)=>sum+org.funds,0)
    + (s.playerLabor?.job?.escrow??0) + (s.roadworks?.jobs.reduce((sum,job)=>sum+job.escrow,0)??0) + (s.education?.course?.escrow??0)
    + familyEducationHeldCash(s) + (s.power?.repairs.reduce((sum,job)=>sum+job.escrow,0)??0) + (s.clinical?.orders.reduce((sum,order)=>sum+order.escrow,0)??0)
    + shopLifecycleHeldCash(s) + (s.hygiene?.jobs.reduce((sum,job)=>sum+job.escrow,0)??0) + (s.hygiene?.transfers?.tasks.reduce((sum,task)=>sum+task.escrow,0)??0)
    + (s.family?.pregnancies.reduce((sum,pregnancy)=>sum+pregnancy.escrow,0)??0) + (s.family?.households?.reduce((sum,household)=>sum+household.balance,0)??0);
};
const initialMoney = moneySupply();
city.onEvent('wage-earned', e => { if (isCanonicalNpcWage(e) && (teachers.has(e.citizenId!) || materialWorkers.has(e.citizenId!) || e.siteId === 'civic-0-hall')) wages.push({tick:city.state.tick,clock:city.state.extension!.lastUpdate,canonical:true,event:structuredClone(e)}); });
city.onEvent('wage-paid', e => { if (teachers.has(e.citizenId!) || materialWorkers.has(e.citizenId!)) wages.push({tick:city.state.tick,clock:city.state.extension!.lastUpdate,event:structuredClone(e)}); });
city.onEvent('production', e => { if(e.shopId==='shop-civic-0-workshop')production.push({tick:city.state.tick,clock:city.state.extension!.lastUpdate,event:structuredClone(e)}); });
city.onEvent('municipal-operation-accrual', e => upkeep.push({kind:'UNCHANGED_OPERATION_REQUIREMENT',tick:city.state.tick,clock:city.state.extension!.lastUpdate,event:structuredClone(e)}));
city.onEvent('public-procurement', e => upkeep.push({kind:'ACTUAL_REMAINING_STOCK_UPKEEP_PURCHASE',tick:city.state.tick,clock:city.state.extension!.lastUpdate,event:structuredClone(e)}));
city.onEvent('civic-procurement', e => {
  const shop = city.state.shops.find(s=>s.id===e.shopId)!;
  procurement.push({tick:city.state.tick,clock:city.state.extension!.lastUpdate,event:structuredClone(e),treasuryAfter:city.state.treasury,
    supplierStockAfter:shop.inventory,supplierCashAfter:city.shopFunds(shop),supplierProtectedCash:city.shopProtectedFunds(shop),budgetSnapshot:city.publicBudgetSnapshot()});
});
city.onPhase('commerce', () => {
  const shop = city.state.shops.find(s=>s.id==='shop-civic-0-workshop')!;
  if (shop.inventory > 1e-7) preFinance.push({tick:city.state.tick,clock:city.state.extension!.lastUpdate,inventory:shop.inventory,quote:city.quoteSupply(shop.id,6),cash:city.shopFunds(shop),protectedCash:city.shopProtectedFunds(shop),treasury:city.state.treasury});
});
city.onPhase('finance', () => {
  for(const request of city.state.culture!.supplementalBudgets?.requests ?? []) if(request.approvedAt === null) {
    const paid = city.state.civicStaffing!.terms.filter(t=>t.officeId==='civic-0-hall').map(t=>currentCivicBudgetSignature(city,t.actorId)).filter(Boolean);
    if(paid.length>=2) sourceSignatures.push({tick:city.state.tick,clock:city.state.extension!.lastUpdate,requestId:request.id,actualCurrentPaid:structuredClone(paid)});
  }
});
const snapshot = () => ({tick:city.state.tick,clock:city.state.extension!.lastUpdate,treasury:city.state.treasury,budget:city.publicBudgetSnapshot(),publicSupply:Reflect.get(city,'runtime').publicSupply,
  order:structuredClone(city.state.culture!.orders[0]),requests:structuredClone(city.state.culture!.supplementalBudgets),materials:city.state.shops.filter(s=>city.shopCommodity(s)==='materials').map(s=>({id:s.id,inventory:s.inventory,quote:city.quoteSupply(s.id,6),cash:city.shopFunds(s),protectedCash:city.shopProtectedFunds(s)}))});
const flush = () => {record('trace-wages.json',wages);record('trace-procurement.json',procurement);record('trace-transitions.json',transitions);record('trace-pre-finance.json',preFinance);record('trace-current-paid-sources.json',sourceSignatures);record('trace-material-production.json',production);record('trace-upkeep.json',upkeep);record('frontier.save.json',city.exportSave());record('frontier.summary.json',snapshot());};
try {
  for(let i=0;i<maxTicks;i++) {
    city.step(.25);
    const order=city.state.culture!.orders[0],requests=city.state.culture!.supplementalBudgets?.requests??[];
    const key=JSON.stringify({state:order.state,baseSpent:order.spent,received:order.receivedUnits,consumed:order.consumedUnits,served:order.servedIds,requests:requests.map(r=>({id:r.id,approvedAt:r.approvedAt,spent:r.spent,closedAt:r.closedAt}))});
    if(key!==last){last=key;transitions.push(snapshot());}
    const requestKey=JSON.stringify(requests.map(r=>({id:r.id,approvedAt:r.approvedAt})));
    if(requestKey!==lastRequests){lastRequests=requestKey;record(`request-frontier-tick${city.state.tick}.save.json`,city.exportSave());}
    if(i%100===0){flush();console.log(JSON.stringify({scope:'actual-policy-continuation',iteration:i,...snapshot()}));}
    const teacherIds=new Set(Object.values(city.state.family?.formalLearning??{}).flatMap(record=>record.receipts.filter(receipt=>receipt.orderId===order.id).map(receipt=>receipt.teacherId)));
    const paidTeacher=wages.some(row=>row.event.type==='wage-paid'&&teacherIds.has(row.event.citizenId)&&row.event.amount>0);
    if(order.state==='fulfilled'&&requests.some(r=>r.signatureVersion===2&&r.spent>0)&&paidTeacher)break;
  }
  flush(); const order=city.state.culture!.orders[0],requests=city.state.culture!.supplementalBudgets?.requests??[];
  assert.equal(order.authorizedCap,40); assert.ok(Math.abs(order.spent-40)<1e-6,'original finite40 must actually exhaust');
  assert.ok(requests.some(r=>r.signatureVersion===2&&r.approvedAt!==null&&r.spent>0),'actual quoted V2 request must authorize and fund real finite procurement');
  assert.equal(order.state,'fulfilled','all original six service units must really complete');assert.equal(order.consumedUnits,6);assert.equal(order.servedIds.length,6);
  for(const request of requests.filter(r=>r.approvedAt!==null))for(const signature of request.signatures as BudgetSignatureV2[]){assert.doesNotThrow(()=>validateBudgetSignatureV2(city.state,world,signature,Reflect.get(city,'runtime'),request.approvedAt!));}
  const learning=Object.entries(city.state.family!.formalLearning??{}).flatMap(([actorId,record])=>record.receipts.filter(r=>r.orderId===order.id).map(receipt=>({actorId,receipt})));
  assert.equal(learning.length,6);assert.ok(learning.every(r=>r.receipt.minutes===60&&teachers.has(r.receipt.teacherId)));
  const teacherIds=new Set(learning.map(r=>r.receipt.teacherId));
  assert.ok(wages.some(row=>row.event.type==='wage-paid'&&teacherIds.has(row.event.citizenId)&&row.event.amount>0),'actual completing teacher must receive real wages');
  assert.ok(wages.some(row=>row.canonical&&teacherIds.has(row.event.citizenId)&&row.event.minutes>0),'current teacher attendance must be core certified');
  const residual=initialMoney-moneySupply(); assert.ok(Math.abs(residual)<1e-6,`actual cash conservation ${residual}`);
  const producedUnits=production.reduce((sum,row)=>sum+row.event.amount,0),procuredUnits=procurement.reduce((sum,row)=>sum+row.event.quantity,0);
  assert.ok(procuredUnits<=producedUnits+1e-6,'original opening material stock is zero; service purchases cannot exceed actual new production');
  const saved=city.exportSave(),full=createArchivedProductCity(world),partition=createArchivedProductCity(world),parts=partitionSave(saved,world);
  assert.equal(full.importSave(saved).ok,true);assert.equal(full.exportSave(),saved);assert.equal(partition.importSave(assembleSave(parts)).ok,true);assert.equal(partition.exportSave(),saved);
  const fullPartition24=[];
  for(let tick=0;tick<24;tick++){city.step(.25);full.step(.25);partition.step(.25);assert.equal(full.exportSave(),city.exportSave());assert.equal(partition.exportSave(),city.exportSave());fullPartition24.push({tick:tick+1,sha256:hash(city.exportSave())});}
  record('complete-service.save.json',saved);record('complete-service.after24.save.json',city.exportSave());record('full-partition24.json',{parts:parts.length,ticks:fullPartition24});
  const history=civicHistoryView(city.state);
  record('PASS-summary.json',{status:'PASS_ACTUAL_FUNDED_V2_EDUCATION_CONSUMER',scope:'DECLARED_COMPACT_PRECONSTRUCTOR_WORLD_EXISTING_ACTUAL_SOURCE_CONTINUATION',migrations,order,requests,learning,initialMoneySupply:initialMoney,finalMoneySupply:moneySupply(),moneyConservationResidual:residual,
    sourceSignatures,materialSource:{originalStock:0,actualProducedUnits:producedUnits,actualServiceProcuredUnits:procuredUnits},actualCanonicalTeacherMinutes:wages.filter(row=>row.canonical&&teacherIds.has(row.event.citizenId)).reduce((sum,row)=>sum+row.event.minutes,0),actualTeacherPayments:wages.filter(row=>row.event.type==='wage-paid'&&teacherIds.has(row.event.citizenId)),historyTotals:{proofs:history.proofs.length,applications:history.applications.length,polls:history.polls.length,terms:history.terms.length},completeSHA256:hash(saved),after24SHA256:hash(city.exportSave()),wholePartitionFuture24Exact:true});
  console.log(JSON.stringify({status:'PASS_ACTUAL_FUNDED_V2_EDUCATION_CONSUMER',tick:city.state.tick,clock:city.state.extension!.lastUpdate,served:learning.length,supplementalSpent:requests.reduce((sum,r)=>sum+r.spent,0),wholePartitionFuture24Exact:true}));
} catch(error) {flush();record('FAIL-summary.json',{status:'FAIL_ACTUAL_CONSUMER',error:String(error),frontier:snapshot(),cashResidual:initialMoney-moneySupply()});throw error;}
