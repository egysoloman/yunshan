import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCitizenRoutes } from '../src/persistence/route-encoding';
import { parseSaveWithinResources } from '../src/persistence/save-resource';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { observeFoodAccess } from '../src/simulation/food-access-observations';
import type { SimState, WorldDefinition } from '../src/types';

// This CLI reads an existing world and save. It does not generate a city,
// initialize a Simulation, import a live game, move a body or advance a tick.
const startedAt = new Date().toISOString();
const options = new Map<string, string>();
assert.equal((process.argv.length - 2) % 2, 0, 'Expected --world PATH --save PATH --out NEW_DIRECTORY.');
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--world', '--save', '--out'].includes(key) && value && !options.has(key), 'Expected unique --world, --save and --out arguments.');
  options.set(key, value);
}
assert.equal(options.size, 3, 'Expected --world PATH --save PATH --out NEW_DIRECTORY.');
const worldPath = resolve(options.get('--world')!), savePath = resolve(options.get('--save')!), out = resolve(options.get('--out')!);
assert.ok(!existsSync(out), 'The output directory already exists; use a new directory to preserve previous evidence.');
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['src', 'tests', 'scripts', 'adapters', 'public']) {
  const protectedPath = join(source, name);
  assert.ok(out !== protectedPath && !out.startsWith(protectedPath + '/'), 'Write diagnostic evidence outside source input directories.');
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const inputs = () => {
  const paths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  for (const name of ['src', 'tests', 'scripts', 'adapters', 'public']) if (existsSync(join(source, name))) visit(join(source, name));
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html']) if (existsSync(join(source, name))) paths.push(join(source, name));
  return Object.fromEntries(paths.sort().map(path => [relative(source, path), sha(readFileSync(path))]));
};
const beforeInputs = inputs(), worldBytes = readFileSync(worldPath), saveBytes = readFileSync(savePath);
const world = JSON.parse(worldBytes.toString()) as WorldDefinition;
const envelope = parseSaveWithinResources(saveBytes.toString());
assert.equal(envelope.format, 'yunshan-save', 'Expected a native yunshan-save envelope.');
assert.ok([1, 2, 3, 4].includes(envelope.version), 'Unsupported native save version.');
assert.ok(envelope.state && typeof envelope.state === 'object' && !Array.isArray(envelope.state), 'Missing saved state.');
assert.ok(envelope.runtime && typeof envelope.runtime === 'object' && !Array.isArray(envelope.runtime), 'Missing saved runtime.');
assert.equal(envelope.worldSeed, world.seed, 'World seed differs from the supplied save.');
assert.equal(envelope.state.seed, world.seed, 'State seed differs from the supplied world.');
assert.equal(savedWorldFingerprint(world), envelope.worldFingerprint, 'World geometry fingerprint differs from the supplied save.');

// Decode the parsed copy only. The two input byte buffers and source files
// remain authoritative originals, and are checked again before any output.
if (envelope.routeEncoding !== undefined || envelope.routePool !== undefined) decodeCitizenRoutes(envelope.routeEncoding, envelope.routePool, envelope.state.citizens);
const businessBefore = JSON.stringify({ state: envelope.state, runtime: envelope.runtime }), worldBefore = JSON.stringify(world);
const observations = observeFoodAccess(envelope.state as SimState, world, envelope.runtime);
assert.equal(JSON.stringify({ state: envelope.state, runtime: envelope.runtime }), businessBefore, 'Observation changed parsed business state or runtime.');
assert.equal(JSON.stringify(world), worldBefore, 'Observation changed the supplied world.');
const afterInputs = inputs();
assert.deepEqual(afterInputs, beforeInputs, 'Source inputs changed during observation.');
assert.equal(sha(readFileSync(savePath)), sha(saveBytes), 'Save bytes changed during observation.');
assert.equal(sha(readFileSync(worldPath)), sha(worldBytes), 'World bytes changed during observation.');
const originalInputs = {
  world: { path: worldPath, bytes: worldBytes.length, sha256: sha(worldBytes) },
  save: { path: savePath, bytes: saveBytes.length, sha256: sha(saveBytes) },
  worldFingerprint: envelope.worldFingerprint,
  source: { path: source, inputCount: Object.keys(beforeInputs).length, files: beforeInputs },
};
mkdirSync(dirname(out), { recursive: true });
mkdirSync(out);
const writeJSON = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
writeFileSync(join(out, 'WORLD-ORIGINAL.json'), worldBytes, { flag: 'wx' });
writeFileSync(join(out, 'TERMINAL-ORIGINAL.save.json'), saveBytes, { flag: 'wx' });
writeJSON('INPUTS-SHA256.json', originalInputs);
writeJSON('food-access-observations.json', {
  authority: { saveSHA256: sha(saveBytes), worldSHA256: sha(worldBytes), worldFingerprint: envelope.worldFingerprint,
    nativeVersion: envelope.version, motionVersion: envelope.motionVersion ?? null,
    referenceCollisionPolicyId: envelope.referenceCollisionPolicyId ?? null, mealRoutePolicyId: envelope.mealRoutePolicyId ?? null },
  ...observations,
});
const receipt = { status: 'PASS_READONLY_OBSERVATION', startedAt, endedAt: new Date().toISOString(), argv: process.argv.slice(2),
  sourceInputsUnchanged: true, originalSaveAndWorldBytesUnchanged: true, parsedStateRuntimeWorldUnchangedAfterRouteDecoding: true,
  simulationsConstructed: 0, createWorldCalls: 0, steps: 0, commands: 0, inputCount: Object.keys(beforeInputs).length,
  worldSHA256: sha(worldBytes), saveSHA256: sha(saveBytes), worldFingerprint: envelope.worldFingerprint,
  boundary: 'Finite diagnostic fields and supplied geometry identity were checked. This is not full Simulation save validation, observed arrival, lawful physical reachability, a future continuation or a sustainability verdict.' };
writeJSON('RECEIPT.json', receipt);
console.log(JSON.stringify({ ...receipt, outputDirectory: out }));
