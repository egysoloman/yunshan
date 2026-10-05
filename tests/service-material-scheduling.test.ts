import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createArchivedProductCity, createCurrentProductCity, createProductCity } from '../src/product-city.ts';
import { Simulation } from '../src/simulation.ts';
import { upgradeServiceMaterialScheduling } from '../src/host/upgrade-service-material-scheduling.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { civicFixtureWorld } from './civic-staffing-fixture.ts';
import { proposeSupplementalBudget, validateSupplementalBudgetState } from '../src/simulation/supplemental-budget.ts';
import { SERVICE_MATERIAL_POLICY, serviceMaterialOfferAvailable, validateServiceMaterialSchedulingEnvelope } from '../src/simulation/service-material-scheduling.ts';
import { hasCityRulesetDeclaration } from '../src/simulation/city-ruleset.ts';
import type { ServiceOrder } from '../src/simulation/culture.ts';
import type { SimState, WorldDefinition } from '../src/types.ts';
import { fixture as educationWorld } from './education-fixture.ts';
import { selectSavedWorld } from '../src/persistence/world-layout.ts';
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const stripPolicy = (raw: string) => {
  const d = JSON.parse(raw); delete d.state.serviceMaterialScheduling; delete d.runtime.serviceMaterialSchedulingVersion;
  d.runtime.persistedModules = d.runtime.persistedModules.filter((name: string) => name !== 'serviceMaterialScheduling');
  return JSON.stringify(d);
};
test('new scheduling wakes a partially fulfilled active service whose last usable material was consumed', () => {
  // Pure retry predicate regression; this fixture grants no patient, wage,
  // funds or material and is not actual service fulfillment evidence.
  const state = { serviceMaterialScheduling: { version: 1, policyId: SERVICE_MATERIAL_POLICY, enablementId: 'fixture' },
    civicStaffing: { version: 2, enablement: { id: 'fixture' } }, civicHistory: { version: 1 },
    shops: [{ id: 'supplier', inventory: .1 }] } as unknown as SimState;
  const sim = { state, shopCommodity: () => 'materials', quoteSupply: () => ({ quantity: .1, unitPrice: 4 }) } as unknown as Simulation;
  const order = { state: 'active', approvedAt: 1440, targetUnits: 6, receivedUnits: 1, consumedUnits: 1, retryAt: 1540 } as ServiceOrder;
  assert.equal(serviceMaterialOfferAvailable(sim, { ...order, topic: 'health' }), true);
  assert.equal(serviceMaterialOfferAvailable(sim, { ...order, topic: 'education', receivedUnits: 1.8 }), true);
  for (const changes of [{ receivedUnits: 2 }, { state: 'awaitingBudget' }, { approvedAt: null }, { topic: 'transport' },
    { state: 'fulfilled' }, { receivedUnits: 6 }]) {
    assert.equal(serviceMaterialOfferAvailable(sim, { ...order, topic: 'health', ...changes } as ServiceOrder), false);
  }
  assert.equal(serviceMaterialOfferAvailable(sim, { ...order, topic: 'health', state: 'awaitingSupply' }), true);
  delete state.serviceMaterialScheduling;
  assert.equal(serviceMaterialOfferAvailable(sim, { ...order, topic: 'health' }), false);
});
test('supplier wake observes only positive finite stock and quotes, without changing them', () => {
  const state = { serviceMaterialScheduling: { version: 1, policyId: SERVICE_MATERIAL_POLICY, enablementId: 'fixture' },
    civicStaffing: { version: 2, enablement: { id: 'fixture' } }, civicHistory: { version: 1 },
    shops: [{ id: 'supplier', inventory: .1 }] } as unknown as SimState;
  const order = { topic: 'health', state: 'awaitingSupply', approvedAt: 1440, targetUnits: 6, receivedUnits: 1, consumedUnits: 1 } as ServiceOrder;
  for (const quote of [{ quantity: 0, unitPrice: 4 }, { quantity: NaN, unitPrice: 4 }, { quantity: Infinity, unitPrice: 4 },
    { quantity: .1, unitPrice: NaN }, { quantity: .1, unitPrice: Infinity }, { quantity: .1, unitPrice: 0 }]) {
    const sim = { state, shopCommodity: () => 'materials', quoteSupply: () => quote } as unknown as Simulation;
    const before = structuredClone(state);
    assert.equal(serviceMaterialOfferAvailable(sim, order), false); assert.deepEqual(state, before);
  }
  const sim = { state, shopCommodity: () => 'materials', quoteSupply: () => ({ quantity: .1, unitPrice: 4 }) } as unknown as Simulation;
  state.shops[0].inventory = 0;
  assert.equal(serviceMaterialOfferAvailable(sim, order), false);
});
test('explicit exact current4 host scheduling cutover changes only declaration, never money, stock, authority or history', async () => {
  const world = civicFixtureWorld(), city = createCurrentProductCity(world), before = city.exportSave();
  assert.equal(city.state.serviceMaterialScheduling, undefined);
  assert.equal((await upgradeServiceMaterialScheduling(city, '0'.repeat(64))).ok, false); assert.equal(city.exportSave(), before);
  city.emitEvent({type:'upgrade-service-material-scheduling'}); city.emitEvent({type:'service-material-procurement'});
  assert.equal(city.exportSave(), before);
  assert.equal((await upgradeServiceMaterialScheduling(city, hash(before))).ok, true);
  const saved = city.exportSave(); assert.equal(stripPolicy(saved), before);
  assert.deepEqual(city.state.serviceMaterialScheduling!.sourceSave, {version:4, sha256:hash(before)});
  assert.equal((await upgradeServiceMaterialScheduling(city, hash(saved))).ok, false); assert.equal(city.exportSave(), saved);
  const full = createArchivedProductCity(world), parts = createArchivedProductCity(world);
  assert.equal(full.importSave(saved).ok, true); assert.equal(full.exportSave(), saved);
  assert.equal(parts.importSave(assembleSave(partitionSave(saved, world))).ok, true); assert.equal(parts.exportSave(), saved);
  for (let tick=0; tick<24; tick++) { city.step(.25); full.step(.25); parts.step(.25); assert.equal(full.exportSave(), city.exportSave()); assert.equal(parts.exportSave(), city.exportSave()); }
});
test('strict whole and partition policy declarations reject halves, unknown versions and borrowed sources without mutation', async () => {
  const world = civicFixtureWorld(), city = createArchivedProductCity(world);
  assert.equal((await upgradeServiceMaterialScheduling(city, hash(city.exportSave()))).ok, true);
  const saved = city.exportSave();
  const changes: [string,(d:any)=>void][] = [
    ['missing body', d=>delete d.state.serviceMaterialScheduling], ['missing marker', d=>delete d.runtime.serviceMaterialSchedulingVersion],
    ['missing manifest', d=>d.runtime.persistedModules=d.runtime.persistedModules.filter((n:string)=>n!=='serviceMaterialScheduling')],
    ['duplicate manifest',d=>d.runtime.persistedModules.push('serviceMaterialScheduling')],
    ['body version',d=>d.state.serviceMaterialScheduling.version=2], ['marker version',d=>d.runtime.serviceMaterialSchedulingVersion=2],
    ['policy id',d=>d.state.serviceMaterialScheduling.policyId+='wrong'], ['enablement',d=>d.state.serviceMaterialScheduling.enablementId+='wrong'],
    ['source not4',d=>d.state.serviceMaterialScheduling.sourceSave.version=3], ['bad source SHA',d=>d.state.serviceMaterialScheduling.sourceSave.sha256='bad'],
    ['unknown source field',d=>d.state.serviceMaterialScheduling.sourceSave.trusted=true], ['unknown body field',d=>d.state.serviceMaterialScheduling.trusted=true],
    ['future time',d=>d.state.serviceMaterialScheduling.enabledAt++], ['future tick',d=>d.state.serviceMaterialScheduling.enabledTick++],
    ['old version',d=>d.version=3], ['legacy downgrade with leftover policy only',d=>{d.version=2;delete d.rulesetId;delete d.motionVersion;delete d.historyPolicyId;delete d.state.civicHistory;delete d.state.civicStaffing;delete d.state.budgetAuthority;delete d.runtime.civicHistoryVersion;delete d.runtime.civicStaffingVersion;delete d.runtime.budgetAuthorityVersion;d.runtime.persistedModules=d.runtime.persistedModules.filter((n:string)=>!['civicHistory','civicStaffing','budgetAuthority'].includes(n));}],
  ];
  for (const [name,mutate] of changes) { const d=JSON.parse(saved);mutate(d);const bad=JSON.stringify(d);assert.equal(city.importSave(bad).ok,false,name);assert.equal(city.exportSave(),saved,name);assert.throws(()=>partitionSave(bad,world),name); }
});
test('default and old2 or3 imports never activate policy, and loaded current4 stays exact without it', async () => {
  const world = civicFixtureWorld();
  for (const old of [new Simulation(world), createProductCity(world), createCurrentProductCity(world)]) {
    const saved = old.exportSave(), city = createCurrentProductCity(world); assert.equal(city.importSave(saved).ok,true);assert.equal(city.exportSave(),saved);
    assert.equal(city.state.serviceMaterialScheduling,undefined);
    if (old.saveVersion < 4) { assert.equal((await upgradeServiceMaterialScheduling(city,hash(saved))).ok,false);assert.equal(city.exportSave(),saved); }
    for(let tick=0;tick<24;tick++){old.step(.25);city.step(.25);assert.equal(city.exportSave(),old.exportSave());assert.equal(city.state.serviceMaterialScheduling,undefined);}
  }
});
test('a genuine frozen old1 held-qualification source keeps literal full/partition import and future24; nested new estimates cannot hide in old documents', async () => {
  const raw=gunzipSync(readFileSync(new URL('./fixtures/family-fee-v1/oracle-old-v1-held-18.5.save.json.gz',import.meta.url))).toString('utf8');
  assert.equal(JSON.parse(raw).version,1);const world=educationWorld(),old=new Simulation(world),current=createCurrentProductCity(world);
  assert.equal(old.importSave(raw).ok,true);assert.equal(current.importSave(raw).ok,true);assert.equal(current.exportSave(),raw);
  assert.equal(assembleSave(partitionSave(raw,world)),raw);assert.equal(current.state.serviceMaterialScheduling,undefined);
  assert.equal((await upgradeServiceMaterialScheduling(current,hash(raw))).ok,false);assert.equal(current.exportSave(),raw);
  for(const marker of [null,{version:1,policyId:SERVICE_MATERIAL_POLICY,requiredUnits:1,unitPrice:10,gross:10}]){
    const bad=JSON.parse(raw);bad.state.culture.supplementalBudgets={version:2,requests:[{remainingNeedQuote:marker}]};const text=JSON.stringify(bad);
    assert.equal(current.importSave(text).ok,false);assert.equal(current.exportSave(),raw);assert.throws(()=>partitionSave(text,world),/service material/);assert.throws(()=>selectSavedWorld(text),/service material/);
  }
  for(let tick=0;tick<24;tick++){old.step(.25);current.step(.25);assert.equal(current.exportSave(),old.exportSave());assert.equal(current.saveVersion,1);assert.equal(current.state.serviceMaterialScheduling,undefined);}
});
test('current4 host cutover rejects a source that genuinely advances while its exact digest is pending', async () => {
  const city=createCurrentProductCity(educationWorld()),before=city.exportSave(),pending=upgradeServiceMaterialScheduling(city,hash(before));
  city.step(.25);const advanced=city.exportSave();assert.notEqual(advanced,before);assert.equal((await pending).ok,false);assert.equal(city.exportSave(),advanced);assert.equal(city.state.serviceMaterialScheduling,undefined);
});
test('explicit remaining-need estimate handles a small real offer without inventing stock, cash or approval; old requests keep their cap', () => {
  // Controlled contract fixture only. Actual six-consumer proof uses the
  // immutable original source and ordinary step, without these test inputs.
  const make = (enabled: boolean) => {
    const world = { buildings: [{id:'school',kind:'school',districtId:'district',name:'school'}, {id:'workshop',kind:'workshop',districtId:'district'}] } as unknown as WorldDefinition;
    const order = { id:'service-1',petitionId:'petition-1',topic:'education',siteId:'school',state:'awaitingBudget',scheduledAt:1,approvedAt:1,
      approvedBy:['first','second'],authorizedCap:40,spent:40,receivedUnits:4.7192033148456245,consumedUnits:0,targetUnits:6,requiredMinutes:60,
      servedIds:[],serviceMinutes:{},staffIds:[],receipts:[{procurementId:'service-1:receipt-1',budgetId:'service-1',purchasedAt:2,paid:40,quantity:4.7192033148456245,tax:3.2,lots:[]}],
      retryAt:0,completedAt:null,lastReason:'' } as ServiceOrder;
    const policy = {version:1 as const,policyId:SERVICE_MATERIAL_POLICY,enablementId:'fixture',enabledAt:3,enabledTick:0,sourceSave:{version:4 as const,sha256:'a'.repeat(64)}};
    const state = { treasury:1234,tick:0,extension:{lastUpdate:10},shops:[{id:'supplier',buildingId:'workshop',districtId:'district',inventory:.7173222921515576,cash:500}],
      culture:{version:2,lastUpdate:10,orders:[order]},civicStaffing:{version:2,enablement:{id:'fixture',enabledAt:0,enabledTick:0}},civicHistory:{version:1},
      budgetAuthority:{version:1,enablementId:'fixture',requestIds:[]},...(enabled ? {serviceMaterialScheduling:policy} : {}) } as unknown as SimState;
    const sim = { state,worldDefinition:world,effectiveRuleset:'civic-local-v1',shopCommodity:()=> 'materials',
      quoteSupply:(_id:string,quantity:number)=>({quantity:Math.min(quantity,state.shops[0].inventory),unitPrice:7.92}),appendNotice:()=>{} } as unknown as Simulation;
    return {state,world,order,policy,sim};
  };
  const c=make(true), before={cash:c.state.treasury,stock:c.state.shops[0].inventory,supplierCash:c.state.shops[0].cash};
  proposeSupplementalBudget(c.sim,c.order);const request=c.state.culture!.supplementalBudgets!.requests[0];
  assert.equal(request.quotedGross,.7173222921515576*7.92);assert.equal(request.quoteLots[0].quantity,before.stock);
  assert.equal(request.remainingNeedQuote!.requiredUnits,6-c.order.receivedUnits);assert.equal(request.remainingNeedQuote!.unitPrice,7.92);
  assert.equal(request.cap,11);assert.equal(request.approvedAt,null);assert.equal(request.spent,0);assert.deepEqual(request.signatures,[]);
  assert.deepEqual({cash:c.state.treasury,stock:c.state.shops[0].inventory,supplierCash:c.state.shops[0].cash},before);
  assert.doesNotThrow(()=>validateSupplementalBudgetState(c.state,c.world));
  const envelope={format:'yunshan-save',version:4,state:c.state,runtime:{serviceMaterialSchedulingVersion:1,persistedModules:['serviceMaterialScheduling']}};
  assert.doesNotThrow(()=>validateServiceMaterialSchedulingEnvelope(envelope));
  const orphan=structuredClone(envelope);delete orphan.state.serviceMaterialScheduling;delete (orphan.runtime as any).serviceMaterialSchedulingVersion;orphan.runtime.persistedModules=[];orphan.version=2;
  assert.equal(hasCityRulesetDeclaration(orphan),true);assert.throws(()=>partitionSave(JSON.stringify(orphan)));assert.throws(()=>validateServiceMaterialSchedulingEnvelope(orphan));
  for(const mutate of [
    (s:any)=>s.culture.supplementalBudgets.requests[0].cap=6,
    (s:any)=>s.culture.supplementalBudgets.requests[0].remainingNeedQuote.unitPrice=8,
    (s:any)=>s.culture.supplementalBudgets.requests[0].remainingNeedQuote.requiredUnits=.7173222921515576,
    (s:any)=>s.culture.supplementalBudgets.requests[0].remainingNeedQuote.gross++,
    (s:any)=>s.culture.supplementalBudgets.requests[0].remainingNeedQuote.version=2,
    (s:any)=>s.culture.supplementalBudgets.requests[0].remainingNeedQuote.policyId='other',
    (s:any)=>s.culture.supplementalBudgets.requests[0].remainingNeedQuote.extra=true,
    (s:any)=>s.culture.supplementalBudgets.requests[0].remainingNeedQuote=null,
    (s:any)=>delete s.serviceMaterialScheduling,
    (s:any)=>s.serviceMaterialScheduling.enabledAt=11,
    (s:any)=>s.serviceMaterialScheduling.enabledAt=10+5e-8,
  ]) {const bad=structuredClone(c.state);mutate(bad);assert.throws(()=>validateSupplementalBudgetState(bad,c.world));assert.throws(()=>validateServiceMaterialSchedulingEnvelope({...envelope,state:bad}));}
  const old=make(false);proposeSupplementalBudget(old.sim,old.order);const original=old.state.culture!.supplementalBudgets!.requests[0];
  assert.equal(original.cap,6);assert.equal(original.remainingNeedQuote,undefined);
  old.state.serviceMaterialScheduling=old.policy;assert.doesNotThrow(()=>validateSupplementalBudgetState(old.state,old.world));
  proposeSupplementalBudget(old.sim,old.order);assert.equal(old.state.culture!.supplementalBudgets!.requests.length,1);assert.equal(original.cap,6);
});
