import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulation } from '../src/simulation.ts';
import { createArchivedProductCity, createDeliveredCityLifeProductCity, createLearningCityLifeProductCity } from '../src/product-city.ts';
import { upgradeResidentTuition } from '../src/host/upgrade-resident-tuition.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { fixture } from './education-fixture.ts';
const sha=(raw:string)=>createHash('sha256').update(raw).digest('hex');

test('new learning factory appends only two explicit declarations and old factories keep their exact imported future',async()=>{
  const world=fixture(false),old=await createDeliveredCityLifeProductCity(world),city=await createLearningCityLifeProductCity(world),raw=old.exportSave(),doc=JSON.parse(city.exportSave());
  assert.equal(city.residentTuitionPolicyId,'resident-formal-tuition-v1');assert.equal(city.state.residentEducation,undefined);assert.equal(doc.runtime.residentEducationVersion,undefined);assert.equal(doc.state.family.formalLearningVersion,undefined);
  delete doc.residentTuitionPolicyId;delete doc.runtime.residentTuitionPolicyId;assert.equal(JSON.stringify(doc),raw,'all original actors, wallets, materials, jobs, time and routes remain exact');assert.equal(old.residentTuitionPolicyId,'legacy');
  const result=city.importSave(raw);assert.equal(result.ok,true,result.message);assert.equal(city.residentTuitionPolicyId,'legacy');assert.equal(city.exportSave(),raw);
  for(let i=0;i<24;i++){old.step(.25);city.step(.25);assert.equal(city.exportSave(),old.exportSave(),`old declared future ${i+1}`);}
});
test('declared learning policy keeps byte order through real disk partitions and twenty-four native future frames',async()=>{
  const world=fixture(false),city=await createLearningCityLifeProductCity(world),raw=city.exportSave(),directory=mkdtempSync(join(tmpdir(),'resident-tuition-parts-'));
  try{
    const parts=partitionSave(raw,world);parts.forEach((p,i)=>writeFileSync(join(directory,String(i)),p.json));const assembled=assembleSave(parts.map((p,i)=>({id:p.id,json:readFileSync(join(directory,String(i)),'utf8')})));assert.equal(assembled,raw);
    const whole=new Simulation(world),partitioned=new Simulation(world);for(const [sim,json] of [[whole,raw],[partitioned,assembled]] as const){const result=sim.importSave(json);assert.equal(result.ok,true,result.message);assert.equal(sim.exportSave(),raw);}
    for(let i=0;i<24;i++){city.step(.25);whole.step(.25);partitioned.step(.25);assert.equal(whole.exportSave(),city.exportSave());assert.equal(partitioned.exportSave(),city.exportSave());}
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('native SHA cutover rejects wrong source and genuine advancement while hashing, then accepts unchanged currentv4',async()=>{
  const world=fixture(false),city=createArchivedProductCity(world),raw=city.exportSave();assert.equal((await upgradeResidentTuition(city,'0'.repeat(64))).ok,false);assert.equal(city.exportSave(),raw);
  const pending=upgradeResidentTuition(city,sha(raw));city.step(.25);const advanced=city.exportSave();assert.equal((await pending).ok,false);assert.equal(city.exportSave(),advanced);assert.equal(city.residentTuitionPolicyId,'legacy');
  assert.equal((await upgradeResidentTuition(city,sha(advanced))).ok,true);assert.equal(city.residentTuitionPolicyId,'resident-formal-tuition-v1');const upgraded=city.exportSave();assert.equal((await upgradeResidentTuition(city,sha(upgraded))).ok,false);assert.equal(city.exportSave(),upgraded);
});
