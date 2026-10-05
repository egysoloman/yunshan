import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root='/workspace/yunshan-work/ROOT16-food-integration-20261005-01',source=join(root,'baseline-source'),out=join(root,'outputs/full-partition24-01');
mkdirSync(out,{recursive:true});const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const json=(n:string,v:unknown)=>writeFileSync(join(out,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const load=(p:string)=>import(pathToFileURL(join(source,p)).href);
const {Simulation}=await load('src/simulation.ts');const {partitionSave,assembleSave}=await load('src/persistence/partition.ts');
const raw=readFileSync(join(root,'outputs/all229-continuation01/terminal.save.json'),'utf8');assert.equal(sha(raw),'edf73ed2aa923b16248f3981092ea78dfe6375e5be1a4d4e3c6914ca84285754');
const worldRaw=readFileSync(join(root,'originals/WORLD-ORIGINAL.json'),'utf8');assert.equal(sha(worldRaw),'2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512');const world=JSON.parse(worldRaw);
const parts=partitionSave(raw);writeFileSync(join(out,'terminal.parts.json'),JSON.stringify(parts),{flag:'wx'});const partsRead=JSON.parse(readFileSync(join(out,'terminal.parts.json'),'utf8'));const assembled=assembleSave(partsRead);assert.equal(assembled,raw);
const restore=(s:string)=>{const sim=new Simulation(world,{rulesetId:'civic-local-v1'});const result=sim.importSave(s);assert.equal(result.ok,true,result.message);assert.equal(sim.exportSave(),s);return sim;};const full=restore(raw),partition=restore(assembled);
const expected=JSON.parse(raw);assert.equal(expected.state.tick,1104);assert.equal(expected.state.speed,8);
const frames=[];for(let i=0;i<24;i++){full.step(.25);partition.step(.25);const a=full.exportSave(),b=partition.exportSave();assert.equal(a,b,`future ${i+1} whole and partition exact`);assert.equal(full.state.tick,1105+i);assert.deepEqual(full.state.lastSystemOrder,['time','environment','energy','traffic','people','commerce','finance','security','politics','feedback']);frames.push({futureTick:i+1,tick:full.state.tick,sha256:sha(a)});}
const future=full.exportSave();writeFileSync(join(out,'future24.save.json'),future,{flag:'wx'});const reader=restore(readFileSync(join(out,'future24.save.json'),'utf8'));assert.equal(reader.exportSave(),future);
json('SUMMARY.json',{status:'PASS',startSHA256:sha(raw),futureSHA256:sha(future),partsSHA256:sha(readFileSync(join(out,'terminal.parts.json'))),immediateWholePartitionByteEqual:true,futureTicks:24,actualStepSeconds:.25,speed:8,frames,boundary:'Whole and partition deterministic continuation; no independent ancient-engine oracle, long-term simulation or renderer claim.'});console.log(JSON.stringify({status:'PASS',futureSHA256:sha(future),futureTicks:24}));
