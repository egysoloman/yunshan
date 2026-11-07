import type { SimState } from './types';

/** Display only (web ui.ts and native sim-host): 快进至到站 on a long ride sets the clock to
 * FAST_RIDE_SPEED (a choice of the speed menu) with the player's own `speed` command, and the
 * multiplier the player had comes back at the next stop or on leaving that vehicle — unless the
 * player changed it meanwhile. */
export const FAST_RIDE_SPEED = 10;
export interface FastRide { vehicleId: string; previous: number }

export function startFastRide(state: Pick<SimState, 'player' | 'speed'>): FastRide | null {
  return state.player.vehicleId ? { vehicleId: state.player.vehicleId, previous: state.speed } : null;
}

/** Whether the fast ride is over (`done`), and the multiplier to set back (null: leave the clock alone). */
export function fastRideEnd(fast: FastRide | null, state: Pick<SimState, 'player' | 'speed'>, arrived: boolean): { done: boolean; restore: number | null } {
  if (!fast || !arrived && state.player.vehicleId === fast.vehicleId) return { done: false, restore: null };
  return { done: true, restore: state.speed === FAST_RIDE_SPEED ? fast.previous : null };
}
