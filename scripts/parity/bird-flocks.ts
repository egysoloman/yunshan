// Bird flocks over the product world at seeded clock times (C# Core/BirdFlocks.cs parity test).
//   npx tsx scripts/parity/bird-flocks.ts [out]
import { writeFileSync } from 'node:fs';
import { createProductWorld } from '../../src/product-city';
import { birdFlocks, birdsAt } from '../../src/rendering/bird-flocks';
const world = createProductWorld(), flocks = birdFlocks(world), times = [0, 1.25, 17.5, 333.3, 4096.75, 86399.5];
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/bird-flocks.json', JSON.stringify({ flocks, frames: times.map(t => ({ t, birds: birdsAt(flocks, t) })) }));
console.log(`${flocks.length} flocks, ${times.length} frames`);
