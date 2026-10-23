import type { WorldDefinition } from '../types';
import { lanternStrings, terraceLanternStrings } from './lantern-strings';

/** R1 W5 (docs/设计/美术与渲染改造方案.md §2.5, S6): display-only far glow of
 * lanterns. Near the camera the modelled lanterns are visible; at drone
 * distance a lantern is under a pixel and the city goes black at night, while
 * the concept art is strung with warm lights. Glows sit where the city already
 * has lights: a pair beside every door, the eave corners and mid-eaves of low buildings and
 * street lamps along roads. Positions are a pure function of the world. */
/** On-screen sizing (web shader and Unity Shaders/LanternGlow.shader): every glow is clamp(size × 400 / distance, 6, cap) px.
 * String lanterns are modelled, so their cap is NEAR_PX and they grow into a halo around the lantern up close (2026-10-22: an
 * 18 px cap left a street lantern 10 m away larger than its own glow). The other kinds stand where there is no lamp model:
 * capped at FAR_PX and faded out between FADE_TO and FADE_FROM metres, so none hangs in mid-air in front of the player. */
export const LANTERN_GLOW_SHADER = { FAR_PX: 18, NEAR_PX: 96, FADE_FROM: 40, FADE_TO: 80 } as const;
export interface LanternGlow { x: number; y: number; z: number; kind: 'door' | 'eave' | 'street' | 'string' }

const NO_EAVE = new Set(['station', 'airport', 'starport', 'core', 'facility']);

export function lanternGlows(world: WorldDefinition, streetSpacing = 36): LanternGlow[] {
  const out: LanternGlow[] = [];
  for (const b of world.buildings) {
    const p = b.position, dx = b.door.x - p.x, dz = b.door.z - p.z, len = Math.hypot(dx, dz) || 1, tx = -dz / len, tz = dx / len;
    for (const s of [-1.3, 1.3]) out.push({ x: b.door.x + tx * s + dx / len * .5, y: b.door.y + 2.2, z: b.door.z + tz * s + dz / len * .5, kind: 'door' });
    if (b.floors > 7 || NO_EAVE.has(b.kind)) continue;
    const c = Math.cos(b.rotation ?? 0), s = Math.sin(b.rotation ?? 0), hw = b.width / 2 + .6, hd = b.depth / 2 + .6, y = p.y + b.height - .4;
    for (const [u, v] of [[-hw, -hd], [0, -hd], [hw, -hd], [hw, 0], [hw, hd], [0, hd], [-hw, hd], [-hw, 0]]) out.push({ x: p.x + u * c + v * s, y, z: p.z - u * s + v * c, kind: 'eave' });
  }
  for (const edge of world.edges) {
    if ((edge.mode !== 'road' && edge.mode !== 'bridge') || edge.id.includes('runway')) continue;
    let carry = streetSpacing / 2;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      for (; carry <= seg; carry += streetSpacing) { const t = carry / seg; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + 3.6, z: a.z + (b.z - a.z) * t, kind: 'street' }); }
      carry -= seg;
    }
  }
  for (const string of [...lanternStrings(world), ...terraceLanternStrings(world)]) for (const lantern of string.lanterns) out.push({ ...lantern, kind: 'string' });
  return out;
}
