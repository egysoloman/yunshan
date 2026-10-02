import * as THREE from 'three';

export interface RoofProfile {
  form: 'hip' | 'gable';
  x: number; y: number; z: number;
  width: number; depth: number; rise: number; overhang: number;
  floor: number; simple: boolean; color: string;
  /** Normalized footprint of the occupied storey above this eave. */
  innerHole?: readonly [number, number, number, number];
}

/** A shallow eave turns upward into the steeper tiled roof. Profiles are
 * normalized for instancing; footprint and height come from real buildings. */
export function roofHeightAt(form: RoofProfile['form'], x: number, z: number) {
  const radius = form === 'gable' ? Math.abs(x * 2) : Math.max(Math.abs(z * 2), Math.max(0, (Math.abs(x * 2) - .46) / .54));
  const slope = Math.max(0, Math.min(1, (radius - .12) / .88));
  return 1 - Math.pow(slope, .67) + .04 * Math.pow(slope, 8);
}

export function createRoofGeometry(form: RoofProfile['form'], simple = false, hole?: RoofProfile['innerHole']) {
  const count = simple ? 2 : 8, positions: number[] = [], indices: number[] = [], uv: number[] = [];
  const cuts = (a?: number, b?: number) => [...new Set([...Array.from({ length: count + 1 }, (_, i) => i / count - .5), ...[a, b].filter((v): v is number => v !== undefined && v > -.5 && v < .5)])].sort((a, b) => a - b);
  // Even the far proxy keeps both ends of the Chinese hip roof's long ridge.
  // A three-column grid collapses this profile back into a pointed pyramid.
  const xs = [...new Set([...cuts(hole?.[0], hole?.[1]), ...(form === 'hip' && simple ? [-.23, .23] : [])])].sort((a, b) => a - b), zs = cuts(hole?.[2], hole?.[3]), nx = xs.length - 1, nz = zs.length - 1;
  for (let layer = 0; layer < 2; layer++) for (const zz of zs) for (const xx of xs) {
    positions.push(xx, roofHeightAt(form, xx, zz) - layer * .04, zz); uv.push(xx + .5, zz + .5);
  }
  const stride = xs.length, layerSize = stride * zs.length;
  const retained = (x: number, z: number) => x >= 0 && z >= 0 && x < nx && z < nz && (!hole || !((xs[x] + xs[x + 1]) / 2 > hole[0] && (xs[x] + xs[x + 1]) / 2 < hole[1] && (zs[z] + zs[z + 1]) / 2 > hole[2] && (zs[z] + zs[z + 1]) / 2 < hole[3]));
  const close = (a: number, b: number) => indices.push(a, b, a + layerSize, b, b + layerSize, a + layerSize);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    if (!retained(x, z)) continue;
    const a = z * stride + x, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a, c, b, b, c, d);
    indices.push(a + layerSize, b + layerSize, c + layerSize, b + layerSize, d + layerSize, c + layerSize);
    if (!retained(x, z - 1)) close(a, b);
    if (!retained(x, z + 1)) close(d, c);
    if (!retained(x - 1, z)) close(c, a);
    if (!retained(x + 1, z)) close(b, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}
