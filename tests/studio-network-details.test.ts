import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld, terrainHeight } from '../src/world';
import { deckWidth } from '../src/transport-geometry';
import { emitNetworkStructures, type NetworkSink } from '../src/rendering/network-structures';
import { RAIL_PIER_CAP_ASSET, RUNWAY_LIGHT_ASSET, STUDIO_ASSETS, studioNetworkDetailPlacements, studioRoadTilePlacements } from '../src/rendering/studio-prop-layout';

test('studio pier caps sit exactly on the rail cap boxes they replace, and only those are skipped', () => {
  const world = createWorld(), boxes: number[][] = [];
  const recorder = (into: number[][]): NetworkSink => ({ box: (_k, x, y, z, sx, sy, sz) => { into.push([x, y, z, sx, sy, sz]); }, segment: () => {} });
  emitNetworkStructures(world, recorder(boxes), { dressesStations: true, dressesRunway: true });
  const dressed: number[][] = [];
  emitNetworkStructures(world, recorder(dressed), { dressesStations: true, dressesRunway: true, dressesRailPierCaps: true });
  const caps = studioNetworkDetailPlacements(world, deckWidth, (x, z) => terrainHeight(world, x, z)).filter(p => p.asset === RAIL_PIER_CAP_ASSET);
  const asset = STUDIO_ASSETS.find(a => a.id === RAIL_PIER_CAP_ASSET)!, { min, max } = asset.boundsM;
  assert.equal(caps.length, 119);
  assert.equal(boxes.length - dressed.length, caps.length);
  for (const cap of caps) {
    const centre = [cap.position.x + (min[0] + max[0]) / 2, cap.position.y + (min[1] + max[1]) / 2, cap.position.z + (min[2] + max[2]) / 2];
    assert.ok(boxes.some(b => Math.abs(b[0] - centre[0]) < 1e-9 && Math.abs(b[1] - centre[1]) < 1e-9 && Math.abs(b[2] - centre[2]) < 1e-9 && b[3] === max[0] - min[0] && b[4] === max[1] - min[1] && b[5] === max[2] - min[2]), cap.id);
  }
});

test('runway lights and near road and rail modules use original sizes along the authoritative network', () => {
  const world = createWorld(), details = studioNetworkDetailPlacements(world, deckWidth, (x, z) => terrainHeight(world, x, z));
  assert.equal(details.filter(p => p.asset === RUNWAY_LIGHT_ASSET).length, 2);
  const tiles = studioRoadTilePlacements(world, deckWidth), count = (id: string) => tiles.filter(t => t.asset === id).length;
  assert.equal(count('BUILT-131'), 85509); assert.equal(count('BUILT-132'), 85509); assert.equal(count('BUILT-134'), 85509);
  assert.ok(count('BUILT-142') > 4000);
  for (const t of tiles) assert.ok(Number.isFinite(t.position.x + t.position.y + t.position.z + t.yaw + (t.pitch ?? 0)), t.id);
});
