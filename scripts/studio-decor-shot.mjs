// Real-browser check that display-only studio décor (studioDecorPlacements)
// loads and draws inside rooms. Writes artifacts/studio-decor-*.png and a JSON report.
// Software WebGL here is a functional check only, not performance evidence.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4331;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let browser; const errors = [], report = {};
try {
  await mkdir('artifacts', { recursive: true });
  for (let i = 0; !output.includes(`127.0.0.1:${port}`); i++) { if (i > 100 || server.exitCode !== null) throw new Error(output); await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForFunction(() => window.__YUNSHAN__?.simulation?.state?.tick >= 1, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 楼层设施模型')?.userData.studioAssets, null, { timeout: 120_000 });
  report.assets = await page.evaluate(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 楼层设施模型').userData.studioAssets);
  const FIXTURE_ASSETS = ['LIFE-064', 'LIFE-032', 'LIFE-151', 'LIFE-111', 'LIFE-028', 'LIFE-072', 'LIFE-119', 'LIFE-106', 'LIFE-171', 'LIFE-020'];
  for (const kind of ['home', 'market', 'clinic', 'hall']) {
    report[kind] = await page.evaluate(kind => {
      const { world, simulation, controller, actions, getView } = window.__YUNSHAN__;
      actions.command({ type: 'setTime', value: 12 });
      const building = world.buildings.filter(b => b.kind === kind)[1];
      simulation.state.player.position = { ...building.door, z: building.door.z + 2 };
      controller.setMode('walk', simulation.state.player.position);
      actions.interact();
      return { id: building.id, inside: getView().inside };
    }, kind);
    await page.waitForTimeout(8000);
    // Stand 2.2m in front of the first ground-floor room décor of this building (from the pool's own placements) and look at it.
    report[`${kind}-aim`] = await page.evaluate(id => {
      const { city, world, controller, simulation } = window.__YUNSHAN__, pool = city.studioProps, b = world.buildings.find(x => x.id === id);
      const list = pool.placements.get(id) ?? [], p = list.find(q => q.fixtureId.startsWith('decor:0:') && q.fixtureId.endsWith(':base') && !q.asset.startsWith('ENV-'));
      if (!p) return { error: 'no ground-floor décor', count: list.length };
      const bounds = pool.draws.get(p.asset).asset.boundsM, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const mx = (bounds.min[0] + bounds.max[0]) / 2, mz = (bounds.min[2] + bounds.max[2]) / 2;
      const local = { x: p.local.x + mx * c + mz * s, z: p.local.z - mx * s + mz * c }, front = { x: local.x + s * 2.4, z: local.z + c * 2.4 };
      const toWorld = q => { const cr = Math.cos(b.rotation), sr = Math.sin(b.rotation); return { x: b.position.x + q.x * cr + q.z * sr, z: b.position.z - q.x * sr + q.z * cr }; };
      const target = toWorld(local), feetXZ = toWorld(front), feet = { x: feetXZ.x, y: b.position.y + .6 + p.local.y - bounds.min[1] * 0, z: feetXZ.z };
      feet.y = simulation.state.player.position.y;
      simulation.state.player.position = { ...feet }; controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
      controller.yaw = Math.atan2(-(target.x - feet.x), -(target.z - feet.z)); controller.pitch = -0.35; controller['orient']();
      return { asset: p.asset, fixtureId: p.fixtureId, feet, target };
    }, report[kind].id);
    // Software WebGL renders ~1 frame per screenshot: the first frame updates the pools for the new view, the second shows it.
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `artifacts/studio-decor-${kind}.png`, timeout: 180_000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `artifacts/studio-decor-${kind}.png`, timeout: 180_000 });
    report[`${kind}-instances`] = await page.evaluate(asset => {
      const { city, controller } = window.__YUNSHAN__, pool = city.studioProps, draw = asset && pool.draws.get(asset); if (!draw) return null;
      const M = new controller.camera.matrix.constructor(), out = [];
      for (const { mesh } of draw.meshes.slice(0, 1)) for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, M); out.push(M.elements.slice(12, 15).map(v => Math.round(v * 100) / 100)); }
      return { loaded: draw.loaded, meshes: draw.meshes.length, camera: controller.camera.position.toArray().map(v => Math.round(v * 100) / 100), out };
    }, report[`${kind}-aim`]?.asset);
    report[`${kind}-counts`] = await page.evaluate(() => Object.fromEntries(Object.entries(window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 楼层设施模型').userData.studioPlacements).filter(([, n]) => n > 0)));
  }
  report.errors = errors;
  await writeFile('artifacts/studio-decor-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ errors, loaded: report.assets?.loaded?.length, failed: report.assets?.failed, aims: ['home', 'market', 'clinic', 'hall'].map(k => report[`${k}-aim`]) }));
} finally { await browser?.close(); server.kill(); }
