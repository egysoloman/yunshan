import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation as Current } from '/workspace/yunshan/src/simulation.ts';
import { Simulation as Original } from './old18-source/src/simulation.ts';
import { world } from '/workspace/yunshan/tests/governance-fixture.ts';

const root = new URL('./', import.meta.url);
const origin = JSON.parse(readFileSync('/workspace/yunshan/tests/fixtures/governance-old18/campaign.json', 'utf8'));
const old = new Original(world()), current = new Current(world());
assert.equal(old.importSave(origin.save).ok, true);
assert.equal(current.importSave(origin.save).ok, true);
assert.equal(old.exportSave(), origin.save);
assert.equal(current.exportSave(), origin.save);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function diffs(a: any, b: any, path = '', rows: any[] = []): any[] {
  if (Object.is(a, b)) return rows;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    rows.push({ path, old: a, current: b }); return rows;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[key], b[key], `${path}/${key}`, rows);
  return rows;
}
const result: any = { sourceCommit: origin.sourceCommit, currentCommit: 'c7f300e21cea6c8badfc6f190a28f9d08bbb1a03', immediateEqual: true, ticks: [] };
for (let i = 0; i < 32; i++) {
  old.step(.25); current.step(.25);
  const a = old.exportSave(), b = current.exportSave();
  assert.equal(hash(a), origin.followingSha256[i], `true old reader tick ${i + 1}`);
  result.ticks.push({ tick: i + 1, originalHash: hash(a), currentHash: hash(b), equal: a === b });
  if (a !== b && result.firstDivergence === undefined) {
    result.firstDivergence = { tick: i + 1, differences: diffs(JSON.parse(a), JSON.parse(b)) };
    writeFileSync(new URL('original-first-divergence.save.json', root), a);
    writeFileSync(new URL('current-first-divergence.save.json', root), b);
  }
}
result.originalMayor = old.hasIdentity('mayor');
result.currentMayor = current.hasIdentity('mayor');
result.originalGovernance = old.state.governance;
result.currentGovernance = current.state.governance;
writeFileSync(new URL('old18-comparison.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ firstDivergence: result.firstDivergence, ticks: result.ticks.length, originalMayor: result.originalMayor, currentMayor: result.currentMayor }));
