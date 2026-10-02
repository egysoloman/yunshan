import { chromium } from '/workspace/yunshan/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Identical optical inspection cameras before and after a revision. These are
// diagnostic shots, not evidence of an ordinary player's travel permissions.
import { requireRootReady, verifyFixedSource } from './fixed-source-gate.mjs';
await requireRootReady(); await verifyFixedSource();

const output = path.resolve(process.argv[2] ?? 'artifacts/visual-review');
const port = Number(process.env.YUNSHAN_VISUAL_PORT ?? 4177);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let startup = '', browser;
server.stdout.on('data', data => { startup += data; });
server.stderr.on('data', data => { startup += data; });
const errors = [], captures = [], consoleWarnings = []; let startupResidency;
const hashSources = async () => Object.fromEntries(await Promise.all((await readdir('src', { recursive: true })).filter(filename => /\.(ts|css)$/.test(filename)).sort().map(async filename => [`src/${filename}`, createHash('sha256').update(await readFile(`src/${filename}`)).digest('hex')])));
try {
  await mkdir(output, { recursive: true });
  const index = await readFile('dist/index.html', 'utf8');
  const expectedEntry = index.match(/src="([^"]+\.js)"/)?.[1];
  const sourceHashes = await hashSources();
  const buildHash = createHash('sha256').update(await readFile(`dist${expectedEntry}`)).digest('hex');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startup.includes(`http://127.0.0.1:${port}`)) {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (!response.ok || !(await response.text()).includes(expectedEntry)) throw new Error('Preview does not match the inspected build artifact');
      break;
    }
    if (server.exitCode !== null || attempt === 99) throw new Error(`Preview unavailable: ${startup}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') consoleWarnings.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__YUNSHAN__?.city, null, { timeout: 120_000 });
  const allShots = [
  {
    "name": "core-waterfall",
    "hour": 12,
    "eye": [
      440,
      325,
      640
    ],
    "target": [
      210,
      215,
      -45
    ],
    "buildingId": null,
    "edgeId": null
  },
  {
    "name": "market-street",
    "hour": 12,
    "eye": [
      -464.40000000000003,
      72.32000000000001,
      327
    ],
    "target": [
      -469.40000000000003,
      74,
      292.40000000000003
    ],
    "buildingId": "market-b0",
    "edgeId": null
  },
  {
    "name": "residential-first-person",
    "hour": 12,
    "eye": [
      -1197,
      316.32000000000005,
      -686.6
    ],
    "target": [
      -1202,
      318,
      -721.8000000000001
    ],
    "buildingId": "west-b0",
    "edgeId": null
  },
  {
    "name": "bridge-structure",
    "hour": 12,
    "eye": [
      -648,
      40.6,
      982
    ],
    "target": [
      -648,
      18.6,
      1040
    ],
    "buildingId": null,
    "edgeId": "bridge-river-dock-river-station"
  },
  {
    "name": "bridge-walk-center",
    "hour": 12,
    "eye": [
      -648,
      20.32,
      1040
    ],
    "target": [
      -690.6,
      20.32,
      1040
    ],
    "buildingId": null,
    "edgeId": "bridge-river-dock-river-station"
  },
  {
    "name": "bridge-public-road",
    "hour": 12,
    "eye": [
      -664,
      20.32,
      1052
    ],
    "target": [
      -638,
      23,
      1040
    ],
    "buildingId": null,
    "edgeId": null
  }
];
  const selection = process.argv[3];
  const shots = selection === 'network' ? allShots.filter(shot => shot.network)
    : selection ? allShots.filter(shot => selection.split(',').includes(shot.name)) : allShots;
  startupResidency = await page.evaluate(() => {
    const d = window.__YUNSHAN__, city = d.city;
    const observed = { creates: 0, releases: 0, geometryDisposals: 0, instanceDisposals: 0 };
    const callbacks = city.nearChunks.callbacks, originalCreate = callbacks.create, originalRelease = callbacks.release;
    const watchResource = resource => {
      const geometries = new Set();
      resource.group.traverse(object => {
        if (object.isMesh || object.isPoints) geometries.add(object.geometry);
        if (object.isInstancedMesh) object.addEventListener('dispose', () => observed.instanceDisposals++);
      });
      geometries.forEach(geometry => geometry.addEventListener('dispose', () => observed.geometryDisposals++));
    };
    callbacks.create = chunk => {
      const resource = originalCreate(chunk); observed.creates++; watchResource(resource); return resource;
    };
    const initialResources = city.nearChunks.residents();
    initialResources.forEach(entry => watchResource(entry.resource));
    observed.initialWatchedGroups = initialResources.length;
    callbacks.release = (chunk, resource) => { originalRelease(chunk, resource); observed.releases++; };
    window.__OPTICAL_RESIDENCY__ = () => {
      const residents = city.nearChunks.residents();
      let groups = 0, meshes = 0, instances = 0, geometryIds = new Set(), farMismatch = 0;
      residents.forEach(({chunk, resource}) => {
        if (resource.group.parent === city.scene) groups++;
        resource.group.traverse(object => { if (object.isMesh) { meshes++; geometryIds.add(object.geometry.id); if (object.isInstancedMesh) instances += object.count; } });
        for (const id of chunk.buildingIds) for (const ref of city.distantRefs.get(id) ?? []) {
          const matrix = ref.mesh.instanceMatrix.array, i = ref.index * 16;
          if (matrix[i] !== 0 || matrix[i+5] !== 0 || matrix[i+10] !== 0) farMismatch++;
        }
      });
      return { stats: city.nearChunks.getStats(), actualSceneGroups: groups, actualMeshes: meshes, actualInstances: instances,
        ownedGeometryCount: geometryIds.size, interiorBuildingRefs: city.interiors.size, hiddenFarMismatch: farMismatch,
        residentChunks: residents.map(({chunk}) => ({id: chunk.id, buildings: [...chunk.buildingIds]})), observed: {...observed},
        gpuMemory: {...city.renderer.info.memory} };
    };
    return window.__OPTICAL_RESIDENCY__();
  });
  await page.evaluate(() => {
    const d = window.__YUNSHAN__;
    d.simulation.command({ type: 'pause', value: 1 });
    d.actions.setQuality('balanced');
    d.city.setDynamicResolution(false);
    d.city.renderer.setPixelRatio(1);
    d.city.camera.fov = 48;
    d.city.camera.updateProjectionMatrix();
    d.controller.step = () => {};
    // Keep the scene itself unobstructed for optical comparison.
    const style = document.createElement('style');
    style.textContent = '#app > :not(.world-stage) {visibility:hidden !important}';
    document.head.append(style);
  });
  for (const shot of shots) {
    const data = await page.evaluate(shot => {
      const { world, simulation, city, controller } = window.__YUNSHAN__;
      simulation.command({ type: 'setTime', value: shot.hour });
      let eye = shot.eye, target = shot.target, building = shot.buildingId ? world.buildings.find(b => b.id === shot.buildingId) : null, edge = shot.edgeId ? world.edges.find(e => e.id === shot.edgeId) : null;
      if (shot.network) {
        edge = shot.network === 'bridge' ? world.edges.find(e => e.id === 'bridge-river-dock-river-station')
          : world.edges.find(e => e.mode === 'road' && e.length > 120 && e.from.includes('market'));
        if (!edge) throw new Error(`Missing ${shot.name} edge`);
        const index = Math.floor(edge.points.length * .4), p = edge.points[index], ahead = edge.points[Math.min(edge.points.length - 1, index + 2)];
        const dx = ahead.x - p.x, dz = ahead.z - p.z, length = Math.hypot(dx, dz) || 1;
        const lateral = shot.centerline ? 0 : 2.6;
        eye = shot.street ? [p.x - dz / length * lateral, p.y + 1.72, p.z + dx / length * lateral]
          : [p.x - dz / length * 58, p.y + 22, p.z + dx / length * 58];
        target = shot.street ? [ahead.x, ahead.y + 1.72, ahead.z] : [p.x, p.y, p.z];
      }
      if (shot.district) {
        building = world.buildings.find(b => b.districtId === shot.district && b.kind === shot.kind && !b.facility)
          ?? world.buildings.find(b => b.districtId === shot.district && b.kind === shot.kind)
          ?? world.buildings.find(b => b.districtId === shot.district);
        if (!building) throw new Error(`Missing ${shot.name} building`);
        const p = building.position;
        eye = shot.street ? [building.door.x + 5, building.door.y + 1.72, building.door.z + 18]
          : [p.x + building.width * 1.35, p.y + building.height * .9 + 12, p.z + building.depth * 1.65];
        target = [p.x, p.y + (shot.street ? 4 : building.height * .4), p.z];
      }
      city.camera.position.set(...eye);
      city.camera.lookAt(...target);
      city.camera.updateMatrixWorld();
      simulation.setFocus({ x: eye[0], y: eye[1], z: eye[2] }, 'walk');
      city.update(simulation.state, 0);
      const shadowStateBeforeColour = { autoUpdate: city.renderer.shadowMap.autoUpdate, needsUpdate: city.renderer.shadowMap.needsUpdate, sunCastShadow: city.sun.castShadow };
      city.renderer.shadowMap.needsUpdate = false;
      city.render();
      const colourPass = {calls: city.renderer.info.render.calls, triangles: city.renderer.info.render.triangles};
      city.renderer.info.autoReset = false; city.renderer.info.reset(); city.renderer.shadowMap.needsUpdate = true;
      city.render();
      const totalPass = {calls: city.renderer.info.render.calls, triangles: city.renderer.info.render.triangles};
      city.renderer.info.autoReset = true;
      const gl = city.renderer.getContext(), glErrors = [];
      for (let i=0;i<32;i++) { const error=gl.getError(); if(error===gl.NO_ERROR)break; glErrors.push(error); }
      const shadowSubmission = {scope:'Explicit colour pass without shadow refresh, then identical fixed-scene render with forced shadow refresh; not a timing benchmark', shadowStateBeforeColour, colourRefresh:false, colourPass, totalPass,
        shadowCalls:totalPass.calls-colourPass.calls,shadowTriangles:totalPass.triangles-colourPass.triangles,pixelRatio:city.renderer.getPixelRatio()};
      return { name: shot.name, hour: shot.hour, eye, target, buildingId: building?.id, edgeId: edge?.id,
        opticalSettings: { scope: 'New fixed pixelRatio1/FOV48/noon/1440x900 diagnostic scope; exact numeric camera poses from coherent05 original JSON; no new v4 door/road recomputation. Prior adaptive-resolution PNGs remain separate evidence.',
          pixelRatio: city.renderer.getPixelRatio(), fov: city.camera.fov, aspect: city.camera.aspect,
          drawingBufferWidth: gl.drawingBufferWidth, drawingBufferHeight: gl.drawingBufferHeight,
          worldSeed: world.seed, worldLayout: world.layoutVersion },
        drawCalls: colourPass.calls, triangles: colourPass.triangles, shadowSubmission, glErrors,
        residency: window.__OPTICAL_RESIDENCY__(),
        shaderPrograms: city.renderer.info.programs.map(program=>({id:program.id,usedTimes:program.usedTimes,diagnostics:program.diagnostics ?? null})),
        architectureDetail: city.scene.getObjectByName('建筑近景 · 按距离生成')?.userData ?? null,
        terrainLod: city.scene.getObjectByName('山水 · 分层岩壳与连续水系')?.userData ?? null,
        waterObjects: city.scene.children.flatMap(child => { const names = []; child.traverse(o => { if (/溪|河|瀑|潭|水面|岸/.test(o.name)) names.push(o.name); }); return names; }) };
    }, shot);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, `${shot.name}.png`), timeout: 120_000 });
    captures.push(data);
    if (data.opticalSettings.pixelRatio !== 1 || data.opticalSettings.fov !== 48 || data.hour !== 12
      || data.opticalSettings.drawingBufferWidth !== 1440 || data.opticalSettings.drawingBufferHeight !== 900) errors.push(`Fixed optical settings changed at ${shot.name}`);
    if (data.shadowSubmission.shadowCalls < 0 || data.shadowSubmission.shadowTriangles < 0) errors.push(`Invalid shadow subtraction at ${shot.name}`);
    if (data.glErrors.length) errors.push(`GL errors at ${shot.name}: ${data.glErrors.join(',')}`);
    if (data.shaderPrograms.some(program => program.diagnostics?.runnable === false)) errors.push(`Shader program failed at ${shot.name}`);
    if (data.residency.hiddenFarMismatch) errors.push(`Far silhouettes were not hidden for ${shot.name}`);
    if (data.residency.stats.failures) errors.push(`Near resource failures at ${shot.name}: ${data.residency.stats.lastError}`);
    await writeFile(path.join(output, `${shot.name}.json`), JSON.stringify(data,null,2));
    console.log(`Captured ${shot.name}: ${path.join(output, `${shot.name}.png`)}; ${JSON.stringify({colour:data.shadowSubmission.colourPass,total:data.shadowSubmission.totalPass,resident:data.residency.stats.resident})}`);
  }
  const unloadResidency = await page.evaluate(() => {
    const d = window.__YUNSHAN__, before = window.__OPTICAL_RESIDENCY__();
    d.city.setInterior(null); d.city.camera.position.set(440, 325, 640);
    d.city.camera.lookAt(210, 215, -45); d.city.camera.updateMatrixWorld();
    d.simulation.setFocus({x:440,y:325,z:640},'walk'); d.city.update(d.simulation.state,0); d.city.render();
    return {scope:'After six preserved optical views: actual resident release at original core pose',before,after:window.__OPTICAL_RESIDENCY__()};
  });
  await writeFile(path.join(output,'near-unload.json'),JSON.stringify(unloadResidency,null,2));
  const sourceHashesAfter = await hashSources();
  if (JSON.stringify(sourceHashesAfter) !== JSON.stringify(sourceHashes)) errors.push('Source changed during capture; this run cannot validate the final source state');
  if (createHash('sha256').update(await readFile(`dist${expectedEntry}`)).digest('hex') !== buildHash) errors.push('Build artifact changed during capture');
  await writeFile(path.join(output, selection ? `capture-results-${selection}.json` : 'capture-results.json'), JSON.stringify({ status: errors.length ? 'failed' : 'passed',
    scope: 'Linux Chromium SwiftShader fixed pixelRatio1/FOV48/noon/1440x900 optical inspection; exact numeric camera poses match coherent05 original JSON, old adaptive resolution images remain distinct. Not macOS performance or player travel evidence.',
    buildEntry: expectedEntry, buildHash, sourceHashes, sourceHashesAfter, startupResidency, consoleWarnings, captures, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
