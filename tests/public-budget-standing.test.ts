import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { Simulation, type WageAccrual } from '../src/simulation';
import { savedWorldFingerprint, selectSavedWorld } from '../src/persistence/world-layout';
import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';

interface Assignment { citizenId: string; workId: string; ratePerMinute: number; minutesCap: number; workedMinutes: number }
interface Shift { id: string; day: number; approvedAt: number; siteId: string; approvedBy: string[]; cap: number; assignments: Assignment[] }
interface Labor { version: 1; standingUntilDay: number; nextReviewAt: number; jobs: Record<string, string>; shifts: Shift[]; stats: { approvedMinutes: number; unfundedMinutes: number; workedMinutes: number; privateMoves: number } }
interface Budget { id: string; siteId: string; purpose: string; cap: number; approvedAt: number; approvedBy: string[]; spent: number; closedAt: number | null; signatures: { actorId: string; role: string; siteId: string; signedAt: number }[] }
interface BudgetRuntime {
  taxes: number; investment: number;
  wages: { citizenId: string; amount: number; districtId: string; shopId?: string | null; expenseAccrued?: boolean }[];
  wageArrears?: { citizenId: string; shopId: string | null; amount: number }[];
  wageAccruals?: WageAccrual[]; publicLabor?: Labor; privateLabor?: unknown; publicBudgets?: Budget[];
}
interface Saved { state: Simulation['state']; runtime: BudgetRuntime }

const gzip = readFileSync(new URL('./fixtures/economy-original14-final.save.json.gz', import.meta.url));
assert.equal(createHash('sha256').update(gzip).digest('hex'), '3485b80b9f7414dd6d56bbd7a08b1582e0fa85ad30a7896755eaa09b05fe3e39');
const originalText = gunzipSync(gzip).toString('utf8');
assert.equal(createHash('sha256').update(originalText).digest('hex'), 'eb36bd85bcc83f798d7bfd3599bc79f1c41172b7b429bfae22aa6ccc075621d1');
const original: Saved = JSON.parse(originalText);
const world = selectSavedWorld(originalText).world;
assert.equal(savedWorldFingerprint(world), '3ae62474');

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime') as BudgetRuntime;
const readSave = (sim: Simulation): Saved => JSON.parse(sim.exportSave());
const close = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
function physicalCash(data: Saved): number {
  const s = data.state, r = data.runtime, e = s.extension!;
  return s.treasury + r.taxes + s.player.money + sum(s.citizens.map(citizen => citizen.money))
    + sum(s.shops.filter(shop => !e.companies.some(company => company.buildingId === shop.buildingId)).map(shop => shop.cash ?? 0))
    + sum(e.companies.map(company => company.capital)) + sum(e.organizations.map(organization => organization.funds))
    + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + (r.investment ?? 0))
    + (s.playerLabor?.job?.escrow ?? 0) + (s.education?.course?.escrow ?? 0)
    + sum((s.power?.repairs ?? []).map(job => job.escrow)) + sum((s.clinical?.orders ?? []).map(order => order.escrow))
    + sum((s.hygiene?.jobs ?? []).map(job => job.escrow)) + sum((s.roadworks?.jobs ?? []).map(job => job.escrow))
    + sum((s.family?.pregnancies ?? []).map(pregnancy => pregnancy.escrow)) + sum((s.family?.households ?? []).map(household => household.balance))
    + shopLifecycleHeldCash(s);
}
function obligations(data: Saved) {
  return { wages: data.runtime.wages, arrears: data.runtime.wageArrears ?? [], accruals: data.runtime.wageAccruals ?? [],
    publicLabor: data.runtime.publicLabor, privateLabor: data.runtime.privateLabor, budgets: data.runtime.publicBudgets ?? [] };
}
function authority(data: Saved) {
  const s = data.state;
  return { treasury: s.treasury, taxes: data.runtime.taxes, player: s.player, citizens: s.citizens,
    shops: s.shops, companies: s.extension!.companies, organizations: s.extension!.organizations,
    clock: { tick: s.tick, day: s.day, hour: s.hour, monotonic: s.extension!.lastUpdate }, obligations: obligations(data) };
}
function loadOriginal14() {
  const sim = new Simulation(world), result = sim.importSave(originalText);
  assert.equal(result.ok, true, result.message);
  const loaded = readSave(sim);
  assert.deepEqual(authority(loaded), authority(original), 'Import must preserve actual money, actors, old debt and signed labor; current migration metadata is separate');
  close(physicalCash(loaded), physicalCash(original), 'Import cannot add or destroy cash');
  return sim;
}
function queryWithoutMutation(sim: Simulation) {
  const before = sim.exportSave(), cash = physicalCash(JSON.parse(before));
  const result = sim.publicBudgetSnapshot();
  assert.equal(sim.exportSave(), before, 'Budget query must not mutate any persisted field');
  close(physicalCash(readSave(sim)), cash, 'Budget query cannot move any cash');
  return result;
}
function currentDay(sim: Simulation) { return Math.floor(sim.state.extension!.lastUpdate / 1440); }
function currentPublicWorker(sim: Simulation) {
  const shift = runtime(sim).publicLabor!.shifts.find(item => item.day === currentDay(sim))!;
  const assignment = shift.assignments.find(item => sim.state.citizens.some(citizen => citizen.id === item.citizenId && citizen.workId === item.workId))!;
  assert.ok(assignment, 'Original native signed shift must still have a matching worker');
  return { assignment, citizen: sim.state.citizens.find(citizen => citizen.id === assignment.citizenId)! };
}
const allowance = (sim: Simulation, citizen: Simulation['state']['citizens'][number]) => Reflect.get(sim, 'publicWorkAllowance').call(sim, citizen) as number;

test('the genuine frozen fourteen-day save releases only the expired forecast lock, with all cash and old obligations unchanged', () => {
  const sim = loadOriginal14(), r = runtime(sim), before = obligations(readSave(sim));
  assert.equal(currentDay(sim), 14); assert.equal(r.publicLabor!.standingUntilDay, 8);
  const budget = queryWithoutMutation(sim);
  close(budget.cash, 11198.788716185003, 'Original actual treasury');
  close(budget.publicWagesDue, 0, 'Original public due wages');
  close(budget.publicWagesEarned, 202.1480779158566, 'Original actual earned wages remain protected');
  close(budget.forecastPayroll, 11863.680566496138, 'Full staffing forecast remains visible');
  close(budget.reservedPayroll, 4844.988290139066, 'Original unworked signed cap remains protected');
  close(budget.essentialOperations, 2073.6, 'Original necessary operations remain protected');
  close(budget.reserve, 7120.736368054922, 'Only actual protected commitments enter the expired-standing reserve');
  close(budget.available, 4078.0523481300806, 'Available existing cash is not a new appropriation');
  assert.deepEqual(obligations(readSave(sim)), before);
});

// The remaining tests are explicitly query-boundary fixtures. They change only
// accounting inputs described by each test, never actors/cash/needs/skills or
// monotonic time, and do not claim natural passage, new approval or save validity.
test('the explicit no-finite-labor boundary keeps the whole standing payroll forecast protected', () => {
  const sim = loadOriginal14(), r = runtime(sim), { citizen } = currentPublicWorker(sim);
  delete r.publicLabor; // Query boundary: no finite schedule, not an imported alteration of the original artifact.
  const budget = queryWithoutMutation(sim);
  assert.equal(budget.reservedPayroll, 0); assert.equal(allowance(sim, citizen), 480);
  close(budget.reserve, budget.publicWagesDue + budget.publicWagesEarned + budget.forecastPayroll + budget.essentialOperations, 'Standing forecast reserve');
  assert.equal(budget.available, 0);
});

test('an unexpired standing appropriation still protects the higher forecast and allows the original standing work cap', () => {
  const sim = loadOriginal14(), r = runtime(sim), { citizen } = currentPublicWorker(sim);
  r.publicLabor!.standingUntilDay = currentDay(sim) + 1; // Explicit deadline fixture; no clock or payment mutation.
  const budget = queryWithoutMutation(sim);
  assert.ok(budget.forecastPayroll > budget.reservedPayroll); assert.equal(allowance(sim, citizen), 480);
  close(budget.reserve, budget.publicWagesDue + budget.publicWagesEarned + budget.forecastPayroll + budget.essentialOperations, 'Unexpired standing reserve');
  assert.equal(budget.available, 0);
});

test('standing expiry is inclusive on its day, exactly matching the actual signed public work allowance', () => {
  const sim = loadOriginal14(), r = runtime(sim), { citizen, assignment } = currentPublicWorker(sim);
  r.publicLabor!.standingUntilDay = currentDay(sim); // Same-day boundary, not a simulated natural lapse.
  const budget = queryWithoutMutation(sim);
  close(allowance(sim, citizen), assignment.minutesCap - assignment.workedMinutes, 'Expired standing work must use its existing signed cap');
  close(budget.reserve, budget.publicWagesDue + budget.publicWagesEarned + budget.reservedPayroll + budget.essentialOperations, 'Same-day expired reserve');
  close(budget.available, 4078.0523481300806, 'Equality must not retain an extra forecast day');
});

test('current and future signed promises above the forecast are protected under both live and expired standing rules', () => {
  const sim = loadOriginal14(), r = runtime(sim), labor = r.publicLabor!, day = currentDay(sim);
  // Pure reserve arithmetic fixture: reuse the original native cap/rate/roster
  // as a future promise. This is not an actual new departmental authorization.
  const future = structuredClone(labor.shifts[0]); future.day = day + 1; future.id = `public-shift-${future.day}`;
  for (const assignment of future.assignments) assignment.workedMinutes = 0;
  labor.shifts.push(future);
  const committed = 4844.988290139066 + future.cap;
  labor.standingUntilDay = day + 1;
  const standing = queryWithoutMutation(sim);
  assert.ok(standing.reservedPayroll > standing.forecastPayroll);
  close(standing.reservedPayroll, committed, 'Both current and future promises survive');
  close(standing.reserve, standing.publicWagesDue + standing.publicWagesEarned + committed + standing.essentialOperations, 'Standing protects the higher actual commitment');
  labor.standingUntilDay = day;
  const expired = queryWithoutMutation(sim);
  close(expired.reserve, standing.reserve, 'Expiry cannot release a signed current or future promise');
  assert.equal(standing.available, 0); assert.equal(expired.available, 0);
});

test('expired standing still protects earned wages and the unused balance of open budgets without re-locking unworked past shifts', () => {
  const sim = loadOriginal14(), r = runtime(sim), labor = r.publicLabor!, day = currentDay(sim);
  assert.ok(labor.shifts.filter(shift => shift.day < day).some(shift => shift.assignments.some(assignment => assignment.minutesCap > assignment.workedMinutes)));
  // Budget-balance arithmetic fixture only: no signature or approval behavior
  // is asserted. No cash, wage claim, role or paid-work window is changed.
  const source = labor.shifts[0], signatures = source.approvedBy.map(actorId => ({ actorId, role: 'official', siteId: source.siteId, signedAt: source.approvedAt }));
  const budget = (id: string, cap: number, spent: number, closedAt: number | null): Budget => ({ id, cap, spent, closedAt,
    siteId: source.siteId, purpose: 'fixture-reserve-query', approvedAt: source.approvedAt, approvedBy: [...source.approvedBy], signatures: structuredClone(signatures) });
  r.publicBudgets = [budget('query-open-budget', 40, 11, null), budget('query-closed-budget', 17, 4, sim.state.extension!.lastUpdate)];
  const before = obligations(readSave(sim)), snapshot = queryWithoutMutation(sim);
  close(snapshot.reservedPayroll, 4844.988290139066, 'Unworked historical schedule hours are not new labor promises');
  close(snapshot.publicWagesEarned, 202.1480779158566, 'Previously earned labor is still a protected cash claim');
  close(snapshot.authorizedRemaining, 29, 'Only the unused open-budget balance is protected');
  close(snapshot.available, 4078.0523481300806 - 29, 'Open budget reduces available cash exactly once');
  assert.deepEqual(obligations(readSave(sim)), before, 'No old wage claim or signed schedule is trimmed by the query');
});

test('display time cannot renew an expired standing appropriation whose boundary uses the original monotonic day', () => {
  const sim = loadOriginal14(), r = runtime(sim); r.publicLabor!.standingUntilDay = currentDay(sim);
  const originalClock = sim.state.extension!.lastUpdate, expected = queryWithoutMutation(sim);
  sim.state.day = 0; sim.state.hour = 8; // Explicit display-only query fixture, not a natural or command-driven advance.
  assert.deepEqual(queryWithoutMutation(sim), expected);
  sim.state.day = 99; sim.state.hour = 23;
  assert.deepEqual(queryWithoutMutation(sim), expected);
  assert.equal(sim.state.extension!.lastUpdate, originalClock);
});

test('the genuine fourteen-day wage and signed-cap corruptions are rejected atomically without releasing old obligations', () => {
  const sim = loadOriginal14(), normalized = sim.exportSave(), before = obligations(readSave(sim));
  const earned: Saved = JSON.parse(normalized);
  const claim = earned.runtime.wageAccruals!.find(item => item.shopId === null && item.amount > 0);
  assert.ok(claim, 'The original save must contain an actual earned public wage claim');
  claim.amount += 1; // Corrupt only the incoming amount; never alter the live claim or original artifact.
  const wageResult = sim.importSave(JSON.stringify(earned));
  assert.equal(wageResult.ok, false); assert.match(wageResult.message, /earned wage contract amount/);
  assert.equal(sim.exportSave(), normalized, 'Rejected wage input must leave the entire live save unchanged');
  assert.deepEqual(obligations(readSave(sim)), before);

  const promised: Saved = JSON.parse(normalized);
  const shift = promised.runtime.publicLabor!.shifts.find(item => item.day === currentDay(sim) && item.cap > 0);
  assert.ok(shift, 'The original save must contain an actual current signed public labor cap');
  shift.cap += 1; // Incoming cap no longer equals its unchanged original signed assignment amounts.
  const capResult = sim.importSave(JSON.stringify(promised));
  assert.equal(capResult.ok, false); assert.match(capResult.message, /public committed payroll conservation/);
  assert.equal(sim.exportSave(), normalized, 'Rejected cap input must leave the entire live save unchanged');
  assert.deepEqual(obligations(readSave(sim)), before);
  close(queryWithoutMutation(sim).available, 4078.0523481300806, 'Bad input cannot release or replace any protected obligation');
});

test('the genuine fourteen-day save normalizes once and continues for twenty-four original fixed ticks with exact full-state restoration', () => {
  const sim = loadOriginal14(), normalized = sim.exportSave(), clone = new Simulation(world);
  const restored = clone.importSave(normalized);
  assert.equal(restored.ok, true, restored.message);
  assert.equal(clone.exportSave(), normalized, 'An already normalized current save must restore byte exactly');
  const openingCash = physicalCash(readSave(sim)), openingTick = sim.state.tick;
  // Preserve the original world, clock, speed, focus, positions, identities,
  // needs and financial contracts. No controller hooks or new commands run.
  for (let tick = 1; tick <= 24; tick++) {
    sim.step(.25); clone.step(.25);
    assert.equal(sim.state.tick, openingTick + tick, 'Each original fixed core step advances exactly one tick');
    assert.equal(clone.exportSave(), sim.exportSave(), `Restored whole state must match at continuation tick ${tick}`);
    assert.ok(Math.abs(physicalCash(readSave(sim)) - openingCash) < 1e-6, `Actual complete cash must be conserved at continuation tick ${tick}`);
    assert.deepEqual(queryWithoutMutation(clone), queryWithoutMutation(sim), `Read-only budget views must match at continuation tick ${tick}`);
  }
});
