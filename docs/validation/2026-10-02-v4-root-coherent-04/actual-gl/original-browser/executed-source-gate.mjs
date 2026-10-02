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
  const bytes = await readFile(config.rootReadyFile);
  const ready = JSON.parse(bytes);
  assert.equal(ready.rootFinalReady, true, 'Root explicitly released this GPU stage');
  assert.equal(ready.fullRulesCompleted, true);
  assert.equal(ready.fullRulesExitCode, 0);
  assert.equal(ready.snapshot, config.snapshot);
  assert.equal(ready.sourceManifestSHA256, config.sourceManifestSHA256);
  assert.equal(ready.entrySHA256, config.entrySHA256);
  assert(ready.fullRulesEvidence && ready.fullRulesEvidenceSHA256, 'Root supplied original full-rule evidence');
  assert.equal(sha(await readFile(ready.fullRulesEvidence)), ready.fullRulesEvidenceSHA256);
  return { ...ready, rootReadyFileSHA256: sha(bytes) };
}
