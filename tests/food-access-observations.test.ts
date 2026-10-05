import assert from 'node:assert/strict';
import test from 'node:test';
import { observeFoodAccess } from '../src/simulation/food-access-observations';
import type { FoodAccessRuntime, FoodAccessState, FoodAccessWorld } from '../src/simulation/food-access-observations';
import { foodSnapshot } from '../scripts/economy-observations';
import type { Citizen, SimState } from '../src/types';

const citizen = (id: string, hunger = 20, food = 0, districtId = 'uphill'): Citizen => ({
  id, name: id, districtId, homeId: 'home', workId: 'job', role: '工人',
  position: { x: 0, y: 0, z: 0 }, state: 'moving', destinationId: 'food-market', money: 12,
  needs: { hunger, fatigue: 80, social: 50, fun: 60 }, food, tier: 'active', route: [], routeIndex: 0,
});
function fixture() {
  const world: FoodAccessWorld = {
    districts: [{ id: 'uphill', name: 'Upper' }, { id: 'shore', name: 'Shore' }],
    buildings: [{ id: 'food-market', districtId: 'uphill', kind: 'market' }, { id: 'food-dock', districtId: 'shore', kind: 'dock' }, { id: 'food-farm', districtId: 'shore', kind: 'farm' }, { id: 'materials', districtId: 'uphill', kind: 'workshop' }],
    nodes: [{ id: 'named-stop', position: { x: 10, y: 50, z: 30 } }],
  };
  const state: FoodAccessState & { player: { inventory: { food: number } } } = {
    day: 0, hour: 19, weather: '晴',
    citizens: [citizen('hungry'), citizen('boundary', 30), citizen('carrying', 0, 1), citizen('dead', 0)],
    shops: [{ id: 'market-shop', buildingId: 'food-market', districtId: 'uphill', inventory: 1, price: 12, open: true }, { id: 'dock-shop', buildingId: 'food-dock', districtId: 'shore', inventory: 5, price: 20, open: true }, { id: 'farm-shop', buildingId: 'food-farm', districtId: 'shore', inventory: .99, price: 1, open: true }, { id: 'material-shop', buildingId: 'materials', districtId: 'uphill', inventory: 100, price: 1, open: true }],
    extension: { lastUpdate: 1140, actorProfiles: { dead: { alive: false } } }, player: { inventory: { food: 0 } },
  };
  const runtime: FoodAccessRuntime = { activities: { hungry: 'eat' }, decisionAt: { hungry: 1140 }, riders: {}, customers: { hungry: 'market-shop' } };
  return { state, world, runtime };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}

test('pure food access uses exact hungry/alive/carried thresholds and agrees with foodSnapshot on the same state', () => {
  const input = fixture();
  input.state.citizens = [citizen('below', 29.999, 0), citizen('at', 30, 0), citizen('carried', 0, 1), citizen('zero', 0, 0), citizen('dead', 0, 0)];
  const before = structuredClone(input); deepFreeze(input);
  const output = observeFoodAccess(input.state, input.world, input.runtime);
  const snapshot = foodSnapshot(input.state as unknown as SimState, new Map(input.world.buildings.map(site => [site.id, site])));
  assert.deepEqual(output.hungryActors.map(actor => actor.id), ['below', 'zero']);
  assert.equal(output.hungryWithoutCarriedFood, snapshot.hungryWithoutCarriedFood);
  assert.equal(output.aliveResidents, snapshot.aliveResidents);
  assert.equal(output.hungryCanAffordAnyStockedOpenFoodOffer, snapshot.hungryCanAffordAnyStockedOpenFoodOffer);
  assert.equal(output.hungerZeroAliveResidents, 2); assert.equal(output.hungryHungerZero, 1);
  assert.equal(output.routeReachability, 'NOT_OBSERVED');
  assert.deepEqual(input, before);
  output.hungryActors[0].needs.hunger = 99;
  output.hungryActors[0].route.remainingRoute3D[0].x = 900;
  assert.deepEqual(input, before);
});

test('world and citizen parameters determine district food offers and any-city affordability', () => {
  const first = fixture();
  const a = observeFoodAccess(first.state, first.world, first.runtime);
  assert.deepEqual(a.districts.map(row => [row.districtId, row.foodShopCount, row.openStockedFoodOfferCount]), [['uphill', 1, 1], ['shore', 2, 1]]);
  assert.deepEqual(a.hungryActors[0].affordableOpenStockedFoodOfferIds, ['market-shop']);
  const second = fixture();
  second.world.districts = [{ id: 'remote', name: 'Other generated world' }];
  second.world.buildings = [{ id: 'other-farm', districtId: 'remote', kind: 'farm' }];
  second.state.shops = [{ id: 'other-shop', buildingId: 'other-farm', districtId: 'remote', inventory: 2, price: 7, open: false }];
  second.state.citizens = [citizen('different-resident', 1, 0, 'remote')];
  second.state.citizens[0].money = 6;
  const b = observeFoodAccess(second.state, second.world, {});
  assert.deepEqual(b.districts.map(row => [row.districtId, row.foodShopCount, row.farmCount, row.openStockedFoodOfferCount]), [['remote', 1, 1, 0]]);
  assert.equal(b.hungryCanAffordAnyStockedOpenFoodOffer, 0);
  assert.equal(b.hungryActors[0].id, 'different-resident');
  second.state.shops[0].open = true; second.state.citizens[0].money = 7;
  assert.equal(observeFoodAccess(second.state, second.world, {}).hungryCanAffordAnyStockedOpenFoodOffer, 1);
});

test('remaining path uses 3D current position and routeIndex; walking/opening/deadline are explicit references', () => {
  const { state, world, runtime } = fixture();
  const actor = state.citizens[0];
  actor.position = { x: 0, y: 0, z: 0 }; actor.route = [{ x: 999, y: 999, z: 999 }, { x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 12 }]; actor.routeIndex = 1;
  const observed = observeFoodAccess(state, world, runtime).hungryActors[0];
  assert.equal(observed.route.remainingDistance3D, 17);
  assert.equal(observed.route.remainingRoute3D.length, 3);
  assert.equal(observed.route.walkingReference.minutes, 17 / 4.2);
  assert.equal(observed.decision.status, 'DUE_REQUIRES_FUTURE_PEOPLE_PROCESSING');
  assert.equal(observed.queueObservation.matchesCurrentDestination, true);
  assert.equal(observed.stateShopping, false);
  assert.equal(observed.openingReference?.closesAtHour, 22);
  assert.equal(observed.openingReference?.estimatedArrivalBeforeClosing, true);
  state.weather = '雨'; state.hour = 19.99; actor.destinationId = 'food-dock';
  const rainy = observeFoodAccess(state, world, runtime).hungryActors[0];
  assert.equal(rainy.route.walkingReference.minutes, 17 / 3.1);
  assert.equal(rainy.openingReference?.scheduledOpenAtCurrentPhase, true);
  assert.equal(rainy.openingReference?.estimatedArrivalBeforeClosing, false);
  state.hour = 20;
  assert.equal(observeFoodAccess(state, world, runtime).hungryActors[0].openingReference?.scheduledOpenAtCurrentPhase, false);
  actor.destinationId = 'food-market'; state.hour = 22;
  assert.equal(observeFoodAccess(state, world, runtime).hungryActors[0].openingReference?.scheduledOpenAtCurrentPhase, false);
});

test('riders expose the named stop and arrival flag while walking time and before-closing stay NOT_ESTIMATED', () => {
  const { state, world, runtime } = fixture();
  state.citizens[0].state = 'riding';
  runtime.riders = { hungry: { vehicleId: 'bus', stopNodeId: 'named-stop', arrived: true, arrivedAt: 1139 } };
  const actor = observeFoodAccess(state, world, runtime).hungryActors[0];
  assert.equal(actor.route.walkingReference.status, 'NOT_ESTIMATED'); assert.equal(actor.route.walkingReference.minutes, null);
  assert.deepEqual(actor.route.rider?.stopPosition, { x: 10, y: 50, z: 30 }); assert.equal(actor.route.rider?.stopNodeId, 'named-stop');
  assert.equal(actor.route.rider?.arrived, true); assert.equal(actor.openingReference?.estimatedArrivalBeforeClosing, null);
  state.citizens[0].state = 'moving';
  assert.equal(observeFoodAccess(state, world, runtime).hungryActors[0].route.walkingReference.status, 'NOT_ESTIMATED');
  runtime.riders = {}; state.citizens[0].state = 'shopping';
  const shopping = observeFoodAccess(state, world, runtime).hungryActors[0];
  assert.equal(shopping.stateShopping, true); assert.equal(shopping.route.walkingReference.status, 'NOT_ESTIMATED');
});

test('used numeric fields reject NaN without claiming validation of unrelated saved fields', () => {
  const changes: Array<(input: ReturnType<typeof fixture>) => void> = [
    x => { x.state.citizens[0].needs.hunger = NaN; }, x => { x.state.citizens[0].needs.fatigue = NaN; },
    x => { x.state.citizens[0].money = NaN; }, x => { x.state.citizens[0].food = NaN; },
    x => { x.state.citizens[0].position.y = NaN; }, x => { x.state.citizens[0].route = [{ x: 0, y: NaN, z: 0 }]; },
    x => { x.state.citizens[0].routeIndex = NaN; }, x => { x.state.shops[0].inventory = NaN; }, x => { x.state.shops[0].price = NaN; },
    x => { x.state.hour = NaN; }, x => { x.state.extension!.lastUpdate = NaN; }, x => { x.runtime.decisionAt = { hungry: NaN }; },
    x => { x.runtime.riders = { hungry: { vehicleId: 'bus', stopNodeId: 'named-stop', arrivedAt: NaN } }; },
    x => { x.runtime.riders = { hungry: { vehicleId: 'bus', stopNodeId: 'named-stop' } }; x.world.nodes[0].position.z = NaN; },
  ];
  for (const change of changes) { const input = fixture(); change(input); assert.throws(() => observeFoodAccess(input.state, input.world, input.runtime), /finite/); }
  const invalidIndex = fixture(); invalidIndex.state.citizens[0].routeIndex = 1;
  assert.throws(() => observeFoodAccess(invalidIndex.state, invalidIndex.world, invalidIndex.runtime), /valid.*route index/);
  const noExtension = fixture(); delete noExtension.state.extension;
  assert.equal(observeFoodAccess(noExtension.state, noExtension.world, {}).clock.source, 'day/hour');
});

test('missing building references and mismatched districts are named without certifying affected districts lack food shops', () => {
  const input = fixture();
  input.world.districts = [...input.world.districts, { id: 'quiet', name: 'No referenced food shop' }];
  input.world.buildings = input.world.buildings.filter(building => building.id !== 'food-market');
  input.world.buildings.find(building => building.id === 'food-dock')!.districtId = 'uphill';
  const before = structuredClone(input); deepFreeze(input);
  const output = observeFoodAccess(input.state, input.world, input.runtime);
  assert.deepEqual(output.unresolvedShopBuildingReferences, [{ shopId: 'market-shop', buildingId: 'food-market', shopDistrictId: 'uphill' }]);
  assert.deepEqual(output.shopBuildingDistrictMismatches, [{ shopId: 'dock-shop', buildingId: 'food-dock', shopDistrictId: 'shore', buildingDistrictId: 'uphill', buildingKind: 'dock' }]);
  assert.equal(output.foodOfferDistrictSource, 'saved shop.districtId');
  assert.equal(output.referenceIntegrity.status, 'INCOMPLETE_SHOP_BUILDING_REFERENCES');
  assert.equal(output.referenceIntegrity.unresolvedShopBuildingReferenceCount, 1);
  assert.equal(output.referenceIntegrity.shopBuildingDistrictMismatchCount, 1);
  const uphill = output.districts.find(district => district.districtId === 'uphill')!;
  assert.equal(uphill.foodShopCount, 0);
  assert.equal(uphill.integrity, 'INCOMPLETE_SHOP_BUILDING_REFERENCES');
  assert.equal(uphill.foodFacilityAssessment, 'INCOMPLETE_SHOP_BUILDING_REFERENCES');
  assert.equal(uphill.shopBuildingDistrictMismatchCount, 1);
  const shore = output.districts.find(district => district.districtId === 'shore')!;
  assert.equal(shore.foodShopCount, 2); // Original saved-shop bucketing is retained.
  assert.equal(shore.integrity, 'INCONSISTENT_SHOP_BUILDING_DISTRICTS');
  assert.equal(shore.foodFacilityAssessment, 'INCONSISTENT_SHOP_BUILDING_DISTRICTS');
  assert.equal(output.districts.find(district => district.districtId === 'quiet')!.foodFacilityAssessment, 'NO_FOOD_SHOPS_OBSERVED');
  assert.equal(output.foodSites.find(shop => shop.id === 'dock-shop')!.districtId, 'shore');
  assert.deepEqual(input, before);
  const known = fixture();
  assert.equal(observeFoodAccess(known.state, known.world, known.runtime).districts[0].foodFacilityAssessment, 'KNOWN_FOOD_SHOPS_OBSERVED');
});

test('arbitrary state names count as own numeric keys without inheriting constructor or prototype properties', () => {
  const input = fixture();
  const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'constructor'];
  input.state.citizens = names.map((state, index) => ({ ...citizen(`person-${index}`), state }));
  const before = structuredClone(input); deepFreeze(input);
  const output = observeFoodAccess(input.state, input.world, input.runtime);
  assert.equal(Object.getPrototypeOf(output.hungryStates), null);
  assert.equal(output.hungryStates.constructor, 2);
  assert.equal(output.hungryStates.__proto__, 1);
  assert.equal(output.hungryStates.toString, 1);
  assert.equal(output.hungryStates.hasOwnProperty, 1);
  assert.deepEqual(Object.entries(output.hungryStates), [['constructor', 2], ['__proto__', 1], ['toString', 1], ['hasOwnProperty', 1]]);
  assert.deepEqual(input, before);
});
