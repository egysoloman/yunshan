import { invalidateTransportGeometry } from './transport-geometry';
import type { NetworkEdge, Vec3, WorldDefinition } from './types';

/** A distinct, code-owned street recipe; old layouts never invoke it. */
export const MARKET_STATION_APRON_VERSION = 'yunshan-market-station-apron-v7-1';
export const MARKET_STATION_APRON_MAX_GRADE = .20;
export const MARKET_STATION_APRON_OFFSETS = Object.freeze({ x0: -10, x1: 26, z0: -12, z1: 12 });
const UNIT = .2;
const quantize = (value: number) => Math.round(value / UNIT) * UNIT;
const horizontalDistance = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.z - a.z);
const length = (points: Vec3[]) => points.slice(1).reduce((sum, b, i) => sum + Math.hypot(b.x - points[i].x, b.y - points[i].y, b.z - points[i].z), 0);

export interface MarketStationApronChange {
  edgeId: string;
  oldLength: number;
  newLength: number;
  oldPoints: Vec3[];
  newPoints: Vec3[];
  boundary: Vec3;
  restoredOriginalVertex: Vec3;
  maximumChangedGrade: number;
}

function gradeFromStation(edge: NetworkEdge, stationId: string, station: Vec3): MarketStationApronChange {
  const fromStation = edge.from === stationId;
  const original = fromStation ? edge.points.map(point => ({ ...point })) : [...edge.points].reverse().map(point => ({ ...point }));
  const offsets = MARKET_STATION_APRON_OFFSETS;
  const bounds = { x0: station.x + offsets.x0, x1: station.x + offsets.x1, z0: station.z + offsets.z0, z1: station.z + offsets.z1 };
  const inside = (point: Vec3) => point.x >= bounds.x0 && point.x <= bounds.x1 && point.z >= bounds.z0 && point.z <= bounds.z1;
  if (!original.length || original[0].x !== station.x || original[0].y !== station.y || original[0].z !== station.z) throw new Error(`Market apron edge has no exact station endpoint: ${edge.id}`);
  const firstOutside = original.findIndex(point => !inside(point));
  if (firstOutside <= 0 || original.slice(firstOutside).some(inside)) throw new Error(`Market apron needs one real entry and an outside endpoint: ${edge.id}`);
  const points = original.map(point => ({ ...point }));
  const a = points[firstOutside - 1], b = points[firstOutside];
  const dx = b.x - a.x, dz = b.z - a.z;
  const exit = Math.min(1,
    dx > 0 ? (bounds.x1 - a.x) / dx : dx < 0 ? (bounds.x0 - a.x) / dx : Infinity,
    dz > 0 ? (bounds.z1 - a.z) / dz : dz < 0 ? (bounds.z0 - a.z) / dz : Infinity);
  if (exit < 0 || exit > 1 || !Number.isFinite(exit)) throw new Error(`Market apron boundary is not on its route: ${edge.id}`);
  let boundaryIndex = firstOutside - 1;
  if (exit > 1e-12) {
    // Keep the original horizontal polyline. Its intersection with this real
    // rectangle is a new physical grade vertex, never a render-only clip.
    const boundary = { x: a.x + dx * exit, y: a.y + (b.y - a.y) * exit, z: a.z + dz * exit };
    points.splice(firstOutside, 0, boundary);
    boundaryIndex = firstOutside;
  }
  for (let index = 0; index <= boundaryIndex; index++) points[index].y = station.y;
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) cumulative.push(cumulative[index - 1] + horizontalDistance(points[index - 1], points[index]));
  let installed: Vec3[] | null = null, maximumChangedGrade = Infinity, anchorIndex = -1;
  for (let anchor = boundaryIndex + 1; anchor < points.length; anchor++) {
    const span = cumulative[anchor] - cumulative[boundaryIndex];
    if (span <= 0) continue;
    const proposal = points.map(point => ({ ...point })), targetY = points[anchor].y;
    for (let index = boundaryIndex + 1; index < anchor; index++) proposal[index].y = quantize(station.y + (targetY - station.y) * (cumulative[index] - cumulative[boundaryIndex]) / span);
    let grade = 0;
    for (let index = 1; index <= anchor; index++) {
      const run = horizontalDistance(proposal[index - 1], proposal[index]);
      const rise = Math.abs(proposal[index].y - proposal[index - 1].y);
      grade = Math.max(grade, run ? rise / run : rise ? Infinity : 0);
    }
    if (grade <= MARKET_STATION_APRON_MAX_GRADE + 1e-12) { installed = proposal; maximumChangedGrade = grade; anchorIndex = anchor; break; }
  }
  if (!installed) throw new Error(`Market apron cannot preserve its endpoint at grade <= ${MARKET_STATION_APRON_MAX_GRADE}: ${edge.id}`);
  const proposed = fromStation ? installed : [...installed].reverse();
  for (const index of [0, proposed.length - 1]) {
    const expected = edge.points[index === 0 ? 0 : edge.points.length - 1];
    if (proposed[index].x !== expected.x || proposed[index].y !== expected.y || proposed[index].z !== expected.z) throw new Error(`Market apron changes a network endpoint: ${edge.id}`);
  }
  return { edgeId: edge.id, oldLength: edge.length, newLength: length(proposed), oldPoints: edge.points.map(point => ({ ...point })), newPoints: proposed,
    boundary: { ...installed[boundaryIndex] }, restoredOriginalVertex: { ...installed[anchorIndex] }, maximumChangedGrade };
}

/** Build every proposed route first. A failed grade leaves the World untouched. */
export function applyMarketStationApron(world: WorldDefinition): MarketStationApronChange[] {
  const station = world.nodes.find(node => node.id === 'market-station');
  if (!station) throw new Error('Market station is required by this city recipe');
  const changes = world.edges.filter(edge => (edge.mode === 'road' || edge.mode === 'bridge') && (edge.from === station.id || edge.to === station.id))
    .map(edge => gradeFromStation(edge, station.id, station.position));
  for (const change of changes) {
    const edge = world.edges.find(edge => edge.id === change.edgeId)!;
    edge.points = change.newPoints;
    edge.length = change.newLength;
  }
  // Layout count is unchanged; an existing guard cache must still be discarded.
  invalidateTransportGeometry(world);
  return changes;
}
