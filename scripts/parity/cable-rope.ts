// current-v9 ropeway rope lines and the rope height above sampled cabin positions (C# CableRope parity test).
//   npx tsx scripts/parity/cable-rope.ts [out]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';
import { cableGripArm, cableRopeHeightAt, cableRopeLine } from '../../src/rendering/cable-rope';

const world = createWorld(20261001, 'current-v9'), cables = world.edges.filter(e => e.mode === 'cable');
const json = JSON.stringify(cables.map(edge => {
  // Cabin positions between the edge's points (a third of the way along every fifth segment).
  const samples = edge.points.slice(1).filter((_, i) => i % 5 === 0).map((b, k) => { const a = edge.points[k * 5]; return { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3, z: a.z + (b.z - a.z) / 3 }; });
  return { id: edge.id, line: cableRopeLine(world, edge.id)!.map(p => [p.x, p.y, p.z]), heights: samples.map(p => { const h = cableRopeHeightAt(world, edge.id, p)!, arm = cableGripArm({ y: 7.85, height: 1.5 }, p.y, h); return [p.x, p.y, p.z, h, arm.y, arm.height]; }) };
}));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/cable-rope-v9.json.gz', gzipSync(json, { level: 9 }));
console.log(`${cables.length} cables, ${json.length} bytes`);
