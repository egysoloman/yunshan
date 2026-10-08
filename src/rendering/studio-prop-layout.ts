import type { Building, BuildingKind } from '../types';
import { contains, getBuildingBody, getFloorPlanFixtures, getFloorPlanSlabRegions, type FloorFixture } from '../architecture-floor-plan';
import manifest from './studio-assets.json';

/** One imported voxel-studio GLB. Bounds are measured from the file at import. */
export interface StudioAsset {
  id: string; name: string; url: string; sha256: string; triangles: number;
  boundsM: { min: number[]; max: number[] };
}
export const STUDIO_ASSETS: readonly StudioAsset[] = manifest.assets;

/** Which studio asset dresses an authoritative floor-plan fixture, and how
 * many copies stand side by side along its local X. The fixture rectangle,
 * height and use point stay the physical and interaction contract; the asset
 * is display only and is never stretched, only uniformly reduced to fit. */
export const STUDIO_FIXTURE_DRESSING: Partial<Record<FloorFixture['kind'], { asset: string; copies: number }>> = {
  counter: { asset: 'LIFE-064', copies: 2 },
  table: { asset: 'LIFE-032', copies: 1 },
};
/** Program-specific furniture for the same fixture solid, by building use. */
export const STUDIO_PROGRAM_DRESSING: Partial<Record<BuildingKind, Partial<Record<FloorFixture['kind'], { asset: string; copies: number }>>>> = {
  police: { table: { asset: 'LIFE-151', copies: 1 } },
  school: { table: { asset: 'LIFE-111', copies: 2 } },
  // Two storage crates fill the 2.4×0.8×1.2m work-table solid exactly.
  workshop: { table: { asset: 'LIFE-072', copies: 2 } },
  farm: { table: { asset: 'LIFE-072', copies: 2 } },
};
/** One small object on the flat top of a general table model (LIFE-032),
 * by building use. It sits on the table surface, inside the table's own
 * footprint; nothing reaches below the top or into the use point. */
export const STUDIO_TABLETOP: Partial<Record<BuildingKind, string>> = { clinic: 'LIFE-119', bank: 'LIFE-106', hall: 'LIFE-171', home: 'LIFE-020' };
export const STUDIO_TABLETOP_BASE = 'LIFE-032';
export function studioDressing(kind: FloorFixture['kind'], buildingKind?: BuildingKind, assets: ReadonlyMap<string, StudioAsset> = assetById) {
  const program = buildingKind && STUDIO_PROGRAM_DRESSING[buildingKind]?.[kind];
  return program && assets.has(program.asset) ? program : STUDIO_FIXTURE_DRESSING[kind];
}
/** Below this a model would read as a toy inside a larger invisible solid. */
export const STUDIO_MIN_FIT_SCALE = .9;

export interface StudioPropPlacement {
  asset: string; fixtureId: string; floor: number; scale: number;
  /** Building-local position of the asset origin; building yaw applies after. */
  local: { x: number; y: number; z: number };
}

const assetById = new Map(STUDIO_ASSETS.map(asset => [asset.id, asset]));

/** Places the asset copies inside the fixture solid with their +Z front
 * toward the fixture's use point. Returns null when a uniform fit would fall
 * below STUDIO_MIN_FIT_SCALE, so the caller keeps the procedural furniture. */
export function layoutStudioFixture(fixture: FloorFixture, floor: number, floorY: number, assets: ReadonlyMap<string, StudioAsset> = assetById, buildingKind?: BuildingKind): StudioPropPlacement[] | null {
  const dressing = studioDressing(fixture.kind, buildingKind, assets), asset = dressing && assets.get(dressing.asset);
  if (!dressing || !asset) return null;
  const { min, max } = asset.boundsM, r = fixture.rect;
  const width = max[0] - min[0], height = max[1] - min[1], depth = max[2] - min[2];
  const slot = (r.x1 - r.x0) / dressing.copies;
  const scale = Math.min(1, slot / width, (r.z1 - r.z0) / depth, (fixture.top - fixture.bottom) / height);
  if (!(scale >= STUDIO_MIN_FIT_SCALE)) return null;
  const centerZ = (r.z0 + r.z1) / 2;
  const placements: StudioPropPlacement[] = Array.from({ length: dressing.copies }, (_, copy) => ({
    asset: asset.id, fixtureId: fixture.id, floor, scale,
    local: {
      x: r.x0 + slot * (copy + .5) - scale * (min[0] + max[0]) / 2,
      y: floorY + fixture.bottom - scale * min[1],
      z: centerZ - scale * (min[2] + max[2]) / 2,
    },
  }));
  const top = fixture.kind === 'table' && asset.id === STUDIO_TABLETOP_BASE && buildingKind ? assets.get(STUDIO_TABLETOP[buildingKind] ?? '') : undefined;
  if (top) {
    const b = top.boundsM, footprint = asset.boundsM;
    // Only when the object stands within the scaled table top.
    if (b.max[0] - b.min[0] <= scale * (footprint.max[0] - footprint.min[0]) && b.max[2] - b.min[2] <= scale * (footprint.max[2] - footprint.min[2]))
      placements.push({ asset: top.id, fixtureId: `${fixture.id}:top`, floor, scale: 1,
        local: { x: (r.x0 + r.x1) / 2 - (b.min[0] + b.max[0]) / 2, y: floorY + fixture.bottom + scale * (footprint.max[1] - footprint.min[1]) - b.min[1], z: centerZ - (b.min[2] + b.max[2]) / 2 } });
  }
  return placements;
}

/** True when the fixture is shown by a studio asset instead of boxes. */
export function studioDressesFixture(fixture: FloorFixture, buildingKind?: BuildingKind, assets: ReadonlyMap<string, StudioAsset> = assetById): boolean {
  return layoutStudioFixture(fixture, 0, 0, assets, buildingKind) !== null;
}

/** LIFE-028 is mounted flush under the next floor's slab (ceilingY − .2)
 * above each interior use point, where the renderer's task light serves that
 * point. Only points actually covered by a slab get one; a top floor under a
 * pitched roof has no flat mount and is left without a model. */
export const CEILING_LAMP = { asset: 'LIFE-028', slabThickness: .2, eyeClearance: 1.72 } as const;
export function studioCeilingLampPlacements(building: Building, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioPropPlacement[] {
  const body = getBuildingBody(building), asset = assets.get(CEILING_LAMP.asset); if (!body || !asset) return [];
  const { min, max } = asset.boundsM;
  return body.floorPlans.flatMap(plan => {
    const above = body.floorPlans.find(next => next.floor === plan.floor + 1); if (!above) return [];
    const slabs = getFloorPlanSlabRegions(above), top = plan.ceilingY - CEILING_LAMP.slabThickness, y = top - max[1];
    if (y + min[1] < plan.y + CEILING_LAMP.eyeClearance) return [];
    return plan.usePoints.filter(point => plan.interior.some(region => contains(region, point.x, point.z))
      && [[min[0], min[2]], [max[0], min[2]], [min[0], max[2]], [max[0], max[2]]].every(([dx, dz]) => slabs.some(region => contains(region, point.x + dx - (min[0] + max[0]) / 2, point.z + dz - (min[2] + max[2]) / 2))))
      .map(point => ({ asset: asset.id, fixtureId: `${point.id}:ceiling-lamp`, floor: plan.floor, scale: 1,
        local: { x: point.x - (min[0] + max[0]) / 2, y, z: point.z - (min[2] + max[2]) / 2 } }));
  });
}

/** Every studio placement of a building's floor-plan fixtures and lamps. */
export function studioBuildingPlacements(building: Building, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioPropPlacement[] {
  const body = getBuildingBody(building); if (!body) return [];
  return [...body.floorPlans.flatMap(plan => getFloorPlanFixtures(building, plan).flatMap(fixture => layoutStudioFixture(fixture, plan.floor, plan.y, assets, building.kind) ?? [])),
    ...studioCeilingLampPlacements(building, assets)];
}

/** A fixed, world-space studio model (origin = its min corner, yaw about Y). */
export interface StudioStaticPlacement { asset: string; id: string; position: { x: number; y: number; z: number }; yaw: number; /** Rotation about the model's own X after yaw (deck slope); 0 when absent. */ pitch?: number }

/** BUILT-154 is the existing 22×1×18m station platform at the same extent as
 * the original box (centre y−.6, top y−.1). BUILT-155 stands on the
 * platform's own canopy-foot ports. Signal poles keep their live lamps and
 * are not replaced. Display only: walking surfaces come from the world. */
export const STATION_PLATFORM = { asset: 'BUILT-154', min: { x: -11, y: -1.1, z: -9 } } as const;
export const STATION_SHELTER = { asset: 'BUILT-155', onPlatform: { x: 1.4 - 1.9, y: 1, z: 8.5 - 5 } } as const;
export function studioStationPlacements(world: { nodes: readonly { id: string; station?: boolean; position: { x: number; y: number; z: number } }[] }, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioStaticPlacement[] {
  if (!assets.has(STATION_PLATFORM.asset) || !assets.has(STATION_SHELTER.asset)) return [];
  return world.nodes.filter(node => node.station).flatMap(node => {
    const p = node.position, platform = { x: p.x + STATION_PLATFORM.min.x, y: p.y + STATION_PLATFORM.min.y, z: p.z + STATION_PLATFORM.min.z };
    return [
      { asset: STATION_PLATFORM.asset, id: `${node.id}:platform`, position: platform, yaw: 0 },
      { asset: STATION_SHELTER.asset, id: `${node.id}:shelter`, position: { x: platform.x + STATION_SHELTER.onPlatform.x, y: platform.y + STATION_SHELTER.onPlatform.y, z: platform.z + STATION_SHELTER.onPlatform.z }, yaw: 0 },
    ];
  });
}

/** One-off studio landmarks authored at the game's own fixed dimensions:
 * BUILT-158 is the 960×44m 南岫 runway (its 1.5m slab top at the runway deck
 * top), and BUILT-092 the 96×84m forecourt with lamps and flags before the
 * core, centred where the renderer's forecourt is (door + 67m). The renderer
 * leaves out its own boxes for any landmark returned here. Display only. */
export const RUNWAY_LANDMARK = { asset: 'BUILT-158', edgeId: 'road-airport-runway-strip' } as const;
export const FORECOURT_LANDMARK = { asset: 'BUILT-092', doorOffsetZ: 67 } as const;
export function studioLandmarkPlacements(world: { buildings: readonly Building[]; edges: readonly { id: string; points: readonly { x: number; y: number; z: number }[] }[] }, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioStaticPlacement[] {
  const placements: StudioStaticPlacement[] = [];
  const runway = world.edges.find(edge => edge.id === RUNWAY_LANDMARK.edgeId), slab = assets.get(RUNWAY_LANDMARK.asset);
  if (runway && slab && runway.points.length === 2) {
    const [a, b] = runway.points, length = Math.hypot(b.x - a.x, b.z - a.z), width = slab.boundsM.max[2] - slab.boundsM.min[2];
    // Only a straight, level strip of exactly the model's length is dressed.
    if (Math.abs(length - (slab.boundsM.max[0] - slab.boundsM.min[0])) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6 && b.x > a.x)
      placements.push({ asset: slab.id, id: `${runway.id}:runway`, position: { x: a.x - slab.boundsM.min[0], y: a.y - slab.boundsM.max[1], z: a.z - width / 2 - slab.boundsM.min[2] }, yaw: 0 });
  }
  const core = world.buildings.find(b => b.kind === 'core'), court = assets.get(FORECOURT_LANDMARK.asset);
  if (core && court) placements.push({ asset: court.id, id: `${core.id}:forecourt`, position: { x: core.position.x, y: core.position.y, z: core.door.z + FORECOURT_LANDMARK.doorOffsetZ }, yaw: 0 });
  return placements;
}

/** Deck modules authored at the game's exact deck cross-sections, repeated
 * along every rail or bridge segment (repeated, never stretched): BUILT-140
 * rail bed 6×1.4m and BUILT-146 bridge deck 9×0.5m, each 8m long. Every piece
 * follows its segment's heading and slope (rigid rotation); the last piece of
 * a segment overlaps backwards to end flush. The network emitter leaves out
 * its own deck box for a mode dressed here. Display only. */
export const DECK_TILES = {
  rail: { asset: 'BUILT-140', modes: ['maglev', 'lightRail'], height: 1.4, lift: -.9 },
  bridge: { asset: 'BUILT-146', modes: ['bridge'], height: .5, lift: -.25 },
} as const;
export function studioDeckTilePlacements(world: { edges: readonly { id: string; mode: string; points: readonly { x: number; y: number; z: number }[] }[] }, deckWidth: (edge: any) => number, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioStaticPlacement[] {
  const placements: StudioStaticPlacement[] = [];
  for (const [kind, tile] of Object.entries(DECK_TILES)) {
    const asset = assets.get(tile.asset); if (!asset) continue;
    for (const edge of world.edges) if ((tile.modes as readonly string[]).includes(edge.mode)) tileEdgePath(edge, kind, asset, tile.height, tile.lift, deckWidth(edge), placements);
  }
  return placements;
}

/** The studio road modules authored from the existing road cross-section, each
 * 2m long: BUILT-131 surface (10×0.5m deck), BUILT-132 centre line (0.16×0.08m)
 * and BUILT-134 paired kerbs (±4.75m, 9.9m overall). Tiled every 2m along every
 * road but the runway strip, about 85,000 of each: renderers draw only those
 * near the camera, over the network's own boxes (which are then drawn slightly
 * lower and narrower so the two never z-fight). */
export const ROAD_TILES = [
  { kind: 'road', asset: 'BUILT-131', width: 10, height: .5, lift: -.25 },
  { kind: 'road-line', asset: 'BUILT-132', width: .16, height: .08, lift: .07 },
  { kind: 'road-kerb', asset: 'BUILT-134', width: 9.9, height: .2, lift: .12 },
] as const;
export function studioRoadTilePlacements(world: { edges: readonly { id: string; mode: string; points: readonly { x: number; y: number; z: number }[] }[] }, deckWidth: (edge: any) => number, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioStaticPlacement[] {
  const placements: StudioStaticPlacement[] = [];
  for (const tile of ROAD_TILES) {
    const asset = assets.get(tile.asset); if (!asset) continue;
    // The road deck is 10m wide; each module is checked against its own part of that section.
    for (const edge of world.edges) if (edge.mode === 'road' && !edge.id.includes('runway') && deckWidth(edge) === 10) tileEdgePath(edge, tile.kind, asset, tile.height, tile.lift, tile.width, placements);
  }
  return placements;
}

function tileEdgePath(edge: { id: string; points: readonly { x: number; y: number; z: number }[] }, kind: string, asset: StudioAsset, tileHeight: number, lift: number, deck: number, placements: StudioStaticPlacement[]): void {
  const { min, max } = asset.boundsM, width = max[0] - min[0], height = max[1] - min[1], length = max[2] - min[2];
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  // Only an exact cross-section is dressed; anything else keeps its deck box.
  if (Math.abs(deck - width) > 1e-6 || Math.abs(tileHeight - height) > 1e-6) return;
  // Tiles run along the whole edge path (the world samples rails every 4m),
  // each turned to the segment its centre lies on; the last overlaps backwards.
  const spans: number[] = [];
  for (let i = 1; i < edge.points.length; i++) { const a = edge.points[i - 1], b = edge.points[i]; spans.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)); }
  const total = spans.reduce((sum, n) => sum + n, 0); if (total < .01) return;
  const count = Math.max(1, Math.ceil(total / length));
  let i = 0, before = 0;
  for (let k = 0; k < count; k++) {
    const s = total < length ? total / 2 : Math.min(k * length + length / 2, total - length / 2);
    if (s < before) { i = 0; before = 0; }
    while (i < spans.length - 1 && before + spans[i] < s) { before += spans[i]; i++; }
    const a = edge.points[i], b = edge.points[i + 1], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, t = spans[i] > 0 ? (s - before) / spans[i] : 0;
    const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    // R·c for R = rotY(yaw)·rotX(pitch), so the model's centre lands on the deck centre.
    const r1y = cy * cosP - cz * sinP, r1z = cy * sinP + cz * cosP, rcx = cx * cosY + r1z * sinY, rcy = r1y, rcz = -cx * sinY + r1z * cosY;
    const centre = { x: a.x + dx * t, y: a.y + dy * t + lift, z: a.z + dz * t };
    placements.push({ asset: asset.id, id: `${edge.id}:${kind}-deck:${k}`, position: { x: centre.x - rcx, y: centre.y - rcy, z: centre.z - rcz }, yaw, pitch });
  }
}
