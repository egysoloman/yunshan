import type { Building, BuildingFunctionPoint, Vec3 } from './types';
import { blocksSweptUprightCylinder } from './geometry/upright-cylinder-sweep';


export const FLOOR_PLAN_GEOMETRY_VERSION = 'architecture-v4-program-bodies-02-stairs-v1';
export type Family = 'home' | 'market' | 'workshop' | 'civic-academy' | 'finance-health' | 'transport-waterfront';
export const FLOOR_PLAN_PROFILE = 'v4-program-bodies-02' as const;
/** Explicit trusted-recipe input. Undefined keeps the original v4 descriptor. */
export const CONTINUOUS_STAIR_GEOMETRY_REVISION = 2 as const;
type StairBuilding = Building & { stairGeometryRevision?: typeof CONTINUOUS_STAIR_GEOMETRY_REVISION };
const continuousStairs = (b: Building) => (b as StairBuilding).stairGeometryRevision === CONTINUOUS_STAIR_GEOMETRY_REVISION;
export type Candidate = 'v4-wings' | 'v6-commercial';
export type Material = 'stone' | 'plaster' | 'timber' | 'tile' | 'glass';
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Wall { a: [number, number]; b: [number, number]; thickness: number; height: number; opening?: { from: number; to: number; height: number; use: 'entrance' | 'courtyard' }; windows?: { from: number; to: number; bottom: number; top: number }[] }
export interface FloorFixture { id:string; kind:'table'|'bed'|'shelf'|'counter'; rect:Rect; bottom:number; top:number }
export interface StairSurface { id:string; rect:Rect; bottom:number; top:number; fromFloor:number;toFloor:number;kind:'tread'|'landing' }
export interface FloorPlan {
  floor: number; y: number; ceilingY: number; broadphase: Rect;
  interior: Rect[]; circulation: Rect[]; courtyard: Rect[]; stairHole: Rect | null; stairLanding: Rect;
  fixtures:FloorFixture[]; stairTreads:StairSurface[]; stairLandings:StairSurface[]; walls: Wall[]; stair: { x: number; z: number }; usePoint: { x: number; z: number };
  usePoints: { id: string; x: number; z: number }[];
  program: string; permission: string;
}
export interface BuildingBody {
  buildingId: string; family: Family; candidate: Candidate; needsV4: boolean;
  preserveExistingMesh: boolean;
  immutableDimensions: { width: number; depth: number; height: number; floors: number; basements: number; door: Vec3 };
  floorPlans: FloorPlan[]; roofRhythm: 'split-gable' | 'hall-and-shops' | 'industrial-spans' | 'court-wings' | 'hall-and-service-tower' | 'covered-platform' | 'terraced-finance-tower';
}
export interface MeshData { positions: number[]; indices: number[] }
export interface MeshPart { material: Material; floor: number; purpose: 'slab' | 'wall' | 'body' | 'roof'; mesh: MeshData; instance?: { rect: Rect; bottom: number; top: number; geometry?: { key: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[]; bytes: number } } }
function rawFloorDimensions(b: Building, floor: number) { return floor >= 0 ? b.floorFootprints?.[floor] ?? b : b; }
function rawStairPosition(b: Building, floor: number): Vec3 {
  const footprints = b.floorFootprints?.length ? b.floorFootprints : [b];
  const width = Math.min(b.width, ...footprints.map(p=>p.width)), depth = Math.min(b.depth,...footprints.map(p=>p.depth));
  return {x:b.position.x-width*.32,y:b.position.y+.6+floor*b.height/b.floors,z:b.position.z-depth*.25};
}
const q = (n: number) => Math.round(n * 5) / 5;
const eps = 1e-7;
const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: q(x0), x1: q(x1), z0: q(z0), z1: q(z1) });
export const contains = (r: Rect, x: number, z: number) => x >= r.x0 - eps && x <= r.x1 + eps && z >= r.z0 - eps && z <= r.z1 + eps;
export const containsUnion = (rs: readonly Rect[], x: number, z: number) => rs.some(r => contains(r, x, z));
export const familyOf = (b: Building): Family => b.kind === 'home' || b.kind === 'farm' ? 'home' : b.kind === 'market' ? 'market' : b.kind === 'workshop' ? 'workshop' : ['hall', 'school', 'police', 'core'].includes(b.kind) ? 'civic-academy' : b.kind === 'bank' || b.kind === 'clinic' ? 'finance-health' : 'transport-waterfront';

const originalArraySome=Array.prototype.some,originalArrayIterator=Array.prototype[Symbol.iterator];
/** Getters/custom iteration can change geometry during one query. Keep their
 * original repeated-read path; ordinary mutable data still gets a fresh grid. */
function plainRectangles(rs:readonly Rect[]):boolean {
  if(!Array.isArray(rs)||Object.getPrototypeOf(rs)!==Array.prototype||Object.hasOwn(rs,'some')||Object.hasOwn(rs,Symbol.iterator)||rs.some!==originalArraySome||rs[Symbol.iterator]!==originalArrayIterator)return false;
  for(let i=0;i<rs.length;i++){
    const member=Object.getOwnPropertyDescriptor(rs,i);if(!member||!('value' in member))return false;
    const r=member.value;
    for(const key of ['x0','x1','z0','z1']){const field=Object.getOwnPropertyDescriptor(r,key);if(!field||!('value' in field))return false;}
  }
  return true;
}

/** Rectilinear union boundary, with every intersection split before tracing.
 * This is shared by watertight mesh caps and the wall/collision contract. */
export function boundaryLoops(regions: readonly Rect[], holes: readonly Rect[] = []): [number, number][][] {
  for (const r of [...regions, ...holes]) if (![r.x0, r.x1, r.z0, r.z1].every(Number.isFinite) || r.x1 <= r.x0 || r.z1 <= r.z0) throw new Error('invalid region');
  // World dimensions retain their exact saved floating-point representation;
  // geometry cuts snap to the declared .2m lattice before partitioning. This
  // merges -10.6 and -10.600000000000001 rather than creating a sliver cell.
  const xs = [...new Set([...regions, ...holes].flatMap(r => [q(r.x0), q(r.x1)]))].sort((a, b) => a - b);
  const zs = [...new Set([...regions, ...holes].flatMap(r => [q(r.z0), q(r.z1)]))].sort((a, b) => a - b);
  const nx=xs.length-1,nz=zs.length-1;
  // Ordinary data descriptors keep the same values throughout this synchronous
  // boundary derivation. Evaluate each cell's union once rather
  // than re-reading every rectangle up to five times. Retain the original
  // path for unusually large grids so this optimization has bounded storage.
  const occupancy=nx*nz>=0&&nx*nz<=65536&&plainRectangles(regions)&&plainRectangles(holes)?new Uint8Array(nx*nz):null;
  if(occupancy)for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)occupancy[i*nz+j]=Number(containsUnion(regions,(xs[i]+xs[i+1])/2,(zs[j]+zs[j+1])/2)&&!containsUnion(holes,(xs[i]+xs[i+1])/2,(zs[j]+zs[j+1])/2));
  const occupied = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && (occupancy?occupancy[i*nz+j]===1:containsUnion(regions, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2) && !containsUnion(holes, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2));
  const edges = new Map<string, [number, number][]>();
  const add = (a: [number, number], b: [number, number]) => { const k = a.join(','); const list = edges.get(k) ?? []; list.push(b); edges.set(k, list); };
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) if (occupied(i, j)) {
    if (!occupied(i, j - 1)) add([xs[i], zs[j]], [xs[i + 1], zs[j]]);
    if (!occupied(i + 1, j)) add([xs[i + 1], zs[j]], [xs[i + 1], zs[j + 1]]);
    if (!occupied(i, j + 1)) add([xs[i + 1], zs[j + 1]], [xs[i], zs[j + 1]]);
    if (!occupied(i - 1, j)) add([xs[i], zs[j + 1]], [xs[i], zs[j]]);
  }
  const loops: [number, number][][] = [];
  while (edges.size) {
    const first = edges.keys().next().value!; let cursor = first; const loop: [number, number][] = [];
    do {
      const list = edges.get(cursor);
      if (!list || list.length !== 1) throw new Error(`ambiguous/disconnected boundary at ${cursor}`);
      loop.push(cursor.split(',').map(Number) as [number, number]);
      const next = list[0]; edges.delete(cursor); cursor = next.join(',');
    } while (cursor !== first);
    const corners = loop.filter((p, i) => { const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > eps; });
    if (corners.length < 4) throw new Error('degenerate polygon boundary');
    loops.push(corners);
  }
  return loops;
}
const area = (loop: readonly [number, number][]) => loop.reduce((sum, a, i) => { const b = loop[(i + 1) % loop.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

/** Disjoint rectangle cover of the identical occupied union, for the existing
 * instanced-box far renderer. It exchanges hidden internal faces for bounded
 * matrix/color buffers instead of a unique whole-building mesh per actor. */
export function rectangleCover(regions: readonly Rect[], holes: readonly Rect[] = []): Rect[] {
  const xs = [...new Set([...regions, ...holes].flatMap(r => [q(r.x0), q(r.x1)]))].sort((a, b) => a - b), zs = [...new Set([...regions, ...holes].flatMap(r => [q(r.z0), q(r.z1)]))].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1, filled = new Set<number>();
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) if (containsUnion(regions, (xs[x] + xs[x + 1]) / 2, (zs[z] + zs[z + 1]) / 2) && !containsUnion(holes, (xs[x] + xs[x + 1]) / 2, (zs[z] + zs[z + 1]) / 2)) filled.add(z * nx + x);
  const cover: Rect[] = [];
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) if (filled.has(z * nx + x)) {
    let endX = x + 1, endZ = z + 1;
    while (endX < nx && filled.has(z * nx + endX)) endX++;
    while (endZ < nz && Array.from({ length: endX - x }, (_, dx) => endZ * nx + x + dx).every(k => filled.has(k))) endZ++;
    for (let zz = z; zz < endZ; zz++) for (let xx = x; xx < endX; xx++) filled.delete(zz * nx + xx);
    cover.push(rect(xs[x], xs[endX], zs[z], zs[endZ]));
  }
  return cover;
}

function createFloorFixtures(b:Building,p:FloorPlan):FloorFixture[] {
  const fixtures:FloorFixture[]=[];
  const canPlace=(r:Rect)=> {
    for(const [x,z] of [[r.x0,r.z0],[r.x0,r.z1],[r.x1,r.z0],[r.x1,r.z1]])if(!containsUnion(p.interior,x,z)||!canStandInFloorPlan(p,x,z,.05))return false;
    if(containsUnion([p.stairLanding,...p.stairTreads.map(t=>t.rect),...p.stairLandings.map(t=>t.rect)],(r.x0+r.x1)/2,(r.z0+r.z1)/2))return false;
    if(p.usePoints.some(point=>circleRectDistanceSquared(point.x,point.z,r)<.8**2-eps))return false;
    return !fixtures.some(f=>r.x0<f.rect.x1+.4&&r.x1>f.rect.x0-.4&&r.z0<f.rect.z1+.4&&r.z1>f.rect.z0-.4);
  };
  for(const point of p.usePoints) {
    const width=b.kind==='market'?3.2:2.4,r=rect(point.x-width/2,point.x+width/2,point.z-2,point.z-.8);
    if(canPlace(r))fixtures.push({id:`${point.id}:${b.kind==='market'?'counter':'table'}`,kind:b.kind==='market'?'counter':'table',rect:r,bottom:0,top:b.kind==='market'?1:.8});
  }
  if(b.kind==='home') {
    for(const region of rectangleCover(p.interior)) {
      const r=rect(region.x0+.8,region.x0+3.2,region.z0+.8,region.z0+2);if(!canPlace(r))continue;
      fixtures.push({id:'home-bed',kind:'bed',rect:r,bottom:0,top:.6});break;
    }
  }return fixtures;
}
export function getFloorPlanFixtures(_b:Building,p:FloorPlan):readonly FloorFixture[]{return p.fixtures;}

function makeBody(b: Building): BuildingBody {
  const commercial = b.commercialGeometryRevision === 1;
  const candidate: Candidate = commercial ? 'v6-commercial' : 'v4-wings';
  const family = familyOf(b), plans: FloorPlan[] = [], floorHeight = b.height / b.floors;
  const keepEnvelope = false;
  for (let floor = -(b.basements ?? 0) || 0; floor < b.floors; floor++) {
    const dim = rawFloorDimensions(b, floor), w = dim.width, d = dim.depth, full = { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
    const originalStair = rawStairPosition(b, floor), stair = { x: originalStair.x - b.position.x, z: originalStair.z - b.position.z };
    const levels=Math.round(floorHeight/.2),longestRun=Math.max(Math.floor(levels/2),Math.ceil(levels/2))*.4;
    const stairHull = rect(stair.x-2.4,stair.x+2.4,stair.z-1.2,stair.z+.8+longestRun+2);
    let interior: Rect[];
    const norm = (x0: number, x1: number, z0: number, z1: number) => rect(w * x0, w * x1, d * z0, d * z1);
    const spine = norm(-.08, .08, -.42, floor === 0 ? .5 : .05);
    // Candidate 02 gives each programme a distinct occupied topology. All
    // rectangles are shared physical rooms, rather than drawn facade labels.
    if (commercial || keepEnvelope || floor < 0) interior = [full];
    else if (family === 'home') {
      interior = [norm(-.5, .02, -.5, .04), spine];
      if (floor < 2) interior.push(norm(.14, .46, -.34, .06), norm(-.06, .18, -.18, -.06));
      if (floor === 0) interior.push(norm(-.48, -.22, .18, .44), norm(-.32, -.20, .00, .20));
    } else if (family === 'market') {
      interior = [norm(-.5, .5, -.5, -.18), spine];
      if (floor === 0) interior.push(norm(-.5, -.20, .04, .34), norm(-.16, .16, .04, .34), norm(.20, .5, .04, .34));
    } else if (family === 'workshop') {
      interior = [norm(-.5, .5, -.5, floor === b.floors - 1 ? -.18 : .20), spine];
    } else if (family === 'civic-academy') {
      interior = [norm(-.5, floor < 2 ? .5 : .20, -.5, -.26), spine];
      if (floor < 2) interior.push(norm(-.5, -.32, -.28, .26), norm(.30, .5, -.28, .26));
      if (floor === 0) interior.push(norm(-.26, .26, .36, .5));
    } else if (family === 'finance-health' && b.kind === 'bank') {
      interior = floor < 2 ? [full] : [norm(-.5, .14, -.5, .18), spine];
    } else if (family === 'finance-health') {
      // H wards: a transverse clinical link joins two unequal ward wings.
      interior = [norm(-.5, -.26, -.5, .36), norm(-.28, .30, -.08, .08), spine];
      if (floor < Math.max(2, b.floors - 2)) interior.push(norm(.28, .5, -.40, .28));
    } else {
      // Actual open waiting floor + two low side canopies; upper floors live
      // in the fixed-shaft service wing rather than enclosing that open hall.
      interior = [norm(-.5, -.20, -.5, .02), ...(floor === 0 ? [spine] : [])];
      if (floor === 0) interior.push(norm(.26, .5, -.5, -.18));
    }
    // The fixed shaft stays at the exact legacy shared stair point; each level
    // retains a connected service spine. Dimensions/count/door never change.
    interior.push(stairHull);
    const galleries = family === 'market' ? [norm(-.5, .5, -.08, .04), norm(-.5, .5, .34, .46)]
      : family === 'home' ? [norm(-.20, .18, .02, .14)]
      : family === 'civic-academy' ? [norm(-.32, .30, .18, .30)]
      : family === 'finance-health' ? [norm(-.26, .28, .12, .22)]
      : family === 'transport-waterfront' ? [norm(-.20, .26, -.38, .30), norm(.26, .5, -.08, .28)]
      : [norm(-.46, .46, .22, .36)];
    const circulation: Rect[] = !keepEnvelope && floor === 0 ? rectangleCover(galleries, interior) : [];
    const courtyard = !keepEnvelope && floor === 0 ? rectangleCover([full], interior) : [];
    const height = q(floorHeight - .4), walls: Wall[] = boundaryLoops(interior).flatMap(loop => loop.map((a, i) => {
      const z = loop[(i + 1) % loop.length], length = Math.hypot(z[0] - a[0], z[1] - a[1]);
      const wall: Wall = { a, b: z, thickness: .4, height };
      const entrance = floor === 0 && Math.abs(a[1] - d / 2) < eps && Math.abs(z[1] - d / 2) < eps && Math.min(a[0], z[0]) < 0 && Math.max(a[0], z[0]) > 0;
      const courtyardDoor = floor === 0 && !keepEnvelope && !entrance && length >= 4 && Math.abs((a[0] + z[0]) / 2) < w * .48 && Math.abs((a[1] + z[1]) / 2) < d * .4;
      if (entrance || courtyardDoor) {
        const halfWidth = q(Math.min(entrance ? 2.4 : 1.6, (length - .8) / 2)), mid = entrance ? Math.abs(a[0]) : length / 2;
        wall.opening = { from: q(mid - halfWidth), to: q(mid + halfWidth), height: q(Math.min(2.8, height)), use: entrance ? 'entrance' : 'courtyard' };
      }
      wall.windows = [];
      for (let mid = 2.4; mid < length - 1.6; mid += 4.8) {
        const half = commercial ? 1.8 : .8, from=q(mid-half),to=q(mid+half);
        if (to > length-.6) continue;
        if (wall.opening && from < wall.opening.to+.6 && to > wall.opening.from-.6) continue;
        wall.windows.push({from,to,bottom:commercial ? .4 : .8,top:q(commercial ? height-.4 : Math.min(2.2,height-.4))});
      }
      return wall;
    }));
    const usePoint = family === 'home' && !keepEnvelope && floor >= 0 ? { x: q(-w * .20), z: q(-d * .26) }
      : family === 'finance-health' && b.kind !== 'bank' && !keepEnvelope && floor >= 0 ? { x: 0, z: 0 }
      : family === 'transport-waterfront' && !keepEnvelope && floor > 0 ? { x: q(-w * .40), z: q(-d * .08) }
      : { x: 0, z: q(-d * .34) };
    const usePoints = commercial && floor >= 2 ? [{ id: 'program', ...usePoint }, { id: 'office-west', x: q(-w*.18), z: q(d*.12) }, { id: 'office-east', x: q(w*.22), z: q(d*.12) }] : family === 'market' && floor === 0 && !keepEnvelope ? [{ id: 'sale-west', x: q(-w * .35), z: q(d * .18) }, { id: 'sale-center', x: 0, z: q(d * .18) }, { id: 'sale-east', x: q(w * .35), z: q(d * .18) }] : [{ id: 'program', ...usePoint }];
    plans.push({ floor, y: q(floor * floorHeight), ceilingY: q((floor + 1) * floorHeight), broadphase: full, interior, circulation, courtyard, fixtures:[],stairTreads:[],stairLandings:[],stairHole: floor > -(b.basements ?? 0) ? rect(stair.x-2,stair.x+2,stair.z+.8,stair.z+.8+longestRun+2) : null, stairLanding: rect(stair.x-1.8,stair.x+1.8,stair.z-.8,stair.z+.8), walls, stair, usePoint, usePoints, program: floor < 0 ? b.basementUses?.[-floor - 1] ?? '地下空间' : b.floorUses?.[floor] ?? b.kind, permission: floor < 0 ? 'original-canAccessFloor' : b.floorPermissions?.[floor] ?? (floor < (b.publicFloors ?? b.floors) ? 'public' : b.requiredPermission ?? 'public') });
  }
  for(let index=0;index<plans.length;index++) {
    const p=plans[index],next=plans[index+1];
    if(next) {
      const levels=Math.round((next.y-p.y)/.2),a=Math.floor(levels/2),z=levels-a,run=Math.max(a,z)*.4,start=p.stair.z+.8,offset=run-a*.4;
      const surface=(id:string,region:Rect,top:number,kind:StairSurface['kind']):StairSurface=>({id,rect:region,bottom:q(top-.2),top:q(top),fromFloor:p.floor,toFloor:next.floor,kind});
      if(continuousStairs(b)) {
        // Quantize the common origin once, then use integer voxel offsets.
        // Algebraically equal floating half-grid expressions otherwise round
        // opposite ways and leave a genuine .2m gap at the shared turn.
        const origin=Math.round(start*5),going=2,runTicks=Math.max(a,z)*going,offsetTicks=runTicks-a*going;
        const edge=(ticks:number)=>(origin+ticks)/5;
        if(offsetTicks>0)p.stairLandings.push(surface('lower-link',rect(p.stair.x-1.8,p.stair.x-.2,edge(0),edge(offsetTicks)),p.y,'landing'));
        for(let i=1;i<=a;i++)p.stairTreads.push(surface(`up-${i}`,rect(p.stair.x-1.8,p.stair.x-.2,edge(offsetTicks+(i-1)*going),edge(offsetTicks+i*going)),p.y+i*.2,'tread'));
        p.stairLandings.push(surface('half-turn',rect(p.stair.x-1.8,p.stair.x+1.8,edge(runTicks),edge(runTicks+8)),p.y+a*.2,'landing'));
        for(let i=1;i<=z;i++)p.stairTreads.push(surface(`return-${i}`,rect(p.stair.x+.2,p.stair.x+1.8,edge(runTicks-i*going),edge(runTicks-(i-1)*going)),p.y+(a+i)*.2,'tread'));
      } else {
        // Preserve old trusted v4 geometry and its complete save fingerprint.
        if(offset>.01)p.stairLandings.push(surface('lower-link',rect(p.stair.x-1.8,p.stair.x-.2,start,start+offset),p.y,'landing'));
        for(let i=1;i<=a;i++)p.stairTreads.push(surface(`up-${i}`,rect(p.stair.x-1.8,p.stair.x-.2,start+offset+(i-1)*.4,start+offset+i*.4),p.y+i*.2,'tread'));
        p.stairLandings.push(surface('half-turn',rect(p.stair.x-1.8,p.stair.x+1.8,start+run,start+run+1.6),p.y+a*.2,'landing'));
        for(let i=1;i<=z;i++)p.stairTreads.push(surface(`return-${i}`,rect(p.stair.x+.2,p.stair.x+1.8,start+run-i*.4,start+run-(i-1)*.4),p.y+(a+i)*.2,'tread'));
      }
    }
  }
  for(const p of plans)p.fixtures=createFloorFixtures(b,p);
  return { buildingId: b.id, family, candidate, needsV4: !keepEnvelope, preserveExistingMesh: keepEnvelope, immutableDimensions: { width: b.width, depth: b.depth, height: b.height, floors: b.floors, basements: b.basements ?? 0, door: { ...b.door } }, floorPlans: plans, roofRhythm: commercial ? 'terraced-finance-tower' : ({ home: 'split-gable', market: 'hall-and-shops', workshop: 'industrial-spans', 'civic-academy': 'court-wings', 'finance-health': 'hall-and-service-tower', 'transport-waterfront': 'covered-platform' })[family] as BuildingBody['roofRhythm'] };
}


export interface WallPanel { rect: Rect; bottom: number; top: number; kind: 'solid' | 'glass' }
export interface FloorSupport { kind: 'room' | 'courtyard' | 'gallery' | 'stairs' | 'roof'; floor: number; y: number; local: { x: number; z: number }; link?: {fromFloor:number;toFloor:number} }
export interface RoofRegion { rect: Rect; bottom: number; top: number; floor: number; kind: 'gallery-flat' | 'weather-strip' | 'gable'; gableAxis?: 'x' | 'z'; anchor: 'minimum' }
interface BodyCache {
  commercial: boolean;
  continuousStairs: boolean;
  width: number; depth: number; height: number; floors: number; basements: number; rotation: number;
  x: number; y: number; z: number; kind: Building['kind']; publicFloors: Building['publicFloors'];
  requiredPermission: Building['requiredPermission']; facility: Building['facility'];
  footprints: Building['floorFootprints']; uses: Building['floorUses']; permissions: Building['floorPermissions']; body: BuildingBody;
}
const bodies = new WeakMap<Building, BodyCache>();
// A fixed-geometry window (one simulation tick: no phase edits buildings or
// floor plans). Derived views validated once inside the window are trusted
// for its remainder; outside any window every read validates as before.
let fixedEpoch=0,fixedDepth=0;
export function withFixedFloorPlans<T>(run:()=>T):T{if(fixedDepth++===0)fixedEpoch++;try{return run();}finally{fixedDepth--;}}
const trustedBodies=new WeakMap<Building,number>(),trustedSolids=new WeakMap<FloorPlan,number>(),trustedNearby=new WeakMap<FloorPlan,number>(),trustedSurfaces=new WeakMap<FloorPlan,number>(),trustedFootprints=new WeakMap<FloorPlan,number>();
const trusted=<K extends object>(marks:WeakMap<K,number>,key:K)=>fixedDepth>0&&marks.get(key)===fixedEpoch;
const trust=<K extends object>(marks:WeakMap<K,number>,key:K)=>{if(fixedDepth>0)marks.set(key,fixedEpoch);};
export function getBuildingBody(b: Building): BuildingBody | null {
  if (b.floorPlanProfile !== FLOOR_PLAN_PROFILE || b.id === 'core-main' || b.kind === 'pavilion') return null;
  if(trusted(trustedBodies,b))return bodies.get(b)!.body;
  const body=validatedBuildingBody(b);trust(trustedBodies,b);return body;
}
function validatedBuildingBody(b: Building): BuildingBody {
  const cached=bodies.get(b);
  if(cached && cached.commercial===(b.commercialGeometryRevision===1) && cached.continuousStairs===continuousStairs(b) && cached.width===b.width && cached.depth===b.depth && cached.height===b.height && cached.floors===b.floors && cached.basements===(b.basements??0) && cached.rotation===b.rotation && cached.x===b.position.x && cached.y===b.position.y && cached.z===b.position.z && cached.kind===b.kind && cached.publicFloors===b.publicFloors && cached.requiredPermission===b.requiredPermission && cached.facility===b.facility && cached.footprints===b.floorFootprints && cached.uses===b.floorUses && cached.permissions===b.floorPermissions) return cached.body;
  const body=makeBody(b);
  bodies.set(b,{commercial:b.commercialGeometryRevision===1,continuousStairs:continuousStairs(b),width:b.width,depth:b.depth,height:b.height,floors:b.floors,basements:b.basements??0,rotation:b.rotation,x:b.position.x,y:b.position.y,z:b.position.z,kind:b.kind,publicFloors:b.publicFloors,requiredPermission:b.requiredPermission,facility:b.facility,footprints:b.floorFootprints,uses:b.floorUses,permissions:b.floorPermissions,body});
  return body;
}
export function getBuildingFloorPlan(b: Building,floor: number): FloorPlan | null {
  const body=getBuildingBody(b);if(!body)return null;
  const plans=body.floorPlans,length=plans.length;
  // Array.find visits sparse slots and captures the initial length. Keep both
  // contracts, including first-match order, without a new callback per query.
  for(let i=0;i<length;i++){const p=plans[i];if(p.floor===floor)return p;}
  return null;
}
/** Local y=0 is the ground floor's authoritative +.6m walking plane. */
export function buildingLocalPosition(b: Building,p: Vec3): Vec3 { const dx=p.x-b.position.x,dz=p.z-b.position.z,c=Math.cos(b.rotation),s=Math.sin(b.rotation); return {x:dx*c-dz*s,y:p.y-b.position.y-.6,z:dx*s+dz*c}; }
export function buildingWorldPosition(b: Building,p: Vec3): Vec3 { const c=Math.cos(b.rotation),s=Math.sin(b.rotation);return {x:b.position.x+p.x*c+p.z*s,y:b.position.y+.6+p.y,z:b.position.z-p.x*s+p.z*c}; }
export function getFloorPlanStairPosition(b: Building,floor: number): Vec3 { const p=getBuildingFloorPlan(b,floor);return p?buildingWorldPosition(b,{...p.stair,y:p.y}):rawStairPosition(b,floor); }
export function getBuildingEntrance(b: Building): Vec3 {
  const p=getBuildingFloorPlan(b,0),w=p?.walls.find(w=>w.opening?.use==='entrance'); if(!p || !w?.opening) return {...b.door};
  const length=Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1]),t=(w.opening.from+w.opening.to)/2;
  return buildingWorldPosition(b,{x:w.a[0]+(w.b[0]-w.a[0])*t/length,y:p.y,z:w.a[1]+(w.b[1]-w.a[1])*t/length});
}
export function getBuildingUsePoints(b: Building,floor: number): BuildingFunctionPoint[] {
  const p=getBuildingFloorPlan(b,floor); if(!p) return [];
  const purposes:BuildingFunctionPoint['purpose'][]=['work'];
  if(['home','school','hall','police','clinic','bank','station','airport','starport','dock','core','farm'].includes(b.kind))purposes.push('service');
  if(floor===0&&['market','workshop','farm','dock'].includes(b.kind))purposes.push('sale');
  return p.usePoints.flatMap(point=>purposes.map(purpose=>({id:`${floor}:${point.id}:${purpose}`,purpose,floor,position:buildingWorldPosition(b,{x:point.x,y:p.y,z:point.z})})));

}
export const getFloorPlanUsePoints=getBuildingUsePoints;
const panelCache=new WeakMap<FloorPlan,WallPanel[]>();
/** A real door is empty; windows are glass solids. Rendering/collision share cuts. */
export function wallPanels(p: FloorPlan): WallPanel[] {
  const cached=panelCache.get(p);if(cached)return cached;
  const panels:WallPanel[]=[];
  for(const w of p.walls) {
    const length=Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1]),dx=(w.b[0]-w.a[0])/length,dz=(w.b[1]-w.a[1])/length;
    const gaps=[...(w.opening?[{from:w.opening.from,to:w.opening.to,bottom:0,top:w.opening.height,kind:'door' as const}]:[]),...(w.windows??[]).map(o=>({...o,kind:'window' as const}))];
    const xs=[...new Set([0,length,...gaps.flatMap(o=>[o.from,o.to])])].sort((a,b)=>a-b),ys=[...new Set([0,w.height,...gaps.flatMap(o=>[o.bottom,o.top])])].sort((a,b)=>a-b);
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++) {
      const from=xs[i],to=xs[i+1],bottom=ys[j],top=ys[j+1]; if(to-from<eps || top-bottom<eps)continue;
      const gap=gaps.find(o=>(from+to)/2>o.from-eps&&(from+to)/2<o.to+eps&&(bottom+top)/2>o.bottom-eps&&(bottom+top)/2<o.top+eps);if(gap?.kind==='door')continue;
      const thickness=gap?.kind==='window'?.2:w.thickness;
      panels.push({rect:rect(Math.min(w.a[0]+dx*from,w.a[0]+dx*to)-(dz?thickness/2:0),Math.max(w.a[0]+dx*from,w.a[0]+dx*to)+(dz?thickness/2:0),Math.min(w.a[1]+dz*from,w.a[1]+dz*to)-(dx?thickness/2:0),Math.max(w.a[1]+dz*from,w.a[1]+dz*to)+(dx?thickness/2:0)),bottom,top,kind:gap?.kind==='window'?'glass':'solid'});
    }
  }
  panelCache.set(p,panels);return panels;
}
export const wallCollisionBoxes=wallPanels;
const supportCache=new WeakMap<FloorPlan,{regions:Rect[];boundaries:[number,number][][]}>();
export function getFloorPlanSlabRegions(p: FloorPlan): Rect[] {
  let cached=supportCache.get(p);if(cached)return cached.regions;
  const base=[...p.interior,...p.circulation,...p.courtyard],regions=p.stairHole?[...rectangleCover(base,[p.stairHole]),p.stairLanding]:base;
  cached={regions,boundaries:boundaryLoops(regions)};supportCache.set(p,cached);return regions;
}
function segmentDistanceSquared(x:number,z:number,a:readonly number[],b:readonly number[]) {
  const dx=b[0]-a[0],dz=b[1]-a[1],lengthSquared=dx*dx+dz*dz;
  // A stationary body has a point segment; dividing its projection by zero
  // would make the corner distance NaN and hide an existing radius overlap.
  if(lengthSquared===0)return (x-a[0])**2+(z-a[1])**2;
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/lengthSquared));
  return (x-a[0]-dx*t)**2+(z-a[1]-dz*t)**2;
}
function circleRectDistanceSquared(x:number,z:number,r:Rect) {return Math.max(r.x0-x,0,x-r.x1)**2+Math.max(r.z0-z,0,z-r.z1)**2;}
/** Per-window grid over a plan's slab boundary segments and body-height
 * blockers (walls, glass, fixtures). Rebuilt in every fixed-geometry window
 * and whenever the fixtures list itself is replaced or resized. */
interface StandIndex {epoch:number;fixtures:FloorFixture[];fixtureCount:number;x0:number;z0:number;nx:number;nz:number;segments:number[][];blockers:number[][];looseSegments:number[];looseBlockers:number[];ax:Float64Array;az:Float64Array;bx:Float64Array;bz:Float64Array;rects:{rect:Rect;bottom:number;top:number}[];stamp:Uint32Array;visit:number}
const STAND_CELL=2,standIndexes=new WeakMap<FloorPlan,StandIndex>();
function standIndex(p:FloorPlan):StandIndex {
  const cached=standIndexes.get(p),fixtures=p.fixtures;
  if(cached&&cached.epoch===fixedEpoch&&cached.fixtures===fixtures&&cached.fixtureCount===fixtures.length)return cached;
  getFloorPlanSlabRegions(p);
  const loops=supportCache.get(p)!.boundaries,ax:number[]=[],az:number[]=[],bx:number[]=[],bz:number[]=[];
  for(const loop of loops)for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];ax.push(a[0]);az.push(a[1]);bx.push(b[0]);bz.push(b[1]);}
  const rects:{rect:Rect;bottom:number;top:number}[]=[...wallPanels(p),...fixtures];
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  const finiteBox=(a:number,b:number,c:number,d:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Number.isFinite(c)&&Number.isFinite(d)&&a<=b&&c<=d;
  for(let i=0;i<ax.length;i++){const lx=Math.min(ax[i],bx[i]),hx=Math.max(ax[i],bx[i]),lz=Math.min(az[i],bz[i]),hz=Math.max(az[i],bz[i]);if(finiteBox(lx,hx,lz,hz)){x0=Math.min(x0,lx);x1=Math.max(x1,hx);z0=Math.min(z0,lz);z1=Math.max(z1,hz);}}
  for(const w of rects){const r=w.rect;if(finiteBox(r.x0,r.x1,r.z0,r.z1)){x0=Math.min(x0,r.x0);x1=Math.max(x1,r.x1);z0=Math.min(z0,r.z0);z1=Math.max(z1,r.z1);}}
  if(!(x1>=x0))x0=x1=z0=z1=0;
  const nx=Math.max(1,Math.floor((x1-x0)/STAND_CELL)+1),nz=Math.max(1,Math.floor((z1-z0)/STAND_CELL)+1);
  const segments:number[][]=Array.from({length:nx*nz},()=>[]),blockers:number[][]=Array.from({length:nx*nz},()=>[]),looseSegments:number[]=[],looseBlockers:number[]=[];
  const place=(cells:number[][],loose:number[],i:number,lx:number,hx:number,lz:number,hz:number)=>{
    if(!finiteBox(lx,hx,lz,hz)){loose.push(i);return;}
    for(let ix=Math.floor((lx-x0)/STAND_CELL);ix<=Math.floor((hx-x0)/STAND_CELL);ix++)for(let iz=Math.floor((lz-z0)/STAND_CELL);iz<=Math.floor((hz-z0)/STAND_CELL);iz++)cells[ix*nz+iz].push(i);
  };
  for(let i=0;i<ax.length;i++)place(segments,looseSegments,i,Math.min(ax[i],bx[i]),Math.max(ax[i],bx[i]),Math.min(az[i],bz[i]),Math.max(az[i],bz[i]));
  rects.forEach((w,i)=>{if(w.bottom<1.72&&w.top>.05)place(blockers,looseBlockers,i,w.rect.x0,w.rect.x1,w.rect.z0,w.rect.z1);else if(!(w.bottom>=1.72||w.top<=.05))looseBlockers.push(i);});
  const index:StandIndex={epoch:fixedEpoch,fixtures,fixtureCount:fixtures.length,x0,z0,nx,nz,segments,blockers,looseSegments,looseBlockers,ax:Float64Array.from(ax),az:Float64Array.from(az),bx:Float64Array.from(bx),bz:Float64Array.from(bz),rects,stamp:new Uint32Array(Math.max(ax.length,rects.length)),visit:0};
  standIndexes.set(p,index);return index;
}
function indexedCanStand(p:FloorPlan,x:number,z:number,radius:number):boolean {
  if(!containsUnion(getFloorPlanSlabRegions(p),x,z))return false;
  const index=standIndex(p),reach=Math.abs(radius)+eps+1e-9;
  if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(reach))return canStandScan(p,x,z,radius);
  const ix0=Math.max(0,Math.floor((x-reach-index.x0)/STAND_CELL)),ix1=Math.min(index.nx-1,Math.floor((x+reach-index.x0)/STAND_CELL)),iz0=Math.max(0,Math.floor((z-reach-index.z0)/STAND_CELL)),iz1=Math.min(index.nz-1,Math.floor((z+reach-index.z0)/STAND_CELL));
  if(radius>0){
    const limit=radius*radius-eps;
    for(const i of index.looseSegments)if(standSegmentHit(index,i,x,z,limit))return false;
    for(let ix=ix0;ix<=ix1;ix++)for(let iz=iz0;iz<=iz1;iz++)for(const i of index.segments[ix*index.nz+iz])if(standSegmentHit(index,i,x,z,limit))return false;
  }
  for(const i of index.looseBlockers)if(standBlocked(index.rects[i],x,z,radius))return false;
  for(let ix=ix0;ix<=ix1;ix++)for(let iz=iz0;iz<=iz1;iz++)for(const i of index.blockers[ix*index.nz+iz])if(standBlocked(index.rects[i],x,z,radius))return false;
  return true;
}
function standSegmentHit(index:StandIndex,i:number,x:number,z:number,limit:number):boolean {return segmentDistanceSquared(x,z,[index.ax[i],index.az[i]],[index.bx[i],index.bz[i]])<limit;}
function standBlocked(w:{rect:Rect;bottom:number;top:number},x:number,z:number,radius:number):boolean {return w.bottom<1.72&&w.top>.05&&(radius===0?contains(w.rect,x,z):circleRectDistanceSquared(x,z,w.rect)<radius*radius-eps);}
export function canStandInFloorPlan(p:FloorPlan,x:number,z:number,radius=.35):boolean {
  // In a fixed-geometry window only nearby boundaries and blockers can matter.
  return fixedDepth>0?indexedCanStand(p,x,z,radius):canStandScan(p,x,z,radius);
}
function canStandScan(p:FloorPlan,x:number,z:number,radius:number):boolean {
  if(!containsUnion(getFloorPlanSlabRegions(p),x,z))return false;
  if(radius>0)for(const loop of supportCache.get(p)!.boundaries)for(let i=0;i<loop.length;i++) if(segmentDistanceSquared(x,z,loop[i],loop[(i+1)%loop.length])<radius*radius-eps)return false;
  // Same members and order as the former spread+some, without a per-query array.
  const blocked=(w:{bottom:number;top:number;rect:Rect})=>w.bottom<1.72&&w.top>.05&&(radius===0?contains(w.rect,x,z):circleRectDistanceSquared(x,z,w.rect)<radius*radius-eps);
  const walls=wallPanels(p),fixtures=p.fixtures;
  for(const w of walls)if(blocked(w))return false;
  for(const w of fixtures)if(blocked(w))return false;
  return true;
}
// These lists are private derived views. FloorPlan and the existing wall/slab
// cache results stay public and mutable, so membership is checked on each read.
const nearbyCache=new WeakMap<FloorPlan,FloorPlan[]>();
function nearPlans(b:Building,p:FloorPlan):FloorPlan[] {
  if(trusted(trustedNearby,p))return nearbyCache.get(p)!;
  const result=validatedNearPlans(b,p);trust(trustedNearby,p);return result;
}
function validatedNearPlans(b:Building,p:FloorPlan):FloorPlan[] {
  const plans=getBuildingBody(b)!.floorPlans,cached=nearbyCache.get(p);let index=0,unchanged=!!cached;
  for(let i=0;i<plans.length;i++)if(i in plans){const f=plans[i];if(Math.abs(f.floor-p.floor)<=1){if(cached?.[index]!==f)unchanged=false;index++;}}
  if(unchanged&&index===cached!.length)return cached!;
  const result=plans.filter(f=>Math.abs(f.floor-p.floor)<=1);nearbyCache.set(p,result);return result;
}
const stairSurfaceCache=new WeakMap<FloorPlan,StairSurface[]>();
function stairSurfaces(b:Building,p:FloorPlan,plans=nearPlans(b,p)):StairSurface[]{
  if(trusted(trustedSurfaces,p))return stairSurfaceCache.get(p)!;
  const result=validatedStairSurfaces(p,plans);trust(trustedSurfaces,p);return result;
}
function validatedStairSurfaces(p:FloorPlan,plans:FloorPlan[]):StairSurface[]{
  const cached=stairSurfaceCache.get(p);let index=0,unchanged=!!cached;
  for(const f of plans){for(const s of f.stairTreads){if(cached?.[index]!==s)unchanged=false;index++;}for(const s of f.stairLandings){if(cached?.[index]!==s)unchanged=false;index++;}}
  if(unchanged&&index===cached!.length)return cached!;
  const result:StairSurface[]=[];for(const f of plans)result.push(...f.stairTreads,...f.stairLandings);stairSurfaceCache.set(p,result);return result;
}
interface LocalSolid {rect:Rect;bottom:number;top:number;steppable:boolean}
const localSolidCache=new WeakMap<FloorPlan,LocalSolid[]>();
function uncachedLocalSolids(b:Building,p:FloorPlan):LocalSolid[] {
  const result=nearPlans(b,p).flatMap(f=>[...wallPanels(f),...f.fixtures].map(s=>({rect:s.rect,bottom:f.y+s.bottom,top:f.y+s.top,steppable:false})));
  result.push(...stairSurfaces(b,p).map(s=>({...s,steppable:true})));
  for(const f of nearPlans(b,p))if(f.floor>p.floor)result.push(...getFloorPlanSlabRegions(f).map(rect=>({rect,bottom:f.y-.2,top:f.y,steppable:false})));
  return result;
}
function localSolids(b:Building,p:FloorPlan,plans=nearPlans(b,p),surfaces=stairSurfaces(b,p,plans)):LocalSolid[] {
  if(trusted(trustedSolids,p))return localSolidCache.get(p)!;
  const result=validatedLocalSolids(b,p,plans,surfaces);
  // A malformed descriptor took the uncached path; never trust that result.
  if(localSolidCache.get(p)===result)trust(trustedSolids,p);return result;
}
function validatedLocalSolids(b:Building,p:FloorPlan,plans:FloorPlan[],surfaces:StairSurface[]):LocalSolid[] {
  const cached=localSolidCache.get(p);let index=0,unchanged=!!cached;
  // Keep the public descriptors live on every read. These straight loops avoid
  // allocating and calling a validation closure for every wall/tread/fixture.
  for(const f of plans){
    for(const s of wallPanels(f)){
      const rect=s.rect,bottom=f.y+s.bottom,top=f.y+s.top,old=cached?.[index++];
      if(!old||old.rect!==rect||old.bottom!==bottom||old.top!==top||old.steppable!==false)unchanged=false;
    }
    for(const s of f.fixtures){
      const rect=s.rect,bottom=f.y+s.bottom,top=f.y+s.top,old=cached?.[index++];
      if(!old||old.rect!==rect||old.bottom!==bottom||old.top!==top||old.steppable!==false)unchanged=false;
    }
  }
  for(const s of surfaces){
    if(!s)return uncachedLocalSolids(b,p);
    const rect=s.rect,bottom=s.bottom,top=s.top,old=cached?.[index++];
    if(!old||old.rect!==rect||old.bottom!==bottom||old.top!==top||old.steppable!==true)unchanged=false;
  }
  // Read the existing slab cache rather than deriving a new slab lifetime.
  for(const f of plans)if(f.floor>p.floor){const regions=getFloorPlanSlabRegions(f);for(let i=0;i<regions.length;i++){
    if(!(i in regions))return uncachedLocalSolids(b,p);
    const rect=regions[i],bottom=f.y-.2,top=f.y,old=cached?.[index++];
    if(!old||old.rect!==rect||old.bottom!==bottom||old.top!==top||old.steppable!==false)unchanged=false;
  }}
  if(unchanged&&index===cached!.length)return cached!;
  const result:LocalSolid[]=[];
  for(const f of plans){for(const s of wallPanels(f))result.push({rect:s.rect,bottom:f.y+s.bottom,top:f.y+s.top,steppable:false});for(const s of f.fixtures)result.push({rect:s.rect,bottom:f.y+s.bottom,top:f.y+s.top,steppable:false});}
  for(const s of surfaces)result.push({rect:s.rect,bottom:s.bottom,top:s.top,steppable:true});
  for(const f of plans)if(f.floor>p.floor)for(const r of getFloorPlanSlabRegions(f))result.push({rect:r,bottom:f.y-.2,top:f.y,steppable:false});
  // A rect is shared, so nested coordinate edits remain live. Replacing it or
  // changing a copied height/member is detected by the checks above.
  localSolidCache.set(p,result);return result;
}
/** Uniform 2m grid over a trusted solids list (fixed-geometry window only).
 * A query returns every solid whose rectangle can meet the box, plus any
 * malformed rectangle; callers still apply their original exact predicate. */
interface SolidIndex {x0:number;z0:number;nx:number;nz:number;cells:number[][];loose:number[];stamp:Uint32Array;visit:number;found:Int32Array;count:number}
const SOLID_CELL=2,solidIndexes=new WeakMap<LocalSolid[],SolidIndex>();
const orderedRect=(r:Rect)=>Number.isFinite(r.x0)&&Number.isFinite(r.x1)&&Number.isFinite(r.z0)&&Number.isFinite(r.z1)&&r.x0<=r.x1&&r.z0<=r.z1;
function solidIndex(solids:LocalSolid[]):SolidIndex {
  let index=solidIndexes.get(solids);if(index)return index;
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(const s of solids)if(orderedRect(s.rect)){x0=Math.min(x0,s.rect.x0);x1=Math.max(x1,s.rect.x1);z0=Math.min(z0,s.rect.z0);z1=Math.max(z1,s.rect.z1);}
  if(!(x1>=x0))x0=x1=z0=z1=0;
  const nx=Math.max(1,Math.floor((x1-x0)/SOLID_CELL)+1),nz=Math.max(1,Math.floor((z1-z0)/SOLID_CELL)+1),cells:number[][]=Array.from({length:nx*nz},()=>[]),loose:number[]=[];
  solids.forEach((s,i)=>{
    if(!orderedRect(s.rect)){loose.push(i);return;}
    const ix0=Math.floor((s.rect.x0-x0)/SOLID_CELL),ix1=Math.floor((s.rect.x1-x0)/SOLID_CELL),iz0=Math.floor((s.rect.z0-z0)/SOLID_CELL),iz1=Math.floor((s.rect.z1-z0)/SOLID_CELL);
    for(let ix=ix0;ix<=ix1;ix++)for(let iz=iz0;iz<=iz1;iz++)cells[ix*nz+iz].push(i);
  });
  index={x0,z0,nx,nz,cells,loose,stamp:new Uint32Array(solids.length),visit:0,found:new Int32Array(solids.length),count:0};solidIndexes.set(solids,index);return index;
}
/** Solids that may meet [qx0,qx1]×[qz0,qz1] (any order; the callers' tests
 * are order-free existence checks). The result buffer is reused per index. */
function solidsNear(solids:LocalSolid[],qx0:number,qx1:number,qz0:number,qz1:number):SolidIndex|null {
  if(!(qx0<=qx1&&qz0<=qz1)||!Number.isFinite(qx0)||!Number.isFinite(qx1)||!Number.isFinite(qz0)||!Number.isFinite(qz1))return null;
  const index=solidIndex(solids),found=index.found;let count=0;
  if(++index.visit===0xffffffff){index.stamp.fill(0);index.visit=1;}
  for(const i of index.loose){index.stamp[i]=index.visit;found[count++]=i;}
  const ix0=Math.max(0,Math.floor((qx0-index.x0)/SOLID_CELL)),ix1=Math.min(index.nx-1,Math.floor((qx1-index.x0)/SOLID_CELL)),iz0=Math.max(0,Math.floor((qz0-index.z0)/SOLID_CELL)),iz1=Math.min(index.nz-1,Math.floor((qz1-index.z0)/SOLID_CELL));
  for(let ix=ix0;ix<=ix1;ix++)for(let iz=iz0;iz<=iz1;iz++){const cell=index.cells[ix*index.nz+iz];for(let k=0;k<cell.length;k++){const i=cell[k];if(index.stamp[i]!==index.visit){index.stamp[i]=index.visit;found[count++]=i;}}}
  index.count=count;return index;
}
interface RectSnapshot {rect:Rect;x0:number;x1:number;z0:number;z1:number}
interface SupportFootprint {regions:Rect[];boundaries:[number,number][][]|null}
interface SupportFootprints {y:number;base:RectSnapshot[];slabs:{plan:FloorPlan;top:number;regions:RectSnapshot[]}[];stairs:(RectSnapshot&{top:number})[];byTop:Map<number,SupportFootprint>}
const supportFootprintCache=new WeakMap<FloorPlan,SupportFootprints>();
const snapshotRect=(r:Rect):RectSnapshot=>({rect:r,x0:r.x0,x1:r.x1,z0:r.z0,z1:r.z1});
const sameRect=(saved:RectSnapshot,r:Rect)=>saved.rect===r&&saved.x0===r.x0&&saved.x1===r.x1&&saved.z0===r.z0&&saved.z1===r.z1;
function supportFootprints(p:FloorPlan,base:Rect[],surfaces:StairSurface[],plans:FloorPlan[]):SupportFootprints {
  if(trusted(trustedFootprints,p))return supportFootprintCache.get(p)!;
  const result=validatedSupportFootprints(p,base,surfaces,plans);trust(trustedFootprints,p);return result;
}
function validatedSupportFootprints(p:FloorPlan,base:Rect[],surfaces:StairSurface[],plans:FloorPlan[]):SupportFootprints {
  const cached=supportFootprintCache.get(p);
  let unchanged=!!cached&&cached.y===p.y&&cached.base.length===base.length&&cached.stairs.length===surfaces.length;
  if(unchanged)for(let i=0;i<base.length;i++)if((i in base)!==(i in cached!.base)||(i in base&&!sameRect(cached!.base[i],base[i]))){unchanged=false;break;}
  if(unchanged)for(let i=0;i<surfaces.length;i++)if(cached!.stairs[i].top!==surfaces[i].top||!sameRect(cached!.stairs[i],surfaces[i].rect)){unchanged=false;break;}
  if(unchanged) {
    if(cached!.slabs.length!==plans.length)unchanged=false;
    for(let i=0;i<plans.length;i++) {
      const plan=plans[i],regions=getFloorPlanSlabRegions(plan),saved=cached!.slabs[i];
      if(!saved||saved.plan!==plan||saved.top!==plan.y||saved.regions.length!==regions.length){unchanged=false;continue;}
      for(let j=0;j<regions.length;j++)if((j in regions)!==(j in saved.regions)||(j in regions&&!sameRect(saved.regions[j],regions[j]))){unchanged=false;break;}
    }
  }
  if(unchanged)return cached!;
  const stairs=surfaces.map(s=>({top:s.top,...snapshotRect(s.rect)}));
  const slabs=plans.map(plan=>({plan,top:plan.y,regions:getFloorPlanSlabRegions(plan).map(snapshotRect)}));
  const result:SupportFootprints={y:p.y,base:base.map(snapshotRect),slabs,stairs,byTop:new Map()};
  // Clear all height entries when their mutable geometry changes. This also
  // bounds the map to the current floor height and current stair heights.
  supportFootprintCache.set(p,result);return result;
}
export function floorPlanSupport(b:Building,floor:number,worldPosition:Vec3,radius=.35):FloorSupport|null {
  const p=getBuildingFloorPlan(b,floor);if(!p)return null;const local=buildingLocalPosition(b,worldPosition),plans=nearPlans(b,p),surfaces=stairSurfaces(b,p,plans);
  const choices:{top:number;kind:FloorSupport['kind'];floor:number;link?:FloorSupport['link']}[]=[];
  const base=getFloorPlanSlabRegions(p);
  // A centre surface must still be reachable from the current feet. Its full
  // body footprint is evaluated at that surface's landing height, so the next
  // real .2m tread can support the front of a .35m disk over an upper shaft.
  const supportedAt=new Map<number,boolean>();
  let footprints:SupportFootprints|undefined;
  const diskSupportedAt=(top:number):boolean=>{
    const cached=supportedAt.get(top);if(cached!==undefined)return cached;
    footprints??=supportFootprints(p,base,surfaces,plans);
    let footprint=footprints.byTop.get(top);
    if(!footprint){const regions:Rect[]=[];for(const slab of footprints.slabs)if(slab.top<=top+.22+eps&&slab.top>=top-.42-eps)regions.push(...slab.regions.map(s=>s.rect));for(const s of surfaces)if(s.top<=top+.22+eps&&s.top>=top-.42-eps)regions.push(s.rect);footprint={regions,boundaries:null};footprints.byTop.set(top,footprint);}
    let supported=containsUnion(footprint.regions,local.x,local.z);
    if(supported&&radius!==0){
      const loops=footprint.boundaries??=boundaryLoops(footprint.regions),minimum=radius*radius-eps;
      checkBoundary:for(const loop of loops)for(let i=0;i<loop.length;i++)if(!(segmentDistanceSquared(local.x,local.z,loop[i],loop[(i+1)%loop.length])>=minimum)){supported=false;break checkBoundary;}
    }
    supportedAt.set(top,supported);return supported;
  };
  let raisedStair=false;
  for(const s of surfaces)if(contains(s.rect,local.x,local.z)&&s.top>p.y+eps&&s.top<=local.y+.22+eps&&s.top>=local.y-.42-eps){raisedStair=true;break;}
  if(!raisedStair&&containsUnion(base,local.x,local.z)&&(radius===0||Math.abs(p.y-local.y)<=.42+eps)&&diskSupportedAt(p.y)) {
    const kind=contains(p.stairLanding,local.x,local.z)?'stairs':containsUnion(p.interior,local.x,local.z)?'room':containsUnion(p.circulation,local.x,local.z)?'gallery':'courtyard';choices.push({top:p.y,kind,floor:p.floor});
  }
  let onStair=false;for(const s of surfaces)if(contains(s.rect,local.x,local.z)){onStair=true;break;}
  if(onStair)for(const s of surfaces) {
    if(!contains(s.rect,local.x,local.z) || s.top>local.y+.22+eps || s.top<local.y-.42-eps || !diskSupportedAt(s.top))continue;
    const target=getBuildingFloorPlan(b,s.toFloor)!;
    choices.push({top:s.top,kind:'stairs',floor:s.top>=target.y-eps?s.toFloor:s.fromFloor,link:{fromFloor:s.fromFloor,toFloor:s.toFloor}});
  }
  // A restored actor on a real fixture top is supported; it is not lifted there.
  for(const f of p.fixtures)if(contains(f.rect,local.x,local.z)&&Math.abs(local.y-(p.y+f.top))<.01)choices.push({top:p.y+f.top,kind:'room',floor});
  choices.sort((a,z)=>Math.abs(a.top-local.y)-Math.abs(z.top-local.y)||z.top-a.top);
  if(radius>0&&choices.length===0) {
    // An obstacle cannot supply a missing support choice. Retain the public
    // descriptor-cache lifetime, including the original positive-radius order.
    for(const f of plans) {
      const panels=wallPanels(f);
      // Sparse/null members previously threw in localSolids even without a
      // support choice. Delegate these malformed inputs to that original path.
      for(const s of panels)if(s==null){localSolids(b,p,plans,surfaces);return null;}
      for(const s of f.fixtures)if(s==null){localSolids(b,p,plans,surfaces);return null;}
    }
    for(const f of plans)if(f.floor>p.floor)getFloorPlanSlabRegions(f);
    return null;
  }
  const solids=radius>0?localSolids(b,p,plans,surfaces):[];
  // Keep the existing lazy descriptor-cache priming without allocating solids.
  // FloorPlan arrays remain public and mutable; this preserves their existing
  // cache lifetime even when a radius-zero query precedes a later body query.
  if(!(radius>0))for(const f of plans) {
    wallPanels(f);if(f.floor>p.floor)getFloorPlanSlabRegions(f);
  }
  const reach=Math.abs(radius)+eps,x0=local.x-reach,x1=local.x+reach,z0=local.z-reach,z1=local.z+reach;
  // In a fixed-geometry window only solids near the disk need the exact test below.
  const near=radius>0&&trusted(trustedSolids,p)?solidsNear(solids,x0-1,x1+1,z0-1,z1+1):null,candidates=near?near.count:solids.length;
  chooseSupport:for(const choice of choices) {
    if(radius>0)for(let k=0;k<candidates;k++){const s=near?solids[near.found[k]]:solids[k];
      if(!(s.top>choice.top+(s.steppable ? .22 : .01)&&s.bottom<choice.top+1.72-eps))continue;
      const r=s.rect,rx0=r.x0,rx1=r.x1,rz0=r.z0,rz1=r.z1;
      // Only reject ordered rectangles outside the whole disk's bounds. The
      // original distance still decides every nearby or malformed rectangle.
      // Descriptors and nested coordinates are read again on every query.
      if(rx0<=rx1&&rz0<=rz1&&(rx1<x0||rx0>x1||rz1<z0||rz0>z1))continue;
      // Capture coordinates in the original circle-distance read order. This
      // also preserves public accessor reads rather than reading a rect again.
      if(Math.max(rx0-local.x,0,local.x-rx1)**2+Math.max(rz0-local.z,0,local.z-rz1)**2<radius*radius-eps)continue chooseSupport;
    }
    return {kind:choice.kind,floor:choice.floor,y:b.position.y+.6+choice.top,local:{x:local.x,z:local.z},...(choice.link?{link:choice.link}:{})};
  }return null;
}
export const classifyFloorPosition=floorPlanSupport;
function segmentIntersectsRect(a:Vec3,b:Vec3,r:Rect):boolean {
  let lo=0,hi=1;
  for(const [start,change,min,max] of [[a.x,b.x-a.x,r.x0,r.x1],[a.z,b.z-a.z,r.z0,r.z1]]){
    if(Math.abs(change)<eps){if(start<min||start>max)return false;continue;}
    const t0=(min-start)/change,t1=(max-start)/change;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(lo>hi)return false;
  }return true;
}
export function blocksFloorPlanMovement(b:Building,floor:number,from:Vec3,to:Vec3,radius=.35,eyeHeight=1.72):boolean {
  const p=getBuildingFloorPlan(b,floor);if(!p)return false;const a=buildingLocalPosition(b,from),z=buildingLocalPosition(b,to);
  // A solid outside the full swept body's XZ bounds cannot intersect it.
  // This is only a conservative rejection; retain the original exact segment,
  // endpoint/corner distance, height, roof and mutable-derived-view checks.
  const reach=Number.isFinite(radius)&&Number.isFinite(a.x)&&Number.isFinite(a.z)&&Number.isFinite(z.x)&&Number.isFinite(z.z)?Math.abs(radius)+eps:Infinity,x0=Math.min(a.x,z.x)-reach,x1=Math.max(a.x,z.x)+reach,z0=Math.min(a.z,z.z)-reach,z1=Math.max(a.z,z.z)+reach;
  const solids=localSolids(b,p),near=reach!==Infinity&&trusted(trustedSolids,p)?solidsNear(solids,x0-1,x1+1,z0-1,z1+1):null,candidates=near?near.count:solids.length;
  for(let k=0;k<candidates;k++) {const w=near?solids[near.found[k]]:solids[k];
    if(w.top<=Math.max(a.y,z.y)+(w.steppable ? .22 : .01) || w.bottom>=Math.max(a.y,z.y)+eyeHeight)continue;
    const r=w.rect;
    if(Number.isFinite(r.x0)&&Number.isFinite(r.x1)&&Number.isFinite(r.z0)&&Number.isFinite(r.z1)&&(Math.max(r.x0,r.x1)<x0 || Math.min(r.x0,r.x1)>x1 || Math.max(r.z0,r.z1)<z0 || Math.min(r.z0,r.z1)>z1))continue;
    if(segmentIntersectsRect(a,z,w.rect))return true;
    let distance=Math.min(circleRectDistanceSquared(a.x,a.z,w.rect),circleRectDistanceSquared(z.x,z.z,w.rect));
    for(const point of [[w.rect.x0,w.rect.z0],[w.rect.x0,w.rect.z1],[w.rect.x1,w.rect.z0],[w.rect.x1,w.rect.z1]])distance=Math.min(distance,segmentDistanceSquared(point[0],point[1],[a.x,a.z],[z.x,z.z]));
    if(distance<radius*radius-eps)return true;
  }return blocksRoofMovement(b,from,to,radius,eyeHeight);
}
/** Explicit policy for ordinary NPC reference legs. A sloping route's head
 * height is tested where it actually reaches each solid, rather than at the
 * highest endpoint of the whole leg. Stair phases, support, route planning and
 * the existing roof contract remain independently enforced. */
export function blocksFloorPlanReferenceMovement(b:Building,floor:number,from:Vec3,to:Vec3,radius=.35,eyeHeight=1.72):boolean {
  const p=getBuildingFloorPlan(b,floor);if(!p)return false;
  const a=buildingLocalPosition(b,from),z=buildingLocalPosition(b,to);
  const reach=radius+eps,x0=Math.min(a.x,z.x)-reach,x1=Math.max(a.x,z.x)+reach,z0=Math.min(a.z,z.z)-reach,z1=Math.max(a.z,z.z)+reach;
  for(const solid of localSolids(b,p)) {
    const r=solid.rect;
    // This horizontal rejection contains the entire moving circle. Do not
    // make a height rejection from either endpoint of a sloping leg.
    if([r.x0,r.x1,r.z0,r.z1,solid.bottom,solid.top].every(Number.isFinite)&&r.x0<=r.x1&&r.z0<=r.z1&&solid.bottom<solid.top
      &&(r.x1<x0||r.x0>x1||r.z1<z0||r.z0>z1))continue;
    if(blocksSweptUprightCylinder(a,z,{...solid.rect,bottom:solid.bottom,top:solid.top},radius,eyeHeight,solid.steppable ? .22 : .01))return true;
  }
  return blocksRoofMovement(b,from,to,radius,eyeHeight);
}
const roofCache=new WeakMap<BuildingBody,RoofRegion[]>();
export function getFloorPlanRoofRegions(body:BuildingBody):RoofRegion[] {
  const cached=roofCache.get(body);if(cached)return cached;
  const regions:RoofRegion[]=[];
  for(let i=0;i<body.floorPlans.length;i++) {
    const p=body.floorPlans[i],next=body.floorPlans[i+1];if(p.floor<0)continue;
    for(const r of rectangleCover(p.circulation,[...p.interior,...(next?.interior??[])]))regions.push({rect:r,bottom:p.y+2.6,top:p.y+2.8,floor:p.floor,kind:'gallery-flat',anchor:'minimum'});
    for(const outline of rectangleCover(p.interior,next?.interior??[])) {
      const r={...outline},alongX=r.x1-r.x0<=r.z1-r.z0,span=alongX?r.x1-r.x0:r.z1-r.z0;
      if(Math.round(span*5)%2!==0){const strip=alongX?rect(r.x1-.2,r.x1,r.z0,r.z1):rect(r.x0,r.x1,r.z1-.2,r.z1);regions.push({rect:strip,bottom:p.ceilingY,top:q(p.ceilingY+.4),floor:p.floor,kind:'weather-strip',anchor:'minimum'});if(alongX)r.x1=q(r.x1-.2);else r.z1=q(r.z1-.2);}
      if(r.x1>r.x0&&r.z1>r.z0)regions.push({rect:r,bottom:p.ceilingY,top:q(p.ceilingY+1.2),floor:p.floor,kind:'gable',gableAxis:alongX?'x':'z',anchor:'minimum'});
    }
  }roofCache.set(body,regions);return regions;
}

function localSegmentClear(p:FloorPlan,a:Vec3,b:Vec3,radius:number,building:Building,segmentBlocked?: (from:Vec3,to:Vec3)=>boolean):boolean {
  if(segmentBlocked?.(buildingWorldPosition(building,a),buildingWorldPosition(building,b)))return false;
  if(blocksFloorPlanMovement(building,p.floor,buildingWorldPosition(building,a),buildingWorldPosition(building,b),radius))return false;
  const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.4));
  for(let i=0;i<=steps;i++){const t=i/steps;if(!canStandInFloorPlan(p,a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,radius))return false;}return true;
}
interface RouteGrid { x0:number;z0:number;nx:number;nz:number;step:number;walkable:Uint8Array;edges?:Map<((from:Vec3,to:Vec3)=>boolean)|undefined,Uint8Array> }
/** A segment guard whose answer depends only on its two endpoints (fixed
 * geometry). Route searches may then remember each grid edge's clearance per
 * floor plan, exactly like the grid's own walkable cells. Other guards are
 * called on every query, as before. */
const pureSegmentBlockers=new WeakSet<(from:Vec3,to:Vec3)=>boolean>();
export function pureSegmentBlocker<T extends (from:Vec3,to:Vec3)=>boolean>(blocker:T):T{pureSegmentBlockers.add(blocker);return blocker;}
const routeGrids=new WeakMap<FloorPlan,Map<number,RouteGrid>>();
function routeGrid(p:FloorPlan,radius:number):RouteGrid {
  let maps=routeGrids.get(p);if(!maps){maps=new Map();routeGrids.set(p,maps);}const found=maps.get(radius);if(found)return found;
  const step=.8,x0=Math.ceil((p.broadphase.x0+radius)/step)*step,z0=Math.ceil((p.broadphase.z0+radius)/step)*step,nx=Math.floor((p.broadphase.x1-radius-x0)/step)+1,nz=Math.floor((p.broadphase.z1-radius-z0)/step)+1;
  const walkable=new Uint8Array(nx*nz);for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)walkable[z*nx+x]=Number(canStandInFloorPlan(p,x0+x*step,z0+z*step,radius));
  const g={x0,z0,nx,nz,step,walkable};maps.set(radius,g);return g;
}
interface StairRecovery { link:NonNullable<FloorSupport['link']>; index:number; point:Vec3; distance:number }
/** A stair/slab union can support a body while the planar slab alone cannot.
 * At an upper exit the selected slab support has no link. Recover only through
 * an adjacent real stair route with a supported, clear connector, and retain
 * that exact connector in the returned route rather than cutting to a vertex. */
function stairRecoveries(b:Building,p:FloorPlan,from:Vec3,radius:number,support:FloorSupport|null,segmentBlocked?:(from:Vec3,to:Vec3)=>boolean):StairRecovery[]|null {
  if(!support)return null;
  const local=buildingLocalPosition(b,from);
  if(Math.abs(from.y-(b.position.y+.6+p.y))<=.01&&canStandInFloorPlan(p,local.x,local.z,radius))return null;
  if(!support.link&&support.kind!=='stairs')return null;
  const candidates:StairRecovery[]=[];
  for(const fromFloor of support.link?[support.link.fromFloor]:[p.floor-1,p.floor]) {
    const route=getFloorPlanStairRoute(b,fromFloor,fromFloor+1);if(!route)continue;
    for(let i=0;i<route.length-1;i++) {
      const a=route[i],z=route[i+1],dx=z.x-a.x,dy=z.y-a.y,dz=z.z-a.z,l2=dx*dx+dy*dy+dz*dz;
      const t=l2?Math.max(0,Math.min(1,((from.x-a.x)*dx+(from.y-a.y)*dy+(from.z-a.z)*dz)/l2)):0;
      const nearest={x:a.x+t*dx,y:a.y+t*dy,z:a.z+t*dz},d=Math.hypot(nearest.x-from.x,nearest.y-from.y,nearest.z-from.z);
      if((!support.link&&Math.abs(nearest.y-from.y)>.01)||segmentBlocked?.(from,nearest)||blocksFloorPlanMovement(b,p.floor,from,nearest,radius))continue;
      const steps=Math.max(1,Math.ceil(d/.1));let clear=true;
      for(let step=0;step<=steps;step++) {
        const fraction=step/steps,point={x:from.x+(nearest.x-from.x)*fraction,y:from.y+(nearest.y-from.y)*fraction,z:from.z+(nearest.z-from.z)*fraction};
        const actual=floorPlanSupport(b,p.floor,point,radius);
        if(!actual||(!support.link&&Math.abs(actual.y-point.y)>.01)){clear=false;break;}
      }
      if(clear)candidates.push({link:{fromFloor,toFloor:fromFloor+1},index:i,point:nearest,distance:d});
    }
  }
  return candidates.sort((a,z)=>a.distance-z.distance||a.link.fromFloor-z.link.fromFloor||a.index-z.index);
}
/** Deterministic physical route on one shared floor. Legacy/unknown returns null. */
export function findFloorPlanRoute(b:Building,floor:number,fromWorld:Vec3,toWorld:Vec3,radius=.35,segmentBlocked?: (from:Vec3,to:Vec3)=>boolean):Vec3[]|null {
  const p=getBuildingFloorPlan(b,floor);if(!p)return null;
  const support=floorPlanSupport(b,floor,fromWorld,radius);if(stairRecoveries(b,p,fromWorld,radius,support,segmentBlocked)!==null)return findBuildingFloorPlanRoute(b,floor,floor,fromWorld,toWorld,radius,segmentBlocked);
  const originalFrom=buildingLocalPosition(b,fromWorld),originalTo=buildingLocalPosition(b,toWorld);
  const endpoint=(point:Vec3):Vec3|null=>{
    if(canStandInFloorPlan(p,point.x,point.z,radius))return {...point,y:p.y};
    if(floor!==0)return null;
    const entrance=buildingLocalPosition(b,getBuildingEntrance(b));
    const wall=p.walls.find(w=>w.opening?.use==='entrance');if(!wall?.opening)return null;
    const half=(wall.opening.to-wall.opening.from)/2;
    if(point.z<entrance.z-radius || point.z>entrance.z+4 || Math.abs(point.x-entrance.x)>half-radius)return null;
    const inner={x:entrance.x,y:p.y,z:entrance.z-1};
    if(!canStandInFloorPlan(p,inner.x,inner.z,radius)||blocksFloorPlanMovement(b,floor,buildingWorldPosition(b,point),buildingWorldPosition(b,inner),radius))return null;
    return inner;
  };
  const from=endpoint(originalFrom),to=endpoint(originalTo);if(!from||!to)return null;
  let local:Vec3[];
  if(localSegmentClear(p,from,to,radius,b,segmentBlocked))local=[from,to];
  else {
    const g=routeGrid(p,radius),point=(id:number):Vec3=>({x:g.x0+(id%g.nx)*g.step,y:p.y,z:g.z0+Math.floor(id/g.nx)*g.step});
    const attach=(target:Vec3):number|null=>{
      const cx=Math.round((target.x-g.x0)/g.step),cz=Math.round((target.z-g.z0)/g.step),choices:{id:number;distance:number}[]=[];
      for(let z=Math.max(0,cz-3);z<=Math.min(g.nz-1,cz+3);z++)for(let x=Math.max(0,cx-3);x<=Math.min(g.nx-1,cx+3);x++) {const id=z*g.nx+x;if(g.walkable[id])choices.push({id,distance:Math.hypot(point(id).x-target.x,point(id).z-target.z)});}
      choices.sort((a,z)=>a.distance-z.distance||a.id-z.id);return choices.find(c=>localSegmentClear(p,target,point(c.id),radius,b,segmentBlocked))?.id??null;
    };
    const start=attach(from),goal=attach(to);if(start===null||goal===null)return null;
    const previous=new Int32Array(g.walkable.length).fill(-1),queue=new Int32Array(g.walkable.length);let head=0,tail=0;previous[start]=start;queue[tail++]=start;
    // Directed grid-edge clearance (0 unknown, 1 clear, 2 blocked) for fixed geometry.
    let edges:Uint8Array|undefined;
    if(!segmentBlocked||pureSegmentBlockers.has(segmentBlocked)){g.edges??=new Map();edges=g.edges.get(segmentBlocked);if(!edges){edges=new Uint8Array(g.walkable.length*4);g.edges.set(segmentBlocked,edges);}}
    const directions=[[1,0],[-1,0],[0,1],[0,-1]];
    while(head<tail&&previous[goal]===-1){const id=queue[head++],x=id%g.nx,z=Math.floor(id/g.nx);for(let d=0;d<4;d++){const dx=directions[d][0],dz=directions[d][1];
      const xx=x+dx,zz=z+dz;if(xx<0||xx>=g.nx||zz<0||zz>=g.nz)continue;const next=zz*g.nx+xx;
      if(previous[next]!==-1||!g.walkable[next])continue;
      let clear:boolean;
      if(edges){const known=edges[id*4+d];if(known)clear=known===1;else{clear=localSegmentClear(p,point(id),point(next),radius,b,segmentBlocked);edges[id*4+d]=clear?1:2;}}
      else clear=localSegmentClear(p,point(id),point(next),radius,b,segmentBlocked);
      if(!clear)continue;previous[next]=id;queue[tail++]=next;
    }}
    if(previous[goal]===-1)return null;const path:Vec3[]=[];for(let id=goal;;id=previous[id]){path.push(point(id));if(id===start)break;}path.reverse();
    const raw=[from,...path,to];local=[raw[0]];let anchor=0;while(anchor<raw.length-1){let next=raw.length-1;while(next>anchor+1&&!localSegmentClear(p,raw[anchor],raw[next],radius,b,segmentBlocked))next--;local.push(raw[next]);anchor=next;}
  }
  const world=local.map(point=>buildingWorldPosition(b,point));
  if(Math.hypot(originalFrom.x-from.x,originalFrom.z-from.z)>eps)world.unshift({...fromWorld});
  if(Math.hypot(originalTo.x-to.x,originalTo.z-to.z)>eps)world.push({...toWorld});return world;
}

/** Actual .2-rise/.4-going surfaces remain authoritative. Only the declared
 * commercial route revision keeps straight-flight endpoints instead of each
 * collinear tread centre, retaining landings/turns within the saved route cap. */
export function getFloorPlanStairRoute(b:Building,fromFloor:number,toFloor:number):Vec3[]|null {
  if(toFloor!==fromFloor+1)return null;const p=getBuildingFloorPlan(b,fromFloor),next=getBuildingFloorPlan(b,toFloor);if(!p||!next||!p.stairTreads.length)return null;
  const cx=p.stair.x,cz=p.stair.z,left=cx-1,right=cx+1,local:Vec3[]=[{x:cx,y:p.y,z:cz},{x:left,y:p.y,z:cz+.4}];
  const lower=p.stairLandings.find(s=>s.id==='lower-link');if(lower)local.push({x:left,y:lower.top,z:(lower.rect.z0+lower.rect.z1)/2});
  const compact=b.commercialGeometryRevision===1&&b.commercialRouteRevision===1&&continuousStairs(b);
  const flight=(prefix:string)=>{const treads=p.stairTreads.filter(s=>s.id.startsWith(prefix));return compact&&treads.length>2?[treads[0],treads[treads.length-1]]:treads;};
  for(const t of flight('up-'))local.push({x:left,y:t.top,z:(t.rect.z0+t.rect.z1)/2});
  const turn=p.stairLandings.find(s=>s.id==='half-turn')!;const z=(turn.rect.z0+turn.rect.z1)/2;local.push({x:left,y:turn.top,z},{x:right,y:turn.top,z});
  for(const t of flight('return-'))local.push({x:right,y:t.top,z:(t.rect.z0+t.rect.z1)/2});
  local.push({x:right,y:next.y,z:cz+.4},{x:cx,y:next.y,z:cz});return local.map(point=>buildingWorldPosition(b,point));
}
export function findBuildingFloorPlanRoute(b:Building,fromFloor:number,toFloor:number,fromWorld:Vec3,toWorld:Vec3,radius=.35,segmentBlocked?:(from:Vec3,to:Vec3)=>boolean):Vec3[]|null {
  if(!getBuildingFloorPlan(b,fromFloor)||!getBuildingFloorPlan(b,toFloor))return null;
  const p=getBuildingFloorPlan(b,fromFloor)!,support=floorPlanSupport(b,fromFloor,fromWorld,radius);
  const recoveries=stairRecoveries(b,p,fromWorld,radius,support,segmentBlocked);
  if(recoveries!==null) {
    // An empty list means recovery failed; do not flatten supported stair feet
    // onto the floor's planar y. Try clear attachments in distance order.
    for(const recovery of recoveries) {
      const {link,index,point}=recovery,whole=getFloorPlanStairRoute(b,link.fromFloor,link.toFloor)!;
      const down=toFloor<=link.fromFloor,path=down?whole.slice(0,index+1).reverse():whole.slice(index+1),exitFloor=down?link.fromFloor:link.toFloor,exit=path[path.length-1];
      const prefix=[{...fromWorld},point,...path],exitPlan=getBuildingFloorPlan(b,exitFloor)!;
      const exitLocal=buildingLocalPosition(b,exit);
      // Recovery must finish on a real planar landing. A mutated descriptor or
      // body radius that cannot stand there cannot recursively recover again.
      if(!canStandInFloorPlan(exitPlan,exitLocal.x,exitLocal.z,radius)||prefix.some((point,i)=>i>0&&segmentBlocked?.(prefix[i-1],point)))continue;
      const tail=findBuildingFloorPlanRoute(b,exitFloor,toFloor,exit,toWorld,radius,segmentBlocked);if(!tail)continue;
      const result=[...prefix,...tail.slice(1)];
      // Preserve the caller's complete-segment guard, including a ground door
      // endpoint appended by the planar tail and the prefix/tail seam.
      if(result.some((point,i)=>i>0&&segmentBlocked?.(result[i-1],point)))continue;
      return result;
    }
    return null;
  }
  if(fromFloor===toFloor)return findFloorPlanRoute(b,fromFloor,fromWorld,toWorld,radius,segmentBlocked);
  const start=getFloorPlanStairPosition(b,fromFloor),end=getFloorPlanStairPosition(b,toFloor),first=findFloorPlanRoute(b,fromFloor,fromWorld,start,radius,segmentBlocked),last=findFloorPlanRoute(b,toFloor,end,toWorld,radius,segmentBlocked);if(!first||!last)return null;
  const route=[...first],direction=Math.sign(toFloor-fromFloor);
  for(let floor=fromFloor;floor!==toFloor;floor+=direction){const step=direction>0?getFloorPlanStairRoute(b,floor,floor+1):getFloorPlanStairRoute(b,floor-1,floor)?.reverse();if(!step)return null;for(let i=1;i<step.length;i++){if(segmentBlocked?.(route[route.length-1],step[i]))return null;route.push(step[i]);}}
  route.push(...last.slice(1));return route;
}

function roofTopUnderCircle(roof:RoofRegion,x:number,z:number,radius:number):number|null {
  if(circleRectDistanceSquared(x,z,roof.rect)>radius*radius+eps)return null;
  if(roof.kind!=='gable')return roof.top;
  const alongX=roof.gableAxis==='x',cross=alongX?x:z,orth=alongX?z:x,min=alongX?roof.rect.x0:roof.rect.z0,max=alongX?roof.rect.x1:roof.rect.z1,orthMin=alongX?roof.rect.z0:roof.rect.x0,orthMax=alongX?roof.rect.z1:roof.rect.x1;
  const d=Math.max(orthMin-orth,0,orth-orthMax),reach=Math.sqrt(Math.max(0,radius*radius-d*d)),lo=Math.max(min,cross-reach),hi=Math.min(max,cross+reach);if(lo>hi+eps)return null;
  const position=Math.max(lo,Math.min(hi,(min+max)/2)),t=(position-min)/(max-min);return roof.bottom+.4+.8*(1-Math.abs(2*t-1));
}
export function getFloorPlanRoofSupport(b:Building,reference:Vec3,radius=.35):FloorSupport|null {
  const body=getBuildingBody(b);if(!body)return null;const local=buildingLocalPosition(b,reference);let best:FloorSupport|null=null;
  for(const roof of getFloorPlanRoofRegions(body)){
    if(!contains(roof.rect,local.x,local.z))continue;const top=roofTopUnderCircle(roof,local.x,local.z,radius);if(top===null||top>local.y+.6+eps)continue;
    const y=b.position.y+.6+top;if(!best||y>best.y)best={kind:'roof',floor:roof.floor,y,local:{x:local.x,z:local.z}};
  }return best;
}
function blocksRoofMovement(b:Building,from:Vec3,to:Vec3,radius:number,eyeHeight:number):boolean {
  const body=getBuildingBody(b);if(!body)return false;const a=buildingLocalPosition(b,from),z=buildingLocalPosition(b,to),steps=Math.max(1,Math.ceil(Math.hypot(z.x-a.x,z.z-a.z)/.1));
  // Every sample lies in the leg's box; a roof beyond the body's reach of that
  // box, or wholly above the highest head, cannot be met by any sample.
  const reach=Math.sqrt(radius*radius+eps)+1e-6,lowX=Math.min(a.x,z.x)-reach,highX=Math.max(a.x,z.x)+reach,lowZ=Math.min(a.z,z.z)-reach,highZ=Math.max(a.z,z.z)+reach,head=Math.max(a.y,z.y)+eyeHeight;
  const bounded=[lowX,highX,lowZ,highZ,head].every(Number.isFinite);
  for(const roof of getFloorPlanRoofRegions(body)){
    const r=roof.rect;
    if(bounded&&[r.x0,r.x1,r.z0,r.z1,roof.bottom].every(Number.isFinite)&&r.x0<=r.x1&&r.z0<=r.z1&&(r.x0>highX||r.x1<lowX||r.z0>highZ||r.z1<lowZ||head+1e-6<=roof.bottom+eps))continue;
    for(let i=0;i<=steps;i++) {
    const t=i/steps,x=a.x+(z.x-a.x)*t,zz=a.z+(z.z-a.z)*t,feet=a.y+(z.y-a.y)*t,top=roofTopUnderCircle(roof,x,zz,radius);
    if(top!==null&&feet+eyeHeight>roof.bottom+eps&&feet<top-eps)return true;
  }}return false;
}
