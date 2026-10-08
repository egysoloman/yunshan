// Arrays sorted by V8's Array.prototype.sort with inconsistent floating
// near-tie comparators, for the C# V8Sort parity test.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
let seed = 20261008; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const cases = [];
for (let c = 0; c < 60; c++) {
  const n = c < 20 ? 2 + c : c < 40 ? 60 + c * 3 : 150 + c * 6;
  // Points on a few mirrored rings: squared distances tie up to rounding.
  const items = Array.from({ length: n }, (_, i) => { const r = 1 + Math.floor(random() * 6) * .4, s = random() < .5 ? -1 : 1, x = s * (r + Math.floor(random() * 5) * .2), z = -5.2 + Math.floor(random() * 7) * .4; return { i, x, z }; });
  const fx = 0, fz = 14.2, mode = c % 3;
  const cmp = mode === 0 ? (a, b) => (a.x - fx) ** 2 + (a.z - fz) ** 2 - (b.x - fx) ** 2 - (b.z - fz) ** 2
    : mode === 1 ? (a, b) => Math.hypot(a.x, a.z - fz) - Math.hypot(b.x, b.z - fz)
    : (a, b) => a.x * .1 + a.z * .3 - b.x * .1 - b.z * .3;
  const sorted = [...items].sort(cmp);
  cases.push({ mode, items: items.map(p => [p.x, p.z]), order: sorted.map(p => p.i) });
}
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/v8sort.json.gz', gzipSync(JSON.stringify(cases)));
console.log(cases.length, 'cases');
