import type { PlayerLaborJob } from './simulation/player-labor';
import type { SimState } from './types';

/** Display only: the shift button's label, from where the open shift is and how it stands (2026-10-22: it
 * said "已有工班 · 回到原场所继续" to a player already standing at that very shift's counter). */
export function playerLaborLabel(state: Pick<SimState, 'playerLabor'>, buildingId: string | undefined, siteName: (id: string) => string): string {
  const job = state.playerLabor?.job;
  if (!job) return '开始 60 分钟现场工班';
  if (job.siteId !== buildingId) return `已有工班 · 在${siteName(job.siteId)}`;
  if (job.status === 'paused') return '工班已暂停 · 回到工位继续';
  return `工班进行中 · ${Math.floor(job.workedMinutes)}/${job.requiredMinutes} 分钟`;
}

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

/** What a client last saw of the player's open shift. */
export interface LaborSeen { id: string | null; status: string | null; reason: string }

/** Display only (web toast and native host notice): an open shift that pauses says why, once per
 * reason (leaving the site, riding, needing food or rest, closing time), and says so again when it
 * resumes — a player who steps outside mid-shift otherwise does not know the clock stopped. */
export function freshLaborPause(state: SimState, seen: LaborSeen | null, siteName: (id: string) => string): { seen: LaborSeen; notice: string | null } {
  const job = state.playerLabor?.job;
  if (!job) return { seen: { id: null, status: null, reason: '' }, notice: null };
  const next = { id: job.id, status: job.status, reason: job.pauseReason };
  if (!seen || seen.id !== job.id) return { seen: next, notice: null };
  const done = `已做 ${Math.floor(job.workedMinutes)}/${job.requiredMinutes} 分钟`, site = siteName(job.siteId);
  if (job.status === 'paused' && (seen.status !== 'paused' || seen.reason !== job.pauseReason))
    return { seen: next, notice: `${site}的工班暂停（${done}）：${job.pauseReason.replace(/，?工班暂停。$/, '。')}` };
  if (job.status === 'working' && seen.status === 'paused') return { seen: next, notice: `${site}的工班继续，${done}。` };
  return { seen: next, notice: null };
}
