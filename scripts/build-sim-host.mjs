// Bundles the authoritative simulation host for the Unity client.
// Output: unity/Assets/StreamingAssets/yunshan-sim/sim-host.mjs (run with Node >= 22).
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const outfile = new URL('../unity/Assets/StreamingAssets/yunshan-sim/sim-host.mjs', import.meta.url).pathname;
mkdirSync(new URL('../unity/Assets/StreamingAssets/yunshan-sim/', import.meta.url).pathname, { recursive: true });
const result = await build({
  entryPoints: [new URL('../src/native-host/sim-host.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile,
  legalComments: 'none', metafile: true, logLevel: 'warning',
});
const inputs = Object.keys(result.metafile.inputs);
if (inputs.some(name => name.includes('node_modules/three'))) throw new Error('simulation host must not bundle the web renderer');
const bytes = statSync(outfile).size, sha256 = createHash('sha256').update(readFileSync(outfile)).digest('hex');
console.log(JSON.stringify({ outfile, bytes, sha256, inputs: inputs.length }));
