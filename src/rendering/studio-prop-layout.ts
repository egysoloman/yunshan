import type { Building, BuildingKind } from '../types';
import { contains, getBuildingBody, getFloorPlanFixtures, getFloorPlanSlabRegions, wallPanels, type FloorFixture, type Rect } from '../architecture-floor-plan';
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
  /** Building-local turn about Y at the origin (décor only); 0 when absent. */
  yaw?: number;
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
  const body = getBuildingBody(building); if (!body) return studioFacadePlacements(building, assets);
  return [...body.floorPlans.flatMap(plan => getFloorPlanFixtures(building, plan).flatMap(fixture => layoutStudioFixture(fixture, plan.floor, plan.y, assets, building.kind) ?? [])),
    ...studioCeilingLampPlacements(building, assets), ...studioDecorPlacements(building, assets), ...studioFacadePlacements(building, assets)];
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
  { kind: 'road', asset: 'BUILT-131', modes: ['road'], deck: 10, width: 10, height: .5, lift: -.25 },
  { kind: 'road-line', asset: 'BUILT-132', modes: ['road'], deck: 10, width: .16, height: .08, lift: .07 },
  { kind: 'road-kerb', asset: 'BUILT-134', modes: ['road'], deck: 10, width: 9.9, height: .2, lift: .12 },
  // BUILT-142: the paired rail side strips (±2.75m, 0.35×0.5m), same near drawing.
  { kind: 'rail-kerb', asset: 'BUILT-142', modes: ['maglev', 'lightRail'], deck: 6, width: 5.85, height: .5, lift: -.1 },
] as const;
export function studioRoadTilePlacements(world: { edges: readonly { id: string; mode: string; points: readonly { x: number; y: number; z: number }[] }[] }, deckWidth: (edge: any) => number, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioStaticPlacement[] {
  const placements: StudioStaticPlacement[] = [];
  for (const tile of ROAD_TILES) {
    const asset = assets.get(tile.asset); if (!asset) continue;
    // Each module is checked against its own part of the deck section.
    for (const edge of world.edges) if ((tile.modes as readonly string[]).includes(edge.mode) && !edge.id.includes('runway') && deckWidth(edge) === tile.deck) tileEdgePath(edge, tile.kind, asset, tile.height, tile.lift, tile.width, placements);
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

/** Studio parts authored at the exact size of fixed network boxes: BUILT-160
 * runway side lights (0.9×0.3×0.9m, ±16.5m off each runway sample midpoint)
 * and BUILT-138 rail pier caps (7×1.8×4m, on every elevated rail support of
 * emitNetworkStructures). Both are axis-aligned like the boxes they replace.
 * Display only; the support spacing repeats the network's own rule. */
export const RUNWAY_LIGHT_ASSET = 'BUILT-160';
export const RAIL_PIER_CAP_ASSET = 'BUILT-138';
type DetailWorld = { buildings: readonly { id: string; kind: string }[]; edges: readonly { id: string; mode: string; points: readonly { x: number; y: number; z: number }[] }[] };
export function studioNetworkDetailPlacements(world: DetailWorld, deckWidth: (edge: any) => number, groundHeight: (x: number, z: number) => number, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioStaticPlacement[] {
  const placements: StudioStaticPlacement[] = [];
  const at = (asset: StudioAsset, id: string, x: number, y: number, z: number) => {
    const { min, max } = asset.boundsM;
    placements.push({ asset: asset.id, id, position: { x: x - (min[0] + max[0]) / 2, y: y - (min[1] + max[1]) / 2, z: z - (min[2] + max[2]) / 2 }, yaw: 0 });
  };
  const light = assets.get(RUNWAY_LIGHT_ASSET), runway = world.edges.find(edge => edge.id === 'road-airport-runway-strip');
  if (light && runway) for (const b of world.buildings) if (b.kind === 'airport') for (let i = 1; i < runway.points.length; i++) {
    const a = runway.points[i - 1], next = runway.points[i], cx = (a.x + next.x) / 2, cy = (a.y + next.y) / 2 + .18, cz = (a.z + next.z) / 2;
    for (const side of [-1, 1]) at(light, `${b.id}:runway-light:${i}:${side}`, cx, cy + .12, cz + side * 16.5);
  }
  const cap = assets.get(RAIL_PIER_CAP_ASSET);
  if (cap) for (const edge of world.edges) {
    if (edge.mode !== 'maglev' && edge.mode !== 'lightRail') continue;
    const { min, max } = cap.boundsM; if (Math.abs(max[0] - min[0] - (deckWidth(edge) + 1)) > 1e-6 || Math.abs(max[1] - min[1] - 1.8) > 1e-6 || Math.abs(max[2] - min[2] - 4) > 1e-6) continue;
    let supportRemainder = 0;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], length = Math.hypot(b.x - a.x, b.z - a.z), interval = 80;
      for (let along = interval - supportRemainder; along <= length; along += interval) {
        const t = along / Math.max(.01, length), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
        if (y - groundHeight(x, z) > 5) at(cap, `${edge.id}:pier-cap:${i}:${Math.round(along * 1000)}`, x, y - 1.3, z);
      }
      supportRemainder = (supportRemainder + length) % interval;
    }
  }
  return placements;
}

/** Decoration only (user decision 2026-10-08: furniture and props without a
 * floor-plan fixture are placed as display-only décor, no collision): studio
 * furniture in free room corners, by building use. A set is a floor-standing
 * base with an optional chain of objects each standing on the one below
 * (centred, inside its footprint) and an optional wall object hung 0.3m above
 * the base, flush with its back. A corner is used only when the whole set is
 * inside the rooms, clear of walls, corridors, courtyards, stairs, fixtures
 * (+0.6m), use points and the stair point (1m), door openings (1.2m) and other
 * décor; walking surfaces, collision and use points are unchanged. */
export interface StudioDecorSet { base: string; tops?: readonly string[]; above?: string; /** Worn by the base (pet accessories), authored in its own model space: same origin. */ wear?: readonly string[] }
const set = (base: string, tops: string[] = [], above?: string, wear?: string[]): StudioDecorSet => ({ base, tops, above, ...(wear ? { wear } : {}) });
/** CHAR-329 hangs from the collar CHAR-328: collar tag-mount − tag hanger-top (manifest ports). */
export const PET_TAG = { asset: 'CHAR-329', on: 'CHAR-328', offset: [.032, .292728, -.318034] } as const;
const HOME_DECOR = [set('LIFE-037', ['LIFE-038', 'LIFE-048'], 'LIFE-041'), set('LIFE-039'), set('LIFE-043'), set('LIFE-050', ['LIFE-051'], 'LIFE-055'), set('LIFE-024', ['LIFE-009'], 'LIFE-029'),
  set('LIFE-052', [], 'LIFE-057'), set('LIFE-008', [], 'LIFE-030'), set('LIFE-037', ['LIFE-038', 'LIFE-040']), set('LIFE-042'), set('LIFE-053'), set('LIFE-054'), set('LIFE-198'), set('LIFE-197'), set('LIFE-196'),
  set('LIFE-037', ['LIFE-038', 'LIFE-044', 'LIFE-045']), set('LIFE-194'), set('LIFE-195'), set('LIFE-227'), set('LIFE-023'), set('LIFE-031'), set('LIFE-191'), set('LIFE-192', ['LIFE-049']), set('LIFE-174'),
  set('LIFE-184', ['LIFE-181']), set('LIFE-037', ['LIFE-038', 'LIFE-046']), set('LIFE-037', ['LIFE-038', 'LIFE-047']),
  set('CHAR-307', [], undefined, ['CHAR-330', 'CHAR-328', 'CHAR-329']), set('CHAR-306'), set('CHAR-308')];
const MARKET_DECOR = [set('LIFE-066', ['LIFE-068'], 'LIFE-070'), set('LIFE-065', ['LIFE-092']), set('LIFE-067', ['LIFE-069']), set('LIFE-065', ['LIFE-093']), set('LIFE-071'), set('LIFE-080'), set('LIFE-065', ['LIFE-094']),
  set('LIFE-074'), set('LIFE-091'), set('LIFE-199'), set('LIFE-140')];
const WORKSHOP_DECOR = [set('LIFE-081', ['LIFE-085']), set('LIFE-082'), set('LIFE-083'), set('LIFE-075', ['LIFE-076']), set('LIFE-084'), set('LIFE-078'), set('LIFE-079'), set('LIFE-075', ['LIFE-095']),
  set('LIFE-172'), set('LIFE-159'), set('LIFE-071', ['LIFE-073'])];
const FARM_DECOR = [set('LIFE-086'), set('LIFE-088'), set('LIFE-087'), set('LIFE-075', ['LIFE-086']), set('LIFE-196')];
const CIVIC_DECOR = [set('LIFE-141'), set('LIFE-142'), set('LIFE-146'), set('LIFE-143'), set('LIFE-144'), set('LIFE-147'), set('LIFE-148'), set('LIFE-150'), set('LIFE-178', ['LIFE-179']), set('LIFE-145'),
  set('LIFE-153'), set('LIFE-154'), set('LIFE-187'), set('LIFE-188'), set('LIFE-189'), set('LIFE-200'), set('LIFE-185'), set('LIFE-176'), set('LIFE-177'), set('LIFE-175'), set('LIFE-117'), set('LIFE-118'), set('LIFE-193'), set('LIFE-149'), set('ENV-134')];
export const STUDIO_DECOR: Partial<Record<BuildingKind, readonly StudioDecorSet[]>> = {
  home: HOME_DECOR, farm: FARM_DECOR, market: MARKET_DECOR, workshop: WORKSHOP_DECOR,
  school: [set('LIFE-109', ['LIFE-107']), set('LIFE-110'), set('LIFE-112', ['LIFE-114']), set('LIFE-116'), set('LIFE-113'), set('LIFE-112', ['LIFE-115']), set('LIFE-169'), set('LIFE-170'), set('LIFE-182'), set('LIFE-183'), set('LIFE-180')],
  hall: CIVIC_DECOR, core: CIVIC_DECOR,
  police: [set('LIFE-152'), set('LIFE-155'), set('LIFE-157', ['LIFE-158']), set('LIFE-156'), set('LIFE-159')],
  clinic: [set('LIFE-123', ['LIFE-096']), set('LIFE-124'), set('LIFE-125'), set('LIFE-127', [], 'LIFE-121'), set('LIFE-122')],
  bank: [set('LIFE-089'), set('LIFE-149', ['LIFE-090']), set('LIFE-146'), set('LIFE-149', ['LIFE-019']), set('LIFE-144'), set('ENV-134')],
  station: [set('LIFE-147'), set('LIFE-193'), set('LIFE-140'), set('LIFE-091')],
  dock: [set('LIFE-087'), set('LIFE-088'), set('LIFE-075', ['LIFE-095']), set('LIFE-071')],
  airport: [set('LIFE-147'), set('LIFE-193'), set('LIFE-140')], starport: [set('LIFE-147'), set('LIFE-193'), set('LIFE-140')],
};
export const STUDIO_DECOR_PER_FLOOR = 4;
/** Outdoor furniture in ground-floor courtyard corners (benches and stone lamps), at most two per building. */
export const STUDIO_COURTYARD_DECOR: readonly StudioDecorSet[] = [set('ENV-098'), set('ENV-104'), set('ENV-096'), set('ENV-097'), set('BUILT-240'), set('LIFE-186')];
export const STUDIO_COURTYARD_DECOR_PER_BUILDING = 3;
const DECOR_INSET = .22;
export type StudioDecorPlacement = StudioPropPlacement & { yaw: number };
type R = { x0: number; x1: number; z0: number; z1: number };
const overlaps = (a: R, b: R, grow = 0) => a.x0 < b.x1 + grow - 1e-9 && a.x1 > b.x0 - grow + 1e-9 && a.z0 < b.z1 + grow - 1e-9 && a.z1 > b.z0 - grow + 1e-9;
const rectPointDistance = (r: R, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
function rectSegmentDistance(r: R, ax: number, az: number, bx: number, bz: number) {
  let best = Infinity; for (let i = 0; i <= 16; i++) { const t = i / 16; best = Math.min(best, rectPointDistance(r, ax + (bx - ax) * t, az + (bz - az) * t)); } return best;
}
export function studioDecorSeed(id: string) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000003; return h; }

export function studioDecorPlacements(building: Building, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioDecorPlacement[] {
  const body = getBuildingBody(building); if (!body) return [];
  const usableOf = (sets: readonly StudioDecorSet[] | undefined) => (sets ?? []).filter(s => [s.base, ...(s.tops ?? []), ...(s.above ? [s.above] : []), ...(s.wear ?? [])].every(id => assets.has(id)));
  const usable = usableOf(STUDIO_DECOR[building.kind]), outdoor = usableOf(STUDIO_COURTYARD_DECOR);
  const result: StudioDecorPlacement[] = [];
  const seed = studioDecorSeed(building.id);
  let cursor = usable.length ? seed % usable.length : 0, outdoorCursor = outdoor.length ? seed % outdoor.length : 0, outdoorPlaced = 0;
  for (const plan of body.floorPlans) {
    const taken: R[] = [];
    const above = body.floorPlans.find(next => next.floor === plan.floor + 1), aboveSlabs = above ? getFloorPlanSlabRegions(above) : [];
    const walls = wallPanels(plan).map(p => p.rect), fixtures = plan.fixtures.map(f => f.rect), stairs = [...(plan.stairHole ? [plan.stairHole] : []), plan.stairLanding, ...plan.stairTreads.map(t => t.rect), ...plan.stairLandings.map(t => t.rect)];
    const doors = plan.walls.flatMap(w => { if (!w.opening) return []; const length = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), dx = (w.b[0] - w.a[0]) / length, dz = (w.b[1] - w.a[1]) / length; return [[w.a[0] + dx * w.opening.from, w.a[1] + dz * w.opening.from, w.a[0] + dx * w.opening.to, w.a[1] + dz * w.opening.to]]; });
    const points = [...plan.usePoints, plan.stair];
    // Rooms: under the plan's own ceiling. Courtyards (ground floor only): open sky unless the floor above covers the spot.
    const passes: { rooms: Rect[]; blockers: Rect[]; sets: StudioDecorSet[]; limit: number; outdoor: boolean }[] = [
      { rooms: plan.interior, blockers: [...plan.circulation, ...plan.courtyard, ...stairs], sets: usable, limit: STUDIO_DECOR_PER_FLOOR, outdoor: false },
      ...(plan.floor === 0 ? [{ rooms: plan.courtyard, blockers: [...plan.circulation, ...plan.interior, ...stairs], sets: outdoor, limit: STUDIO_COURTYARD_DECOR_PER_BUILDING, outdoor: true }] : []),
    ];
    for (const pass of passes) {
      if (!pass.sets.length) continue;
      const inside = (r: R) => [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1], [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]].every(([x, z]) => pass.rooms.some(region => contains(region, x, z)));
      const covered = (r: R) => [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1], [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]].some(([x, z]) => aboveSlabs.some(region => contains(region, x, z)));
      let placed = 0;
      for (const room of pass.rooms) for (const [cx, cz, sx, sz] of [[room.x0, room.z0, 1, 1], [room.x1, room.z0, -1, 1], [room.x1, room.z1, -1, -1], [room.x0, room.z1, 1, -1]] as const) {
        if (placed >= pass.limit || (pass.outdoor && outdoorPlaced >= pass.limit)) break;
        const start = pass.outdoor ? outdoorCursor : cursor;
        for (let attempt = 0; attempt < pass.sets.length; attempt++) {
          const decor = pass.sets[(start + attempt) % pass.sets.length], base = assets.get(decor.base)!, b = base.boundsM;
          const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], yaw = sz > 0 ? 0 : Math.PI;
          const x0 = sx > 0 ? cx + DECOR_INSET : cx - DECOR_INSET - w, z0 = sz > 0 ? cz + DECOR_INSET : cz - DECOR_INSET - d;
          // Stack heights: every top stands centred on the one below, inside its footprint.
          let topY = b.max[1] - b.min[1], below = base, fits = true; const stack: { asset: StudioAsset; y: number }[] = [];
          for (const id of decor.tops ?? []) { const a = assets.get(id)!, ab = a.boundsM, bb = below.boundsM;
            if (ab.max[0] - ab.min[0] > bb.max[0] - bb.min[0] + .02 || ab.max[2] - ab.min[2] > bb.max[2] - bb.min[2] + .02) { fits = false; break; }
            stack.push({ asset: a, y: topY }); topY += ab.max[1] - ab.min[1]; below = a; }
          const hung = decor.above ? assets.get(decor.above)! : undefined, hungY = b.max[1] - b.min[1] + .3;
          const top = Math.max(topY, hung ? hungY + hung.boundsM.max[1] - hung.boundsM.min[1] : 0);
          // A wall object may be wider than its base: every check uses the union of both footprints.
          const hw = hung ? Math.max(0, (hung.boundsM.max[0] - hung.boundsM.min[0] - w) / 2) : 0, extent = { x0: x0 - hw, x1: x0 + w + hw, z0, z1: z0 + d };
          if (!fits || (!pass.outdoor || covered(extent)) && top > plan.ceilingY - plan.y - .1) continue;
          if (!inside(extent) || pass.blockers.some(r => overlaps(extent, r)) || walls.some(r => overlaps(extent, r)) || fixtures.some(r => overlaps(extent, r, .6)) || taken.some(r => overlaps(extent, r, .1))) continue;
          if (points.some(p => rectPointDistance(extent, p.x, p.z) < 1) || doors.some(([ax, az, bx, bz]) => rectSegmentDistance(extent, ax, az, bx, bz) < 1.2)) continue;
          // Local origin so that the model's own bounds land in the footprint, front (+Z) into the room.
          const centreX = x0 + w / 2, centreZ = z0 + d / 2, c = Math.cos(yaw), s = Math.sin(yaw);
          const add = (a: StudioAsset, y: number, id: string, flushBack: boolean) => {
            const ab = a.boundsM, mx = (ab.min[0] + ab.max[0]) / 2, mz = (ab.min[2] + ab.max[2]) / 2, ox = mx * c + mz * s, oz = -mx * s + mz * c;
            // A wall object's back is flush with the base's back face.
            const shift = flushBack ? (d - (ab.max[2] - ab.min[2])) / 2 * (sz > 0 ? 1 : -1) : 0;
            result.push({ asset: a.id, fixtureId: `decor:${plan.floor}:${id}`, floor: plan.floor, scale: 1, yaw, local: { x: centreX - ox, y: plan.y + y - ab.min[1], z: centreZ - oz - shift } });
          };
          const key = `${result.length}`;
          add(base, 0, `${key}:base`, false);
          stack.forEach((item, i) => add(item.asset, item.y, `${key}:top${i}`, false));
          if (hung) add(hung, hungY, `${key}:above`, true);
          // Worn accessories share the base's own origin and turn (the tag hangs from the collar).
          const origin = result[result.length - 1 - stack.length - (hung ? 1 : 0)].local;
          (decor.wear ?? []).forEach((id, i) => {
            const o = id === PET_TAG.asset ? PET_TAG.offset : [0, 0, 0];
            result.push({ asset: id, fixtureId: `decor:${plan.floor}:${key}:wear${i}`, floor: plan.floor, scale: 1, yaw, local: { x: origin.x + o[0] * c + o[2] * s, y: origin.y + o[1], z: origin.z - o[0] * s + o[2] * c } });
          });
          taken.push(extent); placed++;
          if (pass.outdoor) { outdoorPlaced++; outdoorCursor = (start + attempt + 1) % pass.sets.length; } else cursor = (start + attempt + 1) % pass.sets.length;
          break;
        }
      }
    }
  }
  return result;
}

/** Facade décor (user decision 2026-10-09): legacy studio facade parts at
 * original size mounted on the outer face of real program walls, display
 * only — walls, openings, windows, collision and walking are unchanged. A part
 * is hung only on a free span of an exterior wall: no door or window may cross
 * its height range, on every storey it reaches. Studio facade parts have their
 * back at z = 0 and face +Z, so +Z turns to the wall's outward normal. The two
 * legacy-facade kinds (the 天枢 core and the summit pavilions) get their own
 * authored parts at their legacy geometry. */
export const FACADE_DOOR_SIDE: Partial<Record<BuildingKind, string>> = { home: 'BUILT-063', farm: 'BUILT-063', market: 'BUILT-101', clinic: 'BUILT-116', workshop: 'BUILT-244', hall: 'BUILT-045', school: 'BUILT-045', police: 'BUILT-045', bank: 'BUILT-045', dock: 'BUILT-045', station: 'BUILT-045' };
export const FACADE_WALL: Partial<Record<BuildingKind, readonly string[]>> = {
  // BUILT-071 stays rejected (it would hang below eye height); every part that juts out hangs above 1.72m.
  home: ['BUILT-070'], farm: ['BUILT-070'], market: ['BUILT-069', 'BUILT-070'], workshop: ['BUILT-069', 'BUILT-070'], hall: ['BUILT-045'], school: ['BUILT-045'], police: ['BUILT-045'],
  clinic: ['BUILT-070'], bank: ['BUILT-045'], dock: ['BUILT-070'], station: ['BUILT-070'], airport: ['BUILT-070'], starport: ['BUILT-070'],
};
export const FACADE_EAVE = ['BUILT-053', 'BUILT-248', 'BUILT-061', 'BUILT-073', 'BUILT-246', 'BUILT-074'] as const;
export const FACADE_LIMITS = { wallPerFloor: 2, wall: 6, eave: 8, fins: 4 } as const;
/** Every facade part this layout can place (for loading). */
export const STUDIO_FACADE_ASSETS = ['BUILT-054', 'BUILT-108', 'BUILT-241', 'BUILT-219', 'BUILT-072', 'BUILT-088', 'BUILT-089', 'BUILT-090', 'BUILT-091', ...FACADE_EAVE] as const;

type WallMount = { floor: number; along: number; y0: number };
export function studioFacadePlacements(building: Building, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioDecorPlacement[] {
  const out: StudioDecorPlacement[] = [], seed = studioDecorSeed(building.id);
  const put = (id: string, key: string, floor: number, x: number, y: number, z: number, yaw: number) => {
    const a = assets.get(id); if (!a) return;
    out.push({ asset: id, fixtureId: `facade:${floor}:${key}`, floor, scale: 1, yaw, local: { x, y, z } });
  };
  // Legacy geometry (renderer box coordinates are relative to the building position; placements add 0.6).
  if (building.kind === 'pavilion') {
    const w = building.width, d = building.depth, a = assets.get('BUILT-072');
    if (a) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const yaw = sz > 0 ? 0 : Math.PI, c = Math.cos(yaw), s = Math.sin(yaw), mx = (a.boundsM.min[0] + a.boundsM.max[0]) / 2, mz = (a.boundsM.min[2] + a.boundsM.max[2]) / 2;
      put(a.id, `post:${sx}:${sz}`, 0, sx * w * .4 - (mx * c + mz * s), -.6, sz * d * .4 - (-mx * s + mz * c), yaw);
    }
    return out;
  }
  if (building.kind === 'core') {
    const w = building.width, d = building.depth, h = building.height;
    const centred = (id: string, key: string, x: number, y: number, z: number) => { const a = assets.get(id); if (!a) return; put(id, key, 0, x - (a.boundsM.min[0] + a.boundsM.max[0]) / 2, y - .6, z - a.boundsM.min[2], 0); };
    centred('BUILT-088', 'south-portico', 0, 0, d / 2);
    for (const x of [-w / 2 + 1.2, w / 2 - 1.2]) centred('BUILT-089', `pillar:${x}`, x, 0, d / 2);
    for (const x of [-w * .25, w * .25]) centred('BUILT-090', `gallery:${x}`, x, 5.5, d / 2);
    const top = assets.get('BUILT-091'); if (top) put(top.id, 'observation', 0, -(top.boundsM.min[0] + top.boundsM.max[0]) / 2, h - .6, -(top.boundsM.min[2] + top.boundsM.max[2]) / 2, 0);
    return out;
  }
  const body = getBuildingBody(building); if (!body) return out;
  const plans = body.floorPlans.filter(p => p.floor >= 0), top = plans.reduce((m, p) => Math.max(m, p.floor), 0);
  const sameWall = (a: { a: [number, number]; b: [number, number] }, b: { a: [number, number]; b: [number, number] }) => a.a[0] === b.a[0] && a.a[1] === b.a[1] && a.b[0] === b.b[0] && a.b[1] === b.b[1];
  // Exterior walls of each storey, with the outward side: open air or an open-air courtyard on one side, a room or corridor on the other.
  const exterior = plans.flatMap(plan => {
    const regions = [...plan.interior, ...plan.circulation];
    return plan.walls.flatMap((wall, index) => {
      const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]); if (length < 1) return [];
      const dx = (wall.b[0] - wall.a[0]) / length, dz = (wall.b[1] - wall.a[1]) / length, mx = (wall.a[0] + wall.b[0]) / 2, mz = (wall.a[1] + wall.b[1]) / 2;
      for (const side of [1, -1]) { const nx = -dz * side, nz = dx * side;
        if (!regions.some(r => contains(r, mx + nx * .8, mz + nz * .8)) && regions.some(r => contains(r, mx - nx * .8, mz - nz * .8))) return [{ plan, wall, index, length, dx, dz, nx, nz }]; }
      return [];
    });
  });
  type Exterior = (typeof exterior)[number];
  // Is [from, to] along the wall free of doors and windows over [y0, y1] above this storey's floor, on every storey it reaches?
  const free = (e: Exterior, from: number, to: number, y0: number, y1: number, ignoreOpening = false) => {
    if (from < .3 || to > e.length - .3) return false;
    const storeyHeight = e.plan.ceilingY - e.plan.y;
    for (const p of plans) {
      const lo = p.y - e.plan.y, hi = lo + (p.ceilingY - p.y); if (hi <= y0 || lo >= y1) continue;
      if (p.floor > top) return false;
      const w = p.walls.find(x => sameWall(x, e.wall)); if (!w) return false;
      const gaps = [...(w.opening && !(ignoreOpening && p === e.plan) ? [{ from: w.opening.from, to: w.opening.to, bottom: 0, top: w.opening.height }] : []), ...(w.windows ?? [])];
      if (gaps.some(g => g.from < to + .15 && g.to > from - .15 && lo + g.bottom < y1 && lo + g.top > y0)) return false;
      if (p === e.plan && y1 > storeyHeight + .2 && p.floor === top) return false;
    }
    return true;
  };
  const mount = (e: Exterior, id: string, key: string, along: number, y0: number, outward = .21, ignoreOpening = false) => {
    const a = assets.get(id); if (!a) return false;
    const { min, max } = a.boundsM, width = max[0] - min[0], height = max[1] - min[1];
    if (!free(e, along - width / 2, along + width / 2, y0, y0 + height, ignoreOpening)) return false;
    const yaw = Math.atan2(e.nx, e.nz), c = Math.cos(yaw), s = Math.sin(yaw), mx = (min[0] + max[0]) / 2;
    // The part's back (z = min) meets the wall's outer face (thickness/2 + outward from the centre line).
    const cx = e.wall.a[0] + e.dx * along + e.nx * (outward - min[2]), cz = e.wall.a[1] + e.dz * along + e.nz * (outward - min[2]);
    put(id, `${e.index}:${key}`, e.plan.floor, cx - mx * c, e.plan.y + y0 - min[1], cz + mx * s, yaw);
    return true;
  };
  let walls = 0, eaves = 0, fins = 0, yardDoors = 0;
  for (const e of exterior) {
    const w = e.wall, door = w.opening && e.plan.floor === 0 ? w.opening : undefined, entrance = door?.use === 'entrance';
    if (door && (entrance || yardDoors++ < 2)) {
      // Entrance: a lantern each side and the use's door-side part.
      mount(e, 'BUILT-054', 'lantern-a', door.from - .55, 1.76); mount(e, 'BUILT-054', 'lantern-b', door.to + .55, 1.76);
      const side = FACADE_DOOR_SIDE[building.kind]; if (side) { const a = assets.get(side); if (a) { const half = (a.boundsM.max[0] - a.boundsM.min[0]) / 2, y0 = side === 'BUILT-116' ? .5 : 0;
        // Beside the door: on its own wall if there is room, else on the nearest wall of the same facade line, at its end nearest the door.
        if (!mount(e, side, 'door-side', door.to + 1.2 + half, y0) && !mount(e, side, 'door-side', door.from - 1.2 - half, y0)) {
          const doorX = w.a[0] + e.dx * (door.from + door.to) / 2, doorZ = w.a[1] + e.dz * (door.from + door.to) / 2, offset = doorX * e.nx + doorZ * e.nz;
          const line = exterior.filter(o => o.plan === e.plan && o !== e && Math.abs(o.nx - e.nx) < 1e-6 && Math.abs(o.nz - e.nz) < 1e-6 && Math.abs(o.wall.a[0] * o.nx + o.wall.a[1] * o.nz - offset) < 1e-6)
            .map(o => { const t = (doorX - o.wall.a[0]) * o.dx + (doorZ - o.wall.a[1]) * o.dz; return { o, t, d: t < 0 ? -t : t > o.length ? t - o.length : 0 }; }).sort((p, q) => p.d - q.d)[0];
          if (line && line.d < 8) mount(line.o, side, 'door-side', line.t <= 0 ? .6 + half : line.o.length - .6 - half, y0);
        } } }
      // A free-standing portico over the entrance (it frames the doorway, which stays open).
      if (entrance && ['hall', 'school', 'police'].includes(building.kind)) mount(e, 'BUILT-108', 'colonnade', (door.from + door.to) / 2, 0, .22, true);
      if (entrance && building.districtId === 'core') mount(e, 'BUILT-241', 'emitter', door.from - 2.2, 0);
    }
    // Storey walls: up to two parts per wall per storey, from the use's list.
    const list = FACADE_WALL[building.kind] ?? [];
    for (let k = 0, placed = 0; list.length && k < 6 && placed < FACADE_LIMITS.wallPerFloor && walls < FACADE_LIMITS.wall; k++) {
      const id = list[(seed + k + e.index) % list.length], along = e.length * (k + .5) / 6;
      if (mount(e, id, `wall:${k}`, along, id === 'BUILT-045' ? .3 : 1.76)) { placed++; walls++; }
    }
    // Wall heads of the top storey: eave brackets and trims every few metres.
    if (e.plan.floor === top) for (let along = 2.6; along < e.length - 2.6 && eaves < FACADE_LIMITS.eave; along += 6.2) {
      const id = FACADE_EAVE[(seed + Math.floor(along)) % FACADE_EAVE.length], a = assets.get(id); if (!a) continue;
      const storey = e.plan.ceilingY - e.plan.y, wallTop = Math.min(storey, w.height);
      if (mount(e, id, `eave:${along}`, along, wallTop - (a.boundsM.max[1] - a.boundsM.min[1]))) eaves++;
    }
    // Tall towers: vertical sun fins across storeys on blank wall strips.
    if (plans.length >= 8 && e.plan.floor === 0 && ['home', 'bank', 'hall'].includes(building.kind))
      for (let along = 1.2; along < e.length - 1.2 && fins < FACADE_LIMITS.fins; along += 2.4) if (mount(e, 'BUILT-219', `fin:${along}`, along, .2)) fins++;
  }
  return out;
}
