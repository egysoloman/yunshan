import {
  validateHydroGridDefinition, createHydroGridState, dispatchHydroGrid,
  validateHydroGridState, bindHydroGridAfterLoad, prepareHydroBeforeStep,
  prepareHydroBeforeTick, isCanonicalHydroDispatch,
  type HydroPowerGridDefinition, type HydroPowerGridState,
} from './power-grid-hydro';
import { Flow, type Arc } from './power-network-flow';
import { shopLifecycleAllowsOperation } from './shop_lifecycle';
import type { Simulation } from '../simulation';
import type { Command, CommandResult, SimState, Vec3, WorldDefinition } from '../types';

/** P is the game's existing power unit, not a claimed electrical kW model.
 * This first network version transports an explicitly declared, finite stored
 * energy asset. It contains no generator, fuel purchase or free refill. */
export interface PowerGridNode { id: string; kind: 'junction' | 'substation'; position: Vec3; capacityP: number }
export interface PowerGridLink { id: string; from: string; to: string; capacityP: number; closed: boolean; points: Vec3[] }
export interface PowerGridStorage { id: string; buildingId: string; nodeId: string; maximumP: number; initialStoredPMinutes: number }
export interface PowerGridBuildingLoad { buildingId: string; nodeId: string | null; baseP: number; nightP: number; shopP: number }
export interface PowerGridEdgeConnection { edgeId: string; nodeId: string | null }
export interface StoragePowerGridDefinition {
  version: 1; kind: 'finite-storage-network'; nodes: PowerGridNode[]; links: PowerGridLink[];
  storage: PowerGridStorage[]; buildings: PowerGridBuildingLoad[]; transport: PowerGridEdgeConnection[];
}
export interface GridMeter { demandP: number; servedP: number; unservedP: number; nodeId: string | null }
export interface GridVehicleMeter extends GridMeter { edgeId: string }
export interface GridSourceMeter { availableP: number; suppliedP: number; consumedPMinutes: number }
export interface PowerGridDispatch {
  tick: number; at: number; minutes: number; availableP: number; demandP: number; servedP: number; unservedP: number; curtailedP: number;
  sources: Record<string, GridSourceMeter>; links: Record<string, number>; nodes: Record<string, number>;
  buildings: Record<string, GridMeter>; vehicles: Record<string, GridVehicleMeter>;
  diagnostics: { unconnectedBuildings: string[]; unconnectedVehicles: string[]; islandNodeIds: string[]; exhaustedStorageIds: string[]; constrainedLinkIds: string[]; constrainedNodeIds: string[] };
}
export interface StoragePowerGridState {
  version: 1; kind: 'finite-storage-network'; storedPMinutes: Record<string, number>; consumedPMinutes: Record<string, number>;
  dispatch: PowerGridDispatch | null;
  totals: { demandedPMinutes: number; servedPMinutes: number; unservedPMinutes: number };
}
export type PowerGridDefinition = StoragePowerGridDefinition | HydroPowerGridDefinition;
export type PowerGridState = StoragePowerGridState | HydroPowerGridState;
const EPS = 1e-8;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const need: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error('电网契约：' + message); };
const object = (value: unknown, keys: readonly string[]) => need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)), '字段结构');
const number = (value: unknown, max = 1e9) => need(finite(value) && value >= 0 && value <= max, '有限非负数量');
const id = (value: unknown) => need(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value), '实体标识');
const point = (value: Vec3) => { object(value, ['x', 'y', 'z']); for (const item of Object.values(value)) need(finite(item) && Math.abs(item) <= 1e7, '真实空间点'); };
const near = (a: number, b: number) => need(Math.abs(a - b) <= 1e-7 + Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 64, '数量守恒');
const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const sorted = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

/** Configuration is supplied by the map/host, never inferred from a building ID.
 * A null connection is an explicit missing feeder. Invalid references reject
 * the map rather than reconnecting it to an implicit city-wide bus. */
export function validatePowerGridDefinition(world: WorldDefinition): void {
  const grid = world.powerGrid; if (grid === undefined) return;
  if (grid.version === 2) { validateHydroGridDefinition(world); return; }
  object(grid, ['version', 'kind', 'nodes', 'links', 'storage', 'buildings', 'transport']);
  need(grid.version === 1 && grid.kind === 'finite-storage-network', '不支持的网络版本');
  const list = <T>(value: unknown, max: number): T[] => { need(Array.isArray(value) && value.length <= max, '有界数组'); return value as T[]; };
  const nodes = list<PowerGridNode>(grid.nodes, 1024), links = list<PowerGridLink>(grid.links, 4096), sources = list<PowerGridStorage>(grid.storage, 64);
  const buildings = new Set(world.buildings.map(site => site.id)), edges = new Set(world.edges.map(edge => edge.id)), nodeIds = new Set<string>(), linkIds = new Set<string>(), sourceIds = new Set<string>();
  for (const node of nodes) { object(node, ['id', 'kind', 'position', 'capacityP']); id(node.id); need(!nodeIds.has(node.id) && ['junction', 'substation'].includes(node.kind), '节点身份'); nodeIds.add(node.id); point(node.position); number(node.capacityP, 1e6); }
  for (const link of links) { object(link, ['id', 'from', 'to', 'capacityP', 'closed', 'points']); id(link.id); need(!linkIds.has(link.id) && nodeIds.has(link.from) && nodeIds.has(link.to) && link.from !== link.to && typeof link.closed === 'boolean', '线缆身份或端点'); linkIds.add(link.id); number(link.capacityP, 1e6);
    const points = list<Vec3>(link.points, 256); need(points.length >= 2, '线缆需要真实折线'); points.forEach(point);
    const from = nodes.find(node => node.id === link.from)!.position, to = nodes.find(node => node.id === link.to)!.position;
    need(Math.hypot(points[0].x - from.x, points[0].y - from.y, points[0].z - from.z) <= EPS && Math.hypot(points.at(-1)!.x - to.x, points.at(-1)!.y - to.y, points.at(-1)!.z - to.z) <= EPS, '线缆几何端点必须引用节点');
  }
  for (const source of sources) { object(source, ['id', 'buildingId', 'nodeId', 'maximumP', 'initialStoredPMinutes']); id(source.id); need(!sourceIds.has(source.id) && buildings.has(source.buildingId) && nodeIds.has(source.nodeId), '储能资产引用'); sourceIds.add(source.id); number(source.maximumP, 1e6); number(source.initialStoredPMinutes); }
  const connectedBuildings = new Set<string>();
  for (const load of list<PowerGridBuildingLoad>(grid.buildings, world.buildings.length)) { object(load, ['buildingId', 'nodeId', 'baseP', 'nightP', 'shopP']); need(buildings.has(load.buildingId) && !connectedBuildings.has(load.buildingId) && (load.nodeId === null || nodeIds.has(load.nodeId)), '建筑负荷引用'); connectedBuildings.add(load.buildingId); number(load.baseP, 1e6); number(load.nightP, 1e6); number(load.shopP, 1e6); }
  need(connectedBuildings.size === buildings.size, '每栋建筑必须声明负荷与连接，缺支路使用null');
  const connectedEdges = new Set<string>();
  for (const connection of list<PowerGridEdgeConnection>(grid.transport, edges.size)) { object(connection, ['edgeId', 'nodeId']); need(edges.has(connection.edgeId) && !connectedEdges.has(connection.edgeId) && (connection.nodeId === null || nodeIds.has(connection.nodeId)), '交通连接引用'); connectedEdges.add(connection.edgeId); }
  // A missing transport connection is deliberately metered as unconnected.
}
export function createPowerGridState(world: WorldDefinition & { powerGrid?: StoragePowerGridDefinition }, owner?: SimState): StoragePowerGridState | undefined;
export function createPowerGridState(world: WorldDefinition & { powerGrid?: HydroPowerGridDefinition }, owner?: SimState): HydroPowerGridState | undefined;
export function createPowerGridState(world: WorldDefinition, owner?: SimState): PowerGridState | undefined;
export function createPowerGridState(world: WorldDefinition, owner?: SimState): PowerGridState | undefined {
  validatePowerGridDefinition(world); const grid = world.powerGrid; if (!grid) return undefined;
  if (grid.version === 2) return createHydroGridState(world, owner);
  const stored = record<number>(), consumed = record<number>();
  for (const source of sorted(grid.storage)) { stored[source.id] = source.initialStoredPMinutes; consumed[source.id] = 0; }
  return { version: 1, kind: grid.kind, storedPMinutes: stored, consumedPMinutes: consumed, dispatch: null, totals: { demandedPMinutes: 0, servedPMinutes: 0, unservedPMinutes: 0 } };
}
interface Load { key: string; kind: 'building' | 'vehicle'; id: string; nodeId: string | null; demandP: number; edgeId?: string }
/** Save validation replays achievable flow, so a forged feasible all-zero
 * dispatch cannot pretend a loaded battery was unused. */
function achievablePower(grid: StoragePowerGridDefinition, offered: Record<string, number>, loads: { id: string; nodeId: string | null; demandP: number }[]): number {
  const flow = new Flow(), source = flow.addNode(), sink = flow.addNode(), nodes = new Map<string, { input: number; output: number }>();
  for (const node of sorted(grid.nodes)) { const input = flow.addNode(), output = flow.addNode(); nodes.set(node.id, { input, output }); flow.edge(input, output, node.capacityP); }
  const sources: Arc[] = [];
  for (const item of sorted(grid.storage)) sources.push(flow.edge(source, nodes.get(item.nodeId)!.input, offered[item.id]));
  for (const link of sorted(grid.links)) { const a = nodes.get(link.from)!, b = nodes.get(link.to)!, capacity = link.closed ? link.capacityP : 0; flow.edge(a.output, b.input, capacity); flow.edge(b.output, a.input, capacity); }
  for (const load of sorted(loads)) if (load.nodeId !== null) flow.edge(nodes.get(load.nodeId)!.output, sink, load.demandP);
  flow.solve(source, sink); return sources.reduce((sum, arc) => sum + arc.initial - arc.capacity, 0);
}

export function dispatchPowerGrid(world: WorldDefinition & { powerGrid?: StoragePowerGridDefinition }, state: SimState, minutes: number): StoragePowerGridState;
export function dispatchPowerGrid(world: WorldDefinition & { powerGrid?: HydroPowerGridDefinition }, state: SimState, minutes: number): HydroPowerGridState;
export function dispatchPowerGrid(world: WorldDefinition, state: SimState, minutes: number): PowerGridState;
export function dispatchPowerGrid(world: WorldDefinition, state: SimState, minutes: number): PowerGridState {
  if (world.powerGrid?.version === 2) return dispatchHydroGrid(world, state, minutes);
  validatePowerGridDefinition(world); need(!!world.powerGrid && !!state.powerGrid, '已声明网络及资产状态'); need(finite(minutes) && minutes > 0 && minutes <= 4, '本相位分钟');
  const grid = world.powerGrid!, previous = state.powerGrid!, at = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
  need(previous.version === 1 && previous.kind === grid.kind, '有限资产状态版本'); const assetIds = grid.storage.map(item => item.id); object(previous.storedPMinutes, assetIds); object(previous.consumedPMinutes, assetIds); for (const item of grid.storage) { number(previous.storedPMinutes[item.id]); number(previous.consumedPMinutes[item.id]); near(previous.storedPMinutes[item.id] + previous.consumedPMinutes[item.id], item.initialStoredPMinutes); }
  if (previous.dispatch?.tick === state.tick && previous.dispatch.at === at) { validatePowerGridState(state, world); return previous; }
  const flow = new Flow(), source = flow.addNode(), sink = flow.addNode(), nodeRefs = new Map<string, { input: number; output: number; arc: Arc }>();
  for (const node of sorted(grid.nodes)) { const input = flow.addNode(), output = flow.addNode(); nodeRefs.set(node.id, { input, output, arc: flow.edge(input, output, node.capacityP) }); }
  const sourceArcs = new Map<string, Arc>(), linkArcs = new Map<string, { forward: Arc; backward: Arc }>(), demandArcs = new Map<string, Arc>();
  const output: PowerGridDispatch = { tick: state.tick, at, minutes, availableP: 0, demandP: 0, servedP: 0, unservedP: 0, curtailedP: 0, sources: record(), links: record(), nodes: record(), buildings: record(), vehicles: record(), diagnostics: { unconnectedBuildings: [], unconnectedVehicles: [], islandNodeIds: [], exhaustedStorageIds: [], constrainedLinkIds: [], constrainedNodeIds: [] } };
  for (const item of sorted(grid.storage)) { const stored = previous.storedPMinutes[item.id]; need(finite(stored) && stored >= 0 && stored <= item.initialStoredPMinutes + EPS, '库存不得越过世界声明'); const available = Math.min(item.maximumP, stored / minutes); sourceArcs.set(item.id, flow.edge(source, nodeRefs.get(item.nodeId)!.input, available)); output.sources[item.id] = { availableP: available, suppliedP: 0, consumedPMinutes: 0 }; output.availableP += available; if (stored <= EPS) output.diagnostics.exhaustedStorageIds.push(item.id); }
  for (const item of sorted(grid.links)) { const a = nodeRefs.get(item.from)!, b = nodeRefs.get(item.to)!, capacity = item.closed ? item.capacityP : 0; linkArcs.set(item.id, { forward: flow.edge(a.output, b.input, capacity), backward: flow.edge(b.output, a.input, capacity) }); }
  const night = state.hour < 6 || state.hour >= 19, loads: Load[] = [];
  for (const item of [...grid.buildings].sort((a, b) => a.buildingId.localeCompare(b.buildingId))) { const demand = item.baseP + (night ? item.nightP : 0) + item.shopP * state.shops.filter(shop => shop.buildingId === item.buildingId && state.hour >= 6 && state.hour < (world.buildings.find(site => site.id === shop.buildingId)!.kind === 'market' ? 22 : 20) && shopLifecycleAllowsOperation(state, shop.id)).length; loads.push({ key: 'building:' + item.buildingId, kind: 'building', id: item.buildingId, nodeId: item.nodeId, demandP: demand }); }
  for (const vehicle of sorted(state.vehicles)) loads.push({ key: 'vehicle:' + vehicle.id, kind: 'vehicle', id: vehicle.id, nodeId: grid.transport.find(item => item.edgeId === vehicle.edgeId)?.nodeId ?? null, demandP: .08, edgeId: vehicle.edgeId });
  for (const load of loads) { output.demandP += load.demandP; if (load.nodeId !== null) demandArcs.set(load.key, flow.edge(nodeRefs.get(load.nodeId)!.output, sink, load.demandP)); else (load.kind === 'building' ? output.diagnostics.unconnectedBuildings : output.diagnostics.unconnectedVehicles).push(load.id); }
  flow.solve(source, sink);
  for (const item of sorted(grid.storage)) { const arc = sourceArcs.get(item.id)!, meter = output.sources[item.id]; meter.suppliedP = arc.initial - arc.capacity; meter.consumedPMinutes = meter.suppliedP * minutes; output.servedP += meter.suppliedP; }
  for (const load of loads) { const arc = demandArcs.get(load.key), served = arc ? arc.initial - arc.capacity : 0; const meter = { nodeId: load.nodeId, demandP: load.demandP, servedP: served, unservedP: Math.max(0, load.demandP - served) }; if (load.kind === 'building') output.buildings[load.id] = meter; else output.vehicles[load.id] = { ...meter, edgeId: load.edgeId! }; }
  for (const item of sorted(grid.links)) { const arcs = linkArcs.get(item.id)!, net = (arcs.forward.initial - arcs.forward.capacity) - (arcs.backward.initial - arcs.backward.capacity); output.links[item.id] = net; if (item.closed && item.capacityP > EPS && Math.abs(net) >= item.capacityP - EPS) output.diagnostics.constrainedLinkIds.push(item.id); }
  // Remove opposite cable circulations when reporting real node throughput.
  for (const node of sorted(grid.nodes)) { const supplied = grid.storage.filter(item => item.nodeId === node.id).reduce((sum, item) => sum + output.sources[item.id].suppliedP, 0); const incoming = grid.links.reduce((sum, item) => sum + (item.to === node.id ? Math.max(0, output.links[item.id]) : item.from === node.id ? Math.max(0, -output.links[item.id]) : 0), 0); const value = supplied + incoming; output.nodes[node.id] = value; if (node.capacityP > EPS && value >= node.capacityP - EPS) output.diagnostics.constrainedNodeIds.push(node.id); }
  const reached = new Set(grid.storage.filter(item => output.sources[item.id].availableP > EPS && grid.nodes.find(node => node.id === item.nodeId)!.capacityP > EPS).map(item => item.nodeId)), queue = [...reached];
  for (let q = 0; q < queue.length; q++) { if (grid.nodes.find(node => node.id === queue[q])!.capacityP <= EPS) continue; for (const link of grid.links.filter(item => item.closed && item.capacityP > EPS && (item.from === queue[q] || item.to === queue[q]))) { const next = link.from === queue[q] ? link.to : link.from; if (!reached.has(next) && grid.nodes.find(node => node.id === next)!.capacityP > EPS) { reached.add(next); queue.push(next); } } }
  output.diagnostics.islandNodeIds = sorted(grid.nodes).filter(node => !reached.has(node.id)).map(node => node.id);
  output.unservedP = Math.max(0, output.demandP - output.servedP); output.curtailedP = Math.max(0, output.availableP - output.servedP);
  const stored = { ...previous.storedPMinutes }, consumed = { ...previous.consumedPMinutes };
  for (const item of grid.storage) { const used = output.sources[item.id].consumedPMinutes; stored[item.id] = Math.max(0, stored[item.id] - used); consumed[item.id] += used; }
  return { ...previous, storedPMinutes: stored, consumedPMinutes: consumed, dispatch: output, totals: { demandedPMinutes: previous.totals.demandedPMinutes + output.demandP * minutes, servedPMinutes: previous.totals.servedPMinutes + output.servedP * minutes, unservedPMinutes: previous.totals.unservedPMinutes + output.unservedP * minutes } };
}
/** The per-building meter takes precedence over legacy city averages. */
export function gridBuildingSupplyRatio(state: SimState, buildingId: string): number {
  if (!state.powerGrid) return 1;
  if (state.powerGrid.version === 2) {
    const dispatch = state.powerGrid.dispatch, now = state.day * 1440 + state.hour * 60, meter = dispatch?.buildings[buildingId];
    if (!isCanonicalHydroDispatch(state) || !dispatch || dispatch.tick !== state.tick || dispatch.at !== now || !meter || meter.nodeId === null) return 0;
    return meter.demandKW > EPS ? meter.servedKW / meter.demandKW : 0;
  }
  const dispatch = state.powerGrid.dispatch, now = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60, meter = dispatch?.buildings[buildingId];
  if (!dispatch || dispatch.tick !== state.tick || Math.abs(dispatch.at - now) > EPS || !meter || meter.nodeId === null) return 0;
  return meter.demandP > EPS ? meter.servedP / meter.demandP : 0;
}
export function gridVehicleSupplyRatio(state: SimState, vehicleId: string): number {
  if (!state.powerGrid) return 1;
  if (state.powerGrid.version === 2) {
    const dispatch = state.powerGrid.dispatch, now = state.day * 1440 + state.hour * 60, meter = dispatch?.vehicles[vehicleId];
    if (!isCanonicalHydroDispatch(state) || !dispatch || dispatch.tick !== state.tick || dispatch.at !== now || !meter || meter.nodeId === null) return 0;
    return meter.demandKW > EPS ? meter.servedKW / meter.demandKW : 0;
  }
  const dispatch = state.powerGrid.dispatch, now = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60, meter = dispatch?.vehicles[vehicleId];
  if (!dispatch || dispatch.tick !== state.tick || Math.abs(dispatch.at - now) > EPS || !meter || meter.nodeId === null) return 0;
  return meter.demandP > EPS ? meter.servedP / meter.demandP : 0;
}
/** Only the intersection of the original funded credited front and this
 * phase's measured energy window may become powered productive labor.
 * Far-tier retrospective attendance does not borrow the current four minutes. */
export function gridPoweredWorkMinutes(state: SimState, buildingId: string, window: { startAt: number; endAt: number }, claimedMinutes: number): number {
  if (!state.powerGrid || !finite(window.startAt) || !finite(window.endAt) || !finite(claimedMinutes) || claimedMinutes <= 0 || window.endAt < window.startAt) return 0;
  if (state.powerGrid.version === 2) {
    const dispatch = state.powerGrid.dispatch; if (!dispatch) return 0;
    const overlap = Math.max(0, Math.min(window.endAt, dispatch.at) - Math.max(window.startAt, dispatch.beforeAt));
    return Math.min(claimedMinutes, overlap) * gridBuildingSupplyRatio(state, buildingId);
  }
  const dispatch = state.powerGrid.dispatch; if (!dispatch) return 0;
  const overlap = Math.max(0, Math.min(window.endAt, dispatch.at) - Math.max(window.startAt, dispatch.at - dispatch.minutes));
  return Math.min(claimedMinutes, overlap) * gridBuildingSupplyRatio(state, buildingId);
}
export function powerGridStatus(world: WorldDefinition, state?: SimState) {
  if (!world.powerGrid) return { mode: 'legacy-unmodeled' as const, supported: false, reason: '地图未声明物理电网；保留历史聚合规则，不代表已验证电缆、发电或另一城市供电。' };
  validatePowerGridDefinition(world);
  if (world.powerGrid.version === 2) {
    const resource = state?.powerGrid?.version === 2 ? state.powerGrid.hydro : undefined;
    return { mode: 'finite-hydro-network' as const, supported: true, unit: world.powerGrid.unit,
      generationImplemented: true, finiteWaterOnly: true, refillImplemented: false, maintenanceImplemented: false,
      upstreamInitialM3: world.powerGrid.sources[0].hydro.upstream.initialM3,
      upstreamRemainingM3: resource?.upstreamM3 ?? null, generatedKWh: resource?.generatedKWh ?? 0,
      dispatch: state?.powerGrid?.version === 2 ? state.powerGrid.dispatch : null };
  }
  return { mode: 'finite-storage-network' as const, supported: true, storageInitialPMinutes: world.powerGrid.storage.reduce((sum, item) => sum + item.initialStoredPMinutes, 0), storageRemainingPMinutes: Object.values(state?.powerGrid?.version === 1 ? state.powerGrid.storedPMinutes : {}).reduce((sum, value) => sum + value, 0), dispatch: state?.powerGrid?.version === 1 ? state.powerGrid.dispatch : null, generationImplemented: false };
}
export function validatePowerGridState(state: SimState, world: WorldDefinition): void {
  const grid = world.powerGrid, body = state.powerGrid; validatePowerGridDefinition(world);
  if (!grid) { need(body === undefined, '未声明地图不能加载电网资产'); return; }
  if (grid.version === 2) { validateHydroGridState(state, world); return; }
  need(!!body && state.power === undefined, '声明地图须有独立电网，不叠加旧免费聚合源');
  object(body, ['version', 'kind', 'storedPMinutes', 'consumedPMinutes', 'dispatch', 'totals']); need(body!.version === 1 && body!.kind === grid.kind, '资产版本');
  const sourceIds = grid.storage.map(item => item.id); object(body!.storedPMinutes, sourceIds); object(body!.consumedPMinutes, sourceIds);
  for (const source of grid.storage) { number(body!.storedPMinutes[source.id]); number(body!.consumedPMinutes[source.id]); near(body!.storedPMinutes[source.id] + body!.consumedPMinutes[source.id], source.initialStoredPMinutes); }
  object(body!.totals, ['demandedPMinutes', 'servedPMinutes', 'unservedPMinutes']); for (const value of Object.values(body!.totals)) number(value, 1e15); near(body!.totals.demandedPMinutes, body!.totals.servedPMinutes + body!.totals.unservedPMinutes); near(body!.totals.servedPMinutes, Object.values(body!.consumedPMinutes).reduce((sum, value) => sum + value, 0));
  const dispatch = body!.dispatch; if (dispatch === null) { need(state.tick === 0, '运行后不能删去真实供给分表重置资产'); need(Object.values(body!.consumedPMinutes).every(value => value === 0) && Object.values(body!.totals).every(value => value === 0), '未运行不得虚计'); return; }
  object(dispatch, ['tick', 'at', 'minutes', 'availableP', 'demandP', 'servedP', 'unservedP', 'curtailedP', 'sources', 'links', 'nodes', 'buildings', 'vehicles', 'diagnostics']);
  need(Number.isSafeInteger(dispatch.tick) && dispatch.tick >= 0 && dispatch.tick <= state.tick && finite(dispatch.at) && dispatch.at >= 0 && dispatch.at <= (state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60) + EPS && finite(dispatch.minutes) && dispatch.minutes > 0 && dispatch.minutes <= 4, '计量相位');
  for (const key of ['availableP', 'demandP', 'servedP', 'unservedP', 'curtailedP'] as const) number(dispatch[key], 1e12); need(dispatch.tick === state.tick && Math.abs(dispatch.at - (state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60)) <= EPS, '每实际tick保留当前能源分表'); near(dispatch.demandP, dispatch.servedP + dispatch.unservedP); near(dispatch.availableP, dispatch.servedP + dispatch.curtailedP);
  object(dispatch.sources, sourceIds); object(dispatch.links, grid.links.map(link => link.id)); object(dispatch.nodes, grid.nodes.map(node => node.id)); object(dispatch.buildings, world.buildings.map(site => site.id)); object(dispatch.vehicles, state.vehicles.map(vehicle => vehicle.id));
  let sourceTotal = 0, availableTotal = 0, meterDemand = 0, meterServed = 0;
  for (const source of grid.storage) { const meter = dispatch.sources[source.id]; object(meter, ['availableP', 'suppliedP', 'consumedPMinutes']); number(meter.availableP, source.maximumP); number(meter.suppliedP, meter.availableP + EPS); number(meter.consumedPMinutes); near(meter.consumedPMinutes, meter.suppliedP * dispatch.minutes); near(meter.availableP, Math.min(source.maximumP, (body!.storedPMinutes[source.id] + meter.consumedPMinutes) / dispatch.minutes)); need(meter.consumedPMinutes <= body!.consumedPMinutes[source.id] + EPS, '本相位不能超过累计消耗'); sourceTotal += meter.suppliedP; availableTotal += meter.availableP; }
  for (const [key, meters] of [['buildings', dispatch.buildings], ['vehicles', dispatch.vehicles]] as const) for (const [entityId, meter] of Object.entries(meters)) { object(meter, ['nodeId', 'demandP', 'servedP', 'unservedP', ...(key === 'vehicles' ? ['edgeId'] : [])]); if (key === 'vehicles') need(world.edges.some(edge => edge.id === (meter as GridVehicleMeter).edgeId), '交通分表必须保存派送时的真实边引用'); const expected = key === 'buildings' ? grid.buildings.find(item => item.buildingId === entityId)!.nodeId : grid.transport.find(item => item.edgeId === (meter as GridVehicleMeter).edgeId)?.nodeId ?? null; need(meter.nodeId === expected, '分表连接不得迁移'); number(meter.demandP, 1e9); if (key === 'buildings') { const declared = grid.buildings.find(item => item.buildingId === entityId)!; const shopCount = state.shops.filter(shop => shop.buildingId === entityId).length; const choices = [declared.baseP, declared.baseP + declared.nightP].flatMap(base => Array.from({ length: shopCount + 1 }, (_, open) => base + open * declared.shopP)); need(choices.some(demand => Math.abs(demand - meter.demandP) <= EPS), '实际分表需求必须是已声明配方'); } else near(meter.demandP, .08); number(meter.servedP, meter.demandP + EPS); number(meter.unservedP, meter.demandP + EPS); near(meter.demandP, meter.servedP + meter.unservedP); if (meter.nodeId === null) near(meter.servedP, 0); meterDemand += meter.demandP; meterServed += meter.servedP; }
  near(sourceTotal, dispatch.servedP); near(availableTotal, dispatch.availableP); near(meterServed, dispatch.servedP); near(meterDemand, dispatch.demandP);
  const offers = record<number>(), minimalOffers = record<number>(); for (const source of grid.storage) { offers[source.id] = dispatch.sources[source.id].availableP; minimalOffers[source.id] = Math.min(source.maximumP, body!.storedPMinutes[source.id] / 4); }
  const dispatchedLoads = [...Object.entries(dispatch.buildings).map(([id, meter]) => ({ id: 'building:' + id, nodeId: meter.nodeId, demandP: meter.demandP })), ...Object.entries(dispatch.vehicles).map(([id, meter]) => ({ id: 'vehicle:' + id, nodeId: meter.nodeId, demandP: meter.demandP }))];
  near(achievablePower(grid, offers, dispatchedLoads), dispatch.servedP);
  const elapsed = (state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60) - 480; need(elapsed >= -EPS, '声明网必须沿原480分钟起点的单调时钟'); const baseDemand = grid.buildings.reduce((sum, load) => sum + load.baseP, 0); need(body!.totals.demandedPMinutes + 1e-7 >= baseDemand * elapsed, '不能抹去连续基础用电');
  const minimalPower = achievablePower(grid, minimalOffers, grid.buildings.map(load => ({ id: load.buildingId, nodeId: load.nodeId, demandP: load.baseP }))); need(body!.totals.servedPMinutes + 1e-7 >= minimalPower * elapsed, '不能抹去有余电期间的真实消耗');
  for (const link of grid.links) need(finite(dispatch.links[link.id]) && Math.abs(dispatch.links[link.id]) <= (link.closed ? link.capacityP : 0) + EPS, '真实线缆容量与开关');
  for (const node of grid.nodes) { number(dispatch.nodes[node.id], node.capacityP + EPS); const input = grid.storage.filter(source => source.nodeId === node.id).reduce((sum, source) => sum + dispatch.sources[source.id].suppliedP, 0) + grid.links.reduce((sum, link) => sum + (link.to === node.id ? Math.max(0, dispatch.links[link.id]) : link.from === node.id ? Math.max(0, -dispatch.links[link.id]) : 0), 0); const output = [...Object.values(dispatch.buildings), ...Object.values(dispatch.vehicles)].filter(meter => meter.nodeId === node.id).reduce((sum, meter) => sum + meter.servedP, 0) + grid.links.reduce((sum, link) => sum + (link.from === node.id ? Math.max(0, dispatch.links[link.id]) : link.to === node.id ? Math.max(0, -dispatch.links[link.id]) : 0), 0); near(input, output); near(input, dispatch.nodes[node.id]); }
  object(dispatch.diagnostics, ['unconnectedBuildings', 'unconnectedVehicles', 'islandNodeIds', 'exhaustedStorageIds', 'constrainedLinkIds', 'constrainedNodeIds']);
  const references = { unconnectedBuildings: world.buildings.map(item => item.id), unconnectedVehicles: state.vehicles.map(item => item.id), islandNodeIds: grid.nodes.map(item => item.id), exhaustedStorageIds: sourceIds, constrainedLinkIds: grid.links.map(item => item.id), constrainedNodeIds: grid.nodes.map(item => item.id) };
  for (const [key, allowed] of Object.entries(references)) { const value = dispatch.diagnostics[key as keyof typeof references]; need(Array.isArray(value) && value.length <= allowed.length && new Set(value).size === value.length && value.every(item => allowed.includes(item)), '有界诊断引用'); }
  const reached = new Set(grid.storage.filter(source => dispatch.sources[source.id].availableP > EPS && grid.nodes.find(node => node.id === source.nodeId)!.capacityP > EPS).map(source => source.nodeId)), queue = [...reached];
  for (let q = 0; q < queue.length; q++) for (const link of grid.links.filter(link => link.closed && link.capacityP > EPS && (link.from === queue[q] || link.to === queue[q]))) { const next = link.from === queue[q] ? link.to : link.from; if (!reached.has(next) && grid.nodes.find(node => node.id === next)!.capacityP > EPS) { reached.add(next); queue.push(next); } }
  const expectedDiagnostics = { unconnectedBuildings: Object.keys(dispatch.buildings).filter(id => dispatch.buildings[id].nodeId === null).sort((a, b) => a.localeCompare(b)), unconnectedVehicles: Object.keys(dispatch.vehicles).filter(id => dispatch.vehicles[id].nodeId === null).sort((a, b) => a.localeCompare(b)), islandNodeIds: sorted(grid.nodes).filter(node => !reached.has(node.id)).map(node => node.id), exhaustedStorageIds: sorted(grid.storage).filter(source => body!.storedPMinutes[source.id] + dispatch.sources[source.id].consumedPMinutes <= EPS).map(source => source.id), constrainedLinkIds: sorted(grid.links).filter(link => link.closed && link.capacityP > EPS && Math.abs(dispatch.links[link.id]) >= link.capacityP - EPS).map(link => link.id), constrainedNodeIds: sorted(grid.nodes).filter(node => node.capacityP > EPS && dispatch.nodes[node.id] >= node.capacityP - EPS).map(node => node.id) };
  need(JSON.stringify(dispatch.diagnostics) === JSON.stringify(expectedDiagnostics), '诊断必须来自真实连接、容量与源库存');
}
/** Declared finite assets advance only through normal measured phases.
 * Native clock jumps would skip asset consumption and invalidate legal saves;
 * reject without mutation instead of fabricating dispatch history. */
export function powerGridCommandBoundary(world: WorldDefinition, command: Command): CommandResult | null {
  if (!world.powerGrid) return null;
  if (world.powerGrid.version === 2) {
    if (command.type === 'setTime') return { ok: false, message: '此地图使用有限双库水电，须按正常时间或倍率逐窗结算水量和用电，不能直接跳转时刻。' };
    if (['energy', 'requestEnergyRepair', 'approveEnergyRepair', 'cancelEnergy'].includes(command.type)) return { ok: false, message: '此地图使用声明的有限双库水电；补水、设备采购与维修工班尚未接入，未收费或新增资产。' };
    return null;
  }
  if (command.type === 'setTime') return { ok: false, message: '此地图使用有限储能电网，不能直接跳转时刻；请用正常时间推进或时间倍率，逐相位结算实际用电。' };
  if (['energy', 'requestEnergyRepair', 'approveEnergyRepair', 'cancelEnergy'].includes(command.type)) return { ok: false, message: '此地图使用声明的有限储能电网；燃料发电、合法采购与维修工班尚未接入，未收费或增电。' };
  return null;
}
export function installPowerGrid(simulation: Simulation): void {
  const world = simulation.worldDefinition;
  simulation.registerSaveValidator(candidate => validatePowerGridState(candidate, world));
  if (!world.powerGrid) return;
  simulation.state.powerGrid = createPowerGridState(world, simulation.state)!;
  if (world.powerGrid.version === 2) {
    simulation.registerStepPreflight((state, minutes, ticks) => prepareHydroBeforeStep(world, state, minutes, ticks));
    simulation.onBeforeTick((state, minutes) => prepareHydroBeforeTick(world, state, minutes));
    simulation.onLoad(() => bindHydroGridAfterLoad(world, simulation.state));
  }
  for (const shop of simulation.state.shops) shop.open = false;
  simulation.state.energy = 0; for (const district of simulation.state.districts) district.energy = 0;
  simulation.onPhase('energy', (_state, minutes) => {
    simulation.state.powerGrid = dispatchPowerGrid(world, simulation.state, minutes);
    if (simulation.state.powerGrid.version === 2) {
      const measured = simulation.state.powerGrid.dispatch!;
      for (const shop of simulation.state.shops) if (gridBuildingSupplyRatio(simulation.state, shop.buildingId) <= .25) shop.open = false;
      simulation.state.energy = measured.demandKW > EPS ? measured.servedKW / measured.demandKW * 100 : 0;
      for (const district of simulation.state.districts) {
        const meters = world.buildings.filter(site => site.districtId === district.id).map(site => measured.buildings[site.id]);
        const demand = meters.reduce((sum, meter) => sum + meter.demandKW, 0), served = meters.reduce((sum, meter) => sum + meter.servedKW, 0);
        district.energy = demand > EPS ? served / demand * 100 : 0;
      }
      return;
    }
    const dispatch = simulation.state.powerGrid.dispatch!;
    // Close immediately on this feeder's outage; reopening remains the
    // original commerce phase's scheduled/solvent/lifecycle decision.
    for (const shop of simulation.state.shops) if (gridBuildingSupplyRatio(simulation.state, shop.buildingId) <= .25) shop.open = false;
    simulation.state.energy = dispatch.demandP > EPS ? dispatch.servedP / dispatch.demandP * 100 : 0;
    for (const district of simulation.state.districts) { const meters = world.buildings.filter(site => site.districtId === district.id).map(site => dispatch.buildings[site.id]), demand = meters.reduce((sum, meter) => sum + meter.demandP, 0), served = meters.reduce((sum, meter) => sum + meter.servedP, 0); district.energy = demand > EPS ? served / demand * 100 : 0; }
  });
  simulation.registerCommandHandler(command => powerGridCommandBoundary(world, command));
}
