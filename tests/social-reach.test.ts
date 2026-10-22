import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEET_RADIUS, nearbyResident, TALK_RADIUS, eGreetsResident } from '../src/social-reach';
import type { SimState } from '../src/types';

test('a met resident stays the conversation target within talking reach; a new one must come within meeting range', () => {
  const at = (id: string, x: number, extra: Record<string, unknown> = {}) => ({ id, tier: 'active', state: 'moving', position: { x, y: 0, z: 0 }, ...extra });
  const state = { citizens: [at('a', MEET_RADIUS + 2), at('b', 20), at('c', 3, { tier: 'statistical' })], extension: { actorProfiles: {} } } as unknown as SimState, origin = { x: 0, y: 0, z: 0 };
  assert.equal(nearbyResident(state, origin), null, 'nobody within meeting range');
  assert.equal(nearbyResident(state, origin, 'b')?.id, 'b', 'a met resident walking away stays the target');
  (state.citizens[1].position as { x: number }).x = TALK_RADIUS + 1;
  assert.equal(nearbyResident(state, origin, 'b'), null, 'beyond talking reach the resident is no longer the target');
  (state.citizens[0].position as { x: number }).x = 4;
  assert.equal(nearbyResident(state, origin, 'b')?.id, 'a');
  (state.extension!.actorProfiles as Record<string, unknown>).a = { alive: false };
  assert.equal(nearbyResident(state, origin, 'a'), null, 'never a resident who has died');
});

test('E greets a resident within reach by the tab shown, and a door within reach comes first otherwise', () => {
  const at = (x: number) => ({ x, y: 0, z: 0 }), p = at(0);
  assert.equal(eGreetsResident(p, at(3), at(10), null), true, 'no door within reach');
  assert.equal(eGreetsResident(p, at(3), at(5), null), false, 'the door within reach is used first');
  assert.equal(eGreetsResident(p, at(3), at(5), 'citizen'), true, 'on the resident tab, before the door');
  assert.equal(eGreetsResident(p, at(3), null, 'building'), false, 'never on the place tab');
  assert.equal(eGreetsResident(p, at(6), null, 'citizen'), false, 'out of reach');
  assert.equal(eGreetsResident(p, null, null, 'citizen'), false);
});
