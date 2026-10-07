import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity } from '../src/product-city';
import { blocksFloorPlanReferenceMovement, floorPlanSupport, getBuildingEntrance, getBuildingUsePoints } from '../src/architecture-floor-plan';
import type { Building, Citizen, Vec3, WorldDefinition } from '../src/types';

/** Controlled initial test cities, not observations of a natural main save.
 * Only initial body/needs/activity, the child guard's age and carried food are
 * assigned below. Constructors retain all 384 actors, original professions,
 * wallets, firms and finite stock. Deferred minutes arise solely from step(). */
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
interface MealRuntime {
  activities: Record<string, string>;
  decisionAt: Record<string, number>;
  peopleElapsed?: Record<string, number>;
}
const runtime = (sim: Simulation): MealRuntime => Reflect.get(sim, 'runtime');
const clock = (sim: Simulation) => sim.state.extension!.lastUpdate;

function clockWorld(): WorldDefinition {
  const buildings = (['home', 'market'] as const).map((kind, index): Building => ({
    id: `urgent-clock-${kind}`, name: kind, kind, districtId: 'urgent-town',
    position: { x: (index + 1) * 200, y: 0, z: 14 },
    door: { x: (index + 1) * 200, y: 0, z: 20 },
    width: 12, depth: 12, height: 6, floors: 1, rotation: 0, capacity: 40, seed: index + 3,
  }));
  const nodes = [{ id: 'urgent-road-start', name: 'start', districtId: 'urgent-town', position: { x: 0, y: 0, z: 20 }, station: false },
    ...buildings.map(building => ({ id: `${building.id}-door`, name: building.name, districtId: building.districtId, position: { ...building.door }, station: false }))];
  return {
    seed: 19862, voxelSize: .2, size: 6000,
    districts: [{ id: 'urgent-town', name: 'Controlled meal clock', kind: 'residential', center: { x: 300, y: 0, z: 0 }, radius: 1200, color: '#7799aa', population: 384 }],
    buildings, nodes, edges: nodes.slice(1).map((node, index) => ({
      id: `urgent-walk-${index}`, from: nodes[index].id, to: node.id, mode: 'bridge', length: 200, capacity: 20,
      points: [{ ...nodes[index].position }, { ...node.position }],
    })),
    mountains: [], spawn: { ...nodes[0].position },
    waterfall: { top: { x: 2000, y: 30, z: 2000 }, bottom: { x: 2000, y: 0, z: 2000 }, width: 2 },
    river: [{ x: 2000, y: 0, z: 2000 }, { x: 2000, y: 0, z: 2100 }],
  };
}

/** A real v4 market has supported rooms, solid fixtures and public sale points.
 * Short ordinary roads do not generate vehicles; there is no producer/freight
 * source that could replenish the original finite retail stock during a sale. */
function counterWorld(): WorldDefinition {
  const world = clockWorld();
  world.seed = 19863;
  world.buildings = (['home', 'market'] as const).map((kind, index): Building => ({
    id: `urgent-counter-${kind}`, name: kind, kind, districtId: 'urgent-town',
    position: { x: index * 60, y: 0, z: 0 }, door: { x: index * 60, y: .6, z: kind === 'market' ? 16 : 6 },
    width: kind === 'market' ? 40 : 12, depth: kind === 'market' ? 32 : 12,
    height: kind === 'market' ? 12 : 6, floors: kind === 'market' ? 3 : 1,
    rotation: 0, capacity: 50, seed: index + 7,
  }));
  const market = world.buildings[1];
  market.floorPlanProfile = 'v4-program-bodies-02';
  market.door = getBuildingEntrance(market);
  market.functionPoints = Array.from({ length: market.floors }, (_, floor) => getBuildingUsePoints(market, floor)).flat();
  world.nodes = world.buildings.flatMap(building => [
    { id: `${building.id}-door`, name: building.name, districtId: building.districtId, position: { ...building.door }, station: false },
    { id: `${building.id}-street`, name: building.name, districtId: building.districtId, position: { x: building.position.x, y: .6, z: 35 }, station: false },
  ]);
  world.edges = world.buildings.map((building, index) => ({
    id: `${building.id}-road`, from: world.nodes[index * 2].id, to: world.nodes[index * 2 + 1].id,
    mode: 'road', length: distance(world.nodes[index * 2].position, world.nodes[index * 2 + 1].position), capacity: 20,
    points: [{ ...world.nodes[index * 2].position }, { ...world.nodes[index * 2 + 1].position }],
  }));
  world.edges.push({ id: 'urgent-counter-street', from: world.nodes[1].id, to: world.nodes[3].id, mode: 'road', length: 60, capacity: 20,
    points: [{ ...world.nodes[1].position }, { ...world.nodes[3].position }] });
  world.spawn = { ...world.nodes[1].position };
  return world;
}

function controlledRoute(sim: Simulation, actorIndex: number, building: Building, activity: string, hunger: number, start: Vec3, goal = building.door): Citizen {
  const actor = sim.state.citizens[actorIndex];
  actor.position = { ...start };
  actor.destinationId = building.id;
  actor.route = [{ ...start }, { ...goal }];
  actor.routeIndex = 1;
  actor.state = 'moving';
  actor.needs = { hunger, fatigue: 90, social: 90, fun: 90 };
  runtime(sim).activities[actor.id] = activity;
  runtime(sim).decisionAt[actor.id] = sim.state.day * 1440 + sim.state.hour * 60 + 120;
  return actor;
}
function statistical(sim: Simulation, actor: Citizen): void {
  sim.setFocus({ ...actor.position, x: actor.position.x + 2000 }, 'drone');
  assert.equal(actor.tier, 'statistical');
  assert.equal(sim.state.citizens.length, 384);
  assert.equal(sim.state.speed, 1);
  assert.equal(sim.state.weather, '晴', 'the eighty-metre approach uses the constructor dry-weather dry walking rate');
}
/** An existing eat intent on the ordinary public walking approach to an
 * unmarked market's real door. The first eight ticks remain on this road;
 * sale geometry is verified separately by the marked-counter case below. */
function mealRoute(sim: Simulation, world: WorldDefinition, hunger: number, metres = 80, activity = 'eat', actorIndex = 0): Citizen {
  const market = world.buildings[1];
  const start = { ...market.door, x: market.door.x - metres };
  return controlledRoute(sim, actorIndex, market, activity, hunger, start);
}

test('an urgent statistical eat route reaches its real counter before the old sixteen-tick wait and pays once', () => {
  const world = counterWorld(), sim = createCurrentProductCity(world), market = world.buildings[1];
  const point = market.functionPoints!.find(point => point.purpose === 'sale' && point.floor === 0 && Math.abs(point.position.x - market.position.x) < 1e-8)!;
  assert.ok(point, 'the fixture must contain an actual public ground sale point');
  const start = { ...point.position, z: point.position.z + 2.625 };
  assert.ok(floorPlanSupport(market, 0, start), 'initial body stands on the real supported market floor');
  assert.equal(blocksFloorPlanReferenceMovement(market, 0, start, point.position, .35, 1.72), false, 'the original counter approach crosses no wall or solid fixture');
  const actor = controlledRoute(sim, 0, market, 'eat', 20, start, point.position), shop = sim.state.shops.find(shop => shop.buildingId === market.id)!;
  statistical(sim, actor);
  assert.equal(actor.food ?? 0, 0);
  assert.ok(actor.money >= shop.price * 2 && shop.inventory >= 2, 'the constructor supplies the real affordable wallet and finite initial stock');
  const originalRoute = actor.route, deadline = runtime(sim).decisionAt[actor.id], startedAt = clock(sim);
  let customers = 0, ownSales = 0, quantityAfterArrival = 0, grossAfterArrival = 0, moved = 0;
  let arrival: { money: number; inventory: number; revenue: number; funds: number; food: number; hunger: number } | undefined;
  sim.onEvent('customer', event => {
    if (event.citizenId !== actor.id) return;
    customers++;
    assert.equal(sim.state.lastSystemOrder.at(-1), 'people');
    assert.equal(sim.isAtBuildingFunctionPoint(market, actor.position, 'sale', { role: 'traveler', identities: ['traveler'] }), true);
    assert.deepEqual(actor.position, point.position);
    near(actor.needs.hunger, 20 - .75 * .05, 'arrival has consumed exactly three ordinary ticks of hunger');
    arrival = { money: actor.money, inventory: shop.inventory, revenue: shop.revenue, funds: sim.shopFunds(shop), food: actor.food ?? 0, hunger: actor.needs.hunger };
  });
  sim.onEvent('sale', event => {
    if (!arrival || event.shopId !== shop.id) return;
    quantityAfterArrival += event.quantity ?? 0;
    grossAfterArrival += event.amount ?? 0;
    near(shop.inventory, arrival.inventory - quantityAfterArrival, 'all actual counter receipts consume existing stock');
    near(shop.revenue, arrival.revenue + grossAfterArrival, 'receipts credit actual retail revenue');
    near(sim.shopFunds(shop), arrival.funds + grossAfterArrival * (1 - sim.state.taxRate), 'actual net proceeds enter the shop account');
    if (event.citizenId !== actor.id) return;
    ownSales++;
    assert.equal(sim.state.lastSystemOrder.at(-1), 'commerce');
    assert.ok((event.quantity ?? 0) > 0 && (event.amount ?? 0) > 0);
    near(actor.money, arrival.money - event.amount!, 'the meal debits the original wallet');
    assert.equal(actor.food, arrival.food + event.quantity! - 1);
    near(actor.needs.hunger, arrival.hunger + 52, 'only the real receipt restores hunger');
  });
  for (let tick = 1; tick <= 3; tick++) {
    const before = { ...actor.position };
    sim.step(.25);
    const leg = distance(before, actor.position);
    moved += leg;
    assert.ok(leg <= 1.05 + 1e-8, 'each ordinary step preserves the 4.2m/minute walking budget');
    assert.equal(actor.tier, 'statistical', 'urgency never promotes the actor tier');
    assert.equal(actor.route, originalRoute, 'an unexpired valid route remains the original route');
    assert.equal(runtime(sim).decisionAt[actor.id], deadline);
    near(clock(sim) - startedAt, tick * .25, 'the city clock advances only by actual ordinary time');
    near(runtime(sim).peopleElapsed?.[actor.id] ?? 0, 0, 'each urgent tick consumes its minutes once');
    if (tick < 3) {
      assert.equal(customers, 0); assert.equal(ownSales, 0);
      near(actor.needs.hunger, 20 - tick * .25 * .05, 'walking hunger uses only elapsed ordinary minutes');
      near(leg, 1.05, 'urgent processing changes frequency without increasing walking speed');
    }
  }
  near(moved, 2.625, 'the body traverses the complete original approach');
  assert.equal(sim.state.tick, 3); assert.equal(customers, 1); assert.equal(ownSales, 1);
  assert.equal(actor.state, 'shopping');
});

test('long eat journeys and nearby non-eat activity retain coarse scheduling and their unexpired decisions', () => {
  const world = clockWorld(), sim = createCurrentProductCity(world);
  const longMeal = mealRoute(sim, world, 25, 200), nearbySocial = mealRoute(sim, world, 25, 80, 'social', 1);
  statistical(sim, longMeal);
  const actors = [longMeal, nearbySocial], startedAt = clock(sim);
  const before = actors.map(actor => ({ position: { ...actor.position }, route: actor.route, deadline: runtime(sim).decisionAt[actor.id] }));
  for (let tick = 1; tick <= 3; tick++) {
    sim.step(.25);
    near(clock(sim) - startedAt, tick * .25, 'the actual city clock advances while these actors are deferred');
    for (let index = 0; index < actors.length; index++) {
      const actor = actors[index];
      assert.equal(actor.tier, 'statistical'); assert.equal(actor.state, 'moving');
      assert.deepEqual(actor.position, before[index].position);
      assert.equal(actor.needs.hunger, 25);
      near(runtime(sim).peopleElapsed![actor.id], tick * .25, 'long eat and nearby non-eat keep all actual deferred minutes');
      assert.equal(runtime(sim).decisionAt[actor.id], before[index].deadline);
      assert.equal(actor.route, before[index].route);
    }
    assert.equal(runtime(sim).activities[longMeal.id], 'eat');
    assert.equal(runtime(sim).activities[nearbySocial.id], 'social');
  }
});

test('carried food, children, ordinary needs and undeclared legacy cities retain their tier delay', () => {
  const world = clockWorld(), sim = createCurrentProductCity(world);
  const carried = mealRoute(sim, world, 20, 80, 'eat', 0), child = mealRoute(sim, world, 20, 80, 'eat', 1), ordinary = mealRoute(sim, world, 60, 80, 'eat', 2);
  carried.food = 1; // Controlled initial carried-food guard, not an observed purchase.
  sim.state.extension!.actorProfiles[child.id].age = 5; // Controlled under-six guard, not a birth/progression claim.
  statistical(sim, carried);
  const guarded = [carried, child, ordinary], before = guarded.map(actor => ({ position: { ...actor.position }, hunger: actor.needs.hunger, deadline: runtime(sim).decisionAt[actor.id] }));
  let storedMeals = 0;
  sim.onEvent('stored-meal', event => { if (event.citizenId === carried.id) storedMeals++; });
  const legacy = createArchivedProductCity(world), legacyActor = mealRoute(legacy, world, 20);
  statistical(legacy, legacyActor);
  assert.equal(legacy.mealRoutePolicyId, 'legacy');
  const legacyStart = { ...legacyActor.position }, legacyDeadline = runtime(legacy).decisionAt[legacyActor.id];
  for (let tick = 1; tick <= 2; tick++) {
    sim.step(.25); legacy.step(.25);
    for (let index = 0; index < guarded.length; index++) {
      const actor = guarded[index];
      assert.equal(actor.tier, 'statistical');
      assert.deepEqual(actor.position, before[index].position);
      assert.equal(actor.needs.hunger, before[index].hunger);
      near(runtime(sim).peopleElapsed![actor.id], tick * .25, 'guarded statistical actors retain real deferred minutes');
      assert.equal(runtime(sim).decisionAt[actor.id], before[index].deadline);
    }
    assert.deepEqual(legacyActor.position, legacyStart); assert.equal(legacyActor.needs.hunger, 20);
    near(runtime(legacy).peopleElapsed![legacyActor.id], tick * .25, 'undeclared legacy need retains its original statistical frequency');
    assert.equal(runtime(legacy).decisionAt[legacyActor.id], legacyDeadline);
  }
  assert.equal(carried.food, 1); assert.equal(storedMeals, 0);
});

test('a short real meal approach crosses the projected hunger threshold and catches up exactly once', () => {
  const world = clockWorld(), sim = createCurrentProductCity(world), actor = mealRoute(sim, world, 30.04);
  statistical(sim, actor);
  const start = { ...actor.position }, startedAt = clock(sim);
  for (let tick = 1; tick <= 3; tick++) {
    sim.step(.25);
    assert.deepEqual(actor.position, start); assert.equal(actor.needs.hunger, 30.04);
    near(runtime(sim).peopleElapsed![actor.id], tick * .25, 'threshold setup accrues only real deferred ticks');
  }
  sim.step(.25);
  assert.equal(sim.state.tick, 4, 'the accumulated need becomes urgent before the old tick-sixteen phase');
  near(actor.needs.hunger, 29.99, 'the first processing consumes all four real quarter-minutes once');
  near(distance(start, actor.position), 4.2, 'the catch-up walking budget is exactly the one accrued minute');
  assert.equal(Object.hasOwn(runtime(sim).peopleElapsed!, actor.id), false);
  const afterCatchup = { ...actor.position };
  sim.step(.25);
  near(actor.needs.hunger, 29.9775, 'the next tick does not consume the pending minute again');
  near(distance(afterCatchup, actor.position), 1.05, 'the next tick has only its own ordinary movement budget');
  near(clock(sim) - startedAt, 1.25, 'the entire threshold crossing used five actual ordinary ticks');
  assert.equal(actor.tier, 'statistical');
});

test('a short meal approach cold-imports a new full save exactly and continues eight ordinary ticks byte for byte', () => {
  const world = clockWorld(), original = createCurrentProductCity(world), actor = mealRoute(original, world, 30.04);
  statistical(original, actor);
  const save = original.exportSave(), restored = createCurrentProductCity(world), imported = restored.importSave(save);
  assert.equal(imported.ok, true, imported.message);
  assert.equal(restored.exportSave(), save, 'the complete cold-loaded initial fixture is immediately byte exact');
  assert.equal(restored.mealRoutePolicyId, 'nearby-food-v1');
  assert.equal(restored.referenceCollisionPolicyId, 'continuous-upright-v1');
  const startedAt = clock(original), start = { ...actor.position };
  for (let tick = 1; tick <= 8; tick++) {
    original.step(.25); restored.step(.25);
    assert.equal(restored.exportSave(), original.exportSave(), `complete future save at ordinary tick ${tick}`);
    if (tick === 3) near(runtime(restored).peopleElapsed![actor.id], .75, 'real deferred time survives the identical cold continuation');
    if (tick === 4) {
      near(restored.state.citizens[0].needs.hunger, 29.99, 'the cold continuation crosses the same accumulated threshold');
      assert.equal(Object.hasOwn(runtime(restored).peopleElapsed!, actor.id), false);
    }
  }
  near(clock(original) - startedAt, 2, 'eight ordinary ticks retain exactly two actual game minutes');
  near(actor.needs.hunger, 29.94, 'every elapsed minute is consumed once across the cold continuation');
  near(distance(start, actor.position), 8.4, 'the complete continuation retains the ordinary walking speed');
});


test('a nearby meal destination with a genuine long detour keeps coarse scheduling instead of using straight-line distance', () => {
  const world = clockWorld(), market = world.buildings[1];
  const start = { ...market.door, x: market.door.x - 80 };
  const first = { ...start, z: start.z + 80 }, second = { ...market.door, z: market.door.z + 80 };
  const detourNodes = [
    { id: 'urgent-detour-start', name: 'detour start', districtId: market.districtId, position: start, station: false },
    { id: 'urgent-detour-first', name: 'detour first', districtId: market.districtId, position: first, station: false },
    { id: 'urgent-detour-second', name: 'detour second', districtId: market.districtId, position: second, station: false },
  ];
  world.nodes.push(...detourNodes);
  const doorNode = world.nodes.find(node => node.id === `${market.id}-door`)!;
  const detour = [...detourNodes, doorNode];
  for (let index = 1; index < detour.length; index++) {
    world.edges.push({ id: `urgent-detour-walk-${index}`, from: detour[index - 1].id, to: detour[index].id,
      mode: 'bridge', length: 80, capacity: 20, points: [{ ...detour[index - 1].position }, { ...detour[index].position }] });
  }
  // A controlled existing lawful intent follows three actual public bridge
  // legs. Initial path capture does not credit walking, arrival or elapsed time.
  const sim = createCurrentProductCity(world), actor = controlledRoute(sim, 0, market, 'eat', 20, start);
  actor.route = detour.map(node => ({ ...node.position }));
  actor.routeIndex = 1;
  statistical(sim, actor);
  near(distance(start, market.door), 80, 'the actual market door is nearby in straight-line distance');
  for (const edge of world.edges.filter(edge => edge.id.startsWith('urgent-detour-walk-'))) {
    near(distance(edge.points[0], edge.points[1]), 80, 'each captured detour segment is a real eighty-metre world edge');
  }
  const originalRoute = actor.route, deadline = runtime(sim).decisionAt[actor.id];
  for (let tick = 1; tick <= 3; tick++) {
    sim.step(.25);
    assert.deepEqual(actor.position, start); assert.equal(actor.needs.hunger, 20);
    assert.equal(actor.tier, 'statistical'); assert.equal(actor.route, originalRoute);
    assert.equal(runtime(sim).activities[actor.id], 'eat');
    assert.equal(runtime(sim).decisionAt[actor.id], deadline);
    near(runtime(sim).peopleElapsed![actor.id], tick * .25, 'the complete 240-metre remaining route retains its tier delay');
  }
});
