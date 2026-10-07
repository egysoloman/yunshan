import type { Building, BuildingKind } from '../types';
import { getBuildingBody, getFloorPlanFixtures, type FloorFixture } from '../architecture-floor-plan';
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
};
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
  return Array.from({ length: dressing.copies }, (_, copy) => ({
    asset: asset.id, fixtureId: fixture.id, floor, scale,
    local: {
      x: r.x0 + slot * (copy + .5) - scale * (min[0] + max[0]) / 2,
      y: floorY + fixture.bottom - scale * min[1],
      z: centerZ - scale * (min[2] + max[2]) / 2,
    },
  }));
}

/** True when the fixture is shown by a studio asset instead of boxes. */
export function studioDressesFixture(fixture: FloorFixture, buildingKind?: BuildingKind, assets: ReadonlyMap<string, StudioAsset> = assetById): boolean {
  return layoutStudioFixture(fixture, 0, 0, assets, buildingKind) !== null;
}

/** Every studio placement of a building's floor-plan fixtures. */
export function studioBuildingPlacements(building: Building, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioPropPlacement[] {
  const body = getBuildingBody(building); if (!body) return [];
  return body.floorPlans.flatMap(plan => getFloorPlanFixtures(building, plan).flatMap(fixture => layoutStudioFixture(fixture, plan.floor, plan.y, assets, building.kind) ?? []));
}

/** A fixed, world-space studio model (origin = its min corner, yaw about Y). */
export interface StudioStaticPlacement { asset: string; id: string; position: { x: number; y: number; z: number }; yaw: number }

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
