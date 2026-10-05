import assert from 'node:assert/strict';
import test from 'node:test';
import { foodRetailDeliveryOffers, RoadFoodDeliveryRouter, ROAD_FOOD_DELIVERY_POLICY, validateFreightDeliveryPolicy, type FoodDeliveryAccounts } from '../src/simulation/freight-delivery';
import { ROAD_FOOD_PICKUP_POLICY } from '../src/simulation/freight-access';
import { hasCityRulesetDeclaration } from '../src/simulation/city-ruleset';
import type { Building, NetworkEdge, Shop, SimState, WorldDefinition } from '../src/types';

const point = (x: number) => ({ x, y: 0, z: 0 });
const building = (id: string, districtId: string, kind: Building['kind'], x: number): Building => ({ id, districtId, name: id, kind, position: point(x), door: point(x), width: 8, depth: 8, height: 8, floors: 1, rotation: 0, capacity: 10, seed: 1 });
const edge = (id: string, from: string, to: string, length: number, mode: NetworkEdge['mode'] = 'road'): NetworkEdge => ({ id, from, to, length, mode, points: [], capacity: 10 });
function fixture() {
  const world: WorldDefinition = { seed: 1, voxelSize: .2, size: 1000, districts: [], buildings: [building('farm', 'producers', 'farm', 0), building('retail-a', 'retail', 'market', 700), building('retail-b', 'retail', 'market', 710)],
    nodes: [{ id: 'farm-door', name: 'farm', districtId: 'producers', position: point(0), station: false }, { id: 'producer-junction', name: 'junction', districtId: 'producers', position: point(100), station: true }, { id: 'retail-junction', name: 'junction', districtId: 'retail', position: point(600), station: true }, { id: 'retail-a-door', name: 'a', districtId: 'retail', position: point(700), station: false }, { id: 'retail-b-door', name: 'b', districtId: 'retail', position: point(710), station: false }],
    edges: [edge('producer-spoke', 'farm-door', 'producer-junction', 100), edge('existing-cross-district-road', 'producer-junction', 'retail-junction', 500), edge('retail-a-spoke', 'retail-junction', 'retail-a-door', 100), edge('retail-b-spoke', 'retail-junction', 'retail-b-door', 100), edge('bridge-shortcut', 'farm-door', 'retail-a-door', 1, 'bridge')], mountains: [], spawn: point(0), waterfall: { top: point(0), bottom: point(0), width: 1 }, river: [] };
  const shops: Shop[] = world.buildings.map(site => ({ id: `shop-${site.id}`, buildingId: site.id, districtId: site.districtId, inventory: site.kind === 'farm' ? 0 : 0, price: 12, revenue: 0, profit: 0, customers: 0, open: true, employees: 1 }));
  const accounts: FoodDeliveryAccounts = { sourceShopId: 'shop-farm', sourceFunds: 0, unitPrice: 4, taxRate: .08, retail: [{ shopId: 'shop-retail-a', funds: 500, protectedFunds: 100 }, { shopId: 'shop-retail-b', funds: 500, protectedFunds: 100 }], suppliers: [], freightLots: {}, freightTotals: {} };
  return { world, shops, accounts, state: {} as Pick<SimState, 'roadNetwork'> };
}

test('separate delivery declaration requires v4 native motion and existing paired pickup, preserving complete absence', () => {
  for (const version of [1, 2, 3, 4]) validateFreightDeliveryPolicy({ version, runtime: {} });
  const value = { version: 4, motionVersion: 2, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY, freightDeliveryPolicyId: ROAD_FOOD_DELIVERY_POLICY, runtime: { npcMotionVersion: 2, freightPickupPolicyId: ROAD_FOOD_PICKUP_POLICY, freightDeliveryPolicyId: ROAD_FOOD_DELIVERY_POLICY } };
  const before = JSON.stringify(value); validateFreightDeliveryPolicy(value); assert.equal(JSON.stringify(value), before);
  assert.equal(hasCityRulesetDeclaration({ version: 1, state: {}, runtime: { freightDeliveryPolicyId: ROAD_FOOD_DELIVERY_POLICY } }), true);
  for (const bad of [{ ...value, freightDeliveryPolicyId: undefined }, { ...value, freightDeliveryPolicyId: null }, { ...value, freightDeliveryPolicyId: 'invented' }, { ...value, version: 3 }, { ...value, motionVersion: 1 }, { ...value, freightPickupPolicyId: undefined }, { ...value, runtime: {} }, { ...value, runtime: { ...value.runtime, npcMotionVersion: 1 } }, { ...value, runtime: { ...value.runtime, freightPickupPolicyId: undefined } }]) assert.throws(() => validateFreightDeliveryPolicy(bad), /freight delivery policy pair/);
});

test('producer district with no market follows existing real cross-district road to funded food market door, not bridge shortcut', () => {
  const { world, shops, accounts, state } = fixture(), before = JSON.stringify({ world, shops, accounts, state }), router = new RoadFoodDeliveryRouter(world), offers = foodRetailDeliveryOffers(world, shops, accounts);
  const route = router.route(state, 'farm-door', offers, 28)!;
  assert.equal(route.shopId, 'shop-retail-a'); assert.equal(route.distance, 700); assert.equal(route.next!.edge.id, 'producer-spoke'); assert.equal(route.arrived, false);
  assert.equal(router.route(state, 'producer-junction', offers, 28)!.next!.edge.id, 'existing-cross-district-road');
  assert.equal(router.route(state, 'retail-junction', offers, 28)!.arrived, false);
  const arrival = router.route(state, 'retail-a-door', offers, 28)!; assert.equal(arrival.arrived, true); assert.equal(arrival.next, null);
  assert.equal(JSON.stringify({ world, shops, accounts, state }), before); assert.equal(shops[0].inventory, 0, 'Last actual loaded cargo does not require producer remaining stock');
});

test('stable equal-distance destination selection and legitimate reverse of the incoming producer spoke', () => {
  const { world, shops, accounts, state } = fixture(), offers = foodRetailDeliveryOffers(world, shops, accounts), router = new RoadFoodDeliveryRouter(world);
  const a = router.route(state, 'farm-door', [...offers].reverse(), 28)!, b = router.route(state, 'farm-door', offers, 28)!;
  assert.deepEqual(a, b); assert.equal(a.next!.edge.from, 'farm-door'); assert.equal(a.next!.node, 'producer-junction');
  assert.equal(a.next!.edge.id, 'producer-spoke', 'The already-used open spoke remains a real permissible reverse leg');
});

test('full-cargo eligibility reserves earned and committed wages and rejects empty resources or nonretail facilities', () => {
  const { world, shops, accounts, state } = fixture(), router = new RoadFoodDeliveryRouter(world);
  const poor = { ...accounts, retail: accounts.retail.map(row => ({ ...row, funds: 208, protectedFunds: 100 })) };
  assert.equal(router.route(state, 'farm-door', foodRetailDeliveryOffers(world, shops, poor), 28), null);
  const protectedAll = { ...accounts, retail: accounts.retail.map(row => ({ ...row, protectedFunds: row.funds })) };
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, protectedAll), []);
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...accounts, sourceFunds: 1e9 }), []);
  shops.filter(shop => shop.id !== 'shop-farm').forEach(shop => { shop.inventory = 36; });
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, accounts), []);
});

test('existing FIFO custody subtracts live district reception and finite queue capacity without hiding anonymous goods', () => {
  const { world, shops, accounts, state } = fixture(), router = new RoadFoodDeliveryRouter(world);
  const held = { ...accounts, freightLots: { retail: [{ shopId: null, quantity: 140 }] }, freightTotals: { retail: 140 } };
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, held), []);
  const room = { ...accounts, freightLots: { retail: [{ shopId: null, quantity: 28 }] }, freightTotals: { retail: 28 } }, offers = foodRetailDeliveryOffers(world, shops, room);
  assert.equal(offers[0].acceptableUnits, 28); assert.ok(router.route(state, 'farm-door', offers, 28));
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...accounts, freightLots: { retail: [{ shopId: null, quantity: 1e9 }] }, freightTotals: { retail: 1e9 } }), []);
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...accounts, freightTotals: { retail: 10 } }), [], 'Missing owner rows cannot conceal pre-existing freight');
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...room, freightTotals: { retail: 29 } }), [], 'Mismatched aggregate custody blocks candidate delivery');
});

test('FIFO prefix uses its own actual quote and supplier funds, and cannot hide an unaffordable prior owner', () => {
  const { world, shops, accounts, state } = fixture(), router = new RoadFoodDeliveryRouter(world);
  const cheapCandidate = { ...accounts, retail: accounts.retail.map(row => ({ ...row, funds: 116, protectedFunds: 0 })), freightLots: { retail: [{ shopId: 'old-owner', quantity: 1 }] }, freightTotals: { retail: 1 } };
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, cheapCandidate), [], 'Unknown FIFO quote blocks admission');
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...cheapCandidate, suppliers: [{ shopId: 'old-owner', funds: 0, unitPrice: 1000 }] }), [], 'Neither retail wallet can purchase the front unit');
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...cheapCandidate, suppliers: [{ shopId: 'old-owner', funds: 1e9, unitPrice: 4 }] }), [], 'A full source account blocks the actual FIFO');
  const affordable = { ...cheapCandidate, suppliers: [{ shopId: 'old-owner', funds: 0, unitPrice: 4 }] };
  assert.ok(router.route(state, 'farm-door', foodRetailDeliveryOffers(world, shops, affordable), 28));
});

test('current owner merges behind its own prior custody, preserving anonymous costs and inventory batch limits', () => {
  const { world, shops, accounts, state } = fixture(), router = new RoadFoodDeliveryRouter(world);
  const value = { ...accounts, unitPrice: 8, retail: [accounts.retail[0]], freightLots: { retail: [{ shopId: null, quantity: 14 }, { shopId: 'shop-farm', quantity: 14 }] }, freightTotals: { retail: 28 } };
  const before = JSON.stringify(value), offers = foodRetailDeliveryOffers(world, shops, value);
  assert.equal(offers[0].acceptableUnits, 14, 'Three batches cross inventory36; prior28 leaves only14 potential new units');
  assert.equal(router.route(state, 'farm-door', offers, 28), null);
  assert.equal(JSON.stringify(value), before);
  shops.find(shop => shop.id === 'shop-retail-a')!.inventory = 30;
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...accounts, retail: [accounts.retail[0]] }).map(row => row.acceptableUnits), [14]);
});

test('invalid actual cost prices are rejected before directing cargo, while zero remaining producer stock stays eligible', () => {
  const { world, shops, accounts } = fixture();
  for (const unitPrice of [3.99, 100000.01, 4.001, NaN, Infinity]) assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...accounts, unitPrice }), []);
  for (const unitPrice of [3.99, 100000.01, 4.001]) assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...accounts, suppliers: [{ shopId: 'old-owner', funds: 0, unitPrice }], freightLots: { retail: [{ shopId: 'old-owner', quantity: 1 }] }, freightTotals: { retail: 1 } }), []);
  assert.ok(foodRetailDeliveryOffers(world, shops, accounts).length); assert.equal(shops[0].inventory, 0);
});

test('existing named custody spends supplier account headroom before any new delivery is accepted', () => {
  const { world, shops, accounts } = fixture();
  const sourceFunds = 1e9 - 28 * 4 * (1 - accounts.taxRate);
  assert.deepEqual(foodRetailDeliveryOffers(world, shops, { ...accounts, sourceFunds, freightLots: { retail: [{ shopId: 'shop-farm', quantity: 28 }] }, freightTotals: { retail: 28 } }), []);
});

test('road closure/reopen and same-revision open-bit changes invalidate cached routes; no walking bridge fallback', () => {
  const { world, shops, accounts, state } = fixture(), router = new RoadFoodDeliveryRouter(world), offers = foodRetailDeliveryOffers(world, shops, accounts);
  assert.ok(router.route(state, 'farm-door', offers, 28));
  state.roadNetwork = { version: 1, activatedAt: 480, revision: 1, nextClosureId: 2, permits: {}, closures: [{ id: 'closed', edgeId: 'existing-cross-district-road', reopenedAt: null } as SimState['roadNetwork'] extends { closures: (infer T)[] } ? T : never] };
  assert.equal(router.route(state, 'farm-door', offers, 28), null);
  state.roadNetwork.closures[0].reopenedAt = 500; // same revision still cannot reuse a stale closed graph
  assert.ok(router.route(state, 'farm-door', offers, 28));
});

test('offer cash and stock change at same topology revision are re-evaluated without mutating cached trees', () => {
  const { world, shops, accounts, state } = fixture(), router = new RoadFoodDeliveryRouter(world);
  assert.equal(router.route(state, 'farm-door', foodRetailDeliveryOffers(world, shops, accounts), 28)!.shopId, 'shop-retail-a');
  const onlyB = { ...accounts, retail: accounts.retail.filter(row => row.shopId === 'shop-retail-b') };
  assert.equal(router.route(state, 'farm-door', foodRetailDeliveryOffers(world, shops, onlyB), 28)!.shopId, 'shop-retail-b'); assert.equal(router.cachedTreeCount, 1);
  assert.equal(router.route(state, 'farm-door', [], 28), null); assert.equal(router.cachedTreeCount, 1);
});

test('search cache is bounded32 and cold/restored-state routes reproduce warm results', () => {
  const { world, shops, accounts, state } = fixture();
  for (let i = 0; i < 40; i++) { world.nodes.push({ id: `branch-${i}`, name: 'branch', districtId: 'producers', position: point(i), station: false }); world.edges.push(edge(`edge-${i}`, `branch-${i}`, 'producer-junction', 100 + i)); }
  const router = new RoadFoodDeliveryRouter(world), offers = foodRetailDeliveryOffers(world, shops, accounts), first = router.route(state, 'farm-door', offers, 28);
  for (let i = 0; i < 40; i++) assert.ok(router.route(state, `branch-${i}`, offers, 28));
  assert.equal(router.cachedTreeCount, 32); assert.deepEqual(router.route(state, 'farm-door', offers, 28), first);
  assert.deepEqual(router.route(structuredClone(state), 'farm-door', offers, 28), first); assert.equal(router.cachedTreeCount, 1);
});

test('replacement of identical edge records refreshes references; invalid/infinite path costs never become routes', () => {
  const { world, shops, accounts, state } = fixture(), router = new RoadFoodDeliveryRouter(world), offers = foodRetailDeliveryOffers(world, shops, accounts);
  const first = router.route(state, 'farm-door', offers, 28)!; world.edges[0] = structuredClone(world.edges[0]);
  const next = router.route(state, 'farm-door', offers, 28)!; assert.notEqual(next.next!.edge, first.next!.edge); assert.equal(next.next!.edge, world.edges[0]);
  world.edges[0].length = Number.MAX_VALUE; world.edges[1].length = Number.MAX_VALUE;
  assert.equal(router.route(state, 'farm-door', offers, 28), null);
  assert.equal(router.route(state, 'not-a-node', offers, 28), null); assert.equal(router.route(state, 'farm-door', offers, 0), null);
});
