import assert from 'node:assert/strict';
import test from 'node:test';
import { lanternGlows } from '../src/rendering/lantern-glow';
import { cachedWorld } from '../src/persistence/world-cache';

test('lantern glows are deterministic and sit at doors, eaves and along roads', () => {
  const world = cachedWorld(20261001, 'current-v6');
  const glows = lanternGlows(world);
  assert.deepEqual(lanternGlows(world), glows);
  const count = (kind: string) => glows.filter(g => g.kind === kind).length;
  assert.equal(count('door'), world.buildings.length * 2);
  assert.ok(count('eave') > 0 && count('street') > 100, `${count('eave')} eave / ${count('street')} street`);
  for (const g of glows) assert.ok(Number.isFinite(g.x + g.y + g.z));
  for (const g of glows.filter(g => g.kind === 'door')) assert.ok(world.buildings.some(b => Math.hypot(g.x - b.door.x, g.z - b.door.z) < 2), 'a door lantern stays beside a door');
});
