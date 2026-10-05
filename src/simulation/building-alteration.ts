import type { Building, Citizen, NetworkEdge, ResearchJob, SimState, Vec3, WorldDefinition } from '../types';
import { isRoadOpen, roadRevision } from '../roads';

/** A read-only check of a proposed change. A proposal never creates a road,
 * moves a resident, grants land ownership, or reserves a material/budget. */
export interface BuildingAlterationPlan {
  buildingId: string;
  relocateHomes?: { actorId: string; homeId: string }[];
  removeRoadIds?: string[];
  addRoads?: NetworkEdge[];
}
/** The core ledger is separate from extension.runtime. A headless reader can
 * supply the original save's runtime without instantiating a Simulation. */
export interface BuildingAlterationAccounts {
  payrollClaims: readonly { citizenId: string; shopId?: string | null; amount: number }[];
  committedPayroll: readonly { shopId: string; amount: number }[];
  freightLots: Readonly<Record<string, readonly { shopId: string | null; quantity: number }[]>>;
  cargoSources: Readonly<Record<string, string>>;
}
export interface BuildingProtection {
  kind: 'resident' | 'workplace' | 'occupant' | 'household' | 'pregnancy' | 'business' | 'lease' | 'stock' | 'consignment' | 'wage-debt' | 'service' | 'waste' | 'power';
  referenceId: string; actorIds: string[]; reason: string;
  amount?: number; units?: number;
}
export interface RelocationCheck {
  actorId: string; homeId: string; valid: boolean; reasons: string[];
  currentResidents: number; proposedResidents: number; capacity: number;
  reservedBirthPlaces: number;
  roadConnectedToWork: boolean; requiresActualConsent: true;
}
export interface BuildingAlterationReport {
  kind: 'read-only-building-preflight-v1'; executionAllowed: false;
  observed: { tick: number; at: number; seed: number; roadRevision: number };
  coreAccountingProvided: boolean;
  buildingId: string; buildingName: string | null;
  protections: BuildingProtection[]; relocations: RelocationCheck[];
  road: {
    scope: 'open-road-and-bridge-topology'; checksPhysicalDoorAccess: false;
    beforeComponents: number; proposedComponents: number;
    newlyDisconnectedActorIds: string[]; alreadyDisconnectedActorIds: string[];
    restoredActorIds: string[]; violations: string[];
  };
  blockers: string[]; limitations: string[];
}
const EPS = 1e-7;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const point = (p: Vec3) => !!p && finite(p.x) && finite(p.y) && finite(p.z);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const walking = (edge: NetworkEdge) => edge.mode === 'road' || edge.mode === 'bridge';
const living = (state: SimState, id: string) => state.extension?.actorProfiles[id]?.alive !== false;
const currentTime = (state: SimState) => state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
const terminal = (status: string) => ['completed', 'cancelled', 'fulfilled', 'rejected'].includes(status);

function nearestNode(world: WorldDefinition, position: Vec3): string | null {
  let id: string | null = null, best = Infinity;
  // Preserve the core's first-in-world nearest-node tie contract.
  for (const node of world.nodes) { const d = distance(position, node.position); if (d < best) { best = d; id = node.id; } }
  return id;
}
function components(world: WorldDefinition, edges: readonly NetworkEdge[]): { count: number; connected(a: string | null, b: string | null): boolean } {
  const parents = new Map(world.nodes.map(n => [n.id, n.id]));
  const root = (id: string): string => { let current = id; while (parents.get(current) !== current) current = parents.get(current)!; return current; };
  let count = parents.size;
  for (const edge of edges) {
    if (!parents.has(edge.from) || !parents.has(edge.to)) continue;
    const a = root(edge.from), b = root(edge.to); if (a !== b) { parents.set(a, b); count--; }
  }
  return { count, connected: (a, b) => !!a && !!b && parents.has(a) && parents.has(b) && root(a) === root(b) };
}
function local(site: Building, p: Vec3): Vec3 {
  const dx = p.x - site.position.x, dz = p.z - site.position.z;
  return { x: dx * Math.cos(site.rotation) - dz * Math.sin(site.rotation), y: p.y - site.position.y, z: dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation) };
}
function bounds(site: Building) {
  const width = Math.max(site.width, ...(site.floorFootprints ?? []).map(f => f.width));
  const depth = Math.max(site.depth, ...(site.floorFootprints ?? []).map(f => f.depth));
  return { x: width / 2, z: depth / 2, low: -(site.basements ?? 0) * site.height / Math.max(1, site.floors), high: site.height };
}
function inside(site: Building, position: Vec3): boolean {
  const p = local(site, position), b = bounds(site);
  return Math.abs(p.x) <= b.x && Math.abs(p.z) <= b.z && p.y >= b.low && p.y <= b.high;
}
/** Conservative segment/occupied-box intersection, including road half width.
 * An overpass above the roof does not collide merely because its map line does. */
function roadIntersectsBuilding(edge: NetworkEdge, site: Building): boolean {
  const b = bounds(site), radius = edge.mode === 'bridge' ? 4.5 : 5;
  for (let i = 1; i < edge.points.length; i++) {
    const a = local(site, edge.points[i - 1]), z = local(site, edge.points[i]);
    let enter = 0, leave = 1;
    for (const [first, last, low, high] of [[a.x, z.x, -b.x - radius, b.x + radius], [a.y, z.y, b.low, b.high], [a.z, z.z, -b.z - radius, b.z + radius]]) {
      const d = last - first;
      if (d === 0) { if (first < low || first > high) { enter = 1; leave = 0; break; } }
      else { const t1 = (low - first) / d, t2 = (high - first) / d; enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2)); }
    }
    if (enter <= leave) return true;
  }
  return false;
}
function roadPlan(world: WorldDefinition, state: SimState, plan: BuildingAlterationPlan) {
  const violations: string[] = [], removed = new Set<string>(), additions: NetworkEdge[] = [];
  const remove = plan.removeRoadIds ?? [], add = plan.addRoads ?? [];
  if (!Array.isArray(remove) || remove.length > 256 || !Array.isArray(add) || add.length > 256) violations.push('道路方案须为各不超过256项的数组。');
  else {
    for (const id of remove) {
      if (typeof id !== 'string' || removed.has(id) || !world.edges.some(e => e.id === id && walking(e))) violations.push('移除道路标识重复、未知或不是道路/桥梁：' + String(id));
      else removed.add(id);
    }
    const ids = new Set(world.edges.map(e => e.id)), nodes = new Map(world.nodes.map(n => [n.id, n]));
    for (const edge of add) {
      if (!edge || typeof edge.id !== 'string' || !edge.id.length || edge.id.length > 120 || ids.has(edge.id) || !walking(edge)
        || !nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to || !finite(edge.capacity) || edge.capacity <= 0
        || !finite(edge.length) || edge.length <= 0 || !Array.isArray(edge.points) || edge.points.length < 2 || edge.points.length > 256 || !edge.points.every(point)) {
        violations.push('拟建道路身份、端点、容量或折线无效：' + String(edge?.id)); continue;
      }
      ids.add(edge.id);
      const length = edge.points.slice(1).reduce((sum, p, i) => sum + distance(edge.points[i], p), 0);
      if (distance(edge.points[0], nodes.get(edge.from)!.position) > EPS || distance(edge.points.at(-1)!, nodes.get(edge.to)!.position) > EPS || Math.abs(length - edge.length) > EPS * Math.max(1, length)) {
        violations.push('拟建道路折线必须精确连接原节点且长度使用真实三维折线：' + edge.id); continue;
      }
      const conflicts = world.buildings.filter(site => roadIntersectsBuilding(edge, site)).map(site => site.id);
      if (conflicts.length) { violations.push('拟建道路与尚未拆除建筑占地相交：' + edge.id + ' → ' + conflicts.join('、')); continue; }
      additions.push(edge);
    }
  }
  const open = world.edges.filter(e => walking(e) && isRoadOpen(state, e.id));
  // Invalid geometry is never allowed to repair an apparent disconnection.
  const proposed = open.filter(e => !removed.has(e.id)).concat(additions);
  return { before: components(world, open), after: components(world, proposed), violations };
}

export function inspectBuildingAlteration(world: WorldDefinition, state: SimState, plan: BuildingAlterationPlan, accounts?: BuildingAlterationAccounts): BuildingAlterationReport {
  const site = world.buildings.find(b => b.id === plan.buildingId);
  const report: BuildingAlterationReport = {
    kind: 'read-only-building-preflight-v1', executionAllowed: false,
    observed: { tick: state.tick, at: currentTime(state), seed: world.seed, roadRevision: roadRevision(state) },
    coreAccountingProvided: accounts !== undefined,
    buildingId: plan.buildingId, buildingName: site?.name ?? null, protections: [], relocations: [],
    road: { scope: 'open-road-and-bridge-topology', checksPhysicalDoorAccess: false, beforeComponents: 0, proposedComponents: 0, newlyDisconnectedActorIds: [], alreadyDisconnectedActorIds: [], restoredActorIds: [], violations: [] },
    blockers: [], limitations: ['只检查开放道路/桥梁图；不证明门口净空、动态体素、楼内路线、公交、坡度承载或防灾疏散。', '拟建路占地按声明楼层外包围体及既有道路半宽保守检查，不替代完整结构/地质审批。', '当前无土地建筑完整产权登记；报告不能授予拆迁权，不能代签迁居意愿或结清任何账户。'],
  };
  if (!accounts) report.limitations.push('未提供核心运行账：未核验核心已赚工资债、已承诺工资和运输货权；不能把缺失数据当作没有债或货。');
  if (!site) { report.blockers.push('目标建筑不存在。'); return report; }
  const protect = (kind: BuildingProtection['kind'], referenceId: string, actorIds: string[], reason: string, amounts: Pick<BuildingProtection, 'amount' | 'units'> = {}) => report.protections.push({ kind, referenceId, actorIds: [...actorIds], reason, ...amounts });
  const citizens = state.citizens.filter(c => living(state, c.id));
  const residents = citizens.filter(c => c.homeId === site.id);
  for (const person of residents) protect('resident', person.id, [person.id], '仍有实际居住登记，须本人同意并完成合法安置。');
  if (state.player.homeId === site.id && living(state, 'player')) protect('resident', 'player', ['player'], '玩家现租住登记仍有效。');
  for (const person of citizens.filter(c => c.workId === site.id && c.role !== '幼儿')) protect('workplace', person.id, [person.id], person.role === '学生' ? '在册学生须保留可达学校和教育记录。' : '在册岗位、工资和就业不能随拆除消失。');
  for (const person of [...citizens, ...(living(state, 'player') ? [{ id: 'player', position: state.player.position }] : [])]) if (inside(site, person.position)) protect('occupant', person.id, [person.id], '身体仍在建筑占用空间内，须真实离场。');
  for (const home of state.family?.households ?? []) if (home.homeId === site.id && (home.closedAt === null || home.balance > EPS)) protect('household', home.id, home.actorIds, '共同住所及家庭现金权利仍未结清。', { amount: home.balance });
  for (const pregnancy of state.family?.pregnancies ?? []) if (pregnancy.homeId === site.id && (living(state, pregnancy.carrierId) || pregnancy.escrow > EPS)) protect('pregnancy', pregnancy.id, pregnancy.parentIds, '孕育住所及扶养托管不能因施工删除。', { amount: pregnancy.escrow });
  for (const [id, child] of Object.entries(state.family?.children ?? {})) if (living(state, id) && (child.homeId === site.id || child.schoolId === site.id)) protect('household', 'child:' + id, [id, ...child.parentIds], '子女住所及正式学校登记须与真实居民迁居共同变更。');
  const shops = state.shops.filter(s => s.buildingId === site.id), shopIds = new Set(shops.map(s => s.id));
  for (const shop of shops) {
    const title = state.shopLifecycle?.titles[shop.id];
    protect('business', shop.id, [shop.ownerId ?? 'unrecorded'], title ? '经营资产与同址使用许可必须依法处理；该许可不等于整栋产权。' : '原经营资产与工资义务仍存在，关门不等于无主。', { amount: shop.cash ?? 0 });
    if (shop.inventory > EPS || (title?.materialsHeld ?? 0) > EPS) protect('stock', shop.id, [], '真实库存及留置修缮材料须保留货权与去向。', { units: shop.inventory + (title?.materialsHeld ?? 0) });
  }
  for (const lease of state.shopLifecycle?.leases ?? []) if (shopIds.has(lease.shopId) && (lease.state !== 'ended' || lease.arrears > EPS || lease.depositEscrow > EPS || lease.advanceInitial - lease.advanceRefunded > EPS)) protect('lease', lease.id, [lease.lessorId, lease.tenantId], '同址租约、欠租、押金或未返垫款尚有权利。', { amount: lease.arrears + lease.depositEscrow + lease.advanceInitial - lease.advanceRefunded });
  for (const company of state.extension?.companies ?? []) if (company.buildingId === site.id && company.shopBindingReleasedAt === undefined) protect('business', company.id, Object.keys(company.shareholders), '公司资本、股份和原经营场址必须保留。', { amount: company.capital });
  for (const [destination, lots] of Object.entries(state.trade?.lots ?? {})) for (const lot of lots) if (lot.quantity > EPS && (shopIds.has(destination) || shopIds.has(lot.supplierId))) protect('consignment', lot.id, [lot.supplierId], '寄售原货权仍在柜台或待结算，不可随场址删除。', { units: lot.quantity });
  for (const [index, debt] of (accounts?.payrollClaims ?? []).entries()) if (debt.shopId && shopIds.has(debt.shopId) && debt.amount > EPS) protect('wage-debt', debt.shopId + ':' + debt.citizenId + ':' + index, [debt.citizenId], '已赚工资债仍须由原经营账户承担。', { amount: debt.amount });
  for (const commitment of accounts?.committedPayroll ?? []) if (shopIds.has(commitment.shopId) && commitment.amount > EPS) protect('wage-debt', commitment.shopId + ':committed', [], '原已承诺且尚未赚取的岗位工资预算仍受保护。', { amount: commitment.amount });
  for (const [districtId, lots] of Object.entries(accounts?.freightLots ?? {})) for (const [index, lot] of lots.entries()) if (lot.shopId && shopIds.has(lot.shopId) && lot.quantity > EPS) protect('consignment', 'freight:' + districtId + ':' + index, [lot.shopId], '原来源货权仍在真实到货队列，不随拆迁改成匿名货。', { units: lot.quantity });
  for (const [vehicleId, supplierId] of Object.entries(accounts?.cargoSources ?? {})) {
    const vehicle = state.vehicles.find(v => v.id === vehicleId);
    if (shopIds.has(supplierId) && vehicle && vehicle.cargo > EPS) protect('consignment', vehicleId, [supplierId], '有限货物仍在实际载具中，来源经营主体及交付权必须保留。', { units: vehicle.cargo });
  }
  for (const order of state.clinical?.orders ?? []) if (order.siteId === site.id && (!terminal(order.state) || order.escrow > EPS)) protect('service', order.id, [order.patientId, order.payerId], '诊疗、退款和已采购物料合同仍有效。', { amount: order.escrow });
  for (const course of [state.education?.course, ...(state.familyEducation?.active ?? []), ...(state.residentEducation?.active ?? [])]) if (course && course.siteId === site.id && (!terminal(course.status) || course.escrow > EPS)) protect('service', course.id, [course.actorId, course.payerId], '教学、退款和教材合同仍有效。', { amount: course.escrow });
  for (const order of state.culture?.orders ?? []) if (order.siteId === site.id && !terminal(order.state)) protect('service', order.id, [], '已备案公共服务及有限预算仍须继续或依法结清。', { amount: Math.max(0, order.authorizedCap - order.spent) });
  const extensionRuntime = state.extension && Reflect.get(state.extension, 'runtime') as { researchJobs?: Record<string, ResearchJob>; constructionJobs?: Record<string, { completedAt: number | null; materialUnits: number; consumedUnits: number }> } | undefined;
  for (const [sector, research] of Object.entries(extensionRuntime?.researchJobs ?? {})) if (research.laborVersion === 1 && research.siteId === site.id) protect('service', 'research:' + sector, [research.actorId], '已付科研合同仍绑定原场址和实际出勤记录。', { amount: research.budget });
  for (const company of state.extension?.companies ?? []) {
    const construction = extensionRuntime?.constructionJobs?.[company.id];
    if (company.buildingId === site.id && construction && construction.completedAt === null) protect('service', 'construction:' + company.id, [company.ownerId], '原有限公司扩建材料和未完成现场劳动须处理。', { units: construction.materialUnits - construction.consumedUnits });
  }
  for (const [kind, stocks] of [['clinical', state.clinical?.stock], ['education', state.education?.stock], ['family-education', state.familyEducation?.stock], ['resident-education', state.residentEducation?.stock], ['hygiene', state.hygiene?.stock]] as const) {
    const stock = stocks?.[site.id]; if (stock && stock.availableUnits > EPS) protect('stock', kind + ':' + site.id, [], '已采购且仍可用的服务物料须保留原库存与来源。', { units: stock.availableUnits });
  }
  if (state.playerLabor?.job?.siteId === site.id) protect('service', state.playerLabor.job.id, ['player'], '现场劳动合同与未赚工资托管仍有效。', { amount: state.playerLabor.job.escrow });
  if (state.homeRest?.session?.buildingId === site.id && !terminal(state.homeRest.session.state)) protect('service', state.homeRest.session.id, ['player'], '正在使用的床旁休息位置和实际身体须先退出。');
  for (const job of state.hygiene?.jobs ?? []) if (job.siteId === site.id && (!terminal(job.state) || job.escrow > EPS)) protect('service', job.id, [], '用品封存处理合同、物料和未退托管仍在原站点。', { amount: job.escrow });
  for (const batch of state.hygiene?.batches ?? []) if (batch.siteId === site.id && batch.containedUnits + batch.reservedUnits + batch.cleaningResidualUnits > EPS) protect('waste', batch.id, [], '用后用品、封存物及清理残留须保持真实容器/转运去向。', { units: batch.containedUnits + batch.cleaningResidualUnits });
  for (const task of state.hygiene?.transfers?.tasks ?? []) {
    const source = state.hygiene?.batches.find(b => b.id === task.batchId);
    if ((task.destinationSiteId === site.id || source?.siteId === site.id) && (!['received', 'cancelled'].includes(task.state) || task.escrow > EPS)) protect('waste', task.id, ['player'], '用品转运的原来源、目标容器、货物或未退托管仍须处理。', { amount: task.escrow });
  }
  for (const storage of world.powerGrid?.storage ?? []) if (storage.buildingId === site.id) protect('power', storage.id, [], '有限储能源及供电连接须保留，不能因改造免费补充。', { units: state.powerGrid?.storedPMinutes[storage.id] ?? storage.initialStoredPMinutes });
  for (const load of world.powerGrid?.buildings ?? []) if (load.buildingId === site.id) protect('power', site.id, [], '建筑用电表及馈线连接仍绑定当前场址。');

  const topology = roadPlan(world, state, plan), nodes = new Map(world.buildings.map(b => [b.id, nearestNode(world, b.door)]));
  report.road.beforeComponents = topology.before.count; report.road.proposedComponents = topology.after.count; report.road.violations = topology.violations;
  const relocations = plan.relocateHomes ?? [], proposed = new Map<string, string>();
  if (!Array.isArray(relocations) || relocations.length > state.citizens.length + 1) report.blockers.push('安置方案数组无效或超出真实人口。');
  else for (const row of relocations) {
    const person: Citizen | SimState['player'] | undefined = row?.actorId === 'player' ? state.player : citizens.find(c => c.id === row?.actorId);
    const home = world.buildings.find(b => b.id === row?.homeId), reasons: string[] = [];
    if (!person || !living(state, row.actorId) || person.homeId !== site.id || proposed.has(row.actorId)) reasons.push('须为目标楼真实在住活居民，且每人仅列一次。');
    if (!home || home.kind !== 'home' || home.id === site.id) reasons.push('须使用另一栋现有住宅，不能安置到拆迁目标或虚构房屋。');
    if (!reasons.length) proposed.set(row.actorId, row.homeId);
    report.relocations.push({ actorId: row?.actorId ?? '', homeId: row?.homeId ?? '', valid: !reasons.length, reasons, currentResidents: 0, proposedResidents: 0, reservedBirthPlaces: 0, capacity: home?.capacity ?? 0, roadConnectedToWork: false, requiresActualConsent: true });
  }
  const homeCounts = new Map<string, number>();
  for (const person of citizens) homeCounts.set(person.homeId, (homeCounts.get(person.homeId) ?? 0) + 1);
  if (state.player.homeId && living(state, 'player')) homeCounts.set(state.player.homeId, (homeCounts.get(state.player.homeId) ?? 0) + 1);
  const incoming = new Map<string, number>(); for (const homeId of proposed.values()) incoming.set(homeId, (incoming.get(homeId) ?? 0) + 1);
  const birthPlaces = new Map<string, number>();
  for (const pregnancy of state.family?.pregnancies ?? []) if (living(state, pregnancy.carrierId)) {
    const destination = proposed.get(pregnancy.carrierId) ?? pregnancy.homeId;
    birthPlaces.set(destination, (birthPlaces.get(destination) ?? 0) + 1);
  }
  for (const row of report.relocations) {
    row.currentResidents = homeCounts.get(row.homeId) ?? 0; row.proposedResidents = row.currentResidents + (incoming.get(row.homeId) ?? 0);
    row.reservedBirthPlaces = birthPlaces.get(row.homeId) ?? 0;
    if (row.proposedResidents + row.reservedBirthPlaces > row.capacity) row.reasons.push('目标住宅现有人口、全部拟迁入人口及真实孕期预留超出真实容量。');
    for (const home of state.family?.households ?? []) if (home.closedAt === null && home.homeId === site.id && home.actorIds.includes(row.actorId) && home.actorIds.some(id => proposed.get(id) !== row.homeId)) row.reasons.push('有效共同住所须双方依法同意并一起安置，单人方案不能割裂共同账户。');
    const person = citizens.find(c => c.id === row.actorId);
    row.roadConnectedToWork = row.actorId === 'player' ? true : !!person && topology.after.connected(nodes.get(row.homeId) ?? null, nodes.get(person.workId) ?? null);
    if (!row.roadConnectedToWork) row.reasons.push('拟安置住宅与原岗位/学校在拟议开放道路桥梁图上不连通。');
    row.valid = row.reasons.length === 0;
  }
  // A failed relocation never counts as a repaired commute in the graph result.
  for (const row of report.relocations) if (!row.valid) proposed.delete(row.actorId);
  for (const person of citizens) {
    const was = topology.before.connected(nodes.get(person.homeId) ?? null, nodes.get(person.workId) ?? null);
    const after = topology.after.connected(nodes.get(proposed.get(person.id) ?? person.homeId) ?? null, nodes.get(person.workId) ?? null);
    if (!was) report.road.alreadyDisconnectedActorIds.push(person.id);
    if (was && !after) report.road.newlyDisconnectedActorIds.push(person.id);
    if (!was && after) report.road.restoredActorIds.push(person.id);
  }
  if (report.protections.length) report.blockers.push('仍有住户、身体、权利、物资或服务保护项；拟议安置不等于已经迁居或本人同意。');
  if (report.relocations.some(r => !r.valid)) report.blockers.push('拟议安置存在容量、身份或道路连通错误。');
  if (report.road.violations.length) report.blockers.push('道路方案存在非法身份、几何或未清占地。');
  if (report.road.newlyDisconnectedActorIds.length) report.blockers.push('道路方案会切断目前实际连通的居民住所—岗位/学校关系。');
  report.blockers.push('当前经营/租住使用权不授予整栋土地建筑拆迁权；建筑产权登记及法定补偿尚未接通。', '未有实际施工资金托管、有限材料采购与现场劳动，不得执行拆除或免费建路。', '建筑/道路统一版本、缓存重建和可恢复变更执行尚未接通。');
  return report;
}

/** The same detached report can be presented in a terminal, 2D map or 3D UI. */
export function buildingAlterationSummary(report: BuildingAlterationReport): string[] {
  const counts = new Map<string, number>(); for (const item of report.protections) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const labels: Record<BuildingProtection['kind'], string> = { resident: '在住居民', workplace: '岗位/学生', occupant: '楼内身体', household: '家庭账户', pregnancy: '孕育住所', business: '经营权', lease: '租赁权利', stock: '库存', consignment: '寄售货权', 'wage-debt': '工资债', service: '服务合同', waste: '用品/残留', power: '供电资产' };
  return [report.buildingName ? `${report.buildingName} · 现状检查` : '目标建筑不存在',
    [...counts].map(([kind, count]) => `${labels[kind as BuildingProtection['kind']]} ${count}`).join(' · ') || '未发现所检查的占用项，仍需法定产权及实际施工条件。',
    `道路桥梁图：新增断连 ${report.road.newlyDisconnectedActorIds.length} 人，原已断连 ${report.road.alreadyDisconnectedActorIds.length} 人；门口步行净空、公交和楼内路线须另核验。`,
    ...report.blockers];
}
