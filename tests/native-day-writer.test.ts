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
import { NpcStairMotion, type NpcStairCursor } from '../src/simulation/npc-stair-motion';
import { blocksFloorPlanMovement, floorPlanSupport } from '../src/architecture-floor-plan';
import type { Vec3 } from '../src/types';

const raw = gunzipSync(fs.readFileSync(new URL('./fixtures/native-day-writer/actual-day-writer.save.json.gz', import.meta.url))).toString('utf8');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
assert.equal(hash(raw), 'b0af5576bc587ed474d2a09f36e10f54a91666c5fef60ed6aa8929529dc20972');
const actorId = 'citizen-563';
const motion = (sim: Simulation) => Reflect.get(sim, 'npcStairMotion') as NpcStairMotion;
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function record(name: string, value: unknown) {
  const dir = process.env.YUNSHAN_DAY_WRITER_EVIDENCE; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
function document() { const data = JSON.parse(raw); decodeCitizenRoutes(data.routeEncoding, data.routePool, data.state.citizens); return data; }
function legalCheckpoint() {
  const data = document(), actor = data.state.citizens.find((c: { id: string }) => c.id === actorId);
  assert.equal(actor.routeIndex, 1); assert.equal(data.runtime.npcStairCursors[actorId], undefined);
  // This is an explicitly derived controlled checkpoint. Only the faulty,
  // never-started planned intent is cancelled; no body's XYZ is changed.
  actor.route = []; actor.routeIndex = 0; delete data.routeEncoding; delete data.routePool;
  const text = JSON.stringify(data), sim = new Simulation(createWorld(20261001, 'current-v6'));
  const result = sim.importSave(text); assert.equal(result.ok, true, result.message);
  record('controlled-legal-prestate.save.json', text); record('controlled-legal-reader.json', result);
  return sim;
}
function planned() {
  const sim = legalCheckpoint(), actor = sim.state.citizens.find(c => c.id === actorId)!;
  const before = { position: { ...actor.position }, cash: sim.state.citizens.map(c => [c.id, c.money]), profiles: structuredClone(sim.state.extension!.actorProfiles), player: structuredClone(sim.state.player), cursors: structuredClone(runtime(sim).npcStairCursors) };
  const target = sim.worldDefinition.buildings.find(b => b.id === actor.destinationId)!;
  Reflect.get(sim, 'setDestination').call(sim, actor, target, true);
  assert.deepEqual(actor.position, before.position); assert.deepEqual(sim.state.citizens.map(c => [c.id, c.money]), before.cash);
  assert.deepEqual(sim.state.extension!.actorProfiles, before.profiles); assert.deepEqual(sim.state.player, before.player); assert.deepEqual(runtime(sim).npcStairCursors, before.cursors);
  const save = sim.exportSave(), reader = new Simulation(sim.worldDefinition), loaded = reader.importSave(save);
  record('production-replan-writer.save.json', save); record('production-replan.json', { id: actor.id, body: actor.position, route: actor.route, index: actor.routeIndex, state: actor.state, loaded });
  assert.deepEqual(actor.route![0], before.position, 'the production route writer preserves every actual origin coordinate exactly');
  assert.notEqual(actor.route![0], actor.position, 'route coordinates are copied, never aliased to the body');
  assert.equal(loaded.ok, true, loaded.message); assert.equal(reader.exportSave(), save);
  return { sim, actor, save };
}

test('actual one-day invalid opening binding stays atomically rejected, while all 38 real saved phases remain valid', () => {
  const data = document(), world = createWorld(20261001, 'current-v6'), service = new NpcStairMotion(world), reader = new Simulation(world), before = reader.exportSave();
  assert.equal(Object.keys(data.runtime.npcStairCursors).length, 38);
  for (const [id, cursor] of Object.entries(data.runtime.npcStairCursors as Record<string, NpcStairCursor>)) { const actor = data.state.citizens.find((c: { id: string }) => c.id === id); service.validate(actor.route, cursor, actor.position); }
  const actor = data.state.citizens.find((c: { id: string }) => c.id === actorId), body = { ...actor.position };
  assert.equal(body.z, -2.4499999999999997); assert.equal(actor.route[0].z, -2.45);
  const desc = service.describe(actor.route, 1); assert.equal(desc.kind, 'physical');
  assert.throws(() => service.validate(actor.route, service.opening(actor.route, 1)!, body), /physical stair body or phase/);
  if (desc.kind === 'physical') { assert.equal(floorPlanSupport(desc.leg.building, 0, body, .35)!.y, body.y); assert.equal(blocksFloorPlanMovement(desc.leg.building, 0, body, body, .35, 1.72), false); }
  const result = reader.importSave(raw); assert.equal(result.ok, false); assert.match(result.message, /physical stair body or phase/); assert.equal(reader.exportSave(), before);
  record('original-one-day-rejection.json', { result, atomic: true, all38PhasesValid: true, body, opening: actor.route[0], deltaZ: body.z - actor.route[0].z });
});

test('native production planning preserves the exact supported origin, including isolated cache hits and full first physical-leg travel', () => {
  const { sim, actor } = planned(), origin = { ...actor.position }, service = motion(sim), startIndex = actor.routeIndex!;
  const description = service.describe(actor.route!, startIndex); assert.equal(description.kind, 'physical'); if (description.kind !== 'physical') throw new Error('actual physical premise');
  assert(description.leg.length > .38); assert(description.leg.parts.every(p => p.length > 0), 'no ULP or zero-length connector is appended');
  service.validate(actor.route!, service.opening(actor.route!, startIndex)!, origin);
  const to = actor.route![1], b = description.leg.building;
  const find = (from: Vec3) => Reflect.get(sim, 'floorPlanRoute').call(sim, b, 0, 0, from, b.door) as Vec3[];
  const cached = find(origin), same = find(origin), adjacent = find({ ...origin, z: -2.45 });
  assert.deepEqual(cached[0], origin); assert.deepEqual(same[0], origin); assert.notEqual(cached, same); assert.notEqual(cached[0], same[0]);
  assert.deepEqual(adjacent[0], { ...origin, z: -2.45 }, 'distinct full-precision keys are not rebound across physical origins');
  assert.deepEqual(cached[0], origin); assert.deepEqual(actor.position, origin);
  const rows = [], budget = .01 * (sim.state.weather === '雨' ? 3.1 : 4.2); let charged = 0, calls = 0;
  while (actor.routeIndex === startIndex) {
    const before = { ...actor.position }, cursor = runtime(sim).npcStairCursors[actor.id], offset = cursor ? structuredClone(cursor) : service.opening(actor.route!, startIndex)!;
    const usedBefore = description.leg.parts.slice(0, offset.piece).reduce((sum, p) => sum + p.length, 0) + offset.offset;
    const arrived = Reflect.get(sim, 'moveCitizen').call(sim, actor, .01); assert.equal(arrived, false);
    assert(distance(before, actor.position) <= budget + 1e-8); assert.equal(Reflect.get(sim, 'citizenArrivalMinutes').get(actor), 0);
    assert.notEqual(actor.state, 'physicalWaiting'); const after = runtime(sim).npcStairCursors[actor.id];
    const usedAfter = after && after.routeIndex === startIndex ? description.leg.parts.slice(0, after.piece).reduce((sum, p) => sum + p.length, 0) + after.offset : description.leg.length;
    const used = usedAfter - usedBefore; assert(used >= 0 && used <= budget + 1e-8); charged += used;
    if (after) service.validate(actor.route!, after, actor.position);
    const support = floorPlanSupport(b, 0, actor.position, .35); assert(support); assert(Math.abs(support.y - actor.position.y) <= .20000001);
    assert.equal(blocksFloorPlanMovement(b, support.floor, actor.position, actor.position, .35, 1.72), false);
    assert.equal(blocksFloorPlanMovement(b, support.floor, before, actor.position, .35, 1.72), false, 'the complete actual step body is swept, not only its endpoint');
    rows.push({ before, after: { ...actor.position }, index: actor.routeIndex, used, charged, cursor: after ? structuredClone(after) : null }); assert(++calls <= Math.ceil(description.leg.length / budget) + 1, 'finite travel uses the existing rain-dependent physical speed');
  }
  assert(Math.abs(charged - description.leg.length) < 1e-9); assert(distance(origin, to) <= description.leg.length + 1e-9);
  const result = new Simulation(sim.worldDefinition).importSave(sim.exportSave()); assert.equal(result.ok, true, result.message);
  record('first-physical-leg.json', { origin, to, actualLength: description.leg.length, charged, calls, rows, loaded: result });
});

test('new legal whole-city writer reopens exactly through full, partition, selector and bridge and advances 24 actual ticks', () => {
  const { sim: live, save } = planned(), world = live.worldDefinition, full = new Simulation(world), partition = new Simulation(selectSavedWorld(save).world);
  assert.equal(assembleSave(partitionSave(save, world)), save); for (const sim of [full, partition]) { assert(sim.importSave(save).ok); assert.equal(sim.exportSave(), save); }
  const bridge = new CitySession({ save }); assert.equal(bridge.metadata.saveVersion, 2); assert.equal(bridge.exportCoreSave(), save); assert.equal(new CitySession({ save: bridge.exportSave() }).exportCoreSave(), save);
  for (const sim of [live, full, partition]) assert(sim.command({ type: 'pause', value: 0 }).ok);
  const start = live.state.tick, clock = live.state.day * 1440 + live.state.hour * 60, speed = live.state.speed, rows = [];
  for (let i = 0; i < 24; i++) {
    for (const sim of [live, full, partition]) sim.step(.25);
    assert.equal(live.state.tick, start + i + 1); const next = live.exportSave(); assert.equal(full.exportSave(), next); assert.equal(partition.exportSave(), next);
    const selected = selectSavedWorld(next); assert.equal(selected.layout, 'current-v6'); const assembled = assembleSave(partitionSave(next, world)); assert.equal(assembled, next);
    const result = partition.importSave(assembled); assert.equal(result.ok, true, result.message); assert.equal(partition.exportSave(), next);
    assert(Math.max(...live.state.citizens.map(c => c.route?.length ?? 0)) <= 1024);
    for (const [id, cursor] of Object.entries(runtime(live).npcStairCursors as Record<string, NpcStairCursor>)) { const actor = live.state.citizens.find(c => c.id === id)!; motion(live).validate(actor.route!, cursor, actor.position); }
    rows.push({ tick: live.state.tick, clock: live.state.day * 1440 + live.state.hour * 60, sha256: hash(next), bytes: Buffer.byteLength(next), cursors: Object.keys(runtime(live).npcStairCursors).length, restored: result }); record('new-legal-native24.json', rows);
  }
  assert(Math.abs(live.state.day * 1440 + live.state.hour * 60 - clock - 24 * .25 * speed) < 1e-7);
  assert.equal(new CitySession({ save: live.exportSave() }).exportCoreSave(), live.exportSave()); record('new-legal-after24.save.json', live.exportSave());
});
