import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../../src/controller.ts';
import { HeadlessWalker } from './headless-walker.ts';
import { canAccessFloor, getStairPosition } from '../../src/access.ts';
import {
  buildingLocalPosition, buildingWorldPosition, containsUnion, findFloorPlanRoute,
  floorPlanSupport, getBuildingBody, getBuildingEntrance, getBuildingFloorPlan,
  getBuildingUsePoints, getFloorPlanStairRoute,
} from '../../src/architecture-floor-plan.ts';
import { closeRoadFromDisaster, isRoadOpen, roadExitPermit, roadExitRoute } from '../../src/roads.ts';
import { getWalkHeight } from '../../src/world.ts';
import type { Building, NetworkEdge, SimState, Vec3, VoxelModification, WorldDefinition } from '../../src/types.ts';

/** Prepared statically. Execution requires an explicit root GO. No Simulation,
 * renderer, browser, GPU, tile writer or candidate movement algorithm is used.
 * The unchanged controller is the numeric oracle, through its public DOM input. */
const ORIGINAL_CONTROLLER_SHA = '7889f416e9cd8ff2fb81c76eb121d2cf286a76c0a16e2ad8cf1bd2fcd1c907ab';
const point = (x: number, z = 0, y = 0): Vec3 => ({ x, y, z });
const close = (a: number, b: number, label: string) => assert(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
const insideId = (body: { inside: Building | null }) => body.inside?.id ?? null;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function stateAt(position: Vec3, voxels: VoxelModification[] = [], role: SimState['player']['role'] = 'traveler'): SimState {
  return {
    version: 1, seed: 1, day: 0, hour: 8, tick: 0, paused: false, speed: 1,
    weather: 'clear', visibility: 1, energy: 100, treasury: 1000, taxRate: .08,
    policeBudget: 20, support: 50, bankBalance: 0, loan: 0, gdp: 0,
    lastSystemOrder: [], districts: [], citizens: [], vehicles: [], shops: [],
    relationships: [], crimes: [], events: [], voxels,
    player: { position: { ...position }, vehicleId: null, inventory: { food: 2 },
      money: 100, role, identities: [role], reputation: 0, homeId: null,
      education: 0, experience: 0, partnerId: null,
      needs: { hunger: 100, fatigue: 100, social: 100, fun: 100 } },
    metrics: { trades: 0, commutes: 0, crimesResolved: 0, freight: 0, flights: 0 },
  };
}
function worldAt(spawn: Vec3, buildings: Building[] = [], edges: NetworkEdge[] = []): WorldDefinition {
  return { seed: 911, voxelSize: .2, size: 4000, districts: [], buildings, nodes: [], edges,
    mountains: [], spawn: { ...spawn },
    waterfall: { top: point(1800, 1800, 100), bottom: point(1800, 1800), width: 10 },
    river: [point(1800, 1800), point(1800, 1900)] };
}
function flatWorld(spawn = point(0)): WorldDefinition {
  return worldAt(spawn, [], [{ id: 'flat-z', from: 'a', to: 'b', mode: 'road', length: 200,
    capacity: 20, points: [point(spawn.x, spawn.z - 100, spawn.y), point(spawn.x, spawn.z + 100, spawn.y)] },
  { id: 'flat-x', from: 'c', to: 'd', mode: 'road', length: 200, capacity: 20,
    points: [point(spawn.x - 100, spawn.z, spawn.y), point(spawn.x + 100, spawn.z, spawn.y)] }]);
}
function profiled(kind: Building['kind'] = 'market', storey = 3.4, rotation = 0): Building {
  const b: Building = { id: `actual-${kind}`, districtId: 'town', name: kind, kind,
    position: point(0), width: 40, depth: 32, height: storey * 3, floors: 3,
    rotation, door: point(0, 16, .6), capacity: 50, seed: 7, floorPlanProfile: 'v4-program-bodies-02' };
  b.door = getBuildingEntrance(b);
  b.functionPoints = Array.from({ length: b.floors }, (_, floor) => getBuildingUsePoints(b, floor)).flat();
  return b;
}
function siteWorld(b: Building, spawn = buildingWorldPosition(b, point(0, b.depth / 2 + 4))): WorldDefinition {
  return worldAt(spawn, [b], [{ id: 'door-road', from: 'door', to: 'street', mode: 'road',
    length: 4, capacity: 20, points: [b.door, buildingWorldPosition(b, point(0, b.depth / 2 + 4))] }]);
}
function key(keys: EventTarget, code: string, down = true): void {
  const event = new Event(down ? 'keydown' : 'keyup');
  Object.assign(event, { code, repeat: false }); keys.dispatchEvent(event);
}
type Pair = { original: PlayerController; walker: HeadlessWalker; state: SimState;
  move: (x: number, z: number, sprint: boolean, seconds: number) => void;
  match: (label: string) => void;
  door: (b: Building) => boolean; stairs: () => boolean };
function pair(world: WorldDefinition, state: SimState, run: (p: Pair) => void): void {
  freeze(world); freeze(state);
  const before = JSON.stringify({ world, state });
  const keys = Object.assign(new EventTarget(), { closest: () => null });
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null });
  const previous = ['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  Object.defineProperty(globalThis, 'window', { value: keys, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  const original = new PlayerController(new PerspectiveCamera(), new EventTarget() as HTMLCanvasElement,
    world, () => {}, (b, floor) => canAccessFloor(b, floor, state.player), () => state.voxels, () => state);
  original.setMode('walk', state.player.position);
  const walker = new HeadlessWalker(world, () => state);
  const match = (label: string) => {
    for (const axis of ['x', 'y', 'z'] as const) close(walker.position[axis], original.position[axis], `${label}.${axis}`);
    assert.equal(insideId(walker), insideId(original), `${label}.inside`);
    assert.equal(walker.floor, original.floor, `${label}.floor`);
    assert.equal(walker.blockedAccess, original.blockedAccess, `${label}.blockedAccess`);
  };
  const clearReason = () => { original.blockedAccess = null; walker.consumeBlockedAccess(); };
  const p: Pair = { original, walker, state, match,
    move(x, z, sprint, seconds) {
      // Input translation only: W plus heading encodes one unit world direction.
      // Both motors still perform their own normal x-then-z collision decisions.
      assert(x === 0 && z === 0 || Math.hypot(x, z) >= 1 - 1e-10, 'numeric oracle inputs use a unit direction or diagonal keys');
      if (x || z) { original.yaw = Math.atan2(-x, -z); key(keys, 'KeyW'); }
      if (sprint) key(keys, 'ShiftLeft');
      try { original.step(seconds, false); walker.move(x, z, sprint, seconds); match('move'); }
      finally { key(keys, 'KeyW', false); key(keys, 'ShiftLeft', false); }
    },
    door(b) { clearReason(); const result = original.useDoor(b); assert.equal(walker.useDoor(b), result); match('door'); return result; },
    stairs() { clearReason(); const result = original.useStairs(); assert.equal(walker.useStairs(), result); match('stairs'); return result; },
  };
  try { match('initial trusted core pose'); run(p); }
  finally {
    original.dispose();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
    assert.equal(JSON.stringify({ world, state }), before, 'both movement consumers leave authoritative world/state bytes unchanged');
  }
}
/** Waypoints come from shared canonical geometry. Movement remains public W;
 * there are no intermediate pose/y/floor assignments or state position writes. */
function route(p: Pair, points: readonly Vec3[]): void {
  for (const target of points.slice(1)) {
    let count = 0;
    while (Math.hypot(p.original.position.x - target.x, p.original.position.z - target.z) > .025) {
      const before = p.original.position, dx = target.x - before.x, dz = target.z - before.z, length = Math.hypot(dx, dz);
      p.move(dx / length, dz / length, false, Math.min(.015, length / 4.8));
      const moved = Math.hypot(p.original.position.x - before.x, p.original.position.z - before.z);
      assert(moved > .00001, `unchanged oracle must physically progress: ${JSON.stringify({ before, target })}`);
      assert(moved <= .072 + 1e-7, 'unchanged default speed');
      assert(++count < 2000, 'finite route progress');
    }
  }
}

test('frozen controller oracle; world-axis 4.8/10m/s, normalized diagonal and copied position', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../src/controller.ts', import.meta.url))).digest('hex'), ORIGINAL_CONTROLLER_SHA);
  const world = flatWorld();
  pair(world, stateAt(world.spawn), p => {
    close(getWalkHeight(world, 0, 0, 0), 0, 'controlled spawn has authoritative ground support');
    p.move(0, -1, false, .1); close(p.walker.position.z, -.48, 'walk speed');
    p.move(1, 0, true, .1); close(p.walker.position.x, 1, 'sprint speed');
    const before = p.walker.position; p.move(1, 1, false, .1);
    close(p.walker.position.x - before.x, .48 / Math.sqrt(2), 'normalized diagonal x');
    close(p.walker.position.z - before.z, .48 / Math.sqrt(2), 'normalized diagonal z');
    const copied = p.walker.position; copied.x += 100; copied.y += 100; copied.z += 100;
    p.match('mutating a returned copy cannot move the body');
    p.move(0, 0, false, .1);
  });
});

test('rotated canonical entrance reaches market service space and the physical counter stops a body', () => {
  const b = profiled('market', 3.4, Math.PI / 2), world = siteWorld(b);
  pair(world, stateAt(world.spawn), p => {
    const sale = b.functionPoints!.find(point => point.purpose === 'sale')!;
    const path = findFloorPlanRoute(b, 0, p.original.position, sale.position); assert(path);
    route(p, path); assert.equal(insideId(p.walker), b.id); close(p.walker.position.y, .6, 'real indoor floor');
    const localSale = buildingLocalPosition(b, sale.position);
    const counter = getBuildingFloorPlan(b, 0)!.fixtures.find(f => f.kind === 'counter' && Math.abs((f.rect.x0 + f.rect.x1) / 2 - localSale.x) < .1); assert(counter);
    const direction = { x: -Math.sin(b.rotation), z: -Math.cos(b.rotation) };
    for (let i = 0; i < 25; i++) p.move(direction.x, direction.z, false, .015);
    const actual = buildingLocalPosition(b, p.walker.position);
    assert(actual.z >= counter.rect.z1 + .35 - 1e-7, 'the complete .35m body stops outside the solid counter');
    assert(actual.z < localSale.z, 'control includes actual forward movement');
  });
});

test('outdoor courtyard admits adjacent terrain while a real elevated deck remains a cliff', () => {
  const open = profiled(), start = point(18, 17), world = siteWorld(open, start);
  pair(world, stateAt(start), p => {
    for (let i = 0; i < 40; i++) p.move(0, -1, false, .015);
    assert(p.walker.position.z < 15); close(p.walker.position.y, .6, 'courtyard stone support');
    assert.equal(p.walker.inside, null);
    for (let i = 0; i < 40; i++) p.move(0, 1, false, .015);
    assert(p.walker.position.z > 16.9); close(p.walker.position.y, 0, 'actual exterior terrain');
  });
  const cliff = profiled(), edgeStart = point(18, 15.2, .6), high = siteWorld(cliff, edgeStart);
  high.edges.push({ id: 'elevated-deck', from: 'a', to: 'b', mode: 'bridge', length: 4, capacity: 20,
    points: [point(18, 16.01, 3.4), point(18, 20, 3.4)] });
  close(getWalkHeight(high, 18, 16.5, .6), 3.4, 'negative control has a real elevated deck');
  pair(high, stateAt(edgeStart), p => {
    for (let i = 0; i < 40; i++) p.move(0, 1, false, .015);
    assert(p.walker.position.z <= 16 - .35 + 1e-7, 'full support disk cannot join a deck 2.8m higher');
    close(p.walker.position.y, .6, 'cliff does not raise the body'); assert.equal(p.walker.inside, null);
  });
});

test('both real stair flights preserve 0→1→2→1→0 and upper .35m support never invents a shaft floor', () => {
  const b = profiled(), first = getFloorPlanStairRoute(b, 0, 1)!, upper = getFloorPlanStairRoute(b, 1, 2)!;
  assert(first.length > 20); assert(getBuildingFloorPlan(b, 1)!.stairHole);
  pair(siteWorld(b, first[0]), stateAt(first[0]), p => {
    route(p, first); assert.equal(p.walker.floor, 1); close(p.walker.position.y, 4, 'first storey');
    route(p, upper); assert.equal(p.walker.floor, 2); close(p.walker.position.y, 7.4, 'second storey');
    route(p, [...upper].reverse()); assert.equal(p.walker.floor, 1);
    route(p, [...first].reverse()); assert.equal(p.walker.floor, 0); close(p.walker.position.y, .6, 'returned ground');
  });
  const plan = getBuildingFloorPlan(b, 2)!, hole = plan.stairHole!;
  const start = buildingWorldPosition(b, point(plan.stair.x - 1, plan.stair.z + .1, plan.y));
  const empty = buildingWorldPosition(b, point(plan.stair.x - 1, plan.stair.z + 2, plan.y));
  assert(containsUnion([hole], plan.stair.x - 1, plan.stair.z + 2)); assert.equal(floorPlanSupport(b, 2, empty), null);
  pair(siteWorld(b, start), stateAt(start), p => {
    for (let i = 0; i < 35; i++) p.move(0, 1, false, .015);
    assert(buildingLocalPosition(b, p.walker.position).z <= hole.z0 - .35 + 1e-7);
    assert.equal(p.walker.floor, 2); close(p.walker.position.y, start.y, 'shaft guard keeps original supported feet');
  });
  const home: Building = { id: 'market-b24', districtId: 'market', name: '千灯市集·钱庄街·里居7', kind: 'home',
    position: point(-390.8, 316.20000000000005, 76), width: 40, depth: 34.4, height: 10.200000000000001,
    floors: 3, rotation: 0, door: point(-390.8, 333.40000000000003, 76.60000000000001), capacity: 129,
    seed: 668619109, floorPlanProfile: 'v4-program-bodies-02' };
  const failedBrowserPose = point(-404.59997341778063, 308.791474723644, 80);
  pair(siteWorld(home, failedBrowserPose), stateAt(failedBrowserPose), p => {
    assert.equal(p.walker.floor, 1); p.move(0, 1, false, .015);
    close(p.walker.position.z, failedBrowserPose.z + .072, 'real first upper tread movement');
    close(p.walker.position.y, failedBrowserPose.y + .2, 'real .2m tread support');
    assert.equal(p.walker.floor, 1); assert.equal(insideId(p.walker), home.id);
    const support = floorPlanSupport(home, 1, p.walker.position, .35); assert(support);
    close(support.y, p.walker.position.y, 'actual complete body disk support');
  });
});

test('shared ACL rejects a locked door and a physical rise before selecting any unauthorized stair landing', () => {
  const door = profiled(); door.publicFloors = 0; door.requiredPermission = 'mayor';
  const outside = buildingWorldPosition(door, point(0, 18, .6));
  pair(siteWorld(door, outside), stateAt(outside), p => {
    const before = p.walker.position; assert.equal(p.door(door), false); assert.deepEqual(p.walker.position, before);
    assert(p.walker.blockedAccess?.includes('权限'));
  });
  const b = profiled(); b.publicFloors = 1; b.requiredPermission = 'mayor';
  const stairs = getFloorPlanStairRoute(b, 0, 1)!;
  pair(siteWorld(b, stairs[0]), stateAt(stairs[0]), p => {
    const initialDx = stairs[1].x - p.original.position.x, initialDz = stairs[1].z - p.original.position.z;
    const initialLength = Math.hypot(initialDx, initialDz);
    for (let i = 0; i < 15; i++) p.move(initialDx / initialLength, initialDz / initialLength, false, .015);
    const firstRise = stairs.find(v => v.y > .6)!;
    const dx = firstRise.x - p.original.position.x, dz = firstRise.z - p.original.position.z, length = Math.hypot(dx, dz);
    for (let i = 0; i < 30; i++) p.move(dx / length, dz / length, false, .015);
    close(p.walker.position.y, .6, 'unauthorized target cannot raise feet'); assert.equal(p.walker.floor, 0);
    assert(p.walker.blockedAccess?.includes('权限')); assert.equal(p.stairs(), false);
  });
});

test('legacy restored levels retain narrowed walls and E preserves arbitrary legal shaft x/z', () => {
  const b: Building = { id: 'core-main', districtId: 'civic', name: '天枢阁', kind: 'core',
    position: point(0, 0, 254), width: 144, depth: 112, height: 234, floors: 30, basements: 2,
    publicFloors: 3, requiredPermission: 'mayor', rotation: 0, door: point(0, 56, 254.6), capacity: 1000, seed: 1,
    floorFootprints: Array.from({ length: 30 }, (_, floor) => ({ width: 144 - Math.floor(floor / 6) * 18, depth: 112 - Math.floor(floor / 6) * 14 })) };
  const upper = point(35.5, 0, getStairPosition(b, 29).y);
  pair(worldAt(upper, [b]), stateAt(upper, [], 'mayor'), p => {
    for (let i = 0; i < 10; i++) p.move(1, 0, false, .1);
    assert(p.walker.position.x < 36 - .35); assert.equal(p.walker.floor, 29); assert.equal(insideId(p.walker), b.id);
  });
  const shaft = getStairPosition(b, -1), arbitrary = { ...shaft, x: shaft.x + 1.2, z: shaft.z - 1.1 };
  pair(worldAt(arbitrary, [b]), stateAt(arbitrary, [], 'mayor'), p => {
    assert.equal(p.walker.floor, -1); assert(p.stairs()); assert.equal(p.walker.floor, 0);
    close(p.walker.position.x, arbitrary.x, 'legacy shaft x'); close(p.walker.position.z, arbitrary.z, 'legacy shaft z');
  });
});

test('.2m voxels support one small step and retain tall-stack and head-height collision guards', () => {
  const b: Building = { id: 'legacy-room', districtId: 'town', name: 'room', kind: 'home', position: point(0),
    width: 40, depth: 32, height: 12, floors: 3, rotation: 0, door: point(0, 16, .6), capacity: 50, seed: 7 };
  const start = point(0, 0, .6), step = { id: 'step', color: '#fff', position: point(.8, 0, .6) };
  pair(worldAt(start, [b]), stateAt(start, [step]), p => {
    p.move(1, 0, false, .1); assert(p.walker.position.x > .4); close(p.walker.position.y, .8, 'real voxel top');
  });
  for (const height of [1.2, 2.2]) {
    const block = { id: 'solid', color: '#fff', position: point(.8, 0, height) };
    pair(worldAt(start, [b]), stateAt(start, [block]), p => {
      p.move(1, 0, false, .1); close(p.walker.position.x, 0, 'solid body/head voxel blocks movement');
    });
  }
});

test('transport side rails stop lateral bodies; open ends and actual same-grade joins remain usable', () => {
  const bridge: NetworkEdge = { id: 'bridge', from: 'a', to: 'b', mode: 'bridge', length: 80,
    capacity: 20, points: [point(300, -40, 254.6), point(300, 40, 254.6)] };
  const start = point(303.4, 15, 254.6);
  pair(worldAt(start, [], [bridge]), stateAt(start), p => {
    p.move(1, 0, false, .1); close(p.walker.position.x, start.x, 'real side rail');
    p.move(0, -1, false, .1); close(p.walker.position.z, start.z - .48, 'longitudinal deck');
  });
  const end = point(303.4, 38, 254.6);
  pair(worldAt(end, [], [bridge]), stateAt(end), p => { p.move(1, 0, false, .1); assert(p.walker.position.x > 303.8); });
  const join = point(293.8, 0, 254.6), road: NetworkEdge = { id: 'joining-street', from: 'c', to: 'd', mode: 'road',
    length: 80, capacity: 20, points: [point(260, 0, 254.6), point(340, 0, 254.6)] };
  pair(worldAt(join, [], [bridge, road]), stateAt(join), p => {
    for (let i = 0; i < 40; i++) p.move(1, 0, false, .1);
    assert(p.walker.position.x > 312); close(p.walker.position.y, 254.6, 'same-grade street crosses both real bridge-side openings');
  });
});

function crossing(spawn: Vec3): WorldDefinition {
  const world = worldAt(spawn, [], [{ id: 'town-bridge', from: 'A', to: 'B', mode: 'bridge', length: 100,
    capacity: 20, points: [point(0, 0, .6), point(50, 0, .6), point(100, 0, .6)] }]);
  world.districts = [{ id: 'town', name: '镇口', kind: 'market', center: point(50, 0, .6), radius: 100, color: '#fff', population: 0 }];
  world.nodes = [{ id: 'A', name: 'A', districtId: 'town', position: point(0, 0, .6), station: true },
    { id: 'B', name: 'B', districtId: 'town', position: point(100, 0, .6), station: true }];
  world.river = [point(50, -400), point(50, 400)]; return world;
}
function closedState(world: WorldDefinition): SimState {
  const state = stateAt(world.spawn), event = { type: 'environment-disaster' as const,
    eventId: 1, districtId: 'town', severity: 20, occurredAt: 480 }, canonical = new WeakSet<object>([event]);
  assert(closeRoadFromDisaster({ worldDefinition: world, state, emitEvent: () => {} }, event,
    { isCanonicalDisaster: input => canonical.has(input) }));
  assert.equal(isRoadOpen(state, 'town-bridge'), false); return state;
}

test('canonical closed-road admission stops new entrants and captured occupancy permits only forward exit', () => {
  for (const useFloorPlan of [false, true]) {
    const world = crossing(point(0, 0, .6));
    if (useFloorPlan) world.buildings = [{ id: 'gallery-site', name: '街旁楼', kind: 'station', districtId: 'town',
      position: point(0, 14), width: 32, depth: 24, height: 8, floors: 2, rotation: 0,
      door: point(0, 26, .6), capacity: 20, seed: 1, floorPlanProfile: 'v4-program-bodies-02' }];
    const open = stateAt(world.spawn);
    pair(world, open, p => { p.move(1, 0, false, .1); assert(p.walker.position.x > .4, 'actual branch has an open-road control'); });
    const closed = closedState(world); assert.equal(roadExitPermit(closed, 'player'), null);
    pair(world, closed, p => {
      for (let i = 0; i < 4; i++) p.move(1, 0, false, .1);
      assert(p.walker.position.x <= .35 + 1e-7); assert(p.walker.blockedAccess?.includes('道路已关闭'));
      assert.equal(p.walker.consumeBlockedAccess(), p.original.blockedAccess);
      p.original.blockedAccess = null; p.match('diagnostic consumed');
    });
  }
  const occupied = crossing(point(50, 0, .6)), state = closedState(occupied);
  const exit = roadExitRoute(occupied, state, 'player', state.player.position); assert(exit); assert(roadExitPermit(state, 'player'));
  const endpoint = occupied.nodes.find(node => node.id === exit.exitNodeId)!;
  const direction = Math.sign(endpoint.position.x - state.player.position.x);
  pair(occupied, state, p => {
    p.move(direction, 0, false, .1); const advanced = p.walker.position;
    assert(Math.abs(advanced.x - endpoint.position.x) < 50, 'captured actor physically advances toward its recorded exit');
    p.move(-direction, 0, false, .1); assert.deepEqual(p.walker.position, advanced, 'captured permit rejects reversal');
    assert(p.walker.blockedAccess?.includes('道路已关闭'));
  });
});

test('declared admission additions reject noncanonical doors, invalid motor inputs and non-ground actors', () => {
  // These checks are adapter admission contracts, not claims of oracle equivalence.
  const b = profiled(), start = buildingWorldPosition(b, point(0, 18, .6)), world = siteWorld(b, start), state = freeze(stateAt(start));
  freeze(world); const before = JSON.stringify({ world, state }), walker = new HeadlessWalker(world, () => state);
  const feet = walker.position;
  assert.equal(walker.useDoor({ ...b }), false, 'matching fields cannot substitute for the canonical building object');
  for (const input of [[NaN, 0, .1], [0, Infinity, .1], [2, 0, .1], [1, 0, -.01], [1, 0, .100001]] as const) {
    walker.move(input[0], input[1], false, input[2]); assert.deepEqual(walker.position, feet);
  }
  walker.syncFromCore(); assert.deepEqual(walker.position, state.player.position);
  assert.equal(JSON.stringify({ world, state }), before);
  const shaft = getStairPosition(b, 0);
  for (const kind of ['passenger', 'aircraft', 'dead'] as const) {
    const denied = stateAt(shaft);
    if (kind === 'passenger') denied.player.vehicleId = 'existing-passenger';
    if (kind === 'aircraft') denied.aviation = { activeAircraftId: 'existing-aircraft' } as SimState['aviation'];
    if (kind === 'dead') denied.extension = { actorProfiles: { player: { alive: false } } } as unknown as SimState['extension'];
    freeze(denied); const guard = new HeadlessWalker(world, () => denied), pose = guard.position, bytes = JSON.stringify(denied);
    guard.move(1, 0, false, .1); assert.equal(guard.useDoor(b), false); assert.equal(guard.useStairs(), false);
    assert.deepEqual(guard.position, pose, `${kind} cannot perform ground actions`); assert.equal(JSON.stringify(denied), bytes);
  }
});
