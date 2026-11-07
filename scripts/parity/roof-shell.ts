// Pitched roof shell (and hall skirt) of every program body in a layout, for
// the C# RoofShell parity test:  npx tsx scripts/parity/roof-shell.ts [out] [layout]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { programRoofShell } from '../../src/renderer';
import { buildProgramArchitecture } from '../../src/rendering/architecture-bodies';

const layout = (process.argv[3] ?? 'current-v8') as Parameters<typeof createWorld>[1];
const world = createWorld(20261001, layout), rows: unknown[] = [];
for (const b of world.buildings) {
  const parts = buildProgramArchitecture(b, 'far'); if (!parts) continue;
  const s = programRoofShell(b, parts);
  rows.push(s ? [b.id, s.form, s.color, s.width, s.depth, s.rise, s.position.x, s.position.y, s.position.z, s.floor,
    s.skirt ? [s.skirt.width, s.skirt.depth, s.skirt.rise, s.skirt.position.x, s.skirt.position.y, s.skirt.position.z, s.skirt.floor, ...s.skirt.hole] : null] : [b.id, null]);
}
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/roof-shells-v8.json.gz', gzipSync(JSON.stringify(rows), { level: 9 }));
console.log(`${rows.length} bodies, ${rows.filter(r => (r as unknown[])[1]).length} shells, ${rows.filter(r => (r as unknown[])[10]).length} skirts`);
