import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { activeAircraft, getAviationPads, setAircraftControls, DRONE_RENTAL_FEE, aircraftBoardingBlockedReason } from '../src/aviation.ts';
import { createWorld } from '../src/world.ts';
import type { AerialVehicle, AviationControls } from '../src/types.ts';

const world = createWorld();
const input = (changes: Partial<AviationControls> = {}): AviationControls => ({ forward: 0, strafe: 0, climb: 0, yaw: 0, pitch: 0, speed: 85, boost: false, ...changes });
const approach = (s: Simulation, craft: AerialVehicle) => { s.state.player.position = { ...craft.position, x: craft.position.x + 2, y: craft.position.y - .6 }; };
const drone = (s: Simulation) => s.state.aviation!.aircraft.find(c => c.kind === 'drone')!;
const boardDrone = (s: Simulation) => {
  const craft = drone(s); approach(s, craft);
  assert.equal(s.command({ type: 'rentAircraft', targetId: craft.id }).ok, true);
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, true);
  return craft;
};

test('aircraft stands are actual clear city locations beside stations and the airport', () => {
  const pads = getAviationPads(world);
  assert(pads.some(p => p.kind === 'rental')); assert(pads.some(p => p.kind === 'military'));
  for (const pad of pads) {
    assert(world.nodes.some(n => n.districtId === pad.districtId && Math.hypot(n.position.x - pad.position.x, n.position.z - pad.position.z) <= 160));
    assert(world.buildings.every(b => Math.abs(pad.position.x - b.position.x) > b.width / 2 + 4 || Math.abs(pad.position.z - b.position.z) > b.depth / 2 + 4));
  }
});

test('remote mode selection cannot rent or board and a real rental transfers cash to public funds', () => {
  const s = new Simulation(world), craft = drone(s);
  s.state.player.position = { x: craft.position.x + 100, y: craft.position.y, z: craft.position.z };
  const cash = s.state.player.money, treasury = s.state.treasury;
  assert.equal(s.command({ type: 'rentAircraft', targetId: craft.id }).ok, false);
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, false);
  assert.equal(s.state.player.money, cash); assert.equal(s.state.treasury, treasury);
  approach(s, craft);
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, false);
  assert.equal(s.command({ type: 'rentAircraft', targetId: craft.id }).ok, true);
  assert.equal(s.state.player.money, cash - DRONE_RENTAL_FEE);
  assert.equal(s.state.treasury, treasury + DRONE_RENTAL_FEE);
  assert.deepEqual(s.state.extension!.publicLedger.at(-1), { tick: s.state.tick, actorId: 'player', amount: DRONE_RENTAL_FEE, purpose: '载人观景无人机租用收入', account: 'public', sourceEvent: 'transit-fare', districtId: getAviationPads(world).find(p => p.id === craft.homePadId)!.districtId });
  assert.equal(s.command({ type: 'rentAircraft', targetId: craft.id }).ok, false);
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, true);
  assert.equal(s.state.player.position.x, craft.position.x);
  assert.equal(s.state.player.vehicleId, null);
});

test('drone flying moves the passenger, uses energy, and requires an actual landing before exiting', () => {
  const s = new Simulation(world), craft = boardDrone(s), origin = { ...craft.position };
  setAircraftControls(s.state, input({ climb: 1 })); s.step(3);
  setAircraftControls(s.state, input({ forward: 1 })); s.step(1);
  assert(craft.position.y > origin.y + 100); assert(Math.hypot(craft.position.x - origin.x, craft.position.z - origin.z) > 30);
  assert(craft.battery < 100); assert.equal(s.state.player.position.x, craft.position.x); assert.equal(s.state.player.position.y, craft.position.y + .3);
  assert.equal(s.command({ type: 'leaveAircraft', targetId: craft.id }).ok, false);
  assert.equal(s.command({ type: 'work' }).ok, false);
  const beforeLanding = { ...craft.position };
  assert.equal(s.command({ type: 'landAircraft' }).ok, true);
  assert.deepEqual(craft.position, beforeLanding);
  for (let second = 0; second < 60 && craft.status !== 'parked'; second++) s.step(1);
  assert.equal(craft.status, 'parked'); assert.equal(craft.padId, craft.homePadId);
  assert.equal(s.command({ type: 'leaveAircraft' }).ok, true); assert.equal(activeAircraft(s.state), undefined);
  assert(Math.hypot(s.state.player.position.x - origin.x, s.state.player.position.z - origin.z) < 6);
  assert.equal(s.command({ type: 'returnAircraft', targetId: craft.id }).ok, true); assert.equal(craft.reserved, false);
});

test('military aircraft checks both accumulated identities and ground weather permission', () => {
  const s = new Simulation(world), craft = s.state.aviation!.aircraft.find(c => c.kind === 'jet')!; approach(s, craft);
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, false);
  s.state.player.identities = ['traveler', 'soldier'];
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, false);
  s.state.player.identities.push('driver'); s.state.weather = '雨';
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, false);
  s.state.weather = '晴'; assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, true);
  const money = s.state.player.money;
  setAircraftControls(s.state, input({ climb: 1 })); s.step(3);
  const position = { ...craft.position }; setAircraftControls(s.state, input()); s.step(.5);
  assert(Math.hypot(craft.position.x - position.x, craft.position.z - position.z) > 20);
  assert.equal(s.state.player.money, money); assert(craft.battery < 100);
});

test('player flight responds in seconds independently of city speed and respects pause', () => {
  const normal = new Simulation(world), fast = new Simulation(world);
  const a = boardDrone(normal), b = boardDrone(fast); fast.command({ type: 'speed', value: 8 });
  setAircraftControls(normal.state, input({ climb: 1 })); setAircraftControls(fast.state, input({ climb: 1 }));
  normal.step(1); fast.step(1); assert.deepEqual(a.position, b.position); assert.equal(a.battery, b.battery);
  normal.command({ type: 'pause', value: 1 }); const parked = { ...a.position }; normal.step(1); assert.deepEqual(a.position, parked);
  normal.command({ type: 'pause', value: 0 }); a.battery = 19; normal.step(.25); assert.equal(a.status, 'landing');
});

test('airborne saves restore identity, passenger and deterministic continuation; bad aircraft references reject atomically', () => {
  const s = new Simulation(world), craft = boardDrone(s); setAircraftControls(s.state, input({ climb: 1 })); s.step(1);
  setAircraftControls(s.state, input({ forward: 1 }));
  const restored = new Simulation(world); assert.equal(restored.importSave(s.exportSave()).ok, true);
  s.step(.5); restored.step(.5); assert.equal(restored.exportSave(), s.exportSave());
  const before = restored.exportSave(), data = JSON.parse(before);
  data.state.aviation.aircraft.find((c: AerialVehicle) => c.id === craft.id).landingPadId = 'missing-pad';
  assert.equal(restored.importSave(JSON.stringify(data)).ok, false); assert.equal(restored.exportSave(), before);
  const mismatch = JSON.parse(before); mismatch.state.player.position.y += 10;
  assert.equal(restored.importSave(JSON.stringify(mismatch)).ok, false); assert.equal(restored.exportSave(), before);
});

test('ground charging consumes real cash and time, and cannot be boarded while charging', () => {
  const s = new Simulation(world), craft = drone(s); approach(s, craft); craft.battery = 70;
  const cash = s.state.player.money, treasury = s.state.treasury;
  assert.equal(s.command({ type: 'refuelAircraft', targetId: craft.id }).ok, true);
  assert.equal(craft.battery, 70); assert.equal(s.state.player.money, cash - 5); assert.equal(s.state.treasury, treasury + 5);
  assert.equal(s.command({ type: 'boardAircraft', targetId: craft.id }).ok, false);
  s.step(1); assert(craft.battery > 70 && craft.battery < 71);
});

test('legacy saves gain the deterministic parked fleet without changing player cash or position', () => {
  const s = new Simulation(world), legacy = JSON.parse(s.exportSave()); delete legacy.state.aviation;
  // A genuinely pre-manifest save can gain a module; a current manifest that
  // declares aviation cannot silently replace a missing persisted fleet.
  delete legacy.runtime.persistedModules;
  const before = { money: legacy.state.player.money, position: legacy.state.player.position };
  assert.equal(s.importSave(JSON.stringify(legacy)).ok, true);
  assert.equal(s.state.aviation!.aircraft.length, getAviationPads(world).length);
  assert.equal(s.state.player.money, before.money); assert.deepEqual(s.state.player.position, before.position);
});

test('a current save declaring aviation rejects a missing fleet without replacing state', () => {
  const s = new Simulation(world), before = s.exportSave(), damaged = JSON.parse(before);
  assert(damaged.runtime.persistedModules.includes('aviation'));
  delete damaged.state.aviation;
  assert.equal(s.importSave(JSON.stringify(damaged)).ok, false);
  assert.equal(s.exportSave(), before);
});

test('small irregular worlds outside the nominal square round-trip their own parked fleet for multiple seeds', () => {
  for (const seed of [1, 1977, 9021]) {
    const mini = {
      seed, voxelSize: .2, size: 200, mountains: [],
      districts: [{ id: 'mini', name: '偏远谷地', kind: 'market', center: { x: 4000, y: 80, z: 0 }, radius: 100, color: '#77aabb', population: 20 }],
      buildings: world.buildings.slice(0, 2).map((b, i) => ({ ...b, id: `mini-${i}`, districtId: 'mini', kind: i ? 'airport' as const : 'home' as const, position: { x: 4000 + i * 50, y: 80, z: 0 }, door: { x: 4000 + i * 50, y: 80.6, z: 6 }, width: 10, depth: 10, height: 12, floors: 2 })),
      nodes: [{ id: 'mini-stop', name: '真实站点', districtId: 'mini', station: true, position: { x: 4000, y: 80.6, z: 20 } }], edges: [], spawn: { x: 4000, y: 80.6, z: 6 },
      waterfall: { top: { x: 5000, y: 100, z: 100 }, bottom: { x: 5000, y: 0, z: 100 }, width: 20 }, river: [{ x: 5000, y: 0, z: 100 }],
    };
    const s = new Simulation(mini), restored = new Simulation(mini);
    assert.equal(restored.importSave(s.exportSave()).ok, true);
    assert.equal(restored.exportSave(), s.exportSave());
    const corrupt = JSON.parse(s.exportSave()); corrupt.state.aviation.aircraft[0].position.x = 9999;
    assert.equal(restored.importSave(JSON.stringify(corrupt)).ok, false);
  }
});

test('rental and ground charging remain visible receipts while event-based treasury reconciliation counts them once', () => {
  const s = new Simulation(world), craft = drone(s); approach(s, craft); craft.battery = 70;
  const beforeTreasury = s.state.treasury, beforeCash = s.state.player.money;
  let observedFares = 0; s.onEvent('transit-fare', event => { observedFares += event.amount ?? 0; });
  assert.equal(s.command({ type: 'rentAircraft', targetId: craft.id }).ok, true);
  assert.equal(s.command({ type: 'refuelAircraft', targetId: craft.id }).ok, true);
  const receipts = s.state.extension!.publicLedger.filter(row => row.account === 'public');
  assert.equal(receipts.length, 2); assert.equal(receipts.reduce((sum, row) => sum + row.amount, 0), 29);
  assert.equal(observedFares, 29);
  const unobservedExplicit = receipts.filter(row => !row.sourceEvent).reduce((sum, row) => sum + row.amount, 0);
  assert.equal(s.state.treasury - beforeTreasury, observedFares + unobservedExplicit);
  assert.equal(beforeCash - s.state.player.money, 29);
  assert.equal(s.state.aviation!.stats.fees, 29);
});


test('onsite boarding eligibility stays read-only and agrees with refused weather, power, battery and identity commands', () => {
  const failures: [string, (s: Simulation, craft: AerialVehicle) => void][] = [
    ['rain', s => { s.state.weather = '雨'; }],
    ['low visibility', s => { s.state.visibility = .34; }],
    ['low energy', s => { s.state.energy = 14; }],
    ['low battery', (_s, craft) => { craft.battery = 29; }],
    ['charging', (_s, craft) => { craft.charging = true; }],
    ['remote body', (s, craft) => { s.state.player.position = { ...craft.position, x: craft.position.x + 7 }; }],
  ];
  for (const [name, change] of failures) {
    const s = new Simulation(world), craft = drone(s); approach(s, craft);
    assert.equal(s.command({ type: 'rentAircraft', targetId: craft.id }).ok, true);
    change(s, craft); const before = s.exportSave(), reason = aircraftBoardingBlockedReason(s.state, craft);
    assert.ok(reason, name); assert.equal(s.exportSave(), before, `${name}: checking eligibility cannot change the city`);
    assert.deepEqual(s.command({ type: 'boardAircraft', targetId: craft.id }), { ok: false, message: reason }, name);
    assert.equal(s.exportSave(), before, `${name}: refusal cannot charge, board or alter the passenger`);
  }
  const s = new Simulation(world), jet = s.state.aviation!.aircraft.find(craft => craft.kind === 'jet')!;
  approach(s, jet); s.state.player.role = 'driver'; s.state.player.identities = ['driver'];
  assert.match(aircraftBoardingBlockedReason(s.state, jet), /卫士和驾驶员/);
  const before = s.exportSave(); assert.equal(s.command({ type: 'boardAircraft', targetId: jet.id }).ok, false); assert.equal(s.exportSave(), before);
  s.state.player.identities.push('soldier'); assert.equal(aircraftBoardingBlockedReason(s.state, jet), '');
  assert.equal(s.command({ type: 'boardAircraft', targetId: jet.id }).ok, true); assert.equal(s.state.aviation!.activeAircraftId, jet.id);
});
