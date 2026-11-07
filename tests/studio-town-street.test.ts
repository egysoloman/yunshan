import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { terrainHeight } from '../src/world';
import { cachedWorld } from '../src/persistence/world-cache';
import { deckWidth } from '../src/transport-geometry';
import { insidePavedDeck, pavedDecks } from '../src/rendering/network-structures';
import { lanternGlows } from '../src/rendering/lantern-glow';
import { STUDIO_ASSETS, studioTownStreetPlacements, townLampLight, TOWN_COURT, TOWN_DOOR_GOODS, TOWN_STREET_LAMP } from '../src/rendering/studio-prop-layout';
import { woodlandLayout } from '../src/rendering/woodland-layout';

const v9 = cachedWorld(20261001, 'current-v9'), ground = (x: number, z: number) => terrainHeight(v9, x, z);
const placements = studioTownStreetPlacements(v9, deckWidth, ground), assets = new Map(STUDIO_ASSETS.map(a => [a.id, a]));
/** The four footprint corners and ground height of a placement (its model's min-corner box turned by yaw). */
function corners(p: (typeof placements)[number]) {
  const { min, max } = assets.get(p.asset)!.boundsM, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [[min[0], min[2]], [max[0], min[2]], [max[0], max[2]], [min[0], max[2]]].map(([x, z]) => ({ x: p.position.x + x * c + z * s, y: p.position.y + min[1], z: p.position.z - x * s + z * c }));
}

test('town street dressing exists only in the dense market town', () => {
  const count = (id: string) => placements.filter(p => p.asset === id).length;
  assert.ok(count(TOWN_STREET_LAMP.asset) > 200, `${count(TOWN_STREET_LAMP.asset)} lamps`);
  const shops = v9.buildings.filter(b => b.kind === 'market' && b.districtId === 'market').length;
  assert.ok(count(TOWN_DOOR_GOODS.base) > shops / 2 && count(TOWN_DOOR_GOODS.top) === count(TOWN_DOOR_GOODS.base), `${count(TOWN_DOOR_GOODS.base)} of ${shops} shop fronts`);
  assert.deepEqual(studioTownStreetPlacements(v9, deckWidth, ground), placements, 'a pure function of the world');
  for (const layout of ['current-v8', 'current-v6'] as const) {
    const world = cachedWorld(20261001, layout);
    assert.equal(studioTownStreetPlacements(world, deckWidth, (x, z) => terrainHeight(world, x, z)).length, 0, `${layout} keeps its streets`);
  }
});

test('every piece stands on the ground clear of buildings, doors, other paved decks and other lamps', () => {
  const decks = pavedDecks(v9), lamps = placements.filter(p => p.asset === TOWN_STREET_LAMP.asset);
  for (const p of placements) {
    assert.ok(Number.isFinite(p.position.x + p.position.y + p.position.z + p.yaw), p.id);
    const top = p.id.endsWith(':top'), feet = corners(p);
    for (const q of feet) {
      // Lamps and crates stand on the ground at their centre; court furniture on the highest point of its footprint.
      const cx = (feet[0].x + feet[2].x) / 2, cz = (feet[0].z + feet[2].z) / 2, base = p.id.includes(':town-court:') ? Math.max(ground(cx, cz), ...feet.map(f => ground(f.x, f.z))) : ground(cx, cz);
      if (!top) assert.ok(Math.abs(q.y - base) < 1e-9, `${p.id} stands on the ground`);
      for (const b of v9.buildings) {
        const dx = q.x - b.position.x, dz = q.z - b.position.z, c = Math.cos(b.rotation), s = Math.sin(b.rotation);
        assert.ok(!(Math.abs(dx * c - dz * s) < b.width / 2 + .2 && Math.abs(dx * s + dz * c) < b.depth / 2 + .2), `${p.id} inside ${b.id}`);
        assert.ok(Math.hypot(q.x - b.door.x, q.z - b.door.z) >= 2.5, `${p.id} blocks the door of ${b.id}`);
      }
      // Lamps are checked against every deck but their own street's; goods against every deck.
      const own = p.asset === TOWN_STREET_LAMP.asset ? p.id.slice(0, p.id.indexOf(':town-lamp:')) : '';
      assert.ok(!insidePavedDeck({ x: q.x, y: feet[0].y, z: q.z }, decks, own), `${p.id} stands on a paved street`);
    }
  }
  const centre = (p: (typeof placements)[number]) => { const f = corners(p); return { x: (f[0].x + f[2].x) / 2, z: (f[0].z + f[2].z) / 2 }; };
  for (let i = 0; i < lamps.length; i++) for (let j = i + 1; j < lamps.length; j++) {
    const a = centre(lamps[i]), b = centre(lamps[j]);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= TOWN_STREET_LAMP.apart - 1e-9, `${lamps[i].id} / ${lamps[j].id}`);
  }
  // A goods box stands centred on its crate.
  for (const top of placements.filter(p => p.id.endsWith(':door-goods:top'))) {
    const base = placements.find(p => p.id === top.id.replace(':top', ':base'))!, b = assets.get(TOWN_DOOR_GOODS.base)!.boundsM;
    assert.ok(Math.abs(corners(top)[0].y - (base.position.y + b.max[1])) < 1e-9);
  }
});

test('court furniture fills the town paving on level ground, away from every tree and shrub of the woodland', () => {
  const courts = placements.filter(p => p.id.includes(':town-court:'));
  assert.ok(courts.length > 60, `${courts.length} court pieces`);
  assert.deepEqual([...new Set(courts.map(p => p.asset))].sort(), [...TOWN_COURT.assets].sort());
  const { trees, shrubs } = woodlandLayout(v9), plants = [...trees, ...shrubs];
  for (const p of courts) {
    const f = corners(p), cx = (f[0].x + f[2].x) / 2, cz = (f[0].z + f[2].z) / 2, heights = [ground(cx, cz), ...f.map(q => ground(q.x, q.z))];
    assert.ok(Math.max(...heights) - Math.min(...heights) <= TOWN_COURT.step + 1e-9, `${p.id}: at most one paving step under it`);
    assert.ok(plants.every(t => Math.hypot(t.x - cx, t.z - cz) >= 2), `${p.id} stands clear of the woodland`);
  }
});

test('the lamp light is the centre of the model\'s lamp glass and glows at night', () => {
  // The GLB's JSON chunk: the primitive drawn with the lamp-glass material.
  const asset = assets.get(TOWN_STREET_LAMP.asset)!, data = readFileSync(`public/${asset.url}`), length = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + length).toString('utf8')), glass = gltf.materials.findIndex((m: { name: string }) => m.name === '景观灯罩玻璃');
  const primitive = gltf.meshes.flatMap((m: { primitives: { material: number; attributes: { POSITION: number } }[] }) => m.primitives).find((p: { material: number }) => p.material === glass);
  const { min, max } = gltf.accessors[primitive.attributes.POSITION];
  TOWN_STREET_LAMP.light.forEach((v, i) => assert.ok(Math.abs(v - (min[i] + max[i]) / 2) < 1e-6, `axis ${i}`));
  const glows = lanternGlows(v9), lamps = placements.filter(p => p.asset === TOWN_STREET_LAMP.asset);
  for (const lamp of lamps) { const l = townLampLight(lamp); assert.ok(glows.some(g => g.kind === 'string' && g.x === l.x && g.y === l.y && g.z === l.z), lamp.id); }
});
