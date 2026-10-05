import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createResearchCity, extension, ok, pending, ticks } from './fixtures/research-city';

/** Same source file is intended to run against immutable14 and candidate.
 * Expected14 behavioural failure must be retained, never rewritten as PASS. */
test('funded research cannot finish merely by leaving for its 120-minute deadline', () => {
  const { world, sim } = createResearchCity();
  const beforeCash = sim.state.player.money, beforeTreasury = sim.state.treasury;
  ok(sim, { type: 'research', targetId: 'medicine', value: 200 });
  const job = pending(sim), technology = extension(sim).technologies.find(t => t.sector === 'medicine')!, level = technology.level;
  assert.equal(sim.state.player.money, beforeCash - 200); assert.equal(sim.state.treasury, beforeTreasury + 200);
  assert.equal(job.finishAt - job.startedAt, 120); assert.equal(technology.progress, 0);
  const evidenceDir = process.env.YUNSHAN_RESEARCH_OLD_PENDING_DIR;
  if (evidenceDir) {
    assert.equal(job.laborVersion, undefined, 'old-origin recorder is only enabled against unmodified baseline14');
    const raw = sim.exportSave(), hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
    const sourceHashes = Object.fromEntries(['simulation/extensions.ts', 'simulation.ts', 'types.ts', 'architecture-floor-plan.ts', 'persistence/world-layout.ts'].map(name => [name, hash(readFileSync(new URL(`../src/${name}`, import.meta.url)))]));
    mkdirSync(evidenceDir, { recursive: true }); writeFileSync(join(evidenceDir, 'pending-save.json'), raw);
    writeFileSync(join(evidenceDir, 'pending-provenance.json'), JSON.stringify({ scope: 'Actual old14 command in controlled seven-building World, before any tick or offsite change', sourceHashes, saveSHA256: hash(raw), clock: extension(sim).lastUpdate, investment: 200, playerCashBefore: beforeCash, playerCashAfter: sim.state.player.money, treasuryBefore: beforeTreasury, treasuryAfter: sim.state.treasury, job }, null, 2) + '\n');
  }
  sim.setFocus(world.spawn, 'walk'); ticks(sim, 30);
  assert.equal(extension(sim).lastUpdate, job.finishAt, 'real ticks reach the original deadline');
  assert.equal(technology.level, level, 'absence must not manufacture research labour');
  assert.equal(technology.progress, 0); assert.equal(technology.funding, 200);
  assert(pending(sim), 'invested paused work remains traceable');
});
