// Studio understorey, bank plants and mountain-foot rocks (C# GroundDressing parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { groundDressing, woodlandLayout } from '../../src/rendering/woodland-layout';
import { canonical } from './world';

const world = createWorld(), items = groundDressing(world, woodlandLayout(world).trees);
const json = JSON.stringify(canonical({ items }));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/ground-dressing-v6.json.gz', gzipSync(json, { level: 9 }));
console.log(`${items.length} items, ${json.length} bytes`);
