import assert from 'node:assert/strict';
import test from 'node:test';
import { commodityObserver, foodSnapshot } from '../scripts/economy-observations';
import { createWorld } from '../src/world';
import { Simulation } from '../src/simulation';

test('food evidence separates workshop output, named counter meals, carried meals and unknown sales without editing events', () => {
  const sites = new Map([['a', { kind: 'farm' as const }], ['b', { kind: 'workshop' as const }]]);
  const observer = commodityObserver(sites, new Map([['shop-a', 'a'], ['shop-b', 'b']]));
  const event = { shopId: 'shop-a', citizenId: 'resident', quantity: 2, amount: 24 };
  const before = structuredClone(event);
  observer.production({ shopId: 'shop-a', amount: 3, minutes: 90 });
  observer.production({ shopId: 'shop-b', amount: 7, minutes: 210 });
  observer.sale(event); observer.sale({ shopId: 'shop-a', quantity: 1, amount: 12 });
  observer.sale({ shopId: 'missing-site', quantity: 2, amount: 20 });
  observer.storedMeal({ citizenId: 'resident', amount: 1 }); observer.foodConsumed({ citizenId: 'player', amount: 1 });
  const result = observer.snapshot();
  assert.deepEqual(event, before);
  assert.equal(result.flows.food.producedUnits, 3); assert.equal(result.flows.materials.producedUnits, 7);
  assert.equal(result.flows.food.retailUnits, 3); assert.equal(result.flows.food.counterMeals, 1);
  assert.equal(result.flows.food.unattributedRetailUnits, 1); assert.equal(result.flows.unknown.unattributedRetailUnits, 2);
  assert.equal(result.observedNpcMeals, 2); assert.equal(result.playerConsumedMeals, 1);
  result.flows.food.producedUnits = 900; assert.equal(observer.snapshot().flows.food.producedUnits, 3);
});

test('headless food diagnosis is read only and leaves legal reachability unknown, even when a remote food offer is affordable', () => {
  const world = createWorld(20261001), sim = new Simulation(world);
  const buildings = new Map(world.buildings.map(site => [site.id, site]));
  const citizen = sim.state.citizens[0]; citizen.needs.hunger = 20; citizen.food = 0; citizen.money = 600;
  const shop = sim.state.shops.find(row => buildings.get(row.buildingId)?.kind === 'market')!;
  shop.open = true; shop.inventory = 2;
  const before = sim.exportSave(), result = foodSnapshot(sim.state, buildings);
  assert.equal(sim.exportSave(), before);
  assert.equal(result.aliveResidents, 616); assert.equal(result.hungryWithoutCarriedFood, 1);
  assert.equal(result.hungryCanAffordAnyStockedOpenFoodOffer, 1); assert.equal(result.routeReachability, 'NOT_OBSERVED');
  const food = sim.state.shops.filter(row => ['farm', 'dock', 'market'].includes(buildings.get(row.buildingId)!.kind));
  assert.equal(result.shopFoodUnits, food.reduce((sum, row) => sum + row.inventory, 0));
  assert.ok(result.bySiteKind.workshop.inventoryUnits > 0); assert.equal(sim.exportSave(), before);
});

test('event-only economic observations preserve every actual tick of the default headless city', () => {
  const world = createWorld(20261001), observed = new Simulation(world), control = new Simulation(world);
  const buildings = new Map(world.buildings.map(site => [site.id, site]));
  const observer = commodityObserver(buildings, new Map(observed.state.shops.map(shop => [shop.id, shop.buildingId])));
  observed.onEvent('production', event => observer.production(event));
  observed.onEvent('sale', event => observer.sale(event));
  observed.onEvent('stored-meal', event => observer.storedMeal(event));
  observed.onEvent('food-consumed', event => observer.foodConsumed(event));
  for (let tick = 0; tick < 24; tick++) {
    observed.step(.25); control.step(.25);
    foodSnapshot(observed.state, buildings); observer.snapshot();
    assert.equal(observed.exportSave(), control.exportSave(), `observer changed tick ${tick + 1}`);
  }
  assert.deepEqual(Object.keys(observer.snapshot().flows), ['food', 'materials', 'unknown']);
});
