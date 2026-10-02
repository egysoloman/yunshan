import { chromium } from '/tmp/yunshan-v4-root-coherent-04/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

import { requireRootReady, verifyFixedSource } from './fixed-source-gate.mjs';
await requireRootReady(); await verifyFixedSource();
// A declared controlled-fixture continuation, not an ordinary newgame journey.
// It changes only the old purchase setup: native W follows same-source physical
// waypoints. No intermediate position/floor/role/money/stock/clock writes.
async function walkMarketSaleSetup(buildingId) {
  const prepared = JSON.parse(await readFile('/tmp/yunshan-v4-browser-visual-prepared-04/body-fixtures.json','utf8'));
  const site = prepared.sites.find(s => s.id === buildingId);
  if (!site) throw Error(`Actual original browser market ${buildingId} has no frozen fixture`);
  const route = site.routes.find(r => r.purpose === 'sale');
  if (!route?.fromInside) throw Error('Frozen real sale-point route unavailable');
  const trace = {scope:'Original browser controlled ground fixture continued by actual native KeyW to real shared sale point; no intermediate body or economic/identity/clock mutation.',
    buildingId, route:route.fromInside, target:route.position, samples:[], keys:[]};
  const initial = await page.evaluate(site => {
    const d=window.__YUNSHAN__, b=d.world.buildings.find(b=>b.id===site.id);
    if(d.world.seed!==20261001||d.world.layoutVersion!=='current-v4'||!b||JSON.stringify(b.door)!==JSON.stringify(site.door)||b.floorPlanProfile!==site.profile)throw Error('Actual DOM world disagrees with frozen provider fixture');
    return {position:d.controller.position,floor:d.controller.floor,inside:d.controller.inside?.id,
      money:d.simulation.state.player.money,stock:d.simulation.state.shops.find(b=>b.buildingId===site.id)?.inventory,
      hour:d.simulation.state.hour,role:d.simulation.state.player.role,identities:[...d.simulation.state.player.identities]};
  },site);
  trace.initial=initial;
  await page.locator('canvas').first().click({position:{x:750,y:400}});
  try {
    const waypoints=route.fromInside.slice(1);
    for (let index=0;index<waypoints.length;index++) {
      const target=waypoints[index],last=index===waypoints.length-1;let legStart=null;
      const deadline=Date.now()+120_000;
      let settled=false;
      while(Date.now()<deadline) {
        const probe=await page.evaluate(target=>{
          const d=window.__YUNSHAN__,p=d.controller.position,dx=target.x-p.x,dz=target.z-p.z;
          // A route-directed camera heading is declared fixture setup. Physics
          // remains the actual main RAF + unchanged controller motor.
          d.controller.yaw=Math.atan2(-dx,-dz);d.controller.pitch=-.05;d.controller.orient();
          return {at:performance.now(),position:p,floor:d.controller.floor,inside:d.controller.inside?.id,
            distance:Math.hypot(dx,dz),blocked:d.controller.blockedAccess};
        },target);
        trace.samples.push(probe);
        if(!legStart)legStart=probe.position;
        const dx=target.x-legStart.x,dz=target.z-legStart.z,len=Math.hypot(dx,dz)||1;
        const px=probe.position.x-legStart.x,pz=probe.position.z-legStart.z;
        const passed=(px*dx+pz*dz)/len>=len-.1 && Math.abs(px*dz-pz*dx)/len<=.75;
        // The terminal tolerance is inside the actual authoritative 2m sale
        // radius. Intermediate points may be physically passed on slow frames.
        if(probe.distance<=(last?1.95:1.15)||(!last&&passed)){settled=true;break;}
        trace.keys.push({at:Date.now(),action:'down',code:'KeyW'});await page.keyboard.down('KeyW');
        try {await page.waitForFunction(before=>{const p=window.__YUNSHAN__.controller.position;return Math.hypot(p.x-before.x,p.z-before.z)>.05;},probe.position,{timeout:20_000,polling:25});}
        finally {await page.keyboard.up('KeyW');}
        await page.keyboard.up('KeyW');trace.keys.push({at:Date.now(),action:'up',code:'KeyW'});
      }
      if(!settled)throw Error(`Actual native W sale setup did not reach ${JSON.stringify(target)}`);
    }
    trace.final=await page.evaluate(id=>{
      const d=window.__YUNSHAN__;
      return {position:d.controller.position,floor:d.controller.floor,inside:d.controller.inside?.id,
        money:d.simulation.state.player.money,stock:d.simulation.state.shops.find(b=>b.buildingId===id)?.inventory,
        hour:d.simulation.state.hour,role:d.simulation.state.player.role,identities:[...d.simulation.state.player.identities]};
    },buildingId);
    for(const field of ['money','stock','hour','role','identities'])if(JSON.stringify(trace.initial[field])!==JSON.stringify(trace.final[field]))throw Error(`Sale setup changed actual ${field}`);
    trace.status='reached-sale-point';
  }catch(error){trace.status='failed';trace.failure=String(error);throw error;}
  finally {await page.keyboard.up('KeyW');await writeFile('artifacts/market-sale-native-W-v2.json',JSON.stringify(trace,null,2));}
}

const port = 4173;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', data => { output += data; });
server.stderr.on('data', data => { output += data; });
let browser;
let page;
let aviationStage = null;
const errors = [];
const results = [];
let buildEntry = null;
let sourceHashes = {};
const harnessSHA256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
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
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
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
  await walkMarketSaleSetup(entered.id);
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

  // A legitimate autosave can replace the earlier manual slot while the driving
  // check runs. Never assume load() leaves the player on foot, and never clear a
  // saved vehicle/driver field just to make the aircraft fixture boardable.
  aviationStage = 'restore and leave any legitimately saved road vehicle';
  const restoredGround = await page.evaluate(() => {
    const d = window.__YUNSHAN__, id = d.simulation.state.player.vehicleId;
    return { vehicleId: id, driving: d.simulation.isDriving(), vehicle: d.simulation.state.vehicles.find(v => v.id === id), position: d.controller.position, paused: d.simulation.state.paused };
  });
  console.log('AIRCRAFT_GROUND_RESTORE', JSON.stringify(restoredGround));
  if (restoredGround.vehicleId) {
    assert(restoredGround.driving, 'The saved road fixture must retain its actual driving authority');
    await page.locator('canvas').first().click({ position: { x: 750, y: 400 } });
    await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 0 }));
    await page.keyboard.down('Space');
    try {
      await page.waitForFunction(() => {
        const { simulation, world } = window.__YUNSHAN__, vehicle = simulation.state.vehicles.find(v => v.id === simulation.state.player.vehicleId);
        return vehicle && vehicle.state !== 'moving' && world.nodes.some(n => Math.hypot(vehicle.position.x - n.position.x, vehicle.position.y - n.position.y, vehicle.position.z - n.position.z) <= 45);
      }, null, { timeout: 45_000 });
    } finally { await page.keyboard.up('Space'); }
    await page.keyboard.press('KeyE');
    assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.player.vehicleId), null, 'Native E must leave the stopped road vehicle at a legal node');
  }
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 1 }));
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), null);
  const jetNavigationBefore = await page.evaluate(() => ({ ...window.__YUNSHAN__.simulation.state.player.position }));
  await page.getByTestId('mode-jet').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), null);
  assert.deepEqual(await page.evaluate(() => window.__YUNSHAN__.simulation.state.player.position), jetNavigationBefore, 'Going to the airport plans a real route without moving the body');
  // Ground position and identities are controlled diagnostic starting states.
  // Every rental, boarding, flight, return and exit below uses the real rules and
  // native input; the fixture never writes activeAircraftId or an airborne mode.
  const jetFixture = await page.evaluate(() => {
    const { simulation, controller, actions } = window.__YUNSHAN__;
    const craft = simulation.state.aviation.aircraft.find(c => c.kind === 'jet');
    if (!craft || craft.status !== 'parked' || simulation.state.player.vehicleId || simulation.state.aviation.activeAircraftId) throw Error('The military fixture must begin on foot beside a real parked city aircraft');
    simulation.state.player.position = { ...craft.position, x: craft.position.x + 4, y: craft.position.y - .6 };
    simulation.state.player.identities = ['traveler']; simulation.state.player.role = 'traveler';
    controller.setMode('walk', simulation.state.player.position); actions.command({ type: 'setTime', value: 10 });
    simulation.state.weather = '晴'; simulation.state.visibility = 1;
    return { id: craft.id, position: { ...craft.position }, foot: { ...simulation.state.player.position }, navigationTarget: simulation.state.journey.targetId };
  });
  await page.locator('canvas').first().click({ position: { x: 750, y: 400 } });
  for (const identities of [['traveler'], ['traveler', 'driver'], ['traveler', 'soldier']]) {
    aviationStage = `military on-site denial: ${identities.join('+')}`;
    await page.evaluate(ids => { const p = window.__YUNSHAN__.simulation.state.player; p.identities = ids; p.role = ids.at(-1); }, identities);
    const approach = await page.evaluate(id => {
      const d = window.__YUNSHAN__, craft = d.simulation.state.aviation.aircraft.find(c => c.id === id);
      return { vehicleId: d.simulation.state.player.vehicleId, nearbyId: d.getView().nearbyAircraft?.id, metres: Math.hypot(craft.position.x - d.controller.position.x, craft.position.y - d.controller.position.y, craft.position.z - d.controller.position.z) };
    }, jetFixture.id);
    assert.equal(approach.vehicleId, null); assert.equal(approach.nearbyId, jetFixture.id); assert(approach.metres <= 6, JSON.stringify(approach));
    await page.keyboard.press('KeyE');
    assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
    assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), null);
    assert.match(await page.evaluate(() => window.__YUNSHAN__.getView().notice), /卫士.*驾驶员/);
    assert.deepEqual(await page.evaluate(() => window.__YUNSHAN__.simulation.state.player.position), jetFixture.foot);
  }
  aviationStage = 'native military button with both actual required identities';
  await page.evaluate(() => { const p = window.__YUNSHAN__.simulation.state.player; p.identities = ['traveler', 'driver', 'soldier']; p.role = 'driver'; });
  const cityButtonBefore = await page.evaluate(id => {
    const d = window.__YUNSHAN__, s = d.simulation.state, craft = s.aviation.aircraft.find(c => c.id === id);
    return { mode: d.controller.mode, position: { ...s.player.position }, controllerPosition: d.controller.position, vehicleId: s.player.vehicleId, active: s.aviation.activeAircraftId, identities: s.player.identities, driver: d.simulation.hasIdentity('driver'), soldier: d.simulation.hasIdentity('soldier'), alive: s.extension.actorProfiles.player.alive, status: craft.status, charging: craft.charging, battery: craft.battery, energy: s.energy, visibility: s.visibility, weather: s.weather, metres: Math.hypot(craft.position.x - s.player.position.x, craft.position.y - s.player.position.y, craft.position.z - s.player.position.z) };
  }, jetFixture.id);
  assert.equal(cityButtonBefore.vehicleId, null); assert.equal(cityButtonBefore.active, null); assert(cityButtonBefore.metres <= 6);
  await page.getByTestId('mode-jet').click();
  const cityButtonAfter = await page.evaluate(() => ({ mode: window.__YUNSHAN__.controller.mode, active: window.__YUNSHAN__.simulation.state.aviation.activeAircraftId, notice: window.__YUNSHAN__.getView().notice }));
  await writeFile('artifacts/aircraft-city-button-probe.json', JSON.stringify({ restoredGround, before: cityButtonBefore, after: cityButtonAfter }, null, 2));
  console.log('AIRCRAFT_CITY_BUTTON_PROBE', JSON.stringify({ before: cityButtonBefore, after: cityButtonAfter }));
  assert.equal(cityButtonAfter.mode, 'jet', 'The city button must actually board a nearby eligible aircraft');
  assert.equal(cityButtonAfter.active, jetFixture.id);
  // Keep the button assertion above; E is an additional real cockpit entrance,
  // never a fallback for a failed button. Paused, parked aircraft can be exited.
  await page.keyboard.press('KeyE');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), null);
  aviationStage = 'native E military boarding with both actual required identities';
  await page.locator('canvas').first().click({ position: { x: 750, y: 400 } });
  await page.keyboard.press('KeyE');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'jet');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), jetFixture.id);
  aviationStage = 'military keyboard takeoff and flight';
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
  aviationStage = 'military original sixty-second native return and exit';
  await page.keyboard.press('KeyE');
  await page.waitForFunction(id => window.__YUNSHAN__.simulation.state.aviation.aircraft.find(c => c.id === id)?.status === 'parked', jetFixture.id, { timeout: 60_000 });
  await page.keyboard.press('KeyE');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  check('military identity, actual keyboard VTOL flight, passenger position, safe return and exit', { metres: Math.hypot(jetStart.x - jetEnd.position.x, jetStart.z - jetEnd.position.z), battery: jetEnd.battery });

  aviationStage = 'drone navigation and native rental';
  await page.evaluate(() => window.__YUNSHAN__.actions.command({ type: 'pause', value: 1 }));
  const droneNavigationBefore = await page.evaluate(() => ({ position: { ...window.__YUNSHAN__.simulation.state.player.position }, money: window.__YUNSHAN__.simulation.state.player.money }));
  await page.getByTestId('mode-drone').click();
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'walk');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), null);
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.player.money), droneNavigationBefore.money);
  assert.deepEqual(await page.evaluate(() => window.__YUNSHAN__.simulation.state.player.position), droneNavigationBefore.position);
  const droneFixture = await page.evaluate(() => {
    const { simulation, controller, actions } = window.__YUNSHAN__;
    actions.command({ type: 'pause', value: 1 });
    const craft = simulation.state.aviation.aircraft.find(c => c.kind === 'drone');
    if (!craft || craft.status !== 'parked' || craft.reserved || simulation.state.player.vehicleId || simulation.state.aviation.activeAircraftId) throw Error('The rental fixture must begin on foot beside an actual unleased parked city drone');
    simulation.state.player.position = { ...craft.position, x: craft.position.x + 2, y: craft.position.y - .6 };
    controller.setMode('walk', simulation.state.player.position);
    return { id: craft.id, position: { ...craft.position }, money: simulation.state.player.money, treasury: simulation.state.treasury };
  });
  await page.locator('canvas').first().click({ position: { x: 750, y: 400 } });
  assert.equal(await page.evaluate(id => window.__YUNSHAN__.getView().nearbyAircraft?.id === id, droneFixture.id), true);
  await page.keyboard.press('KeyE');
  const rental = await page.evaluate(() => ({ cash: window.__YUNSHAN__.simulation.state.player.money, treasury: window.__YUNSHAN__.simulation.state.treasury, active: window.__YUNSHAN__.simulation.state.aviation.activeAircraftId }));
  assert.equal(rental.cash, droneFixture.money - 24); assert.equal(rental.treasury, droneFixture.treasury + 24); assert.equal(rental.active, null);
  await page.keyboard.press('KeyE');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.controller.mode), 'drone');
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.simulation.state.aviation.activeAircraftId), droneFixture.id);
  aviationStage = 'drone keyboard takeoff and original sixty-second native return';
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
  aviationStage = null;

  await page.evaluate(() => window.__YUNSHAN__.actions.setQuality('low'));
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__YUNSHAN__.getView().quality), 'low');
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  assert.equal(horizontalOverflow, false);
  check('quality changes and compact viewport remain usable', { horizontalOverflow });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  await writeFile('artifacts/browser-results.json', JSON.stringify({ browser: 'Chromium with SwiftShader on Linux', buildEntry, sourceHashes, harnessSHA256, note: 'Functional rendering verification with controlled ground and identity fixtures; aircraft rental, boarding, flight and exit use actual rules and native inputs. These FPS do not represent macOS hardware performance.', results, errors }, null, 2));
  console.log(`${results.length} browser checks passed, no uncaught browser or console errors.`);
} catch (error) {
  console.error(error);
  console.error(output);
  if (aviationStage && page && !page.isClosed()) {
    const diagnostic = await page.evaluate(stage => { const d = window.__YUNSHAN__; return { stage, tick: d.simulation.state.tick, paused: d.simulation.state.paused, speed: d.simulation.state.speed, hour: d.simulation.state.hour, energy: d.simulation.state.energy, weather: d.simulation.state.weather, visibility: d.simulation.state.visibility, player: d.simulation.state.player, mode: d.controller.mode, controllerPosition: d.controller.position, inside: d.controller.inside?.id, floor: d.controller.floor, aviation: d.simulation.state.aviation, notice: d.getView().notice, fps: d.getView().fps }; }, aviationStage).catch(diagnosticError => ({ stage: aviationStage, diagnosticError: String(diagnosticError) }));
    await writeFile('artifacts/aviation-failure.json', JSON.stringify(diagnostic, null, 2)).catch(() => {});
  }
  await writeFile('artifacts/browser-results.json', JSON.stringify({ buildEntry, sourceHashes, harnessSHA256, results, errors, aviationStage, failure: String(error) }, null, 2)).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
