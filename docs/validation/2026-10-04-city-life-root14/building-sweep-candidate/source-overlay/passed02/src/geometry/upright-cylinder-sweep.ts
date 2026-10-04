import type { Vec3 } from '../types';

export const UPRIGHT_CYLINDER_SWEEP_VERSION = 'upright-cylinder-sweep-v1' as const;
export interface UprightCylinderBox { x0: number; x1: number; z0: number; z1: number; bottom: number; top: number }
export interface UprightCylinderSweepEvidence {
  blocked: boolean;
  verticalInterval: { from: number; to: number } | null;
  minimumXZDistanceSquared: number | null;
}
const DISTANCE_SQUARED_EPSILON = 1e-7;
const finite = (v: number) => Number.isFinite(v);
const pointRectDistanceSquared = (x: number, z: number, box: UprightCylinderBox) =>
  Math.max(box.x0-x, 0, x-box.x1) ** 2 + Math.max(box.z0-z, 0, z-box.z1) ** 2;
function pointSegmentDistanceSquared(x: number, z: number, a: Vec3, b: Vec3): number {
  const dx=b.x-a.x, dz=b.z-a.z, squared=dx*dx+dz*dz;
  const t=squared===0?0:Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/squared));
  return (x-a.x-dx*t)**2+(z-a.z-dz*t)**2;
}
function segmentIntersectsRect(a: Vec3, b: Vec3, box: UprightCylinderBox): boolean {
  let lo=0, hi=1;
  for(const [start,change,min,max] of [[a.x,b.x-a.x,box.x0,box.x1],[a.z,b.z-a.z,box.z0,box.z1]]) {
    if(change===0) { if(start<min || start>max) return false; continue; }
    const u=(min-start)/change, v=(max-start)/change;
    lo=Math.max(lo,Math.min(u,v)); hi=Math.min(hi,Math.max(u,v));
    if(lo>hi) return false;
  }
  return true;
}
const interpolate=(a: Vec3,b: Vec3,t: number): Vec3 => t===0?{...a}:t===1?{...b}:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};

/** A fixed upright circular body translated linearly against one axis-aligned
 * box in the same coordinate frame. Buildings may transform points by fixed
 * yaw first; pitched/rolling boxes require another geometry contract.
 *
 * Vertical contact is strict: mere floor/ceiling touching does not overlap.
 * footAllowance is an explicit consumer policy (0 for the real cylinder;
 * callers may choose the old .01 wall or .22 step allowance). No time or
 * speed changes, height projection, sampling, global endpoint height, caches,
 * mutation, or world/simulation construction is involved.
 *
 * XZ uses the existing body-distance contract distance² < radius² - 1e-7.
 * Radius must exceed sqrt(1e-7); this helper is for positive physical bodies.
 * That distance tolerance is separate from vertical contact and never expands
 * or merges a vertical interval.
 */
export function sweptUprightCylinderBoxEvidence(from: Vec3,to: Vec3,box: UprightCylinderBox,radius=.35,height=1.72,footAllowance=0): UprightCylinderSweepEvidence {
  if(![from.x,from.y,from.z,to.x,to.y,to.z,box.x0,box.x1,box.z0,box.z1,box.bottom,box.top,radius,height,footAllowance].every(finite)
    || box.x0>box.x1 || box.z0>box.z1 || box.bottom>=box.top || !finite(radius*radius) || radius*radius<=DISTANCE_SQUARED_EPSILON || radius<=0 || height<=0 || footAllowance<0
    || !finite((to.x-from.x)**2+(to.z-from.z)**2) || !finite(to.y-from.y))
    throw new RangeError('Invalid upright cylinder or box geometry.');
  const lower=box.bottom-height, upper=box.top-footAllowance;
  if(lower>=upper) return {blocked:false,verticalInterval:null,minimumXZDistanceSquared:null};
  const dy=to.y-from.y;
  let lo=0, hi=1;
  if(dy===0) {
    if(!(from.y>lower && from.y<upper)) return {blocked:false,verticalInterval:null,minimumXZDistanceSquared:null};
  } else {
    const u=(lower-from.y)/dy, v=(upper-from.y)/dy;
    lo=Math.max(0,Math.min(u,v)); hi=Math.min(1,Math.max(u,v));
    // The vertical band's endpoints are open. A singleton has no overlap;
    // otherwise continuity plus the strict distance comparison makes testing
    // the interval closure equivalent to existence inside the open band.
    if(!(lo<hi)) return {blocked:false,verticalInterval:null,minimumXZDistanceSquared:null};
  }
  const a=interpolate(from,to,lo), b=interpolate(from,to,hi);
  let minimum=0;
  if(!segmentIntersectsRect(a,b,box)) {
    minimum=Math.min(pointRectDistanceSquared(a.x,a.z,box),pointRectDistanceSquared(b.x,b.z,box));
    for(const [x,z] of [[box.x0,box.z0],[box.x0,box.z1],[box.x1,box.z0],[box.x1,box.z1]])
      minimum=Math.min(minimum,pointSegmentDistanceSquared(x,z,a,b));
  }
  return {blocked:minimum<radius*radius-DISTANCE_SQUARED_EPSILON,verticalInterval:{from:lo,to:hi},minimumXZDistanceSquared:minimum};
}

export function blocksSweptUprightCylinder(from: Vec3,to: Vec3,box: UprightCylinderBox,radius=.35,height=1.72,footAllowance=0): boolean {
  return sweptUprightCylinderBoxEvidence(from,to,box,radius,height,footAllowance).blocked;
}
