import { buildingLocalPosition, blocksFloorPlanMovement, contains, floorPlanSupport, getBuildingFloorPlan, getFloorPlanSlabRegions, type FloorPlan, type FloorSupport, type Rect } from '../architecture-floor-plan';
import type { Building, Vec3, WorldDefinition } from '../types';

const EPS = 1e-7;
const BODY_RADIUS = .35;
const EYE_HEIGHT = 1.72;
const MAX_PARTS = 128;
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 => t === 0 ? { ...a } : t === 1 ? { ...b } : ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const samePoint = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const finitePoint = (v: unknown): v is Vec3 => plain(v) && ['x', 'y', 'z'].every(key => typeof v[key] === 'number' && Number.isFinite(v[key]));
const strictPoint = (v: unknown): v is Vec3 => finitePoint(v) && Object.keys(v).length === 3 && Object.keys(v).every(key => ['x', 'y', 'z'].includes(key));

export type NpcStairCursor = { version: 1; buildingId: string; routeIndex: number; piece: number; offset: number; from: Vec3; to: Vec3 };
interface RiserFaces { lower: Vec3; upper: Vec3 }
export interface NpcStairPart { kind: 'flat' | 'riser'; from: Vec3; to: Vec3; length: number; fromFloor: number; toFloor: number; faces?: RiserFaces }
export interface NpcStairLeg { building: Building; routeIndex: number; referenceFrom: Vec3; referenceTo: Vec3; from: Vec3; to: Vec3; parts: NpcStairPart[]; length: number; floors: number[]; zeroRiser?: RiserFaces }
export type NpcStairDescription = { kind: 'legacy'; bodies?: { building: Building; floors: number[] }[] } | { kind: 'blocked'; buildingId: string } | { kind: 'physical'; leg: NpcStairLeg };
export type NpcStairAdvance = { position: Vec3; usedDistance: number; finishedLeg: boolean; blocked: boolean };
type Witness = { building: Building; floors: number[]; geometry: string };
type CachedLeg = { from: Vec3; to: Vec3; result: NpcStairDescription; building?: Building; floors?: number[]; geometry?: string; witnesses?: Witness[]; collection?: Building[]; collectionLength?: number };

function segmentHits(a: Vec3, z: Vec3, r: Rect): boolean {
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [[a.x, z.x - a.x, r.x0, r.x1], [a.z, z.z - a.z, r.z0, r.z1]]) {
    if (delta === 0) { if (start < min - EPS || start > max + EPS) return false; continue; }
    const x = (min - start) / delta, y = (max - start) / delta;
    lo = Math.max(lo, Math.min(x, y)); hi = Math.min(hi, Math.max(x, y));
    if (lo > hi + EPS) return false;
  }
  return true;
}

/** Interprets only identified, marked stair legs. The saved route remains the
 * original bounded reference route; actual flat travel and finite vertical
 * climbs have their own metre budget. No epsilon can complete unpaid travel. */
export class NpcStairMotion {
  private readonly cache = new WeakMap<Vec3[], Map<number, CachedLeg>>();
  private readonly world: WorldDefinition;
  private readonly memberIndex = new WeakMap<Building, number>();
  private readonly counters = { routes: 0, materializations: 0, cacheHits: 0, geometryChecks: 0, staleLegs: 0, buildingScans: 0 };

  /** Sample length for validating and walking physical legs (see npc-motion-coarse.ts). */
  private readonly step: () => number;
  constructor(world: WorldDefinition, step: () => number = () => .05) {
    this.world = world; this.step = step;
    world.buildings.forEach((building, index) => this.memberIndex.set(building, index));
  }

  stats() { return { ...this.counters }; }

  // Within one simulation tick the world's floor plans are fixed: no phase
  // edits geometry. Geometry fingerprints and body supports are then
  // remembered for the rest of that tick only; every new tick (and every call
  // outside a tick) reads the public descriptors again.
  private tick: { geometry: Map<string, string>; support: Map<string, FloorSupport | null> } | null = null;
  withinTick<T>(run: () => T): T {
    const outer = this.tick; this.tick = outer ?? { geometry: new Map(), support: new Map() };
    try { return run(); } finally { this.tick = outer; }
  }

  private plans(b: Building, floors: readonly number[]): FloorPlan[] { return floors.map(floor => getBuildingFloorPlan(b, floor)).filter((plan): plan is FloorPlan => !!plan); }

  private member(b: Building): boolean {
    const index = this.memberIndex.get(b);
    if (index !== undefined && this.world.buildings[index] === b) return true;
    // Only a collection edit takes this slower path; normal cursor validation
    // checks one array slot instead of scanning the city on every movement.
    const current = this.world.buildings.indexOf(b);
    if (current < 0) return false;
    this.memberIndex.set(b, current); return true;
  }

  private geometry(b: Building, floors: readonly number[]): string {
    this.counters.geometryChecks++;
    if (!this.member(b)) throw new Error('physical stair building no longer belongs to this world');
    const memo = this.tick?.geometry, key = memo ? `${this.memberIndex.get(b)}:${floors.join(',')}` : '';
    const known = memo?.get(key); if (known !== undefined) return known;
    const value = this.fingerprint(b, floors); memo?.set(key, value); return value;
  }

  private fingerprint(b: Building, floors: readonly number[]): string {
    // Floor plans are public mutable descriptors. Include their values rather
    // than relying on array identity, and inspect only this leg's nearby floors.
    return JSON.stringify([b.id, b.floorPlanProfile, b.stairGeometryRevision, b.commercialGeometryRevision, b.commercialRouteRevision,
      b.position, b.rotation, b.width, b.depth, b.height, b.floors, b.basements, b.kind,
      floors.map(floor => [floor, b.floorFootprints?.[floor], getBuildingFloorPlan(b, floor)])]);
  }

  private support(b: Building, position: Vec3): FloorSupport | null {
    if (!finitePoint(position)) return null;
    const memo = this.tick?.support;
    if (!memo) return this.measuredSupport(b, position);
    const coordinate = (n: number) => Object.is(n, -0) ? '-0' : String(n), key = `${this.memberIndex.get(b) ?? b.id}|${coordinate(position.x)}|${coordinate(position.y)}|${coordinate(position.z)}`;
    if (memo.has(key)) return memo.get(key)!;
    const value = this.measuredSupport(b, position); memo.set(key, value); return value;
  }

  private measuredSupport(b: Building, position: Vec3): FloorSupport | null {
    const nominal = Math.round((position.y - b.position.y - .6) / (b.height / b.floors));
    let best: FloorSupport | null = null;
    for (const floor of [nominal, nominal - 1, nominal + 1]) {
      const found = floorPlanSupport(b, floor, position, BODY_RADIUS);
      if (found && (!best || Math.abs(found.y - position.y) < Math.abs(best.y - position.y))) best = found;
    }
    return best;
  }

  private face(leg: NpcStairLeg, position: Vec3): boolean {
    const b = leg.building, local = buildingLocalPosition(b, position);
    for (const plan of this.plans(b, leg.floors)) {
      if (Math.abs(local.y - plan.y) <= EPS && getFloorPlanSlabRegions(plan).some(rect => contains(rect, local.x, local.z))) return true;
      if ([...plan.stairTreads, ...plan.stairLandings].some(surface => Math.abs(local.y - surface.top) <= EPS && contains(surface.rect, local.x, local.z))) return true;
    }
    return false;
  }

  private riserFaces(leg: NpcStairLeg, position: Vec3): RiserFaces | null {
    const b = leg.building, local = buildingLocalPosition(b, position), faces: { y: number; boundary: boolean }[] = [];
    const add = (height: number, rect: Rect, realStairEdge: boolean) => {
      if (!contains(rect, local.x, local.z)) return;
      const boundary = realStairEdge && Math.min(Math.abs(local.x - rect.x0), Math.abs(local.x - rect.x1), Math.abs(local.z - rect.z0), Math.abs(local.z - rect.z1)) <= EPS;
      faces.push({ y: b.position.y + .6 + height, boundary });
    };
    for (const plan of this.plans(b, leg.floors)) {
      for (const rect of getFloorPlanSlabRegions(plan)) add(plan.y, rect, false);
      for (const surface of [...plan.stairTreads, ...plan.stairLandings]) add(surface.top, surface.rect, true);
    }
    for (const lower of faces) for (const upper of faces) {
      if (!(position.y > lower.y && position.y < upper.y) || Math.abs(upper.y - lower.y - .2) > EPS || !lower.boundary && !upper.boundary) continue;
      const result = { lower: { ...position, y: lower.y }, upper: { ...position, y: upper.y } };
      if (this.face(leg, result.lower) && this.face(leg, result.upper)) return result;
    }
    return null;
  }

  private pose(leg: NpcStairLeg, part: NpcStairPart | undefined, position: Vec3): FloorSupport | null {
    const support = this.support(leg.building, position); if (!support) return null;
    if (!part) {
      if (Math.abs(support.y - position.y) > EPS && !(leg.zeroRiser && samePoint(leg.from, leg.to) && samePoint(position, leg.from)
        && this.face(leg, leg.zeroRiser.lower) && this.face(leg, leg.zeroRiser.upper) && Math.abs(support.y - position.y) <= .20000001)) return null;
    } else if (part.kind === 'riser') {
      // Both physical faces must still exist. A nearby lower slab cannot
      // authorize climbing an old cached riser after its tread was removed.
      const lower = part.faces?.lower ?? part.from, upper = part.faces?.upper ?? part.to;
      if (!this.face(leg, lower) || !this.face(leg, upper) || Math.abs(support.y - position.y) > .20000001) return null;
    } else if (Math.abs(support.y - position.y) > EPS) {
      const boundary = leg.parts.some(riser => riser.kind === 'riser' && (samePoint(riser.from, position) || samePoint(riser.to, position)));
      if (!boundary || Math.abs(support.y - position.y) > .20000001 || !this.face(leg, position)) return null;
    }
    return blocksFloorPlanMovement(leg.building, support.floor, position, position, BODY_RADIUS, EYE_HEIGHT) ? null : support;
  }

  describe(route: Vec3[], index: number): NpcStairDescription {
    if (!Array.isArray(route) || !Number.isSafeInteger(index) || index < 1 || index >= route.length || !finitePoint(route[index - 1]) || !finitePoint(route[index])) return { kind: 'legacy' };
    const from = route[index - 1], to = route[index];
    let entries = this.cache.get(route);
    if (!entries) { entries = new Map(); this.cache.set(route, entries); this.counters.routes++; }
    const old = entries.get(index);
    if (old) {
      if (!samePoint(from, old.from) || !samePoint(to, old.to)) {
        if (old.building) { this.counters.staleLegs++; old.result = { kind: 'blocked', buildingId: old.building.id }; return old.result; }
        entries.delete(index);
      } else if (old.building && old.floors) {
        try {
          if (this.geometry(old.building, old.floors) !== old.geometry) { this.counters.staleLegs++; old.result = { kind: 'blocked', buildingId: old.building.id }; return old.result; }
        } catch { old.result = { kind: 'blocked', buildingId: old.building.id }; return old.result; }
        this.counters.cacheHits++; return old.result;
      } else {
        let unchanged = old.collection === this.world.buildings && old.collectionLength === this.world.buildings.length;
        if (unchanged) try { unchanged = (old.witnesses ?? []).every(witness => this.geometry(witness.building, witness.floors) === witness.geometry); } catch { unchanged = false; }
        if (unchanged) { this.counters.cacheHits++; return old.result; }
        entries.delete(index);
      }
    }

    const witnesses: Witness[] = [], length = Math.hypot(to.x - from.x, to.z - from.z);
    for (const b of this.world.buildings) {
      this.counters.buildingScans++;
      const margin = Math.max(b.width, b.depth) / 2 + 3;
      // Every point of the leg's local bounding box lies within the leg's length
      // of its start. Beyond the square's circumradius plus that length (and a
      // metre for rotation rounding) the box test below must reject the site.
      const reach = margin * Math.SQRT2 + length + 1, ox = from.x - b.position.x, oz = from.z - b.position.z;
      if (Number.isFinite(reach) && ox * ox + oz * oz > reach * reach) continue;
      const a = buildingLocalPosition(b, from), z = buildingLocalPosition(b, to);
      if (Math.min(a.x, z.x) > margin || Math.max(a.x, z.x) < -margin || Math.min(a.z, z.z) > margin || Math.max(a.z, z.z) < -margin) continue;
      const height = b.height / b.floors;
      if (!(height > 0) || !Number.isFinite(height)) continue;
      if (Math.min(a.y, z.y) > b.height + .5 || Math.max(a.y, z.y) + EYE_HEIGHT < -(b.basements ?? 0) * height - .5) continue;
      const low = Math.round(Math.min(a.y, z.y) / height) - 1, high = Math.round(Math.max(a.y, z.y) / height) + 1;
      const floors = Array.from({ length: Math.min(7, Math.max(0, high - low + 1)) }, (_, i) => low + i);
      // A cached legacy leg near an unmarked body must notice that this body
      // later acquires real stairs; retain only its local geometry witness.
      if (b.stairGeometryRevision !== 2) {
        try { witnesses.push({ building: b, floors, geometry: this.geometry(b, floors) }); } catch { /* A malformed unmarked body retains its original movement contract. */ }
        continue;
      }
      const plans = this.plans(b, floors);
      const hits = plans.some(plan => Math.min(a.y, z.y) <= plan.y + .42 && Math.max(a.y, z.y) >= plan.y - .42 && segmentHits(a, z, plan.stairLanding)
        || [...plan.stairTreads, ...plan.stairLandings].some(surface => surface.top >= Math.min(a.y, z.y) - .42 && surface.top <= Math.max(a.y, z.y) + .42 && segmentHits(a, z, surface.rect)));
      if (!hits) {
        try { witnesses.push({ building: b, floors, geometry: this.geometry(b, floors) }); } catch { /* No identified stair leg exists here. */ }
        continue;
      }
      let result: NpcStairDescription = { kind: 'blocked', buildingId: b.id }, geometry: string;
      try {
        geometry = this.geometry(b, floors);
        if (high - low + 1 <= 7) {
          const leg = this.materialize(b, floors, route, index);
          if (leg) result = { kind: 'physical', leg };
        }
      } catch { geometry = ''; }
      entries.set(index, { from: { ...from }, to: { ...to }, result, building: b, floors, geometry });
      return result;
    }
    const result: NpcStairDescription = { kind: 'legacy', bodies: witnesses.filter(witness => witness.building.floorPlanProfile === 'v4-program-bodies-02').map(witness => ({ building: witness.building, floors: witness.floors })) };
    entries.set(index, { from: { ...from }, to: { ...to }, result, witnesses, collection: this.world.buildings, collectionLength: this.world.buildings.length }); return result;
  }

  private materialize(b: Building, floors: number[], route: Vec3[], index: number): NpcStairLeg | null {
    this.counters.materializations++;
    const referenceFrom = { ...route[index - 1] }, referenceTo = { ...route[index] };
    const startSupport = this.support(b, referenceFrom), endSupport = this.support(b, referenceTo);
    if (!startSupport || !endSupport || Math.abs(startSupport.y - referenceFrom.y) > .42000001 || Math.abs(endSupport.y - referenceTo.y) > .42000001) return null;
    const from = { ...referenceFrom, y: startSupport.y }, to = { ...referenceTo, y: endSupport.y };
    const leg: NpcStairLeg = { building: b, routeIndex: index, referenceFrom, referenceTo, from, to, parts: [], length: 0, floors };
    // A replan starts at the actual body. Only an exact physical riser boundary
    // can retain a between-level origin; no XYZ projection or support-height
    // lift is used. Duplicate origin prefix points retain the same finite phase.
    const actualOrigin = route.slice(0, index).every(position => samePoint(position, referenceFrom));
    const entry = actualOrigin ? this.riserFaces(leg, referenceFrom) : null;
    if (actualOrigin && !entry && !samePoint(referenceFrom, leg.from)) return null;
    if (entry) {
      leg.from = { ...referenceFrom };
      if (samePoint(referenceFrom, referenceTo)) { leg.to = { ...referenceTo }; leg.zeroRiser = entry; }
    }
    const a = buildingLocalPosition(b, referenceFrom), z = buildingLocalPosition(b, referenceTo), dx = z.x - a.x, dz = z.z - a.z;
    if (dx === 0 && dz === 0) {
      // Recovery can encode two reference heights for the very same planted
      // pose. Such a leg advances the route index without lifting the actor.
      if (!samePoint(leg.from, leg.to)) {
        if (!entry || Math.abs(leg.from.y - leg.to.y) > .20000001 || leg.to.y !== entry.lower.y && leg.to.y !== entry.upper.y) return null;
        const first = this.support(b, leg.from), last = this.support(b, leg.to); if (!first || !last) return null;
        const part: NpcStairPart = { kind: 'riser', from: { ...leg.from }, to: { ...leg.to }, length: distance(leg.from, leg.to), fromFloor: first.floor, toFloor: last.floor, faces: entry };
        leg.parts.push(part); leg.length = part.length;
        const samples = Math.max(1, Math.ceil(part.length / this.step())); let previous = part.from;
        for (let i = 0; i <= samples; i++) {
          const position = interpolate(part.from, part.to, i / samples), support = this.pose(leg, part, position);
          if (!support || blocksFloorPlanMovement(b, support.floor, previous, position, BODY_RADIUS, EYE_HEIGHT)) return null;
          previous = position;
        }
        return this.pose(leg, undefined, leg.to) ? leg : null;
      }
      if (!this.pose(leg, undefined, leg.from)) return null;
      return leg;
    }
    const cuts = [0, 1];
    for (const plan of this.plans(b, floors)) for (const surface of [...plan.stairTreads, ...plan.stairLandings]) {
      const r = surface.rect;
      for (const [start, delta, edge, orthStart, orthDelta, min, max] of [[a.x, dx, r.x0, a.z, dz, r.z0, r.z1], [a.x, dx, r.x1, a.z, dz, r.z0, r.z1], [a.z, dz, r.z0, a.x, dx, r.x0, r.x1], [a.z, dz, r.z1, a.x, dx, r.x0, r.x1]]) {
        if (delta === 0) continue;
        const t = (edge - start) / delta, orth = orthStart + orthDelta * t;
        if (t > 0 && t < 1 && orth >= min - EPS && orth <= max + EPS) cuts.push(t);
      }
    }
    const sorted = cuts.sort((x, y) => x - y).filter((t, i, values) => i === 0 || t !== values[i - 1]);
    let feet = { ...leg.from };
    const append = (target: Vec3): boolean => {
      const d = distance(feet, target); if (d === 0) return true;
      const flat = feet.y === target.y;
      if (!flat && (feet.x !== target.x || feet.z !== target.z || Math.abs(feet.y - target.y) > .20000001)) return false;
      const first = this.support(b, feet), last = this.support(b, target); if (!first || !last) return false;
      const part: NpcStairPart = { kind: flat ? 'flat' : 'riser', from: { ...feet }, to: { ...target }, length: d, fromFloor: first.floor, toFloor: last.floor };
      if (!flat && !this.face(leg, feet)) {
        const faces = this.riserFaces(leg, feet);
        if (!faces || target.y !== faces.lower.y && target.y !== faces.upper.y) return false;
        part.faces = faces;
      }
      leg.parts.push(part); leg.length += d; feet = { ...target }; return leg.parts.length <= MAX_PARTS;
    };
    for (let i = 1; i < sorted.length; i++) {
      const start = sorted[i - 1], end = sorted[i], middle = interpolate(referenceFrom, referenceTo, (start + end) / 2), support = this.support(b, middle);
      if (!support) return null;
      const first = interpolate(referenceFrom, referenceTo, start), last = interpolate(referenceFrom, referenceTo, end);
      first.y = last.y = support.y;
      if (!append(first) || !append(last)) return null;
    }
    if (!append(leg.to)) return null;
    for (const part of leg.parts) {
      const samples = Math.max(1, Math.ceil(part.length / this.step())); let previous = part.from;
      for (let i = 0; i <= samples; i++) {
        const position = interpolate(part.from, part.to, i / samples), support = this.pose(leg, part, position);
        if (!support || blocksFloorPlanMovement(b, support.floor, previous, position, BODY_RADIUS, EYE_HEIGHT)) return null;
        previous = position;
      }
    }
    return this.pose(leg, undefined, leg.to) ? leg : null;
  }

  opening(route: Vec3[], index: number): NpcStairCursor | null {
    const description = this.describe(route, index); if (description.kind !== 'physical') return null;
    return { version: 1, buildingId: description.leg.building.id, routeIndex: index, piece: 0, offset: 0, from: { ...route[index - 1] }, to: { ...route[index] } };
  }

  /** A new exterior approach is a plan, not a partly traversed stair phase.
   * The native mover still refuses a blocked leg. Preserve only the exact
   * unstarted road-to-door intent; never infer a cursor or move the body. */
  isUnstartedExteriorDoorApproach(route: Vec3[], index: number, body: Vec3): boolean {
    if (index !== 1 || !strictPoint(body) || !Array.isArray(route) || !strictPoint(route[0]) || !samePoint(body, route[0])) return false;
    const description = this.describe(route, index);
    if (description.kind !== 'blocked') return false;
    const entry = this.cache.get(route)?.get(index), building = entry?.building;
    if (!building || !this.member(building) || !samePoint(route[index], building.door)) return false;
    const dimensions = [building, ...(building.floorFootprints ?? [])];
    if (dimensions.some(level => !Number.isFinite(level.width) || !(level.width > 0) || !Number.isFinite(level.depth) || !(level.depth > 0))) return false;
    const width = Math.max(...dimensions.map(level => level.width)), depth = Math.max(...dimensions.map(level => level.depth));
    const bounds = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
    const floorCount = building.floors + (building.basements ?? 0);
    if (!Number.isSafeInteger(floorCount) || floorCount < 1) return false;
    const plans = this.plans(building, Array.from({ length: floorCount }, (_, floor) => floor - (building.basements ?? 0)));
    if (plans.length !== floorCount) return false;
    const include = (rect: Rect) => {
      bounds.x0 = Math.min(bounds.x0, rect.x0); bounds.x1 = Math.max(bounds.x1, rect.x1);
      bounds.z0 = Math.min(bounds.z0, rect.z0); bounds.z1 = Math.max(bounds.z1, rect.z1);
    };
    for (const plan of plans) {
      include(plan.broadphase);
      include(plan.stairLanding);
      for (const rect of [...plan.interior, ...plan.circulation, ...plan.courtyard]) include(rect);
      for (const surface of [...plan.stairTreads, ...plan.stairLandings, ...plan.fixtures]) include(surface.rect);
      for (const wall of plan.walls) include({ x0: Math.min(wall.a[0], wall.b[0]) - wall.thickness / 2, x1: Math.max(wall.a[0], wall.b[0]) + wall.thickness / 2,
        z0: Math.min(wall.a[1], wall.b[1]) - wall.thickness / 2, z1: Math.max(wall.a[1], wall.b[1]) + wall.thickness / 2 });
    }
    if (![bounds.x0, bounds.x1, bounds.z0, bounds.z1].every(Number.isFinite)) return false;
    const local = buildingLocalPosition(building, body);
    // Include the whole body's radius and all derived walls, stair faces and overhangs.
    // An indoor origin or a detached real mid-riser phase cannot use this path.
    if (!(local.x < bounds.x0 - BODY_RADIUS - EPS || local.x > bounds.x1 + BODY_RADIUS + EPS || local.z < bounds.z0 - BODY_RADIUS - EPS || local.z > bounds.z1 + BODY_RADIUS + EPS)) return false;
    return !!plans.length && !this.support(building, body) && plans.every(plan => !blocksFloorPlanMovement(building, plan.floor, body, body, BODY_RADIUS, EYE_HEIGHT));
  }

  private leg(route: Vec3[], cursor: NpcStairCursor): NpcStairLeg {
    const description = this.describe(route, cursor.routeIndex);
    if (description.kind !== 'physical') throw new Error('unavailable physical stair leg');
    return description.leg;
  }

  private cursorPosition(leg: NpcStairLeg, cursor: NpcStairCursor): Vec3 {
    if (cursor.piece === leg.parts.length) return { ...leg.to };
    const part = leg.parts[cursor.piece]; if (!part) throw new Error('invalid physical stair piece');
    return interpolate(part.from, part.to, cursor.offset / part.length);
  }

  private validateAgainst(leg: NpcStairLeg, value: unknown, body: Vec3): asserts value is NpcStairCursor {
    const keys = ['version', 'buildingId', 'routeIndex', 'piece', 'offset', 'from', 'to'];
    if (!plain(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('invalid physical stair cursor shape');
    const cursor = value as NpcStairCursor;
    if (cursor.version !== 1 || cursor.buildingId !== leg.building.id || cursor.routeIndex !== leg.routeIndex || !Number.isSafeInteger(cursor.piece) || cursor.piece < 0 || cursor.piece > leg.parts.length
      || !Number.isFinite(cursor.offset) || cursor.offset < 0 || !strictPoint(cursor.from) || !strictPoint(cursor.to) || !samePoint(cursor.from, leg.referenceFrom) || !samePoint(cursor.to, leg.referenceTo) || !finitePoint(body)) throw new Error('invalid physical stair cursor identity');
    const part = leg.parts[cursor.piece];
    // Exhausting a part always advances its piece. A second representation at
    // offset==length would permit a forged unfinished/completed phase pair.
    if (part ? cursor.offset >= part.length : cursor.offset !== 0) throw new Error('invalid physical stair offset');
    if (!samePoint(body, this.cursorPosition(leg, cursor)) || !this.pose(leg, part, body)) throw new Error('invalid physical stair body or phase');
  }

  position(route: Vec3[], cursor: NpcStairCursor): Vec3 {
    const leg = this.leg(route, cursor), result = this.cursorPosition(leg, cursor);
    this.validateAgainst(leg, cursor, result); return result;
  }

  validate(route: Vec3[], cursor: NpcStairCursor, body: Vec3): void { this.validateAgainst(this.leg(route, cursor), cursor, body); }

  advance(route: Vec3[], cursor: NpcStairCursor, budget: number, callback: (from: Vec3, to: Vec3, building: Building, floor: number) => boolean): NpcStairAdvance {
    if (!Number.isFinite(budget) || budget < 0) throw new Error('invalid physical stair metre budget');
    const leg = this.leg(route, cursor), initial = this.cursorPosition(leg, cursor); this.validateAgainst(leg, cursor, initial);
    let position = initial, usedDistance = 0, remaining = budget;
    if (cursor.piece === leg.parts.length) {
      const support = this.pose(leg, undefined, position)!;
      const allowed = callback(position, position, leg.building, support.floor);
      return { position, usedDistance, finishedLeg: allowed, blocked: !allowed };
    }
    while (remaining > 0 && cursor.piece < leg.parts.length) {
      const part = leg.parts[cursor.piece], outstanding = part.length - cursor.offset, increment = Math.min(remaining, outstanding, this.step()), atEnd = increment === outstanding;
      const offset = atEnd ? part.length : cursor.offset + increment, proposed = atEnd ? { ...part.to } : interpolate(part.from, part.to, offset / part.length), support = this.pose(leg, part, proposed);
      if (!support || !callback(position, proposed, leg.building, support.floor) || blocksFloorPlanMovement(leg.building, support.floor, position, proposed, BODY_RADIUS, EYE_HEIGHT)) return { position, usedDistance, finishedLeg: false, blocked: true };
      cursor.offset = offset; position = proposed; usedDistance += increment; remaining -= increment;
      if (atEnd) { cursor.piece++; cursor.offset = 0; }
    }
    return { position, usedDistance, finishedLeg: cursor.piece === leg.parts.length, blocked: false };
  }

  remaining(route: Vec3[], index: number, body: Vec3, cursor?: NpcStairCursor): number {
    if (!Array.isArray(route) || !Number.isSafeInteger(index) || index < 0 || index > route.length || !finitePoint(body)) return Infinity;
    if (cursor && (index >= route.length || cursor.routeIndex !== index)) throw new Error('orphan physical stair cursor');
    let total = 0, previous = { ...body };
    for (let i = index; i < route.length; i++) {
      if (!finitePoint(route[i])) return Infinity;
      const description = this.describe(route, i);
      if (description.kind === 'blocked') return Infinity;
      if (description.kind === 'legacy') { if (cursor && i === index) throw new Error('physical cursor attached to legacy leg'); total += distance(previous, route[i]); previous = route[i]; continue; }
      const leg = description.leg;
      if (cursor && i === index) {
        this.validateAgainst(leg, cursor, previous);
        for (let piece = cursor.piece; piece < leg.parts.length; piece++) total += leg.parts[piece].length - (piece === cursor.piece ? cursor.offset : 0);
      } else {
        if (distance(previous, leg.from) > EPS) return Infinity;
        total += leg.length;
      }
      previous = leg.to;
    }
    return total;
  }
}
