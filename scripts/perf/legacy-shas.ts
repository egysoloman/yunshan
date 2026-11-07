// SHA-256 of the full save after each tick of an archived (legacy-rule) product
// city: checks that a new declared policy leaves undeclared cities identical.
// Usage: node --import tsx scripts/perf/legacy-shas.ts <ticks> [out.json]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createArchivedProductCity, createProductWorld } from '../../src/product-city';

const ticks = Number(process.argv[2] ?? 40), out = process.argv[3];
const world = createProductWorld(), sim = createArchivedProductCity(world);
sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
const shas: string[] = [];
for (let i = 0; i < ticks; i++) { sim.step(.25); shas.push(createHash('sha256').update(sim.exportSave()).digest('hex')); }
if (out) writeFileSync(out, JSON.stringify(shas));
console.log(ticks, shas.at(-1));
