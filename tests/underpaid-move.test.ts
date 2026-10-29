import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { UNDERPAID_MOVE_POLICY, validateUnderpaidMovePolicy } from '../src/simulation/underpaid-move';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a declared city lets the poor, unpromised staff of a profitable but thin shop take a funded job elsewhere', () => {
  const world = createProductWorld(), { underpaidMovePolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS;
  const counts: number[] = [];
  for (const declared of [true, false]) {
    const sim = declared ? createCurrentProductCity(world) : new Simulation(world, withoutRule);
    assert.equal(sim.underpaidMovePolicyId, declared ? UNDERPAID_MOVE_POLICY : undefined);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    // Controlled: profitable shops whose cash funds a day's wage but not a half-day for every one of their staff.
    const thin = sim.state.shops.filter(shop => sim.state.citizens.filter(c => c.workId === shop.buildingId && c.id !== shop.ownerId && c.role !== '学生').length >= 3).slice(0, 12);
    const staff = new Map(thin.flatMap(shop => sim.state.citizens.filter(c => c.workId === shop.buildingId && c.id !== shop.ownerId && c.role !== '学生').map(c => [c.id, shop.buildingId] as const)));
    for (const shop of thin) { shop.cash = 120; shop.profit = 50; }
    for (const c of sim.state.citizens) if (staff.has(c.id)) c.money = 20;
    // Held there (as in audit v9g, where such shops kept a median 246): v6 never applies, the owner can promise little.
    for (let tick = 0; tick < 600; tick++) { for (const shop of thin) { shop.cash = Math.max(shop.cash ?? 0, 150); shop.profit = Math.max(shop.profit, 50); } sim.step(.25); }
    const moved = sim.state.citizens.filter(c => staff.has(c.id) && c.workId !== staff.get(c.id) && sim.state.shops.some(shop => shop.buildingId === c.workId));
    counts.push(moved.length);
    if (declared) {
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
    }
  }
  assert.ok(counts[0] > counts[1], `${counts[0]} moved with the rule, ${counts[1]} without`);
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.underpaidMovePolicyId, UNDERPAID_MOVE_POLICY); assert.equal(doc.runtime.underpaidMovePolicyId, UNDERPAID_MOVE_POLICY);
  assert.throws(() => validateUnderpaidMovePolicy({ ...doc, underpaidMovePolicyId: undefined }), /underpaid move/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('underpaidMove'), false);
});
