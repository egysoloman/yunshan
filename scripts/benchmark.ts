import { performance } from 'node:perf_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world.ts';
import { Simulation } from '../src/simulation.ts';

const start = performance.now();
const world = createWorld();
const generated = performance.now();
const sim = new Simulation(world);
// Explicit eightfold fast-forward covers fourteen game days while preserving
// the same physical / clock ratio as ordinary one-minute-per-second play.
assert(sim.command({ type: 'speed', value: 8 }).ok);
const initialized = performance.now();
const sourceHashes = Object.fromEntries(await Promise.all(['src/world.ts', 'src/simulation.ts', 'src/simulation/extensions.ts', 'src/types.ts'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
globalThis.gc?.();
const initialHeapMB = process.memoryUsage().heapUsed / 1024 / 1024;
sim.setFocus(world.spawn, 'walk');
const samples: number[] = [];
const startingDay = sim.state.day;
const loopStart = performance.now();
let minimumTreasury = sim.state.treasury;
for (let tick = 0; tick < 10000; tick++) {
  const begin = performance.now();
  sim.step(0.25);
  minimumTreasury = Math.min(minimumTreasury, sim.state.treasury);
  samples.push(performance.now() - begin);
  if (tick % 1000 === 0) {
    const district = world.districts[Math.floor(tick / 1000) % world.districts.length];
    sim.setFocus(district.center, tick % 2000 === 0 ? 'walk' : 'drone');
  }
}
const loopEnd = performance.now();
const beforeCollectionHeapMB = process.memoryUsage().heapUsed / 1024 / 1024;
for (const citizen of sim.state.citizens) {
  assert(Number.isFinite(citizen.position.x) && Number.isFinite(citizen.position.y) && Number.isFinite(citizen.position.z));
  assert(Number.isFinite(citizen.money));
  assert(Object.values(citizen.needs).every(value => Number.isFinite(value) && value >= 0 && value <= 100));
}
for (const district of sim.state.districts) {
  assert(Number.isFinite(district.energy) && Number.isFinite(district.safety) && Number.isFinite(district.employment));
}
const save = sim.exportSave();
const restored = new Simulation(world);
assert(restored.importSave(save).ok, 'long-running city must remain loadable');
assert.equal(JSON.stringify(restored.state), JSON.stringify(sim.state), 'restoration preserves the entire authoritative state');
const measuredTicks = sim.state.tick;
const gameDays = sim.state.day - startingDay;
const metrics = { ...sim.state.metrics };
const profiles = sim.state.extension?.actorProfiles ?? {};
const society = {
  aliveCitizens: sim.state.citizens.filter(citizen => profiles[citizen.id]?.alive !== false).length,
  averageHealth: sim.state.citizens.reduce((sum, citizen) => sum + (profiles[citizen.id]?.health ?? 100), 0) / sim.state.citizens.length,
  playerAlive: profiles.player?.alive ?? true,
  companies: sim.state.extension?.companies.length ?? 0,
  audits: sim.state.extension?.audits.length ?? 0,
  technologyLevels: sim.state.extension?.technologies.map(technology => ({ sector: technology.sector, level: technology.level })) ?? [],
  extensionStats: sim.state.extension?.stats,
  treasury: sim.state.treasury,
  minimumTreasury,
  averageNeeds: Object.fromEntries(Object.keys(sim.state.citizens[0].needs).map(key => [key, sim.state.citizens.reduce((sum, citizen) => sum + citizen.needs[key as keyof typeof citizen.needs], 0) / sim.state.citizens.length])),
  deaths: sim.state.citizens.filter(citizen => profiles[citizen.id]?.alive === false).map(citizen => ({ id: citizen.id, role: citizen.role, money: citizen.money, needs: citizen.needs, history: profiles[citizen.id].historyTags })),
};
for (let tick = 0; tick < 24; tick++) { sim.step(0.25); restored.step(0.25); }
assert.equal(JSON.stringify(restored.state), JSON.stringify(sim.state), 'restored timers and RNG produce the same continuation');
globalThis.gc?.();
samples.sort((a, b) => a - b);
const result = {
  environment: `Linux cloud · Node ${process.version}; simulation CPU timings only, not macOS rendering FPS`,
  sourceHashes,
  simulationSpeed: 8, scope: 'Accelerated long-run verification; ordinary play starts at 1×',
  districts: world.districts.length, buildings: world.buildings.length, networkEdges: world.edges.length,
  citizens: sim.state.citizens.length, vehicles: sim.state.vehicles.length,
  generatedMs: generated - start, initializedMs: initialized - generated,
  calls: samples.length, ticks: measuredTicks, gameDays, identicalContinuationTicks: 24,
  totalSimulationMs: loopEnd - loopStart,
  medianStepMs: samples[Math.floor(samples.length / 2)], p95StepMs: samples[Math.floor(samples.length * 0.95)], maxStepMs: samples.at(-1),
  saveBytes: Buffer.byteLength(save), initialHeapMB, beforeCollectionHeapMB,
  retainedHeapMB: process.memoryUsage().heapUsed / 1024 / 1024, collectedBeforeMeasurement: typeof globalThis.gc === 'function',
  retainedHeapScope: 'One shared world and two live simulations, plus save text; heap after explicit GC, not browser GPU memory',
  metrics, society,
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/benchmark.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
