export const CONTINUOUS_REFERENCE_COLLISION_POLICY = 'continuous-upright-v1' as const;
export type ReferenceCollisionPolicy = typeof CONTINUOUS_REFERENCE_COLLISION_POLICY;

/** This policy has no actor body/cursor: it selects only the ordinary reference
 * segment predicate. Both copies are required; old envelopes lacking both
 * copies retain their original collision behavior when loaded by a new host. */
export function validateReferenceCollisionPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'referenceCollisionPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'referenceCollisionPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || data.referenceCollisionPolicyId !== CONTINUOUS_REFERENCE_COLLISION_POLICY
    || data.runtime.referenceCollisionPolicyId !== CONTINUOUS_REFERENCE_COLLISION_POLICY
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：reference collision policy pair。');
}
