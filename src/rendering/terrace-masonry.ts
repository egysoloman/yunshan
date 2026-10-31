import type { WorldDefinition } from '../types';

/** Display only (concept art: terraces held by pale dressed-stone walls). A
 * vertical face of the near terrain shell reads as a masoned retaining wall
 * when it is a real terrace edge — a drop of at least MIN_DROP metres — inside
 * a district (within MASONRY_REACH of its radius) and below the alpine line.
 * Elsewhere the face stays natural rock. Geometry and terrainHeight are unchanged. */
export const MASONRY_MIN_DROP = 1.2, MASONRY_REACH = .95, MASONRY_ALPINE = 465;
export const MASONRY_COLOR = '#aaa293';
/** Capstones along a masoned wall's top: a light strip 2.5 cm above the ground, 0.45 m
 * inward and 0.06 m out over the face, with a 0.16 m front lip. */
export const COPING_COLOR = '#cfc6b2', COPING_RISE = .025, COPING_WIDTH = .45, COPING_LIP = .06, COPING_DEPTH = .16;

export function terraceMasonry(world: WorldDefinition): (x: number, z: number, top: number, drop: number) => boolean {
  const districts = world.districts.map(d => ({ x: d.center.x, z: d.center.z, r2: (d.radius * MASONRY_REACH) ** 2 }));
  return (x, z, top, drop) => drop >= MASONRY_MIN_DROP && top < MASONRY_ALPINE && districts.some(d => (x - d.x) ** 2 + (z - d.z) ** 2 <= d.r2);
}
