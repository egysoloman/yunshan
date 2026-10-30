import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation } from '../src/simulation';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld, CURRENT_PRODUCT_OPTIONS } from '../src/product-city';
import { HOME_MATS_POLICY, homeMatPointAt, homeMats, MAT_SPACING, validateHomeMatsPolicy } from '../src/simulation/home-mats';
import { homeRestPointAt, homeRestPoints } from '../src/simulation/home-rest';
import { floorPlanSupport } from '../src/architecture-floor-plan';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import type { Player } from '../src/types';

test('a home offers mats on free room floor, up to its capacity less its beds, apart from beds and each other', () => {
  const world = createProductWorld(), resident: Pick<Player, 'role' | 'identities'> = { role: 'merchant', identities: ['merchant'] };
  const town = world.buildings.filter(b => b.kind === 'home' && b.districtId === 'market');
  assert.ok(town.length > 10);
  for (const home of town) {
    const beds = Array.from({ length: home.floors }, (_, f) => homeRestPoints(home, f)).flat(), mats = homeMats(home), bedCount = new Set(beds.map(b => b.bedId)).size;
    assert.equal(bedCount, home.floors, `${home.id}: one bed per floor`);
    assert.ok(mats.length > 0 && mats.length <= home.capacity - bedCount, `${home.id}: ${mats.length} mats for capacity ${home.capacity}`);
    assert.deepEqual(homeMats(home), mats, 'derived once, the same every time');
    for (const mat of mats) {
      assert.equal(mat.side, 'mat'); assert.equal(mat.bedId, mat.id);
      const support = floorPlanSupport(home, mat.floor, mat.position, .35);
      assert.ok(support && support.kind === 'room' && support.floor === mat.floor, `${mat.id} lies on a room floor`);
      assert.ok(beds.every(b => Math.hypot(b.position.x - mat.position.x, b.position.z - mat.position.z) >= 1 - 1e-9 || b.floor !== mat.floor), `${mat.id} keeps clear of bed sides`);
      assert.ok(mats.every(o => o === mat || o.floor !== mat.floor || Math.hypot(o.position.x - mat.position.x, o.position.z - mat.position.z) >= MAT_SPACING - 1e-6), `${mat.id} keeps its spacing`);
      assert.equal(homeMatPointAt(home, mat.position, resident)?.id, mat.id);
      assert.equal(homeRestPointAt(home, mat.position, resident), null, 'a mat is not a bed side: the player keeps bed-side rest');
    }
  }
});

test('in a declared city nobody sleeps away from home on the first night; without the rule many do', () => {
  const world = createProductWorld(), { homeMatsPolicyId: _omit, ...withoutRule } = CURRENT_PRODUCT_OPTIONS, away: number[] = [];
  const buildings = new Map(world.buildings.map(b => [b.id, b]));
  for (const declared of [true, false]) {
    const sim = declared ? createCurrentProductCity(world) : new Simulation(world, withoutRule);
    assert.equal(sim.homeMatsPolicyId, declared ? HOME_MATS_POLICY : undefined);
    sim.command({ type: 'speed', value: 8 }); sim.setFocus(world.spawn, 'walk');
    while (sim.state.day < 1 || sim.state.hour < 2) sim.step(.25);
    const activities = Reflect.get(sim, 'runtime').activities as Record<string, string>;
    away.push(sim.state.citizens.filter(c => activities[c.id] === 'rest' && c.destinationId !== c.homeId && buildings.get(c.destinationId ?? '')).length);
    if (declared) {
      const saved = sim.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
      assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
      assert.equal(assembleSave(partitionSave(saved, world)), saved);
    }
  }
  // Night 1 of a new city: 224 of 619 residents slept at a clinic, station or pavilion before this rule.
  assert.equal(away[0], 0, `${away[0]} resting away from home with the rule`);
  assert.ok(away[1] > 100, `${away[1]} resting away from home without the rule`);
});

test('the policy is declared in the save and refused when half missing', () => {
  const world = createProductWorld(), doc = JSON.parse(createCurrentProductCity(world).exportSave());
  assert.equal(doc.homeMatsPolicyId, HOME_MATS_POLICY); assert.equal(doc.runtime.homeMatsPolicyId, HOME_MATS_POLICY);
  assert.throws(() => validateHomeMatsPolicy({ ...doc, homeMatsPolicyId: undefined }), /home mats/);
  assert.throws(() => validateHomeMatsPolicy({ ...doc, runtime: { ...doc.runtime, homeMatsPolicyId: undefined } }), /home mats/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('homeMats'), false);
});
