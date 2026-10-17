import type { SimState, TransportMode, Vehicle } from './types';

/** The ticket a passenger pays to board (Simulation command 'ride'). */
export const rideFare = (kind: TransportMode): number => kind === 'flight' ? 45 : 4;

/** Display only: how long a vehicle stopped to board will still wait, from its own
 * departure time, so a player can tell whether there is time to walk up and board. */
export function departureLabel(vehicle: Pick<Vehicle, 'state' | 'nextDeparture'>, state: Pick<SimState, 'day' | 'hour'>): string {
  if (vehicle.state !== 'waiting' && vehicle.state !== 'boarding') return '';
  const left = Math.ceil(vehicle.nextDeparture - (state.day * 1440 + state.hour * 60));
  return left > 0 ? ` · 约 ${left} 分钟后开出` : ' · 即将开出';
}
