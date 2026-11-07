/** Road repair crews chosen by the whole trip (2026-10-30, new cities). A road repair worker walks from where
 * they are to a materials counter, then carries the material to the worksite; the worker and supplier were
 * chosen by the first leg alone. When the city's storm closed the market dock bridge, the pair chosen stood
 * together at the airport, 1.6 km from the site, and the carry took a 4.3 km route: the order took 36 hours,
 * three residents carrying the same material in turn as each left for food and sleep. In a declared city the
 * pair is chosen by both legs, worker to counter plus the counter's nearest node to the worksite along the
 * open walking network. Wages, prices, budgets, who may work and walking speed are unchanged. */
export const REPAIR_ROUTE_POLICY = 'repair-route-v1' as const;
export type RepairRoutePolicy = typeof REPAIR_ROUTE_POLICY;
export const REPAIR_ROUTE_POLICIES: readonly RepairRoutePolicy[] = [REPAIR_ROUTE_POLICY];

export function validateRepairRoutePolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'repairRoutePolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'repairRoutePolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !REPAIR_ROUTE_POLICIES.includes(data.repairRoutePolicyId)
    || data.runtime.repairRoutePolicyId !== data.repairRoutePolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：repair route policy pair。');
}
