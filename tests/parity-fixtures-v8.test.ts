import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createWorld } from '../src/world';
import { canonical } from '../scripts/parity/world';

// The C# client receives current-v8 from the host and its parity tests replay
// this committed reference; a recipe change must regenerate it
// (npx tsx scripts/parity/world.ts dotnet/Yunshan.Core.Tests/Parity/world-current-v8.json.gz current-v8).
test('the committed current-v8 world reference is the world the recipe generates', () => {
  const { fleetPlan: _fleet, ...world } = createWorld(20261001, 'current-v8');
  const committed = gunzipSync(readFileSync('dotnet/Yunshan.Core.Tests/Parity/world-current-v8.json.gz')).toString('utf8');
  assert.ok(JSON.stringify(canonical(world)) === committed, 'regenerate world-current-v8.json.gz and network-v8.json.gz');
});
