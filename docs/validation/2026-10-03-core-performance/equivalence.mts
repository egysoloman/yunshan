import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Simulation as BeforeSimulation} from '../before/src/simulation.ts';
import {Simulation as AfterSimulation} from '../after/src/simulation.ts';
import {createWorld as beforeWorld} from '../before/src/world.ts';
import {createWorld as afterWorld} from '../after/src/world.ts';
const out=process.argv[2];await mkdir(out+'/evidence',{recursive:true});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const seed=20261001,order=['time','environment','energy','traffic','people','commerce','finance','security','politics','feedback'];
const aWorld=beforeWorld(seed),bWorld=afterWorld(seed);
assert.equal(JSON.stringify(aWorld),JSON.stringify(bWorld));const initialWorld=JSON.stringify(aWorld);
const before=new BeforeSimulation(aWorld),after=new AfterSimulation(bWorld);
assert.equal(before.exportSave(),after.exportSave());
const phaseTimes:{before:Record<string,number>,after:Record<string,number>}={before:{},after:{}};
for(const [key,sim] of [['before',before],['after',after]] as const){
 const bus=Reflect.get(sim,'bus'),emit=bus.emit;
 bus.emit=function(event: {type:string}){const t=performance.now();try{return Reflect.apply(emit,this,[event]);}finally{if(event.type.startsWith('system:'))phaseTimes[key][event.type.slice(7)]=(phaseTimes[key][event.type.slice(7)]??0)+(performance.now()-t);}};
}
const rows=[];
async function preserve(index:number){const a=before.exportSave(),b=after.exportSave();
 await writeFile(out+'/evidence/before-'+index.toString().padStart(2,'0')+'.save.json',a);
 await writeFile(out+'/evidence/after-'+index.toString().padStart(2,'0')+'.save.json',b);
 assert.equal(b,a,'complete state/runtime/RNG/routepool/module save at tick '+index);return hash(a);}
await preserve(0);
for(let index=1;index<=32;index++){
 phaseTimes.before={};phaseTimes.after={};const times:{before?:number,after?:number}={};
 const schedule=index%2?[['before',before],['after',after]]:[['after',after],['before',before]];
 for(const [key,sim] of schedule){const start=performance.now();(sim as typeof before).step(.25);times[key as 'before'|'after']=performance.now()-start;}
 assert.equal(before.state.tick,index);assert.equal(after.state.tick,index);assert.equal(before.state.citizens.length,616);assert.equal(after.state.citizens.length,616);
 assert.deepEqual(before.state.lastSystemOrder,order);assert.deepEqual(after.state.lastSystemOrder,order);
 assert.equal(before.state.speed,1);assert.equal(after.state.speed,1);
 const coreSha256=await preserve(index);
 const row={tick:index,clock:before.state.day*1440+before.state.hour*60,coreSha256,stepMs:times,phaseMs:structuredClone(phaseTimes),executionOrder:schedule.map(([name])=>name)};
 rows.push(row);await writeFile(out+'/evidence/rows.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(row));
}
assert.equal(JSON.stringify(aWorld),initialWorld);assert.equal(JSON.stringify(bWorld),initialWorld);
await writeFile(out+'/evidence/result.json',JSON.stringify({status:'PASS_EXACT_32_TICKS_NOT_FPS',seed,layout:'current-v4',citizens:616,steps:32,wholeSaveIdentical:true,worldUnchanged:true,phaseOrder:order,rows},null,2)+'\n');
console.log('PASS original and optimized complete saves exact at initial and all 32 actual quarter-second ticks');
