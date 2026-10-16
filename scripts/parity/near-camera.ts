// Near-camera hiding over a grid of feet offsets, for the C# Core/NearCamera.cs parity test.
import { writeFileSync } from 'node:fs';
import { clearsCamera } from '../../src/rendering/near-camera';
const camera = { x: 12.5, y: 101.72, z: -40.25 }, rows: unknown[] = [];
for (const dx of [-1, -.81, -.8, -.79, -.5, 0, .3, .79, .8, 1.2]) for (const dz of [-.8, -.4, 0, .56, .57, .9]) for (const dy of [-2.2, -2.1, -2.09, -1.72, -.5, 0, .29, .3, .31, 1])
  { const feet = { x: camera.x + dx, y: camera.y + dy, z: camera.z + dz }; rows.push({ feet, clears: clearsCamera(camera, feet) }); }
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/near-camera.json', JSON.stringify({ camera, rows }));
console.log(`${rows.length} rows`);
