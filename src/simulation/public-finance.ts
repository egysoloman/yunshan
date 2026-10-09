/** Declared new-city fiscal rule. The 14-day product audit (economy audit 4)
 * conserved every coin yet moved 59k from the treasury into shop cash (+29k)
 * and owner wallets (+22k) while 139 residents became poor: the only return
 * path was the policy tax on sales and wages (31k), against 90.6k public
 * payroll and 32k operations. Shops pay their owners a dividend from cash
 * above their working reserve each settlement hour; under this policy the
 * public takes PROFIT_TAX_SHARE of that same distributable amount before the
 * owner receives the rest. Reserves, wages, prices, the mayor's tax rate and
 * every other flow are unchanged; a shop without a living owner keeps its
 * cash as before. */
export const SHOP_PROFIT_TAX_POLICY = 'shop-profit-tax-v1' as const;
export type PublicFinancePolicy = typeof SHOP_PROFIT_TAX_POLICY;
export const PUBLIC_FINANCE_POLICIES: readonly PublicFinancePolicy[] = [SHOP_PROFIT_TAX_POLICY];
export const PROFIT_TAX_SHARE = .5;

/** Splits one distributable amount into the public profit tax and the owner's dividend. */
export function profitTaxSplit(policy: PublicFinancePolicy | undefined, distributable: number): { tax: number; dividend: number } {
  const tax = policy === SHOP_PROFIT_TAX_POLICY ? distributable * PROFIT_TAX_SHARE : 0;
  return { tax, dividend: distributable - tax };
}

/** The envelope and runtime declare the same explicit new-city policy. */
export function validatePublicFinancePolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'publicFinancePolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'publicFinancePolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !PUBLIC_FINANCE_POLICIES.includes(data.publicFinancePolicyId)
    || data.runtime.publicFinancePolicyId !== data.publicFinancePolicyId
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：public finance policy pair。');
}

/** Under the same declared policy, the council balances the public budget
 * while the player does not hold the mayor's office and no passed policy is
 * pending: once a day it raises the business tax rate by the share of the
 * (smoothed) shortfall in the (smoothed) taxed turnover, at most five points a
 * day and never above the legal 30%; once the treasury is back above its
 * founding 80,000 it lowers the rate on a surplus, never below the founding
 * 8%. The 14-day audit with only the profit tax still lost about 4,100 a day. */
export const COUNCIL_TAX_FLOOR = .08;
export const COUNCIL_TAX_CEILING = .3;
export const COUNCIL_TREASURY_TARGET = 80000;
export interface FiscalDay { day: number; treasury: number; tax: number; net: number; base: number }

export function councilTaxRate(rate: number, net: number, base: number, treasury: number): number {
  if (!(base > 0)) return rate;
  const next = net < 0 ? Math.min(COUNCIL_TAX_CEILING, rate + Math.min(.05, -net / base))
    : treasury > COUNCIL_TREASURY_TARGET && net > 0 ? Math.max(COUNCIL_TAX_FLOOR, rate - Math.min(.02, net / base)) : rate;
  return Math.round(next * 1000) / 1000;
}

/** Closes one fiscal day: the smoothed net public balance and taxed turnover. */
export function closeFiscalDay(day: FiscalDay, rate: number, treasury: number): { net: number; base: number } {
  const net = treasury - day.treasury, base = rate > 0 ? day.tax / rate : 0;
  return day.base > 0 ? { net: (day.net + net) / 2, base: (day.base + base) / 2 } : { net, base };
}
