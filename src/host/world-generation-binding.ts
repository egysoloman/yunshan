import { getBuildingBody, getFloorPlanRoofRegions, getFloorPlanSlabRegions, wallPanels } from '../architecture-floor-plan';
import { getAviationPads } from '../aviation';
import { guardrailSpans } from '../transport-geometry';
import { savedWorldFingerprint } from '../persistence/world-layout';
import type { WorldDefinition } from '../types';

/** Code-owned World inputs and the public physical descriptors used by this
 * source revision. Pure cache priming creates no actor, funds, work or clock.
 *
 * Body includes floor membership, interiors/circulation/courtyard, stair holes,
 * landings/treads and their Rects, fixtures, walls/openings, permissions and use
 * points. Wall panels, slab regions and roof regions have separate publicly
 * mutable caches, so their actual returned values must be bound as well.
 * Private near-plan/stair-surface/local-solid/support-footprint caches consume
 * those descriptors and do not expose mutable arrays; a new World/Building
 * identity rebuilds them. There is no public ramp/self-solid getter in this
 * source contract. New authority getters require extending this descriptor.
 *
 * Rail spans are returned copies (or bound edge point references); landing pads
 * are a separate publicly mutable World cache and must be bound explicitly.
 * Terrain/spatial buckets are private, derive from definition inputs, and are
 * rebuilt by the new World identity. This does not hash renderer/GPU resources.
 */
export function generationWorldText(world: WorldDefinition): string {
  return JSON.stringify({ definition: world, baseWorldFingerprint: savedWorldFingerprint(world),
    physicalBodies: world.buildings.map(site => {
      const body = getBuildingBody(site);
      return [site.id, body, body ? getFloorPlanRoofRegions(body) : null,
        body ? body.floorPlans.map(plan => [plan.floor, wallPanels(plan), getFloorPlanSlabRegions(plan)]) : null];
    }),
    aviationPads: getAviationPads(world),
    guardrailSpans: world.edges.map(edge => [edge.id, edge.points.slice(1).map((_point, index) => guardrailSpans(world, edge, index + 1))]),
  });
}
