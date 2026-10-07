import { validateFiniteHydroDefinition } from './power-hydro';
import type { FiniteHydroDefinition, FiniteHydroRequest, FiniteHydroWindow } from './power-hydro';

/** Production ledger pages retain every physical window. This is not a
 * checkpoint: no page may assert a starting stock or invent prior generation.
 * The independent 4096-window oracle remains byte-for-byte ROOT20 source
 * SHA256 3bdda003a29d0250f8dbdcf76a792d7689d022d05ca2b3e626a36ad92ab514a0.
 * computeWindow below preserves that source's arithmetic and field order.
 * acceptedKW is a parameter supplied by the grid's real source arc; using this
 * module alone is neither authorization nor evidence of city electricity. */
export const PAGED_HYDRO_PAGE_SIZE = 256;
/** A full ledger stops before this structural window boundary; the host save
 * budget can stop it earlier. Preflight precedes native time advancement. */
export const PAGED_HYDRO_MAX_WINDOWS = 262_144;

export interface PagedHydroClockRequest {
  tick: number; beforeAt: number; at: number; nativeMinutes: number;
  intakeOpen: boolean; outfallOpen: boolean;
}
export interface PagedHydroWindow extends FiniteHydroWindow {
  tick: number; beforeAt: number; nativeMinutes: number;
}
export const PAGED_HISTORY_BRANCH_SIZE = 32;
export interface PagedHistoryPage<T> {
  readonly firstIndex: number;
  readonly windows: readonly T[];
}
/** At most 32 branches of 32 pages, keeping native save-tree depth bounded.
 * This is an ordered complete vector, not a digest or a checkpoint. */
export interface PagedHistory<T> {
  readonly count: number;
  readonly pages: readonly (readonly PagedHistoryPage<T>[])[];
}
export interface PagedHydroState {
  readonly version: 1; readonly kind: 'finite-hydro-paged-ledger'; readonly definitionKey: string;
  readonly enabledTick: number; readonly tick: number; readonly at: number;
  readonly upstreamM3: number; readonly downstreamM3: number;
  readonly transferredM3: number; readonly generatedKWh: number;
  readonly history: PagedHistory<PagedHydroWindow>;
}
declare const runtimeBrand: unique symbol;
/** The installer keeps this identity private. Cold validation grants nothing.
 * A successful host onLoad must create a fresh capability for its new owner. */
export interface PagedHydroRuntime { readonly [runtimeBrand]: true }
export interface PreparedPagedHydro {
  readonly state: PagedHydroState; readonly window: PagedHydroWindow;
}
interface RuntimeRecord {
  readonly owner: object; readonly definition: FiniteHydroDefinition;
  current: PagedHydroState;
}
interface PreparedRecord {
  readonly runtime: PagedHydroRuntime; readonly owner: object;
  readonly previous: PagedHydroState; readonly next: PagedHydroState;
}
const runtimes = new WeakMap<PagedHydroRuntime, RuntimeRecord>();
const preparations = new WeakMap<PreparedPagedHydro, PreparedRecord>();
const CLOCK_KEYS = ['tick', 'beforeAt', 'at', 'nativeMinutes', 'intakeOpen', 'outfallOpen'] as const;
const WINDOW_KEYS = ['at', 'minutes', 'acceptedKW', 'intakeOpen', 'outfallOpen',
  'beforeUpstreamM3', 'beforeDownstreamM3', 'availableKW', 'suppliedKW', 'unservedKW',
  'transferredM3', 'generatedKWh', 'afterUpstreamM3', 'afterDownstreamM3', 'waterBalanceResidualM3',
  'tick', 'beforeAt', 'nativeMinutes'] as const;
const STATE_KEYS = ['version', 'kind', 'definitionKey', 'enabledTick', 'tick', 'at',
  'upstreamM3', 'downstreamM3', 'transferredM3', 'generatedKWh', 'history'] as const;
/** Each finite binary64 JSON number fits within this conservative 32-character
 * allowance. The window has sixteen numeric fields and two boolean fields. */
export const PAGED_HYDRO_WINDOW_MAX_JSON_CHARS = 2 + WINDOW_KEYS.length - 1
  + WINDOW_KEYS.reduce((sum, key) => sum + JSON.stringify(key).length + 1, 0)
  + (WINDOW_KEYS.length - 2) * 32 + 2 * 5;

function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('分页水力契约：' + message);
}
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
function tick(value: unknown): void {
  quantity(value, 1e10); need(Number.isSafeInteger(value), '完整实际tick');
}
function dataArray(value: unknown, maximum: number, minimum = 0): asserts value is readonly unknown[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length >= minimum && value.length <= maximum, '有界完整页');
  need(Reflect.ownKeys(value).length === value.length + 1, '页不能缺窗或附加字段');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    need(descriptor && 'value' in descriptor && descriptor.enumerable, '页必须为完整数据窗');
  }
}
function definitionKey(definition: FiniteHydroDefinition): string {
  return JSON.stringify([definition.version, definition.kind, definition.id, definition.enabledAt,
    [definition.upstream.id, definition.upstream.capacityM3, definition.upstream.initialM3],
    [definition.downstream.id, definition.downstream.capacityM3, definition.downstream.initialM3],
    definition.headMeters, definition.efficiency, definition.maximumM3PerMinute, definition.maximumKW]);
}
/** O(1) conservative ASCII JSON budget for this ledger only. A caller must
 * also budget the grid and the remaining city save; max windows does not mean
 * that every maximal ledger fits the host's unchanged 8MB resource contract. */
export function pagedHydroJsonUpperBound(definition: FiniteHydroDefinition, windowCount: number): number {
  validateFiniteHydroDefinition(definition); need(definition !== undefined, '需要明确声明');
  quantity(windowCount, PAGED_HYDRO_MAX_WINDOWS); need(Number.isSafeInteger(windowCount), '完整历史计数');
  const pageCount = Math.ceil(windowCount / PAGED_HYDRO_PAGE_SIZE);
  const branchCount = Math.ceil(pageCount / PAGED_HISTORY_BRANCH_SIZE);
  return 1024 + JSON.stringify(definitionKey(definition)).length + pageCount * 128 + branchCount * 64
    + windowCount * (PAGED_HYDRO_WINDOW_MAX_JSON_CHARS + 1);
}
function frozenDefinition(definition: FiniteHydroDefinition): FiniteHydroDefinition {
  return Object.freeze({ ...definition,
    upstream: Object.freeze({ ...definition.upstream }), downstream: Object.freeze({ ...definition.downstream }) });
}
function yieldKWhPerM3(definition: FiniteHydroDefinition): number {
  return 1000 * 9.81 * definition.headMeters * definition.efficiency / 3_600_000;
}
/** The original time() first rounds absolute minutes, splits day/hour, then
 * its now getter reconstructs the actual endpoint. Preserve all these exact
 * operations: extension.lastUpdate advances by nativeMinutes separately. */
export function pagedHydroEndAt(beforeAt: number, nativeMinutes: number): number {
  quantity(beforeAt, 1e7); quantity(nativeMinutes, 4, .0625);
  const absolute = Math.round((beforeAt + nativeMinutes) * 1e8) / 1e8;
  return Math.floor(absolute / 1440) * 1440 + ((absolute % 1440) / 60) * 60;
}
function validateClock(clock: PagedHydroClockRequest): number {
  dataObject(clock, CLOCK_KEYS); tick(clock.tick);
  quantity(clock.beforeAt, 1e7); quantity(clock.at, 1e7); quantity(clock.nativeMinutes, 4, .0625);
  need(typeof clock.intakeOpen === 'boolean' && typeof clock.outfallOpen === 'boolean', '显式进出水开关');
  need(clock.at === pagedHydroEndAt(clock.beforeAt, clock.nativeMinutes), '实际终点须严格来自原native时钟归一化');
  const minutes = clock.at - clock.beforeAt;
  need(minutes > 0 && clock.beforeAt + minutes === clock.at, '实际首尾窗必须严格连续且向前');
  return minutes;
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
function physicalWindow(definition: FiniteHydroDefinition, state: Pick<PagedHydroState, 'upstreamM3' | 'downstreamM3'>,
  clock: PagedHydroClockRequest, minutes: number, acceptedKW: number): PagedHydroWindow {
  quantity(acceptedKW, 1e9);
  return { ...computeWindow(definition, state.upstreamM3, state.downstreamM3,
    { at: clock.at, minutes, acceptedKW, intakeOpen: clock.intakeOpen, outfallOpen: clock.outfallOpen }),
    tick: clock.tick, beforeAt: clock.beforeAt, nativeMinutes: clock.nativeMinutes };
}
export function createPagedHistory<T>(): PagedHistory<T> {
  return Object.freeze({ count: 0, pages: Object.freeze([]) });
}
/** The caller supplies its privately authorized, frozen current history and
 * an already frozen new window. No cold traversal occurs in this helper. */
export function appendPagedHistory<T>(history: PagedHistory<T>, window: T): PagedHistory<T> {
  need(Object.isFrozen(history) && Object.isFrozen(history.pages), '热路径需要冻结的原账');
  need(window === null || typeof window !== 'object' || Object.isFrozen(window), '热路径需要冻结的新窗');
  need(history.count < PAGED_HYDRO_MAX_WINDOWS, '完整分页历史容量边界必须在原time推进前停止');
  const pageIndex = Math.floor(history.count / PAGED_HYDRO_PAGE_SIZE);
  const branchIndex = Math.floor(pageIndex / PAGED_HISTORY_BRANCH_SIZE), slot = pageIndex % PAGED_HISTORY_BRANCH_SIZE;
  const originalBranch = history.pages[branchIndex] ?? [], originalPage = originalBranch[slot];
  const page: PagedHistoryPage<T> = Object.freeze({ firstIndex: pageIndex * PAGED_HYDRO_PAGE_SIZE,
    windows: Object.freeze(originalPage ? [...originalPage.windows, window] : [window]) });
  const branch = [...originalBranch]; branch[slot] = page;
  const pages = [...history.pages]; pages[branchIndex] = Object.freeze(branch);
  return Object.freeze({ count: history.count + 1, pages: Object.freeze(pages) });
}
/** Structural traversal is cold-only. Every root/branch/window array is dense,
 * all earlier pages are full, and page indices derive from the complete count. */
export function validatePagedHistory<T>(history: PagedHistory<T>): void {
  dataObject(history, ['count', 'pages']); quantity(history.count, PAGED_HYDRO_MAX_WINDOWS);
  need(Number.isSafeInteger(history.count), '完整历史计数');
  const pageCount = Math.ceil(history.count / PAGED_HYDRO_PAGE_SIZE);
  dataArray(history.pages, PAGED_HISTORY_BRANCH_SIZE);
  need(history.pages.length === Math.ceil(pageCount / PAGED_HISTORY_BRANCH_SIZE), '历史缺页或分支');
  const seenPages = new Set<PagedHistoryPage<T>>(), seenBranches = new Set<readonly PagedHistoryPage<T>[]>();
  for (let branchIndex = 0; branchIndex < history.pages.length; branchIndex++) {
    const branch = history.pages[branchIndex]; dataArray(branch, PAGED_HISTORY_BRANCH_SIZE, 1);
    need(!seenBranches.has(branch), '历史重分支'); seenBranches.add(branch);
    const branchLength = Math.min(PAGED_HISTORY_BRANCH_SIZE, pageCount - branchIndex * PAGED_HISTORY_BRANCH_SIZE);
    need(branch.length === branchLength, '历史缺页或分支');
    for (let slot = 0; slot < branch.length; slot++) {
      const page = branch[slot]; dataObject(page, ['firstIndex', 'windows']);
      need(!seenPages.has(page), '历史重页或循环'); seenPages.add(page);
      const pageIndex = branchIndex * PAGED_HISTORY_BRANCH_SIZE + slot;
      const expectedLength = Math.min(PAGED_HYDRO_PAGE_SIZE, history.count - pageIndex * PAGED_HYDRO_PAGE_SIZE);
      dataArray(page.windows, PAGED_HYDRO_PAGE_SIZE, 1);
      need(page.firstIndex === pageIndex * PAGED_HYDRO_PAGE_SIZE && page.windows.length === expectedLength, '完整连续分页');
    }
  }
}
export function* pagedHistoryWindows<T>(history: PagedHistory<T>): Generator<T> {
  validatePagedHistory(history);
  for (const branch of history.pages) for (const page of branch) for (const window of page.windows) yield window;
}
/** O(1) lookup for an authorized frozen current vector. */
export function lastPagedHistoryWindow<T>(history: PagedHistory<T>): T | undefined {
  if (history.count === 0) return undefined;
  const pageIndex = Math.floor((history.count - 1) / PAGED_HYDRO_PAGE_SIZE);
  return history.pages[Math.floor(pageIndex / PAGED_HISTORY_BRANCH_SIZE)][pageIndex % PAGED_HISTORY_BRANCH_SIZE].windows.at(-1);
}
/** Full history in chronological order, for cold readers and oracle evidence.
 * Hot offer/prepare/commit never invoke this traversal. */
export function* pagedHydroWindows(state: PagedHydroState): Generator<PagedHydroWindow> {
  dataObject(state, STATE_KEYS); yield* pagedHistoryWindows(state.history);
}
export function createPagedHydro(definition: FiniteHydroDefinition, enabledTick = 0): PagedHydroState {
  validateFiniteHydroDefinition(definition); need(definition !== undefined, '需要明确声明'); tick(enabledTick);
  return Object.freeze({ version: 1, kind: 'finite-hydro-paged-ledger', definitionKey: definitionKey(definition),
    enabledTick, tick: enabledTick, at: definition.enabledAt, upstreamM3: definition.upstream.initialM3,
    downstreamM3: definition.downstream.initialM3, transferredM3: 0, generatedKWh: 0,
    history: createPagedHistory<PagedHydroWindow>() });
}
/** Every saved number is checked by exact recomputation from trusted initial
 * stocks. A conservation tolerance is only an additional sanity check; it
 * never relaxes an exact window, resource, clock or cumulative-field check. */
export function validatePagedHydro(definition: FiniteHydroDefinition, state: PagedHydroState,
  expectedAt: number, expectedTick: number, enabledTick = 0): void {
  validateFiniteHydroDefinition(definition); need(definition !== undefined, '需要明确声明');
  dataObject(state, STATE_KEYS); quantity(expectedAt, 1e7); tick(expectedTick); tick(enabledTick);
  need(state.version === 1 && state.kind === 'finite-hydro-paged-ledger'
    && state.definitionKey === definitionKey(definition), '账必须绑定原声明');
  need(state.enabledTick === enabledTick && state.tick === expectedTick && state.at === expectedAt, '账必须等于真实当前tick与时刻');
  validatePagedHistory(state.history);
  need(expectedTick - enabledTick === state.history.count, '不能删除或伪造实际tick历史');
  let at = definition.enabledAt, actualTick = enabledTick;
  let upstreamM3 = definition.upstream.initialM3, downstreamM3 = definition.downstream.initialM3;
  let transferredM3 = 0, generatedKWh = 0;
  for (const branch of state.history.pages) for (const page of branch) for (const window of page.windows) {
    dataObject(window, WINDOW_KEYS);
    const clock: PagedHydroClockRequest = { tick: window.tick, beforeAt: window.beforeAt, at: window.at,
      nativeMinutes: window.nativeMinutes, intakeOpen: window.intakeOpen, outfallOpen: window.outfallOpen };
    const minutes = validateClock(clock);
    need(clock.tick === actualTick + 1 && clock.beforeAt === at, '历史须逐实际tick严格连续');
    const expected = physicalWindow(definition, { upstreamM3, downstreamM3 }, clock, minutes, window.acceptedKW);
    for (const key of WINDOW_KEYS) need(window[key] === expected[key], '历史资源或供电账不符');
    actualTick = clock.tick; at = clock.at; upstreamM3 = expected.afterUpstreamM3; downstreamM3 = expected.afterDownstreamM3;
    transferredM3 += expected.transferredM3; generatedKWh += expected.generatedKWh;
  }
  need(state.tick === actualTick && state.at === at && state.upstreamM3 === upstreamM3 && state.downstreamM3 === downstreamM3
    && state.transferredM3 === transferredM3 && state.generatedKWh === generatedKWh, '累计账与完整历史不符');
  const initialTotal = definition.upstream.initialM3 + definition.downstream.initialM3;
  const tolerance = Number.EPSILON * Math.max(1, initialTotal) * 64 * (state.history.count + 1);
  need(Math.abs(initialTotal - upstreamM3 - downstreamM3) <= tolerance
    && Math.abs(definition.upstream.initialM3 - upstreamM3 - transferredM3) <= tolerance
    && Math.abs(downstreamM3 - definition.downstream.initialM3 - transferredM3) <= tolerance
    && Math.abs(generatedKWh - transferredM3 * yieldKWhPerM3(definition)) <= tolerance * yieldKWhPerM3(definition), '水量与水头电量守恒');
}
/** Only installation and the host's successful onLoad call this constructor.
 * Validators use validatePagedHydro and do not freeze or bind their candidates.
 * Bootstrap is O(history); each subsequent trusted operation is bounded. */
export function createPagedHydroRuntime(owner: object, definition: FiniteHydroDefinition,
  state: PagedHydroState, expectedAt: number, expectedTick: number, enabledTick = 0): PagedHydroRuntime {
  need(owner !== null && typeof owner === 'object', '需要本城state身份');
  validatePagedHydro(definition, state, expectedAt, expectedTick, enabledTick);
  for (const branch of state.history.pages) {
    for (const page of branch) {
      for (const window of page.windows) Object.freeze(window);
      Object.freeze(page.windows); Object.freeze(page);
    }
    Object.freeze(branch);
  }
  Object.freeze(state.history.pages);
  Object.freeze(state.history); Object.freeze(state);
  const runtime = Object.freeze({}) as PagedHydroRuntime;
  runtimes.set(runtime, { owner, definition: frozenDefinition(definition), current: state });
  return runtime;
}
function trustedRecord(runtime: PagedHydroRuntime, owner: object, state: PagedHydroState): RuntimeRecord {
  const record = runtimes.get(runtime);
  need(record && record.owner === owner && record.current === state && Object.isFrozen(state), '拒绝generic、clone、foreign或stale账来源');
  return record;
}
/** Host calls this with the predicted actual end clock before native time.
 * It also runs during offer/prepare, with no water debit or history traversal. */
export function preflightPagedHydro(runtime: PagedHydroRuntime, owner: object,
  state: PagedHydroState, clock: PagedHydroClockRequest): void {
  trustedRecord(runtime, owner, state); validateClock(clock);
  need(clock.tick === state.tick + 1 && clock.beforeAt === state.at, '必须逐连续实际tick结算');
  need(state.history.count < PAGED_HYDRO_MAX_WINDOWS, '完整分页历史容量边界必须在原time推进前停止');
}
export function offerPagedHydro(runtime: PagedHydroRuntime, owner: object,
  state: PagedHydroState, clock: PagedHydroClockRequest): number {
  preflightPagedHydro(runtime, owner, state, clock);
  return physicalWindow(trustedRecord(runtime, owner, state).definition, state, clock, clock.at - clock.beforeAt, 0).availableKW;
}
function appendWindow(state: PagedHydroState, window: PagedHydroWindow): PagedHydroState {
  return Object.freeze({ version: 1, kind: state.kind, definitionKey: state.definitionKey, enabledTick: state.enabledTick,
    tick: window.tick, at: window.at, upstreamM3: window.afterUpstreamM3, downstreamM3: window.afterDownstreamM3,
    transferredM3: state.transferredM3 + window.transferredM3, generatedKWh: state.generatedKWh + window.generatedKWh,
    history: appendPagedHistory(state.history, window) });
}
/** Computes a frozen candidate only. The grid must verify every source and
 * meter before committing. A prepared candidate cannot be used as live stock. */
export function preparePagedHydro(runtime: PagedHydroRuntime, owner: object, state: PagedHydroState,
  clock: PagedHydroClockRequest, acceptedKW: number): PreparedPagedHydro {
  const record = trustedRecord(runtime, owner, state); const minutes = validateClock(clock); quantity(acceptedKW, 1e9);
  const latest = lastPagedHistoryWindow(state.history);
  let next: PagedHydroState, window: PagedHydroWindow;
  if (clock.tick === state.tick && latest) {
    need(CLOCK_KEYS.every(key => clock[key] === latest[key]) && acceptedKW === latest.acceptedKW, '同相位不能修改请求');
    next = state; window = latest;
  } else {
    preflightPagedHydro(runtime, owner, state, clock);
    window = Object.freeze(physicalWindow(record.definition, state, clock, minutes, acceptedKW));
    next = appendWindow(state, window);
  }
  const prepared = Object.freeze({ state: next, window });
  preparations.set(prepared, { runtime, owner, previous: state, next }); return prepared;
}
/** All rejection checks precede the single live pointer write. The exact same
 * prepared commit is idempotent until another window advances the source. */
export function commitPagedHydro(runtime: PagedHydroRuntime, owner: object,
  previous: PagedHydroState, prepared: PreparedPagedHydro): PagedHydroState {
  const record = runtimes.get(runtime), witness = preparations.get(prepared);
  need(record && witness && record.owner === owner && witness.runtime === runtime && witness.owner === owner
    && witness.previous === previous && (record.current === previous || record.current === witness.next), '拒绝generic、clone、foreign或stale提交');
  record.current = witness.next; return witness.next;
}
