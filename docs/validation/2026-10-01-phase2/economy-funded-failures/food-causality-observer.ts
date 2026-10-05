import {createWorld} from '../src/world';
import {Simulation} from '../src/simulation';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const world=createWorld(20261001),sim=new Simulation(world),kind=new Map(world.buildings.map(b=>[b.id,b.kind]));
sim.command({type:'speed',value:8});sim.setFocus(world.spawn,'walk');
const byKind:Record<string,{production:number,productionMinutes:number,publicConsumption:number,consumerUnits:number,wageEarned:number,wageMinutes:number}>=Object.fromEntries(['farm','workshop','dock','market'].map(k=>[k,{production:0,productionMinutes:0,publicConsumption:0,consumerUnits:0,wageEarned:0,wageMinutes:0}]));
const row=(shopId:string|undefined)=>{const shop=sim.state.shops.find(s=>s.id===shopId);return shop?byKind[kind.get(shop.buildingId)!]:undefined;};
sim.onEvent('production',e=>{const r=row(e.shopId);if(r){r.production+=e.amount??0;r.productionMinutes+=e.minutes??0;}});
sim.onEvent('sale',e=>{const r=row(e.shopId);if(r)r.consumerUnits+=e.quantity??1;});
sim.onEvent('wage-earned',e=>{const r=row(e.shopId);if(r){r.wageEarned+=e.amount??0;r.wageMinutes+=e.minutes??0;}});
for(const name of ['public-procurement','security-procurement','emergency-procurement','medical-procurement','civic-procurement'])sim.onEvent(name,e=>{const r=row(e.shopId);if(r)r.publicConsumption+=e.quantity??0;});
const core=()=>Reflect.get(sim,'runtime');
const snapshots:any[]=[];
const snapshot=()=>({tick:sim.state.tick,day:sim.state.day,hour:sim.state.hour,treasury:sim.state.treasury,energy:sim.state.energy,publicSupply:core().publicSupply??1,allDistrictEnergy:sim.state.districts.map(d=>({id:d.id,energy:d.energy,pollution:d.pollution})),byKind:structuredClone(byKind),shops:sim.state.shops.map(s=>({id:s.id,kind:kind.get(s.buildingId),districtId:s.districtId,inventory:s.inventory,open:s.open,employees:s.employees,cash:sim.shopFunds(s),protected:sim.shopProtectedFunds(s),ownerId:sim.state.extension!.companies.find(c=>c.buildingId===s.buildingId)?.ownerId??s.ownerId,actualAttendance:Object.values(core().privateLabor?.shifts?.[s.id]?.assignments??{}).reduce((n:any,a:any)=>n+a.workedMinutes,0),plannedMinutes:Object.values(core().privateLabor?.shifts?.[s.id]?.assignments??{}).reduce((n:any,a:any)=>n+a.minutesCap,0)})),npc:{alive:sim.state.citizens.filter(c=>sim.state.extension!.actorProfiles[c.id].alive).length,hunger:sim.state.citizens.reduce((n,c)=>n+c.needs.hunger,0)/sim.state.citizens.length,food:sim.state.citizens.reduce((n,c)=>n+(c.food??0),0),working:sim.state.citizens.filter(c=>c.state==='working').length},publicLabor:sim.publicServiceCoverage(),privateLabor:sim.privateLaborCoverage(),freight:structuredClone(core().freight),privateReview:structuredClone(core().privateLabor?.stats)});
snapshots.push(snapshot());
for(let tick=0;tick<11520;tick++){sim.step(.25);if(tick%1000===0)sim.setFocus(world.districts[Math.floor(tick/1000)%world.districts.length].center,tick%2000===0?'walk':'drone');if(sim.state.tick%720===0){const s=snapshot();snapshots.push(s);console.log(JSON.stringify({tick:s.tick,energy:s.energy,publicSupply:s.publicSupply,npc:s.npc,byKind:s.byKind}));}}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/food-causality-16d.json',JSON.stringify({seed:20261001,speed:8,ticks:sim.state.tick,snapshots},null,2));
await writeFile('artifacts/food-causality-16d.save.json',sim.exportSave());
