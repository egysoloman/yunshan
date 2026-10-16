import type { Citizen, SimState, Vec3 } from './types';

/** A resident becomes "nearby" within MEET_RADIUS of the player; once met, they
 * stay the conversation target while within TALK_RADIUS, the simulation's own
 * reach for talking (a passer-by keeps walking and would otherwise slip out of
 * the panel within seconds). Residents in the statistical tier or no longer
 * alive are never targets. */
export const MEET_RADIUS = 8, TALK_RADIUS = 24;
const spatial = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function nearbyResident(state: SimState, position: Vec3, keepId?: string | null): Citizen | null {
  const reachable = (c: Citizen) => c.tier !== 'statistical' && c.state !== 'dead' && state.extension?.actorProfiles[c.id]?.alive !== false;
  const kept = keepId ? state.citizens.find(c => c.id === keepId) : undefined;
  if (kept && reachable(kept) && spatial(position, kept.position) <= TALK_RADIUS) return kept;
  return state.citizens.filter(c => reachable(c) && spatial(position, c.position) < MEET_RADIUS).sort((a, b) => spatial(position, a.position) - spatial(position, b.position))[0] ?? null;
}
