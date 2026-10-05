import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// PREPARED ONLY. Running this file requires a new explicit GO from root.
// It imports a frozen Simulation only at execution time, never world.ts.
const directory = dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
assert(['before09', 'after10'].includes(label), 'choose exactly before09 or after10');
const source = `/tmp/yunshan-system-coherent-${label === 'before09' ? '09' : '10'}/source`;
const output = join(directory, 'runs', label);
const clone = value => JSON.parse(JSON.stringify(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (name, value) => writeFileSync(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const geometry = JSON.parse(readFileSync(join(directory, 'geometry-original.json'), 'utf8'));
const nativeHome = JSON.parse(readFileSync(join(directory, 'west-b13-native.json'), 'utf8'));
const load = name => import(pathToFileURL(join(source, name)).href);
const result = {
  status: 'RUNNING', label, source, startedAt: new Date().toISOString(),
  scope: 'Five-building controlled initialization; exact native west-b13 recipe; native 384 citizens; real rent/build commands; actual people recovery and save+24. No ordinary Controller journey, whole default city, renderer, GPU or general route-collision claim.',
  controls: ['small five-building world using the exact native home record and four unmarked public recipes', 'native setTime command to 23:00', 'one native adult initial position q and completed route at canonical p, state sleeping, activity rest, decisionAt 25:00', 'player/focus setFocus at the real service and legal a; no ordinary W journey claim'],
  prohibitions: ['no role, age, needs, money or health injection', 'no clearing citizens, voxels, beds or native pending minutes', 'no direct voxel snapshot insertion or material debit', 'no source/test/timeout modification'],
  geometrySHA256: sha(readFileSync(join(directory, 'geometry-original.json'))),
  nativeHomeSHA256: sha(readFileSync(join(directory, 'west-b13-native.json'))),
  realStepCalls: 0, simulationConstructions: 0, behaviorFailures: [], saves: [],
};
let sim;
let stage = 'native-recipe-input';
function saved(name, instance = sim) { const json = instance.exportSave(); write(name, json); result.saves.push({ name, bytes: Buffer.byteLength(json), sha256: sha(json) }); return json; }
function blocked(position, voxels) {
  // Independent unchanged player oracle, available on old09 without requiring
  // the new export and masking the actual erroneous people behavior.
  return voxels.some(v => {
    if (v.position.y + .1 <= position.y + .01 || v.position.y - .1 >= position.y + 1.72) return false;
    const dx = Math.max(Math.abs(v.position.x - position.x) - .1, 0), dz = Math.max(Math.abs(v.position.z - position.z) - .1, 0);
    return dx * dx + dz * dz < .35 * .35 - 1e-7;
  });
}
function step(instance) { instance.step(.25); result.realStepCalls++; }
function behavior(name, assertion) {
  try { assertion(); }
  catch (error) { const failure = { name, message: error.message }; result.behaviorFailures.push(failure); console.error(`BEHAVIOR_FAIL ${name}: ${error.message}`); }
}
function smallWorld(home) {
  const kinds = ['pavilion', 'clinic', 'school', 'bank'];
  const buildings = [home, ...kinds.map((kind, i) => ({ id: `command-${kind}`, districtId: home.districtId, name: kind, kind,
    position: { x: home.position.x + (i + 1) * 120, y: home.position.y, z: home.position.z }, width: 20, depth: 20, height: 6, floors: 1,
    rotation: 0, door: { x: home.position.x + (i + 1) * 120, y: home.position.y + .6, z: home.position.z + 10 }, capacity: 50, seed: i + 7 }))];
  const nodes = buildings.flatMap(b => [
    { id: `${b.id}-door`, name: b.name, districtId: home.districtId, position: clone(b.door), station: false },
    { id: `${b.id}-street`, name: b.name, districtId: home.districtId, position: { x: b.position.x, y: home.position.y + .6, z: home.position.z + 35 }, station: false },
  ]);
  const edges = buildings.map((b, i) => ({ id: `command-door-${b.id}`, from: nodes[i * 2].id, to: nodes[i * 2 + 1].id, mode: 'road',
    length: distance(nodes[i * 2].position, nodes[i * 2 + 1].position), capacity: 20, points: [nodes[i * 2].position, nodes[i * 2 + 1].position] }));
  for (let i = 1; i < buildings.length; i++) edges.push({ id: `command-street-${i}`, from: nodes[i * 2 - 1].id, to: nodes[i * 2 + 1].id,
    mode: 'road', length: 120, capacity: 20, points: [nodes[i * 2 - 1].position, nodes[i * 2 + 1].position] });
  return { seed: 911, voxelSize: .2, size: 4000, buildings, nodes, edges,
    districts: [{ id: home.districtId, name: '原生西城床侧命令受控回归', kind: 'market', center: clone(home.position), radius: 1200, color: '#888888', population: 384 }],
    spawn: clone(home.door), mountains: [], river: [], waterfall: { top: { x: 1800, y: 100, z: 1800 }, bottom: { x: 1800, y: 0, z: 1800 }, width: 10 } };
}

try {
  const rawWorld = readFileSync('/tmp/yunshan-current-city-map-01/world-native.json');
  assert.equal(sha(rawWorld), 'a054d6592de8383222caa5174a726cdbce25fbef36fbb2456ee3bb84c667d1e8');
  assert.deepEqual(nativeHome, JSON.parse(rawWorld).buildings.find(b => b.id === 'west-b13'), 'copy the full original native recipe, including exact function point floats');
  assert.equal(sha(readFileSync(join(directory, 'geometry-original.json'))), 'c0ce313693c181fa2761a9960350c0d1477f5068d6fa7a319ce4c46424220287');
  const best = geometry.best, p = best.canonical, q = best.q, a = best.a, v = best.v;
  assert.equal(best.buildingId, nativeHome.id); assert.equal(best.voxelHeightOffsetM, .2);
  assert.equal(v.y, 286.8, 'use original +.2m target, never the unsupported +.8m alternative');
  const [{ Simulation }, architecture, rest, { canAccessFloor }, { savedWorldFingerprint }] = await Promise.all([
    load('src/simulation.ts'), load('src/architecture-floor-plan.ts'), load('src/simulation/home-rest.ts'), load('src/access.ts'), load('src/persistence/world-layout.ts'),
  ]);
  const world = smallWorld(clone(nativeHome)), worldJSON = JSON.stringify(world), fingerprint = savedWorldFingerprint(world);
  sim = new Simulation(world); result.simulationConstructions++;
  const home = sim.worldDefinition.buildings[0], runtime = () => Reflect.get(sim, 'runtime');
  assert.deepEqual(home, nativeHome); assert.equal(sim.state.citizens.length, 384); assert.equal(sim.state.voxels.length, 0);
  const nativeCitizens = sim.state.citizens.map(c => ({ id: c.id, role: c.role, money: c.money, needs: clone(c.needs), homeId: c.homeId }));
  const nativePlayer = { money: sim.state.player.money, block: sim.state.player.inventory.block, role: sim.state.player.role, identities: clone(sim.state.player.identities) };
  assert.equal(nativePlayer.money, 600); assert.equal(nativePlayer.block, 32); assert.equal(nativePlayer.role, 'traveler');
  const service = home.functionPoints.find(point => point.floor === 0 && point.purpose === 'service');
  assert(service); assert.deepEqual(service.position, best.service.position);
  const point = rest.homeRestPoints(home, 0).find(point => point.id === best.pointId);
  assert(point); assert.deepEqual(point.position, p);
  function supported(position) {
    const support = architecture.floorPlanSupport(home, 0, position, .35);
    assert(support && support.kind === 'room' && support.floor === 0);
    near(position.y, support.y, 'whole-body standing floor');
    assert(!architecture.blocksFloorPlanMovement(home, 0, position, position, .35, 1.72));
    return support;
  }
  stage = 'native-rent';
  supported(service.position); sim.setFocus(service.position, 'walk');
  assert(sim.isAtBuildingFunctionPoint(home, sim.state.player.position, 'service'));
  saved('before-rent.json'); const rented = sim.command({ type: 'rent', targetId: home.id }); result.rent = rented;
  saved('after-rent.json'); assert(rented.ok, rented.message);
  assert.equal(sim.state.player.homeId, home.id); assert.equal(sim.state.player.money, nativePlayer.money - 80);
  assert.equal(sim.state.player.inventory.block, nativePlayer.block); assert.equal(sim.state.player.role, nativePlayer.role);
  assert.deepEqual(sim.state.player.identities, nativePlayer.identities);

  stage = 'controlled-clear-native-bedside';
  assert(sim.command({ type: 'setTime', value: 23 }).ok);
  const actor = sim.state.citizens.find(c => sim.state.extension.actorProfiles[c.id].age >= 18);
  assert(actor); const id = actor.id, nativeActor = nativeCitizens.find(c => c.id === id);
  const person = () => { const role = Reflect.get(sim, 'citizenIdentity').call(sim, sim.state.citizens.find(c => c.id === id)); return { role, identities: [role] }; };
  supported(q); assert(canAccessFloor(home, 0, person()));
  assert.equal(rest.homeRestPointAt(home, q, person(), point.id)?.id, point.id);
  assert(distance(p, q) <= .4 + 1e-7);
  actor.position = clone(q); actor.destinationId = home.id; actor.route = [clone(p), clone(p)]; actor.routeIndex = 2; actor.state = 'sleeping';
  runtime().activities[id] = 'rest'; runtime().decisionAt[id] = 23 * 60 + 120;
  sim.setFocus(a, 'walk'); assert.equal(actor.tier, 'active');
  assert.deepEqual(actor.needs, nativeActor.needs); assert.equal(actor.money, nativeActor.money); assert.equal(actor.role, nativeActor.role);
  assert.deepEqual(sim.state.citizens.map(c => ({ id: c.id, role: c.role, money: c.money, needs: clone(c.needs), homeId: c.homeId })), nativeCitizens);
  const controlledSave = saved('controlled-clear-before-tick.json');
  const initialImported = sim.importSave(controlledSave); assert(initialImported.ok, initialImported.message); assert.equal(sim.exportSave(), controlledSave);
  let current = sim.state.citizens.find(c => c.id === id);
  assert(!blocked(current.position, sim.state.voxels)); assert(!blocked(p, sim.state.voxels));
  const clearNeeds = clone(current.needs); assert(clearNeeds.fatigue < 99 && clearNeeds.fun < 99, 'native measurable headroom');
  step(sim); near(current.needs.fatigue, clearNeeds.fatigue - .25 * .035 + .25 * .35, 'actual clear quarter-minute sleep recovery');
  near(current.needs.fun, clearNeeds.fun - .25 * .02 + .25 * .07, 'actual clear quarter-minute fun recovery');
  assert.deepEqual(current.position, q); assert.deepEqual(current.route.at(-1), p); assert.equal(current.state, 'sleeping');
  saved('clear-after-tick-before-build.json');

  stage = 'actual-native-build';
  sim.setFocus(a, 'walk'); supported(sim.state.player.position);
  const serviceDistance = distance(sim.state.player.position, service.position);
  assert(serviceDistance <= 2, 'strict native service gate, no EPS enlargement or coordinate adjustment');
  assert(sim.isAtBuildingFunctionPoint(home, sim.state.player.position)); assert(sim.isNearBuilding(home, v, 12));
  assert(canAccessFloor(home, 0, sim.state.player));
  const requestedPosition = clone(v), actualQuantized = Object.fromEntries(Object.entries(v).map(([axis, value]) => [axis, Math.round(value / .2) * .2]));
  assert(distance(a, actualQuantized) <= 4); assert(sim.isNearBuilding(home, actualQuantized, 12));
  assert.equal(sim.state.voxels.length, 0); assert.equal(sim.state.player.inventory.block, 32);
  const beforeBuild = saved('before-build.json'), constructionId = runtime().constructionId;
  const citizensBeforeBuild = JSON.stringify(sim.state.citizens);
  const built = sim.command({ type: 'build', targetId: home.id, position: requestedPosition }); result.build = built;
  const afterBuild = saved('after-build.json');
  result.buildEvidence = { requestedPosition, actualQuantized, serviceDistanceM: serviceDistance, buildDistanceM: distance(a, actualQuantized),
    beforeMaterials: 32, afterMaterials: sim.state.player.inventory.block, beforeConstructionId: constructionId, afterConstructionId: runtime().constructionId,
    voxels: clone(sim.state.voxels), rejectionAtomic: !built.ok && afterBuild === beforeBuild };
  assert(built.ok, built.message); assert.equal(sim.state.player.inventory.block, 31);
  assert.equal(JSON.stringify(sim.state.citizens), citizensBeforeBuild, 'actual build command cannot edit any native NPC position/route/needs/cash');
  assert.equal(runtime().constructionId, constructionId + 1); assert.equal(sim.state.voxels.length, 1);
  assert.equal(sim.state.voxels[0].id, `voxel-${constructionId + 1}`); assert.deepEqual(sim.state.voxels[0].position, actualQuantized);
  assert.equal(sim.state.player.money, nativePlayer.money - 80); assert.equal(sim.state.player.role, nativePlayer.role);
  assert.deepEqual(sim.state.player.identities, nativePlayer.identities);
  assert(!blocked(p, sim.state.voxels), 'actual written voxel leaves the canonical bed side clear');
  assert(blocked(current.position, sim.state.voxels), 'actual written voxel blocks actual q standing body');
  assert.equal(rest.homeRestPointAt(home, current.position, person(), point.id)?.id, point.id);
  if (typeof rest.homeRestPointBlockedByVoxels === 'function') {
    assert.equal(rest.homeRestPointBlockedByVoxels(p, sim.state.voxels), false);
    assert.equal(rest.homeRestPointBlockedByVoxels(q, sim.state.voxels), true);
  }
  const buildImported = sim.importSave(afterBuild); assert(buildImported.ok, buildImported.message); assert.equal(sim.exportSave(), afterBuild, 'real built-voxel save imports/exports byte-exact');
  current = sim.state.citizens.find(c => c.id === id);

  stage = 'blocked-actual-people-tick';
  const beforeNeeds = clone(current.needs), beforeMoney = current.money;
  step(sim); saved('blocked-after-actual-tick.json');
  result.actor = { id, age: sim.state.extension.actorProfiles[id].age, role: current.role, moneyBefore: beforeMoney, moneyAfter: current.money,
    p: clone(p), q: clone(q), position: clone(current.position), routeEnd: clone(current.route.at(-1)), state: current.state,
    destinationId: current.destinationId, beforeNeeds, afterNeeds: clone(current.needs), actualMinutes: .25,
    expectedDecayOnly: { fatigue: beforeNeeds.fatigue - .25 * .035, fun: beforeNeeds.fun - .25 * .02 } };
  assert.deepEqual(current.position, q); assert.deepEqual(current.route.at(-1), p, 'canonical target remains unchanged and clear; isolate final body guard');
  assert.equal(current.money, beforeMoney); assert.equal(blocked(p, sim.state.voxels), false); assert.equal(blocked(q, sim.state.voxels), true);
  behavior('blocked-actual-body-fatigue', () => near(current.needs.fatigue, beforeNeeds.fatigue - .25 * .035, 'blocked actual standing body cannot receive sleep recovery'));
  behavior('blocked-actual-body-fun', () => near(current.needs.fun, beforeNeeds.fun - .25 * .02, 'blocked actual standing body cannot receive fun recovery'));
  behavior('blocked-actual-body-state', () => assert.equal(current.state, 'unreachable'));
  behavior('blocked-actual-body-destination', () => assert.equal(current.destinationId, null));

  stage = 'real-save-plus24';
  const continuationSave = saved('continuation-start.json'), voxels = clone(sim.state.voxels), playerMoney = sim.state.player.money;
  const homes = sim.state.citizens.map(c => c.homeId);
  const copy = new Simulation(sim.worldDefinition); result.simulationConstructions++;
  const imported = copy.importSave(continuationSave); assert(imported.ok, imported.message); assert.equal(copy.exportSave(), continuationSave);
  const points = Array.from({ length: home.floors }, (_, floor) => rest.homeRestPoints(home, floor)).flat();
  const assertReservations = instance => {
    const reserved = new Set();
    for (const resident of instance.state.citizens) {
      if (resident.destinationId !== home.id || Reflect.get(instance, 'runtime').activities[resident.id] !== 'rest') continue;
      const target = resident.route?.at(-1); if (!target) continue;
      const reservedPoint = points.find(p => distance(p.position, target) < 1e-8); if (!reservedPoint) continue;
      assert(!reserved.has(reservedPoint.bedId), 'different bed sides cannot create overlapping native reservations'); reserved.add(reservedPoint.bedId);
    }
  };
  assertReservations(sim);
  for (let i = 0; i < 24; i++) {
    step(sim); step(copy); assert.equal(copy.exportSave(), sim.exportSave(), `actual continuation tick ${i + 1} must be byte-exact`);
    assertReservations(sim); assert.deepEqual(sim.state.voxels, voxels, 'never clear built voxels');
  }
  assert.equal(sim.state.player.money, playerMoney); assert.equal(sim.state.player.inventory.block, 31);
  assert.deepEqual(sim.state.citizens.map(c => c.homeId), homes); assert.equal(sim.state.citizens.length, 384);
  assert.equal(savedWorldFingerprint(world), fingerprint); assert.equal(JSON.stringify(world), worldJSON, 'do not rewrite geometry or native home recipe');
  saved('continued24.json'); result.continuation = { ticks: 24, exact: true, originalVoxelsRetained: true, nativeCitizens: 384, worldFingerprint: fingerprint };
  result.status = result.behaviorFailures.length ? 'BEHAVIOR_FAIL' : 'PASS';
  if (result.behaviorFailures.length) process.exitCode = 1;
} catch (error) {
  result.status = 'PRECONDITION_OR_CONTRACT_FAIL'; result.failure = { stage, name: error.name, message: error.message, stack: error.stack };
  if (sim) saved('failed-current.json'); console.error(error.stack); process.exitCode = 1;
} finally {
  result.endedAt = new Date().toISOString(); result.lastStage = stage; write('result.json', result); console.log(JSON.stringify(result));
}
