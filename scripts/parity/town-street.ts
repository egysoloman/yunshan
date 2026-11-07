// current-v9 town street dressing and every lantern glow of that world (C# TownStreetParityTests).
//   npx tsx scripts/parity/town-street.ts [out]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld, terrainHeight } from '../../src/world';
import { deckWidth } from '../../src/transport-geometry';
import { studioTownStreetPlacements } from '../../src/rendering/studio-prop-layout';
import { lanternGlows } from '../../src/rendering/lantern-glow';

const world = createWorld(20261001, 'current-v9');
const placements = studioTownStreetPlacements(world, deckWidth, (x, z) => terrainHeight(world, x, z)), glows = lanternGlows(world);
const json = JSON.stringify({ placements: placements.map(p => [p.asset, p.id, p.position.x, p.position.y, p.position.z, p.yaw]), glows: glows.map(g => [g.x, g.y, g.z, g.kind]) });
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/town-street-v9.json.gz', gzipSync(json, { level: 9 }));
console.log(`${placements.length} placements, ${glows.length} glows, ${json.length} bytes`);
