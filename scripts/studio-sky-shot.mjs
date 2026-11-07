// Real-browser check of the studio sky masters (dome geometry, sun, moon, star field).
// Writes artifacts/studio-sky-*.png and a JSON report.
// Software WebGL here is a functional check only, not performance evidence.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4335;
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
  await page.waitForTimeout(15000);
  for (const [name, hour] of [['noon', 9], ['night', 23]]) {
    report[name] = await page.evaluate(h => {
      window.__YUNSHAN__.actions.command({ type: 'setTime', value: h });
    }, hour);
    // Let a frame move the orbs to the new hour, then aim at the sun or moon.
    await page.waitForTimeout(4000); await page.screenshot({ path: `artifacts/studio-sky-${name}.png`, timeout: 180_000 });
    report[name] = await page.evaluate(h => {
      const { city, controller } = window.__YUNSHAN__;
      const orb = h < 18 ? city.sunOrb : city.moonOrb, d = orb.position.clone().sub(controller.camera.position);
      controller.yaw = Math.atan2(-d.x, -d.z); controller.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); controller['orient']();
      return { orbChildren: orb.children.length, orbMaterialVisible: orb.material.visible, starsPointsVisible: city.stars.visible, skyVertices: city.sky.geometry.getAttribute('position').count };
    }, hour);
    for (let i = 0; i < 2; i++) { await page.waitForTimeout(4000); await page.screenshot({ path: `artifacts/studio-sky-${name}.png`, timeout: 180_000 }); }
  }
  report.errors = errors;
  await writeFile('artifacts/studio-sky-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
} finally { await browser?.close(); server.kill(); }
