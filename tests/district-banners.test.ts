import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createProductWorld } from '../src/product-city';
import { BANNER, BANNER_SKIP, districtBanners } from '../src/rendering/district-banners';
import { DISTRICT_TAG, districtTagShown, districtTags } from '../src/rendering/district-tags';

test('each district hangs its name on up to six facades near its centre, above head height and clear of eaved kinds', () => {
  const world = createProductWorld(), banners = districtBanners(world), byId = new Map(world.buildings.map(b => [b.id, b]));
  assert.equal(banners.length, 66);
  for (const district of world.districts) {
    const own = banners.filter(b => b.districtId === district.id);
    assert.equal(own.length, BANNER.perDistrict, district.id);
    assert.equal(new Set(own.map(b => b.buildingId)).size, own.length, 'one banner per building');
  }
  for (const banner of banners) {
    const b = byId.get(banner.buildingId)!, district = world.districts.find(d => d.id === banner.districtId)!;
    assert.equal(b.districtId, banner.districtId); assert.equal(banner.text, district.name);
    assert.ok(!BANNER_SKIP.includes(b.kind), `${b.id} is ${b.kind}`);
    assert.ok(banner.position.y - BANNER.height / 2 >= b.position.y + .6 + BANNER.bottom - 1e-9, 'lower edge above head height');
    assert.ok(banner.position.y + BANNER.height / 2 <= b.position.y + b.height, 'top edge below the roofline');
    // In the building's frame the banner stands BANNER.out in front of the entrance facade, inside its width.
    const dx = banner.position.x - b.position.x, dz = banner.position.z - b.position.z, c = Math.cos(b.rotation), s = Math.sin(b.rotation);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    assert.ok(Math.abs(lz - (b.depth / 2 + BANNER.out)) < 1e-9, `${b.id} front`);
    assert.ok(Math.abs(lx) + BANNER.width / 2 <= b.width / 2 - BANNER.inset + 1e-9, `${b.id} within facade`);
    assert.equal(banner.yaw, b.rotation);
  }
});

test('the C# parity fixture is current', () => {
  const fixture = JSON.parse(readFileSync('dotnet/Yunshan.Core.Tests/Parity/district-banners.json', 'utf8'));
  assert.deepEqual(districtBanners(fixture), fixture.banners);
  assert.deepEqual(districtTags(fixture), fixture.tags);
});

test('flying, each district name hangs above its tallest roof; on foot or close by it is hidden', () => {
  const world = createProductWorld(), tags = districtTags(world);
  assert.equal(tags.length, world.districts.length);
  for (const tag of tags) {
    const district = world.districts.find(d => d.id === tag.districtId)!, roofs = world.buildings.filter(b => b.districtId === district.id).map(b => b.position.y + .6 + b.height);
    assert.equal(tag.text, district.name); assert.equal(tag.position.x, district.center.x); assert.equal(tag.position.z, district.center.z);
    assert.equal(tag.position.y, Math.max(district.center.y, ...roofs) + DISTRICT_TAG.lift);
  }
  const tag = tags[0], above = { ...tag.position, y: tag.position.y + 1000 };
  assert.equal(districtTagShown(true, tag, above), true);
  assert.equal(districtTagShown(false, tag, above), false, 'never on foot');
  assert.equal(districtTagShown(true, tag, { ...tag.position, z: tag.position.z + DISTRICT_TAG.near - 1 }), false, 'hidden close by');
});
