import assert from 'node:assert/strict';
import test from 'node:test';
import { CURVED_ROOF_PROFILE_KNOTS, roofProfileBlocksSweep, roofProfileCircleMax, roofProfileTopAt, type RoofProfileSweepQuery } from '../src/geometry/roof-profile';
import { createCurvedRoofMesh } from '../src/geometry/roof-profile-mesh';
import { createWorld } from '../src/world';
import { getBuildingBody, getFloorPlanRoofRegions } from '../src/architecture-floor-plan';
import { buildProgramArchitecture, programRoofTemplate } from '../src/rendering/architecture-bodies';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('continuous sweep catches a raised eave that the old .1m samples miss', () => {
  const radius = .35, orth = -Math.sqrt(radius * radius - .005 * .005);
  const query: RoofProfileSweepQuery = { from: { cross: -.14, orth, feet: .62 }, to: { cross: .05, orth, feet: .62 }, radius, eyeHeight: 1.72,
    crossMin: 0, crossMax: .4, orthMin: 0, orthMax: 1, bottom: 0, top: 1.6 };
  // These are the exact three positions visited by ceil(.19/.1), preserving
  // the review's independently specified counterexample rather than replacing
  // it with a test that merely samples the new algorithm more densely.
  for (const cross of [-.14, -.045, .05]) {
    const top = roofProfileCircleMax({ cross, orth, radius, crossMin: 0, crossMax: .4, orthMin: 0, orthMax: 1, bottom: 0, top: 1.6 });
    assert.ok(top === null || top <= .62);
  }
  assert.equal(roofProfileBlocksSweep(query), true);
  assert.equal(roofProfileBlocksSweep({ ...query, from: query.to, to: query.from }), true);
  assert.equal(roofProfileBlocksSweep({ ...query, from: { ...query.from, orth: -.350001 }, to: { ...query.to, orth: -.350001 } }), false);
});

test('circular support takes the interval maximum on an upturned tip and clips the orthogonal reach', () => {
  const query = { cross: .385, orth: .5, radius: .015, crossMin: 0, crossMax: .4, orthMin: 0, orthMax: 1, bottom: 0, top: 1.6 };
  close(roofProfileCircleMax(query)!, .64);
  assert.ok(roofProfileTopAt(.385 / .4, 0, 1.6) < .64);
  assert.equal(roofProfileCircleMax({ ...query, orth: -.015001 }), null);
  close(roofProfileCircleMax({ ...query, orth: -.015 })!, roofProfileTopAt(.385 / .4, 0, 1.6));
});

test('moving orthogonal reach detects an interior height maximum when both endpoint poses clear', () => {
  const query: RoofProfileSweepQuery = { from: { cross: 2.1, orth: 0, feet: .89 }, to: { cross: 2.1, orth: -.35, feet: .7702 }, radius: .35, eyeHeight: 1.72,
    crossMin: 0, crossMax: 10, orthMin: 0, orthMax: 1, bottom: 0, top: 1.6 };
  for (const pose of [query.from, query.to]) {
    const top = roofProfileCircleMax({ cross: pose.cross, orth: pose.orth, radius: query.radius, crossMin: 0, crossMax: 10, orthMin: 0, orthMax: 1, bottom: 0, top: 1.6 });
    assert.ok(top !== null && top < pose.feet);
  }
  const middle = roofProfileCircleMax({ cross: 2.1, orth: -.175, radius: .35, crossMin: 0, crossMax: 10, orthMin: 0, orthMax: 1, bottom: 0, top: 1.6 });
  assert.ok(middle !== null && middle > (.89 + .7702) / 2);
  assert.equal(roofProfileBlocksSweep(query), true);
  assert.equal(roofProfileBlocksSweep({ ...query, from: query.to, to: query.from }), true);
});

test('sweep considers head clearance and vertical motion independently of the foot disk', () => {
  const query: RoofProfileSweepQuery = { from: { cross: -.5, orth: .5, feet: 1.600001 }, to: { cross: 1.5, orth: .5, feet: 1.600001 }, radius: .35, eyeHeight: 1.72,
    crossMin: 0, crossMax: 1, orthMin: 0, orthMax: 1, bottom: 0, top: 1.6 };
  assert.equal(roofProfileBlocksSweep(query), false);
  assert.equal(roofProfileBlocksSweep({ ...query, from: { cross: .5, orth: .5, feet: -2 }, to: { cross: .5, orth: .5, feet: -1.8 } }), false);
  assert.equal(roofProfileBlocksSweep({ ...query, from: { cross: .5, orth: .5, feet: -2 }, to: { cross: .5, orth: .5, feet: 2 } }), true);
});

test('both shared mesh axes are closed with consistent winding and the exact declared top knots', () => {
  for (const axis of ['x', 'z'] as const) {
    const mesh = createCurvedRoofMesh(axis), edgeBalance = new Map<string, { count: number; balance: number }>();
    let signedVolume = 0;
    assert.equal(mesh.positions.length / 9, 68);
    assert.equal(mesh.normals.length, mesh.positions.length);
    assert.equal(mesh.uvs.length, mesh.positions.length / 3 * 2);
    const point = (index: number) => mesh.positions.slice(index * 3, index * 3 + 3);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.slice(i, i + 3).map(point);
      const ab = b.map((value, j) => value - a[j]), ac = c.map((value, j) => value - a[j]);
      const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const bc = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
      signedVolume += (a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2]) / 6;
      const length = Math.hypot(...normal); assert.ok(length > 0);
      for (let j = 0; j < 3; j++) close(normal[j] / length, mesh.normals[i * 3 + j]);
      for (const [from, to] of [[a, b], [b, c], [c, a]]) {
        const left = from.join(','), right = to.join(','), forward = left < right;
        const key = forward ? `${left}|${right}` : `${right}|${left}`, edge = edgeBalance.get(key) ?? { count: 0, balance: 0 };
        edge.count++; edge.balance += forward ? 1 : -1; edgeBalance.set(key, edge);
      }
      for (const vertex of [a, b, c]) {
        assert.ok(vertex.every(value => value >= -.5 && value <= .5));
        const u = vertex[axis === 'x' ? 0 : 2] + .5;
        assert.ok(vertex[1] + .5 <= roofProfileTopAt(u, 0, 1) + 1e-12);
      }
    }
    for (const edge of edgeBalance.values()) { assert.equal(edge.count, 2); assert.equal(edge.balance, 0); }
    const profileVolume = CURVED_ROOF_PROFILE_KNOTS.slice(1).reduce((sum, [u, height], index) => {
      const [previousU, previousHeight] = CURVED_ROOF_PROFILE_KNOTS[index];
      return sum + (u - previousU) * (height + previousHeight) / 2;
    }, 0);
    assert.ok(signedVolume > 0, `${axis}: closed faces must wind outward`);
    close(signedVolume, profileVolume);
    for (const [u, height] of CURVED_ROOF_PROFILE_KNOTS) assert.ok(mesh.positions.some((_value, index) => index % 3 === 0
      && mesh.positions[index + (axis === 'x' ? 0 : 2)] === u - .5 && mesh.positions[index + 1] === height - .5));
  }
});

test('declaring a curved roof creates a new body without changing historical roof descriptors or template keys', () => {
  const world = createWorld(20261001, 'current-v6'), building = world.buildings.find(site => site.id === 'market-b26')!;
  const oldBody = getBuildingBody(building)!, oldText = JSON.stringify(oldBody), oldRoofs = getFloorPlanRoofRegions(oldBody), oldRoofText = JSON.stringify(oldRoofs);
  assert.equal(Object.hasOwn(oldBody, 'roofGeometryRevision'), false);
  assert.equal(programRoofTemplate('x').key, 'program-gable-x-1');
  assert.equal(programRoofTemplate('z').key, 'program-gable-z-1');
  building.roofGeometryRevision = 2;
  const body = getBuildingBody(building)!;
  assert.notEqual(body, oldBody);
  assert.equal(JSON.stringify(oldBody), oldText); assert.equal(JSON.stringify(oldRoofs), oldRoofText);
  assert.deepEqual(body.floorPlans, oldBody.floorPlans);
  const roofs = getFloorPlanRoofRegions(body);
  assert.deepEqual(roofs.map(roof => [roof.rect, roof.bottom, roof.floor, roof.kind, roof.gableAxis]), oldRoofs.map(roof => [roof.rect, roof.bottom, roof.floor, roof.kind, roof.gableAxis]));
  const near = buildProgramArchitecture(building, 'near')!.filter(part => part.roof);
  const far = buildProgramArchitecture(building, 'far')!.filter(part => part.roof);
  assert.deepEqual(near.map(part => [part.position, part.size, part.template]), far.map(part => [part.position, part.size, part.template]));
});
