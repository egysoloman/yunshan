/** Display-only rain (2026-10-18): while the simulation's weather is '雨' and the player is
 * outdoors, short streaks fall in a box around the camera. Each streak has a fixed place on a
 * world-anchored lattice that wraps around the camera (moving does not drag the field along) and
 * falls at RAIN.fall m/s with a slight slant. Shared with Unity (Core/Rain.cs, parity fixture). */
export const RAIN = { count: 2400, half: 36, height: 24, below: 6, fall: 9, length: 1.6, slantX: .12, slantZ: .05 } as const;

const unit = (i: number, salt: number) => { let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };
const wrap = (v: number, span: number) => ((v % span) + span) % span;

export const rainActive = (weather: string, inside: boolean): boolean => weather === '雨' && !inside;

/** The top of streak i at render time `elapsed` (seconds) around `camera`; the streak runs
 * RAIN.length down along the slant from there. */
export function rainDrop(i: number, elapsed: number, camera: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const span = RAIN.half * 2, drop = wrap(unit(i, 3) * RAIN.height + elapsed * RAIN.fall, RAIN.height);
  const x = unit(i, 1) * span + drop * RAIN.slantX, z = unit(i, 2) * span + drop * RAIN.slantZ;
  return { x: camera.x - RAIN.half + wrap(x - camera.x + RAIN.half, span), y: camera.y + RAIN.height - RAIN.below - drop, z: camera.z - RAIN.half + wrap(z - camera.z + RAIN.half, span) };
}
