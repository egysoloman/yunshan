import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { JUNCTION_DWELL, JUNCTION_DWELL_POLICY, validateJunctionDwellPolicy } from '../src/simulation/junction-dwell';
import { assembleSave, partitionSave } from '../src/persistence/partition';

/** Dwell minutes of road vehicles that start a stop at a plain junction, and at a station, over a stretch of day 1. */
function dwells(sim: Simulation) {
  const world = (sim as any).world, nodes = new Map(world.nodes.map((n: any) => [n.id, n])), edges = new Map(world.edges.map((e: any) => [e.id, e]));
  const plain: number[] = [], station: number[] = [], before = new Map<string, string>();
  sim.command({ type: 'speed', value: 8 });
  for (let t = 0; t < 160; t++) {
    sim.step(.25);
    for (const v of sim.state.vehicles) {
      const was = before.get(v.id); before.set(v.id, v.state);
      if (v.kind !== 'road' || v.state !== 'boarding' || was === 'boarding') continue;
      const e: any = edges.get(v.edgeId), node: any = nodes.get(v.progress === 0 ? e.from : e.to), left = v.nextDeparture - (sim as any).now;
      if (!node) continue;
      if (node.station) station.push(left); else if (!node.id.endsWith('-door')) plain.push(left);
    }
  }
  return { plain, station };
}

test('a declared city lets road vehicles pause only briefly at plain junctions; stations keep their dwell', () => {
  const world = createProductWorld(), { junctionDwellPolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS;
  const declared = createCurrentProductCity(world), d = dwells(declared);
  assert.equal(declared.junctionDwellPolicyId, JUNCTION_DWELL_POLICY);
  assert.ok(d.plain.length > 20 && d.plain.every(m => m <= JUNCTION_DWELL + 1e-6), `${d.plain.length} junction stops of at most ${JUNCTION_DWELL} min`);
  assert.ok(d.station.some(m => m > JUNCTION_DWELL + 1), 'stations keep the full dwell');
  const u = dwells(new Simulation(world, withoutRule));
  assert.ok(u.plain.some(m => m > JUNCTION_DWELL + 1), 'without the rule junction stops are full length');
  const saved = declared.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.junctionDwellPolicyId, JUNCTION_DWELL_POLICY); assert.equal(doc.runtime.junctionDwellPolicyId, JUNCTION_DWELL_POLICY);
  assert.throws(() => validateJunctionDwellPolicy({ ...doc, junctionDwellPolicyId: undefined }), /junction dwell/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('junctionDwell'), false);
});
