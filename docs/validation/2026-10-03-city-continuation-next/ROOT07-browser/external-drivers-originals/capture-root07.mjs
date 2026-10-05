// Prepared only. Requires ROOT07 source and explicit execution authorization.
// All PNG bytes come directly from Playwright screenshots of the production app.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';

const [sourceArg, outputArg, authorizationArg] = process.argv.slice(2);
assert(sourceArg && outputArg && authorizationArg, 'Usage: node capture-root07.mjs SOURCE NEW_OUTPUT AUTHORIZATION.json');
const source = path.resolve(sourceArg), out = path.resolve(outputArg);
assert(!source.split(path.sep).some(part => /root06/i.test(part)), 'ROOT06 is immutable DRAFT and must not execute');
const authorization = JSON.parse(await readFile(path.resolve(authorizationArg), 'utf8'));
assert.equal(authorization.status, 'ROOT07_BROWSER_EXECUTION_AUTHORIZED');
assert.equal(path.resolve(authorization.sourcePath), source);
assert.equal(authorization.scope, 'ROOT07');
assert.equal(authorization.exclusiveGPU, true);
assert(source.startsWith('/workspace/yunshan-work/'), 'Use only the root-provided isolated ROOT07 workspace');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function inputHashes() {
  const rows = {};
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const full = path.join(dir, name), stat = await lstat(full);
      assert(!stat.isSymbolicLink(), 'Unexpected input symlink: ' + path.relative(source, full));
      if (stat.isDirectory()) await walk(full);
      else if (stat.isFile()) rows[path.relative(source, full)] = sha(await readFile(full));
    }
  }
  for (const directory of ['src', 'tests', 'scripts', 'adapters', 'public']) {
    try { await walk(path.join(source, directory)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html']) {
    try { const stat = await lstat(path.join(source, name)); assert(stat.isFile() && !stat.isSymbolicLink()); rows[name] = sha(await readFile(path.join(source, name))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return rows;
}
const before = await inputHashes();
assert.deepEqual(before, authorization.inputs, 'ROOT07 execution inputs must equal the authorized frozen manifest');
await mkdir(out, { recursive: false });
const require = createRequire(path.join(source, 'package.json'));
const { chromium } = await import(require.resolve('playwright-core'));
const html = await readFile(path.join(source, 'dist/index.html'), 'utf8');
const entry = html.match(/src="([^"]+\.js)"/)?.[1]; assert(entry);
const buildSHA256 = sha(await readFile(path.join(source, 'dist', entry.replace(/^\//, ''))));
const port = 4197;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '', browser, page, opening, failure;
const errors = [], consoleRows = [], captures = [];
server.stdout.on('data', bytes => { serverOutput += bytes; });
server.stderr.on('data', bytes => { serverOutput += bytes; });
const fixedEye = [-330, 53.2575, 487];
const fixedQuaternion = [-0.024191989150678845, -0.25171716574181724, -0.006294240498289998, 0.9674779577170685];
const shots = [
  { name: 'spawn-day', hour: 15.5, eye: fixedEye, quaternion: fixedQuaternion },
  { name: 'spawn-night', hour: 22, eye: fixedEye, quaternion: fixedQuaternion },
  { name: 'overview-day', hour: 15.5, eye: [1780, 1040, 2040], target: [0, 180, 0] },
  { name: 'core-waterfall', hour: 12, eye: [440, 325, 640], target: [210, 215, -45] },
  { name: 'market-street', hour: 12, districtId: 'market', kind: 'market' },
  { name: 'residential-first-person', hour: 12, districtId: 'west', kind: 'home' },
  { name: 'commercial-skyline', hour: 15.5, commercial: true },
  { name: 'commercial-ground-bank-reception', hour: 12, reception: true },
  { name: 'commercial-first-office-floor', hour: 12, office: true },
];
const scope = 'Controlled optical inspection of the actual ROOT07 production scene, Linux Chromium SwiftShader. Six fixed poses retain the earlier recovery coordinates. Three additional views derive from actual commercial buildings. Simulation is paused and controller frame stepping is pinned only in this isolated diagnostic page. Bank/office entry invokes the unchanged production interaction from a declared controlled door station; floor station is a declared actual accessible service/work point. No native walk from spawn, climb, banking transaction, paid work, occupancy, Mac hardware, FPS, or ART acceptance is inferred.';
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error('Owned strict-port preview failed: ' + serverOutput);
    if (serverOutput.includes(`http://127.0.0.1:${port}`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (attempt === 99) throw Error('Owned preview startup marker missing');
  }
  const response = await fetch(`http://127.0.0.1:${port}/`); assert(response.ok);
  assert.equal((await response.text()).match(/src="([^"]+\.js)"/)?.[1], entry);
  const servedBundle = await fetch(`http://127.0.0.1:${port}${entry}`); assert(servedBundle.ok);
  assert.equal(sha(Buffer.from(await servedBundle.arrayBuffer())), buildSHA256);
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page = await context.newPage(); page.setDefaultTimeout(120_000);
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { const row = { type: message.type(), message: message.text(), location: message.location() }; consoleRows.push(row); if (row.type === 'error') errors.push(row); });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForFunction(() => window.__YUNSHAN__?.simulation.state.tick >= 1, null, { timeout: 120_000 });
  opening = await page.evaluate(() => {
    const d = window.__YUNSHAN__;
    const record = { eye: d.city.camera.position.toArray(), quaternion: d.city.camera.quaternion.toArray(), spawn: { ...d.world.spawn }, player: { ...d.simulation.state.player.position }, layoutVersion: d.world.layoutVersion, seed: d.world.seed, worldBuildings: d.world.buildings.length, citizens: d.simulation.state.citizens.length };
    d.actions.command({ type: 'pause', value: 1 }); d.actions.setQuality('balanced');
    // Controlled optical page only; original DOM/WebGL scripts run fresh contexts.
    d.controller.step = () => {}; d.controller.stepWalkingFrame = () => {};
    return record;
  });
  assert.equal(opening.layoutVersion, 'current-v6', 'Fresh ROOT07 must actually use v6');
  for (const shot of shots) {
    const result = await page.evaluate(shot => {
      const d = window.__YUNSHAN__;
      let eye = shot.eye, target = shot.target ?? null, buildingId = null, officeSetup = null;
      const towers = d.world.buildings.filter(b => b.commercialGeometryRevision === 1).sort((a, b) => a.id.localeCompare(b.id));
      const towerMetadata = towers.map(b => ({ id: b.id, name: b.name, kind: b.kind, districtId: b.districtId, position: { ...b.position }, door: { ...b.door }, width: b.width, depth: b.depth, height: b.height, floors: b.floors, commercialGeometryRevision: b.commercialGeometryRevision, commercialRouteRevision: b.commercialRouteRevision, floorPlanProfile: b.floorPlanProfile, floorUses: b.floorUses, floorPermissions: b.floorPermissions }));
      if (shot.districtId) {
        const b = d.world.buildings.find(b => b.districtId === shot.districtId && b.kind === shot.kind && !b.facility) ?? d.world.buildings.find(b => b.kind === shot.kind);
        if (!b) throw Error('Missing actual fixed-pose building: ' + shot.name);
        buildingId = b.id; eye = [b.door.x + 5, b.door.y + 1.72, b.door.z + 18]; target = [b.position.x, b.position.y + 4, b.position.z];
      }
      if (shot.commercial) {
        if (towers.length !== 5 || towers.some(b => b.kind !== 'bank' || b.districtId !== 'market')) throw Error('Expected five actual v6 bank towers');
        const minX = Math.min(...towers.map(b => b.position.x - b.width / 2)), maxX = Math.max(...towers.map(b => b.position.x + b.width / 2));
        const minZ = Math.min(...towers.map(b => b.position.z - b.depth / 2)), maxZ = Math.max(...towers.map(b => b.position.z + b.depth / 2));
        const bottom = Math.min(...towers.map(b => b.position.y)), top = Math.max(...towers.map(b => b.position.y + b.height));
        const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, span = Math.max(maxX - minX, maxZ - minZ, top - bottom);
        target = [cx, bottom + (top - bottom) * .5, cz];
        eye = [cx + span * 1.3, bottom + (top - bottom) * .8 + span * .3, cz + span * 1.6];
      }
      if (shot.office || shot.reception) {
        const floor = shot.reception ? 0 : 2, purpose = shot.reception ? 'service' : 'work';
        const b = towers.find(b => (b.functionPoints ?? []).some(p => p.floor === floor && p.purpose === purpose && d.canAccessBuilding(b, p.floor) && d.simulation.isAtBuildingFunctionPoint(b, p.position, p.purpose)));
        if (!b) throw Error('No actual publicly accessible bank/office floor: ' + floor);
        buildingId = b.id;
        const before = { money: d.simulation.state.player.money, role: d.simulation.state.player.role, identities: JSON.stringify(d.simulation.state.player.identities ?? null), position: { ...d.simulation.state.player.position } };
        const outside = { ...b.door, z: b.door.z + 2 };
        d.simulation.state.player.position = outside; d.controller.setMode('walk', outside);
        d.actions.interact();
        const entryResult = { inside: d.getView().inside, insideId: d.controller.inside?.id ?? null, floor: d.controller.floor, position: { ...d.controller.position }, notice: d.getView().notice };
        if (!entryResult.inside || entryResult.insideId !== b.id || entryResult.floor !== 0) throw Error('Unchanged actual bank door interaction did not enter ground floor');
        const points = b.functionPoints.filter(p => p.floor === floor && p.purpose === purpose && d.canAccessBuilding(b, p.floor) && d.simulation.isAtBuildingFunctionPoint(b, p.position, p.purpose));
        points.sort((a, z) => Number(z.id.includes(':office-east:')) - Number(a.id.includes(':office-east:')) || a.id.localeCompare(z.id));
        const point = points[0];
        d.simulation.state.player.position = { ...point.position }; d.controller.setMode('walk', point.position);
        if (d.controller.inside?.id !== b.id || d.controller.floor !== point.floor || !d.canAccessBuilding(b, point.floor) || !d.simulation.isAtBuildingFunctionPoint(b, d.simulation.state.player.position, purpose)) throw Error('Bank/office station lacks actual room support, permission or function-point range');
        const after = { money: d.simulation.state.player.money, role: d.simulation.state.player.role, identities: JSON.stringify(d.simulation.state.player.identities ?? null), position: { ...d.controller.position } };
        if (before.money !== after.money || before.role !== after.role || before.identities !== after.identities) throw Error('Optical setup must not mutate cash or identity');
        // Natural production interior handling after a real supported controller station.
        d.city.setInterior(b.id, point.floor);
        eye = d.city.camera.position.toArray();
        target = [point.position.x, point.position.y + .7, point.position.z - 1.5];
        officeSetup = { scope: 'Controlled original exterior-door station and actual interact(), followed by controlled accessible service/work-point station; no native W climb, banking transaction or paid work claim', caption: shot.reception ? '真实银行接待厅：floor 0／中文一层；现有存取款界面按原资格与现金规则提供，截图未执行交易。' : '真实第一办公楼层：floor 2／中文三层；原钱庄记账结算用途与真实 work 功能点。', before, outside, entryResult, point, after, floorIndex: point.floor, chineseFloorNumber: point.floor + 1, floorUse: b.floorUses?.[point.floor], permission: b.floorPermissions?.[point.floor], accessible: d.canAccessBuilding(b, point.floor), controllerInsideId: d.controller.inside.id, controllerFloor: d.controller.floor, bankBalance: d.simulation.state.bankBalance };
      }
      d.actions.command({ type: 'setTime', value: shot.hour });
      d.city.camera.position.set(...eye); d.city.camera.fov = 48; d.city.camera.updateProjectionMatrix();
      if (shot.quaternion) d.city.camera.quaternion.set(...shot.quaternion); else d.city.camera.lookAt(...target);
      d.city.update(d.simulation.state, 0); d.city.render();
      return { name: shot.name, hour: shot.hour, eye: d.city.camera.position.toArray(), target, quaternion: d.city.camera.quaternion.toArray(), fov: d.city.camera.fov, buildingId, officeSetup, towers: towerMetadata, controllerPosition: { ...d.controller.position }, controllerInsideId: d.controller.inside?.id ?? null, controllerFloor: d.controller.floor, layoutVersion: d.world.layoutVersion, tick: d.simulation.state.tick };
    }, shot);
    await page.waitForTimeout(350);
    const screenshotPath = path.join(out, shot.name + '.png');
    const preScreenshot = await page.evaluate(() => { const d = window.__YUNSHAN__, r = d.city.renderer.info; return { camera: { eye: d.city.camera.position.toArray(), quaternion: d.city.camera.quaternion.toArray(), fov: d.city.camera.fov }, drawCalls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, resolutionScale: d.city.resolutionScale, canvasWidth: d.city.renderer.domElement.width, canvasHeight: d.city.renderer.domElement.height }; });
    assert.deepEqual(preScreenshot.camera.eye, result.eye); assert.deepEqual(preScreenshot.camera.quaternion, result.quaternion);
    await page.screenshot({ path: screenshotPath, timeout: 120_000 });
    const postScreenshot = await page.evaluate(() => { const d = window.__YUNSHAN__; return { resolutionScale: d.city.resolutionScale, eye: d.city.camera.position.toArray(), quaternion: d.city.camera.quaternion.toArray(), lights: d.city.scene.children.filter(item => item.isLight).map(light => ({ type: light.type, intensity: light.intensity, color: light.color.getHexString() })), bankingControls: [...document.querySelectorAll('button[data-bank]')].map(item => ({ bankCommand: item.dataset.bank, targetId: item.dataset.target, text: item.textContent, disabled: item.disabled })), qualifications: { role: d.simulation.state.player.role, identities: d.simulation.state.player.identities ?? [], money: d.simulation.state.player.money, bankBalance: d.simulation.state.bankBalance } }; });
    assert.deepEqual(postScreenshot.eye, result.eye); assert.deepEqual(postScreenshot.quaternion, result.quaternion);
    const bytes = await readFile(screenshotPath);
    const caption = result.officeSetup?.caption ?? (shot.commercial ? '真实五座商业银行高楼的受控光学天际线；相机取自实际楼栋包围范围，不代表原生步行旅程。' : '原六机位之一：' + shot.name + '；真实生产 renderer 的固定相机视角，不代表原生步行旅程。');
    const row = { ...result, caption, preScreenshot, postScreenshot, pngPath: screenshotPath, pngBytes: bytes.length, pngSHA256: sha(bytes), scope };
    captures.push(row); await writeFile(path.join(out, shot.name + '.metadata.json'), JSON.stringify(row, null, 2) + '\n');
    console.log('Captured actual production PNG: ' + shot.name);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await inputHashes(), before, 'ROOT07 source changed during controlled capture');
} catch (error) {
  failure = String(error);
  if (page) await page.screenshot({ path: path.join(out, 'capture-failure.png'), timeout: 30_000 }).catch(() => {});
} finally {
  await browser?.close().catch(error => { errors.push({ type: 'browser-close', message: String(error) }); });
  server.kill('SIGTERM');
  if (server.exitCode === null) await Promise.race([new Promise(resolve => server.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  const after = await inputHashes();
  const status = !failure && !errors.length && captures.length === shots.length && JSON.stringify(before) === JSON.stringify(after) ? 'PASS' : 'FAIL';
  await writeFile(path.join(out, 'preview-raw.log'), serverOutput);
  await writeFile(path.join(out, 'console-raw.json'), JSON.stringify(consoleRows, null, 2) + '\n');
  await writeFile(path.join(out, 'capture-results.json'), JSON.stringify({ status, failure, preparedDriver: fileURLToPath(import.meta.url), driverSHA256: sha(await readFile(fileURLToPath(import.meta.url))), sourceRoot: source, authorizationSHA256: sha(await readFile(path.resolve(authorizationArg))), entry, buildSHA256, sourceHashes: before, sourceHashesAfter: after, viewport: [1440, 900], deviceScaleFactor: 1, scope, opening, captures, errors, previewPid: server.pid, previewExitCode: server.exitCode, ART: 'FAIL_REFERENCE_GAPS_REMAIN_UNTIL_VISUALLY_REVIEWED', Mac: 'NOT_RUN' }, null, 2) + '\n');
  if (status !== 'PASS') process.exitCode = 1;
}
