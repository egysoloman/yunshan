// 千灯市集 lantern-string boxes and cords, call by call as the web renderer's
// buildNetwork emits them (C# LanternStrings parity test).
//   npx tsx scripts/parity/lantern-strings.ts [out]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { lanternStrings } from '../../src/rendering/lantern-strings';

const calls: unknown[] = [];
const box = (key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) => calls.push(['b', key, x, y, z, sx, sy, sz, color, 0, false]);
for (const string of lanternStrings(createWorld(20261001, 'current-v8'))) {
  for (const pole of string.poles) { box('wood', pole.x, pole.y + 2.9, pole.z, .3, 5.8, .3, '#5a3a26'); box('wood', pole.x, pole.y + 5.85, pole.z, .5, .2, .5, '#3d2a1d'); }
  const [a, b] = string.poles; calls.push(['s', 'wood', a.x, a.y + 5.75, a.z, b.x, b.y + 5.75, b.z, .05, .05, 0, '#2f2a24']);
  for (const l of string.lanterns) { box('red', l.x, l.y, l.z, .55, .7, .55, '#b8432f'); box('wood', l.x, l.y + .42, l.z, .35, .12, .35, '#3d2a1d'); }
}
const json = JSON.stringify(calls);
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/lantern-strings-v8.json.gz', gzipSync(json, { level: 9 }));
console.log(`${calls.length} calls, ${json.length} bytes`);
