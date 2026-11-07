// Rain streak tops for chosen streaks, times and cameras, for the C# Core/Rain.cs parity test.
import { writeFileSync } from 'node:fs';
import { RAIN, rainDrop } from '../../src/rendering/rain';
const cameras = [{ x: 0, y: 0, z: 0 }, { x: -1341.9, y: 290.32, z: -440 }, { x: 812.4, y: 48.8, z: 1063.25 }, { x: -59.99, y: 541.72, z: -1343.6 }];
const rows: unknown[] = [];
for (const camera of cameras) for (const elapsed of [0, .016, 1.5, 37.25, 3600.125]) for (let i = 0; i < RAIN.count; i += 97) rows.push({ i, elapsed, camera, top: rainDrop(i, elapsed, camera) });
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/rain.json', JSON.stringify({ constants: RAIN, rows }));
console.log(`${rows.length} rows`);
