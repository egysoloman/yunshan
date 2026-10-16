import assert from 'node:assert/strict';
import { test } from 'node:test';
import { terraceMasonry } from '../src/rendering/terrace-masonry';
import type { WorldDefinition } from '../src/types';

test('terrace edges in a district read as masoned walls; low steps, the wilds and alpine faces stay rock', () => {
  const world = { districts: [{ center: { x: 0, y: 0, z: 0 }, radius: 100 }] } as unknown as WorldDefinition;
  const masoned = terraceMasonry(world);
  assert.equal(masoned(10, 10, 200, 1.5), true, 'a 1.5 m terrace edge in town');
  assert.equal(masoned(10, 10, 200, 1), false, 'a 1 m step is ground, not a wall');
  assert.equal(masoned(97, 0, 200, 3), false, 'beyond 95% of the district radius');
  assert.equal(masoned(10, 10, 480, 3), false, 'above the alpine line');
});
