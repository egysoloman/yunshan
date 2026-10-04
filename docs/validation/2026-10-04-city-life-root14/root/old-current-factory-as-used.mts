import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Simulation } from './assembly/src/simulation.ts';
import { createCurrentProductCity } from './assembly/src/product-city.ts';
import { selectSavedWorld } from './assembly/src/persistence/world-layout.ts';
import { partitionSave, assembleSave } from './assembly/src/persistence/partition.ts';
import { fixture } from './assembly/tests/clinical-presence-fixture.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const output = new URL('./old-current-factory01/original-artifacts/', import.meta.url);
mkdirSync(output, { recursive: true });
const summary: unknown[] = [];
const old1 = readFileSync(new URL('./assembly/tests/fixtures/roads-old22/cold.json', import.meta.url), 'utf8');
const old2 = gunzipSync(readFileSync(new URL('./assembly/tests/fixtures/ruleset-core/compat-native-cold.save.json.gz', import.meta.url))).toString('utf8');
const oracle2 = JSON.parse(readFileSync(new URL('./assembly/tests/fixtures/ruleset-core/compat-native-provenance.json', import.meta.url), 'utf8'));
for (const entry of [
  { label: 'actual-native1', raw: old1, world: selectSavedWorld(old1).world, version: 1, oracle: null },
  { label: 'actual-native2', raw: old2, world: fixture(false), version: 2, oracle: oracle2 },
]) {
  const current = createCurrentProductCity(entry.world), control = new Simulation(entry.world);
  assert.equal(current.saveVersion, 4);
  assert.equal(current.state.civicStaffing!.version, 2);
  assert.equal(current.state.civicHistory!.version, 1);
  const full = current.importSave(entry.raw);
  assert.equal(full.ok, true, full.message);
  assert.equal(current.exportSave(), entry.raw, entry.label + ' full original bytes');
  const assembled = assembleSave(partitionSave(entry.raw, entry.world));
  assert.equal(assembled, entry.raw, entry.label + ' partition original bytes');
  const partition = current.importSave(assembled);
  assert.equal(partition.ok, true, partition.message);
  const reference = control.importSave(entry.raw);
  assert.equal(reference.ok, true, reference.message);
  for (const city of [current, control]) {
    assert.equal(city.exportSave(), entry.raw);
    assert.equal(city.saveVersion, entry.version);
    assert.equal(city.motionVersion, entry.version);
    assert.equal(city.effectiveRuleset, 'legacy');
    assert.equal(city.state.civicStaffing, undefined);
    assert.equal(city.state.civicHistory, undefined);
    assert.equal(city.state.budgetAuthority, undefined);
  }
  const rows: unknown[] = [];
  for (let tick = 0; tick < 24; tick++) {
    current.step(.25); control.step(.25);
    const actual = current.exportSave(), expected = control.exportSave();
    assert.ok(actual === expected, entry.label + ' future ' + (tick + 1) + ': ' + sha(actual) + '/' + sha(expected));
    if (entry.oracle) {
      assert.equal(current.state.tick, entry.oracle.rows[tick].tick);
      assert.equal(current.state.extension!.lastUpdate, entry.oracle.rows[tick].clock);
      assert.equal(sha(actual), entry.oracle.rows[tick].sha256);
    }
    assert.equal(current.state.civicHistory, undefined);
    rows.push({ futureTick: tick + 1, tick: current.state.tick, clock: current.state.extension!.lastUpdate, sha256: sha(actual) });
  }
  writeFileSync(new URL(entry.label + '-after24.save.json', output), current.exportSave());
  summary.push({ label: entry.label, sourceSHA256: sha(entry.raw), sourceVersion: entry.version, newFactoryInitially4: true,
    fullImmediateExact: true, partitionImmediateExact: true, partitionLoadedFuture24AgainstLegacyControlExact: true,
    independentOriginalOracle: entry.oracle ? 'original native2 every tick24 SHA' : 'original source-byte import; unchanged legacy constructor control, not an independently captured native1 future oracle',
    newHistoryDisabledEveryFutureTick: true, rows });
}
const result = { status: 'PASS', scope: 'Current v4 new-city factory explicitly loads actual old1/2 without changing their envelopes or enabling rules; not natural default day or full suite', cases: summary };
writeFileSync(new URL('summary.json', output), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, oldVersions: [1, 2], futureTicksEach: 24, factoryBeforeImport: 4, hiddenUpgrade: false }));
