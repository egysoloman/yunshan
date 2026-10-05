import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller';
import { getStairPosition } from '../src/access';
import { getWalkHeight } from '../src/world';
import type { Building, Vec3, WorldDefinition } from '../src/types';

const close = (actual: number, expected: number, message = '') => assert(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const insideId = (controller: PlayerController) => controller.inside?.id;
type MotorFixture = { controller: PlayerController; keys: EventTarget; document: EventTarget; clock: (ms: number) => void };
function fixture(run: (value: MotorFixture) => void, building?: Building, spawn: Vec3 = { x: 0, y: 0, z: 0 }, road?: Vec3[]) {
  let now = 0;
  const keys = Object.assign(new EventTarget(), { closest: () => null });
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null });
  const originals = Object.fromEntries(['window', 'document', 'performance'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'window', { value: keys, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now, timeOrigin: 1_700_000_000_000 }, configurable: true });
  const roads: WorldDefinition['edges'] = road
    ? [{ id: 'actual-door-road', from: 'door', to: 'outside', mode: 'road', points: road, length: 3.2, capacity: 20 }]
    : [{ id: 'input-flat-z', from: 'z-a', to: 'z-b', mode: 'road', length: 200, capacity: 20,
      points: [{ x: spawn.x, y: spawn.y, z: spawn.z - 100 }, { x: spawn.x, y: spawn.y, z: spawn.z + 100 }] },
    { id: 'input-flat-x', from: 'x-a', to: 'x-b', mode: 'road', length: 200, capacity: 20,
      points: [{ x: spawn.x - 100, y: spawn.y, z: spawn.z }, { x: spawn.x + 100, y: spawn.y, z: spawn.z }] }];
  const world: WorldDefinition = { seed: 1, voxelSize: .2, size: 4000, districts: [], buildings: building ? [building] : [], nodes: [],
    edges: roads,
    mountains: [], spawn, waterfall: { top: { x: 1800, y: 100, z: 1800 }, bottom: { x: 1800, y: 0, z: 1800 }, width: 10 },
    river: [{ x: 1800, y: 0, z: 1800 }, { x: 1800, y: 0, z: 1900 }] };
  const controller = new PlayerController(new PerspectiveCamera(), new EventTarget() as HTMLCanvasElement, world, () => {});
  const worldBefore = JSON.stringify(world);
  try {
    close(getWalkHeight(world, spawn.x, spawn.z, spawn.y), spawn.y, 'declared test spawn must have authoritative support');
    run({ controller, keys, document: doc, clock: ms => { assert(ms >= now, 'accepted clock is monotonic'); now = ms; } });
  }
  finally {
    const worldAfter = JSON.stringify(world);
    controller.dispose();
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
    assert.equal(worldAfter, worldBefore, 'walking input cannot mutate World bytes');
  }
}
/** Real EventTarget listeners receive explicit occurrence times in the same
 * controlled monotonic domain; handler clock and event timestamp may differ. */
function key(keys: EventTarget, code: string, timeStamp: number, down = true, repeat = false) {
  const event = new Event(down ? 'keydown' : 'keyup');
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  Object.assign(event, { code, repeat }); keys.dispatchEvent(event);
}
function frame(c: PlayerController, now: number, rawSeconds: number, passenger = false, paused = false) {
  c.stepWalkingFrame(now, rawSeconds, passenger, paused);
}

test('late W in a slow frame receives only its real held interval, with unchanged eye and speed', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(990); key(keys, 'KeyW', 800); clock(1000); frame(c, 1000, 1);
    close(c.position.z, -.96, '200ms held is .96m, not a full caught-up second');
    close(c.camera.position.y - c.position.y, 1.72);
  });
});

test('a completed 200ms pulse survives early idle time in a five-second frame and delayed keyup delivery', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(4500); key(keys, 'KeyW', 100); clock(4900); key(keys, 'KeyW', 300, false);
    clock(5000); frame(c, 5000, 5); close(c.position.z, -.96);
    clock(6000); frame(c, 6000, 1); close(c.position.z, -.96, 'released pulse is consumed once');
  });
});

test('continuous W pays each interval once and a long held stall remains capped at one second', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(500); frame(c, 500, .5); close(c.position.z, -1.92);
    clock(1500); frame(c, 1500, 1); close(c.position.z, -6.72);
    clock(4500); frame(c, 4500, 3); close(c.position.z, -11.52);
    clock(4800); key(keys, 'KeyW', 4600, false); clock(5000); frame(c, 5000, .5); close(c.position.z, -12);
    frame(c, 5000, 1); frame(c, 4900, 1); close(c.position.z, -12, 'duplicate or older frames cannot replay input');
  });
});

test('active budget keeps the latest active second in chronological order and ignores idle gaps', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(900); key(keys, 'KeyW', 900, false);
    clock(4000); key(keys, 'KeyD', 4000); clock(4400); key(keys, 'KeyD', 4400, false);
    clock(5000); frame(c, 5000, 5); close(c.position.z, -2.88); close(c.position.x, 1.92);
  });
  const tiny: Building = { id: 'ordered-door', districtId: 'town', name: 'home', kind: 'home', position: { x: 0, y: 0, z: 0 },
    width: 4, depth: 4, height: 12, floors: 3, rotation: 0, door: { x: 0, y: .6, z: 2 }, capacity: 5, seed: 1 };
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(900); key(keys, 'KeyW', 900, false);
    clock(4000); key(keys, 'KeyD', 4000); clock(4400); key(keys, 'KeyD', 4400, false);
    clock(5000); frame(c, 5000, 5);
    assert.equal(c.inside?.id, tiny.id, 'W must cross the door before D meets the side wall; reversed replay stays outside');
    close(c.position.z, .12); assert(c.position.x > 0 && c.position.x < 1.5, 'original side wall stops the .35m body');
  }, tiny, { x: 0, y: .6, z: 3 });
});

test('sprint, opposite keys and normalized diagonal arrows retain their original speed contracts', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(200); key(keys, 'ShiftLeft', 200);
    clock(300); key(keys, 'KeyS', 300); clock(400); key(keys, 'KeyS', 400, false);
    clock(500); key(keys, 'ShiftLeft', 500, false); clock(600); key(keys, 'KeyW', 600, false);
    clock(1000); frame(c, 1000, 1); close(c.position.z, -2.96); close(c.position.x, 0);
    clock(1100); key(keys, 'ArrowUp', 1100); key(keys, 'ArrowRight', 1100);
    clock(1300); key(keys, 'ArrowUp', 1300, false); key(keys, 'ArrowRight', 1300, false);
    clock(1500); frame(c, 1500, .5); close(c.position.x, .96 / Math.sqrt(2)); close(c.position.z, -2.96 - .96 / Math.sqrt(2));
  });
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(300); key(keys, 'KeyS', 300);
    clock(4700); key(keys, 'KeyS', 4700, false); clock(4900); key(keys, 'KeyW', 4900, false);
    clock(5000); frame(c, 5000, 5); close(c.position.z, -1.92, 'opposite-key idle must not erase the two real 200ms motions');
  });
});

test('epoch timestamps normalize, invalid clocks fall back, and dispatch order clamps backward timestamps', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(900); key(keys, 'KeyW', 1_700_000_000_100); clock(950); key(keys, 'KeyW', 1_700_000_000_300, false);
    clock(1000); frame(c, 1000, 1); close(c.position.z, -.96);
    clock(1100); key(keys, 'KeyW', NaN); clock(1200); key(keys, 'KeyW', -1, false);
    clock(1500); frame(c, 1500, .5); close(c.position.z, -1.44);
    clock(1900); key(keys, 'KeyW', 1800); clock(1950); key(keys, 'KeyW', 1700, false);
    clock(2000); frame(c, 2000, .5); close(c.position.z, -1.44, 'backward release is clamped to its preceding press');
    clock(2100); key(keys, 'KeyW', Infinity); clock(2200); key(keys, 'KeyW', 999999, false);
    clock(2500); frame(c, 2500, .5); close(c.position.z, -1.92);
  });
});

test('an accepted event later than the supplied rAF timestamp waits for the next frame', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(1010); key(keys, 'KeyW', 1010); frame(c, 1000, 1); close(c.position.z, 0);
    clock(1200); key(keys, 'KeyW', 1200, false); frame(c, 1200, .2); close(c.position.z, -.912);
  });
});

test('a late event before an already consumed frame changes only unconsumed time and cannot roll the body back', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(500); frame(c, 500, .5); close(c.position.z, -1.92);
    clock(600); key(keys, 'KeyW', 300, false); clock(1000); frame(c, 1000, .5); close(c.position.z, -1.92);
    clock(1150); key(keys, 'KeyW', 1100); clock(1500); frame(c, 1500, .5); close(c.position.z, -3.84);
  });
  fixture(({ controller: c, keys, clock }) => {
    clock(500); frame(c, 500, .5); clock(700); key(keys, 'KeyW', 100); clock(800); key(keys, 'KeyW', 300, false);
    clock(1000); frame(c, 1000, .5); close(c.position.z, 0, 'a completely consumed old pulse cannot be paid later');
  });
});

test('blur, visibility and successful setMode discard pending movement while a rejected mode keeps it', () => {
  for (const reset of ['blur', 'visibility', 'mode']) fixture(({ controller: c, keys, document, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(200); key(keys, 'KeyW', 200, false);
    clock(300);
    if (reset === 'blur') keys.dispatchEvent(new Event('blur'));
    else if (reset === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
    else assert.equal(c.setMode('walk', c.position), true);
    clock(1000); frame(c, 1000, 1); close(c.position.z, 0, `${reset} discards old budget`);
    clock(1100); key(keys, 'KeyW', 1100); clock(1200); frame(c, 1200, .2); close(c.position.z, -.48);
  });
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(200); assert.equal(c.setMode('drone', c.position), false);
    clock(300); key(keys, 'KeyW', 300, false); clock(1000); frame(c, 1000, 1); close(c.position.z, -.96);
  });
});

test('paused walking retains the original motor while passenger frames consume without later replay', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(500); frame(c, 500, .5, false, true); close(c.position.z, -1.92);
    clock(1500); frame(c, 1500, 1, true, true); close(c.position.z, -1.92);
    clock(1600); frame(c, 1600, .1, false, false); close(c.position.z, -2.4);
    assert.equal(c.drivingControls.throttle, 1, 'frame snapshots do not replace live vehicle keys');
  });
});

test('pre-reset queued presses cannot revive walking through later snapshots or pose changes; old keyup releases held state', () => {
  for (const reset of ['blur', 'visibility', 'mode', 'passenger']) fixture(({ controller: c, keys, document, clock }) => {
    clock(500);
    if (reset === 'blur') keys.dispatchEvent(new Event('blur'));
    else if (reset === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
    else if (reset === 'mode') assert.equal(c.setMode('walk', c.position), true);
    else c.syncPassenger(c.position);
    clock(700); key(keys, 'KeyW', 100); // Occurred before reset, delivered after.
    assert.equal(c.drivingControls.throttle, 1, 'this fix does not rewrite live vehicle input semantics');
    clock(800); key(keys, 'ShiftRight', 800); clock(900); frame(c, 900, .9); close(c.position.z, 0);
    clock(1000); c.syncPassenger(c.position); clock(1100); frame(c, 1100, .2); close(c.position.z, 0);
    clock(1200); key(keys, 'KeyW', 100, false); key(keys, 'ShiftRight', 1200, false);
    clock(1300); key(keys, 'KeyW', 1300); clock(1400); key(keys, 'KeyW', 1400, false);
    clock(1500); frame(c, 1500, .4); close(c.position.z, -.48, `${reset} permits a genuinely new pulse`);
  });
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(500); c.syncPassenger(c.position);
    clock(700); key(keys, 'KeyW', 300, false); clock(1000); frame(c, 1000, 1); close(c.position.z, 0, 'stale keyup must still release preserved held baseline');
  });
  fixture(({ controller: c, keys, clock }) => {
    clock(500); c.setMode('walk', c.position); clock(700); key(keys, 'KeyW', 0);
    clock(1000); frame(c, 1000, 1); close(c.position.z, 0, 'relative DOM timestamp zero is a legitimate old event, not a fresh fallback');
  });
});

test('native-failure home geometry permits exact timed W to the original exterior approach and E enters from outside', () => {
  const home: Building = { id: 'market-b24', districtId: 'market', name: '千灯市集·钱庄街·里居7', kind: 'home', position: { x: -390.8, y: 76, z: 316.20000000000005 },
    width: 40, depth: 34.4, height: 10.200000000000001, floors: 3, rotation: 0, door: { x: -390.8, y: 76.60000000000001, z: 333.40000000000003 },
    capacity: 129, seed: 668619109, floorPlanProfile: 'v4-program-bodies-02' };
  const stage = { x: -390.8, y: 76.2377358490566, z: 336.6 }, approach = { x: -390.8, y: 76.46415094339623, z: 334.6 };
  fixture(({ controller: c, keys, clock }) => {
    assert.equal(c.inside, null); clock(100); key(keys, 'KeyW', 100);
    clock(900); key(keys, 'KeyW', 100 + 2 / 4.8 * 1000, false);
    clock(5000); frame(c, 5000, 5);
    close(c.position.x, approach.x); close(c.position.y, approach.y); close(c.position.z, approach.z); assert.equal(c.inside, null);
    assert.equal(c.useDoor(home), true); close(c.position.z, 331.40000000000003); close(c.position.y, 76.6); assert.equal(insideId(c), home.id);
  }, home, stage, [home.door, stage]);
});

test('successful pose changes cut old walking budget while retaining held keys; failed doors leave it intact', () => {
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(500); c.syncPassenger({ x: 50, y: 0, z: 0 });
    assert.equal(c.drivingControls.throttle, 1); clock(1000); frame(c, 1000, 1); close(c.position.x, 50); close(c.position.z, -2.4);
  });
  const legacy: Building = { id: 'legacy-home', districtId: 'town', name: 'home', kind: 'home', position: { x: 0, y: 0, z: 0 },
    width: 40, depth: 32, height: 12, floors: 3, rotation: 0, door: { x: 0, y: .6, z: 16 }, capacity: 50, seed: 7 };
  fixture(({ controller: c, keys, clock }) => {
    c.setMode('walk', { x: 0, y: .6, z: 18 }); clock(100); key(keys, 'KeyW', 100); clock(500);
    assert.equal(c.useDoor(legacy), true); clock(1000); frame(c, 1000, 1); close(c.position.z, 11.6); close(c.position.y, .6);
    const shaft = getStairPosition(legacy, 0); clock(1100); c.setMode('walk', shaft); key(keys, 'KeyW', 1100); clock(1500);
    assert.equal(c.useStairs(), true); const raised = c.position; clock(2000); frame(c, 2000, 1); close(c.position.z, raised.z - 2.4); close(c.position.y, 4.6);
  }, legacy, { x: 0, y: .6, z: 18 });
  fixture(({ controller: c, keys, clock }) => {
    clock(100); key(keys, 'KeyW', 100); clock(300); key(keys, 'KeyW', 300, false);
    clock(500); assert.equal(c.useDoor(legacy), false); clock(1000); frame(c, 1000, 1); close(c.position.z, -.96);
  });
});
