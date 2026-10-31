import type { SimState, Vec3, WorldDefinition } from './types';

/** Display only (web toast and native host notice): walking, riding or flying into another district
 * says its name once, with how lively it is right now. A district counts as entered inside
 * DISTRICT_ENTER of its radius and left only beyond DISTRICT_LEAVE, so its edge never flickers. */
export const DISTRICT_ENTER = .8, DISTRICT_LEAVE = 1;
export interface DistrictSeen { id: string | null }

/** The district whose centre is nearest relative to its radius, if the point is within `within` radii of it. */
export function districtAt(world: Pick<WorldDefinition, 'districts'>, position: Vec3, within: number): string | null {
  let best: string | null = null, bestRatio = within;
  for (const d of world.districts) {
    const ratio = Math.hypot(position.x - d.center.x, position.z - d.center.z) / d.radius;
    if (ratio < bestRatio) { best = d.id; bestRatio = ratio; }
  }
  return best;
}

export function freshDistrictArrival(state: SimState, world: Pick<WorldDefinition, 'districts'>, position: Vec3, seen: DistrictSeen | null): { seen: DistrictSeen; notice: string | null } {
  const held = seen?.id ? world.districts.find(d => d.id === seen.id) : undefined;
  const stays = held && Math.hypot(position.x - held.center.x, position.z - held.center.z) / held.radius < DISTRICT_LEAVE;
  const id = stays ? held.id : districtAt(world, position, DISTRICT_ENTER);
  const next = { id };
  // The first reading is a baseline: the arrival itself is the welcome card's news.
  if (!seen || !id || id === seen.id) return { seen: next, notice: null };
  const district = world.districts.find(d => d.id === id)!;
  const open = state.shops.filter(s => s.districtId === id && s.open).length, residents = state.districts.find(d => d.id === id)?.residents ?? 0;
  return { seen: next, notice: `来到${district.name}：${residents > 0 ? `住着约 ${Math.round(residents)} 人，` : ''}${open > 0 ? `此刻 ${open} 家店开着。` : '此刻店铺都已打烊。'}` };
}
