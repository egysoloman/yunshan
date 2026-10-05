import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

type Any = any;
const ROOT = '/workspace/yunshan-work/ROOT16-food-integration-20261005-01';
const args = new Map<string,string>();
for (let i=2;i<process.argv.length;i+=2) {
  assert.ok(['--source','--out','--ticks','--start-save','--prior-receipts'].includes(process.argv[i]) && process.argv[i+1] && !args.has(process.argv[i]));
  args.set(process.argv[i],process.argv[i+1]);
}
const source=resolve(args.get('--source') ?? join(ROOT,'baseline-source'));
const out=resolve(args.get('--out')!); assert.ok(out.startsWith(ROOT+'/outputs/'));
const maxTicks=Number(args.get('--ticks')); assert.ok(Number.isInteger(maxTicks)&&maxTicks>=1&&maxTicks<=512);
mkdirSync(out,{recursive:true});
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const json=(name:string,value:Any)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const stream=(name:string,value:Any)=>appendFileSync(join(out,name),JSON.stringify(value)+'\n');
const clone=<T,>(v:T):T=>structuredClone(v);
const distance=(a:Any,b:Any)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const near=(a:number,b:number,label:string)=>assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} / ${b}`);
const sum=(rows:Any[]|undefined,f:(row:Any)=>number)=>(rows??[]).reduce((n,r)=>n+f(r),0);
const raw=readFileSync(join(ROOT,'originals/root15-current-default-day-final.save.json'),'utf8');
const worldRaw=readFileSync(join(ROOT,'originals/WORLD-ORIGINAL.json'),'utf8');
assert.equal(sha(raw),'db40c8410ed5cd45f308fb12c12a4ef6678c58add40e3122e595a6bdd99efe16');
assert.equal(sha(worldRaw),'2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512');
const envelope=JSON.parse(raw), world=JSON.parse(worldRaw);
const inputs=JSON.parse(readFileSync(join(ROOT,'BASELINE-INPUTS-322.json'),'utf8'));
for(const [path,h] of Object.entries(inputs)) assert.equal(sha(readFileSync(join(source,path))),h,path);
const load=(path:string)=>import(pathToFileURL(join(source,path)).href);
const { Simulation }=await load('src/simulation.ts');
const { shopLifecycleHeldCash }=await load('src/simulation/shop_lifecycle.ts');
const { familyEducationHeldCash }=await load('src/simulation/family-education.ts');
const { foodSnapshot }=await load('scripts/economy-observations.ts');
const startPath=resolve(args.get('--start-save')!); assert.equal(startPath,join(ROOT,'outputs/baseline-observe01/terminal.save.json'));
const priorPath=resolve(args.get('--prior-receipts')!); assert.equal(priorPath,join(ROOT,'outputs/baseline-observe01/counter-receipts.jsonl'));
const startRaw=readFileSync(startPath,'utf8'); assert.equal(sha(startRaw),'ac47bc4c4e43f36e755fa6b9f3447107d6cc75506d90c2aebbe0ab63105b3cc8');
const priorRows=readFileSync(priorPath,'utf8').trim().split('\n').map(line=>JSON.parse(line));const inheritedIds=new Set(priorRows.map(v=>v.event.citizenId));assert.equal(inheritedIds.size,70);
const parentReceipt=JSON.parse(readFileSync(join(ROOT,'baseline-observe01/receipt.json'),'utf8'));assert.equal(parentReceipt.status,'PASS');assert.equal(parentReceipt.inputsStable,true);assert.equal(parentReceipt.activeDescendants.length,0);assert.equal(sha(readFileSync(join(ROOT,'baseline-observe01/raw.log'))),parentReceipt.rawSHA256);
json('INHERITED-PROOF.json',{parentReceipt,terminalSHA256:sha(startRaw),receiptSHA256:sha(readFileSync(priorPath)),nativeCounterReceipts:priorRows.length,distinctIds:[...inheritedIds]});
const sim:Any=new Simulation(world,{rulesetId:'civic-local-v1'});
const imported=sim.importSave(startRaw); assert.equal(imported.ok,true,imported.message); assert.equal(sim.exportSave(),startRaw,'exact terminal imported without state upgrade');
const r=()=>Reflect.get(sim,'runtime'); const clock=()=>sim.state.extension.lastUpdate;
const buildings=new Map<string,Any>(world.buildings.map((b:Any)=>[b.id,b]));
const originalIds=envelope.state.citizens.filter((c:Any)=>c.needs.hunger<30&&(c.food??0)<1&&envelope.state.extension.actorProfiles[c.id].alive!==false).map((c:Any)=>c.id);
assert.equal(originalIds.length,229); const targets=new Set(originalIds);
const actor=(id:string)=>sim.state.citizens.find((c:Any)=>c.id===id);
const snapshot=(id:string)=>{
 const c=actor(id), route=c.route??[], shop=sim.state.shops.find((s:Any)=>s.buildingId===c.destinationId);
 let point=c.position,length=0; for(const next of route.slice(c.routeIndex??0)){length+=distance(point,next);point=next;}
 return {id,tick:sim.state.tick,clock:clock(),position:clone(c.position),state:c.state,needs:clone(c.needs),food:c.food??0,money:c.money,tier:c.tier,activity:r().activities[id],decisionAt:r().decisionAt[id],destinationId:c.destinationId,remainingRouteLength3D:length,routeIndex:c.routeIndex,routePoints:route.length,nextPoint:clone(route[c.routeIndex??0]??null),rider:clone(r().riders[id]??null),stairCursor:clone(r().npcStairCursors?.[id]??null),customerShopId:r().customers[id]??null,quote:shop?{shopId:shop.id,open:shop.open,stock:shop.inventory,price:shop.price}:null};
};
function moneySupply(){
 const s=sim.state,e=s.extension;
 return s.treasury+r().taxes+s.player.money+(s.banking?s.banking.cash+s.banking.legacyInvestmentCash:s.bankBalance+(r().investment??0))+sum(s.citizens,c=>c.money)
 +sum(s.shops.filter((shop:Any)=>!e.companies.some((c:Any)=>c.shopBindingReleasedAt===undefined&&c.buildingId===shop.buildingId)),c=>c.cash??0)
 +sum(e.companies,c=>c.capital)+sum(e.organizations,c=>c.funds)+(s.playerLabor?.job?.escrow??0)+sum(s.roadworks?.jobs,j=>j.escrow)+(s.education?.course?.escrow??0)+familyEducationHeldCash(s)
 +sum(s.power?.repairs,j=>j.escrow)+sum(s.clinical?.orders,j=>j.escrow)+shopLifecycleHeldCash(s)+sum(s.hygiene?.jobs,j=>j.escrow)+sum(s.hygiene?.transfers?.tasks,j=>j.escrow)+sum(s.family?.pregnancies,j=>j.escrow)+sum(s.family?.households,j=>j.balance);
}
const foodShop=(id:string)=>['market','farm','dock'].includes(buildings.get(sim.state.shops.find((s:Any)=>s.id===id)?.buildingId)?.kind);
function foodHoldings(){
 const s=sim.state;
 return sum(s.shops.filter((shop:Any)=>foodShop(shop.id)),j=>j.inventory)+sum(s.citizens,c=>c.food??0)+(s.player.inventory.food??0)
 +sum(s.vehicles.filter((v:Any)=>v.cargo>0&&(!r().cargoSources?.[v.id]||foodShop(r().cargoSources[v.id]))),v=>v.cargo)
 +Object.values(r().freightLots??{}).reduce((n:number,lots:Any)=>n+sum(lots.filter((lot:Any)=>!lot.shopId||foodShop(lot.shopId)),l=>l.quantity),0);
}
const receipts:Any[]=[],decisions:Any[]=[],rejections:Any[]=[];let foodProduced=0,counterMeals=0,carriedMeals=0,actualTicks=0,maxCashResidual=0,maxFoodResidual=0;
let quoteBoundary:Any;
const originalQuote=sim.quoteConsignmentSale;
sim.quoteConsignmentSale=function(shopId:string,quantity:number,beforeInventory:number){
 const result=originalQuote.call(this,shopId,quantity,beforeInventory);
 const shop=this.state.shops.find((s:Any)=>s.id===shopId);
 quoteBoundary={tick:this.state.tick,shopId,quantity,beforeInventory,quote:clone(result),shop:clone(shop),funds:this.shopFunds(shop),taxes:r().taxes,taxRate:this.state.taxRate,actors:this.state.citizens.filter((c:Any)=>targets.has(c.id)&&r().customers[c.id]===shopId&&c.state==='shopping').map((c:Any)=>clone(c))};
 return result;
};
const originalChoose=sim.chooseFacility;
sim.chooseFacility=function(c:Any){
 const before=targets.has(c.id)?snapshot(c.id):undefined;
 const result=originalChoose.call(this,c);
 if(before){const row={before,chosenDestinationId:result.destination.id,chosenActivity:result.activity};decisions.push(row);stream('decisions.jsonl',row);}
 return result;
};
const originalGuard=sim.citizenReferenceSegmentAllowed;
sim.citizenReferenceSegmentAllowed=function(c:Any,from:Any,to:Any,bodies:Any[]){
 const allowed=originalGuard.call(this,c,from,to,bodies);
 if(!allowed&&targets.has(c.id)&&new Error().stack?.includes('moveCitizenPhysical')){const row={id:c.id,tick:this.state.tick,clock:clock(),from:clone(from),to:clone(to),bodies:bodies.map((b:Any)=>({buildingId:b.building.id,floors:[...b.floors]}))};rejections.push(row);stream('body-rejections.jsonl',row);}
 return allowed;
};
sim.onEvent('production',(e:Any)=>{stream('production.jsonl',{tick:sim.state.tick,clock:clock(),event:clone(e)});if(foodShop(e.shopId))foodProduced+=e.amount??0;});
sim.onEvent('stored-meal',(e:Any)=>{carriedMeals+=e.amount??0;if(targets.has(e.citizenId))stream('carried-meals.jsonl',{tick:sim.state.tick,clock:clock(),event:clone(e),after:snapshot(e.citizenId)});});
sim.onEvent('food-consumed',(e:Any)=>{carriedMeals+=e.amount??0;});
sim.onEvent('sale',(e:Any)=>{
 if(foodShop(e.shopId)&&e.citizenId&&e.citizenId!=='player')counterMeals++;
 if(!targets.has(e.citizenId))return;
 const q=quoteBoundary,c=actor(e.citizenId),shop=sim.state.shops.find((s:Any)=>s.id===e.shopId),before=q?.actors.find((a:Any)=>a.id===c.id);
 assert.ok(q&&before&&q.tick===sim.state.tick&&q.shopId===e.shopId&&q.quantity===e.quantity,'native quote belongs to actual target customer');
 near(before.money-c.money,e.amount,'wallet debit');near(q.beforeInventory-shop.inventory,e.quantity,'inventory debit');near(c.needs.hunger,Math.min(100,before.needs.hunger+52),'actual counter recovery');near(c.food??0,(before.food??0)+e.quantity-1,'carried remainder');
 near(shop.revenue-q.shop.revenue,e.amount,'gross revenue');near(shop.profit-q.shop.profit,e.amount*(1-q.taxRate)-q.quote.inventoryCost,'profit');near(sim.shopFunds(shop)-q.funds,e.amount*(1-q.taxRate)-q.quote.supplierGross,'finite account settlement');near(r().taxes-q.taxes,e.amount*q.taxRate,'actual tax');assert.equal(r().customers[c.id],undefined);
 const row={tick:sim.state.tick,clock:clock(),event:clone(e),before:{actor:before,shop:q.shop,funds:q.funds,taxes:q.taxes},after:{actor:clone(c),shop:clone(shop),funds:sim.shopFunds(shop),taxes:r().taxes},supplierQuote:q.quote,assertions:['wallet','stock','hunger52','carried remainder','revenue','profit','account','tax','request consumed']};receipts.push(row);stream('counter-receipts.jsonl',row);
});
json('PLAN.json',{maxTicks,capSeconds:600,actualStepSeconds:.25,speed:8,openingSHA256:sha(startRaw),originalDaySHA256:sha(raw),inheritedCounterIds:inheritedIds.size,worldSHA256:sha(worldRaw),targetIds:originalIds,scope:'Actual continuation with inherited original receipt proof. Requires all229 original hungry residents have actual native counter recovery across both scopes. No focus/body/needs/cash/stock/policy edits.',driverSHA256:sha(readFileSync(process.argv[1]))});
json('opening-actors.json',originalIds.map(snapshot));
const initialMoney=moneySupply(),initialFood=foodHoldings(),initialFocus=clone(r().focus),initialMode=r().mode,worldBefore=JSON.stringify(world);
let failure:string|undefined;
try{
 for(let i=0;i<maxTicks;i++){
  const before=originalIds.map(snapshot),beforeClock=clock(),beforeTick=sim.state.tick;
  sim.step(.25);actualTicks++;
  near(clock()-beforeClock,2,'original speed8 minute increment');assert.equal(sim.state.tick,beforeTick+1);assert.equal(sim.state.speed,8);assert.deepEqual(r().focus,initialFocus);assert.equal(r().mode,initialMode);assert.equal(JSON.stringify(world),worldBefore);
  assert.deepEqual(sim.state.lastSystemOrder,['time','environment','energy','traffic','people','commerce','finance','security','politics','feedback']);
  const cashResidual=moneySupply()-initialMoney,foodResidual=foodHoldings()-initialFood-foodProduced+counterMeals+carriedMeals;
  maxCashResidual=Math.max(maxCashResidual,Math.abs(cashResidual));maxFoodResidual=Math.max(maxFoodResidual,Math.abs(foodResidual));near(cashResidual,0,'cash conserved');near(foodResidual,0,'food conserved including disclosed inherited unclassified freight');
  const after=originalIds.map(snapshot);
  for(let j=0;j<after.length;j++)if(before[j].destinationId!==after[j].destinationId||before[j].state!==after[j].state)stream('state-changes.jsonl',{before:before[j],after:after[j]});
  if((i+1)%16===0){stream('actors-every16.jsonl',{tick:sim.state.tick,clock:clock(),actors:after});console.log(JSON.stringify({tick:sim.state.tick,actualTicks,distinctOriginalTargetsWithReceipt:new Set([...inheritedIds,...receipts.map(v=>v.event.citizenId)]).size,foodProduced,bodyRejections:rejections.length,food:foodSnapshot(sim.state,buildings)}));}
 }
}catch(e){failure=e instanceof Error?e.stack:String(e);}
if(!failure&&new Set([...inheritedIds,...receipts.map(v=>v.event.citizenId)]).size!==229)failure='FAIL_BOUND: not all229 original residents completed native counter purchases within original128 plus declared256 continuation ticks';
const terminal=sim.exportSave();writeFileSync(join(out,'terminal.save.json'),terminal,{flag:'wx'});
const outcomes=originalIds.map(id=>({id,nativeCounterSales:receipts.filter(v=>v.event.citizenId===id).length,decisions:decisions.filter(v=>v.before.id===id).length,bodyRejections:rejections.filter(v=>v.id===id).length,final:snapshot(id)}));json('outcomes.json',outcomes);
json('SUMMARY.json',{status:failure?'FAIL':'PASS_ALL229_COUNTER_RECOVERY',failure,actualTicks,maxTicks,distinctOriginalTargetsWithReceipt:new Set([...inheritedIds,...receipts.map(v=>v.event.citizenId)]).size,targetCounterReceipts:receipts.length,foodProduced,counterMeals,carriedMeals,maxCashResidual,maxFoodResidual,bodyRejections:rejections.length,terminalSHA256:sha(terminal),food:foodSnapshot(sim.state,buildings),sourceInputsUnchanged:Object.entries(inputs).every(([p,h])=>sha(readFileSync(join(source,p)))===h),boundary:'Requires all229 original actual counter recovery across128+256ticks; does not certify new hunger cases or everyone simultaneously fed, long term supply, medical treatment, full suite, art or hardware performance.'});
console.log(JSON.stringify({status:failure?'FAIL':'PASS_ALL229_COUNTER_RECOVERY',actualTicks,distinctOriginalTargetsWithReceipt:new Set([...inheritedIds,...receipts.map(v=>v.event.citizenId)]).size,terminalSHA256:sha(terminal),failure}));
if(failure)throw new Error(failure);
