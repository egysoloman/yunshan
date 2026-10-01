import { canAccessFloor, getFloorDimensions, getStairPosition } from './access';
import { installExtensions } from './simulation/extensions';
import type { Citizen, Command, CommandResult, Crime, NetworkEdge, Player, Relationship, Role, Shop, SimState, SimulationAPI, Vec3, Vehicle, ViewMode, WorldDefinition, Building } from './types';

const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'] as const;
const ROLES: Role[] = ['traveler', 'police', 'soldier', 'teacher', 'driver', 'merchant', 'mayor', 'scientist', 'official', 'council'];
const TICK_SECONDS = .25;
const ROMANCE_STAGES = ['single', 'crush', 'pursuit', 'dating', 'engaged', 'married', 'family'] as const;
const HOSTILITY_STAGES = ['none', 'discontent', 'rivalry', 'feud', 'enemy', 'mortalEnemy'] as const;
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const hash = (value: string) => { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return h >>> 0; };
type Event = { type: string; amount?: number; citizenId?: string; shopId?: string; districtId?: string; vehicleId?: string; crimeId?: string; minutes?: number };
class EventBus {
  private handlers = new Map<string, ((event: Event) => void)[]>();
  on(type: string, handler: (event: Event) => void) { const list = this.handlers.get(type) ?? []; list.push(handler); this.handlers.set(type, list); }
  emit(event: Event) { for (const handler of this.handlers.get(event.type) ?? []) handler(event); }
}
interface Runtime {
  rng: number; accumulator: number; weatherAt: number; crimeAt: number; payrollAt: number; commerceAt: number; financeAt: number; socialAt: number;
  eventId: number; crimeId: number; focus: Vec3; mode: ViewMode; detail: number; workAt: number; studyAt: number;
  wages: { citizenId: string; amount: number; districtId: string }[];
  taxes: number; freight: Record<string, number>; playerBusinesses: string[]; investment: number;
  campaign: { countAt: number; votes: number } | null;
  signalOverrides: Record<string, number>; constructionId: number; energyBoostUntil: number;
  operatingCost: number; restAt: number; relationshipAt: Record<string, number>; lastInvestmentAt: number;
  riders: Record<string, { vehicleId: string; stopNodeId: string; arrived?: boolean }>;
  links: { from: string; to: string; type: string; affection: number; trust: number }[];
  impressions: Record<string, { affection: number; trust: number }>; districtRelationMeans: Record<string, number>;
  decisionAt: Record<string, number>; activities: Record<string, string>;
  attendance: Record<string, number>;
  customers: Record<string, string>;
  driving: { vehicleId: string | null; throttle: number; turn: number; brake: boolean; speed: number };
  dispatches: Record<string, { crimeId: string; arrived: boolean }>;
  relationshipClock: number;
  hostileAt: Record<string, number>;
}
type VoxelState = SimState & { voxels: { id: string; position: Vec3; color: string }[] };

/** Deterministic fixed-tick city model. Rendering never drives schedules or transactions. */
export class Simulation implements SimulationAPI {
  state: VoxelState;
  private runtime: Runtime;
  private readonly bus = new EventBus();
  private readonly buildings: Map<string, Building>;
  private readonly edges: Map<string, NetworkEdge>;
  private readonly fingerprint: string;
  private readonly neighbors = new Map<string, { node: string; edge: NetworkEdge }[]>();
  private readonly routeCache = new Map<string, Vec3[]>();
  private readonly walkingTrees = new Map<string, { costs: Map<string, number>; previous: Map<string, { node: string; edge: NetworkEdge }> }>();
  private readonly nodeAt = new Map<string, string>();
  private readonly doorNodes = new Map<string, WorldDefinition['nodes'][number]>();
  private readonly saveValidators: ((candidateState: SimState) => void)[] = [];
  private readonly loadHooks: (() => void)[] = [];
  private readonly commandHandlers: ((command: Command) => CommandResult | null)[] = [];
  private minutes = .25;
  private employment = new Set<string>();
  private readonly workforce = new Map<string, Citizen[]>();
  constructor(private readonly world: WorldDefinition) {
    if (!world.districts.length || !world.buildings.length || !world.nodes.length) throw new Error('云山世界需要城区、建筑与连通节点。');
    this.buildings = new Map(world.buildings.map(b => [b.id, b]));
    this.edges = new Map(world.edges.map(e => [e.id, e]));
    for (const node of world.nodes) this.nodeAt.set(this.pointKey(node.position), node.id);
    for (const building of world.buildings) this.doorNodes.set(building.id, this.nearestNode(building.door));
    this.fingerprint = hash(JSON.stringify({ seed: world.seed, buildings: world.buildings.map(b => [b.id, b.districtId, b.kind, b.position, b.door, b.width, b.height, b.depth, b.floorFootprints]), nodes: world.nodes.map(n => [n.id, n.position]), edges: world.edges.map(e => [e.id, e.from, e.to, e.mode, e.length, e.points]) })).toString(16);
    for (const e of world.edges) { this.addNeighbor(e.from, e.to, e); this.addNeighbor(e.to, e.from, e); }
    this.runtime = { rng: (world.seed >>> 0) || 1, accumulator: 0, weatherAt: 9 * 60, crimeAt: 8 * 60 + 40, payrollAt: 17 * 60, commerceAt: 8 * 60, financeAt: 8 * 60, socialAt: 8 * 60, eventId: 0, crimeId: 0, focus: copy(world.spawn), mode: 'drone', detail: 1, workAt: -10000, studyAt: -10000, wages: [], taxes: 0, freight: {}, playerBusinesses: [], investment: 0, campaign: null, signalOverrides: {}, constructionId: 0, energyBoostUntil: 0, operatingCost: 0, restAt: -10000, relationshipAt: {}, lastInvestmentAt: -10000, riders: {}, links: [], impressions: {}, districtRelationMeans: {}, decisionAt: {}, activities: {}, attendance: {}, customers: {}, driving: { vehicleId: null, throttle: 0, turn: 0, brake: true, speed: 0 }, dispatches: {}, relationshipClock: 480, hostileAt: {} };
    this.state = { version: 1, seed: world.seed, tick: 0, day: 0, hour: 8, paused: false, speed: 1, weather: '晴', visibility: 1, energy: 98, treasury: 80000, taxRate: .08, policeBudget: .3, support: 58, bankBalance: 0, loan: 0, gdp: 0, lastSystemOrder: [], districts: world.districts.map(d => ({ id: d.id, energy: 98, safety: 84, employment: .94, prosperity: 68, pollution: 8, tier: 'statistical', residents: d.population, crimeCount: 0 })), citizens: [], vehicles: [], shops: [], player: { position: copy(world.spawn), role: 'traveler', identities: ['traveler'], money: 600, reputation: 0, needs: { hunger: 85, fatigue: 90, social: 70, fun: 70 }, inventory: { block: 32 }, homeId: null, education: 0, experience: 0, partnerId: null, vehicleId: null }, relationships: [], crimes: [], events: [], metrics: { trades: 0, commutes: 0, crimesResolved: 0, freight: 0, flights: 0 }, voxels: [] };
    this.initializeCitizens();
    this.runtime.customers = {};
    this.runtime.driving = { vehicleId: null, throttle: 0, turn: 0, brake: true, speed: 0 };
    this.runtime.dispatches = {};
    this.runtime.relationshipClock = 8 * 60;
    this.runtime.hostileAt = {};
    this.initializeSocialGraph();
    this.refreshWorkforce();
    // A civic laboratory can occupy a workshop-shaped building, but its public
    // payroll and research resources must not become a fictitious retail shop.
    for (const b of world.buildings.filter(b => !b.facility && ['market', 'workshop', 'farm', 'dock'].includes(b.kind))) this.state.shops.push({ id: `shop-${b.id}`, buildingId: b.id, districtId: b.districtId, inventory: b.kind === 'farm' ? 160 : 90, price: b.kind === 'market' ? 12 : 8, revenue: 0, profit: 0, customers: 0, open: true, employees: this.workforce.get(b.id)?.length ?? 0 });
    for (const e of world.edges) {
      if (e.mode === 'bridge' || e.mode === 'road' && e.length < 80) continue;
      const stationRoad = e.mode === 'road' && world.nodes.find(n => n.id === e.from)?.station && world.nodes.find(n => n.id === e.to)?.station;
      if (e.mode === 'road' && !stationRoad) { const destination = world.buildings.find(b => `${b.id}-door` === e.from || `${b.id}-door` === e.to); if (!destination || !['market', 'workshop', 'farm', 'dock'].includes(destination.kind)) continue; }
      const count = stationRoad ? 2 : 1;
      for (let i = 0; i < count; i++) { const progress = i / count; this.state.vehicles.push({ id: `vehicle-${e.id}-${i}`, kind: e.mode, position: this.pointOn(e, progress), edgeId: e.id, progress, direction: i % 2 === 0 ? 1 : -1, speed: this.speedFor(e.mode), state: 'waiting', passengers: 0, cargo: e.mode === 'road' && i === 1 ? 28 : e.mode === 'flight' ? 60 : 0, nextDeparture: 8 * 60 + (e.mode === 'flight' ? 20 : i * 3) }); }
    }
    this.connectSystems();
    this.updateTiers();
    this.updateSignals();
    installExtensions(this);
    this.notice('arrival', '来自星海的旅行者抵达云山。城市正在独立运行，欢迎步行探索。');
  }
  private addNeighbor(from: string, node: string, edge: NetworkEdge) { const list = this.neighbors.get(from) ?? []; list.push({ node, edge }); this.neighbors.set(from, list); }
  private random() { let x = this.runtime.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.runtime.rng = x >>> 0; return this.runtime.rng / 4294967296; }
  private get now() { return this.state.day * 1440 + this.state.hour * 60; }
  private initializeCitizens() {
    const count = Math.max(384, Math.min(896, this.world.districts.length * 56));
    const namesA = ['沈', '云', '林', '白', '苏', '陆', '江', '顾', '温', '叶', '程', '许'];
    const namesB = ['溪', '岚', '青', '舟', '遥', '宁', '竹', '澄', '川', '月', '星', '禾'];
    const homes = this.world.buildings.filter(b => b.kind === 'home');
    const schools = this.world.buildings.filter(b => b.kind === 'school');
    const workplaces = this.world.buildings.filter(b => ['market', 'workshop', 'farm', 'bank', 'hall', 'police', 'school', 'clinic', 'station', 'airport', 'starport', 'dock', 'core'].includes(b.kind));
    for (let i = 0; i < count; i++) {
      const district = this.world.districts[i % this.world.districts.length];
      const student = Math.floor(i / this.world.districts.length) % 11 === 0;
      const districtHomes = homes.filter(b => b.districtId === district.id);
      const home = (districtHomes.length ? districtHomes : homes.length ? homes : this.world.buildings)[Math.floor(i / this.world.districts.length) % Math.max(1, districtHomes.length || homes.length || this.world.buildings.length)];
      const districtJobs = workplaces.filter(b => b.districtId === district.id);
      const availableJobs = districtJobs.length ? districtJobs : workplaces.length ? workplaces : this.world.buildings;
      const nearbyJobs = availableJobs.filter(b => distance(home.door, b.door) <= 500);
      const jobPool = nearbyJobs.length ? nearbyJobs : [...availableJobs].sort((a, b) => distance(home.door, a.door) - distance(home.door, b.door)).slice(0, 4);
      // Residency and ordinary employment share a real neighbourhood. A global
      // array index previously assigned 3–6 km daily walks without transit.
      const defaultWork = jobPool[Math.floor(i / this.world.districts.length) % jobPool.length];
      const school = schools.find(b => b.districtId === district.id) ?? schools.reduce<Building | null>((best, b) => !best || distance(b.door, home.door) < distance(best.door, home.door) ? b : best, null);
      const work = student ? school ?? defaultWork : defaultWork;
      const facilityRole = ({ data: '科研员', energy: '工程师', administration: '官员', mayor: '官员', council: '议员', emergency: '警察', treasury: '财政官', archives: '档案员', embassy: '使节' } as Record<string, string>)[work.facility ?? ''];
      const role = facilityRole ?? ({ market: '商人', workshop: '工人', farm: '农民', bank: '钱庄职员', hall: '官员', police: '警察', school: '老师', clinic: '医生', station: '驾驶员', airport: '驾驶员', starport: '驾驶员', dock: '搬运工', core: '工程师' } as Record<string, string>)[work.kind] ?? '工人';
      const citizen: Citizen = { id: `citizen-${i}`, name: `${namesA[i % namesA.length]}${namesB[Math.floor(i / namesA.length) % namesB.length]}${i >= 144 ? Math.floor(i / 144) : ''}`, districtId: district.id, homeId: home.id, workId: work.id, role: student && school ? '学生' : role, skills: { craft: 12 + (i % 15) * 3, learning: 15 + (i % 12) * 4, social: 20 + (i % 9) * 6 }, socialIdentities: [i % 8 < 2 ? 'familyMember' : i % 7 === 0 ? 'guildMember' : 'communityMember'], historyTags: ['云山居民'], education: i % 5, position: copy(home.door), state: 'atHome', destinationId: null, money: 150 + this.random() * 350, needs: { hunger: 60 + this.random() * 35, fatigue: 70 + this.random() * 25, social: 50 + this.random() * 40, fun: 50 + this.random() * 40 }, tier: 'statistical', route: [], routeIndex: 0, partnerId: null };
      if (i > 0 && i % 8 === 1) { citizen.partnerId = `citizen-${i - 1}`; this.state.citizens[i - 1].partnerId = citizen.id; }
      this.state.citizens.push(citizen);
    }
  }
  private speedFor(kind: string) { return ({ road: 18, maglev: 50, lightRail: 25, cable: 6, lift: 4, ferry: 8, bridge: 4, flight: 120 } as Record<string, number>)[kind] ?? 100; }
  private citizenIdentity(citizen: Citizen): Role {
    if (ROLES.includes(citizen.role as Role)) return citizen.role as Role;
    return ({ 警察: 'police', 士兵: 'soldier', 驾驶员: 'driver', 老师: 'teacher', 科研员: 'scientist', 科学家: 'scientist', 工程师: 'scientist', 官员: 'official', 议员: 'council', 财政官: 'official', 档案员: 'teacher', 使节: 'official', 商人: 'merchant' } as Record<string, Role>)[citizen.role] ?? 'traveler';
  }
  private refreshWorkforce(): void {
    this.workforce.clear();
    for (const citizen of this.state.citizens) {
      if (citizen.role === '学生' || this.state.extension?.actorProfiles[citizen.id]?.alive === false) continue;
      const roster = this.workforce.get(citizen.workId) ?? []; roster.push(citizen); this.workforce.set(citizen.workId, roster);
    }
  }
  private isEmployed(citizen: Citizen): boolean {
    if (citizen.role === '学生') return false;
    const shop = this.state.shops.find(s => s.buildingId === citizen.workId);
    const index = this.workforce.get(citizen.workId)?.indexOf(citizen) ?? -1;
    return !shop || shop.profit > -240 && index >= 0 && index < shop.employees;
  }
  private registerAttendance(citizen: Citizen, elapsed: number): void { this.employment.add(citizen.id); this.runtime.attendance[citizen.id] = Math.min(480, (this.runtime.attendance[citizen.id] ?? 0) + elapsed); }
  private passengerCapacity(vehicle: Vehicle): number { return vehicle.kind === 'road' ? vehicle.cargo > 0 ? 2 : 10 : vehicle.kind === 'flight' ? 80 : Math.max(4, this.edges.get(vehicle.edgeId)?.capacity ?? 24); }
  private initializeSocialGraph() {
    const citizens = this.state.citizens;
    const seen = new Set<string>();
    const add = (a: Citizen, b: Citizen, type: string, affection: number) => {
      if (a.id === b.id) return;
      const [from, to] = [a.id, b.id].sort(); const key = `${from}:${to}`;
      if (seen.has(key)) return; seen.add(key);
      this.runtime.links.push({ from, to, type, affection, trust: affection * .7 });
    };
    for (let i = 0; i < citizens.length; i++) {
      const c = citizens[i];
      if (c.partnerId) { const partner = citizens.find(p => p.id === c.partnerId); if (partner) add(c, partner, 'family', 82); }
      const coworker = citizens.slice(i + 1).find(p => p.workId === c.workId) ?? citizens.find(p => p.id !== c.id && p.workId === c.workId);
      if (coworker) add(c, coworker, 'coworker', 28);
      const neighbor = citizens.slice(i + 1).find(p => p.homeId === c.homeId) ?? citizens.find(p => p.id !== c.id && p.homeId === c.homeId);
      if (neighbor) add(c, neighbor, 'neighbor', 36);
    }
    for (const d of this.world.districts) this.runtime.districtRelationMeans[d.id] = 30;
  }
  private connectSystems() {
    for (const phase of ORDER) this.bus.on(`system:${phase}`, () => this[phase]());
    this.bus.on('wage', e => { if (e.citizenId && e.districtId) this.runtime.wages.push({ citizenId: e.citizenId, districtId: e.districtId, amount: e.amount ?? 0 }); });
    this.bus.on('sale', e => { this.runtime.taxes += (e.amount ?? 0) * this.state.taxRate; this.state.gdp += e.amount ?? 0; this.state.metrics.trades++; });
    this.bus.on('cargo-arrived', e => { if (e.districtId) this.runtime.freight[e.districtId] = (this.runtime.freight[e.districtId] ?? 0) + (e.amount ?? 0); this.state.metrics.freight += e.amount ?? 0; });
    this.bus.on('crime-resolved', e => { const district = this.state.districts.find(d => d.id === e.districtId); if (district) district.safety = clamp(district.safety + 1.8); this.state.metrics.crimesResolved++; });
    this.bus.on('commute', () => this.state.metrics.commutes++);
    this.bus.on('flight', () => this.state.metrics.flights++);
    this.bus.on('transit-fare', e => { const paid = e.amount ?? 0; this.state.treasury += paid; this.state.gdp += paid; });
    this.bus.on('customer', e => { if (e.citizenId && e.shopId) this.runtime.customers[e.citizenId] = e.shopId; });
    this.bus.on('dispatch', e => {
      const officer = this.state.citizens.find(c => c.id === e.citizenId), crime = this.state.crimes.find(c => c.id === e.crimeId);
      if (!officer || !crime) return;
      const target = this.world.buildings.reduce((a, b) => distance(crime.position, b.door) < distance(crime.position, a.door) ? b : a);
      officer.route = [...this.routeFromCitizen(officer, target), copy(crime.position)]; officer.destinationId = target.id; officer.routeIndex = 1; officer.state = 'responding'; this.runtime.dispatches[officer.id] = { crimeId: crime.id, arrived: false };
    });
    this.bus.on('officer-arrived', e => { const dispatch = e.citizenId && this.runtime.dispatches[e.citizenId]; if (dispatch && dispatch.crimeId === e.crimeId) dispatch.arrived = true; });
    this.bus.on('relationship-change', e => {
      if (!e.citizenId) return;
      for (const link of this.runtime.links) {
        const other = link.from === e.citizenId ? link.to : link.to === e.citizenId ? link.from : null;
        if (!other) continue;
        const impact = (e.amount ?? 0) * (link.type === 'family' ? .25 : .1);
        const direct = this.state.relationships.find(r => r.npcId === other);
        if (direct) { direct.affection = clamp(direct.affection + impact, -100, 100); direct.trust = clamp(direct.trust + impact * .5, -100, 100); if (impact < -2 && !direct.tags.includes('伤害亲友')) direct.tags.push('伤害亲友'); }
        else { const impression = this.runtime.impressions[other] ?? { affection: 0, trust: 0 }; impression.affection = clamp(impression.affection + impact, -100, 100); impression.trust = clamp(impression.trust + impact * .5, -100, 100); this.runtime.impressions[other] = impression; }
      }
    });
  }
  step(realSeconds: number) {
    if (!finite(realSeconds) || realSeconds < 0 || realSeconds > 120 || this.state.paused) return;
    this.runtime.accumulator += realSeconds;
    while (this.runtime.accumulator + 1e-10 >= TICK_SECONDS) {
      this.runtime.accumulator = Math.max(0, this.runtime.accumulator - TICK_SECONDS);
      this.minutes = .25 * this.state.speed;
      this.state.lastSystemOrder = [];
      for (const phase of ORDER) { this.state.lastSystemOrder.push(phase); this.bus.emit({ type: `system:${phase}`, minutes: this.minutes }); }
    }
  }
  setFocus(position: Vec3, mode: ViewMode) {
    if (!this.validPosition(position) || !['walk', 'drone', 'jet'].includes(mode)) return;
    this.runtime.focus = copy(position); this.runtime.mode = mode;
    if (mode === 'walk' && !this.state.player.vehicleId) this.state.player.position = copy(position);
    this.updateTiers();
  }
  setDetail(value: number) { if (finite(value)) this.runtime.detail = clamp(value, .5, 2); }
  get worldDefinition(): WorldDefinition { return this.world; }
  appendNotice(type: string, text: string, districtId?: string): void { this.notice(type, text, districtId); }
  nextRandom(): number { return this.random(); }
  isDriving(vehicleId?: string): boolean { return !!this.state.player.vehicleId && this.runtime.driving.vehicleId === this.state.player.vehicleId && (vehicleId === undefined || vehicleId === this.state.player.vehicleId); }
  driveInput(throttle: number, turn: number, brake: boolean): void { if (!this.isDriving() || !finite(throttle) || !finite(turn) || typeof brake !== 'boolean') return; this.runtime.driving.throttle = clamp(throttle, -1, 1); this.runtime.driving.turn = clamp(turn, -1, 1); this.runtime.driving.brake = brake; }
  hasIdentity(role: Role): boolean { return this.state.player.role === role || (this.state.player.identities ?? []).includes(role); }
  private addIdentity(role: Role) { const p = this.state.player; p.identities = [...new Set([...(p.identities ?? ['traveler']), p.role, role])]; p.role = role; }
  onPhase(phase: typeof ORDER[number], handler: (state: SimState, minutes: number) => void) { this.bus.on(`system:${phase}`, () => handler(this.state, this.minutes)); }
  onEvent(type: string, handler: (event: Event) => void) { this.bus.on(type, handler); }
  emitEvent(event: Event) { this.bus.emit(event); }
  registerCommandHandler(handler: (command: Command) => CommandResult | null) { this.commandHandlers.push(handler); }
  registerSaveValidator(validator: (candidateState: SimState) => void) { this.saveValidators.push(validator); }
  onLoad(handler: () => void) { this.loadHooks.push(handler); }
  private time() { this.state.tick++; this.runtime.relationshipClock = Math.round((this.runtime.relationshipClock + this.minutes) * 1e8) / 1e8; const absolute = Math.round((this.now + this.minutes) * 1e8) / 1e8; this.state.day = Math.floor(absolute / 1440); this.state.hour = (absolute % 1440) / 60; }
  private environment() {
    if (this.now + 1e-7 >= this.runtime.weatherAt) { const r = this.random(); this.state.weather = r < .6 ? '晴' : r < .83 ? '云' : r < .96 ? '雨' : '雾'; this.runtime.weatherAt = this.now + 180 + this.random() * 120; }
    const night = this.state.hour < 6 || this.state.hour >= 19;
    this.state.visibility = (this.state.weather === '雾' ? .58 : this.state.weather === '雨' ? .76 : 1) * (night ? .85 : 1);
    if (this.state.tick % 8 === 0) this.updateTiers();
  }
  private updateTiers() {
    const active = 420 * this.runtime.detail; const regional = 1500 * this.runtime.detail;
    for (const district of this.state.districts) { const definition = this.world.districts.find(d => d.id === district.id)!; const d = distance(this.runtime.focus, definition.center); district.tier = d < active ? 'active' : d < regional ? 'regional' : 'statistical'; }
    for (const citizen of this.state.citizens) { const d = distance(this.runtime.focus, citizen.position); citizen.tier = d < active ? 'active' : d < regional ? 'regional' : 'statistical'; }
  }
  private energy() {
    const night = this.state.hour < 6 || this.state.hour >= 19;
    const demand = 53 + (night ? 19 : 8) + this.state.shops.filter(s => s.open).length * .08 + this.state.vehicles.length * .08;
    const generation = 93 + Math.sin(this.now / 130) * 3 + (this.now < this.runtime.energyBoostUntil ? 20 : 0);
    this.state.energy = clamp(generation / Math.max(1, demand) * 78 - this.state.districts.reduce((n, d) => n + d.pollution, 0) / Math.max(1, this.state.districts.length) * .08);
    for (const district of this.state.districts) district.energy = clamp(this.state.energy - district.pollution * .04);
    this.runtime.operatingCost += this.minutes * (.9 + this.state.policeBudget * 1.8);
  }
  private pointOn(edge: NetworkEdge, progress: number): Vec3 {
    const points = edge.points.length >= 2 ? edge.points : [this.world.nodes.find(n => n.id === edge.from)!.position, this.world.nodes.find(n => n.id === edge.to)!.position];
    let total = 0; for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
    let remaining = clamp(progress, 0, 1) * total;
    for (let i = 1; i < points.length; i++) { const length = distance(points[i - 1], points[i]); if (remaining <= length || i === points.length - 1) { const t = length ? clamp(remaining / length, 0, 1) : 0; return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t, z: points[i - 1].z + (points[i].z - points[i - 1].z) * t }; } remaining -= length; }
    return copy(points[0]);
  }
  private updateSignals() { this.state.signals = Object.fromEntries(this.world.nodes.filter(n => (this.neighbors.get(n.id) ?? []).some(e => e.edge.mode === 'road')).map(n => [n.id, (this.runtime.signalOverrides[n.id] ?? ((Math.floor((this.now + 1e-7) / 6) + hash(n.id) % 4) % 2)) as 0 | 1])); }
  private traffic() {
    this.updateSignals();
    const lanes = new Map<string, Vehicle[]>();
    for (const vehicle of this.state.vehicles) { const key = `${vehicle.edgeId}:${vehicle.direction}`; const list = lanes.get(key) ?? []; list.push(vehicle); lanes.set(key, list); }
    for (const vehicle of this.state.vehicles) {
      const edge = this.edges.get(vehicle.edgeId)!;
      const energy = this.state.energy / 100;
      if (energy < .18 && vehicle.kind !== 'bridge') { vehicle.state = 'noPower'; continue; }
      if (vehicle.kind === 'flight' && (vehicle.progress === 0 || vehicle.progress === 1) && (this.state.hour < 6 || this.state.hour >= 23 || this.state.visibility < .6)) { vehicle.state = 'grounded'; continue; }
      const manual = this.isDriving(vehicle.id);
      if (!manual && this.now + 1e-7 < vehicle.nextDeparture) { vehicle.state = vehicle.state === 'redLight' ? 'redLight' : 'waiting'; continue; }
      if (manual) { const control = this.runtime.driving; const acceleration = control.brake ? -14 : control.throttle >= 0 ? control.throttle * 6 - .65 : control.throttle * 9 - .65; control.speed = clamp(control.speed + acceleration * TICK_SECONDS * this.state.speed, 0, vehicle.kind === 'flight' ? 180 : 38); if (control.speed < .01) { control.speed = 0; vehicle.state = 'parked'; continue; } }
      vehicle.state = 'moving';
      const congestion = vehicle.kind === 'road' ? .8 + (this.state.hour >= 7 && this.state.hour < 9 || this.state.hour >= 17 && this.state.hour < 19 ? -.22 : .1) : 1;
      const delta = (manual ? this.runtime.driving.speed : vehicle.speed) * TICK_SECONDS * this.state.speed * Math.max(.3, energy) * congestion / Math.max(1, edge.length);
      const oldProgress = vehicle.progress;
      let nextProgress = clamp(oldProgress + delta * vehicle.direction, 0, 1);
      if (vehicle.kind === 'road') {
        for (const ahead of lanes.get(`${edge.id}:${vehicle.direction}`) ?? []) {
          if (ahead === vehicle || ahead.edgeId !== edge.id || (ahead.progress - oldProgress) * vehicle.direction <= 1e-7) continue;
          const safeProgress = ahead.progress - vehicle.direction * 6 / Math.max(1, edge.length);
          nextProgress = vehicle.direction > 0 ? Math.min(nextProgress, Math.max(oldProgress, safeProgress)) : Math.max(nextProgress, Math.min(oldProgress, safeProgress));
        }
        if (Math.abs(nextProgress - oldProgress) < 1e-9) { vehicle.state = 'congested'; if (manual) this.runtime.driving.speed = 0; }
      }
      vehicle.progress = nextProgress;
      vehicle.position = this.pointOn(edge, vehicle.progress);
      if (vehicle.kind === 'road') { const front = this.pointOn(edge, Math.min(1, vehicle.progress + .001)), back = this.pointOn(edge, Math.max(0, vehicle.progress - .001)); const dx = front.x - back.x, dz = front.z - back.z, length = Math.hypot(dx, dz); if (length > .001) { vehicle.position.x -= dz / length * vehicle.direction * 1.3; vehicle.position.z += dx / length * vehicle.direction * 1.3; } }
      if (vehicle.progress === 0 && vehicle.direction < 0 || vehicle.progress === 1 && vehicle.direction > 0) {
        const nodeId = vehicle.direction > 0 ? edge.to : edge.from;
        const node = this.world.nodes.find(n => n.id === nodeId)!;
        for (const rider of Object.values(this.runtime.riders)) if (rider.vehicleId === vehicle.id && rider.stopNodeId === nodeId && !rider.arrived) { rider.arrived = true; vehicle.passengers = Math.max(0, vehicle.passengers - 1); }
        if (vehicle.kind === 'road') {
          const offset = hash(nodeId) % 4;
          const green = this.state.signals?.[nodeId] ?? ((Math.floor((this.now + 1e-7) / 48) + offset) % 2);
          if (green !== (vehicle.direction > 0 ? 1 : 0)) { vehicle.state = 'redLight'; vehicle.nextDeparture = this.now + 2; if (manual) this.runtime.driving.speed = 0; continue; }
        }
        if (vehicle.cargo > 0) { this.bus.emit({ type: 'cargo-arrived', districtId: node.districtId, amount: vehicle.cargo }); vehicle.cargo = 0; const producer = this.state.shops.find(s => s.districtId === node.districtId && ['farm', 'workshop', 'dock'].includes(this.buildings.get(s.buildingId)!.kind) && s.inventory >= 1); if (producer) { vehicle.cargo = Math.min(producer.inventory, vehicle.kind === 'flight' ? 60 : 28); producer.inventory -= vehicle.cargo; } }
        if (vehicle.kind === 'flight') this.bus.emit({ type: 'flight' });
        vehicle.passengers = Object.values(this.runtime.riders).filter(r => r.vehicleId === vehicle.id && !r.arrived).length + (this.state.player.vehicleId === vehicle.id ? 1 : 0);
        let candidates = (this.neighbors.get(nodeId) ?? []).filter(n => n.edge.mode === vehicle.kind && n.edge.id !== edge.id);
        if (vehicle.kind === 'road' && !manual) { const mainRoads = candidates.filter(c => this.world.nodes.find(n => n.id === c.edge.from)?.station && this.world.nodes.find(n => n.id === c.edge.to)?.station); if (mainRoads.length && this.random() < .85) candidates = mainRoads; }
        if (candidates.length && ['road', 'lightRail', 'maglev', 'ferry'].includes(vehicle.kind)) { const chosen = manual ? this.chooseTurn(edge, vehicle.direction, nodeId, candidates) : candidates[Math.floor(this.random() * candidates.length)]; vehicle.edgeId = chosen.edge.id; vehicle.direction = chosen.edge.from === nodeId ? 1 : -1; vehicle.progress = vehicle.direction > 0 ? 0 : 1; }
        else vehicle.direction *= -1;
        vehicle.state = 'boarding';
        vehicle.nextDeparture = this.now + (manual ? 2 : vehicle.kind === 'flight' ? 75 : vehicle.kind === 'road' ? 8 : this.state.hour >= 22 || this.state.hour < 6 ? 48 : 16);
      }
    }
    const boarded = this.state.vehicles.find(v => v.id === this.state.player.vehicleId);
    if (boarded) this.state.player.position = copy(boarded.position);
  }
  private chooseTurn(edge: NetworkEdge, direction: number, nodeId: string, candidates: { node: string; edge: NetworkEdge }[]) {
    const position = this.world.nodes.find(n => n.id === nodeId)!.position;
    const behind = direction > 0 ? edge.points[Math.max(0, edge.points.length - 2)] : edge.points[Math.min(1, edge.points.length - 1)];
    const hx = position.x - behind.x, hz = position.z - behind.z;
    const angles = candidates.map(candidate => { const points = candidate.edge.points; const next = candidate.edge.from === nodeId ? points[Math.min(1, points.length - 1)] : points[Math.max(0, points.length - 2)]; const nx = next.x - position.x, nz = next.z - position.z; return { candidate, angle: Math.atan2(hx * nz - hz * nx, hx * nx + hz * nz) }; });
    const turn = this.runtime.driving.turn;
    angles.sort((a, b) => turn < -.2 ? a.angle - b.angle : turn > .2 ? b.angle - a.angle : Math.abs(a.angle) - Math.abs(b.angle));
    return angles[0].candidate;
  }
  private nearestNode(position: Vec3) { let nearest = this.world.nodes[0]; let best = Infinity; for (const node of this.world.nodes) { const d = distance(position, node.position); if (d < best) { best = d; nearest = node; } } return nearest; }
  private pointKey(position: Vec3): string { return `${position.x}/${position.y}/${position.z}`; }
  private buildingNode(building: Building) { return this.doorNodes.get(building.id)!; }
  private cacheRoute(key: string, points: Vec3[]): void { if (this.routeCache.size >= 2048) this.routeCache.delete(this.routeCache.keys().next().value!); this.routeCache.set(key, points); }
  private walkingTree(start: string) {
    const cached = this.walkingTrees.get(start); if (cached) return cached;
    const costs = new Map<string, number>([[start, 0]]), previous = new Map<string, { node: string; edge: NetworkEdge }>();
    const heap: { node: string; cost: number }[] = [];
    const push = (entry: { node: string; cost: number }) => { heap.push(entry); let index = heap.length - 1; while (index) { const parent = (index - 1) >> 1; if (heap[parent].cost <= entry.cost) break; heap[index] = heap[parent]; index = parent; } heap[index] = entry; };
    const pop = () => { const first = heap[0], last = heap.pop()!; if (heap.length) { let index = 0; while (index * 2 + 1 < heap.length) { const left = index * 2 + 1, right = left + 1, child = right < heap.length && heap[right].cost < heap[left].cost ? right : left; if (heap[child].cost >= last.cost) break; heap[index] = heap[child]; index = child; } heap[index] = last; } return first; };
    push({ node: start, cost: 0 });
    while (heap.length) { const next = pop(); if (next.cost !== costs.get(next.node)) continue; for (const neighbor of this.neighbors.get(next.node) ?? []) { if (!['road', 'bridge'].includes(neighbor.edge.mode)) continue; const cost = next.cost + neighbor.edge.length; if (cost < (costs.get(neighbor.node) ?? Infinity)) { costs.set(neighbor.node, cost); previous.set(neighbor.node, { node: next.node, edge: neighbor.edge }); push({ node: neighbor.node, cost }); } } }
    const tree = { costs, previous }; if (this.walkingTrees.size >= 96) this.walkingTrees.delete(this.walkingTrees.keys().next().value!); this.walkingTrees.set(start, tree); return tree;
  }
  private nodePath(from: string, to: string): Vec3[] {
    const key = `node:${from}>${to}`, cached = this.routeCache.get(key); if (cached) return cached;
    const previous = this.walkingTree(from).previous, legs: { node: string; edge: NetworkEdge }[] = []; let cursor = to;
    while (cursor !== from && previous.has(cursor)) { const leg = previous.get(cursor)!; legs.unshift(leg); cursor = leg.node; }
    if (cursor !== from) return [];
    const points: Vec3[] = [copy(this.world.nodes.find(n => n.id === from)!.position)];
    for (const leg of legs) for (const point of leg.edge.from === leg.node ? leg.edge.points : [...leg.edge.points].reverse()) points.push(copy(point));
    this.cacheRoute(key, points); return points;
  }
  private walkingAnchors(citizen: Citizen): { node: string; cost: number; points: Vec3[] }[] {
    const interior = this.world.buildings.find(b => this.isNearBuilding(b, citizen.position, 0));
    if (interior) {
      const floor = Math.floor((citizen.position.y - interior.position.y + .01) / (interior.height / interior.floors));
      const points = [copy(citizen.position), ...(floor ? [getStairPosition(interior, floor), getStairPosition(interior, 0)] : []), copy(interior.door)];
      const node = this.buildingNode(interior); points.push(copy(node.position)); let cost = 0; for (let i = 1; i < points.length; i++) cost += distance(points[i - 1], points[i]);
      return [{ node: node.id, cost, points }];
    }
    // Reuse the street segment the citizen actually occupies. Replanning must
    // not send an actor back to an unrelated nearby building's entire route.
    const anchors: { node: string; cost: number; points: Vec3[] }[] = [], route = citizen.route ?? [], index = citizen.routeIndex ?? 0;
    for (const direction of [-1, 1]) { const points = [copy(citizen.position)]; let cost = 0; for (let i = direction < 0 ? index - 1 : index; i >= 0 && i < route.length; i += direction) { cost += distance(points.at(-1)!, route[i]); points.push(copy(route[i])); const node = this.nodeAt.get(this.pointKey(route[i])); if (node) { anchors.push({ node, cost, points }); break; } } }
    if (anchors.length) return anchors;
    const node = this.nearestNode(citizen.position); return [{ node: node.id, cost: distance(citizen.position, node.position), points: [copy(citizen.position), copy(node.position)] }];
  }
  private routeFromCitizen(citizen: Citizen, destination: Building, anchors = this.walkingAnchors(citizen)): Vec3[] {
    const target = this.buildingNode(destination);
    const best = [...anchors].sort((a, b) => a.cost + (this.walkingTree(a.node).costs.get(target.id) ?? Infinity) - b.cost - (this.walkingTree(b.node).costs.get(target.id) ?? Infinity))[0];
    const network = this.nodePath(best.node, target.id); if (!network.length) return [copy(citizen.position)];
    return [...best.points, ...network.slice(1), copy(destination.door)];
  }
  private walkingDistance(citizen: Citizen, destination: Building): number { const target = this.buildingNode(destination); return Math.min(...this.walkingAnchors(citizen).map(a => a.cost + (this.walkingTree(a.node).costs.get(target.id) ?? Infinity))); }
  private route(from: Building, to: Building): Vec3[] {
    const key = `${from.id}>${to.id}`; const cached = this.routeCache.get(key); if (cached) return cached;
    const network = this.nodePath(this.buildingNode(from).id, this.buildingNode(to).id);
    const points = network.length ? [copy(from.door), ...network, copy(to.door)] : [];
    this.cacheRoute(key, points); return points;
  }
  private setDestination(citizen: Citizen, destination: Building, rebuild = false) {
    if (!rebuild && citizen.destinationId === destination.id) return;
    const row = hash(citizen.id) % 5 - 2;
    const role = this.citizenIdentity(citizen);
    const action = this.runtime.activities[citizen.id];
    const available = action === 'rest' || action === 'work' ? Array.from({ length: destination.floors }, (_, floor) => floor).filter(floor => canAccessFloor(destination, floor, { role, identities: [role] }) && !destination.floorUses?.[floor]?.includes('观景')) : [0];
    const floor = available[hash(`${citizen.id}:${destination.id}`) % Math.max(1, available.length)] ?? 0;
    const dimensions = getFloorDimensions(destination, floor), stair = getStairPosition(destination, floor);
    const roomPoint = { x: destination.position.x + row * Math.min(1.8, dimensions.width / 12), y: stair.y, z: destination.position.z + Math.min(1.2, dimensions.depth / 10) };
    const interior: Vec3[] = floor > 0 ? [getStairPosition(destination, 0), stair, roomPoint] : [roomPoint];
    const outside = this.routeFromCitizen(citizen, destination); citizen.destinationId = destination.id; citizen.route = outside.length > 1 ? [...outside, ...interior] : outside; citizen.routeIndex = 1; citizen.state = 'moving';
  }
  private chooseFacility(citizen: Citizen): { destination: Building; activity: string } {
    const hour = this.state.hour, night = hour >= 22 || hour < 6, shift = hour >= 7.5 && hour < 17.5;
    const home = this.buildings.get(citizen.homeId)!, work = this.buildings.get(citizen.workId)!;
    const anchors = this.walkingAnchors(citizen);
    const candidates: { destination: Building; activity: string; score: number }[] = [];
    const add = (b: Building, activity: string, score: number) => { const target = this.buildingNode(b); const travel = Math.min(...anchors.map(a => a.cost + (this.walkingTree(a.node).costs.get(target.id) ?? Infinity))); if (finite(travel)) candidates.push({ destination: b, activity, score: score - Math.min(150, travel / 12) }); };
    // A facility advertises a service; citizens compare that offer against needs,
    // liquidity, memories and travel cost. A work shift is a preference, not a lock.
    add(home, 'rest', (100 - citizen.needs.fatigue) * .8 + (night ? 140 : !shift ? 18 : 0) + (citizen.needs.fatigue < 25 ? 110 : 0));
    if (citizen.role === '学生' && work.kind === 'school' || this.isEmployed(citizen)) add(work, citizen.role === '学生' ? 'study' : 'work', clamp((450 - citizen.money) / 10, 0, 45) + (shift ? 58 : -16) + (citizen.skills?.craft ?? 20) * .06);
    for (const shop of this.state.shops) {
      if (!shop.open || shop.inventory < 1 || citizen.money < shop.price) continue;
      const relation = this.state.relationships.find(r => r.npcId === citizen.id); if (relation && this.hostilityRank(relation) >= 2 && this.playerOwnsShop(shop)) continue;
      const building = this.buildings.get(shop.buildingId)!;
      if (distance(citizen.position, building.door) > 1200 && building.districtId !== citizen.districtId) continue;
      add(building, 'eat', (100 - citizen.needs.hunger) * 1.15 + (citizen.needs.hunger < 30 ? 260 : 0) + (hour >= 18 && hour < 19 ? 12 : 0) - (night ? 50 : 0));
    }
    for (const building of this.world.buildings) {
      const profile = this.state.extension?.actorProfiles[citizen.id];
      if (building.kind === 'clinic' && profile && profile.health < 60 && (citizen.money >= 30 || this.state.treasury >= 30)) add(building, 'heal', (60 - profile.health) * 3 + profile.stress * .1);
      if (building.districtId !== citizen.districtId) continue;
      if (building.kind === 'school' && hour >= 7 && hour < 19) add(building, 'study', Math.max(0, 4 - (citizen.education ?? 0)) * 8 + (citizen.role === '学生' && shift ? 55 : 0) + (citizen.skills?.learning ?? 20) * .2);
      if (['pavilion', 'hall', 'dock'].includes(building.kind)) add(building, 'social', (100 - citizen.needs.social) * .8 + (100 - citizen.needs.fun) * .35 - (night ? 60 : 0));
      if (['pavilion', 'station', 'clinic'].includes(building.kind) && citizen.needs.fatigue < 25) add(building, 'rest', (100 - citizen.needs.fatigue) * .8 + 110 + (night ? 140 : 0));
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0]; return chosen ? { destination: chosen.destination, activity: chosen.activity } : { destination: home, activity: 'rest' };
  }
  private moveCitizen(citizen: Citizen, minutes: number) {
    // `minutes` includes the tier's skipped ticks. One calendar minute represents
    // one simulated real second at 1×, for every tier, including police routes.
    let movement = minutes * (this.state.weather === '雨' ? 3.1 : 4.2);
    const route = citizen.route ?? []; let index = citizen.routeIndex ?? 0;
    while (movement > 0 && index < route.length) { const next = route[index]; const d = distance(citizen.position, next); if (d <= movement) { citizen.position.x = next.x; citizen.position.y = next.y; citizen.position.z = next.z; movement -= d; index++; } else { const t = movement / d; citizen.position.x += (next.x - citizen.position.x) * t; citizen.position.y += (next.y - citizen.position.y) * t; citizen.position.z += (next.z - citizen.position.z) * t; movement = 0; } }
    citizen.routeIndex = index;
    return index >= route.length;
  }
  private people() {
    this.refreshWorkforce();
    const hour = this.state.hour;
    for (let i = 0; i < this.state.citizens.length; i++) {
      const citizen = this.state.citizens[i]; const frequency = citizen.tier === 'active' ? 1 : citizen.tier === 'regional' ? 4 : 16;
      if (this.state.extension?.actorProfiles[citizen.id]?.alive === false) { citizen.state = 'dead'; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0; const ride = this.runtime.riders[citizen.id]; if (ride) { const vehicle = this.state.vehicles.find(v => v.id === ride.vehicleId); if (vehicle && !ride.arrived) vehicle.passengers = Math.max(0, vehicle.passengers - 1); delete this.runtime.riders[citizen.id]; } continue; }
      if ((this.state.tick + i) % frequency) continue;
      const elapsed = this.minutes * frequency;
      citizen.needs.hunger = clamp(citizen.needs.hunger - elapsed * .05);
      citizen.needs.fatigue = clamp(citizen.needs.fatigue - elapsed * .035);
      citizen.needs.social = clamp(citizen.needs.social - elapsed * .015);
      citizen.needs.fun = clamp(citizen.needs.fun - elapsed * .02);
      const dispatch = this.runtime.dispatches[citizen.id];
      if (dispatch) {
        const crime = this.state.crimes.find(c => c.id === dispatch.crimeId);
        const health = this.state.extension?.actorProfiles[citizen.id]?.health ?? 100;
        if (!crime || crime.status !== 'responding' || citizen.needs.hunger < 20 || citizen.needs.fatigue < 15 || health < 35) {
          if (crime?.status === 'responding') { crime.status = 'open'; crime.responseAt = 0; this.notice('dispatch', `${citizen.name}因补给或健康需要退出响应，事件等待有行动能力的巡警接替。`, crime.districtId); }
          delete this.runtime.dispatches[citizen.id]; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
        }
        else { this.registerAttendance(citizen, elapsed); citizen.state = 'responding'; if (this.moveCitizen(citizen, elapsed)) { citizen.state = 'investigating'; this.bus.emit({ type: 'officer-arrived', citizenId: citizen.id, crimeId: crime.id }); } continue; }
      }
      const home = this.buildings.get(citizen.homeId)!; const work = this.buildings.get(citizen.workId)!;
      const riding = this.runtime.riders[citizen.id];
      if (riding) {
        const vehicle = this.state.vehicles.find(v => v.id === riding.vehicleId)!;
        const stop = this.world.nodes.find(n => n.id === riding.stopNodeId)!;
        citizen.position = copy(riding.arrived ? stop.position : vehicle.position); citizen.state = 'riding';
        if (!riding.arrived && (vehicle.state === 'moving' || distance(vehicle.position, stop.position) > 40)) continue;
        delete this.runtime.riders[citizen.id]; if (!riding.arrived) vehicle.passengers = Math.max(0, vehicle.passengers - 1);
        citizen.position = copy(stop.position); citizen.route = []; citizen.routeIndex = 0;
        const ongoing = citizen.destinationId && this.buildings.get(citizen.destinationId);
        if (ongoing) this.setDestination(citizen, ongoing, true);
      }
      let destination: Building;
      const sleeping = hour >= 22 || hour < 6;
      const shift = hour >= 7.5 && hour < 17.5;

      const previousActivity = this.runtime.activities[citizen.id];
      const previousShop = this.state.shops.find(s => s.buildingId === citizen.destinationId);
      const committedNeed = !!citizen.destinationId && (previousActivity === 'eat' && citizen.needs.hunger < 55 && previousShop?.open && previousShop.inventory >= 1 && citizen.money >= previousShop.price || previousActivity === 'rest' && citizen.needs.fatigue < 55 && citizen.needs.hunger >= 30 || previousActivity === 'heal' && (this.state.extension?.actorProfiles[citizen.id]?.health ?? 100) < 60 && citizen.needs.hunger >= 35 && citizen.needs.fatigue >= 25);
      if (!committedNeed && (!citizen.destinationId || this.now + 1e-7 >= (this.runtime.decisionAt[citizen.id] ?? 0) || sleeping && previousActivity !== 'rest')) {
        const choice = this.chooseFacility(citizen); destination = choice.destination; this.runtime.activities[citizen.id] = choice.activity; this.runtime.decisionAt[citizen.id] = this.now + 25 + this.random() * 35;
      } else destination = this.buildings.get(citizen.destinationId!)!;
      this.setDestination(citizen, destination);
      if (distance(citizen.position, destination.door) > 200) {
        const transit = this.state.vehicles.find(v => {
          if (v.state === 'moving' || v.kind === 'flight' || citizen.money < 4 || v.passengers >= this.passengerCapacity(v) || distance(v.position, citizen.position) > 40) return false;
          const edge = this.edges.get(v.edgeId)!; const end = this.world.nodes.find(n => n.id === (v.direction > 0 ? edge.to : edge.from))!;
          return distance(end.position, destination.door) + 60 < distance(citizen.position, destination.door);
        });
        if (transit) { const edge = this.edges.get(transit.edgeId)!; citizen.money -= 4; this.bus.emit({ type: 'transit-fare', amount: 4, citizenId: citizen.id, vehicleId: transit.id, districtId: citizen.districtId }); this.runtime.riders[citizen.id] = { vehicleId: transit.id, stopNodeId: transit.direction > 0 ? edge.to : edge.from }; transit.passengers++; citizen.state = 'riding'; citizen.position = copy(transit.position); this.bus.emit({ type: 'commute', citizenId: citizen.id }); continue; }
      }
      if ((citizen.routeIndex ?? 0) < (citizen.route?.length ?? 0) && !this.moveCitizen(citizen, elapsed)) continue;
      if (!this.isNearBuilding(destination, citizen.position, 1)) { citizen.state = 'unreachable'; citizen.destinationId = null; continue; }
      const activity = this.runtime.activities[citizen.id];
      if (destination.id === home.id || activity === 'rest') {
        citizen.state = sleeping ? 'sleeping' : 'atHome'; citizen.needs.fatigue = clamp(citizen.needs.fatigue + elapsed * (sleeping ? .35 : .12)); citizen.needs.fun = clamp(citizen.needs.fun + elapsed * .07); if (citizen.partnerId) citizen.needs.social = clamp(citizen.needs.social + elapsed * .08);
      } else if (activity === 'work') {
        if (!this.isEmployed(citizen)) { citizen.state = 'unemployed'; citizen.destinationId = null; continue; }
        if (citizen.state !== 'working') this.bus.emit({ type: 'commute', citizenId: citizen.id }); citizen.state = 'working'; citizen.needs.social = clamp(citizen.needs.social + elapsed * .035); this.registerAttendance(citizen, elapsed);
      } else if (activity === 'study') {
        citizen.state = 'studying'; citizen.education = clamp((citizen.education ?? 0) + elapsed * .0004, 0, 20); if (citizen.skills) citizen.skills.learning = clamp(citizen.skills.learning + elapsed * .003); citizen.needs.social = clamp(citizen.needs.social + elapsed * .02);
      } else if (activity === 'social') {
        citizen.state = 'socializing'; citizen.needs.social = clamp(citizen.needs.social + elapsed * .12); citizen.needs.fun = clamp(citizen.needs.fun + elapsed * .09);
      } else if (activity === 'heal') {
        citizen.state = 'healing'; citizen.needs.fatigue = clamp(citizen.needs.fatigue + elapsed * .03);
      } else if (activity === 'eat') {
        citizen.state = 'shopping';
        this.bus.emit({ type: 'customer', citizenId: citizen.id, shopId: this.state.shops.find(s => s.buildingId === destination.id)?.id });
      }
    }
    const player = this.state.player; player.needs.hunger = clamp(player.needs.hunger - this.minutes * .035); player.needs.fatigue = clamp(player.needs.fatigue - this.minutes * .018); player.needs.social = clamp(player.needs.social - this.minutes * .012); player.needs.fun = clamp(player.needs.fun - this.minutes * .009);
    if (this.now + 1e-7 >= this.runtime.payrollAt) {
      for (const citizen of this.state.citizens) {
        if (this.state.extension?.actorProfiles[citizen.id]?.alive === false) continue;
        const district = this.state.districts.find(d => d.id === citizen.districtId)!;
        const employed = this.isEmployed(citizen);
        const attendance = this.runtime.attendance[citizen.id] ?? 0;
        if (employed && citizen.role !== '学生' && attendance >= 30) this.bus.emit({ type: 'wage', citizenId: citizen.id, districtId: citizen.districtId, amount: 32 * (.7 + district.prosperity / 100) * Math.min(1, attendance / 480) });
      }
      this.runtime.payrollAt = (this.state.day + (hour >= 17 ? 1 : 0)) * 1440 + 17 * 60;
      if (this.runtime.payrollAt <= this.now) this.runtime.payrollAt += 1440;
      this.employment.clear();
      this.runtime.attendance = {};
    }
  }
  private commerce() {
    if (this.now < this.runtime.commerceAt) return;
    const elapsed = Math.max(10, this.now - this.runtime.commerceAt + 10); this.runtime.commerceAt = this.now + 10;
    const commercialFeedback = new Map<string, { sum: number; count: number }>();
    for (const shop of this.state.shops) {
      const building = this.buildings.get(shop.buildingId)!; const district = this.state.districts.find(d => d.id === shop.districtId)!;
      const scheduledOpen = this.state.hour >= 6 && this.state.hour < (building.kind === 'market' ? 22 : 20);
      const serviceFailure = district.energy <= 25 || shop.profit <= -600;
      shop.open = scheduledOpen && !serviceFailure;
      shop.customers = 0;
      const cargo = this.runtime.freight[shop.districtId] ?? 0;
      if (cargo > 0 && building.kind === 'market') { const received = Math.min(cargo, 14); shop.inventory = clamp(shop.inventory + received, 0, 10000); this.runtime.freight[shop.districtId] = cargo - received; }
      if (shop.open && ['farm', 'workshop', 'dock'].includes(building.kind)) {
        const input = building.kind === 'workshop' ? Math.min(this.runtime.freight[shop.districtId] ?? 0, 10) : 8;
        if (building.kind === 'workshop') this.runtime.freight[shop.districtId] = Math.max(0, (this.runtime.freight[shop.districtId] ?? 0) - input);
        shop.inventory = clamp(shop.inventory + input * district.energy / 100, 0, 10000);
      }
      if (shop.open) {
        for (const [citizenId, shopId] of Object.entries(this.runtime.customers)) {
          if (shopId !== shop.id) continue;
          const citizen = this.state.citizens.find(c => c.id === citizenId)!;
          if (this.state.extension?.actorProfiles[citizen.id]?.alive === false) continue;
          const relation = this.state.relationships.find(r => r.npcId === citizen.id); if (relation && this.hostilityRank(relation) >= 2 && this.playerOwnsShop(shop)) continue;
          if (citizen.destinationId !== building.id || citizen.state !== 'shopping' || citizen.needs.hunger > 78 || citizen.money < shop.price || shop.inventory < 1) continue;
          if (distance(citizen.position, building.position) > Math.max(building.width, building.depth) / 2 + 3) continue;
          const trust = this.state.relationships.find(r => r.npcId === citizen.id)?.trust ?? 0;
          const price = shop.price * (trust > 55 ? .95 : 1);
          citizen.money -= price; citizen.needs.hunger = clamp(citizen.needs.hunger + 52); citizen.needs.fun = clamp(citizen.needs.fun + 8); shop.inventory--; shop.customers++; shop.revenue += price; shop.profit += price * (1 - this.state.taxRate) - 4;
          this.bus.emit({ type: 'sale', amount: price, districtId: shop.districtId });
        }
        // Wages are charged once, when finance transfers the attended salary.
        // Only the separately modelled premises/utilities expense accrues here.
        shop.profit -= elapsed / 1440 * 20;
      }
      const scarcity = clamp((70 - shop.inventory) / 70, -.4, 2);
      const demand = shop.customers / Math.max(1, shop.employees);
      shop.price = clamp(shop.price + (12 * (1 + scarcity * .5 + demand * .08) - shop.price) * .04, 5, 40);
      if (shop.profit < -240) shop.employees = Math.max(0, shop.employees - 1);
      const rosterSize = this.workforce.get(shop.buildingId)?.length ?? 0;
      shop.employees = Math.min(shop.employees, rosterSize);
      if (shop.profit > 200 && shop.employees < rosterSize) shop.employees++;
      const feedback = commercialFeedback.get(district.id) ?? { sum: 0, count: 0 };
      feedback.sum += serviceFailure ? -.07 : scheduledOpen ? shop.customers * .07 - .01 : 0; feedback.count++; commercialFeedback.set(district.id, feedback);
      district.pollution = clamp(district.pollution + (building.kind === 'workshop' ? .005 : -.002) * elapsed / 10);
    }
    for (const district of this.state.districts) {
      const feedback = commercialFeedback.get(district.id);
      if (feedback?.count) district.prosperity = clamp(district.prosperity + feedback.sum / feedback.count * elapsed / 10);
      const adults = this.state.citizens.filter(c => c.districtId === district.id && c.role !== '学生' && this.state.extension?.actorProfiles[c.id]?.alive !== false);
      district.employment = adults.length ? adults.filter(c => this.isEmployed(c)).length / adults.length : 1;
    }
    this.runtime.customers = {};
  }
  private finance() {
    for (const wage of this.runtime.wages) { const citizen = this.state.citizens.find(c => c.id === wage.citizenId); if (!citizen) continue; const workplace = this.buildings.get(citizen.workId)!; const employer = this.state.shops.find(s => s.buildingId === workplace.id); const amount = employer ? wage.amount : Math.min(this.state.treasury, wage.amount); if (employer) employer.profit -= amount; else this.state.treasury -= amount; const tax = amount * this.state.taxRate; citizen.money = clamp(citizen.money + amount - tax, 0, 1e9); this.runtime.taxes += tax; }
    this.runtime.wages.length = 0;
    this.state.treasury = clamp(this.state.treasury + this.runtime.taxes - this.runtime.operatingCost, 0, 1e12); this.runtime.taxes = 0; this.runtime.operatingCost = 0;
    if (this.now + 1e-7 >= this.runtime.financeAt) {
      const hours = Math.max(1, (this.now - this.runtime.financeAt + 60) / 60); this.runtime.financeAt = this.now + 60;
      this.state.bankBalance = clamp(this.state.bankBalance * (1 + .000015 * hours), 0, 1e9);
      this.state.loan = clamp(this.state.loan * (1 + .00008 * hours), 0, 1e9);
      if (this.runtime.investment > 0) { const prosperity = this.state.districts.reduce((n, d) => n + d.prosperity, 0) / this.state.districts.length; this.state.player.money = clamp(this.state.player.money + this.runtime.investment * .0008 * (prosperity - 35) / 30 * hours, 0, 1e9); }
      for (const id of this.runtime.playerBusinesses) { const shop = this.state.shops.find(s => s.id === id); if (shop && !this.state.extension?.companies.some(company => company.buildingId === shop.buildingId)) { const dividend = Math.max(0, shop.profit) * .005; this.state.player.money += dividend; shop.profit -= dividend; } }
    }
  }
  private security() {
    if (this.now + 1e-7 >= this.runtime.crimeAt) {
      this.runtime.crimeAt = this.now + 35;
      for (const district of this.state.districts) {
        const probability = clamp((100 - district.safety) / 140 + (1 - district.employment) * .35 + (45 - district.prosperity) / 250, .025, .7);
        if (this.random() > probability || this.state.crimes.filter(c => c.districtId === district.id && c.status !== 'resolved').length > 5) continue;
        const center = this.world.districts.find(d => d.id === district.id)!.center;
        const crime: Crime = { id: `crime-${++this.runtime.crimeId}`, districtId: district.id, position: { x: center.x + (this.random() - .5) * 100, y: center.y, z: center.z + (this.random() - .5) * 100 }, severity: 1 + Math.floor(this.random() * 3), status: 'open', responseAt: 0 };
        this.state.crimes.push(crime); district.crimeCount++; district.safety = clamp(district.safety - crime.severity); this.notice('crime', `${this.world.districts.find(d => d.id === district.id)!.name}发生治安事件，巡警接获通报。`, district.id);
      }
    }
    for (const crime of this.state.crimes) {
      if (crime.status === 'resolved') continue;
      const district = this.state.districts.find(d => d.id === crime.districtId)!;
      if (crime.status === 'open' && this.state.treasury > 50 && this.state.policeBudget > .05) {
        const target = this.world.buildings.reduce((a, b) => distance(a.door, crime.position) < distance(b.door, crime.position) ? a : b);
        const officer = this.state.citizens.filter(c => this.citizenIdentity(c) === 'police' && c.needs.hunger >= 35 && c.needs.fatigue >= 30 && (this.state.extension?.actorProfiles[c.id]?.health ?? 100) >= 45 && !this.runtime.dispatches[c.id] && !this.runtime.riders[c.id] && this.state.extension?.actorProfiles[c.id]?.alive !== false).map(c => ({ citizen: c, travel: this.walkingDistance(c, target) })).filter(candidate => finite(candidate.travel)).sort((a, b) => a.travel - b.travel)[0]?.citizen;
        if (!officer) continue;
        crime.status = 'responding'; this.state.treasury = Math.max(0, this.state.treasury - 12 * crime.severity);
        this.bus.emit({ type: 'dispatch', citizenId: officer.id, crimeId: crime.id });
        const route = officer.route ?? []; let remaining = 0; for (let index = officer.routeIndex ?? 0; index < route.length; index++) remaining += distance(index === (officer.routeIndex ?? 0) ? officer.position : route[index - 1], route[index]);
        crime.responseAt = this.now + 10 + remaining / (this.state.weather === '雨' ? 3.1 : 4.2);
      } else if (crime.status === 'responding') { const assigned = Object.entries(this.runtime.dispatches).find(([, dispatch]) => dispatch.crimeId === crime.id); if (!assigned || this.state.extension?.actorProfiles[assigned[0]]?.alive === false) { if (assigned) delete this.runtime.dispatches[assigned[0]]; crime.status = 'open'; crime.responseAt = 0; } else if (assigned[1].arrived && this.now + 1e-7 >= crime.responseAt) { crime.status = 'resolved'; this.bus.emit({ type: 'crime-resolved', districtId: crime.districtId }); } }
      else district.safety = clamp(district.safety - this.minutes * .001 * crime.severity);
    }
    if (this.state.crimes.length > 120) this.state.crimes = this.state.crimes.filter(c => c.status !== 'resolved').concat(this.state.crimes.filter(c => c.status === 'resolved').slice(-60));
  }
  private politics() {
    const pending = this.state.policyPending;
    if (pending && this.now + 1e-7 >= pending.applyAt) { this.state.taxRate = pending.taxRate; this.state.policeBudget = pending.policeBudget; delete this.state.policyPending; this.notice('policy', '议会通过的税率与警务预算已生效，财政和治安将逐步反馈。'); }
    const campaign = this.runtime.campaign;
    if (campaign && this.now + 1e-7 >= campaign.countAt) { this.runtime.campaign = null; if (campaign.votes >= 62) { this.addIdentity('mayor'); this.state.player.reputation += 12; this.notice('election', `计票完成：支持率${campaign.votes.toFixed(1)}%，你当选云山市长。`); } else this.notice('election', `计票完成：支持率${campaign.votes.toFixed(1)}%，请继续服务社区后再参选。`); }
  }
  private feedback() {
    const avg = (key: 'safety' | 'prosperity' | 'employment') => this.state.districts.reduce((n, d) => n + d[key], 0) / this.state.districts.length;
    const target = clamp(avg('safety') * .35 + avg('prosperity') * .35 + avg('employment') * 20 + 10 - this.state.taxRate * 40 - (this.state.treasury < 2000 ? 15 : 0));
    this.state.support = clamp(this.state.support + (target - this.state.support) * .002 * this.minutes);
    if (this.now + 1e-7 >= this.runtime.socialAt) {
      this.runtime.socialAt = this.now + 60;
      for (const relationship of this.state.relationships) {
        this.initializeRelationshipStages(relationship);
        relationship.affection = clamp(relationship.affection + (relationship.type === 'spouse' ? .1 : relationship.type === 'enemy' ? -.03 : 0), -100, 100);
        if (relationship.memories.length > 12) { const old = relationship.memories.splice(0, relationship.memories.length - 12); if (old.some(m => m.impact >= 5) && !relationship.tags.includes('旧日恩情')) relationship.tags.push('旧日恩情'); if (old.some(m => m.impact <= -10) && !relationship.tags.includes('难忘旧怨')) relationship.tags.push('难忘旧怨'); }
      }
      for (const district of this.world.districts) {
        const members = new Set(this.state.citizens.filter(c => c.districtId === district.id).map(c => c.id));
        const links = this.runtime.links.filter(link => members.has(link.from));
        const safety = this.state.districts.find(d => d.id === district.id)!.safety;
        for (const link of links) { link.affection = clamp(link.affection + (safety >= 70 ? .015 : -.08), -100, 100); link.trust = clamp(link.trust + (safety >= 70 ? .01 : -.05), -100, 100); }
        this.runtime.districtRelationMeans[district.id] = links.length ? links.reduce((n, link) => n + link.affection, 0) / links.length : 0;
      }
    }
    for (const relation of this.state.relationships) {
      this.initializeRelationshipStages(relation); const citizen = this.state.citizens.find(c => c.id === relation.npcId)!;
      if (relation.romanceStage === 'single' && !citizen.partnerId && !this.state.player.partnerId && relation.affection >= 50 && relation.trust >= 35 && relation.encounters >= 4 && this.romanceWillingness(relation, citizen) >= 50) { this.setRomanceStage(relation, 'crush'); if (!relation.tags.includes('心生爱慕')) relation.tags.push('心生爱慕'); this.notice('relationship', `${citizen.name}开始暗恋你；是否回应由双方决定。`, citizen.districtId); }
      if (relation.romanceStage === 'pursuit') relation.consent = this.romanceWillingness(relation, citizen) >= 55;
      if (relation.romanceStage === 'married' && this.runtime.relationshipClock - (relation.romanceSince ?? this.runtime.relationshipClock) >= 240 - 1e-7) { this.setRomanceStage(relation, 'family'); if (!relation.tags.includes('共同生活')) relation.tags.push('共同生活'); this.notice('relationship', `${citizen.name}与你进入婚后共同生活，日常相处仍会影响信任。`); }
      this.updateHostility(relation);
      const rank = this.hostilityRank(relation);
      if (rank >= 3 && this.state.extension?.actorProfiles[citizen.id]?.alive !== false && distance(citizen.position, this.state.player.position) < 100 && this.runtime.relationshipClock + 1e-7 >= (this.runtime.hostileAt[citizen.id] ?? ((relation.hostilitySince ?? this.runtime.relationshipClock) + 180))) {
        this.runtime.hostileAt[citizen.id] = this.runtime.relationshipClock + 180;
        if (rank === 3) { this.state.player.reputation = Math.max(-100, this.state.player.reputation - .3); this.notice('hostility', `${citizen.name}因旧怨在社区散布流言，声望受到影响。`, citizen.districtId); }
        else if (this.state.crimes.filter(c => c.districtId === citizen.districtId && c.status !== 'resolved').length < 5) { const crime: Crime = { id: `crime-${++this.runtime.crimeId}`, districtId: citizen.districtId, position: copy(citizen.position), severity: rank === 5 ? 3 : 2, status: 'open', responseAt: 0 }; this.state.crimes.push(crime); const district = this.state.districts.find(d => d.id === citizen.districtId)!; district.crimeCount++; district.safety = clamp(district.safety - crime.severity); this.notice('hostility', `${citizen.name}的敌对行为升级为破坏事件，真实巡警将响应现场。`, citizen.districtId); }
      }
    }
    if (this.state.events.length > 100) this.state.events.splice(0, this.state.events.length - 100);
  }
  private notice(type: string, text: string, districtId?: string) { this.state.events.push({ id: ++this.runtime.eventId, tick: this.state.tick, type, text, ...(districtId ? { districtId } : {}) }); if (this.state.events.length > 100) this.state.events.shift(); }
  isNearBuilding(building: Building, position: Vec3 = this.state.player.position, doorRadius = 32): boolean {
    if (!this.validPosition(position)) return false;
    const floorHeight = building.height / Math.max(1, building.floors), floor = Math.floor((position.y - building.position.y + .01) / floorHeight);
    if (floor === 0 && distance(position, building.door) <= doorRadius) return true;
    if (floor < -(building.basements ?? 0) || floor >= building.floors) return false;
    const dx = position.x - building.position.x, dz = position.z - building.position.z;
    const x = dx * Math.cos(building.rotation) + dz * Math.sin(building.rotation), z = -dx * Math.sin(building.rotation) + dz * Math.cos(building.rotation);
    const dimensions = getFloorDimensions(building, floor);
    return Math.abs(x) <= dimensions.width / 2 && Math.abs(z) <= dimensions.depth / 2 && position.y >= building.position.y - floorHeight * (building.basements ?? 0) - .5 && position.y <= building.position.y + building.height + .5;
  }
  private floorAccessible(building: Building): boolean { const floorHeight = building.height / Math.max(1, building.floors); const floor = Math.floor((this.state.player.position.y - building.position.y + .01) / floorHeight); return canAccessFloor(building, floor, this.state.player); }
  private validPosition(p: unknown): p is Vec3 { if (!p || typeof p !== 'object') return false; const v = p as Vec3; const limit = Math.max(10000, this.world.size * 3); return finite(v.x) && finite(v.y) && finite(v.z) && Math.abs(v.x) <= limit && Math.abs(v.z) <= limit && v.y >= -1000 && v.y <= limit; }
  private buildingNear(targetId: string | undefined, kinds: string[]): Building | null {
    const explicitShop = this.state.shops.find(s => s.id === targetId);
    const explicit = targetId ? this.buildings.get(explicitShop?.buildingId ?? targetId) : undefined;
    if (targetId && !explicit) return null;
    const matches = (b: Building) => kinds.includes(b.kind) || !!b.facility && kinds.includes(b.facility);
    const candidates = explicit ? [explicit] : this.world.buildings.filter(matches);
    return candidates.filter(b => matches(b) && this.isNearBuilding(b) && this.floorAccessible(b)).sort((a, b) => Number(this.isNearBuilding(b, this.state.player.position, 0)) - Number(this.isNearBuilding(a, this.state.player.position, 0)) || distance(this.state.player.position, a.door) - distance(this.state.player.position, b.door))[0] ?? null;
  }
  private relation(npc: Citizen) {
    let relation = this.state.relationships.find(r => r.npcId === npc.id);
    if (!relation) { const impression = this.runtime.impressions[npc.id]; relation = { npcId: npc.id, affection: impression?.affection ?? 0, trust: impression?.trust ?? 0, type: 'stranger', encounters: 0, memories: [], tags: [] }; this.state.relationships.push(relation); }
    this.initializeRelationshipStages(relation); return relation;
  }
  private romanceStage(relation: Relationship): NonNullable<Relationship['romanceStage']> { return relation.romanceStage ?? (relation.type === 'spouse' ? 'married' : relation.type === 'lover' ? 'dating' : 'single'); }
  private playerOwnsShop(shop: Shop): boolean { const company = this.state.extension?.companies.find(c => c.buildingId === shop.buildingId); return company ? (company.shareholders.player ?? 0) > company.shares / 2 : this.runtime.playerBusinesses.includes(shop.id); }
  private hostilityRank(relation: Relationship): number { if (relation.hostilityStage) return HOSTILITY_STAGES.indexOf(relation.hostilityStage); const conflicts = relation.conflicts ?? relation.memories.filter(m => m.impact <= -20).length; if (relation.type === 'enemy') return relation.affection <= -90 && conflicts >= 5 ? 5 : 4; if (relation.type === 'foe') return 3; if (relation.type === 'rival') return 2; return relation.affection <= -90 && relation.trust <= -80 && conflicts >= 5 ? 5 : relation.affection <= -70 && conflicts >= 4 ? 4 : relation.affection <= -45 && conflicts >= 3 ? 3 : relation.affection <= -25 && conflicts >= 2 ? 2 : relation.affection < -5 ? 1 : 0; }
  private initializeRelationshipStages(relation: Relationship): void {
    relation.romanceStage ??= this.romanceStage(relation); relation.hostilityStage ??= HOSTILITY_STAGES[this.hostilityRank(relation)]; relation.romanceSince ??= this.runtime.relationshipClock; relation.hostilitySince ??= this.runtime.relationshipClock;
    relation.conflicts ??= relation.memories.filter(m => m.impact <= -20).length; relation.reconciliations ??= 0; relation.consent ??= ['dating', 'engaged', 'married', 'family'].includes(relation.romanceStage);
  }
  private romanceWillingness(relation: Relationship, citizen: Citizen): number {
    const profile = this.state.extension?.actorProfiles[citizen.id], mood = profile?.mood ?? 65, stress = profile?.stress ?? 20;
    if (profile?.alive === false || (profile?.age ?? 20) < 18 || citizen.state === 'sleeping' || citizen.partnerId && citizen.partnerId !== 'player' || this.state.player.partnerId && this.state.player.partnerId !== citizen.id || this.hostilityRank(relation) >= 2) return -100;
    return relation.affection * .45 + relation.trust * .35 + mood * .2 + this.state.player.reputation * .1 - stress * .1 - (relation.tags.includes('伤害亲友') ? 10 : 0);
  }
  private setRomanceStage(relation: Relationship, stage: NonNullable<Relationship['romanceStage']>): void { relation.romanceStage = stage; relation.romanceSince = this.runtime.relationshipClock; }
  private updateHostility(relation: Relationship, repair = false): void {
    const oldRank = this.hostilityRank(relation), conflicts = relation.conflicts ?? 0;
    const desired = relation.affection <= -90 && relation.trust <= -80 && conflicts >= 5 ? 5 : relation.affection <= -70 && relation.trust <= -60 && conflicts >= 4 ? 4 : relation.affection <= -45 && relation.trust <= -35 && conflicts >= 3 ? 3 : relation.affection <= -25 && relation.trust <= -15 && conflicts >= 2 ? 2 : relation.affection < -5 ? 1 : 0;
    const rank = oldRank >= 2 && desired < oldRank ? repair ? Math.max(desired, oldRank - 1) : oldRank : desired;
    relation.hostilityStage = HOSTILITY_STAGES[rank];
    if (rank && !oldRank) relation.hostilitySince = this.runtime.relationshipClock;
    if (rank >= 2) relation.consent = false;
    if (rank >= 3 && ['dating', 'engaged'].includes(this.romanceStage(relation))) {
      const npc = this.state.citizens.find(c => c.id === relation.npcId)!; if (this.state.player.partnerId === npc.id) this.state.player.partnerId = null; if (npc.partnerId === 'player') npc.partnerId = null; this.setRomanceStage(relation, 'single'); if (!relation.tags.includes('恋情破裂')) relation.tags.push('恋情破裂');
    }
    if (!['married', 'family'].includes(this.romanceStage(relation))) relation.type = rank >= 4 ? 'enemy' : rank === 3 ? 'foe' : rank === 2 ? 'rival' : ['dating', 'engaged'].includes(this.romanceStage(relation)) ? 'lover' : relation.affection >= 65 && relation.encounters >= 7 ? 'closeFriend' : relation.affection >= 30 && relation.encounters >= 3 ? 'friend' : relation.encounters ? 'acquaintance' : 'stranger';
  }
  private remember(relation: Relationship, text: string, impact: number, trust: number) {
    relation.affection = clamp(relation.affection + impact, -100, 100); relation.trust = clamp(relation.trust + trust, -100, 100); relation.encounters++;
    relation.memories.push({ tick: this.state.tick, text, impact });
    if (relation.memories.length > 12) { const old = relation.memories.shift()!; const tag = old.impact >= 5 ? '旧日恩情' : old.impact <= -10 ? '难忘旧怨' : '共同往事'; if (!relation.tags.includes(tag)) relation.tags.push(tag); }
    this.updateHostility(relation);
    this.bus.emit({ type: 'relationship-change', citizenId: relation.npcId, amount: impact });
  }
  command(command: Command): CommandResult {
    const fail = (message: string): CommandResult => ({ ok: false, message });
    const success = (message: string): CommandResult => { this.notice(command.type, message); return { ok: true, message }; };
    if (!command || typeof command !== 'object' || typeof command.type !== 'string') return fail('无法识别操作。');
    if (command.value !== undefined && !finite(command.value)) return fail('参数必须是有限数字。');
    if (command.position !== undefined && !this.validPosition(command.position)) return fail('位置超出世界范围。');
    if (!['pause', 'speed', 'setTime'].includes(command.type) && this.state.extension?.actorProfiles.player?.alive === false) return fail('角色生命已结束，无法继续行动；可调节时间或读取存档。');
    for (const handler of this.commandHandlers) { const result = handler(command); if (result) return result; }
    const p = this.state.player;
    if (command.type === 'pause') { if (command.value !== undefined && ![0, 1].includes(command.value)) return fail('暂停参数为0或1。'); this.state.paused = command.value === undefined ? !this.state.paused : command.value === 1; return success(this.state.paused ? '时间已暂停。' : '城市继续运行。'); }
    if (command.type === 'speed') { if (command.value === undefined || command.value < .25 || command.value > 16) return fail('时间倍率范围为0.25至16。'); this.state.speed = command.value; return success(`时间倍率：${command.value}。`); }
    if (command.type === 'setTime') {
      if (command.value === undefined || command.value < 0 || command.value > 24) return fail('时刻范围为0至24。');
      this.state.hour = command.value % 24;
      this.runtime.weatherAt = this.now + 180; this.runtime.crimeAt = this.now + 35; this.runtime.commerceAt = this.now; this.runtime.financeAt = this.now + 60; this.runtime.payrollAt = (this.state.day + (this.state.hour >= 17 ? 1 : 0)) * 1440 + 17 * 60;
      this.runtime.decisionAt = {}; this.runtime.activities = {};
      for (const c of this.state.citizens) { c.destinationId = null; c.route = []; c.routeIndex = 0; }
      this.updateSignals();
      for (const v of this.state.vehicles) v.nextDeparture = this.now + (v.kind === 'flight' ? 20 : 2);
      return success(`已调至${this.state.hour.toFixed(1)}时，作息与班次已重新排程。`);
    }
    if (command.type === 'purchase') {
      const building = this.buildingNear(command.targetId, ['market', 'workshop', 'farm', 'dock']); if (!building) return fail('请到商铺入口附近购物。');
      const shop = this.state.shops.find(s => s.buildingId === building.id); if (!shop) return fail('这是公共科研或政务设施，不经营零售商品。');
      const quantity = command.value ?? 1; if (!Number.isInteger(quantity) || quantity < 1 || quantity > 30) return fail('购买数量须为1至30的整数。');
      if (!shop.open || shop.inventory < quantity) return fail('商铺休业或库存不足。');
      const cost = shop.price * quantity; if (p.money < cost) return fail('现金不足。');
      p.money -= cost; shop.inventory -= quantity; shop.revenue += cost; shop.profit += cost * (1 - this.state.taxRate) - quantity * 4; shop.customers += quantity; p.inventory.food = (p.inventory.food ?? 0) + quantity; p.needs.hunger = clamp(p.needs.hunger + 25); this.bus.emit({ type: 'sale', amount: cost, districtId: shop.districtId }); return success(`在${building.name}购买${quantity}份食物，花费${cost.toFixed(1)}云币。`);
    }
    if (command.type === 'work') {
      const roleKinds: Record<Role, string[]> = { traveler: ['market', 'workshop', 'farm', 'dock'], police: ['police'], soldier: ['police', 'starport'], teacher: ['school'], driver: ['station', 'airport', 'starport', 'dock'], merchant: ['market', 'workshop', 'farm'], mayor: ['hall', 'core'], scientist: ['school', 'core', 'workshop', 'data', 'energy'], official: ['hall', 'core', 'administration', 'emergency', 'embassy', 'archives', 'energy'], council: ['hall', 'core', 'council', 'administration'] };
      const permitted = ROLES.filter(role => this.hasIdentity(role)); const building = this.buildingNear(command.targetId, permitted.flatMap(role => roleKinds[role])); if (!building) return fail('请到与你的职业对应的工作地点入口。');
      const facilities: Record<string, Role[]> = { mayor: ['mayor', 'official', 'council', 'scientist'], council: ['council', 'official', 'mayor'], administration: ['official', 'council', 'mayor'], data: ['scientist', 'official', 'mayor'], energy: ['driver', 'scientist', 'official', 'mayor'], emergency: ['police', 'soldier', 'official', 'mayor'], embassy: ['official', 'council', 'mayor'], archives: ['teacher', 'scientist', 'official', 'mayor'], treasury: ['official', 'mayor'] };
      const canWork = (role: Role) => (roleKinds[role].includes(building.kind) || !!building.facility && roleKinds[role].includes(building.facility)) && (!building.facility || (facilities[building.facility] ?? []).includes(role));
      if (!permitted.some(canWork)) return fail('该政务或科研设施需要对应职业资质，公共参观权限不等于岗位权限。');
      if (this.state.hour < 6 || this.state.hour >= 21) return fail('现在不在日间工作时段。');
      if (this.now - this.runtime.workAt < 60 - 1e-7) return fail('这班工作尚未结算完，请等候一小时。');
      if (p.needs.fatigue < 15 || p.needs.hunger < 12) return fail('请先休息和进食。');
      const workRole = canWork(p.role) ? p.role : permitted.find(canWork)!; const wage = workRole === 'traveler' ? 35 : workRole === 'mayor' ? 95 : 62;
      const shop = this.state.shops.find(s => s.buildingId === building.id); if (!shop && this.state.treasury < wage) return fail('公共雇主本班预算不足，请等待财政恢复后再工作。');
      this.runtime.workAt = this.now; const net = wage * (1 - this.state.taxRate); p.money += net; this.runtime.taxes += wage - net; p.experience++; p.reputation += .8; p.needs.fatigue = clamp(p.needs.fatigue - 12); p.needs.hunger = clamp(p.needs.hunger - 7);
      if (shop) { shop.inventory += 6; shop.profit -= wage; } else this.state.treasury -= wage;
      if (workRole === 'police' || workRole === 'soldier') { const district = this.state.districts.find(d => d.id === building.districtId)!; district.safety = clamp(district.safety + 1); }
      if (workRole === 'teacher') this.state.support = clamp(this.state.support + .2);
      return success(`完成${building.name}的一班工作，净薪酬${net.toFixed(1)}云币，经验提升。`);
    }
    if (command.type === 'rest') {
      const building = this.buildingNear(command.targetId, ['pavilion', 'clinic', 'station', 'home']);
      const homeNear = building?.id === p.homeId;
      if (!building || building.kind === 'home' && !homeNear) return fail('请到已租住所、亭子、站点或诊所休息。');
      if (this.now - this.runtime.restAt < 20 - 1e-7) return fail('刚刚已休息过，请稍后再休息。');
      const cost = homeNear ? 0 : building.kind === 'clinic' ? 15 : 5; if (p.money < cost) return fail('休憩费用不足。');
      p.money -= cost; p.needs.fatigue = clamp(p.needs.fatigue + (homeNear ? 38 : 23)); p.needs.fun = clamp(p.needs.fun + 12); this.runtime.restAt = this.now; return success(`在${building.name}休息，体力恢复。`);
    }
    if (command.type === 'rent') {
      const building = this.buildingNear(command.targetId, ['home']); if (!building) return fail('请到住宅门口办理租住。'); if (p.homeId === building.id) return fail('你已租住这里。'); if (p.money < 80) return fail('首期租金需要80云币。'); p.money -= 80; p.homeId = building.id; p.reputation += 1; return success(`租住${building.name}，可在此休息和改造房间。`);
    }
    if (['deposit', 'withdraw', 'loan', 'repay', 'invest'].includes(command.type)) {
      const building = this.buildingNear(command.targetId, ['bank']); if (!building) return fail('请到钱庄入口办理金融业务。');
      const amount = command.value ?? 100; if (!finite(amount) || amount <= 0 || amount > 1e6) return fail('金额须大于0且不超过一百万。');
      if (command.type === 'deposit') { if (p.money < amount) return fail('现金不足。'); p.money -= amount; this.state.bankBalance += amount; }
      if (command.type === 'withdraw') { if (this.state.bankBalance < amount) return fail('存款不足。'); this.state.bankBalance -= amount; p.money += amount; }
      if (command.type === 'loan') { const credit = 300 + p.reputation * 20 + p.experience * 30; if (this.state.loan + amount > credit) return fail(`贷款超过信用额度${credit.toFixed(0)}。`); this.state.loan += amount; p.money += amount; }
      if (command.type === 'repay') { if (amount > this.state.loan || amount > p.money) return fail('偿还金额超过贷款或现金。'); this.state.loan -= amount; p.money -= amount; p.reputation += .2; }
      if (command.type === 'invest') { if (p.money < amount) return fail('投资现金不足。'); p.money -= amount; this.runtime.investment += amount; p.inventory.investment = this.runtime.investment; }
      return success(`${building.name}已办理${command.type}，金额${amount.toFixed(1)}云币。`);
    }
    if (command.type === 'business') {
      const building = this.buildingNear(command.targetId, ['market', 'workshop', 'farm', 'dock']); if (!building) return fail('请到商业设施入口洽谈经营。'); if (!this.hasIdentity('merchant')) return fail('取得商人经营资格后可承包店铺。');
      const shop = this.state.shops.find(s => s.buildingId === building.id); if (!shop) return fail('公共科研与政务设施不能作为私营商铺承包。'); if (this.state.extension?.companies.some(company => company.buildingId === building.id)) return fail('此商铺已公司化，请通过股权交易取得控制权。'); if (this.runtime.playerBusinesses.includes(shop.id)) return fail('这间商铺已由你经营。'); if (p.money < 300) return fail('承包资金需要300云币。'); p.money -= 300; this.runtime.playerBusinesses.push(shop.id); shop.inventory += 35; p.inventory.businesses = this.runtime.playerBusinesses.length; p.inventory[`business:${building.id}`] = 1; return success(`获得${building.name}经营权，库存已投入，实际在册雇员继续工作，盈利将按时分红。`);
    }
    if (command.type === 'exam') {
      if (command.targetId === 'study') { const school = this.buildingNear(undefined, ['school']); if (!school) return fail('请到学堂学习。'); if (p.money < 40) return fail('学习费用需要40云币。'); p.money -= 40; p.education++; p.experience++; return success('完成学堂课程：教育与经验各提升1，可报考职业资格。'); }
      const role = command.targetId && ROLES.includes(command.targetId as Role) ? command.targetId as Role : command.value === undefined ? 'teacher' : ROLES[command.value];
      if (!role || role === 'mayor') return fail('市长须通过议事堂选举，其余身份须报考对应职业。');
      if (role === 'traveler') { p.role = role; return success('恢复旅行者身份。'); }
      const kinds: Record<string, string[]> = { police: ['police'], soldier: ['police'], teacher: ['school'], driver: ['station', 'airport'], merchant: ['market'], scientist: ['school', 'core'], official: ['hall', 'core'], council: ['hall', 'core'] };
      if (!this.buildingNear(undefined, kinds[role])) return fail('请到对应职业机构的入口考试。');
      const requirement = ['soldier', 'official', 'council'].includes(role) ? 2 : role === 'scientist' ? 3 : 1; if (p.education < requirement) return fail(`请先在学堂完成${requirement}门课程。`); if (this.hasIdentity(role)) { p.role = role; return success('已切换为持有的职业身份，原身份与权限保留。'); } if (p.money < 80) return fail('职业考试报名费需要80云币。');
      p.money -= 80; this.addIdentity(role); p.experience++; p.reputation += 2; return success(`通过${role}职业考试，身份职责与权限已改变。`);
    }
    if (command.type === 'election') {
      if (!this.buildingNear(command.targetId, ['hall', 'core'])) return fail('请到议事堂登记参选。'); if (this.hasIdentity('mayor') || this.runtime.campaign) return fail('已当选或正在等待计票。'); if (p.education < 2 || p.experience < 4 || p.reputation < 8) return fail('候选资格：教育2、经验4、声望8。'); if (p.money < 120) return fail('竞选登记需要120云币。');
      const affection = this.state.relationships.length ? this.state.relationships.reduce((n, r) => n + r.affection, 0) / this.state.relationships.length : 0; p.money -= 120; this.runtime.campaign = { countAt: this.now + 120, votes: clamp(this.state.support + p.reputation * .7 + affection * .1) }; return success('已登记竞选，两小时后公布真实民意计票结果。');
    }
    if (command.type === 'policy') {
      if (!this.hasIdentity('mayor')) return fail('仅当选市长可提交政策。'); if (!this.buildingNear(command.targetId, ['hall', 'core'])) return fail('请到议事堂提交政策。'); const taxRate = command.taxRate ?? this.state.taxRate, policeBudget = command.policeBudget ?? this.state.policeBudget;
      if (!finite(taxRate) || taxRate < 0 || taxRate > .3 || !finite(policeBudget) || policeBudget < 0 || policeBudget > 1) return fail('税率范围0至30%，警务预算范围0至100%。'); this.state.policyPending = { taxRate, policeBudget, applyAt: this.now + 120 }; return success('政策已送议会审议，两小时后生效；财政、治安和支持率将随之反馈。');
    }
    if (command.type === 'resolveCrime') {
      if (!['police', 'soldier'].some(role => this.hasIdentity(role as Role))) return fail('警察或士兵有权处理事件。'); const crime = this.state.crimes.find(c => c.id === command.targetId); if (!crime || crime.status === 'resolved') return fail('事件不存在或已经解决。'); if (distance(p.position, crime.position) > 40) return fail('请亲自前往事件现场。'); crime.status = 'resolved'; this.bus.emit({ type: 'crime-resolved', districtId: crime.districtId }); p.money += 18 * crime.severity; p.reputation += 3; p.experience++; return success('现场事件处理完成，警务履历与社区声望提升。');
    }
    if (['socialize', 'gift', 'court', 'propose', 'divorce', 'conflict', 'reconcile'].includes(command.type)) {
      const citizen = this.state.citizens.find(c => c.id === command.targetId); if (!citizen || distance(p.position, citizen.position) > 24) return fail('请走到对方身边交谈。');
      if (this.state.extension?.actorProfiles[citizen.id]?.alive === false) return fail('对方已经离世，无法交谈。');
      const existing = this.state.relationships.find(r => r.npcId === citizen.id);
      const currentRomance = existing ? this.romanceStage(existing) : 'single';
      const hostileRank = existing ? this.hostilityRank(existing) : 0;
      const elapsedRomance = this.runtime.relationshipClock - (existing?.romanceSince ?? this.runtime.relationshipClock);
      if (command.type === 'divorce') {
        if (p.partnerId !== citizen.id || !existing || !['married', 'family'].includes(currentRomance)) return fail('双方没有婚姻关系。');
        this.initializeRelationshipStages(existing); p.partnerId = null; citizen.partnerId = null; existing.type = 'acquaintance'; this.setRomanceStage(existing, 'single'); existing.consent = false; this.remember(existing, '解除婚姻，共同财产分割', -25, -15); return success('双方完成离婚登记，关系与记忆已改变。');
      }
      const reconcileCost = 15 + hostileRank * 10;
      if (command.type === 'reconcile') {
        if (!existing || !hostileRank) return fail('双方尚无需要调解的矛盾。');
        if (p.money < reconcileCost) return fail(`本阶段调解赔偿需要${reconcileCost}云币。`);
        if (this.runtime.relationshipClock - (this.runtime.relationshipAt[`reconcile:${citizen.id}`] ?? -10000) < 60 - 1e-7) return fail('请留出一小时观察赔偿后的实际行动，不能连续付钱洗去旧怨。');
        if (hostileRank >= 3 && this.runtime.relationshipClock - (existing.hostilitySince ?? this.runtime.relationshipClock) < 120 - 1e-7) return fail('重大冲突后至少两小时冷静期才能调解。');
      }
      if (command.type === 'gift' && (p.inventory.food ?? 0) < 1) return fail('请先在市集买一份食物作为礼物。');
      if ((command.type === 'court' || command.type === 'propose') && (citizen.partnerId && citizen.partnerId !== 'player' || p.partnerId && p.partnerId !== citizen.id)) return fail('对方或你已有伴侣，无法建立新的婚恋关系。');
      if (command.type === 'court') {
        if (['dating', 'engaged', 'married', 'family'].includes(currentRomance)) return fail('双方已有恋爱或婚姻关系，继续日常相处即可。');
        if (!existing || existing.affection < 55 || existing.trust < 35 || existing.encounters < 4) return fail('互相了解和信任还不够，先建立友谊。');
        if (currentRomance === 'pursuit' && (elapsedRomance < 60 - 1e-7 || existing.encounters < 6)) return fail('追求阶段须真实相处至少一小时、共六次互动，再确认双方意愿。');
        if (this.romanceWillingness(existing, citizen) < (currentRomance === 'pursuit' ? 55 : 50)) return fail('对方此时没有同意：情绪、已有伴侣、信任与亲友记忆都会影响意愿。');
      }
      if (command.type === 'propose') {
        if (!existing || !['dating', 'engaged'].includes(currentRomance) || existing.affection < 80 || existing.trust < 60 || existing.encounters < 8 || !p.homeId) return fail('求婚需要稳定恋情、好感80、信任60、共同经历8次与住所。');
        if (elapsedRomance < 120 - 1e-7) return fail(currentRomance === 'engaged' ? '订婚后至少两小时共同准备，再办理婚姻。' : '交往后至少两小时建立稳定关系，再向对方求婚。');
        if (this.romanceWillingness(existing, citizen) < 65) return fail('对方暂未同意婚约，请尊重其情绪与意愿。');
      }
      if (['socialize', 'gift'].includes(command.type) && hostileRank >= 2) return fail('严重旧怨尚未修复，对方拒绝闲谈和礼物，请先诚意调解。');
      if (['socialize', 'gift', 'conflict'].includes(command.type)) {
        const cooldown = command.type === 'conflict' ? 20 : 10;
        if (this.runtime.relationshipClock - (this.runtime.relationshipAt[citizen.id] ?? -10000) < cooldown - 1e-7) return fail('刚刚已交流过，请给对方时间回应。');
      }
      const relation = this.relation(citizen);
      if (command.type === 'socialize') { this.remember(relation, '街巷相谈', 6, 5); p.needs.social = clamp(p.needs.social + 12); citizen.needs.social = clamp(citizen.needs.social + 10); this.runtime.relationshipAt[citizen.id] = this.runtime.relationshipClock; p.reputation += .2; }
      if (command.type === 'gift') { p.inventory.food--; this.remember(relation, '赠送食物', 12, 8); citizen.needs.hunger = clamp(citizen.needs.hunger + 20); this.runtime.relationshipAt[citizen.id] = this.runtime.relationshipClock; p.reputation += .5; }
      if (command.type === 'court') {
        relation.consent = true;
        if (currentRomance === 'pursuit') { this.setRomanceStage(relation, 'dating'); relation.type = 'lover'; p.partnerId = citizen.id; citizen.partnerId = 'player'; this.remember(relation, '经过相处，双方同意开始交往', 6, 5); }
        else { this.setRomanceStage(relation, 'pursuit'); this.remember(relation, '表达心意，对方同意进一步了解', 4, 2); }
      }
      if (command.type === 'propose') {
        relation.consent = true;
        if (currentRomance === 'engaged') { this.setRomanceStage(relation, 'married'); relation.type = 'spouse'; this.remember(relation, '双方同意办理婚姻，共同居住', 6, 7); p.reputation += 3; citizen.homeId = p.homeId!; p.money += citizen.money * .2; citizen.money *= .8; }
        else { this.setRomanceStage(relation, 'engaged'); this.remember(relation, '双方同意订婚，开始共同准备婚事', 6, 6); }
      }
      if (command.type === 'conflict') {
        relation.conflicts = (relation.conflicts ?? 0) + 1; relation.reconciliations = 0; relation.hostilitySince = this.runtime.relationshipClock; this.runtime.relationshipAt[citizen.id] = this.runtime.relationshipClock;
        this.remember(relation, '发生重大争执', -24, -20); p.reputation = Math.max(-100, p.reputation - 3); const district = this.state.districts.find(d => d.id === citizen.districtId)!; district.safety = clamp(district.safety - 1);
        if (this.hostilityRank(relation) >= 3 && !relation.tags.includes('重大冲突')) relation.tags.push('重大冲突'); if ((relation.conflicts ?? 0) >= 5 && !relation.tags.includes('持续伤害')) relation.tags.push('持续伤害');
      }
      if (command.type === 'reconcile') {
        p.money -= reconcileCost; citizen.money += reconcileCost; relation.reconciliations = (relation.reconciliations ?? 0) + 1; this.runtime.relationshipAt[`reconcile:${citizen.id}`] = this.runtime.relationshipClock;
        this.remember(relation, '诚意赔偿与和解，行动仍需时间验证', 14, 9);
        const elapsedConflict = this.runtime.relationshipClock - (relation.hostilitySince ?? this.runtime.relationshipClock);
        const canRepair = hostileRank <= 2 || hostileRank === 3 && (relation.reconciliations ?? 0) >= 2 || hostileRank >= 4 && elapsedConflict >= 1440 - 1e-7 && (relation.reconciliations ?? 0) >= 2 && relation.affection > -60 && relation.trust > -50;
        this.updateHostility(relation, canRepair); p.reputation += .4;
      }
      return success(`${citizen.name}记住了这次${command.type}，关系：${relation.type}，好感${relation.affection.toFixed(0)}。`);
    }
    if (command.type === 'ride' || command.type === 'drive') {
      const vehicle = this.state.vehicles.find(v => v.id === command.targetId); if (!vehicle || distance(p.position, vehicle.position) > 35) return fail('请到车辆或站点附近上车。'); if (p.vehicleId) return fail('请先离开当前载具。'); if (vehicle.state === 'moving') return fail('请等车辆进站停稳后上车。');
      if (vehicle.passengers >= this.passengerCapacity(vehicle)) return fail('载具已满员，请等下一班。');
      if (command.type === 'drive' && (!['driver', 'police', 'soldier'].some(role => this.hasIdentity(role as Role)) || vehicle.kind !== 'road' && !(this.hasIdentity('driver') && vehicle.kind === 'flight'))) return fail('需驾驶员或执勤人员资格，且载具须符合许可。');
      const cost = command.type === 'drive' ? 0 : vehicle.kind === 'flight' ? 45 : 4; if (p.money < cost) return fail('票款不足。'); p.money -= cost; if (cost) this.bus.emit({ type: 'transit-fare', amount: cost, citizenId: 'player', vehicleId: vehicle.id }); p.vehicleId = vehicle.id; vehicle.passengers++; p.position = copy(vehicle.position); p.inventory.driving = command.type === 'drive' ? 1 : 0; this.runtime.driving = { vehicleId: command.type === 'drive' ? vehicle.id : null, throttle: 0, turn: 0, brake: true, speed: 0 }; if (command.type === 'drive') vehicle.nextDeparture = this.now; return success(command.type === 'drive' ? '取得载具操作权：W加速、S减速、空格刹车、A/D选择路口方向，须遵守信号。' : '已登车，角色位置将随真实载具移动。');
    }
    if (command.type === 'leaveVehicle') {
      const vehicle = this.state.vehicles.find(v => v.id === p.vehicleId); if (!vehicle) return fail('当前未乘坐载具。');
      const node = this.nearestNode(vehicle.position); if (vehicle.state === 'moving' || distance(vehicle.position, node.position) > 45) return fail('请等候车辆抵达合法停靠点后下车。'); p.position = copy(node.position); p.vehicleId = null; p.inventory.driving = 0; this.runtime.driving = { vehicleId: null, throttle: 0, turn: 0, brake: true, speed: 0 }; vehicle.passengers = Math.max(0, vehicle.passengers - 1); return success(`已在${node.name}下车。`);
    }
    if (command.type === 'signal') {
      if (!['police', 'mayor'].some(role => this.hasIdentity(role as Role))) return fail('警察或市长可调度交通信号。'); const node = this.world.nodes.find(n => n.id === command.targetId) ?? this.nearestNode(p.position); if (distance(p.position, node.position) > 40) return fail('请到路口信号台附近。'); const value = command.value ?? 2; if (![0, 1, 2].includes(value)) return fail('信号值为0、1或2（自动）。'); if (value === 2) delete this.runtime.signalOverrides[node.id]; else this.runtime.signalOverrides[node.id] = value; this.updateSignals(); return success(`${node.name}信号已${value === 2 ? '恢复自动' : '调整绿灯方向'}。`);
    }
    if (command.type === 'energy') {
      if (!['mayor', 'driver', 'soldier', 'scientist', 'official'].some(role => this.hasIdentity(role as Role))) return fail('需要公共工程操作资格。'); if (!this.buildingNear(command.targetId, ['core', 'energy'])) return fail('请到瀑布能源核心维修。'); if (p.money < 100) return fail('维修材料需要100云币。'); if (this.now < this.runtime.energyBoostUntil) return fail('能源核心仍在维护增益期间。'); p.money -= 100; this.runtime.energyBoostUntil = this.now + 240; p.experience++; p.reputation += 2; return success('水能装置修复，未来四小时能源供应提升，交通与商铺随供电反馈。');
    }
    if (command.type === 'build' || command.type === 'demolish') {
      const building = this.buildingNear(command.targetId, ['home', 'market', 'workshop', 'farm', 'dock']); if (!building) return fail('请到有使用权的建筑入口附近改造。'); const company = this.state.extension?.companies.find(c => c.buildingId === building.id); const owned = p.homeId === building.id || (company ? (company.shareholders.player ?? 0) > company.shares / 2 : this.runtime.playerBusinesses.some(id => this.state.shops.find(s => s.id === id)?.buildingId === building.id)); if (!owned) return fail('仅能改造自己租住或经营的空间。');
      const requested = command.position ?? { x: p.position.x + .6, y: p.position.y + .1, z: p.position.z };
      const position = { x: Math.round(requested.x / .2) * .2, y: Math.round(requested.y / .2) * .2, z: Math.round(requested.z / .2) * .2 };
      if (distance(p.position, position) > 4 || !this.isNearBuilding(building, position, 12)) return fail('改造范围为本人4米内的所属房间或其入口附近。');
      const index = this.state.voxels.findIndex(v => distance(v.position, position) < .11);
      if (command.type === 'build') { if ((p.inventory.block ?? 0) < 1) return fail('体素材料不足。'); if (index !== -1) return fail('此格已有体素。'); if (this.state.voxels.length >= 4096) return fail('当前存档体素数量达到上限。'); p.inventory.block--; this.state.voxels.push({ id: `voxel-${++this.runtime.constructionId}`, position, color: '#8fcdc9' }); }
      else { if (index === -1) return fail('此格没有你放置的体素。'); this.state.voxels.splice(index, 1); p.inventory.block = (p.inventory.block ?? 0) + 1; }
      return success(command.type === 'build' ? '已在0.2米网格放置体素。' : '已拆除体素并回收材料。');
    }
    return fail('暂不支持此项操作。');
  }
  exportSave(): string {
    const routePool: Vec3[] = [], pointIds = new Map<string, number>();
    const citizens = this.state.citizens.map(c => ({ ...c, route: c.route?.map(point => { const key = `${point.x},${point.y},${point.z}`; let id = pointIds.get(key); if (id === undefined) { id = routePool.length; pointIds.set(key, id); routePool.push(point); } return id; }) }));
    return JSON.stringify({ format: 'yunshan-save', version: 1, worldSeed: this.world.seed, worldFingerprint: this.fingerprint, routeEncoding: 'pooled-v1', routePool, state: { ...this.state, citizens }, runtime: this.runtime });
  }
  importSave(json: string): CommandResult {
    try {
      if (typeof json !== 'string' || json.length > 8_000_000) throw new Error('存档大小超过8MB限制。');
      const data = JSON.parse(json) as Record<string, any>;
      let visited = 0;
      const safeTree = (value: unknown, depth = 0): void => { if (++visited > 2_000_000 || depth > 24) throw new Error('存档结构过于复杂。'); if (value && typeof value === 'object') { for (const [key, item] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('存档包含不安全字段。'); safeTree(item, depth + 1); } } };
      safeTree(data);
      const ensure = (value: unknown, label: string) => { if (!value) throw new Error(`无效存档字段：${label}。`); };
      const number = (n: unknown, min: number, max: number, label: string, integer = false) => ensure(finite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)), label);
      const string = (s: unknown, label: string, max = 240) => ensure(typeof s === 'string' && s.length <= max, label);
      const vec = (p: unknown, label: string) => ensure(this.validPosition(p), label);
      const array = (a: unknown, max: number, label: string): any[] => { ensure(Array.isArray(a) && a.length <= max, label); return a as any[]; };
      const unique = (values: any[], label: string) => ensure(new Set(values.map(v => v.id)).size === values.length, label);
      const needs = (n: any, label: string) => { ensure(n && typeof n === 'object', label); for (const key of ['hunger', 'fatigue', 'social', 'fun']) number(n[key], 0, 100, `${label}.${key}`); };
      const money = (n: unknown, label: string) => number(n, 0, 1e12, label);
      ensure(data && data.format === 'yunshan-save' && data.version === 1 && data.worldSeed === this.world.seed && data.worldFingerprint === this.fingerprint, '世界或格式版本不匹配');
      const s = data.state, r = data.runtime;
      ensure(s && r && typeof s === 'object' && typeof r === 'object', '状态或运行数据'); ensure(s.version === 1 && s.seed === this.world.seed, '状态版本');
      if (r.relationshipClock === undefined) r.relationshipClock = s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60;
      number(r.relationshipClock, 0, 1e12, 'relationship clock'); if (r.hostileAt === undefined) r.hostileAt = {};
      ensure(r.hostileAt && typeof r.hostileAt === 'object' && !Array.isArray(r.hostileAt), 'hostile timers');
      if (data.routeEncoding !== undefined) {
        ensure(data.routeEncoding === 'pooled-v1', 'route encoding');
        const pool = array(data.routePool, 32768, 'route pool'); for (const point of pool) vec(point, 'pooled route position');
        for (const citizen of array(s.citizens, 1024, 'encoded citizens')) if (citizen.route !== undefined) citizen.route = array(citizen.route, 1024, 'encoded route').map(index => { number(index, 0, pool.length - 1, 'route point index', true); return copy(pool[index]); });
      }
      number(s.tick, 0, 1e10, 'tick', true); number(s.day, 0, 1e8, 'day', true); ensure(finite(s.hour) && s.hour >= 0 && s.hour < 24, 'hour'); ensure(typeof s.paused === 'boolean', 'paused'); number(s.speed, .25, 16, 'speed'); ensure(['晴', '云', '雨', '雾'].includes(s.weather), 'weather'); number(s.visibility, 0, 1, 'visibility'); number(s.energy, 0, 100, 'energy'); money(s.treasury, 'treasury'); number(s.taxRate, 0, .3, 'taxRate'); number(s.policeBudget, 0, 1, 'policeBudget'); number(s.support, 0, 100, 'support'); money(s.bankBalance, 'bankBalance'); money(s.loan, 'loan'); money(s.gdp, 'gdp');
      ensure(JSON.stringify(s.lastSystemOrder) === JSON.stringify(ORDER) || Array.isArray(s.lastSystemOrder) && s.lastSystemOrder.length === 0 && s.tick === 0, 'system order');
      const districts = array(s.districts, this.world.districts.length, 'districts'); ensure(districts.length === this.world.districts.length, 'district count'); unique(districts, 'duplicate districts');
      const districtIds = new Set(this.world.districts.map(d => d.id));
      for (const d of districts) { ensure(districtIds.has(d.id), 'district id'); for (const key of ['energy', 'safety', 'prosperity', 'pollution']) number(d[key], 0, 100, `district.${key}`); number(d.employment, 0, 1, 'employment'); number(d.residents, 0, 1e8, 'residents'); number(d.crimeCount, 0, 1e10, 'crimeCount', true); ensure(['active', 'regional', 'statistical'].includes(d.tier), 'district tier'); }
      const expectedCitizenIds = new Set(this.state.citizens.map(c => c.id));
      const citizens = array(s.citizens, 1024, 'citizens'); ensure(citizens.length === expectedCitizenIds.size, 'citizen count'); unique(citizens, 'duplicate citizens');
      for (const c of citizens) { ensure(expectedCitizenIds.has(c.id) && districtIds.has(c.districtId), 'citizen identity'); ensure(this.buildings.has(c.homeId) && this.buildings.has(c.workId), 'citizen building'); vec(c.position, 'citizen position'); string(c.name, 'citizen name', 80); string(c.role, 'citizen role', 60); string(c.state, 'citizen state', 40); if (c.skills !== undefined) { ensure(c.skills && typeof c.skills === 'object' && Object.keys(c.skills).length <= 32, 'citizen skills'); for (const value of Object.values(c.skills)) number(value, 0, 100, 'citizen skill'); } if (c.education !== undefined) number(c.education, 0, 10000, 'citizen education'); for (const tag of array(c.socialIdentities ?? [], 32, 'social identities')) string(tag, 'social identity', 100); for (const tag of array(c.historyTags ?? [], 32, 'history tags')) string(tag, 'history tag', 100); ensure(c.destinationId === null || this.buildings.has(c.destinationId), 'destination'); money(c.money, 'citizen money'); needs(c.needs, 'citizen needs'); ensure(['active', 'regional', 'statistical'].includes(c.tier), 'citizen tier'); if (c.route !== undefined) for (const point of array(c.route, 1024, 'route')) vec(point, 'route position'); if (c.routeIndex !== undefined) number(c.routeIndex, 0, c.route?.length ?? 0, 'routeIndex', true); ensure(c.partnerId == null || c.partnerId === 'player' || expectedCitizenIds.has(c.partnerId), 'citizen partner'); }
      const expectedVehicleIds = new Set(this.state.vehicles.map(v => v.id)); const vehicles = array(s.vehicles, 2048, 'vehicles'); ensure(vehicles.length === expectedVehicleIds.size, 'vehicle count'); unique(vehicles, 'duplicate vehicles');
      for (const v of vehicles) { ensure(expectedVehicleIds.has(v.id), 'vehicle identity'); const edge = this.edges.get(v.edgeId); ensure(edge && edge.mode === v.kind, 'vehicle edge'); vec(v.position, 'vehicle position'); number(v.progress, 0, 1, 'progress'); ensure(v.direction === 1 || v.direction === -1, 'direction'); number(v.speed, 0, 2000, 'vehicle speed'); string(v.state, 'vehicle state', 40); number(v.passengers, 0, 5000, 'passengers', true); number(v.cargo, 0, 10000, 'cargo'); number(v.nextDeparture, -10000, 1e12, 'departure'); }
      const shops = array(s.shops, 512, 'shops'); ensure(shops.length === this.state.shops.length, 'shop count'); unique(shops, 'duplicate shops');
      const shopIds = new Set(this.state.shops.map(shop => shop.id)); for (const shop of shops) { ensure(shopIds.has(shop.id) && this.buildings.has(shop.buildingId) && districtIds.has(shop.districtId), 'shop identity'); number(shop.inventory, 0, 10000, 'inventory'); number(shop.price, 0, 1e5, 'price'); money(shop.revenue, 'revenue'); number(shop.profit, -1e12, 1e12, 'profit'); number(shop.customers, 0, 100000, 'customers'); number(shop.employees, 0, 10000, 'employees', true); ensure(typeof shop.open === 'boolean', 'shop open'); }
      const p = s.player; ensure(p && ROLES.includes(p.role), 'player role'); if (p.identities !== undefined) { const identities = array(p.identities, ROLES.length, 'identities'); ensure(identities.every(role => ROLES.includes(role)) && new Set(identities).size === identities.length, 'player identities'); } vec(p.position, 'player position'); money(p.money, 'player money'); number(p.reputation, -100, 1e8, 'reputation'); needs(p.needs, 'player needs'); ensure(p.homeId === null || this.buildings.get(p.homeId)?.kind === 'home', 'player home'); number(p.education, 0, 1e8, 'education', true); number(p.experience, 0, 1e8, 'experience', true); ensure(p.partnerId === null || expectedCitizenIds.has(p.partnerId), 'player partner'); ensure(p.vehicleId === null || expectedVehicleIds.has(p.vehicleId), 'player vehicle'); ensure(p.inventory && typeof p.inventory === 'object' && !Array.isArray(p.inventory) && Object.keys(p.inventory).length <= 128, 'player inventory'); for (const [key, value] of Object.entries(p.inventory)) { string(key, 'inventory key', 80); money(value, `inventory.${key}`); }
      const relationships = array(s.relationships, 1024, 'relationships'); ensure(new Set(relationships.map(v => v.npcId)).size === relationships.length, 'duplicate relationships'); for (const relation of relationships) { ensure(expectedCitizenIds.has(relation.npcId), 'relationship citizen'); number(relation.affection, -100, 100, 'affection'); number(relation.trust, -100, 100, 'trust'); string(relation.type, 'relationship type', 40); number(relation.encounters, 0, 1e8, 'encounters', true); for (const memory of array(relation.memories, 12, 'memories')) { number(memory.tick, 0, s.tick, 'memory tick', true); string(memory.text, 'memory text', 240); number(memory.impact, -100, 100, 'memory impact'); } for (const tag of array(relation.tags, 32, 'tags')) string(tag, 'tag', 100); }
      for (const relation of relationships) {
        if (relation.romanceStage !== undefined) ensure(ROMANCE_STAGES.includes(relation.romanceStage), 'romance stage');
        if (relation.hostilityStage !== undefined) ensure(HOSTILITY_STAGES.includes(relation.hostilityStage), 'hostility stage');
        if (relation.romanceSince !== undefined) number(relation.romanceSince, 0, r.relationshipClock, 'romance time');
        if (relation.hostilitySince !== undefined) number(relation.hostilitySince, 0, r.relationshipClock, 'hostility time');
        if (relation.conflicts !== undefined) number(relation.conflicts, 0, 1e8, 'conflicts', true);
        if (relation.reconciliations !== undefined) number(relation.reconciliations, 0, 1e8, 'reconciliations', true);
        if (relation.consent !== undefined) ensure(typeof relation.consent === 'boolean', 'relationship consent');
        if (['dating', 'engaged', 'married', 'family'].includes(relation.romanceStage)) { ensure(p.partnerId === relation.npcId && citizens.find(c => c.id === relation.npcId)?.partnerId === 'player', 'mutual partner'); ensure(['dating', 'engaged'].includes(relation.romanceStage) ? relation.type === 'lover' : relation.type === 'spouse', 'romance relationship type'); }
      }
      const crimes = array(s.crimes, 200, 'crimes'); unique(crimes, 'duplicate crimes'); for (const crime of crimes) { string(crime.id, 'crime id', 100); ensure(districtIds.has(crime.districtId), 'crime district'); vec(crime.position, 'crime position'); number(crime.severity, 1, 10, 'severity'); ensure(['open', 'responding', 'resolved'].includes(crime.status), 'crime status'); number(crime.responseAt, 0, 1e12, 'responseAt'); }
      let lastId = -1; for (const event of array(s.events, 100, 'events')) { number(event.id, 1, 1e12, 'event id', true); ensure(event.id > lastId, 'event ordering'); lastId = event.id; number(event.tick, 0, s.tick, 'event tick', true); string(event.type, 'event type', 60); string(event.text, 'event text', 1000); ensure(event.districtId === undefined || districtIds.has(event.districtId), 'event district'); }
      ensure(s.metrics && typeof s.metrics === 'object', 'metrics'); for (const key of ['trades', 'commutes', 'crimesResolved', 'freight', 'flights']) money(s.metrics[key], `metrics.${key}`);
      if (s.policyPending !== undefined) { number(s.policyPending.taxRate, 0, .3, 'pending tax'); number(s.policyPending.policeBudget, 0, 1, 'pending budget'); number(s.policyPending.applyAt, 0, 1e12, 'pending time'); }
      const voxels = array(s.voxels, 4096, 'voxels'); unique(voxels, 'duplicate voxels'); for (const voxel of voxels) { string(voxel.id, 'voxel id', 80); vec(voxel.position, 'voxel position'); ensure(/^#[0-9a-fA-F]{6}$/.test(voxel.color), 'voxel color'); }
      number(r.rng, 1, 4294967295, 'rng', true); number(r.accumulator, 0, TICK_SECONDS + 1e-9, 'accumulator'); ensure(r.accumulator < TICK_SECONDS, 'accumulator boundary');
      for (const key of ['weatherAt', 'crimeAt', 'payrollAt', 'commerceAt', 'financeAt', 'socialAt', 'workAt', 'studyAt', 'energyBoostUntil', 'restAt', 'lastInvestmentAt']) number(r[key], -10000, 1e12, key);
      for (const key of ['eventId', 'crimeId', 'constructionId']) number(r[key], 0, 1e12, key, true); ensure(r.eventId >= lastId, 'event counter'); vec(r.focus, 'focus'); ensure(['drone', 'walk', 'jet'].includes(r.mode), 'mode'); number(r.detail, .5, 2, 'detail'); money(r.taxes, 'taxes'); money(r.operatingCost, 'operatingCost'); money(r.investment, 'investment');
      for (const wage of array(r.wages, 1024, 'wages')) { ensure(expectedCitizenIds.has(wage.citizenId) && districtIds.has(wage.districtId), 'wage identity'); money(wage.amount, 'wage amount'); }
      ensure(r.freight && typeof r.freight === 'object' && !Array.isArray(r.freight), 'freight'); for (const [id, amount] of Object.entries(r.freight)) { ensure(districtIds.has(id), 'freight district'); money(amount, 'freight amount'); }
      for (const id of array(r.playerBusinesses, 512, 'businesses')) ensure(shopIds.has(id), 'business id'); ensure(new Set(r.playerBusinesses).size === r.playerBusinesses.length, 'duplicate businesses');
      ensure(r.campaign === null || r.campaign && finite(r.campaign.countAt) && r.campaign.countAt >= 0 && finite(r.campaign.votes) && r.campaign.votes >= 0 && r.campaign.votes <= 100, 'campaign');
      ensure(r.signalOverrides && typeof r.signalOverrides === 'object', 'signals'); for (const [id, value] of Object.entries(r.signalOverrides)) ensure(this.world.nodes.some(n => n.id === id) && (value === 0 || value === 1), 'signal override');
      ensure(r.relationshipAt && typeof r.relationshipAt === 'object', 'relationship timers'); for (const [id, at] of Object.entries(r.relationshipAt)) { ensure(expectedCitizenIds.has(id.startsWith('reconcile:') ? id.slice(10) : id), 'relationship timer id'); number(at, -10000, 1e12, 'relationship timer'); }
      if (s.signals !== undefined) { ensure(s.signals && typeof s.signals === 'object' && !Array.isArray(s.signals), 'signals'); for (const [id, phase] of Object.entries(s.signals)) ensure(this.world.nodes.some(n => n.id === id) && (phase === 0 || phase === 1), 'signal phase'); }
      ensure(r.riders && typeof r.riders === 'object' && !Array.isArray(r.riders), 'riders'); for (const [id, rider] of Object.entries(r.riders) as [string, any][]) ensure(expectedCitizenIds.has(id) && expectedVehicleIds.has(rider.vehicleId) && this.world.nodes.some(n => n.id === rider.stopNodeId) && (rider.arrived === undefined || typeof rider.arrived === 'boolean'), 'rider references');
      const socialLinks = array(r.links, 4096, 'social links'); const socialKeys = new Set<string>(); for (const link of socialLinks) { ensure(expectedCitizenIds.has(link.from) && expectedCitizenIds.has(link.to) && link.from !== link.to, 'social link identities'); const key = [link.from, link.to].sort().join(':'); ensure(!socialKeys.has(key), 'duplicate social link'); socialKeys.add(key); ensure(['family', 'coworker', 'neighbor', 'rival'].includes(link.type), 'social link type'); number(link.affection, -100, 100, 'social link affection'); number(link.trust, -100, 100, 'social link trust'); }
      ensure(r.impressions && typeof r.impressions === 'object' && !Array.isArray(r.impressions), 'social impressions'); for (const [id, impression] of Object.entries(r.impressions) as [string, any][]) { ensure(expectedCitizenIds.has(id), 'impression identity'); number(impression.affection, -100, 100, 'impression affection'); number(impression.trust, -100, 100, 'impression trust'); }
      ensure(r.districtRelationMeans && typeof r.districtRelationMeans === 'object', 'district relationship means'); for (const [id, mean] of Object.entries(r.districtRelationMeans)) { ensure(districtIds.has(id), 'district relationship identity'); number(mean, -100, 100, 'district relationship mean'); }
      ensure(r.decisionAt && typeof r.decisionAt === 'object' && !Array.isArray(r.decisionAt), 'decision timers'); for (const [id, at] of Object.entries(r.decisionAt)) { ensure(expectedCitizenIds.has(id), 'decision citizen'); number(at, 0, 1e12, 'decision time'); }
      ensure(r.activities && typeof r.activities === 'object' && !Array.isArray(r.activities), 'activities'); for (const [id, activity] of Object.entries(r.activities)) ensure(expectedCitizenIds.has(id) && ['rest', 'work', 'study', 'social', 'eat', 'heal'].includes(activity as string), 'activity');
      ensure(r.attendance && typeof r.attendance === 'object' && !Array.isArray(r.attendance), 'attendance'); for (const [id, minutes] of Object.entries(r.attendance)) { ensure(expectedCitizenIds.has(id), 'attendance citizen'); number(minutes, 0, 100000, 'attendance minutes'); }
      ensure(r.customers && typeof r.customers === 'object' && !Array.isArray(r.customers), 'customers'); for (const [id, shopId] of Object.entries(r.customers)) ensure(expectedCitizenIds.has(id) && shopIds.has(shopId as string), 'customer reference');
      ensure(r.driving && typeof r.driving === 'object' && (r.driving.vehicleId === null || expectedVehicleIds.has(r.driving.vehicleId) && r.driving.vehicleId === p.vehicleId), 'driving vehicle'); number(r.driving.throttle, -1, 1, 'driving throttle'); number(r.driving.turn, -1, 1, 'driving turn'); ensure(typeof r.driving.brake === 'boolean', 'driving brake'); number(r.driving.speed, 0, 200, 'driving speed');
      ensure(r.dispatches && typeof r.dispatches === 'object' && !Array.isArray(r.dispatches), 'dispatches'); for (const [id, dispatch] of Object.entries(r.dispatches) as [string, any][]) ensure(expectedCitizenIds.has(id) && crimes.some(c => c.id === dispatch.crimeId) && typeof dispatch.arrived === 'boolean', 'dispatch references');
      for (const [id, at] of Object.entries(r.hostileAt)) { ensure(expectedCitizenIds.has(id), 'hostile timer identity'); number(at, 0, 1e12, 'hostile timer'); }
      // Validation finishes before either live object is replaced: rejected saves are atomic.
      for (const validator of this.saveValidators) validator(s as SimState);
      const previousState = this.state, previousRuntime = this.runtime; this.state = s as VoxelState; this.runtime = r as Runtime; try { for (const hook of this.loadHooks) hook(); } catch (error) { this.state = previousState; this.runtime = previousRuntime; throw error; } this.employment.clear(); this.refreshWorkforce(); return { ok: true, message: '云山存档已恢复；时钟、随机数、班次与所有模拟实体继续原进程。' };
    } catch (error) { return { ok: false, message: `读档失败：${error instanceof Error ? error.message : '存档格式错误'}` }; }
  }
}
