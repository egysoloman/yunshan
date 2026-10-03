import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation.ts';
import { createWorld } from '../src/world.ts';
import { world } from './governance-fixture.ts';
import { runtime } from './clinical-presence-fixture.ts';

// One-time authority/physical intent fixtures only. All appointees, their
// qualifications, wallets, needs, skills, shops and organization balances are
// constructor data. No ongoing pin, role/education grant or cash replenishment.
function setup(minimumEducation = 2) {
  const sim = new Simulation(world()), s = sim.state, e = s.extension!;
  const hall = sim.worldDefinition.buildings.find(site => site.kind === 'hall')!;
  const work = hall.functionPoints!.find(point => point.floor === 0 && point.purpose === 'work')!;
  const npc = s.citizens.find(person => {
    const profile = e.actorProfiles[person.id];
    return profile.alive && profile.age >= 18 && (person.education ?? 0) >= minimumEducation
      && !s.shops.some(shop => shop.ownerId === person.id)
      && !e.companies.some(company => company.ownerId === person.id);
  })!;
  assert.ok(npc, 'constructor supplies a genuinely qualified adult, without editing education');
  s.player.role = 'mayor'; s.player.identities = [...new Set([...(s.player.identities ?? []), 'mayor' as const])];
  assert.equal(sim.isAtBuildingFunctionPoint(hall, work.position, 'work', s.player), true);
  sim.setFocus(work.position, 'walk');
  npc.position = { ...work.position }; // One initial nearby appointee, not a commuting claim.
  assert.ok(sim.publicBudgetSnapshot().available >= 100);
  return { sim, npc, hall, work, guild: e.organizations.find(org => org.id === 'org-guild')! };
}
function cash(sim: Simulation): number {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money
    + (s.banking?.cash ?? 0) + (s.banking?.legacyInvestmentCash ?? 0)
    + s.citizens.reduce((sum, person) => sum + person.money, 0)
    + s.shops.filter(shop => !e.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + e.companies.reduce((sum, company) => sum + company.capital, 0)
    + e.organizations.reduce((sum, organization) => sum + organization.funds, 0)
    + (s.family?.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0) ?? 0)
    + (s.family?.households.reduce((sum, household) => sum + household.balance, 0) ?? 0)
    + (s.playerLabor?.job?.escrow ?? 0)
    + (s.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0)
    + (s.education?.course?.escrow ?? 0)
    + (s.power?.repairs.reduce((sum, repair) => sum + repair.escrow, 0) ?? 0)
    + (s.hygiene?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.shopLifecycle?.leases.reduce((sum, lease) => sum + lease.depositEscrow, 0) ?? 0);
}
function exact24(sim: Simulation): void {
  const restored = new Simulation(sim.worldDefinition), saved = sim.exportSave(), result = restored.importSave(saved);
  assert.equal(result.ok, true, result.message); assert.equal(restored.exportSave(), saved);
  for (let tick = 0; tick < 24; tick++) {
    sim.step(.25); restored.step(.25);
    assert.equal(restored.exportSave(), sim.exportSave(), `exact continuation ${tick + 1}`);
  }
}
function rejectAtomic(sim: Simulation, targetId: string): void {
  const saved = sim.exportSave(); let events = 0;
  sim.onEvent('public-appointment-funded', () => events++);
  assert.equal(sim.command({ type: 'appoint', targetId, value: 1 }).ok, false);
  assert.equal(sim.exportSave(), saved, 'roles, route, funds, budget, ledger, cursor and cooldown remain byte identical');
  assert.equal(events, 0);
}
function reserve(context: ReturnType<typeof setup>, remaining: number): void {
  const { sim, hall } = context;
  const cap = sim.publicBudgetSnapshot().available - remaining;
  assert.ok(cap > 0);
  assert.equal(sim.authorizePublicBudget({ id: 'appointment-protection', siteId: hall.id, purpose: 'protected-public-contract', cap,
    approvedAt: sim.state.extension!.lastUpdate, approvedBy: ['player'] }), true);
  assert.ok(Math.abs(sim.publicBudgetSnapshot().available - remaining) < 1e-7);
}

test('qualified appointment transfers public training funds to the existing guild, with exact continuation', () => {
  const { sim, npc, hall, guild } = setup(), e = sim.state.extension!;
  const funds = cash(sim), treasury = sim.state.treasury, received = guild.funds, player = sim.state.player.money;
  const qualifications = { education: npc.education, skills: structuredClone(npc.skills), profile: structuredClone(e.actorProfiles[npc.id]), money: npc.money };
  const beforeLedger = e.publicLedger.length;
  const events: unknown[] = [];
  sim.onEvent('public-appointment-funded', event => events.push(event));
  const result = sim.command({ type: 'appoint', targetId: npc.id, value: 1 });
  assert.equal(result.ok, true, result.message); assert.ok(result.message.includes(guild.name));
  assert.ok(result.message.includes('培训尚待实际开展'));
  assert.equal(sim.state.treasury, treasury - 100); assert.equal(guild.funds, received + 100);
  assert.ok(Math.abs(cash(sim) - funds) < 1e-7); assert.equal(sim.state.player.money, player);
  assert.equal(npc.role, 'council'); assert.equal(npc.workId, hall.id);
  assert.equal(npc.destinationId, null); assert.deepEqual(npc.route, []); assert.equal(npc.routeIndex, 0);
  assert.equal(npc.historyTags!.filter(tag => tag === '公共职务任命').length, 1);
  assert.deepEqual({ education: npc.education, skills: npc.skills, profile: e.actorProfiles[npc.id], money: npc.money }, qualifications,
    'appointment funds future training; no completed education, skills or resident bonus');
  assert.equal(e.publicLedger.length, beforeLedger + 1);
  assert.deepEqual(e.publicLedger.at(-1), { tick: sim.state.tick, actorId: 'player', amount: -100, purpose: '公共岗位任命与培训', account: 'public', districtId: hall.districtId });
  assert.deepEqual(events, [{ type: 'public-appointment-funded', amount: 100, citizenId: npc.id, siteId: hall.id, districtId: hall.districtId, purpose: 'org-guild' }]);
  rejectAtomic(sim, npc.id); exact24(sim); rejectAtomic(sim, npc.id);
});

test('official and scientist appointments keep the original fee and education thresholds', () => {
  for (const index of [0, 2] as const) {
    const { sim, npc, guild } = setup(index === 2 ? 3 : 2), before = cash(sim), treasury = sim.state.treasury;
    assert.equal(sim.command({ type: 'appoint', targetId: npc.id, value: index }).ok, true);
    assert.equal(npc.role, index === 0 ? 'official' : 'scientist');
    assert.equal(sim.state.treasury, treasury - 100); assert.equal(guild.funds, 100);
    assert.ok(Math.abs(cash(sim) - before) < 1e-7);
  }
});

test('a missing guild refuses the whole appointment instead of inventing a recipient', () => {
  const { sim, npc } = setup();
  sim.state.extension!.organizations = sim.state.extension!.organizations.filter(org => org.id !== 'org-guild');
  rejectAtomic(sim, npc.id);
});
test('guild ID with another kind refuses the whole appointment', () => {
  const { sim, npc, guild } = setup(); guild.kind = 'culture'; rejectAtomic(sim, npc.id);
});
test('invalid or capped receiver funds refuse atomically', async t => {
  // Deliberately corrupt/cap the receiver to exercise rejection. These are not
  // passing economic scenarios and do not assert conservation of invented funds.
  for (const value of [-1, NaN, Infinity, 1e9 - 99, 1e9]) await t.test(String(value), () => {
    const { sim, npc, guild } = setup(); guild.funds = value; rejectAtomic(sim, npc.id);
    assert.equal(Object.is(guild.funds, value), true);
  });
});
test('authorized public budget blocks appointment even when treasury has more than 100', () => {
  const context = setup(), { sim, npc } = context;
  const before = cash(sim); reserve(context, 50);
  assert.equal(cash(sim), before); assert.ok(sim.state.treasury > 100);
  assert.ok(sim.publicBudgetSnapshot().authorizedRemaining > 0);
  assert.equal(sim.publicBudgetSnapshot().available, 50); rejectAtomic(sim, npc.id);
});
test('a real native public work escrow and authorized budget take priority over appointment', () => {
  const context = setup(), { sim, npc } = context; reserve(context, 150);
  const before = cash(sim), treasury = sim.state.treasury;
  const work = sim.command({ type: 'work' }); assert.equal(work.ok, true, work.message);
  assert.equal(sim.state.playerLabor!.job!.employer.kind, 'public');
  assert.equal(sim.state.playerLabor!.job!.escrow, 95);
  assert.equal(sim.state.treasury, treasury - 95); assert.ok(Math.abs(cash(sim) - before) < 1e-7);
  assert.equal(sim.publicBudgetSnapshot().available, 55); assert.ok(sim.state.treasury > 100);
  rejectAtomic(sim, npc.id); assert.equal(sim.state.playerLabor!.job!.escrow, 95);
});
test('real onsite earned public wages stay protected alongside authorized contracts', () => {
  const context = setup(), { sim, npc, hall, work } = context;
  const staff = sim.state.citizens.find(person => person.workId === hall.id && person.id !== npc.id && person.role !== '学生'
    && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  assert.ok(staff, 'constructor has a real public employee');
  staff.position = { ...work.position }; staff.destinationId = hall.id;
  staff.route = [{ ...work.position }]; staff.routeIndex = 1;
  runtime(sim).activities[staff.id] = 'work'; runtime(sim).decisionAt[staff.id] = sim.state.day * 1440 + sim.state.hour * 60 + 60;
  for (let tick = 0; tick < 16 && !runtime(sim).wageAccruals?.some((item: { citizenId: string; shopId: string | null; amount: number }) => item.citizenId === staff.id && item.shopId === null && item.amount > 0); tick++) sim.step(.25);
  assert.ok(runtime(sim).wageAccruals.some((item: { citizenId: string; shopId: string | null; amount: number }) => item.citizenId === staff.id && item.shopId === null && item.amount > 0), 'actual people-phase attendance earns the wage; no injected claim');
  const actualWages = sim.publicBudgetSnapshot();
  assert.ok(actualWages.publicWagesEarned > 0);
  reserve(context, 50);
  console.log('actual public wage and budget protection', JSON.stringify({ earned: actualWages.publicWagesEarned, beforeAuthorization: actualWages, afterAuthorization: sim.publicBudgetSnapshot() }));
  assert.equal(sim.publicBudgetSnapshot().publicWagesEarned, actualWages.publicWagesEarned);
  assert.ok(sim.publicBudgetSnapshot().available < 100); assert.ok(sim.state.treasury > 100);
  // Appointment target is still the original nearby adult after this short
  // ordinary continuation; no repeated positioning to force command success.
  assert.ok(Math.hypot(sim.state.player.position.x - npc.position.x, sim.state.player.position.y - npc.position.y, sim.state.player.position.z - npc.position.z) <= 24);
  rejectAtomic(sim, npc.id);
});
test('genuine original21 paid appointment save receives no historical backfill', () => {
  const raw = readFileSync(new URL('./fixtures/appointment-old21-after.json', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'), 'ccd21438c49f6dd6e76007c9b8f6c0ff4a218492c1082e099b349d3cbc1c91d2');
  const original = JSON.parse(raw), sim = new Simulation(createWorld()), result = sim.importSave(raw);
  assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), raw, 'no treasury refund or guild backfill on load');
  assert.equal(sim.state.treasury, original.state.treasury);
  assert.deepEqual(sim.state.extension!.organizations, original.state.extension.organizations);
  assert.equal(sim.state.citizens.find(person => person.id === 'citizen-2')!.role, 'council');
  const saved = sim.exportSave(); assert.equal(sim.command({ type: 'appoint', targetId: 'citizen-2', value: 1 }).ok, false);
  assert.equal(sim.exportSave(), saved); exact24(sim);
});
