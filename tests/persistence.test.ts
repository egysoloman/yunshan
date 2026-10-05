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
  const paths = ['src/persistence.ts', 'src/persistence/partition.ts', 'src/persistence/session.ts', 'src/simulation.ts', 'src/world.ts', 'src/types.ts', 'src/simulation/clinical.ts', 'src/simulation/culture.ts', 'src/simulation/family.ts', 'src/simulation/trade.ts', 'src/simulation/banking.ts', 'src/simulation/player-labor.ts', 'src/simulation/extensions.ts'];
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
  await writeFile(new URL(process.env.YUNSHAN_PERSISTENCE_EVIDENCE ?? 'persistence-results.json', artifactDir), JSON.stringify({ at: new Date().toISOString(), environment: 'Linux Chromium real IndexedDB, Vite source modules; no WebGL renderer', initialHashes, finalHashes: await sourceHashes(), evidence }, null, 2));
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
    const gets: { store: string; id: string }[] = [];
    const originalPut = IDBObjectStore.prototype.put;
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) { gets.push({ store: this.name, id: String(key) }); return originalGet.call(this, key); };
    IDBObjectStore.prototype.put = function (value, key) { puts.push({ store: this.name, id: value.id }); return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key); };
    const inspect = async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        const names = [...db.objectStoreNames], transaction = db.transaction(names, 'readonly');
        const entries = await Promise.all(names.map(async name => [name, await new Promise<any[]>((resolve, reject) => { const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })]));
        return Object.fromEntries(entries);
      } finally { db.close(); }
    };
    const pointsPath = '/src/architecture-floor-plan.ts', points = await import(pointsPath);
    const fixturePoint = (site: any, purpose: 'work' | 'service' | 'sale', person: any = simulation.state.player) => {
      if (!points.getBuildingBody(site)) return { ...site.door };
      const point = points.getBuildingUsePoints(site, 0).find((point: any) => point.purpose === purpose && simulation.isAtBuildingFunctionPoint(site, point.position, purpose, person));
      if (!point) throw new Error(`A controlled ${purpose} fixture requires a real accessible point in ${site.id}`);
      return { ...point.position };
    };
    window.saveTest = { persistence, world, simulation, Simulation, puts, gets, originalPut, inspect, fixturePoint };
  });
  return page;
}

async function fundedClinicalFixture(t: TestContext): Promise<Page> {
  const page = await fixture(t);
  await page.evaluate(async () => {
    const f = window.saveTest, path = '/src/simulation/clinical.ts', clinical = await import(path), sim = f.simulation;
    const clinics = f.world.buildings.filter((site: any) => site.kind === 'clinic' && sim.state.citizens.some((person: any) => person.workId === site.id && ['医生', 'doctor'].includes(person.role) && sim.state.extension.actorProfiles[person.id].age >= 18 && sim.state.extension.actorProfiles[person.id].alive));
    const first = clinics[0], second = clinics.find((site: any) => Math.floor(site.position.x / 256) !== Math.floor(first.position.x / 256) || Math.floor(site.position.z / 256) !== Math.floor(first.position.z / 256));
    if (!first || !second) throw new Error('Actual world needs two staffed clinic sites in distinct save chunks');
    const patient = sim.state.citizens.find((person: any) => !['医生', 'doctor'].includes(person.role) && sim.state.extension.actorProfiles[person.id].age >= 18 && sim.state.extension.actorProfiles[person.id].alive && person.money >= 30);
    if (!patient) throw new Error('Actual city has no adult self-paying patient fixture');
    // Legal pre-existing injuries and physical onsite positions are fixture
    // conditions. Funding, procurement, cancellation and reuse use live APIs.
    sim.state.extension.actorProfiles.player.health = 70; sim.state.extension.actorProfiles[patient.id].health = 70;
    sim.state.player.needs = { hunger: 95, fatigue: 95, social: 90, fun: 90 }; patient.needs = { hunger: 95, fatigue: 95, social: 90, fun: 90 };
    sim.setFocus(f.fixturePoint(first, 'service'), 'walk'); patient.position = f.fixturePoint(second, 'service', { role: 'traveler', identities: ['traveler'] });
    const playerStart = clinical.beginClinicalTreatment(sim, { patientId: 'player', payerId: 'player', siteId: first.id }); if (!playerStart.ok) throw new Error(playerStart.message);
    const npcStart = clinical.beginClinicalTreatment(sim, { patientId: patient.id, payerId: patient.id, siteId: second.id }); if (!npcStart.ok) throw new Error(npcStart.message);
    f.clinicalOriginal = sim.exportSave(); await f.persistence.writeSavedGame(f.clinicalOriginal, f.world);
    sim.step(.25);
    if (!sim.state.clinical.orders.slice(0, 2).every((order: any) => order.receivedUnits === 1 && order.receipts.length === 1)) throw new Error('Both clinic orders must procure actual producer inventory');
    const firstOrder = sim.state.clinical.orders[0], stopped = clinical.cancelClinicalTreatment(sim, firstOrder.id); if (!stopped.ok) throw new Error(stopped.message);
    const repeated = clinical.beginClinicalTreatment(sim, { patientId: 'player', payerId: 'player', siteId: first.id }); if (!repeated.ok) throw new Error(repeated.message);
    f.clinicalSites = { first: first.id, second: second.id, patient: patient.id }; f.clinicalSaved = sim.exportSave();
    await f.persistence.writeSavedGame(f.clinicalSaved, f.world);
  });
  return page;
}

test('partition reassembly rejects missing entities instead of returning a partial city', () => {
  const json = JSON.stringify({ format: 'yunshan-save', state: { citizens: [{ id: 'a', position: { x: 0, z: 0 } }, { id: 'b', position: { x: 512, z: 0 } }], player: { money: 7 } }, runtime: {} });
  const parts = partitionSave(json);
  assert.equal(assembleSave(parts), json);
  assert.throws(() => assembleSave(parts.filter(part => part.id !== 'chunk:2:0')), /缺失存档实体/);
});

test('family/service/stock books follow their real owners and sites while preserving original array and object order', () => {
  const world = { buildings: [{ id: 'home', position: { x: 512, z: 0 } }, { id: 'site', position: { x: 2048, z: 0 } }], districts: [], nodes: [] } as any;
  const document = { format: 'yunshan-save', state: {
    citizens: [{ id: 'a', position: { x: 768, z: 0 } }, { id: 'b', position: { x: 1024, z: 0 } }, { id: 'child', position: { x: 1536, z: 0 } }],
    player: { position: { x: 2560, z: 0 }, money: 7 }, shops: [{ id: 'shop-site', buildingId: 'site' }],
    family: { version: 2, nextHouseholdId: 3, bonds: [{ actorIds: ['b', 'a'] }], movePlans: [{ actorIds: ['a', 'b'], homeId: 'home' }], households: [{ homeId: 'home', actorIds: ['b', 'a'], balance: 13 }], ceremonies: [{ siteId: 'site', organizerId: 'player' }], careGuardians: { child: ['b', 'a'] }, estates: { a: { businesses: { 'shop-site': 'b' }, bankSettlement: 3 } }, estateSales: [{ deceasedId: 'a', assetId: 'shop-site', proceeds: 7 }] },
    culture: { nextOrderId: 2, orders: [{ siteId: 'site', id: 'order-1' }], petitions: [{ id: 'petition-1', siteId: 'home', executionId: 'order-1' }], transportMaintenance: { site: { orderId: 'order-1' } }, project: { workedMinutes: 12 }, playerServiceId: 'order-1' },
    trade: { stats: { supplierGross: 3 }, lots: { 'shop-site': [{ supplierId: 'source', unitPrice: 6.17 }] }, activity: { 'shop-site': [{ sold: 3 }] }, ownedLots: { 'shop-site': [{ quantity: 2, unitPrice: 6.17 }] } },
  }, runtime: {} };
  const json = JSON.stringify(document), parts = partitionSave(json, world), byId = new Map(parts.map(part => [part.id, JSON.parse(part.json)]));
  assert.equal(assembleSave(parts), json);
  assert.deepEqual(byId.get('chunk:4:0').arrays['state.family.bonds'][0].value.actorIds, ['b', 'a']);
  assert.equal(byId.get('chunk:2:0').arrays['state.family.households'][0].value.balance, 13);
  assert(byId.get('chunk:2:0').arrays['state.family.movePlans']); assert(byId.get('chunk:2:0').arrays['state.culture.petitions']);
  assert(byId.get('chunk:3:0').arrays['state.family.estateSales']); assert(byId.get('chunk:3:0').maps['state.family.estates'].a);
  assert.deepEqual(byId.get('chunk:6:0').maps['state.family.careGuardians'].child, ['b', 'a']);
  for (const path of ['state.culture.orders', 'state.family.ceremonies']) assert(byId.get('chunk:8:0').arrays[path]);
  for (const path of ['state.culture.transportMaintenance', 'state.trade.lots', 'state.trade.ownedLots', 'state.trade.activity']) assert(byId.get('chunk:8:0').maps[path]);
  assert.equal(byId.get('global').document.state.trade.stats.supplierGross, 3); assert.equal(byId.get('global').document.state.family.nextHouseholdId, 3);
  assert.equal(byId.get('player').values['state.culture.project'].workedMinutes, 12); assert.equal(byId.get('player').values['state.culture.playerServiceId'], 'order-1');
});

test('the complete funded player work contract belongs to the mandatory independent player record', () => {
  const document = { format: 'yunshan-save', state: { player: { money: 7 }, playerLabor: { version: 1, job: { siteId: 'market', escrow: 35, workedMinutes: 0 }, history: [], stats: { reservedGross: 35 } } }, runtime: {} };
  const json = JSON.stringify(document), parts = partitionSave(json), player = parts.find(part => part.id === 'player')!, global = parts.find(part => part.id === 'global')!;
  assert.equal(JSON.parse(global.json).document.state.playerLabor, undefined);
  assert.deepEqual(JSON.parse(player.json).values['state.playerLabor'], document.state.playerLabor); assert.equal(assembleSave(parts), json);
  assert.throws(() => assembleSave(parts.filter(part => part.id !== 'player')), /分区不完整/);
  const damaged = JSON.parse(player.json); delete damaged.values['state.playerLabor'];
  assert.throws(() => assembleSave(parts.map(part => part.id === 'player' ? { ...part, json: JSON.stringify(damaged) } : part)), /玩家存档字段/);
  const oldLayout = JSON.parse(global.json); delete oldLayout.layout.playerValues;
  assert.equal(assembleSave(parts.map(part => part.id === 'global' ? { ...part, json: JSON.stringify(oldLayout) } : part)), json);
});

test('clinical payer custody stays mandatory in the player record while sites and patients keep their own chunks', () => {
  const world: any = { buildings: [{ id: 'clinic-a', position: { x: 1024, z: 0 } }, { id: 'clinic-b', position: { x: 2048, z: 0 } }], districts: [], nodes: [] };
  const clinical = { version: 1, nextOrderId: 4, orders: [
    { id: 'clinical-1', payerId: 'npc-a', patientId: 'npc-a', siteId: 'clinic-b', escrow: 26, state: 'awaitingDoctor' },
    { id: 'clinical-2', payerId: 'player', patientId: 'player', siteId: 'clinic-a', escrow: 26, state: 'awaitingDoctor', receipts: [{ paid: 4 }] },
    { id: 'clinical-3', payerId: 'player', patientId: 'npc-b', siteId: 'clinic-b', escrow: 30, state: 'refundPending', refunded: 0 },
  ], stock: { 'clinic-a': { receivedUnits: 1, consumedUnits: 0, availableUnits: 0 }, 'clinic-b': { receivedUnits: 2, consumedUnits: 0, availableUnits: 1 } }, nextVisitAt: { player: 540, 'npc-a': 525 }, stats: { funded: 90 }, archived: { count: 0 } };
  const document = { format: 'yunshan-save', state: { player: { money: 7 }, citizens: [{ id: 'npc-a', position: { x: 768, z: 0 } }, { id: 'npc-b', position: { x: 512, z: 0 } }], clinical }, runtime: {} }, json = JSON.stringify(document), parts = partitionSave(json, world), byId = new Map(parts.map(part => [part.id, JSON.parse(part.json)]));
  assert.equal(assembleSave(parts), json);
  const player = byId.get('player'), global = byId.get('global');
  assert.deepEqual(player.arrays['state.clinical.orders'].map((entry: any) => entry.index), [1, 2]); assert.equal(player.arrays['state.clinical.orders'][1].value.escrow, 30);
  assert.equal(player.maps['state.clinical.nextVisitAt'].player, 540); assert.equal(byId.get('chunk:3:0').maps['state.clinical.nextVisitAt']['npc-a'], 525);
  assert.equal(byId.get('chunk:8:0').arrays['state.clinical.orders'][0].index, 0); assert(byId.get('chunk:4:0').maps['state.clinical.stock']); assert(byId.get('chunk:8:0').maps['state.clinical.stock']);
  assert.equal(global.document.state.clinical.orders, undefined); assert.equal(global.document.state.clinical.stock, undefined); assert.equal(global.document.state.clinical.stats.funded, 90); assert.equal(global.document.state.clinical.archived.count, 0);
  for (const mutate of [(record: any) => { delete record.arrays; }, (record: any) => { delete record.arrays['state.clinical.orders']; }, (record: any) => { record.arrays['state.clinical.orders'] = []; }, (record: any) => { record.arrays['state.clinical.orders'][1].index = 1; }]) {
    const damaged = JSON.parse(JSON.stringify(player)); mutate(damaged);
    assert.throws(() => assembleSave(parts.map(part => part.id === 'player' ? { ...part, json: JSON.stringify(damaged) } : part)), /玩家托管/);
  }
  assert.throws(() => assembleSave(parts.filter(part => part.id !== 'chunk:4:0')), /缺失存档映射/);
  const legacyDocument = { format: 'yunshan-save', state: { player: { money: 7 } }, runtime: {} }, legacyJSON = JSON.stringify(legacyDocument), legacyParts = partitionSave(legacyJSON);
  const preArrays = legacyParts.map(part => { const parsed = JSON.parse(part.json); if (part.id === 'global') delete parsed.layout.playerArrays; if (part.id === 'player') delete parsed.arrays; return { ...part, json: JSON.stringify(parsed) }; });
  assert.equal(assembleSave(preArrays), legacyJSON);
});

test('a missing map-only geographic chunk rejects a partial custody or service book', () => {
  const document = { format: 'yunshan-save', state: { citizens: [], player: { money: 3 }, culture: { transportMaintenance: { station: { units: 4 } } } }, runtime: {} };
  const parts = partitionSave(JSON.stringify(document), { buildings: [{ id: 'station', position: { x: 512, z: 0 } }], districts: [], nodes: [] } as any);
  assert.throws(() => assembleSave(parts.filter(part => part.id !== 'chunk:2:0')), /缺失存档映射/);
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

test('a real onsite work escrow roundtrips and player damage recovers one complete funded generation', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, sim = f.simulation, shop = sim.state.shops.find((shop: any) => f.world.buildings.find((site: any) => site.id === shop.buildingId)?.kind === 'market');
    const investor = sim.state.citizens.find((actor: any) => actor.money >= 200); investor.money -= 200; sim.transferShopFunds(shop, 200);
    sim.state.player.needs = { hunger: 95, fatigue: 95, social: 90, fun: 90 };
    sim.setFocus(f.fixturePoint(f.world.buildings.find((site: any) => site.id === shop.buildingId), 'work'), 'walk');
    const started = sim.command({ type: 'work', targetId: shop.buildingId }); if (!started.ok) throw new Error(started.message);
    const original = sim.exportSave(); await f.persistence.writeSavedGame(original, f.world);
    for (let tick = 0; tick < 40; tick++) sim.step(.25);
    const later = sim.exportSave(); await f.persistence.writeSavedGame(later, f.world);
    const stored = await f.inspect(), manifest = stored['save-manifests'].find((row: any) => row.id === 'autosave'), ref = manifest.parts.find((part: any) => part.id === 'player'), record = stored[ref.store].find((record: any) => record.id === ref.recordId);
    const part = JSON.parse(record.json), globalRef = manifest.parts.find((part: any) => part.id === 'global'), global = JSON.parse(stored[globalRef.store].find((record: any) => record.id === globalRef.recordId).json);
    const exactBefore = await f.persistence.readSavedGame() === later;
    const progressed = part.values['state.playerLabor'].job;
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction(ref.store, 'readwrite'); delete part.values['state.playerLabor']; transaction.objectStore(ref.store).put({ ...record, json: JSON.stringify(part) });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    const recovered = await f.persistence.readSavedGame(), restored = new f.Simulation(f.world), imported = restored.importSave(recovered);
    return { exactBefore, playerOnly: global.document.state.playerLabor === undefined, progressedMinutes: progressed.workedMinutes, progressedEscrow: progressed.escrow, recoveredExact: recovered === original, imported: imported.ok, restoredEscrow: restored.state.playerLabor.job.escrow, restoredWallet: restored.state.player.money, originalWallet: JSON.parse(original).state.player.money, recoveredPrevious: f.persistence.getSaveStorageStatus().recoveredPrevious };
  });
  assert.equal(result.exactBefore, true); assert.equal(result.playerOnly, true); assert.equal(result.progressedMinutes, 10);
  assert(Math.abs(result.progressedEscrow - 35 * 5 / 6) < 1e-8); assert.equal(result.recoveredExact, true); assert.equal(result.imported, true);
  assert.equal(result.restoredEscrow, 35); assert.equal(result.restoredWallet, result.originalWallet); assert.equal(result.recoveredPrevious, true);
  evidence.push({ check: 'actual-player-work-escrow-and-whole-generation-recovery', ...result });
});

test('real clinical procurement, payer custody and reused medicine roundtrip through on-demand storage with identical continuation', async t => {
  const page = await fundedClinicalFixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; f.gets.length = 0;
    const session = await f.persistence.openSavedGameSession({ maxCachedChunks: 1 }), openedGets = [...f.gets], player = JSON.parse(session.player.json), global = JSON.parse(session.global.json), materialized = await session.materialize();
    const restored = new f.Simulation(f.world), imported = restored.importSave(materialized), exact = imported.ok && restored.exportSave() === f.clinicalSaved;
    const orders = restored.state.clinical.orders.map((order: any) => ({ id: order.id, payerId: order.payerId, escrow: order.escrow, purchasePaid: order.purchasePaid, refunded: order.refunded, reusedUnits: order.reusedUnits, receivedUnits: order.receivedUnits, state: order.state }));
    const books = restored.state.clinical.stock, requiredIndices = JSON.parse(session.global.json).layout.playerArrays['state.clinical.orders'];
    for (let tick = 0; tick < 24; tick++) { f.simulation.step(.25); restored.step(.25); }
    const continuation = f.simulation.exportSave() === restored.exportSave(), sessionStats = session.getStats(); await session.close();
    return { exact, imported: imported.ok, continuation, playerIndices: player.arrays['state.clinical.orders'].map((entry: any) => entry.index), requiredIndices, playerEscrow: player.arrays['state.clinical.orders'].reduce((sum: number, entry: any) => sum + entry.value.escrow, 0), globalHasOrders: Object.hasOwn(global.document.state.clinical, 'orders'), globalHasStock: Object.hasOwn(global.document.state.clinical, 'stock'), globalFunded: global.document.state.clinical.stats.funded, orders, received: Object.values(books).reduce((sum: number, book: any) => sum + book.receivedUnits, 0), consumed: Object.values(books).reduce((sum: number, book: any) => sum + book.consumedUnits, 0), initialChunkGets: openedGets.filter((get: any) => get.store === 'save-chunks').length, initialPlayerGets: openedGets.filter((get: any) => get.store === 'save-player').length, cache: sessionStats.cachedChunks };
  });
  assert.equal(result.exact, true); assert.equal(result.imported, true); assert.equal(result.continuation, true);
  assert.deepEqual(result.playerIndices, [0, 2]); assert.deepEqual(result.requiredIndices, [0, 2]); assert.equal(result.playerEscrow, 30);
  assert.equal(result.globalHasOrders, false); assert.equal(result.globalHasStock, false); assert.equal(result.globalFunded, 90);
  assert.equal(result.orders[0].state, 'cancelled'); assert.equal(result.orders[0].refunded, 26); assert.equal(result.orders[2].reusedUnits, 1); assert.equal(result.orders[2].receivedUnits, 0);
  assert.equal(result.received, 2); assert.equal(result.consumed, 0); assert.equal(result.initialChunkGets, 0); assert.equal(result.initialPlayerGets, 1); assert(result.cache <= 1);
  evidence.push({ check: 'actual-clinical-procurement-reuse-on-demand-continuation', ...result });
});

test('a damaged clinical player custody body recovers the complete prior generation with all original cash and stock', async t => {
  const page = await fundedClinicalFixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, stored = await f.inspect(), manifest = stored['save-manifests'].find((row: any) => row.id === 'autosave'), ref = manifest.parts.find((part: any) => part.id === 'player'), record = stored[ref.store].find((record: any) => record.id === ref.recordId), player = JSON.parse(record.json);
    delete player.arrays['state.clinical.orders'];
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction(ref.store, 'readwrite'); transaction.objectStore(ref.store).put({ ...record, json: JSON.stringify(player) });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    f.gets.length = 0; const session = await f.persistence.openSavedGameSession(), initialChunkGets = f.gets.filter((get: any) => get.store === 'save-chunks').length, recovered = await session.materialize(), restored = new f.Simulation(f.world), imported = restored.importSave(recovered), recoveredPrevious = session.header.recoveredPrevious; await session.close();
    const original = JSON.parse(f.clinicalOriginal);
    return { recoveredPrevious, initialChunkGets, exact: recovered === f.clinicalOriginal, imported: imported.ok, exactRestore: restored.exportSave() === f.clinicalOriginal, orderCount: restored.state.clinical.orders.length, escrow: restored.state.clinical.orders.reduce((sum: number, order: any) => sum + order.escrow, 0), purchasePaid: restored.state.clinical.stats.purchasePaid, stockReceived: Object.values(restored.state.clinical.stock).reduce((sum: number, book: any) => sum + book.receivedUnits, 0), originalWallet: original.state.player.money, restoredWallet: restored.state.player.money, completeShops: JSON.stringify(restored.state.shops) === JSON.stringify(original.state.shops) };
  });
  assert.equal(result.recoveredPrevious, true); assert.equal(result.initialChunkGets, 0); assert.equal(result.exact, true); assert.equal(result.imported, true); assert.equal(result.exactRestore, true);
  assert.equal(result.orderCount, 2); assert.equal(result.escrow, 60); assert.equal(result.purchasePaid, 0); assert.equal(result.stockReceived, 0); assert.equal(result.restoredWallet, result.originalWallet); assert.equal(result.completeShops, true);
  evidence.push({ check: 'clinical-player-custody-whole-generation-recovery', ...result });
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

test('a modern session opens only global/player and reads requested chunks through a bounded LRU', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world); f.gets.length = 0;
    const session = await f.persistence.openSavedGameSession({ maxCachedChunks: 2, maxCachedBytes: 4 * 1024 * 1024 });
    const opened = [...f.gets], [a, b, c] = session.header.chunkIds;
    const unknown = await session.readChunk('chunk:absent');
    const concurrent = await Promise.all([session.readChunk(a), session.readChunk(a)]);
    await session.readChunk(a); await session.readChunk(b); await session.readChunk(c);
    const fullCache = session.getStats(); await session.readChunk(a);
    const reads = f.gets.filter((get: any) => get.store === 'save-chunks').length;
    const noCache = await f.persistence.openSavedGameSession({ maxCachedChunks: 2, maxCachedBytes: 1 });
    await noCache.readChunk(a); await noCache.readChunk(a); const tiny = noCache.getStats();
    await noCache.close(); await session.close();
    let closedRejected = false; try { await session.readChunk(a); } catch { closedRejected = true; }
    return { opened, unknown, concurrentEqual: concurrent[0] === concurrent[1], reads, fullCache, tiny, closedRejected, closed: session.getStats(), readers: (await f.inspect())['save-manifests'].filter((row: any) => row.id.startsWith('reader:')).length };
  });
  assert.equal(result.opened.filter(get => get.store === 'save-chunks').length, 0);
  assert.equal(result.opened.filter(get => get.store === 'save-global').length, 1);
  assert.equal(result.opened.filter(get => get.store === 'save-player').length, 1);
  assert.equal(result.unknown, null); assert.equal(result.concurrentEqual, true); assert.equal(result.reads, 4);
  assert.equal(result.fullCache.cachedChunks, 2); assert.equal(result.fullCache.chunkReads, 3); assert.equal(result.fullCache.cacheHits, 1);
  assert.equal(result.tiny.cachedChunks, 0); assert.equal(result.tiny.cachedBytes, 0); assert.equal(result.tiny.chunkReads, 2);
  assert.equal(result.closedRejected, true); assert.equal(result.closed.closed, true); assert.equal(result.readers, 0);
  evidence.push({ check: 'on-demand-physical-get-and-lru', ...result });
});

test('a pinned session survives four later saves from another page and releases its archived records', async t => {
  const page = await fixture(t);
  const original = await page.evaluate(async () => {
    const f = window.saveTest, json = f.simulation.exportSave(); await f.persistence.writeSavedGame(json, f.world);
    f.session = await f.persistence.openSavedGameSession({ maxCachedChunks: 2 }); return json;
  });
  const writer = await page.context().newPage(); await writer.addInitScript('globalThis.__name = (value) => value'); await writer.goto(`${baseURL}/save-test.html`);
  await writer.evaluate(async (json: string) => {
    const persistencePath = '/src/persistence.ts', worldPath = '/src/world.ts';
    const [persistence, { createWorld }] = await Promise.all([import(persistencePath), import(worldPath)]), data = JSON.parse(json), world = createWorld();
    for (let i = 0; i < 4; i++) { data.state.player.money += 1; data.state.citizens[0].money += 2; data.state.treasury += 3; await persistence.writeSavedGame(JSON.stringify(data), world); }
  }, original);
  const result = await page.evaluate(async (original: string) => {
    const f = window.saveTest, before = await f.inspect(), pinned = await f.session.materialize();
    await f.session.close(); const after = await f.inspect(), manifest = after['save-manifests'].find((row: any) => row.id === 'autosave');
    const retained = new Set([...manifest.parts, ...manifest.previous.parts].map((part: any) => `${part.store}/${part.recordId}`));
    const count = (stored: any) => ['save-global', 'save-player', 'save-chunks'].reduce((sum, store) => sum + stored[store].length, 0);
    return { exact: pinned === original, pinnedGeneration: f.session.header.generation, latestGeneration: manifest.generation, before: count(before), after: count(after), retained: retained.size, readerRemoved: after['save-manifests'].length === 1, newestDiffers: await f.persistence.readSavedGame() !== original };
  }, original);
  assert.equal(result.exact, true); assert.equal(result.pinnedGeneration, 1); assert.equal(result.latestGeneration, 5);
  assert(result.before > result.after); assert.equal(result.after, result.retained); assert.equal(result.readerRemoved, true); assert.equal(result.newestDiffers, true);
  evidence.push({ check: 'cross-page-pinned-generation-and-release-gc', ...result });
});

test('late chunk damage invalidates the whole reader and recovery creates a distinct prior-generation reader', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, old = f.simulation.exportSave(); await f.persistence.writeSavedGame(old, f.world);
    f.simulation.state.player.money += 17; f.simulation.state.treasury += 19; f.simulation.state.citizens[0].money += 23;
    await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world);
    const session = await f.persistence.openSavedGameSession(), stored = await f.inspect(), manifest = stored['save-manifests'].find((row: any) => row.id === 'autosave');
    const bad = manifest.parts.find((part: any) => part.store === 'save-chunks' && part.recordId.startsWith('2:'));
    const good = session.header.chunkIds.find((id: string) => id !== bad.id); await session.readChunk(good);
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('save-chunks', 'readwrite'), record = stored['save-chunks'].find((row: any) => row.id === bad.recordId);
    transaction.objectStore('save-chunks').put({ ...record, json: record.json + ' ' });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    let damageRejected = false, cachedRejected = false; try { await session.readChunk(bad.id); } catch { damageRejected = true; }
    try { await session.readChunk(good); } catch { cachedRejected = true; }
    // The pinned fallback stays available even after newer generations replace
    // the autosave manifest. No chunk-by-chunk downgrade is permitted.
    for (let i = 0; i < 3; i++) { f.simulation.state.player.money++; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world); }
    const recovered = await session.recover(), json = await recovered.materialize();
    const result = { damageRejected, cachedRejected, invalidated: session.getStats().invalidated, distinct: recovered !== session, generation: recovered.header.generation, recoveredPrevious: recovered.header.recoveredPrevious, exact: json === old, playerDifferent: session.player.json !== recovered.player.json, globalDifferent: session.global.json !== recovered.global.json };
    await recovered.close(); await session.close(); return result;
  });
  assert.equal(result.damageRejected, true); assert.equal(result.cachedRejected, true); assert.equal(result.invalidated, true); assert.equal(result.distinct, true);
  assert.equal(result.generation, 1); assert.equal(result.recoveredPrevious, true); assert.equal(result.exact, true); assert.equal(result.playerDifferent, true); assert.equal(result.globalDifferent, true);
  evidence.push({ check: 'late-corruption-whole-generation-restart', ...result });
});

test('explicit materialization preserves the full import contract and identical continuation', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; f.simulation.command({ type: 'speed', value: 8 }); for (let i = 0; i < 24; i++) f.simulation.step(.25);
    const original = f.simulation.exportSave(); await f.persistence.writeSavedGame(original, f.world);
    const session = await f.persistence.openSavedGameSession({ maxCachedChunks: 1 }), json = await session.materialize(), restored = new f.Simulation(f.world);
    const imported = restored.importSave(json).ok, exact = restored.exportSave() === original;
    for (let i = 0; i < 24; i++) { f.simulation.step(.25); restored.step(.25); }
    const result = { exactJSON: json === original, imported, exact, continuation: restored.exportSave() === f.simulation.exportSave(), reads: session.getStats().chunkReads, chunks: session.header.chunkIds.length, cached: session.getStats().cachedChunks };
    await session.close(); return result;
  });
  assert.equal(result.exactJSON, true); assert.equal(result.imported, true); assert.equal(result.exact, true); assert.equal(result.continuation, true);
  assert.equal(result.reads, result.chunks); assert.equal(result.cached, 1);
  evidence.push({ check: 'explicit-full-materialization-and-24-tick-continuation', ...result });
});

test('expired readers cannot silently re-pin and a new save collects their archived records', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world);
    const session = await f.persistence.openSavedGameSession(); await session.readChunk(session.header.chunkIds[0]);
    for (let i = 0; i < 3; i++) { f.simulation.state.player.money++; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world); }
    const originalNow = Date.now, advanced = originalNow() + 6 * 60_000; Date.now = () => advanced;
    let expired = false; try { await session.readChunk(session.header.chunkIds[0]); } catch { expired = true; }
    await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world); Date.now = originalNow;
    const stored = await f.inspect(), manifest = stored['save-manifests'].find((row: any) => row.id === 'autosave');
    const retained = new Set([...manifest.parts, ...manifest.previous.parts].map((part: any) => `${part.store}/${part.recordId}`));
    const records = ['save-global', 'save-player', 'save-chunks'].flatMap(store => stored[store].map((row: any) => `${store}/${row.id}`));
    await session.close(); return { expired, invalidated: session.getStats().invalidated, noLeases: stored['save-manifests'].length === 1, exactlyRetained: records.length === retained.size && records.every(record => retained.has(record)) };
  });
  assert.equal(result.expired, true); assert.equal(result.invalidated, true); assert.equal(result.noLeases, true); assert.equal(result.exactlyRetained, true);
  evidence.push({ check: 'expired-lease-refusal-and-gc', ...result });
});

test('damaged global/player headers select the complete previous generation without reading city chunks', async t => {
  const page = await fixture(t);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, old = f.simulation.exportSave(); await f.persistence.writeSavedGame(old, f.world);
    f.simulation.state.player.money += 9; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world);
    const stored = await f.inspect(), reference = stored['save-manifests'].find((row: any) => row.id === 'autosave').parts.find((part: any) => part.id === 'player');
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction(reference.store, 'readwrite'); transaction.objectStore(reference.store).delete(reference.recordId);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close(); f.gets.length = 0;
    const session = await f.persistence.openSavedGameSession(), chunksAtOpen = f.gets.filter((get: any) => get.store === 'save-chunks').length;
    const result = { generation: session.header.generation, recovered: session.header.recoveredPrevious, chunksAtOpen, exact: await session.materialize() === old };
    await session.close(); return result;
  });
  assert.equal(result.generation, 1); assert.equal(result.recovered, true); assert.equal(result.chunksAtOpen, 0); assert.equal(result.exact, true);
  evidence.push({ check: 'header-damage-whole-prior-generation-without-prefetch', ...result });
});

test('on-demand readers retain the explicit whole-blob compatibility path for version-one and local saves', async t => {
  const page = await fixture(t, true);
  const result = await page.evaluate(async () => {
    const f = window.saveTest, json = f.simulation.exportSave();
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city', 1); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('journeys', 'readwrite'); transaction.objectStore('journeys').put({ id: 'autosave', savedAt: 100, json });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
    const old = await f.persistence.openSavedGameSession({ world: f.world }), legacyExact = await old.materialize() === json; await old.close();
    await f.persistence.writeSavedGame(json, f.world); f.simulation.state.player.money += 10; const local = f.simulation.exportSave();
    localStorage.setItem('yunshan.save.fallback.v2', JSON.stringify({ version: 2, savedAt: Date.now() + 1000, json: local })); f.gets.length = 0;
    const fallback = await f.persistence.openSavedGameSession({ world: f.world }), localExact = await fallback.materialize() === local;
    const result = { legacyExact, legacyGeneration: old.header.generation, localExact, localBackend: fallback.header.backend, localGeneration: fallback.header.generation, geographicGets: f.gets.filter((get: any) => get.store === 'save-chunks').length };
    await fallback.close(); return result;
  });
  assert.equal(result.legacyExact, true); assert.equal(result.legacyGeneration, 0); assert.equal(result.localExact, true);
  assert.equal(result.localBackend, 'localStorage'); assert.equal(result.localGeneration, 0); assert.equal(result.geographicGets, 0);
  evidence.push({ check: 'session-legacy-and-atomic-fallback-compatibility', ...result });
});

test('reader heartbeats renew their durable lease and a rejected renewal invalidates cached parts', async t => {
  const page = await fixture(t); await page.clock.install();
  const initial = await page.evaluate(async () => {
    const f = window.saveTest; await f.persistence.writeSavedGame(f.simulation.exportSave(), f.world);
    f.session = await f.persistence.openSavedGameSession(); await f.session.readChunk(f.session.header.chunkIds[0]);
    return (await f.inspect())['save-manifests'].find((row: any) => row.id.startsWith('reader:'));
  });
  await page.clock.fastForward(61_000);
  const renewed = await page.evaluate(async () => (await window.saveTest.inspect())['save-manifests'].find((row: any) => row.id.startsWith('reader:')));
  assert.equal(renewed.id, initial.id); assert(renewed.expiresAt > initial.expiresAt);
  await page.evaluate(async (id: string) => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('yunshan-city'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('save-manifests', 'readwrite'); transaction.objectStore('save-manifests').delete(id);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); }); db.close();
  }, initial.id);
  await page.clock.fastForward(61_000);
  const result = await page.evaluate(async () => {
    const f = window.saveTest; await f.inspect(); let rejected = false;
    try { await f.session.readChunk(f.session.header.chunkIds[0]); } catch { rejected = true; }
    const stats = f.session.getStats(); await f.session.close(); return { rejected, invalidated: stats.invalidated, cached: stats.cachedChunks };
  });
  assert.equal(result.rejected, true); assert.equal(result.invalidated, true); assert.equal(result.cached, 0);
  evidence.push({ check: 'actual-heartbeat-renewal-and-missing-lease-invalidation', initialExpiry: initial.expiresAt, renewedExpiry: renewed.expiresAt, ...result });
});
