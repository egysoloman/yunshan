/** Optional foreign trade for new cities (user direction 2026-10-10). The
 * city was a closed economy: every coin circulated inside it, workshops sold
 * only to the treasury, and full farm stores stopped production. While trade
 * is enabled, each settlement hour the city's cargo flights carry at most
 * EXPORT_UNITS_PER_HOUR of surplus out at fixed world prices: workshop
 * materials above MATERIAL_EXPORT_LINE and producer food above
 * FOOD_EXPORT_LINE, food only while every market district is at its intake
 * line (a probe exported 883 food units a day while 17 markets were empty). The buyer is outside the city, so the gross is new money;
 * the seller keeps the net and the city taxes it at its business rate. The
 * elected mayor may close or reopen trade; a city without a mayor keeps it open. */
export const FOREIGN_TRADE_POLICY = 'foreign-trade-v1' as const;
export type ForeignTradePolicy = typeof FOREIGN_TRADE_POLICY;
export const FOREIGN_TRADE_POLICIES: readonly ForeignTradePolicy[] = [FOREIGN_TRADE_POLICY];
export const EXPORT_UNITS_PER_HOUR = 60;
export const MATERIAL_EXPORT_LINE = 90;
export const FOOD_EXPORT_LINE = 200;
export const WORLD_MATERIAL_PRICE = 6;
export const WORLD_FOOD_PRICE = 4.5;
export interface ForeignTradeState { enabled: boolean; exportedUnits: number; exportGross: number }
export interface ExportOffer { shopId: string; surplus: number; price: number }

/** Shares the hour's cargo capacity, largest surplus first, in whole units. */
export function allocateExports(offers: ExportOffer[], capacity: number): { shopId: string; quantity: number; price: number }[] {
  const out: { shopId: string; quantity: number; price: number }[] = [];
  let left = Math.max(0, Math.floor(capacity));
  for (const offer of [...offers].sort((a, b) => b.surplus - a.surplus || a.shopId.localeCompare(b.shopId))) {
    const quantity = Math.min(left, Math.floor(offer.surplus)); if (quantity < 1) continue;
    out.push({ shopId: offer.shopId, quantity, price: offer.price }); left -= quantity;
    if (left < 1) break;
  }
  return out;
}

/** The envelope and runtime declare the same explicit new-city policy. */
export function validateForeignTradePolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'foreignTradePolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'foreignTradePolicyId');
  if (!envelope && !runtime) return;
  const t = data.runtime?.foreignTrade;
  if (!envelope || !runtime || !FOREIGN_TRADE_POLICIES.includes(data.foreignTradePolicyId)
    || data.runtime.foreignTradePolicyId !== data.foreignTradePolicyId
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2
    || !t || typeof t !== 'object' || Object.keys(t).sort().join() !== 'enabled,exportGross,exportedUnits' || typeof t.enabled !== 'boolean'
    || !Number.isFinite(t.exportedUnits) || t.exportedUnits < 0 || !Number.isFinite(t.exportGross) || t.exportGross < 0) throw new Error('无效存档字段：foreign trade policy pair。');
}
