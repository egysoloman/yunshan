import * as THREE from 'three';
import type { NetworkNode, SimState, TransportMode, Vec3, WorldDefinition } from '../types';
import { isRoadOpen } from '../roads';

export interface StationWallBoard {
  position: Vec3; rotation: number; width: number; height: number;
  /** This board is paint on one face of an existing .8 × 6m canopy post. */
  host: { position: Vec3; size: Vec3 };
}
export interface StationBoardView {
  name: string; district: string; connections: string[]; signal: string;
  closed: number; total: number; nearbyVehicles: number; signature: string;
}
const modes: Record<TransportMode, string> = {
  road: '道路', bridge: '桥路', maglev: '磁悬浮', lightRail: '轻轨',
  cable: '缆车', lift: '升降', ferry: '渡船', flight: '航线',
};

/** The renderer already draws these two posts for each actual station node.
 * Finishing their faces adds no pole, floor, roof, route or use point. */
export function stationWallBoards(node: NetworkNode): StationWallBoard[] {
  if (!node.station) return [];
  return [-8, 8].flatMap(offset => [-1, 1].map(side => ({
    position: { x: node.position.x + offset, y: node.position.y + 3.05, z: node.position.z + side * .403 },
    rotation: side === 1 ? 0 : Math.PI, width: .66, height: 3.6,
    host: { position: { x: node.position.x + offset, y: node.position.y + 3, z: node.position.z }, size: { x: .8, y: 6, z: .8 } },
  })));
}

/** A connected edge, closure, signal and vehicle count are read from the live
 * numerical world. This board promises neither a timetable nor a usable line
 * merely because an architectural canopy exists. */
export function describeStationBoard(world: WorldDefinition, state: SimState, node: NetworkNode): StationBoardView {
  const edges = world.edges.filter(edge => edge.from === node.id || edge.to === node.id);
  const open = edges.filter(edge => isRoadOpen(state, edge.id));
  const connections = [...new Set(open.map(edge => modes[edge.mode]))];
  const nearbyVehicles = state.vehicles.filter(vehicle => edges.some(edge => edge.id === vehicle.edgeId)
    && Math.hypot(vehicle.position.x - node.position.x, vehicle.position.y - node.position.y, vehicle.position.z - node.position.z) <= 16).length;
  const phase = state.signals?.[node.id];
  const signal = phase === 1 ? '路口通行' : phase === 0 ? '路口等候' : '信号未登记';
  const district = world.districts.find(district => district.id === node.districtId)?.name ?? node.districtId;
  const view = { name: node.name, district, connections, signal, closed: edges.length - open.length, total: edges.length, nearbyVehicles };
  return { ...view, signature: JSON.stringify(view) };
}

interface Entry { group: THREE.Group; signature: string; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshStandardMaterial }
/** At most eight nearby station textures. The scene reads this ink as part of
 * its real transport structure; it is not a screen floating over the street. */
export class StationWayfindingPool {
  readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private readonly stations: NetworkNode[];
  private disposed = false;
  private paints = 0;
  constructor(parent: THREE.Scene | THREE.Group, private readonly world: WorldDefinition) {
    this.group.name = '驿站 · 柱面站名与真实路况'; parent.add(this.group);
    this.stations = world.nodes.filter(node => node.station);
  }
  update(state: SimState, camera: Vec3, limit = 8): void {
    if (this.disposed || typeof document === 'undefined') return;
    const selected = this.stations.filter(node => Math.hypot(camera.x - node.position.x, camera.y - node.position.y, camera.z - node.position.z) <= 100)
      .sort((a, b) => Math.hypot(camera.x - a.position.x, camera.y - a.position.y, camera.z - a.position.z)
        - Math.hypot(camera.x - b.position.x, camera.y - b.position.y, camera.z - b.position.z) || a.id.localeCompare(b.id))
      .slice(0, Math.min(8, Math.max(0, Math.floor(limit))));
    const desired = new Set(selected.map(node => node.id));
    for (const id of this.entries.keys()) if (!desired.has(id)) this.release(id);
    for (const node of selected) {
      const view = describeStationBoard(this.world, state, node);
      let entry = this.entries.get(node.id);
      if (!entry) { entry = this.create(node); this.entries.set(node.id, entry); this.group.add(entry.group); }
      if (entry.signature !== view.signature) { this.paint(entry.canvas, view); entry.texture.needsUpdate = true; entry.signature = view.signature; this.paints++; }
    }
    this.group.userData.budget = { stations: this.entries.size, maxStations: 8, textures: this.entries.size, boards: this.entries.size * 4, paints: this.paints };
  }
  private create(node: NetworkNode): Entry {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1400;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .94, metalness: 0 });
    const entry: Entry = { group: new THREE.Group(), signature: '', canvas, texture, material };
    for (const board of stationWallBoards(node)) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(board.width, board.height), material);
      mesh.name = `柱面站牌 · ${node.name}`; mesh.position.set(board.position.x, board.position.y, board.position.z); mesh.rotation.y = board.rotation;
      entry.group.add(mesh);
    }
    return entry;
  }
  private paint(canvas: HTMLCanvasElement, view: StationBoardView): void {
    const c = canvas.getContext('2d'); if (!c) return;
    c.fillStyle = '#ded3b6'; c.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y += 9) { c.fillStyle = y % 3 ? 'rgba(119,92,53,.035)' : 'rgba(252,238,207,.11)'; c.fillRect(0, y, canvas.width, 1); }
    c.strokeStyle = '#a18354'; c.lineWidth = 4; c.strokeRect(10, 10, 236, 1380); c.lineWidth = 1; c.strokeRect(17, 17, 222, 1366);
    c.fillStyle = '#37564c'; c.fillRect(24, 28, 208, 108);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '600 70px "Noto Serif CJK SC", serif'; c.fillStyle = '#f4e4bb'; c.fillText('驿', 128, 84);
    const title = Array.from(view.name); const step = Math.min(115, 640 / Math.max(1, title.length));
    c.font = `600 ${Math.min(100, step * .9)}px "Noto Serif CJK SC", serif`; c.fillStyle = '#3c352c';
    title.forEach((character, index) => c.fillText(character, 128, 180 + step * (index + .5), 190));
    c.strokeStyle = '#a18354'; c.beginPath(); c.moveTo(40, 870); c.lineTo(216, 870); c.stroke();
    c.font = '600 35px "Noto Sans CJK SC", sans-serif'; c.fillStyle = '#37564c';
    c.fillText(view.district, 128, 917, 190);
    // Passive printed surfaces use the same scene light as the timber post.
    // A route closure changes the print; no extra emissive light is invented.
    const connections = view.connections.length ? view.connections.join(' / ') : '暂无开放连接';
    c.font = '500 30px "Noto Sans CJK SC", sans-serif'; c.fillStyle = '#524434';
    c.fillText(connections, 128, 987, 190);
    c.fillStyle = view.closed ? '#95543a' : '#37564c'; c.fillText(`连接 ${view.total - view.closed}/${view.total}`, 128, 1062, 190);
    c.fillStyle = '#524434'; c.fillText(view.signal, 128, 1132, 190); c.fillText(`近站载具 ${view.nearbyVehicles}`, 128, 1202, 190);
    c.strokeStyle = '#995840'; c.lineWidth = 3; c.strokeRect(104, 1280, 48, 48); c.fillStyle = '#995840'; c.font = '500 34px "Noto Serif CJK SC", serif'; c.fillText('云', 128, 1304);
  }
  private release(id: string): void {
    const entry = this.entries.get(id); if (!entry) return;
    entry.group.removeFromParent(); entry.group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    entry.texture.dispose(); entry.material.dispose(); entry.group.clear(); this.entries.delete(id);
  }
  dispose(): void { if (this.disposed) return; for (const id of this.entries.keys()) this.release(id); this.group.removeFromParent(); this.group.clear(); this.disposed = true; }
}
