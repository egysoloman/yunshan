import type { Building, WorldDefinition } from '../types';

/** Display-only district banners (2026-10-18, after the reference town's 「临岚坊」「云工坊」
 * hangings): a tall cloth with the district's name, bracketed BANNER.out off the entrance facade of
 * the few tallest-enough buildings nearest each district's centre, near a corner of that facade.
 * Its lower edge is at BANNER.bottom, above head height, so no walk, route or collision changes.
 * Shared with Unity (Core/DistrictBanners.cs, parity fixture). */
export const BANNER = { width: 1.4, height: 6, bottom: 4.6, out: .6, inset: 2.5, perDistrict: 6 } as const;
export const BANNER_SKIP: readonly Building['kind'][] = ['pavilion', 'core'];
export interface DistrictBanner { districtId: string; buildingId: string; text: string; position: { x: number; y: number; z: number }; yaw: number }

export function districtBanners(world: Pick<WorldDefinition, 'districts' | 'buildings'>): DistrictBanner[] {
  const out: DistrictBanner[] = [];
  for (const district of world.districts) {
    const centre = district.center;
    // The two legacy-geometry kinds (summit pavilions, the 天枢 core) have deep eaves over their faces; banners go on floor-plan buildings.
    const fits = (b: Building) => b.districtId === district.id && !BANNER_SKIP.includes(b.kind) && b.height >= BANNER.bottom + BANNER.height + 1 && b.width >= BANNER.inset * 2 + BANNER.width * 2;
    const chosen = world.buildings.filter(fits)
      .map(b => ({ b, d: Math.hypot(b.position.x - centre.x, b.position.z - centre.z) }))
      .sort((p, q) => p.d - q.d || (p.b.id < q.b.id ? -1 : p.b.id > q.b.id ? 1 : 0)).slice(0, BANNER.perDistrict);
    chosen.forEach(({ b }, i) => {
      // Building-local frame (architecture-floor-plan buildingWorldPosition): the entrance is at local +z = depth / 2.
      const lx = (i % 2 ? 1 : -1) * (b.width / 2 - BANNER.inset - BANNER.width / 2), lz = b.depth / 2 + BANNER.out, c = Math.cos(b.rotation), s = Math.sin(b.rotation);
      out.push({ districtId: district.id, buildingId: b.id, text: district.name, yaw: b.rotation,
        position: { x: b.position.x + lx * c + lz * s, y: b.position.y + .6 + BANNER.bottom + BANNER.height / 2, z: b.position.z - lx * s + lz * c } });
    });
  }
  return out;
}
