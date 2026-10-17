// Creek bank stones, reeds and plunge-pool foam (C# RiverDressing parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { riverDressing } from '../../src/rendering/woodland-layout';
import { canonical } from './world';

const json = JSON.stringify(canonical(riverDressing(createWorld())));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/river-dressing-v6.json.gz', gzipSync(json, { level: 9 }));
console.log(`${json.length} bytes`);
