// Result-identity check for performance work: SHA-256 of the complete save
// after every tick of a fresh product city, plus CPU time per tick.
// Usage: node --import tsx scripts/perf/tick-shas.ts <ticks> <out.json> [speed]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createProductWorld, createCityLifeProductCity } from '../../src/product-city';

const ticks = Number(process.argv[2] ?? 40), out = process.argv[3], speed = Number(process.argv[4] ?? 1);
const world = createProductWorld();
const sim = await createCityLifeProductCity(world);
if (speed !== 1) sim.command({ type: 'speed', value: speed });
sim.setFocus(world.spawn, 'walk');
const shas: string[] = [], ms: number[] = [];
for (let i = 0; i < ticks; i++) {
  const start = process.cpuUsage(); sim.step(.25); const used = process.cpuUsage(start);
  ms.push((used.user + used.system) / 1000);
  shas.push(createHash('sha256').update(sim.exportSave()).digest('hex'));
}
const sorted = [...ms].sort((a, b) => a - b);
const late = ms.slice(Math.floor(ms.length / 2)).sort((a, b) => a - b);
const result = { ticks, speed, finalTick: sim.state.tick, medianMs: sorted[Math.floor(sorted.length / 2)], meanMs: ms.reduce((a, b) => a + b, 0) / ms.length, secondHalfMedianMs: late[Math.floor(late.length / 2)], secondHalfP95Ms: late[Math.floor(late.length * .95)], first5Ms: ms.slice(0, 5), ms, shas };
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result, ms: undefined, shas: [shas[0], shas.at(-1)] }));
