import type { NetworkEdge, Vehicle, WorldDefinition } from '../types';

export const DEMAND_FOOD_FREIGHT_POLICY = 'demand-food-freight-v1' as const;
export type FoodFreightPolicy = typeof DEMAND_FOOD_FREIGHT_POLICY;

/** Markets buy freight only while below this stock (Simulation shop batch). */
export const MARKET_FREIGHT_INTAKE_LIMIT = 36;

/** Declared new-city rule. The 14-day product audit with the staffed farm
 * yield measured 4,738 freight units waiting unclaimed in river and 2,972 in
 * workshop, where markets already held stock, while every market in the
 * market, east, summit and west districts was empty: an unrouted carrier
 * unloaded at the very next junction it reached. A declared carrier holding
 * food now keeps a destination district (the reachable district whose markets
 * hold the least food per market, counting waiting freight and cargo already
 * bound there), turns at each junction onto the open leg nearest that district,
 * and unloads only on arrival. Speeds, capacities, prices, payments, opening
 * hours and every passenger rule are unchanged; with no district short of
 * food the carrier unloads where it stands, as before. */
export interface FreightDemand { districtId: string; markets: number; stock: number }

/** The envelope and runtime declare the same explicit new-city policy. */
export function validateFoodFreightPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'foodFreightPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'foodFreightPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || data.foodFreightPolicyId !== DEMAND_FOOD_FREIGHT_POLICY
    || data.runtime.foodFreightPolicyId !== DEMAND_FOOD_FREIGHT_POLICY
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：food freight policy pair。');
}

/** Hop counts to the nearest node of each district over one vehicle mode,
 * ignoring closures (the live departure list already excludes closed legs). */
export class FreightHops {
  private readonly cache = new Map<string, Map<string, number>>();
  private readonly byMode = new Map<string, NetworkEdge[]>();
  constructor(private readonly world: WorldDefinition) {
    for (const edge of world.edges) { const list = this.byMode.get(edge.mode) ?? []; list.push(edge); this.byMode.set(edge.mode, list); }
  }
  hops(mode: Vehicle['kind'], districtId: string): Map<string, number> {
    const key = `${mode}>${districtId}`, cached = this.cache.get(key); if (cached) return cached;
    const adjacent = new Map<string, string[]>();
    for (const edge of this.byMode.get(mode) ?? []) {
      (adjacent.get(edge.from) ?? adjacent.set(edge.from, []).get(edge.from)!).push(edge.to);
      (adjacent.get(edge.to) ?? adjacent.set(edge.to, []).get(edge.to)!).push(edge.from);
    }
    const result = new Map<string, number>(), queue: string[] = [];
    for (const node of this.world.nodes) if (node.districtId === districtId && adjacent.has(node.id)) { result.set(node.id, 0); queue.push(node.id); }
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head], next = result.get(id)! + 1;
      for (const neighbour of adjacent.get(id) ?? []) if (!result.has(neighbour)) { result.set(neighbour, next); queue.push(neighbour); }
    }
    this.cache.set(key, result);
    return result;
  }
}

/** The reachable district with the least food per market below the intake
 * limit; ties go to the lower district id. Null when no district is short. */
export function chooseFreightDestination(hops: FreightHops, mode: Vehicle['kind'], nodeId: string, demand: readonly FreightDemand[]): string | null {
  let best: { id: string; perMarket: number } | null = null;
  for (const row of demand) {
    if (row.markets <= 0) continue;
    const perMarket = row.stock / row.markets;
    if (perMarket >= MARKET_FREIGHT_INTAKE_LIMIT || !hops.hops(mode, row.districtId).has(nodeId)) continue;
    if (!best || perMarket < best.perMarket || perMarket === best.perMarket && row.districtId < best.id) best = { id: row.districtId, perMarket };
  }
  return best?.id ?? null;
}
