import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstDayNext, firstDayTarget } from '../src/first-day';
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

test('the meet step names a resident out on foot nearby instead of planning a cross-city trip', async () => {
  const { nearbyStranger, nearbyStrangerNotice, MEET_NEARBY_METRES } = await import('../src/first-day');
  const person = (id: string, x: number, state: string, alive = true) => ({ id, name: id, role: '学生', state, position: { x, y: 0, z: 0 }, alive });
  const city = (people: ReturnType<typeof person>[]) => ({ citizens: people, extension: { actorProfiles: Object.fromEntries(people.map(p => [p.id, { alive: p.alive }])) } }) as unknown as SimState;
  const at = { x: 0, y: 0, z: 0 };
  assert.deepEqual(nearbyStranger(city([person('far', 300, 'moving'), person('near', 40, 'moving'), person('nearer', 20, 'atHome')]), at), { name: 'near', role: '学生', metres: 40 }, 'the nearest one out on foot; indoors does not count');
  assert.equal(nearbyStranger(city([person('dead', 5, 'moving', false), person('far', MEET_NEARBY_METRES + 1, 'socializing')]), at), null);
  assert.equal(nearbyStrangerNotice({ name: '云溪', role: '学生', metres: 3.4 }), '附近约 3 米处就有居民云溪（学生）。走到身旁，在左侧面板的“居民”页点“聊聊近况”。');
});

test('after the first day the note names what to do next, from the player\'s own home', () => {
  assert.match(firstDayNext({ player: { homeId: null } } as never), /到住宅租一处落脚的住所/);
  assert.match(firstDayNext({ player: { homeId: 'river-b3' } } as never), /回住处床旁歇一歇/);
});

test('from the second day an unfinished welcome note keeps only its first-day list', async () => {
  const { welcomeCompact } = await import('../src/first-day');
  assert.equal(welcomeCompact(0), false);
  assert.equal(welcomeCompact(1), true);
  assert.equal(welcomeCompact(5), true);
});
