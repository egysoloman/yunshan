import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createProductCity } from '../src/product-city.ts';
import { currentCivicBudgetSignature, validateBudgetSignatureV2, type BudgetSignatureV2 } from '../src/simulation/budget-authority.ts';
import { civicCouncilSourceProof } from '../src/simulation/civic-staffing.ts';
import { originalAuthorizePublicBudget, type OriginalAuthorizationContext } from './fixtures/budget-authority/original-authorizer.ts';
const file=(name:string)=>readFileSync(new URL(`./fixtures/budget-authority/${name}`,import.meta.url));
const world=JSON.parse(file('world.json').toString()), captured=JSON.parse(file('paid-signatures.json').toString()), provenance=JSON.parse(file('provenance.json').toString());
const raw=gunzipSync(file('canonical-pair.save.json.gz')).toString('utf8');
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
function fixture(){const city=createProductCity(world),result=city.importSave(raw);assert.equal(result.ok,true,result.message);assert.equal(city.exportSave(),raw);return city;}
test('actual two natural terms at same hall generate strict profession0 and canonical paid tail signatures without a PublicLabor body',()=>{
 const city=fixture();assert.equal(Reflect.get(city,'runtime').publicLabor,undefined);
 for(const [name,value] of Object.entries(provenance.files) as [string,any][]) assert.equal(hash(file(name)),value.sha256);
 assert.equal(hash(raw),provenance.files['canonical-pair.save.json.gz'].rawSHA256);
 assert.equal(captured.paid.length,2);assert.equal(new Set(captured.paid.map((s:BudgetSignatureV2)=>s.actorId)).size,2);
 for(const sig of captured.paid as BudgetSignatureV2[]){
  assert.equal(sig.profession.baseRole,'官员');assert.equal(sig.profession.employmentRevision,0);
  assert.doesNotThrow(()=>validateBudgetSignatureV2(city.state,world,sig,Reflect.get(city,'runtime'),6348));
  assert.equal(currentCivicBudgetSignature(city,sig.actorId),null,'loading a past paid source never manufactures a current canonical wage window');
 }
 assert.equal(city.state.culture!.orders[0].spent,0);assert.equal(city.state.culture!.supplementalBudgets,undefined,'source evidence is not a claimed funded budget');
});
test('strict V2 historical reader refuses forged term, source, role, profession, remote point and paid interval using real valid signatures',()=>{
 const city=fixture(),valid=captured.paid[0] as BudgetSignatureV2;
 const changes:[string,(s:any)=>void][]=[
  ['legacy signature',s=>delete s.signatureVersion],['role fallback',s=>s.role='official'],['unknown signature field',s=>s.trusted=true],
  ['invented term',s=>s.authority.termId='civic-term-999'],['borrowed source',s=>s.authority.actorId=captured.paid[1].actorId],
  ['wrong enablement',s=>s.authority.enablementId='different'],['source outside term',s=>s.authority.signedAt=s.authority.endsAt],
  ['future signature',s=>s.signedAt++],['remote work',s=>s.position.x+=20],['unsupported foot',s=>s.position.y+=.5],['wrong point',s=>s.pointId='fake'],
  ['base council profession',s=>s.profession.baseRole='council'],['foreign employer',s=>s.profession.workId='civic-1-hall'],['invented revision',s=>s.profession.employmentRevision=1],
  ['zero paid minute',s=>s.paid.minutes=0],['before term tail',s=>s.paid.startAt=s.authority.startsAt-1],['unpaired wage interval',s=>s.paid.endAt++],
  ['forged earned',s=>s.paid.earned++],['future tick',s=>s.paid.tick=city.state.tick+1],['unknown paid field',s=>s.paid.amount=s.paid.earned],
 ];
 for(const [label,mutate] of changes){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>validateBudgetSignatureV2(city.state,world,bad,Reflect.get(city,'runtime'),6348),/预算授权合同/,label);}
});
test('observed death or employer change stops new authority while retaining a past real signed source',()=>{
 for(const adverse of ['death','employer'] as const){
  const city=fixture(),sig=captured.paid[0] as BudgetSignatureV2,actor=city.state.citizens.find(a=>a.id===sig.actorId)!;
  // Declared adverse input only isolates historical-source survival. It is
  // not an autonomous death/job change or a fabricated funded authorization.
  if(adverse==='death')city.state.extension!.actorProfiles[actor.id].alive=false;
  else actor.workId='civic-0-farm';
  city.step(.25);
  assert.equal(civicCouncilSourceProof(city.state,actor.id),null);
  const term=city.state.civicStaffing!.terms.find(t=>t.id===sig.authority.termId)!;
  assert.ok(term.endedAt!==null&&term.endedAt>sig.signedAt);
  assert.doesNotThrow(()=>validateBudgetSignatureV2(city.state,world,sig,Reflect.get(city,'runtime'),6348));
 }
});
test('literal original authority primitive rejects two actual paid secondary terms above40 while accepting their same ordinary departmental40',()=>{
 const city=fixture();city.step(.25);
 const paid=captured.paid.map((s:BudgetSignatureV2)=>currentCivicBudgetSignature(city,s.actorId));
 assert.ok(paid.length===2&&paid.every(Boolean));
 const ids=paid.map((s:any)=>s.actorId),clock=city.state.extension!.lastUpdate;
 assert.ok(ids.every((id:string)=>city.isOnDuty(id,'civic-0-hall')));
 assert.ok(ids.every((id:string)=>city.state.citizens.find(a=>a.id===id)!.role==='官员'));
 const request={id:'service-1-supplement-1',siteId:'civic-0-school',purpose:'civic-education-supplement',cap:160,approvedAt:clock,approvedBy:ids};
 assert.ok(city.publicBudgetSnapshot().available>=160);
 const before=city.exportSave();
 const result=originalAuthorizePublicBudget.call(city as unknown as OriginalAuthorizationContext,request);
 assert.equal(result,false,'actual old primary council quorum does not consume valid secondary terms');
 assert.equal(city.exportSave(),before);
 const control=fixture();control.step(.25);
 assert.equal(originalAuthorizePublicBudget.call(control as unknown as OriginalAuthorizationContext,{...request,id:'department-control',purpose:'department-control',cap:40}),true,'all same current physical/paid/ordinary official conditions do pass original departmental source guards');
 const dir=process.env.BUDGET_AUTHORITY_EVIDENCE;
 if(dir){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'old-authority-primitive.before.save.json'),before);writeFileSync(join(dir,'old-authority-primitive.after.save.json'),city.exportSave());writeFileSync(join(dir,'old-authority-primitive.expected-FAIL.json'),JSON.stringify({status:'EXPECTED_BASELINE_FAIL',request,paid,result:false,departmentControl40:true,pendingSupplementalConsumer:'NOT_PROVEN',sourceProof:'ACTUAL_TWO_NATURAL_TERMS',clock},null,2)+'\n');}
});
