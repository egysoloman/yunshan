// District banners on the product world (C# Core/DistrictBanners.cs parity test).
//   npx tsx scripts/parity/district-banners.ts [out]
import { writeFileSync } from 'node:fs';
import { createProductWorld } from '../../src/product-city';
import { districtBanners } from '../../src/rendering/district-banners';
const world = createProductWorld(), banners = districtBanners(world);
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/district-banners.json', JSON.stringify({ districts: world.districts.map(d => ({ id: d.id, name: d.name, center: d.center })),
  buildings: world.buildings.map(b => ({ id: b.id, districtId: b.districtId, kind: b.kind, position: b.position, width: b.width, depth: b.depth, height: b.height, rotation: b.rotation })), banners }));
console.log(`${banners.length} banners over ${world.districts.length} districts`);
