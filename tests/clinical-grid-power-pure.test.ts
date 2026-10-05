import assert from 'node:assert/strict';
import test from 'node:test';
import { claimClinicalCareMinutes, clinicalPowerAvailable } from '../src/simulation/clinical';
import { dispatchPowerGrid, gridBuildingSupplyRatio, validatePowerGridState } from '../src/simulation/power-grid';
import { gridState, gridWorld } from './power-grid-fixture';
import type { Simulation } from '../src/simulation';
import type { Building, Citizen, SimState } from '../src/types';

// Pure parameter dispatch and shared-call admission only: no Simulation,
// synthetic wages, body movement, patient illness or resource purchase.
const clinicId = 'other-city-clinic';
function supplied(kind: 'full' | 'partial' | 'none' | 'null') {
  const world = gridWorld();
  if (kind === 'partial') world.powerGrid!.nodes.find(node => node.id === 'south')!.capacityP = .02;
  if (kind === 'none') world.powerGrid!.storage[0].initialStoredPMinutes = 0;
  if (kind === 'null') world.powerGrid!.buildings.find(load => load.buildingId === clinicId)!.nodeId = null;
  const state = gridState(world);
  state.powerGrid = dispatchPowerGrid(world, state, .25);
  validatePowerGridState(state, world);
  return state;
}
function rejectedBeforeSlotsOrActors(state: SimState) {
  const before = JSON.stringify(state);
  const simulation = { state } as Simulation;
  const site = { id: clinicId } as Building;
  let actorReads = 0;
  const doctor = { get id() { actorReads++; throw new Error('original actor check'); } } as unknown as Citizen;
  assert.equal(claimClinicalCareMinutes(simulation, site, doctor, 'patient', .25, 0, 20), 0);
  assert.equal(actorReads, 0, 'unserved power must return before slot, presence or activity claims');
  assert.equal(JSON.stringify(state), before, 'rejecting power does not spend energy again or edit resources');
}

test('declared zero storage and null clinic feeders cannot enter the shared medical claim', () => {
  for (const kind of ['none', 'null'] as const) {
    const state = supplied(kind);
    assert.equal(clinicalPowerAvailable(state, clinicId), false);
    rejectedBeforeSlotsOrActors(state);
  }
});

test('one-percent real clinic supply pauses an indivisible medical operation', () => {
  const state = supplied('partial');
  assert.ok(Math.abs(gridBuildingSupplyRatio(state, clinicId) - .01) < 1e-7);
  assert.equal(clinicalPowerAvailable(state, clinicId), false);
  rejectedBeforeSlotsOrActors(state);
});

test('stale tick or clock and missing clinic meter cannot grant medical power', () => {
  const tick = supplied('full'); tick.tick++;
  const clock = supplied('full'); clock.hour += 1 / 60;
  const missing = supplied('full'); delete missing.powerGrid!.dispatch!.buildings[clinicId];
  for (const state of [tick, clock, missing]) {
    assert.equal(clinicalPowerAvailable(state, clinicId), false);
    rejectedBeforeSlotsOrActors(state);
  }
});

test('full real clinic dispatch admits only the original medical actor checks', () => {
  const state = supplied('full'), before = JSON.stringify(state);
  assert.equal(gridBuildingSupplyRatio(state, clinicId), 1);
  assert.equal(clinicalPowerAvailable(state, clinicId), true);
  const doctor = { get id() { throw new Error('original actor check'); } } as unknown as Citizen;
  assert.throws(() => claimClinicalCareMinutes({ state } as Simulation, { id: clinicId } as Building, doctor, 'patient', .25, 0, 20), /original actor check/);
  assert.equal(JSON.stringify(state), before, 'power admission never grants care or edits resources');
});

test('no declared grid retains the original legacy medical contract', () => {
  assert.equal(clinicalPowerAvailable({} as SimState, clinicId), true);
  assert.equal(clinicalPowerAvailable({ power: { dispatch: null } } as unknown as SimState, clinicId), true);
});
