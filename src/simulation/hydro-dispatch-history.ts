import type { HydroPowerGridDispatch, HydroGridSourceMeter } from './power-grid-hydro';
import { appendPagedHistory, lastPagedHistoryWindow, pagedHistoryWindows, validatePagedHistory,
  PAGED_HYDRO_MAX_WINDOWS, PAGED_HYDRO_PAGE_SIZE, PAGED_HISTORY_BRANCH_SIZE,
  type PagedHistory, type PagedHydroWindow } from './power-hydro-runtime';

/** Lossless storage only. Water windows and the current full dispatch stay intact;
 * this module grants no live owner, water, labor or restoration capability. */
export interface SharedHydroSnapshot {
  availableKW: number; demandKW: number; servedKW: number; unservedKW: number; curtailedKW: number;
  sources: Record<string, Pick<HydroGridSourceMeter, 'availableKW' | 'suppliedKW'>>;
  links: HydroPowerGridDispatch['links']; nodes: HydroPowerGridDispatch['nodes'];
  buildings: HydroPowerGridDispatch['buildings']; vehicles: HydroPowerGridDispatch['vehicles'];
  loadSources: HydroPowerGridDispatch['loadSources']; diagnostics: HydroPowerGridDispatch['diagnostics'];
}
/** Dispatch generation uses servedKW * minutes / 60. Preserve its original
 * binary64 value rather than substituting hydraulic transferredM3 * yield. */
export interface SharedHydroReference { snapshotIndex: number; generatedKWh: number }
export interface SharedHydroHistoryBody {
  snapshots: PagedHistory<SharedHydroSnapshot>;
  history: PagedHistory<SharedHydroReference>;
  hydro: { history: PagedHistory<PagedHydroWindow> };
}
const SNAPSHOT_KEYS = ['availableKW', 'demandKW', 'servedKW', 'unservedKW', 'curtailedKW', 'sources', 'links', 'nodes', 'buildings', 'vehicles', 'loadSources', 'diagnostics'] as const;
const CLOCK_KEYS = ['tick', 'beforeAt', 'at', 'nativeMinutes', 'minutes'] as const;
const DISPATCH_KEYS = [...CLOCK_KEYS, ...SNAPSHOT_KEYS] as const;
const DIAGNOSTIC_KEYS = ['unconnectedBuildings', 'unconnectedVehicles', 'islandNodeIds', 'exhaustedSourceIds', 'constrainedLinkIds', 'constrainedNodeIds'] as const;
const WATER_KEYS = ['at', 'minutes', 'acceptedKW', 'intakeOpen', 'outfallOpen', 'beforeUpstreamM3', 'beforeDownstreamM3', 'availableKW', 'suppliedKW', 'unservedKW', 'transferredM3', 'generatedKWh', 'afterUpstreamM3', 'afterDownstreamM3', 'waterBalanceResidualM3', 'tick', 'beforeAt', 'nativeMinutes'] as const;
function need(value: unknown, message: string): asserts value { if (!value) throw new Error('共享水电分表契约：' + message); }
function object(value: unknown, keys?: readonly string[]): asserts value is Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), '数据对象');
  const prototype = Object.getPrototypeOf(value); need(prototype === null || prototype === Object.prototype, '数据原型');
  const own = Reflect.ownKeys(value);
  need(own.length <= 2_000_000, '单窗数据项资源边界');
  need(own.every(key => typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)), '数据键');
  if (keys) need(own.length === keys.length && own.every(key => keys.includes(key as string)), '完整字段');
  for (const key of own) { const descriptor = Object.getOwnPropertyDescriptor(value, key); need(descriptor && 'value' in descriptor && descriptor.enumerable, '只接受自身数据字段'); }
  // A mutated shared prototype must not supply a callable serializer.
  if (prototype) need(!Object.getOwnPropertyDescriptor(prototype, 'toJSON'), '原型不能提供序列化钩子');
}
function array(value: unknown): asserts value is unknown[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, '完整数组');
  need(value.length <= 2_000_000, '单窗数组资源边界');
  need(!Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON'), '数组原型不能提供序列化钩子');
  need(Reflect.ownKeys(value).length === value.length + 1, '数组缺项或附加字段');
  for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); need(descriptor && 'value' in descriptor && descriptor.enumerable, '数组只接受自身数据项'); }
}
function number(value: unknown): asserts value is number { need(typeof value === 'number' && Number.isFinite(value), '有限数字'); }
function identity(value: unknown): asserts value is string { need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value), '具名身份'); }
/** Validate descriptors before reading values or calling JSON.stringify. The
 * traversal covers one record; append never inspects historical pages. */
function dataTree(value: unknown, active = new Set<object>(), depth = 0, budget = { visited: 0 }): void {
  need(++budget.visited <= 2_000_000, '单窗数据遍历资源边界');
  need(depth <= 12, '单窗结构深度');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { number(value); return; }
  need(typeof value === 'object' && value !== null, '仅接受可序列化数据');
  need(!active.has(value), '数据循环'); active.add(value);
  if (Array.isArray(value)) array(value); else object(value);
  for (const key of Object.keys(value)) dataTree(Object.getOwnPropertyDescriptor(value, key)!.value, active, depth + 1, budget);
  active.delete(value);
}
/** Compare complete values independently of object insertion order. Raw
 * descriptors have already been validated; array order remains authoritative. */
function comparisonJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(comparisonJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + comparisonJSON(Object.getOwnPropertyDescriptor(value, key)!.value)).join(',') + '}';
}
function meters(value: unknown, vehicle: boolean): void {
  object(value);
  for (const [id, meter] of Object.entries(value)) {
    identity(id); object(meter, vehicle ? ['nodeId', 'demandKW', 'servedKW', 'unservedKW', 'edgeId'] : ['nodeId', 'demandKW', 'servedKW', 'unservedKW']);
    if (meter.nodeId !== null) identity(meter.nodeId);
    for (const key of ['demandKW', 'servedKW', 'unservedKW']) number(meter[key]);
    if (vehicle) identity(meter.edgeId);
  }
}
function validateSnapshot(value: SharedHydroSnapshot, fullSource = false): string {
  dataTree(value); object(value, SNAPSHOT_KEYS);
  for (const key of SNAPSHOT_KEYS.slice(0, 5)) number(value[key as keyof SharedHydroSnapshot]);
  object(value.sources); const sourceIds = Object.keys(value.sources); need(sourceIds.length === 1, '单独具名机组'); identity(sourceIds[0]);
  const source = value.sources[sourceIds[0]];
  object(source, fullSource ? ['availableKW', 'suppliedKW', 'transferredM3', 'generatedKWh'] : ['availableKW', 'suppliedKW']);
  for (const field of Object.values(source)) number(field);
  for (const rows of [value.links, value.nodes]) { object(rows); for (const [id, field] of Object.entries(rows)) { identity(id); number(field); } }
  meters(value.buildings, false); meters(value.vehicles, true);
  object(value.loadSources);
  const equipment = Object.hasOwn(value.loadSources, 'equipmentAvailable');
  object(value.loadSources, equipment ? ['shops', 'equipmentAvailable'] : ['shops']);
  if (equipment) need(typeof value.loadSources.equipmentAvailable === 'boolean', '设备可用性数据');
  array(value.loadSources.shops);
  for (const shop of value.loadSources.shops) { object(shop, ['id', 'buildingId', 'allowsOperation']); identity(shop.id); identity(shop.buildingId); need(typeof shop.allowsOperation === 'boolean', '商店许可数据'); }
  object(value.diagnostics, DIAGNOSTIC_KEYS);
  for (const rows of Object.values(value.diagnostics)) { array(rows); for (const id of rows) identity(id); }
  return sourceIds[0];
}
function freezeTree<T>(value: T, seen = new Set<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value); for (const child of Object.values(value)) freezeTree(child, seen); Object.freeze(value);
  }
  return value;
}
function validateReference(reference: SharedHydroReference): void {
  object(reference, ['snapshotIndex', 'generatedKWh']);
  need(Number.isSafeInteger(reference.snapshotIndex) && reference.snapshotIndex >= 0 && reference.snapshotIndex < PAGED_HYDRO_MAX_WINDOWS, '完整快照索引'); number(reference.generatedKWh);
}
function at<T>(history: PagedHistory<T>, index: number): T {
  const pageIndex = Math.floor(index / PAGED_HYDRO_PAGE_SIZE);
  return history.pages[Math.floor(pageIndex / PAGED_HISTORY_BRANCH_SIZE)][pageIndex % PAGED_HISTORY_BRANCH_SIZE].windows[index % PAGED_HYDRO_PAGE_SIZE];
}

export function makeHydroSnapshot(window: HydroPowerGridDispatch): SharedHydroSnapshot {
  dataTree(window); object(window, DISPATCH_KEYS); for (const key of CLOCK_KEYS) number(window[key]);
  // Only the source meter differs structurally from a twelve-field snapshot.
  const candidate: SharedHydroSnapshot = { availableKW: window.availableKW, demandKW: window.demandKW, servedKW: window.servedKW, unservedKW: window.unservedKW, curtailedKW: window.curtailedKW, sources: window.sources, links: window.links, nodes: window.nodes, buildings: window.buildings, vehicles: window.vehicles, loadSources: window.loadSources, diagnostics: window.diagnostics };
  const sourceId = validateSnapshot(candidate, true), source = window.sources[sourceId];
  candidate.sources = Object.assign(Object.create(null) as SharedHydroSnapshot['sources'], { [sourceId]: { availableKW: source.availableKW, suppliedKW: source.suppliedKW } });
  return freezeTree(candidate);
}

/** Copy the five already persisted water clocks without recomputation. This
 * property order matches the original seventeen-field dispatch writer. */
export function expandHydroDispatch(snapshot: SharedHydroSnapshot, reference: SharedHydroReference, water: PagedHydroWindow, sourceId: string): HydroPowerGridDispatch {
  need(validateSnapshot(snapshot) === sourceId, '快照机组绑定'); validateReference(reference);
  dataTree(water); object(water, WATER_KEYS);
  for (const key of CLOCK_KEYS) number(water[key]); number(water.transferredM3);
  const source = snapshot.sources[sourceId], sources = Object.create(null) as HydroPowerGridDispatch['sources'];
  sources[sourceId] = { availableKW: source.availableKW, suppliedKW: source.suppliedKW, transferredM3: water.transferredM3, generatedKWh: reference.generatedKWh };
  return { tick: water.tick, beforeAt: water.beforeAt, at: water.at, nativeMinutes: water.nativeMinutes, minutes: water.minutes,
    availableKW: snapshot.availableKW, demandKW: snapshot.demandKW, servedKW: snapshot.servedKW, unservedKW: snapshot.unservedKW, curtailedKW: snapshot.curtailedKW,
    sources, links: snapshot.links, nodes: snapshot.nodes, buildings: snapshot.buildings, vehicles: snapshot.vehicles, loadSources: snapshot.loadSources, diagnostics: snapshot.diagnostics };
}

/** Adjacent-only reuse: O(current graph) and O(1) page lookup, with no scan of
 * earlier snapshots or references. Caller owns live authorization and budget. */
export function appendSharedHydroDispatch(snapshots: PagedHistory<SharedHydroSnapshot>, history: PagedHistory<SharedHydroReference>, window: HydroPowerGridDispatch): {
  snapshots: PagedHistory<SharedHydroSnapshot>; history: PagedHistory<SharedHydroReference>;
  currentJSONKey: string; snapshotAdded: boolean; snapshot: SharedHydroSnapshot; reference: SharedHydroReference;
} {
  object(snapshots, ['count', 'pages']); object(history, ['count', 'pages']);
  need(Object.isFrozen(snapshots) && Object.isFrozen(snapshots.pages) && Object.isFrozen(history) && Object.isFrozen(history.pages), '热路径需要冻结的原双账');
  need(snapshots.count <= history.count && (history.count === 0) === (snapshots.count === 0), '双账初始关系');
  const candidate = makeHydroSnapshot(window), currentJSONKey = comparisonJSON(candidate), previous = lastPagedHistoryWindow(snapshots);
  let snapshot = candidate, snapshotAdded = true;
  if (previous !== undefined) { validateSnapshot(previous); if (comparisonJSON(previous) === currentJSONKey) { snapshot = previous; snapshotAdded = false; } }
  const nextSnapshots = snapshotAdded ? appendPagedHistory(snapshots, snapshot) : snapshots;
  const sourceId = Object.keys(window.sources)[0], reference = Object.freeze({ snapshotIndex: nextSnapshots.count - 1, generatedKWh: window.sources[sourceId].generatedKWh });
  validateReference(reference);
  return { snapshots: nextSnapshots, history: appendPagedHistory(history, reference), currentJSONKey, snapshotAdded, snapshot, reference };
}

/** Cold-only canonical enumeration. The enclosing grid reader still replays
 * all water physics and Flow and checks complete world-specific identities. */
export function* readSharedHydroDispatches(body: SharedHydroHistoryBody, sourceId?: string): Generator<HydroPowerGridDispatch> {
  if (sourceId !== undefined) identity(sourceId); object(body);
  for (const key of ['snapshots', 'history', 'hydro']) { const descriptor = Object.getOwnPropertyDescriptor(body, key); need(descriptor && 'value' in descriptor && descriptor.enumerable, '自身共享账字段'); }
  object(body.hydro); const waterDescriptor = Object.getOwnPropertyDescriptor(body.hydro, 'history'); need(waterDescriptor && 'value' in waterDescriptor && waterDescriptor.enumerable, '自身水账字段');
  validatePagedHistory(body.snapshots); validatePagedHistory(body.history); validatePagedHistory(body.hydro.history);
  need(body.history.count === body.hydro.history.count && body.snapshots.count <= body.history.count && (body.snapshots.count === 0) === (body.history.count === 0), '完整双账数量');
  let previousSnapshotJSON: string | null = null;
  for (const snapshot of pagedHistoryWindows(body.snapshots)) {
    const snapshotSourceId = validateSnapshot(snapshot);
    if (sourceId === undefined) sourceId = snapshotSourceId;
    need(snapshotSourceId === sourceId, '全快照机组绑定'); const serialized = comparisonJSON(snapshot);
    need(serialized !== previousSnapshotJSON, '相邻重复快照必须复用'); previousSnapshotJSON = serialized;
  }
  const water = pagedHistoryWindows(body.hydro.history)[Symbol.iterator](); let previousIndex = -1;
  for (const reference of pagedHistoryWindows(body.history)) {
    validateReference(reference);
    need(reference.snapshotIndex < body.snapshots.count && (previousIndex === -1 ? reference.snapshotIndex === 0 : reference.snapshotIndex === previousIndex || reference.snapshotIndex === previousIndex + 1), '连续单调完整索引');
    const result = water.next(); need(!result.done, '同窗真实水账');
    need(sourceId !== undefined, '非空账必须有原快照机组');
    yield expandHydroDispatch(at(body.snapshots, reference.snapshotIndex), reference, result.value, sourceId);
    previousIndex = reference.snapshotIndex;
  }
  need(water.next().done && previousIndex + 1 === body.snapshots.count, '不能有未引用快照或遗漏水账');
}

/** Exact JSON character delta for one append, including count digits, commas,
 * page firstIndex digits and new branch brackets. No full-history stringify. */
export function pagedHistoryAppendCharDelta<T>(history: PagedHistory<T>, row: T): number {
  object(history, ['count', 'pages']);
  need(Number.isSafeInteger(history.count) && history.count >= 0 && history.count < PAGED_HYDRO_MAX_WINDOWS, '分页追加容量');
  dataTree(row); const rowChars = JSON.stringify(row).length, count = history.count;
  let delta = rowChars + String(count + 1).length - String(count).length;
  if (count % PAGED_HYDRO_PAGE_SIZE !== 0) return delta + 1;
  // A fresh page is {"firstIndex":n,"windows":[row]}.
  delta += '{"firstIndex":,"windows":[]}'.length + String(count).length;
  if (count % (PAGED_HYDRO_PAGE_SIZE * PAGED_HISTORY_BRANCH_SIZE) === 0) delta += 2 + (count > 0 ? 1 : 0);
  else delta += 1;
  return delta;
}
