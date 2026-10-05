import * as THREE from 'three';
import { getAviationPads } from './aviation';
import type { SimState, WorldDefinition } from './types';

/** Reads the same city aircraft and ground stands that authorize boarding. */
export class AviationRenderer {
  private root = new THREE.Group();
  private aircraft = new Map<string, THREE.Group>();
  private rotors: { craftId: string; mesh: THREE.Mesh }[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  constructor(scene: THREE.Scene, world: WorldDefinition) {
    scene.add(this.root);
    const box = new THREE.BoxGeometry(1, 1, 1); this.geometries.push(box);
    const material = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .75, ...extra }); this.materials.push(m); return m; };
    const stone = material(0x747b72), gold = material(0xd1ad64), body = material(0xa9c4bd), military = material(0x465b60), dark = material(0x263a3b), glass = material(0x77b7b5, { transparent: true, opacity: .28, depthWrite: false, metalness: .25 });
    const cube = (group: THREE.Group, size: [number, number, number], p: [number, number, number], mat: THREE.Material) => {
      const mesh = new THREE.Mesh(box, mat); mesh.scale.set(...size); mesh.position.set(...p); group.add(mesh); return mesh;
    };
    for (const pad of getAviationPads(world)) {
      const stand = new THREE.Group(); stand.position.set(pad.position.x, pad.position.y, pad.position.z);
      const side = pad.kind === 'military' ? 14 : 7;
      cube(stand, [side, .2, side], [0, 0, 0], stone);
      for (const x of [-1, 1]) cube(stand, [.2, .02, side - 1], [x * (side / 2 - .5), .12, 0], gold);
      cube(stand, [side - 1, .02, .2], [0, .12, 0], gold);
      const marker = new THREE.Group(); marker.position.set(side / 2 + .8, 1.5, 0);
      cube(marker, [.2, 3, .2], [0, 0, 0], dark); cube(marker, [1.8, .8, .2], [0, 1.2, 0], pad.kind === 'military' ? military : body);
      stand.add(marker); this.root.add(stand);
      const id = `aircraft-${pad.id}`, craft = new THREE.Group();
      const jet = pad.kind === 'military';
      cube(craft, [jet ? 2 : 1.6, .8, jet ? 7.2 : 2.8], [0, .3, jet ? .4 : 0], jet ? military : body);
      cube(craft, [1.2, .2, 1.4], [0, .7, -.5], dark); // visible control console below the player's eye
      cube(craft, [.2, 1.2, 2], [-.8, 1, .2], glass); cube(craft, [.2, 1.2, 2], [.8, 1, .2], glass);
      cube(craft, [1.8, .2, 2.4], [0, 1.6, .2], jet ? military : body);
      if (jet) {
        cube(craft, [8.4, .2, 2.4], [0, .3, 1.2], military);
        cube(craft, [.4, 1.8, 2], [0, 1.1, 3.2], military);
        cube(craft, [4, .2, 1], [0, .8, 3.2], military);
        cube(craft, [1.2, .6, 2], [0, .2, -4.2], dark);
        for (const x of [-2.6, 2.6]) cube(craft, [1.6, .6, 1.6], [x, .1, .8], dark);
      } else {
        for (const x of [-1.8, 1.8]) for (const z of [-1.5, 1.5]) {
          cube(craft, [1.8, .2, .2], [x / 2, .4, z], dark);
          const rotor = cube(craft, [2, .08, .2], [x, .55, z], gold); this.rotors.push({ craftId: id, mesh: rotor });
          cube(craft, [.2, .8, .2], [x * .75, -.35, z * .7], dark);
        }
      }
      craft.position.set(pad.position.x, pad.position.y + .6, pad.position.z); this.aircraft.set(id, craft); this.root.add(craft);
    }
  }
  update(state: SimState, elapsed: number): void {
    for (const data of state.aviation?.aircraft ?? []) {
      const craft = this.aircraft.get(data.id); if (!craft) continue;
      craft.position.set(data.position.x, data.position.y, data.position.z);
      craft.rotation.set(data.status === 'parked' ? 0 : data.pitch, data.yaw, 0, 'YXZ');
    }
    for (const rotor of this.rotors) {
      const data = state.aviation?.aircraft.find(c => c.id === rotor.craftId);
      if (data && data.status !== 'parked') rotor.mesh.rotation.y = elapsed * 35;
    }
  }
  dispose(): void { this.root.removeFromParent(); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); }
}
