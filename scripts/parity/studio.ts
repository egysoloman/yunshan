// Canonical studio placements for the default world (C# parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { studioBuildingPlacements, studioLandmarkPlacements, studioStationPlacements } from '../../src/rendering/studio-prop-layout';
import { canonical } from './world';

const world = createWorld();
const json = JSON.stringify(canonical({
  buildings: world.buildings.map(b => ({ id: b.id, placements: studioBuildingPlacements(b) })),
  stations: studioStationPlacements(world),
  landmarks: studioLandmarkPlacements(world),
}));
writeFileSync(process.argv[2], gzipSync(json, { level: 9 }));
console.log(`${json.length} bytes`);
