// Focused spatial/appearance diagnostics use real rendered entities and W input.
// Initial body placement is a test fixture; this is not a normal-player journey.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import * as THREE from 'three';

const directory = 'artifacts/space-browser', port = Number(process.env.YUNSHAN_SPACE_BROWSER_PORT ?? 4185), origin = `http://127.0.0.1:${port}`;
const spatial = process.env.YUNSHAN_SPACE_SCENARIOS !== 'npc';
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceHashes = async () => Object.fromEntries(await Promise.all((await readdir('src', { recursive: true })).filter(path => /\.(ts|css)$/.test(path)).sort().map(async path => [`src/${path}`, hash(await readFile(`src/${path}`))])));
let server, browser, page, output = '', buildEntry, buildHash, hashes;
const errors = [], results = [], skipped = [];
const check = (name, data) => { results.push({ name, ...data }); console.log(`PASS ${name} ${JSON.stringify(data)}`); };
const nextRenderedFrame = (currentPage, frame) => currentPage.waitForFunction(frame => window.__YUNSHAN__.city.renderer.info.render.frame > frame, frame, { timeout: 60_000 });
const telemetry = currentPage => currentPage.evaluate(() => {
  const d = window.__YUNSHAN__, pool = d.city.scene.getObjectByName('真实居民 · 衣饰步态与生命状态');
  return { tick: d.simulation.state.tick, paused: d.simulation.state.paused, feet: d.controller.walkingPosition, eye: { x: d.city.camera.position.x, y: d.city.camera.position.y, z: d.city.camera.position.z }, mode: d.controller.mode, inside: d.controller.inside?.id ?? null, fps: d.getView().fps, drawCalls: d.city.renderer.info.render.calls, triangles: d.city.renderer.info.render.triangles, quality: d.getView().quality, renderDistance: d.getView().renderDistance, npcBudget: pool?.userData.budget ?? null };
});
async function renderedBoxRay(currentPage, point, direction, far) {
  const boxes = await currentPage.evaluate(({ point, far }) => {
    const { city } = window.__YUNSHAN__, groups = [];
    city.scene.updateMatrixWorld(true);
    city.scene.traverse(mesh => {
      if (!mesh.isInstancedMesh || mesh.geometry.type !== 'BoxGeometry') return;
      for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible) return;
      const dimensions = mesh.geometry.parameters, matrices = [];
      const matrix = mesh.matrixWorld.clone();
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix); const global = mesh.matrixWorld.clone().multiply(matrix), elements = global.elements;
        const radius = Math.hypot(...elements.slice(0, 3)) * dimensions.width / 2 + Math.hypot(...elements.slice(4, 7)) * dimensions.height / 2 + Math.hypot(...elements.slice(8, 11)) * dimensions.depth / 2;
        if (radius > 0 && Math.hypot(elements[12] - point.x, elements[13] - point.y, elements[14] - point.z) <= radius + far) matrices.push({ index, elements });
      }
      if (matrices.length) groups.push({ name: mesh.name, dimensions, matrices });
    });
    return groups;
  }, { point, far });
  const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const ray = new THREE.Raycaster(new THREE.Vector3(point.x, point.y, point.z), new THREE.Vector3(direction.x, direction.y, direction.z).normalize(), .01, far);
  const geometries = [];
  for (const group of boxes) {
    const geometry = new THREE.BoxGeometry(group.dimensions.width, group.dimensions.height, group.dimensions.depth); geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, group.matrices.length); mesh.name = group.name; mesh.userData.originalIndices = group.matrices.map(row => row.index);
    group.matrices.forEach((row, index) => mesh.setMatrixAt(index, new THREE.Matrix4().fromArray(row.elements))); scene.add(mesh);
  }
  scene.updateMatrixWorld(true);
  const hits = ray.intersectObjects(scene.children, false).slice(0, 8).map(hit => ({ name: hit.object.name, instanceId: hit.instanceId, originalInstanceId: hit.object.userData.originalIndices[hit.instanceId], distance: hit.distance, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } }));
  geometries.forEach(geometry => geometry.dispose()); material.dispose(); scene.children.forEach(mesh => mesh.dispose());
  return { origin: point, direction, far, submittedBoxInstances: boxes.reduce((sum, group) => sum + group.matrices.length, 0), hits };
}
try {
  await mkdir(directory, { recursive: true }); hashes = await sourceHashes();
  buildEntry = (await readFile('dist/index.html', 'utf8')).match(/src="([^"]+\.js)"/)?.[1]; assert(buildEntry);
  if (process.env.YUNSHAN_EXPECTED_BUILD_ENTRY) assert.equal(buildEntry, process.env.YUNSHAN_EXPECTED_BUILD_ENTRY);
  buildHash = hash(await readFile(`dist${buildEntry}`));
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error(`Own preview failed: ${output}`);
    if (output.includes(origin)) break;
    await new Promise(resolve => setTimeout(resolve, 100)); if (attempt === 99) throw Error(`Own preview startup marker absent: ${output}`);
  }
  assert.equal((await (await fetch(origin)).text()).match(/src="([^"]+\.js)"/)?.[1], buildEntry);
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(120_000);
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`.trim()); });
  await page.goto(`${origin}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__YUNSHAN__?.simulation.state.tick >= 1, null, { timeout: 120_000 });
  const welcome = page.locator('[data-action="dismiss-welcome"]');
  if (await welcome.isVisible()) { await welcome.focus(); await page.keyboard.press('Enter'); }
  if (spatial) {
  const bridge = await page.evaluate(() => {
    const d = window.__YUNSHAN__, edge = d.world.edges.find(edge => edge.id === 'bridge-river-dock-river-station');
    d.actions.command({ type: 'pause', value: 1 }); d.actions.command({ type: 'setTime', value: 12 });
    d.actions.setQuality('balanced'); d.actions.setSetting('renderDistance', 5700);
    const from = edge.points.find(point => point.z === 1040 && point.x <= -626 && point.x >= -627), to = edge.points.find(point => point.z === 1040 && point.x <= -648 && point.x >= -649);
    if (!from || !to) throw Error('Current bridge lacks the expected actual centreline segment');
    const start = { x: -638, y: from.y + (to.y - from.y) * (-638 - from.x) / (to.x - from.x), z: 1040 };
    d.simulation.state.player.position = { ...start }; d.controller.yaw = Math.PI / 2; d.controller.setMode('walk', start);
    return { edgeId: edge.id, from, to, start, crossing: { x: -664, z: 1040 }, frame: d.city.renderer.info.render.frame };
  });
  await nextRenderedFrame(page, bridge.frame);
  const before = await telemetry(page); assert(Math.abs(before.feet.y - bridge.start.y) < .01); assert(Math.abs(before.eye.y - before.feet.y - 1.72) < .01);
  const ray = await renderedBoxRay(page, before.eye, { x: -1, y: 0, z: 0 }, 45); await writeFile(`${directory}/bridge-rendered-ray.json`, JSON.stringify(ray, null, 2));
  assert.equal(ray.hits.length, 0, `Actual rendered box blocks the eye line: ${JSON.stringify(ray.hits)}`);
  await page.screenshot({ path: `${directory}/bridge-before.png`, timeout: 120_000 });
  const started = Date.now(); await page.keyboard.down('KeyW');
  try { await page.waitForFunction(start => window.__YUNSHAN__.controller.walkingPosition.x < start.x - 50, bridge.start, { timeout: 60_000 }); }
  finally { await page.keyboard.up('KeyW'); }
  const after = await telemetry(page), metres = Math.hypot(after.feet.x - before.feet.x, after.feet.z - before.feet.z);
  assert(metres >= 50); assert(before.feet.x > -664 && after.feet.x < -664); assert(Math.abs(after.feet.z - 1040) < .1); assert(Math.abs(after.feet.y - bridge.start.y) < .1); assert(Math.abs(after.eye.y - after.feet.y - 1.72) < .01);
  assert.equal(after.mode, 'walk'); assert.equal(after.tick, before.tick);
  await page.screenshot({ path: `${directory}/bridge-after.png`, timeout: 120_000 });
  check('normal W input crosses the repaired road intersection for over 50m at actual body and eye heights', { bridge, before, after, metres, wallSeconds: (Date.now() - started) / 1000, renderedEyeRay: ray });

  const road = await page.evaluate(() => {
    const d = window.__YUNSHAN__, edge = d.world.edges.find(edge => edge.id === 'road-river-quarter-3-river-station');
    const a = edge?.points.find(point => point.x === -664 && point.z === 1032), b = edge?.points.find(point => point.x === -664 && point.z === 1056);
    if (!a || !b) throw Error('Current road lacks the actual same-grade crossing segment');
    const start = { ...a }, end = { x: a.x, y: a.y + (b.y - a.y) * 20 / (b.z - a.z), z: a.z + 20 };
    d.simulation.state.player.position = { ...start }; d.controller.yaw = Math.PI; d.controller.setMode('walk', start);
    return { edgeId: edge.id, a, b, start, end, crossing: { x: -664, z: 1040 }, frame: d.city.renderer.info.render.frame };
  });
  await nextRenderedFrame(page, road.frame);
  const roadBefore = await telemetry(page);
  const roadRay = await renderedBoxRay(page, { ...roadBefore.feet, y: roadBefore.feet.y + .9 }, { x: 0, y: 0, z: 1 }, 20);
  await writeFile(`${directory}/road-crossing-rendered-ray.json`, JSON.stringify(roadRay, null, 2));
  assert.equal(roadRay.hits.length, 0, `Actual rendered guard/post blocks the crossing body line: ${JSON.stringify(roadRay.hits)}`);
  await page.screenshot({ path: `${directory}/road-crossing-before.png`, timeout: 120_000 });
  const roadStarted = Date.now(); await page.keyboard.down('KeyW');
  try { await page.waitForFunction(end => window.__YUNSHAN__.controller.walkingPosition.z >= end.z, road.end, { timeout: 60_000 }); }
  finally { await page.keyboard.up('KeyW'); }
  const roadAfter = await telemetry(page), roadMetres = Math.hypot(roadAfter.feet.x - roadBefore.feet.x, roadAfter.feet.z - roadBefore.feet.z);
  assert(roadMetres >= 20); assert(roadBefore.feet.z < 1035.9 && roadAfter.feet.z > 1044.1);
  assert(Math.abs(roadAfter.feet.x + 664) < .1); assert(Math.abs(roadAfter.feet.y - road.end.y) < .1); assert(Math.abs(roadAfter.eye.y - roadAfter.feet.y - 1.72) < .01);
  assert.equal(roadAfter.tick, roadBefore.tick); assert.equal(roadAfter.mode, 'walk');
  await page.screenshot({ path: `${directory}/road-crossing-after.png`, timeout: 120_000 });
  check('normal W input enters and exits both actual bridge side openings along the same-grade public road', { road, before: roadBefore, after: roadAfter, metres: roadMetres, wallSeconds: (Date.now() - roadStarted) / 1000, renderedBodyRay: roadRay });

  // Turn the existing body and walk back; no second placement or speed change.
  await page.evaluate(() => { const d = window.__YUNSHAN__; d.controller.yaw = 0; d.controller.setMode('walk', d.controller.walkingPosition); });
  const returnBefore = await telemetry(page), returnStarted = Date.now(); await page.keyboard.down('KeyW');
  try { await page.waitForFunction(start => window.__YUNSHAN__.controller.walkingPosition.z <= start.z, road.start, { timeout: 60_000 }); }
  finally { await page.keyboard.up('KeyW'); }
  const returned = await telemetry(page), returnMetres = Math.hypot(returned.feet.x - returnBefore.feet.x, returned.feet.z - returnBefore.feet.z);
  assert(returnMetres >= 20); assert(returnBefore.feet.z > 1044.1 && returned.feet.z < 1035.9);
  assert(Math.abs(returned.feet.x + 664) < .1); assert(Math.abs(returned.feet.y - road.start.y) < .1); assert(Math.abs(returned.eye.y - returned.feet.y - 1.72) < .01);
  assert.equal(returned.tick, returnBefore.tick); assert.equal(returned.mode, 'walk');
  await page.screenshot({ path: `${directory}/road-crossing-returned.png`, timeout: 120_000 });
  check('normal W input walks the same body back through both actual side openings at the original walking speed', { before: returnBefore, after: returned, metres: returnMetres, wallSeconds: (Date.now() - returnStarted) / 1000 });
  }

  await page.evaluate(() => { const d = window.__YUNSHAN__; d.actions.command({ type: 'pause', value: 1 }); d.actions.command({ type: 'setTime', value: 12 }); d.actions.setQuality('balanced'); d.actions.setSetting('renderDistance', 5700); });
  const actualAges = await page.evaluate(() => window.__YUNSHAN__.simulation.state.citizens.map(citizen => { const profile = window.__YUNSHAN__.simulation.state.extension.actorProfiles[citizen.id]; return { id: citizen.id, age: profile.age, alive: profile.alive, tier: citizen.tier }; }));
  const hasChild = actualAges.some(profile => profile.alive && profile.tier !== 'statistical' && profile.age >= 6 && profile.age < 18);
  if (!hasChild) skipped.push({ check: 'actual child near appearance', reason: 'No actual renderable 6–17-year-old resident exists in this city snapshot; no age or citizen state was changed.', minActualAge: Math.min(...actualAges.filter(profile => profile.alive).map(profile => profile.age)) });
  for (const group of ['adult', ...(hasChild ? ['child'] : []), 'elder']) {
    const person = await page.evaluate(group => {
      const d = window.__YUNSHAN__, state = d.simulation.state;
      const candidates = state.citizens.filter(citizen => { const profile = state.extension.actorProfiles[citizen.id]; return profile.alive && citizen.tier !== 'statistical' && (group === 'child' ? profile.age >= 6 && profile.age < 18 : group === 'elder' ? profile.age >= 62 : profile.age >= 18 && profile.age < 62); });
      const citizen = candidates.sort((a, b) => Math.hypot(a.position.x - d.world.spawn.x, a.position.z - d.world.spawn.z) - Math.hypot(b.position.x - d.world.spawn.x, b.position.z - d.world.spawn.z))[0];
      if (!citizen) throw Error(`No actual ${group} resident`);
      const target = { ...citizen.position, y: citizen.position.y + (group === 'child' ? .7 : .95) }, player = { ...citizen.position, x: citizen.position.x + 3, z: citizen.position.z + 2.5 };
      d.simulation.state.player.position = { ...player }; d.controller.setMode('walk', player); d.city.camera.lookAt(target.x, target.y, target.z);
      return { id: citizen.id, name: citizen.name, age: state.extension.actorProfiles[citizen.id].age, role: citizen.role, position: { ...citizen.position }, state: citizen.state, player, frame: d.city.renderer.info.render.frame };
    }, group);
    await nextRenderedFrame(page, person.frame);
    const front = await page.evaluate(person => {
      const d = window.__YUNSHAN__, pool = d.city.scene.getObjectByName('真实居民 · 衣饰步态与生命状态'), faces = pool?.children.find(mesh => mesh.name === '居民 · 近景面孔彩绘合批');
      if (!faces) throw Error('Actual face pool is absent');
      const height = person.age < 2 ? .6 : person.age < 6 ? 1 : person.age < 12 ? 1.2 : person.age < 18 ? 1.6 : 1.8;
      const matrix = faces.matrixWorld.clone(); let head, distance = Infinity;
      for (let index = 0; index < faces.count; index++) {
        faces.getMatrixAt(index, matrix); const e = matrix.elements, delta = Math.hypot(e[12] - person.position.x, e[13] - person.position.y - height + .1, e[14] - person.position.z);
        if (delta < distance) { distance = delta; head = Array.from(e); }
      }
      if (distance > .25) throw Error(`Actual selected resident head is not rendered: ${distance}`);
      const length = Math.hypot(head[8], head[10]), heading = { x: head[8] / length, z: head[10] / length };
      const player = { x: person.position.x + heading.x * 3.2 + heading.z * .7, y: person.position.y, z: person.position.z + heading.z * 3.2 - heading.x * .7 };
      d.simulation.state.player.position = { ...player }; d.controller.setMode('walk', player); d.city.camera.lookAt(person.position.x, person.position.y + height * .62, person.position.z);
      return { heading, player, actualHeadMatrix: head, frame: d.city.renderer.info.render.frame };
    }, person);
    await nextRenderedFrame(page, front.frame);
    await page.waitForFunction(() => (window.__YUNSHAN__.city.scene.getObjectByName('真实居民 · 衣饰步态与生命状态')?.userData.budget.faceInstances ?? 0) > 0, null, { timeout: 60_000 });
    const capture = await telemetry(page);
    const posed = await page.evaluate(() => { const d = window.__YUNSHAN__, pool = d.city.scene.getObjectByName('真实居民 · 衣饰步态与生命状态'); return { people: d.simulation.state.citizens.map(c => [c.id, c.position, c.state]), matrices: pool.children.map(mesh => Array.from(mesh.instanceMatrix.array).slice(0, mesh.count * 16)) }; });
    await page.screenshot({ path: `${directory}/npc-${group}.png`, timeout: 120_000 });
    await page.waitForTimeout(1500);
    const held = await page.evaluate(() => { const d = window.__YUNSHAN__, pool = d.city.scene.getObjectByName('真实居民 · 衣饰步态与生命状态'); return { people: d.simulation.state.citizens.map(c => [c.id, c.position, c.state]), matrices: pool.children.map(mesh => Array.from(mesh.instanceMatrix.array).slice(0, mesh.count * 16)) }; });
    assert.deepEqual(held, posed, 'Paused actual residents must keep the same positions and poses'); assert(capture.npcBudget.drawCalls <= 2); assert(capture.npcBudget.faceInstances > 0);
    check(`actual ${group} resident has a near face and clothes, with a stable paused pose in two shared draws`, { person, front, capture, poseSHA256: hash(JSON.stringify(posed)) });
  }
  assert.deepEqual(await sourceHashes(), hashes); assert.equal(hash(await readFile(`dist${buildEntry}`)), buildHash); assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(`${directory}/results.json`, JSON.stringify({ status: skipped.length ? 'passed-with-unavailable-child-fixture' : 'passed', scope: 'Linux Chromium SwiftShader; diagnostic initial placement only, real W movement and real citizen data; no normal journey or macOS performance claim', spatial, buildEntry, buildHash, sourceHashes: hashes, checks: results.length, results, skipped, errors }, null, 2));
} catch (error) {
  console.error(error); await page?.screenshot({ path: `${directory}/failure.png`, timeout: 120_000 }).catch(() => {});
  await writeFile(`${directory}/results.json`, JSON.stringify({ status: 'failed', buildEntry, buildHash, sourceHashes: hashes, checks: results.length, results, errors, error: String(error), preview: output }, null, 2)); process.exitCode = 1;
} finally { await browser?.close(); server?.kill('SIGTERM'); }
