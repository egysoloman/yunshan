import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { PLAYER_YIELD_METRES, PLAYER_YIELD_POLICY, validatePlayerYieldPolicy, yieldStop, yieldsToPlayer } from '../src/simulation/player-yield';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import type { Vec3 } from '../src/types';

test('a resident waits rather than step into the player, and only when approaching', () => {
  const p = { x: 0, y: 10, z: 0 }, at = (x: number, y = 10): Vec3 => ({ x, y, z: 0 });
  assert.equal(yieldsToPlayer(PLAYER_YIELD_POLICY, p, at(1), at(.6)), true);
  assert.equal(yieldsToPlayer(PLAYER_YIELD_POLICY, p, at(.5), at(.6)), false, 'stepping away is free');
  assert.equal(yieldsToPlayer(PLAYER_YIELD_POLICY, p, at(2), at(1)), false, 'outside the body disks');
  assert.equal(yieldsToPlayer(PLAYER_YIELD_POLICY, p, at(-1.6), at(2.6)), true, 'a long step cannot jump through the player');
  assert.equal(yieldsToPlayer(PLAYER_YIELD_POLICY, p, { x: -2, y: 10, z: 1 }, { x: 2, y: 10, z: 1 }), false, 'passing 1 m to the side is free');
  assert.equal(yieldsToPlayer(PLAYER_YIELD_POLICY, p, at(1, 14), at(.6, 14)), false, 'another level');
  assert.equal(yieldsToPlayer(PLAYER_YIELD_POLICY, null, at(1), at(.6)), false, 'the player is not on foot');
  assert.equal(yieldsToPlayer(undefined, p, at(1), at(.6)), false, 'undeclared cities walk through');
  const stop = yieldStop(p, at(5), at(-5)), jump = yieldStop(p, at(-1.6), at(2.6));
  assert.ok(Math.abs(jump.x + PLAYER_YIELD_METRES) < 1e-12, 'a long step stops where it would enter the body disks');
  assert.ok(Math.abs(stop.x - PLAYER_YIELD_METRES) < 1e-12 && stop.z === 0, 'it walks up to the edge of the body disks');
  assert.deepEqual(yieldStop(p, at(.5), at(-5)), at(.5), 'already inside: it stays');
});

test('in a new city a resident walking toward the player stops short and walks on once the player steps aside; saves read back', () => {
  const world = createProductWorld();
  const yielding = createCurrentProductCity(world), through = createCurrentProductCity(world);
  delete (through as unknown as { runtime: { playerYieldPolicyId?: string } }).runtime.playerYieldPolicyId;
  assert.equal((yielding as unknown as { playerYieldPolicyId: string }).playerYieldPolicyId, PLAYER_YIELD_POLICY);
  assert.equal((through as unknown as { playerYieldPolicyId: string }).playerYieldPolicyId, 'legacy');
  const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
  let checked = 0;
  for (let round = 0; round < 60 && checked < 3; round++) {
    for (let i = 0; i < 8; i++) { yielding.step(.25); through.step(.25); }
    assert.equal(yielding.state.tick, through.state.tick);
    // A resident in the open on a straight stretch (at least 4 m to its next waypoint), the same in both cities.
    const walker = yielding.state.citizens.find(c => c.state === 'moving' && c.route && (c.routeIndex ?? 0) < c.route.length
      && flat(c.position, c.route[c.routeIndex ?? 0]) > 4 && Math.abs(c.route[c.routeIndex ?? 0].y - c.position.y) < .05
      && !world.buildings.some(b => flat(b.position, c.position) < Math.max(b.width, b.depth)));
    if (!walker) continue;
    const twin = through.state.citizens.find(c => c.id === walker.id)!;
    if (flat(twin.position, walker.position) > 1e-9) continue;
    const next = walker.route![walker.routeIndex ?? 0], d = flat(walker.position, next);
    const ahead = { x: walker.position.x + (next.x - walker.position.x) / d * 1.2, y: walker.position.y, z: walker.position.z + (next.z - walker.position.z) / d * 1.2 };
    for (const sim of [yielding, through]) sim.setFocus(ahead, 'walk');
    let closest = Infinity, passed = Infinity;
    for (let i = 0; i < 12; i++) {
      yielding.step(.25); through.step(.25);
      const a = yielding.state.citizens.find(c => c.id === walker.id)!, b = through.state.citizens.find(c => c.id === walker.id)!;
      if (a.state === 'moving') closest = Math.min(closest, flat(a.position, ahead));
      passed = Math.min(passed, flat(b.position, ahead));
    }
    if (passed > .2) continue; // the twin turned off before reaching the player
    assert.ok(closest >= PLAYER_YIELD_METRES - 1e-9 && closest < PLAYER_YIELD_METRES + .05, `${walker.id} walked up to the player and stopped (${closest.toFixed(3)} m)`);
    const held = { ...yielding.state.citizens.find(c => c.id === walker.id)!.position };
    const saved = yielding.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
    assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved, 'a waiting resident saves and reads back exactly');
    assert.equal(assembleSave(partitionSave(saved, world)), saved);
    for (const sim of [yielding, through]) sim.setFocus({ x: ahead.x + 3, y: ahead.y, z: ahead.z + 3 }, 'walk');
    for (let i = 0; i < 4; i++) { yielding.step(.25); through.step(.25); }
    assert.ok(flat(yielding.state.citizens.find(c => c.id === walker.id)!.position, held) > .05, 'it walks on once the player steps aside');
    checked++;
  }
  assert.ok(checked >= 1, 'a resident met the player in the open');
  const doc = JSON.parse(yielding.exportSave());
  assert.equal(doc.playerYieldPolicyId, PLAYER_YIELD_POLICY);
  assert.throws(() => validatePlayerYieldPolicy({ ...doc, playerYieldPolicyId: undefined }), /player yield/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('playerYield'), false, 'an undeclared city carries no policy');
});
