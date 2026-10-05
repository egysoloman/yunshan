import { build, version as esbuildVersion } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const adapter = dirname(fileURLToPath(import.meta.url));
const root = resolve(adapter, '../..');
const outIndex = process.argv.indexOf('--out');
if (outIndex < 0 || !process.argv[outIndex + 1]) throw new Error('Use --out /absolute/fresh-output-directory');
const out = resolve(process.argv[outIndex + 1]);
const sha = data => createHash('sha256').update(data).digest('hex');
const baseline = JSON.parse(await readFile(resolve(adapter, 'core-source-manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(baseline.files)) {
  if (sha(await readFile(resolve(root, name))) !== expected) throw new Error(`Frozen core changed: ${name}`);
}
await mkdir(out, { recursive: false });
const startedAt = new Date().toISOString();
const result = await build({ absWorkingDir: root, entryPoints: ['adapters/rpg-maker/bridge.ts'], bundle: true, format: 'iife', globalName: 'YunshanCore', platform: 'browser', target: ['es2022'], write: false, metafile: true, legalComments: 'eof', footer: { js: 'globalThis.YunshanCore = YunshanCore;' } });
for (const input of Object.keys(result.metafile.inputs)) {
  if (/node_modules|renderer|controller|main\.ts|ui\.ts|\.css/.test(input)) throw new Error(`Presentation/runtime dependency in core bundle: ${input}`);
}
const js = result.outputFiles[0].contents;
const context = vm.createContext({});
vm.runInContext(new TextDecoder().decode(js), context, { timeout: 30000 });
if (context.window !== undefined || context.document !== undefined || context.THREE !== undefined || context.require !== undefined) throw new Error('Unexpected host dependency.');
const session = context.YunshanCore.createSession();
const world = session.worldSnapshot();
const state = session.snapshot();
const enumText = await readFile(resolve(root, 'src/types.ts'), 'utf8');
const commandTypes = [...enumText.match(/export interface Command \{ type: (.*?);/s)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
await writeFile(resolve(out, 'YunshanCore.js'), js);
await writeFile(resolve(out, 'bundle-metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
await writeFile(resolve(out, 'world-current-v4.json'), JSON.stringify(world) + '\n');
await writeFile(resolve(out, 'initial-core.save.json'), session.exportCoreSave());
await writeFile(resolve(out, 'contract.json'), JSON.stringify({ ...session.metadata, commandTypes, systems: state.lastSystemOrder, fixedPhaseOrder: ['time','environment','energy','traffic','people','commerce','finance','security','politics','feedback'], initial: { buildings: world.buildings.length, citizens: state.citizens.length, districts: world.districts.length, nodes: world.nodes.length, edges: world.edges.length, spawn: world.spawn, tick: state.tick, day: state.day, hour: state.hour, speed: state.speed }, completeSnapshotModules: Object.keys(state), rngOwner: 'Simulation.runtime.rng; serialized inside coreSave, never presentation RNG', clockOwner: 'CitySession.advance once per host frame; Simulation.step owns ten phases', queueLimit: 256, resultLimit: 256, note: 'This is the real frozen city core and movement bridge. It is not an RPG Maker project or a claim that all planned city subsystems are complete.' }, null, 2) + '\n');
const after = {};
for (const [name, expected] of Object.entries(baseline.files)) {
  const actual = sha(await readFile(resolve(root, name))); after[name] = actual;
  if (actual !== expected) throw new Error(`Frozen core mutated while bundling: ${name}`);
}
const outputHashes = {};
for (const name of (await readdir(out)).sort()) outputHashes[name] = sha(await readFile(resolve(out, name)));
const receipt = { baseCommit: baseline.baseCommit, startedAt, endedAt: new Date().toISOString(), esbuildVersion, coreInputsStable: true, runtimeInputCount: Object.keys(result.metafile.inputs).length, runtimeThree: false, runtimeDOM: false, outputHashes };
await writeFile(resolve(out, 'build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify(receipt) + '\n');
