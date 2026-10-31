/** Cable cars at three times the old pace (2026-10-23, new cities). Under the old 6 m per game minute,
 * scaled by the power supply (about 0.66), the 瀑云天枢 → 九霄观云 cableway took 6 h 24 m of game time,
 * about six real minutes at 1×: too long to be the ride up the mountain. A declared city's cable cars
 * are created at CABLE_SPEED_METRES (18 m per game minute, as the road buses); nothing else about them
 * changes, and every reader (movement, journey estimates, panels) reads the vehicle's own speed.
 * Old saves and undeclared cities keep their saved speeds. */
export const CABLE_SPEED_POLICY = 'cable-speed-v1' as const;
export type CableSpeedPolicy = typeof CABLE_SPEED_POLICY;
export const CABLE_SPEED_POLICIES: readonly CableSpeedPolicy[] = [CABLE_SPEED_POLICY];
export const CABLE_SPEED_METRES = 18;

export function cableSpeed(policy: CableSpeedPolicy | undefined, legacy: number): number {
  return policy === CABLE_SPEED_POLICY ? CABLE_SPEED_METRES : legacy;
}

export function validateCableSpeedPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'cableSpeedPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'cableSpeedPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !CABLE_SPEED_POLICIES.includes(data.cableSpeedPolicyId)
    || data.runtime.cableSpeedPolicyId !== data.cableSpeedPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：cable speed policy pair。');
}
