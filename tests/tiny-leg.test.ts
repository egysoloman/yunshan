import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { TINY_LEG_POLICY, validateTinyLegPolicy } from '../src/simulation/tiny-leg';

// The leg audit v9e ended on: 2e-15 m long, inside 九霄观云·东岚院·里居4, which the stair model reads as blocked.
const a = { x: 1.3920000000000021, y: 537.4, z: -1335.6000000000001 }, b = { x: 1.392000000000004, y: 537.4, z: -1335.6000000000001 }, c = { x: 6, y: 537.4, z: -1335.6 };

test('a declared city walks a route leg a rounding error long instead of waiting at it forever', () => {
  const world = createProductWorld(), { tinyLegPolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS;
  for (const [sim, declared] of [[createCurrentProductCity(world), true], [new Simulation(world, withoutRule), false]] as const) {
    const city = sim as any;
    assert.equal(city.npcStairMotion.describe([a, b, c], 1).kind, 'blocked');
    const citizen = city.state.citizens.find((row: any) => !city.runtime.riders[row.id] && !city.runtime.npcStairCursors?.[row.id]);
    Object.assign(citizen, { state: 'moving', position: { ...a }, route: [a, b, c], routeIndex: 1 });
    city.moveCitizenPhysical(citizen, 1);
    if (declared) { assert.equal(sim.tinyLegPolicyId, TINY_LEG_POLICY); assert.ok(citizen.routeIndex >= 2 && citizen.state !== 'physicalWaiting', 'the resident steps over the tiny leg'); }
    else { assert.equal(citizen.routeIndex, 1); assert.equal(citizen.state, 'physicalWaiting', 'without the rule the resident waits at it'); }
  }
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.tinyLegPolicyId, TINY_LEG_POLICY); assert.equal(doc.runtime.tinyLegPolicyId, TINY_LEG_POLICY);
  assert.throws(() => validateTinyLegPolicy({ ...doc, tinyLegPolicyId: undefined }), /tiny leg/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('tinyLeg'), false);
});
