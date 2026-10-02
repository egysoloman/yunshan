import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const directory = path.dirname(fileURLToPath(import.meta.url));
export const config = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'));
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyFixedSource() {
  const manifestBytes = await readFile(path.join(config.snapshot, 'source-snapshot.json'));
  assert.equal(sha(manifestBytes), config.sourceManifestSHA256, 'Root-supplied exact frozen manifest');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.snapshotRoot, config.snapshot);
  assert.equal(manifest.inputCount, config.inputCount);
  assert.equal(manifest.threeWayExact, true);
  assert.equal(Object.keys(manifest.copiedHashes).length, config.inputCount);
  assert.deepEqual(manifest.initialHashes, manifest.copiedHashes, 'Initial workspace equals frozen copy');
  assert.deepEqual(manifest.finalWorkspaceHashes, manifest.copiedHashes, 'Final workspace equals frozen copy');
  const actual = Object.fromEntries(await Promise.all(Object.keys(manifest.copiedHashes).map(async file => {
    assert(!path.isAbsolute(file) && !file.split('/').includes('..'), 'Manifest path stays inside snapshot');
    return [file, sha(await readFile(path.join(config.snapshot, file)))];
  })));
  assert.deepEqual(actual, manifest.copiedHashes, 'All 99 frozen inputs remain byte-identical');
  const indexBytes = await readFile(path.join(config.snapshot, 'dist/index.html'));
  assert.equal(sha(indexBytes), config.distIndexSHA256);
  assert.equal(indexBytes.toString().match(/src="([^"]+\.js)"/)?.[1], config.entry);
  const entryBytes = await readFile(path.join(config.snapshot, 'dist' + config.entry));
  assert.equal(entryBytes.length, config.entryBytes);
  assert.equal(sha(entryBytes), config.entrySHA256);
  assert.equal(actual['scripts/browser-test.mjs'], config.originalBrowserSHA256);
  return { at: new Date().toISOString(), snapshot: config.snapshot, sourceManifestSHA256: sha(manifestBytes),
    inputCount: config.inputCount, sourceHashes: actual, entry: config.entry, entryBytes: entryBytes.length,
    entrySHA256: sha(entryBytes), distIndexSHA256: sha(indexBytes) };
}
export async function requireRootReady() {
  const bytes=await readFile(config.rootReadyFile),ready=JSON.parse(bytes);
  assert.equal(ready.rootRelatedReady,true);assert.equal(ready.relatedChecksCompleted,true);
  assert.equal(ready.relatedTests,26);assert.equal(ready.relatedTestsExitCode,0);assert.equal(ready.strictBuildExitCode,0);
  assert.equal(ready.fullRulesForThisSource,'NOT_RUN');
  assert.equal(ready.snapshot,config.snapshot);assert.equal(ready.sourceManifestSHA256,config.sourceManifestSHA256);
  assert.equal(ready.entry,config.entry);assert.equal(ready.entryBytes,config.entryBytes);assert.equal(ready.entrySHA256,config.entrySHA256);
  assert.equal(ready.distIndexSHA256,config.distIndexSHA256);
  assert.equal(sha(await readFile(ready.relatedEvidence)),ready.relatedEvidenceSHA256);
  const evidence=JSON.parse(await readFile(ready.relatedEvidence,'utf8'));
  assert.equal(evidence.status,'PASS');assert.equal(evidence.sourceUnchanged,true);assert.deepEqual(evidence.sourceStart,evidence.sourceEnd);
  const frozen=JSON.parse(await readFile(path.join(config.snapshot,'source-snapshot.json'),'utf8'));
  for(const [file,hash] of Object.entries(evidence.sourceEnd))assert.equal(frozen.copiedHashes[file],hash);
  for(const item of evidence.records){assert.equal(item.exitCode,0);assert.equal(sha(await readFile(path.join(config.snapshot,'root-validation',item.log))),item.logSHA256);}
  const related=evidence.records.find(r=>r.name==='related'),build=evidence.records.find(r=>r.name==='build');
  assert(related&&build);const log=await readFile(path.join(config.snapshot,'root-validation',related.log),'utf8');
  assert.match(log,/^[#ℹ] tests 26$/m);assert.match(log,/^[#ℹ] pass 26$/m);assert.match(log,/^[#ℹ] fail 0$/m);
  return {...ready,rootReadyFileSHA256:sha(bytes),readinessScope:'Related26 plus strict build only; new-source full rules NOT_RUN'};
}
