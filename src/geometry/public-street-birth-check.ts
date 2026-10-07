import { blocksFloorPlanReferenceMovement, buildingWorldPosition, getBuildingBody, getBuildingEntrance, getFloorPlanRoofRegions, getFloorPlanSlabRegions } from '../architecture-floor-plan';
import { blocksTransportBarrier, guardrailSpans, GUARDRAIL_THICKNESS } from '../transport-geometry';
import { getWalkHeight, terrainHeight } from '../world';
import { PUBLIC_STREET_BIRTH_CHECKS, PUBLIC_STREET_BIRTH_PARAMETERS, proposePublicStreetBirth, publicStreetBoxTopFaces, publicStreetPointInPolygon, publicStreetRoadCircleHeight, publicStreetRoadFaces, publicStreetRoadFaceHeight, validatePublicStreetBirth, type PublicStreetBirthCheckerContext, type PublicStreetBirthCheckerReceipt, type PublicStreetBirthProposal, type PublicStreetRoadFace } from './public-street-birth';
import type { Vec3, WorldDefinition } from '../types';

export const PUBLIC_STREET_BIRTH_CHECK_VERSION = 'public-market-road-body-check-v2' as const;
export const PUBLIC_STREET_BIRTH_CHECK_PARAMETERS = Object.freeze({
  supportBelowFeet: .26, supportStepAboveFeet: .22, radius: .35, height: 1.72,
  networkDomainMargin: Object.freeze({ road: 6, bridge: 13, maglev: 6, lightRail: 6, cable: 1, lift: 4 }),
  stationDomainHalfExtent: 14, originalBuildingTerrainShoulder: 14,
  numericEpsilon: 1e-9, maximumSupportFaces: 4096, runtimeCorridorDistance: .4,
  arrivalCurb: Object.freeze({ width: .4, height: .2, lift: .12, sideOffset: 4.75, maximumStep: .22 }),
});
type Point = Readonly<Vec3>;
interface Bounds { x0: number; x1: number; z0: number; z1: number }
interface SupportPatch { vertices: readonly Point[]; heightAt(x: number, z: number): number; gradient: number }
const EPS = PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.numericEpsilon;
const finitePoint = (p: Point) => !!p && [p.x, p.y, p.z].every(Number.isFinite);
const bounds = (points: readonly Point[], margin = 0): Bounds => ({ x0: Math.min(...points.map(p => p.x)) - margin, x1: Math.max(...points.map(p => p.x)) + margin, z0: Math.min(...points.map(p => p.z)) - margin, z1: Math.max(...points.map(p => p.z)) + margin });
const overlaps = (a: Bounds, b: Bounds) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;
const cross = (x: number, z: number, xx: number, zz: number) => x * zz - z * xx;
const at = (a: Point, b: Point, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
function pointSegmentSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return (p.x - a.x - dx * t) ** 2 + (p.z - a.z - dz * t) ** 2;
}
function cutsOnSegment(a: Point, b: Point, c: Point, d: Point): number[] {
  const dx = b.x - a.x, dz = b.z - a.z, ex = d.x - c.x, ez = d.z - c.z, determinant = cross(dx, dz, ex, ez);
  if (Math.abs(determinant) > EPS) {
    const t = cross(c.x - a.x, c.z - a.z, ex, ez) / determinant, u = cross(c.x - a.x, c.z - a.z, dx, dz) / determinant;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? [Math.max(0, Math.min(1, t))] : [];
  }
  if (Math.abs(cross(dx, dz, c.x - a.x, c.z - a.z)) > EPS) return [];
  const lengthSquared = dx * dx + dz * dz;
  if (!lengthSquared) return [];
  return [c, d].map(p => ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared).filter(t => t >= 0 && t <= 1);
}
function segmentDistanceSquared(a: Point, b: Point, c: Point, d: Point): number {
  if (cutsOnSegment(a, b, c, d).length || cutsOnSegment(c, d, a, b).length) return 0;
  return Math.min(pointSegmentSquared(a, c, d), pointSegmentSquared(b, c, d), pointSegmentSquared(c, a, b), pointSegmentSquared(d, a, b));
}
function touchesPolygon(a: Point, b: Point, vertices: readonly Point[], radius: number): boolean {
  return publicStreetPointInPolygon(vertices, a.x, a.z) || publicStreetPointInPolygon(vertices, b.x, b.z)
    || vertices.some((c, i) => segmentDistanceSquared(a, b, c, vertices[(i + 1) % vertices.length]) <= radius * radius + EPS);
}
/** Exact half-plane infinitesimal test, not a finite probe into another face.
 * It removes a seam only when the other polygon covers the outward side. */
function coversOutward(vertices: readonly Point[], p: Point, outwardX: number, outwardZ: number): boolean {
  return vertices.every((a, i) => {
    const b = vertices[(i + 1) % vertices.length], side = cross(b.x - a.x, b.z - a.z, p.x - a.x, p.z - a.z);
    return side > EPS || side >= -EPS && cross(b.x - a.x, b.z - a.z, outwardX, outwardZ) >= -EPS;
  });
}
/** Split every convex-face edge at the actual intersections. Retain only
 * union boundary pieces, including exposed corners and holes. No cap rounding,
 * voxel snapping, road-width expansion or .2m inspection samples are used. */
function unionBoundary(polygons: readonly (readonly Point[])[]): readonly [Point, Point][] {
  const result: [Point, Point][] = [];
  for (let owner = 0; owner < polygons.length; owner++) {
    const polygon = polygons[owner];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], cuts = [0, 1];
      for (let j = 0; j < polygons.length; j++) if (j !== owner) for (let k = 0; k < polygons[j].length; k++) cuts.push(...cutsOnSegment(a, b, polygons[j][k], polygons[j][(k + 1) % polygons[j].length]));
      cuts.sort((x, y) => x - y);
      for (let j = 1; j < cuts.length; j++) {
        if (cuts[j] - cuts[j - 1] <= EPS) continue;
        const middle = at(a, b, (cuts[j] + cuts[j - 1]) / 2), outwardX = b.z - a.z, outwardZ = a.x - b.x;
        if (polygons.some((other, index) => index !== owner && coversOutward(other, middle, outwardX, outwardZ))) continue;
        result.push([at(a, b, cuts[j - 1]), at(a, b, cuts[j])]);
      }
    }
  }
  return result;
}
function supportsWholeLeg(patches: readonly SupportPatch[], from: Point, to: Point, radius: number): boolean {
  const eligible = patches.filter(patch => {
    if (!touchesPolygon(from, to, patch.vertices, radius)) return false;
    return [from, to].every(p => {
      const y = patch.heightAt(p.x, p.z), variation = radius * patch.gradient;
      return y - variation >= p.y - PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.supportBelowFeet - EPS
        && y + variation <= p.y + PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.supportStepAboveFeet + EPS;
    });
  });
  if (!eligible.some(patch => publicStreetPointInPolygon(patch.vertices, from.x, from.z))) return false;
  const boundary = unionBoundary(eligible.map(patch => patch.vertices));
  return boundary.length > 0 && boundary.every(([a, b]) => segmentDistanceSquared(from, to, a, b) >= radius * radius - EPS);
}
const patchFromRoad = (face: PublicStreetRoadFace): SupportPatch => ({ vertices: face.vertices, heightAt: (x, z) => publicStreetRoadFaceHeight(face, x, z), gradient: Math.hypot(face.normal.x, face.normal.z) / face.normal.y });
/** Exact affine top maximum on a convex face intersected with a swept disk.
 * A capsule has two round ends and two straight sides. A linear maximum is
 * at a face vertex, a boundary intersection, or an end-disk gradient extreme;
 * those finite candidates cover the entire leg rather than movement samples. */
function topUnderWholeLeg(face: PublicStreetRoadFace, from: Point, to: Point, radius: number): number | null {
  const endHeights = [from, to].map(p => publicStreetRoadCircleHeight([face], p.x, p.z, radius)).filter((y): y is number => y !== null);
  let highest = endHeights.length ? Math.max(...endHeights) : null;
  const consider = (p: Point) => { const y = publicStreetRoadFaceHeight(face, p.x, p.z); highest = highest === null ? y : Math.max(highest, y); };
  for (const p of face.vertices) if (pointSegmentSquared(p, from, to) <= radius * radius + EPS) consider(p);
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
  if (length > 0) for (const side of [-1, 1]) {
    const nx = -dz / length * radius * side, nz = dx / length * radius * side;
    const left = { x: from.x + nx, y: from.y, z: from.z + nz }, right = { x: to.x + nx, y: to.y, z: to.z + nz };
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      for (const time of cutsOnSegment(a, b, left, right)) consider(at(a, b, time));
    }
  }
  return highest;
}
function arrivalCurbs(edge: WorldDefinition['edges'][number], segmentIndex?: number): readonly PublicStreetRoadFace[] {
  const faces: PublicStreetRoadFace[] = [], recipe = PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.arrivalCurb;
  for (let i = 1; i < edge.points.length; i++) {
    if (segmentIndex !== undefined && segmentIndex !== i) continue;
    const a = edge.points[i - 1], b = edge.points[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (!length) continue;
    for (const side of [-1, 1]) {
      const nx = -dz / length * recipe.sideOffset * side, nz = dx / length * recipe.sideOffset * side;
      faces.push(...publicStreetBoxTopFaces({ ...edge, points: [{ x: a.x + nx, y: a.y, z: a.z + nz }, { x: b.x + nx, y: b.y, z: b.z + nz }] }, recipe.width, recipe.height, recipe.lift));
    }
  }
  return faces;
}
const bind = (value: unknown): string => {
  const text = JSON.stringify(value); let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `${PUBLIC_STREET_BIRTH_CHECK_VERSION}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
const rejected = (reason: string): PublicStreetBirthCheckerReceipt => ({ status: 'rejected', reason, checked: [], descriptorBindings: { world: '', floor: '', terrain: '', fullNetwork: '' } });

/** Runtime v8 corridor consumer: exact face-circle height is returned only
 * when the same full-disk union rule certifies this actual point. A nearby
 * center height or a road's rounded nearest-segment cap cannot supply it. */
export function getPublicStreetBirthWalkHeight(world: WorldDefinition, x: number, z: number): number | null {
  const arrival = world.referenceCityRecipe?.arrival;
  if (!arrival) return null;
  const edge = world.edges.find(e => e.id === arrival.edgeId && e.mode === 'road'), building = world.buildings.find(b => b.id === arrival.buildingId);
  if (!edge || !building) return null;
  const deckFaces = publicStreetRoadFaces(edge), curbFaces = arrivalCurbs(edge), faces = [...deckFaces, ...curbFaces];
  const deckY = publicStreetRoadCircleHeight(deckFaces, x, z), y = publicStreetRoadCircleHeight(faces, x, z);
  if (y === null) return null;
  if (deckY === null || y - deckY > PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.arrivalCurb.maximumStep + EPS) return null;
  const patches = faces.map(patchFromRoad), ground = getBuildingBody(building)?.floorPlans.find(p => p.floor === 0);
  if (ground) for (const rect of getFloorPlanSlabRegions(ground)) {
    const vertices = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1]].map(([xx, zz]) => buildingWorldPosition(building, { x: xx, y: ground.y, z: zz }));
    const floorY = vertices[0].y; patches.push({ vertices, heightAt: () => floorY, gradient: 0 });
  }
  const feet = { x, y, z };
  return supportsWholeLeg(patches, feet, feet, .35) ? y : null;
}

/** Actual conservative route-local audit of the current renderer's complete
 * network generation domains. Domains enclose deck, curbs/rails, all recurring
 * bases/pillars/ties, bridge endwalls/towers/roof ornaments, station canopy/posts
 * and lift cage. A nearby unrelated domain rejects rather than silently being
 * treated as floor clearance. Far entities are excluded by complete bounds.
 * The historical Three collector has different v8/v9 dependencies and is not
 * imported or misrepresented as today's shared collision authority. */
export function checkPublicStreetBirthGeometry(context: PublicStreetBirthCheckerContext): PublicStreetBirthCheckerReceipt {
  const { world, proposal, building, edge, body } = context;
  const expected = proposePublicStreetBirth(world, proposal.distanceFromDoor);
  if (!expected.ok || JSON.stringify(expected.proposal) !== JSON.stringify(proposal)) return rejected('Proposal does not match the actual pre-birth world.');
  if (body.radius !== .35 || body.height !== 1.72 || world.voxelSize !== .2) return rejected('Body or lattice contract changed.');
  if (!Number.isFinite(world.size) || world.size <= 0 || !Array.isArray(world.mountains) || !Array.isArray(world.districts)
    || world.mountains.some(m => ![m.x, m.z, m.height, m.radius].every(Number.isFinite) || m.radius <= 0)
    || world.districts.some(d => !finitePoint(d.center) || !Number.isFinite(d.radius) || d.radius <= 0)
    || !finitePoint(world.waterfall.top) || !finitePoint(world.waterfall.bottom) || !Number.isFinite(world.waterfall.width)
    || world.waterfall.width <= 0 || !world.river.every(finitePoint)) return rejected('Complete terrain inputs are invalid.');
  const path = proposal.pathToDoor, routeBounds = bounds(path, body.radius), bodies = world.buildings.map(b => ({ building: b, body: getBuildingBody(b) }));
  if (Math.max(Math.abs(routeBounds.x0), Math.abs(routeBounds.x1), Math.abs(routeBounds.z0), Math.abs(routeBounds.z1)) > world.size / 2) return rejected('The full foot circle leaves world bounds.');
  const arrivalBody = getBuildingBody(building), ground = arrivalBody?.floorPlans.find(p => p.floor === 0), entrance = getBuildingEntrance(building);
  if (!ground || ground.permission !== 'public' || Math.hypot(entrance.x - building.door.x, entrance.y - building.door.y, entrance.z - building.door.z) > 1e-7) return rejected('The actual ground entrance is not this public market door.');
  const roadFaces = publicStreetRoadFaces(edge), supportPatches: SupportPatch[] = roadFaces.map(patchFromRoad), floorBindings: unknown[] = [];
  for (const row of bodies) {
    const b = row.building;
    if (!finitePoint(b.position) || !finitePoint(b.door) || ![b.width, b.depth, b.height, b.floors, b.rotation].every(Number.isFinite) || b.width <= 0 || b.depth <= 0 || b.height <= 0 || b.floors <= 0) return rejected('A building descriptor is invalid.');
    if (!row.body) {
      const reach = Math.hypot(b.width, b.depth) / 2 + 16;
      if (overlaps(routeBounds, { x0: b.position.x - reach, x1: b.position.x + reach, z0: b.position.z - reach, z1: b.position.z + reach })) return rejected(`Unshared landmark geometry is near the route: ${b.id}.`);
      continue;
    }
    floorBindings.push({ building: b, floors: row.body.floorPlans, roofs: getFloorPlanRoofRegions(row.body) });
    for (const plan of row.body.floorPlans) {
      // Include the higher head while stepping onto a real low curb. Moving
      // the feet below the declared surface would put them into its supporting
      // plinth, so lower support tolerance is checked by the face union below.
      for (let i = 1; i < path.length; i++) if (blocksFloorPlanReferenceMovement(b, plan.floor,
        path[i - 1], path[i], body.radius, body.height + PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.arrivalCurb.maximumStep)) return rejected(`The real building body blocks the complete leg: ${b.id}/${plan.floor}.`);
      for (const rect of getFloorPlanSlabRegions(plan)) {
        const vertices = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1]].map(([x, z]) => buildingWorldPosition(b, { x, y: plan.y, z }));
        if (!overlaps(routeBounds, bounds(vertices))) continue;
        const y = vertices[0].y; supportPatches.push({ vertices, heightAt: () => y, gradient: 0 });
      }
    }
  }
  if (supportPatches.length > PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.maximumSupportFaces) return rejected('Support face budget exceeded.');
  for (let i = 1; i < path.length; i++) {
    if (!supportsWholeLeg(supportPatches, path[i - 1], path[i], body.radius)) return rejected('Actual top-face union does not continuously support the complete .35m foot circle.');
    if (blocksTransportBarrier(world, path[i - 1], path[i], body.radius) || blocksTransportBarrier(world, path[i], path[i - 1], body.radius)) return rejected('The original transport barrier blocks the leg.');
  }
  const networkBindings: unknown[] = [];
  for (const candidate of world.edges) {
    if (!candidate.points.every(finitePoint) || candidate.points.length < 2) return rejected(`Invalid network polyline: ${candidate.id}.`);
    networkBindings.push(candidate);
    if (candidate.mode === 'flight' || candidate.mode === 'ferry') continue; // Current renderer generates no static solid for these modes.
    const margin = PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.networkDomainMargin[candidate.mode];
    if (margin === undefined) return rejected('Unknown network solid mode.');
    for (let i = 1; i < candidate.points.length; i++) {
      const a = candidate.points[i - 1], b = candidate.points[i], domain = bounds([a, b], margin);
      if (!overlaps(routeBounds, domain)) continue;
      if (candidate.id !== edge.id) return rejected(`Unrelated rendered network solid domain intersects the route: ${candidate.id}.`);
      // Arrival deck faces are checked above. Curbs/guard posts are outside the
      // actual side offsets; pillars/ties stay below y-.4. A high looping span
      // or a route crossing its curb is not waived merely for sharing an id.
      if (Math.max(a.y, b.y) > Math.min(...path.map(p => p.y)) + .26) return rejected('A higher arrival-road span could intersect the body or terrain envelope.');
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (!length) return rejected('Near-route road segment has no horizontal run.');
      const nx = -dz / length, nz = dx / length, recipe = PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.arrivalCurb;
      for (const face of arrivalCurbs(edge, i)) for (let leg = 1; leg < path.length; leg++) {
        const high = topUnderWholeLeg(face, path[leg - 1], path[leg], body.radius);
        if (high !== null && high > Math.min(path[leg - 1].y, path[leg].y) + recipe.maximumStep + EPS) return rejected('The actual curb top exceeds the unchanged .22m step envelope.');
      }
      const elevated = (a.y + b.y) / 2 - terrainHeight(world, (a.x + b.x) / 2, (a.z + b.z) / 2) > 4;
      if (elevated) for (const span of guardrailSpans(world, edge, i)) for (const side of [-1, 1]) {
        const points = [span.a, span.b].map(p => ({ x: p.x + nx * recipe.sideOffset * side, y: p.y, z: p.z + nz * recipe.sideOffset * side }));
        for (const face of publicStreetBoxTopFaces({ ...edge, points }, GUARDRAIL_THICKNESS, .2, 1.1))
          if (path.some((p, leg) => leg > 0 && topUnderWholeLeg(face, path[leg - 1], p, body.radius) !== null)) return rejected('The actual elevated-road wood guard blocks the complete leg.');
      }
    }
  }
  for (const node of world.nodes) {
    if (!finitePoint(node.position)) return rejected('Invalid network node.');
    networkBindings.push(node);
    const p = node.position;
    if (node.station && overlaps(routeBounds, bounds([p], PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.stationDomainHalfExtent))) return rejected(`Station canopy/post/platform domain is near the route: ${node.id}.`);
    if (!node.station && (node.id.includes('junction') || node.id.includes('road')) && overlaps(routeBounds, bounds([{ x: p.x + 4, y: p.y, z: p.z + 4 }], .2))) return rejected(`Junction signal post is near the route: ${node.id}.`);
  }
  // Continuous terrain upper bound: the certified road faces place the disk
  // within the actual <=5m road-cutting zone. Its ground is road.y-.6 (or lower
  // natural ground for an elevated deck); relief weight is zero there, and
  // river/valley/waterfall operations only lower it. The only upward override
  // is a real building foundation/12m shoulder, bounded explicitly below.
  // This is stronger than point samples; those remain useful diagnostics.
  const lowFeet = Math.min(...path.map(p => p.y));
  for (const b of world.buildings) {
    const domain = { x0: b.position.x - b.width / 2 - PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.originalBuildingTerrainShoulder, x1: b.position.x + b.width / 2 + PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.originalBuildingTerrainShoulder, z0: b.position.z - b.depth / 2 - PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.originalBuildingTerrainShoulder, z1: b.position.z + b.depth / 2 + PUBLIC_STREET_BIRTH_CHECK_PARAMETERS.originalBuildingTerrainShoulder };
    if (overlaps(routeBounds, domain) && b.position.y > lowFeet - .26) return rejected(`A real terrain foundation can protrude into the feet: ${b.id}.`);
  }
  for (const p of proposal.pathSamples) {
    const walk = getWalkHeight(world, p.x, p.z, p.y), terrain = terrainHeight(world, p.x, p.z);
    if (!Number.isFinite(walk) || !Number.isFinite(terrain) || Math.abs(walk - p.y) > .26 + EPS || terrain > p.y + .01) return rejected('Actual walk/terrain consumer disagrees with the route support envelope.');
  }
  return { status: 'accepted', checked: PUBLIC_STREET_BIRTH_CHECKS, descriptorBindings: {
    world: bind({ seed: world.seed, size: world.size, spawn: world.spawn, parameters: PUBLIC_STREET_BIRTH_CHECK_PARAMETERS, proposal }),
    floor: bind(floorBindings), terrain: bind({ seed: world.seed, mountains: world.mountains, districts: world.districts, river: world.river, waterfall: world.waterfall, buildings: world.buildings, edges: world.edges }),
    fullNetwork: bind({ currentRendererDomains: PUBLIC_STREET_BIRTH_CHECK_PARAMETERS, completeNetwork: networkBindings }),
  } };
}

export type ValidatedPublicStreetBirthResult = { ok: true; proposal: PublicStreetBirthProposal; receipt: PublicStreetBirthCheckerReceipt } | { ok: false; reason: string };
/** Deterministic declared candidate order. This never changes the old spawn,
 * returns a sampled proposal as accepted, or replaces a failed city silently. */
export function selectValidatedPublicStreetBirth(world: WorldDefinition): ValidatedPublicStreetBirthResult {
  const failures: string[] = [];
  for (const distance of PUBLIC_STREET_BIRTH_PARAMETERS.candidateDistancesFromDoor) {
    const candidate = proposePublicStreetBirth(world, distance);
    if (!candidate.ok) { failures.push(`${distance}m: ${candidate.reason}`); continue; }
    const checked = validatePublicStreetBirth(world, candidate.proposal, checkPublicStreetBirthGeometry);
    if (checked.ok) return { ok: true, proposal: candidate.proposal, receipt: checked.receipt };
    failures.push(`${distance}m: ${checked.reason}`);
  }
  return { ok: false, reason: failures.join(' | ') };
}
