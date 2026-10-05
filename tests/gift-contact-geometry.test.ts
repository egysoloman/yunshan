import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { giftContactReason } from '../src/simulation/gift-contact.ts';
import { buildingWorldPosition, blocksFloorPlanMovement, floorPlanSupport, getBuildingBody, getBuildingEntrance, getBuildingFloorPlan, getFloorPlanRoofRegions, getFloorPlanRoofSupport, type RoofRegion } from '../src/architecture-floor-plan.ts';
import { canAccessFloor } from '../src/access.ts';
import { getWalkHeight } from '../src/world.ts';
import type { Building, Role, Vec3, WorldDefinition } from '../src/types.ts';

// Frozen descriptor, not a world factory or a live Simulation. These subjects
// have only geometry/identity fields; no consumer, inventory or needs is made.
const world = JSON.parse(readFileSync(new URL('./fixtures/civic-history/root13-four-day.world.json', import.meta.url), 'utf8')) as WorldDefinition;
const hall = world.buildings.find(building => building.id === 'civic-0-hall')!;
const home = world.buildings.find(building => building.id === 'civic-0-home')!;
const market = world.buildings.find(building => building.id === 'civic-0-market')!;
const actor = (position: Vec3, role: Role = 'traveler', identities: Role[] = []) => ({ position: { ...position }, role, identities });
type Subject = ReturnType<typeof actor>;
type Voxels = readonly { position: Vec3 }[];
const local = (building: Building, x: number, y: number, z: number) => buildingWorldPosition(building, { x, y, z });
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
function supported(building: Building, floor: number, position: Vec3) {
  const support = floorPlanSupport(building, floor, position, .35);
  assert.ok(support, 'each controlled foot point supports the complete .35m body');
  near(support.y, position.y, 'feet match the actual support height');
  return support;
}
function legal(a: Subject, b: Subject, fixtureWorld = world, voxels: Voxels = []) {
  assert.equal(giftContactReason(fixtureWorld, a, b, voxels), null);
  assert.equal(giftContactReason(fixtureWorld, b, a, voxels), null, 'contact is valid in both directions');
}
function denied(a: Subject, b: Subject, fixtureWorld = world, voxels: Voxels = []) {
  assert.equal(typeof giftContactReason(fixtureWorld, a, b, voxels), 'string');
  assert.equal(typeof giftContactReason(fixtureWorld, b, a, voxels), 'string', 'both participants must obey the same geometry');
}

test('the frozen native hall permits close contact on its public ground programme plane', () => {
  const a = { ...hall.functionPoints!.find(point => point.floor === 0 && point.purpose === 'work')!.position };
  const b = { ...a, x: a.x + .8 };
  assert.equal(supported(hall, 0, a).kind, 'room'); supported(hall, 0, b);
  assert.equal(canAccessFloor(hall, 0, actor(a)), true);
  assert.equal(blocksFloorPlanMovement(hall, 0, a, b, .35, 1.72), false);
  legal(actor(a), actor(b));
});

test('the original hall storeys 3.8m apart cannot exchange a gift through the slab', () => {
  const a = { ...hall.functionPoints!.find(point => point.floor === 0 && point.purpose === 'work')!.position };
  const b = { ...hall.functionPoints!.find(point => point.floor === 1 && point.purpose === 'work')!.position };
  near(b.y - a.y, 3.8, 'original saved storey separation');
  supported(hall, 0, a); supported(hall, 1, b);
  assert.equal(canAccessFloor(hall, 1, actor(b, 'official')), true);
  denied(actor(a, 'official'), actor(b, 'official'));
});

test('two supported points 1.6m apart cannot exchange through an opaque same-floor hall wall', () => {
  const a = local(hall, 5.5, 0, -10.6), b = local(hall, 5.5, 0, -9);
  near(Math.hypot(a.x - b.x, a.z - b.z), 1.6, 'short same-floor segment');
  assert.equal(supported(hall, 0, a).kind, 'room');
  assert.equal(supported(hall, 0, b).kind, 'courtyard');
  assert.equal(blocksFloorPlanMovement(hall, 0, a, b, .35, 1.72), true);
  denied(actor(a), actor(b));
});

test('a legal open courtyard pair is retained', () => {
  const a = local(hall, 8, 0, 4), b = local(hall, 9, 0, 4);
  assert.equal(supported(hall, 0, a).kind, 'courtyard');
  assert.equal(supported(hall, 0, b).kind, 'courtyard');
  assert.equal(blocksFloorPlanMovement(hall, 0, a, b, .35, 1.72), false);
  legal(actor(a), actor(b));
});

test('the actual hall door permits inside/outside contact, including the full-radius opening edge', () => {
  assert.equal(hall.rotation, 0, 'the frozen doorway axes are used without changing its descriptor');
  const door = getBuildingEntrance(hall), plan = getBuildingFloorPlan(hall, 0)!;
  const opening = plan.walls.find(wall => wall.opening?.use === 'entrance')!.opening!;
  near(door.x, hall.door.x, 'actual saved door x'); near(door.z, hall.door.z, 'actual saved door z');
  const halfWidth = (opening.to - opening.from) / 2;
  assert.ok(halfWidth > .36);
  for (const offset of [0, halfWidth - .36, -halfWidth + .36]) {
    const inside = { x: door.x + offset, y: door.y, z: door.z - .55 };
    const outside = { x: inside.x, y: getWalkHeight(world, inside.x, door.z + .55, door.y), z: door.z + .55 };
    supported(hall, 0, inside);
    assert.equal(floorPlanSupport(hall, 0, outside, .35), null, 'outside is supported by the actual road, not a fake hall slab');
    near(outside.y, inside.y, 'saved approach road meets the original doorway');
    assert.equal(blocksFloorPlanMovement(hall, 0, inside, outside, .35, 1.72), false);
    legal(actor(inside), actor(outside));
  }
});

test('the real ground door shares full-body edge support with the original approach road', () => {
  const door = getBuildingEntrance(hall);
  const inside = { ...door, z: door.z - .1 };
  const outside = { x: door.x, y: getWalkHeight(world, door.x, door.z + .55, door.y), z: door.z + .55 };
  const center = floorPlanSupport(hall, 0, inside, 0);
  assert.equal(center?.kind, 'room');
  near(center!.y, inside.y, 'the door center is on the real ground slab');
  assert.equal(floorPlanSupport(hall, 0, inside, .35), null, 'the foot disk crosses the actual open slab/road edge');
  near(outside.y, inside.y, 'the original approach road supports the exterior feet');
  assert.equal(blocksFloorPlanMovement(hall, 0, inside, outside, .35, 1.72), false);
  legal(actor(inside), actor(outside));
});

function hallTurn() {
  const plan = getBuildingFloorPlan(hall, 0)!;
  const turn = plan.stairLandings.find(landing => landing.id === 'half-turn')!;
  const x = (turn.rect.x0 + turn.rect.x1) / 2, z = (turn.rect.z0 + turn.rect.z1) / 2;
  const a = local(hall, x - .4, turn.top, z), b = local(hall, x + .4, turn.top, z);
  for (const point of [a, b]) {
    const support = supported(hall, 0, point);
    assert.equal(support.kind, 'stairs'); assert.deepEqual(support.link, { fromFloor: 0, toFloor: 1 });
  }
  assert.equal(blocksFloorPlanMovement(hall, 0, a, b, .35, 1.72), false);
  return { a, b };
}

test('actual stair landing contact remains legal for identities allowed on both linked floors', () => {
  const { a, b } = hallTurn(), sender = actor(a, 'traveler', ['official']), recipient = actor(b, 'official');
  for (const subject of [sender, recipient]) for (const floor of [0, 1]) assert.equal(canAccessFloor(hall, floor, subject), true);
  legal(sender, recipient);
});

test('a real stair link cannot bypass either participant\'s original upper-floor permission', () => {
  const { a, b } = hallTurn(), traveler = actor(a), official = actor(b, 'official');
  assert.equal(canAccessFloor(hall, 0, traveler), true);
  assert.equal(canAccessFloor(hall, 1, traveler), false);
  denied(traveler, official);
});

test('a solid voxel anywhere along contact rejects the exchange even when both endpoints are free', () => {
  const a = local(hall, 0, 0, -13), b = local(hall, 2, 0, -13);
  supported(hall, 0, a); supported(hall, 0, b); legal(actor(a), actor(b));
  const voxels = [{ position: { x: (a.x + b.x) / 2, y: a.y + .2, z: a.z } }];
  legal(actor(a), actor(a), world, voxels); legal(actor(b), actor(b), world, voxels);
  denied(actor(a), actor(b), world, voxels);
});

for (const building of [home, market]) {
  test(`unmarked legacy ${building.kind} retains permitted close contact and rejects storey/wall shortcuts`, () => {
    assert.equal(getBuildingBody(building), null);
    const a = { x: building.position.x, y: building.position.y + .6, z: building.position.z };
    const b = { ...a, x: a.x + .8 };
    near(getWalkHeight(world, a.x, a.z, a.y), a.y, 'legacy ground plane');
    legal(actor(a), actor(b));
    const upper = { ...a, y: a.y + building.height / building.floors };
    assert.equal(canAccessFloor(building, 1, actor(upper)), true);
    near(getWalkHeight(world, upper.x, upper.z, upper.y), upper.y, 'legacy upper plane');
    legal(actor(upper), actor({ ...upper, x: upper.x + .8 }));
    denied(actor(a), actor(upper));
    const inside = { x: building.position.x + building.width / 2 - .8, y: a.y, z: building.position.z + 5 };
    const outside = { x: building.position.x + building.width / 2 + .8, y: getWalkHeight(world, building.position.x + building.width / 2 + .8, inside.z, a.y), z: inside.z };
    near(outside.y, inside.y, 'original road beside the legacy wall supplies the exterior feet');
    denied(actor(inside), actor(outside));
  });
}

test('a controlled bodyless core-main unit descriptor keeps the original middle-floor ACL and public top deck', () => {
  // This copy is a geometry/ACL unit fixture, not an actual product core or a
  // claim that a live citizen occupied it. No saved descriptor is mutated.
  const core: Building = { ...structuredClone(home), id: 'core-main', name: 'controlled core geometry unit fixture', kind: 'core', floors: 3, height: 11.4, publicFloors: 1, requiredPermission: 'official', floorPermissions: ['public', 'official', 'official'] };
  const coreWorld: WorldDefinition = { ...world, buildings: [core] };
  assert.equal(getBuildingBody(core), null);
  const ground = { ...core.position, y: core.position.y + .6 }, middle = { ...ground, y: ground.y + 3.8 }, top = { ...ground, y: ground.y + 7.6 };
  legal(actor(ground), actor({ ...ground, x: ground.x + .8 }), coreWorld);
  const allowed = actor(middle, 'traveler', ['official']), neighbor = actor({ ...middle, x: middle.x + .8 }, 'official');
  assert.equal(canAccessFloor(core, 1, allowed), true); legal(allowed, neighbor, coreWorld);
  assert.equal(canAccessFloor(core, 1, actor(middle)), false); denied(actor(middle), neighbor, coreWorld);
  assert.equal(canAccessFloor(core, 2, actor(top)), true); legal(actor(top), actor({ ...top, x: top.x + .8 }), coreWorld);
  denied(actor(ground, 'official'), allowed, coreWorld);
  const inside = { x: core.position.x + core.width / 2 - .8, y: ground.y, z: core.position.z + 5 };
  const outside = { x: core.position.x + core.width / 2 + .8, y: getWalkHeight(coreWorld, core.position.x + core.width / 2 + .8, inside.z, ground.y), z: inside.z };
  near(outside.y, inside.y, 'unit fixture retains the original approach road'); denied(actor(inside), actor(outside), coreWorld);
});

test('non-finite contact coordinates and voxel coordinates fail closed', () => {
  const a = actor(local(hall, 0, 0, -13)), b = actor(local(hall, .8, 0, -13));
  for (const component of ['x', 'y', 'z'] as const) for (const value of [NaN, Infinity, -Infinity]) {
    const bad = actor({ ...a.position, [component]: value });
    denied(bad, b);
    assert.equal(typeof giftContactReason(world, a, b, [{ position: { ...a.position, [component]: value } }]), 'string');
  }
});

for (const building of [home, market]) {
  test(`the original bodyless ${building.kind} ground door retains exact and near-edge feet in both roles`, () => {
    assert.equal(getBuildingBody(building), null);
    const peer = { x: building.door.x, y: getWalkHeight(world, building.door.x, building.door.z - .8, building.door.y), z: building.door.z - .8 };
    near(peer.y, building.position.y + .6, 'the original interior walking plane');
    for (const offset of [-.3, -.1, 0, .1, .3]) {
      const point = { x: building.door.x, y: getWalkHeight(world, building.door.x, building.door.z + offset, building.door.y), z: building.door.z + offset };
      near(point.y, building.position.y + .6, 'the actual saved slab/approach-road union');
      assert.equal(canAccessFloor(building, 0, actor(point)), true);
      legal(actor(point), actor(peer));
    }
  });
}

test('the original archived core descriptor keeps its ground door, private floor ACL and public top deck', () => {
  // Read the existing archived world for its unchanged core/terrain/roads. This
  // is an archive-geometry contract, not a current native gift reproduction.
  const archive = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/world-layout/current-v3-20261001.json.gz', import.meta.url))).toString('utf8')) as { layout: string; world: WorldDefinition };
  assert.equal(archive.layout, 'current-v3');
  const core = archive.world.buildings.find(building => building.id === 'core-main')!;
  assert.equal(core.kind, 'core'); assert.equal(getBuildingBody(core), null);
  const archivedCoreWorld: WorldDefinition = { ...archive.world, buildings: [core] };
  const peer = { x: core.door.x, y: getWalkHeight(archivedCoreWorld, core.door.x, core.door.z - .8, core.door.y), z: core.door.z - .8 };
  for (const offset of [-.3, -.1, 0, .1, .3]) {
    const point = { x: core.door.x, y: getWalkHeight(archivedCoreWorld, core.door.x, core.door.z + offset, core.door.y), z: core.door.z + offset };
    near(point.y, core.position.y + .6, 'the original archive core slab and approach road');
    near(peer.y, point.y, 'both archived door participants have actual feet');
    assert.equal(canAccessFloor(core, 0, actor(point)), true);
    legal(actor(point), actor(peer), archivedCoreWorld);
  }
  const at = (floor: number) => ({ x: core.position.x, y: core.position.y + .6 + floor * core.height / core.floors, z: core.position.z });
  const middle = at(3), privatePeer = { ...middle, x: middle.x + .8 };
  assert.equal(core.floorPermissions![3], 'official');
  assert.equal(canAccessFloor(core, 3, actor(middle)), false);
  assert.equal(canAccessFloor(core, 3, actor(middle, 'official')), true);
  legal(actor(middle, 'official'), actor(privatePeer, 'official'), archivedCoreWorld);
  denied(actor(middle), actor(privatePeer, 'official'), archivedCoreWorld);
  const deck = at(core.floors - 1);
  assert.equal(canAccessFloor(core, core.floors - 1, actor(deck)), true);
  legal(actor(deck), actor({ ...deck, x: deck.x + .8 }), archivedCoreWorld);
});

function hallGable() {
  const body = getBuildingBody(hall)!;
  const roof = getFloorPlanRoofRegions(body).find(region => {
    const crossSpan = region.gableAxis === 'x' ? region.rect.x1 - region.rect.x0 : region.rect.z1 - region.rect.z0;
    const alongSpan = region.gableAxis === 'x' ? region.rect.z1 - region.rect.z0 : region.rect.x1 - region.rect.x0;
    return region.kind === 'gable' && region.floor === hall.floors - 1 && crossSpan >= 2.4 && alongSpan >= 2.4;
  });
  assert.ok(roof, 'the unchanged original hall has a real top-storey gable patch');
  const crossMin = roof.gableAxis === 'x' ? roof.rect.x0 : roof.rect.z0;
  const crossMax = roof.gableAxis === 'x' ? roof.rect.x1 : roof.rect.z1;
  const alongMin = roof.gableAxis === 'x' ? roof.rect.z0 : roof.rect.x0;
  const alongMax = roof.gableAxis === 'x' ? roof.rect.z1 : roof.rect.x1;
  return { roof, crossMin, crossMax, alongMin, alongMax };
}

function roofFoot(roof: RoofRegion, cross: number, along: number) {
  const x = roof.gableAxis === 'x' ? cross : along, z = roof.gableAxis === 'x' ? along : cross;
  assert.ok(x - roof.rect.x0 > .35 && roof.rect.x1 - x > .35 && z - roof.rect.z0 > .35 && roof.rect.z1 - z > .35, 'the complete foot disk lies within the actual roof patch');
  const reference = local(hall, x, roof.top, z), support = getFloorPlanRoofSupport(hall, reference, .35);
  assert.ok(support); assert.equal(support.kind, 'roof'); assert.equal(support.floor, roof.floor);
  const point = { ...reference, y: support.y }, rechecked = getFloorPlanRoofSupport(hall, point, .35);
  assert.ok(rechecked); near(rechecked.y, point.y, 'complete-radius roof feet');
  assert.equal(canAccessFloor(hall, roof.floor, actor(point, 'official')), true);
  return point;
}

test('supported close contact parallel to one side of the original hall gable remains legal', () => {
  const { roof, crossMin, crossMax, alongMin, alongMax } = hallGable();
  const cross = crossMin + (crossMax - crossMin) / 4, along = (alongMin + alongMax) / 2;
  const a = roofFoot(roof, cross, along - .4), b = roofFoot(roof, cross, along + .4);
  near(a.y, b.y, 'parallel same-side feet follow the original roof height');
  assert.equal(blocksFloorPlanMovement(hall, roof.floor, a, b, .35, 1.72), false);
  legal(actor(a, 'official'), actor(b, 'official'));
});

test('two fully supported roof endpoints cannot pass food through the original raised gable ridge', () => {
  const { roof, crossMin, crossMax, alongMin, alongMax } = hallGable();
  const cross = (crossMin + crossMax) / 2, along = (alongMin + alongMax) / 2;
  const a = roofFoot(roof, cross - .7, along), b = roofFoot(roof, cross + .7, along);
  near(a.y, b.y, 'symmetric full-radius endpoints have equal actual roof heights');
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 2, 'the pair is within the gift distance');
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const ridge = getFloorPlanRoofSupport(hall, midpoint, .35);
  assert.ok(ridge && ridge.y > midpoint.y + .01, 'the straight feet line crosses below the real ridge, not above it');
  assert.equal(blocksFloorPlanMovement(hall, roof.floor, a, b, .35, 1.72), true);
  denied(actor(a, 'official'), actor(b, 'official'));
});

test('overlapping original hall shapes cannot hide a private floor ACL by descriptor order', () => {
  // Controlled geometry unit overlap only: translate one original descriptor,
  // retaining every wall and both original permission arrays. No live citizen.
  const privateHall: Building = { ...structuredClone(hall), id: 'controlled-original-private-hall' };
  const shift = hall.height / hall.floors;
  const publicHall: Building = { ...structuredClone(hall), id: 'controlled-translated-ground-hall', position: { ...hall.position, y: hall.position.y + shift }, door: { ...hall.door, y: hall.door.y + shift }, functionPoints: hall.functionPoints!.map(point => ({ ...point, position: { ...point.position, y: point.position.y + shift } })) };
  assert.deepEqual(privateHall.floorPermissions, hall.floorPermissions);
  assert.deepEqual(publicHall.floorPermissions, hall.floorPermissions);
  const a = local(privateHall, 0, shift, -13), b = local(privateHall, .8, shift, -13);
  for (const point of [a, b]) { supported(privateHall, 1, point); supported(publicHall, 0, point); }
  assert.equal(canAccessFloor(publicHall, 0, actor(a)), true);
  assert.equal(canAccessFloor(privateHall, 1, actor(a)), false);
  assert.equal(blocksFloorPlanMovement(privateHall, 1, a, b, .35, 1.72), false);
  assert.equal(blocksFloorPlanMovement(publicHall, 0, a, b, .35, 1.72), false);
  for (const buildings of [[publicHall, privateHall], [privateHall, publicHall]]) {
    const overlapWorld: WorldDefinition = { ...world, buildings };
    legal(actor(a, 'official'), actor(b, 'official'), overlapWorld);
    denied(actor(a), actor(b), overlapWorld);
  }
});

test('an original hall roof edge cannot turn center-only height support into a full standing disk', () => {
  // Pure descriptor boundary case only, not an observed native NPC position.
  const regions = getFloorPlanRoofRegions(getBuildingBody(hall)!);
  const roof = regions.find(region => region.kind === 'gable' && region.floor === hall.floors - 1 && Math.abs(region.rect.x0 + hall.width / 2) < 1e-7 && region.rect.x1 - region.rect.x0 > 1.4 && region.rect.z1 - region.rect.z0 > 1);
  assert.ok(roof, 'the original top-storey gable reaches the real exterior west edge');
  assert.ok(regions.every(region => region.rect.x0 >= roof.rect.x0 - 1e-7), 'no actual roof patch supplies the missing exterior portion');
  const z = (roof.rect.z0 + roof.rect.z1) / 2;
  const reference = local(hall, roof.rect.x0 + .1, roof.top, z);
  const support = getFloorPlanRoofSupport(hall, reference, .35);
  assert.ok(support, 'the old roof-height API still reports an intersecting disk height');
  const edge = { ...reference, y: support.y };
  near(getFloorPlanRoofSupport(hall, edge, .35)!.y, edge.y, 'reported height matches the controlled edge feet');
  assert.ok(roof.rect.x0 + .1 - .35 < roof.rect.x0, 'the complete .35m disk overhangs the real roof union');
  assert.equal(getFloorPlanRoofSupport(hall, local(hall, roof.rect.x0 - .1, roof.top, z), 0), null, 'the overhanging exterior center has no original roof patch');
  const peerReference = local(hall, roof.rect.x0 + 1, roof.top, z);
  const peerSupport = getFloorPlanRoofSupport(hall, peerReference, .35); assert.ok(peerSupport);
  const peer = { ...peerReference, y: peerSupport.y };
  assert.ok(Math.hypot(edge.x - peer.x, edge.y - peer.y, edge.z - peer.z) < 2);
  legal(actor(peer, 'official'), actor(peer, 'official'));
  denied(actor(edge, 'official'), actor(peer, 'official'));
});

test('a real bottom-anchored .2m voxel above the body head leaves native hall contact clear', () => {
  const a = local(hall, 0, 0, -13), b = local(hall, .8, 0, -13);
  supported(hall, 0, a); supported(hall, 0, b); legal(actor(a), actor(b));
  // main.ts renders the .2m cube at p.y + .1; Controller treats its solid as
  // [p.y, p.y + .2]. This supplied geometry boundary is not a build command.
  const head = a.y + 1.72, block = { position: { x: a.x, y: head + .05, z: a.z } };
  near(block.position.y - head, .05, 'actual cube bottom clears the full body head');
  assert.ok(block.position.y > head && block.position.y + .2 > head);
  legal(actor(a), actor(a), world, [block]);
  legal(actor(a), actor(b), world, [block]);
});

test('a real voxel top above the feet blocks native hall contact despite the former centered-box gap', () => {
  const a = local(hall, 0, 0, -13), b = local(hall, .8, 0, -13);
  supported(hall, 0, a); supported(hall, 0, b); legal(actor(a), actor(b));
  const block = { position: { x: a.x, y: a.y - .15, z: a.z } };
  const actualTop = block.position.y + .2;
  near(actualTop - a.y, .05, 'authoritative bottom-anchored cube enters above the feet');
  assert.ok(block.position.y < a.y && actualTop > a.y + .01);
  assert.ok(block.position.y + .1 < a.y, 'the former helper-centered top would miss this real solid');
  denied(actor(a), actor(a), world, [block]);
  denied(actor(a), actor(b), world, [block]);
});
