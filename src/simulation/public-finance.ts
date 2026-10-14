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
/** v2 (2026-10-11). The 14-day audit still moved 42k from residents into
 * shop cash (+51k): a shop pays no dividend at all while any earned wage is
 * unpaid, and a staffed shop accrues wages all day, so 18.6k of 29.6k shop
 * cash on day 3 was held back by a few coins of payroll. Under v2 the shop
 * pays while wages are owed: the reserve already covers its protected funds
 * (owed and committed payroll), so owners receive only the cash above them. Same 20% profit
 * tax, same reserve, rates, wages and prices. */
export const SHOP_PROFIT_TAX_POLICY_V2 = 'shop-profit-tax-v2' as const;
/** v3 (2026-10-14). v2 plus a higher private shop wage: after the street
 * rebuild more residents work private shop jobs, whose 32-base daily wage
 * (×(0.7 + prosperity/100)) left 141 adults below 80 coins. Shops pay a
 * PRIVATE_WAGE_BASE_V3 base; public, roadwork and player rates are unchanged. */
export const SHOP_PROFIT_TAX_POLICY_V3 = 'shop-profit-tax-v3' as const;
export type PublicFinancePolicy = typeof SHOP_PROFIT_TAX_POLICY | typeof SHOP_PROFIT_TAX_POLICY_V2 | typeof SHOP_PROFIT_TAX_POLICY_V3;
export const PUBLIC_FINANCE_POLICIES: readonly PublicFinancePolicy[] = [SHOP_PROFIT_TAX_POLICY, SHOP_PROFIT_TAX_POLICY_V2, SHOP_PROFIT_TAX_POLICY_V3];
/** v2/v3 pay dividends while wages are owed (they stay reserved); v1 and legacy wait for none owed. */
export const dividendWaitsForPayroll = (policy: PublicFinancePolicy | undefined) => policy !== SHOP_PROFIT_TAX_POLICY_V2 && policy !== SHOP_PROFIT_TAX_POLICY_V3;
export const PRIVATE_WAGE_BASE = 32, PRIVATE_WAGE_BASE_V3 = 40;
/** Daily private shop wage base under a declared policy. */
export const privateWageBase = (policy: PublicFinancePolicy | undefined) => policy === SHOP_PROFIT_TAX_POLICY_V3 ? PRIVATE_WAGE_BASE_V3 : PRIVATE_WAGE_BASE;
/** Was .5; the user judged half of all distributed profit unrealistic
 * (2026-10-10) once the shortfall was traced to logistics and a closed
 * economy, so it is a 20% corporate-style rate. */
export const PROFIT_TAX_SHARE = .2;

/** Splits one distributable amount into the public profit tax and the owner's dividend. */
export function profitTaxSplit(policy: PublicFinancePolicy | undefined, distributable: number): { tax: number; dividend: number } {
  const tax = policy === SHOP_PROFIT_TAX_POLICY || policy === SHOP_PROFIT_TAX_POLICY_V2 || policy === SHOP_PROFIT_TAX_POLICY_V3 ? distributable * PROFIT_TAX_SHARE : 0;
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

/** Under the same declared policy, public relief closes the poverty trap the
 * 14-day audit with a balanced treasury still showed (poor residents 0→163,
 * many at hunger 0 holding less than one meal): shops fund work minutes only
 * from their own cash, a day of food costs more than most wages, and owner
 * profit stops circulating. Once a day, after guardians' support, each living
 * resident holding less than two meals at the cheapest stocked food price is
 * topped up to that amount from the public budget's available cash (never its
 * payroll or operating reserves), poorest first. The council rule then prices
 * the relief into the next day's tax rate. */
export const RELIEF_MEALS = 2;
export interface ReliefClaim { id: string; money: number }

/** Allocates relief, poorest first, within the available public cash. */
export function reliefPayments(claims: ReliefClaim[], floor: number, available: number): { id: string; amount: number }[] {
  const out: { id: string; amount: number }[] = [];
  let budget = Math.max(0, available);
  for (const claim of [...claims].sort((a, b) => a.money - b.money || a.id.localeCompare(b.id))) {
    const amount = Math.min(Math.max(0, floor - claim.money), budget);
    if (amount <= 1e-9) continue;
    out.push({ id: claim.id, amount }); budget -= amount;
  }
  return out;
}
