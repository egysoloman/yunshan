import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPEN_SHOP_LIGHT, WINDOW_LIGHT_FLOOR, windowLightLevels } from '../src/rendering/window-occupancy';
import type { SimState, WorldDefinition } from '../src/types';

test('windows light by who is really there: awake residents at home, an open shop, people at work', () => {
  const world = { buildings: [{ id: 'h', kind: 'home', capacity: 8 }, { id: 'm', kind: 'market', capacity: 40 }, { id: 'w', kind: 'workshop', capacity: 16 }, { id: 'e', kind: 'home', capacity: 8 }] } as unknown as WorldDefinition;
  const c = (id: string, homeId: string, state: string, destinationId: string | null = null) => ({ id, homeId, state, destinationId });
  const state = { citizens: [c('a', 'h', 'atHome'), c('b', 'h', 'sleeping'), c('d', 'h', 'atHome'), c('f', 'h', 'moving'), c('g', 'e', 'working', 'w'), c('k', 'e', 'working', 'w')], shops: [{ buildingId: 'm', open: true }], extension: { actorProfiles: {} } } as unknown as SimState;
  const [home, market, workshop, empty] = windowLightLevels(state, world);
  assert.equal(home, .5, 'two of four residents at home and awake');
  assert.equal(market, Math.fround(OPEN_SHOP_LIGHT));
  assert.equal(workshop, .5, 'two people working in a building that seats sixteen');
  assert.equal(empty, Math.fround(WINDOW_LIGHT_FLOOR), 'everyone out: only the floor');
  state.shops[0].open = false; state.citizens[0].state = 'sleeping'; state.citizens[2].state = 'sleeping';
  const [night, closed] = windowLightLevels(state, world);
  assert.equal(night, Math.fround(WINDOW_LIGHT_FLOOR)); assert.equal(closed, Math.fround(WINDOW_LIGHT_FLOOR));
});
