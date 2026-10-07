import type { WorldDefinition } from './types';
import { CURVED_ROOF_PROFILE_REVISION } from './geometry/roof-profile';

/** This trusted current-v8 recipe extends preserved v6. It does not declare a new floor
 * plan, district, actor, door, street, furniture or business authority. Its
 * exposed gable solids are generated later from the unchanged rectangular
 * floor-plan cover, with the explicit revision bound into the fingerprint.
 * The five modern commercial towers retain their existing crown in this slice;
 * landmark/pavilion keep the historical renderer and physical policy. */
export const REFERENCE_CURVED_ROOF_RECIPE_VERSION = 'reference-city-curved-roofs-v8-1' as const;

export function applyReferenceCurvedRoofs(world: WorldDefinition): string[] {
  const selected = world.buildings.filter(site => site.floorPlanProfile === 'v4-program-bodies-02'
    && site.id !== 'core-main' && site.kind !== 'pavilion' && site.commercialGeometryRevision !== 1);
  for (const site of selected) site.roofGeometryRevision = CURVED_ROOF_PROFILE_REVISION;
  return selected.map(site => site.id);
}
