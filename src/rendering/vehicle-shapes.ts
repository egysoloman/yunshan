import type { TransportMode } from '../types';

/** Display shape of a network vehicle: three boxes (and a road vehicle's four wheels) around its authoritative
 * position, +Z along travel. Shared by the web renderer, the native client
 * and the art contract; the simulation never reads it. */
/** A wheel is 0.5 m wide and 0.7 m across, its centre 0.35 m above the vehicle's position. */
export const VEHICLE_WHEEL = { width: .5, size: .7, y: .35, color: '#2b2b2b' } as const;
export interface VehicleBox { y: number; width: number; height: number; length: number; color: string }
export interface VehicleShape { length: number; width: number; lift: number; body: VehicleBox; head: VehicleBox; trim: VehicleBox; wheels: { x: number; z: number }[] }

export function vehicleShape(kind: TransportMode): VehicleShape {
  const flight = kind === 'flight', train = kind === 'maglev' || kind === 'lightRail', boat = kind === 'ferry';
  const cable = kind === 'cable', length = flight ? 17 : train ? 16 : boat ? 11 : cable ? 3.5 : 5.5, width = flight ? 14 : train ? 3.3 : boat ? 4.5 : 2.5, lift = cable ? 4.6 : 0;
  // A cable cabin hangs from the haul rope drawn 8.5–9 m above the line
  // (network-structures): its trim becomes the grip arm up to the rope.
  const roof = 2.1 + lift + .4, rope = 8.6;
  return {
    length, width, lift,
    body: { y: 1.1 + lift, width, height: flight ? .8 : 1.5, length, color: flight ? '#d5c7aa' : train ? '#d0b985' : '#a77851' },
    head: { y: 2.1 + lift, width: flight ? 3 : width * .85, height: flight ? 1.8 : .8, length: length * .68, color: '#517f82' },
    trim: cable ? { y: (roof + rope) / 2, width: .25, height: rope - roof, length: .25, color: '#3f6f73' } : { y: .6 + lift, width: width + .25, height: .2, length: length * .85, color: '#3f6f73' },
    // Road vehicles stand on four wheels (local x across, z along); others have none.
    wheels: kind === 'road' || kind === 'bridge' ? [-1, 1].flatMap(side => [-1, 1].map(end => ({ x: side * (width / 2 - .05), z: end * (length / 2 - .95) }))) : [],
  };
}
