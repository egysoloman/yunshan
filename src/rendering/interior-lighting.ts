import type { Building, Vec3 } from '../types';
import { getFloorDimensions } from '../access';
import { buildingWorldPosition, contains, getBuildingFloorPlan, type FloorPlan } from '../architecture-floor-plan';

export const INTERIOR_LIGHT_SLOTS = 2;

export interface InteriorLightConfiguration {
  anchorId: string;
  source: 'program-use-point' | 'preserved-legacy-placement';
  position: Vec3;
  intensity: number;
  distance: number;
  decay: 2;
  color: string;
}

const clamp01 = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const eyeHeight = 1.72;

/** The same inverse-square/cutoff term used by the installed Three point-light
 * shader. These are scene-linear light units, not a calibrated lux forecast. */
export function interiorLightAttenuation(distance: number, cutoff: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(cutoff) || distance < 0 || cutoff <= 0) return 0;
  const edge = Math.max(0, 1 - (distance / cutoff) ** 4);
  return edge * edge / Math.max(distance * distance, .01);
}

/** Only declared windows and door openings affect the task-light dimmer. This
 * is a bounded aperture/proximity estimate; it is not an occlusion or GI solver.
 * Below-ground floors get no inferred sunlight through buried window panels. */
function apertureWeight(plan: FloorPlan, x: number, z: number): number {
  if (plan.floor < 0) return 0;
  let weight = 0;
  for (const wall of plan.walls) {
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (length <= 0) continue;
    const apertures = [...(wall.windows ?? []).map(window => ({ ...window, transmission: .35 })),
      ...(wall.opening ? [{ from: wall.opening.from, to: wall.opening.to, bottom: 0, top: wall.opening.height, transmission: .65 }] : [])];
    for (const aperture of apertures) {
      const t = (aperture.from + aperture.to) / 2 / length;
      const xx = wall.a[0] + (wall.b[0] - wall.a[0]) * t, zz = wall.a[1] + (wall.b[1] - wall.a[1]) * t;
      const area = Math.max(0, aperture.to - aperture.from) * Math.max(0, aperture.top - aperture.bottom);
      weight += aperture.transmission * area / (12 + (xx - x) ** 2 + (zz - z) ** 2);
    }
  }
  return clamp01(weight);
}

function taskProfile(building: Building): { level: number; color: string } {
  if (building.kind === 'home' || building.kind === 'farm') return { level: 1, color: '#ffe4bd' };
  if (building.kind === 'clinic' || building.kind === 'school' || building.kind === 'workshop') return { level: 1.45, color: '#e5edf1' };
  return { level: 1.25, color: '#fff0d9' };
}

/** Read-only view of the occupied floor. It never creates a usable fixture,
 * power supply, window, room, actor or attendance record. The two existing
 * renderer slots cover the nearest real use points, including a third sale bay.
 * Legacy landmarks retain their existing placement until they have a shared
 * program floor plan; they receive the same bounded intensity and power rule. */
export function getInteriorLightConfigurations(building: Building, floor: number, camera: Vec3, daylight: number, power: number): InteriorLightConfiguration[] {
  if (!Number.isInteger(floor) || floor < -(building.basements ?? 0) || floor >= building.floors) return [];
  const plan = getBuildingFloorPlan(building, floor), dimensions = getFloorDimensions(building, floor);
  const floorHeight = plan ? plan.ceilingY - plan.y : building.height / building.floors;
  // Keep the source within the real floor/ceiling and above a standing eye.
  const mountHeight = Math.min(floorHeight - .6, floorHeight * .68);
  if (!Number.isFinite(mountHeight) || mountHeight <= eyeHeight) return [];
  const profile = taskProfile(building), supplied = clamp01(power), sunlight = clamp01(daylight);
  const floorY = plan?.y ?? floor * floorHeight;
  const anchors = plan ? plan.usePoints.filter(point => plan.interior.some(region => contains(region, point.x, point.z))).map(point => ({
    id: point.id, x: point.x, z: point.z, source: 'program-use-point' as const,
    position: buildingWorldPosition(building, { x: point.x, y: floorY + mountHeight, z: point.z }),
  })) : [-1, 1].map((side, i) => ({
    id: `legacy-${i}`, x: side * dimensions.width * .22, z: 0, source: 'preserved-legacy-placement' as const,
    // This is the previous renderer placement, including its unrotated legacy
    // convention. Do not silently reinterpret old landmark room geometry.
    position: { x: building.position.x + side * dimensions.width * .22, y: building.position.y + .6 + floorY + mountHeight, z: building.position.z },
  }));
  anchors.sort((a, b) => Math.hypot(a.position.x - camera.x, a.position.z - camera.z) - Math.hypot(b.position.x - camera.x, b.position.z - camera.z) || a.id.localeCompare(b.id));
  return anchors.slice(0, INTERIOR_LIGHT_SLOTS).map(anchor => {
    const rooms = plan?.interior.filter(region => contains(region, anchor.x, anchor.z));
    const localSpan = rooms?.length ? Math.min(...rooms.map(region => Math.hypot(region.x1 - region.x0, region.z1 - region.z0))) : Math.hypot(dimensions.width, dimensions.depth);
    // A local task light cannot illuminate a whole 144m civic floor or cross
    // an entire court. The original decay exponent stays physically squared.
    const distance = Math.min(14, Math.max(mountHeight * 1.8, Math.min(localSpan, 10)));
    const access = plan ? apertureWeight(plan, anchor.x, anchor.z) : 0;
    const target = profile.level * supplied * (1 - sunlight * access * .55);
    // Calibrate the source at the actual standing eye under it. The old width
    // multiplier yielded hundreds of units here in a small, low-ceiling shop.
    const attenuation = interiorLightAttenuation(mountHeight - eyeHeight, distance);
    const intensity = attenuation > 0 ? Math.min(70, target / attenuation) : 0;
    return { anchorId: anchor.id, source: anchor.source, position: anchor.position, intensity, distance, decay: 2, color: profile.color };
  });
}
