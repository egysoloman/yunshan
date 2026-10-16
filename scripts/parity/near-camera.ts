// Near-camera hiding over a grid of feet offsets, for the C# Core/NearCamera.cs parity test.
import { writeFileSync } from 'node:fs';
import { clearsCamera, vehicleClearsCamera } from '../../src/rendering/near-camera';
const camera = { x: 12.5, y: 101.72, z: -40.25 }, rows: unknown[] = [];
for (const dx of [-1, -.81, -.8, -.79, -.5, 0, .3, .79, .8, 1.2]) for (const dz of [-.8, -.4, 0, .56, .57, .9]) for (const dy of [-2.2, -2.1, -2.09, -1.72, -.5, 0, .29, .3, .31, 1])
  { const feet = { x: camera.x + dx, y: camera.y + dy, z: camera.z + dz }; rows.push({ feet, clears: clearsCamera(camera, feet) }); }
const vehicles: unknown[] = [];
for (const direction of [0, .7, Math.PI / 2, 2.4, -1.1]) for (const [length, width, lift] of [[5.5, 2.5, 0], [16, 3.3, 0], [3.5, 2.5, 4.6]]) for (const dx of [-3, -1.4, 0, 1.2, 2.9]) for (const dz of [-9, -2.9, 0, 2.5, 8.2]) for (const dy of [-2, -.2, 1.5, 3.4, 4.8, 9])
  { const position = { x: camera.x + dx, y: camera.y - 1.72 + dy - 1.5, z: camera.z + dz }; vehicles.push({ position, direction, length, width, lift, clears: vehicleClearsCamera(camera, position, direction, length, width, lift) }); }
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/near-camera.json', JSON.stringify({ camera, rows, vehicles }));
console.log(`${rows.length} rows, ${vehicles.length} vehicle rows`);
