// Real-browser check that imported voxel-studio GLBs load and draw at their
// floor-plan fixtures. Writes artifacts/studio-props-*.png and a JSON report.
// Software WebGL here is a functional check only, not performance evidence.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4319;
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
  const shots = { market: 'LIFE-064', home: 'LIFE-032', police: 'LIFE-151', school: 'LIFE-111' };
  for (const kind of Object.keys(shots)) {
    const view = await page.evaluate(kind => {
      const { world, simulation, controller, actions, getView } = window.__YUNSHAN__;
      actions.command({ type: 'setTime', value: 12 });
      const building = world.buildings.filter(b => b.kind === kind)[kind === 'market' ? 0 : 3];
      simulation.state.player.position = { ...building.door, z: building.door.z + 2 };
      controller.setMode('walk', simulation.state.player.position);
      actions.interact();
      return { id: building.id, inside: getView().inside };
    }, kind);
    await page.waitForTimeout(8000);
    // Stand on the model's own +Z (front) side and look at its centre.
    report[`${kind}-aim`] = await page.evaluate(asset => {
      const { city, controller, simulation } = window.__YUNSHAN__;
      const group = city.scene.getObjectByName('体素工坊 · 楼层设施模型');
      const mesh = group.children.find(m => m.visible && m.name.startsWith(asset));
      if (!mesh) return null;
      const camera = controller.camera, M = new camera.matrix.constructor(), best = { d: Infinity, i: -1 };
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, M); const d = Math.hypot(M.elements[12] - camera.position.x, M.elements[14] - camera.position.z); if (d < best.d) { best.d = d; best.i = i; } }
      mesh.getMatrixAt(best.i, M); const e = M.elements;
      const apply = (x, y, z) => ({ x: e[0] * x + e[4] * y + e[8] * z + e[12], y: e[1] * x + e[5] * y + e[9] * z + e[13], z: e[2] * x + e[6] * y + e[10] * z + e[14] });
      const { min, max } = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox);
      const cx = (min.x + max.x) / 2, feet = apply(cx, 0, max.z + 1.3), target = apply(cx, (min.y + max.y) / 2, (min.z + max.z) / 2);
      simulation.state.player.position = { ...feet };
      controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
      const dx = target.x - feet.x, dz = target.z - feet.z;
      controller.yaw = Math.atan2(-dx, -dz); controller.pitch = -0.45; controller['orient']();
      return { mesh: mesh.name, instance: best.i, feet, target };
    }, shots[kind]);
    await page.waitForTimeout(8000);
    const placed = await page.evaluate(() => {
      const { city, controller } = window.__YUNSHAN__, group = city.scene.getObjectByName('体素工坊 · 楼层设施模型'), M = new controller.camera.matrix.constructor();
      const meshes = group.children.slice(0, 20).map(m => { let d = Infinity; for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, M); d = Math.min(d, Math.hypot(M.elements[12] - controller.camera.position.x, M.elements[13] - controller.camera.position.y, M.elements[14] - controller.camera.position.z)); } return { name: m.name, visible: m.visible, count: m.count, nearest: Math.round(d * 100) / 100, sphere: m.boundingSphere && Math.round(m.boundingSphere.radius) }; });
      return { counts: group.userData.studioPlacements, camera: controller.camera.position.toArray(), meshes };
    });
    await page.screenshot({ path: `artifacts/studio-props-${kind}.png`, timeout: 180_000 });
    report[kind] = { ...view, placed };
    if (kind === 'home' || kind === 'school') {
      report[`${kind}-lamp`] = await page.evaluate(() => {
        const { city, controller } = window.__YUNSHAN__, camera = controller.camera;
        const mesh = city.scene.getObjectByName('体素工坊 · 楼层设施模型').children.find(m => m.visible && m.name.startsWith('LIFE-028'));
        if (!mesh) return null;
        const M = new camera.matrix.constructor(), p = new camera.position.constructor(); let best = null;
        for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, M); p.setFromMatrixPosition(M); const d = p.distanceTo(camera.position); if (!best || d < best.d) best = { d, x: p.x, y: p.y, z: p.z }; }
        const dx = best.x - camera.position.x, dy = best.y - camera.position.y, dz = best.z - camera.position.z;
        controller.yaw = Math.atan2(-dx, -dz); controller.pitch = Math.atan2(dy, Math.hypot(dx, dz)); controller['orient']();
        return best;
      });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: `artifacts/studio-props-${kind}-ceiling.png`, timeout: 180_000 });
      const glow = () => page.evaluate(() => { const { city, simulation } = window.__YUNSHAN__; const m = city.scene.getObjectByName('体素工坊 · 楼层设施模型').children.filter(x => x.name.startsWith('LIFE-028')).flatMap(x => [x.material].flat()).filter(x => x.userData.authoredEmissive !== undefined); return { hour: simulation.state.hour, energy: simulation.state.energy, emissive: m.map(x => Math.round(x.emissiveIntensity * 1000) / 1000), authored: m.map(x => x.userData.authoredEmissive) }; });
      report[`${kind}-glow-noon`] = await glow();
      await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'setTime', value: 22 }));
      await page.waitForTimeout(6000);
      report[`${kind}-glow-night`] = await glow();
      await page.screenshot({ path: `artifacts/studio-props-${kind}-ceiling-night.png`, timeout: 180_000 });
      await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'setTime', value: 12 }));
    }
    await page.evaluate(() => window.__YUNSHAN__.actions.interact());
  }
  report.station = await page.evaluate(() => {
    const { world, simulation, controller } = window.__YUNSHAN__;
    const node = world.nodes.find(n => n.id === 'river-station') ?? world.nodes.find(n => n.station);
    const feet = { x: node.position.x + 18, y: node.position.y - .1, z: node.position.z + 24 };
    simulation.state.player.position = { ...feet }; controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
    controller.yaw = Math.atan2(18, 24); controller.pitch = -0.1; controller['orient']();
    return { node: node.id, feet };
  });
  await page.waitForTimeout(8000);
  report.station.placed = await page.evaluate(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 楼层设施模型').userData.studioPlacements);
  await page.screenshot({ path: 'artifacts/studio-props-station.png', timeout: 180_000 });
  report.errors = errors;
  await writeFile('artifacts/studio-props.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (report.assets.failed.length || errors.length) process.exitCode = 1;
} finally {
  await browser?.close(); server.kill();
}
