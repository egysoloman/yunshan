import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync,mkdirSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { foodDistributionController } from '../src/simulation/food-distribution';
const out='/tmp/yunshan-food-counter-normal-v1-capture-20261002';mkdirSync(out,{recursive:true});
test('old v1 writer captures a normal generated city counter and actual original wage payment without actor/timer fixture edits',()=>{
 const sim=new Simulation(createWorld()),api=foodDistributionController(sim),initial=sim.exportSave(),payments:any[]=[],requests:any[]=[],rows:any[]=[];let selected:{siteId:string;workerId:string;officials:string[]}|null=null;
 sim.onEvent('wage-paid',e=>payments.push({...e,time:sim.state.extension!.lastUpdate}));assert.equal(sim.command({type:'speed',value:16}).ok,true);
 for(let tick=0;tick<135;tick++){
  sim.step(.25);if(!selected&&sim.state.hour<17){
   const groups=new Map<string,string[]>();for(const person of sim.state.citizens){const site=sim.worldDefinition.buildings.find(b=>b.id===person.workId)!;if(['官员','official','council','mayor'].includes(person.role)&&['hall','core','bank'].includes(site.kind)&&sim.isOnDuty(person.id,site.id)&&person.needs.hunger>=40&&person.needs.fatigue>=35){const group=groups.get(site.id)??[];group.push(person.id);groups.set(site.id,group);}}
   for(const [reviewSite,officials]of groups){if(officials.length<2)continue;const review=sim.worldDefinition.buildings.find(b=>b.id===reviewSite)!;
    const candidates=sim.worldDefinition.buildings.filter(b=>['school','hall','station'].includes(b.kind)&&b.districtId===review.districtId).map(site=>({site,worker:sim.state.citizens.find(p=>p.workId===site.id&&p.role!=='学生'&&sim.isOnDuty(p.id,site.id)&&p.needs.hunger>=30&&p.needs.fatigue>=25)})).filter(r=>r.worker&&sim.state.shops.some(shop=>shop.districtId===r.site.districtId&&sim.shopCommodity(shop)==='materials'&&shop.inventory>=1));
    for(const {site,worker}of candidates){const signatures=officials.slice(0,2),r=api.register(site.id,signatures);requests.push({time:sim.state.extension!.lastUpdate,type:'register',siteId:site.id,workerId:worker!.id,signatures,result:r});if(!r.ok)continue;const c=sim.state.foodDistribution!.counters.at(-1)!,procurement=api.procure(c.id),accepted=api.accept(c.id,worker!.id);requests.push({time:sim.state.extension!.lastUpdate,type:'procure and accept',procurement,accepted});if(procurement.ok&&accepted.ok){selected={siteId:site.id,workerId:worker!.id,officials:signatures};break;}}
    if(selected)break;
   }
  }
  if(tick%15===0)rows.push({time:sim.state.extension!.lastUpdate,hour:sim.state.hour,counters:structuredClone(sim.state.foodDistribution?.counters??[]),treasury:sim.state.treasury});
 }
 const workerPaid=selected?payments.filter(p=>p.citizenId===selected!.workerId).reduce((n,p)=>n+p.amount,0):0;writeFileSync(`${out}/initial-city-save.json`,initial);writeFileSync(`${out}/paid-normal-v1-save.json`,sim.exportSave());writeFileSync(`${out}/capture-proof.json`,JSON.stringify({scope:'actual old v1 writer; normal createWorld() initialization and natural .step(.25), only speed16 and legal counter controller APIs; no wallet/stock/roles/jobs/position/needs/deadline/clock assignments',selected,workerPaid,requests,rows,payments,finalTime:sim.state.extension!.lastUpdate},null,2)+'\n');assert.ok(selected,'normal generated city must actually offer lawful two officials, original funded worker and industrial material at a common public site');assert.ok(workerPaid>0,'original public wage payment must actually occur before this is a paid v1 fixture');
});
