import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { upgradeResidentTuition } from '../src/host/upgrade-resident-tuition';
import { RESIDENT_TUITION_POLICY } from '../src/simulation/resident-education';

type UpgradeHost = Parameters<typeof upgradeResidentTuition>[0];
type Result = { ok: boolean; message: string };
interface MockOptions {
  saveVersion?: number; motionVersion?: number; tuition?: string; body?: object;
  validation?: Result; imported?: Result;
}
const sha = (raw: string): string => createHash('sha256').update(raw).digest('hex');

// This fixture exercises the host transaction only. It never creates a city,
// generates world geometry, or claims to validate a production save body.
function fixture(options: MockOptions = {}) {
  let raw = JSON.stringify({
    format: 'yunshan-save', version: 4, rulesetId: 'civic-local-v1', motionVersion: 2,
    worldSeed: 20261001, worldFingerprint: 'preserved-mock-world',
    state: { tick: 64, vehicles: [{ id: 'truck', cargo: 28, edgeId: 'existing-road', progress: .5 }],
      shops: [{ id: 'farm', inventory: 132, cash: 41 }], opaque: { retained: true } },
    runtime: { npcMotionVersion: 2,
      rng: 12345, cargoSources: { truck: 'farm' }, freight: { district: 28 },
      freightLots: { district: [{ shopId: null, quantity: 28 }] }, wages: [{ amount: 9 }],
      opaque: { retained: 'runtime' } },
  });
  const validations: string[] = [], imports: string[] = [];
  let exports = 0;
  const host = {
    get saveVersion() { return options.saveVersion ?? 4; },
    get motionVersion() { return options.motionVersion ?? 2; },
    get residentTuitionPolicyId() { return options.tuition ?? JSON.parse(raw).runtime.residentTuitionPolicyId ?? 'legacy'; },
    get state() { return { residentEducation: options.body }; },
    exportSave() { exports++; return raw; },
    validateSave(candidate: string) { validations.push(candidate); return options.validation ?? { ok: true, message: 'mock original accepted' }; },
    importSave(candidate: string) {
      imports.push(candidate);
      const result = options.imported ?? { ok: true, message: 'mock candidate imported' };
      if (result.ok) raw = candidate;
      return result;
    },
  };
  return { host: host as unknown as UpgradeHost, validations, imports,
    raw: () => raw, setRaw: (value: string) => { raw = value; }, exports: () => exports };
}

test('exact real SHA upgrades the mock host by appending only the two tuition declarations', async () => {
  const f = fixture(), original = f.raw();
  const result = await upgradeResidentTuition(f.host, sha(original));
  assert.equal(result.ok, true); assert.deepEqual(f.validations, [original]); assert.equal(f.imports.length, 1);
  const candidate = JSON.parse(f.raw());
  assert.equal(candidate.residentTuitionPolicyId, RESIDENT_TUITION_POLICY);
  assert.equal(candidate.runtime.residentTuitionPolicyId, RESIDENT_TUITION_POLICY);
  assert.equal(f.host.residentTuitionPolicyId, RESIDENT_TUITION_POLICY);
  delete candidate.residentTuitionPolicyId; delete candidate.runtime.residentTuitionPolicyId;
  assert.equal(JSON.stringify(candidate), original, 'actors, cargo, custody, cash, wages, RNG and opaque fields stay byte-identical');
  assert.equal(f.raw(), f.imports[0]);
});

test('malformed SHA values reject before reading or validating the mock source', async () => {
  for (const value of ['', 'a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64), undefined]) {
    const f = fixture(), original = f.raw();
    const result = await upgradeResidentTuition(f.host, value as string);
    assert.equal(result.ok, false); assert.equal(f.exports(), 0);
    assert.deepEqual(f.validations, []); assert.deepEqual(f.imports, []); assert.equal(f.raw(), original);
  }
});

test('wrong real SHA rejects without importing or adding a declaration', async () => {
  const f = fixture(), original = f.raw();
  const result = await upgradeResidentTuition(f.host, sha(`${original} `));
  assert.equal(result.ok, false); assert.match(result.message, /SHA/);
  assert.deepEqual(f.validations, [original]); assert.deepEqual(f.imports, []); assert.equal(f.raw(), original);
});

test('wrong version, native motion, existing body and existing or invented tuition reject before source reads', async () => {
  for (const options of [
    { saveVersion: 3 }, { motionVersion: 1 }, { body: {} },
    { tuition: RESIDENT_TUITION_POLICY }, { tuition: 'invented' },
  ]) {
    const f = fixture(options), original = f.raw();
    const result = await upgradeResidentTuition(f.host, sha(original));
    assert.equal(result.ok, false); assert.equal(f.exports(), 0);
    assert.deepEqual(f.validations, []); assert.deepEqual(f.imports, []); assert.equal(f.raw(), original);
  }
});

test('repeat upgrade rejects the already upgraded source without importing twice', async () => {
  const f = fixture();
  assert.equal((await upgradeResidentTuition(f.host, sha(f.raw()))).ok, true);
  const upgraded = f.raw(), exportCount = f.exports();
  assert.equal((await upgradeResidentTuition(f.host, sha(upgraded))).ok, false);
  assert.equal(f.exports(), exportCount); assert.equal(f.validations.length, 1);
  assert.equal(f.imports.length, 1); assert.equal(f.raw(), upgraded);
});

test('failed source validation prevents hashing and importing', async t => {
  t.mock.method(crypto.subtle, 'digest', () => { throw new Error('digest must not run'); });
  const f = fixture({ validation: { ok: false, message: 'mock invalid original' } }), original = f.raw();
  const result = await upgradeResidentTuition(f.host, sha(original));
  assert.equal(result.ok, false); assert.match(result.message, /mock invalid original/);
  assert.deepEqual(f.validations, [original]); assert.deepEqual(f.imports, []); assert.equal(f.raw(), original);
});

test('source advancement while SHA is pending rejects and preserves the advanced source', async t => {
  let releaseDigest: ((value: ArrayBuffer) => void) | undefined;
  let hashed: Uint8Array | undefined;
  t.mock.method(crypto.subtle, 'digest', (_algorithm: unknown, bytes: Uint8Array) => {
    hashed = new Uint8Array(bytes);
    return new Promise<ArrayBuffer>(resolve => { releaseDigest = resolve; });
  });
  const f = fixture(), original = f.raw();
  const pending = upgradeResidentTuition(f.host, sha(original));
  assert.ok(releaseDigest); assert.equal(new TextDecoder().decode(hashed), original);
  const advanced = JSON.parse(original); advanced.state.tick++;
  const current = JSON.stringify(advanced); f.setRaw(current);
  releaseDigest(new Uint8Array(createHash('sha256').update(original).digest()).buffer);
  const result = await pending;
  assert.equal(result.ok, false); assert.match(result.message, /等待期间城市已继续/);
  assert.deepEqual(f.validations, [original]); assert.deepEqual(f.imports, []); assert.equal(f.raw(), current);
});

test('candidate import rejection propagates without changing the mock source', async () => {
  const rejection = { ok: false, message: 'mock candidate rejected' };
  const f = fixture({ imported: rejection }), original = f.raw();
  assert.deepEqual(await upgradeResidentTuition(f.host, sha(original)), rejection);
  assert.equal(f.imports.length, 1); assert.equal(f.raw(), original);
  const candidate = JSON.parse(f.imports[0]);
  delete candidate.residentTuitionPolicyId; delete candidate.runtime.residentTuitionPolicyId;
  assert.equal(JSON.stringify(candidate), original);
});

test('hashing failure reports rejection without importing or changing the mock source', async t => {
  t.mock.method(crypto.subtle, 'digest', async () => { throw new Error('mock digest unavailable'); });
  const f = fixture(), original = f.raw();
  const result = await upgradeResidentTuition(f.host, sha(original));
  assert.equal(result.ok, false); assert.match(result.message, /mock digest unavailable/);
  assert.deepEqual(f.imports, []); assert.equal(f.raw(), original);
});
