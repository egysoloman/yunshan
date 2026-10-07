/**
 * Headless overview panes for native clients (src/ui.ts renderLife,
 * renderCity, renderTransit, renderRelationships/renderOrganizations), as
 * data. Buttons are Simulation commands with the web's enablement rules.
 */
import type { Simulation } from '../simulation';
import { publicDepartures } from '../journey';
import { JourneyNavigation } from '../journey';
import { ContextRules, activity, button, hostilityNames, hostilityStage, kindNames, modeNames, money, relationshipTitle, roleNames, romanceNames, romanceStage, type ContextAction, type ContextView } from './context-model';
import type { BuildingKind, Vec3, WorldDefinition } from '../types';

export interface PaneRow { label: string; value: string }
export interface PaneEntry { id: string; title: string; subtitle: string; detail?: string[]; actions: ContextAction[] }
export interface PaneSection { title: string; rows: PaneRow[]; entries: PaneEntry[]; actions: ContextAction[]; notes: string[] }
export interface PanesModel { panes: { id: 'life' | 'city' | 'transit' | 'relations'; title: string; sections: PaneSection[] }[] }

const ingredientNames: Record<string, string> = { grain: '稻米', vegetable: '时蔬', fish: '溪鱼' };
const recipeNames: Record<string, string> = { rice: '山居菜饭', fishSoup: '清溪鱼汤', festivalMeal: '云山团圆宴' };
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

  return { panes: [{ id: 'life', title: '生活', sections: life }, { id: 'city', title: '城市', sections: city }, { id: 'transit', title: '交通', sections: transit }, { id: 'relations', title: '人脉', sections: relationsPane }] };
}
