import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import type { Citizen, Shop } from '../src/types';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { UNDERPAID_HOUR, UNDERPAID_MOVE_POLICY, validateUnderpaidMovePolicy } from '../src/simulation/underpaid-move';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('at 11:00 a poor shop worker without a half-day promise takes a funded job elsewhere only with the rule', () => {
  const world = createProductWorld(), { underpaidMovePolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS;
  const outcome: { moved: number; stayed: number }[] = [];
  for (const declared of [true, false]) {
    const sim = declared ? createCurrentProductCity(world) : new Simulation(world, withoutRule);
    assert.equal(sim.underpaidMovePolicyId, declared ? UNDERPAID_MOVE_POLICY : undefined);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    while (sim.state.hour < UNDERPAID_HOUR) sim.step(.25);
    // The declared city saves and reads back before the test forges worker and shop state below.
    if (declared) {
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
    }
    const internal = sim as unknown as { considerShopMove(c: Citizen): void; runtime: { decisionAt: Record<string, number>; privateLabor?: { shifts: Record<string, { assignments: { citizenId: string; minutesCap: number }[] }> } } };
    // Staff (not owners, not students) of shops not running a loss (loss-shop-move-v1 lets those go anyway); their shops are then given a full day of free funds,
    // so without the rule the shop's books keep them.
    const staff = sim.state.citizens.filter(c => c.role !== '学生' && sim.state.shops.some(shop => shop.buildingId === c.workId && shop.ownerId !== c.id && shop.profit >= 0)).slice(0, 20);
    assert.ok(staff.length >= 10, 'a real city has shop staff at 11:00');
    for (const shop of sim.state.shops.filter(s => staff.some(c => c.workId === s.buildingId))) {
      const company = sim.state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId);
      if (company) company.capital += 1000; else shop.cash = (shop.cash ?? 0) + 1000;
    }
    let moved = 0;
    for (const c of staff) {
      const from = c.workId, shop = sim.state.shops.find(s => s.buildingId === from)!;
      // Same worker state in both cities: poor, fed, rested, due a decision and with no half-day promise today.
      c.money = 20; c.needs.hunger = 80; c.needs.fatigue = 80; delete internal.runtime.decisionAt[c.id];
      const plan = internal.runtime.privateLabor?.shifts[shop.id]; if (plan) plan.assignments = plan.assignments.filter(a => a.citizenId !== c.id);
      internal.considerShopMove(c);
      if (c.workId !== from) { moved++; assert.ok(sim.state.shops.some(s => s.buildingId === c.workId), 'the new job is at a shop'); }
    }
    outcome.push({ moved, stayed: staff.length - moved });
  }
  // audit v9h, 14 days: poor residents 176 -> 162, poor shop staff 100 -> 89.
  assert.ok(outcome[0].moved > 0, `with the rule ${outcome[0].moved} of ${outcome[0].moved + outcome[0].stayed} moved`);
  assert.equal(outcome[1].moved, 0, 'without the rule a shop that can fund a day keeps its staff');
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.underpaidMovePolicyId, UNDERPAID_MOVE_POLICY); assert.equal(doc.runtime.underpaidMovePolicyId, UNDERPAID_MOVE_POLICY);
  assert.throws(() => validateUnderpaidMovePolicy({ ...doc, underpaidMovePolicyId: undefined }), /underpaid move/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('underpaidMove'), false);
});
