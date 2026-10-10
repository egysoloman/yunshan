// Canonical woodland layout for the default world (C# WoodlandLayout parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { woodlandLayout } from '../../src/rendering/woodland-layout';
import { canonical } from './world';

const layout = woodlandLayout(createWorld());
const json = JSON.stringify(canonical(layout));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/woodland-v6.json.gz', gzipSync(json, { level: 9 }));
console.log(`${layout.trees.length} trees, ${layout.shrubs.length} shrubs, ${layout.stands} stands, ${json.length} bytes`);
