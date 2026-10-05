import { installPowerGrid, gridBuildingSupplyRatio, gridVehicleSupplyRatio, gridPoweredWorkMinutes, validatePowerGridDefinition } from './simulation/power-grid';
import { runScheduledServiceProcurement } from './simulation/service-material-scheduling';
import { giftContactReason } from './simulation/gift-contact';
import { createBudgetAuthorityState, installBudgetAuthority, isSupplementalPurpose, authorizeCivicSupplementalBudget as authorizeNaturalSupplementalBudget, validateBudgetAuthority, type BudgetAuthorization, type LegacyBudgetAuthorization } from './simulation/budget-authority';
import { effectiveCityRuleset, initialCivicOfficials, readonlyCityEnablement, validateCityRulesetEnvelope, validateCivicOriginalOfficials, type CivicInitialProfession, type EffectiveRuleset, type SimulationOptions } from './simulation/city-ruleset';
import { createCivicHistory, freezeCivicHistory } from './simulation/civic-history';
import { CONTINUOUS_REFERENCE_COLLISION_POLICY, type ReferenceCollisionPolicy } from './simulation/reference-collision';
import { freightPickupAccess, ROAD_FOOD_PICKUP_POLICY, type FreightPickupPolicy } from './simulation/freight-access';
import { foodRetailDeliveryOffers, RoadFoodDeliveryRouter, ROAD_FOOD_DELIVERY_POLICY, type FoodDeliveryAccounts, type FreightDeliveryPolicy } from './simulation/freight-delivery';
import { chooseNearestTiedMeal, NEARBY_MEAL_ROUTE_POLICY, type MealRoutePolicy } from './simulation/meal-route';
import { parseSaveWithinResources } from './persistence/save-resource';
import { createCivicStaffingState, installCivicStaffing, civicStaffingOpportunities, civicStaffingNeedsContinuousPeople, prepareCivicHistoryArchive } from './simulation/civic-staffing';
import { validateSupplementalBudgetCrossReferences, validateSupplementalBudgetState } from './simulation/supplemental-budget';
import { NpcStairMotion, type NpcStairCursor } from './simulation/npc-stair-motion';
import { archivePoliceSupplies, consumePoliceSupply, createPoliceSupplies, policeSupplyReady, recordPolicePurchase, validatePoliceSupplies, type PoliceSupplies } from './simulation/police-supplies';
import { canAccessFloor, getFloorDimensions, getStairPosition } from './access';
import { FLOOR_PLAN_PROFILE, buildingLocalPosition, contains, findBuildingFloorPlanRoute, floorPlanSupport, blocksFloorPlanMovement, blocksFloorPlanReferenceMovement, getBuildingFloorPlan, getBuildingUsePoints } from './architecture-floor-plan';
import { blocksMarketCounter, marketCounters } from './site-fixtures';
import { installExtensions, researchTaskActorIds, isCanonicalDisaster, isCanonicalResearchCompletion } from './simulation/extensions';
import { installPower, powerBinding, powerHasCapacityRoom, powerRepairPoint, powerTaskActorIds, validateLegacyEnergyContract, validatePowerBudgetCrossReferences, type LegacyEnergyContract } from './simulation/power';
import { installShopLifecycle, shopLifecycleAllowsOperation, shopLifecycleAllowsNewPayroll, shopLifecycleAllowsSpaceUse, shopLifecycleReservedFunds, shopLifecycleBeforeBusinessTransfer, shopLifecycleOpportunities } from './simulation/shop_lifecycle';
import { AIRCRAFT_COMMANDS, installAviation } from './aviation';
import { installRoadNetwork, isRoadOpen, roadRevision, roadExitRoute, roadMovementAllowed, releaseRoadExitPermit } from './roads';
import { installRoadworks, roadworkTask, roadworkActorId, validateRoadworksBudgetCrossReferences } from './simulation/roadworks';
import { inspectBuildingAlteration, type BuildingAlterationPlan } from './simulation/building-alteration';
import { captureBlockedRoadIntent, roadIntentStillBlocked, installRoadDemands, type RoadBlockWitness } from './simulation/road-demands';
import { installFamily, isCloseKin, recordSchoolSelfStudy } from './simulation/family';
import { installCulture, type ServiceOrder } from './simulation/culture';
import { installFamilyEducation, familyEducationOpportunities, familyEducationTaskActorIds, observeFamilyEducationArrival } from './simulation/family-education';
import { clinicalServiceStationsAtPosition, clinicalTaskActorIds } from './simulation/clinical';
import { educationNeedsContinuousPeople, educationServiceStationsAtPosition, observePublicEducationArrival } from './simulation/education';
import { installGovernance } from './simulation/governance';
import { canRecordPublicTransfer, recordPublicTransfer, publicEmploymentJobs, publicEmploymentSite, publicEmploymentRevision, publicEmploymentTransfer, publicTransferAssignment, publicTransferReserved, validatePublicEmployment, TRANSFER_CONTRACT_LIMIT, type EmploymentTransfer, type PublicShift, type PublicLabor } from './simulation/public-employment';
import { installBanking } from './simulation/banking';
import { installJourneys } from './simulation/journeys';
import { installTrade, supplyConsignment, settleConsignmentSale, quoteConsignmentSale, tradeSignals, quoteSupply, recordOwnedStockPurchase } from './simulation/trade';
import { installPlayerLabor, type PlayerLaborEmployer, type PlayerLaborJob } from './simulation/player-labor';
import { homeRestBedOccupied, homeRestPointAt, homeRestPointBlockedByVoxels, homeRestPoints, installHomeRest } from './simulation/home-rest';
import { validatePublicDisinfectionBudgetCrossReferences } from './simulation/hygiene-public';
import { installHygiene, hygieneNeedsContinuousPeople } from './simulation/hygiene';
import { installPathology } from './simulation/pathology';
import { savedWorldFingerprint } from './persistence/world-layout';
import { decodeCitizenRoutes, encodeCitizenRoutes } from './persistence/route-encoding';
import type { Citizen, Command, CommandResult, Crime, NetworkEdge, Player, Relationship, Role, Shop, SimState, SimulationAPI, Vec3, Vehicle, ViewMode, WorldDefinition, Building, BuildingFunctionPoint } from './types';

const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'] as const;
const ROLES: Role[] = ['traveler', 'police', 'soldier', 'teacher', 'driver', 'merchant', 'mayor', 'scientist', 'official', 'council'];
const PERSISTED_MODULES = ['extension', 'aviation', 'banking', 'family', 'culture', 'journey', 'trade', 'playerLabor', 'clinical', 'homeRest', 'education', 'power', 'shopLifecycle', 'governance', 'hygiene', 'pathology', 'roadNetwork', 'roadworks', 'roadDemands', 'familyEducation', 'civicStaffing', 'budgetAuthority', 'civicHistory', 'serviceMaterialScheduling', 'powerGrid'] as const;
const TICK_SECONDS = .25;
const ROMANCE_STAGES = ['single', 'crush', 'pursuit', 'dating', 'engaged', 'married', 'family'] as const;
const HOSTILITY_STAGES = ['none', 'discontent', 'rivalry', 'feud', 'enemy', 'mortalEnemy'] as const;
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const hash = (value: string) => { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return h >>> 0; };
const canonicalNpcWages = new WeakMap<object, { simulation: Simulation; state: SimState; tick: number; at: number }>();
/** Only immutable actual native attendance notifications certify paid work.
 * Consumers that change an asset can require this city's current state/frame;
 * the one-argument form retains the original native-notification contract. */
export const isCanonicalNpcWage = (event: object, simulation?: Simulation): boolean => {
  const witness = canonicalNpcWages.get(event);
  return !!witness && (!simulation || witness.simulation === simulation && witness.state === simulation.state
    && witness.tick === simulation.state.tick
    && witness.at === (simulation.state.extension?.lastUpdate ?? simulation.state.day * 1440 + simulation.state.hour * 60));
};
const canonicalCivicPresence = new WeakSet<object>();
/** Only core arrival observations certify unpaid local civic activity. */
export const isCanonicalCivicPresence = (event: object): boolean => canonicalCivicPresence.has(event);
const canonicalRoadworkPresence = new WeakSet<object>();
const canonicalRoadBlock = new WeakSet<object>();
export const isCanonicalRoadBlock = (event: object): boolean => canonicalRoadBlock.has(event);
/** Only actual core people-phase observations authorize material pickup or site labor. */
export const isCanonicalRoadworkPresence = (event: object): boolean => canonicalRoadworkPresence.has(event);
const initialCommuteCache = new WeakMap<WorldDefinition, { fingerprint: string; homes: Map<string, Map<string, number>> }>();
type Event = { type: string; closureId?: string; roadBlock?: RoadBlockWitness; amount?: number; citizenId?: string; shopId?: string; districtId?: string; vehicleId?: string; crimeId?: string; minutes?: number; requestedAmount?: number; quantity?: number; expenseAccrued?: boolean; ratePerMinute?: number; unitPrice?: number; siteId?: string; procurementId?: string; budgetId?: string; purpose?: string; nodeId?: string; fromEdgeId?: string; arrivedAt?: number; creditedWorkStartAt?: number; creditedWorkEndAt?: number; laborJobId?: string; eventId?: number; severity?: number; occurredAt?: number; activityWindowStartAt?: number; activityWindowEndAt?: number; activityObservedTick?: number; activityObservedClock?: number; activityPosition?: Vec3 };
class EventBus {
  private handlers = new Map<string, ((event: Event) => void)[]>();
  on(type: string, handler: (event: Event) => void) { const list = this.handlers.get(type) ?? []; list.push(handler); this.handlers.set(type, list); }
  emit(event: Event) { for (const handler of this.handlers.get(event.type) ?? []) handler(event); }
}
export interface PublicPurchaseRequest { supplierShopIds?: string[]; requestedGross: number; requestedQuantity?: number; districtId?: string; siteId?: string; purpose?: string; procurementId?: string; budgetId?: string; reserveCash?: number; eventType?: string }
export interface PublicPurchaseReceipt { reason?: 'budget' | 'supply' | 'authorization'; paid: number; quantity: number; tax: number; lots: { shopId: string; quantity: number; gross: number; net: number; unitPrice: number }[] }
export interface PublicBudgetAuthorization { id: string; siteId: string; purpose: string; cap: number; approvedAt: number; approvedBy: string[] }
interface PrivateShift {
  day: number; shopId: string;
  assignments: { citizenId: string; ratePerMinute: number; minutesCap: number; workedMinutes: number }[];
  reviews: { at: number; ownerId: string; ownerPosition: Vec3; cash: number; earnedDebt: number; priorCommitment: number; operatingReserve: number; addedCommitment: number }[];
}
interface PrivateLabor { version: 1; nextReviewAt: number; shifts: Record<string, PrivateShift>; stats: { approvedMinutes: number; workedMinutes: number; restrictedReviews: number } }
export interface WageAccrual { citizenId: string; shopId: string | null; workId: string; districtId: string; minutes: number; ratePerMinute: number; amount: number }
interface Runtime {
  rng: number; accumulator: number; weatherAt: number; crimeAt: number; payrollAt: number; commerceAt: number; financeAt: number; socialAt: number;
  eventId: number; crimeId: number; focus: Vec3; mode: ViewMode; detail: number; workAt: number; studyAt: number;
  wages: { citizenId: string; amount: number; districtId: string; shopId?: string | null; expenseAccrued?: boolean }[];
  persistedModules?: string[]; civicStaffingVersion?: 1 | 2; civicHistoryVersion?: 1; budgetAuthorityVersion?: 1; roadNetworkVersion?: 1; roadworksVersion?: 1 | 2; roadDemandsVersion?: 1; governanceVersion?: 1; hygieneVersion?: 1 | 2; hygieneTransferVersion?: 1; pathologyVersion?: 1; powerVersion?: 1; legacyEnergyContractVersion?: 1; legacyEnergyContract?: LegacyEnergyContract; educationVersion?: 1; familyEducationVersion?: 1; playerLaborVersion?: 1; accountingVersion?: 2; wageAccruals?: WageAccrual[]; publicLabor?: PublicLabor; publicLaborReviewAt?: number; privateLabor?: PrivateLabor; publicBudgets?: BudgetAuthorization[];
  wageArrears?: { citizenId: string; shopId: string | null; amount: number }[];
  taxes: number; freight: Record<string, number>; playerBusinesses: string[]; investment: number;
  freightLots?: Record<string, { shopId: string | null; quantity: number }[]>;
  cargoSources?: Record<string, string>;
  campaign: { countAt: number; votes: number } | null;
  signalOverrides: Record<string, number>; constructionId: number; energyBoostUntil: number;
  operatingCost: number; restAt: number; relationshipAt: Record<string, number>; lastInvestmentAt: number;
  publicSupply?: number; operationUnitPrice?: number;
  riders: Record<string, { vehicleId: string; stopNodeId: string; arrived?: boolean; arrivedAt?: number }>;
  links: { from: string; to: string; type: string; affection: number; trust: number }[];
  impressions: Record<string, { affection: number; trust: number }>; districtRelationMeans: Record<string, number>;
  decisionAt: Record<string, number>; activities: Record<string, string>;
  peopleElapsed?: Record<string, number>;
  npcMotionVersion?: 2;
  referenceCollisionPolicyId?: ReferenceCollisionPolicy;
  mealRoutePolicyId?: MealRoutePolicy;
  freightPickupPolicyId?: FreightPickupPolicy;
  freightDeliveryPolicyId?: FreightDeliveryPolicy;
  serviceMaterialSchedulingVersion?: 1;
  npcStairCursors?: Record<string, NpcStairCursor>;
  attendance: Record<string, number>;
  shopLabor?: Record<string, number>;
  poweredShopLabor?: Record<string, number>;
  // Actual between-batch retail units; absent on untouched older saves.
  retailSalesSinceBatch?: Record<string, number>;
  customers: Record<string, string>;
  driving: { vehicleId: string | null; throttle: number; turn: number; brake: boolean; speed: number };
  policeSuppliesVersion?: 1; policeSupplies?: PoliceSupplies;
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
  private readonly freightCarriers = new Map<string, { kind: Vehicle['kind']; cargoCapacity: number }>();
  private readonly freightDeliveryRouter: RoadFoodDeliveryRouter;
  private freightDeliveryAccounts?: Pick<FoodDeliveryAccounts, 'retail' | 'suppliers'>;
  private readonly fingerprint: string;
  private readonly neighbors = new Map<string, { node: string; edge: NetworkEdge }[]>();
  private readonly routeCache = new Map<string, Vec3[]>();
  private readonly walkingTrees = new Map<string, { costs: Map<string, number>; previous: Map<string, { node: string; edge: NetworkEdge }> }>();
  private routingState?: SimState;
  private routingRevision = -1;
  private citizenRoadRevisions = new WeakMap<Citizen, number>();
  private readonly nodeAt = new Map<string, string>();
  private readonly doorNodes = new Map<string, WorldDefinition['nodes'][number]>();
  private readonly saveValidators: ((candidateState: SimState) => void)[] = [];
  private readonly loadHooks: (() => void)[] = [];
  private readonly commandHandlers: ((command: Command) => CommandResult | null)[] = [];
  private readonly baselineCitizenIds = new Set<string>();
  private readonly initialCivicProfessions: CivicInitialProfession[] = [];
  private readonly legacyRiderArrivalAt = new WeakMap<object, number>();
  private readonly citizenRoadMovementRejected = new WeakSet<Citizen>();
  private readonly npcStairMotion: NpcStairMotion;
  private readonly npcCursorRoutes = new WeakMap<NpcStairCursor, Vec3[]>();
  private readonly citizenArrivalMinutes = new WeakMap<Citizen, number>();
  private minutes = .25;
  private employment = new Set<string>();
  private accrualIndexSource?: WageAccrual[];
  private readonly accrualIndex = new Map<string, WageAccrual>();
  private readonly workforce = new Map<string, Citizen[]>();
  private foodHiringDemandState?: SimState;
  private foodHiringDemandTick = -1;
  private readonly foodHiringDemand = new Map<string, { id: string; position: Vec3; route: Vec3[] | undefined; routeIndex: number | undefined; travel: number | undefined }[]>();
  constructor(private readonly world: WorldDefinition, options?: SimulationOptions) {
    if (options !== undefined && (!options || typeof options !== 'object' || Object.keys(options).some(key => !['rulesetId', 'historyPolicyId', 'referenceCollisionPolicyId', 'mealRoutePolicyId', 'freightPickupPolicyId', 'freightDeliveryPolicyId'].includes(key)) || options.rulesetId !== 'civic-local-v1' || options.historyPolicyId !== undefined && options.historyPolicyId !== 'civic-history-pages-v1'
      || options.referenceCollisionPolicyId !== undefined && (options.referenceCollisionPolicyId !== CONTINUOUS_REFERENCE_COLLISION_POLICY || options.historyPolicyId !== 'civic-history-pages-v1')
      || options.mealRoutePolicyId !== undefined && (options.mealRoutePolicyId !== NEARBY_MEAL_ROUTE_POLICY || options.historyPolicyId !== 'civic-history-pages-v1')
      || options.freightPickupPolicyId !== undefined && (options.freightPickupPolicyId !== ROAD_FOOD_PICKUP_POLICY || options.historyPolicyId !== 'civic-history-pages-v1')
      || options.freightDeliveryPolicyId !== undefined && (options.freightDeliveryPolicyId !== ROAD_FOOD_DELIVERY_POLICY || options.freightPickupPolicyId !== ROAD_FOOD_PICKUP_POLICY || options.historyPolicyId !== 'civic-history-pages-v1'))) throw new Error('不支持的显式城市规则版本。');
    if (!world.districts.length || !world.buildings.length || !world.nodes.length) throw new Error('云山世界需要城区、建筑与连通节点。');
    validatePowerGridDefinition(world);
    this.buildings = new Map(world.buildings.map(b => [b.id, b]));
    this.edges = new Map(world.edges.map(e => [e.id, e]));
    this.freightDeliveryRouter = new RoadFoodDeliveryRouter(world);
    this.npcStairMotion = new NpcStairMotion(world);
    for (const node of world.nodes) this.nodeAt.set(this.pointKey(node.position), node.id);
    for (const building of world.buildings) this.doorNodes.set(building.id, this.nearestNode(building.door));
    this.fingerprint = savedWorldFingerprint(world);
    for (const e of world.edges) { this.addNeighbor(e.from, e.to, e); this.addNeighbor(e.to, e.from, e); }
    this.runtime = { rng: (world.seed >>> 0) || 1, accumulator: 0, weatherAt: 9 * 60, crimeAt: 8 * 60 + 40, payrollAt: 17 * 60, commerceAt: 8 * 60, financeAt: 8 * 60, socialAt: 8 * 60, eventId: 0, crimeId: 0, focus: copy(world.spawn), mode: 'drone', detail: 1, workAt: -10000, studyAt: -10000, wages: [], accountingVersion: 2, wageAccruals: [], wageArrears: [], taxes: 0, freight: {}, playerBusinesses: [], investment: 0, campaign: null, signalOverrides: {}, constructionId: 0, energyBoostUntil: 0, operatingCost: 0, restAt: -10000, relationshipAt: {}, lastInvestmentAt: -10000, riders: {}, links: [], impressions: {}, districtRelationMeans: {}, decisionAt: {}, activities: {}, attendance: {}, customers: {}, driving: { vehicleId: null, throttle: 0, turn: 0, brake: true, speed: 0 }, dispatches: {}, relationshipClock: 480, hostileAt: {} };
    this.state = { version: 1, seed: world.seed, tick: 0, day: 0, hour: 8, paused: false, speed: 1, weather: '晴', visibility: 1, energy: 98, treasury: 80000, taxRate: .08, policeBudget: .3, support: 58, bankBalance: 0, loan: 0, gdp: 0, lastSystemOrder: [], districts: world.districts.map(d => ({ id: d.id, energy: 98, safety: 84, employment: .94, prosperity: 68, pollution: 8, tier: 'statistical', residents: d.population, crimeCount: 0 })), citizens: [], vehicles: [], shops: [], player: { position: copy(world.spawn), role: 'traveler', identities: ['traveler'], money: 600, reputation: 0, needs: { hunger: 85, fatigue: 90, social: 70, fun: 70 }, inventory: { block: 32 }, homeId: null, education: 0, experience: 0, partnerId: null, vehicleId: null }, relationships: [], crimes: [], events: [], metrics: { trades: 0, commutes: 0, crimesResolved: 0, freight: 0, flights: 0 }, voxels: [] };
    this.initializeCitizens();
    for (const actor of this.state.citizens) this.initialCivicProfessions.push({ id: actor.id, role: actor.role, workId: actor.workId, districtId: actor.districtId, education: actor.education });
    // Fresh journeys explicitly opt into physical stair travel. A loaded v1
    // runtime replaces these fields and retains its original movement contract.
    this.runtime.npcMotionVersion = 2; this.runtime.npcStairCursors = {};
    if (options?.referenceCollisionPolicyId) this.runtime.referenceCollisionPolicyId = options.referenceCollisionPolicyId;
    if (options?.mealRoutePolicyId) this.runtime.mealRoutePolicyId = options.mealRoutePolicyId;
    if (options?.freightPickupPolicyId) this.runtime.freightPickupPolicyId = options.freightPickupPolicyId;
    if (options?.freightDeliveryPolicyId) this.runtime.freightDeliveryPolicyId = options.freightDeliveryPolicyId;
    for (const citizen of this.state.citizens) this.baselineCitizenIds.add(citizen.id);
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
      for (let i = 0; i < count; i++) {
        const progress = i / count, id = `vehicle-${e.id}-${i}`;
        // These capacities belong to the trusted generated fleet, independently
        // of whether an imported instance currently carries any stock.
        const cargoCapacity = e.mode === 'road' && i === 1 ? 28 : e.mode === 'flight' ? 60 : 0;
        if (cargoCapacity > 0) this.freightCarriers.set(id, { kind: e.mode, cargoCapacity });
        this.state.vehicles.push({ id, kind: e.mode, position: this.pointOn(e, progress), edgeId: e.id, progress, direction: i % 2 === 0 ? 1 : -1, speed: this.speedFor(e.mode), state: 'waiting', passengers: 0, cargo: cargoCapacity, nextDeparture: 8 * 60 + (e.mode === 'flight' ? 20 : i * 3) });
      }
    }
    this.connectSystems();
    this.updateTiers();
    this.updateSignals();
    const researchLaborPhase = installExtensions(this);
    this.initializeShopAccounts();
    this.onLoad(() => this.initializeShopAccounts());
    installPlayerLabor(this, { reserve: (siteId, gross) => this.reservePlayerLabor(siteId, gross), refund: (employer, amount) => this.refundPlayerLabor(employer, amount), pay: (job, gross, minutes, interval) => this.payPlayerLabor(job, gross, minutes, interval) });
    installAviation(this);
    installBanking(this);
    installJourneys(this);
    installTrade(this);
    installFamily(this);
    if (options?.rulesetId === 'civic-local-v1') {
      this.state.civicStaffing = createCivicStaffingState({ id: `civic-new-${world.seed}-${this.fingerprint}`, ruleVersion: 1, origin: 'new-city', enabledAt: 480, enabledTick: 0 }, initialCivicOfficials(this.initialCivicProfessions, world));
      this.runtime.civicStaffingVersion = 1;
      if (options.historyPolicyId === 'civic-history-pages-v1') {
        this.state.civicHistory = createCivicHistory(this.state.civicStaffing.enablement.id, this.motionVersion, 480, 0);
        this.state.civicStaffing = { ...this.state.civicStaffing, version: 2, historyId: this.state.civicHistory.id };
        this.runtime.civicStaffingVersion = 2; this.runtime.civicHistoryVersion = 1;
      }
    }
    installCivicStaffing(this, { enabled: () => this.effectiveRuleset === 'civic-local-v1', isCanonicalPresence: isCanonicalCivicPresence });
    installCulture(this);
    if (this.state.civicStaffing) { this.state.budgetAuthority = createBudgetAuthorityState(this.state.civicStaffing.enablement, this.runtime.publicBudgets ?? [], this.state.culture); this.runtime.budgetAuthorityVersion = 1; }
    installBudgetAuthority(this, { enabled: () => this.effectiveRuleset === 'civic-local-v1' }, () => this.runtime);
    installFamilyEducation(this);
    installHomeRest(this);
    installPower(this, { activate: () => { this.runtime.powerVersion = 1; }, legacy: () => this.legacyEnergyContract(), publicSupply: () => this.runtime.publicSupply ?? 1, isCanonicalDisaster, isCanonicalResearchCompletion });
    installPowerGrid(this);
    installShopLifecycle(this);
    installGovernance(this, { activate: () => { this.runtime.governanceVersion = 1; }, legacyCampaignPending: () => !!this.runtime.campaign,
      chargeRegistration: site => this.receivePublicFee(120, '具名居民选举登记费', site.districtId) });
    installPathology(this);
    installHygiene(this);
    installRoadNetwork(this, { isCanonicalDisaster, activate: () => { this.runtime.roadNetworkVersion = 1; } });
    const roadworks = installRoadworks(this, { isCanonicalRoadworkPresence, activate: (version = 1) => { this.runtime.roadworksVersion = version; },
      travelCost: (citizenId, nodeId, point) => this.roadworkTravelCost(citizenId, nodeId, point),
      takePublicEscrow: request => this.takeRoadworkPublicEscrow(request), returnPublicEscrow: request => this.returnRoadworkPublicEscrow(request), accrueTax: amount => { if (finite(amount) && amount >= 0) this.runtime.taxes += amount; } });
    installRoadDemands(this, { isCanonicalRoadBlock, activate: () => { this.runtime.roadDemandsVersion = 1; }, requestRepair: demandId => roadworks.requestResidentDemand(demandId) });
    this.resetRoadRouting();
    // Actual public education claims this actor first; research uses only remaining minutes.
    this.onPhase('people', (_state, minutes) => researchLaborPhase(minutes));
    // Last feedback consumer: no earlier tick consumer observes a half archive.
    let archiveBlocked = false;
    this.onLoad(() => { archiveBlocked = false; });
    this.onPhase('feedback', () => {
      if (this.state.civicStaffing?.version !== 2) return;
      try {
        const transaction = prepareCivicHistoryArchive(this.state, this.world);
        if (!transaction) return;
        const candidate = { ...this.state, ...transaction };
        validateSupplementalBudgetState(candidate, this.world);
        validateSupplementalBudgetCrossReferences(candidate, this.runtime.publicBudgets ?? []);
        validateBudgetAuthority(candidate, this.world, this.runtime);
        this.state.civicStaffing = transaction.civicStaffing; this.state.civicHistory = transaction.civicHistory; archiveBlocked = false;
      } catch (error) {
        if (!archiveBlocked) this.appendNotice('civic-history-storage', `公民完整历史尚未封存，原来源仍保留：${error instanceof Error ? error.message : '历史存储不足'}`);
        archiveBlocked = true;
      }
    });
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
    let sharedCommutes = initialCommuteCache.get(this.world);
    if (!sharedCommutes || sharedCommutes.fingerprint !== this.fingerprint) { sharedCommutes = { fingerprint: this.fingerprint, homes: new Map() }; initialCommuteCache.set(this.world, sharedCommutes); }
    for (let i = 0; i < count; i++) {
      const district = this.world.districts[i % this.world.districts.length];
      const student = Math.floor(i / this.world.districts.length) % 11 === 0;
      const districtHomes = homes.filter(b => b.districtId === district.id);
      const home = (districtHomes.length ? districtHomes : homes.length ? homes : this.world.buildings)[Math.floor(i / this.world.districts.length) % Math.max(1, districtHomes.length || homes.length || this.world.buildings.length)];
      const districtJobs = workplaces.filter(b => b.districtId === district.id);
      const availableJobs = districtJobs.length ? districtJobs : workplaces.length ? workplaces : this.world.buildings;
      const homeNode = this.buildingNode(home); let costs = sharedCommutes.homes.get(homeNode.id);
      if (!costs) { costs = this.walkingTree(homeNode.id).costs; sharedCommutes.homes.set(homeNode.id, costs); }
      const commute = (b: Building) => distance(home.door, homeNode.position) + (costs.get(this.buildingNode(b).id) ?? Infinity) + distance(this.buildingNode(b).position, b.door);
      const reachableJobs = availableJobs.filter(b => finite(commute(b)));
      const nearbyJobs = reachableJobs.filter(b => commute(b) <= 500);
      const jobPool = nearbyJobs.length ? nearbyJobs : [...reachableJobs].sort((a, b) => commute(a) - commute(b)).slice(0, 4);
      // Residency and ordinary employment share a real neighbourhood. A global
      // array index previously assigned 3–6 km daily walks without transit.
      const defaultWork = jobPool[Math.floor(i / this.world.districts.length) % jobPool.length] ?? availableJobs[0];
      const school = schools.reduce<Building | null>((best, b) => finite(commute(b)) && (!best || commute(b) < commute(best)) ? b : best, null);
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
      if (citizen.role === '学生' || (this.state.extension?.actorProfiles[citizen.id]?.age ?? 20) < 18 || this.state.extension?.actorProfiles[citizen.id]?.alive === false) continue;
      const roster = this.workforce.get(citizen.workId) ?? []; roster.push(citizen); this.workforce.set(citizen.workId, roster);
    }
  }
  private isEmployed(citizen: Citizen): boolean {
    if (citizen.role === '学生' || (this.state.extension?.actorProfiles[citizen.id]?.age ?? 20) < 18) return false;
    const shop = this.state.shops.find(s => s.buildingId === citizen.workId);
    const index = this.workforce.get(citizen.workId)?.indexOf(citizen) ?? -1;
    return shop ? index >= 0 && this.privateWorkAllowance(citizen, shop) > 0 : this.publicWorkAllowance(citizen) > 0;
  }
  private registerAttendance(citizen: Citizen, elapsed: number): void {
    const previous = this.runtime.attendance[citizen.id] ?? 0;
    const shop = this.state.shops.find(s => s.buildingId === citizen.workId);
    const credited = Math.min(elapsed, Math.max(0, 480 - previous), shop ? this.privateWorkAllowance(citizen, shop) : this.publicWorkAllowance(citizen));
    this.employment.add(citizen.id); this.runtime.attendance[citizen.id] = previous + credited;
    if (shop && credited > 0) { const labor = this.runtime.shopLabor ??= {}; labor[shop.id] = (labor[shop.id] ?? 0) + credited; if (this.state.powerGrid) { const powered = this.runtime.poweredShopLabor ??= {}; powered[shop.id] = (powered[shop.id] ?? 0) + gridPoweredWorkMinutes(this.state, shop.buildingId, { startAt: (this.state.extension?.lastUpdate ?? this.now) - elapsed, endAt: (this.state.extension?.lastUpdate ?? this.now) - elapsed + credited }, credited); } }
    if (credited > 0) {
      if (shop) { const assignment = this.privateShiftAssignment(citizen, shop); if (assignment) { assignment.workedMinutes += credited; this.runtime.privateLabor!.stats.workedMinutes += credited; } }
      else { const assignment = this.publicShiftAssignment(citizen); if (assignment) { assignment.workedMinutes += credited; this.runtime.publicLabor!.stats.workedMinutes += credited; } }
      // Caps allocate the credited front of this actual post-arrival work window.
      // This changes no wage quantity, cash, daily cap or shift allowance.
      const startAt = (this.state.extension?.lastUpdate ?? this.now) - elapsed;
      this.accrueWork(citizen, credited, true, { startAt, endAt: startAt + credited });
    }
  }
  private accrueWork(citizen: Citizen, minutes: number, notify = true, workWindow?: { startAt: number; endAt: number }): void {
    const shop = this.state.shops.find(s => s.buildingId === citizen.workId), claims = this.runtime.wageAccruals ??= [];
    if (this.accrualIndexSource !== claims || this.accrualIndex.size !== claims.length) { this.accrualIndex.clear(); for (const item of claims) this.accrualIndex.set(`${item.citizenId}:${item.workId}`, item); this.accrualIndexSource = claims; }
    const key = `${citizen.id}:${citizen.workId}`; let claim = this.accrualIndex.get(key);
    if (!claim) {
      const district = this.state.districts.find(d => d.id === citizen.districtId)!;
      claim = { citizenId: citizen.id, shopId: shop?.id ?? null, workId: citizen.workId, districtId: citizen.districtId,
        minutes: 0, ratePerMinute: (shop ? this.privateShiftAssignment(citizen, shop)?.ratePerMinute : this.publicShiftAssignment(citizen)?.ratePerMinute) || 32 * (.7 + district.prosperity / 100) / 480, amount: 0 };
      claims.push(claim); this.accrualIndex.set(key, claim);
    }
    const earned = minutes * claim.ratePerMinute;
    claim.minutes += minutes; claim.amount += earned;
    if (shop) shop.profit -= earned;
    if (notify) {
      const event: Event = Object.freeze({ type: 'wage-earned', citizenId: citizen.id, shopId: shop?.id, districtId: citizen.districtId, minutes, amount: earned, ratePerMinute: claim.ratePerMinute, ...(workWindow ? { siteId: citizen.workId, creditedWorkStartAt: workWindow.startAt, creditedWorkEndAt: workWindow.endAt } : {}) });
      canonicalNpcWages.set(event, { simulation: this, state: this.state, tick: this.state.tick, at: this.state.extension?.lastUpdate ?? this.now }); this.bus.emit(event);
    }
  }
  /** A company's capital is its operating account, never a second copy of cash. */
  shopOwnerId(shop: Shop): string | undefined { return this.state.extension?.companies.find(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)?.ownerId ?? shop.ownerId; }
  /** Farms grow meals and fishing docks land food; workshops make service and
   * construction supplies. Classification changes no stock or cash balances. */
  shopCommodity(shop: Shop): 'food' | 'materials' { return this.buildings.get(shop.buildingId)?.kind === 'workshop' ? 'materials' : 'food'; }
  private shopInsolvent(shop: Shop): boolean {
    return shop.profit <= -600 && shop.inventory < 1e-7 && this.shopFunds(shop) - this.shopProtectedFunds(shop) < 20 * 8 / 24;
  }
  shopFunds(shop: Shop): number { return this.state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)?.capital ?? shop.cash ?? 0; }
  shopPayrollDebt(shop: Shop): number { return [...(this.runtime.wageArrears ?? []), ...(this.runtime.wageAccruals ?? []), ...this.runtime.wages].filter(owed => owed.shopId === shop.id).reduce((sum, owed) => sum + owed.amount, 0); }
  shopCommittedPayroll(shop: Shop): number {
    const shift = this.runtime.privateLabor?.shifts[shop.id], day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440);
    return shift?.day === day ? shift.assignments.reduce((sum, item) => sum + (item.minutesCap - item.workedMinutes) * item.ratePerMinute, 0) : 0;
  }
  shopProtectedFunds(shop: Shop): number { return this.shopPayrollDebt(shop) + this.shopCommittedPayroll(shop) + shopLifecycleReservedFunds(this.state, shop.id); }
  private privateShiftAssignment(citizen: Citizen, shop: Shop) {
    const shift = this.runtime.privateLabor?.shifts[shop.id], day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440);
    return shift?.day === day ? shift.assignments.find(item => item.citizenId === citizen.id) : undefined;
  }
  private privateWorkAllowance(citizen: Citizen, shop: Shop): number {
    if (!shopLifecycleAllowsNewPayroll(this.state, shop.id)) return 0;
    // Before the first onsite review the employer has promised no new labor.
    const assignment = this.privateShiftAssignment(citizen, shop);
    return assignment ? Math.max(0, assignment.minutesCap - assignment.workedMinutes) : 0;
  }
  private privateRoster(shop: Shop, plan: PrivateShift | undefined): Citizen[] {
    const available = this.workforce.get(shop.buildingId) ?? [];
    // A named accepted worker must not fall behind an uncontracted array slot.
    // Preserve the last plan's names across rollover, without reusing old wages.
    const promised = (plan?.assignments ?? []).filter(item => item.minutesCap > 0), pending = (plan?.assignments ?? []).filter(item => item.minutesCap === 0);
    const named = [...promised, ...pending].map(item => available.find(c => c.id === item.citizenId)).filter((c): c is Citizen => !!c);
    const names = new Set(named.map(c => c.id));
    return [...named, ...available.filter(c => !names.has(c.id))].slice(0, shop.employees);
  }
  private reviewPrivateShifts(): void {
    const time = this.state.extension?.lastUpdate ?? this.now, day = Math.floor(time / 1440);
    const labor = this.runtime.privateLabor ??= { version: 1, nextReviewAt: time, shifts: {}, stats: { approvedMinutes: 0, workedMinutes: 0, restrictedReviews: 0 } };
    if (time < labor.nextReviewAt - 1e-7) return; labor.nextReviewAt = time + 10;
    if (this.state.hour < 6 || this.state.hour >= 17) return;
    for (const shop of this.state.shops) {
      if (!shopLifecycleAllowsNewPayroll(this.state, shop.id)) continue;
      const site = this.buildings.get(shop.buildingId)!, ownerId = this.shopOwnerId(shop), owner = ownerId === 'player' ? this.state.player : this.state.citizens.find(c => c.id === ownerId), profile = ownerId ? this.state.extension?.actorProfiles[ownerId] : undefined;
      if (!owner || !ownerId || !profile?.alive || profile.age < 18 || profile.health < 45 || owner.needs.hunger < 40 || owner.needs.fatigue < 35 || !this.isNearBuilding(site, owner.position, 2)
        || site.floorPlanProfile === FLOOR_PLAN_PROFILE && !this.isAtBuildingFunctionPoint(site, owner.position, 'work', ownerId === 'player' ? this.state.player : { role: this.citizenIdentity(owner as Citizen), identities: [this.citizenIdentity(owner as Citizen)] })) continue;
      let plan = labor.shifts[shop.id];
      const roster = this.privateRoster(shop, plan);
      if (!plan || plan.day !== day) plan = labor.shifts[shop.id] = { day, shopId: shop.id, assignments: [], reviews: [] };
      if (plan.reviews.length >= 150) continue;
      // Amendments use newly received cash and keep every earlier rate/minute.
      for (const citizen of roster) if (!plan.assignments.some(item => item.citizenId === citizen.id)) plan.assignments.push({ citizenId: citizen.id, ratePerMinute: (this.runtime.wageAccruals ?? []).find(item => item.citizenId === citizen.id && item.shopId === shop.id)?.ratePerMinute ?? 32 * (.7 + this.state.districts.find(d => d.id === citizen.districtId)!.prosperity / 100) / 480, minutesCap: 0, workedMinutes: 0 });
      const earnedDebt = this.shopPayrollDebt(shop), priorCommitment = this.shopCommittedPayroll(shop), operatingReserve = 20 * 8 / 24 + shopLifecycleReservedFunds(this.state, shop.id), cash = this.shopFunds(shop);
      const available = Math.max(0, cash - earnedDebt - priorCommitment - operatingReserve);
      const remaining = plan.assignments.filter(item => roster.some(c => c.id === item.citizenId) && item.minutesCap < 480);
      const full = remaining.reduce((sum, item) => sum + (480 - item.minutesCap) * item.ratePerMinute, 0), fraction = Math.min(1, available / Math.max(1e-9, full));
      let addedCommitment = 0, addedMinutes = 0;
      for (const item of remaining) { const minutes = Math.floor((480 - item.minutesCap) * fraction); item.minutesCap += minutes; addedMinutes += minutes; addedCommitment += minutes * item.ratePerMinute; }
      if (addedCommitment > 1e-8) { plan.reviews.push({ at: time, ownerId, ownerPosition: copy(owner.position), cash, earnedDebt, priorCommitment, operatingReserve, addedCommitment }); labor.stats.approvedMinutes += addedMinutes; this.bus.emit({ type: 'private-shift-authorized', shopId: shop.id, citizenId: ownerId, amount: addedCommitment, minutes: addedMinutes }); }
      else if (shop.profit <= -600) labor.stats.restrictedReviews++;
    }
  }
  privateLaborCoverage() {
    const day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440), plans = Object.values(this.runtime.privateLabor?.shifts ?? {}).filter(plan => plan.day === day);
    return { rosterJobs: this.state.shops.reduce((sum, shop) => sum + shop.employees, 0), plannedMinutes: plans.reduce((sum, plan) => sum + plan.assignments.reduce((subtotal, item) => subtotal + item.minutesCap, 0), 0), actualMinutes: plans.reduce((sum, plan) => sum + plan.assignments.reduce((subtotal, item) => subtotal + item.workedMinutes, 0), 0), reservedCash: this.state.shops.reduce((sum, shop) => sum + this.shopCommittedPayroll(shop), 0), restrictedShops: this.state.shops.filter(shop => shop.profit <= -600).length, statistics: this.runtime.privateLabor ? { ...this.runtime.privateLabor.stats } : null };
  }
  consumeShopLabor(shopId: string, minutes: number): number { const labor = this.runtime.shopLabor ??= {}, consumed = Math.min(Math.max(0, minutes), labor[shopId] ?? 0); labor[shopId] = (labor[shopId] ?? 0) - consumed; if (this.runtime.poweredShopLabor) this.runtime.poweredShopLabor[shopId] = Math.max(0, (this.runtime.poweredShopLabor[shopId] ?? 0) - consumed); return consumed; }
  transferShopFunds(shop: Shop, amount: number): void {
    const company = this.state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId);
    if (company) company.capital = clamp(company.capital + amount, 0, 1e9);
    else shop.cash = clamp((shop.cash ?? 0) + amount, 0, 1e9);
  }
  reservePlayerLabor(siteId: string, gross: number): PlayerLaborEmployer | null {
    const site = this.buildings.get(siteId), shop = this.state.shops.find(item => item.buildingId === siteId);
    if (!site || !finite(gross) || gross <= 0 || gross > 95) return null;
    const employer: PlayerLaborEmployer = { kind: shop ? 'shop' : 'public', siteId, districtId: site.districtId, shopId: shop?.id ?? null };
    if (shop) {
      if (this.shopFunds(shop) - this.shopProtectedFunds(shop) - 20 * 8 / 24 < gross) return null;
      this.transferShopFunds(shop, -gross);
    } else {
      const budget = this.publicBudgetSnapshot(); if (budget.available < gross) return null;
      this.state.treasury -= gross; this.recordPublicPayrollEscrow(-gross, site.districtId);
    }
    return employer;
  }
  refundPlayerLabor(employer: PlayerLaborEmployer, amount: number): boolean {
    if (!finite(amount) || amount < 0 || !this.buildings.has(employer.siteId)) return false;
    if (employer.kind === 'shop') {
      const shop = this.state.shops.find(item => item.id === employer.shopId && item.buildingId === employer.siteId);
      if (!shop || this.shopFunds(shop) + amount > 1e9) return false; this.transferShopFunds(shop, amount);
    } else {
      if (this.state.treasury + amount > 1e12) return false; this.state.treasury += amount; this.recordPublicPayrollEscrow(amount, employer.districtId);
    }
    return true;
  }
  private recordPublicPayrollEscrow(amount: number, districtId: string): void {
    const extension = this.state.extension!; Reflect.get(extension, 'runtime').lastTreasury += amount;
    extension.publicLedger.push({ tick: this.state.tick, actorId: 'player', account: 'public', amount, purpose: amount < 0 ? '公共工班真实工资托管划出' : '未赚取公共工班工资托管退回', districtId, sourceEvent: 'public-payroll-escrow' });
    if (extension.publicLedger.length > 512) extension.publicLedger.splice(0, extension.publicLedger.length - 512);
  }
  payPlayerLabor(job: PlayerLaborJob, gross: number, minutes: number, interval: { startAt: number; endAt: number }): void {
    const shop = this.state.shops.find(item => item.id === job.employer.shopId), tax = gross * this.state.taxRate;
    this.state.player.money += gross - tax; this.runtime.taxes += tax;
    if (shop) { shop.profit -= gross; const labor = this.runtime.shopLabor ??= {}; labor[shop.id] = (labor[shop.id] ?? 0) + minutes; if (this.state.powerGrid) { const powered = this.runtime.poweredShopLabor ??= {}; powered[shop.id] = (powered[shop.id] ?? 0) + gridPoweredWorkMinutes(this.state, shop.buildingId, interval, minutes); } }
    this.bus.emit({ type: 'wage-earned', citizenId: 'player', shopId: shop?.id, districtId: job.employer.districtId, amount: gross, minutes, ratePerMinute: job.ratePerMinute, siteId: job.siteId, purpose: job.role, laborJobId: job.id, creditedWorkStartAt: interval.startAt, creditedWorkEndAt: interval.endAt });
    this.bus.emit({ type: 'wage-paid', citizenId: 'player', shopId: shop?.id, districtId: job.employer.districtId, amount: gross, requestedAmount: gross });
    if (job.role === 'police' || job.role === 'soldier') { const district = this.state.districts.find(item => item.id === job.employer.districtId)!; district.safety = clamp(district.safety + minutes / 60); }
    if (job.role === 'teacher') this.state.support = clamp(this.state.support + minutes / 300);
  }
  transferBusinessOwnership(shopId: string, actorId: string): boolean {
    const shop = this.state.shops.find(shop => shop.id === shopId);
    if (!shop || actorId !== 'player' && !this.state.citizens.some(citizen => citizen.id === actorId)) return false;
    if (!shopLifecycleBeforeBusinessTransfer(this, shop, actorId)) return false;
    shop.ownerId = actorId; this.runtime.playerBusinesses = this.runtime.playerBusinesses.filter(id => id !== shopId);
    if (actorId === 'player' && !this.state.extension?.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)) this.runtime.playerBusinesses.push(shopId);
    this.state.player.inventory.businesses = this.runtime.playerBusinesses.length;
    this.state.player.inventory[`business:${shop.buildingId}`] = actorId === 'player' ? 1 : 0;
    return true;
  }
  private publicShiftAssignment(citizen: Citizen) {
    const day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440);
    const labor = this.runtime.publicLabor;
    if (!labor) return undefined;
    return publicTransferAssignment(labor, citizen, day) ?? labor.shifts.find(shift => shift.day === day)?.assignments.find(assignment => assignment.citizenId === citizen.id && assignment.workId === citizen.workId);
  }
  private publicWorkAllowance(citizen: Citizen): number {
    const labor = this.runtime.publicLabor, day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440);
    if (!labor || day < labor.standingUntilDay) return 480;
    const assignment = this.publicShiftAssignment(citizen); return assignment ? Math.max(0, assignment.minutesCap - assignment.workedMinutes) : 0;
  }
  private reservedPublicShifts(): number {
    const day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440);
    return (this.runtime.publicLabor?.shifts ?? []).filter(shift => shift.day >= day).reduce((sum, shift) => sum + shift.assignments.reduce((total, assignment) => total + Math.max(0, assignment.minutesCap - assignment.workedMinutes) * assignment.ratePerMinute, 0), 0) + publicTransferReserved(this.runtime.publicLabor, day);
  }
  /** Appointment writes the new contract only after its actual fee transaction.
   * Notification events alone never authorize a public employment transition. */
  canRecordPublicAppointment(citizen: Citizen, site: Building): boolean {
    return canRecordPublicTransfer(this.runtime.publicLabor, citizen, site, new Set(this.state.shops.map(shop => shop.buildingId)));
  }
  recordPublicAppointment(receipt: Omit<EmploymentTransfer, 'revision' | 'priorPublicWorkId'>): void {
    const labor = this.runtime.publicLabor;
    const baseRoles=Object.fromEntries(Object.keys(labor?.jobs ?? {}).map(id=>[id,id===receipt.actorId ? receipt.fromRole : this.state.citizens.find(actor=>actor.id===id)!.role]));
    recordPublicTransfer(labor, { priorPublicWorkId: labor ? publicEmploymentSite(labor, receipt.actorId) ?? null : null, ...receipt },baseRoles);
  }
  private publicFundedShift(citizen: Citizen) {
    const assignment=this.publicShiftAssignment(citizen),labor=this.runtime.publicLabor;
    if(!assignment || !labor || assignment.workedMinutes<=0 || assignment.workedMinutes>=assignment.minutesCap)return undefined;
    const shift=labor.shifts.find(shift=>shift.assignments.includes(assignment));
    // This supplemental approval uses an explicit ordinary daily wage shift.
    // Standing or supplemental-only officers wait for that real next window;
    // no fictional historical shift is created for a signature.
    return shift ? {id:shift.id,assignment} : undefined;
  }
  private reviewPublicTransferContracts(): void {
    const labor = this.runtime.publicLabor, employment = labor?.employment;
    if (!labor || !employment) return;
    const time = this.state.extension!.lastUpdate, day = Math.floor(time / 1440);
    // Signatures reference actual work on their approval day. Retire closed
    // supplements with that day so their source shifts are never dropped first.
    employment.contracts = employment.contracts.filter(contract => Math.floor(contract.approvedAt/1440) >= day - 14);
    const groups = new Map<string, Citizen[]>();
    for (const actor of this.state.citizens) {
      const site = this.buildings.get(actor.workId), role = this.citizenIdentity(actor);
      if (!site || !['hall','core','bank'].includes(site.kind) || !['official','council','mayor'].includes(role)
        || publicEmploymentSite(labor,actor.id) !== actor.workId || !this.isOnDuty(actor.id,site.id)
        || !this.publicFundedShift(actor)
        || !this.runtime.wageAccruals?.some(claim=>claim.citizenId===actor.id && claim.workId===site.id && claim.minutes>0)) continue;
      const group = groups.get(site.id) ?? []; group.push(actor); groups.set(site.id,group);
    }
    const reviewers = [...groups.entries()].filter(([,actors])=>actors.length>=2).sort((a,b)=>a[0].localeCompare(b[0]))[0];
    if (!reviewers || this.state.hour < 8 || this.state.hour >= 17) return;
    const revision = publicEmploymentRevision(labor);
    for (const transfer of employment.transfers) {
      const actor = this.state.citizens.find(c=>c.id===transfer.actorId), profile = this.state.extension!.actorProfiles[transfer.actorId];
      if (!actor || !profile?.alive || profile.age < 18 || actor.workId !== transfer.toWorkId
        || this.state.shops.some(shop=>shop.buildingId===actor.workId) || publicEmploymentTransfer(labor,actor.id)?.revision !== transfer.revision) continue;
      for (const targetDay of [day,day+1]) {
        if (targetDay < labor.standingUntilDay || employment.contracts.length >= TRANSFER_CONTRACT_LIMIT
          || publicTransferAssignment(labor,actor,targetDay)
          || labor.shifts.find(shift=>shift.day===targetDay)?.assignments.some(assignment=>assignment.citizenId===actor.id && assignment.workId===actor.workId)) continue;
        const budget = this.publicBudgetSnapshot(),funding={publicWagesDue:budget.publicWagesDue,publicWagesEarned:budget.publicWagesEarned,
          authorizedRemaining:budget.authorizedRemaining,priorPromises:this.reservedPublicShifts(),essentialOperations:budget.essentialOperations,
          standingForecast:day<labor.standingUntilDay ? budget.forecastPayroll : 0};
        const protectedCash=Object.values(funding).reduce((sum,value)=>sum+value,0);
        const available = Math.max(0,this.state.treasury-protectedCash);
        const rate = this.runtime.wageAccruals?.find(claim=>claim.citizenId===actor.id && claim.workId===actor.workId)?.ratePerMinute
          ?? 32 * (.7 + this.state.districts.find(d=>d.id===actor.districtId)!.prosperity / 100) / 480;
        const remainingMinutes = targetDay===day ? Math.max(0,480-(this.runtime.attendance[actor.id]??0)) : 480;
        const minutesCap = Math.min(Math.floor(remainingMinutes),Math.floor(available/Math.max(1e-9,rate)));
        if (minutesCap <= 0) continue;
        const cap = minutesCap*rate;
        employment.contracts.push({id:`public-transfer-${targetDay}-${actor.id}-${transfer.revision}`,transferRevision:transfer.revision,
          employmentRevision:revision,day:targetDay,approvedAt:time,siteId:reviewers[0],
          signatures:reviewers[1].slice(0,2).map(signer=>{const source=this.publicFundedShift(signer)!;return {actorId:signer.id,workId:signer.workId,role:this.citizenIdentity(signer),position:copy(signer.position),
            actualWageMinutes:this.runtime.attendance[signer.id],fundedShiftId:source.id,fundedWorkedMinutes:source.assignment.workedMinutes};}),funding,
          cash:this.state.treasury,protectedCash,available,cap,assignment:{citizenId:actor.id,workId:actor.workId,ratePerMinute:rate,minutesCap,workedMinutes:0}});
        labor.stats.approvedMinutes += minutesCap;
        this.notice('budget',`两名已实际有薪在岗官员批准${actor.name}第${targetDay+1}日新岗位最多${minutesCap}分钟；旧班、旧债与新工资承诺均继续受真实现金保护。`);
      }
    }
  }
  publicServiceCoverage() {
    const labor = this.runtime.publicLabor, day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440), shift = labor?.shifts.find(shift => shift.day === day);
    if (labor?.version===2 && labor.employment) {
      const contracts = labor.employment.contracts.filter(contract=>contract.day===day), assignments = [...(shift?.assignments ?? []),...contracts.map(contract=>contract.assignment)];
      const reviewGroups=new Map<string,number>();
      for(const actor of this.state.citizens){const site=this.buildings.get(actor.workId);
        if(site && ['hall','core','bank'].includes(site.kind) && ['official','council','mayor'].includes(this.citizenIdentity(actor))
          && publicEmploymentSite(labor,actor.id)===actor.workId && this.isOnDuty(actor.id,site.id) && this.publicFundedShift(actor))
          reviewGroups.set(site.id,(reviewGroups.get(site.id)??0)+1);}
      const eligibleReviewers=Math.max(0,...reviewGroups.values()),rule='转岗新班须由同地点两名已签当日日班、实际到岗且仍有带薪工时的官员审议。仅有常备拨款或临时新班的官员，要等下一次日班。';
      const reason=this.state.hour<8 || this.state.hour>=17 ? '等待8–17时的实际审议窗口。' : eligibleReviewers<2 ? '尚缺同地点两名有已签当日日班、已实做正工时且未做满的在岗官员。'
        : this.state.extension!.lastUpdate<labor.nextReviewAt ? '等待下一次实际日班审议；新工资仍须扣除旧债、旧承诺与必要服务后才可签。' : '在岗审核条件已具备；可签时数仍由真实剩余预算限定。';
      return {fundedMinutes:assignments.reduce((sum,assignment)=>sum+assignment.minutesCap,0),actualMinutes:assignments.reduce((sum,assignment)=>sum+assignment.workedMinutes,0),
        plannedFullMinutes:new Set(assignments.map(assignment=>assignment.citizenId)).size*480,reservedCash:this.reservedPublicShifts(),statistics:{...labor.stats},
        shifts:[...labor.shifts.map(item=>({id:item.id,day:item.day,cap:item.cap,approvedBy:[...item.approvedBy],siteId:item.siteId})),
          ...labor.employment.contracts.map(contract=>({id:contract.id,day:contract.day,cap:contract.cap,approvedBy:contract.signatures.map(signature=>signature.actorId),siteId:contract.siteId}))],
        transferContracts:contracts.map(contract=>({id:contract.id,actorId:contract.assignment.citizenId,workId:contract.assignment.workId,minutesCap:contract.assignment.minutesCap,workedMinutes:contract.assignment.workedMinutes,cap:contract.cap})),
        transferReview:{rule,reason,eligibleReviewers,standingActive:day<labor.standingUntilDay,actors:[...new Set(labor.employment.transfers.map(transfer=>transfer.actorId))].flatMap(id=>{
          const actor=this.state.citizens.find(actor=>actor.id===id),transfer=publicEmploymentTransfer(labor,id),profile=this.state.extension!.actorProfiles[id];
          if(!actor || !transfer || actor.workId!==transfer.toWorkId || !profile?.alive || profile.age<18)return [];
          const assignment=this.publicShiftAssignment(actor);return [{actorId:id,name:actor.name,workId:actor.workId,siteName:this.buildings.get(actor.workId)!.name,
            fundedMinutes:assignment?.minutesCap??0,actualMinutes:assignment?.workedMinutes??0,remainingMinutes:this.publicWorkAllowance(actor)}];})},
        originalPromisedMinutes:shift?.assignments.reduce((sum,assignment)=>sum+assignment.minutesCap,0)??0,
        transferPromisedMinutes:contracts.reduce((sum,contract)=>sum+contract.assignment.minutesCap,0),dailyActualMinuteLimit:480};
    }
    return { fundedMinutes: shift?.assignments.reduce((sum, assignment) => sum + assignment.minutesCap, 0) ?? null,
      actualMinutes: shift?.assignments.reduce((sum, assignment) => sum + assignment.workedMinutes, 0) ?? null,
      plannedFullMinutes: shift ? shift.assignments.length * 480 : null, reservedCash: this.reservedPublicShifts(),
      statistics: labor ? { ...labor.stats } : null, shifts: labor?.shifts.map(shift => ({ id: shift.id, day: shift.day, cap: shift.cap, approvedBy: [...shift.approvedBy], siteId: shift.siteId })) ?? [] };
  }
  private reviewPublicShifts(): void {
    const time = this.state.extension?.lastUpdate ?? this.now;
    if (time < (this.runtime.publicLaborReviewAt ?? 0) - 1e-7) return; this.runtime.publicLaborReviewAt = time + 60;
    const day = Math.floor(time / 1440), snapshot = this.publicBudgetSnapshot();
    if (!this.runtime.publicLabor) {
      // Existing standing appropriations remain until cash cannot cover three
      // full days. New promises then require actual departmental review.
      if (this.state.treasury >= snapshot.publicWagesDue + snapshot.publicWagesEarned + snapshot.authorizedRemaining + 3 * (snapshot.forecastPayroll + snapshot.essentialOperations)) return;
      const jobs = Object.fromEntries(this.state.citizens.filter(c => c.role !== '学生' && !this.state.shops.some(shop => shop.buildingId === c.workId) && this.state.extension?.actorProfiles[c.id]?.alive !== false).map(c => [c.id, c.workId]));
      this.runtime.publicLabor = { version: 1, standingUntilDay: day + 1, nextReviewAt: time, jobs, shifts: [], stats: { approvedMinutes: 0, unfundedMinutes: 0, workedMinutes: 0, privateMoves: 0 } };
      this.notice('budget', '财政现金不足以维持三天完整公共班次。来日雇主须实际审议可兑现时数，既有工资债务继续保留。');
    }
    const labor = this.runtime.publicLabor;
    if (time < labor.nextReviewAt - 1e-7) return; labor.nextReviewAt = time + 60;
    const groups = new Map<string, Citizen[]>();
    for (const official of this.state.citizens) {
      const site = this.buildings.get(official.workId);
      if (!site || !['hall', 'core', 'bank'].includes(site.kind) || !['official', 'council', 'mayor'].includes(this.citizenIdentity(official)) || this.state.extension?.actorProfiles[official.id]?.alive === false || official.needs.hunger < 40 || official.needs.fatigue < 35 || !this.isNearBuilding(site, official.position, 2)
        || site.floorPlanProfile === FLOOR_PLAN_PROFILE && !this.isAtBuildingFunctionPoint(site, official.position, 'work', { role: this.citizenIdentity(official), identities: [this.citizenIdentity(official)] }) || this.state.hour < 8 || this.state.hour >= 17) continue;
      const group = groups.get(site.id) ?? []; group.push(official); groups.set(site.id, group);
    }
    const reviewers = [...groups.entries()].filter(([, actors]) => actors.length >= 2).sort((a, b) => a[0].localeCompare(b[0]))[0];
    if (!reviewers) return;
    for (const targetDay of [day, day + 1]) {
      if (targetDay < labor.standingUntilDay || labor.shifts.some(shift => shift.day === targetDay)) continue;
      const budget = this.publicBudgetSnapshot();
      const available = Math.max(0, this.state.treasury - budget.publicWagesDue - budget.publicWagesEarned - budget.authorizedRemaining - this.reservedPublicShifts() - budget.essentialOperations - (day < labor.standingUntilDay ? budget.forecastPayroll : 0));
      const workers = Object.entries(publicEmploymentJobs(labor)).map(([id, workId]) => ({ citizen: this.state.citizens.find(c => c.id === id), workId })).filter(row => row.citizen && row.citizen.workId === row.workId && !this.state.shops.some(shop => shop.buildingId === row.citizen!.workId) && this.state.extension?.actorProfiles[row.citizen.id]?.alive !== false && (this.state.extension?.actorProfiles[row.citizen.id]?.age ?? 20) >= 18);
      const full = workers.reduce((sum, row) => sum + 32 * (.7 + this.state.districts.find(d => d.id === row.citizen!.districtId)!.prosperity / 100), 0), minutesCap = Math.floor(480 * Math.min(1, available / Math.max(1e-9, full)));
      const assignments = workers.map(row => ({ citizenId: row.citizen!.id, workId: row.workId, ratePerMinute: 32 * (.7 + this.state.districts.find(d => d.id === row.citizen!.districtId)!.prosperity / 100) / 480, minutesCap, workedMinutes: 0 }));
      const cap = assignments.reduce((sum, assignment) => sum + assignment.ratePerMinute * minutesCap, 0);
      labor.shifts.push({ id: `public-shift-${targetDay}`, day: targetDay, approvedAt: time, siteId: reviewers[0], approvedBy: reviewers[1].slice(0, 2).map(actor => actor.id), cap, assignments, ...(labor.version===2 ? {employmentRevision:publicEmploymentRevision(labor)} : {}) });
      labor.stats.approvedMinutes += assignments.length * minutesCap; labor.stats.unfundedMinutes += assignments.length * (480 - minutesCap);
      this.bus.emit({ type: 'public-shift-authorized', amount: cap, minutes: assignments.length * minutesCap, siteId: reviewers[0] });
      this.notice('budget', `现场两名任职官员批准第${targetDay + 1}日每人最多${minutesCap}分钟公共劳动，共${cap.toFixed(1)}文真实现金承诺。服务时数不足仍登记等待。`);
    }
    // Closed historical plans retain a bounded review trail; wages and arrears
    // remain independent claims even after these schedule records age out.
    labor.shifts = labor.shifts.filter(shift => shift.day >= day - 14);
    this.reviewPublicTransferContracts();
  }
  isOnDuty(citizenId: string, siteId: string): boolean {
    const citizen = this.state.citizens.find(c => c.id === citizenId), site = this.buildings.get(siteId);
    return !!citizen && !!site && citizen.workId === siteId && citizen.state === 'working' && this.isEmployed(citizen)
      && this.state.extension?.actorProfiles[citizenId]?.alive !== false && (this.runtime.attendance[citizenId] ?? 0) > 0 && this.isNearBuilding(site, citizen.position, 2)
      && (site.floorPlanProfile !== FLOOR_PLAN_PROFILE || this.isAtBuildingFunctionPoint(site, citizen.position, 'work', { role: this.citizenIdentity(citizen), identities: [this.citizenIdentity(citizen)] }));
  }
  quoteSupply(shopId: string, quantity: number) { return quoteSupply(this, shopId, quantity); }
  recordOwnedStockPurchase(shopId: string, quantity: number, unitPrice: number): void { recordOwnedStockPurchase(this, shopId, quantity, unitPrice); }
  supplyConsignment(shopId: string, quantity: number): number { return supplyConsignment(this, shopId, quantity); }
  quoteConsignmentSale(shopId: string, quantity: number, beforeInventory: number) { return quoteConsignmentSale(this, shopId, quantity, beforeInventory); }
  settleConsignmentSale(shopId: string, quantity: number, beforeInventory: number) { return settleConsignmentSale(this, shopId, quantity, beforeInventory); }
  publicBudgetSnapshot() {
    const cash = this.state.treasury;
    const publicWagesDue = [...(this.runtime.wageArrears ?? []), ...this.runtime.wages].filter(wage => wage.shopId === null).reduce((sum, wage) => sum + wage.amount, 0);
    const publicWagesEarned = (this.runtime.wageAccruals ?? []).filter(wage => wage.shopId === null).reduce((sum, wage) => sum + wage.amount, 0);
    const privateSites = new Set(this.state.shops.map(shop => shop.buildingId));
    const forecastPayroll = this.state.citizens.filter(c => !privateSites.has(c.workId) && c.role !== '学生' && (this.state.extension?.actorProfiles[c.id]?.age ?? 20) >= 18 && this.state.extension?.actorProfiles[c.id]?.alive !== false).reduce((sum, c) => sum + 32 * (.7 + this.state.districts.find(d => d.id === c.districtId)!.prosperity / 100), 0);
    const essentialOperations = (this.runtime.operatingCost + 1440 * (.9 + this.state.policeBudget * 1.8)) / 4 * (this.runtime.operationUnitPrice ?? 4);
    const reservedPayroll = this.reservedPublicShifts();
    const labor = this.runtime.publicLabor, day = Math.floor((this.state.extension?.lastUpdate ?? this.now) / 1440);
    // Match publicWorkAllowance: a standing appropriation protects the full
    // forecast; after its expiry only signed current/future labor is promised.
    const protectedPayroll = !labor || day < labor.standingUntilDay ? Math.max(forecastPayroll, reservedPayroll) : reservedPayroll;
    const reserve = publicWagesDue + publicWagesEarned + protectedPayroll + essentialOperations;
    const authorizedRemaining = (this.runtime.publicBudgets ?? []).filter(budget => budget.closedAt === null).reduce((sum, budget) => sum + budget.cap - budget.spent, 0);
    return { cash, publicWagesDue, publicWagesEarned, forecastPayroll, reservedPayroll, essentialOperations, reserve, authorizedRemaining, available: Math.max(0, cash - reserve - authorizedRemaining) };
  }
  authorizeCivicSupplementalBudget(request: PublicBudgetAuthorization): boolean { return authorizeNaturalSupplementalBudget(this, request, this.runtime); }
  authorizePublicBudget(request: PublicBudgetAuthorization): boolean {
    if (this.effectiveRuleset === 'civic-local-v1' && isSupplementalPurpose(request.purpose)) return false;
    const time = this.state.extension?.lastUpdate ?? this.now, site = this.buildings.get(request.siteId), budgets = this.runtime.publicBudgets ??= [];
    if (!site || !finite(request.cap) || request.cap <= 0 || request.cap > 1e6 || !finite(request.approvedAt) || Math.abs(request.approvedAt - time) > 1e-6
      || typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.id) || typeof request.purpose !== 'string' || !request.purpose.length || request.purpose.length > 100
      || !Array.isArray(request.approvedBy) || new Set(request.approvedBy).size !== request.approvedBy.length || budgets.some(budget => budget.id === request.id) || budgets.length >= 256 || request.cap > this.publicBudgetSnapshot().available) return false;
    const signatures: LegacyBudgetAuthorization['signatures'] = [];
    for (const actorId of request.approvedBy) {
      if (actorId === 'player') {
        const chamber = this.buildingNear(undefined, ['hall', 'core']);
        if (!this.hasIdentity('mayor') || !chamber || !this.state.extension?.actorProfiles.player.alive) return false;
        signatures.push({ actorId, role: 'mayor', siteId: chamber.id, signedAt: time });
      } else {
        const actor = this.state.citizens.find(c => c.id === actorId), workplace = actor && this.buildings.get(actor.workId);
        if (!actor || !workplace || !['official', 'council', 'mayor'].includes(this.citizenIdentity(actor)) || !['hall', 'core', 'bank'].includes(workplace.kind) || !this.isOnDuty(actorId, workplace.id)) return false;
        signatures.push({ actorId, role: this.citizenIdentity(actor), siteId: workplace.id, signedAt: time });
      }
    }
    const mayor = signatures.some(signature => signature.role === 'mayor'), council = signatures.filter(signature => signature.role === 'council');
    const departmental = request.cap <= 40 && signatures.length >= 2 && new Set(signatures.map(signature => signature.siteId)).size === 1;
    if (!mayor && !(council.length >= 2) && !departmental) return false;
    budgets.push({ ...request, approvedBy: [...request.approvedBy], spent: 0, closedAt: null, signatures }); return true;
  }
  private recordRoadworkPublicEscrow(amount: number, siteId: string): void {
    const extension = this.state.extension!, site = this.buildings.get(siteId)!;
    Reflect.get(extension, 'runtime').lastTreasury += amount;
    extension.publicLedger.push({ tick: this.state.tick, actorId: 'player', account: 'public', amount, purpose: amount < 0 ? '道路修复授权资金真实划入工地托管' : '道路修复未赚工地托管资金真实退回', districtId: site.districtId });
    if (extension.publicLedger.length > 512) extension.publicLedger.splice(0, extension.publicLedger.length - 512);
  }
  private takeRoadworkPublicEscrow(request: { budgetId: string; siteId: string; purpose: 'road-repair'; amount: number }): boolean {
    const budget = this.runtime.publicBudgets?.find(item => item.id === request.budgetId && item.siteId === request.siteId && item.purpose === request.purpose && item.closedAt === null);
    if (!budget || request.purpose !== 'road-repair' || !finite(request.amount) || request.amount <= 0 || request.amount > budget.cap - budget.spent) return false;
    const snapshot = this.publicBudgetSnapshot(), otherCommitments = snapshot.authorizedRemaining - (budget.cap - budget.spent);
    if (this.state.treasury - snapshot.reserve - otherCommitments < request.amount) return false;
    this.state.treasury -= request.amount; budget.spent += request.amount; this.recordRoadworkPublicEscrow(-request.amount, request.siteId); return true;
  }
  private returnRoadworkPublicEscrow(request: { budgetId: string; siteId: string; purpose: 'road-repair'; amount: number }): number {
    const budget = this.runtime.publicBudgets?.find(item => item.id === request.budgetId && item.siteId === request.siteId && item.purpose === request.purpose && item.closedAt === null);
    if (!budget || request.purpose !== 'road-repair' || !finite(request.amount) || request.amount <= 0) return 0;
    const refunded = Math.min(request.amount, Math.max(0, 1e12 - this.state.treasury), budget.spent);
    if (refunded <= 0) return 0;
    this.state.treasury += refunded; budget.spent -= refunded; this.recordRoadworkPublicEscrow(refunded, request.siteId); return refunded;
  }
  closePublicBudget(id: string): boolean {
    const budget = this.runtime.publicBudgets?.find(item => item.id === id); if (!budget || budget.closedAt !== null) return false;
    budget.closedAt = this.state.extension?.lastUpdate ?? this.now; return true;
  }
  purchasePublicSupplies(request: number, districtId?: string, eventType = 'public-procurement'): number {
    return this.purchasePublicSupplyReceipt({ requestedGross: request, districtId, eventType }).paid;
  }
  purchasePublicSupplyReceipt(request: PublicPurchaseRequest): PublicPurchaseReceipt {
    const receipt: PublicPurchaseReceipt = { paid: 0, quantity: 0, tax: 0, lots: [] };
    if (request.requestedGross === 0 || request.requestedQuantity === 0) { receipt.reason = 'budget'; return receipt; }
    if (request.requestedQuantity !== undefined && (!finite(request.requestedQuantity) || request.requestedQuantity < 0 || request.requestedQuantity > 1e8)) { receipt.reason = 'authorization'; return receipt; }
    if (!finite(request.requestedGross) || request.requestedGross <= 0 || request.requestedGross > 1e9 || request.reserveCash !== undefined && (!finite(request.reserveCash) || request.reserveCash < 0)
      || request.districtId !== undefined && !this.state.districts.some(d => d.id === request.districtId) || request.siteId !== undefined && !this.buildings.has(request.siteId)) return receipt;
    if (request.supplierShopIds !== undefined && (!Array.isArray(request.supplierShopIds) || request.supplierShopIds.length === 0 || request.supplierShopIds.length > this.state.shops.length
      || new Set(request.supplierShopIds).size !== request.supplierShopIds.length || request.supplierShopIds.some(id => typeof id !== 'string' || !this.state.shops.some(shop => shop.id === id)))) { receipt.reason = 'authorization'; return receipt; }
    const budget = request.budgetId ? this.runtime.publicBudgets?.find(item => item.id === request.budgetId && item.closedAt === null && item.siteId === request.siteId && item.purpose === request.purpose) : undefined;
    if (request.budgetId && !budget) { receipt.reason = 'authorization'; return receipt; }
    const snapshot = this.publicBudgetSnapshot(), others = snapshot.authorizedRemaining - (budget ? budget.cap - budget.spent : 0);
    // Discretionary departments cannot spend cash already promised to workers
    // or other authorized services. Essential upkeep protects the same claims
    // while drawing its own reserved material allowance.
    const obligations = snapshot.publicWagesDue + snapshot.publicWagesEarned + snapshot.reservedPayroll + others;
    const reserve = Math.max(request.reserveCash ?? 0, request.eventType === 'public-procurement' ? obligations : snapshot.reserve + others);
    const requested = Math.min(request.requestedGross, budget ? budget.cap - budget.spent : request.requestedGross);
    const suppliers = this.state.shops.filter(shop => this.shopCommodity(shop) === 'materials' && shop.inventory > 0 && (!request.supplierShopIds || request.supplierShopIds.includes(shop.id))).sort((a, b) => Number(b.districtId === request.districtId) - Number(a.districtId === request.districtId) || b.inventory - a.inventory);
    for (const supplier of suppliers) {
      const quote = this.quoteSupply(supplier.id, Math.min(supplier.inventory, Math.max(0, (request.requestedQuantity ?? Infinity) - receipt.quantity))), unitPrice = quote.unitPrice;
      const gross = Math.min(Math.max(0, requested - receipt.paid), Math.max(0, this.state.treasury - reserve), Math.max(0, 1e9 - this.shopFunds(supplier)) / (1 - this.state.taxRate), quote.quantity * unitPrice);
      if (gross <= 1e-9) break;
      const net = gross * (1 - this.state.taxRate), quantity = gross / unitPrice, tax = gross - net;
      supplier.inventory -= quantity; this.state.treasury -= gross; this.transferShopFunds(supplier, net); supplier.revenue += gross; supplier.profit += net; this.runtime.taxes += tax;
      receipt.paid += gross; receipt.quantity += quantity; receipt.tax += tax; receipt.lots.push({ shopId: supplier.id, quantity, gross, net, unitPrice });
      if (budget) budget.spent += gross;
      this.bus.emit({ type: request.eventType ?? (budget ? 'civic-procurement' : 'public-procurement'), shopId: supplier.id, districtId: supplier.districtId, amount: gross, quantity, unitPrice, siteId: request.siteId, procurementId: request.procurementId, budgetId: request.budgetId, purpose: request.purpose });
    }
    if (receipt.paid + 1e-7 < requested || request.requestedQuantity !== undefined && receipt.quantity + 1e-7 < request.requestedQuantity) receipt.reason = requested - receipt.paid <= 1e-7 || this.state.treasury - reserve <= 1e-7 ? 'budget' : 'supply';
    return receipt;
  }
  private initializeShopAccounts(): void {
    for (const shop of this.state.shops) {
      const owner = this.state.citizens.find(c => c.id === shop.ownerId) ?? this.state.citizens.find(c => c.workId === shop.buildingId && c.role !== '学生' && this.state.extension?.actorProfiles[c.id]?.alive !== false) ?? this.state.citizens.find(c => c.districtId === shop.districtId && c.role !== '学生');
      if (owner && shop.ownerId !== 'player') shop.ownerId = owner.id;
      if (shop.cash !== undefined) continue;
      // Pre-account saves migrate by moving the proprietor's existing savings.
      // Incorporated shops already hold their separately recorded real capital.
      const company = this.state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId);
      const contribution = !company && shop.employees > 0 && owner ? Math.min(owner.money * .2, 80) : 0;
      if (owner) owner.money -= contribution;
      shop.cash = contribution;
    }
    for (const id of [...this.runtime.playerBusinesses]) { const shop = this.state.shops.find(shop => shop.id === id); if (shop && shop.lifecycleVersion !== 1 && !this.state.extension?.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)) this.transferBusinessOwnership(id, 'player'); }
    for (const citizen of this.state.citizens) citizen.food ??= 0;
    this.runtime.shopLabor ??= {}; this.runtime.cargoSources ??= {};
    this.runtime.freightLots ??= Object.fromEntries(Object.entries(this.runtime.freight).map(([id, quantity]) => [id, [{ shopId: null, quantity }]]));
    if (this.runtime.accountingVersion === undefined) {
      // Previous saves charged only paid wages. Recognize the unpaid liability
      // and unfinished actual attendance once, without creating any cash.
      for (const owed of this.runtime.wageArrears ?? []) { const shop = this.state.shops.find(s => s.id === owed.shopId); if (shop) shop.profit -= owed.amount; }
      this.runtime.wageAccruals ??= [];
      if (!this.runtime.wageAccruals.length) for (const [id, minutes] of Object.entries(this.runtime.attendance)) {
        const citizen = this.state.citizens.find(c => c.id === id); if (citizen && minutes > 0) this.accrueWork(citizen, Math.min(480, minutes), false);
      }
      this.runtime.accountingVersion = 2;
    }
    for (const wage of this.runtime.wages) if (!wage.expenseAccrued) {
      const citizen = this.state.citizens.find(c => c.id === wage.citizenId);
      if (wage.shopId === undefined) wage.shopId = citizen ? this.state.shops.find(s => s.buildingId === citizen.workId)?.id ?? null : null;
      const shop = this.state.shops.find(s => s.id === wage.shopId); if (shop) shop.profit -= wage.amount;
      wage.expenseAccrued = true;
    }
  }
  private receivePublicFee(amount: number, purpose: string, districtId: string): void {
    if (amount <= 0) return;
    this.state.player.money -= amount; this.state.treasury += amount;
    const extension = this.state.extension as (SimState['extension'] & { runtime?: { lastTreasury: number } });
    if (extension) {
      if (extension.runtime) extension.runtime.lastTreasury += amount;
      extension.publicLedger.push({ tick: this.state.tick, actorId: 'player', amount, purpose, districtId, account: 'public' });
      if (extension.publicLedger.length > 512) extension.publicLedger.splice(0, extension.publicLedger.length - 512);
    }
    this.bus.emit({ type: 'public-receipt', citizenId: 'player', districtId, amount, purpose });
  }
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
    const refreshRoadRoutes = (event: Event) => {
      // Capture the original ordinary journey before the old pure revision
      // overwrites it. Only actual failed replans submit a named request.
      const blocked = event.type === 'road-edge-closed' && event.closureId
        ? this.state.citizens.filter(c => !this.runtime.riders[c.id]).map(c => captureBlockedRoadIntent(this.world, this.state, c, event.closureId!, this.runtime.activities[c.id] ?? 'travel')).filter((w): w is RoadBlockWitness => w !== null) : [];
      // A close/reopen can occur after some people were processed this phase.
      // Finish the pure routing revision now, so a save never carries an
      // unrecorded WeakMap debt that only the live source would apply next tick.
      this.ensureRoadRouting();
      for (const citizen of this.state.citizens) this.refreshCitizenRoadRoute(citizen);
      for (const witness of blocked) if (roadIntentStillBlocked(this.state, witness)) {
        const cause: Event = Object.freeze({ type: 'road-route-blocked', citizenId: witness.actorId, roadBlock: Object.freeze({ ...witness, position: Object.freeze({ ...witness.position }), from: Object.freeze({ ...witness.from }), to: Object.freeze({ ...witness.to }) }) });
        canonicalRoadBlock.add(cause); this.bus.emit(cause);
      }
    };
    this.bus.on('road-edge-closed', refreshRoadRoutes); this.bus.on('road-edge-reopened', refreshRoadRoutes);
    this.bus.on('wage', e => {
      if (!e.citizenId || !e.districtId) return;
      const citizen = this.state.citizens.find(c => c.id === e.citizenId), shopId = e.expenseAccrued ? e.shopId ?? null : e.shopId ?? (citizen ? this.state.shops.find(shop => shop.buildingId === citizen.workId)?.id ?? null : null);
      const amount = e.amount ?? 0, shop = this.state.shops.find(s => s.id === shopId);
      if (!e.expenseAccrued) { if (shop) shop.profit -= amount; this.bus.emit({ type: 'wage-earned', citizenId: e.citizenId, shopId: shop?.id, districtId: e.districtId, amount }); }
      this.runtime.wages.push({ citizenId: e.citizenId, districtId: e.districtId, amount, shopId, expenseAccrued: true });
    });
    this.bus.on('sale', e => { this.runtime.taxes += (e.amount ?? 0) * this.state.taxRate; this.state.gdp += e.amount ?? 0; this.state.metrics.trades++; });
    this.bus.on('business-expense', e => { this.state.treasury += e.amount ?? 0; });
    this.bus.on('wholesale', e => { this.runtime.taxes += (e.amount ?? 0) * this.state.taxRate; });
    this.bus.on('cargo-arrived', e => { if (e.districtId) { this.runtime.freight[e.districtId] = (this.runtime.freight[e.districtId] ?? 0) + (e.amount ?? 0); const lots = this.runtime.freightLots ??= {}, deliveries = lots[e.districtId] ??= [], owner = e.shopId ?? null; const existing = deliveries.find(lot => lot.shopId === owner); if (existing) existing.quantity += e.amount ?? 0; else deliveries.push({ shopId: owner, quantity: e.amount ?? 0 }); } this.state.metrics.freight += e.amount ?? 0; });
    this.bus.on('crime-resolved', e => { const district = this.state.districts.find(d => d.id === e.districtId); if (district) district.safety = clamp(district.safety + 1.8); this.state.metrics.crimesResolved++; });
    this.bus.on('commute', () => this.state.metrics.commutes++);
    this.bus.on('flight', () => this.state.metrics.flights++);
    this.bus.on('transit-fare', e => { const paid = e.amount ?? 0; this.state.treasury += paid; this.state.gdp += paid; });
    this.bus.on('customer', e => { if (e.citizenId && e.shopId) this.runtime.customers[e.citizenId] = e.shopId; });
    this.bus.on('dispatch', e => {
      const officer = this.state.citizens.find(c => c.id === e.citizenId), crime = this.state.crimes.find(c => c.id === e.crimeId);
      if (!officer || !crime) return;
      const target = this.world.buildings.reduce((a, b) => distance(crime.position, b.door) < distance(crime.position, a.door) ? b : a);
      this.runtime.dispatches[officer.id] = { crimeId: crime.id, arrived: false }; this.rebuildDispatchRoute(officer, crime, target);
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
      this.pruneNpcStairCursors();
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
  appendNotice(type: string, text: string, districtId?: string): number { return this.notice(type, text, districtId); }
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
  private legacyEnergyContract(): LegacyEnergyContract | null {
    if (this.runtime.legacyEnergyContract) return this.runtime.legacyEnergyContract;
    // A declared Power lifecycle already interpreted the old deadline.
    // Display rewind cannot turn its expired/unfunded timer into a new paid contract.
    if (this.state.power) return null;
    // Untouched/default/unsupported worlds get no optional fields. A genuine
    // previously-paid active deadline is converted once, with its remaining
    // duration, not a fresh four hours and not a second new asset's capacity.
    const remaining = this.runtime.energyBoostUntil - this.now;
    if (this.runtime.legacyEnergyContractVersion === undefined && remaining > 0 && remaining <= 240 + 1e-7 && powerBinding(this.world)) {
      const capturedAt = this.state.extension!.lastUpdate;
      this.runtime.legacyEnergyContractVersion = 1;
      this.runtime.legacyEnergyContract = { version: 1, capturedAt, sourceDisplayNow: this.now, sourceDisplayDeadline: this.runtime.energyBoostUntil, duration: remaining, endsAt: capturedAt + remaining };
      return this.runtime.legacyEnergyContract;
    }
    return null;
  }
  private energy() {
    const night = this.state.hour < 6 || this.state.hour >= 19;
    const demand = 53 + (night ? 19 : 8) + this.state.shops.filter(s => s.open).length * .08 + this.state.vehicles.length * .08;
    const contract = this.legacyEnergyContract();
    const legacy = contract ? (this.state.extension!.lastUpdate < contract.endsAt ? 20 : 0) : (this.now < this.runtime.energyBoostUntil ? 20 : 0);
    const generation = (93 + Math.sin(this.now / 130) * 3 + legacy) * (.35 + .65 * (this.runtime.publicSupply ?? 1));
    if (!this.state.power && !this.world.powerGrid) {
      this.state.energy = clamp(generation / Math.max(1, demand) * 78 - this.state.districts.reduce((n, d) => n + d.pollution, 0) / Math.max(1, this.state.districts.length) * .08);
      for (const district of this.state.districts) district.energy = clamp(this.state.energy - district.pollution * .04);
    }
    const cost = this.minutes * (.9 + this.state.policeBudget * 1.8); this.runtime.operatingCost += cost;
    this.bus.emit({ type: 'municipal-operation-accrual', amount: cost, minutes: this.minutes });
  }
  private pointOn(edge: NetworkEdge, progress: number): Vec3 {
    const points = edge.points.length >= 2 ? edge.points : [this.world.nodes.find(n => n.id === edge.from)!.position, this.world.nodes.find(n => n.id === edge.to)!.position];
    let total = 0; for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
    let remaining = clamp(progress, 0, 1) * total;
    for (let i = 1; i < points.length; i++) { const length = distance(points[i - 1], points[i]); if (remaining <= length || i === points.length - 1) { const t = length ? clamp(remaining / length, 0, 1) : 0; return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t, z: points[i - 1].z + (points[i].z - points[i - 1].z) * t }; } remaining -= length; }
    return copy(points[0]);
  }
  private updateSignals() { this.state.signals = Object.fromEntries(this.world.nodes.filter(n => (this.neighbors.get(n.id) ?? []).some(e => e.edge.mode === 'road')).map(n => [n.id, (this.runtime.signalOverrides[n.id] ?? ((Math.floor((this.now + 1e-7) / 6) + hash(n.id) % 4) % 2)) as 0 | 1])); }
  private usesRoadFoodDelivery(vehicle: Vehicle): boolean {
    return this.runtime.freightDeliveryPolicyId === ROAD_FOOD_DELIVERY_POLICY && vehicle.kind === 'road' && vehicle.cargo > 0 && !!this.runtime.cargoSources?.[vehicle.id];
  }
  private roadFoodDelivery(vehicle: Vehicle, nodeId: string) {
    if (!this.usesRoadFoodDelivery(vehicle)) return null;
    const source = this.state.shops.find(shop => shop.id === this.runtime.cargoSources![vehicle.id]);
    if (!source || this.shopCommodity(source) !== 'food' || !['farm', 'dock'].includes(this.buildings.get(source.buildingId)!.kind)) return null;
    // quote.quantity concerns the producer's remaining stock; already-loaded
    // cargo uses its current unitPrice even when that stock is now empty.
    // Traffic changes custody and producer stock, never shop wallets, payroll
    // claims or retail stock. Scan those protected accounts once per traffic
    // phase; queue custody below remains live for every junction decision.
    const accounts = this.freightDeliveryAccounts ??= {
      retail: this.state.shops.filter(shop => this.buildings.get(shop.buildingId)!.kind === 'market').map(shop => ({ shopId: shop.id, funds: this.shopFunds(shop), protectedFunds: this.shopProtectedFunds(shop) })),
      suppliers: this.state.shops.filter(shop => ['farm', 'dock', 'workshop'].includes(this.buildings.get(shop.buildingId)!.kind)).map(shop => ({ shopId: shop.id, funds: this.shopFunds(shop), unitPrice: this.quoteSupply(shop.id, 1).unitPrice })),
    };
    const account = accounts.suppliers.find(row => row.shopId === source.id)!;
    const offers = foodRetailDeliveryOffers(this.world, this.state.shops, {
      sourceShopId: source.id, sourceFunds: account.funds, unitPrice: account.unitPrice, taxRate: this.state.taxRate,
      ...accounts,
      freightTotals: this.runtime.freight,
      freightLots: this.runtime.freightLots ?? {},
    });
    return this.freightDeliveryRouter.route(this.state, nodeId, offers, vehicle.cargo);
  }
  private traffic() {
    this.freightDeliveryAccounts = undefined;
    // Keep an imported legacy save byte-identical until real time advances.
    // Materialize its observation clock before a deferred actor can save again,
    // so post-load time survives another import without backfilling old rides.
    for (const rider of Object.values(this.runtime.riders)) if (rider.arrived === true && rider.arrivedAt === undefined) {
      rider.arrivedAt = this.legacyRiderArrivalAt.get(rider) ?? (this.state.extension?.lastUpdate ?? this.now);
      this.legacyRiderArrivalAt.delete(rider);
    }
    this.updateSignals();
    const lanes = new Map<string, Vehicle[]>();
    for (const vehicle of this.state.vehicles) { const key = `${vehicle.edgeId}:${vehicle.direction}`; const list = lanes.get(key) ?? []; list.push(vehicle); lanes.set(key, list); }
    for (const vehicle of this.state.vehicles) {
      const edge = this.edges.get(vehicle.edgeId)!;
      const roadActor = `vehicle:${vehicle.id}`;
      // Endpoint waiting is not occupancy permission. Only a captured mid-edge
      // vehicle can leave a newly closed deck; an endpoint may select an open leg.
      if (!isRoadOpen(this.state, edge.id) && (vehicle.progress === 0 || vehicle.progress === 1)) {
        const nodeId = vehicle.progress === 0 ? edge.from : edge.to;
        releaseRoadExitPermit(this.world, this.state, roadActor, vehicle.position);
        const exits = (this.neighbors.get(nodeId) ?? []).filter(n => n.edge.mode === vehicle.kind && n.edge.id !== edge.id && isRoadOpen(this.state, n.edge.id));
        if (!exits.length) { vehicle.state = 'roadClosed'; if (this.isDriving(vehicle.id)) this.runtime.driving.speed = 0; continue; }
        const directed = !this.isDriving(vehicle.id) && this.usesRoadFoodDelivery(vehicle) ? this.roadFoodDelivery(vehicle, nodeId)?.next : null;
        const outgoing = directed ?? (this.isDriving(vehicle.id) ? this.chooseTurn(edge, vehicle.progress === 0 ? -1 : 1, nodeId, exits) : exits[Math.floor(this.random() * exits.length)]);
        vehicle.edgeId = outgoing.edge.id; vehicle.direction = outgoing.edge.from === nodeId ? 1 : -1; vehicle.progress = vehicle.direction > 0 ? 0 : 1;
        vehicle.state = 'boarding'; vehicle.nextDeparture = Math.max(vehicle.nextDeparture, this.now + (this.isDriving(vehicle.id) ? 2 : 8));
        continue;
      }
      const energy = this.state.powerGrid ? gridVehicleSupplyRatio(this.state, vehicle.id) : this.state.energy / 100;
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
      if (!roadMovementAllowed(this.world, this.state, roadActor, vehicle.position, this.pointOn(edge, nextProgress))) { vehicle.state = 'roadClosed'; if (manual) this.runtime.driving.speed = 0; continue; }
      vehicle.progress = nextProgress;
      vehicle.position = this.pointOn(edge, vehicle.progress);
      if (vehicle.kind === 'road') { const front = this.pointOn(edge, Math.min(1, vehicle.progress + .001)), back = this.pointOn(edge, Math.max(0, vehicle.progress - .001)); const dx = front.x - back.x, dz = front.z - back.z, length = Math.hypot(dx, dz); if (length > .001) { vehicle.position.x -= dz / length * vehicle.direction * 1.3; vehicle.position.z += dx / length * vehicle.direction * 1.3; } }
      if (vehicle.progress === 0 && vehicle.direction < 0 || vehicle.progress === 1 && vehicle.direction > 0) {
        const nodeId = vehicle.direction > 0 ? edge.to : edge.from;
        const node = this.world.nodes.find(n => n.id === nodeId)!;
        if (oldProgress > 0 && oldProgress < 1) this.bus.emit({ type: 'vehicle-arrived', vehicleId: vehicle.id, nodeId, fromEdgeId: edge.id, arrivedAt: this.state.extension?.lastUpdate ?? this.now });
        for (const rider of Object.values(this.runtime.riders)) if (rider.vehicleId === vehicle.id && rider.stopNodeId === nodeId && !rider.arrived) { rider.arrived = true; rider.arrivedAt = this.state.extension?.lastUpdate ?? this.now; vehicle.passengers = Math.max(0, vehicle.passengers - 1); }
        releaseRoadExitPermit(this.world, this.state, roadActor, vehicle.position);
        let candidates = (this.neighbors.get(nodeId) ?? []).filter(n => n.edge.mode === vehicle.kind && n.edge.id !== edge.id && isRoadOpen(this.state, n.edge.id));
        if (!isRoadOpen(this.state, edge.id) && !candidates.length) { vehicle.state = 'roadClosed'; if (manual) this.runtime.driving.speed = 0; continue; }
        if (vehicle.kind === 'road') {
          const offset = hash(nodeId) % 4;
          const green = this.state.signals?.[nodeId] ?? ((Math.floor((this.now + 1e-7) / 48) + offset) % 2);
          if (green !== (vehicle.direction > 0 ? 1 : 0)) { vehicle.state = 'redLight'; vehicle.nextDeparture = this.now + 2; if (manual) this.runtime.driving.speed = 0; continue; }
        }
        const directedCargo = this.usesRoadFoodDelivery(vehicle), delivery = directedCargo ? this.roadFoodDelivery(vehicle, nodeId) : null;
        if (vehicle.cargo > 0 && (!directedCargo || delivery?.arrived)) { this.bus.emit({ type: 'cargo-arrived', districtId: node.districtId, amount: vehicle.cargo, shopId: this.runtime.cargoSources?.[vehicle.id], ...(directedCargo ? { vehicleId: vehicle.id, nodeId } : {}) }); vehicle.cargo = 0; if (this.runtime.cargoSources) delete this.runtime.cargoSources[vehicle.id]; }
        const freightCarrier = this.freightCarriers.get(vehicle.id);
        const activePassengers = Object.values(this.runtime.riders).filter(rider => rider.vehicleId === vehicle.id && !rider.arrived).length + (this.state.player.vehicleId === vehicle.id ? 1 : 0);
        // Empty road carriers retain their existing ten-seat passenger use.
        // Cargo cannot replace people who boarded legitimately while empty.
        const loadedPassengerCapacity = vehicle.kind === 'road' ? 2 : this.passengerCapacity(vehicle);
        if (freightCarrier?.kind === vehicle.kind && vehicle.cargo === 0 && Math.max(vehicle.passengers, activePassengers) <= loadedPassengerCapacity) {
          const producer = this.state.shops.find(shop => {
            const site = this.buildings.get(shop.buildingId)!;
            return ['farm', 'dock'].includes(site.kind) && this.shopCommodity(shop) === 'food' && shop.inventory >= 1
              && (this.runtime.freightPickupPolicyId === ROAD_FOOD_PICKUP_POLICY && vehicle.kind === 'road'
                ? !!freightPickupAccess(this.world, this.state, vehicle, nodeId, site)
                : this.isNearBuilding(site, node.position, 2) && this.isNearBuilding(site, vehicle.position, 2));
          });
          if (producer) {
            vehicle.cargo = Math.min(producer.inventory, freightCarrier.cargoCapacity); producer.inventory -= vehicle.cargo;
            (this.runtime.cargoSources ??= {})[vehicle.id] = producer.id;
            this.bus.emit({ type: 'cargo-loaded', vehicleId: vehicle.id, nodeId, shopId: producer.id, districtId: producer.districtId, amount: vehicle.cargo, quantity: vehicle.cargo });
          }
        }
        if (vehicle.kind === 'flight') this.bus.emit({ type: 'flight' });
        vehicle.passengers = Object.values(this.runtime.riders).filter(r => r.vehicleId === vehicle.id && !r.arrived).length + (this.state.player.vehicleId === vehicle.id ? 1 : 0);
        // The departure graph excludes every closed leg, including a reverse.
        candidates = candidates.filter(n => isRoadOpen(this.state, n.edge.id));
        const directed = !manual && this.usesRoadFoodDelivery(vehicle) ? this.roadFoodDelivery(vehicle, nodeId)?.next : null;
        if (directed) { vehicle.edgeId = directed.edge.id; vehicle.direction = directed.edge.from === nodeId ? 1 : -1; vehicle.progress = vehicle.direction > 0 ? 0 : 1; }
        else {
          if (vehicle.kind === 'road' && !manual) { const mainRoads = candidates.filter(c => this.world.nodes.find(n => n.id === c.edge.from)?.station && this.world.nodes.find(n => n.id === c.edge.to)?.station); if (mainRoads.length && this.random() < .85) candidates = mainRoads; }
          if (candidates.length && ['road', 'lightRail', 'maglev', 'ferry'].includes(vehicle.kind)) { const chosen = manual ? this.chooseTurn(edge, vehicle.direction, nodeId, candidates) : candidates[Math.floor(this.random() * candidates.length)]; vehicle.edgeId = chosen.edge.id; vehicle.direction = chosen.edge.from === nodeId ? 1 : -1; vehicle.progress = vehicle.direction > 0 ? 0 : 1; }
          else if (isRoadOpen(this.state, edge.id)) vehicle.direction *= -1;
          else { vehicle.state = 'roadClosed'; if (manual) this.runtime.driving.speed = 0; continue; }
        }
        vehicle.state = 'boarding';
        const maintenance = Object.entries(this.state.culture?.transportMaintenance ?? {}).some(([siteId, item]) => item.maintainedUntil > (this.state.extension?.lastUpdate ?? this.now) && item.units >= 4 && this.state.culture?.orders.some(order => order.id === item.orderId && order.state === 'fulfilled') && this.buildings.get(siteId)?.kind === 'station' && distance(this.buildings.get(siteId)!.door, node.position) <= 40);
        const dwell = manual ? 2 : vehicle.kind === 'flight' ? 75 : vehicle.kind === 'road' ? 8 : this.state.hour >= 22 || this.state.hour < 6 ? 48 : 16;
        vehicle.nextDeparture = this.now + dwell - (!manual && vehicle.kind !== 'flight' && maintenance ? .5 : 0);
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
  private resetRoadRouting(): void {
    this.routingState = undefined; this.routingRevision = -1; this.routeCache.clear(); this.walkingTrees.clear();
    this.citizenRoadRevisions = new WeakMap(this.state.citizens.map(c => [c, roadRevision(this.state)] as const));
  }
  private ensureRoadRouting(): number {
    const revision = roadRevision(this.state);
    if (this.routingState !== this.state || this.routingRevision !== revision) {
      this.routeCache.clear(); this.walkingTrees.clear(); this.routingState = this.state; this.routingRevision = revision;
    }
    return revision;
  }
  private roadRouteWaiting(citizen: Citizen): void { citizen.state = 'roadWaiting'; }
  private refreshCitizenRoadRoute(citizen: Citizen): void {
    const revision = this.ensureRoadRouting(), oldRevision = this.citizenRoadRevisions.get(citizen);
    this.citizenRoadRevisions.set(citizen, revision);
    if (oldRevision === undefined || oldRevision === revision || this.runtime.riders[citizen.id] || this.state.extension?.actorProfiles[citizen.id]?.alive === false) return;
    const roadTask = this.state.roadworks && roadworkTask(this, citizen.id);
    if (roadTask) {
      citizen.route = this.routeToRoadwork(citizen, roadTask); citizen.routeIndex = 1;
      citizen.state = citizen.route.length > 1 || distance(citizen.position, roadTask.point) < .05 ? 'roadWorkMoving' : 'roadWorkWaiting'; return;
    }
    const destination = citizen.destinationId && this.buildings.get(citizen.destinationId);
    if (!destination) return;
    const dispatch = this.runtime.dispatches[citizen.id], crime = dispatch && this.state.crimes.find(c => c.id === dispatch.crimeId);
    // A real investigator already at this incident has no remaining travel
    // obligation. A road revision must not send it back to the facility anchor.
    if (crime && dispatch?.arrived && distance(citizen.position, crime.position) <= 3) return;
    if (crime) this.rebuildDispatchRoute(citizen, crime, destination);
    else this.setDestination(citizen, destination, true);
  }
  private rebuildDispatchRoute(officer: Citizen, crime: Crime, destination: Building): void {
    // The nearest facility is an original routing anchor, never the crime's
    // physical arrival point. Validate its full tail before paying a response.
    const base = this.routeFromCitizen(officer, destination), route = [...base, copy(crime.position)];
    officer.destinationId = destination.id; officer.route = route; officer.routeIndex = 1;
    if ((base.length > 1 || distance(officer.position, destination.door) < .05) && this.roadPrefixAllowed(officer, route)) {
      officer.state = 'responding'; return;
    }
    // A captured occupant may still leave in its original permitted direction.
    // The dispatch, facility target and crime remain saved while its tail waits.
    const exit = roadExitRoute(this.world, this.state, officer.id, officer.position);
    if (exit && exit.points.length > 1 && this.roadPrefixAllowed(officer, exit.points)) {
      officer.route = exit.points.map(copy); officer.routeIndex = 1; officer.state = 'responding'; return;
    }
    this.roadRouteWaiting(officer);
  }
  private roadPrefixAllowed(citizen: Citizen, points: Vec3[]): boolean {
    return points.every((p, i) => !i || roadMovementAllowed(this.world, this.state, citizen.id, points[i - 1], p));
  }
  private walkingPrefixAllowed(citizen: Citizen, points: Vec3[]): boolean {
    if (!this.roadPrefixAllowed(citizen, points)) return false;
    if (this.runtime.npcMotionVersion !== 2) return true;
    // An old route is only an anchor candidate. Check its actual body path
    // before reusing a doorway shortcut; planning never changes the actor.
    let position = copy(citizen.position);
    for (let index = 1; index < points.length; index++) {
      const description = this.npcStairMotion.describe(points, index);
      if (description.kind === 'blocked') return false;
      if (description.kind === 'legacy') {
        if (!this.citizenReferenceSegmentAllowed(citizen, position, points[index], description.bodies ?? [])) return false;
        position = copy(points[index]); continue;
      }
      const cursor = this.npcStairMotion.opening(points, index)!;
      try {
        this.npcStairMotion.validate(points, cursor, position);
        const advanced = this.npcStairMotion.advance(points, cursor, description.leg.length, (from, to, building, floor) =>
          roadMovementAllowed(this.world, this.state, citizen.id, from, to) && this.citizenPhysicalSegmentAllowed(citizen, from, to, building, floor));
        if (advanced.blocked || !advanced.finishedLeg) return false;
        position = advanced.position;
      } catch { return false; }
    }
    return true;
  }
  private cacheRoute(key: string, points: Vec3[]): void { if (this.routeCache.size >= 2048) this.routeCache.delete(this.routeCache.keys().next().value!); this.routeCache.set(key, points); }
  private walkingTree(start: string) {
    this.ensureRoadRouting();
    const cached = this.walkingTrees.get(start); if (cached) { this.walkingTrees.delete(start); this.walkingTrees.set(start, cached); return cached; }
    const costs = new Map<string, number>([[start, 0]]), previous = new Map<string, { node: string; edge: NetworkEdge }>();
    const heap: { node: string; cost: number }[] = [];
    const push = (entry: { node: string; cost: number }) => { heap.push(entry); let index = heap.length - 1; while (index) { const parent = (index - 1) >> 1; if (heap[parent].cost <= entry.cost) break; heap[index] = heap[parent]; index = parent; } heap[index] = entry; };
    const pop = () => { const first = heap[0], last = heap.pop()!; if (heap.length) { let index = 0; while (index * 2 + 1 < heap.length) { const left = index * 2 + 1, right = left + 1, child = right < heap.length && heap[right].cost < heap[left].cost ? right : left; if (heap[child].cost >= last.cost) break; heap[index] = heap[child]; index = child; } heap[index] = last; } return first; };
    push({ node: start, cost: 0 });
    while (heap.length) { const next = pop(); if (next.cost !== costs.get(next.node)) continue; for (const neighbor of this.neighbors.get(next.node) ?? []) { if (!['road', 'bridge'].includes(neighbor.edge.mode) || !isRoadOpen(this.state, neighbor.edge.id)) continue; const cost = next.cost + neighbor.edge.length; if (cost < (costs.get(neighbor.node) ?? Infinity)) { costs.set(neighbor.node, cost); previous.set(neighbor.node, { node: next.node, edge: neighbor.edge }); push({ node: neighbor.node, cost }); } } }
    const tree = { costs, previous }; if (this.walkingTrees.size >= 384) this.walkingTrees.delete(this.walkingTrees.keys().next().value!); this.walkingTrees.set(start, tree); return tree;
  }
  private nodePath(from: string, to: string): Vec3[] {
    this.ensureRoadRouting();
    const key = `node:${from}>${to}`, cached = this.routeCache.get(key); if (cached) return cached;
    const previous = this.walkingTree(from).previous, legs: { node: string; edge: NetworkEdge }[] = []; let cursor = to;
    while (cursor !== from && previous.has(cursor)) { const leg = previous.get(cursor)!; legs.unshift(leg); cursor = leg.node; }
    if (cursor !== from) return [];
    const points: Vec3[] = [copy(this.world.nodes.find(n => n.id === from)!.position)];
    for (const leg of legs) for (const point of leg.edge.from === leg.node ? leg.edge.points : [...leg.edge.points].reverse()) points.push(copy(point));
    this.cacheRoute(key, points); return points;
  }
  private walkingAnchors(citizen: Citizen): { node: string; cost: number; points: Vec3[] }[] {
    const permittedExit = roadExitRoute(this.world, this.state, citizen.id, citizen.position);
    if (permittedExit) return [{ node: permittedExit.exitNodeId, cost: permittedExit.points.slice(1).reduce((n, p, i) => n + distance(permittedExit.points[i], p), 0), points: permittedExit.points.map(copy) }];
    const interior = this.world.buildings.find(b => b.floorPlanProfile === FLOOR_PLAN_PROFILE ? !!this.floorPlanPresence(b, citizen.position) : this.isNearBuilding(b, citizen.position, 0));
    if (interior) {
      if (interior.floorPlanProfile === FLOOR_PLAN_PROFILE) {
        const presence = this.floorPlanPresence(interior, citizen.position)!;
        const points = this.floorPlanRoute(interior, presence.floor, 0, citizen.position, interior.door);
        if (!points) return [];
        const node = this.buildingNode(interior); points.push(copy(node.position));
        return this.roadPrefixAllowed(citizen, points) ? [{ node: node.id, cost: points.slice(1).reduce((n, p, i) => n + distance(points[i], p), 0), points }] : [];
      }
      const floor = Math.floor((citizen.position.y - interior.position.y + .01) / (interior.height / interior.floors));
      const points = [copy(citizen.position), ...(floor ? [getStairPosition(interior, floor), getStairPosition(interior, 0)] : []), copy(interior.door)];
      const node = this.buildingNode(interior); points.push(copy(node.position)); let cost = 0; for (let i = 1; i < points.length; i++) cost += distance(points[i - 1], points[i]);
      return this.roadPrefixAllowed(citizen, points) ? [{ node: node.id, cost, points }] : [];
    }
    // Reuse the street segment the citizen actually occupies. Replanning must
    // not send an actor back to an unrelated nearby building's entire route.
    const anchors: { node: string; cost: number; points: Vec3[] }[] = [], route = citizen.route ?? [], index = citizen.routeIndex ?? 0;
    for (const direction of [-1, 1]) { const points = [copy(citizen.position)]; let cost = 0; for (let i = direction < 0 ? index - 1 : index; i >= 0 && i < route.length; i += direction) { if (!roadMovementAllowed(this.world, this.state, citizen.id, points.at(-1)!, route[i])) break; cost += distance(points.at(-1)!, route[i]); points.push(copy(route[i])); const node = this.nodeAt.get(this.pointKey(route[i])); if (node) { if (this.walkingPrefixAllowed(citizen, points)) anchors.push({ node, cost, points }); break; } } }
    if (anchors.length) return anchors;
    if (this.runtime.npcMotionVersion === 2) {
      // A discarded doorway prefix may have hidden the actor's occupied street
      // segment. Match the actual 3D layer, then keep each real polyline tail.
      // No body projection, nearest-door guess or straight endpoint shortcut.
      for (const edge of this.world.edges) {
        if (!['road', 'bridge'].includes(edge.mode) || !isRoadOpen(this.state, edge.id)) continue;
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1], b = edge.points[i], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const squared = dx * dx + dy * dy + dz * dz;
          const t = squared ? Math.max(0, Math.min(1, ((citizen.position.x - a.x) * dx + (citizen.position.y - a.y) * dy + (citizen.position.z - a.z) * dz) / squared)) : 0;
          const point = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
          if (distance(citizen.position, point) > 1e-7) continue;
          for (const forward of [false, true]) {
            const node = forward ? edge.to : edge.from, target = this.world.nodes.find(n => n.id === node)!;
            const tail = forward ? edge.points.slice(i) : edge.points.slice(0, i).reverse();
            const points = [copy(citizen.position), ...tail.map(copy)];
            if (distance(points.at(-1)!, target.position) > 0) points.push(copy(target.position));
            if (this.walkingPrefixAllowed(citizen, points)) anchors.push({ node, points, cost: points.slice(1).reduce((sum, p, index) => sum + distance(points[index], p), 0) });
          }
        }
      }
      if (anchors.length) return anchors;
    }
    const node = this.nearestNode(citizen.position), points = [copy(citizen.position), copy(node.position)];
    return this.walkingPrefixAllowed(citizen, points) ? [{ node: node.id, cost: distance(citizen.position, node.position), points }] : [];
  }
  private routeFromCitizen(citizen: Citizen, destination: Building, anchors = this.walkingAnchors(citizen)): Vec3[] {
    const target = this.buildingNode(destination);
    const best = [...anchors].sort((a, b) => a.cost + (this.walkingTree(a.node).costs.get(target.id) ?? Infinity) - b.cost - (this.walkingTree(b.node).costs.get(target.id) ?? Infinity))[0];
    if (!best) return [copy(citizen.position)];
    const network = this.nodePath(best.node, target.id); if (!network.length) return [copy(citizen.position)];
    const points = [...best.points, ...network.slice(1), copy(destination.door)];
    return this.roadPrefixAllowed(citizen, points) ? points : [copy(citizen.position)];
  }
  buildingTravelDistance(fromId: string, toId: string): number {
    const from = this.buildings.get(fromId), to = this.buildings.get(toId); if (!from || !to) return Infinity;
    const origin = this.buildingNode(from), target = this.buildingNode(to);
    return distance(from.door, origin.position) + (this.walkingTree(origin.id).costs.get(target.id) ?? Infinity) + distance(target.position, to.door);
  }
  inspectBuildingAlteration(plan: BuildingAlterationPlan) {
    return inspectBuildingAlteration(this.worldDefinition, this.state, plan, {
      payrollClaims: [...(this.runtime.wageArrears ?? []), ...(this.runtime.wageAccruals ?? []), ...this.runtime.wages],
      committedPayroll: this.state.shops.map(shop => ({ shopId: shop.id, amount: this.shopCommittedPayroll(shop) })),
      freightLots: this.runtime.freightLots ?? {}, cargoSources: this.runtime.cargoSources ?? {},
    });
  }
  private walkingDistance(citizen: Citizen, destination: Building): number { const target = this.buildingNode(destination); return Math.min(...this.walkingAnchors(citizen).map(a => a.cost + (this.walkingTree(a.node).costs.get(target.id) ?? Infinity))); }
  private route(from: Building, to: Building): Vec3[] {
    this.ensureRoadRouting();
    const key = `${from.id}>${to.id}`; const cached = this.routeCache.get(key); if (cached) return cached;
    const network = this.nodePath(this.buildingNode(from).id, this.buildingNode(to).id);
    const points = network.length ? [copy(from.door), ...network, copy(to.door)] : [];
    this.cacheRoute(key, points); return points;
  }
  private availableHomeRestPoints(citizen: Citizen, home: Building) {
    const role = this.citizenIdentity(citizen), person = { role, identities: [role] };
    const points = Array.from({ length: home.floors }, (_, floor) => homeRestPoints(home, floor)).flat()
      .filter(point => Array.from({ length: point.floor + 1 }, (_, floor) => floor).every(floor => canAccessFloor(home, floor, person)));
    const occupiedBeds = new Set<string>();
    for (const other of this.state.citizens) {
      if (other.id === citizen.id || other.destinationId !== home.id || this.runtime.activities[other.id] !== 'rest'
        || this.state.extension?.actorProfiles[other.id]?.alive === false) continue;
      const target = other.route?.at(-1); if (!target) continue;
      const point = points.find(point => distance(point.position, target) < 1e-8);
      if (point) occupiedBeds.add(point.bedId);
    }
    return points.filter(point => !homeRestPointBlockedByVoxels(point.position, this.state.voxels)
      && !homeRestBedOccupied(this.state, point.bedId) && !occupiedBeds.has(point.bedId));
  }
  private setDestination(citizen: Citizen, destination: Building, rebuild = false) {
    // Old native saves can contain a never-started, blocked exterior intent.
    // A real planning phase may replace it, while import itself stays exact.
    if (this.runtime.npcMotionVersion === 2 && citizen.state === 'physicalWaiting' && !this.runtime.npcStairCursors?.[citizen.id]
      && this.npcStairMotion.isUnstartedExteriorDoorApproach(citizen.route ?? [], citizen.routeIndex ?? 0, citizen.position)) rebuild = true;
    this.citizenRoadRevisions.set(citizen, this.ensureRoadRouting());
    if (!rebuild && citizen.destinationId === destination.id && destination.floorPlanProfile !== FLOOR_PLAN_PROFILE) return;
    if (destination.floorPlanProfile === FLOOR_PLAN_PROFILE) {
      const action = this.runtime.activities[citizen.id], purpose = this.activityPointPurpose(action);
      const role = this.citizenIdentity(citizen), person = { role, identities: [role] };
      const restPoints = destination.kind === 'home' && action === 'rest' ? this.availableHomeRestPoints(citizen, destination) : null;
      const availablePoints: BuildingFunctionPoint[] = restPoints
        ? restPoints.map(point => ({ id: point.id, purpose: 'service', floor: point.floor, position: point.position }))
        : this.buildingFunctionPoints(destination);
      const points = availablePoints.filter(point => point.purpose === purpose && Array.from({ length: point.floor + 1 }, (_, floor) => floor).every(floor => canAccessFloor(destination, floor, person))
        && (action === 'work' || action === 'rest' || point.floor === 0) && !destination.floorUses?.[point.floor]?.includes('观景'));
      // Real doctors can share the public ground diagnosis station with the
      // existing patient route. Other clinic staff keep their original points.
      const clinicalWork = action === 'work' && destination.kind === 'clinic' && ['医生', 'doctor'].includes(citizen.role);
      const clinicalPoints = clinicalWork
        ? points.filter(point => point.floor === 0 && clinicalServiceStationsAtPosition(destination, point.position, person, this.state.voxels).some(station => station.floor === point.floor)) : [];
      const educationWork = action === 'work' && destination.kind === 'school' && ['老师', 'teacher'].includes(citizen.role)
        && (this.state.education?.course?.siteId === destination.id && this.state.education.course.cancelledAt === null || this.state.culture?.orders.some(order => order.siteId === destination.id && order.topic === 'education' && order.state === 'active') || this.state.familyEducation?.active.some(course => course.siteId === destination.id && course.cancelledAt === null));
      const educationPoints = educationWork ? points.filter(point => point.floor === 0 && educationServiceStationsAtPosition(destination, point.position, person, this.state.voxels).some(station => station.floor === point.floor)) : [];
      const savedPowerPoint = action === 'work' && ['工程师', 'scientist', '科学家'].includes(citizen.role) ? powerRepairPoint(this.state, citizen.id, destination.id) : null;
      const powerPoints = savedPowerPoint ? points.filter(point => point.id === savedPowerPoint.id && point.floor === savedPowerPoint.floor && distance(point.position, savedPowerPoint.position) < 1e-7 && !homeRestPointBlockedByVoxels(point.position, this.state.voxels) && !blocksFloorPlanMovement(destination, point.floor, point.position, point.position, .35, 1.72)) : [];
      const sharedServicePoints = savedPowerPoint ? powerPoints : clinicalWork ? clinicalPoints : educationWork ? educationPoints : points;
      const previousTarget = citizen.route?.at(-1);
      if (!rebuild && citizen.destinationId === destination.id && previousTarget && sharedServicePoints.some(point => distance(point.position, previousTarget) < 1e-8)) return;
      const originalCandidates = points.length ? [...points.slice(hash(`${citizen.id}:${destination.id}`) % points.length), ...points.slice(0, hash(`${citizen.id}:${destination.id}`) % points.length)] : [];
      const preferredPoints = powerPoints.length ? powerPoints : clinicalWork ? clinicalPoints : educationPoints;
      const preferred = preferredPoints.length ? [...preferredPoints.slice(hash(`${citizen.id}:${destination.id}`) % preferredPoints.length), ...preferredPoints.slice(0, hash(`${citizen.id}:${destination.id}`) % preferredPoints.length)] : [];
      const candidates = [...preferred, ...originalCandidates.filter(point => !preferredPoints.includes(point))];
      const presence = this.floorPlanPresence(destination, citizen.position);
      let interior: Vec3[] | null = null, selected: BuildingFunctionPoint | undefined;
      for (const point of candidates) { interior = this.floorPlanRoute(destination, presence?.floor ?? 0, point.floor, presence ? citizen.position : destination.door, point.position); if (interior) { selected = point; break; } }
      // If a preferred station is physically unreachable, retain a still-valid
      // old work route selected through the original fallback order.
      if (!rebuild && citizen.destinationId === destination.id && previousTarget && selected && distance(selected.position, previousTarget) < 1e-8) return;
      if (presence) {
        citizen.destinationId = destination.id; citizen.route = interior ?? [copy(citizen.position)]; citizen.routeIndex = 1; citizen.state = interior ? 'moving' : 'unreachable'; return;
      }
      const outside = this.routeFromCitizen(citizen, destination);
      citizen.destinationId = destination.id; citizen.route = interior && outside.length > 1 ? [...outside, ...interior.slice(1)] : [copy(citizen.position)];
      citizen.routeIndex = 1; citizen.state = interior && outside.length > 1 ? 'moving' : this.world.edges.some(edge => !isRoadOpen(this.state, edge.id)) ? 'roadWaiting' : 'unreachable'; return;
    }
    const row = hash(citizen.id) % 5 - 2;
    const role = this.citizenIdentity(citizen);
    const action = this.runtime.activities[citizen.id];
    const available = action === 'rest' || action === 'work' ? Array.from({ length: destination.floors }, (_, floor) => floor).filter(floor => canAccessFloor(destination, floor, { role, identities: [role] }) && !destination.floorUses?.[floor]?.includes('观景')) : [0];
    const floor = available[hash(`${citizen.id}:${destination.id}`) % Math.max(1, available.length)] ?? 0;
    const dimensions = getFloorDimensions(destination, floor), stair = getStairPosition(destination, floor);
    const roomPoint = { x: destination.position.x + row * Math.min(1.8, dimensions.width / 12), y: stair.y, z: destination.position.z + Math.min(1.2, dimensions.depth / 10) };
    const interior: Vec3[] = floor > 0 ? [getStairPosition(destination, 0), stair, roomPoint] : [roomPoint];
    const outside = this.routeFromCitizen(citizen, destination); citizen.destinationId = destination.id; citizen.route = outside.length > 1 ? [...outside, ...interior] : outside; citizen.routeIndex = 1; citizen.state = outside.length > 1 ? 'moving' : this.world.edges.some(edge => !isRoadOpen(this.state, edge.id)) ? 'roadWaiting' : 'unreachable';
  }
  private foodHiringApplicantAvailable(citizen: Citizen): boolean {
    const profile = this.state.extension?.actorProfiles[citizen.id], time = this.state.extension?.lastUpdate ?? this.now, day = Math.floor(time / 1440);
    if (!profile?.alive || profile.age < 18 || profile.health < 45 || this.runtime.dispatches[citizen.id] || this.runtime.riders[citizen.id]) return false;
    if (this.runtime.publicLabor?.shifts.some(shift => shift.day >= day && shift.assignments.some(item => item.citizenId === citizen.id && item.minutesCap > item.workedMinutes))) return false;
    if (Object.values(this.runtime.privateLabor?.shifts ?? {}).some(shift => shift.day === day && shift.assignments.some(item => item.citizenId === citizen.id && item.minutesCap > item.workedMinutes))) return false;
    const research = this.state.extension && Reflect.get(this.state.extension, 'runtime')?.researchJobs;
    if (Object.values(research ?? {}).some(raw => (raw as { actorId?: string }).actorId === citizen.id)) return false;
    if (this.state.roadworks?.jobs.some(job => roadworkActorId(job) === citizen.id && job.completedAt === null && job.cancelledAt === null)
      || powerTaskActorIds(this.state).has(citizen.id) || clinicalTaskActorIds(this.state).has(citizen.id)
      || educationNeedsContinuousPeople(this.state, citizen) || familyEducationTaskActorIds(this.state).has(citizen.id) || hygieneNeedsContinuousPeople(this.state, citizen)) return false;
    return true;
  }
  private foodHiringWorkDistance(citizen: Citizen, site: Building): number {
    const role = this.citizenIdentity(citizen), person = { role, identities: [role] };
    let interior: Vec3[] | null;
    if (site.floorPlanProfile === FLOOR_PLAN_PROFILE) {
      const points = this.buildingFunctionPoints(site).filter(point => point.purpose === 'work'
        && Array.from({ length: point.floor + 1 }, (_, floor) => floor).every(floor => canAccessFloor(site, floor, person)) && !site.floorUses?.[point.floor]?.includes('观景'));
      const offset = hash(`${citizen.id}:${site.id}`) % Math.max(1, points.length), candidates = [...points.slice(offset), ...points.slice(0, offset)];
      const presence = this.floorPlanPresence(site, citizen.position); interior = null;
      for (const point of candidates) {
        const route = this.floorPlanRoute(site, presence?.floor ?? 0, point.floor, presence ? citizen.position : site.door, point.position);
        if (!route) continue;
        // Match the first usable original work route, rather than selecting a
        // shorter sale station or silently replacing a blocked work point.
        if (homeRestPointBlockedByVoxels(point.position, this.state.voxels) || !this.isAtBuildingFunctionPoint(site, point.position, 'work', person)) return Infinity;
        interior = route; break;
      }
      if (!interior) return Infinity;
      if (presence) return this.roadPrefixAllowed(citizen, interior) ? interior.slice(1).reduce((sum, point, i) => sum + distance(interior![i], point), 0) : Infinity;
    } else {
      const floors = Array.from({ length: site.floors }, (_, floor) => floor).filter(floor => canAccessFloor(site, floor, person) && !site.floorUses?.[floor]?.includes('观景'));
      const floor = floors[hash(`${citizen.id}:${site.id}`) % Math.max(1, floors.length)] ?? 0, dimensions = getFloorDimensions(site, floor), stair = getStairPosition(site, floor), row = hash(citizen.id) % 5 - 2;
      const point = { x: site.position.x + row * Math.min(1.8, dimensions.width / 12), y: stair.y, z: site.position.z + Math.min(1.2, dimensions.depth / 10) };
      if (!canAccessFloor(site, floor, person) || homeRestPointBlockedByVoxels(point, this.state.voxels) || !this.isAtBuildingFunctionPoint(site, point, 'work', person)) return Infinity;
      interior = floor > 0 ? [getStairPosition(site, 0), stair, point] : [point];
    }
    const outside = this.routeFromCitizen(citizen, site); if (outside.length <= 1) return Infinity;
    const route = [...outside, ...(site.floorPlanProfile === FLOOR_PLAN_PROFILE ? interior.slice(1) : interior)];
    return this.roadPrefixAllowed(citizen, route) ? route.slice(1).reduce((sum, point, i) => sum + distance(route[i], point), 0) : Infinity;
  }
  private foodHiringSaleDistance(citizen: Citizen, site: Building): number {
    const role = this.citizenIdentity(citizen), person = { role, identities: [role] };
    const points: BuildingFunctionPoint[] = site.floorPlanProfile === FLOOR_PLAN_PROFILE
      ? this.buildingFunctionPoints(site).filter(point => point.purpose === 'sale' && point.floor === 0)
      : [{ id: 'legacy-food-sale', purpose: 'sale', floor: 0, position: { ...site.door, y: site.position.y + .6 } }];
    let nearest = Infinity;
    for (const point of points) {
      if (!canAccessFloor(site, point.floor, person) || homeRestPointBlockedByVoxels(point.position, this.state.voxels)) continue;
      if (site.floorPlanProfile === FLOOR_PLAN_PROFILE) {
        const support = floorPlanSupport(site, point.floor, point.position, .35);
        if (!support || !['room', 'stairs'].includes(support.kind) || Math.abs(support.y - point.position.y) > .26
          || blocksFloorPlanMovement(site, point.floor, point.position, point.position, .35, 1.72)) continue;
      }
      if (!this.isAtBuildingFunctionPoint(site, point.position, 'sale', person)) continue;
      const route = this.routeToRoadwork(citizen, { jobId: 'food-demand-reachability', nodeId: this.buildingNode(site).id, point: point.position, stage: 'pickup', buildingId: site.id, acceptedAt: this.state.extension!.lastUpdate });
      if (!this.roadPrefixAllowed(citizen, route)) continue;
      const length = distance(citizen.position, point.position) < .05 ? 0 : route.length > 1 ? route.slice(1).reduce((total, p, i) => total + distance(route[i], p), 0) : Infinity;
      nearest = Math.min(nearest, length);
    }
    return nearest;
  }
  private foodHiringDemandIds(shop: Shop, site: Building): string[] {
    // Cache paths during one people phase; buying, eating and movement still
    // recheck the named person's current need, wallet and arrival deadline.
    if (this.foodHiringDemandState !== this.state || this.foodHiringDemandTick !== this.state.tick) {
      this.foodHiringDemandState = this.state; this.foodHiringDemandTick = this.state.tick; this.foodHiringDemand.clear();
    }
    const eligible = (buyer: Citizen) => {
      const profile = this.state.extension?.actorProfiles[buyer.id], relation = this.state.relationships.find(r => r.npcId === buyer.id);
      return !!profile?.alive && profile.age >= 6 && (buyer.food ?? 0) < 1 && buyer.needs.hunger < 55 && buyer.money >= shop.price
        && !(relation && this.hostilityRank(relation) >= 2 && this.playerOwnsShop(shop));
    };
    let cached = this.foodHiringDemand.get(shop.id);
    if (!cached) {
      cached = [];
      for (const buyer of this.state.citizens) {
        cached.push({ id: buyer.id, position: copy(buyer.position), route: buyer.route, routeIndex: buyer.routeIndex, travel: undefined });
      }
      this.foodHiringDemand.set(shop.id, cached);
    }
    const result: string[] = [], walkingSpeed = this.state.weather === '雨' ? 3.1 : 4.2;
    for (const row of cached) {
      const buyer = this.state.citizens.find(c => c.id === row.id); if (!buyer || !eligible(buyer)) continue;
      if (row.travel === undefined || distance(buyer.position, row.position) > 1e-8 || buyer.route !== row.route || buyer.routeIndex !== row.routeIndex) { row.position = copy(buyer.position); row.route = buyer.route; row.routeIndex = buyer.routeIndex; row.travel = this.foodHiringSaleDistance(buyer, site); }
      if (finite(row.travel) && this.state.hour * 60 + row.travel / walkingSpeed < 20 * 60) result.push(row.id);
      // More names cannot change the stock comparison at the original 120 cap.
      if (result.length >= 121) break;
    }
    return result;
  }
  private foodShortageHiringOffer(shop: Shop, applicant: Citizen, salary: number): boolean {
    const site = this.buildings.get(shop.buildingId)!, ownerId = this.shopOwnerId(shop), owner = ownerId === 'player' ? this.state.player : this.state.citizens.find(c => c.id === ownerId);
    const profile = ownerId ? this.state.extension?.actorProfiles[ownerId] : undefined;
    if (!['farm', 'dock'].includes(site.kind) || shop.inventory >= 120 || !shopLifecycleAllowsNewPayroll(this.state, shop.id) || !this.foodHiringApplicantAvailable(applicant)
      || this.shopFunds(shop) - this.shopProtectedFunds(shop) - 20 * 8 / 24 < salary || !owner || !profile?.alive || profile.age < 18 || profile.health < 45
      || owner.needs.hunger < 40 || owner.needs.fatigue < 35 || homeRestPointBlockedByVoxels(owner.position, this.state.voxels)
      || !this.isNearBuilding(site, owner.position, 2) || !this.isAtBuildingFunctionPoint(site, owner.position, 'work', ownerId === 'player' ? this.state.player : { role: this.citizenIdentity(owner as Citizen), identities: [this.citizenIdentity(owner as Citizen)] })
      || (this.runtime.privateLabor?.shifts[shop.id]?.reviews.length ?? 0) >= 150) return false;
    const commute = this.foodHiringWorkDistance(applicant, site), walkingSpeed = this.state.weather === '雨' ? 3.1 : 4.2;
    return finite(commute) && this.state.hour * 60 + commute / walkingSpeed < 17 * 60 && this.foodHiringDemandIds(shop, site).length > shop.inventory;
  }
  private preparePrivateAcceptance(shop: Shop, day: number): PrivateShift {
    const time = this.state.extension?.lastUpdate ?? this.now;
    const labor = this.runtime.privateLabor ??= { version: 1, nextReviewAt: time, shifts: {}, stats: { approvedMinutes: 0, workedMinutes: 0, restrictedReviews: 0 } };
    let plan = labor.shifts[shop.id];
    if (!plan || plan.day !== day) {
      const roster = this.privateRoster(shop, plan);
      plan = labor.shifts[shop.id] = { day, shopId: shop.id, assignments: roster.map(person => ({ citizenId: person.id,
        ratePerMinute: (this.runtime.wageAccruals ?? []).find(item => item.citizenId === person.id && item.shopId === shop.id)?.ratePerMinute ?? 32 * (.7 + this.state.districts.find(d => d.id === person.districtId)!.prosperity / 100) / 480, minutesCap: 0, workedMinutes: 0 })), reviews: [] };
    }
    return plan;
  }
  private considerPrivateOpportunity(citizen: Citizen): void {
    const labor = this.runtime.publicLabor;
    if (!labor || !publicEmploymentSite(labor,citizen.id) || this.state.hour < 8 || this.state.hour >= 17 || citizen.needs.hunger < 45 || citizen.needs.fatigue < 40 || (citizen.skills?.craft ?? 0) < 20 || (this.runtime.decisionAt[citizen.id] ?? 0) > this.now) return;
    const currentShop = this.state.shops.find(shop => shop.buildingId === citizen.workId);
    if (!currentShop && this.publicWorkAllowance(citizen) > 0) return;
    if (currentShop) return;
    // Qualified officials stay available to review budgets at their real office.
    if (['official', 'council', 'mayor'].includes(this.citizenIdentity(citizen)) || !this.foodHiringApplicantAvailable(citizen)) return;
    const dailySalary = 32 * (.7 + this.state.districts.find(d => d.id === citizen.districtId)!.prosperity / 100);
    const offers = this.state.shops.filter(shop => shop.open && shop.employees < Math.min(100, this.buildings.get(shop.buildingId)!.capacity) && this.shopFunds(shop) - this.shopProtectedFunds(shop) >= dailySalary && this.buildingTravelDistance(citizen.homeId, shop.buildingId) <= 500 && (tradeSignals(this, shop.id).sold > 0 || this.foodShortageHiringOffer(shop, citizen, dailySalary))).sort((a, b) => this.shopFunds(b) - this.shopProtectedFunds(b) - (this.shopFunds(a) - this.shopProtectedFunds(a)));
    const offer = offers[0]; if (!offer) return;
    const time = this.state.extension?.lastUpdate ?? this.now, day = Math.floor(time / 1440);
    const plan = this.preparePrivateAcceptance(offer, day);
    // Acceptance records a name, not earned labor or a funded wage. The original
    // onsite reviewer alone can add a positive cap and its actual-cash proof.
    if (!plan.assignments.some(item => item.citizenId === citizen.id)) {
      const firstUnpromised = plan.assignments.findIndex(item => item.minutesCap === 0);
      plan.assignments.splice(firstUnpromised < 0 ? plan.assignments.length : firstUnpromised, 0, { citizenId: citizen.id, ratePerMinute: (this.runtime.wageAccruals ?? []).find(item => item.citizenId === citizen.id && item.shopId === offer.id)?.ratePerMinute ?? dailySalary / 480, minutesCap: 0, workedMinutes: 0 });
    }
    offer.employees++; citizen.workId = offer.buildingId; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
    this.refreshWorkforce();
    citizen.historyTags = [...new Set([...(citizen.historyTags ?? []), '公共休班后接受可达现金岗位'])]; labor.stats.privateMoves++;
    // The previous role records the person's earned qualification; changing an
    // employer does not remove that identity or transfer any previous wage debt.
  }
  private chooseFacility(citizen: Citizen): { destination: Building; activity: string } {
    const hour = this.state.hour, night = hour >= 22 || hour < 6, shift = hour >= 7.5 && hour < 17.5;
    const home = this.buildings.get(citizen.homeId)!, work = this.buildings.get(citizen.workId)!;
    const homeBedAvailable = home.floorPlanProfile !== FLOOR_PLAN_PROFILE || this.availableHomeRestPoints(citizen, home).length > 0;
    const anchors = this.walkingAnchors(citizen);
    const candidates: { destination: Building; activity: string; score: number; travel: number }[] = [];
    const add = (b: Building, activity: string, score: number) => { const target = this.buildingNode(b); const travel = Math.min(...anchors.map(a => a.cost + (this.walkingTree(a.node).costs.get(target.id) ?? Infinity))); if (finite(travel)) candidates.push({ destination: b, activity, score: score - Math.min(150, travel / 12), travel }); };
    // A facility advertises a service; citizens compare that offer against needs,
    // liquidity, memories and travel cost. A work shift is a preference, not a lock.
    for (const opportunity of shopLifecycleOpportunities(this, citizen)) add(opportunity.destination, opportunity.activity, opportunity.score);
    for (const opportunity of familyEducationOpportunities(this, citizen)) add(opportunity.destination, opportunity.activity, opportunity.score);
    for (const opportunity of civicStaffingOpportunities(this, citizen)) add(opportunity.destination, opportunity.activity, opportunity.score);
    if (homeBedAvailable) add(home, 'rest', (100 - citizen.needs.fatigue) * .8 + (night ? 140 : !shift ? 18 : 0) + (citizen.needs.fatigue < 25 ? 110 : 0));
    if (shift && citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 35) {
      for (const shop of this.state.shops) if (this.shopOwnerId(shop) === citizen.id && this.privateWorkAllowance(citizen, shop) <= 0) add(this.buildings.get(shop.buildingId)!, 'businessReview', 70);
    }
    if (shift && this.runtime.publicLabor && !this.state.shops.some(shop => shop.buildingId === work.id) && ['official', 'council', 'mayor'].includes(this.citizenIdentity(citizen)) && this.publicWorkAllowance(citizen) <= 0) add(work, 'budgetReview', 65);
    if (citizen.role === '学生' && work.kind === 'school' || this.isEmployed(citizen)) add(work, citizen.role === '学生' ? 'study' : 'work', clamp((450 - citizen.money) / 10, 0, 45) + (shift ? 58 : -16) + (citizen.skills?.craft ?? 20) * .06);
    for (const shop of this.state.shops) {
      if (this.shopCommodity(shop) !== 'food' || !shop.open || shop.inventory < 1 || citizen.money < shop.price) continue;
      const relation = this.state.relationships.find(r => r.npcId === citizen.id); if (relation && this.hostilityRank(relation) >= 2 && this.playerOwnsShop(shop)) continue;
      const building = this.buildings.get(shop.buildingId)!;
      if (distance(citizen.position, building.door) > 1200 && building.districtId !== citizen.districtId) continue;
      add(building, 'eat', (100 - citizen.needs.hunger) * 1.15 + (citizen.needs.hunger < 30 ? 260 : 0) + (hour >= 18 && hour < 19 ? 12 : 0) - (night ? 50 : 0));
    }
    const profile = this.state.extension?.actorProfiles[citizen.id];
    if (hour >= 17 && hour < 22 && citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 35) for (const plan of this.state.family?.movePlans ?? []) {
      if (plan.state === 'pending' && plan.actorIds.includes(citizen.id) && plan.expiresAt > (this.state.extension?.lastUpdate ?? this.now)) { const target = this.buildings.get(plan.homeId); if (target) add(target, 'social', 70); }
    }
    if (hour >= 8 && hour < 17 && citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 35) for (const [childId, child] of Object.entries(this.state.family?.children ?? {})) {
      const schoolVisitId = (child as typeof child & { schoolVisitId?: string | null }).schoolVisitId;
      if (!child.schoolId && schoolVisitId && (child.parentIds.includes(citizen.id) || this.state.family?.careGuardians?.[childId]?.includes(citizen.id))) { const target = this.buildings.get(schoolVisitId); if (target) add(target, 'social', 70); }
    }
    for (const order of this.state.culture?.orders ?? []) {
      if (order.state !== 'active' || order.servedIds.includes(citizen.id) || order.topic === 'transport' || citizen.needs.hunger < 35 || citizen.needs.fatigue < 25 || (profile?.age ?? 20) < 6) continue;
      const site = this.buildings.get(order.siteId); if (!site) continue;
      if (order.topic === 'health' && profile && profile.health < 65) add(site, 'service', 60 + (65 - profile.health) * 3);
      if (order.topic === 'education' && hour >= 7 && hour < 19 && (citizen.education ?? 0) < 4) add(site, 'service', 60 + (4 - (citizen.education ?? 0)) * 8);
    }
    for (const building of this.world.buildings) {
      if (building.kind === 'clinic' && profile && profile.health < 60 && citizen.money >= 30) add(building, 'heal', (60 - profile.health) * 3 + profile.stress * .1);
      if (building.districtId !== citizen.districtId) {
        if (night && !homeBedAvailable && ['pavilion', 'station', 'clinic'].includes(building.kind)) add(building, 'rest', (100 - citizen.needs.fatigue) * .8 + 110 + 140);
        continue;
      }
      const child = this.state.family?.children[citizen.id];
      if (building.kind === 'school' && child && child.schoolId !== building.id) continue;
      if (building.kind === 'school' && hour >= 7 && hour < 19) add(building, 'study', Math.max(0, 4 - (citizen.education ?? 0)) * 8 + (citizen.role === '学生' && shift ? 55 : 0) + (citizen.skills?.learning ?? 20) * .2);
      if (['pavilion', 'hall', 'dock'].includes(building.kind)) add(building, 'social', (100 - citizen.needs.social) * .8 + (100 - citizen.needs.fun) * .35 - (night ? 60 : 0));
      if (['pavilion', 'station', 'clinic'].includes(building.kind) && (citizen.needs.fatigue < 25 || night && !homeBedAvailable)) add(building, 'rest', (100 - citizen.needs.fatigue) * .8 + 110 + (night ? 140 : 0));
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = this.runtime.mealRoutePolicyId === NEARBY_MEAL_ROUTE_POLICY ? chooseNearestTiedMeal(candidates) : candidates[0];
    return chosen ? { destination: chosen.destination, activity: chosen.activity } : { destination: home, activity: 'rest' };
  }
  private routeToRoadwork(citizen: Citizen, task: NonNullable<ReturnType<typeof roadworkTask>>): Vec3[] {
    const site = task.buildingId ? this.buildings.get(task.buildingId) : undefined;
    if (site) {
      const person = { role: this.citizenIdentity(citizen), identities: [this.citizenIdentity(citizen)] };
      const actualPoint = this.buildingFunctionPoints(site).find(p => p.purpose === 'sale' && distance(p.position, task.point) < 1e-7);
      if (site.floorPlanProfile === FLOOR_PLAN_PROFILE) {
        if (!actualPoint || !Array.from({ length: actualPoint.floor + 1 }, (_, floor) => floor).every(floor => canAccessFloor(site, floor, person))) return [copy(citizen.position)];
        const presence = this.floorPlanPresence(site, citizen.position), interior = this.floorPlanRoute(site, presence?.floor ?? 0, actualPoint.floor, presence ? citizen.position : site.door, task.point);
        if (!interior) return [copy(citizen.position)];
        if (presence) return interior;
        const outside = this.routeFromCitizen(citizen, site); return outside.length > 1 ? [...outside, ...interior.slice(1)] : [copy(citizen.position)];
      }
    }
    const target = this.world.nodes.find(n => n.id === task.nodeId); if (!target) return [copy(citizen.position)];
    const anchors = this.walkingAnchors(citizen), candidates = anchors.map(anchor => ({ anchor, cost: anchor.cost + (this.walkingTree(anchor.node).costs.get(target.id) ?? Infinity) })).filter(item => finite(item.cost)).sort((a, b) => a.cost - b.cost);
    if (!candidates.length) return [copy(citizen.position)];
    const best = candidates[0].anchor, network = this.nodePath(best.node, target.id), points = [...best.points, ...network.slice(1), copy(task.point)];
    return network.length && this.roadPrefixAllowed(citizen, points) ? points : [copy(citizen.position)];
  }
  private roadworkTravelCost(citizenId: string, nodeId: string, point: Vec3): number {
    const citizen = this.state.citizens.find(c => c.id === citizenId); if (!citizen) return Infinity;
    const site = this.world.buildings.find(b => this.buildingFunctionPoints(b).some(p => p.purpose === 'sale' && distance(p.position, point) < 1e-7));
    const route = this.routeToRoadwork(citizen, { jobId: 'reachability', nodeId, point, stage: site ? 'pickup' : 'worksite', buildingId: site?.id, acceptedAt: this.state.extension!.lastUpdate });
    return distance(citizen.position, point) < .05 ? 0 : route.length <= 1 ? Infinity : route.slice(1).reduce((sum, p, i) => sum + distance(route[i], p), 0);
  }
  private advanceRoadworker(citizen: Citizen, task: NonNullable<ReturnType<typeof roadworkTask>>, availableMinutes: number): void {
    const end = citizen.route?.at(-1);
    if (!end || distance(end, task.point) > 1e-7 || citizen.state === 'roadWorkWaiting') { citizen.route = this.routeToRoadwork(citizen, task); citizen.routeIndex = 1; }
    if ((citizen.route?.length ?? 0) <= 1 && distance(citizen.position, task.point) > .05) { citizen.state = 'roadWorkWaiting'; return; }
    // Deferred pre-task minutes still decay needs, but never move a newly
    // assigned worker or become this task's onsite window.
    const taskMinutes = Math.min(availableMinutes, this.minutes, Math.max(0, this.state.extension!.lastUpdate - task.acceptedAt));
    let remaining = 0, previous = citizen.position;
    for (const next of (citizen.route ?? []).slice(citizen.routeIndex ?? 0)) { remaining += distance(previous, next); previous = next; }
    citizen.state = 'roadWorkMoving';
    if (!this.moveCitizen(citizen, taskMinutes)) { if (String(citizen.state) === 'roadWaiting') citizen.state = 'roadWorkWaiting'; return; }
    const arrivedMinutes = Math.min(this.minutes, this.runtime.npcMotionVersion === 2 ? this.citizenArrivalMinutes.get(citizen) ?? 0 : Math.max(0, taskMinutes - remaining / (this.state.weather === '雨' ? 3.1 : 4.2)));
    if (distance(citizen.position, task.point) > .05) { citizen.state = 'roadWorkWaiting'; return; }
    citizen.state = task.stage === 'pickup' ? 'roadPickup' : 'roadWorking';
    if (arrivedMinutes <= 0) return;
    const observedClock = this.state.extension!.lastUpdate;
    const event: Event = Object.freeze({ type: 'roadwork-presence', citizenId: citizen.id, laborJobId: task.jobId, nodeId: task.nodeId, purpose: task.stage, activityWindowStartAt: observedClock - arrivedMinutes, activityWindowEndAt: observedClock, activityObservedTick: this.state.tick, activityObservedClock: observedClock, activityPosition: Object.freeze(copy(citizen.position)) });
    canonicalRoadworkPresence.add(event); this.bus.emit(event);
  }
  private moveCitizen(citizen: Citizen, minutes: number) {
    if (this.runtime.npcMotionVersion === 2) return this.moveCitizenPhysical(citizen, minutes);
    // `minutes` includes the tier's skipped ticks. One calendar minute represents
    // one simulated real second at 1×, for every tier, including police routes.
    this.citizenRoadMovementRejected.delete(citizen);
    this.refreshCitizenRoadRoute(citizen);
    if (citizen.state === 'roadWaiting' || citizen.state === 'roadWorkWaiting') return false;
    let movement = minutes * (this.state.weather === '雨' ? 3.1 : 4.2);
    const route = citizen.route ?? []; let index = citizen.routeIndex ?? 0;
    while (movement > 0 && index < route.length) {
      const next = route[index], d = distance(citizen.position, next), t = d > movement ? movement / d : 1;
      const proposed = { x: citizen.position.x + (next.x - citizen.position.x) * t, y: citizen.position.y + (next.y - citizen.position.y) * t, z: citizen.position.z + (next.z - citizen.position.z) * t };
      if (!roadMovementAllowed(this.world, this.state, citizen.id, citizen.position, proposed)) {
        citizen.routeIndex = index; this.citizenRoadMovementRejected.add(citizen);
        const destination = citizen.destinationId && this.buildings.get(citizen.destinationId);
        const dispatch = this.runtime.dispatches[citizen.id], crime = dispatch && this.state.crimes.find(c => c.id === dispatch.crimeId);
        if (crime && destination) this.rebuildDispatchRoute(citizen, crime, destination);
        else { if (!citizen.state.startsWith('roadWork') && destination) this.setDestination(citizen, destination, true); if (citizen.state !== 'moving') this.roadRouteWaiting(citizen); }
        return false;
      }
      if (d <= movement) { citizen.position.x = next.x; citizen.position.y = next.y; citizen.position.z = next.z; releaseRoadExitPermit(this.world, this.state, citizen.id, citizen.position); movement -= d; index++; }
      else { citizen.position.x += (next.x - citizen.position.x) * t; citizen.position.y += (next.y - citizen.position.y) * t; citizen.position.z += (next.z - citizen.position.z) * t; movement = 0; }
    }
    citizen.routeIndex = index;
    releaseRoadExitPermit(this.world, this.state, citizen.id, citizen.position);
    return index >= route.length;
  }
  private nativeCursorMatches(citizen: Citizen, cursor: NpcStairCursor): boolean {
    const route = citizen.route, index = citizen.routeIndex ?? 0;
    const owned = this.npcCursorRoutes.get(cursor);
    return !!route && index > 0 && index < route.length && cursor.routeIndex === index && (!owned || owned === route)
      && !!cursor.from && !!cursor.to && cursor.from.x === route[index - 1].x && cursor.from.y === route[index - 1].y && cursor.from.z === route[index - 1].z
      && cursor.to.x === route[index].x && cursor.to.y === route[index].y && cursor.to.z === route[index].z;
  }
  private savedNpcStairCursors(): Record<string, NpcStairCursor> {
    const cursors: Record<string, NpcStairCursor> = {};
    for (const [id, cursor] of Object.entries(this.runtime.npcStairCursors ?? {})) {
      const citizen = this.state.citizens.find(c => c.id === id);
      if (citizen && this.state.extension?.actorProfiles[id]?.alive !== false && !this.runtime.riders[id] && this.nativeCursorMatches(citizen, cursor)) cursors[id] = cursor;
    }
    return cursors;
  }
  private pruneNpcStairCursors(): void {
    if (this.runtime.npcMotionVersion === 2) this.runtime.npcStairCursors = this.savedNpcStairCursors();
  }
  private citizenPhysicalSegmentAllowed(citizen: Citizen, from: Vec3, to: Vec3, building?: Building, floor?: number): boolean {
    if (homeRestPointBlockedByVoxels(to, this.state.voxels)) return false;
    if (building && floor !== undefined) {
      const role = this.citizenIdentity(citizen);
      const identity = { role, identities: [role] };
      const support = floorPlanSupport(building, floor, to, .35);
      if (!canAccessFloor(building, floor, identity) || support?.link && !canAccessFloor(building, support.link.toFloor, identity)) return false;
      if (blocksMarketCounter(marketCounters(this.world, building), from, to, .35, 1.72)) return false;
    }
    return true;
  }
  private citizenReferenceSegmentAllowed(citizen: Citizen, from: Vec3, to: Vec3, bodies: { building: Building; floors: number[] }[]): boolean {
    if (!this.citizenPhysicalSegmentAllowed(citizen, from, to)) return false;
    // The reference route may include ordinary flat rooms. They keep their
    // original trajectory, but actual walls, furniture and counters still own
    // the full swept body; a stair cursor is not required for a flat room.
    for (const { building, floors } of bodies) {
      const height = building.height / building.floors;
      const low = Math.floor((Math.min(from.y, to.y) - building.position.y - .6) / height + 1e-7);
      const high = Math.floor((Math.max(from.y, to.y) + 1.72 - building.position.y - .6) / height + 1e-7);
      for (const floor of floors.filter(floor => floor >= low && floor <= high)) {
        const blocks = this.runtime.referenceCollisionPolicyId === CONTINUOUS_REFERENCE_COLLISION_POLICY ? blocksFloorPlanReferenceMovement : blocksFloorPlanMovement;
        if (blocks(building, floor, from, to, .35, 1.72)) return false;
        const support = floorPlanSupport(building, floor, to, .35);
        if (support && Math.abs(support.y - to.y) <= .22000001 && !this.citizenPhysicalSegmentAllowed(citizen, from, to, building, support.floor)) return false;
      }
      if (blocksMarketCounter(marketCounters(this.world, building), from, to, .35, 1.72)) return false;
    }
    return true;
  }
  private moveCitizenPhysical(citizen: Citizen, minutes: number): boolean {
    this.citizenArrivalMinutes.set(citizen, 0); this.citizenRoadMovementRejected.delete(citizen);
    if (!finite(minutes) || minutes < 0 || this.state.extension?.actorProfiles[citizen.id]?.alive === false || this.runtime.riders[citizen.id]) return false;
    this.refreshCitizenRoadRoute(citizen);
    if (citizen.state === 'roadWaiting' || citizen.state === 'roadWorkWaiting') return false;
    const speed = this.state.weather === '雨' ? 3.1 : 4.2, route = citizen.route ?? [], cursors = this.runtime.npcStairCursors!;
    let movement = minutes * speed, index = citizen.routeIndex ?? 0;
    const wait = (road: boolean): false => {
      citizen.routeIndex = index;
      if (!road) { citizen.state = 'physicalWaiting'; return false; }
      this.citizenRoadMovementRejected.add(citizen);
      const destination = citizen.destinationId && this.buildings.get(citizen.destinationId), dispatch = this.runtime.dispatches[citizen.id], crime = dispatch && this.state.crimes.find(c => c.id === dispatch.crimeId);
      if (crime && destination) this.rebuildDispatchRoute(citizen, crime, destination);
      else { if (!citizen.state.startsWith('roadWork') && destination) this.setDestination(citizen, destination, true); if (citizen.state !== 'moving') this.roadRouteWaiting(citizen); }
      this.pruneNpcStairCursors(); return false;
    };
    while (index < route.length) {
      citizen.routeIndex = index;
      const existing = cursors[citizen.id]; if (existing && !this.nativeCursorMatches(citizen, existing)) delete cursors[citizen.id];
      const description = this.npcStairMotion.describe(route, index);
      if (description.kind === 'blocked') return wait(false);
      if (description.kind === 'physical') {
        let cursor = cursors[citizen.id];
        if (!cursor) {
          cursor = this.npcStairMotion.opening(route, index)!;
          try { this.npcStairMotion.validate(route, cursor, citizen.position); } catch { return wait(false); }
          cursors[citizen.id] = cursor; this.npcCursorRoutes.set(cursor, route);
        }
        let advanced; let roadBlocked = false;
        try {
          this.npcStairMotion.validate(route, cursor, citizen.position);
          advanced = this.npcStairMotion.advance(route, cursor, movement, (from, to, building, floor) => {
            if (!roadMovementAllowed(this.world, this.state, citizen.id, from, to)) { roadBlocked = true; return false; }
            return this.citizenPhysicalSegmentAllowed(citizen, from, to, building, floor);
          });
        } catch { return wait(false); }
        citizen.position = advanced.position; movement = Math.max(0, movement - advanced.usedDistance);
        releaseRoadExitPermit(this.world, this.state, citizen.id, citizen.position);
        if (advanced.blocked) return wait(roadBlocked);
        if (!advanced.finishedLeg) break;
        delete cursors[citizen.id]; index++; continue;
      }
      if (cursors[citizen.id]) return wait(false);
      const next = route[index], d = distance(citizen.position, next);
      if (d === 0) { index++; continue; }
      if (movement <= 0) break;
      // Outdoor and unmarked travel keeps its existing three-dimensional path.
      // Short body/voxel checks cannot skip a newly placed .2m cube.
      const amount = Math.min(d, movement, this.state.voxels.length ? .05 : Infinity), t = amount === d ? 1 : amount / d;
      const proposed = t === 1 ? copy(next) : { x: citizen.position.x + (next.x - citizen.position.x) * t, y: citizen.position.y + (next.y - citizen.position.y) * t, z: citizen.position.z + (next.z - citizen.position.z) * t };
      if (!roadMovementAllowed(this.world, this.state, citizen.id, citizen.position, proposed)) return wait(true);
      if (!this.citizenReferenceSegmentAllowed(citizen, citizen.position, proposed, description.bodies ?? [])) return wait(false);
      citizen.position = proposed;
      if (amount > 0 && citizen.state === 'physicalWaiting' && this.runtime.referenceCollisionPolicyId === CONTINUOUS_REFERENCE_COLLISION_POLICY) citizen.state = 'moving';
      movement = Math.max(0, movement - amount); if (t === 1) index++;
    }
    citizen.routeIndex = index; releaseRoadExitPermit(this.world, this.state, citizen.id, citizen.position);
    const arrived = index >= route.length;
    if (arrived) { delete cursors[citizen.id]; this.citizenArrivalMinutes.set(citizen, movement / speed); }
    return arrived;
  }
  private people() {
    this.refreshWorkforce();
    this.reviewPrivateShifts();
    const hour = this.state.hour;
    const pendingMinutes = this.runtime.peopleElapsed ??= {};
    const researchActors = researchTaskActorIds(this.state), powerActors = powerTaskActorIds(this.state), clinicalActors = clinicalTaskActorIds(this.state), familyLearners = familyEducationTaskActorIds(this.state);
    for (let i = 0; i < this.state.citizens.length; i++) {
      const citizen = this.state.citizens[i];
      // At most seven persisted new research jobs request fine task processing.
      // Preserve tier, ordinary actors' frequency, pending needs and real wages.
      const researchTask = researchActors.has(citizen.id), roadTask = this.state.roadworks ? roadworkTask(this, citizen.id) : null;
      const frequency = researchTask || !!roadTask || powerActors.has(citizen.id) || clinicalActors.has(citizen.id) || familyLearners.has(citizen.id) || hygieneNeedsContinuousPeople(this.state, citizen) || educationNeedsContinuousPeople(this.state, citizen) || civicStaffingNeedsContinuousPeople(this.state, citizen) ? 1 : citizen.tier === 'active' ? 1 : citizen.tier === 'regional' ? 4 : 16;
      if (this.state.extension?.actorProfiles[citizen.id]?.alive === false) { delete pendingMinutes[citizen.id]; citizen.state = 'dead'; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0; const ride = this.runtime.riders[citizen.id]; if (ride) { const vehicle = this.state.vehicles.find(v => v.id === ride.vehicleId); if (vehicle && !ride.arrived) vehicle.passengers = Math.max(0, vehicle.passengers - 1); delete this.runtime.riders[citizen.id]; } continue; }
      // Accumulate actual ticks while a tier defers this actor. Multiplying by
      // the actor's current tier would lose or duplicate time after a tier or
      // speed change, and would credit time before a new actor existed.
      const elapsed = (pendingMinutes[citizen.id] ?? 0) + this.minutes;
      if ((this.state.tick + i) % frequency) { pendingMinutes[citizen.id] = elapsed; continue; }
      delete pendingMinutes[citizen.id];
      citizen.needs.hunger = clamp(citizen.needs.hunger - elapsed * .05);
      if (citizen.needs.hunger < 48 && (citizen.food ?? 0) >= 1) { citizen.food!--; citizen.needs.hunger = clamp(citizen.needs.hunger + 52); this.bus.emit({ type: 'stored-meal', citizenId: citizen.id, amount: 1 }); }
      citizen.needs.fatigue = clamp(citizen.needs.fatigue - elapsed * .035);
      citizen.needs.social = clamp(citizen.needs.social - elapsed * .015);
      citizen.needs.fun = clamp(citizen.needs.fun - elapsed * .02);
      if ((this.state.extension?.actorProfiles[citizen.id]?.age ?? 20) < 6) { citizen.state = 'atHome'; citizen.needs.fatigue = clamp(citizen.needs.fatigue + elapsed * .12); continue; }
      this.refreshCitizenRoadRoute(citizen);
      const dispatch = this.runtime.dispatches[citizen.id];
      if (dispatch) {
        const crime = this.state.crimes.find(c => c.id === dispatch.crimeId);
        const health = this.state.extension?.actorProfiles[citizen.id]?.health ?? 100;
        if (!crime || crime.status !== 'responding' || this.policeWorkAllowance(citizen) <= 0 || citizen.needs.hunger < 20 || citizen.needs.fatigue < 15 || health < 35) {
          if (crime?.status === 'responding') { crime.status = 'open'; crime.responseAt = 0; this.bus.emit({ type: 'police-response-withdrawn', citizenId: citizen.id, crimeId: crime.id, districtId: crime.districtId, quantity: this.runtime.policeSupplies?.kits[crime.id]?.receivedUnits ?? 0, purpose: this.policeWorkAllowance(citizen) <= 0 ? 'work-allowance' : 'needs' }); this.notice('dispatch', `${citizen.name}因补给或健康需要退出响应，事件等待有行动能力的巡警接替。`, crime.districtId); }
          delete this.runtime.dispatches[citizen.id]; citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0;
        }
        else {
          if (citizen.state === 'roadWaiting') continue;
          citizen.state = 'responding'; const arrived = this.moveCitizen(citizen, elapsed), atCrime = arrived && distance(citizen.position, crime.position) <= 3;
          if (arrived && !atCrime) {
            // An old imported or shortened route ending at a facility/exit is
            // not evidence that the officer reached the actual incident.
            const destination = citizen.destinationId && this.buildings.get(citizen.destinationId);
            if (destination) this.rebuildDispatchRoute(citizen, crime, destination); else this.roadRouteWaiting(citizen);
          }
          if (String(citizen.state) !== 'roadWaiting' && !this.citizenRoadMovementRejected.has(citizen) && (!arrived || atCrime)) this.registerAttendance(citizen, elapsed);
          if (atCrime) { citizen.state = 'investigating'; this.bus.emit({ type: 'officer-arrived', citizenId: citizen.id, crimeId: crime.id }); }
          continue;
        }
      }
      if (!roadTask && citizen.state !== 'roadWaiting') this.considerPrivateOpportunity(citizen);
      const home = this.buildings.get(citizen.homeId)!; const work = this.buildings.get(citizen.workId)!;
      let availableMinutes = elapsed;
      const riding = this.runtime.riders[citizen.id];
      if (riding) {
        const vehicle = this.state.vehicles.find(v => v.id === riding.vehicleId)!;
        const stop = this.world.nodes.find(n => n.id === riding.stopNodeId)!;
        citizen.position = copy(riding.arrived ? stop.position : vehicle.position); citizen.state = 'riding';
        // Traffic records arrival at its discrete endpoint observation. Deferred
        // ride minutes still decay needs, but cannot be reused for walking or
        // onsite recovery. An unobserved legacy arrival starts from this phase.
        if (!riding.arrived) continue;
        availableMinutes = Math.min(elapsed, Math.max(0, (this.state.extension?.lastUpdate ?? this.now) - (riding.arrivedAt ?? (this.state.extension?.lastUpdate ?? this.now))));
        delete this.runtime.riders[citizen.id];
        citizen.position = copy(stop.position); citizen.route = []; citizen.routeIndex = 0;
        const ongoing = citizen.destinationId && this.buildings.get(citizen.destinationId);
        if (ongoing) this.setDestination(citizen, ongoing, true);
      }
      if (roadTask) { this.advanceRoadworker(citizen, roadTask, availableMinutes); continue; }
      if (citizen.state.startsWith('roadWork') || citizen.state === 'roadPickup') {
        const ongoing = citizen.destinationId && this.buildings.get(citizen.destinationId); if (ongoing) this.setDestination(citizen, ongoing, true);
      }
      let destination: Building;
      const sleeping = hour >= 22 || hour < 6;
      const shift = hour >= 7.5 && hour < 17.5;

      const previousActivity = this.runtime.activities[citizen.id];
      const previousShop = this.state.shops.find(s => s.buildingId === citizen.destinationId);
      const treatment = this.state.clinical?.orders.find(order => order.patientId === citizen.id && ['awaitingSupply', 'awaitingDoctor', 'inTreatment'].includes(order.state));
      const committedTreatment = treatment && citizen.needs.hunger >= 35 && citizen.needs.fatigue >= 25;
      if (committedTreatment) this.runtime.activities[citizen.id] = 'heal';
      const reconsiderCivic = this.effectiveRuleset === 'civic-local-v1' && previousActivity === 'work' && civicStaffingOpportunities(this, citizen).length > 0;
      const reconsiderMeal = this.runtime.mealRoutePolicyId === NEARBY_MEAL_ROUTE_POLICY && previousActivity === 'eat' && this.now + 1e-7 >= (this.runtime.decisionAt[citizen.id] ?? 0);
      const committedNeed = !!citizen.destinationId && (citizen.state === 'roadWaiting' || !reconsiderMeal && previousActivity === 'eat' && citizen.needs.hunger < 55 && previousShop?.open && previousShop.inventory >= 1 && citizen.money >= previousShop.price || previousActivity === 'rest' && citizen.needs.fatigue < 55 && citizen.needs.hunger >= 30 || (previousActivity === 'heal' || !!treatment) && (this.state.extension?.actorProfiles[citizen.id]?.health ?? 100) < 60 && citizen.needs.hunger >= 35 && citizen.needs.fatigue >= 25 || !reconsiderCivic && previousActivity === 'work' && shift && this.isEmployed(citizen) && citizen.needs.hunger >= 30 && citizen.needs.fatigue >= 25);
      if (committedTreatment) destination = this.buildings.get(treatment.siteId)!;
      else if (!committedNeed && (reconsiderCivic || !citizen.destinationId || this.now + 1e-7 >= (this.runtime.decisionAt[citizen.id] ?? 0) || sleeping && previousActivity !== 'rest')) {
        const choice = this.chooseFacility(citizen); destination = choice.destination; this.runtime.activities[citizen.id] = choice.activity; this.runtime.decisionAt[citizen.id] = this.now + 25 + this.random() * 35;
      } else destination = this.buildings.get(citizen.destinationId!)!;
      this.setDestination(citizen, destination);
      if (citizen.state === 'roadWaiting') continue;
      if (citizen.state === 'unreachable') { citizen.destinationId = null; continue; }
      if (distance(citizen.position, destination.door) > 200) {
        const walkingSpeed = this.state.weather === '雨' ? 3.1 : 4.2;
        const walkingTime = this.walkingDistance(citizen, destination) / walkingSpeed;
        const transit = this.state.vehicles.find(v => {
          if (!isRoadOpen(this.state, v.edgeId) || v.state === 'roadClosed' || v.state === 'moving' || v.kind === 'flight' || citizen.money < 4 || v.passengers >= this.passengerCapacity(v) || distance(v.position, citizen.position) > 40) return false;
          const edge = this.edges.get(v.edgeId)!; const end = this.world.nodes.find(n => n.id === (v.direction > 0 ? edge.to : edge.from))!;
          const target = this.buildingNode(destination), remainingWalk = (this.walkingTree(end.id).costs.get(target.id) ?? Infinity) + distance(target.position, destination.door);
          const rideTime = Math.max(0, v.nextDeparture - this.now) + edge.length * (v.direction > 0 ? 1 - v.progress : v.progress) / Math.max(1, v.speed * this.state.energy / 100);
          return rideTime + remainingWalk / walkingSpeed + 15 < walkingTime;
        });
        if (transit) { const edge = this.edges.get(transit.edgeId)!; citizen.money -= 4; this.bus.emit({ type: 'transit-fare', amount: 4, citizenId: citizen.id, vehicleId: transit.id, districtId: citizen.districtId }); this.runtime.riders[citizen.id] = { vehicleId: transit.id, stopNodeId: transit.direction > 0 ? edge.to : edge.from }; transit.passengers++; citizen.state = 'riding'; citizen.position = copy(transit.position); this.bus.emit({ type: 'commute', citizenId: citizen.id }); continue; }
      }
      let arrivedElapsed = availableMinutes;
      if ((citizen.routeIndex ?? 0) < (citizen.route?.length ?? 0)) {
        let remainingDistance = 0, point = citizen.position;
        for (const next of (citizen.route ?? []).slice(citizen.routeIndex ?? 0)) { remainingDistance += distance(point, next); point = next; }
        if (!this.moveCitizen(citizen, availableMinutes)) continue;
        arrivedElapsed = this.runtime.npcMotionVersion === 2 ? this.citizenArrivalMinutes.get(citizen) ?? 0 : Math.max(0, availableMinutes - remainingDistance / (this.state.weather === '雨' ? 3.1 : 4.2));
      }
      const activity = this.runtime.activities[citizen.id];
      const person = { role: this.citizenIdentity(citizen), identities: [this.citizenIdentity(citizen)] };
      const atActivityPoint = destination.kind === 'home' && activity === 'rest'
        ? !!homeRestPointAt(destination, citizen.position, person) && !homeRestPointBlockedByVoxels(citizen.position, this.state.voxels)
        : this.isAtBuildingFunctionPoint(destination, citizen.position, this.activityPointPurpose(activity), person);
      if (!this.isNearBuilding(destination, citizen.position, 1) || destination.floorPlanProfile === FLOOR_PLAN_PROFILE && !atActivityPoint) { citizen.state = 'unreachable'; citizen.destinationId = null; continue; }
      // A clinic observer receives only a real completed walking/arrival leg.
      // This optional source event changes no movement, needs or attendance.
      if (destination.kind === 'clinic' && arrivedElapsed > 0) {
        const observedClock = this.state.extension!.lastUpdate;
        this.bus.emit({ type: 'clinical-activity-window', citizenId: citizen.id, siteId: destination.id, purpose: this.activityPointPurpose(activity), activityWindowStartAt: observedClock - arrivedElapsed, activityWindowEndAt: observedClock, activityObservedTick: this.state.tick, activityObservedClock: observedClock, activityPosition: copy(citizen.position) });
      }
      if (destination.id === home.id || activity === 'rest') {
        citizen.state = sleeping ? 'sleeping' : 'atHome'; citizen.needs.fatigue = clamp(citizen.needs.fatigue + arrivedElapsed * (sleeping ? .35 : .12)); citizen.needs.fun = clamp(citizen.needs.fun + arrivedElapsed * .07); if (citizen.partnerId) citizen.needs.social = clamp(citizen.needs.social + arrivedElapsed * .08);
      } else if (activity === 'work') {
        if (!this.isEmployed(citizen)) { citizen.state = this.runtime.publicLabor && publicEmploymentSite(this.runtime.publicLabor,citizen.id) || this.state.shops.some(shop => shop.buildingId === citizen.workId) ? 'offDuty' : 'unemployed'; citizen.destinationId = null; continue; }
        if (citizen.state !== 'working') this.bus.emit({ type: 'commute', citizenId: citizen.id }); citizen.state = 'working'; citizen.needs.social = clamp(citizen.needs.social + arrivedElapsed * .035); this.registerAttendance(citizen, arrivedElapsed);
      } else if (activity === 'civicRegister' || activity === 'civicVote') {
        citizen.state = 'attendingCivic';
        if (this.effectiveRuleset === 'civic-local-v1' && arrivedElapsed > 0) {
          const observedClock = this.state.extension!.lastUpdate;
          const event: Event = Object.freeze({ type: 'civic-activity-window', citizenId: citizen.id, siteId: destination.id, purpose: activity, minutes: this.minutes, activityWindowStartAt: observedClock - arrivedElapsed, activityWindowEndAt: observedClock, activityObservedTick: this.state.tick, activityObservedClock: observedClock, activityPosition: Object.freeze(copy(citizen.position)) });
          canonicalCivicPresence.add(event); this.bus.emit(event);
        }
      } else if (activity === 'shopLifecycle') {
        citizen.state = 'reviewingBusiness';
        this.bus.emit({ type: 'shop-lifecycle-arrived', citizenId: citizen.id, shopId: this.state.shops.find(shop => shop.buildingId === destination.id)?.id });
      } else if (activity === 'businessReview') {
        citizen.state = 'reviewingBusiness';
      } else if (activity === 'study') {
        citizen.state = 'studying'; if (citizen.skills) citizen.skills.learning = clamp(citizen.skills.learning + arrivedElapsed * .003); citizen.needs.social = clamp(citizen.needs.social + arrivedElapsed * .02); recordSchoolSelfStudy(this, citizen, destination, arrivedElapsed); observeFamilyEducationArrival(this, citizen, destination, arrivedElapsed);
      } else if (activity === 'budgetReview') {
        citizen.state = 'reviewingBudget';
      } else if (activity === 'service') {
        citizen.state = 'attendingService'; observeFamilyEducationArrival(this, citizen, destination, arrivedElapsed);
      } else if (activity === 'social') {
        citizen.state = 'socializing'; citizen.needs.social = clamp(citizen.needs.social + arrivedElapsed * .12); citizen.needs.fun = clamp(citizen.needs.fun + arrivedElapsed * .09);
      } else if (activity === 'heal') {
        citizen.state = 'healing'; citizen.needs.fatigue = clamp(citizen.needs.fatigue + arrivedElapsed * .03);
      } else if (activity === 'eat') {
        citizen.state = 'shopping';
        this.bus.emit({ type: 'customer', citizenId: citizen.id, shopId: this.state.shops.find(s => s.buildingId === destination.id)?.id });
      }
      if (destination.kind === 'school') observePublicEducationArrival(this, citizen, destination, arrivedElapsed);
    }
    const player = this.state.player; player.needs.hunger = clamp(player.needs.hunger - this.minutes * .035); player.needs.fatigue = clamp(player.needs.fatigue - this.minutes * .018); player.needs.social = clamp(player.needs.social - this.minutes * .012); player.needs.fun = clamp(player.needs.fun - this.minutes * .009);
    if (this.now + 1e-7 >= this.runtime.payrollAt) {
      // Earned labour remains payable even after a job change, closure or death.
      // Each contract retains the employer and rate promised on first attendance.
      for (const claim of this.runtime.wageAccruals ?? []) if (claim.amount > 0)
        this.bus.emit({ type: 'wage', citizenId: claim.citizenId, shopId: claim.shopId ?? undefined, districtId: claim.districtId, amount: claim.amount, expenseAccrued: true });
      this.runtime.wageAccruals = [];
      this.runtime.payrollAt = (this.state.day + (hour >= 17 ? 1 : 0)) * 1440 + 17 * 60;
      if (this.runtime.payrollAt <= this.now) this.runtime.payrollAt += 1440;
      this.employment.clear();
      this.runtime.attendance = {};
    }
  }
  private retailOpenAtPhase(shop: Shop, building: Building): boolean {
    const district = this.state.districts.find(d => d.id === shop.districtId)!;
    return this.state.hour >= 6 && this.state.hour < (building.kind === 'market' ? 22 : 20)
      && (this.state.powerGrid ? gridBuildingSupplyRatio(this.state, building.id) > .25 : district.energy > 25) && !this.shopInsolvent(shop) && shopLifecycleAllowsOperation(this.state, shop.id);
  }
  private settleRetailCustomers(shop: Shop, building: Building, betweenBatches: boolean): void {
    for (const [citizenId, shopId] of Object.entries(this.runtime.customers)) {
      if (shopId !== shop.id) continue;
      const citizen = this.state.citizens.find(c => c.id === citizenId)!;
      if (this.state.extension?.actorProfiles[citizen.id]?.alive === false) continue;
      const relation = this.state.relationships.find(r => r.npcId === citizen.id); if (relation && this.hostilityRank(relation) >= 2 && this.playerOwnsShop(shop)) continue;
      if (this.shopCommodity(shop) !== 'food' || citizen.destinationId !== building.id || citizen.state !== 'shopping' || citizen.needs.hunger > 78 || citizen.money < shop.price || shop.inventory < 1) continue;
      if (distance(citizen.position, building.position) > Math.max(building.width, building.depth) / 2 + 3) continue;
      if (building.floorPlanProfile === FLOOR_PLAN_PROFILE) {
        const role = this.citizenIdentity(citizen), person = { role, identities: [role] };
        if (!this.isAtBuildingFunctionPoint(building, citizen.position, 'sale', person)
          || homeRestPointBlockedByVoxels(citizen.position, this.state.voxels)) continue;
      }
      const trust = this.state.relationships.find(r => r.npcId === citizen.id)?.trust ?? 0;
      const price = shop.price * (trust > 55 ? .95 : 1);
      const quantity = Math.min((citizen.food ?? 0) < 1 ? 2 : 1, Math.floor(citizen.money / price), Math.floor(shop.inventory));
      const countedUnits = betweenBatches ? this.runtime.retailSalesSinceBatch?.[shop.id] ?? 0 : shop.customers;
      // Valid imported counters must remain exportable after a real receipt.
      if (countedUnits + quantity > 100000) continue;
      const cost = price * quantity, net = cost * (1 - this.state.taxRate), beforeInventory = shop.inventory;
      let supplierGross: number, inventoryCost: number; try { const quote = this.quoteConsignmentSale(shop.id, quantity, beforeInventory); supplierGross = quote.supplierGross; inventoryCost = quote.inventoryCost; } catch { continue; }
      if (net < supplierGross || this.shopFunds(shop) + net - supplierGross > 1e9) continue;
      citizen.money -= cost; citizen.needs.hunger = clamp(citizen.needs.hunger + 52); citizen.food = (citizen.food ?? 0) + quantity - 1; citizen.needs.fun = clamp(citizen.needs.fun + 8); shop.inventory -= quantity; shop.revenue += cost; shop.profit += net - inventoryCost;
      this.settleConsignmentSale(shop.id, quantity, beforeInventory); this.transferShopFunds(shop, net - supplierGross);
      if (betweenBatches) {
        const pending = this.runtime.retailSalesSinceBatch ??= {};
        pending[shop.id] = (pending[shop.id] ?? 0) + quantity;
      } else shop.customers += quantity;
      // Consume only the successful request. Failed requests retain the same
      // between-batch retry and end-of-batch clearing policy as before.
      delete this.runtime.customers[citizenId];
      this.bus.emit({ type: 'sale', amount: cost, citizenId: citizen.id, shopId: shop.id, districtId: shop.districtId, quantity });
    }
  }
  private commerce() {
    if (this.now < this.runtime.commerceAt) {
      // Arrival requests settle in their actual opening period. Production,
      // freight, utilities, employment, pricing and feedback stay on the batch.
      for (const id of new Set(Object.values(this.runtime.customers))) {
        const shop = this.state.shops.find(s => s.id === id), building = shop && this.buildings.get(shop.buildingId);
        if (shop && building && this.retailOpenAtPhase(shop, building)) this.settleRetailCustomers(shop, building, true);
      }
      return;
    }
    const elapsed = Math.max(10, this.now - this.runtime.commerceAt + 10); this.runtime.commerceAt = this.now + 10;
    const commercialFeedback = new Map<string, { sum: number; count: number }>();
    for (const shop of this.state.shops) {
      const building = this.buildings.get(shop.buildingId)!; const district = this.state.districts.find(d => d.id === shop.districtId)!;
      const scheduledOpen = this.state.hour >= 6 && this.state.hour < (building.kind === 'market' ? 22 : 20);
      const siteEnergy = this.state.powerGrid ? gridBuildingSupplyRatio(this.state, building.id) : district.energy / 100;
      const serviceFailure = siteEnergy <= .25 || this.shopInsolvent(shop);
      // A restricted firm may clear existing finite stock. Historical losses
      // remain recorded; only funded new contracts can restart production.
      shop.open = scheduledOpen && !serviceFailure && shopLifecycleAllowsOperation(this.state, shop.id);
      shop.customers = this.runtime.retailSalesSinceBatch?.[shop.id] ?? 0;
      if (this.runtime.retailSalesSinceBatch) delete this.runtime.retailSalesSinceBatch[shop.id];
      const labor = this.runtime.shopLabor?.[shop.id] ?? 0;
      const productiveLabor = this.state.powerGrid ? Math.min(labor, this.runtime.poweredShopLabor?.[shop.id] ?? 0) : labor;
      if (this.runtime.shopLabor) delete this.runtime.shopLabor[shop.id];
      if (this.runtime.poweredShopLabor) delete this.runtime.poweredShopLabor[shop.id];
      const cargo = this.runtime.freight[shop.districtId] ?? 0;
      if (cargo > 0 && building.kind === 'market' && shop.inventory < 36) {
        const lots = this.runtime.freightLots ??= {}, deliveries = lots[shop.districtId] ??= [{ shopId: null, quantity: cargo }];
        let received = 0;
        while (deliveries.length && received < 14 && shop.inventory < 70 && this.shopFunds(shop) >= 4) {
          const lot = deliveries[0], source = this.state.shops.find(s => s.id === lot.shopId), unitPrice = source ? this.quoteSupply(source.id, lot.quantity).unitPrice : 4, quantity = Math.min(lot.quantity, 14 - received, 70 - shop.inventory, Math.floor(Math.max(0, this.shopFunds(shop) - this.shopProtectedFunds(shop)) / unitPrice), source ? Math.max(0, 1e9 - this.shopFunds(source)) / (unitPrice * (1 - this.state.taxRate)) : Infinity), payment = quantity * unitPrice;
          if (quantity <= 0) break;
          this.transferShopFunds(shop, -payment);
          if (source) { const net = payment * (1 - this.state.taxRate); this.transferShopFunds(source, net); source.revenue += payment; source.profit += net; this.bus.emit({ type: 'wholesale', shopId: source.id, districtId: source.districtId, amount: payment, quantity, unitPrice }); }
          else this.bus.emit({ type: 'business-expense', shopId: shop.id, districtId: shop.districtId, amount: payment });
          lot.quantity -= quantity; shop.inventory += quantity; this.recordOwnedStockPurchase(shop.id, quantity, unitPrice); received += quantity;
          if (lot.quantity < 1e-7) deliveries.shift();
        }
        this.runtime.freight[shop.districtId] = Math.max(0, cargo - received);
      }
      if (shop.open && ['farm', 'workshop', 'dock'].includes(building.kind)) {
        const technology = this.state.extension?.technologies.find(t => t.sector === (building.kind === 'farm' ? 'agriculture' : 'manufacturing'))?.level ?? 0;
        const produced = Math.min(Math.max(0, 120 - shop.inventory), productiveLabor / 30 * (this.state.powerGrid ? 1 : siteEnergy) * (1 + technology * .12));
        shop.inventory = clamp(shop.inventory + produced, 0, 10000);
        if (produced > 0) this.bus.emit({ type: 'production', shopId: shop.id, districtId: shop.districtId, amount: produced, minutes: this.state.powerGrid ? productiveLabor : labor });
      }
      // Retail replenishment is a paid, finite transfer of a producer's stock.
      // Empty/absent workers cannot create saleable inventory or supplier income.
      if (shop.open && building.kind === 'market' && shop.inventory < 36 && this.shopFunds(shop) >= 4) {
        const suppliers = this.state.shops.filter(s => s.id !== shop.id && s.districtId === shop.districtId && ['farm', 'dock'].includes(this.buildings.get(s.buildingId)!.kind) && this.shopCommodity(s) === 'food' && s.inventory >= 1).sort((a, b) => b.inventory - a.inventory);
        for (const supplier of suppliers) {
          const quote = this.quoteSupply(supplier.id, 70 - shop.inventory), quantity = Math.min(Math.floor(quote.quantity), Math.floor(Math.max(0, this.shopFunds(shop) - this.shopProtectedFunds(shop)) / quote.unitPrice), Math.floor(Math.max(0, 1e9 - this.shopFunds(supplier)) / (quote.unitPrice * (1 - this.state.taxRate))));
          if (quantity <= 0) break;
          const payment = quantity * quote.unitPrice, net = payment * (1 - this.state.taxRate);
          supplier.inventory -= quantity; shop.inventory += quantity; this.recordOwnedStockPurchase(shop.id, quantity, quote.unitPrice);
          this.transferShopFunds(shop, -payment); this.transferShopFunds(supplier, net);
          supplier.revenue += payment; supplier.profit += net;
          this.bus.emit({ type: 'wholesale', shopId: supplier.id, districtId: supplier.districtId, amount: payment, quantity, unitPrice: quote.unitPrice });
          if (shop.inventory >= 70) break;
        }
      }
      if (shop.open && building.kind === 'market' && shop.inventory < 4) this.supplyConsignment(shop.id, 70 - shop.inventory);
      if (shop.open) {
        this.settleRetailCustomers(shop, building, false);
        // Earned wages were charged at attendance; paying them later does not charge them again.
        // Only the separately modelled premises/utilities expense accrues here.
        const occupancy = Math.min(1, labor / elapsed);
        const utilities = Math.min(Math.max(0, this.shopFunds(shop) - this.shopProtectedFunds(shop)), elapsed / 1440 * 20 * occupancy);
        this.transferShopFunds(shop, -utilities); shop.profit -= utilities;
        if (utilities > 0) this.bus.emit({ type: 'business-expense', amount: utilities, shopId: shop.id, districtId: shop.districtId });
      }
      const scarcity = clamp((70 - shop.inventory) / 70, -.4, 2);
      const demand = shop.customers / Math.max(1, shop.employees);
      shop.price = clamp(shop.price + (12 * (1 + scarcity * .5 + demand * .08) - shop.price) * .04, 5, 40);
      const rosterSize = this.workforce.get(shop.buildingId)?.length ?? 0;
      shop.employees = Math.min(shop.employees, rosterSize);
      // Payroll decides affordability once per attended shift. A rolling profit
      // threshold must not dismiss the same roster every ten game minutes.
      if (shop.profit > 200 && this.shopFunds(shop) > 64 && shop.employees < rosterSize) shop.employees++;
      const feedback = commercialFeedback.get(district.id) ?? { sum: 0, count: 0 };
      // Actual receipts from the opening period still contribute when this
      // batch falls after closing. Availability penalties keep their schedule.
      feedback.sum += shop.customers * .07 + (serviceFailure ? -.07 : scheduledOpen ? -.01 : 0); feedback.count++; commercialFeedback.set(district.id, feedback);
      district.pollution = clamp(district.pollution + (building.kind === 'workshop' ? .005 : -.002) * elapsed / 10);
    }
    for (const district of this.state.districts) {
      const feedback = commercialFeedback.get(district.id);
      if (feedback?.count) district.prosperity = clamp(district.prosperity + feedback.sum / feedback.count * elapsed / 10);
      const adults = this.state.citizens.filter(c => c.districtId === district.id && c.role !== '学生' && (this.state.extension?.actorProfiles[c.id]?.age ?? 20) >= 18 && this.state.extension?.actorProfiles[c.id]?.alive !== false);
      district.employment = adults.length ? adults.filter(c => this.isEmployed(c)).length / adults.length : 1;
    }
    this.runtime.customers = {};
  }
  private finance() {
    runScheduledServiceProcurement(this);
    const requestedOperation = this.runtime.operatingCost;
    // Public upkeep consumes real supplies from productive firms. Payment is
    // reserved before salaries and tax is remitted through the normal queue.
    const operationReceipt = this.purchasePublicSupplyReceipt({ requestedGross: Math.min(1e9, this.state.treasury), requestedQuantity: requestedOperation / 4, eventType: 'public-procurement' }), operationPaid = operationReceipt.paid;
    this.runtime.publicSupply = requestedOperation > 1e-9 ? Math.min(1, operationReceipt.quantity / (requestedOperation / 4)) : 1;
    if (operationReceipt.quantity > 1e-9) this.runtime.operationUnitPrice = operationReceipt.paid / operationReceipt.quantity;
    this.runtime.operatingCost = 0;
    const pending = new Map<string, { citizenId: string; shopId: string | null; amount: number }>();
    const accrue = (citizenId: string, shopId: string | null, amount: number) => { const key = `${shopId ?? 'public'}:${citizenId}`, owed = pending.get(key); if (owed) owed.amount += amount; else pending.set(key, { citizenId, shopId, amount }); };
    for (const owed of this.runtime.wageArrears ?? []) accrue(owed.citizenId, owed.shopId, owed.amount);
    for (const wage of this.runtime.wages) { const citizen = this.state.citizens.find(c => c.id === wage.citizenId); if (citizen) accrue(citizen.id, wage.shopId === undefined ? this.state.shops.find(s => s.buildingId === citizen.workId)?.id ?? null : wage.shopId, wage.amount); }
    const privateRequests = new Map<string, number>();
    let publicRequest = 0;
    for (const wage of pending.values()) { if (wage.shopId) privateRequests.set(wage.shopId, (privateRequests.get(wage.shopId) ?? 0) + wage.amount); else publicRequest += wage.amount; }
    const publicRatio = Math.min(1, this.state.treasury / Math.max(1e-9, publicRequest));
    const privateRatios = new Map(this.state.shops.map(shop => [shop.id, Math.min(1, this.shopFunds(shop) / Math.max(1e-9, privateRequests.get(shop.id) ?? 0))]));
    const arrears: NonNullable<Runtime['wageArrears']> = [];
    for (const wage of pending.values()) { const citizen = this.state.citizens.find(c => c.id === wage.citizenId); if (!citizen) continue; const employer = wage.shopId ? this.state.shops.find(s => s.id === wage.shopId)! : null; const amount = Math.min(employer ? wage.amount * privateRatios.get(employer.id)! : wage.amount * publicRatio, Math.max(0, 1e9 - citizen.money) / (1 - this.state.taxRate)); if (employer) { this.transferShopFunds(employer, -amount); } else this.state.treasury -= amount; const tax = amount * this.state.taxRate; citizen.money = clamp(citizen.money + amount - tax, 0, 1e9); this.runtime.taxes += tax; const unpaid = wage.amount - amount; if (unpaid > 1e-8) arrears.push({ ...wage, amount: unpaid }); if (amount > 0) this.bus.emit({ type: 'wage-paid', citizenId: citizen.id, shopId: employer?.id, districtId: citizen.districtId, amount, requestedAmount: wage.amount }); }
    this.runtime.wageArrears = arrears;
    this.runtime.wages.length = 0;
    this.state.treasury = clamp(this.state.treasury + this.runtime.taxes, 0, 1e12); this.runtime.taxes = 0;
    if (this.now + 1e-7 >= this.runtime.financeAt) {
      const hours = Math.max(1, (this.now - this.runtime.financeAt + 60) / 60); this.runtime.financeAt = this.now + 60;
      if (!this.state.banking) {
      this.state.bankBalance = clamp(this.state.bankBalance * (1 + .000015 * hours), 0, 1e9);
      this.state.loan = clamp(this.state.loan * (1 + .00008 * hours), 0, 1e9);
      if (this.runtime.investment > 0) { const prosperity = this.state.districts.reduce((n, d) => n + d.prosperity, 0) / this.state.districts.length; this.state.player.money = clamp(this.state.player.money + this.runtime.investment * .0008 * (prosperity - 35) / 30 * hours, 0, 1e9); }
      }
      for (const shop of this.state.shops) if (!this.state.extension?.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId) && shop.profit > 0 && this.shopPayrollDebt(shop) <= 1e-8) {
        const recipient = shop.ownerId === 'player' ? this.state.player : this.state.citizens.find(c => c.id === shop.ownerId);
        if (this.state.extension?.actorProfiles[shop.ownerId ?? '']?.alive === false) continue;
        if (!recipient) continue;
        const reserve = Math.max(64 + shop.employees * 32, this.shopProtectedFunds(shop)), dividend = Math.min(Math.max(0, 1e9 - recipient.money), Math.max(0, this.shopFunds(shop) - reserve) * Math.min(1, .03 * hours));
        this.transferShopFunds(shop, -dividend); recipient.money = clamp(recipient.money + dividend, 0, 1e9);
        if (dividend > 0) this.bus.emit({ type: 'business-dividend', citizenId: 'id' in recipient ? recipient.id : 'player', shopId: shop.id, districtId: shop.districtId, amount: dividend });
      }
    }
  }
  policeSupplyCoverage() {
    const stock = this.runtime.policeSupplies;
    return stock ? { receivedUnits: stock.totals.receivedUnits, consumedUnits: stock.totals.consumedUnits, heldUnits: stock.totals.receivedUnits - stock.totals.consumedUnits, gross: stock.totals.gross, tax: stock.totals.tax } : null;
  }
  private policeWorkAllowance(citizen: Citizen): number {
    return Math.min(this.publicWorkAllowance(citizen), Math.max(0, 480 - (this.runtime.attendance[citizen.id] ?? 0)));
  }
  private preparePoliceSupply(crime: Crime): boolean {
    const stock = this.runtime.policeSupplies, kit = stock?.kits[crime.id];
    if (policeSupplyReady(kit)) return true;
    const at = this.state.extension?.lastUpdate ?? this.now;
    if (kit && at < kit.retryAt - 1e-7) return false;
    // A retained incident kit belongs to the public, even when its officer
    // withdraws. Only an actual missing quantity can be purchased again.
    const suppliers = this.state.shops.filter(shop => this.shopCommodity(shop) === 'materials' && shop.inventory > 0);
    if (!suppliers.length || stock && !kit && Object.keys(stock.kits).length >= 200 || (kit?.receipts.length ?? 0) + suppliers.length > 256) return false;
    // Refuse new obligations before cash/stock mutation if receipt history has
    // no storage headroom. Held kits and unpaid wages are never trimmed.
    const recordHeadroom = 1024 + suppliers.reduce((sum, supplier) => sum + JSON.stringify({ shopId: supplier.id }).length + 384, 0);
    if (JSON.stringify(stock ?? {}).length + recordHeadroom > 512 * 1024) return false;
    const missing = Math.max(0, 3 * crime.severity - (kit?.receivedUnits ?? 0));
    // Four coins was a base-price estimate. Actual finite industrial quotes
    // price the same three-unit recipe; protected promises remain untouched.
    let remaining = missing, quotedGross = 0;
    for (const supplier of [...suppliers].sort((a, b) => Number(b.districtId === crime.districtId) - Number(a.districtId === crime.districtId) || b.inventory - a.inventory)) {
      const quote = this.quoteSupply(supplier.id, Math.min(supplier.inventory, remaining));
      quotedGross += quote.quantity * quote.unitPrice; remaining -= quote.quantity; if (remaining <= 1e-7) break;
    }
    const receipt = this.purchasePublicSupplyReceipt({ requestedGross: Math.min(1e9 - (kit?.gross ?? 0), quotedGross), requestedQuantity: missing, districtId: crime.districtId, eventType: 'security-procurement', purpose: `incident:${crime.id}`, procurementId: crime.id });
    if (receipt.quantity <= 0 || receipt.paid <= 0) return false;
    const ledger = this.runtime.policeSupplies ??= createPoliceSupplies(this.state.crimes);
    this.runtime.policeSuppliesVersion = 1;
    recordPolicePurchase(ledger, crime, receipt, this.state.extension?.lastUpdate ?? this.now, this.state.taxRate);
    return policeSupplyReady(ledger.kits[crime.id]);
  }
  private finishPoliceResponse(crime: Crime): void {
    crime.status = 'resolved';
    const quantity = this.runtime.policeSupplies ? consumePoliceSupply(this.runtime.policeSupplies, crime.id, this.state.extension?.lastUpdate ?? this.now) : 0;
    for (const [id, dispatch] of Object.entries(this.runtime.dispatches)) if (dispatch.crimeId === crime.id) {
      delete this.runtime.dispatches[id];
      const citizen = this.state.citizens.find(citizen => citizen.id === id);
      if (citizen) { citizen.destinationId = null; citizen.route = []; citizen.routeIndex = 0; }
    }
    if (quantity > 0) this.bus.emit({ type: 'police-supply-consumed', crimeId: crime.id, districtId: crime.districtId, quantity });
    this.bus.emit({ type: 'crime-resolved', crimeId: crime.id, districtId: crime.districtId });
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
        const officer = this.state.citizens.filter(c => this.citizenIdentity(c) === 'police' && this.policeWorkAllowance(c) > 0 && c.needs.hunger >= 35 && c.needs.fatigue >= 30 && (this.state.extension?.actorProfiles[c.id]?.health ?? 100) >= 45 && !this.runtime.dispatches[c.id] && !this.runtime.riders[c.id] && this.state.extension?.actorProfiles[c.id]?.alive !== false).map(c => ({ citizen: c, travel: this.walkingDistance(c, target) })).filter(candidate => finite(candidate.travel)).sort((a, b) => a.travel - b.travel)[0]?.citizen;
        if (!officer) continue;
        if (!this.preparePoliceSupply(crime)) continue;
        crime.status = 'responding';
        this.bus.emit({ type: 'dispatch', citizenId: officer.id, crimeId: crime.id });
        const route = officer.route ?? []; let remaining = 0; for (let index = officer.routeIndex ?? 0; index < route.length; index++) remaining += distance(index === (officer.routeIndex ?? 0) ? officer.position : route[index - 1], route[index]);
        if (this.runtime.npcMotionVersion === 2) { const cursor = this.runtime.npcStairCursors?.[officer.id]; remaining = this.npcStairMotion.remaining(route, officer.routeIndex ?? 0, officer.position, cursor && this.nativeCursorMatches(officer, cursor) ? cursor : undefined); }
        if (!finite(remaining)) { delete this.runtime.dispatches[officer.id]; crime.status = 'open'; crime.responseAt = 0; officer.state = 'physicalWaiting'; continue; }
        crime.responseAt = this.now + 10 + remaining / (this.state.weather === '雨' ? 3.1 : 4.2);
      } else if (crime.status === 'responding') { const assigned = Object.entries(this.runtime.dispatches).find(([, dispatch]) => dispatch.crimeId === crime.id); if (!assigned || this.state.extension?.actorProfiles[assigned[0]]?.alive === false) { if (assigned) delete this.runtime.dispatches[assigned[0]]; crime.status = 'open'; crime.responseAt = 0; } else if (assigned[1].arrived && this.now + 1e-7 >= crime.responseAt) { const officer = this.state.citizens.find(person => person.id === assigned[0]); if (officer && this.policeWorkAllowance(officer) > 0 && officer.needs.hunger >= 20 && officer.needs.fatigue >= 15 && (this.state.extension?.actorProfiles[officer.id]?.health ?? 100) >= 35 && distance(officer.position, crime.position) <= 3) this.finishPoliceResponse(crime); } }
      else district.safety = clamp(district.safety - this.minutes * .001 * crime.severity);
    }
    if (this.state.crimes.length > 120) this.state.crimes = this.state.crimes.filter(c => c.status !== 'resolved').concat(this.state.crimes.filter(c => c.status === 'resolved').slice(-60));
    if (this.runtime.policeSupplies) archivePoliceSupplies(this.runtime.policeSupplies, this.state.crimes);
  }
  private politics() {
    this.reviewPublicShifts();
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
  private notice(type: string, text: string, districtId?: string) { this.state.events.push({ id: ++this.runtime.eventId, tick: this.state.tick, type, text, ...(districtId ? { districtId } : {}) }); if (this.state.events.length > 100) this.state.events.shift(); return this.runtime.eventId; }
  isNearBuilding(building: Building, position: Vec3 = this.state.player.position, doorRadius = 32): boolean {
    if (!this.validPosition(position)) return false;
    if (building.floorPlanProfile === FLOOR_PLAN_PROFILE) {
      const presence = this.floorPlanPresence(building, position);
      if (presence) return presence.kind === 'room' || presence.kind === 'stairs';
      const floor = getBuildingFloorPlan(building, 0), local = buildingLocalPosition(building, position);
      // The real doorway remains usable at its boundary. An exterior approach
      // preserves the caller's radius; the same radius never turns a courtyard,
      // wall or absent upper-floor slab into an occupied room.
      return !!floor && Math.abs(position.y - building.door.y) < 1.5 && distance(position, building.door) <= doorRadius
        && (!contains(floor.broadphase, local.x, local.z) || distance(position, building.door) < .4);
    }
    const floorHeight = building.height / Math.max(1, building.floors), floor = Math.floor((position.y - building.position.y + .01) / floorHeight);
    if (floor === 0 && distance(position, building.door) <= doorRadius) return true;
    if (floor < -(building.basements ?? 0) || floor >= building.floors) return false;
    const dx = position.x - building.position.x, dz = position.z - building.position.z;
    const x = dx * Math.cos(building.rotation) + dz * Math.sin(building.rotation), z = -dx * Math.sin(building.rotation) + dz * Math.cos(building.rotation);
    const dimensions = getFloorDimensions(building, floor);
    return Math.abs(x) <= dimensions.width / 2 && Math.abs(z) <= dimensions.depth / 2 && position.y >= building.position.y - floorHeight * (building.basements ?? 0) - .5 && position.y <= building.position.y + building.height + .5;
  }
  private floorPlanPresence(building: Building, position: Vec3) {
    const floor = Math.round((position.y - building.position.y - .6) / (building.height / building.floors));
    for (const candidate of [floor, floor - 1, floor + 1]) {
      const support = floorPlanSupport(building, candidate, position);
      if (support && Math.abs(support.y - position.y) <= .26) return support;
    }
    return null;
  }
  private buildingFunctionPoints(building: Building): BuildingFunctionPoint[] {
    return building.functionPoints ?? Array.from({ length: building.floors }, (_, floor) => getBuildingUsePoints(building, floor)).flat();
  }
  private activityPointPurpose(activity: string | undefined): BuildingFunctionPoint['purpose'] {
    return activity === 'eat' ? 'sale' : ['work', 'businessReview', 'budgetReview', 'shopLifecycle'].includes(activity ?? '') ? 'work' : 'service';
  }
  /** A v4 facility is used at its real point on a legally accessible floor.
   * Unmarked recipes retain their existing proximity/permission contract. */
  isAtBuildingFunctionPoint(building: Building, position: Vec3 = this.state.player.position, purpose?: BuildingFunctionPoint['purpose'], person: Pick<Player, 'role' | 'identities'> = this.state.player, radius = 2): boolean {
    if (building.floorPlanProfile !== FLOOR_PLAN_PROFILE) return this.isNearBuilding(building, position, radius);
    const presence = this.floorPlanPresence(building, position);
    return !!presence && (presence.kind === 'room' || presence.kind === 'stairs') && this.buildingFunctionPoints(building).some(point => point.floor === presence.floor && (!purpose || point.purpose === purpose) && canAccessFloor(building, point.floor, person) && distance(position, point.position) <= radius);
  }
  private floorPlanRoute(building: Building, fromFloor: number, toFloor: number, from: Vec3, to: Vec3): Vec3[] | null {
    this.ensureRoadRouting();
    const key = `floor:${building.id}:${fromFloor}>${toFloor}:${this.pointKey(from)}>${this.pointKey(to)}`;
    const cached = this.state.voxels.length === 0 ? this.routeCache.get(key) : undefined;
    if (cached && (this.runtime.npcMotionVersion !== 2 || cached[0]?.x === from.x && cached[0]?.y === from.y && cached[0]?.z === from.z)) return cached.map(copy);
    const counters = marketCounters(this.world, building);
    const route = findBuildingFloorPlanRoute(building, fromFloor, toFloor, from, to, .35, counters.length ? (a, b) => blocksMarketCounter(counters, a, b, .35, 1.72) : undefined);
    // Native opening phases bind to the actual body's exact origin. A local
    // coordinate round trip can lose one ULP without changing the geometry;
    // keep the original bits instead of adding a free connector or moving it.
    if (route?.length && this.runtime.npcMotionVersion === 2) route[0] = copy(from);
    if (route && this.state.voxels.length === 0) this.cacheRoute(key, route.map(copy));
    return route;
  }
  private floorAccessible(building: Building): boolean { const floorHeight = building.height / Math.max(1, building.floors); const floor = Math.floor((this.state.player.position.y - building.position.y + .01) / floorHeight); return canAccessFloor(building, floor, this.state.player); }
  private validPosition(p: unknown): p is Vec3 { if (!p || typeof p !== 'object') return false; const v = p as Vec3; const limit = Math.max(10000, this.world.size * 3); return finite(v.x) && finite(v.y) && finite(v.z) && Math.abs(v.x) <= limit && Math.abs(v.z) <= limit && v.y >= -1000 && v.y <= limit; }
  private buildingNear(targetId: string | undefined, kinds: string[], purpose?: BuildingFunctionPoint['purpose']): Building | null {
    const explicitShop = this.state.shops.find(s => s.id === targetId);
    const explicit = targetId ? this.buildings.get(explicitShop?.buildingId ?? targetId) : undefined;
    if (targetId && !explicit) return null;
    const matches = (b: Building) => kinds.includes(b.kind) || !!b.facility && kinds.includes(b.facility);
    const candidates = explicit ? [explicit] : this.world.buildings.filter(matches);
    return candidates.filter(b => matches(b) && this.isNearBuilding(b) && this.floorAccessible(b) && (b.floorPlanProfile !== FLOOR_PLAN_PROFILE || this.isAtBuildingFunctionPoint(b, this.state.player.position, purpose))).sort((a, b) => Number(this.isNearBuilding(b, this.state.player.position, 0)) - Number(this.isNearBuilding(a, this.state.player.position, 0)) || distance(this.state.player.position, a.door) - distance(this.state.player.position, b.door))[0] ?? null;
  }
  private relation(npc: Citizen) {
    let relation = this.state.relationships.find(r => r.npcId === npc.id);
    if (!relation) { const impression = this.runtime.impressions[npc.id]; relation = { npcId: npc.id, affection: impression?.affection ?? 0, trust: impression?.trust ?? 0, type: 'stranger', encounters: 0, memories: [], tags: [] }; this.state.relationships.push(relation); }
    this.initializeRelationshipStages(relation); return relation;
  }
  private romanceStage(relation: Relationship): NonNullable<Relationship['romanceStage']> { return relation.romanceStage ?? (relation.type === 'spouse' ? 'married' : relation.type === 'lover' ? 'dating' : 'single'); }
  private playerOwnsShop(shop: Shop): boolean { const company = this.state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId); return company ? (company.shareholders.player ?? 0) > company.shares / 2 : shop.ownerId === 'player'; }
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
    if (this.state.aviation?.activeAircraftId && !['pause', 'speed', 'setTime'].includes(command.type) && !AIRCRAFT_COMMANDS.has(command.type)) return fail('请先在合法停机坪降落并离开机舱，再进行地面生活与职业操作。');
    if (command.type === 'work') {
      const site = command.targetId ? this.buildings.get(command.targetId) : this.world.buildings.find(building => this.isNearBuilding(building));
      if (site?.floorPlanProfile === FLOOR_PLAN_PROFILE && !this.isAtBuildingFunctionPoint(site, this.state.player.position, 'work')) return fail('请到该建筑可访问楼层的实际工作点开始工班。');
    }
    if (['research', 'energy', 'requestEnergyRepair'].includes(command.type) && !powerHasCapacityRoom(this.state)) return fail('仍有交叉劳动强引用，能源见证档案容量已满；不得抹去过去分钟开新任务。');
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
      const building = this.buildingNear(command.targetId, ['market', 'workshop', 'farm', 'dock'], 'sale'); if (!building) return fail('请到商铺入口附近购物。');
      const shop = this.state.shops.find(s => s.buildingId === building.id); if (!shop) return fail('这是公共科研或政务设施，不经营零售商品。');
      const quantity = command.value ?? 1; if (!Number.isInteger(quantity) || quantity < 1 || quantity > 30) return fail('购买数量须为1至30的整数。');
      if (!shop.open || !shopLifecycleAllowsOperation(this.state, shop.id) || shop.inventory < quantity) return fail('商铺休业或库存不足。');
      const cost = shop.price * quantity; if (p.money < cost) return fail('现金不足。');
      const beforeInventory = shop.inventory, net = cost * (1 - this.state.taxRate); let supplierGross: number, inventoryCost: number;
      try { const quote = this.quoteConsignmentSale(shop.id, quantity, beforeInventory); supplierGross = quote.supplierGross; inventoryCost = quote.inventoryCost; } catch { return fail('寄售货主账户暂不能结算。'); }
      if (net < supplierGross || this.shopFunds(shop) + net - supplierGross > 1e9) return fail('成交净款不足以结清货主，或店铺账户已达上限。');
      const commodity = this.shopCommodity(shop);
      p.money -= cost; shop.inventory -= quantity; shop.revenue += cost; shop.profit += net - inventoryCost; this.settleConsignmentSale(shop.id, quantity, beforeInventory); this.transferShopFunds(shop, net - supplierGross); shop.customers += quantity;
      if (commodity === 'food') { p.inventory.food = (p.inventory.food ?? 0) + quantity - 1; p.needs.hunger = clamp(p.needs.hunger + 52); this.bus.emit({ type: 'food-consumed', citizenId: 'player', amount: 1, shopId: shop.id, districtId: shop.districtId }); }
      else p.inventory.material = (p.inventory.material ?? 0) + quantity;
      this.bus.emit({ type: 'sale', amount: cost, shopId: shop.id, districtId: shop.districtId, quantity, purpose: commodity }); return success(`在${building.name}购买${quantity}份${commodity === 'food' ? '食物' : '工业物料'}，花费${cost.toFixed(1)}云币。`);
    }
    if (command.type === 'rest') {
      const building = this.buildingNear(command.targetId, ['pavilion', 'clinic', 'station', 'home'], 'service');
      const homeNear = building?.id === p.homeId;
      if (!building || building.kind === 'home' && !homeNear) return fail('请到已租住所、亭子、站点或诊所休息。');
      if (building.kind === 'home' && building.floorPlanProfile === FLOOR_PLAN_PROFILE) return fail('请到已租住宅的真实床旁开始休息。');
      if (this.now - this.runtime.restAt < 20 - 1e-7) return fail('刚刚已休息过，请稍后再休息。');
      const cost = homeNear ? 0 : building.kind === 'clinic' ? 15 : 5; if (p.money < cost) return fail('休憩费用不足。');
      this.receivePublicFee(cost, '公共休憩设施服务费', building.districtId); p.needs.fatigue = clamp(p.needs.fatigue + (homeNear ? 38 : 23)); p.needs.fun = clamp(p.needs.fun + 12); this.runtime.restAt = this.now; return success(`在${building.name}休息，体力恢复。`);
    }
    if (command.type === 'rent') {
      const building = this.buildingNear(command.targetId, ['home']); if (!building) return fail('请到住宅门口办理租住。'); if (p.homeId === building.id) return fail('你已租住这里。'); if (p.money < 80) return fail('首期租金需要80云币。'); this.receivePublicFee(80, '公共住宅首期租金', building.districtId); p.homeId = building.id; p.reputation += 1; return success(`租住${building.name}，可在此休息和改造房间。`);
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
      const building = this.buildingNear(command.targetId, ['market', 'workshop', 'farm', 'dock'], 'work'); if (!building) return fail('请到商业设施入口洽谈经营。'); if (!this.hasIdentity('merchant')) return fail('取得商人经营资格后可承包店铺。');
      if (building.kind === 'market') return fail('请使用资产持有人授权挂牌的真实购买或承租入口，不能仅付款替换现经营者。');
      const shop = this.state.shops.find(s => s.buildingId === building.id); if (!shop) return fail('公共科研与政务设施不能作为私营商铺承包。'); if (this.state.extension?.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === building.id)) return fail('此商铺已公司化，请通过股权交易取得控制权。'); if (this.runtime.playerBusinesses.includes(shop.id)) return fail('这间商铺已由你经营。'); if (p.money < 300) return fail('承包资金需要300云币。'); const priorOwner = shop.ownerId === 'player' ? p : this.state.citizens.find(citizen => citizen.id === shop.ownerId), refund = priorOwner ? Math.max(0, this.shopFunds(shop) - this.shopProtectedFunds(shop)) : 0;
      if (priorOwner && priorOwner.money + refund > 1e9) return fail('原经营者现金账户已达上限。');
      if (priorOwner) { this.transferShopFunds(shop, -refund); priorOwner.money += refund; }
      p.money -= 250; this.transferShopFunds(shop, 250); this.receivePublicFee(50, '商铺承包登记费', building.districtId); this.transferBusinessOwnership(shop.id, 'player'); p.inventory.businesses = this.runtime.playerBusinesses.length; p.inventory[`business:${building.id}`] = 1; return success(`获得${building.name}经营权，250云币进入真实经营账户，库存仍须采购，实际在册雇员继续工作，盈利将按时分红。`);
    }
    if (command.type === 'exam') {
      if (command.targetId === 'study') return fail('请通过原课堂课程入口开始或继续学习。');
      const role = command.targetId && ROLES.includes(command.targetId as Role) ? command.targetId as Role : command.value === undefined ? 'teacher' : ROLES[command.value];
      if (!role || role === 'mayor') return fail('市长须通过议事堂选举，其余身份须报考对应职业。');
      if (role === 'traveler') { p.role = role; return success('恢复旅行者身份。'); }
      const kinds: Record<string, string[]> = { police: ['police'], soldier: ['police'], teacher: ['school'], driver: ['station', 'airport'], merchant: ['market'], scientist: ['school', 'core'], official: ['hall', 'core'], council: ['hall', 'core'] };
      if (!this.buildingNear(undefined, kinds[role])) return fail('请到对应职业机构的入口考试。');
      const requirement = ['soldier', 'official', 'council'].includes(role) ? 2 : role === 'scientist' ? 3 : 1; if (p.education < requirement) return fail(`请先在学堂完成${requirement}门课程。`); if (this.hasIdentity(role)) { p.role = role; return success('已切换为持有的职业身份，原身份与权限保留。'); } if (p.money < 80) return fail('职业考试报名费需要80云币。');
      this.receivePublicFee(80, '职业资格考试费', this.buildingNear(undefined, ['police', 'school', 'station', 'hall', 'core'])?.districtId ?? this.world.districts[0].id); this.addIdentity(role); p.experience++; p.reputation += 2; return success(`通过${role}职业考试，身份职责与权限已改变。`);
    }
    if (command.type === 'election') {
      const hall = this.buildingNear(command.targetId, ['hall', 'core']); if (!hall) return fail('请到议事堂登记参选。'); if (this.hasIdentity('mayor') || this.runtime.campaign) return fail('已当选或正在等待计票。'); if (p.education < 2 || p.experience < 4 || p.reputation < 8) return fail('候选资格：教育2、经验4、声望8。'); if (p.money < 120) return fail('竞选登记需要120云币。');
      const affection = this.state.relationships.length ? this.state.relationships.reduce((n, r) => n + r.affection, 0) / this.state.relationships.length : 0; this.receivePublicFee(120, '市长竞选登记费', hall.districtId); this.runtime.campaign = { countAt: this.now + 120, votes: clamp(this.state.support + p.reputation * .7 + affection * .1) }; return success('已登记竞选，两小时后公布真实民意计票结果。');
    }
    if (command.type === 'policy') {
      if (!this.hasIdentity('mayor')) return fail('仅当选市长可提交政策。'); if (!this.buildingNear(command.targetId, ['hall', 'core'])) return fail('请到议事堂提交政策。'); const taxRate = command.taxRate ?? this.state.taxRate, policeBudget = command.policeBudget ?? this.state.policeBudget;
      if (!finite(taxRate) || taxRate < 0 || taxRate > .3 || !finite(policeBudget) || policeBudget < 0 || policeBudget > 1) return fail('税率范围0至30%，警务预算范围0至100%。'); this.state.policyPending = { taxRate, policeBudget, applyAt: this.now + 120 }; return success('政策已送议会审议，两小时后生效；财政、治安和支持率将随之反馈。');
    }
    if (command.type === 'resolveCrime') {
      if (!['police', 'soldier'].some(role => this.hasIdentity(role as Role))) return fail('警察或士兵有权处理事件。'); const crime = this.state.crimes.find(c => c.id === command.targetId); if (!crime || crime.status === 'resolved') return fail('事件不存在或已经解决。'); if (distance(p.position, crime.position) > 40) return fail('请亲自前往事件现场。'); const reward = 18 * crime.severity; if (this.state.treasury < reward) return fail('公共预算不足以支付本次现场警务报酬。'); this.finishPoliceResponse(crime); this.state.treasury -= reward; p.money += reward * (1 - this.state.taxRate); this.runtime.taxes += reward * this.state.taxRate; this.bus.emit({ type: 'wage-earned', citizenId: 'player', districtId: crime.districtId, amount: reward }); this.bus.emit({ type: 'wage-paid', citizenId: 'player', districtId: crime.districtId, amount: reward, requestedAmount: reward }); p.reputation += 3; p.experience++; return success('现场事件处理完成，警务履历与社区声望提升。');
    }
    if (['socialize', 'gift', 'court', 'propose', 'divorce', 'conflict', 'reconcile'].includes(command.type)) {
      const citizen = this.state.citizens.find(c => c.id === command.targetId); if (!citizen || distance(p.position, citizen.position) > 24) return fail('请走到对方身边交谈。');
      if (this.state.extension?.actorProfiles[citizen.id]?.alive === false) return fail('对方已经离世，无法交谈。');
      if (command.type === 'gift') {
        const role = this.citizenIdentity(citizen);
        const reason = giftContactReason(this.world, p, { position: citizen.position, role, identities: [role] }, this.state.voxels);
        if (reason) return fail(reason);
      }
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
        if (command.targetId && isCloseKin(this.state, 'player', command.targetId)) return fail('近亲之间不能建立恋爱或婚姻关系。');
        if (['dating', 'engaged', 'married', 'family'].includes(currentRomance)) return fail('双方已有恋爱或婚姻关系，继续日常相处即可。');
        if (!existing || existing.affection < 55 || existing.trust < 35 || existing.encounters < 4) return fail('互相了解和信任还不够，先建立友谊。');
        if (currentRomance === 'pursuit' && (elapsedRomance < 60 - 1e-7 || existing.encounters < 6)) return fail('追求阶段须真实相处至少一小时、共六次互动，再确认双方意愿。');
        if (this.romanceWillingness(existing, citizen) < (currentRomance === 'pursuit' ? 55 : 50)) return fail('对方此时没有同意：情绪、已有伴侣、信任与亲友记忆都会影响意愿。');
      }
      if (command.type === 'propose') {
        if (command.targetId && isCloseKin(this.state, 'player', command.targetId)) return fail('近亲之间不能建立恋爱或婚姻关系。');
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
        if (currentRomance === 'engaged') { this.setRomanceStage(relation, 'married'); relation.type = 'spouse'; this.remember(relation, '双方同意办理婚姻，居所与共同财产另行协商', 6, 7); p.reputation += 3; }
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
      const vehicle = this.state.vehicles.find(v => v.id === command.targetId); if (!vehicle || distance(p.position, vehicle.position) > 35) return fail('请到车辆或站点附近上车。'); if (p.vehicleId) return fail('请先离开当前载具。'); if (!isRoadOpen(this.state, vehicle.edgeId) || vehicle.state === 'roadClosed') return fail('此路段已关闭，请等候真实改道或修复后上车。'); if (vehicle.state === 'moving') return fail('请等车辆进站停稳后上车。');
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
      if (!['mayor', 'driver', 'soldier', 'scientist', 'official'].some(role => this.hasIdentity(role as Role))) return fail('需要公共工程操作资格。'); if (!this.buildingNear(command.targetId, ['core', 'energy'])) return fail('请到瀑布能源核心维修。'); if (p.money < 100) return fail('维修材料需要100云币。'); if (this.now < this.runtime.energyBoostUntil) return fail('能源核心仍在维护增益期间。'); this.receivePublicFee(100, '能源设施维护材料费', this.buildingNear(command.targetId, ['core', 'energy'])!.districtId); this.runtime.energyBoostUntil = this.now + 240; p.experience++; p.reputation += 2; return success('水能装置修复，未来四小时能源供应提升，交通与商铺随供电反馈。');
    }
    if (command.type === 'build' || command.type === 'demolish') {
      const building = this.buildingNear(command.targetId, ['home', 'market', 'workshop', 'farm', 'dock']); if (!building) return fail('请到有使用权的建筑入口附近改造。'); const company = this.state.extension?.companies.find(c => c.shopBindingReleasedAt === undefined && c.buildingId === building.id); const owned = p.homeId === building.id || (company ? (company.shareholders.player ?? 0) > company.shares / 2 : this.runtime.playerBusinesses.some(id => this.state.shops.find(s => s.id === id)?.buildingId === building.id)); if (!owned || this.state.shops.some(shop => shop.buildingId === building.id && !shopLifecycleAllowsSpaceUse(this.state, shop.id))) return fail('仅能改造自己租住或仍有合法使用许可的经营空间。');
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
  get effectiveRuleset(): EffectiveRuleset { return effectiveCityRuleset(this.state, this.runtime); }
  get rulesetEnablement() { return readonlyCityEnablement(this.state, this.runtime); }
  get motionVersion(): 1 | 2 { return this.runtime.npcMotionVersion === 2 ? 2 : 1; }
  get saveVersion(): 1 | 2 | 3 | 4 { return this.effectiveRuleset === 'civic-local-v1' ? this.state.civicStaffing?.version === 2 ? 4 : 3 : this.motionVersion; }
  get referenceCollisionPolicyId(): ReferenceCollisionPolicy | 'legacy' { return this.runtime.referenceCollisionPolicyId ?? 'legacy'; }
  get mealRoutePolicyId(): MealRoutePolicy | 'legacy' { return this.runtime.mealRoutePolicyId ?? 'legacy'; }
  get freightPickupPolicyId(): FreightPickupPolicy | 'legacy' { return this.runtime.freightPickupPolicyId ?? 'legacy'; }
  get freightDeliveryPolicyId(): FreightDeliveryPolicy | 'legacy' { return this.runtime.freightDeliveryPolicyId ?? 'legacy'; }
  exportSave(): string {
    const { citizens, routeEncoding, routePool } = encodeCitizenRoutes(this.state.citizens);
    const persistedModules = PERSISTED_MODULES.filter(name => this.state[name] !== undefined && this.state[name] !== null);
    return JSON.stringify({ format: 'yunshan-save', version: this.saveVersion, ...(this.saveVersion >= 3 ? { rulesetId: 'civic-local-v1', motionVersion: this.motionVersion, ...(this.saveVersion === 4 ? { historyPolicyId: 'civic-history-pages-v1' } : {}) } : {}), ...(this.runtime.referenceCollisionPolicyId ? { referenceCollisionPolicyId: this.runtime.referenceCollisionPolicyId } : {}), ...(this.runtime.mealRoutePolicyId ? { mealRoutePolicyId: this.runtime.mealRoutePolicyId } : {}), ...(this.runtime.freightPickupPolicyId ? { freightPickupPolicyId: this.runtime.freightPickupPolicyId } : {}), ...(this.runtime.freightDeliveryPolicyId ? { freightDeliveryPolicyId: this.runtime.freightDeliveryPolicyId } : {}), worldSeed: this.world.seed, worldFingerprint: this.fingerprint, routeEncoding, routePool, state: { ...this.state, citizens }, runtime: { ...this.runtime, ...(this.runtime.npcMotionVersion === 2 ? { npcStairCursors: this.savedNpcStairCursors() } : {}), ...(this.state.shopLifecycle ? { shopLifecycleVersion: 1 } : {}), persistedModules } });
  }
  /** Read-only production validation for trusted host format transactions. */
  validateSave(json: string): CommandResult { return this.readSave(json, true); }
  importSave(json: string): CommandResult { return this.readSave(json, false); }
  private readSave(json: string, validateOnly: boolean): CommandResult {
    try {
      const data = parseSaveWithinResources(json);
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
      ensure(data && data.format === 'yunshan-save' && (data.version === 1 || data.version === 2 || data.version === 3 || data.version === 4) && data.worldSeed === this.world.seed && data.worldFingerprint === this.fingerprint, '世界或格式版本不匹配');
      const s = data.state, r = data.runtime;
      ensure(s && r && typeof s === 'object' && typeof r === 'object', '状态或运行数据'); ensure(s.version === 1 && s.seed === this.world.seed, '状态版本');
      const motionVersion = validateCityRulesetEnvelope(data);
      if (data.version === 4) freezeCivicHistory(s.civicHistory, s.civicStaffing.enablement.id, s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60, s.tick);
      if (motionVersion === 2) ensure(r.npcMotionVersion === 2 && r.npcStairCursors && typeof r.npcStairCursors === 'object' && !Array.isArray(r.npcStairCursors) && Object.keys(r.npcStairCursors).length <= 1024, 'native motion body and version');
      else ensure(r.npcMotionVersion === undefined && r.npcStairCursors === undefined, 'legacy motion body and version');
      if (s.shopLifecycle !== undefined || r.shopLifecycleVersion !== undefined) ensure(r.persistedModules !== undefined && s.shopLifecycle && r.shopLifecycleVersion === 1, 'shop lifecycle custody manifest');
      if (s.education !== undefined && s.education !== null || r.educationVersion !== undefined) ensure(r.persistedModules !== undefined, 'education persisted manifest');
      if (s.familyEducation !== undefined || r.familyEducationVersion !== undefined) ensure(r.persistedModules !== undefined && s.familyEducation && r.familyEducationVersion === 1, 'family education custody manifest');
      if (s.hygiene !== undefined || r.hygieneVersion !== undefined || s.pathology !== undefined || r.pathologyVersion !== undefined) ensure(r.persistedModules !== undefined, 'hygiene/pathology persisted manifest');
      if (s.roadNetwork !== undefined || r.roadNetworkVersion !== undefined || s.roadworks !== undefined || r.roadworksVersion !== undefined || s.roadDemands !== undefined || r.roadDemandsVersion !== undefined) ensure(r.persistedModules !== undefined, 'road network and roadwork persisted manifest');
      if (s.powerGrid !== undefined || this.world.powerGrid !== undefined) ensure(r.persistedModules !== undefined && s.powerGrid, 'declared power grid persisted manifest');
      if (s.power !== undefined || r.powerVersion !== undefined || r.legacyEnergyContractVersion !== undefined || r.legacyEnergyContract !== undefined) ensure(r.persistedModules !== undefined, 'power persisted manifest');
      if (s.governance !== undefined && s.governance !== null || r.governanceVersion !== undefined) ensure(r.persistedModules !== undefined, 'governance persisted manifest');
      if (s.governance !== undefined) ensure(r.campaign === null && s.policyPending === undefined, 'new governance cannot duplicate legacy political queues');
      ensure(r.governanceVersion === undefined && s.governance === undefined || r.governanceVersion === 1 && !!s.governance, 'governance body and version');
      if (r.persistedModules !== undefined) {
        const saved = array(r.persistedModules, PERSISTED_MODULES.length, 'persisted financial modules'), actual = PERSISTED_MODULES.filter(name => s[name] !== undefined && s[name] !== null);
        ensure(new Set(saved).size === saved.length && saved.every(name => PERSISTED_MODULES.includes(name) && s[name] && typeof s[name] === 'object') && saved.length === actual.length && actual.every(name => saved.includes(name)), 'persisted module bodies and manifest');
        // This is export metadata. Keeping it in the live runtime would move
        // later-created queues behind it and break byte-identical continuation.
        delete r.persistedModules;
        delete r.shopLifecycleVersion;
      }
      if (r.relationshipClock === undefined) r.relationshipClock = s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60;
      number(r.relationshipClock, 0, 1e12, 'relationship clock'); if (r.hostileAt === undefined) r.hostileAt = {};
      ensure(r.hostileAt && typeof r.hostileAt === 'object' && !Array.isArray(r.hostileAt), 'hostile timers');
      if (data.routeEncoding !== undefined) {
        decodeCitizenRoutes(data.routeEncoding, data.routePool, s.citizens, point => vec(point, 'pooled route position'));
      }
      number(s.tick, 0, 1e10, 'tick', true); number(s.day, 0, 1e8, 'day', true); ensure(finite(s.hour) && s.hour >= 0 && s.hour < 24, 'hour'); ensure(typeof s.paused === 'boolean', 'paused'); number(s.speed, .25, 16, 'speed'); ensure(['晴', '云', '雨', '雾'].includes(s.weather), 'weather'); number(s.visibility, 0, 1, 'visibility'); number(s.energy, 0, 100, 'energy'); money(s.treasury, 'treasury'); number(s.taxRate, 0, .3, 'taxRate'); number(s.policeBudget, 0, 1, 'policeBudget'); number(s.support, 0, 100, 'support'); money(s.bankBalance, 'bankBalance'); money(s.loan, 'loan'); money(s.gdp, 'gdp');
      ensure(JSON.stringify(s.lastSystemOrder) === JSON.stringify(ORDER) || Array.isArray(s.lastSystemOrder) && s.lastSystemOrder.length === 0 && s.tick === 0, 'system order');
      const districts = array(s.districts, this.world.districts.length, 'districts'); ensure(districts.length === this.world.districts.length, 'district count'); unique(districts, 'duplicate districts');
      const districtIds = new Set(this.world.districts.map(d => d.id));
      for (const d of districts) { ensure(districtIds.has(d.id), 'district id'); for (const key of ['energy', 'safety', 'prosperity', 'pollution']) number(d[key], 0, 100, `district.${key}`); number(d.employment, 0, 1, 'employment'); number(d.residents, 0, 1e8, 'residents'); number(d.crimeCount, 0, 1e10, 'crimeCount', true); ensure(['active', 'regional', 'statistical'].includes(d.tier), 'district tier'); }
      const registered = s.family?.children;
      if (registered !== undefined) ensure(registered && typeof registered === 'object' && !Array.isArray(registered), 'birth registration');
      const expectedCitizenIds = new Set(this.baselineCitizenIds);
      for (const id of Object.keys(registered ?? {})) { ensure(/^resident-[1-9][0-9]*$/.test(id), 'registered resident identity'); expectedCitizenIds.add(id); }
      const citizens = array(s.citizens, 1024, 'citizens'); ensure(citizens.length === expectedCitizenIds.size, 'citizen count'); unique(citizens, 'duplicate citizens');
      for (const c of citizens) { ensure(expectedCitizenIds.has(c.id) && districtIds.has(c.districtId), 'citizen identity'); ensure(this.buildings.has(c.homeId) && this.buildings.has(c.workId), 'citizen building'); vec(c.position, 'citizen position'); string(c.name, 'citizen name', 80); string(c.role, 'citizen role', 60); string(c.state, 'citizen state', 40); if (c.skills !== undefined) { ensure(c.skills && typeof c.skills === 'object' && Object.keys(c.skills).length <= 32, 'citizen skills'); for (const value of Object.values(c.skills)) number(value, 0, 100, 'citizen skill'); } if (c.education !== undefined) number(c.education, 0, 10000, 'citizen education'); for (const tag of array(c.socialIdentities ?? [], 32, 'social identities')) string(tag, 'social identity', 100); for (const tag of array(c.historyTags ?? [], 32, 'history tags')) string(tag, 'history tag', 100); ensure(c.destinationId === null || this.buildings.has(c.destinationId), 'destination'); money(c.money, 'citizen money'); needs(c.needs, 'citizen needs'); ensure(['active', 'regional', 'statistical'].includes(c.tier), 'citizen tier'); if (c.route !== undefined) for (const point of array(c.route, 1024, 'route')) vec(point, 'route position'); if (c.routeIndex !== undefined) number(c.routeIndex, 0, c.route?.length ?? 0, 'routeIndex', true); ensure(c.partnerId == null || c.partnerId === 'player' || expectedCitizenIds.has(c.partnerId), 'citizen partner'); }
      const expectedVehicleIds = new Set(this.state.vehicles.map(v => v.id)); const vehicles = array(s.vehicles, 2048, 'vehicles'); ensure(vehicles.length === expectedVehicleIds.size, 'vehicle count'); unique(vehicles, 'duplicate vehicles');
      for (const v of vehicles) { ensure(expectedVehicleIds.has(v.id), 'vehicle identity'); const edge = this.edges.get(v.edgeId); ensure(edge && edge.mode === v.kind, 'vehicle edge'); vec(v.position, 'vehicle position'); number(v.progress, 0, 1, 'progress'); ensure(v.direction === 1 || v.direction === -1, 'direction'); number(v.speed, 0, 2000, 'vehicle speed'); string(v.state, 'vehicle state', 40); number(v.passengers, 0, 5000, 'passengers', true); number(v.cargo, 0, 10000, 'cargo'); number(v.nextDeparture, -10000, 1e12, 'departure'); }
      const shops = array(s.shops, 512, 'shops'); ensure(shops.length === this.state.shops.length, 'shop count'); unique(shops, 'duplicate shops');
      const shopIds = new Set(this.state.shops.map(shop => shop.id)); for (const shop of shops) { ensure(shopIds.has(shop.id) && this.buildings.has(shop.buildingId) && districtIds.has(shop.districtId), 'shop identity'); number(shop.inventory, 0, 10000, 'inventory'); number(shop.price, 0, 1e5, 'price'); money(shop.revenue, 'revenue'); number(shop.profit, -1e12, 1e12, 'profit'); number(shop.customers, 0, 100000, 'customers'); number(shop.employees, 0, 10000, 'employees', true); ensure(typeof shop.open === 'boolean', 'shop open'); }
      for (const citizen of citizens) if (citizen.food !== undefined) number(citizen.food, 0, 6, 'stored food', true);
      for (const shop of shops) { if (shop.cash !== undefined) number(shop.cash, 0, 1e9, 'shop cash'); if (shop.ownerId !== undefined) ensure(shop.ownerId === 'player' || expectedCitizenIds.has(shop.ownerId), 'shop owner'); }
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
      for (const key of ['eventId', 'crimeId', 'constructionId']) number(r[key], 0, 1e12, key, true); ensure(r.eventId >= lastId, 'event counter'); vec(r.focus, 'focus'); ensure(['drone', 'walk', 'jet'].includes(r.mode), 'mode'); number(r.detail, .5, 2, 'detail'); money(r.taxes, 'taxes'); money(r.operatingCost, 'operatingCost'); money(r.investment, 'investment'); ensure(!s.banking || r.investment === 0, 'bank investment escrow must not be duplicated');
      for (const wage of array(r.wages, 1024, 'wages')) { ensure(expectedCitizenIds.has(wage.citizenId) && districtIds.has(wage.districtId), 'wage identity'); ensure(wage.shopId === undefined || wage.shopId === null || shopIds.has(wage.shopId), 'wage employer'); ensure(wage.expenseAccrued === undefined || typeof wage.expenseAccrued === 'boolean', 'wage accounting'); money(wage.amount, 'wage amount'); }
      if (r.playerLaborVersion !== undefined) ensure(r.playerLaborVersion === 1 && s.playerLabor, 'player payroll custody module');
      if (s.playerLabor) ensure(r.playerLaborVersion === 1, 'player payroll custody marker');
      if (r.educationVersion !== undefined) ensure(r.educationVersion === 1 && s.education, 'education custody module');
      if (s.education) ensure(r.educationVersion === 1, 'education custody marker');
      ensure(s.familyEducation === undefined && r.familyEducationVersion === undefined || s.familyEducation && r.familyEducationVersion === 1, 'family education body and version');
      if (r.hygieneVersion !== undefined) ensure((r.hygieneVersion === 1 || r.hygieneVersion === 2) && s.hygiene && r.hygieneVersion === s.hygiene.version, 'hygiene custody module');
      if (r.hygieneTransferVersion !== undefined || s.hygiene?.transfers !== undefined) ensure(r.hygieneTransferVersion === 1 && r.hygieneVersion === 2 && s.hygiene?.version === 2 && s.hygiene.transfers, 'hygiene transfer custody manifest');
      if (s.hygiene !== undefined) ensure(s.hygiene && r.hygieneVersion === s.hygiene.version && (r.hygieneVersion === 1 || r.hygieneVersion === 2), 'hygiene custody marker');
      if (r.pathologyVersion !== undefined) ensure(r.pathologyVersion === 1 && s.pathology, 'pathology provenance module');
      if (s.pathology !== undefined) ensure(s.pathology && r.pathologyVersion === 1, 'pathology provenance marker');
      if (r.roadNetworkVersion !== undefined) ensure(r.roadNetworkVersion === 1 && s.roadNetwork, 'road network provenance module');
      if (s.roadNetwork !== undefined) ensure(s.roadNetwork && r.roadNetworkVersion === 1, 'road network provenance marker');
      if (r.roadDemandsVersion !== undefined) ensure(r.roadDemandsVersion === 1 && s.roadDemands, 'road demand cause module');
      if (s.roadDemands !== undefined) ensure(s.roadDemands && r.roadDemandsVersion === 1, 'road demand cause marker');
      if (r.roadworksVersion !== undefined) ensure((r.roadworksVersion === 1 || r.roadworksVersion === 2) && s.roadworks, 'roadwork custody module');
      if (s.roadworks !== undefined) ensure(s.roadworks && (r.roadworksVersion === 1 || r.roadworksVersion === 2) && (r.roadworksVersion === 2 ? s.roadworks.replacementVersion === 1 : s.roadworks.replacementVersion === undefined), 'roadwork custody marker');
      if (r.powerVersion !== undefined) ensure(r.powerVersion === 1 && s.power, 'power body marker');
      if (s.power !== undefined) ensure(s.power && r.powerVersion === 1, 'power persistent marker');
      validateLegacyEnergyContract(r, s, this.world);
      if (s.power) ensure(Array.isArray(s.power.faults) && s.power.faults.every((fault: { id: number }) => fault.id <= r.eventId), 'power native event counter');
      ensure(r.accountingVersion === undefined || r.accountingVersion === 2, 'economic accounting version');
      if (r.wageAccruals !== undefined) {
        const keys = new Set<string>(), totals = new Map<string, number>();
        for (const claim of array(r.wageAccruals, 2048, 'wage accruals')) {
          ensure(claim && expectedCitizenIds.has(claim.citizenId) && districtIds.has(claim.districtId) && this.buildings.has(claim.workId), 'accrued wage references');
          ensure(claim.shopId === null ? !shops.some(shop => shop.buildingId === claim.workId) : shops.some(shop => shop.id === claim.shopId && shop.buildingId === claim.workId), 'accrued wage employer');
          number(claim.minutes, 0, 480, 'accrued wage minutes'); number(claim.ratePerMinute, 0, 1, 'contract wage rate'); money(claim.amount, 'accrued wage amount');
          ensure(Math.abs(claim.amount - claim.minutes * claim.ratePerMinute) < 1e-6, 'earned wage contract amount');
          const key = `${claim.citizenId}:${claim.workId}`; ensure(!keys.has(key), 'duplicate accrued wage'); keys.add(key);
          totals.set(claim.citizenId, (totals.get(claim.citizenId) ?? 0) + claim.minutes);
        }
        for (const [id, minutes] of totals) ensure(minutes <= 480 + 1e-7 && Math.abs(minutes - (r.attendance[id] ?? 0)) < 1e-6, 'accrued attendance conservation');
      }
      if (r.wageArrears !== undefined) { const claims = new Set<string>(); for (const wage of array(r.wageArrears, 2048, 'wage arrears')) { ensure(wage && expectedCitizenIds.has(wage.citizenId) && (wage.shopId === null || shopIds.has(wage.shopId)), 'wage arrears references'); money(wage.amount, 'wage arrears amount'); const key = `${wage.shopId ?? 'public'}:${wage.citizenId}`; ensure(!claims.has(key), 'duplicate wage claim'); claims.add(key); } }
      if (r.privateLabor !== undefined) {
        const labor = r.privateLabor, time = s.extension?.lastUpdate ?? 0, day = Math.floor(time / 1440);
        ensure(labor && labor.version === 1 && labor.shifts && typeof labor.shifts === 'object' && !Array.isArray(labor.shifts), 'private labor registry');
        number(labor.nextReviewAt, 0, time + 10, 'private employer review time'); ensure(Object.keys(labor.shifts).length <= shops.length, 'private labor count');
        let recordedMinutes = 0, recordedWork = 0;
        for (const [shopId, raw] of Object.entries(labor.shifts)) {
          const plan = raw as any, shop = shops.find(item => item.id === shopId), site = shop && this.buildings.get(shop.buildingId);
          ensure(shop && site && plan.shopId === shopId, 'private shift employer'); number(plan.day, 0, day, 'private shift day', true);
          const ids = new Set<string>(); let committed = 0;
          for (const item of array(plan.assignments, expectedCitizenIds.size, 'private shift assignments')) {
            ensure(item && expectedCitizenIds.has(item.citizenId) && !ids.has(item.citizenId), 'private shift worker'); ids.add(item.citizenId);
            number(item.ratePerMinute, 0, 1, 'private agreed wage rate'); number(item.minutesCap, 0, 480, 'private committed minutes', true); number(item.workedMinutes, 0, item.minutesCap, 'private actual minutes');
            committed += item.minutesCap * item.ratePerMinute; recordedMinutes += item.minutesCap; recordedWork += item.workedMinutes;
          }
          let funded = 0;
          for (const review of array(plan.reviews, 150, 'private employer reviews')) {
            ensure(review && (review.ownerId === 'player' || expectedCitizenIds.has(review.ownerId)), 'private employer signature');
            number(review.at, plan.day * 1440, Math.min(time, (plan.day + 1) * 1440), 'private approval time'); vec(review.ownerPosition, 'private employer location'); ensure(this.isNearBuilding(site!, review.ownerPosition, 2), 'private approval onsite');
            if (site!.floorPlanProfile === FLOOR_PLAN_PROFILE) {
              const presence = this.floorPlanPresence(site!, review.ownerPosition);
              // A signature records its actual place. A later career change
              // cannot rewrite the signer's historical floor permission.
              ensure(presence && this.buildingFunctionPoints(site!).some(point => point.purpose === 'work' && point.floor === presence.floor && distance(point.position, review.ownerPosition) <= 2), 'private approval work point');
            }
            for (const key of ['cash', 'earnedDebt', 'priorCommitment', 'operatingReserve', 'addedCommitment']) money(review[key], `private funding ${key}`);
            ensure(review.addedCommitment > 0 && review.cash <= 1e9 && review.cash - review.earnedDebt - review.priorCommitment - review.operatingReserve >= review.addedCommitment - 1e-6, 'private promise funded by actual cash'); funded += review.addedCommitment;
          }
          ensure(Math.abs(committed - funded) < 1e-6, 'private promised wage conservation');
        }
        ensure(labor.stats && typeof labor.stats === 'object', 'private labor statistics'); for (const key of ['approvedMinutes', 'workedMinutes', 'restrictedReviews']) number(labor.stats[key], 0, 1e12, `private labor ${key}`);
        ensure(labor.stats.approvedMinutes >= recordedMinutes - 1e-6 && labor.stats.workedMinutes >= recordedWork - 1e-6 && labor.stats.workedMinutes <= labor.stats.approvedMinutes + 1e-6, 'private labor coverage conservation');
      }
      if (r.publicLaborReviewAt !== undefined) number(r.publicLaborReviewAt, 0, (s.extension?.lastUpdate ?? 1e12) + 60, 'public labor review time');
      if (r.publicLabor !== undefined) {
        const labor = r.publicLabor; ensure(labor && [1,2].includes(labor.version) && labor.jobs && typeof labor.jobs === 'object' && !Array.isArray(labor.jobs), 'public labor registry');
        validatePublicEmployment(labor,s as SimState,this.world,(site,position,person,workOnly=true)=>this.isAtBuildingFunctionPoint(site,position,workOnly?'work':undefined,person),{
          identity:role=>this.citizenIdentity({role} as Citizen),budgets:r.publicBudgets ?? [],
          publicWagesDue:[...(r.wageArrears ?? []),...r.wages].filter((wage:{shopId:string|null})=>wage.shopId===null).reduce((sum:number,wage:{amount:number})=>sum+wage.amount,0),
          publicWagesEarned:(r.wageAccruals ?? []).filter((wage:{shopId:string|null})=>wage.shopId===null).reduce((sum:number,wage:{amount:number})=>sum+wage.amount,0),
          essentialOperations:(r.operatingCost+1440*(.9+s.policeBudget*1.8))/4*(r.operationUnitPrice ?? 4),claims:r.wageAccruals ?? []});
        const currentDay = Math.floor((s.extension?.lastUpdate ?? 0) / 1440); number(labor.standingUntilDay, 0, currentDay + 1, 'standing appropriation day', true); number(labor.nextReviewAt, 0, (s.extension?.lastUpdate ?? 1e12) + 60, 'departmental review time');
        for (const [id, siteId] of Object.entries(labor.jobs)) ensure(expectedCitizenIds.has(id) && this.buildings.has(siteId as string) && !shops.some(shop => shop.buildingId === siteId), 'public job registry reference');
        const days = new Set<number>();
        for (const shift of array(labor.shifts, 18, 'public labor shifts')) {
          ensure(shift && shift.id === `public-shift-${shift.day}` && !days.has(shift.day), 'public shift identity'); days.add(shift.day); number(shift.day, 0, currentDay + 1, 'public shift day', true); number(shift.approvedAt, 0, s.extension?.lastUpdate ?? 1e12, 'public shift approval time');
          ensure(Math.floor(shift.approvedAt / 1440) <= shift.day && ['hall', 'core', 'bank'].includes(this.buildings.get(shift.siteId)?.kind ?? ''), 'public shift review venue');
          if (shift.employmentRevision !== undefined) {
            ensure(labor.version===2,'new public shift requires explicit v2 reader'); number(shift.employmentRevision,1,labor.employment.transfers.length,'public shift employment revision',true);
            ensure(labor.employment.transfers[shift.employmentRevision-1].at <= shift.approvedAt,'public job must exist before signing');
          }
          const jobsAtApproval = publicEmploymentJobs(labor,shift.employmentRevision ?? 0);
          const approvers = array(shift.approvedBy, 2, 'public shift approvers'); ensure(approvers.length === 2 && new Set(approvers).size === 2 && approvers.every(id => expectedCitizenIds.has(id) && jobsAtApproval[id] === shift.siteId), 'public shift department quorum');
          number(shift.cap, 0, 1e9, 'public shift committed cash'); let total = 0; const workers = new Set<string>();
          for (const assignment of array(shift.assignments, 1024, 'public shift assignments')) {
            ensure(assignment && expectedCitizenIds.has(assignment.citizenId) && !workers.has(assignment.citizenId) && jobsAtApproval[assignment.citizenId] === assignment.workId, 'public shift worker'); workers.add(assignment.citizenId);
            number(assignment.minutesCap, 0, 480, 'public contract minutes', true); number(assignment.workedMinutes, 0, assignment.minutesCap + 1e-7, 'public actual contract work'); number(assignment.ratePerMinute, 0, 1, 'public promised minute rate'); total += assignment.ratePerMinute * assignment.minutesCap;
            if (shift.day > currentDay) ensure(assignment.workedMinutes === 0, 'future public shifts cannot have attendance');
          }
          ensure(Math.abs(total - shift.cap) < 1e-6, 'public committed payroll conservation');
        }
        ensure(labor.stats && typeof labor.stats === 'object', 'public service coverage'); for (const field of ['approvedMinutes', 'unfundedMinutes', 'workedMinutes', 'privateMoves']) number(labor.stats[field], 0, 1e12, `public coverage ${field}`);
      }
      if (r.publicBudgets !== undefined) {
        const ids = new Set<string>();
        for (const budget of array(r.publicBudgets, 256, 'public authorizations')) {
          ensure(budget && /^[a-zA-Z0-9-]{1,100}$/.test(budget.id) && !ids.has(budget.id) && this.buildings.has(budget.siteId), 'budget identity'); ids.add(budget.id);
          string(budget.purpose, 'budget purpose', 100); number(budget.cap, 0, 1e6, 'authorized cap'); number(budget.spent, 0, budget.cap, 'authorized spent'); number(budget.approvedAt, 0, s.extension?.lastUpdate ?? 1e12, 'budget approved time');
          ensure(budget.closedAt === null || finite(budget.closedAt) && budget.closedAt >= budget.approvedAt && budget.closedAt <= (s.extension?.lastUpdate ?? 1e12), 'budget close time');
          const approvers = array(budget.approvedBy, 16, 'budget approvers'), signatures = array(budget.signatures, 16, 'budget signatures'); ensure(approvers.length > 0 && new Set(approvers).size === approvers.length && signatures.length === approvers.length, 'budget approval signatures');
          ensure(budget.signatureVersion === undefined || (data.version === 3 || data.version === 4) && budget.signatureVersion === 2, 'budget signature version');
          if (budget.signatureVersion === undefined) for (const signature of signatures) ensure((signature.actorId === 'player' || expectedCitizenIds.has(signature.actorId)) && approvers.includes(signature.actorId) && ['official', 'council', 'mayor'].includes(signature.role) && ['hall', 'core', 'bank'].includes(this.buildings.get(signature.siteId)?.kind ?? '') && signature.signedAt === budget.approvedAt, 'budget signature authority');
          ensure(new Set(signatures.map(signature => signature.actorId)).size === signatures.length, 'unique budget signatures');
          if (budget.signatureVersion === undefined) ensure(signatures.some(signature => signature.role === 'mayor') || signatures.filter(signature => signature.role === 'council').length >= 2 || budget.cap <= 40 && signatures.length >= 2 && new Set(signatures.map(signature => signature.siteId)).size === 1, 'budget approval quorum');
        }
      }
      ensure(!(r.publicBudgets ?? []).some((budget: BudgetAuthorization) => ['education', 'health', 'transport'].includes(budget.purpose)) || s.culture?.version === 2, 'civic budgets require their service lifecycle');
      if (s.culture?.version === 2) {
        const budgets = (r.publicBudgets ?? []) as BudgetAuthorization[];
        for (const order of s.culture.orders.filter((order: ServiceOrder) => order.approvedAt !== null)) {
          const budget = budgets.find(budget => budget.id === order.id);
          ensure(budget && budget.siteId === order.siteId && budget.purpose === order.topic && budget.approvedAt === order.approvedAt && Math.abs(budget.cap - order.authorizedCap) < 1e-7 && Math.abs(budget.spent - order.spent) < 1e-6 && JSON.stringify([...budget.approvedBy].sort()) === JSON.stringify([...order.approvedBy].sort()), 'civic order authorization and material funds');
          ensure(order.state === 'fulfilled' || order.state === 'rejected' ? budget!.closedAt !== null : budget!.closedAt === null, 'civic budget lifecycle');
        }
        for (const budget of budgets.filter(budget => ['education', 'health', 'transport'].includes(budget.purpose))) ensure(s.culture.orders.some((order: ServiceOrder) => order.id === budget.id && order.approvedAt !== null), 'civic authorization must retain its service order');
      }
      validateSupplementalBudgetCrossReferences(s, r.publicBudgets ?? []);
      validatePowerBudgetCrossReferences(s, r.publicBudgets ?? []);
      validateRoadworksBudgetCrossReferences(s, r.publicBudgets ?? []);
      validatePublicDisinfectionBudgetCrossReferences(s, r.publicBudgets ?? []);
      ensure(r.freight && typeof r.freight === 'object' && !Array.isArray(r.freight), 'freight'); for (const [id, amount] of Object.entries(r.freight)) { ensure(districtIds.has(id), 'freight district'); money(amount, 'freight amount'); }
      if (r.shopLabor !== undefined) { ensure(r.shopLabor && typeof r.shopLabor === 'object' && !Array.isArray(r.shopLabor), 'shop labor'); for (const [id, minutes] of Object.entries(r.shopLabor)) { ensure(shopIds.has(id), 'shop labor identity'); number(minutes, 0, 100000, 'shop labor minutes'); } }
      if (r.poweredShopLabor !== undefined) { ensure(this.world.powerGrid && s.powerGrid && r.poweredShopLabor && typeof r.poweredShopLabor === 'object' && !Array.isArray(r.poweredShopLabor), 'powered shop labor declared grid'); for (const [id, minutes] of Object.entries(r.poweredShopLabor)) { ensure(shopIds.has(id), 'powered shop labor identity'); number(minutes, 0, r.shopLabor?.[id] ?? 0, 'powered shop labor cannot exceed actual work'); } }
      if (r.retailSalesSinceBatch !== undefined) {
        ensure(r.retailSalesSinceBatch && typeof r.retailSalesSinceBatch === 'object' && !Array.isArray(r.retailSalesSinceBatch), 'retail batch sales');
        ensure(Object.keys(r.retailSalesSinceBatch).length <= shops.length, 'retail batch shop count');
        for (const [id, quantity] of Object.entries(r.retailSalesSinceBatch)) { ensure(shopIds.has(id), 'retail batch shop identity'); number(quantity, 0, 100000, 'retail batch units', true); }
      }
      if (r.publicSupply !== undefined) number(r.publicSupply, 0, 1, 'public supply fulfillment'); if (r.operationUnitPrice !== undefined) number(r.operationUnitPrice, 4, 1e12, 'observed public material unit price');
      if (r.cargoSources !== undefined) { ensure(r.cargoSources && typeof r.cargoSources === 'object' && !Array.isArray(r.cargoSources), 'cargo ownership'); for (const [id, shopId] of Object.entries(r.cargoSources)) ensure(expectedVehicleIds.has(id) && shopIds.has(shopId as string), 'cargo owner reference'); }
      if (r.freightDeliveryPolicyId === ROAD_FOOD_DELIVERY_POLICY) for (const [id, sourceId] of Object.entries(r.cargoSources ?? {})) {
        const vehicle = vehicles.find(vehicle => vehicle.id === id), carrier = this.freightCarriers.get(id), source = shops.find(shop => shop.id === sourceId), site = source && this.buildings.get(source.buildingId);
        if (vehicle?.kind === 'road') ensure(carrier?.kind === 'road' && vehicle.cargo > 0 && vehicle.cargo <= carrier.cargoCapacity && source && site && ['farm', 'dock'].includes(site.kind) && !site.facility, 'declared named food carrier custody/capacity');
      }
      if (r.freightLots !== undefined) { ensure(r.freightLots && typeof r.freightLots === 'object' && !Array.isArray(r.freightLots), 'freight ownership'); for (const [id, lots] of Object.entries(r.freightLots)) { ensure(districtIds.has(id), 'freight ownership district'); let total = 0; for (const lot of array(lots, shops.length + 1, 'freight lots')) { ensure(lot && (lot.shopId === null || shopIds.has(lot.shopId)), 'freight owner'); money(lot.quantity, 'freight lot quantity'); total += lot.quantity; } ensure(Math.abs(total - (r.freight[id] ?? 0)) < 1e-6, 'freight stock conservation'); } }
      for (const id of array(r.playerBusinesses, 512, 'businesses')) ensure(shopIds.has(id), 'business id'); ensure(new Set(r.playerBusinesses).size === r.playerBusinesses.length, 'duplicate businesses');
      for (const shop of shops) if (shop.lifecycleVersion === 1) ensure(r.playerBusinesses.includes(shop.id) === (shop.ownerId === 'player' && !s.extension?.companies.some((company: { buildingId: string; shopBindingReleasedAt?: number }) => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)), 'managed business mirror must reflect actual operating owner');
      ensure(r.campaign === null || r.campaign && finite(r.campaign.countAt) && r.campaign.countAt >= 0 && finite(r.campaign.votes) && r.campaign.votes >= 0 && r.campaign.votes <= 100, 'campaign');
      ensure(r.signalOverrides && typeof r.signalOverrides === 'object', 'signals'); for (const [id, value] of Object.entries(r.signalOverrides)) ensure(this.world.nodes.some(n => n.id === id) && (value === 0 || value === 1), 'signal override');
      ensure(r.relationshipAt && typeof r.relationshipAt === 'object', 'relationship timers'); for (const [id, at] of Object.entries(r.relationshipAt)) { ensure(expectedCitizenIds.has(id.startsWith('reconcile:') ? id.slice(10) : id), 'relationship timer id'); number(at, -10000, 1e12, 'relationship timer'); }
      if (s.signals !== undefined) { ensure(s.signals && typeof s.signals === 'object' && !Array.isArray(s.signals), 'signals'); for (const [id, phase] of Object.entries(s.signals)) ensure(this.world.nodes.some(n => n.id === id) && (phase === 0 || phase === 1), 'signal phase'); }
      ensure(r.riders && typeof r.riders === 'object' && !Array.isArray(r.riders), 'riders'); for (const [id, rider] of Object.entries(r.riders) as [string, any][]) {
        ensure(rider && typeof rider === 'object' && !Array.isArray(rider) && expectedCitizenIds.has(id) && expectedVehicleIds.has(rider.vehicleId) && this.world.nodes.some(n => n.id === rider.stopNodeId) && (rider.arrived === undefined || typeof rider.arrived === 'boolean'), 'rider references');
        if (rider.arrivedAt !== undefined) { ensure(rider.arrived === true, 'rider arrival state'); number(rider.arrivedAt, 0, s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60, 'rider arrival clock'); }
        // Candidate object keys cannot affect live riders if a later validator
        // rejects this import. Do not rewrite an old save before its first tick.
        else if (rider.arrived === true) this.legacyRiderArrivalAt.set(rider, s.extension?.lastUpdate ?? s.day * 1440 + s.hour * 60);
      }
      const socialLinks = array(r.links, 4096, 'social links'); const socialKeys = new Set<string>(); for (const link of socialLinks) { ensure(expectedCitizenIds.has(link.from) && expectedCitizenIds.has(link.to) && link.from !== link.to, 'social link identities'); const key = [link.from, link.to].sort().join(':'); ensure(!socialKeys.has(key), 'duplicate social link'); socialKeys.add(key); ensure(['family', 'coworker', 'neighbor', 'rival'].includes(link.type), 'social link type'); number(link.affection, -100, 100, 'social link affection'); number(link.trust, -100, 100, 'social link trust'); }
      ensure(r.impressions && typeof r.impressions === 'object' && !Array.isArray(r.impressions), 'social impressions'); for (const [id, impression] of Object.entries(r.impressions) as [string, any][]) { ensure(expectedCitizenIds.has(id), 'impression identity'); number(impression.affection, -100, 100, 'impression affection'); number(impression.trust, -100, 100, 'impression trust'); }
      ensure(r.districtRelationMeans && typeof r.districtRelationMeans === 'object', 'district relationship means'); for (const [id, mean] of Object.entries(r.districtRelationMeans)) { ensure(districtIds.has(id), 'district relationship identity'); number(mean, -100, 100, 'district relationship mean'); }
      ensure(r.decisionAt && typeof r.decisionAt === 'object' && !Array.isArray(r.decisionAt), 'decision timers'); for (const [id, at] of Object.entries(r.decisionAt)) { ensure(expectedCitizenIds.has(id), 'decision citizen'); number(at, 0, 1e12, 'decision time'); }
      ensure(r.activities && typeof r.activities === 'object' && !Array.isArray(r.activities), 'activities'); for (const [id, activity] of Object.entries(r.activities)) ensure(expectedCitizenIds.has(id) && ['rest', 'work', 'study', 'social', 'eat', 'heal', 'service', 'budgetReview', 'businessReview', 'shopLifecycle', ...(data.version === 3 || data.version === 4 ? ['civicRegister', 'civicVote'] : [])].includes(activity as string), 'activity');
      ensure(r.attendance && typeof r.attendance === 'object' && !Array.isArray(r.attendance), 'attendance'); for (const [id, minutes] of Object.entries(r.attendance)) { ensure(expectedCitizenIds.has(id), 'attendance citizen'); number(minutes, 0, 100000, 'attendance minutes'); }
      ensure(r.customers && typeof r.customers === 'object' && !Array.isArray(r.customers), 'customers'); for (const [id, shopId] of Object.entries(r.customers)) ensure(expectedCitizenIds.has(id) && shopIds.has(shopId as string), 'customer reference');
      ensure(r.driving && typeof r.driving === 'object' && (r.driving.vehicleId === null || expectedVehicleIds.has(r.driving.vehicleId) && r.driving.vehicleId === p.vehicleId), 'driving vehicle'); number(r.driving.throttle, -1, 1, 'driving throttle'); number(r.driving.turn, -1, 1, 'driving turn'); ensure(typeof r.driving.brake === 'boolean', 'driving brake'); number(r.driving.speed, 0, 200, 'driving speed');
      ensure(r.dispatches && typeof r.dispatches === 'object' && !Array.isArray(r.dispatches), 'dispatches'); for (const [id, dispatch] of Object.entries(r.dispatches) as [string, any][]) ensure(expectedCitizenIds.has(id) && crimes.some(c => c.id === dispatch.crimeId) && typeof dispatch.arrived === 'boolean', 'dispatch references');
      validatePoliceSupplies(s as SimState, r, this.world);
      for (const [id, at] of Object.entries(r.hostileAt)) { ensure(expectedCitizenIds.has(id), 'hostile timer identity'); number(at, 0, 1e12, 'hostile timer'); }
      if (r.peopleElapsed !== undefined) {
        ensure(r.peopleElapsed && typeof r.peopleElapsed === 'object' && !Array.isArray(r.peopleElapsed), 'deferred people minutes');
        for (const [id, minutes] of Object.entries(r.peopleElapsed)) { ensure(expectedCitizenIds.has(id), 'deferred actor identity'); number(minutes, 0, 60 + 1e-7, 'deferred actor minutes'); }
      }
      // Validation finishes before either live object is replaced: rejected saves are atomic.
      if (data.version === 3 || data.version === 4) validateCivicOriginalOfficials(s as SimState, r.publicLabor, this.world, this.initialCivicProfessions);
      for (const validator of this.saveValidators) validator(s as SimState);
      validateBudgetAuthority(s as SimState, this.world, r);
      if (motionVersion === 2) {
        const cursorCitizens = new Map<string, Citizen>(s.citizens.map((c: Citizen) => [c.id, c]));
        for (const [id, cursor] of Object.entries(r.npcStairCursors)) {
          const citizen = cursorCitizens.get(id);
          ensure(citizen && s.extension?.actorProfiles[id]?.alive !== false && !r.riders[id] && this.nativeCursorMatches(citizen, cursor as NpcStairCursor), 'native cursor actor and route');
          this.npcStairMotion.validate(citizen!.route!, cursor as NpcStairCursor, citizen!.position);
        }
        for (const citizen of s.citizens as Citizen[]) {
          if (s.extension?.actorProfiles[citizen.id]?.alive === false || r.riders[citizen.id] || !citizen.route || !citizen.routeIndex || citizen.routeIndex >= citizen.route.length || r.npcStairCursors[citizen.id]) continue;
          const description = this.npcStairMotion.describe(citizen.route, citizen.routeIndex);
          ensure(description.kind !== 'blocked' || this.npcStairMotion.isUnstartedExteriorDoorApproach(citizen.route, citizen.routeIndex, citizen.position), 'native route geometry');
          if (description.kind === 'physical') this.npcStairMotion.validate(citizen.route, this.npcStairMotion.opening(citizen.route, citizen.routeIndex)!, citizen.position);
        }
      }
      if (validateOnly) return { ok: true, message: '完整存档已通过生产读取校验；原城市未改变。' };
      const previousState = this.state, previousRuntime = this.runtime; this.state = s as VoxelState; this.runtime = r as Runtime; try { for (const hook of this.loadHooks) hook(); } catch (error) { this.state = previousState; this.runtime = previousRuntime; throw error; } if (this.runtime.npcMotionVersion === 2) for (const [id, cursor] of Object.entries(this.runtime.npcStairCursors!)) this.npcCursorRoutes.set(cursor, this.state.citizens.find(c => c.id === id)!.route!); this.employment.clear(); this.refreshWorkforce(); this.resetRoadRouting(); this.freightDeliveryRouter.clear(); return { ok: true, message: '云山存档已恢复；时钟、随机数、班次与所有模拟实体继续原进程。' };
    } catch (error) { return { ok: false, message: `读档失败：${error instanceof Error ? error.message : '存档格式错误'}` }; }
  }
}
