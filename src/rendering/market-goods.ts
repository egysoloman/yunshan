import * as THREE from 'three';
import { marketCounters, marketDisplayUnits, type MarketCounter } from '../site-fixtures';
import type { SimState, Vec3, WorldDefinition } from '../types';
import { shopLifecycleAllowsOperation } from '../simulation/shop_lifecycle';

/** One reusable draw displays a small sample of food that the existing market
 * actually owns. Empty/closed markets and unloaded neighbourhoods display none. */
export class MarketGoodsPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly counters = new Map<string, MarketCounter[]>();
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private disposed = false;
  constructor(parent: THREE.Group | THREE.Scene, world: WorldDefinition) {
    for (const building of world.buildings) if (building.kind === 'market') this.counters.set(building.id, marketCounters(world, building));
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .95 }), Math.max(1, this.counters.size * 8));
    this.mesh.name = '市集 · 实际库存的柜台食品样本';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; parent.add(this.mesh);
  }
  update(state: SimState, camera: Vec3, residentBuildingIds: ReadonlySet<string>, range = 110): void {
    if (this.disposed) return;
    const shops = new Map(state.shops.map(shop => [shop.buildingId, shop]));
    let count = 0;
    for (const [buildingId, counters] of this.counters) {
      const shop = shops.get(buildingId);
      if (!residentBuildingIds.has(buildingId) || !shop?.open || !shopLifecycleAllowsOperation(state, shop.id) || !counters.length) continue;
      const units = marketDisplayUnits(shop.inventory);
      for (let unit = 0; unit < units; unit++) {
        const counter = counters[unit % counters.length];
        if (Math.hypot(camera.x - counter.position.x, camera.y - counter.position.y, camera.z - counter.position.z) > range) continue;
        const columns = Math.max(1, Math.min(4, Math.floor((counter.size.x - .4) / .6) + 1));
        const slot = Math.floor(unit / counters.length), row = Math.floor(slot / columns);
        if (row > 1) continue;
        const x = (slot % columns - (columns - 1) / 2) * .6, z = (row - .5) * .4;
        const c = Math.cos(counter.rotation), s = Math.sin(counter.rotation);
        this.dummy.position.set(counter.position.x + x * c + z * s, counter.position.y + counter.size.y / 2 + .1, counter.position.z + z * c - x * s);
        this.dummy.scale.set(.4, .2, .4); this.dummy.rotation.set(0, counter.rotation, 0); this.dummy.updateMatrix();
        this.mesh.setMatrixAt(count, this.dummy.matrix);
        this.mesh.setColorAt(count++, this.color.set(unit % 2 ? '#b77851' : '#8b9c67'));
      }
    }
    this.mesh.count = count; this.mesh.visible = count > 0; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.userData.budget = { instances: count, drawCalls: Number(count > 0), triangles: count * 12, maxDisplayedPerMarket: 8 };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose(); this.counters.clear();
  }
}
