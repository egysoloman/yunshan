import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Simulation, isCanonicalNpcWage } from '../src/simulation';
import { createCityLifeProductCity } from '../src/product-city';
import { upgradeFreightPickup } from '../src/host/upgrade-freight-pickup';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';
import { familyEducationHeldCash } from '../src/simulation/family-education';
import { ROAD_FOOD_PICKUP_POLICY } from '../src/simulation/freight-access';
import { commodityObserver } from '../scripts/economy-observations';
import type { WorldDefinition } from '../src/types';

const fixture = new URL('./fixtures/freight-native-compact-world.json', import.meta.url);
const world = (): WorldDefinition => JSON.parse(readFileSync(fixture, 'utf8'));
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
function moneySupply(sim: Simulation): number {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money + s.banking!.cash + s.banking!.legacyInvestmentCash
    + s.citizens.reduce((n, c) => n + c.money, 0)
    + s.shops.filter(shop => !e.companies.some(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)).reduce((n, shop) => n + (shop.cash ?? 0), 0)
    + e.companies.reduce((n, c) => n + c.capital, 0) + e.organizations.reduce((n, o) => n + o.funds, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.roadworks?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + (s.education?.course?.escrow ?? 0) + familyEducationHeldCash(s)
    + (s.power?.repairs.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.clinical?.orders.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + shopLifecycleHeldCash(s) + (s.hygiene?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + (s.hygiene?.transfers?.tasks.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + (s.family?.pregnancies.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.family?.households.reduce((n, o) => n + o.balance, 0) ?? 0);
}
function foodCustody(sim: Simulation): number {
  return sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'food').reduce((n, shop) => n + shop.inventory, 0)
    + sim.state.citizens.reduce((n, actor) => n + (actor.food ?? 0), 0) + (sim.state.player.inventory.food ?? 0)
    + sim.state.vehicles.filter(vehicle => ['road', 'flight'].includes(vehicle.kind)).reduce((n, vehicle) => n + vehicle.cargo, 0)
    + Object.values(runtime(sim).freight as Record<string, number>).reduce((n, quantity) => n + quantity, 0);
}

test('declared product truck really loads finite farm stock, carries named custody, unloads and preserves physical future24', async () => {
  const definition = world(), site = definition.buildings[0], city = await createCityLifeProductCity(definition);
  assert.equal(city.state.citizens.length, 384); assert.equal(city.state.tick, 0); assert.equal(city.state.speed, 1);
  assert.equal(city.freightPickupPolicyId, ROAD_FOOD_PICKUP_POLICY);
  const carrierId = 'vehicle-actual-food-road-1', carrier = city.state.vehicles.find(row => row.id === carrierId)!;
  assert.equal(carrier.cargo, 28); assert.equal(carrier.progress, .5); assert.equal(carrier.direction, -1);
  const shop = city.state.shops.find(row => row.buildingId === site.id)!;
  assert.equal(shop.inventory, 160); assert.equal(Reflect.get(city, 'freightCarriers').get(carrierId).cargoCapacity, 28);
  const initial = city.exportSave(), money = moneySupply(city), food = foodCustody(city);
  const commodity = commodityObserver(new Map(definition.buildings.map(b => [b.id, b])), new Map(city.state.shops.map(s => [s.id, s.buildingId])), isCanonicalNpcWage);
  const events: object[] = [], frames: object[] = [];
  let beforeTrafficFood = food, beforeTrafficInventory = shop.inventory, loaded = 0, namedDelivered = 0, originalAnonymousUnloaded = 0;
  let moneyResidual = 0, foodResidual = 0;
  city.onPhase('energy', () => { beforeTrafficFood = foodCustody(city); beforeTrafficInventory = shop.inventory; });
  city.onPhase('traffic', () => { assert.ok(Math.abs(foodCustody(city) - beforeTrafficFood) < 1e-7, 'traffic transfers existing stock without creating food'); });
  city.onEvent('cargo-loaded', event => {
    assert.equal(event.vehicleId, carrierId); assert.equal(event.shopId, shop.id); assert.equal(event.nodeId, `${site.id}-door`);
    assert.ok(event.amount! > 0 && event.amount! <= 28); assert.equal(carrier.cargo, event.amount);
    assert.equal(runtime(city).cargoSources[carrierId], shop.id);
    assert.ok(Math.abs(shop.inventory + event.amount! - beforeTrafficInventory) < 1e-7);
    assert.equal(city.isNearBuilding(site, carrier.position, 2), false, 'truck loading does not confer human room access');
    loaded += event.amount!; events.push({ tick: city.state.tick, time: city.state.extension!.lastUpdate, type: event.type, event: { ...event }, position: { ...carrier.position }, shopInventory: shop.inventory });
  });
  city.onEvent('cargo-arrived', event => {
    if (!event.shopId) originalAnonymousUnloaded += event.amount ?? 0;
    else { assert.equal(event.shopId, shop.id); namedDelivered += event.amount ?? 0; }
    events.push({ tick: city.state.tick, time: city.state.extension!.lastUpdate, type: event.type, event: { ...event } });
  });
  city.onEvent('production', commodity.production); city.onEvent('sale', commodity.sale);
  city.onEvent('stored-meal', commodity.storedMeal); city.onEvent('food-consumed', commodity.foodConsumed);
  let steps = 0;
  for (; steps < 768 && namedDelivered === 0; steps++) {
    city.step(.25); const observations = commodity.snapshot();
    const mass = foodCustody(city) - food - observations.flows.food.producedUnits + observations.observedNpcMeals + observations.playerConsumedMeals;
    moneyResidual = Math.max(moneyResidual, Math.abs(moneySupply(city) - money)); foodResidual = Math.max(foodResidual, Math.abs(mass));
    assert.ok(moneyResidual < 1e-6); assert.ok(foodResidual < 1e-7);
    frames.push({ step: steps + 1, tick: city.state.tick, clock: city.state.extension!.lastUpdate, moneyResidual: moneySupply(city) - money, foodResidual: mass, carrierCargo: carrier.cargo, namedSource: runtime(city).cargoSources?.[carrierId] ?? null, farmInventory: shop.inventory });
  }
  assert.ok(originalAnonymousUnloaded >= 28, 'initial finite anonymous cargo was actually unloaded');
  assert.ok(loaded > 0 && namedDelivered > 0, 'real named load then real transport and unloading within the frozen 768-step bound');
  assert.ok(Object.values(runtime(city).freightLots as Record<string, { shopId: string | null; quantity: number }[]>).flat().some(lot => lot.shopId === shop.id && lot.quantity > 0));
  const terminal = city.exportSave(), full = new Simulation(world()), chunks = new Simulation(world());
  const parts = partitionSave(terminal, definition), artifacts = process.env.FREIGHT_PICKUP_ARTIFACTS;
  let assembled = assembleSave(parts);
  if (artifacts) {
    mkdirSync(join(artifacts, 'parts'), { recursive: true });
    for (const [i, part] of parts.entries()) writeFileSync(join(artifacts, 'parts', `${i}.json`), part.json);
    assembled = assembleSave(parts.map((part, i) => ({ id: part.id, json: readFileSync(join(artifacts, 'parts', `${i}.json`), 'utf8') })));
  }
  assert.equal(assembled, terminal);
  for (const [sim, saved] of [[full, terminal], [chunks, assembled]] as const) { const result = sim.importSave(saved); assert.ok(result.ok, result.message); assert.equal(sim.exportSave(), terminal); }
  const future: object[] = [];
  for (let i = 0; i < 24; i++) {
    for (const sim of [city, full, chunks]) sim.step(.25);
    const saved = city.exportSave(); assert.equal(full.exportSave(), saved); assert.equal(chunks.exportSave(), saved);
    assert.ok(Math.abs(moneySupply(city) - money) < 1e-6);
    future.push({ step: i + 1, tick: city.state.tick, sha256: sha(saved), fullAndPartitionBytesEqual: true });
  }
  const final = city.exportSave();
  const repeatBefore = city.exportSave(), repeat = await upgradeFreightPickup(city, sha(repeatBefore));
  assert.equal(repeat.ok, false); assert.equal(city.exportSave(), repeatBefore, 'repeated cutover cannot replay or create resources');
  if (artifacts) {
    writeFileSync(join(artifacts, 'INITIAL.save.json'), initial); writeFileSync(join(artifacts, 'TERMINAL.save.json'), terminal); writeFileSync(join(artifacts, 'FUTURE24.save.json'), final);
    for (const [name, value] of Object.entries({ events, frames, future24: future, RESULT: { status: 'PASS_NATIVE_FINITE_NAMED_ROAD_TRANSPORT', scenario: 'Declared compact 384 people / unchanged default farm / 200m road / original constructor fleet; not default-city long stability or supplier sale proof.', worldSHA256: sha(readFileSync(fixture, 'utf8')), ordinarySteps: steps, gameMinutes: steps * .25, originalAnonymousUnloaded, loaded, namedDelivered, moneyMaxResidual: moneyResidual, foodMaxResidual: foodResidual, physicalPartReadback: true, partitionParts: parts.length, futureSteps: 24, terminalSHA256: sha(terminal), future24SHA256: sha(final), nativeProductionObserved: commodity.snapshot().flows.food.producedUnits, zeroPostConstructorCashFoodNeedsVehicleSignalRngInjection: true } })) writeFileSync(join(artifacts, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  }
});
