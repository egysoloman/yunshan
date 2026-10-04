import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import { decodeCitizenRoutes } from '../src/persistence/route-encoding';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { selectSavedWorld } from '../src/persistence/world-layout';
import { CitySession } from '../adapters/rpg-maker/bridge';
import { NpcStairMotion } from '../src/simulation/npc-stair-motion';
import { getFloorPlanStairPosition } from '../src/architecture-floor-plan';

const raw = gunzipSync(fs.readFileSync(new URL('./fixtures/native-live-reader/actual-browser-writer.save.json.gz', import.meta.url))).toString('utf8');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
assert.equal(hash(raw), '74467d2f3102c0ca8885ba1a4c006b5dea164e90b3cab56dd31466856d09b592');
const offenders = ['citizen-11', 'citizen-13', 'citizen-178', 'citizen-187', 'citizen-341', 'citizen-343'];
const motion = (sim: Simulation) => Reflect.get(sim, 'npcStairMotion') as NpcStairMotion;
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
function document() { const data = JSON.parse(raw); decodeCitizenRoutes(data.routeEncoding, data.routePool, data.state.citizens); return data; }
function record(name: string, value: unknown) {
  const dir = process.env.YUNSHAN_NATIVE_READER_EVIDENCE; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

test('actual unmodified browser writer restores its whole native city exactly through full, partition, selector and bridge readers', () => {
  const world = createWorld(20261001, 'current-v6'), selected = selectSavedWorld(raw), parts = partitionSave(raw, world);
  assert.equal(selected.layout, 'current-v6'); assert.equal(assembleSave(parts), raw);
  const full = new Simulation(world), partition = new Simulation(selected.world);
  for (const sim of [full, partition]) { const result = sim.importSave(raw); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), raw); }
  const bridge = new CitySession({ save: raw }); assert.equal(bridge.metadata.saveVersion, 2); assert.equal(bridge.exportCoreSave(), raw);
  const reopened = new CitySession({ save: bridge.exportSave() }); assert.equal(reopened.exportCoreSave(), raw);
  const rows = [];
  for (const id of offenders) {
    const actor = full.state.citizens.find(c => c.id === id)!;
    assert.equal(actor.routeIndex, 1); assert.deepEqual(actor.position, actor.route![0]); assert.equal(runtime(full).npcStairCursors[id], undefined);
    assert.equal(motion(full).describe(actor.route!, 1).kind, 'blocked'); assert(motion(full).isUnstartedExteriorDoorApproach(actor.route!, 1, actor.position));
    const before = JSON.stringify({ actor, profile: full.state.extension!.actorProfiles[id], attendance: runtime(full).attendance[id] });
    assert.equal(Reflect.get(full, 'moveCitizen').call(full, actor, .01), false);
    assert.equal(JSON.stringify({ actor, profile: full.state.extension!.actorProfiles[id], attendance: runtime(full).attendance[id] }), before, 'the pending plan neither moves the body nor pays labor');
    assert.equal(Reflect.get(full, 'citizenArrivalMinutes').get(actor), 0); assert.equal(runtime(full).npcStairCursors[id], undefined);
    rows.push({ id, body: actor.position, index: actor.routeIndex, state: actor.state, cursor: null, arrived: false, residualMinutes: 0 });
  }
  assert.equal(full.exportSave(), raw); record('actual-browser-pending-plans.json', rows); record('actual-browser-reader-opening.save.json', raw);
});

test('actual browser city continues for 24 advancing native ticks with exact full and partition bytes and each new writer can reopen', () => {
  const world = createWorld(20261001, 'current-v6'), live = new Simulation(world), complete = new Simulation(world), partition = new Simulation(selectSavedWorld(raw).world);
  for (const sim of [live, complete, partition]) { const loaded = sim.importSave(raw); assert.equal(loaded.ok, true, loaded.message); assert(sim.command({ type: 'pause', value: 0 }).ok); }
  const start = live.state.tick, rows = [];
  const openingActors = new Map(offenders.map(id => { const actor = live.state.citizens.find(c => c.id === id)!; return [id, { position: { ...actor.position }, attendance: runtime(live).attendance[id] ?? 0 }]; }));
  for (let i = 0; i < 24; i++) {
    for (const sim of [live, complete, partition]) sim.step(.25);
    assert.equal(live.state.tick, start + i + 1, 'paused no-op is not a continuation');
    const next = live.exportSave(); assert.equal(complete.exportSave(), next); assert.equal(partition.exportSave(), next);
    const assembled = assembleSave(partitionSave(next, world)); assert.equal(assembled, next);
    const result = partition.importSave(assembled); assert.equal(result.ok, true, result.message); assert.equal(partition.exportSave(), next);
    for (const id of offenders) {
      const actor = live.state.citizens.find(c => c.id === id)!, opening = openingActors.get(id)!;
      assert.deepEqual(actor.position, opening.position, id + ': the blocked door path remains blocked');
      assert.equal(runtime(live).attendance[id] ?? 0, opening.attendance, id + ': blocked travel earns no work attendance');
      assert.equal(runtime(live).npcStairCursors[id], undefined, id + ': no invented stair phase');
    }
    assert(Math.max(...live.state.citizens.map(c => c.route?.length ?? 0)) <= 1024);
    rows.push({ tick: live.state.tick, hour: live.state.hour, sha256: hash(next), cursors: Object.keys(runtime(live).npcStairCursors).length });
  }
  record('actual-browser-native24.json', rows); record('actual-browser-native-after24.save.json', live.exportSave());
});

test('blocked pending intent requires the exact exterior origin, first leg and actual door; invalid bytes remain atomic', () => {
  const data = document(), world = createWorld(20261001, 'current-v6'), actor = data.state.citizens.find((c: any) => c.id === offenders[0]), service = new NpcStairMotion(world);
  const description = service.describe(actor.route, 1); assert.equal(description.kind, 'blocked');
  const building = world.buildings.find(b => b.id === (description as { buildingId: string }).buildingId)!;
  const reader = new Simulation(world); assert(reader.importSave(raw).ok); const before = reader.exportSave();
  const cases: Record<string, (d: any, a: any) => void> = {
    detachedBody: (_d, a) => a.position.x += .001,
    interiorOrigin: (_d, a) => { a.position = getFloorPlanStairPosition(building, 0); a.route[0] = { ...a.position }; },
    wrongDoor: (_d, a) => a.route[1].z += .001,
    notFirstLeg: (_d, a) => { a.route.unshift({ ...a.route[0] }); a.routeIndex = 2; },
    missingCursorInRealPhase: (d) => { const id = Object.keys(d.runtime.npcStairCursors).find(id => d.runtime.npcStairCursors[id].offset > 0)!; assert(id); delete d.runtime.npcStairCursors[id]; },
  };
  const receipts = [];
  for (const [name, edit] of Object.entries(cases)) {
    const changed = document(), a = changed.state.citizens.find((c: any) => c.id === actor.id); edit(changed, a);
    if (name !== 'missingCursorInRealPhase') assert.equal(service.describe(a.route, a.routeIndex).kind, 'blocked', name + ': actual blocked geometry premise');
    delete changed.routeEncoding; delete changed.routePool;
    const bytes = JSON.stringify(changed), result = reader.importSave(bytes);
    assert.equal(result.ok, false, name + ': ' + result.message); assert.equal(reader.exportSave(), before, name + ': atomic');
    receipts.push({ name, result, bytesSHA256: hash(bytes) }); record('bad-pending-' + name + '.save.json', bytes);
  }
  record('bad-pending-receipts.json', receipts);
});
