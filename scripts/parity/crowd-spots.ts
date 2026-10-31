// Crowd spots over seeded random populations, for the C# Core/CrowdSpots.cs parity test.
import { writeFileSync } from 'node:fs';
import { crowdSpots } from '../../src/rendering/crowd-spots';
const states = ['moving', 'working', 'socializing', 'shopping', 'sleeping', 'atHome', 'dead', 'studying'];
let seed = 20261015; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const rows: unknown[] = [];
for (let n = 0; n < 80; n++) {
  const count = Math.floor(rnd() * 400), spread = 100 + rnd() * 3000, people = [];
  for (let i = 0; i < count; i++) {
    const cluster = rnd() < .5;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    people.push({ position: { x: r2((cluster ? 40 : 0) + (rnd() - .5) * (cluster ? 200 : spread)), z: r2((cluster ? -70 : 0) + (rnd() - .5) * (cluster ? 200 : spread)) }, state: states[Math.floor(rnd() * states.length)], alive: rnd() > .05 });
  }
  rows.push({ people, spots: crowdSpots(people) });
}
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/crowd-spots.json', JSON.stringify(rows));
console.log(`${rows.length} rows`);
