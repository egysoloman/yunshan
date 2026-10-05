import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile(path.join(home, 'PLAN.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const source = plan.source, output = process.argv[2];
assert(output && output.startsWith(home + path.sep));
await mkdir(output, { recursive: false });
const put = (name, value) => writeFile(path.join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const receipt = { startedAt: new Date().toISOString(), source, graph: plan.graph, planSHA256: hash(await readFile(path.join(home, 'PLAN.json'))), driverSHA256: hash(await readFile(fileURLToPath(import.meta.url))), scope: plan.scope, artStatus: 'FAIL: native screenshots do not meet the supplied art references', captures: [] };
const errors = [];
let browser, server, serverIdentity, startup = '', page;
async function identity(pid) {
  try { const raw = await readFile(`/proc/${pid}/stat`, 'utf8'); const f = raw.slice(raw.lastIndexOf(')') + 2).split(' '); return { pid, parent: Number(f[1]), state: f[0], ticks: Number(f[19]) }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function snapshot() {
  const d = window.__YUNSHAN__, s = d.simulation.state, r = d.city.renderer, gl = r.getContext();
  const errors = [];
  for (let i = 0; i < 20; i++) { const e = gl.getError(); if (e === gl.NO_ERROR) break; errors.push(e); }
  return { tick: s.tick, day: s.day, hour: s.hour, paused: s.paused, body: d.controller.position, player: s.player.position, insideId: d.controller.inside?.id ?? null, floor: d.controller.floor, mode: d.controller.mode, camera: { position: d.city.camera.position.toArray(), quaternion: d.city.camera.quaternion.toArray(), fov: d.city.camera.fov }, drawCalls: r.info.render.calls, triangles: r.info.render.triangles, glErrors: errors, programs: (r.info.programs ?? []).map(p => ({ name: p.name, linked: gl.getProgramParameter(p.program, gl.LINK_STATUS), log: gl.getProgramInfoLog(p.program), runnable: p.diagnostics?.runnable ?? null })), save: d.simulation.exportSave() };
}
async function settle() {
  // Observe real production rAF. No substituted controller, focus, motor dt,
  // renderer or simulation callback. Stable checkpoints follow actual frames.
  for (let i = 0; i < 6; i++) {
    const before = await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave());
    if (before === after) return { observedFramePairs: i + 1, saveSHA256: hash(after) };
  }
  throw Error('Actual paused main loop did not settle within six real frame pairs');
}
async function capture(name, scope, checkpoint) {
  const before = await page.evaluate(snapshot);
  await page.screenshot({ path: path.join(output, name + '.png'), timeout: 90000 });
  const after = await page.evaluate(snapshot);
  await put(name + '.before.save.json', before.save); await put(name + '.after.save.json', after.save);
  assert.equal(before.save, after.save, 'Whole paused save must remain byte-identical through capture');
  for (const s of [before, after]) { assert(s.drawCalls > 0 && s.triangles > 0); assert.equal(s.glErrors.length, 0); for (const p of s.programs) { assert(p.linked); assert.notEqual(p.runnable, false); } }
  const image = await readFile(path.join(output, name + '.png'));
  const saveSHA256 = hash(before.save); delete before.save; delete after.save;
  const item = { name, scope, checkpoint, graph: plan.graph, buildEntry: plan.buildEntry, buildSHA256: plan.buildSHA256, worldSHA256: receipt.worldSHA256, saveSHA256, pngSHA256: hash(image), pngBytes: image.length, before, after };
  await put(name + '.json', item); receipt.captures.push(item); console.log(JSON.stringify({ name, stable: true, imageBytes: image.length }));
}
try {
  const index = await readFile(path.join(source, 'dist/index.html'), 'utf8');
  assert.equal(index.match(/src="([^"]+\.js)"/)?.[1], plan.buildEntry);
  assert.equal(hash(await readFile(path.join(source, 'dist', plan.buildEntry.slice(1)))), plan.buildSHA256);
  server = spawn(process.execPath, [path.join(source, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(plan.port), '--strictPort'], { cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
  serverIdentity = await identity(server.pid); assert.equal(serverIdentity.parent, process.pid); receipt.previewIdentity = serverIdentity;
  server.stdout.on('data', data => { startup += data; }); server.stderr.on('data', data => { startup += data; });
  for (let i = 0; i < 100 && !startup.includes(`http://127.0.0.1:${plan.port}`); i++) { assert.equal(server.exitCode, null); await new Promise(r => setTimeout(r, 100)); }
  assert(startup.includes(`http://127.0.0.1:${plan.port}`));
  const origin = `http://127.0.0.1:${plan.port}`;
  assert.equal(hash(Buffer.from(await (await fetch(origin + plan.buildEntry)).arrayBuffer())), plan.buildSHA256);
  const require = createRequire(path.join(source, 'package.json')); const { chromium } = require('playwright-core');
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push({ scope: 'pageerror', message: e.message }));
  await page.goto(origin + '/?debug=1', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => !!window.__YUNSHAN__?.city && window.__YUNSHAN__.simulation.state.tick >= 1, undefined, { timeout: 90000 });
  const birth = await page.evaluate(snapshot); assert.deepEqual(birth.body, plan.birthBody); assert.equal(birth.mode, 'walk');
  receipt.worldSHA256 = hash(await page.evaluate(() => JSON.stringify(window.__YUNSHAN__.world))); assert.equal(receipt.worldSHA256, plan.worldSHA256);
  await put('native-birth-initial.save.json', birth.save);
  await page.evaluate(() => { const d = window.__YUNSHAN__; d.actions.command({ type: 'pause', value: 1 }); if (!d.simulation.state.paused) throw Error('Native pause action failed'); });
  await capture('native-birth-paused', 'Untouched production spawn and full UI. Only native pause command; checkpoint follows the real main loop.', await settle());
  // Disclosed original ROOT15 door fixture, separately from the native spawn.
  // Actual trusted E input performs admission; this is not a travel proof.
  const fixture = await page.evaluate(() => {
    const d = window.__YUNSHAN__, b = d.world.buildings.find(b => b.id === 'river-b1');
    if (!b || b.kind !== 'market') throw Error('Original market absent');
    const before = d.controller.position; d.simulation.state.player.position = { ...b.door, z: b.door.z + 2 };
    d.controller.setMode('walk', d.simulation.state.player.position);
    return { id: b.id, before, initial: d.controller.position, door: b.door, fixture: 'once-only existing original door+2m body setup; no identity/resources/clock change' };
  });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(id => window.__YUNSHAN__.controller.inside?.id === id, fixture.id, { timeout: 30000 });
  const settled = await settle(); await put('controlled-market-fixture.json', fixture);
  const beforeAssessment = await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave());
  await page.locator('button[data-action="building-impact"]').click({ timeout: 30000 });
  const result = page.locator(`details[data-building-impact="${fixture.id}"]`);
  await result.waitFor({ state: 'visible', timeout: 30000 });
  await result.locator('summary').click({ timeout: 30000 });
  await put('building-impact-visible.txt', await result.innerText());
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.exportSave()), beforeAssessment, 'Assessment must not mutate any save bytes');
  await capture('actual-E-market-and-building-impact', 'Original market door fixture + actual E + actual UI assessment click. Read-only planning result, no demolition, road construction or relocation.', settled);
  receipt.status = errors.length ? 'FAIL' : 'PASS_TECHNICAL_AND_READONLY_UI';
} catch (error) { errors.push({ scope: 'fatal', message: error.message, stack: error.stack }); receipt.status = 'FAIL'; console.error(error.stack); }
finally {
  if (browser) await browser.close().catch(e => errors.push({ scope: 'browser-cleanup', message: e.message }));
  if (server && serverIdentity) { const now = await identity(server.pid); if (now?.ticks === serverIdentity.ticks && now.parent === process.pid && now.state !== 'Z') server.kill('SIGTERM'); }
  await put('preview.stdout-stderr.txt', startup); receipt.endedAt = new Date().toISOString(); receipt.errors = errors;
  await put('RESULTS.json', receipt); console.log(JSON.stringify({ status: receipt.status, shots: receipt.captures.length, errors: errors.length })); process.exitCode = errors.length ? 1 : 0;
}
