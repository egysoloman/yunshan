import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Simulation } from './src/simulation.ts';
import { savedWorldFingerprint, selectSavedWorld } from './src/persistence/world-layout.ts';
import { partitionSave, assembleSave } from './src/persistence/partition.ts';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const expectedSHA = '7ba76f550f9f5413cd712022b751599340cc24e9e48327674f88b2c122af6fe9';
const originalPath = '/workspace/yunshan/artifacts/phase2-player-journey-r6/resume-ui-export.json';
const original = await readFile(originalPath), copy = await readFile('./native-export.json');
assert.equal(original.length, 1798521); assert.equal(sha(original), expectedSHA);
assert.equal(sha(copy), expectedSHA); assert.deepEqual(copy, original);
const json = copy.toString('utf8'), saved = JSON.parse(json);
const manifest = JSON.parse(await readFile('./source-manifest.json', 'utf8'));
const hashes = async () => Object.fromEntries(await Promise.all(Object.keys(manifest.sourceHashesCopy).map(async path => [path, sha(await readFile(path))])));
assert.deepEqual(await hashes(), manifest.sourceHashesCopy);
const selected = selectSavedWorld(json);
assert.equal(selected.layout, 'current-v2-r5'); assert.equal(selected.world.layoutVersion, 'current-v2');
assert.equal(savedWorldFingerprint(selected.world), 'c70ebca5');
assert.equal(saved.worldFingerprint, savedWorldFingerprint(selected.world));
const home = selected.world.buildings.find(site => site.id === saved.state.player.homeId)!;
assert.equal(home.id, 'market-b21'); assert.equal(home.name, '千灯市集·灯市街·里居6');
const oldResultsPath = '/workspace/yunshan/artifacts/phase2-player-journey-r5/results.json';
const oldResultsBytes = await readFile(oldResultsPath), oldResults = JSON.parse(oldResultsBytes.toString('utf8'));
const checkpoint = oldResults.records.find((record: any) => record.name === 'home-saved');
const rounded = Object.fromEntries(Object.entries(saved.state.player.position).map(([key, value]) => [key, Math.round(value as number)]));
assert.deepEqual(rounded, checkpoint.coordinates);
const publicWallet = `${(Math.trunc(saved.state.player.money * 100) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 云币`;
assert.equal(publicWallet, checkpoint.wallet); assert.equal(`第 ${saved.state.day + 1} 日`, checkpoint.day);
const clock = `${String(Math.floor(saved.state.hour)).padStart(2,'0')}:${String(Math.floor(saved.state.hour * 60) % 60).padStart(2,'0')}`;
assert.equal(clock, checkpoint.clock); assert.equal(`居于 ${home.name}`, checkpoint.home);
assert.equal(saved.state.paused, true); assert.equal(saved.state.speed, 1);
assert.equal(saved.state.tick, 1620); assert.equal(saved.state.day, 0); assert.equal(saved.state.hour, 14.75);
const ownership = (data: any) => ({ homeId:data.state.player.homeId, identities:data.state.player.identities, partnerId:data.state.player.partnerId, vehicleId:data.state.player.vehicleId,
  playerBusinesses:data.runtime.playerBusinesses, investment:data.runtime.investment,
  companies:data.state.extension.companies.map((company: any) => ({id:company.id,buildingId:company.buildingId,ownerId:company.ownerId,shares:company.shares,shareholders:company.shareholders})),
  shops:data.state.shops.map((shop: any)=>({id:shop.id,ownerId:shop.ownerId,buildingId:shop.buildingId})), familyEstates:data.state.family.estates });
const financial = (data: any) => ({ treasury:data.state.treasury, playerMoney:data.state.player.money, bankBalance:data.state.bankBalance, loan:data.state.loan,
  banking:data.state.banking, companies:data.state.extension.companies, citizenMoney:data.state.citizens.map((citizen: any)=>[citizen.id,citizen.money]), shops:data.state.shops,
  publicLedger:data.state.extension.publicLedger, wages:data.runtime.wages,wageAccruals:data.runtime.wageAccruals,wageArrears:data.runtime.wageArrears,taxes:data.runtime.taxes,
  freightLots:data.runtime.freightLots,trade:data.state.trade,playerLabor:data.state.playerLabor,clinical:data.state.clinical });
const left = new Simulation(selected.world), right = new Simulation(selected.world);
const leftImport = left.importSave(json); assert.equal(leftImport.ok,true,leftImport.message);
const exported = left.exportSave(); assert.equal(exported,json);
assert.equal(sha(JSON.stringify(ownership(JSON.parse(exported)))),sha(JSON.stringify(ownership(saved))));
assert.equal(sha(JSON.stringify(financial(JSON.parse(exported)))),sha(JSON.stringify(financial(saved))));
const parts = partitionSave(json, selected.world), assembled = assembleSave(parts);
assert.equal(assembled,json); assert.equal(sha(assembled),expectedSHA);
const rightImport = right.importSave(assembled); assert.equal(rightImport.ok,true,rightImport.message);
assert.equal(right.exportSave(),json);
const global = JSON.parse(parts.find(part=>part.id==='global')!.json), player = JSON.parse(parts.find(part=>part.id==='player')!.json);
assert.deepEqual(player.values['state.player'],saved.state.player);
assert.deepEqual(player.values['state.playerLabor'],saved.state.playerLabor);
assert(global.layout.playerValues.includes('state.playerLabor'));
assert.deepEqual(global.layout.playerArrays['state.clinical.orders'],[]);
assert.deepEqual(player.arrays['state.clinical.orders'],[]);
assert(!Object.hasOwn(global.document.state,'player')); assert(!Object.hasOwn(global.document.state,'playerLabor'));
assert(!Object.hasOwn(global.document.state.clinical,'orders')); assert(!Object.hasOwn(global.document.state.clinical,'stock'));
assert.deepEqual(saved.state.clinical.orders,[]); assert.deepEqual(saved.state.clinical.stock,{});
assert.equal(saved.state.playerLabor.job,null);
const rejection: any[] = [];
function rejectParts(name:string,change:(parts:any[])=>void) {
  const bad = parts.map(part=>({...part})); change(bad);
  let reason=''; try { assembleSave(bad); } catch(error) { reason=String(error); }
  assert(reason,name); assert.equal(left.exportSave(),json);
  rejection.push({name,rejected:true,reason,simulationUnchangedSHA256:sha(left.exportSave())});
}
rejectParts('missing independent player body',bad=>bad.splice(bad.findIndex(part=>part.id==='player'),1));
rejectParts('missing required empty player clinical custody',bad=>{ const part=bad.find(part=>part.id==='player'),body=JSON.parse(part.json); delete body.arrays['state.clinical.orders'];part.json=JSON.stringify(body); });
rejectParts('missing player labor escrow body',bad=>{ const part=bad.find(part=>part.id==='player'),body=JSON.parse(part.json); delete body.values['state.playerLabor'];part.json=JSON.stringify(body); });
rejectParts('missing real geographical chunk',bad=>bad.splice(bad.findIndex(part=>part.id.startsWith('chunk:')),1));
const badModule=JSON.parse(json); delete badModule.state.clinical;
const rejectedModule=left.importSave(JSON.stringify(badModule)); assert.equal(rejectedModule.ok,false); assert.equal(left.exportSave(),json);
rejection.push({name:'missing required clinical module declared in native save',rejected:true,reason:rejectedModule.message,simulationUnchangedSHA256:sha(left.exportSave())});
const fakeLabel=JSON.parse(json); fakeLabel.layoutVersion='current-v3'; fakeLabel.world={layoutVersion:'current-v3',terrain:{algorithm:'fake-new-geometry'}};
assert.equal(selectSavedWorld(JSON.stringify(fakeLabel)).layout,'current-v2-r5');
const unknown=JSON.parse(json);unknown.worldFingerprint='deadbeef';assert.throws(()=>selectSavedWorld(JSON.stringify(unknown)));
const initial = { tick:saved.state.tick,day:saved.state.day,hour:saved.state.hour,player:saved.state.player,rng:saved.runtime.rng,accumulator:saved.runtime.accumulator,
  playerLabor:saved.state.playerLabor,clinical:saved.state.clinical };
assert.equal(left.command({type:'pause',value:0}).ok,true); assert.equal(right.command({type:'pause',value:0}).ok,true);
assert.equal(left.exportSave(),right.exportSave());
const expectedOrder=['time','environment','energy','traffic','people','commerce','finance','security','politics','feedback'];
const ticks=[];
for(let index=0;index<24;index++) {
  left.step(.25);right.step(.25);const a=left.exportSave(),b=right.exportSave();assert.equal(a,b);
  const data=JSON.parse(a);assert.equal(data.state.tick,initial.tick+index+1);assert.deepEqual(data.state.lastSystemOrder,expectedOrder);
  ticks.push({index:index+1,tick:data.state.tick,day:data.state.day,hour:data.state.hour,sha256:sha(a),bytes:Buffer.byteLength(a),equal:true});
}
const finalJSON=left.exportSave(),final=JSON.parse(finalJSON);
assert.equal(final.state.tick-initial.tick,24); assert(Math.abs((final.state.day*1440+final.state.hour*60)-(initial.day*1440+initial.hour*60)-6)<1e-8);
assert.equal(assembleSave(partitionSave(finalJSON,selected.world)),finalJSON);
assert.deepEqual(await hashes(),manifest.sourceHashesCopy);assert.equal(sha(await readFile(originalPath)),expectedSHA);
const result={at:new Date().toISOString(),scope:'Actual native r5 export CPU save/continuation and partition proof, coherent02 BZMc source; no browser/profile/GL access, no normal walking actions, no production edits.',
  sourceManifest:'source-manifest.json',sourceSnapshot:manifest.sourceSnapshot,fileCount:81,sourceHashesStable:true,nativeExportOriginalSHA256:expectedSHA,nativeExportBytes:original.length,nativeExportUnchanged:true,
  actualWorld:{selectedRecipe:selected.layout,worldOutputLayout:selected.world.layoutVersion,fingerprint:savedWorldFingerprint(selected.world),worldSHA256:sha(JSON.stringify(selected.world)),homeId:home.id,homeName:home.name},
  originalCheckpoint:{source:oldResultsPath,sourceSHA256:sha(oldResultsBytes),at:checkpoint.at,body:checkpoint.coordinates,wallet:checkpoint.wallet,clock:checkpoint.clock,day:checkpoint.day,home:checkpoint.home},
  exactNative:{...initial,ownershipSHA256:sha(JSON.stringify(ownership(saved))),financialSHA256:sha(JSON.stringify(financial(saved))),companyCount:saved.state.extension.companies.length,shopCount:saved.state.shops.length,citizenCount:saved.state.citizens.length,vehicleCount:saved.state.vehicles.length,
    routePoolPoints:saved.routePool.length,citizensWithRoutes:saved.state.citizens.filter((citizen:any)=>citizen.route?.length).length,voxelCount:saved.state.voxels.length,playerBusinesses:saved.runtime.playerBusinesses,persistedModules:saved.runtime.persistedModules},
  restore:{nativeImportSuccess:true,exportByteExact:true,ownershipExact:true,financialExact:true,exportSHA256:sha(exported),assembledByteExact:true,partCount:parts.length,
    geographicChunks:parts.filter(part=>part.id.startsWith('chunk:')).length,partBytes:parts.map(part=>({id:part.id,bytes:Buffer.byteLength(part.json)})),independentPlayerBytes:Buffer.byteLength(parts.find(part=>part.id==='player')!.json),
    requiredPlayerClinicalIndices:global.layout.playerArrays['state.clinical.orders'],actualPlayerClinicalOrders:player.arrays['state.clinical.orders'].length,actualClinicalStockEntries:Object.keys(saved.state.clinical.stock).length,requiredPlayerLaborPresent:true},
  negativeCases:rejection,untrustedLabelIgnored:true,unknownFingerprintRejected:true,
  continuation:{operation:'Real command({type:pause,value:0}) on two independent CPU instances then 24 calls step(.25) each, original native export never rewritten.',actualTicks:24,actualGameMinutes:6,all24FullExportsByteEqual:true,ticks,final:{tick:final.state.tick,day:final.state.day,hour:final.state.hour,player:final.state.player,rng:final.runtime.rng,accumulator:final.runtime.accumulator,sha256:sha(finalJSON),bytes:Buffer.byteLength(finalJSON)},finalPartitionByteExact:true},
  limits:['UI checkpoint has rounded coordinates and truncated wallet; exact fractional original values come from the real native export.','The actual saved clinical and player job escrow are empty; funded-clinical cases remain covered by separately archived 26 storage tests.','CPU deterministic continuation does not count as completing the normal browser school/clinic/flight journey.','Partition proof uses pure split/reassembly APIs, not new browser IndexedDB writes or a partial Simulation restore.','Far city actors remain full individual simulation; statistical simulation is not implemented.']};
await writeFile('./native-r5-results.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',nativeExportSHA256:expectedSHA,selectedRecipe:selected.layout,exactRestore:true,exactPartition:true,negativeCases:rejection.length,ticks:24,finalSHA256:sha(finalJSON),nativeExportUnchanged:true,sourceHashesStable:true},null,2));
