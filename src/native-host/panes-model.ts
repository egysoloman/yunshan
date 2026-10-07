/**
 * Headless overview panes for native clients (src/ui.ts renderLife,
 * renderCity, renderTransit, renderRelationships/renderOrganizations), as
 * data. Buttons are Simulation commands with the web's enablement rules.
 */
import type { Simulation } from '../simulation';
import { publicDepartures } from '../journey';
import { JourneyNavigation } from '../journey';
import { ContextRules, activity, button, hostilityNames, hostilityStage, kindNames, modeNames, money, relationshipTitle, roleNames, romanceNames, romanceStage, type ContextAction, type ContextView } from './context-model';
import type { BuildingKind, Company, SimState, Vec3, WorldDefinition } from '../types';
import { researchPlayerContextReason, researchProgressInfo } from '../simulation/extensions';
import { shopLifecycleMayIncorporate } from '../simulation/shop_lifecycle';
import { powerBinding } from '../simulation/power';

export interface PaneRow { label: string; value: string }
export interface PaneEntry { id: string; title: string; subtitle: string; detail?: string[]; actions: ContextAction[] }
export interface PaneSection { title: string; rows: PaneRow[]; entries: PaneEntry[]; actions: ContextAction[]; notes: string[] }
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
