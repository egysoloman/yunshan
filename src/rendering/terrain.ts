import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality, Vec3, WorldDefinition } from '../types';
import { getWaterfallPath, terrainHeight } from '../world';
import { riverDressing, woodlandLayout, type WoodlandShrub, type WoodlandTree } from './woodland-layout';

interface Block { x: number; y: number; z: number; w: number; h: number; d: number; color: THREE.Color; id?: number }
interface Segment { a: Vec3; b: Vec3; width: number; cutting?: boolean; bridge?: boolean }
interface Surface { positions: number[]; colors: number[]; indices: number[] }
interface TerrainTile { x: number; z: number; coarse: THREE.Mesh; fine?: THREE.Group; fineStep?: number; used: number; indexStart: number; originalIndices: number[]; hidden: boolean }
const TILE = 96;
const quantize = (value: number) => Math.round(value / .2) * .2;

/** Shared crown templates retain the original unit box's exact outer bounds.
 * Lobes give the crown a stepped silhouette without allocating another tree,
 * moving a stand, or changing any instance's centre or scale. */
export function createTreeCrownGeometry(lod: 'near' | 'far'): THREE.BufferGeometry {
  const lobes = lod === 'near' ? [
    [0, 0, 0, .56, 1, .58],
    [-.38, -.02, .04, .24, .58, .58],
    [.38, .03, -.08, .24, .66, .52],
    [-.1, -.12, -.4, .62, .54, .2],
    [.08, .02, .4, .66, .68, .2],
  ] : [
    [0, 0, 0, .62, 1, .62],
    [0, -.09, 0, 1, .62, .62],
    [0, -.04, 0, .62, .58, 1],
  ];
  const parts = lobes.map(([x, y, z, w, h, d], index) => {
    const geometry = new THREE.BoxGeometry(w, h, d); geometry.translate(x, y, z);
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), colors: number[] = [];
    for (let vertex = 0; vertex < positions.count; vertex++) {
      // Small fixed face/value differences make adjacent voxel lobes readable.
      // The instanced species colour still supplies the whole tree's pigment.
      const normalY = normals.getY(vertex), face = normalY > .5 ? 1.04 : normalY < -.5 ? .65 : .87;
      const shade = face * (.96 + positions.getY(vertex) * .08) * (1 - index * .018);
      colors.push(shade, shade, shade);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); return geometry;
  });
  const geometry = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  if (!geometry) throw new Error('Tree crown template could not be merged');
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.crown = { lod, lobes: lobes.length, triangles: geometry.index!.count / 3, normalizedBounds: [-.5, .5] };
  return geometry;
}

/** The distant shell is a surface proxy. Ground-level stepped shells and small
 * rocks/plants are generated only around the camera and evicted after use. */
export function buildLandscape(world: WorldDefinition): {
  group: THREE.Group; water: THREE.ShaderMaterial[]; vegetation: THREE.Group;
  woodland: { trees: readonly WoodlandTree[]; shrubs: readonly WoodlandShrub[]; setModelled(trees: ReadonlySet<number>, shrubs: ReadonlySet<number>): void };
  update(camera: Vec3, quality: Quality): void; dispose(): void;
} {
  const group = new THREE.Group(), vegetation = new THREE.Group();
  group.name = '山水 · 分层岩壳与连续水系'; vegetation.name = '山林 · 松柏竹木'; group.add(vegetation);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const cube = new THREE.BoxGeometry(1, 1, 1), nearCanopy = createTreeCrownGeometry('near'), farCanopy = createTreeCrownGeometry('far');
  geometries.add(cube); geometries.add(nearCanopy); geometries.add(farCanopy);
  const earth = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true });
  const rock = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .97 });
  const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const crownLeaf = leaf.clone(); crownLeaf.vertexColors = true;
  materials.add(earth); materials.add(rock); materials.add(leaf); materials.add(crownLeaf);
  // Fine pigment and horizontal sediment continue across proxy boundaries; the
  // grain is tied to world coordinates rather than a repeated tile texture.
  earth.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vLandPosition; varying vec3 vLandNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandPosition = position; vLandNormal = normal;');
    shader.fragmentShader = `varying vec3 vLandPosition; varying vec3 vLandNormal;
      float landPatch(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        vec4 n=fract(sin(vec4(dot(i,vec2(12.9898,78.233)),dot(i+vec2(1,0),vec2(12.9898,78.233)),dot(i+vec2(0,1),vec2(12.9898,78.233)),dot(i+vec2(1,1),vec2(12.9898,78.233))))*43758.5453);
        return mix(mix(n.x,n.y,f.x),mix(n.z,n.w,f.x),f.y);
      }\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 cell=floor(vLandPosition*5.0);
      float grain=fract(sin(dot(cell,vec3(12.9898,78.233,39.425)))*43758.5453);
      float cliff=1.0-smoothstep(.25,.75,abs(vLandNormal.y));
      float landMicro=1.0-smoothstep(.2,1.2,length(fwidth(vLandPosition)));
      diffuseColor.rgb*=mix(1.0,.94+grain*.12,landMicro);
      vec3 weatherCell=floor(vLandPosition*.18);
      float weather=fract(sin(dot(weatherCell,vec3(31.13,17.71,53.29)))*15731.743);
      diffuseColor.rgb*=mix(1.0,.89+weather*.13,cliff);
      // Pigment follows the unchanged physical shell. Grey courses and moss
      // break the flat green slope; no decorative cliff or new walkable surface
      // is substituted for terrainHeight, and no instances are added.
      float sediment=.5+.5*sin(vLandPosition.y*.9+sin(vLandPosition.x*.045+vLandPosition.z*.034)*1.2);
      float crag=.5+.5*sin(vLandPosition.x*.22+sin(vLandPosition.z*.19)*1.7);
      diffuseColor.rgb*=mix(1.0,.9+sediment*.15+crag*.035,cliff);
      float moss=step(.67,weather)*cliff*(.35+.35*sediment);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.15,.235,.11),moss*.22);
      float meadow=1.0-cliff;
      float grassPatch=landPatch(vLandPosition.xz*.043);
      diffuseColor.rgb*=mix(1.0,.93+grassPatch*.12,meadow);`);
  };
  const transform = new THREE.Object3D();
  function batch(name: string, blocks: Block[], material: THREE.Material, parent = group, geometry: THREE.BufferGeometry = cube) {
    if (!blocks.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, blocks.length); mesh.name = name;
    blocks.forEach((b, i) => { transform.position.set(b.x, b.y, b.z); transform.scale.set(b.w, b.h, b.d); transform.rotation.set(0, 0, 0); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix); mesh.setColorAt(i, b.color); });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); parent.add(mesh);
  }
  const buildings = new Map<string, typeof world.buildings>(), roads = new Map<string, Segment[]>();
  const bucket = (x: number, z: number) => `${Math.floor(x / TILE)}:${Math.floor(z / TILE)}`;
  const indexItem = <T>(map: Map<string, T[]>, item: T, ax: number, az: number, bx: number, bz: number, margin: number) => {
    for (let x = Math.floor((Math.min(ax, bx) - margin) / TILE); x <= Math.floor((Math.max(ax, bx) + margin) / TILE); x++) for (let z = Math.floor((Math.min(az, bz) - margin) / TILE); z <= Math.floor((Math.max(az, bz) + margin) / TILE); z++) { const key = `${x}:${z}`, list = map.get(key) ?? []; list.push(item); map.set(key, list); }
  };
  for (const b of world.buildings) indexItem(buildings, b, b.position.x - b.width / 2, b.position.z - b.depth / 2, b.position.x + b.width / 2, b.position.z + b.depth / 2, 12);
  const roadList: Segment[] = [];
  for (const edge of world.edges) if (['road', 'bridge', 'lightRail'].includes(edge.mode)) for (let i = 1; i < edge.points.length; i++) {
    const segment = { a: edge.points[i - 1], b: edge.points[i], width: edge.id.includes('airport-runway-strip') ? 22 : 5, cutting: edge.mode === 'road' || edge.mode === 'bridge' && edge.from !== 'core-lift-top', bridge: edge.mode === 'bridge' };
    roadList.push(segment); indexItem(roads, segment, segment.a.x, segment.a.z, segment.b.x, segment.b.z, segment.width + 14);
  }
  const river: Segment[] = world.river.slice(1).map((point, i) => ({ a: world.river[i], b: point, width: 12 + Math.min(i + 1, 5) * .6 }));
  const fallTop = world.waterfall.top, fallBottom = world.waterfall.bottom;
  const fallProfile = getWaterfallPath(world);
  const riverAt = (x: number, z: number) => {
    let best = { distance: Infinity, y: 0, width: 14 };
    for (const s of river) { const t = progress(x, z, s.a, s.b), dist = distanceToSegment(x, z, s.a, s.b); if (dist < best.distance) best = { distance: dist, y: s.a.y + (s.b.y - s.a.y) * t, width: s.width }; }
    return best;
  };
  const heightCache = new Map<string, number>();
  function surfaceHeight(x: number, z: number, includeBasements = true) {
    const key = `${x}:${z}:${includeBasements}`, cached = heightCache.get(key); if (cached !== undefined) return cached;
    const y = terrainHeight(world, x, z, includeBasements);
    const result = quantize(y); heightCache.set(key, result); return result;
  }
  const palette = { rock: new THREE.Color('#63746e'), cliff: new THREE.Color('#8b9487'), soil: new THREE.Color('#8b7859'), grass: new THREE.Color('#5a7542'), gravel: new THREE.Color('#b3b5a0'), wet: new THREE.Color('#608981') };
  function groundColor(x: number, z: number, y: number, slope: number, side = false) {
    const r = riverAt(x, z), field = Math.sin(x / 43) * Math.cos(z / 58), broad = Math.sin(x / 240 + z / 180);
    let color: THREE.Color;
    const meadow = palette.grass.clone().lerp(palette.soil, .12 + field * .08), stone = palette.cliff.clone().lerp(palette.rock, .3 + broad * .12);
    const face = side ? 1 : THREE.MathUtils.smoothstep(slope, .32, 1.1), alpine = THREE.MathUtils.smoothstep(y, 465, 590);
    color = meadow.lerp(stone, Math.max(face, alpine));
    const wetness = 1 - THREE.MathUtils.smoothstep(r.distance, r.width + 2, r.width + 20), plunge = 1 - THREE.MathUtils.smoothstep(Math.hypot(x - world.waterfall.bottom.x, z - world.waterfall.bottom.z), 45, 72);
    color.lerp(palette.gravel.clone().lerp(palette.wet, .32 + field * .08), Math.max(wetness, plunge));
    return color.multiplyScalar(.96 + broad * .06);
  }
  function mesh(name: string, data: Surface, parent: THREE.Group) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3)); geometry.setIndex(data.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometries.add(geometry);
    const result = new THREE.Mesh(geometry, earth); result.name = name; result.receiveShadow = true; parent.add(result); return result;
  }
  function quad(data: Surface, vertices: number[], color: THREE.Color) {
    const start = data.positions.length / 3; data.positions.push(...vertices); for (let i = 0; i < 4; i++) data.colors.push(color.r, color.g, color.b); data.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const proxySteps = new Map<string, number>();
  function shell(tx: number, tz: number, step: number, stepped: boolean, parent: THREE.Group) {
    const data: Surface = { positions: [], colors: [], indices: [] };
    const hangingLeaves: Block[] = [];
    const nearbyBuildings = buildings.get(`${tx}:${tz}`) ?? [];
    const half = step / 2;
    const height = (x: number, z: number) => surfaceHeight(x, z, stepped);
    for (let x = tx * TILE; x < (tx + 1) * TILE; x += step) for (let z = tz * TILE; z < (tz + 1) * TILE; z += step) {
      const xs = [x, x + step], zs = [z, z + step];
      // The waterfall lip/drop are a shared world feature, not a global
      // resolution increase. Propagating their rows keeps adjacent tiles sewn.
      if (!stepped) for (const zz of [fallProfile[1].z, fallProfile[2].z]) if (zz > z && zz < z + step && !zs.includes(zz)) zs.push(zz);
      // Exact footprint cuts retain the existing excavated basements and shared
      // floor dimensions even when a coarse proxy runs across a facade.
      for (const b of stepped ? nearbyBuildings : []) if (x < b.position.x + b.width / 2 && x + step > b.position.x - b.width / 2 && z < b.position.z + b.depth / 2 && z + step > b.position.z - b.depth / 2) {
        for (const xx of [b.position.x - b.width / 2, b.position.x + b.width / 2]) if (xx > x && xx < x + step) xs.push(xx);
        for (const zz of [b.position.z - b.depth / 2, b.position.z + b.depth / 2]) if (zz > z && zz < z + step) zs.push(zz);
      }
      xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
      for (let xi = 1; xi < xs.length; xi++) for (let zi = 1; zi < zs.length; zi++) {
        const a = xs[xi - 1], b = xs[xi], c = zs[zi - 1], d = zs[zi], mx = (a + b) / 2, mz = (c + d) / 2;
        const localStep = Math.max(b - a, d - c), localHalf = localStep / 2;
        const top = height(mx, mz), slope = Math.max(Math.abs(height(mx + localHalf, mz) - height(mx - localHalf, mz)), Math.abs(height(mx, mz + localHalf) - height(mx, mz - localHalf))) / Math.max(1, localStep);
        const color = groundColor(mx, mz, top, slope);
        if (stepped) {
          quad(data, [a, top, c, a, top, d, b, top, d, b, top, c], color);
          const side = groundColor(mx, mz, top, slope, true), west = height(a - localHalf, mz), east = height(b + localHalf, mz), north = height(mx, c - localHalf), south = height(mx, d + localHalf);
          const wall = (vertices: number[], low: number, faceX: number, faceZ: number, nx: number, nz: number) => {
            if (low >= top) return;
            quad(data, vertices, side);
            if (hangingLeaves.length >= 360 || top - low < 4 || hash(mx, mz, world.seed) < .74 || !clearGround(mx, mz, .4)) return;
            for (let layer = 0; layer < Math.min(12, Math.floor((top - low) / 1.2)) && hangingLeaves.length < 360; layer++) {
              const spread = (hash(mx + layer, mz, world.seed) - .5) * Math.min(1.2, localStep * .6), yy = quantize(top - .6 - layer * 1.2);
              hangingLeaves.push({ x: faceX + nx * .15 - nz * spread, y: yy, z: faceZ + nz * .15 + nx * spread, w: nx ? .2 : .6, h: .8, d: nx ? .6 : .2, color: new THREE.Color(layer % 3 ? '#4d6840' : '#7b8850') });
            }
          };
          wall([a, west, d, a, top, d, a, top, c, a, west, c], west, a, mz, -1, 0);
          wall([b, east, c, b, top, c, b, top, d, b, east, d], east, b, mz, 1, 0);
          wall([a, north, c, a, top, c, b, top, c, b, north, c], north, mx, c, 0, -1);
          wall([b, south, d, b, top, d, a, top, d, a, south, d], south, mx, d, 0, 1);
        } else {
          const ring: number[][] = [];
          const point = (xx: number, zz: number) => ring.push([xx, height(xx, zz), zz]);
          const edge = (x1: number, z1: number, x2: number, z2: number, neighbour: number) => {
            point(x1, z1);
            if (neighbour >= step) return;
            const increasing = x1 !== x2 ? x2 > x1 : z2 > z1, lo = Math.min(x1 !== x2 ? x1 : z1, x1 !== x2 ? x2 : z2), hi = Math.max(x1 !== x2 ? x1 : z1, x1 !== x2 ? x2 : z2);
            const cuts: number[] = [];
            for (let at = (Math.floor(lo / neighbour) + 1) * neighbour; at < hi; at += neighbour) cuts.push(at);
            if (!increasing) cuts.reverse();
            for (const at of cuts) point(x1 !== x2 ? at : x1, x1 !== x2 ? z1 : at);
          };
          edge(a, c, a, d, a === tx * TILE ? proxySteps.get(`${tx - 1}:${tz}`) ?? step : step);
          edge(a, d, b, d, d === (tz + 1) * TILE ? proxySteps.get(`${tx}:${tz + 1}`) ?? step : step);
          edge(b, d, b, c, b === (tx + 1) * TILE ? proxySteps.get(`${tx + 1}:${tz}`) ?? step : step);
          edge(b, c, a, c, c === tz * TILE ? proxySteps.get(`${tx}:${tz - 1}`) ?? step : step);
          if (ring.length === 4) quad(data, ring.flat(), color);
          else {
            // Only the common border receives its neighbour's samples. A
            // centre fan joins those samples without splitting the opposite
            // interior edge and creating another unmatched T-junction.
            const start = data.positions.length / 3;
            data.positions.push(mx, height(mx, mz), mz, ...ring.flat());
            for (let i = 0; i <= ring.length; i++) data.colors.push(color.r, color.g, color.b);
            for (let i = 0; i < ring.length; i++) data.indices.push(start, start + 1 + i, start + 1 + (i + 1) % ring.length);
          }
        }
      }
    }
    const result = mesh(stepped ? `近景岩土壳 ${tx}:${tz}` : `山形表面代理 ${tx}:${tz}`, data, parent);
    if (stepped) batch('真实岩壁 · 附壁垂藤', hangingLeaves, leaf, parent);
    return result;
  }
  const tiles: TerrainTile[] = [];
  const extent = Math.ceil(world.size / 2 / TILE);
  const reliefTiles: { x: number; z: number; score: number }[] = [];
  for (let x = -extent; x < extent; x++) for (let z = -extent; z < extent; z++) {
    const cx = (x + .5) * TILE, cz = (z + .5) * TILE;
    const heights = [surfaceHeight(cx - 48, cz, false), surfaceHeight(cx + 48, cz, false), surfaceHeight(cx, cz - 48, false), surfaceHeight(cx, cz + 48, false)];
    const score = (Math.max(...heights) - Math.min(...heights)) / (1 + Math.hypot(cx - fallTop.x, cz - fallTop.z) / 1800);
    proxySteps.set(`${x}:${z}`, 16); reliefTiles.push({ x, z, score });
  }
  reliefTiles.sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z);
  // Spend a fixed geometry budget on real steep landforms across the city,
  // rather than one global increase or a camera-only decorative cliff.
  reliefTiles.slice(0, 120).forEach(tile => proxySteps.set(`${tile.x}:${tile.z}`, 8));
  reliefTiles.slice(0, 10).forEach(tile => proxySteps.set(`${tile.x}:${tile.z}`, 4));
  for (let x = -extent; x < extent; x++) for (let z = -extent; z < extent; z++) tiles.push({ x, z, coarse: shell(x, z, proxySteps.get(`${x}:${z}`)!, false, group), used: 0, indexStart: 0, originalIndices: [], hidden: false });
  // Sew the lighting as well as the positions across cell and tile borders.
  // Averaging the existing solid faces needs no extra terrain-height queries.
  const sharedNormals = new Map<string, THREE.Vector3>();
  for (const tile of tiles) { const positions = tile.coarse.geometry.getAttribute('position'), normals = tile.coarse.geometry.getAttribute('normal'); for (let i = 0; i < positions.count; i++) { const id = `${positions.getX(i)}:${positions.getZ(i)}`, normal = sharedNormals.get(id) ?? new THREE.Vector3(); normal.x += normals.getX(i); normal.y += normals.getY(i); normal.z += normals.getZ(i); sharedNormals.set(id, normal); } }
  sharedNormals.forEach(normal => normal.normalize());
  for (const tile of tiles) { const positions = tile.coarse.geometry.getAttribute('position'), normals = tile.coarse.geometry.getAttribute('normal'), colors = tile.coarse.geometry.getAttribute('color'); for (let i = 0; i < positions.count; i++) { const x = positions.getX(i), z = positions.getZ(i), normal = sharedNormals.get(`${x}:${z}`)!; normals.setXYZ(i, normal.x, normal.y, normal.z); const color = groundColor(x, z, positions.getY(i), Math.hypot(normal.x, normal.z) / Math.max(.001, normal.y)); colors.setXYZ(i, color.r, color.g, color.b); } }
  sharedNormals.clear();
  const coarseChunks = new Map<string, TerrainTile[]>();
  for (const tile of tiles) { const key = `${Math.floor(tile.x / 4)}:${Math.floor(tile.z / 4)}`, list = coarseChunks.get(key) ?? []; list.push(tile); coarseChunks.set(key, list); }
  for (const [key, members] of coarseChunks) {
    const originals = members.map(tile => tile.coarse.geometry), merged = mergeGeometries(originals);
    if (!merged) throw new Error('Terrain proxy geometry could not be merged');
    const coarse = new THREE.Mesh(merged, earth); coarse.name = `山形合批代理 ${key}`; group.add(coarse); geometries.add(merged);
    let indexStart = 0, vertexStart = 0;
    for (const tile of members) { const original = tile.coarse.geometry; tile.indexStart = indexStart; tile.originalIndices = Array.from(original.index!.array, index => index + vertexStart); indexStart += tile.originalIndices.length; vertexStart += original.getAttribute('position').count; group.remove(tile.coarse); geometries.delete(original); original.dispose(); tile.coarse = coarse; }
    merged.computeBoundingSphere();
  }
  // Distant ridges keep asymmetric connected silhouettes, with one inexpensive
  // indexed shell per quadrant instead of thousands of exposed giant cubes.
  const farExtent = extent * TILE + 1536;
  const peaks = Array.from({ length: 23 }, (_, i) => { const angle = i / 23 * Math.PI * 2 + (hash(i, 201, world.seed) - .5) * .42, radius = extent * TILE + 470 + hash(i, 202, world.seed) * 1050, rotation = angle + .5 + hash(i, 203, world.seed) * 1.4; return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, height: 260 + hash(i, 204, world.seed) * 235, long: 540 + hash(i, 205, world.seed) * 560, short: 290 + hash(i, 206, world.seed) * 330, cos: Math.cos(rotation), sin: Math.sin(rotation) }; });
  function ridgeHeight(x: number, z: number) { let first = 0, second = 0; for (const peak of peaks) { const dx = x - peak.x, dz = z - peak.z, a = (dx * peak.cos + dz * peak.sin) / peak.long, b = (-dx * peak.sin + dz * peak.cos) / peak.short, h = peak.height * Math.exp(-1.8 * (a * a + b * b)); if (h > first) { second = first; first = h; } else if (h > second) second = h; } const distance = Math.max(Math.abs(x), Math.abs(z)); return -24 + (first + second * .16) * THREE.MathUtils.smoothstep(distance, extent * TILE - 32, extent * TILE + 300) * (1 - THREE.MathUtils.smoothstep(distance, farExtent - 480, farExtent)); }
  const distant: Surface = { positions: [], colors: [], indices: [] };
  for (let x = -farExtent; x < farExtent; x += 48) for (let z = -farExtent; z < farExtent; z += 48) { if (Math.abs(x + 24) < extent * TILE && Math.abs(z + 24) < extent * TILE) continue; const h = ridgeHeight(x + 24, z + 24); if (h < -20) continue; quad(distant, [x, ridgeHeight(x, z), z, x, ridgeHeight(x, z + 48), z + 48, x + 48, ridgeHeight(x + 48, z + 48), z + 48, x + 48, ridgeHeight(x + 48, z), z], new THREE.Color('#758e96').lerp(new THREE.Color('#859a9b'), h / 1500)); }
  mesh('远山 · 叠嶂岩脊代理', distant, group);

  function clearGround(x: number, z: number, margin: number) {
    if ((buildings.get(bucket(x, z)) ?? []).some(b => Math.abs(x - b.position.x) < b.width / 2 + margin && Math.abs(z - b.position.z) < b.depth / 2 + margin)) return false;
    if ((roads.get(bucket(x, z)) ?? []).some(s => distanceToSegment(x, z, s.a, s.b) < s.width + margin)) return false;
    if (fallProfile.slice(1).some((point, i) => distanceToSegment(x, z, fallProfile[i], point) < 46 + margin)) return false;
    const r = riverAt(x, z); return r.distance > r.width + margin && Math.hypot(x - world.waterfall.bottom.x, z - world.waterfall.bottom.z) > 56;
  }
  const trunks: Block[] = [], crowns: Block[] = [], bushes: Block[] = [];
  // Positions, species and heights come from the shared woodland layout (also
  // used by the Unity client). Heights are the studio models' own: when the
  // model pool draws a tree, its blocks here are hidden (setModelled).
  const layout = woodlandLayout(world), stands = { length: layout.stands };
  for (const tree of layout.trees) {
    const { x, y, z, height, species, id } = tree;
    const color = new THREE.Color(species === 0 ? '#ad6b3a' : species === 1 ? '#a79541' : species === 2 ? '#6b854c' : '#365d40').lerp(new THREE.Color('#83986c'), hash(id, 91, world.seed) * .35);
    trunks.push({ x, y: y + height * .35, z, w: .8, h: height * .7, d: .8, color: new THREE.Color('#6b5c45'), id });
    // Each tier has projecting voxel branches, leaving light between crowns.
    for (let tier = 0; tier < 4; tier++) { const width = quantize(height * (.84 - tier * .13)); crowns.push({ x: x + (tier % 2 ? 1 : -1) * height * .11, y: y + height * (.49 + tier * .12), z: z + height * .075 * (tier - 1), w: width, h: quantize(height * .23), d: width * .8, color: color.clone().multiplyScalar(.85 + tier * .06), id }); }
  }
  for (const shrub of layout.shrubs) bushes.push({ x: shrub.x, y: shrub.y + .9, z: shrub.z, w: 2.8, h: 1.8, d: 2.2, color: new THREE.Color('#6b854c').lerp(new THREE.Color('#819169'), .2), id: shrub.id });
  const forestChunks: { x: number; z: number; detail: THREE.Group; proxy: THREE.Group }[] = [];
  const woodlandMeshes: { mesh: THREE.InstancedMesh; ids: number[]; shrub: boolean; original: Float32Array }[] = [];
  const track = (parent: THREE.Group, blocks: Block[], shrub = false) => { if (!blocks.length) return; const mesh = parent.children.at(-1) as THREE.InstancedMesh; woodlandMeshes.push({ mesh, ids: blocks.map(b => b.id!), shrub, original: Float32Array.from(mesh.instanceMatrix.array as Float32Array) }); };
  const forest = new Map<string, { trunks: Block[]; crowns: Block[]; bushes: Block[] }>();
  for (const [key, blocks] of [['trunks', trunks], ['crowns', crowns], ['bushes', bushes]] as const) for (const block of blocks) {
    const cell = `${Math.floor(block.x / 384)}:${Math.floor(block.z / 384)}`, lists = forest.get(cell) ?? { trunks: [], crowns: [], bushes: [] };
    lists[key].push(block); forest.set(cell, lists);
  }
  for (const [key, lists] of forest) {
    const [x, z] = key.split(':').map(Number), detail = new THREE.Group(), proxy = new THREE.Group();
    detail.name = `林木近景 ${key}`; proxy.name = `远林冠影 ${key}`; vegetation.add(detail, proxy);
    batch('山林树干', lists.trunks, rock, detail); track(detail, lists.trunks);
    batch('错层乔木冠', lists.crowns, crownLeaf, detail, nearCanopy); track(detail, lists.crowns);
    batch('山林灌木', lists.bushes, leaf, detail); track(detail, lists.bushes, true);
    const distantCrowns = lists.trunks.flatMap((t, i) => {
      const color = lists.crowns[i * 4]?.color ?? new THREE.Color('#527151');
      return [0, 1].map(tier => ({ ...t, x: t.x + (tier ? 1 : -1) * t.h * .15, y: t.y + t.h * (.42 + tier * .35), z: t.z + tier * t.h * .1, w: quantize(t.h * (tier ? .9 : 1.25)), h: quantize(t.h * .55), d: quantize(t.h * (tier ? .75 : 1.08)), color: color.clone().multiplyScalar(tier ? 1.08 : .92) }));
    });
    batch('远林树干代理', lists.trunks, rock, proxy); track(proxy, lists.trunks);
    batch('远林错层树冠代理', distantCrowns, crownLeaf, proxy, farCanopy); track(proxy, distantCrowns);
    detail.visible = false; forestChunks.push({ x: (x + .5) * 384, z: (z + .5) * 384, detail, proxy });
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0).elements;
  /** Hides the blocks of trees and shrubs whose studio model is drawn. */
  function setModelled(trees: ReadonlySet<number>, shrubs: ReadonlySet<number>) {
    for (const { mesh, ids, shrub, original } of woodlandMeshes) {
      const hidden = shrub ? shrubs : trees, array = mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < ids.length; i++) array.set(hidden.has(ids[i]) ? zero : original.subarray(i * 16, i * 16 + 16), i * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // The rock face is the actual continuous terrain shell. No floating or
  // buried cuboids substitute for its solid surface; weathered ribs use its
  // world-space material normals and the near shell keeps real stepped faces.

  const water: THREE.ShaderMaterial[] = [createWater(false), createWater(true)]; materials.add(water[0]); materials.add(water[1]);
  // Bank stones, reeds and foam come from the shared dressing (also drawn by Unity).
  const dressing = riverDressing(world);
  const bankBlocks: Block[] = dressing.stones.map(b => ({ ...b, color: new THREE.Color('#a5aaa0') })), reeds: Block[] = dressing.reeds.map(b => ({ ...b, color: new THREE.Color('#849a6b') }));
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = []; let flowDistance = 0;
  for (let i = 0; i < world.river.length; i++) {
    const p = world.river[i], before = world.river[Math.max(0, i - 1)], after = world.river[Math.min(world.river.length - 1, i + 1)]; if (i) flowDistance += Math.hypot(p.x - before.x, p.z - before.z);
    const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz) || 1, nx = -dz / length, nz = dx / length, width = 12 + Math.min(i, 5) * .6;
    vertices.push(p.x + nx * width, p.y + .55, p.z + nz * width, p.x - nx * width, p.y + .55, p.z - nz * width); uvs.push(0, flowDistance / 40, 1, flowDistance / 40);
    if (i) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1); }
  }
  const streamGeometry = new THREE.BufferGeometry(); streamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); streamGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); streamGeometry.setIndex(indices); streamGeometry.computeVertexNormals(); geometries.add(streamGeometry);
  const creek = new THREE.Mesh(streamGeometry, water[0]); creek.name = '瀑潭→清溪→水岸 · 共顶点连续水面'; creek.renderOrder = 2; group.add(creek);
  batch('溪岸 · 灰白水蚀石', bankBlocks, rock); batch('溪岸 · 细茎芦苇', reeds, leaf);
  const top = world.waterfall.top, bottom = world.waterfall.bottom;
  const tangent = new THREE.Vector3(bottom.z - top.z, 0, top.x - bottom.x).normalize();
  const fallVertices: number[] = [], fallUvs: number[] = [], fallIndices: number[] = [];
  for (let i = 0; i < fallProfile.length; i++) { const p = fallProfile[i]; for (const side of [-1, 1]) fallVertices.push(p.x + tangent.x * world.waterfall.width / 2 * side, p.y + .8, p.z + tangent.z * world.waterfall.width / 2 * side); fallUvs.push(0, i / (fallProfile.length - 1), 1, i / (fallProfile.length - 1)); if (i) { const n = i * 2; fallIndices.push(n - 2, n, n - 1, n - 1, n, n + 1); } }
  const fallGeometry = new THREE.BufferGeometry(); fallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fallVertices, 3)); fallGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(fallUvs, 2)); fallGeometry.setIndex(fallIndices); fallGeometry.computeVertexNormals(); geometries.add(fallGeometry);
  const fall = new THREE.Mesh(fallGeometry, water[1]); fall.name = '云瀑 · 153m落差水帘'; fall.renderOrder = 3; group.add(fall);
  const poolGeometry = new THREE.CircleGeometry(50, 24); poolGeometry.rotateX(-Math.PI / 2); geometries.add(poolGeometry);
  const pool = new THREE.Mesh(poolGeometry, water[0]); pool.position.set(bottom.x, bottom.y + .6, bottom.z); pool.name = '瀑下潭 · 可见落水与下游接合'; pool.renderOrder = 2; group.add(pool);
  const foam: Block[] = dressing.foam.map(b => ({ ...b, color: new THREE.Color('#d3e9df') }));
  batch('瀑潭 · 体素泡沫', foam, rock);
  // Surface samples are build-time scratch data. Keeping all resolutions in a
  // permanent map would turn a landscape stream into an unbounded height cache.
  heightCache.clear();

  let epoch = 0, lastCell = '', lastQuality: Quality | undefined;
  function destroyFine(tile: TerrainTile) { if (!tile.fine) return; tile.fine.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); if (object instanceof THREE.Mesh && object.geometry !== cube) { geometries.delete(object.geometry); object.geometry.dispose(); } }); group.remove(tile.fine); tile.fine = undefined; tile.fineStep = undefined; }
  function update(camera: Vec3, quality: Quality) {
    const ground = surfaceHeight(camera.x, camera.z), close = camera.y - ground < 100 && camera.y - ground > -80;
    const centreX = Math.floor(camera.x / TILE), centreZ = Math.floor(camera.z / TILE), cell = `${centreX}:${centreZ}:${close}`;
    if (cell === lastCell && quality === lastQuality) return;
    heightCache.clear();
    lastCell = cell; lastQuality = quality; epoch++;
    for (const forest of forestChunks) {
      const near = Math.hypot(camera.x - forest.x, camera.z - forest.z) < (quality === 'high' ? 720 : 320);
      forest.detail.visible = near; forest.proxy.visible = !near;
    }
    const selected: TerrainTile[] = [];
    for (const tile of tiles) {
      const wanted = close && Math.abs(tile.x - centreX) <= (quality === 'low' ? 0 : 1) && Math.abs(tile.z - centreZ) <= (quality === 'low' ? 0 : 1);
      if (wanted) {
        const step = quality === 'high' ? 1 : 2;
        if (tile.fine && tile.fineStep !== step) destroyFine(tile);
        if (!tile.fine) {
          tile.fine = new THREE.Group(); tile.fineStep = step; tile.fine.name = `近景土石与植被 ${tile.x}:${tile.z}`; group.add(tile.fine); shell(tile.x, tile.z, step, true, tile.fine);
          const smallRocks: Block[] = [], grass: Block[] = [];
          for (let i = 0; i < (quality === 'low' ? 48 : 150); i++) {
            const patch = Math.floor(i / 12), px = (tile.x + hash(patch, 400 + tile.z, world.seed)) * TILE, pz = (tile.z + hash(patch, 500 + tile.x, world.seed)) * TILE;
            const x = quantize(px + (hash(i, 611, world.seed) - .5) * 9), z = quantize(pz + (hash(i, 612, world.seed) - .5) * 9), y = surfaceHeight(x, z);
            if (!clearGround(x, z, 1.2)) continue;
            if (i % 12 === 0) smallRocks.push({ x, y: y + .2, z, w: .4 + .2 * (i % 4), h: .4, d: .4 + .2 * (i % 3), color: new THREE.Color(i % 2 ? '#a7ab9a' : '#878c7d') });
            else for (let stem = 0; stem < 3; stem++) grass.push({ x: x + stem * .2, y: y + .3, z: z + (stem % 2) * .2, w: .2, h: .4 + (stem % 2) * .2, d: .2, color: new THREE.Color(i % 2 ? '#869a71' : '#5e7958') });
          }
          batch('近景 · 0.2m碎石', smallRocks, rock, tile.fine); batch('近景 · 0.2m草叶', grass, leaf, tile.fine);
        }
        tile.used = epoch; tile.fine.visible = true; selected.push(tile);
      } else if (tile.fine) tile.fine.visible = false;
      if (tile.hidden !== wanted) { const index = tile.coarse.geometry.index!; for (let i = 0; i < tile.originalIndices.length; i++) index.setX(tile.indexStart + i, wanted ? tile.originalIndices[0] : tile.originalIndices[i]); index.needsUpdate = true; tile.hidden = wanted; }
    }
    const cached = tiles.filter(tile => tile.fine).sort((a, b) => b.used - a.used); for (const tile of cached.slice(18)) destroyFine(tile);
    group.userData.lod = { visibleFineTiles: selected.length, cachedFineTiles: Math.min(18, cached.length), tileMetres: TILE, surfaceStep: quality === 'high' ? 1 : 2, voxelMetres: world.voxelSize, lowAltitude: close, proxyStep: 16, proxyChunkMetres: 384, forestDetailChunks: forestChunks.filter(chunk => chunk.detail.visible).length };
    heightCache.clear();
  }
  group.userData.water = { continuous: true, riverVertices: world.river.length * 2, plungePoolRadius: 50, waterfallDrop: top.y - bottom.y };
  group.userData.woodland = { stands: stands.length, trees: trunks.length, shrubs: bushes.length, heightsFrom: 'studio model bounds (woodland-layout.ts)', canopyLayers: 4, farCanopyLayers: 2, distribution: 'continuous district rim belts and mountain shoulders', floatingRockBodies: 0,
    sharedCrownGeometries: 2, nearCrownTriangles: nearCanopy.index!.count / 3, farCrownTriangles: farCanopy.index!.count / 3 };
  return { group, water, vegetation, woodland: { trees: layout.trees, shrubs: layout.shrubs, setModelled }, update, dispose() { group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); }); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear(); } };
}

function hash(x: number, z: number, seed: number) { const value = Math.sin(x * 12.9898 + z * 78.233 + seed * .113) * 43758.5453; return value - Math.floor(value); }
function progress(x: number, z: number, a: Vec3, b: Vec3) { const dx = b.x - a.x, dz = b.z - a.z; return THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1); }
function distanceToSegment(x: number, z: number, a: Vec3, b: Vec3) { const t = progress(x, z, a, b); return Math.hypot(x - a.x - (b.x - a.x) * t, z - a.z - (b.z - a.z) * t); }
function createWater(falling: boolean) {
  return new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, light: { value: 1 }, falling: { value: falling ? 1 : 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform float time;uniform float light;uniform float falling;varying vec2 vUv;
      void main(){float flow=vUv.y*mix(28.0,70.0,falling)-time*mix(.6,5.0,falling);float ripple=pow(max(0.0,sin(flow+sin(vUv.x*38.0)*.9)),12.0);float fringe=pow(abs(vUv.x-.5)*2.0,9.0);vec3 jade=mix(vec3(.12,.42,.47),vec3(.55,.79,.79),falling*.8);vec3 color=mix(jade,vec3(.83,.94,.88),ripple*.38+fringe*.24);color*=mix(.38,1.0,light);gl_FragColor=vec4(color,mix(.94,.88,falling));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }` });
}
