// Far lantern glow positions on the current-v8 world (C# LanternGlow parity test).
//   npx tsx scripts/parity/lantern-glow.ts [out]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { lanternGlows } from '../../src/rendering/lantern-glow';

const glows = lanternGlows(createWorld(20261001, 'current-v8'));
const json = JSON.stringify(glows.map(g => [g.x, g.y, g.z, g.kind]));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/lantern-glow-v8.json.gz', gzipSync(json, { level: 9 }));
console.log(`${glows.length} glows, ${json.length} bytes`);
