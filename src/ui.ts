import type { Building, BuildingKind, Citizen, Command, Company, Relationship, Role, SimState, TransportMode, UIActions, ViewState, WorldDefinition } from './types';

const roleNames: Record<string, string> = { traveler: '星际旅行者', police: '警察', soldier: '卫士', teacher: '教师', driver: '驾驶员', merchant: '商人', mayor: '市长', scientist: '科研人员', official: '公务员', council: '议员' };
const kindNames: Record<BuildingKind, string> = { home: '住宅', market: '市集', workshop: '工坊', bank: '钱庄', hall: '官署', police: '巡检司', school: '书院', clinic: '医馆', station: '车站', core: '市政中枢', pavilion: '山顶亭', airport: '机场', starport: '星港', farm: '农场', dock: '码头' };
const modeNames: Record<TransportMode, string> = { road: '道路', maglev: '磁悬浮', lightRail: '轻轨', cable: '缆车', lift: '升降井', ferry: '渡船', bridge: '索桥', flight: '航班' };
const roleOrder: Role[] = ['traveler', 'police', 'soldier', 'teacher', 'driver', 'merchant', 'mayor', 'scientist', 'official', 'council'];
const paneNames = { life: '生活', city: '城市', industry: '产业', transit: '交通', relations: '人脉', settings: '设置' };
const districtKinds: Record<string, string> = { waterfront: '水岸与渡口', market: '商贸与生活', industry: '工坊与产业', residential: '山居与街巷', education: '书院与学堂', government: '官署与治安', energy: '水能与中枢', civic: '市政中枢', scenic: '山顶与观景', airport: '空港与客运', starport: '星港与远行' };
const activityNames: Record<string, string> = { sleeping: '睡眠中', working: '工作中', moving: '行进中', atHome: '在家', shopping: '购物中', socializing: '社交中', studying: '学习中', healing: '诊疗中', riding: '乘车中', dead: '已故', waiting: '等待发车', boarding: '登乘中', departing: '正在离站', arriving: '正在进站', congested: '拥堵等待', grounded: '停飞', noPower: '供电中断', parked: '已停靠', redLight: '红灯等待' };
const relationNames: Record<string, string> = { stranger: '陌生人', acquaintance: '相识', friend: '朋友', closeFriend: '好友', lover: '恋人', spouse: '配偶', rival: '竞争者', foe: '仇敌', enemy: '敌人' };
const romanceNames = { single: '单身', crush: '暗恋', pursuit: '追求中', dating: '交往中', engaged: '订婚', married: '已婚', family: '共同家庭' };
const hostilityNames = { none: '无敌意', discontent: '不满', rivalry: '竞争', feud: '仇敌', enemy: '敌人', mortalEnemy: '死敌' };
const hostilityRank = { none: 0, discontent: 1, rivalry: 2, feud: 3, enemy: 4, mortalEnemy: 5 };
const inventoryNames: Record<string, string> = { food: '食物', block: '体素材料', investment: '投资份额', businesses: '经营商铺', driving: '驾驶操作权' };
const ingredientNames: Record<string, string> = { grain: '稻米', vegetable: '时蔬', fish: '溪鱼' };
const recipes: Record<string, { name: string; minutes: number; ingredients: Record<string, number> }> = { rice: { name: '山居菜饭', minutes: 30, ingredients: { grain: 2, vegetable: 1 } }, fishSoup: { name: '清溪鱼汤', minutes: 45, ingredients: { fish: 1, vegetable: 2 } }, festivalMeal: { name: '云山团圆宴', minutes: 60, ingredients: { grain: 2, fish: 1, vegetable: 2 } } };
const activity = (value: string) => activityNames[value] ?? value;
const relationName = (value: string) => relationNames[value] ?? value;
const romanceStage = (rel: Relationship): keyof typeof romanceNames => rel.romanceStage ?? (rel.type === 'spouse' ? 'married' : rel.type === 'lover' ? 'dating' : 'single');
const hostilityStage = (rel: Relationship): keyof typeof hostilityNames => rel.hostilityStage ?? (rel.type === 'enemy' ? 'enemy' : rel.type === 'foe' ? 'feud' : rel.type === 'rival' ? 'rivalry' : 'none');
const relationshipTitle = (rel: Relationship): string => {
  const romance = romanceStage(rel), hostility = hostilityStage(rel);
  return [...new Set([relationName(rel.type), ...(romance !== 'single' ? [romanceNames[romance]] : []), ...(hostility !== 'none' ? [hostilityNames[hostility]] : [])])].join(' · ');
};
const districtKind = (value: string) => districtKinds[value] ?? value;
const itemName = (value: string) => value.startsWith('ingredient:') ? ingredientNames[value.slice(11)] ?? value : value.startsWith('dish:') ? recipes[value.slice(5)]?.name ?? value : inventoryNames[value] ?? value;
type Pane = keyof typeof paneNames;
type ContextKind = 'building' | 'citizen' | 'vehicle';
const money = (n: number) => `${(Math.trunc(n * 100) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 云币`;
const rounded = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('zh-CN');
const clock = (hour: number) => `${String(Math.floor(hour) % 24).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const spatialDistance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function field(label: string, value: string, className = ''): HTMLElement {
  const row = element('div', `data-row ${className}`);
  row.append(element('span', 'muted', label), element('strong', '', value));
  return row;
}
function commandButton(label: string, type: Command['type'], targetId?: string, value?: number, disabled = false): HTMLButtonElement {
  const button = element('button', 'action-button', label);
  button.type = 'button';
  button.dataset.command = type;
  if (targetId) button.dataset.target = targetId;
  if (value !== undefined) button.dataset.value = String(value);
  button.disabled = disabled;
  return button;
}

/** DOM overlay. All simulation and imported strings are written as text, never HTML. */
export class CityUI {
  private root: HTMLDivElement;
  private actions: UIActions;
  private world: WorldDefinition;
  private abort = new AbortController();
  private state: SimState | null = null;
  private view: ViewState | null = null;
  private panelOpen = false;
  private pane: Pane = 'life';
  private contextKind: ContextKind = 'building';
  private contextSignature = '';
  private selectedCitizen: string | null = null;
  private lastPanelRefresh = 0;
  private policyDirty = false;
  private selectedCompany: string | null = null;
  private bankAmount = 100;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private refs = new Map<string, HTMLElement>();
  private mapBounds: { minX: number; minZ: number; width: number; height: number };
  private mapCanvas: HTMLCanvasElement;
  private mapPoints: { id: string; x: number; y: number }[] = [];

  constructor(container: HTMLElement, world: WorldDefinition, actions: UIActions) {
    this.world = world;
    this.actions = actions;
    const margin = 140;
    const minX = Math.min(...world.districts.map(d => d.center.x - d.radius)) - margin;
    const maxX = Math.max(...world.districts.map(d => d.center.x + d.radius)) + margin;
    const minZ = Math.min(...world.districts.map(d => d.center.z - d.radius)) - margin;
    const maxZ = Math.max(...world.districts.map(d => d.center.z + d.radius)) + margin;
    this.mapBounds = { minX, minZ, width: maxX - minX, height: maxZ - minZ };
    this.root = element('div', 'city-ui');
    this.root.innerHTML = `
      <header class="masthead">
        <div class="city-brand"><span class="brand-seal" aria-hidden="true">云</span><div><h1>云山巨城</h1><p>一座山水之间的未来之城</p></div><span class="brand-rule" aria-hidden="true"></span><span class="brand-caption">山河入城<br>万家灯火</span></div>
        <div class="world-status"><span class="live-marker"><i></i> LIVE</span><span data-ref="day">初抵云山</span><strong data-ref="clock">—</strong><span data-ref="weather"></span><button type="button" class="icon-button" data-action="help" aria-label="展开操作说明" title="操作说明">?</button><button type="button" class="panel-toggle" data-action="panel" data-testid="panel-toggle" aria-expanded="false" aria-controls="city-panel"><span class="panel-toggle-symbol">☷</span><span>城市手册</span></button></div>
      </header>
      <div class="welcome-note" data-ref="welcome"><span class="welcome-dot"></span><div><strong>初抵云山，天地皆可游。</strong><span>拖动鼠标环顾 · WASD 漫游 · 选择步行，走入城中生活</span></div><button type="button" class="icon-button" data-action="dismiss-welcome" aria-label="关闭欢迎提示">×</button></div>
      <div class="navigation-strip" data-ref="navigation" hidden><span class="route-dot"></span><div><span class="eyebrow">正在导航</span><strong data-ref="destination"></strong></div><span data-ref="route-distance"></span><button type="button" class="text-button" data-action="transit">查看线路</button></div>
      <div class="aim-point" data-ref="aim" hidden aria-hidden="true"></div>
      <aside class="context-card glass-card" data-ref="context" aria-label="附近交互" hidden><div class="context-tabs" data-ref="context-tabs"></div><div data-ref="context-body"></div></aside>
      <section class="landscape-label" aria-label="当前地点"><span class="eyebrow"><span class="tiny-diamond">◇</span> <span data-ref="district-kind">山水长卷</span></span><h2 data-ref="district-name">云山巨城</h2><p data-ref="landscape-description">重峦之间，一城灯火。</p><div class="location-meta"><span data-ref="view-mode">无人机</span><span class="meta-separator"></span><span data-ref="coordinates"></span></div></section>
      <aside class="minimap-card glass-card" data-ref="minimap"><div class="mini-heading"><span>山城舆图</span><button type="button" class="text-button" data-action="transit" aria-label="打开城区导航">导航 ↗</button></div><canvas width="420" height="270" class="minimap" data-ref="map" role="img" aria-label="真实城区与交通网络地图，琥珀圆点为玩家，白色标记为镜头位置"></canvas><div class="map-legend"><span><i class="legend-player"></i>旅人</span><span><i class="legend-transit"></i>交通</span><span data-ref="map-tier"></span></div></aside>
      <aside id="city-panel" class="city-panel glass-card" data-ref="panel" hidden aria-label="城市手册"><div class="panel-heading"><div><span class="eyebrow">YUNSHAN · FIELD NOTES</span><h2>城市手册</h2></div><button type="button" class="icon-button" data-action="close-panel" aria-label="收起城市手册">×</button></div><nav class="panel-tabs" role="tablist" aria-label="手册分类"><button id="tab-life" type="button" role="tab" aria-controls="pane-life" data-pane="life" aria-selected="true">生活</button><button id="tab-city" type="button" role="tab" aria-controls="pane-city" data-pane="city" aria-selected="false">城市</button><button id="tab-transit" type="button" role="tab" aria-controls="pane-transit" data-pane="transit" aria-selected="false">交通</button><button id="tab-relations" type="button" role="tab" aria-controls="pane-relations" data-pane="relations" aria-selected="false">人脉</button><button id="tab-settings" type="button" role="tab" aria-controls="pane-settings" data-pane="settings" aria-selected="false">设置</button></nav>
      <div class="panel-scroll">
        <section id="pane-life" role="tabpanel" aria-labelledby="tab-life" data-panel-pane="life"><div class="traveler-profile"><span class="profile-glyph" aria-hidden="true">旅</span><div><span class="eyebrow">此间旅人</span><h3 data-ref="player-role">星际旅行者</h3><p data-ref="player-home">尚未在城中安家</p></div></div><div class="identity-list" data-ref="identities" aria-label="持有身份与职业资格"></div><div class="summary-pair"><div><span>随身资产</span><strong data-ref="player-money">—</strong></div><div><span>城中声望</span><strong data-ref="player-reputation">—</strong></div></div><div class="need-grid" data-ref="needs"></div><div class="panel-section"><h3>生计与日常<span class="section-hint">需步行到场</span></h3><p class="note">临工可在市集、工坊、农场和码头开始。住宅可以租住，房内可休息。</p><div class="button-grid" data-ref="daily-actions"></div></div><div class="panel-section"><h3>身份与成长</h3><div class="inline-stats" data-ref="growth"></div><label class="field-label" for="career-select">选择职业方向</label><div class="input-action-row"><select id="career-select" aria-label="职业方向" data-ref="career"><option value="1">警察</option><option value="2">卫士</option><option value="3">教师</option><option value="4">驾驶员</option><option value="5">商人</option><option value="6">市长</option><option value="7">科研人员</option><option value="8">公务员</option><option value="9">议员</option></select><button type="button" class="action-button" data-action="career" data-ref="career-button">资格考核</button></div><p class="note" data-ref="career-note"></p><button type="button" class="action-button full-width" data-action="study" data-ref="study-button">书院学习 · 40 云币</button></div><div class="panel-section"><h3>行囊</h3><div data-ref="inventory"></div></div><div class="panel-section"><h3>城中见闻<span class="section-hint">事件记录</span></h3><ol class="event-list" data-ref="events"></ol></div></section>
        <section id="pane-city" role="tabpanel" aria-labelledby="tab-city" data-panel-pane="city" hidden><div class="section-intro"><span class="eyebrow">一城生息</span><h3>万家灯火，各循其序。</h3><p class="note">能源、交通、人物、商业与治理随时间持续运转。以下数值来自当前模拟。</p></div><div class="city-meters" data-ref="city-meters"></div><div class="metric-grid" data-ref="city-metrics"></div><div class="panel-section"><h3>公共治理<span class="section-hint">市长权限 · 延迟生效</span></h3><label class="range-label" for="tax-slider"><span>营业税率</span><output data-ref="tax-label">12%</output></label><input id="tax-slider" type="range" min="0" max="30" step="1" value="12" aria-label="营业税率" data-ref="tax" data-input="tax"><label class="range-label" for="police-slider"><span>治安预算</span><output data-ref="police-label">—</output></label><input id="police-slider" type="range" min="0" max="100" step="5" value="45" aria-label="治安预算" data-ref="police" data-input="police"><button type="button" class="action-button full-width" data-action="policy" data-ref="policy-button">提交市政方案</button><p class="note" data-ref="policy-note"></p></div><div class="panel-section"><h3>城区运行<span data-ref="simulation-tiers" class="section-hint"></span></h3><div data-ref="district-list"></div></div><div class="panel-section"><h3>治安纪事</h3><div data-ref="crime-list"></div></div><div class="panel-section"><h3>模拟顺序</h3><p class="system-order" data-ref="system-order"></p></div></section>
        <section id="pane-transit" role="tabpanel" aria-labelledby="tab-transit" data-panel-pane="transit" hidden><div class="section-intro"><span class="eyebrow">山城血脉</span><h3>沿轨道，越山水。</h3><p class="note">选择城区设置导航目的地。路线标记指引方向；步行、飞行或实际搭乘载具前往。</p></div><div class="transit-summary" data-ref="transit-summary"></div><div class="panel-section"><h3>目的地<span class="section-hint">点击设为导航</span></h3><div class="destination-list" data-ref="destination-list"></div></div><div class="panel-section"><h3>客运与航班<span class="section-hint">实时载具</span></h3><div data-ref="departures"></div></div><div class="panel-section"><h3>当前乘坐</h3><div data-ref="current-vehicle"></div></div><div class="panel-section"><h3>路口调度</h3><p class="note">警察与市长可调整附近路口，交通流会响应。</p><div class="button-grid"><button type="button" class="action-button" data-action="signal" data-value="1">调度附近路口</button><button type="button" class="action-button" data-action="signal" data-value="2">恢复自动调度</button></div></div></section>
        <section id="pane-relations" role="tabpanel" aria-labelledby="tab-relations" data-panel-pane="relations" hidden><div class="section-intro"><span class="eyebrow">城中故人</span><h3>相逢有迹，往事有声。</h3><p class="note">每次交谈、礼物与冲突都留下记忆。接近城中居民，可了解其住处、工作与生活状态。</p></div><div data-ref="partner"></div><div class="relationship-list" data-ref="relationship-list"></div><div data-ref="relationship-detail"></div></section>
        <section id="pane-settings" role="tabpanel" aria-labelledby="tab-settings" data-panel-pane="settings" hidden><div class="section-intro"><span class="eyebrow">随心游览</span><h3>留住此刻，轻装远行。</h3></div><div class="panel-section"><h3>画面与性能</h3><label class="field-label" for="quality-select">画质档位</label><select id="quality-select" data-testid="quality-select" data-ref="quality" data-input="quality" aria-label="画质档位"><option value="low">轻量 · 节省资源</option><option value="balanced">均衡 · 推荐</option><option value="high">精致 · 更多细节</option></select><label class="range-label" for="distance-slider"><span>渲染距离</span><output data-ref="distance-label">3,600 m</output></label><input id="distance-slider" data-ref="distance" data-input="renderDistance" type="range" min="900" max="6000" step="300" value="3600" aria-label="渲染距离"><label class="field-label" for="fps-select">帧率上限</label><select id="fps-select" data-ref="fps-cap" data-input="fpsCap" aria-label="帧率上限"><option value="30">30 FPS · 省电</option><option value="60">60 FPS · 流畅</option><option value="120">120 FPS</option></select><label class="check-row"><input type="checkbox" data-ref="dynamic" data-input="dynamicResolution" checked><span>动态分辨率</span><small>按帧时调节</small></label><label class="range-label" for="simulation-slider"><span>附近模拟精度</span><output data-ref="simulation-label">100%</output></label><input id="simulation-slider" data-ref="simulation-detail" data-input="simulationDetail" type="range" min="0.5" max="2" step="0.1" value="1" aria-label="附近模拟精度"><div class="performance-readout" data-ref="performance"></div><p class="note">macOS 建议从均衡画质与 60 FPS 开始。较早机型可选择轻量、30 FPS 和动态分辨率。</p></div><div class="panel-section"><h3>存档与旅程</h3><div class="button-grid"><button type="button" class="action-button" data-action="save" data-testid="save">保存进度</button><button type="button" class="action-button" data-action="load" data-testid="load">读取进度</button><button type="button" class="action-button" data-action="export">导出 JSON</button><button type="button" class="action-button" data-action="import">导入 JSON</button></div><input type="file" accept="application/json,.json" data-ref="file" hidden aria-label="选择本地存档文件"><p class="note">存档保存在本机浏览器；导入与导出使用本地 JSON 文件。</p><button type="button" class="action-button full-width" data-action="reset">回到山城全景</button></div><div class="panel-section"><h3>操作说明</h3><div class="control-guide"><span>W A S D</span><p>移动 / 漫游</p><span>鼠标拖动</span><p>环顾 · 双击进入鼠标锁定</p><span>Shift</span><p>加速</p><span>R / Q</span><p>飞行升高 / 降低</p><span>E</span><p>进出建筑 / 使用楼梯 / 交互</p><span>V</span><p>切换视角</p><span>Esc</span><p>释放鼠标</p></div></div></section>
      </div></aside>
      <div class="help-popover glass-card" data-ref="help" hidden><div class="mini-heading"><strong>随心入城</strong><button type="button" class="icon-button" data-action="help" aria-label="收起操作说明">×</button></div><div class="control-guide"><span>W A S D</span><p>自由移动</p><span>鼠标拖动</span><p>环顾 · 双击锁定</p><span>Shift</span><p>加速</p><span>R / Q</span><p>飞行升高 / 降低</p><span>E</span><p>建筑、楼梯与附近交互</p><span>V</span><p>切换视角</p><span>Esc</span><p>释放鼠标</p></div><p class="note">在步行视角接近入口，可进入建筑；书院学习、钱庄业务与职业考核均需到场。</p></div>
      <footer class="exploration-dock glass-card" aria-label="游览与时间控制"><div class="view-controls" role="group" aria-label="游览视角"><button type="button" data-action="mode" data-mode="drone" data-testid="mode-drone" aria-pressed="true"><span class="mode-symbol" aria-hidden="true">◇</span>无人机</button><button type="button" data-action="mode" data-mode="walk" data-testid="mode-walk" aria-pressed="false"><span class="mode-symbol" aria-hidden="true">人</span>步行</button><button type="button" data-action="mode" data-mode="jet" data-testid="mode-jet" aria-pressed="false"><span class="mode-symbol" aria-hidden="true">↗</span>飞行</button></div><span class="dock-divider"></span><div class="time-controls"><button type="button" class="pause-button" data-action="pause" data-testid="pause-toggle" aria-label="暂停时间" aria-pressed="false" data-ref="pause">Ⅱ</button><div class="time-range"><div class="time-range-label"><span>昼夜流转</span><output data-ref="time-label">—</output></div><input type="range" min="0" max="23.99" step="0.01" value="8" data-ref="time" data-input="time" data-testid="time-slider" aria-label="一天中的时刻"><div class="sun-marks" aria-hidden="true"><span>子夜</span><span>晨</span><span>午</span><span>暮</span><span>夜</span></div></div><select aria-label="模拟时间速度" class="speed-select" data-input="speed" data-ref="speed"><option value="1">1×</option><option value="3">3×</option><option value="10">10×</option><option value="16">16×</option></select></div></footer>
      <div class="toast" data-ref="toast" role="status" aria-live="polite" hidden></div>
      <div class="render-stats" data-ref="render-stats" aria-label="性能数据"></div>`;
    this.addExtensionSections();
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-ref]')) this.refs.set(node.dataset.ref!, node);
    try {
      if (localStorage.getItem('yunshan.ui.welcomeSeen.v1') === '1') this.ref('welcome').hidden = true;
      else localStorage.setItem('yunshan.ui.welcomeSeen.v1', '1');
    } catch { /* The controls remain usable when browser storage is restricted. */ }
    this.mapCanvas = this.ref<HTMLCanvasElement>('map');
    container.append(this.root);
    const signal = this.abort.signal;
    this.root.addEventListener('click', this.onClick, { signal });
    this.root.addEventListener('input', this.onInput, { signal });
    this.root.addEventListener('change', this.onChange, { signal });
    this.root.addEventListener('keydown', this.onKeyDown, { signal });
    this.mapCanvas.addEventListener('click', this.onMapClick, { signal });
    this.ref<HTMLInputElement>('file').addEventListener('change', () => {
      const input = this.ref<HTMLInputElement>('file');
      const file = input.files?.[0];
      if (file) this.actions.importSave(file);
      input.value = '';
    }, { signal });
    this.setPane('life');
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T { return this.refs.get(name)! as T; }
  private addExtensionSections(): void {
    const tab = element('button', '', '产业');
    tab.id = 'tab-industry'; tab.type = 'button'; tab.dataset.pane = 'industry';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'pane-industry'); tab.setAttribute('aria-selected', 'false');
    this.root.querySelector('[data-pane="transit"]')!.before(tab);
    const industry = element('section');
    industry.id = 'pane-industry'; industry.dataset.panelPane = 'industry'; industry.hidden = true;
    industry.setAttribute('role', 'tabpanel'); industry.setAttribute('aria-labelledby', 'tab-industry');
    industry.innerHTML = `<div class="section-intro"><span class="eyebrow">百业与新知</span><h3>从一间铺子，到一城产业。</h3><p class="note">企业的雇员、库存、营收与股价随经营变化，科研投入会逐步影响公共系统。</p></div><div data-ref="company-summary"></div><div class="panel-section"><h3>我的事业</h3><div data-ref="company-actions"><label class="field-label" for="company-capital">创办公司的初始资本</label><select id="company-capital" data-ref="company-capital" aria-label="公司初始资本"><option value="300">300 云币</option><option value="500" selected>500 云币</option><option value="1000">1,000 云币</option></select><button type="button" class="action-button full-width" data-action="found-company" data-ref="found-company">在此创办公司</button><p class="note" data-ref="found-note"></p></div><div class="company-list" data-ref="company-list"></div><div data-ref="company-detail"></div></div><div class="panel-section"><h3>产业版图<span class="section-hint">控股与并购</span></h3><p class="note">已控制至少一家企业的商人，可到目标公司现场洽谈并购。报价按未持有股份与实时股价计算。</p><div data-ref="company-market"></div></div><div class="panel-section"><h3>交易所<span class="section-hint">钱庄现场业务</span></h3><p class="note">买卖按每股实时价格结算，每次 10 股。上市要求企业 2 级、资本 600 云币，发行费 200 云币。</p><div data-ref="stock-list"></div></div><div class="panel-section"><h3>科技与未来<span class="section-hint">两小时研究周期</span></h3><label class="field-label" for="research-budget">研究投入</label><select id="research-budget" data-ref="research-budget" aria-label="研究投入预算"><option value="100">100 云币</option><option value="200" selected>200 云币</option><option value="500">500 云币</option><option value="1000">1,000 云币</option></select><p class="note">持科研身份与教育 3，在书院或天枢阁研究；新技术逐步影响系统，也有副作用。</p><div data-ref="research-list"></div></div>`;
    this.root.querySelector('#pane-transit')!.before(industry);
    const life = element('div', 'panel-section');
    life.innerHTML = `<h3>身心与生活</h3><div data-ref="life-profile"></div><div data-ref="health-actions"></div><div class="panel-section"><h3>烟火食事<span class="section-hint">厨房与食材</span></h3><div data-ref="cooking-status"></div><div data-ref="ingredient-actions"></div><label class="field-label" for="recipe-select">选择料理</label><select id="recipe-select" data-ref="recipe" aria-label="选择料理食谱"><option value="rice">山居菜饭 · 30 分钟</option><option value="fishSoup">清溪鱼汤 · 45 分钟</option><option value="festivalMeal">云山团圆宴 · 60 分钟</option></select><p class="note" data-ref="recipe-note"></p><label class="range-label" for="heat-slider"><span>烹饪火候</span><output data-ref="heat-label">60</output></label><input id="heat-slider" data-ref="heat" data-input="heat" type="range" min="0" max="100" step="1" value="60" aria-label="烹饪火候"><button type="button" class="action-button full-width" data-action="cook" data-ref="cook-button">开始烹饪</button><div data-ref="cooking-actions"></div><p class="note">市集、农场或码头购买食材；自家住宅、医馆或市集可烹饪，料理完成后可食用。</p></div>`;
    this.root.querySelector('#pane-life')!.append(life);
    const publicSystems = element('div', 'panel-section');
    publicSystems.innerHTML = `<h3>山水与公共服务</h3><div data-ref="public-services"></div><div class="panel-section"><h3>审计与司法<span class="section-hint">证据与处置记录</span></h3><div data-ref="audit-actions"></div><div data-ref="audit-list"></div></div><div class="panel-section"><h3>公共账目<span class="section-hint">最近收支</span></h3><ol class="event-list" data-ref="public-ledger"></ol></div>`;
    this.root.querySelector('#pane-city')!.append(publicSystems);
    const organizations = element('div', 'panel-section');
    organizations.innerHTML = `<h3>社区与组织</h3><div data-ref="organization-list"></div><div class="button-grid" data-ref="culture-actions"></div>`;
    this.root.querySelector('#pane-relations')!.append(organizations);
  }
  private setText(name: string, value: string): void { const node = this.ref(name); if (node.textContent !== value) node.textContent = value; }
  private setInput(name: string, value: string): void { const node = this.ref<HTMLInputElement | HTMLSelectElement>(name); if (document.activeElement !== node && node.value !== value) node.value = value; }
  private hasRole(...roles: string[]): boolean {
    if (!this.state) return false;
    const player = this.state.player as SimState['player'] & { identities?: Role[] };
    return roles.some(role => (player.identities ?? [player.role]).includes(role as Role));
  }
  private canWorkAt(kind: BuildingKind): boolean {
    const workplaces: Record<string, BuildingKind[]> = { traveler: ['market', 'workshop', 'farm', 'dock'], police: ['police'], soldier: ['police', 'starport'], teacher: ['school'], driver: ['station', 'airport', 'starport', 'dock'], merchant: ['market', 'workshop', 'farm'], mayor: ['hall', 'core'], scientist: ['school', 'core', 'workshop'], official: ['hall', 'core'], council: ['hall', 'core'] };
    return Object.entries(workplaces).some(([role, kinds]) => this.hasRole(role) && kinds.includes(kind));
  }
  private canAct(): boolean { return this.view?.mode === 'walk' && this.state?.extension?.actorProfiles.player?.alive !== false; }
  private atBuilding(id: string): boolean {
    if (!this.canAct() || !this.state) return false;
    const building = this.world.buildings.find(b => b.id === id);
    if (!building) return false;
    const p = this.state.player.position;
    const minY = building.position.y - (building.basements ?? 0) * building.height / building.floors - 1;
    const inside = this.view?.inside && this.view.nearbyBuilding?.id === id && Math.abs(p.x - building.position.x) <= building.width / 2 + .5 && Math.abs(p.z - building.position.z) <= building.depth / 2 + .5 && p.y >= minY && p.y <= building.position.y + building.height + 1;
    if (inside) return true;
    return Math.hypot(p.x - building.door.x, p.y - building.door.y, p.z - building.door.z) <= 32;
  }
  private atKind(...kinds: BuildingKind[]): boolean { return this.world.buildings.some(b => kinds.includes(b.kind) && this.atBuilding(b.id)); }
  private atFacility(...facilities: NonNullable<Building['facility']>[]): boolean { return this.world.buildings.some(b => !!b.facility && facilities.includes(b.facility) && this.atBuilding(b.id)); }
  private controlled(company: Company): boolean { return (company.shareholders.player ?? 0) > company.shares / 2; }
  private socialClock(): number { return this.state?.extension?.lastUpdate ?? (this.state ? this.state.day * 1440 + this.state.hour * 60 : 0); }
  private romanceAge(rel: Relationship): number { return Math.max(0, this.socialClock() - (rel.romanceSince ?? this.socialClock())); }
  private romanceNote(rel: Relationship): string {
    const stage = romanceStage(rel);
    const wait = stage === 'pursuit' ? 60 : ['dating', 'engaged'].includes(stage) ? 120 : stage === 'married' ? 240 : 0;
    const remaining = Math.max(0, Math.ceil(wait - this.romanceAge(rel)));
    if (stage === 'pursuit') return `追求后需相处 60 分钟与共同经历 6 次，再确认交往；${remaining ? `还需 ${remaining} 分钟` : '时间条件已满足'}，双方意愿仍需确认。`;
    if (stage === 'dating') return `交往满 120 分钟、好感 80、信任 60、共同经历 8 次并有住所，可诚意求婚；${remaining ? `还需 ${remaining} 分钟` : '时间条件已满足'}。`;
    if (stage === 'engaged') return `订婚满 120 分钟可办理婚姻；${remaining ? `还需 ${remaining} 分钟` : '时间条件已满足'}，双方同意后继续共同生活。`;
    if (stage === 'married') return `婚后共同生活满 240 分钟，进入家庭阶段；${remaining ? `还需 ${remaining} 分钟` : '继续共同生活'}。`;
    if (stage === 'family') return '已进入共同家庭阶段；住处、财产、相处记忆持续影响双方生活。';
    return '表达心意需好感 55、信任 35、共同经历 4 次，并双方单身。';
  }
  private setPanel(open: boolean, pane?: Pane): void {
    const wasOpen = this.panelOpen;
    const focusInside = this.ref('panel').contains(document.activeElement);
    this.panelOpen = open;
    this.ref('panel').hidden = !open;
    this.ref('minimap').hidden = open;
    this.root.classList.toggle('panel-is-open', open);
    const toggle = this.root.querySelector<HTMLButtonElement>('[data-action="panel"]')!;
    toggle.setAttribute('aria-expanded', String(open));
    if (pane) this.setPane(pane);
    if (open && this.state && this.view) this.refreshPanel();
    if (open && !wasOpen) this.root.querySelector<HTMLButtonElement>(`[data-pane="${this.pane}"]`)?.focus({ preventScroll: true });
    if (!open && focusInside) toggle.focus({ preventScroll: true });
  }
  private setPane(pane: Pane): void {
    this.pane = pane;
    for (const tab of this.root.querySelectorAll<HTMLButtonElement>('[data-pane]')) {
      const active = tab.dataset.pane === pane;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of this.root.querySelectorAll<HTMLElement>('[data-panel-pane]')) panel.hidden = panel.dataset.panelPane !== pane;
    if (this.state && this.view) this.refreshPanel();
  }
  private onKeyDown = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).closest('summary') && ['Enter', ' '].includes(event.key)) event.stopPropagation();
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pane]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const keys = Object.keys(paneNames) as Pane[];
      const current = keys.indexOf(this.pane);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
      this.setPane(keys[index]);
      this.root.querySelector<HTMLButtonElement>(`[data-pane="${keys[index]}"]`)?.focus();
    }
    if (event.key === 'Escape') {
      this.ref('help').hidden = true;
      if (this.panelOpen) this.setPanel(false);
    }
  };
  private onClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.pane) { this.setPane(button.dataset.pane as Pane); return; }
    if (button.dataset.context) { this.contextKind = button.dataset.context as ContextKind; this.contextSignature = ''; this.refreshContext(); return; }
    if (button.dataset.citizen) { this.selectedCitizen = button.dataset.citizen; this.refreshPanel(); return; }
    if (button.dataset.company) { this.selectedCompany = button.dataset.company; this.refreshPanel(); return; }
    if (button.dataset.destination) { this.actions.travel(button.dataset.destination); return; }
    if (button.dataset.command) {
      this.actions.command({ type: button.dataset.command as Command['type'], targetId: button.dataset.target, value: button.dataset.value === undefined ? undefined : Number(button.dataset.value), position: button.dataset.x === undefined ? undefined : { x: Number(button.dataset.x), y: Number(button.dataset.y), z: Number(button.dataset.z) } });
      return;
    }
    const state = this.state;
    const building = this.view?.nearbyBuilding;
    switch (button.dataset.action) {
      case 'panel': this.setPanel(!this.panelOpen); break;
      case 'close-panel': this.setPanel(false); break;
      case 'transit': this.setPanel(true, 'transit'); break;
      case 'help': this.ref('help').hidden = !this.ref('help').hidden; break;
      case 'dismiss-welcome': this.ref('welcome').hidden = true; break;
      case 'mode': this.actions.setMode(button.dataset.mode as ViewState['mode']); break;
      case 'pause': if (state) this.actions.command({ type: 'pause', value: state.paused ? 0 : 1 }); break;
      case 'interact': this.actions.interact(); break;
      case 'save': this.actions.save(); break;
      case 'load': this.actions.load(); break;
      case 'export': this.actions.exportSave(); break;
      case 'import': this.ref<HTMLInputElement>('file').click(); break;
      case 'reset': this.actions.resetView(); break;
      case 'career': {
        const value = Number(this.ref<HTMLSelectElement>('career').value);
        this.actions.command({ type: value === 6 ? 'election' : 'exam', value, targetId: value === 6 ? building?.id : roleOrder[value] });
        break;
      }
      case 'study': this.actions.command({ type: 'exam', targetId: 'study' }); break;
      case 'policy': this.policyDirty = false; this.actions.command({ type: 'policy', taxRate: Number(this.ref<HTMLInputElement>('tax').value) / 100, policeBudget: Number(this.ref<HTMLInputElement>('police').value) / 100, targetId: building?.id }); break;
      case 'signal': this.actions.command({ type: 'signal', value: Number(button.dataset.value), position: state?.player.position }); break;
      case 'bank': this.actions.command({ type: button.dataset.bank as Command['type'], targetId: building?.id, value: Number(this.root.querySelector<HTMLSelectElement>('#bank-amount')?.value ?? 100) }); break;
      case 'relations': this.setPanel(true, 'relations'); this.selectedCitizen = this.view?.nearbyCitizen?.id ?? null; this.renderRelationships(); break;
      case 'city': this.setPanel(true, 'city'); break;
      case 'industry': this.setPanel(true, 'industry'); break;
      case 'found-company': this.actions.command({ type: 'foundCompany', targetId: building?.id, value: Number(this.ref<HTMLSelectElement>('company-capital').value) }); break;
      case 'cook': this.actions.command({ type: 'cook', targetId: this.ref<HTMLSelectElement>('recipe').value, value: Number(this.ref<HTMLInputElement>('heat').value) }); break;
    }
  };
  private onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    switch (input.dataset.input) {
      case 'time': this.setText('time-label', clock(Number(input.value))); this.actions.command({ type: 'setTime', value: Number(input.value) }); break;
      case 'tax': this.policyDirty = true; this.setText('tax-label', `${input.value}%`); break;
      case 'police': this.policyDirty = true; this.setText('police-label', `${input.value}%`); break;
      case 'renderDistance': this.setText('distance-label', `${rounded(Number(input.value))} m`); this.actions.setSetting('renderDistance', Number(input.value)); break;
      case 'simulationDetail': this.setText('simulation-label', `${Math.round(Number(input.value) * 100)}%`); this.actions.setSetting('simulationDetail', Number(input.value)); break;
      case 'heat': this.setText('heat-label', input.value); break;
    }
  };
  private onChange = (event: Event): void => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    switch (input.dataset.input) {
      case 'quality': this.actions.setQuality(input.value as ViewState['quality']); break;
      case 'speed': this.actions.command({ type: 'speed', value: Number(input.value) }); break;
      case 'fpsCap': this.actions.setSetting('fpsCap', Number(input.value)); break;
      case 'dynamicResolution': this.actions.setSetting('dynamicResolution', (input as HTMLInputElement).checked); break;
    }
    if (input === this.ref('career') && this.state && this.view) this.renderCareer();
    if (input.id === 'bank-amount') this.bankAmount = Number(input.value);
    if (['company-capital', 'research-budget'].includes(input.id) && this.state && this.view) this.renderIndustry();
    if (input.id === 'recipe-select' && this.state && this.view) this.renderLifeSystems();
  };
  private onMapClick = (event: MouseEvent): void => {
    const bounds = this.mapCanvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * this.mapCanvas.width;
    const y = (event.clientY - bounds.top) / bounds.height * this.mapCanvas.height;
    let nearest = this.mapPoints[0];
    for (const point of this.mapPoints) if (Math.hypot(point.x - x, point.y - y) < Math.hypot(nearest.x - x, nearest.y - y)) nearest = point;
    if (nearest && Math.hypot(nearest.x - x, nearest.y - y) < 35) this.actions.travel(nearest.id);
  };

  update(state: SimState, view: ViewState): void {
    this.state = state;
    this.view = view;
    this.setText('day', `第 ${state.day + 1} 日`);
    this.setText('clock', clock(state.hour));
    this.setText('weather', state.weather);
    this.setText('time-label', clock(state.hour));
    this.setInput('time', String(state.hour));
    this.setInput('speed', String(state.speed));
    const pause = this.ref<HTMLButtonElement>('pause');
    pause.textContent = state.paused ? '▶' : 'Ⅱ';
    pause.setAttribute('aria-label', state.paused ? '继续时间' : '暂停时间');
    pause.setAttribute('aria-pressed', String(state.paused));
    for (const mode of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]')) mode.setAttribute('aria-pressed', String(mode.dataset.mode === view.mode));
    const district = this.nearestDistrict(view.position);
    this.setText('district-name', district.name);
    this.setText('district-kind', districtKind(district.kind));
    this.setText('landscape-description', view.inside ? `已进入 ${view.nearbyBuilding?.name ?? '建筑'} · 使用 E 进出，楼梯处可换层` : this.sceneDescription(district.id, state.hour));
    const vehicle = state.vehicles.find(v => v.id === state.player.vehicleId);
    const driving = (state.player.inventory.driving ?? 0) === 1;
    this.setText('view-mode', `${vehicle ? `${driving ? '驾驶' : '乘坐'}${modeNames[vehicle.kind]}` : view.mode === 'walk' ? roleNames[state.player.role] : view.mode === 'jet' ? '自由飞行' : '无人机漫游'}${view.inside ? ' · 室内' : ''}`);
    this.setText('coordinates', `${Math.round(view.position.x)} / ${Math.round(view.position.y)} / ${Math.round(view.position.z)} m`);
    this.ref('aim').hidden = view.mode !== 'walk';
    this.setText('render-stats', `${rounded(view.fps)} FPS · ${rounded(view.drawCalls)} draw`);
    const target = this.world.districts.find(d => d.id === view.targetDistrict);
    this.ref('navigation').hidden = !target;
    if (target) {
      this.setText('destination', target.name);
      const meters = distance(view.position, target.center);
      this.setText('route-distance', meters < target.radius ? '已抵达城区' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${rounded(meters)} m`);
    }
    this.refreshContext();
    this.drawMap();
    if (this.panelOpen && performance.now() - this.lastPanelRefresh > 700) this.refreshPanel();
  }

  private nearestDistrict(position: { x: number; z: number }) { return this.world.districts.reduce((a, b) => distance(position, a.center) < distance(position, b.center) ? a : b); }
  private sceneDescription(districtId: string, hour: number): string {
    const district = this.world.districts.find(d => d.id === districtId)!;
    const night = hour < 5 || hour >= 19;
    const kind = district.kind;
    if (kind === 'civic') return night ? '天枢灯明，市政与一城生息相连。' : '瀑声入阁，开放的市政大厅迎接每位旅人。';
    if (/水|岸|港/.test(kind + district.name)) return night ? '水岸灯火，渡船沿溪而行。' : '云影入水，桥与船连接两岸。';
    if (/山顶|亭|峰/.test(kind + district.name)) return night ? '登临高处，望一城灯火。' : '层峦在足下，山风穿过飞檐。';
    if (/能源|瀑|中枢/.test(kind + district.name)) return night ? '瀑声不息，能量光带贯穿群山。' : '瀑布穿崖，层楼依水向天。';
    if (/工|坊/.test(kind + district.name)) return night ? '工坊尚明，货物流向远方。' : '沿山而筑，百工有序，车流不息。';
    return night ? '夜色入山，万家灯火沿谷而生。' : hour < 9 ? '晨雾渐散，街巷间的一天正在开始。' : hour >= 16 ? '斜阳染檐，山城在暮色中舒展。' : '重峦之间，街巷与轨道连接一城生息。';
  }
  private refreshPanel(): void {
    if (!this.state || !this.view) return;
    const focused = document.activeElement;
    const focusData = focused instanceof HTMLButtonElement && this.ref('panel').contains(focused) ? { ...focused.dataset } : null;
    const focusText = focused?.textContent;
    this.lastPanelRefresh = performance.now();
    if (this.pane === 'life') this.renderLife();
    if (this.pane === 'city') this.renderCity();
    if (this.pane === 'industry') this.renderIndustry();
    if (this.pane === 'transit') this.renderTransit();
    if (this.pane === 'relations') this.renderRelationships();
    if (this.pane === 'settings') this.renderSettings();
    if (focusData && focused && !focused.isConnected) {
      const replacement = [...this.root.querySelectorAll<HTMLButtonElement>(`#pane-${this.pane} button`)].find(button => button.textContent === focusText && Object.entries(focusData).every(([key, value]) => button.dataset[key] === value));
      replacement?.focus({ preventScroll: true });
    }
  }
  private renderLife(): void {
    const state = this.state!;
    const player = state.player;
    this.setText('player-role', roleNames[player.role]);
    this.setText('player-home', player.homeId ? `居于 ${this.world.buildings.find(b => b.id === player.homeId)?.name ?? '城中住宅'}` : '尚未在城中安家');
    this.ref('identities').replaceChildren(...(player.identities ?? [player.role]).map(role => element('span', `identity-chip${role === player.role ? ' current' : ''}`, roleNames[role] ?? role)));
    this.setText('player-money', money(player.money));
    this.setText('player-reputation', String(Math.round(player.reputation * 10) / 10));
    this.renderNeeds(this.ref('needs'), player.needs);
    const building = this.view!.nearbyBuilding;
    const absent = !building || !this.canAct();
    this.ref('daily-actions').replaceChildren(commandButton('就地工作', 'work', building?.id, undefined, absent || !building || !this.canWorkAt(building.kind)), commandButton('休息片刻', 'rest', building?.id, undefined, absent || !building || !['home', 'clinic', 'pavilion', 'station'].includes(building.kind)), commandButton('租住住宅 · 80 云币', 'rent', building?.id, undefined, absent || building?.kind !== 'home'));
    this.ref('growth').replaceChildren(field('教育', `${player.education}`), field('工作经验', `${player.experience}`));
    this.renderCareer();
    const items = Object.entries(player.inventory).filter(([item, amount]) => amount > 0 && !item.startsWith('business:') && !item.startsWith('dishQuality:'));
    this.ref('inventory').replaceChildren(...(items.length ? items.map(([item, amount]) => field(itemName(item), item === 'investment' ? money(amount) : `× ${rounded(amount)}`)) : [element('p', 'note', '行囊尚空。市集购买的食物和礼物会放在这里。')]));
    this.ref('events').replaceChildren(...state.events.slice(-8).reverse().map(event => {
      const item = element('li');
      item.append(element('span', 'event-tick', `#${event.tick}`), element('p', '', event.text));
      return item;
    }));
    this.renderLifeSystems();
  }
  private renderCareer(): void {
    const role = roleOrder[Number(this.ref<HTMLSelectElement>('career').value)];
    const building = this.view!.nearbyBuilding;
    const expected: Partial<Record<Role, BuildingKind[]>> = { police: ['police'], soldier: ['police'], teacher: ['school'], driver: ['station', 'airport'], merchant: ['market'], mayor: ['hall', 'core'], scientist: ['school', 'core'], official: ['hall', 'core'], council: ['hall', 'core'] };
    const onSite = this.canAct() && !!building && (!!expected[role]?.includes(building.kind) || role === 'scientist' && building.facility === 'data');
    const education = role === 'scientist' ? 3 : ['soldier', 'mayor', 'official', 'council'].includes(role) ? 2 : 1;
    const requirement = role === 'mayor' ? '官署参选：教育 2、声望 8、工作经验 4，参选 120 云币；两小时后计票。' : `${expected[role]?.map(k => kindNames[k]).join(' / ')}现场考核：教育至少 ${education}，考核 80 云币。`;
    this.setText('career-note', requirement);
    const button = this.ref<HTMLButtonElement>('career-button');
    button.textContent = role === 'mayor' ? '参加竞选' : '资格考核';
    button.disabled = !onSite;
    button.title = onSite ? requirement : '请切换步行并到对应场所';
    this.ref<HTMLButtonElement>('study-button').disabled = !this.canAct() || building?.kind !== 'school';
  }
  private renderNeeds(container: HTMLElement, needs: SimState['player']['needs']): void {
    const labels: Record<keyof typeof needs, string> = { hunger: '饱腹', fatigue: '精力', social: '社交', fun: '娱乐' };
    container.replaceChildren(...(Object.keys(labels) as (keyof typeof needs)[]).map(key => {
      const item = element('div', 'need-item');
      const value = Math.max(0, Math.min(100, needs[key]));
      item.append(field(labels[key], `${Math.round(value)}`));
      const bar = element('div', 'meter-track');
      const fill = element('i', value < 25 ? 'meter-fill meter-warn' : 'meter-fill');
      fill.style.width = `${value}%`;
      bar.append(fill); item.append(bar); return item;
    }));
  }
  private renderCity(): void {
    const state = this.state!;
    const average = (key: 'safety' | 'employment' | 'prosperity') => state.districts.reduce((sum, d) => sum + d[key], 0) / Math.max(1, state.districts.length);
    const gauges = [['能源', state.energy], ['治安', average('safety')], ['就业', average('employment') * 100], ['民意', state.support]] as const;
    this.ref('city-meters').replaceChildren(...gauges.map(([label, value]) => {
      const item = element('div', 'city-meter'); item.append(field(label, `${Math.round(value)}%`));
      const track = element('div', 'meter-track'); const fill = element('i', value < 30 ? 'meter-fill meter-warn' : 'meter-fill'); fill.style.width = `${Math.max(0, Math.min(100, value))}%`; track.append(fill); item.append(track); return item;
    }));
    this.ref('city-metrics').replaceChildren(...[['城市人口', rounded(state.districts.reduce((sum, d) => sum + d.residents, 0))], ['城市金库', money(state.treasury)], ['可进入建筑', rounded(this.world.buildings.length)], ['地理城区', rounded(this.world.districts.length)], ['累计产值', money(state.gdp)], ['未结案件', rounded(state.crimes.filter(c => c.status !== 'resolved').length)], ['商业交易', rounded(state.metrics.trades)], ['物流交付', rounded(state.metrics.freight)]].map(([label, value]) => { const item = element('div'); item.append(element('span', '', label), element('strong', '', value)); return item; }));
    const focused = document.activeElement;
    if (!this.policyDirty && focused !== this.ref('tax') && focused !== this.ref('police')) {
      const policy = state.policyPending ?? state;
      this.setInput('tax', String(Math.round(policy.taxRate * 100)));
      this.setInput('police', String(Math.round(policy.policeBudget * 100)));
      this.setText('tax-label', `${Math.round(policy.taxRate * 100)}%`);
      this.setText('police-label', `${Math.round(policy.policeBudget * 100)}%`);
    }
    this.ref<HTMLButtonElement>('policy-button').disabled = !this.hasRole('mayor') || this.view!.mode !== 'walk' || !['hall', 'core'].includes(this.view!.nearbyBuilding?.kind ?? '');
    this.setText('policy-note', state.policyPending ? `方案待执行 · 当前税率 ${Math.round(state.taxRate * 100)}%，治安预算 ${Math.round(state.policeBudget * 100)}%。` : this.hasRole('mayor') ? '请在官署提交方案；两个游戏小时后影响税收与公共治安。' : '到官署参选成为市长后，可提交治理方案。');
    const counts = { active: 0, regional: 0, statistical: 0 };
    for (const district of state.districts) counts[district.tier]++;
    this.setText('simulation-tiers', `${counts.active} 活跃 · ${counts.regional} 区域 · ${counts.statistical} 统计`);
    this.ref('district-list').replaceChildren(...state.districts.map(d => {
      const row = element('div', 'district-row');
      const name = this.world.districts.find(def => def.id === d.id)?.name ?? d.id;
      row.append(element('strong', '', name), element('span', 'muted', `治安 ${Math.round(d.safety)} · 繁荣 ${Math.round(d.prosperity)}`));
      const tier = element('i', `tier-dot tier-${d.tier}`); tier.title = d.tier; row.prepend(tier); return row;
    }));
    const crimes = state.crimes.filter(c => c.status !== 'resolved').slice(-5);
    this.ref('crime-list').replaceChildren(...(crimes.length ? crimes.map(crime => {
      const item = element('div', 'crime-row');
      const district = this.world.districts.find(d => d.id === crime.districtId);
      item.append(element('span', '', `${district?.name ?? '城区'} · ${crime.status === 'responding' ? '警力响应中' : '待处置'}`), commandButton('协助处置', 'resolveCrime', crime.id, undefined, !this.canAct() || !this.hasRole('police', 'soldier') || spatialDistance(state.player.position, crime.position) > 40)); return item;
    }) : [element('p', 'note', '目前没有未结案件。')]));
    const phases: Record<string, string> = { time: '时间', environment: '环境', energy: '能源', traffic: '交通', people: '人物', commerce: '商业', finance: '金融', security: '治安', politics: '政治', feedback: '反馈' };
    this.setText('system-order', state.lastSystemOrder.map(phase => phases[phase] ?? phase).join(' → '));
    this.renderPublicSystems();
  }
  private renderIndustry(): void {
    if (!this.state || !this.view) return;
    const state = this.state;
    const extension = state.extension;
    if (!extension) {
      this.ref('company-summary').replaceChildren(element('p', 'note', '产业与科研记录尚未初始化。'));
      this.ref<HTMLButtonElement>('found-company').disabled = true;
      for (const name of ['company-list', 'company-detail', 'company-market', 'stock-list', 'research-list']) this.ref(name).replaceChildren();
      return;
    }
    const owned = extension.companies.filter(company => this.controlled(company));
    this.ref('company-summary').replaceChildren(field('全城企业', `${extension.companies.length} 家`), field('持有企业', `${owned.length} 家`), field('研发成果', `${extension.stats.researchCompleted} 项`));
    const capital = Number(this.ref<HTMLSelectElement>('company-capital').value);
    const building = this.view.nearbyBuilding;
    const canFound = !!building && !building.facility && state.shops.some(shop => shop.buildingId === building.id) && ['market', 'workshop', 'farm', 'dock'].includes(building.kind) && this.atBuilding(building.id) && this.hasRole('merchant') && state.player.money >= capital + 50 && !extension.companies.some(c => c.buildingId === building.id);
    this.ref<HTMLButtonElement>('found-company').disabled = !canFound;
    this.setText('found-note', `需商人资格，在市集、工坊、农场或码头创办；资本 ${money(capital)} 加登记费 50 云币，现金进入公司账户。`);
    if (!this.selectedCompany && owned.length) this.selectedCompany = owned[0].id;
    this.ref('company-list').replaceChildren(...(owned.length ? owned.map(company => {
      const button = element('button', `company-button${company.id === this.selectedCompany ? ' selected' : ''}`);
      button.type = 'button'; button.dataset.company = company.id;
      button.append(element('strong', '', company.name), element('span', 'muted', `${company.employees} 位雇员 · ${company.listed ? '已上市' : '非上市'}`));
      return button;
    }) : [element('p', 'note', '尚未创办公司。成为商人，在产业场所开始事业。')]));
    const company = extension.companies.find(c => c.id === this.selectedCompany);
    if (company) {
      const detail = element('div', 'company-detail');
      detail.append(element('h4', '', company.name), field('规模 / 资本', `${company.level} 级 · ${money(company.capital)}`), field('营收 / 利润', `${money(company.revenue)} / ${money(company.profit)}`), field('库存 / 雇员', `${rounded(company.inventory)} / ${company.employees}`), field('市占率', `${(company.marketShare * 100).toFixed(1)}%`), field('每股价格', `${company.sharePrice.toFixed(2)} 云币`));
      const controlled = this.controlled(company) && this.hasRole('merchant');
      const onSite = this.atBuilding(company.buildingId);
      const controls = element('div', 'button-grid context-actions');
      controls.append(commandButton('扩张 · 投入 300', 'expandCompany', company.id, 300, !controlled || !onSite || state.player.money < 300), commandButton('雇佣 · 1 位员工', 'hire', company.id, 1, !controlled || !onSite || company.capital < 50), commandButton('申请上市 · 200', 'listCompany', company.id, undefined, !controlled || !this.atKind('bank') || company.listed || company.level < 2 || company.capital < 600 || state.player.money < 200));
      const workplace = this.world.buildings.find(b => b.id === company.buildingId);
      const locate = element('button', 'text-button full-width', `前往 ${workplace?.name ?? '企业所在地'} ↗`); locate.type = 'button'; locate.dataset.destination = company.districtId;
      detail.append(controls, locate, element('p', 'note', '扩张与雇佣需在企业现场办理；雇佣费用 50 云币由公司支付。上市需前往钱庄。'));
      this.ref('company-detail').replaceChildren(detail);
    } else this.ref('company-detail').replaceChildren();
    this.ref('company-market').replaceChildren(...extension.companies.filter(c => !this.controlled(c)).map(company => {
      const row = element('div', 'stock-row');
      const cost = (company.shares - (company.shareholders.player ?? 0)) * company.sharePrice * 1.2;
      row.append(field(company.name, `${company.level} 级 · ${company.employees} 人`), field('参考收购价', money(cost)));
      const controls = element('div', 'button-grid context-actions');
      const locate = element('button', 'action-button', '导航至企业'); locate.type = 'button'; locate.dataset.destination = company.districtId;
      controls.append(locate, commandButton('洽谈并购', 'acquireCompany', company.id, undefined, !this.hasRole('merchant') || !owned.length || !this.atBuilding(company.buildingId) || state.player.money < cost));
      row.append(controls); return row;
    }));
    const listed = extension.companies.filter(c => c.listed);
    this.ref('stock-list').replaceChildren(...(listed.length ? listed.map(company => {
      const row = element('div', 'stock-row');
      row.append(field(company.name, `${company.sharePrice.toFixed(2)} 云币`), field('旅人持股', `${rounded(company.shareholders.player ?? 0)} 股`));
      const controls = element('div', 'button-grid context-actions');
      controls.append(commandButton('买入 10 股', 'buyShares', company.id, 10, !this.atKind('bank') || state.player.money < company.sharePrice * 10 || (company.shareholders.exchange ?? 0) < 10), commandButton('卖出 10 股', 'sellShares', company.id, 10, !this.atKind('bank') || (company.shareholders.player ?? 0) < 10 || company.capital < company.sharePrice * 10));
      row.append(controls); return row;
    }) : [element('p', 'note', '目前没有上市企业。')]));
    const names = { traffic: '交通科技', energy: '能源科技', information: '信息科技', security: '安防科技', medicine: '医疗科技', agriculture: '农业科技', manufacturing: '制造科技' };
    const budget = Number(this.ref<HTMLSelectElement>('research-budget').value);
    this.ref('research-list').replaceChildren(...extension.technologies.map(technology => {
      const row = element('div', 'research-row');
      row.append(field(names[technology.sector], `等级 ${technology.level}`), field('研究进度', `${Math.round(technology.progress)}%`), field('投入资金', money(technology.funding)));
      if (technology.sideEffect > 0) row.append(element('p', 'note', `技术副作用 ${Math.round(technology.sideEffect)}`));
      const researchPlace = this.atKind('school', 'core') || this.atFacility('data') || technology.sector === 'energy' && this.atFacility('energy');
      row.append(commandButton(`研究 · ${budget} 云币`, 'research', technology.sector, budget, !this.hasRole('scientist') || state.player.education < 3 || !researchPlace || state.player.money < budget || technology.funding > 0 || technology.level >= 20));
      return row;
    }));
  }
  private renderPublicSystems(): void {
    const extension = this.state!.extension;
    if (!extension) {
      this.ref('public-services').replaceChildren(element('p', 'note', '公共服务记录尚未初始化。'));
      for (const name of ['audit-actions', 'audit-list', 'public-ledger']) this.ref(name).replaceChildren();
      return;
    }
    const environment = extension.environment;
    const institutions = extension.institutions;
    this.ref('public-services').replaceChildren(...[['水质', `${Math.round(environment.waterQuality)}%`], ['生态多样性', `${Math.round(environment.biodiversity)}%`], ['风暴风险', `${Math.round(environment.stormRisk)}%`], ['教育 / 医疗', `${Math.round(institutions.education)} / ${Math.round(institutions.medical)}`], ['福利 / 文化', `${Math.round(institutions.welfare)} / ${Math.round(institutions.culture)}`]].map(([label, value]) => field(label, value)), element('p', 'note', environment.lastDisaster ? `最近灾害：${environment.lastDisaster}` : '最近暂无灾害记录。'));
    const statuses = { suspected: '待核查', reported: '已举报', investigating: '调查中', prosecuted: '已起诉', cleared: '已澄清' };
    const onSite = this.atKind('hall', 'core', 'police') || this.atFacility('data', 'archives', 'treasury', 'administration');
    const actions = element('div');
    actions.append(commandButton('核查公共账目 · 40 云币', 'audit', undefined, undefined, !onSite || !this.hasRole('mayor', 'council', 'official', 'police') || this.state!.player.money < 40), element('p', 'note', '公务身份可在官署、天枢阁或巡检司核查账目。证据达到 35 后，市民可举报；执法与治理身份可启动调查。'));
    this.ref('audit-actions').replaceChildren(actions);
    this.ref('audit-list').replaceChildren(...(extension.audits.length ? extension.audits.slice(-6).reverse().map(audit => {
      const npc = this.state!.citizens.find(c => c.id === audit.npcId);
      const row = element('div', 'audit-row');
      row.append(field(npc?.name ?? audit.npcId, statuses[audit.status]), field('证据 / 涉及资金', `${Math.round(audit.evidence)} / ${money(audit.diverted)}`));
      const controls = element('div', 'button-grid context-actions');
      if (audit.status === 'suspected') controls.append(commandButton('提交举报', 'reportCorruption', audit.id, undefined, !onSite || audit.evidence < 35));
      if (audit.status === 'reported') controls.append(commandButton('启动调查', 'investigate', audit.id, undefined, !onSite || !this.hasRole('police', 'council', 'mayor') || audit.evidence < 35));
      if (controls.childElementCount) row.append(controls); return row;
    }) : [element('p', 'note', '目前没有审计案件。')]));
    const recentEntries = extension.publicLedger.slice(-6).reverse();
    const olderEvidence = extension.publicLedger.filter(entry => entry.purpose === '公共采购异常挪用' && !recentEntries.includes(entry)).slice(-6).reverse();
    this.ref('public-ledger').replaceChildren(...[...recentEntries, ...olderEvidence].map(entry => {
      const row = element('li');
      row.append(element('span', 'event-tick', `#${entry.tick}`), element('p', '', entry.purpose), element('span', `ledger-amount${entry.amount < 0 ? ' negative' : ''}`, `${entry.amount > 0 ? '+' : ''}${rounded(entry.amount)}`));
      if (entry.purpose === '公共采购异常挪用' && this.state!.citizens.some(c => c.id === entry.actorId)) {
        const caseRecord = extension.audits.find(audit => audit.npcId === entry.actorId && audit.status !== 'cleared');
        row.append(commandButton(caseRecord && caseRecord.status !== 'suspected' ? '已进入程序' : '据账本举报', 'reportCorruption', entry.actorId, undefined, !onSite || !!caseRecord && caseRecord.status !== 'suspected'));
      }
      return row;
    }));
  }
  private renderLifeSystems(): void {
    const extension = this.state!.extension;
    const profile = extension?.actorProfiles.player;
    if (!profile) this.ref('life-profile').replaceChildren(element('p', 'note', '生活记录尚未初始化。'));
    else this.ref('life-profile').replaceChildren(field('年龄 / 健康', `${profile.age.toFixed(1)} 岁 / ${Math.round(profile.health)}`), field('心情 / 压力', `${Math.round(profile.mood)} / ${Math.round(profile.stress)}`), field('生活技能', String(Math.round(profile.skill))), element('p', 'note', profile.historyTags.join(' · ')));
    const cooking = extension?.cooking;
    this.ref('cooking-status').replaceChildren(cooking ? field('正在烹饪', `${recipes[cooking.recipeId]?.name ?? cooking.recipeId} · 剩余 ${Math.max(0, Math.ceil(cooking.finishAt - (extension?.lastUpdate ?? 0)))} 分钟`) : element('p', 'note', '厨房暂无料理制作。'));
    this.ref('health-actions').replaceChildren(commandButton('医馆治疗 · 30 云币', 'heal', 'player', undefined, !extension || !this.atKind('clinic') || this.state!.player.money < 30 || (profile?.health ?? 100) >= 100));
    const building = this.view?.nearbyBuilding;
    const shop = this.state!.shops.find(s => s.buildingId === building?.id);
    const canBuy = this.atKind('market', 'farm', 'dock') && !!shop?.open;
    const ingredients = element('div', 'button-grid context-actions');
    for (const [id, price] of [['grain', 8], ['vegetable', 6], ['fish', 14]] as const) ingredients.append(commandButton(`${ingredientNames[id]} · ${price} 云币`, 'buyIngredient', id, 1, !extension || !canBuy || this.state!.player.money < price || (shop?.inventory ?? 0) < 1));
    this.ref('ingredient-actions').replaceChildren(ingredients);
    const recipeId = this.ref<HTMLSelectElement>('recipe').value;
    const recipe = recipes[recipeId];
    const inventory = this.state!.player.inventory;
    this.setText('recipe-note', Object.entries(recipe.ingredients).map(([id, count]) => `${ingredientNames[id]} ${count}（持有 ${inventory[`ingredient:${id}`] ?? 0}）`).join(' · '));
    const ingredientReady = Object.entries(recipe.ingredients).every(([id, count]) => (inventory[`ingredient:${id}`] ?? 0) >= count);
    const inHome = !!this.state!.player.homeId && this.atBuilding(this.state!.player.homeId);
    this.ref<HTMLButtonElement>('cook-button').disabled = !extension || !!cooking || !ingredientReady || !(inHome || this.atKind('clinic', 'market'));
    const meals = Object.entries(recipes).filter(([id]) => (inventory[`dish:${id}`] ?? 0) > 0);
    this.ref('cooking-actions').replaceChildren(...meals.map(([id, recipe]) => commandButton(`享用${recipe.name} · ${inventory[`dish:${id}`]} 份`, 'eat', id, undefined, !this.canAct())));
  }
  private renderTransit(): void {
    const state = this.state!;
    const view = this.view!;
    const modes = new Set(this.world.edges.map(edge => edge.mode));
    this.ref('transit-summary').replaceChildren(field('交通网络', `${this.world.nodes.length} 节点 · ${this.world.edges.length} 连接`), field('运行载具', `${state.vehicles.length} 辆 / 艘`), element('p', 'note', [...modes].map(mode => modeNames[mode]).join(' · ')));
    this.ref('destination-list').replaceChildren(...this.world.districts.map(d => {
      const button = element('button', `destination-button${view.targetDistrict === d.id ? ' selected' : ''}`);
      button.type = 'button'; button.dataset.destination = d.id; button.setAttribute('aria-label', `导航至${d.name}`);
      const text = element('div'); text.append(element('strong', '', d.name), element('span', '', districtKind(d.kind)));
      const meters = distance(view.position, d.center);
      button.append(text, element('span', 'destination-distance', meters < d.radius ? '此处' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km ↗` : `${rounded(meters)} m ↗`)); return button;
    }));
    const departures = state.vehicles.filter(v => v.kind !== 'road' && v.kind !== 'bridge').sort((a, b) => a.nextDeparture - b.nextDeparture).slice(0, 7);
    this.ref('departures').replaceChildren(...departures.map(vehicle => {
      const edge = this.world.edges.find(e => e.id === vehicle.edgeId);
      const node = this.world.nodes.find(n => n.id === edge?.to);
      const row = element('div', 'departure-row');
      row.append(element('strong', '', modeNames[vehicle.kind]), element('span', '', `${node?.name ?? '城际'} · ${activity(vehicle.state)}`), element('small', '', `${vehicle.passengers} 人`)); return row;
    }));
    const vehicle = state.vehicles.find(v => v.id === state.player.vehicleId);
    if (vehicle) this.ref('current-vehicle').replaceChildren(field(modeNames[vehicle.kind], `${vehicle.passengers} 人 · ${activity(vehicle.state)}`), commandButton('下车 / 下船', 'leaveVehicle', vehicle.id));
    else this.ref('current-vehicle').replaceChildren(element('p', 'note', '尚未乘坐。接近站点或载具，步行视角可购票上车。'));
    const canSignal = view.mode === 'walk' && this.hasRole('police', 'mayor');
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-action="signal"]')) button.disabled = !canSignal;
  }
  private renderRelationships(): void {
    if (!this.state) return;
    const state = this.state;
    const partner = state.citizens.find(c => c.id === state.player.partnerId);
    this.ref('partner').replaceChildren(field('伴侣', partner?.name ?? '独自远游'));
    const relations = [...state.relationships].sort((a, b) => b.encounters - a.encounters);
    if (!this.selectedCitizen && relations.length) this.selectedCitizen = relations[0].npcId;
    this.ref('relationship-list').replaceChildren(...(relations.length ? relations.map(rel => {
      const citizen = state.citizens.find(c => c.id === rel.npcId);
      const button = element('button', `relationship-button${rel.npcId === this.selectedCitizen ? ' selected' : ''}`);
      button.type = 'button'; button.dataset.citizen = rel.npcId;
      const title = element('div'); title.append(element('strong', '', citizen?.name ?? rel.npcId), element('span', '', relationshipTitle(rel)));
      button.append(title, element('small', '', `好感 ${Math.round(rel.affection)} · 信任 ${Math.round(rel.trust)}`)); return button;
    }) : [element('p', 'empty-state', '城中尚无故人。走近一位居民，开启第一次交谈。')]));
    const rel = relations.find(r => r.npcId === this.selectedCitizen);
    const detail = this.ref('relationship-detail');
    this.renderOrganizations();
    if (!rel) { detail.replaceChildren(); return; }
    const citizen = state.citizens.find(c => c.id === rel.npcId);
    const section = element('div', 'panel-section');
    section.append(element('h3', '', `${citizen?.name ?? '故人'} · 共同记忆`));
    section.append(field('相处阶段', romanceNames[romanceStage(rel)]), field('敌对阶段', hostilityNames[hostilityStage(rel)]), field('共同经历 / 和解', `${rel.encounters} / ${rel.reconciliations ?? 0}`), element('p', 'note', this.romanceNote(rel)));
    if (rel.consent !== undefined) section.append(field('双方意愿', rel.consent ? '已确认同意' : '尚未同意'));
    if (citizen) section.append(this.citizenDetails(citizen));
    if (rel.tags.length) section.append(element('p', 'relationship-tags', rel.tags.join(' · ')));
    const memories = element('ol', 'event-list memory-list');
    for (const memory of rel.memories.slice(-8).reverse()) {
      const item = element('li'); item.append(element('span', 'event-tick', `#${memory.tick}`), element('p', '', memory.text), element('span', `memory-impact${memory.impact < 0 ? ' negative' : ''}`, `${memory.impact > 0 ? '+' : ''}${memory.impact}`)); memories.append(item);
    }
    if (!rel.memories.length) section.append(element('p', 'note', '尚无详细记忆。'));
    section.append(memories); detail.replaceChildren(section);
  }
  private renderOrganizations(): void {
    const extension = this.state!.extension;
    if (!extension) { this.ref('organization-list').replaceChildren(element('p', 'note', '社区记录尚未初始化。')); this.ref('culture-actions').replaceChildren(); return; }
    this.ref('organization-list').replaceChildren(...extension.organizations.map(organization => {
      const row = element('div', 'organization-row');
      row.append(field(organization.name, organization.members.includes('player') ? '已加入' : `${organization.members.length} 位成员`), field('声望 / 社群资金', `${Math.round(organization.reputation)} / ${money(organization.funds)}`));
      const controls = element('div', 'button-grid context-actions');
      controls.append(commandButton('加入 · 20 云币', 'joinOrganization', organization.id, undefined, organization.members.includes('player') || !this.atKind('school', 'pavilion', 'hall') || this.state!.player.money < 20), commandButton('捐助 · 50 云币', 'donate', organization.id, 50, !this.atKind('school', 'clinic', 'hall', 'core') || this.state!.player.money < 50), commandButton('参加节庆 · 20', 'attendFestival', organization.id, undefined, !this.atKind('market', 'pavilion', 'hall') || this.state!.player.money < 20));
      row.append(controls); return row;
    }));
    this.ref('culture-actions').replaceChildren(element('p', 'note', '书院、亭子或官署可入会；节庆在市集、亭子与官署举行。社区捐助支持公共福利与居民健康。'));
  }
  private renderSettings(): void {
    const view = this.view!;
    this.setInput('quality', view.quality);
    this.setInput('distance', String(view.renderDistance));
    this.setText('distance-label', `${rounded(view.renderDistance)} m`);
    this.setInput('fps-cap', String(view.fpsCap));
    this.ref<HTMLInputElement>('dynamic').checked = view.dynamicResolution;
    this.setInput('simulation-detail', String(view.simulationDetail));
    this.setText('simulation-label', `${Math.round(view.simulationDetail * 100)}%`);
    this.ref('performance').replaceChildren(field('当前帧率', `${rounded(view.fps)} FPS`), field('绘制调用', rounded(view.drawCalls)), field('三角形', rounded(view.triangles)));
  }
  private citizenDetails(citizen: Citizen): HTMLElement {
    const details = element('div', 'citizen-details');
    const home = this.world.buildings.find(b => b.id === citizen.homeId);
    const work = this.world.buildings.find(b => b.id === citizen.workId);
    const role = roleNames[citizen.role as Role] ?? citizen.role;
    details.append(field('身份 / 状态', `${role} · ${activity(citizen.state)}`), field('住处', home?.name ?? '无固定住所'), field('工作地', work?.name ?? '暂无岗位'), field('随身资产', money(citizen.money)));
    if (citizen.education !== undefined) details.append(field('教育程度', String(citizen.education)));
    const socialLabels: Record<string, string> = { familyMember: '家庭成员', guildMember: '百工会成员', communityMember: '社区成员' };
    const skillLabels: Record<string, string> = { craft: '工艺', learning: '学习', social: '社交' };
    if (citizen.socialIdentities?.length) details.append(element('p', 'note', citizen.socialIdentities.map(identity => socialLabels[identity] ?? identity).join(' · ')));
    if (citizen.skills) details.append(element('p', 'note', Object.entries(citizen.skills).map(([key, value]) => `${skillLabels[key] ?? key} ${Math.round(value)}`).join(' · ')));
    const profile = this.state?.extension?.actorProfiles[citizen.id];
    if (profile) details.append(field('年龄 / 健康', `${profile.age.toFixed(1)} 岁 / ${Math.round(profile.health)}`), field('心情 / 压力', `${Math.round(profile.mood)} / ${Math.round(profile.stress)}`));
    const needs = element('div', 'need-grid compact'); this.renderNeeds(needs, citizen.needs); details.append(needs); return details;
  }
  private refreshContext(): void {
    if (!this.state || !this.view) return;
    const view = this.view;
    const state = this.state;
    const available: ContextKind[] = [];
    if (view.nearbyBuilding) available.push('building');
    if (view.nearbyCitizen) available.push('citizen');
    if (view.nearbyVehicle || state.player.vehicleId) available.push('vehicle');
    this.ref('context').hidden = available.length === 0;
    this.root.classList.toggle('has-context', available.length > 0);
    if (!available.length) { this.contextSignature = ''; return; }
    if (!available.includes(this.contextKind)) this.contextKind = available[0];
    const building = view.nearbyBuilding;
    const citizen = view.nearbyCitizen;
    const vehicle = state.vehicles.find(v => v.id === state.player.vehicleId) ?? view.nearbyVehicle;
    const shop = state.shops.find(s => s.buildingId === building?.id);
    const rel = state.relationships.find(r => r.npcId === citizen?.id);
    const floor = building && view.inside ? Math.floor((state.player.position.y - building.position.y) / (building.height / building.floors)) : 0;
    const signature = [this.contextKind, building?.id, citizen?.id, vehicle?.id, state.player.role, view.mode, view.inside, shop?.open, Math.round(shop?.price ?? 0), Math.round(shop?.inventory ?? 0), rel?.type, Math.round(rel?.affection ?? 0), Math.round(state.player.money), !!state.player.vehicleId, (state.player.identities ?? []).join(','), state.player.homeId, vehicle?.state, vehicle?.passengers, vehicle?.cargo, vehicle?.speed, Math.round(state.bankBalance), Math.round(state.loan), rel?.trust, state.player.partnerId, citizen?.partnerId, state.voxels.length, state.player.inventory.food, state.crimes.filter(c => c.status !== 'resolved' && spatialDistance(c.position, state.player.position) <= 40).map(c => c.id).join(','), floor, citizen?.state, citizen?.education, Math.round(state.player.position.x), Math.round(state.player.position.z), Math.round(state.treasury), building?.name, citizen?.name, citizen?.role, rel?.romanceStage, rel?.hostilityStage, rel?.romanceSince, rel?.hostilitySince, rel?.encounters, rel?.reconciliations, rel?.consent, this.contextKind === 'citizen' ? Math.floor(this.socialClock()) : '', state.extension?.companies.find(c => c.buildingId === building?.id)?.shareholders.player].join('|');
    if (signature === this.contextSignature) return;
    const focused = document.activeElement;
    if ((focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement) && this.ref('context').contains(focused) && signature.split('|').slice(0, 6).join('|') === this.contextSignature.split('|').slice(0, 6).join('|')) return;
    const focusData = focused instanceof HTMLButtonElement && this.ref('context').contains(focused) ? { ...focused.dataset } : null;
    const previousDetails = [...this.ref('context').querySelectorAll('details')].map(detail => detail.open);
    const summaryIndex = [...this.ref('context').querySelectorAll('summary')].indexOf(focused as HTMLElement);
    this.contextSignature = signature;
    this.ref('context-tabs').replaceChildren(...available.map(kind => {
      const button = element('button', kind === this.contextKind ? 'selected' : '', kind === 'building' ? '场所' : kind === 'citizen' ? '居民' : '载具');
      button.type = 'button'; button.dataset.context = kind; button.setAttribute('aria-pressed', String(kind === this.contextKind)); return button;
    }));
    const body = this.ref('context-body'); body.replaceChildren();
    const walk = this.canAct();
    if (this.contextKind === 'building' && building) {
      body.append(element('span', 'eyebrow', `${kindNames[building.kind]} · ${view.inside ? '已进入' : '附近场所'}`), element('h3', '', building.name));
      const currentFloor = floor >= 0 ? `${floor + 1} 层` : `地下 ${Math.abs(floor)} 层`;
      const floorUse = floor >= 0 ? building.floorUses?.[floor] : building.basementUses?.[Math.abs(floor) - 1];
      const stats = element('p', 'context-subtitle', view.inside ? `${currentFloor}${floorUse ? ` · ${floorUse}` : ''}` : `${building.floors} 层 · ${building.capacity} 人容量${shop ? ` · ${shop.open ? '营业中' : '已打烊'}` : ''}`); body.append(stats);
      const enter = element('button', 'action-button primary full-width', view.inside ? '离开建筑 / 使用楼梯 · E' : '进入 / 使用建筑 · E'); enter.type = 'button'; enter.dataset.action = 'interact'; enter.disabled = !walk; body.append(enter);
      const controls = element('div', 'button-grid context-actions');
      this.buildingActions(controls, building, !walk);
      if (controls.childElementCount) body.append(controls);
      if (shop) body.append(element('p', 'note', `食物 ${money(shop.price)} · 库存 ${Math.round(shop.inventory)} · 客流 ${shop.customers}`));
      if (building.kind === 'bank') this.renderBank(body, building, !walk);
      if (building.kind === 'school') body.append(element('p', 'note', '先学习，再选择职业考核。学习提高教育，工作积累经验。'));
      if (building.publicFloors !== undefined) body.append(element('p', 'note', '公共服务楼层可自由进入；其余空间按各楼层权限开放，持有多个身份可使用对应设施。'));
      if (building.floorUses?.length) {
        const guide = element('details', 'relationship-choices'); guide.append(element('summary', '', '楼层与空间导览'));
        for (let index = 0; index < building.floorUses.length; index++) {
          const permission = building.floorPermissions?.[index];
          guide.append(field(`${index + 1} 层 · ${building.floorUses[index]}`, permission === 'public' || !permission ? '公共' : roleNames[permission] ?? '受限空间'));
        }
        building.basementUses?.forEach((use, index) => guide.append(field(`地下 ${index + 1} 层`, use)));
        body.append(guide);
      }
      if (!walk) body.append(element('p', 'context-hint', '切换步行并接近入口，参与这里的生活。'));
      else if (!view.inside) body.append(element('p', 'context-hint', '走近门口按 E 进入，楼梯处按 E 换层。'));
    } else if (this.contextKind === 'citizen' && citizen) {
      body.append(element('span', 'eyebrow', `${roleNames[citizen.role as Role] ?? citizen.role} · ${activity(citizen.state)}`), element('h3', '', citizen.name), element('p', 'context-subtitle', rel ? `${relationshipTitle(rel)} · 好感 ${Math.round(rel.affection)} · 信任 ${Math.round(rel.trust)}` : '初次相逢 · 尚未认识'));
      const controls = element('div', 'button-grid context-actions');
      const severeHostility = !!rel && hostilityRank[hostilityStage(rel)] >= 2;
      controls.append(commandButton('聊聊近况', 'socialize', citizen.id, undefined, !walk || severeHostility), commandButton('送食物作礼物', 'gift', citizen.id, undefined, !walk || severeHostility || (state.player.inventory.food ?? 0) < 1));
      body.append(controls);
      if (severeHostility) body.append(element('p', 'context-hint', '旧怨尚未平复，对方拒绝闲谈与礼物；可展开更多相处方式，尝试诚意调解。'));
      const more = element('details', 'relationship-choices'); const summary = element('summary', '', '更多相处方式'); more.append(summary);
      const personal = element('div', 'button-grid context-actions');
      const single = (!citizen.partnerId || citizen.partnerId === 'player') && (!state.player.partnerId || state.player.partnerId === citizen.id);
      const stage = rel ? romanceStage(rel) : 'single';
      const courting = ['single', 'crush', 'pursuit'].includes(stage);
      const age = rel ? this.romanceAge(rel) : 0;
      const courtReady = !!rel && courting && rel.affection >= 55 && rel.trust >= 35 && rel.encounters >= (stage === 'pursuit' ? 6 : 4) && (stage !== 'pursuit' || age >= 60) && single;
      if (courting) personal.append(commandButton(stage === 'pursuit' ? '确认交往' : '表达心意', 'court', citizen.id, undefined, !walk || !courtReady));
      const reconcileCost = 15 + (rel ? hostilityRank[hostilityStage(rel)] : 0) * 10;
      personal.append(commandButton(`诚意调解 · ${reconcileCost}`, 'reconcile', citizen.id, undefined, !walk || !rel || hostilityStage(rel) === 'none' || state.player.money < reconcileCost), commandButton('提出异议', 'conflict', citizen.id, undefined, !walk));
      if (rel && ['dating', 'engaged'].includes(stage)) personal.append(commandButton(stage === 'engaged' ? '办理婚姻' : '诚意求婚', 'propose', citizen.id, undefined, !walk || rel.affection < 80 || rel.trust < 60 || rel.encounters < 8 || !state.player.homeId || !single || age < 120));
      if (rel?.type === 'spouse' && state.player.partnerId === citizen.id) personal.append(commandButton('结束婚姻', 'divorce', citizen.id, undefined, !walk));
      more.append(personal, element('p', 'note', rel ? this.romanceNote(rel) : '表达心意需好感 55、信任 35、共同经历 4 次，并双方单身。'));
      if (rel && hostilityStage(rel) !== 'none') {
        const rank = hostilityRank[hostilityStage(rel)];
        const remaining = Math.max(0, Math.ceil(120 - (this.socialClock() - (rel.hostilitySince ?? this.socialClock()))));
        more.append(element('p', 'note', `调解需 ${reconcileCost} 云币，间隔 60 分钟；${rank >= 3 && remaining ? `重大争执后还需 ${remaining} 分钟平复。` : '关系修复随信任与后续相处逐步发生。'}${rank >= 4 ? '重度敌对需至少两次调解，24 小时没有新冲突且好感、信任恢复，才会逐步缓和。' : ''}`));
      }
      body.append(more);
      if (this.atKind('clinic')) body.append(commandButton('协助就医 · 30 云币', 'heal', citizen.id, undefined, !walk || state.player.money < 30));
      if (this.hasRole('mayor') && this.atKind('hall', 'core')) {
        const publicActions = element('details', 'relationship-choices'); publicActions.append(element('summary', '', '公务任命 · 公共金库支出 100'));
        const options = element('div', 'button-grid context-actions');
        options.append(commandButton('任命公务员', 'appoint', citizen.id, 0, !walk || (citizen.education ?? 0) < 2 || state.treasury < 100), commandButton('任命议员', 'appoint', citizen.id, 1, !walk || (citizen.education ?? 0) < 2 || state.treasury < 100), commandButton('任命科研人员', 'appoint', citizen.id, 2, !walk || (citizen.education ?? 0) < 3 || state.treasury < 100));
        publicActions.append(options, element('p', 'note', `居民教育 ${citizen.education ?? 0}；公务员与议员需 2，科研人员需 3。`)); body.append(publicActions);
      }
      const inspect = element('button', 'text-button full-width', '查看身份、住处与共同记忆 ↗'); inspect.type = 'button'; inspect.dataset.action = 'relations'; body.append(inspect);
      if (!walk) body.append(element('p', 'context-hint', '步行走近居民后，可以交谈与互动。'));
    } else if (vehicle) {
      body.append(element('span', 'eyebrow', `${modeNames[vehicle.kind]} · ${activity(vehicle.state)}`), element('h3', '', state.player.vehicleId ? '同行于山城' : `附近${modeNames[vehicle.kind]}载具`), element('p', 'context-subtitle', `${vehicle.passengers} 位乘客 · 货物 ${Math.round(vehicle.cargo)} · ${Math.round(vehicle.speed)} m/s`));
      const controls = element('div', 'button-grid context-actions');
      if (state.player.vehicleId) controls.append(commandButton('下车 / 离开载具', 'leaveVehicle', vehicle.id));
      else {
        controls.append(commandButton('购票乘坐', 'ride', vehicle.id, undefined, !walk || vehicle.state === 'moving'));
        if (vehicle.kind === 'road' || vehicle.kind === 'flight' && this.hasRole('driver')) controls.append(commandButton(vehicle.kind === 'flight' ? '驾驶航班' : '驾驶载具', 'drive', vehicle.id, undefined, !walk || vehicle.state === 'moving' || !this.hasRole('driver', 'police', 'soldier')));
      }
      body.append(controls, element('p', 'note', state.player.vehicleId && state.player.inventory.driving === 1 ? 'W / S 油门与减速 · A / D 路口转向 · 空格刹车。抵达停靠点后可下车。' : state.player.vehicleId ? '玩家随真实载具前行；抵达站点并停稳后，可下车继续游览。' : '候车停稳后可登乘；驾驶资格允许道路驾驶，驾驶员也可执飞航班。'));
    }
    [...this.ref('context').querySelectorAll('details')].forEach((detail, index) => { detail.open = previousDetails[index] ?? false; });
    if (focusData && focused && !focused.isConnected) {
      const replacement = [...this.ref('context').querySelectorAll<HTMLButtonElement>('button')].find(button => Object.entries(focusData).every(([key, value]) => button.dataset[key] === value));
      replacement?.focus({ preventScroll: true });
    }
    if (summaryIndex >= 0 && focused && !focused.isConnected) this.ref('context').querySelectorAll('summary')[summaryIndex]?.focus({ preventScroll: true });
  }
  private buildingActions(controls: HTMLElement, building: Building, disabled: boolean): void {
    const role = this.state!.player.role;
    const kind = building.kind;
    if (kind === 'home') controls.append(commandButton('租住 · 80 云币', 'rent', building.id, undefined, disabled), commandButton('休息', 'rest', building.id, undefined, disabled));
    if (kind === 'market') controls.append(commandButton('购买食物', 'purchase', building.id, undefined, disabled), commandButton('临工 / 经营', 'work', building.id, undefined, disabled));
    if (['workshop', 'farm', 'dock'].includes(kind)) controls.append(commandButton('开始工作', 'work', building.id, undefined, disabled));
    if (['market', 'workshop'].includes(kind) && !building.facility && this.state!.shops.some(shop => shop.buildingId === building.id) && this.hasRole('merchant')) controls.append(commandButton('承包商铺 · 300 云币', 'business', building.id, undefined, disabled));
    if (kind === 'school') controls.append(commandButton('学习 · 40 云币', 'exam', 'study', undefined, disabled), commandButton('教师考核 · 80 云币', 'exam', 'teacher', 3, disabled));
    if (kind === 'police') controls.append(commandButton('警察考核 · 80 云币', 'exam', 'police', 1, disabled), commandButton('卫士考核 · 80 云币', 'exam', 'soldier', 2, disabled));
    if (['station', 'airport'].includes(kind)) controls.append(commandButton('驾驶员考核 · 80 云币', 'exam', 'driver', 4, disabled));
    if (kind === 'market') controls.append(commandButton('商人考核 · 80 云币', 'exam', 'merchant', 5, disabled));
    if (['hall', 'core'].includes(kind)) controls.append(commandButton('参加竞选 · 120 云币', 'election', building.id, undefined, disabled));
    if (['hall', 'core'].includes(kind)) {
      const data = element('button', 'action-button', '查看城市运行'); data.type = 'button'; data.dataset.action = 'city'; controls.append(data);
    }
    if (['data', 'energy', 'administration', 'emergency', 'archives', 'treasury'].includes(building.facility ?? '') && !['hall', 'core'].includes(kind)) {
      const data = element('button', 'action-button', '城市运行与账目'); data.type = 'button'; data.dataset.action = 'city'; controls.append(data);
    }
    if (building.facility === 'data' || kind === 'school' || kind === 'core') {
      const research = element('button', 'action-button', '产业与科研'); research.type = 'button'; research.dataset.action = 'industry'; controls.append(research);
    }
    if (['school', 'station', 'airport', 'police', 'hall', 'core', 'starport'].includes(kind) && this.canWorkAt(kind)) controls.append(commandButton('履行职务', 'work', building.id, undefined, disabled));
    if (['pavilion', 'clinic', 'station'].includes(kind)) controls.append(commandButton('休息片刻', 'rest', building.id, undefined, disabled));
    if (kind === 'core' || building.facility === 'energy') controls.append(commandButton('维修水能 · 100 云币', 'energy', building.id, 20, disabled || !this.hasRole('mayor', 'driver', 'soldier', 'scientist', 'official')));
    if (kind === 'police' && this.hasRole('police', 'soldier')) {
      const crime = this.state!.crimes.filter(c => c.status !== 'resolved' && spatialDistance(c.position, this.state!.player.position) <= 40).sort((a, b) => spatialDistance(a.position, this.state!.player.position) - spatialDistance(b.position, this.state!.player.position))[0];
      controls.append(commandButton('处置附近案件', 'resolveCrime', crime?.id, undefined, disabled || !crime));
    }
    const company = this.state!.extension?.companies.find(c => c.buildingId === building.id);
    const controlsSpace = company ? this.controlled(company) : this.state!.player.inventory[`business:${building.id}`] === 1;
    if (this.state!.player.homeId === building.id || controlsSpace) {
      controls.append(commandButton('放置体素 · B', 'build', building.id, undefined, disabled));
      const position = this.state!.player.position;
      const voxel = this.state!.voxels.filter(v => spatialDistance(v.position, position) <= 4).sort((a, b) => spatialDistance(a.position, position) - spatialDistance(b.position, position))[0];
      const remove = commandButton('回收附近体素 · X', 'demolish', building.id, undefined, disabled || !voxel);
      if (voxel) { remove.dataset.x = String(voxel.position.x); remove.dataset.y = String(voxel.position.y); remove.dataset.z = String(voxel.position.z); }
      controls.append(remove);
    }
  }
  private renderBank(body: HTMLElement, building: Building, disabled: boolean): void {
    body.append(field('钱庄存款', money(this.state!.bankBalance)), field('借贷余额', money(this.state!.loan)));
    const label = element('label', 'field-label', '业务金额'); label.htmlFor = 'bank-amount';
    const amount = element('select'); amount.id = 'bank-amount'; amount.setAttribute('aria-label', '钱庄业务金额');
    for (const value of [100, 300, 1000]) { const option = element('option', '', money(value)); option.value = String(value); amount.append(option); }
    amount.value = String(this.bankAmount);
    const controls = element('div', 'button-grid context-actions');
    for (const [labelText, type] of [['存入', 'deposit'], ['取出', 'withdraw'], ['申请贷款', 'loan'], ['偿还借贷', 'repay'], ['投资', 'invest']] as const) {
      const button = element('button', 'action-button', labelText); button.type = 'button'; button.dataset.action = 'bank'; button.dataset.bank = type; button.dataset.target = building.id; button.disabled = disabled; controls.append(button);
    }
    body.append(label, amount, controls);
  }
  private drawMap(): void {
    if (!this.state || !this.view || this.ref('minimap').hidden) return;
    const ctx = this.mapCanvas.getContext('2d'); if (!ctx) return;
    const w = this.mapCanvas.width; const h = this.mapCanvas.height;
    const bounds = this.mapBounds;
    const scale = Math.min((w - 30) / bounds.width, (h - 24) / bounds.height);
    const offsetX = (w - bounds.width * scale) / 2; const offsetY = (h - bounds.height * scale) / 2;
    const project = (p: { x: number; z: number }) => ({ x: offsetX + (p.x - bounds.minX) * scale, y: offsetY + (p.z - bounds.minZ) * scale });
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (const mountain of this.world.mountains) {
      const p = project(mountain); ctx.beginPath(); ctx.ellipse(p.x, p.y, mountain.radius * scale * .7, mountain.radius * scale * .7, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(70, 93, 77, .10)'; ctx.fill();
    }
    const river = this.world.river.map(project);
    ctx.beginPath(); river.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(105, 155, 159, .55)'; ctx.stroke();
    for (const edge of this.world.edges) {
      ctx.beginPath(); edge.points.forEach((p, index) => { const xy = project(p); if (index) ctx.lineTo(xy.x, xy.y); else ctx.moveTo(xy.x, xy.y); });
      ctx.lineWidth = edge.mode === 'maglev' ? 2 : 1; ctx.strokeStyle = edge.mode === 'flight' ? 'rgba(139, 119, 91, .25)' : edge.mode === 'road' ? 'rgba(72, 91, 72, .25)' : 'rgba(93, 150, 139, .60)';
      ctx.setLineDash(edge.mode === 'flight' ? [3, 4] : []); ctx.stroke();
    }
    ctx.setLineDash([]); this.mapPoints = [];
    for (const district of this.world.districts) {
      const p = project(district.center); this.mapPoints.push({ id: district.id, ...p });
      const active = district.id === this.view.targetDistrict;
      ctx.beginPath(); ctx.arc(p.x, p.y, active ? 6 : 3.5, 0, Math.PI * 2); ctx.fillStyle = active ? '#b98642' : '#416e60'; ctx.fill();
      if (active) { ctx.strokeStyle = '#b98642'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke(); }
    }
    const player = project(this.state.player.position);
    ctx.beginPath(); ctx.arc(player.x, player.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#cf9148'; ctx.fill(); ctx.strokeStyle = '#fff9e9'; ctx.lineWidth = 2; ctx.stroke();
    const view = project(this.view.position); ctx.beginPath(); ctx.moveTo(view.x, view.y - 7); ctx.lineTo(view.x - 5, view.y + 4); ctx.lineTo(view.x + 5, view.y + 4); ctx.closePath(); ctx.fillStyle = '#faf8ee'; ctx.fill(); ctx.strokeStyle = '#355447'; ctx.lineWidth = 1.3; ctx.stroke();
    const district = this.nearestDistrict(this.view.position);
    const tier = this.state.districts.find(d => d.id === district.id)?.tier;
    this.setText('map-tier', tier === 'active' ? '近区活跃' : tier === 'regional' ? '区域模拟' : '远区统计');
  }
  notify(message: string, ok = true): void {
    const toast = this.ref('toast');
    toast.textContent = message; toast.hidden = false; toast.classList.toggle('toast-error', !ok);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { toast.hidden = true; }, ok ? 5000 : 7000);
    this.contextSignature = '';
    if (this.state && this.view && this.panelOpen) this.refreshPanel();
  }
  dispose(): void {
    this.abort.abort();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.root.remove();
  }
}
