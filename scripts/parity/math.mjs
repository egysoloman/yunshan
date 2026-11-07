// Writes SHA-256 digests of V8 Math results over a deterministic input set.
// The C# JsMath port must reproduce every bit: dotnet/Yunshan.Core.Tests.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
function* inputs(count) {
  let seed = 0x9E3779B9 >>> 0;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const special = [0, -0, 1, -1, .5, -.5, 1.5, 2.5, -2.5, 0.49999999999999994, Math.PI / 4, Math.PI / 2, Math.PI, 1e-300, 5e-324, 1e21, 1e-7, 123456789.125, 709.78, -745.2, 1e308, Infinity, -Infinity, NaN];
  for (const s of special) for (const t of special) yield [s, t, s];
  for (let i = 0; i < count; i++) {
    const scale = [1, 3.2, 10, 640, 1e3, 1e5, 1e9, 1e-3][i % 8];
    yield [(next() * 2 - 1) * scale, (next() * 2 - 1) * scale * (i % 3 ? 1 : .01), (next() * 2 - 1) * 50];
  }
}
const fns = {
  sin: ([x]) => Math.sin(x), cos: ([x]) => Math.cos(x), exp: ([, , e]) => Math.exp(e),
  atan2: ([x, y]) => Math.atan2(y, x), hypot2: ([x, y]) => Math.hypot(x, y), hypot3: ([x, y, e]) => Math.hypot(x, y, e),
  round: ([x, y]) => Math.round(x * (y > 0 ? 1 : 1 / 64)), max: ([x, y]) => Math.max(x, y), min: ([x, y]) => Math.min(x, y),
};
if (process.argv[2] === '--dump') {
  const out = [];
  for (const input of inputs(200000)) for (const fn of Object.values(fns)) out.push(fn(input));
  writeFileSync(process.argv[3], Buffer.from(new Float64Array(out).buffer));
  process.exit(0);
}
const digests = {};
for (const [name, fn] of Object.entries(fns)) {
  const hash = createHash('sha256'), b = Buffer.alloc(8);
  // NaN payloads are unobservable in JS and differ by platform; canonicalise.
  for (const input of inputs(200000)) { const r = fn(input); if (Number.isNaN(r)) b.writeBigUInt64LE(0x7FF8000000000000n); else b.writeDoubleLE(r); hash.update(b); }
  digests[name] = hash.digest('hex');
}
const strings = createHash('sha256');
for (const [x, y] of inputs(200000)) strings.update(String(x) + '|' + String(x * y) + '|' + String(Math.round(x * 5) / 5) + '\n');
digests.toString = strings.digest('hex');
writeFileSync(process.argv[2], JSON.stringify({ node: process.version, count: 200000, digests }, null, 2) + '\n');
console.log(digests);
