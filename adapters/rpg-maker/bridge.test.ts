import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { runInNewContext } from 'node:vm';
import {createHash} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Simulation } from '../../src/simulation.ts';
import { createWorld, getWalkHeight, type CityLayoutVersion } from '../../src/world.ts';
import { savedWorldFingerprint } from '../../src/persistence/world-layout.ts';
import { blocksFloorPlanMovement, buildingLocalPosition, buildingWorldPosition, floorPlanSupport, getBuildingFloorPlan, getBuildingUsePoints } from '../../src/architecture-floor-plan.ts';
import { canAccessFloor } from '../../src/access.ts';
import type { Command, Vec3, Vehicle } from '../../src/types.ts';
import type { CitySession } from './bridge.ts';

const SEED = 20261001;
const COMMIT = '6785ca7dcca09e8e97afd610cfd52176c7a1cfb1';
const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'];
type BrowserAPI = typeof import('./bridge.ts');
let api: BrowserAPI, bundledInputs: string[], bundleText: string;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

before(async () => {
  // Execute the actual browser entry and its complete frozen core dependency
  // graph in an IIFE. No RPG Maker engine, DOM, Three or fake Simulation host.
  const built = await build({ entryPoints: [fileURLToPath(new URL('./bridge.ts', import.meta.url))],
    absWorkingDir: fileURLToPath(new URL('../..', import.meta.url)), bundle: true, write: false,
    format: 'iife', globalName: 'YunshanCore', platform: 'browser', target: ['es2022'], metafile: true, legalComments: 'eof', footer: {js: 'globalThis.YunshanCore = YunshanCore;'} });
  bundledInputs = Object.keys(built.metafile!.inputs);
  bundleText = built.outputFiles[0].text;
  const context: Record<string, unknown> = { TextEncoder, TextDecoder };
  assert.equal(createHash('sha256').update(bundleText).digest('hex'), 'b376c8480b707ef51f109e52b3c2469e41e6d132e217f080423df51b16cee2db');
  // Capture only this isolated VM's own standard intrinsics. This avoids Node
  // context-global proxy overhead without supplying host Math/JSON, a simulator,
  // Three, DOM or any game objects. The formal production IIFE bytes are exact.
  runInNewContext('const Math = globalThis.Math, JSON = globalThis.JSON;\n' + bundleText, context, { filename: 'YunshanCore.browser.iife.js', timeout: 10000 });
  api = context.YunshanCore as BrowserAPI;
  assert.equal(typeof api.createSession, 'function');
  for (const name of ['window', 'document', 'THREE', 'PIXI', 'require', 'process', '$gameMap']) {
    assert.equal(name in context, false, `${name} must not be supplied by the VM host`);
  }
});

function fresh(layout?: CityLayoutVersion) { return api.createSession({ seed: SEED, ...(layout ? { layout } : {}) }); }
/** Core fixture only: establish a trusted, supported opening foot position.
 * This is not a claim that setFocus validates or performs walking input. */
function supportedPair(layout: CityLayoutVersion = 'current-v4') {
  const world = createWorld(SEED, layout), direct = new Simulation(world);
  const point = { ...world.spawn, y: getWalkHeight(world, world.spawn.x, world.spawn.z, world.spawn.y) };
  direct.setFocus(point, 'walk');
  const session = api.createSession({ save: direct.exportSave() });
  assert.equal(session.exportCoreSave(), direct.exportSave());
  return { world, direct, session };
}
function directTick(direct: Simulation) {
  direct.setFocus(direct.state.player.position, 'walk');
  direct.step(.25);
}
function assertWholeCore(session: CitySession, direct: Simulation, reason: string) {
  assert.equal(session.exportCoreSave(), direct.exportSave(), reason);
}
function remoteShop(session: CitySession) {
  const state = session.snapshot(), world = session.worldSnapshot();
  const shop = state.shops.find(shop => shop.open && shop.inventory >= 1
    && distance(state.player.position, world.buildings.find(site => site.id === shop.buildingId)!.door) > 100);
  assert.ok(shop, 'the generated city must contain a genuine remote stocked shop');
  return shop;
}

test('the browser IIFE executes without Three, DOM, Node or an RPG Maker engine and owns the same seeded core', () => {
  assert.equal(api.CORE_COMMIT, COMMIT);
  assert(bundledInputs.some(path => /src\/simulation\.ts$/.test(path)));
  assert(bundledInputs.some(path => /src\/simulation\/trade\.ts$/.test(path)));
  assert(bundledInputs.every(path => !/(?:^|\/)three(?:\/|$)|src\/(?:controller|renderer|ui|main)\.ts$/.test(path)), 'browser bridge imports the numeric core rather than renderer/browser modules');
  assert(!/\brequire\s*\(/.test(bundleText), 'browser IIFE has no unresolved CommonJS dependency');
  const session = fresh(), direct = new Simulation(createWorld(SEED));
  assert.equal(session.metadata.worldSeed, SEED);
  assert.equal(session.metadata.simulationTickSeconds, .25);
  assert.equal(session.metadata.coordinates.voxelSize, .2);
  assert.equal(session.metadata.worldFingerprint, savedWorldFingerprint(direct.worldDefinition));
  assertWholeCore(session, direct, 'new browser session is the complete unmodified same-seed Simulation');
});

test('fixed bridge frames preserve the quarter-second core tick, one minute per second and all ten phases', () => {
  const { session, direct } = supportedPair();
  const initial = session.snapshot(), clock = initial.day * 1440 + initial.hour * 60;
  assert.equal(session.advance(.24).tick, initial.tick, 'no core tick before .25 real seconds');
  assert.equal(session.advance(.01).tick, initial.tick + 1);
  directTick(direct);
  assertWholeCore(session, direct, 'split .24+.01 produces exactly one canonical core tick');
  for (let tick = 1; tick < 4; tick++) {
    session.advance(.25); directTick(direct);
    assertWholeCore(session, direct, `complete fixed-step core equality at tick ${tick + 1}`);
  }
  const after = session.snapshot();
  assert.equal(after.tick, initial.tick + 4);
  assert(Math.abs(after.day * 1440 + after.hour * 60 - clock - 1) < 1e-8);
  assert.deepEqual(copy(after.lastSystemOrder), ORDER);
});

test('state, world, actors, metadata and event snapshots are detached copies of authoritative data', () => {
  const session = fresh(), before = session.exportCoreSave(), worldBefore = JSON.stringify(session.worldSnapshot());
  const state = session.snapshot();
  state.player.money = -100; state.player.needs.hunger = -100; state.player.position.x += 1000;
  state.citizens[0].position.z += 1000; state.shops[0].inventory = -1;
  state.extension!.organizations[0].funds = -1;
  const world = session.worldSnapshot();
  world.spawn.x += 1000; world.buildings[0].door.x += 1000;
  world.edges[0].points[0].z += 1000; world.nodes.length = 0;
  const actors = session.actorsSnapshot(); actors[0].position.x += 1000; actors[0].needs.hunger = -1; actors[0].money = -1; actors.length = 0;
  const metadata = session.metadata as unknown as { coordinates: { voxelSize: number } }; metadata.coordinates.voxelSize = 99;
  const events = session.eventsSince(); assert(events.length > 0); events[0].text = 'mutated copy'; events.length = 0;
  assert.equal(session.exportCoreSave(), before, 'presentation mutations cannot change wallets, stock, people or runtime');
  assert.equal(JSON.stringify(session.worldSnapshot()), worldBefore, 'presentation cannot change geometry or route authority');
  assert.equal(session.metadata.coordinates.voxelSize, .2);
});

test('queued commands are copied, ordered and return the original core results without an implicit tick', () => {
  const session = fresh(), direct = new Simulation(createWorld(SEED));
  const first: Command = { type: 'pause', value: 1 };
  assert.equal(session.queueCommand(first, 'pause-first'), 'pause-first');
  first.value = 0;
  session.queueCommand({ type: 'speed', value: 2 }, 'speed-second');
  session.queueCommand({ type: 'pause', value: 0 }, 'resume-third');
  assert.equal(session.snapshot().paused, false, 'queued input has not executed early');
  const expected = [{ type: 'pause', value: 1 }, { type: 'speed', value: 2 }, { type: 'pause', value: 0 }] as Command[];
  const results = expected.map(command => direct.command(command));
  assert.equal(session.advance(0).frames, 0);
  assert.equal(session.snapshot().tick, 0);
  const actual = session.drainResults();
  assert.deepEqual(copy(actual.map(row => row.requestId)), ['pause-first', 'speed-second', 'resume-third']);
  assert.deepEqual(copy(actual.map(row => row.command)), expected);
  assert.deepEqual(copy(actual.map(row => row.result)), results);
  assert(actual.every(row => row.tick === 0 && row.clock === 480));
  assertWholeCore(session, direct, 'zero-second queue flush is precisely three ordered core commands');
  assert.deepEqual(copy(session.drainResults()), []);
});

test('a remote queued purchase returns refusal without charging money, altering stock or issuing an extra tick', () => {
  const session = fresh(), shop = remoteShop(session), before = session.exportCoreSave();
  session.queueCommand({ type: 'purchase', targetId: shop.id, value: 1 }, 'remote-sale');
  assert.equal(session.exportCoreSave(), before, 'enqueue cannot perform the transaction');
  session.advance(0);
  const results = session.drainResults();
  assert.equal(results.length, 1); assert.equal(results[0].requestId, 'remote-sale');
  assert.equal(results[0].result.ok, false); assert.match(results[0].result.message, /入口|现场|附近/);
  assert.equal(results[0].tick, 0);
  assert.equal(session.exportCoreSave(), before, 'core remote refusal is byte-atomic including cash, custody and hidden runtime');
});

test('a queued onsite purchase consumes original stock and original money exactly as direct Simulation', () => {
  const world = createWorld(SEED), direct = new Simulation(world);
  const shop = direct.state.shops.find(shop => world.buildings.find(site => site.id === shop.buildingId)?.kind === 'market')!;
  const site = world.buildings.find(site => site.id === shop.buildingId)!;
  const point = getBuildingUsePoints(site, 0).find(point => point.purpose === 'sale'
    && direct.isAtBuildingFunctionPoint(site, point.position, 'sale'));
  assert.ok(point, 'real generated market supplies an accessible sale point');
  direct.setFocus(point.position, 'walk');
  const session = api.createSession({ save: direct.exportSave() });
  const money = direct.state.player.money, inventory = shop.inventory, revenue = shop.revenue;
  assert.equal(session.atFunctionPoint(site.id, 'sale'), true);
  const command: Command = { type: 'purchase', targetId: shop.id, value: 1 };
  session.queueCommand(command, 'real-sale'); session.advance(0);
  const expected = direct.command(command), actual = session.drainResults();
  assert.equal(expected.ok, true); assert.deepEqual(copy(actual[0].result), expected);
  assert.equal(direct.state.player.money, money - shop.price);
  assert.equal(shop.inventory, inventory - 1); assert.equal(shop.revenue, revenue + shop.price);
  assertWholeCore(session, direct, 'bridge delegates actual sale, custody, taxes and receipt events to the original core');
});

test('rejected malformed core and bridge saves leave the entire live session, queue and partial clock intact', () => {
  const { session } = supportedPair();
  session.advance(.007);
  session.queueCommand({ type: 'speed', value: 2 }, 'surviving-queue');
  const before = session.exportSave(), core = JSON.parse(session.exportCoreSave());
  const badAccumulator = copy(core); badAccumulator.runtime.accumulator = -1;
  const badVehicle = copy(core); badVehicle.state.player.vehicleId = 'missing-original-vehicle';
  const badBridge = JSON.parse(before); badBridge.coreCommit = 'foreign-core';
  for (const bad of ['{', 'null', JSON.stringify(badAccumulator), JSON.stringify(badVehicle), JSON.stringify(badBridge)]) {
    assert.equal(session.importSave(bad).ok, false);
    assert.equal(session.exportSave(), before, 'failed load cannot replace city, queued requests, receipts or bridge accumulator');
  }
  const control = api.createSession({ save: before });
  for (let tick = 0; tick < 24; tick++) {
    session.advance(.25); control.advance(.25);
    assert.equal(session.exportSave(), control.exportSave(), `bad-load rejection preserves complete future at step ${tick + 1}`);
  }
});

test('complete bridge save restores pending commands, undrained receipts, fractional frames and 24-step exact future', () => {
  const { session } = supportedPair();
  const shop = remoteShop(session);
  session.queueCommand({ type: 'purchase', targetId: shop.id, value: 1 }, 'previous-refusal'); session.advance(0);
  session.advance(.007);
  const pendingId = session.queueCommand({ type: 'speed', value: 2 });
  const saved = session.exportSave(), restored = api.createSession({ save: saved });
  const envelope = JSON.parse(saved);
  assert.equal(envelope.commands.length, 1); assert.equal(envelope.results.length, 1);
  assert(envelope.realAccumulator > 0 && envelope.realAccumulator < api.FIXED_STEP_SECONDS);
  assert.equal(restored.exportSave(), saved, 'immediate full envelope restore is byte-identical');
  for (let tick = 0; tick < 24; tick++) {
    session.advance(.25); restored.advance(.25);
    assert.equal(restored.exportCoreSave(), session.exportCoreSave(), `entire core future at step ${tick + 1}`);
    assert.equal(restored.exportSave(), session.exportSave(), `bridge queue/receipt/fraction future at step ${tick + 1}`);
  }
  const a = session.drainResults(), b = restored.drainResults();
  assert.deepEqual(copy(a), copy(b));
  assert.deepEqual(copy(a.map(row => row.requestId)), ['previous-refusal', pendingId]);
  assert.equal(session.queueCommand({ type: 'speed', value: 1 }), restored.queueCommand({ type: 'speed', value: 1 }), 'next autogenerated ID survives restoration');
});

test('a legacy core save selects its actual fingerprinted layout and preserves its original city and future', () => {
  const { world, direct, session } = supportedPair('legacy-ee3e7a1');
  assert.equal(session.metadata.layout, 'legacy-ee3e7a1');
  assert.equal(session.metadata.worldFingerprint, savedWorldFingerprint(world));
  assert.equal(session.worldSnapshot().buildings.length, world.buildings.length);
  assertWholeCore(session, direct, 'legacy import retains complete original state');
  for (let tick = 0; tick < 24; tick++) {
    session.advance(.25); directTick(direct);
    assertWholeCore(session, direct, `actual legacy core continuation at step ${tick + 1}`);
  }
});

test('original passenger and permissioned driver bodies follow the real vehicle and ignore walker displacement', async t => {
  for (const mode of ['ride', 'drive'] as const) await t.test(mode, () => {
    const world = createWorld(SEED), direct = new Simulation(world);
    const vehicle = direct.state.vehicles.find(vehicle => vehicle.kind === 'road' && vehicle.progress === 0 && vehicle.direction === 1 && vehicle.state === 'waiting');
    assert.ok(vehicle, 'original generated fleet must contain an accessible stationary road vehicle');
    direct.setFocus(vehicle.position, 'walk');
    if (mode === 'drive') {
      const original = direct.exportSave();
      assert.equal(direct.command({ type: 'drive', targetId: vehicle.id }).ok, false);
      assert.equal(direct.exportSave(), original, 'default traveler cannot acquire driving permission');
      // Controlled existing driver qualification, matching the old core test;
      // this does not claim natural examination or create any funds/vehicle.
      direct.state.player.identities = ['traveler', 'driver'];
    }
    const cash = direct.state.player.money, passengers = vehicle.passengers, cargo = vehicle.cargo;
    assert.equal(direct.command({ type: mode, targetId: vehicle.id }).ok, true);
    assert.equal(direct.state.player.money, cash - (mode === 'ride' ? 4 : 0));
    assert.equal(vehicle.passengers, passengers + 1);
    const session = api.createSession({ save: direct.exportSave() }), boarded = copy(vehicle.position);
    assert.equal(session.useStairs().ok, false);
    assert.equal(session.useDoor(world.buildings[0].id).ok, false);
    if (mode === 'drive') {
      assert.equal(session.driveInput(1, 0, false).ok, true); direct.driveInput(1, 0, false);
    } else assert.equal(session.driveInput(1, 0, false).ok, false);
    for (let tick = 0; tick < 8; tick++) {
      session.advance(.25, { x: 1, z: 1, sprint: true }); directTick(direct);
      assertWholeCore(session, direct, `${mode} actual vehicle movement at step ${tick + 1}`);
      const state = session.snapshot();
      const actualVehicle: Vehicle = state.vehicles.find(item => item.id === vehicle.id)!;
      assert.equal(state.player.vehicleId, vehicle.id);
      assert.deepEqual(copy(state.player.position), copy(actualVehicle.position), 'walker cannot detach the transported body');
      assert.equal(actualVehicle.passengers, passengers + 1); assert.equal(actualVehicle.cargo, cargo);
    }
    assert(distance(direct.state.player.position, boarded) > 0, `${mode} follows actual original traffic rather than a pinned boarding position`);
  });
});

test('an upper-floor body near the entrance in x/z cannot use the ground door by event ID or flush its queue', () => {
  const world = createWorld(SEED), direct = new Simulation(world);
  // Controlled opening body fixture from original v4 geometry, not a walking claim.
  // Bank floor 1 has a legal front wing; higher home floors are set back from the entrance.
  const upper = (() => {
    for (const site of world.buildings.filter(site => site.kind === 'bank')) {
      const floor = 1, plan = getBuildingFloorPlan(site, floor);
      if (!plan || !canAccessFloor(site, floor, direct.state.player)) continue;
      const entrance = buildingLocalPosition(site, site.door);
      for (let ix = Math.ceil((entrance.x - 6) / .4); ix <= Math.floor((entrance.x + 6) / .4); ix++) {
        for (let iz = Math.ceil((entrance.z - 6) / .4); iz <= Math.floor((entrance.z + 6) / .4); iz++) {
          const point = buildingWorldPosition(site, { x: ix * .4, y: plan.y, z: iz * .4 });
          if (Math.hypot(point.x - site.door.x, point.z - site.door.z) > 6 || distance(point, site.door) <= 6) continue;
          const support = floorPlanSupport(site, floor, point, .35);
          if (!support || support.floor !== floor || Math.abs(support.y - point.y) > 1e-7
            || blocksFloorPlanMovement(site, floor, point, point, .35, 1.72)) continue;
          return { site, floor, point };
        }
      }
    }
    return undefined;
  })();
  assert.ok(upper, 'real generated architecture supplies an accessible supported upper-floor point horizontally near its entrance');
  assert(distance(upper.point, upper.site.door) > 6);
  direct.setFocus(upper.point, 'walk');
  const session = api.createSession({ save: direct.exportSave() });
  assert.equal(session.playerLocation().floor, upper.floor);
  session.queueCommand({ type: 'speed', value: 2 }, 'door-refusal-pending');
  const before = session.exportSave();
  assert.equal(session.useDoor(upper.site.id).ok, false, 'full 3D entrance proximity is required despite nearby x/z and a valid building ID');
  assert.equal(session.exportSave(), before, 'no height teleport, money change, core event, pending-command flush or frame change');
  const remote = world.buildings.find(site => distance(site.door, upper.point) > 100);
  assert.ok(remote);
  assert.equal(session.useDoor(remote.id).ok, false);
  assert.equal(session.exportSave(), before, 'a distant map event cannot authorize a door either');
});

test('invalid elapsed time and movement axes reject before flushing a queued real command', () => {
  const { session } = supportedPair();
  session.queueCommand({ type: 'speed', value: 2 }, 'must-not-flush');
  const before = session.exportSave();
  for (const [seconds, input] of [[-1, { x: 0, z: 0 }], [1.01, { x: 0, z: 0 }], [NaN, { x: 0, z: 0 }], [.25, { x: 2, z: 0 }], [.25, { x: 0, z: Infinity }]] as const) {
    assert.throws(() => session.advance(seconds, input), /real seconds|movement axes/);
    assert.equal(session.exportSave(), before, 'invalid caller input cannot execute pending work or change any clock');
  }
});
