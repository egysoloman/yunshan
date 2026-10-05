import * as THREE from 'three';
import type { SimState, WorldDefinition } from '../types';
import { isRoadOpen, roadRevision } from '../roads';
import { samplePolyline } from '../world';
import { deckWidth } from '../transport-geometry';

/** Display the same closure read by navigation and physical entry checks. */
export class RoadClosureOverlay {
  readonly group = new THREE.Group();
  private state: SimState | null = null;
  private revision = -1;
  private lineMaterial = new THREE.LineDashedMaterial({ color: '#b44932', dashSize: 3, gapSize: 2, depthTest: true });
  private warningMaterial = new THREE.MeshStandardMaterial({ color: '#dfad50', roughness: .85 });
  private darkMaterial = new THREE.MeshStandardMaterial({ color: '#3f423b', roughness: .9 });
  constructor(private readonly world: WorldDefinition) { this.group.name = '道路关闭标记'; }
  update(state: SimState): void {
    const revision = roadRevision(state);
    if (this.state === state && this.revision === revision) return;
    this.clear(); this.state = state; this.revision = revision;
    const closed = this.world.edges.filter(edge => !isRoadOpen(state, edge.id));
    this.group.userData.edgeIds = closed.map(edge => edge.id);
    this.group.userData.revision = revision;
    for (const edge of closed) {
      const geometry = new THREE.BufferGeometry().setFromPoints(edge.points.map(p => new THREE.Vector3(p.x, p.y + .1, p.z)));
      const line = new THREE.Line(geometry, this.lineMaterial); line.computeLineDistances(); line.name = '关闭道路:' + edge.id; this.group.add(line);
      for (const progress of [Math.min(.02, 2 / Math.max(1, edge.length)), Math.max(.98, 1 - 2 / Math.max(1, edge.length))]) {
        const at = samplePolyline(edge.points, progress), before = samplePolyline(edge.points, Math.max(0, progress - .001)), after = samplePolyline(edge.points, Math.min(1, progress + .001));
        const angle = Math.atan2(after.x - before.x, after.z - before.z);
        const marker = new THREE.Group(); marker.name = '关闭路口:' + edge.id; marker.position.set(at.x, at.y, at.z); marker.rotation.y = angle;
        const width = Math.min(10, deckWidth(edge) - 1);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(width, .26, .18), this.warningMaterial); beam.position.y = .9; marker.add(beam);
        for (const x of [-width * .4, width * .4]) {
          const foot = new THREE.Mesh(new THREE.BoxGeometry(.12, .9, .5), this.darkMaterial); foot.position.set(x, .45, 0); marker.add(foot);
        }
        for (let x = -width / 2 + .5; x < width / 2; x += 1.2) {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(.24, .27, .185), this.darkMaterial); stripe.position.set(x, .9, 0); stripe.rotation.z = -.5; marker.add(stripe);
        }
        this.group.add(marker);
      }
    }
  }
  private clear(): void {
    this.group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose(); });
    this.group.clear();
  }
  dispose(): void {
    this.clear(); this.lineMaterial.dispose(); this.warningMaterial.dispose(); this.darkMaterial.dispose(); this.state = null;
  }
}
