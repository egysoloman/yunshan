import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { BOARDING_HOLD_MINUTES, PLAYER_BOARDING_HOLD_POLICY, validateBoardingHoldPolicy } from '../src/simulation/boarding-hold';
import { assembleSave, partitionSave } from '../src/persistence/partition';

test('new cities hold a stopped vehicle once for the player walking up to board; other cities and saves are unchanged', () => {
  const world = createProductWorld();
  for (const declared of [true, false]) {
    const sim = declared ? createCurrentProductCity(world) : createArchivedProductCity(world);
    assert.equal((sim as unknown as { boardingHoldPolicyId: string }).boardingHoldPolicyId, declared ? PLAYER_BOARDING_HOLD_POLICY : 'legacy');
    sim.command({ type: 'speed', value: 8 });
    const now = () => sim.state.day * 1440 + sim.state.hour * 60;
    let vehicle = sim.state.vehicles.find(v => v.kind === 'road' && (v.state === 'boarding' || v.state === 'waiting') && (v.progress === 0 || v.progress === 1));
    for (let i = 0; i < 300 && !vehicle; i++) { sim.step(.25); vehicle = sim.state.vehicles.find(v => v.kind === 'road' && (v.state === 'boarding' || v.state === 'waiting') && (v.progress === 0 || v.progress === 1)); }
    assert.ok(vehicle, 'a road vehicle stops');
    const id = vehicle!.id, due = vehicle!.nextDeparture;
    sim.state.player.position = { x: vehicle!.position.x + 6, y: vehicle!.position.y, z: vehicle!.position.z };
    for (let i = 0; i < 200 && now() < due + .5; i++) sim.step(.25);
    const after = sim.state.vehicles.find(v => v.id === id)!;
    if (declared) {
      assert.ok(after.nextDeparture > due + 1, 'the departure was held for the player');
      assert.ok(after.nextDeparture <= due + BOARDING_HOLD_MINUTES + 2, 'by at most the hold');
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved, 'a held stop saves and reads back exactly');
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
      const doc = JSON.parse(saved);
      assert.throws(() => validateBoardingHoldPolicy({ ...doc, boardingHoldPolicyId: undefined }), /boarding hold/);
      const { boardingHoldPolicyId: _a, ...withoutEnvelope } = doc; const { boardingHoldPolicyId: _b, ...runtime } = doc.runtime;
      assert.throws(() => validateBoardingHoldPolicy({ ...withoutEnvelope, runtime: { ...runtime, boardingHolds: { x: true } } }), /without policy/);
    } else assert.equal(sim.exportSave().includes('boardingHold'), false, 'an undeclared city carries no hold');
  }
});
