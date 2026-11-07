import type { Vec3 } from '../types';

/** Tiny route legs are stepped over (2026-10-29, new cities). A walking route can hold two consecutive points a
 * rounding error apart (2e-15 m); the stair model cannot orient such a leg and reads it as blocked, so the resident
 * waited at it, and a re-plan from the same spot built the same leg again: in audit v9e an official stood still
 * from day 14 onward. In a declared city a leg shorter than TINY_LEG metres is walked at once (the resident takes
 * the leg's end point, which is where they already stand). Old saves and undeclared cities keep the old rule. */
export const TINY_LEG_POLICY = 'tiny-leg-skip-v1' as const;
export type TinyLegPolicy = typeof TINY_LEG_POLICY;
export const TINY_LEG_POLICIES: readonly TinyLegPolicy[] = [TINY_LEG_POLICY];
export const TINY_LEG = 1e-6;

export const tinyLeg = (a: Vec3 | undefined, b: Vec3 | undefined) => !!a && !!b && Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < TINY_LEG;

export function validateTinyLegPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'tinyLegPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'tinyLegPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !TINY_LEG_POLICIES.includes(data.tinyLegPolicyId)
    || data.runtime.tinyLegPolicyId !== data.tinyLegPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：tiny leg policy pair。');
}
