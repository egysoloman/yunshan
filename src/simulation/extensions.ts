import type { Simulation } from '../simulation';
import { canAccessFloor, getFloorDimensions } from '../access';
import { blocksFloorPlanMovement, floorPlanSupport, getBuildingBody } from '../architecture-floor-plan';
import { getWalkHeight } from '../world';
import { homeRestPointAt, homeRestPointBlockedByVoxels } from './home-rest';
import { beginClinicalTreatment, clinicalAtPosition } from './clinical';
import { publicFloor } from './culture';
import { claimActorActivityMinutes } from './activity-minutes';
import type { AuditCase, Building, BuildingFunctionPoint, CityExtensionState, Command, CommandResult, Company, LifeProfile, Player, ResearchJob, AttendedResearchJob, Role, SimState, Technology, Vec3, WorldDefinition } from '../types';

export const TECHNOLOGY_SECTORS = ['traffic', 'energy', 'information', 'security', 'medicine', 'agriculture', 'manufacturing'] as const;
export const INGREDIENTS = { grain: 8, vegetable: 6, fish: 14 } as const;
export const RECIPES = {
  rice: { name: '山居菜饭', minutes: 30, heat: 60, ingredients: { grain: 2, vegetable: 1 }, nutrition: 36 },
  fishSoup: { name: '清溪鱼汤', minutes: 45, heat: 45, ingredients: { fish: 1, vegetable: 2 }, nutrition: 44 },
  festivalMeal: { name: '云山团圆宴', minutes: 60, heat: 70, ingredients: { grain: 2, fish: 1, vegetable: 2 }, nutrition: 60 },
} as const;
type Sector = Technology['sector'];
type Recipe = keyof typeof RECIPES;
interface ConstructionJob { startedAt: number; requiredMinutes: 60; workedMinutes: number; budget: number; materialCost: number; fee: number; materialUnits: number; consumedUnits: number; completedAt: number | null; lots: { supplierId: string; quantity: number; gross: number; net: number; unitPrice?: number }[] }
interface ExtensionRuntime {
  version: 1;
  nextCompanyAt: number;
  nextCorruptionAt: number;
  nextLedgerAt: number;
  lastTreasury: number;
  cooldowns: Record<string, number>;
  researchJobs: Partial<Record<Sector, ResearchJob>>;
  researchLaborVersion?: 1;
  legacyResearchSectors?: Sector[];
  companyCursors: Record<string, { revenue: number; profit: number }>;
  deprivation: Record<string, number>;
  diversions: Record<string, number>;
  constructionJobs?: Record<string, ConstructionJob>;
}
type Extension = CityExtensionState & { runtime: ExtensionRuntime };
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const dictionary = (n: unknown): n is Record<string, any> => !!n && typeof n === 'object' && !Array.isArray(n);
const sectorNames: Record<Sector, string> = { traffic: '交通', energy: '能源', information: '信息', security: '治安', medicine: '医疗', agriculture: '农业', manufacturing: '制造' };
export interface ResearchProgressInfo { actorId: string; siteId: string | null; legacy: boolean; workedMinutes: number | null; remainingMinutes: number; state: 'active' | 'paused'; pauseReason: string }
/** Read-only presentation data. New jobs never infer work from finishAt. */
export function researchProgressInfo(state: Pick<SimState, 'extension'>, sector: Sector): ResearchProgressInfo | null {
  const extension = state.extension as Extension | undefined, job = extension?.runtime?.researchJobs[sector];
  if (!extension || !job) return null;
  return job.laborVersion === 1
    ? { actorId: job.actorId, siteId: job.siteId, legacy: false, workedMinutes: job.workedMinutes, remainingMinutes: Math.max(0, 120 - job.workedMinutes), state: job.state, pauseReason: job.pauseReason }
    : { actorId: job.actorId ?? 'player', siteId: null, legacy: true, workedMinutes: null, remainingMinutes: Math.max(0, job.finishAt - extension.lastUpdate), state: 'active', pauseReason: '' };
}
/** Only an activity capable of using this actor at its actual site conflicts.
 * Kept callbacks read-only so Simulation and UI query the same status rules. */
export function researchPlayerContextReason(state: SimState, world: WorldDefinition, atSite: (site: Building, purpose?: BuildingFunctionPoint['purpose']) => boolean, phaseMinutes = 0): string {
  const player = state.player, identities = [player.role, ...(player.identities ?? [])], work = state.playerLabor?.job;
  const end = state.hour * 60, start = end - Math.max(0, phaseMinutes), workOpen = phaseMinutes > 0
    ? Math.max(0, Math.min(end, 21 * 60) - Math.max(start, 6 * 60)) > 0 : state.hour >= 6 && state.hour < 21;
  const workSite = work && world.buildings.find(site => site.id === work.siteId);
  if (work && ['working', 'paused'].includes(work.status) && workSite && workOpen && identities.includes(work.role) && player.needs.hunger >= 12 && player.needs.fatigue >= 15 && atSite(workSite, 'work')) return '当前现场有未结束工班，不能重复使用劳动时间。';
  const rest = state.homeRest?.session, home = rest && world.buildings.find(site => site.id === rest.buildingId);
  if (rest?.state === 'active' && home && player.homeId === home.id && homeRestPointAt(home, player.position, player, rest.pointId)) return '正在原床侧休息，不能重复使用劳动时间。';
  if (state.clinical?.orders.some(order => order.patientId === 'player' && ['awaitingSupply', 'awaitingDoctor', 'inTreatment'].includes(order.state) && (() => { const site = world.buildings.find(site => site.id === order.siteId); return !!site && clinicalAtPosition(site, player.position, player); })())) return '正在原诊疗站点参与治疗，请先离开或结束。';
  const project = state.culture?.project, studio = project && world.buildings.find(site => site.id === project.siteId);
  const publicAt = (site: Building) => publicFloor(site, Math.floor((player.position.y - site.position.y + .01) / (site.height / site.floors))) && atSite(site);
  if (project && project.workedMinutes < project.requiredMinutes && studio && state.hour >= 7 && state.hour < 22 && player.needs.hunger >= 40 && player.needs.fatigue >= 40 && publicAt(studio)) return '正在原公共场所创作，不能重复使用劳动时间。';
  const service = state.culture?.orders.find(order => order.id === state.culture?.playerServiceId), serviceSite = service && world.buildings.find(site => site.id === service.siteId);
  if (service?.state === 'active' && service.topic !== 'transport' && !service.servedIds.includes('player') && serviceSite && state.hour >= 8 && state.hour < 17 && player.needs.hunger >= 40 && player.needs.fatigue >= 35 && publicAt(serviceSite)) return '正在原公共服务站点参与服务，不能重复使用劳动时间。';
  return '';
}
/** Fine processing belongs only to saved new tasks, never to visual tier. */
export function researchTaskActorIds(state: Pick<SimState, 'extension'>): ReadonlySet<string> {
  const runtime = (state.extension as Extension | undefined)?.runtime;
  return new Set(Object.values(runtime?.researchJobs ?? {}).filter((job): job is AttendedResearchJob => job?.laborVersion === 1 && job.actorId !== 'player').map(job => job.actorId));
}
const handled = new Set<Command['type']>(['foundCompany', 'expandCompany', 'listCompany', 'buyShares', 'sellShares', 'acquireCompany', 'hire', 'research', 'cook', 'buyIngredient', 'eat', 'audit', 'reportCorruption', 'investigate', 'heal', 'joinOrganization', 'donate', 'attendFestival', 'appoint']);

/** Subscribes to the original ten phases. All timers and accounting cursors are saved. */
export function installExtensions(simulation: Simulation): (minutes: number) => void {
  const world = simulation.worldDefinition;
  const buildings = new Map(world.buildings.map(b => [b.id, b]));
  const districts = new Set(world.districts.map(d => d.id));
  let actorIds = new Set(['player', ...simulation.state.citizens.map(c => c.id)]);
  let citizensById = new Map(simulation.state.citizens.map(c => [c.id, c]));
  let mappedState = simulation.state;
  const state = () => simulation.state;
  const citizens = () => { if (mappedState !== state() || citizensById.size !== state().citizens.length) { mappedState = state(); citizensById = new Map(mappedState.citizens.map(c => [c.id, c])); actorIds = new Set(['player', ...citizensById.keys()]); } return citizensById; };
  const ext = () => state().extension as Extension;
  const initialize = (): Extension => {
    const s = state(), at = s.day * 1440 + s.hour * 60;
    const profiles: Record<string, LifeProfile> = {};
    profiles.player = { age: 24, health: 100, mood: 75, stress: 12, alive: true, skill: clamp(s.player.education * 8), family: s.player.partnerId ? [s.player.partnerId] : [], historyTags: ['星际来客'] };
    for (let i = 0; i < s.citizens.length; i++) {
      const c = s.citizens[i];
      profiles[c.id] = { age: 20 + i % 45, health: 82 + i % 19, mood: 65 + i % 20, stress: 18 + i % 15, alive: true, skill: c.skills?.craft ?? 20, family: c.partnerId ? [c.partnerId] : [], historyTags: [...(c.historyTags ?? ['云山居民'])] };
    }
    const e: Extension = {
      version: 1, companies: [], technologies: TECHNOLOGY_SECTORS.map(sector => ({ sector, level: 0, progress: 0, funding: 0, sideEffect: 0 })), audits: [], actorProfiles: profiles, publicLedger: [], cooking: null,
      organizations: [
        { id: 'org-guild', name: '云山百工会', kind: 'guild', members: s.citizens.filter(c => c.socialIdentities?.includes('guildMember')).slice(0, 48).map(c => c.id), reputation: 50, funds: 0 },
        { id: 'org-relief', name: '清溪互助社', kind: 'charity', members: s.citizens.filter((_, i) => i % 11 === 0).slice(0, 48).map(c => c.id), reputation: 60, funds: 0 },
        { id: 'org-culture', name: '文澜诗乐社', kind: 'culture', members: s.citizens.filter(c => ['老师', '学生', 'teacher', 'scientist'].includes(c.role)).slice(0, 48).map(c => c.id), reputation: 55, funds: 0 },
      ],
      environment: { waterQuality: 88, biodiversity: 82, stormRisk: 0, disasterAt: at + 1440, lastDisaster: '' },
      institutions: { education: 55, medical: 62, welfare: 45, culture: 58 }, lastUpdate: at, nextCompanyId: 1, nextAuditId: 1,
      stats: { mealsCooked: 0, researchCompleted: 0, corruptionRecovered: 0, donations: 0, festivals: 0 },
      runtime: { version: 1, nextCompanyAt: at + 60, nextCorruptionAt: at + 120, nextLedgerAt: at + 60, lastTreasury: s.treasury, cooldowns: {}, researchJobs: {}, researchLaborVersion: 1, legacyResearchSectors: [], companyCursors: {}, deprivation: {}, diversions: {}, constructionJobs: {} },
    };
    // Existing businesses provide counterparties; seed capital comes from a real
    // proprietor, and the core shop remains the sole authority for trade receipts.
    for (const shop of s.shops.filter((_, i) => i % 7 === 6).slice(0, 12)) {
      const proprietor = s.citizens.find(c => c.workId === shop.buildingId) ?? s.citizens.find(c => c.districtId === shop.districtId);
      if (!proprietor) continue;
      const capital = Math.min(80, proprietor.money * .2); proprietor.money -= capital;
      const company: Company = { id: `company-${e.nextCompanyId++}`, name: `${buildings.get(shop.buildingId)!.name}商社`, ownerId: proprietor.id, buildingId: shop.buildingId, districtId: shop.districtId, capital, shares: 1000, sharePrice: .5, listed: false, employees: shop.employees, inventory: shop.inventory, revenue: 0, profit: 0, level: 1, marketShare: 0, shareholders: { [proprietor.id]: 1000 }, foundedAt: at, parentId: null };
      e.companies.push(company); e.runtime.companyCursors[company.id] = { revenue: shop.revenue, profit: shop.profit };
    }
    return e;
  };
  state().extension = initialize();
  const record = (actorId: string, amount: number, purpose: string, districtId: string, account: 'public' | 'company' | 'household' = 'public') => {
    const e = ext(); e.publicLedger.push({ tick: state().tick, actorId, amount, purpose, account, districtId });
    if (e.publicLedger.length > 512) e.publicLedger.splice(0, e.publicLedger.length - 512);
  };
  const publicFunds = (actor: string, amount: number, purpose: string, district: string) => { state().treasury = clamp(state().treasury + amount, 0, 1e12); ext().runtime.lastTreasury += amount; record(actor, amount, purpose, district); };
  const notice = (type: string, text: string, districtId?: string) => { simulation.appendNotice(type, text, districtId); simulation.emitEvent({ type: `extension:${type}`, districtId }); };
  const role = (...roles: Role[]) => roles.some(r => simulation.hasIdentity(r));
  const atBuilding = (b: typeof world.buildings[number]) => simulation.isNearBuilding(b) && canAccessFloor(b, Math.floor((state().player.position.y - b.position.y + .01) / (b.height / Math.max(1, b.floors))), state().player);
  const atFunctionPoint = (b: Building, purpose: BuildingFunctionPoint['purpose'], position = state().player.position, person: Pick<Player, 'role' | 'identities'> = state().player) => !getBuildingBody(b) || simulation.isAtBuildingFunctionPoint(b, position, purpose, person);
  const nearby = (kinds: string[], id?: string, facilities: string[] = [], purpose?: BuildingFunctionPoint['purpose']) => world.buildings.filter(b => (kinds.includes(b.kind) || !!b.facility && facilities.includes(b.facility)) && (!id || b.id === id) && atBuilding(b) && (!purpose || atFunctionPoint(b, purpose))).sort((a, b) => distance(state().player.position, a.door) - distance(state().player.position, b.door))[0];
  const controlled = (company: Company) => (company.shareholders.player ?? 0) > company.shares / 2;
  const cool = (key: string) => (ext().runtime.cooldowns[key] ?? -1e9) <= ext().lastUpdate + 1e-7;
  const cooldown = (key: string, minutes: number) => { ext().runtime.cooldowns[key] = ext().lastUpdate + minutes; };
  const tech = (sector: Sector) => ext().technologies.find(t => t.sector === sector)!;
  const refreshOwner = (company: Company) => { const holders = Object.entries(company.shareholders).filter(([id, n]) => id !== 'exchange' && n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); if (holders[0]) company.ownerId = holders[0][0]; };
  const payActor = (id: string, amount: number) => { if (id === 'player') state().player.money = clamp(state().player.money + amount, 0, 1e9); else { const c = citizens().get(id); if (c) c.money = clamp(c.money + amount, 0, 1e9); } };
  const incorporate = (shop: typeof simulation.state.shops[number], owner: string) => { const retained = Math.min(shop.cash ?? 0, simulation.shopProtectedFunds(shop)); const returned = (shop.cash ?? 0) - retained; if (shop.ownerId && returned > 0) payActor(shop.ownerId, returned); shop.cash = 0; shop.ownerId = owner; return retained; };
  const createCase = (npcId: string, amount: number, evidence: number): AuditCase | null => {
    const e = ext(), existing = e.audits.find(a => a.npcId === npcId && ['suspected', 'reported', 'investigating'].includes(a.status));
    if (existing) { existing.evidence = clamp(existing.evidence + evidence); existing.diverted = Math.max(existing.diverted, amount); return existing; }
    if (e.audits.length >= 128) {
      const closed = e.audits.findIndex(a => ['prosecuted', 'cleared'].includes(a.status));
      if (closed < 0) return null; // Evidence remains in diversions for the next audit.
      e.audits.splice(closed, 1);
    }
    const item: AuditCase = { id: `audit-${e.nextAuditId++}`, npcId, evidence: clamp(evidence), diverted: amount, status: 'suspected', createdAt: e.lastUpdate, responseAt: 0 };
    e.audits.push(item); if (e.audits.length > 128) { const old = e.audits.findIndex(a => ['prosecuted', 'cleared'].includes(a.status)); if (old >= 0) e.audits.splice(old, 1); } return item;
  };

  // Each tick's core wage minutes are observed once, never earned again here.
  const researchWorkWindows = new Map<string, { startAt: number; endAt: number; siteId: string }[]>();
  let researchPhaseMinutes = 0, researchPhaseClock = -1, researchPhaseTick = -1;
  let researchPlayerPhaseConflict = '';
  const researchFloor = (site: Building, position: Vec3) => Math.round((position.y - site.position.y - .6) / (site.height / site.floors)) || 0;
  const isResearchSite = (site: Building, sector: Sector) => ['school', 'core'].includes(site.kind) || site.facility === 'data' || sector === 'energy' && site.facility === 'energy';
  const researchLabReason = (site: Building, floor: number, position: Vec3, person: Pick<Player, 'role' | 'identities'>): string => {
    if (!canAccessFloor(site, floor, person) || researchFloor(site, position) !== floor) return '原实验楼层权限或脚点不满足。';
    if (!simulation.isNearBuilding(site, position, 0) || !simulation.isAtBuildingFunctionPoint(site, position, 'work', person)) return '已离开原实验室实际工作点。';
    if (getBuildingBody(site)) {
      const support = floorPlanSupport(site, floor, position, .35);
      if (!support || support.floor !== floor || !['room', 'stairs'].includes(support.kind) || Math.abs(support.y - position.y) > .26 || blocksFloorPlanMovement(site, floor, position, position, .35, 1.72)) return '实验室完整身体支撑或净空不满足。';
    } else {
      // The old recipes retain their shared rectangular floor geometry.
      const dimensions = getFloorDimensions(site, floor), dx = position.x - site.position.x, dz = position.z - site.position.z;
      const x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation);
      if (Math.abs(x) + .35 > dimensions.width / 2 || Math.abs(z) + .35 > dimensions.depth / 2 || site.height / site.floors < 1.72
        || Math.abs(getWalkHeight(world, position.x, position.z, position.y) - position.y) > .26) return '实验室完整身体支撑或净空不满足。';
    }
    return homeRestPointBlockedByVoxels(position, state().voxels) ? '实验室站立体积被放置的体素阻挡。' : '';
  };
  const researchLaborReason = (sector: Sector, job: AttendedResearchJob, phaseMinutes = 0): string => {
    const s = state(), profile = ext().actorProfiles[job.actorId], npc = job.actorId === 'player' ? undefined : citizens().get(job.actorId), actor = npc ?? (job.actorId === 'player' ? s.player : undefined), site = buildings.get(job.siteId);
    if (!actor || !profile?.alive || profile.health <= 0) return '研究者生命已结束或不再存在。';
    if (!site || !isResearchSite(site, sector)) return '原实验室不再提供该研究用途。';
    if (actor.needs.hunger < 40 || actor.needs.fatigue < 40) return '研究者需要进食或休息。';
    if (job.actorId === 'player') {
      if (phaseMinutes > 0 && researchPhaseClock === ext().lastUpdate && researchPhaseTick === s.tick && researchPlayerPhaseConflict) return researchPlayerPhaseConflict;
      if (!role('scientist') || s.player.education < 3 || Math.max(profile.skill, s.player.education * 8) < 24) return '缺少本研究所需科研资格。';
      if (s.player.vehicleId || s.aviation?.activeAircraftId) return '乘车或驾驶期间不能计入实验劳动。';
      const conflict = researchPlayerContextReason(s, world, (site, purpose) => atBuilding(site) && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site, s.player.position, purpose, s.player)), phaseMinutes); if (conflict) return conflict;
    } else if (!npc || !['scientist', '科研员', '科学家'].includes(npc.role) || (npc.education ?? 0) < 3 || profile.skill < 35 || profile.age < 18 || npc.state !== 'working' || npc.workId !== site.id) return '等候具名研究者回到原岗位真实工作。';
    const person = job.actorId === 'player' ? s.player : { role: 'scientist' as const, identities: ['scientist' as const] };
    return researchLabReason(site, job.floor, actor.position, person);
  };
  const beginResearchJob = (actorId: string, site: Building, budget: number): AttendedResearchJob => {
    const position = actorId === 'player' ? state().player.position : citizens().get(actorId)!.position, clock = ext().lastUpdate;
    return { startedAt: clock, finishAt: clock + 120, budget, actorId, laborVersion: 1, siteId: site.id, floor: researchFloor(site, position), workedMinutes: 0, lastObservedAt: clock, state: 'active', pauseReason: '' };
  };
  const observeResearchLabor = (minutes: number): void => {
    const e = ext(), phaseMinutes = finite(minutes) && researchPhaseClock === e.lastUpdate && researchPhaseTick === state().tick ? Math.max(0, Math.min(minutes, researchPhaseMinutes)) : 0;
    // Clip authenticated wage windows to this phase and each job's real start.
    // Consumed ranges cannot be reused by another sector of the same actor.
    const consumed = new Map<string, { startAt: number; endAt: number }[]>();
    for (const sector of TECHNOLOGY_SECTORS) {
      const job = e.runtime.researchJobs[sector]; if (job?.laborVersion !== 1) continue;
      const observedAt = job.lastObservedAt, elapsed = Math.max(0, Math.min(phaseMinutes, e.lastUpdate - observedAt)); job.lastObservedAt = e.lastUpdate;
      if (!(elapsed > 0)) continue;
      const reason = researchLaborReason(sector, job, phaseMinutes);
      if (reason) { job.state = 'paused'; job.pauseReason = reason; continue; }
      if (job.workedMinutes >= 120) { job.state = 'active'; job.pauseReason = ''; continue; }
      const lower = Math.max(job.startedAt, observedAt, e.lastUpdate - phaseMinutes);
      const windows = job.actorId === 'player' ? [{ startAt: lower, endAt: e.lastUpdate }] : (researchWorkWindows.get(job.actorId) ?? []).filter(window => window.siteId === job.siteId);
      let ranges = windows.map(window => ({ startAt: Math.max(lower, window.startAt), endAt: Math.min(e.lastUpdate, window.endAt) })).filter(window => window.endAt > window.startAt).sort((a, b) => a.startAt - b.startAt);
      // Union duplicate/overlapping event ranges before assigning any time.
      const merged: typeof ranges = [];
      for (const range of ranges) { const last = merged.at(-1); if (last && range.startAt <= last.endAt) last.endAt = Math.max(last.endAt, range.endAt); else merged.push({ ...range }); }
      ranges = merged;
      for (const used of consumed.get(job.actorId) ?? []) ranges = ranges.flatMap(range => range.endAt <= used.startAt || range.startAt >= used.endAt ? [range] : [
        ...(range.startAt < used.startAt ? [{ startAt: range.startAt, endAt: used.startAt }] : []),
        ...(range.endAt > used.endAt ? [{ startAt: used.endAt, endAt: range.endAt }] : []),
      ]);
      const available = ranges.reduce((sum, range) => sum + range.endAt - range.startAt, 0);
      const credited = claimActorActivityMinutes(simulation, job.actorId, `research:${sector}`, Math.min(elapsed, available, 120 - job.workedMinutes), phaseMinutes);
      if (!(credited > 0)) { job.state = 'paused'; job.pauseReason = '本相位没有可用的现场劳动时间；实际课堂或其他课题已占用的分钟不能重复。'; continue; }
      let remaining = credited; const used = consumed.get(job.actorId) ?? [];
      for (const range of ranges) { const minutes = Math.min(remaining, range.endAt - range.startAt); if (minutes > 0) used.push({ startAt: range.startAt, endAt: range.startAt + minutes }); remaining -= minutes; if (!(remaining > 0)) break; }
      consumed.set(job.actorId, used); job.workedMinutes += credited;
      job.state = 'active'; job.pauseReason = ''; tech(sector).progress = job.workedMinutes / 120 * 100;
    }
  };
  simulation.onEvent('wage-earned', event => {
    if (!event.citizenId || event.citizenId === 'player' || !finite(event.minutes) || event.minutes <= 0 || !finite(event.amount) || event.amount < 0
      || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt) || event.creditedWorkEndAt < event.creditedWorkStartAt
      || event.creditedWorkEndAt > ext().lastUpdate + 1e-7 || Math.abs(event.creditedWorkEndAt - event.creditedWorkStartAt - event.minutes) > 1e-7
      || researchPhaseClock !== ext().lastUpdate || researchPhaseTick !== state().tick) return;
    const worker = citizens().get(event.citizenId); if (!worker || worker.state !== 'working' || event.siteId !== worker.workId) return;
    if (!TECHNOLOGY_SECTORS.some(sector => { const job = ext().runtime.researchJobs[sector]; return job?.laborVersion === 1 && job.actorId === worker.id && job.siteId === worker.workId; })) return;
    const windows = researchWorkWindows.get(worker.id) ?? []; windows.push({ startAt: event.creditedWorkStartAt, endAt: event.creditedWorkEndAt, siteId: worker.workId }); researchWorkWindows.set(worker.id, windows);
  });
  simulation.onPhase('time', (_s, minutes) => {
    ext().lastUpdate += minutes; researchWorkWindows.clear(); researchPhaseMinutes = finite(minutes) ? Math.max(0, minutes) : 0; researchPhaseClock = ext().lastUpdate; researchPhaseTick = state().tick;
    // A real active activity may complete and clear its pointer later this same
    // phase. It still used this actor; terminal history does not latch next tick.
    researchPlayerPhaseConflict = researchPlayerContextReason(state(), world, (site, purpose) => atBuilding(site) && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site, state().player.position, purpose, state().player)), researchPhaseMinutes);
  });
  simulation.onPhase('environment', (s, minutes) => {
    const e = ext(), pollution = s.districts.reduce((n, d) => n + d.pollution, 0) / Math.max(1, s.districts.length);
    e.environment.waterQuality = clamp(e.environment.waterQuality + minutes * ((90 - e.environment.waterQuality) * .0002 - pollution * .000035 + tech('agriculture').level * .0002));
    e.environment.biodiversity = clamp(e.environment.biodiversity + minutes * ((85 - e.environment.biodiversity) * .0001 - pollution * .00002));
    const targetRisk = s.weather === '雨' ? 35 + (100 - e.environment.waterQuality) * .45 : Math.max(0, e.environment.stormRisk - 3);
    e.environment.stormRisk = clamp(e.environment.stormRisk + (targetRisk - e.environment.stormRisk) * Math.min(1, minutes / 120));
    if (e.lastUpdate + 1e-7 >= e.environment.disasterAt) {
      e.environment.disasterAt = e.lastUpdate + 1440;
      if (s.weather === '雨' && simulation.nextRandom() < e.environment.stormRisk / 100) {
        const d = s.districts[Math.floor(simulation.nextRandom() * s.districts.length)], severity = 5 + e.environment.stormRisk * .12;
        d.energy = clamp(d.energy - severity); d.prosperity = clamp(d.prosperity - severity * .4); d.pollution = clamp(d.pollution + severity * .3);
        e.environment.lastDisaster = `${world.districts.find(def => def.id === d.id)!.name}山洪`; e.environment.waterQuality = clamp(e.environment.waterQuality - severity);
        const response = simulation.purchasePublicSupplies(Math.min(s.treasury, severity * 30), d.id, 'emergency-procurement');
        if (response > 0) { e.runtime.lastTreasury -= response; record('player', -response, '山洪应急救灾支出', d.id); }
        for (const c of s.citizens.filter(c => c.districtId === d.id)) { const p = e.actorProfiles[c.id]; if (p.alive) { p.health = clamp(p.health - severity * .2); p.stress = clamp(p.stress + severity); } }
        for (const v of s.vehicles.filter(v => world.edges.find(edge => edge.id === v.edgeId)?.points.some(p => distance(p, world.districts.find(def => def.id === d.id)!.center) < 500))) v.nextDeparture += severity;
        notice('disaster', `${e.environment.lastDisaster}：道路与班次受阻，公共资金投入${response.toFixed(0)}文救灾。`, d.id);
      }
    }
  });
  simulation.onPhase('energy', s => { const bonus = tech('energy').level * 1.2 - (100 - ext().environment.waterQuality) * .05 - ext().environment.stormRisk * .03; s.energy = clamp(s.energy + bonus); for (const d of s.districts) d.energy = clamp(d.energy + bonus); });
  simulation.onPhase('traffic', s => { for (const v of s.vehicles) { const base = ({ road: 18, maglev: 50, lightRail: 25, cable: 6, lift: 4, ferry: 8, bridge: 4, flight: 120 })[v.kind]; v.speed = base * (1 + tech('traffic').level * .035) * (1 - ext().environment.stormRisk * .002); } });
  simulation.onPhase('people', (s, minutes) => {
    const e = ext();
    citizens();
    const die = (id: string, p: LifeProfile) => {
      p.alive = false; p.health = 0; if (!p.historyTags.includes('生命终结')) p.historyTags.push('生命终结');
      const npc = citizens().get(id); if (npc) { npc.state = 'dead'; npc.route = []; npc.routeIndex = 0; npc.destinationId = null; }
      for (const related of p.family) { const family = e.actorProfiles[related]; if (family) { family.mood = clamp(family.mood - 20); if (!family.historyTags.includes('悼念亲人')) family.historyTags.push('悼念亲人'); } }
      notice('life', id === 'player' ? '旅人的生命已经终结。可以继续观察城市，或读取之前保存的旅程。' : `${npc!.name}的生命已终结，亲友留下悼念记录。`);
    };
    for (const id of actorIds) {
      const p = e.actorProfiles[id], npc = citizens().get(id), c = npc ?? s.player;
      const family = s.family;
      const relatives = (p.family ?? []).filter(member => family?.children[id]?.parentIds.includes(member) || family?.children[member]?.parentIds.includes(id)
        || family?.studentGuardians[id]?.includes(member) || family?.studentGuardians[member]?.includes(id));
      p.family = [...new Set([...relatives, ...(c.partnerId ? [c.partnerId] : [])])];
      if (!p.alive) { if (npc) { npc.state = 'dead'; npc.destinationId = null; npc.route = []; npc.routeIndex = 0; } continue; }
      if (p.health <= 0 || p.age >= 110) { die(id, p); continue; }
      p.age = clamp(p.age + minutes / (1440 * 365), 0, 140);
      const poverty = clamp((100 - c.money) / 2), exhaustion = clamp((25 - c.needs.fatigue) * 2), hunger = clamp((20 - c.needs.hunger) * 3);
      p.stress = clamp(p.stress + (poverty * .6 + exhaustion * .25 + hunger * .15 - p.stress) * Math.min(1, minutes / 240));
      const targetMood = (c.needs.social + c.needs.fun + c.needs.fatigue + c.needs.hunger) / 4 - p.stress * .25;
      p.mood = clamp(p.mood + (targetMood - p.mood) * Math.min(1, minutes / 120));
      p.health = clamp(p.health + minutes * (.001 + tech('medicine').level * .0003 - hunger * .00009 - exhaustion * .00006 - Math.max(0, p.age - 75) * .0001 - (100 - e.environment.waterQuality) * .000007));
      if (id !== 'player') {
        e.runtime.deprivation[id] = c.money < 80 ? Math.min(1440 * 7, (e.runtime.deprivation[id] ?? 0) + minutes) : Math.max(0, (e.runtime.deprivation[id] ?? 0) - minutes * 2);
        if (['working', 'studying'].includes(npc!.state)) p.skill = clamp(p.skill + minutes * .0005);
        if (p.health < 60 && npc!.money >= 30) {
          const clinic = world.buildings.find(b => b.kind === 'clinic' && simulation.isNearBuilding(b, npc!.position, 20));
          if (clinic) beginClinicalTreatment(simulation, { patientId: id, payerId: id, siteId: clinic.id });
        }
      }
      if (npc && npc.role === '学生' && p.age >= 18 && (npc.education ?? 0) >= 3 && p.skill >= 35) {
        const school = world.buildings.find(b => b.kind === 'school' && simulation.isNearBuilding(b, npc.position));
        if (school) { npc.role = 'scientist'; npc.workId = school.id; if (!p.historyTags.includes('学成参与科研')) p.historyTags.push('学成参与科研'); npc.historyTags = [...new Set([...(npc.historyTags ?? []), '学成参与科研'])]; }
      }
      if (p.health <= 0 || p.age >= 110) {
        die(id, p);
      }
    }
    const job = e.cooking;
    if (job && e.lastUpdate + 1e-7 >= job.finishAt) { s.player.inventory[`dish:${job.recipeId}`] = (s.player.inventory[`dish:${job.recipeId}`] ?? 0) + 1; s.player.inventory[`dishQuality:${job.recipeId}`] = job.quality; e.stats.mealsCooked++; e.actorProfiles.player.skill = clamp(e.actorProfiles.player.skill + .8); e.cooking = null; notice('cook', `${RECIPES[job.recipeId as Recipe].name}已完成，品质${Math.round(job.quality)}，成品放入行囊。`); }
  });
  simulation.onEvent('production', event => { const shop = state().shops.find(shop => shop.id === event.shopId); if (!shop) return; const kind = buildings.get(shop.buildingId)!.kind, d = state().districts.find(d => d.id === shop.districtId)!; d.pollution = clamp(d.pollution + (event.amount ?? 0) * (kind === 'farm' ? .006 : .02)); });
  simulation.onPhase('finance', s => {
    const e = ext();
    if (e.lastUpdate + 1e-7 >= e.runtime.nextLedgerAt) { const delta = s.treasury - e.runtime.lastTreasury; if (Math.abs(delta) > .000001) record('player', delta, delta > 0 ? '城市税收与公共收入' : '城市公共运转支出', world.districts[0].id); e.runtime.lastTreasury = s.treasury; e.runtime.nextLedgerAt = e.lastUpdate + 60; }
    for (const company of e.companies) {
      const shop = s.shops.find(shop => shop.buildingId === company.buildingId)!; const cursor = e.runtime.companyCursors[company.id];
      const revenue = shop.revenue - cursor.revenue, profit = shop.profit - cursor.profit;
      company.revenue = clamp(company.revenue + revenue, 0, 1e12); company.profit = clamp(company.profit + profit, -1e12, 1e12);
      company.employees = shop.employees; company.inventory = shop.inventory; cursor.revenue = shop.revenue; cursor.profit = shop.profit;
      company.sharePrice = clamp((company.capital - simulation.shopPayrollDebt(shop) + Math.max(0, company.profit) * 2 + 300 * company.level) / company.shares, .05, 1e6);
    }
    const totalRevenue = s.shops.reduce((n, shop) => n + shop.revenue, 0);
    for (const company of e.companies) company.marketShare = totalRevenue > 0 ? company.revenue / totalRevenue : 0;
    if (e.lastUpdate + 1e-7 >= e.runtime.nextCompanyAt) {
      e.runtime.nextCompanyAt = e.lastUpdate + 60;
      for (const company of e.companies) if (company.profit > 0 && company.capital > 100 && simulation.shopPayrollDebt(s.shops.find(shop => shop.buildingId === company.buildingId)!) <= 1e-8) { const dividend = Math.min(Math.max(0, company.capital - simulation.shopProtectedFunds(s.shops.find(shop => shop.buildingId === company.buildingId)!)), company.capital * .01, company.profit * .003); for (const [actorId, shares] of Object.entries(company.shareholders)) if (actorId !== 'exchange') { const payout = dividend * shares / company.shares; company.capital -= payout; payActor(actorId, payout); if (payout > 0) simulation.emitEvent({ type: 'business-dividend', citizenId: actorId, shopId: s.shops.find(shop => shop.buildingId === company.buildingId)!.id, districtId: company.districtId, amount: payout }); } }
      for (const org of e.organizations) if (org.kind === 'charity' && org.funds >= 10) { const needy = s.citizens.filter(c => e.actorProfiles[c.id].alive && c.money < 80).sort((a, b) => a.money - b.money).slice(0, 8); const spending = Math.min(org.funds, needy.length * 10); if (needy.length) { org.funds -= spending; for (const c of needy) { c.money += spending / needy.length; e.actorProfiles[c.id].stress = clamp(e.actorProfiles[c.id].stress - 3); } e.institutions.welfare = clamp(e.institutions.welfare + spending * .002); record('player', -spending, '互助社实际救济', world.districts[0].id, 'household'); } }
      // Skills and accumulated resources open actual opportunities to residents,
      // rather than permanently reserving enterprise and science for the player.
      for (const c of s.citizens) {
        const profile = e.actorProfiles[c.id], workplace = buildings.get(c.workId)!;
        if (!profile.alive) continue;
        if (['工人', '农民', 'merchant', '商人'].includes(c.role) && c.money >= 750 && profile.skill >= 45 && (c.education ?? 0) >= 1 && ['market', 'workshop', 'farm', 'dock'].includes(workplace.kind) && !workplace.facility && simulation.isNearBuilding(workplace, c.position) && atFunctionPoint(workplace, 'work', c.position, { role: ['merchant', '商人'].includes(c.role) ? 'merchant' : 'traveler', identities: [['merchant', '商人'].includes(c.role) ? 'merchant' : 'traveler'] }) && !e.companies.some(company => company.buildingId === workplace.id || company.ownerId === c.id) && e.companies.length < 128) {
          c.money -= 250; publicFunds(c.id, 50, '居民创业登记费', workplace.districtId);
          const shop = s.shops.find(shop => shop.buildingId === workplace.id)!;
          const company: Company = { id: `company-${e.nextCompanyId++}`, name: `${c.name}百工商社`, ownerId: c.id, buildingId: workplace.id, districtId: workplace.districtId, capital: 200, shares: 1000, sharePrice: .5, listed: false, employees: shop.employees, inventory: shop.inventory, revenue: 0, profit: 0, level: 1, marketShare: 0, shareholders: { [c.id]: 1000 }, foundedAt: e.lastUpdate, parentId: null };
          company.capital += incorporate(shop, c.id); e.companies.push(company); simulation.transferBusinessOwnership(shop.id, c.id); e.runtime.companyCursors[company.id] = { revenue: shop.revenue, profit: shop.profit }; c.role = 'merchant'; if (!profile.historyTags.includes('自主创业')) profile.historyTags.push('自主创业'); notice('company', `${c.name}凭技能与积蓄创办${company.name}，登记和资本均由本人实际支付。`, c.districtId);
        }
        // A personally funded project costs 200; retain 100 for food and care.
        // Residents first meet their current hunger/rest needs before investing.
        if (['scientist', '科研员', '科学家'].includes(c.role) && (c.education ?? 0) >= 3 && profile.skill >= 35 && c.money >= 300 && c.needs.hunger >= 40 && c.needs.fatigue >= 40 && cool(`research:${c.id}`) && (workplace.kind === 'school' || workplace.kind === 'core' || workplace.facility === 'data') && simulation.isNearBuilding(workplace, c.position) && atFunctionPoint(workplace, 'work', c.position, { role: 'scientist', identities: ['scientist'] })) {
          const t = e.technologies.filter(t => t.level < 20 && !e.runtime.researchJobs[t.sector]).sort((a, b) => a.level - b.level)[0];
          if (t) { const job = beginResearchJob(c.id, workplace, 200); if (researchLabReason(workplace, job.floor, c.position, { role: 'scientist', identities: ['scientist'] })) continue; c.money -= 200; publicFunds(c.id, 200, `${sectorNames[t.sector]}居民科研投入`, c.districtId); t.funding = 200; t.progress = 0; e.runtime.researchJobs[t.sector] = job; cooldown(`research:${c.id}`, 1440); }
        }
      }
    }
    if (e.lastUpdate + 1e-7 >= e.runtime.nextCorruptionAt) {
      e.runtime.nextCorruptionAt = e.lastUpdate + 120;
      for (const c of s.citizens) {
        const workplace = buildings.get(c.workId)!;
        // Private banks and laboratories do not grant access to the city's
        // treasury. Authority must come from the resident's actual civic job.
        const publicAccess = ['官员', '议员', '财政官', '科研员', '科学家', '工程师', 'official', 'council', 'mayor', 'scientist'].includes(c.role) && (['hall', 'core'].includes(workplace.kind) || ['mayor', 'council', 'administration', 'data', 'energy', 'treasury'].includes(workplace.facility ?? ''));
        if (!e.actorProfiles[c.id].alive || c.money >= 80 || (e.runtime.deprivation[c.id] ?? 0) < 180 || !publicAccess || s.treasury < 500 || (e.runtime.diversions[c.id] ?? 0) > 0) continue;
        const probability = clamp((80 - c.money) / 120 + e.actorProfiles[c.id].stress / 250, 0, .85);
        if (simulation.nextRandom() >= probability) continue;
        const amount = Math.min(s.treasury * .003, 40 + (80 - c.money) * .8); publicFunds(c.id, -amount, '公共采购异常挪用', c.districtId); c.money += amount; e.runtime.diversions[c.id] = amount; if (!e.actorProfiles[c.id].historyTags.includes('公共资源行为异常')) e.actorProfiles[c.id].historyTags.push('公共资源行为异常');
        s.support = clamp(s.support - .5); simulation.emitEvent({ type: 'public-resource-anomaly', citizenId: c.id, districtId: c.districtId, amount });
      }
    }
  });
  simulation.onPhase('security', (s, minutes) => {
    const e = ext(), strength = tech('security').level;
    for (const d of s.districts) d.safety = clamp(d.safety + minutes * strength * .001);
    for (const item of e.audits) {
      if (item.status === 'reported' && item.responseAt > 0 && e.lastUpdate + 1e-7 >= item.responseAt) { item.evidence = clamp(item.evidence + 10 + tech('information').level * 2); item.responseAt = 0; }
      if (item.status !== 'investigating' || e.lastUpdate + 1e-7 < item.responseAt) continue;
      const npc = citizens().get(item.npcId)!;
      if (item.evidence >= 60) { const recovered = Math.min(item.diverted, npc.money); npc.money -= recovered; publicFunds(npc.id, recovered, '审计司法追缴', npc.districtId); e.stats.corruptionRecovered += recovered; e.runtime.diversions[npc.id] = Math.max(0, (e.runtime.diversions[npc.id] ?? 0) - item.diverted); item.status = 'prosecuted'; npc.role = '工人'; const ordinary = world.buildings.find(b => b.districtId === npc.districtId && ['workshop', 'farm', 'market'].includes(b.kind) && !b.facility) ?? buildings.get(npc.homeId)!; npc.workId = ordinary.id; npc.destinationId = null; npc.route = []; npc.routeIndex = 0; if (!e.actorProfiles[npc.id].historyTags.includes('挪用案件判决')) e.actorProfiles[npc.id].historyTags.push('挪用案件判决'); e.actorProfiles[npc.id].stress = clamp(e.actorProfiles[npc.id].stress + 20); s.support = clamp(s.support + 1); const d = s.districts.find(d => d.id === npc.districtId)!; d.safety = clamp(d.safety + 1); notice('audit', `${npc.name}挪用案完成调查与司法程序，追回${recovered.toFixed(1)}文入公共金库并撤销公职。`, npc.districtId); }
      else { item.status = 'cleared'; notice('audit', `${npc.name}案因证据不足结案，未发生资金奖励。`, npc.districtId); }
      item.responseAt = 0;
    }
  });
  simulation.onPhase('politics', (s, minutes) => { const e = ext(); e.institutions.education = clamp(e.institutions.education + (55 + tech('information').level * 1.5 - e.institutions.education) * Math.min(1, minutes / 1440)); e.institutions.medical = clamp(e.institutions.medical + (62 + tech('medicine').level * 1.8 - e.institutions.medical) * Math.min(1, minutes / 1440)); const monopoly = Math.max(0, ...e.companies.map(c => c.marketShare)) > .65 && e.companies.length > 2; if (monopoly) { s.support = clamp(s.support - minutes * .0004); for (const d of s.districts) d.employment = clamp(d.employment - minutes * .0000005, 0, 1); } });
  simulation.onPhase('feedback', (_s, minutes) => {
    const e = ext();
    for (const t of e.technologies) {
      const job = e.runtime.researchJobs[t.sector];
      if (job) {
        const attended = job.laborVersion === 1;
        t.progress = attended ? job.workedMinutes / 120 * 100 : clamp((e.lastUpdate - job.startedAt) / (job.finishAt - job.startedAt) * 100);
        const completed = attended ? job.workedMinutes >= 120 - 1e-7 : e.lastUpdate + 1e-7 >= job.finishAt;
        if (completed) { t.level++; t.progress = 100; t.funding = 0; t.sideEffect = clamp(t.sideEffect + job.budget / 200); delete e.runtime.researchJobs[t.sector]; if (e.runtime.legacyResearchSectors) e.runtime.legacyResearchSectors = e.runtime.legacyResearchSectors.filter(sector => sector !== t.sector); e.stats.researchCompleted++; const researcher = e.actorProfiles[job.actorId ?? 'player']; researcher.skill = clamp(researcher.skill + 2); notice('research', `${sectorNames[t.sector]}技术完成研发，等级${t.level}；收益与生态副作用已进入城市参数。`); }
      }
      t.sideEffect = clamp(t.sideEffect - minutes * .0004);
    }
    const externality = e.technologies.reduce((n, t) => n + t.sideEffect, 0);
    e.environment.biodiversity = clamp(e.environment.biodiversity - externality * minutes * .000008);
    for (const d of state().districts) d.pollution = clamp(d.pollution + externality * minutes * .00001);
  });
  simulation.onEvent('wage-earned', event => {
    if (!event.shopId || !(event.minutes && event.minutes > 0)) return;
    const shop = state().shops.find(shop => shop.id === event.shopId), company = shop && ext().companies.find(company => company.buildingId === shop.buildingId), job = company && ext().runtime.constructionJobs?.[company.id];
    if (!shop || !company || !job || job.completedAt !== null) return;
    const worker = state().citizens.find(worker => worker.id === event.citizenId), site = buildings.get(shop.buildingId)!;
    if (!worker || worker.workId !== site.id || worker.state !== 'working' || !simulation.isNearBuilding(site, worker.position, 2)) return;
    const minutes = simulation.consumeShopLabor(shop.id, Math.min(event.minutes, job.requiredMinutes - job.workedMinutes));
    job.workedMinutes += minutes; job.consumedUnits = job.materialUnits * job.workedMinutes / job.requiredMinutes;
    if (job.workedMinutes >= job.requiredMinutes - 1e-7) { job.workedMinutes = job.requiredMinutes; job.consumedUnits = job.materialUnits; job.completedAt = ext().lastUpdate; company.level++; notice('construction', `${company.name}实际完成建设劳动和材料耗用，等级提升至${company.level}；未凭空增加销售库存。`, company.districtId); simulation.emitEvent({ type: 'construction-completed', shopId: shop.id, districtId: shop.districtId, amount: job.consumedUnits, minutes: job.workedMinutes }); }
  });
  simulation.registerCommandHandler((command): CommandResult | null => {
    if (!handled.has(command.type)) return null;
    const s = state(), e = ext(), p = s.player;
    const fail = (message: string): CommandResult => ({ ok: false, message });
    const success = (message: string): CommandResult => { notice(command.type, message); return { ok: true, message }; };
    if (command.targetId !== undefined && typeof command.targetId !== 'string') return fail('目标须为有效标识。');
    if (!e.actorProfiles.player.alive || e.actorProfiles.player.health <= 0) return fail('生命已终结，不能进行生活与职业操作。');
    const amount = (fallback: number, min: number, max: number) => { const n = command.value ?? fallback; return finite(n) && Number.isInteger(n) && n >= min && n <= max ? n : null; };
    if (command.type === 'foundCompany') {
      const b = nearby(['market', 'workshop', 'farm', 'dock'], command.targetId, [], 'work'), capital = amount(500, 300, 100000);
      if (!role('merchant')) return fail('需要商人经营资格。');
      if (!b) return fail('请到商业设施现场登记公司。');
      if (capital === null) return fail('初始资本须为300至100000的整数。');
      if (e.companies.some(c => c.buildingId === b.id) || e.companies.length >= 128) return fail('此处已有公司或公司数量达到上限。');
      if (p.money < capital + 50) return fail('现金不足：资本之外另需50文登记费。');
      const shop = s.shops.find(shop => shop.buildingId === b.id);
      if (!shop || b.facility) return fail('公共科研与政务设施不能登记为私营公司。');
      p.money -= capital + 50; publicFunds('player', 50, '公司登记费', b.districtId);
      const company: Company = { id: `company-${e.nextCompanyId++}`, name: `${b.name}商社`, ownerId: 'player', buildingId: b.id, districtId: b.districtId, capital, shares: 1000, sharePrice: (capital + 300) / 1000, listed: false, employees: shop.employees, inventory: shop.inventory, revenue: 0, profit: 0, level: 1, marketShare: 0, shareholders: { player: 1000 }, foundedAt: e.lastUpdate, parentId: null };
      company.capital += incorporate(shop, 'player'); e.companies.push(company); simulation.transferBusinessOwnership(shop.id, 'player'); e.runtime.companyCursors[company.id] = { revenue: shop.revenue, profit: shop.profit };
      return success(`已创办${company.name}，投入${capital}文资本、50文登记费，持有全部1000股。`);
    }
    if (['expandCompany', 'hire', 'listCompany', 'buyShares', 'sellShares', 'acquireCompany'].includes(command.type)) {
      const company = e.companies.find(c => c.id === command.targetId);
      if (!company) return fail('公司不存在。');
      const shop = s.shops.find(shop => shop.buildingId === company.buildingId)!;
      if (['expandCompany', 'hire', 'listCompany', 'acquireCompany'].includes(command.type) && !role('merchant')) return fail('需要商人经营资格。');
      if (['expandCompany', 'hire', 'listCompany'].includes(command.type) && !controlled(company)) return fail('需要持有公司过半股权。');
      if (['expandCompany', 'hire', 'acquireCompany'].includes(command.type) && !nearby(['market', 'workshop', 'farm', 'dock'], company.buildingId, [], 'work')) return fail('请到目标公司的经营场所。');
      if (['listCompany', 'buyShares', 'sellShares'].includes(command.type) && !nearby(['bank'], undefined, [], 'service')) return fail('请到钱庄办理上市与股权交易。');
      if (command.type === 'expandCompany') {
        const investment = amount(300, 100, 50000);
        if (investment === null || company.level >= 20) return fail('扩张投入须为100至50000的整数，等级上限20。');
        if (p.money < investment || company.capital + investment > 1e9) return fail('扩张现金不足或公司资本已达上限。');
        if (!cool(`expand:${company.id}`)) return fail('上一次扩张仍在整合，请等候60分钟。');
        const jobs = e.runtime.constructionJobs ??= {}, existing = jobs[company.id]; if (existing && existing.completedAt === null) return fail('既有工程尚未投入足够现场劳动。');
        const fee = investment * .1, units = investment * .3 / 4; let materialCost = 0;
        const suppliers = s.shops.filter(supplier => simulation.shopCommodity(supplier) === 'materials' && supplier.inventory > 0).sort((a, b) => Number(b.districtId === company.districtId) - Number(a.districtId === company.districtId) || b.inventory - a.inventory);
        const lots: ConstructionJob['lots'] = []; let remaining = units;
        for (const supplier of suppliers) { const quote = simulation.quoteSupply(supplier.id, remaining), quantity = quote.quantity; if (quantity <= 0) continue; const gross = quantity * quote.unitPrice, net = gross * (1 - s.taxRate); if (simulation.shopFunds(supplier) + net > 1e9) continue; lots.push({ supplierId: supplier.id, quantity, gross, net, unitPrice: quote.unitPrice }); remaining -= quantity; materialCost += gross; if (remaining < 1e-7) break; }
        if (remaining > 1e-7) return fail('现有真实建设材料或供应商账户容量不足，无法开工。');
        if (materialCost + fee > investment + 1e-8 || company.capital + investment - materialCost - fee + lots.filter(lot => lot.supplierId === shop.id).reduce((sum, lot) => sum + lot.net, 0) > 1e9) return fail('真实建设物料报价超过本次投入，或账户无法容纳款项。');
        p.money -= investment; company.capital += investment - materialCost - fee; publicFunds('player', fee, '公司建设许可费', company.districtId);
        for (const lot of lots) { const supplier = s.shops.find(supplier => supplier.id === lot.supplierId)!; supplier.inventory -= lot.quantity; simulation.transferShopFunds(supplier, lot.net); supplier.revenue += lot.gross; supplier.profit += lot.net; simulation.emitEvent({ type: 'wholesale', shopId: supplier.id, districtId: supplier.districtId, amount: lot.gross, quantity: lot.quantity, unitPrice: lot.unitPrice ?? 4 }); }
        jobs[company.id] = { startedAt: e.lastUpdate, requiredMinutes: 60, workedMinutes: 0, budget: investment, materialCost, fee, materialUnits: units, consumedUnits: 0, completedAt: null, lots }; cooldown(`expand:${company.id}`, 60);
        return success(`${company.name}工程已开工：${units.toFixed(1)}份真实材料入建设库，仍需60分钟现场劳动；营运资本增加${(investment - materialCost - fee).toFixed(1)}文。`);
      }
      if (command.type === 'hire') {
        const count = amount(1, 1, 20);
        if (count === null || shop.employees + count > 100) return fail('每次雇佣1至20人，最多100人。');
        if (company.capital - simulation.shopProtectedFunds(shop) < count * 50) return fail('公司资本不足以支付每人50文培训与招聘。');
        const recruits = s.citizens.filter(c => e.actorProfiles[c.id].alive && c.workId !== company.buildingId && simulation.buildingTravelDistance(c.homeId, company.buildingId) <= 500 && ['工人', '农民', '搬运工', 'merchant', '商人', '居民'].includes(c.role)).sort((a, b) => a.money - b.money || distance(a.position, buildings.get(company.buildingId)!.door) - distance(b.position, buildings.get(company.buildingId)!.door)).slice(0, count);
        if (recruits.length < count) return fail('暂时没有足够符合岗位条件的居民。');
        company.capital -= count * 50; publicFunds('player', count * 50, '公司招聘与培训费', company.districtId); shop.employees += count; company.employees = shop.employees;
        for (const c of recruits) { c.workId = company.buildingId; c.role = buildings.get(company.buildingId)!.kind === 'farm' ? '农民' : '工人'; c.destinationId = null; c.route = []; c.routeIndex = 0; c.historyTags = [...new Set([...(c.historyTags ?? []), '受雇于新公司'])]; e.actorProfiles[c.id].skill = clamp(e.actorProfiles[c.id].skill + 1); }
        const d = s.districts.find(d => d.id === company.districtId)!; d.employment = clamp(d.employment + count * .001, 0, 1);
        return success(`${company.name}新增${count}名雇员，招聘成本${count * 50}文从公司账户支出。`);
      }
      if (command.type === 'listCompany') {
        if (company.listed || company.level < 2 || company.capital < 600 || p.money < 200) return fail('上市要求2级、600文公司资本和200文登记费，且不能重复上市。');
        p.money -= 200; publicFunds('player', 200, '公司上市登记费', company.districtId);
        const issued = Math.floor(company.shares / 4); company.shares += issued; company.shareholders.exchange = issued; company.listed = true; company.sharePrice = clamp((company.capital + company.level * 300) / company.shares, .05, 1e6);
        return success(`${company.name}公开增发${issued}股，交易库存由交易所托管。`);
      }
      if (command.type === 'buyShares' || command.type === 'sellShares') {
        const count = amount(10, 1, 1000000), price = company.sharePrice;
        if (count === null || !company.listed) return fail('只能交易已上市公司，股数须为正整数。');
        const cost = count * price;
        if (command.type === 'buyShares') {
          if ((company.shareholders.exchange ?? 0) < count || p.money < cost || company.capital + cost > 1e9) return fail('交易所股数、现金或资本额度不足。');
          p.money -= cost; company.capital += cost; company.shareholders.exchange -= count; company.shareholders.player = (company.shareholders.player ?? 0) + count;
        } else {
          if ((company.shareholders.player ?? 0) < count || company.capital - simulation.shopProtectedFunds(shop) < cost || p.money + cost > 1e9) return fail('持股或公司回购现金不足。');
          if (count === company.shareholders.player && !Object.entries(company.shareholders).some(([id, holding]) => id !== 'player' && id !== 'exchange' && holding > 0)) return fail('公司需要真实持股经营负责人，出售最后一股前须将管理股权转给其他居民。');
          company.shareholders.player -= count; company.shareholders.exchange = (company.shareholders.exchange ?? 0) + count; company.capital -= cost; p.money += cost;
        }
        refreshOwner(company); record('player', command.type === 'buyShares' ? cost : -cost, '交易所股权成交', company.districtId, 'company');
        return success(`${command.type === 'buyShares' ? '买入' : '卖出'}${company.name}${count}股，每股${price.toFixed(2)}文。`);
      }
      const parent = e.companies.find(c => c.id !== company.id && controlled(c) && c.parentId !== company.id);
      if (!parent || controlled(company)) return fail('需拥有另一家控股公司，且不能重复收购已控股公司。');
      let ancestor: Company | undefined = parent;
      while (ancestor?.parentId) { if (ancestor.parentId === company.id) return fail('集团不能形成循环控股。'); ancestor = e.companies.find(c => c.id === ancestor!.parentId); }
      const shares = company.shares - (company.shareholders.player ?? 0), cost = shares * company.sharePrice * 1.2;
      if (p.money < cost) return fail(`收购需要${cost.toFixed(1)}文现金。`);
      p.money -= cost;
      for (const [id, quantity] of Object.entries(company.shareholders)) if (id !== 'player' && quantity) { const proceeds = quantity * company.sharePrice * 1.2; if (id === 'exchange') company.capital = clamp(company.capital + proceeds, 0, 1e9); else payActor(id, proceeds); }
      company.shareholders = { player: company.shares }; company.ownerId = 'player'; company.parentId = parent.id; record('player', cost, '公司并购股权支付', company.districtId, 'company');
      return success(`已收购${company.name}并纳入${parent.name}，${cost.toFixed(1)}文按原股权支付给原持有人。`);
    }
    if (command.type === 'research') {
      const sector = command.targetId as Sector, budget = amount(200, 100, 2000);
      if (!TECHNOLOGY_SECTORS.includes(sector) || budget === null) return fail('请选择有效研究领域，预算为100至2000文整数。');
      if (!role('scientist') || p.education < 3 || Math.max(e.actorProfiles.player.skill, p.education * 8) < 24) return fail('科研需要科研人员身份、教育3与对应技能。');
      const b = nearby(['school', 'core'], undefined, sector === 'energy' ? ['data', 'energy'] : ['data'], 'work');
      if (!b) return fail('请到书院或天枢数据中心开展研究。');
      const t = tech(sector);
      if (e.runtime.researchJobs[sector] || t.level >= 20 || p.money < budget) return fail('研究正在运行、等级达到上限或预算现金不足。');
      const job = beginResearchJob('player', b, budget), reason = researchLaborReason(sector, job); if (reason) return fail(reason);
      p.money -= budget; publicFunds('player', budget, `${sectorNames[sector]}科研投入`, b.districtId); t.funding = budget; t.progress = 0; e.runtime.researchJobs[sector] = job;
      return success(`${sectorNames[sector]}研究已投入${budget}文，需在原实验室累计120分钟有效劳动，离场暂停；收益与副作用将影响城市。`);
    }
    if (command.type === 'buyIngredient') {
      const ingredient = command.targetId as keyof typeof INGREDIENTS, count = amount(1, 1, 20);
      if (!Object.hasOwn(INGREDIENTS, ingredient) || count === null) return fail('食材种类无效，数量须为1至20整数。');
      const b = nearby(['market', 'farm', 'dock'], undefined, [], 'sale'); if (!b) return fail('请到市集、农场或码头购买食材。');
      const shop = s.shops.find(shop => shop.buildingId === b.id), price = INGREDIENTS[ingredient] * count;
      if (!shop || b.facility) return fail('请到有实际食材库存的私营商铺购买。');
      if (!shop.open || shop.inventory < count || p.money < price) return fail('商铺休业、库存或现金不足。');
      const beforeInventory = shop.inventory, net = price * (1 - s.taxRate); let supplierGross: number, inventoryCost: number;
      try { const quote = simulation.quoteConsignmentSale(shop.id, count, beforeInventory); supplierGross = quote.supplierGross; inventoryCost = quote.inventoryCost; } catch { return fail('寄售货主账户暂不能结算。'); }
      if (net < supplierGross || simulation.shopFunds(shop) + net - supplierGross > 1e9) return fail('成交净款不足以支付实际供货者，或店铺账户已满。');
      p.money -= price; shop.inventory -= count; shop.revenue += price; shop.profit += net - inventoryCost; simulation.settleConsignmentSale(shop.id, count, beforeInventory); simulation.transferShopFunds(shop, net - supplierGross); shop.customers += count; p.inventory[`ingredient:${ingredient}`] = (p.inventory[`ingredient:${ingredient}`] ?? 0) + count;
      simulation.emitEvent({ type: 'sale', amount: price, shopId: shop.id, districtId: shop.districtId, quantity: count });
      return success(`购买${count}份${ingredient === 'grain' ? '谷米' : ingredient === 'fish' ? '溪鱼' : '蔬菜'}，花费${price}文。`);
    }
    if (command.type === 'cook') {
      const recipe = command.targetId as Recipe, heat = amount(60, 0, 100);
      if (!Object.hasOwn(RECIPES, recipe) || heat === null) return fail('请选择有效配方，火候为0至100整数。');
      if (e.cooking) return fail('已有一道菜正在烹饪。');
      const b = nearby(['home', 'clinic', 'market']); if (!b || b.kind === 'home' && b.id !== p.homeId) return fail('请到自己租住的厨房、医馆或市集烹饪。');
      const definition = RECIPES[recipe];
      if (Object.entries(definition.ingredients).some(([key, needed]) => (p.inventory[`ingredient:${key}`] ?? 0) < needed)) return fail('配方所需食材不足。');
      for (const [key, needed] of Object.entries(definition.ingredients)) p.inventory[`ingredient:${key}`] -= needed;
      const quality = clamp(90 - Math.abs(heat - definition.heat) * 1.1 + e.actorProfiles.player.skill * .1, 5, 100);
      e.cooking = { recipeId: recipe, startedAt: e.lastUpdate, finishAt: e.lastUpdate + definition.minutes, quality };
      return success(`${definition.name}开始烹制，食材已消耗，火候${heat}，需要${definition.minutes}分钟。`);
    }
    if (command.type === 'eat') {
      if (command.targetId === 'food') {
        if ((p.inventory.food ?? 0) < 1) return fail('行囊里没有可食用的随身食品。');
        p.inventory.food!--; p.needs.hunger = clamp(p.needs.hunger + 52);
        simulation.emitEvent({ type: 'food-consumed', citizenId: 'player', amount: 1 });
        return success('实际食用一份随身食品，剩余食品留在行囊。');
      }
      const recipe = command.targetId as Recipe;
      if (!Object.hasOwn(RECIPES, recipe) || (p.inventory[`dish:${recipe}`] ?? 0) < 1) return fail('行囊没有这道成品菜。');
      const quality = p.inventory[`dishQuality:${recipe}`] ?? 70; p.inventory[`dish:${recipe}`]--;
      p.needs.hunger = clamp(p.needs.hunger + RECIPES[recipe].nutrition * (.6 + quality / 250)); p.needs.fun = clamp(p.needs.fun + 8); e.actorProfiles.player.health = clamp(e.actorProfiles.player.health + quality / 50); e.actorProfiles.player.mood = clamp(e.actorProfiles.player.mood + 5);
      return success(`享用${RECIPES[recipe].name}，真实消耗一份成品，饱腹、健康与心情得到改善。`);
    }
    if (command.type === 'audit') {
      if (!role('mayor', 'council', 'official', 'police')) return fail('审计需要公共事务或警务权限。');
      const b = nearby(['hall', 'core', 'police'], undefined, ['data', 'archives', 'treasury', 'administration']);
      if (!b || p.money < 40 || !cool('audit')) return fail('请到官署、档案或数据设施，准备40文审计费，并等候30分钟审计间隔。');
      p.money -= 40; publicFunds('player', 40, '公共资金审计费', b.districtId); cooldown('audit', 30);
      let count = 0;
      for (const [npcId, diverted] of Object.entries(e.runtime.diversions)) if (diverted > 0) {
        const evidence = e.publicLedger.some(row => row.actorId === npcId && row.purpose === '公共采购异常挪用') ? 45 + tech('information').level * 3 : 35;
        if (createCase(npcId, diverted, evidence)) count++;
      }
      return success(`已核验公共资金账本，发现${count}项仍未追缴的异常；证据与案件记录已保存。`);
    }
    if (command.type === 'reportCorruption' || command.type === 'investigate') {
      if (!nearby(['hall', 'core', 'police'], undefined, ['data', 'archives', 'treasury', 'administration'])) return fail('尚未到公共调查设施。');
      let item = e.audits.find(a => a.id === command.targetId);
      if (!item && command.type === 'reportCorruption') {
        // Any citizen may present a real public record, even before an official
        // audit has opened a case. The command also accepts its ledger actor ID.
        const npcId = command.targetId, diversion = npcId ? e.runtime.diversions[npcId] : 0;
        if (!npcId || !diversion || !e.publicLedger.some(row => row.actorId === npcId && row.purpose === '公共采购异常挪用')) return fail('账本中没有可核验的这项公共资金异常。');
        item = e.audits.find(a => a.npcId === npcId && ['suspected', 'reported', 'investigating'].includes(a.status));
        if (item && item.status !== 'suspected') return fail('此案已举报或已经结案。');
        if (!item && e.audits.length >= 128 && !e.audits.some(a => ['prosecuted', 'cleared'].includes(a.status))) return fail('调查案件已满，线索保留在账本中等待受理。');
        item ??= createCase(npcId, diversion, 45 + tech('information').level * 3) ?? undefined;
      }
      if (!item) return fail('案件不存在。');
      if (item.evidence < 35) return fail('可核验证据不足35，不能启动程序。');
      if (command.type === 'reportCorruption') { if (item.status !== 'suspected') return fail('此案已举报或已经结案。'); item.status = 'reported'; item.responseAt = e.lastUpdate + 60; return success('举报已受理，一小时内核验线索；不会立即发放金钱奖励。'); }
      if (!role('police', 'council', 'mayor') || item.status !== 'reported') return fail('调查需要警察、议员或市长权限，且案件已被正式举报。');
      item.status = 'investigating'; item.evidence = clamp(item.evidence + 20 + tech('information').level * 2); item.responseAt = e.lastUpdate + 120;
      return success('调查与司法程序已启动，两小时后按证据和实际资金追缴。');
    }
    if (command.type === 'heal') {
      const id = command.targetId ?? 'player', profile = e.actorProfiles[id], npc = s.citizens.find(c => c.id === id), b = nearby(['clinic']);
      if (!b || !profile || !profile.alive || profile.health <= 0 || id !== 'player' && (!npc || distance(p.position, npc.position) > 24)) return fail('请在医馆现场为仍活着的自己或身边居民诊疗。');
      return beginClinicalTreatment(simulation, { patientId: id, payerId: 'player', siteId: b.id });
    }
    if (['joinOrganization', 'donate', 'attendFestival'].includes(command.type)) {
      const org = e.organizations.find(o => o.id === command.targetId) ?? (command.type === 'attendFestival' && command.targetId === undefined ? e.organizations[0] : undefined);
      if (!org) return fail('组织不存在。');
      const kinds = command.type === 'joinOrganization' ? ['school', 'pavilion', 'hall'] : command.type === 'donate' ? ['school', 'clinic', 'hall', 'core'] : ['market', 'pavilion', 'hall'];
      const b = nearby(kinds); if (!b) return fail('请到学苑、官署、医馆或相应公共活动场所。');
      if (command.type === 'joinOrganization') { if (org.members.includes('player') || p.money < 20) return fail('已是成员或入会费20文不足。'); p.money -= 20; org.funds += 20; org.members.push('player'); record('player', 20, '组织入会费', b.districtId, 'household'); return success(`已加入${org.name}，入会费20文进入组织基金。`); }
      if (command.type === 'donate') {
        const donation = amount(50, 10, 10000); if (donation === null || p.money < donation || !cool('donate')) return fail('捐赠须为10至10000文整数、现金充足，间隔60分钟。');
        p.money -= donation; org.funds += donation; org.reputation = clamp(org.reputation + donation / 500); e.institutions.welfare = clamp(e.institutions.welfare + donation / 1000); p.reputation += donation / 500; e.stats.donations += donation; cooldown('donate', 60); record('player', donation, '慈善组织捐赠', b.districtId, 'household');
        return success(`${donation}文已捐入${org.name}；互助社基金将按真实资金救助贫困居民。`);
      }
      if (p.money < 20 || !cool('festival')) return fail('参加节庆需20文，活动间隔两小时。');
      p.money -= 20; org.funds += 20; p.needs.fun = clamp(p.needs.fun + 25); p.needs.social = clamp(p.needs.social + 20); e.actorProfiles.player.mood = clamp(e.actorProfiles.player.mood + 12); e.institutions.culture = clamp(e.institutions.culture + .5); e.stats.festivals++; cooldown('festival', 120); record('player', 20, '公共文化节庆活动', b.districtId, 'household');
      for (const c of s.citizens.filter(c => e.actorProfiles[c.id].alive && distance(c.position, p.position) <= 80).slice(0, 8)) { e.actorProfiles[c.id].mood = clamp(e.actorProfiles[c.id].mood + 5); c.needs.social = clamp(c.needs.social + 5); const rel = s.relationships.find(r => r.npcId === c.id); if (rel) { rel.affection = clamp(rel.affection + 2, -100, 100); rel.memories.push({ tick: s.tick, text: `同游${org.name}节庆`, impact: 2 }); if (rel.memories.length > 12) rel.memories.shift(); simulation.emitEvent({ type: 'relationship-change', citizenId: c.id, amount: 2 }); } }
      return success(`参与${org.name}节庆，花费20文，现场居民与共同记忆受到实际影响。`);
    }
    if (command.type === 'appoint') {
      const npc = s.citizens.find(c => c.id === command.targetId), index = amount(0, 0, 2), b = nearby(['hall', 'core'], undefined, ['mayor', 'council', 'administration']);
      if (!role('mayor') || !npc || !b || distance(p.position, npc.position) > 24 || !e.actorProfiles[npc.id].alive) return fail('市长须在政务设施现场任命身边仍活着的居民。');
      if (index === null || (npc.education ?? 0) < (index === 2 ? 3 : 2) || s.treasury < 100 || !cool(`appoint:${npc.id}`)) return fail('资格教育不足、公共资金不足100文或尚在一天任命间隔。');
      const appointed = (['official', 'council', 'scientist'] as const)[index]; npc.role = appointed; npc.workId = b.id; npc.destinationId = null; npc.route = []; npc.routeIndex = 0; npc.historyTags = [...new Set([...(npc.historyTags ?? []), '公共职务任命'])]; publicFunds('player', -100, '公共岗位任命与培训', b.districtId); cooldown(`appoint:${npc.id}`, 1440);
      return success(`已任命${npc.name}为${appointed === 'scientist' ? '科研人员' : appointed === 'council' ? '议员' : '公务员'}，工作场所与权限机会已改变。`);
    }
    return null;
  });
  simulation.registerSaveValidator(candidate => {
    const value = candidate.extension as Extension | undefined;
    if (value === undefined) return; // The pre-extension format remains importable.
    const actorIds = new Set(['player', ...candidate.citizens.map(c => c.id)]);
    const ensure = (condition: unknown, name: string): void => { if (!condition) throw new Error(`扩展存档无效：${name}`); };
    const num = (n: unknown, min: number, max: number, name: string, integer = false): void => ensure(finite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)), name);
    const str = (n: unknown, name: string, max = 200): void => ensure(typeof n === 'string' && n.length <= max, name);
    const array = (n: unknown, max: number, name: string): any[] => { ensure(Array.isArray(n) && n.length <= max, name); return n as any[]; };
    const object = (n: unknown, max: number, name: string): Record<string, any> => { ensure(dictionary(n) && Object.keys(n).length <= max, name); return n as Record<string, any>; };
    const exactKeys = (map: Record<string, unknown>, ids: Set<string>, name: string) => ensure(Object.keys(map).length === ids.size && Object.keys(map).every(id => ids.has(id)), name);
    ensure(dictionary(value) && value.version === 1, 'version');
    num(value.lastUpdate, 0, 1e12, 'clock'); num(value.nextCompanyId, 1, 1e9, 'company counter', true); num(value.nextAuditId, 1, 1e9, 'audit counter', true);
    const companies = array(value.companies, 128, 'companies'), companyIds = new Set<string>(), companyBuildings = new Set<string>();
    for (const c of companies) {
      ensure(dictionary(c), 'company'); str(c.id, 'company id', 80); ensure(/^company-[1-9][0-9]*$/.test(c.id) && !companyIds.has(c.id) && Number(c.id.slice(8)) < value.nextCompanyId, 'company identity/counter'); companyIds.add(c.id);
      const b = buildings.get(c.buildingId); ensure(b && ['market', 'workshop', 'farm', 'dock'].includes(b.kind) && c.districtId === b.districtId && !companyBuildings.has(c.buildingId), 'company facility'); companyBuildings.add(c.buildingId);
      str(c.name, 'company name'); ensure(actorIds.has(c.ownerId), 'company owner'); ensure(typeof c.listed === 'boolean', 'listing');
      num(c.capital, 0, 1e9, 'capital'); num(c.shares, 1, 1e8, 'shares', true); num(c.sharePrice, .05, 1e6, 'share price'); num(c.employees, 0, 100, 'employees', true); num(c.inventory, 0, 10000, 'company inventory'); num(c.revenue, 0, 1e12, 'revenue'); num(c.profit, -1e12, 1e12, 'profit'); num(c.level, 1, 20, 'company level', true); num(c.marketShare, 0, 1, 'market share'); num(c.foundedAt, 0, value.lastUpdate, 'company founded');
      const holders = object(c.shareholders, actorIds.size + 1, 'shareholders'); let shares = 0;
      for (const [id, count] of Object.entries(holders)) { ensure(actorIds.has(id) || id === 'exchange', 'shareholder'); num(count, 0, c.shares, 'shareholding', true); shares += count as number; }
      ensure(shares === c.shares && (holders[c.ownerId] ?? 0) > 0, 'share conservation/owner');
      ensure(c.parentId === null || typeof c.parentId === 'string', 'company parent');
    }
    for (const c of companies) { const seen = new Set([c.id]); let id = c.parentId; while (id !== null) { ensure(companyIds.has(id) && !seen.has(id), 'parent cycle/reference'); seen.add(id); id = companies.find(p => p.id === id)!.parentId; } }
    const technologies = array(value.technologies, 7, 'technologies'), sectors = new Set<string>(); ensure(technologies.length === 7, 'all seven technologies');
    for (const t of technologies) { ensure(dictionary(t) && TECHNOLOGY_SECTORS.includes(t.sector) && !sectors.has(t.sector), 'technology sector'); sectors.add(t.sector); num(t.level, 0, 20, 'technology level', true); num(t.progress, 0, 100, 'technology progress'); num(t.funding, 0, 2000, 'technology funding'); num(t.sideEffect, 0, 100, 'technology side effect'); }
    const profiles = object(value.actorProfiles, actorIds.size, 'life profiles'); exactKeys(profiles, actorIds, 'life identities');
    for (const [id, p] of Object.entries(profiles)) { ensure(dictionary(p) && typeof p.alive === 'boolean', 'life profile'); num(p.age, 0, 140, 'age'); num(p.health, 0, 100, 'health'); num(p.mood, 0, 100, 'mood'); num(p.stress, 0, 100, 'stress'); num(p.skill, 0, 100, 'skill'); if (!p.alive) ensure(p.health === 0, 'dead actor health'); const family = array(p.family, 32, 'family'); ensure(new Set(family).size === family.length && family.every(member => actorIds.has(member) && member !== id), 'family reference'); for (const tag of array(p.historyTags, 128, 'history tags')) str(tag, 'history tag', 120); }
    for (const row of array(value.publicLedger, 512, 'ledger')) { ensure(dictionary(row) && actorIds.has(row.actorId) && districts.has(row.districtId) && ['public', 'company', 'household'].includes(row.account), 'ledger references'); num(row.tick, 0, candidate.tick, 'ledger tick', true); num(row.amount, -1e12, 1e12, 'ledger amount'); str(row.purpose, 'ledger purpose'); }
    for (const row of value.publicLedger) if (row.sourceEvent !== undefined) ensure(row.account === 'public' && (row.sourceEvent === 'transit-fare' && row.amount > 0 || row.sourceEvent === 'public-payroll-escrow' && row.amount !== 0), 'ledger source event');
    const auditIds = new Set<string>();
    for (const item of array(value.audits, 128, 'audits')) { ensure(dictionary(item) && typeof item.id === 'string' && /^audit-[1-9][0-9]*$/.test(item.id) && !auditIds.has(item.id) && Number(item.id.slice(6)) < value.nextAuditId && actorIds.has(item.npcId) && item.npcId !== 'player', 'audit references'); auditIds.add(item.id); num(item.evidence, 0, 100, 'evidence'); num(item.diverted, 0, 1e9, 'diversion'); num(item.createdAt, 0, value.lastUpdate, 'case creation'); num(item.responseAt, 0, 1e12, 'case response'); ensure(['suspected', 'reported', 'investigating', 'prosecuted', 'cleared'].includes(item.status), 'audit status'); if (item.status === 'investigating') ensure(item.responseAt >= item.createdAt, 'investigation timer'); }
    if (value.cooking !== null) { const job = value.cooking; ensure(dictionary(job) && Object.hasOwn(RECIPES, job.recipeId), 'cooking recipe'); num(job.startedAt, 0, value.lastUpdate, 'cooking started'); num(job.finishAt, job.startedAt, 1e12, 'cooking finish'); ensure(Math.abs(job.finishAt - job.startedAt - RECIPES[job.recipeId as Recipe].minutes) < 1e-7, 'cooking duration'); num(job.quality, 5, 100, 'cooking quality'); }
    const orgIds = new Set<string>();
    for (const org of array(value.organizations, 32, 'organizations')) { ensure(dictionary(org) && typeof org.id === 'string' && !orgIds.has(org.id), 'organization identity'); str(org.id, 'organization id', 80); orgIds.add(org.id); str(org.name, 'organization name'); ensure(['guild', 'charity', 'culture'].includes(org.kind), 'organization kind'); num(org.reputation, 0, 100, 'organization reputation'); num(org.funds, 0, 1e9, 'organization funds'); const members = array(org.members, actorIds.size, 'organization members'); ensure(new Set(members).size === members.length && members.every(id => actorIds.has(id)), 'organization members'); }
    ensure(orgIds.size === 3 && ['org-guild', 'org-relief', 'org-culture'].every(id => orgIds.has(id)), 'required organizations');
    const environment = object(value.environment, 8, 'environment'); for (const key of ['waterQuality', 'biodiversity', 'stormRisk']) num(environment[key], 0, 100, `environment ${key}`); num(environment.disasterAt, 0, 1e12, 'disaster timer'); str(environment.lastDisaster, 'disaster record');
    const institutions = object(value.institutions, 4, 'institutions'); for (const key of ['education', 'medical', 'welfare', 'culture']) num(institutions[key], 0, 100, `institution ${key}`);
    const stats = object(value.stats, 5, 'statistics'); for (const key of ['mealsCooked', 'researchCompleted', 'festivals']) num(stats[key], 0, 1e12, key, true); for (const key of ['corruptionRecovered', 'donations']) num(stats[key], 0, 1e12, key);
    const r = object(value.runtime, 14, 'extension runtime'); ensure(r.version === 1, 'runtime version'); for (const key of ['nextCompanyAt', 'nextCorruptionAt', 'nextLedgerAt']) num(r[key], 0, 1e12, key); num(r.lastTreasury, -1e12, 1e12, 'treasury cursor');
    const timers = object(r.cooldowns, 4096, 'cooldowns'); for (const [id, at] of Object.entries(timers)) { str(id, 'cooldown key', 120); ensure(['audit', 'donate', 'festival'].includes(id) || id.startsWith('heal:') && actorIds.has(id.slice(5)) || id.startsWith('appoint:') && actorIds.has(id.slice(8)) || id.startsWith('research:') && actorIds.has(id.slice(9)) || id.startsWith('expand:') && companyIds.has(id.slice(7)), 'cooldown identity'); num(at, 0, 1e12, 'cooldown timer'); }
    const jobs = object(r.researchJobs, 7, 'research jobs');
    const markedResearch = r.researchLaborVersion !== undefined;
    ensure(!markedResearch || r.researchLaborVersion === 1, 'research labor version');
    ensure(markedResearch || r.legacyResearchSectors === undefined, 'partial research runtime marker');
    const legacyResearch = markedResearch ? array(r.legacyResearchSectors, 7, 'legacy research sectors') : Object.keys(jobs);
    ensure(new Set(legacyResearch).size === legacyResearch.length && legacyResearch.every(sector => TECHNOLOGY_SECTORS.includes(sector) && jobs[sector] && jobs[sector].laborVersion === undefined), 'legacy research whitelist');
    for (const [sector, job] of Object.entries(jobs)) {
      ensure(TECHNOLOGY_SECTORS.includes(sector as Sector) && dictionary(job), 'research job'); ensure(job.actorId === undefined || actorIds.has(job.actorId), 'research actor');
      num(job.startedAt, 0, value.lastUpdate, 'research start'); num(job.finishAt, job.startedAt, 1e12, 'research finish'); ensure(Math.abs(job.finishAt - job.startedAt - 120) < 1e-7, 'research duration');
      num(job.budget, 100, 2000, 'research budget', true); const t = technologies.find(t => t.sector === sector)!; ensure(t.funding === job.budget && t.level < 20, 'research funding');
      if (job.laborVersion === undefined) { ensure(legacyResearch.includes(sector), 'unmarked research outside legacy whitelist'); ensure(Object.keys(job).every(key => ['startedAt', 'finishAt', 'budget', 'actorId'].includes(key)), 'partial research labor marker'); continue; }
      ensure(markedResearch && job.laborVersion === 1 && !legacyResearch.includes(sector) && typeof job.actorId === 'string' && actorIds.has(job.actorId), 'marked research actor/version');
      const savedActor = job.actorId === 'player' ? candidate.player : candidate.citizens.find(person => person.id === job.actorId), site = buildings.get(job.siteId);
      ensure(savedActor && site && isResearchSite(site, sector as Sector), 'research saved actor/site binding');
      num(job.floor, -(site!.basements ?? 0), site!.floors - 1, 'research floor', true); ensure(!getBuildingBody(site!) || !!getBuildingBody(site!)!.floorPlans.find(plan => plan.floor === job.floor), 'research physical floor');
      num(job.workedMinutes, 0, 120, 'research actual labor'); num(job.lastObservedAt, job.startedAt, value.lastUpdate, 'research observed clock');
      ensure(Math.abs(job.lastObservedAt - value.lastUpdate) < 1e-7 && job.workedMinutes <= value.lastUpdate - job.startedAt + 1e-7, 'research no historical time credit');
      ensure(Math.abs(t.progress - job.workedMinutes / 120 * 100) < 1e-7, 'research progress/labor consistency');
      ensure(['active', 'paused'].includes(job.state), 'research labor state'); str(job.pauseReason, 'research pause reason', 120);
      ensure(Object.keys(job).every(key => ['startedAt', 'finishAt', 'budget', 'actorId', 'laborVersion', 'siteId', 'floor', 'workedMinutes', 'lastObservedAt', 'state', 'pauseReason'].includes(key)), 'research job fields');
    }
    // Necessary feasible capacity for all pending marked jobs of one actor,
    // including later-start suffixes; grandfather jobs carry no invented labor.
    const actorJobs = new Map<string, AttendedResearchJob[]>();
    for (const job of Object.values(jobs)) if (job.laborVersion === 1) { const list = actorJobs.get(job.actorId) ?? []; list.push(job as AttendedResearchJob); actorJobs.set(job.actorId, list); }
    for (const list of actorJobs.values()) for (const cutoff of new Set(list.map(job => job.startedAt))) {
      const worked = list.filter(job => job.startedAt >= cutoff).reduce((sum, job) => sum + job.workedMinutes, 0);
      ensure(worked <= value.lastUpdate - cutoff + 1e-7, 'research actor pending suffix time capacity');
    }
    for (const t of technologies) if (!jobs[t.sector]) ensure(t.funding === 0, 'unused research funding');
    const cursors = object(r.companyCursors, 128, 'company cursors'); exactKeys(cursors, companyIds, 'company accounting identities'); for (const [id, cursor] of Object.entries(cursors)) { ensure(dictionary(cursor), 'company cursor'); const c = companies.find(c => c.id === id)!, shop = candidate.shops.find(shop => shop.buildingId === c.buildingId)!; num(cursor.revenue, 0, shop.revenue + 1e-7, 'shop revenue cursor'); num(cursor.profit, -1e12, 1e12, 'shop profit cursor'); }
    if (r.constructionJobs !== undefined) for (const [id, job] of Object.entries(object(r.constructionJobs, 128, 'construction jobs'))) {
      ensure(companyIds.has(id) && dictionary(job), 'construction company'); num(job.startedAt, 0, value.lastUpdate, 'construction start'); num(job.requiredMinutes, 60, 60, 'construction labor requirement'); num(job.workedMinutes, 0, 60, 'construction actual labor'); num(job.budget, 100, 50000, 'construction budget', true); num(job.materialCost, job.budget * .3 - 1e-7, job.budget - job.fee + 1e-7, 'construction actual materials cost'); num(job.fee, job.budget * .1, job.budget * .1, 'construction public fee'); num(job.materialUnits, job.budget * .3 / 4, job.budget * .3 / 4, 'construction material stock'); num(job.consumedUnits, 0, job.materialUnits, 'construction material use');
      ensure(Math.abs(job.consumedUnits - job.materialUnits * job.workedMinutes / 60) < 1e-6, 'construction labor and material consumption'); ensure(job.workedMinutes <= (value.lastUpdate - job.startedAt) * candidate.citizens.length + 1e-7, 'construction elapsed labor');
      ensure(job.completedAt === null ? job.workedMinutes < 60 : finite(job.completedAt) && job.completedAt >= job.startedAt && job.completedAt <= value.lastUpdate && job.workedMinutes === 60, 'construction completion');
      let quantity = 0, gross = 0; for (const lot of array(job.lots, candidate.shops.length, 'construction suppliers')) { ensure(dictionary(lot) && candidate.shops.some(shop => shop.id === lot.supplierId && ['farm', 'workshop', 'dock'].includes(buildings.get(shop.buildingId)!.kind)), 'construction material supplier'); num(lot.quantity, 0, 10000, 'construction supplier units'); num(lot.gross, 0, 50000, 'construction supplier gross'); num(lot.net, 0, lot.gross, 'construction supplier net'); if (lot.unitPrice !== undefined) num(lot.unitPrice, 4, 1e12, 'construction supplier agreed price'); ensure(Math.abs(lot.gross - lot.quantity * (lot.unitPrice ?? 4)) < 1e-7, 'construction supply cost'); quantity += lot.quantity; gross += lot.gross; }
      ensure(Math.abs(quantity - job.materialUnits) < 1e-6 && Math.abs(gross - job.materialCost) < 1e-6, 'construction purchased material conservation');
    }
    for (const [id, minutes] of Object.entries(object(r.deprivation, actorIds.size, 'deprivation'))) { ensure(actorIds.has(id) && id !== 'player', 'deprivation actor'); num(minutes, 0, 1440 * 7, 'deprivation duration'); }
    for (const [id, amount] of Object.entries(object(r.diversions, actorIds.size, 'diversions'))) { ensure(actorIds.has(id) && id !== 'player', 'diversion actor'); num(amount, 0, 1e9, 'diversion amount'); }
  });
  simulation.onLoad(() => {
    citizens(); if (!state().extension) state().extension = initialize();
    const runtime = ext().runtime;
    if (runtime.researchLaborVersion === undefined) { runtime.researchLaborVersion = 1; runtime.legacyResearchSectors = Object.keys(runtime.researchJobs) as Sector[]; }
    researchWorkWindows.clear(); researchPhaseMinutes = 0; researchPhaseClock = -1; researchPhaseTick = -1; researchPlayerPhaseConflict = '';
  });
  return observeResearchLabor;
}
