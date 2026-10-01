import type { Simulation } from '../simulation';
import { canAccessFloor } from '../access';
import type { Building, Citizen, Command, CommandResult, Role, SimState, WorldDefinition } from '../types';

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
export interface CivicPetition { id: string; authorId: string; topic: PetitionTopic; title: string; text: string; siteId: string; filedAt: number; replyAt: number; status: 'open' | 'answered'; signerIds: string[]; reply: string | null; answeredAt: number | null }
export interface CultureState { version: 1; lastUpdate: number; nextWorkId: number; nextReportId: number; nextPetitionId: number; project: CultureProject | null; works: CulturalWork[]; reports: CityReport[]; petitions: CivicPetition[] }
const DAY = 1440;
const WORK_LIMIT = 32, REPORT_LIMIT = 32, PETITION_LIMIT = 16;
const REQUIRED: Record<WorkGenre, number> = { literature: 120, art: 180 };
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sameClaim = (report: Pick<CityReport, 'claim' | 'evidence'>) => Math.abs(report.claim - report.evidence.observedValue) <= 1e-7;
export const civicSite = (site: Building) => site.kind === 'hall' || site.kind === 'core' && site.facility === 'mayor';
export const publicFloor = (site: Building, level: number) => level >= 0 && level < site.floors && (site.floorPermissions?.[level] ? site.floorPermissions[level] === 'public' : site.publicFloors === undefined || level < site.publicFloors);

/** Public cultural activity uses existing facilities, actors and ten-phase hooks. */
export function installCulture(simulation: Simulation): void {
  const world = simulation.worldDefinition, sites = new Map(world.buildings.map(site => [site.id, site]));
  const state = () => simulation.state as SimState & { culture?: CultureState };
  const culture = () => state().culture!;
  const now = () => state().extension!.lastUpdate;
  const initialize = (): CultureState => ({ version: 1, lastUpdate: now(), nextWorkId: 1, nextReportId: 1, nextPetitionId: 1, project: null, works: [], reports: [], petitions: [] });
  state().culture = initialize();
  const notice = (type: string, text: string, districtId?: string) => { simulation.appendNotice(type, text, districtId); simulation.emitEvent({ type: `extension:${type}`, districtId }); };
  const alive = (id: string) => state().extension!.actorProfiles[id]?.alive === true;
  const floor = (site: Building, position: { y: number }) => Math.floor((position.y - site.position.y + .01) / (site.height / Math.max(1, site.floors)));
  const atSite = (site: Building) => simulation.isNearBuilding(site) && publicFloor(site, floor(site, state().player.position)) && canAccessFloor(site, floor(site, state().player.position), state().player);
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
    return publicFloor(site, floor(site, citizen.position)) && canAccessFloor(site, floor(site, citizen.position), { role, identities: [role] });
  });
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
  });
  simulation.onPhase('politics', () => {
    for (const petition of culture().petitions) {
      if (petition.status !== 'open' || now() + 1e-7 < petition.replyAt) continue;
      const score = petition.topic === 'education' ? state().extension!.institutions.education : petition.topic === 'health' ? state().extension!.institutions.medical : state().energy;
      const name = { education: '教育', health: '医疗', transport: '交通能源' }[petition.topic];
      petition.status = 'answered'; petition.answeredAt = now();
      petition.reply = `${name}部门公开答复：收到${petition.signerIds.length}位现场居民联署。当前服务指标${score.toFixed(1)}；已登记议题与预算需求，${petition.signerIds.length >= 3 ? '提交下一轮公共议事讨论' : '等待更多居民说明实际需求'}。政策与预算调整仍须议会及市长按权限审议。`;
      state().support = clamp(state().support + Math.min(.5, petition.signerIds.length * .03));
      notice('petition', `《${petition.title}》已有公开答复，可到公告查看。`, sites.get(petition.siteId)!.districtId);
    }
  });
  const handled = new Set(['createWork', 'publishWork', 'publishReport', 'verifyReport', 'correctReport', 'filePetition']);
  simulation.registerCommandHandler((command: Command): CommandResult | null => {
    if (!handled.has(command.type)) return null;
    const fail = (message: string): CommandResult => ({ ok: false, message });
    const c = culture(), p = state().player;
    if (!alive('player')) return fail('生命已经结束，无法创作或办理公共事务。');
    if (command.targetId !== undefined && typeof command.targetId !== 'string') return fail('文化目标须为有效标识。');
    const content = command.text, title = command.title;
    if (content !== undefined && (typeof content !== 'string' || content.length > 1200) || title !== undefined && (typeof title !== 'string' || title.length > 40)) return fail('标题最多40字，正文最多1200字。');
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
    if (c.petitions.some(petition => petition.topic === topic && petition.authorId === 'player' && petition.status === 'open')) return fail('同类请愿尚在处理中，不能反复备案加速答复。');
    publicPayment(10, '公共请愿备案费', site);
    c.petitions.push({ id: `petition-${c.nextPetitionId++}`, authorId: 'player', topic, title: title.trim(), text: content.trim(), siteId: site.id, filedAt: now(), replyAt: now() + DAY, status: 'open', signerIds: [], reply: null, answeredAt: null });
    notice('petition', '请愿已备案，居民须在现场了解并联署；一天后主管部门公开回复，政策调整保留既有权限。', site.districtId);
    return { ok: true, message: '请愿已受理，公开回复将在一个游戏日后出现。' };
  });
  simulation.registerSaveValidator(candidate => validateCultureState(candidate, world));
  simulation.onLoad(() => { if (!state().culture) state().culture = initialize(); });
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
  ensure(object(c) && c.version === 1 && !!candidate.extension, '版本'); num(c.lastUpdate, 0, 1e12, '时钟'); ensure(Math.abs(c.lastUpdate - candidate.extension!.lastUpdate) < 1e-6, '单调时钟');
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
}
