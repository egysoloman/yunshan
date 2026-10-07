import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Building, Vec3, WorldDefinition } from '../types';
import { STUDIO_ASSETS, studioBuildingPlacements, studioStationPlacements, type StudioAsset, type StudioPropPlacement, type StudioStaticPlacement } from './studio-prop-layout';

interface AssetDraw { asset: StudioAsset; meshes: { mesh: THREE.InstancedMesh; bake: THREE.Matrix4 }[]; loaded: boolean }

/** Instanced voxel-studio models for floor-plan fixtures of resident
 * buildings. Until a GLB has loaded (or if it fails) each placement shows a
 * plain box of the model's own fitted bounds, so a fixture solid is never
 * invisible. Display only: it adds no collision, stock or interaction. */
export class StudioPropPool {
  readonly group = new THREE.Group();
  private readonly buildings = new Map<string, Building>();
  private readonly placements = new Map<string, StudioPropPlacement[]>();
  private readonly draws = new Map<string, AssetDraw>();
  private readonly placeholder = new THREE.BoxGeometry(1, 1, 1);
  private readonly placeholderMaterial = new THREE.MeshStandardMaterial({ color: '#846346', roughness: .9 });
  private readonly statics: StudioStaticPlacement[];
  private signature = '';
  private disposed = false;
  constructor(parent: THREE.Group | THREE.Scene, world: WorldDefinition, private readonly capacity = 384) {
    this.group.name = '体素工坊 · 楼层设施模型';
    for (const building of world.buildings) this.buildings.set(building.id, building);
    this.statics = studioStationPlacements(world);
    for (const asset of STUDIO_ASSETS) {
      const mesh = new THREE.InstancedMesh(this.placeholder, this.placeholderMaterial, capacity);
      this.prepare(mesh, `${asset.id} ${asset.name} · 占位`);
      this.draws.set(asset.id, { asset, meshes: [{ mesh, bake: new THREE.Matrix4() }], loaded: false });
    }
    parent.add(this.group);
  }

  /** Loads every manifest GLB; a failed asset keeps its placeholder boxes. */
  async load(baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'): Promise<{ loaded: string[]; failed: string[] }> {
    const loader = new GLTFLoader(), loaded: string[] = [], failed: string[] = [];
    await Promise.all([...this.draws.values()].map(async draw => {
      try {
        const gltf = await loader.loadAsync(baseUrl + draw.asset.url);
        if (this.disposed) return;
        gltf.scene.updateMatrixWorld(true);
        const meshes: AssetDraw['meshes'] = [];
        gltf.scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          const mesh = new THREE.InstancedMesh(object.geometry, object.material, this.capacity);
          this.prepare(mesh, `${draw.asset.id} ${draw.asset.name}`);
          meshes.push({ mesh, bake: object.matrixWorld.clone() });
        });
        if (!meshes.length) throw new Error('no meshes');
        for (const { mesh } of draw.meshes) this.group.remove(mesh);
        draw.meshes = meshes; draw.loaded = true; loaded.push(draw.asset.id);
        this.signature = '';
      } catch (error) {
        failed.push(draw.asset.id);
        console.warn(`studio asset ${draw.asset.id} kept placeholder:`, error);
      }
    }));
    this.group.userData.studioAssets = { loaded, failed };
    return { loaded, failed };
  }

  /** True when this pool draws the station platform and shelter. */
  get dressesStations(): boolean { return this.statics.length > 0; }

  update(camera: Vec3, residentBuildingIds: ReadonlySet<string>, inside: { id: string | null; floor: number }, range: number, staticRange = range * 6): void {
    if (this.disposed) return;
    const selected = new Map<string, { building: Building; placement: StudioPropPlacement; distance: number }[]>();
    for (const id of residentBuildingIds) {
      const building = this.buildings.get(id); if (!building) continue;
      let placements = this.placements.get(id);
      if (!placements) { placements = studioBuildingPlacements(building); this.placements.set(id, placements); }
      const retained = inside.id === id ? inside.floor < 0 ? inside.floor + 1 : inside.floor : Infinity;
      for (const placement of placements) {
        if (placement.floor > retained) continue;
        const distance = Math.hypot(camera.x - building.position.x, camera.y - building.position.y - placement.local.y, camera.z - building.position.z);
        if (distance > range + Math.hypot(building.width, building.depth) / 2) continue;
        const list = selected.get(placement.asset) ?? []; list.push({ building, placement, distance }); selected.set(placement.asset, list);
      }
    }
    const fixed = new Map<string, { placement: StudioStaticPlacement; distance: number }[]>();
    for (const placement of this.statics) {
      const p = placement.position, distance = Math.hypot(camera.x - p.x, camera.y - p.y, camera.z - p.z);
      if (distance > staticRange) continue;
      const list = fixed.get(placement.asset) ?? []; list.push({ placement, distance }); fixed.set(placement.asset, list);
    }
    const signature = [...this.draws.keys()].map(id => `${id}:${this.draws.get(id)!.loaded}:${(selected.get(id) ?? []).map(s => `${s.building.id}/${s.placement.fixtureId}/${s.placement.local.x}`).join(',')}:${(fixed.get(id) ?? []).map(s => s.placement.id).join(',')}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    const place = new THREE.Matrix4(), part = new THREE.Matrix4(), yaw = new THREE.Matrix4();
    for (const [id, draw] of this.draws) {
      const fixtures = (selected.get(id) ?? []).map(({ building, placement, distance }) => ({ distance, at: (m: THREE.Matrix4) => m.makeTranslation(building.position.x, building.position.y + .6, building.position.z)
        .multiply(yaw.makeRotationY(building.rotation))
        .multiply(part.makeTranslation(placement.local.x, placement.local.y, placement.local.z))
        .multiply(part.makeScale(placement.scale, placement.scale, placement.scale)) }));
      const statics = (fixed.get(id) ?? []).map(({ placement, distance }) => ({ distance, at: (m: THREE.Matrix4) => m.makeTranslation(placement.position.x, placement.position.y, placement.position.z).multiply(yaw.makeRotationY(placement.yaw)) }));
      const list = [...fixtures, ...statics].sort((a, b) => a.distance - b.distance).slice(0, this.capacity);
      const { min, max } = draw.asset.boundsM;
      list.forEach(({ at }, index) => {
        at(place);
        for (const { mesh, bake } of draw.meshes) {
          if (draw.loaded) mesh.setMatrixAt(index, part.multiplyMatrices(place, bake));
          else mesh.setMatrixAt(index, part.multiplyMatrices(place, new THREE.Matrix4().makeTranslation((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2).scale(new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]))));
        }
      });
      for (const { mesh } of draw.meshes) {
        mesh.count = list.length; mesh.visible = list.length > 0; mesh.instanceMatrix.needsUpdate = true;
        if (list.length) mesh.computeBoundingSphere();
      }
    }
    this.group.userData.studioPlacements = Object.fromEntries([...this.draws.keys()].map(id => [id, Math.min(this.capacity, (selected.get(id)?.length ?? 0) + (fixed.get(id)?.length ?? 0))]));
  }

  dispose(): void {
    this.disposed = true;
    for (const draw of this.draws.values()) for (const { mesh } of draw.meshes) {
      mesh.dispose();
      if (draw.loaded) { mesh.geometry.dispose(); for (const material of [mesh.material].flat()) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose(); material.dispose(); } }
    }
    this.placeholder.dispose(); this.placeholderMaterial.dispose();
    this.group.removeFromParent();
  }

  private prepare(mesh: THREE.InstancedMesh, name: string) {
    mesh.name = name; mesh.count = 0; mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}
