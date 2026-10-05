import * as THREE from 'three';
import { containsUnion } from '../architecture-floor-plan';
import type { FloorFixture, FloorPlan, WallPanel } from '../architecture-floor-plan';
import type { Vec3 } from '../types';
import type { ArchitectureTemplate, ProgramArchitecturePart } from './architecture-bodies';

export type InteriorPropAssetId = 'office-desk' | 'sofa' | 'coffee-table' | 'monitor' | 'open-curtains';
export interface InteriorPropAsset {
  id: InteriorPropAssetId;
  version: 'interior-props-v1';
  /** Metres, with a floor-centred local origin; y is height, z is depth. */
  dimensions: Vec3;
  logicalHull: { min: Vec3; max: Vec3 };
  parts: ProgramArchitecturePart[];
  /** An artwork asset cannot create an actor, item, service or interaction. */
  interaction: 'none';
  placement: 'prepared-unplaced';
}
export const HOME_CURTAIN_WINDOW_BUDGET = 2;
const templates = new Map<string, ArchitectureTemplate>();

function extrudedTemplate(key: string, outline: [number, number][], axis: 'x' | 'z' = 'x'): ArchitectureTemplate {
  const cached = templates.get(key); if (cached) return cached;
  const area = outline.reduce((sum, a, i) => { const b = outline[(i + 1) % outline.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0);
  if (area < 0) outline = [...outline].reverse();
  const positions: number[] = [], indices: number[] = [], n = outline.length;
  for (const y of [-.5, .5]) for (const [x, z] of outline) positions.push(...(axis === 'x' ? [x, y, z] : [-z, y, x]));
  const cap = THREE.ShapeUtils.triangulateShape(outline.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [a, b, c] of cap) indices.push(a, b, c, a + n, c + n, b + n);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(i, i + n, j, j, i + n, j + n); }
  const indexed = new THREE.BufferGeometry(); indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); indexed.setIndex(indices);
  const flat = indexed.toNonIndexed(); flat.computeVertexNormals();
  const vertices = Array.from(flat.getAttribute('position').array);
  const result: ArchitectureTemplate = { key, positions: vertices, normals: Array.from(flat.getAttribute('normal').array),
    uvs: vertices.flatMap((_, i) => i % 3 === 0 ? [axis === 'x' ? vertices[i] + .5 : vertices[i + 2] + .5, vertices[i + 1] + .5] : []),
    indices: Array.from({ length: vertices.length / 3 }, (_, i) => i) };
  indexed.dispose(); flat.dispose(); templates.set(key, result); return result;
}

/** Closed pleated cloth; both faces are physical artwork, not a two-sided
 * plane or displacement shader extending outside a sealed-window envelope. */
export function interiorCurtainTemplate(axis: 'x' | 'z'): ArchitectureTemplate {
  const front: [number, number][] = Array.from({ length: 7 }, (_, i) => [i / 6 - .5, (i % 2 ? .34 : -.34) + .1]);
  const back = front.map(([x, z]) => [x, z - .2] as [number, number]).reverse();
  return extrudedTemplate(`interior-curtain-pleats-${axis}-v1`, [...front, ...back], axis);
}

function part(material: ProgramArchitecturePart['material'], x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string,
  assetId: InteriorPropAssetId, template?: ArchitectureTemplate, facade?: ProgramArchitecturePart['facade']): ProgramArchitecturePart {
  return { material, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, color, floor: 0, roof: false, purpose: 'furniture',
    propAssetId: assetId, ...(template ? { template } : {}), ...(facade ? { facade } : {}) };
}

/** Standard-size original assets. Only explicit host adapters below place
 * them in the city. No model is evidence of inventory ownership or power. */
export function buildInteriorPropAsset(id: InteriorPropAssetId): InteriorPropAsset {
  let dimensions: Vec3, parts: ProgramArchitecturePart[];
  const box = (material: ProgramArchitecturePart['material'], x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string,
    template?: ArchitectureTemplate, facade?: ProgramArchitecturePart['facade']) => part(material, x, y, z, sx, sy, sz, color, id, template, facade);
  if (id === 'office-desk') {
    dimensions = { x: 2.4, y: .8, z: 1.2 };
    parts = [box('wood', 0, .7, 0, 2.4, .2, 1.2, '#a17b54', undefined, [2.4, .2, 1.2, 2]),
      box('wood', -.8, .3, -.1, .8, .6, 1, '#735139', undefined, [.8, .6, 1, 1]),
      box('wood', .9, .3, -.5, .2, .6, .2, '#644632'), box('wood', .9, .3, .5, .2, .6, .2, '#644632'),
      box('wood', 0, .4, -.5, 2.4, .4, .2, '#86623f'),
      ...[.1, .3, .5].map(y => box('metal', -.8, y, .46, .24, .04, .04, '#aaa58c'))];
  } else if (id === 'sofa') {
    dimensions = { x: 2.2, y: .8, z: .8 };
    const bevel = extrudedTemplate('interior-cushion-chamfer-v1', [[-.38, -.5], [.38, -.5], [.5, -.38], [.5, .38], [.38, .5], [-.38, .5], [-.5, .38], [-.5, -.38]]);
    parts = [box('wood', 0, .2, 0, 2.2, .2, .8, '#6c4c36'), box('cloth', 0, .6, -.3, 1.8, .4, .2, '#677766', bevel),
      box('cloth', -.45, .4, .05, .88, .2, .6, '#7b8b73', bevel), box('cloth', .45, .4, .05, .88, .2, .6, '#7b8b73', bevel),
      box('wood', -1, .45, 0, .2, .3, .8, '#8a6545'), box('wood', 1, .45, 0, .2, .3, .8, '#8a6545'),
      box('wood', -.85, .05, 0, .2, .1, .6, '#59422f'), box('wood', .85, .05, 0, .2, .1, .6, '#59422f')];
  } else if (id === 'coffee-table') {
    dimensions = { x: 1.2, y: .4, z: .8 };
    parts = [box('wood', 0, .35, 0, 1.2, .1, .8, '#9b734c', undefined, [1.2, .1, .8, 2]),
      ...[-.5, .5].flatMap(x => [-.3, .3].map(z => box('wood', x, .15, z, .2, .3, .2, '#6b4c35'))),
      box('wood', 0, .15, -.3, 1, .1, .2, '#806043'), box('wood', 0, .15, .3, 1, .1, .2, '#806043')];
  } else if (id === 'monitor') {
    dimensions = { x: .6, y: .6, z: .2 };
    // The dark panel deliberately contains no lit fake data or service UI.
    parts = [box('metal', 0, .45, 0, .6, .3, .08, '#364542'), box('glass', 0, .45, .045, .52, .24, .01, '#182d2b'),
      box('metal', 0, .18, 0, .08, .26, .08, '#6c7671'), box('metal', 0, .025, 0, .4, .05, .2, '#737b73')];
  } else {
    dimensions = { x: 2, y: 1.4, z: .2 };
    parts = [box('cloth', -.8, .65, 0, .4, 1.3, .14, '#b9a57d', interiorCurtainTemplate('x')),
      box('cloth', .8, .65, 0, .4, 1.3, .14, '#b9a57d', interiorCurtainTemplate('x')),
      box('wood', 0, 1.35, 0, 2, .1, .12, '#765338')];
  }
  return { id, version: 'interior-props-v1', dimensions,
    logicalHull: { min: { x: -dimensions.x / 2, y: 0, z: -dimensions.z / 2 }, max: { x: dimensions.x / 2, y: dimensions.y, z: dimensions.z / 2 } },
    parts, interaction: 'none', placement: 'prepared-unplaced' };
}

/** An office desk changes only the representation of an existing table.
 * Its full footprint/height stay inside that table's authoritative solid. */
export function officeDeskFixtureParts(fixture: FloorFixture, plan: Pick<FloorPlan, 'floor' | 'y'>): ProgramArchitecturePart[] {
  const { rect, bottom, top } = fixture, width = rect.x1 - rect.x0, depth = rect.z1 - rect.z0, height = top - bottom;
  if (fixture.kind !== 'table' || ![width, depth, height, plan.y].every(Number.isFinite) || width < 1.6 || depth < .8 || height < .6) return [];
  const asset = buildInteriorPropAsset('office-desk'), scale = { x: width / asset.dimensions.x, y: height / asset.dimensions.y, z: depth / asset.dimensions.z };
  return asset.parts.map(p => ({ ...p, floor: plan.floor, propHostId: fixture.id,
    position: { x: (rect.x0 + rect.x1) / 2 + p.position.x * scale.x, y: plan.y + bottom + p.position.y * scale.y, z: (rect.z0 + rect.z1) / 2 + p.position.z * scale.z },
    size: { x: p.size.x * scale.x, y: p.size.y * scale.y, z: p.size.z * scale.z },
    ...(p.facade ? { facade: [p.facade[0] * scale.x, p.facade[1] * scale.y, p.facade[2] * scale.z, p.facade[3]] as const } : {}) }));
}

/** Both folded panels and rail remain inside one existing sealed glass pane.
 * They keep a broad open centre, create no door, and add no physical fixture. */
export function windowCurtainParts(panel: WallPanel, plan: Pick<FloorPlan, 'floor' | 'y'>, hostId: string): ProgramArchitecturePart[] {
  const r = panel.rect, width = r.x1 - r.x0, depth = r.z1 - r.z0, height = panel.top - panel.bottom, alongX = width >= depth;
  const span = alongX ? width : depth, thickness = alongX ? depth : width;
  if (panel.kind !== 'glass' || ![width, depth, height, plan.y, panel.bottom, panel.top].every(Number.isFinite) || span < .8 || height < .6 || thickness < .08) return [];
  const asset = buildInteriorPropAsset('open-curtains'), sx = span / asset.dimensions.x, sy = height / asset.dimensions.y, sz = Math.min(thickness, .2) / asset.dimensions.z;
  return asset.parts.map(p => ({ ...p, floor: plan.floor, purpose: 'curtain', propHostId: hostId,
    position: { x: (r.x0 + r.x1) / 2 + (alongX ? p.position.x * sx : p.position.z * sz), y: plan.y + panel.bottom + p.position.y * sy,
      z: (r.z0 + r.z1) / 2 + (alongX ? p.position.z * sz : p.position.x * sx) },
    size: { x: alongX ? p.size.x * sx : p.size.z * sz, y: p.size.y * sy, z: alongX ? p.size.z * sz : p.size.x * sx },
    ...(p.template ? { template: interiorCurtainTemplate(alongX ? 'x' : 'z') } : {}) }));
}

/** The collision pane remains the original closed solid. Its rendered glass
 * is a closed thin layer at the actual exterior face, leaving the opaque cloth
 * visible from the room. A full opaque glass box would hide every curtain.
 * Ambiguous/interior-between-two-rooms panes keep the original representation.
 * Transport and all untargeted panes retain their existing geometry/material. */
export function windowGlassBackingTemplate(panel: WallPanel, plan: Pick<FloorPlan, 'interior'>): ArchitectureTemplate | null {
  if (panel.kind !== 'glass') return null;
  const r = panel.rect, width = r.x1 - r.x0, depth = r.z1 - r.z0, alongX = width >= depth;
  if (![width, depth, panel.bottom, panel.top].every(Number.isFinite) || Math.min(width, depth) < .08) return null;
  const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2, inset = Math.min(width, depth) / 2 + .2;
  const positive = containsUnion(plan.interior, x + (alongX ? 0 : inset), z + (alongX ? inset : 0));
  const negative = containsUnion(plan.interior, x - (alongX ? 0 : inset), z - (alongX ? inset : 0));
  if (positive === negative) return null;
  const side = positive ? -1 : 1, thinAxis = alongX ? 'z' : 'x', key = `interior-window-backing-${thinAxis}-${side}-v1`;
  const cached = templates.get(key); if (cached) return cached;
  const box = new THREE.BoxGeometry(1, 1, 1), position = box.getAttribute('position'), component = thinAxis === 'x' ? 0 : 2;
  for (let i = 0; i < position.count; i++) position.setComponent(i, component, position.getComponent(i, component) * .1 + side * .45);
  const template: ArchitectureTemplate = { key, positions: Array.from(position.array), normals: Array.from(box.getAttribute('normal').array),
    uvs: Array.from(box.getAttribute('uv').array), indices: Array.from(box.getIndex()!.array) };
  box.dispose(); templates.set(key, template); return template;
}
