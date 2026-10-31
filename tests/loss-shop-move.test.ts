import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { LOSS_SHOP_MOVE_POLICY, validateLossShopMovePolicy } from '../src/simulation/loss-shop-move';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a declared city lets the poor staff of a losing shop take a funded job, though the shop can still fund a day', () => {
  const world = createProductWorld(), { lossShopMovePolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS;
  for (const [declared, moves] of [[true, true], [false, false]] as const) {
    const sim = declared ? createCurrentProductCity(world) : new Simulation(world, withoutRule);
    assert.equal(sim.lossShopMovePolicyId, declared ? LOSS_SHOP_MOVE_POLICY : undefined);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    // Controlled: shops with staff are losing money but hold ample cash; their staff are poor.
    const losing = sim.state.shops.filter(shop => sim.state.citizens.some(c => c.workId === shop.buildingId && c.id !== shop.ownerId && c.role !== '学生')).slice(0, 12);
    const staff = new Map(losing.flatMap(shop => sim.state.citizens.filter(c => c.workId === shop.buildingId && c.id !== shop.ownerId && c.role !== '学生').map(c => [c.id, shop.buildingId] as const)));
    for (const shop of losing) { shop.cash = 3000; shop.profit = -300; }
    for (const c of sim.state.citizens) if (staff.has(c.id)) c.money = 20;
    for (let tick = 0; tick < 600; tick++) sim.step(.25);
    const moved = sim.state.citizens.filter(c => staff.has(c.id) && c.workId !== staff.get(c.id) && sim.state.shops.some(shop => shop.buildingId === c.workId));
    if (moves) assert.ok(moved.length > 0, `${moved.length} of ${staff.size} moved to another shop`);
    else assert.equal(moved.length, 0, 'without the rule, a shop that can fund a day keeps its staff');
    if (declared) {
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
    }
  }
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.lossShopMovePolicyId, LOSS_SHOP_MOVE_POLICY); assert.equal(doc.runtime.lossShopMovePolicyId, LOSS_SHOP_MOVE_POLICY);
  assert.throws(() => validateLossShopMovePolicy({ ...doc, lossShopMovePolicyId: undefined }), /loss shop move/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('lossShopMove'), false);
});
