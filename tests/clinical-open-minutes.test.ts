import assert from 'node:assert/strict';
import test from 'node:test';
import { clinicalOpenMinutes } from '../src/simulation/clinical.ts';
import type { SimState } from '../src/types.ts';

// Clock-only inputs exercise the real shared interval; no city or patient is
// created, and no Simulation, wages, resource balance or medical order advances.
const at = (minute: number, day = 0): SimState => ({ hour: minute / 60, extension: { lastUpdate: day * 1440 + minute } } as SimState);

test('medical admission retains the pre-closing prefix at and across17:00', () => {
  assert.equal(clinicalOpenMinutes(at(17 * 60), 4), 4, '16:56→17:00 is four open minutes');
  assert.equal(clinicalOpenMinutes(at(17 * 60 + 3), 4), 1, '16:59→17:03 retains one open minute');
  assert.equal(clinicalOpenMinutes(at(17 * 60 + 3, 9), 4), 1, 'absolute day9 uses the same clinic hours');
  assert.equal(clinicalOpenMinutes(at(17 * 60 + 4), 4), 0, '17:00→17:04 contributes no after-hours time');
});

test('medical admission also clips opening and zero or negative phase budgets', () => {
  assert.equal(clinicalOpenMinutes(at(8 * 60), 4), 0);
  assert.ok(Math.abs(clinicalOpenMinutes(at(8 * 60 + 3), 4) - 3) <= 1e-7, 'hour/absolute-clock conversion keeps three actual open minutes within the existing clinical EPS');
  assert.equal(clinicalOpenMinutes(at(12 * 60), 4), 4);
  assert.equal(clinicalOpenMinutes(at(12 * 60), 0), 0);
  assert.equal(clinicalOpenMinutes(at(12 * 60), -4), 0);
  assert.equal(clinicalOpenMinutes(at(7 * 60), 4), 0);
  assert.equal(clinicalOpenMinutes(at(18 * 60), 4), 0);
});

test('the same interval cannot admit time before the actual approval or receipt lower bound', () => {
  const state = at(17 * 60 + 3, 9), dayStart = 9 * 1440;
  assert.equal(clinicalOpenMinutes(state, 4, dayStart + 16 * 60 + 59.5), .5);
  assert.equal(clinicalOpenMinutes(state, 4, dayStart + 17 * 60), 0);
  assert.equal(clinicalOpenMinutes(state, 4, dayStart + 17 * 60 + 1), 0);
});

test('interval queries preserve their clock-only input and do not create medical state', () => {
  const state = at(17 * 60 + 3, 9), before = JSON.stringify(state);
  Object.freeze(state.extension); Object.freeze(state);
  for (let query = 0; query < 5; query++) assert.equal(clinicalOpenMinutes(state, 4), 1);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.clinical, undefined);
});
