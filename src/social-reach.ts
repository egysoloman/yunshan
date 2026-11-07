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

/** E greets a resident within GREET_REACH (main.ts interact) when the panel shows them, or when no tab says
 * otherwise and no door is within the door's own reach (a door within reach is used first). Never while the
 * place tab is shown (2026-10-22: beside a resident the panel still showed "进入 / 使用建筑 · E" and E greeted;
 * the panel now opens the resident's tab once, as it does for a stopped vehicle). Unity: ContextLayout.EGreetsResident. */
export const GREET_REACH = 6, DOOR_REACH = 6;
export function eGreetsResident(player: Vec3, resident: Vec3 | null | undefined, door: Vec3 | null | undefined, shown: string | null): boolean {
  if (!resident || shown === 'building' || spatial(player, resident) >= GREET_REACH) return false;
  return shown === 'citizen' || !door || Math.hypot(door.x - player.x, door.z - player.z) > DOOR_REACH;
}
