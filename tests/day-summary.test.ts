import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCurrentProductCity, createProductWorld } from '../src/product-city';
import { freshDaySummary } from '../src/day-summary';
import type { Relationship } from '../src/types';

test('a new day says what the player\'s own yesterday came to, once', () => {
  const sim = createCurrentProductCity(createProductWorld()), state = sim.state;
  let r = freshDaySummary(state, null);
  assert.equal(r.notice, null, 'the first reading is a baseline');
  state.player.money += 52.4;
  assert.equal(freshDaySummary(state, r.seen).notice, null, 'nothing until the day turns');
  state.relationships.push({ citizenId: 'citizen-1', encounters: 1 } as unknown as Relationship);
  const job = { status: 'completed', endedAt: 0 * 1440 + 900, workedMinutes: 60 };
  (state as unknown as { playerLabor: { history: unknown[] } }).playerLabor = { ...(state.playerLabor ?? {}), history: [...(state.playerLabor?.history ?? []), job, { status: 'cancelled', endedAt: 950, workedMinutes: 0 }] } as never;
  const before = Math.round(r.seen.money);
  state.day = 1;
  r = freshDaySummary(state, r.seen);
  assert.equal(r.notice, `第 2 日开始了。昨天：现金 ${before} → ${Math.round(state.player.money)} 云币，完成 1 次工班，结识 1 位居民。`);
  assert.equal(freshDaySummary(state, r.seen).notice, null, 'said once');
  state.day = 4;
  assert.match(freshDaySummary(state, r.seen).notice ?? '', /^第 5 日开始了。过去 3 天：现金 \d+ → \d+ 云币。$/);
  assert.equal(freshDaySummary(state, null).notice, null, 'a loaded save is not news');
});
