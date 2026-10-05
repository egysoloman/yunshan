// Run with node --import tsx scripts/layout-browser-test.mjs after a frozen build.
// Prepared, validated saves exercise compatibility; this is not a normal-player journey.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { Simulation } from '../src/simulation.ts';
import { createWorld } from '../src/world.ts';
import { getStairPosition } from '../src/access.ts';
import { savedWorldFingerprint } from '../src/persistence/world-layout.ts';

const port = Number(process.env.YUNSHAN_LAYOUT_BROWSER_PORT ?? 4184);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Layout browser port must be an integer from 1024 to 65535.');
const origin = `http://127.0.0.1:${port}`;
const directory = 'artifacts/layout-browser';
const results = [], errors = [];
const hash = text => createHash('sha256').update(text).digest('hex');
const sourceHashes = async () => Object.fromEntries(await Promise.all((await readdir('src', { recursive: true })).filter(path => /\.(ts|css)$/.test(path)).sort().map(async path => [`src/${path}`, hash(await readFile(`src/${path}`))])));
const check = (name, data = {}) => { results.push({ name, ...data }); console.log(`PASS ${name} ${JSON.stringify(data)}`); };
function fixture(layout, floor) {
  const world = createWorld(20261001, layout), sim = new Simulation(world);
  const home = world.buildings.find(site => site.kind === 'home');
  sim.setFocus(home.door, 'walk');
  const rent = sim.command({ type: 'rent', targetId: home.id }); assert(rent.ok, rent.message);
  const build = sim.command({ type: 'build', targetId: home.id, position: { x: home.door.x + 1.4, y: home.door.y, z: home.door.z } }); assert(build.ok, build.message);
  const bank = world.buildings.find(site => site.kind === 'bank');
  sim.setFocus(bank.door, 'walk');
  const deposit = sim.command({ type: 'deposit', targetId: bank.id, value: 100 }); assert(deposit.ok, deposit.message);
  // A known upper-floor save is a compatibility fixture, not earned gameplay.
  sim.state.player.identities = ['traveler', 'mayor']; sim.state.player.role = 'mayor';
  const core = world.buildings.find(site => site.id === 'core-main');
  sim.setFocus(getStairPosition(core, floor), 'walk');
  const target = world.buildings.find(site => site.kind === 'school');
  const journey = sim.command({ type: 'planJourney', targetId: target.id, value: 0 }); assert(journey.ok, journey.message);
  sim.command({ type: 'pause', value: 1 });
  const json = sim.exportSave(), data = JSON.parse(json);
  const restored = new Simulation(world), validation = restored.importSave(json); assert(validation.ok, validation.message);
  assert.equal(restored.exportSave(), json);
  return { world, json, data, floor, name: core.name, fingerprint: savedWorldFingerprint(world) };
}
function important(data) {
  return { worldSeed: data.worldSeed, fingerprint: data.worldFingerprint, player: data.state.player, banking: data.state.banking, voxels: data.state.voxels, journey: data.state.journey, routes: data.state.citizens.map(citizen => [citizen.id, citizen.route, citizen.routeIndex, citizen.destinationId]) };
}
let server, browser, page, output = '', buildEntry, buildHash, beforeHashes;
async function openSettings(currentPage) {
  if (await currentPage.getByTestId('panel-toggle').getAttribute('aria-expanded') !== 'true') {
    await currentPage.getByTestId('panel-toggle').focus(); await currentPage.keyboard.press('Enter');
  }
  await currentPage.locator('#tab-settings').focus(); await currentPage.keyboard.press('Enter');
  await currentPage.locator('#pane-settings').waitFor({ state: 'visible' });
}
async function exported(currentPage, name) {
  await openSettings(currentPage);
  const downloaded = currentPage.waitForEvent('download');
  await currentPage.locator('[data-action="export"]').focus(); await currentPage.keyboard.press('Enter');
  const file = await downloaded, path = `${directory}/${name}.json`; await file.saveAs(path);
  return JSON.parse(await readFile(path, 'utf8'));
}
async function boot(currentPage) {
  await currentPage.locator('[data-ref="clock"]').waitFor();
  await currentPage.waitForFunction(() => document.querySelector('[data-ref="clock"]')?.textContent?.includes(':'));
  assert.equal(await currentPage.evaluate(() => '__YUNSHAN__' in window), false, 'ordinary URL must not expose diagnostics');
  assert.equal(await currentPage.locator('.startup-error').count(), 0);
}
async function seedContext(json) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    storageState: { cookies: [], origins: [{ origin, localStorage: [
      { name: 'yunshan.save.v1', value: json }, { name: 'yunshan.save.timestamp.v1', value: String(Date.now()) },
      { name: 'yunshan.ui.welcomeSeen.v1', value: '1' },
      { name: 'yunshan.preferences.v1', value: JSON.stringify({ quality: 'low', renderDistance: 900, fpsCap: 30, dynamicResolution: true, simulationDetail: 1 }) },
    ] }] } });
  const currentPage = await context.newPage(); currentPage.setDefaultTimeout(120_000);
  currentPage.on('pageerror', error => errors.push(error.message));
  currentPage.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`.trim()); });
  await currentPage.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await boot(currentPage);
  return { context, page: currentPage };
}
try {
  await mkdir(directory, { recursive: true }); beforeHashes = await sourceHashes();
  const index = await readFile('dist/index.html', 'utf8'); buildEntry = index.match(/src="([^"]+\.js)"/)?.[1]; assert(buildEntry);
  if (process.env.YUNSHAN_EXPECTED_BUILD_ENTRY) assert.equal(buildEntry, process.env.YUNSHAN_EXPECTED_BUILD_ENTRY);
  buildHash = hash(await readFile(`dist${buildEntry}`));
  const legacy = fixture('legacy-ee3e7a1', 25), current = fixture('current-v2', 17);
  assert.notEqual(legacy.fingerprint, current.fingerprint);
  await writeFile(`${directory}/legacy-fixture.json`, legacy.json); await writeFile(`${directory}/current-fixture.json`, current.json);
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error(`Own preview failed: ${output}`);
    if (output.includes(origin)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (attempt === 99) throw Error(`Own preview startup marker absent: ${output}`);
  }
  assert.equal((await (await fetch(origin)).text()).match(/src="([^"]+\.js)"/)?.[1], buildEntry);
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let active = await seedContext(legacy.json); page = active.page;
  await page.locator('[data-ref="context-body"]').filter({ hasText: '26 层' }).waitFor({ state: 'visible' });
  const restoredLegacy = await exported(page, 'legacy-startup-export'); assert.deepEqual(important(restoredLegacy), important(legacy.data));
  check('ordinary startup selects the trusted legacy world before restoring body, upper floor, bank, edits and routes', { floor: 26, fingerprint: restoredLegacy.worldFingerprint, money: restoredLegacy.state.player.money, deposit: restoredLegacy.state.bankBalance, voxels: restoredLegacy.state.voxels.length });
  await page.screenshot({ path: `${directory}/legacy-upper-floor.png`, timeout: 120_000 });
  const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame(), timeout: 120_000 });
  await page.locator('[data-ref="file"]').setInputFiles(`${directory}/current-fixture.json`);
  await navigation; await boot(page);
  await page.locator('[data-ref="context-body"]').filter({ hasText: '18 层' }).waitFor({ state: 'visible' });
  const restoredCurrent = await exported(page, 'current-reloaded-export'); assert.deepEqual(important(restoredCurrent), important(current.data));
  check('native JSON file import validates and saves a different known layout, then performs a real page reload', { floor: 18, fingerprint: restoredCurrent.worldFingerprint, money: restoredCurrent.state.player.money, deposit: restoredCurrent.state.bankBalance, position: restoredCurrent.state.player.position });
  await page.screenshot({ path: `${directory}/current-upper-floor.png`, timeout: 120_000 });
  await page.getByTestId('save').focus(); await page.keyboard.press('Enter');
  await page.reload({ waitUntil: 'domcontentloaded' }); await boot(page);
  assert.deepEqual(important(await exported(page, 'current-second-startup-export')), important(current.data));
  check('a second ordinary startup reads the new geographic save without reverting to the legacy slot');
  await active.context.close();

  const unknown = JSON.parse(legacy.json); unknown.worldFingerprint = 'ffffffff'; const invalidJson = JSON.stringify(unknown);
  active = await seedContext(invalidJson); page = active.page;
  assert.match(await page.locator('[data-ref="toast"]').textContent(), /保留原存档并停止自动覆盖/);
  // The fresh clock progresses through 32 real accepted frame seconds at 1x;
  // this passes the existing 30-second autosave threshold without direct step.
  await page.waitForFunction(() => { const clock = document.querySelector('[data-ref="clock"]')?.textContent ?? ''; const [hour, minute] = clock.split(':').map(Number); return hour > 8 || hour === 8 && minute >= 32; }, null, { timeout: 240_000 });
  const clock = await page.locator('[data-ref="clock"]').textContent();
  await page.route('**/storage-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage inspection</title>' }));
  // Normal navigation invokes production pagehide, another automatic save path.
  await page.goto(`${origin}/storage-check.html`, { waitUntil: 'domcontentloaded' });
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open('yunshan-city', 2), db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('save-manifests', 'readonly'), read = transaction.objectStore('save-manifests').get('autosave');
    const manifest = await new Promise((resolve, reject) => { read.onsuccess = () => resolve(read.result ?? null); read.onerror = () => reject(read.error); }); db.close();
    return { legacy: localStorage.getItem('yunshan.save.v1'), fallback: localStorage.getItem('yunshan.save.fallback.v2'), manifest };
  });
  assert.equal(stored.legacy, invalidJson); assert.equal(stored.fallback, null); assert.equal(stored.manifest, null);
  check('unknown layout preserves the exact original slot across timed autosave and real pagehide', { acceptedClock: clock, originalSHA256: hash(invalidJson), manifest: stored.manifest, fallback: stored.fallback });
  await active.context.close(); page = null;
  assert.deepEqual(await sourceHashes(), beforeHashes); assert.equal(hash(await readFile(`dist${buildEntry}`)), buildHash); assert.equal(errors.length, 0, errors.join('\n'));
  console.log(`${results.length} layout browser checks passed; no diagnostics globals or browser errors.`);
  await writeFile(`${directory}/results.json`, JSON.stringify({ status: 'passed', scope: 'Normal URL, native keyboard and JSON file input/export; prepared known-layout save fixtures, not a normal-player trip', settings: { quality: 'low', renderDistance: 900, fpsCap: 30, dynamicResolution: true, simulationDetail: 1 }, buildEntry, buildHash, sourceHashes: beforeHashes, checks: results.length, results, errors }, null, 2));
} catch (error) {
  console.error(error); await page?.screenshot({ path: `${directory}/failure.png`, timeout: 120_000 }).catch(() => {});
  await writeFile(`${directory}/results.json`, JSON.stringify({ status: 'failed', buildEntry, buildHash, sourceHashes: beforeHashes, checks: results.length, results, errors, error: String(error), preview: output }, null, 2)); process.exitCode = 1;
} finally { await browser?.close(); server?.kill('SIGTERM'); }
