import type { Building } from '../types';
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
export function layoutStudioFixture(fixture: FloorFixture, floor: number, floorY: number, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioPropPlacement[] | null {
  const dressing = STUDIO_FIXTURE_DRESSING[fixture.kind], asset = dressing && assets.get(dressing.asset);
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
export function studioDressesFixture(fixture: FloorFixture, assets: ReadonlyMap<string, StudioAsset> = assetById): boolean {
  return layoutStudioFixture(fixture, 0, 0, assets) !== null;
}

/** Every studio placement of a building's floor-plan fixtures. */
export function studioBuildingPlacements(building: Building, assets: ReadonlyMap<string, StudioAsset> = assetById): StudioPropPlacement[] {
  const body = getBuildingBody(building); if (!body) return [];
  return body.floorPlans.flatMap(plan => getFloorPlanFixtures(building, plan).flatMap(fixture => layoutStudioFixture(fixture, plan.floor, plan.y, assets) ?? []));
}
