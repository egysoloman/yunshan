import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createWorld } from '../src/world';
import type { NpcStairMotion } from '../src/simulation/npc-stair-motion';
import { buildingLocalPosition, blocksFloorPlanMovement, getBuildingFloorPlan, wallPanels } from '../src/architecture-floor-plan';
import type { Vec3 } from '../src/types';

const raw = gunzipSync(fs.readFileSync(new URL('./fixtures/native-live-reader/actual-browser-writer.save.json.gz', import.meta.url))).toString('utf8');
assert.equal(createHash('sha256').update(raw).digest('hex'), '74467d2f3102c0ca8885ba1a4c006b5dea164e90b3cab56dd31466856d09b592');
const actorIds = ['citizen-11', 'citizen-13', 'citizen-178', 'citizen-187', 'citizen-341', 'citizen-343'];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const record = (name: string, value: unknown) => { const dir = process.env.YUNSHAN_DOOR_ROUTE_EVIDENCE; if (!dir) return; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };

test('native describe and planning retain actual wall witnesses when feet are below floor zero but the head intersects its wall', () => {
  const sim = new Simulation(createWorld(20261001, 'current-v6')); assert(sim.importSave(raw).ok);
  const before = sim.exportSave(), service = Reflect.get(sim, 'npcStairMotion') as NpcStairMotion, rows = [];
  for (const id of actorIds) {
    const actor = sim.state.citizens.find(c => c.id === id)!, building = sim.worldDefinition.buildings.find(b => b.id === actor.homeId)!;
    const a = actor.route![0], z = actor.route![1], at = (t: number) => ({ x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t, z: a.z + (z.z - a.z) * t });
    const plan = getBuildingFloorPlan(building, 0)!; let contact;
    for (let i = 1; i <= 5000; i++) {
      const from = at((i - 1) / 5000), to = at(i / 5000), local = buildingLocalPosition(building, to);
      if (!(local.y < 0 && local.y + 1.72 > 0) || blocksFloorPlanMovement(building, 0, from, from, .35, 1.72) || !blocksFloorPlanMovement(building, 0, to, to, .35, 1.72)) continue;
      const wall = wallPanels(plan).find(panel => {
        const dx = Math.max(panel.rect.x0 - local.x, 0, local.x - panel.rect.x1), dz = Math.max(panel.rect.z0 - local.z, 0, local.z - panel.rect.z1);
        return dx * dx + dz * dz < .35 * .35 && panel.bottom < local.y + 1.72 && panel.top > local.y;
      });
      if (!wall) continue;
      const route = [from, to], description = service.describe(route, 1);
      assert.equal(blocksFloorPlanMovement(building, 0, from, to, .35, 1.72), true, id + ': an actual swept-body wall contact');
      const nativeAllowed = description.kind === 'legacy' && Reflect.get(sim, 'citizenReferenceSegmentAllowed').call(sim, actor, from, to, description.bodies ?? []);
      const plannedAllowed = Reflect.get(sim, 'walkingPrefixAllowed').call(sim, { ...actor, position: from }, route);
      contact = { id, buildingId: building.id, from, to, local, wall, kind: description.kind, witnessIds: description.kind === 'legacy' ? description.bodies?.map(body => body.building.id) ?? [] : [], nativeAllowed, plannedAllowed };
      break;
    }
    assert(contact, id + ': real saved-route upper-body contact'); rows.push(contact);
  }
  assert.equal(sim.exportSave(), before, 'pure witness/admission queries do not move actors or alter money, identity or cursors');
  record('six-upstream-upper-body.json', { scope: 'Actual saved-path short contact pairs; production describe and native admission, with clone-only planning. The original long native leg was already blocked; this is not a claim of live penetration.', rows });
  assert.deepEqual(rows.filter(row => row.nativeAllowed || row.plannedAllowed).map(row => row.id), []);
  assert(rows.every(row => row.kind === 'blocked' || row.witnessIds.includes(row.buildingId)), 'production must supply the real body witness, not a manually injected building');
});

test('actual six exterior actors rebuild from their actual street position without retaining a blocked old doorway prefix', () => {
  const sim = new Simulation(createWorld(20261001, 'current-v6'));
  const result = sim.importSave(raw); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), raw);
  const service = Reflect.get(sim, 'npcStairMotion') as NpcStairMotion, rows = [];
  const money = sim.state.citizens.map(actor => [actor.id, actor.money]);
  const player = structuredClone(sim.state.player), profiles = structuredClone(sim.state.extension!.actorProfiles);
  for (const id of actorIds) {
    const actor = sim.state.citizens.find(c => c.id === id)!, position = { ...actor.position }, oldRoute = structuredClone(actor.route!);
    const destination = sim.worldDefinition.buildings.find(b => b.id === actor.destinationId)!;
    assert.equal(service.describe(actor.route!, actor.routeIndex!).kind, 'blocked');
    const oldAnchors = Reflect.get(sim, 'walkingAnchors').call(sim, actor);
    Reflect.get(sim, 'setDestination').call(sim, actor, destination, true);
    assert.deepEqual(actor.position, position, 'planning does not move an actor');
    const planned = actor.route!, first = service.describe(planned, actor.routeIndex!);
    rows.push({ id, position, destinationId: destination.id, oldRoute, oldAnchors, planned, firstKind: first.kind });
  }
  record('six-original-replan.json', rows);
  record('six-original-replan.save.json', sim.exportSave());
  assert.deepEqual(sim.state.citizens.map(actor => [actor.id, actor.money]), money);
  assert.deepEqual(sim.state.player, player); assert.deepEqual(sim.state.extension!.actorProfiles, profiles);
  assert(rows.every(row => row.planned.length > 1), 'a singleton/unreachable route does not repair actual access');
  assert.deepEqual(rows.filter(row => row.firstKind === 'blocked').map(row => row.id), [], 'replanning must not retain the same physically blocked shortcut');
});

test('six real saved actors walk their repaired routes with unchanged speed, full 3D metre budgets, body clearance and actual residual arrival minutes', () => {
  const sim = new Simulation(createWorld(20261001, 'current-v6')); assert(sim.importSave(raw).ok);
  const service = Reflect.get(sim, 'npcStairMotion') as NpcStairMotion, runtime = Reflect.get(sim, 'runtime');
  const money = sim.state.citizens.map(actor => [actor.id, actor.money]), profiles = structuredClone(sim.state.extension!.actorProfiles);
  const rows = [], summaries = [];
  for (const id of actorIds) {
    const actor = sim.state.citizens.find(c => c.id === id)!, origin = { ...actor.position };
    const destination = sim.worldDefinition.buildings.find(b => b.id === actor.destinationId)!;
    // The original saved actor, position and intent are untouched inputs.
    // Its ordinary production destination writer rebuilds the blocked plan.
    Reflect.get(sim, 'setDestination').call(sim, actor, destination);
    const route = structuredClone(actor.route!), goal = { ...route.at(-1)! }, expected = service.remaining(actor.route!, actor.routeIndex!, actor.position);
    record('repaired-route-' + id + '.json', { origin, route, expected });
    assert(Number.isFinite(expected) && expected > 0, id + ': physically materializable full route');
    let charged = 0, calls = 0, arrived = false;
    while (!arrived) {
      const before = { ...actor.position }, index = actor.routeIndex!;
      arrived = Reflect.get(sim, 'moveCitizen').call(sim, actor, .25);
      const residual = Reflect.get(sim, 'citizenArrivalMinutes').get(actor) as number;
      const cursor = runtime.npcStairCursors[id];
      const row = { id, before, after: { ...actor.position }, index, nextIndex: actor.routeIndex, state: actor.state, arrived, residual, cursor: cursor ? structuredClone(cursor) : null };
      rows.push(row);
      if (arrived || distance(before, actor.position) <= 1e-10) record('six-real-motion.json', rows);
      assert(distance(before, actor.position) <= 1.05000001, id + ': actual displacement cannot exceed .25min * 4.2m/min');
      assert(distance(before, actor.position) > 1e-10 || arrived, id + ': repaired route makes actual progress');
      assert.notEqual(actor.state, 'physicalWaiting', id + ': no retained wall shortcut');
      if (cursor) service.validate(actor.route!, cursor, actor.position);
      for (const building of sim.worldDefinition.buildings) {
        const local = buildingLocalPosition(building, actor.position), radius = Math.max(building.width, building.depth) / 2 + 1;
        if (Math.abs(local.x) > radius || Math.abs(local.z) > radius) continue;
        for (let floor = -(building.basements ?? 0); floor < building.floors; floor++) {
          assert.equal(blocksFloorPlanMovement(building, floor, actor.position, actor.position, .35, 1.72), false, id + ': complete actual body at ' + building.id + '/' + floor);
        }
      }
      assert.equal(arrived ? residual >= 0 && residual <= .25 : residual === 0, true, id + ': onsite minutes only after actual arrival');
      charged += 1.05 - (arrived ? residual * 4.2 : 0);
      assert(++calls < 2000, id + ': bounded finite walk');
    }
    assert.deepEqual(actor.position, goal, id + ': real endpoint, not door projection');
    assert(Math.abs(charged - expected) < 1e-8, id + ': every real metre is charged');
    assert.equal(runtime.npcStairCursors[id], undefined);
    summaries.push({ id, origin, goal, expected, charged, calls, lastResidual: Reflect.get(sim, 'citizenArrivalMinutes').get(actor), route });
  }
  assert.deepEqual(sim.state.citizens.map(actor => [actor.id, actor.money]), money);
  assert.deepEqual(sim.state.extension!.actorProfiles, profiles);
  record('six-real-motion.json', rows);
  record('six-real-motion-receipt.json', { scope: 'Controlled CPU calls to production planner/mover on six unmodified real saved actors. Real metre/body/arrival verification; no clock steps or claim of natural employment/economy.', summaries });
});
