import type { WorldDefinition } from '../types';

/** Display only (2026-10-22): by day a few birds circle above each district, so the sky over the
 * terraces is never still. A flock wheels round a point BIRDS.lift above the district's tallest roof,
 * each bird on its own slightly wider or narrower ring, flapping. Positions are a pure function of the
 * world and the clock in seconds; nothing collides or enters the simulation. Hidden when daylight is
 * below BIRDS.daylight. Shared with Unity (Core/BirdFlocks.cs, parity fixture). */
export const BIRDS = { perFlock: 7, lift: 25, radius: 130, spread: 25, speed: .06, flap: 7, daylight: .3, wingspan: 2.2 } as const;
export interface Bird { x: number; y: number; z: number; yaw: number; flap: number }
export interface Flock { x: number; y: number; z: number; radius: number; direction: 1 | -1; phase: number }

export function birdFlocks(world: Pick<WorldDefinition, 'districts' | 'buildings'>): Flock[] {
  return world.districts.map((d, i) => {
    let top = d.center.y;
    for (const b of world.buildings) if (b.districtId === d.id) top = Math.max(top, b.position.y + .6 + b.height);
    return { x: d.center.x, y: top + BIRDS.lift, z: d.center.z, radius: BIRDS.radius + (i % 3) * 20, direction: i % 2 ? -1 : 1, phase: i * 2.399 };
  });
}

export function birdsAt(flocks: readonly Flock[], seconds: number): Bird[] {
  const out: Bird[] = [];
  for (const f of flocks) for (let k = 0; k < BIRDS.perFlock; k++) {
    // The birds spread round the whole ring (0.9 rad apart, like kites circling on their own), each on a ring up to
    // BIRDS.spread wider or narrower, bobbing gently, so some always pass over every part of the district.
    const a = f.phase + f.direction * seconds * BIRDS.speed - f.direction * k * .9, r = f.radius + Math.sin(k * 1.7 + f.phase) * BIRDS.spread;
    const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r, y = f.y + Math.sin(seconds * .5 + k * 1.3 + f.phase) * 3 + (k % 3) * 2;
    // Heading along the ring (game yaw: 0 faces +z, turning toward +x).
    const vx = -Math.sin(a) * f.direction, vz = Math.cos(a) * f.direction;
    out.push({ x, y, z, yaw: Math.atan2(vx, vz), flap: Math.sin(seconds * BIRDS.flap + k * 2.1 + f.phase) });
  }
  return out;
}
