/**
 * Headless overview panes for native clients (src/ui.ts renderLife,
 * renderCity, renderTransit, renderRelationships/renderOrganizations), as
 * data. Buttons are Simulation commands with the web's enablement rules.
 */
import type { Simulation } from '../simulation';
import { publicDepartures } from '../journey';
import { JourneyNavigation } from '../journey';
import { ContextRules, activity, button, hostilityNames, hostilityStage, kindNames, modeNames, money, relationshipTitle, roleNames, romanceNames, romanceStage, type ContextAction, type ContextView } from './context-model';
import type { Building, BuildingKind, Command, Company, SimState, Vec3, WorldDefinition } from '../types';
import { canReviewPetition, civicSite, publicFloor } from '../simulation/culture';
import { researchPlayerContextReason, researchProgressInfo } from '../simulation/extensions';
import { shopLifecycleMayIncorporate } from '../simulation/shop_lifecycle';
import { powerBinding } from '../simulation/power';
import { isRoadOpen, roadClosure } from '../roads';
import { roadworksStatus, roadworkActorId } from '../simulation/roadworks';
import { civicCouncilSourceProof } from '../simulation/civic-staffing';
import { electionCounts, governanceSupported } from '../simulation/governance';
import { clinicalVisitDeadline } from '../simulation/clinical';
import { transferredSourceUnits, transferStationOccupied } from '../simulation/hygiene-transfer';
import { canHoldFamilyCeremony, isEstateSaleVenue, isFamilyDependent, publicFamilyVenue } from '../simulation/family';

export interface PaneRow { label: string; value: string }
export interface PaneEntry { id: string; title: string; subtitle: string; detail?: string[]; actions: ContextAction[] }
/** A command whose fields the player fills in (text the web takes from inputs).
 * `command` holds the fixed parts; each field's value is written to `key`.
 * The client enables submit only when every text field meets its length range. */
export interface PaneFormField { key: 'targetId' | 'title' | 'text' | 'value'; label: string; kind: 'select' | 'text' | 'textarea' | 'number'; options?: { value: string; label: string }[]; minLength?: number; maxLength?: number; optional?: boolean }
export interface PaneForm { id: string; label: string; command: Command; fields: PaneFormField[]; disabled: boolean; note?: string }
export interface PaneSection { title: string; rows: PaneRow[]; entries: PaneEntry[]; actions: ContextAction[]; notes: string[]; forms?: PaneForm[] }
export interface PanesModel { panes: { id: 'life' | 'city' | 'industry' | 'transit' | 'relations'; title: string; sections: PaneSection[] }[] }

const ingredientNames: Record<string, string> = { grain: '稻米', vegetable: '时蔬', fish: '溪鱼' };
const recipes: Record<string, { name: string; minutes: number; ingredients: Record<string, number> }> = { rice: { name: '山居菜饭', minutes: 30, ingredients: { grain: 2, vegetable: 1 } }, fishSoup: { name: '清溪鱼汤', minutes: 45, ingredients: { fish: 1, vegetable: 2 } }, festivalMeal: { name: '云山团圆宴', minutes: 60, ingredients: { grain: 2, fish: 1, vegetable: 2 } } };
const recipeNames: Record<string, string> = Object.fromEntries(Object.entries(recipes).map(([id, recipe]) => [id, recipe.name]));
const sectorNames: Record<string, string> = { traffic: '交通科技', energy: '能源科技', information: '信息科技', security: '安防科技', medicine: '医疗科技', agriculture: '农业科技', manufacturing: '制造科技' };
const auditStatuses: Record<string, string> = { suspected: '待核查', reported: '已举报', investigating: '调查中', prosecuted: '已起诉', cleared: '已澄清' };
const repairStates: Record<string, string> = { awaitingBudget: '等候法定预算', awaitingSupply: '等候实际材料', awaitingTechnician: '等候在岗技术员', working: '履约中', paused: '已暂停', completed: '已完成', cancelled: '已取消', refundPending: '退款待结清' };
/** Web 烹饪火候 slider default. */
const COOKING_HEAT = 60;
const inventoryNames: Record<string, string> = { food: '食物', material: '工业物料', block: '体素材料', investment: '投资份额', businesses: '经营商铺', driving: '驾驶操作权' };
const itemName = (value: string) => value.startsWith('ingredient:') ? ingredientNames[value.slice(11)] ?? value : value.startsWith('dish:') ? recipeNames[value.slice(5)] ?? value : inventoryNames[value] ?? value;
const districtKinds: Record<string, string> = { waterfront: '水岸与渡口', market: '商贸与生活', industry: '工坊与产业', residential: '山居与街巷', education: '书院与学堂', government: '官署与治安', energy: '水能与中枢', civic: '市政中枢', scenic: '山顶与观景', airport: '空港与客运', starport: '星港与远行' };
const rounded = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('zh-CN');
const spatial = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const clock = (hour: number) => `${String(Math.floor(hour) % 24).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
const section = (title: string, part: Partial<PaneSection> = {}): PaneSection => ({ title, rows: [], entries: [], actions: [], notes: [], ...part });
const DESTINATION_KINDS: BuildingKind[] = ['school', 'market', 'home', 'clinic', 'bank', 'hall', 'police', 'station', 'workshop', 'farm', 'dock', 'pavilion', 'core', 'airport', 'starport'];

const navigations = new WeakMap<WorldDefinition, JourneyNavigation>();

export function panesModel(sim: Simulation, world: WorldDefinition, view: ContextView = {}): PanesModel {
  const rules = new ContextRules(sim, world, { mode: view.mode ?? 'walk', inside: view.inside ?? null, bankAmount: view.bankAmount });
  const state = sim.state, player = state.player, position = player.position;

  // Life
  const items = Object.entries(player.inventory).filter(([item, amount]) => amount > 0 && !item.startsWith('business:') && !item.startsWith('dishQuality:'));
  const job = state.playerLabor?.job;
  const life = [
    section('身份与资产', { rows: [
      { label: '当前身份', value: roleNames[player.role] ?? player.role },
      { label: '全部身份', value: (player.identities ?? [player.role]).map(role => roleNames[role] ?? role).join(' · ') },
      { label: '住处', value: player.homeId ? world.buildings.find(b => b.id === player.homeId)?.name ?? '城中住宅' : '尚未在城中安家' },
      { label: '现金', value: money(player.money) }, { label: '声望', value: String(Math.round(player.reputation * 10) / 10) },
      { label: '教育 / 工作经验', value: `${player.education} / ${player.experience}` },
      { label: '饱腹 · 精力 · 社交 · 娱乐', value: `${Math.round(player.needs.hunger)} · ${Math.round(player.needs.fatigue)} · ${Math.round(player.needs.social)} · ${Math.round(player.needs.fun)}` },
    ] }),
    section('行囊', { rows: items.map(([item, amount]) => ({ label: itemName(item), value: item === 'investment' ? money(amount) : `× ${rounded(amount)}` })), notes: items.length ? [] : ['行囊尚空。市集购买的食物和礼物会放在这里。'] }),
    section('本人工班与学习', {
      rows: [...(job ? [{ label: '现场工班', value: `${job.status} · ${(Math.floor(job.workedMinutes * 10) / 10).toFixed(1)} / ${job.requiredMinutes} 分钟` }] : []),
        ...(state.education?.course ? [{ label: '课堂', value: `${state.education.course.status} · ${(Math.floor(state.education.course.workedMinutes * 10) / 10).toFixed(1)} 分钟` }] : []),
        ...(state.homeRest?.session ? [{ label: '床旁休息', value: `${state.homeRest.session.state} · ${(Math.floor(state.homeRest.session.progressMinutes * 10) / 10).toFixed(1)} 分钟` }] : [])],
      actions: [...(job ? [button('结束本人工班', 'cancelWork')] : []), ...(state.education?.course ? [button('取消课堂', 'cancelStudy')] : []), ...(state.homeRest?.session ? [button('结束休息', 'cancelRest')] : [])],
      notes: job || state.education?.course || state.homeRest?.session ? [] : ['在市集、工坊、书院等场所的功能点开始工班或课堂；离开会暂停。'],
    }),
    section('饮食', {
      actions: [button(`食用随身食物 · ${player.inventory.food ?? 0} 份`, 'eat', 'food', undefined, !rules.canAct() || (player.inventory.food ?? 0) < 1),
        ...Object.entries(recipeNames).filter(([id]) => (player.inventory[`dish:${id}`] ?? 0) > 0).map(([id, name]) => button(`享用${name} · ${player.inventory[`dish:${id}`]} 份`, 'eat', id, undefined, !rules.canAct()))],
      notes: ['随身食物每次实际吃 1 份；无需厨房。购餐并带走的余量可在途中食用。'],
    }),
    healthSection(rules, world, state),
    hygieneSection(rules, world, state),
    cookingSection(rules, state),
    section('最近事件', { rows: state.events.slice(-8).reverse().map(event => ({ label: `#${event.tick}`, value: event.text })) }),
  ];

  // City
  const average = (key: 'safety' | 'employment' | 'prosperity') => state.districts.reduce((sum, d) => sum + d[key], 0) / Math.max(1, state.districts.length);
  const crimes = state.crimes.filter(c => c.status !== 'resolved').slice(-5);
  const city = [
    section('城市运行', { rows: [
      { label: '能源', value: `${Math.round(state.energy)}%` }, { label: '治安', value: `${Math.round(average('safety'))}%` }, { label: '就业', value: `${Math.round(average('employment') * 100)}%` }, { label: '民意', value: `${Math.round(state.support)}%` },
      { label: '城市人口', value: rounded(state.districts.reduce((sum, d) => sum + d.residents, 0)) }, { label: '城市金库', value: money(state.treasury) }, { label: '累计产值', value: money(state.gdp) },
      { label: '税率 / 治安预算', value: `${Math.round(state.taxRate * 100)}% / ${Math.round(state.policeBudget * 100)}%` },
      { label: '商业交易 / 物流交付 / 通勤', value: `${rounded(state.metrics.trades)} / ${rounded(state.metrics.freight)} / ${rounded(state.metrics.commutes)}` },
      { label: '十阶段顺序', value: state.lastSystemOrder.join(' → ') },
    ] }),
    section('城区', { entries: state.districts.map(d => ({ id: d.id, title: world.districts.find(def => def.id === d.id)?.name ?? d.id, subtitle: `治安 ${Math.round(d.safety)} · 繁荣 ${Math.round(d.prosperity)} · 居民 ${rounded(d.residents)} · ${d.tier === 'active' ? '活跃' : d.tier === 'regional' ? '区域' : '统计'}`, actions: [] })) }),
    section('未结案件', { entries: crimes.map(crime => ({ id: crime.id, title: `${world.districts.find(d => d.id === crime.districtId)?.name ?? '城区'} · ${crime.status === 'responding' ? '警力响应中' : '待处置'}`, subtitle: `距离 ${rounded(spatial(position, crime.position))} 米`,
      actions: [button('协助处置', 'resolveCrime', crime.id, undefined, !rules.canAct() || !rules.hasRole('police', 'soldier') || spatial(position, crime.position) > 40)] })), notes: crimes.length ? [] : ['目前没有未结案件。'] }),
    governanceSection(world, state),
    ...councilSections(world, state),
    roadSection(rules, world, state),
    powerSection(rules, world, state),
    ...publicSections(rules, state),
  ];

  // Transit
  let navigation = navigations.get(world); if (!navigation) { navigation = new JourneyNavigation(world); navigations.set(world, navigation); }
  const plan = navigation.read(state);
  const journeyRows: PaneRow[] = [];
  if (plan.transit) journeyRows.push({ label: '公共交通目的地', value: plan.transit.destination.name }, { label: '票款 / 换乘 / 步行', value: `${money(plan.transit.fare)} / ${plan.transit.transfers} 次 / ${Math.round(plan.transit.walkingMetres)} 米` },
    ...plan.transit.legs.map((leg, i) => ({ label: `第 ${i + 1} 段`, value: `${leg.mode === 'walk' ? '步行' : modeNames[leg.mode]} · ${world.nodes.find(n => n.id === leg.fromNodeId)?.name ?? leg.fromNodeId} → ${world.nodes.find(n => n.id === leg.toNodeId)?.name ?? leg.toNodeId}${leg.fare ? ` · ${money(leg.fare)}` : ''}` })));
  else if (plan.walking) journeyRows.push({ label: '步行目的地', value: plan.walking.destination.name }, { label: '路线', value: `道路与桥面 ${Math.round(plan.walking.metres)} 米` });
  const stop = plan.transit?.legs.find(l => l.mode !== 'walk')?.fromNodeId ?? world.nodes.filter(n => n.station).sort((a, b) => spatial(position, a.position) - spatial(position, b.position))[0]?.id;
  const timetable = (minute: number) => `第 ${Math.floor(minute / 1440) + 1} 日 ${clock((minute % 1440) / 60)}`;
  const departures = publicDepartures(world, state, stop).slice(0, 12);
  const travel = (id: string): ContextAction[] => [button('步行导航', 'planJourney', id, 0), button('公共交通', 'planJourney', id, 1)];
  const transit = [
    section('当前行程', { rows: journeyRows, actions: [button('取消行程', 'cancelJourney', undefined, undefined, !state.journey?.targetId)], notes: [...(plan.unavailable ? [plan.unavailable] : []), ...(state.journey?.targetId ? [] : ['选择下面的城区或场所开始导航；导航只画出金线，不会代买票或移动身体。'])] }),
    section('城区', { entries: world.districts.map(d => { const metres = flat(position, d.center); return { id: d.id, title: d.name, subtitle: `${districtKinds[d.kind] ?? d.kind} · ${metres < d.radius ? '此处' : metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${rounded(metres)} m`}`, actions: travel(d.id) }; }) }),
    ...DESTINATION_KINDS.map(kind => section(`附近${kindNames[kind]}`, { entries: world.buildings.filter(b => b.kind === kind).sort((a, b) => spatial(position, a.door) - spatial(position, b.door)).slice(0, 8)
      .map(b => ({ id: b.id, title: b.name, subtitle: `${Math.round(spatial(position, b.door))} m`, actions: travel(b.id) })) })),
    section(`班次 · ${world.nodes.find(n => n.id === stop)?.name ?? '最近站点'}`, { rows: departures.map(d => ({ label: `${modeNames[d.mode]} · ${d.vehicleId}`, value: `${d.from.name} → ${d.to.name} · ${d.reason ?? (d.departed ? `${activity(d.state)} · 预计到站 ${d.arrivalAt === null ? '待确认' : timetable(d.arrivalAt)}` : `发车 ${d.departureAt === null ? '待确认' : timetable(d.departureAt)} · ${d.passengers} 人`)}` })), notes: departures.length ? [] : ['当前停靠点没有可确认的载具班次，请查看其他站点。'] }),
    rideSection(rules, world, state),
    section('路口调度', { actions: [
      { label: '调度附近路口', command: { type: 'signal', value: 1, position: { ...position } }, disabled: rules.view.mode !== 'walk' || !rules.hasRole('police', 'mayor') },
      { label: '恢复自动调度', command: { type: 'signal', value: 2, position: { ...position } }, disabled: rules.view.mode !== 'walk' || !rules.hasRole('police', 'mayor') }],
      notes: ['警察与市长可调整附近路口，交通流会响应。'] }),
    section('航空器与停机位', { entries: (state.aviation?.aircraft ?? []).map(craft => { const context = rules.aircraft(craft); return { id: craft.id, title: context.title, subtitle: context.subtitle, detail: context.notes, actions: context.actions.filter(a => !a.client) }; }),
      notes: state.aviation?.aircraft.length ? ['登机、起降与返航需在停机位附近；飞行中按 V 返航。'] : ['当前城市没有登记的航空器。'] }),
  ];

  // Relations
  const partner = state.citizens.find(c => c.id === player.partnerId);
  const relations = [...state.relationships].sort((a, b) => b.encounters - a.encounters);
  const organizations = state.extension?.organizations ?? [];
  const relationsPane = [
    section('人脉', { rows: [{ label: '伴侣', value: partner?.name ?? '独自远游' }], entries: relations.map(rel => {
      const citizen = state.citizens.find(c => c.id === rel.npcId);
      return { id: rel.npcId, title: citizen?.name ?? rel.npcId, subtitle: `${relationshipTitle(rel)} · 好感 ${Math.round(rel.affection)} · 信任 ${Math.round(rel.trust)}`,
        detail: [`相处 ${romanceNames[romanceStage(rel)]} · 敌对 ${hostilityNames[hostilityStage(rel)]} · 共同经历 ${rel.encounters}`, ...(citizen ? [`${roleNames[citizen.role] ?? citizen.role} · ${activity(citizen.state)} · 距离 ${rounded(spatial(position, citizen.position))} 米`] : []), ...rel.memories.slice(-4).reverse().map(m => `#${m.tick} ${m.text}`)],
        actions: citizen ? [button('导航到其住处', 'planJourney', citizen.homeId, 0)] : [] };
    }), notes: relations.length ? [] : ['城中尚无故人。走近一位居民，开启第一次交谈。'] }),
    section('社群组织', { entries: organizations.map(o => ({ id: o.id, title: o.name, subtitle: `${o.members.includes('player') ? '已加入' : `${o.members.length} 位成员`} · 声望 ${Math.round(o.reputation)} · 资金 ${money(o.funds)}`, actions: [
      button('加入 · 20 云币', 'joinOrganization', o.id, undefined, o.members.includes('player') || !rules.atKind('school', 'pavilion', 'hall') || player.money < 20),
      button('捐助 · 50 云币', 'donate', o.id, 50, !rules.atKind('school', 'clinic', 'hall', 'core') || player.money < 50),
      button('参加节庆 · 20', 'attendFestival', o.id, undefined, !rules.atKind('market', 'pavilion', 'hall') || player.money < 20)] })),
      notes: ['书院、亭子或官署可入会；节庆在市集、亭子与官署举行。社区捐助支持公共福利与居民健康。'] }),
    familySection(rules, world, state),
    ...cultureSections(rules, world, state),
  ];

  return { panes: [{ id: 'life', title: '生活', sections: life }, { id: 'city', title: '城市', sections: city }, { id: 'industry', title: '百业', sections: industrySections(rules, world, state) }, { id: 'transit', title: '交通', sections: transit }, { id: 'relations', title: '人脉', sections: relationsPane }] };
}

/** ui.ts renderLifeSystems 烹饪部分: buy ingredients at a counter, cook at home, a clinic or a market. */
function cookingSection(rules: ContextRules, state: SimState): PaneSection {
  const extension = state.extension, cooking = extension?.cooking, inventory = state.player.inventory, building = rules.nearbyBuilding();
  const shop = state.shops.find(s => s.buildingId === building?.id);
  const canBuy = !!building && ['market', 'farm', 'dock'].includes(building.kind) && rules.atBuilding(building.id, 'sale') && !!shop?.open;
  const inHome = !!state.player.homeId && rules.atBuilding(state.player.homeId);
  const kitchen = inHome || rules.atKind('clinic', 'market');
  return section('烹饪', {
    rows: cooking ? [{ label: '正在烹饪', value: `${recipes[cooking.recipeId]?.name ?? cooking.recipeId} · 剩余 ${Math.max(0, Math.ceil(cooking.finishAt - (extension?.lastUpdate ?? 0)))} 分钟` }] : [],
    entries: Object.entries(recipes).map(([id, recipe]) => {
      const ready = Object.entries(recipe.ingredients).every(([item, count]) => (inventory[`ingredient:${item}`] ?? 0) >= count);
      return { id, title: recipe.name, subtitle: `${recipe.minutes} 分钟 · ${Object.entries(recipe.ingredients).map(([item, count]) => `${ingredientNames[item]} ${count}（持有 ${inventory[`ingredient:${item}`] ?? 0}）`).join(' · ')}`,
        actions: [{ label: '开始烹饪', command: { type: 'cook', targetId: id, value: COOKING_HEAT }, disabled: !extension || !!cooking || !ready || !kitchen }] };
    }),
    actions: ([['grain', 8], ['vegetable', 6], ['fish', 14]] as const).map(([id, price]) => button(`购买${ingredientNames[id]} · ${price} 云币`, 'buyIngredient', id, 1, !extension || !canBuy || state.player.money < price || (shop?.inventory ?? 0) < 1)),
    notes: [cooking ? '' : '厨房暂无料理制作。', '食材在市集、农场、码头的售卖点购买；在自己的住处、医馆或市集烹饪，火候 60。'].filter(Boolean),
  });
}

/** ui.ts powerContent: the declared hydropower source and operator, repair jobs and their real costs. */
function powerSection(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection {
  const binding = powerBinding(world), power = state.power;
  if (!binding) return section('水能设施', { notes: ['当前地图沿用原有聚合供给；没有可登记的水能设备与控制院。'] });
  const rows: PaneRow[] = [{ label: '未修复设备损失', value: `${(power?.lossP ?? 0).toFixed(2)} P` }];
  const dispatch = power?.dispatch;
  if (dispatch) rows.push({ label: '当前逻辑负载', value: `${dispatch.servedP.toFixed(2)} / ${dispatch.demandP.toFixed(2)} P 已供` }, { label: '未供负载', value: `${dispatch.unservedP.toFixed(2)} P` });
  const job = power?.repairs.find(repair => !['completed', 'cancelled'].includes(repair.status)), last = job ?? power?.repairs.at(-1);
  const nearby = rules.nearbyBuilding(), onsite = rules.canAct() && !!nearby && [binding.source.id, binding.operator.id].includes(nearby.id) && rules.pointAvailable(nearby);
  const notes = [`${binding.source.name}供给城区，由${binding.operator.name}操作。维修须真实故障、1份工业材料与60分钟已付薪技术员工作；健康设备不收费。`];
  if (last) {
    rows.push({ label: '维修状态', value: repairStates[last.status] ?? last.status }, { label: '实际技术员时间', value: `${last.workedMinutes.toFixed(1)} / 60 分钟` },
      { label: '材料', value: `已买 ${last.receivedUnits.toFixed(2)} · 预约 ${last.reservedUnits.toFixed(2)} · 已耗 ${last.consumedUnits.toFixed(2)}` },
      { label: '原出资', value: last.payerId === 'player' ? '玩家真实托管' : '已授权公共材料预算' }, { label: '未赚托管款', value: money(last.escrow) }, { label: '已购物料款', value: money(last.purchasePaid) });
    if (last.payerId === 'public') rows.push({ label: '批准材料额度', value: `${money(last.authorizedCap)} · 已用 ${money(last.purchasePaid)}` });
    notes.push(last.reason);
  }
  const available = onsite && (power?.lossP ?? 0) > 1e-7 && !job;
  const actions = [button('托管100 · 申请60分钟维修', 'energy', nearby?.id, undefined, !available || state.player.money < 100 || !rules.hasRole('mayor', 'driver', 'soldier', 'scientist', 'official')), button('提交公共维修需求', 'requestEnergyRepair', nearby?.id, undefined, !available)];
  if (job?.payerId === 'public' && !job.budgetId) actions.push(button('市长批准材料预算 · 40', 'approveEnergyRepair', job.id, 40, !rules.canAct() || !rules.hasRole('mayor') || !rules.atKind('hall', 'core')));
  if (job) actions.push(button('取消维修并结清未赚款', 'cancelEnergy', job.id, undefined, !rules.canAct() || job.payerId === 'public' && (!rules.hasRole('mayor') || !rules.atKind('hall', 'core'))));
  if (!onsite) notes.push('申请请步行到水能核心或控制院合法功能点；实际工时与材料仍由现场工作和采购决定。');
  return section('水能设施', { rows, actions, notes });
}

/** ui.ts renderPublicSystems: public services, audits and the public ledger. */
function publicSections(rules: ContextRules, state: SimState): PaneSection[] {
  const extension = state.extension;
  if (!extension) return [section('公共服务', { notes: ['公共服务记录尚未初始化。'] })];
  const environment = extension.environment, institutions = extension.institutions;
  const onSite = rules.atKind('hall', 'core', 'police') || rules.atFacility('data', 'archives', 'treasury', 'administration');
  const recent = extension.publicLedger.slice(-6).reverse();
  const older = extension.publicLedger.filter(entry => entry.purpose === '公共采购异常挪用' && !recent.includes(entry)).slice(-6).reverse();
  return [
    section('公共服务', { rows: [
      { label: '水质', value: `${Math.round(environment.waterQuality)}%` }, { label: '生态多样性', value: `${Math.round(environment.biodiversity)}%` }, { label: '风暴风险', value: `${Math.round(environment.stormRisk)}%` },
      { label: '教育 / 医疗', value: `${Math.round(institutions.education)} / ${Math.round(institutions.medical)}` }, { label: '福利 / 文化', value: `${Math.round(institutions.welfare)} / ${Math.round(institutions.culture)}` },
    ], notes: [environment.lastDisaster ? `最近灾害：${environment.lastDisaster}` : '最近暂无灾害记录。'] }),
    section('审计与司法', {
      actions: [button('核查公共账目 · 40 云币', 'audit', undefined, undefined, !onSite || !rules.hasRole('mayor', 'council', 'official', 'police') || state.player.money < 40)],
      entries: extension.audits.slice(-6).reverse().map(audit => {
        const npc = state.citizens.find(c => c.id === audit.npcId), actions: ContextAction[] = [];
        if (audit.status === 'suspected') actions.push(button('提交举报', 'reportCorruption', audit.id, undefined, !onSite || audit.evidence < 35));
        if (audit.status === 'reported') actions.push(button('启动调查', 'investigate', audit.id, undefined, !onSite || !rules.hasRole('police', 'council', 'mayor') || audit.evidence < 35));
        return { id: audit.id, title: `${npc?.name ?? audit.npcId} · ${auditStatuses[audit.status] ?? audit.status}`, subtitle: `证据 ${Math.round(audit.evidence)} · 涉及资金 ${money(audit.diverted)}`, actions };
      }),
      notes: [...(extension.audits.length ? [] : ['目前没有审计案件。']), '公务身份可在官署、天枢阁或巡检司核查账目。证据达到 35 后，市民可举报；执法与治理身份可启动调查。'],
    }),
    section('公共账目', { entries: [...recent, ...older].map((entry, index) => {
      const actions: ContextAction[] = [];
      if (entry.purpose === '公共采购异常挪用' && state.citizens.some(c => c.id === entry.actorId)) {
        const record = extension.audits.find(audit => audit.npcId === entry.actorId && audit.status !== 'cleared'), filed = !!record && record.status !== 'suspected';
        actions.push(button(filed ? '已进入程序' : '据账本举报', 'reportCorruption', entry.actorId, undefined, !onSite || filed));
      }
      return { id: `ledger-${entry.tick}-${index}`, title: entry.purpose, subtitle: `#${entry.tick} · ${entry.amount > 0 ? '+' : ''}${rounded(entry.amount)}`, actions };
    }) }),
  ];
}

/** ui.ts renderIndustry: founding, holdings, acquisitions, the exchange and research. */
function industrySections(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection[] {
  const extension = state.extension;
  if (!extension) return [section('产业版图', { notes: ['产业与科研记录尚未初始化。'] })];
  const owned = extension.companies.filter(company => rules.controlled(company)), building = rules.nearbyBuilding();
  const foundable = !!building && !building.facility && state.shops.some(shop => shop.buildingId === building.id) && ['market', 'workshop', 'farm', 'dock'].includes(building.kind) && rules.atBuilding(building.id, 'work') && rules.hasRole('merchant')
    && !extension.companies.some(c => c.shopBindingReleasedAt === undefined && c.buildingId === building.id) && (building.kind !== 'market' || shopLifecycleMayIncorporate(state, state.shops.find(shop => shop.buildingId === building.id)!, 'player'));
  const workplace = (company: Company) => world.buildings.find(b => b.id === company.buildingId);
  const holding = (company: Company) => {
    const controlled = rules.controlled(company) && rules.hasRole('merchant'), onSite = company.shopBindingReleasedAt === undefined && rules.atBuilding(company.buildingId, 'work');
    return { id: company.id, title: `${company.name} · ${company.level} 级`, subtitle: `资本 ${money(company.capital)} · 雇员 ${company.employees} · ${company.listed ? '已上市' : '非上市'}`,
      detail: [`营收 / 利润 ${money(company.revenue)} / ${money(company.profit)}`, `库存 ${rounded(company.inventory)} · 市占率 ${(company.marketShare * 100).toFixed(1)}% · 每股 ${company.sharePrice.toFixed(2)} 云币`,
        ...(company.shopBindingReleasedAt !== undefined ? ['租赁资产已归还；公司资本、股份及历史继续保留，当前无经营场地。'] : [])],
      actions: [button('扩张 · 投入 300', 'expandCompany', company.id, 300, !controlled || !onSite || state.player.money < 300), button('雇佣 · 1 位员工', 'hire', company.id, 1, !controlled || !onSite || company.capital < 50),
        button('申请上市 · 200', 'listCompany', company.id, undefined, !controlled || !rules.atKindPoint('service', 'bank') || company.listed || company.level < 2 || company.capital < 600 || state.player.money < 200),
        ...(workplace(company) ? [button('步行导航', 'planJourney', company.buildingId, 0)] : [])] };
  };
  const listed = extension.companies.filter(c => c.listed);
  return [
    section('产业版图', {
      rows: [{ label: '全城企业', value: `${extension.companies.length} 家` }, { label: '持有企业', value: `${owned.length} 家` }, { label: '研发成果', value: `${extension.stats.researchCompleted} 项` }],
      actions: [300, 500, 1000].map(capital => button(`创办公司 · 资本 ${money(capital)}`, 'foundCompany', building?.id, capital, !foundable || state.player.money < capital + 50)),
      entries: owned.map(holding),
      notes: [...(owned.length ? [] : ['尚未创办公司。成为商人，在产业场所开始事业。']), '需商人资格，在市集、工坊、农场或码头的工作点创办；资本加登记费 50 云币，现金进入公司账户。扩张与雇佣在企业现场办理，上市需前往钱庄。'],
    }),
    section('并购', { entries: extension.companies.filter(c => !rules.controlled(c)).map(company => {
      const cost = (company.shares - (company.shareholders.player ?? 0)) * company.sharePrice * 1.2;
      return { id: company.id, title: company.name, subtitle: `${company.level} 级 · ${company.employees} 人 · 参考收购价 ${money(cost)}`,
        actions: [...(workplace(company) ? [button('步行导航', 'planJourney', company.buildingId, 0)] : []), button('洽谈并购', 'acquireCompany', company.id, undefined, !rules.hasRole('merchant') || !owned.length || !rules.atBuilding(company.buildingId, 'work') || state.player.money < cost)] };
    }) }),
    section('交易所', { entries: listed.map(company => ({ id: company.id, title: `${company.name} · ${company.sharePrice.toFixed(2)} 云币`, subtitle: `旅人持股 ${rounded(company.shareholders.player ?? 0)} 股`,
      actions: [button('买入 10 股', 'buyShares', company.id, 10, !rules.atKindPoint('service', 'bank') || state.player.money < company.sharePrice * 10 || (company.shareholders.exchange ?? 0) < 10),
        button('卖出 10 股', 'sellShares', company.id, 10, !rules.atKindPoint('service', 'bank') || (company.shareholders.player ?? 0) < 10 || company.capital < company.sharePrice * 10)] })),
      notes: [...(listed.length ? [] : ['目前没有上市企业。']), '在钱庄服务点按每股实时价格结算，每次 10 股。'] }),
    section('科技与未来', { entries: extension.technologies.map(technology => {
      const research = researchProgressInfo(state, technology.sector);
      const place = rules.atKindPoint('work', 'school', 'core') || rules.atFacilityPoint('work', 'data') || technology.sector === 'energy' && rules.atFacilityPoint('work', 'energy');
      const blocked = !rules.hasRole('scientist') || state.player.education < 3 || !place || state.player.needs.hunger < 40 || state.player.needs.fatigue < 40 || !!state.player.vehicleId || !!state.aviation?.activeAircraftId
        || !!researchPlayerContextReason(state, world, (site, purpose) => rules.atBuilding(site.id, purpose)) || technology.funding > 0 || technology.level >= 20;
      return { id: technology.sector, title: `${sectorNames[technology.sector] ?? technology.sector} · 等级 ${technology.level}`, subtitle: `研究进度 ${Math.floor(technology.progress * 10) / 10}% · 投入 ${money(technology.funding)}`,
        detail: [...(research ? [research.legacy ? `旧研究保留原计时，剩余 ${Math.ceil(research.remainingMinutes)} 分钟。` : `现场劳动 ${(Math.floor((research.workedMinutes ?? 0) * 10) / 10).toFixed(1)} / 120 分钟${research.state === 'paused' ? ` · 暂停：${research.pauseReason}` : ''}`] : []),
          ...(technology.sideEffect > 0 ? [`技术副作用 ${Math.round(technology.sideEffect)}`] : [])],
        actions: [100, 200, 500, 1000].map(budget => button(`研究 · ${budget}`, 'research', technology.sector, budget, blocked || state.player.money < budget)) };
    }), notes: ['持科研身份、教育 3 级以上，在书院、天枢或数据中心的工作点进行 120 分钟现场研究；能源科技也可在水能设施研究。'] }),
  ];
}

/** ui.ts renderGovernance: elections, the mayoral term and recent council motions. */
function governanceSection(world: WorldDefinition, state: SimState): PaneSection {
  if (!governanceSupported(world)) return section('选举与议案', { notes: ['当前城市沿原选举与政策规则运行。'] });
  const government = state.governance;
  if (!government) return section('选举与议案', { notes: ['在议事功能点登记参选，居民通过市政网络独立投票；议案须由真实议员表决。'] });
  const rows: PaneRow[] = [], at = state.extension!.lastUpdate, election = government.elections.at(-1), term = government.term;
  if (election) {
    const counts = electionCounts(election);
    rows.push({ label: '具名居民投票', value: `支持 ${counts.candidate} · 保留现治理 ${counts.retain}` }, { label: '投票人数', value: `${counts.turnout} / ${counts.eligible}` },
      { label: '选举状态', value: election.countedAt === null ? `计票尚余 ${Math.max(0, election.closesAt - at).toFixed(1)} 分钟` : election.result === 'elected' ? '已当选' : election.result === 'noQuorum' ? '未达到投票人数' : '未当选' });
  }
  if (term) rows.push({ label: '市长任期', value: term.endedAt === null ? `尚余 ${Math.max(0, term.endsAt - at).toFixed(0)} 分钟` : '已结束' });
  const statuses: Record<string, string> = { debating: '等候在岗议员独立表决', approved: '已批准，等候生效', applied: '已生效', rejected: '未通过' };
  for (const motion of government.motions.slice(-3).reverse()) {
    const yes = motion.ballots.filter(v => v.yes).length;
    rows.push({ label: `政策议案 ${motion.id}`, value: `税率 ${Math.round(motion.taxRate * 100)}% · 治安 ${Math.round(motion.policeBudget * 100)}% · ${yes} 赞成 / ${motion.ballots.length - yes} 反对 · 需 ${motion.quorum} 赞成 · ${statuses[motion.status] ?? motion.status}` });
  }
  return section('选举与议案', { rows });
}

/** ui.ts renderCivicCouncil: serving local councillors and open by-elections. */
function councilSections(world: WorldDefinition, state: SimState): PaneSection[] {
  const civic = state.civicStaffing; if (!civic) return [];
  const at = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
  const live = civic.terms.flatMap(term => { const source = civicCouncilSourceProof(state, term.actorId, at); return source?.termId === term.id ? [{ term, source }] : []; });
  const rows: PaneRow[] = live.map(({ term, source }) => ({ label: state.citizens.find(p => p.id === term.actorId)?.name ?? '居民',
    value: `${world.buildings.find(site => site.id === term.officeId)?.name ?? '公共议事厅'} · 议员任期尚余 ${Math.max(0, (source.endsAt - at) / 1440).toFixed(1)} 天` }));
  for (const poll of civic.polls.filter(poll => poll.countedAt === null).slice(-3)) {
    const votes = poll.ballots.filter(ballot => ballot.completedAt !== null);
    rows.push({ label: `${state.citizens.find(p => p.id === poll.candidateId)?.name ?? '居民'}的补选`, value: `${votes.length} / ${poll.eligible.length} 人已投票 · 尚余 ${Math.max(0, (poll.closesAt - at) / 60).toFixed(1)} 小时` });
  }
  return [section('居民补选与地方议会', { rows, notes: [...(live.length ? [] : ['尚无在任地方议员。']), '公务员完成现场工作后，可到公共议事厅登记；居民在两天内现场投票。当选任期十四天，可参与公共服务追加预算联审。'] })];
}

/** ui.ts roadContent: flood closures, residents' blocked trips and the real repair contracts. */
function roadSection(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection {
  const closed = world.edges.filter(edge => !isRoadOpen(state, edge.id));
  const stages: Record<string, string> = { unbought: '等待实际采购', carried: '居民携料在途', delivered: '已送到工地', consumed: '已用于修复', retained: '保留实际材料资产' };
  const entries: PaneEntry[] = [];
  for (const edge of closed) {
    const closure = roadClosure(state, edge.id); if (!closure) continue;
    const from = world.nodes.find(node => node.id === edge.from), to = world.nodes.find(node => node.id === edge.to), detail: string[] = ['山洪关闭：新来者须改道；已在路段内的人车沿许可出口离开。'];
    const demands = state.roadDemands?.demands.filter(demand => demand.closureId === closure.id) ?? [];
    if (demands.length) detail.push(`居民提出的维修需求：${demands.length} 位居民的真实行程受阻`);
    for (const demand of demands.slice(-3)) {
      const linked = state.roadworks?.jobs.find(job => job.id === demand.repairId);
      const progress = !linked ? '已记录需求，等候可承接的维修订单' : linked.cancelledAt !== null ? '原公共维修订单已取消，受阻记录保留' : linked.approvedAt === null ? '已交公共维修订单，等待实际审批' : '公共维修订单已获批，等待实际搬料与施工';
      detail.push(`${state.citizens.find(c => c.id === demand.actorId)?.name ?? demand.actorId}：前往${world.buildings.find(b => b.id === demand.goalId)?.name ?? demand.goalId}的原行程受阻，${progress}。`);
    }
    const status = roadworksStatus(state, edge.id), job = status.job, actions: ContextAction[] = [];
    if (job) {
      if (job.replacement) detail.push(`原施工者（保留合同历史）：${state.citizens.find(c => c.id === job.workerId)?.name ?? job.workerId ?? '尚未签约'} · 接续 ${job.replacement.contracts.length} 任 / ${job.replacement.pickups.length} 次实际领回`);
      detail.push(`具名施工者：${state.citizens.find(c => c.id === roadworkActorId(job))?.name ?? '等候居民自愿承接'}`, `有效现场施工 ${job.workedMinutes.toFixed(1)} / ${job.requiredMinutes} 分钟 · 材料 ${stages[status.materialStage] ?? '等待履约'} · 未赚托管款 ${job.escrow.toFixed(2)} 云币`, job.reason);
      if (job.payerId === 'public' && job.completedAt === null && job.cancelledAt === null) actions.push(button('市长现场审批施工预算', 'approveRoadRepair', job.id, 40, !rules.canAct() || !rules.hasRole('mayor')));
      if (job.completedAt === null && job.cancelledAt === null || job.escrow > 1e-7 && job.cancelledAt !== null) actions.push(button('停止施工 · 结算未赚款', 'cancelRoadRepair', job.id, undefined, !rules.canAct()));
    }
    if (!job || job.cancelledAt !== null && job.escrow <= 1e-7) {
      const near = spatial(state.player.position, closure.worksite) <= 16;
      actions.push(button('托管100 · 申请道路修复', 'requestRoadRepair', edge.id, 0, !rules.canAct() || !near || state.player.money < 100), button('提出公共修路需求', 'requestRoadRepair', edge.id, 1, !rules.canAct() || !near));
      detail.push(`工地开放端：${world.nodes.find(n => n.id === closure.worksiteNodeId)?.name ?? closure.worksiteNodeId}，需步行到 16 米内申请。实际采购一份材料，由承接居民步行送到工地；累计60分钟已付薪现场施工才恢复通行。`);
    }
    entries.push({ id: edge.id, title: `${from?.name ?? edge.from} ↔ ${to?.name ?? edge.to}`, subtitle: `${modeNames[edge.mode] ?? edge.mode} · 已封闭`, detail, actions });
  }
  const completed = (state.roadworks?.jobs.filter(job => job.completedAt !== null).slice(-3) ?? []).map(job => `已完成修路：${job.workedMinutes.toFixed(1)}分钟现场劳动，真实工资${job.paidGross.toFixed(2)}云币。`);
  return section('道路与现场工程', { entries, notes: [...(closed.length ? [] : ['当前没有因山洪关闭的道路。']), ...completed] });
}

/** ui.ts renderFamily: partner, pregnancies, household accounts, dependants, ceremonies and estates. */
function familySection(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection {
  const family = state.family;
  if (!family) return section('家庭与下一代', { notes: ['家庭状态尚未建立。'] });
  const player = state.player, spouse = state.citizens.find(c => c.id === player.partnerId);
  const rows: PaneRow[] = [], entries: PaneEntry[] = [], actions: ContextAction[] = [], notes: string[] = [];
  if (spouse) {
    actions.push(button('与伴侣商议生育', 'planFamily', spouse.id, undefined, !rules.canAct()));
    notes.push('婚后共同生活、双方健康与意愿、真实扶养储备均需满足；孕期为 270 个游戏日。');
    const home = world.buildings.find(b => b.kind === 'home' && rules.atBuilding(b.id));
    if (home) { actions.push(button('双方现场登记共同住所 · 各 20 云币', 'moveHousehold', home.id, undefined, !rules.canAct() || player.money < 120 || spouse.money < 120 || family.households.some(h => h.closedAt === null && h.homeId === home.id && h.actorIds.includes('player')))); notes.push('双方需到场同意，住房容量与原岗位道路通勤均需通过核验；登记后原位置和工作保留。'); }
  }
  for (const pregnancy of family.pregnancies.filter(p => p.parentIds.includes('player'))) rows.push({ label: '孕期与扶养储备', value: state.extension?.actorProfiles[pregnancy.carrierId]?.alive === false ? `孕育已中止，托管等待钱包容量或遗产清算后原额退款 · ${money(pregnancy.escrow)}` : `${Math.max(0, Math.ceil((pregnancy.dueAt - family.lastUpdate) / 1440))} 日后预产 · ${money(pregnancy.escrow)}` });
  for (const account of family.households.filter(h => h.actorIds.includes('player'))) entries.push({ id: account.id, title: `${world.buildings.find(b => b.id === account.homeId)?.name ?? account.homeId} · ${account.closedAt === null ? '有效共同账户' : '已按双方均分结清'}`,
    subtitle: `共同现金 ${money(account.balance)} · 已消费 ${money(account.spent)} · 已返还 ${money(account.returned)} · 我的存入 ${money(account.contributions.player ?? 0)}`,
    detail: account.expenses.slice(-3).reverse().map(receipt => `实际照护购食：${state.citizens.find(c => c.id === receipt.targetId)?.name ?? receipt.targetId} · ${receipt.quantity} 份 · ${money(receipt.amount)} → ${receipt.recipientId}`),
    actions: account.closedAt === null ? [button('在家存入共同资金 · 20 云币', 'fundHousehold', account.id, 20, !rules.atBuilding(account.homeId) || player.money < 120)] : [] });
  const dependents = state.citizens.filter(c => isFamilyDependent(state, c.id));
  for (const resident of dependents) {
    const id = resident.id, child = family.children[id], profile = state.extension?.actorProfiles[id], near = spatial(player.position, resident.position) <= 24;
    const account = family.households.find(h => h.closedAt === null && h.actorIds.includes('player') && h.homeId === resident.homeId);
    entries.push({ id, title: resident.name, subtitle: `${Math.floor(profile?.age ?? 0)} 岁 · 教育 ${resident.education ?? 0} · 食物储备 ${resident.food ?? 0} 份`,
      detail: child ? [`新增正式学时 ${Math.round(family.formalLearning?.[id]?.earnedMinutes ?? 0)} 分钟 · 个人自习 ${Math.round(child.selfStudyMinutes ?? 0)} 分钟`] : [],
      actions: [button('到场扶养 · 20 云币', 'supportFamily', id, 20, !rules.canAct() || !near || player.money < 20),
        ...(child ? [button('在书院办理入学 · 40 云币', 'enrollChild', id, undefined, !rules.canAct() || !near || !rules.atKind('school') || !!child.schoolId || (profile?.age ?? 0) < 6 || (profile?.age ?? 0) >= 18 || player.money < 40)] : []),
        ...(account ? [button('现场照护购食 / 交出背包食物', 'householdMeal', id, undefined, !rules.canAct() || !near || (resident.food ?? 0) >= 6)] : [])] });
  }
  const venue = world.buildings.find(b => rules.atBuilding(b.id) && publicFamilyVenue(b, player.position));
  const ceremonies = family.ceremonies.filter(c => c.organizerId === 'player');
  if (canHoldFamilyCeremony(state, 'wedding') && !ceremonies.some(c => c.kind === 'wedding' && c.subjectId === spouse?.id)) actions.push(button('亭馆筹办婚礼 · 30 云币与食物 2 份', 'holdCeremony', 'wedding', undefined, !venue || player.money < 30 || (player.inventory.food ?? 0) < 2));
  for (const [id, estate] of Object.entries(family.estates).filter(([id, estate]) => estate.heirIds.includes('player') || state.extension?.actorProfiles[id]?.family.includes('player'))) {
    entries.push({ id: `estate-${id}`, title: `${state.citizens.find(c => c.id === id)?.name ?? id} · 遗产`, subtitle: estate.status === 'awaitingExecutor' ? '等待真实继承人 / 执行人' : `已结算现金 ${money(estate.cash)} · ${estate.heirIds.length} 位继承人`,
      detail: estate.bankSettlement ? [`钱庄清债 ${money(estate.bankSettlement.debtPaid)}；转移存款债权 ${money(estate.bankSettlement.depositClaimsTransferred)}；未收回坏账 ${money(estate.bankSettlement.unpaidLoss)}。`] : [],
      actions: canHoldFamilyCeremony(state, id) && !ceremonies.some(c => c.kind === 'funeral' && c.subjectId === id) ? [button('亭馆筹办葬礼 · 30 云币与材料 2 块', 'holdCeremony', id, undefined, !venue || player.money < 30 || (player.inventory.block ?? 0) < 2)] : [] });
  }
  for (const sale of family.estateSales ?? []) {
    if (sale.state !== 'offered') continue;
    const company = state.extension?.companies.find(c => c.id === sale.assetId), shop = state.shops.find(s => s.id === sale.assetId), site = world.buildings.find(b => b.id === (company?.buildingId ?? shop?.buildingId));
    const validVenue = world.buildings.some(b => rules.atBuilding(b.id) && isEstateSaleVenue(state, sale, b, Math.floor((player.position.y - b.position.y + .01) / (b.height / Math.max(1, b.floors)))));
    const debt = state.banking?.accounts[sale.deceasedId];
    entries.push({ id: sale.id, title: `遗产偿债出让 · ${company?.name ?? site?.name ?? sale.assetId}`, subtitle: `余 ${sale.quantity - sale.soldQuantity} ${sale.kind === 'shares' ? '份股份' : '间商铺'} · 每份 ${money(sale.unitPrice)}`,
      detail: [`亡者实际贷款本金 / 利息 ${money(debt?.loanPrincipal ?? 0)} / ${money(debt?.loanInterest ?? 0)}`, `已收真实货款 ${money(sale.proceeds)}；由亡者账户清偿债务后，余产才会结算继承。`, ...sale.receipts.slice(-3).map(receipt => `实际买家 ${receipt.buyerId} · ${receipt.quantity} 份 · ${money(receipt.paid)}。`)],
      actions: [button('现场购买一份偿债资产', 'buyEstateAsset', sale.id, 1, !rules.canAct() || !validVenue || player.money < sale.unitPrice + 100)] });
  }
  for (const ceremony of ceremonies) rows.push({ label: ceremony.kind === 'wedding' ? '家庭婚礼' : '亲人葬礼', value: `${ceremony.completedAt === null ? `${Math.floor(ceremony.workedMinutes)} / 30 分钟现场筹办` : `已完成 · ${ceremony.guestIds.length} 位亲友实际到场`} · ${world.buildings.find(b => b.id === ceremony.siteId)?.name ?? ceremony.siteId} · 已支付 ${money(ceremony.paid)}` });
  notes.push(`${dependents.length} 位真实受养家人。出生、共同账户、到校学习、仪式与继承记录随存档恢复。`);
  return section('家庭与下一代', { rows, entries, actions, notes });
}

/** ui.ts renderTransit 当前乘坐 and the recorded journey's last real arrival. */
function rideSection(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection {
  const vehicle = state.vehicles.find(v => v.id === state.player.vehicleId), recorded = state.journey, rows: PaneRow[] = [];
  if (recorded?.targetId && recorded.lastArrival) rows.push({ label: '最近真实到站', value: `${world.nodes.find(n => n.id === recorded.lastArrival!.nodeId)?.name ?? recorded.lastArrival.nodeId} · ${recorded.lastArrival.vehicleId}` });
  if (recorded?.vehicleId) rows.push({ label: '当前实际乘坐', value: `${recorded.vehicleId} · 下一站 ${world.nodes.find(n => n.id === recorded.nextStopNodeId)?.name ?? '查询中'}` });
  if (vehicle) rows.push({ label: modeNames[vehicle.kind] ?? vehicle.kind, value: `${vehicle.passengers} 人 · ${activity(vehicle.state)}` });
  return section('当前乘坐', { rows, actions: vehicle ? [button('下车 / 下船', 'leaveVehicle', vehicle.id)] : [], notes: vehicle ? [] : ['尚未乘坐。接近站点或载具，步行视角可购票上车。'] });
}

/** ui.ts renderLifeSystems 身心 part and clinicalContent: profile, treatment and the player's clinical orders. */
function healthSection(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection {
  const extension = state.extension, profile = extension?.actorProfiles.player, rows: PaneRow[] = [], notes: string[] = [];
  if (profile) rows.push({ label: '年龄 / 健康', value: `${profile.age.toFixed(1)} 岁 / ${Math.round(profile.health)}` }, { label: '心情 / 压力', value: `${Math.round(profile.mood)} / ${Math.round(profile.stress)}` }, { label: '生活技能', value: String(Math.round(profile.skill)) });
  else notes.push('生活记录尚未初始化。');
  if (profile?.historyTags.length) notes.push(profile.historyTags.join(' · '));
  notes.push('须到医馆公共层；材料到货、合资格医生与患者共同完成 20 分钟后才恢复健康。离场暂停。');
  const wait = Math.ceil(clinicalVisitDeadline(state, 'player') - (extension?.lastUpdate ?? 0));
  if (wait > 0) notes.push(`复诊间隔还需 ${wait} 分钟，原有诊疗间隔继续保留。`);
  const nearby = rules.nearbyBuilding();
  if (nearby?.kind === 'clinic') {
    const doctors = state.citizens.filter(doctor => doctor.workId === nearby.id && ['医生', 'doctor'].includes(doctor.role) && extension?.actorProfiles[doctor.id]?.alive && (extension.actorProfiles[doctor.id]?.age ?? 0) >= 18);
    rows.push({ label: '本诊所真实任职成年医生', value: `${doctors.length} 人` });
    notes.push(doctors.length ? '诊疗还需医生实际出勤与患者共同在场；任职名单不等于正在接诊。' : '本诊所尚无任职的成年医生，当前无法承诺诊疗。');
  }
  const names: Record<string, string> = { awaitingSupply: '等待真实材料供货', awaitingDoctor: '等待医生与患者实际在场', inTreatment: '现场诊疗中', refundPending: '退款仍在托管，等待钱包容量', completed: '诊疗已完成', cancelled: '诊疗已取消' };
  const orders = (state.clinical?.orders ?? []).filter(order => order.payerId === 'player' || order.patientId === 'player').slice(-6).reverse();
  if (!orders.length) notes.push('暂无个人诊疗订单。30 云币先进入托管，实际采购和诊疗才会结算。');
  const entries: PaneEntry[] = orders.map(order => {
    const patient = order.patientId === 'player' ? '自己' : state.citizens.find(person => person.id === order.patientId)?.name ?? order.patientId;
    const detail = [`场所 ${world.buildings.find(site => site.id === order.siteId)?.name ?? order.siteId} · 医患共同现场 ${Math.floor(order.workedMinutes * 10) / 10} / ${order.requiredMinutes} 分钟`,
      `剩余托管 ${money(order.escrow)} · 已付材料 ${money(order.purchasePaid)} · 服务费 ${money(order.serviceFee)} · 已退 ${money(order.refunded)}`, `保留材料 ${order.reservedUnits} · 已耗 ${order.consumedUnits} 份`, order.lastReason,
      ...Object.entries(order.staffMinutes).map(([doctorId, minutes]) => `出勤医生 ${state.citizens.find(person => person.id === doctorId)?.name ?? doctorId} · ${Math.floor(minutes * 10) / 10} 分钟`)];
    const cancellable = order.payerId === 'player' && !['completed', 'cancelled'].includes(order.state) && order.cancelledAt === null;
    return { id: order.id, title: `${patient} · ${names[order.state] ?? order.state}`, subtitle: '诊疗订单', detail, actions: cancellable ? [button('取消诊疗，退回未赚托管款', 'cancelTreatment', order.id, undefined, !rules.canAct())] : [] };
  });
  return section('身心与诊疗', { rows, entries, actions: [button('登记诊疗 · 30 云币托管', 'heal', 'player', undefined, !rules.canStartTreatment())], notes });
}

/** src/hygiene-ui.ts hygieneContent: infection status, sealed clinical waste and volunteer transfers. Reads authority only. */
function hygieneSection(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection {
  const nearby = rules.nearbyBuilding(), siteId = nearby?.kind === 'clinic' ? nearby.id : undefined, canAct = rules.canAct();
  const rows: PaneRow[] = [], entries: PaneEntry[] = [], notes: string[] = [];
  const episode = state.pathology?.episodes.player;
  if (episode) rows.push({ label: '健康状况', value: `${({ incubating: '潜伏期', symptomatic: '出现症状', recovering: '恢复中', recovered: '恢复后', dead: '已故' } as Record<string, string>)[episode.phase] ?? episode.phase} · 症状 ${Math.round(episode.severity)}/40 · 尚未完成检验` });
  const h = state.hygiene;
  const occupied = (site: string, floor: number, point: string, includeReserved = true) => transferStationOccupied(state, site, floor, point, includeReserved);
  const contained = (site: string, floor: number, point: string) => (h?.batches ?? []).filter(b => b.siteId === site && b.floor === floor && b.pointId === point).reduce((n, b) => n + b.containedUnits, 0);
  if (h) {
    const batches = h.batches.filter(batch => siteId ? batch.siteId === siteId : batch.patientId === 'player').slice(-8);
    if (batches.length || h.transfers?.tasks.length) notes.push('密封处理后，原用品与清洁材料仍需保管。每站点可安全收集8份；未收集的废物会继续留在原站点。');
    for (const batch of batches) {
      const job = h.jobs.find(job => job.batchId === batch.id && !['completed', 'cancelled'].includes(job.state)), moved = transferredSourceUnits(state, batch.id), total = batch.generatedUnits + batch.cleaningResidualUnits - moved, unsafe = total - batch.containedUnits;
      const held = contained(batch.siteId, batch.floor, batch.pointId) + occupied(batch.siteId, batch.floor, batch.pointId, false), reserved = occupied(batch.siteId, batch.floor, batch.pointId) - occupied(batch.siteId, batch.floor, batch.pointId, false);
      const detail = [`待处理 ${batch.contaminatedUnits} · 累计封存 ${batch.sealedUnits} · 清洁残留 ${batch.cleaningResidualUnits} · 已搬出 ${moved} · 源地 ${total} 份`, `安全入容器 ${batch.containedUnits} · 未安全收集 ${unsafe} 份`, `原站点实存 ${held}/8 · 另预约 ${reserved} 份`,
        ...(batch.hazard === 'YV1' ? ['污染用品：处理时需要防护，避免接触传播。'] : [])];
      const actions: ContextAction[] = [];
      if (job) {
        detail.push(`实际劳动 ${Math.floor(job.workedMinutes * 10) / 10}/10 分钟 · 托管 ${job.escrow.toFixed(2)} · 采购实付 ${job.purchasePaid.toFixed(2)} · 退款 ${job.refunded.toFixed(2)} 云币`, job.reason);
        if (job.completedAt === null && job.cancelledAt === null) actions.push(button('取消处理，保留废物与已购物料', 'cancelDisinfection', job.id, undefined, !canAct));
      } else if (batch.contaminatedUnits > 0) { actions.push(button('现场提交材料采购 · 20 云币托管上限', 'disinfectWaste', batch.id, undefined, !canAct || state.player.money < 20)); detail.push('一份独立实购物料与10个真实在场计薪分钟才封存；未花采购款退回。须在原公共站点提交。'); }
      if (batch.contaminatedUnits === 0 && batch.sealedUnits * 2 - moved >= 2) {
        const destinations = world.buildings.filter(b => b.kind === 'clinic' && b.id !== batch.siteId && (b.functionPoints ?? []).some(p => p.floor === 0 && p.purpose === 'service' && contained(b.id, p.floor, p.id) + occupied(b.id, p.floor, p.id) + 3 <= 8))
          .sort((a, b) => Math.hypot(a.position.x - batch.point.x, a.position.z - batch.point.z) - Math.hypot(b.position.x - batch.point.x, b.position.z - batch.point.z)).slice(0, 3);
        detail.push('志愿转运：本人20云币采购托管，一份真实运输耗材；两站各需医生2个实薪分钟。本人携带三份，接收站仍限8份。尚无末端处理。');
        for (const destination of destinations) actions.push(button(`转运保管到${destination.name}`, 'transferWaste', JSON.stringify([batch.id, destination.id]), undefined, !canAct || state.player.money < 20));
      }
      entries.push({ id: batch.id, title: `${world.buildings.find(site => site.id === batch.siteId)?.name ?? batch.siteId} · ${batch.id}`, subtitle: '诊疗用品用后保管', detail, actions });
    }
    for (const task of h.transfers?.tasks ?? []) {
      const held = contained(task.destinationSiteId, task.destinationFloor, task.destinationPointId) + occupied(task.destinationSiteId, task.destinationFloor, task.destinationPointId, false);
      const reserved = occupied(task.destinationSiteId, task.destinationFloor, task.destinationPointId) - occupied(task.destinationSiteId, task.destinationFloor, task.destinationPointId, false);
      const actions: ContextAction[] = [];
      if (task.state === 'readyForPickup') actions.push(button('本人现场提取三份封存运输包', 'collectWasteTransfer', task.id, undefined, !canAct));
      if (task.state === 'carried' || task.state === 'awaitingIntake') actions.push(button('目的诊所现场提交接收', 'deliverWasteTransfer', task.id, undefined, !canAct));
      if (task.pickedAt === null && task.state !== 'cancelled') actions.push(button('提货前取消，保留已购物料', 'cancelWasteTransfer', task.id, undefined, !canAct));
      entries.push({ id: task.id, title: `转运与保管 · ${task.id}`, subtitle: `目的 ${world.buildings.find(b => b.id === task.destinationSiteId)?.name ?? task.destinationSiteId}`,
        detail: [`原站交接 ${task.collectionMinutes}/2 · 接收 ${task.intakeMinutes}/2 分钟 · 实际移动 ${Math.floor(task.traveledDistance)}米`, `本人采购托管 ${task.escrow.toFixed(2)} · 实付 ${task.purchasePaid.toFixed(2)} · 已退 ${task.refunded.toFixed(2)} 云币`, task.reason, `目的站实存 ${held}/8 · 预约 ${reserved} 份；尚无末端处理。`], actions });
    }
  }
  if (!rows.length && !entries.length) notes.push('暂无感染与诊疗用品记录。');
  return section('卫生与诊疗用品', { rows, entries, notes });
}

const floorOf = (building: Building, y: number) => Math.floor((y - building.position.y + .01) / (building.height / Math.max(1, building.floors)));
/** ui.ts renderCulture and its forms: works, reports, petitions and the public service orders they lead to. */
function cultureSections(rules: ContextRules, world: WorldDefinition, state: SimState): PaneSection[] {
  const culture = state.culture, player = state.player, canAct = rules.canAct();
  const atCultureBuilding = (id: string) => { const b = world.buildings.find(x => x.id === id); return !!b && rules.atBuilding(id) && publicFloor(b, floorOf(b, player.position.y)); };
  const atCultureSite = (...kinds: BuildingKind[]) => world.buildings.some(b => (kinds.includes(b.kind) || kinds.includes('hall') && civicSite(b)) && atCultureBuilding(b.id));
  const project = culture?.project, site = project && world.buildings.find(b => b.id === project.siteId);
  const working = state.paused ? '时间暂停' : project && atCultureBuilding(project.siteId) && state.hour >= 7 && state.hour < 22 && player.needs.hunger >= 40 && player.needs.fatigue >= 40 ? '现场创作' : '离场、夜间或休息暂停';
  const reportNames: Record<string, string> = { water: '水质', safety: '治安', budget: '公开公库' }, statusNames: Record<string, string> = { unchecked: '待核验', verified: '证据一致', false: '已核验不实', corrected: '已更正，旧记录保留' };
  const topicNames: Record<string, string> = { education: '教育', health: '医疗', transport: '交通' };
  const works: PaneEntry[] = (culture?.works ?? []).map(work => ({ id: work.id, title: `《${work.title}》`, subtitle: `${work.genre === 'literature' ? '文学' : '绘画'} · 品质 ${Math.round(work.quality)} · ${work.publishedAt === null ? '未公开稿件' : `已有 ${work.readIds.length} 位读者`}`,
    detail: [work.text, ...(work.publishedAt === null && work.authorId === 'player' ? [] : [`发表地点：${world.buildings.find(b => b.id === work.siteId)?.name ?? '公共场所'}。每位居民需实际在场阅读 15 分钟。`])],
    actions: work.publishedAt === null && work.authorId === 'player' ? [button('现场发表 · 20 云币', 'publishWork', work.id, undefined, !canAct || !atCultureSite('market', 'pavilion', 'hall') || player.money < 20)] : [] }));
  const reports: PaneEntry[] = (culture?.reports ?? []).map(report => ({ id: report.id, title: `${reportNames[report.metric] ?? report.metric} · ${statusNames[report.status] ?? report.status}`, subtitle: `主张 ${report.claim.toFixed(2)}`,
    detail: [report.text, `原主张 ${report.originalClaim.toFixed(2)} · 发布时公开观测 ${report.evidence.observedValue.toFixed(2)}（Tick ${report.evidence.observedTick}）`, `现场读者 ${report.readIds.length} · 传播触达 ${report.reachedIds.length} · 已读更正 ${report.correctionReadIds.length}`],
    actions: [...(report.status === 'unchecked' ? [button('到书院或大厅核验 · 10 云币', 'verifyReport', report.id, undefined, !canAct || !atCultureSite('school', 'hall') || player.money < 10)] : []),
      ...(report.status === 'false' && report.authorId === 'player' ? [button('到原发布处或大厅更正 · 5 云币', 'correctReport', report.id, undefined, !canAct || !(atCultureBuilding(report.siteId) || atCultureSite('hall')) || player.money < 5)] : [])] }));
  const petitions: PaneEntry[] = (culture?.petitions ?? []).map(petition => ({ id: petition.id, title: petition.title, subtitle: `${topicNames[petition.topic] ?? petition.topic} · ${petition.signerIds.length} 位现场联署 · ${petition.status === 'answered' ? '已公开回复' : `还需 ${Math.max(0, Math.ceil((petition.replyAt - culture!.lastUpdate) / 60))} 小时回复`}`,
    detail: [petition.text, ...(petition.reply ? [petition.reply] : []), ...(petition.executionId ? [`执行记录 ${petition.executionId}；可在“公共服务订单”查看预算、供货与现场服务。`] : [])], actions: [] }));
  const busy = player.needs.hunger < 40 || player.needs.fatigue < 40;
  const forms: PaneForm[] = [
    { id: 'createWork', label: '开始创作 · 60 云币', command: { type: 'createWork' }, disabled: !canAct || !atCultureSite('school', 'pavilion') || player.money < 60 || !!culture?.project || busy, note: '在书院或亭馆公共层现场创作；需饱腹与精力各 40 以上。',
      fields: [{ key: 'targetId', label: '体裁', kind: 'select', options: [{ value: 'literature', label: '文学 · 120 分钟' }, { value: 'art', label: '绘画 · 180 分钟' }] }, { key: 'title', label: '作品标题', kind: 'text', minLength: 1, maxLength: 40 }, { key: 'text', label: '正文（20–1200 字）', kind: 'textarea', minLength: 20, maxLength: 1200 }] },
    { id: 'publishReport', label: '发布见闻 · 20 云币', command: { type: 'publishReport' }, disabled: !canAct || !atCultureSite('market', 'pavilion', 'hall') || player.money < 20, note: '在市集、亭馆或大厅发布；公共预算报道须在大厅发布。数值留空则引用当前公开观测。',
      fields: [{ key: 'targetId', label: '主题', kind: 'select', options: [{ value: 'water', label: '溪水与环境' }, { value: 'safety', label: '城区治安' }, { value: 'budget', label: '公共预算' }] }, { key: 'value', label: '记录数值', kind: 'number', optional: true }, { key: 'text', label: '内容（20–400 字）', kind: 'textarea', minLength: 20, maxLength: 400 }] },
    { id: 'filePetition', label: '递交请愿 · 10 云币', command: { type: 'filePetition' }, disabled: !canAct || !atCultureSite('hall') || player.money < 10, note: '在大厅公共层备案；联署与公开回复后进入程序审核。',
      fields: [{ key: 'targetId', label: '议题', kind: 'select', options: [{ value: 'education', label: '教育与书院' }, { value: 'health', label: '医疗与健康' }, { value: 'transport', label: '交通与出行' }] }, { key: 'title', label: '标题', kind: 'text', minLength: 1, maxLength: 40 }, { key: 'text', label: '内容（20–400 字）', kind: 'textarea', minLength: 20, maxLength: 400 }] },
  ];
  const orderNames: Record<string, string> = { agenda: '列入议程', awaitingReview: '等待程序审核', awaitingBudget: '等待合法预算', awaitingSupply: '等待实际供货', active: '现场服务中', fulfilled: '服务已完成', rejected: '已驳回' };
  const decisionSite = world.buildings.find(b => rules.atBuilding(b.id) && canReviewPetition(b, floorOf(b, player.position.y), player));
  const orders: PaneEntry[] = (culture?.orders ?? []).map(order => {
    const detail = [order.lastReason, `服务场所 ${world.buildings.find(b => b.id === order.siteId)?.name ?? order.siteId}`, `授权上限 / 实际支出 ${money(order.authorizedCap)} / ${money(order.spent)}`, `到货 / 已消耗 / 目标 ${order.receivedUnits} / ${order.consumedUnits} / ${order.targetUnits} 份`,
      `受益居民 / 在岗人员 ${order.servedIds.length} / ${order.staffIds.length} · 我的现场服务 ${Math.floor(order.serviceMinutes.player ?? 0)} / ${order.requiredMinutes} 分钟`,
      ...(order.approvedBy.length ? [`预算署名：${order.approvedBy.map(id => id === 'player' ? '本人' : state.citizens.find(c => c.id === id)?.name ?? id).join('、')}`] : []), ...(order.receipts.length ? [`${order.receipts.length} 笔实际采购回执`] : [])];
    const actions: ContextAction[] = [];
    for (const extra of culture?.supplementalBudgets?.requests.filter(r => r.orderId === order.id) ?? []) {
      detail.push(`独立追加审议 ${extra.id}：上限 ${money(extra.cap)} · 已付 ${money(extra.spent)} · 申请时尚缺 ${extra.missingUnits.toFixed(3)} 份 / 报价 ${money(extra.quotedGross)}`);
      if (extra.approvedAt !== null) detail.push(`独立署名：${extra.signatures.map(sig => sig.actorId === 'player' ? '当选市长（本人）' : state.citizens.find(c => c.id === sig.actorId)?.name ?? sig.actorId).join('、')} · ${extra.closedAt === null ? '实际采购中' : '已关账，原回执保留'}`);
      else if (extra.closedAt !== null) detail.push('订单已结束，未批准的申请关闭；没有发生追加开支。');
      else if (extra.signatureVersion === 2) detail.push('等待同一议事厅的两名在任地方议员实际在岗联审；获批后仍需留足公共工资、运维资金并购买有限材料。');
      else {
        const term = state.governance?.term, election = state.governance?.elections.find(e => e.id === term?.electionId);
        const elected = !!term && term.endedAt === null && culture!.lastUpdate >= term.startsAt && culture!.lastUpdate < term.endsAt && election?.result === 'elected';
        actions.push(button(`当选市长现场审议 · 追加 ${money(extra.cap)}`, 'reviewPetition', extra.id, undefined, !canAct || !decisionSite || !elected));
      }
    }
    if (['agenda', 'awaitingReview'].includes(order.state)) actions.push(button('市长现场审议 · 上限 40 云币', 'reviewPetition', order.petitionId, 40, !canAct || !decisionSite), button('市长现场驳回', 'reviewPetition', order.petitionId, 0, !canAct || !decisionSite));
    if (order.state === 'active' && order.topic !== 'transport') actions.push(button(order.servedIds.includes('player') ? '本项服务已经完成' : culture?.playerServiceId === order.id ? '已参加，等待现场服务完成' : '到场接受公共服务', 'attendService', order.id, undefined,
      !canAct || !atCultureBuilding(order.siteId) || player.needs.hunger < 40 || player.needs.fatigue < 35 || order.servedIds.includes('player') || culture?.playerServiceId === order.id || !!culture?.playerServiceId && culture.playerServiceId !== order.id || order.topic === 'health' && (state.extension?.actorProfiles.player?.health ?? 100) >= 95));
    const maintenance = culture?.transportMaintenance[order.siteId];
    if (maintenance) detail.push(`真实维护窗口还余 ${Math.max(0, Math.ceil(maintenance.maintainedUntil - culture!.lastUpdate))} 游戏分钟，影响该站点后续班次间隔。`);
    return { id: order.id, title: `${topicNames[order.topic] ?? order.topic} · ${orderNames[order.state] ?? order.state}`, subtitle: order.id, detail, actions };
  });
  return [
    section('作品与见闻', { rows: project ? [{ label: `正在创作《${project.title}》`, value: `${Math.floor(project.workedMinutes)} / ${project.requiredMinutes} 现场分钟 · ${site?.name ?? '创作场所'} · ${working}` }] : [],
      entries: [...works, ...reports], forms: forms.slice(0, 2), notes: project ? [] : ['当前没有创作项目。作品由实际现场时间完成，居民读完后留下记忆与学习反馈。'] }),
    section('公共信息与请愿', { entries: petitions, forms: forms.slice(2), notes: petitions.length ? [] : ['尚无请愿。'] }),
    section('公共服务订单', { entries: orders, notes: orders.length ? [] : ['备案、联署与公开回复后进入程序审核；合法预算与实际库存到位后，服务才会开展。'] }),
  ];
}
