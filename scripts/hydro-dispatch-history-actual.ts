import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Simulation } from '../src/simulation';
import type { WorldDefinition } from '../src/types';
import { assembleSave, partitionSave, type SavePart } from '../src/persistence/partition';
import { savedWorldFingerprint } from '../src/persistence/world-layout';
import { hydroKWhPerM3 } from '../src/simulation/power-hydro';
import { appendPagedHistory, createPagedHistory, type PagedHistory } from '../src/simulation/power-hydro-runtime';
import { hydroGridWindows, prepareHydroBeforeTick, validateHydroGridState,
  type HydroPowerGridDispatch, type HydroPowerGridState } from '../src/simulation/power-grid-hydro';
import { HYDRO_HISTORY_ENCODING, HYDRO_HISTORY_FIXTURE_DISCLOSURE,
  largeCityHydroHistoryWorld, sixCityHydroHistoryWorld } from '../tests/hydro-dispatch-history-fixture';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'];
const WORLD_SHA = '2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512';
const MAX_BYTES = 80 * 1024 * 1024, MAX_WALL_MS = 12 * 60 * 1000, MAX_CALLS = 360;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown, message: string) => assert.equal(JSON.stringify(a), JSON.stringify(b), message);
type EventReceipt = { tick: number; at: number; event: { type: string; [key: string]: unknown } };
type Original = { file: string; encoding: 'gzip-utf8'; bytes: number; sha256: string; encodedBytes: number; encodedSha256: string };
type Resource = { characters: number; utf8Bytes: number; visited: number; depth: number; gridCharacters: number; gridVisited: number; gridDepth: number };
type Frame = { label: string; tick: number; at: number; save: Original; busOriginal: Original; resources: Resource; eventCount: number; allBusSha256: string; order: string[];
  historyCount: number; snapshotCount: number | null; servedKW: number; upstreamM3: number; downstreamM3: number; generatedKWh: number; transferredM3: number };
type Observed = ReturnType<typeof observe>;
type Branch = { name: string; sim: Simulation; observer: Observed; frames: Frame[] };

export const ROOT23_HYDRO_HISTORY_PLAN = Object.freeze({
  version: 1, actualRun: 'NOT_RUN', scope: HYDRO_HISTORY_FIXTURE_DISCLOSURE,
  command: 'node --import tsx scripts/hydro-dispatch-history-actual.ts --out <new-absolute-directory> --plan <root-frozen-plan.json> --world <preserved-WORLD291.original.json>',
  caps: { wallMilliseconds: MAX_WALL_MS, aggregateOrdinaryStepCalls: MAX_CALLS, physicalOriginalBytes: MAX_BYTES,
    energyDomainCharacters: 4_000_000, nativeLiveCharacters: 8_000_000, nativeVisited: 2_000_000, nativeDepth: 24 },
  small: { originalPrimaryWindows: 96, continuationWindows: 24, freshRestoreBranches: ['whole', 'rawclone', 'physicalParts'], speed: 16, ordinaryStepSeconds: .25 },
  large: { primaryCallCap: 32, minimumLegalWindows: 8, oldLegalWindows: 2, oldRejectedCall: 3,
    earlyCheckpoint: 4, freshRestoreBranches: ['whole', 'rawclone', 'physicalParts'], futureWindowsPerBranch: 4,
    speed: 4, ordinaryStepSeconds: .25, buildings: 612, citizens: 616, vehicles: 344, shops: 210, transportEdges: 691,
    budgetStop: 'Record the actual boundary; export/state/runtime/clock/tick/accumulator/complete bus and phases remain exactly unchanged.',
    worstCase: 'Every future full snapshot may differ. No repetition rate, gzip ratio or 80-window promise.' },
  equality: 'Only the explicit shared powerGrid representation is expanded to original seven keys. Each worldFingerprint is independently proved from its trusted world, then the new proved string is mapped to the old proved string. Every other complete save field and every event remains exact.',
  originals: 'Every distinct full save in every branch is a separate branch-owned gzip physical original, read/decompressed with complete UTF8 equality and both SHA256 values. Full bus streams, all phases, worlds and every actual split part are retained.',
  exclusions: ['default-city electricity activation', 'ROOT20-1700 save migration', 'maintenance construction or wages', 'native night or shop closing', 'native reservoir exhaustion', 'reservoir refill', 'long-term economy', 'Mac/GPU performance'],
});

function clock(sim: Simulation) { return sim.state.day * 1440 + sim.state.hour * 60; }
function grid(sim: Simulation): HydroPowerGridState { const value = sim.state.powerGrid; assert(value?.version === 2); return value; }
function observe(sim: Simulation) {
  const receipts: EventReceipt[] = [];
  const bus = Reflect.get(sim, 'bus') as { emit(event: EventReceipt['event']): void }, emit = bus.emit.bind(bus);
  bus.emit = event => { receipts.push({ tick: sim.state.tick, at: clock(sim), event: structuredClone(event) }); emit(event); };
  return { receipts };
}
function treeSize(value: unknown) {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }]; let visited = 0, depth = 0;
  while (pending.length) { const next = pending.pop()!; visited++; depth = Math.max(depth, next.depth);
    if (next.value !== null && typeof next.value === 'object') for (const child of Object.values(next.value)) pending.push({ value: child, depth: next.depth + 1 }); }
  return { visited, depth };
}
function sourceHashes() {
  const walk = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = directory + '/' + entry.name; assert(entry.isDirectory() || entry.isFile()); return entry.isDirectory() ? walk(path) : [path];
  });
  return Object.fromEntries([...walk('src'), 'scripts/hydro-dispatch-history-actual.ts', 'tests/hydro-dispatch-history-fixture.ts',
    'tests/hydro-dispatch-history.test.ts', 'tests/hydro-dispatch-history-grid.test.ts', 'tests/power-grid-fixture.ts',
    'tests/power-grid-hydro-fixture.ts', 'tests/hydro-maintenance-fixture.ts', 'package.json', 'package-lock.json', 'tsconfig.json'].sort()
    .map(file => { const raw = readFileSync(join(ROOT, file)); return [file, { bytes: raw.byteLength, sha256: sha(raw) }]; }));
}

/** The only allowed save projection. All water/current dispatch/totals, runtime,
 * money, bodies, clocks, metadata and other state fields are retained exactly. */
function normalizedSave(raw: string, ownerWorld: WorldDefinition, oldWorld: WorldDefinition): string {
  const document = JSON.parse(raw), body = document.state.powerGrid as HydroPowerGridState;
  assert.equal(document.worldFingerprint, savedWorldFingerprint(ownerWorld), 'proved original world fingerprint');
  const ownerDeclaration = structuredClone(ownerWorld), ownerGrid = ownerDeclaration.powerGrid;
  assert(ownerGrid?.version === 2); delete ownerGrid.historyEncoding;
  same(ownerDeclaration, oldWorld, 'the trusted worlds differ only by the explicit encoding tag');
  if (ownerWorld.powerGrid?.version === 2 && ownerWorld.powerGrid.historyEncoding === HYDRO_HISTORY_ENCODING) {
    assert.equal(body.historyEncoding, HYDRO_HISTORY_ENCODING); assert(body.snapshots);
    let history: PagedHistory<HydroPowerGridDispatch> = createPagedHistory();
    for (const window of hydroGridWindows(body)) history = appendPagedHistory(history, Object.freeze(window));
    document.state.powerGrid = { version: body.version, kind: body.kind, unit: body.unit, hydro: body.hydro,
      dispatch: body.dispatch, totals: body.totals, history };
    document.worldFingerprint = savedWorldFingerprint(oldWorld);
  } else { assert(!Object.hasOwn(body, 'historyEncoding')); assert(!Object.hasOwn(body, 'snapshots')); }
  return JSON.stringify(document);
}

export function runHydroDispatchHistoryActual(output: string, worldOriginalPath: string, rootPlan?: string, selectedCase: 'all' | 'large-only' = 'all') {
  const out = resolve(output), beganAt = Date.now(); assert(!existsSync(out)); mkdirSync(out, { recursive: false });
  let calls = 0, constructors = 0, imports = 0, readers = 0, bytes = 0, fullSaveBytes = 0, expandedFullSaveBytes = 0;
  const branches: Branch[] = []; let persisted = false;
  const guard = () => assert(Date.now() - beganAt < MAX_WALL_MS, 'twelve-minute native driver guard');
  const workGuard = () => assert(Date.now() - beganAt < MAX_WALL_MS - 30_000, 'reserve thirty seconds within the twelve-minute cap for complete failure originals');
  const write = (file: string, raw: string | Buffer, diagnostic = false) => {
    guard(); const data = typeof raw === 'string' ? Buffer.from(raw) : raw;
    assert(bytes + data.byteLength <= MAX_BYTES - (diagnostic ? 0 : 32 * 1024), '80MiB complete physical evidence cap');
    const path = join(out, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data, { flag: 'wx' });
    bytes += data.byteLength; assert.equal(sha(readFileSync(path)), sha(data)); guard();
  };
  const json = (file: string, value: unknown, diagnostic = false) => write(file, JSON.stringify(value, null, 2) + '\n', diagnostic);
  const compressed = (file: string, raw: string): Original => {
    const encoded = gzipSync(Buffer.from(raw)); write(file, encoded); const disk = readFileSync(join(out, file));
    assert.equal(gunzipSync(disk).toString('utf8'), raw, 'complete physical gzip original read/decode'); guard();
    return { file, encoding: 'gzip-utf8', bytes: Buffer.byteLength(raw), sha256: sha(raw), encodedBytes: disk.byteLength, encodedSha256: sha(disk) };
  };
  const fullSave = (branch: string, raw: string): Original => {
    const file = branch + '/full-saves/' + sha(raw) + '.json.gz';
    if (!existsSync(join(out, file))) { const receipt = compressed(file, raw); fullSaveBytes += receipt.encodedBytes; expandedFullSaveBytes += receipt.bytes; return receipt; }
    const disk = readFileSync(join(out, file)); assert.equal(gunzipSync(disk).toString('utf8'), raw); guard();
    return { file, encoding: 'gzip-utf8', bytes: Buffer.byteLength(raw), sha256: sha(raw), encodedBytes: disk.byteLength, encodedSha256: sha(disk) };
  };
  const persist = () => { if (persisted) return; guard();
    for (const branch of branches) { json(branch.name + '/FRAMES.json', branch.frames);
      compressed(branch.name + '/ALL-NATIVE-BUS.original.json.gz', JSON.stringify(branch.observer.receipts)); }
    persisted = true; guard();
  };
  const inputs = sourceHashes(); json('SOURCE-INPUTS-BEFORE.json', inputs); json('PLAN.json', ROOT23_HYDRO_HISTORY_PLAN);
  const worldRaw = readFileSync(worldOriginalPath); assert.equal(sha(worldRaw), WORLD_SHA); assert.equal(worldRaw.byteLength, 1832308);
  compressed('INPUT-WORLD291.original.json.gz', worldRaw.toString('utf8'));
  json('INPUT-WORLD291-RECEIPT.json', { path: resolve(worldOriginalPath), bytes: worldRaw.byteLength, sha256: sha(worldRaw), usedAs: 'Fresh native layout; no legacy state imported.' });
  if (rootPlan) { const raw = readFileSync(rootPlan); write('ROOT-FROZEN-PLAN.original.json', raw);
    json('ROOT-FROZEN-PLAN-RECEIPT.json', { path: resolve(rootPlan), bytes: raw.byteLength, sha256: sha(raw) }); }

  const construct = (name: string, world: WorldDefinition): Branch => {
    workGuard(); compressed(name + '/World.original.json.gz', JSON.stringify(world)); constructors++;
    const sim = new Simulation(world), branch = { name, sim, observer: observe(sim), frames: [] as Frame[] }; branches.push(branch); return branch;
  };
  const check = (branch: Branch, label: string, events: EventReceipt[] = []) => {
    guard(); const sim = branch.sim, raw = sim.exportSave(), document = JSON.parse(raw), g = grid(sim), full = treeSize(document), small = treeSize(document.state.powerGrid);
    const resources: Resource = { characters: raw.length, utf8Bytes: Buffer.byteLength(raw), ...full,
      gridCharacters: JSON.stringify(g).length, gridVisited: small.visited, gridDepth: small.depth };
    assert(resources.characters <= 8_000_000 && resources.visited <= 2_000_000 && resources.depth <= 24);
    assert(resources.gridCharacters <= 4_000_000); const save = fullSave(branch.name, raw);
    const busOriginal = compressed(branch.name + '/bus-frames/' + label + '.original.json.gz', JSON.stringify(events));
    const result = sim.validateSave(raw); readers++;
    if (!result.ok) json(branch.name + '/FAILED-READER-' + sim.state.tick + '.json', { save, result }); assert(result.ok, result.message);
    assert.equal(sim.exportSave(), raw, 'cold preview cannot mutate complete live save'); validateHydroGridState(sim.state, sim.worldDefinition);
    assert.equal(g.history.count, sim.state.tick); assert.equal(g.hydro.history.count, sim.state.tick);
    assert.equal(Array.from(hydroGridWindows(g)).length, sim.state.tick, 'every original full dispatch remains readable');
    const definition = sim.worldDefinition.powerGrid; assert(definition?.version === 2); const source = definition.sources[0];
    assert(Math.abs(source.hydro.upstream.initialM3 + source.hydro.downstream.initialM3 - g.hydro.upstreamM3 - g.hydro.downstreamM3) < 1e-7);
    assert(Math.abs(g.hydro.generatedKWh - g.hydro.transferredM3 * hydroKWhPerM3(source.hydro)) < 1e-7);
    assert(Math.abs(g.totals.servedKWh - g.hydro.generatedKWh) < 1e-7);
    if (g.dispatch) { assert.equal(g.dispatch.at, clock(sim)); assert.equal(g.dispatch.tick, sim.state.tick);
      assert.equal(g.dispatch.sources[source.id].generatedKWh, g.dispatch.servedKW * g.dispatch.minutes / 60);
      assert.equal(Object.keys(g.dispatch.buildings).length, sim.worldDefinition.buildings.length);
      assert.equal(Object.keys(g.dispatch.vehicles).length, sim.state.vehicles.length);
      assert.equal(g.dispatch.loadSources.shops.length, sim.state.shops.length); }
    const frame: Frame = { label, tick: sim.state.tick, at: clock(sim), save, busOriginal, resources, eventCount: events.length,
      allBusSha256: sha(JSON.stringify(events)), order: [...sim.state.lastSystemOrder], historyCount: g.history.count,
      snapshotCount: g.snapshots?.count ?? null, servedKW: g.dispatch?.servedKW ?? 0,
      upstreamM3: g.hydro.upstreamM3, downstreamM3: g.hydro.downstreamM3, generatedKWh: g.hydro.generatedKWh, transferredM3: g.hydro.transferredM3 };
    branch.frames.push(frame); guard(); return { raw, events, frame };
  };
  const ordinary = (branch: Branch, label: string) => {
    workGuard(); assert(++calls <= MAX_CALLS); const tick = branch.sim.state.tick, cursor = branch.observer.receipts.length;
    branch.sim.step(.25); assert.equal(branch.sim.state.tick, tick + 1); const events = branch.observer.receipts.slice(cursor);
    same(branch.sim.state.lastSystemOrder, ORDER, 'ten phase order');
    same(events.filter(row => row.event.type.startsWith('system:')).map(row => row.event.type.slice(7)), ORDER, 'complete bus ten phase order');
    return check(branch, label, events);
  };
  const speed = (branch: Branch, value: number) => { const result = branch.sim.command({ type: 'speed', value }); assert(result.ok, result.message);
    json(branch.name + '/COMMANDS.json', [{ command: { type: 'speed', value }, result }]); };
  const equalPair = (old: Branch, shared: Branch, a: ReturnType<typeof check>, b: ReturnType<typeof check>) => {
    assert.equal(normalizedSave(a.raw, old.sim.worldDefinition, old.sim.worldDefinition), normalizedSave(b.raw, shared.sim.worldDefinition, old.sim.worldDefinition), 'complete old/shared normalized save equality');
    same(a.events, b.events, 'ALL bus parameters and order old/shared equality');
    same(old.sim.state.lastSystemOrder, shared.sim.state.lastSystemOrder, 'ten phases old/shared equality');
  };
  const split = (branch: Branch, raw: string, label: string) => {
    compressed(branch.name + '/' + label + '.whole.original.json.gz', raw);
    const parts = partitionSave(raw, branch.sim.worldDefinition), manifest = parts.map((part, index) => {
      const file = branch.name + '/' + label + '-parts/' + String(index).padStart(4, '0') + '.json'; write(file, part.json);
      return { id: part.id, file, bytes: Buffer.byteLength(part.json), sha256: sha(part.json) };
    }); json(branch.name + '/' + label + '-PARTS-MANIFEST.json', manifest);
    const diskParts: SavePart[] = manifest.map(item => { const text = readFileSync(join(out, item.file), 'utf8'); assert.equal(sha(text), item.sha256);
      assert.equal(Buffer.byteLength(text), item.bytes); return { id: item.id, json: text }; });
    assert.equal(assembleSave(diskParts), raw, 'actual complete physical parts native assembly');
    const omitted = diskParts.find(part => part.id.startsWith('chunk:') && Object.values(JSON.parse(part.json).arrays ?? {}).some(value => Array.isArray(value) && value.length));
    assert(omitted); assert.throws(() => assembleSave(diskParts.filter(part => part.id !== omitted.id)));
    json(branch.name + '/' + label + '-MISSING-REAL-PART-REJECTED.json', { omittedId: omitted.id, sha256: sha(omitted.json), liveSaveUnchanged: branch.sim.exportSave() === raw });
    return { wholeFile: branch.name + '/' + label + '.whole.original.json.gz', diskParts, physicalParts: parts.length };
  };
  const restore = (name: string, world: WorldDefinition, mode: string, original: string, physical: ReturnType<typeof split>) => {
    const branch = construct(name + '/' + mode, structuredClone(world)); check(branch, 'fresh-native-constructor-before-import');
    const diskWhole = gunzipSync(readFileSync(join(out, physical.wholeFile))).toString('utf8'); assert.equal(diskWhole, original);
    const raw = mode === 'whole' ? diskWhole : mode === 'rawclone' ? JSON.stringify(JSON.parse(diskWhole)) : assembleSave(physical.diskParts);
    assert.equal(raw, original); const result = branch.sim.importSave(raw); imports++; assert(result.ok, result.message);
    assert.equal(branch.sim.exportSave(), original, 'fresh complete import exact export'); check(branch, 'complete-import'); return branch;
  };
  const atomicBudgetStop = (branch: Branch, label: string) => {
    const before = branch.sim.exportSave(), events = JSON.stringify(branch.observer.receipts), phase = JSON.stringify(branch.sim.state.lastSystemOrder);
    const state = JSON.stringify(branch.sim.state), runtime = JSON.stringify(Reflect.get(branch.sim, 'runtime'));
    const cursor = branch.observer.receipts.length; guard(); assert(++calls <= MAX_CALLS);
    let error: unknown; try { branch.sim.step(.25); } catch (caught) { error = caught; }
    assert(error instanceof Error && /原生保存预算/.test(error.message), 'explicit energy budget preflight rejection only');
    assert.equal(branch.sim.exportSave(), before); assert.equal(JSON.stringify(branch.sim.state), state); assert.equal(JSON.stringify(Reflect.get(branch.sim, 'runtime')), runtime);
    assert.equal(JSON.stringify(branch.observer.receipts), events); assert.equal(JSON.stringify(branch.sim.state.lastSystemOrder), phase);
    assert.equal(branch.observer.receipts.length, cursor); const checked = check(branch, label);
    json(branch.name + '/' + label + '.json', { rejected: true, message: error.message, tick: branch.sim.state.tick, at: clock(branch.sim),
      accumulator: Reflect.get(branch.sim, 'runtime').accumulator, fullSave: checked.frame.save, wholeStateRuntimeBusPhasesUnchanged: true }); return error.message;
  };
  let smallWindows = 0, smallPhysicalParts = 0, smallPositiveWaterKWh: boolean | null = null;
  let largeWindows = 0, largeBoundary: { stopped: boolean; reason: string | null } = { stopped: false, reason: null };
  try {
    if (selectedCase === 'all') {
    const smallOld = construct('six-city/old', sixCityHydroHistoryWorld(false)), smallNew = construct('six-city/shared', sixCityHydroHistoryWorld(true));
    assert.equal(smallOld.sim.worldDefinition.buildings.length, 6); assert.equal(smallOld.sim.state.vehicles.length, 1);
    equalPair(smallOld, smallNew, check(smallOld, 'native-constructor'), check(smallNew, 'native-constructor'));
    speed(smallOld, 16); speed(smallNew, 16); equalPair(smallOld, smallNew, check(smallOld, 'public-speed16'), check(smallNew, 'public-speed16'));
    for (let n = 1; n <= 96; n++) { equalPair(smallOld, smallNew, ordinary(smallOld, 'primary-' + n), ordinary(smallNew, 'primary-' + n)); smallWindows++; }
    const smallCheckpoint = smallNew.sim.exportSave(), smallParts = split(smallNew, smallCheckpoint, 'CHECKPOINT96');
    const smallRestores = ['whole', 'rawclone', 'physicalParts'].map(mode => restore('six-city/restored', smallNew.sim.worldDefinition, mode, smallCheckpoint, smallParts));
    for (let n = 1; n <= 24; n++) {
      const a = ordinary(smallOld, 'future-' + n), b = ordinary(smallNew, 'future-' + n); equalPair(smallOld, smallNew, a, b);
      for (const branch of smallRestores) { const actual = ordinary(branch, 'future-' + n); assert.equal(actual.raw, b.raw, 'entire restored future24 save exact');
        same(actual.events, b.events, 'ALL restored future24 bus exact'); same(actual.frame.order, b.frame.order, 'restored future24 ten phases exact'); }
    }
    assert(grid(smallNew.sim).hydro.generatedKWh > 0 && grid(smallNew.sim).hydro.transferredM3 > 0);
    smallPhysicalParts = smallParts.physicalParts; smallPositiveWaterKWh = true;
    compressed('six-city/TERMINAL.raw.original.json.gz', smallNew.sim.exportSave());
    }
    const originalWorld = JSON.parse(worldRaw.toString('utf8')) as WorldDefinition;
    const largeOld = construct('large-city/old', largeCityHydroHistoryWorld(originalWorld, false));
    const largeNew = construct('large-city/shared', largeCityHydroHistoryWorld(originalWorld, true));
    for (const branch of [largeOld, largeNew]) { assert.equal(branch.sim.state.citizens.length, 616); assert.equal(branch.sim.state.vehicles.length, 344); assert.equal(branch.sim.state.shops.length, 210);
      const layout = structuredClone(branch.sim.worldDefinition); delete layout.powerGrid; same(layout, originalWorld, 'all original layout bytes as data unchanged'); }
    equalPair(largeOld, largeNew, check(largeOld, 'native-constructor'), check(largeNew, 'native-constructor'));
    speed(largeOld, 4); speed(largeNew, 4);
    equalPair(largeOld, largeNew, check(largeOld, 'public-speed4'), check(largeNew, 'public-speed4'));
    for (let n = 1; n <= 2; n++) { equalPair(largeOld, largeNew, ordinary(largeOld, 'primary-' + n), ordinary(largeNew, 'primary-' + n)); largeWindows++; }
    atomicBudgetStop(largeOld, 'OLD-THIRD-CALL-BUDGET-STOP');
    const futureExpected: ReturnType<typeof check>[] = []; let largeCheckpoint = '', largeParts: ReturnType<typeof split> | undefined;
    while (largeWindows < 32) {
      const before = largeNew.sim.exportSave(), cursor = largeNew.observer.receipts.length;
      const beforeState = JSON.stringify(largeNew.sim.state), beforeRuntime = JSON.stringify(Reflect.get(largeNew.sim, 'runtime')),
        beforeBus = JSON.stringify(largeNew.observer.receipts), beforePhases = JSON.stringify(largeNew.sim.state.lastSystemOrder);
      try { const next = ordinary(largeNew, 'primary-' + (largeWindows + 1)); largeWindows++;
        if (largeWindows === 4) { largeCheckpoint = next.raw; largeParts = split(largeNew, largeCheckpoint, 'CHECKPOINT4'); }
        if (largeWindows >= 5 && largeWindows <= 8) futureExpected.push(next);
      } catch (error) {
        if (!(error instanceof Error) || !/原生保存预算/.test(error.message)) throw error;
        assert.equal(largeNew.sim.exportSave(), before); assert.equal(largeNew.observer.receipts.length, cursor);
        assert.equal(JSON.stringify(largeNew.sim.state), beforeState); assert.equal(JSON.stringify(Reflect.get(largeNew.sim, 'runtime')), beforeRuntime);
        assert.equal(JSON.stringify(largeNew.observer.receipts), beforeBus); assert.equal(JSON.stringify(largeNew.sim.state.lastSystemOrder), beforePhases);
        const checked = check(largeNew, 'SHARED-ACTUAL-BUDGET-STOP');
        json(largeNew.name + '/SHARED-ACTUAL-BUDGET-STOP.json', { rejected: true, message: error.message, tick: largeNew.sim.state.tick,
          at: clock(largeNew.sim), accumulator: Reflect.get(largeNew.sim, 'runtime').accumulator,
          fullSave: checked.frame.save, wholeStateRuntimeBusPhasesUnchanged: true });
        largeBoundary = { stopped: true, reason: error.message }; break;
      }
    }
    assert(largeWindows >= 8, 'fewer than eight legal full-city windows is a genuine blocked scaling gate');
    assert(largeParts && largeCheckpoint && futureExpected.length === 4);
    for (const mode of ['whole', 'rawclone', 'physicalParts']) {
      const branch = restore('large-city/restored', largeNew.sim.worldDefinition, mode, largeCheckpoint, largeParts);
      for (let n = 0; n < 4; n++) { const actual = ordinary(branch, 'future-' + (n + 1)), expected = futureExpected[n];
        assert.equal(actual.raw, expected.raw, 'entire large restored future4 save exact'); same(actual.events, expected.events, 'ALL large restored future4 bus exact');
        same(actual.frame.order, expected.frame.order, 'large restored future4 phases exact'); }
    }
    const terminal = largeNew.sim.exportSave(); compressed('large-city/TERMINAL.raw.original.json.gz', terminal);
    const rejected: unknown[] = [];
    for (const [name, mutate] of [
      ['missing-snapshots', (value: any) => { delete value.state.powerGrid.snapshots; }],
      ['wrong-original-generated-kwh', (value: any) => { value.state.powerGrid.history.pages[0][0].windows[0].generatedKWh += 1; }],
      ['missing-water-row', (value: any) => { value.state.powerGrid.hydro.history.pages[0][0].windows.pop(); }],
    ] as const) { const document = JSON.parse(terminal); mutate(document); const bad = JSON.stringify(document), before = largeNew.sim.exportSave();
      const preview = largeNew.sim.validateSave(bad); readers++; assert.equal(preview.ok, false, name); assert.equal(largeNew.sim.exportSave(), before);
      const loaded = largeNew.sim.importSave(bad); imports++; assert.equal(loaded.ok, false, name); assert.equal(largeNew.sim.exportSave(), before);
      rejected.push({ name, preview, loaded, bad: fullSave('cold-rejected', bad), completeLiveSaveUnchanged: true }); }
    json('COLD-READER-REJECTIONS.json', rejected);
    const clone = structuredClone(largeNew.sim.state); validateHydroGridState(clone, largeNew.sim.worldDefinition);
    assert.throws(() => prepareHydroBeforeTick(largeNew.sim.worldDefinition, clone, .25), /水力电网契约/); assert.equal(largeNew.sim.exportSave(), terminal);
    json('CLONE-DOES-NOT-GAIN-LIVE-CAPABILITY.json', { coldShapeValid: true, nativePreflightRejected: true, completeLiveSaveUnchanged: true });
    const vehicleEdges = new Set(largeNew.frames.filter(frame => frame.tick > 0).map(frame => {
      const raw = gunzipSync(readFileSync(join(out, frame.save.file))).toString('utf8');
      const vehicles = JSON.parse(raw).state.powerGrid.dispatch.vehicles as Record<string, { edgeId: string }>;
      return JSON.stringify(Object.entries(vehicles).map(([id, meter]) => [id, meter.edgeId]));
    }));
    assert(vehicleEdges.size > 1, 'full native traffic actually changes its complete vehicle load observations');
    guard(); persist(); guard(); const after = sourceHashes(); same(after, inputs, 'all source inputs stable during native gate'); json('SOURCE-INPUTS-AFTER.json', after); guard();
    const result = { status: 'ACTUAL_COMPLETED' as const, selectedCase, smallPrimaryWindows: smallWindows, smallPrimaryContinuationWindows: selectedCase === 'all' ? 24 : 0,
      largePrimaryWindows: largeWindows, largeBoundary, oldLargeLegalWindows: 2, oldLargeRejectedCall: 3,
      stepCalls: calls, constructors, imports, completeReaderCalls: readers, fullSaveBytes, expandedFullSaveBytes,
      physicalOriginalBytesBeforeResult: bytes, physicalOriginalBytes: 0, wallMillisecondsBeforeResult: Date.now() - beganAt,
      freshRestoreBranches: ['whole', 'rawclone', 'physicalParts'], smallFuturePerBranch: selectedCase === 'all' ? 24 : 0, largeFuturePerBranch: 4,
      sourceInputsStable: true, clockJumps: 0, directBodyMoneyNeedsStockIdentityEdits: 0, removedVehicleShopHistoryEntries: 0,
      originalWorldSha256: WORLD_SHA, largeVehicleObservationVersions: vehicleEdges.size,
      smallPositiveWaterKWh, nativeNightShopClosingOrExhaustionClaimed: false, physicalParts: { small: selectedCase === 'all' ? smallPhysicalParts : null, large: largeParts.physicalParts } };
    for (let n = 0; n < 5; n++) { const total = bytes + Buffer.byteLength(JSON.stringify(result, null, 2) + '\n');
      if (result.physicalOriginalBytes === total) break; result.physicalOriginalBytes = total; }
    assert.equal(result.physicalOriginalBytes, bytes + Buffer.byteLength(JSON.stringify(result, null, 2) + '\n'));
    json('RESULT.json', result); assert.equal(bytes, result.physicalOriginalBytes); guard(); return result;
  } catch (error) { try { persist(); } catch (failure) { json('PERSIST-FAILURE.json', { error: String(failure), calls, bytes }, true); }
    json('FAILURE.json', { status: 'ACTUAL_FAILED_OR_PARTIAL', error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      selectedCase, stepCalls: calls, constructors, imports, readers, smallWindows, largeWindows, bytes, elapsedMilliseconds: Date.now() - beganAt }, true); throw error; }
}

// Importing the driver is inert; only the explicitly selected root gate runs it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) { const key = process.argv[index], value = process.argv[index + 1];
    assert(['--out', '--plan', '--world', '--case'].includes(key) && value && !args.has(key)); args.set(key, value); }
  assert(args.has('--out') && args.has('--plan') && args.has('--world')); assert.equal(resolve(args.get('--out')!), args.get('--out'));
  const selectedCase = args.get('--case') ?? 'all'; assert(selectedCase === 'all' || selectedCase === 'large-only');
  const result = runHydroDispatchHistoryActual(args.get('--out')!, args.get('--world')!, args.get('--plan')!, selectedCase);
  console.log(JSON.stringify({ status: result.status, stepCalls: result.stepCalls, smallPrimaryWindows: result.smallPrimaryWindows,
    largePrimaryWindows: result.largePrimaryWindows, largeBoundary: result.largeBoundary, output: relative(ROOT, args.get('--out')!) }));
}
