import type { WorldDefinition } from '../types';

/** R1 W6a (docs/设计/美术与渲染改造方案.md): display-only cloud banks. In the
 * concept art the districts rise out of a sea of cloud and mist lies in the
 * gaps between terraces; the generated world instead shows a flat green plain
 * between districts and a hard world edge. A low cloud sea fills the plain
 * outside every district, and valley bands lie between neighbouring districts
 * at about their mean terrace height. Positions are a pure function of the
 * world, so both clients can reproduce them; nothing here touches simulation. */
export interface CloudPuff { x: number; y: number; z: number; size: number; layer: 'sea' | 'valley' }

const hash = (a: number, b: number, seed: number) => { let h = Math.imul(a * 73856093 ^ b * 19349663 ^ seed, 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };

export function cloudBanks(world: WorldDefinition, spacing = 230): CloudPuff[] {
  const out: CloudPuff[] = [], half = world.size / 2 * .98;
  const ratio = (x: number, z: number) => Math.min(...world.districts.map(d => Math.hypot(x - d.center.x, z - d.center.z) / Math.max(1, d.radius)));
  for (let i = 0, x = -half; x <= half; i++, x += spacing) for (let j = 0, z = -half; z <= half; j++, z += spacing) {
    const jx = x + (hash(i, j, world.seed) - .5) * spacing * .8, jz = z + (hash(j, i, world.seed) - .5) * spacing * .8;
    if (ratio(jx, jz) < 1.18) continue;
    out.push({ x: jx, y: 58 + hash(i, j + 91, world.seed) * 55, z: jz, size: 380 + hash(i + 7, j, world.seed) * 260, layer: 'sea' });
  }
  const districts = world.districts;
  for (let a = 0; a < districts.length; a++) for (let b = a + 1; b < districts.length; b++) {
    const p = districts[a], q = districts[b], gap = Math.hypot(p.center.x - q.center.x, p.center.z - q.center.z);
    if (gap > p.radius + q.radius + 420) continue;
    for (let k = 0; k < 3; k++) {
      const t = .38 + k * .12, x = p.center.x + (q.center.x - p.center.x) * t, z = p.center.z + (q.center.z - p.center.z) * t;
      if (ratio(x, z) < .9) continue;
      out.push({ x, y: Math.min(p.center.y, q.center.y) + Math.abs(p.center.y - q.center.y) * .35 + 10, z, size: 220 + hash(a, b * 3 + k, world.seed) * 140, layer: 'valley' });
    }
  }
  return out;
}
