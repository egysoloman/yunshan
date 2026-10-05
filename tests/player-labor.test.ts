import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import type { BuildingKind, WorldDefinition } from '../src/types';

function fixture(): Simulation {
  const kinds: BuildingKind[] = ['home', 'market', 'farm', 'workshop', 'hall', 'school', 'bank'];
  const buildings = kinds.map((kind, index) => ({ id: kind, kind, name: kind, districtId: 'district',
    position: { x: index * 40, y: 20, z: 0 }, door: { x: index * 40, y: 20, z: 6 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 500, seed: index }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: 'district', name: site.name, position: { ...site.door }, station: true }));
  const world: WorldDefinition = { seed: 20261001, size: 1000, voxelSize: .2, buildings, nodes,
    edges: nodes.slice(1).map((node, index) => ({ id: `road-${index}`, mode: 'road', from: nodes[index].id, to: node.id, length: 40, capacity: 20, points: [nodes[index].position, node.position] })),
    districts: [{ id: 'district', name: '现场劳动', kind: 'market', radius: 500, center: { x: 100, y: 20, z: 0 }, color: '#abc', population: 96 }],
    spawn: { ...buildings[1].door }, mountains: [], river: [], waterfall: { top: { x: 400, y: 40, z: 300 }, bottom: { x: 400, y: 20, z: 300 }, width: 10 } };
  const sim = new Simulation(world), shop = sim.state.shops.find(shop => shop.buildingId === 'market')!;
  // Opening working capital is a traceable transfer from an existing resident.
  const investor = sim.state.citizens.find(person => person.money >= 200)!;
  investor.money -= 200; sim.transferShopFunds(shop, 200);
  sim.state.player.needs = { hunger: 95, fatigue: 95, social: 90, fun: 90 };
  sim.setFocus(buildings[1].door, 'walk'); return sim;
}
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
function cash(sim: Simulation) {
  const state = sim.state, ext = state.extension!;
  return state.treasury + runtime(sim).taxes + state.player.money + state.citizens.reduce((sum, actor) => sum + actor.money, 0)
    + state.banking!.cash + state.banking!.legacyInvestmentCash + (state.playerLabor!.job?.escrow ?? 0)
    + ext.companies.reduce((sum, company) => sum + company.capital, 0)
    + state.shops.filter(shop => !ext.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + ext.organizations.reduce((sum, org) => sum + org.funds, 0)
    + state.family!.households.reduce((sum, account) => sum + account.balance, 0)
    + state.family!.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0);
}
function minutes(sim: Simulation, value: number) { for (let tick = 0; tick < value * 4; tick++) sim.step(.25); }
function go(sim: Simulation, id: string) { sim.setFocus(sim.worldDefinition.buildings.find(site => site.id === id)!.door, 'walk'); }
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('starting work holds funded cash; only sixty actual onsite minutes finish and release wages', () => {
  const sim = fixture(), shop = sim.state.shops.find(shop => shop.buildingId === 'market')!;
  const supply = cash(sim), wallet = sim.state.player.money, capital = sim.shopFunds(shop), experience = sim.state.player.experience;
  const result = sim.command({ type: 'work', targetId: 'market' }); assert.equal(result.ok, true, result.message);
  assert.equal(sim.state.player.money, wallet); assert.equal(sim.shopFunds(shop), capital - 35); assert.equal(sim.state.playerLabor!.job!.escrow, 35); near(cash(sim), supply);
  const before = sim.exportSave(); assert.equal(sim.command({ type: 'work', targetId: 'farm' }).ok, false); assert.equal(sim.exportSave(), before);
  minutes(sim, 59.75); assert.equal(sim.state.playerLabor!.job!.workedMinutes, 59.75); assert.equal(sim.state.player.experience, experience);
  near(sim.state.playerLabor!.job!.paidGross, 35 * 59.75 / 60); near(cash(sim), supply);
  sim.step(.25); assert.equal(sim.state.playerLabor!.job, null); assert.equal(sim.state.playerLabor!.stats.completed, 1);
  const ended = sim.state.playerLabor!.history.at(-1)!;
  assert.equal(ended.workedMinutes, 60); assert.equal(ended.paidGross, 35); near(ended.paidNet, 32.2); near(ended.paidTax, 2.8);
  assert.equal(sim.state.player.experience, experience + 1); near(cash(sim), supply);
});

test('leaving and display-time changes pause work; cancellation returns only unearned escrow once', () => {
  const sim = fixture(), supply = cash(sim);
  assert.equal(sim.command({ type: 'work', targetId: 'market' }).ok, true); minutes(sim, 10);
  const job = sim.state.playerLabor!.job!; near(job.workedMinutes, 10); const paid = job.paidGross;
  go(sim, 'home'); minutes(sim, 10); assert.equal(job.status, 'paused'); assert.equal(job.paidGross, paid);
  go(sim, 'market'); sim.command({ type: 'setTime', value: 23 }); minutes(sim, 5); assert.equal(job.paidGross, paid);
  sim.command({ type: 'setTime', value: 10 }); assert.equal(job.paidGross, paid); minutes(sim, 5); assert.equal(job.workedMinutes, 15);
  const shop = sim.state.shops.find(shop => shop.buildingId === 'market')!, capital = sim.shopFunds(shop), refund = job.escrow;
  assert.equal(sim.command({ type: 'cancelWork' }).ok, true); assert.equal(sim.state.playerLabor!.job, null);
  near(sim.shopFunds(shop), capital + refund); assert.equal(sim.state.playerLabor!.history.at(-1)!.status, 'cancelled'); near(cash(sim), supply);
  const once = sim.exportSave(); assert.equal(sim.command({ type: 'cancelWork' }).ok, false); assert.equal(sim.exportSave(), once);
});

test('tax changes preserve actual net-pay receipts and the original gross wage', () => {
  const sim = fixture(); sim.state.player.identities = ['traveler', 'mayor'];
  assert.equal(sim.command({ type: 'work', targetId: 'market' }).ok, true); minutes(sim, 30);
  const job = sim.state.playerLabor!.job!; near(job.paidNet, 17.5 * .92);
  go(sim, 'hall'); const policy = sim.command({ type: 'policy', taxRate: .2, policeBudget: sim.state.policeBudget }); assert.equal(policy.ok, true, policy.message);
  minutes(sim, 119); near(job.workedMinutes, 30); assert.equal(sim.state.taxRate, .08, 'the existing two-hour legislative delay is preserved');
  minutes(sim, 1); assert.equal(sim.state.taxRate, .2);
  go(sim, 'market'); minutes(sim, 30);
  const closed = sim.state.playerLabor!.history.at(-1)!; assert.equal(closed.gross, 35); near(closed.paidNet, 17.5 * (.92 + .8)); near(closed.paidTax, 17.5 * (.08 + .2));
});

test('public work uses protected real treasury escrow, releases earnings and refunds the unused remainder', () => {
  const sim = fixture(); sim.state.player.identities = ['traveler', 'teacher']; go(sim, 'school');
  const supply = cash(sim), treasury = sim.state.treasury;
  assert.equal(sim.command({ type: 'work', targetId: 'school' }).ok, true); assert.equal(sim.state.treasury, treasury - 62); near(cash(sim), supply);
  const job = sim.state.playerLabor!.job!; assert.equal(job.employer.kind, 'public');
  minutes(sim, 15); near(job.paidGross, 15.5); const beforeRefund = sim.state.treasury;
  assert.equal(sim.command({ type: 'cancelWork' }).ok, true); near(sim.state.treasury, beforeRefund + 46.5); near(cash(sim), supply);
  const transfers = sim.state.extension!.publicLedger.filter(entry => entry.sourceEvent === 'public-payroll-escrow');
  assert.deepEqual(transfers.map(entry => entry.amount), [-62, 46.5]);
  const claimant = sim.state.citizens.find(person => person.money + sim.state.treasury < 1e9)!;
  claimant.money += sim.state.treasury; sim.state.treasury = 0; // Insolvent opening boundary; the existing cash remains owned.
  const before = sim.exportSave(); assert.equal(sim.command({ type: 'work', targetId: 'school' }).ok, false); assert.equal(sim.exportSave(), before);
});

test('death preserves earned pay and returns unearned employer funds without inventing inheritance', () => {
  const sim = fixture(); assert.equal(sim.command({ type: 'work', targetId: 'market' }).ok, true); minutes(sim, 15);
  const job = sim.state.playerLabor!.job!, shop = sim.state.shops.find(shop => shop.buildingId === 'market')!, funds = sim.shopFunds(shop), supply = cash(sim);
  sim.state.extension!.actorProfiles.player.alive = false; sim.state.extension!.actorProfiles.player.health = 0;
  sim.step(.25); assert.equal(sim.state.playerLabor!.job, null); near(sim.shopFunds(shop), funds + 26.25);
  assert.equal(sim.state.playerLabor!.history.at(-1)!.endReason, 'worker-deceased'); assert.equal(job.paidGross, 8.75); near(cash(sim), supply);
});

test('a half-completed funded job saves and resumes exactly; malformed payroll rejects atomically', () => {
  const sim = fixture(); assert.equal(sim.command({ type: 'work', targetId: 'market' }).ok, true); minutes(sim, 30);
  const valid = sim.exportSave(), restored = new Simulation(sim.worldDefinition);
  assert.equal(restored.importSave(valid).ok, true); assert.equal(restored.exportSave(), valid);
  for (const corrupt of [
    (data: any) => { data.state.playerLabor.job.escrow++; },
    (data: any) => { data.state.playerLabor.job.employer.shopId = 'missing'; },
    (data: any) => { data.state.playerLabor.job.paidNet++; },
    (data: any) => { data.state.playerLabor.job.startedAt = data.state.extension.lastUpdate; },
    (data: any) => { data.state.playerLabor.job.status = 'completed'; },
    (data: any) => { data.state.playerLabor.stats.paidGross++; },
    (data: any) => { data.state.playerLabor.lastObservedAt = data.state.extension.lastUpdate + 1; },
    (data: any) => { delete data.state.playerLabor; },
  ]) { const data = JSON.parse(valid); corrupt(data); assert.equal(sim.importSave(JSON.stringify(data)).ok, false); assert.equal(sim.exportSave(), valid); }
  for (let tick = 0; tick < 120; tick++) { sim.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), sim.exportSave()); assert.equal(sim.state.playerLabor!.stats.completed, 1);
});
