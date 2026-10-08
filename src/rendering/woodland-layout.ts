import type { Vec3, WorldDefinition } from '../types';
import { getWaterfallPath, terrainHeight } from '../world';

/** Shared woodland placement for the web renderer and the Unity client (C#
 * Core/WoodlandLayout.cs, parity-tested). Trees and shrubs are display only:
 * no collision, walking surface or stock comes from them.
 *
 * Sizes are the voxel-studio models' own (user decision 2026-10-08: trees use
 * the assets' original size, never enlarged), so a tree's height is the
 * height of the model its species selects. */
export const WOODLAND_TILE = 96;
export const WOODLAND_MAX_TREES = 5200;
/** Species index (0–8, as the original woodland) → studio tree model. */
export const WOODLAND_SPECIES_ASSETS = ['ENV-057', 'ENV-056', 'ENV-050', 'ENV-054', 'ENV-054', 'ENV-055', 'ENV-055', 'ENV-050', 'ENV-050'] as const;
export const WOODLAND_SHRUB_ASSET = 'ENV-060';
/** Heights of those models (studio-assets.json bounds), used for the far proxy and the contract. */
export const WOODLAND_ASSET_HEIGHTS: Readonly<Record<string, number>> = { 'ENV-050': 16, 'ENV-054': 14, 'ENV-055': 14, 'ENV-056': 8.4, 'ENV-057': 10, 'ENV-060': 1.8 };

export interface WoodlandTree { id: number; asset: string; species: number; x: number; y: number; z: number; height: number; yaw: number }
export interface WoodlandShrub { id: number; asset: string; x: number; y: number; z: number; yaw: number }
interface Segment { a: Vec3; b: Vec3; width: number }

const quantize = (value: number) => Math.round(value / .2) * .2;
export function woodlandHash(x: number, z: number, seed: number) { const value = Math.sin(x * 12.9898 + z * 78.233 + seed * .113) * 43758.5453; return value - Math.floor(value); }
function progress(x: number, z: number, a: Vec3, b: Vec3) { const dx = b.x - a.x, dz = b.z - a.z; return Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))); }
function distanceToSegment(x: number, z: number, a: Vec3, b: Vec3) { const t = progress(x, z, a, b); return Math.hypot(x - a.x - (b.x - a.x) * t, z - a.z - (b.z - a.z) * t); }

/** Ground clearance used by trees and other terrain dressing: off building
 * footprints, roads, the waterfall path, the river and the plunge pool. */
export function createGroundClearance(world: WorldDefinition) {
  const buildings = new Map<string, typeof world.buildings>(), roads = new Map<string, Segment[]>();
  const indexItem = <T>(map: Map<string, T[]>, item: T, ax: number, az: number, bx: number, bz: number, margin: number) => {
    for (let x = Math.floor((Math.min(ax, bx) - margin) / WOODLAND_TILE); x <= Math.floor((Math.max(ax, bx) + margin) / WOODLAND_TILE); x++) for (let z = Math.floor((Math.min(az, bz) - margin) / WOODLAND_TILE); z <= Math.floor((Math.max(az, bz) + margin) / WOODLAND_TILE); z++) { const key = `${x}:${z}`, list = map.get(key) ?? []; list.push(item); map.set(key, list); }
  };
  for (const b of world.buildings) indexItem(buildings, b, b.position.x - b.width / 2, b.position.z - b.depth / 2, b.position.x + b.width / 2, b.position.z + b.depth / 2, 12);
  for (const edge of world.edges) if (['road', 'bridge', 'lightRail'].includes(edge.mode)) for (let i = 1; i < edge.points.length; i++) {
    const segment = { a: edge.points[i - 1], b: edge.points[i], width: edge.id.includes('airport-runway-strip') ? 22 : 5 };
    indexItem(roads, segment, segment.a.x, segment.a.z, segment.b.x, segment.b.z, segment.width + 14);
  }
  const river: Segment[] = world.river.slice(1).map((point, i) => ({ a: world.river[i], b: point, width: 12 + Math.min(i + 1, 5) * .6 }));
  const fallProfile = getWaterfallPath(world);
  const bucket = (x: number, z: number) => `${Math.floor(x / WOODLAND_TILE)}:${Math.floor(z / WOODLAND_TILE)}`;
  const riverAt = (x: number, z: number) => {
    let best = { distance: Infinity, width: 14 };
    for (const s of river) { const dist = distanceToSegment(x, z, s.a, s.b); if (dist < best.distance) best = { distance: dist, width: s.width }; }
    return best;
  };
  return (x: number, z: number, margin: number) => {
    if ((buildings.get(bucket(x, z)) ?? []).some(b => Math.abs(x - b.position.x) < b.width / 2 + margin && Math.abs(z - b.position.z) < b.depth / 2 + margin)) return false;
    if ((roads.get(bucket(x, z)) ?? []).some(s => distanceToSegment(x, z, s.a, s.b) < s.width + margin)) return false;
    if (fallProfile.slice(1).some((point, i) => distanceToSegment(x, z, fallProfile[i], point) < 46 + margin)) return false;
    const r = riverAt(x, z); return r.distance > r.width + margin && Math.hypot(x - world.waterfall.bottom.x, z - world.waterfall.bottom.z) > 56;
  };
}

/** Woodland grows in overlapping stands along the actual neighbourhood edge
 * and the mountain shoulder (the original stand and sampling rules). */
export function woodlandLayout(world: WorldDefinition): { trees: WoodlandTree[]; shrubs: WoodlandShrub[]; stands: number } {
  const clear = createGroundClearance(world), surface = (x: number, z: number) => quantize(terrainHeight(world, x, z, true));
  const stands = world.districts.filter(district => !['airport', 'starport'].includes(district.kind)).flatMap((district, index) => Array.from({ length: 8 }, (_, side) => {
    const angle = side / 8 * Math.PI * 2 + index * .21, distance = district.radius * .86;
    return { x: district.center.x + Math.cos(angle) * distance, z: district.center.z + Math.sin(angle) * distance, radius: 100 };
  }));
  for (const mountain of world.mountains) for (let side = 0; side < 5; side++) { const angle = side / 5 * Math.PI * 2; stands.push({ x: mountain.x + Math.cos(angle) * mountain.radius * .54, z: mountain.z + Math.sin(angle) * mountain.radius * .54, radius: 65 }); }
  if (!stands.length) stands.push({ x: 0, z: 0, radius: world.size * .35 });
  const trees: WoodlandTree[] = [], shrubs: WoodlandShrub[] = [];
  for (let i = 0; i < 70000 && trees.length < WOODLAND_MAX_TREES; i++) {
    const stand = stands[i % stands.length], angle = woodlandHash(i, 38, world.seed) * Math.PI * 2, radius = Math.sqrt(woodlandHash(i, 73, world.seed)) * stand.radius;
    const x = quantize(stand.x + Math.cos(angle) * radius), z = quantize(stand.z + Math.sin(angle) * radius), y = surface(x, z);
    if (y < 8 || y > 630 || !clear(x, z, 3)) continue;
    if (Math.abs(surface(x + 2, z) - y) > 8 || Math.abs(surface(x, z + 2) - y) > 8) continue;
    const species = Math.floor(i / stands.length) % 9, asset = WOODLAND_SPECIES_ASSETS[species];
    // Quarter turns keep the 0.2m voxel grid of the model aligned with the world.
    const yaw = Math.floor(woodlandHash(i, 94, world.seed) * 4) * Math.PI / 2;
    trees.push({ id: i, asset, species, x, y, z, height: WOODLAND_ASSET_HEIGHTS[asset], yaw });
    if (i % 2 === 0) shrubs.push({ id: i, asset: WOODLAND_SHRUB_ASSET, x: quantize(x + 3.2), y: surface(quantize(x + 3.2), quantize(z + 2)), z: quantize(z + 2), yaw: Math.floor(woodlandHash(i, 95, world.seed) * 4) * Math.PI / 2 });
  }
  return { trees, shrubs, stands: stands.length };
}

export interface DressingBlock { x: number; y: number; z: number; w: number; h: number; d: number }
/** Riverbank stones and reeds along the creek, and the plunge-pool foam
 * (the terrain's original rules; also drawn by Unity via
 * Core/WoodlandLayout.RiverDressing, parity-tested). Display only. */
export function riverDressing(world: WorldDefinition): { stones: DressingBlock[]; reeds: DressingBlock[]; foam: DressingBlock[] } {
  const clear = createGroundClearance(world), surface = (x: number, z: number) => quantize(terrainHeight(world, x, z, true));
  const stones: DressingBlock[] = [], reeds: DressingBlock[] = [], foam: DressingBlock[] = [];
  for (let i = 1; i < world.river.length; i++) {
    const p = world.river[i], before = world.river[i - 1], width = 12 + Math.min(i, 5) * .6;
    const segmentLength = Math.hypot(p.x - before.x, p.z - before.z), tangentX = -(p.z - before.z) / segmentLength, tangentZ = (p.x - before.x) / segmentLength;
    for (let along = 0; along < segmentLength; along += 5.6) for (const side of [-1, 1]) {
      const t = along / segmentLength, x = quantize(before.x + (p.x - before.x) * t + tangentX * (width + 2 + woodlandHash(along, i, world.seed) * 3) * side), z = quantize(before.z + (p.z - before.z) * t + tangentZ * (width + 2 + woodlandHash(along, i, world.seed) * 3) * side), y = surface(x, z);
      if (!clear(x, z, 1.2) || y > before.y + (p.y - before.y) * t + 9) continue;
      stones.push({ x, y: y + .35, z, w: quantize(1.2 + woodlandHash(along, i + 2, world.seed) * 2.8), h: .6, d: quantize(1 + woodlandHash(along, i + 3, world.seed) * 2) });
      if (along % 11.2 < 1) for (let stem = 0; stem < 4; stem++) reeds.push({ x: x + stem * .4, y: y + .8, z: z + stem % 2 * .4, w: .2, h: 1.6, d: .2 });
    }
  }
  const bottom = world.waterfall.bottom;
  for (let i = 0; i < 80; i++) { const angle = i * 2.39996, r = 3 + woodlandHash(i, 805, world.seed) * 21; foam.push({ x: quantize(bottom.x + Math.cos(angle) * r), y: bottom.y + .72, z: quantize(bottom.z + Math.sin(angle) * r), w: quantize(.8 + woodlandHash(i, 806, world.seed) * 2), h: .2, d: .4 }); }
  return { stones, reeds, foam };
}

/** Studio ground dressing at original size (display only, near the camera):
 * understorey under the trees, wet-bank plants at the creek reed sites and
 * boulders and scree around the mountain feet. Each model's footprint centre
 * sits on the cleared ground and its origin is at the lowest surface under the
 * footprint, so nothing floats. Parity: C# WoodlandLayout.GroundDressing. */
export const UNDERSTOREY_ASSETS = ['ENV-061', 'ENV-064', 'ENV-062', 'ENV-069'] as const;
export const BANK_ASSETS = ['ENV-065', 'ENV-066'] as const;
export const ROCK_ASSETS = ['ENV-015', 'ENV-011', 'ENV-016'] as const;
/** Footprint centre (model space x, z) and clearance radius from the imported bounds. */
export const GROUND_DRESSING_FOOTPRINT: Readonly<Record<string, { cx: number; cz: number; radius: number }>> = {
  'ENV-061': { cx: 0, cz: 0, radius: 2.6 }, 'ENV-064': { cx: .1, cz: 0, radius: 1.8 }, 'ENV-062': { cx: .2, cz: .2, radius: .8 }, 'ENV-069': { cx: 3, cz: .1, radius: 3.2 },
  'ENV-065': { cx: .2, cz: 0, radius: 1.8 }, 'ENV-066': { cx: 0, cz: .1, radius: 2 },
  'ENV-015': { cx: 0, cz: 0, radius: 2.4 }, 'ENV-011': { cx: 8, cz: 6, radius: 9 }, 'ENV-016': { cx: 3, cz: 3, radius: 3.6 },
};
export const ROCK_HEIGHTS: Readonly<Record<string, number>> = { 'ENV-015': 8, 'ENV-011': 5, 'ENV-016': .8 };
export type GroundDressingTier = 'ground' | 'rock';
export interface GroundDressingItem { id: number; asset: string; tier: GroundDressingTier; x: number; y: number; z: number; yaw: number }

export function groundDressing(world: WorldDefinition, trees: readonly WoodlandTree[]): GroundDressingItem[] {
  const clear = createGroundClearance(world), surface = (x: number, z: number) => quantize(terrainHeight(world, x, z, true));
  const items: GroundDressingItem[] = [];
  const place = (asset: string, tier: GroundDressingTier, cx: number, cz: number, yaw: number, relief: number) => {
    const f = GROUND_DRESSING_FOOTPRINT[asset], r = f.radius;
    if (!clear(cx, cz, r)) return false;
    const heights = [surface(cx, cz), surface(cx + r, cz), surface(cx - r, cz), surface(cx, cz + r), surface(cx, cz - r)];
    const low = Math.min(...heights), high = Math.max(...heights);
    if (low < 8 || high - low > relief) return false;
    // origin = centre − rotY(yaw)·(cx, cz)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    items.push({ id: items.length, asset, tier, x: cx - (c * f.cx + s * f.cz), y: low, z: cz - (-s * f.cx + c * f.cz), yaw });
    return true;
  };
  for (const tree of trees) {
    if (tree.id % 3 !== 1) continue;
    const asset = UNDERSTOREY_ASSETS[Math.floor(woodlandHash(tree.id, 96, world.seed) * 4)];
    const angle = woodlandHash(tree.id, 97, world.seed) * Math.PI * 2, distance = 4 + woodlandHash(tree.id, 98, world.seed) * 3;
    place(asset, 'ground', quantize(tree.x + Math.cos(angle) * distance), quantize(tree.z + Math.sin(angle) * distance), Math.floor(woodlandHash(tree.id, 99, world.seed) * 4) * Math.PI / 2, 1.2);
  }
  let site = 0;
  for (let i = 1; i < world.river.length; i++) {
    const p = world.river[i], before = world.river[i - 1], width = 12 + Math.min(i, 5) * .6;
    const segmentLength = Math.hypot(p.x - before.x, p.z - before.z), tangentX = -(p.z - before.z) / segmentLength, tangentZ = (p.x - before.x) / segmentLength;
    for (let along = 0; along < segmentLength; along += 11.2) for (const side of [-1, 1]) {
      const t = along / segmentLength, offset = width + 6.4 + woodlandHash(along, i, world.seed) * 3;
      const x = quantize(before.x + (p.x - before.x) * t + tangentX * offset * side), z = quantize(before.z + (p.z - before.z) * t + tangentZ * offset * side);
      if (surface(x, z) > before.y + (p.y - before.y) * t + 9) continue;
      if (place(BANK_ASSETS[site % 2], 'ground', x, z, Math.floor(woodlandHash(along, i + 7, world.seed) * 4) * Math.PI / 2, 1.2)) site++;
    }
  }
  world.mountains.forEach((mountain, m) => {
    for (let n = 0; n < 16; n++) {
      const asset = ROCK_ASSETS[n % 3], angle = n / 16 * Math.PI * 2 + woodlandHash(n, 900 + m, world.seed) * .3, distance = mountain.radius * (1.02 + woodlandHash(n, 901 + m, world.seed) * .3);
      // A rock may sink into the slope by up to 70% of its own height.
      place(asset, 'rock', quantize(mountain.x + Math.cos(angle) * distance), quantize(mountain.z + Math.sin(angle) * distance), Math.floor(woodlandHash(n, 902 + m, world.seed) * 4) * Math.PI / 2, ROCK_HEIGHTS[asset] * .7);
    }
  });
  return items;
}
