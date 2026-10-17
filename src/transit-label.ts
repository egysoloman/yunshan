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

/** A vehicle stopped to board within reach comes before the building door: E boards it and
 * the panel opens on it (at a stop beside a market, E used to enter the market). */
export const BOARDING_REACH = 8;
export function stoppedVehicleFirst(player: { x: number; y: number; z: number }, vehicle: Pick<Vehicle, 'state' | 'position'> | null | undefined, door: { x: number; y: number; z: number } | null | undefined): boolean {
  if (!vehicle || (vehicle.state !== 'waiting' && vehicle.state !== 'boarding')) return false;
  const toVehicle = Math.hypot(vehicle.position.x - player.x, vehicle.position.y - player.y, vehicle.position.z - player.z);
  return toVehicle <= BOARDING_REACH && (!door || toVehicle < Math.hypot(door.x - player.x, door.y - player.y, door.z - player.z));
}
