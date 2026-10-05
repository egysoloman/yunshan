import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { createProductCity, createProductWorld, PRODUCT_CITY_LAYOUT } from '../src/product-city';
import { createWorld, CURRENT_CITY_LAYOUT } from '../src/world';
import { upgradeCityRuleset } from '../src/host/upgrade-city-ruleset';
import { budgetDescriptorSha256 } from '../src/simulation/budget-authority';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { savedWorldFingerprint, selectSavedWorld } from '../src/persistence/world-layout';
import { CitySession } from '../adapters/rpg-maker/bridge';
import { fixture } from './clinical-presence-fixture';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const oracleRaw = gunzipSync(fs.readFileSync(new URL('./fixtures/ruleset-core/compat-native-cold.save.json.gz', import.meta.url))).toString('utf8');
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/ruleset-core/compat-native-provenance.json', import.meta.url), 'utf8'));
const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
const data = (sim: Simulation) => JSON.parse(sim.exportSave());
function record(name: string, value: unknown) {
  const dir = process.env.YUNSHAN_RULESET_EVIDENCE; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
test('synchronous immutable authorization SHA256 matches the native UTF8 digest for empty, multiblock and Unicode descriptors', () => {
  for (const text of ['', 'abc', '云山🙂', 'x'.repeat(4096), '原授权\n🙂'.repeat(512)]) assert.equal(budgetDescriptorSha256(text), hash(text));
});
function proveEmpty(sim: Simulation) {
  const body = sim.state.civicStaffing!;
  assert.equal(body.version, 1);
  assert.deepEqual([body.proofs, body.applications, body.polls, body.terms], [[], [], [], []]);
  assert.deepEqual([body.nextProofId, body.nextApplicationId, body.nextPollId, body.nextTermId], [1, 1, 1, 1]);
}
function withoutProduct(json: string) {
  const d = JSON.parse(json); d.version = d.motionVersion; delete d.rulesetId; delete d.motionVersion;
  delete d.state.civicStaffing; delete d.runtime.civicStaffingVersion; delete d.state.budgetAuthority; delete d.runtime.budgetAuthorityVersion;
  d.runtime.persistedModules = d.runtime.persistedModules.filter((name: string) => name !== 'civicStaffing' && name !== 'budgetAuthority');
  return d;
}

test('explicit product city saves an empty v3 contract while the compatibility constructor remains exactly original native2', () => {
  const world = fixture(false), legacy = new Simulation(world), product = createProductCity(world);
  assert.equal(hash(oracleRaw), oracle.initialSHA256); assert.equal(legacy.exportSave(), oracleRaw);
  assert.equal(legacy.effectiveRuleset, 'legacy'); assert.equal(legacy.saveVersion, 2); assert.equal(legacy.rulesetEnablement, null);
  assert.equal(product.effectiveRuleset, 'civic-local-v1'); assert.equal(product.saveVersion, 3); assert.equal(product.motionVersion, 2);
  proveEmpty(product);
  const saved = data(product);
  record('new-city-v3-empty.save.json', product.exportSave());
  assert.equal(saved.rulesetId, 'civic-local-v1'); assert.equal(saved.motionVersion, 2);
  assert.equal(saved.runtime.civicStaffingVersion, 1); assert.deepEqual(saved.runtime.persistedModules.slice(-2), ['civicStaffing', 'budgetAuthority']);
  assert.deepEqual(saved.state.budgetAuthority.legacyAuthorizationRefs, []); assert.deepEqual(saved.state.budgetAuthority.requestIds, []); assert.equal(saved.state.budgetAuthority.legacySourceSha256, null);
  assert.deepEqual(withoutProduct(product.exportSave()), JSON.parse(oracleRaw), 'creation adds only explicit rule contract; no money, identity, RNG, routes or time change');
  for (const original of product.state.civicStaffing!.originalOfficials) {
    const citizen = legacy.state.citizens.find(actor => actor.id === original.actorId)!;
    assert.equal(citizen.role, original.baseRole); assert.equal(citizen.workId, original.workId); assert.equal(citizen.education, original.educationAtEnablement);
    assert.equal(original.source.kind, 'initial-profession');
  }
  const readonly = product.rulesetEnablement!; assert(Object.isFrozen(readonly));
  assert.throws(() => new Simulation(world, { rulesetId: 'unknown' } as any), /规则版本/);
  assert.throws(() => new Simulation(world, { rulesetId: 'civic-local-v1', trusted: true } as any), /规则版本/);
});

test('loading original native2 into a product constructor clears all new rules and preserves every actual tick24 original byte', () => {
  const world = fixture(false), product = createProductCity(world), restored = new Simulation(world);
  for (const city of [product, restored]) { const result = city.importSave(oracleRaw); assert.equal(result.ok, true, result.message); assert.equal(city.exportSave(), oracleRaw); }
  assert.equal(product.effectiveRuleset, 'legacy'); assert.equal(product.rulesetEnablement, null); assert.equal(product.state.civicStaffing, undefined);
  for (const row of oracle.rows) {
    product.step(.25); restored.step(.25);
    assert.equal(product.state.tick, row.tick); assert.equal(product.state.extension!.lastUpdate, row.clock);
    assert.equal(hash(product.exportSave()), row.sha256); assert.equal(restored.exportSave(), product.exportSave());
    assert.equal(product.effectiveRuleset, 'legacy'); assert.equal(product.state.civicStaffing, undefined);
  }
});

test('new v3 custom city restores whole and partition generation exactly for every real future tick24', () => {
  const world = fixture(false), sim = createProductCity(world), initial = sim.exportSave();
  const full = new Simulation(world), partition = new Simulation(world);
  assert.equal(full.importSave(initial).ok, true); assert.equal(full.exportSave(), initial);
  assert.equal(partition.importSave(assembleSave(partitionSave(initial, world))).ok, true); assert.equal(partition.exportSave(), initial);
  for (let i = 0; i < 24; i++) {
    sim.step(.25); full.step(.25); partition.step(.25);
    const expected = sim.exportSave();
    assert.equal(full.exportSave(), expected); assert.equal(partition.exportSave(), expected);
    assert.equal(assembleSave(partitionSave(expected, world)), expected);
    assert.equal(sim.state.tick, i + 1); assert.equal(sim.state.extension!.lastUpdate, 480 + (i + 1) * .25);
  }
  record('new-city-v3-after24.save.json', sim.exportSave());
});

test('half contract, version downgrade and malformed native motion stay atomic in the full reader and partition transport', () => {
  const world = fixture(false), sim = createProductCity(world), opening = sim.exportSave();
  const changes: [string, (d: any) => void][] = [
    ['ruleset missing', d => delete d.rulesetId], ['ruleset unknown', d => d.rulesetId = 'future'],
    ['motion missing', d => delete d.motionVersion], ['motion unknown', d => d.motionVersion = 3],
    ['body missing', d => delete d.state.civicStaffing], ['budget body missing', d => delete d.state.budgetAuthority], ['budget marker missing', d => delete d.runtime.budgetAuthorityVersion], ['marker missing', d => delete d.runtime.civicStaffingVersion],
    ['budget cutover mismatch', d => d.state.budgetAuthority.enablementId = 'different'],
    ['manifest missing', d => delete d.runtime.persistedModules], ['module omitted', d => d.runtime.persistedModules.pop()],
    ['module duplicate', d => d.runtime.persistedModules.push('civicStaffing')],
    ['downgrade2', d => d.version = 2], ['downgrade1', d => d.version = 1],
    ['body unknown', d => d.state.civicStaffing.version = 2], ['marker unknown', d => d.runtime.civicStaffingVersion = 2],
    ['cutover future tick', d => d.state.civicStaffing.enablement.enabledTick = d.state.tick + 1],
    ['new city borrowed SHA', d => d.state.civicStaffing.enablement.sourceSave = { sha256: 'a'.repeat(64), version: 2, motionVersion: 2 }],
    ['native marker deleted', d => delete d.runtime.npcMotionVersion], ['native cursors deleted', d => delete d.runtime.npcStairCursors],
    ['mismatched declared motion', d => d.motionVersion = 1], ['unknown business field', d => d.state.civicStaffing.trusted = true],
    ['fake proof', d => d.state.civicStaffing.proofs.push({ id: 'civic-proof-1' })],
    ['initial roster missing', d => d.state.civicStaffing.originalOfficials.pop()],
    ['initial education forged', d => d.state.civicStaffing.originalOfficials[0].educationAtEnablement++],
  ];
  for (const [label, change] of changes) {
    const bad = JSON.parse(opening); change(bad); const raw = JSON.stringify(bad);
    assert.equal(sim.importSave(raw).ok, false, label); assert.equal(sim.exportSave(), opening, `${label} atomic`);
    if (!['unknown business field', 'fake proof', 'initial roster missing', 'initial education forged'].includes(label)) assert.throws(() => partitionSave(raw, world), /ruleset/, label);
  }
  const parts = partitionSave(opening, world), global = parts.find(part => part.id === 'global')!;
  const parsed = JSON.parse(global.json); delete parsed.document.runtime.civicStaffingVersion; global.json = JSON.stringify(parsed);
  assert.throws(() => assembleSave(parts), /ruleset/);
  const legacy = JSON.parse(oracleRaw); legacy.state.civicStaffing = JSON.parse(opening).state.civicStaffing;
  assert.equal(sim.importSave(JSON.stringify(legacy)).ok, false); assert.equal(sim.exportSave(), opening);
});

test('trusted host upgrade requires exact stable SHA, adds empty cutover only, and preserves every original native fact', async () => {
  const world = fixture(false), city = new Simulation(world), before = city.exportSave();
  assert.equal((await upgradeCityRuleset(city, '0'.repeat(64))).ok, false); assert.equal(city.exportSave(), before);
  assert.equal((await upgradeCityRuleset(city, 'wrong')).ok, false); assert.equal(city.exportSave(), before);
  city.emitEvent({ type: 'upgrade-city-ruleset', purpose: 'civic-local-v1' }); assert.equal(city.exportSave(), before);
  const result = await upgradeCityRuleset(city, hash(before)); assert.equal(result.ok, true, result.message); proveEmpty(city);
  assert.equal(city.motionVersion, 2); assert.equal(city.saveVersion, 3); assert.equal(city.rulesetEnablement!.origin, 'host-upgrade');
  assert.equal(city.rulesetEnablement!.sourceSave!.sha256, hash(before));
  assert.deepEqual(city.state.civicStaffing!.originalOfficials, [], 'old v1 labor without immutable initial profession must not invent qualifications');
  assert.deepEqual(withoutProduct(city.exportSave()), JSON.parse(before));
  const upgraded = city.exportSave(); assert.equal((await upgradeCityRuleset(city, hash(upgraded))).ok, false); assert.equal(city.exportSave(), upgraded);
  record('host-native2-cutover.save.json', upgraded);
  const restored = new Simulation(world); assert.equal(restored.importSave(upgraded).ok, true); assert.equal(restored.exportSave(), upgraded);
  for (let i = 0; i < 24; i++) { city.step(.25); restored.step(.25); assert.equal(restored.exportSave(), city.exportSave()); assert.equal(assembleSave(partitionSave(city.exportSave(), world)), city.exportSave()); }
  const race = new Simulation(world), raceInitial = race.exportSave(), pending = upgradeCityRuleset(race, hash(raceInitial));
  assert.equal(race.command({ type: 'pause', value: 1 }).ok, true); const actuallyChanged = race.exportSave();
  assert.equal((await pending).ok, false); assert.equal(race.exportSave(), actuallyChanged); assert.equal(race.effectiveRuleset, 'legacy');
});

test('display clock rewind and forward commands retain lawful business cutover and do not create labor proof', () => {
  const world = fixture(false), city = createProductCity(world);
  for (const hour of [1, 23, 7]) {
    const before = structuredClone(city.state.civicStaffing), businessClock = city.state.extension!.lastUpdate, tick = city.state.tick;
    assert.equal(city.command({ type: 'setTime', value: hour }).ok, true);
    assert.equal(city.state.hour, hour); assert.equal(city.state.extension!.lastUpdate, businessClock); assert.equal(city.state.tick, tick);
    assert.deepEqual(city.state.civicStaffing, before);
    const saved = city.exportSave(), reader = new Simulation(world), result = reader.importSave(saved);
    assert.equal(result.ok, true, result.message); assert.equal(reader.exportSave(), saved);
  }
});

test('explicit upgrade of an actual legacy1 city keeps its original motion contract and exact restored future tick24', async () => {
  const raw = fs.readFileSync(new URL('./fixtures/roads-old22/cold.json', import.meta.url), 'utf8');
  const selected = selectSavedWorld(raw), city = createProductCity(selected.world);
  const loaded = city.importSave(raw); assert.equal(loaded.ok, true, loaded.message); assert.equal(city.exportSave(), raw);
  assert.equal(city.effectiveRuleset, 'legacy'); assert.equal(city.motionVersion, 1);
  const result = await upgradeCityRuleset(city, hash(raw)); assert.equal(result.ok, true, result.message); proveEmpty(city);
  const saved = city.exportSave(), parsed = JSON.parse(saved);
  record('host-legacy1-cutover.save.json', saved);
  assert.equal(parsed.version, 3); assert.equal(parsed.motionVersion, 1);
  assert.equal(parsed.runtime.npcMotionVersion, undefined); assert.equal(parsed.runtime.npcStairCursors, undefined);
  assert.deepEqual(withoutProduct(saved), JSON.parse(raw));
  const whole = new Simulation(selected.world), chunks = new Simulation(selected.world);
  assert.equal(whole.importSave(saved).ok, true); assert.equal(whole.exportSave(), saved);
  assert.equal(chunks.importSave(assembleSave(partitionSave(saved, selected.world))).ok, true); assert.equal(chunks.exportSave(), saved);
  const bridge = new CitySession({ save: saved }); assert.equal(bridge.metadata.saveVersion, 3); assert.equal(bridge.exportCoreSave(), saved);
  assert.equal(new CitySession({ save: bridge.exportSave() }).exportCoreSave(), saved);
  const initialTick = city.state.tick, initialClock = city.state.extension!.lastUpdate;
  for (let i = 0; i < 24; i++) {
    for (const sim of [city, whole, chunks]) sim.step(.25);
    const expected = city.exportSave(); assert.equal(whole.exportSave(), expected); assert.equal(chunks.exportSave(), expected);
    assert.equal(assembleSave(partitionSave(expected, selected.world)), expected);
    assert.equal(city.state.tick, initialTick + i + 1); assert.equal(city.state.extension!.lastUpdate, initialClock + (i + 1) * .25);
  }
});

test('explicit product world keeps validated v6 default and optional v7 restores known v6 cities and restores known v6 v3 through selector and source bridge unchanged', () => {
  assert.equal(CURRENT_CITY_LAYOUT, 'current-v6');
  const productWorld = createProductWorld(); assert.equal((productWorld as any).layoutVersion, PRODUCT_CITY_LAYOUT);
  assert.equal(selectSavedWorld(undefined, PRODUCT_CITY_LAYOUT).layout, 'current-v6');
  assert.equal(selectSavedWorld().layout, 'current-v6');
  assert.equal(selectSavedWorld(undefined, 'current-v7').layout, 'current-v7');
  const world = createWorld(20261001, 'current-v6'), city = createProductCity(world), raw = city.exportSave();
  record('new-city-v3-current-v6.save.json', raw);
  const selected = selectSavedWorld(raw, PRODUCT_CITY_LAYOUT); assert.equal(selected.layout, 'current-v6');
  assert.equal(savedWorldFingerprint(selected.world), savedWorldFingerprint(world));
  const reader = new Simulation(selected.world); assert.equal(reader.importSave(raw).ok, true); assert.equal(reader.exportSave(), raw);
  assert.equal(assembleSave(partitionSave(raw, world)), raw);
  const bridge = new CitySession({ save: raw }); assert.equal(bridge.metadata.saveVersion, 3); assert.equal(bridge.exportCoreSave(), raw);
  assert.equal(new CitySession({ save: bridge.exportSave() }).exportCoreSave(), raw);
  const bad = JSON.parse(raw); delete bad.rulesetId; assert.throws(() => selectSavedWorld(JSON.stringify(bad)), /ruleset/);
});
