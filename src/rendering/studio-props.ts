import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Building, Vec3, WorldDefinition } from '../types';
import { CEILING_LAMP, STUDIO_ASSETS, STUDIO_FIXTURE_DRESSING, STUDIO_PROGRAM_DRESSING, STUDIO_TABLETOP, studioBuildingPlacements, studioLandmarkPlacements, studioStationPlacements, type StudioAsset, type StudioPropPlacement, type StudioStaticPlacement } from './studio-prop-layout';

/** Fraction of an authored emissive maximum shown for a supply and daylight. */
export function studioEmissiveFactor(daylight: number, power: number): number {
  const p = Math.min(1, Math.max(0, power)), d = Math.min(1, Math.max(0, daylight));
  return p * (.35 + .65 * (1 - d));
}

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
  private lighting = { daylight: 1, power: 1 };
  private disposed = false;
  constructor(parent: THREE.Group | THREE.Scene, world: WorldDefinition, private readonly capacity = 384) {
    this.group.name = '体素工坊 · 楼层设施模型';
    for (const building of world.buildings) this.buildings.set(building.id, building);
    this.statics = [...studioStationPlacements(world), ...studioLandmarkPlacements(world)];
    // Woodland models belong to WoodlandModelPool; this pool loads only what it places.
    const used = new Set([CEILING_LAMP.asset as string, ...Object.values(STUDIO_FIXTURE_DRESSING).map(d => d!.asset), ...Object.values(STUDIO_PROGRAM_DRESSING).flatMap(byKind => Object.values(byKind!).map(d => d!.asset)), ...Object.values(STUDIO_TABLETOP) as string[], ...this.statics.map(p => p.asset)]);
    for (const asset of STUDIO_ASSETS.filter(asset => used.has(asset.id))) {
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
        // Authored glow is a maximum; setLighting scales it by real supply.
        for (const { mesh } of meshes) for (const material of [mesh.material].flat()) if (material instanceof THREE.MeshStandardMaterial && material.emissiveIntensity > 0 && !material.emissive.equals(new THREE.Color(0, 0, 0))) material.userData.authoredEmissive = material.emissiveIntensity;
        this.applyLighting(meshes.map(m => m.mesh));
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
  get dressesStations(): boolean { return this.statics.some(p => p.id.endsWith(':platform')); }
  /** True when this pool draws the given landmark (runway or forecourt). */
  dressesLandmark(suffix: 'runway' | 'forecourt'): boolean { return this.statics.some(p => p.id.endsWith(`:${suffix}`)); }

  /** Lamp cores glow only with city power, brighter as daylight falls. */
  setLighting(daylight: number, power: number): void {
    this.lighting = { daylight: THREE.MathUtils.clamp(daylight, 0, 1), power: THREE.MathUtils.clamp(power, 0, 1) };
    this.applyLighting([...this.draws.values()].flatMap(draw => draw.loaded ? draw.meshes.map(m => m.mesh) : []));
  }
  private applyLighting(meshes: THREE.InstancedMesh[]): void {
    const factor = studioEmissiveFactor(this.lighting.daylight, this.lighting.power);
    for (const mesh of meshes) for (const material of [mesh.material].flat()) if (material instanceof THREE.MeshStandardMaterial && material.userData.authoredEmissive !== undefined) material.emissiveIntensity = material.userData.authoredEmissive * factor;
  }

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
      // Distance to the model's own bounds, so a 960m runway does not vanish from its far end.
      const bounds = this.draws.get(placement.asset)?.asset.boundsM, p = placement.position;
      const centre = bounds ? { x: p.x + (bounds.min[0] + bounds.max[0]) / 2, y: p.y + (bounds.min[1] + bounds.max[1]) / 2, z: p.z + (bounds.min[2] + bounds.max[2]) / 2 } : p;
      const radius = bounds ? Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2 : 0;
      const distance = Math.max(0, Math.hypot(camera.x - centre.x, camera.y - centre.y, camera.z - centre.z) - radius);
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
