import assert from 'node:assert/strict';
import test from 'node:test';
import { floorPlanSupport } from '../src/architecture-floor-plan.ts';
import { clinicalAtSite } from '../src/simulation/clinical.ts';
import { advance, at, begin, cash, pin, publicCare, restore24, setup, station } from './clinical-presence-fixture.ts';

// These use only pre-candidate exports. The same bytes can be copied to the
// original actual14 tree after runtime GO, so a failure proves behavior rather
// than a missing new export. No original result has been run or recorded yet.
test('paid care does not credit a funded doctor on another real public floor', () => {
  const { sim, controls, site, doctor } = setup(1), total = cash(sim), money = sim.state.player.money, order = begin(sim, site);
  assert.equal(sim.state.player.money, money - 30); assert.equal(order.escrow, 30);
  assert.equal(clinicalAtSite(sim, site, doctor.id), true); assert.equal(clinicalAtSite(sim, site), true);
  assert.equal(floorPlanSupport(site, 1, doctor.position, .35)?.floor, 1);
  advance(sim, 22);
  assert.equal(order.workedMinutes, 0); assert.equal(order.consumedUnits, 0); assert.equal(order.serviceFee, 0);
  assert.equal(order.reservedUnits, 1); assert.equal(order.receivedUnits, 1); assert.equal(order.purchasePaid + order.escrow, 30);
  assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls);
});

test('paid care resumes at the shared ground station for twenty new actual minutes, retaining its one purchase', () => {
  const { sim, controls, site, doctor } = setup(1), total = cash(sim), order = begin(sim, site);
  advance(sim, 4); assert.equal(order.workedMinutes, 0);
  const purchased = order.purchasePaid, receipts = order.receipts.length;
  pin(sim, controls, doctor.id, site, station(site, 0), 'work');
  const start = at(sim); advance(sim, 18); assert.equal(at(sim) - start, 18); assert.equal(order.workedMinutes, 18); assert.equal(order.consumedUnits, 0);
  const health = sim.state.extension!.actorProfiles.player.health;
  advance(sim, 2); assert.equal(order.workedMinutes, 20); assert.equal(order.state, 'completed'); assert.equal(order.consumedUnits, 1);
  assert.equal(order.purchasePaid, purchased); assert.equal(order.receipts.length, receipts); assert.equal(order.purchasePaid + order.serviceFee, 30);
  assert.ok(sim.state.extension!.actorProfiles.player.health > health + 24.8); assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls);
});

test('a material-backed public order does not count a doctor on a different supported public floor', () => {
  const context = setup(1), { sim, controls } = context, order = publicCare(context);
  const total = cash(sim), units = order.receivedUnits;
  assert.equal(sim.command({ type: 'attendService', targetId: order.id }).ok, true);
  advance(sim, 20); assert.equal(order.serviceMinutes.player ?? 0, 0); assert.equal(order.consumedUnits, 0);
  assert.equal(order.receivedUnits, units); assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls);
});

test('one matching doctor still has only two slots shared by public and paid patients', () => {
  const context = setup(0), { sim, controls, site, doctor } = context, order = publicCare(context), total = cash(sim);
  const patients = sim.state.citizens.filter(person => person.id !== doctor.id && person.role !== '官员' && person.role !== '医生' && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  for (const person of patients) { pin(sim, controls, person.id, site, station(site, 0)); sim.state.extension!.actorProfiles[person.id].health = 70; }
  const paid = begin(sim, site); advance(sim, 20);
  for (const person of patients) { assert.equal(order.serviceMinutes[person.id], 20); assert.ok(order.servedIds.includes(person.id)); }
  assert.equal(order.consumedUnits, 2); assert.equal(paid.workedMinutes, 0); assert.equal(paid.reservedUnits, 1); assert.equal(paid.consumedUnits, 0);
  assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls);
});

test('unmarked paid care keeps the old cross-floor contract and exact continuation', () => {
  const { sim, controls, site } = setup(1, false), total = cash(sim), order = begin(sim, site);
  advance(sim, 22); assert.equal(order.workedMinutes, 20); assert.equal(order.state, 'completed'); assert.equal(order.consumedUnits, 1);
  assert.equal(order.purchasePaid + order.serviceFee, 30); assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls);
});

test('a saved placed cube blocks the live station volume without erasing six already earned treatment minutes', () => {
  const { sim, controls, site } = setup(0), total = cash(sim);
  let order = begin(sim, site); advance(sim, 8); assert.equal(order.workedMinutes, 6);
  const id = order.id, purchased = order.purchasePaid, escrow = order.escrow, centre = station(site, 0);
  const position = { x: Math.round(centre.x / .2) * .2, y: Math.round((centre.y + .8) / .2) * .2, z: Math.round(centre.z / .2) * .2 };
  // The real build ACL excludes clinics. Assert this atomically, then use a
  // complete schema-valid placed-cube fixture; do not claim a native build.
  const before = sim.exportSave(), denied = sim.command({ type: 'build', targetId: site.id, position });
  assert.equal(denied.ok, false); assert.equal(sim.exportSave(), before);
  const data = JSON.parse(before), blocks = data.state.player.inventory.block;
  assert.ok(blocks >= 1); const voxelId = `voxel-${++data.runtime.constructionId}`;
  data.state.voxels.push({ id: voxelId, position, color: '#8fcdc9' }); data.state.player.inventory.block--;
  const added = sim.importSave(JSON.stringify(data)); assert.equal(added.ok, true, added.message);
  order = sim.state.clinical!.orders.find(item => item.id === id)!;
  assert.equal(sim.state.player.inventory.block, blocks - 1);
  advance(sim, 6); assert.equal(order.workedMinutes, 6); assert.equal(order.purchasePaid, purchased); assert.equal(order.escrow, escrow);
  assert.equal(order.consumedUnits, 0); assert.equal(order.reservedUnits, 1); assert.equal(order.serviceFee, 0);
  assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls); assert.equal(order.workedMinutes, 6);
  const cleared = JSON.parse(sim.exportSave()); cleared.state.voxels = cleared.state.voxels.filter((voxel: { id: string }) => voxel.id !== voxelId); cleared.state.player.inventory.block++;
  const removed = sim.importSave(JSON.stringify(cleared)); assert.equal(removed.ok, true, removed.message);
  order = sim.state.clinical!.orders.find(item => item.id === id)!;
  assert.equal(sim.state.player.inventory.block, blocks); advance(sim, 14);
  assert.equal(order.workedMinutes, 20); assert.equal(order.state, 'completed'); assert.equal(order.consumedUnits, 1); assert.equal(order.purchasePaid, purchased);
  assert.equal(order.purchasePaid + order.serviceFee, 30); assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls);
});

test('earlier unmatched public patients do not starve later same-station patients or widen two real doctor slots', () => {
  const context = setup(0), { sim, controls, site, doctor } = context, order = publicCare(context), total = cash(sim);
  const patients = sim.state.citizens.filter(person => person.id !== doctor.id && !['官员', '医生', '学生'].includes(person.role) && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 5);
  assert.equal(patients.length, 5);
  for (let index = 0; index < patients.length; index++) {
    const person = patients[index]; pin(sim, controls, person.id, site, station(site, index < 2 ? 1 : 0)); sim.state.extension!.actorProfiles[person.id].health = 70;
  }
  const units = order.receivedUnits; advance(sim, 20);
  for (const person of patients.slice(0, 2)) { assert.equal(order.serviceMinutes[person.id] ?? 0, 0); assert.equal(order.servedIds.includes(person.id), false); }
  for (const person of patients.slice(2, 4)) { assert.equal(order.serviceMinutes[person.id], 20); assert.equal(order.servedIds.includes(person.id), true); }
  assert.equal(order.serviceMinutes[patients[4].id] ?? 0, 0); assert.equal(order.consumedUnits, 2); assert.equal(order.receivedUnits, units);
  assert.ok(Math.abs(cash(sim) - total) < 1e-5); restore24(sim, controls);
});
