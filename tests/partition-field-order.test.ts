import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('partition order metadata cannot silently discard existing service books or opaque extension fields', () => {
  // The generic transport contract accepts partial documents and preserves
  // unknown extension fields; this is not a fixture for financial authority.
  const raw = JSON.stringify({ format: 'yunshan-save', state: {
    citizens: [], player: { money: 9 },
    culture: { version: 2, orders: [], supplementalBudgets: { version: 2, requests: [{ id: 'retained-request', cap: 11 }] } },
    extensionOpaque: { claim: 'retained', amount: 7 },
  }, runtime: { retainedPolicy: 'original', retainedClock: 3 } });
  assert.equal(assembleSave(partitionSave(raw)), raw);
  for (const [path, keys] of [
    ['state', ['citizens', 'player', 'culture']],
    ['runtime', ['retainedClock']],
    ['state.culture', ['version', 'orders']],
    ['state.culture.supplementalBudgets', ['version']],
    ['state.extensionOpaque', ['claim']],
    ['runtime', ['retainedPolicy', 'retainedClock', 'retainedClock']],
    ['runtime', ['retainedPolicy', 'retainedClock', 'unknown']],
  ] as const) {
    const parts = partitionSave(raw), global = JSON.parse(parts[0].json);
    global.layout.order[path] = keys; parts[0].json = JSON.stringify(global);
    assert.throws(() => assembleSave(parts), /字段顺序/, path);
  }
});

test('genuine old-one bytes roundtrip with original key order; dropping an existing legacy runtime field is rejected', () => {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/family-fee-v1/oracle-old-v1-held-18.5.save.json.gz', import.meta.url))).toString('utf8');
  assert.equal(JSON.parse(raw).version, 1);
  const parts = partitionSave(raw);
  assert.equal(assembleSave(parts), raw);
  const global = JSON.parse(parts[0].json), removed = global.layout.order.runtime.pop();
  assert.equal(typeof removed, 'string'); parts[0].json = JSON.stringify(global);
  assert.throws(() => assembleSave(parts), /字段顺序/);
});
