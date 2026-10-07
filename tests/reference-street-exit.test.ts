import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller';
import { wallPanels, getBuildingFloorPlan } from '../src/architecture-floor-plan';
import { referenceStreetExit } from '../src/geometry/reference-street-exit';
import { PUBLIC_STREET_BIRTH_RECIPE_VERSION } from '../src/geometry/public-street-birth';
import { getPublicStreetBirthWalkHeight } from '../src/geometry/public-street-birth-check';
import type { Building, Vec3, WorldDefinition } from '../src/types';

/** Finite literal b26 controller case. Full-city/UI evidence remains a separate
 * gate; a small fixture does not prove construction of all 612 product sites. */
function city(layout: 'current-v6' | 'current-v8' = 'current-v8'): WorldDefinition & { layoutVersion: string } {
  const b: Building = { id: 'market-b26', districtId: 'market', name: '千灯市集·云锦街·商肆7', kind: 'market', position: { x: -282, y: 79.80000000000001, z: 387.6 }, width: 35.2, depth: 26.8, height: 7.2, floors: 2, rotation: 0, door: { x: -282, y: 80.4, z: 401 }, capacity: 58, seed: 123023086, stairGeometryRevision: 2, floorPlanProfile: 'v4-program-bodies-02', roofGeometryRevision: 2 };
  const birth = { x: -279, y: 80.4, z: 408 }, end = { x: -269, y: 80.2, z: 408 };
  return { layoutVersion: layout, seed: 20261001, voxelSize: .2, size: 4400,
    districts: [{ id: 'market', name: '千灯市集', kind: 'market', center: { x: -330, y: 52, z: 460 }, radius: 420, color: '#dcad69', population: 58 }], buildings: [b],
    nodes: [{ id: 'actual-door', districtId: 'market', name: b.name, position: { ...b.door }, station: false }, { id: 'actual-quarter', districtId: 'market', name: 'quarter', position: end, station: false }],
    edges: [{ id: 'actual-road', from: 'actual-door', to: 'actual-quarter', mode: 'road', length: 7 + Math.hypot(13, .2), capacity: 80, points: [{ ...b.door }, { x: -282, y: 80.4, z: 408 }, end] }],
    mountains: [], spawn: birth, waterfall: { top: { x: 1200, y: 200, z: -1000 }, bottom: { x: 1200, y: 10, z: -800 }, width: 40 }, river: [{ x: 1500, y: 2, z: 1400 }, { x: 1600, y: 2, z: 1500 }],
    referenceCityRecipe: { originalSpawn: { x: -330, y: 51.5375, z: 487 }, arrival: { recipe: PUBLIC_STREET_BIRTH_RECIPE_VERSION, buildingId: b.id, edgeId: 'actual-road', lookTarget: { ...b.door }, pathToDoor: [{ ...birth }, { ...b.door }] } },
  };
}
function key(keys: EventTarget, code: string, down = true): void { const e = new Event(down ? 'keydown' : 'keyup'); Object.assign(e, { code, repeat: false }); keys.dispatchEvent(e); }
function motor(world: WorldDefinition, run: (c: PlayerController, keys: EventTarget, useE: () => boolean) => void, permitted = true): void {
  const keys = Object.assign(new EventTarget(), { closest: () => null }), doc = Object.assign(new EventTarget(), { pointerLockElement: null });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { value: keys, configurable: true }); Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  let c!: PlayerController, lastDoorUse = false;
  c = new PlayerController(new PerspectiveCamera(), new EventTarget() as HTMLCanvasElement, world, code => { if (code === 'KeyE') lastDoorUse = c.useDoor(world.buildings[0]); }, () => permitted);
  const useE = () => { lastDoorUse = false; key(keys, 'KeyE'); key(keys, 'KeyE', false); return lastDoorUse; };
  try { run(c, keys, useE); } finally { c.dispose(); if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window'); if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document'); }
}
function approach(c: PlayerController, keys: EventTarget): void {
  const door = c.world.buildings[0].door, before = c.position;
  c.yaw = Math.atan2(-(door.x - before.x), -(door.z - before.z)); key(keys, 'KeyW');
  let maximumY = before.y;
  for (let i = 0; i < 100; i++) { c.step(.015, false); maximumY = Math.max(maximumY, c.position.y); }
  key(keys, 'KeyW', false);
  assert.ok(Math.hypot(c.position.x - before.x, c.position.z - before.z) > 7, 'real W crosses the curb and reaches the actual door before E');
  if ((c.world as WorldDefinition & { layoutVersion?: string }).layoutVersion === 'current-v8')
    assert.ok(maximumY > 80.4 && maximumY <= 80.62 + 1e-9, 'the actual motor must raise feet onto the low curb');
}

test('birth E does not relocate, real W/E enters, and supported exit/W returns on the actual strip', () => {
  const world = city(), beforeWorld = JSON.stringify(world), b = world.buildings[0];
  motor(world, (c, keys, useE) => {
    const born = c.position; assert.equal(useE(), false); assert.deepEqual(c.position, born);
    approach(c, keys); assert.equal(useE(), true); assert.equal(c.inside?.id, b.id); assert.deepEqual(c.position, { x: -282, y: 80.4, z: 399 });
    assert.equal(useE(), true); const exited = c.position, length = Math.sqrt(58);
    assert.ok(Math.abs(exited.x - (-282 + 6 / length)) < 1e-10); assert.ok(Math.abs(exited.z - (401 + 14 / length)) < 1e-10);
    assert.ok(exited.y > 80.4 && exited.y <= 80.62); assert.equal(c.inside, null);
    assert.equal(getPublicStreetBirthWalkHeight(world, exited.x, exited.z), exited.y);
    key(keys, 'KeyW');
    let count = 0;
    while (Math.hypot(c.position.x - born.x, c.position.z - born.z) > .025) {
      const prior = c.position, distance = Math.hypot(prior.x - born.x, prior.z - born.z);
      c.step(Math.min(.015, distance / 4.8), false);
      assert.ok(Math.hypot(c.position.x - prior.x, c.position.z - prior.z) > .00001, 'real outward W must progress');
      assert.ok(Math.hypot(c.position.x - prior.x, c.position.z - prior.z) <= .072 + 1e-7);
      assert.ok(++count < 120, 'finite public strip');
    }
    key(keys, 'KeyW', false); assert.ok(Math.abs(c.position.y - 80.4) < 1e-8);
  });
  assert.equal(JSON.stringify(world), beforeWorld, 'door use does not rewrite the world or birth');
});

test('missing real exit support rejects E without moving the current room body', () => {
  const world = city(); motor(world, (c, keys, useE) => {
    approach(c, keys); assert.equal(useE(), true); const before = c.position, inside = c.inside;
    world.edges = [];
    assert.equal(useE(), false); assert.deepEqual(c.position, before); assert.equal(c.inside, inside); assert.ok(c.blockedAccess);
  });
});

test('a real crossing wall still rejects the supported exit', () => {
  const world = city(); motor(world, (c, keys, useE) => {
    approach(c, keys); assert.equal(useE(), true); const before = c.position;
    wallPanels(getBuildingFloorPlan(world.buildings[0], 0)!).push({ rect: { x0: .2, x1: .4, z0: 12.3, z1: 12.5 }, bottom: 0, top: 2.8, kind: 'solid' });
    assert.equal(useE(), false); assert.deepEqual(c.position, before); assert.equal(c.inside?.id, 'market-b26');
  });
});

test('declared b26 path mismatch rejects instead of using the legacy +2 landing', () => {
  const world = city(); world.referenceCityRecipe!.arrival!.pathToDoor[1].x += .2;
  assert.equal(referenceStreetExit(world, world.buildings[0]).status, 'rejected');
  delete world.referenceCityRecipe!.arrival;
  assert.equal(referenceStreetExit(world, world.buildings[0]).status, 'rejected');
});

test('old v6 door exit keeps the original exact point and heading', () => {
  const world = city('current-v6'); assert.equal(referenceStreetExit(world, world.buildings[0]).status, 'not-applicable');
  motor(world, (c, keys, useE) => {
    approach(c, keys); assert.equal(useE(), true); assert.equal(useE(), true);
    assert.deepEqual(c.position, { x: -282, y: 80.4, z: 403 }); assert.equal(c.yaw, Math.PI);
  });
});

test('existing entry permission cannot be bypassed by the new exit helper', () => {
  const world = city(); motor(world, (c, keys, useE) => {
    approach(c, keys); const before = c.position; assert.equal(useE(), false); assert.deepEqual(c.position, before); assert.equal(c.inside, null); assert.ok(c.blockedAccess);
  }, false);
});

test('supported exit binds the declared real arrival without a hardcoded building ID', () => {
  const world = city(), b = world.buildings[0];
  b.id = 'custom-city-market-entrance';
  world.referenceCityRecipe!.arrival!.buildingId = b.id;
  assert.equal(referenceStreetExit(world, b).status, 'selected');
  const other = { ...b, id: 'another-real-market' }; world.buildings.push(other);
  assert.equal(referenceStreetExit(world, other).status, 'not-applicable');
});
