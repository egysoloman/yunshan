// Canonical studio placements for the default world (C# parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld, terrainHeight } from '../../src/world';
import { studioBuildingPlacements, studioDeckTilePlacements, studioLandmarkPlacements, studioNetworkDetailPlacements, studioRoadTilePlacements, studioStationPlacements } from '../../src/rendering/studio-prop-layout';
import { deckWidth } from '../../src/transport-geometry';
import { canonical } from './world';

// With a second argument (a layout such as current-v8) only that world's road tiles are written:
// the paved-street kerb modules (studio-roads-v8.json.gz).
if (process.argv[3]) {
  const v8 = createWorld(20261001, process.argv[3] as Parameters<typeof createWorld>[1]), tiles = studioRoadTilePlacements(v8, deckWidth);
  const out = JSON.stringify(canonical({ roads: { count: tiles.length, sample: tiles.filter((_, i) => i % 41 === 0) } }));
  writeFileSync(process.argv[2], gzipSync(out, { level: 9 })); console.log(`${tiles.length} road tiles, ${out.length} bytes`); process.exit(0);
}
const world = createWorld(), roads = studioRoadTilePlacements(world, deckWidth);
const json = JSON.stringify(canonical({
  buildings: world.buildings.map(b => ({ id: b.id, placements: studioBuildingPlacements(b) })),
  stations: studioStationPlacements(world),
  landmarks: studioLandmarkPlacements(world),
  decks: studioDeckTilePlacements(world, deckWidth),
  details: studioNetworkDetailPlacements(world, deckWidth, (x, z) => terrainHeight(world, x, z)),
  // ~85,000 road tiles: the count and every 41st tile.
  roads: { count: roads.length, sample: roads.filter((_, i) => i % 41 === 0) },
}));
writeFileSync(process.argv[2], gzipSync(json, { level: 9 }));
console.log(`${json.length} bytes`);
