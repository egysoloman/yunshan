import { applyCommercialDistrict } from './commercial-district';
import { applyMarketStationApron } from './market-station-apron';
import { applyReferenceCurvedRoofs } from './reference-roof-recipe';
import { getPublicStreetBirthWalkHeight, PUBLIC_STREET_BIRTH_CHECK_PARAMETERS, selectValidatedPublicStreetBirth } from './geometry/public-street-birth-check';
import type { Building, BuildingKind, District, NetworkEdge, NetworkNode, SimState, TransportMode, Vec3, WorldDefinition } from './types';
import { isRoadOpen } from './roads';
import { getFloorDimensions } from './access';
import { FLOOR_PLAN_GEOMETRY_VERSION, floorPlanSupport, getFloorPlanRoofSupport, getBuildingEntrance, getBuildingUsePoints } from './architecture-floor-plan';

export const CITY_LAYOUT_VERSIONS = ['legacy-ee3e7a1', 'current-v2-r5', 'current-v2', 'current-v3', 'current-v4', 'current-v5', 'current-v6', 'current-v7', 'current-v8'] as const;
export type CityLayoutVersion = typeof CITY_LAYOUT_VERSIONS[number];
export const CURRENT_CITY_LAYOUT: CityLayoutVersion = 'current-v6';
export const GEOLOGICAL_GEOMETRY_VERSION = 'yunshan-geology-v3-terraced-cellular-1';
export const ARCHITECTURAL_GEOMETRY_VERSION = FLOOR_PLAN_GEOMETRY_VERSION;

const UNIT = .2;
const q = (n: number) => Math.round(n / UNIT) * UNIT;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const smooth = (n: number) => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

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
    index = { segments: new Map(), elevated: new Map(), buildings: new Map(), roads: new Map(), indexedEdges: 0, quarters: world.nodes.filter(n => n.id.includes('-quarter-')), landHeights: new Map() };
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
  if (roadGap > 9 && foundationGap < 54) y += (foundationY - y) * (1 - smooth(foundationGap / 54)) * .82;
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
    if (foundationGap < 54) valley += (foundationY - valley) * (1 - smooth(foundationGap / 54)) * .82;
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
  // Only an accepted explicit v8 arrival uses real rendered road faces in its
  // finite approach corridor. Every earlier recipe retains the old code below.
  const arrival = world.referenceCityRecipe?.arrival;
  if ((world as WorldDefinition & { layoutVersion?: CityLayoutVersion }).layoutVersion === 'current-v8' && arrival && arrival.pathToDoor.length >= 2) {
    const corridor = nearestSegment(arrival.pathToDoor, x, z);
    if (corridor.distance <= PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.runtimeCorridorDistance && (referenceHeight === undefined || Math.abs(corridor.y - referenceHeight) <= .6)) {
      const supported = getPublicStreetBirthWalkHeight(world, x, z);
      if (supported !== null && Math.abs(supported - corridor.y) <= .26) return supported;
    }
  }
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

/** Orthogonal obstacle routing keeps every connector outside all building walls. */
function routeGround(world: WorldDefinition, start: Vec3, end: Vec3, startBuilding?: Building, clearance = 5): Vec3[] {
  const GRID = 8;
  const first = startBuilding ? { ...start, z: q(start.z + 10) } : start;
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

export function createWorld(seed = 20261001, layoutVersion: CityLayoutVersion = CURRENT_CITY_LAYOUT): WorldDefinition & { layoutVersion: CityLayoutVersion } {
  if (!CITY_LAYOUT_VERSIONS.includes(layoutVersion)) throw new Error('Unknown city layout version');
  if (layoutVersion === 'current-v8') {
    // Reference roofs extend the preserved v6 product, not the rejected v7 street trial.
    const base = createWorld(seed, 'current-v6');
    base.referenceCityRecipe = { originalSpawn: { ...base.spawn }, streetGuardJoinRevision: 2 };
    applyReferenceCurvedRoofs(base);
    // This explicit reference recipe selects only a new city arrival.
    // Existing saved actors keep their original world and position.
    const arrival = selectValidatedPublicStreetBirth(base);
    if (!arrival.ok) throw new Error(`Reference city birth geometry rejected: ${arrival.reason}`);
    const proposal = arrival.proposal;
    base.referenceCityRecipe.arrival = { recipe: proposal.recipeVersion, buildingId: proposal.buildingId, edgeId: proposal.edgeId,
      lookTarget: { ...proposal.lookTarget }, pathToDoor: proposal.pathToDoor.map(point => ({ ...point })) };
    base.spawn = { ...proposal.birth };
    base.layoutVersion = 'current-v8';
    indices.delete(base);
    return base;
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
  const safeSite = (x: number, z: number, width: number, depth: number) => {
    if (Math.abs(x) + width / 2 > 2120 || Math.abs(z) + depth / 2 > 2120) return false;
    if (z + depth / 2 > 1435 && z - depth / 2 < 1545 && x + width / 2 > 650 && x - width / 2 < 1730) return false;
    if (nearestSegment(world.river, x, z).distance < Math.hypot(width, depth) / 2 + 30) return false;
    if (currentLayout && Math.abs(x - world.waterfall.top.x) < width / 2 + 135 && z + depth / 2 > world.waterfall.top.z - 20 && z - depth / 2 < 155) return false;
    if (world.nodes.some(n => intersects(x, z, width, depth, n.position.x, n.position.z, 42, 42, 4))) return false;
    if (civicPlan.some(c => intersects(x, z, width, depth, c.x, c.z, 'width' in c ? c.width! : 36, 'depth' in c ? c.depth! : 24))) return false;
    return !world.buildings.some(b => intersects(x, z, width, depth, b.position.x, b.position.z, b.width, b.depth)
      || intersects(x, z, width, depth, b.door.x, b.door.z + 12, 14, 24, 2)
      || intersects(x, z + depth / 2 + 12, 14, 24, b.position.x, b.position.z, b.width, b.depth, 2));
  };
  for (const [districtIndex, p] of plans.entries()) {
    const localStops = quarters.get(p.id)!;
    for (let i = 0; i < p.count; i++) {
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
      const width = 'width' in (civic ?? {}) ? civic!.width! : Math.round(designWidth * (.94 + rng() * .12) / .4) * .4;
      const depth = 'depth' in (civic ?? {}) ? civic!.depth! : Math.round(designDepth * (.94 + rng() * .12) / .4) * .4;
      if (civic && 'floors' in civic) floors = civic.floors!;
      const baseRadius = 88 + ring * 64;
      let x = q(anchor.position.x + Math.cos(angle) * baseRadius), z = q(anchor.position.z + Math.sin(angle) * baseRadius);
      let placed = false;
      if (civic) { x = civic.x; z = civic.z; placed = true; }
      else if (i === 0 && ['summit', 'airport', 'starport'].includes(p.id)) {
        x = p.x; z = p.z - (p.id === 'summit' ? 105 : 115);
        placed = safeSite(x, z, width, depth);
      }
      if (!placed) for (let attempt = 0; attempt < 300; attempt++) {
        const r = baseRadius + Math.floor(attempt / 12) * 11;
        const theta = angle + ((attempt % 12) - 5) * .19;
        x = q(anchor.position.x + Math.cos(theta) * r); z = q(anchor.position.z + Math.sin(theta) * r);
        if (safeSite(x, z, width, depth)) { placed = true; break; }
      }
      if (!placed) throw new Error(`No buildable site for ${p.id}/${i}`);
      const terrace = ring * 4 + Math.round(Math.sin(angle)) * 2;
      const ground = naturalHeight(world, x, z);
      const terraceTarget = anchor.position.y - .6 + (p.id === 'airport' ? 0 : terrace);
      const y = q(civic?.y ?? clamp(terraceTarget, ground - 8, ground + 14));
      const storeyHeight: Record<BuildingKind, number> = { home: 3.4, market: 3.6, workshop: 4.8, bank: 4.4, hall: 4.2, police: 3.8, school: 3.8, clinic: 3.8, station: 4.2, core: 7.8, pavilion: 12.8, airport: 6, starport: 6.6, farm: 3.6, dock: 3.8 };
      const targetHeight = civic && 'height' in civic ? civic.height! : currentLayout ? floors * storeyHeight[kind] : floors * (kind === 'bank' ? 4.8 : kind === 'hall' ? 5.2 : kind === 'airport' ? 6 : kind === 'starport' ? 6.6 : 4) + (kind === 'pavilion' ? 8 : 4.8 + within % 3 * 1.6);
      // Floors, including upper rooms and basement slabs, share the voxel lattice.
      const height = q(Math.round(targetHeight / floors / UNIT) * UNIT * floors);
      const building: Building = { id: civic?.id ?? `${p.id}-b${i}`, districtId: p.id, name: civic?.name ?? `${p.name}·${anchor.name.split('·')[1].replace('驿', '')}·${kindName[kind]}${within + 1}`, kind, position: { x, y, z }, width, depth, height, floors, rotation: 0, door: { x, y: q(y + .6), z: q(z + depth / 2) }, capacity: floors * Math.floor(width * depth / 32), seed: Math.floor(rng() * 0x7FFFFFFF) };
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
  const addEdge = (from: string, to: string, mode: TransportMode, points: Vec3[], capacity = 100) => {
    world.edges.push({ id: `${mode}-${from}-${to}`, from, to, mode, points, length: points.slice(1).reduce((total, b, i) => total + distance(points[i], b), 0), capacity });
  };
  const station = (id: string) => world.nodes.find(n => n.id === `${id}-station`)!;
  const liftBottom: NetworkNode = { id: 'core-lift-bottom', districtId: 'core', name: '天枢崖底升降站', position: { x: 140, y: 103.6, z: 35 }, station: true };
  const liftTop: NetworkNode = { id: 'core-lift-top', districtId: 'core', name: '天枢上层升降站', position: { x: 140, y: 254.6, z: 35 }, station: true };
  world.nodes.push(liftBottom, liftTop);
  const trunks: [string, string][] = [['river', 'market'], ['market', 'workshop'], ['workshop', 'west'], ['west', 'academy'], ['market', 'academy'], ['academy', 'core'], ['core', 'government'], ['government', 'summit'], ['core', 'east'], ['east', 'airport'], ['east', 'starport'], ['government', 'starport']];
  for (const [a, b] of trunks) addEdge(station(a).id, station(b).id, 'road', routeGround(world, station(a).position, station(b).position), 220);
  for (const stops of quarters.values()) for (const stop of stops) addEdge(stop.id, station(stop.districtId).id, 'road', routeGround(world, stop.position, station(stop.districtId).position), 90);
  for (const b of world.buildings) {
    const node: NetworkNode = { id: `${b.id}-door`, districtId: b.districtId, name: b.name, position: { ...b.door }, station: false }; world.nodes.push(node);
    const destination = b.id === 'core-dock-building' ? liftBottom : buildingAnchors.get(b.id) ?? station(b.districtId);
    addEdge(node.id, destination.id, 'road', routeGround(world, node.position, destination.position, b), 30);
  }
  const stationApronGrade = (points: Vec3[], atStart: boolean, desiredFlat: number) => {
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
  };
  if (currentLayout) for (const edge of world.edges) if (edge.mode === 'road' && (edge.from === 'river-station' || edge.to === 'river-station')) {
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
  return world;
}
