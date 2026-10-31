import * as THREE from 'three';
import type { Building, Vec3 } from '../types';
import { getBuildingBody, getFloorPlanFixtures, getFloorPlanRoofRegions, getFloorPlanSlabRegions, rectangleCover, wallPanels, type FloorFixture, type Rect, type RoofRegion, type WallPanel } from '../architecture-floor-plan';

/** Normalized, centre-anchored geometry; one template per roof orientation.
 * Its final instance bounds, rather than a second proxy envelope, describe the
 * actual shared roof region. Buffers belong to each resident material batch. */
export interface ArchitectureTemplate {
  key: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[];
}
export interface ProgramArchitecturePart {
  material: 'wall' | 'stone' | 'wood' | 'roof' | 'glass' | 'amber' | 'cyan' | 'red' | 'metal' | 'fabric';
  position: Vec3; size: Vec3; color: string; floor: number; roof: boolean;
  purpose: 'floor' | 'wall' | 'window' | 'body' | 'roof' | 'furniture' | 'stairs';
  template?: ArchitectureTemplate; facade?: readonly [number, number, number, number];
}
const roofTemplates = new Map<string, ArchitectureTemplate>();
let linenTemplate: ArchitectureTemplate | undefined;

/** Original low-poly linen artwork. Bevels fit inside the exact existing
 * fixture part box: neither pillows nor mattress introduce a new collision or
 * enter the reserved bed-side standing space. One geometry serves all beds. */
export function programLinenTemplate(): ArchitectureTemplate {
  if (linenTemplate) return linenTemplate;
  const outline = [[-.38, -.5], [.38, -.5], [.5, -.38], [.5, .38], [.38, .5], [-.38, .5], [-.5, .38], [-.5, -.38]];
  const positions: number[] = [], indices: number[] = [];
  for (const [y, scale] of [[-.5, 1], [.18, 1], [.5, .84]]) for (const [x, z] of outline) positions.push(x * scale, y, z * scale);
  const cap = THREE.ShapeUtils.triangulateShape(outline.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [a, b, c] of cap) { indices.push(a, b, c); indices.push(a + 16, c + 16, b + 16); }
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8, a = ring * 8 + i, b = ring * 8 + j, c = (ring + 1) * 8 + i, d = (ring + 1) * 8 + j;
    indices.push(a, c, b, b, c, d);
  }
  const indexed = new THREE.BufferGeometry(); indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); indexed.setIndex(indices);
  const flat = indexed.toNonIndexed(); flat.computeVertexNormals();
  const vertices = Array.from(flat.getAttribute('position').array), normals = Array.from(flat.getAttribute('normal').array);
  linenTemplate = { key: 'program-linen-bevel-1', positions: vertices, normals,
    uvs: vertices.flatMap((_, i) => i % 3 === 0 ? [vertices[i] + .5, vertices[i + 2] + .5] : []),
    indices: Array.from({ length: vertices.length / 3 }, (_, i) => i) };
  indexed.dispose(); flat.dispose(); return linenTemplate;
}
export const PROGRAM_WALL_FINISH_PANEL_BUDGET = 128;
/** Most post bays on one finished wall panel (posts stand about every 2.4 m, never more than this many bays). */
export const PROGRAM_WALL_FINISH_MAX_BAYS = 6;
export interface ProgramWallFinish { rect: Rect; bottom: number; top: number; material: 'wall' | 'wood' }

/** Material boundaries divide the original opaque wall, never cover a window
 * or add a post outside that wall. All four pieces share its original solid. */
export function partitionProgramWallFinish(panel: WallPanel, bottom: number, top: number): ProgramWallFinish[] {
  const r = panel.rect, alongX = r.x1 - r.x0 >= r.z1 - r.z0, lo = alongX ? r.x0 : r.z0, hi = alongX ? r.x1 : r.z1;
  if (panel.kind !== 'solid') return [];
  if (hi - lo < .8 - 1e-7 || top - bottom < .4 - 1e-7) return [{ rect: r, bottom, top, material: 'wall' }];
  const slice = (from: number, to: number): Rect => alongX ? { ...r, x0: from, x1: to } : { ...r, z0: from, z1: to };
  // Posts stand at both ends and about every 2.4 m between (on the 0.2 m lattice); infill fills the bays.
  const bays = Math.min(PROGRAM_WALL_FINISH_MAX_BAYS, Math.max(1, Math.round((hi - lo - .2) / 2.4))), posts = [lo];
  for (let i = 1; i < bays; i++) posts.push(lo + Math.round((hi - lo - .2) * i / bays / .2) * .2);
  posts.push(hi - .2);
  const pieces: ProgramWallFinish[] = [{ rect: r, bottom: top - .2, top, material: 'wood' }];
  for (let i = 0; i < posts.length; i++) {
    pieces.push({ rect: slice(posts[i], posts[i] + .2), bottom, top: top - .2, material: 'wood' });
    if (i + 1 < posts.length && posts[i + 1] - posts[i] - .2 > 1e-7) pieces.push({ rect: slice(posts[i] + .2, posts[i + 1]), bottom, top: top - .2, material: 'wall' });
  }
  return pieces;
}

/** A tiled Chinese gable over a roof region, filling the batch's [-.5,.5] centred box exactly: the slope is concave
 * (steep at the ridge, flattening toward the eaves), the eaves curl up toward both gable ends (翼角), and a ridge beam
 * runs along the top to the box's top face. It is a closed solid over the region's own rectangle (a curved top, a flat
 * base and vertical eave and gable walls), every face wound outward, so it never reaches past the region into a
 * neighbouring wing. `axis` is the span axis. Flat normals keep the voxel look. */
const EAVE_HEIGHT = .3, RIDGE = .93, CURL = .12;
export function programRoofTemplate(axis: 'x' | 'z'): ArchitectureTemplate {
  const cached = roofTemplates.get(axis); if (cached) return cached;
  const tris: number[] = [];
  const put = (span: number, height: number, length: number) => axis === 'x' ? [span - .5, height - .5, length - .5] : [length - .5, height - .5, span - .5];
  // A triangle wound so that its normal points along `out` (given in span/height/length terms).
  const face = (a: number[], b: number[], c: number[], out: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const o = axis === 'x' ? out : [out[2], out[1], out[0]];
    tris.push(...a, ...(n[0] * o[0] + n[1] * o[1] + n[2] * o[2] >= 0 ? [...b, ...c] : [...c, ...b]));
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], out: number[]) => { face(a, b, c, out); face(a, c, d, out); };
  // Height of the roof surface at span position s (0..1) and length position l (0..1).
  const ends = (l: number) => { const t = Math.max(0, Math.min(1, (Math.abs(l * 2 - 1) - .6) / .4)); return t * t * (3 - 2 * t); };
  const surface = (s: number, l: number) => {
    const u = Math.min(1, Math.abs(s - .5) / .5), up = 1 - u;
    return EAVE_HEIGHT + (RIDGE - EAVE_HEIGHT) * Math.pow(up, 1.7) + CURL * ends(l) * Math.pow(u, 3);
  };
  const spans = [0, .08, .16, .24, .32, .4, .47, .5, .53, .6, .68, .76, .84, .92, 1], lengths = [0, .1, .2, .35, .5, .65, .8, .9, 1];
  const top = (s: number, l: number) => put(s, surface(s, l), l), base = (s: number, l: number) => put(s, 0, l);
  for (let i = 1; i < lengths.length; i++) for (let j = 1; j < spans.length; j++) {
    const [l0, l1, s0, s1] = [lengths[i - 1], lengths[i], spans[j - 1], spans[j]];
    quad(top(s0, l0), top(s1, l0), top(s1, l1), top(s0, l1), [0, 1, 0]);
    quad(base(s0, l0), base(s1, l0), base(s1, l1), base(s0, l1), [0, -1, 0]);
  }
  // Eave walls along both long sides, and gable walls closing both ends.
  for (const [s, out] of [[0, -1], [1, 1]] as const) for (let i = 1; i < lengths.length; i++)
    quad(base(s, lengths[i - 1]), base(s, lengths[i]), top(s, lengths[i]), top(s, lengths[i - 1]), [out, 0, 0]);
  for (const [l, out] of [[0, -1], [1, 1]] as const) for (let j = 1; j < spans.length; j++)
    quad(base(spans[j - 1], l), base(spans[j], l), top(spans[j], l), top(spans[j - 1], l), [0, 0, out]);
  // Ridge: a square beam along the top, from just under the tiles to the box's top face.
  const r0 = .47, r1 = .53, y0 = surface(.5, .5) - .02, y1 = 1, beam = (sp: number, y: number, l: number) => put(sp, y, l);
  quad(beam(r0, y1, 0), beam(r1, y1, 0), beam(r1, y1, 1), beam(r0, y1, 1), [0, 1, 0]);
  quad(beam(r0, y0, 0), beam(r1, y0, 0), beam(r1, y0, 1), beam(r0, y0, 1), [0, -1, 0]);
  quad(beam(r0, y0, 0), beam(r0, y1, 0), beam(r0, y1, 1), beam(r0, y0, 1), [-1, 0, 0]);
  quad(beam(r1, y0, 0), beam(r1, y1, 0), beam(r1, y1, 1), beam(r1, y0, 1), [1, 0, 0]);
  quad(beam(r0, y0, 0), beam(r1, y0, 0), beam(r1, y1, 0), beam(r0, y1, 0), [0, 0, -1]);
  quad(beam(r0, y0, 1), beam(r1, y0, 1), beam(r1, y1, 1), beam(r0, y1, 1), [0, 0, 1]);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3)); geometry.computeVertexNormals();
  const vertices = Array.from(geometry.getAttribute('position').array), normals = Array.from(geometry.getAttribute('normal').array);
  const uvs = vertices.flatMap((_, i) => i % 3 === 0 ? [vertices[i] + .5, vertices[i + 2] + .5] : []);
  const template = { key: `program-gable-${axis}-2`, positions: vertices, normals, uvs, indices: Array.from({ length: vertices.length / 3 }, (_, i) => i) };
  geometry.dispose(); roofTemplates.set(axis, template); return template;
}

export function programRoofPart(region: RoofRegion, timberFinish = false): ProgramArchitecturePart {
  const { rect, bottom, top } = region;
  return { material: region.kind === 'gallery-flat' ? 'wood' : 'roof',
    position: { x: (rect.x0 + rect.x1) / 2, y: (bottom + top) / 2, z: (rect.z0 + rect.z1) / 2 },
    size: { x: rect.x1 - rect.x0, y: top - bottom, z: rect.z1 - rect.z0 },
    color: region.kind === 'gallery-flat' ? timberFinish ? '#795039' : '#806548' : timberFinish ? '#4f8a72' : '#3e5a55', floor: region.floor, roof: true, purpose: 'roof',
    ...(region.kind === 'gable' ? { template: programRoofTemplate(region.gableAxis!) } : {}) };
}

/** Far-LOD timber frame of timber-finish bodies (homes, shops, low banks): corner post width, how far a beam stands
 * proud of the wall, stud width and the widest bay between studs, beam height, and the near model's dark timber colour. */
export const FAR_TIMBER_FRAME = { post: .4, stud: .25, bay: 6, proud: .06, beam: .3, color: '#4b2f1e' } as const;
/** Null preserves every original emitter for all four historical layouts and
 * the landmark/pavilion. New bodies use the provider's rooms, holes, doors,
 * windows and exposed roofs; the far silhouette retains those same courts. */
/** `skipFixture` leaves a fixture's display to another renderer (a studio
 * asset); its solid and use point in the shared plan are unchanged. */
export function buildProgramArchitecture(building: Building, lod: 'near' | 'far', options: { skipFixture?: (fixture: FloorFixture) => boolean } = {}): ProgramArchitecturePart[] | null {
  const body = getBuildingBody(building); if (!body) return null;
  const parts: ProgramArchitecturePart[] = [];
  const commercial = building.commercialGeometryRevision === 1;
  // Low-rise banks (merchant houses, 5 storeys or fewer) share the timber-and-plaster finish of homes and shops.
  const timberFinish = building.kind === 'home' || building.kind === 'market' || building.kind === 'bank' && building.floors <= 5; let finishedPanels = 0;
  // A shared material hierarchy follows actual uses: warm lime plaster and
  // timber, neutral mineral plinths, dark jade tiles and cool modern alloy.
  // Seed variation stays within a use's family; it creates no new city identity.
  const wallColor = commercial ? '#adb5b3' : timberFinish ? building.kind === 'market' ? '#d2c3a4' : ['#e7e1d1', '#dfd8c6', '#ebe5d6', '#e2dccb'][building.seed % 4]
    : building.kind === 'clinic' ? '#d8d7c4' : building.kind === 'bank' ? '#c3b9a3' : building.kind === 'workshop' ? '#b4a086' : building.kind === 'school' ? '#d8c9a7' : ['#d3c09d', '#c1b498', '#d8c6a6', '#c8b18e'][building.seed % 4];
  const box = (material: ProgramArchitecturePart['material'], x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, floor: number, purpose: ProgramArchitecturePart['purpose'], roof = false, facade?: ProgramArchitecturePart['facade']) => {
    if (Math.min(sx, sy, sz) <= 1e-7) return;
    parts.push({ material, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, color, floor, purpose, roof, ...(facade ? { facade } : {}) });
  };
  const regions = (material: ProgramArchitecturePart['material'], regions: Parameters<typeof rectangleCover>[0], bottom: number, top: number, color: string, floor: number, purpose: ProgramArchitecturePart['purpose']) => {
    for (const r of rectangleCover(regions)) box(material, (r.x0 + r.x1) / 2, (bottom + top) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, top - bottom, r.z1 - r.z0, color, floor, purpose);
  };
  if (lod === 'far') {
    for (let i = 0; i < body.floorPlans.length;) {
      const first = body.floorPlans[i]; let end = i + 1;
      while (end < body.floorPlans.length && JSON.stringify(first.interior) === JSON.stringify(body.floorPlans[end].interior)) end++;
      const top = body.floorPlans[end - 1].ceilingY;
      for (const r of rectangleCover(first.interior)) {
        const width = r.x1 - r.x0, depth = r.z1 - r.z0;
        box(first.floor < 0 ? 'stone' : 'wall', (r.x0 + r.x1) / 2, (first.y + top) / 2, (r.z0 + r.z1) / 2,
          width, top - first.y, depth, first.floor < 0 ? '#939487' : wallColor, first.floor, 'body', false,
          first.floor < 0 ? undefined : [Math.max(2, Math.floor(width / 4.8)), end - i + .03, Math.min(.2, (commercial ? 3.6 : 1.6) / width), Math.min(.2, (commercial ? 3.6 : 1.6) / depth)]);
        // A timber-finish envelope keeps its frame from afar: dark corner posts, studs and floor-line beams.
        if (timberFinish && first.floor >= 0) {
          const { post, proud, beam } = FAR_TIMBER_FRAME, color = FAR_TIMBER_FRAME.color;
          for (const x of [r.x0, r.x1]) for (const z of [r.z0, r.z1]) box('wood', x, (first.y + top) / 2, z, post, top - first.y, post, color, first.floor, 'body');
          // Studs at most FAR_TIMBER_FRAME.bay apart along each side, so a blank end wall still reads as framed.
          const across = Math.ceil(width / FAR_TIMBER_FRAME.bay), along = Math.ceil(depth / FAR_TIMBER_FRAME.bay);
          for (let k = 1; k < across; k++) for (const z of [r.z0, r.z1]) box('wood', r.x0 + width * k / across, (first.y + top) / 2, z, FAR_TIMBER_FRAME.stud, top - first.y, proud * 2, color, first.floor, 'body');
          for (let k = 1; k < along; k++) for (const x of [r.x0, r.x1]) box('wood', x, (first.y + top) / 2, r.z0 + depth * k / along, proud * 2, top - first.y, FAR_TIMBER_FRAME.stud, color, first.floor, 'body');
          // A beam at each upper floor line; the ground line sits on the plinth.
          for (let k = first.floor === 0 ? i + 1 : i; k < end; k++) {
            const y = body.floorPlans[k].y + beam / 2;
            box('wood', (r.x0 + r.x1) / 2, y, r.z0, width + proud * 2, beam, proud * 2, color, body.floorPlans[k].floor, 'body');
            box('wood', (r.x0 + r.x1) / 2, y, r.z1, width + proud * 2, beam, proud * 2, color, body.floorPlans[k].floor, 'body');
            box('wood', r.x0, y, (r.z0 + r.z1) / 2, proud * 2, beam, depth, color, body.floorPlans[k].floor, 'body');
            box('wood', r.x1, y, (r.z0 + r.z1) / 2, proud * 2, beam, depth, color, body.floorPlans[k].floor, 'body');
          }
        }
      }
      i = end;
    }
    // The open court has the same walking plane and silhouette in both LODs.
    const ground = body.floorPlans.find(p => p.floor === 0)!;
    regions('stone', [...ground.courtyard, ...ground.circulation], ground.y - .2, ground.y, '#aaa38b', 0, 'floor');
  } else {
    for (const plan of body.floorPlans) {
      regions(plan.floor <= 0 || commercial ? 'stone' : 'wood', getFloorPlanSlabRegions(plan), plan.y - .2, plan.y,
        commercial ? '#a3a6a0' : plan.floor <= 0 ? '#aaa38b' : '#98704d', plan.floor, 'floor');
      for (const panel of wallPanels(plan)) {
        const r = panel.rect;
        const add = (material: ProgramArchitecturePart['material'], low: number, high: number, color: string, purpose: ProgramArchitecturePart['purpose']) => box(material,
          (r.x0 + r.x1) / 2, plan.y + (low + high) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, high - low, r.z1 - r.z0, color, plan.floor, purpose);
        if (panel.kind === 'glass') add('glass', panel.bottom, panel.top, commercial ? '#648c94' : '#648880', 'window');
        else {
          const skirt = Math.min(.8, panel.top);
          if (panel.bottom < skirt) add('stone', panel.bottom, skirt, timberFinish && plan.floor >= 0 ? '#8f9287' : '#939487', 'wall');
          const low = Math.max(panel.bottom, skirt);
          if (panel.top > low) {
            const finish = timberFinish && plan.floor >= 0 && finishedPanels < PROGRAM_WALL_FINISH_PANEL_BUDGET ? partitionProgramWallFinish(panel, low, panel.top) : null;
            if (finish && finish.length > 1) {
              finishedPanels++;
              for (const piece of finish) {
                const q = piece.rect;
                // Scratch: shophouses are boarded timber between dark posts; homes keep lime plaster in a dark frame.
                const boarded = building.kind === 'market' && piece.material === 'wall';
                box(boarded ? 'wood' : piece.material, (q.x0 + q.x1) / 2, plan.y + (piece.bottom + piece.top) / 2, (q.z0 + q.z1) / 2,
                  q.x1 - q.x0, piece.top - piece.bottom, q.z1 - q.z0, piece.material === 'wood' ? '#4b2f1e' : boarded ? '#835a39' : wallColor, plan.floor, 'wall');
              }
            } else add(plan.floor < 0 ? 'stone' : commercial ? 'metal' : 'wall', low, panel.top, wallColor, 'wall');
          }
        }
      }
      // The table, bed and counter solids also belong to the shared plan.
      // Their display changes no inventory, wages or interaction state.
      for (const fixture of getFloorPlanFixtures(building, plan)) {
        if (options.skipFixture?.(fixture)) continue;
        const r = fixture.rect, width = r.x1 - r.x0, depth = r.z1 - r.z0, { bottom, top } = fixture, height = top - bottom;
        const firstPart = parts.length;
        // These are resident structural batches, separate from the facade
        // detail budget. Each fixture has at most eight parts, all inside its
        // authoritative solid; no cloth or handle can extend into a use point.
        const furniture = (material: ProgramArchitecturePart['material'], x0: number, x1: number, low: number, high: number, z0: number, z1: number, color: string, facade?: ProgramArchitecturePart['facade']) => {
          if (parts.length - firstPart >= 8 || x0 < r.x0 - 1e-7 || x1 > r.x1 + 1e-7 || z0 < r.z0 - 1e-7 || z1 > r.z1 + 1e-7 || low < bottom - 1e-7 || high > top + 1e-7) return;
          const previous = parts.length;
          box(material, (x0 + x1) / 2, plan.y + (low + high) / 2, (z0 + z1) / 2, x1 - x0, high - low, z1 - z0, color, plan.floor, 'furniture', false, facade);
          if (material === 'fabric' && parts.length > previous) parts[parts.length - 1].template = programLinenTemplate();
        };
        if (fixture.kind === 'table' && height >= .4 && Math.min(width, depth) >= .4) {
          furniture('wood', r.x0, r.x1, top - .2, top, r.z0, r.z1, '#956f4f', [width, .2, depth, 2]);
          for (const xx of [r.x0, r.x1 - .2]) for (const zz of [r.z0, r.z1 - .2]) furniture('wood', xx, xx + .2, bottom, top - .2, zz, zz + .2, '#69523f');
          for (const zz of [r.z0, r.z1 - .2]) furniture('wood', r.x0, r.x1, top - .4, top - .2, zz, zz + .2, '#856246');
        } else if (fixture.kind === 'counter') {
          // The intact .8m cabinet and .2m top retain the existing physical
          // contract. Its wood material draws shallow drawer seams and pulls;
          // this is a procedural surface, not extra inventory or an openable door.
          furniture('wood', r.x0, r.x1, bottom, top - .2, r.z0, r.z1, '#806146', [width, height - .2, depth, 1]);
          furniture('wood', r.x0, r.x1, top - .2, top, r.z0, r.z1, '#ab8a62');
        } else if (fixture.kind === 'bed' && height >= .6 - 1e-7 && width >= 1.2 && depth >= .8) {
          furniture('wood', r.x0, r.x1, bottom, top - .4, r.z0, r.z1, '#6c513d');
          furniture('fabric', r.x0 + .2, r.x1 - .2, top - .4, top - .2, r.z0 + .2, r.z1 - .2, '#d7d0b9');
          for (const zz of [r.z0, r.z1 - .2]) furniture('wood', r.x0, r.x1, top - .4, top - .2, zz, zz + .2, '#8b6848');
          for (const xx of [r.x0, r.x1 - .2]) furniture('wood', xx, xx + .2, top - .4, top, r.z0, r.z1, '#8b6848');
          const quilt = ['#566c76', '#687962', '#97745d', '#666b86'][building.seed % 4];
          furniture('fabric', r.x0 + .8, r.x1 - .2, top - .2, top, r.z0 + .2, r.z1 - .2, quilt);
          furniture('fabric', r.x0 + .2, r.x0 + .6, top - .2, top, r.z0 + .2, r.z1 - .2, '#ebe3cb');
        } else {
          furniture('wood', r.x0, r.x1, bottom, top, r.z0, r.z1, '#846346');
        }
      }
      for (const surface of [...plan.stairTreads, ...plan.stairLandings]) {
        const r = surface.rect;
        box('stone', (r.x0 + r.x1) / 2, (surface.bottom + surface.top) / 2, (r.z0 + r.z1) / 2,
          r.x1 - r.x0, surface.top - surface.bottom, r.z1 - r.z0, '#a39a83', plan.floor, 'stairs');
      }
    }
  }
  for (const roof of getFloorPlanRoofRegions(body)) {
    const part = programRoofPart(roof, timberFinish);
    if (commercial) { part.material = roof.kind === 'gable' ? 'roof' : 'metal'; part.color = roof.kind === 'gable' ? '#344f51' : '#84938f'; }
    parts.push(part);
  }
  return parts;
}
