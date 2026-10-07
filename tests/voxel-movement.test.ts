import assert from 'node:assert/strict';
import test from 'node:test';
import { blocksVoxelMovement, type MovementPoint, type MovementVoxel } from '../src/simulation/voxel-movement';
import { homeRestPointBlockedByVoxels } from '../src/simulation/home-rest';

const point = (x = 0, z = 0, y = 0): MovementPoint => ({ x, y, z });
const cube = (x = 0, z = 0, y = .8): MovementVoxel => ({ position: point(x, z, y) });
const distanceToCubeSquared = (p: MovementPoint, c: MovementVoxel) =>
  Math.max(Math.abs(p.x - c.position.x) - .1, 0) ** 2 + Math.max(Math.abs(p.z - c.position.z) - .1, 0) ** 2;
const lerp = (a: MovementPoint, b: MovementPoint, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

test('a 5cm move from the cube center can begin egress while standing/rest remains blocked', () => {
  for (const target of [point(.05), point(-.05), point(0, .05), point(0, -.05), point(.03, .04)]) {
    assert(homeRestPointBlockedByVoxels(point(), [cube()]));
    assert(homeRestPointBlockedByVoxels(target, [cube()]));
    assert.equal(blocksVoxelMovement(point(), target, [cube()]), false);
  }
});

test('the actual inherited capture first leg permits egress despite one-ULP snapped-center drift', () => {
  const from = { x: -408.8, y: 76.6, z: 301.59999999999997 };
  const next = { x: -406.8, y: 76.6, z: 301.8 };
  const voxels = [{ position: { x: -408.8, y: 77.4, z: 301.6 } }];
  const distance = Math.hypot(next.x - from.x, next.z - from.z);
  const proposed = lerp(from, next, .05 / distance);
  const before = structuredClone({ from, next, voxels });
  assert(homeRestPointBlockedByVoxels(from, voxels));
  assert(homeRestPointBlockedByVoxels(proposed, voxels));
  assert.equal(blocksVoxelMovement(from, proposed, voxels), false);
  assert.deepEqual({ from, next, voxels }, before);
});

test('zero motion and reversal toward the center remain blocked', () => {
  assert.equal(blocksVoxelMovement(point(), point(), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(.2), point(.15), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(.2), point(-.8), [cube()]), true);
});

test('endpoint farther away does not excuse an initial dive on the AABB platform', () => {
  for (const [from, to] of [
    [point(.09, .08), point(.06, .12)], // actual 0.05m counterexample
    [point(.09, .01), point(.08, .21)],
    [point(.1, .09), point(.09, .11)], // closed face first enters solid
  ]) {
    assert(to.x ** 2 + to.z ** 2 > from.x ** 2 + from.z ** 2);
    assert.equal(blocksVoxelMovement(from, to, [cube()]), true);
  }
});

test('existing inside overlap cannot slide through a center plane and exit another face', () => {
  assert.equal(blocksVoxelMovement(point(.01, .05), point(-.11, .08), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(.01, .05), point(.04, .08), [cube()]), false);
});

test('closed faces/corners allow an outward departure and reject entering the solid first', () => {
  assert.equal(blocksVoxelMovement(point(.1, .1), point(.12, .11), [cube()]), false);
  assert.equal(blocksVoxelMovement(point(.1, .09), point(.1, .12), [cube()]), false);
  assert.equal(blocksVoxelMovement(point(.1, .09), point(.09, .12), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(.099, .08), point(.098, .12), [cube()]), true);
});

test('an outside-cube rounded-corner escape does not need every axis to move outward', () => {
  const from = point(.30, .25), to = point(.28, .29);
  assert(homeRestPointBlockedByVoxels(from, [cube()]));
  assert(distanceToCubeSquared(to, cube()) > distanceToCubeSquared(from, cube()));
  assert.equal(blocksVoxelMovement(from, to, [cube()]), false);
});

test('radial distance increasing at the endpoint does not excuse first moving deeper', () => {
  assert.equal(blocksVoxelMovement(point(.3, .2), point(-.4, .4), [cube()]), true);
});

test('a clear start cannot enter a cube even when the endpoint is clear after a long sweep', () => {
  const from = point(-2), to = point(2);
  assert(!homeRestPointBlockedByVoxels(from, [cube()]));
  assert(!homeRestPointBlockedByVoxels(to, [cube()]));
  assert.equal(blocksVoxelMovement(from, to, [cube()]), true);
  assert.equal(blocksVoxelMovement(point(-2, .6), point(2, .6), [cube()]), false);
});

test('an origin-clear rounded-corner crossing cannot use a square-AABB shortcut', () => {
  assert.equal(blocksVoxelMovement(point(-1, .449), point(1, .449), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(-1, .46), point(1, .46), [cube()]), false);
});

test('the original radial EPS remains separate from the ULP center certificate', () => {
  const boundary = .1 + Math.sqrt(.35 ** 2 - 1e-7);
  assert.equal(blocksVoxelMovement(point(-2, boundary - 1e-8), point(2, boundary - 1e-8), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(-2, boundary + 1e-8), point(2, boundary + 1e-8), [cube()]), false);
});

test('leaving one intersected cube cannot enter another cube anywhere in the sweep', () => {
  const voxels = [cube(), cube(.6)];
  assert.equal(blocksVoxelMovement(point(), point(.2), voxels), true);
  assert.equal(blocksVoxelMovement(point(), point(2), voxels), true);
  assert.equal(blocksVoxelMovement(point(), point(-.05), voxels), false);
  assert.equal(blocksVoxelMovement(point(), point(2), [...voxels].reverse()), true);
});

test('every existing overlap must improve; opposite enclosing cubes can trap the body', () => {
  const voxels = [cube(-.2), cube(.2)];
  assert.equal(blocksVoxelMovement(point(), point(.05), voxels), true);
  assert.equal(blocksVoxelMovement(point(), point(-.05), voxels), true);
  assert.equal(blocksVoxelMovement(point(), point(0, .05), voxels), false);
});

test('embedded vertical or combined movement remains blocked', () => {
  assert.equal(blocksVoxelMovement(point(), point(0, 0, .05), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(), point(.05, 0, .001), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(), point(.05, 0, -.001), [cube()]), true);
});

test('non-overlapping floors and exact original vertical contacts remain clear', () => {
  assert.equal(blocksVoxelMovement(point(-2), point(2), [cube(0, 0, 4.2)]), false);
  const footTouch = cube(0, 0, 0);
  const feetY = footTouch.position.y + .1 - .01;
  assert.equal(footTouch.position.y + .1, feetY + .01);
  assert.equal(blocksVoxelMovement(point(-2, 0, feetY), point(2, 0, feetY), [footTouch]), false);
  const headTouch = cube(0, 0, 1.82);
  assert.equal(headTouch.position.y - .1, 1.72);
  assert.equal(blocksVoxelMovement(point(-2), point(2), [headTouch]), false);
});

test('changing-height clear motion cannot acquire an intermediate overlap', () => {
  const from = point(-2, 0, -3), to = point(2, 0, 3);
  assert(!homeRestPointBlockedByVoxels(from, [cube()]));
  assert(!homeRestPointBlockedByVoxels(to, [cube()]));
  assert.equal(blocksVoxelMovement(from, to, [cube()]), true);
});

test('a clear graded segment keeps correlation between its actual XZ and open Y interval', () => {
  // Cube center .8 gives feet band (-1.02,.89). This path first enters
  // the band at t=.66, X=.64, after clearing the radius-expanded footprint.
  // The full horizontal projection crosses X=0 earlier, while feet=-1.5
  // and body top=.22 is still below the real cube bottom=.7.
  assert.equal(blocksVoxelMovement(point(-2, 0, -3), point(2, 0, 0), [cube()]), false);
  assert.equal(blocksVoxelMovement(point(-2, 0, -3), point(2, 0, 3), [cube()]), true);
});

test('clear changing-height motion remains possible when its projection or full Y band is separated', () => {
  assert.equal(blocksVoxelMovement(point(2), point(2, 0, .05), [cube()]), false);
  assert.equal(blocksVoxelMovement(point(-2, 0, 3), point(2, 0, 6), [cube()]), false);
});

test('ULP center drift is distinguished from a measurable inward reversal', () => {
  const anchor = 400, ulp = Number.EPSILON * 8 * anchor;
  const voxels = [cube(anchor, anchor)];
  assert.equal(blocksVoxelMovement(point(anchor, anchor - Number.EPSILON * anchor), point(anchor + .05, anchor + .005), voxels), false);
  assert.equal(blocksVoxelMovement(point(anchor + ulp * 32, anchor), point(anchor - .05, anchor), voxels), true);
  assert.equal(blocksVoxelMovement(point(.099, .08), point(.099 - 1e-9, .12), [cube()]), true);
});

test('invalid arithmetic fails closed and no voxels grants no movement exemption', () => {
  assert.equal(blocksVoxelMovement(point(NaN), point(), []), true);
  assert.equal(blocksVoxelMovement(point(), point(Infinity), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(), point(.05), [cube(NaN)]), true);
  assert.equal(blocksVoxelMovement(point(-1e154), point(1e154), [cube()]), true);
  assert.equal(blocksVoxelMovement(point(), point(.05), [cube(0, 0, 1e308)]), true);
  assert.equal(blocksVoxelMovement(point(-2, 0, 1e16 - 2), point(2, 0, 1e16 + 2), [cube(0, 0, 1e16)]), true);
  assert.equal(blocksVoxelMovement(point(), point(.05), []), false);
});

test('independent directional probes show accepted sweeps never deepen real radial overlap', () => {
  // Independent sampled oracle is validation, not the production sweep rule.
  // Selected grid includes plateau, closed edges, rounded corners, reversal,
  // large segments and traps. It is intentionally deterministic and bounded.
  for (const from of [point(), point(.09, .08), point(.1, .09), point(.3, .25), point(-.3, -.1)]) {
    for (const delta of [point(.05), point(-.05), point(0, .05), point(.03, .04), point(-.03, .04), point(1, -1)]) {
      const to = point(from.x + delta.x, from.z + delta.z);
      if (blocksVoxelMovement(from, to, [cube()])) continue;
      let previous = distanceToCubeSquared(from, cube());
      for (let i = 1; i <= 100; i++) {
        const current = distanceToCubeSquared(lerp(from, to, i / 100), cube());
        assert(current >= previous - 1e-14, `accepted sweep deepened at sample ${i}: ${JSON.stringify({ from, to })}`);
        previous = current;
      }
    }
  }
});
