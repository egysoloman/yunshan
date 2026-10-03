// CODEPREP / NOT_RUN / UNBOUND_ROOT18. No production artifact is guessed here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '/workspace/yunshan/node_modules/playwright-core/index.mjs';
import { createServer } from '/workspace/yunshan/node_modules/vite/dist/node/index.js';

const bindingPath = process.env.YUNSHAN_EDUCATION_DOM_BINDING;
assert(bindingPath, 'Provide the separately reviewed, completed root18 binding.');
const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
assert.equal(binding.state, 'BOUND_ROOT18_COMPLETED_ACTUAL_BUILD', 'This template is intentionally UNBOUND and must not run yet.');
assert.equal(binding.composite, 'root18');
assert.equal(binding.production.freshForThisSource, true);
assert.equal(binding.production.buildExitCode, 0);
const root = binding.sourceRoot, out = binding.outRoot, port = binding.port;
assert(root && out && Number.isInteger(port) && port >= 1024 && port <= 65535);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(await readFile(binding.sourceManifest.path)), binding.sourceManifest.sha256);
assert.equal(sha(await readFile(binding.buildReceipt.path)), binding.buildReceipt.sha256);
const manifest = JSON.parse(await readFile(binding.sourceManifest.path, 'utf8'));
assert.equal(manifest.sourceRoot, root);
const names = Object.keys(manifest.copiedHashes).sort();
assert.equal(names.length, binding.sourceManifest.totalFiles);
const hashes = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, sha(await readFile(path.join(root, name)))])));
const distHashes = async () => {
  const found = {};
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) found[path.relative(path.join(root, 'dist'), file)] = sha(await readFile(file));
    }
  }
  await visit(path.join(root, 'dist')); return Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));
};
await mkdir(out, { recursive: true });
const allowedLauncherFiles = new Set(['raw.log', 'launch.json', 'education-ui-as-run.mjs', 'run-education-dom-as-run.py', 'binding-as-run.json', 'source-manifest-as-run.json', 'build-receipt-as-run.json']);
assert((await readdir(out)).every(name => allowedLauncherFiles.has(name)), 'Use an entirely new evidence epoch; preserve all previous files.');
const sourceStart = await hashes(), distStart = await distHashes();
assert.deepEqual(sourceStart, manifest.copiedHashes);
assert.deepEqual(distStart, binding.production.distHashes);
const entryKey = binding.production.entryPath.replace(/^\/?assets\//, 'assets/');
assert.equal(distStart[entryKey], binding.production.entrySha256);
assert.equal((await readFile(path.join(root, 'dist', entryKey))).length, binding.production.entryBytes);
assert.equal(distStart[entryKey + '.map'], binding.production.maps[entryKey + '.map']);
assert(Object.keys(binding.production.maps).length > 0);
for (const [name, digest] of Object.entries(binding.production.maps)) assert.equal(distStart[name], digest);
const result = {
  state: 'RUNNING', startedAtUTC: new Date().toISOString(), pid: process.pid, binding,
  bindingSha256: sha(await readFile(bindingPath)), sourceStart, distStart, results: [], errors: [],
  scope: 'Default-world actual CityUI source + real Simulation, original native DOM commands. One adult native teacher has one declared arrived-work position; native money/material/speed/needs remain untouched. No recurring actor pin, attendance/wage fabrication, Renderer/3D/ART/macOS/default commuting or macroeconomic coverage.',
  productionBinding: 'Fresh root18 production entry/maps are verified artifacts; the controlled page executes root18 source transformed by Vite, not the production entry bundle.',
  executedProductionEntry: false,
};
let server, browser, page, failure;

function browserFixture() {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const near = (actual, expected, label) => check(Math.abs(actual - expected) <= 1e-7, label + ': ' + actual + ' versus ' + expected);
  const copy = value => JSON.parse(JSON.stringify(value));
  const world = createWorld(), sim = new Simulation(world), runtime = Reflect.get(sim, 'runtime');
  check(sim.state.speed === 1 && sim.state.player.money === 600 && sim.state.player.education === 0 && sim.state.player.experience === 0, 'Native opening contract.');
  const commands = [], steps = [], wages = [], transfers = [], procurements = [], stages = [];
  let currentStep = null, ui;
  const snapshot = () => ({
    tick: sim.state.tick, clock: sim.state.extension.lastUpdate, displayedHour: sim.state.hour, speed: sim.state.speed,
    wallet: sim.state.player.money, treasury: sim.state.treasury, grade: sim.state.player.education, experience: sim.state.player.experience,
    playerNeeds: copy(sim.state.player.needs), playerPosition: copy(sim.state.player.position),
    course: copy(sim.state.education?.course ?? null), history: copy(sim.state.education?.history ?? []),
    stock: copy(sim.state.education?.stock ?? {}), educationStats: copy(sim.state.education?.stats ?? null),
    teacher: copy({ id: teacher.id, role: teacher.role, workId: teacher.workId, state: teacher.state, position: teacher.position,
      needs: teacher.needs, money: teacher.money, profile: sim.state.extension.actorProfiles[teacher.id], attendance: runtime.attendance[teacher.id] ?? 0 }),
  });
  let site, point, teacher;
  for (const person of sim.state.citizens) {
    const profile = sim.state.extension.actorProfiles[person.id], candidate = world.buildings.find(b => b.id === person.workId);
    if (!candidate || candidate.kind !== 'school' || candidate.floorPlanProfile !== 'v4-program-bodies-02'
      || !['老师', 'teacher'].includes(person.role) || !profile.alive || profile.age < 18 || profile.health < 45
      || person.needs.hunger < 60 || person.needs.fatigue < 60 || sim.buildingTravelDistance(person.homeId, candidate.id) > 500) continue;
    // Choose the first eligible native teacher, not a forged role or employer.
    const candidates = candidate.functionPoints ?? getBuildingUsePoints(candidate, 0);
    const selected = candidates.find(p => p.purpose === 'service' && p.floor === 0
      && educationAtPosition(candidate, p.position, sim.state.player, sim.state.voxels)
      && sim.isAtBuildingFunctionPoint(candidate, p.position, 'work', { role: 'teacher', identities: ['teacher'] })
      && !educationAtPosition(candidate, candidate.door, sim.state.player, sim.state.voxels));
    if (selected) { site = candidate; point = selected; teacher = person; break; }
  }
  check(teacher && site && point, 'No eligible native adult teacher and legal public paired station; retain first failure.');
  const nativeTeacherBefore = copy(teacher), nativeActivityBefore = runtime.activities[teacher.id] ?? null;
  check((runtime.attendance[teacher.id] ?? 0) === 0, 'No attendance is supplied by the opening.');
  // One-time arrived-work position fixture. No recurring hook pins this actor,
  // changes needs, suppresses decisions or supplies salary/attendance.
  teacher.position = { ...point.position }; teacher.destinationId = site.id;
  teacher.route = [{ ...point.position }]; teacher.routeIndex = 1;
  runtime.activities[teacher.id] = 'work';
  sim.setFocus(point.position, 'walk');
  check(educationPairAtStation(sim, site, teacher, 'player'), 'The one-time native pairing must be physically legal.');
  const positioning = { nativeTeacherBefore, nativeActivityBefore, arrivedTeacher: copy(teacher),
    declaredFields: ['teacher.position', 'teacher.destinationId', 'teacher.route', 'teacher.routeIndex', 'runtime.activities[teacher.id]', 'player focus/position'],
    repeatedWrites: false, modifiesNeedsMoneyMaterialSpeedRoleEmploymentAttendanceWages: false };
  const view = { mode: 'walk', quality: 'balanced', fps: 0, drawCalls: 0, triangles: 0, position: { ...point.position },
    nearbyBuilding: site, nearbyCitizen: null, nearbyVehicle: null, targetDistrict: null, inside: true,
    renderDistance: 3600, fpsCap: 60, dynamicResolution: true, simulationDetail: 1 };
  const refresh = () => { view.position = { ...sim.state.player.position }; ui.update(sim.state, view); };
  const originalTransfer = sim.transferShopFunds;
  sim.transferShopFunds = function(shop, amount) {
    const before = this.shopFunds(shop), answer = originalTransfer.call(this, shop, amount);
    transfers.push({ tick: this.state.tick, clock: this.state.extension.lastUpdate, shopId: shop.id,
      amount, before, after: this.shopFunds(shop), inventoryAfter: shop.inventory, step: currentStep });
    return answer;
  };
  const originalEmit = sim.emitEvent;
  sim.emitEvent = function(event) {
    if (event.type !== 'wholesale' || event.purpose !== 'education-material') return originalEmit.call(this, event);
    const taxBefore = runtime.taxes, answer = originalEmit.call(this, event);
    const receipt = copy(this.state.education.course.receipt), transfer = transfers.at(-1);
    const row = { event: copy(event), tick: this.state.tick, clock: this.state.extension.lastUpdate, receipt,
      transfer: copy(transfer), taxBefore, taxAfter: runtime.taxes, escrowAfter: this.state.education.course.escrow, step: currentStep };
    procurements.push(row);
    return answer;
  };
  sim.onEvent('wage-earned', event => {
    const person = sim.state.citizens.find(p => p.id === event.citizenId);
    if (!person || person.workId !== site.id || !['老师', 'teacher'].includes(person.role)) return;
    wages.push({ event: copy(event), tick: sim.state.tick, clock: sim.state.extension.lastUpdate, step: currentStep,
      teacher: copy({ id: person.id, role: person.role, workId: person.workId, state: person.state, position: person.position,
        needs: person.needs, profile: sim.state.extension.actorProfiles[person.id] }),
      physicallyPairedWithPlayer: educationPairAtStation(sim, site, person, 'player') });
  });
  const actions = {
    isAtBuildingFunctionPoint(id, purpose) { const building = world.buildings.find(b => b.id === id); return !!building && sim.isAtBuildingFunctionPoint(building, sim.state.player.position, purpose); },
    command(command) {
      const observed = { command: copy(command), before: snapshot(), hostPerformanceTime: performance.now() };
      commands.push(observed);
      let answer;
      try { answer = sim.command(command); observed.result = copy(answer); }
      catch (error) { observed.threw = String(error.stack ?? error); throw error; }
      finally { observed.after = snapshot(); }
      ui.notify(answer.message, answer.ok); refresh();
    },
    setMode() {}, setQuality() {}, travel() {}, interact() {}, save() {}, load() {},
    exportSave() {}, importSave() {}, setSetting() {}, resetView() {},
  };
  ui = new CityUI(document.getElementById('app'), world, actions); refresh();
  function step(count, reason) {
    check(Number.isInteger(count) && count >= 1 && count <= 8, 'Small bounded genuine-step batches.');
    for (let index = 0; index < count; index++) {
      const before = snapshot(), beforeCourse = before.course, wageOffset = wages.length, procurementOffset = procurements.length;
      currentStep = steps.length + 1; const hostStart = performance.now(); let thrown;
      try { sim.step(.25); } catch (error) { thrown = error; }
      const after = snapshot(), labourProof = [];
      const loggedStep = { ordinal: currentStep, reason, inputSeconds: .25, hostStart, hostEnd: performance.now(),
        before, after, labourProof, systemOrder: [...sim.state.lastSystemOrder] };
      if (thrown) loggedStep.threw = String(thrown.stack ?? thrown);
      steps.push(loggedStep); currentStep = null;
      if (thrown) throw thrown;
      check(after.speed === 1 && after.tick === before.tick + 1, 'Each logged original step is one default-speed tick.');
      near(after.clock - before.clock, .25, 'Actual monotonic default-speed tick');
      check(sim.state.lastSystemOrder.length === 10, 'The original ten phases still run.');
      // Assertions are outside original product callbacks; observers only read
      // before/after the genuine transfer/event and never interrupt a phase.
      for (const row of procurements.slice(procurementOffset)) {
        const { event, receipt, transfer } = row;
        check(event.quantity === 1 && receipt.quantity === 1 && transfer?.shopId === receipt.shopId, 'Actual education material source and one-unit receipt.');
        near(transfer.amount, receipt.net, 'Original supplier transfer equals original receipt net');
        near(transfer.after - transfer.before, receipt.net, 'Original supplier account receives the real net');
        near(row.taxAfter - row.taxBefore, receipt.tax, 'Original wholesale event books actual procurement tax');
        near(receipt.net + receipt.tax, receipt.gross, 'Real procurement gross equals net plus tax');
      }
      const item = beforeCourse && ([after.course, ...after.history].find(course => course?.id === beforeCourse.id));
      let credited = 0;
      if (beforeCourse && item) {
        const delta = item.workedMinutes - beforeCourse.workedMinutes;
        check(delta >= -1e-7 && delta <= .25 + 1e-7, 'Course cannot gain more than this genuine phase.');
        for (const [id, value] of Object.entries(item.staffMinutes)) {
          const added = value - (beforeCourse.staffMinutes[id] ?? 0); if (added <= 0) continue;
          const slices = wages.slice(wageOffset).filter(row => row.event.citizenId === id && row.event.siteId === site.id);
          let union = 0, end = after.clock - .25;
          const clipped = slices.map(row => ({ row, start: Math.max(row.event.creditedWorkStartAt, after.clock - .25, beforeCourse.startedAt),
            end: Math.min(row.event.creditedWorkEndAt, after.clock) })).sort((a, b) => a.start - b.start);
          for (const interval of clipped) {
            const event = interval.row.event;
            check(Number.isFinite(event.minutes) && Number.isFinite(event.amount) && event.amount >= 0
              && Number.isFinite(event.ratePerMinute) && event.ratePerMinute > 0
              && Number.isFinite(event.creditedWorkStartAt) && Number.isFinite(event.creditedWorkEndAt), 'Real finite core wage attestation.');
            near(event.creditedWorkEndAt - event.creditedWorkStartAt, event.minutes, 'Original credited wage-window width');
            near(event.amount, event.minutes * event.ratePerMinute, 'Original funded earned wage equation');
            check(interval.row.tick === after.tick && interval.row.physicallyPairedWithPlayer
              && interval.row.teacher.profile.alive && interval.row.teacher.profile.age >= 18
              && interval.row.teacher.profile.health >= 45 && interval.row.teacher.state === 'working'
              && interval.row.teacher.needs.hunger >= 40 && interval.row.teacher.needs.fatigue >= 35, 'Actual named teacher is alive and legally paired at the current wage interval.');
            union += Math.max(0, interval.end - Math.max(end, interval.start)); end = Math.max(end, interval.end);
          }
          check(added <= union + 1e-7, 'Student contribution is covered by genuine current-phase wage intervals, not prior labour.');
          credited += added; labourProof.push({ teacherId: id, addedMinutes: added, unionMinutes: union, clipped });
        }
        near(credited, delta, 'Named real staff contributions equal this earned student phase');
      }
    }
    refresh(); return snapshot();
  }
  const setPlace = (position, inside) => { sim.setFocus(position, 'walk'); view.inside = inside; refresh(); };
  window.fixture = {
    sim, world, site, point, teacher, view, commands, positioning, step, snapshot,
    away() { check(!educationAtPosition(site, site.door, sim.state.player, sim.state.voxels), 'Actual doorway is outside the classroom station.'); setPlace(site.door, false); },
    back() { setPlace(point.position, true); },
    stage(label) { const state = snapshot(); stages.push({ label, state }); return { state, save: sim.exportSave() }; },
    report() { return { positioning, commands, steps, wages, transfers, procurements, stages, final: snapshot(),
      executedRenderer: false, attemptedDefaultTicks: steps.length,
      completedTenPhaseTicks: steps.filter(row => !row.threw && row.systemOrder.length === 10 && row.after.tick === row.before.tick + 1).length,
      observedMonotonicMinutes: steps.reduce((sum, row) => sum + row.after.clock - row.before.clock, 0),
      wallClockIsNotSimulationClock: true }; },
  };
  window.ready = true;
}

try {
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><body><div id="app"></div><script type="module">'
    + "import '/src/style.css';import {createWorld} from '/src/world.ts';import {Simulation} from '/src/simulation.ts';import {CityUI} from '/src/ui.ts';"
    + "import {getBuildingUsePoints} from '/src/architecture-floor-plan.ts';import {educationAtPosition,educationPairAtStation} from '/src/simulation/education.ts';"
    + '(' + browserFixture.toString() + ')();</script></body></html>';
  server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, watch: null },
    plugins: [{ name: 'controlled-education-dom', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/education-ui-verify.html' || request.url.includes('html-proxy')) return next();
        try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml(request.url, html)); }
        catch (error) { next(error); }
      });
    } }] });
  await server.listen();
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  page.setDefaultTimeout(90000);
  await page.goto('http://127.0.0.1:' + port + '/education-ui-verify.html', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => window.ready, null, { timeout: 90000 });
  const study = page.locator('[data-ref="context"] .context-actions [data-command="exam"][data-target="study"]');
  const card = id => page.locator('[data-ref="context"] [data-education-course="' + id + '"]');
  async function stage(label, screenshot = true) {
    const observed = await page.evaluate(label => fixture.stage(label), label);
    await writeFile(path.join(out, label + '.save.json'), observed.save, { flag: 'wx' });
    await writeFile(path.join(out, label + '.state.json'), JSON.stringify(observed.state, null, 2) + '\n', { flag: 'wx' });
    if (screenshot) await page.screenshot({ path: path.join(out, label + '.png'), fullPage: true });
    return observed.state;
  }
  async function step(count, reason) { return page.evaluate(({ count, reason }) => fixture.step(count, reason), { count, reason }); }
  const before = await stage('00-controlled-native-opening');
  assert.equal(await study.count(), 1); assert.equal(await study.isEnabled(), true);
  assert.match(await study.innerText(), /60.*40.*托管/);
  await study.click();
  const admitted = await stage('01-real-button-funded-instant-zero');
  assert.equal(admitted.wallet, before.wallet - 40); assert.equal(admitted.treasury, before.treasury);
  assert.equal(admitted.grade, 0); assert.equal(admitted.experience, 0); assert.equal(admitted.course.workedMinutes, 0);
  assert.equal(admitted.course.escrow, 40); assert.equal(admitted.course.purchasePaid, 0); assert.equal(admitted.course.receipt, null);
  const firstId = admitted.course.id;
  assert.match(await card(firstId).innerText(), /0 \/ 60/);
  result.results.push('Actual native study button escrows40 and grants zero immediate minutes/grade/experience.');
  const procured = await step(1, 'first actual finance procurement after unpaid people phase');
  assert.equal(procured.course.workedMinutes, 0); assert.equal(procured.course.receivedUnits, 1); assert.equal(procured.course.reservedUnits, 1);
  assert.equal(procured.course.receipt.quantity, 1); assert(procured.course.purchasePaid > 0);
  assert.equal(procured.course.serviceFees, 0); assert.equal(procured.course.escrow, 40 - procured.course.purchasePaid);
  assert.equal((await page.evaluate(() => fixture.report().procurements)).length, 1);
  await step(4, 'four actual default-speed paid teacher quarter-minutes');
  const partial = await stage('02-real-procurement-and-one-earned-minute');
  assert.equal(partial.course.workedMinutes, 1); assert.equal(partial.grade, 0); assert.equal(partial.experience, 0);
  assert.match(await card(firstId).innerText(), /真实教材采购/);
  assert.match(await card(firstId).innerText(), /1 \/ 60/);
  result.results.push('One real supplier unit, net transfer, tax event and one genuinely attested teacher minute appear in the actual DOM.');
  await page.evaluate(() => fixture.away()); await step(1, 'actual doorway absence pauses classroom');
  const away = await stage('03-actual-doorway-paused');
  assert.equal(away.course.status, 'paused'); assert.equal(away.course.resumeRequired, true);
  assert.equal(away.course.workedMinutes, partial.course.workedMinutes); assert.equal(await study.isEnabled(), false);
  assert.match(await card(firstId).innerText(), /已离场暂停/);
  await page.evaluate(() => fixture.back()); await step(1, 'return without explicit native resume');
  const returned = await stage('04-return-requires-explicit-resume');
  assert.equal(returned.course.workedMinutes, partial.course.workedMinutes); assert.equal(returned.course.resumeRequired, true);
  assert.equal(returned.wallet, partial.wallet); assert.equal(await study.isEnabled(), true);
  assert.match(await study.innerText(), /不再收费/);
  await study.click();
  const resumed = await page.evaluate(() => fixture.snapshot());
  assert.equal(resumed.wallet, returned.wallet); assert.equal(resumed.course.escrow, returned.course.escrow);
  assert.equal(resumed.course.funded, 40); assert.equal(resumed.course.resumeRequired, false);
  await step(1, 'first real paid teacher quarter-minute after explicit resume');
  const afterResume = await stage('05-resumed-without-second-fee');
  assert.equal(afterResume.course.workedMinutes, 1.25);
  result.results.push('Actual absence pauses; return alone earns nothing; explicit native resume preserves original40 funding and never charges again.');
  const refundDue = afterResume.course.escrow;
  const cancel = page.locator('[data-ref="context"] [data-command="cancelStudy"][data-target="' + firstId + '"]');
  assert.equal(await cancel.count(), 1); assert.equal(await cancel.isEnabled(), true); await cancel.click();
  const cancelled = await stage('06-real-cancel-refund-and-retained-material');
  const old = cancelled.history.find(course => course.id === firstId);
  assert.equal(cancelled.course, null); assert.equal(old.status, 'cancelled'); assert.equal(old.escrow, 0);
  assert.equal(old.workedMinutes, 1.25); assert.equal(old.refunded, refundDue);
  assert.equal(cancelled.wallet, afterResume.wallet + refundDue);
  assert.equal(old.purchasePaid, afterResume.course.purchasePaid); assert.equal(old.serviceFees, afterResume.course.serviceFees);
  assert.equal(old.consumedUnits, 0); assert.equal(Object.values(cancelled.stock)[0].availableUnits, 1);
  assert.equal(cancelled.grade, 0); assert.equal(cancelled.experience, 0);
  assert.match(await card(firstId).innerText(), /课程已取消/);
  result.results.push('Native cancel refunds only the original unearned escrow and returns the purchased textbook once without a qualification reward.');
  await study.click();
  const second = await stage('07-new-real-admission-reuses-textbook');
  const secondId = second.course.id;
  assert.notEqual(secondId, firstId); assert.equal(second.wallet, cancelled.wallet - 40);
  assert.equal(second.course.workedMinutes, 0); assert.equal(second.course.reusedUnits, 1);
  assert.equal(second.course.receivedUnits, 0); assert.equal(second.course.purchasePaid, 0); assert.equal(second.course.receipt, null);
  assert.equal(second.course.escrow, 40); assert.equal(Object.values(second.stock)[0].availableUnits, 0);
  let last = second;
  // Exactly 239 original quarter-minute ticks, not a deadline jump, speed
  // mutation, persistent pin, need refill, teacher wage or funding override.
  for (let offset = 0; offset < 239; offset += 8) {
    last = await step(Math.min(8, 239 - offset), 'native-needs continuous second course at speed1');
    const live = last.course;
    assert(live && live.id === secondId, 'Retain first failure if the actual native teacher cannot sustain this classroom.');
    assert.equal(live.workedMinutes, Math.min(offset + 8, 239) * .25);
    assert.equal(last.grade, 0); assert.equal(last.experience, 0);
  }
  const almost = await stage('08-real-59-75-minutes-no-grade');
  assert.equal(almost.course.workedMinutes, 59.75);
  const completed = await step(1, 'actual final shared paid teacher quarter-minute');
  const finished = completed.history.find(course => course.id === secondId);
  assert.equal(completed.course, null); assert.equal(finished.status, 'completed'); assert.equal(finished.workedMinutes, 60);
  assert.equal(Object.values(finished.staffMinutes).reduce((sum, value) => sum + value, 0), 60);
  assert.equal(finished.escrow, 0); assert.equal(finished.serviceFees, 40); assert.equal(finished.consumedUnits, 1);
  assert.equal(completed.grade, 1); assert.equal(completed.experience, 1);
  assert.equal((await page.evaluate(() => fixture.report().procurements)).length, 1, 'Material reuse cannot invent a second supplier purchase.');
  await stage('09-real-sixty-minute-completion');
  assert.match(await card(secondId).innerText(), /课程已完成/);
  assert.match(await card(secondId).innerText(), /60 \/ 60/);
  result.results.push('Exactly60 real speed1 shared minutes covered by original named wage intervals consume one real textbook and grant grade/experience+1 once.');
  for (let offset = 0; offset < 24; offset += 8) await step(8, 'real post-completion idempotence tick');
  const retained = await stage('10-real-completed-plus24-no-duplicate-reward');
  assert.equal(retained.grade, 1); assert.equal(retained.experience, 1);
  assert.equal(retained.educationStats.completed, 1); assert.equal(retained.educationStats.cancelled, 1);
  assert.equal(retained.history.filter(course => course.id === secondId).length, 1);
  assert.equal(retained.history.find(course => course.id === firstId).workedMinutes, 1.25);
  assert.equal(Object.values(retained.stock)[0].receivedUnits, 1); assert.equal(Object.values(retained.stock)[0].consumedUnits, 1);
  const logged = await page.evaluate(() => fixture.report());
  assert.equal(logged.commands.length, 4); assert(logged.commands.every(command => command.result.ok));
  assert(logged.steps.every(row => row.before.speed === 1 && row.after.speed === 1));
  const canvasInventory = await page.locator('canvas').evaluateAll(canvases => canvases.map(canvas => {
    const context = canvas.getContext('2d');
    return { ref: canvas.dataset.ref, className: canvas.className, width: canvas.width, height: canvas.height,
      has2D: context instanceof CanvasRenderingContext2D,
      paintedPixels: !!context && context.getImageData(0, 0, canvas.width, canvas.height).data.some(value => value !== 0),
      hasWebGL: canvas.getContext('webgl') !== null, hasWebGL2: canvas.getContext('webgl2') !== null,
      inWorldStage: !!canvas.closest('.world-stage') };
  }));
  result.canvasInventory = canvasInventory;
  assert.deepEqual(canvasInventory, [{ ref: 'map', className: 'minimap', width: 420, height: 270,
    has2D: true, paintedPixels: true, hasWebGL: false, hasWebGL2: false, inWorldStage: false }]);
  assert.deepEqual(result.errors, []);
  result.results.push('24 additional real ticks preserve one reward, one consumption and original cancelled partial history; all commands and wage/step observations are retained.');
  result.state = 'PASS_CONTROLLED_EDUCATION_DOM6';
} catch (error) {
  failure = error; result.state = 'FAIL'; result.failure = String(error.stack ?? error);
  if (page) await page.screenshot({ path: path.join(out, 'first-failure.png'), fullPage: true }).catch(() => {});
} finally {
  if (page) {
    const observations = await page.evaluate(() => window.fixture?.report() ?? null).catch(error => ({ collectionError: String(error) }));
    await writeFile(path.join(out, 'actual-command-step-wage-observations.json'), JSON.stringify(observations, null, 2) + '\n', { flag: 'wx' });
    if (observations?.final) {
      const saved = await page.evaluate(() => fixture.sim.exportSave());
      await writeFile(path.join(out, 'final-or-first-fail.exportSave.json'), saved, { flag: 'wx' });
    }
  }
  if (browser) { await browser.close(); result.browserCloseResolved = true; }
  if (server) { await server.close(); result.serverCloseResolved = true; }
  result.sourceEnd = await hashes(); result.distEnd = await distHashes();
  result.sourceStable = JSON.stringify(result.sourceStart) === JSON.stringify(result.sourceEnd);
  result.distStable = JSON.stringify(result.distStart) === JSON.stringify(result.distEnd);
  result.endedAtUTC = new Date().toISOString(); result.scriptSha256 = sha(await readFile(new URL(import.meta.url)));
  if (!result.sourceStable || !result.distStable) { result.state = 'FAIL_INPUT_CHANGED'; failure ??= Error('Source or completed production artifacts changed.'); }
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ state: result.state, checks: result.results.length, errors: result.errors,
    sourceStable: result.sourceStable, distStable: result.distStable, endedAtUTC: result.endedAtUTC }));
}
if (failure) throw failure;
