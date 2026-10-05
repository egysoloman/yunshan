import assert from 'node:assert/strict';
import test from 'node:test';
import { intervalMinutes } from './clinical-arrival-window-contract.ts';

// Pure supplied-interval math only. D3 has no authentic historical 64-minute
// native record, so this is not a reproduced M1 business/attendance failure.
test('supplied historical credited front cannot become a current-phase suffix', () => {
  const actualWindow = { start: 480, end: 544 }, fundedFront = { start: 480, end: 482 }, phase = { start: 540, end: 544 };
  assert.equal(intervalMinutes(actualWindow, fundedFront, phase), 0);
  assert.equal(intervalMinutes(actualWindow, phase), 4);
});
