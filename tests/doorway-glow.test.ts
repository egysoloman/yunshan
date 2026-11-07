import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProductWorld } from '../src/product-city';
import { doorwayGlowLevel, doorwayGlowPanel } from '../src/rendering/doorway-glow';

test('an open market glows through its real entrance after dusk only', () => {
  assert.equal(doorwayGlowLevel(true, .8), 0, 'daytime');
  assert.equal(doorwayGlowLevel(false, 0), 0, 'closed');
  assert.equal(doorwayGlowLevel(true, .2), 1);
  assert.ok(doorwayGlowLevel(true, .4) > 0 && doorwayGlowLevel(true, .4) < 1);
  const world = createProductWorld(), markets = world.buildings.filter(b => b.kind === 'market');
  assert.equal(world.buildings.filter(b => b.kind !== 'market').some(b => doorwayGlowPanel(b)), false);
  let near = 0;
  for (const market of markets) {
    const panel = doorwayGlowPanel(market); if (!panel) continue;
    assert.ok(panel.width > 1 && panel.height > 1.5, market.id);
    // The panel sits within the entrance, a few metres from the authoritative door point, facing it.
    const toDoor = Math.atan2(market.door.x - panel.x, market.door.z - panel.z), turn = Math.abs(Math.atan2(Math.sin(toDoor - panel.yaw), Math.cos(toDoor - panel.yaw)));
    if (Math.hypot(market.door.x - panel.x, market.door.z - panel.z) < 4 && turn < Math.PI / 3) near++;
  }
  assert.ok(near / markets.length > .8, `${near} of ${markets.length} panels face their door`);
});
