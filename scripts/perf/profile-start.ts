// CPU profile of a fresh product city's first four ticks (start-up route planning).
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import { createProductWorld, createCityLifeProductCity } from '../../src/product-city';
const world = createProductWorld(), sim = await createCityLifeProductCity(world);
sim.setFocus(world.spawn, 'walk');
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.start');
const started = process.cpuUsage();
for (let i = 0; i < 4; i++) sim.step(.25);
const used = process.cpuUsage(started);
const { profile } = await session.post('Profiler.stop');
writeFileSync(process.argv[2], JSON.stringify(profile));
console.log(JSON.stringify({ msFor4: (used.user + used.system) / 1000 }));
