import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createProductCity, createArchivedProductCity } from '../src/product-city';
import { upgradeCivicHistoryFormat } from '../src/host/upgrade-civic-history-format';
import { civicCouncilSourceProof } from '../src/simulation/civic-staffing';
import { validateBudgetSignatureV2, type BudgetSignatureV2 } from '../src/simulation/budget-authority';
import { civicHistoryView } from '../src/simulation/civic-history';
import { assembleSave, partitionSave } from '../src/persistence/partition';
const file=(name:string)=>readFileSync(new URL(`./fixtures/budget-authority/${name}`,import.meta.url));
const world=JSON.parse(file('world.json').toString()),captured=JSON.parse(file('paid-signatures.json').toString()),provenance=JSON.parse(file('provenance.json').toString());
const original=gunzipSync(file('canonical-pair.save.json.gz')).toString('utf8');
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const sameSave=(actual:string,expected:string,label:string)=>assert.ok(actual===expected,`${label}; actualSHA=${hash(actual)}, expectedSHA=${hash(expected)}`);
function record(name:string,value:unknown){const dir=process.env.CIVIC_HISTORY_EVIDENCE;if(!dir)return;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
async function fixture(){const city=createProductCity(world),read=city.importSave(original);assert.equal(read.ok,true,read.message);sameSave(city.exportSave(),original,'actual paid source original immediate');const upgrade=await upgradeCivicHistoryFormat(city,hash(original));assert.equal(upgrade.ok,true,upgrade.message);return city;}
function totals(city:ReturnType<typeof createProductCity>){const view=civicHistoryView(city.state);return{proofs:view.proofs.length,applications:view.applications.length,polls:view.polls.length,terms:view.terms.length,fee:view.applications.reduce((sum,a)=>sum+(a.receipt?.amount??0),0),formMinutes:view.applications.reduce((sum,a)=>sum+a.workedMinutes,0),voteMinutes:view.polls.reduce((sum,p)=>sum+p.ballots.reduce((s,b)=>s+b.workedMinutes,0),0)};}
test('actual captured canonical paid two-signature sources validate with hot terms and full cold election/proof chains; no funded budget is claimed',async()=>{
 const city=await fixture();assert.equal(hash(original),provenance.files['canonical-pair.save.json.gz'].rawSHA256);assert.equal(provenance.status,'ACTUAL_SOURCE_PAIR_NOT_FUNDED_BUDGET');
 assert.equal(captured.paid.length,2);assert.deepEqual(totals(city),{proofs:128,applications:64,polls:19,terms:13,fee:2280,formMinutes:63,voteMinutes:1064});
 for(const signature of captured.paid as BudgetSignatureV2[]){
  assert.ok(city.state.civicStaffing!.terms.some(t=>t.id===signature.authority.termId));
  assert.ok(city.state.civicHistory!.index.polls.some(p=>p.id===signature.authority.electionId));
  assert.ok(city.state.civicHistory!.index.proofs.some(p=>p.id===signature.authority.proofId));
  assert.doesNotThrow(()=>validateBudgetSignatureV2(city.state,world,signature,Reflect.get(city,'runtime'),6348));
  for(const mutate of [(s:any)=>s.authority.termId='civic-term-999',(s:any)=>s.authority.proofId='civic-proof-999',(s:any)=>s.authority.actorId=captured.paid.find((s:any)=>s.actorId!==signature.actorId).actorId,(s:any)=>s.paid.earned++,(s:any)=>s.profession.employmentRevision++]){const bad=structuredClone(signature);mutate(bad);assert.throws(()=>validateBudgetSignatureV2(city.state,world,bad,Reflect.get(city,'runtime'),6348),/预算授权合同/);}
 }
 assert.equal((Reflect.get(city,'runtime').publicBudgets??[]).filter((b:any)=>b.signatureVersion===2).length,0);assert.equal(city.state.culture!.supplementalBudgets,undefined);
 record('paid-source.migrated.save.json',city.exportSave());record('paid-source.summary.json',{actualCapturedSignatures:captured.paid,sourceSHA256:hash(original),sourceTotals:totals(city),sourceTerms:'HOT',sourceElectionsAndProofs:'ARCHIVED',actualFundedV2Pins:'NOT_EXERCISED'});
});
test('declared death/job adverse input ends current authority after one real tick while immutable cold term sources validate and full/partition future24 stays exact',async()=>{
 const results=[];
 for(const adverse of ['death','employer']as const){
  const city=await fixture(),signature=captured.paid[0]as BudgetSignatureV2,actor=city.state.citizens.find(a=>a.id===signature.actorId)!;
  const beforeTotals=totals(city),oldPages=JSON.stringify(city.state.civicHistory!.pages);
  // Explicit adverse input isolates historical-source survival. Neither an autonomous event nor an authorized funded request is manufactured.
  if(adverse==='death'){
   city.state.extension!.actorProfiles[actor.id].health=0;
   assert.equal(city.state.extension!.actorProfiles[actor.id].alive,true,'the people subsystem owns the ensuing death transition');
   const predecessor=city.exportSave(),legal=city.validateSave(predecessor);assert.equal(legal.ok,true,legal.message);
   record('paid-source-death-valid-predecessor.save.json',predecessor);
  }else actor.workId='civic-0-farm';
  city.step(.25);assert.equal(civicCouncilSourceProof(city.state,actor.id),null);
  if(adverse==='death'){assert.equal(city.state.extension!.actorProfiles[actor.id].alive,false);assert.equal(city.state.extension!.actorProfiles[actor.id].health,0);assert.equal(actor.state,'dead');}
  const term=civicHistoryView(city.state).terms.find(t=>t.id===signature.authority.termId)!;assert.ok(term.endedAt!==null&&term.endedAt>signature.signedAt);
  assert.ok(!city.state.civicStaffing!.terms.some(t=>t.id===term.id));assert.ok(city.state.civicHistory!.index.terms.some(t=>t.id===term.id));
  assert.ok(JSON.stringify(city.state.civicHistory!.pages).startsWith(oldPages.slice(0,-1)),'original history pages remain exact');
  assert.doesNotThrow(()=>validateBudgetSignatureV2(city.state,world,signature,Reflect.get(city,'runtime'),6348));
  const sourceNow=totals(city);assert.equal(sourceNow.fee,beforeTotals.fee);assert.equal(sourceNow.terms,beforeTotals.terms);assert.ok(sourceNow.formMinutes>=beforeTotals.formMinutes&&sourceNow.voteMinutes>=beforeTotals.voteMinutes);
  const save=city.exportSave(),full=createArchivedProductCity(world),partition=createArchivedProductCity(world);
  for(const [replica,raw]of [[full,save],[partition,assembleSave(partitionSave(save,world))]]as const){const read=replica.importSave(raw);assert.equal(read.ok,true,read.message);sameSave(replica.exportSave(),save,`${adverse} complete immediate`);assert.doesNotThrow(()=>validateBudgetSignatureV2(replica.state,world,signature,Reflect.get(replica,'runtime'),6348));}
  for(let index=0;index<24;index++){city.step(.25);full.step(.25);partition.step(.25);sameSave(full.exportSave(),city.exportSave(),`${adverse} whole tick${index+1}`);sameSave(partition.exportSave(),city.exportSave(),`${adverse} partition tick${index+1}`);assert.equal(civicCouncilSourceProof(city.state,actor.id),null);}
  assert.doesNotThrow(()=>validateBudgetSignatureV2(city.state,world,signature,Reflect.get(city,'runtime'),6348));
  record(`paid-source-${adverse}-after24.save.json`,city.exportSave());results.push({adverse,adverseKind:'DECLARED_INPUT',terminatedTerm:term,sourceTotals:sourceNow,after24Totals:totals(city),fullPartition24Exact:true,actualFundedV2Pins:'NOT_EXERCISED'});
 }
 record('paid-source-cold-terms.summary.json',results);
});
