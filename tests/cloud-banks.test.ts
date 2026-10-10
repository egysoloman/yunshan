import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudBanks } from '../src/rendering/cloud-banks';
import { cachedWorld } from '../src/persistence/world-cache';

test('cloud banks are deterministic and the sea never covers a district', () => {
  const world = cachedWorld(20261001, 'current-v6');
  const first = cloudBanks(world), second = cloudBanks(world);
  assert.deepEqual(second, first);
  const sea = first.filter(p => p.layer === 'sea'), valley = first.filter(p => p.layer === 'valley');
  assert.ok(sea.length > 20 && valley.length > 0, `${sea.length} sea / ${valley.length} valley puffs`);
  for (const p of sea) for (const d of world.districts) assert.ok(Math.hypot(p.x - d.center.x, p.z - d.center.z) >= d.radius * 1.18 - 1e-6, `sea puff inside ${d.id}`);
  for (const p of first) assert.ok(Number.isFinite(p.x + p.y + p.z + p.size) && p.size > 0);
});
