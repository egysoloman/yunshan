import type { SimState } from './types';

/** Display only (web toast and native host notice): when a new day begins, one sentence on
 * what the player's own yesterday came to — cash, shifts finished, residents met — read from
 * the player's state. The first reading is a baseline (a loaded save is not news). */
export interface DaySnapshot { day: number; money: number; acquaintances: number }

export const daySnapshot = (state: Pick<SimState, 'day' | 'player' | 'relationships'>): DaySnapshot =>
  ({ day: state.day, money: state.player.money, acquaintances: state.relationships.filter(r => r.encounters > 0).length });

export function freshDaySummary(state: SimState, seen: DaySnapshot | null): { seen: DaySnapshot; notice: string | null } {
  const now = daySnapshot(state);
  if (!seen || state.day <= seen.day) return { seen: seen && state.day === seen.day ? seen : now, notice: null };
  const days = state.day - seen.day, from = seen.day * 1440, to = state.day * 1440;
  const shifts = (state.playerLabor?.history ?? []).filter(job => job.endedAt !== null && job.endedAt >= from && job.endedAt < to && job.workedMinutes > 0).length;
  const met = now.acquaintances - seen.acquaintances;
  const parts = [`现金 ${Math.round(seen.money)} → ${Math.round(now.money)} 云币`, ...(shifts ? [`完成 ${shifts} 次工班`] : []), ...(met > 0 ? [`结识 ${met} 位居民`] : [])];
  return { seen: now, notice: `第 ${state.day + 1} 日开始了。${days === 1 ? '昨天' : `过去 ${days} 天`}：${parts.join('，')}。` };
}
