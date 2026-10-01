import * as THREE from 'three';
import type { Vec3, WorldDefinition } from '../types';
import { terrainHeight } from '../world';

interface Block { x: number; y: number; z: number; w: number; h: number; d: number; color: THREE.Color }
interface Segment { a: Vec3; b: Vec3; width: number }
interface SurfaceGeometry { positions: number[]; normals: number[]; colors: number[]; indices: number[] }

/** Landscape is a sparse surface shell, rather than a stack of buried voxels. */
export function buildLandscape(world: WorldDefinition): {
  group: THREE.Group;
  water: THREE.ShaderMaterial[];
  vegetation: THREE.Group;
  dispose(): void;
} {
  const group = new THREE.Group();
  group.name = '群山 · 阶梯地形与水系';
  const vegetation = new THREE.Group();
  vegetation.name = '山林 · 合批松柏';
  group.add(vegetation);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const box = new THREE.BoxGeometry(1, 1, 1);
  geometries.add(box);
  const stone = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .94, metalness: .03 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x574d3b, roughness: 1 });
  const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96 });
  materials.add(stone); materials.add(wood); materials.add(foliage);
  const transform = new THREE.Object3D();

  function batch(name: string, blocks: Block[], material: THREE.Material, parent = group): void {
    if (!blocks.length) return;
    const mesh = new THREE.InstancedMesh(box, material, blocks.length);
    mesh.name = name;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      transform.position.set(b.x, b.y, b.z);
      transform.scale.set(b.w, b.h, b.d);
      transform.rotation.set(0, 0, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, b.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  const dark = new THREE.Color('#355c61');
  const green = new THREE.Color('#618173');
  const cliff = new THREE.Color('#557076');
  const extent = Math.ceil(world.size / 64) * 32;
  // The outer ring is twice as coarse: this retains the silhouette while leaving
  // the instance budget for trees and accessible districts in the inner city.
  const inner = Math.floor(extent * .78 / 64) * 64;
  const chunks = new Map<string, Block[]>();
  const detailed = new Map<string, SurfaceGeometry>();
  const roads: Segment[] = [];
  const roadIndex = new Map<string, Segment[]>();
  const buildingIndex = new Map<string, typeof world.buildings>();
  const surfaceKey = (x: number, z: number) => `${Math.floor(x / 64)}:${Math.floor(z / 64)}`;
  for (const building of world.buildings) {
    for (let x = Math.floor((building.position.x - building.width / 2 - 32) / 64); x <= Math.floor((building.position.x + building.width / 2 + 32) / 64); x++) {
      for (let z = Math.floor((building.position.z - building.depth / 2 - 32) / 64); z <= Math.floor((building.position.z + building.depth / 2 + 32) / 64); z++) {
        const key = `${x}:${z}`, list = buildingIndex.get(key) ?? [];
        list.push(building); buildingIndex.set(key, list);
      }
    }
  }
  for (const edge of world.edges) {
    if (!['road', 'bridge', 'lightRail'].includes(edge.mode)) continue;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i];
      const segment = { a, b, width: edge.id === 'road-airport-runway-strip' ? 22 : edge.mode === 'road' ? 6 : 4 };
      roads.push(segment);
      if (edge.mode !== 'road') continue;
      for (let x = Math.floor((Math.min(a.x, b.x) - 32) / 64); x <= Math.floor((Math.max(a.x, b.x) + 32) / 64); x++) {
        for (let z = Math.floor((Math.min(a.z, b.z) - 32) / 64); z <= Math.floor((Math.max(a.z, b.z) + 32) / 64); z++) {
          const key = `${x}:${z}`, list = roadIndex.get(key) ?? [];
          list.push(segment); roadIndex.set(key, list);
        }
      }
    }
  }
  const rivers: Segment[] = [];
  for (let i = 1; i < world.river.length; i++) rivers.push({ a: world.river[i - 1], b: world.river[i], width: 16 });
  const tops = new Map<string, number>();
  function cellTop(x: number, z: number, step: number): number {
    const id = `${x}:${z}:${step}`, cached = tops.get(id);
    if (cached !== undefined) return cached;
    let y = terrainHeight(world, x, z);
    let buildingTop: number | undefined;
    for (const building of buildingIndex.get(surfaceKey(x, z)) ?? []) {
      if (Math.abs(x - building.position.x) >= building.width / 2 || Math.abs(z - building.position.z) >= building.depth / 2) continue;
      const top = building.basements || building.kind === 'dock' ? Math.min(y, building.position.y - .2) : building.position.y - .2;
      buildingTop = Math.min(buildingTop ?? top, top);
    }
    // Footprints take precedence over adjacent, lower roads just as they do in
    // the world's collision terrain. Boundary cells are split at the exact
    // footprint below; basements and waterborne docks retain their lower bed.
    if (buildingTop !== undefined) y = buildingTop;
    else {
      for (const road of roadIndex.get(surfaceKey(x, z)) ?? []) {
        const t = segmentProgress(x, z, road.a, road.b);
        if (distanceToSegment(x, z, road.a, road.b) < step * .71 + road.width) y = Math.min(y, road.a.y + (road.b.y - road.a.y) * t - .7);
      }
      for (const river of rivers) {
        if (distanceToSegment(x, z, river.a, river.b) >= step * .71 + river.width) continue;
        const t = segmentProgress(x, z, river.a, river.b);
        y = Math.min(y, river.a.y + (river.b.y - river.a.y) * t - 3);
      }
    }
    y = Math.floor(y / world.voxelSize) * world.voxelSize;
    tops.set(id, y);
    return y;
  }
  function colorAt(x: number, z: number, top: number, slope: number): THREE.Color {
    const tint = dark.clone().lerp(green, Math.max(.15, .72 - top / 1300));
    if (slope > 35) tint.lerp(cliff, .5);
    // Broad, continuous color fields keep district terraces calm at a distance.
    // Per-cell noise made the fine city ground read as a checkerboard.
    return tint.multiplyScalar(.985 + Math.sin(x / 420) * Math.cos(z / 380) * .015);
  }
  const detailedCell = (x: number, z: number, step: number) => world.districts.some(d => Math.hypot(x - d.center.x, z - d.center.z) < d.radius + 40)
    || (buildingIndex.get(surfaceKey(x, z)) ?? []).some(b => Math.abs(x - b.position.x) < (b.width + step) / 2 + .2 && Math.abs(z - b.position.z) < (b.depth + step) / 2 + .2);
  const cutCells = new Map<string, { xs: number[]; zs: number[] }>();
  function fineCuts(x: number, z: number): { xs: number[]; zs: number[] } {
    const key = `${x}:${z}`, cached = cutCells.get(key);
    if (cached) return cached;
    const xs = [x - 4, x + 4], zs = [z - 4, z + 4];
    for (const b of buildingIndex.get(surfaceKey(x, z)) ?? []) {
      if (Math.abs(x - b.position.x) >= b.width / 2 + 4 || Math.abs(z - b.position.z) >= b.depth / 2 + 4) continue;
      for (const edge of [b.position.x - b.width / 2, b.position.x + b.width / 2]) if (edge > x - 4 && edge < x + 4) xs.push(edge);
      for (const edge of [b.position.z - b.depth / 2, b.position.z + b.depth / 2]) if (edge > z - 4 && edge < z + 4) zs.push(edge);
    }
    const cuts = { xs: [...new Set(xs)].sort((a, b) => a - b), zs: [...new Set(zs)].sort((a, b) => a - b) };
    cutCells.set(key, cuts);
    return cuts;
  }
  function renderedGroundAt(x: number, z: number): number {
    const outside = Math.abs(x) >= inner || Math.abs(z) >= inner;
    const coarseStep = outside ? 64 : 32;
    const start = outside ? -extent : -inner;
    const cx = Math.floor((x - start) / coarseStep) * coarseStep + start + coarseStep / 2;
    const cz = Math.floor((z - start) / coarseStep) * coarseStep + start + coarseStep / 2;
    if (detailedCell(cx, cz, coarseStep)) {
      const fx = Math.floor((x + inner) / 8) * 8 - inner + 4;
      const fz = Math.floor((z + inner) / 8) * 8 - inner + 4;
      const { xs, zs } = fineCuts(fx, fz);
      const ix = xs.findIndex((a, i) => i < xs.length - 1 && x >= a && x < xs[i + 1]);
      const iz = zs.findIndex((a, i) => i < zs.length - 1 && z >= a && z < zs[i + 1]);
      return cellTop((xs[ix] + xs[ix + 1]) / 2, (zs[iz] + zs[iz + 1]) / 2, Math.max(xs[ix + 1] - xs[ix], zs[iz + 1] - zs[iz]));
    }
    return cellTop(cx, cz, coarseStep);
  }
  function detailedSurface(x: number, z: number, key: string): void {
    let geometry = detailed.get(key);
    if (!geometry) { geometry = { positions: [], normals: [], colors: [], indices: [] }; detailed.set(key, geometry); }
    const { xs, zs } = fineCuts(x, z);
    for (let ix = 1; ix < xs.length; ix++) for (let iz = 1; iz < zs.length; iz++) {
      const a = xs[ix - 1], b = xs[ix], c = zs[iz - 1], d = zs[iz], mx = (a + b) / 2, mz = (c + d) / 2;
      const top = cellTop(mx, mz, Math.max(b - a, d - c));
      const west = renderedGroundAt(a - .001, mz), east = renderedGroundAt(b + .001, mz), north = renderedGroundAt(mx, c - .001), south = renderedGroundAt(mx, d + .001);
      const color = colorAt(mx, mz, top, top - Math.min(west, east, north, south));
      const sideColor = color.clone().lerp(new THREE.Color('#7a9289'), .12);
      function quad(points: number[], normal: number[]): void {
        const offset = geometry!.positions.length / 3;
        geometry!.positions.push(...points);
        const faceColor = normal[1] ? color : sideColor;
        for (let i = 0; i < 4; i++) { geometry!.normals.push(...normal); geometry!.colors.push(faceColor.r, faceColor.g, faceColor.b); }
        geometry!.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      }
      quad([a, top, c, a, top, d, b, top, d, b, top, c], [0, 1, 0]);
      if (west < top) quad([a, west, d, a, top, d, a, top, c, a, west, c], [-1, 0, 0]);
      if (east < top) quad([b, east, c, b, top, c, b, top, d, b, east, d], [1, 0, 0]);
      if (north < top) quad([a, north, c, a, top, c, b, top, c, b, north, c], [0, 0, -1]);
      if (south < top) quad([b, south, d, b, top, d, a, top, d, a, south, d], [0, 0, 1]);
    }
  }
  function surface(x: number, z: number, step: number): void {
    const key = `${Math.floor((x + extent) / 640)}:${Math.floor((z + extent) / 640)}`;
    if (detailedCell(x, z, step)) {
      for (let dx = -step / 2 + 4; dx < step / 2; dx += 8) for (let dz = -step / 2 + 4; dz < step / 2; dz += 8) detailedSurface(x + dx, z + dz, key);
      return;
    }
    const top = cellTop(x, z, step);
    const neighbors = [cellTop(x - step, z, step), cellTop(x + step, z, step), cellTop(x, z - step, step), cellTop(x, z + step, step)];
    const bottom = Math.min(top - 10, ...neighbors.map(h => h - 10));
    const slope = top - Math.min(...neighbors);
    const tint = colorAt(x, z, top, slope);
    let blocks = chunks.get(key);
    if (!blocks) { blocks = []; chunks.set(key, blocks); }
    blocks.push({ x, y: (top + bottom) / 2, z, w: step + .06, h: top - bottom, d: step + .06, color: tint });
  }
  for (let x = -inner + 16; x < inner; x += 32) {
    for (let z = -inner + 16; z < inner; z += 32) surface(x, z, 32);
  }
  for (let x = -extent + 32; x < extent; x += 64) {
    for (let z = -extent + 32; z < extent; z += 64) {
      if (Math.abs(x) < inner && Math.abs(z) < inner) continue;
      surface(x, z, 64);
    }
  }
  for (const [key, blocks] of chunks) batch(`山体区块 ${key}`, blocks, stone);
  const detailMaterial = stone.clone(); detailMaterial.vertexColors = true;
  materials.add(detailMaterial);
  for (const [key, data] of detailed) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    geometry.setIndex(data.indices);
    geometry.computeBoundingSphere();
    geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, detailMaterial);
    mesh.name = `城区体素地形 ${key}`; mesh.receiveShadow = true;
    group.add(mesh);
  }

  batch('山地基底', [{ x: 0, y: -84, z: 0, w: world.size * 2.1, h: 120, d: world.size * 2.1, color: new THREE.Color('#304f57') }], stone);
  // Asymmetric, overlapping massifs create connected ridges and valleys. The
  // same sparse shell strategy avoids both solid voxel stacks and repeated
  // concentric pyramid silhouettes that compete with the city's real peaks.
  const farExtent = extent + 1536;
  const ridgePeaks = Array.from({ length: 23 }, (_, i) => {
    const angle = i / 23 * Math.PI * 2 + (hash(i, 201, world.seed) - .5) * .42;
    const radius = extent + 470 + hash(i, 202, world.seed) * 1050;
    const rotation = angle + .5 + hash(i, 203, world.seed) * 1.4;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
      height: 260 + hash(i, 204, world.seed) * 235,
      long: 540 + hash(i, 205, world.seed) * 560,
      short: 290 + hash(i, 206, world.seed) * 330,
      cos: Math.cos(rotation), sin: Math.sin(rotation) };
  });
  const farHeights = new Map<string, number>();
  function ridgeHeight(x: number, z: number): number {
    const key = `${x}:${z}`, cached = farHeights.get(key);
    if (cached !== undefined) return cached;
    let highest = 0, second = 0;
    for (const peak of ridgePeaks) {
      const dx = x - peak.x, dz = z - peak.z;
      const a = (dx * peak.cos + dz * peak.sin) / peak.long;
      const b = (-dx * peak.sin + dz * peak.cos) / peak.short;
      const height = peak.height * Math.exp(-1.8 * (a * a + b * b));
      if (height > highest) { second = highest; highest = height; } else if (height > second) second = height;
    }
    const distance = Math.max(Math.abs(x), Math.abs(z));
    const innerBlend = THREE.MathUtils.smoothstep(distance, extent, extent + 300);
    const outerBlend = 1 - THREE.MathUtils.smoothstep(distance, farExtent - 480, farExtent);
    const relief = highest + second * .16 + Math.sin(x / 240 + .7) * Math.cos(z / 330) * 11;
    const height = -24 + Math.floor(Math.max(0, Math.min(550, relief)) * innerBlend * outerBlend / 12) * 12;
    farHeights.set(key, height);
    return height;
  }
  const distant = new Map<string, Block[]>();
  for (let x = -farExtent + 48; x < farExtent; x += 96) {
    for (let z = -farExtent + 48; z < farExtent; z += 96) {
      if (Math.abs(x) < extent && Math.abs(z) < extent) continue;
      const top = ridgeHeight(x, z);
      if (top <= -12) continue;
      const bottom = Math.min(top - 12, ridgeHeight(x - 96, z) - 12, ridgeHeight(x + 96, z) - 12, ridgeHeight(x, z - 96) - 12, ridgeHeight(x, z + 96) - 12);
      const key = `${x < 0 ? '西' : '东'}${z < 0 ? '北' : '南'}`;
      const blocks = distant.get(key) ?? [];
      blocks.push({ x, y: (top + bottom) / 2, z, w: 96.06, h: top - bottom, d: 96.06,
        color: new THREE.Color('#4b6b78').lerp(new THREE.Color('#69818b'), Math.max(0, top) / 1500) });
      distant.set(key, blocks);
    }
  }
  for (const [key, blocks] of distant) batch(`远山山脊 · ${key}`, blocks, stone);

  const trunks: Block[] = [], crowns: Block[] = [];
  const treeLimit = 1050;
  for (let candidate = 0; candidate < treeLimit * 8 && trunks.length < treeLimit; candidate++) {
    const x = (hash(candidate, 38, world.seed) - .5) * world.size * .96;
    const z = (hash(candidate, 73, world.seed) - .5) * world.size * .96;
    const y = renderedGroundAt(x, z);
    if (y < 10 || y > 860) continue;
    // Slopes, door approaches, roads, and water remain clear of vegetation.
    if (Math.abs(terrainHeight(world, x + 12, z) - y) > 21 || Math.abs(terrainHeight(world, x, z + 12) - y) > 21) continue;
    if (world.buildings.some(b => {
      const dx = x - b.position.x, dz = z - b.position.z;
      const cos = Math.cos(b.rotation), sin = Math.sin(b.rotation);
      return Math.abs(dx * cos + dz * sin) < b.width / 2 + 13 && Math.abs(-dx * sin + dz * cos) < b.depth / 2 + 13;
    })) continue;
    if (roads.some(s => distanceToSegment(x, z, s.a, s.b) < s.width + 5)) continue;
    if (rivers.some(s => distanceToSegment(x, z, s.a, s.b) < s.width + 8)) continue;
    if (Math.hypot(x - world.waterfall.bottom.x, z - world.waterfall.bottom.z) < 52) continue;
    const height = 14 + hash(candidate, 92, world.seed) * 16;
    const treeColor = new THREE.Color('#336754').lerp(new THREE.Color('#77906a'), hash(candidate, 91, world.seed) * .6);
    trunks.push({ x, y: y + height * .32, z, w: 1.3, h: height * .64, d: 1.3, color: new THREE.Color('#695842') });
    for (let tier = 0; tier < 3; tier++) crowns.push({ x, y: y + height * (.48 + tier * .18), z,
      w: height * (.48 - tier * .13), h: height * .25, d: height * (.48 - tier * .13), color: treeColor });
  }
  batch('松柏树干', trunks, wood, vegetation);
  batch('三层松柏树冠', crowns, foliage, vegetation);

  const water: THREE.ShaderMaterial[] = [];
  const streamMaterial = createWater(false);
  const fallMaterial = createWater(true);
  water.push(streamMaterial, fallMaterial);
  materials.add(streamMaterial); materials.add(fallMaterial);
  // One connected ribbon follows the supplied carved river profile. Adjacent
  // segments share vertices, so bends cannot leave cracks in the creek surface.
  if (world.river.length > 1) {
    const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
    let distance = 0;
    for (let i = 0; i < world.river.length; i++) {
      const p = world.river[i], previous = world.river[Math.max(0, i - 1)], next = world.river[Math.min(world.river.length - 1, i + 1)];
      if (i) distance += Math.hypot(p.x - previous.x, p.z - previous.z);
      const dx = next.x - previous.x, dz = next.z - previous.z;
      const length = Math.hypot(dx, dz) || 1;
      const width = 12 + Math.min(i, 5) * .6;
      const nx = -dz / length, nz = dx / length;
      vertices.push(p.x + nx * width, p.y + .55, p.z + nz * width, p.x - nx * width, p.y + .55, p.z - nz * width);
      uvs.push(0, distance / 90, 1, distance / 90);
      if (i) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    geometries.add(geometry);
    const creek = new THREE.Mesh(geometry, streamMaterial);
    creek.name = '下游溪流 · 连续水面'; creek.renderOrder = 2;
    group.add(creek);
  }

  const top = world.waterfall.top, bottom = world.waterfall.bottom;
  const fallDirection = new THREE.Vector3(bottom.x - top.x, 0, bottom.z - top.z);
  if (fallDirection.lengthSq() < 1) fallDirection.set(0, 0, 1);
  fallDirection.normalize();
  const tangent = new THREE.Vector3(fallDirection.z, 0, -fallDirection.x);
  const fallVertices: number[] = [];
  for (const point of [top, bottom]) for (const side of [-1, 1]) fallVertices.push(
    point.x + tangent.x * world.waterfall.width / 2 * side,
    point.y + .6,
    point.z + tangent.z * world.waterfall.width / 2 * side);
  const fallGeometry = new THREE.BufferGeometry();
  fallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fallVertices, 3));
  fallGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  fallGeometry.setIndex([0, 2, 1, 1, 2, 3]); fallGeometry.computeVertexNormals();
  geometries.add(fallGeometry);
  const fall = new THREE.Mesh(fallGeometry, fallMaterial);
  fall.name = '云瀑 · 流动水帘'; fall.renderOrder = 3;
  group.add(fall);

  // A broad plunge pool gives the waterfall a visible landing and joins the
  // first creek section; its stepped shoreline is cut by terrainHeight.
  const poolGeometry = new THREE.CircleGeometry(52, 12);
  poolGeometry.rotateX(-Math.PI / 2);
  geometries.add(poolGeometry);
  const pool = new THREE.Mesh(poolGeometry, streamMaterial);
  pool.position.set(bottom.x, bottom.y + .65, bottom.z);
  pool.name = '瀑下碧潭'; pool.renderOrder = 2;
  group.add(pool);

  return { group, water, vegetation, dispose() {
    group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear();
  } };
}

function hash(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233 + seed * .113) * 43758.5453;
  return value - Math.floor(value);
}

function distanceToSegment(x: number, z: number, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = segmentProgress(x, z, a, b);
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

function segmentProgress(x: number, z: number, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  return lengthSquared ? THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / lengthSquared, 0, 1) : 0;
}

function createWater(falling: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, light: { value: 1 }, falling: { value: falling ? 1 : 0 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; uniform float light; uniform float falling; varying vec2 vUv;
      void main() {
        float flow = vUv.y * mix(22.0, 45.0, falling) - time * mix(0.9, 4.5, falling);
        float streak = sin(flow + sin(vUv.x * 24.0) * 0.7);
        float ripple = pow(max(0.0, streak), 9.0);
        vec3 jade = mix(vec3(0.23, 0.59, 0.61), vec3(0.65, 0.88, 0.84), falling * 0.66);
        vec3 color = mix(jade, vec3(0.84, 0.98, 0.93), ripple * mix(0.26, 0.52, falling));
        color *= mix(0.32, 1.0, clamp(light, 0.0, 1.0));
        float edge = smoothstep(0.0, 0.09, vUv.x) * smoothstep(0.0, 0.09, 1.0 - vUv.x);
        gl_FragColor = vec4(color, mix(0.76, 0.86, falling) * mix(0.5, 1.0, edge));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
