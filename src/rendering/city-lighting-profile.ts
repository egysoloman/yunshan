import type { Quality } from '../types';

export interface CityShadowProfile {
  mapSize: number;
  halfSpan: number;
  normalBias: number;
  bias: number;
  metresPerTexel: number;
}

/** One existing sun map covers the occupied neighbourhood. The distant city
 * still receives no extra shadow pass. This is a rendering budget, not a
 * visibility, power, movement or simulation rule. */
export function cityShadowProfile(quality: Quality): CityShadowProfile {
  const mapSize = quality === 'high' ? 2048 : quality === 'low' ? 512 : 1024;
  const halfSpan = quality === 'high' ? 100 : 64;
  return { mapSize, halfSpan, normalBias: .06, bias: -.00012, metresPerTexel: halfSpan * 2 / mapSize };
}
