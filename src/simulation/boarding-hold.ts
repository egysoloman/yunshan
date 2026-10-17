/** Transit boarding hold (2026-10-17, new cities). A vehicle stopped to board at
 * a stop holds its departure once, for up to BOARDING_HOLD_MINUTES, while the
 * player is on foot within BOARDING_HOLD_METRES of it: at 1× a road vehicle's
 * 8-minute stop is 8 real seconds, and a player walking up often saw it leave.
 * Only stops (not red lights or driven vehicles) hold; the hold ends when the
 * vehicle moves off. Old saves and undeclared cities keep their departures. */
export const PLAYER_BOARDING_HOLD_POLICY = 'player-boarding-hold-v1' as const;
export type BoardingHoldPolicy = typeof PLAYER_BOARDING_HOLD_POLICY;
export const BOARDING_HOLD_POLICIES: readonly BoardingHoldPolicy[] = [PLAYER_BOARDING_HOLD_POLICY];
export const BOARDING_HOLD_METRES = 20, BOARDING_HOLD_MINUTES = 6;

export const holdsForPlayer = (policy: BoardingHoldPolicy | undefined) => policy === PLAYER_BOARDING_HOLD_POLICY;

export function validateBoardingHoldPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'boardingHoldPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'boardingHoldPolicyId');
  if (!envelope && !runtime) { if (data.runtime && Object.hasOwn(data.runtime, 'boardingHolds')) throw new Error('无效存档字段：boarding holds without policy。'); return; }
  if (!envelope || !runtime || !BOARDING_HOLD_POLICIES.includes(data.boardingHoldPolicyId)
    || data.runtime.boardingHoldPolicyId !== data.boardingHoldPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：boarding hold policy pair。');
  const holds = data.runtime.boardingHolds;
  if (holds !== undefined && (!holds || typeof holds !== 'object' || Array.isArray(holds) || Object.values(holds).some(v => v !== true))) throw new Error('无效存档字段：boarding holds。');
}
