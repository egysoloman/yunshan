// Real-browser views along terrace streets at dusk and from a height, for
// comparing the street-first world with the reference town. Writes
// artifacts/street-*.png. Software WebGL is a look check only.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const port = 4323;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let browser; const errors = [];
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
  const shots = (process.argv[2] ?? 'river,east,summit').split(',');
  for (const district of shots) for (const [label, hour, lift] of [['day', 10.5, 0], ['dusk', 19.6, 0]]) {
    const view = await page.evaluate(([district, hour, lift]) => {
      const { world, controller, simulation, actions } = window.__YUNSHAN__;
      actions.command({ type: 'setTime', value: hour });
      // The terrace row with the most doors along it, seen from its west end.
      const seg = (p, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, n = dx * dx + dz * dz, t = n ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / n)) : 0; return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t); };
      const near = e => world.buildings.filter(b => b.districtId === district && e.points.some((p, i) => i > 0 && seg(b.door, e.points[i - 1], p) < 14)).length;
      const edge = world.edges.filter(e => e.id.includes('-terrace-') && e.id.includes('-row-') && world.nodes.find(n => n.id === e.from)?.districtId === district).map(e => ({ e, n: near(e) })).sort((a, b) => b.n - a.n)[0].e;
      const p = edge.points[0], q = edge.points.at(-1), len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const feet = { x: p.x - (q.x - p.x) / len * 4, y: p.y + lift, z: p.z - (q.z - p.z) / len * 4 }, look = { x: q.x, y: q.y + 3, z: q.z };
      simulation.state.player.position = { ...feet };
      controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
      controller.yaw = Math.atan2(-(look.x - feet.x), -(look.z - feet.z)); controller.pitch = Math.atan2(look.y - feet.y - 1.72, Math.hypot(look.x - feet.x, look.z - feet.z)); controller['orient']();
      return { edge: edge.id, feet };
    }, [district, hour, lift]);
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `artifacts/street-${district}-${label}.png`, timeout: 180_000 });
    console.log(district, label, JSON.stringify(view));
  }
  console.log('errors', JSON.stringify(errors));
} finally { await browser?.close(); server.kill(); }
