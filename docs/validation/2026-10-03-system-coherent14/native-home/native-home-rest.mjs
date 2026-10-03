import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import assert from 'node:assert/strict';

// This opt-in is an execution scheduling guard, not an in-game permission.
// Root must grant a new source binding and the exclusive GPU slot before this template can run.
assert.equal(process.env.YUNSHAN_COMPILED_VALIDATION_APPROVED, '1', 'NOT_RUN: explicit root source-binding and exclusive GPU approval is required');
const binding = JSON.parse(await readFile(new URL('./pending-source-contract.json', import.meta.url), 'utf8'));
assert.equal(binding.state, 'BOUND_AFTER_ROOT_FREEZE', 'NOT_RUN: new freeze14 actual manifest/count/entry/maps are UNBOUND; root must bind and separately approve GPU');
assert.equal(process.env.YUNSHAN_HOME_NATIVE_APPROVED, '1', 'NOT_RUN: explicit root GPU-slot approval is required');
const sourceRoot = resolve(binding.sourceRoot);
const evidenceRoot = resolve(process.env.YUNSHAN_HOME_EVIDENCE ?? binding.nativeEvidenceRoot);
const port = Number(process.env.YUNSHAN_HOME_NATIVE_PORT ?? 4189);
const sharedRoot = '/workspace/yunshan';
const nonExecutable = new Set(['.gitattributes', '.gitignore', 'AGENTS.md', '开发备忘录.md', '提示词.md']);
const buildingId = process.env.YUNSHAN_HOME_ID ?? 'market-b24';
assert.equal(binding.inputCount, 108, 'Actual root-approved coherent14 frozen count');
assert.equal(binding.sharedExecutableInputCount, 103, 'Actual root-approved coherent14 shared executable count');
const expectedEntry = binding.distEntry;
const expectedEntrySHA = binding.distEntrySHA256;
const expectedSourceManifestSHA = binding.snapshotManifestSHA256;
const here = dirname(new URL(import.meta.url).pathname), plannerPath = join(here, 'home-plan-readonly.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const results = [], errors = [], inputs = [], movement = [], captures = [], httpEntryResponses = [];
let sourceMapsStart, sourceMapsEnd, immutableWorld, immutableWorldSHA256;
const supportQueries = [];
let page, browser, server, stage = 'preflight', setupCount = 0, sourceStart, sharedExecutableStart, externalStart, manifest, buildEntry, serverOutput = '', plan;
await mkdir(evidenceRoot, { recursive: true });
for (const name of ['run-start.json', 'native-home-results.json']) {
  try { await stat(join(evidenceRoot, name)); throw Error('Refuse to overwrite an earlier actual run: choose a fresh evidence directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const jsonFile = (name, value) => writeFile(join(evidenceRoot, name), JSON.stringify(value, null, 2) + '\n');
const record = (name, detail) => { results.push({ name, pass: true, detail }); console.log('PASS', name, JSON.stringify(detail)); };
const sharedExecutableHashes = async () => Object.fromEntries(await Promise.all(Object.keys(manifest.copiedHashes).filter(name => !nonExecutable.has(name)).map(async name => [name, hash(await readFile(join(sharedRoot, name)))])));
const sourceHashes = async () => Object.fromEntries(await Promise.all(Object.keys(manifest.copiedHashes).map(async name => [name, hash(await readFile(join(sourceRoot, name)))])));
function readonlyPlan(operation, data) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', plannerPath], {
    cwd: sourceRoot, input: JSON.stringify({ operation, sourceRoot, ...data }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `Read-only provider failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
async function body() {
  return page.evaluate(() => {
    const d = window.__YUNSHAN__, s = d.simulation.state;
    return { tick: s.tick, at: s.extension.lastUpdate, day: s.day, hour: s.hour, paused: s.paused, speed: s.speed,
      body: d.controller.position, player: structuredClone(s.player), eye: { x: d.city.camera.position.x, y: d.city.camera.position.y, z: d.city.camera.position.z },
      mode: d.controller.mode, insideId: d.controller.inside?.id ?? null, floor: d.controller.floor,
      supportingSiteId: d.controller.supportingSite?.id ?? null, voxels: structuredClone(s.voxels),
      session: structuredClone(s.homeRest?.session ?? null), history: structuredClone(s.homeRest?.history ?? []),
      npcCount: s.citizens.length, aliveCount: s.citizens.filter(c => s.extension.actorProfiles[c.id]?.alive !== false).length,
      nearbyBuildingId: d.getView().nearbyBuilding?.id ?? null, notice: d.getView().notice,
      quality: d.getView().quality, renderDistance: d.getView().renderDistance, fps: d.getView().fps,
      activeAircraftId: s.aviation?.activeAircraftId ?? null,
      commands: structuredClone(window.__HOME_NATIVE_OBSERVER__?.commands ?? []),
    };
  });
}
async function screenshot(name) {
  const before = await body();
  await page.screenshot({ path: join(evidenceRoot, name), timeout: 120_000 });
  captures.push({ name, before, after: await body(), originalBytes: true, visualAcceptance: 'NOT_ASSESSED' });
  await jsonFile('screenshots.json', captures);
}
async function click(selector) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 120_000 });
  assert.equal(await locator.isEnabled(), true, `Native button unavailable: ${selector}; ${(await body()).notice}`);
  inputs.push({ kind: 'native pointer click', selector, atUTC: new Date().toISOString() });
  await locator.click({ timeout: 120_000 });
}
async function focusCanvas() { await page.locator('canvas').first().click({ position: { x: 700, y: 330 } }); }
async function paused(value) {
  if ((await body()).paused !== value) {
    await click('[data-testid="pause-toggle"]');
    await page.waitForFunction(value => window.__YUNSHAN__.simulation.state.paused === value, value, { timeout: 30_000 });
  }
}
async function buildingContext() {
  await page.waitForFunction(id => window.__YUNSHAN__.getView().nearbyBuilding?.id === id, buildingId, { timeout: 30_000 });
  const tab = page.locator('[data-context="building"]');
  if (await tab.getAttribute('aria-pressed') !== 'true') await click('[data-context="building"]');
}
const commandSelector = type => `[data-ref="context-body"] [data-command="${type}"]${type === 'cancelRest' ? '' : `[data-target="${buildingId}"]`}`;
async function command(type) {
  await buildingContext(); const prior = (await body()).commands.length;
  await click(commandSelector(type));
  await page.waitForFunction(n => window.__HOME_NATIVE_OBSERVER__.commands.length > n, prior, { timeout: 30_000 });
  const after = await body(), observed = after.commands.slice(prior).find(row => row.command.type === type);
  assert(observed, `Missing observed native ${type} result`); assert.equal(observed.result.ok, true, JSON.stringify(observed));
  return observed;
}
async function keyboard(code) {
  await focusCanvas(); inputs.push({ kind: 'native keypress', code, atUTC: new Date().toISOString() });
  await page.keyboard.press(code);
}
async function orient(target) {
  const before = await body(), dx = target.x - before.body.x, dz = target.z - before.body.z;
  // Explicit view-only control: no camera/body position, clock or Simulation state is assigned.
  await page.evaluate(yaw => { const c = window.__YUNSHAN__.controller; c.yaw = yaw; c.resetView(); }, Math.atan2(-dx, -dz));
  inputs.push({ kind: 'declared view-only yaw/resetView', target, atUTC: new Date().toISOString() });
}
async function supportActual(snapshot, label, target) {
  assert(immutableWorld && hash(JSON.stringify(immutableWorld)) === immutableWorldSHA256, 'Original actual world bytes changed in the observer');
  const query = readonlyPlan('supportActual', { world: immutableWorld, building: plan.building,
    actualBody: snapshot.body, insideId: snapshot.insideId, floor: snapshot.floor, expectedFloor: plan.floor, supportingSiteId: snapshot.supportingSiteId,
    player: snapshot.player, voxels: snapshot.voxels, bodyRadius: .35, eyeHeight: 1.72 });
  supportQueries.push({ label, target, observedTick: snapshot.tick, actualFeet: snapshot.body, actualEye: snapshot.eye,
    worldSHA256: immutableWorldSHA256, query, noPositionWrite: true });
  await jsonFile('actual-support-queries.json', supportQueries);
  assert(Math.abs(snapshot.body.y - query.y) <= 1e-7,
    `Feet do not match actual-coordinate support: ${JSON.stringify({ target, actual: snapshot.body, query })}`);
  assert(Math.abs(snapshot.eye.y - snapshot.body.y - 1.72) < 1e-6, 'Actual first-person eye height remains1.72m');
  return query;
}
async function nativeWPulse(durationMs, label) {
  const firstKeyboardRecord = await page.evaluate(() => window.__NATIVE_HOME_INPUT_TIMING__.keyboard.length);
  // Send both real Playwright keyboard requests on the same page/connection.
  // Sending keyup no longer waits for the keydown response from a busy page.
  const downRequestedAtUTC = new Date().toISOString(), downRequestedAtHostPerformanceNow = performance.now();
  const down = page.keyboard.down('KeyW');
  const up = wait(durationMs).then(() => {
    inputs.push({ kind: 'native keyup request', code: 'KeyW', label, requestedAtUTC: new Date().toISOString(), requestedAtHostPerformanceNow: performance.now(),
      downRequestedAtUTC, downRequestedAtHostPerformanceNow, requestedWaitMs: durationMs,
      note: 'Host request timing only; actual DOM occurrence/dispatch timing is logged separately' });
    return page.keyboard.up('KeyW');
  });
  await Promise.all([down, up]);
  return firstKeyboardRecord;
}
async function settledWPulse(firstKeyboardRecord, routeDeadline, label) {
  // Read the actual completed DOM dispatch, then the product's consumed-frame
  // receipt. An observer rAF sampled before the product callback is insufficient.
  const receiptHandle = await page.waitForFunction(firstKeyboardRecord => {
    const log = window.__NATIVE_HOME_INPUT_TIMING__, c = window.__YUNSHAN__.controller;
    const rows = log.keyboard.slice(firstKeyboardRecord);
    const downIndex = rows.findIndex(row => row.code === 'KeyW' && row.type === 'keydown');
    if (downIndex < 0) return false;
    const down = rows[downIndex];
    const up = rows.slice(downIndex + 1).find(row => row.code === 'KeyW' && row.type === 'keyup');
    if (!up || !down.isTrusted || !up.isTrusted || !up.controllerKeyStateObserved ||
        up.controllerContainsCodeAfterProductHandler !== false ||
        !Number.isFinite(up.afterProductWindowHandlerPerformanceNow)) return false;
    // This is an intentional read of the frozen controller's runtime fields.
    // The post-handler timestamp is at least its acceptance time, so this frame
    // must have consumed the release and all preceding W intervals.
    const consumedThrough = c.walkingFrameEnd;
    if (!Number.isFinite(consumedThrough) || consumedThrough < up.afterProductWindowHandlerPerformanceNow ||
        c.keys.has('KeyW') || c.walkingInputs.some(input => input.at <= consumedThrough)) return false;
    return { downEventTimeStamp: down.rawEventTimeStamp, upEventTimeStamp: up.rawEventTimeStamp,
      downHandledAt: down.afterProductWindowHandlerPerformanceNow, upHandledAt: up.afterProductWindowHandlerPerformanceNow,
      consumedThrough, tick: window.__YUNSHAN__.simulation.state.tick,
      noPositionOrSimulationWrite: true };
  }, firstKeyboardRecord, { polling: 'raf', timeout: Math.max(1, routeDeadline - Date.now()) });
  try {
    const receipt = await receiptHandle.jsonValue();
    inputs.push({ kind: 'read-only product W consumption receipt', label, receipt, atUTC: new Date().toISOString() });
    return receipt;
  } finally { await receiptHandle.dispose(); }
}
async function walkPoints(points, label) {
  await paused(false); await focusCanvas(); const started = Date.now();
  for (const target of points) {
    let noProgress = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const before = await body();
      assert.equal(before.mode, 'walk'); assert.equal(before.player.vehicleId, null); assert.equal(before.activeAircraftId, null);
      assert.equal(before.paused, false); assert.equal(before.speed, 1, 'Clock speed remains the real initial 1x');
      if (Math.hypot(target.x - before.body.x, target.z - before.body.z) <= .18) {
        await supportActual(before, label, target); break;
      }
      assert(Date.now() - started < 300_000, `Actual native W route timeout: ${label}`);
      await orient(target);
      const metres = Math.hypot(target.x - before.body.x, target.z - before.body.z);
      const duration = Math.max(35, Math.min(200, metres / 4.8 * 550));
      inputs.push({ kind: 'native W pulse', label, durationMs: duration, atUTC: new Date().toISOString() });
      const firstKeyboardRecord = await nativeWPulse(duration, label);
      await wait(100);
      const consumptionReceipt = await settledWPulse(firstKeyboardRecord, started + 300_000, label);
      const after = await body(), actualDelta = distance(before.body, after.body);
      movement.push({ label, target, attempt, input: 'actual native W', durationMs: duration, consumptionReceipt, before, after, actualDelta,
        eyeDelta: after.eye.y - after.body.y, plannerIsNotTraversalEvidence: true });
      await jsonFile('native-movement.json', movement);
      assert(Math.abs(after.eye.y - after.body.y - 1.72) < 1e-6, 'Actual first-person eye height must remain 1.72m');
      noProgress = actualDelta < .005 ? noProgress + 1 : 0;
      assert(noProgress < 20, `Actual body is blocked or did not advance for 20 W pulses: ${label}`);
      assert(attempt < 99, `Actual body did not reach waypoint: ${JSON.stringify({ label, target, actual: after.body })}`);
    }
  }
  await page.keyboard.up('KeyW');
}
async function walkTo(point, label) {
  const start = await body(); const route = readonlyPlan('route', { building: plan.building, from: start.body, to: point });
  await jsonFile(`plan-${label}.json`, route); await walkPoints(route.points, label);
}
async function restMinutes(minimum) {
  await page.waitForFunction(minimum => {
    const s = window.__YUNSHAN__.simulation.state.homeRest.session;
    return s?.state === 'active' && s.progressMinutes >= minimum && s.progressMinutes < 20;
  }, minimum, { timeout: 120_000 });
}
async function storage() {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some(db => db.name === 'yunshan-city' && db.version === 2)) return { exists: false };
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('yunshan-city'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onupgradeneeded = () => { r.transaction.abort(); reject(Error('Read-only observer refuses to create a database')); }; });
    try {
      const tx = db.transaction(['save-manifests', 'save-global', 'save-player', 'save-chunks'], 'readonly');
      const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const manifest = await request(tx.objectStore('save-manifests').get('autosave'));
      if (!manifest) { await complete; return { exists: true, manifest: null }; }
      const records = await Promise.all(manifest.parts.map(ref => request(tx.objectStore(ref.store).get(ref.recordId))));
      await complete;
      return { exists: true, backendEvidence: 'actual IndexedDB version2 readonly transaction', manifest,
        records, selectedJSON: await window.__YUNSHAN__.storage.read(),
        fallbackPresent: !!localStorage.getItem('yunshan.save.fallback.v2'), legacyPresent: !!localStorage.getItem('yunshan.save.v1') };
    } finally { db.close(); }
  });
}
async function settings() {
  if (await page.getByTestId('panel-toggle').getAttribute('aria-expanded') !== 'true') await click('[data-testid="panel-toggle"]');
  await click('#tab-settings');
}
async function closePanel() { if (await page.getByTestId('panel-toggle').getAttribute('aria-expanded') === 'true') await click('[data-action="close-panel"]'); }

try {
  const manifestBytes = await readFile(binding.snapshotManifest);
  assert.equal(hash(manifestBytes), expectedSourceManifestSHA, 'The external harness requires the actual root-approved frozen manifest');
  manifest = JSON.parse(manifestBytes.toString('utf8'));
  sourceStart = await sourceHashes(); assert.deepEqual(sourceStart, manifest.copiedHashes);
  assert.equal(manifest.inputCount, binding.inputCount);
  sharedExecutableStart = await sharedExecutableHashes();
  assert.equal(Object.keys(sharedExecutableStart).length, binding.sharedExecutableInputCount);
  assert.deepEqual(sharedExecutableStart, Object.fromEntries(Object.entries(manifest.copiedHashes).filter(([name]) => !nonExecutable.has(name))));
  const html = await readFile(join(sourceRoot, 'dist/index.html'), 'utf8');
  buildEntry = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]; assert.equal(buildEntry, expectedEntry);
  assert.equal(hash(await readFile(join(sourceRoot, 'dist', buildEntry.slice(1)))), expectedEntrySHA);
  sourceMapsStart = Object.fromEntries(await Promise.all(binding.sourceMaps.map(async row => [row.assetPath, hash(await readFile(join(sourceRoot, 'dist', row.assetPath.slice(1))))])));
  assert.deepEqual(sourceMapsStart, Object.fromEntries(binding.sourceMaps.map(row => [row.assetPath, row.sha256])));
  externalStart = { harnessSHA256: hash(await readFile(new URL(import.meta.url))), plannerSHA256: hash(await readFile(plannerPath)) };
  await jsonFile('run-start.json', { atUTC: new Date().toISOString(), sourceRoot, inputCount: binding.inputCount, sourceStart, sharedExecutableInputCount: binding.sharedExecutableInputCount, sharedExecutableStart,
    buildEntry, buildEntrySHA256: expectedEntrySHA, ...externalStart,
    stagedStart: 'One legal home exterior setup only; not an ordinary journey from spawn', bodyRadius: .35, eyeHeight: 1.72,
    requestedScope: 'Actual compiled CityRenderer, native W/E/buttons, physical v4 bed sides, actual IndexedDB native save/load; no visual/Mac/performance acceptance',
    prohibitedAfterStage: ['position/feet assignments', 'cash/needs/identity/weather/clock writes', 'Simulation.step', 'API save/load/import/export actions as input substitutes', 'moving NPCs', 'forcing a blocked or disabled button'] });
  await new Promise((resolve, reject) => { const socket = connect({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); reject(Error(`Port${port} already has an owner`)); }); socket.once('error', e => { if (e.code === 'ECONNREFUSED') resolve(); else reject(e); }); });
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: sourceRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => { serverOutput += b; }); server.stderr.on('data', b => { serverOutput += b; });
  for (let i = 0; i < 100 && !serverOutput.includes(`127.0.0.1:${port}`); i++) { assert.equal(server.exitCode, null, serverOutput); await wait(100); }
  assert(serverOutput.includes(`127.0.0.1:${port}`), 'Owned strictPort server never declared readiness');
  const served = await fetch(`http://127.0.0.1:${port}/`); assert.equal((await served.text()).match(/<script[^>]+src="([^"]+\.js)"/)?.[1], buildEntry);
  const require = createRequire(join(sourceRoot, 'package.json')); const pw = await import(pathToFileURL(require.resolve('playwright-core')).href);
  const chromium = pw.chromium ?? pw.default?.chromium; assert(chromium, 'Actual Playwright Chromium export unavailable');
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(120_000);
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Read-only event/RAF observer; no dispatch, preventDefault, interception or game state writes.
  await page.addInitScript(() => {
    const log = { timeOrigin: performance.timeOrigin, createdPerformanceNow: performance.now(), keyboard: [], frames: [],
      droppedKeyboard: 0, droppedFrames: 0, maxKeyboardRecords: 20_000, maxFrameRecords: 20_000,
      observerScope: 'Diagnostic sampling adds callbacks; no FPS/Mac/pure wall-time claim. Host requested wait is not DOM held duration.' };
    Object.defineProperty(window, '__NATIVE_HOME_INPUT_TIMING__', { value: log });
    const describe = target => target instanceof Element ? { tag: target.tagName, id: target.id || null,
      testId: target.getAttribute('data-testid'), ref: target.getAttribute('data-ref'), inputType: target.getAttribute('type') } : { tag: null };
    const eventRows = new WeakMap();
    const observe = event => {
      if (log.keyboard.length >= log.maxKeyboardRecords) { log.droppedKeyboard++; return; }
      const row = { type: event.type, code: event.code, key: event.key, repeat: event.repeat, isTrusted: event.isTrusted,
        rawEventTimeStamp: event.timeStamp, observedPerformanceNow: performance.now(), captureEventPhase: event.eventPhase,
        defaultPreventedAtCapture: event.defaultPrevented, target: describe(event.target), documentVisibility: document.visibilityState };
      log.keyboard.push(row);
      eventRows.set(event, row);
    };
    window.addEventListener('keydown', observe, { capture: true, passive: true });
    window.addEventListener('keyup', observe, { capture: true, passive: true });
    // Install after debug ready, hence after the product window key listeners.
    // A microtask from a capture listener is not assumed to mean full DOM dispatch ended.
    let attached = false;
    Object.defineProperty(window, '__NATIVE_HOME_ATTACH_POST_KEY_OBSERVER__', { value: () => {
      if (attached) return; attached = true;
      const afterProductHandler = event => {
        const row = eventRows.get(event); if (!row) return;
        const keys = window.__YUNSHAN__?.controller?.keys;
        row.afterProductWindowHandlerPerformanceNow = performance.now();
        row.defaultPreventedAtPostWindowBubble = event.defaultPrevented;
        row.postWindowBubbleEventPhase = event.eventPhase;
        row.controllerKeyStateObserved = !!keys && typeof keys.has === 'function';
        row.controllerContainsCodeAfterProductHandler = row.controllerKeyStateObserved ? keys.has(event.code) : null;
        row.note = 'Read-only window bubble observer registered after product handlers; does not alter accepted input';
      };
      window.addEventListener('keydown', afterProductHandler, { passive: true });
      window.addEventListener('keyup', afterProductHandler, { passive: true });
    } });
    let previousRAF = null;
    const frame = rawRAFTimeStamp => {
      if (log.frames.length < log.maxFrameRecords) {
        const d = window.__YUNSHAN__, keys = d?.controller?.keys;
        log.frames.push({ rawRAFTimeStamp, observedPerformanceNow: performance.now(), rawRAFGAP: previousRAF === null ? null : rawRAFTimeStamp - previousRAF,
          tick: d?.simulation?.state.tick ?? null, documentVisibility: document.visibilityState,
          controllerContainsW: keys && typeof keys.has === 'function' ? keys.has('KeyW') : null });
      } else log.droppedFrames++;
      previousRAF = rawRAFTimeStamp; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const responseTasks = [];
  page.on('response', r => { if (new URL(r.url()).pathname === buildEntry) responseTasks.push(r.body().then(bytes => httpEntryResponses.push({ status: r.status(), sha256: hash(bytes) }))); });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__YUNSHAN__?.simulation.state.tick >= 1, null, { timeout: 90_000 });
  await page.evaluate(() => window.__NATIVE_HOME_ATTACH_POST_KEY_OBSERVER__());
  await Promise.all(responseTasks); assert(httpEntryResponses.some(r => r.status === 200 && r.sha256 === expectedEntrySHA));
  await jsonFile('loaded-document.json', { buildEntry, expectedEntrySHA, httpEntryResponses, scriptURLs: await page.evaluate(() => [...document.scripts].map(s => new URL(s.src).pathname)) });
  stage = 'read-only actual home/ground-service/bed-side physical planning';
  const actual = await page.evaluate(id => ({ world: window.__YUNSHAN__.world, player: window.__YUNSHAN__.simulation.state.player, buildingId: id }), buildingId);
  immutableWorld = structuredClone(actual.world); immutableWorldSHA256 = hash(JSON.stringify(immutableWorld));
  plan = readonlyPlan('plan', actual); await jsonFile('actual-home-plan.json', { ...plan, immutableWorldSHA256 });
  stage = 'one controlled legal exterior setup';
  const setup = await page.evaluate(position => {
    const d = window.__YUNSHAN__, s = d.simulation.state;
    const before = { player: structuredClone(s.player), tick: s.tick, at: s.extension.lastUpdate, npc: JSON.stringify(s.citizens) };
    if (s.player.vehicleId || s.aviation.activeAircraftId || s.extension.actorProfiles.player.alive === false || s.player.homeId) throw Error('Starting player is not a fresh alive traveller on foot');
    s.player.position = { ...position }; d.controller.setMode('walk', s.player.position);
    const after = { player: structuredClone(s.player), tick: s.tick, at: s.extension.lastUpdate, npc: JSON.stringify(s.citizens) };
    const snap = () => { const current = d.simulation.state; return { at: current.extension.lastUpdate, tick: current.tick, position: { ...current.player.position }, cash: current.player.money, treasury: current.treasury, needs: { ...current.player.needs }, homeId: current.player.homeId, homeRest: structuredClone(current.homeRest) }; };
    const original = d.simulation.command.bind(d.simulation);
    window.__HOME_NATIVE_OBSERVER__ = { commands: [] };
    // Read-only delegation observer. It never originates commands or changes their result.
    d.simulation.command = function(command) { const before = snap(); const result = original(command); window.__HOME_NATIVE_OBSERVER__.commands.push({ command: structuredClone(command), result: structuredClone(result), before, after: snap() }); return result; };
    return { before, after, actualFeet: d.controller.position, actualEye: { x: d.city.camera.position.x, y: d.city.camera.position.y, z: d.city.camera.position.z } };
  }, plan.stage); setupCount++;
  const withoutPosition = player => { const value = structuredClone(player); delete value.position; return value; };
  assert.deepEqual(withoutPosition(setup.before.player), withoutPosition(setup.after.player)); assert.equal(setup.before.npc, setup.after.npc);
  assert.equal(setup.before.tick, setup.after.tick); assert.equal(setup.before.at, setup.after.at);
  delete setup.before.npc; delete setup.after.npc; await jsonFile('controlled-start.json', { setupCount, plan: { stage: plan.stage, entrance: plan.entrance }, ...setup });
  await screenshot('01-controlled-home-exterior.png');
  stage = 'actual native W approach and native E doorway'; await walkPoints([plan.approach], 'exterior-approach');
  const preDoor = await body(); assert(distance(preDoor.body, plan.entrance) <= 6);
  await keyboard('KeyE'); const postDoor = await body();
  assert(distance(postDoor.body, plan.expectedDoorExit) < 1e-6, 'Native E did not cross the actual selected opening');
  assert(distance(preDoor.body, postDoor.body) <= 5, 'Native portal crossing must remain local');
  await jsonFile('native-doorway.json', { preDoor, postDoor, input: 'native E', controlledPositionWrite: false });
  record('native W approach and native E actual home doorway', { delta: distance(preDoor.body, postDoor.body) });
  stage = 'actual W service-table rental and table rest disabled'; await walkTo(plan.service.position, 'service-table');
  const rental = await command('rent'); assert.equal(rental.before.cash - rental.after.cash, 80); assert.equal(rental.after.treasury - rental.before.treasury, 80); assert.equal(rental.after.homeId, buildingId);
  await paused(true); await buildingContext(); const table = await body(); assert.equal(table.session, null);
  const disabledRest = page.locator(commandSelector('rest')).first(); assert.equal(await disabledRest.isDisabled(), true);
  const box = await disabledRest.boundingBox(); assert(box); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const afterDisabled = await body(); assert.equal(afterDisabled.commands.length, table.commands.length); assert.equal(afterDisabled.session, null);
  assert.deepEqual(afterDisabled.player.needs, table.player.needs); await screenshot('02-real-rental-table-rest-disabled.png');
  record('native rent80 conserves wallet/public cash and table rest stays disabled', { rental });
  stage = 'actual W to derived original bed side'; await walkTo(plan.bed.position, 'bed-side');
  const began = await command('rest'); assert.equal(began.after.homeRest.session.progressMinutes, 0); assert.equal(began.after.homeRest.session.pointId, plan.bed.id); assert.deepEqual(began.before.needs, began.after.needs);
  await buildingContext(); assert.equal(await page.locator(commandSelector('rest')).first().isDisabled(), true);
  await restMinutes(2); const partial = await body(); const sessionId = partial.session.id;
  stage = 'real W leaves bed, natural people phase pauses'; await walkTo(plan.service.position, 'leave-bed');
  await page.waitForFunction(() => window.__YUNSHAN__.simulation.state.homeRest.session?.state === 'paused', null, { timeout: 30_000 });
  const away = await body(); assert.equal(away.session.id, sessionId); assert(away.session.progressMinutes > 0 && away.session.progressMinutes < 20);
  await page.waitForFunction(at => window.__YUNSHAN__.simulation.state.extension.lastUpdate >= at + 1, away.at, { timeout: 60_000 });
  const stayedAway = await body(); assert.equal(stayedAway.session.progressMinutes, away.session.progressMinutes); assert.equal(stayedAway.player.money, rental.after.cash);
  await paused(true); await screenshot('03-real-leave-bed-paused.png');
  record('real W departure pauses with no away progress', { sessionId, progress: away.session.progressMinutes, pauseReason: away.session.pauseReason });
  stage = 'real W returns to original side, explicit native continuation'; await walkTo(plan.bed.position, 'return-original-side');
  const returned = await body(); assert.equal(returned.session.state, 'paused'); assert.equal(returned.session.progressMinutes, away.session.progressMinutes);
  const resumed = await command('rest'); assert.equal(resumed.after.homeRest.session.id, sessionId); assert.equal(resumed.after.homeRest.session.pointId, plan.bed.id);
  assert.equal(resumed.after.homeRest.session.progressMinutes, resumed.before.homeRest.session.progressMinutes); assert.deepEqual(resumed.before.needs, resumed.after.needs);
  await restMinutes(away.session.progressMinutes + 1); await paused(true); await screenshot('04-real-resumed-bed-session.png');
  record('return to original side needs explicit native continuation, no instant credit', { sessionId });
  stage = 'actual native save/cancel/load through IndexedDB'; await settings();
  const beforeStorage = await storage(); await click('[data-testid="save"]');
  let saved;
  for (let i = 0; i < 30; i++) { saved = await storage(); if (saved.manifest?.generation > (beforeStorage.manifest?.generation ?? 0)) break; await wait(200); }
  assert(saved.manifest?.generation > (beforeStorage.manifest?.generation ?? 0), 'Native save did not complete a new IndexedDB generation');
  assert.equal(saved.fallbackPresent, false); assert.equal(saved.legacyPresent, false);
  assert.equal(saved.records.length, saved.manifest.parts.length); assert(saved.records.every(Boolean));
  assert.equal(saved.manifest.version, 2); assert.equal(saved.manifest.id, 'autosave');
  assert(Number.isSafeInteger(saved.manifest.generation) && saved.manifest.generation > 0);
  assert(Number.isFinite(saved.manifest.savedAt));
  assert(saved.manifest.parts.length >= 2);
  assert.equal(new Set(saved.manifest.parts.map(ref => ref.id)).size, saved.manifest.parts.length);
  assert(saved.manifest.parts.some(ref => ref.id === 'global') && saved.manifest.parts.some(ref => ref.id === 'player'));
  // Full actual selected-generation references and record JSON, not a toast,
  // localStorage fallback or a stubbed storage callback. Reused older records
  // are valid; their declared IDs/checksums/content must still match exactly.
  const storageChecksum = json => { let value = 2166136261; for (let i = 0; i < json.length; i++) value = Math.imul(value ^ json.charCodeAt(i), 16777619); return `${json.length}:${value >>> 0}`; };
  const referenceEvidence = saved.manifest.parts.map((ref, i) => {
    const record = saved.records[i], expectedStore = ref.id === 'global' ? 'save-global' : ref.id === 'player' ? 'save-player' : 'save-chunks';
    assert(ref.id === 'global' || ref.id === 'player' || ref.id.startsWith('chunk:'));
    assert.equal(ref.store, expectedStore); assert.equal(typeof ref.recordId, 'string');
    assert.equal(record.id, ref.recordId); assert.equal(typeof record.json, 'string');
    assert.equal(record.checksum, ref.checksum); assert.equal(storageChecksum(record.json), ref.checksum);
    const parsed = JSON.parse(record.json); assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
    return { id: ref.id, store: ref.store, recordId: ref.recordId, bytes: Buffer.byteLength(record.json), checksum: ref.checksum, sha256: hash(record.json), actualRecordJSONCaptured: true };
  });
  await jsonFile('actual-native-idb-reference-verification.json', { generation: saved.manifest.generation, savedAt: saved.manifest.savedAt, allCurrentReferencesExact: true, referenceEvidence });
  const parts = saved.manifest.parts.map((ref, i) => ({ id: ref.id, json: saved.records[i].json }));
  const storedJSON = readonlyPlan('assemble', { parts }).json; assert.equal(storedJSON, saved.selectedJSON);
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave()), storedJSON);
  await writeFile(join(evidenceRoot, 'actual-native-idb-checkpoint.json'), storedJSON); await jsonFile('actual-native-idb-records.json', saved);
  await closePanel(); const cancelledBeforeLoad = await command('cancelRest'); assert.deepEqual(cancelledBeforeLoad.before.needs, cancelledBeforeLoad.after.needs);
  const changed = await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave()); assert.notEqual(changed, storedJSON);
  const beforeLoad = await storage(); assert.equal(beforeLoad.selectedJSON, storedJSON, 'Autosave replaced the real native checkpoint before load; preserve as an actual failure');
  await settings(); await click('[data-testid="load"]');
  await page.waitForFunction(id => window.__YUNSHAN__.simulation.state.homeRest.session?.id === id && window.__YUNSHAN__.simulation.state.homeRest.session.state === 'active', sessionId, { timeout: 120_000 });
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave()), storedJSON, 'Native IndexedDB load must restore the complete saved model exactly');
  const loaded = await body(); assert.equal(loaded.paused, true); assert(distance(loaded.body, JSON.parse(storedJSON).state.player.position) < 1e-7);
  await jsonFile('actual-native-save-load-result.json', { storageGeneration: saved.manifest.generation, checkpointSHA256: hash(storedJSON), restoredSHA256: hash(await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave())), cancelledBeforeLoad, loaded, inputSubstitutes: false });
  await screenshot('05-real-native-indexeddb-load.png'); await closePanel();
  record('native buttons create real IndexedDB generation and restore exact active rest checkpoint', { generation: saved.manifest.generation, checkpointSHA256: hash(storedJSON) });
  stage = 'natural 1x completion of twenty credited onsite minutes'; await paused(false);
  await page.waitForFunction(id => { const r = window.__YUNSHAN__.simulation.state.homeRest; return r.session === null && r.history.at(-1)?.id === id && r.history.at(-1).state === 'completed'; }, sessionId, { timeout: 180_000 });
  const completed = await body(); assert.equal(completed.history.at(-1).progressMinutes, 20); assert.equal(completed.player.money, rental.after.cash); assert.equal(completed.speed, 1);
  await paused(true); await screenshot('06-real-twenty-minute-completion.png');
  record('actual twenty-minute onsite completion, no additional cash charge', { record: completed.history.at(-1), clock: completed.at, needs: completed.player.needs });
  stage = 'second actual partial session and native cancellation'; const second = await command('rest'); assert.equal(second.after.homeRest.session.progressMinutes, 0); assert.deepEqual(second.before.needs, second.after.needs);
  await paused(false); await restMinutes(1); await paused(true); const ended = await command('cancelRest');
  assert.equal(ended.after.homeRest.session, null); assert.equal(ended.after.homeRest.history.at(-1).state, 'cancelled');
  assert(ended.after.homeRest.history.at(-1).progressMinutes >= 1 && ended.after.homeRest.history.at(-1).progressMinutes < 20); assert.deepEqual(ended.before.needs, ended.after.needs);
  await screenshot('07-real-native-cancelled-partial-session.png');
  record('native cancellation preserves earned partial progress without instant credit', { record: ended.after.homeRest.history.at(-1) });
  assert.equal(setupCount, 1); assert.deepEqual(errors, []);
  stage = 'completed';
} catch (error) {
  console.error(error); errors.push(`Harness ${String(error)}`);
  if (page && !page.isClosed()) {
    await screenshot('FAIL-actual-native-home.png').catch(e => errors.push(`Failure screenshot ${String(e)}`));
    await writeFile(join(evidenceRoot, 'FAIL-actual-model-save.json'), await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave())).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await page?.keyboard.up('KeyW').catch(() => {});
  const finalBody = page && !page.isClosed() ? await body().catch(() => null) : null;
  const nativeInputEventTiming = page && !page.isClosed() ? await page.evaluate(() => structuredClone(window.__NATIVE_HOME_INPUT_TIMING__ ?? null)).catch(() => null) : null;
  await jsonFile('native-input-event-timing.json', nativeInputEventTiming);
  // Bounded cleanup failure is preserved. Do not start a second GPU process
  // if close did not resolve; root must inspect/authorize any exact-owner TERM.
  let browserClose = browser ? 'not resolved' : 'not started';
  try {
    if (browser) { let timer; try { await Promise.race([browser.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned browser.close exceeded original diagnostic cleanup budget10s')), 10_000); })]); browserClose = 'resolved'; } finally { clearTimeout(timer); } }
  } catch (error) { browserClose = String(error); errors.push(`Cleanup ${String(error)}`); process.exitCode = 1; }
  await jsonFile('owned-cleanup-browser.json', { browserClose, allOwnedBrowserResourcesReleased: browserClose === 'resolved' || browserClose === 'not started', broadSignalsUsed: false, nextGPUBlockedUntilRootConfirmsRelease: browserClose !== 'resolved' && browserClose !== 'not started' });
  if (server) { server.kill('SIGTERM'); for (let i = 0; i < 40 && server.exitCode === null && server.signalCode === null; i++) await wait(100); }
  const sourceEnd = manifest ? await sourceHashes() : null;
  const sourceStable = !!sourceStart && JSON.stringify(sourceStart) === JSON.stringify(sourceEnd);
  if (sourceStart && !sourceStable) process.exitCode = 1;
  const sharedExecutableEnd = manifest ? await sharedExecutableHashes() : null;
  const sharedExecutableStable = !!sharedExecutableStart && JSON.stringify(sharedExecutableStart) === JSON.stringify(sharedExecutableEnd);
  if (sharedExecutableStart && !sharedExecutableStable) process.exitCode = 1;
  const externalEnd = { harnessSHA256: hash(await readFile(new URL(import.meta.url))), plannerSHA256: hash(await readFile(plannerPath)) };
  const externalStable = !!externalStart && JSON.stringify(externalStart) === JSON.stringify(externalEnd);
  if (externalStart && !externalStable) process.exitCode = 1;
  const entryEndSHA256 = buildEntry ? hash(await readFile(join(sourceRoot, 'dist', buildEntry.slice(1)))) : null;
  const entryStable = entryEndSHA256 === expectedEntrySHA;
  if (buildEntry && !entryStable) process.exitCode = 1;
  sourceMapsEnd = Object.fromEntries(await Promise.all(binding.sourceMaps.map(async row => [row.assetPath, hash(await readFile(join(sourceRoot, 'dist', row.assetPath.slice(1))))])));
  const sourceMapsStable = !!sourceMapsStart && JSON.stringify(sourceMapsStart) === JSON.stringify(sourceMapsEnd);
  if (sourceMapsStart && !sourceMapsStable) process.exitCode = 1;
  await jsonFile('native-home-results.json', { browserClose, sourceMapsStart, sourceMapsEnd, sourceMapsStable, atUTC: new Date().toISOString(), stage, exitCode: process.exitCode ?? 0,
    results, errors, setupCount, inputs, finalBody, nativeInputEventTimingCaptured: nativeInputEventTiming !== null, supportQueries, immutableWorldSHA256, sourceStart, sourceEnd, sourceStable, sharedExecutableInputCount: binding.sharedExecutableInputCount, sharedExecutableStart, sharedExecutableEnd, sharedExecutableStable, externalStart, externalEnd, externalStable,
    buildEntry, expectedEntrySHA, entryEndSHA256, entryStable, httpEntryResponses, serverOutput, serverExitCode: server?.exitCode, serverSignalCode: server?.signalCode,
    scope: 'Independent root-bound compiled first-person controlled-exterior native home run; separate from standard browser11 and DOM35. No ordinary spawn journey, natural NPC bed test, art acceptance, Mac or performance proof.' });
  console.log('FINAL', JSON.stringify({ stage, passCount: results.length, errors, sourceStable, exitCode: process.exitCode ?? 0 }));
}
