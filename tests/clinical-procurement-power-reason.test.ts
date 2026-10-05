import assert from 'node:assert/strict';
import test from 'node:test';
import type { Simulation } from '../src/simulation';
import type { SimState } from '../src/types';
import { installClinical, type ClinicalOrder } from '../src/simulation/clinical';
import { dispatchPowerGrid } from '../src/simulation/power-grid';
import { gridState, gridWorld } from './power-grid-fixture';

// Pure finite procurement contract, not a Simulation or importable save. Only
// the installed finance callback runs; no doctor, wage or care is fabricated.
for (const supply of ['full', 'partial', 'empty', 'null', 'stale', 'legacy'] as const) {
  test(`first material procurement preserves the actual ${supply} clinic power reason`, () => {
    const world = gridWorld();
    const clinic = world.buildings.find(site => site.kind === 'clinic')!;
    if (supply === 'partial') world.powerGrid!.nodes.find(node => node.id === 'south')!.capacityP = .02;
    if (supply === 'empty') world.powerGrid!.storage[0].initialStoredPMinutes = 0;
    if (supply === 'null') world.powerGrid!.buildings.find(load => load.buildingId === clinic.id)!.nodeId = null;
    const state = gridState(world);
    state.powerGrid = dispatchPowerGrid(world, state, .25);
    if (supply === 'stale') state.tick++;
    if (supply === 'legacy') delete state.powerGrid;
    Object.assign(state, { taxRate: .08, extension: { lastUpdate: 480,
      actorProfiles: { patient: { alive: true }, player: { alive: true } } } });
    const shop = { id: 'finite-material-shop', buildingId: 'pure-workshop', districtId: clinic.districtId,
      inventory: 1, cash: 10, revenue: 0, profit: 0 };
    state.shops = [shop] as unknown as SimState['shops'];
    let finance: ((state: SimState, minutes: number) => void) | undefined;
    const sim = { state, worldDefinition: world,
      onPhase(name: string, callback: (state: SimState, minutes: number) => void) { if (name === 'finance') finance = callback; },
      onEvent() {}, onLoad() {}, registerCommandHandler() {}, registerSaveValidator() {}, emitEvent() {},
      shopCommodity() { return 'materials'; }, quoteSupply() { return { quantity: 1, unitPrice: 4 }; },
      shopFunds() { return shop.cash; }, transferShopFunds(_shop: unknown, amount: number) { shop.cash += amount; },
    } as unknown as Simulation;
    installClinical(sim);
    const order: ClinicalOrder = { timingVersion: 2, id: 'clinical-1', patientId: 'patient', payerId: 'player',
      siteId: clinic.id, startedAt: 480, state: 'awaitingSupply', funded: 30, escrow: 30,
      purchasePaid: 0, serviceFee: 0, refunded: 0, receivedUnits: 0, reusedUnits: 0,
      reservedUnits: 0, consumedUnits: 0, workedMinutes: 0, requiredMinutes: 20, staffMinutes: {}, receipts: [],
      completedAt: null, cancelledAt: null, retryAt: 480, lastReason: '等待实际材料' };
    state.clinical!.orders.push(order);
    finance!(state, .25);
    assert.equal(shop.inventory, 0);
    assert.equal(order.purchasePaid, 4); assert.equal(order.escrow, 26);
    assert.equal(order.receivedUnits, 1); assert.equal(order.reservedUnits, 1);
    assert.equal(order.workedMinutes, 0); assert.equal(order.consumedUnits, 0); assert.equal(order.completedAt, null);
    if (supply === 'full' || supply === 'legacy') {
      assert.equal(order.lastReason, '实物已购入并为患者保留；等待医生实际在岗。');
    } else assert.match(order.lastReason, /声明电网未足额供给该诊所/);
  });
}
