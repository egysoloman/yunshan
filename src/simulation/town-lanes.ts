import type { NetworkEdge, WorldDefinition } from '../types';
import { isDenseMarketLayout } from '../street-layouts';

/** Pedestrian lantern lanes in the arrival town (2026-10-30, new cities, current-v9). The world's road fleet gives
 * every commercial door link its own cart; in the dense market town that is 38 carts on the lantern lanes in front
 * of the arrival point, which on the first day of a new city carried no passenger (cargo capacity 0) and stood parked
 * or shuttled between door and junction — in views they read as dark boxes on a pedestrian street. In a declared
 * city the market shops of the dense market district get no door cart. Every other vehicle, route, stop and freight
 * carrier is unchanged; residents still walk the same lanes. */
export const TOWN_LANES_POLICY = 'town-lanes-v1' as const;
export type TownLanesPolicy = typeof TOWN_LANES_POLICY;
export const TOWN_LANES_POLICIES: readonly TownLanesPolicy[] = [TOWN_LANES_POLICY];

/** Whether an edge is the door link of a market shop in the dense market town (its cart is left out). */
export function townLaneDoorEdge(world: WorldDefinition, edge: NetworkEdge): boolean {
  if (edge.mode !== 'road' || !isDenseMarketLayout((world as WorldDefinition & { layoutVersion?: string }).layoutVersion)) return false;
  return world.buildings.some(b => b.kind === 'market' && b.districtId === 'market' && (edge.from === `${b.id}-door` || edge.to === `${b.id}-door`));
}

export function validateTownLanesPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'townLanesPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'townLanesPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !TOWN_LANES_POLICIES.includes(data.townLanesPolicyId)
    || data.runtime.townLanesPolicyId !== data.townLanesPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：town lanes policy pair。');
}
