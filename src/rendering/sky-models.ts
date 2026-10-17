import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STUDIO_ASSETS } from './studio-prop-layout';

/** The studio sky masters were authored at the renderer's own sky sizes:
 * ENV-110 dome 28,000m (the 14,000m sky sphere), ENV-112 sun 136m (the 68m
 * orb), ENV-113 moon 76m (the 38m orb), ENV-114 star field 26,000m. The dome
 * lends its geometry to the existing day–night sky shader (colours, clouds and
 * night stay procedural); sun and moon replace their orbs; the star field
 * replaces the star points and fades with the same night opacity. Self-lit
 * and unfogged, as the procedural sky. Unity: Runtime/StudioSky.cs draws the
 * same masters with a 30km sky camera before the 6km city camera. */
export const SKY_MODELS = { dome: 'ENV-110', sun: 'ENV-112', moon: 'ENV-113', stars: 'ENV-114' } as const;

function unlit(object: THREE.Object3D, transparent = false): THREE.Material[] {
  const made: THREE.Material[] = [];
  object.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = [o.material].flat().map((m: THREE.Material) => { const source = m as THREE.MeshStandardMaterial;
      const basic = new THREE.MeshBasicMaterial({ color: source.color ?? new THREE.Color('#ffffff'), map: source.map ?? null, fog: false, transparent, depthWrite: !transparent }); made.push(basic); return basic; });
    if (Array.isArray(o.material) && o.material.length === 1) o.material = o.material[0];
    o.frustumCulled = false;
  });
  return made;
}
function centred(scene: THREE.Object3D): THREE.Object3D {
  scene.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(scene), centre = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(); scene.position.sub(centre); holder.add(scene); return holder;
}

export class StudioSkyModels {
  private starMaterials: THREE.Material[] = [];
  private starField: THREE.Object3D | null = null;
  private disposed = false;
  constructor(private readonly scene: THREE.Scene, private readonly sky: THREE.Mesh, private readonly sunOrb: THREE.Mesh, private readonly moonOrb: THREE.Mesh, private readonly stars: THREE.Points) {}

  async load(baseUrl = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'): Promise<string[]> {
    const loader = new GLTFLoader(), loaded: string[] = [];
    const get = async (id: string) => { const asset = STUDIO_ASSETS.find(a => a.id === id); if (!asset) return null; try { const gltf = await loader.loadAsync(baseUrl + asset.url); return this.disposed ? null : gltf.scene; } catch (error) { console.warn(`sky model ${id} not loaded:`, error); return null; } };
    const [dome, sun, moon, stars] = await Promise.all([get(SKY_MODELS.dome), get(SKY_MODELS.sun), get(SKY_MODELS.moon), get(SKY_MODELS.stars)]);
    if (dome) {
      // Only the geometry: the sky shader keeps the day–night colours.
      const holder = centred(dome); holder.updateMatrixWorld(true); const found: THREE.BufferGeometry[] = [];
      holder.traverse(o => { if (!found.length && o instanceof THREE.Mesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); found.push(g); } });
      const geometry = found[0];
      if (geometry) { this.sky.geometry.dispose(); this.sky.geometry = geometry; (this.sky.material as THREE.ShaderMaterial).side = THREE.DoubleSide; loaded.push(SKY_MODELS.dome); }
    }
    for (const [model, orb, id] of [[sun, this.sunOrb, SKY_MODELS.sun], [moon, this.moonOrb, SKY_MODELS.moon]] as const) {
      if (!model) continue;
      const holder = centred(model); unlit(holder); orb.add(holder); (orb.material as THREE.Material).visible = false; loaded.push(id);
    }
    if (stars) {
      const holder = centred(stars); this.starMaterials = unlit(holder, true); holder.renderOrder = -9; this.scene.add(holder); this.starField = holder;
      this.stars.visible = false; loaded.push(SKY_MODELS.stars);
    }
    return loaded;
  }

  /** Follows the camera and the star points' night opacity. */
  update(camera: THREE.Vector3, starOpacity: number): void {
    if (!this.starField) return;
    this.starField.position.copy(camera); this.starField.visible = starOpacity > .01;
    for (const m of this.starMaterials) m.opacity = starOpacity;
  }

  dispose(): void { this.disposed = true; this.starField?.removeFromParent(); for (const m of this.starMaterials) m.dispose(); }
}
