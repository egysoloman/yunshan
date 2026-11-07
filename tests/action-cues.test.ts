import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CUE_TONES, cueFor } from '../src/audio/cues';

test('a command result chooses its cue; clock controls stay silent', () => {
  assert.equal(cueFor('purchase', true), 'coin');
  assert.equal(cueFor('rent', true), 'coin');
  assert.equal(cueFor('ride', true), 'board');
  assert.equal(cueFor('leaveVehicle', true), 'board');
  assert.equal(cueFor('socialize', true), 'ok');
  assert.equal(cueFor('purchase', false), 'fail');
  assert.equal(cueFor('speed', true), null);
  assert.equal(cueFor('pause', false), null);
  for (const tones of Object.values(CUE_TONES)) for (const t of tones) assert.ok(t.gain > 0 && t.gain <= .06 && t.duration > .01 && t.at >= 0, 'every cue is short and quiet');
});

test('the C# parity fixture is current', () => {
  const fixture = JSON.parse(readFileSync('dotnet/Yunshan.Core.Tests/Parity/action-cues.json', 'utf8'));
  assert.deepEqual(fixture.tones, JSON.parse(JSON.stringify(CUE_TONES)));
  for (const row of fixture.rows) assert.equal(cueFor(row.type, row.ok), row.cue, row.type);
});
