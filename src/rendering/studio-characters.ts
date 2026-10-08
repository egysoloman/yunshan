import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Quality, SimState, Vec3 } from '../types';
import { STUDIO_ASSETS, type StudioAsset } from './studio-prop-layout';
import {
  CHARACTER_JOINTS, CHARACTER_PARENT, garmentJoint, portMap, STUDIO_CHARACTER_ASSETS, studioBodyJoint, studioCharacterLook, studioCharacterPose, studioCharacterRest, studioMountOffset,
  type CharacterContext, type CharacterLook,
} from './studio-character-look';

/** Residents near the camera drawn as studio characters on the studio
 * skeleton (CHAR-073 adults, CHAR-074 children). Everyone else stays the
 * box residents of CitizenAppearancePool, which skips the ids returned by
 * `modelled`. Display only: positions, yaw and walk phase are read from the
 * simulation and the box pool's own displacement-driven motion. */
export const STUDIO_CHARACTER_RANGE: Record<Quality, { distance: number; count: number }> = {
  high: { distance: 70, count: 40 }, balanced: { distance: 45, count: 20 }, low: { distance: 0, count: 0 },
};

type ManifestAsset = StudioAsset & { ports?: { id: string; position: number[] }[]; joints?: string[] };
interface LoadedPart { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; bake: THREE.Matrix4; skin?: { joints: string[]; inverses: THREE.Matrix4[]; bindMatrix: THREE.Matrix4 } }
interface Character { key: string; holder: THREE.Group; bones: Map<string, THREE.Bone>; skinned: THREE.SkinnedMesh[] }
export interface CharacterMotion { yaw: number; phase: number; walking: boolean; seated: boolean; dead: boolean }

export class StudioCharacterPool {
  readonly group = new THREE.Group();
  private readonly assets = new Map<string, ManifestAsset>();
  private readonly parts = new Map<string, LoadedPart[]>();
  private readonly bodySkins = new Map<string, THREE.BufferGeometry>();
  private readonly characters = new Map<string, Character>();
  private chosen = new Set<string>();
  private disposed = false;
  private ready = false;
  constructor(parent: THREE.Object3D) {
    this.group.name = '体素工坊 · 骨骼人物';
    for (const asset of STUDIO_ASSETS as ManifestAsset[]) if ((STUDIO_CHARACTER_ASSETS as readonly string[]).includes(asset.id)) this.assets.set(asset.id, asset);
    parent.add(this.group);
  }

  /** Citizens drawn by this pool (the box pool leaves them out). */
  get modelled(): ReadonlySet<string> { return this.chosen; }

  async load(baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'): Promise<{ loaded: string[]; failed: string[] }> {
    const loader = new GLTFLoader(), loaded: string[] = [], failed: string[] = [];
    await Promise.all([...this.assets.values()].map(async asset => {
      try {
        const gltf = await loader.loadAsync(baseUrl + asset.url); if (this.disposed) return;
        gltf.scene.updateMatrixWorld(true);
        const list: LoadedPart[] = [];
        gltf.scene.traverse(object => {
          if (object instanceof THREE.SkinnedMesh) list.push({ geometry: object.geometry, material: object.material, bake: new THREE.Matrix4(),
            skin: { joints: object.skeleton.bones.map(b => b.name), inverses: object.skeleton.boneInverses.map(m => m.clone()), bindMatrix: object.bindMatrix.clone() } });
          else if (object instanceof THREE.Mesh) list.push({ geometry: object.geometry, material: object.material, bake: object.matrixWorld.clone() });
        });
        if (!list.length) throw new Error('no meshes');
        this.parts.set(asset.id, list); loaded.push(asset.id);
      } catch (error) { failed.push(asset.id); console.warn(`studio character part ${asset.id} not loaded:`, error); }
    }));
    this.ready = true;
    this.group.userData.studioCharacters = { loaded, failed };
    return { loaded, failed };
  }

  /** Picks the nearest residents and poses their skeletons. `motion` is the box pool's per-resident motion. */
  update(state: SimState, camera: Vec3, quality: Quality, motion: (id: string) => CharacterMotion | undefined): void {
    if (this.disposed || !this.ready) return;
    const range = STUDIO_CHARACTER_RANGE[quality];
    const buried = new Set((state.family?.ceremonies ?? []).filter(c => c.kind === 'funeral' && c.completedAt !== null).map(c => c.subjectId));
    const near = state.citizens.filter(c => c.tier !== 'statistical' && !buried.has(c.id))
      .map(c => ({ c, d: Math.hypot(c.position.x - camera.x, c.position.y - camera.y, c.position.z - camera.z) })).filter(e => e.d <= range.distance)
      .sort((a, b) => a.d - b.d || (a.c.id < b.c.id ? -1 : 1)).slice(0, range.count);
    const next = new Set<string>();
    let built = 0;
    for (const { c } of near) {
      const profile = state.extension?.actorProfiles[c.id], m = motion(c.id); if (!m) continue;
      const active = (state.family?.ceremonies ?? []).find(x => x.completedAt === null && (x.organizerId === c.id || x.guestIds.includes(c.id) || x.kind === 'wedding' && x.subjectId === c.id));
      const context: CharacterContext = { age: profile?.age ?? 30, role: c.role, state: c.state, hour: state.hour, weather: state.weather, health: profile?.health,
        pregnant: (state.family?.pregnancies ?? []).some(p => p.carrierId === c.id), ceremony: active?.kind ?? null,
        infantNearby: Object.entries(state.family?.children ?? {}).some(([childId, child]) => child.parentIds.includes(c.id) && (state.extension?.actorProfiles[childId]?.age ?? 9) < 2
          && state.citizens.some(x => x.id === childId && Math.hypot(x.position.x - c.position.x, x.position.y - c.position.y, x.position.z - c.position.z) < 2)) };
      const look = studioCharacterLook(c.id, context), key = [look.rig, look.body, ...look.parts.map(p => `${p.asset}@${p.mount}`)].join('|');
      let character = this.characters.get(c.id);
      if (!character || character.key !== key) {
        // Building a character costs a few meshes; spread new ones over frames.
        if (built >= 2 && !character) continue;
        if (character) this.release(c.id);
        const fresh = this.build(look, key); if (!fresh) continue;
        character = fresh; built++; this.characters.set(c.id, character); this.group.add(character.holder);
      }
      next.add(c.id);
      const pose = studioCharacterPose(m);
      for (const joint of CHARACTER_JOINTS) { const bone = character.bones.get(joint)!, r = pose[joint]; bone.rotation.set(r?.x ?? 0, 0, r?.z ?? 0); }
      // The studio models face −Z; the game faces +Z at yaw 0.
      character.holder.position.set(c.position.x, c.position.y, c.position.z); character.holder.rotation.set(0, m.yaw + Math.PI, 0);
    }
    for (const id of [...this.characters.keys()]) if (!next.has(id)) this.release(id);
    this.chosen = next;
    this.group.userData.studioCharacterCount = next.size;
  }

  private build(look: CharacterLook, key: string): Character | null {
    const body = this.assets.get(look.body), bodyParts = this.parts.get(look.body); if (!body || !bodyParts) return null;
    const bodyPorts = portMap(body.ports), rest = studioCharacterRest(bodyPorts), holder = new THREE.Group(), bones = new Map<string, THREE.Bone>();
    for (const joint of CHARACTER_JOINTS) {
      const bone = new THREE.Bone(); bone.name = joint; const parent = CHARACTER_PARENT[joint], p = rest[joint], q = parent ? rest[parent] : [0, 0, 0];
      bone.position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); bones.set(joint, bone); (parent ? bones.get(parent)! : holder).add(bone);
    }
    holder.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(CHARACTER_JOINTS.map(j => bones.get(j)!)), skinned: THREE.SkinnedMesh[] = [];
    // The body: rigidly skinned from its own joint ports (shared rule studioBodyJoint).
    for (const [index, part] of bodyParts.entries()) {
      const cacheKey = `${look.body}:${index}`; let geometry = this.bodySkins.get(cacheKey);
      if (!geometry) {
        geometry = part.geometry.clone(); geometry.applyMatrix4(part.bake);
        const position = geometry.getAttribute('position'), count = position.count, indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) { indices[i * 4] = CHARACTER_JOINTS.indexOf(studioBodyJoint(position.getX(i), position.getY(i), bodyPorts) as typeof CHARACTER_JOINTS[number]); weights[i * 4] = 1; }
        geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
        this.bodySkins.set(cacheKey, geometry);
      }
      const mesh = new THREE.SkinnedMesh(geometry, part.material); mesh.bind(skeleton, new THREE.Matrix4()); skinned.push(mesh); holder.add(mesh);
    }
    for (const worn of look.parts) {
      const asset = this.assets.get(worn.asset), list = this.parts.get(worn.asset); if (!asset || !list) continue;
      for (const part of list) {
        if (worn.mount === 'skin' && part.skin) {
          const mapped = part.skin.joints.map(name => bones.get(garmentJoint(name)) ?? bones.get('root')!);
          const mesh = new THREE.SkinnedMesh(part.geometry, part.material); mesh.bind(new THREE.Skeleton(mapped, part.skin.inverses), part.skin.bindMatrix); skinned.push(mesh); holder.add(mesh);
          continue;
        }
        if (worn.mount === 'skin') continue;
        // Rigid: the part (its single-joint skin, if any, sits at its origin) follows one joint.
        const { joint, offset } = studioMountOffset(worn.mount, rest, bodyPorts, { ports: portMap(asset.ports), min: asset.boundsM.min, max: asset.boundsM.max });
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.matrixAutoUpdate = false; mesh.matrix.makeTranslation(offset[0], offset[1], offset[2]).multiply(part.bake);
        bones.get(joint)!.add(mesh);
      }
    }
    for (const mesh of [...skinned]) { mesh.frustumCulled = false; mesh.castShadow = true; }
    return { key, holder, bones, skinned };
  }

  private release(id: string): void {
    const character = this.characters.get(id); if (!character) return;
    for (const mesh of character.skinned) mesh.skeleton.dispose();
    character.holder.removeFromParent(); this.characters.delete(id);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.characters.keys()]) this.release(id);
    for (const geometry of this.bodySkins.values()) geometry.dispose();
    for (const list of this.parts.values()) for (const part of list) { part.geometry.dispose(); for (const m of [part.material].flat()) m.dispose(); }
    this.group.removeFromParent();
  }
}
