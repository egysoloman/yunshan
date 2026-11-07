/** Declared new-city motion resolution (user direction 2026-10-10: the
 * simulation need not run at full precision). Inside floor-plan buildings an
 * actor's physical leg was validated, and then walked, in .05m samples, each
 * with a support pose, a segment check and a swept wall/fixture test; this
 * was the largest share of a tick. Under this policy both use COARSE_STEP
 * while the city holds no voxel (a .2m cube could otherwise fall between two
 * samples). Wall, fixture, road and segment tests stay swept over each whole
 * step, every step still ends at each part boundary (riser, tread, landing),
 * and speed, route and timing are unchanged; only a support gap narrower than
 * a step can go unsampled. */
export const NPC_MOTION_COARSE_POLICY = 'npc-motion-coarse-v1' as const;
export type NpcMotionPolicy = typeof NPC_MOTION_COARSE_POLICY;
export const NPC_MOTION_POLICIES: readonly NpcMotionPolicy[] = [NPC_MOTION_COARSE_POLICY];
export const FINE_STEP = .05;
export const COARSE_STEP = .25;

export function physicalStep(policy: NpcMotionPolicy | undefined, voxels: number): number {
  return policy === NPC_MOTION_COARSE_POLICY && voxels === 0 ? COARSE_STEP : FINE_STEP;
}

/** The envelope and runtime declare the same explicit new-city policy. */
export function validateNpcMotionPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'npcMotionPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'npcMotionPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !NPC_MOTION_POLICIES.includes(data.npcMotionPolicyId)
    || data.runtime.npcMotionPolicyId !== data.npcMotionPolicyId
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：npc motion policy pair。');
}
