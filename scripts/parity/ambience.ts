// Ambience levels over a grid of inputs, for the C# Core/Ambience.cs parity test.
import { writeFileSync } from 'node:fs';
import { ambienceLevels } from '../../src/audio/ambience';
const rows: unknown[] = [];
for (const hour of [0, 5.5, 6, 12, 18.5, 19.9, 23]) for (const height of [0, 40, 400]) for (const water of [0, 30, 200]) for (const people of [0, 5, 20]) for (const speed of [0, .4, 3, 9]) for (const inside of [false, true]) for (const weather of ['晴', '雨']) for (const paused of [false, true]) {
  const input = { hour, position: { x: 0, y: 100 + height, z: 0 }, ground: 100, waterDistance: water, nearbyPeople: people, walkingSpeed: speed, inside, weather, paused };
  rows.push({ input, levels: ambienceLevels(input) });
}
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/ambience.json', JSON.stringify(rows));
console.log(`${rows.length} rows`);
