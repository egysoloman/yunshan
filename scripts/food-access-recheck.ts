import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { assembleSave } from '../src/persistence/partition';
import { validateSaveResources } from '../src/persistence/save-resource';
import type { WorldDefinition } from '../src/types';
import { cashSnapshot, debtSnapshot, foodCustodySnapshot } from './economy-resume-custody';

type Data = Record<string, any>;
const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'];
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
function close(actual: number, expected: number, label: string) {
  assert(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-6, label);
}
function safePath(root: string, file: string) {
  const path = resolve(root, file); assert(path.startsWith(resolve(root) + sep), 'original path outside its run'); return path;
}
function json(root: string, file: string): Data { return JSON.parse(readFileSync(safePath(root, file), 'utf8')); }
function original(root: string, record: Data): string {
  const encoded = readFileSync(safePath(root, record.file)); assert.equal(encoded.length, record.encodedBytes, 'encoded original length');
  assert.equal(sha(encoded), record.encodedSHA256, 'encoded original SHA');
  const raw = gunzipSync(encoded, { maxOutputLength: 128 * 1024 * 1024 });
  assert.equal(raw.length, record.rawBytes, 'decoded original length'); assert.equal(sha(raw), record.rawSHA256, 'decoded original SHA');
  return raw.toString('utf8');
}

/** Pure recheck of sealed native evidence. No Simulation, imports, commands,
 * clock advancement, renderer, or gameplay witness registration is available.
 * A sale in an original bus proves eating only with its real commerce writer.
 * This never upgrades a missing capture or a journey still in progress. */
export function recheckFoodAccess(roots: readonly string[]): Data {
  assert(roots.length > 0 && roots.length <= 32, 'ordered bounded original runs');
  let priorSave: string | undefined, firstSave: Data | undefined, lastSave: Data | undefined, worldSHA: string | undefined;
  let windows = 0, phases = 0, originals = 0, meals = 0, stored = 0;
  const cohort = new Set<string>(), ate = new Set<string>(), stageRows: Data[] = [], saleWriters: Data[] = [];
  const maxima = { cash: 0, food: 0, debt: 0, fiscal: 0 };
  for (const root of roots) {
    const plan = json(root, 'PLAN.original.json'), result = json(root, 'RESULT.json'), baseline = json(root, 'BASELINE.json');
    assert.equal(result.status, 'ACTUAL_COMPLETED'); assert.equal(result.failure, null);
    assert.deepEqual(result.captureFailures, []); assert.deepEqual(result.persistenceFailures, []); assert.deepEqual(result.conservationViolations, []);
    assert.equal(result.commands, 0); assert.equal(result.injectedBodiesMoneyNeedsStockRolesTime, 0);
    assert.equal(result.ordinaryCalls, plan.maximumSuccessfulWindows); assert.equal(result.completedWindows, result.ordinaryCalls);
    assert.equal(result.returnedWindows, result.ordinaryCalls); assert.equal(result.readers, result.ordinaryCalls);
    const worldRaw = readFileSync(safePath(root, 'WORLD.original.json'));
    assert.equal(sha(worldRaw), plan.inputWorldSHA256); worldSHA ??= sha(worldRaw); assert.equal(sha(worldRaw), worldSHA);
    const world = JSON.parse(worldRaw.toString('utf8')) as WorldDefinition;
    const frames = json(root, 'FRAMES.json') as unknown as Data[];
    assert.equal(frames.length, result.completedWindows + 1); assert.equal(frames[0].label, 'imported'); assert.equal(frames[0].complete, false);
    let at = plan.inputClock, tick = plan.inputTick, terminal = '';
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index], raw = original(root, frame.save); originals++;
      const bus = JSON.parse(original(root, frame.bus)) as Data[], custody = JSON.parse(original(root, frame.custody)) as Data;
      const trace = JSON.parse(original(root, frame.foodTrace)) as Data[]; originals += 3;
      assert.deepEqual(custody.events, bus, 'independent complete bus equals custody original bus');
      assert.deepEqual(custody.violations, []); assert.deepEqual(custody.captureFailures, []);
      const save = JSON.parse(raw); validateSaveResources(save, raw);
      assert.equal(save.state.speed, 16); assert.equal(save.state.paused, false);
      if (!index) {
        assert.equal(sha(raw), plan.inputFullSaveSHA256); assert.equal(sha(raw), result.inputSaveSHA256);
        if (priorSave !== undefined) assert.equal(raw, priorSave, 'whole prior terminal equals next exact cold input');
        if (!firstSave) { firstSave = save; for (const actor of save.state.citizens) if (actor.needs.hunger < 30) cohort.add(actor.id); }
        assert.deepEqual(new Set(plan.actorIds), cohort, 'original cohort retained across cold segments');
        assert.deepEqual(cashSnapshot({ state: save.state, runtime: save.runtime }, world), baseline.cash);
        assert.deepEqual(foodCustodySnapshot({ state: save.state, runtime: save.runtime }, world), baseline.food);
        assert.deepEqual(debtSnapshot(save.runtime), baseline.debt);
        assert.deepEqual(custody.phases, []); assert.deepEqual(bus, []); assert.deepEqual(trace, []);
      } else {
        windows++; at += 4; tick++;
        assert.equal(frame.label, 'ordinary-' + String(index).padStart(3, '0')); assert.equal(frame.complete, true);
        assert.deepEqual(custody.phases.map((row: Data) => row.phase), ORDER);
        assert.deepEqual(bus.filter(row => row.event.type.startsWith('system:')).map(row => row.event.type.slice(7)), ORDER);
        assert.deepEqual(trace.map(row => row.phase), ORDER); assert(trace.every(row => row.returned === true));
        for (const row of custody.phases as Data[]) {
          phases++; const totals = row.totals;
          const residual = { cash: row.cash.total - baseline.cash.total,
            food: row.food.total - (baseline.food.total + totals.foodProduced - totals.counterMeals - totals.storedMeals - totals.playerMeals),
            debt: row.debt.total - (baseline.debt.total + totals.npcEarned - totals.npcPaid),
            fiscal: row.fiscal - baseline.fiscal - totals.fiscalEvents - totals.fiscalLedger - totals.fiscalLifecycle };
          assert.deepEqual(residual, row.residual, 'recomputed complete stable residual');
          for (const key of Object.keys(maxima) as (keyof typeof maxima)[]) { close(residual[key], 0, 'stable ' + key); maxima[key] = Math.max(maxima[key], Math.abs(residual[key])); }
        }
        const feedback = custody.phases.at(-1), host = { state: save.state, runtime: save.runtime };
        assert.deepEqual(cashSnapshot(host, world), feedback.cash, 'whole original cash equals feedback custody');
        assert.deepEqual(foodCustodySnapshot(host, world), feedback.food, 'whole original food equals feedback custody');
        assert.deepEqual(debtSnapshot(save.runtime), feedback.debt, 'whole original employer debt equals feedback custody');
        for (const id of baseline.aliveIds) assert.equal(save.state.extension.actorProfiles[id].alive, true, 'original resident alive');
        const commerce = custody.phases.find((row: Data) => row.phase === 'commerce');
        const sales = bus.filter(row => row.event.type === 'sale' && row.event.citizenId !== 'player');
        for (const receipt of sales) {
          const event = receipt.event, site = world.buildings.find(site => site.id === save.state.shops.find((shop: Data) => shop.id === event.shopId)?.buildingId);
          if (!site || !['farm', 'dock', 'market'].includes(site.kind)) continue;
          assert.equal(receipt.phase, 'commerce'); assert(receipt.originalEmitReturned && receipt.typedOriginal && receipt.typedAfterOriginalHandlers);
          assert(Number.isInteger(event.quantity) && event.quantity >= 1 && event.amount > 0, 'actual finite sale');
          const before = commerce.before.citizens.find((actor: Data) => actor.id === event.citizenId);
          const after = commerce.after.citizens.find((actor: Data) => actor.id === event.citizenId); assert(before && after);
          assert.equal(sales.filter(row => row.event.citizenId === event.citizenId).length, 1, 'one original NPC commerce sale');
          close(after.money, before.money - event.amount, 'actual sale wallet writer');
          close(after.food, before.food + event.quantity - 1, 'actual sale carried food writer');
          close(after.needs.hunger, Math.min(100, before.needs.hunger + 52), 'actual sale immediate meal writer');
          assert.deepEqual(after.position, before.position, 'commerce cannot invent arrival');
          meals++; if (cohort.has(event.citizenId)) { ate.add(event.citizenId); saleWriters.push({ clock: at, tick, event, before, after }); }
        }
        stored += bus.filter(row => row.event.type === 'stored-meal').reduce((sum, row) => sum + row.event.amount, 0);
      }
      assert.equal(save.state.tick, tick); assert.equal(save.state.day * 1440 + save.state.hour * 60, at);
      assert.equal(frame.tick, tick); assert.equal(frame.clock, at); terminal = raw; lastSave = save;
    }
    assert.equal(sha(terminal), result.terminalSaveSHA256); assert.equal(at, result.clock); assert.equal(tick, result.tick);
    const partition = json(root, 'TERMINAL-PARTS.json');
    const physical = partition.manifest.map((part: Data) => ({ id: part.id, json: original(root, part.original) })); originals += physical.length;
    assert.equal(assembleSave(physical), terminal); assert.equal(partition.assembledSHA256, sha(terminal));
    const omitted = physical.find((part: Data) => part.id === partition.rejectedMissingPart); assert(omitted);
    assert.throws(() => assembleSave(physical.filter((part: Data) => part !== omitted)));
    let shadowOriginals = 0;
    if (result.shadowSteps !== undefined) {
      assert.equal(result.shadowSteps, plan.maximumSuccessfulWindows - plan.shadowAtWindow);
      assert.equal(result.shadowReturned, result.shadowSteps); assert.equal(result.shadowExact, result.shadowSteps);
      const coldImport = json(root, 'SHADOW-COLD-IMPORT.json');
      assert.equal(coldImport.inputSHA256, frames[plan.shadowAtWindow].save.rawSHA256);
      assert.equal(coldImport.bodyMoneyNeedsTimeStockInjections, 0);
      for (let index = 1; index <= result.shadowSteps; index++) {
        const comparison = json(root, 'shadow/' + String(index).padStart(3, '0') + '.comparison.json');
        assert.deepEqual(comparison.primary, frames[plan.shadowAtWindow + index].save);
        assert.equal(comparison.originalShadowError, null); assert.equal(comparison.fullBytesExact, true);
        assert.equal(original(root, comparison.cold), original(root, comparison.primary), 'physical whole hot/cold future exact');
        shadowOriginals += 2;
      }
      originals += shadowOriginals;
    }
    stageRows.push({ root: resolve(root), inputSaveSHA256: result.inputSaveSHA256, terminalSaveSHA256: result.terminalSaveSHA256,
      ordinaryWindows: result.completedWindows, nativeConstructors: result.constructors, nativeImports: result.imports, shadowFutureWindows: result.shadowExact ?? 0, shadowOriginals, clock: at, tick, actualCounts: result.actualCounts, maximumResidual: result.maximumResidual, physicalParts: physical.length });
    priorSave = terminal;
  }
  assert(firstSave && lastSave); const remaining = lastSave.state.citizens.filter((actor: Data) => cohort.has(actor.id) && actor.needs.hunger < 30);
  return { status: 'PASS_SEALED_ORIGINAL_RECHECK', steps: 0, constructors: 0, imports: 0, nativeReaderCalls: 0,
    coldSegments: roots.length, completeOriginalWindows: windows, completeStablePhases: phases, dualSHAOriginals: originals,
    firstClock: firstSave.state.day * 1440 + firstSave.state.hour * 60, finalClock: lastSave.state.day * 1440 + lastSave.state.hour * 60,
    cohortInitialLow: cohort.size, cohortActuallyAte: ate.size, cohortRecoveredAtTerminal: cohort.size - remaining.length,
    cohortRemainingLow: remaining.map((actor: Data) => ({ id: actor.id, hunger: actor.needs.hunger, food: actor.food, state: actor.state, activity: lastSave!.runtime.activities[actor.id], destinationId: actor.destinationId })),
    allCitizensLow: lastSave.state.citizens.filter((actor: Data) => actor.needs.hunger < 30).length,
    actualCounterMeals: meals, actualStoredMeals: stored, maximumResidual: maxima, stageRows, saleWriters,
    steadyStateClaimed: false, missingCaptureUpgrade: false, gameplayRepairClaimed: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...roots] = process.argv.slice(2); assert(output && !existsSync(output), 'new report output required');
  const report = recheckFoodAccess(roots); writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, completeOriginalWindows: report.completeOriginalWindows, completeStablePhases: report.completeStablePhases,
    cohortActuallyAte: report.cohortActuallyAte, remaining: report.cohortRemainingLow.length, steps: 0 }));
}
