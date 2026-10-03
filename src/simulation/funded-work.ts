import type { SimState } from '../types';
import { actorActivityAvailable, claimActorActivityMinutes, reassignActorActivityMinutes } from './activity-minutes';
interface Host { state: SimState }
export interface FundedWorkInterval { startAt: number; endAt: number }
interface Pool { state: SimState; tick: number; used: Map<string, FundedWorkInterval[]> }
const pools = new WeakMap<Host, Pool>();
function pool(host: Host): Pool { let p = pools.get(host); if (!p || p.state !== host.state || p.tick !== host.state.tick) { p = { state: host.state, tick: host.state.tick, used: new Map() }; pools.set(host, p); } return p; }
/** Consume the actual funded interval once across repair and research. The
 * native paid-work claim can be apportioned to repair without a second wage
 * or freeing its already-reserved overall activity budget. */
export function claimFundedActorWork(host: Host, actorId: string, activityId: string, offered: FundedWorkInterval[], requested: number, phaseMinutes: number, paidWorkClaim?: string): { minutes: number; intervals: FundedWorkInterval[] } {
  const p = pool(host), prior = p.used.get(actorId) ?? [], merged: FundedWorkInterval[] = [];
  for (const row of offered.filter(row => Number.isFinite(row.startAt) && Number.isFinite(row.endAt) && row.endAt > row.startAt).sort((a,b) => a.startAt - b.startAt)) {
    const last = merged.at(-1); if (last && row.startAt <= last.endAt) last.endAt = Math.max(last.endAt, row.endAt); else merged.push({ ...row });
  }
  let ranges = merged;
  for (const used of prior) ranges = ranges.flatMap(row => row.endAt <= used.startAt || row.startAt >= used.endAt ? [row] : [
    ...(row.startAt < used.startAt ? [{ startAt: row.startAt, endAt: used.startAt }] : []),
    ...(row.endAt > used.endAt ? [{ startAt: used.endAt, endAt: row.endAt }] : []),
  ]);
  const available = Math.min(requested, ranges.reduce((sum,row) => sum + row.endAt - row.startAt, 0));
  const credited = paidWorkClaim ? reassignActorActivityMinutes(host, actorId, paidWorkClaim, activityId, available) : claimActorActivityMinutes(host, actorId, activityId, Math.min(available, actorActivityAvailable(host, actorId, phaseMinutes)), phaseMinutes);
  const intervals: FundedWorkInterval[] = []; let left = credited;
  for (const row of ranges) { const amount = Math.min(left, row.endAt - row.startAt); if (amount > 0) intervals.push({ startAt: row.startAt, endAt: row.startAt + amount }); left -= amount; if (left <= 0) break; }
  if (credited > 0) { prior.push(...intervals); p.used.set(actorId, prior); }
  return { minutes: credited, intervals };
}
