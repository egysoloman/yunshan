import type { SimState } from '../types';

export interface ActivityCapacityWitness {
  id: string; kind: 'education' | 'research'; actorId: string; siteId: string;
  startedAt: number; endedAt: number; workedMinutes: number;
  sector?: string; level?: number; budget?: number;
}
export interface ActorActivityClaim { id: string; actorId: string; startedAt: number; endedAt: number; workedMinutes: number }
/** Release/deadline envelopes are genuine necessary-time bounds, not a
 * reconstruction of unrecorded exact historical occupied subintervals. */
export function collectActorActivityClaims(state: SimState): ActorActivityClaim[] {
  const result: ActorActivityClaim[] = [], seen = new Map<string, ActorActivityClaim>();
  const now = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
  const add = (claim: ActorActivityClaim): void => {
    const old = seen.get(claim.id);
    if (old) {
      if (old.actorId !== claim.actorId || old.startedAt !== claim.startedAt || old.endedAt !== claim.endedAt || Math.abs(old.workedMinutes - claim.workedMinutes) > 1e-7)
        throw new Error('共同劳动记录重复但不一致。');
      return;
    }
    seen.set(claim.id, claim); result.push(claim);
  };
  for (const course of [...(state.education?.history ?? []), ...(state.education?.course ? [state.education.course] : [])])
    add({ id: 'education:' + course.id, actorId: course.actorId, startedAt: course.startedAt, endedAt: course.completedAt ?? course.cancelledAt ?? now, workedMinutes: course.workedMinutes });
  for (const course of [...(state.familyEducation?.pages.flat() ?? []), ...(state.familyEducation?.active ?? [])])
    add({ id: 'family-education:' + course.id, actorId: course.actorId, startedAt: course.startedAt, endedAt: course.completedAt ?? course.cancelledAt ?? now, workedMinutes: course.workedMinutes });
  const jobs = state.extension && Reflect.get(state.extension, 'runtime')?.researchJobs;
  for (const [sector, job] of Object.entries(jobs ?? {}) as [string, { laborVersion?: number; actorId: string; startedAt: number; workedMinutes: number }][])
    if (job.laborVersion === 1) add({ id: 'research:' + sector + ':' + job.startedAt, actorId: job.actorId, startedAt: job.startedAt, endedAt: now, workedMinutes: job.workedMinutes });
  if (state.power) {
    for (const witness of state.power.capacityHistory) add(witness);
    for (const job of state.power.repairs) for (const [actorId, credit] of Object.entries(job.contributions))
      add({ id: 'power:' + job.id + ':' + actorId, actorId, startedAt: credit.startedAt, endedAt: credit.endedAt, workedMinutes: credit.workedMinutes });
  }
  if (state.roadworks) {
    // Roadworks retains exact contiguous/coalesced paid intervals. An aggregate
    // contribution envelope would hide gaps and admit another job overlapping a
    // later receipt. Its separate module validator still checks all totals.
    for (const job of state.roadworks.jobs) for (const [index, receipt] of job.laborReceipts.entries())
      add({ id: 'roadworks:' + job.id + ':' + receipt.actorId + ':' + index, actorId: receipt.actorId,
        startedAt: receipt.startAt, endedAt: receipt.endAt, workedMinutes: receipt.minutes });
  }
  if (state.hygiene) {
    for (const witness of state.hygiene.capacityHistory) add(witness);
    for (const job of state.hygiene.jobs) for (const [actorId, period] of Object.entries(job.staffWindows))
      add({ id: 'hygiene:' + job.id + ':' + actorId, actorId, startedAt: period.startedAt, endedAt: period.endedAt, workedMinutes: period.workedMinutes });
  }
  return result;
}
export function validateJointActorActivityCapacity(state: SimState): void {
  const now = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
  const actors = new Map<string, ActorActivityClaim[]>();
  for (const claim of collectActorActivityClaims(state)) {
    if (!Number.isFinite(claim.startedAt) || !Number.isFinite(claim.endedAt) || !Number.isFinite(claim.workedMinutes)
      || claim.startedAt < 0 || claim.startedAt > claim.endedAt || claim.endedAt > now || claim.workedMinutes < 0 || claim.workedMinutes > claim.endedAt - claim.startedAt + 1e-7)
      throw new Error('共同劳动起点、终点或分钟无效。');
    const list = actors.get(claim.actorId) ?? []; list.push(claim); actors.set(claim.actorId, list);
  }
  // Necessary demand-bound test for every recorded release/deadline window.
  // A late save clock cannot make two completed 60-minute envelopes overlap.
  for (const list of actors.values()) {
    const deadlines = [...list].sort((a,b) => a.endedAt - b.endedAt);
    for (const start of new Set(list.map(item => item.startedAt))) {
      let worked = 0;
      for (const claim of deadlines) {
        if (claim.startedAt < start) continue;
        worked += claim.workedMinutes;
        if (worked > claim.endedAt - start + 1e-7) throw new Error('同一人物课程、科研、维修与卫生共同期限窗口分钟超过真实容量。');
      }
    }
  }
}
