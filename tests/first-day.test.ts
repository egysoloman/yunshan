import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstDayTarget } from '../src/first-day';
import type { SimState, WorldDefinition } from '../src/types';

test('first-day steps lead to the nearest open market with food, the nearest open market, and the busiest public venue', () => {
  const b = (id: string, kind: string, x: number) => ({ id, kind, door: { x, y: 0, z: 0 } });
  const world = { buildings: [b('m-near', 'market', 10), b('m-far', 'market', 50), b('w', 'workshop', 5), b('p', 'pavilion', 300), b('q', 'pavilion', 3000)] } as unknown as WorldDefinition;
  const shop = (buildingId: string, open: boolean, inventory: number) => ({ buildingId, open, inventory });
  const person = (x: number) => ({ id: `c${x}`, state: 'moving', position: { x, y: 0, z: 0 } });
  const state = { shops: [shop('m-near', true, 0), shop('m-far', true, 4), shop('w', true, 9)], citizens: [...Array.from({ length: 6 }, (_, i) => person(299 + i * 2)), ...Array.from({ length: 9 }, (_, i) => person(2999 + i))], extension: { actorProfiles: {} } } as unknown as SimState;
  const at = { x: 0, y: 0, z: 0 };
  assert.equal(firstDayTarget(state, world, at, 'eat'), 'm-far', 'the nearest market is sold out');
  assert.equal(firstDayTarget(state, world, at, 'work'), 'm-near');
  assert.equal(firstDayTarget(state, world, at, 'meet'), 'p', 'the nearer crowd, not the bigger far one');
  for (const s of state.shops) s.open = false;
  assert.equal(firstDayTarget(state, world, at, 'eat'), null);
  state.citizens.length = 0;
  assert.equal(firstDayTarget(state, world, at, 'meet'), null);
});
