import { applyCommercialDistrict } from './commercial-district';
import { applyMarketStationApron } from './market-station-apron';
import type { Building, BuildingKind, District, NetworkEdge, NetworkNode, SimState, TransportMode, Vec3, WorldDefinition } from './types';
import { isRoadOpen } from './roads';
import { getFloorDimensions } from './access';
import { FLOOR_PLAN_GEOMETRY_VERSION, floorPlanSupport, getFloorPlanRoofSupport, getBuildingEntrance, getBuildingUsePoints } from './architecture-floor-plan';

export const CITY_LAYOUT_VERSIONS = ['legacy-ee3e7a1', 'current-v2-r5', 'current-v2', 'current-v3', 'current-v4', 'current-v5', 'current-v6', 'current-v7', 'current-v8'] as const;
export type CityLayoutVersion = typeof CITY_LAYOUT_VERSIONS[number];
export const CURRENT_CITY_LAYOUT: CityLayoutVersion = 'current-v6';
export const GEOLOGICAL_GEOMETRY_VERSION = 'yunshan-geology-v3-terraced-cellular-1';
export const ARCHITECTURAL_GEOMETRY_VERSION = FLOOR_PLAN_GEOMETRY_VERSION;
/** current-v8 recipe identities, bound into its saved-world fingerprint. */
export const STREET_RECIPE_VERSION = 'frontage-terrace-streets-1';
export const LOW_RISE_RECIPE_VERSION = 'low-rise-town-1';
export const V8_TERRAIN_RECIPE_VERSION = 'plinth-shoulder-6';

const UNIT = .2;
/** current-v8: width of the step from a building's plinth down to natural ground. */
const PLINTH_SHOULDER = 6;
const q = (n: number) => Math.round(n / UNIT) * UNIT;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const smooth = (n: number) => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Outward normal of a building's front wall, for rotations in quarter turns (0 for every older layout). */
const doorNormal = (b: Pick<Building, 'rotation'>) => ({ x: Math.round(Math.sin(b.rotation)), z: Math.round(Math.cos(b.rotation)) });
/** The point 10 m out from a door: where every door stub leaves the building's clearance. */
const doorLead = (b: Pick<Building, 'rotation'>, door: Vec3): Vec3 => { const n = doorNormal(b); return n.x === 0 && n.z === 1 ? { ...door, z: q(door.z + 10) } : { ...door, x: q(door.x + 10 * n.x), z: q(door.z + 10 * n.z) }; };

interface DistrictPlan { id: string; name: string; kind: string; x: number; z: number; y: number; radius: number; color: string; count: number; kinds: BuildingKind[] }
const plans: DistrictPlan[] = [
  { id: 'river', name: '清溪水岸', kind: 'waterfront', x: -740, z: 980, y: 18, radius: 410, color: '#69b7b0', count: 60, kinds: ['dock', 'market', 'home', 'farm'] },
  { id: 'market', name: '千灯市集', kind: 'market', x: -330, z: 460, y: 52, radius: 420, color: '#dcad69', count: 76, kinds: ['market', 'market', 'home', 'bank'] },
  { id: 'workshop', name: '青铜工坊', kind: 'industry', x: -1190, z: 210, y: 142, radius: 420, color: '#ae906e', count: 62, kinds: ['workshop', 'workshop', 'home', 'farm'] },
  { id: 'west', name: '松风里', kind: 'residential', x: -1080, z: -550, y: 270, radius: 430, color: '#91b7b6', count: 76, kinds: ['home', 'home', 'home', 'market'] },
  { id: 'academy', name: '文澜学苑', kind: 'education', x: -370, z: -410, y: 206, radius: 395, color: '#aebfc6', count: 56, kinds: ['school', 'home', 'clinic', 'home'] },
  { id: 'government', name: '玉衡官署', kind: 'government', x: 500, z: -710, y: 324, radius: 360, color: '#c29b78', count: 48, kinds: ['hall', 'police', 'bank', 'home'] },
  { id: 'core', name: '瀑云天枢', kind: 'civic', x: 400, z: -160, y: 254, radius: 340, color: '#8ec9c9', count: 42, kinds: ['hall', 'station', 'clinic', 'home'] },
  { id: 'summit', name: '九霄观云', kind: 'scenic', x: -60, z: -1250, y: 526, radius: 310, color: '#c9b396', count: 24, kinds: ['pavilion', 'home', 'market', 'hall'] },
  { id: 'east', name: '临岚坊', kind: 'residential', x: 1110, z: -280, y: 190, radius: 430, color: '#c0b4a2', count: 76, kinds: ['home', 'home', 'market', 'clinic'] },
  { id: 'airport', name: '南岫空港', kind: 'airport', x: 1150, z: 900, y: 64, radius: 430, color: '#9fb6c7', count: 48, kinds: ['station', 'workshop', 'market', 'home'] },
  { id: 'starport', name: '云外星港', kind: 'starport', x: 1370, z: -1280, y: 368, radius: 390, color: '#aaa5d2', count: 44, kinds: ['station', 'workshop', 'hall', 'home'] },
];

function random(seed: number) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

interface RoadSegment { edge: NetworkEdge; a: Vec3; b: Vec3 }
interface SpatialIndex { segments: Map<string, RoadSegment[]>; elevated: Map<string, RoadSegment[]>; buildings: Map<string, Building[]>; roads: Map<string, NetworkEdge[]>; indexedEdges: number; quarters: NetworkNode[]; landHeights: Map<string, number> }
const indices = new WeakMap<WorldDefinition, SpatialIndex>();
const landHeightCache = new WeakMap<WorldDefinition, Map<string, number>>();
const CELL = 80;
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
function buckets<T>(map: Map<string, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number) {
  for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
    const k = `${x},${z}`; const list = map.get(k); if (list) { if (!list.includes(item)) list.push(item); } else map.set(k, [item]);
  }
}
function indexFor(world: WorldDefinition) {
  let index = indices.get(world);
  if (!index) {
    // Natural ground depends only on terrain and the quarter stops, so it outlives index rebuilds.
    let land = landHeightCache.get(world); if (!land) { land = new Map(); landHeightCache.set(world, land); }
    index = { segments: new Map(), elevated: new Map(), buildings: new Map(), roads: new Map(), indexedEdges: 0, quarters: world.nodes.filter(n => n.id.includes('-quarter-')), landHeights: land };
    const layout = (world as WorldDefinition & { layoutVersion?: CityLayoutVersion }).layoutVersion;
    const margin = layout === 'current-v2' || layout === 'current-v3' || layout === 'current-v4' || layout === 'current-v5' || layout === 'current-v6' || layout === 'current-v7' || layout === 'current-v8' ? 70 : 14;
    for (const b of world.buildings) {
      let halfWidth = b.width / 2, halfDepth = b.depth / 2;
      if (b.floorPlanProfile) {
        const c = Math.abs(Math.cos(b.rotation)), s = Math.abs(Math.sin(b.rotation));
        halfWidth = (b.width * c + b.depth * s) / 2; halfDepth = (b.width * s + b.depth * c) / 2;
      }
      buckets(index.buildings, b, b.position.x - halfWidth - margin, b.position.x + halfWidth + margin, b.position.z - halfDepth - margin, b.position.z + halfDepth + margin);
    }
    indices.set(world, index);
  }
  while (index.indexedEdges < world.edges.length) {
    const edge = world.edges[index.indexedEdges++];
    if (edge.mode !== 'road' && edge.mode !== 'bridge') {
      if (['maglev', 'lightRail', 'cable'].includes(edge.mode)) for (let i = 1; i < edge.points.length; i++) { const a = edge.points[i - 1], b = edge.points[i]; buckets(index.elevated, { edge, a, b }, Math.min(a.x, b.x) - 9, Math.max(a.x, b.x) + 9, Math.min(a.z, b.z) - 9, Math.max(a.z, b.z) + 9); }
      continue;
    }
    const margin = edge.id.includes('airport-runway-strip') ? 38 : 14;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i];
      buckets(index.roads, edge, Math.min(a.x, b.x) - margin, Math.max(a.x, b.x) + margin, Math.min(a.z, b.z) - margin, Math.max(a.z, b.z) + margin);
      buckets(index.segments, { edge, a, b }, Math.min(a.x, b.x) - margin, Math.max(a.x, b.x) + margin, Math.min(a.z, b.z) - margin, Math.max(a.z, b.z) + margin);
    }
  }
  return index;
}

function nearestSegment(points: Vec3[], x: number, z: number) {
  let result = { distance: Infinity, y: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < result.distance - 1e-7) result = { distance: d, y: a.y + (b.y - a.y) * t };
  }
  return result;
}

/** Smooth mountain massifs, interrupted by actual district terraces and riverbed. */
function naturalHeight(world: WorldDefinition, x: number, z: number) {
  let y = 5;
  for (const m of world.mountains) y += m.height * Math.exp(-2.7 * ((x - m.x) ** 2 + (z - m.z) ** 2) / m.radius ** 2);
  y += Math.sin(x / 160) * Math.cos(z / 210) * 8 + Math.sin((x + z) / 72) * 2.2;
  for (const district of world.districts) {
    const r = Math.hypot(x - district.center.x, z - district.center.z);
    const blend = 1 - smooth((r - district.radius * .62) / (district.radius * .68));
    y += (district.center.y - y) * blend;
  }
  for (const quarter of indices.get(world)?.quarters ?? world.nodes.filter(n => n.id.includes('-quarter-'))) {
    const r = Math.hypot(x - quarter.position.x, z - quarter.position.z);
    const blend = 1 - smooth((r - 70) / 170);
    if (blend > 0) y += (quarter.position.y - .6 - y) * blend;
  }
  // The core's upper lip and the plunge pool are carved from the same landform.
  if (Math.abs(x - world.waterfall.top.x) < 100 && z > -310 && z < 120) {
    const lip = 1 - smooth((z + 85) / 135);
    const side = 1 - smooth((Math.abs(x - world.waterfall.top.x) - 25) / 75);
    const cliffY = world.waterfall.bottom.y - 3 + (world.waterfall.top.y - world.waterfall.bottom.y + 3) * lip;
    y += (cliffY - y) * side;
  }
  const water = nearestSegment(world.river, x, z);
  const riverBlend = 1 - smooth((water.distance - 13) / 30);
  if (riverBlend > 0) y += (water.y - 3 - y) * riverBlend;
  return Math.max(2, y);
}

/** Read-only mountain sample for the render shell's segment-indexed cuttings.
 * It does not change generation, movement surfaces or the city's layout. */
export function naturalTerrainHeight(world: WorldDefinition, x: number, z: number): number {
  return naturalHeight(world, x, z);
}

/** Ground beneath the city: foundations and road cuttings are part of the terrain. */
function planningGroundHeight(world: WorldDefinition, x: number, z: number, includeBasements: boolean, includeRoads = true): number {
  const index = indexFor(world);
  const buildings = index.buildings.get(key(x, z)) ?? [];
  for (const b of buildings) if (Math.abs(x - b.position.x) <= b.width / 2 + 2 && Math.abs(z - b.position.z) <= b.depth / 2 + 2) {
    if (includeBasements && b.basements && Math.abs(x - b.position.x) < b.width / 2 - .8 && Math.abs(z - b.position.z) < b.depth / 2 - .8) return b.position.y - b.basements * b.height / b.floors - .6;
    return b.position.y;
  }
  let y = naturalHeight(world, x, z);
  let roadDistance = Infinity, roadY = y, roadWidth = 5;
  for (const { edge, a, b } of includeRoads ? index.segments.get(key(x, z)) ?? [] : []) {
    if (edge.mode === 'bridge' && edge.from === 'core-lift-top') continue;
    // Bridge decks cross the river without filling the channel beneath them.
    if (edge.mode === 'bridge' && nearestSegment(world.river, x, z).distance < 25) continue;
    const near = nearestSegment([a, b], x, z);
    if (near.distance < roadDistance - 1e-7) { roadDistance = near.distance; roadY = near.y - .6; roadWidth = edge.id.includes('airport-runway-strip') ? 22 : 5; }
  }
  // Elevated carriageways are real supported decks, not tall walls of filled
  // terrain. They also leave the flowing riverbed intact beneath their span.
  if (roadDistance < roadWidth + 14 && (roadWidth === 22 || roadY - y < 12) && nearestSegment(world.river, x, z).distance > 20) y += (roadY - y) * (1 - smooth((roadDistance - roadWidth) / 14));
  for (const b of buildings) {
    const dx = Math.max(0, Math.abs(x - b.position.x) - b.width / 2 - 2);
    const dz = Math.max(0, Math.abs(z - b.position.z) - b.depth / 2 - 2);
    const outside = Math.hypot(dx, dz);
    if (outside < 12) y += (b.position.y - y) * (1 - smooth(outside / 12));
  }
  return y;
}

/** The hydraulic path is shared by the visible sheet and solid world terrain. */
export function getWaterfallPath(world: WorldDefinition): Vec3[] {
  const { top, bottom } = world.waterfall;
  return [top, { x: top.x, y: top.y, z: top.z + 34 }, { x: bottom.x, y: bottom.y, z: top.z + 44 }, bottom];
}

/** Solid jointed rock, sampled by walking, collision and the render shell.
 * The cell tops are broad ledges, their narrow weathered joins are clefts;
 * this is physical relief, never a second decorative surface. */
function geologicalRelief(x: number, z: number, y: number, seed: number): number {
  const gx = (x * .81 + z * .5864) / 24, gz = (z * .81 - x * .5864) / 24;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const cellNoise = (a: number, b: number, salt: number) => {
    let value = Math.imul(a ^ seed, 374761393) ^ Math.imul(b ^ salt, 668265263);
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  };
  let first = Infinity, second = Infinity, height = 0, phase = 0;
  for (let a = ix - 1; a <= ix + 1; a++) for (let b = iz - 1; b <= iz + 1; b++) {
    const dx = gx - a - .25 - cellNoise(a, b, 37) * .5, dz = gz - b - .25 - cellNoise(a, b, 71) * .5;
    const distance = dx * dx + dz * dz;
    if (distance < first) { second = first; first = distance; height = 6 + cellNoise(a, b, 97) * 18; phase = cellNoise(a, b, 113) * 8; }
    else if (distance < second) second = distance;
  }
  const jointWidth = (Math.sqrt(second) - Math.sqrt(first)) * 12;
  const cleft = 1 - smooth(jointWidth / 2.6);
  const terrace = Math.floor((y + phase) / 8) * 8 - phase - y;
  return height - (height + 10) * cleft + terrace * .75;
}

/** Authoritative ground after the generated roads are fixed. Carving preserves
 * every station, road sample, building footprint and floor access contract. */
export function terrainHeight(world: WorldDefinition, x: number, z: number, includeBasements = true): number {
  let y = planningGroundHeight(world, x, z, includeBasements);
  if ((world as WorldDefinition & { layoutVersion?: CityLayoutVersion }).layoutVersion === 'legacy-ee3e7a1') return y;
  const index = indexFor(world), nearby = index.buildings.get(key(x, z)) ?? [];
  if (nearby.some(b => Math.abs(x - b.position.x) <= b.width / 2 + 2 && Math.abs(z - b.position.z) <= b.depth / 2 + 2)) return y;
  let roadGap = Infinity, foundationGap = Infinity, foundationY = y;
  for (const { a, b } of index.segments.get(key(x, z)) ?? []) roadGap = Math.min(roadGap, nearestSegment([a, b], x, z).distance);
  for (const { a, b } of index.elevated.get(key(x, z)) ?? []) roadGap = Math.min(roadGap, nearestSegment([a, b], x, z).distance);
  for (const b of nearby) {
    const dx = Math.max(0, Math.abs(x - b.position.x) - b.width / 2 - 2), dz = Math.max(0, Math.abs(z - b.position.z) - b.depth / 2 - 2), gap = Math.hypot(dx, dz);
    if (gap < foundationGap) { foundationGap = gap; foundationY = b.position.y; }
  }
  // Adjacent houses sit on joined shoulders instead of isolated pointed
  // mounds. The wider shoulder ends before the untouched road centreline.
  // current-v8 plinths: each building stands on its own flat terrace that ends
  // in a steep step a few metres beyond the wall, instead of a 54 m soft hill.
  const terraced = (world as WorldDefinition & { layoutVersion?: CityLayoutVersion }).layoutVersion === 'current-v8', shoulder = terraced ? PLINTH_SHOULDER : 54;
  if (roadGap > 9 && foundationGap < shoulder) y += (foundationY - y) * (1 - smooth(foundationGap / shoulder)) * (terraced ? 1 : .82);
  const reliefWeight = world.buildings.length ? smooth((foundationGap - 10) / 38) * smooth((roadGap - 12) / 20) * smooth((y - 14) / 22) : 0;
  // Long fault ridges and smaller fractures share the collision height. This
  // breaks evenly spaced proxy facets without shifting houses or rail stops.
  const fracture = Math.sin(x * .036 + Math.sin(z * .012) * 1.7) * Math.cos(z * .027) * 3.2 + Math.sin((x + z * .72) * .081) * 1.1;
  y += fracture * reliefWeight;
  const layout = (world as WorldDefinition & { layoutVersion?: CityLayoutVersion }).layoutVersion;
  if (layout === 'current-v3' || layout === 'current-v4' || layout === 'current-v5' || layout === 'current-v6' || layout === 'current-v7' || layout === 'current-v8') y += geologicalRelief(x, z, y, world.seed) * reliefWeight;
  if (roadGap < 9) for (const { edge, a, b } of index.segments.get(key(x, z)) ?? []) if (edge.mode === 'road' && !edge.id.includes('runway')) {
    const near = nearestSegment([a, b], x, z);
    if (near.distance > 7) continue;
    let valley = planningGroundHeight(world, x, z, includeBasements, false);
    if (foundationGap < shoulder) valley += (foundationY - valley) * (1 - smooth(foundationGap / shoulder)) * (terraced ? 1 : .82);
    valley += fracture * smooth((foundationGap - 10) / 38) * smooth((valley - 14) / 22);
    if (near.y - valley > 12) y = Math.min(y, valley);
  }
  const water = nearestSegment(world.river, x, z), width = 15;
  if (water.distance < width + 2) y = Math.min(y, water.y - 2.2 + Math.max(0, water.distance - width) * .5);
  const { top, bottom } = world.waterfall, profile = getWaterfallPath(world);
  const poolDistance = Math.hypot(x - bottom.x, z - bottom.z);
  if (poolDistance < 50) y = Math.min(y, bottom.y - 2.4 + Math.max(0, poolDistance - 42) * .25);
  // The cliff is behind the sheet. A broad opening at its foot removes the
  // foreground bank that previously hid the fall from both inhabited shores.
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i], dx = b.x - a.x, dz = b.z - a.z;
    const projection = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1);
    if (projection < 0 || projection > 1) continue;
    const near = nearestSegment([a, b], x, z);
    const halfWidth = i === 1 ? world.waterfall.width / 2 + 2 : 92;
    if (near.distance < halfWidth) y = Math.min(y, near.y - 3);
  }
  if (z > top.z + 44 && z < 155 && Math.abs(x - top.x) < 135) {
    const bank = smooth((Math.abs(x - top.x) - 92) / 43);
    y = Math.min(y, bottom.y - 3 + bank * Math.max(0, y - bottom.y + 3));
  }
  for (const { edge, a, b } of index.segments.get(key(x, z)) ?? []) if (edge.mode === 'bridge') {
    const near = nearestSegment([a, b], x, z);
    // Clear all sampled cells beneath the deck, including low bridges that
    // were previously embedded in a natural riverbank above the player's head.
    if (near.distance < 6.6) y = Math.min(y, near.y - .8);
  }
  return y;
}

/** The floor/road surface is returned without a camera-eye offset. */
export function getWalkHeight(world: WorldDefinition, x: number, z: number, referenceHeight?: number): number {
  const index = indexFor(world);
  for (const b of index.buildings.get(key(x, z)) ?? []) {
    let halfWidth = b.width / 2, halfDepth = b.depth / 2;
    if (b.floorPlanProfile) {
      const c = Math.abs(Math.cos(b.rotation)), s = Math.abs(Math.sin(b.rotation));
      halfWidth = (b.width * c + b.depth * s) / 2; halfDepth = (b.width * s + b.depth * c) / 2;
    }
    if (!(Math.abs(x - b.position.x) <= halfWidth && Math.abs(z - b.position.z) <= halfDepth)) continue;
    const floor = referenceHeight === undefined ? 0 : clamp(Math.round((referenceHeight - b.position.y - .6) / (b.height / b.floors)), -(b.basements ?? 0), b.floors - 1);
    if (b.floorPlanProfile) {
      // An absent upper wing exposes the actual slab below it. Never replace
      // that slab with the original rectangular envelope or fall through it.
      const reference = { x, y: referenceHeight ?? b.position.y + .6, z };
      let highest = getFloorPlanRoofSupport(b, reference, 0)?.y;
      for (let candidate = floor; candidate >= -(b.basements ?? 0); candidate--) {
        const support = floorPlanSupport(b, candidate, reference, 0);
        // Ground foundations have a real .6m plinth. A higher storey must not
        // attract feet from the air between floors; stairs select real treads.
        if (support && (referenceHeight === undefined || support.y <= referenceHeight + .6 + 1e-8)) highest = Math.max(highest ?? -Infinity, support.y);
      }
      if (highest !== undefined) return highest;
      continue;
    }
    const footprint = getFloorDimensions(b, floor);
    if (Math.abs(x - b.position.x) <= footprint.width / 2 && Math.abs(z - b.position.z) <= footprint.depth / 2) return b.position.y + .6 + floor * b.height / b.floors;
  }
  let nearest = Infinity, y = terrainHeight(world, x, z);
  for (const edge of index.roads.get(key(x, z)) ?? []) {
    const point = nearestSegment(edge.points, x, z);
    const score = referenceHeight === undefined ? point.distance : point.distance + Math.abs(point.y - referenceHeight) * 2;
    if (point.distance <= (edge.id.includes('airport-runway-strip') ? 22 : edge.mode === 'bridge' ? 4 : 5) && score < nearest) { nearest = score; y = point.y; }
  }
  return y;
}

/** Progress is normalized by actual three-dimensional arc length. */
export function samplePolyline(points: Vec3[], progress: number): Vec3 {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  if (points.length === 1 || progress <= 0) return { ...points[0] };
  if (progress >= 1) return { ...points[points.length - 1] };
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  let target = lengths.reduce((a, b) => a + b, 0) * progress;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const a = points[i], b = points[i + 1], t = lengths[i] ? target / lengths[i] : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    target -= lengths[i];
  }
  return { ...points[points.length - 1] };
}

/** Bidirectional Dijkstra; an optional mode restricts the network being used. */
export function findPath(world: WorldDefinition, fromNodeId: string, toNodeId: string, mode?: TransportMode, roadState?: Pick<SimState, 'roadNetwork'>): NetworkNode[] {
  const nodeMap = new Map(world.nodes.map(n => [n.id, n]));
  if (!nodeMap.has(fromNodeId) || !nodeMap.has(toNodeId)) return [];
  const adjacency = new Map<string, { to: string; length: number }[]>();
  for (const edge of world.edges) {
    if (mode && edge.mode !== mode) continue;
    if (roadState && !isRoadOpen(roadState, edge.id)) continue;
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const list = adjacency.get(from) ?? []; list.push({ to, length: edge.length }); adjacency.set(from, list);
    }
  }
  const cost = new Map<string, number>([[fromNodeId, 0]]), previous = new Map<string, string>(), open = new Set([fromNodeId]);
  while (open.size) {
    let current = '', best = Infinity;
    for (const id of open) if ((cost.get(id) ?? Infinity) < best) { current = id; best = cost.get(id)!; }
    if (current === toNodeId) break;
    open.delete(current);
    for (const edge of adjacency.get(current) ?? []) {
      const next = best + edge.length;
      if (next < (cost.get(edge.to) ?? Infinity)) { cost.set(edge.to, next); previous.set(edge.to, current); open.add(edge.to); }
    }
  }
  if (!cost.has(toNodeId)) return [];
  const route = [toNodeId];
  while (route[0] !== fromNodeId) { const before = previous.get(route[0]); if (!before) return []; route.unshift(before); }
  return route.map(id => nodeMap.get(id)!);
}

const dimensions: Record<BuildingKind, [number, number, number]> = {
  home: [25, 22, 4], market: [32, 24, 2], workshop: [44, 32, 2], bank: [34, 30, 5], hall: [42, 34, 4], police: [34, 28, 3], school: [42, 32, 4], clinic: [36, 30, 5], station: [36, 24, 2], core: [84, 66, 16], pavilion: [24, 22, 2], airport: [76, 48, 4], starport: [90, 70, 7], farm: [36, 26, 1], dock: [36, 22, 2],
};
const kindName: Record<BuildingKind, string> = { home: '里居', market: '商肆', workshop: '工坊', bank: '钱庄', hall: '议事堂', police: '巡警署', school: '书院', clinic: '医馆', station: '驿站', core: '瀑云能源天枢', pavilion: '观云亭', airport: '航站楼', starport: '星际候航殿', farm: '梯田农舍', dock: '渡口' };
const civicPlan = [
  { id: 'core-main', name: '天枢阁', kind: 'core' as BuildingKind, x: 430, z: -250, y: 254, width: 144, depth: 112, height: 234, floors: 30, facility: 'mayor', publicFloors: 3, requiredPermission: 'mayor' },
  { id: 'core-admin-east', name: '天枢东翼·行政政务院', kind: 'hall' as BuildingKind, x: 560, z: -250, y: 254, width: 60, depth: 42, height: 48, floors: 8, facility: 'administration', publicFloors: 2, requiredPermission: 'official' },
  { id: 'core-data-west', name: '天枢西翼·数据通讯院', kind: 'workshop' as BuildingKind, x: 300, z: -250, y: 254, width: 60, depth: 42, height: 48, floors: 8, facility: 'data', publicFloors: 1, requiredPermission: 'scientist' },
  { id: 'core-energy-south', name: '天枢南翼·能源调度院', kind: 'workshop' as BuildingKind, x: 430, z: -30, y: 254, width: 60, depth: 42, height: 48, floors: 8, facility: 'energy', publicFloors: 1, requiredPermission: 'driver' },
  { id: 'core-security-north', name: '天枢北翼·应急治安院', kind: 'police' as BuildingKind, x: 430, z: -370, y: 254, width: 60, depth: 42, height: 48, floors: 8, facility: 'emergency', publicFloors: 1, requiredPermission: 'police' },
  { id: 'core-council', name: '天枢议事堂', kind: 'hall' as BuildingKind, x: 270, z: -80, y: 254, width: 72, depth: 50, height: 42, floors: 7, facility: 'council', publicFloors: 2, requiredPermission: 'council' },
  { id: 'core-embassy', name: '云山使节馆', kind: 'hall' as BuildingKind, x: 600, z: -80, y: 254, width: 60, depth: 42, height: 42, floors: 7, facility: 'embassy', publicFloors: 2, requiredPermission: 'official' },
  { id: 'core-archives', name: '天枢下层·城史档案馆', kind: 'hall' as BuildingKind, x: 300, z: -380, y: 246, width: 50, depth: 38, height: 30, floors: 5, facility: 'archives', publicFloors: 1, requiredPermission: 'teacher' },
  { id: 'core-treasury', name: '天枢下层·公共金库', kind: 'bank' as BuildingKind, x: 560, z: -380, y: 246, width: 50, depth: 38, height: 30, floors: 5, facility: 'treasury', publicFloors: 1, requiredPermission: 'mayor' },
  { id: 'core-interchange', name: '天枢轨道换乘殿', kind: 'station' as BuildingKind, x: 675, z: -130, y: 254, width: 60, depth: 40, height: 36, floors: 6 },
  { id: 'core-clinic', name: '天枢急救医馆', kind: 'clinic' as BuildingKind, x: 685, z: -270, y: 254, width: 50, depth: 42, height: 36, floors: 6 },
  { id: 'core-dock-building', name: '瀑云潭·天枢水运码头', kind: 'dock' as BuildingKind, x: 125, z: 155, y: 93.4 },
];

/** Street recipe for the world being generated. `grid4` is every registered
 * layout's original orthogonal router; `smooth` is the R2 street recipe
 * (docs/设计/路网重做方案.md §3.2 A): 8-neighbour A* corridor, cost-bounded
 * string pulling with an exact swept clearance test, clearance-checked Chaikin
 * corners, then the same lattice resample and grading as the original. */
let streetRecipe: 'grid4' | 'smooth' = 'grid4';
/** Smooth recipe only: extra cost per metre for a street cell (door stubs keep
 * out of other streets' decks unless they meet them at the same height). */
let deckPenalty: ((x: number, z: number, deckY: number) => number) | null = null;
/** Street recipe frontage: terrace row spacing, length and vertex step; the door's distance from the street centre. */
const ROW_SPACING = 104, ROW_TIERS = 2, ROW_LENGTH = 240, ROW_STEP = 8, FRONTAGE = 11, FRONTAGE_GAP = 4;
let deckSamples: Map<string, { x: number; z: number }[]> | null = null;
const frontageStreets = new Map<string, Vec3[]>(), frontageGround = new Map<string, number>();
const hashString = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0; return h; };
function routeGround(world: WorldDefinition, start: Vec3, end: Vec3, startBuilding?: Building, clearance = 5): Vec3[] {
  return streetRecipe === 'smooth' ? routeSmooth(world, start, end, startBuilding, clearance) : routeGroundGrid4(world, start, end, startBuilding, clearance);
}
const MAX_GRADE = .2, MIN_SPACING = 4, MAX_SPACING = 24, RIVER_KEEP = 22;
/** Buildings whose 14 × 16 m door forecourt touches each 16 m cell. */
const forecourtIndex = new WeakMap<WorldDefinition, { count: number; cells: Map<string, Building[]> }>();
function forecourtsFor(world: WorldDefinition) {
  let entry = forecourtIndex.get(world);
  if (!entry || entry.count !== world.buildings.length) {
    const cells = new Map<string, Building[]>();
    for (const b of world.buildings) {
      const n = doorNormal(b), xs = [b.door.x - 8, b.door.x + 8, b.door.x + 14 * n.x - 8, b.door.x + 14 * n.x + 8], zs = [b.door.z - 8, b.door.z + 8, b.door.z + 14 * n.z - 8, b.door.z + 14 * n.z + 8];
      for (let x = Math.floor(Math.min(...xs) / 16); x <= Math.floor(Math.max(...xs) / 16); x++) for (let z = Math.floor(Math.min(...zs) / 16); z <= Math.floor(Math.max(...zs) / 16); z++) (cells.get(`${x},${z}`) ?? cells.set(`${x},${z}`, []).get(`${x},${z}`)!).push(b);
    }
    entry = { count: world.buildings.length, cells }; forecourtIndex.set(world, entry);
  }
  return entry.cells;
}
function routeSmooth(world: WorldDefinition, start: Vec3, end: Vec3, startBuilding?: Building, clearance = 5): Vec3[] {
  const GRID = 8, index = indexFor(world), land = index.landHeights;
  const first = startBuilding ? doorLead(startBuilding, start) : start;
  const sx = Math.round(first.x / GRID), sz = Math.round(first.z / GRID);
  const tx = Math.round(end.x / GRID), tz = Math.round(end.z / GRID);
  const vx = end.x - start.x, vz = end.z - start.z, projectedLength = vx * vx + vz * vz || 1;
  const inRect = (b: Building, px: number, pz: number) => Math.abs(px - b.position.x) < b.width / 2 + 5 && Math.abs(pz - b.position.z) < b.depth / 2 + 5;
  const blockedCache = new Map<string, boolean>();
  const blocked = (x: number, z: number) => {
    const id = `${x}:${z}`; const cached = blockedCache.get(id); if (cached !== undefined) return cached;
    const px = x * GRID, pz = z * GRID;
    const result = (index.buildings.get(key(px, pz)) ?? []).some(b => inRect(b, px, pz));
    blockedCache.set(id, result); return result;
  };
  const gridGround = (x: number, z: number) => {
    const id = `${x}:${z}`; let y = land.get(id);
    if (y === undefined) { y = naturalHeight(world, x * GRID, z * GRID); land.set(id, y); }
    return y;
  };
  // Field cost per metre, identical to routeGround's per-cell step cost / GRID.
  const field = (px: number, pz: number, ground: number) => {
    const projection = clamp(((px - start.x) * vx + (pz - start.z) * vz) / projectedLength, 0, 1);
    const plannedGrade = start.y + (end.y - start.y) * projection;
    let c = 1 + Math.min(200, Math.abs(ground + .6 - plannedGrade)) * .35 / GRID;
    if (deckPenalty && Math.hypot(px - end.x, pz - end.z) > 16 && Math.hypot(px - start.x, pz - start.z) > 8) c += deckPenalty(px, pz, ground + .6);
    // Forecourts: a street keeps out of the 14 m in front of a door unless it
    // passes there at the door's own level (a stub can then still reach it).
    if (Math.hypot(px - end.x, pz - end.z) > 16) for (const b of forecourtsFor(world).get(`${Math.floor(px / 16)},${Math.floor(pz / 16)}`) ?? []) {
      if (b === startBuilding) continue;
      const n = doorNormal(b), ax = px - b.door.x, az = pz - b.door.z, ahead = ax * n.x + az * n.z;
      if (ahead > 0 && ahead < 14 && Math.abs(ax * n.z - az * n.x) < 8 && Math.abs(ground + .6 - b.door.y) > 1.5) { c += 10; break; }
    }
    if (clearance > 5) {
      let enclosure = 0;
      for (const b of index.buildings.get(key(px, pz)) ?? []) {
        const gap = Math.max(Math.abs(px - b.position.x) - b.width / 2, Math.abs(pz - b.position.z) - b.depth / 2);
        enclosure = Math.max(enclosure, Math.max(0, clearance - gap) * 8);
      }
      c += enclosure / GRID;
    }
    return c;
  };
  const groundAt = (px: number, pz: number) => {
    const gx = px / GRID, gz = pz / GRID, x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    return (gridGround(x0, z0) * (1 - fx) + gridGround(x0 + 1, z0) * fx) * (1 - fz) + (gridGround(x0, z0 + 1) * (1 - fx) + gridGround(x0 + 1, z0 + 1) * fx) * fz;
  };
  const segmentCost = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 4));
    let total = 0;
    for (let i = 0; i < n; i++) { const t = (i + .5) / n, px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t; total += field(px, pz, groundAt(px, pz)); }
    return total * len / n;
  };
  const search = (diagonal: boolean) => {
    const startKey = `${sx}:${sz}`, targetKey = `${tx}:${tz}`;
    const open: { x: number; z: number; f: number; g: number }[] = [{ x: sx, z: sz, f: 0, g: 0 }];
    const cost = new Map([[startKey, 0]]), previous = new Map<string, string>();
    const pop = () => {
      const root = open[0], last = open.pop()!;
      if (open.length) { open[0] = last; let i = 0; while (true) { const l = i * 2 + 1, r = l + 1; let child = i; if (l < open.length && open[l].f < open[child].f) child = l; if (r < open.length && open[r].f < open[child].f) child = r; if (child === i) break; [open[i], open[child]] = [open[child], open[i]]; i = child; } }
      return root;
    };
    const push = (item: { x: number; z: number; f: number; g: number }) => { open.push(item); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p].f <= item.f) break; open[i] = open[p]; i = p; } open[i] = item; };
    const moves = diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const free = (x: number, z: number) => `${x}:${z}` === targetKey || !blocked(x, z);
    let found = false;
    while (open.length && cost.size < 90000) {
      const current = pop(), id = `${current.x}:${current.z}`;
      if (current.g !== cost.get(id)) continue;
      if (id === targetKey) { found = true; break; }
      for (const [dx, dz] of moves) {
        const x = current.x + dx, z = current.z + dz, next = `${x}:${z}`;
        if (Math.abs(x * GRID) > world.size / 2 || Math.abs(z * GRID) > world.size / 2 || !free(x, z)) continue;
        // No corner cutting: both orthogonal cells free keeps the diagonal outside every +5m rectangle.
        if (dx && dz && (!free(current.x + dx, current.z) || !free(current.x, current.z + dz))) continue;
        const step = dx && dz ? Math.SQRT2 : 1;
        const g = current.g + field(x * GRID, z * GRID, gridGround(x, z)) * GRID * step;
        if (g >= (cost.get(next) ?? Infinity)) continue;
        const ax = Math.abs(x - tx), az = Math.abs(z - tz);
        cost.set(next, g); previous.set(next, id);
        push({ x, z, g, f: g + (diagonal ? Math.max(ax, az) + (Math.SQRT2 - 1) * Math.min(ax, az) : ax + az) * GRID });
      }
    }
    if (!found) throw new Error(`No safe street route from (${start.x},${start.z}) to (${end.x},${end.z})`);
    const reversed = [targetKey]; while (reversed[reversed.length - 1] !== startKey) reversed.push(previous.get(reversed[reversed.length - 1])!);
    return reversed.reverse().map(id => { const [x, z] = id.split(':').map(Number); return { x: x * GRID, y: 0, z: z * GRID }; });
  };
  // Buildings already enclosing a fixed endpoint are exempt, as the grid router's target cell is.
  const exempt = new Set<Building>();
  for (const p of [first, end, { x: sx * GRID, z: sz * GRID }, { x: tx * GRID, z: tz * GRID }]) for (const b of index.buildings.get(key(p.x, p.z)) ?? []) if (inRect(b, p.x, p.z)) exempt.add(b);
  if (startBuilding) exempt.delete(startBuilding);
  const riverGap = (px: number, pz: number) => nearestSegment(world.river, px, pz).distance;
  // Exact swept test of a segment against every (+5m) building rectangle.
  const segmentClear = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const seen = new Set<Building>();
    for (let cx = Math.floor(Math.min(a.x, b.x) / CELL); cx <= Math.floor(Math.max(a.x, b.x) / CELL); cx++) for (let cz = Math.floor(Math.min(a.z, b.z) / CELL); cz <= Math.floor(Math.max(a.z, b.z) / CELL); cz++) for (const bd of index.buildings.get(`${cx},${cz}`) ?? []) {
      if (seen.has(bd)) continue; seen.add(bd);
      // A building already enclosing an endpoint's margin still keeps its walls.
      const margin = exempt.has(bd) ? 0 : 5, hx = bd.width / 2 + margin, hz = bd.depth / 2 + margin, dx = b.x - a.x, dz = b.z - a.z;
      let t0 = 0, t1 = 1, ok = true;
      for (const [p, d, lo, hi] of [[a.x, dx, bd.position.x - hx, bd.position.x + hx], [a.z, dz, bd.position.z - hz, bd.position.z + hz]]) {
        if (Math.abs(d) < 1e-12) { if (p <= lo || p >= hi) { ok = false; break; } continue; }
        let u0 = (lo - p) / d, u1 = (hi - p) / d; if (u0 > u1) [u0, u1] = [u1, u0];
        t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 >= t1) { ok = false; break; }
      }
      if (ok) return false;
    }
    return true;
  };
  const riverOk = (a: { x: number; z: number }, b: { x: number; z: number }, allowNear: boolean) => {
    if (allowNear) return true;
    const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 6));
    for (let i = 0; i <= n; i++) if (riverGap(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n) < RIVER_KEEP) return false;
    return true;
  };
  const head = startBuilding ? [start, first] : [start];
  const horizontal = (pts: { x: number; z: number }[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.z - pts[i].z), 0);
  const minimumLength = Math.abs(end.y - start.y) / MAX_GRADE;
  const headLength = startBuilding ? Math.hypot(first.x - start.x, first.z - start.z) : 0;
  const pull = (control: Vec3[]) => {
    // control[0] is the fixed lead point; string pulling keeps cost <= the A* corridor cost.
    const n = control.length, near = control.map(p => riverGap(p.x, p.z) < RIVER_KEEP);
    const segCost: number[] = [0], segLen: number[] = [0];
    for (let i = 1; i < n; i++) { segCost.push(segCost[i - 1] + segmentCost(control[i - 1], control[i])); segLen.push(segLen[i - 1] + Math.hypot(control[i].x - control[i - 1].x, control[i].z - control[i - 1].z)); }
    let budget = segLen[n - 1] + headLength - minimumLength; // horizontal metres that may still be removed
    const out = [control[0]]; let i = 0;
    while (i < n - 1) {
      let best = i + 1, fails = 0, nearSpan = near[i];
      for (let j = i + 2; j < n && j - i <= 90; j++) {
        nearSpan = nearSpan || near[j - 1] || near[j];
        const saved = segLen[j] - segLen[i] - Math.hypot(control[j].x - control[i].x, control[j].z - control[i].z);
        if (saved <= budget && segmentClear(control[i], control[j]) && riverOk(control[i], control[j], nearSpan) && segmentCost(control[i], control[j]) <= (segCost[j] - segCost[i]) * 1.0 + 1e-9) { best = j; fails = 0; }
        else if (++fails > 10) break;
      }
      budget -= segLen[best] - segLen[i] - Math.hypot(control[best].x - control[i].x, control[best].z - control[i].z);
      out.push(control[best]); i = best;
    }
    return out;
  };
  const chaikin = (pts: Vec3[], iterations: number) => {
    let current = pts.map(p => ({ x: p.x, y: 0, z: p.z }));
    for (let it = 0; it < iterations; it++) {
      const next: Vec3[] = [current[0]];
      for (let i = 1; i < current.length - 1; i++) {
        const a = current[i - 1], b = current[i], c = current[i + 1];
        const la = Math.hypot(b.x - a.x, b.z - a.z), lc = Math.hypot(c.x - b.x, c.z - b.z);
        const cut = Math.min(it === 0 ? 36 : 1e9, .25 * la, .25 * lc);
        const p = { x: b.x + (a.x - b.x) * cut / la, y: 0, z: b.z + (a.z - b.z) * cut / la };
        const r = { x: b.x + (c.x - b.x) * cut / lc, y: 0, z: b.z + (c.z - b.z) * cut / lc };
        // Only the new chord leaves the already-cleared polyline.
        if (cut > .5 && segmentClear(p, r) && riverOk(p, r, riverGap(b.x, b.z) < RIVER_KEEP)) next.push(p, r);
        else { next.push(b); }
      }
      next.push(current[current.length - 1]);
      if (horizontal(next) + headLength < minimumLength) break;
      current = next;
    }
    return current;
  };
  const build = (cells: Vec3[], doPull: boolean) => {
    const control: Vec3[] = [first, ...cells, end];
    const pulled = doPull ? pull(control) : control;
    return chaikin(pulled, 4);
  };
  let curve = build(search(true), true);
  if (horizontal(curve) + headLength < minimumLength - 1e-6) {
    curve = build(search(false), true);
    if (horizontal(curve) + headLength < minimumLength - 1e-6) return routeGroundGrid4(world, start, end, startBuilding, clearance);
  }
  // Drop vertices within one lattice unit of the chord (Douglas-Peucker), then
  // subdivide long straights and keep >= MIN_SPACING between lattice points.
  const keep = new Array(curve.length).fill(false); keep[0] = keep[curve.length - 1] = true;
  const stack: [number, number][] = [[0, curve.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!; let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) { const d = nearestSegment([curve[i], curve[j]], curve[k].x, curve[k].z).distance; if (d > worst) { worst = d; at = k; } }
    if (worst > UNIT) { keep[at] = true; stack.push([i, at], [at, j]); }
  }
  const simplified = [...head, ...curve.filter((_, i) => keep[i]).slice(startBuilding ? 1 : 1)];
  if (startBuilding) simplified.splice(1, 0); // head already includes first
  const dense: Vec3[] = [];
  for (let i = 1; i < simplified.length; i++) {
    const a = simplified[i - 1], b = simplified[i], steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / MAX_SPACING));
    for (let j = i === 1 ? 0 : 1; j <= steps; j++) { const t = j / steps; dense.push({ x: q(a.x + (b.x - a.x) * t), y: 0, z: q(a.z + (b.z - a.z) * t) }); }
  }
  for (let i = dense.length - 2; i > 0; i--) if (Math.hypot(dense[i].x - dense[i + 1].x, dense[i].z - dense[i + 1].z) < MIN_SPACING || Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z) < MIN_SPACING) dense.splice(i, 1);
  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  const length = cumulative[cumulative.length - 1];
  for (let i = 0; i < dense.length; i++) dense[i].y = q(start.y + (end.y - start.y) * (length ? cumulative[i] / length : 0));
  dense[0] = { ...start }; dense[dense.length - 1] = { ...end };
  // Final swept check of the lattice polyline against every actual footprint:
  // resampling may move a chord; such a route keeps the original router.
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i];
    for (let cx = Math.floor(Math.min(a.x, b.x) / CELL); cx <= Math.floor(Math.max(a.x, b.x) / CELL); cx++) for (let cz = Math.floor(Math.min(a.z, b.z) / CELL); cz <= Math.floor(Math.max(a.z, b.z) / CELL); cz++)
      for (const bd of index.buildings.get(`${cx},${cz}`) ?? []) if (segmentEntersFootprint(a, b, bd)) return routeGroundGrid4(world, start, end, startBuilding, clearance);
  }
  return dense;
}

/** True when segment a-b passes through the open interior of a footprint. */
function segmentEntersFootprint(a: Vec3, b: Vec3, building: Building): boolean {
  let t0 = 0, t1 = 1;
  for (const [p, d, c, half] of [[a.x, b.x - a.x, building.position.x, building.width / 2], [a.z, b.z - a.z, building.position.z, building.depth / 2]]) {
    const lo = c - half + 1e-6, hi = c + half - 1e-6;
    if (Math.abs(d) < 1e-12) { if (p <= lo || p >= hi) return false; continue; }
    let u0 = (lo - p) / d, u1 = (hi - p) / d; if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1); if (t0 >= t1) return false;
  }
  return true;
}

/** Orthogonal obstacle routing keeps every connector outside all building walls. */
function routeGroundGrid4(world: WorldDefinition, start: Vec3, end: Vec3, startBuilding?: Building, clearance = 5): Vec3[] {
  const GRID = 8;
  const first = startBuilding ? doorLead(startBuilding, start) : start;
  const sx = Math.round(first.x / GRID), sz = Math.round(first.z / GRID);
  const tx = Math.round(end.x / GRID), tz = Math.round(end.z / GRID);
  const coordinateKey = (x: number, z: number) => `${x}:${z}`;
  const startKey = coordinateKey(sx, sz), targetKey = coordinateKey(tx, tz);
  const blockedCache = new Map<string, boolean>();
  const land = indexFor(world).landHeights;
  const vx = end.x - start.x, vz = end.z - start.z, projectedLength = vx * vx + vz * vz || 1;
  const blocked = (x: number, z: number) => {
    const id = coordinateKey(x, z); const cached = blockedCache.get(id); if (cached !== undefined) return cached;
    const px = x * GRID, pz = z * GRID;
    const result = (indexFor(world).buildings.get(key(px, pz)) ?? []).some(b => Math.abs(px - b.position.x) < b.width / 2 + 5 && Math.abs(pz - b.position.z) < b.depth / 2 + 5);
    blockedCache.set(id, result); return result;
  };
  const open: { x: number; z: number; f: number; g: number }[] = [{ x: sx, z: sz, f: 0, g: 0 }];
  const cost = new Map([[startKey, 0]]), previous = new Map<string, string>();
  let found = false;
  // The heap permits long city-wide roads without quadratic frontier scans.
  const pop = () => {
    const root = open[0], last = open.pop()!;
    if (open.length) { open[0] = last; let i = 0; while (true) { const l = i * 2 + 1, r = l + 1; let child = i; if (l < open.length && open[l].f < open[child].f) child = l; if (r < open.length && open[r].f < open[child].f) child = r; if (child === i) break; [open[i], open[child]] = [open[child], open[i]]; i = child; } }
    return root;
  };
  const push = (item: { x: number; z: number; f: number; g: number }) => { open.push(item); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p].f <= item.f) break; open[i] = open[p]; i = p; } open[i] = item; };
  while (open.length && cost.size < 90000) {
    const current = pop(), id = coordinateKey(current.x, current.z);
    if (current.g !== cost.get(id)) continue;
    if (id === targetKey) { found = true; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx, z = current.z + dz, next = coordinateKey(x, z);
      if (Math.abs(x * GRID) > world.size / 2 || Math.abs(z * GRID) > world.size / 2 || (next !== targetKey && blocked(x, z))) continue;
      let originalGround = land.get(next);
      if (originalGround === undefined) { originalGround = naturalHeight(world, x * GRID, z * GRID); land.set(next, originalGround); }
      const projection = clamp(((x * GRID - start.x) * vx + (z * GRID - start.z) * vz) / projectedLength, 0, 1);
      const plannedGrade = start.y + (end.y - start.y) * projection;
      const terrainCost = Math.min(200, Math.abs(originalGround + .6 - plannedGrade)) * .35;
      // Wider bridges prefer open water. Keep the ordinary five-metre exit
      // corridors usable where a station is enclosed by the old town fabric.
      let enclosureCost = 0;
      if (clearance > 5) {
        const px = x * GRID, pz = z * GRID;
        for (const b of indexFor(world).buildings.get(key(px, pz)) ?? []) {
          const gap = Math.max(Math.abs(px - b.position.x) - b.width / 2, Math.abs(pz - b.position.z) - b.depth / 2);
          enclosureCost = Math.max(enclosureCost, Math.max(0, clearance - gap) * 8);
        }
      }
      const g = current.g + GRID + terrainCost + enclosureCost;
      if (g >= (cost.get(next) ?? Infinity)) continue;
      cost.set(next, g); previous.set(next, id); push({ x, z, g, f: g + (Math.abs(x - tx) + Math.abs(z - tz)) * GRID });
    }
  }
  if (!found) throw new Error(`No safe street route from (${start.x},${start.z}) to (${end.x},${end.z})`);
  const reversed = [targetKey]; while (reversed[reversed.length - 1] !== startKey) reversed.push(previous.get(reversed[reversed.length - 1])!);
  const path = reversed.reverse().map(id => { const [x, z] = id.split(':').map(Number); return { x: x * GRID, y: 0, z: z * GRID }; });
  const points = startBuilding ? [start, { ...start, z: sz * GRID }, ...path, end] : [start, ...path, end];
  const simplified: Vec3[] = [];
  for (const point of points) {
    if (simplified.length && Math.hypot(point.x - simplified[simplified.length - 1].x, point.z - simplified[simplified.length - 1].z) < .01) continue;
    if (simplified.length > 1) {
      const a = simplified[simplified.length - 2], b = simplified[simplified.length - 1];
      if ((b.x - a.x) * (point.z - b.z) === (b.z - a.z) * (point.x - b.x) && (b.x - a.x) * (point.x - b.x) + (b.z - a.z) * (point.z - b.z) > 0) simplified.pop();
    }
    simplified.push(point);
  }
  // Resample long sections: roads adapt to land instead of cutting arbitrary straight ramps.
  const dense: Vec3[] = [];
  for (let i = 1; i < simplified.length; i++) {
    const a = simplified[i - 1], b = simplified[i], steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 24));
    for (let j = i === 1 ? 0 : 1; j <= steps; j++) { const t = j / steps; const x = q(a.x + (b.x - a.x) * t), z = q(a.z + (b.z - a.z) * t); dense.push({ x, y: 0, z }); }
  }
  for (let i = dense.length - 2; i > 0; i--) if (Math.hypot(dense[i].x - dense[i + 1].x, dense[i].z - dense[i + 1].z) < 3 || Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z) < 3) dense.splice(i, 1);
  // Continuous grades connect the designed terrace elevations. The terrain is cut
  // to these roads below, avoiding tiny climbs caused by a hill sampled between slabs.
  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  const length = cumulative[cumulative.length - 1];
  for (let i = 0; i < dense.length; i++) dense[i].y = q(start.y + (end.y - start.y) * (length ? cumulative[i] / length : 0));
  dense[0] = { ...start }; dense[dense.length - 1] = { ...end };
  return dense;
}

/** The R2 rebuilt world (docs/设计/世界重建总方案.md): `current-v8`. */
export function createStreetWorld(seed = 20261001): WorldDefinition & { layoutVersion: CityLayoutVersion } {
  return createWorld(seed, 'current-v8');
}

export function createWorld(seed = 20261001, layoutVersion: CityLayoutVersion = CURRENT_CITY_LAYOUT): WorldDefinition & { layoutVersion: CityLayoutVersion } {
  if (!CITY_LAYOUT_VERSIONS.includes(layoutVersion)) throw new Error('Unknown city layout version');
  if (layoutVersion === 'current-v8') {
    // R2 rebuilt world: the v5 generator with the smooth street router, shared
    // door streets, an explicit road fleet and the low-rise town (decision 1).
    // It has no commercial tower step. Saves bind to its own fingerprint.
    const previous = streetRecipe; streetRecipe = 'smooth';
    try {
      const base = createWorld(seed, 'current-v5');
      base.layoutVersion = 'current-v8';
      indices.delete(base);
      return base;
    } finally { streetRecipe = previous; }
  }
  if (layoutVersion === 'current-v7') {
    const base = createWorld(seed, 'current-v6');
    applyMarketStationApron(base);
    base.layoutVersion = 'current-v7';
    indices.delete(base);
    return base;
  }
  if (layoutVersion === 'current-v6') {
    const base = createWorld(seed, 'current-v5');
    applyCommercialDistrict(base);
    base.layoutVersion = 'current-v6';
    // Ground, graph and every unselected site retain the actual v5 recipe.
    indices.delete(base);
    return base;
  }
  const currentLayout = layoutVersion !== 'legacy-ee3e7a1', historicR5 = layoutVersion === 'current-v2-r5', rng = random(seed);
  const districts: District[] = plans.map(p => ({ id: p.id, name: p.name, kind: p.kind, center: { x: p.x, y: p.y, z: p.z }, radius: p.radius, color: p.color, population: p.count * 38 }));
  const world: WorldDefinition & { layoutVersion: CityLayoutVersion } = {
    layoutVersion: historicR5 ? 'current-v2' : layoutVersion, seed, voxelSize: UNIT, size: 4400, districts, buildings: [], nodes: [], edges: [],
    mountains: [
      { x: -60, z: -1300, height: 505, radius: 650 }, { x: -1170, z: -540, height: 300, radius: 600 },
      { x: 590, z: -760, height: 290, radius: 590 }, { x: 1360, z: -1250, height: 345, radius: 560 },
      { x: -1400, z: 260, height: 180, radius: 540 }, { x: 1140, z: -180, height: 175, radius: 560 },
      { x: -1690, z: -1730, height: 510, radius: 570 }, { x: 700, z: -2040, height: 590, radius: 520 },
      { x: 1930, z: -560, height: 400, radius: 420 }, { x: -2010, z: 690, height: 270, radius: 460 },
    ],
    spawn: { x: -330, y: 52.6, z: 487 },
    waterfall: { top: { x: 110, y: 256, z: -105 }, bottom: { x: 110, y: 103, z: 35 }, width: 24 },
    river: [{ x: 110, y: 103, z: 35 }, { x: 75, y: 94, z: 140 }, { x: -65, y: 75, z: 260 }, { x: -110, y: 56, z: 460 }, { x: -410, y: 30, z: 720 }, { x: -580, y: 15, z: 1010 }, { x: -480, y: 10, z: 1300 }, { x: -850, y: 8, z: 1900 }, { x: -750, y: 6, z: 2200 }],
  };
  const buildingAnchors = new Map<string, NetworkNode>();
  const quarters = new Map<string, NetworkNode[]>();
  // Four named sub-neighbourhoods follow different shoulders of each mountain.
  // Each has a real local stop and street network; broad woodland corridors stay empty.
  const quarterOffsets: Record<string, [number, number, number][]> = {
    river: [[-190, -110, 6], [-190, 170, -2], [70, -200, 12], [170, 190, 0]],
    market: [[-210, -115, 18], [-180, 190, -10], [160, -175, 26], [120, 205, -16]],
    workshop: [[-215, -145, 28], [-220, 155, -20], [180, -130, 18], [150, 205, -30]],
    west: [[-210, -170, 42], [-240, 110, 18], [195, -110, 4], [120, 235, -32]],
    academy: [[-190, -145, 22], [-170, 150, -8], [170, -135, 32], [155, 190, -22]],
    government: [[-160, -145, 32], [-150, 170, -24], [180, -160, 20], [215, 130, -34]],
    core: [[-170, 195, -16], [320, 120, -20], [-130, -480, 40], [300, -450, 44]],
    summit: [[-160, -75, 12], [-140, 165, -32], [150, -120, 8], [155, 140, -26]],
    east: [[-190, -190, 34], [-190, 155, -22], [230, -95, 42], [185, 205, -28]],
    airport: [[-220, -150, 0], [-210, 165, 0], [210, -155, 0], [205, 180, 0]],
    starport: [[-170, -180, 20], [-205, 145, -26], [205, -130, 34], [180, 185, -18]],
  };
  for (const p of plans) {
    world.nodes.push({ id: `${p.id}-station`, districtId: p.id, name: `${p.name}站`, position: { x: p.x, y: p.y + .6, z: p.z }, station: true });
    const names = p.kind === 'residential' ? ['松庭里', '云阶里', '望山坊', '水月坊'] : p.id === 'market' ? ['钱庄街', '灯市街', '云锦街', '百味街'] : p.id === 'workshop' ? ['铸造院', '木作院', '制造院', '工匠里'] : ['北岭院', '西溪院', '东岚院', '南坡院'];
    const local = quarterOffsets[p.id].map(([dx, dz, dy], i) => ({ id: `${p.id}-quarter-${i}`, districtId: p.id, name: `${p.name}·${names[i]}驿`, position: { x: p.x + dx, y: q(Math.max(8, p.y + dy) + .6), z: p.z + dz }, station: true }));
    world.nodes.push(...local); quarters.set(p.id, local);
  }
  const intersects = (x: number, z: number, width: number, depth: number, otherX: number, otherZ: number, otherWidth: number, otherDepth: number, margin = 16) => Math.abs(otherX - x) < (otherWidth + width) / 2 + margin && Math.abs(otherZ - z) < (otherDepth + depth) / 2 + margin;
  const safeSite = (x: number, z: number, width: number, depth: number, facing = 1, stationsOnly = false, gap = 16) => {
    if (Math.abs(x) + width / 2 > 2120 || Math.abs(z) + depth / 2 > 2120) return false;
    if (z + depth / 2 > 1435 && z - depth / 2 < 1545 && x + width / 2 > 650 && x - width / 2 < 1730) return false;
    if (nearestSegment(world.river, x, z).distance < Math.hypot(width, depth) / 2 + 30) return false;
    if (currentLayout && Math.abs(x - world.waterfall.top.x) < width / 2 + 135 && z + depth / 2 > world.waterfall.top.z - 20 && z - depth / 2 < 155) return false;
    // A frontage lot may line a street junction; only stations keep their apron.
    if (world.nodes.some(n => (!stationsOnly || n.station) && intersects(x, z, width, depth, n.position.x, n.position.z, 42, 42, 4))) return false;
    if (civicPlan.some(c => intersects(x, z, width, depth, c.x, c.z, 'width' in c ? c.width! : 36, 'depth' in c ? c.depth! : 24))) return false;
    return !world.buildings.some(b => intersects(x, z, width, depth, b.position.x, b.position.z, b.width, b.depth, gap)
      || intersects(x, z, width, depth, b.door.x, b.door.z + 12 * doorNormal(b).z, 14, 24, 2)
      || intersects(x, z + (depth / 2 + 12) * facing, 14, 24, b.position.x, b.position.z, b.width, b.depth, 2));
  };
  // Street recipe: civic buildings first, then streets, then every other
  // building on a frontage lot along those streets (frontageSite below).
  const frontageLots = new Map<string, Vec3>();
  function placeBuilding(districtIndex: number, p: DistrictPlan, i: number, frontage: boolean) {
    const localStops = quarters.get(p.id)!;
    {
      const civic = p.id === 'core' ? civicPlan[i] : undefined;
      const localIndex = p.id === 'core' ? Math.max(0, i - civicPlan.length) : i;
      const quarter = localIndex % localStops.length, within = Math.floor(localIndex / localStops.length), anchor = localStops[quarter];
      const ring = Math.floor(within / 6), angle = within % 6 / 6 * Math.PI * 2 + districtIndex * .31 + quarter * .63 + ring * .45;
      let kind = p.kinds[(within + quarter) % p.kinds.length];
      if (i === 0 && p.id === 'summit') kind = 'pavilion';
      if (i === 0 && p.id === 'airport') kind = 'airport';
      if (i === 0 && p.id === 'starport') kind = 'starport';
      if (civic) kind = civic.kind;
      const dim = dimensions[kind];
      let designWidth = dim[0], designDepth = dim[1], floors = dim[2];
      if (kind === 'home') { designWidth = [42, 30, 36, 32][quarter]; designDepth = [34, 26, 30, 28][quarter]; floors = [4, 8, 12, 6][quarter] + within % 3 - 1; }
      if (kind === 'market') { designWidth = quarter === 0 ? 44 : 34; designDepth = quarter === 0 ? 34 : 28; floors = 2 + within % 3; }
      if (kind === 'bank') { designWidth = 44; designDepth = 36; floors = p.id === 'market' ? 12 + within % 4 : 7 + within % 3; }
      if (kind === 'workshop') { designWidth = 54; designDepth = 42; floors = 3 + within % 3; }
      if (kind === 'school') { designWidth = 62; designDepth = 46; floors = 5 + within % 2; }
      if (kind === 'clinic') { designWidth = 50; designDepth = 38; floors = 7 + within % 3; }
      if (kind === 'hall') { designWidth = 56; designDepth = 42; floors = 6 + within % 3; }
      if (kind === 'police') { designWidth = 42; designDepth = 34; floors = 5; }
      if (kind === 'station') { designWidth = 44; designDepth = 32; floors = 3; }
      if (kind === 'airport') { designWidth = 120; designDepth = 70; floors = 6; }
      if (kind === 'starport') { designWidth = 130; designDepth = 90; floors = 14; }
      if (kind === 'pavilion') floors = 1;
      if (streetRecipe === 'smooth' && !civic) {
        // Decision 1 (docs/设计/世界重建总方案.md §5): a terraced low-rise town.
        // Homes are 2–4 storey courtyard houses; markets and the market
        // district's banks may rise to 5–7 storey pavilions; only Tianshu stays tall.
        const lowRise: Partial<Record<BuildingKind, number>> = {
          home: Math.min(4, 2 + (quarter + within) % 3), market: 2 + within % 2, workshop: 2 + within % 2, school: 2 + within % 2,
          clinic: 3 + within % 2, hall: 3 + within % 2, police: 3, bank: p.id === 'market' ? 5 + within % 3 : 3 + within % 2,
          station: 2, airport: 4, starport: 6,
        };
        floors = lowRise[kind] ?? floors;
      }
      const width = 'width' in (civic ?? {}) ? civic!.width! : Math.round(designWidth * (.94 + rng() * .12) / .4) * .4;
      const depth = 'depth' in (civic ?? {}) ? civic!.depth! : Math.round(designDepth * (.94 + rng() * .12) / .4) * .4;
      if (civic && 'floors' in civic) floors = civic.floors!;
      const baseRadius = 88 + ring * 64;
      let x = q(anchor.position.x + Math.cos(angle) * baseRadius), z = q(anchor.position.z + Math.sin(angle) * baseRadius);
      let placed = false;
      const facesStop = (k: BuildingKind, siteZ: number) => streetRecipe === 'smooth' && !civic && !['station', 'airport', 'starport', 'pavilion', 'core'].includes(k) && siteZ > anchor.position.z + 6;
      if (civic) { x = civic.x; z = civic.z; placed = true; }
      else if (i === 0 && ['summit', 'airport', 'starport'].includes(p.id)) {
        x = p.x; z = p.z - (p.id === 'summit' ? 105 : 115);
        placed = safeSite(x, z, width, depth);
      }
      let frontRotation: number | null = null, frontY: number | null = null;
      if (!placed && frontage) {
        // Lots pack outward from the quarter stop: compact terraced clusters, as the concept art.
        const lot = frontageSite(p.id, { x: anchor.position.x, z: anchor.position.z }, width, depth, ['pavilion', 'core'].includes(kind));
        if (lot) { x = lot.x; z = lot.z; frontRotation = lot.rotation; frontY = lot.y; placed = true; frontageLots.set(`${p.id}-b${i}`, lot.street); }
      }
      if (!placed) for (let attempt = 0; attempt < (frontage ? 900 : 300); attempt++) {
        const r = baseRadius + Math.floor(attempt / 12) * 11;
        const theta = angle + ((attempt % 12) - 5) * .19;
        x = q(anchor.position.x + Math.cos(theta) * r); z = q(anchor.position.z + Math.sin(theta) * r);
        // Street recipe: the streets already exist, so a fallback site also keeps clear of them.
        if (safeSite(x, z, width, depth, facesStop(kind, z) ? -1 : 1) && (!frontage || clearOfDecks(x, z, width / 2 + 5.5, depth / 2 + 5.5))) { placed = true; break; }
      }
      if (!placed) throw new Error(`No buildable site for ${p.id}/${i}`);
      // current-v8: a building beyond its quarter stop turns to face it (door toward −z).
      const rotation = frontRotation ?? (!civic && facesStop(kind, z) ? Math.PI : 0);
      const terrace = ring * 4 + Math.round(Math.sin(angle)) * 2;
      const ground = naturalHeight(world, x, z);
      const terraceTarget = anchor.position.y - .6 + (p.id === 'airport' ? 0 : terrace);
      const y = q(civic?.y ?? frontY ?? clamp(terraceTarget, ground - 8, ground + 14));
      const storeyHeight: Record<BuildingKind, number> = { home: 3.4, market: 3.6, workshop: 4.8, bank: 4.4, hall: 4.2, police: 3.8, school: 3.8, clinic: 3.8, station: 4.2, core: 7.8, pavilion: 12.8, airport: 6, starport: 6.6, farm: 3.6, dock: 3.8 };
      const targetHeight = civic && 'height' in civic ? civic.height! : currentLayout ? floors * storeyHeight[kind] : floors * (kind === 'bank' ? 4.8 : kind === 'hall' ? 5.2 : kind === 'airport' ? 6 : kind === 'starport' ? 6.6 : 4) + (kind === 'pavilion' ? 8 : 4.8 + within % 3 * 1.6);
      // Floors, including upper rooms and basement slabs, share the voxel lattice.
      const height = q(Math.round(targetHeight / floors / UNIT) * UNIT * floors);
      const building: Building = { id: civic?.id ?? `${p.id}-b${i}`, districtId: p.id, name: civic?.name ?? `${p.name}·${anchor.name.split('·')[1].replace('驿', '')}·${kindName[kind]}${within + 1}`, kind, position: { x, y, z }, width, depth, height, floors, rotation, door: { x, y: q(y + .6), z: q(z + (rotation ? -depth : depth) / 2) }, capacity: floors * Math.floor(width * depth / 32), seed: Math.floor(rng() * 0x7FFFFFFF) };
      if (civic && 'facility' in civic) {
        Object.assign(building, { facility: civic.facility, publicFloors: civic.publicFloors, requiredPermission: civic.requiredPermission });
        building.floorUses = Array.from({ length: floors }, (_, f) => f < civic.publicFloors! ? '公共服务与展览' : civic.name.split('·')[1] ?? '市政办公');
        building.floorPermissions = Array.from({ length: floors }, (_, f) => f < civic.publicFloors! ? 'public' : civic.requiredPermission!);
      }
      if (kind === 'core') {
        building.basements = 2;
        building.basementUses = ['城史档案、城市数据保管与机密设施', '公共金库与财政储备'];
        building.floorUses = ['市民接待大厅', '政务公开与办事大厅', '城市博物馆与瀑布展廊', '城市行政协调', '土地与建设管理', '公共交通调度', '能源调度', '环境与水务', '教育与公共文化', '医疗与福利', '城市数据中心', '通讯与信息网络', '科学研究协调', '公共财政', '贸易与公司监管', '法务与行政监察', '应急指挥', '治安统筹', '灾害应对', '议会听证', '议会议事', '政策研究', '城市规划', '使节接待', '公务协调', '市长事务厅', '市长决策厅', '全城指挥厅', '市政成就展览', '云山全景观景台'];
        building.floorPermissions = ['public', 'public', 'public', 'official', 'official', 'driver', 'driver', 'scientist', 'teacher', 'official', 'scientist', 'scientist', 'scientist', 'official', 'official', 'official', 'police', 'police', 'police', 'public', 'council', 'council', 'official', 'official', 'official', 'mayor', 'mayor', 'mayor', 'public', 'public'];
        const tiers = [[144, 112], [126, 98], [108, 84], [90, 70], [72, 56]];
        Object.assign(building, { floorFootprints: Array.from({ length: floors }, (_, floor) => ({ width: tiers[Math.floor(floor / 6)][0], depth: tiers[Math.floor(floor / 6)][1] })) });
      }
      // Select the corrected physical stair recipe before any body/use-point
      // generation. Every older recipe deliberately retains its original grid.
      if (layoutVersion === 'current-v5') building.stairGeometryRevision = 2;
      if ((layoutVersion === 'current-v4' || layoutVersion === 'current-v5') && kind !== 'core' && kind !== 'pavilion') {
        building.floorPlanProfile = 'v4-program-bodies-02';
        const entrance = getBuildingEntrance(building);
        building.door = { x: q(entrance.x), y: q(entrance.y), z: q(entrance.z) };
        building.functionPoints = Array.from({ length: floors }, (_, floor) => getBuildingUsePoints(building, floor)).flat();
      }
      world.buildings.push(building);
      if (!civic) {
        // An overflow courtyard can lie on the next mountain shoulder. Connect it
        // to a reachable stop at that elevation rather than a tall artificial plinth.
        const reachable = world.nodes.filter(n => n.station && Math.abs(n.position.y - building.door.y) <= Math.hypot(n.position.x - building.door.x, n.position.z - building.door.z) * .18);
        const attachment = reachable.reduce((nearest, n) => distance(n.position, building.door) < distance(nearest.position, building.door) ? n : nearest, reachable[0] ?? anchor);
        buildingAnchors.set(building.id, attachment);
      }
    }
  }
  const order = new Map<string, number>();
  for (const [districtIndex, p] of plans.entries()) for (let i = 0; i < p.count; i++) {
    order.set(p.id === 'core' && civicPlan[i] ? civicPlan[i].id : `${p.id}-b${i}`, order.size);
    // The street recipe places only the civic core now; the rest follow the streets.
    if (streetRecipe !== 'smooth' || p.id === 'core' && civicPlan[i]) placeBuilding(districtIndex, p, i, false);
  }
  const addEdge = (from: string, to: string, mode: TransportMode, points: Vec3[], capacity = 100) => {
    world.edges.push({ id: `${mode}-${from}-${to}`, from, to, mode, points, length: points.slice(1).reduce((total, b, i) => total + distance(points[i], b), 0), capacity });
  };
  const station = (id: string) => world.nodes.find(n => n.id === `${id}-station`)!;
  const liftBottom: NetworkNode = { id: 'core-lift-bottom', districtId: 'core', name: '天枢崖底升降站', position: { x: 140, y: 103.6, z: 35 }, station: true };
  const liftTop: NetworkNode = { id: 'core-lift-top', districtId: 'core', name: '天枢上层升降站', position: { x: 140, y: 254.6, z: 35 }, station: true };
  world.nodes.push(liftBottom, liftTop);
  const trunks: [string, string][] = [['river', 'market'], ['market', 'workshop'], ['workshop', 'west'], ['west', 'academy'], ['market', 'academy'], ['academy', 'core'], ['core', 'government'], ['government', 'summit'], ['core', 'east'], ['east', 'airport'], ['east', 'starport'], ['government', 'starport']];
  for (const [a, b] of trunks) addEdge(station(a).id, station(b).id, 'road', routeGround(world, station(a).position, station(b).position), 220);
  // Street recipe: each door joins the nearest street already built in its
  // district (splitting that street at a vertex into a junction), so doors share
  // streets instead of each running a private road to the station.
  const nodeById = new Map(world.nodes.map(n => [n.id, n]));
  let junctions = 0;
  const splitAt = (edge: NetworkEdge, index: number, districtId: string): NetworkNode => {
    if (index === 0) return nodeById.get(edge.from)!;
    if (index === edge.points.length - 1) return nodeById.get(edge.to)!;
    const point = edge.points[index], junction: NetworkNode = { id: `junction-${districtId}-${junctions++}`, districtId, name: `${plans.find(p => p.id === districtId)!.name}·街口`, position: { ...point }, station: false };
    world.nodes.push(junction); nodeById.set(junction.id, junction);
    const tail = edge.points.slice(index), head = edge.points.slice(0, index + 1);
    const length = (points: Vec3[]) => points.slice(1).reduce((total, p, i) => total + distance(points[i], p), 0);
    world.edges.push({ id: `${edge.id}~${junction.id}`, from: junction.id, to: edge.to, mode: edge.mode, points: tail, length: length(tail), capacity: edge.capacity });
    edge.points = head; edge.to = junction.id; edge.length = length(head);
    indices.delete(world);
    return junction;
  };
  /** Nearest street vertices of the door's district that a gentle stub can reach. */
  const streetCandidates = (b: Building, door: Vec3) => {
    const lead = doorLead(b, door), found: { edge: NetworkEdge; index: number; d: number }[] = [];
    for (const edge of world.edges) {
      if (edge.mode !== 'road' || edge.id.includes('runway')) continue;
      if (nodeById.get(edge.from)?.districtId !== b.districtId && nodeById.get(edge.to)?.districtId !== b.districtId) continue;
      for (let i = 0; i < edge.points.length; i++) {
        // A door node lies on its own building's wall; never route into it.
        if (i === 0 && edge.from.endsWith('-door') || i === edge.points.length - 1 && edge.to.endsWith('-door')) continue;
        const p = edge.points[i], d = Math.hypot(p.x - lead.x, p.z - lead.z);
        if (d < 14 || Math.abs(p.y - door.y) > d * .18) continue;
        found.push({ edge, index: i, d });
      }
    }
    return found.sort((a, b) => a.d - b.d);
  };
  /** First street a stub would cross without meeting it: [edge, nearest vertex index]. */
  const firstCrossing = (points: Vec3[]): { edge: NetworkEdge; index: number; at: { x: number; z: number } } | null => {
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k];
      let best: { edge: NetworkEdge; index: number; t: number; at: { x: number; z: number } } | null = null;
      for (const edge of world.edges) {
        if (edge.mode !== 'road' || edge.id.includes('runway')) continue;
        for (let j = 1; j < edge.points.length; j++) {
          const c = edge.points[j - 1], d = edge.points[j];
          if (Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.min(c.x, d.x) > Math.max(a.x, b.x) || Math.max(c.z, d.z) < Math.min(a.z, b.z) || Math.min(c.z, d.z) > Math.max(a.z, b.z)) continue;
          const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x); if (Math.abs(den) < 1e-9) continue;
          const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den, u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
          if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6 || (best && t >= best.t)) continue;
          best = { edge, index: u < .5 ? j - 1 : j, t, at: { x: c.x + (d.x - c.x) * u, z: c.z + (d.z - c.z) * u } };
        }
      }
      if (best) return best;
    }
    return null;
  };
  /** First street whose 10 m deck a stub runs inside at a different height
   * (one passing over a walker's head on the other), away from both stub ends:
   * [edge, nearest vertex index]. The stub joins that street instead. */
  const firstClash = (points: Vec3[]): { edge: NetworkEdge; index: number; at: { x: number; z: number } } | null => {
    const start = points[0], end = points[points.length - 1];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const near = world.edges.filter(edge => edge.mode === 'road' && !edge.id.includes('runway') && edge.points.some(p => p.x > x0 - 30 && p.x < x1 + 30 && p.z > z0 - 30 && p.z < z1 + 30));
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let s = 0; s <= n; s++) {
        const t = s / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        if (Math.hypot(x - start.x, z - start.z) < 14 || Math.hypot(x - end.x, z - end.z) < 14) continue;
        for (const edge of near) for (let j = 1; j < edge.points.length; j++) {
          const c = edge.points[j - 1], d = edge.points[j], dx = d.x - c.x, dz = d.z - c.z, l2 = dx * dx + dz * dz || 1;
          const u = clamp(((x - c.x) * dx + (z - c.z) * dz) / l2, 0, 1), px = c.x + dx * u, pz = c.z + dz * u;
          if (Math.hypot(px - x, pz - z) >= 6 || Math.abs(c.y + (d.y - c.y) * u - y) <= .5) continue;
          return { edge, index: u < .5 ? j - 1 : j, at: { x: px, z: pz } };
        }
      }
    }
    return null;
  };
  /** The crossed street's vertex nearest the crossing that a gentle link from `from` can reach. */
  const reachableVertex = (edge: NetworkEdge, at: { x: number; z: number }, from: Vec3, lead: Vec3) => {
    const order = edge.points.map((p, i) => ({ i, d: Math.hypot(p.x - at.x, p.z - at.z) })).sort((a, b) => a.d - b.d);
    for (const { i } of order) {
      if (i === 0 && edge.from.endsWith('-door') || i === edge.points.length - 1 && edge.to.endsWith('-door')) continue;
      const p = edge.points[i], d = Math.hypot(p.x - lead.x, p.z - lead.z);
      if (d >= 14 && Math.abs(p.y - from.y) <= d * .18) return i;
    }
    return -1;
  };
  /** Road decks by 16 m cell, rebuilt when streets are added: a cell within
   * 7 m of a deck more than .5 m above or below the stub's own grade costs 12/m. */
  let deckCells: Map<string, [Vec3, Vec3][]> | null = null, deckEdges = 0;
  const deckCost = () => {
    // Only new edges are added: a split leaves its street's segments in place.
    if (!deckCells || deckEdges !== world.edges.length) {
      deckCells ??= new Map(); const from = Math.max(0, deckEdges); deckEdges = world.edges.length;
      for (const edge of world.edges.slice(from)) if (edge.mode === 'road' && !edge.id.includes('runway')) for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], c = edge.points[i];
        for (let x = Math.floor((Math.min(a.x, c.x) - 7) / 16); x <= Math.floor((Math.max(a.x, c.x) + 7) / 16); x++) for (let z = Math.floor((Math.min(a.z, c.z) - 7) / 16); z <= Math.floor((Math.max(a.z, c.z) + 7) / 16); z++) (deckCells.get(`${x},${z}`) ?? deckCells.set(`${x},${z}`, []).get(`${x},${z}`)!).push([a, c]);
      }
    }
    const cells = deckCells;
    return (x: number, z: number, y: number) => {
      for (const [c, d] of cells.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`) ?? []) {
        const dx = d.x - c.x, dz = d.z - c.z, u = clamp(((x - c.x) * dx + (z - c.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        if (Math.hypot(c.x + dx * u - x, c.z + dz * u - z) < 7 && Math.abs(c.y + (d.y - c.y) * u - y) > .5) return 12;
      }
      return 0;
    };
  };
  for (const stops of quarters.values()) for (const stop of stops) {
    const home = station(stop.districtId);
    const quarterRoute = (to: Vec3) => { if (streetRecipe !== 'smooth') return routeGround(world, stop.position, to); try { deckPenalty = deckCost(); return routeGround(world, stop.position, to); } finally { deckPenalty = null; } };
    let points = quarterRoute(home.position), destination = home;
    // Street recipe: a quarter road that would cross a trunk joins it there.
    for (let hop = 0; streetRecipe === 'smooth' && hop < 4; hop++) {
      const crossing = firstCrossing(points); if (!crossing) break;
      const index = reachableVertex(crossing.edge, crossing.at, stop.position, stop.position); if (index < 0) break;
      let next: Vec3[]; try { next = quarterRoute(crossing.edge.points[index]); } catch { break; }
      points = next; destination = splitAt(crossing.edge, index, stop.districtId);
    }
    addEdge(stop.id, destination.id, 'road', points, 90);
  }
  // Street recipe: streets first. The river apron is graded now, before any
  // lot takes its street height; lanes add frontage; then every non-civic
  // building takes a lot facing a street, its door at that street's height.
  const laneEdges = new Set<string>();
  if (streetRecipe === 'smooth') {
    for (const edge of world.edges) if (edge.mode === 'road' && (edge.from === 'river-station' || edge.to === 'river-station')) {
      stationApronGrade(edge.points, edge.from === 'river-station', 64);
      edge.length = edge.points.slice(1).reduce((sum, p, i) => sum + distance(edge.points[i], p), 0);
    }
    indices.delete(world);
    // Terrace rows: from each quarter stop, straight east–west streets at the
    // stop and ROW_SPACING north and south of it (reached by a short north–south
    // connector), stepping with the ground at ≤ 18% and stopping short of any
    // river, building, other deck or ground they would float over or cut into.
    const deckClear = (x: number, z: number, own: Set<NetworkEdge>, radius: number) => !world.edges.some(e => (e.mode === 'road' || e.mode === 'bridge') && !own.has(e) && nearestSegment(e.points, x, z).distance < radius);
    const buildingClear = (x: number, z: number, margin: number) => !world.buildings.some(b => Math.abs(x - b.position.x) < b.width / 2 + margin && Math.abs(z - b.position.z) < b.depth / 2 + margin);
    const stepFrom = (from: Vec3, dx: number, dz: number, steps: number, own: Set<NetworkEdge>): Vec3[] => {
      const points: Vec3[] = [{ ...from }];
      for (let k = 1; k <= steps; k++) {
        const prev = points[points.length - 1], x = q(from.x + dx * k) + 0, z = q(from.z + dz * k) + 0, ground = naturalHeight(world, x, z) + .6;
        const y = q(clamp(ground, prev.y - ROW_STEP * .18, prev.y + ROW_STEP * .18)) + 0;
        if (Math.abs(x) > 2050 || Math.abs(z) > 2050 || Math.abs(y - ground) > 6 || nearestSegment(world.river, x, z).distance < 30 || !buildingClear(x, z, 9)) break;
        if (k * ROW_STEP > 14 && !deckClear(x, z, own, 12)) break;
        points.push({ x, y, z });
      }
      return points;
    };
    const addRow = (p: DistrictPlan, stop: NetworkNode, hub: NetworkNode, label: string) => {
      for (const side of [1, -1]) {
        const own = new Set(world.edges.filter(e => e.from === hub.id || e.to === hub.id));
        const row = stepFrom(hub.position, side * ROW_STEP, 0, Math.round(ROW_LENGTH / ROW_STEP), own);
        if (row.length < 5) continue;
        const end: NetworkNode = { id: `${label}-${side > 0 ? 'east' : 'west'}`, districtId: p.id, name: `${stop.name.replace('驿', '')}·台街`, position: { ...row[row.length - 1] }, station: false };
        world.nodes.push(end); nodeById.set(end.id, end);
        addEdge(hub.id, end.id, 'road', row, 30); laneEdges.add(world.edges[world.edges.length - 1].id);
      }
    };
    for (const p of plans) for (const stop of quarters.get(p.id)!) {
      const rowBase = stop.id.replace('-quarter-', '-terrace-');
      addRow(p, stop, stop, `${rowBase}-row-0`);
      for (const sign of [1, -1]) {
        let hub: NetworkNode = stop;
        for (let tier = 1; tier <= ROW_TIERS; tier++) {
          const own = new Set(world.edges.filter(e => e.from === hub.id || e.to === hub.id));
          const connector = stepFrom(hub.position, 0, sign * ROW_STEP, Math.round(ROW_SPACING / ROW_STEP), own);
          if ((connector.length - 1) * ROW_STEP < ROW_SPACING) break;
          const label = `${rowBase}-row-${sign > 0 ? 's' : 'n'}${tier}`;
          const next: NetworkNode = { id: label, districtId: p.id, name: `${stop.name.replace('驿', '')}·台街`, position: { ...connector[connector.length - 1] }, station: false };
          world.nodes.push(next); nodeById.set(next.id, next);
          addEdge(hub.id, next.id, 'road', connector, 30); laneEdges.add(world.edges[world.edges.length - 1].id);
          addRow(p, stop, next, label); hub = next;
        }
      }
    }
    indices.delete(world);
    // Deck samples every 2 m, by 16 m cell: a lot keeps 5.5 m clear of every deck.
    deckSamples = new Map(); frontageStreets.clear(); frontageGround.clear();
    for (const edge of world.edges) if ((edge.mode === 'road' || edge.mode === 'bridge') && !edge.id.includes('runway')) for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let t = 0; t <= n; t++) { const x = a.x + (b.x - a.x) * t / n, z = a.z + (b.z - a.z) * t / n, k = `${Math.floor(x / 16)},${Math.floor(z / 16)}`; (deckSamples.get(k) ?? deckSamples.set(k, []).get(k)!).push({ x, z }); }
    }
    for (const [districtIndex, p] of plans.entries()) for (let i = 0; i < p.count; i++) if (!(p.id === 'core' && civicPlan[i])) placeBuilding(districtIndex, p, i, true);
    world.buildings.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    indices.delete(world);
  }
  /** A lot whose door faces a street of its district: the door is FRONTAGE m
   * from the street centre, at the street's own height; the lot, its forecourt
   * and 5.5 m around it stay clear of every other deck and building. */
  function clearOfDecks(x: number, z: number, hw: number, hd: number) {
    for (let cx = Math.floor((x - hw) / 16); cx <= Math.floor((x + hw) / 16); cx++) for (let cz = Math.floor((z - hd) / 16); cz <= Math.floor((z + hd) / 16); cz++)
      for (const s of deckSamples?.get(`${cx},${cz}`) ?? []) if (Math.abs(s.x - x) < hw && Math.abs(s.z - z) < hd) return false;
    return true;
  }
  function frontageSite(districtId: string, target: { x: number; z: number }, width: number, depth: number, unturned = false): { x: number; z: number; y: number; rotation: number; street: Vec3 } | null {
    // Street samples (every ~6 m) do not change while lots are placed.
    let streetPoints = frontageStreets.get(districtId);
    if (!streetPoints) {
      streetPoints = [];
      for (const e of world.edges) {
        if (e.mode !== 'road' || e.id.includes('runway') || (nodeById.get(e.from)?.districtId !== districtId && nodeById.get(e.to)?.districtId !== districtId)) continue;
        for (let k = 1; k < e.points.length; k++) {
          const a = e.points[k - 1], b = e.points[k], n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.z - a.z) / 6));
          for (let t = 0; t < n; t++) { const u = (t + .5) / n; streetPoints.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u }); }
        }
      }
      frontageStreets.set(districtId, streetPoints);
    }
    const samples = streetPoints.map(pt => ({ p: pt, d: Math.hypot(pt.x - target.x, pt.z - target.z) })).sort((a, b) => a.d - b.d);
    const groundAt = (x: number, z: number) => { const k = `${x}:${z}`; let g = frontageGround.get(k); if (g === undefined) { g = naturalHeight(world, x, z); frontageGround.set(k, g); } return g; };
    // Bodies without a floor plan (pavilions) keep the original orientation.
    for (const { p } of samples) for (const n of unturned ? [1] : [1, -1]) {
      const x = q(p.x) + 0, z = q(p.z - n * (depth / 2 + FRONTAGE)) + 0, y = q(p.y - .6) + 0;
      if (!clearOfDecks(x, z, width / 2 + 5.5, depth / 2 + 5.5)) continue;
      const ground = groundAt(x, z);
      if (y < ground - 8 || y > ground + 14 || !safeSite(x, z, width, depth, n, true, FRONTAGE_GAP)) continue;
      return { x, z, y, rotation: n > 0 ? 0 : Math.PI, street: { x: q(p.x) + 0, y: q(p.y) + 0, z: q(p.z) + 0 } };
    }
    return null;
  }
  /** The door's own short, level link to the street point its lot was chosen from. */
  const joinFrontage = (b: Building, node: NetworkNode, street: Vec3): boolean => {
    let best: { edge: NetworkEdge; index: number; d: number } | null = null;
    for (const edge of world.edges) if (edge.mode === 'road' && !edge.id.includes('runway')) for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], c = edge.points[i], dx = c.x - a.x, dz = c.z - a.z, l2 = dx * dx + dz * dz || 1, u = clamp(((street.x - a.x) * dx + (street.z - a.z) * dz) / l2, 0, 1);
      const d = Math.hypot(a.x + dx * u - street.x, a.z + dz * u - street.z);
      if (!best || d < best.d) best = { edge, index: i, d };
    }
    if (!best || best.d > 1) return false;
    const { edge } = best, a = edge.points[best.index - 1], c = edge.points[best.index];
    let index: number;
    if (Math.hypot(a.x - street.x, a.z - street.z) < 3) index = best.index - 1;
    else if (Math.hypot(c.x - street.x, c.z - street.z) < 3) index = best.index;
    else {
      const span = Math.hypot(c.x - a.x, c.z - a.z), u = clamp(Math.hypot(street.x - a.x, street.z - a.z) / span, 0, 1);
      edge.points.splice(best.index, 0, { x: street.x, y: q(a.y + (c.y - a.y) * u) + 0, z: street.z });
      edge.length = edge.points.slice(1).reduce((sum, p, i) => sum + distance(edge.points[i], p), 0);
      index = best.index;
    }
    const target = edge.points[index], horizontal = Math.hypot(target.x - node.position.x, target.z - node.position.z);
    if (horizontal < .5 || Math.abs(target.y - node.position.y) > horizontal * .25 || world.buildings.some(o => o !== b && segmentEntersFootprint(node.position, target, o))) return false;
    const joined = splitAt(edge, index, b.districtId);
    addEdge(node.id, joined.id, 'road', [{ ...node.position }, { ...joined.position }], 30);
    return true;
  };
  const joinStreet = (b: Building, node: NetworkNode): Vec3[] | null => {
    const tried = new Set<string>();
    const accept = (edge: NetworkEdge, index: number, points: Vec3[]) => { const joined = splitAt(edge, index, b.districtId); addEdge(node.id, joined.id, 'road', points, 30); return points; };
    // A stub that only runs under another street's deck first tries to join
    // that street, then the other nearby streets; failing those, it is kept.
    let underpass: { edge: NetworkEdge; index: number; points: Vec3[] } | null = null;
    for (const first of streetCandidates(b, node.position)) {
      let candidate = first;
      for (let hop = 0; hop < 5; hop++) {
        const target = candidate.edge.points[candidate.index], at = `${target.x}:${target.z}`;
        if (tried.has(at) || tried.size > 12) break; tried.add(at);
        // A door node lies on its own building's wall; never route into it.
        if (candidate.index === 0 && candidate.edge.from.endsWith('-door') || candidate.index === candidate.edge.points.length - 1 && candidate.edge.to.endsWith('-door')) break;
        const lead = doorLead(b, node.position), d = Math.hypot(target.x - lead.x, target.z - lead.z);
        if (d < 14 || Math.abs(target.y - node.position.y) > d * .18) break;
        let points: Vec3[];
        try { deckPenalty = deckCost(); points = routeGround(world, node.position, target, b); } catch { break; } finally { deckPenalty = null; }
        // Streets meet at junctions: a stub that would cross another street
        // instead joins that street at its nearest vertex.
        const crossing = firstCrossing(points);
        if (crossing) { const index = reachableVertex(crossing.edge, crossing.at, node.position, lead); if (index < 0) break; candidate = { edge: crossing.edge, index, d: 0 }; continue; }
        const clash = firstClash(points);
        if (clash) {
          underpass ??= { edge: candidate.edge, index: candidate.index, points };
          const index = reachableVertex(clash.edge, clash.at, node.position, lead); if (index < 0) break;
          candidate = { edge: clash.edge, index, d: 0 }; continue;
        }
        return accept(candidate.edge, candidate.index, points);
      }
    }
    return underpass ? accept(underpass.edge, underpass.index, underpass.points) : null;
  };
  for (const b of world.buildings) {
    const node: NetworkNode = { id: `${b.id}-door`, districtId: b.districtId, name: b.name, position: { ...b.door }, station: false }; world.nodes.push(node);
    const fallback = b.id === 'core-dock-building' ? liftBottom : buildingAnchors.get(b.id) ?? station(b.districtId);
    nodeById.set(node.id, node);
    const lot = frontageLots.get(b.id);
    if (streetRecipe === 'smooth' && lot && joinFrontage(b, node, lot)) continue;
    if (streetRecipe === 'smooth' && b.id !== 'core-dock-building' && joinStreet(b, node)) continue;
    const stubRoute = (to: Vec3) => { if (streetRecipe !== 'smooth' || b.id === 'core-dock-building') return routeGround(world, node.position, to, b); try { deckPenalty = deckCost(); return routeGround(world, node.position, to, b); } finally { deckPenalty = null; } };
    let points = stubRoute(fallback.position), destination = fallback;
    // A long fallback stub still joins the first street it would cross.
    for (let hop = 0; streetRecipe === 'smooth' && b.id !== 'core-dock-building' && hop < 4; hop++) {
      const crossing = firstCrossing(points); if (!crossing) break;
      const index = reachableVertex(crossing.edge, crossing.at, node.position, doorLead(b, node.position)); if (index < 0) break;
      let next: Vec3[]; try { next = stubRoute(crossing.edge.points[index]); } catch { break; }
      points = next; destination = splitAt(crossing.edge, index, b.districtId);
    }
    addEdge(node.id, destination.id, 'road', points, 30);
  }
  if (streetRecipe === 'smooth') {
    // Same fleet as the orthogonal layouts' length rule produced: two vehicles
    // (the second a freight carrier) per station-to-station road, one per
    // commercial door, independent of how short the shared stubs became.
    const stationIds = new Set(world.nodes.filter(n => n.station).map(n => n.id)), plan: NonNullable<WorldDefinition['fleetPlan']> = [];
    for (const edge of world.edges) {
      if (edge.mode !== 'road' || edge.id.includes('~') || edge.id.includes('runway')) continue;
      const pieces = world.edges.filter(e => e.id === edge.id || e.id.startsWith(`${edge.id}~`)), length = pieces.reduce((sum, e) => sum + e.length, 0);
      const origin = edge.from, end = pieces.find(e => !world.edges.some(other => other !== e && pieces.includes(other) && other.from === e.to))?.to ?? edge.to;
      if (laneEdges.has(edge.id)) continue;
      if (stationIds.has(origin) && !end.endsWith('-door')) { plan.push({ edgeId: edge.id, vehicles: 2, stationRoad: true }); continue; }
      const site = world.buildings.find(b => `${b.id}-door` === origin);
      if (site && ['market', 'workshop', 'farm', 'dock'].includes(site.kind)) plan.push({ edgeId: edge.id, vehicles: 1, stationRoad: false });
    }
    world.fleetPlan = plan;
  }
  function stationApronGrade(points: Vec3[], atStart: boolean, desiredFlat: number) {
    const cumulative = [0]; for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    const total = cumulative[cumulative.length - 1], apron = atStart ? points[0].y : points[points.length - 1].y, outer = atStart ? points[points.length - 1].y : points[0].y;
    const flat = Math.min(desiredFlat, Math.max(0, total - Math.abs(outer - apron) / .2 - 6));
    // A grade break must be an actual vertex. Merely grading old route vertices
    // leaves a sloping segment over the supposedly level station junction.
    const transition = atStart ? flat : total - flat;
    for (let i = 1; !historicR5 && i < points.length; i++) if (transition > cumulative[i - 1] + .5 && transition < cumulative[i] - .5) {
      const a = points[i - 1], b = points[i], t = (transition - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1]);
      points.splice(i, 0, { x: q(a.x + (b.x - a.x) * t), y: apron, z: q(a.z + (b.z - a.z) * t) });
      cumulative.splice(i, 0, transition); break;
    }
    points.forEach((point, i) => { const fromApron = atStart ? cumulative[i] : total - cumulative[i]; point.y = q(apron + (outer - apron) * clamp((fromApron - flat) / Math.max(.01, total - flat), 0, 1)); });
  }
  if (currentLayout && streetRecipe !== 'smooth') for (const edge of world.edges) if (edge.mode === 'road' && (edge.from === 'river-station' || edge.to === 'river-station')) {
    stationApronGrade(edge.points, edge.from === 'river-station', 64);
    edge.length = edge.points.slice(1).reduce((sum, p, i) => sum + distance(edge.points[i], p), 0);
  }
  if (currentLayout && !historicR5) indices.delete(world);
  const elevated = (a: string, b: string, mode: TransportMode, lift: number) => {
    const from = station(a), to = station(b), start = from.position, end = to.position;
    const routed = mode === 'cable' ? [{ ...start }, { ...end }] : routeGround(world, start, end);
    const ground: Vec3[] = [];
    for (let i = 1; i < routed.length; i++) {
      const a = routed[i - 1], b = routed[i], samples = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 4));
      for (let j = i === 1 ? 0 : 1; j <= samples; j++) ground.push({ x: q(a.x + (b.x - a.x) * j / samples), y: 0, z: q(a.z + (b.z - a.z) * j / samples) });
    }
    const cumulative = [0];
    for (let i = 1; i < ground.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(ground[i].x - ground[i - 1].x, ground[i].z - ground[i - 1].z));
    const total = cumulative[cumulative.length - 1];
    const points = ground.map((p, i) => {
      const t = cumulative[i] / total, stationBlend = Math.min(1, cumulative[i] / 32, (total - cumulative[i]) / 32);
      let minimum = planningGroundHeight(world, p.x, p.z, true) + 14 * stationBlend;
      if (mode === 'cable') for (const building of indexFor(world).buildings.get(key(p.x, p.z)) ?? []) if (Math.abs(p.x - building.position.x) < building.width / 2 + 6 && Math.abs(p.z - building.position.z) < building.depth / 2 + 6) minimum = Math.max(minimum, building.position.y + building.height + 12);
      return { x: p.x, y: q(Math.max(start.y + (end.y - start.y) * t + Math.sin(Math.PI * t) * lift, minimum)), z: p.z };
    });
    // A track segment needs clearance between its vertices as well: adjoining
    // terrace slabs can sit higher than either sampled road centreline.
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], samples = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z)));
      let ceiling = -Infinity;
      for (let j = 0; j <= samples; j++) {
        const x = a.x + (b.x - a.x) * j / samples, z = a.z + (b.z - a.z) * j / samples;
        ceiling = Math.max(ceiling, planningGroundHeight(world, x, z, true) + 8);
      }
      if (i > 1) a.y = q(Math.max(a.y, ceiling));
      if (i < points.length - 1) b.y = q(Math.max(b.y, ceiling));
    }
    points[0] = { ...start }; points[points.length - 1] = { ...end };
    addEdge(from.id, to.id, mode, points, mode === 'flight' ? 70 : 180);
  };
  for (const [a, b] of [['river', 'market'], ['market', 'core'], ['core', 'government'], ['government', 'starport']] as [string, string][]) elevated(a, b, 'maglev', 35);
  for (const [a, b] of [['workshop', 'market'], ['market', 'academy'], ['academy', 'west'], ['east', 'airport'], ['east', 'core']] as [string, string][]) elevated(a, b, 'lightRail', 14);
  elevated('government', 'summit', 'cable', 72);
  elevated('core', 'summit', 'cable', 95);
  // A true vertical shaft has two stations at the same horizontal coordinate.
  addEdge(liftBottom.id, liftTop.id, 'lift', [liftBottom.position, liftTop.position], 30);
  addEdge(liftTop.id, station('core').id, 'bridge', routeGround(world, liftTop.position, station('core').position), 80);
  addEdge(liftBottom.id, station('east').id, 'road', routeGround(world, liftBottom.position, station('east').position), 100);
  const dockA: NetworkNode = { id: 'river-dock', districtId: 'river', name: '清溪渡船码头', position: { x: -580, y: 15.6, z: 1010 }, station: true };
  const dockB: NetworkNode = { id: 'market-dock', districtId: 'market', name: '千灯水运码头', position: { x: -110, y: 56.6, z: 460 }, station: true };
  world.nodes.push(dockA, dockB);
  const riverBridge = routeGround(world, dockA.position, station('river').position, undefined, currentLayout ? 25 : 5);
  if (currentLayout) {
    const span = riverBridge.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - riverBridge[i].x, p.z - riverBridge[i].z), 0);
    stationApronGrade(riverBridge, false, Math.max(0, span - 64));
  }
  addEdge(dockA.id, station('river').id, 'bridge', riverBridge, 60);
  addEdge(dockB.id, station('market').id, 'bridge', routeGround(world, dockB.position, station('market').position), 60);
  addEdge(dockA.id, dockB.id, 'ferry', [dockA.position, { x: -410, y: 30.6, z: 720 }, dockB.position], 45);
  const coreDock: NetworkNode = { id: 'core-dock', districtId: 'core', name: '瀑云潭水运站', position: { x: 75, y: 94.6, z: 140 }, station: true };
  world.nodes.push(coreDock);
  addEdge(coreDock.id, liftBottom.id, 'bridge', routeGround(world, coreDock.position, liftBottom.position), 65);
  addEdge(coreDock.id, dockB.id, 'ferry', [coreDock.position, { x: -65, y: 75.6, z: 260 }, dockB.position], 45);
  // The airport occupies the southern valley. Aircraft roll along the same runway
  // the player can visit, then climb away from the city before entering the air lane.
  const runwayWest: NetworkNode = { id: 'airport-runway-west', districtId: 'airport', name: '南岫跑道西端', position: { x: 710, y: 14.6, z: 1490 }, station: true };
  const runwayEast: NetworkNode = { id: 'airport-runway-east', districtId: 'airport', name: '南岫跑道东端', position: { x: 1670, y: 14.6, z: 1490 }, station: false };
  world.nodes.push(runwayWest, runwayEast);
  addEdge(runwayWest.id, runwayEast.id, 'road', [runwayWest.position, runwayEast.position], 4);
  world.edges[world.edges.length - 1].id = 'road-airport-runway-strip';
  addEdge(runwayWest.id, station('airport').id, 'road', routeGround(world, runwayWest.position, station('airport').position), 90);
  addEdge(runwayWest.id, station('starport').id, 'flight', [runwayWest.position, runwayEast.position, { x: 1850, y: 180, z: 1480 }, { x: 1920, y: 420, z: 900 }, { x: 1840, y: 590, z: -150 }, { x: 1580, y: 550, z: -1120 }, { x: 1440, y: 410, z: -1280 }, station('starport').position], 70);
  addEdge(runwayWest.id, station('workshop').id, 'flight', [runwayWest.position, runwayEast.position, { x: 1850, y: 180, z: 1480 }, { x: 1600, y: 430, z: 1750 }, { x: -500, y: 500, z: 1450 }, { x: -1420, y: 330, z: 560 }, station('workshop').position], 50);
  world.spawn = { x: -330, y: getWalkHeight(world, -330, 487), z: 487 };
  // current-v8: the original spawn lies under the smoothed rail fan at the
  // market station. Arrive instead on a market street with open sky: no rail,
  // cable or lift within 60 m, near shop doors and the station.
  if (streetRecipe === 'smooth') {
    const tracks = world.edges.filter(e => ['maglev', 'lightRail', 'cable', 'lift'].includes(e.mode)), home = station('market').position;
    const markets = world.buildings.filter(b => b.districtId === 'market' && b.kind === 'market');
    let best: { p: Vec3; score: number } | null = null;
    for (const edge of world.edges) if (edge.mode === 'road' && !edge.id.includes('runway')) for (const p of edge.points) {
      const fromStation = Math.hypot(p.x - home.x, p.z - home.z);
      if (fromStation < 60 || fromStation > 220 || tracks.some(t => nearestSegment(t.points, p.x, p.z).distance < 60)) continue;
      // The arrival view looks north (−z): keep a 20 m wide, 60 m deep street view clear of walls.
      if (world.buildings.some(b => Math.abs(b.position.x - p.x) < b.width / 2 + 10 && b.position.z + b.depth / 2 > p.z - 60 && b.position.z - b.depth / 2 < p.z + 4)) continue;
      const score = markets.filter(b => Math.hypot(b.door.x - p.x, b.door.z - p.z) < 45).length * 100 - fromStation;
      if (!best || score > best.score) best = { p, score };
    }
    if (best) world.spawn = { x: best.p.x, y: getWalkHeight(world, best.p.x, best.p.z), z: best.p.z };
  }
  return world;
}
