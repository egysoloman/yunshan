import assert from 'node:assert/strict';
import test from 'node:test';
import { observeFoodAccess, type FoodAccessState, type FoodAccessWorld } from '../src/simulation/food-access-observations';

test('JSON-only food inspection reports a saved night declaration without certifying live service', () => {
  const world: FoodAccessWorld = { districts: [{ id: 'other-city', name: 'Other city' }],
    buildings: [{ id: 'market', districtId: 'other-city', kind: 'market' }], nodes: [] };
  const state: FoodAccessState = { day: 0, hour: 23, tick: 10, weather: '晴', citizens: [],
    shops: [{ id: 'shop', buildingId: 'market', districtId: 'other-city', price: 10, inventory: 2, open: true }] };
  const legacy = observeFoodAccess(state, world, {});
  assert.equal(Object.hasOwn(legacy.foodSites[0], 'declaredNightRetail'), false);
  // Explicit synthetic metadata tests the observer, not the wage authority.
  state.nightRetail = { version: 1, nextId: 2, shopIds: ['shop'], jobs: [{ id: 'night-retail-1',
    shopId: 'shop', buildingId: 'market', operatorId: 'owner', startedAt: 1320, endsAt: 1440,
    status: 'active', servedMinutes: 4, lastServedAt: 1380, lastObservedAt: 1380, lastObservedTick: 10,
    pauseReason: '', endedAt: null, demandIds: ['buyer'], funding: { kind: 'existing-private-assignment',
      day: 0, assignmentKey: 'synthetic', ratePerMinute: .1, approvedMinutes: 480,
      workedMinutesAtStart: 0, attendanceMinutesAtStart: 0, fundsAtStart: 100, protectedFundsAtStart: 0 } }] };
  const before = JSON.stringify(state), observed = observeFoodAccess(state, world, {});
  assert.equal(observed.foodSites[0].open, true);
  assert.equal(observed.foodSites[0].scheduledOpenAtCurrentPhase, false, 'fixed day hours still close at22');
  assert.equal(observed.foodSites[0].declaredNightRetail?.recordedAtCurrentPhase, true);
  assert.equal(observed.foodSites[0].declaredNightRetail?.serviceCertification, 'NOT_LIVE_CERTIFIED');
  assert.equal(JSON.stringify(state), before);
  state.tick = 11;
  assert.equal(observeFoodAccess(state, world, {}).foodSites[0].declaredNightRetail?.recordedAtCurrentPhase, false);
  delete state.nightRetail;
  assert.deepEqual(observeFoodAccess(state, world, {}), legacy, 'absent module preserves the complete legacy observation shape');
});
