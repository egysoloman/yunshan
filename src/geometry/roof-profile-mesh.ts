import { CURVED_ROOF_PROFILE_KNOTS, CURVED_ROOF_PROFILE_VERSION } from './roof-profile';

/** Pure, normalized closed prism for the exact revision-two physical profile.
 * No Three, Simulation, actor or transport inputs. Its x/z extent is precisely
 * [-.5,.5], and its bottom is -.5: the existing region supplies world bounds.
 * Each cap is partitioned into profile strips, so a concave upturned eave does
 * not need a convex fan that would fill the recess above the actual surface.
 * Flat normals preserve the declared piecewise silhouette in both LODs. */
export interface CurvedRoofMesh {
  key: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}
type Point = readonly [number, number, number];

export function createCurvedRoofMesh(axis: 'x' | 'z'): CurvedRoofMesh {
  if (axis !== 'x' && axis !== 'z') throw new Error('Invalid curved roof axis');
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const point = (u: number, height: number, along: number): Point => axis === 'x'
    ? [u - .5, height - .5, along - .5]
    : [along - .5, height - .5, u - .5];
  const mappedNormal = (cross: number, y: number, along: number): Point => axis === 'x'
    ? [cross, y, along] : [along, y, cross];
  const triangle = (a: Point, b: Point, c: Point, outward: Point) => {
    const cross = (p: Point, q: Point, r: Point): [number, number, number] => {
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
      const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    let normal = cross(a, b, c);
    if (normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0) {
      [b, c] = [c, b]; normal = cross(a, b, c);
    }
    const length = Math.hypot(...normal);
    if (!(length > 0)) throw new Error('Degenerate curved roof face');
    for (const vertex of [a, b, c]) {
      positions.push(...vertex); normals.push(normal[0] / length, normal[1] / length, normal[2] / length);
      // Retain the existing roof material's horizontal world-metric convention.
      uvs.push(vertex[0] + .5, vertex[2] + .5);
    }
  };
  const quad = (a: Point, b: Point, c: Point, d: Point, outward: Point) => {
    triangle(a, b, c, outward); triangle(a, c, d, outward);
  };
  const knots = CURVED_ROOF_PROFILE_KNOTS;
  for (let i = 0; i < knots.length - 1; i++) {
    const [u0, h0] = knots[i], [u1, h1] = knots[i + 1];
    quad(point(u0, h0, 0), point(u1, h1, 0), point(u1, h1, 1), point(u0, h0, 1), mappedNormal(h0 - h1, u1 - u0, 0));
    for (const end of [0, 1]) quad(point(u0, 0, end), point(u1, 0, end), point(u1, h1, end), point(u0, h0, end), mappedNormal(0, 0, end ? 1 : -1));
    // Split the unchanged flat base at the cap knots too. Every geometric edge
    // then has an equal opposite partner, without T-junctions on the bottom rim.
    quad(point(u0, 0, 0), point(u1, 0, 0), point(u1, 0, 1), point(u0, 0, 1), [0, -1, 0]);
  }
  // The base remains one unchanged plane. Side walls close the original rectangle;
  // they do not make an extra overhang or an unsupported decorative extension.
  quad(point(0, 0, 0), point(0, 0, 1), point(0, knots[0][1], 1), point(0, knots[0][1], 0), mappedNormal(-1, 0, 0));
  quad(point(1, 0, 0), point(1, 0, 1), point(1, knots[knots.length - 1][1], 1), point(1, knots[knots.length - 1][1], 0), mappedNormal(1, 0, 0));
  return { key: `program-${CURVED_ROOF_PROFILE_VERSION}-${axis}`, positions, normals, uvs,
    indices: Array.from({ length: positions.length / 3 }, (_, index) => index) };
}
