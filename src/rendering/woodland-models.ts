import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Quality, Vec3 } from '../types';
import { STUDIO_ASSETS, type StudioAsset } from './studio-prop-layout';
import type { WoodlandShrub, WoodlandTree } from './woodland-layout';

/** Studio tree and shrub models around the camera, at their original size.
 * Trees farther out, and every tree until its GLB has loaded, stay the
 * terrain's block woodland (built from the same layout and heights). */
export const WOODLAND_MODEL_RANGE: Record<Quality, { trees: number; treeCount: number; shrubs: number; shrubCount: number }> = {
  high: { trees: 240, treeCount: 220, shrubs: 110, shrubCount: 220 },
  balanced: { trees: 160, treeCount: 120, shrubs: 70, shrubCount: 120 },
  low: { trees: 0, treeCount: 0, shrubs: 0, shrubCount: 0 },
};

interface Draw { asset: StudioAsset; meshes: { mesh: THREE.InstancedMesh; bake: THREE.Matrix4 }[] }
type Plant = (WoodlandTree | WoodlandShrub) & { shrub: boolean };

export class WoodlandModelPool {
  readonly group = new THREE.Group();
  private readonly draws = new Map<string, Draw>();
  private readonly plants: Plant[];
  private lastKey = '';
  private disposed = false;
  constructor(parent: THREE.Object3D, trees: readonly WoodlandTree[], shrubs: readonly WoodlandShrub[], private readonly setModelled: (trees: ReadonlySet<number>, shrubs: ReadonlySet<number>) => void) {
    this.group.name = '体素工坊 · 原尺寸林木';
    this.plants = [...trees.map(t => ({ ...t, shrub: false })), ...shrubs.map(s => ({ ...s, shrub: true }))];
    parent.add(this.group);
  }

  async load(baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'): Promise<{ loaded: string[]; failed: string[] }> {
    const wanted = new Set(this.plants.map(p => p.asset)), loader = new GLTFLoader(), loaded: string[] = [], failed: string[] = [];
    await Promise.all(STUDIO_ASSETS.filter(asset => wanted.has(asset.id)).map(async asset => {
      try {
        const gltf = await loader.loadAsync(baseUrl + asset.url); if (this.disposed) return;
        gltf.scene.updateMatrixWorld(true);
        const meshes: Draw['meshes'] = [], capacity = Math.max(WOODLAND_MODEL_RANGE.high.treeCount, WOODLAND_MODEL_RANGE.high.shrubCount);
        gltf.scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const mesh = new THREE.InstancedMesh(object.geometry, object.material, capacity);
          mesh.name = `${asset.id} ${asset.name}`; mesh.count = 0; mesh.visible = false; mesh.castShadow = true; mesh.receiveShadow = true;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh);
          meshes.push({ mesh, bake: object.matrixWorld.clone() });
        });
        if (!meshes.length) throw new Error('no meshes');
        this.draws.set(asset.id, { asset, meshes }); loaded.push(asset.id); this.lastKey = '';
      } catch (error) { failed.push(asset.id); console.warn(`woodland model ${asset.id} kept blocks:`, error); }
    }));
    this.group.userData.woodlandModels = { loaded, failed };
    return { loaded, failed };
  }

  update(camera: Vec3, quality: Quality): void {
    if (this.disposed) return;
    const range = WOODLAND_MODEL_RANGE[quality], key = `${quality}:${Math.round(camera.x / 8)}:${Math.round(camera.z / 8)}:${this.draws.size}`;
    if (key === this.lastKey) return; this.lastKey = key;
    const near = (shrub: boolean, radius: number, count: number) => this.plants
      .filter(p => p.shrub === shrub && this.draws.has(p.asset))
      .map(p => ({ p, d: Math.hypot(p.x - camera.x, p.z - camera.z) })).filter(e => e.d <= radius)
      .sort((a, b) => a.d - b.d || a.p.id - b.p.id).slice(0, count).map(e => e.p);
    const chosen = [...near(false, range.trees, range.treeCount), ...near(true, range.shrubs, range.shrubCount)];
    const byAsset = new Map<string, Plant[]>();
    for (const plant of chosen) { const list = byAsset.get(plant.asset) ?? []; list.push(plant); byAsset.set(plant.asset, list); }
    const place = new THREE.Matrix4(), part = new THREE.Matrix4();
    for (const [id, draw] of this.draws) {
      const list = byAsset.get(id) ?? [];
      list.forEach((plant, index) => {
        place.makeTranslation(plant.x, plant.y, plant.z).multiply(part.makeRotationY(plant.yaw));
        for (const { mesh, bake } of draw.meshes) mesh.setMatrixAt(index, part.multiplyMatrices(place, bake));
      });
      for (const { mesh } of draw.meshes) { mesh.count = list.length; mesh.visible = list.length > 0; mesh.instanceMatrix.needsUpdate = true; if (list.length) mesh.computeBoundingSphere(); }
    }
    this.setModelled(new Set(chosen.filter(p => !p.shrub).map(p => p.id)), new Set(chosen.filter(p => p.shrub).map(p => p.id)));
    this.group.userData.woodlandPlacements = Object.fromEntries([...this.draws.keys()].map(id => [id, byAsset.get(id)?.length ?? 0]));
  }

  dispose(): void {
    this.disposed = true;
    for (const draw of this.draws.values()) for (const { mesh } of draw.meshes) { mesh.dispose(); mesh.geometry.dispose(); for (const material of [mesh.material].flat()) material.dispose(); }
    this.group.removeFromParent();
  }
}
