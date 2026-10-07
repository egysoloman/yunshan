/** An opt-in, pure parameter core for one explicitly declared hydro asset.
 * kWh here are SI electrical energy. Existing PowerGrid P remains its original
 * abstract unit: this file neither converts P nor installs a map/grid asset.
 * Reservoirs are finite, independent and closed to external inflow/outflow.
 * Head is the trusted asset's constant declared head, not simulated water level.
 * Network routing, shared reservoirs, refilling, costs and maintenance belong
 * to later host integration; an acceptedKW request is not proof of grid flow. */
export interface FiniteHydroReservoir { id: string; capacityM3: number; initialM3: number }
export interface FiniteHydroDefinition {
  version: 1; kind: 'finite-constant-head-hydro'; id: string; enabledAt: number;
  upstream: FiniteHydroReservoir; downstream: FiniteHydroReservoir;
  headMeters: number; efficiency: number; maximumM3PerMinute: number; maximumKW: number;
}
/** at is the end of this window. Callers must use previousAt + minutes.
 * acceptedKW is the downstream load admitted by a future routing authority;
 * an unattached/isolated machine must receive zero, never a city-wide average. */
export interface FiniteHydroRequest {
  at: number; minutes: number; acceptedKW: number; intakeOpen: boolean; outfallOpen: boolean;
}
export type FiniteHydroOfferRequest = Omit<FiniteHydroRequest, 'acceptedKW'>;
export interface FiniteHydroWindow extends FiniteHydroRequest {
  beforeUpstreamM3: number; beforeDownstreamM3: number;
  availableKW: number; suppliedKW: number; unservedKW: number;
  transferredM3: number; generatedKWh: number;
  afterUpstreamM3: number; afterDownstreamM3: number; waterBalanceResidualM3: number;
}
export interface FiniteHydroState {
  version: 1; kind: 'finite-hydro-head-ledger'; definitionKey: string; at: number;
  upstreamM3: number; downstreamM3: number; transferredM3: number; generatedKWh: number;
  history: FiniteHydroWindow[];
}
/** This review-stage ledger refuses extension at its bound; it never silently
 * removes history. Long-running integration requires a separately verified
 * checkpoint/authority contract before using it as a production save format. */
export const FINITE_HYDRO_MAX_HISTORY = 4096;
const DEFINITION_KEYS = ['version', 'kind', 'id', 'enabledAt', 'upstream', 'downstream', 'headMeters', 'efficiency', 'maximumM3PerMinute', 'maximumKW'] as const;
const REQUEST_KEYS = ['at', 'minutes', 'acceptedKW', 'intakeOpen', 'outfallOpen'] as const;
const OFFER_KEYS = ['at', 'minutes', 'intakeOpen', 'outfallOpen'] as const;
const WINDOW_KEYS = [...REQUEST_KEYS, 'beforeUpstreamM3', 'beforeDownstreamM3', 'availableKW', 'suppliedKW', 'unservedKW', 'transferredM3', 'generatedKWh', 'afterUpstreamM3', 'afterDownstreamM3', 'waterBalanceResidualM3'] as const;
const STATE_KEYS = ['version', 'kind', 'definitionKey', 'at', 'upstreamM3', 'downstreamM3', 'transferredM3', 'generatedKWh', 'history'] as const;
function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('水力参数契约：' + message);
}
/** Read JSON-shaped data only; accessor inputs cannot execute during replay. */
function dataObject(value: unknown, keys: readonly string[]): void {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), '字段结构');
  const prototype = Object.getPrototypeOf(value);
  need(prototype === Object.prototype || prototype === null, '数据对象原型');
  const own = Reflect.ownKeys(value);
  need(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)), '完整字段');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(descriptor && 'value' in descriptor && descriptor.enumerable, '仅接受数据字段');
  }
}
function quantity(value: unknown, maximum: number, minimum = 0): void {
  need(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum, '有限范围数量');
}
function identity(value: unknown): void {
  need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), '明确资产身份');
}
function historyArray(value: unknown): asserts value is FiniteHydroWindow[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= FINITE_HYDRO_MAX_HISTORY, '有界完整历史');
  need(Reflect.ownKeys(value).length === value.length + 1, '历史不能缺窗或附加字段');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    need(descriptor && 'value' in descriptor && descriptor.enumerable, '历史必须为完整数据窗');
  }
}
export function validateFiniteHydroDefinition(definition: FiniteHydroDefinition | undefined): void {
  if (definition === undefined) return;
  dataObject(definition, DEFINITION_KEYS);
  need(definition.version === 1 && definition.kind === 'finite-constant-head-hydro', '不支持的参数版本');
  identity(definition.id); quantity(definition.enabledAt, 1e7);
  for (const reservoir of [definition.upstream, definition.downstream]) {
    dataObject(reservoir, ['id', 'capacityM3', 'initialM3']); identity(reservoir.id);
    quantity(reservoir.capacityM3, 1e9); quantity(reservoir.initialM3, reservoir.capacityM3);
  }
  need(new Set([definition.id, definition.upstream.id, definition.downstream.id]).size === 3, '单机组须引用两个不同的独立水库');
  quantity(definition.headMeters, 1e4, .001); quantity(definition.efficiency, 1, .001);
  quantity(definition.maximumM3PerMinute, 1e6); quantity(definition.maximumKW, 1e9);
}
/** 1000 kg/m³ * 9.81 m/s² * head * efficiency / 3,600,000 J/kWh. */
function yieldKWhPerM3(definition: FiniteHydroDefinition): number {
  return 1000 * 9.81 * definition.headMeters * definition.efficiency / 3_600_000;
}
export function hydroKWhPerM3(definition: FiniteHydroDefinition): number {
  validateFiniteHydroDefinition(definition); return yieldKWhPerM3(definition);
}
/** Exact deterministic binding to trusted parameters, not a signature and not
 * authorization for map construction, save migration or hydraulic gate edits. */
function definitionKey(definition: FiniteHydroDefinition): string {
  return JSON.stringify([definition.version, definition.kind, definition.id, definition.enabledAt,
    [definition.upstream.id, definition.upstream.capacityM3, definition.upstream.initialM3],
    [definition.downstream.id, definition.downstream.capacityM3, definition.downstream.initialM3],
    definition.headMeters, definition.efficiency, definition.maximumM3PerMinute, definition.maximumKW]);
}
function validateRequest(request: FiniteHydroRequest): void {
  dataObject(request, REQUEST_KEYS); quantity(request.at, 1e7);
  quantity(request.minutes, 4, .000001); quantity(request.acceptedKW, 1e9);
  need(typeof request.intakeOpen === 'boolean' && typeof request.outfallOpen === 'boolean', '显式进出水开关');
}
function requestFrom(window: FiniteHydroWindow): FiniteHydroRequest {
  return { at: window.at, minutes: window.minutes, acceptedKW: window.acceptedKW, intakeOpen: window.intakeOpen, outfallOpen: window.outfallOpen };
}
function computeWindow(definition: FiniteHydroDefinition, upstreamM3: number, downstreamM3: number, request: FiniteHydroRequest): FiniteHydroWindow {
  const energyPerM3 = yieldKWhPerM3(definition);
  const transferableM3 = request.intakeOpen && request.outfallOpen ? Math.min(upstreamM3,
    definition.downstream.capacityM3 - downstreamM3,
    definition.maximumM3PerMinute * request.minutes,
    definition.maximumKW * request.minutes / 60 / energyPerM3) : 0;
  const availableKW = transferableM3 * energyPerM3 * 60 / request.minutes;
  // Only admitted output transfers water. An unused offer neither generates
  // electrical stock nor charges a battery nor consumes the upstream reservoir.
  const transferredM3 = Math.min(transferableM3, request.acceptedKW * request.minutes / 60 / energyPerM3);
  const generatedKWh = transferredM3 * energyPerM3;
  const suppliedKW = generatedKWh * 60 / request.minutes;
  const afterUpstreamM3 = Math.max(0, upstreamM3 - transferredM3);
  const afterDownstreamM3 = Math.min(definition.downstream.capacityM3, downstreamM3 + transferredM3);
  need(transferredM3 === 0 || (afterUpstreamM3 < upstreamM3 && afterDownstreamM3 > downstreamM3), '正发电必须实际改变两端水量，过小数量超出浮点分辨率');
  return { ...request, beforeUpstreamM3: upstreamM3, beforeDownstreamM3: downstreamM3,
    availableKW, suppliedKW, unservedKW: Math.max(0, request.acceptedKW - suppliedKW),
    transferredM3, generatedKWh, afterUpstreamM3, afterDownstreamM3,
    waterBalanceResidualM3: (upstreamM3 + downstreamM3) - (afterUpstreamM3 + afterDownstreamM3) };
}
export function createFiniteHydroState(definition: FiniteHydroDefinition | undefined): FiniteHydroState | undefined {
  validateFiniteHydroDefinition(definition); if (definition === undefined) return undefined;
  return { version: 1, kind: 'finite-hydro-head-ledger', definitionKey: definitionKey(definition), at: definition.enabledAt,
    upstreamM3: definition.upstream.initialM3, downstreamM3: definition.downstream.initialM3,
    transferredM3: 0, generatedKWh: 0, history: [] };
}
/** Replays every contiguous window from immutable declared initial stocks.
 * Exact deterministic numbers reject even small invented balances. JSON text
 * round trips preserve these numbers; residual tolerance is only a separate
 * floating-point conservation sanity check, never permission to edit a ledger.
 * expectedAt comes from the host's actual current clock, not from the save. */
export function validateFiniteHydroState(definition: FiniteHydroDefinition | undefined, state: FiniteHydroState | undefined, expectedAt: number): void {
  validateFiniteHydroDefinition(definition);
  if (definition === undefined) { need(state === undefined, '未声明世界不能带水力资产'); return; }
  need(state !== undefined, '已声明资产不能重置缺失账'); dataObject(state, STATE_KEYS);
  need(state.version === 1 && state.kind === 'finite-hydro-head-ledger' && state.definitionKey === definitionKey(definition), '账必须绑定原声明');
  quantity(expectedAt, 1e7); need(state.at === expectedAt, '账时刻必须等于真实当前时刻'); historyArray(state.history);
  let at = definition.enabledAt, upstreamM3 = definition.upstream.initialM3, downstreamM3 = definition.downstream.initialM3;
  let transferredM3 = 0, generatedKWh = 0;
  for (const window of state.history) {
    dataObject(window, WINDOW_KEYS); const request = requestFrom(window); validateRequest(request);
    need(request.at === at + request.minutes, '历史时间窗必须连续且向前');
    const expected = computeWindow(definition, upstreamM3, downstreamM3, request);
    for (const key of WINDOW_KEYS) need(window[key] === expected[key], '历史资源或供电账不符');
    at = request.at; upstreamM3 = expected.afterUpstreamM3; downstreamM3 = expected.afterDownstreamM3;
    transferredM3 += expected.transferredM3; generatedKWh += expected.generatedKWh;
  }
  need(state.at === at && state.upstreamM3 === upstreamM3 && state.downstreamM3 === downstreamM3 && state.transferredM3 === transferredM3 && state.generatedKWh === generatedKWh, '累计账与完整历史不符');
  const initialTotal = definition.upstream.initialM3 + definition.downstream.initialM3;
  const tolerance = Number.EPSILON * Math.max(1, initialTotal) * 64 * (state.history.length + 1);
  need(Math.abs(initialTotal - upstreamM3 - downstreamM3) <= tolerance
    && Math.abs(definition.upstream.initialM3 - upstreamM3 - transferredM3) <= tolerance
    && Math.abs(downstreamM3 - definition.downstream.initialM3 - transferredM3) <= tolerance
    && Math.abs(generatedKWh - transferredM3 * yieldKWhPerM3(definition)) <= tolerance * yieldKWhPerM3(definition), '水量与水头电量守恒');
}
/** Read-only potential for the next contiguous window. A future grid may use
 * this offer to solve actual accepted flow, then commit dispatch exactly once.
 * Querying an offer transfers no water, advances no clock and creates no stock. */
export function offerFiniteHydroKW(definition: FiniteHydroDefinition | undefined, state: FiniteHydroState | undefined, offeredWindow: FiniteHydroOfferRequest): number | undefined {
  dataObject(offeredWindow, OFFER_KEYS);
  const request: FiniteHydroRequest = { ...offeredWindow, acceptedKW: 0 }; validateRequest(request);
  if (definition === undefined) { validateFiniteHydroState(definition, state, request.at); return undefined; }
  need(state !== undefined, '已声明资产需要原账');
  dataObject(state, STATE_KEYS); validateFiniteHydroState(definition, state, state.at);
  need(request.at === state.at + request.minutes, '供电潜能必须属于下一连续时间窗');
  return computeWindow(definition, state.upstreamM3, state.downstreamM3, request).availableKW;
}
/** Returns a new parameter ledger, retaining every prior window. Repeating the
 * identical most recent request returns the same state after strict replay;
 * changed requests, earlier history, overlaps and clock jumps are rejected. */
export function dispatchFiniteHydro(definition: FiniteHydroDefinition | undefined, state: FiniteHydroState | undefined, request: FiniteHydroRequest): FiniteHydroState | undefined {
  validateRequest(request);
  if (definition === undefined) { validateFiniteHydroState(definition, state, request.at); return undefined; }
  need(state !== undefined, '已声明资产需要原账');
  dataObject(state, STATE_KEYS); validateFiniteHydroState(definition, state, state.at);
  const latest = state.history.at(-1);
  if (request.at === state.at && latest) {
    need(REQUEST_KEYS.every(key => request[key] === latest[key]), '同相位不能修改请求'); return state;
  }
  need(request.at === state.at + request.minutes, '必须逐连续时间窗结算');
  need(state.history.length < FINITE_HYDRO_MAX_HISTORY, '历史上限需要显式后续检查点，禁止截断或重置');
  const window = computeWindow(definition, state.upstreamM3, state.downstreamM3, request);
  return { version: 1, kind: state.kind, definitionKey: state.definitionKey, at: request.at,
    upstreamM3: window.afterUpstreamM3, downstreamM3: window.afterDownstreamM3,
    transferredM3: state.transferredM3 + window.transferredM3, generatedKWh: state.generatedKWh + window.generatedKWh,
    history: [...state.history, window] };
}
