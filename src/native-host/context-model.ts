/**
 * Headless context panel for native clients: the same nearby-target choice,
 * button set and enablement rules as the web context panel (src/ui.ts
 * refreshContext/buildingActions/aircraftContent), returned as data. Every
 * button is still only a request; Simulation.command remains the authority.
 */
import type { Simulation } from '../simulation';
import { FLOOR_PLAN_PROFILE } from '../architecture-floor-plan';
import { aircraftBoardingBlockedReason, activeAircraft, getAviationPads } from '../aviation';
import { HOME_REST_MINUTES, homeRestBlockedReason } from '../simulation/home-rest';
import { educationAtPosition, educationServiceStationsAtPosition } from '../simulation/education';
import { clinicalAtPosition, clinicalVisitDeadline } from '../simulation/clinical';
import { shopLifecycleAllowsSpaceUse } from '../simulation/shop_lifecycle';
import { powerBinding } from '../simulation/power';
import { governanceSupported } from '../simulation/governance';
import type { AerialVehicle, Building, BuildingFunctionPoint, BuildingKind, Citizen, Command, Company, Relationship, Role, SimState, TransportMode, Vec3, Vehicle, ViewMode, WorldDefinition } from '../types';

export interface ContextView { mode?: ViewMode; inside?: string | null; bankAmount?: number }
/** `interact` asks the client to run its door/stair/vehicle interaction (E). */
export interface ContextAction { label: string; command?: Command; client?: 'interact'; disabled: boolean }
export interface ContextSection { kind: 'building' | 'citizen' | 'vehicle' | 'aircraft'; id: string; eyebrow: string; title: string; subtitle: string; actions: ContextAction[]; notes: string[] }
export interface ContextModelResult { sections: ContextSection[] }

export const roleNames: Record<string, string> = { traveler: '星际旅行者', police: '警察', soldier: '卫士', teacher: '教师', driver: '驾驶员', merchant: '商人', mayor: '市长', scientist: '科研人员', official: '公务员', council: '议员' };
export const kindNames: Record<BuildingKind, string> = { home: '住宅', market: '市集', workshop: '工坊', bank: '钱庄', hall: '官署', police: '巡检司', school: '书院', clinic: '医馆', station: '车站', core: '市政中枢', pavilion: '山顶亭', airport: '机场', starport: '星港', farm: '农场', dock: '码头' };
export const modeNames: Record<TransportMode, string> = { road: '道路', maglev: '磁悬浮', lightRail: '轻轨', cable: '缆车', lift: '升降井', ferry: '渡船', bridge: '索桥', flight: '航班' };
const activityNames: Record<string, string> = { sleeping: '睡眠中', working: '工作中', moving: '行进中', atHome: '在家', shopping: '购物中', socializing: '社交中', studying: '学习中', healing: '诊疗中', riding: '乘车中', dead: '已故', waiting: '等待发车', boarding: '登乘中', departing: '正在离站', arriving: '正在进站', congested: '拥堵等待' };
const relationNames: Record<string, string> = { stranger: '陌生人', acquaintance: '相识', friend: '朋友', closeFriend: '好友', lover: '恋人', spouse: '配偶', rival: '竞争者', foe: '仇敌', enemy: '敌人' };
export const romanceNames = { single: '单身', crush: '暗恋', pursuit: '追求中', dating: '交往中', engaged: '订婚', married: '已婚', family: '共同家庭' };
export const hostilityNames = { none: '无敌意', discontent: '不满', rivalry: '竞争', feud: '仇敌', enemy: '敌人', mortalEnemy: '死敌' };
const hostilityRank = { none: 0, discontent: 1, rivalry: 2, feud: 3, enemy: 4, mortalEnemy: 5 };
export const activity = (value: string) => activityNames[value] ?? value;
export const romanceStage = (rel: Relationship): keyof typeof romanceNames => rel.romanceStage ?? (rel.type === 'spouse' ? 'married' : rel.type === 'lover' ? 'dating' : 'single');
export const hostilityStage = (rel: Relationship): keyof typeof hostilityNames => rel.hostilityStage ?? (rel.type === 'enemy' ? 'enemy' : rel.type === 'foe' ? 'feud' : rel.type === 'rival' ? 'rivalry' : 'none');
export const relationshipTitle = (rel: Relationship): string => {
  const romance = romanceStage(rel), hostility = hostilityStage(rel);
  return [...new Set([relationNames[rel.type] ?? rel.type, ...(romance !== 'single' ? [romanceNames[romance]] : []), ...(hostility !== 'none' ? [hostilityNames[hostility]] : [])])].join(' · ');
};
export const money = (n: number) => `${(Math.trunc(n * 100) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 云币`;
const rounded = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('zh-CN');
const spatialDistance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const playerLaborLabel = (state: SimState): string => state.playerLabor?.job ? '已有工班 · 回到原场所继续' : '开始 60 分钟现场工班';
export const button = (label: string, type: Command['type'], targetId?: string, value?: number, disabled = false): ContextAction => ({ label, command: { type, ...(targetId ? { targetId } : {}), ...(value !== undefined ? { value } : {}) }, disabled });

export class ContextRules {
  readonly state: SimState;
  constructor(readonly sim: Simulation, readonly world: WorldDefinition, readonly view: Required<Pick<ContextView, 'mode'>> & ContextView) { this.state = sim.state; }
  hasRole(...roles: string[]): boolean { const player = this.state.player; return roles.some(role => (player.identities ?? [player.role]).includes(role as Role)); }
  /** The web 公共治理 panel without sliders: each button submits the whole
   * proposed scheme one step away, through the same 'policy' command. */
  policyActions(building: Building, actions: ContextAction[], notes: string[]): void {
    const state = this.state, motion = state.governance?.motions.find(m => ['debating', 'approved'].includes(m.status));
    const base = motion ?? state.policyPending ?? state, tax = Math.round(base.taxRate * 100), police = Math.round(base.policeBudget * 100);
    notes.push(`市政方案：营业税率 ${tax}% · 治安预算 ${police}%${motion || state.policyPending ? `（待生效；现行 ${Math.round(state.taxRate * 100)}% / ${Math.round(state.policeBudget * 100)}%）` : ''}。`);
    notes.push(motion ? '当前议案等待议员表决与生效，不可用新方案覆盖。' : governanceSupported(this.world) && this.hasRole('mayor') ? '请在议事功能点提交方案；过半且至少两名具名议员现场赞成后，最早两小时生效。' : state.policyPending ? `方案待执行 · 当前税率 ${Math.round(state.taxRate * 100)}%，治安预算 ${Math.round(state.policeBudget * 100)}%。` : this.hasRole('mayor') ? '请在官署提交方案；两个游戏小时后影响税收与公共治安。' : '到官署参选成为市长后，可提交治理方案。');
    if (!this.hasRole('mayor')) return;
    const disabled = this.view.mode !== 'walk' || !!motion;
    const scheme = (label: string, taxPercent: number, policePercent: number, blocked: boolean): ContextAction =>
      ({ label, command: { type: 'policy', targetId: building.id, taxRate: taxPercent / 100, policeBudget: policePercent / 100 }, disabled: disabled || blocked });
    actions.push(
      scheme(`提交税率 ${tax - 1}%`, tax - 1, police, tax <= 0), scheme(`提交税率 ${tax + 1}%`, tax + 1, police, tax >= 30),
      scheme(`提交治安预算 ${police - 5}%`, tax, police - 5, police < 5), scheme(`提交治安预算 ${police + 5}%`, tax, police + 5, police > 95));
  }
  canWorkAt(kind: BuildingKind): boolean {
    const workplaces: Record<string, BuildingKind[]> = { traveler: ['market', 'workshop', 'farm', 'dock'], police: ['police'], soldier: ['police', 'starport'], teacher: ['school'], driver: ['station', 'airport', 'starport', 'dock'], merchant: ['market', 'workshop', 'farm'], mayor: ['hall', 'core'], scientist: ['school', 'core', 'workshop'], official: ['hall', 'core'], council: ['hall', 'core'] };
    return Object.entries(workplaces).some(([role, kinds]) => this.hasRole(role) && kinds.includes(kind));
  }
  canAct(): boolean { return this.view.mode === 'walk' && !this.state.aviation?.activeAircraftId && this.state.extension?.actorProfiles.player?.alive !== false; }
  atBuilding(id: string, purpose?: BuildingFunctionPoint['purpose']): boolean {
    if (!this.canAct()) return false;
    const building = this.world.buildings.find(b => b.id === id);
    if (!building) return false;
    if (building.floorPlanProfile === FLOOR_PLAN_PROFILE) return this.sim.isAtBuildingFunctionPoint(building, this.state.player.position, purpose);
    const p = this.state.player.position;
    const minY = building.position.y - (building.basements ?? 0) * building.height / building.floors - 1;
    const inside = this.view.inside === id && Math.abs(p.x - building.position.x) <= building.width / 2 + .5 && Math.abs(p.z - building.position.z) <= building.depth / 2 + .5 && p.y >= minY && p.y <= building.position.y + building.height + 1;
    if (inside) return true;
    return Math.hypot(p.x - building.door.x, p.y - building.door.y, p.z - building.door.z) <= 32;
  }
  atKind(...kinds: BuildingKind[]): boolean { return this.world.buildings.some(b => kinds.includes(b.kind) && this.atBuilding(b.id)); }
  pointAvailable(building: Building, purpose?: BuildingFunctionPoint['purpose']): boolean { return building.floorPlanProfile !== FLOOR_PLAN_PROFILE || this.atBuilding(building.id, purpose); }
  canStartTreatment(patientId = 'player'): boolean {
    const state = this.state, payer = state.extension?.actorProfiles.player;
    if (!this.canAct() || !payer?.alive || payer.age < 18 || state.player.money < 30) return false;
    const patient = patientId === 'player' ? state.player : state.citizens.find(person => person.id === patientId), profile = state.extension?.actorProfiles[patientId];
    if (!patient || !profile?.alive || profile.health <= 0 || profile.health >= 100 || state.clinical?.orders.some(order => order.patientId === patientId && !['completed', 'cancelled'].includes(order.state)) || clinicalVisitDeadline(state, patientId) > (state.extension?.lastUpdate ?? 0)) return false;
    const patientPermission = patientId === 'player' ? state.player : { role: 'traveler' as const, identities: ['traveler' as const] };
    return this.world.buildings.some(site => clinicalAtPosition(site, state.player.position, state.player) && clinicalAtPosition(site, patient.position, patientPermission) && state.citizens.some(doctor => doctor.id !== patientId && doctor.workId === site.id && ['医生', 'doctor'].includes(doctor.role) && state.extension?.actorProfiles[doctor.id]?.alive && (state.extension.actorProfiles[doctor.id]?.age ?? 0) >= 18));
  }
  controlled(company: Company): boolean { return (company.shareholders.player ?? 0) > company.shares / 2; }
  socialClock(): number { return this.state.extension?.lastUpdate ?? this.state.day * 1440 + this.state.hour * 60; }
  romanceAge(rel: Relationship): number { return Math.max(0, this.socialClock() - (rel.romanceSince ?? this.socialClock())); }
  homeRestAvailable(building: Building): boolean {
    const state = this.state, session = state.homeRest?.session;
    return session?.state !== 'active' && (!session || session.buildingId === building.id) && !homeRestBlockedReason(state, building, session?.pointId);
  }
  studyAvailable(site: Building): boolean {
    const state = this.state, course = state.education?.course;
    if (!this.canAct() || !educationAtPosition(site, state.player.position, state.player, state.voxels) || state.player.vehicleId || state.aviation?.activeAircraftId || state.player.needs.hunger < 40 || state.player.needs.fatigue < 35) return false;
    const job = state.playerLabor?.job, project = state.culture?.project;
    const workNet = job ? Math.min(.25 * state.speed, job.requiredMinutes - job.workedMinutes) * job.ratePerMinute * (1 - state.taxRate) : 0;
    if (job && ['working', 'paused'].includes(job.status) && job.siteId === site.id && job.escrow > 0 && this.hasRole(job.role) && state.hour >= 6 && state.hour < 21 && state.player.money + workNet <= 1e9 && this.pointAvailable(site, 'work')) return false;
    if (project?.siteId === site.id && project.workedMinutes < project.requiredMinutes && state.hour >= 7 && state.hour < 22 && state.player.needs.fatigue >= 40) return false;
    if (course) return course.cancelledAt === null && course.siteId === site.id && (site.floorPlanProfile !== FLOOR_PLAN_PROFILE || educationServiceStationsAtPosition(site, state.player.position, state.player, state.voxels).some(point => point.id === course.pointId && point.floor === course.floor));
    return state.player.money >= 40 && state.player.education < 1e8 && state.player.experience < 1e8 && (!state.education || state.education.nextId < 1e9) && state.hour >= 8 && state.hour < 17 && state.citizens.some(teacher => teacher.workId === site.id && ['老师', 'teacher'].includes(teacher.role) && state.extension?.actorProfiles[teacher.id]?.alive && (state.extension.actorProfiles[teacher.id]?.age ?? 0) >= 18);
  }

  buildingActions(building: Building, disabled: boolean): { actions: ContextAction[]; notes: string[] } {
    const actions: ContextAction[] = [], notes: string[] = [], state = this.state;
    const siteDisabled = disabled || !this.pointAvailable(building);
    const workDisabled = disabled || !this.pointAvailable(building, 'work');
    const saleDisabled = disabled || !this.pointAvailable(building, 'sale');
    const serviceDisabled = disabled || !this.pointAvailable(building, 'service');
    const kind = building.kind;
    const shop = state.shops.find(s => s.buildingId === building.id);
    const lifecycleCompany = state.extension?.companies.find(company => company.shopBindingReleasedAt === undefined && company.buildingId === building.id);
    if (shop && kind === 'market' && (!lifecycleCompany || lifecycleCompany.shopBindingId === shop.id)) {
      const lifecycle = state.shopLifecycle, title = lifecycle?.titles[shop.id], listing = lifecycle?.listings.find(item => item.id === title?.listingId && item.state === 'offered');
      const lease = lifecycle?.leases.find(item => item.shopId === shop.id && item.state !== 'ended');
      if (listing && listing.sellerId !== 'player') actions.push(button(listing.kind === 'sale' ? `购买原店资产 · 买价${money(listing.price)}＋注资200＋登记50` : `承租经营资产 · 日租${money(listing.price)}＋押金${money(listing.deposit)}＋注资200＋登记50`, listing.kind === 'sale' ? 'buyShop' : 'leaseShop', listing.id, 200, workDisabled || !this.hasRole('merchant')));
      const operatorIsPlayer = lifecycleCompany ? lifecycleCompany.ownerId === 'player' && (lifecycleCompany.shareholders.player ?? 0) > lifecycleCompany.shares / 2 : shop.ownerId === 'player';
      if (operatorIsPlayer) {
        actions.push(button('注入本人营运资金 · 200 云币', 'fundShop', shop.id, 200, workDisabled || state.player.money < 300));
        if (!title || title.state === 'operating') actions.push(button('由本人办理停业', 'suspendShop', shop.id, undefined, workDisabled));
        if (title?.state === 'suspended' && !listing) actions.push(button('采购修缮物料并申请重开 · 60员工分钟', 'restartShop', shop.id, undefined, workDisabled || !shopLifecycleAllowsSpaceUse(state, shop.id)));
        if (title?.state === 'suspended' && title.assetOwnerId === 'player' && !listing && !lease && !lifecycleCompany) actions.push(button('授权出售经营资产 · 100 云币', 'listShopForSale', shop.id, 100, workDisabled), button('授权经营资产出租 · 日租25/押金50/七日', 'listShopForLease', shop.id, 25, workDisabled));
        if (listing?.sellerId === 'player') actions.push(button('撤回本人挂牌', 'withdrawShopListing', shop.id, undefined, workDisabled));
        if (lease?.tenantId === 'player') actions.push(button(`付欠租 · ${money(lease.arrears)}`, 'payShopRent', shop.id, undefined, workDisabled || lease.arrears <= 0), button('办理退租并清押金', 'endShopLease', shop.id, undefined, workDisabled));
      }
      if (title) notes.push(`经营状态：${title.state === 'operating' ? '允许经营' : title.state === 'reopening' ? `修缮${title.reopen?.workedMinutes.toFixed(1) ?? 0}/60员工分钟` : '已停业'}。${lease ? `租约${lease.state === 'defaulted' ? '违约' : '履行中'}，欠租${money(lease.arrears)}，押金托管${money(lease.depositEscrow)}。` : ''}`);
    }
    if (kind === 'home') actions.push(button('租住 · 80 云币', 'rent', building.id, undefined, siteDisabled), button(building.floorPlanProfile === FLOOR_PLAN_PROFILE ? state.homeRest?.session?.state === 'paused' ? '继续床旁休息' : `床旁休息 · ${HOME_REST_MINUTES} 分钟` : '休息', 'rest', building.id, undefined, building.floorPlanProfile === FLOOR_PLAN_PROFILE ? disabled || !this.homeRestAvailable(building) : serviceDisabled));
    if (state.homeRest?.session) actions.push(button('结束休息', 'cancelRest'));
    if (shop && ['market', 'farm', 'dock', 'workshop'].includes(kind)) {
      const materials = kind === 'workshop';
      actions.push(button(materials ? `购买工业物料 · ${money(shop.price)}` : `购餐，吃 1 份 · ${money(shop.price)}`, 'purchase', building.id, 1, saleDisabled || !shop.open || shop.inventory < 1 || state.player.money < shop.price));
      if (!materials) actions.push(button(`购餐并带 1 份 · ${money(shop.price * 2)}`, 'purchase', building.id, 2, saleDisabled || !shop.open || shop.inventory < 2 || state.player.money < shop.price * 2));
      notes.push(`${materials ? '工业物料' : '食物'} ${money(shop.price)} / 份 · 库存 ${Math.round(shop.inventory)} · 客流 ${shop.customers}`);
    }
    if (kind === 'market') actions.push(button(playerLaborLabel(state), 'work', building.id, undefined, workDisabled || !!state.playerLabor?.job));
    if (['workshop', 'farm', 'dock'].includes(kind)) actions.push(button(playerLaborLabel(state), 'work', building.id, undefined, workDisabled || !!state.playerLabor?.job));
    if (kind === 'workshop' && !building.facility && state.shops.some(s => s.buildingId === building.id) && this.hasRole('merchant')) actions.push(button('承包商铺 · 300 云币', 'business', building.id, undefined, workDisabled));
    if (kind === 'school') actions.push(button(state.education?.course ? '继续原课堂 · 不再收费' : '课堂学习 · 60 分钟 · 40 云币托管', 'exam', 'study', undefined, disabled || !this.studyAvailable(building)), button('教师考核 · 80 云币', 'exam', 'teacher', 3, siteDisabled));
    if (kind === 'police') actions.push(button('警察考核 · 80 云币', 'exam', 'police', 1, siteDisabled), button('卫士考核 · 80 云币', 'exam', 'soldier', 2, siteDisabled));
    if (['station', 'airport'].includes(kind)) actions.push(button('驾驶员考核 · 80 云币', 'exam', 'driver', 4, siteDisabled));
    if (kind === 'market') actions.push(button('商人考核 · 80 云币', 'exam', 'merchant', 5, siteDisabled));
    if (['hall', 'core'].includes(kind)) actions.push(button('参加竞选 · 120 云币', 'election', building.id, undefined, siteDisabled));
    if (['hall', 'core'].includes(kind)) this.policyActions(building, actions, notes);
    if (['school', 'station', 'airport', 'police', 'hall', 'core', 'starport'].includes(kind) && this.canWorkAt(kind)) actions.push(button(playerLaborLabel(state), 'work', building.id, undefined, workDisabled || !!state.playerLabor?.job));
    if (state.playerLabor?.job) actions.push(button('结束本人工班', 'cancelWork'));
    if (['pavilion', 'clinic', 'station'].includes(kind)) actions.push(button('休息片刻', 'rest', building.id, undefined, serviceDisabled));
    if (kind === 'clinic') actions.push(button('登记诊疗 · 30 云币托管', 'heal', 'player', undefined, !this.canStartTreatment()));
    if (kind === 'core' || building.facility === 'energy') {
      const binding = powerBinding(this.world), power = state.power, pending = power?.repairs.some(job => !['completed', 'cancelled'].includes(job.status));
      actions.push(button(binding ? '托管100 · 申请60分钟维修' : '维修水能 · 100 云币', 'energy', building.id, undefined, siteDisabled || !this.hasRole('mayor', 'driver', 'soldier', 'scientist', 'official') || !!binding && ((power?.lossP ?? 0) <= 1e-7 || !!pending)));
    }
    if (kind === 'police' && this.hasRole('police', 'soldier')) {
      const crime = state.crimes.filter(c => c.status !== 'resolved' && spatialDistance(c.position, state.player.position) <= 40).sort((a, b) => spatialDistance(a.position, state.player.position) - spatialDistance(b.position, state.player.position))[0];
      actions.push(button('处置附近案件', 'resolveCrime', crime?.id, undefined, disabled || !crime));
    }
    if (kind === 'bank') {
      const amount = [100, 300, 1000].includes(this.view.bankAmount ?? 100) ? this.view.bankAmount ?? 100 : 100, bankDisabled = disabled || !this.pointAvailable(building, 'service');
      for (const [label, type] of [['存入', 'deposit'], ['取出', 'withdraw'], ['申请贷款', 'loan'], ['偿还借贷', 'repay'], ['代购上市股票', 'invest']] as const) actions.push(button(`${label} · ${money(amount)}`, type, building.id, amount, bankDisabled));
      notes.push(`钱庄存款 ${money(state.bankBalance)} · 借贷余额 ${money(state.loan)}`);
    }
    const company = state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === building.id);
    const controlsSpace = company ? this.controlled(company) : state.player.inventory[`business:${building.id}`] === 1;
    if (state.player.homeId === building.id || controlsSpace) {
      actions.push(button('放置体素 · B', 'build', building.id, undefined, siteDisabled));
      const position = state.player.position;
      const voxel = state.voxels.filter(v => spatialDistance(v.position, position) <= 4).sort((a, b) => spatialDistance(a.position, position) - spatialDistance(b.position, position))[0];
      actions.push({ label: '回收附近体素 · X', command: { type: 'demolish', targetId: building.id, ...(voxel ? { position: { ...voxel.position } } : {}) }, disabled: siteDisabled || !voxel });
    }
    if (building.floorPlanProfile === FLOOR_PLAN_PROFILE) notes.push('请进入可使用的房间，站到对应功能点 2 米内；门外、庭院和房间远角不能办理。');
    if (building.publicFloors !== undefined) notes.push('公共服务楼层可自由进入；其余空间按各楼层权限开放，持有多个身份可使用对应设施。');
    return { actions, notes };
  }

  building(building: Building): ContextSection {
    const state = this.state, inside = this.view.inside === building.id, shop = state.shops.find(s => s.buildingId === building.id), walk = this.canAct();
    const floor = inside ? Math.floor((state.player.position.y - building.position.y) / (building.height / building.floors)) : 0;
    const currentFloor = floor >= 0 ? `${floor + 1} 层` : `地下 ${Math.abs(floor)} 层`;
    const floorUse = floor >= 0 ? building.floorUses?.[floor] : building.basementUses?.[Math.abs(floor) - 1];
    const { actions, notes } = this.buildingActions(building, !walk);
    actions.unshift({ label: inside ? '离开建筑 / 使用楼梯 · E' : '进入 / 使用建筑 · E', client: 'interact', disabled: !walk });
    if (!walk) notes.push('切换步行并接近入口，参与这里的生活。'); else if (!inside) notes.push('走近门口按 E 进入，楼梯处按 E 换层。');
    return { kind: 'building', id: building.id, eyebrow: `${kindNames[building.kind]} · ${inside ? '已进入' : '附近场所'}`, title: building.name, subtitle: inside ? `${currentFloor}${floorUse ? ` · ${floorUse}` : ''}` : `${building.floors} 层 · ${building.capacity} 人容量${shop ? ` · ${shop.open ? '营业中' : '已打烊'}` : ''}`, actions, notes };
  }

  citizen(citizen: Citizen): ContextSection {
    const state = this.state, rel = state.relationships.find(r => r.npcId === citizen.id), walk = this.canAct(), actions: ContextAction[] = [], notes: string[] = [];
    const severeHostility = !!rel && hostilityRank[hostilityStage(rel)] >= 2;
    actions.push(button('聊聊近况', 'socialize', citizen.id, undefined, !walk || severeHostility), button('送食物作礼物', 'gift', citizen.id, undefined, !walk || severeHostility || (state.player.inventory.food ?? 0) < 1));
    if (severeHostility) notes.push('旧怨尚未平复，对方拒绝闲谈与礼物；可尝试诚意调解。');
    const single = (!citizen.partnerId || citizen.partnerId === 'player') && (!state.player.partnerId || state.player.partnerId === citizen.id);
    const stage = rel ? romanceStage(rel) : 'single', courting = ['single', 'crush', 'pursuit'].includes(stage), age = rel ? this.romanceAge(rel) : 0;
    const courtReady = !!rel && courting && rel.affection >= 55 && rel.trust >= 35 && rel.encounters >= (stage === 'pursuit' ? 6 : 4) && (stage !== 'pursuit' || age >= 60) && single;
    if (courting) actions.push(button(stage === 'pursuit' ? '确认交往' : '表达心意', 'court', citizen.id, undefined, !walk || !courtReady));
    const reconcileCost = 15 + (rel ? hostilityRank[hostilityStage(rel)] : 0) * 10;
    actions.push(button(`诚意调解 · ${reconcileCost}`, 'reconcile', citizen.id, undefined, !walk || !rel || hostilityStage(rel) === 'none' || state.player.money < reconcileCost), button('提出异议', 'conflict', citizen.id, undefined, !walk));
    if (rel && ['dating', 'engaged'].includes(stage)) actions.push(button(stage === 'engaged' ? '办理婚姻' : '诚意求婚', 'propose', citizen.id, undefined, !walk || rel.affection < 80 || rel.trust < 60 || rel.encounters < 8 || !state.player.homeId || !single || age < 120));
    if (rel?.type === 'spouse' && state.player.partnerId === citizen.id) actions.push(button('结束婚姻', 'divorce', citizen.id, undefined, !walk));
    if (this.atKind('clinic')) actions.push(button('协助登记诊疗 · 30 云币托管', 'heal', citizen.id, undefined, !this.canStartTreatment(citizen.id)));
    if (this.hasRole('mayor') && this.atKind('hall', 'core')) actions.push(button('任命公务员', 'appoint', citizen.id, 0, !walk || (citizen.education ?? 0) < 2 || state.treasury < 100), button('任命议员', 'appoint', citizen.id, 1, !walk || (citizen.education ?? 0) < 2 || state.treasury < 100), button('任命科研人员', 'appoint', citizen.id, 2, !walk || (citizen.education ?? 0) < 3 || state.treasury < 100));
    if (!walk) notes.push('步行走近居民后，可以交谈与互动。');
    return { kind: 'citizen', id: citizen.id, eyebrow: `${roleNames[citizen.role as Role] ?? citizen.role} · ${activity(citizen.state)}`, title: citizen.name, subtitle: rel ? `${relationshipTitle(rel)} · 好感 ${Math.round(rel.affection)} · 信任 ${Math.round(rel.trust)}` : '初次相逢 · 尚未认识', actions, notes };
  }

  vehicle(vehicle: Vehicle): ContextSection {
    const state = this.state, walk = this.canAct(), actions: ContextAction[] = [];
    if (state.player.vehicleId) actions.push(button('下车 / 离开载具', 'leaveVehicle', vehicle.id));
    else {
      actions.push(button('购票乘坐', 'ride', vehicle.id, undefined, !walk || vehicle.state === 'moving'));
      if (vehicle.kind === 'road' || vehicle.kind === 'flight' && this.hasRole('driver')) actions.push(button(vehicle.kind === 'flight' ? '驾驶航班' : '驾驶载具', 'drive', vehicle.id, undefined, !walk || vehicle.state === 'moving' || !this.hasRole('driver', 'police', 'soldier')));
    }
    const note = state.player.vehicleId && state.player.inventory.driving === 1 ? 'W / S 油门与减速 · A / D 路口转向 · 空格刹车。抵达停靠点后可下车。' : state.player.vehicleId ? '玩家随真实载具前行；抵达站点并停稳后，可下车继续游览。' : '候车停稳后可登乘；驾驶资格允许道路驾驶，驾驶员也可执飞航班。';
    return { kind: 'vehicle', id: vehicle.id, eyebrow: `${modeNames[vehicle.kind]} · ${activity(vehicle.state)}`, title: state.player.vehicleId ? '同行于山城' : `附近${modeNames[vehicle.kind]}载具`, subtitle: `${vehicle.passengers} 位乘客 · 货物 ${Math.round(vehicle.cargo)} · ${Math.round(vehicle.speed)} m/s`, actions, notes: [note] };
  }

  aircraft(craft: AerialVehicle): ContextSection {
    const state = this.state, active = state.aviation?.activeAircraftId === craft.id, actions: ContextAction[] = [], notes: string[] = [];
    const pad = getAviationPads(this.world).find(p => p.id === craft.homePadId);
    const near = this.canAct() && spatialDistance(state.player.position, craft.position) <= 6 && !state.player.vehicleId;
    const status = craft.charging ? '地面补能中' : craft.status === 'parked' ? '停机坪已停稳' : craft.status === 'landing' ? '自动返航与进近' : '实际飞行中';
    if (active) actions.push(button('返航并安全落地 · E', 'landAircraft', craft.id, undefined, craft.status !== 'flying'), button('退出机舱 · E', 'leaveAircraft', craft.id, undefined, craft.status !== 'parked'));
    else if (near) {
      if (craft.kind === 'drone') actions.push(button(craft.reserved ? '结束租约并归还' : '租用 · 24 云币', craft.reserved ? 'returnAircraft' : 'rentAircraft', craft.id, undefined, !craft.reserved && (state.player.money < 24 || craft.charging || craft.battery < 30)));
      const reason = aircraftBoardingBlockedReason(state, craft);
      actions.push(button('进入机舱', 'boardAircraft', craft.id, undefined, !!reason));
      if (reason) notes.push(reason);
      actions.push(button(`地面补能 · ${Math.ceil((100 - craft.battery) * .16)} 云币`, 'refuelAircraft', craft.id, undefined, craft.charging || craft.battery > 99.9));
    } else notes.push(`距离 ${rounded(spatialDistance(state.player.position, craft.position))} m，步行到舱门 6 米内操作。`);
    notes.push(craft.kind === 'drone' ? '可载人的自动驾驶观景无人机：现场租用、登机，空中不能退出，返航落地后继续生活。' : '军用垂直起降战机需要卫士与驾驶员身份，在机场现场登机；低电量或恶劣天气会返航。');
    return { kind: 'aircraft', id: craft.id, eyebrow: '航空器', title: craft.name, subtitle: `${status} · 电量 ${Math.round(craft.battery)}% · ${Math.round(craft.speed)} m/s · ${pad?.name ?? '城市航空器'}`, actions, notes };
  }
}

/** Nearby targets use the web App's radii: doors 18 m, residents 8 m,
 * vehicles 24 m, aircraft 18 m, measured from the player's actual body. */
export function contextModel(sim: Simulation, world: WorldDefinition, view: ContextView = {}): ContextModelResult {
  const rules = new ContextRules(sim, world, { mode: view.mode ?? 'walk', inside: view.inside ?? null, bankAmount: view.bankAmount });
  const state = sim.state, position = state.player.position;
  const insideBuilding = view.inside ? world.buildings.find(b => b.id === view.inside) : undefined;
  const building = insideBuilding ?? world.buildings.filter(b => spatialDistance(position, b.door) < 18).sort((a, b) => spatialDistance(position, a.door) - spatialDistance(position, b.door))[0];
  const citizen = state.citizens.filter(n => n.tier !== 'statistical' && spatialDistance(position, n.position) < 8).sort((a, b) => spatialDistance(position, a.position) - spatialDistance(position, b.position))[0];
  const vehicle = state.vehicles.find(v => v.id === state.player.vehicleId) ?? state.vehicles.filter(v => spatialDistance(position, v.position) < 24).sort((a, b) => spatialDistance(position, a.position) - spatialDistance(position, b.position))[0];
  const aircraft = activeAircraft(state) ?? state.aviation?.aircraft.filter(a => spatialDistance(position, a.position) < 18).sort((a, b) => spatialDistance(position, a.position) - spatialDistance(position, b.position))[0];
  const flying = !!state.aviation?.activeAircraftId, sections: ContextSection[] = [];
  if (aircraft) sections.push(rules.aircraft(aircraft));
  if (building && !flying) sections.push(rules.building(building));
  if (citizen && !flying) sections.push(rules.citizen(citizen));
  if (vehicle && !flying) sections.push(rules.vehicle(vehicle));
  return { sections };
}
