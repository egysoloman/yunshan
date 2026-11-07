/** Companies pay dividends (2026-10-29, new cities). A shop bound to a company keeps its cash as the company's
 * capital, and the shop owner dividend skipped every such shop; the company's own hourly payout (extensions.ts)
 * gives its shareholders at most 0.3% of its profit an hour, untaxed and with no staff share, so capital kept
 * growing: in audit v9b one company held 18,220 (a tenth of all residents' cash) while 102 of 213 shop staff were
 * poor. In a declared city a company shop also pays the same dividend as any other shop, from company capital above the same
 * reserve, under the same profit tax and staff share; the owners' part goes to the shareholders in proportion
 * to the shares they hold (shares still with the exchange keep theirs in the company). Nothing else changes;
 * old saves and undeclared cities keep the old rule. */
export const COMPANY_DIVIDEND_POLICY = 'company-dividend-v1' as const;
export type CompanyDividendPolicy = typeof COMPANY_DIVIDEND_POLICY;
export const COMPANY_DIVIDEND_POLICIES: readonly CompanyDividendPolicy[] = [COMPANY_DIVIDEND_POLICY];

export function validateCompanyDividendPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'companyDividendPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'companyDividendPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !COMPANY_DIVIDEND_POLICIES.includes(data.companyDividendPolicyId)
    || data.runtime.companyDividendPolicyId !== data.companyDividendPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：company dividend policy pair。');
}

/** The holders' part of a company's dividend, by shares held (the exchange's part stays in the company). */
export function shareholderParts(shareholders: Record<string, number>, shares: number, dividend: number, alive: (id: string) => boolean): { id: string; amount: number }[] {
  if (!(dividend > 0) || !(shares > 0)) return [];
  return Object.entries(shareholders).filter(([id, quantity]) => id !== 'exchange' && quantity > 0 && alive(id)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([id, quantity]) => ({ id, amount: dividend * Math.min(quantity, shares) / shares }));
}
