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
/** v4 (2026-10-14). v3 plus staff profit sharing: the 14-day audit kept every
 * resident fed but poor adults rose 0→201 while a few owners held up to 19
 * shops and the top tenth held 41% of resident cash; 59 of 170 merchants were
 * poor. Of each owner dividend STAFF_PROFIT_SHARE goes in equal parts to the
 * shop's living adult staff (none: the owner keeps it). Same tax, reserve,
 * wages and prices. */
export const SHOP_PROFIT_TAX_POLICY_V4 = 'shop-profit-tax-v4' as const;
/** v5 (2026-10-15). v4 plus a need-based public study grant: after v4, 58 of
 * 64 students were still poor; they have no income but their guardians'
 * support. A student studying at a school below STUDY_GRANT_CEILING coins is
 * paid STUDY_GRANT_PER_MINUTE of the minutes actually spent there, never past
 * the ceiling, from the public budget's available cash (never its payroll or
 * operating reserves). A first rate of .04/min paid only 3.5 coins a student
 * a day: students study about 90 minutes a day at school. Students are adults
 * (20–59) who may not take jobs, so once a day each living student below the
 * ceiling also receives STUDENT_BURSARY, poorest first, within the same
 * available cash. The council prices both into the tax rate. */
export const SHOP_PROFIT_TAX_POLICY_V5 = 'shop-profit-tax-v5' as const;
/** v6 (2026-10-15). v5 plus private job mobility: after v5, 58 of 170
 * merchants were still poor, most of them staff of loss-making shops that
 * cannot fund a day's wage (one shop held 17 staff at a loss while 65 shops
 * had none); shop staff could never leave. A poor worker (below
 * STUDY_GRANT_CEILING coins) of such a shop, not its owner and not promised
 * half a day (240 minutes) or more today, may take the same kind of offer the public-to-private move
 * takes: an open shop within 500 m that sells and can fund a day's wage.
 * Wages already earned at the old shop stay payable (as for any job change);
 * a first version also required nothing owed there, which kept 17 staff in
 * one loss-making shop (22 moves in 14 days); dropping it gave 27. Those
 * staff were each promised a few funded minutes a day, which also blocked
 * them; only a promise of half a day or more now does. */
export const SHOP_PROFIT_TAX_POLICY_V6 = 'shop-profit-tax-v6' as const;
/** v7 (2026-10-15, second design; a first v7 that suspended unfunded owners
 * failed its audit and never shipped). v6 plus registered adult migration:
 * the city of 616 feels empty on its streets and never grows. At each fiscal
 * day close at most MIGRANTS_PER_DAY adults arrive from outside the city, one
 * per hiring shop: an open shop that sold and can fund a day's wage beyond
 * its protected funds, with a home within 500 m that has room. Each brings
 * MIGRANT_SAVINGS coins from outside (an external inflow, like export sales),
 * is registered in family.migrants, and takes that shop job. The living
 * population never passes MIGRATION_CAP. */
export const SHOP_PROFIT_TAX_POLICY_V7 = 'shop-profit-tax-v7' as const;
/** v8 (2026-10-15). v7 with an arrival quarter: only 18 residents lived
 * within 300 m of the city entrance (the player's arrival point), so its
 * lantern streets stayed empty. Migrants first take offers from shops within
 * ARRIVAL_RADIUS of the entrance and, for any offer, a home with room within
 * ARRIVAL_RADIUS of it when the job is within reach; otherwise as v7. A first
 * version (one migrant per shop a day, as v7) raised residents within 400 m of
 * the entrance only 27 -> 37 in 14 days: few entrance shops hire on a given
 * day. Such a shop may now take up to ARRIVAL_SLOTS a day, round robin, while
 * its spare cash still funds each newcomer's day wage. */
export const SHOP_PROFIT_TAX_POLICY_V8 = 'shop-profit-tax-v8' as const;
export const ARRIVAL_RADIUS = 400, ARRIVAL_SLOTS = 3;
export type PublicFinancePolicy = typeof SHOP_PROFIT_TAX_POLICY_V8 | typeof SHOP_PROFIT_TAX_POLICY | typeof SHOP_PROFIT_TAX_POLICY_V2 | typeof SHOP_PROFIT_TAX_POLICY_V3 | typeof SHOP_PROFIT_TAX_POLICY_V4 | typeof SHOP_PROFIT_TAX_POLICY_V5 | typeof SHOP_PROFIT_TAX_POLICY_V6 | typeof SHOP_PROFIT_TAX_POLICY_V7;
export const PUBLIC_FINANCE_POLICIES: readonly PublicFinancePolicy[] = [SHOP_PROFIT_TAX_POLICY, SHOP_PROFIT_TAX_POLICY_V2, SHOP_PROFIT_TAX_POLICY_V3, SHOP_PROFIT_TAX_POLICY_V4, SHOP_PROFIT_TAX_POLICY_V5, SHOP_PROFIT_TAX_POLICY_V6, SHOP_PROFIT_TAX_POLICY_V7, SHOP_PROFIT_TAX_POLICY_V8];
const LATER_THAN_V1 = new Set<PublicFinancePolicy | undefined>([SHOP_PROFIT_TAX_POLICY_V2, SHOP_PROFIT_TAX_POLICY_V3, SHOP_PROFIT_TAX_POLICY_V4, SHOP_PROFIT_TAX_POLICY_V5, SHOP_PROFIT_TAX_POLICY_V6, SHOP_PROFIT_TAX_POLICY_V7, SHOP_PROFIT_TAX_POLICY_V8]);
export const MIGRANTS_PER_DAY = 3;
export const MIGRANT_SAVINGS = 150;
export const MIGRATION_CAP = 896;
export const admitsMigrants = (policy: PublicFinancePolicy | undefined) => policy === SHOP_PROFIT_TAX_POLICY_V7 || policy === SHOP_PROFIT_TAX_POLICY_V8;
export const settlesArrivalQuarter = (policy: PublicFinancePolicy | undefined) => policy === SHOP_PROFIT_TAX_POLICY_V8;
/** v2–v5 pay dividends while wages are owed (they stay reserved); v1 and legacy wait for none owed. */
export const dividendWaitsForPayroll = (policy: PublicFinancePolicy | undefined) => !LATER_THAN_V1.has(policy);
export const PRIVATE_WAGE_BASE = 32, PRIVATE_WAGE_BASE_V3 = 40;
/** Daily private shop wage base under a declared policy. */
export const privateWageBase = (policy: PublicFinancePolicy | undefined) => LATER_THAN_V1.has(policy) && policy !== SHOP_PROFIT_TAX_POLICY_V2 ? PRIVATE_WAGE_BASE_V3 : PRIVATE_WAGE_BASE;
/** Staff profit sharing (v4 and later). */
export const sharesProfitWithStaff = (policy: PublicFinancePolicy | undefined) => policy === SHOP_PROFIT_TAX_POLICY_V4 || policy === SHOP_PROFIT_TAX_POLICY_V5 || policy === SHOP_PROFIT_TAX_POLICY_V6 || policy === SHOP_PROFIT_TAX_POLICY_V7 || policy === SHOP_PROFIT_TAX_POLICY_V8;
/** Study grant and student bursary (v5 and later). */
export const fundsStudents = (policy: PublicFinancePolicy | undefined) => policy === SHOP_PROFIT_TAX_POLICY_V5 || policy === SHOP_PROFIT_TAX_POLICY_V6 || policy === SHOP_PROFIT_TAX_POLICY_V7 || policy === SHOP_PROFIT_TAX_POLICY_V8;
/** Shop staff may leave a shop that cannot fund a day's wage (v6). */
export const shopStaffMayMove = (policy: PublicFinancePolicy | undefined) => policy === SHOP_PROFIT_TAX_POLICY_V6 || policy === SHOP_PROFIT_TAX_POLICY_V7 || policy === SHOP_PROFIT_TAX_POLICY_V8;
export const STUDY_GRANT_PER_MINUTE = .25, STUDY_GRANT_CEILING = 120, STUDENT_BURSARY = 20;
/** Daily bursaries (v5 only): STUDENT_BURSARY to each student below the ceiling, poorest first, within the available cash. */
export function studentBursaries(policy: PublicFinancePolicy | undefined, students: ReliefClaim[], available: number): { id: string; amount: number }[] {
  if (!fundsStudents(policy)) return [];
  const out: { id: string; amount: number }[] = []; let budget = Math.max(0, available);
  for (const s of [...students].sort((a, b) => a.money - b.money || a.id.localeCompare(b.id))) {
    const amount = Math.min(STUDENT_BURSARY, Math.max(0, STUDY_GRANT_CEILING - s.money), budget);
    if (amount <= 1e-9) continue; out.push({ id: s.id, amount }); budget -= amount;
  }
  return out;
}
/** The study grant for minutes studied at a school (v5 only): up to the ceiling, within the available public cash. */
export function studyGrant(policy: PublicFinancePolicy | undefined, minutes: number, available: number, money = 0): number {
  return fundsStudents(policy) && minutes > 0 ? Math.max(0, Math.min(minutes * STUDY_GRANT_PER_MINUTE, STUDY_GRANT_CEILING - money, available)) : 0;
}
export const STAFF_PROFIT_SHARE = .3;
/** Splits an owner dividend between the owner and the staff (v4 only). */
export function staffProfitShare(policy: PublicFinancePolicy | undefined, dividend: number, staff: number): { owner: number; each: number } {
  if (!sharesProfitWithStaff(policy) || staff <= 0 || !(dividend > 0)) return { owner: dividend, each: 0 };
  const each = dividend * STAFF_PROFIT_SHARE / staff; return { owner: dividend - each * staff, each };
}
/** Was .5; the user judged half of all distributed profit unrealistic
 * (2026-10-10) once the shortfall was traced to logistics and a closed
 * economy, so it is a 20% corporate-style rate. */
export const PROFIT_TAX_SHARE = .2;

/** Splits one distributable amount into the public profit tax and the owner's dividend. */
export function profitTaxSplit(policy: PublicFinancePolicy | undefined, distributable: number): { tax: number; dividend: number } {
  const tax = policy === SHOP_PROFIT_TAX_POLICY || policy === SHOP_PROFIT_TAX_POLICY_V2 || LATER_THAN_V1.has(policy) ? distributable * PROFIT_TAX_SHARE : 0;
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
