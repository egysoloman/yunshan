// Program-body facade details for the C# ArchitectureDetail parity test:
// every fifth program building plus the first of each kind, at near floors 0
// and 2 and the default instance cap.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { getBuildingBody } from '../../src/architecture-floor-plan';
import { buildArchitectureDetails } from '../../src/rendering/architecture-detail';
import { canonical } from './world';

const world = createWorld();
const program = world.buildings.filter(b => getBuildingBody(b)), kinds = new Set<string>();
const sample = program.filter((b, i) => { const first = !kinds.has(b.kind); kinds.add(b.kind); return first || i % 5 === 0; });
const rows = sample.flatMap(b => [0, 2].map(nearFloor => ({ id: b.id, nearFloor, parts: buildArchitectureDetails(b, nearFloor) })));
const json = JSON.stringify(canonical(rows));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/architecture-detail-v6.json.gz', gzipSync(json, { level: 9 }));
console.log(`${rows.length} rows, ${rows.reduce((n, r) => n + r.parts.length, 0)} parts, ${json.length} bytes`);
