// Writes gzip world snapshots for every layout of one seed, bound to a bundle SHA-256.
// Usage (from build-sim-host.mjs, bundled first): node gen.mjs <out.json.gz> <bundleSha256> [seed]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CITY_LAYOUT_VERSIONS, createWorld } from '../src/world';
import { snapshotWorld } from '../src/persistence/world-cache';
import { savedWorldFingerprint } from '../src/persistence/world-layout';

const [out, bundleSha256, seedText] = process.argv.slice(2), seed = Number(seedText ?? 20261001);
if (!out || !/^[0-9a-f]{64}$/.test(bundleSha256 ?? '')) throw new Error('usage: <out.json.gz> <bundleSha256> [seed]');
const snapshots: Record<string, ReturnType<typeof snapshotWorld> & { fingerprint: string }> = {};
for (const layout of CITY_LAYOUT_VERSIONS) { const world = createWorld(seed, layout); snapshots[layout] = { ...snapshotWorld(world), fingerprint: savedWorldFingerprint(world) }; }
const body = gzipSync(JSON.stringify({ format: 'yunshan-world-snapshots', version: 1, bundleSha256, seed, snapshots }), { level: 9 });
writeFileSync(out, body);
console.log(JSON.stringify({ out, bytes: body.length, layouts: Object.keys(snapshots).length }));
