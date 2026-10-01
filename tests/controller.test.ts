import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller.ts';
import { canAccessFloor, getStairPosition } from '../src/access.ts';
import type { Building, VoxelModification, WorldDefinition } from '../src/types.ts';

function fixture(run: (controller: PlayerController, building: Building, keyboard: EventTarget) => void, mayor = false, blocks: VoxelModification[] = []) {
  const keyboard = Object.assign(new EventTarget(), { closest: () => null });
  const documentTarget = Object.assign(new EventTarget(), { pointerLockElement: null });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { value: keyboard, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: documentTarget, configurable: true });
  const building: Building = { id: 'core-main', districtId: 'civic', name: '天枢阁', kind: 'core', position: { x: 0, y: 254, z: 0 }, width: 144, depth: 112, height: 234, floors: 30, basements: 2, publicFloors: 3, requiredPermission: 'mayor', floorFootprints: Array.from({ length: 30 }, (_, floor) => ({ width: 144 - Math.floor(floor / 6) * 18, depth: 112 - Math.floor(floor / 6) * 14 })), rotation: 0, door: { x: 0, y: 254.6, z: 56 }, capacity: 1000, seed: 1 };
  const world: WorldDefinition = { seed: 1, voxelSize: 0.2, size: 4400, buildings: [building], districts: [], nodes: [], edges: [], mountains: [], spawn: { x: 0, y: 254.6, z: 58 }, waterfall: { top: { x: 500, y: 100, z: 500 }, bottom: { x: 500, y: 0, z: 500 }, width: 10 }, river: [{ x: 500, y: 0, z: 500 }] };
  const player = { role: mayor ? 'mayor' as const : 'traveler' as const };
  const controller = new PlayerController(new PerspectiveCamera(), new EventTarget() as HTMLCanvasElement, world, () => {}, (b, floor) => canAccessFloor(b, floor, player), () => blocks);
  try { run(controller, building, keyboard); }
  finally {
    controller.dispose();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('restoring an indoor upper or basement position preserves the occupied level during walking', () => {
  fixture((controller, building) => {
    for (const floor of [-2, -1, 0, 16, 29]) {
      const position = getStairPosition(building, floor);
      controller.setMode('walk', position);
      assert.equal(controller.inside?.id, building.id);
      assert.equal(controller.floor, floor);
      controller.step(0.1, false);
      assert.equal(controller.floor, floor);
      assert.equal(controller.position.y, position.y);
    }
  }, true);
});

test('upper-floor collision follows the narrowed occupied footprint and cannot walk off the floor', () => {
  fixture((controller, building, keyboard) => {
    const floor = 29;
    controller.setMode('walk', { x: 35.5, y: getStairPosition(building, floor).y, z: 0 });
    controller.yaw = 0;
    const down = new Event('keydown'); Object.assign(down, { code: 'KeyD', repeat: false }); keyboard.dispatchEvent(down);
    for (let step = 0; step < 10; step++) controller.step(0.1, false);
    assert.equal(controller.floor, floor);
    assert(controller.position.x < 36 - 0.35);
    assert.equal(controller.inside?.id, building.id);
  }, true);
});

test('stairs preserve their shared shaft and skip floors whose permissions have not been earned', () => {
  fixture((controller, building) => {
    controller.setMode('walk', getStairPosition(building, 2));
    assert(controller.useStairs());
    assert.equal(controller.floor, 29);
    const top = controller.position;
    assert(controller.useStairs());
    assert.equal(controller.floor, 0);
    assert.equal(controller.position.x, top.x);
    assert.equal(controller.position.z, top.z);
  });
  fixture((controller, building) => {
    controller.setMode('walk', getStairPosition(building, 29));
    assert(controller.useStairs());
    assert.equal(controller.floor, -2);
  }, true);
});

test('placed voxels obstruct the body and removing them restores the same walkable space', () => {
  const blocks = [{ id: 'voxel-1', color: '#ffffff', position: { x: 0.8, y: 255.4, z: 0 } }];
  fixture((controller, building, keyboard) => {
    controller.setMode('walk', { x: 0, y: building.position.y + 0.6, z: 0 }); controller.yaw = 0;
    const down = new Event('keydown'); Object.assign(down, { code: 'KeyD', repeat: false }); keyboard.dispatchEvent(down);
    controller.step(0.1, false);
    assert.equal(controller.position.x, 0);
    blocks.splice(0, blocks.length);
    controller.step(0.1, false);
    assert(controller.position.x > 0.4);
  }, true, blocks);
});

test('a floor-level voxel is a usable step while a taller stack cannot be walked through', () => {
  const blocks = [{ id: 'voxel-1', color: '#ffffff', position: { x: 0.8, y: 254.6, z: 0 } }];
  fixture((controller, building, keyboard) => {
    controller.setMode('walk', { x: 0, y: building.position.y + 0.6, z: 0 }); controller.yaw = 0;
    const down = new Event('keydown'); Object.assign(down, { code: 'KeyD', repeat: false }); keyboard.dispatchEvent(down);
    controller.step(0.1, false);
    assert(controller.position.x > 0.4);
    assert(Math.abs(controller.position.y - 254.8) < 1e-7);
    blocks.push({ id: 'voxel-2', color: '#ffffff', position: { x: 1.3, y: 255.4, z: 0 } });
    controller.step(0.1, false);
    assert(controller.position.x < 0.9);
  }, true, blocks);
});

test('a new traveler starts on foot and camera modes require an actual acquired aircraft', () => {
  fixture(controller => {
    assert.equal(controller.mode, 'walk');
    assert.deepEqual(controller.walkingPosition, controller.world.spawn);
    const before = controller.position;
    assert.equal(controller.setMode('jet', before), false);
    assert.equal(controller.mode, 'walk'); assert.deepEqual(controller.position, before);
    assert.equal(controller.setMode('drone', before), false);
    controller.resetView(); assert.deepEqual(controller.position, before);
  });
});

test('bridge handrails stop lateral walking while the shared open ends and longitudinal deck remain usable', () => {
  fixture((controller, _building, keyboard) => {
    controller.world.edges.push({ id: 'real-bridge', from: 'a', to: 'b', mode: 'bridge', length: 80, capacity: 20, points: [{ x: 300, y: 254.6, z: -40 }, { x: 300, y: 254.6, z: 40 }] });
    const press = (code: string, type = 'keydown') => { const event = new Event(type); Object.assign(event, { code, repeat: false }); keyboard.dispatchEvent(event); };
    controller.setMode('walk', { x: 303.4, y: 254.6, z: 0 }); controller.yaw = 0;
    press('KeyD'); controller.step(.1, false); assert.equal(controller.position.x, 303.4);
    press('KeyD', 'keyup'); press('KeyW'); controller.step(.1, false);
    assert(controller.position.z < -.4); assert.equal(controller.position.y, 254.6);
    press('KeyW', 'keyup');
    controller.setMode('walk', { x: 303.4, y: 254.6, z: 38 }); controller.yaw = 0;
    press('KeyD'); controller.step(.1, false);
    assert(controller.position.x > 303.8, 'last six metres must keep access at the bridge join');
  });
});
