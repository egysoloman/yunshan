import type { SimState } from '../types';

interface ActivityHost { state: SimState }
interface Allocation { state: SimState; tick: number; actors: Map<string, { used: number; activities: Set<string> }> }
const allocations = new WeakMap<ActivityHost, Allocation>();
function allocation(host: ActivityHost): Allocation {
  let item = allocations.get(host);
  if (!item || item.state !== host.state || item.tick !== host.state.tick) {
    item = { state: host.state, tick: host.state.tick, actors: new Map() }; allocations.set(host, item);
  }
  return item;
}
/** Only the current people phase is available. Deferred historical wages are
 * not a new phase budget. State replacement invalidates all transient claims. */
export function actorActivityAvailable(host: ActivityHost, actorId: string, phaseMinutes: number): number {
  return Number.isFinite(phaseMinutes) ? Math.max(0, phaseMinutes - (allocation(host).actors.get(actorId)?.used ?? 0)) : 0;
}
export function claimActorActivityMinutes(host: ActivityHost, actorId: string, activityId: string, requested: number, phaseMinutes: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const item = allocation(host), actor = item.actors.get(actorId) ?? { used: 0, activities: new Set<string>() };
  if (actor.activities.has(activityId)) return 0;
  const minutes = Math.min(requested, actorActivityAvailable(host, actorId, phaseMinutes));
  if (minutes > 0) { actor.used += minutes; actor.activities.add(activityId); item.actors.set(actorId, actor); }
  return minutes;
}
