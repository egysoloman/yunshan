import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync('docs/art-contract/studio-catalog.json', 'utf8'));
const manifest = JSON.parse(readFileSync('src/rendering/studio-assets.json', 'utf8'));

test('the studio catalogue and the imported manifest describe the same studio commit and placed set', () => {
  assert.equal(catalog.sourceCommit, manifest.sourceCommit);
  const placed = catalog.entries.filter((e: { status: string }) => e.status === 'placed').map((e: { id: string }) => e.id).sort();
  assert.deepEqual(placed, manifest.assets.map((a: { id: string }) => a.id).sort());
  assert.equal(new Set(catalog.entries.map((e: { id: string }) => e.id)).size, catalog.entries.length, 'one row per master');
  for (const entry of catalog.entries) {
    assert(['placed', 'rejected', 'unassigned'].includes(entry.status), entry.id);
    if (entry.kind === 'master' || entry.status === 'placed') { assert(entry.checks.exported, `${entry.id} has a GLB export`); assert(entry.sizeM.every((v: number) => v > 0), entry.id); }
  }
  for (const asset of manifest.assets) {
    const row = catalog.entries.find((e: { id: string }) => e.id === asset.id);
    assert.equal(row.source, asset.source, `${asset.id} manifest GLB is the catalogue's effective export`);
  }
});
