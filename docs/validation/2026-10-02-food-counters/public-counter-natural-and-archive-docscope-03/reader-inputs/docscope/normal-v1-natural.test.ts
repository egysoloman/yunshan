import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { foodDistributionController } from '../src/simulation/food-distribution';
const out='/tmp/yunshan-food-counter-normal-v1-natural-20261002';mkdirSync(out,{recursive:true});
test('normal generated old v1 paid city naturally reaches lawful original-duty continuation and FIFO return',()=>{
 const sim=new Simulation(createWorld()),old=readFileSync('/tmp/yunshan-food-counter-normal-v1-capture-20261002/paid-normal-v1-save.json','utf8'),r=sim.importSave(old);assert.equal(r.ok,true,r.message);const api=foodDistributionController(sim),c=sim.state.foodDistribution!.counters[0],workerId=c.tasks[0].citizenId,officials=[...c.approvedBy],rows:any[]=[],requests:any[]=[],original={workerId,workId:c.tasks[0].contract.workId,earned:c.tasks[0].earned,minutes:c.tasks[0].workedMinutes,stocks:structuredClone(c.stocks)};
 const record=()=>rows.push({time:sim.state.extension!.lastUpdate,hour:sim.state.hour,counter:{state:c.state,tasks:structuredClone(c.tasks),stocks:structuredClone(c.stocks)},actors:[...new Set([workerId,...officials])].map(id=>{const p=sim.state.citizens.find(p=>p.id===id)!;return{id,role:p.role,workId:p.workId,position:{...p.position},state:p.state,destinationId:p.destinationId,needs:{...p.needs},food:p.food??0,money:p.money,onDuty:sim.isOnDuty(id,p.workId)}})});
 const first=sim.exportSave(),firstClone=new Simulation(createWorld()),firstImport=firstClone.importSave(first);assert.equal(firstImport.ok,true,firstImport.message);assert.equal(firstClone.exportSave(),first);writeFileSync(`${out}/migrated-normal-save.json`,first);record();let planned=false,accepted=false;
 while(sim.state.extension!.lastUpdate<2400&&!(planned&&accepted)){
  sim.step(.25);if(sim.state.extension!.lastUpdate%60===0)record();
  if(Math.floor(sim.state.extension!.lastUpdate/1440)>=1&&sim.state.hour>=8&&sim.state.hour<17){
   if(!planned&&officials.every(id=>sim.isOnDuty(id,c.siteId))){const result=api.planNextDay(c.id,officials);requests.push({type:'actual lawful review',time:sim.state.extension!.lastUpdate,result});planned=result.ok;}
   if(planned&&!accepted&&sim.isOnDuty(workerId,c.siteId)){const result=api.accept(c.id,workerId);requests.push({type:'actual original continuation',time:sim.state.extension!.lastUpdate,result});accepted=result.ok;}
  }
 }
 if(accepted){const close=api.close(c.id);requests.push({type:'close and real return',time:sim.state.extension!.lastUpdate,result:close});for(let i=0;i<160&&c.state!=='closed'&&sim.state.hour<17;i++)sim.step(.25);}record();
 const save=sim.exportSave(),clone=new Simulation(createWorld()),restore=clone.importSave(save);const exact=restore.ok&&clone.exportSave()===save;writeFileSync(`${out}/natural-final-save.json`,save);if(exact)for(let i=0;i<24;i++){sim.step(.25);clone.step(.25);}const exact24=exact&&clone.exportSave()===sim.exportSave();writeFileSync(`${out}/natural-plus24-save.json`,sim.exportSave());writeFileSync(`${out}/proof.json`,JSON.stringify({scope:'new genuine original v1 writer normal createWorld fixture; natural ticks only, no setTime/player rescue/role/job/position/cash/stock/needs/deadline assignments',original,planned,accepted,finalClosed:c.state==='closed',rows,requests,fullSaveExact:exact,clone24TicksExact:exact24,originalEarnedRetained:c.tasks[0].earned===original.earned,originalMinutesRetained:c.tasks[0].workedMinutes===original.minutes},null,2)+'\n');
 assert.ok(exact,restore.message);assert.ok(exact24);assert.equal(c.tasks[0].earned,original.earned);assert.equal(c.tasks[0].workedMinutes,original.minutes);assert.ok(planned,'normal original city must naturally provide same-site true on-duty healthy quorum');assert.ok(accepted,'normal original employee must naturally return and continue funded original duty');assert.equal(c.state,'closed');
});
