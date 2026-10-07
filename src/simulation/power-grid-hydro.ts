import type { SimState, Vec3, WorldDefinition } from '../types';
import { shopLifecycleAllowsOperation } from './shop_lifecycle';
import { Flow, type Arc } from './power-network-flow';
import { validateFiniteHydroDefinition, type FiniteHydroDefinition } from './power-hydro';
import {
  createPagedHydro, createPagedHydroRuntime, validatePagedHydro, pagedHydroWindows,
  offerPagedHydro, preparePagedHydro, commitPagedHydro, preflightPagedHydro,
  PAGED_HYDRO_MAX_WINDOWS, pagedHydroEndAt,
  createPagedHistory, appendPagedHistory, pagedHistoryWindows,
  type PagedHistory,
  type PagedHydroState, type PagedHydroRuntime, type PagedHydroClockRequest,
} from './power-hydro-runtime';

/** An explicitly supplied second network contract. The original network's P
 * and P-minutes retain their abstract units; this contract never converts them.
 * One closed, finite two-reservoir machine feeds actual capacitated loads.
 * There is no battery, refill, fallback generator, purchase or hidden charge. */
export interface HydroGridNode { id: string; kind: 'junction' | 'substation'; position: Vec3; capacityKW: number }
export interface HydroGridLink { id: string; from: string; to: string; capacityKW: number; closed: boolean; points: Vec3[] }
export interface HydroGridWaterPort { reservoirId: string; position: Vec3; open: boolean }
export interface HydroGridSource {
  id: string; buildingId: string; nodeId: string;
  intake: HydroGridWaterPort; outfall: HydroGridWaterPort; penstockPoints: Vec3[];
  hydro: FiniteHydroDefinition;
}
export interface HydroGridBuildingLoad { buildingId: string; nodeId: string | null; baseKW: number; nightKW: number; shopKW: number }
export interface HydroGridTransportConnection { edgeId: string; nodeId: string | null; vehicleKW: .08 }
export interface HydroPowerGridDefinition {
  version: 2; kind: 'finite-hydro-network'; unit: 'kW-kWh-v1';
  nodes: HydroGridNode[]; links: HydroGridLink[]; sources: HydroGridSource[];
  buildings: HydroGridBuildingLoad[]; transport: HydroGridTransportConnection[];
}
export interface HydroGridMeter { nodeId: string | null; demandKW: number; servedKW: number; unservedKW: number }
export interface HydroGridVehicleMeter extends HydroGridMeter { edgeId: string }
export interface HydroGridSourceMeter { availableKW: number; suppliedKW: number; transferredM3: number; generatedKWh: number }
export interface HydroShopLoadSource { id: string; buildingId: string; allowsOperation: boolean }
export interface HydroPowerGridDispatch {
  tick: number; beforeAt: number; at: number; nativeMinutes: number; minutes: number;
  availableKW: number; demandKW: number; servedKW: number; unservedKW: number; curtailedKW: number;
  sources: Record<string, HydroGridSourceMeter>; links: Record<string, number>; nodes: Record<string, number>;
  buildings: Record<string, HydroGridMeter>; vehicles: Record<string, HydroGridVehicleMeter>;
  loadSources: { shops: HydroShopLoadSource[] };
  diagnostics: { unconnectedBuildings: string[]; unconnectedVehicles: string[]; islandNodeIds: string[]; exhaustedSourceIds: string[]; constrainedLinkIds: string[]; constrainedNodeIds: string[] };
}
export type HydroGridHistory = PagedHistory<HydroPowerGridDispatch>;
export interface HydroPowerGridState {
  version: 2; kind: 'finite-hydro-network'; unit: 'kW-kWh-v1';
  hydro: PagedHydroState; dispatch: HydroPowerGridDispatch | null;
  totals: { demandedKWh: number; servedKWh: number; unservedKWh: number };
  history: HydroGridHistory;
}

const EPS = 1e-8;
const DISPATCH_KEYS = ['tick', 'beforeAt', 'at', 'nativeMinutes', 'minutes', 'availableKW', 'demandKW', 'servedKW', 'unservedKW', 'curtailedKW', 'sources', 'links', 'nodes', 'buildings', 'vehicles', 'loadSources', 'diagnostics'] as const;
/** This ledger's conservative character envelope reserves half the unchanged
 * native 8M save budget for all other simulation modules. It is a bounded E1
 * contract, not a promise that other modules cannot fill their own save space. */
export const HYDRO_GRID_LEDGER_CHAR_BUDGET = 4_000_000;
const caps = new WeakMap<HydroPowerGridState, GridCapability>();
// Only this traversal can certify descendants. Object.isFrozen certifies the
// outer object alone; callers can supply an unfamiliar shallow-frozen object.
const deeplyFrozen = new WeakSet<object>();
interface GridCapability { world: WorldDefinition; definition: HydroPowerGridDefinition; physicalKey: string; loadIdentityKey: string | null; owner: SimState | null; runtime: PagedHydroRuntime | null; pending: PagedHydroClockRequest | null }
const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const sorted = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
function need(condition: unknown, message: string): asserts condition { if (!condition) throw new Error('水力电网契约：' + message); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function quantity(value: unknown, max = 1e9, min = 0): asserts value is number { need(finite(value) && value >= min && value <= max, '有限范围数量'); }
function identity(value: unknown): asserts value is string { need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), '实体标识'); }
function dataObject(value: unknown, keys: readonly string[]): void {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), '字段结构');
  need(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, '数据对象原型');
  const own = Reflect.ownKeys(value); need(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)), '完整数据字段');
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); need(descriptor && 'value' in descriptor && descriptor.enumerable, '只接受数据字段'); }
}
function dataArray<T>(value: unknown, maximum: number): asserts value is T[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= maximum, '有界完整数组');
  need(Reflect.ownKeys(value).length === value.length + 1, '数组不能缺项或附加字段');
  for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); need(descriptor && 'value' in descriptor && descriptor.enumerable, '数组只接受完整数据项'); }
}
function point(value: Vec3): void { dataObject(value, ['x', 'y', 'z']); for (const part of Object.values(value)) need(finite(part) && Math.abs(part) <= 1e7, '真实空间点'); }
function samePoint(a: Vec3, b: Vec3): boolean { return a.x === b.x && a.y === b.y && a.z === b.z; }
function near(a: number, b: number): void { need(Math.abs(a - b) <= 1e-7 + Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 128, '水电与输配守恒'); }
function freeze<T>(value: T): T {
  const pending: unknown[] = [value], seen = new Set<object>();
  while (pending.length) { const item = pending.pop(); if (item !== null && typeof item === 'object' && !deeplyFrozen.has(item) && !seen.has(item)) { seen.add(item); pending.push(...Object.values(item)); Object.freeze(item); } }
  for (const item of seen) deeplyFrozen.add(item);
  return value;
}
function definition(world: WorldDefinition): HydroPowerGridDefinition | undefined {
  const grid = world.powerGrid; return grid?.kind === 'finite-hydro-network' ? grid as HydroPowerGridDefinition : undefined;
}
function bodyOf(state: SimState): HydroPowerGridState | undefined { return state.powerGrid?.kind === 'finite-hydro-network' ? state.powerGrid as HydroPowerGridState : undefined; }
/** The time phase's actual canonical clock, including its rounding. The older
 * extension clock deliberately retains its independent native-minute sum. */
export function hydroGridClock(state: SimState): number { return state.day * 1440 + state.hour * 60; }
function physicalKey(world: WorldDefinition): string {
  return JSON.stringify([world.buildings.map(site => [site.id, site.kind, site.facility ?? null, site.position, site.door, site.width, site.depth, site.height, site.floors, site.rotation]), world.nodes.map(node => [node.id, node.position]), world.edges.map(edge => [edge.id, edge.from, edge.to, edge.points])]);
}
function loadIdentityKey(state: SimState): string { return JSON.stringify([sorted(state.shops).map(shop => [shop.id, shop.buildingId]), sorted(state.vehicles).map(vehicle => vehicle.id)]); }
function historyWindowCharBound(world: WorldDefinition, state: SimState): number {
  // All identities are at most 120 ASCII characters. Each numeric JSON scalar
  // is bounded by 32 characters; the fixed envelopes include field names,
  // water window, both dispatch copies, diagnostics and shallow page indices.
  return 8192 + world.buildings.length * 1024 + state.vehicles.length * 1536 + state.shops.length * 1024 + definition(world)!.nodes.length * 512 + definition(world)!.links.length * 512;
}
function checkHistoryBudget(world: WorldDefinition, state: SimState, count: number): void {
  need(count * historyWindowCharBound(world, state) <= HYDRO_GRID_LEDGER_CHAR_BUDGET, '完整双账达到本域保守原生保存预算，须在原time推进前停止');
}
export function validateHydroGridDefinition(world: WorldDefinition): void {
  const grid = definition(world); if (!grid) { need(world.powerGrid === undefined || world.powerGrid.version === 1, '不支持的水力网络'); return; }
  dataObject(grid, ['version', 'kind', 'unit', 'nodes', 'links', 'sources', 'buildings', 'transport']);
  need(grid.version === 2 && grid.kind === 'finite-hydro-network' && grid.unit === 'kW-kWh-v1', '明确第二版水力单位');
  dataArray<HydroGridNode>(grid.nodes, 1024); dataArray<HydroGridLink>(grid.links, 4096); dataArray<HydroGridSource>(grid.sources, 1); need(grid.sources.length === 1, '本版只允许一台独立双库机组');
  const nodeIds = new Set<string>(), linkIds = new Set<string>();
  for (const node of grid.nodes) { dataObject(node, ['id', 'kind', 'position', 'capacityKW']); identity(node.id); need(!nodeIds.has(node.id) && ['junction', 'substation'].includes(node.kind), '节点身份'); nodeIds.add(node.id); point(node.position); quantity(node.capacityKW, 1e6); }
  for (const link of grid.links) {
    dataObject(link, ['id', 'from', 'to', 'capacityKW', 'closed', 'points']); identity(link.id);
    need(!linkIds.has(link.id) && nodeIds.has(link.from) && nodeIds.has(link.to) && link.from !== link.to && typeof link.closed === 'boolean', '线缆身份或端点'); linkIds.add(link.id); quantity(link.capacityKW, 1e6);
    dataArray<Vec3>(link.points, 256); need(link.points.length >= 2, '线缆需要真实折线'); link.points.forEach(point);
    need(samePoint(link.points[0], grid.nodes.find(node => node.id === link.from)!.position) && samePoint(link.points.at(-1)!, grid.nodes.find(node => node.id === link.to)!.position), '线缆折线必须绑定真实节点端点');
  }
  const source = grid.sources[0]; dataObject(source, ['id', 'buildingId', 'nodeId', 'intake', 'outfall', 'penstockPoints', 'hydro']); identity(source.id);
  const site = world.buildings.find(building => building.id === source.buildingId);
  need(site?.facility === 'energy' && nodeIds.has(source.nodeId), '机组必须引用声明能源用途建筑及电网节点');
  validateFiniteHydroDefinition(source.hydro); need(source.id === source.hydro.id && source.hydro.enabledAt === 480, '单机组身份及可信480分钟起点');
  // Flow augments only above EPS. Bound cancellation in its source residual
  // subtraction, then require the smallest admitted .06-minute water transfer
  // to exceed BOTH reservoir binary64 resolutions by a conservative margin.
  // This is a scale-dependent integration contract, not a lowered physics
  // assertion, invented water, or a change to the independent parameter oracle.
  const hydraulic = source.hydro;
  const leastAcceptedKW = EPS - Number.EPSILON * hydraulic.maximumKW * 8;
  const yieldKWhPerM3 = 1000 * 9.81 * hydraulic.headMeters * hydraulic.efficiency / 3_600_000;
  const waterResolution = Number.EPSILON * Math.max(1, hydraulic.upstream.capacityM3, hydraulic.downstream.capacityM3) * 16;
  need(hydraulic.maximumKW === 0 || (leastAcceptedKW > EPS / 2 && leastAcceptedKW * .06 / 60 / yieldKWhPerM3 > waterResolution), '声明机组与双库浮点分辨率不能支持最小实际输配窗');
  for (const port of [source.intake, source.outfall]) { dataObject(port, ['reservoirId', 'position', 'open']); identity(port.reservoirId); point(port.position); need(typeof port.open === 'boolean', '明确水闸'); }
  need(source.intake.reservoirId === source.hydro.upstream.id && source.outfall.reservoirId === source.hydro.downstream.id, '真实独立上下游引用');
  need(source.intake.position.y - source.outfall.position.y === source.hydro.headMeters, '真实进出水高差绑定声明常水头');
  dataArray<Vec3>(source.penstockPoints, 256); need(source.penstockPoints.length >= 2, '机组必须声明真实输水管折线'); source.penstockPoints.forEach(point);
  need(samePoint(source.penstockPoints[0], source.intake.position) && samePoint(source.penstockPoints.at(-1)!, source.outfall.position), '输水管绑定真实进出水端点');
  for (const building of world.buildings) identity(building.id); for (const edge of world.edges) identity(edge.id);
  const buildingIds = new Set(world.buildings.map(building => building.id)), connectedBuildings = new Set<string>();
  need(buildingIds.size === world.buildings.length, '真实建筑身份不得重复'); dataArray<HydroGridBuildingLoad>(grid.buildings, buildingIds.size);
  for (const load of grid.buildings) { dataObject(load, ['buildingId', 'nodeId', 'baseKW', 'nightKW', 'shopKW']); need(buildingIds.has(load.buildingId) && !connectedBuildings.has(load.buildingId) && (load.nodeId === null || nodeIds.has(load.nodeId)), '完整建筑负荷引用'); connectedBuildings.add(load.buildingId); for (const value of [load.baseKW, load.nightKW, load.shopKW]) quantity(value, 1e6); }
  need(connectedBuildings.size === buildingIds.size, '每栋建筑负荷必须完整声明，缺接使用null');
  const edgeIds = new Set(world.edges.map(edge => edge.id)), connectedEdges = new Set<string>(); dataArray<HydroGridTransportConnection>(grid.transport, edgeIds.size);
  for (const connection of grid.transport) { dataObject(connection, ['edgeId', 'nodeId', 'vehicleKW']); need(edgeIds.has(connection.edgeId) && !connectedEdges.has(connection.edgeId) && (connection.nodeId === null || nodeIds.has(connection.nodeId)) && connection.vehicleKW === .08, '具名交通边与0.08kW车辆合同'); connectedEdges.add(connection.edgeId); }
}

export function createHydroGridState(world: WorldDefinition, owner?: SimState): HydroPowerGridState | undefined {
  validateHydroGridDefinition(world); const grid = definition(world); if (!grid) return undefined;
  const body: HydroPowerGridState = { version: 2, kind: grid.kind, unit: grid.unit, hydro: createPagedHydro(grid.sources[0].hydro), dispatch: null, totals: { demandedKWh: 0, servedKWh: 0, unservedKWh: 0 }, history: createPagedHistory<HydroPowerGridDispatch>() };
  freeze(grid); freeze(body);
  const capability: GridCapability = { world, definition: grid, physicalKey: physicalKey(world), loadIdentityKey: owner ? loadIdentityKey(owner) : null, owner: owner ?? null, runtime: null, pending: null };
  if (owner) { need(owner.tick === 0 && hydroGridClock(owner) === 480, '只在可信初始相位安装资产'); capability.runtime = createPagedHydroRuntime(owner, grid.sources[0].hydro, body.hydro, 480, 0); }
  caps.set(body, capability); return body;
}
function capabilityFor(world: WorldDefinition, state: SimState): { body: HydroPowerGridState; capability: GridCapability } {
  const body = bodyOf(state); need(body, '声明水力资产不能缺失'); const capability = caps.get(body);
  need(capability && capability.world === world && capability.definition === definition(world) && Object.isFrozen(body) && physicalKey(world) === capability.physicalKey, '拒绝通用复制、异城、可变或变换后的资产与拓扑');
  if (capability.owner === null) { need(body.history.count === 0 && state.tick === 0 && hydroGridClock(state) === 480, '初始资产只能绑定可信初始城市'); capability.owner = state; capability.loadIdentityKey = loadIdentityKey(state); capability.runtime = createPagedHydroRuntime(state, capability.definition.sources[0].hydro, body.hydro, 480, 0); }
  need(capability.owner === state && capability.runtime && capability.loadIdentityKey === loadIdentityKey(state), '资产只能属于当前城市状态对象及完整具名负荷集合'); return { body, capability };
}
/** Called before the native time phase. Failure leaves clock, asset/save and
 * pending simulation accumulator unchanged; no water or energy is committed. */
export function prepareHydroBeforeTick(world: WorldDefinition, state: SimState, nativeMinutes: number): void {
  if (!definition(world)) return;
  const { body, capability } = capabilityFor(world, state), source = capability.definition.sources[0];
  quantity(nativeMinutes, 4, .0625); need(state.tick === body.hydro.tick && hydroGridClock(state) === body.hydro.at, '能源账必须在原推进前相位');
  need(body.history.count === body.hydro.history.count && body.history.count < PAGED_HYDRO_MAX_WINDOWS, '完整分表容量必须在原time推进前停止');
  checkHistoryBudget(world, state, body.history.count + 1);
  const request: PagedHydroClockRequest = { tick: state.tick + 1, beforeAt: body.hydro.at, at: pagedHydroEndAt(body.hydro.at, nativeMinutes), nativeMinutes, intakeOpen: source.intake.open, outfallOpen: source.outfall.open };
  need(request.at - request.beforeAt >= .06, '实际供电窗须满足已声明的浮点分辨率下界');
  preflightPagedHydro(capability.runtime!, state, body.hydro, request); capability.pending = request;
}
/** Checks an entire prospective step before even the native accumulator is
 * written. It neither reserves windows nor signs a future dispatch. */
export function prepareHydroBeforeStep(world: WorldDefinition, state: SimState, nativeMinutes: number, tickCount: number): void {
  if (!definition(world)) return;
  const { body, capability } = capabilityFor(world, state); quantity(nativeMinutes, 4, .0625);
  need(Number.isSafeInteger(tickCount) && tickCount >= 0 && tickCount <= 480 && body.hydro.tick === state.tick && body.hydro.at === hydroGridClock(state), '原step必须从当前完整能源相位开始');
  need(body.history.count === body.hydro.history.count && body.history.count + tickCount <= PAGED_HYDRO_MAX_WINDOWS && state.tick + tickCount <= 1e10, '完整双账的整个step须在容量边界内');
  checkHistoryBudget(world, state, body.history.count + tickCount);
  let beforeAt = body.hydro.at;
  for (let index = 0; index < tickCount; index++) { const at = pagedHydroEndAt(beforeAt, nativeMinutes); quantity(at, 1e7); need(at - beforeAt >= .06 && beforeAt + (at - beforeAt) === at, '实际未来原时钟窗及浮点分辨率'); beforeAt = at; }
  if (tickCount > 0) { const source = capability.definition.sources[0]; preflightPagedHydro(capability.runtime!, state, body.hydro, { tick: state.tick + 1, beforeAt: body.hydro.at, at: pagedHydroEndAt(body.hydro.at, nativeMinutes), nativeMinutes, intakeOpen: source.intake.open, outfallOpen: source.outfall.open }); }
}
/** Paid production selectors use this private owner/header witness. A JSON
 * clone can pass a read-only cold reader but cannot earn powered labor. */
export function isCanonicalHydroDispatch(state: SimState): boolean {
  const body = bodyOf(state); if (!body) return false; const capability = caps.get(body), dispatch = body.dispatch;
  return !!capability && capability.owner === state && state.powerGrid === body && !!capability.runtime && Object.isFrozen(body) && Object.isFrozen(dispatch) && dispatch?.tick === state.tick && dispatch.at === hydroGridClock(state) && capability.world.powerGrid === capability.definition && physicalKey(capability.world) === capability.physicalKey && loadIdentityKey(state) === capability.loadIdentityKey;
}

interface Load { key: string; kind: 'building' | 'vehicle'; id: string; nodeId: string | null; demandKW: number; edgeId?: string }
interface LoadSources { shops: HydroShopLoadSource[]; vehicles: { id: string; edgeId: string }[] }
function observedSources(state: SimState): LoadSources {
  return { shops: sorted(state.shops).map(shop => ({ id: shop.id, buildingId: shop.buildingId, allowsOperation: shopLifecycleAllowsOperation(state, shop.id) })), vehicles: sorted(state.vehicles).map(vehicle => ({ id: vehicle.id, edgeId: vehicle.edgeId })) };
}
function solveWindow(world: WorldDefinition, grid: HydroPowerGridDefinition, request: PagedHydroClockRequest, availableKW: number, exhausted: boolean, observations: LoadSources): HydroPowerGridDispatch {
  const minutes = request.at - request.beforeAt, output: HydroPowerGridDispatch = { tick: request.tick, beforeAt: request.beforeAt, at: request.at, nativeMinutes: request.nativeMinutes, minutes, availableKW, demandKW: 0, servedKW: 0, unservedKW: 0, curtailedKW: 0, sources: record(), links: record(), nodes: record(), buildings: record(), vehicles: record(), loadSources: { shops: observations.shops }, diagnostics: { unconnectedBuildings: [], unconnectedVehicles: [], islandNodeIds: [], exhaustedSourceIds: exhausted ? [grid.sources[0].id] : [], constrainedLinkIds: [], constrainedNodeIds: [] } };
  const flow = new Flow(), source = flow.addNode(), sink = flow.addNode(), nodeRefs = new Map<string, { input: number; output: number }>(), linkArcs = new Map<string, { forward: Arc; backward: Arc }>(), demandArcs = new Map<string, Arc>();
  for (const node of sorted(grid.nodes)) { const input = flow.addNode(), nodeOutput = flow.addNode(); nodeRefs.set(node.id, { input, output: nodeOutput }); flow.edge(input, nodeOutput, node.capacityKW); }
  const asset = grid.sources[0], sourceArc = flow.edge(source, nodeRefs.get(asset.nodeId)!.input, availableKW);
  for (const link of sorted(grid.links)) { const a = nodeRefs.get(link.from)!, b = nodeRefs.get(link.to)!, capacity = link.closed ? link.capacityKW : 0; linkArcs.set(link.id, { forward: flow.edge(a.output, b.input, capacity), backward: flow.edge(b.output, a.input, capacity) }); }
  const hour = (request.at % 1440) / 60, night = hour < 6 || hour >= 19, loads: Load[] = [];
  for (const item of [...grid.buildings].sort((a, b) => a.buildingId.localeCompare(b.buildingId))) {
    const site = world.buildings.find(building => building.id === item.buildingId)!;
    const shopCount = observations.shops.filter(shop => shop.buildingId === item.buildingId && shop.allowsOperation && hour >= 6 && hour < (site.kind === 'market' ? 22 : 20)).length;
    loads.push({ key: 'building:' + item.buildingId, kind: 'building', id: item.buildingId, nodeId: item.nodeId, demandKW: item.baseKW + (night ? item.nightKW : 0) + item.shopKW * shopCount });
  }
  for (const vehicle of observations.vehicles) { const connection = grid.transport.find(item => item.edgeId === vehicle.edgeId); loads.push({ key: 'vehicle:' + vehicle.id, kind: 'vehicle', id: vehicle.id, edgeId: vehicle.edgeId, nodeId: connection?.nodeId ?? null, demandKW: connection?.vehicleKW ?? .08 }); }
  for (const load of loads) { output.demandKW += load.demandKW; if (load.nodeId !== null) demandArcs.set(load.key, flow.edge(nodeRefs.get(load.nodeId)!.output, sink, load.demandKW)); else (load.kind === 'building' ? output.diagnostics.unconnectedBuildings : output.diagnostics.unconnectedVehicles).push(load.id); }
  flow.solve(source, sink); const acceptedKW = sourceArc.initial - sourceArc.capacity; output.servedKW = acceptedKW;
  output.sources[asset.id] = { availableKW, suppliedKW: acceptedKW, transferredM3: 0, generatedKWh: acceptedKW * minutes / 60 };
  for (const load of loads) { const arc = demandArcs.get(load.key), servedKW = arc ? arc.initial - arc.capacity : 0, meter = { nodeId: load.nodeId, demandKW: load.demandKW, servedKW, unservedKW: Math.max(0, load.demandKW - servedKW) }; if (load.kind === 'building') output.buildings[load.id] = meter; else output.vehicles[load.id] = { ...meter, edgeId: load.edgeId! }; }
  for (const link of sorted(grid.links)) { const arcs = linkArcs.get(link.id)!, net = (arcs.forward.initial - arcs.forward.capacity) - (arcs.backward.initial - arcs.backward.capacity); output.links[link.id] = net; if (link.closed && link.capacityKW > EPS && Math.abs(net) >= link.capacityKW - EPS) output.diagnostics.constrainedLinkIds.push(link.id); }
  for (const node of sorted(grid.nodes)) { const incoming = grid.links.reduce((sum, link) => sum + (link.to === node.id ? Math.max(0, output.links[link.id]) : link.from === node.id ? Math.max(0, -output.links[link.id]) : 0), 0), supplied = asset.nodeId === node.id ? acceptedKW : 0; output.nodes[node.id] = incoming + supplied; if (node.capacityKW > EPS && output.nodes[node.id] >= node.capacityKW - EPS) output.diagnostics.constrainedNodeIds.push(node.id); }
  const reached = new Set<string>(), queue: string[] = [];
  if (availableKW > EPS && grid.nodes.find(node => node.id === asset.nodeId)!.capacityKW > EPS) { reached.add(asset.nodeId); queue.push(asset.nodeId); }
  for (let q = 0; q < queue.length; q++) for (const link of grid.links.filter(link => link.closed && link.capacityKW > EPS && (link.from === queue[q] || link.to === queue[q]))) { const next = link.from === queue[q] ? link.to : link.from; if (!reached.has(next) && grid.nodes.find(node => node.id === next)!.capacityKW > EPS) { reached.add(next); queue.push(next); } }
  output.diagnostics.islandNodeIds = sorted(grid.nodes).filter(node => !reached.has(node.id)).map(node => node.id);
  output.unservedKW = Math.max(0, output.demandKW - output.servedKW); output.curtailedKW = Math.max(0, output.availableKW - output.servedKW); return output;
}
function verifyConservation(grid: HydroPowerGridDefinition, window: HydroPowerGridDispatch): void {
  let metered = 0; for (const meter of [...Object.values(window.buildings), ...Object.values(window.vehicles)]) { near(meter.demandKW, meter.servedKW + meter.unservedKW); metered += meter.servedKW; }
  near(metered, window.servedKW); near(window.availableKW, window.servedKW + window.curtailedKW); near(window.demandKW, window.servedKW + window.unservedKW);
  for (const node of grid.nodes) {
    quantity(window.nodes[node.id], node.capacityKW + EPS);
    const input = (grid.sources[0].nodeId === node.id ? window.servedKW : 0) + grid.links.reduce((sum, link) => sum + (link.to === node.id ? Math.max(0, window.links[link.id]) : link.from === node.id ? Math.max(0, -window.links[link.id]) : 0), 0);
    const output = [...Object.values(window.buildings), ...Object.values(window.vehicles)].filter(meter => meter.nodeId === node.id).reduce((sum, meter) => sum + meter.servedKW, 0) + grid.links.reduce((sum, link) => sum + (link.from === node.id ? Math.max(0, window.links[link.id]) : link.to === node.id ? Math.max(0, -window.links[link.id]) : 0), 0);
    near(input, output); near(input, window.nodes[node.id]);
  }
  for (const link of grid.links) need(finite(window.links[link.id]) && Math.abs(window.links[link.id]) <= (link.closed ? link.capacityKW : 0) + EPS, '真实线缆容量与开关');
}
/** Public cold enumeration preserves every page/window; normal dispatch never
 * traverses these historical pages or calls a complete replay validator. */
export function* hydroGridWindows(body: HydroPowerGridState): Generator<HydroPowerGridDispatch> {
  yield* pagedHistoryWindows(body.history);
}
export function dispatchHydroGrid(world: WorldDefinition, state: SimState, nativeMinutes: number): HydroPowerGridState {
  const { body, capability } = capabilityFor(world, state), grid = capability.definition;
  if (body.dispatch?.tick === state.tick && body.dispatch.at === hydroGridClock(state)) { need(body.dispatch.nativeMinutes === nativeMinutes, '同相位不得更换原请求'); return body; }
  const request = capability.pending; need(request && request.tick === state.tick && request.at === hydroGridClock(state) && request.nativeMinutes === nativeMinutes, '只能消费原time推进前预检的当前相位');
  const availableKW = offerPagedHydro(capability.runtime!, state, body.hydro, request), observations = observedSources(state);
  validateObservations(world, state, observations);
  const window = solveWindow(world, grid, request, availableKW, body.hydro.upstreamM3 <= EPS, observations), prepared = preparePagedHydro(capability.runtime!, state, body.hydro, request, window.servedKW);
  window.sources[grid.sources[0].id].transferredM3 = prepared.window.transferredM3;
  near(prepared.window.suppliedKW, window.servedKW); near(prepared.window.generatedKWh, window.sources[grid.sources[0].id].generatedKWh); verifyConservation(grid, window);
  freeze(window);
  const next: HydroPowerGridState = { version: body.version, kind: body.kind, unit: body.unit, hydro: prepared.state, dispatch: window, totals: { demandedKWh: body.totals.demandedKWh + window.demandKW * window.minutes / 60, servedKWh: body.totals.servedKWh + window.servedKW * window.minutes / 60, unservedKWh: body.totals.unservedKWh + window.unservedKW * window.minutes / 60 }, history: appendPagedHistory(body.history, window) };
  freeze(next); commitPagedHydro(capability.runtime!, state, body.hydro, prepared);
  caps.set(next, { ...capability, pending: null }); caps.delete(body); return next;
}

function validateObservations(world: WorldDefinition, state: SimState, observations: LoadSources): void {
  dataArray<HydroShopLoadSource>(observations.shops, state.shops.length); dataArray<{ id: string; edgeId: string }>(observations.vehicles, state.vehicles.length);
  need(observations.shops.length === state.shops.length && observations.vehicles.length === state.vehicles.length, '每窗真实商店与车辆来源不得丢项');
  const shops = sorted(state.shops), vehicles = sorted(state.vehicles);
  need(new Set(shops.map(shop => shop.id)).size === shops.length && new Set(vehicles.map(vehicle => vehicle.id)).size === vehicles.length, '完整具名负荷身份不能重复');
  for (let index = 0; index < shops.length; index++) { const row = observations.shops[index]; dataObject(row, ['id', 'buildingId', 'allowsOperation']); identity(row.id); need(row.id === shops[index].id && row.buildingId === shops[index].buildingId && typeof row.allowsOperation === 'boolean' && world.buildings.some(site => site.id === row.buildingId), '商店需求来源引用');
    // Existing lifecycle titles and leases persist when their status changes.
    // A shop that has never had either follows the native always-permitted
    // legacy path; a fabricated false snapshot cannot erase that past load.
    if (!state.shopLifecycle?.titles[row.id] && !state.shopLifecycle?.leases.some(lease => lease.shopId === row.id)) need(row.allowsOperation, '无历史生命周期许可的商店不能伪造停业需求');
  }
  for (let index = 0; index < vehicles.length; index++) { const row = observations.vehicles[index]; dataObject(row, ['id', 'edgeId']); identity(row.id); identity(row.edgeId); need(row.id === vehicles[index].id && world.edges.some(edge => edge.id === row.edgeId), '真实车辆来源及能源相位交通边'); }
}
function exactData(actual: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== 'object') { need(actual === expected, '历史确定性重演数值不符'); return; }
  if (Array.isArray(expected)) { dataArray(actual, expected.length); need(actual.length === expected.length, '历史数组数量'); for (let index = 0; index < expected.length; index++) exactData(actual[index], expected[index]); return; }
  const keys = Object.keys(expected); dataObject(actual, keys); for (const key of keys) exactData((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key]);
}
/** Strict, read-only cold reader. In addition to the resource replay, every
 * historical building and vehicle demand is reconstructed from its own phase
 * ingredients, then the original sorted capacitated Flow is solved again.
 * Current shop hours/vehicle edges cannot retrospectively replace old loads. */
export function validateHydroGridState(state: SimState, world: WorldDefinition): void {
  validateHydroGridDefinition(world); const grid = definition(world), body = bodyOf(state);
  if (!grid) { need(!body, '未声明水力地图不能带水力资产'); return; }
  need(body && state.power === undefined, '声明水力地图须有独立资产，不叠加旧聚合源'); dataObject(body, ['version', 'kind', 'unit', 'hydro', 'dispatch', 'totals', 'history']);
  need(body.version === 2 && body.kind === grid.kind && body.unit === grid.unit, '账本版本及单位');
  validatePagedHydro(grid.sources[0].hydro, body.hydro, hydroGridClock(state), state.tick);
  need(body.history.count === body.hydro.history.count, '资源账和完整电网窗数量必须相同');
  checkHistoryBudget(world, state, body.history.count);
  dataObject(body.totals, ['demandedKWh', 'servedKWh', 'unservedKWh']); for (const value of Object.values(body.totals)) quantity(value, 1e15);
  const totals = { demandedKWh: 0, servedKWh: 0, unservedKWh: 0 }, water = pagedHydroWindows(body.hydro)[Symbol.iterator](); let at = 480, tick = 0, latest: HydroPowerGridDispatch | null = null;
  for (const window of hydroGridWindows(body)) {
    dataObject(window, DISPATCH_KEYS); need(window.tick === tick + 1 && window.beforeAt === at, '每实际tick连续保留当前和过去分表');
    dataObject(window.loadSources, ['shops']); dataObject(window.vehicles, state.vehicles.map(vehicle => vehicle.id));
    for (const meter of Object.values(window.vehicles)) dataObject(meter, ['nodeId', 'demandKW', 'servedKW', 'unservedKW', 'edgeId']);
    const observations: LoadSources = { shops: window.loadSources.shops, vehicles: Object.entries(window.vehicles).sort(([a], [b]) => a.localeCompare(b)).map(([id, meter]) => ({ id, edgeId: meter.edgeId })) };
    validateObservations(world, state, observations);
    const result = water.next(); need(!result.done, '电网窗不能缺真实转水账'); const hydraulic = result.value;
    need(hydraulic.tick === window.tick && hydraulic.beforeAt === window.beforeAt && hydraulic.at === window.at && hydraulic.nativeMinutes === window.nativeMinutes, '双账时间窗必须相同');
    const request: PagedHydroClockRequest = { tick: window.tick, beforeAt: window.beforeAt, at: window.at, nativeMinutes: window.nativeMinutes, intakeOpen: grid.sources[0].intake.open, outfallOpen: grid.sources[0].outfall.open };
    need(hydraulic.intakeOpen === request.intakeOpen && hydraulic.outfallOpen === request.outfallOpen, '历史水闸不能变换可信声明');
    const expected = solveWindow(world, grid, request, hydraulic.availableKW, hydraulic.beforeUpstreamM3 <= EPS, observations); expected.sources[grid.sources[0].id].transferredM3 = hydraulic.transferredM3;
    need(hydraulic.acceptedKW === expected.servedKW, '转水只能消耗确定性源弧实际接受量'); exactData(window, expected); verifyConservation(grid, window);
    near(hydraulic.generatedKWh, expected.sources[grid.sources[0].id].generatedKWh);
    totals.demandedKWh += expected.demandKW * expected.minutes / 60; totals.servedKWh += expected.servedKW * expected.minutes / 60; totals.unservedKWh += expected.unservedKW * expected.minutes / 60;
    at = window.at; tick = window.tick; latest = window;
  }
  need(water.next().done && at === hydroGridClock(state) && tick === state.tick, '完整历史必须结束于当前实际相位'); exactData(body.totals, totals); exactData(body.dispatch, latest);
  if (latest === null) need(state.tick === 0 && hydroGridClock(state) === 480, '只有可信初始资产可以没有分表');
  near(body.totals.servedKWh, body.hydro.generatedKWh); near(body.totals.demandedKWh, body.totals.servedKWh + body.totals.unservedKWh);
}
/** Installation calls this only after the host has accepted and replaced its
 * complete save. A validator/preview only reads and never invokes this hook. */
export function bindHydroGridAfterLoad(world: WorldDefinition, state: SimState): void {
  if (!definition(world)) return;
  validateHydroGridState(state, world); const grid = definition(world)!, body = bodyOf(state)!;
  freeze(grid); freeze(body); const runtime = createPagedHydroRuntime(state, grid.sources[0].hydro, body.hydro, hydroGridClock(state), state.tick);
  caps.set(body, { world, definition: grid, physicalKey: physicalKey(world), loadIdentityKey: loadIdentityKey(state), owner: state, runtime, pending: null });
}
