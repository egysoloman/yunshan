import type { WorldDefinition } from '../types';

/** Display only (2026-10-22, after the reference overview's floating 「松风里」「青铜工坊」 tags): while the
 * player flies (drone or jet), each district's name hangs as a vertical cloth tag of constant screen size DISTRICT_TAG.lift
 * above the district's tallest roof at its centre. Hidden on foot and within DISTRICT_TAG.near of the
 * camera, where the street banners (district-banners.ts) take over. Shared with Unity (Core/DistrictTags.cs). */
/** `screen` is the tag's height as a share of the view's height, the same at any distance; it is 1:3 wide to tall. */
export const DISTRICT_TAG = { lift: 50, near: 220, screen: .16 } as const;
export interface DistrictTag { districtId: string; text: string; position: { x: number; y: number; z: number } }

export function districtTags(world: Pick<WorldDefinition, 'districts' | 'buildings'>): DistrictTag[] {
  return world.districts.map(d => {
    let top = d.center.y;
    for (const b of world.buildings) if (b.districtId === d.id) top = Math.max(top, b.position.y + .6 + b.height);
    return { districtId: d.id, text: d.name, position: { x: d.center.x, y: top + DISTRICT_TAG.lift, z: d.center.z } };
  });
}

export function districtTagShown(flying: boolean, tag: DistrictTag, camera: { x: number; y: number; z: number }): boolean {
  return flying && Math.hypot(tag.position.x - camera.x, tag.position.y - camera.y, tag.position.z - camera.z) > DISTRICT_TAG.near;
}
