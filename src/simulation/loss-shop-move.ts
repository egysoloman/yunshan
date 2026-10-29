/** Staff may leave a losing shop (2026-10-29, new cities). Under shop-profit-tax v6 a poor worker may take a
 * funded job elsewhere only when their shop cannot fund a day's wage. In audit v9d 71 of 210 shops were losing
 * money, every one with staff, and 51 of the 99 poor shop staff worked in one: each still had 81–198 in cash, so it
 * could fund a day — and kept promising its staff a few paid minutes. In a declared city a poor worker of a shop
 * that is losing money (profit below zero) may also move, under the same conditions as v6 (no half-day promise
 * for today, a funded offer within 500 m that sold recently). Wages already earned stay payable; nothing else
 * changes. Old saves and undeclared cities keep v6's rule. */
export const LOSS_SHOP_MOVE_POLICY = 'loss-shop-move-v1' as const;
export type LossShopMovePolicy = typeof LOSS_SHOP_MOVE_POLICY;
export const LOSS_SHOP_MOVE_POLICIES: readonly LossShopMovePolicy[] = [LOSS_SHOP_MOVE_POLICY];

export function validateLossShopMovePolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'lossShopMovePolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'lossShopMovePolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !LOSS_SHOP_MOVE_POLICIES.includes(data.lossShopMovePolicyId)
    || data.runtime.lossShopMovePolicyId !== data.lossShopMovePolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：loss shop move policy pair。');
}
