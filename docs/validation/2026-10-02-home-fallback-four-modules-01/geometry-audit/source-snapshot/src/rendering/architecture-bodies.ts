import * as THREE from 'three';
import type { Building, Vec3 } from '../types';
import { getBuildingBody, getFloorPlanFixtures, getFloorPlanRoofRegions, getFloorPlanSlabRegions, rectangleCover, wallPanels, type RoofRegion } from '../architecture-floor-plan';

/** Normalized, centre-anchored geometry; one template per roof orientation.
 * Its final instance bounds, rather than a second proxy envelope, describe the
 * actual shared roof region. Buffers belong to each resident material batch. */
export interface ArchitectureTemplate {
  key: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[];
}
export interface ProgramArchitecturePart {
  material: 'wall' | 'stone' | 'wood' | 'roof' | 'glass' | 'amber' | 'cyan' | 'red';
  position: Vec3; size: Vec3; color: string; floor: number; roof: boolean;
  purpose: 'floor' | 'wall' | 'window' | 'body' | 'roof' | 'furniture' | 'stairs';
  template?: ArchitectureTemplate; facade?: readonly [number, number, number, number];
}
const roofTemplates = new Map<string, ArchitectureTemplate>();

/** The original prototype's two closed five-point gables, converted from
 * [0,1] minimum-corner coordinates to the batch's [-.5,.5] centred coordinates.
 * Flat face normals prevent the ridge from looking like a rounded plastic cap. */
export function programRoofTemplate(axis: 'x' | 'z'): ArchitectureTemplate {
  const cached = roofTemplates.get(axis); if (cached) return cached;
  const contour = [[0, 0], [1, 0], [1, 1 / 3], [.5, 1], [0, 1 / 3]];
  const positions: number[] = [], indices: number[] = [];
  for (const end of [0, 1]) for (const [span, height] of contour) positions.push(...(axis === 'x' ? [span - .5, height - .5, end - .5] : [end - .5, height - .5, span - .5]));
  const caps = THREE.ShapeUtils.triangulateShape(contour.map(([x, y]) => new THREE.Vector2(x, y)), []);
  for (const [a, b, c] of caps) indices.push(a, c, b, 5 + a, 5 + b, 5 + c);
  for (let i = 0; i < 5; i++) { const next = (i + 1) % 5; indices.push(i, next, 5 + i, next, 5 + next, 5 + i); }
  // Extruding along x reverses the contour's orientation.
  if (axis === 'z') for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); indexed.setIndex(indices);
  const flat = indexed.toNonIndexed(); flat.computeVertexNormals();
  const vertices = Array.from(flat.getAttribute('position').array), normals = Array.from(flat.getAttribute('normal').array);
  const uvs = vertices.flatMap((_, i) => i % 3 === 0 ? [vertices[i] + .5, vertices[i + 2] + .5] : []);
  const template = { key: `program-gable-${axis}-1`, positions: vertices, normals, uvs, indices: vertices.map((_, i) => i).filter(i => i < vertices.length / 3) };
  indexed.dispose(); flat.dispose(); roofTemplates.set(axis, template); return template;
}

export function programRoofPart(region: RoofRegion): ProgramArchitecturePart {
  const { rect, bottom, top } = region;
  return { material: region.kind === 'gallery-flat' ? 'wood' : 'roof',
    position: { x: (rect.x0 + rect.x1) / 2, y: (bottom + top) / 2, z: (rect.z0 + rect.z1) / 2 },
    size: { x: rect.x1 - rect.x0, y: top - bottom, z: rect.z1 - rect.z0 },
    color: region.kind === 'gallery-flat' ? '#887155' : '#456760', floor: region.floor, roof: true, purpose: 'roof',
    ...(region.kind === 'gable' ? { template: programRoofTemplate(region.gableAxis!) } : {}) };
}

/** Null preserves every original emitter for all four historical layouts and
 * the landmark/pavilion. New bodies use the provider's rooms, holes, doors,
 * windows and exposed roofs; the far silhouette retains those same courts. */
export function buildProgramArchitecture(building: Building, lod: 'near' | 'far'): ProgramArchitecturePart[] | null {
  const body = getBuildingBody(building); if (!body) return null;
  const parts: ProgramArchitecturePart[] = [];
  const wallColor = building.kind === 'clinic' ? '#dad9c5' : building.kind === 'bank' ? '#b5beb2' : building.kind === 'workshop' ? '#b5a58c' : building.kind === 'school' ? '#d9ceb0' : ['#d6c6a7', '#c3bea3', '#ddcfb0', '#ccba9c'][building.seed % 4];
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
          first.floor < 0 ? undefined : [Math.max(2, Math.floor(width / 4.8)), end - i + .03, Math.min(.2, 1.6 / width), Math.min(.2, 1.6 / depth)]);
      }
      i = end;
    }
    // The open court has the same walking plane and silhouette in both LODs.
    const ground = body.floorPlans.find(p => p.floor === 0)!;
    regions('stone', [...ground.courtyard, ...ground.circulation], ground.y - .2, ground.y, '#aaa38b', 0, 'floor');
  } else {
    for (const plan of body.floorPlans) {
      regions(plan.floor <= 0 ? 'stone' : 'wood', getFloorPlanSlabRegions(plan), plan.y - .2, plan.y,
        plan.floor <= 0 ? '#aaa38b' : '#937354', plan.floor, 'floor');
      for (const panel of wallPanels(plan)) {
        const r = panel.rect;
        const add = (material: ProgramArchitecturePart['material'], low: number, high: number, color: string, purpose: ProgramArchitecturePart['purpose']) => box(material,
          (r.x0 + r.x1) / 2, plan.y + (low + high) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, high - low, r.z1 - r.z0, color, plan.floor, purpose);
        if (panel.kind === 'glass') add('glass', panel.bottom, panel.top, '#738c7e', 'window');
        else {
          const skirt = Math.min(.8, panel.top);
          if (panel.bottom < skirt) add('stone', panel.bottom, skirt, '#939487', 'wall');
          if (panel.top > Math.max(panel.bottom, skirt)) add(plan.floor < 0 ? 'stone' : 'wall', Math.max(panel.bottom, skirt), panel.top, wallColor, 'wall');
        }
      }
      // The table, bed and counter solids also belong to the shared plan.
      // Their display changes no inventory, wages or interaction state.
      for (const fixture of getFloorPlanFixtures(building, plan)) {
        const r = fixture.rect, x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2, width = r.x1 - r.x0, depth = r.z1 - r.z0;
        if (fixture.kind === 'table') {
          box('wood', x, plan.y + fixture.top - .1, z, width, .2, depth, '#846346', plan.floor, 'furniture');
          for (const dx of [-1, 1]) box('wood', x + dx * (width / 2 - .2), plan.y + fixture.top / 2 - .1, z, .2, fixture.top - .2, depth - .2, '#69523f', plan.floor, 'furniture');
        } else if (fixture.kind === 'counter') {
          box('wood', x, plan.y + (fixture.bottom + fixture.top - .2) / 2, z, width, fixture.top - fixture.bottom - .2, depth, '#806146', plan.floor, 'furniture');
          box('wood', x, plan.y + fixture.top - .1, z, width, .2, depth, '#ab8a62', plan.floor, 'furniture');
        } else {
          box('wood', x, plan.y + (fixture.bottom + fixture.top) / 2, z, width, fixture.top - fixture.bottom, depth, '#846346', plan.floor, 'furniture');
          if (fixture.kind === 'bed') box('wall', x, plan.y + fixture.top - .1, z, width, .2, depth, '#d4cdb5', plan.floor, 'furniture');
        }
      }
      for (const surface of [...plan.stairTreads, ...plan.stairLandings]) {
        const r = surface.rect;
        box('stone', (r.x0 + r.x1) / 2, (surface.bottom + surface.top) / 2, (r.z0 + r.z1) / 2,
          r.x1 - r.x0, surface.top - surface.bottom, r.z1 - r.z0, '#a39a83', plan.floor, 'stairs');
      }
    }
  }
  for (const roof of getFloorPlanRoofRegions(body)) parts.push(programRoofPart(roof));
  return parts;
}
