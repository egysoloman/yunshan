import type { TransportMode } from '../types';

/** Display shape of a network vehicle: three boxes around its authoritative
 * position, +Z along travel. Shared by the web renderer, the native client
 * and the art contract; the simulation never reads it. */
export interface VehicleBox { y: number; width: number; height: number; length: number; color: string }
export interface VehicleShape { length: number; width: number; lift: number; body: VehicleBox; head: VehicleBox; trim: VehicleBox }

export function vehicleShape(kind: TransportMode): VehicleShape {
  const flight = kind === 'flight', train = kind === 'maglev' || kind === 'lightRail', boat = kind === 'ferry';
  const length = flight ? 17 : train ? 16 : boat ? 11 : kind === 'cable' ? 3.5 : 5.5, width = flight ? 14 : train ? 3.3 : boat ? 4.5 : 2.5, lift = kind === 'cable' ? 2.5 : 0;
  return {
    length, width, lift,
    body: { y: 1.1 + lift, width, height: flight ? .8 : 1.5, length, color: flight ? '#d5c7aa' : train ? '#d0b985' : '#a77851' },
    head: { y: 2.1 + lift, width: flight ? 3 : width * .85, height: flight ? 1.8 : .8, length: length * .68, color: '#517f82' },
    trim: { y: .6 + lift, width: width + .25, height: .2, length: length * .85, color: '#3f6f73' },
  };
}
