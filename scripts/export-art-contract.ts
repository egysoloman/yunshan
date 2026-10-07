/**
 * Writes docs/art-contract/game-art-contract.json: the authoritative sizes,
 * pivots and conventions an external art pipeline (the voxel studio, or a
 * future native engine) must match for a model to replace game geometry 1:1.
 * Every number is read from the current game code, not restated by hand.
 *
 *   npx tsx scripts/export-art-contract.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createWorld } from '../src/world';
import { getBuildingBody } from '../src/architecture-floor-plan';
import { citizenBodyHeight, describeCitizen } from '../src/rendering/citizen-appearance';
import { STATION_PLATFORM, STATION_SHELTER, STUDIO_ASSETS, STUDIO_FIXTURE_DRESSING, STUDIO_MIN_FIT_SCALE, STUDIO_PROGRAM_DRESSING } from '../src/rendering/studio-prop-layout';
import manifest from '../src/rendering/studio-assets.json';
import { vehicleShape } from '../src/rendering/vehicle-shapes';
import type { Citizen } from '../src/types';

const world = createWorld();
const round = (v: number) => Math.round(v * 1e4) / 1e4;
const vec = (v: { x: number; y: number; z: number }) => [round(v.x), round(v.y), round(v.z)];

// Citizen parts per age band, standing and seated, near and far detail.
const ages = [1, 4, 9, 15, 30, 70];
const variants: Pick<Citizen, 'id' | 'role'>[] = [{ id: 'contract-a', role: '居民' }, { id: 'contract-robe', role: '居民' }, { id: 'contract-police', role: '警察' }];
const citizens = ages.map(age => ({
  age, bodyHeight: citizenBodyHeight(age),
  poses: Object.fromEntries((['standing', 'seated'] as const).map(pose => [pose, Object.fromEntries((['near', 'far'] as const).map(detail => {
    const seen = new Map<string, unknown>();
    for (const v of variants) for (const part of describeCitizen(v as Citizen, { age, alive: true }, { yaw: 0, phase: 0, walking: false, seated: pose === 'seated', dead: false }, detail).parts)
      if (!seen.has(part.name)) seen.set(part.name, { centre: vec(part.position), size: vec(part.size), ...(part.pivot ? { pivot: vec(part.pivot) } : {}), ...(part.face ? { faceTexture: true } : {}) });
    return [detail, Object.fromEntries(seen)];
  }))])),
}));

// Floor-plan fixture solids actually generated in the default world.
const fixtures = new Map<string, { kind: string; size: number[]; buildingKinds: Set<string>; count: number }>();
for (const building of world.buildings) for (const plan of getBuildingBody(building)?.floorPlans ?? []) for (const f of plan.fixtures) {
  const size = [round(f.rect.x1 - f.rect.x0), round(f.top - f.bottom), round(f.rect.z1 - f.rect.z0)], key = `${f.kind}:${size.join('x')}`;
  const entry = fixtures.get(key) ?? { kind: f.kind, size, buildingKinds: new Set(), count: 0 };
  entry.buildingKinds.add(building.kind); entry.count++; fixtures.set(key, entry);
}

const contract = {
  format: 'yunshan.game-art-contract', version: 1,
  generatedFrom: 'scripts/export-art-contract.ts reading src/ of the yunshan game',
  conventions: {
    units: 'metres', upAxis: 'Y', front: '+Z (toward the fixture use point / viewer)', origin: 'asset min corner unless stated',
    worldVoxelM: world.voxelSize, playerEyeHeightM: 1.72, bodyRadiusM: .35,
    scaling: `uniform only, ${STUDIO_MIN_FIT_SCALE}–1; never stretched; never enlarged`,
    display: 'models are display only; collision, walking, stock and use points come from game data',
  },
  floorFixtures: {
    rule: 'A replacement must fit inside the solid (x × y × z) at real size or within the uniform scale range. Use point lies on the +Z side.',
    solids: [...fixtures.values()].map(f => ({ kind: f.kind, sizeXYZ: f.size, buildingKinds: [...f.buildingKinds].sort(), countInDefaultWorld: f.count })),
    currentDressing: { byFixtureKind: STUDIO_FIXTURE_DRESSING, byBuildingKind: STUDIO_PROGRAM_DRESSING },
    knownGaps: ['bed solid is 0.6m high; a headboard above 0.6m does not fit (LIFE-035 is 1.0m)', 'no shelf solids are generated yet', 'tabletop items need a separate rule (not inside the solid)'],
  },
  stations: {
    count: world.nodes.filter(n => n.station).length,
    platform: { asset: STATION_PLATFORM.asset, minCornerFromNode: STATION_PLATFORM.min, sizeXYZ: [22, 1, 18] },
    shelter: { asset: STATION_SHELTER.asset, minCornerOnPlatform: STATION_SHELTER.onPlatform },
    liveSignalLamps: { note: 'driven by state.signals; any pole model must leave these exact lamp boxes visible and must not add its own lamp heads', redCentreFromNode: [12, 3.9, 11.4], greenCentreFromNode: [12, 3.15, 11.4], lampSizeXYZ: [.7, .55, .35], poleBoxes: [{ centre: [12, 1.8, 11], size: [.35, 3.6, .35] }, { centre: [12, 3.5, 11], size: [1, 1.6, .65] }] },
    junctions: { note: 'no traffic-signal logic exists at road junctions; a pole model must not show signal lamps', poleBox: { centre: [4, 2.2, 4], size: [.4, 4.4, .4] } },
  },
  entranceLantern: {
    note: 'program buildings hang one lantern beside the entrance opening; its whole envelope (bracket, caps, core) must fit this box, and nothing may hang lower into the pedestrian approach',
    envelopeAlongWallM: .8, envelopeHeightM: 1, projectionFromWallFaceM: .8,
    verticalRange: 'y − .6 … y + .4 where y = max(2.4, entrance height − .4) above the ground floor',
    luminousCoreM: [.4, .6, .6], glow: 'driven by city power and daylight',
    rejected: [{ id: 'BUILT-071', reason: '1.44m high; fits only at 0.69 scale or hangs to 1.36m, below eye height' }, { id: 'BUILT-249', reason: '1.2m high; needs 0.83 scale' }],
  },
  woodland: {
    trees: 5200, heightRangeM: [16, 31], heightQuantumM: world.voxelSize, trunkSectionM: .8, crownTiers: 4,
    note: 'woodland is display only; studio trees (8–14m) are shorter than game trees and are not used until a matching height family exists at 0.2m voxels',
  },
  vehicles: {
    note: 'network vehicles are display only: position, edge, direction and state come from the simulation; origin at the vehicle position on its edge, +Z along travel; boxes are centred at y above that position',
    shapes: Object.fromEntries((['road', 'maglev', 'lightRail', 'cable', 'ferry', 'flight'] as const).map(kind => [kind, vehicleShape(kind)])),
    rejected: [{ id: 'BUILT-170…175', reason: 'traffic proxy variants are the same three boxes (48 triangles); no visual gain' }, { id: 'BUILT-280/281/284/285', reason: 'complete vehicle masters are author-sized (e.g. carriage about 15×29m vs 3.3×16m) and cannot be fitted by uniform scale' }],
  },
  citizens: {
    note: 'parts are boxes on a 0.2m quantum with pivots for walking swing; a model part must match its box and pivot for rigid replacement',
    bands: citizens,
  },
  importedStudioAssets: STUDIO_ASSETS.map(a => ({ id: a.id, name: a.name, sha256: a.sha256 })),
  studioSourceCommit: manifest.sourceCommit,
  rejectedStudioAssets: [
    { id: 'BUILT-156', reason: 'own lamp head at 4.05–5.15m duplicates the live signal lamps at 2.9–4.2m' },
    { id: 'BUILT-157', reason: 'unlit red/amber/green lamps where no junction signal logic exists' },
    { id: 'LIFE-035', reason: 'bed headboard 1.0m exceeds the 0.6m bed solid' },
    { id: 'CHAR-002…015', reason: 'author-estimated proportions, not the game part boxes; no rig/animation binding' },
  ],
};
mkdirSync('docs/art-contract', { recursive: true });
writeFileSync('docs/art-contract/game-art-contract.json', JSON.stringify(contract, null, 2) + '\n');
console.log(`fixtures ${contract.floorFixtures.solids.length}, citizen bands ${citizens.length}, stations ${contract.stations.count}`);
