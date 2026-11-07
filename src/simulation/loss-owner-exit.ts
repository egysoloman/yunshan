/** Poor owners of losing one-person shops may take paid work (2026-10-30, new cities). On day 14 of audit v9j, 44
 * of the 94 residents under 120 coins owned a shop; their shops lost money (median profit −118, revenue 346 against
 * 935 at the other shops), all 210 shops stayed open, and an owner may leave only as far as the existing economic
 * suspension, which needs a loss of 600 with no stock left. Owners earn only their shop's dividend, so they stayed
 * poor. In a declared city a poor owner (the same wallet ceiling as staff moves) whose shop is losing money and has
 * no other staff may take a funded job at another shop under the ordinary staff-move rule. The shop stays open,
 * stocked and theirs (its sales, dividends and rights are unchanged); only where they work changes. */
export const LOSS_OWNER_EXIT_POLICY = 'loss-owner-exit-v1' as const;
export type LossOwnerExitPolicy = typeof LOSS_OWNER_EXIT_POLICY;
export const LOSS_OWNER_EXIT_POLICIES: readonly LossOwnerExitPolicy[] = [LOSS_OWNER_EXIT_POLICY];

export function validateLossOwnerExitPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'lossOwnerExitPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'lossOwnerExitPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !LOSS_OWNER_EXIT_POLICIES.includes(data.lossOwnerExitPolicyId)
    || data.runtime.lossOwnerExitPolicyId !== data.lossOwnerExitPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：loss owner exit policy pair。');
}
