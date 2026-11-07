// Terrain heights around the market district's buildings (C# World.TerrainHeight parity test).
// current-v9's near-vertical market plinths live within a few metres of these walls.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld, terrainHeight } from '../../src/world';

const layout = (process.argv[3] ?? 'current-v9') as Parameters<typeof createWorld>[1];
const world = createWorld(20261001, layout), rows: number[][] = [];
for (const b of world.buildings.filter(site => site.districtId === 'market'))
  for (const [u, v] of [[-.5, 0], [.5, 0], [0, -.5], [0, .5], [.5, .5], [-.5, -.5]]) for (const out of [1, 2.4, 3.6, 6]) {
    const x = b.position.x + u * b.width + Math.sign(u) * out, z = b.position.z + v * b.depth + Math.sign(v) * out;
    rows.push([x, z, terrainHeight(world, x, z, true)]);
  }
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/terrain-v9.json.gz', gzipSync(JSON.stringify(rows), { level: 9 }));
console.log(`${layout}: ${rows.length} samples`);
