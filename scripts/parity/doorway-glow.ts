// Doorway glow panels for every market of the current-v8 product world, and levels, for the C# Core/DoorwayGlow.cs parity test.
import { writeFileSync } from 'node:fs';
import { createProductWorld } from '../../src/product-city';
import { doorwayGlowLevel, doorwayGlowPanel } from '../../src/rendering/doorway-glow';
const world = createProductWorld();
const panels = world.buildings.map(b => ({ id: b.id, panel: doorwayGlowPanel(b) }));
const levels = [false, true].flatMap(open => [0, .1, .2, .3, .45, .55, .6, 1].map(daylight => ({ open, daylight, level: doorwayGlowLevel(open, daylight) })));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/doorway-glow.json', JSON.stringify({ panels, levels }));
console.log(`${panels.filter(p => p.panel).length} panels of ${panels.length} buildings`);
