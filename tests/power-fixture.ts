// Named actor position/needs controls isolate the functional task;
// no promised public shift, wage, stock or money is fabricated by these helpers.
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { getBuildingUsePoints, floorPlanSupport, blocksFloorPlanMovement } from '../src/architecture-floor-plan.ts';
import type { Building, Citizen, WorldDefinition } from '../src/types.ts';
export function powerWorld(marked = true): WorldDefinition {
  const kinds: Building['kind'][] = ['home','farm','market','workshop','workshop','core','school','clinic','bank','hall','station','workshop'];
  const buildings = kinds.map((kind,index): Building => {
    const id = index === 4 ? 'core-energy-south' : index === 5 ? 'core-main' : 'power-' + index;
    const b: Building = { id,name:id,kind,districtId:'power-district',position:{x:index*50,y:0,z:0},door:{x:index*50,y:.6,z:19},width:50,depth:38,height:11.4,floors:3,rotation:0,capacity:120,seed:index+7 };
    if (index === 4) { b.facility='energy'; b.publicFloors=1; b.requiredPermission='driver'; }
    if (index === 5) { b.facility='mayor'; b.publicFloors=1; b.requiredPermission='mayor'; }
    if (marked && kind !== 'core') { b.floorPlanProfile='v4-program-bodies-02'; b.functionPoints=Array.from({length:b.floors},(_,floor)=>getBuildingUsePoints(b,floor)).flat(); }
    return b;
  });
  const nodes = buildings.map(b=>({id:b.id+'-door',name:b.name,districtId:b.districtId,position:{...b.door},station:true}));
  const edges: WorldDefinition['edges'] = nodes.slice(1).map((node,index)=>({id:'power-road-'+index,from:nodes[index].id,to:node.id,mode:'road',length:Math.hypot(node.position.x-nodes[index].position.x,node.position.y-nodes[index].position.y,node.position.z-nodes[index].position.z),capacity:20,points:[nodes[index].position,node.position]}));
  return {seed:911,voxelSize:.2,size:2000,buildings,nodes,edges,districts:[{id:'power-district',name:'受控能源街区',kind:'school',center:{x:250,y:0,z:0},radius:1000,color:'#888888',population:384}],mountains:[],river:[],spawn:{...nodes[0].position},waterfall:{top:{x:900,y:100,z:900},bottom:{x:900,y:0,z:900},width:10}};
}
export const core = (sim: Simulation) => Reflect.get(sim,'runtime');
export const at = (sim: Simulation) => sim.state.extension!.lastUpdate;
export function ticks(sim:Simulation,n:number) { for(let i=0;i<n;i++) sim.step(.25); }
export function workPoint(site:Building) {
  if (!site.floorPlanProfile) return {x:site.position.x,y:site.position.y+.6,z:site.position.z+1.2};
  const point=site.functionPoints!.find(p=>p.floor===0 && p.purpose==='work' && !!floorPlanSupport(site,0,p.position,.35) && !blocksFloorPlanMovement(site,0,p.position,p.position,.35,1.72));
  assert(point,'fixture must have actual .35 supported clear control point'); return {...point.position};
}
export function controlTechnician(sim:Simulation,id?:string,resume=false) {
  const site=sim.worldDefinition.buildings.find(b=>b.id==='core-energy-south')!, point=workPoint(site);
  const actor=id ? sim.state.citizens.find(c=>c.id===id)! : sim.state.citizens.find(c=>c.workId===site.id && ['工程师','scientist','科学家'].includes(c.role) && sim.state.extension!.actorProfiles[c.id].alive && sim.state.extension!.actorProfiles[c.id].age>=18)!;
  assert(actor,'must select an existing generated qualified adult operator');
  let present=true;
  const place=()=> { if(!present)return; actor.position={...point};actor.destinationId=site.id;actor.route=[{...point}];actor.routeIndex=1;actor.needs={hunger:100,fatigue:100,social:100,fun:100};core(sim).activities[actor.id]='work';core(sim).decisionAt[actor.id]=sim.state.day*1440+sim.state.hour*60+10; };
  const original=Reflect.get(sim,'setDestination'); Reflect.set(sim,'setDestination',(person:Citizen,destination:Building,rebuild=false)=>{if(present&&person.id===actor.id&&destination.id===site.id){person.destinationId=site.id;person.route=[{...point}];person.routeIndex=1;return;}return original.call(sim,person,destination,rebuild);});
  sim.onPhase('traffic',place);if(!resume){place();sim.setFocus(point,'drone');}
  return {actor,site,point,leave(){present=false;actor.position={...sim.worldDefinition.spawn};actor.route=[];actor.destinationId=null;core(sim).activities[actor.id]='social';core(sim).decisionAt[actor.id]=sim.state.day*1440+sim.state.hour*60+100;},enter(){present=true;place();}};
}
export function genuineFault(sim:Simulation) {
  // Controlled native weather/probability branch, not a fake event or a damage
  // edit. Original environment effects, procurement, health and delay all run.
  sim.state.weather='雨';sim.state.extension!.environment.stormRisk=100;sim.state.extension!.environment.disasterAt=at(sim);core(sim).weatherAt=sim.state.day*1440+sim.state.hour*60+10000;
  const old=sim.nextRandom.bind(sim);Reflect.set(sim,'nextRandom',()=>0);sim.step(.25);Reflect.set(sim,'nextRandom',old);
  assert(sim.state.power?.faults.length,'real original environment branch must cause a new source-district fault');return sim.state.power!;
}
export function setupPaid(marked=true) {
  const sim=new Simulation(powerWorld(marked));sim.command({type:'speed',value:8});const presence=controlTechnician(sim);genuineFault(sim);
  sim.state.player.role='scientist';sim.state.player.identities=['traveler','scientist','mayor'];sim.state.player.needs={hunger:100,fatigue:100,social:100,fun:100};
  const source=sim.worldDefinition.buildings.find(b=>b.id==='core-main')!;sim.setFocus(workPoint(source),'walk');
  const old=sim.state.power!.repairs.find(job=>!['completed','cancelled'].includes(job.status));if(old){const result=sim.command({type:'cancelEnergy',targetId:old.id});assert(result.ok,result.message);}
  const money=sim.state.player.money, result=sim.command({type:'energy',targetId:source.id});assert(result.ok,result.message);const job=sim.state.power!.repairs.at(-1)!;assert.equal(sim.state.player.money,money-100);assert.equal(job.escrow,100);
  return {sim,presence,job,source};
}
export function restore(sim:Simulation,pinnedId?:string) {const next=new Simulation(sim.worldDefinition),result=next.importSave(sim.exportSave());assert(result.ok,result.message);assert.equal(next.exportSave(),sim.exportSave());if(pinnedId)controlTechnician(next,pinnedId,true);return next;}
export function cash(sim:Simulation) {const s=sim.state,e=s.extension!,r=core(sim);return s.treasury+r.taxes+s.player.money+(s.banking?.cash??0)+(s.banking?.legacyInvestmentCash??0)+s.citizens.reduce((sum,c)=>sum+c.money,0)+s.shops.filter(shop=>!e.companies.some(c=>c.buildingId===shop.buildingId)).reduce((sum,shop)=>sum+(shop.cash??0),0)+e.companies.reduce((sum,c)=>sum+c.capital,0)+e.organizations.reduce((sum,o)=>sum+o.funds,0)+(s.family?.pregnancies.reduce((sum,p)=>sum+p.escrow,0)??0)+(s.family?.households.reduce((sum,h)=>sum+h.balance,0)??0)+(s.clinical?.orders.reduce((sum,o)=>sum+o.escrow,0)??0)+(s.education?.course?.escrow??0)+(s.playerLabor?.job?.escrow??0)+(s.power?.repairs.reduce((sum,j)=>sum+j.escrow,0)??0);}
