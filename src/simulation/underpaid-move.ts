/** Underpaid staff may move (2026-10-29, new cities). After company dividends, student dorms and loss-shop-move,
 * 61 of the 100 poor shop staff in audit v9g worked in shops that were not losing money but were overstaffed: a
 * median of 8 staff on half the revenue of the shops whose staff were not poor (1,162 vs 2,452), so the owner's
 * funded shift review left most of them with no paid minutes (43 of 61 had none promised). In a declared city a
 * poor worker (cash < 120) who by UNDERPAID_HOUR still has no half-day promise for today may take a funded job
 * elsewhere on v6's terms (a shop within 500 m that can fund a day and sold recently), whatever their own shop's
 * books. Wages already earned stay payable. Old saves and undeclared cities keep the earlier rules. */
export const UNDERPAID_MOVE_POLICY = 'underpaid-move-v1' as const;
export type UnderpaidMovePolicy = typeof UNDERPAID_MOVE_POLICY;
export const UNDERPAID_MOVE_POLICIES: readonly UnderpaidMovePolicy[] = [UNDERPAID_MOVE_POLICY];
/** The owner's morning review has had time to happen by then. */
export const UNDERPAID_HOUR = 11;

export function validateUnderpaidMovePolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'underpaidMovePolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'underpaidMovePolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !UNDERPAID_MOVE_POLICIES.includes(data.underpaidMovePolicyId)
    || data.runtime.underpaidMovePolicyId !== data.underpaidMovePolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：underpaid move policy pair。');
}
