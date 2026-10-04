import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation.ts';
import { getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import { fixture, attachControls, pin, runtime, station, advance, cash, close, type Controls } from './education-fixture.ts';
import type { ServiceOrder } from '../src/simulation/culture.ts';
import type { Building, WorldDefinition } from '../src/types.ts';

/** Controlled opening world and fixed station/needs fixtures. Councillors,
 * teachers, doctors, money, finite shop inventory and employment are ORIGINAL
 * constructor data. No fabricated appointment, salary, approval or materials.
 * Historical high-cost quote fixture is explicit, not natural production. */
function definition(council = true): WorldDefinition {
  const world = fixture(), original = world.buildings.find(b => b.kind === 'workshop')!;
  const anchor = world.nodes.find(n => n.id === `${original.id}-door`)!;
  for (const [index, offset] of [[2, 32], [3, -32]] as const) {
    const building = { ...original, id: `education-workshop-${index}`, name: `有限教材工坊${index}`, seed: 20 + index,
      position: { ...original.position, z: offset }, door: { ...original.door, z: offset + original.door.z } };
    world.buildings.push(building); const node = { id: `${building.id}-door`, name: building.name, districtId: building.districtId, position: { ...building.door }, station: true };
    world.nodes.push(node); world.edges.push({ id: `education-workshop-link-${index}`, mode: 'road', from: anchor.id, to: node.id, length: Math.abs(offset), capacity: 20, points: [anchor.position, node.position] });
  }
  if (council) {
    // Declared before construction: native council workforce, not role edits.
    const chamber = world.buildings.find(b => b.kind === 'bank')!;
    Object.assign(chamber, { kind: 'hall', facility: 'council', width: 50, depth: 38, height: 11.4, floors: 3, floorPlanProfile: 'v4-program-bodies-02' });
    chamber.door = { ...chamber.position, y: .6, z: 19 };
    chamber.functionPoints = Array.from({ length: chamber.floors }, (_, floor) => getBuildingUsePoints(chamber, floor)).flat();
    const node = world.nodes.find(n => n.id === `${chamber.id}-door`)!; node.position = { ...chamber.door };
    for (const edge of world.edges) { if (edge.from === node.id) edge.points[0] = node.position; if (edge.to === node.id) edge.points[edge.points.length - 1] = node.position; edge.length = Math.hypot(edge.points[0].x - edge.points.at(-1)!.x, edge.points[0].y - edge.points.at(-1)!.y, edge.points[0].z - edge.points.at(-1)!.z); }
  }
  return world;
}
function setup(topic: 'education' | 'health' = 'education', council = true) {
  const world = definition(council), sim = new Simulation(world), controls: Controls = new Map();
  assert.equal(sim.state.citizens.length, 384);
  const hall = world.buildings.find(b => b.kind === 'hall' && !b.facility)!, site = world.buildings.find(b => b.kind === (topic === 'education' ? 'school' : 'clinic'))!;
  const staff = sim.state.citizens.find(c => c.workId === site.id && c.role === (topic === 'education' ? '老师' : '医生') && sim.state.extension!.actorProfiles[c.id].age >= 18)!;
  const councilSite = world.buildings.find(b => b.facility === 'council');
  const councillors = sim.state.citizens.filter(c => c.workId === councilSite?.id && c.role === '议员' && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 2);
  const officials = sim.state.citizens.filter(c => c.workId === hall.id && c.role === '官员' && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 2);
  assert.equal(officials.length, 2); if (council) assert.equal(councillors.length, 2);
  for (const person of sim.state.citizens) { const home = world.buildings.find(b => b.id === person.homeId)!; pin(sim, controls, person.id, home, home.door); }
  for (const person of officials) pin(sim, controls, person.id, hall, station(hall), 'work');
  pin(sim, controls, staff.id, site, station(site), 'work'); attachControls(sim, controls); sim.setFocus(hall.door, 'walk');
  const result = sim.command({ type: 'filePetition', targetId: topic, title: '有限补充服务', text: '居民请求真实教师或医生在合法站点以实购有限材料提供服务，费用超过部门额度须另经议会审批。' }); assert.equal(result.ok, true, result.message);
  const petition = sim.state.culture!.petitions.at(-1)!;
  const signers = sim.state.citizens.filter(c => c.id !== staff.id && !officials.includes(c) && !councillors.includes(c) && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 3);
  for (const person of signers) pin(sim, controls, person.id, hall, station(hall));
  advance(sim, 4); assert.ok(petition.signerIds.length >= 3);
  // Original controlled deadline boundary, not a natural one-day observation.
  const delta = petition.replyAt - 2 - sim.state.extension!.lastUpdate;
  sim.state.extension!.lastUpdate += delta; sim.state.family!.lastUpdate += delta; sim.state.culture!.lastUpdate += delta;
  advance(sim, 2);
  const order = sim.state.culture!.orders.find(o => o.id === petition.executionId)!; assert.ok(order);
  // Seed an explicitly declared cost observation. It supplies no cash/stock.
  for (const shop of sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials')) {
    sim.state.trade!.activity[shop.id] = [{ at: Math.floor(sim.state.culture!.lastUpdate / 10) * 10, sold: 0, supplied: 0, labor: 60, produced: 4, shortages: 0, earnedLaborCost: 40, actualUtilities: 0 }];
  }
  advance(sim, 2); assert.equal(order.authorizedCap, 40); assert.equal(order.spent, 40); assert.ok(order.receivedUnits > 3 && order.receivedUnits < 4);
  return { sim, controls, world, hall, site, staff, councillors, councilSite, officials, order, petition };
}
function bringCouncil(c: ReturnType<typeof setup>) {
  for (const actor of c.councillors) pin(c.sim, c.controls, actor.id, c.councilSite!, station(c.councilSite!), 'work');
  advance(c.sim, 4); assert.ok(c.councillors.every(actor => c.sim.isOnDuty(actor.id, actor.workId)));
}
function restore24(c: ReturnType<typeof setup>) {
  const save = c.sim.exportSave(), reader = new Simulation(c.world), loaded = reader.importSave(save); assert.equal(loaded.ok, true, loaded.message); assert.equal(reader.exportSave(), save); attachControls(reader, c.controls);
  for (let tick = 0; tick < 24; tick++) { c.sim.step(.25); reader.step(.25); assert.equal(reader.exportSave(), c.sim.exportSave(), `full exact continuation ${tick + 1}`); }
}
function funded(c: ReturnType<typeof setup>) {
  const { sim, order } = c, cap = order.authorizedCap, baseSignatures = [...order.approvedBy], originalPaid = order.spent;
  bringCouncil(c); const requests = sim.state.culture!.supplementalBudgets?.requests.filter(request => request.orderId === order.id);
  assert.ok(requests?.length, 'a legitimate council must authorize a separate quote-backed supplement after the original40 is exhausted');
  assert.ok(requests.length >= 1 && requests.length <= 4); assert.ok(requests[0].approvedAt !== null); assert.equal(requests[0].signatures.length, 2);
  assert.ok(requests[0].signatures.every(s => s.role === 'council')); assert.equal(requests[0].cap, Math.ceil(requests[0].quotedGross));
  for (let count = 0; count < 40 && order.receivedUnits < 6 - 1e-7; count++) advance(sim, 2);
  close(order.receivedUnits, 6); assert.equal(order.authorizedCap, cap); assert.equal(order.spent, originalPaid); assert.deepEqual(order.approvedBy, baseSignatures);
  assert.ok(order.receipts.filter(r => r.budgetId !== order.id).length >= 1);
  assert.ok(requests.every(r => r.approvedAt !== null && r.spent <= r.cap + 1e-7 && r.signatures.length === 2 && r.signatures.every(s => s.role === 'council'))); close(order.receipts.reduce((sum, r) => sum + r.quantity, 0), 6);
  assert.ok(requests[0].spent > 0); assert.equal(new Set(order.receipts.map(r => r.procurementId)).size, order.receipts.length);
}

test('partial40 then real council supplementation purchases ONLY missing stock and paid teacher completes sixty actual minutes', () => {
  const c = setup(), before = cash(c.sim); funded(c);
  const learner = c.sim.state.citizens.find(p => p.id !== c.staff.id && p.workId !== c.site.id && !c.officials.includes(p) && !c.councillors.includes(p) && c.sim.state.extension!.actorProfiles[p.id].age >= 18)!;
  pin(c.sim, c.controls, learner.id, c.site, station(c.site)); const initial = learner.education ?? 0, start = c.order.serviceMinutes[learner.id] ?? 0;
  advance(c.sim, 59.75); close((c.order.serviceMinutes[learner.id] ?? 0) - start, 59.75); assert.equal(learner.education, initial); assert.equal(c.order.consumedUnits, 0);
  advance(c.sim, .25); assert.equal(learner.education, initial + 1); assert.equal(c.order.consumedUnits, 1); assert.ok(runtime(c.sim).attendance[c.staff.id] >= 60);
  close(cash(c.sim), before, 'finite procurement/tax/wages conserve cash'); restore24(c);
});
test('health supplemental stock retains genuine twenty-minute doctor care and public waste receipts', () => {
  const c = setup('health'); funded(c);
  const patient = c.sim.state.citizens.find(p => p.id !== c.staff.id && p.workId !== c.site.id && !c.officials.includes(p) && !c.councillors.includes(p) && c.sim.state.extension!.actorProfiles[p.id].age >= 18)!;
  c.sim.state.extension!.actorProfiles[patient.id].health = 50; // Controlled patient need, not a pathogen/outbreak.
  pin(c.sim, c.controls, patient.id, c.site, station(c.site)); advance(c.sim, 19.75); assert.equal(c.order.consumedUnits, 0);
  advance(c.sim, .25); assert.equal(c.order.consumedUnits, 1); assert.equal(c.order.healthConsumptions?.length, 1); assert.equal(c.order.serviceMinutes[patient.id], 20); restore24(c);
});
test('two ordinary officials never exceed original40; forged generic events do not authorize or procure', () => {
  const c = setup('education', false), base = c.sim.exportSave(), request = c.sim.state.culture!.supplementalBudgets!.requests[0];
  for (const type of ['supplemental-budget-approved', 'civic-procurement', 'petition-reviewed']) c.sim.emitEvent({ type, budgetId: request.id, amount: request.cap, quantity: 6 });
  assert.equal(c.sim.state.culture!.supplementalBudgets!.requests[0].approvedAt, null); assert.equal(c.order.spent, 40); assert.ok(c.order.receivedUnits < 4); assert.equal(c.sim.command({ type: 'reviewPetition', targetId: c.petition.id, value: 80 }).ok, false);
  advance(c.sim, 64); assert.equal(request.approvedAt, null); assert.equal(c.order.spent, 40); assert.ok(c.order.receivedUnits < 4); assert.ok(base.length > 0); restore24(c);
});
for (const guard of ['one council member', 'unsupported council station', 'protected public cash'] as const) {
  test(`${guard} leaves supplement pending without a fake approval`, () => {
    const c = setup(), [first, second] = c.councillors, request = c.sim.state.culture!.supplementalBudgets!.requests[0];
    pin(c.sim, c.controls, first.id, c.councilSite!, station(c.councilSite!), 'work');
    if (guard === 'unsupported council station') pin(c.sim, c.controls, second.id, c.councilSite!, { ...station(c.councilSite!), y: 80 }, 'work');
    if (guard === 'protected public cash') {
      pin(c.sim, c.controls, second.id, c.councilSite!, station(c.councilSite!), 'work');
      // Existing cash transfer only. Payroll/reserves and initial40 remain.
      const existing = c.sim.publicBudgetSnapshot().available; c.sim.state.treasury -= existing; c.sim.state.citizens[0].money += existing;
      Reflect.get(c.sim.state.extension!, 'runtime').lastTreasury = c.sim.state.treasury;
      close(c.sim.publicBudgetSnapshot().available, 0);
    }
    advance(c.sim, 4); assert.equal(c.sim.isOnDuty(first.id, first.workId), true);
    if (guard === 'protected public cash') assert.equal(c.sim.isOnDuty(second.id, second.workId), true, 'both native councillors really earn funded work, but no discretionary cash remains');
    assert.equal(request.approvedAt, null); assert.equal(c.order.spent, 40); assert.ok(c.order.receivedUnits < 4);
  });
}
test('supplemental references, cap, signature, material order and duplicate receipts reject atomically', () => {
  const c = setup(); funded(c); const saved = c.sim.exportSave();
  const mutations = [
    (d: any) => { delete d.state.culture.supplementalBudgets; },
    (d: any) => { d.state.culture.supplementalBudgets.requests[0].orderId = 'service-999'; },
    (d: any) => { d.state.culture.supplementalBudgets.requests[0].cap++; },
    (d: any) => { d.state.culture.supplementalBudgets.requests[0].signatures[0].role = 'official'; },
    (d: any) => { d.state.culture.supplementalBudgets.requests[0].signatures[0].position.y += 20; },
    (d: any) => { d.state.culture.supplementalBudgets.requests[0].receiptIds.push(d.state.culture.supplementalBudgets.requests[0].receiptIds[0]); },
    (d: any) => { d.runtime.publicBudgets.find((b: any) => b.id.endsWith('supplement-1')).spent++; },
    (d: any) => { d.state.culture.orders[0].receipts[1].purchasedAt = d.state.culture.orders[0].approvedAt; },
    (d: any) => { d.state.culture.supplementalBudgets.requests.push(...Array(64).fill(d.state.culture.supplementalBudgets.requests[0])); },
  ];
  for (const mutate of mutations) { const d = JSON.parse(saved); mutate(d); const result = c.sim.importSave(JSON.stringify(d)); assert.equal(result.ok, false, result.message); assert.equal(c.sim.exportSave(), saved); }
  restore24(c);
});
test('new approval only reserves finite cash; fulfilled order closes both independent authorizations without repeated procurement', () => {
  const c = setup(); funded(c); const cashAtStart = cash(c.sim);
  const pupils = c.sim.state.citizens.filter(p => p.id !== c.staff.id && p.workId !== c.site.id && !c.officials.includes(p) && !c.councillors.includes(p) && c.sim.state.extension!.actorProfiles[p.id].age >= 18).slice(0, 6);
  for (const person of pupils) pin(c.sim, c.controls, person.id, c.site, station(c.site));
  advance(c.sim, 124); assert.equal(c.order.state, 'fulfilled'); assert.equal(c.order.consumedUnits, 6);
  const budgets = runtime(c.sim).publicBudgets.filter((b: {id: string}) => b.id === c.order.id || b.id.startsWith(`${c.order.id}-supplement-`)); assert.equal(budgets.length, 2); assert.ok(budgets.every((b: {closedAt: number | null}) => b.closedAt === c.order.completedAt));
  const receipts = c.order.receipts.length, spent = c.order.spent; advance(c.sim, 64); assert.equal(c.order.receipts.length, receipts); assert.equal(c.order.spent, spent); close(cash(c.sim), cashAtStart); restore24(c);
});
test('genuine old three-workshop partial save imports immediately byteexact without a supplemental marker', () => {
  const original = readFileSync(new URL('./fixtures/supplemental-budget/old-three-workshop-partial.save.json', import.meta.url), 'utf8'), sim = new Simulation(definition(false));
  const result = sim.importSave(original); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), original); assert.equal(sim.state.culture!.supplementalBudgets, undefined);
  const clone = new Simulation(sim.worldDefinition); assert.equal(clone.importSave(original).ok, true);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); clone.step(.25); assert.equal(clone.exportSave(), sim.exportSave()); }
});

test('approved supplemental cash cannot invent stock after genuine competing public procurement exhausts the suppliers', () => {
  const c = setup(), before = cash(c.sim), missing = 6 - c.order.receivedUnits;
  const suppliers = c.sim.state.shops.filter(shop => c.sim.shopCommodity(shop) === 'materials'), quantity = suppliers.reduce((sum, shop) => sum + shop.inventory, 0);
  // Controlled competing REAL procurement through the original treasury /
  // supplier / tax path. No fabricated receipt, inventory deletion or grant.
  const purchase = c.sim.purchasePublicSupplyReceipt({ requestedGross: 1e9, requestedQuantity: quantity, supplierShopIds: suppliers.map(shop => shop.id), eventType: 'public-procurement' });
  close(purchase.quantity, quantity); assert.ok(purchase.paid > 0); assert.ok(suppliers.every(shop => shop.inventory < 1e-7)); close(cash(c.sim), before);
  bringCouncil(c); const request = c.sim.state.culture!.supplementalBudgets!.requests[0]; assert.ok(request.approvedAt !== null);
  const pupils = c.sim.state.citizens.filter(p => p.id !== c.staff.id && p.workId !== c.site.id && !c.officials.includes(p) && !c.councillors.includes(p) && c.sim.state.extension!.actorProfiles[p.id].age >= 18).slice(0, 3);
  for (const person of pupils) pin(c.sim, c.controls, person.id, c.site, station(c.site));
  advance(c.sim, 60); assert.equal(c.order.consumedUnits, 3, 'only the three previously purchased books are used by paid real classes');
  advance(c.sim, 64); assert.equal(request.spent, 0); assert.equal(request.receiptIds.length, 0); close(6 - c.order.receivedUnits, missing);
  assert.equal(c.order.receipts.length, 1); assert.equal(c.order.consumedUnits, 3); assert.equal(c.order.state, 'awaitingSupply', 'authorization is present but there is genuinely no industrial stock');
  restore24(c);
});
