import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { isRoadOpen, roadMovementAllowed, roadClosureById } from '../src/roads.ts';
import { captureBlockedRoadIntent, roadRepairDemand, validateRoadDemandsState, type RoadDemandsState, type RoadRepairDemand } from '../src/simulation/road-demands.ts';
import { roadworksStatus, validateRoadworksState } from '../src/simulation/roadworks.ts';
import { roadworksWorld, cash, exact24, until } from './roadworks-fixture.ts';
import { core, workPoint } from './power-fixture.ts';
import type { Citizen, SimState } from '../src/types.ts';

const stateDemands = (s: SimState): RoadDemandsState | undefined => Reflect.get(s,'roadDemands');
const now = (sim: Simulation) => sim.state.extension!.lastUpdate;
const point = (x: number) => ({ x, y: .6, z: 19 });

/** Controlled map declared before constructor, retaining all original
 * residents, identities, wallets, needs, jobs, inventory and production.
 * x88 makes the true safe endpoint western, so original material can reach
 * the worksite although an east-bound employee cannot reach the original job.
 * No runtime road/closure, worker, material or source event is fabricated. */
function demandWorld(detour = false) {
  const world = roadworksWorld();
  world.river = [{x:88,y:0,z:-30},{x:88,y:0,z:70}];
  // Removing the original remote warehouse leg is a PRE-constructor map
  // declaration. After relocation it would otherwise connect west directly
  // to station500 and bypass the river closure in both fixture variants.
  world.edges = world.edges.filter(e => e.id !== 'power-road-10');
  if (!detour) world.edges = world.edges.filter(e => !e.id.startsWith('roadworks-detour-'));
  return world;
}
function ordinaryIntent(sim: Simulation, second = false): Citizen {
  const candidates = sim.state.citizens.filter(c => c.workId === 'power-9' && sim.state.extension!.actorProfiles[c.id].alive && sim.state.extension!.actorProfiles[c.id].age >= 18);
  const actor = candidates[second ? 1 : 0]; assert(actor,'original adult east-side employee');
  // One initial standing position/intent; no phase pinning or need/wage edits.
  actor.position = point(50); core(sim).activities[actor.id] = 'work'; core(sim).decisionAt[actor.id] = now(sim)+180;
  Reflect.get(sim,'setDestination').call(sim,actor,sim.worldDefinition.buildings.find(b => b.id === actor.workId)!,true);
  assert.equal(actor.state,'moving'); assert(actor.route!.length > 1);
  return actor;
}
function flood(sim: Simulation): void {
  // Existing controlled real weather/probability branch, never emitEvent.
  sim.state.weather='雨'; sim.state.extension!.environment.stormRisk=100;
  sim.state.extension!.environment.disasterAt=now(sim); core(sim).weatherAt=now(sim)+10000;
  const original=sim.nextRandom.bind(sim); Reflect.set(sim,'nextRandom',()=>0);
  try { sim.step(.25); } finally { Reflect.set(sim,'nextRandom',original); }
  assert.equal(sim.state.roadNetwork!.closures[0].edgeId,'power-road-1');
}
function setup(detour = false, second = false) {
  const sim=new Simulation(demandWorld(detour));
  assert.equal(sim.command({type:'speed',value:8}).ok,true);
  const actor=ordinaryIntent(sim), other=second ? ordinaryIntent(sim,true) : null;
  const original={role:actor.role,workId:actor.workId,homeId:actor.homeId};
  const geometry=JSON.stringify(sim.worldDefinition), sourceEvents: object[]=[], replanSnapshots=new Map<string,Citizen>();
  sim.onEvent('road-route-blocked',e=>sourceEvents.push(e));
  // Observe after the core synchronous closure replan, before the same tick's
  // people phase can legitimately board existing transport. Never write core.
  sim.onEvent('road-edge-closed',()=>{for(const c of [actor,...(other?[other]:[])])replanSnapshots.set(c.id,structuredClone(c));});
  flood(sim);
  assert.equal(JSON.stringify(sim.worldDefinition),geometry);
  assert.deepEqual({role:actor.role,workId:actor.workId,homeId:actor.homeId},original);
  return {sim,actor,other,sourceEvents,replanSnapshots,closure:sim.state.roadNetwork!.closures[0]};
}

test('cold old road save retains no demand body/marker and exact24',()=>{
  const sim=new Simulation(demandWorld()); assert.equal(stateDemands(sim.state),undefined); assert.equal(core(sim).roadDemandsVersion,undefined); exact24(sim);
});
test('a canonical actual blocked ordinary commute submits a named zero-cash public request',()=>{
  const {sim,actor,closure,sourceEvents}=setup(), ds=stateDemands(sim.state)!;
  const d=ds.demands.find(d => d.actorId===actor.id)!; assert(d,'actual pre-replan closed segment, not a roadWaiting label');
  assert.equal(d.goalId,actor.workId); assert.equal(d.purpose,'work'); assert.equal(d.firstBlockedAt,closure.occurredAt); assert.equal(d.edgeId,closure.edgeId);
  assert(sourceEvents.length>0); const job=roadworksStatus(sim.state,closure.edgeId).job!;
  assert.equal(d.repairId,job.id); assert.equal(job.requestedBy,ds.demands[0].actorId); assert.equal(job.payerId,'public'); assert.equal(job.status,'awaitingBudget');
  assert.equal(job.funded,0); assert.equal(job.escrow,0); assert.equal(job.approvedAt,null); assert.deepEqual(job.approvedBy,[]);
  assert.equal(job.receipts.length,0); assert.equal(job.paidGross,0); assert.equal(job.workerId,null);
  validateRoadDemandsState(sim.state,sim.worldDefinition); validateRoadworksState(sim.state,sim.worldDefinition); exact24(sim);
});
test('a real dry detour and unrelated journeys do not invent repair demand',()=>{
  const {sim,actor,replanSnapshots}=setup(true), replanned=replanSnapshots.get(actor.id)!;
  assert.equal(replanned.state,'moving'); assert(replanned.route!.some(p=>p.z===200)); assert.equal(replanned.destinationId,actor.workId);
  assert.equal(actor.destinationId,actor.workId); assert.equal(actor.state,'riding','the actual later people phase boards legitimate existing transport');
  const rider=core(sim).riders[actor.id], vehicle=sim.state.vehicles.find(v=>v.id===rider?.vehicleId);
  assert(rider&&vehicle&&vehicle.passengers>=1); assert.equal(isRoadOpen(sim.state,vehicle.edgeId),true);
  assert.deepEqual(actor.position,vehicle.position);
  assert.equal(stateDemands(sim.state),undefined); assert.equal(sim.state.roadworks,undefined); assert.equal(core(sim).roadDemandsVersion,undefined); exact24(sim);
});
test('an old unreachable label without a living ordinary journey cannot become a closure demand',()=>{
  const sim=new Simulation(demandWorld()), actor=ordinaryIntent(sim);
  // Controlled preexisting failed-intent state. Retaining its stale route does
  // not make this an actual moving journey caused to fail by the new closure.
  actor.state='unreachable'; actor.route=[{...actor.position}]; actor.routeIndex=1;
  flood(sim); assert.equal(stateDemands(sim.state),undefined); assert.equal(sim.state.roadworks,undefined);
});
test('two actually blocked named residents join one public request; repeats cannot create approvals or cash',()=>{
  const {sim,actor,other,sourceEvents,closure}=setup(false,true), ds=stateDemands(sim.state)!;
  const a=ds.demands.find(d=>d.actorId===actor.id)!, b=ds.demands.find(d=>d.actorId===other!.id)!; assert(a); assert(b); assert.equal(a.repairId,b.repairId);
  assert.equal(sim.state.roadworks!.jobs.filter(j=>j.closureId===closure.id).length,1);
  const saved=sim.exportSave(), count=ds.demands.length;
  for(const event of [...sourceEvents]) sim.emitEvent(event as Parameters<Simulation['emitEvent']>[0]);
  const forged={type:'road-route-blocked',roadBlock:{...a,actorId:sim.state.citizens.find(c=>!ds.demands.some(d=>d.actorId===c.id))!.id}};
  sim.emitEvent(forged as Parameters<Simulation['emitEvent']>[0]);
  assert.equal(ds.demands.length,count); assert.equal(sim.exportSave(),saved,'canonical object repeats and public emitEvent cannot submit or spend');
});
test('capture rejects detached actors and wrong witness levels without changing the actor',()=>{
  const {sim,actor,closure}=setup(), original=JSON.stringify(actor);
  const snapshots: Citizen[]=[{...actor,state:'roadWaiting'}, {...actor,state:'moving',destinationId:null}, {...actor,state:'moving',destinationId:actor.workId,route:[],routeIndex:0},
    {...actor,state:'moving',destinationId:actor.workId,route:[point(50)],routeIndex:1}, {...actor,state:'moving',destinationId:actor.workId,route:[{x:100,y:12.6,z:19}],routeIndex:0,position:{x:50,y:12.6,z:19}}];
  for(const copy of snapshots) assert.equal(captureBlockedRoadIntent(sim.worldDefinition,sim.state,copy,closure.id,'work'),null,'detached/fabricated actor is not original authoritative snapshot');
  assert.equal(JSON.stringify(actor),original);
  const d=stateDemands(sim.state)!.demands[0]; assert.equal(roadMovementAllowed(sim.worldDefinition,sim.state,d.actorId,d.from,d.to),false);
});
test('bad demand time, references, segment and resident-request authority reject atomically',()=>{
  const {sim}=setup(), saved=sim.exportSave();
  const changes: ((document:any)=>void)[]=[s=>{delete s.state.roadDemands;},s=>{delete s.runtime.roadDemandsVersion;},s=>{s.state.roadDemands.nextId++;},s=>{s.state.roadDemands.demands[0].actorId='invented';},
    s=>{s.state.roadDemands.demands[0].goalId='invented';},s=>{s.state.roadDemands.demands[0].closureId='invented';},s=>{s.state.roadDemands.demands[0].firstBlockedAt+=1;},s=>{s.state.roadDemands.demands[0].observedTick=s.state.tick+1;},
    s=>{s.state.roadDemands.demands[0].to.y+=20;},s=>{s.state.roadDemands.demands[0].repairId='invented';},s=>{s.state.roadworks.jobs[0].requestedBy=s.state.citizens.find((c:Citizen)=>!s.state.roadDemands.demands.some((d:RoadRepairDemand)=>d.actorId===c.id)).id;},
    s=>{s.state.roadDemands.demands.push({...s.state.roadDemands.demands[0],id:'road-demand-'+s.state.roadDemands.nextId});s.state.roadDemands.nextId++;}];
  for(const [index,corrupt] of changes.entries()) {const broken=JSON.parse(saved);corrupt(broken);assert.equal(sim.importSave(JSON.stringify(broken)).ok,false,`atomic bad demand mutation ${index}`);assert.equal(sim.exportSave(),saved);}
  const snapshot=roadRepairDemand(sim.state,stateDemands(sim.state)!.demands[0].id)!;
  snapshot.from.x+=5; assert.notEqual(snapshot.from.x,stateDemands(sim.state)!.demands[0].from.x,'query does not expose mutable stored vectors');
});
test('the finite128 resident archive preserves every accepted cause and stops new requests without spending',()=>{
  const sim=new Simulation(demandWorld()), actors=sim.state.citizens.filter(c=>{
    const p=sim.state.extension!.actorProfiles[c.id], site=sim.worldDefinition.buildings.find(b=>b.id===c.workId);
    return p.alive&&p.age>=18&&site&&site.position.x>=100;
  }).slice(0,130);
  assert.equal(actors.length,130,'real original adult capacity, not new residents');
  for(const actor of actors) {
    actor.position=point(50); core(sim).activities[actor.id]='work'; core(sim).decisionAt[actor.id]=now(sim)+180;
    Reflect.get(sim,'setDestination').call(sim,actor,sim.worldDefinition.buildings.find(b=>b.id===actor.workId)!,true);
    assert.equal(actor.state,'moving');
  }
  flood(sim); const ds=stateDemands(sim.state)!;
  assert.equal(ds.demands.length,128); assert.equal(ds.nextId,129); assert.equal(sim.state.roadworks!.jobs.length,1);
  assert.equal(sim.state.roadworks!.jobs[0].funded,0); assert.equal(sim.state.roadworks!.jobs[0].paidGross,0);
  validateRoadDemandsState(sim.state,sim.worldDefinition); validateRoadworksState(sim.state,sim.worldDefinition);
  const saved=sim.exportSave(), broken=JSON.parse(saved);broken.state.roadDemands.demands.push({...broken.state.roadDemands.demands[0],id:'road-demand-129'});broken.state.roadDemands.nextId++;
  assert.equal(sim.importSave(JSON.stringify(broken)).ok,false);assert.equal(sim.exportSave(),saved);
});
test('resident public demand follows two genuine office signatures, original40, real material carrying and60 paid minutes',()=>{
  const {sim,actor,closure}=setup(), d=stateDemands(sim.state)!.demands.find(d=>d.actorId===actor.id)!, job=sim.state.roadworks!.jobs.find(j=>j.id===d.repairId)!;
  const beforeCash=cash(sim), originalWorld=JSON.stringify(sim.worldDefinition);
  const groups=new Map<string,Citizen[]>();
  for(const c of sim.state.citizens) {
    const p=sim.state.extension!.actorProfiles[c.id], site=sim.worldDefinition.buildings.find(b=>b.id===c.workId);
    if(!site||!['core','hall','bank'].includes(site.kind)||!['官员','财政官','official','议员','council'].includes(c.role)||!p.alive||p.age<18||p.health<45||c.needs.hunger<40||c.needs.fatigue<35)continue;
    const list=groups.get(site.id)??[];list.push(c);groups.set(site.id,list);
  }
  const pair=[...groups.entries()].find(([,staff])=>staff.length>=2); assert(pair,'two original qualified officers, no role/education injection');
  const staff=pair[1].slice(0,2), site=sim.worldDefinition.buildings.find(b=>b.id===pair[0])!, p=workPoint(site);
  assert.equal(sim.isAtBuildingFunctionPoint(site,p,'work',{role:'official',identities:['official']}),true);
  // One declared controlled initial office attendance. All following attendance,
  // approvals, worker willingness/movement/purchase/payments are actual core ticks.
  for(const c of staff) {c.position={...p};c.destinationId=site.id;c.route=[{...p}];c.routeIndex=1;core(sim).activities[c.id]='work';core(sim).decisionAt[c.id]=now(sim)+180;}
  const requesterCareer={role:actor.role,homeId:actor.homeId,workId:actor.workId}, events: object[]=[];
  sim.onEvent('roadwork-wage-paid',e=>events.push(structuredClone(e)));
  until(sim,()=>job.approvedAt!==null,20);
  assert.deepEqual([...job.approvedBy].sort(),staff.map(c=>c.id).sort()); assert.equal(job.authorizedCap,40); assert.equal(job.funded,40);
  assert.equal(job.requiredMinutes,60); assert(job.workerId,'existing willing original worker'); assert(job.ratePerMinute*60+4<40);
  const worker=sim.state.citizens.find(c=>c.id===job.workerId)!, workerCareer={role:worker.role,homeId:worker.homeId,workId:worker.workId};
  assert.equal(job.receivedUnits,0); assert.equal(job.workedMinutes,0);
  until(sim,()=>job.receivedUnits===1,160); assert.equal(job.receipts.length,1); assert.equal(job.receipts[0].quantity,1); assert.equal(job.workedMinutes,0,'purchase cannot remotely work'); exact24(sim);
  until(sim,()=>job.completedAt!==null,240);
  assert.equal(job.workedMinutes,60); assert.equal(job.consumedUnits,1); assert.equal(isRoadOpen(sim.state,closure.edgeId),true); assert.equal(closure.repairedBy,job.id);
  assert.equal(job.escrow,0); assert.equal(job.status,'completed'); assert.equal(job.serviceFees,0); assert.equal(events.length,job.laborReceipts.reduce((sum,r)=>sum+r.paymentCount,0));
  assert(Math.abs(job.funded-job.purchasePaid-job.paidGross-job.refunded)<1e-7); assert(Math.abs(job.paidGross-job.paidNet-job.paidTax)<1e-7);
  assert.equal(stateDemands(sim.state)!.demands.find(row=>row.id===d.id)!.resolvedAt,closure.reopenedAt);
  assert.equal(JSON.stringify(sim.worldDefinition),originalWorld); assert.deepEqual({role:actor.role,homeId:actor.homeId,workId:actor.workId},requesterCareer); assert.deepEqual({role:worker.role,homeId:worker.homeId,workId:worker.workId},workerCareer);
  assert(worker); assert(Math.abs(cash(sim)-beforeCash)<1e-5,'all actual wages/commerce/material/tax/refund remain conserved'); exact24(sim);
});
