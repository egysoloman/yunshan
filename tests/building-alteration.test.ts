import assert from 'node:assert/strict';
import test from 'node:test';
import { buildingAlterationSummary, inspectBuildingAlteration, type BuildingAlterationAccounts } from '../src/simulation/building-alteration.ts';
import { Simulation } from '../src/simulation.ts';
import type { Building, Citizen, NetworkEdge, SimState, WorldDefinition } from '../src/types.ts';

/** Explicit parameter-only fixture, never a generated city or an executed
 * relocation. Doors/nodes supply topology; these tests do not certify a
 * physically supported walk through the twenty-metre frontage gap. */
function fixture() {
  const building = (id: string, x: number, kind: Building['kind'], capacity = 8): Building => ({ id, name: id, districtId: 'd', kind, position: { x, y: 0, z: 20 }, door: { x, y: .6, z: 0 }, width: 6, depth: 6, height: 6, floors: 2, rotation: 0, capacity, seed: 1 });
  const buildings = [building('home-a', 0, 'home'), building('home-b', 20, 'home'), building('work', 40, 'market'), building('school', 60, 'school'), building('clinic', 80, 'clinic')];
  const nodes = buildings.map(b => ({ id: b.id + '-door', districtId: 'd', name: b.name, position: { ...b.door }, station: false }));
  const edges: NetworkEdge[] = nodes.slice(1).map((n, i) => ({ id: 'road-' + i, from: nodes[i].id, to: n.id, mode: i === 1 ? 'bridge' : 'road', length: 20, capacity: 20, points: [{ ...nodes[i].position }, { ...n.position }] }));
  const world: WorldDefinition = { seed: 1, voxelSize: .2, size: 200, districts: [{ id: 'd', name: 'd', kind: 'home', center: { x: 40, y: 0, z: 20 }, radius: 100, population: 4, color: '#000' }], buildings, nodes, edges, mountains: [], spawn: { x: -20, y: .6, z: 0 }, waterfall: { top: { x: 0, y: 5, z: -40 }, bottom: { x: 0, y: 0, z: -40 }, width: 2 }, river: [] };
  const citizen = (id: string, homeId: string, workId = 'work'): Citizen => ({ id, name: id, districtId: 'd', homeId, workId, role: '工人', position: { x: -10, y: .6, z: 0 }, state: 'atHome', destinationId: null, money: 200, needs: { hunger: 80, fatigue: 80, social: 80, fun: 80 }, tier: 'active' });
  const citizens = [citizen('one', 'home-a'), citizen('two', 'home-a', 'school'), citizen('three', 'home-b'), citizen('dead', 'home-a')];
  const state: SimState = { version: 1, seed: 1, tick: 0, day: 0, hour: 8, paused: false, speed: 1, weather: '晴', visibility: 1, energy: 98, treasury: 80, taxRate: .08, policeBudget: .3, support: 58, bankBalance: 0, loan: 0, gdp: 0, lastSystemOrder: [], voxels: [], districts: [], citizens, vehicles: [], shops: [], player: { position: { ...world.spawn }, role: 'traveler', money: 60, reputation: 0, needs: { hunger: 80, fatigue: 80, social: 80, fun: 80 }, inventory: { block: 2 }, homeId: null, education: 0, experience: 0, partnerId: null, vehicleId: null }, relationships: [], crimes: [], events: [], metrics: { trades: 0, commutes: 0, crimesResolved: 0, freight: 0, flights: 0 }, extension: { version: 1, companies: [], technologies: [], audits: [], actorProfiles: Object.fromEntries(['one', 'two', 'three', 'dead', 'player'].map(id => [id, { age: 30, health: 90, mood: 80, stress: 0, alive: id !== 'dead', skill: 50, family: [], historyTags: [] }])), publicLedger: [], cooking: null, organizations: [], environment: { waterQuality: 90, biodiversity: 90, stormRisk: 0, disasterAt: 480, lastDisaster: '' }, institutions: { education: 80, medical: 80, welfare: 80, culture: 80 }, lastUpdate: 480, nextCompanyId: 1, nextAuditId: 1, stats: { mealsCooked: 0, researchCompleted: 0, corruptionRecovered: 0, donations: 0, festivals: 0 } } };
  return { world, state };
}
const plan = { buildingId: 'home-a' };
const noClaims: BuildingAlterationAccounts = { payrollClaims: [], committedPayroll: [], freightLots: {}, cargoSources: {} };
const freeze = (value: unknown): void => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } };

test('parameter-only inspection and its host API are detached, deterministic and never authorize demolition', () => {
  const { world, state } = fixture(), before = JSON.stringify({ world, state }); freeze(world); freeze(state);
  const report = inspectBuildingAlteration(world, state, plan, noClaims);
  assert.equal(report.executionAllowed, false); assert.equal(report.kind, 'read-only-building-preflight-v1');
  assert.deepEqual(report.protections.filter(p => p.kind === 'resident').map(p => p.referenceId), ['one', 'two']);
  assert.deepEqual(Simulation.prototype.inspectBuildingAlteration.call({ worldDefinition: world, state, runtime: { wages: [] } } as unknown as Simulation, plan), report);
  assert.equal(JSON.stringify({ world, state }), before, 'zero constructor, step, event, money, route, approval or geometry mutation');
  report.protections[0].actorIds.push('forged'); report.road.newlyDisconnectedActorIds.push('forged');
  assert.ok(!JSON.stringify(inspectBuildingAlteration(world, state, plan)).includes('forged'));
  assert.ok(buildingAlterationSummary(report).some(line => line.includes('未有实际施工资金')));
});

test('unknown targets reject without changing or inventing a building', () => {
  const { world, state } = fixture(), before = JSON.stringify({ world, state });
  const report = inspectBuildingAlteration(world, state, { buildingId: 'missing' });
  assert.equal(report.buildingName, null); assert.deepEqual(report.blockers, ['目标建筑不存在。']);
  assert.equal(JSON.stringify({ world, state }), before);
});

test('alive player, missing profiles and actual rotated/basement occupants remain protected', () => {
  const { world, state } = fixture(), site = world.buildings[0];
  delete state.extension!.actorProfiles.one;
  site.rotation = Math.PI / 4; site.basements = 1;
  state.player.homeId = site.id; state.player.position = { ...site.position, y: -1 };
  state.citizens[0].position = { ...site.position, y: 1 };
  const report = inspectBuildingAlteration(world, state, plan);
  assert.deepEqual(report.protections.filter(p => p.kind === 'resident').map(p => p.referenceId), ['one', 'two', 'player']);
  assert.deepEqual(report.protections.filter(p => p.kind === 'occupant').map(p => p.referenceId), ['one', 'player']);
});

test('all proposed residents share the same finite destination capacity, and dead residents do not consume it', () => {
  const { world, state } = fixture(); world.buildings[1].capacity = 2;
  state.citizens[3].homeId = 'home-b';
  const report = inspectBuildingAlteration(world, state, { ...plan, relocateHomes: [{ actorId: 'one', homeId: 'home-b' }, { actorId: 'two', homeId: 'home-b' }] });
  assert.equal(report.relocations.length, 2);
  assert.ok(report.relocations.every(r => r.currentResidents === 1 && r.proposedResidents === 3 && !r.valid));
  assert.ok(report.relocations.every(r => r.reasons.some(reason => reason.includes('超出真实容量'))));
  assert.equal(state.citizens[0].homeId, 'home-a'); assert.equal(report.executionAllowed, false);
});

test('valid topology/capacity plan still requires actual consent and leaves residence/money untouched', () => {
  const { world, state } = fixture(), before = JSON.stringify(state);
  const report = inspectBuildingAlteration(world, state, { ...plan, relocateHomes: [{ actorId: 'one', homeId: 'home-b' }, { actorId: 'two', homeId: 'home-b' }] });
  assert.ok(report.relocations.every(r => r.valid && r.proposedResidents === 3 && r.requiresActualConsent));
  assert.equal(report.executionAllowed, false); assert.equal(JSON.stringify(state), before);
  assert.equal(report.protections.filter(p => p.kind === 'resident').length, 2, 'a proposed map cannot erase actual living claims');
});

test('foreign actors, duplicate relocations, same building and non-homes reject explicitly', () => {
  const { world, state } = fixture();
  const report = inspectBuildingAlteration(world, state, { ...plan, relocateHomes: [{ actorId: 'one', homeId: 'home-b' }, { actorId: 'one', homeId: 'home-b' }, { actorId: 'three', homeId: 'home-b' }, { actorId: 'two', homeId: 'home-a' }, { actorId: 'dead', homeId: 'work' }] });
  assert.equal(report.relocations.filter(r => r.valid).length, 1);
  assert.ok(report.relocations.slice(1).every(r => r.reasons.length > 0));
});

test('removing a bridge diagnoses all actual newly cut commutes without counting a dead resident', () => {
  const { world, state } = fixture();
  const report = inspectBuildingAlteration(world, state, { ...plan, removeRoadIds: ['road-1'] });
  assert.equal(report.road.beforeComponents, 1); assert.equal(report.road.proposedComponents, 2);
  assert.deepEqual(report.road.newlyDisconnectedActorIds, ['one', 'two', 'three']);
  assert.ok(report.blockers.some(b => b.includes('会切断')));
});

test('existing canonical closures are respected and remain distinct from newly cut links', () => {
  const { world, state } = fixture();
  state.roadNetwork = { version: 1, activatedAt: 480, revision: 1, nextClosureId: 2, permits: {}, closures: [{ id: 'closure-1', edgeId: 'road-1', sourceEventId: 1, districtId: 'd', occurredAt: 480, severity: 1, closedRevision: 1, worksiteNodeId: 'home-b-door', worksite: { ...world.nodes[1].position }, reopenedAt: null, repairedBy: null, reopenedRevision: null, occupants: [] }] };
  const report = inspectBuildingAlteration(world, state, plan);
  assert.equal(report.observed.roadRevision, 1); assert.deepEqual(report.road.newlyDisconnectedActorIds, []);
  assert.deepEqual(report.road.alreadyDisconnectedActorIds, ['one', 'two', 'three']);
});

test('a finite proposed road uses exact existing nodes/three-dimensional length and only previews connectivity', () => {
  const { world, state } = fixture(); world.edges.splice(1, 1);
  const road: NetworkEdge = { id: 'proposed', mode: 'road', from: world.nodes[0].id, to: world.nodes[2].id, length: 40, capacity: 10, points: [{ ...world.nodes[0].position }, { ...world.nodes[2].position }] };
  const before = JSON.stringify({ world, state });
  const report = inspectBuildingAlteration(world, state, { ...plan, addRoads: [road] });
  assert.deepEqual(report.road.violations, []); assert.deepEqual(report.road.restoredActorIds, ['one', 'two', 'three']);
  assert.equal(JSON.stringify({ world, state }), before); assert.equal(report.executionAllowed, false);
});

test('invalid IDs, capacities, fake endpoints and false lengths never create a diagnostic connection', () => {
  const { world, state } = fixture(); world.edges.splice(1, 1);
  const road: NetworkEdge = { id: 'proposed', mode: 'road', from: world.nodes[0].id, to: world.nodes[2].id, length: 40, capacity: 10, points: [{ ...world.nodes[0].position }, { ...world.nodes[2].position }] };
  for (const invalid of [{ ...road, id: 'road-0' }, { ...road, capacity: 0 }, { ...road, from: 'nonexistent' }, { ...road, length: 1 }, { ...road, points: [{ x: 1, y: .6, z: 0 }, { ...world.nodes[2].position }] }]) {
    const report = inspectBuildingAlteration(world, state, { ...plan, addRoads: [invalid] });
    assert.ok(report.road.violations.length); assert.deepEqual(report.road.restoredActorIds, []);
  }
});

test('road occupation checks the whole rotated segment and distinguishes a high overpass', () => {
  const { world, state } = fixture();
  const site = world.buildings[2]; site.rotation = Math.PI / 4; site.position.z = 0;
  const road: NetworkEdge = { id: 'crosses', mode: 'bridge', from: world.nodes[0].id, to: world.nodes[4].id, length: 80, capacity: 10, points: [{ ...world.nodes[0].position }, { ...world.nodes[4].position }] };
  assert.ok(inspectBuildingAlteration(world, state, { ...plan, addRoads: [road] }).road.violations.some(v => v.includes('work')));
  for (const node of world.nodes) node.position.y = 20;
  road.points = [{ ...world.nodes[0].position }, { ...world.nodes[4].position }];
  assert.deepEqual(inspectBuildingAlteration(world, state, { ...plan, addRoads: [road] }).road.violations, []);
});

test('closed business assets, unpaid rent/deposits, consignments and earned wage debt remain protected', () => {
  const { world, state } = fixture();
  const shop = { id: 'shop', buildingId: 'work', districtId: 'd', ownerId: 'one', cash: 25, inventory: 3, price: 4, revenue: 0, profit: -5, customers: 0, open: false, employees: 1 };
  state.shops.push(shop);
  state.trade = { version: 1, nextLotId: 2, lots: { shop: [{ id: 'lot-1', supplierId: 'supplier', quantity: 2, unitPrice: 4, createdAt: 480 }] }, activity: {}, stats: { suppliedUnits: 2, settledUnits: 0, returnedUnits: 0, supplierGross: 0 } };
  state.shopLifecycle = { version: 1, nextListingId: 1, nextLeaseId: 2, nextReceiptId: 1, titles: {}, listings: [], receipts: [], leases: [{ id: 'lease', listingId: 'listing', shopId: 'shop', lessorId: 'one', tenantId: 'two', rent: 10, periods: 7, startedAt: 480, endsAt: 10560, nextDueAt: 1920, accruedPeriods: 1, accruedRent: 10, paidRent: 0, arrears: 10, depositInitial: 20, depositEscrow: 20, depositToLessor: 0, depositRefunded: 0, advanceInitial: 5, advanceRefunded: 0, state: 'ended', endedAt: 480 }] };
  const accounts: BuildingAlterationAccounts = { ...noClaims, payrollClaims: [{ citizenId: 'three', shopId: 'shop', amount: 7 }, { citizenId: 'one', shopId: 'shop', amount: 2 }], committedPayroll: [{ shopId: 'shop', amount: 3 }], freightLots: { d: [{ shopId: 'shop', quantity: 5 }] } };
  const report = inspectBuildingAlteration(world, state, { buildingId: 'work' }, accounts);
  for (const kind of ['workplace', 'business', 'stock', 'consignment', 'lease', 'wage-debt']) assert.ok(report.protections.some(p => p.kind === kind), kind);
  assert.equal(report.protections.find(p => p.kind === 'lease')?.amount, 35);
  assert.equal(report.protections.find(p => p.kind === 'wage-debt')?.amount, 7);
  assert.equal(report.protections.filter(p => p.kind === 'wage-debt').reduce((sum, p) => sum + (p.amount ?? 0), 0), 12);
  assert.ok(report.protections.some(p => p.referenceId === 'freight:d:0' && p.units === 5));
  assert.equal(report.executionAllowed, false);
});

test('array/type abuse rejects finitely and does not mutate any proposal or current state', () => {
  const { world, state } = fixture(); const before = JSON.stringify({ world, state });
  const report = inspectBuildingAlteration(world, state, { ...plan, removeRoadIds: 'road-1', addRoads: Array(257).fill(null), relocateHomes: null } as unknown as Parameters<typeof inspectBuildingAlteration>[2]);
  assert.ok(report.road.violations.length); assert.equal(report.executionAllowed, false); assert.equal(JSON.stringify({ world, state }), before);
});

test('missing core accounting is declared explicitly rather than assuming no earned debt or transported goods', () => {
  const { world, state } = fixture();
  const report = inspectBuildingAlteration(world, state, plan);
  assert.equal(report.coreAccountingProvided, false);
  assert.ok(report.limitations.some(line => line.includes('未提供核心运行账')));
  assert.equal(inspectBuildingAlteration(world, state, plan, noClaims).coreAccountingProvided, true);
});

test('different city IDs and translated parameters preserve protection and graph results without map-specific names', () => {
  const { world, state } = fixture();
  const rename = (id: string) => 'custom-' + id;
  world.seed = 7001; state.seed = 7001;
  for (const site of world.buildings) { site.id = rename(site.id); site.door.x += 1000; site.position.x += 1000; }
  for (const node of world.nodes) { node.id = rename(node.id); node.position.x += 1000; }
  for (const edge of world.edges) { edge.id = rename(edge.id); edge.from = rename(edge.from); edge.to = rename(edge.to); for (const p of edge.points) p.x += 1000; }
  for (const person of state.citizens) { person.homeId = rename(person.homeId); person.workId = rename(person.workId); person.position.x += 1000; }
  const report = inspectBuildingAlteration(world, state, { buildingId: rename(plan.buildingId), removeRoadIds: [rename('road-1')] });
  assert.equal(report.observed.seed, 7001); assert.equal(report.protections.filter(p => p.kind === 'resident').length, 2);
  assert.deepEqual(report.road.newlyDisconnectedActorIds, ['one', 'two', 'three']); assert.equal(report.executionAllowed, false);
});

test('an active shared household cannot be split by a single-resident proposed relocation', () => {
  const { world, state } = fixture();
  state.family = { households: [{ id: 'household', actorIds: ['one', 'two'], homeId: 'home-a', agreedAt: 480, balance: 10, contributions: { one: 5, two: 5 }, spent: 0, returned: 0, closedAt: null, expenses: [] }], pregnancies: [], children: {} } as unknown as NonNullable<SimState['family']>;
  const report = inspectBuildingAlteration(world, state, { ...plan, relocateHomes: [{ actorId: 'one', homeId: 'home-b' }] });
  assert.equal(report.relocations[0].valid, false); assert.ok(report.relocations[0].reasons.some(r => r.includes('共同住所')));
  assert.ok(report.protections.some(p => p.kind === 'household' && p.amount === 10));
});

test('real current pregnancies reserve finite destination places without creating a child or changing a pregnancy', () => {
  const { world, state } = fixture(); world.buildings[1].capacity = 3;
  state.family = { households: [], pregnancies: [{ id: 'pregnancy', parentIds: ['one', 'two'], carrierId: 'one', homeId: 'home-a', startedAt: 480, dueAt: 1000, escrow: 200 }], children: {} } as unknown as NonNullable<SimState['family']>;
  const before = JSON.stringify(state);
  const report = inspectBuildingAlteration(world, state, { ...plan, relocateHomes: [{ actorId: 'one', homeId: 'home-b' }, { actorId: 'two', homeId: 'home-b' }] });
  assert.ok(report.relocations.every(r => r.proposedResidents === 3 && r.reservedBirthPlaces === 1 && !r.valid));
  assert.ok(report.protections.some(p => p.kind === 'pregnancy' && p.amount === 200)); assert.equal(JSON.stringify(state), before);
});

test('live/refund-pending service, already purchased supplies and research retain their exact original obligations', () => {
  const { world, state } = fixture();
  // Read-only selector fixture, not a valid standalone import/save or a claim
  // that these payments/attendance occurred in the running default city.
  state.clinical = { orders: [{ id: 'clinical', siteId: 'clinic', patientId: 'one', payerId: 'two', state: 'refundPending', escrow: 12 }], stock: { clinic: { availableUnits: 2 } } } as unknown as NonNullable<SimState['clinical']>;
  state.hygiene = { batches: [{ id: 'waste', siteId: 'clinic', containedUnits: 1, reservedUnits: 0, cleaningResidualUnits: 2 }], jobs: [{ id: 'clean', siteId: 'clinic', state: 'refundPending', escrow: 5 }], stock: { clinic: { availableUnits: 1 } } } as unknown as NonNullable<SimState['hygiene']>;
  state.familyEducation = { active: [{ id: 'school-course', siteId: 'school', actorId: 'two', payerId: 'one', status: 'paused', escrow: 15 }], stock: {} } as unknown as NonNullable<SimState['familyEducation']>;
  Reflect.set(state.extension!, 'runtime', { researchJobs: { medicine: { laborVersion: 1, actorId: 'one', siteId: 'clinic', budget: 100, state: 'paused' } } });
  const before = JSON.stringify(state), clinic = inspectBuildingAlteration(world, state, { buildingId: 'clinic' }, noClaims);
  for (const id of ['clinical', 'clean', 'waste', 'clinical:clinic', 'hygiene:clinic', 'research:medicine']) assert.ok(clinic.protections.some(p => p.referenceId === id), id);
  assert.equal(clinic.protections.find(p => p.referenceId === 'clinical')?.amount, 12);
  assert.equal(clinic.protections.find(p => p.referenceId === 'waste')?.units, 3);
  assert.ok(inspectBuildingAlteration(world, state, { buildingId: 'school' }, noClaims).protections.some(p => p.referenceId === 'school-course' && p.amount === 15));
  assert.equal(JSON.stringify(state), before);
});
