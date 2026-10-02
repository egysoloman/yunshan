import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world';
import { Simulation } from '../src/simulation';
import { observeFoodMaterial } from './food-material-observer';
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
async function sourceHashes() { const names=(await readdir('src',{recursive:true})).filter(name=>name.endsWith('.ts')||name.endsWith('.css')).sort();return Object.fromEntries(await Promise.all(names.map(async name=>[`src/${name}`,hash(await readFile(`src/${name}`))]))); }
const sourceStart=await sourceHashes(), manifest=JSON.parse(await readFile('snapshot-manifest.json','utf8'));
assert.equal(Object.keys(sourceStart).length,32);for(const [name,digest] of Object.entries(sourceStart))assert.equal(digest,manifest.sourceCopy[name]);
const world=createWorld(20261001),sim=new Simulation(world),observer=observeFoodMaterial(sim), runtime:any=Reflect.get(sim,'runtime');
sim.command({type:'speed',value:8});sim.setFocus(world.spawn,'walk');
const sites=new Map(world.buildings.map(b=>[b.id,b])),edges=new Map(world.edges.map(edge=>[edge.id,edge]));
const identity=(c:any)=>Reflect.get(sim,'citizenIdentity').call(sim,c);
const healthy=(c:any)=>sim.state.extension!.actorProfiles[c.id].alive&&sim.state.extension!.actorProfiles[c.id].age>=18&&sim.state.extension!.actorProfiles[c.id].health>=45&&c.needs.hunger>=40&&c.needs.fatigue>=35;
const walk=(c:any,b:any)=>Reflect.get(sim,'walkingDistance').call(sim,c,b) as number;
const targets=['academy','government','starport'];let firstQuorum:any=null,quorumSave:string|null=null;
const firstFailure:Record<string,any>={},firstStaffDuty:Record<string,any>={},deliveries:any[]=[],quorumEvents:any[]=[];
let preTraffic=new Map<string,any>(),loadThisTick=new Map<string,number>(),arrivedThisTick:any[]=[];
sim.onPhase('energy',()=>{preTraffic=new Map(sim.state.vehicles.map(v=>[v.id,{cargo:v.cargo,sourceShopId:runtime.cargoSources?.[v.id]??null,edgeId:v.edgeId,direction:v.direction}]));loadThisTick=new Map();arrivedThisTick=[];});
sim.onEvent('cargo-loaded',e=>loadThisTick.set(e.vehicleId!, (loadThisTick.get(e.vehicleId!)??0)+(e.amount??0)));
sim.onEvent('cargo-arrived',e=>arrivedThisTick.push({...e}));
sim.onPhase('traffic',()=>{
  const actualByKey=new Map<string,number>(),eventsByKey=new Map<string,number>();
  for(const v of sim.state.vehicles){const before=preTraffic.get(v.id)!;const qty=before.cargo+(loadThisTick.get(v.id)??0)-v.cargo;if(qty<=1e-7)continue;
    const oldEdge=edges.get(before.edgeId)!,nodeId=before.direction>0?oldEdge.to:oldEdge.from,node=world.nodes.find(n=>n.id===nodeId)!;
    const displacement=Math.hypot(v.position.x-node.position.x,v.position.y-node.position.y,v.position.z-node.position.z);
    assert.ok(displacement<=1.300001,'Unloading must occur at the actual endpoint, allowing the native road lane offset');
    const key=`${node.districtId}:${before.sourceShopId??'public'}`;actualByKey.set(key,(actualByKey.get(key)??0)+qty);
    deliveries.push({tick:sim.state.tick,at:sim.state.extension!.lastUpdate,vehicleId:v.id,nodeId,districtId:node.districtId,sourceShopId:before.sourceShopId,quantity:qty,position:{...v.position},endpointDistance:displacement,
      evidence:'Read-only per-vehicle actual cargo-before + same-tick actual load - cargo-after; matches native cargo-arrived totals by owner and district. Original 14-day log did not store unloading vehicle/node.'});
  }
  for(const e of arrivedThisTick){const key=`${e.districtId}:${e.shopId??'public'}`;eventsByKey.set(key,(eventsByKey.get(key)??0)+(e.amount??0));}
  for(const key of new Set([...actualByKey.keys(),...eventsByKey.keys()]))assert.ok(Math.abs((actualByKey.get(key)??0)-(eventsByKey.get(key)??0))<1e-7,'Native unload events must equal all actual vehicle custody changes');
});
for(let tick=0;tick<720;tick++){
  sim.step(.25);if(tick%1000===0)sim.setFocus(world.districts[Math.floor(tick/1000)%world.districts.length].center,tick%2000===0?'walk':'drone');
  const groups=new Map<string,any[]>();
  for(const c of sim.state.citizens){const site=sites.get(c.workId)!;
    if(targets.includes(c.districtId)&&!firstStaffDuty[c.districtId]&&['school','hall','station'].includes(site.kind)&&healthy(c)&&sim.isOnDuty(c.id,site.id))firstStaffDuty[c.districtId]={tick:sim.state.tick,at:sim.state.extension!.lastUpdate,id:c.id,role:c.role,siteId:site.id,hunger:c.needs.hunger,fatigue:c.needs.fatigue,attendance:runtime.attendance[c.id],position:{...c.position},standingAppropriation:!runtime.publicLabor,publicBudget:sim.publicBudgetSnapshot()};
    if(!healthy(c)||!['official','council','mayor'].includes(identity(c))||!['hall','core','bank'].includes(site.kind)||!sim.isOnDuty(c.id,site.id))continue;
    const rows=groups.get(site.id)??[];rows.push(c);groups.set(site.id,rows);
  }
  for(const [siteId,rows]of groups){if(rows.length<2)continue;
    if(!quorumEvents.some(row=>row.siteId===siteId))quorumEvents.push({tick:sim.state.tick,at:sim.state.extension!.lastUpdate,siteId,actorIds:rows.map(c=>c.id),publicBudget:sim.publicBudgetSnapshot()});
    if(!firstQuorum){firstQuorum={tick:sim.state.tick,at:sim.state.extension!.lastUpdate,siteId,actors:rows.slice(0,2).map(c=>({id:c.id,role:c.role,workId:c.workId,position:{...c.position},hunger:c.needs.hunger,fatigue:c.needs.fatigue,attendance:runtime.attendance[c.id],onDuty:sim.isOnDuty(c.id,c.workId)})),standingAppropriation:!runtime.publicLabor,publicBudget:sim.publicBudgetSnapshot()};quorumSave=sim.exportSave();}
  }
  for(const id of ['all',...targets]){
    if(firstFailure[id])continue;
    const c=sim.state.citizens.find(c=>sim.state.extension!.actorProfiles[c.id].alive&&c.needs.hunger<20&&c.money>=15&&(id==='all'||c.districtId===id));if(!c)continue;
    const choice=Reflect.get(sim,'chooseFacility').call(sim,c),foods=sim.state.shops.filter(s=>sim.shopCommodity(s)==='food'&&s.open&&s.inventory>=1&&c.money>=s.price).map(s=>{const b=sites.get(s.buildingId)!,straight=Math.hypot(c.position.x-b.door.x,c.position.y-b.door.y,c.position.z-b.door.z),travel=walk(c,b);return{shopId:s.id,districtId:s.districtId,price:s.price,inventory:s.inventory,straight,travel,minutesOnFoot:travel/(sim.state.weather==='雨'?3.1:4.2),advertised:s.districtId===c.districtId||straight<=1200,closesAt:b.kind==='market'?22:20};}).filter(s=>Number.isFinite(s.travel)).sort((a,b)=>a.travel-b.travel);
    firstFailure[id]={tick:sim.state.tick,at:sim.state.extension!.lastUpdate,day:sim.state.day,hour:sim.state.hour,weather:sim.state.weather,id:c.id,districtId:c.districtId,homeId:c.homeId,workId:c.workId,role:c.role,wallet:c.money,hunger:c.needs.hunger,food:c.food??0,position:{...c.position},state:c.state,activity:runtime.activities[c.id],nativeChoice:{activity:choice.activity,destinationId:choice.destination.id},affordableOpenFood:foods.length,advertisedOpenFood:foods.filter(s=>s.advertised).length,nearestFood:foods[0]??null,localFreight:runtime.freight[c.districtId]??0,foodShopStock:sim.state.shops.filter(s=>sim.shopCommodity(s)==='food').reduce((n,s)=>n+s.inventory,0),publicBudget:sim.publicBudgetSnapshot()};
  }
}
await observer.write('artifacts/food-first-failure-replay-observer.json');
const original=JSON.parse(await readFile('artifacts/food-material-causality-14d.json','utf8')),replay=JSON.parse(await readFile('artifacts/food-first-failure-replay-observer.json','utf8'));
const prefix=original.samples.filter((sample:any)=>sample.tick<=720);
for(let index=0;index<4;index++)assert.deepEqual(replay.samples[index],prefix[index],'The first four complete original samples must match');
// The original snapshot stored position:c.position in detailed starvingExamples.
// Those pointers continued to move until the 14-day JSON was finally written.
// Keep the failed full-sample assertion separately; never call this full-state
// or five-full-sample equivalence. All independently frozen fields stay strict.
const withoutMutablePositions=(sample:any)=>({...sample,starvingExamples:sample.starvingExamples?.map((actor:any)=>({...actor,position:undefined}))});
assert.deepEqual(withoutMutablePositions(replay.samples[4]),withoutMutablePositions(prefix[4]),'Every independently frozen day-one sample field must match');
const mutablePositionDifferences=prefix[4].starvingExamples.flatMap((actor:any,index:number)=>JSON.stringify(actor.position)===JSON.stringify(replay.samples[4].starvingExamples[index].position)?[]:[{id:actor.id,originalLateWrittenPosition:actor.position,replayedActualPosition:replay.samples[4].starvingExamples[index].position}]);
assert.equal(mutablePositionDifferences.length,6);
assert.ok(firstQuorum&&firstQuorum.tick<firstFailure.all.tick);assert.ok(quorumSave);
const licenseProbe=new Simulation(world),restored=licenseProbe.importSave(quorumSave!);assert.equal(restored.ok,true);assert.equal(licenseProbe.exportSave(),quorumSave);
const beforeProbe=licenseProbe.exportSave(),cashBefore=licenseProbe.state.treasury,budgetBefore=licenseProbe.publicBudgetSnapshot();
const request={id:'food-counter-review-probe',siteId:'academy-b10',purpose:'food-distribution',cap:40,approvedAt:licenseProbe.state.extension!.lastUpdate,approvedBy:firstQuorum.actors.map((actor:any)=>actor.id)};
const authorized=licenseProbe.authorizePublicBudget(request);assert.equal(authorized,true);assert.equal(licenseProbe.state.treasury,cashBefore);assert.equal(licenseProbe.publicBudgetSnapshot().authorizedRemaining,budgetBefore.authorizedRemaining+40);
const sourceEnd=await sourceHashes();assert.deepEqual(sourceStart,sourceEnd);
const result={scope:'Only 720-tick diagnostic replay: four complete original observer samples equal; all independently frozen fields of day-one sample equal. Original detailed positions were mutable actor references and six positions differ, so this is NOT whole-state or five-full-sample equivalence. Native budgeting probe occurs solely in a separate exact-restored clone; no real license/counter, no source modification or new long-term audit.',sourceStart,sourceEnd,originalPrefixComparedTicks:prefix.map((row:any)=>row.tick),fullyMatchedSampleTicks:prefix.slice(0,4).map((row:any)=>row.tick),prefixExact:false,allIndependentlyFrozenSampleFieldsExact:true,mutablePositionDifferences,firstFailure,firstQuorum,firstStaffDuty,quorumEvents,
  deliveries,zeroMarketDistrictDeliveries:deliveries.filter(row=>targets.includes(row.districtId)),publicAuthorizationProbe:{request,authorized,cashBefore,cashAfter:licenseProbe.state.treasury,authorizedRemaining:licenseProbe.publicBudgetSnapshot().authorizedRemaining,originalReplayUnmodifiedByProbe:true,cloneSaveChanged:licenseProbe.exportSave()!==beforeProbe},
  originalLogNodeVehicleMissing:true,ticks:sim.state.tick};
await writeFile('artifacts/food-first-failure-replay.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,sourceStart:undefined,sourceEnd:undefined,deliveries:undefined},null,2));
