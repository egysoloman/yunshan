import * as THREE from 'three';
import { getFloorDimensions } from '../access';
import type { Building, Quality, Vec3 } from '../types';

export const ARCHITECTURE_DETAIL_DISTANCE = 180;
export const ARCHITECTURE_DETAIL_BUILDINGS = 8;
export const ARCHITECTURE_DETAIL_INSTANCES = 640;
export interface ArchitectureInterior { buildingId: string | null; floor?: number }
export interface ArchitectureDetailPart {
  position: Vec3; size: Vec3; color: string; floor: number; roof: boolean;
  purpose: 'door' | 'window' | 'bracket' | 'tile' | 'masonry' | 'program';
  rotation?: [number, number, number]; luminous?: boolean;
}
interface DetailReference { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; floor: number; roof: boolean }
interface DetailEntry { group: THREE.Group; references: DetailReference[]; floor: number; quality: Quality; instanceCount: number; sign?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; interiorKey: string }
const q = (number: number) => Math.round(number * 5) / 5;
const WOOD = '#75563c', EDGE = '#b89763', STONE = '#a1a394', DARK = '#42534a', TILE = '#69766a';

export function architectureFunctionLabel(building: Building): string {
  if (building.facility) return ({ mayor: '市长官署', council: '议政听证', administration: '政务受理', data: '城市数据', energy: '能源调度', emergency: '应急指挥', embassy: '使节接待', archives: '档案阅览', treasury: '城市金库' })[building.facility];
  return ({ home: '家居 · 住宅', market: '买卖 · 食材', workshop: '百工 · 制造', bank: '钱庄 · 金融', hall: '公厅 · 政务', police: '巡警 · 治安', school: '学苑 · 课堂', clinic: '医馆 · 诊疗', station: '驿站 · 乘车', core: '天枢 · 市政', pavilion: '山亭 · 观景', airport: '空港 · 航班', starport: '星港 · 星际', farm: '农庄 · 田作', dock: '水驿 · 渡船' })[building.kind];
}

/** Geometry is generated for a nearby floor band, never for the whole city.
 * All coordinates are local to the existing building's structural base. */
export function buildArchitectureDetails(building: Building, nearFloor = 0, limit = ARCHITECTURE_DETAIL_INSTANCES): ArchitectureDetailPart[] {
  const parts: ArchitectureDetailPart[] = [], fh = building.height / Math.max(1, building.floors);
  const box = (purpose: ArchitectureDetailPart['purpose'], x: number, y: number, z: number, sx: number, sy: number, sz: number, color = WOOD, floor = 0, roof = false, rotation?: [number, number, number], luminous = false) => {
    if (parts.length >= limit || Math.min(sx, sy, sz) <= 0) return;
    parts.push({ purpose, position: { x: q(x), y: q(y), z: q(z) }, size: { x: Math.max(.2, q(sx)), y: Math.max(.2, q(sy)), z: Math.max(.2, q(sz)) }, color, floor, roof, ...(rotation ? { rotation } : {}), ...(luminous ? { luminous } : {}) });
  };
  const w = building.width, d = building.depth, doorWidth = Math.min(5, w * .22), doorHeight = Math.min(4.4, Math.max(2.4, fh - .5) * .72), front = d / 2;
  // A pavilion has open sides in the authoritative building: decorate its
  // columns/benches rather than inventing doors or window frames in empty air.
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
  // A jamb's inside edge stays outside the authoritative open doorway. Door
  // hardware and open shutter leaves sit against the side walls, not its axis.
  for (const side of [-1, 1]) {
    const x = side * (doorWidth / 2 + .4);
    box('door', x, doorHeight / 2, front + .5, .4, doorHeight, .6, WOOD);
    box('door', x, .2, front + .5, .8, .4, .8, STONE);
    box('door', x, doorHeight + .1, front + .5, .8, .4, .8, EDGE);
    box('door', x, 1.2, front + .9, .2, .4, .2, EDGE);
    const leaf = side * (doorWidth / 2 + 1.2);
    for (let slat = 0; slat < 3; slat++) box('door', leaf + (slat - 1) * .4, doorHeight / 2, front + .35, .2, doorHeight - .4, .2, slat === 1 ? EDGE : WOOD);
    for (const height of [.6, Math.max(.8, doorHeight - .6)]) box('door', leaf, height, front + .5, 1.2, .2, .2, WOOD);
    // Human-scale hanging lantern: lattice casing, rather than a plain glowing cube.
    const lanternX = side * (doorWidth / 2 + 2.6), ly = Math.max(1.6, doorHeight - .25);
    box('door', lanternX, ly + .65, front + 1, .2, .6, .2, WOOD);
    box('door', lanternX, ly, front + 1, .6, .8, .6, '#e7bc73', 0, false, undefined, true);
    for (const level of [-.5, .5]) box('door', lanternX, ly + level, front + 1, .8, .2, .8, '#7c3e32');
    for (const xx of [-.3, .3]) box('door', lanternX + xx, ly, front + 1.4, .2, .8, .2, WOOD);
    box('door', lanternX, ly - .7, front + 1, .2, .4, .2, '#a66446');
  }
  box('door', 0, doorHeight + .5, front + .5, doorWidth + 1.4, .4, 1, EDGE);
  box('door', 0, doorHeight + .75, front + .5, doorWidth + 2, .2, 1.4, WOOD);

  // Small staggered facing stones provide a legible masonry scale without
  // rebuilding or thickening walls. Preserve the south entrance's clear strip.
  const stoneColumns = Math.min(32, Math.floor(w / 1.2));
  for (let row = 0; row < 2; row++) for (let n = 0; n < stoneColumns; n++) {
    const x = (n - (stoneColumns - 1) / 2) * 1.2 + (row ? .4 : 0);
    if (Math.abs(x) < doorWidth / 2 + .8) continue;
    box('masonry', x, .2 + row * .4, front + .35, 1, .2, .2, (n + row + building.seed) % 3 ? STONE : '#bdbaa6');
  }

  // Function details decorate the existing shop/porch bays. They deliberately
  // avoid adding items in the central route from the street to the door.
  for (const side of [-1, 1]) {
    const bay = side * Math.max(doorWidth / 2 + 3, w * .3);
    if (building.kind === 'market') {
      for (let n = -3; n <= 3; n++) box('program', bay + n * .4, 1.05, front + 2.1, .2, 1.4, .2, n % 2 ? WOOD : EDGE);
      for (const y of [.4, 1.7]) box('program', bay, y, front + 2.2, 3.2, .2, .4, WOOD);
      box('program', bay, 3.35, front + 4.5, 3.2, .2, .2, EDGE);
      for (let n = -2; n <= 2; n++) box('program', bay + n * .6, 3.15, front + 4.5, .4, .4, .2, n % 2 ? '#c4a16b' : '#846548');
    } else if (building.kind === 'workshop' || building.kind === 'farm' || building.kind === 'dock') {
      const z = front + 3.1;
      for (const x of [-1.3, 1.3]) box('program', bay + x, 1.4, z, .2, 2.8, .2, WOOD);
      for (const y of [.5, 1.3, 2.2]) { box('program', bay, y, z, 3, .2, 1, EDGE); for (let slat = -2; slat <= 2; slat++) box('program', bay + slat * .6, y + .3, z + .35, .4, .4, .4, '#9c8660'); }
    } else if (building.kind === 'home') {
      for (let n = -2; n <= 2; n++) box('program', bay + n * .4, .9, front + .4, .2, 1.2, .2, n % 2 ? WOOD : EDGE);
      box('program', bay, 1.6, front + .4, 2.4, .2, .4, WOOD);
    } else if (['hall', 'core', 'police', 'school', 'bank'].includes(building.kind)) {
      const x = side * Math.max(doorWidth / 2 + 2, Math.min(w * .2, 12));
      for (const y of [.3, .6]) box('program', x, y, front + 1.5, 1.4 - y, .2, 1.4 - y, STONE);
      box('program', x, doorHeight + .2, front + 1.5, 1.2, .2, 1.2, EDGE);
      box('program', x, doorHeight - .15, front + 1.5, .8, .4, .8, WOOD);
    } else if (building.kind === 'clinic') {
      box('program', bay, 2, front + .5, .4, 2, .2, '#a95644');
      box('program', bay, 2, front + .5, 1.6, .4, .2, '#a95644');
    }
  }

  const center = THREE.MathUtils.clamp(Math.floor(nearFloor), 0, Math.max(0, building.floors - 1));
  const selected = [...new Set([center, center + 1, center - 1])].filter(floor => floor >= 0 && floor < building.floors).slice(0, building.kind === 'core' ? 2 : 3);
  for (const floor of selected) {
    const { width, depth } = getFloorDimensions(building, floor), y = floor * fh;
    const opening = Math.min(5, width * .22), count = Math.max(2, Math.min(building.kind === 'core' ? 18 : 8, Math.floor(width / 5)));
    const faceBox = (face: 'front' | 'left' | 'right', x: number, yy: number, offset: number, sx: number, sy: number, sz: number, color = WOOD) => {
      if (face === 'front') box('window', x, yy, depth / 2 + offset, sx, sy, sz, color, floor);
      else box('window', (face === 'left' ? -1 : 1) * (width / 2 + offset), yy, x, sz, sy, sx, color, floor);
    };
    const lattice = (face: 'front' | 'left' | 'right', x: number, cy: number, ww: number, hh: number, broad = false) => {
      for (const edge of [-1, 1]) { faceBox(face, x + edge * ww / 2, cy, .46, .2, hh + .4, .2); faceBox(face, x, cy + edge * hh / 2, .46, ww + .4, .2, .2); }
      const divisions = broad ? Math.min(12, Math.max(3, Math.floor(ww / 2.4))) : 3;
      for (let n = 1; n < divisions; n++) faceBox(face, x - ww / 2 + n * ww / divisions, cy, .48, .2, hh, .2, EDGE);
      for (const level of [-.22, .22]) faceBox(face, x, cy + level * hh, .48, ww, .2, .2, EDGE);
      faceBox(face, x, cy - hh / 2 - .3, .58, ww + .6, .2, .4, STONE);
      faceBox(face, x, cy + hh / 2 + .3, .6, ww + .6, .2, .6, WOOD);
    };
    // The core's broad curtain panels get a measured wooden arcade grid. Other
    // windows match the actual base renderer's centres and dimensions exactly.
    if (building.kind === 'core') for (const side of [-1, 1]) lattice('front', side * width * .23, y + fh * .52, width * .36, fh * .38, true);
    else for (let n = 0; n < count; n++) {
      const x = -width * .4 + n * width * .8 / Math.max(1, count - 1);
      const windowWidth = Math.min(2.4, width / count * .6);
      if (Math.abs(x) - windowWidth / 2 - .4 < opening / 2 + .2) continue;
      lattice('front', x, y + fh * .57, windowWidth, Math.min(2, fh * .38));
    }
    for (const face of ['left', 'right'] as const) for (const z of [-depth * .3, 0, depth * .3]) lattice(face, z, y + fh * .57, Math.min(2.7, depth * .15), Math.min(2.4, fh * .4));

    const period = building.kind === 'core' ? 6 : building.kind === 'home' ? 4 : building.kind === 'hall' || building.kind === 'school' ? 3 : building.floors;
    const roof = floor === building.floors - 1 || (floor + 1) % period === 0 || getFloorDimensions(building, Math.min(floor + 1, building.floors - 1)).width !== width;
    const eaveY = y + fh, z = depth / 2 + .6;
    // Stepped bearing blocks and diagonal braces attach to the existing beam.
    for (const column of [-.42, -.26, .26, .42]) {
      const x = width * column;
      box('bracket', x, eaveY - .9, z, .6, .4, .6, WOOD, floor, roof);
      box('bracket', x, eaveY - .6, z + .3, 1, .2, 1, EDGE, floor, roof);
      box('bracket', x, eaveY - .3, z + .5, 1.4, .2, 1.4, WOOD, floor, roof);
      box('bracket', x, eaveY - .65, z + .75, .2, 1.4, .2, EDGE, floor, roof, [Math.PI / 4, 0, 0]);
      for (const step of [-1, 1]) box('bracket', x + step * .45, eaveY - .45, z + .25, .2, .6, .2, WOOD, floor, roof);
    }
    if (roof) {
      // Individual eave-end tiles form a readable 0.6 m rhythm over the central
      // entrance bay. The distant/full roof silhouette is left to its owner.
      const tileSpan = Math.min(14, width * .75), tiles = Math.floor(tileSpan / .6);
      for (let tile = 0; tile < tiles; tile++) {
        const x = (tile - (tiles - 1) / 2) * .6;
        box('tile', x, eaveY + .35, depth / 2 + 1.2, .4, .2, .6, tile % 3 ? TILE : '#829080', floor, true);
        box('tile', x, eaveY + .5, depth / 2 + 1.2, .2, .2, .6, TILE, floor, true);
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

  getStats() { return { activeBuildings: this.entries.size, activeBuildingIds: [...this.entries.keys()], instances: [...this.entries.values()].reduce((sum, entry) => sum + entry.instanceCount, 0), created: this.created, released: this.released, maxBuildings: ARCHITECTURE_DETAIL_BUILDINGS, maxInstancesPerBuilding: ARCHITECTURE_DETAIL_INSTANCES, loadDistance: ARCHITECTURE_DETAIL_DISTANCE }; }

  private create(building: Building, floor: number, quality: Quality): DetailEntry {
    const parts = buildArchitectureDetails(building, floor, quality === 'low' ? 384 : quality === 'high' ? 640 : 576);
    const group = new THREE.Group(); group.name = `细部 · ${building.name}`; group.position.set(building.position.x, building.position.y + .6, building.position.z); group.rotation.y = building.rotation;
    const references: DetailReference[] = [];
    for (const luminous of [false, true]) {
      const selected = parts.filter(part => !!part.luminous === luminous); if (!selected.length) continue;
      const mesh = new THREE.InstancedMesh(this.cube, luminous ? this.light : this.solid, selected.length); mesh.name = luminous ? '灯笼暖光' : '木作 · 窗棂 · 斗拱 · 砖石';
      selected.forEach((part, index) => {
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0])));
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(part.position.x, part.position.y, part.position.z), rotation, new THREE.Vector3(part.size.x, part.size.y, part.size.z));
        mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, new THREE.Color(part.color)); references.push({ mesh, index, matrix, floor: part.floor, roof: part.roof });
      });
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); group.add(mesh);
    }
    const entry: DetailEntry = { group, references, floor, quality, instanceCount: parts.length, interiorKey: '' };
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 192; const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = building.kind === 'home' ? '#554735' : '#31514c'; context.fillRect(0, 0, 768, 192);
        context.strokeStyle = '#c5a269'; context.lineWidth = 9; context.strokeRect(8, 8, 752, 176);
        context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#eed8ae'; context.font = '600 54px "Noto Serif CJK SC", serif'; context.fillText(building.name, 384, 68, 706);
        context.fillStyle = '#c4d2b7'; context.font = '400 34px "Noto Sans CJK SC", sans-serif'; context.fillText(architectureFunctionLabel(building), 384, 136, 706);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 1;
        const fh = building.height / building.floors, doorHeight = Math.min(4.4, Math.max(2.4, fh - .5) * .72), width = Math.min(5.4, building.width * .3);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width * .25), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })); sign.name = `门牌 · ${architectureFunctionLabel(building)}`;
        sign.position.set(0, building.kind === 'pavilion' ? building.height * .72 : doorHeight + .9, building.kind === 'pavilion' ? building.depth * .4 + .65 : building.depth / 2 + 1.05); group.add(sign); entry.sign = sign;
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
