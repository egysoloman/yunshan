import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import type { Citizen } from '../src/types';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { LOSS_OWNER_EXIT_POLICY, validateLossOwnerExitPolicy } from '../src/simulation/loss-owner-exit';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('a poor owner of a losing shop with no other staff takes a funded job elsewhere only with the rule, keeping the shop', () => {
  const world = createProductWorld(), { lossOwnerExitPolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS, moved: number[] = [];
  for (const declared of [true, false]) {
    const sim = declared ? createCurrentProductCity(world) : new Simulation(world, withoutRule);
    assert.equal(sim.lossOwnerExitPolicyId, declared ? LOSS_OWNER_EXIT_POLICY : undefined);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    while (sim.state.hour < 11) sim.step(.25);
    // The declared city saves and reads back before the test forges owner and shop state below.
    if (declared) {
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
    }
    const internal = sim as unknown as { considerShopMove(c: Citizen): void; workforce: Map<string, Citizen[]>; runtime: { decisionAt: Record<string, number> } };
    // Every shop gets a day of spare funds (other shops can hire); the owners' own shops are then made to lose money.
    for (const shop of sim.state.shops) { const company = sim.state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId); if (company) company.capital += 1000; else shop.cash = (shop.cash ?? 0) + 1000; }
    const owners = sim.state.shops.map(shop => ({ shop, owner: sim.state.citizens.find(c => c.id === sim.shopOwnerId(shop)) }))
      .filter(({ shop, owner }) => owner && owner.workId === shop.buildingId && owner.role !== '学生' && (internal.workforce.get(shop.buildingId) ?? []).every(c => c === owner)).slice(0, 12);
    assert.ok(owners.length >= 5, `${owners.length} owners working alone at their shop`);
    let count = 0;
    for (const { shop, owner } of owners) {
      shop.profit = -50; owner!.money = 20; owner!.needs.hunger = 80; owner!.needs.fatigue = 80; delete internal.runtime.decisionAt[owner!.id];
      const from = owner!.workId; internal.considerShopMove(owner!);
      if (owner!.workId !== from) { count++; assert.equal(sim.shopOwnerId(shop), owner!.id, 'the shop stays theirs'); assert.ok(shop.open, 'and open'); }
    }
    moved.push(count);
  }
  assert.ok(moved[0] > 0, `${moved[0]} owners moved with the rule`);
  assert.equal(moved[1], 0, 'without the rule an owner stays at their own shop');
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.lossOwnerExitPolicyId, LOSS_OWNER_EXIT_POLICY); assert.equal(doc.runtime.lossOwnerExitPolicyId, LOSS_OWNER_EXIT_POLICY);
  assert.throws(() => validateLossOwnerExitPolicy({ ...doc, lossOwnerExitPolicyId: undefined }), /loss owner exit/);
  assert.throws(() => validateLossOwnerExitPolicy({ ...doc, runtime: { ...doc.runtime, lossOwnerExitPolicyId: undefined } }), /loss owner exit/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('lossOwnerExit'), false);
});
