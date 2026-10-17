import type { PlayerLaborJob } from './simulation/player-labor';
import type { SimState } from './types';

/** Display only: one sentence for a shift that has just moved into the player's
 * history, read from its own settlement record (web toast and native host notice). */
export function laborSettlementNotice(job: Pick<PlayerLaborJob, 'status' | 'workedMinutes' | 'requiredMinutes' | 'paidNet' | 'paidGross' | 'paidTax' | 'refundedGross'>, siteName: string): string {
  const money = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} 云币`, worked = Math.round(job.workedMinutes);
  const pay = `实得 ${money(job.paidNet)}（税前 ${money(job.paidGross)}，缴税 ${money(job.paidTax)}）`;
  if (job.status === 'completed') return `${siteName}的工班完成：${worked} 分钟，${pay}。`;
  return `${siteName}的工班已结束：做了 ${worked}/${job.requiredMinutes} 分钟，${pay}${job.refundedGross > 0 ? `；未做部分 ${money(job.refundedGross)} 退回雇主` : ''}。`;
}

/** The shift history length a client has seen, and the notice for a shift that settled
 * since — only when it ended within the last 30 game minutes (a loaded save is not news). */
export function freshLaborSettlement(state: SimState, seen: number | null, siteName: (id: string) => string): { seen: number; notice: string | null } {
  const history = state.playerLabor?.history ?? [], length = history.length;
  if (seen === null || length <= seen) return { seen: length, notice: null };
  const job = history[length - 1], clock = state.day * 1440 + state.hour * 60;
  return { seen: length, notice: job.endedAt !== null && clock - job.endedAt <= 30 ? laborSettlementNotice(job, siteName(job.siteId)) : null };
}
