import assert from 'node:assert/strict';
import test from 'node:test';
import { createFiniteHydroState, dispatchFiniteHydro, FINITE_HYDRO_MAX_HISTORY } from '../src/simulation/power-hydro';
import type { FiniteHydroDefinition, FiniteHydroWindow } from '../src/simulation/power-hydro';
import { commitPagedHydro, createPagedHydro, createPagedHydroRuntime, offerPagedHydro,
  PAGED_HYDRO_MAX_WINDOWS, PAGED_HYDRO_PAGE_SIZE, pagedHydroEndAt, pagedHydroWindows,
  pagedHydroJsonUpperBound, preflightPagedHydro, preparePagedHydro, validatePagedHydro } from '../src/simulation/power-hydro-runtime';
import type { PagedHydroClockRequest, PagedHydroRuntime, PagedHydroState, PagedHydroWindow } from '../src/simulation/power-hydro-runtime';

function asset(): FiniteHydroDefinition {
  return { version: 1, kind: 'finite-constant-head-hydro', id: 'runtime-hydro', enabledAt: 480,
    upstream: { id: 'runtime-upper', capacityM3: 100, initialM3: 20 },
    downstream: { id: 'runtime-lower', capacityM3: 100, initialM3: 1 },
    headMeters: 100, efficiency: .8, maximumM3PerMinute: 1, maximumKW: 1000 };
}
function clock(state: PagedHydroState, nativeMinutes = .25,
  changes: Partial<PagedHydroClockRequest> = {}): PagedHydroClockRequest {
  return { tick: state.tick + 1, beforeAt: state.at, at: pagedHydroEndAt(state.at, nativeMinutes),
    nativeMinutes, intakeOpen: true, outfallOpen: true, ...changes };
}
function fixture(definition = asset()) {
  const owner = {}, state = createPagedHydro(definition);
  return { definition, owner, state, runtime: createPagedHydroRuntime(owner, definition, state, state.at, state.tick) };
}
function advance(runtime: PagedHydroRuntime, owner: object, state: PagedHydroState,
  acceptedKW = 3.27, nativeMinutes = .25, changes: Partial<PagedHydroClockRequest> = {}): PagedHydroState {
  const request = clock(state, nativeMinutes, changes);
  return commitPagedHydro(runtime, owner, state, preparePagedHydro(runtime, owner, state, request, acceptedKW));
}
function physical(window: PagedHydroWindow): FiniteHydroWindow {
  const { tick: _tick, beforeAt: _beforeAt, nativeMinutes: _nativeMinutes, ...parameters } = window;
  return parameters;
}
type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> };
function clone<T>(value: T): Mutable<T> { return JSON.parse(JSON.stringify(value)) as Mutable<T>; }

test('an initial paged ledger is frozen but only its private owner runtime can use live source stock', () => {
  const { definition, owner, state, runtime } = fixture();
  validatePagedHydro(definition, state, 480, 0);
  assert(Object.isFrozen(state)); assert(Object.isFrozen(state.history));
  assert.deepEqual(state.history.pages, []); assert.equal(state.history.count, 0);
  assert.throws(() => offerPagedHydro({} as PagedHydroRuntime, owner, state, clock(state)), /generic/);
  assert.throws(() => offerPagedHydro(runtime, {}, state, clock(state)), /foreign/);
  assert.throws(() => offerPagedHydro(runtime, owner, clone(state), clock(state)), /clone/);
});
test('repeated offers and prepared physical output debit nothing before the exact authorized commit', () => {
  const { owner, state, runtime } = fixture(), request = clock(state);
  const before = JSON.stringify(state), first = offerPagedHydro(runtime, owner, state, request);
  assert.equal(offerPagedHydro(runtime, owner, state, request), first);
  const prepared = preparePagedHydro(runtime, owner, state, request, 3.27);
  assert.equal(JSON.stringify(state), before); assert.equal(state.history.count, 0);
  assert(Object.isFrozen(prepared)); assert(Object.isFrozen(prepared.state)); assert(Object.isFrozen(prepared.window));
  assert.throws(() => offerPagedHydro(runtime, owner, prepared.state, clock(prepared.state)), /stale/);
  const next = commitPagedHydro(runtime, owner, state, prepared);
  assert.equal(next, prepared.state); assert(next.upstreamM3 < state.upstreamM3);
  assert.equal(commitPagedHydro(runtime, owner, state, prepared), next);
  assert.throws(() => offerPagedHydro(runtime, owner, state, request), /stale/);
});
test('only identical same-phase requests are idempotent and conflicting preparations cannot both commit', () => {
  const { definition, owner, state, runtime } = fixture(), request = clock(state);
  const first = preparePagedHydro(runtime, owner, state, request, 3.27);
  const conflicting = preparePagedHydro(runtime, owner, state, request, 0);
  const current = commitPagedHydro(runtime, owner, state, first), before = JSON.stringify(current);
  assert.throws(() => commitPagedHydro(runtime, owner, state, conflicting), /stale/);
  const repeated = preparePagedHydro(runtime, owner, current, request, 3.27);
  assert.equal(commitPagedHydro(runtime, owner, current, repeated), current);
  assert.throws(() => preparePagedHydro(runtime, owner, current, request, 0), /同相位/);
  assert.throws(() => preparePagedHydro(runtime, owner, current, { ...request, intakeOpen: false }, 3.27), /同相位/);
  const later = advance(runtime, owner, current);
  assert.throws(() => commitPagedHydro(runtime, owner, state, first), /stale/);
  assert.equal(JSON.stringify(current), before); validatePagedHydro(definition, later, later.at, later.tick);
});
test('foreign runtime, cloned preparation and replaced owner reject without changing the live ledger', () => {
  const a = fixture(), b = fixture(), request = clock(a.state);
  const prepared = preparePagedHydro(a.runtime, a.owner, a.state, request, 3.27), before = JSON.stringify(a.state);
  assert.throws(() => commitPagedHydro(a.runtime, a.owner, a.state, clone(prepared)), /clone/);
  assert.throws(() => commitPagedHydro(b.runtime, b.owner, b.state, prepared), /foreign/);
  assert.throws(() => commitPagedHydro(a.runtime, {}, a.state, prepared), /foreign/);
  assert.throws(() => offerPagedHydro(b.runtime, b.owner, a.state, request), /foreign/);
  assert.equal(JSON.stringify(a.state), before);
});
test('incremental physical windows equal the unchanged full-replay oracle across page boundaries', () => {
  const { definition, owner, runtime, state: initial } = fixture();
  let state = initial, oracle = createFiniteHydroState(definition)!;
  for (let index = 0; index < PAGED_HYDRO_PAGE_SIZE + 17; index++) {
    const request = clock(state, [1, .5, .0625, 2.25][index % 4],
      { intakeOpen: index % 7 !== 0, outfallOpen: index % 11 !== 0 });
    const acceptedKW = index % 3 === 0 ? 0 : index % 5 === 0 ? 1000 : 3.27;
    const prepared = preparePagedHydro(runtime, owner, state, request, acceptedKW);
    oracle = dispatchFiniteHydro(definition, oracle,
      { at: request.at, minutes: request.at - request.beforeAt, acceptedKW,
        intakeOpen: request.intakeOpen, outfallOpen: request.outfallOpen })!;
    assert.deepEqual(physical(prepared.window), oracle.history.at(-1));
    state = commitPagedHydro(runtime, owner, state, prepared);
    assert.equal(state.upstreamM3, oracle.upstreamM3); assert.equal(state.downstreamM3, oracle.downstreamM3);
    assert.equal(state.generatedKWh, oracle.generatedKWh); assert.equal(state.transferredM3, oracle.transferredM3);
  }
  assert.equal(state.history.pages[0][0].windows.length, PAGED_HYDRO_PAGE_SIZE);
  validatePagedHydro(definition, state, state.at, state.tick);
  assert.deepEqual([...pagedHydroWindows(state)].map(physical), oracle.history);
});
test('page append copies only the bounded current page and shares every completed immutable page', () => {
  const { owner, runtime, state: initial } = fixture(); let state = initial;
  for (let index = 0; index < PAGED_HYDRO_PAGE_SIZE; index++) state = advance(runtime, owner, state, 0);
  const full = state.history.pages[0][0], next = advance(runtime, owner, state, 0);
  assert.equal(next.history.pages[0][0], full); assert.equal(next.history.pages[0][1].windows.length, 1);
  const later = advance(runtime, owner, next, 0);
  assert.equal(later.history.pages[0][0], full);
  assert.equal(later.history.pages[0][1].windows[0], next.history.pages[0][1].windows[0]);
  assert(Object.isFrozen(full)); assert(Object.isFrozen(full.windows));
  assert(full.windows.every(Object.isFrozen));
  assert.equal(state.history.count, PAGED_HYDRO_PAGE_SIZE); assert.equal(full.windows.length, PAGED_HYDRO_PAGE_SIZE);
});
test('the thirty-third page creates one new branch while retaining the complete first branch and shallow JSON topology', () => {
  const { definition, owner, runtime, state: initial } = fixture(); let state = initial;
  for (let index = 0; index < PAGED_HYDRO_PAGE_SIZE * 32; index++) state = advance(runtime, owner, state, 0);
  const firstBranch = state.history.pages[0], next = advance(runtime, owner, state, 0);
  assert.equal(firstBranch.length, 32); assert.equal(next.history.pages.length, 2);
  assert.equal(next.history.pages[0], firstBranch); assert.equal(next.history.pages[1].length, 1);
  assert.equal(next.history.pages[1][0].firstIndex, PAGED_HYDRO_PAGE_SIZE * 32);
  assert.equal(next.history.pages[1][0].windows.length, 1);
  const restored = clone(next); validatePagedHydro(definition, restored, next.at, next.tick);
  assert.equal([...pagedHydroWindows(restored)].length, PAGED_HYDRO_PAGE_SIZE * 32 + 1);
  const malformed = clone(next); malformed.history.pages[0].pop();
  assert.throws(() => validatePagedHydro(definition, malformed, next.at, next.tick), /缺页/);
  const missing = clone(next); delete missing.history.pages[0][0];
  assert.throws(() => validatePagedHydro(definition, missing, next.at, next.tick), /缺窗/);
});
test('the constant-time hydro character estimate bounds real JSON while maximal structural count is no save-budget claim', () => {
  const { definition, owner, runtime, state: initial } = fixture(); let state = initial;
  assert(JSON.stringify(state).length <= pagedHydroJsonUpperBound(definition, 0));
  for (let index = 0; index < PAGED_HYDRO_PAGE_SIZE + 1; index++) {
    state = advance(runtime, owner, state, .123456789, .25 * 1.23456789);
    assert(JSON.stringify(state).length <= pagedHydroJsonUpperBound(definition, state.history.count));
  }
  assert(pagedHydroJsonUpperBound(definition, PAGED_HYDRO_MAX_WINDOWS) > 8_000_000);
});
test('noninteger native speeds and midnight use exact original time getter endpoints with no epsilon admission', () => {
  const definition = asset(); definition.enabledAt = 1439.95;
  const { owner, runtime, state: initial } = fixture(definition); let state = initial;
  for (let index = 0; index < 80; index++) {
    const nativeMinutes = .25 * [1.23456789, .33333333, 15.9999999][index % 3];
    const request = clock(state, nativeMinutes);
    const absolute = Math.round((state.at + nativeMinutes) * 1e8) / 1e8;
    assert.equal(request.at, Math.floor(absolute / 1440) * 1440 + ((absolute % 1440) / 60) * 60);
    assert.throws(() => preflightPagedHydro(runtime, owner, state, { ...request, at: request.at + 1e-8 }), /严格来自/);
    const prepared = preparePagedHydro(runtime, owner, state, request, 0);
    assert.equal(prepared.window.minutes, request.at - state.at);
    assert.equal(state.at + prepared.window.minutes, request.at);
    assert.equal(prepared.window.nativeMinutes, nativeMinutes);
    state = commitPagedHydro(runtime, owner, state, prepared);
  }
  assert(state.at > 1440); validatePagedHydro(definition, state, state.at, state.tick);
});
test('native four-minute windows remain legal from a fractional actual clock even at floating point boundaries', () => {
  const definition = asset(); definition.enabledAt = 480.12345679;
  const { owner, runtime, state } = fixture(definition), request = clock(state, 4);
  const prepared = preparePagedHydro(runtime, owner, state, request, 0);
  assert.equal(prepared.window.minutes, request.at - request.beforeAt);
  assert.equal(prepared.window.nativeMinutes, 4);
  const next = commitPagedHydro(runtime, owner, state, prepared);
  validatePagedHydro(definition, next, next.at, next.tick);
});
test('tick jumps, wrong starts, normalized-clock mismatches and illegal native speeds fail before mutation', () => {
  const { owner, runtime, state } = fixture(), request = clock(state), before = JSON.stringify(state);
  const changes: Partial<PagedHydroClockRequest>[] = [
    { tick: 2 }, { tick: .5 }, { beforeAt: state.at - .25 }, { at: request.at + .25 },
    { nativeMinutes: .01 }, { nativeMinutes: 4.01 }, { nativeMinutes: NaN },
  ];
  for (const change of changes) assert.throws(() => preflightPagedHydro(runtime, owner, state, { ...request, ...change }), /分页水力契约/);
  assert.equal(JSON.stringify(state), before);
});
test('cold reader does not freeze or grant authority, and successful restoration requires a new owner capability', () => {
  const { definition, owner, runtime, state: initial } = fixture();
  const state = advance(runtime, owner, initial), restored = clone(state), before = JSON.stringify(restored);
  validatePagedHydro(definition, restored, state.at, state.tick);
  assert.equal(Object.isFrozen(restored), false); assert.equal(JSON.stringify(restored), before);
  assert.throws(() => offerPagedHydro(runtime, owner, restored, clock(restored)), /clone/);
  const newOwner = {}, newRuntime = createPagedHydroRuntime(newOwner, definition, restored, restored.at, restored.tick);
  assert(Object.isFrozen(restored)); assert(Object.isFrozen(restored.history.pages[0][0].windows[0]));
  assert.throws(() => offerPagedHydro(runtime, newOwner, restored, clock(restored)), /foreign/);
  const originalNext = advance(runtime, owner, state), restoredNext = advance(newRuntime, newOwner, restored);
  assert.equal(JSON.stringify(restoredNext), JSON.stringify(originalNext));
});
test('initial resources, head, declared start tick and parameters cannot be reinterpreted by a self-reported checkpoint', () => {
  const { definition, owner, runtime, state: initial } = fixture(), state = advance(runtime, owner, initial);
  const changed = clone(definition); changed.headMeters *= 2;
  assert.throws(() => validatePagedHydro(changed, state, state.at, state.tick), /原声明/);
  const checkpoint = clone(state); checkpoint.history = { count: 0, pages: [] }; checkpoint.enabledTick = state.tick;
  assert.throws(() => validatePagedHydro(definition, checkpoint, state.at, state.tick), /真实当前tick/);
  const fakeStart = clone(state); fakeStart.enabledTick = 1;
  assert.throws(() => validatePagedHydro(definition, fakeStart, state.at, state.tick), /真实当前tick/);
  definition.maximumKW = 0;
  assert(offerPagedHydro(runtime, owner, state, clock(state)) > 0, 'runtime keeps its validated parameter snapshot');
});
test('cold replay rejects tiny resource edits, deleted prior pages, altered windows and invented cumulative generation exactly', () => {
  const { definition, owner, runtime, state: initial } = fixture(); let state = initial;
  for (let index = 0; index < PAGED_HYDRO_PAGE_SIZE + 1; index++) state = advance(runtime, owner, state, .1);
  const changes: ((state: Mutable<PagedHydroState>) => void)[] = [
    item => { item.upstreamM3 += 1e-12; }, item => { item.generatedKWh += 1e-12; },
    item => { item.transferredM3 += 1e-12; }, item => { item.history.pages[0].shift(); },
    item => { item.history.count--; }, item => { item.history.pages[0][1].firstIndex--; },
    item => { item.history.pages[0][0].windows[0].generatedKWh += 1e-12; },
    item => { item.history.pages[0][1].windows[0].tick--; },
    item => { item.history.pages[0][1].windows[0].at += 1e-8; },
    item => { item.history.pages[0][1].windows[0].beforeAt -= .25; },
    item => { item.history.pages[0][1].windows[0].nativeMinutes = 1; },
    item => { item.history.pages[0][0].windows.pop(); },
    item => { Object.assign(item.history.pages[0][1], { checkpointUpstreamM3: 100 }); },
  ];
  for (const change of changes) {
    const malformed = clone(state); change(malformed); const before = JSON.stringify(malformed);
    assert.throws(() => validatePagedHydro(definition, malformed, state.at, state.tick), /分页水力契约/);
    assert.equal(JSON.stringify(malformed), before);
  }
  assert.throws(() => validatePagedHydro(definition, state, state.at, state.tick + 1), /真实当前tick/);
  assert.throws(() => validatePagedHydro(definition, state, state.at + .25, state.tick), /真实当前tick/);
});
test('data accessors, missing windows, symbol fields and cycles are rejected without invoking supplied getters', () => {
  const { definition, owner, runtime, state: initial } = fixture(); let state = initial;
  for (let index = 0; index <= PAGED_HYDRO_PAGE_SIZE; index++) state = advance(runtime, owner, state, 0);
  let invoked = false;
  const accessor = clone(state);
  Object.defineProperty(accessor.history.pages[0][0].windows, '0', { enumerable: true,
    get() { invoked = true; return state.history.pages[0][0].windows[0]; } });
  assert.throws(() => validatePagedHydro(definition, accessor, state.at, state.tick), /完整数据窗/); assert.equal(invoked, false);
  const windowGetter = clone(state);
  Object.defineProperty(windowGetter.history.pages[0][1].windows[0], 'acceptedKW', { enumerable: true,
    get() { invoked = true; return 0; } });
  assert.throws(() => validatePagedHydro(definition, windowGetter, state.at, state.tick), /仅接受数据字段/); assert.equal(invoked, false);
  const hole = clone(state); delete hole.history.pages[0][0].windows[0];
  assert.throws(() => validatePagedHydro(definition, hole, state.at, state.tick), /缺窗/);
  const symbol = clone(state); Object.defineProperty(symbol.history.pages[0][1], Symbol('page'), { value: 1 });
  assert.throws(() => validatePagedHydro(definition, symbol, state.at, state.tick), /完整字段/);
  const cycle = clone(state); cycle.history.pages[0][1] = cycle.history.pages[0][0];
  assert.throws(() => validatePagedHydro(definition, cycle, state.at, state.tick), /循环/);
  const request = clock(state);
  Object.defineProperty(request, 'at', { enumerable: true, get() { invoked = true; return state.at + .25; } });
  assert.throws(() => offerPagedHydro(runtime, owner, state, request), /仅接受数据字段/); assert.equal(invoked, false);
});
test('production history survives beyond the independent oracle limit and JSON restoration preserves all future windows', () => {
  const { definition, owner, runtime, state: initial } = fixture(); let state = initial;
  for (let index = 0; index <= FINITE_HYDRO_MAX_HISTORY; index++) state = advance(runtime, owner, state, index < 80 ? 3.27 : 0);
  assert.equal(state.history.count, FINITE_HYDRO_MAX_HISTORY + 1);
  const windows = [...pagedHydroWindows(state)]; assert.equal(windows.length, state.history.count);
  assert.equal(windows[0].tick, 1); assert.equal(windows.at(-1)!.tick, state.tick);
  const restored = clone(state), newOwner = {};
  validatePagedHydro(definition, restored, state.at, state.tick);
  const newRuntime = createPagedHydroRuntime(newOwner, definition, restored, restored.at, restored.tick);
  let futureOriginal = state, futureRestored: PagedHydroState = restored;
  for (let index = 0; index < 12; index++) {
    const nativeMinutes = .25 * [1.23456789, 2.5, 1][index % 3], acceptedKW = index % 2 === 0 ? 0 : 3.27;
    futureOriginal = advance(runtime, owner, futureOriginal, acceptedKW, nativeMinutes);
    futureRestored = advance(newRuntime, newOwner, futureRestored, acceptedKW, nativeMinutes);
    assert.equal(JSON.stringify(futureRestored), JSON.stringify(futureOriginal));
  }
});
test('finite basin exhaustion, full downstream, closed paths and zero accepted output retain the complete stopped history', () => {
  for (const change of [(definition: FiniteHydroDefinition) => { definition.upstream.initialM3 = 0; },
    (definition: FiniteHydroDefinition) => { definition.downstream.initialM3 = definition.downstream.capacityM3; }]) {
    const definition = asset(); change(definition); const { owner, runtime, state } = fixture(definition);
    const next = advance(runtime, owner, state, 1000);
    assert.equal(next.transferredM3, 0); assert.equal(next.generatedKWh, 0); assert.equal(next.history.count, 1);
  }
  const { owner, runtime, state } = fixture();
  const closed = advance(runtime, owner, state, 1000, .25, { intakeOpen: false });
  const isolated = advance(runtime, owner, closed, 1000, .25, { outfallOpen: false });
  const unused = advance(runtime, owner, isolated, 0);
  assert.equal(unused.transferredM3, 0); assert.equal(unused.generatedKWh, 0); assert.equal(unused.history.count, 3);
});
test('unresolvable positive output and capacity preflight reject before advancing the live pointer', () => {
  const definition = asset(); definition.upstream.capacityM3 = 1e9; definition.upstream.initialM3 = 1e9;
  const large = fixture(definition), before = JSON.stringify(large.state);
  assert.throws(() => preparePagedHydro(large.runtime, large.owner, large.state, clock(large.state), 1e-20), /实际改变两端水量/);
  assert.equal(JSON.stringify(large.state), before);
  const emptyDefinition = asset(); emptyDefinition.upstream.initialM3 = 0;
  const { owner, runtime, state: initial } = fixture(emptyDefinition); let state = initial;
  for (let index = 0; index < PAGED_HYDRO_MAX_WINDOWS; index++) state = advance(runtime, owner, state, 0, .0625);
  assert.equal(state.history.count, PAGED_HYDRO_MAX_WINDOWS);
  const request = clock(state, .0625), current = state;
  assert.throws(() => preflightPagedHydro(runtime, owner, state, request), /原time推进前/);
  assert.throws(() => preparePagedHydro(runtime, owner, state, request, 0), /原time推进前/);
  assert.equal(state, current); assert.equal(state.tick, PAGED_HYDRO_MAX_WINDOWS);
  validatePagedHydro(emptyDefinition, state, state.at, state.tick);
});
