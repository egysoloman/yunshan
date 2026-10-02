import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PlayerController } from '../src/controller.ts';
import { CityRenderer } from '../src/renderer.ts';
import { marketCounters, blocksMarketCounter } from '../src/site-fixtures.ts';
import { MarketGoodsPool } from '../src/rendering/market-goods.ts';
import { buildArchitectureDetails } from '../src/rendering/architecture-detail.ts';
import { createWorld, getWalkHeight } from '../src/world.ts';
import { Simulation } from '../src/simulation.ts';
import type { Building, WorldDefinition } from '../src/types.ts';

const market: Building = { id: 'test-market', name: '街边市集', kind: 'market', districtId: 'town', position: { x: 0, y: 0, z: 0 }, width: 32, depth: 24, height: 8, floors: 2, rotation: 0, door: { x: 0, y: .6, z: 12 }, capacity: 50, seed: 1 };
const mini: WorldDefinition = { seed: 1, size: 4400, voxelSize: .2, buildings: [market], districts: [], nodes: [], edges: [], mountains: [], spawn: { x: 0, y: .6, z: 14 }, waterfall: { top: { x: 500, y: 100, z: 500 }, bottom: { x: 500, y: 0, z: 500 }, width: 10 }, river: [{ x: 500, y: 0, z: 500 }] };

test('counter geometry rests on actual ground and leaves a body-height public doorway clear', () => {
  const world = createWorld(), building = world.buildings.find(b => b.id === 'market-b0')!;
  const before = JSON.stringify(world), counters = marketCounters(world, building);
  assert.equal(counters.length, 2);
  for (const counter of counters) {
    assert.equal(counter.size.y, 1); assert(counter.size.x <= 3.2 + 1e-7);
    assert(Math.abs(counter.position.y - .5 - getWalkHeight(world, counter.position.x, counter.position.z, building.door.y)) <= .4 + 1e-7);
    for (const dimension of Object.values(counter.size)) assert(Math.abs(dimension / .2 - Math.round(dimension / .2)) < 1e-7);
    assert(counter.position.y + .5 < building.door.y + 1.72);
  }
  const from = { ...building.door, z: building.door.z + 4 }, to = { ...building.door, z: building.door.z - 2 };
  assert.equal(blocksMarketCounter(counters, from, to), false);
  assert.equal(JSON.stringify(world), before);
});

test('actual near and far building emitters align the cabinet and tabletop with the shared physical counter', () => {
  const world = createWorld(), building = world.buildings.find(b => b.id === 'market-b0')!;
  // Exercise the real production building path without constructing WebGL.
  // Its local emitter adds the building's floor base before submitting boxes.
  const renderer = Object.create(CityRenderer.prototype) as {
    world: WorldDefinition;
    buildHouse(building: Building, batch: { box: (...args: unknown[]) => void }, far: boolean): void;
  };
  renderer.world = world;
  const before = JSON.stringify(world);
  for (const far of [false, true]) {
    const boxes: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    renderer.buildHouse(building, { box: (...args) => {
      const [, x, y, z, sx, sy, sz] = args as [unknown, number, number, number, number, number, number];
      boxes.push({ x, y, z, sx, sy, sz });
    } }, far);
    for (const counter of marketCounters(world, building)) {
      const parts = boxes.filter(part => Math.abs(part.x - counter.position.x) < 1e-7 && Math.abs(part.z - counter.position.z) < 1e-7 && Math.abs(part.sx - counter.size.x) < 1e-7 && Math.abs(part.sz - counter.size.z) < 1e-7);
      const cabinet = parts.find(part => Math.abs(part.sy - .8) < 1e-7), tabletop = parts.find(part => Math.abs(part.sy - .2) < 1e-7);
      assert(cabinet && tabletop, 'the actual near/far building path must emit both counter solids');
      assert(Math.abs(cabinet.y - cabinet.sy / 2 - (counter.position.y - counter.size.y / 2)) < 1e-7, 'visible cabinet bottom must rest at the physical bottom');
      assert(Math.abs(tabletop.y + tabletop.sy / 2 - (counter.position.y + counter.size.y / 2)) < 1e-7, 'visible tabletop top must match the physical top and food samples');
      assert(Math.abs(cabinet.y + cabinet.sy / 2 - (tabletop.y - tabletop.sy / 2)) < 1e-7);
    }
  }
  assert.equal(JSON.stringify(world), before);
});

test('actual controller stops at a market cabinet while the original central entrance stays usable', () => {
  const keyboard = Object.assign(new EventTarget(), { closest: () => null }), doc = Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock() {} });
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { value: keyboard, configurable: true }); Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  const controller = new PlayerController(new THREE.PerspectiveCamera(), new EventTarget() as HTMLCanvasElement, mini, () => {});
  const press = (code: string, type = 'keydown') => { const event = new Event(type); Object.assign(event, { code, repeat: false }); keyboard.dispatchEvent(event); };
  try {
    const counter = marketCounters(mini, market)[0], front = counter.position.z + counter.size.z / 2;
    controller.setMode('walk', { x: counter.position.x, y: counter.position.y - .5, z: front + .8 }); controller.yaw = 0;
    press('KeyW'); for (let i = 0; i < 8; i++) controller.step(.1, false); press('KeyW', 'keyup');
    assert(controller.position.z >= front + .35 - 1e-7, 'the visible cabinet blocks actual body motion');
    controller.setMode('walk', { x: market.door.x, y: market.door.y, z: market.door.z + 3 }); controller.yaw = 0;
    press('KeyW'); for (let i = 0; i < 7; i++) controller.step(.1, false); press('KeyW', 'keyup');
    assert(controller.position.z < market.door.z); assert.equal(controller.inside?.id, market.id);
  } finally {
    controller.dispose();
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('a legacy saved body inside a newly solid counter can walk out without teleporting or reentering', () => {
  const counter = marketCounters(mini, market)[0], foot = { ...counter.position, y: counter.position.y - .5 };
  let current = foot;
  for (let step = 0; step < 12; step++) {
    const next = { ...current, x: current.x + .2 };
    assert.equal(blocksMarketCounter([counter], current, next), false); current = next;
  }
  assert(current.x > counter.position.x + counter.size.x / 2 + .35);
  assert.equal(blocksMarketCounter([counter], current, { ...current, x: counter.position.x }), true);
  assert.equal(blocksMarketCounter([counter], { ...foot, y: counter.position.y + .5 }, { ...foot, y: counter.position.y + .5, x: foot.x + .2 }), false, 'an actor physically on the top is not trapped by the side wall');
});

test('market food samples follow real finite stock and residency without changing any saved state', () => {
  const world = createWorld(), simulation = new Simulation(world), building = world.buildings.find(b => b.id === 'market-b0')!;
  const shop = simulation.state.shops.find(s => s.buildingId === building.id)!;
  const scene = new THREE.Scene(), pool = new MarketGoodsPool(scene, world), resident = new Set([building.id]), camera = { ...building.door };
  const original = simulation.exportSave();
  try {
    pool.update(simulation.state, camera, resident); assert.equal(simulation.exportSave(), original);
    assert.equal(pool.mesh.count, shop.open ? Math.min(8, Math.floor(shop.inventory)) : 0);
    pool.update(simulation.state, camera, new Set()); assert.equal(pool.mesh.count, 0);
    // Read-only rendering must also represent a legitimately empty/closed state.
    const view = { ...simulation.state, shops: simulation.state.shops.map(s => s.id === shop.id ? { ...s, inventory: 0 } : s) };
    pool.update(view, camera, resident); assert.equal(pool.mesh.count, 0); assert.equal(simulation.exportSave(), original);
    const counters = marketCounters(world, building);
    const staticFoodAboveCounters = buildArchitectureDetails(building).filter(part => part.purpose === 'program' && counters.some(counter => {
      const x = building.position.x + part.position.x, y = building.position.y + .6 + part.position.y, z = building.position.z + part.position.z;
      return Math.abs(x - counter.position.x) < counter.size.x / 2 && Math.abs(z - counter.position.z) < counter.size.z / 2 && y - part.size.y / 2 > counter.position.y + counter.size.y / 2;
    }));
    assert.equal(staticFoodAboveCounters.length, 0, 'an empty market must not keep a second, fixed display of floating produce in architecture decorations');
    const closed = { ...view, shops: view.shops.map(s => s.id === shop.id ? { ...s, inventory: 8, open: false } : s) };
    pool.update(closed, camera, resident); assert.equal(pool.mesh.count, 0);
    const two = { ...view, shops: view.shops.map(s => s.id === shop.id ? { ...s, inventory: 2, open: true } : s) };
    pool.update(two, camera, resident); assert.equal(pool.mesh.count, 2); assert.equal(pool.mesh.userData.budget.drawCalls, 1);
    const matrix = new THREE.Matrix4(); pool.mesh.getMatrixAt(0, matrix);
    assert(matrix.elements[13] + .1 < building.door.y + 1.72); assert.equal(pool.mesh.userData.budget.triangles, 24);
    assert.equal(simulation.exportSave(), original);
  } finally { pool.dispose(); }
  assert.equal(scene.children.length, 0); pool.dispose();
});
