// CPU profile of steady-state ticks only (after a warm-up), for performance work.
// Usage: node --import tsx scripts/perf/profile-steady.ts <warmup> <ticks> <out.cpuprofile> [speed]
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import { createProductWorld, createCityLifeProductCity } from '../../src/product-city';

const warmup = Number(process.argv[2] ?? 60), ticks = Number(process.argv[3] ?? 40), out = process.argv[4] ?? 'steady.cpuprofile', speed = Number(process.argv[5] ?? 1);
const world = createProductWorld(), sim = await createCityLifeProductCity(world);
sim.setFocus(world.spawn, 'walk');
if (speed !== 1) sim.command({ type: 'speed', value: speed });
for (let i = 0; i < warmup; i++) sim.step(.25);
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.start');
const started = process.cpuUsage();
for (let i = 0; i < ticks; i++) sim.step(.25);
const used = process.cpuUsage(started);
const { profile } = await session.post('Profiler.stop');
writeFileSync(out, JSON.stringify(profile));
console.log(JSON.stringify({ warmup, ticks, msPerTick: (used.user + used.system) / 1000 / ticks }));
