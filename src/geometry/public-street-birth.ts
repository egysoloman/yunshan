import type { Building, NetworkEdge, Vec3, WorldDefinition } from '../types';

/** Proposal generation is not a legal-body proof.
 * Only the explicit new-city/current-v8 owner may select this recipe. Nothing
 * here writes world.spawn, moves an actor, loads a save, or changes a camera.
 */
export const PUBLIC_STREET_BIRTH_RECIPE_VERSION = 'public-market-road-birth-v2' as const;
export const PUBLIC_STREET_BIRTH_PARAMETERS = Object.freeze({
  marketDistrictId: 'market', coordinateQuantum: .2, coordinateQuantumXZ: .2,
  verticalPlacement: 'maximum-actual-road-face-under-foot-circle', pathPolicy: 'direct-certified-public-strip',
  preferredDistanceFromDoor: 10, minimumDistanceFromDoor: 8, maximumDistanceFromDoor: 12,
  candidateDistancesFromDoor: Object.freeze([10, 8, 12] as const),
  eyeHeight: 1.72, bodyRadius: .35, pathSampleArcStep: .2,
  eyeTargetAboveDoor: 1.2, maximumEdgePoints: 8192, maximumPathSamples: 256,
});

/** These are requirements, not observations or invented PASS receipts. Samples
 * help inspection, but only a complete authoritative geometry consumer can
 * prove continuous support and full-body clearance between those samples.
 */
export const PUBLIC_STREET_BIRTH_CHECKS = Object.freeze([
  'trusted-complete-floor-descriptors', 'trusted-terrain-descriptors',
  'trusted-complete-network-descriptors', 'public-ground-door-access',
  'whole-footprint-birth-support', 'whole-body-birth-headroom',
  'no-solid-contact-at-birth', 'continuous-whole-footprint-path-support',
  'continuous-full-body-path-clearance', 'transport-barrier-clearance', 'world-bounds',
] as const);
export type PublicStreetBirthCheck = typeof PUBLIC_STREET_BIRTH_CHECKS[number];
export type PublicStreetBirthWorld = Pick<WorldDefinition, 'spawn' | 'buildings' | 'nodes' | 'edges'>;

export interface PublicStreetBirthProposal {
  readonly status: 'proposal-requires-geometry-check';
  readonly recipeVersion: typeof PUBLIC_STREET_BIRTH_RECIPE_VERSION;
  readonly parameters: typeof PUBLIC_STREET_BIRTH_PARAMETERS;
  readonly originalSpawn: Readonly<Vec3>;
  /** XZ on the .2m lattice; feet y comes from actual rendered road top faces. */
  readonly birth: Readonly<Vec3>;
  readonly lookTarget: Readonly<Vec3>;
  readonly eyeTarget: Readonly<Vec3>;
  readonly buildingId: string;
  readonly edgeId: string;
  readonly doorNodeId: string;
  readonly doorAt: 'from' | 'to';
  readonly distanceFromDoor: number;
  /** Direct approach; its complete capsule must be certified on actual public faces. */
  readonly pathToDoor: readonly Readonly<Vec3>[];
  /** Quantized inspection samples. Rounding can increase adjacent sample gaps;
   * .2m sampling is never itself a continuous support/collision certificate. */
  readonly pathSamples: readonly Readonly<Vec3>[];
  readonly checksRequired: typeof PUBLIC_STREET_BIRTH_CHECKS;
}
export type PublicStreetBirthProposalResult =
  | { readonly ok: true; readonly proposal: PublicStreetBirthProposal }
  | { readonly ok: false; readonly reason: string };

const finitePoint = (point: Vec3): boolean => !!point && [point.x, point.y, point.z].every(Number.isFinite);
const samePoint = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const copy = (point: Vec3): Readonly<Vec3> => Object.freeze({ x: point.x, y: point.y, z: point.z });
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const q = (value: number): number => Math.round(value / PUBLIC_STREET_BIRTH_PARAMETERS.coordinateQuantum) * PUBLIC_STREET_BIRTH_PARAMETERS.coordinateQuantum;
const quantized = (point: Vec3): Readonly<Vec3> => copy({ x: q(point.x), y: point.y, z: q(point.z) });
const reject = (reason: string): PublicStreetBirthProposalResult => ({ ok: false, reason });

export interface PublicStreetRoadFace {
  readonly edgeId: string; readonly segmentIndex: number;
  readonly vertices: readonly Readonly<Vec3>[];
  readonly normal: Readonly<Vec3>; readonly planeConstant: number;
}
/** Same world-upward box face as BoxBatch.segment, without Three or WebGL. Width/height
 * belong to the rotated box, whereas lift offsets both endpoints in world Y.
 * Local Y=height/2 therefore cannot be substituted by a world-Y height/2.
 * The shortest-arc rotation may turn local +Y downward on a reversed graded
 * segment; its actual local -Y face then supplies the upward surface. Both
 * faces are existing physical box faces, never a flattened surrogate.
 * The original shortest-arc grade and crossfall are retained for decks, curbs
 * and any other explicitly supplied segment recipe. This does not widen feet,
 * ignore a curb, merge faces or create an acceptance certificate. */
export function publicStreetBoxTopFaces(edge: NetworkEdge, width: number, height: number, lift: number): readonly PublicStreetRoadFace[] {
  if (![width, height, lift].every(Number.isFinite) || width <= 0 || height <= 0) throw new RangeError('Invalid real segment-box dimensions.');
  const result: PublicStreetRoadFace[] = [], halfWidth = width / 2, halfHeight = height / 2;
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i], length = distance(a, b);
    if (!finitePoint(a) || !finitePoint(b) || !Number.isFinite(length)) throw new RangeError('Invalid real road segment.');
    if (length < .01) continue;
    const axis = { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length };
    let across: Vec3, up: Vec3;
    if (1 + axis.z < Number.EPSILON) { across = { x: -1, y: 0, z: 0 }; up = { x: 0, y: 1, z: 0 }; }
    else {
      const factor = Math.sqrt(2 * (1 + axis.z)), qx = -axis.y / factor, qy = axis.x / factor, qw = factor / 2;
      across = { x: 1 - 2 * qy * qy, y: 2 * qx * qy, z: -2 * qy * qw };
      up = { x: 2 * qx * qy, y: 1 - 2 * qx * qx, z: 2 * qx * qw };
    }
    if (Math.abs(up.y) <= 1e-8) throw new RangeError('Segment-box top is not a walkable height graph.');
    if (up.y < 0) up = { x: -up.x, y: -up.y, z: -up.z };
    const center = { x: (a.x + b.x) / 2 + up.x * halfHeight, y: (a.y + b.y) / 2 + lift + up.y * halfHeight, z: (a.z + b.z) / 2 + up.z * halfHeight };
    const vertices = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, end]) => copy({
      x: center.x + across.x * halfWidth * side + axis.x * length / 2 * end,
      y: center.y + across.y * halfWidth * side + axis.y * length / 2 * end,
      z: center.z + across.z * halfWidth * side + axis.z * length / 2 * end,
    }));
    const signedArea = vertices.reduce((sum, point, index) => { const next = vertices[(index + 1) % vertices.length]; return sum + point.x * next.z - next.x * point.z; }, 0);
    if (signedArea < 0) vertices.reverse();
    result.push(Object.freeze({ edgeId: edge.id, segmentIndex: i, vertices: Object.freeze(vertices), normal: copy(up), planeConstant: up.x * center.x + up.y * center.y + up.z * center.z }));
  }
  return Object.freeze(result);
}
/** The original real road dimensions remain unchanged. */
export function publicStreetRoadFaces(edge: NetworkEdge): readonly PublicStreetRoadFace[] {
  return edge.mode === 'road' ? publicStreetBoxTopFaces(edge, edge.id.includes('airport-runway-strip') ? 44 : 10, .5, -.25) : [];
}
export function publicStreetRoadFaceHeight(face: PublicStreetRoadFace, x: number, z: number): number {
  return (face.planeConstant - face.normal.x * x - face.normal.z * z) / face.normal.y;
}
export function publicStreetPointInPolygon(vertices: readonly Readonly<Vec3>[], x: number, z: number, strict = false): boolean {
  return vertices.every((a, i) => { const b = vertices[(i + 1) % vertices.length], cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x); return strict ? cross > 1e-9 : cross >= -1e-9; });
}
/** Exact maximum of an affine road plane on disk intersect convex top face.
 * Candidates are the disk's gradient extreme, face vertices and circle/edge
 * intersections. A missing intersection returns null, never a guessed y. */
export function publicStreetRoadCircleHeight(faces: readonly PublicStreetRoadFace[], x: number, z: number, radius: number = PUBLIC_STREET_BIRTH_PARAMETERS.bodyRadius): number | null {
  let highest: number | null = null;
  const consider = (face: PublicStreetRoadFace, px: number, pz: number) => { const y = publicStreetRoadFaceHeight(face, px, pz); highest = highest === null ? y : Math.max(highest, y); };
  for (const face of faces) {
    const gx = -face.normal.x / face.normal.y, gz = -face.normal.z / face.normal.y, gradient = Math.hypot(gx, gz);
    const extreme = gradient ? { x: x + radius * gx / gradient, z: z + radius * gz / gradient } : { x, z };
    if (publicStreetPointInPolygon(face.vertices, extreme.x, extreme.z)) consider(face, extreme.x, extreme.z);
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      if ((a.x - x) ** 2 + (a.z - z) ** 2 <= radius * radius + 1e-9) consider(face, a.x, a.z);
      const dx = b.x - a.x, dz = b.z - a.z, quadratic = dx * dx + dz * dz;
      if (!quadratic) continue;
      const linear = 2 * ((a.x - x) * dx + (a.z - z) * dz), constant = (a.x - x) ** 2 + (a.z - z) ** 2 - radius * radius;
      const discriminant = linear * linear - 4 * quadratic * constant;
      if (discriminant < -1e-9) continue;
      const root = Math.sqrt(Math.max(0, discriminant));
      for (const t of [(-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic)]) if (t >= 0 && t <= 1) consider(face, a.x + dx * t, a.z + dz * t);
    }
  }
  return highest;
}

function clippedEdgeFromDoor(points: readonly Vec3[], targetDistance: number): Vec3[] | null {
  const result = [{ ...points[0] }]; let remaining = targetDistance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    if (!Number.isFinite(length)) return null;
    if (length === 0) continue;
    if (remaining <= length) {
      const t = remaining / length;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
      return result;
    }
    remaining -= length; result.push({ ...b });
  }
  return null;
}

function inspectionSamples(path: readonly Readonly<Vec3>[]): readonly Readonly<Vec3>[] | null {
  const result: Readonly<Vec3>[] = [copy(path[0])];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], length = distance(a, b);
    const steps = Math.max(1, Math.ceil(length / PUBLIC_STREET_BIRTH_PARAMETERS.pathSampleArcStep));
    if (!Number.isSafeInteger(steps) || steps > PUBLIC_STREET_BIRTH_PARAMETERS.maximumPathSamples) return null;
    for (let j = 1; j <= steps; j++) {
      const t = j / steps, point = j === steps ? copy(b) : quantized({
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
      });
      if (!samePoint(result[result.length - 1], point)) result.push(point);
      if (result.length > PUBLIC_STREET_BIRTH_PARAMETERS.maximumPathSamples) return null;
    }
  }
  return Object.freeze(result);
}

/** Select the same arrival-market family as the renderer: market district,
 * market kind, nearest door in XZ from the original spawn, with a stable id tie.
 * A door graph node is identified by its real position/name/district, then the
 * actual from/to relation and edge endpoint. No synthesized id or edge-name
 * convention supplies authority. A missing/ambiguous binding rejects; this
 * helper does not silently fall back to the old spawn or another building.
 */
export function proposePublicStreetBirth(world: PublicStreetBirthWorld, distanceFromDoor: number = PUBLIC_STREET_BIRTH_PARAMETERS.preferredDistanceFromDoor): PublicStreetBirthProposalResult {
  if (!finitePoint(world.spawn)) return reject('Original spawn is not finite.');
  if (!PUBLIC_STREET_BIRTH_PARAMETERS.candidateDistancesFromDoor.some(value => value === distanceFromDoor)) return reject('Distance is not a declared birth candidate.');
  const markets = world.buildings.filter(site => site.kind === 'market' && site.districtId === PUBLIC_STREET_BIRTH_PARAMETERS.marketDistrictId);
  if (!markets.length || markets.some(site => !finitePoint(site.door))) return reject('Arrival market doors are missing or invalid.');
  markets.sort((a, b) => Math.hypot(a.door.x - world.spawn.x, a.door.z - world.spawn.z)
    - Math.hypot(b.door.x - world.spawn.x, b.door.z - world.spawn.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const building = markets[0];
  if (world.buildings.filter(site => site.id === building.id).length !== 1) return reject('Arrival building identity is ambiguous.');
  const doorNodes = world.nodes.filter(node => !node.station && node.districtId === building.districtId
    && node.name === building.name && finitePoint(node.position) && samePoint(node.position, building.door));
  if (doorNodes.length !== 1) return reject('Arrival door has no unique actual graph node.');
  const doorNode = doorNodes[0];
  if (world.nodes.filter(node => node.id === doorNode.id).length !== 1) return reject('Arrival door-node identity is ambiguous.');
  const connections = world.edges.filter(edge => edge.mode === 'road' && (edge.from === doorNode.id || edge.to === doorNode.id));
  if (connections.length !== 1) return reject('Arrival door has no unique actual road edge.');
  const edge = connections[0], doorAt = edge.from === doorNode.id ? 'from' : 'to';
  if (edge.from === edge.to || world.edges.filter(row => row.id === edge.id).length !== 1) return reject('Arrival road-edge identity is ambiguous.');
  if (edge.points.length < 2 || edge.points.length > PUBLIC_STREET_BIRTH_PARAMETERS.maximumEdgePoints || !edge.points.every(finitePoint)) return reject('Arrival road polyline is invalid or exceeds the declared budget.');
  const fromNodes = world.nodes.filter(node => node.id === edge.from), toNodes = world.nodes.filter(node => node.id === edge.to);
  if (fromNodes.length !== 1 || toNodes.length !== 1 || !finitePoint(fromNodes[0].position) || !finitePoint(toNodes[0].position)
    || !samePoint(edge.points[0], fromNodes[0].position) || !samePoint(edge.points[edge.points.length - 1], toNodes[0].position)) return reject('Arrival road endpoints do not match actual graph-node positions.');
  const oriented = doorAt === 'from' ? edge.points : [...edge.points].reverse();
  if (!samePoint(oriented[0], building.door)) return reject('Arrival road endpoint is not the actual building door.');
  const prefix = clippedEdgeFromDoor(oriented, distanceFromDoor);
  if (!prefix) return reject('Actual road has insufficient finite length for the declared candidate.');
  const faces = publicStreetRoadFaces(edge), source = prefix[prefix.length - 1], x = q(source.x), z = q(source.z), y = publicStreetRoadCircleHeight(faces, x, z);
  if (y === null || !Number.isFinite(y)) return reject('Actual road face has no finite foot-circle support at birth.');
  const birth = copy({ x, y, z }), path = [birth, copy(building.door)];
  if (path.length < 2) return reject('Quantized birth collapsed onto the door.');
  const pathToDoor = Object.freeze(path), pathSamples = inspectionSamples(pathToDoor);
  if (!pathSamples) return reject('Birth-path inspection plan exceeds the declared sample budget.');
  const proposal: PublicStreetBirthProposal = Object.freeze({
    status: 'proposal-requires-geometry-check', recipeVersion: PUBLIC_STREET_BIRTH_RECIPE_VERSION,
    parameters: PUBLIC_STREET_BIRTH_PARAMETERS, originalSpawn: copy(world.spawn), birth,
    lookTarget: copy(building.door), eyeTarget: quantized({ ...building.door, y: building.door.y + PUBLIC_STREET_BIRTH_PARAMETERS.eyeTargetAboveDoor }),
    buildingId: building.id, edgeId: edge.id, doorNodeId: doorNode.id, doorAt, distanceFromDoor,
    pathToDoor, pathSamples, checksRequired: PUBLIC_STREET_BIRTH_CHECKS,
  });
  return { ok: true, proposal };
}

export interface PublicStreetBirthCheckerContext {
  /** The complete trusted pre-birth world, including terrain/network/floor inputs. */
  readonly world: WorldDefinition;
  readonly building: Building;
  readonly edge: NetworkEdge;
  readonly proposal: PublicStreetBirthProposal;
  readonly body: { readonly height: 1.72; readonly radius: .35 };
}
export interface PublicStreetBirthCheckerReceipt {
  readonly status: 'accepted' | 'rejected';
  readonly checked: readonly PublicStreetBirthCheck[];
  /** Actual authoritative descriptor bindings supplied by the caller. This
   * module neither computes them nor represents arbitrary strings as proof. */
  readonly descriptorBindings: { readonly world: string; readonly floor: string; readonly terrain: string; readonly fullNetwork: string };
  readonly reason?: string;
}
export type PublicStreetBirthChecker = (context: PublicStreetBirthCheckerContext) => PublicStreetBirthCheckerReceipt;
export type PublicStreetBirthValidationResult =
  | { readonly ok: true; readonly status: 'accepted-by-injected-geometry-checker'; readonly proposal: PublicStreetBirthProposal; readonly receipt: PublicStreetBirthCheckerReceipt }
  | { readonly ok: false; readonly reason: string };

/** Optional trusted-host gate. This checks binding/coverage of a caller's real
 * geometry receipt; it implements no floor/terrain/network consumer itself.
 * Supply the pre-birth world, not a world whose spawn was already overwritten.
 * It returns evidence only and never publishes a candidate or modifies state.
 */
export function validatePublicStreetBirth(world: WorldDefinition, proposal: PublicStreetBirthProposal, checker: PublicStreetBirthChecker): PublicStreetBirthValidationResult {
  const expected = proposePublicStreetBirth(world, proposal.distanceFromDoor);
  if (!expected.ok || JSON.stringify(expected.proposal) !== JSON.stringify(proposal)) return { ok: false, reason: 'Proposal does not match the complete trusted pre-birth graph inputs.' };
  if (typeof checker !== 'function') return { ok: false, reason: 'An authoritative complete-geometry checker is required.' };
  const building = world.buildings.find(site => site.id === proposal.buildingId)!, edge = world.edges.find(row => row.id === proposal.edgeId)!;
  let receipt: PublicStreetBirthCheckerReceipt;
  try { receipt = checker({ world, building, edge, proposal, body: { height: 1.72, radius: .35 } }); }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Authoritative geometry checker rejected the proposal.' }; }
  if (!receipt || receipt.status !== 'accepted') return { ok: false, reason: receipt?.reason ?? 'Authoritative geometry checker did not accept the proposal.' };
  const checked = new Set(receipt.checked), bindings = receipt.descriptorBindings;
  if (PUBLIC_STREET_BIRTH_CHECKS.some(check => !checked.has(check)) || !bindings
    || [bindings.world, bindings.floor, bindings.terrain, bindings.fullNetwork].some(value => typeof value !== 'string' || !value.length)) return { ok: false, reason: 'Geometry receipt lacks complete body/path checks or floor/terrain/full-network bindings.' };
  return { ok: true, status: 'accepted-by-injected-geometry-checker', proposal, receipt };
}
