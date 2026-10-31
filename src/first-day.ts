import { crowdSpots, crowdSpotTarget } from './rendering/crowd-spots';
import type { SimState, Vec3, WorldDefinition } from './types';

/** Where a first-day step can be done right now, for a one-click walk there:
 * eat — the nearest open market with food in stock; work — the nearest open
 * market (its counter offers the 60-minute shift); meet — the public venue at
 * the nearest of the busiest places people are out now. Null when nothing qualifies. */
export type FirstDayStep = 'eat' | 'work' | 'meet';

/** Beyond this straight-line distance a one-click trip prefers public transport (web and native host). */
export const AUTO_TRANSIT_METRES = 1200;

/** The welcome note's first-day list, in order: [id, label, hint]. Shared by the web UI and the native host. */
export const FIRST_DAY_STEPS: readonly (readonly ['walk' | FirstDayStep, string, string])[] = [
  ['walk', '走走看看', '沿街走走，看看千灯市集'],
  ['eat', '买份吃的', '走进商肆，在柜台买一份吃的'],
  ['work', '做次工班', '在店里做一次 60 分钟现场工班'],
  ['meet', '认识居民', '靠近一位居民，按 E 聊聊'],
];

/** Which first-day steps the player's own state shows done now. `purchased` is
 * the client's record that a purchase or meal it sent actually took money. */
export function firstDayDone(state: SimState, world: WorldDefinition, position: Vec3, purchased: boolean): Record<'walk' | FirstDayStep, boolean> {
  return {
    walk: Math.hypot(position.x - world.spawn.x, position.y - world.spawn.y, position.z - world.spawn.z) > 30,
    eat: purchased,
    work: !!state.playerLabor?.job || (state.playerLabor?.history.length ?? 0) > 0,
    meet: state.relationships.some(r => r.encounters > 0),
  };
}

/** Shown when a step has no place to go to right now. */
export function firstDayUnavailable(step: FirstDayStep): string {
  return step === 'meet' ? '此刻街上人少，稍晚再出门走走看。' : '附近的店铺此刻都已打烊，白天再来。';
}
export function firstDayTarget(state: SimState, world: WorldDefinition, position: Vec3, step: FirstDayStep): string | null {
  if (step === 'meet') {
    // The nearest of the busiest places: a first meeting should not need a cross-city trip.
    const profiles = state.extension?.actorProfiles, spot = crowdSpots(state.citizens.map(c => ({ position: c.position, state: c.state, alive: profiles?.[c.id]?.alive !== false })))
      .sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z))[0];
    return spot ? crowdSpotTarget(world.buildings, spot) : null;
  }
  const buildings = new Map(world.buildings.map(b => [b.id, b]));
  const far = (id: string) => { const door = buildings.get(id)!.door; return Math.hypot(door.x - position.x, door.z - position.z); };
  const open = state.shops.filter(shop => shop.open && buildings.get(shop.buildingId)?.kind === 'market' && (step === 'work' || shop.inventory >= 1));
  return open.map(shop => shop.buildingId).sort((a, b) => far(a) - far(b) || (a < b ? -1 : 1))[0] ?? null;
}

/** A first meeting should not need a cross-city trip: the nearest living resident who is
 * out on foot (walking or socialising) within MEET_NEARBY_METRES of the player, if any. */
export const MEET_NEARBY_METRES = 120;
export function nearbyStranger(state: SimState, position: Vec3): { name: string; role: string; metres: number } | null {
  const profiles = state.extension?.actorProfiles;
  let best: { name: string; role: string; metres: number } | null = null;
  for (const c of state.citizens) {
    if (profiles?.[c.id]?.alive === false || (c.state !== 'moving' && c.state !== 'socializing')) continue;
    const metres = Math.hypot(c.position.x - position.x, c.position.y - position.y, c.position.z - position.z);
    if (metres <= MEET_NEARBY_METRES && (!best || metres < best.metres)) best = { name: c.name, role: c.role, metres };
  }
  return best;
}
/** What the meet step says instead of planning a route when someone is near. */
export function nearbyStrangerNotice(stranger: { name: string; role: string; metres: number }): string {
  return `附近约 ${Math.max(1, Math.round(stranger.metres))} 米处就有居民${stranger.name}（${stranger.role}）。走到身旁，在左侧面板的“居民”页点“聊聊近况”。`;
}

/** Said once when the last first-day step is ticked (web toast, native host `next`): what the city
 * offers after the first day, from the player's own state. Display only. */
export function firstDayNext(state: Pick<SimState, 'player'>): string {
  const home = state.player.homeId ? '回住处床旁歇一歇' : '到住宅租一处落脚的住所';
  return `第一天的四件事都做完了。接下来可以：${home}；去书院自习，学些本事；坐车去别的城区看看（舆图上点光圈即可前往）。`;
}

/** From the second day an unfinished welcome note shrinks to its one-line first-day list (the
 * greeting and controls are no longer news); shared with Unity (FirstDay.CompactFromDay). */
export const WELCOME_COMPACT_FROM_DAY = 1;
export const welcomeCompact = (day: number): boolean => day >= WELCOME_COMPACT_FROM_DAY;
