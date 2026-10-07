import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { planWalkingJourney } from '../src/journey.ts';
import { guardrailSpans, hasGuardrailAt } from '../src/transport-geometry.ts';
import { FLOOR_PLAN_PROFILE, getBuildingBody, wallPanels } from '../src/architecture-floor-plan.ts';
import { CURRENT_CITY_LAYOUT, getWalkHeight } from '../src/world.ts';
import { checkPublicStreetBirthGeometry, getPublicStreetBirthWalkHeight, selectValidatedPublicStreetBirth } from '../src/geometry/public-street-birth-check.ts';
import { proposePublicStreetBirth, publicStreetBoxTopFaces, publicStreetRoadCircleHeight, publicStreetRoadFaceHeight, publicStreetRoadFaces, validatePublicStreetBirth, type PublicStreetBirthProposal } from '../src/geometry/public-street-birth.ts';
import type { Building, NetworkEdge, SimState, WorldDefinition } from '../src/types.ts';

// Independent producer: the original BoxBatch.segment uses Three's actual
// shortest-arc quaternion and Matrix4, rather than the new analytic helper.
function renderedTopFaces(edge: NetworkEdge, width: number, height: number, lift: number) {
  return edge.points.slice(1).map((b, index) => {
    const a = edge.points[index], va = new THREE.Vector3(a.x, a.y + lift, a.z), vb = new THREE.Vector3(b.x, b.y + lift, b.z);
    const direction = vb.clone().sub(va), length = direction.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
    const matrix = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(.5), rotation, new THREE.Vector3(width, height, length));
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const side = normal.y < 0 ? -.5 : .5;
    const vertices = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, z]) => new THREE.Vector3(x, side, z).applyMatrix4(matrix));
    if (normal.y < 0) normal.negate();
    return { vertices, normal, planeConstant: normal.dot(vertices[0]) };
  });
}

/** Literal b26 entrance and original first two road segments. No Simulation,
 * regeneration, original save edit or actor/camera relocation. */
function arrivalFixture(): WorldDefinition {
  const market: Building = { id: 'market-b26', districtId: 'market', name: '千灯市集·云锦街·商肆7', kind: 'market', position: { x: -282, y: 79.80000000000001, z: 387.6 }, width: 35.2, depth: 26.8, height: 7.2, floors: 2, rotation: 0, door: { x: -282, y: 80.4, z: 401 }, capacity: 58, seed: 123023086, stairGeometryRevision: 2, floorPlanProfile: FLOOR_PLAN_PROFILE, roofGeometryRevision: 2 };
  const destination = { x: -269, y: 80.2, z: 408 };
  return { seed: 20261001, voxelSize: .2, size: 4400,
    districts: [{ id: 'market', name: '千灯市集', kind: 'market', center: { x: -282, y: 79.8, z: 387.6 }, radius: 420, population: 58, color: '#dcad69' }], buildings: [market],
    nodes: [{ id: 'actual-door-node', districtId: 'market', name: market.name, position: { ...market.door }, station: false }, { id: 'actual-quarter-node', districtId: 'market', name: 'actual quarter', position: destination, station: false }],
    edges: [{ id: 'actual-original-road', from: 'actual-door-node', to: 'actual-quarter-node', mode: 'road', capacity: 80, length: 7 + Math.hypot(13, .2), points: [{ ...market.door }, { x: -282, y: 80.4, z: 408 }, destination] }],
    mountains: [], spawn: { x: -330, y: 51.5375, z: 487 }, river: [{ x: 1500, y: 2, z: 1400 }, { x: 1600, y: 2, z: 1500 }],
    waterfall: { top: { x: 1200, y: 200, z: -1000 }, bottom: { x: 1200, y: 10, z: -800 }, width: 40 },
  };
}
function proposal(world: WorldDefinition): PublicStreetBirthProposal {
  const result = proposePublicStreetBirth(world); assert(result.ok, result.ok ? '' : result.reason); return result.proposal;
}
function checked(world: WorldDefinition, value = proposal(world)) { return validatePublicStreetBirth(world, value, checkPublicStreetBirthGeometry); }

function declaredArrival(world: WorldDefinition, layout = 'current-v8') {
  const value = proposal(world);
  Reflect.set(world, 'layoutVersion', layout); world.spawn = { ...value.birth };
  world.referenceCityRecipe = { originalSpawn: { x: -330, y: 51.5375, z: 487 }, arrival: { recipe: value.recipeVersion, edgeId: value.edgeId, buildingId: value.buildingId, lookTarget: { ...value.lookTarget }, pathToDoor: value.pathToDoor.map(p => ({ ...p })) } };
  return value;
}

test('production navigation connects the actual supported birth directly to its true doorway', () => {
  const world = arrivalFixture(), value = declaredArrival(world), before = JSON.stringify(world);
  const journey = planWalkingJourney(world, world.spawn, value.buildingId);
  assert(journey); assert.deepEqual(journey.points, value.pathToDoor);
  assert.deepEqual(journey.edgeIds, [value.edgeId]); assert.equal(journey.originNodeId, world.nodes[0].id);
  assert(Math.abs(journey.metres - Math.sqrt(58)) < 1e-10);
  assert.equal(JSON.stringify(world), before, 'planning cannot move the actor or change the world');
});

test('the v8 sidewalk connection still rejects an actual wall between birth and door', () => {
  const world = arrivalFixture(), value = declaredArrival(world), plan = getBuildingBody(world.buildings[0])!.floorPlans.find(p => p.floor === 0)!;
  wallPanels(plan).push({ rect: { x0: 1.4, x1: 1.6, z0: 16.5, z1: 17.3 }, bottom: 0, top: 2.8, kind: 'solid' });
  assert.equal(planWalkingJourney(world, world.spawn, value.buildingId), null);
});

test('a closed actual arrival road cannot be bypassed by the v8 sidewalk connection', () => {
  const world = arrivalFixture(), value = declaredArrival(world);
  const state = { roadNetwork: { version: 1, activatedAt: 0, revision: 1, nextClosureId: 2, permits: {}, closures: [{
    id: 'actual-closure', edgeId: value.edgeId, sourceEventId: 1, districtId: 'market', occurredAt: 0, severity: 1,
    closedRevision: 1, worksiteNodeId: world.nodes[1].id, worksite: { ...world.nodes[1].position },
    reopenedAt: null, repairedBy: null, reopenedRevision: null, occupants: [],
  }] } } as unknown as SimState;
  const before = JSON.stringify(state);
  assert.equal(planWalkingJourney(world, world.spawn, value.buildingId, state), null);
  assert.equal(JSON.stringify(state), before, 'planning cannot reopen the road or grant an exit permit');
});

test('the new connection cannot use an unsupported outside corner or an absent road', () => {
  const world = arrivalFixture(), value = declaredArrival(world);
  const corner = { x: -282, y: 80.4, z: 408 };
  assert.equal(getPublicStreetBirthWalkHeight(world, corner.x, corner.z), null);
  world.spawn = corner; world.referenceCityRecipe!.arrival!.pathToDoor[0] = { ...corner };
  assert.equal(planWalkingJourney(world, corner, value.buildingId), null);
  world.edges = []; assert.equal(planWalkingJourney(world, corner, value.buildingId), null);
});

test('v6 navigation retains the original centreline route and does not gain the v8 sidewalk', () => {
  const world = arrivalFixture(), value = declaredArrival(world, 'current-v6'), before = JSON.stringify(world);
  const journey = planWalkingJourney(world, world.spawn, value.buildingId); assert(journey);
  // The original planner first projects to the graded X segment's centreline.
  // Its complete baseline result was independently read and compared exactly.
  const projectedY = 80.4 + (80.2 - 80.4) * (3 / 13);
  assert.deepEqual(journey.points, [value.birth, { x: -279, y: projectedY, z: 408 }, { x: -282, y: 80.4, z: 408 }, world.buildings[0].door]);
  assert.equal(JSON.stringify(world), before);
});

test('real b26 join produces the direct 7.6m approach on actual original faces', () => {
  const world = arrivalFixture(), before = JSON.stringify(world), candidate = proposal(world);
  assert.deepEqual(candidate.birth, { x: -279, y: 80.4, z: 408 });
  assert.deepEqual(candidate.pathToDoor, [candidate.birth, world.buildings[0].door]);
  const accepted = checked(world, candidate); assert(accepted.ok, accepted.ok ? '' : accepted.reason);
  assert.equal(JSON.stringify(world), before, 'checking never changes original spawn or graph');
  assert.equal(CURRENT_CITY_LAYOUT, 'current-v6');
});

test('graded X segment preserves actual shortest-arc crossfall and precise top Y', () => {
  const world = arrivalFixture(), faces = publicStreetRoadFaces(world.edges[0]), graded = faces[1];
  const y = publicStreetRoadFaceHeight(graded, -275.5, 408);
  const rendered = renderedTopFaces(world.edges[0], 10, .5, -.25)[1];
  const expected = (rendered.planeConstant - rendered.normal.x * -275.5 - rendered.normal.z * 408) / rendered.normal.y;
  assert(Math.abs(y - expected) < 1e-10, 'physical top matches the actual Three producer');
  assert(y > 80.3 && y < 80.3001, 'world-Y lift and rotated top differ from centerline');
  assert(graded.normal.x > 0 && graded.normal.z > 0);
  assert.equal(publicStreetRoadCircleHeight(faces, -279, 408), 80.4, 'overlapping original flat face supports birth');
});

test('generic box-top face uses the real curb width, height and world-Y lift', () => {
  const original = arrivalFixture().edges[0], flat = { ...original, points: [{ x: 0, y: 80.4, z: 0 }, { x: 0, y: 80.4, z: 7 }] };
  const face = publicStreetBoxTopFaces(flat, .4, .2, .12)[0];
  assert(Math.abs(publicStreetRoadFaceHeight(face, 0, 3.5) - 80.62) < 1e-12, 'real curb top is .22m above a level deck');
  assert.equal(Math.max(...face.vertices.map(p => p.x)) - Math.min(...face.vertices.map(p => p.x)), .4);
  assert(Math.abs(publicStreetRoadCircleHeight([face], 0, 3.5)! - 80.62) < 1e-12);
});

test('analytic road faces match actual Three matrices for graded, reversed and runway decks', () => {
  const edge = arrivalFixture().edges[0], reversed = { ...edge, points: [...edge.points].reverse() }, runway = { ...edge, id: 'road-airport-runway-strip' };
  for (const source of [edge, reversed, runway]) {
    const actual = publicStreetRoadFaces(source), rendered = renderedTopFaces(source, source === runway ? 44 : 10, .5, -.25);
    assert.equal(actual.length, rendered.length);
    actual.forEach((face, index) => {
      const expected = rendered[index];
      for (const point of face.vertices) {
        const closest = Math.min(...expected.vertices.map(vertex => Math.hypot(vertex.x - point.x, vertex.y - point.y, vertex.z - point.z)));
        assert(closest < 1e-10, 'each physical corner matches an independently rendered corner');
      }
      assert(Math.hypot(face.normal.x - expected.normal.x, face.normal.y - expected.normal.y, face.normal.z - expected.normal.z) < 1e-10);
      assert(Math.abs(face.planeConstant - expected.planeConstant) < 1e-10);
    });
  }
});

test('actual descending negative-Z road uses its existing local-bottom upward face', () => {
  const edge = { ...arrivalFixture().edges[0], points: [{ x: -256, y: 80.2, z: 408 }, { x: -256, y: 80, z: 388 }] };
  const a = new THREE.Vector3(-256, 80.2, 408), b = new THREE.Vector3(-256, 80, 388);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.sub(a).normalize());
  assert(new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).y < 0, 'the actual renderer flips local +Y down on this original segment');
  for (const source of [edge, { ...edge, points: [...edge.points].reverse() }]) {
    const face = publicStreetRoadFaces(source)[0], expected = renderedTopFaces(source, 10, .5, -.25)[0];
    assert(face.normal.y > 0, 'existing world-upward surface is required');
    for (const point of face.vertices) assert(Math.min(...expected.vertices.map(vertex => vertex.distanceTo(new THREE.Vector3(point.x, point.y, point.z)))) < 1e-10);
    assert(Math.hypot(face.normal.x - expected.normal.x, face.normal.y - expected.normal.y, face.normal.z - expected.normal.z) < 1e-10);
    const physicalY = (expected.planeConstant - expected.normal.x * -256 - expected.normal.z * 398) / expected.normal.y;
    assert(Math.abs(publicStreetRoadFaceHeight(face, -256, 398) - physicalY) < 1e-10);
  }
});

test('a vertical road face cannot be invented as a walkable height graph', () => {
  const edge = { ...arrivalFixture().edges[0], points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }] };
  assert.throws(() => publicStreetRoadFaces(edge), /not a walkable height graph/);
});

test('actual b26 curb crossing raises the feet and leaving it restores the deck height', () => {
  const world = arrivalFixture(), value = proposal(world);
  world.referenceCityRecipe = { originalSpawn: { ...world.spawn }, arrival: { recipe: value.recipeVersion, edgeId: value.edgeId, buildingId: value.buildingId, lookTarget: { ...value.lookTarget }, pathToDoor: value.pathToDoor.map(p => ({ ...p })) } };
  const crossing = getPublicStreetBirthWalkHeight(world, -281.0357142857143, 403.25);
  assert(crossing !== null && crossing > 80.4 && crossing <= 80.62, 'feet must stand on the actual curb top, not intersect a waived curb');
  assert.equal(getPublicStreetBirthWalkHeight(world, -279, 408), 80.4, 'leaving the curb returns to actual overlapping deck support');
  assert.equal(getPublicStreetBirthWalkHeight(world, -282, 401), 80.4, 'true public doorway keeps its original floor height');
});

test('a center-only rounded-cap shortcut is rejected as an unbound birth route', () => {
  const world = arrivalFixture(), value = proposal(world);
  const forged = { ...value, birth: { x: -282, y: 80.4, z: 408 }, pathToDoor: [{ x: -282, y: 80.4, z: 408 }, world.buildings[0].door] };
  assert.equal(checked(world, forged).ok, false);
  world.referenceCityRecipe = { originalSpawn: { ...world.spawn }, arrival: { recipe: value.recipeVersion, edgeId: value.edgeId, buildingId: value.buildingId, lookTarget: { ...value.lookTarget }, pathToDoor: value.pathToDoor.map(p => ({ ...p })) } };
  assert.equal(getPublicStreetBirthWalkHeight(world, -282, 408), null, 'real circle at the outer join has an unsupported quarter despite a supported center');
  assert.equal(getPublicStreetBirthWalkHeight(world, -279, 408), 80.4, 'the actual selected birth has full disk support');
  const selected = selectValidatedPublicStreetBirth(world); assert(selected.ok, selected.ok ? '' : selected.reason);
});

test('an actual middle wall rejects despite clear endpoints and unchanged proposal', () => {
  const world = arrivalFixture(), value = proposal(world), plan = getBuildingBody(world.buildings[0])!.floorPlans.find(p => p.floor === 0)!;
  wallPanels(plan).push({ rect: { x0: 1.4, x1: 1.6, z0: 16.5, z1: 17.3 }, bottom: 0, top: 2.8, kind: 'solid' });
  const result = checked(world, value); assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /real building body blocks/);
});

test('actual .35m circle rejects an off-center solid at birth', () => {
  const world = arrivalFixture(), value = proposal(world), plan = getBuildingBody(world.buildings[0])!.floorPlans.find(p => p.floor === 0)!;
  plan.fixtures.push({ id: 'off-center-solid', kind: 'shelf', rect: { x0: 3.2, x1: 3.22, z0: 20.39, z1: 20.41 }, bottom: 0, top: 2 });
  assert.equal(checked(world, value).ok, false, 'clear center is insufficient for unchanged-radius body');
});

test('new reference bends open actual shared rail spans while old spans remain exact', () => {
  const world = arrivalFixture(), edge = world.edges[0];
  const old = guardrailSpans(world, edge, 2);
  assert.equal(old.length, 1); assert.deepEqual(old[0].a, edge.points[1]);
  world.referenceCityRecipe = { originalSpawn: { ...world.spawn }, streetGuardJoinRevision: 2 };
  assert.equal(hasGuardrailAt(world, edge, 7 + 1), false, 'the crossed physical deck opens both actual rail and collision intervals');
  assert.equal(hasGuardrailAt(world, edge, 13), true, 'the rail away from the bend is retained');
  const opened = guardrailSpans(world, edge, 2);
  assert.equal(opened.length, 1); assert(opened[0].a.x > -277, 'actual renderer span begins past the intersecting deck');
  delete world.referenceCityRecipe.streetGuardJoinRevision;
  assert.deepEqual(guardrailSpans(world, edge, 2), old, 'cache identity must include the physical revision');
});

test('a shallow self-bend opening cannot erase rails of a later unrelated segment', () => {
  const world = arrivalFixture(), edge = world.edges[0];
  edge.points = [{ x: -100, y: 80, z: 0 }, { x: 0, y: 80, z: 0 }, { x: -100, y: 80, z: .1 }, { x: -100, y: 80, z: 100 }];
  world.referenceCityRecipe = { originalSpawn: { ...world.spawn }, streetGuardJoinRevision: 2 };
  const thirdStart = 100 + Math.hypot(100, .1);
  assert.equal(hasGuardrailAt(world, edge, 100), false, 'actual first self-bend opens');
  assert.equal(hasGuardrailAt(world, edge, thirdStart + 20), true, 'angle-derived long opening is clipped to the participating segments');
  const spans = guardrailSpans(world, edge, 3);
  assert.equal(spans.length, 1); assert(spans[0].a.z < 20 && spans[0].b.z > 90);
});

test('near bridge endpoint is rejected even when no shared guardrail crosses the route', () => {
  const world = arrivalFixture(), value = proposal(world);
  world.edges.push({ id: 'near-bridge', mode: 'bridge', from: 'bridge-from', to: 'bridge-to', capacity: 80, length: 30, points: [{ x: -279, y: 80.4, z: 408 }, { x: -279, y: 80.4, z: 438 }] });
  const result = checked(world, value); assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /network solid domain/);
});

test('missing true door connectivity rejects without changing old spawn', () => {
  const world = arrivalFixture(), original = { ...world.spawn }; world.edges[0].from = 'invented-name';
  assert.equal(selectValidatedPublicStreetBirth(world).ok, false); assert.deepEqual(world.spawn, original);
});

test('explicit v8 approach retains actual foot-circle Y during movement', () => {
  const world = arrivalFixture(), value = proposal(world), original = getWalkHeight(world, -280, 406, 80.4);
  const explicit = world as WorldDefinition & { layoutVersion: string }; explicit.layoutVersion = 'current-v8';
  world.referenceCityRecipe = { originalSpawn: { ...world.spawn }, arrival: { recipe: value.recipeVersion, edgeId: value.edgeId, buildingId: value.buildingId, lookTarget: { ...value.lookTarget }, pathToDoor: value.pathToDoor.map(p => ({ ...p })) } };
  const x = -280.07142857142856, z = 405.5, actual = publicStreetRoadCircleHeight(publicStreetRoadFaces(world.edges[0]), x, z)!;
  assert.equal(getWalkHeight(world, x, z, 80.4), actual);
  explicit.layoutVersion = 'current-v6'; assert.equal(getWalkHeight(world, -280, 406, 80.4), original);
});
