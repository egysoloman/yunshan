// Every network display box and segment for the default world (C#
// NetworkStructures parity test). Studio platforms, runway and decks are dressed.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { emitNetworkStructures } from '../../src/rendering/network-structures';

const world = createWorld(), calls: unknown[] = [];
emitNetworkStructures(world, {
  box: (key, x, y, z, sx, sy, sz, color, rotation, tag) => { calls.push(['b', key, x, y, z, sx, sy, sz, color ?? null, rotation ?? 0, tag?.roof ?? false]); },
  segment: (key, a, b, width, height, lift, color) => { calls.push(['s', key, a.x, a.y, a.z, b.x, b.y, b.z, width, height, lift ?? 0, color ?? null]); },
}, { dressesStations: true, dressesRunway: true, dressesRailDeck: true, dressesBridgeDeck: true, dressesRoadDeck: true, dressesRailKerb: true, dressesRailPierCaps: true });
const json = JSON.stringify(calls);
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/network-v6.json.gz', gzipSync(json, { level: 9 }));
console.log(`${calls.length} calls, ${json.length} bytes`);
