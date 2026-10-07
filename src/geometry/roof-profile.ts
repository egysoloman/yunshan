/** Pure roof geometry for an explicitly declared Building.roofGeometryRevision
 * === 2 in the explicit current-v8 recipe. Importing this module activates
 * nothing: the owner must preserve every old recipe, descriptor, profile,
 * fingerprint and save path when that declaration is absent.
 *
 * A renderer must use these exact knots as its piecewise-linear upper surface;
 * support/collision must use the functions below, with the same bottom/top.
 * There is no smooth interpolation, vertex displacement or extrapolated eave.
 * The bottom is the existing flat bottom, and the whole solid stays inside the
 * original rectangle and declared revision-two vertical envelope. That new
 * envelope may use roofProfileRise; it is not the historical 1.2m envelope.
 * Axis, courtyard holes, floor, permission and use-point authority remain with
 * the original RoofRegion.
 */
export const CURVED_ROOF_PROFILE_REVISION = 2 as const;
export const CURVED_ROOF_PROFILE_VERSION = 'curved-eave-piecewise-v2' as const;
export const CURVED_ROOF_MIN_RISE = 1.6;
export const CURVED_ROOF_MAX_RISE = 4.8;
export const CURVED_ROOF_SPAN_RISE_RATIO = .16;

/** Explicit revision-two ridge rise, in .2m increments. Only the new recipe
 * may call this: its owner preserves the original bottom and binds the new
 * top=quantize(ceiling+rise), these constants and the knots into its descriptor.
 * Historical 1.2m gables must not be recalculated through this helper.
 */
export function roofProfileRise(span: number): number {
  if (!Number.isFinite(span) || span <= 0) throw new RangeError('Curved roof span must be finite and positive.');
  const rise = Math.max(CURVED_ROOF_MIN_RISE, Math.min(CURVED_ROOF_MAX_RISE, span * CURVED_ROOF_SPAN_RISE_RATIO));
  return Math.round(rise * 5) / 5;
}

/** Normalized span and height, both in [0, 1]. A raised outer edge falls into a
 * shallow eave before climbing to the central ridge. These are geometry cuts,
 * not additional .2m world voxels; the descriptor binds their exact values.
 * The nested arrays are frozen so a consumer cannot mutate physical authority.
 */
export type RoofProfileKnot = readonly [u: number, height: number];
export const CURVED_ROOF_PROFILE_KNOTS: readonly RoofProfileKnot[] = Object.freeze([
  Object.freeze([0, .4] as const),
  Object.freeze([.08, .3] as const),
  Object.freeze([.2, .46] as const),
  Object.freeze([.35, .78] as const),
  Object.freeze([.5, 1] as const),
  Object.freeze([.65, .78] as const),
  Object.freeze([.8, .46] as const),
  Object.freeze([.92, .3] as const),
  Object.freeze([1, .4] as const),
]);

function requireEnvelope(bottom: number, top: number): number {
  const height = top - bottom;
  if (!Number.isFinite(bottom) || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) {
    throw new RangeError('Curved roof requires a finite, positive vertical envelope.');
  }
  return height;
}

function requireUnit(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Curved roof ${name} must be finite and within [0, 1].`);
  }
}

function normalizedTopAt(u: number): number {
  for (let i = 1; i < CURVED_ROOF_PROFILE_KNOTS.length; i++) {
    const [leftU, leftHeight] = CURVED_ROOF_PROFILE_KNOTS[i - 1];
    const [rightU, rightHeight] = CURVED_ROOF_PROFILE_KNOTS[i];
    if (u <= rightU) {
      if (u === leftU) return leftHeight;
      if (u === rightU) return rightHeight;
      const fraction = (u - leftU) / (rightU - leftU);
      return leftHeight + (rightHeight - leftHeight) * fraction;
    }
  }
  return CURVED_ROOF_PROFILE_KNOTS[CURVED_ROOF_PROFILE_KNOTS.length - 1][1];
}

/** Evaluate the same upper polyline as the mesh, without allocating geometry.
 * u=0/1 are the existing rectangle edges. Invalid/outside u is rejected rather
 * than clamped into a fictitious extension. bottom/top are local metres; this
 * function neither quantizes them nor changes their declared envelope.
 */
export function roofProfileTopAt(u: number, bottom: number, top: number): number {
  requireUnit(u, 'coordinate');
  const height = requireEnvelope(bottom, top);
  const normalized = normalizedTopAt(u);
  return normalized === 1 ? top : bottom + height * normalized;
}

/** Exact maximum over a closed normalized interval. A piecewise-linear maximum
 * occurs at an endpoint or an enclosed knot. Checking the ridge alone would
 * miss the raised outer eave on a small circle near the rectangle boundary.
 */
export function roofProfileMaxOnInterval(fromU: number, toU: number, bottom: number, top: number): number {
  requireUnit(fromU, 'interval start');
  requireUnit(toU, 'interval end');
  if (fromU > toU) throw new RangeError('Curved roof interval must be ordered.');
  const height = requireEnvelope(bottom, top);
  let highest = Math.max(normalizedTopAt(fromU), normalizedTopAt(toU));
  for (const [u, value] of CURVED_ROOF_PROFILE_KNOTS) {
    if (u >= fromU && u <= toU) highest = Math.max(highest, value);
  }
  return highest === 1 ? top : bottom + height * highest;
}

export interface RoofProfileCircleQuery {
  /** Circle centre in building-local metres, mapped through the gable axis. */
  cross: number;
  orth: number;
  /** Nonnegative physical upright-cylinder footprint radius, in metres. */
  radius: number;
  /** Existing rectangle bounds; cross is x for axis x, z for axis z. */
  crossMin: number;
  crossMax: number;
  orthMin: number;
  orthMax: number;
  /** Selected revision-two RoofRegion envelope, in building-local metres. */
  bottom: number;
  top: number;
}

/** Exact upper height of this extruded polyline intersected by a circular
 * footprint. null means no contact with the existing closed rectangle.
 *
 * Projecting the orthogonal strip into the disk gives the allowed cross-axis
 * interval. Its piecewise maximum is exact for these knots, not a sampling
 * approximation. A radius-zero query is a point; tangency is included.
 *
 * This query does not decide a support/permission policy. The caller retains
 * its original centre-containment, reference-height, floor and body checks.
 * It introduces no epsilon that can extend the rectangle or seal a courtyard.
 */
export function roofProfileCircleMax(query: RoofProfileCircleQuery): number | null {
  const { cross, orth, radius, crossMin, crossMax, orthMin, orthMax, bottom, top } = query;
  if (![cross, orth, radius, crossMin, crossMax, orthMin, orthMax].every(Number.isFinite) || radius < 0) {
    throw new RangeError('Curved roof circle requires finite coordinates and a nonnegative radius.');
  }
  const crossSpan = crossMax - crossMin, orthSpan = orthMax - orthMin;
  if (!Number.isFinite(crossSpan) || !Number.isFinite(orthSpan) || crossSpan <= 0 || orthSpan <= 0) {
    throw new RangeError('Curved roof requires a finite, positive rectangle.');
  }
  requireEnvelope(bottom, top);

  const orthDistance = Math.max(orthMin - orth, 0, orth - orthMax);
  if (orthDistance > radius) return null;
  // The ratio form avoids overflowing radius*radius for finite large inputs.
  const reach = radius === 0 ? 0 : radius * Math.sqrt(Math.max(0, 1 - (orthDistance / radius) ** 2));
  const low = Math.max(crossMin, cross - reach), high = Math.min(crossMax, cross + reach);
  if (low > high) return null;
  // Clipping has already proved geometric containment. Clamp only the final
  // normalized division against floating-point endpoint rounding; no physical
  // coordinate, radius or bound is expanded here.
  const fromU = Math.max(0, Math.min(1, (low - crossMin) / crossSpan));
  const toU = Math.max(0, Math.min(1, (high - crossMin) / crossSpan));
  return roofProfileMaxOnInterval(fromU, toU, bottom, top);
}

export interface RoofProfileSweepQuery {
  from: { cross: number; orth: number; feet: number };
  to: { cross: number; orth: number; feet: number };
  radius: number; eyeHeight: number;
  crossMin: number; crossMax: number; orthMin: number; orthMax: number;
  bottom: number; top: number;
}
type TimeRange = readonly [number, number];

/** Clip a time interval against a strict linear vertical overlap. Equality at
 * a clipped end is checked separately when contact exists at just that time. */
function positiveTimes(range: TimeRange, start: number, change: number, margin: number): TimeRange | null {
  if (change === 0) return start > margin ? range : null;
  const boundary = (margin - start) / change;
  const low = change > 0 ? Math.max(range[0], boundary) : range[0];
  const high = change < 0 ? Math.min(range[1], boundary) : range[1];
  return low <= high ? [low, high] : null;
}

/** On a rectangle-distance cell each nonnegative gap is affine. Its squared
 * distance is one convex quadratic, so the entire disk-contact interval is
 * found from its projection and roots, without sampling a movement frame. */
function diskContactTimes(range: TimeRange, crossGap: number, crossChange: number, orthGap: number, orthChange: number, radius: number): TimeRange | null {
  const low = range[0], duration = range[1] - low;
  const x = crossGap + crossChange * low, z = orthGap + orthChange * low;
  const speedSquared = crossChange * crossChange + orthChange * orthChange;
  if (speedSquared === 0) return x * x + z * z <= radius * radius ? range : null;
  const projection = -(x * crossChange + z * orthChange) / speedSquared;
  const nearestX = x + crossChange * projection, nearestZ = z + orthChange * projection;
  const remainder = radius * radius - nearestX * nearestX - nearestZ * nearestZ;
  if (remainder < 0) return null;
  const reach = Math.sqrt(remainder / speedSquared);
  const entry = Math.max(0, projection - reach), exit = Math.min(duration, projection + reach);
  return entry <= exit ? [low + entry, low + exit] : null;
}

/** A linear term plus a circular reach is concave on one orthogonal distance
 * cell. Its maximum is at an endpoint or its single analytic stationary point.
 * This is essential at a raised eave: a narrow contact between two .1m samples
 * can have a higher roof top than both sampled endpoints. */
function maximumHeightGap(range: TimeRange, constant: number, change: number, slopeMagnitude: number, orthGap: number, orthChange: number, radius: number): number {
  const at = (time: number) => {
    const d = orthGap + orthChange * time;
    return constant + change * time + slopeMagnitude * Math.sqrt(Math.max(0, radius * radius - d * d));
  };
  let maximum = Math.max(at(range[0]), at(range[1]));
  if (slopeMagnitude > 0 && orthChange !== 0 && change * orthChange >= 0) {
    const divisor = Math.hypot(change, slopeMagnitude * orthChange);
    const stationaryDistance = divisor === 0 ? 0 : radius * Math.abs(change) / divisor;
    const time = (stationaryDistance - orthGap) / orthChange;
    if (time >= range[0] && time <= range[1]) maximum = Math.max(maximum, at(time));
  }
  return maximum;
}

/** Continuous upright-cylinder collision with exactly the same eight closed
 * profile prisms as the mesh. For each profile segment, its highest touched
 * point is min(high segment end, affine centre height + |slope|*circle reach).
 * Rectangle-distance cells give exact disk contact intervals; linear vertical
 * clipping and the analytic reach maximum then decide whether any time blocks.
 * No movement-time samples, extra roof footprint or interpolated smooth curve
 * are introduced. Historical revisions never call this function. */
export function roofProfileBlocksSweep(query: RoofProfileSweepQuery, margin = 1e-7): boolean {
  const { from, to, radius, eyeHeight, crossMin, crossMax, orthMin, orthMax, bottom, top } = query;
  if (![from.cross, from.orth, from.feet, to.cross, to.orth, to.feet, radius, eyeHeight, crossMin, crossMax, orthMin, orthMax, margin].every(Number.isFinite)
    || radius < 0 || eyeHeight <= 0 || margin < 0 || crossMax <= crossMin || orthMax <= orthMin) throw new RangeError('Invalid curved roof sweep.');
  const height = requireEnvelope(bottom, top), width = crossMax - crossMin;
  const dx = to.cross - from.cross, dz = to.orth - from.orth, dy = to.feet - from.feet;
  if (![width, orthMax - orthMin, dx, dz, dy].every(Number.isFinite)) throw new RangeError('Curved roof sweep differences must be finite.');
  const headStart = from.feet + eyeHeight - bottom;
  for (let segment = 1; segment < CURVED_ROOF_PROFILE_KNOTS.length; segment++) {
    const [u0, h0] = CURVED_ROOF_PROFILE_KNOTS[segment - 1], [u1, h1] = CURVED_ROOF_PROFILE_KNOTS[segment];
    const left = crossMin + u0 * width, right = crossMin + u1 * width;
    const lowHeight = bottom + h0 * height, highHeight = bottom + h1 * height;
    const slope = (highHeight - lowHeight) / (right - left), maximumEnd = Math.max(lowHeight, highHeight);
    if (!Number.isFinite(slope) || right <= left) throw new RangeError('Curved roof sweep segment must have a finite slope.');
    const cuts = new Set([0, 1]);
    if (dx !== 0) for (const x of [left, right]) { const time = (x - from.cross) / dx; if (time > 0 && time < 1) cuts.add(time); }
    if (dz !== 0) for (const z of [orthMin, orthMax]) { const time = (z - from.orth) / dz; if (time > 0 && time < 1) cuts.add(time); }
    const times = [...cuts].sort((a, b) => a - b);
    for (let cell = 1; cell < times.length; cell++) {
      const mid = (times[cell - 1] + times[cell]) / 2, x = from.cross + dx * mid, z = from.orth + dz * mid;
      const crossGap = x < left ? left - from.cross : x > right ? from.cross - right : 0;
      const crossChange = x < left ? -dx : x > right ? dx : 0;
      const orthGap = z < orthMin ? orthMin - from.orth : z > orthMax ? from.orth - orthMax : 0;
      const orthChange = z < orthMin ? -dz : z > orthMax ? dz : 0;
      let interval = diskContactTimes([times[cell - 1], times[cell]], crossGap, crossChange, orthGap, orthChange, radius);
      if (interval) interval = positiveTimes(interval, headStart, dy, margin);
      if (interval) interval = positiveTimes(interval, maximumEnd - from.feet, -dy, margin);
      if (!interval) continue;
      const constant = lowHeight + slope * (from.cross - left) - from.feet;
      const gap = maximumHeightGap(interval, constant, slope * dx - dy, Math.abs(slope), orthGap, orthChange, radius);
      if (gap <= margin) continue;
      if (interval[0] < interval[1]) return true;
      const time = interval[0];
      if (headStart + dy * time > margin && maximumEnd - from.feet - dy * time > margin) return true;
    }
  }
  return false;
}
