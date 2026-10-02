import type { Building, BuildingFunctionPoint, Vec3 } from './types';


export const FLOOR_PLAN_GEOMETRY_VERSION = 'architecture-v4-program-bodies-02-stairs-v1';
export type Family = 'home' | 'market' | 'workshop' | 'civic-academy' | 'finance-health' | 'transport-waterfront';
export const FLOOR_PLAN_PROFILE = 'v4-program-bodies-02' as const;
export type Candidate = 'v4-wings';
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
  floorPlans: FloorPlan[]; roofRhythm: 'split-gable' | 'hall-and-shops' | 'industrial-spans' | 'court-wings' | 'hall-and-service-tower' | 'covered-platform';
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

/** Rectilinear union boundary, with every intersection split before tracing.
 * This is shared by watertight mesh caps and the wall/collision contract. */
export function boundaryLoops(regions: readonly Rect[], holes: readonly Rect[] = []): [number, number][][] {
  for (const r of [...regions, ...holes]) if (![r.x0, r.x1, r.z0, r.z1].every(Number.isFinite) || r.x1 <= r.x0 || r.z1 <= r.z0) throw new Error('invalid region');
  // World dimensions retain their exact saved floating-point representation;
  // geometry cuts snap to the declared .2m lattice before partitioning. This
  // merges -10.6 and -10.600000000000001 rather than creating a sliver cell.
  const xs = [...new Set([...regions, ...holes].flatMap(r => [q(r.x0), q(r.x1)]))].sort((a, b) => a - b);
  const zs = [...new Set([...regions, ...holes].flatMap(r => [q(r.z0), q(r.z1)]))].sort((a, b) => a - b);
  const occupied = (i: number, j: number) => i >= 0 && j >= 0 && i < xs.length - 1 && j < zs.length - 1 && containsUnion(regions, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2) && !containsUnion(holes, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
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
  const candidate: Candidate = 'v4-wings';
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
    if (keepEnvelope || floor < 0) interior = [full];
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
        const from=q(mid-.8),to=q(mid+.8);
        if (wall.opening && from < wall.opening.to+.6 && to > wall.opening.from-.6) continue;
        wall.windows.push({from,to,bottom:.8,top:q(Math.min(2.2,height-.4))});
      }
      return wall;
    }));
    const usePoint = family === 'home' && !keepEnvelope && floor >= 0 ? { x: q(-w * .20), z: q(-d * .26) }
      : family === 'finance-health' && b.kind !== 'bank' && !keepEnvelope && floor >= 0 ? { x: 0, z: 0 }
      : family === 'transport-waterfront' && !keepEnvelope && floor > 0 ? { x: q(-w * .40), z: q(-d * .08) }
      : { x: 0, z: q(-d * .34) };
    const usePoints = family === 'market' && floor === 0 && !keepEnvelope ? [{ id: 'sale-west', x: q(-w * .35), z: q(d * .18) }, { id: 'sale-center', x: 0, z: q(d * .18) }, { id: 'sale-east', x: q(w * .35), z: q(d * .18) }] : [{ id: 'program', ...usePoint }];
    plans.push({ floor, y: q(floor * floorHeight), ceilingY: q((floor + 1) * floorHeight), broadphase: full, interior, circulation, courtyard, fixtures:[],stairTreads:[],stairLandings:[],stairHole: floor > -(b.basements ?? 0) ? rect(stair.x-2,stair.x+2,stair.z+.8,stair.z+.8+longestRun+2) : null, stairLanding: rect(stair.x-1.8,stair.x+1.8,stair.z-.8,stair.z+.8), walls, stair, usePoint, usePoints, program: floor < 0 ? b.basementUses?.[-floor - 1] ?? '地下空间' : b.floorUses?.[floor] ?? b.kind, permission: floor < 0 ? 'original-canAccessFloor' : b.floorPermissions?.[floor] ?? (floor < (b.publicFloors ?? b.floors) ? 'public' : b.requiredPermission ?? 'public') });
  }
  for(let index=0;index<plans.length;index++) {
    const p=plans[index],next=plans[index+1];
    if(next) {
      const levels=Math.round((next.y-p.y)/.2),a=Math.floor(levels/2),z=levels-a,run=Math.max(a,z)*.4,start=p.stair.z+.8,offset=run-a*.4;
      const surface=(id:string,region:Rect,top:number,kind:StairSurface['kind']):StairSurface=>({id,rect:region,bottom:q(top-.2),top:q(top),fromFloor:p.floor,toFloor:next.floor,kind});
      if(offset>.01)p.stairLandings.push(surface('lower-link',rect(p.stair.x-1.8,p.stair.x-.2,start,start+offset),p.y,'landing'));
      for(let i=1;i<=a;i++)p.stairTreads.push(surface(`up-${i}`,rect(p.stair.x-1.8,p.stair.x-.2,start+offset+(i-1)*.4,start+offset+i*.4),p.y+i*.2,'tread'));
      p.stairLandings.push(surface('half-turn',rect(p.stair.x-1.8,p.stair.x+1.8,start+run,start+run+1.6),p.y+a*.2,'landing'));
      for(let i=1;i<=z;i++)p.stairTreads.push(surface(`return-${i}`,rect(p.stair.x+.2,p.stair.x+1.8,start+run-i*.4,start+run-(i-1)*.4),p.y+(a+i)*.2,'tread'));
    }
  }
  for(const p of plans)p.fixtures=createFloorFixtures(b,p);
  return { buildingId: b.id, family, candidate, needsV4: !keepEnvelope, preserveExistingMesh: keepEnvelope, immutableDimensions: { width: b.width, depth: b.depth, height: b.height, floors: b.floors, basements: b.basements ?? 0, door: { ...b.door } }, floorPlans: plans, roofRhythm: ({ home: 'split-gable', market: 'hall-and-shops', workshop: 'industrial-spans', 'civic-academy': 'court-wings', 'finance-health': 'hall-and-service-tower', 'transport-waterfront': 'covered-platform' })[family] as BuildingBody['roofRhythm'] };
}


export interface WallPanel { rect: Rect; bottom: number; top: number; kind: 'solid' | 'glass' }
export interface FloorSupport { kind: 'room' | 'courtyard' | 'gallery' | 'stairs' | 'roof'; floor: number; y: number; local: { x: number; z: number }; link?: {fromFloor:number;toFloor:number} }
export interface RoofRegion { rect: Rect; bottom: number; top: number; floor: number; kind: 'gallery-flat' | 'weather-strip' | 'gable'; gableAxis?: 'x' | 'z'; anchor: 'minimum' }
interface BodyCache {
  width: number; depth: number; height: number; floors: number; basements: number; rotation: number;
  x: number; y: number; z: number; kind: Building['kind']; publicFloors: Building['publicFloors'];
  requiredPermission: Building['requiredPermission']; facility: Building['facility'];
  footprints: Building['floorFootprints']; uses: Building['floorUses']; permissions: Building['floorPermissions']; body: BuildingBody;
}
const bodies = new WeakMap<Building, BodyCache>();
export function getBuildingBody(b: Building): BuildingBody | null {
  if (b.floorPlanProfile !== FLOOR_PLAN_PROFILE || b.id === 'core-main' || b.kind === 'pavilion') return null;
  const cached=bodies.get(b);
  if(cached && cached.width===b.width && cached.depth===b.depth && cached.height===b.height && cached.floors===b.floors && cached.basements===(b.basements??0) && cached.rotation===b.rotation && cached.x===b.position.x && cached.y===b.position.y && cached.z===b.position.z && cached.kind===b.kind && cached.publicFloors===b.publicFloors && cached.requiredPermission===b.requiredPermission && cached.facility===b.facility && cached.footprints===b.floorFootprints && cached.uses===b.floorUses && cached.permissions===b.floorPermissions) return cached.body;
  const body=makeBody(b);
  bodies.set(b,{width:b.width,depth:b.depth,height:b.height,floors:b.floors,basements:b.basements??0,rotation:b.rotation,x:b.position.x,y:b.position.y,z:b.position.z,kind:b.kind,publicFloors:b.publicFloors,requiredPermission:b.requiredPermission,facility:b.facility,footprints:b.floorFootprints,uses:b.floorUses,permissions:b.floorPermissions,body});
  return body;
}
export function getBuildingFloorPlan(b: Building,floor: number): FloorPlan | null { return getBuildingBody(b)?.floorPlans.find(p=>p.floor===floor) ?? null; }
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
function segmentDistanceSquared(x:number,z:number,a:readonly number[],b:readonly number[]) {const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));return (x-a[0]-dx*t)**2+(z-a[1]-dz*t)**2;}
function circleRectDistanceSquared(x:number,z:number,r:Rect) {return Math.max(r.x0-x,0,x-r.x1)**2+Math.max(r.z0-z,0,z-r.z1)**2;}
export function canStandInFloorPlan(p:FloorPlan,x:number,z:number,radius=.35):boolean {
  if(!containsUnion(getFloorPlanSlabRegions(p),x,z))return false;
  if(radius>0)for(const loop of supportCache.get(p)!.boundaries)for(let i=0;i<loop.length;i++) if(segmentDistanceSquared(x,z,loop[i],loop[(i+1)%loop.length])<radius*radius-eps)return false;
  return ![...wallPanels(p),...p.fixtures].some(w=>w.bottom<1.72&&w.top>.05&&(radius===0?contains(w.rect,x,z):circleRectDistanceSquared(x,z,w.rect)<radius*radius-eps));
}
// These lists are private derived views. FloorPlan and the existing wall/slab
// cache results stay public and mutable, so membership is checked on each read.
const nearbyCache=new WeakMap<FloorPlan,FloorPlan[]>();
function nearPlans(b:Building,p:FloorPlan):FloorPlan[] {
  const plans=getBuildingBody(b)!.floorPlans,cached=nearbyCache.get(p);let index=0,unchanged=!!cached;
  for(let i=0;i<plans.length;i++)if(i in plans){const f=plans[i];if(Math.abs(f.floor-p.floor)<=1){if(cached?.[index]!==f)unchanged=false;index++;}}
  if(unchanged&&index===cached!.length)return cached!;
  const result=plans.filter(f=>Math.abs(f.floor-p.floor)<=1);nearbyCache.set(p,result);return result;
}
const stairSurfaceCache=new WeakMap<FloorPlan,StairSurface[]>();
function stairSurfaces(b:Building,p:FloorPlan,plans=nearPlans(b,p)):StairSurface[]{
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
  const cached=localSolidCache.get(p);let index=0,unchanged=!!cached;
  const check=(rect:Rect,bottom:number,top:number,steppable:boolean)=>{const s=cached?.[index++];if(!s||s.rect!==rect||s.bottom!==bottom||s.top!==top||s.steppable!==steppable)unchanged=false;};
  for(const f of plans){for(const s of wallPanels(f))check(s.rect,f.y+s.bottom,f.y+s.top,false);for(const s of f.fixtures)check(s.rect,f.y+s.bottom,f.y+s.top,false);}
  for(const s of surfaces){if(!s)return uncachedLocalSolids(b,p);check(s.rect,s.bottom,s.top,true);}
  // Read the existing slab cache rather than deriving a new slab lifetime.
  for(const f of plans)if(f.floor>p.floor){const regions=getFloorPlanSlabRegions(f);for(let i=0;i<regions.length;i++){if(!(i in regions))return uncachedLocalSolids(b,p);check(regions[i],f.y-.2,f.y,false);}}
  if(unchanged&&index===cached!.length)return cached!;
  const result:LocalSolid[]=[];
  for(const f of plans){for(const s of wallPanels(f))result.push({rect:s.rect,bottom:f.y+s.bottom,top:f.y+s.top,steppable:false});for(const s of f.fixtures)result.push({rect:s.rect,bottom:f.y+s.bottom,top:f.y+s.top,steppable:false});}
  for(const s of surfaces)result.push({rect:s.rect,bottom:s.bottom,top:s.top,steppable:true});
  for(const f of plans)if(f.floor>p.floor)for(const r of getFloorPlanSlabRegions(f))result.push({rect:r,bottom:f.y-.2,top:f.y,steppable:false});
  // A rect is shared, so nested coordinate edits remain live. Replacing it or
  // changing a copied height/member is detected by the checks above.
  localSolidCache.set(p,result);return result;
}
interface RectSnapshot {rect:Rect;x0:number;x1:number;z0:number;z1:number}
interface SupportFootprint {regions:Rect[];boundaries:[number,number][][]|null}
interface SupportFootprints {y:number;base:RectSnapshot[];stairs:(RectSnapshot&{top:number})[];byTop:Map<number,SupportFootprint>}
const supportFootprintCache=new WeakMap<FloorPlan,SupportFootprints>();
const snapshotRect=(r:Rect):RectSnapshot=>({rect:r,x0:r.x0,x1:r.x1,z0:r.z0,z1:r.z1});
const sameRect=(saved:RectSnapshot,r:Rect)=>saved.rect===r&&saved.x0===r.x0&&saved.x1===r.x1&&saved.z0===r.z0&&saved.z1===r.z1;
function supportFootprints(p:FloorPlan,base:Rect[],surfaces:StairSurface[]):SupportFootprints {
  const cached=supportFootprintCache.get(p);
  let unchanged=!!cached&&cached.y===p.y&&cached.base.length===base.length&&cached.stairs.length===surfaces.length;
  if(unchanged)for(let i=0;i<base.length;i++)if((i in base)!==(i in cached!.base)||(i in base&&!sameRect(cached!.base[i],base[i]))){unchanged=false;break;}
  if(unchanged)for(let i=0;i<surfaces.length;i++)if(cached!.stairs[i].top!==surfaces[i].top||!sameRect(cached!.stairs[i],surfaces[i].rect)){unchanged=false;break;}
  if(unchanged)return cached!;
  const stairs=surfaces.map(s=>({top:s.top,...snapshotRect(s.rect)}));
  const result:SupportFootprints={y:p.y,base:base.map(snapshotRect),stairs,byTop:new Map()};
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
    footprints??=supportFootprints(p,base,surfaces);
    let footprint=footprints.byTop.get(top);
    if(!footprint){const regions=[...base];for(const s of surfaces)if(s.top<=top+.22+eps&&s.top>=top-.42-eps)regions.push(s.rect);footprint={regions,boundaries:null};footprints.byTop.set(top,footprint);}
    const supported=containsUnion(footprint.regions,local.x,local.z)&&(radius===0||(footprint.boundaries??=boundaryLoops(footprint.regions)).every(loop=>loop.every((a,i)=>segmentDistanceSquared(local.x,local.z,a,loop[(i+1)%loop.length])>=radius*radius-eps)));
    supportedAt.set(top,supported);return supported;
  };
  if(!surfaces.some(s=>contains(s.rect,local.x,local.z)&&s.top>p.y+eps&&s.top<=local.y+.22+eps&&s.top>=local.y-.42-eps)&&containsUnion(base,local.x,local.z)&&(radius===0||Math.abs(p.y-local.y)<=.42+eps)&&diskSupportedAt(p.y)) {
    const kind=contains(p.stairLanding,local.x,local.z)?'stairs':containsUnion(p.interior,local.x,local.z)?'room':containsUnion(p.circulation,local.x,local.z)?'gallery':'courtyard';choices.push({top:p.y,kind,floor:p.floor});
  }
  const onStair=surfaces.some(s=>contains(s.rect,local.x,local.z));
  if(onStair)for(const s of surfaces) {
    if(!contains(s.rect,local.x,local.z) || s.top>local.y+.22+eps || s.top<local.y-.42-eps || !diskSupportedAt(s.top))continue;
    const target=getBuildingFloorPlan(b,s.toFloor)!;
    choices.push({top:s.top,kind:'stairs',floor:s.top>=target.y-eps?s.toFloor:s.fromFloor,link:{fromFloor:s.fromFloor,toFloor:s.toFloor}});
  }
  // A restored actor on a real fixture top is supported; it is not lifted there.
  for(const f of p.fixtures)if(contains(f.rect,local.x,local.z)&&Math.abs(local.y-(p.y+f.top))<.01)choices.push({top:p.y+f.top,kind:'room',floor});
  choices.sort((a,z)=>Math.abs(a.top-local.y)-Math.abs(z.top-local.y)||z.top-a.top);
  const solids=radius>0?localSolids(b,p,plans,surfaces):[];
  // Keep the existing lazy descriptor-cache priming without allocating solids.
  // FloorPlan arrays remain public and mutable; this preserves their existing
  // cache lifetime even when a radius-zero query precedes a later body query.
  if(!(radius>0))for(const f of plans) {
    wallPanels(f);if(f.floor>p.floor)getFloorPlanSlabRegions(f);
  }
  for(const choice of choices) {
    if(radius>0&&solids.some(s=>s.top>choice.top+(s.steppable ? .22 : .01)&&s.bottom<choice.top+1.72-eps&&circleRectDistanceSquared(local.x,local.z,s.rect)<radius*radius-eps))continue;
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
  for(const w of localSolids(b,p)) {
    if(w.top<=Math.max(a.y,z.y)+(w.steppable ? .22 : .01) || w.bottom>=Math.max(a.y,z.y)+eyeHeight)continue;
    if(segmentIntersectsRect(a,z,w.rect))return true;
    let distance=Math.min(circleRectDistanceSquared(a.x,a.z,w.rect),circleRectDistanceSquared(z.x,z.z,w.rect));
    for(const point of [[w.rect.x0,w.rect.z0],[w.rect.x0,w.rect.z1],[w.rect.x1,w.rect.z0],[w.rect.x1,w.rect.z1]])distance=Math.min(distance,segmentDistanceSquared(point[0],point[1],[a.x,a.z],[z.x,z.z]));
    if(distance<radius*radius-eps)return true;
  }return blocksRoofMovement(b,from,to,radius,eyeHeight);
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
interface RouteGrid { x0:number;z0:number;nx:number;nz:number;step:number;walkable:Uint8Array }
const routeGrids=new WeakMap<FloorPlan,Map<number,RouteGrid>>();
function routeGrid(p:FloorPlan,radius:number):RouteGrid {
  let maps=routeGrids.get(p);if(!maps){maps=new Map();routeGrids.set(p,maps);}const found=maps.get(radius);if(found)return found;
  const step=.8,x0=Math.ceil((p.broadphase.x0+radius)/step)*step,z0=Math.ceil((p.broadphase.z0+radius)/step)*step,nx=Math.floor((p.broadphase.x1-radius-x0)/step)+1,nz=Math.floor((p.broadphase.z1-radius-z0)/step)+1;
  const walkable=new Uint8Array(nx*nz);for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)walkable[z*nx+x]=Number(canStandInFloorPlan(p,x0+x*step,z0+z*step,radius));
  const g={x0,z0,nx,nz,step,walkable};maps.set(radius,g);return g;
}
/** Deterministic physical route on one shared floor. Legacy/unknown returns null. */
export function findFloorPlanRoute(b:Building,floor:number,fromWorld:Vec3,toWorld:Vec3,radius=.35,segmentBlocked?: (from:Vec3,to:Vec3)=>boolean):Vec3[]|null {
  const p=getBuildingFloorPlan(b,floor);if(!p)return null;
  const support=floorPlanSupport(b,floor,fromWorld,radius);if(support?.link&&Math.abs(fromWorld.y-(b.position.y+.6+p.y))>.01)return findBuildingFloorPlanRoute(b,floor,floor,fromWorld,toWorld,radius,segmentBlocked);
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
    while(head<tail&&previous[goal]===-1){const id=queue[head++],x=id%g.nx,z=Math.floor(id/g.nx);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const xx=x+dx,zz=z+dz;if(xx<0||xx>=g.nx||zz<0||zz>=g.nz)continue;const next=zz*g.nx+xx;
      if(previous[next]!==-1||!g.walkable[next]||!localSegmentClear(p,point(id),point(next),radius,b,segmentBlocked))continue;previous[next]=id;queue[tail++]=next;
    }}
    if(previous[goal]===-1)return null;const path:Vec3[]=[];for(let id=goal;;id=previous[id]){path.push(point(id));if(id===start)break;}path.reverse();
    const raw=[from,...path,to];local=[raw[0]];let anchor=0;while(anchor<raw.length-1){let next=raw.length-1;while(next>anchor+1&&!localSegmentClear(p,raw[anchor],raw[next],radius,b,segmentBlocked))next--;local.push(raw[next]);anchor=next;}
  }
  const world=local.map(point=>buildingWorldPosition(b,point));
  if(Math.hypot(originalFrom.x-from.x,originalFrom.z-from.z)>eps)world.unshift({...fromWorld});
  if(Math.hypot(originalTo.x-to.x,originalTo.z-to.z)>eps)world.push({...toWorld});return world;
}

/** Actual .2-rise/.4-going stair surfaces provide every cross-floor waypoint. */
export function getFloorPlanStairRoute(b:Building,fromFloor:number,toFloor:number):Vec3[]|null {
  if(toFloor!==fromFloor+1)return null;const p=getBuildingFloorPlan(b,fromFloor),next=getBuildingFloorPlan(b,toFloor);if(!p||!next||!p.stairTreads.length)return null;
  const cx=p.stair.x,cz=p.stair.z,left=cx-1,right=cx+1,local:Vec3[]=[{x:cx,y:p.y,z:cz},{x:left,y:p.y,z:cz+.4}];
  const lower=p.stairLandings.find(s=>s.id==='lower-link');if(lower)local.push({x:left,y:lower.top,z:(lower.rect.z0+lower.rect.z1)/2});
  for(const t of p.stairTreads.filter(s=>s.id.startsWith('up-')))local.push({x:left,y:t.top,z:(t.rect.z0+t.rect.z1)/2});
  const turn=p.stairLandings.find(s=>s.id==='half-turn')!;const z=(turn.rect.z0+turn.rect.z1)/2;local.push({x:left,y:turn.top,z},{x:right,y:turn.top,z});
  for(const t of p.stairTreads.filter(s=>s.id.startsWith('return-')))local.push({x:right,y:t.top,z:(t.rect.z0+t.rect.z1)/2});
  local.push({x:right,y:next.y,z:cz+.4},{x:cx,y:next.y,z:cz});return local.map(point=>buildingWorldPosition(b,point));
}
export function findBuildingFloorPlanRoute(b:Building,fromFloor:number,toFloor:number,fromWorld:Vec3,toWorld:Vec3,radius=.35,segmentBlocked?:(from:Vec3,to:Vec3)=>boolean):Vec3[]|null {
  if(!getBuildingFloorPlan(b,fromFloor)||!getBuildingFloorPlan(b,toFloor))return null;
  const p=getBuildingFloorPlan(b,fromFloor)!,support=floorPlanSupport(b,fromFloor,fromWorld,radius);
  if(support?.link&&Math.abs(fromWorld.y-(b.position.y+.6+p.y))>.01) {
    const link=support.link,whole=getFloorPlanStairRoute(b,link.fromFloor,link.toFloor)!;
    let index=0,distance=Infinity;for(let i=0;i<whole.length;i++){const candidate=Math.hypot(whole[i].x-fromWorld.x,whole[i].y-fromWorld.y,whole[i].z-fromWorld.z);if(candidate<distance){distance=candidate;index=i;}}
    const down=toFloor<=link.fromFloor,path=down?whole.slice(0,index+1).reverse():whole.slice(index),exitFloor=down?link.fromFloor:link.toFloor,exit=path[path.length-1];
    const tail=findBuildingFloorPlanRoute(b,exitFloor,toFloor,exit,toWorld,radius,segmentBlocked);if(!tail)return null;
    const result=[{...fromWorld},...path,...tail.slice(1)];for(let i=1;i<result.length;i++)if(segmentBlocked?.(result[i-1],result[i]))return null;return result;
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
  for(const roof of getFloorPlanRoofRegions(body))for(let i=0;i<=steps;i++) {
    const t=i/steps,x=a.x+(z.x-a.x)*t,zz=a.z+(z.z-a.z)*t,feet=a.y+(z.y-a.y)*t,top=roofTopUnderCircle(roof,x,zz,radius);
    if(top!==null&&feet+eyeHeight>roof.bottom+eps&&feet<top-eps)return true;
  }return false;
}
