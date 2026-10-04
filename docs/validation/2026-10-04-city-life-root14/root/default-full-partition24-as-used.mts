import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from './assembly/src/simulation.ts';
import { PRODUCT_CITY_LAYOUT } from './assembly/src/product-city.ts';
import { selectSavedWorld, savedWorldFingerprint } from './assembly/src/persistence/world-layout.ts';
import { partitionSave, assembleSave } from './assembly/src/persistence/partition.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const audit = JSON.parse(readFileSync(new URL('./assembly/artifacts/root14-product-default-day.json', import.meta.url), 'utf8'));
assert.equal(audit.status, 'passed');
assert.equal(audit.ruleset.requestSource, 'product-default');
assert.equal(audit.ruleset.saveEnvelopeVersion, 4);
assert.equal(audit.ruleset.historyPolicyId, 'civic-history-pages-v1');
const saved = readFileSync(new URL('./assembly/artifacts/root14-product-default-day-final.save.json', import.meta.url), 'utf8');
assert.equal(sha(saved), audit.finalSave.sha256);
const selection = selectSavedWorld(saved, PRODUCT_CITY_LAYOUT), world = selection.world;
assert.equal(selection.layout, 'current-v6');
assert.equal(savedWorldFingerprint(world), audit.ruleset.actualWorldFingerprint);
const reused = JSON.parse(readFileSync('/workspace/yunshan-work/ROOT12-spawn-occlusion-plan-20261004-01/World-reused-original.json', 'utf8'));
assert.equal(JSON.stringify(world), JSON.stringify(reused), 'new selector reconstructs every original v6 World field');
const output = new URL('./default-full-partition24-01/original-artifacts/', import.meta.url);
mkdirSync(new URL('parts/', output), { recursive: true });
writeFileSync(new URL('world.as-selected.json', output), JSON.stringify(world));
const parts = partitionSave(saved, world), assembled = assembleSave(parts);
assert.equal(assembled, saved, 'complete current default v4 partition generation immediately retains every byte');
const partManifest = parts.map((part, index) => {
  const filename = String(index).padStart(5, '0') + '.json';
  writeFileSync(new URL('parts/' + filename, output), part.json);
  return { id: part.id, filename, bytes: Buffer.byteLength(part.json), sha256: sha(part.json) };
});
writeFileSync(new URL('partition-manifest.json', output), JSON.stringify(partManifest, null, 2) + '\n');
const replicas = [saved, assembled].map(raw => {
  const simulation = new Simulation(world), result = simulation.importSave(raw);
  assert.equal(result.ok, true, result.message);
  assert.equal(simulation.saveVersion, 4);
  assert.equal(simulation.motionVersion, 2);
  assert.equal(simulation.exportSave(), saved, 'default v4 full/partition actual reader immediate');
  return simulation;
});
const rows: unknown[] = [];
for (let index = 0; index < 24; index++) {
  for (const simulation of replicas) simulation.step(.25);
  const full = replicas[0].exportSave(), partition = replicas[1].exportSave();
  assert.ok(full === partition, 'default full/partition actual future ' + (index + 1) + ': ' + sha(full) + '/' + sha(partition));
  rows.push({ futureTick: index + 1, tick: replicas[0].state.tick, clock: replicas[0].state.extension!.lastUpdate, sha256: sha(full) });
}
const after = replicas[0].exportSave();
assert.equal(sha(after), audit.saveValidation.futureSaveSha256, 'partition continuation matches the independent real day driver full future24');
writeFileSync(new URL('default-full-partition-after24.save.json', output), after);
const result = { status: 'PASS', sourceSaveSHA256: sha(saved), saveVersion: 4, motionVersion: 2,
  selectorLayout: selection.layout, actualWorldFingerprint: savedWorldFingerprint(world), originalV6WholeWorldValueEqual: true,
  wholeAndPartitionImmediateEqual: true, wholeAndPartitionFuture24Equal: true, independentDayFuture24SHAEqual: true,
  futureSHA256: sha(after), partCount: parts.length, historyPartCount: parts.filter(part => part.id.startsWith('chunk:civic-history:')).length,
  rows, completeGame: false, macOSOrPerformance: 'NOT_RUN' };
writeFileSync(new URL('summary.json', output), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', sourceSHA256: sha(saved), futureSHA256: sha(after), futureTicks: 24, partCount: parts.length }));
