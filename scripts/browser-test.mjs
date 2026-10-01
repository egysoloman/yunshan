import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const port = 4173;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', data => { output += data; });
server.stderr.on('data', data => { output += data; });
let browser;
const errors = [];
const results = [];
let buildEntry = null;
let sourceHashes = {};
const check = (name, data) => { results.push({ name, ...data }); console.log(`PASS ${name}`); };
try {
  const buildIndex = await readFile('dist/index.html', 'utf8');
  buildEntry = buildIndex.match(/src="([^"]+\.js)"/)?.[1] ?? null;
  sourceHashes = Object.fromEntries(await Promise.all(['src/simulation.ts', 'src/simulation/extensions.ts', 'src/main.ts', 'src/world.ts', 'src/renderer.ts', 'src/controller.ts', 'src/ui.ts', 'src/aviation.ts', 'src/aviation-renderer.ts', 'src/simulation/family.ts', 'src/simulation/culture.ts', 'src/persistence.ts', 'src/transport-geometry.ts'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
  await mkdir('artifacts', { recursive: true });
  // Confirm this child owns the requested port before touching the endpoint.
  // A response from another preview process cannot verify this build.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview failed: ${output}`);
    if (output.includes(`http://127.0.0.1:${port}`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (attempt === 99) throw new Error(`Preview startup marker missing: ${output}`);
  }
  const served = await fetch(`http://127.0.0.1:${port}`);
  if (!served.ok) throw new Error(`Preview HTTP ${served.status}`);
  const servedEntry = (await served.text()).match(/src="([^"]+\.js)"/)?.[1] ?? null;
  assert(buildEntry && servedEntry === buildEntry, `Preview served ${servedEntry}; expected ${buildEntry}`);

  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120_000); // Software WebGL can spend over 30s producing the frames needed for action stability.
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`.trim()); });
  await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForFunction(() => window.__YUNSHAN__?.simulation?.state?.tick >= 1, null, { timeout: 90_000 });
  const initial = await page.evaluate(() => {
    const { world, simulation, city, getView } = window.__YUNSHAN__;
    return { districts: world.districts.length, buildings: world.buildings.length, citizens: simulation.state.citizens.length, vehicles: simulation.state.vehicles.length, tick: simulation.state.tick, drawCalls: city.renderer.info.render.calls, triangles: city.renderer.info.render.triangles, fps: getView().fps };
  });
  assert(initial.districts >= 7 && initial.buildings >= 150 && initial.citizens >= 200 && initial.vehicles > 10 && initial.drawCalls > 0 && initial.triangles > 1000);
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  assert(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.aircraft.length > 1));
  check('world boots in first person with real city aircraft and live simulation', initial);
  const panelToggle = page.getByTestId('panel-toggle');
  const expanded = await panelToggle.getAttribute('aria-expanded');
  await panelToggle.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(before => document.querySelector('[data-testid="panel-toggle"]')?.getAttribute('aria-expanded') !== before, expanded, { timeout: 20_000 });
  await panelToggle.click();
  check('native button keyboard activation remains accessible', { key: 'Space' });

  await page.evaluate(() => { const { actions } = window.__YUNSHAN__; actions.command({ type: 'pause', value: 1 }); actions.command({ type: 'setTime', value: 15.5 }); });
  const pausedTick = await page.evaluate(() => window.__YUNSHAN__.simulation.state.tick);
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.tick), pausedTick);
  const dayHour = await page.evaluate(() => window.__YUNSHAN__.simulation.state.hour);
  assert(Math.abs(dayHour - 15.5) < 0.01);
  await page.screenshot({ timeout: 120_000, path: 'artifacts/day.png' });
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'setTime', value: 22 }));
  await page.waitForTimeout(500);
  await page.screenshot({ timeout: 120_000, path: 'artifacts/night.png' });
  check('manual time and paused simulation with day/night rendering', { dayHour, nightHour: 22 });

  await page.getByTestId('mode-walk').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  const beforeMovement = await page.evaluate(() => ({ ...window.__YUNSHAN__.controller.position }));
  await page.locator('canvas').first().click({ position: { x: 750, y: 400 } });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(before => Math.hypot(window.__YUNSHAN__.controller.position.x - before.x, window.__YUNSHAN__.controller.position.z - before.z) > 0.75, beforeMovement, { timeout: 20_000 });
  await page.keyboard.up('KeyW');
  const afterMovement = await page.evaluate(() => ({ ...window.__YUNSHAN__.controller.position }));
  assert(Math.hypot(afterMovement.x - beforeMovement.x, afterMovement.z - beforeMovement.z) > 0.5);
  check('actual keyboard first-person movement', { metres: Math.hypot(afterMovement.x - beforeMovement.x, afterMovement.z - beforeMovement.z) });

  const entered = await page.evaluate(() => {
    const { world, simulation, controller, actions, getView } = window.__YUNSHAN__;
    actions.command({ type: 'setTime', value: 12 });
    const building = world.buildings.find(b => b.kind === 'market');
    simulation.state.player.position = { ...building.door, z: building.door.z + 2 };
    controller.setMode('walk', simulation.state.player.position);
    actions.interact();
    return { id: building.id, inside: getView().inside, nearbyId: getView().nearbyBuilding?.id, money: simulation.state.player.money };
  });
  assert.equal(entered.inside, true);
  assert.equal(entered.nearbyId, entered.id);
  await page.waitForTimeout(300);
  await page.screenshot({ timeout: 120_000, path: 'artifacts/interior.png' });
  const purchase = await page.evaluate(id => {
    const { simulation } = window.__YUNSHAN__;
    const before = simulation.state.player.money;
    const result = simulation.command({ type: 'purchase', targetId: id, value: 1 });
    return { ...result, before, after: simulation.state.player.money };
  }, entered.id);
  assert(purchase.ok && purchase.after < purchase.before, JSON.stringify(purchase));
  check('enter actual building and transact against real stock and balance', purchase);

  const save = await page.evaluate(async () => {
    const { simulation, actions, storage } = window.__YUNSHAN__;
    await actions.save();
    const before = simulation.state.player.money;
    simulation.state.player.money += 99;
    await actions.load();
    return { before, after: simulation.state.player.money, saved: (await storage.read())?.length ?? 0 };
  });
  assert.equal(save.after, save.before);
  assert(save.saved > 1000);
  check('browser save/load restores state', save);

  const civic = await page.evaluate(async () => {
    const { world, simulation, controller, actions, canAccessBuilding } = window.__YUNSHAN__;
    const building = world.buildings.find(b => b.id === 'core-main');
    const widths = building.floorFootprints.map(level => level.width);
    const depths = building.floorFootprints.map(level => level.depth);
    const shaft = { x: building.position.x - Math.min(...widths) * 0.32, z: building.position.z - Math.min(...depths) * 0.25 };
    const at = floor => ({ ...shaft, y: building.position.y + 0.6 + floor * building.height / building.floors });
    simulation.state.player.identities = ['traveler']; simulation.state.player.role = 'traveler';
    simulation.state.player.position = at(2); controller.setMode('walk', at(2));
    actions.interact();
    const publicNext = controller.floor;
    const denied = !canAccessBuilding(building, 25) && !canAccessBuilding(building, -2);
    simulation.state.player.identities.push('mayor');
    simulation.state.player.position = at(29); controller.setMode('walk', at(29));
    actions.interact();
    const basement = controller.floor;
    simulation.state.player.position = at(17); controller.setMode('walk', at(17));
    await actions.save();
    controller.setMode('walk', building.door); simulation.state.player.position = { ...building.door };
    await actions.load();
    controller.step(0.1, false);
    const restoredFloor = controller.floor;
    return { publicNext, denied, basement, restoredFloor, footprintWidths: [...new Set(widths)], position: controller.position };
  });
  assert(civic.publicNext !== 25 && civic.publicNext >= 3 && civic.denied);
  assert.equal(civic.basement, -2);
  assert.equal(civic.restoredFloor, 17);
  assert.equal(civic.footprintWidths.length, 5);
  check('municipal permissions, genuine basement and upper-floor save restoration', civic);

  const driving = await page.evaluate(() => {
    const { world, simulation, controller } = window.__YUNSHAN__;
    const endpoint = vehicle => {
      const edge = world.edges.find(e => e.id === vehicle.edgeId);
      return world.nodes.find(n => n.id === (vehicle.progress < 0.5 ? edge.from : edge.to));
    };
    const stopped = () => simulation.state.vehicles.find(vehicle => {
      const node = endpoint(vehicle);
      return vehicle.kind === 'road' && vehicle.state !== 'moving' && vehicle.passengers === 0 && Math.hypot(vehicle.position.x - node.position.x, vehicle.position.z - node.position.z) < 35;
    });
    // Use the actual public fast-forward and arrival rules to obtain a parked car.
    simulation.command({ type: 'pause', value: 0 }); simulation.command({ type: 'speed', value: 16 });
    for (let ticks = 0; ticks < 200 && !stopped(); ticks++) simulation.step(0.25);
    simulation.command({ type: 'pause', value: 1 }); simulation.command({ type: 'speed', value: 1 });
    const vehicle = stopped();
    if (!vehicle) throw new Error('No road vehicle reached a legitimate stop within fast-forward limit');
    simulation.state.player.identities.push('driver');
    simulation.state.player.position = { ...vehicle.position };
    controller.setMode('walk', vehicle.position);
    const node = endpoint(vehicle);
    const signal = simulation.command({ type: 'signal', targetId: node.id, value: vehicle.direction > 0 ? 1 : 0 });
    const result = simulation.command({ type: 'drive', targetId: vehicle.id });
    return { ...result, id: vehicle.id, position: { ...vehicle.position }, signal: signal.ok };
  });
  assert(driving.ok && driving.signal, JSON.stringify(driving));
  await page.locator('canvas').first().click({ position: { x: 750, y: 400 } });
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 0 }));
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(before => {
      const { simulation } = window.__YUNSHAN__;
      const vehicle = simulation.state.vehicles.find(v => v.id === before.id);
      return Math.hypot(vehicle.position.x - before.position.x, vehicle.position.z - before.position.z) > 3;
    }, driving, { timeout: 45_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(before => {
      const { simulation, controller, getView } = window.__YUNSHAN__;
      const vehicle = simulation.state.vehicles.find(v => v.id === before.id);
      return { start: before, tick: simulation.state.tick, hour: simulation.state.hour, paused: simulation.state.paused, speed: simulation.state.speed, vehicle, controls: controller.drivingControls, driving: JSON.parse(simulation.exportSave()).runtime.driving, nearbyTraffic: simulation.state.vehicles.filter(v => v.edgeId === vehicle.edgeId), fps: getView().fps, hidden: document.hidden, mode: controller.mode };
    }, driving);
    await writeFile('artifacts/driving-failure.json', JSON.stringify(diagnostic, null, 2));
    console.error('Driving diagnostic', JSON.stringify(diagnostic));
    throw error;
  }
  await page.keyboard.up('KeyW');
  const driven = await page.evaluate(before => {
    const { simulation, controller } = window.__YUNSHAN__;
    const vehicle = simulation.state.vehicles.find(v => v.id === before.id);
    return { metres: Math.hypot(vehicle.position.x - before.position.x, vehicle.position.z - before.position.z), controlling: simulation.isDriving(vehicle.id), passengerDistance: Math.hypot(vehicle.position.x - simulation.state.player.position.x, vehicle.position.z - simulation.state.player.position.z), mode: controller.mode };
  }, driving);
  assert(driven.controlling && driven.mode === 'walk' && driven.passengerDistance < 0.01);
  check('actual keyboard driving advances the vehicle and carries the player', driven);
  await page.evaluate(async () => { await window.__YUNSHAN__.actions.load(); });

  await page.getByTestId('mode-jet').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), null);
  const jetFixture = await page.evaluate(() => {
    const { simulation, controller, actions } = window.__YUNSHAN__;
    const craft = simulation.state.aviation.aircraft.find(c => c.kind === 'jet');
    simulation.state.player.position = { ...craft.position, x: craft.position.x + 4, y: craft.position.y - .6 };
    simulation.state.player.identities = ['traveler', 'driver']; simulation.state.player.role = 'driver';
    controller.setMode('walk', simulation.state.player.position); actions.command({ type: 'setTime', value: 10 });
    simulation.state.weather = '晴'; simulation.state.visibility = 1;
    return { id: craft.id, position: { ...craft.position } };
  });
  await page.getByTestId('mode-jet').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  await page.evaluate(() => window.__YUNSHAN__.simulation.state.player.identities.push('soldier'));
  await page.getByTestId('mode-jet').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'jet');
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 0 }));
  await page.keyboard.down('KeyR');
  await page.waitForFunction(start => window.__YUNSHAN__.controller.position.y - start.y > 35, jetFixture.position, { timeout: 30_000 });
  await page.keyboard.up('KeyR');
  const jetStart = await page.evaluate(() => ({ ...window.__YUNSHAN__.controller.position }));
  await page.waitForFunction(before => Math.hypot(window.__YUNSHAN__.controller.position.x - before.x, window.__YUNSHAN__.controller.position.z - before.z) > 12, jetStart, { timeout: 30_000 });
  const jetEnd = await page.evaluate(() => {
    const { simulation, controller } = window.__YUNSHAN__;
    const craft = simulation.state.aviation.aircraft.find(c => c.id === simulation.state.aviation.activeAircraftId);
    return { position: controller.position, passengerDistance: Math.hypot(craft.position.x - simulation.state.player.position.x, craft.position.z - simulation.state.player.position.z), battery: craft.battery };
  });
  assert.equal(jetEnd.passengerDistance, 0); assert(jetEnd.battery < 100);
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 1 }));
  await page.locator('canvas').first().hover({ position: { x: 950, y: 350 } });
  await page.mouse.wheel(0, -1000);
  await page.waitForFunction(() => window.__YUNSHAN__.simulation.state.aviation.controls.speed === window.__YUNSHAN__.controller.jetSpeed && window.__YUNSHAN__.controller.jetSpeed > 120, null, { timeout: 30_000 });
  const savedFlightSpeed = await page.evaluate(async () => { const d = window.__YUNSHAN__; const speed = d.controller.jetSpeed; await d.actions.save(); d.controller.jetSpeed = 85; await d.actions.load(); return { requested: speed, restored: d.controller.jetSpeed, mode: d.controller.mode }; });
  assert.equal(savedFlightSpeed.restored, savedFlightSpeed.requested); assert.equal(savedFlightSpeed.mode, 'jet');
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 0 }));
  await page.getByTestId('mode-walk').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'jet');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(id => window.__YUNSHAN__.simulation.state.aviation.aircraft.find(c => c.id === id)?.status === 'parked', jetFixture.id, { timeout: 60_000 });
  await page.keyboard.press('KeyE');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  check('military identity, actual keyboard VTOL flight, passenger position, safe return and exit', { metres: Math.hypot(jetStart.x - jetEnd.position.x, jetStart.z - jetEnd.position.z), battery: jetEnd.battery });

  await page.getByTestId('mode-drone').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  const droneFixture = await page.evaluate(() => {
    const { simulation, controller, actions } = window.__YUNSHAN__;
    actions.command({ type: 'pause', value: 1 });
    const craft = simulation.state.aviation.aircraft.find(c => c.kind === 'drone');
    simulation.state.player.position = { ...craft.position, x: craft.position.x + 2, y: craft.position.y - .6 };
    controller.setMode('walk', simulation.state.player.position);
    return { id: craft.id, position: { ...craft.position }, money: simulation.state.player.money, treasury: simulation.state.treasury };
  });
  await page.keyboard.press('KeyE');
  const rental = await page.evaluate(() => ({ cash: window.__YUNSHAN__.simulation.state.player.money, treasury: window.__YUNSHAN__.simulation.state.treasury, active: window.__YUNSHAN__.simulation.state.aviation.activeAircraftId }));
  assert.equal(rental.cash, droneFixture.money - 24); assert.equal(rental.treasury, droneFixture.treasury + 24); assert.equal(rental.active, null);
  await page.keyboard.press('KeyE');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'drone');
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 0 }));
  await page.keyboard.down('KeyR');
  await page.waitForFunction(start => window.__YUNSHAN__.controller.position.y - start.y > 30, droneFixture.position, { timeout: 30_000 });
  await page.keyboard.up('KeyR');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(id => window.__YUNSHAN__.simulation.state.aviation.aircraft.find(c => c.id === id)?.status === 'parked', droneFixture.id, { timeout: 60_000 });
  await page.keyboard.press('KeyE');
  await page.evaluate(id => window.__YUNSHAN__.actions.command({ type: 'returnAircraft', targetId: id }), droneFixture.id);
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  assert.equal(await page.evaluate(id => window.__YUNSHAN__.simulation.state.aviation.aircraft.find(c => c.id === id)?.reserved, droneFixture.id), false);
  check('city drone rental transfers cash, boards on foot, flies, lands, exits and ends the lease', { fee: 24 });

  await page.evaluate(() => window.__YUNSHAN__.actions.setQuality('low'));
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.getView().quality), 'low');
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(horizontalOverflow, false);
  check('quality changes and compact viewport remain usable', { horizontalOverflow });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  await writeFile('artifacts/browser-results.json', JSON.stringify({ browser: 'Chromium with SwiftShader on Linux', buildEntry, sourceHashes, note: 'Functional rendering verification; these FPS do not represent macOS hardware performance.', results, errors }, null, 2));
  console.log(`${results.length} browser checks passed, no uncaught browser or console errors.`);
} catch (error) {
  console.error(error);
  console.error(output);
  await writeFile('artifacts/browser-results.json', JSON.stringify({ buildEntry, sourceHashes, results, errors, failure: String(error) }, null, 2)).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
