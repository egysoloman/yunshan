// Canonical studio placements for the default world (C# parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld, terrainHeight } from '../../src/world';
import { studioBuildingPlacements, studioDeckTilePlacements, studioLandmarkPlacements, studioNetworkDetailPlacements, studioRoadTilePlacements, studioStationPlacements } from '../../src/rendering/studio-prop-layout';
import { deckWidth } from '../../src/transport-geometry';
import { canonical } from './world';

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
