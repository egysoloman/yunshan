import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation, isCanonicalNpcWage } from '../src/simulation';
import { beginNightRetail, nightRetailOpportunities, nightRetailPlannedOpen, nightRetailServedNow, shopScheduledOpen } from '../src/simulation/night-retail';
import { applyShopLifecycleCommand, shopLifecycleAllowsOperation } from '../src/simulation/shop_lifecycle';
import { cashSnapshot, foodCustodySnapshot, debtSnapshot } from '../scripts/economy-resume-custody';
import type { Building, Citizen, WorldDefinition } from '../src/types';

/** These are synthetic regression initial snapshots, never
 * observations of a natural large city. Bodies, headcount, needs and the initial
 * clock are controlled; original actors/roles, finite wallets/stock, original
 * onsite employer reviews, movement, wages and retail writers remain in use.
 * No cap, attendance, wage, night job, witness or lease archive is fabricated.
 * The initial controlled boundaries do not certify natural city behavior. */
type Event = Parameters<Simulation['emitEvent']>[0];
const runtime = (sim: Simulation): any => Reflect.get(sim, 'runtime');
const call = (sim: Simulation, name: string, ...args: unknown[]): any => Reflect.get(sim, name).call(sim, ...args);
const clock = (sim: Simulation) => sim.state.extension!.lastUpdate;
const near = (actual: number, expected: number, message = 'numeric equality') =>
  assert.ok(Math.abs(actual - expected) <= 1e-7, `${message}: ${actual} != ${expected}`);

function world(): WorldDefinition {
  const buildings = (['home', 'market'] as const).map((kind, index): Building => ({
    id: `night-${kind}`, name: kind, kind, districtId: 'night-unit',
    position: { x: index * 30, y: 20, z: 0 }, door: { x: index * 30, y: 20.6, z: 5 },
    width: 12, depth: 12, height: 6, floors: 1, rotation: 0, capacity: 100, seed: index + 3,
  }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, name: site.name,
    districtId: site.districtId, position: { ...site.door }, station: false }));
  return { seed: 7, voxelSize: .2, size: 1000, buildings, nodes,
    edges: [{ id: 'night-public-walk', from: nodes[0].id, to: nodes[1].id, mode: 'bridge', length: 30,
      capacity: 20, points: nodes.map(node => ({ ...node.position })) }],
    districts: [{ id: 'night-unit', name: 'Synthetic night retail regression', kind: 'market',
      center: { x: 15, y: 20, z: 0 }, radius: 500, color: '#7799aa', population: 96 }],
    mountains: [], river: [], spawn: { ...nodes[0].position },
    waterfall: { top: { x: 800, y: 40, z: 800 }, bottom: { x: 800, y: 20, z: 800 }, width: 2 },
  };
}

/** Explicit fixture clock boundary. It represents initialized test state, not
 * hundreds of retrospectively simulated minutes. All measured test movement,
 * post-declaration work and sales below come from subsequent ordinary ticks. */
function initialClock(sim: Simulation, at: number): void {
  sim.state.day = Math.floor(at / 1440);
  assert.ok(sim.command({ type: 'setTime', value: at % 1440 / 60 }).ok);
  sim.state.extension!.lastUpdate = at;
  sim.state.family!.lastUpdate = at;
  sim.state.culture!.lastUpdate = at;
  if (sim.state.banking) sim.state.banking.nextInterestAt = at + 60;
  runtime(sim).relationshipClock = at;
}

function fundedFixture(night = true) {
  const sim = new Simulation(world()), shop = sim.state.shops[0], site = sim.worldDefinition.buildings[1];
  const owner = sim.state.citizens.find(actor => actor.id === sim.shopOwnerId(shop))!;
  assert.ok(owner && ['merchant', '商人'].includes(owner.role));
  assert.equal(owner.workId, site.id); assert.equal(sim.state.vehicles.length, 0);
  shop.employees = 1; // Controlled original headcount, without inventing a worker.
  owner.needs = { hunger: 100, fatigue: 100, social: 90, fun: 90 };
  runtime(sim).activities[owner.id] = 'work';
  call(sim, 'setDestination', owner, site, true);
  owner.position = { ...owner.route!.at(-1)! }; // One initial placement at the original chosen work point.
  assert.ok(call(sim, 'nightRetailAtWork', owner, site), 'the original work-point/voxel contract accepts the initial body');
  const beforeTransfer = cashSnapshot(sim, sim.worldDefinition).total;
  const contribution = Math.max(0, 60 - sim.shopFunds(shop));
  assert.ok(owner.money >= contribution);
  owner.money -= contribution; sim.transferShopFunds(shop, contribution);
  near(cashSnapshot(sim, sim.worldDefinition).total, beforeTransfer, 'finite proprietor contribution moves existing money');
  call(sim, 'refreshWorkforce'); call(sim, 'reviewPrivateShifts');
  const plan = runtime(sim).privateLabor.shifts[shop.id];
  const assignment = plan.assignments.find((row: any) => row.citizenId === owner.id);
  assert.ok(assignment); assert.equal(assignment.minutesCap, 480); assert.equal(assignment.workedMinutes, 0);
  assert.ok(plan.reviews.length > 0 && plan.reviews[0].ownerId === owner.id);
  assert.ok(sim.shopFunds(shop) >= sim.shopProtectedFunds(shop));
  sim.setFocus({ ...site.door }, 'walk');
  const buyer = sim.state.citizens.find(actor => actor.id !== owner.id && sim.state.extension!.actorProfiles[actor.id].age >= 18)!;
  assert.ok(buyer && buyer.money >= shop.price * 2);
  if (night) {
    initialClock(sim, 1320 - .25);
    buyer.position = { ...site.door, z: site.door.z + 2.625 };
    buyer.needs = { hunger: 20, fatigue: 90, social: 90, fun: 90 }; buyer.food = 0;
    buyer.destinationId = site.id; buyer.state = 'moving';
    buyer.route = [{ ...buyer.position }, { ...site.door }]; buyer.routeIndex = 1;
    runtime(sim).activities[buyer.id] = 'eat'; runtime(sim).decisionAt[buyer.id] = 1440;
  }
  return { sim, shop, site, owner, buyer, plan, assignment };
}

type Fixture = ReturnType<typeof fundedFixture>;
function currentJob(f: Fixture) {
  const job = f.sim.state.nightRetail?.jobs.find(row => row.shopId === f.shop.id);
  assert.ok(job, 'ordinary facility choice must produce a real named night job');
  return job;
}
function declare(f: Fixture): void {
  const caps = JSON.stringify(f.plan.assignments.map((row: any) => [row.citizenId, row.minutesCap, row.ratePerMinute]));
  let wages = 0;
  f.sim.onEvent('wage-earned', event => { if (event.citizenId === f.owner.id) wages++; });
  f.sim.step(.25);
  const job = currentJob(f);
  assert.equal(clock(f.sim), 1320); assert.equal(job.startedAt, 1320);
  assert.equal(job.servedMinutes, 0); assert.equal(job.lastServedAt, null); assert.equal(wages, 0);
  assert.equal(nightRetailServedNow(f.sim.state, f.shop.id), false);
  assert.equal(shopScheduledOpen(f.sim.state, f.site, f.shop.id), false);
  assert.equal(caps, JSON.stringify(f.plan.assignments.map((row: any) => [row.citizenId, row.minutesCap, row.ratePerMinute])));
  assert.ok(job.endsAt <= job.startedAt + 120 && job.endsAt <= 1440);
  assert.ok(job.demandIds.includes(f.buyer.id));
}
function untilServed(f: Fixture): Event {
  let event: Event | undefined;
  f.sim.onEvent('wage-earned', row => { if (row.citizenId === f.owner.id && isCanonicalNpcWage(row, f.sim)) event = row; });
  for (let tick = 0; tick < 24 && !nightRetailServedNow(f.sim.state, f.shop.id); tick++) f.sim.step(.25);
  assert.ok(event && nightRetailServedNow(f.sim.state, f.shop.id), 'original walking must finish before a current canonical wage serves the counter');
  const job = currentJob(f);
  assert.equal(nightRetailPlannedOpen(f.sim.state, f.shop.id, job.endsAt - .25), true);
  assert.equal(nightRetailPlannedOpen(f.sim.state, f.shop.id, job.endsAt), true, 'the last energy interval may include the declared endpoint');
  assert.equal(nightRetailPlannedOpen(f.sim.state, f.shop.id, job.endsAt + .25), false, 'no planned load survives beyond the finite endpoint');
  return event;
}

test('an original funded merchant autonomously declares, walks, earns and clears one finite night meal', () => {
  const f = fundedFixture(), initialCash = cashSnapshot(f.sim, f.sim.worldDefinition).total;
  const initialStock = f.shop.inventory, originalCap = f.assignment.minutesCap, buyerMoney = f.buyer.money;
  let meals = 0, sold = 0, earned = 0, arrivalHunger: number | undefined;
  f.sim.onEvent('customer', event => { if (event.citizenId === f.buyer.id) {
    assert.equal(f.sim.isAtBuildingFunctionPoint(f.site, f.buyer.position, 'sale', { role: 'merchant', identities: ['merchant'] }), true);
    arrivalHunger = f.buyer.needs.hunger;
  } });
  f.sim.onEvent('wage-earned', event => { if (event.citizenId === f.owner.id) {
    assert.ok(isCanonicalNpcWage(event, f.sim));
    assert.ok(event.minutes! > 0 && event.minutes! <= .25);
    assert.ok(event.creditedWorkStartAt! >= currentJob(f).startedAt);
    assert.ok(event.creditedWorkEndAt! <= clock(f.sim));
    earned += event.minutes!;
  } });
  f.sim.onEvent('sale', event => { if (event.shopId === f.shop.id) {
    sold += event.quantity ?? 0;
    if (event.citizenId !== f.buyer.id) return;
    assert.ok(nightRetailServedNow(f.sim.state, f.shop.id)); assert.equal(f.sim.state.lastSystemOrder.at(-1), 'commerce');
    meals++; assert.equal(event.quantity, 2);
    near(f.buyer.money, buyerMoney - event.amount!);
    near(f.buyer.needs.hunger, arrivalHunger! + 52); assert.equal(f.buyer.food, 1);
  } });
  declare(f);
  // A shopper who saw the closed counter at22:00 keeps its real25–60 minute
  // decision deadline. Let that original reconsideration occur while the
  // funded merchant serves; do not replace the deadline or inject a queue.
  for (let tick = 0; tick < 256 && !meals; tick++) f.sim.step(.25);
  assert.equal(meals, 1, 'an actual queued arrival receives one original finite-stock receipt');
  assert.ok(earned > 0); near(f.assignment.workedMinutes, earned);
  near(currentJob(f).servedMinutes, earned, 'only post-arrival original paid-work minutes certify night service');
  assert.equal(f.assignment.minutesCap, originalCap);
  near(f.shop.inventory, initialStock - sold); near(cashSnapshot(f.sim, f.sim.worldDefinition).total, initialCash);
  const debt = debtSnapshot(runtime(f.sim));
  assert.ok(debt.byEmployer.some(row => row.citizenId === f.owner.id && row.shopId === f.shop.id && row.accruals > 0));
});

test('official, remote, hungry, tired, powerless, suspended and empty-stock operators cannot declare', () => {
  const variants: [string, (f: Fixture) => void][] = [
    ['official identity', f => { f.owner.role = '官员'; }],
    ['remote work body', f => { f.owner.position = { ...f.owner.position, x: f.owner.position.x + 500 }; }],
    ['hunger below owner threshold', f => { f.owner.needs.hunger = 49; }],
    ['fatigue below owner threshold', f => { f.owner.needs.fatigue = 44; }],
    ['no current power', f => { f.sim.state.districts[0].energy = 20; }],
    ['actual suspended title', f => { const result = applyShopLifecycleCommand(f.sim, { type: 'suspendShop', targetId: f.shop.id }, f.owner.id)!; assert.ok(result.ok, result.message); assert.equal(shopLifecycleAllowsOperation(f.sim.state, f.shop.id), false); }],
    ['synthetic empty stock boundary', f => { f.shop.inventory = 0; }],
  ];
  for (const [name, mutate] of variants) {
    const f = fundedFixture(); initialClock(f.sim, 1320); mutate(f);
    const before = f.sim.exportSave(), payroll = JSON.stringify(f.plan);
    assert.deepEqual(nightRetailOpportunities(f.sim, f.owner), [], name);
    assert.equal(beginNightRetail(f.sim, f.owner.id).ok, false, name);
    assert.equal(f.sim.exportSave(), before, `${name}: rejected declaration is atomic`);
    assert.equal(JSON.stringify(f.plan), payroll); assert.equal(f.sim.state.nightRetail, undefined);
    assert.equal(shopScheduledOpen(f.sim.state, f.site, f.shop.id), false, name);
  }
});

test('480 actual day-work minutes leave no night allowance and preserve the original earned claim', () => {
  const f = fundedFixture(false); let actualMinutes = 0;
  f.sim.onEvent('wage-earned', event => { if (event.citizenId === f.owner.id && isCanonicalNpcWage(event, f.sim)) actualMinutes += event.minutes ?? 0; });
  assert.ok(f.sim.command({ type: 'speed', value: 16 }).ok);
  for (let tick = 0; tick < 135 && f.assignment.workedMinutes < 480; tick++) f.sim.step(.25);
  assert.equal(f.assignment.workedMinutes, 480); near(actualMinutes, 480); assert.ok(clock(f.sim) < 17 * 60);
  assert.equal(runtime(f.sim).attendance[f.owner.id], 480);
  const originalClaim = debtSnapshot(runtime(f.sim)); assert.ok(originalClaim.total > 0);
  assert.ok(f.sim.command({ type: 'speed', value: 1 }).ok); initialClock(f.sim, 1320);
  const before = f.sim.exportSave(); assert.equal(beginNightRetail(f.sim, f.owner.id).ok, false);
  assert.equal(f.sim.exportSave(), before); assert.deepEqual(debtSnapshot(runtime(f.sim)), originalClaim);
  assert.equal(f.assignment.minutesCap, 480); assert.equal(f.assignment.workedMinutes, 480);
});

test('duplicate, cloned, generic, previous-clock and cross-city wages cannot refresh a counter witness', () => {
  const f = fundedFixture(); declare(f); const wage = untilServed(f);
  const beforeDuplicate = JSON.stringify(f.sim.state.nightRetail);
  f.sim.emitEvent(wage);
  assert.equal(JSON.stringify(f.sim.state.nightRetail), beforeDuplicate, 'one canonical event cannot count twice');
  f.sim.emitEvent({ ...wage });
  assert.equal(JSON.stringify(f.sim.state.nightRetail), beforeDuplicate, 'a clone is not a canonical writer receipt');
  const other = fundedFixture(); declare(other);
  const otherNight = JSON.stringify(other.sim.state.nightRetail), stock = other.shop.inventory, wallet = other.buyer.money;
  other.sim.emitEvent(wage);
  other.sim.emitEvent({ ...wage, citizenId: other.owner.id, shopId: other.shop.id, siteId: other.site.id });
  other.sim.emitEvent({ type: 'wage', citizenId: other.owner.id, shopId: other.shop.id, districtId: other.shop.districtId, amount: 1 });
  assert.equal(JSON.stringify(other.sim.state.nightRetail), otherNight);
  assert.equal(nightRetailServedNow(other.sim.state, other.shop.id), false);
  assert.equal(other.shop.inventory, stock); assert.equal(other.buyer.money, wallet);
  f.sim.step(.25); const later = JSON.stringify(f.sim.state.nightRetail);
  assert.equal(isCanonicalNpcWage(wage, f.sim), false, 'the original event belongs to an earlier clock/tick');
  f.sim.emitEvent(wage); assert.equal(JSON.stringify(f.sim.state.nightRetail), later);
  // Generic legacy wage still follows its existing debt writer. Only its use as
  // a night service certificate is rejected; no full-save atomicity is claimed.
});

test('full cold saves continue exactly while three marker/time/actor tamper categories reject atomically', () => {
  const f = fundedFixture(); declare(f); untilServed(f);
  const saved = f.sim.exportSave(), restored = new Simulation(f.sim.worldDefinition), result = restored.importSave(saved);
  assert.ok(result.ok, result.message); assert.equal(restored.exportSave(), saved);
  assert.equal(nightRetailServedNow(restored.state, f.shop.id), false, 'historical saved service does not mint a current in-memory witness');
  const mutations: [string, (data: any) => void][] = [
    ['strip runtime module marker', data => { delete data.runtime.nightRetailVersion; }],
    ['extend finite timer', data => { data.state.nightRetail.jobs[0].endsAt = data.state.nightRetail.jobs[0].startedAt + 121; }],
    ['unknown original actor', data => { data.state.nightRetail.jobs[0].operatorId = 'citizen-unknown-night'; }],
    ['hidden body cash', data => { data.state.nightRetail.cash = 1; }],
    ['hidden job escrow', data => { data.state.nightRetail.jobs[0].escrow = 1; }],
    ['hidden funding wallet', data => { data.state.nightRetail.jobs[0].funding.wallet = 1; }],
  ];
  for (const [name, mutate] of mutations) {
    const data = JSON.parse(saved); mutate(data);
    const before = restored.exportSave(); assert.equal(restored.importSave(JSON.stringify(data)).ok, false, name);
    assert.equal(restored.exportSave(), before, `${name}: entire destination save stays exact`);
  }
  for (let tick = 1; tick <= 8; tick++) {
    f.sim.step(.25); restored.step(.25);
    assert.equal(restored.exportSave(), f.sim.exportSave(), `complete warm/cold future tick ${tick}`);
  }
});

test('real night metadata is readable custody while hidden body/job/funding cash bags remain unknown', () => {
  const f = fundedFixture(); declare(f); untilServed(f);
  const literalSave = f.sim.exportSave(), saved = JSON.parse(literalSave);
  const cash = cashSnapshot(saved, f.sim.worldDefinition), food = foodCustodySnapshot(saved, f.sim.worldDefinition), debt = debtSnapshot(saved.runtime);
  assert.ok(Number.isFinite(cash.total) && Number.isFinite(food.total) && Number.isFinite(debt.total));
  near(cash.total, cashSnapshot(f.sim, f.sim.worldDefinition).total);
  const mutations: [string, (data: any) => void][] = [
    ['body.cash', data => { data.state.nightRetail.cash = 1; }],
    ['job.escrow', data => { data.state.nightRetail.jobs[0].escrow = 1; }],
    ['funding.wallet', data => { data.state.nightRetail.jobs[0].funding.wallet = 1; }],
  ];
  for (const [name, mutate] of mutations) {
    const data = structuredClone(saved); mutate(data);
    assert.throws(() => cashSnapshot(data, f.sim.worldDefinition), /CUSTODY_UNKNOWN/, name);
    assert.throws(() => foodCustodySnapshot(data, f.sim.worldDefinition), /CUSTODY_UNKNOWN/, name);
  }
  assert.equal(f.sim.exportSave(), literalSave, 'read-only custody queries change no live save');
});
