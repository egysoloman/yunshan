// Studio understorey, bank plants and mountain-foot rocks (C# GroundDressing parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { faunaDressing, groundDressing, woodlandLayout } from '../../src/rendering/woodland-layout';
import { canonical } from './world';

const world = createWorld(), trees = woodlandLayout(world).trees, items = groundDressing(world, trees), fauna = faunaDressing(world, trees, items);
const json = JSON.stringify(canonical({ items, fauna }));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/ground-dressing-v6.json.gz', gzipSync(json, { level: 9 }));
console.log(`${items.length} items, ${json.length} bytes`);
