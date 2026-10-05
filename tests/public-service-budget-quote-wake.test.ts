import assert from 'node:assert/strict';
import test from 'node:test';
import { SERVICE_MATERIAL_POLICY, serviceMaterialOfferAvailable } from '../src/simulation/service-material-scheduling.ts';
import type { Simulation } from '../src/simulation.ts';
import type { ServiceOrder } from '../src/simulation/culture.ts';
import type { SimState } from '../src/types.ts';

/** Pure retry predicate regressions only. No Simulation is constructed or
 * stepped and these declarations are not procurement/authority evidence.
 * Native six-book and child480 acceptance remains a separate gated run. */
function fixture() {
  const state = {
    treasury: 1234,
    serviceMaterialScheduling: { version: 1, policyId: SERVICE_MATERIAL_POLICY, enablementId: 'fixture' },
    civicStaffing: { version: 2, enablement: { id: 'fixture' } }, civicHistory: { version: 1 },
    shops: [{ id: 'supplier', inventory: .1, cash: 100 }],
    culture: { supplementalBudgets: { requests: [] } },
  } as unknown as SimState;
  const order = {
    id: 'service-1', topic: 'education', state: 'awaitingBudget', approvedAt: 1440,
    authorizedCap: 40, spent: 40, targetUnits: 6, receivedUnits: 4.069175991861648,
    consumedUnits: 4, retryAt: 1540,
  } as ServiceOrder;
  const sim = { state, shopCommodity: () => 'materials', quoteSupply: () => ({ quantity: .1, unitPrice: 9.83 }) } as unknown as Simulation;
  return { state, order, sim };
}

test('exhausted approved base budget sees a real offer before its future clock retry without granting anything', () => {
  const c = fixture(), before = structuredClone({ state: c.state, order: c.order });
  assert.equal(serviceMaterialOfferAvailable(c.sim, c.order), true);
  assert.equal(serviceMaterialOfferAvailable(c.sim, { ...c.order, topic: 'health' }), true);
  assert.deepEqual({ state: c.state, order: c.order }, before);
});

test('cash shortfall, unapproved orders and already quoted supplemental waits keep ordinary budget retry rules', () => {
  const c = fixture();
  for (const change of [
    { authorizedCap: undefined, spent: undefined }, { authorizedCap: 0, spent: 0 },
    { authorizedCap: NaN }, { authorizedCap: Infinity }, { spent: NaN }, { spent: Infinity },
    { spent: 39 }, { consumedUnits: 3 }, { approvedAt: null }, { state: 'fulfilled' },
    { state: 'rejected' }, { receivedUnits: 6 }, { topic: 'transport' },
  ]) assert.equal(serviceMaterialOfferAvailable(c.sim, { ...c.order, ...change } as ServiceOrder), false, JSON.stringify(change));
  const requests = c.state.culture!.supplementalBudgets!.requests;
  const pending = { orderId: c.order.id, approvedAt: null, closedAt: null, cap: 19, spent: 0 } as typeof requests[number];
  requests.push(pending);
  assert.equal(serviceMaterialOfferAvailable(c.sim, c.order), false, 'a pending quote already has a review path');
  requests[0] = { ...pending, approvedAt: 1500 };
  assert.equal(serviceMaterialOfferAvailable(c.sim, c.order), false, 'existing spendable authority follows its approval retry');
  requests[0] = { ...pending, approvedAt: 1500, spent: 19 };
  assert.equal(serviceMaterialOfferAvailable(c.sim, c.order), true, 'a fully spent supplement can require another finite request');
  requests[0] = { ...pending, closedAt: 1500 };
  assert.equal(serviceMaterialOfferAvailable(c.sim, c.order), true, 'a closed request does not supply open authority');
  delete c.state.serviceMaterialScheduling;
  assert.equal(serviceMaterialOfferAvailable(c.sim, c.order), false);
});

test('an exhausted budget wakes only on a positive finite quote for actually offered material stock', () => {
  const c = fixture(), before = structuredClone({ state: c.state, order: c.order });
  for (const offer of [
    { quantity: 0, unitPrice: 9.83 }, { quantity: NaN, unitPrice: 9.83 }, { quantity: Infinity, unitPrice: 9.83 },
    { quantity: .1, unitPrice: 0 }, { quantity: .1, unitPrice: NaN }, { quantity: .1, unitPrice: Infinity },
  ]) {
    const sim = { ...c.sim, quoteSupply: () => offer } as unknown as Simulation;
    assert.equal(serviceMaterialOfferAvailable(sim, c.order), false);
    assert.deepEqual({ state: c.state, order: c.order }, before);
  }
  assert.equal(serviceMaterialOfferAvailable({ ...c.sim, shopCommodity: () => 'food' } as unknown as Simulation, c.order), false);
  c.state.shops[0].inventory = 0;
  assert.equal(serviceMaterialOfferAvailable(c.sim, c.order), false);
});
