import * as THREE from 'three';
import { marketCounters, marketDisplayUnits, type MarketCounter } from '../site-fixtures';
import type { SimState, Vec3, WorldDefinition } from '../types';
import { shopLifecycleAllowsOperation } from '../simulation/shop_lifecycle';

/** A wrapped food sample within the original unit cube. These packages do not
 * declare new food varieties, containers, sale units or collision volumes. */
export function createMarketFoodSampleGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const piece = (x: number, y: number, z: number, sx: number, sy: number, sz: number, tint: string) => {
    const indexed = new THREE.BoxGeometry(sx, sy, sz), box = indexed.toNonIndexed(), color = new THREE.Color(tint);
    indexed.dispose();
    const vertices = box.getAttribute('position'), directions = box.getAttribute('normal');
    for (let i = 0; i < vertices.count; i++) {
      positions.push(vertices.getX(i) + x, vertices.getY(i) + y, vertices.getZ(i) + z);
      normals.push(directions.getX(i), directions.getY(i), directions.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    box.dispose();
  };
  piece(0, -.2, 0, 1, .6, 1, '#f0e5ca');
  piece(0, .3, 0, .8, .4, .8, '#dbcfab');
  piece(0, .3, 0, .15, .4, .82, '#81705c');
  piece(0, .3, 0, .82, .4, .15, '#81705c');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** One reusable draw displays a small sample of food that the existing market
 * actually owns. Empty/closed markets and unloaded neighbourhoods display none. */
export class MarketGoodsPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly counters = new Map<string, MarketCounter[]>();
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private disposed = false;
  private signature = '';
  private uploads = 0;
  constructor(parent: THREE.Group | THREE.Scene, world: WorldDefinition) {
    for (const building of world.buildings) if (building.kind === 'market') this.counters.set(building.id, marketCounters(world, building));
    this.mesh = new THREE.InstancedMesh(createMarketFoodSampleGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .95, vertexColors: true }), Math.max(1, this.counters.size * 8));
    this.mesh.name = '市集 · 实际库存的柜台食品样本';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; parent.add(this.mesh);
  }
  update(state: SimState, camera: Vec3, residentBuildingIds: ReadonlySet<string>, range = 110): void {
    if (this.disposed) return;
    const shops = new Map(state.shops.map(shop => [shop.buildingId, shop]));
    const selected: { counter: MarketCounter; unit: number; slot: number }[] = [];
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
        selected.push({ counter, unit, slot });
      }
    }
    // Compare the actual filtered slots: inventory, life-cycle, resident and
    // range changes all participate. An unchanged display performs no upload.
    const signature = JSON.stringify(selected.map(({ counter, unit, slot }) => [counter.id, unit, slot]));
    if (signature === this.signature) return;
    this.signature = signature;
    let count = 0;
    for (const { counter, unit, slot } of selected) {
        const columns = Math.max(1, Math.min(4, Math.floor((counter.size.x - .4) / .6) + 1)), row = Math.floor(slot / columns);
        const x = (slot % columns - (columns - 1) / 2) * .6, z = (row - .5) * .4;
        const c = Math.cos(counter.rotation), s = Math.sin(counter.rotation);
        this.dummy.position.set(counter.position.x + x * c + z * s, counter.position.y + counter.size.y / 2 + .1, counter.position.z + z * c - x * s);
        this.dummy.scale.set(.4, .2, .4); this.dummy.rotation.set(0, counter.rotation, 0); this.dummy.updateMatrix();
        this.mesh.setMatrixAt(count, this.dummy.matrix);
        this.mesh.setColorAt(count++, this.color.set(unit % 2 ? '#d5bb8d' : '#b9c4a4'));
    }
    this.mesh.count = count; this.mesh.visible = count > 0; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.userData.budget = { instances: count, drawCalls: Number(count > 0), triangles: count * this.mesh.geometry.getAttribute('position').count / 3, maxDisplayedPerMarket: 8, uploads: ++this.uploads };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.mesh.removeFromParent(); this.mesh.dispose(); this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose(); this.counters.clear();
  }
}
