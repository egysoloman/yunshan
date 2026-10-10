import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { chooseFreightDestination, DEMAND_FOOD_FREIGHT_POLICY, DEMAND_FOOD_FREIGHT_POLICY_V2, DEMAND_FOOD_FREIGHT_POLICY_V3, districtSupplied, FreightHops, MARKET_FREIGHT_INTAKE_LIMIT, validateFoodFreightPolicy } from '../src/simulation/freight-delivery';
import { hasCityRulesetDeclaration } from '../src/simulation/city-ruleset';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { civicFixtureWorld } from './civic-staffing-fixture';
import type { Vehicle } from '../src/types';

test('food freight policy keeps absence and requires a matched explicit v4 native-motion pair', () => {
  for (const version of [1, 2, 3, 4]) validateFoodFreightPolicy({ version, runtime: {} });
  const declared = { version: 4, motionVersion: 2, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY, runtime: { npcMotionVersion: 2, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY } };
  validateFoodFreightPolicy(declared);
  validateFoodFreightPolicy({ ...declared, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY_V2, runtime: { ...declared.runtime, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY_V2 } });
  assert.throws(() => validateFoodFreightPolicy({ ...declared, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY_V2 }), /food freight policy pair/);
  assert.equal(hasCityRulesetDeclaration(declared), true);
  for (const body of [{ ...declared, foodFreightPolicyId: undefined }, { ...declared, foodFreightPolicyId: 'invented' }, { ...declared, version: 3 }, { ...declared, motionVersion: 1 },
    { ...declared, runtime: {} }, { ...declared, runtime: { npcMotionVersion: 1, foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY } }])
    assert.throws(() => validateFoodFreightPolicy(body), /food freight policy pair/);
  assert.throws(() => new Simulation(civicFixtureWorld(), { rulesetId: 'civic-local-v1', foodFreightPolicyId: DEMAND_FOOD_FREIGHT_POLICY }), /不支持的显式城市规则版本/);
});

test('the destination is the reachable district with least food per market below the intake limit', () => {
  const world = createProductWorld(), hops = new FreightHops(world);
  const node = world.nodes.find(n => n.districtId === 'river' && hops.hops('road', 'east').has(n.id))!;
  const full = MARKET_FREIGHT_INTAKE_LIMIT;
  assert.equal(chooseFreightDestination(hops, 'road', node.id, [{ districtId: 'east', markets: 2, stock: 2 * full }, { districtId: 'west', markets: 1, stock: full }]), null, 'no district short: unload as before');
  assert.equal(chooseFreightDestination(hops, 'road', node.id, [{ districtId: 'east', markets: 2, stock: 10 }, { districtId: 'west', markets: 1, stock: 6 }]), 'east');
  assert.equal(chooseFreightDestination(hops, 'road', node.id, [{ districtId: 'west', markets: 1, stock: 5 }, { districtId: 'east', markets: 2, stock: 10 }]), 'east', 'ties go to the lower district id');
  assert.equal(chooseFreightDestination(hops, 'road', node.id, [{ districtId: 'east', markets: 0, stock: 0 }]), null, 'a district without markets is never a destination');
  assert.equal(districtSupplied([{ districtId: 'east', markets: 2, stock: 10 }], 'east'), false);
  assert.equal(districtSupplied([{ districtId: 'east', markets: 2, stock: 2 * full }], 'east'), true);
  assert.equal(districtSupplied([], 'starport'), true, 'a district without markets has nothing to be short of');
  assert.equal(hops.hops('road', 'east').get(world.nodes.find(n => n.districtId === 'east' && hops.hops('road', 'east').has(n.id))!.id), 0);
});

test('a new product city declares the policy and keeps it through save, partitions and import; an archive does not acquire it', () => {
  const world = civicFixtureWorld(), city = createCurrentProductCity(world), saved = city.exportSave(), doc = JSON.parse(saved);
  assert.equal(city.foodFreightPolicyId, DEMAND_FOOD_FREIGHT_POLICY_V3);
  assert.equal(doc.foodFreightPolicyId, DEMAND_FOOD_FREIGHT_POLICY_V3); assert.equal(doc.runtime.foodFreightPolicyId, DEMAND_FOOD_FREIGHT_POLICY_V3);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
  const reader = createCurrentProductCity(world); assert.equal(reader.importSave(saved).ok, true); assert.equal(reader.exportSave(), saved);
  for (let tick = 0; tick < 12; tick++) { city.step(.25); reader.step(.25); assert.equal(reader.exportSave(), city.exportSave()); }
  const archive = createArchivedProductCity(world), original = archive.exportSave();
  assert.equal(archive.foodFreightPolicyId, 'legacy'); assert.equal(Object.hasOwn(JSON.parse(original), 'foodFreightPolicyId'), false);
  const forged = { ...doc, runtime: { ...doc.runtime } }; delete forged.runtime.foodFreightPolicyId;
  assert.equal(createCurrentProductCity(world).importSave(JSON.stringify(forged)).ok, false, 'a half declaration is rejected');
  const stray = { ...doc, runtime: { ...doc.runtime, cargoDestinations: { 'not-a-carrier': 'east' } } };
  assert.equal(createCurrentProductCity(world).importSave(JSON.stringify(stray)).ok, false, 'a destination must name a loaded carrier');
});

test('declared carriers route food to a short district and release it only there', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
  // The demand view is replaced so that only east is short; shops and ledgers stay real.
  const internals = sim as unknown as { foodFreightDemand: () => { districtId: string; markets: number; stock: number }[]; holdFoodFreight: (v: Vehicle, nodeId: string, districtId: string) => boolean; runtime: { cargoDestinations: Record<string, string> }; bus: { on(type: string, f: (e: { districtId?: string; amount?: number }) => void): void } };
  const real = internals.foodFreightDemand.bind(sim), hold = internals.holdFoodFreight.bind(sim);
  internals.foodFreightDemand = () => real().map(row => row.districtId === 'east' ? { ...row, stock: 0 } : { ...row, stock: Math.max(row.stock, MARKET_FREIGHT_INTAKE_LIMIT * row.markets) });
  const releases: { bound: string; at: string }[] = [], bound = new Set<string>();
  internals.holdFoodFreight = (vehicle, nodeId, districtId) => {
    const before = internals.runtime.cargoDestinations[vehicle.id], kept = hold(vehicle, nodeId, districtId);
    if (before && !kept) releases.push({ bound: before, at: districtId });
    return kept;
  };
  let east = 0; internals.bus.on('cargo-arrived', e => { if (e.districtId === 'east') east += e.amount ?? 0; });
  for (let tick = 0; tick < 140; tick++) { sim.step(.25); for (const id of Object.keys(internals.runtime.cargoDestinations)) bound.add(id); }
  assert(bound.size > 10, `carriers took the short district as destination (${bound.size})`);
  assert(releases.length > 0, 'bound carriers arrived');
  assert(releases.every(r => r.bound === r.at), 'bound cargo is released only in its destination district');
  assert(east > 28 * 10, `east received routed freight (${east})`);
  assert(Object.values(internals.runtime.cargoDestinations).every(d => d === 'east'));
});

test('relay loads freight waiting in a supplied district for a short one, keeping its owner and total', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
  const internals = sim as unknown as { foodFreightDemand: () => { districtId: string; markets: number; stock: number }[]; runtime: { freight: Record<string, number>; freightLots: Record<string, { shopId: string | null; quantity: number }[]>; cargoDestinations: Record<string, string>; cargoSources: Record<string, string> } };
  const real = internals.foodFreightDemand.bind(sim);
  internals.foodFreightDemand = () => real().map(row => row.districtId === 'east' ? { ...row, stock: 0 } : { ...row, stock: Math.max(row.stock, MARKET_FREIGHT_INTAKE_LIMIT * row.markets) });
  const total = () => Object.values(internals.runtime.freight).reduce((a, b) => a + b, 0) + sim.state.vehicles.reduce((a, v) => a + v.cargo, 0);
  // Controlled waiting freight in supplied river (v3 carriers no longer strand cargo there themselves); then watch relays.
  // The generated fleet's initial cargo is moved into that lot, so empty carriers start across the city and the total is unchanged.
  const seeded = sim.state.vehicles.reduce((n, v) => n + v.cargo, 0) + 400;
  for (const vehicle of sim.state.vehicles) vehicle.cargo = 0;
  internals.runtime.freight.river = (internals.runtime.freight.river ?? 0) + seeded;
  (internals.runtime.freightLots ??= {}).river = [...(internals.runtime.freightLots.river ?? []), { shopId: null, quantity: seeded }];
  let relayed = 0;
  // Carriers reach junctions only now and then; 400 quarter-second steps at speed 8 is enough for a few relays.
  for (let tick = 0; tick < 400; tick++) {
    const empty = new Set(sim.state.vehicles.filter(v => v.cargo === 0).map(v => v.id)), before = total();
    sim.step(.25);
    for (const vehicle of sim.state.vehicles) if (empty.has(vehicle.id) && vehicle.cargo > 0 && internals.runtime.cargoDestinations[vehicle.id] === 'east') relayed++;
    assert(total() <= before + 1e-6 + sim.state.shops.filter(s => world.buildings.find(b => b.id === s.buildingId)!.kind !== 'market').length * 1000, 'relay moves stock, it creates none');
    for (const lots of Object.values(internals.runtime.freightLots)) for (const lot of lots) assert(lot.quantity >= -1e-9);
  }
  assert(relayed > 0, 'empty carriers picked up loads bound for east');
});

test('v3 carriers keep their food while no district is short instead of stranding it where they stand', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world);
  sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
  // The demand view is replaced so that every district with markets is supplied; shops and ledgers stay real.
  const internals = sim as unknown as { foodFreightDemand: () => { districtId: string; markets: number; stock: number }[]; bus: { on(type: string, f: (e: { amount?: number }) => void): void } };
  const real = internals.foodFreightDemand.bind(sim);
  internals.foodFreightDemand = () => real().map(row => ({ ...row, stock: Math.max(row.stock, MARKET_FREIGHT_INTAKE_LIMIT * row.markets) }));
  let unloaded = 0; internals.bus.on('cargo-arrived', e => { unloaded += e.amount ?? 0; });
  const carried = () => sim.state.vehicles.reduce((n, v) => n + v.cargo, 0), before = carried();
  for (let tick = 0; tick < 140; tick++) sim.step(.25);
  assert.equal(unloaded, 0, 'nothing is unloaded while every market district is supplied');
  assert.ok(carried() >= before, `held cargo stays on its carriers (${before} -> ${carried()})`);
});
