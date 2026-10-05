import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation.ts';
import { getWalkHeight } from '../src/world.ts';
import { beginClinicalTreatment, cancelClinicalTreatment, clinicalAtSite, clinicalAtPosition, clinicalVisitDeadline, takeClinicalDoctorSlot } from '../src/simulation/clinical.ts';
import { settleDeceasedAccount } from '../src/simulation/banking.ts';
import type { Building, BuildingKind, Citizen, WorldDefinition } from '../src/types.ts';

function fixture(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank', 'hall', 'station'];
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `clinical-${kind}`, name: `诊疗测试${kind}`, kind, districtId: 'clinical-district', position: { x: index * 30, y: 0, z: 0 }, door: { x: index * 30, y: 0, z: 5 }, width: 12, depth: 12, height: 12, floors: 2, rotation: 0, capacity: 100, seed: index }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, name: site.name, districtId: site.districtId, position: { ...site.door }, station: true }));
  return { seed: 20261001, voxelSize: .2, size: 1000, buildings, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `clinical-road-${index}`, mode: 'road', from: nodes[index].id, to: node.id, length: 30, capacity: 20, points: [nodes[index].position, node.position] })), mountains: [], river: [], waterfall: { top: { x: 300, y: 60, z: 100 }, bottom: { x: 300, y: 0, z: 100 }, width: 10 }, districts: [{ id: 'clinical-district', name: '诊疗测试街坊', kind: 'school', center: { x: 120, y: 0, z: 0 }, radius: 500, color: '#aac', population: 384 }], spawn: { ...buildings[0].door } };
}
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
const clinic = (sim: Simulation) => sim.worldDefinition.buildings.find(site => site.kind === 'clinic')!;
const at = (sim: Simulation) => sim.state.extension!.lastUpdate;
function advance(sim: Simulation, minutes: number) { const deadline = at(sim) + minutes; for (let i = 0; at(sim) < deadline - 1e-7 && i < 10000; i++) sim.step(.25); assert.ok(at(sim) >= deadline - 1e-7); }
function pin(sim: Simulation, personId: string, site: Building, activity: 'social' | 'work' = 'social') {
  const person = sim.state.citizens.find(citizen => citizen.id === personId)!;
  let present = true;
  const place = () => { if (!present) return; person.position = { x: site.position.x, y: site.position.y + .6, z: site.position.z + 1.2 }; person.destinationId = site.id; person.route = []; person.routeIndex = 0; person.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; runtime(sim).activities[person.id] = activity; runtime(sim).decisionAt[person.id] = sim.state.day * 1440 + sim.state.hour * 60 + 10; };
  place(); sim.onPhase('traffic', place); return { leave() { present = false; person.position = { ...sim.worldDefinition.spawn }; person.destinationId = null; person.route = []; runtime(sim).activities[person.id] = 'social'; runtime(sim).decisionAt[person.id] = sim.state.day * 1440 + sim.state.hour * 60 + 100; }, enter() { present = true; place(); } };
}
function setup() {
  const sim = new Simulation(fixture()); assert.ok(sim.state.clinical); assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const site = clinic(sim), doctor = sim.state.citizens.find(person => sim.state.extension!.actorProfiles[person.id].age >= 18 && person.role !== '学生' && !sim.state.shops.some(shop => shop.ownerId === person.id || shop.buildingId === person.workId))!;
  assert.ok(doctor); doctor.workId = site.id; doctor.role = '医生'; const presence = pin(sim, doctor.id, site, 'work');
  sim.setFocus({ ...site.door }, 'walk'); sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100; sim.state.extension!.actorProfiles.player.health = 50;
  advance(sim, 4); assert.equal(sim.isOnDuty(doctor.id, site.id), true, 'doctor must accrue genuine attendance, not a supplied counter');
  return { sim, site, doctor, presence };
}
function begin(sim: Simulation, patientId = 'player', payerId = 'player') { const result = beginClinicalTreatment(sim, { patientId, payerId, siteId: clinic(sim).id }); assert.equal(result.ok, true, result.message); return sim.state.clinical!.orders.at(-1)!; }
function restore(sim: Simulation) { const next = new Simulation(sim.worldDefinition), result = next.importSave(sim.exportSave()); assert.equal(result.ok, true, result.message); assert.equal(next.exportSave(), sim.exportSave()); return next; }
function cash(sim: Simulation) { const s = sim.state, e = s.extension!; return s.treasury + runtime(sim).taxes + s.player.money + s.banking!.cash + s.banking!.legacyInvestmentCash + s.citizens.reduce((sum, person) => sum + person.money, 0) + s.shops.filter(shop => !e.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0) + e.companies.reduce((sum, company) => sum + company.capital, 0) + e.organizations.reduce((sum, organization) => sum + organization.funds, 0) + s.family!.pregnancies.reduce((sum, item) => sum + item.escrow, 0) + s.family!.households.reduce((sum, item) => sum + item.balance, 0) + s.clinical!.orders.reduce((sum, order) => sum + order.escrow, 0); }
function atomicReject(sim: Simulation, request: Parameters<typeof beginClinicalTreatment>[1]) { const before = sim.exportSave(), result = beginClinicalTreatment(sim, request); assert.equal(result.ok, false); assert.equal(sim.exportSave(), before); }

test('paid care starts with real adult funding and public clinic presence, without instant health', () => {
  const { sim, site, doctor } = setup(), money = sim.state.player.money, health = sim.state.extension!.actorProfiles.player.health;
  sim.setFocus(sim.worldDefinition.spawn, 'walk'); atomicReject(sim, { patientId: 'player', payerId: 'player', siteId: site.id });
  sim.setFocus({ ...site.door }, 'walk'); const doctors = sim.state.citizens.filter(person => person.workId === site.id && ['医生', 'doctor'].includes(person.role)).map(person => ({ person, role: person.role })); for (const row of doctors) row.person.role = '档案员'; atomicReject(sim, { patientId: 'player', payerId: 'player', siteId: site.id }); for (const row of doctors) row.person.role = row.role;
  const order = begin(sim); assert.equal(sim.state.player.money, money - 30); assert.equal(order.escrow, 30); assert.equal(order.workedMinutes, 0); assert.equal(sim.state.extension!.actorProfiles.player.health, health);
  atomicReject(sim, { patientId: 'player', payerId: 'player', siteId: site.id }); restore(sim);
});

test('shared clinical geometry respects rotated floor sizes, protected floors and the two-metre entrance', () => {
  const sim = new Simulation(fixture()), original = clinic(sim), site: Building = { ...original, rotation: Math.PI / 2, width: 20, depth: 6, floorFootprints: [{ width: 20, depth: 6 }, { width: 4, depth: 4 }], floorPermissions: ['public', 'doctor'] }, identity = sim.state.player;
  assert.equal(clinicalAtPosition(site, { x: site.position.x, y: .6, z: 9 }, identity), true);
  assert.equal(clinicalAtPosition(site, { x: site.position.x + 4, y: .6, z: 0 }, identity), false);
  assert.equal(clinicalAtPosition(site, { x: site.position.x, y: 6.6, z: 0 }, identity), false);
  const entrance = { ...site, door: { x: site.position.x + 20, y: 0, z: 0 } };
  assert.equal(clinicalAtPosition(entrance, { x: entrance.door.x + 2, y: 0, z: 0 }, identity), true);
  assert.equal(clinicalAtPosition(entrance, { x: entrance.door.x + 2.01, y: 0, z: 0 }, identity), false);
  assert.equal(clinicalAtPosition(site, { x: site.position.x + 20, y: .6, z: 0 }, identity), false);
  sim.setFocus({ ...original.door }, 'walk'); assert.equal(clinicalAtSite(sim, original), true);
});

test('children may receive sponsored care, but their own wallets cannot approve adult treatment funding', () => {
  const { sim, site } = setup(), child = sim.state.citizens.find(person => person.role === '学生')!; assert.ok(child); pin(sim, child.id, site);
  // Isolate a legitimate baseline student's age boundary without inventing a new resident.
  sim.state.extension!.actorProfiles[child.id].age = 12; sim.state.extension!.actorProfiles[child.id].health = 70;
  atomicReject(sim, { patientId: child.id, payerId: child.id, siteId: site.id }); const order = begin(sim, child.id); advance(sim, 22); assert.equal(order.state, 'completed'); assert.equal(order.payerId, 'player'); assert.equal(order.patientId, child.id); restore(sim);
});

test('available food cannot substitute for exhausted industrial clinical materials', () => {
  const { sim } = setup(), source = sim.state.shops.find(shop => sim.shopCommodity(shop) === 'materials')!; source.inventory = 0;
  sim.onPhase('traffic', () => { source.inventory = 0; }); assert.ok(sim.state.shops.some(shop => sim.shopCommodity(shop) === 'food' && shop.inventory > 0)); const order = begin(sim); advance(sim, 4); assert.equal(order.state, 'awaitingSupply'); assert.equal(order.escrow, 30); assert.equal(order.purchasePaid, 0); assert.equal(order.receivedUnits, 0); assert.equal(order.workedMinutes, 0);
});

test('one observed-price material and twenty actual doctor-patient minutes settle conserved cash and health', () => {
  const { sim } = setup(), supply = cash(sim), order = begin(sim), health = sim.state.extension!.actorProfiles.player.health;
  advance(sim, 2); assert.equal(order.receivedUnits, 1); assert.equal(order.workedMinutes, 0, 'purchase in finance cannot create earlier people-phase service'); assert.equal(order.receipts.length, 1); assert.equal(order.purchasePaid, order.receipts[0].lots[0].unitPrice);
  advance(sim, 18); assert.equal(order.workedMinutes, 18); assert.equal(order.consumedUnits, 0); assert.ok(sim.state.extension!.actorProfiles.player.health < health + 1, 'natural physiological effects are distinct from unfinished treatment');
  const before = sim.state.extension!.actorProfiles.player.health; advance(sim, 2); assert.equal(order.state, 'completed'); assert.equal(order.workedMinutes, 20); assert.equal(order.consumedUnits, 1); assert.equal(order.escrow, 0); assert.equal(order.purchasePaid + order.serviceFee, 30); assert.ok(sim.state.extension!.actorProfiles.player.health > before + 24.8);
  assert.ok(Math.abs(cash(sim) - supply) < 1e-5, 'tax escrow, clinic escrow, wallets and all legal recipient accounts conserve physical cash'); assert.equal(sim.state.clinical!.stock[order.siteId].consumedUnits, 1); restore(sim);
  atomicReject(sim, { patientId: 'player', payerId: 'player', siteId: order.siteId });
});

test('leaving the clinic pauses attended minutes and a resumed save continues byte-identically', () => {
  const { sim, doctor } = setup(), order = begin(sim); advance(sim, 10); assert.equal(order.workedMinutes, 8);
  sim.setFocus(sim.worldDefinition.spawn, 'walk'); advance(sim, 6); assert.equal(order.workedMinutes, 8); assert.equal(order.reservedUnits, 1);
  const next = restore(sim); pin(next, doctor.id, clinic(next), 'work');
  for (const instance of [sim, next]) { instance.setFocus({ ...clinic(instance).door }, 'walk'); advance(instance, 12); }
  assert.equal(order.state, 'completed'); assert.equal(next.exportSave(), sim.exportSave());
  for (let i = 0; i < 24; i++) { sim.step(.25); next.step(.25); } assert.equal(next.exportSave(), sim.exportSave());
});

test('a departed, hungry or deceased physician cannot supply attended work', () => {
  const { sim, presence, doctor } = setup(), order = begin(sim); advance(sim, 6); assert.equal(order.workedMinutes, 4);
  presence.leave(); advance(sim, 6); assert.equal(order.workedMinutes, 4);
  presence.enter(); advance(sim, 4); assert.equal(order.workedMinutes, 8);
  sim.state.extension!.actorProfiles[doctor.id].health = 0; advance(sim, 4); assert.equal(order.workedMinutes, 8); assert.equal(order.state, 'awaitingDoctor'); restore(sim);
});

test('missing or genuinely unaffordable material waits with escrow and creates no health or stock', () => {
  const { sim } = setup(), producers = sim.state.shops.filter(shop => ['farm', 'workshop', 'dock'].includes(sim.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.kind));
  sim.onPhase('traffic', () => { for (const shop of producers) shop.inventory = 0; }); const order = begin(sim); advance(sim, 20); assert.equal(order.receivedUnits, 0); assert.equal(order.workedMinutes, 0); assert.equal(order.escrow, 30); assert.equal(order.state, 'awaitingSupply');
  const high = setup().sim, now = at(high);
  for (const shop of high.state.shops.filter(shop => ['farm', 'workshop'].includes(high.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.kind))) high.state.trade!.activity[shop.id] = [{ at: Math.floor(now / 10) * 10, sold: 0, supplied: 0, labor: 1, produced: 1, shortages: 0, earnedLaborCost: 1000, actualUtilities: 0 }];
  const expensive = begin(high); advance(high, 2); assert.equal(expensive.state, 'awaitingSupply'); assert.equal(expensive.escrow, 30); assert.equal(expensive.receivedUnits, 0); assert.match(expensive.lastReason, /报价/); restore(high);
});

test('cancellation refunds only unused money, retaining purchased stock for exactly one later treatment', () => {
  const { sim } = setup(), order = begin(sim); advance(sim, 2); const money = sim.state.player.money, paid = order.purchasePaid;
  assert.equal(cancelClinicalTreatment(sim, order.id).ok, true); assert.equal(order.state, 'cancelled'); assert.equal(order.refunded, 30 - paid); assert.equal(sim.state.player.money, money + 30 - paid); assert.equal(sim.state.clinical!.stock[order.siteId].availableUnits, 1);
  const next = begin(sim); assert.equal(next.reusedUnits, 1); assert.equal(next.receivedUnits, 0); assert.equal(next.escrow, 30); advance(sim, 20); assert.equal(next.state, 'completed'); assert.equal(next.purchasePaid, 0); assert.equal(next.serviceFee, 30); assert.equal(sim.state.clinical!.stock[order.siteId].receivedUnits, 1); assert.equal(sim.state.clinical!.stock[order.siteId].consumedUnits, 1); assert.equal(sim.state.clinical!.stock[order.siteId].availableUnits, 0); restore(sim);
  const before = sim.exportSave(); assert.equal(cancelClinicalTreatment(sim, order.id).ok, false); assert.equal(sim.exportSave(), before);
});

test('unused pre-purchase cancellation transfers the same thirty real coins back exactly once', () => {
  const { sim } = setup(), before = sim.state.player.money, order = begin(sim), cashBefore = cash(sim); assert.equal(cancelClinicalTreatment(sim, order.id).ok, true); assert.equal(order.refunded, 30); assert.equal(order.purchasePaid, 0); assert.equal(sim.state.player.money, before); assert.equal(cash(sim), cashBefore); restore(sim);
});

test('payer and patient deaths both stop care; sunk material costs remain physical clinic stock', () => {
  for (const deadParty of ['patient', 'payer'] as const) {
    const { sim, site } = setup(), patient = sim.state.citizens.find(person => person.role !== '学生' && person.role !== '医生' && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
    pin(sim, patient.id, site); sim.state.extension!.actorProfiles[patient.id].health = 70;
    const order = begin(sim, patient.id); advance(sim, 2); const paid = order.purchasePaid;
    sim.state.extension!.actorProfiles[deadParty === 'patient' ? patient.id : 'player'].health = 0; advance(sim, 2);
    assert.equal(order.state, 'cancelled'); assert.equal(order.workedMinutes, 0); assert.equal(order.refunded, 30 - paid); assert.equal(order.serviceFee, 0); assert.equal(order.consumedUnits, 0); assert.equal(sim.state.clinical!.stock[site.id].availableUnits, 1); restore(sim);
  }
});

test('a capped refund stays an auditable escrow obligation until the actual payer can receive it', () => {
  const { sim } = setup(), order = begin(sim); sim.state.player.money = 1e9;
  assert.equal(cancelClinicalTreatment(sim, order.id).ok, true); assert.equal(order.state, 'refundPending'); assert.equal(order.escrow, 30); assert.equal(order.refunded, 0); restore(sim);
  sim.state.player.money -= 30; advance(sim, 2); assert.equal(order.state, 'cancelled'); assert.equal(order.escrow, 0); assert.equal(order.refunded, 30); assert.equal(sim.state.player.money, 1e9); restore(sim);
});

test('doctor capacity is shared across public and paid care and each patient gets one simultaneous slot', () => {
  const { sim, doctor } = setup(); assert.equal(takeClinicalDoctorSlot(sim, doctor.id, 'player'), true); assert.equal(takeClinicalDoctorSlot(sim, doctor.id, 'player'), false);
  assert.equal(takeClinicalDoctorSlot(sim, doctor.id, sim.state.citizens[10].id), true); assert.equal(takeClinicalDoctorSlot(sim, doctor.id, sim.state.citizens[11].id), false);
  advance(sim, 2); assert.equal(takeClinicalDoctorSlot(sim, doctor.id, 'player'), true);
});

test('a genuinely authorized public service and paid care share one real doctor rather than doubling attended capacity', () => {
  const { sim, doctor, site } = setup(), hall = sim.worldDefinition.buildings.find(building => building.kind === 'hall')!;
  for (const person of sim.state.citizens) if (person.id !== doctor.id && ['医生', 'doctor'].includes(person.role)) person.role = '档案员';
  sim.setFocus({ ...hall.door }, 'walk'); const filed = sim.command({ type: 'filePetition', targetId: 'health', title: '真实医疗服务联署', text: '山城居民请求在现有诊所增加材料有限且有医生现场履职的公共诊疗服务。' }); assert.equal(filed.ok, true, filed.message);
  const petition = sim.state.culture!.petitions[0], signers = sim.state.citizens.filter(person => person.id !== doctor.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 3); for (const person of signers) pin(sim, person.id, hall); advance(sim, 4); assert.equal(petition.signerIds.length >= 3, true);
  const officials = sim.state.citizens.filter(person => person.role === '官员' && person.workId === hall.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2); assert.equal(officials.length, 2); for (const person of officials) pin(sim, person.id, hall, 'work');
  const delta = petition.replyAt - 2 - at(sim); sim.state.extension!.lastUpdate += delta; sim.state.family!.lastUpdate += delta; sim.state.culture!.lastUpdate += delta; advance(sim, 2);
  const publicOrder = sim.state.culture!.orders[0]; assert.ok(publicOrder); for (let i = 0; i < 6 && publicOrder.state !== 'active'; i++) advance(sim, 2); assert.equal(publicOrder.state, 'active', publicOrder.lastReason); assert.equal(publicOrder.approvedBy.length, 2); assert.ok(publicOrder.receivedUnits >= 2);
  const patients = sim.state.citizens.filter(person => person.id !== doctor.id && !officials.some(official => official.id === person.id)).slice(0, 2); for (const person of patients) { pin(sim, person.id, site); sim.state.extension!.actorProfiles[person.id].health = 70; }
  sim.setFocus({ ...site.door }, 'walk'); const paid = begin(sim); advance(sim, 20);
  for (const person of patients) { assert.equal(publicOrder.serviceMinutes[person.id], 20); assert.ok(publicOrder.servedIds.includes(person.id)); }
  assert.equal(paid.workedMinutes, 0, 'the same doctor already served the two publicly funded patients during each of these ticks'); assert.equal(paid.consumedUnits, 0); assert.equal(paid.reservedUnits, 1);
  assert.equal(clinicalVisitDeadline(sim.state, patients[0].id), at(sim) + 60); atomicReject(sim, { patientId: patients[0].id, payerId: 'player', siteId: site.id }); restore(sim);
});

test('actual simultaneous paid patients occupy only two slots of one attended doctor', () => {
  const { sim, site, doctor } = setup(); for (const other of sim.state.citizens) if (other.id !== doctor.id && ['医生', 'doctor'].includes(other.role)) other.role = '档案员';
  const patients = sim.state.citizens.filter(person => person.id !== doctor.id && person.role !== '学生' && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 3);
  const orders = patients.map(person => { pin(sim, person.id, site); sim.state.extension!.actorProfiles[person.id].health = 70; return begin(sim, person.id); });
  advance(sim, 22); assert.deepEqual(orders.map(order => order.workedMinutes), [20, 20, 0]); assert.deepEqual(orders.map(order => order.state), ['completed', 'completed', 'awaitingDoctor']); advance(sim, 20); assert.equal(orders[2].state, 'completed'); restore(sim);
});

test('finite receipt, escrow, identity, timing and physical inventory corruption rejects atomically', () => {
  const { sim } = setup(); begin(sim); advance(sim, 6); const valid = sim.exportSave();
  const mutations: ((data: any) => void)[] = [
    data => { data.state.clinical.version = 2; }, data => { data.state.clinical.orders[0].patientId = 'absent'; }, data => { data.state.clinical.orders[0].payerId = 'absent'; }, data => { data.state.clinical.orders[0].siteId = 'clinical-home'; },
    data => { data.state.clinical.orders[0].escrow++; }, data => { data.state.clinical.orders[0].escrow = -1e-10; }, data => { data.state.clinical.orders[0].purchasePaid = 0; }, data => { data.state.clinical.orders[0].receipts[0].lots[0].gross++; }, data => { data.state.clinical.orders[0].receipts[0].lots[0].gross = '4'; }, data => { data.state.clinical.orders[0].receipts[0].lots[0].shopId = 'absent'; }, data => { data.state.clinical.orders[0].receipts[0].lots[0].shopId = data.state.shops.find((shop: any) => shop.buildingId === 'clinical-farm').id; }, data => { data.state.clinical.orders[0].receipts[0].commodity = 'food'; }, data => { data.state.clinical.orders[0].receipts[0].quantity = 2; },
    data => { data.state.clinical.orders[0].staffMinutes.absent = 4; }, data => { data.state.clinical.orders[0].workedMinutes = 20; }, data => { data.state.clinical.orders[0].startedAt = data.state.extension.lastUpdate; }, data => { data.state.clinical.orders[0].state = 'completed'; }, data => { data.state.clinical.orders[0].reservedUnits = 0; },
    data => { data.state.clinical.stock['clinical-clinic'].availableUnits++; }, data => { data.state.clinical.stats.funded += 30; }, data => { data.state.clinical.archived.count++; }, data => { data.state.clinical.nextVisitAt.absent = data.state.extension.lastUpdate; }, data => { data.state.clinical.orders.push(structuredClone(data.state.clinical.orders[0])); },
  ];
  for (const mutate of mutations) { const data = JSON.parse(valid); mutate(data); const result = sim.importSave(JSON.stringify(data)); assert.equal(result.ok, false, mutate.toString()); assert.equal(sim.exportSave(), valid); } restore(sim);
});

test('a real heal command delegates into the same clinical lifecycle and module deletion cannot erase escrow', () => {
  const { sim } = setup(), health = sim.state.extension!.actorProfiles.player.health;
  const result = sim.command({ type: 'heal' }); assert.equal(result.ok, true, result.message); assert.equal(sim.state.clinical!.orders.length, 1); assert.equal(sim.state.extension!.actorProfiles.player.health, health);
  const before = sim.exportSave(), data = JSON.parse(before); delete data.state.clinical; assert.equal(sim.importSave(JSON.stringify(data)).ok, false); assert.equal(sim.exportSave(), before); restore(sim);
});

test('unrefunded deceased payer escrow prevents premature bank forgiveness until the executor receives cash', () => {
  const { sim, doctor } = setup(), bank = sim.worldDefinition.buildings.find(site => site.kind === 'bank')!;
  const depositor = sim.state.citizens.find(person => person.id !== doctor.id && person.money > 400 && sim.state.extension!.actorProfiles[person.id].age >= 18)!; assert.ok(depositor); pin(sim, depositor.id, bank); advance(sim, 2);
  assert.ok(sim.state.banking!.cash >= 100, 'a real resident must first fund the actual bank reserve'); sim.setFocus({ ...bank.door }, 'walk'); const borrowed = sim.command({ type: 'loan', value: 20 }); assert.equal(borrowed.ok, true, borrowed.message);
  sim.setFocus({ ...clinic(sim).door }, 'walk'); const donated = sim.command({ type: 'donate', targetId: sim.state.extension!.organizations.find(organization => organization.kind === 'charity')!.id, value: sim.state.player.money - 30 }); assert.equal(donated.ok, true, donated.message); assert.equal(sim.state.player.money, 30);
  const before = cash(sim), order = begin(sim); assert.equal(sim.state.player.money, 0); const account = sim.state.banking!.accounts.player; assert.equal(account.loanPrincipal, 20); assert.ok(sim.state.banking!.receipts.some(receipt => receipt.kind === 'loan' && receipt.actorId === 'player' && receipt.amount === 20));
  sim.state.extension!.actorProfiles.player.alive = false; sim.state.extension!.actorProfiles.player.health = 0;
  const pending = settleDeceasedAccount(sim, 'player', []); assert.equal(pending.closed, false); assert.equal(pending.unpaidLoss, 0); assert.equal(account.loanPrincipal, 20); assert.equal(order.escrow, 30);
  advance(sim, 2); assert.equal(order.escrow, 0); assert.equal(order.refunded, 30); const result = settleDeceasedAccount(sim, 'player', []); assert.equal(result.unpaidLoss, 0); assert.equal(account.loanPrincipal, 0); assert.equal(account.closed, true); assert.ok(sim.state.banking!.stats.repaid >= 20); assert.ok(Math.abs(cash(sim) - before) < 1e-5); restore(sim);
});

test('saved pre-clinical healing deadlines bind patient and NPC repeat visits until actual elapsed time', () => {
  for (const delay of [60, 240]) {
    const { sim, doctor, site } = setup(), data = JSON.parse(sim.exportSave()), deadline = at(sim) + delay;
    delete data.state.clinical; delete data.runtime.persistedModules;
    data.state.extension.runtime.cooldowns['heal:player'] = deadline;
    const next = new Simulation(sim.worldDefinition), result = next.importSave(JSON.stringify(data)); assert.equal(result.ok, true, result.message); pin(next, doctor.id, site, 'work');
    assert.equal(clinicalVisitDeadline(next.state, 'player'), deadline); const before = next.exportSave(); assert.equal(next.command({ type: 'heal' }).ok, false); assert.equal(next.exportSave(), before);
    advance(next, delay - 2); const money = next.state.player.money; assert.equal(next.command({ type: 'heal' }).ok, false); assert.equal(next.state.player.money, money); advance(next, 2); const started = next.command({ type: 'heal' }); assert.equal(started.ok, true, started.message); assert.equal(next.state.clinical!.orders[0].escrow, 30); advance(next, 22); assert.equal(next.state.clinical!.orders[0].state, 'completed'); restore(next);
  }
});

test('an actual ee3e7a1 paid-heal export migrates its sixty-minute deadline and never charges a repeat fee early', () => {
  // Generated by running the unmodified committed old Simulation and its real
  // heal command; this fixture is not a modern save with a body merely removed.
  const saved = readFileSync(new URL('./fixtures/clinical-legacy-heal-ee3e7a1.json', import.meta.url), 'utf8'), old = JSON.parse(saved);
  assert.equal(old.state.clinical, undefined); assert.equal(old.runtime.persistedModules, undefined); assert.equal(old.state.player.money, 570); assert.equal(old.state.extension.actorProfiles.player.health, 75); assert.equal(old.state.extension.runtime.cooldowns['heal:player'], 540);
  const sim = new Simulation(fixture()), result = sim.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(clinicalVisitDeadline(sim.state, 'player'), 540); assert.equal(sim.state.clinical!.orders.length, 0);
  const site = clinic(sim), doctor = sim.state.citizens.find(person => person.role === '医生' && person.workId === site.id && sim.state.extension!.actorProfiles[person.id].age >= 18 && !sim.state.shops.some(shop => shop.ownerId === person.id))!; assert.ok(doctor); pin(sim, doctor.id, site, 'work'); assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const before = sim.exportSave(); assert.equal(sim.command({ type: 'heal' }).ok, false); assert.equal(sim.exportSave(), before); advance(sim, 58); const money = sim.state.player.money; assert.equal(sim.command({ type: 'heal' }).ok, false); assert.equal(sim.state.player.money, money);
  advance(sim, 2); assert.equal(sim.command({ type: 'heal' }).ok, true); const order = sim.state.clinical!.orders[0]; assert.equal(order.escrow, 30); assert.equal(order.workedMinutes, 0); advance(sim, 20); assert.equal(order.workedMinutes, 18); assert.equal(order.state, 'inTreatment'); advance(sim, 2); assert.equal(order.state, 'completed'); restore(sim);
});

test('actually funded and elapsed medicine research improves only completed material-backed clinical treatment', () => {
  const { sim } = setup(), school = sim.worldDefinition.buildings.find(site => site.kind === 'school')!, technology = sim.state.extension!.technologies.find(item => item.sector === 'medicine')!, beforeLevel = technology.level;
  sim.state.player.role = 'scientist'; sim.state.player.identities = ['traveler', 'scientist']; sim.state.player.education = 3;
  // Keep the research actor on the shared actual school floor. Its old y0
  // door-radius fixture was below the supported .6m standing height.
  const lab = { ...school.position, y: getWalkHeight(sim.worldDefinition, school.position.x, school.position.z, school.position.y + .6) };
  assert(Math.abs(lab.y - school.position.y - .6) < 1e-7); sim.setFocus(lab, 'walk');
  const money = sim.state.player.money, started = sim.command({ type: 'research', targetId: 'medicine', value: 100 }); assert.equal(started.ok, true, started.message); assert.equal(sim.state.player.money, money - 100); advance(sim, 118); assert.equal(technology.level, beforeLevel); advance(sim, 2); assert.equal(technology.level, beforeLevel + 1); assert.equal(technology.funding, 0);
  sim.setFocus({ ...clinic(sim).door }, 'walk'); const order = begin(sim); advance(sim, 20); assert.equal(order.workedMinutes, 18); const health = sim.state.extension!.actorProfiles.player.health; advance(sim, 2); assert.equal(order.state, 'completed'); assert.ok(sim.state.extension!.actorProfiles.player.health > health + 25 + technology.level - .2); restore(sim);
});
