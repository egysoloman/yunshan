import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isCanonicalNpcWage, Simulation } from '../src/simulation';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import type { BuildingKind, WorldDefinition } from '../src/types';

// Original finite controlled scenario and real ordinary lease/reopening save.
// This is a labor-contract regression, not proof of default-city continuity.
function world(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank'];
  const buildings = kinds.map((kind, i) => ({ id: kind, districtId: 'district', name: kind, kind,
    position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 100, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, districtId: site.districtId, name: site.id, position: { ...site.door }, station: true }));
  const edges = nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road' as const, length: 30, capacity: 20, points: [nodes[i].position, node.position] }));
  return { seed: 20261003, voxelSize: .2, size: 1000, buildings, nodes, edges, mountains: [],
    districts: [{ id: 'district', name: '原市场公司权利验证', kind: 'market', center: { x: 90, y: 20, z: 0 }, radius: 500, color: '#abc', population: 96 }],
    spawn: { x: 0, y: 20, z: 5 }, waterfall: { top: { x: 300, y: 40, z: 100 }, bottom: { x: 300, y: 20, z: 100 }, width: 10 }, river: [] };
}

const original = readFileSync(new URL('./fixtures/shop-native-repair/controlled-reopening.save.json', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(original).digest('hex'), '63670a12ece4f11c5d53d93f46fa48755bb2388522dd5b070867275823c801a2');
const titleOf = (sim: Simulation) => sim.state.shopLifecycle!.titles['shop-market'];
const clock = (sim: Simulation) => sim.state.extension!.lastUpdate;
const laborSnapshot = (sim: Simulation) => JSON.stringify({ title: titleOf(sim), receipts: sim.state.shopLifecycle!.receipts,
  claims: Reflect.get(sim, 'runtime').wageAccruals, contracts: Reflect.get(sim, 'runtime').privateLabor,
  shopCash: sim.state.shops.map(shop => [shop.id, sim.shopFunds(shop), shop.inventory]),
  wallets: sim.state.citizens.map(citizen => [citizen.id, citizen.money]), player: sim.state.player.money, treasury: sim.state.treasury });
function restored() {
  const sim = new Simulation(world()); const result = sim.importSave(original); assert(result.ok, result.message);
  assert.equal(sim.exportSave(), original); assert.equal(titleOf(sim).state, 'reopening');
  return sim;
}
function firstNativeMarketWage(sim: Simulation) {
  let observed: Parameters<Simulation['emitEvent']>[0] | undefined;
  sim.onEvent('wage-earned', event => {
    if (event.shopId === 'shop-market' && event.minutes! > 0 && !observed) observed = event;
  });
  for (let step = 0; step < 256 && !observed; step++) sim.step(.25);
  assert(observed, 'original finite payroll and ordinary attendance yield a native market wage within the declared 256 steps');
  assert(isCanonicalNpcWage(observed)); assert(isCanonicalNpcWage(observed, sim));
  return observed;
}

test('generic positive wage notifications cannot buy sixty repair minutes or consume the original material', () => {
  const sim = restored(); for (let step = 0; step < 4; step++) sim.step(.25);
  const title = titleOf(sim); assert.equal(title.reopen!.workedMinutes, 0);
  const before = laborSnapshot(sim), tick = sim.state.tick, at = clock(sim);
  for (const worker of sim.state.citizens.filter(citizen => citizen.workId === 'market' && citizen.role !== '学生')) {
    const event = { type: 'wage-earned', citizenId: worker.id, shopId: 'shop-market', siteId: 'market', districtId: worker.districtId,
      amount: 3, minutes: 60, creditedWorkStartAt: title.reopen!.startedAt, creditedWorkEndAt: at };
    assert.equal(isCanonicalNpcWage(event), false); sim.emitEvent(event);
  }
  // General trade statistics also listen to notifications. This assertion is
  // specifically the asset/labor/cash contract, not all notification statistics.
  assert.equal(laborSnapshot(sim), before); assert.equal(title.state, 'reopening');
  assert.equal(title.materialsHeld, 1); assert.equal(title.reopen!.consumedUnits, 0);
  assert.equal(sim.state.tick, tick); assert.equal(clock(sim), at);
});

test('a cloned native event and an event from another current city grant no repair labor', () => {
  const foreign = restored(), event = firstNativeMarketWage(foreign), sim = restored();
  while (sim.state.tick < foreign.state.tick) sim.step(.25);
  assert.equal(clock(sim), clock(foreign)); assert.equal(sim.state.tick, foreign.state.tick);
  assert.equal(isCanonicalNpcWage(event, sim), false);
  assert.equal(isCanonicalNpcWage({ ...event }), false);
  const before = laborSnapshot(sim); sim.emitEvent(event); sim.emitEvent({ ...event });
  assert.equal(laborSnapshot(sim), before);
});

test('the same actual wage object emitted twice in its own frame changes the repair only once', () => {
  const sim = restored(); let observed = 0, reentering = false;
  sim.onEvent('wage-earned', event => {
    if (reentering || event.shopId !== 'shop-market' || !(event.minutes! > 0) || observed) return;
    assert(isCanonicalNpcWage(event, sim)); assert(Object.isFrozen(event));
    const before = laborSnapshot(sim); reentering = true;
    sim.emitEvent(event); sim.emitEvent(event); reentering = false;
    assert.equal(laborSnapshot(sim), before); observed++;
  });
  for (let step = 0; step < 256 && !observed; step++) sim.step(.25);
  assert.equal(observed, 1); assert(titleOf(sim).reopen!.workedMinutes > 0);
});

test('retained native wages cannot enter a restored state or a later frame', () => {
  const sim = restored(), event = firstNativeMarketWage(sim), saved = sim.exportSave();
  const result = sim.importSave(saved); assert(result.ok, result.message); assert.equal(sim.exportSave(), saved);
  assert(isCanonicalNpcWage(event), 'legacy native-notification identity remains available');
  assert.equal(isCanonicalNpcWage(event, sim), false, 'the state changed even though clock and tick match');
  const before = laborSnapshot(sim); sim.emitEvent(event); assert.equal(laborSnapshot(sim), before);
  sim.step(.25); assert.equal(isCanonicalNpcWage(event, sim), false);
  const later = laborSnapshot(sim); sim.emitEvent(event); assert.equal(laborSnapshot(sim), later);
});

test('finite original payroll still completes sixty repair minutes and the whole/partition saves continue identically for 24 steps', () => {
  const sim = restored(); const actual: object[] = [];
  sim.onEvent('wage-earned', event => {
    if (event.shopId === 'shop-market' && event.minutes! > 0) {
      assert(isCanonicalNpcWage(event, sim)); actual.push({ ...event });
    }
  });
  for (let step = 0; step < 256 && titleOf(sim).state !== 'operating'; step++) sim.step(.25);
  const title = titleOf(sim); assert.equal(title.state, 'operating'); assert.equal(title.reopen!.workedMinutes, 60);
  assert.equal(title.reopen!.consumedUnits, 1); assert.equal(title.materialsHeld, 0);
  assert(actual.length > 0 && title.reopen!.labor.length > 0 && title.reopen!.labor.every(row => row.earned > 0));
  const saved = sim.exportSave(), full = restored(), parts = restored(), partitioned = partitionSave(saved, sim.worldDefinition);
  assert.equal(assembleSave(partitioned), saved);
  for (const copy of [full, parts]) { const result = copy.importSave(copy === full ? saved : assembleSave(partitioned)); assert(result.ok, result.message); assert.equal(copy.exportSave(), saved); }
  for (let step = 0; step < 24; step++) {
    sim.step(.25); full.step(.25); parts.step(.25);
    assert.equal(full.exportSave(), sim.exportSave()); assert.equal(parts.exportSave(), sim.exportSave());
  }
});
