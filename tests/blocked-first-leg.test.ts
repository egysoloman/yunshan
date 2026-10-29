import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCurrentProductCity, createProductWorld } from '../src/product-city';

test('a resident waiting at the start of a blocked first leg saves and reads back', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world) as any;
  for (let i = 0; i < 4; i++) sim.step(.25);
  // The leg audit v9e ended on: 2e-15 m long, inside 九霄观云·东岚院·里居4, which the stair model reads as blocked.
  const a = { x: 1.3920000000000021, y: 537.4, z: -1335.6000000000001 }, b = { x: 1.392000000000004, y: 537.4, z: -1335.6000000000001 }, c = { x: 6, y: 537.4, z: -1335.6 };
  assert.equal(sim.npcStairMotion.describe([a, b, c], 1).kind, 'blocked');
  const citizen = sim.state.citizens.find((row: any) => !sim.runtime.riders[row.id] && !sim.runtime.npcStairCursors?.[row.id] && row.state !== 'riding');
  Object.assign(citizen, { state: 'physicalWaiting', position: { ...a }, route: [a, b, c], routeIndex: 1 });
  const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  // Only a waiting resident at that start is accepted: one standing elsewhere on the blocked leg is still refused.
  Object.assign(citizen, { position: { ...c } });
  assert.equal(createCurrentProductCity(world).importSave(sim.exportSave()).ok, false);
});
