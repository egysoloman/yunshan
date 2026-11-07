import * as THREE from 'three';
import { buildingWorldPosition, getBuildingFloorPlan } from '../architecture-floor-plan';
import type { Building, SimState, Vec3, WorldDefinition } from '../types';

/** The lit interior seen through an open market's entrance after dusk: a warm
 * panel just inside the authoritative entrance opening, facing out. It is
 * shown only while the shop is actually open (the simulation opens a shop
 * only while its lifecycle allows operation). Mirrored by
 * Core/DoorwayGlow.cs. */
export interface DoorwayGlowPanel { x: number; y: number; z: number; width: number; height: number; yaw: number }
export function doorwayGlowPanel(building: Building): DoorwayGlowPanel | null {
  if (building.kind !== 'market') return null;
  const plan = getBuildingFloorPlan(building, 0), wall = plan?.walls.find(w => w.opening?.use === 'entrance');
  if (!plan || !wall?.opening) return null;
  const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1], length = Math.hypot(dx, dz), t = (wall.opening.from + wall.opening.to) / 2;
  const mx = wall.a[0] + dx * t / length, mz = wall.a[1] + dz * t / length;
  let nx = -dz / length, nz = dx / length; if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  const inset = wall.thickness / 2 + .08, at = buildingWorldPosition(building, { x: mx - nx * inset, y: plan.y + wall.opening.height / 2, z: mz - nz * inset });
  const c = Math.cos(building.rotation), s = Math.sin(building.rotation);
  return { x: at.x, y: at.y, z: at.z, width: wall.opening.to - wall.opening.from - .1, height: wall.opening.height - .05, yaw: Math.atan2(nx * c + nz * s, -nx * s + nz * c) };
}
/** 0 by day or while closed; rises to 1 as daylight falls from .55 to .2. */
export function doorwayGlowLevel(open: boolean, daylight: number): number {
  return open ? Math.max(0, Math.min(1, (.55 - daylight) / .35)) : 0;
}

export const DOORWAY_GLOW_LIMIT = 48, DOORWAY_GLOW_RANGE = 160, DOORWAY_GLOW_STRENGTH = .38;
export class DoorwayGlowPool {
  private readonly panels: { building: Building; panel: DoorwayGlowPanel }[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4(); private readonly color = new THREE.Color();
  private readonly base = new THREE.Color('#ff9a44');
  constructor(parent: THREE.Scene | THREE.Group, world: WorldDefinition) {
    for (const building of world.buildings) { const panel = doorwayGlowPanel(building); if (panel) this.panels.push({ building, panel }); }
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, DOORWAY_GLOW_LIMIT);
    this.mesh.name = '市集 · 营业中的门内灯光'; this.mesh.count = 0; this.mesh.frustumCulled = false; parent.add(this.mesh);
  }
  update(state: SimState, camera: Vec3, daylight: number): void {
    let count = 0;
    if (daylight < .55) for (const { building, panel } of this.panels) {
      if (count >= DOORWAY_GLOW_LIMIT || Math.hypot(panel.x - camera.x, panel.z - camera.z) > DOORWAY_GLOW_RANGE) continue;
      const shop = state.shops.find(row => row.buildingId === building.id);
      const level = doorwayGlowLevel(!!shop?.open, daylight); if (level <= 0) continue;
      this.matrix.compose(new THREE.Vector3(panel.x, panel.y, panel.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), panel.yaw), new THREE.Vector3(panel.width, panel.height, 1));
      this.mesh.setMatrixAt(count, this.matrix); this.mesh.setColorAt(count, this.color.copy(this.base).multiplyScalar(level * DOORWAY_GLOW_STRENGTH)); count++;
    }
    this.mesh.count = count; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  get litCount(): number { return this.mesh.count; }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
