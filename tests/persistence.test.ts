import assert from 'node:assert/strict';
import test, { after, before, type TestContext } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer as createHTTPServer, type Server } from 'node:http';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';

declare global { interface Window { saveTest: any } }
let browser: Browser, server: ViteDevServer, fixtureServer: Server, baseURL: string;
const evidence: Record<string, unknown>[] = [];
const artifactDir = new URL('../artifacts/', import.meta.url);
let initialHashes: Record<string, string>;
async function sourceHashes(): Promise<Record<string, string>> {
  const paths = ['src/persistence.ts', 'src/persistence/partition.ts', 'src/simulation.ts', 'src/world.ts', 'src/types.ts'];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex')])));
}
before(async () => {
  initialHashes = await sourceHashes();
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [{ name: 'persistence-fixture', configureServer(vite) { vite.middlewares.use((request, response, next) => { if (request.url !== '/save-test.html') return next(); response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Storage transaction test</title><link rel="icon" href="data:,">'); }); } }],
  });
  fixtureServer = createHTTPServer(server.middlewares);
  await new Promise<void>(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const address = fixtureServer.address();
  if (!address || typeof address === 'string') throw new Error('No persistence test server address');
  baseURL = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  await browser?.close();
  if (fixtureServer) await new Promise<void>((resolve, reject) => fixtureServer.close(error => error ? reject(error) : resolve()));
  await server?.close();
  await mkdir(artifactDir, { recursive: true });
  await writeFile(new URL('persistence-results.json', artifactDir), JSON.stringify({ at: new Date().toISOString(), environment: 'Linux Chromium real IndexedDB, Vite source modules; no WebGL renderer', initialHashes, finalHashes: await sourceHashes(), evidence }, null, 2));
});

async function fixture(t: TestContext, oldDatabase = false): Promise<Page> {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  // tsx keeps function names with this helper when Playwright serializes test
  // closures. The browser's separately served application needs no shim.
  await page.addInitScript('globalThis.__name = (value) => value');
  await page.goto(`${baseURL}/save-test.html`);
  if (oldDatabase) await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.open('yunshan-city', 1); request.onupgradeneeded = () => request.result.createObjectStore('journeys', { keyPath: 'id' }); request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(); }; });
  });
  await page.evaluate(async () => {
    const persistencePath = '/src/persistence.ts', worldPath = '/src/world.ts', simulationPath = '/src/simulation.ts';
    const [persistence, { createWorld }, { Simulation }] = await Promise.all([import(persistencePath), import(worldPath), import(simulationPath)]);
    const world = createWorld(), simulation = new Simulation(world);
    const puts: { store: string; id: string }[] = [];
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { puts.push({ store: this.name, id: value.id }); return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key); };
    const inspect = async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        const names = [...db.objectStoreNames], transaction = db.transaction(names, 'readonly');
        const entries = await Promise.all(names.map(async name => [name, await new Promise<any[]>((resolve, reject) => { const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })]));
        return Object.fromEntries(entries);
      } finally { db.close(); }
    };
    window.saveTest = { persistence, world, simulation, Simulation, puts, originalPut, inspect };
  });
  return page;
}

test('partition reassembly rejects missing entities instead of returning a partial city', () => {
  const json = JSON.stringify({ format: 'yunshan-save', state: { citizens: [{ id: 'a', position: { x: 0, z: 0 } }, { id: 'b', position: { x: 512, z: 0 } }], player: { money: 7 } }, runtime: {} });
  const parts = partitionSave(json);
  assert.equal(assembleSave(parts), json);
  assert.throws(() => assembleSave(parts.filter(part => part.id !== 'chunk:2:0')), /缺失存档实体/);
});

test('real IndexedDB saves the complete generated city in geographic chunks and resumes identically', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; f.simulation.command({ type: 'speed', value: 8 });
    for (let tick = 0; tick < 24; tick++) f.simulation.step(.25);
    const json = f.simulation.exportSave(); await f.persistence.writeSavedGame(json, f.world);
    const loaded = await f.persistence.readSavedGame(), stored = await f.inspect();
    const restored = new f.Simulation(f.world), imported = restored.importSave(loaded);
    const exactRestore = restored.exportSave() === json;
    for (let tick = 0; tick < 12; tick++) { restored.step(.25); f.simulation.step(.25); }
    const chunks = stored['save-chunks'].map((record: any) => JSON.parse(record.json));
    const citizenCount = chunks.reduce((sum: number, chunk: any) => sum + (chunk.arrays['state.citizens']?.length ?? 0), 0);
    return { exactStored: loaded === json, imported, exactRestore, continuation: restored.exportSave() === f.simulation.exportSave(), citizenCount, expected: f.simulation.state.citizens.length, stores: Object.keys(stored), global: JSON.parse(stored['save-global'][0].json).document, player: JSON.parse(stored['save-player'][0].json), chunkCount: chunks.length, legacyWrites: stored.journeys.length };
  });
  assert.equal(result.exactStored, true); assert.equal(result.imported.ok, true); assert.equal(result.exactRestore, true); assert.equal(result.continuation, true);
  assert.equal(result.citizenCount, result.expected); assert(result.citizenCount >= 616); assert(result.chunkCount > 20);
  assert.equal(result.global.state.citizens, undefined); assert.equal(result.global.state.player, undefined); assert.equal(typeof result.global.state.treasury, 'number'); assert.equal(typeof result.global.state.hour, 'number');
  assert.equal(typeof result.player.values['state.player'].money, 'number'); assert.equal(result.legacyWrites, 0);
  evidence.push({ check: 'complete-city-roundtrip-continuation', ...result, global: undefined, player: undefined });
});

test('unchanged, player-only and global-only saves physically avoid rewriting city chunks', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; let json = f.simulation.exportSave(); await f.persistence.writeSavedGame(json, f.world);
    f.puts.length = 0; await f.persistence.writeSavedGame(json, f.world); const unchanged = [...f.puts], unchangedStatus = f.persistence.getSaveStorageStatus();
    f.simulation.state.player.money += 3; json = f.simulation.exportSave(); f.puts.length = 0; await f.persistence.writeSavedGame(json, f.world); const player = [...f.puts];
    f.simulation.state.treasury += 7; json = f.simulation.exportSave(); f.puts.length = 0; await f.persistence.writeSavedGame(json, f.world); const global = [...f.puts];
    return { unchanged, unchangedStatus, player, global, exact: await f.persistence.readSavedGame() === json };
  });
  assert.deepEqual(result.unchanged.map(entry => entry.store), ['save-manifests']);
  assert.equal(result.unchangedStatus.lastWrite.bytesWritten, 0);
  assert.deepEqual(result.player.map(entry => entry.store), ['save-player', 'save-manifests']);
  assert.deepEqual(result.global.map(entry => entry.store), ['save-global', 'save-manifests']); assert.equal(result.exact, true);
  evidence.push({ check: 'independent-incremental-writes', ...result });
});

test('one changed NPC route writes one chunk despite global route-pool renumbering', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest;
    const a = f.simulation.state.citizens[0], b = f.simulation.state.citizens.find((citizen: any) => Math.floor(citizen.position.x / 256) !== Math.floor(a.position.x / 256) || Math.floor(citizen.position.z / 256) !== Math.floor(a.position.z / 256));
    a.route = [{ ...a.position }, { x: a.position.x + 1, y: a.position.y, z: a.position.z }]; a.routeIndex = 0;
    b.route = [{ ...b.position }, { x: b.position.x + 2, y: b.position.y, z: b.position.z }]; b.routeIndex = 0;
    await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world); f.puts.length = 0;
    a.route.push({ x: a.position.x + 3, y: a.position.y, z: a.position.z });
    const json = f.simulation.exportSave(); await f.persistence.writeSavedGame(json, f.world);
    return { puts: f.puts, status: f.persistence.getSaveStorageStatus(), exact: await f.persistence.readSavedGame() === json };
  });
  assert.deepEqual(result.puts.map((entry: any) => entry.store), ['save-chunks', 'save-manifests']);
  assert.equal(result.status.lastWrite.chunksWritten, 1); assert.equal(result.status.lastWrite.globalWritten, false); assert.equal(result.exact, true);
  evidence.push({ check: 'single-npc-route-write', ...result });
});

test('cross-chunk movement and deletion leave no duplicate or missing entities after reload', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest;
    f.simulation.state.voxels.push({ id: 'voxel-persistence', position: { x: 17000, y: 20, z: 17000 }, color: '#ffffff' });
    await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world);
    const a = f.simulation.state.citizens[0]; a.position = { ...a.position, x: a.position.x + 2560 };
    const vehicle = f.simulation.state.vehicles[0]; vehicle.position = { ...vehicle.position, z: vehicle.position.z - 1024 };
    f.simulation.state.voxels.pop(); const json = f.simulation.exportSave(); await f.persistence.writeSavedGame(json, f.world);
    const loaded = JSON.parse(await f.persistence.readSavedGame()), stored = await f.inspect(), manifest = stored['save-manifests'][0];
    return { exact: await f.persistence.readSavedGame() === json, count: loaded.state.citizens.filter((citizen: any) => citizen.id === a.id).length, vehicleCount: loaded.state.vehicles.filter((candidate: any) => candidate.id === vehicle.id).length, voxels: loaded.state.voxels.length, oldVoxelReference: manifest.parts.some((part: any) => part.id === 'chunk:66:66') };
  });
  assert.equal(result.exact, true); assert.equal(result.count, 1); assert.equal(result.vehicleCount, 1); assert.equal(result.voxels, 0); assert.equal(result.oldVoxelReference, false);
  evidence.push({ check: 'cross-chunk-movement-and-deletion', ...result });
});

test('an aborted multi-store transaction with unavailable fallback preserves the prior city', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; const original = f.simulation.exportSave(); await f.persistence.writeSavedGame(original, f.world);
    const before = JSON.stringify(await f.inspect());
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Test quota failure', 'QuotaExceededError'); };
    IDBObjectStore.prototype.put = function (value, key) { const request = key === undefined ? f.originalPut.call(this, value) : f.originalPut.call(this, value, key); if (this.name === 'save-chunks') this.transaction.abort(); return request; };
    f.simulation.state.citizens[0].money += 11; f.simulation.state.player.money += 13; f.simulation.state.treasury += 17;
    let rejected = false; try { await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world); } catch { rejected = true; }
    IDBObjectStore.prototype.put = f.originalPut; Storage.prototype.setItem = originalSetItem;
    return { rejected, unchangedStores: before === JSON.stringify(await f.inspect()), exact: await f.persistence.readSavedGame() === original };
  });
  assert.equal(result.rejected, true); assert.equal(result.unchangedStores, true); assert.equal(result.exact, true);
  evidence.push({ check: 'transaction-abort-and-quota', ...result });
});

test('missing or corrupted current data recovers the complete prior generation and bounds retained records', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; let previous = '';
    for (let generation = 0; generation < 6; generation++) { previous = f.simulation.exportSave(); f.simulation.state.player.money += 1; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world); }
    const stored = await f.inspect(), manifest = stored['save-manifests'][0];
    const retained = new Set([...manifest.parts, ...manifest.previous.parts].map((part: any) => `${part.store}/${part.recordId}`));
    const records = ['save-global', 'save-player', 'save-chunks'].flatMap(store => stored[store].map((record: any) => `${store}/${record.id}`));
    const ref = manifest.parts.find((part: any) => part.id === 'player');
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction(ref.store, 'readwrite'); transaction.objectStore(ref.store).delete(ref.recordId);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    return { allRetained: records.every(record => retained.has(record)), bounded: records.length === retained.size, recovered: await f.persistence.readSavedGame() === previous, status: f.persistence.getSaveStorageStatus() };
  });
  assert.equal(result.allRetained, true); assert.equal(result.bounded, true); assert.equal(result.recovered, true); assert.equal(result.status.recoveredPrevious, true);
  evidence.push({ check: 'complete-prior-generation-and-gc', ...result });
});

test('a checksum-damaged generation is recovered, repaired and retains its valid recovery generation', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, original = f.simulation.exportSave(); await f.persistence.writeSavedGame(original, f.world);
    f.simulation.state.player.money += 41; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world);
    const damagePlayer = async (remove: boolean) => {
      const stored = await f.inspect(), reference = stored['save-manifests'][0].parts.find((part: any) => part.id === 'player');
      const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); });
      const transaction = db.transaction(reference.store, 'readwrite'), store = transaction.objectStore(reference.store);
      if (remove) store.delete(reference.recordId);
      else { const record = stored[reference.store].find((item: any) => item.id === reference.recordId); store.put({ ...record, json: record.json.replace('41', '42') + ' ' }); }
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    };
    await damagePlayer(false); const recovered = await f.persistence.readSavedGame();
    await f.persistence.writeSavedGame(recovered, f.world); const repaired = await f.persistence.readSavedGame();
    await damagePlayer(true); const recoveredAgain = await f.persistence.readSavedGame();
    return { first: recovered === original, repaired: repaired === original, second: recoveredAgain === original, recoveredStatus: f.persistence.getSaveStorageStatus().recoveredPrevious };
  });
  assert.equal(result.first, true); assert.equal(result.repaired, true); assert.equal(result.second, true); assert.equal(result.recoveredStatus, true);
  evidence.push({ check: 'checksum-repair-and-second-recovery', ...result });
});

test('overlapping queued saves stay ordered and the final complete city survives a browser reload', async t => {
  const page = await fixture(t);
  const expected = await page.evaluate(async () => {
    const f = window.saveTest, writes = [];
    for (let generation = 0; generation < 4; generation++) {
      f.simulation.state.player.money += 1; f.simulation.state.citizens[0].money += 2; f.simulation.state.treasury += 3;
      writes.push(f.persistence.writeSavedGame(f.simulation.exportSave(), f.world));
    }
    const expected = f.simulation.exportSave(), readDuringWrites = f.persistence.readSavedGame();
    await Promise.all(writes); if (await readDuringWrites !== expected) throw new Error('Queued read missed the final complete save');
    return expected;
  });
  await page.reload();
  const actual = await page.evaluate(async () => { const path = '/src/persistence.ts'; return (await import(path)).readSavedGame(); });
  assert.equal(actual, expected);
  evidence.push({ check: 'overlapping-write-queue-and-page-reload', exact: true });
});

test('version-one IndexedDB and localStorage saves remain readable through upgrade and new saves', async t => {
  const page = await fixture(t, true);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, json = f.simulation.exportSave();
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city', 1); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('journeys', 'readwrite'); transaction.objectStore('journeys').put({ id: 'autosave', savedAt: 100, json });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    const legacyIDB = await f.persistence.readSavedGame() === json;
    f.simulation.state.player.money += 21; const local = f.simulation.exportSave(); localStorage.setItem('yunshan.save.v1', local); localStorage.setItem('yunshan.save.timestamp.v1', '200');
    const legacyLocal = await f.persistence.readSavedGame() === local;
    f.simulation.state.player.money += 22; const latest = f.simulation.exportSave(); await f.persistence.writeSavedGame(latest, f.world); const stored = await f.inspect();
    return { legacyIDB, legacyLocal, latest: await f.persistence.readSavedGame() === latest, oldIDBIntact: stored.journeys[0].json === json, oldLocalIntact: localStorage.getItem('yunshan.save.v1') === local, stores: Object.keys(stored) };
  });
  assert.equal(result.legacyIDB, true); assert.equal(result.legacyLocal, true); assert.equal(result.latest, true); assert.equal(result.oldIDBIntact, true); assert.equal(result.oldLocalIntact, true); assert(result.stores.includes('save-chunks'));
  evidence.push({ check: 'v1-upgrade-and-compatibility', ...result });
});

test('unavailable IndexedDB uses one atomic fallback envelope and later IDB saves supersede it', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, originalOpen = indexedDB.open.bind(indexedDB), originalSetItem = Storage.prototype.setItem;
    const writtenKeys: string[] = [];
    Storage.prototype.setItem = function (key, value) { writtenKeys.push(key); originalSetItem.call(this, key, value); };
    indexedDB.open = () => { throw new DOMException('Test storage denial', 'SecurityError'); };
    const original = f.simulation.exportSave(); await f.persistence.writeSavedGame(original, f.world);
    const fallback = await f.persistence.readSavedGame() === original;
    indexedDB.open = originalOpen; Storage.prototype.setItem = originalSetItem;
    f.simulation.state.player.money += 29; const latest = f.simulation.exportSave(); await f.persistence.writeSavedGame(latest, f.world);
    return { writtenKeys, fallback, latest: await f.persistence.readSavedGame() === latest, backend: f.persistence.getSaveStorageStatus().backend, envelope: JSON.parse(localStorage.getItem('yunshan.save.fallback.v2')!) };
  });
  assert.deepEqual(result.writtenKeys, ['yunshan.save.fallback.v2']); assert.equal(result.fallback, true); assert.equal(result.latest, true); assert.equal(result.backend, 'indexeddb'); assert.equal(result.envelope.version, 2);
  evidence.push({ check: 'atomic-storage-fallback-and-recovery', ...result, envelope: { version: result.envelope.version, savedAt: result.envelope.savedAt } });
});
