import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation';
import { createProductCity, createArchivedProductCity } from '../src/product-city';
import { upgradeCivicHistoryFormat } from '../src/host/upgrade-civic-history-format';
import { civicHistoryView, createCivicHistory, appendCivicHistory, decodeCivicHistory } from '../src/simulation/civic-history';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { SaveSession } from '../src/persistence/session';
const file = (name: string) => readFileSync(new URL(`./fixtures/civic-history/${name}`, import.meta.url), 'utf8');
const original = file('root13-four-day.save.json'), original24 = file('root13-four-day-after-24.save.json');
const world = JSON.parse(file('root13-four-day.world.json'));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sameSave = (actual: string, expected: string, label: string) => assert.ok(actual === expected, `${label}; actualSHA=${hash(actual)}, expectedSHA=${hash(expected)}`);
function record(name: string, contents: unknown) {
  const directory = process.env.CIVIC_HISTORY_EVIDENCE; if (!directory) return;
  mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, name), typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2) + '\n');
}
function oldFixture() { const city = createProductCity(world), result = city.importSave(original); assert.equal(result.ok, true, result.message); sameSave(city.exportSave(), original, 'original complete v3 immediate'); return city; }
async function migrated() { const city = oldFixture(), result = await upgradeCivicHistoryFormat(city, hash(original)); assert.equal(result.ok, true, result.message); return city; }
function sourceProjection(save: string): string {
  const document = JSON.parse(save), view = civicHistoryView(document.state);
  document.version = 3; delete document.historyPolicyId; delete document.state.civicHistory;
  document.state.civicStaffing.version = 1; delete document.state.civicStaffing.historyId;
  Object.assign(document.state.civicStaffing, view);
  document.runtime.civicStaffingVersion = 1; delete document.runtime.civicHistoryVersion;
  document.runtime.persistedModules = document.runtime.persistedModules.filter((name: string) => name !== 'civicHistory');
  return JSON.stringify(document);
}
function rebuiltHistory(document: any, mutate: (records: any) => void): string {
  const civic = document.state.civicStaffing, origin = document.state.civicHistory.origin;
  const records = structuredClone(decodeCivicHistory(document.state.civicHistory, civic.enablement.id, document.state.extension.lastUpdate, document.state.tick));
  mutate(records);
  const history = createCivicHistory(civic.enablement.id, origin.motionVersion, origin.createdAt, origin.createdTick, { sourceSave: origin.sourceSave, sourceCounts: origin.sourceCounts });
  document.state.civicHistory = appendCivicHistory(history, records, document.state.extension.lastUpdate, document.state.tick);
  return JSON.stringify(document);
}
test('trusted exact-SHA upgrade of actual app64 four-day snapshot retains all money/labor/professions/RNG and raw58 closed sources', async () => {
  assert.equal(hash(original), '3640274b3e2234b793925a574f825615a89d9c168539d10960510f39f1e1c2c3');
  const city = oldFixture(), before = city.exportSave(), source = JSON.parse(before), civic = source.state.civicStaffing;
  assert.deepEqual([source.state.tick, source.state.extension.lastUpdate, civic.applications.length, civic.polls.length, civic.terms.length], [1467,6348,64,19,13]);
  assert.equal((await upgradeCivicHistoryFormat(city, '0'.repeat(64))).ok, false); sameSave(city.exportSave(), before, 'wrong SHA remains atomic');
  city.emitEvent({ type: 'upgrade-civic-history-format', purpose: 'civic-history-pages-v1' }); sameSave(city.exportSave(), before, 'generic event has no host capability');
  const result = await upgradeCivicHistoryFormat(city, hash(before)); assert.equal(result.ok, true, result.message);
  const after = city.exportSave(), document = JSON.parse(after), view = civicHistoryView(city.state);
  assert.deepEqual([city.saveVersion, city.state.civicStaffing!.version, city.state.civicHistory!.version, city.motionVersion], [4,2,1,2]);
  assert.deepEqual([city.state.civicStaffing!.proofs.length, city.state.civicStaffing!.applications.length, city.state.civicStaffing!.polls.length, city.state.civicStaffing!.terms.length], [70,6,6,13]);
  assert.deepEqual([view.proofs.length, view.applications.length, view.polls.length, view.terms.length], [128,64,19,13]);
  assert.deepEqual([document.runtime.civicStaffingVersion,document.runtime.civicHistoryVersion,document.historyPolicyId], [2,1,'civic-history-pages-v1']);
  assert.equal(city.state.civicHistory!.origin.kind, 'host-format-upgrade');
  assert.equal((city.state.civicHistory!.origin as any).sourceSave.sha256, hash(before));
  sameSave(sourceProjection(after), before, 'entire source projection unchanged including original ledger/wallets/geometry/motion/RNG');
  const fee = view.applications.reduce((sum, row) => sum + (row.receipt?.amount ?? 0), 0);
  const formMinutes = view.applications.reduce((sum, row) => sum + row.workedMinutes, 0), voteMinutes = view.polls.reduce((sum, row) => sum + row.ballots.reduce((total, ballot) => total + ballot.workedMinutes,0),0);
  assert.equal(fee,2280); assert.equal(formMinutes,63); assert.equal(voteMinutes,1064);
  assert.equal((await upgradeCivicHistoryFormat(city, hash(after))).ok,false); sameSave(city.exportSave(),after,'already-upgraded remains atomic');
  record('migration.before.save.json',before); record('migration.after.save.json',after); record('migration.summary.json',{sourceSHA256:hash(before),sourceTick:1467,sourceClock:6348,sourceApplications:64,paidApplications:19,cancelledUnpaid:45,fee,formMinutes,voteMinutes,history:city.state.civicHistory!.totals,sourceProjectionExact:true,fundedV2BudgetPins:'NOT_EXERCISED'});
});
test('explicit archive factory starts empty while importing old native3 disables new history and preserves original future24', async () => {
  const archive = createArchivedProductCity(world), empty = archive.exportSave(); assert.equal(archive.saveVersion,4); assert.equal(archive.state.civicHistory!.pages.length,0);
  assert.equal(archive.importSave(original).ok,true); assert.equal(archive.saveVersion,3); assert.equal(archive.state.civicHistory,undefined); sameSave(archive.exportSave(),original,'native3 import into new archive factory');
  const old = oldFixture();
  for(let index=0;index<24;index++){archive.step(.25);old.step(.25);sameSave(archive.exportSave(),old.exportSave(),`native3 history disabled tick${index+1}`);}
  sameSave(old.exportSave(),original24,'source actual old native3 future24 oracle');
  const race = oldFixture(), pending = upgradeCivicHistoryFormat(race,hash(original)); race.command({type:'pause'}); const changed = race.exportSave();
  assert.equal((await pending).ok,false); sameSave(race.exportSave(),changed,'async race preserves the current paused city');
  const fresh = createArchivedProductCity(world), result = fresh.importSave(empty); assert.equal(result.ok,true,result.message); sameSave(fresh.exportSave(),empty,'empty4 complete self-contained roundtrip');
  record('old-native3-after24.save.json',old.exportSave());
});
test('complete, stable partition, and leased session v4 each restore every original byte then future24 exactly', async () => {
  const city = await migrated(), saved = city.exportSave(), parts = partitionSave(saved,world), historyParts = parts.filter(part=>part.id.startsWith('chunk:civic-history:'));
  assert.equal(historyParts.length,city.state.civicHistory!.pages.length); assert.ok(historyParts.length>0); sameSave(assembleSave(parts),saved,'all stable history chunks assemble exactly');
  const map = new Map(parts.map(part=>[part.id,part])), session = new SaveSession({generation:17,savedAt:100,backend:'indexeddb',recoveredPrevious:false,chunkIds:parts.filter(part=>part.id.startsWith('chunk:')).map(part=>part.id)},map.get('global')!,map.get('player')!,{read:async id=>{assert.ok(map.has(id));return map.get(id)!;},check(){},release:async()=>{},recover:async()=>null},{maxCachedChunks:2,maxCachedBytes:512*1024});
  const sessionRaw = await session.materialize(); sameSave(sessionRaw,saved,'pinned complete generation'); await session.close();
  const replicas = [saved,assembleSave(parts),sessionRaw].map(raw=>{const replica=createArchivedProductCity(world),result=replica.importSave(raw);assert.equal(result.ok,true,result.message);sameSave(replica.exportSave(),saved,'v4 immediate full/partition/session');return replica;});
  const stablePages = JSON.stringify(city.state.civicHistory!.pages);
  for(let index=0;index<24;index++){city.step(.25);const expected=city.exportSave();for(const replica of replicas){replica.step(.25);sameSave(replica.exportSave(),expected,`v4 future tick${index+1}`);}}
  assert.ok(city.state.civicStaffing!.applications.length<=64); assert.ok(city.state.civicStaffing!.nextApplicationId>65,'released live slots accept additional actual applications through ordinary simulation');
  assert.ok(JSON.stringify(city.state.civicHistory!.pages).startsWith(stablePages.slice(0,-1)),'existing sealed history pages remain byte-identical');
  record('migration-after24.save.json',city.exportSave()); record('partition-session.summary.json',{partIds:parts.map(part=>part.id),historyPartCount:historyParts.length,future24Exact:true,session:session.getStats(),actualNextApplicationId:city.state.civicStaffing!.nextApplicationId});
});
test('history envelope, raw fee/time/census, live ledger and hot/cold duplicate tampering are atomically rejected even after valid re-sealing', async () => {
  const city=await migrated(),saved=city.exportSave();
  const changes:[string,(d:any)=>void][]=[
    ['history missing',d=>delete d.state.civicHistory],['history marker missing',d=>delete d.runtime.civicHistoryVersion],['history manifest omitted',d=>d.runtime.persistedModules=d.runtime.persistedModules.filter((x:string)=>x!=='civicHistory')],
    ['body downgrade',d=>d.state.civicStaffing.version=1],['envelope downgrade3',d=>d.version=3],['wrong motion',d=>d.state.civicHistory.origin.motionVersion=1],['fake totals',d=>d.state.civicHistory.totals.applications--],
    ['absent page',d=>d.state.civicHistory.pages.pop()],['duplicate page',d=>d.state.civicHistory.pages.push(d.state.civicHistory.pages[0])],['fake page',d=>d.state.civicHistory.pages[0].fragments[0].jsonPart+=' '],
    ['hot/cold duplicate',d=>d.state.civicStaffing.applications.push(civicHistoryView(d.state).applications[0])],
    ['ledger fee changed',d=>d.state.extension.publicLedger.find((row:any)=>row.purpose==='本区居民补选本人登记费').amount++],
    ['ledger fee removed',d=>d.state.extension.publicLedger.splice(d.state.extension.publicLedger.findIndex((row:any)=>row.purpose==='本区居民补选本人登记费'),1)],
  ];
  const rejected:string[]=[];
  for(const [label,mutate]of changes){const d=JSON.parse(saved);mutate(d);const result=city.importSave(JSON.stringify(d));assert.equal(result.ok,false,label);sameSave(city.exportSave(),saved,`${label} atomic`);rejected.push(label);}
  const semantic:[string,(rows:any)=>void][]=[
    ['re-sealed wrong fee',r=>r.applications.find((row:any)=>row.receipt).receipt.amount=121],['re-sealed forged payer',r=>r.applications.find((row:any)=>row.receipt).receipt.moneyAfter++],
    ['re-sealed forged vote time',r=>r.polls[0].ballots.find((b:any)=>b.completedAt!==null).windows[0].startAt-=1],['re-sealed omitted census',r=>r.polls[0].openingCensus.pop()],
    ['re-sealed forged paid wages',r=>r.proofs[0].windows[0].earned++],['re-sealed summary-only paid source',r=>r.proofs[0].windows=[]],['re-sealed removed cancelled minute',r=>r.applications.find((row:any)=>row.cancelledAt!==null&&row.workedMinutes>0).windows=[]],
  ];
  for(const [label,mutate]of semantic){const result=city.importSave(rebuiltHistory(JSON.parse(saved),mutate));assert.equal(result.ok,false,label);sameSave(city.exportSave(),saved,`${label} atomic with correct archive hashes`);rejected.push(label);}
  record('atomic-rejections.json',{rejected,allOriginalBytesRemain:true});
});
test('partition rejects absent, duplicate, orphan and changed-page sources from a complete generation',async()=>{
  const city=await migrated(),saved=city.exportSave(),parts=partitionSave(saved,world),id=parts.find(part=>part.id.startsWith('chunk:civic-history:'))!.id;
  assert.throws(()=>assembleSave(parts.filter(part=>part.id!==id)),/历史/);
  assert.throws(()=>assembleSave([...parts,parts.find(part=>part.id===id)!]),/不完整/);
  assert.throws(()=>assembleSave([...parts,{...parts.find(part=>part.id===id)!,id:id+'-other-generation'}]),/历史/);
  const bad=structuredClone(parts),part=bad.find(part=>part.id===id)!,page=JSON.parse(part.json);page.historyPage.page.sealedTick++;part.json=JSON.stringify(page);assert.throws(()=>assembleSave(bad),/civic history/);
  sameSave(city.exportSave(),saved,'bad transport leaves live city byte-identical');
});
