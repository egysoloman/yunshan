import assert from 'node:assert/strict';
import test from 'node:test';
import { createFiniteHydroState, dispatchFiniteHydro, FINITE_HYDRO_MAX_HISTORY, hydroKWhPerM3, offerFiniteHydroKW, validateFiniteHydroDefinition, validateFiniteHydroState } from '../src/simulation/power-hydro';
import type { FiniteHydroDefinition, FiniteHydroRequest, FiniteHydroState } from '../src/simulation/power-hydro';

function asset(): FiniteHydroDefinition {
  return { version: 1, kind: 'finite-constant-head-hydro', id: 'another-city-hydro', enabledAt: 480,
    upstream: { id: 'another-city-upper-basin', capacityM3: 10, initialM3: 2 },
    downstream: { id: 'another-city-lower-basin', capacityM3: 10, initialM3: 0 },
    headMeters: 100, efficiency: .8, maximumM3PerMinute: 1, maximumKW: 1000 };
}
function request(state: FiniteHydroState, changes: Partial<FiniteHydroRequest> = {}): FiniteHydroRequest {
  return { at: state.at + 1, minutes: 1, acceptedKW: 1000, intakeOpen: true, outfallOpen: true, ...changes };
}
const near = (actual: number, expected: number) => assert(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
function advance(definition: FiniteHydroDefinition, state: FiniteHydroState, changes: Partial<FiniteHydroRequest> = {}): FiniteHydroState {
  const parameters = request(state, changes), before = JSON.stringify({ definition, state, parameters });
  const next = dispatchFiniteHydro(definition, state, parameters)!;
  assert.equal(JSON.stringify({ definition, state, parameters }), before, 'pure dispatch leaves all input data unchanged');
  validateFiniteHydroState(definition, next, parameters.at); return next;
}

test('an undeclared world has no hydro state, water or output and rejects a transplanted ledger', () => {
  assert.equal(createFiniteHydroState(undefined), undefined);
  const parameters: FiniteHydroRequest = { at: 481, minutes: 1, acceptedKW: 1000, intakeOpen: true, outfallOpen: true };
  assert.equal(dispatchFiniteHydro(undefined, undefined, parameters), undefined);
  validateFiniteHydroState(undefined, undefined, 481);
  assert.throws(() => dispatchFiniteHydro(undefined, createFiniteHydroState(asset()), parameters), /未声明世界/);
  assert.throws(() => dispatchFiniteHydro(asset(), undefined, parameters), /需要原账/);
});
test('two consecutive real windows exhaust two finite cubic metres with SI electrical and water conservation', () => {
  const definition = asset(), initial = createFiniteHydroState(definition)!;
  near(hydroKWhPerM3(definition), .218);
  const first = advance(definition, initial); assert.equal(first.upstreamM3, 1); assert.equal(first.downstreamM3, 1);
  near(first.generatedKWh, .218); near(first.history[0].suppliedKW, 13.08); near(first.history[0].unservedKW, 986.92);
  const second = advance(definition, first); assert.equal(second.upstreamM3, 0); assert.equal(second.downstreamM3, 2);
  near(second.transferredM3, 2); near(second.generatedKWh, .436);
  const exhausted = advance(definition, second); assert.equal(exhausted.history[2].availableKW, 0); assert.equal(exhausted.history[2].generatedKWh, 0);
  assert.equal(exhausted.transferredM3, second.transferredM3); assert.equal(exhausted.downstreamM3, second.downstreamM3);
  for (const window of exhausted.history) {
    near(window.beforeUpstreamM3 + window.beforeDownstreamM3, window.afterUpstreamM3 + window.afterDownstreamM3);
    near(window.generatedKWh, window.transferredM3 * .218); near(window.generatedKWh, window.suppliedKW * window.minutes / 60);
  }
});
test('a finite downstream basin accepts only its remaining capacity then stops, retaining its original water', () => {
  const definition = asset(); definition.upstream.initialM3 = 10; definition.downstream.capacityM3 = 4; definition.downstream.initialM3 = 3; definition.maximumM3PerMinute = 10;
  const first = advance(definition, createFiniteHydroState(definition)!); assert.equal(first.downstreamM3, 4); assert.equal(first.upstreamM3, 9); near(first.generatedKWh, .218);
  const full = advance(definition, first); assert.equal(full.history[1].transferredM3, 0); assert.equal(full.history[1].suppliedKW, 0); assert.equal(full.downstreamM3, 4); assert.equal(full.upstreamM3, 9);
  near(full.upstreamM3 + full.downstreamM3, 13);
});
test('closed intake or closed downstream path transfers nothing; reopening uses only the original remaining water', () => {
  const definition = asset(), initial = createFiniteHydroState(definition)!;
  const intakeClosed = advance(definition, initial, { intakeOpen: false });
  const downstreamClosed = advance(definition, intakeClosed, { outfallOpen: false });
  for (const window of downstreamClosed.history) { assert.equal(window.availableKW, 0); assert.equal(window.transferredM3, 0); assert.equal(window.generatedKWh, 0); }
  assert.equal(downstreamClosed.upstreamM3, 2); assert.equal(downstreamClosed.downstreamM3, 0);
  const reopened = advance(definition, downstreamClosed); assert.equal(reopened.upstreamM3, 1); near(reopened.generatedKWh, .218);
});
test('unused generation potential does not consume water, create electricity or store a hidden refill', () => {
  const definition = asset(), zero = advance(definition, createFiniteHydroState(definition)!, { acceptedKW: 0 });
  near(zero.history[0].availableKW, 13.08); assert.equal(zero.history[0].suppliedKW, 0); assert.equal(zero.generatedKWh, 0);
  assert.equal(zero.upstreamM3, 2); assert.equal(zero.downstreamM3, 0); assert.equal(zero.transferredM3, 0);
  const used = advance(definition, zero); assert.equal(used.upstreamM3, 1); near(used.generatedKWh, .218);
});
test('read-only potential may be queried repeatedly before committing actual admitted output once in the same window', () => {
  const definition = asset(), initial = createFiniteHydroState(definition)!, window = { at: 481, minutes: 1, intakeOpen: true, outfallOpen: true };
  const before = JSON.stringify({ definition, initial, window });
  near(offerFiniteHydroKW(definition, initial, window)!, 13.08); near(offerFiniteHydroKW(definition, initial, window)!, 13.08);
  assert.equal(JSON.stringify({ definition, initial, window }), before); assert.equal(initial.history.length, 0);
  const next = dispatchFiniteHydro(definition, initial, { ...window, acceptedKW: 3.27 })!; near(next.transferredM3, .25); near(next.generatedKWh, .0545);
  validateFiniteHydroState(definition, next, window.at);
  assert.equal(offerFiniteHydroKW(undefined, undefined, window), undefined);
  assert.equal(offerFiniteHydroKW(definition, initial, { ...window, outfallOpen: false }), 0);
  assert.throws(() => offerFiniteHydroKW(definition, next, window), /下一连续时间窗/);
});
test('hydraulic flow, machine nameplate and actually admitted demand independently limit generated output', () => {
  const hydraulic = asset(); hydraulic.maximumM3PerMinute = .25;
  const flow = advance(hydraulic, createFiniteHydroState(hydraulic)!); near(flow.transferredM3, .25); near(flow.history[0].suppliedKW, 3.27);
  const nameplate = asset(); nameplate.maximumKW = 6.54;
  const capped = advance(nameplate, createFiniteHydroState(nameplate)!); near(capped.transferredM3, .5); near(capped.history[0].availableKW, 6.54); near(capped.history[0].suppliedKW, 6.54);
  const admitted = asset(), demand = advance(admitted, createFiniteHydroState(admitted)!, { acceptedKW: 3.27 });
  near(demand.transferredM3, .25); near(demand.generatedKWh, .0545); near(demand.history[0].availableKW, 13.08); near(demand.history[0].suppliedKW, 3.27); near(demand.history[0].unservedKW, 0);
});
test('empty upstream, zero hydraulic capacity, zero nameplate and zero downstream space remain finite stopped assets', () => {
  const changes: ((definition: FiniteHydroDefinition) => void)[] = [
    definition => { definition.upstream.initialM3 = 0; }, definition => { definition.maximumM3PerMinute = 0; },
    definition => { definition.maximumKW = 0; }, definition => { definition.downstream.capacityM3 = 0; },
  ];
  for (const change of changes) {
    const definition = asset(); change(definition); const initial = createFiniteHydroState(definition)!, next = advance(definition, initial);
    assert.equal(next.generatedKWh, 0); assert.equal(next.transferredM3, 0); assert.equal(next.upstreamM3, initial.upstreamM3); assert.equal(next.downstreamM3, initial.downstreamM3);
  }
});
test('a positive electrical debit below reservoir numerical resolution rejects instead of producing power without moving water', () => {
  const definition = asset(); definition.upstream.capacityM3 = 1e9; definition.upstream.initialM3 = 1e9;
  const initial = createFiniteHydroState(definition)!, before = JSON.stringify(initial);
  assert.throws(() => dispatchFiniteHydro(definition, initial, request(initial, { acceptedKW: 1e-20 })), /实际改变两端水量/);
  assert.equal(JSON.stringify(initial), before);
});
test('only an identical most recent window is idempotent, after the input ledger has been strictly checked', () => {
  const definition = asset(), initial = createFiniteHydroState(definition)!, parameters = request(initial);
  const current = dispatchFiniteHydro(definition, initial, parameters)!;
  assert.equal(dispatchFiniteHydro(definition, current, parameters), current);
  for (const changed of [{ ...parameters, acceptedKW: 0 }, { ...parameters, intakeOpen: false }, { ...parameters, minutes: .5 }]) {
    assert.throws(() => dispatchFiniteHydro(definition, current, changed), /同相位/);
  }
  const bad = structuredClone(current); bad.upstreamM3 += .000000000001;
  assert.throws(() => dispatchFiniteHydro(definition, bad, parameters), /累计账/);
  const later = advance(definition, current); assert.throws(() => dispatchFiniteHydro(definition, later, parameters), /连续时间窗/);
});
test('clock jumps, overlaps, rewinds and external current-clock mismatches reject rather than erase unrecorded consumption', () => {
  const definition = asset(), initial = createFiniteHydroState(definition)!, current = advance(definition, initial);
  for (const at of [current.at - 1, current.at + .5, current.at + 2, current.at + 1.000000001]) {
    const before = JSON.stringify(current); assert.throws(() => dispatchFiniteHydro(definition, current, request(current, { at })), /连续时间窗/); assert.equal(JSON.stringify(current), before);
  }
  assert.throws(() => validateFiniteHydroState(definition, current, current.at + 1), /真实当前时刻/);
  assert.throws(() => dispatchFiniteHydro(definition, initial, { ...request(initial), at: 490 }), /连续时间窗/);
});
test('invalid quantities, efficiency, head, capacity, version, duplicate reservoirs and implicit extra assets reject', () => {
  const changes: ((definition: FiniteHydroDefinition) => void)[] = [
    definition => { definition.upstream.initialM3 = -1; }, definition => { definition.downstream.initialM3 = 11; },
    definition => { definition.headMeters = 0; }, definition => { definition.headMeters = NaN; },
    definition => { definition.efficiency = 1.01; }, definition => { definition.efficiency = 0; },
    definition => { definition.maximumKW = Infinity; }, definition => { definition.maximumM3PerMinute = -1; },
    definition => { definition.enabledAt = -1; }, definition => { definition.downstream.id = definition.upstream.id; },
    definition => { definition.id = 'constructor'; }, definition => { Object.assign(definition, { fuel: 1000 }); },
    definition => { Object.assign(definition, { version: 2 }); },
  ];
  for (const change of changes) { const definition = asset(); change(definition); assert.throws(() => validateFiniteHydroDefinition(definition), /水力参数契约/); }
  const definition = asset(), state = createFiniteHydroState(definition)!;
  for (const changed of [{ minutes: 0 }, { minutes: 4.01 }, { minutes: NaN }, { acceptedKW: Infinity }, { acceptedKW: -1 }, { at: Infinity }]) {
    assert.throws(() => dispatchFiniteHydro(definition, state, request(state, changed)), /水力参数契约/);
  }
});
test('strict history replay rejects added water, invented electricity, deleted history and altered physical windows without editing input', () => {
  const definition = asset(), first = advance(definition, createFiniteHydroState(definition)!), current = advance(definition, first, { acceptedKW: 3.27 });
  const changes: ((state: FiniteHydroState) => void)[] = [
    state => { state.upstreamM3++; }, state => { state.downstreamM3--; }, state => { state.generatedKWh++; },
    state => { state.transferredM3 = 0; }, state => { state.history.shift(); }, state => { state.history = []; },
    state => { state.history[0].generatedKWh++; }, state => { state.history[0].transferredM3 = 0; },
    state => { state.history[0].outfallOpen = false; }, state => { state.history[0].afterDownstreamM3++; },
    state => { state.history[1].at++; }, state => { state.definitionKey += 'changed'; },
    state => { Object.assign(state, { refillM3: 100 }); },
  ];
  for (const change of changes) {
    const malformed = structuredClone(current); change(malformed); const before = JSON.stringify(malformed);
    assert.throws(() => validateFiniteHydroState(definition, malformed, current.at), /水力参数契约/); assert.equal(JSON.stringify(malformed), before);
  }
});
test('a changed trusted definition cannot reset or reinterpret an existing resource ledger even on an idempotent request', () => {
  const definition = asset(), initial = createFiniteHydroState(definition)!, parameters = request(initial), current = dispatchFiniteHydro(definition, initial, parameters)!;
  const changes: ((definition: FiniteHydroDefinition) => void)[] = [
    item => { item.id = 'different-city-machine'; }, item => { item.headMeters = 200; }, item => { item.efficiency = .9; },
    item => { item.maximumM3PerMinute = 2; }, item => { item.upstream.initialM3 = 3; }, item => { item.downstream.capacityM3 = 20; },
    item => { item.enabledAt = 481; },
  ];
  for (const change of changes) { const changed = structuredClone(definition); change(changed); assert.throws(() => dispatchFiniteHydro(changed, current, parameters), /绑定原声明/); }
});
test('core JSON round trip preserves full history and each subsequent result exactly under finite resource exhaustion', () => {
  const definition = asset(); definition.upstream.initialM3 = 5;
  let original = advance(definition, createFiniteHydroState(definition)!, { acceptedKW: 3.27 });
  let restored = JSON.parse(JSON.stringify(original)) as FiniteHydroState; validateFiniteHydroState(definition, restored, original.at);
  for (let index = 0; index < 12; index++) {
    const changes = { acceptedKW: index % 3 === 0 ? 0 : 1000, outfallOpen: index % 4 !== 0 };
    original = advance(definition, original, changes); restored = advance(definition, restored, changes);
    assert.deepEqual(restored, original); assert.equal(JSON.stringify(restored), JSON.stringify(original));
  }
  assert.equal(original.history.length, 13); assert.equal(original.upstreamM3, 0); near(original.generatedKWh, definition.upstream.initialM3 * hydroKWhPerM3(definition));
});
test('the same hydraulic parameters work with unrelated city IDs while resource ledgers cannot migrate across declarations', () => {
  const first = asset(), second = asset(); second.id = 'coast-hydro'; second.upstream.id = 'coast-upper'; second.downstream.id = 'coast-lower';
  const a = advance(first, createFiniteHydroState(first)!), b = advance(second, createFiniteHydroState(second)!);
  assert.equal(a.generatedKWh, b.generatedKWh); assert.equal(a.upstreamM3, b.upstreamM3); assert.notEqual(a.definitionKey, b.definitionKey);
  assert.throws(() => validateFiniteHydroState(second, a, a.at), /绑定原声明/);
});
test('bounded complete data history rejects excess, holes and accessors before running supplied code or truncating old windows', () => {
  const definition = asset(), current = advance(definition, createFiniteHydroState(definition)!);
  const oversized = structuredClone(current); oversized.history = Array.from({ length: FINITE_HYDRO_MAX_HISTORY + 1 }, () => structuredClone(current.history[0]));
  assert.throws(() => validateFiniteHydroState(definition, oversized, current.at), /有界完整历史/);
  const missing = structuredClone(current); delete missing.history[0]; assert.throws(() => validateFiniteHydroState(definition, missing, current.at), /历史不能缺窗/);
  let invoked = false;
  const accessor = structuredClone(current); Object.defineProperty(accessor.history, '0', { enumerable: true, get() { invoked = true; return current.history[0]; } });
  assert.throws(() => validateFiniteHydroState(definition, accessor, current.at), /历史必须为完整数据窗/); assert.equal(invoked, false);
  const getterDefinition = asset(); Object.defineProperty(getterDefinition, 'headMeters', { enumerable: true, get() { invoked = true; return 100; } });
  assert.throws(() => validateFiniteHydroDefinition(getterDefinition), /仅接受数据字段/); assert.equal(invoked, false);
  const getterState = structuredClone(current); Object.defineProperty(getterState, 'at', { enumerable: true, get() { invoked = true; return current.at; } });
  assert.throws(() => dispatchFiniteHydro(definition, getterState, request(current)), /仅接受数据字段/); assert.equal(invoked, false);
  const getterRequest = request(current); Object.defineProperty(getterRequest, 'at', { enumerable: true, get() { invoked = true; return current.at + 1; } });
  assert.throws(() => dispatchFiniteHydro(undefined, undefined, getterRequest), /仅接受数据字段/); assert.equal(invoked, false);
});
