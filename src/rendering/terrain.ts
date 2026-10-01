import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Quality, Vec3, WorldDefinition } from '../types';
import { naturalTerrainHeight } from '../world';

interface Block { x: number; y: number; z: number; w: number; h: number; d: number; color: THREE.Color }
interface Segment { a: Vec3; b: Vec3; width: number; cutting?: boolean; bridge?: boolean }
interface Surface { positions: number[]; colors: number[]; indices: number[] }
interface TerrainTile { x: number; z: number; coarse: THREE.Mesh; fine?: THREE.Group; fineStep?: number; used: number; indexStart: number; originalIndices: number[]; hidden: boolean }
const TILE = 96;
const quantize = (value: number) => Math.round(value / .2) * .2;

/** The distant shell is a surface proxy. Ground-level stepped shells and small
 * rocks/plants are generated only around the camera and evicted after use. */
export function buildLandscape(world: WorldDefinition): {
  group: THREE.Group; water: THREE.ShaderMaterial[]; vegetation: THREE.Group;
  update(camera: Vec3, quality: Quality): void; dispose(): void;
} {
  const group = new THREE.Group(), vegetation = new THREE.Group();
  group.name = '山水 · 分层岩壳与连续水系'; vegetation.name = '山林 · 松柏竹木'; group.add(vegetation);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const earth = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true });
  const rock = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .97 });
  const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  materials.add(earth); materials.add(rock); materials.add(leaf);
  // Fine pigment and horizontal sediment continue across proxy boundaries; the
  // grain is tied to world coordinates rather than a repeated tile texture.
  earth.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vLandPosition; varying vec3 vLandNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandPosition = position; vLandNormal = normal;');
    shader.fragmentShader = 'varying vec3 vLandPosition; varying vec3 vLandNormal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 cell=floor(vLandPosition*5.0);
      float grain=fract(sin(dot(cell,vec3(12.9898,78.233,39.425)))*43758.5453);
      float stratum=sin(vLandPosition.y*2.4+sin(vLandPosition.x*.023)*.7);
      diffuseColor.rgb*=.96+grain*.08;
      diffuseColor.rgb*=mix(1.0,.87+stratum*.07,1.0-smoothstep(.25,.75,abs(vLandNormal.y)));`);
  };
  const transform = new THREE.Object3D();
  function batch(name: string, blocks: Block[], material: THREE.Material, parent = group) {
    if (!blocks.length) return;
    const mesh = new THREE.InstancedMesh(cube, material, blocks.length); mesh.name = name;
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
  const fallProfile = [fallTop, { x: fallTop.x, y: fallTop.y, z: fallTop.z + 34 }, { x: fallBottom.x, y: fallBottom.y, z: fallTop.z + 44 }, fallBottom];
  const riverAt = (x: number, z: number) => {
    let best = { distance: Infinity, y: 0, width: 14 };
    for (const s of river) { const t = progress(x, z, s.a, s.b), dist = distanceToSegment(x, z, s.a, s.b); if (dist < best.distance) best = { distance: dist, y: s.a.y + (s.b.y - s.a.y) * t, width: s.width }; }
    return best;
  };
  const heightCache = new Map<string, number>();
  function surfaceHeight(x: number, z: number) {
    const key = `${x}:${z}`, cached = heightCache.get(key); if (cached !== undefined) return cached;
    const nearby = buildings.get(bucket(x, z)) ?? [];
    for (const b of nearby) if (Math.abs(x - b.position.x) <= b.width / 2 + 2 && Math.abs(z - b.position.z) <= b.depth / 2 + 2) {
      const basement = b.basements && Math.abs(x - b.position.x) < b.width / 2 - .8 && Math.abs(z - b.position.z) < b.depth / 2 - .8;
      const inside = Math.abs(x - b.position.x) < b.width / 2 && Math.abs(z - b.position.z) < b.depth / 2;
      const top = quantize(basement ? b.position.y - b.basements! * b.height / b.floors - .6 : b.position.y - (inside ? .16 : 0)); heightCache.set(key, top); return top;
    }
    let y = naturalTerrainHeight(world, x, z);
    const r = riverAt(x, z);
    let roadDistance = Infinity, roadY = y, roadWidth = 5;
    for (const s of roads.get(bucket(x, z)) ?? []) if (s.cutting && !(s.bridge && r.distance < 25)) { const distance = distanceToSegment(x, z, s.a, s.b); if (distance < roadDistance) { roadDistance = distance; roadY = s.a.y + (s.b.y - s.a.y) * progress(x, z, s.a, s.b) - .6; roadWidth = s.width; } }
    if (roadDistance < roadWidth + 14 && (roadWidth === 22 || roadY - y < 12) && r.distance > 20) y += (roadY - y) * (1 - THREE.MathUtils.smoothstep(roadDistance, roadWidth, roadWidth + 14));
    for (const b of nearby) { const outside = Math.hypot(Math.max(0, Math.abs(x - b.position.x) - b.width / 2 - 2), Math.max(0, Math.abs(z - b.position.z) - b.depth / 2 - 2)); if (outside < 12) y += (b.position.y - y) * (1 - THREE.MathUtils.smoothstep(outside, 0, 12)); }
    if (r.distance < r.width + 2) y = Math.min(y, r.y - 2.2 + Math.max(0, r.distance - r.width) * .5);
    const poolDistance = Math.hypot(x - world.waterfall.bottom.x, z - world.waterfall.bottom.z);
    if (poolDistance < 50) y = Math.min(y, world.waterfall.bottom.y - 2.4 + Math.max(0, poolDistance - 42) * .25);
    // The gorge opens towards the pool, leaving the falling sheet visible from
    // both banks. A sheet-width cut left tall foreground banks across its view.
    for (let i = 1; i < fallProfile.length; i++) if (distanceToSegment(x, z, fallProfile[i - 1], fallProfile[i]) < (i === 1 ? world.waterfall.width / 2 + 2 : 46)) { const t = progress(x, z, fallProfile[i - 1], fallProfile[i]); y = Math.min(y, fallProfile[i - 1].y + (fallProfile[i].y - fallProfile[i - 1].y) * t - 3); }
    const result = quantize(y); heightCache.set(key, result); return result;
  }
  const palette = { rock: new THREE.Color('#a0a895'), cliff: new THREE.Color('#a2aaa2'), soil: new THREE.Color('#a1967e'), grass: new THREE.Color('#748c66'), gravel: new THREE.Color('#b5ad91'), wet: new THREE.Color('#87978a') };
  function groundColor(x: number, z: number, y: number, slope: number, side = false) {
    const r = riverAt(x, z), field = Math.sin(x / 43) * Math.cos(z / 58), broad = Math.sin(x / 240 + z / 180);
    let color: THREE.Color;
    if (side || slope > .7) color = palette.cliff.clone().lerp(palette.soil, .24 + broad * .1);
    else if (r.distance < r.width + 14 || Math.hypot(x - world.waterfall.bottom.x, z - world.waterfall.bottom.z) < 62) color = palette.gravel.clone().lerp(palette.wet, .32 + field * .08);
    else if (slope > .26 || y > 410) color = palette.rock.clone().lerp(palette.grass, .15 + field * .1);
    else color = palette.grass.clone().lerp(palette.soil, .2 + field * .12);
    return color.multiplyScalar(.96 + broad * .06);
  }
  function mesh(name: string, data: Surface, parent: THREE.Group) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3)); geometry.setIndex(data.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometries.add(geometry);
    const result = new THREE.Mesh(geometry, earth); result.name = name; parent.add(result); return result;
  }
  function quad(data: Surface, vertices: number[], color: THREE.Color) {
    const start = data.positions.length / 3; data.positions.push(...vertices); for (let i = 0; i < 4; i++) data.colors.push(color.r, color.g, color.b); data.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  function shell(tx: number, tz: number, step: number, stepped: boolean, parent: THREE.Group) {
    const data: Surface = { positions: [], colors: [], indices: [] };
    const nearbyBuildings = buildings.get(`${tx}:${tz}`) ?? [];
    const nearbyRoads = roads.get(`${tx}:${tz}`) ?? [];
    const half = step / 2;
    const height = (x: number, z: number) => surfaceHeight(x, z);
    for (let x = tx * TILE; x < (tx + 1) * TILE; x += step) for (let z = tz * TILE; z < (tz + 1) * TILE; z += step) {
      const xs = [x, x + step], zs = [z, z + step];
      const centreX = x + half, centreZ = z + half;
      const centreHeight = height(centreX, centreZ);
      const variation = Math.max(Math.abs(height(x, centreZ) - centreHeight), Math.abs(height(x + step, centreZ) - centreHeight), Math.abs(height(centreX, z) - centreHeight), Math.abs(height(centreX, z + step) - centreHeight));
      const cut = nearbyRoads.some(s => distanceToSegment(centreX, centreZ, s.a, s.b) < s.width + step && s.a.y + (s.b.y - s.a.y) * progress(centreX, centreZ, s.a, s.b) < height(centreX, centreZ) + 12)
        || nearbyBuildings.some(b => Math.abs(centreX - b.position.x) < b.width / 2 + step + 8 && Math.abs(centreZ - b.position.z) < b.depth / 2 + step + 8)
        || Math.hypot(centreX - fallTop.x, centreZ - fallTop.z) < 140;
      const subdivision = !stepped && (cut && variation > 1.2 || variation > step * .5) ? Math.min(step, 4) : step;
      for (let offset = subdivision; offset < step; offset += subdivision) { xs.push(x + offset); zs.push(z + offset); }
      // Exact footprint cuts retain the existing excavated basements and shared
      // floor dimensions even when a coarse proxy runs across a facade.
      for (const b of nearbyBuildings) if (x < b.position.x + b.width / 2 && x + step > b.position.x - b.width / 2 && z < b.position.z + b.depth / 2 && z + step > b.position.z - b.depth / 2) {
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
          if (west < top) quad(data, [a, west, d, a, top, d, a, top, c, a, west, c], side);
          if (east < top) quad(data, [b, east, c, b, top, c, b, top, d, b, east, d], side);
          if (north < top) quad(data, [a, north, c, a, top, c, b, top, c, b, north, c], side);
          if (south < top) quad(data, [b, south, d, b, top, d, a, top, d, a, south, d], side);
        } else {
          const inside = nearbyBuildings.find(building => Math.abs(mx - building.position.x) < building.width / 2 && Math.abs(mz - building.position.z) < building.depth / 2);
          const h = (xx: number, zz: number) => inside ? top : height(xx, zz);
          const ac = h(a, c), ad = h(a, d), bd = h(b, d), bc = h(b, c);
          quad(data, [a, ac, c, a, ad, d, b, bd, d, b, bc, c], color);
          // Proxy resolution changes and exact footprint cuts form T-junctions.
          // Close their exposed perimeter below both surfaces rather than
          // relying on one neighbour-centre sample to supply a missing face.
          if (cut || subdivision < step) {
            const bottom = Math.min(ac, ad, bd, bc, height(a - localHalf, mz), height(b + localHalf, mz), height(mx, c - localHalf), height(mx, d + localHalf)) - 16;
            const side = groundColor(mx, mz, top, slope, true);
            quad(data, [a, bottom, d, a, ad, d, a, ac, c, a, bottom, c], side);
            quad(data, [b, bottom, c, b, bc, c, b, bd, d, b, bottom, d], side);
            quad(data, [a, bottom, c, a, ac, c, b, bc, c, b, bottom, c], side);
            quad(data, [b, bottom, d, b, bd, d, a, ad, d, a, bottom, d], side);
          }
        }
      }
    }
    return mesh(stepped ? `近景岩土壳 ${tx}:${tz}` : `山形表面代理 ${tx}:${tz}`, data, parent);
  }
  const tiles: TerrainTile[] = [];
  const extent = Math.ceil(world.size / 2 / TILE);
  for (let x = -extent; x < extent; x++) for (let z = -extent; z < extent; z++) {
    const cx = (x + .5) * TILE, cz = (z + .5) * TILE;
    const populated = buildings.has(`${x}:${z}`) || riverAt(cx, cz).distance < 100 || Math.hypot(cx - world.waterfall.top.x, cz - world.waterfall.top.z) < 160;
    tiles.push({ x, z, coarse: shell(x, z, populated ? 8 : 16, false, group), used: 0, indexStart: 0, originalIndices: [], hidden: false });
  }
  const coarseChunks = new Map<string, TerrainTile[]>();
  for (const tile of tiles) { const key = `${Math.floor(tile.x / 8)}:${Math.floor(tile.z / 8)}`, list = coarseChunks.get(key) ?? []; list.push(tile); coarseChunks.set(key, list); }
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
  for (let i = 0; i < 55000 && trunks.length < 3600; i++) {
    const mountain = world.mountains[i % world.mountains.length], clustered = i % 4 !== 0;
    const x = quantize(clustered ? mountain.x + (hash(i, 38, world.seed) - .5) * mountain.radius * 1.9 : (hash(i, 38, world.seed) - .5) * world.size * .95), z = quantize(clustered ? mountain.z + (hash(i, 73, world.seed) - .5) * mountain.radius * 1.9 : (hash(i, 73, world.seed) - .5) * world.size * .95), y = surfaceHeight(x, z);
    if (y < 8 || y > 630 || !clearGround(x, z, 8)) continue;
    if (Math.abs(surfaceHeight(x + 8, z) - y) > 12 || Math.abs(surfaceHeight(x, z + 8) - y) > 12) continue;
    const height = quantize(12 + hash(i, 92, world.seed) * 16), color = new THREE.Color('#385d46').lerp(new THREE.Color('#7d936b'), hash(i, 91, world.seed) * .7);
    trunks.push({ x, y: y + height * .35, z, w: .8, h: height * .7, d: .8, color: new THREE.Color('#6b5c45') });
    // Each tier has projecting voxel branches, leaving light between crowns.
    for (let tier = 0; tier < 4; tier++) { const width = quantize(height * (.52 - tier * .105)); crowns.push({ x, y: y + height * (.48 + tier * .135), z, w: width, h: quantize(height * .11), d: width, color: color.clone().multiplyScalar(.93 + tier * .04) }); if (i % 3 === 0) crowns.push({ x: x + width * .12, y: y + height * (.52 + tier * .135), z: z - width * .08, w: width * .68, h: quantize(height * .13), d: width * .68, color }); }
    if (i % 2 === 0) bushes.push({ x: x + 3.2, y: y + .9, z: z + 2, w: 2.8, h: 1.8, d: 2.2, color: color.clone().lerp(new THREE.Color('#819169'), .2) });
  }
  batch('山林树干', trunks, rock, vegetation); batch('分枝松冠', crowns, leaf, vegetation); batch('山林灌木', bushes, leaf, vegetation);

  const water: THREE.ShaderMaterial[] = [createWater(false), createWater(true)]; materials.add(water[0]); materials.add(water[1]);
  const bankBlocks: Block[] = [], reeds: Block[] = [];
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = []; let flowDistance = 0;
  for (let i = 0; i < world.river.length; i++) {
    const p = world.river[i], before = world.river[Math.max(0, i - 1)], after = world.river[Math.min(world.river.length - 1, i + 1)]; if (i) flowDistance += Math.hypot(p.x - before.x, p.z - before.z);
    const dx = after.x - before.x, dz = after.z - before.z, length = Math.hypot(dx, dz) || 1, nx = -dz / length, nz = dx / length, width = 12 + Math.min(i, 5) * .6;
    vertices.push(p.x + nx * width, p.y + .55, p.z + nz * width, p.x - nx * width, p.y + .55, p.z - nz * width); uvs.push(0, flowDistance / 40, 1, flowDistance / 40);
    if (i) { const n = i * 2; indices.push(n - 2, n, n - 1, n - 1, n, n + 1); }
    if (!i) continue;
    const segmentLength = Math.hypot(p.x - before.x, p.z - before.z), tangentX = -(p.z - before.z) / segmentLength, tangentZ = (p.x - before.x) / segmentLength;
    for (let along = 0; along < segmentLength; along += 5.6) for (const side of [-1, 1]) {
      const t = along / segmentLength, x = quantize(before.x + (p.x - before.x) * t + tangentX * (width + 2 + hash(along, i, world.seed) * 3) * side), z = quantize(before.z + (p.z - before.z) * t + tangentZ * (width + 2 + hash(along, i, world.seed) * 3) * side), y = surfaceHeight(x, z);
      if (!clearGround(x, z, 1.2) || y > before.y + (p.y - before.y) * t + 9) continue;
      bankBlocks.push({ x, y: y + .35, z, w: quantize(1.2 + hash(along, i + 2, world.seed) * 2.8), h: .6, d: quantize(1 + hash(along, i + 3, world.seed) * 2), color: new THREE.Color('#a5aaa0') });
      if (along % 11.2 < 1) for (let stem = 0; stem < 4; stem++) reeds.push({ x: x + stem * .4, y: y + .8, z: z + stem % 2 * .4, w: .2, h: 1.6, d: .2, color: new THREE.Color('#849a6b') });
    }
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
  const foam: Block[] = [];
  for (let i = 0; i < 80; i++) { const angle = i * 2.39996, r = 3 + hash(i, 805, world.seed) * 21; foam.push({ x: quantize(bottom.x + Math.cos(angle) * r), y: bottom.y + .72, z: quantize(bottom.z + Math.sin(angle) * r), w: quantize(.8 + hash(i, 806, world.seed) * 2), h: .2, d: .4, color: new THREE.Color('#d3e9df') }); }
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
    const selected: TerrainTile[] = [];
    for (const tile of tiles) {
      const wanted = close && Math.abs(tile.x - centreX) <= (quality === 'low' ? 0 : 1) && Math.abs(tile.z - centreZ) <= (quality === 'low' ? 0 : 1);
      if (wanted) {
        const step = quality === 'high' ? 1 : 2;
        if (tile.fine && tile.fineStep !== step) destroyFine(tile);
        if (!tile.fine) {
          tile.fine = new THREE.Group(); tile.fineStep = step; tile.fine.name = `近景土石与植被 ${tile.x}:${tile.z}`; group.add(tile.fine); shell(tile.x, tile.z, step, true, tile.fine);
          const smallRocks: Block[] = [], grass: Block[] = [];
          for (let i = 0; i < (quality === 'low' ? 80 : 260); i++) {
            const x = quantize((tile.x + hash(i, 400 + tile.z, world.seed)) * TILE), z = quantize((tile.z + hash(i, 500 + tile.x, world.seed)) * TILE), y = surfaceHeight(x, z);
            if (!clearGround(x, z, 1.2)) continue;
            if (i % 3 === 0) smallRocks.push({ x, y: y + .2, z, w: .4 + .2 * (i % 4), h: .4, d: .4 + .2 * (i % 3), color: new THREE.Color(i % 2 ? '#a7ab9a' : '#878c7d') });
            else for (let stem = 0; stem < 3; stem++) grass.push({ x: x + stem * .2, y: y + .3, z: z + (stem % 2) * .2, w: .2, h: .4 + (stem % 2) * .2, d: .2, color: new THREE.Color(i % 2 ? '#869a71' : '#5e7958') });
          }
          batch('近景 · 0.2m碎石', smallRocks, rock, tile.fine); batch('近景 · 0.2m草叶', grass, leaf, tile.fine);
        }
        tile.used = epoch; tile.fine.visible = true; selected.push(tile);
      } else if (tile.fine) tile.fine.visible = false;
      if (tile.hidden !== wanted) { const index = tile.coarse.geometry.index!; for (let i = 0; i < tile.originalIndices.length; i++) index.setX(tile.indexStart + i, wanted ? tile.originalIndices[0] : tile.originalIndices[i]); index.needsUpdate = true; tile.hidden = wanted; }
    }
    const cached = tiles.filter(tile => tile.fine).sort((a, b) => b.used - a.used); for (const tile of cached.slice(18)) destroyFine(tile);
    group.userData.lod = { visibleFineTiles: selected.length, cachedFineTiles: Math.min(18, cached.length), tileMetres: TILE, surfaceStep: quality === 'high' ? 1 : 2, voxelMetres: world.voxelSize, lowAltitude: close };
    heightCache.clear();
  }
  group.userData.water = { continuous: true, riverVertices: world.river.length * 2, plungePoolRadius: 50, waterfallDrop: top.y - bottom.y };
  return { group, water, vegetation, update, dispose() { group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); }); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear(); } };
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
