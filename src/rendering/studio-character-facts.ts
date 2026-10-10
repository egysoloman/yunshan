import type { Citizen, SimState } from '../types';

/** The simulation facts a studio character shows (read only): health, a
 * carried pregnancy, an active wedding or funeral the resident attends, and
 * an own child under two beside them. Shared by the web pool and the native
 * host frame (the Unity client receives them per resident). */
export function characterFacts(state: SimState, c: Citizen): { health?: number; pregnant: boolean; ceremony: 'wedding' | 'funeral' | null; infantNearby: boolean } {
  const profile = state.extension?.actorProfiles[c.id];
  const active = (state.family?.ceremonies ?? []).find(x => x.completedAt === null && (x.organizerId === c.id || x.guestIds.includes(c.id) || x.kind === 'wedding' && x.subjectId === c.id));
  return {
    health: profile?.health,
    pregnant: (state.family?.pregnancies ?? []).some(p => p.carrierId === c.id),
    ceremony: active?.kind ?? null,
    infantNearby: Object.entries(state.family?.children ?? {}).some(([childId, child]) => child.parentIds.includes(c.id) && (state.extension?.actorProfiles[childId]?.age ?? 9) < 2
      && state.citizens.some(x => x.id === childId && Math.hypot(x.position.x - c.position.x, x.position.y - c.position.y, x.position.z - c.position.z) < 2)),
  };
}
