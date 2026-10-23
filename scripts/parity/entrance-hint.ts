// Entrance hints over seeded positions and facings around real current-v8 doors, for the C# Core/EntranceHint.cs parity test.
import { writeFileSync } from 'node:fs';
import { createProductWorld } from '../../src/product-city';
import { entranceHint } from '../../src/entrance-hint';
const world = createProductWorld(); let seed = 20261018; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const buildings = world.buildings.filter((_, i) => i % 6 === 0).map(b => ({ name: b.name, door: b.door }));
const rows: unknown[] = [];
for (let n = 0; n < 300; n++) {
  const at = buildings[Math.floor(rnd() * buildings.length)].door, r2 = (v: number) => Math.round(v * 100) / 100;
  const position = { x: r2(at.x + (rnd() - .5) * 180), y: r2(at.y + (rnd() - .5) * 10), z: r2(at.z + (rnd() - .5) * 180) }, angle = rnd() * Math.PI * 2;
  const forward = { x: r2(Math.sin(angle)), z: r2(Math.cos(angle)) };
  rows.push({ position, forward, hint: entranceHint(position, forward, buildings) });
}
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/entrance-hint.json', JSON.stringify({ buildings, rows }));
console.log(`${buildings.length} buildings, ${rows.length} rows, ${rows.filter(r => (r as { hint: string | null }).hint).length} with a hint`);
