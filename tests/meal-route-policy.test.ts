import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { chooseNearestTiedMeal, EVENING_BONUS, eveningBonus, LUNCH_BONUS, lunchBonus, NEARBY_EVENING_ROUTE_POLICY, STREET_BROWSE_ROUTE_POLICY, STREET_FOOD_ROUTE_POLICY, SHORT_STALL_ROUTE_POLICY, WORKING_LUNCH_ROUTE_POLICY, STALL_LINGER, stallLinger, routeShortOfDoor, BROWSE_MAX, NEARBY_LUNCH_MEAL_ROUTE_POLICY, NEARBY_MEAL_ROUTE_POLICY, validateMealRoutePolicy } from '../src/simulation/meal-route';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { upgradeMealRoute } from '../src/host/upgrade-meal-route';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';

test('equal meal scores use real travel without changing a higher-score activity or a non-food winner', () => {
  const far = { activity: 'eat', score: 210, travel: 3947 }, near = { activity: 'eat', score: 210, travel: 1793 };
  const rest = { activity: 'rest', score: 210, travel: 25 };
  assert.equal(chooseNearestTiedMeal([far, rest, near]), near);
  assert.equal(chooseNearestTiedMeal([rest, far, near]), rest);
  const higher = { ...rest, score: 211 };
  assert.equal(chooseNearestTiedMeal([higher, near]), higher);
  const ranked = [far, rest, near];
  chooseNearestTiedMeal(ranked); assert.deepEqual(ranked, [far, rest, near], 'the original ranking is not mutated');
});

test('meal policy preserves source actors at cutover and cannot disappear in full or partitioned imports', async () => {
  const world = civicFixtureWorld(), sim = createArchivedProductCity(world), original = sim.exportSave();
  const hash = createHash('sha256').update(original).digest('hex');
  assert.equal((await upgradeMealRoute(sim, '0'.repeat(64))).ok, false);
  assert.equal(sim.exportSave(), original);
  assert.equal((await upgradeMealRoute(sim, hash)).ok, true);
  assert.equal(sim.mealRoutePolicyId, 'nearby-food-v1');
  assert.equal(sim.referenceCollisionPolicyId, 'legacy', 'the policies are independently declared');
  const next = sim.exportSave(), doc = JSON.parse(next);
  delete doc.mealRoutePolicyId; delete doc.runtime.mealRoutePolicyId;
  assert.equal(JSON.stringify(doc), original, 'only two policy declarations change, not old routes or needs');
  assert.equal(assembleSave(partitionSave(next, world)), next);
  for (const change of [
    (d: any) => delete d.mealRoutePolicyId,
    (d: any) => delete d.runtime.mealRoutePolicyId,
    (d: any) => d.mealRoutePolicyId = 'unknown',
    (d: any) => d.runtime.mealRoutePolicyId = 'unknown',
    (d: any) => d.motionVersion = 1,
    (d: any) => d.version = 3,
  ]) {
    const d = JSON.parse(next); change(d);
    assert.equal(sim.importSave(JSON.stringify(d)).ok, false);
    assert.equal(sim.exportSave(), next);
    assert.throws(() => partitionSave(JSON.stringify(d), world));
  }
  for (const path of ['', 'runtime', 'both']) {
    const parts = partitionSave(next, world), g = JSON.parse(parts[0].json);
    for (const key of path === 'both' ? ['', 'runtime'] : [path]) g.layout.order[key] = g.layout.order[key].filter((k: string) => k !== 'mealRoutePolicyId');
    parts[0].json = JSON.stringify(g); assert.throws(() => assembleSave(parts));
  }
  assert.equal(sim.importSave(original).ok, true);
  assert.equal(sim.exportSave(), original);
  assert.equal(sim.mealRoutePolicyId, 'legacy');
  const current = createCurrentProductCity(world);
  assert.equal(current.mealRoutePolicyId, 'nearby-food-v7', 'new cities declare the lunch and evening outing policy');
  assert.equal(current.referenceCollisionPolicyId, 'continuous-upright-v1');
  assert.equal(current.importSave(original).ok, true);
  assert.equal(current.exportSave(), original, 'loading a new factory does not activate either policy');
});

test('v2 adds a midday lunch preference for residents who are not full; v1 and legacy cities keep their meals', () => {
  assert.equal(lunchBonus(NEARBY_LUNCH_MEAL_ROUTE_POLICY, 12, 70), LUNCH_BONUS);
  for (const [hour, hunger] of [[11.4, 70], [13, 70], [12, 80], [18, 40]] as const) assert.equal(lunchBonus(NEARBY_LUNCH_MEAL_ROUTE_POLICY, hour, hunger), 0);
  assert.equal(lunchBonus(NEARBY_MEAL_ROUTE_POLICY, 12, 70), 0);
  assert.equal(lunchBonus(undefined, 12, 70), 0);
  const declared = { version: 4, motionVersion: 2, mealRoutePolicyId: NEARBY_LUNCH_MEAL_ROUTE_POLICY, runtime: { npcMotionVersion: 2, mealRoutePolicyId: NEARBY_LUNCH_MEAL_ROUTE_POLICY } };
  validateMealRoutePolicy(declared);
  assert.throws(() => validateMealRoutePolicy({ ...declared, runtime: { ...declared.runtime, mealRoutePolicyId: NEARBY_MEAL_ROUTE_POLICY } }), /meal route policy pair/, 'envelope and runtime name the same version');
  const world = civicFixtureWorld(), city = createCurrentProductCity(world), saved = city.exportSave();
  assert.equal(JSON.parse(saved).mealRoutePolicyId, WORKING_LUNCH_ROUTE_POLICY);
  const reader = createCurrentProductCity(world); assert.equal(reader.importSave(saved).ok, true); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
});

test('v3 keeps the lunch break and adds an evening outing for rested, fed residents only', () => {
  assert.equal(lunchBonus(NEARBY_EVENING_ROUTE_POLICY, 12, 70), LUNCH_BONUS);
  assert.equal(eveningBonus(NEARBY_EVENING_ROUTE_POLICY, 19.5, 70, 60), EVENING_BONUS);
  for (const [hour, hunger, fatigue] of [[18.4, 70, 60], [21, 70, 60], [19.5, 64, 60], [19.5, 70, 44]] as const) assert.equal(eveningBonus(NEARBY_EVENING_ROUTE_POLICY, hour, hunger, fatigue), 0);
  for (const policy of [NEARBY_LUNCH_MEAL_ROUTE_POLICY, NEARBY_MEAL_ROUTE_POLICY, undefined]) assert.equal(eveningBonus(policy, 19.5, 60, 60), 0, `${policy} has no evening outing`);
  const declared = { version: 4, motionVersion: 2, mealRoutePolicyId: NEARBY_EVENING_ROUTE_POLICY, runtime: { npcMotionVersion: 2, mealRoutePolicyId: NEARBY_EVENING_ROUTE_POLICY } };
  validateMealRoutePolicy(declared);
});

test('v4 keeps v3 and ends an evening market outing on the street before the door, on its own route', () => {
  assert.equal(eveningBonus(STREET_BROWSE_ROUTE_POLICY, 19.5, 70, 60), EVENING_BONUS);
  assert.equal(lunchBonus(STREET_BROWSE_ROUTE_POLICY, 12, 70), LUNCH_BONUS);
  const route = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 4 }];
  assert.deepEqual(routeShortOfDoor(route, 3), [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 1 }]);
  assert.deepEqual(routeShortOfDoor(route, 6), [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }]);
  assert.deepEqual(routeShortOfDoor(route, 99), [{ x: 0, y: 0, z: 0 }]);
  const declared = { version: 4, motionVersion: 2, mealRoutePolicyId: STREET_BROWSE_ROUTE_POLICY, runtime: { npcMotionVersion: 2, mealRoutePolicyId: STREET_BROWSE_ROUTE_POLICY } };
  validateMealRoutePolicy(declared);
  const world = createProductWorld(), sim = createCurrentProductCity(world) as unknown as { state: any; step(dt: number): void; command(c: unknown): void; setFocus(p: unknown, m: string): void; floorPlanPresence(b: unknown, p: unknown): unknown; exportSave(): string };
  sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
  while (sim.state.hour < 20) sim.step(.25);
  const markets = new Map(world.buildings.filter(b => b.kind === 'market').map(b => [b.id, b]));
  const street = sim.state.citizens.filter((c: any) => c.state === 'socializing' && markets.has(c.destinationId) && !sim.floorPlanPresence(markets.get(c.destinationId), c.position));
  assert.ok(street.length >= 10, `${street.length} residents browse on the street`);
  for (const c of street) { const door = markets.get(c.destinationId)!.door; assert.ok(Math.hypot(c.position.x - door.x, c.position.y - door.y, c.position.z - door.z) <= BROWSE_MAX + 1); }
  const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved, 'street browsers save and read back exactly');
});

test('v5 keeps v4 and sells market meals at the street stall before the door, paid exactly as at the counter', () => {
  assert.equal(lunchBonus(STREET_FOOD_ROUTE_POLICY, 12, 70), LUNCH_BONUS);
  assert.equal(eveningBonus(STREET_FOOD_ROUTE_POLICY, 19.5, 70, 60), EVENING_BONUS);
  const declared = { version: 4, motionVersion: 2, mealRoutePolicyId: STREET_FOOD_ROUTE_POLICY, runtime: { npcMotionVersion: 2, mealRoutePolicyId: STREET_FOOD_ROUTE_POLICY } };
  validateMealRoutePolicy(declared);
  const world = createProductWorld(), sim = createCurrentProductCity(world) as unknown as { state: any; bus: { emit(e: any): void }; step(dt: number): void; command(c: unknown): void; setFocus(p: unknown, m: string): void; floorPlanPresence(b: unknown, p: unknown): unknown; exportSave(): string };
  const markets = new Map(world.buildings.filter(b => b.kind === 'market').map(b => [b.id, b]));
  const outside = (c: any) => !sim.floorPlanPresence(markets.get(c.destinationId), c.position);
  let stallSales = 0; const emit = sim.bus.emit.bind(sim.bus);
  sim.bus.emit = (e: any) => {
    if (e.type === 'sale' && e.citizenId) { const c = sim.state.citizens.find((row: any) => row.id === e.citizenId); if (c && markets.has(c.destinationId) && outside(c)) { stallSales++; assert.ok(e.amount > 0 && e.quantity >= 1); } }
    emit(e);
  };
  sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
  // Residents seen at a street stall over the morning (a snapshot depends on who lingers: employed residents
  // resume their shift at once under v7, and a student-dorm city's students are in class).
  const seen = new Set<string>();
  while (sim.state.hour < 14) {
    sim.step(.25);
    for (const c of sim.state.citizens) if (c.state === 'shopping' && markets.has(c.destinationId) && outside(c)) {
      const door = markets.get(c.destinationId)!.door; assert.ok(Math.hypot(c.position.x - door.x, c.position.y - door.y, c.position.z - door.z) <= BROWSE_MAX + 1); seen.add(c.id);
    }
  }
  assert.ok(seen.size >= 8, `${seen.size} residents at street stalls`);
  assert.ok(stallSales >= 20, `${stallSales} meals sold at street stalls by 14:00`);
  const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved, 'stall customers save and read back exactly');
});

test('v6 keeps v5 street stalls and ends a stall meal within STALL_LINGER minutes of the sale', () => {
  assert.equal(lunchBonus(SHORT_STALL_ROUTE_POLICY, 12, 70), LUNCH_BONUS);
  assert.equal(eveningBonus(SHORT_STALL_ROUTE_POLICY, 19.5, 70, 60), EVENING_BONUS);
  validateMealRoutePolicy({ version: 4, motionVersion: 2, mealRoutePolicyId: SHORT_STALL_ROUTE_POLICY, runtime: { npcMotionVersion: 2, mealRoutePolicyId: SHORT_STALL_ROUTE_POLICY } });
  const world = createProductWorld(), sim = createCurrentProductCity(world) as unknown as { state: any; runtime: any; now: number; bus: { emit(e: any): void }; step(dt: number): void; command(c: unknown): void; setFocus(p: unknown, m: string): void; floorPlanPresence(b: unknown, p: unknown): unknown };
  const markets = new Map(world.buildings.filter(b => b.kind === 'market').map(b => [b.id, b]));
  let checked = 0; const emit = sim.bus.emit.bind(sim.bus);
  sim.bus.emit = (e: any) => {
    emit(e);
    if (e.type !== 'sale' || !e.citizenId) return;
    const c = sim.state.citizens.find((row: any) => row.id === e.citizenId);
    if (!c || !markets.has(c.destinationId) || sim.floorPlanPresence(markets.get(c.destinationId), c.position)) return;
    checked++; assert.ok(sim.runtime.decisionAt[c.id] <= sim.now + STALL_LINGER + 1e-9, 'the stall meal ends within the linger');
  };
  sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
  while (sim.state.hour < 13) sim.step(.25);
  assert.ok(checked >= 10, `${checked} stall sales checked`);
});

test('v7 keeps v6 and sends an employed resident back to work at once after a stall meal before 17:00', () => {
  assert.equal(stallLinger(WORKING_LUNCH_ROUTE_POLICY, true, 12.5), 0, 'a working lunch');
  assert.equal(stallLinger(WORKING_LUNCH_ROUTE_POLICY, true, 18), STALL_LINGER, 'after work the evening linger stays');
  assert.equal(stallLinger(WORKING_LUNCH_ROUTE_POLICY, false, 12.5), STALL_LINGER, 'without a job the linger stays');
  assert.equal(stallLinger(SHORT_STALL_ROUTE_POLICY, true, 12.5), STALL_LINGER, 'v6 is unchanged');
  assert.equal(lunchBonus(WORKING_LUNCH_ROUTE_POLICY, 12, 70), LUNCH_BONUS);
  assert.equal(eveningBonus(WORKING_LUNCH_ROUTE_POLICY, 19.5, 70, 60), EVENING_BONUS);
  validateMealRoutePolicy({ version: 4, motionVersion: 2, mealRoutePolicyId: WORKING_LUNCH_ROUTE_POLICY, runtime: { npcMotionVersion: 2, mealRoutePolicyId: WORKING_LUNCH_ROUTE_POLICY } });
});
