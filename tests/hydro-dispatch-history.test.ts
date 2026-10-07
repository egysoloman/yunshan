import assert from 'node:assert/strict';
import test from 'node:test';
import { appendSharedHydroDispatch, expandHydroDispatch, makeHydroSnapshot,
  pagedHistoryAppendCharDelta, readSharedHydroDispatches } from '../src/simulation/hydro-dispatch-history';
import { appendPagedHistory, createPagedHistory } from '../src/simulation/power-hydro-runtime';
import type { PagedHistory, PagedHydroWindow } from '../src/simulation/power-hydro-runtime';
import type { HydroPowerGridDispatch } from '../src/simulation/power-grid-hydro';

type Snapshot = ReturnType<typeof makeHydroSnapshot>;
type Reference = ReturnType<typeof appendSharedHydroDispatch>['reference'];
type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> };
interface SharedCandidate {
  snapshots: PagedHistory<Snapshot>;
  history: PagedHistory<Reference>;
  hydro: { history: PagedHistory<PagedHydroWindow> };
}
const SOURCE_ID = 'history-hydro';
const DISPATCH_KEYS = ['tick', 'beforeAt', 'at', 'nativeMinutes', 'minutes',
  'availableKW', 'demandKW', 'servedKW', 'unservedKW', 'curtailedKW',
  'sources', 'links', 'nodes', 'buildings', 'vehicles', 'loadSources', 'diagnostics'];
const REFERENCE_KEYS = ['snapshotIndex', 'generatedKWh'];

function clone<T>(value: T): Mutable<T> { return JSON.parse(JSON.stringify(value)) as Mutable<T>; }
function freezeData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}
function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeepFrozen(child);
}
/** Pure encoding inputs, not a city fixture, physical replay or live capability.
 * The two generation doubles deliberately differ: grid energy is computed
 * from accepted flow, while the independent water ledger keeps its own value. */
function dispatch(tick: number): HydroPowerGridDispatch {
  const beforeAt = 480 + (tick - 1) * .25;
  return { tick, beforeAt, at: beforeAt + .25, nativeMinutes: .25, minutes: .25,
    availableKW: 100, demandKW: 24, servedKW: 24, unservedKW: 0, curtailedKW: 76,
    sources: { [SOURCE_ID]: { availableKW: 100, suppliedKW: 24, transferredM3: 1, generatedKWh: .1 } },
    links: { 'wire-a': 24, 'wire-empty': 0 }, nodes: { 'source-a': 24, 'load-a': 24 },
    buildings: { 'farm-a': { nodeId: 'load-a', demandKW: 24, servedKW: 24, unservedKW: 0 },
      'clinic-a': { nodeId: null, demandKW: 0, servedKW: 0, unservedKW: 0 } },
    vehicles: { 'train-a': { nodeId: 'load-a', demandKW: 0, servedKW: 0, unservedKW: 0, edgeId: 'rail-a' } },
    loadSources: { shops: [{ id: 'shop-a', buildingId: 'farm-a', allowsOperation: true }], equipmentAvailable: true },
    diagnostics: { unconnectedBuildings: ['clinic-a'], unconnectedVehicles: [],
      islandNodeIds: ['island-a'], exhaustedSourceIds: [], constrainedLinkIds: ['wire-a'], constrainedNodeIds: [] } };
}
function water(tick: number): PagedHydroWindow {
  const beforeAt = 480 + (tick - 1) * .25;
  return { at: beforeAt + .25, minutes: .25, acceptedKW: 24, intakeOpen: true, outfallOpen: true,
    beforeUpstreamM3: 100 - tick + 1, beforeDownstreamM3: tick - 1,
    availableKW: 100, suppliedKW: 24.000000000000004, unservedKW: 0,
    transferredM3: 1, generatedKWh: .10000000000000002,
    afterUpstreamM3: 100 - tick, afterDownstreamM3: tick, waterBalanceResidualM3: 0,
    tick, beforeAt, nativeMinutes: .25 };
}
function fixture(count = 2): { candidate: SharedCandidate; originals: HydroPowerGridDispatch[] } {
  let snapshots = createPagedHistory<Snapshot>(), history = createPagedHistory<Reference>();
  let physical = createPagedHistory<PagedHydroWindow>();
  const originals: HydroPowerGridDispatch[] = [];
  for (let tick = 1; tick <= count; tick++) {
    const original = freezeData(dispatch(tick)); originals.push(original);
    const next = appendSharedHydroDispatch(snapshots, history, original);
    snapshots = next.snapshots; history = next.history;
    physical = appendPagedHistory(physical, freezeData(water(tick)));
  }
  return { candidate: { snapshots, history, hydro: { history: physical } }, originals };
}
function read(candidate: SharedCandidate): HydroPowerGridDispatch[] {
  return [...readSharedHydroDispatches(candidate, SOURCE_ID)];
}
function reject(candidate: Mutable<SharedCandidate>): void {
  assert.throws(() => read(candidate));
}
function frozenHistory<T>(rows: readonly T[]): PagedHistory<T> {
  const pages = [];
  for (let firstIndex = 0; firstIndex < rows.length; firstIndex += 256) {
    pages.push(Object.freeze({ firstIndex, windows: Object.freeze(rows.slice(firstIndex, firstIndex + 256)) }));
  }
  const branches = [];
  for (let index = 0; index < pages.length; index += 32) branches.push(Object.freeze(pages.slice(index, index + 32)));
  return Object.freeze({ count: rows.length, pages: Object.freeze(branches) });
}

test('snapshot removes only clock and per-window source quantities and deeply freezes all complete fields', () => {
  const original = dispatch(1), snapshot = makeHydroSnapshot(original);
  assert.equal(Reflect.ownKeys(snapshot).length, 12);
  assert.deepEqual(Object.keys(snapshot), DISPATCH_KEYS.slice(5));
  assert.deepEqual(snapshot.sources[SOURCE_ID], { availableKW: 100, suppliedKW: 24 });
  assert.equal(Reflect.ownKeys(snapshot.sources[SOURCE_ID]).length, 2);
  assert.deepEqual(snapshot.links, original.links); assert.deepEqual(snapshot.nodes, original.nodes);
  assert.deepEqual(snapshot.buildings, original.buildings); assert.deepEqual(snapshot.vehicles, original.vehicles);
  assert.deepEqual(snapshot.loadSources, original.loadSources); assert.deepEqual(snapshot.diagnostics, original.diagnostics);
  assertDeepFrozen(snapshot);
});

test('compact reference retains grid binary64 generation rather than substituting the water ledger value', () => {
  const original = freezeData(dispatch(1)), physical = water(1);
  const next = appendSharedHydroDispatch(createPagedHistory<Snapshot>(), createPagedHistory<Reference>(), original);
  assert.deepEqual(Object.keys(next.reference), REFERENCE_KEYS);
  assert.equal(Reflect.ownKeys(next.reference).length, 2);
  assert.equal(next.reference.generatedKWh, .1);
  assert.notEqual(next.reference.generatedKWh, physical.generatedKWh);
  const expanded = expandHydroDispatch(next.snapshot, next.reference, physical, SOURCE_ID);
  assert.deepEqual(Object.keys(expanded), DISPATCH_KEYS);
  assert.equal(expanded.sources[SOURCE_ID].transferredM3, physical.transferredM3);
  assert.equal(expanded.sources[SOURCE_ID].generatedKWh, .1);
  assert.equal(JSON.stringify(expanded), JSON.stringify(original));
});

test('equal consecutive snapshots share one index and cold expansion preserves every full dispatch JSON', () => {
  const { candidate, originals } = fixture(3);
  assert.equal(candidate.snapshots.count, 1); assert.equal(candidate.history.count, 3);
  for (const reference of candidate.history.pages[0][0].windows) assert.equal(reference.snapshotIndex, 0);
  const restored = clone(candidate), before = JSON.stringify(restored), expanded = read(restored);
  assert.equal(expanded.length, originals.length);
  expanded.forEach((item, index) => assert.equal(JSON.stringify(item), JSON.stringify(originals[index])));
  assert.equal(JSON.stringify(restored), before);
  assert.equal(Object.isFrozen(restored), false); assert.equal(Object.isFrozen(restored.snapshots), false);
});

test('a changed load or diagnostic creates a new snapshot and returning to an earlier value preserves a new transition', () => {
  const first = freezeData(dispatch(1));
  const a = appendSharedHydroDispatch(createPagedHistory<Snapshot>(), createPagedHistory<Reference>(), first);
  assert.equal(a.snapshotAdded, true);
  const second = dispatch(2); second.loadSources.shops[0].allowsOperation = false;
  second.diagnostics.unconnectedVehicles.push('train-a');
  const b = appendSharedHydroDispatch(a.snapshots, a.history, freezeData(second));
  assert.equal(b.snapshotAdded, true); assert.equal(b.snapshots.count, 2); assert.equal(b.reference.snapshotIndex, 1);
  assert.notEqual(b.currentJSONKey, a.currentJSONKey);
  const c = appendSharedHydroDispatch(b.snapshots, b.history, freezeData(dispatch(3)));
  assert.equal(c.snapshotAdded, true); assert.equal(c.snapshots.count, 3); assert.equal(c.reference.snapshotIndex, 2);
  assert.equal(c.currentJSONKey, a.currentJSONKey);
  const d = appendSharedHydroDispatch(c.snapshots, c.history, freezeData(dispatch(4)));
  assert.equal(d.snapshotAdded, false); assert.equal(d.snapshots.count, 3); assert.equal(d.reference.snapshotIndex, 2);
  assert.equal(d.snapshots, c.snapshots);
});

test('grid generation changes without changing the shared snapshot or losing the exact scalar', () => {
  const a = appendSharedHydroDispatch(createPagedHistory<Snapshot>(), createPagedHistory<Reference>(), freezeData(dispatch(1)));
  const changed = dispatch(2); changed.sources[SOURCE_ID].generatedKWh = .10000000000000003;
  const b = appendSharedHydroDispatch(a.snapshots, a.history, freezeData(changed));
  assert.equal(b.snapshotAdded, false); assert.equal(b.snapshots.count, 1);
  assert.equal(b.reference.generatedKWh, .10000000000000003);
  assert.equal(JSON.stringify(expandHydroDispatch(b.snapshot, b.reference, water(2), SOURCE_ID)), JSON.stringify(changed));
});

test('exact append character deltas cover empty, count-digit, 256-page and 8192-branch boundaries', () => {
  const row = freezeData({ tick: 8, at: 480.123456789, label: 'quote"backslash\\line\n水' });
  const rowChars = JSON.stringify(row).length;
  for (const count of [0, 1, 9, 99, 255, 256, 257, 999, 8191, 8192, 8193]) {
    const history = frozenHistory(Array.from({ length: count }, () => row));
    const delta = pagedHistoryAppendCharDelta(history, row), appended = appendPagedHistory(history, row);
    assert.equal(delta, JSON.stringify(appended).length - JSON.stringify(history).length, 'count=' + count);
    if (count === 0) assert.equal(delta, rowChars + 31);
    if (count === 256) assert.equal(delta, rowChars + 32);
    if (count === 8192) assert.equal(delta, rowChars + 35);
  }
});

test('append character deltas accumulate to the complete JSON difference through the page boundary', () => {
  const row = freezeData({ snapshotIndex: 0, generatedKWh: .10000000000000003 });
  let history = createPagedHistory<typeof row>(), cumulative = 0;
  const initialChars = JSON.stringify(history).length;
  for (let count = 0; count < 258; count++) {
    cumulative += pagedHistoryAppendCharDelta(history, row);
    history = appendPagedHistory(history, row);
  }
  assert.equal(cumulative, JSON.stringify(history).length - initialChars);
});

test('cold reader rejects negative, fractional, out-of-pool and premature snapshot indices', () => {
  const { candidate } = fixture();
  for (const snapshotIndex of [-1, .5, 1, NaN]) {
    const bad = clone(candidate); bad.history.pages[0][0].windows[0].snapshotIndex = snapshotIndex; reject(bad);
  }
  const premature = clone(candidate);
  const later = dispatch(2); later.loadSources.shops[0].allowsOperation = false;
  premature.snapshots = clone(frozenHistory([makeHydroSnapshot(dispatch(1)), makeHydroSnapshot(later)]));
  premature.history.pages[0][0].windows[0].snapshotIndex = 1;
  reject(premature);
});

test('cold reader rejects missing references, missing physical windows and holes in the snapshot pool', () => {
  const { candidate } = fixture();
  const referenceHole = clone(candidate); delete referenceHole.history.pages[0][0].windows[0]; reject(referenceHole);
  const snapshotHole = clone(candidate); delete snapshotHole.snapshots.pages[0][0].windows[0]; reject(snapshotHole);
  const waterHole = clone(candidate); delete waterHole.hydro.history.pages[0][0].windows[0]; reject(waterHole);
  const missingWater = clone(candidate); missingWater.hydro.history.pages[0][0].windows.pop();
  missingWater.hydro.history.count--; reject(missingWater);
});

test('cold reader rejects array and field accessors without invoking supplied getters', () => {
  const { candidate } = fixture(); let invoked = 0;
  const referenceGetter = clone(candidate);
  Object.defineProperty(referenceGetter.history.pages[0][0].windows, '0', {
    enumerable: true, get() { invoked++; return candidate.history.pages[0][0].windows[0]; } });
  reject(referenceGetter); assert.equal(invoked, 0);
  const fieldGetter = clone(candidate);
  Object.defineProperty(fieldGetter.history.pages[0][0].windows[0], 'snapshotIndex', {
    enumerable: true, get() { invoked++; return 0; } });
  reject(fieldGetter); assert.equal(invoked, 0);
  const snapshotGetter = clone(candidate);
  Object.defineProperty(snapshotGetter.snapshots.pages[0][0].windows[0].loadSources.shops[0], 'allowsOperation', {
    enumerable: true, get() { invoked++; return true; } });
  reject(snapshotGetter); assert.equal(invoked, 0);
});

test('cold reader rejects symbol fields and undeclared compact or snapshot fields', () => {
  const { candidate } = fixture();
  const referenceSymbol = clone(candidate);
  Object.defineProperty(referenceSymbol.history.pages[0][0].windows[0], Symbol('reference'), { value: 1 });
  reject(referenceSymbol);
  const snapshotSymbol = clone(candidate);
  Object.defineProperty(snapshotSymbol.snapshots.pages[0][0].windows[0], Symbol('snapshot'), { value: 1 });
  reject(snapshotSymbol);
  const extraReference = clone(candidate); Object.assign(extraReference.history.pages[0][0].windows[0], { suppliedKW: 24 });
  reject(extraReference);
  const extraSnapshot = clone(candidate); Object.assign(extraSnapshot.snapshots.pages[0][0].windows[0], { tick: 1 });
  reject(extraSnapshot);
});

test('cold reader rejects an unused snapshot and an adjacent duplicate snapshot transition', () => {
  const { candidate } = fixture();
  const unused = clone(candidate), later = dispatch(3); later.loadSources.shops[0].allowsOperation = false;
  const unusedSnapshot = makeHydroSnapshot(later);
  unused.snapshots = clone(frozenHistory([candidate.snapshots.pages[0][0].windows[0], unusedSnapshot]));
  reject(unused);
  const duplicate = clone(candidate);
  duplicate.snapshots = clone(frozenHistory([candidate.snapshots.pages[0][0].windows[0],
    candidate.snapshots.pages[0][0].windows[0]]));
  duplicate.history.pages[0][0].windows[1].snapshotIndex = 1;
  reject(duplicate);
});

test('cold reader rejects adjacent equal snapshots even when nested plain-object key order differs', () => {
  const { candidate } = fixture(), duplicate = clone(candidate);
  const first = clone(candidate.snapshots.pages[0][0].windows[0]);
  const reordered = Object.fromEntries(Object.entries(clone(first)).reverse()) as Mutable<Snapshot>;
  reordered.links = Object.fromEntries(Object.entries(reordered.links).reverse());
  reordered.nodes = Object.fromEntries(Object.entries(reordered.nodes).reverse());
  const source = reordered.sources[SOURCE_ID];
  reordered.sources[SOURCE_ID] = { suppliedKW: source.suppliedKW, availableKW: source.availableKW };
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(first));
  assert.deepEqual(reordered, first);
  duplicate.snapshots = clone(frozenHistory([first, reordered]));
  duplicate.history.pages[0][0].windows[1].snapshotIndex = 1;
  reject(duplicate);
});

test('expansion copies all stored water clocks exactly without recomputing the normalized interval', () => {
  const original = freezeData(dispatch(1));
  const next = appendSharedHydroDispatch(createPagedHistory<Snapshot>(), createPagedHistory<Reference>(), original);
  const physical = water(1); physical.tick = 37; physical.beforeAt = 1439.99;
  physical.at = 1440.06234568; physical.nativeMinutes = .0723456789;
  physical.minutes = physical.at - physical.beforeAt;
  assert.notEqual(physical.minutes, physical.nativeMinutes);
  const expanded = expandHydroDispatch(next.snapshot, next.reference, physical, SOURCE_ID);
  for (const key of ['tick', 'beforeAt', 'at', 'nativeMinutes', 'minutes'] as const) {
    assert.equal(expanded[key], physical[key]);
  }
  assert.deepEqual(Object.keys(expanded), DISPATCH_KEYS);
});

test('snapshot entry rejects incomplete dispatches, accessors and symbols before reading supplied data', () => {
  const missing = dispatch(1); Reflect.deleteProperty(missing, 'diagnostics');
  assert.throws(() => makeHydroSnapshot(missing));
  let invoked = 0; const accessor = dispatch(1);
  Object.defineProperty(accessor, 'sources', { enumerable: true,
    get() { invoked++; return dispatch(1).sources; } });
  assert.throws(() => makeHydroSnapshot(accessor)); assert.equal(invoked, 0);
  const symbol = dispatch(1); Object.defineProperty(symbol, Symbol('dispatch'), { value: 1 });
  assert.throws(() => makeHydroSnapshot(symbol));
});
