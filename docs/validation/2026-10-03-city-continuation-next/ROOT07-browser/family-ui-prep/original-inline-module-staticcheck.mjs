
import '/src/style.css';
import {Simulation} from '/src/simulation.ts';
import {CityUI} from '/src/ui.ts';
import {familyEducationHeldCash} from '/src/simulation/family-education.ts';
import {getBuildingBody} from '/src/architecture-floor-plan.ts';
const world=await (await fetch('/output/family-fee-education/ui-world.json')).json();
const saved=await (await fetch('/output/family-fee-education/ui-opening.save.json')).text();
const controls=await (await fetch('/output/family-fee-education/ui-controls.json')).json();
const sim=new Simulation(world), loaded=sim.importSave(saved);
if(!loaded.ok||sim.exportSave()!==saved)throw Error('Original UI fixture save did not import exactly: '+loaded.message);
const runtime=Reflect.get(sim,'runtime'), pins=new Map(controls.entries), original=Reflect.get(sim,'setDestination');
Reflect.set(sim,'setDestination',(person,destination,rebuild=false)=>{const value=pins.get(person.id);if(value?.siteId===destination.id){person.destinationId=destination.id;person.route=[{...value.position}];person.routeIndex=1;return;}return original.call(sim,person,destination,rebuild);});
sim.onPhase('traffic',()=>{for(const [id,value]of pins){const person=sim.state.citizens.find(p=>p.id===id);person.position={...value.position};person.destinationId=value.siteId;person.route=[{...value.position}];person.routeIndex=1;person.needs={hunger:100,fatigue:100,social:100,fun:100};runtime.activities[id]=id===controls.childId&&value.siteId===controls.siteId?'study':value.activity;runtime.decisionAt[id]=sim.state.day*1440+sim.state.hour*60+10;}sim.state.player.needs.hunger=sim.state.player.needs.fatigue=100;});
const site=world.buildings.find(b=>b.id===controls.siteId),home=world.buildings.find(b=>b.id===controls.homeId),child=sim.state.citizens.find(p=>p.id===controls.childId);
const classroom={...child.position};sim.setFocus(classroom,'walk');
const view={mode:'walk',quality:'balanced',fps:60,drawCalls:0,triangles:0,position:{...classroom},nearbyBuilding:site,nearbyCitizen:null,nearbyVehicle:null,targetDistrict:null,inside:!!getBuildingBody(site),renderDistance:3600,fpsCap:60,dynamicResolution:true,simulationDetail:1};
let ui;const calls=[];
const actions={command(command){const result=sim.command(command);calls.push({command,result});ui.notify(result.message,result.ok);ui.update(sim.state,view)},isAtBuildingFunctionPoint(id,purpose){const b=world.buildings.find(b=>b.id===id);return !!b&&sim.isAtBuildingFunctionPoint(b,sim.state.player.position,purpose)},setMode(mode){view.mode=mode;ui.update(sim.state,view)},setQuality(q){view.quality=q;ui.update(sim.state,view)},interact(){},save(){},load(){},exportSave(){},importSave(){},setSetting(){},resetView(){}};
ui=new CityUI(document.getElementById('app'),world,actions);ui.update(sim.state,view);
window.fee={sim,world,site,home,child,pins,runtime,ui,view,calls,controls,classroom,familyEducationHeldCash,
refresh(){view.position={...sim.state.player.position};ui.update(sim.state,view)},
advance(ticks){for(let i=0;i<ticks;i++)sim.step(.25);this.refresh()},
placeChild(where){const b=where==='home'?home:site,pos=where==='home'?home.door:classroom;const value=pins.get(child.id);value.siteId=b.id;value.position={...pos};value.activity='social';child.position={...pos};child.destinationId=b.id;child.route=[{...pos}];child.routeIndex=1;runtime.decisionAt[child.id]=sim.state.day*1440+sim.state.hour*60+10;this.refresh()},
cash(){const s=sim.state,e=s.extension;return s.treasury+runtime.taxes+s.player.money+s.banking.cash+s.banking.legacyInvestmentCash+s.citizens.reduce((sum,p)=>sum+p.money,0)+s.shops.filter(shop=>!e.companies.some(c=>c.buildingId===shop.buildingId)).reduce((sum,p)=>sum+(p.cash??0),0)+e.companies.reduce((sum,c)=>sum+c.capital,0)+e.organizations.reduce((sum,o)=>sum+o.funds,0)+(s.playerLabor?.job?.escrow??0)+(s.education?.course?.escrow??0)+s.clinical.orders.reduce((sum,o)=>sum+o.escrow,0)+s.family.pregnancies.reduce((sum,p)=>sum+p.escrow,0)+s.family.households.reduce((sum,h)=>sum+h.balance,0)+familyEducationHeldCash(s)}
};setInterval(()=>window.fee.refresh(),100);window.ready=true;
