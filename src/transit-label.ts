import { isRoadOpen } from './roads';
import { gridVehicleSupplyRatio } from './simulation/power-grid';
import type { SimState, TransportMode, Vehicle, WorldDefinition } from './types';

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

/** Display only: for the vehicle the player rides, about how long until it reaches the stop it is heading for,
 * by the simulation's own movement rule (speed in metres per game minute, scaled by its power supply, at least
 * 0.3, and road congestion), plus any wait before it leaves. Null for another vehicle, without power or on a
 * closed road (2026-10-22: a cable car ride takes hours of game time and said nothing about how long). */
export function rideArrivalMinutes(vehicle: Vehicle, world: Pick<WorldDefinition, 'edges'>, state: SimState): number | null {
  if (state.player.vehicleId !== vehicle.id || !isRoadOpen(state, vehicle.edgeId)) return null;
  const edge = world.edges.find(e => e.id === vehicle.edgeId); if (!edge) return null;
  const energy = state.powerGrid ? gridVehicleSupplyRatio(state, vehicle.id) : state.energy / 100;
  if (energy < .18 && vehicle.kind !== 'bridge') return null;
  const hour = state.hour, congestion = vehicle.kind === 'road' ? .8 + (hour >= 7 && hour < 9 || hour >= 17 && hour < 19 ? -.22 : .1) : 1;
  const remaining = edge.length * (vehicle.direction > 0 ? 1 - vehicle.progress : vehicle.progress), rate = vehicle.speed * Math.max(.3, energy) * congestion;
  if (rate <= 0) return null;
  const wait = Math.max(0, vehicle.nextDeparture - (state.day * 1440 + state.hour * 60));
  return Math.ceil(wait + remaining / rate);
}
export function rideArrivalLabel(vehicle: Vehicle, world: Pick<WorldDefinition, 'edges'>, state: SimState): string | null {
  const minutes = rideArrivalMinutes(vehicle, world, state); if (minutes === null) return null;
  return minutes < 1 ? '即将到站' : minutes < 60 ? `约 ${minutes} 分钟后到站` : `约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后到站`;
}
/** A ride with more than LONG_RIDE_MINUTES to go says the clock can be sped up (the arrival is announced). */
export const LONG_RIDE_MINUTES = 30;
export function longRideNote(vehicle: Vehicle, world: Pick<WorldDefinition, 'edges'>, state: SimState): string | null {
  const minutes = rideArrivalMinutes(vehicle, world, state);
  return minutes !== null && minutes > LONG_RIDE_MINUTES ? '车程较长：可在底部把时间倍率调高，到站时会提示。' : null;
}

/** What E does next to a stopped vehicle follows the panel the player sees (2026-10-22: at the market
 * spawn a bus pulled in behind the player between two 0.2 s panel refreshes; the panel still said
 * "进入 / 使用建筑 · E" and E boarded a bus out of sight, and switching back to the place tab did not
 * help either). On the place tab E never boards; on the vehicle tab it boards a stopped vehicle within
 * reach; with neither shown, stoppedVehicleFirst decides. Unity: ContextLayout.EBoardsVehicle. */
export function eBoardsVehicle(player: { x: number; y: number; z: number }, vehicle: Pick<Vehicle, 'state' | 'position'> | null | undefined, door: { x: number; y: number; z: number } | null | undefined, shown: string | null): boolean {
  if (shown === 'building') return false;
  if (shown === 'vehicle') return stoppedVehicleFirst(player, vehicle, null);
  return stoppedVehicleFirst(player, vehicle, door);
}

/** Display only: the stop a vehicle is heading for. On arrival the simulation picks the next leg
 * before the vehicle waits, so a stopped vehicle already points at its next stop. A vehicle standing at
 * the very end it was heading for has not picked yet, and one at the end of a closed road picks again
 * (null: say nothing rather than guess). */
export function nextStopName(vehicle: Pick<Vehicle, 'edgeId' | 'direction' | 'progress'>, world: Pick<WorldDefinition, 'edges' | 'nodes'>, state: Pick<SimState, 'roadNetwork'>): string | null {
  if (!isRoadOpen(state, vehicle.edgeId) && (vehicle.progress === 0 || vehicle.progress === 1)) return null;
  if (vehicle.progress === 0 && vehicle.direction < 0 || vehicle.progress === 1 && vehicle.direction > 0) return null;
  const edge = world.edges.find(e => e.id === vehicle.edgeId); if (!edge) return null;
  const id = vehicle.direction > 0 ? edge.to : edge.from;
  return world.nodes.find(n => n.id === id)?.name ?? null;
}
export function nextStopTitle(vehicle: Pick<Vehicle, 'edgeId' | 'direction' | 'progress'>, world: Pick<WorldDefinition, 'edges' | 'nodes'>, state: Pick<SimState, 'roadNetwork'>): string | null {
  const stop = nextStopName(vehicle, world, state);
  return stop ? `开往 ${stop}` : null;
}

/** The stop a vehicle standing at an endpoint is at (its new leg starts there), or null mid-edge. */
export function currentStopName(vehicle: Pick<Vehicle, 'edgeId' | 'direction' | 'progress'>, world: Pick<WorldDefinition, 'edges' | 'nodes'>): string | null {
  if (vehicle.progress !== 0 && vehicle.progress !== 1) return null;
  const edge = world.edges.find(e => e.id === vehicle.edgeId); if (!edge) return null;
  const id = vehicle.progress === 0 ? edge.from : edge.to;
  return world.nodes.find(n => n.id === id)?.name ?? null;
}

/** What a client last saw of the vehicle the player rides. */
export interface RideSeen { vehicleId: string | null; stopped: boolean }

/** Display only (web toast and native host notice): one sentence when the vehicle the player
 * rides as a passenger comes to a stop to board, naming the stop and how to get off. Boarding a
 * vehicle that is already stopped, or driving one, is not news. */
export function freshRideStop(state: Pick<SimState, 'vehicles' | 'player' | 'roadNetwork'>, world: Pick<WorldDefinition, 'edges' | 'nodes'>, seen: RideSeen | null): { seen: RideSeen; notice: string | null } {
  const vehicle = state.player.vehicleId ? state.vehicles.find(v => v.id === state.player.vehicleId) : undefined;
  if (!vehicle) return { seen: { vehicleId: null, stopped: false }, notice: null };
  const stopped = vehicle.state === 'waiting' || vehicle.state === 'boarding', next = { vehicleId: vehicle.id, stopped };
  if (!stopped || seen?.vehicleId !== vehicle.id || seen.stopped || (state.player.inventory.driving ?? 0) === 1) return { seen: next, notice: null };
  const here = currentStopName(vehicle, world); if (!here) return { seen: next, notice: null };
  const onward = nextStopName(vehicle, world, state);
  return { seen: next, notice: `到站：${here}。按 E 下车${onward && onward !== here ? `，或继续乘坐开往 ${onward}` : ''}。` };
}
