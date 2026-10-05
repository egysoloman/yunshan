// Explicit scopes; never automatically run the full city or a performance benchmark.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const here = dirname(fileURLToPath(import.meta.url));
const arg = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const scope = arg('--scope'), bundlePath = resolve(arg('--bundle') ?? ''), out = arg('--out');
assert(['protocol', 'capacity', 'whole-core', 'restoration'].includes(scope), 'choose one explicit --scope');
assert(out && !existsSync(out), '--out must name a fresh evidence directory'); mkdirSync(out, { recursive: true });
const bytes = readFileSync(bundlePath), sha = data => createHash('sha256').update(data).digest('hex');
assert.equal(sha(bytes), 'b376c8480b707ef51f109e52b3c2469e41e6d132e217f080423df51b16cee2db');
globalThis.crypto ??= webcrypto;
await import(pathToFileURL(resolve(here, 'client.js')).href);
const inputPaths = [bundlePath, ...['client.js', 'worker-entry.js', 'worker-thread-host.mjs', 'worker-protocol.test.mjs'].map(name => resolve(here, name))];
const hashes = () => Object.fromEntries(inputPaths.map(path => [path, sha(readFileSync(path))]));
const first = hashes(), startedAt = new Date().toISOString(), records = [], cases = [];
writeFileSync(resolve(out, 'inputs-first.json'), JSON.stringify(first, null, 2) + '\n');
const emit = value => { records.push(value); process.stdout.write(JSON.stringify(value) + '\n'); };
let client = null, rawWorker = null, heartbeats = 0, largestGap = 0, lastBeat = performance.now();
const timer = setInterval(() => { const now = performance.now(); largestGap = Math.max(largestGap, now - lastBeat); lastBeat = now; heartbeats++; }, 20);
const transport = [];
function create(options = {}, maxPendingRequests = 32) {
  return globalThis.YunshanWorker.createClient({ workerUrl: 'test-worker', coreUrl: pathToFileURL(bundlePath).href,
    options, maxPendingRequests, workerFactory: () => {
      rawWorker = new Worker(new URL('./worker-thread-host.mjs', import.meta.url),
        { workerData: { bundlePath, entryPath: resolve(here, 'worker-entry.js') } });
      const listeners = new Map();
      const deliver = (name, event) => { for (const fn of listeners.get(name) ?? []) fn(event); };
      rawWorker.on('message', data => { transport.push({ direction: 'reply', ...data, value: undefined }); deliver('message', { data }); });
      rawWorker.on('error', error => deliver('error', { message: error.message }));
      rawWorker.on('messageerror', () => deliver('messageerror', {}));
      return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        postMessage(data) { transport.push({ direction: 'request', ...data, args: undefined }); rawWorker.postMessage(data); },
        terminate() { return rawWorker.terminate(); } };
    } });
}
async function check(name, body) { await body(); cases.push({ name, status: 'PASS' }); emit({ phase: 'PASS', name }); }
const core = () => {
  const context = vm.createContext({ TextEncoder, TextDecoder });
  vm.runInContext('const Math = globalThis.Math, JSON = globalThis.JSON;\n' + bytes.toString('utf8'), context);
  return context.YunshanCore;
};
const copy = value => JSON.parse(JSON.stringify(value));
const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'];
emit({ phase: 'BEGIN', pid: process.pid, scope, bundleSha256: sha(bytes), note: 'Node transport diagnostic, not actual MZ/browser FPS or latency proof.' });
let failure = null;
try {
  if (scope === 'protocol') {
    client = create({}, 3);
    const queued = client.enqueue('query', ['snapshot']); queued.promise.catch(() => {});
    const cancelled = client.enqueue('queueCommand', [{ type: 'speed', value: 9 }, 'must-never-arrive']); cancelled.promise.catch(() => {});
    await check('bounded queue rejects new work; only unsent work can cancel', async () => {
      assert.throws(() => client.enqueue('metadata'), error => error.code === 'REQUEST_BACKPRESSURE');
      assert.equal(cancelled.cancel(), true); assert.equal(cancelled.cancel(), false);
      await assert.rejects(cancelled.promise, error => error.code === 'REQUEST_CANCELLED' && !error.uncertain && !error.accepted);
      assert.equal(client.cancel(client.status.inFlight), false, 'postMessage is irreversible before ack');
      const initial = await client.ready; assert.equal(initial.actorCount, 616); assert.equal(initial.metadata.coreCommit, '6785ca7dcca09e8e97afd610cfd52176c7a1cfb1');
      const state = (await queued.promise).value; assert.equal(state.speed, 1);
      assert.equal(transport.some(row => row.direction === 'request' && row.requestId === cancelled.requestId), false);
      assert.throws(() => client.enqueue('metadata', null), error => error.code === 'INVALID_REQUEST');
      assert.equal((await client.enqueue('metadata').promise).value.worldSeed, 20261001, 'local malformed input cannot break the next worker sequence');
    });
    await check('world copied once; snapshots detached; samples can become stale', async () => {
      const [world, another] = await Promise.all([client.worldSnapshot(), client.worldSnapshot()]);
      assert.equal(world.buildings.length, 612); assert.deepEqual(world, another);
      const before = await client.exportSave();
      world.spawn.x += 1000; another.nodes.length = 0; assert.equal((await client.worldSnapshot()).nodes.length > 0, true);
      const sample = await client.sample(); assert.equal(client.isCurrentSample(sample), true);
      sample.value.player.money = -1; sample.value.citizens[0].position.x += 1000;
      assert.equal(await client.exportSave(), before); assert.equal(client.isCurrentSample(sample), false);
      assert.equal(transport.filter(row => row.direction === 'request' && row.method === 'worldSnapshot').length, 1);
    });
    await check('FIFO queue acknowledgements differ from original business results', async () => {
      const first = { type: 'speed', value: 2 };
      const a = client.enqueue('queueCommand', [first, 'speed-first']); first.value = 8;
      const b = client.enqueue('queueCommand', [{ type: 'speed', value: 1 }, 'speed-second']);
      const flush = client.enqueue('advance', [0, { x: 0, z: 0 }]);
      assert.equal((await a.promise).value, 'speed-first'); assert.equal((await b.promise).value, 'speed-second');
      assert.equal((await flush.promise).value.tick, 0);
      const results = await client.drainResults();
      assert.deepEqual(results.map(row => row.requestId), ['speed-first', 'speed-second']);
      assert.deepEqual(results.map(row => row.command.value), [2, 1]); assert(results.every(row => row.result.ok));
      assert.equal((await client.sample()).value.speed, 1);
      const sent = transport.filter(row => row.direction === 'request');
      for (let index = 0; index < sent.length; index++) {
        assert.equal(sent[index].sequence, index + 1);
        const replies = transport.filter(row => row.direction === 'reply' && row.requestId === sent[index].requestId);
        assert.deepEqual(replies.map(row => row.kind), ['accepted', 'result']);
      }
    });
    await check('ready public calls copy input before their first await', async () => {
      const command = { type: 'speed', value: 2 };
      const queued = client.queueCommand(command, 'public-copy'); command.value = 8;
      assert.equal(await queued, 'public-copy');
      const input = { x: 0, z: 0 }, advancing = client.advance(0, input); input.x = 99;
      assert.equal((await advancing).frames, 0, 'later caller mutation cannot invalidate original legal input');
      const results = await client.drainResults(); assert.equal(results.length, 1);
      assert.deepEqual(results[0].command, { type: 'speed', value: 2 }); assert.equal(results[0].result.ok, true);
      assert.equal((await client.sample()).value.speed, 2);
      await client.queueCommand({ type: 'speed', value: 1 }, 'restore-speed'); await client.advance(0); await client.drainResults();
    });
    await check('no arbitrary step or position API; remote purchase returns real refusal', async () => {
      const before = await client.exportSave();
      const prior = await client.sample(); assert.equal(client.isCurrentSample(prior), true);
      await assert.rejects(client.enqueue('step', [.25]).promise, error => error.code === 'UNKNOWN_METHOD');
      assert.equal(client.isCurrentSample(prior), false, 'a failed terminal call also invalidates earlier samples');
      assert.equal(await client.exportSave(), before);
      const state = (await client.sample()).value, world = await client.worldSnapshot();
      const shop = state.shops.find(item => {
        const building = world.buildings.find(site => site.id === item.buildingId);
        return building && Math.hypot(building.door.x - state.player.position.x, building.door.z - state.player.position.z) > 100;
      });
      assert.ok(shop, 'a real existing remote shop, not an unknown command target');
      const coreBefore = await client.exportCoreSave();
      await client.queueCommand({ type: 'purchase', targetId: shop.id, value: 1 }, 'remote-buy');
      assert.equal(await client.exportCoreSave(), coreBefore, 'queue acknowledgement has no business side effect');
      await client.advance(0);
      const result = (await client.drainResults())[0]; assert.equal(result.requestId, 'remote-buy'); assert.equal(result.result.ok, false);
      assert.match(result.result.message, /入口|现场|附近/); assert.equal(result.tick, 0);
      assert.equal(await client.exportCoreSave(), coreBefore, 'remote refusal is byte-atomic including every wallet, stock and hidden runtime');
    });
    await check('bad loads preserve whole save, pending command and fractional time', async () => {
      await client.advance(.007); await client.queueCommand({ type: 'speed', value: 1 }, 'pending-on-load');
      const before = await client.exportSave();
      const foreign = JSON.parse(before); foreign.coreCommit = 'foreign';
      const badCore = JSON.parse(await client.exportCoreSave()); badCore.state.player.vehicleId = 'nonexistent';
      for (const save of ['{', JSON.stringify(foreign), JSON.stringify(badCore)]) {
        assert.equal((await client.importSave(save)).ok, false); assert.equal(await client.exportSave(), before);
      }
      const stale = await client.sample();
      const worldRequests = transport.filter(row => row.direction === 'request' && row.method === 'worldSnapshot').length;
      const [load, loadedWorld, loadedWorldAgain] = await Promise.all([client.importSave(before), client.worldSnapshot(), client.worldSnapshot()]);
      assert.equal(load.ok, true); assert.deepEqual(loadedWorld, loadedWorldAgain);
      assert.equal(transport.filter(row => row.direction === 'request' && row.method === 'worldSnapshot').length, worldRequests + 1,
        'concurrent world reads wait for a prior successful load and fetch only its new generation');
      assert.equal(await client.exportSave(), before); assert.equal(client.isCurrentSample(stale), false);
      const stopped = await client.stop(); assert.equal(stopped.save, before); assert.equal(stopped.pendingCommands, 1);
      assert.throws(() => client.enqueue('advance', [0]), error => error.code === 'WORKER_STOPPED');
    });
  } else if (scope === 'capacity') {
    client = create(); await client.ready;
    await check('256 command capacity retains every accepted result without implicit drain', async () => {
      for (let index = 0; index < 256; index++) await client.queueCommand({ type: 'speed', value: 1 }, `capacity-${index}`);
      const full = await client.exportSave();
      await assert.rejects(client.queueCommand({ type: 'speed', value: 2 }, 'overflow'), error => error.code === 'RESULT_BACKPRESSURE');
      assert.equal(await client.exportSave(), full);
      await client.advance(0); const awaiting = await client.exportSave();
      await assert.rejects(client.queueCommand({ type: 'speed', value: 2 }, 'still-overflow'), error => error.code === 'RESULT_BACKPRESSURE');
      assert.equal(await client.exportSave(), awaiting);
      const results = await client.drainResults(); assert.equal(results.length, 256);
      assert.deepEqual(results.map(row => row.requestId), Array.from({ length: 256 }, (_, index) => `capacity-${index}`));
      assert(results.every(row => row.result.ok)); assert.equal((await client.sample()).value.tick, 0);
    });
  } else {
    client = create(); const initial = await client.ready;
    let opening = await client.exportSave();
    if (scope === 'restoration') {
      await client.advance(.007); await client.queueCommand({ type: 'speed', value: 1 }, 'restore-pending');
      opening = await client.exportSave(); assert.equal((await client.importSave(opening)).ok, true);
      assert.equal(await client.exportSave(), opening);
    }
    const ticks = scope === 'whole-core' ? 8 : 2, saves = [], inputs = [], start = performance.now(), beatsBefore = heartbeats;
    for (let index = 0; index < ticks; index++) {
      const input = { x: index % 2 ? 1 : 0, z: index % 2 ? 0 : -1 };
      inputs.push(input);
      const frame = await client.advance(.25, input);
      assert.equal(frame.tick, initial.tick + index + 1); saves.push(await client.exportSave());
      emit({ phase: 'WORKER_TICK', index: index + 1, tick: frame.tick, clock: frame.clock });
    }
    const endState = (await client.sample()).value;
    assert.equal(endState.citizens.length, 616); assert.deepEqual(endState.lastSystemOrder, ORDER);
    assert(Math.abs(endState.day * 1440 + endState.hour * 60 - initial.clock - ticks * .25) < 1e-8);
    assert(heartbeats > beatsBefore, 'main event loop receives heartbeats during actual worker core ticks');
    emit({ phase: 'MAIN_HEARTBEAT_DURING_WORKER', heartbeats: heartbeats - beatsBefore,
      largestObservedGapMs: largestGap, workerElapsedMs: performance.now() - start,
      note: 'functional thread isolation only; no MZ/Chromium/FPS or real-time claim' });
    writeFileSync(resolve(out, 'worker-saves.json'), JSON.stringify({ opening, inputs, saves }) + '\n');
    await client.stop(); clearInterval(timer);
    // Sequential test oracle only, after the sole worker is stopped. Never a
    // second running simulation in the presentation or heartbeat measurement.
    await check(`${ticks} original bridge full-save steps equal the worker`, async () => {
      const oracle = core().createSession({ save: opening });
      assert.equal(oracle.exportSave(), opening);
      for (let index = 0; index < ticks; index++) { oracle.advance(.25, inputs[index]); assert.equal(oracle.exportSave(), saves[index], `complete bridge/core/RNG/queue equality at step ${index + 1}`); }
    });
  }
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; emit({ phase: 'FAIL', ...failure }); }
finally {
  clearInterval(timer);
  if (client && !client.status.closed) { try { await client.stop(); } catch (_) { client.abort('Diagnostic cleanup.'); } }
  if (rawWorker) await rawWorker.terminate();
  const last = hashes(); writeFileSync(resolve(out, 'inputs-last.json'), JSON.stringify(last, null, 2) + '\n');
  writeFileSync(resolve(out, 'transport.json'), JSON.stringify(transport, null, 2) + '\n');
  const receipt = { scope, startedAt, endedAt: new Date().toISOString(), status: failure ? 'FAIL' : 'PASS',
    cases, failure, sourceStable: JSON.stringify(first) === JSON.stringify(last), bundleSha256: sha(bytes),
    host: 'Node worker_threads + actual browser IIFE in VM; not native browser/MZ execution',
    noProductionSourceMutation: true, noCoreRateOrFPSPromise: true };
  writeFileSync(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); emit({ phase: 'FINAL', ...receipt });
  if (failure || !receipt.sourceStable) process.exitCode = 1;
}
