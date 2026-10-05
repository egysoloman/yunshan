import assert from 'node:assert/strict';
import { getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import { Simulation } from '../src/simulation.ts';
import { powerWorld, core, at } from './power-fixture.ts';
import { roadClosure } from '../src/roads.ts';
import { roadworksStatus } from '../src/simulation/roadworks.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';

// Deliberately small unmarked synthetic world, declared BEFORE constructors.
// Retains generated residents, wallets, needs, identities, education, materials
// and production data; source is the actual original storm branch, not emitEvent.
export function roadworksWorld(warehouseNear = true) {
  const world = powerWorld(false);
  world.river = [{ x: 62, y: 0, z: -30 }, { x: 62, y: 0, z: 70 }];
  // A complete declared dry detour makes the original residents and supplier
  // connected after the short river edge closes. This is a PRE-constructor
  // test graph, not a free road inserted by a running city/repair order.
  const bends = [{ id: 'roadworks-detour-west', name: '旱路西弯', districtId: 'power-district', station: false, position: { x: 50, y: .6, z: 200 } },
    { id: 'roadworks-detour-east', name: '旱路东弯', districtId: 'power-district', station: false, position: { x: 100, y: .6, z: 200 } }];
  world.nodes.push(...bends);
  const points = [world.nodes.find(n => n.id === 'power-1-door')!, ...bends, world.nodes.find(n => n.id === 'power-2-door')!];
  for (let i = 1; i < points.length; i++) world.edges.push({ id: 'roadworks-detour-' + i, from: points[i-1].id, to: points[i].id,
    mode: 'road', length: Math.hypot(points[i].position.x-points[i-1].position.x, points[i].position.z-points[i-1].position.z), capacity: 20, points: [{ ...points[i-1].position }, { ...points[i].position }] });
  if (warehouseNear) {
    // Approved PRE-constructor feasible lifecycle map: move only the original
    // remote warehouse/building/node to an empty plot, preserving its original
    // materials90/owner/cash/population/qualifications. Runtime never moves it.
    const warehouse=world.buildings.find(b=>b.id==='power-11')!, node=world.nodes.find(n=>n.id==='power-11-door')!;
    warehouse.position={x:0,y:0,z:80};warehouse.door={x:0,y:.6,z:99};node.position={...warehouse.door};
    for(const edge of world.edges.filter(e=>e.from===node.id||e.to===node.id)) {
      const a=world.nodes.find(n=>n.id===edge.from)!.position,b=world.nodes.find(n=>n.id===edge.to)!.position;
      edge.points=[{...a},{...b}];edge.length=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    }
    const home=world.nodes.find(n=>n.id==='power-0-door')!;
    world.edges.push({id:'roadworks-original-warehouse-access',from:home.id,to:node.id,mode:'road',length:80,capacity:20,points:[{...home.position},{...node.position}]});
  }
  return world;
}
export function setupRoadworks(warehouseNear = true) {
  const sim = new Simulation(roadworksWorld(warehouseNear));
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const originalWorld = JSON.stringify(sim.worldDefinition), openDistance = sim.buildingTravelDistance('power-1', 'power-2');
  assert.ok(Number.isFinite(openDistance), 'prime the actual original shortest road before closure');
  // Controlled native weather/RNG one-time trigger. No direct closures/faults,
  // fake disaster event, cash, materials, primary jobs or skills are inserted.
  sim.state.weather = '雨'; sim.state.extension!.environment.stormRisk = 100;
  sim.state.extension!.environment.disasterAt = at(sim); core(sim).weatherAt = sim.state.day * 1440 + sim.state.hour * 60 + 10000;
  const original = sim.nextRandom.bind(sim); Reflect.set(sim, 'nextRandom', () => 0);
  sim.step(.25); Reflect.set(sim, 'nextRandom', original);
  const closure = sim.state.roadNetwork!.closures.at(-1)!;
  assert.ok(closure, 'the original canonical storm must close a true river-side road');
  assert.equal(roadClosure(sim.state, closure.edgeId)?.id, closure.id);
  assert.equal(closure.edgeId, 'power-road-1', 'canonical nearest river crossing, not arbitrary closure selection');
  assert.ok(sim.buildingTravelDistance('power-1','power-2') > openDistance, 'closure revision forces the actual longer dry detour');
  assert.equal(JSON.stringify(sim.worldDefinition), originalWorld, 'all world geometry remains immutable');
  // One initial player focus at the true existing safe end only. Future repair
  // worker movement uses the core task routes; never repeated pins/needs resets.
  sim.setFocus(closure.worksite, 'walk');
  return { sim, closure, openDistance };
}
export function request(context: ReturnType<typeof setupRoadworks>) {
  const { sim, closure } = context, wallet = sim.state.player.money;
  const result = sim.command({ type: 'requestRoadRepair', targetId: closure.edgeId, value: 0 });
  assert.equal(result.ok, true, result.message); assert.equal(sim.state.player.money, wallet - 100);
  const job = roadworksStatus(sim.state, closure.edgeId).job!;
  assert.equal(job.funded, 100); assert.equal(job.escrow, 100);
  return job;
}
export function cash(sim: Simulation) {
  const s = sim.state, e = s.extension!;
  return s.treasury + core(sim).taxes + s.player.money + (s.banking?.cash ?? 0) + (s.banking?.legacyInvestmentCash ?? 0)
    + s.citizens.reduce((sum,c) => sum+c.money,0)
    + s.shops.filter(shop => !e.companies.some(company => company.buildingId===shop.buildingId)).reduce((sum,shop) => sum+(shop.cash??0),0)
    + e.companies.reduce((sum,c) => sum+c.capital,0) + e.organizations.reduce((sum,o) => sum+o.funds,0)
    + (s.family?.pregnancies.reduce((sum,p) => sum+p.escrow,0)??0)+(s.family?.households.reduce((sum,h) => sum+h.balance,0)??0)
    + (s.playerLabor?.job?.escrow??0)+(s.clinical?.orders.reduce((sum,o) => sum+o.escrow,0)??0)
    + (s.education?.course?.escrow??0)+(s.power?.repairs.reduce((sum,j) => sum+j.escrow,0)??0)
    + (s.hygiene?.jobs.reduce((sum,j) => sum+j.escrow,0)??0)+(s.shopLifecycle?.leases.reduce((sum,l) => sum+l.depositEscrow,0)??0)
    + (s.roadworks?.jobs.reduce((sum,j) => sum+j.escrow,0)??0);
}
export function exact24(sim: Simulation, observe?: (name: string, live: Simulation, clone?: Simulation) => void) {
  const clone = new Simulation(sim.worldDefinition), saved = sim.exportSave();
  assert.equal(assembleSave(partitionSave(saved,sim.worldDefinition)),saved,'full road body/custody/escrow partition roundtrip stays byte exact');
  const result = clone.importSave(saved);
  observe?.('before-clone',sim);observe?.('after-import',sim,clone);
  assert.equal(result.ok,true,result.message);assert.equal(clone.exportSave(),saved);
  for(let i=0;i<24;i++){sim.step(.25);clone.step(.25);observe?.(`tick${i+1}`,sim,clone);assert.equal(clone.exportSave(),sim.exportSave(),`full exact road tick${i+1}`);}
}
export function until(sim: Simulation, condition: ()=>boolean, maxTicks = 900) {
  for(let i=0;i<maxTicks&&!condition();i++)sim.step(.25);
  assert.ok(condition(),'finite true movement/labor limit; no role/cash/needs/position/time retries');
}

/** One-time authority and original-office presence fixtures. Officials retain
 * their exact original role/education/needs/craft/wallet/workId/homeId. Their
 * duty/wage windows are produced by the next ordinary people phase, not seeded.
 */
export function publicContext() {
  const context=setupRoadworks(), {sim}=context;
  sim.state.player.role='mayor';sim.state.player.identities=[...new Set([...(sim.state.player.identities??[]),'mayor' as const])];
  const groups=new Map<string,typeof sim.state.citizens>();
  for(const c of sim.state.citizens) {
    const p=sim.state.extension!.actorProfiles[c.id],site=sim.worldDefinition.buildings.find(b=>b.id===c.workId);
    if(!site||!['core','hall','bank'].includes(site.kind)||!['官员','财政官','official','议员','council'].includes(c.role)||!p.alive||p.age<18||p.health<45||c.needs.hunger<40||c.needs.fatigue<35)continue;
    const list=groups.get(site.id)??[];list.push(c);groups.set(site.id,list);
  }
  const pair=[...groups.entries()].find(([,staff])=>staff.length>=2);assert.ok(pair,'constructor must provide original qualified two officials, not fabricated seats');
  const site=sim.worldDefinition.buildings.find(b=>b.id===pair[0])!;
  // Genuine unmarked buildings use the original reachable legacy work point;
  // getBuildingUsePoints intentionally supplies only marked v4 bodies.
  const point=getBuildingUsePoints(site,0).find(p=>p.purpose==='work') ?? (!site.floorPlanProfile ? {purpose:'work' as const,floor:0,position:{x:site.position.x,y:site.position.y+.6,z:site.position.z+1.2}} : undefined);
  assert.ok(point,'existing original legal office point');
  assert.equal(sim.isAtBuildingFunctionPoint(site,point.position,'work',{role:'official',identities:['official']}),true,'actual core legacy or marked use-point contract, not a forced override');
  const staff=pair[1].slice(0,2), originals=staff.map(c=>({id:c.id,role:c.role,education:c.education,money:c.money,skills:structuredClone(c.skills),homeId:c.homeId,workId:c.workId,needs:structuredClone(c.needs)}));
  for(const c of staff) {
    c.position={...point.position};c.destinationId=site.id;c.route=[{...point.position}];c.routeIndex=1;
    core(sim).activities[c.id]='work';core(sim).decisionAt[c.id]=sim.state.day*1440+sim.state.hour*60+60;
  }
  assert.deepEqual(staff.map(c=>({id:c.id,role:c.role,education:c.education,money:c.money,skills:c.skills,homeId:c.homeId,workId:c.workId,needs:c.needs})),originals);
  return {...context,site,point,staff};
}
