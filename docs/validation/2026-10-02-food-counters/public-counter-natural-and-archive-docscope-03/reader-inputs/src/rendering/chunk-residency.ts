import * as THREE from 'three';
import { getFloorDimensions } from '../access';
import type { Building, Quality, Vec3 } from '../types';

export const BUILDING_RENDER_CHUNK_SIZE = 96;
export const NEAR_CHUNK_CAPACITY: Readonly<Record<Quality, number>> = Object.freeze({ low: 8, balanced: 12, high: 18 });
const NEAR_DISTANCE: Readonly<Record<Quality, number>> = Object.freeze({ low: 70, balanced: 120, high: 230 });
const EXIT_MARGIN = 24, RESIDENT_PREFERENCE = 8;

/** Metadata holds authoritative buildings, never instantiated near geometry. */
export interface BuildingRenderChunk {
  readonly id: string;
  readonly center: Readonly<Vec3>;
  readonly radius: number;
  readonly minY: number;
  readonly maxY: number;
  readonly buildings: readonly Building[];
  readonly buildingIds: ReadonlySet<string>;
}
export interface NearChunkView {
  quality?: Quality;
  insideBuildingId?: string | null;
  renderDistance?: number;
}

export function createBuildingRenderChunks(buildings: readonly Building[], cellSize = BUILDING_RENDER_CHUNK_SIZE): BuildingRenderChunk[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('建筑渲染区块尺寸无效。');
  const cells = new Map<string, Building[]>(), ids = new Set<string>();
  for (const building of buildings) {
    if (ids.has(building.id)) throw new Error('重复建筑渲染身份。'); ids.add(building.id);
    const id = `${Math.floor(building.position.x / cellSize)}:${Math.floor(building.position.z / cellSize)}`;
    const cell = cells.get(id); if (cell) cell.push(building); else cells.set(id, [building]);
  }
  return [...cells].map(([id, sites]) => {
    const center = sites.reduce((point, site) => ({ x: point.x + site.position.x / sites.length, y: point.y + site.position.y / sites.length, z: point.z + site.position.z / sites.length }), { x: 0, y: 0, z: 0 });
    let radius = 0, minY = Infinity, maxY = -Infinity;
    for (const site of sites) {
      let footprintRadius = Math.hypot(site.width, site.depth) / 2;
      for (let floor = 0; floor < site.floors; floor++) {
        const footprint = getFloorDimensions(site, floor);
        footprintRadius = Math.max(footprintRadius, Math.hypot(footprint.width, footprint.depth) / 2);
      }
      // Rotation cannot escape this footprint circle; include the existing
      // structural eaves/fascia. The bounds include real underground floors.
      radius = Math.max(radius, Math.hypot(site.position.x - center.x, site.position.z - center.z) + footprintRadius + 7);
      const fh = site.height / Math.max(1, site.floors), base = site.position.y + .6;
      minY = Math.min(minY, base - fh * (site.basements ?? 0) - 1);
      maxY = Math.max(maxY, base + site.height + 10);
    }
    return Object.freeze({ id, center: Object.freeze(center), radius, minY, maxY, buildings: Object.freeze([...sites]), buildingIds: new Set(sites.map(site => site.id)) });
  });
}

/** Distance to the building shell, including its occupied vertical extent.
 * A camera beside floor 25 is as near as one beside the ground floor. */
export function buildingChunkDistance(chunk: BuildingRenderChunk, camera: Vec3): number {
  const horizontal = Math.max(0, Math.hypot(camera.x - chunk.center.x, camera.z - chunk.center.z) - chunk.radius);
  const vertical = Math.max(0, chunk.minY - camera.y, camera.y - chunk.maxY) * .6;
  return Math.hypot(horizontal, vertical);
}

/** Narrow-phase priority uses the real rotated, stepped occupied floors. A
 * wide bounding circle must not displace another building's nearby entrance. */
export function buildingChunkBodyDistance(chunk: BuildingRenderChunk, camera: Vec3): number {
  let distance = Infinity;
  for (const site of chunk.buildings) {
    const dx = camera.x - site.position.x, dz = camera.z - site.position.z, cos = Math.cos(site.rotation), sin = Math.sin(site.rotation);
    const x = dx * cos - dz * sin, z = dx * sin + dz * cos, fh = site.height / Math.max(1, site.floors), base = site.position.y + .6;
    for (let floor = -(site.basements ?? 0); floor < site.floors; floor++) {
      const footprint = getFloorDimensions(site, floor), horizontalX = Math.max(0, Math.abs(x) - footprint.width / 2), horizontalZ = Math.max(0, Math.abs(z) - footprint.depth / 2);
      const minY = base + floor * fh, maxY = minY + fh, vertical = Math.max(0, minY - camera.y, camera.y - maxY) * .6;
      distance = Math.min(distance, Math.hypot(horizontalX, horizontalZ, vertical));
      if (distance === 0) return 0;
    }
  }
  return distance;
}

export function selectNearBuildingChunks(chunks: readonly BuildingRenderChunk[], camera: Vec3, view: NearChunkView = {}, residents: ReadonlySet<string> = new Set()): BuildingRenderChunk[] {
  if (![camera.x, camera.y, camera.z].every(Number.isFinite)) throw new RangeError('建筑渲染相机位置无效。');
  const quality = view.quality ?? 'balanced', distanceLimit = Math.min(NEAR_DISTANCE[quality], Math.max(0, view.renderDistance ?? Infinity));
  const candidates = chunks.map(chunk => {
    const inside = !!view.insideBuildingId && chunk.buildingIds.has(view.insideBuildingId), distance = buildingChunkDistance(chunk, camera), resident = residents.has(chunk.id);
    return { chunk, inside, distance, resident };
  }).filter(item => item.inside || item.distance <= distanceLimit + (item.resident ? EXIT_MARGIN : 0)).map(item => {
    const bodyDistance = buildingChunkBodyDistance(item.chunk, camera);
    const entrance = item.chunk.buildings.some(site => Math.hypot(site.door.x - camera.x, site.door.y - camera.y, site.door.z - camera.z) <= 6);
    return { ...item, entrance, bodyDistance, score: Math.max(0, bodyDistance - (item.resident ? RESIDENT_PREFERENCE : 0)) };
  });
  candidates.sort((a, b) => Number(b.inside) - Number(a.inside) || Number(b.entrance) - Number(a.entrance) || a.score - b.score || Number(b.resident) - Number(a.resident) || a.bodyDistance - b.bodyDistance || a.chunk.id.localeCompare(b.chunk.id));
  return candidates.slice(0, NEAR_CHUNK_CAPACITY[quality]).map(item => item.chunk);
}

export interface ResidentBuildingChunk<T> { readonly chunk: BuildingRenderChunk; readonly resource: T }
export interface NearChunkCallbacks<T> {
  /** Build in isolation. A throwing factory must clean up its partial build. */
  create(chunk: BuildingRenderChunk): T;
  /** Publish/unpublish scene, interior refs and matching far matrices together.
   * New resources must receive the current interior cutaway here, even when
   * the renderer's cached interior id/floor has not changed. */
  activate(chunk: BuildingRenderChunk, resource: T, near: boolean): void;
  /** Free this chunk's owned geometries/instance buffers; keep palette materials. */
  release(chunk: BuildingRenderChunk, resource: T): void;
}

/** A finite cache of actual near resources. There is no hidden city-sized pool.
 * Far LOD and the simulation remain owned by their existing managers. */
export class NearChunkResidency<T> {
  private readonly entries = new Map<string, ResidentBuildingChunk<T>>();
  private disposed = false;
  private created = 0;
  private released = 0;
  private maximum = 0;
  private failures = 0;
  private lastError = '';
  constructor(readonly chunks: readonly BuildingRenderChunk[], private readonly callbacks: NearChunkCallbacks<T>) {
    if (new Set(chunks.map(chunk => chunk.id)).size !== chunks.length) throw new Error('重复建筑渲染区块。');
  }

  update(camera: Vec3, view: NearChunkView = {}): readonly ResidentBuildingChunk<T>[] {
    if (this.disposed) return [];
    const selected = selectNearBuildingChunks(this.chunks, camera, view, new Set(this.entries.keys())), wanted = new Set(selected.map(chunk => chunk.id));
    // Evict before creating, so switching quality/inside priority never exceeds
    // the live capacity even transiently during GPU buffer allocation.
    for (const [id, entry] of this.entries) if (!wanted.has(id)) this.remove(entry);
    for (const chunk of selected) if (!this.entries.has(chunk.id)) {
      let entry: ResidentBuildingChunk<T> | undefined;
      try {
        entry = { chunk, resource: this.callbacks.create(chunk) }; this.created++;
        this.maximum = Math.max(this.maximum, this.entries.size + 1);
        this.callbacks.activate(chunk, entry.resource, true);
        this.entries.set(chunk.id, entry);
      } catch (error) {
        this.failures++; this.lastError = error instanceof Error ? error.message : String(error);
        // A failed publication restores the far silhouette and removes partial
        // indices before releasing the fully returned near resource.
        if (entry) { try { this.callbacks.activate(chunk, entry.resource, false); } finally { this.callbacks.release(chunk, entry.resource); this.released++; } }
      }
    }
    return this.residents();
  }

  residents(): readonly ResidentBuildingChunk<T>[] { return [...this.entries.values()]; }
  get(id: string): T | undefined { return this.entries.get(id)?.resource; }
  hasBuilding(id: string): boolean { for (const entry of this.entries.values()) if (entry.chunk.buildingIds.has(id)) return true; return false; }
  getStats() { return { resident: this.entries.size, total: this.chunks.length, created: this.created, released: this.released, maximumResident: this.maximum, failures: this.failures, lastError: this.lastError, disposed: this.disposed }; }
  private remove(entry: ResidentBuildingChunk<T>): void {
    this.entries.delete(entry.chunk.id);
    try { this.callbacks.activate(entry.chunk, entry.resource, false); }
    finally { this.callbacks.release(entry.chunk, entry.resource); this.released++; }
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const entry of [...this.entries.values()]) this.remove(entry);
  }
}

/** For BoxBatch groups with chunk-owned geometry and shared palette materials.
 * The caller must also delete its interior references before invoking this. */
export function disposeNearChunkGroup(group: THREE.Group): { geometries: number; instanceBuffers: number } {
  group.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>(); let instanceBuffers = 0;
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) geometries.add(object.geometry);
    if (object instanceof THREE.InstancedMesh) { object.dispose(); instanceBuffers++; }
  });
  group.clear(); geometries.forEach(geometry => geometry.dispose());
  return { geometries: geometries.size, instanceBuffers };
}
