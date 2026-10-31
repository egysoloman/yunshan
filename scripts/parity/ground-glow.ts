// Ground light pools on the current-v8 world (C# GroundGlow parity test).
//   npx tsx scripts/parity/ground-glow.ts [out]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { groundPools } from '../../src/rendering/ground-glow';

const pools = groundPools(createWorld(20261001, 'current-v8'));
const json = JSON.stringify(pools.map(p => [p.x, p.y, p.z, p.radius, p.along]));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/ground-glow-v8.json.gz', gzipSync(json, { level: 9 }));
console.log(`${pools.length} pools, ${json.length} bytes`);
