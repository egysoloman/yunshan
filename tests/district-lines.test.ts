import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProductWorld } from '../src/product-city';
import { DISTRICT_LINES, districtLine } from '../src/district-lines';

test('every district of the product city has its own day and night line', () => {
  const world = createProductWorld(), day = new Set<string>(), night = new Set<string>();
  for (const d of world.districts) {
    assert.ok(DISTRICT_LINES[d.id], d.id);
    day.add(districtLine(d.id, 11)); night.add(districtLine(d.id, 22));
  }
  assert.equal(day.size, world.districts.length, 'no two districts share a day line');
  assert.equal(night.size, world.districts.length, 'nor a night line');
  // The reference town's own lines, as written.
  assert.equal(districtLine('academy', 11), '书山为径，文脉连云，学海无涯。');
  assert.equal(districtLine('west', 11), '崖岫之间，街巷与轨道连接一城生息。');
  assert.equal(districtLine('east', 11), '沿山而筑，百工有序，车流不息。');
});

test('night runs from 19:00 to 05:00; an unknown district keeps the generic lines', () => {
  assert.equal(districtLine('market', 18.9), DISTRICT_LINES.market[0]);
  assert.equal(districtLine('market', 19), DISTRICT_LINES.market[1]);
  assert.equal(districtLine('market', 4.9), DISTRICT_LINES.market[1]);
  assert.equal(districtLine('nowhere', 8), '晨雾渐散，街巷间的一天正在开始。');
  assert.equal(districtLine('nowhere', 12), '重峦之间，街巷与轨道连接一城生息。');
  assert.equal(districtLine('nowhere', 17), '斜阳染檐，山城在暮色中舒展。');
  assert.equal(districtLine('nowhere', 23), '夜色入山，万家灯火沿谷而生。');
});
