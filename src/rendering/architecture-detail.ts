import * as THREE from 'three';
import { getFloorDimensions } from '../access';
import type { Building, Quality, Vec3 } from '../types';

export const ARCHITECTURE_DETAIL_DISTANCE = 180;
export const ARCHITECTURE_DETAIL_BUILDINGS = 8;
export const ARCHITECTURE_DETAIL_INSTANCES = 640;
export interface ArchitectureInterior { buildingId: string | null; floor?: number }
export interface ArchitectureDetailPart {
  position: Vec3; size: Vec3; color: string; floor: number; roof: boolean;
  purpose: 'door' | 'window' | 'frame' | 'bracket' | 'tile' | 'masonry' | 'program' | 'lantern' | 'sign';
  rotation?: [number, number, number]; luminous?: boolean;
}
interface DetailReference { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; floor: number; roof: boolean }
interface DetailEntry { group: THREE.Group; references: DetailReference[]; floor: number; quality: Quality; instanceCount: number; sign?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>; interiorKey: string }
const q = (number: number) => Math.round(number * 5) / 5;
const WOOD = '#75563c', EDGE = '#b89763', STONE = '#a1a394', DARK = '#42534a', TILE = '#69766a';

export interface ArchitectureFacadeWindow { face: 'front' | 'left' | 'right'; x: number; y: number; width: number; height: number; broad?: boolean }
/** Matches the existing structural renderer. Keeping its measurements together
 * also gives the future shared facade layout a single integration point. */
export function architectureFacadeLayout(building: Building, floor: number) {
  const { width, depth } = getFloorDimensions(building, floor), fh = building.height / Math.max(1, building.floors), y = floor * fh;
  const wallHeight = building.kind === 'core' && floor === building.floors - 1 ? 1.1 : Math.max(2.4, fh - .5);
  const doorWidth = Math.min(5, width * .22), doorHeight = Math.min(4.4, wallHeight * .72), windows: ArchitectureFacadeWindow[] = [];
  if (wallHeight > 1.1) {
    if (building.kind === 'core') for (const side of [-1, 1]) windows.push({ face: 'front', x: side * width * .23, y: y + fh * .52, width: width * .36, height: fh * .38, broad: true });
    else {
      const count = Math.max(2, Math.min(8, Math.floor(width / 5)));
      for (let n = 0; n < count; n++) {
        const x = -width * .4 + n * width * .8 / Math.max(1, count - 1), ww = Math.min(3.8, width / count * .78);
        // Include the sill's entire width in the shared entrance clearance.
        if (Math.abs(x) - ww / 2 - .4 >= doorWidth / 2 + .2) windows.push({ face: 'front', x, y: y + fh * .57, width: ww, height: Math.min(2.4, fh * .5) });
      }
    }
    for (const face of ['left', 'right'] as const) for (const z of [-depth * .3, 0, depth * .3]) windows.push({ face, x: z, y: y + fh * .57, width: Math.min(3.4, depth * .18), height: Math.min(2.4, fh * .5) });
  }
  return { width, depth, floorHeight: fh, y, wallHeight, doorWidth, doorHeight, windows };
}

/** Exact front edge of the current roof profile, not an invented roof laid over
 * the building. Flat glass roofs deliberately have no tile decoration. */
export function architectureRoofEdge(building: Building, floor: number) {
  const { width, depth, floorHeight: fh } = architectureFacadeLayout(building, floor);
  const period = building.kind === 'core' ? 6 : building.kind === 'home' ? 4 : building.kind === 'hall' || building.kind === 'school' ? 3 : building.floors;
  const top = floor === building.floors - 1, next = getFloorDimensions(building, Math.min(floor + 1, building.floors - 1));
  if (!top && (floor + 1) % period !== 0 && next.width === width) return null;
  if (building.kind === 'bank' || building.kind === 'clinic') return null;
  const rw = width * (top ? 1 : 1.035), rd = depth * (top ? 1 : 1.035), yy = (floor + 1) * fh;
  const gabled = ['home', 'farm', 'market', 'dock'].includes(building.kind) || building.kind === 'workshop' && building.districtId !== 'core';
  const overhang = gabled ? 1.5 : Math.max(2, Math.min(12, (building.kind === 'station' || building.kind === 'airport' ? rw * .3 : rw) * .14));
  return { y: yy, z: (building.kind === 'dock' ? rd * .7 : rd) / 2 + overhang, width: rw, fasciaZ: (building.kind === 'dock' ? rd * .7 : rd) / 2 + (gabled ? 1.2 : overhang * .65), gabled };
}

export function architectureSignPlacement(building: Building) {
  const { doorWidth, doorHeight } = architectureFacadeLayout(building, 0);
  return building.kind === 'pavilion'
    ? { x: 0, y: building.height * .72, z: building.depth * .4 + .65, width: q(Math.min(3.2, building.width * .28)), height: .8, vertical: false }
    : { x: -(doorWidth / 2 + 2.6), y: Math.max(2.2, doorHeight - .2), z: building.depth / 2 + .7, width: 1, height: q(Math.min(3.2, Math.max(2.4, doorHeight + .2))), vertical: true };
}

export function architectureFunctionLabel(building: Building): string {
  if (building.facility) return ({ mayor: '市长官署', council: '议政听证', administration: '政务受理', data: '城市数据', energy: '能源调度', emergency: '应急指挥', embassy: '使节接待', archives: '档案阅览', treasury: '城市金库' })[building.facility];
  return ({ home: '家居 · 住宅', market: '买卖 · 食材', workshop: '百工 · 制造', bank: '钱庄 · 金融', hall: '公厅 · 政务', police: '巡警 · 治安', school: '学苑 · 课堂', clinic: '医馆 · 诊疗', station: '驿站 · 乘车', core: '天枢 · 市政', pavilion: '山亭 · 观景', airport: '空港 · 航班', starport: '星港 · 星际', farm: '农庄 · 田作', dock: '水驿 · 渡船' })[building.kind];
}

/** Geometry is generated for a nearby floor band, never for the whole city.
 * All coordinates are local to the existing building's structural base. */
export function buildArchitectureDetails(building: Building, nearFloor = 0, limit = ARCHITECTURE_DETAIL_INSTANCES): ArchitectureDetailPart[] {
  const parts: ArchitectureDetailPart[] = [], ground = architectureFacadeLayout(building, 0), fh = ground.floorHeight;
  const box = (purpose: ArchitectureDetailPart['purpose'], x: number, y: number, z: number, sx: number, sy: number, sz: number, color = WOOD, floor = 0, roof = false, rotation?: [number, number, number], luminous = false) => {
    if (parts.length >= limit || Math.min(sx, sy, sz) <= 0) return;
    parts.push({ purpose, position: { x: q(x), y: q(y), z: q(z) }, size: { x: Math.max(.2, q(sx)), y: Math.max(.2, q(sy)), z: Math.max(.2, q(sz)) }, color, floor, roof, ...(rotation ? { rotation } : {}), ...(luminous ? { luminous } : {}) });
  };
  const w = ground.width, d = ground.depth, { doorWidth, doorHeight } = ground, front = d / 2;
  const lantern = (x: number, y: number, z: number) => {
    box('lantern', x, y, z, .6, .8, .6, '#e7bc73', 0, false, undefined, true);
    for (const level of [-.5, .5]) box('lantern', x, y + level, z, .8, .2, .8, '#7c3e32');
    for (const xx of [-.3, .3]) box('lantern', x + xx, y, z + .4, .2, .8, .2, WOOD);
    box('lantern', x, y - .7, z, .2, .4, .2, '#a66446');
  };
  if (building.kind === 'pavilion') {
    for (const x of [-w * .4, w * .4]) for (const z of [-d * .4, d * .4]) {
      box('masonry', x, .2, z, 1.8, .4, 1.8, STONE);
      box('masonry', x, .5, z, 1.4, .2, 1.4, EDGE);
      const yy = building.height * .78;
      box('bracket', x, yy - .8, z, 1.2, .4, 1.2, WOOD, 0, true);
      box('bracket', x, yy - .45, z, 1.8, .2, 1.8, EDGE, 0, true);
      box('bracket', x, yy - .65, z + .6, .2, 1.4, .2, EDGE, 0, true, [Math.PI / 4, 0, 0]);
    }
    for (const side of [-1, 1]) for (let n = -3; n <= 3; n++) box('program', side * w * .32, 1.5, n * Math.min(.8, d / 10), .2, .8, .2, WOOD);
    return parts;
  }
  // Open leaves lie flat against the wall. No new threshold or object occupies
  // the six-metre approach to the authoritative south opening.
  for (const side of [-1, 1]) {
    const x = side * (doorWidth / 2 + .4);
    box('door', x, doorHeight / 2, front + .4, .4, doorHeight, .6, WOOD);
    box('door', x, .2, front + .4, .8, .4, .8, STONE);
    box('door', x, doorHeight + .1, front + .4, .8, .4, .8, EDGE);
    box('door', x, 1.2, front + .7, .2, .4, .2, EDGE);
    const leaf = side * (doorWidth / 2 + 1.2);
    for (let slat = 0; slat < 3; slat++) box('door', leaf + (slat - 1) * .4, doorHeight / 2, front + .35, .2, doorHeight - .4, .2, slat === 1 ? EDGE : WOOD);
    for (const height of [.6, Math.max(.8, doorHeight - .6)]) box('door', leaf, height, front + .45, 1.2, .2, .2, WOOD);
  }
  box('door', 0, doorHeight + .5, front + .4, doorWidth + 1.4, .4, 1, EDGE);
  box('door', 0, doorHeight + .75, front + .4, doorWidth + 2, .2, 1.4, WOOD);
  // The narrow shop/residence plaque is a physical framed object, attached to a
  // timber arm beside the door rather than facing the camera as a giant label.
  const sign = architectureSignPlacement(building);
  box('sign', sign.x, sign.y, sign.z - .2, sign.width + .2, sign.height + .2, .2, WOOD);
  for (const side of [-1, 1]) box('sign', sign.x + side * (sign.width / 2 + .1), sign.y, sign.z, .2, sign.height + .4, .2, EDGE);
  for (const yy of [-1, 1]) box('sign', sign.x, sign.y + yy * (sign.height / 2 + .1), sign.z, sign.width + .4, .2, .2, EDGE);
  box('sign', sign.x, sign.y + sign.height / 2 + .4, front + .35, .2, .2, 1, WOOD);
  // A wall-side lantern post stays in the existing solid-wall collision strip.
  // It adds pedestrian scale without inventing a free-standing street obstacle.
  const lampX = Math.max(doorWidth / 2 + 4.2, Math.min(w * .42, w / 2 - 1)), lampZ = front + .3;
  box('lantern', lampX, .2, lampZ, .6, .4, .6, STONE);
  box('lantern', lampX, 2, lampZ, .2, 3.8, .2, DARK);
  box('lantern', lampX - .3, 3.9, lampZ + .2, .8, .2, .6, WOOD);
  lantern(lampX - .6, 3.1, lampZ + .25);
  const doorLampX = doorWidth / 2 + 2.6;
  box('lantern', doorLampX, Math.max(2.2, doorHeight) + .2, front + .3, .2, .2, .8, WOOD);
  lantern(doorLampX, Math.max(1.8, doorHeight - .6), front + .6);

  // A continuous low stone skirt supports the timber bays. Small relief blocks
  // cover only the central nearby facade instead of tiling the whole city.
  const stoneSpan = (w - doorWidth - 1.2) / 2;
  for (const side of [-1, 1]) box('masonry', side * (doorWidth / 2 + .6 + stoneSpan / 2), .4, front + .1, stoneSpan, .8, .4, STONE);
  for (const side of [-1, 1]) box('masonry', side * (w / 2 + .1), .4, 0, .4, .8, d, STONE);
  const stoneColumns = Math.min(30, Math.floor(w / 1.2));
  for (let row = 0; row < 2; row++) for (let n = 0; n < stoneColumns; n++) {
    const x = (n - (stoneColumns - 1) / 2) * 1.2 + (row ? .4 : 0);
    if (Math.abs(x) < doorWidth / 2 + .8) continue;
    box('masonry', x, .2 + row * .4, front + .4, 1, .2, .2, (n + row + building.seed) % 3 ? '#b7b4a0' : '#858d82');
  }
  for (const side of [-1, 1]) {
    const bay = side * Math.max(doorWidth / 2 + 3, w * .3);
    if (building.kind === 'home') {
      // Household objects attach to the existing wall and balcony strip. The
      // central public approach and actual doorway remain completely open.
      const xx = side * Math.max(doorWidth / 2 + 3.8, w * .34), zz = front + .3;
      box('program', xx, .4, zz, 1.2, .6, .4, building.seed % 2 ? '#956248' : '#788070');
      box('program', xx, .75, zz, 1.4, .2, .6, '#b3916d');
      for (const stem of [-.4, 0, .4]) {
        box('program', xx + stem, 1.05, zz, .2, .4, .2, '#61764b');
        box('program', xx + stem, 1.25 + (stem === 0 ? .2 : 0), zz + .1, .4, .2, .2, building.seed % 3 ? '#9f715c' : '#c6ab65');
      }
      if (side < 0 && building.seed % 2 === 0) {
        box('program', xx, 2.7, zz, 2.8, .2, .2, WOOD);
        for (let item = 0; item < 3; item++) {
          box('program', xx + (item - 1) * .8, 2.05, zz, .6, 1, .2, ['#748b7c', '#c4b493', '#8e9aa0'][item]);
          box('program', xx + (item - 1) * .8, 2.65, zz, .2, .2, .2, EDGE);
        }
      }
    } else if (building.kind === 'market') {
      for (let n = -3; n <= 3; n++) box('program', bay + n * .4, 1.05, front + 2.1, .2, 1.4, .2, n % 2 ? WOOD : EDGE);
      for (const y of [.4, 1.7]) box('program', bay, y, front + 2.2, 3.2, .2, .4, WOOD);
      box('program', bay, 3.35, front + 4.5, 3.2, .2, .2, EDGE);
      for (let n = -2; n <= 2; n++) box('program', bay + n * .6, 3.15, front + 4.5, .4, .4, .2, n % 2 ? '#c4a16b' : '#846548');
      for (let crate = 0; crate < 3; crate++) for (let item = 0; item < 4; item++) box('program', bay + (crate - 1) * 1.3 + (item % 2 - .5) * .2, 2.4 + Math.floor(item / 2) * .2, front + 1.4, .2, .2, .2, crate === 0 ? '#aa654d' : crate === 1 ? '#bfa063' : '#73874d');
    } else if (building.kind === 'workshop' || building.kind === 'farm' || building.kind === 'dock') {
      for (const x of [-1.3, 1.3]) box('program', bay + x, 1.4, front + 3.1, .2, 2.8, .2, WOOD);
      for (const y of [.5, 1.3, 2.2]) { box('program', bay, y, front + 3.1, 3, .2, 1, EDGE); for (let slat = -2; slat <= 2; slat++) box('program', bay + slat * .6, y + .3, front + 3.45, .4, .4, .4, '#9c8660'); }
    } else if (['hall', 'core', 'police', 'school', 'bank'].includes(building.kind)) {
      const x = side * Math.max(doorWidth / 2 + 2, Math.min(w * .2, 12));
      for (const y of [.3, .6]) box('program', x, y, front + 1.5, 1.4 - y, .2, 1.4 - y, STONE);
      box('program', x, doorHeight + .2, front + 1.5, 1.2, .2, 1.2, EDGE);
      box('program', x, doorHeight - .15, front + 1.5, .8, .4, .8, WOOD);
    } else if (building.kind === 'clinic') {
      box('program', bay, 2, front + .5, .4, 2, .2, '#a95644'); box('program', bay, 2, front + .5, 1.6, .4, .2, '#a95644');
    }
  }

  const center = THREE.MathUtils.clamp(Math.floor(nearFloor), 0, Math.max(0, building.floors - 1));
  const selected = [...new Set([center, center + 1, center - 1])].filter(floor => floor >= 0 && floor < building.floors).slice(0, building.kind === 'core' ? 2 : 3);
  for (const floor of selected) {
    const layout = architectureFacadeLayout(building, floor), { width, depth, y, wallHeight, windows } = layout;
    const faceBox = (purpose: 'frame' | 'window', face: ArchitectureFacadeWindow['face'], x: number, yy: number, offset: number, sx: number, sy: number, sz: number, color = WOOD) => {
      if (face === 'front') box(purpose, x, yy, depth / 2 + offset, sx, sy, sz, color, floor);
      else box(purpose, (face === 'left' ? -1 : 1) * (width / 2 + offset), yy, x, sz, sy, sx, color, floor);
    };
    // Full-height posts and a head beam share the window's bay. Upper diagonal
    // braces terminate at those same posts; they are not isolated roof trinkets.
    for (const window of windows.filter(window => window.face === 'front')) {
      const half = window.width / 2 + .6, postHeight = Math.max(.4, wallHeight - .8);
      for (const side of [-1, 1]) {
        const x = window.x + side * half;
        if (Math.abs(x) - .3 < layout.doorWidth / 2 + .2) continue;
        faceBox('frame', 'front', x, y + .8 + postHeight / 2, .35, .4, postHeight, .4);
        if (floor === 0) faceBox('frame', 'front', x, .9, .35, .6, .2, .6, STONE);
        box('bracket', x - side * .3, y + wallHeight - .5, depth / 2 + .5, .2, .8, .2, EDGE, floor, false, [0, 0, side * Math.PI / 4]);
      }
      faceBox('frame', 'front', window.x, y + wallHeight - .1, .38, window.width + 1.6, .2, .6, WOOD);
      if (building.kind === 'home' || building.kind === 'workshop' || building.kind === 'farm' || building.kind === 'school') {
        const apronHeight = Math.min(.8, Math.max(.2, window.y - window.height / 2 - y - .8));
        faceBox('frame', 'front', window.x, y + .8 + apronHeight / 2, .34, window.width + .4, apronHeight, .2, building.kind === 'school' ? DARK : WOOD);
        faceBox('frame', 'front', window.x, y + .8 + apronHeight, .5, window.width + .6, .2, .4, EDGE);
      }
    }
    for (const window of windows) {
      // Side grids on the camera's floor, with one bay on adjacent floors,
      // preserve the near-floor composition within the fixed instance budget.
      if (window.face !== 'front' && floor !== center && window.x !== 0) continue;
      const { face, x, y: cy, width: ww, height: hh, broad } = window;
      for (const edge of [-1, 1]) { faceBox('window', face, x + edge * ww / 2, cy, .46, .2, hh + .4, .2); faceBox('window', face, x, cy + edge * hh / 2, .46, ww + .4, .2, .2); }
      const divisions = broad ? Math.min(12, Math.max(3, Math.floor(ww / 2.4))) : 3;
      for (let n = 1; n < divisions; n++) faceBox('window', face, x - ww / 2 + n * ww / divisions, cy, .48, .2, hh, .2, EDGE);
      for (const level of [-.22, .22]) faceBox('window', face, x, cy + level * hh, .48, ww, .2, .2, EDGE);
      faceBox('window', face, x, cy - hh / 2 - .3, .58, ww + .6, .2, .4, STONE);
      faceBox('window', face, x, cy + hh / 2 + .3, .6, ww + .6, .2, .6, WOOD);
    }
    const roofEdge = architectureRoofEdge(building, floor);
    if (roofEdge) {
      // Fine eave pieces attach to the real profile's front edge. The structural
      // roof remains untouched; there is no second floating decorative roof.
      const span = Math.min(12, width * .6), tiles = Math.floor(span / .6);
      box('tile', 0, roofEdge.y + .1, roofEdge.fasciaZ + .1, span + .8, .2, .2, WOOD, floor, true);
      for (let tile = 0; tile < tiles; tile++) {
        const x = (tile - (tiles - 1) / 2) * .6;
        box('tile', x, roofEdge.y + .65, roofEdge.z, .4, .2, .8, tile % 3 ? TILE : '#829080', floor, true);
        box('tile', x, roofEdge.y + .8, roofEdge.z - .2, .2, .2, .6, TILE, floor, true);
      }
      for (const column of [-.38, -.2, .2, .38]) {
        const x = width * column, z = depth / 2 + .25;
        box('bracket', x, roofEdge.y - .5, z, .6, .2, .6, WOOD, floor, true);
        box('bracket', x, roofEdge.y - .3, z + .3, 1, .2, 1, EDGE, floor, true);
        box('bracket', x, roofEdge.y - .5, z + .4, .2, .8, .2, EDGE, floor, true, [Math.PI / 4, 0, 0]);
      }
    }
  }
  return parts;
}

/** Owns only lazily generated decoration; it never edits world/collision data. */
export class ArchitectureDetailManager {
  readonly group = new THREE.Group();
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly solid = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .82, metalness: .025 });
  private readonly light = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e4a956', emissiveIntensity: .42, roughness: .65 });
  private readonly entries = new Map<string, DetailEntry>();
  private created = 0;
  private released = 0;
  private disposed = false;
  private lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  private lastSelection = '';
  constructor(private readonly buildings: readonly Building[]) { this.group.name = '建筑近景 · 按距离生成'; }

  update(camera: Vec3, interior: ArchitectureInterior = { buildingId: null }, quality: Quality = 'balanced'): void {
    if (this.disposed) return;
    const selection = `${quality}:${interior.buildingId}:${interior.floor ?? 0}`;
    if (selection === this.lastSelection && this.lastCamera.distanceToSquared(camera) < .64) return;
    this.lastSelection = selection; this.lastCamera.set(camera.x, camera.y, camera.z);
    const candidates = this.buildings.map(building => {
      const fh = building.height / Math.max(1, building.floors), floor = THREE.MathUtils.clamp(Math.floor((camera.y - building.position.y - .6) / fh), 0, building.floors - 1);
      const dimension = getFloorDimensions(building, floor), dx = camera.x - building.position.x, dz = camera.z - building.position.z, c = Math.cos(building.rotation), s = Math.sin(building.rotation);
      const x = dx * c - dz * s, z = dx * s + dz * c;
      const distance = Math.hypot(Math.max(0, Math.abs(x) - dimension.width / 2 - 7), Math.max(0, Math.abs(z) - dimension.depth / 2 - 7), Math.max(0, building.position.y - camera.y, camera.y - building.position.y - building.height - 10));
      return { building, floor, distance };
    }).filter(candidate => candidate.distance <= ARCHITECTURE_DETAIL_DISTANCE).sort((a, b) => a.distance - b.distance || a.building.id.localeCompare(b.building.id)).slice(0, quality === 'low' ? 4 : ARCHITECTURE_DETAIL_BUILDINGS);
    const desired = new Set(candidates.map(candidate => candidate.building.id));
    for (const id of this.entries.keys()) if (!desired.has(id)) this.release(id);
    for (const { building, floor } of candidates) {
      let entry = this.entries.get(building.id);
      if (entry && (entry.floor !== floor || entry.quality !== quality)) { this.release(building.id); entry = undefined; }
      if (!entry) { entry = this.create(building, floor, quality); this.entries.set(building.id, entry); this.group.add(entry.group); this.created++; }
      const activeFloor = interior.buildingId === building.id ? interior.floor ?? 0 : null, key = String(activeFloor);
      if (entry.interiorKey !== key) {
        const ceiling = activeFloor !== null && activeFloor < 0 ? activeFloor + 1 : activeFloor;
        for (const reference of entry.references) {
          const hidden = activeFloor !== null && (reference.floor > ceiling! || reference.roof && reference.floor >= activeFloor);
          reference.mesh.setMatrixAt(reference.index, hidden ? new THREE.Matrix4().makeScale(0, 0, 0) : reference.matrix);
          reference.mesh.instanceMatrix.needsUpdate = true;
        }
        if (entry.sign) entry.sign.visible = activeFloor === null || activeFloor >= 0;
        entry.interiorKey = key;
      }
    }
    this.group.userData = this.getStats();
  }

  setLighting(daylight: number, power: number): void {
    if (this.disposed) return;
    this.light.emissiveIntensity = THREE.MathUtils.clamp(power, 0, 1) * (.08 + (1 - THREE.MathUtils.clamp(daylight, 0, 1)) * 1.7);
    this.group.userData = this.getStats();
  }

  getStats() { return { activeBuildings: this.entries.size, activeBuildingIds: [...this.entries.keys()], instances: [...this.entries.values()].reduce((sum, entry) => sum + entry.instanceCount, 0), created: this.created, released: this.released, maxBuildings: ARCHITECTURE_DETAIL_BUILDINGS, maxInstancesPerBuilding: ARCHITECTURE_DETAIL_INSTANCES, loadDistance: ARCHITECTURE_DETAIL_DISTANCE, lanternEmission: this.light.emissiveIntensity }; }

  private create(building: Building, floor: number, quality: Quality): DetailEntry {
    const parts = buildArchitectureDetails(building, floor, quality === 'low' ? 384 : quality === 'high' ? 640 : 576);
    const group = new THREE.Group(); group.name = `细部 · ${building.name}`; group.position.set(building.position.x, building.position.y + .6, building.position.z); group.rotation.y = building.rotation;
    const references: DetailReference[] = [];
    for (const luminous of [false, true]) {
      const selected = parts.filter(part => !!part.luminous === luminous); if (!selected.length) continue;
      const mesh = new THREE.InstancedMesh(this.cube, luminous ? this.light : this.solid, selected.length); mesh.name = luminous ? '灯笼暖光' : '木构开间 · 窗棂 · 斗拱 · 砖石 · 门牌';
      selected.forEach((part, index) => {
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0])));
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(part.position.x, part.position.y, part.position.z), rotation, new THREE.Vector3(part.size.x, part.size.y, part.size.z));
        mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, new THREE.Color(part.color)); references.push({ mesh, index, matrix, floor: part.floor, roof: part.roof });
      });
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh);
    }
    const entry: DetailEntry = { group, references, floor, quality, instanceCount: parts.length, interiorKey: '' };
    if (typeof document !== 'undefined') {
      const placement = architectureSignPlacement(building);
      const canvas = document.createElement('canvas'); canvas.width = placement.vertical ? 512 : 768; canvas.height = placement.vertical ? 1024 : 192; const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#dcd1ac'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = '#6e5238'; context.lineWidth = 9; context.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
        context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#4c3928';
        if (placement.vertical) {
          const characters = Array.from(building.name), step = Math.min(90, 900 / Math.max(1, characters.length));
          context.font = `600 ${Math.min(82, step * .85)}px "Noto Serif CJK SC", serif`;
          characters.forEach((character, index) => context.fillText(character, 342, 64 + step * (index + .5), 142));
          const functionName = architectureFunctionLabel(building).split('·').at(-1)!.trim();
          context.font = '500 66px "Noto Serif CJK SC", serif';
          Array.from(functionName).forEach((character, index) => context.fillText(character, 146, 100 + index * 88, 130));
          context.strokeStyle = '#875b42'; context.lineWidth = 7; context.strokeRect(86, 810, 118, 118);
          context.font = '500 48px "Noto Serif CJK SC", serif'; context.fillStyle = '#875b42'; context.fillText('云', 145, 870, 100);
        } else {
          context.font = '600 54px "Noto Serif CJK SC", serif'; context.fillText(building.name, 384, 68, 706);
          context.font = '400 34px "Noto Sans CJK SC", sans-serif'; context.fillText(architectureFunctionLabel(building), 384, 136, 706);
        }
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 1;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(placement.width, placement.height), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })); sign.name = `门牌 · ${architectureFunctionLabel(building)}`;
        sign.position.set(placement.x, placement.y, placement.z + .12); group.add(sign); entry.sign = sign;
      }
    }
    return entry;
  }

  private release(id: string): void {
    const entry = this.entries.get(id); if (!entry) return;
    this.group.remove(entry.group);
    for (const object of entry.group.children) if (object instanceof THREE.InstancedMesh) object.dispose();
    if (entry.sign) { entry.sign.geometry.dispose(); entry.sign.material.map?.dispose(); entry.sign.material.dispose(); }
    entry.group.clear(); this.entries.delete(id); this.released++;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const id of this.entries.keys()) this.release(id);
    this.cube.dispose(); this.solid.dispose(); this.light.dispose(); this.group.removeFromParent(); this.group.clear(); this.disposed = true;
  }
}
