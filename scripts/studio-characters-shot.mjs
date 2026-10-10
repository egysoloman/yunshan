// Real-browser check that residents near the camera are drawn as studio
// characters on the studio skeleton. Writes artifacts/studio-characters-*.png and a JSON report.
// Software WebGL here is a functional check only, not performance evidence.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4333;
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
  await page.waitForFunction(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 骨骼人物')?.userData.studioCharacters, null, { timeout: 240_000 });
  report.load = await page.evaluate(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 骨骼人物').userData.studioCharacters);
  for (const [name, hour, wanted] of [['walking', 8.5, 'moving']]) {
    await page.evaluate(h => window.__YUNSHAN__.actions.command({ type: 'setTime', value: h }), hour);
    await page.waitForTimeout(6000);
    report[name] = await page.evaluate(wanted => {
      const { simulation, controller, world } = window.__YUNSHAN__, s = simulation.state;
      // An outdoor resident: not inside any building footprint.
      const outdoors = c => !world.buildings.some(b => Math.abs(c.position.x - b.position.x) < b.width / 2 && Math.abs(c.position.z - b.position.z) < b.depth / 2);
      const c = s.citizens.find(x => x.state === wanted && x.tier === 'active' && outdoors(x)) ?? s.citizens.find(x => x.state === wanted && x.tier === 'active');
      if (!c) return { error: 'no ' + wanted };
      const feet = { x: c.position.x + 3, y: c.position.y, z: c.position.z + 3 };
      simulation.state.player.position = { ...feet }; controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
      controller.yaw = Math.atan2(-(c.position.x - feet.x), -(c.position.z - feet.z)); controller.pitch = -.12; controller['orient']();
      window.__studioTarget = c.id;
      return { id: c.id, role: c.role, state: c.state, position: c.position };
    }, wanted);
    // Freeze the city on this resident (a paused walk keeps its last stride), then re-aim before each frame.
    await page.evaluate(() => { const s = window.__YUNSHAN__.simulation.state; if (!s.paused) window.__YUNSHAN__.actions.command({ type: 'pause' }); });
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { const { simulation, controller } = window.__YUNSHAN__, c = simulation.state.citizens.find(x => x.id === window.__studioTarget); if (!c) return;
        const feet = { x: c.position.x + 2.6, y: c.position.y, z: c.position.z + 2.6 }; simulation.state.player.position = { ...feet }; controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
        controller.yaw = Math.atan2(-(c.position.x - feet.x), -(c.position.z - feet.z)); controller.pitch = -.18; controller['orient'](); });
      await page.waitForTimeout(4000); await page.screenshot({ path: `artifacts/studio-characters-${name}.png`, timeout: 180_000 });
    }
    await page.evaluate(() => { if (window.__YUNSHAN__.simulation.state.paused) window.__YUNSHAN__.actions.command({ type: 'pause' }); });
    report[`${name}-drawn`] = await page.evaluate(() => { const g = window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 骨骼人物'); return { characters: g.userData.studioCharacterCount, children: g.children.length, target: [...window.__YUNSHAN__.city.studioCharacters.modelled].includes(window.__studioTarget) }; });
  }
  report.arms = await page.evaluate(() => { const arms = window.__YUNSHAN__.city.camera.getObjectByName('体素工坊 · 第一人称双手'); return arms ? { visible: arms.visible, children: arms.children.length } : null; });
  await page.screenshot({ path: 'artifacts/studio-characters-first-person.png', timeout: 180_000 });
  report.errors = errors;
  await writeFile('artifacts/studio-characters-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report).slice(0, 1500));
} finally { await browser?.close(); server.kill(); }
