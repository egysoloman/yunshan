// Real-browser check that the studio landmarks (BUILT-158 runway, BUILT-092
// core forecourt) load and draw in place of their boxes. Writes
// artifacts/landmark-*.png and artifacts/landmarks-report.json. Software WebGL
// here is a functional check only, not performance evidence.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4322;
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
  const views = {
    runway: { feet: { x: 1180, z: 1430 }, look: { x: 1300, y: 14.6, z: 1490 } },
    forecourt: null,
  };
  for (const name of ['runway', 'forecourt']) {
    report[name] = await page.evaluate(([name, view]) => {
      const { world, controller, simulation, actions } = window.__YUNSHAN__;
      actions.command({ type: 'setTime', value: 11 });
      let feet, look;
      if (name === 'forecourt') { const core = world.buildings.find(b => b.kind === 'core'); feet = { x: core.position.x + 25, y: core.position.y, z: core.door.z + 100 }; look = { x: core.position.x - 10, y: core.position.y + 2, z: core.door.z + 50 }; }
      else { feet = { ...view.feet, y: 14.6 }; look = view.look; }
      simulation.state.player.position = { ...feet };
      controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
      controller.yaw = Math.atan2(-(look.x - feet.x), -(look.z - feet.z)); controller.pitch = Math.atan2(look.y - feet.y - 1.72, Math.hypot(look.x - feet.x, look.z - feet.z)); controller['orient']();
      return { feet, look };
    }, [name, views[name]]);
    await page.waitForTimeout(8000);
    report[`${name}-drawn`] = await page.evaluate(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 楼层设施模型').userData.studioPlacements);
    await page.screenshot({ path: `artifacts/landmark-${name}.png`, timeout: 180_000 });
  }
  report.errors = errors;
  await writeFile('artifacts/landmarks-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
} finally { await browser?.close(); server.kill(); }
