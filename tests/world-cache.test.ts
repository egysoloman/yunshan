import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../src/world';
import { cachedWorld, cachedWorldFingerprint, restoreWorld, snapshotWorld, useWorldSnapshots } from '../src/persistence/world-cache';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { installPackagedWorldSnapshots } from '../src/native-host/world-snapshots';

// Same values, same key order and the same pattern of shared objects.
function assertSameGraph(a: unknown, b: unknown) {
  const left = new Map<object, string>(), right = new Map<object, string>();
  const walk = (x: any, y: any, path: string) => {
    if (x === null || typeof x !== 'object') { assert.ok(Object.is(x, y), `${path}: ${String(x)} vs ${String(y)}`); return; }
    assert.ok(y !== null && typeof y === 'object' && Array.isArray(x) === Array.isArray(y), `${path}: shape`);
    const seenLeft = left.get(x), seenRight = right.get(y);
    assert.equal(seenRight, seenLeft, `${path}: shared reference pattern`); if (seenLeft) return;
    left.set(x, path); right.set(y, path);
    assert.deepEqual(Reflect.ownKeys(y), Reflect.ownKeys(x), `${path}: keys`);
    for (const key of Object.keys(x)) walk(x[key], y[key], `${path}.${key}`);
  };
  walk(a, b, 'world');
}

test('a cached world is the generated world, as an independent copy with its shared references', () => {
  const fresh = createWorld(20261001, 'current-v6');
  const first = cachedWorld(20261001, 'current-v6'), second = cachedWorld(20261001, 'current-v6');
  assertSameGraph(fresh, first);
  assert.notEqual(first, second); assert.notEqual(first.buildings[0], second.buildings[0]);
  first.buildings[0].width += 1; assert.equal(second.buildings[0].width, fresh.buildings[0].width, 'an edit to one copy is invisible to the next');
  assert.equal(cachedWorldFingerprint(20261001, 'current-v6', savedWorldFingerprint), savedWorldFingerprint(fresh));
  const restored = restoreWorld(snapshotWorld(fresh)); assertSameGraph(fresh, restored);
});

test('packaged snapshots are used only beside the exact bundle that generated them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yunshan-worlds-')), bundle = join(dir, 'sim-host.mjs'), file = join(dir, 'worlds.json.gz');
  writeFileSync(bundle, 'bundle bytes');
  const snapshot = { ...snapshotWorld(createWorld(7, 'current-v2')), fingerprint: 'x' };
  writeFileSync(file, gzipSync(JSON.stringify({ format: 'yunshan-world-snapshots', version: 1, bundleSha256: '0'.repeat(64), seed: 7, snapshots: { 'current-v2': snapshot } })));
  try {
    assert.equal(installPackagedWorldSnapshots(bundle, file), false, 'another bundle\'s snapshots are ignored');
    assert.equal(installPackagedWorldSnapshots(join(dir, 'missing.mjs'), file), false);
    writeFileSync(file, 'not gzip'); assert.equal(installPackagedWorldSnapshots(bundle, file), false, 'a malformed file is ignored');
  } finally { useWorldSnapshots(null); }
});
