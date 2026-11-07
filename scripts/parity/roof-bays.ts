// Shophouse roof bays (programRoofBays) over every program body's gable shell in a layout,
// for the C# RoofShell.Bays parity test:  npx tsx scripts/parity/roof-bays.ts [out] [layout]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { programRoofBays, programRoofShell } from '../../src/renderer';
import { buildProgramArchitecture } from '../../src/rendering/architecture-bodies';

const layout = (process.argv[3] ?? 'current-v9') as Parameters<typeof createWorld>[1];
const world = createWorld(20261001, layout), rows: unknown[] = [];
for (const b of world.buildings) {
  const parts = buildProgramArchitecture(b, 'far'); if (!parts) continue;
  const shell = programRoofShell(b, parts), bays = shell && programRoofBays(b, shell);
  rows.push([b.id, bays ? bays.map(bay => [bay.width, bay.depth, bay.rise, bay.turned, bay.position.x, bay.position.y, bay.position.z, bay.color]) : null]);
}
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/roof-bays-v9.json.gz', gzipSync(JSON.stringify(rows), { level: 9 }));
console.log(`${rows.length} bodies, ${rows.filter(r => (r as unknown[])[1]).length} with bays`);
