// Crowd-spot visit targets on the product world over a grid, for the C# CrowdSpots.Target parity test.
import { writeFileSync } from 'node:fs';
import { createProductWorld } from '../../src/product-city';
import { crowdSpotTarget } from '../../src/rendering/crowd-spots';
const world = createProductWorld(), xs = world.buildings.map(b => b.door.x), zs = world.buildings.map(b => b.door.z);
const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], rows: unknown[] = [];
for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
  const spot = { x: x0 + (x1 - x0) * i / 19 + .37, z: z0 + (z1 - z0) * j / 19 - .21 };
  rows.push({ ...spot, target: crowdSpotTarget(world.buildings, spot) });
}
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/crowd-targets.json', JSON.stringify(rows));
console.log(`${rows.length} rows, ${new Set(rows.map((r: any) => r.target)).size} targets`);
