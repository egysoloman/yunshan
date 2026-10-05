import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import type { Building, Citizen, Vec3, WorldDefinition } from '../src/types';

/** Unmarked buildings deliberately isolate the clock from the v4 bed geometry.
 * The normal constructor retains its entire generated roster and accounts. */
function clockWorld(): WorldDefinition {
  const kinds: Building['kind'][] = ['home', 'pavilion', 'clinic', 'school', 'bank'];
  const buildings = kinds.map((kind, i): Building => ({
    id: `clock-${kind}`, name: kind, kind, districtId: 'clock-town',
    position: { x: (i + 1) * 200, y: 0, z: 14 },
    door: { x: (i + 1) * 200, y: 0, z: 20 },
    width: 12, depth: 12, height: 6, floors: 1, rotation: 0, capacity: 40, seed: i + 3,
  }));
  const nodes = [{ id: 'clock-road-start', name: 'start', districtId: 'clock-town', position: { x: 0, y: 0, z: 20 }, station: false },
    ...buildings.map(b => ({ id: `${b.id}-door`, name: b.name, districtId: b.districtId, position: { ...b.door }, station: false }))];
  return {
    seed: 19861, voxelSize: .2, size: 6000,
    districts: [{ id: 'clock-town', name: 'Clock fixture', kind: 'residential', center: { x: 500, y: 0, z: 0 }, radius: 1200, color: '#7799aa', population: 384 }],
    buildings, nodes, edges: nodes.slice(1).map((node, i) => ({
      id: `clock-road-${i}`, from: nodes[i].id, to: node.id, mode: 'road', length: 200, capacity: 20,
      points: [{ ...nodes[i].position }, { ...node.position }],
    })),
    mountains: [], spawn: { x: 0, y: 0, z: 20 },
    waterfall: { top: { x: 2000, y: 30, z: 2000 }, bottom: { x: 2000, y: 0, z: 2000 }, width: 2 },
    river: [{ x: 2000, y: 0, z: 2000 }, { x: 2000, y: 0, z: 2100 }],
  };
}
const world = clockWorld();
interface ClockRuntime {
  activities: Record<string, string>;
  decisionAt: Record<string, number>;
  peopleElapsed?: Record<string, number>;
  riders: Record<string, { vehicleId: string; stopNodeId: string; arrived?: boolean; arrivedAt?: number }>;
}
const runtime = (sim: Simulation): ClockRuntime => Reflect.get(sim, 'runtime');
const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);

function controlledRoute(sim: Simulation, building: Building, activity: string, start: Vec3): Citizen {
  const actor = sim.state.citizens[0];
  // Controlled initial arrival fixture only. All elapsed minutes below come
  // from real step calls; no deferred minutes, attendance or stats are written.
  actor.position = { ...start };
  actor.destinationId = building.id;
  actor.route = [{ ...start }, { ...building.door }];
  actor.routeIndex = 1;
  actor.state = 'moving';
  actor.needs = { hunger: 90, fatigue: 50, social: 50, fun: 50 };
  runtime(sim).activities[actor.id] = activity;
  runtime(sim).decisionAt[actor.id] = sim.state.day * 1440 + sim.state.hour * 60 + 120;
  return actor;
}
function focused(sim: Simulation, actor: Citizen, tier: Citizen['tier']): void {
  const offset = tier === 'active' ? 0 : tier === 'regional' ? 600 : 2000;
  sim.setFocus({ ...actor.position, x: actor.position.x + offset }, 'drone');
  assert.equal(actor.tier, tier);
}
function create(time = 23): Simulation {
  const sim = new Simulation(world);
  assert.equal(sim.command({ type: 'setTime', value: time }).ok, true);
  return sim;
}

test('a final home walk consumes its part of the tick before sleep restores fatigue and fun', () => {
  const sim = create(), home = world.buildings[0];
  const actor = controlledRoute(sim, home, 'rest', { ...home.door, z: home.door.z + .525 });
  focused(sim, actor, 'active');
  const before = { ...actor.needs };
  sim.step(.25);
  assert.equal(actor.state, 'sleeping');
  assert.deepEqual(actor.position, home.door);
  assert.equal(actor.routeIndex, actor.route!.length);
  // .525 metres takes .125 game minutes; only .125 of this real .25 tick remains.
  near(actor.needs.fatigue, before.fatigue - .25 * .035 + .125 * .35, 'only onsite sleep minutes restore fatigue');
  near(actor.needs.fun, before.fun - .25 * .02 + .125 * .07, 'walking minutes do not restore home fun');
  near(actor.needs.hunger, before.hunger - .25 * .05, 'needs still decay during the entire tick');
});

test('a social arrival restores social and fun only for the remaining onsite interval', () => {
  const sim = create(12), pavilion = world.buildings[1];
  const actor = controlledRoute(sim, pavilion, 'social', { ...pavilion.door, z: pavilion.door.z + .525 });
  focused(sim, actor, 'active');
  const before = { ...actor.needs };
  sim.step(.25);
  assert.equal(actor.state, 'socializing');
  assert.deepEqual(actor.position, pavilion.door);
  near(actor.needs.social, before.social - .25 * .015 + .125 * .12, 'social recovery starts after arrival');
  near(actor.needs.fun, before.fun - .25 * .02 + .125 * .09, 'fun recovery starts after arrival');
});

test('a healing arrival does not credit the approach as onsite recovery', () => {
  const sim = create(12), clinic = world.buildings[2];
  const actor = controlledRoute(sim, clinic, 'heal', { ...clinic.door, z: clinic.door.z + .525 });
  // A genuinely injured initial patient, not a fabricated completed treatment.
  sim.state.extension!.actorProfiles[actor.id].health = 55;
  focused(sim, actor, 'active');
  const fatigue = actor.needs.fatigue;
  sim.step(.25);
  assert.equal(actor.state, 'healing');
  assert.deepEqual(actor.position, clinic.door);
  near(actor.needs.fatigue, fatigue - .25 * .035 + .125 * .03, 'healing recovery excludes walking time');
  assert.ok(sim.state.extension!.actorProfiles[actor.id].health < 60, 'arrival alone cannot complete a clinical treatment');
});

function travelling(sim: Simulation): Citizen {
  const actor = controlledRoute(sim, world.buildings[0], 'rest', world.nodes[0].position);
  assert.equal(actor.homeId, world.buildings[0].id);
  return actor;
}

test('tier and speed changes conserve actual elapsed needs and walking minutes, including deferred ticks', () => {
  const sim = create(), actor = travelling(sim), hunger = actor.needs.hunger;
  const startedAt = sim.state.extension!.lastUpdate;
  const schedule: { tier: Citizen['tier']; speed: number; ticks: number }[] = [
    { tier: 'active', speed: 1, ticks: 2 },
    { tier: 'regional', speed: 8, ticks: 3 },
    { tier: 'statistical', speed: 2, ticks: 5 },
    { tier: 'active', speed: 16, ticks: 1 },
    { tier: 'regional', speed: 1, ticks: 4 },
    { tier: 'statistical', speed: 4, ticks: 9 },
    { tier: 'active', speed: 1, ticks: 1 },
  ];
  let totalMinutes = 0;
  const seen = new Set<Citizen['tier']>();
  for (const stage of schedule) {
    focused(sim, actor, stage.tier);
    assert.equal(sim.command({ type: 'speed', value: stage.speed }).ok, true);
    for (let i = 0; i < stage.ticks; i++) {
      sim.step(.25); totalMinutes += .25 * stage.speed; seen.add(actor.tier);
      const observedMinutes = (hunger - actor.needs.hunger) / .05;
      const deferred = runtime(sim).peopleElapsed?.[actor.id] ?? 0;
      near(observedMinutes + deferred, totalMinutes, 'every actual minute is processed once or still deferred');
      near(actor.position.x - world.nodes[0].position.x, observedMinutes * 4.2, 'movement uses exactly the minutes reflected in needs');
      near(actor.needs.fatigue, 50 - observedMinutes * .035, 'travelling never receives sleep recovery');
      assert.equal(actor.state, 'moving');
    }
  }
  assert.deepEqual([...seen].sort(), ['active', 'regional', 'statistical']);
  near(sim.state.extension!.lastUpdate - startedAt, totalMinutes, 'the monotonic city clock is the elapsed source');
  near(runtime(sim).peopleElapsed?.[actor.id] ?? 0, 0, 'the final active tick consumes all deferred time');
});

function deferredFixture() {
  const sim = create(), actor = travelling(sim);
  focused(sim, actor, 'statistical');
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  for (let i = 0; i < 15; i++) sim.step(.25);
  assert.equal(sim.state.tick, 15);
  near(runtime(sim).peopleElapsed![actor.id], 60, 'fifteen real deferred ticks retain sixty actual minutes');
  near(actor.needs.hunger, 90, 'unprocessed needs have not consumed the deferred interval yet');
  assert.deepEqual(actor.position, world.nodes[0].position);
  return { sim, actor };
}

test('real deferred minutes survive save/load and identical tier/speed continuation exactly', () => {
  const { sim, actor } = deferredFixture(), save = sim.exportSave(), restored = new Simulation(world);
  const result = restored.importSave(save);
  assert.equal(result.ok, true, result.message);
  assert.equal(restored.exportSave(), save);
  near(runtime(restored).peopleElapsed![actor.id], 60, 'load retains the unprocessed interval');
  for (let i = 0; i < 12; i++) {
    if (i === 2 || i === 6) {
      const tier = i === 2 ? 'active' : 'regional';
      for (const city of [sim, restored]) {
        focused(city, city.state.citizens[0], tier);
        assert.equal(city.command({ type: 'speed', value: i === 2 ? 1 : 4 }).ok, true);
      }
    }
    sim.step(.25); restored.step(.25);
    assert.equal(restored.exportSave(), sim.exportSave(), `continuation tick ${i + 1}`);
  }
});

test('unknown actor IDs, negative or excessive deferred minutes reject the complete save atomically', () => {
  const { sim, actor } = deferredFixture(), save = sim.exportSave(), target = new Simulation(world);
  const before = target.exportSave();
  const corruptions: [string, (minutes: Record<string, number>) => void][] = [
    ['negative actor ID', minutes => { minutes['citizen--1'] = .25; }],
    ['unknown actor ID', minutes => { minutes['citizen-99999'] = .25; }],
    ['negative elapsed minutes', minutes => { minutes[actor.id] = -.25; }],
    ['over sixty deferred minutes', minutes => { minutes[actor.id] = 60.25; }],
  ];
  for (const [name, corrupt] of corruptions) {
    const candidate = JSON.parse(save);
    corrupt(candidate.runtime.peopleElapsed);
    const result = target.importSave(JSON.stringify(candidate));
    assert.equal(result.ok, false, name);
    assert.match(result.message, /deferred actor (identity|minutes)/, name);
    assert.equal(target.exportSave(), before, `${name}: the rejected candidate must not alter the destination`);
  }
});

/** A long lawful walking route with a faster rail opportunity. Native people
 * boarding pays the fare from the generated wallet; needs/cash are never set.
 * Initial actor placement/activity isolate this route from facility choice. */
function riderWorld(): WorldDefinition {
  const base = clockWorld();
  for (const building of base.buildings) { building.position.x += 800; building.door.x += 800; }
  const start = { id: 'rider-start', name: 'start', districtId: 'clock-town', position: { x: 0, y: 0, z: 20 }, station: false };
  const stop = { id: 'rider-stop', name: 'stop', districtId: 'clock-town', position: { x: 800, y: 0, z: 20 }, station: false };
  const doors = base.buildings.map(building => ({ id: `${building.id}-door`, name: building.name, districtId: building.districtId, position: { ...building.door }, station: false }));
  const street = [start, stop, ...doors];
  base.nodes = street;
  base.edges = street.slice(1).map((node, i) => ({ id: `rider-walk-${i}`, from: street[i].id, to: node.id, mode: 'bridge', length: node.position.x - street[i].position.x, capacity: 20, points: [{ ...street[i].position }, { ...node.position }] }));
  base.edges.push({ id: 'rider-rail', from: start.id, to: stop.id, mode: 'maglev', length: 800, capacity: 20, points: [{ ...start.position }, { ...stop.position }] });
  base.spawn = { ...start.position };
  return base;
}
const cityClock = (sim: Simulation) => sim.state.extension!.lastUpdate;
const displayClock = (sim: Simulation) => sim.state.day * 1440 + sim.state.hour * 60;
function boardedFixture() {
  const world = riderWorld(), sim = new Simulation(world), actor = sim.state.citizens[0], home = world.buildings[0], start = world.nodes[0], stop = world.nodes[1];
  assert(sim.command({ type: 'setTime', value: 23 }).ok);
  actor.position = { ...start.position }; actor.destinationId = home.id;
  actor.route = [{ ...start.position }, { ...home.door }]; actor.routeIndex = 1; actor.state = 'moving';
  runtime(sim).activities[actor.id] = 'rest'; runtime(sim).decisionAt[actor.id] = displayClock(sim) + 10000;
  focused(sim, actor, 'active');
  const wallet = actor.money, needs = { ...actor.needs };
  sim.step(.25);
  const rider = runtime(sim).riders[actor.id];
  assert(rider, 'native people must actually select and board the faster rail opportunity');
  assert.equal(actor.money, wallet - 4, 'native boarding debits its real fare, without fixture funding');
  assert.equal(actor.state, 'riding'); assert.equal(rider.arrived, undefined);
  near(actor.needs.fatigue, needs.fatigue - .25 * .035, 'boarding does not recover fatigue');
  const vehicle = sim.state.vehicles.find(vehicle => vehicle.id === rider.vehicleId)!;
  assert.equal(vehicle.kind, 'maglev'); assert.equal(rider.stopNodeId, stop.id);
  return { sim, actor, home, stop, vehicle, world };
}
function naturallyArrivedDeferred() {
  const fixture = boardedFixture(), { sim, actor } = fixture;
  focused(sim, actor, 'statistical'); assert(sim.command({ type: 'speed', value: 16 }).ok);
  for (let count = 0; !runtime(sim).riders[actor.id]?.arrived && count < 14; count++) sim.step(.25);
  const rider = runtime(sim).riders[actor.id];
  assert(rider?.arrived, 'the actual rail endpoint must be observed before the next actor update');
  assert.equal(rider.arrivedAt, cityClock(sim));
  assert(sim.state.tick < 16); assert.equal(actor.state, 'riding');
  return fixture;
}

test('a native rail arrival has zero post-arrival movement in its discrete traffic tick', () => {
  const { sim, actor, stop } = boardedFixture();
  assert(sim.command({ type: 'speed', value: 16 }).ok);
  let arrival: { needs: Citizen['needs']; minutes: number } | null = null;
  sim.onPhase('traffic', (_state, minutes) => {
    const rider = runtime(sim).riders[actor.id];
    if (rider?.arrived && !arrival) { assert.equal(rider.arrivedAt, cityClock(sim)); arrival = { needs: { ...actor.needs }, minutes }; }
  });
  for (let count = 0; !arrival && count < 14; count++) sim.step(.25);
  assert(arrival, 'native traffic must reach the endpoint');
  const observed = arrival as { needs: Citizen['needs']; minutes: number };
  assert.deepEqual(actor.position, stop.position, 'no fractional-tick overshoot is invented after the discrete endpoint');
  assert.equal(actor.state, 'moving'); assert.equal(runtime(sim).riders[actor.id], undefined);
  near(actor.needs.fatigue, observed.needs.fatigue - observed.minutes * .035, 'the arrival tick only decays fatigue');
  const from = { ...actor.position }; sim.step(.25);
  near(actor.position.x - from.x, 4 * 4.2, 'a later actual four-minute tick supplies the walking budget');
});

test('sixteen real deferred ticks cannot reuse ride time after an endpoint observed on the final tick', () => {
  const { sim, actor, stop, vehicle } = boardedFixture();
  // Controlled, schema-valid initial vehicle timetable/progress only. This
  // forces the endpoint on tick 32; it is not evidence of a natural city trip.
  // The rider, payment, clocks, pending minutes and needs remain native.
  while (sim.state.tick < 16) sim.step(.25);
  assert(runtime(sim).riders[actor.id] && !runtime(sim).riders[actor.id].arrived);
  vehicle.progress = .9999; vehicle.position = { ...stop.position, x: stop.position.x * vehicle.progress };
  vehicle.nextDeparture = displayClock(sim) + 64;
  focused(sim, actor, 'statistical'); assert(sim.command({ type: 'speed', value: 16 }).ok);
  const before = { ...actor.needs }, started = cityClock(sim);
  for (let count = 0; count < 15; count++) sim.step(.25);
  near(runtime(sim).peopleElapsed![actor.id], 60, 'fifteen skipped fixed ticks retain sixty real minutes');
  assert(!runtime(sim).riders[actor.id].arrived);
  sim.step(.25);
  near(cityClock(sim) - started, 64, 'the update covers sixteen actual four-minute ticks');
  assert.deepEqual(actor.position, stop.position, 'all sixty-four minutes were aboard until this endpoint observation');
  near(actor.needs.fatigue, before.fatigue - 64 * .035, 'ride time decays needs without onsite sleep credit');
  near(actor.needs.fun, before.fun - 64 * .02, 'ride time supplies no home fun');
  focused(sim, actor, 'active'); assert(sim.command({ type: 'speed', value: 1 }).ok);
  sim.step(.25);
  near(actor.position.x - stop.position.x, .25 * 4.2, 'only the new quarter-minute can be walked');
});

test('a stopped vehicle within forty metres cannot teleport an unarrived passenger to the stop', () => {
  const { sim, actor, vehicle, stop } = boardedFixture();
  // Controlled stopped-near-endpoint snapshot, retaining the native paid rider.
  vehicle.progress = .98; vehicle.position = { ...stop.position, x: stop.position.x * vehicle.progress };
  vehicle.nextDeparture = displayClock(sim) + 10;
  sim.step(.25);
  assert.equal(vehicle.state, 'waiting'); assert.equal(actor.state, 'riding');
  assert.deepEqual(actor.position, vehicle.position);
  assert(runtime(sim).riders[actor.id]); assert.equal(runtime(sim).riders[actor.id].arrived, undefined);
  assert(Math.hypot(actor.position.x - stop.position.x, actor.position.z - stop.position.z) > 1);
});

test('a deferred observed arrival survives tier and speed changes without backfilling its ride interval', () => {
  const { sim, actor, stop } = naturallyArrivedDeferred();
  const rider = runtime(sim).riders[actor.id], before = { ...actor.needs }, pending = runtime(sim).peopleElapsed![actor.id], start = cityClock(sim);
  focused(sim, actor, 'active'); assert(sim.command({ type: 'speed', value: 2 }).ok);
  sim.step(.25);
  const elapsed = pending + .5, afterArrival = cityClock(sim) - rider.arrivedAt!;
  near(cityClock(sim) - start, .5, 'the speed change supplies only one new half-minute');
  near(actor.position.x - stop.position.x, afterArrival * 4.2, 'walking uses only minutes after the observed arrival');
  near(actor.needs.fatigue, before.fatigue - elapsed * .035, 'needs still consume the entire deferred ride interval once');
  assert.equal(actor.state, 'moving'); assert.equal(runtime(sim).peopleElapsed?.[actor.id], undefined);
});

test('an observed deferred arrival saves exactly and continues identically for twenty-four ticks', () => {
  const { sim, world } = naturallyArrivedDeferred(), save = sim.exportSave(), copy = new Simulation(world);
  assert(copy.importSave(save).ok); assert.equal(copy.exportSave(), save);
  for (let count = 0; count < 24; count++) { sim.step(.25); copy.step(.25); assert.equal(copy.exportSave(), sim.exportSave(), `rider continuation tick ${count + 1}`); }
});

test('legacy arrived records migrate at the imported clock and malformed arrival clocks reject atomically', () => {
  const { sim, actor, world, stop } = naturallyArrivedDeferred(), saved = sim.exportSave(), valid = JSON.parse(saved), target = new Simulation(world), unchanged = target.exportSave();
  const corruptions: ((candidate: typeof valid) => void)[] = [
    candidate => { candidate.runtime.riders[actor.id].arrivedAt = -.25; },
    candidate => { candidate.runtime.riders[actor.id].arrivedAt = candidate.state.extension.lastUpdate + .25; },
    candidate => { candidate.runtime.riders[actor.id].arrivedAt = 'now'; },
    candidate => { candidate.runtime.riders[actor.id].arrivedAt = null; },
    candidate => { candidate.runtime.riders[actor.id].arrived = false; },
    candidate => { delete candidate.runtime.riders[actor.id].arrived; },
  ];
  for (const corrupt of corruptions) { const candidate = JSON.parse(saved); corrupt(candidate); assert.equal(target.importSave(JSON.stringify(candidate)).ok, false); assert.equal(target.exportSave(), unchanged); }
  delete valid.runtime.riders[actor.id].arrivedAt;
  valid.state.paused = true;
  const legacy = JSON.stringify(valid); assert(target.importSave(legacy).ok);
  assert.equal(target.exportSave(), legacy, 'import and immediate export preserve the complete legacy JSON and manifest byte-for-byte');
  target.step(.25); assert.equal(target.exportSave(), legacy, 'paused real time cannot materialize an arrival field');
  const data = JSON.parse(target.exportSave());
  assert.equal(data.worldFingerprint, valid.worldFingerprint); assert.deepEqual(data.state.voxels, valid.state.voxels);
  assert.deepEqual(data.state.citizens, valid.state.citizens, 'migration never changes an actor wallet, needs, position or route');
  assert.equal(runtime(target).riders[actor.id].arrivedAt, undefined);
  const loadedAt = cityClock(target);
  const rejected = JSON.parse(legacy); rejected.state.extension.lastUpdate += 100; rejected.runtime.peopleElapsed[actor.id] = -.25;
  assert.equal(target.importSave(JSON.stringify(rejected)).ok, false, 'a later candidate failure cannot change the live rider observation');
  assert.equal(target.exportSave(), legacy);
  const restoredActor = target.state.citizens.find(person => person.id === actor.id)!, before = { ...restoredActor.needs }, pending = runtime(target).peopleElapsed![actor.id];
  assert(target.command({ type: 'pause', value: 0 }).ok);
  assert(target.command({ type: 'setTime', value: target.state.hour }).ok);
  focused(target, restoredActor, 'active'); assert(target.command({ type: 'speed', value: 1 }).ok);
  assert.equal(runtime(target).riders[actor.id].arrivedAt, undefined, 'commands and the manual display clock do not materialize an arrival field');
  const baseline = target.exportSave(), copy = new Simulation(world); assert(copy.importSave(baseline).ok); assert.equal(copy.exportSave(), baseline);
  let observed = false;
  target.onPhase('traffic', () => { if (!observed) { assert.equal(runtime(target).riders[actor.id].arrivedAt, loadedAt); near(cityClock(target) - loadedAt, .25, 'the first traffic phase follows only real post-load minutes'); observed = true; } });
  target.step(.25); copy.step(.25);
  assert(observed, 'a readonly traffic observer verifies the old arrival clock before people consumes it');
  near(restoredActor.position.x - stop.position.x, .25 * 4.2, 'legacy arrival cannot recover unproven prior walking time');
  near(restoredActor.needs.fatigue, before.fatigue - (pending + .25) * .035, 'legacy pending needs decay exactly once');
  assert.equal(copy.exportSave(), target.exportSave());
  for (let count = 0; count < 24; count++) { target.step(.25); copy.step(.25); assert.equal(copy.exportSave(), target.exportSave()); }

  const delayed = new Simulation(world); assert(delayed.importSave(legacy).ok); assert.equal(delayed.exportSave(), legacy);
  assert(delayed.command({ type: 'pause', value: 0 }).ok); assert(delayed.command({ type: 'speed', value: 1 }).ok);
  assert.equal(delayed.state.citizens[0].tier, 'statistical');
  delayed.step(.25);
  assert(runtime(delayed).riders[actor.id], 'the first post-load tick still defers the statistical actor');
  assert.equal(runtime(delayed).riders[actor.id].arrivedAt, loadedAt, 'the first real traffic phase persists the imported observation clock');
  near(cityClock(delayed) - loadedAt, .25, 'one real post-load quarter-minute has elapsed');
  const delayedSave = delayed.exportSave(), reimported = new Simulation(world); assert(reimported.importSave(delayedSave).ok); assert.equal(reimported.exportSave(), delayedSave);
  const delayedBefore = { ...delayed.state.citizens[0].needs }, delayedPending = runtime(delayed).peopleElapsed![actor.id];
  for (const city of [delayed, reimported]) focused(city, city.state.citizens[0], 'active');
  delayed.step(.25); reimported.step(.25);
  near(delayed.state.citizens[0].position.x - stop.position.x, .5 * 4.2, 'save/reimport retains both proven post-load quarter-minutes');
  near(delayed.state.citizens[0].needs.fatigue, delayedBefore.fatigue - (delayedPending + .25) * .035, 'reimport never repeats deferred needs decay');
  assert.equal(reimported.exportSave(), delayed.exportSave());
  for (let count = 0; count < 24; count++) { delayed.step(.25); reimported.step(.25); assert.equal(reimported.exportSave(), delayed.exportSave()); }
});
