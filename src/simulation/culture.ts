import type { Simulation } from '../simulation';
import { canAccessFloor } from '../access';
import { getBuildingBody } from '../architecture-floor-plan';
import { clinicalHealthGain, clinicalPairAtServiceStation, clinicalVisitDeadline, installClinical, takeClinicalDoctorSlot } from './clinical';
import type { Building, Citizen, Command, CommandResult, Player, Role, SimState, WorldDefinition } from '../types';

export type WorkGenre = 'literature' | 'art';
export type ReportMetric = 'water' | 'safety' | 'budget';
export type PetitionTopic = 'education' | 'health' | 'transport';
export interface CultureProject { genre: WorkGenre; title: string; text: string; siteId: string; startedAt: number; workedMinutes: number; requiredMinutes: number; paid: number }
export interface CulturalWork { id: string; authorId: string; genre: WorkGenre; title: string; text: string; quality: number; startedAt: number; workedMinutes: number; createdAt: number; publishedAt: number | null; siteId: string | null; readIds: string[]; readingMinutes: Record<string, number> }
export interface CityReport {
  id: string; authorId: string; text: string; siteId: string; metric: ReportMetric;
  claim: number; originalClaim: number;
  evidence: { observedAt: number; observedTick: number; observedValue: number; districtId: string; public: true };
  status: 'unchecked' | 'verified' | 'false' | 'corrected'; publishedAt: number; verifiedAt: number | null; correctedAt: number | null;
  readIds: string[]; reachedIds: string[]; readingMinutes: Record<string, number>; correctionReadIds: string[]; correctionMinutes: Record<string, number>; falseNotifiedIds: string[]; nextSpreadAt: number;
}
export interface CivicPetition { id: string; authorId: string; topic: PetitionTopic; title: string; text: string; siteId: string; filedAt: number; replyAt: number; status: 'open' | 'answered'; signerIds: string[]; reply: string | null; answeredAt: number | null; executionId?: string | null }
export interface SupplyReceipt { procurementId: string; budgetId: string; purchasedAt: number; paid: number; quantity: number; tax: number; reason?: 'budget' | 'supply' | 'authorization'; lots: { shopId: string; quantity: number; unitPrice: number; gross: number; net: number }[] }
export interface ServiceOrder {
  id: string; petitionId: string; topic: PetitionTopic; siteId: string;
  state: 'agenda' | 'awaitingReview' | 'awaitingBudget' | 'awaitingSupply' | 'active' | 'fulfilled' | 'rejected';
  scheduledAt: number; approvedAt: number | null; approvedBy: string[]; authorizedCap: number; spent: number;
  receivedUnits: number; consumedUnits: number; targetUnits: number; requiredMinutes: number;
  servedIds: string[]; serviceMinutes: Record<string, number>; staffIds: string[]; receipts: SupplyReceipt[];
  retryAt: number; completedAt: number | null; lastReason: string;
}
export interface CultureState { version: 1 | 2; lastUpdate: number; nextWorkId: number; nextReportId: number; nextPetitionId: number; project: CultureProject | null; works: CulturalWork[]; reports: CityReport[]; petitions: CivicPetition[]; nextOrderId: number; orders: ServiceOrder[]; playerServiceId: string | null; transportMaintenance: Record<string, { maintainedUntil: number; orderId: string; units: number }> }
const DAY = 1440;
const WORK_LIMIT = 32, REPORT_LIMIT = 32, PETITION_LIMIT = 16;
const REQUIRED: Record<WorkGenre, number> = { literature: 120, art: 180 };
const SERVICE: Record<PetitionTopic, { kind: string; roles: string[]; minutes: number; units: number }> = {
  education: { kind: 'school', roles: ['老师', 'teacher'], minutes: 60, units: 6 },
  health: { kind: 'clinic', roles: ['医生', 'doctor'], minutes: 20, units: 6 },
  transport: { kind: 'station', roles: ['驾驶员', 'driver', '工程师'], minutes: 60, units: 4 },
};
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sameClaim = (report: Pick<CityReport, 'claim' | 'evidence'>) => Math.abs(report.claim - report.evidence.observedValue) <= 1e-7;
export const civicSite = (site: Building) => site.kind === 'hall' || site.kind === 'core' && site.facility === 'mayor';
export const publicFloor = (site: Building, level: number) => level >= 0 && level < site.floors && (site.floorPermissions?.[level] ? site.floorPermissions[level] === 'public' : site.publicFloors === undefined || level < site.publicFloors);
export const canReviewPetition = (site: Building, level: number, player: Pick<Player, 'role' | 'identities'>) => site.facility === 'mayor' && site.floorPermissions?.[level] === 'mayor' && (player.role === 'mayor' || player.identities?.includes('mayor') === true) && canAccessFloor(site, level, player);

/** Public cultural activity uses existing facilities, actors and ten-phase hooks. */
export function installCulture(simulation: Simulation): void {
  const world = simulation.worldDefinition, sites = new Map(world.buildings.map(site => [site.id, site]));
  const state = () => simulation.state as SimState & { culture?: CultureState };
  const culture = () => state().culture!;
  const now = () => state().extension!.lastUpdate;
  const initialize = (): CultureState => ({ version: 2, lastUpdate: now(), nextWorkId: 1, nextReportId: 1, nextPetitionId: 1, project: null, works: [], reports: [], petitions: [], nextOrderId: 1, orders: [], playerServiceId: null, transportMaintenance: {} });
  state().culture = initialize();
  const notice = (type: string, text: string, districtId?: string) => { simulation.appendNotice(type, text, districtId); simulation.emitEvent({ type: `extension:${type}`, districtId }); };
  const alive = (id: string) => state().extension!.actorProfiles[id]?.alive === true;
  const floor = (site: Building, position: { y: number }) => Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)));
  const atSite = (site: Building) => simulation.isNearBuilding(site) && publicFloor(site, floor(site, state().player.position)) && canAccessFloor(site, floor(site, state().player.position), state().player)
    && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site));
  const nearby = (kinds: string[]) => world.buildings.filter(site => (kinds.includes(site.kind) || kinds.includes('hall') && civicSite(site)) && atSite(site)).sort((a, b) => distance(a.door, state().player.position) - distance(b.door, state().player.position))[0];
  const publicPayment = (amount: number, purpose: string, site: Building) => {
    state().player.money -= amount; state().treasury += amount;
    const e = state().extension!, runtime = (e as unknown as { runtime?: { lastTreasury: number } }).runtime;
    if (runtime) runtime.lastTreasury += amount;
    e.publicLedger.push({ tick: state().tick, actorId: 'player', amount, purpose, account: 'public', districtId: site.districtId });
    if (e.publicLedger.length > 512) e.publicLedger.splice(0, e.publicLedger.length - 512);
  };
  const relation = (citizen: Citizen, affection: number, trust: number, text: string) => {
    let r = state().relationships.find(item => item.npcId === citizen.id);
    if (!r) { r = { npcId: citizen.id, affection: 0, trust: 0, type: 'acquaintance', encounters: 0, memories: [], tags: [] }; state().relationships.push(r); }
    r.affection = clamp(r.affection + affection, -100, 100); r.trust = clamp(r.trust + trust, -100, 100); r.encounters++;
    r.memories.push({ tick: state().tick, text, impact: affection }); if (r.memories.length > 12) r.memories.shift();
    simulation.emitEvent({ type: 'relationship-change', citizenId: citizen.id, amount: affection });
  };
  const readersAt = (site: Building) => state().citizens.filter(citizen => {
    if (!alive(citizen.id) || state().extension!.actorProfiles[citizen.id].age < 6 || !simulation.isNearBuilding(site, citizen.position, 2)) return false;
    const role = (['traveler', 'police', 'soldier', 'teacher', 'driver', 'merchant', 'mayor', 'scientist', 'official', 'council'].includes(citizen.role) ? citizen.role : 'traveler') as Role;
    const identity = { role, identities: [role] };
    return publicFloor(site, floor(site, citizen.position)) && canAccessFloor(site, floor(site, citizen.position), identity)
      && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site, citizen.position, undefined, identity));
  });
  const staffAt = (order: ServiceOrder) => state().citizens.filter(person => SERVICE[order.topic].roles.includes(person.role) && person.needs.hunger >= 40 && person.needs.fatigue >= 35 && state().extension!.actorProfiles[person.id].health >= 45 && simulation.isOnDuty(person.id, order.siteId));
  const makeOrder = (petition: CivicPetition): ServiceOrder | null => {
    const hearing = sites.get(petition.siteId)!, rule = SERVICE[petition.topic];
    const site = world.buildings.filter(site => site.districtId === hearing.districtId && site.kind === rule.kind && !site.facility).sort((a, b) => distance(a.door, hearing.door) - distance(b.door, hearing.door))[0];
    if (!site) return null;
    const order: ServiceOrder = { id: `service-${culture().nextOrderId++}`, petitionId: petition.id, topic: petition.topic, siteId: site.id, state: 'agenda', scheduledAt: now(), approvedAt: null, approvedBy: [], authorizedCap: 0, spent: 0, receivedUnits: 0, consumedUnits: 0, targetUnits: rule.units, requiredMinutes: rule.minutes, servedIds: [], serviceMinutes: {}, staffIds: [], receipts: [], retryAt: now(), completedAt: null, lastReason: '议题已排入公共服务议程，等待有权限的实际在岗人员审核。' };
    culture().orders.push(order); petition.executionId = order.id; return order;
  };
  const authorize = (order: ServiceOrder, signers: string[], cap: number): boolean => {
    if (!simulation.authorizePublicBudget({ id: order.id, siteId: order.siteId, purpose: order.topic, cap, approvedAt: now(), approvedBy: signers })) return false;
    order.approvedAt = now(); order.approvedBy = [...signers]; order.authorizedCap = cap; order.state = 'awaitingBudget'; order.retryAt = now(); order.lastReason = '服务额度已批准；实际采购仍须保留必要公共工资与运维现金。';
    return true;
  };
  const finishService = (order: ServiceOrder) => {
    order.state = 'fulfilled'; order.completedAt = now(); order.lastReason = '采购的材料已由实际在岗人员与现场参与者完成服务。';
    simulation.closePublicBudget(order.id);
    const institutions = state().extension!.institutions;
    if (order.topic === 'education') institutions.education = clamp(institutions.education + order.servedIds.length * .1);
    if (order.topic === 'health') institutions.medical = clamp(institutions.medical + order.servedIds.length * .1);
    state().support = clamp(state().support + Math.min(.6, order.consumedUnits * .1));
    notice('public-service', `${sites.get(order.siteId)!.name}完成服务，实际支出${order.spent.toFixed(1)}文，耗用${order.consumedUnits}份材料。`, sites.get(order.siteId)!.districtId);
  };
  const serve = (order: ServiceOrder, minutes: number) => {
    const site = sites.get(order.siteId)!, staff = staffAt(order), rule = SERVICE[order.topic];
    if (state().hour < 8 || state().hour >= 17 || !staff.length) { order.lastReason = '已采购材料保留；等候服务开放和合资格人员真实出勤。'; return; }
    for (const person of staff) if (!order.staffIds.includes(person.id)) order.staffIds.push(person.id);
    if (order.topic === 'transport') {
      if (order.receivedUnits - order.consumedUnits < rule.units - 1e-7) return;
      const worker = staff[0], before = order.serviceMinutes[worker.id] ?? 0;
      order.serviceMinutes[worker.id] = Math.min(rule.minutes, before + minutes);
      if (order.serviceMinutes[worker.id] < rule.minutes - 1e-7) return;
      order.consumedUnits += rule.units; order.servedIds.push(worker.id);
      culture().transportMaintenance[site.id] = { maintainedUntil: now() + 7 * DAY, orderId: order.id, units: rule.units };
      simulation.emitEvent({ type: 'civic-service', citizenId: worker.id, districtId: site.districtId, quantity: rule.units, minutes: rule.minutes });
      finishService(order); return;
    }
    const present = readersAt(site).filter(person => !staff.some(worker => worker.id === person.id) && person.needs.hunger >= 40 && person.needs.fatigue >= 35 && !order.servedIds.includes(person.id) && (order.topic !== 'health' || state().extension!.actorProfiles[person.id].health < 95 && clinicalVisitDeadline(state(), person.id) <= now()));
    const playerPresent = culture().playerServiceId === order.id && alive('player') && atSite(site) && state().player.needs.hunger >= 40 && state().player.needs.fatigue >= 35 && !order.servedIds.includes('player') && (order.topic !== 'health' || state().extension!.actorProfiles.player.health < 95 && clinicalVisitDeadline(state(), 'player') <= now());
    const candidates = [...(playerPresent ? ['player'] : []), ...present.map(person => person.id)];
    // An unmatched patient must not occupy the candidate prefix forever. Real
    // health capacity is bounded by the shared per-doctor slot allocator below.
    const ids = order.topic === 'health' ? candidates : candidates.slice(0, staff.length * 4);
    for (const id of ids) {
      if (order.receivedUnits - order.consumedUnits < 1 - 1e-7) break;
      if (order.topic === 'health' && !staff.some(doctor => clinicalPairAtServiceStation(simulation, site, doctor.id, id) && takeClinicalDoctorSlot(simulation, doctor.id, id))) continue;
      order.serviceMinutes[id] = Math.min(rule.minutes, (order.serviceMinutes[id] ?? 0) + minutes);
      if (order.serviceMinutes[id] < rule.minutes - 1e-7) continue;
      order.consumedUnits++; order.servedIds.push(id);
      const profile = state().extension!.actorProfiles[id];
      if (order.topic === 'health') { profile.health = clamp(profile.health + clinicalHealthGain(state())); profile.stress = clamp(profile.stress - 2); state().clinical!.nextVisitAt[id] = now() + 60; }
      else { profile.skill = clamp(profile.skill + 1); if (id === 'player') { state().player.education++; state().player.experience++; } else { const person = state().citizens.find(person => person.id === id)!; person.skills ??= {}; person.skills.learning = clamp((person.skills.learning ?? 0) + 2); if (profile.age >= 18) person.education = (person.education ?? 0) + 1; } }
      simulation.emitEvent({ type: 'civic-service', citizenId: id, districtId: site.districtId, quantity: 1, minutes: rule.minutes });
      if (id === 'player') culture().playerServiceId = null;
      if (order.consumedUnits >= rule.units - 1e-7) { finishService(order); break; }
    }
    if (order.state === 'active') order.lastReason = `现场履约中；${order.servedIds.length}人完成，余${(order.receivedUnits - order.consumedUnits).toFixed(1)}份材料。`;
  };
  const notifyFalse = (report: CityReport, citizen: Citizen) => {
    if (report.falseNotifiedIds.includes(citizen.id)) return;
    report.falseNotifiedIds.push(citizen.id);
    relation(citizen, -2, -3, `《城市报告》核验不实：原主张${report.originalClaim}，观测证据${report.evidence.observedValue.toFixed(2)}`);
  };
  simulation.onPhase('time', () => { culture().lastUpdate = now(); });
  simulation.onPhase('people', (_s, minutes) => {
    const c = culture(), project = c.project, player = state().player;
    if (project && alive('player') && atSite(sites.get(project.siteId)!) && player.needs.hunger >= 40 && player.needs.fatigue >= 40 && state().hour >= 7 && state().hour < 22) {
      const work = Math.min(minutes, project.requiredMinutes - project.workedMinutes);
      project.workedMinutes += work; player.needs.fatigue = clamp(player.needs.fatigue - work * .03); player.needs.fun = clamp(player.needs.fun + work * .02);
      if (project.workedMinutes + 1e-7 >= project.requiredMinutes) {
        const p = state().extension!.actorProfiles.player;
        const completed: CulturalWork = { id: `work-${c.nextWorkId++}`, authorId: 'player', genre: project.genre, title: project.title, text: project.text, quality: clamp(25 + player.education * 5 + p.skill * .35 + p.mood * .15), startedAt: project.startedAt, workedMinutes: project.workedMinutes, createdAt: now(), publishedAt: null, siteId: null, readIds: [], readingMinutes: {} };
        c.works.push(completed); p.skill = clamp(p.skill + 1); player.experience++; c.project = null;
        notice('culture', `《${completed.title}》完成。作品保留为未公开稿件，须到公共场所发布。`, sites.get(project.siteId)!.districtId);
      }
    }
    for (const work of c.works) {
      if (!work.siteId || work.publishedAt === null) continue;
      for (const citizen of readersAt(sites.get(work.siteId)!)) {
        if (work.readIds.includes(citizen.id) || citizen.needs.hunger < 40 || citizen.needs.fatigue < 35 || work.genre === 'literature' && (citizen.education ?? 0) < 1) continue;
        work.readingMinutes[citizen.id] = Math.min(15, (work.readingMinutes[citizen.id] ?? 0) + minutes);
        if (work.readingMinutes[citizen.id] < 15 - 1e-7) continue;
        work.readIds.push(citizen.id); citizen.needs.fun = clamp(citizen.needs.fun + 4 + work.quality * .08);
        citizen.skills ??= {}; citizen.skills.learning = clamp((citizen.skills.learning ?? 0) + work.quality * .006);
        state().extension!.actorProfiles[citizen.id].skill = clamp(state().extension!.actorProfiles[citizen.id].skill + work.quality * .004);
        relation(citizen, 2, 1, `在${sites.get(work.siteId)!.name}读完《${work.title}》`);
        if (work.authorId === 'player') player.reputation = clamp(player.reputation + .15, -100, 1e8);
        simulation.emitEvent({ type: 'culture-read', citizenId: citizen.id, amount: work.quality, districtId: citizen.districtId });
      }
    }
    for (const report of c.reports) {
      const site = sites.get(report.siteId)!;
      for (const citizen of readersAt(site)) {
        if ((citizen.education ?? 0) < 1 || citizen.needs.hunger < 35 || citizen.needs.fatigue < 30) continue;
        if (!report.readIds.includes(citizen.id)) {
          report.readingMinutes[citizen.id] = Math.min(10, (report.readingMinutes[citizen.id] ?? 0) + minutes);
          if (report.readingMinutes[citizen.id] < 10 - 1e-7) continue;
          report.readIds.push(citizen.id);
          if (!report.reachedIds.includes(citizen.id)) report.reachedIds.push(citizen.id);
          const p = state().extension!.actorProfiles[citizen.id];
          if (report.status !== 'false' && report.metric !== 'budget' && report.claim < 40) p.stress = clamp(p.stress + 2);
          else citizen.needs.fun = clamp(citizen.needs.fun + 2);
          if (report.status === 'verified') relation(citizen, 1, 2, '阅读有公开观测依据的城市报告');
        }
        if (report.status === 'false' || report.status === 'corrected') notifyFalse(report, citizen);
        if (report.status === 'corrected' && !report.correctionReadIds.includes(citizen.id)) {
          report.correctionMinutes[citizen.id] = Math.min(5, (report.correctionMinutes[citizen.id] ?? 0) + minutes);
          if (report.correctionMinutes[citizen.id] >= 5 - 1e-7) {
            report.correctionReadIds.push(citizen.id); state().extension!.actorProfiles[citizen.id].stress = clamp(state().extension!.actorProfiles[citizen.id].stress - 1);
            relation(citizen, 1, 2, '看见原作者公开更正，保留旧误报的记忆');
          }
        }
      }
      if (now() + 1e-7 >= report.nextSpreadAt && !['false', 'corrected'].includes(report.status)) {
        report.nextSpreadAt = now() + 30;
        const sources = state().citizens.filter(citizen => report.reachedIds.includes(citizen.id) && alive(citizen.id) && citizen.needs.social >= 30);
        for (const source of sources.slice(0, 8)) {
          const listener = state().citizens.find(citizen => citizen.id !== source.id && alive(citizen.id) && state().extension!.actorProfiles[citizen.id].age >= 6 && !report.reachedIds.includes(citizen.id) && distance(source.position, citizen.position) <= 18);
          if (!listener) continue;
          report.reachedIds.push(listener.id); if (report.metric !== 'budget' && report.claim < 40) state().extension!.actorProfiles[listener.id].stress = clamp(state().extension!.actorProfiles[listener.id].stress + 1);
          simulation.emitEvent({ type: 'information-spread', citizenId: listener.id, districtId: listener.districtId });
        }
      }
    }
    for (const petition of c.petitions) {
      if (petition.status !== 'open') continue;
      for (const citizen of readersAt(sites.get(petition.siteId)!)) {
        if (state().extension!.actorProfiles[citizen.id].age < 18 || petition.signerIds.includes(citizen.id) || citizen.needs.social < 30) continue;
        const institution = petition.topic === 'education' ? state().extension!.institutions.education : petition.topic === 'health' ? state().extension!.institutions.medical : state().energy;
        if (institution >= 80 && citizen.needs.fun >= 60) continue;
        petition.signerIds.push(citizen.id); citizen.needs.social = clamp(citizen.needs.social + 2);
      }
    }
    for (const order of c.orders) if (order.state === 'active') serve(order, minutes);
  });
  simulation.onPhase('finance', () => {
    for (const order of culture().orders) {
      if (!['awaitingBudget', 'awaitingSupply', 'active'].includes(order.state) || order.approvedAt === null || order.receivedUnits >= order.targetUnits - 1e-7 || now() < order.retryAt - 1e-7) continue;
      order.retryAt = now() + 60;
      const receipt = simulation.purchasePublicSupplyReceipt({ requestedGross: Math.max(0, order.authorizedCap - order.spent), requestedQuantity: Math.max(0, order.targetUnits - order.receivedUnits), districtId: sites.get(order.siteId)!.districtId, siteId: order.siteId, purpose: order.topic, procurementId: `${order.id}:receipt-${order.receipts.length + 1}`, budgetId: order.id });
      if (receipt.paid > 1e-7) {
        order.receipts.push({ ...receipt, procurementId: `${order.id}:receipt-${order.receipts.length + 1}`, budgetId: order.id, purchasedAt: now() });
        order.spent += receipt.paid; order.receivedUnits += receipt.quantity;
      }
      const sufficient = order.receivedUnits - order.consumedUnits >= (order.topic === 'transport' ? 4 : 1) - 1e-7;
      order.state = sufficient ? 'active' : receipt.reason === 'budget' || order.spent >= order.authorizedCap - 1e-7 ? 'awaitingBudget' : 'awaitingSupply';
      order.lastReason = sufficient ? `材料已实际入库${order.receivedUnits.toFixed(2)}份；尚缺${Math.max(0, order.targetUnits - order.receivedUnits).toFixed(2)}份，服务仍须人员和参与者现场投入时间。` : order.state === 'awaitingBudget' ? order.spent >= order.authorizedCap - 1e-7 ? '法定授权额度已经耗尽；已有实际履约保留，缺料需经新的合法预算程序，不能免费补足。' : '必要公共工资和运维优先；本议题等待可支配财政现金。' : '有限供应商供货或实际报价未满足完整服务材料，下一次采购将继续核对财政与实物。';
    }
  });
  simulation.onPhase('politics', () => {
    for (const petition of culture().petitions) {
      if (petition.status !== 'open' || now() + 1e-7 < petition.replyAt) continue;
      const score = petition.topic === 'education' ? state().extension!.institutions.education : petition.topic === 'health' ? state().extension!.institutions.medical : state().energy;
      const name = { education: '教育', health: '医疗', transport: '交通能源' }[petition.topic];
      petition.status = 'answered'; petition.answeredAt = now();
      const order = petition.signerIds.length >= 3 ? makeOrder(petition) : null;
      petition.reply = `${name}部门公开答复：收到${petition.signerIds.length}位现场居民联署。当前服务指标${score.toFixed(1)}；${order ? '已排入实际公共服务议程，等待授权、财政采购与场所履约' : petition.signerIds.length < 3 ? '联署不足三人，未授权采购；请进一步说明共同需求' : '本区缺少合适服务设施，不能虚构采购与服务'}。政策与预算调整仍须依法审议。`;
      notice('petition', `《${petition.title}》已有公开答复，可到公告查看。`, sites.get(petition.siteId)!.districtId);
    }
    for (const order of culture().orders) {
      if (!['agenda', 'awaitingReview'].includes(order.state)) continue;
      const petition = culture().petitions.find(petition => petition.id === order.petitionId)!;
      const signers = state().citizens.filter(person => ['官员', '财政官', 'official', '议员', 'council'].includes(person.role) && simulation.isOnDuty(person.id, petition.siteId)).map(person => person.id).slice(0, 2);
      if (signers.length === 2 && authorize(order, signers, 40)) continue;
      order.state = 'awaitingReview'; order.lastReason = signers.length === 2 && simulation.publicBudgetSnapshot().available < 40 ? '现场联审人员已具备；扣除必要工资、运维和已有授权后，无40文可分配额度，保留议程待财政恢复。' : '等候两名合资格官员实际在岗联审，或当选市长到合法决策层审批。';
    }
  });
  const handled = new Set(['createWork', 'publishWork', 'publishReport', 'verifyReport', 'correctReport', 'filePetition', 'reviewPetition', 'attendService']);
  simulation.registerCommandHandler((command: Command): CommandResult | null => {
    if (!handled.has(command.type)) return null;
    const fail = (message: string): CommandResult => ({ ok: false, message });
    const c = culture(), p = state().player;
    if (!alive('player')) return fail('生命已经结束，无法创作或办理公共事务。');
    if (command.targetId !== undefined && typeof command.targetId !== 'string') return fail('文化目标须为有效标识。');
    const content = command.text, title = command.title;
    if (content !== undefined && (typeof content !== 'string' || content.length > 1200) || title !== undefined && (typeof title !== 'string' || title.length > 40)) return fail('标题最多40字，正文最多1200字。');
    if (command.type === 'reviewPetition') {
      const petition = c.petitions.find(item => item.id === command.targetId), order = c.orders.find(item => item.id === petition?.executionId);
      const decisionSite = world.buildings.find(site => simulation.isNearBuilding(site) && canReviewPetition(site, floor(site, p.position), p));
      const cap = command.value ?? 40;
      if (!decisionSite || !order || !['agenda', 'awaitingReview'].includes(order.state) || !finite(cap) || !Number.isInteger(cap) || cap !== 0 && (cap < 40 || cap > 160)) return fail('请由当选市长在真实市长决策层审批待审议题，额度须为40至160整数或0表示驳回。');
      if (cap === 0) { order.state = 'rejected'; order.completedAt = now(); order.lastReason = '有权限的市长公开驳回；未采购、未发生服务效果。'; return { ok: true, message: order.lastReason }; }
      if (!authorize(order, ['player'], cap)) return fail('公库拒绝此授权；请确认真实市长身份、法定决策位置和未重复批准的议题。');
      return { ok: true, message: `批准最高${cap}文服务额度；资金、人员与实际服务时间仍须逐项履约。` };
    }
    if (command.type === 'attendService') {
      const order = c.orders.find(item => item.id === command.targetId);
      if (!order || order.state !== 'active' || order.topic === 'transport' || !atSite(sites.get(order.siteId)!) || c.playerServiceId && c.playerServiceId !== order.id || order.servedIds.includes('player') || p.needs.hunger < 40 || p.needs.fatigue < 35 || order.topic === 'health' && state().extension!.actorProfiles.player.health >= 95) return fail('请到已采购材料的公共学堂或医馆参加服务；需要生理条件稳定、真实服务需求，且同项服务只能完成一次。');
      c.playerServiceId = order.id; return { ok: true, message: `已参加现场${order.topic === 'health' ? '诊疗' : '课程'}；必须等待在岗人员并实际投入${order.requiredMinutes}分钟，离场暂停。` };
    }
    if (command.type === 'createWork') {
      const genre = command.targetId as WorkGenre, site = nearby(['school', 'pavilion']);
      if (!Object.hasOwn(REQUIRED, genre) || !site || !content || content.trim().length < 20 || !title?.trim()) return fail('请在学堂或亭馆写下20至1200字的文学/艺术说明与标题，再开始创作。');
      if (c.project || c.works.length >= WORK_LIMIT || p.money < 60 || p.needs.hunger < 40 || p.needs.fatigue < 40) return fail('创作需要60文、体力与食物；已有项目或作品达到32件时须先处理。');
      publicPayment(60, '公共创作室材料与使用费', site);
      c.project = { genre, title: title.trim(), text: content.trim(), siteId: site.id, startedAt: now(), workedMinutes: 0, requiredMinutes: REQUIRED[genre], paid: 60 };
      notice('culture', `开始《${title.trim()}》，请在${site.name}实际创作${REQUIRED[genre]}分钟；离场、夜间或生理需要不足会暂停。`, site.districtId);
      return { ok: true, message: '作品开始创作，现场投入时间才会完成。' };
    }
    if (command.type === 'publishWork') {
      const work = c.works.find(work => work.id === command.targetId), site = nearby(['market', 'pavilion', 'hall']);
      if (!work || work.authorId !== 'player' || work.publishedAt !== null || !site || p.money < 20) return fail('需要自己的完成稿件，在公共场所支付20文发布费，不能重复发布。');
      publicPayment(20, '公共作品展陈与刊印费', site); work.siteId = site.id; work.publishedAt = now();
      notice('culture', `《${work.title}》已在${site.name}公开，居民来到现场读完后才产生传播与影响。`, site.districtId);
      return { ok: true, message: '作品已公开，真实读者将留下阅读记录。' };
    }
    if (command.type === 'publishReport') {
      const metric = command.targetId as ReportMetric, site = nearby(metric === 'budget' ? ['hall'] : ['market', 'pavilion', 'hall']);
      if (!['water', 'safety', 'budget'].includes(metric) || !site || !content || content.trim().length < 20 || content.length > 400 || p.money < 20 || c.reports.length >= REPORT_LIMIT) return fail('公开报告需要20至400字、20文与公共现场；财政聚合数仅在公共政务大厅发布。');
      const observedValue = metric === 'water' ? state().extension!.environment.waterQuality : metric === 'budget' ? state().treasury : state().districts.find(district => district.id === site.districtId)!.safety;
      const claim = command.value ?? observedValue;
      if (!finite(claim) || claim < 0 || claim > (metric === 'budget' ? 1e12 : 100)) return fail('报告主张须为该指标范围内的有限数值。');
      const report: CityReport = { id: `report-${c.nextReportId++}`, authorId: 'player', text: content.trim(), siteId: site.id, metric, claim, originalClaim: claim, evidence: { observedAt: now(), observedTick: state().tick, observedValue, districtId: site.districtId, public: true }, status: 'unchecked', publishedAt: now(), verifiedAt: null, correctedAt: null, readIds: [], reachedIds: [], readingMinutes: {}, correctionReadIds: [], correctionMinutes: {}, falseNotifiedIds: [], nextSpreadAt: now() + 30 };
      publicPayment(20, '公开城市报告登记费', site); c.reports.push(report);
      notice('information', `城市报告已公开，保留现场${metric === 'budget' ? '公开公库聚合值' : '观测值'}与观测时间供核验；读者会区分主张与依据。`, site.districtId);
      return { ok: true, message: '报告已登记；主张与证据保留，核验不会凭空发放奖励。' };
    }
    if (command.type === 'verifyReport' || command.type === 'correctReport') {
      const report = c.reports.find(report => report.id === command.targetId);
      if (!report) return fail('此报告不存在。');
      if (command.type === 'verifyReport') {
        const site = nearby(['school', 'hall']);
        if (!site || report.status !== 'unchecked' || p.money < 10) return fail('请在学堂或公共大厅支付10文核验尚未核验的报告。');
        publicPayment(10, '公共信息核验服务费', site); report.verifiedAt = now(); report.status = sameClaim(report) ? 'verified' : 'false';
        if (report.status === 'false') p.reputation = clamp(p.reputation - 3, -100, 1e8);
        notice('information', `报告核验${report.status === 'verified' ? '一致' : '不实'}：发布时观测${report.evidence.observedValue.toFixed(2)}，主张${report.claim.toFixed(2)}。`, site.districtId);
        return { ok: true, message: report.status === 'verified' ? '报告有公开证据支持。' : '报告与观测证据不符；已公开标注并产生声望与读者信任后果。' };
      }
      const site = nearby(['hall']) ?? (atSite(sites.get(report.siteId)!) ? sites.get(report.siteId)! : undefined);
      if (!site || report.authorId !== 'player' || report.status !== 'false' || p.money < 5) return fail('原作者须在原发布处或公共大厅支付5文，更正已核验的不实报告。');
      publicPayment(5, '公开报告更正刊印费', site); report.claim = report.evidence.observedValue; report.status = 'corrected'; report.correctedAt = now();
      notice('information', '已公开准确更正，原主张与核验记录继续保留；居民实际看到更正后逐步恢复部分信任。', site.districtId);
      return { ok: true, message: '更正已公开，旧误报记忆与传播记录保留。' };
    }
    const topic = command.targetId as PetitionTopic, site = nearby(['hall']);
    if (!['education', 'health', 'transport'].includes(topic) || !site || !content || content.trim().length < 20 || content.length > 400 || !title?.trim() || p.money < 10 || c.petitions.length >= PETITION_LIMIT) return fail('请在公共大厅提交标题与20至400字诉求、10文备案费；受理教育、医疗与交通议题。');
    if (c.petitions.some(petition => petition.topic === topic && petition.authorId === 'player' && petition.status === 'open') || c.orders.some(order => order.topic === topic && !['fulfilled', 'rejected'].includes(order.state))) return fail('同类请愿或服务议程尚在处理中，不能反复备案加速答复。');
    publicPayment(10, '公共请愿备案费', site);
    c.petitions.push({ id: `petition-${c.nextPetitionId++}`, authorId: 'player', topic, title: title.trim(), text: content.trim(), siteId: site.id, filedAt: now(), replyAt: now() + DAY, status: 'open', signerIds: [], reply: null, answeredAt: null, executionId: null });
    notice('petition', '请愿已备案，居民须在现场了解并联署；一天后主管部门公开回复，政策调整保留既有权限。', site.districtId);
    return { ok: true, message: '请愿已受理，公开回复将在一个游戏日后出现。' };
  });
  simulation.registerSaveValidator(candidate => validateCultureState(candidate, world));
  simulation.onLoad(() => {
    if (!state().culture) state().culture = initialize();
    else if (culture().version === 1) { Object.assign(culture(), { version: 2, nextOrderId: 1, orders: [], playerServiceId: null, transportMaintenance: {} }); for (const petition of culture().petitions) petition.executionId = null; }
  });
  installClinical(simulation);
}

export function validateCultureState(candidate: SimState, world: WorldDefinition): void {
  const c = (candidate as SimState & { culture?: CultureState }).culture; if (c === undefined) return;
  const ensure = (value: unknown, label: string): void => { if (!value) throw new Error(`文化存档无效：${label}`); };
  const num = (value: unknown, min: number, max: number, label: string, integer = false) => ensure(finite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const array = (value: unknown, max: number, label: string): any[] => { ensure(Array.isArray(value) && value.length <= max, label); return value as any[]; };
  const str = (value: unknown, min: number, max: number, label: string) => ensure(typeof value === 'string' && value.length >= min && value.length <= max, label);
  const sites = new Map(world.buildings.map(site => [site.id, site])), ids = new Set(['player', ...candidate.citizens.map(person => person.id)]);
  const memberList = (value: unknown, label: string): string[] => { const members = array(value, 1024, label); ensure(new Set(members).size === members.length && members.every(id => ids.has(id) && id !== 'player'), label); return members; };
  const progress = (value: unknown, max: number, label: string) => { ensure(object(value) && Object.keys(value).length <= 1024, label); for (const [id, minutes] of Object.entries(value as Record<string, unknown>)) { ensure(ids.has(id) && id !== 'player', `${label}角色`); num(minutes, 0, max, label); } };
  ensure(object(c) && [1, 2].includes(c.version) && !!candidate.extension, '版本'); num(c.lastUpdate, 0, 1e12, '时钟'); ensure(Math.abs(c.lastUpdate - candidate.extension!.lastUpdate) < 1e-6, '单调时钟');
  for (const counter of [c.nextWorkId, c.nextReportId, c.nextPetitionId]) num(counter, 1, 1e9, '序号', true);
  if (c.project !== null) {
    const p = c.project; ensure(object(p) && Object.hasOwn(REQUIRED, p.genre) && ['school', 'pavilion'].includes(sites.get(p.siteId)?.kind ?? ''), '创作项目');
    str(p.title, 1, 40, '创作标题'); str(p.text, 20, 1200, '创作正文'); num(p.startedAt, 0, c.lastUpdate, '开始时间'); num(p.requiredMinutes, REQUIRED[p.genre], REQUIRED[p.genre], '实际所需时间'); num(p.workedMinutes, 0, p.requiredMinutes - 1e-7, '实际投入时间'); num(p.paid, 60, 60, '创作室资金');
    ensure(p.workedMinutes <= c.lastUpdate - p.startedAt + 1e-7, '不能凭空累计创作时间');
  }
  const workIds = new Set<string>();
  for (const work of array(c.works, WORK_LIMIT, '作品')) {
    ensure(object(work) && /^work-[1-9][0-9]*$/.test(work.id) && Number(work.id.slice(5)) < c.nextWorkId && !workIds.has(work.id) && work.authorId === 'player' && Object.hasOwn(REQUIRED, work.genre), '作品标识'); workIds.add(work.id);
    str(work.title, 1, 40, '作品标题'); str(work.text, 20, 1200, '作品正文'); num(work.quality, 0, 100, '品质'); num(work.createdAt, 0, c.lastUpdate, '完成时间');
    num(work.startedAt, 0, work.createdAt, '作品开始'); num(work.workedMinutes, REQUIRED[work.genre as WorkGenre], REQUIRED[work.genre as WorkGenre], '完成须实际投入'); ensure(work.createdAt - work.startedAt >= work.workedMinutes - 1e-7, '实际创作时间证据');
    const workSite = sites.get(work.siteId);
    ensure(work.publishedAt === null && work.siteId === null || finite(work.publishedAt) && work.publishedAt >= work.createdAt && work.publishedAt <= c.lastUpdate && !!workSite && (['market', 'pavilion'].includes(workSite.kind) || civicSite(workSite)), '发布地点时间');
    const readers = memberList(work.readIds, '作品读者'); progress(work.readingMinutes, 15, '作品阅读'); ensure(readers.every(id => work.readingMinutes[id] >= 15 - 1e-7), '必须实际读完'); if (work.siteId === null) ensure(!readers.length && !Object.keys(work.readingMinutes).length, '私稿无公共读者');
  }
  const reportIds = new Set<string>();
  for (const r of array(c.reports, REPORT_LIMIT, '公开报告')) {
    ensure(object(r) && /^report-[1-9][0-9]*$/.test(r.id) && Number(r.id.slice(7)) < c.nextReportId && !reportIds.has(r.id) && ids.has(r.authorId) && ['water', 'safety', 'budget'].includes(r.metric), '报告标识'); reportIds.add(r.id);
    const site = sites.get(r.siteId); ensure(site && (r.metric === 'budget' ? civicSite(site) : ['market', 'pavilion'].includes(site.kind) || civicSite(site)), '公共发布位置'); str(r.text, 20, 400, '报告正文');
    const max = r.metric === 'budget' ? 1e12 : 100; num(r.claim, 0, max, '主张'); num(r.originalClaim, 0, max, '原主张'); num(r.publishedAt, 0, c.lastUpdate, '报告时间');
    ensure(object(r.evidence) && r.evidence.public === true && r.evidence.districtId === site!.districtId, '公开依据'); num(r.evidence.observedAt, r.publishedAt, r.publishedAt, '观测时间'); num(r.evidence.observedTick, 0, candidate.tick, '观测tick', true); num(r.evidence.observedValue, 0, max, '权威观测值');
    ensure(['unchecked', 'verified', 'false', 'corrected'].includes(r.status), '核验状态');
    if (r.status === 'unchecked') ensure(r.verifiedAt === null && r.correctedAt === null && r.claim === r.originalClaim, '未核验');
    else { num(r.verifiedAt, r.publishedAt, c.lastUpdate, '核验时间'); ensure(r.status === 'verified' ? sameClaim(r) : Math.abs(r.originalClaim - r.evidence.observedValue) > 1e-7, '核验结论必须来自依据'); }
    if (r.status === 'corrected') { num(r.correctedAt, r.verifiedAt!, c.lastUpdate, '更正时间'); ensure(sameClaim(r), '更正须准确'); } else ensure(r.correctedAt === null && r.claim === r.originalClaim, '原主张保留');
    const readers = memberList(r.readIds, '报告读者'), reached = memberList(r.reachedIds, '传播居民'), corrected = memberList(r.correctionReadIds, '更正读者'), falseNotified = memberList(r.falseNotifiedIds, '误报通知');
    progress(r.readingMinutes, 10, '报告阅读'); progress(r.correctionMinutes, 5, '更正阅读');
    ensure(readers.every(id => reached.includes(id) && r.readingMinutes[id] >= 10 - 1e-7) && corrected.every(id => readers.includes(id) && r.correctionMinutes[id] >= 5 - 1e-7) && falseNotified.every(id => readers.includes(id)), '阅读传播引用');
    if (r.status !== 'corrected') ensure(!corrected.length && !Object.keys(r.correctionMinutes).length, '未更正无恢复');
    if (!['false', 'corrected'].includes(r.status)) ensure(!falseNotified.length, '未经证据不得误报惩罚'); num(r.nextSpreadAt, r.publishedAt, 1e12, '传播冷却');
  }
  const petitionIds = new Set<string>();
  for (const petition of array(c.petitions, PETITION_LIMIT, '请愿')) {
    ensure(object(petition) && /^petition-[1-9][0-9]*$/.test(petition.id) && Number(petition.id.slice(9)) < c.nextPetitionId && !petitionIds.has(petition.id) && ids.has(petition.authorId) && ['education', 'health', 'transport'].includes(petition.topic) && !!sites.get(petition.siteId) && civicSite(sites.get(petition.siteId)!), '请愿标识'); petitionIds.add(petition.id);
    str(petition.title, 1, 40, '请愿标题'); str(petition.text, 20, 400, '请愿正文'); num(petition.filedAt, 0, c.lastUpdate, '备案时间'); num(petition.replyAt, petition.filedAt + DAY, petition.filedAt + DAY, '一天程序期限'); memberList(petition.signerIds, '现场联署');
    ensure(['open', 'answered'].includes(petition.status), '办理状态');
    if (petition.status === 'open') ensure(petition.reply === null && petition.answeredAt === null, '办理中不编造答复');
    else { str(petition.reply, 1, 1000, '公开答复'); num(petition.answeredAt, petition.replyAt, c.lastUpdate, '实际答复时间'); }
  }
  if (c.version === 1) { ensure(c.orders === undefined && c.nextOrderId === undefined && c.playerServiceId === undefined && c.transportMaintenance === undefined, '旧版本不能夹带未校验履约数据'); return; }
  num(c.nextOrderId, 1, 1e9, '服务议程序号', true);
  const orderIds = new Set<string>(), shopIds = new Set(candidate.shops.map(shop => shop.id));
  for (const order of array(c.orders, PETITION_LIMIT, '服务议程')) {
    ensure(object(order) && /^service-[1-9][0-9]*$/.test(order.id) && Number(order.id.slice(8)) < c.nextOrderId && !orderIds.has(order.id) && Object.hasOwn(SERVICE, order.topic), '议程标识'); orderIds.add(order.id);
    const petition = c.petitions.find(petition => petition.id === order.petitionId), site = sites.get(order.siteId), rule = SERVICE[order.topic as PetitionTopic];
    ensure(!!petition && petition.executionId === order.id && petition.status === 'answered' && petition.signerIds.length >= 3 && petition.topic === order.topic && !!site && site.kind === rule.kind && site.districtId === sites.get(petition.siteId)!.districtId, '议程必须对应真实程序及本区设施');
    ensure(['agenda', 'awaitingReview', 'awaitingBudget', 'awaitingSupply', 'active', 'fulfilled', 'rejected'].includes(order.state), '履约状态');
    num(order.scheduledAt, petition!.replyAt, c.lastUpdate, '排入议程时间'); num(order.targetUnits, rule.units, rule.units, '法定服务数量'); num(order.requiredMinutes, rule.minutes, rule.minutes, '服务所需时数'); num(order.retryAt, order.scheduledAt, 1e12, '采购重试时钟'); str(order.lastReason, 1, 1000, '议程公开原因');
    const signers = array(order.approvedBy, 2, '授权署名'); ensure(new Set(signers).size === signers.length && signers.every(id => ids.has(id)), '授权署名引用');
    num(order.authorizedCap, 0, 160, '已批准额度', true); num(order.spent, 0, order.authorizedCap, '实际采购支出'); num(order.receivedUnits, 0, rule.units + 1e-7, '实际采购材料'); num(order.consumedUnits, 0, order.receivedUnits + 1e-7, '服务耗用材料', true);
    const receipts = array(order.receipts, 64, '采购凭证'); let paid = 0, received = 0;
    for (let index = 0; index < receipts.length; index++) {
      const receipt = receipts[index]; ensure(object(receipt) && receipt.budgetId === order.id && receipt.procurementId === `${order.id}:receipt-${index + 1}`, '采购唯一关联'); num(receipt.purchasedAt, order.approvedAt, c.lastUpdate, '采购真实时间'); num(receipt.paid, 1e-7, 160, '采购实付'); num(receipt.quantity, 1e-7, rule.units, '采购数量'); num(receipt.tax, 0, receipt.paid, '采购税收');
      ensure(receipt.reason === undefined || ['budget', 'supply', 'authorization'].includes(receipt.reason), '真实采购缺口原因');
      const lots = array(receipt.lots, candidate.shops.length, '实际供应商批次'); let gross = 0, quantity = 0, net = 0;
      for (const lot of lots) { ensure(object(lot) && shopIds.has(lot.shopId), '实际供应商引用'); num(lot.unitPrice, 1e-7, 1e6, '实际报价'); num(lot.quantity, 1e-7, rule.units, '供货库存数量'); num(lot.gross, 1e-7, receipt.paid, '供应商销售总款'); num(lot.net, 0, lot.gross, '供应商实际到账'); ensure(Math.abs(lot.gross - lot.quantity * lot.unitPrice) < 1e-6, '真实报价与供货相符'); gross += lot.gross; quantity += lot.quantity; net += lot.net; }
      ensure(Math.abs(gross - receipt.paid) < 1e-6 && Math.abs(quantity - receipt.quantity) < 1e-6 && Math.abs(gross - net - receipt.tax) < 1e-6, '采购凭证收款及税守恒'); paid += receipt.paid; received += receipt.quantity;
    }
    ensure(Math.abs(paid - order.spent) < 1e-6 && Math.abs(received - order.receivedUnits) < 1e-6, '采购支出库存必须来自凭证');
    const served = array(order.servedIds, rule.units, '实际受益人'), staff = memberList(order.staffIds, '实际服务工作人员'); ensure(new Set(served).size === served.length && served.every(id => ids.has(id)), '受益主体引用');
    ensure(object(order.serviceMinutes) && Object.keys(order.serviceMinutes).length <= 1025, '现场服务累计');
    for (const [id, minutes] of Object.entries(order.serviceMinutes)) { ensure(ids.has(id), '服务计时主体'); num(minutes, 0, rule.minutes, '服务实际分钟'); ensure(order.approvedAt !== null && receipts.length > 0 && (minutes as number) <= c.lastUpdate - receipts[0].purchasedAt + 1e-7, '不得凭空累积服务时间'); }
    ensure(served.every(id => order.serviceMinutes[id] >= rule.minutes - 1e-7) && (!served.length || staff.length > 0), '材料与现场人员时数共同完成服务');
    if (order.topic === 'transport') ensure(order.consumedUnits === (served.length ? rule.units : 0) && served.length <= 1 && served.every(id => staff.includes(id)), '真实工作人员履约维修'); else ensure(order.consumedUnits === served.length, '服务一人实际耗用一份');
    if (order.approvedAt === null) ensure(!signers.length && order.authorizedCap === 0 && order.spent === 0 && order.receivedUnits === 0 && order.consumedUnits === 0 && !Object.keys(order.serviceMinutes).length && ['agenda', 'awaitingReview', 'rejected'].includes(order.state), '未授权不得采购履约');
    else { num(order.approvedAt, order.scheduledAt, c.lastUpdate, '真实批准时刻'); ensure(order.authorizedCap >= 40 && (signers.length === 1 && signers[0] === 'player' || signers.length === 2 && !signers.includes('player') && order.authorizedCap === 40), '法定权限与小额联合审批'); }
    if (order.state === 'fulfilled') { num(order.completedAt, order.approvedAt! + rule.minutes, c.lastUpdate, '实际履约完成时间'); ensure(order.consumedUnits === rule.units, '必须全部真实履约'); }
    else if (order.state === 'rejected') num(order.completedAt, order.scheduledAt, c.lastUpdate, '驳回时刻'); else ensure(order.completedAt === null, '未履约不得写完成时间');
  }
  for (const petition of c.petitions) ensure(petition.executionId === null || typeof petition.executionId === 'string' && orderIds.has(petition.executionId), '公开答复关联实际议程');
  ensure(c.playerServiceId === null || typeof c.playerServiceId === 'string' && c.orders.some(order => order.id === c.playerServiceId && order.state === 'active' && order.topic !== 'transport' && !order.servedIds.includes('player')), '玩家参与真实未完成服务');
  ensure(object(c.transportMaintenance) && Object.keys(c.transportMaintenance).length <= world.buildings.length, '交通维护记录');
  for (const [siteId, maintenance] of Object.entries(c.transportMaintenance)) { const order = c.orders.find(order => order.id === maintenance.orderId); ensure(!!order && order.siteId === siteId && order.topic === 'transport' && order.state === 'fulfilled' && maintenance.units === 4 && maintenance.maintainedUntil === order.completedAt! + 7 * DAY, '交通维护来自真实维修履约'); }
}
