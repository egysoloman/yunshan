import { firstDayTarget } from './first-day';
import type { SimState, Vec3, WorldDefinition } from './types';

/** Display only (web toast and native host notice): one sentence when the player's own hunger or
 * energy first falls low, naming what the city offers for it now. Each warning is said once and
 * re-arms only after the need has recovered above NEED_RECOVERED (no repeated nagging). */
export const HUNGER_LOW = 30, FATIGUE_LOW = 25, NEED_RECOVERED = 50;
export interface NeedSeen { hungry: boolean; tired: boolean }

export function freshNeedNotice(state: SimState, world: WorldDefinition, position: Vec3, seen: NeedSeen | null): { seen: NeedSeen; notice: string | null } {
  const { hunger, fatigue } = state.player.needs;
  const hungry = seen?.hungry ? hunger < NEED_RECOVERED : hunger < HUNGER_LOW, tired = seen?.tired ? fatigue < NEED_RECOVERED : fatigue < FATIGUE_LOW;
  const next = { hungry, tired };
  // The first reading is a baseline (a loaded save or a fresh start is not news).
  if (!seen) return { seen: next, notice: null };
  const lines: string[] = [];
  if (hungry && !seen.hungry) {
    const food = state.player.inventory.food ?? 0, id = firstDayTarget(state, world, position, 'eat'), shop = id ? world.buildings.find(b => b.id === id) : undefined;
    const where = shop ? `最近营业的${shop.name}，约 ${Math.round(Math.hypot(shop.door.x - position.x, shop.door.z - position.z))} 米，可去买份吃的` : '附近的店铺此刻都已打烊';
    lines.push(`有些饿了（饱腹 ${Math.round(hunger)}）：${where}${food >= 1 ? `；随身还有 ${food} 份食物，可在城市手册「生活」里食用` : ''}。`);
  }
  if (tired && !seen.tired) lines.push(`有些困了（精力 ${Math.round(fatigue)}）：${state.player.homeId ? '回住处床旁歇一歇' : '到住宅租一处住所，就能在床旁休息；山顶亭、医馆和车站也可小憩'}。`);
  return { seen: next, notice: lines.length ? lines.join(' ') : null };
}
