// Real-browser check that the studio woodland models load at their original
// size and replace the block trees around the camera. Writes
// artifacts/woodland-*.png and artifacts/woodland-report.json. Software WebGL
// here is a functional check only, not performance evidence.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const port = 4321;
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
  await page.waitForFunction(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 原尺寸林木')?.userData.woodlandModels, null, { timeout: 120_000 });
  report.models = await page.evaluate(() => window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 原尺寸林木').userData.woodlandModels);
  // Stand 30 m from a broadleaf, pine and bamboo tree and look at it.
  for (const asset of ['ENV-050', 'ENV-054', 'ENV-057', 'ENV-056', 'ENV-055', 'ENV-015', 'ENV-011', 'ENV-061', 'ENV-065', 'BUILT-131', 'CHAR-315', 'CHAR-316', 'CHAR-320']) {
    report[asset] = await page.evaluate(asset => {
      const { city, controller, simulation, actions } = window.__YUNSHAN__;
      actions.command({ type: 'setTime', value: 11 });
      const vegetation = city.scene.getObjectByName('山林 · 松柏竹木');
      const layout = city.landscape?.woodland ?? null;
      // Trees from the terrain layout; ground dressing from the model pool's own list.
      const trees = [...(layout?.trees ?? []), ...(city.woodlandModels?.plants ?? []).filter(p => p.tier === 'ground' || p.tier === 'rock' || p.tier === 'road')].filter(t => t.asset === asset);
      if (!trees.length) return { error: 'no layout access' };
      // The road surface: the tile nearest a point 150m east of the spawn, seen from the road itself, along its yaw.
      const spawn = { ...window.__YUNSHAN__.world.spawn, x: window.__YUNSHAN__.world.spawn.x + 150 };
      if (asset === 'BUILT-131') { const tile = trees.reduce((best, t) => Math.hypot(t.x - spawn.x, t.z - spawn.z) < Math.hypot(best.x - spawn.x, best.z - spawn.z) ? t : best);
        const cx = tile.x + Math.cos(tile.yaw) * 5, cz = tile.z - Math.sin(tile.yaw) * 5, feet = { x: cx - Math.sin(tile.yaw) * 6, y: tile.y + .5, z: cz - Math.cos(tile.yaw) * 6 };
        simulation.state.player.position = { ...feet }; controller.setMode('walk', feet); Object.assign(controller['feet'], feet);
        controller.yaw = Math.atan2(-Math.sin(tile.yaw), -Math.cos(tile.yaw)); controller.pitch = -.25; controller['orient']();
        return { tree: tile, vegetation: !!vegetation }; }
      const tree = trees[Math.floor(trees.length / 2)], near = asset === 'ENV-061' || asset === 'ENV-065' || asset === 'BUILT-131' || asset.startsWith('CHAR-'), feet = { x: tree.x + (asset.startsWith('CHAR-') ? 3.2 : near ? 8 : 24), y: tree.y + 1.72, z: tree.z + (asset.startsWith('CHAR-') ? 2.4 : near ? 6 : 18) };
      simulation.state.player.position = { ...feet, y: tree.y };
      controller.setMode('walk', simulation.state.player.position); Object.assign(controller['feet'], { ...feet, y: tree.y });
      controller.yaw = Math.atan2(-(tree.x - feet.x), -(tree.z - feet.z)); controller.pitch = .15; controller['orient']();
      return { tree, vegetation: !!vegetation };
    }, asset);
    await page.waitForTimeout(7000);
    report[`${asset}-drawn`] = await page.evaluate(asset => {
      const group = window.__YUNSHAN__.city.scene.getObjectByName('体素工坊 · 原尺寸林木');
      const meshes = group.children.filter(m => m.name.startsWith(asset));
      return { placements: group.userData.woodlandPlacements, meshes: meshes.length, visible: meshes.filter(m => m.visible).length, instances: meshes[0]?.count ?? 0 };
    }, asset);
    await page.screenshot({ path: `artifacts/woodland-${asset}.png`, timeout: 180_000 });
  }
  report.errors = errors;
  await writeFile('artifacts/woodland-report.json', JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1).slice(0, 3000));
} finally { await browser?.close(); server.kill(); }
