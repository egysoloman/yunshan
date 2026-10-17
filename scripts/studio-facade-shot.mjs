// Real-browser check of studio facade décor on exterior walls (studioFacadePlacements).
// Writes artifacts/studio-facade-*.png and a JSON report.
// Software WebGL here is a functional check only, not performance evidence.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4337;
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
  for (const [kind, back] of [['market', 10], ['home', 12], ['pavilion', 22], ['core', 70]]) {
    report[kind] = await page.evaluate(([kind, back]) => {
      const { world, simulation, controller, actions } = window.__YUNSHAN__; actions.command({ type: 'setTime', value: 10 });
      const b = world.buildings.filter(x => x.kind === kind)[kind === 'core' || kind === 'pavilion' ? 0 : 2];
      // In front of the entrance, outside, looking back at it.
      const dx = b.door.x - b.position.x, dz = b.door.z - b.position.z, l = Math.hypot(dx, dz) || 1, feet = { x: b.door.x + dx / l * back, y: b.door.y, z: b.door.z + dz / l * back };
      simulation.state.player.position = { ...feet }; controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
      controller.yaw = Math.atan2(-(b.door.x - feet.x), -(b.door.z - feet.z)); controller.pitch = kind === 'core' ? .25 : .08; controller['orient']();
      return { id: b.id };
    }, [kind, back]);
    for (let i = 0; i < 3; i++) { await page.waitForTimeout(4000); await page.screenshot({ path: `artifacts/studio-facade-${kind}.png`, timeout: 180_000 }); }
    report[`${kind}-facade`] = await page.evaluate(id => (window.__YUNSHAN__.city.studioProps.placements.get(id) ?? []).filter(p => p.fixtureId.startsWith('facade:')).length, report[kind].id);
  }
  report.loaded = await page.evaluate(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 楼层设施模型').userData.studioAssets?.failed);
  report.errors = errors;
  await writeFile('artifacts/studio-facade-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
} finally { await browser?.close(); server.kill(); }
