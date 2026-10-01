import {createWorld} from '../src/world';
import {Simulation} from '../src/simulation';
import {writeFile,mkdir} from 'node:fs/promises';

const sim=new Simulation(createWorld(20261001));
await mkdir('artifacts',{recursive:true});
sim.command({type:'speed',value:8});
sim.setFocus(sim.worldDefinition.spawn,'walk');
let loaded=0, unitsLoaded=0, arrivalUnits=0;
const loadEvents:any[]=[];
sim.onEvent('cargo-loaded',event=>{ loaded++; unitsLoaded+=event.amount??0; loadEvents.push({...event,tick:sim.state.tick}); });
sim.onEvent('cargo-arrived',event=>{ arrivalUnits+=event.amount??0; });
for(let tick=0;tick<720;tick++) {
  sim.step(.25);
  if(tick%1000===0) sim.setFocus(sim.worldDefinition.districts[Math.floor(tick/1000)%sim.worldDefinition.districts.length].center,tick%2000===0?'walk':'drone');
}
const runtime=Reflect.get(sim,'runtime');
const result={scope:'One actual default game day on the isolated reload prototype; neither a long-term audit nor an equivalent baseline trajectory.',ticks:sim.state.tick,loaded,unitsLoaded,arrivalUnits,loadEvents,treasury:sim.state.treasury,meanHunger:sim.state.citizens.reduce((sum,c)=>sum+c.needs.hunger,0)/sim.state.citizens.length,alive:sim.state.citizens.filter(c=>sim.state.extension!.actorProfiles[c.id].alive).length,foodShopStock:sim.state.shops.filter(s=>sim.shopCommodity(s)==='food').reduce((sum,s)=>sum+s.inventory,0),freightPool:Object.values(runtime.freight as Record<string,number>).reduce((sum,q)=>sum+q,0),cargo:sim.state.vehicles.reduce((sum,v)=>sum+v.cargo,0)};
await writeFile('artifacts/freight-city-prefix.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,loadEvents:undefined}));
