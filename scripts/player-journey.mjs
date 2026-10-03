import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run with: node --import tsx scripts/player-journey.mjs --plan-only
// After a fresh build: node --import tsx scripts/player-journey.mjs
// To inspect an immutable copy: add --workspace=/tmp/your-built-snapshot
// --resume-after=home --resume-from=/path/results.json verifies public state
// from the actual profile, then skips only milestones already evidenced.
// --profile=/path keeps real browser IndexedDB between milestones. SIGUSR2
// requests UI pause/save and browser closure at the next facility or safe
// walking input boundary. A partial road checkpoint never completes its stage.
// The Node-side map planner reads the same public, static city definition.
// Browser actions use only the ordinary URL, keyboard, mouse and visible DOM.
// This script never imports Simulation, reads browser internals, edits a save,
// assigns a role/balance/position, or moves the clock with the time slider.
const options = new Map(process.argv.slice(2).map(argument => {
  const split = argument.indexOf('=');
  return split < 0 ? [argument, true] : [argument.slice(0, split), argument.slice(split + 1)];
}));
const root = path.resolve(String(options.get('--workspace') ?? path.join(import.meta.dirname, '..')));
const output = path.resolve(String(options.get('--output') ?? 'artifacts/player-journey'));
const planOnly = options.has('--plan-only');
const stopAfter = String(options.get('--stop-after') ?? 'save');
assert(['arrival', 'shopping', 'home', 'school', 'qualification', 'vehicle', 'public', 'save'].includes(stopAfter));
const journeyStages = ['arrival', 'shopping', 'home', 'school', 'qualification', 'vehicle', 'public', 'save'];
const resumeAfter = String(options.get('--resume-after') ?? '');
const resumeFrom = options.has('--resume-from') ? path.resolve(String(options.get('--resume-from'))) : null;
const resumeCheckpointName = String(options.get('--resume-checkpoint') ?? `${resumeAfter}-saved`);
assert(Boolean(resumeAfter) === Boolean(resumeFrom), 'Resume requires --resume-after and the preceding public results via --resume-from');
let resumeReference, resumeCheckpoint, resumeReferenceHash;
if (resumeAfter) {
  assert(['home', 'school', 'qualification', 'vehicle', 'public'].includes(resumeAfter), 'Resume from a saved intermediate milestone after establishing a home');
  assert(options.has('--profile'), 'Continue using the actual browser profile; never manufacture a new save');
  const bytes = await readFile(resumeFrom); resumeReferenceHash = createHash('sha256').update(bytes).digest('hex');
  resumeReference = JSON.parse(bytes);
  assert(['passed', 'paused-at-checkpoint'].includes(resumeReference.status), 'The preceding saved milestone must have actually succeeded');
  assert.equal(path.resolve(String(resumeReference.persistentProfile)), path.resolve(String(options.get('--profile'))), 'Resume the same actual browser profile');
  assert([`${resumeAfter}-saved`, 'walking-saved'].includes(resumeCheckpointName), 'Resume an actual saved facility or partial road checkpoint');
  resumeCheckpoint = resumeReference.records.findLast(record => record.name === resumeCheckpointName);
  assert(resumeCheckpoint, 'The public results must contain an actual UI-saved checkpoint');
  if (resumeCheckpointName === 'walking-saved') {
    assert.equal(resumeCheckpoint.completedStage, resumeAfter, 'A partial walk does not complete its destination stage');
    assert(journeyStages.indexOf(resumeCheckpoint.incompleteStage) > journeyStages.indexOf(resumeAfter));
  }
  assert(journeyStages.indexOf(stopAfter) > journeyStages.indexOf(resumeAfter), 'Choose a later real milestone');
}
const resumeIndex = journeyStages.indexOf(resumeAfter);
const port = Number(options.get('--port') ?? 4189);
const viewportMatch = String(options.get('--viewport') ?? '1440x900').match(/^(\d+)x(\d+)$/);
assert(viewportMatch, 'Use --viewport=WIDTHxHEIGHT');
const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
assert(viewport.width >= 640 && viewport.height >= 480);
const { createWorld, CITY_LAYOUT_VERSIONS, CURRENT_CITY_LAYOUT } = await import(path.join(root, 'src/world.ts'));
const plannedLayout = String(options.get('--layout') ?? CURRENT_CITY_LAYOUT);
assert(CITY_LAYOUT_VERSIONS.includes(plannedLayout), 'Plan only a supported code-owned world layout');
const world = createWorld(20261001, plannedLayout);
const { savedWorldFingerprint } = await import(path.join(root, 'src/persistence/world-layout.ts'));
const { planWalkingJourney } = await import(path.join(root, 'src/journey.ts'));
const { buildingLocalPosition, buildingWorldPosition, findBuildingFloorPlanRoute, getBuildingEntrance, getBuildingUsePoints } = await import(path.join(root, 'src/architecture-floor-plan.ts'));
const plannedFingerprint = savedWorldFingerprint(world);
const nodeMap = new Map(world.nodes.map(node => [node.id, node]));
const adjacency = new Map();
for (const edge of world.edges.filter(edge => ['road', 'bridge'].includes(edge.mode))) {
  for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
    const list = adjacency.get(from) ?? [];
    list.push({ to, edge }); adjacency.set(from, list);
  }
}
const trees = new Map();
function tree(origin) {
  if (trees.has(origin)) return trees.get(origin);
  const costs = new Map([[origin, 0]]), previous = new Map(), open = new Set([origin]);
  while (open.size) {
    let current;
    for (const id of open) if (current === undefined || costs.get(id) < costs.get(current)) current = id;
    open.delete(current);
    for (const { to, edge } of adjacency.get(current) ?? []) {
      const cost = costs.get(current) + edge.length;
      if (cost < (costs.get(to) ?? Infinity)) { costs.set(to, cost); previous.set(to, { from: current, edge }); open.add(to); }
    }
  }
  const result = { costs, previous }; trees.set(origin, result); return result;
}
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const separation = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function nearestNode(position) {
  return world.nodes.filter(node => adjacency.has(node.id)).sort((a, b) => separation(a.position, position) - separation(b.position, position))[0];
}
function eligible(kind) {
  return world.buildings.filter(building => kind.includes(building.kind) && adjacency.has(`${building.id}-door`)
    && (building.publicFloors === undefined || building.publicFloors > 0));
}
function publicChoices(position, kinds) {
  const allowed = new Set(eligible(kinds).map(building => building.id));
  return kinds.flatMap(kind => world.buildings.filter(building => building.kind === kind)
    .sort((a, b) => separation(a.door, position) - separation(b.door, position)).slice(0, 8))
    .filter(building => allowed.has(building.id));
}
function nearestBuilding(origin, kinds, position = nodeMap.get(origin).position) {
  const costs = tree(origin).costs;
  const choices = publicChoices(position, kinds).filter(building => costs.has(`${building.id}-door`));
  choices.sort((a, b) => costs.get(`${a.id}-door`) - costs.get(`${b.id}-door`));
  assert(choices.length, `No public ${kinds.join('/')} has a ground-road route`);
  return choices[0];
}
function route(origin, target) {
  const { previous, costs } = tree(origin);
  assert(costs.has(target), `No walkable road/bridge route from ${origin} to ${target}`);
  const legs = []; let cursor = target;
  while (cursor !== origin) { const leg = previous.get(cursor); assert(leg); legs.unshift(leg); cursor = leg.from; }
  const points = [{ ...nodeMap.get(origin).position }];
  for (const leg of legs) for (const point of leg.edge.from === leg.from ? leg.edge.points : [...leg.edge.points].reverse()) {
    if (separation(points.at(-1), point) > .01) points.push({ ...point });
  }
  return { points, edgeIds: legs.map(leg => leg.edge.id), metres: costs.get(target) };
}
// Remove points on straight pavement; retain bends to avoid cutting across cliffs.
function simplify(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = result.at(-1), b = points[i], c = points[i + 1];
    const dx = c.x - a.x, dz = c.z - a.z, squared = dx * dx + dz * dz;
    const t = squared ? Math.max(0, Math.min(1, ((b.x - a.x) * dx + (b.z - a.z) * dz) / squared)) : 0;
    const deviation = Math.hypot(b.x - a.x - t * dx, b.z - a.z - t * dz);
    const heightDeviation = Math.abs(b.y - a.y - t * (c.y - a.y));
    if (deviation > .12 || heightDeviation > .25 || horizontal(a, c) > 35) result.push(b);
  }
  result.push(points.at(-1)); return result;
}
const origin = nearestNode(world.spawn).id;
const market = nearestBuilding(origin, ['market'], world.spawn);
const home = nearestBuilding(`${market.id}-door`, ['home'], market.door);
let best;
for (const school of publicChoices(home.door, ['school'])) {
  const first = tree(`${home.id}-door`).costs.get(`${school.id}-door`);
  if (first === undefined) continue;
  for (const station of publicChoices(school.door, ['station', 'airport'])) {
    const second = tree(`${school.id}-door`).costs.get(`${station.id}-door`);
    if (second === undefined) continue;
    const hall = nearestBuilding(`${station.id}-door`, ['hall'], station.door);
    const third = tree(`${station.id}-door`).costs.get(`${hall.id}-door`);
    const cost = first + second + third;
    if (!best || cost < best.cost) best = { school, station, hall, cost };
  }
}
assert(best, 'No public school, driving examination site and hall share a walking network');
const places = { market, home, school: best.school, station: best.station, hall: best.hall };
const plannedLegs = []; let previous = origin;
for (const [purpose, building] of Object.entries(places)) {
  const leg = route(previous, `${building.id}-door`);
  plannedLegs.push({ purpose, buildingId: building.id, buildingName: building.name, districtId: building.districtId,
    door: building.door, ...leg, controlPoints: simplify(leg.points) });
  previous = `${building.id}-door`;
}
const plan = { seed: world.seed, layout: world.layoutVersion, recipe: plannedLayout, fingerprint: plannedFingerprint, origin, spawn: world.spawn,
  scope: 'Static ground-road map planning; no browser journey has run',
  walkingMetres: plannedLegs.reduce((sum, leg) => sum + leg.metres, 0),
  fixedRemainingFees: { schoolCourse: 40, driverExamination: 80, roadPassengerFare: 4, publicBudgetReport: 20, petition: 10, total: 154 },
  feeScope: 'Planned fixed native fees after home; additional real food/rest purchases are recorded when made.', legs: plannedLegs };
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'route-plan.json'), JSON.stringify(plan, null, 2));
if (planOnly) { console.log(JSON.stringify({ scope: plan.scope, recipe: plan.recipe, layout: plan.layout, fingerprint: plan.fingerprint, fixedRemainingFees: plan.fixedRemainingFees, walkingMetres: plan.walkingMetres,
  stops: plannedLegs.map(leg => ({ purpose: leg.purpose, building: leg.buildingName, metres: leg.metres, edges: leg.edgeIds.length })) }, null, 2)); }
else await run();

async function run() {
  const { chromium } = await import('playwright-core');
  const sources = async () => Object.fromEntries(await Promise.all((await readdir(path.join(root, 'src'), { recursive: true }))
    .filter(name => /\.(ts|css)$/.test(name)).sort().map(async name => [`src/${name}`, createHash('sha256').update(await readFile(path.join(root, 'src', name))).digest('hex')])));
  const sourceHashes = await sources();
  const harnessHash = createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  const index = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  const buildEntry = index.match(/src="([^"]+\.js)"/)?.[1]; assert(buildEntry);
  const buildFile = path.join(root, 'dist', buildEntry);
  const buildHash = createHash('sha256').update(await readFile(buildFile)).digest('hex');
  let server, startup = '', browser, page, stage = 'startup', failure, requestedCheckpoint = false, stoppedAtCheckpoint = false;
  const records = [], inputs = [], errors = [];
  let completedStage = resumeAfter || null;
  class CheckpointStop extends Error {}
  const requestCheckpoint = () => { requestedCheckpoint = true; inputs.push({ stage, type: 'checkpoint-request', at: new Date().toISOString() }); };
  process.on('SIGUSR2', requestCheckpoint);
  const base = new URL(String(options.get('--url') ?? `http://127.0.0.1:${port}/`));
  assert(!base.searchParams.has('debug'), 'The journey requires an ordinary, non-diagnostic URL');
  if (resumeReference?.url) assert.equal(base.origin, new URL(resumeReference.url).origin, 'IndexedDB continuation needs the same actual origin');
  if (!options.has('--url')) {
    server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', data => { startup += data; }); server.stderr.on('data', data => { startup += data; });
  }
  const ref = name => page.locator(`[data-ref="${name}"]`);
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const deadlineMs = Number(options.get('--timeout-ms') ?? 1_800_000);
  const started = Date.now();
  let yaw;
  async function until(predicate, description, timeout = 60_000) {
    const start = Date.now();
    while (Date.now() - start < timeout && Date.now() - started < deadlineMs) { if (await predicate()) return; await sleep(150); }
    throw new Error(`Timed out: ${description}`);
  }
  async function coordinates() {
    const values = (await ref('coordinates').textContent())?.match(/-?\d+/g)?.map(Number);
    assert(values?.length === 3, 'The public coordinate HUD must be readable');
    return { x: values[0], y: values[1], z: values[2] };
  }
  async function snapshot() {
    return { at: new Date().toISOString(), stage, coordinates: await coordinates(),
      district: await ref('district-name').textContent(), clock: await ref('clock').textContent(), day: await ref('day').textContent(),
      mode: await ref('view-mode').textContent(), location: await ref('landscape-description').textContent(),
      context: await ref('context-body').textContent(), toast: await ref('toast').textContent(),
      wallet: await ref('player-money').textContent(), identities: await ref('identities').textContent(),
      home: await ref('player-home').textContent(), growth: await ref('growth').textContent(),
      render: await ref('render-stats').textContent(), needs: await ref('needs').textContent(), petitions: await ref('culture-petitions').textContent() };
  }
  async function checkpoint(name, extra = {}) {
    if (journeyStages.includes(name)) completedStage = name;
    records.push({ name, ...(await snapshot()), ...extra });
    await writeFile(path.join(output, 'progress.json'), JSON.stringify({ scope: 'Normal-URL keyboard/mouse journey with public DOM observations', records, inputs, errors }, null, 2));
    await page.screenshot({ path: path.join(output, `${name}.png`), timeout: 120_000 });
    console.log(`PASS ${name}`);
    if (requestedCheckpoint && ['shopping', 'home', 'school', 'qualification', 'vehicle', 'public'].includes(name)) {
      await shouldStop(name, true); throw new CheckpointStop();
    }
  }
  async function panel(pane) {
    if (await page.getByTestId('panel-toggle').getAttribute('aria-expanded') !== 'true') await clickLiveButton(page.getByTestId('panel-toggle'));
    await clickLiveButton(page.locator(`[data-pane="${pane}"]`));
  }
  async function closePanel() {
    if (await page.getByTestId('panel-toggle').getAttribute('aria-expanded') === 'true') await clickLiveButton(page.getByTestId('panel-toggle'));
  }
  async function wallet() {
    await panel('life'); await sleep(850);
    const amount = Number((await ref('player-money').textContent()).replace(/[^\d.-]/g, '')); assert(Number.isFinite(amount));
    await closePanel(); return amount;
  }
  async function paused(value) {
    const button = page.getByTestId('pause-toggle');
    if (await button.getAttribute('aria-pressed') !== String(value)) await clickLiveButton(button);
    await until(async () => await button.getAttribute('aria-pressed') === String(value), `public pause=${value}`);
  }
  async function context(kind) {
    const tab = page.locator(`[data-context="${kind}"]`);
    if (await tab.count() && await tab.getAttribute('aria-pressed') !== 'true') await clickLiveButton(tab);
  }
  async function clickLiveButton(button) {
    assert.equal(await button.count(), 1, 'A live public action must identify one actual button');
    assert(await button.isVisible() && await button.isEnabled(), 'The public action must be visible and enabled');
    // Dynamic cards are rebuilt between frames. Skip Playwright's two-frame
    // geometry-stability wait; click still scrolls and sends real mouse input.
    await button.click({ force: true });
    inputs.push({ stage, type: 'mouse-click', target: button.toString() });
  }
  async function choosePublicOption(select, value) {
    const values = await select.locator('option').evaluateAll(items => items.map(item => item.value));
    const index = values.indexOf(String(value)); assert(index >= 0, `A public option must exist: ${value}`);
    await select.click(); await page.keyboard.press('Home');
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await select.inputValue(), String(value));
    inputs.push({ stage, type: 'keyboard-select', target: select.toString(), value: String(value) });
  }
  async function typePublicText(input, value) {
    await input.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
    if (value) await page.keyboard.insertText(value);
    assert.equal(await input.inputValue(), value);
    inputs.push({ stage, type: 'keyboard-text', target: input.toString(), value });
  }
  async function focusWorld() {
    const canvas = page.locator('.world-stage canvas').first(), box = await canvas.boundingBox(); assert(box);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    inputs.push({ stage, type: 'mouse-click', target: 'world canvas', purpose: 'keyboard movement focus' });
  }
  async function turn(targetYaw) {
    let delta = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
    const canvas = page.locator('.world-stage canvas').first(), box = await canvas.boundingBox(); assert(box);
    while (Math.abs(delta) > 1e-5) {
      const span = Math.min(1.8, box.width * .4 * .003), rotation = Math.max(-span, Math.min(span, delta)), dx = -rotation / .003;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y); await page.mouse.up();
      inputs.push({ stage, type: 'mouse-drag', dx, dy: 0 }); yaw += rotation; delta -= rotation;
    }
  }
  async function eatPortableMealIfNeeded() {
    await panel('life'); await sleep(850);
    const needsBefore = await ref('needs').textContent(), hungerBefore = Number(needsBefore.match(/饱腹\s*(\d+)/)?.[1]);
    assert(Number.isFinite(hungerBefore), 'Read actual hunger from the public life panel');
    const meal = ref('cooking-actions').locator('[data-command="eat"][data-target="food"]');
    if (hungerBefore <= 55 && await meal.count() === 1 && await meal.isEnabled()) {
      const inventoryBefore = await ref('inventory').textContent(), walletBefore = await ref('player-money').textContent();
      await clickLiveButton(meal);
      await until(async () => /实际食用一份随身食品/.test(await ref('toast').textContent()), 'actual carried meal consumption');
      await sleep(850);
      const needsAfter = await ref('needs').textContent(), inventoryAfter = await ref('inventory').textContent(), hungerAfter = Number(needsAfter.match(/饱腹\s*(\d+)/)?.[1]);
      assert(hungerAfter > hungerBefore, 'Actual carried food raises public hunger');
      assert.notEqual(inventoryAfter, inventoryBefore, 'The portion actually leaves the public inventory');
      assert.equal(await ref('player-money').textContent(), walletBefore, 'Eating already purchased food does not debit another meal');
      await closePanel();
      await checkpoint('meal-on-road', { needsBefore, needsAfter, inventoryBefore, inventoryAfter, walletBefore,
        scope: 'Real native consumption of one previously purchased portion during walking; no destination milestone is completed.' });
    } else await closePanel();
    await focusWorld();
  }
  let walkingPulses = 0;
  async function walkPoint(target, tolerance = 3) {
    let stagnant = 0, pulses = 0;
    for (;;) {
      const before = await coordinates(), remaining = horizontal(before, target);
      // HUD positions are rounded to metres. A three-metre road waypoint
      // tolerance also avoids oscillating across a point on slow GPU frames.
      if (remaining <= tolerance) return;
      assert(++pulses < 500, 'A waypoint requires fewer than 500 real input pulses');
      if (++walkingPulses % 20 === 0) await eatPortableMealIfNeeded();
      await turn(Math.atan2(-(target.x - before.x), -(target.z - before.z)));
      const sprint = remaining > 22;
      if (sprint) await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('KeyW');
      const travel = Math.max(tolerance === 3 ? 1 : .1, remaining - tolerance);
      try { await until(async () => { if (requestedCheckpoint) return true; const here = await coordinates(); return horizontal(here, before) >= travel || horizontal(here, target) <= tolerance; }, 'actual walking displacement', 45_000); }
      catch (error) { if (++stagnant >= 2) throw new Error(`Walking blocked at ${JSON.stringify(before)} toward ${JSON.stringify(target)}: ${error.message}`); }
      finally { await page.keyboard.up('KeyW'); if (sprint) await page.keyboard.up('ShiftLeft'); }
      const after = await coordinates();
      inputs.push({ stage, type: 'walk', keys: sprint ? ['KeyW', 'ShiftLeft'] : ['KeyW'], before, after, target });
      if (inputs.length % 4 === 0 || horizontal(after, target) <= tolerance) {
        await writeFile(path.join(output, 'walking-progress.json'), JSON.stringify({ at: new Date().toISOString(), stage, coordinates: after, target, remaining: horizontal(after, target), inputCount: inputs.length }, null, 2));
        console.log(`Walking ${stage}: ${after.x}/${after.y}/${after.z}`);
      }
      if (requestedCheckpoint && journeyStages.indexOf(completedStage) >= journeyStages.indexOf('home') && stage !== completedStage) {
        await paused(true); await panel('settings'); await clickLiveButton(page.getByTestId('save'));
        await until(async () => /旅程已保存在/.test(await ref('toast').textContent()), 'actual partial road IndexedDB save');
        await panel('life'); await sleep(850); await closePanel();
        await checkpoint('walking-saved', { completedStage, incompleteStage: stage, target,
          scope: 'Actual paused UI save during ground travel. The destination facility and its action have not been reached or passed.',
          persistentProfile: options.has('--profile') ? path.resolve(String(options.get('--profile'))) : null });
        throw new CheckpointStop();
      }
      if (horizontal(after, before) >= 1) stagnant = 0;
    }
  }
  async function walkToNode(nodeId) {
    await closePanel(); await page.keyboard.press('Escape');
    const before = await coordinates(), leg = planWalkingJourney(world, before, nodeId);
    assert(leg, 'The production ground planner must find a physical route from the actual saved body');
    assert.equal(leg.stairsFromFloor, null, 'Ground travel starts outside after an actual facility exit');
    inputs.push({ stage, type: 'planned-ground-route', source: 'src/journey.ts', sourceSHA256: sourceHashes['src/journey.ts'],
      from: before, targetId: nodeId, points: leg.points, edgeIds: leg.edgeIds, metres: leg.metres,
      scope: 'Pure production road/bridge planner using the public current body; no browser state or position writes.' });
    for (const point of simplify(leg.points)) await walkPoint(point);
    return leg;
  }
  async function enter(building) {
    await panel('transit'); await choosePublicOption(ref('destination-kind'), building.kind);
    const navigation = page.locator(`[data-navigation="${building.id}"]`);
    assert(await navigation.count(), 'The planned public building must be offered by the ordinary destination selector');
    await clickLiveButton(navigation);
    await until(async () => (await ref('walking-guide').textContent()).includes(building.name), 'public walking route selection');
    const publicPoints = await ref('walking-guide').locator('[data-waypoint]').evaluateAll(items => items.map(item => ({
      index: Number(item.dataset.waypoint), x: Number(item.dataset.x), y: Number(item.dataset.y), z: Number(item.dataset.z), text: item.textContent,
    })));
    inputs.push({ stage, type: 'public-navigation', destination: building.name, waypoints: publicPoints });
    await walkToNode(`${building.id}-door`);
    assert(separation(await coordinates(), building.door) <= 6, 'Arrival must actually reach the physical door');
    await context('building');
    assert((await ref('context-body').textContent()).includes(building.name), 'The public nearby-building card must identify the actual destination');
    await page.keyboard.press('KeyE'); inputs.push({ stage, type: 'key', key: 'KeyE', purpose: 'enter' });
    await until(async () => (await ref('landscape-description').textContent()).includes(`已进入 ${building.name}`), 'actual building entry');
    yaw = 0;
  }
  async function leave(building) {
    if (building.kind === 'school' && building.floorPlanProfile === 'v4-program-bodies-02') await classroomWalk(building, true);
    await closePanel(); await page.keyboard.press('KeyE');
    await until(async () => !(await ref('view-mode').textContent()).includes('室内'), 'physical door exit');
    yaw = Math.PI; inputs.push({ stage, type: 'key', key: 'KeyE', purpose: 'leave', building: building.id });
  }
  async function classroomWalk(building, returning = false) {
    const station = (building.functionPoints ?? getBuildingUsePoints(building, 0)).find(point => point.floor === 0 && point.purpose === 'service');
    assert(station, 'The original school needs an actual public ground classroom station');
    const entrance = buildingLocalPosition(building, getBuildingEntrance(building));
    const insideDoor = buildingWorldPosition(building, { ...entrance, z: entrance.z - 2 });
    const hud = await coordinates(), from = { ...hud, y: station.position.y }, target = returning ? insideDoor : station.position;
    const route = findBuildingFloorPlanRoute(building, 0, 0, from, target, .35);
    assert(route, 'The production .35m floor planner must find the real classroom/door path');
    inputs.push({ stage, type: 'planned-classroom-route', source: 'src/architecture-floor-plan.ts', sourceSHA256: sourceHashes['src/architecture-floor-plan.ts'], building: building.id, purpose: returning ? 'return to physical door' : 'actual classroom station', hud, target, points: route,
      scope: 'Pure production geometry; projected ground height is a planner input. Only ordinary keyboard movement changes the browser player.' });
    for (const point of route.slice(1)) await walkPoint(point, .75);
  }
  async function transaction(button, message, cost) {
    const before = await wallet(); await clickLiveButton(button);
    await until(async () => message.test(await ref('toast').textContent()), `transaction receipt ${message}`);
    const receipt = await ref('toast').textContent(), after = await wallet();
    assert(Math.abs(before - after - cost) < .13, `Actual wallet debit ${before - after} must match ${cost}`);
    return { before, after, receipt };
  }
  async function shouldStop(name, requested = false) {
    if (!requested && stopAfter !== name) return false;
    await paused(true); await panel('settings'); await clickLiveButton(page.getByTestId('save'));
    await until(async () => /旅程已保存在/.test(await ref('toast').textContent()), 'actual milestone IndexedDB save');
    await closePanel();
    await checkpoint(`${name}-saved`, { scope: 'Actual UI save with the simulation paused; later journey stages have not run',
      persistentProfile: options.has('--profile') ? path.resolve(String(options.get('--profile'))) : null });
    return true;
  }
  try {
    if (server) await until(async () => { assert(server.exitCode === null, startup); return startup.includes(`http://127.0.0.1:${port}`); }, 'owned preview startup', 15_000);
    const served = await fetch(base); assert(served.ok);
    assert((await served.text()).includes(buildEntry), 'The preview must serve the inspected build entry');
    const launchOptions = { executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: !options.has('--headed'),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
    const contextOptions = { viewport, deviceScaleFactor: 1,
      ...(options.has('--video') ? { recordVideo: { dir: path.join(output, 'video') } } : {}) };
    let browserContext;
    if (options.has('--profile')) {
      browserContext = await chromium.launchPersistentContext(path.resolve(String(options.get('--profile'))), { ...launchOptions, ...contextOptions });
      browser = browserContext;
    } else {
      browser = await chromium.launch(launchOptions); browserContext = await browser.newContext(contextOptions);
    }
    const restoredPages = browserContext.pages();
    const restoredURLs = restoredPages.map(oldPage => oldPage.url());
    const startupPages = { at: new Date().toISOString(), scope: 'Browser-context setup only: record restored public tab URLs and close pre-existing pages before opening one normal game page. No game globals, save fields or profile files are read or edited.', pagesBefore: restoredPages.length, urlsBefore: restoredURLs, closedPages: 0 };
    await writeFile(path.join(output, 'browser-startup-pages.json'), JSON.stringify(startupPages, null, 2));
    console.log(`Browser startup pages: ${restoredPages.length} ${JSON.stringify(restoredURLs)}`);
    for (const oldPage of restoredPages) { await oldPage.close(); startupPages.closedPages++; }
    startupPages.pagesAfterClose = browserContext.pages().length;
    await writeFile(path.join(output, 'browser-startup-pages.json'), JSON.stringify(startupPages, null, 2));
    page = await browserContext.newPage(); page.setDefaultTimeout(120_000);
    startupPages.pagesAfterCreate = browserContext.pages().length;
    await writeFile(path.join(output, 'browser-startup-pages.json'), JSON.stringify(startupPages, null, 2));
    assert.equal(startupPages.pagesAfterCreate, 1, 'Only one real game page may occupy the journey browser context');
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await browserContext.tracing.start({ screenshots: options.has('--trace-screenshots'), snapshots: true });
    await page.goto(base.href, { waitUntil: 'networkidle', timeout: 120_000 });
    await until(async () => /-?\d+\s*\/.*\//.test(await ref('coordinates').textContent()), 'ordinary public HUD boot', 120_000);
    const arrivalShop = world.buildings.filter(building => building.kind === 'market' && building.districtId === 'market')
      .sort((a, b) => horizontal(a.door, world.spawn) - horizontal(b.door, world.spawn))[0];
    yaw = Math.atan2(-(arrivalShop.door.x - world.spawn.x), -(arrivalShop.door.z - world.spawn.z));
    if (options.has('--quality') || options.has('--render-distance')) {
      await panel('settings');
      if (options.has('--quality')) await choosePublicOption(ref('quality'), String(options.get('--quality')));
      if (options.has('--render-distance')) {
        const distance = Number(options.get('--render-distance')), slider = ref('distance');
        assert(distance >= 900 && distance <= 6000 && (distance - 900) % 300 === 0);
        await slider.click(); await page.keyboard.press('Home');
        for (let value = 900; value < distance; value += 300) await page.keyboard.press('ArrowRight');
        assert.equal(Number(await slider.inputValue()), distance);
        inputs.push({ stage: 'startup', type: 'keyboard-range', target: 'render-distance', value: distance });
      }
      await closePanel();
    }
    if (resumeAfter) {
      stage = 'resume';
      // The normal application boots its stored journey; an actual native load
      // click independently verifies public restoration before any walking.
      await paused(true); await panel('settings'); await clickLiveButton(page.getByTestId('load'));
      await until(async () => /存档已恢复/.test(await ref('toast').textContent()), 'actual prior milestone UI restore');
      await paused(true); await panel('life'); await sleep(850); const restored = await snapshot();
      for (const key of ['coordinates', 'wallet', 'identities', 'home', 'growth', 'clock', 'day'])
        assert.deepEqual(restored[key], resumeCheckpoint[key], `Continue the actual saved public ${key}`);
      assert((await ref('player-home').textContent()).includes(home.name), 'The saved home must match the physical next-leg origin');
      await closePanel(); await checkpoint('resume', { resumeAfter, priorResults: resumeFrom, priorResultsHash: resumeReferenceHash, priorCheckpoint: resumeCheckpoint, restored, plannedLayout });
      if (options.has('--export-resume')) {
        await panel('settings');
        const downloadReady = page.waitForEvent('download');
        await clickLiveButton(page.locator('[data-action="export"]'));
        const download = await downloadReady, exportedPath = path.join(output, 'resume-ui-export.json');
        await download.saveAs(exportedPath);
        assert.equal(await download.failure(), null, 'The actual native export download succeeds');
        await until(async () => /存档已导出/.test(await ref('toast').textContent()), 'actual native export receipt');
        const exportedBytes = await readFile(exportedPath);
        await closePanel(); await checkpoint('resume-export', { exportedPath, exportBytes: exportedBytes.byteLength,
          exportSHA256: createHash('sha256').update(exportedBytes).digest('hex'), suggestedFilename: download.suggestedFilename(),
          scope: 'Actual native UI export preserved for independent read-only world/continuation review; this harness does not edit or import the downloaded JSON.' });
      }
      await paused(false); await focusWorld();
      if (restored.mode.includes('室内')) {
        const savedSite = { home, school: places.school, qualification: places.station, public: places.hall }[resumeAfter];
        assert(savedSite && restored.location.includes(savedSite.name), 'A saved interior must be the actual completed facility');
        await leave(savedSite);
      }
      if (/乘坐|驾驶/.test(restored.mode)) {
        assert.equal(resumeAfter, 'vehicle'); await context('vehicle');
        await clickLiveButton(ref('context-body').locator('[data-command="leaveVehicle"]'));
        await until(async () => /已在.*下车/.test(await ref('toast').textContent()), 'actual prior parked vehicle exit');
      }
    }
    if (resumeIndex < 0) {
    stage = 'arrival'; assert(Math.abs(await wallet() - 600) < .01, 'A new ordinary player starts with the actual initial wallet');
    await checkpoint('arrival');
    if (await shouldStop(stage)) return;
    }
    if (resumeIndex < 1) {
    stage = 'shopping'; await enter(market); await context('building');
    const priceText = await ref('context-body').textContent(), price = Number(priceText.match(/食物\s*([\d,.]+)\s*云币/)?.[1]?.replaceAll(',', ''));
    assert(Number.isFinite(price), 'Read the displayed food price');
    const carry = ref('context-body').locator(`[data-action="purchase-carry"][data-target="${market.id}"]`);
    const hasCarryMeal = await carry.count() > 0;
    const purchase = hasCarryMeal
      ? await transaction(carry, /购买2份食物/, price * 2)
      : await transaction(ref('context-body').locator(`[data-command="purchase"][data-target="${market.id}"]`), /购买1份食物/, price);
    await panel('life'); assert((await ref('inventory').textContent()).includes('食物'), 'An actual purchased portable portion remains in the public backpack'); await closePanel();
    await checkpoint('shopping', purchase); await leave(market);
    if (await shouldStop(stage)) return;
    }
    if (resumeIndex < 2) {
    stage = 'home'; await enter(home); await context('building');
    const rental = await transaction(ref('context-body').locator(`[data-command="rent"][data-target="${home.id}"]`), /租住/, 80);
    await panel('life'); assert((await ref('player-home').textContent()).includes(home.name)); await closePanel();
    const resting = await transaction(ref('context-body').locator(`[data-command="rest"][data-target="${home.id}"]`), /体力恢复/, 0);
    await checkpoint('home', { rental, resting }); await leave(home);
    if (await shouldStop(stage)) return;
    }
    if (resumeIndex < 3) {
    stage = 'school'; await enter(places.school); if (places.school.floorPlanProfile === 'v4-program-bodies-02') await classroomWalk(places.school); await panel('life'); await choosePublicOption(ref('career'), '4');
    assert(await ref('career-button').isDisabled(), 'A school is not the driver examination institution');
    const educationBefore = await ref('growth').textContent(), cashBefore = await wallet(); await panel('life');
    await clickLiveButton(ref('study-button')); await until(async () => /课程托管|教材/.test(await ref('toast').textContent()), 'actual forty-coin course admission');
    await until(async () => /课程已完成/.test(await ref('education-course').textContent()), 'sixty real on-site minutes with actual teacher and textbook', 300_000);
    await sleep(850); const educationAfter = await ref('growth').textContent(); assert.notEqual(educationAfter, educationBefore);
    const cashAfter = await wallet(); assert(Math.abs(cashBefore - cashAfter - 40) < .02);
    await checkpoint('school', { cashBefore, cashAfter, educationBefore, educationAfter }); await leave(places.school);
    if (await shouldStop(stage)) return;
    }
    if (resumeIndex < 4) {
    stage = 'qualification'; await enter(places.station); const examBefore = await wallet(); await panel('life');
    await choosePublicOption(ref('career'), '4'); await clickLiveButton(ref('career-button'));
    await until(async () => /通过driver职业考试/.test(await ref('toast').textContent()), 'actual driver qualification');
    await sleep(850); assert((await ref('identities').textContent()).includes('驾驶员'));
    const examAfter = await wallet(); assert(Math.abs(examBefore - examAfter - 80) < .02);
    await checkpoint('qualification', { examBefore, examAfter }); await leave(places.station);
    if (await shouldStop(stage)) return;
    }
    if (resumeIndex < 5) {
    stage = 'vehicle';
    const stop = world.nodes.filter(node => node.station && adjacency.has(node.id)).sort((a, b) => separation(a.position, places.station.door) - separation(b.position, places.station.door))[0];
    await walkToNode(stop.id);
    await until(async () => { await context('vehicle'); const drive = ref('context-body').locator('[data-command="drive"]'); return /道路/.test(await ref('context-body').textContent()) && await drive.count() > 0 && await drive.isEnabled(); }, 'an actual stopped road vehicle within boarding range', 240_000);
    await paused(true); await context('vehicle');
    const ride = await transaction(ref('context-body').locator('[data-command="ride"]'), /已登车/, 4);
    assert((await ref('view-mode').textContent()).includes('乘坐道路'));
    await clickLiveButton(ref('context-body').locator('[data-command="leaveVehicle"]')); await until(async () => /已在.*下车/.test(await ref('toast').textContent()), 'legal passenger disembarkation');
    await context('vehicle'); await clickLiveButton(ref('context-body').locator('[data-command="drive"]'));
    await until(async () => /取得载具操作权/.test(await ref('toast').textContent()), 'earned driving permission');
    const vehicleStart = await coordinates(); await paused(false); await focusWorld(); await page.keyboard.down('KeyW');
    try { await until(async () => horizontal(await coordinates(), vehicleStart) >= 9, 'actual keyboard driving carries the player', 90_000); }
    finally { await page.keyboard.up('KeyW'); }
    await focusWorld(); await page.keyboard.down('Space');
    try { await until(async () => { await context('vehicle'); return /已停靠/.test(await ref('context-body').textContent()); }, 'actual Space braking', 30_000); }
    finally { await page.keyboard.up('Space'); }
    const vehicleStop = await coordinates(); assert(horizontal(vehicleStop, vehicleStart) >= 9);
    inputs.push({ stage, type: 'drive', keys: ['KeyW', 'Space'], before: vehicleStart, after: vehicleStop });
    await checkpoint('vehicle', { ride, vehicleStart, vehicleStop });
    await clickLiveButton(ref('context-body').locator('[data-command="leaveVehicle"]')); await until(async () => /已在.*下车/.test(await ref('toast').textContent()), 'legal driver disembarkation');
    if (await shouldStop(stage)) return;
    }
    if (resumeIndex < 6) {
    stage = 'public'; await enter(places.hall); const reportBefore = await wallet(); await panel('city');
    await choosePublicOption(ref('report-kind'), 'budget'); await typePublicText(ref('report-value'), '');
    await typePublicText(ref('report-text'), '我从实际入口来到议事厅，记录这里公开展示的公共预算，并保留发布时的观察依据。');
    await clickLiveButton(ref('publish-report')); await until(async () => /报告已登记|城市报告已公开/.test(await ref('toast').textContent()) && (await ref('culture-reports').textContent()).includes('公开公库'), 'truthful public budget report');
    const reportAfter = await wallet(); assert(Math.abs(reportBefore - reportAfter - 20) < .02);
    await panel('city'); await choosePublicOption(ref('petition-topic'), 'transport');
    await typePublicText(ref('petition-title'), '从入口到书院的真实通行记录');
    await typePublicText(ref('petition-text'), '我已实际走过入口、商铺、住宅和书院，也在停靠点驾驶了道路载具。请公开核对这些地点之间的步行通路与交通服务。');
    await clickLiveButton(ref('file-petition')); await until(async () => (await ref('culture-petitions').textContent()).includes('从入口到书院的真实通行记录'), 'on-site petition registration');
    const petitionAfter = await wallet(); assert(Math.abs(reportAfter - petitionAfter - 10) < .02);
    await checkpoint('public', { reportBefore, reportAfter, petitionAfter, scope: 'Publication and registration; future replies/service fulfilment are not asserted by this journey' });
    if (await shouldStop(stage)) return;
    }
    stage = 'save'; await paused(true); await panel('life'); await sleep(850);
    const saved = await snapshot(); await panel('settings'); await clickLiveButton(page.getByTestId('save'));
    await until(async () => /旅程已保存在/.test(await ref('toast').textContent()), 'actual IndexedDB save');
    await closePanel(); await page.keyboard.press('KeyE'); yaw = Math.PI; await paused(false); await focusWorld();
    await walkPoint({ x: places.hall.door.x, y: places.hall.door.y, z: places.hall.door.z + 5 });
    await panel('settings'); await clickLiveButton(page.getByTestId('load')); await until(async () => /存档已恢复/.test(await ref('toast').textContent()), 'ordinary UI save restore');
    await panel('life'); await sleep(850); const restored = await snapshot();
    for (const key of ['coordinates', 'wallet', 'identities', 'home', 'growth', 'clock', 'day', 'location']) assert.deepEqual(restored[key], saved[key], `Save restores public ${key}`);
    await checkpoint('save', { saved, restored }); assert.deepEqual(errors, []);
  } catch (error) {
    if (error instanceof CheckpointStop) stoppedAtCheckpoint = true;
    else {
      failure = error.stack ?? error.message;
      if (page) { try { records.push({ name: 'failure', ...(await snapshot()) }); await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 120_000 }); } catch {} }
    }
  } finally {
    process.removeListener('SIGUSR2', requestCheckpoint);
    if (page) { for (const key of ['KeyW', 'ShiftLeft', 'Space']) await page.keyboard.up(key).catch(() => {}); await page.context().tracing.stop({ path: path.join(output, 'trace.zip') }).catch(() => {}); }
    const after = await sources();
    if (errors.length) failure ??= `Browser errors: ${errors.join('\n')}`;
    if (JSON.stringify(sourceHashes) !== JSON.stringify(after)) failure ??= 'Sources changed during the journey; this run cannot validate a final candidate';
    if (createHash('sha256').update(await readFile(buildFile)).digest('hex') !== buildHash) failure ??= 'The inspected build changed during the journey';
    await browser?.close(); server?.kill('SIGTERM');
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ status: failure ? 'failed' : stoppedAtCheckpoint ? 'paused-at-checkpoint' : 'passed',
      scope: 'Normal-URL player actions with keyboard/mouse and public DOM only; static map planning is recorded separately; software GPU does not establish macOS performance',
      workspace: root, harnessPath: import.meta.filename, harnessHash, viewport, url: base.href,
      resume: resumeAfter ? { after: resumeAfter, results: resumeFrom, resultsHash: resumeReferenceHash, checkpoint: resumeCheckpoint.name } : null,
      plannedLayout, plannedFingerprint,
      publicGraphics: { quality: options.get('--quality') ?? 'default', renderDistance: options.get('--render-distance') ?? 'default' },
      stopAfter, stage, completedStage, persistentProfile: options.has('--profile') ? path.resolve(String(options.get('--profile'))) : null,
      buildEntry, buildHash, sourceHashes, sourceHashesAfter: after, records, inputs, errors, failure }, null, 2));
  }
  if (failure) throw new Error(failure);
}
