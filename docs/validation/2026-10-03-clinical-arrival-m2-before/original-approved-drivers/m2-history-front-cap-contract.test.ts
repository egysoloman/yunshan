import assert from 'node:assert/strict';
import test from 'node:test';
import { intervalMinutes } from './m2-window-contract.ts';

// Supplied pure interval example ONLY: not an actual M1 wage, saved contract,
// cap approval, clinical business failure, or proof of genuine 64-minute duty.
// This file imports no Simulation and has not been executed in CODEPREP.
test('M2 pure contract: a credited historical front does not become a current-phase tail', () => {
  const suppliedWorkWindow = { start: 484, end: 486 };
  const suppliedCurrentPhase = { start: 544, end: 548 };
  const suppliedOrderLifetime = { start: 540, end: 548 };
  assert.equal(intervalMinutes(suppliedWorkWindow, suppliedCurrentPhase, suppliedOrderLifetime), 0);
  assert.equal(Math.min(2, 4), 2, 'the tempting quantity-only clamp admits history and is not the window contract');
});
