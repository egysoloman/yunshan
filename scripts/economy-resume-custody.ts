import type { WorldDefinition } from '../src/types';

/** Read-only custody observations. This module never imports Simulation or
 * registers a live witness. Call only after a complete system phase: cargo
 * arrival callbacks temporarily expose the same units in two containers. */
export interface CustodyAccount { id: string; kind: string; amount: number }
export interface CustodyAlias { id: string; targetId: string; amount: number; reason: string }
export interface CashCustodySnapshot {
  total: number; accounts: CustodyAccount[]; aliases: CustodyAlias[]; claims: CustodyAccount[];
}
export interface FoodHolding { id: string; kind: string; amount: number; sourceId?: string }
export interface FreightCustody {
  districtId: string; quantity: number; lots: { shopId: string | null; quantity: number }[];
}
export interface FoodCustodySnapshot {
  total: number; holdings: FoodHolding[]; aliases: CustodyAlias[]; freightLots: FreightCustody[];
}
export type DebtQueue = 'arrears' | 'accruals' | 'wages';
export interface DebtRow {
  queue: DebtQueue; citizenId: string; shopId: string | null; amount: number;
  metadata: Record<string, unknown>;
}
export interface EmployerDebt {
  citizenId: string; shopId: string | null; arrears: number; accruals: number; wages: number; total: number;
}
export interface WageDebtSnapshot {
  total: number; arrears: number; accruals: number; wages: number;
  byEmployer: EmployerDebt[]; rows: DebtRow[];
}

type Data = Record<string, unknown>;
const keys = (text: string) => new Set(text.split(' '));
const STATE_KEYS = keys('nightRetail hydroMaintenance powerGrid serviceMaterialScheduling civicHistory budgetAuthority civicStaffing familyEducation residentEducation roadDemands roadNetwork roadworks hygiene pathology governance shopLifecycle power education homeRest clinical playerLabor trade journey banking culture family aviation extension signals voxels version seed tick day hour paused speed weather visibility energy treasury taxRate policeBudget support bankBalance loan gdp lastSystemOrder districts citizens vehicles shops player relationships crimes events policyPending metrics');
const RUNTIME_KEYS = keys('nightRetailVersion rng accumulator weatherAt crimeAt payrollAt commerceAt financeAt socialAt eventId crimeId focus mode detail workAt studyAt wages persistedModules civicStaffingVersion civicHistoryVersion budgetAuthorityVersion roadNetworkVersion roadworksVersion roadDemandsVersion governanceVersion hygieneVersion hygieneTransferVersion pathologyVersion powerVersion legacyEnergyContractVersion legacyEnergyContract educationVersion familyEducationVersion residentEducationVersion playerLaborVersion accountingVersion wageAccruals publicLabor publicLaborReviewAt privateLabor publicBudgets wageArrears taxes freight playerBusinesses investment freightLots cargoSources campaign signalOverrides constructionId energyBoostUntil operatingCost restAt relationshipAt lastInvestmentAt publicSupply operationUnitPrice riders links impressions districtRelationMeans decisionAt activities peopleElapsed npcMotionVersion referenceCollisionPolicyId mealRoutePolicyId freightPickupPolicyId freightDeliveryPolicyId residentTuitionPolicyId serviceMaterialSchedulingVersion npcStairCursors attendance shopLabor poweredShopLabor retailSalesSinceBatch customers driving policeSuppliesVersion policeSupplies dispatches relationshipClock hostileAt');
const CITIZEN_KEYS = keys('food skills socialIdentities historyTags education id name districtId homeId workId role position state destinationId money needs tier route routeIndex partnerId');
const SHOP_KEYS = keys('nightRetailVersion lifecycleVersion cash ownerId id buildingId districtId inventory price revenue profit customers open employees');
const COMPANY_KEYS = keys('shopBindingId shopBindingReleasedAt id name ownerId buildingId districtId capital shares sharePrice listed employees inventory revenue profit level marketShare shareholders foundedAt parentId');
const PLAYER_KEYS = keys('identities position role money reputation needs inventory homeId education experience partnerId vehicleId');
const VEHICLE_KEYS = keys('id kind position edgeId progress direction speed state passengers cargo nextDeparture');
const EXTENSION_KEYS = keys('version companies technologies audits actorProfiles publicLedger cooking organizations environment institutions lastUpdate nextCompanyId nextAuditId stats runtime');
const EXTENSION_RUNTIME_KEYS = keys('version nextCompanyAt nextCorruptionAt nextLedgerAt lastTreasury cooldowns researchJobs researchLaborVersion legacyResearchSectors companyCursors deprivation diversions constructionJobs');
const BANK_KEYS = keys('version cash legacyInvestmentCash legacyInvestmentPrincipal nextInterestAt nextReceiptId profitAvailable accounts nextVisitAt receipts stats');
const MODULE_KEYS: Record<string, Set<string>> = {
  nightRetail: keys('version nextId shopIds jobs'),
  playerLabor: keys('version nextId nextAvailableAt lastObservedAt job history stats'),
  roadworks: keys('replacementVersion replacementActivatedAt replacementFirstJobId version activatedAt nextId jobs stock capacityHistory'),
  education: keys('version nextId lastObservedAt course history stock stats archived'),
  familyEducation: keys('version nextId lastObservedAt active pages stock totals'),
  residentEducation: keys('version nextId lastObservedAt active pages stock totals ageClocks'),
  power: keys('version activatedAt sourceSiteId operatorSiteId networkKind faults lossP nextRepairId repairs stock dispatch buildingMeters vehicleMeters totals capacityHistory capacityArchive researchBaseline unobservedResearchCompletions nextPublicReviewAt'),
  clinical: keys('version paidTriage nextOrderId orders stock nextVisitAt stats archived'),
  hygiene: keys('transfers publicVersion nextDemandId publicDemands version rulesetId nextBatchId nextJobId activatedAt lastObservedAt clinicalBaseline batches jobs stock stats archived capacityHistory'),
  family: keys('version lastUpdate nextResidentId nextPregnancyId pregnancies children studentGuardians nextSupportAt nextPlanAt estates bonds movePlans households ceremonies nextHouseholdId nextCeremonyId nextBondAt careGuardians estateSales nextEstateSaleId formalLearningVersion formalLearning'),
  shopLifecycle: keys('version nextListingId nextLeaseId nextReceiptId titles listings leases receipts'),
  hydroMaintenance: keys('version kind sourceId operatorSiteId activatedAt job'),
};

function fail(code: string, path: string, reason: string): never {
  throw new Error(`CUSTODY_${code}: ${path}: ${reason}`);
}
function object(value: unknown, path: string, allowed?: Set<string>): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SHAPE', path, 'expected data object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('SHAPE', path, 'unsupported prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('SHAPE', path, 'symbol property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) fail('SHAPE', `${path}.${key}`, 'not an enumerable data property');
    if (allowed && !allowed.has(key)) fail('UNKNOWN_ACCOUNT', `${path}.${key}`, 'field has no custody classification');
  }
  return value as Data;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('SHAPE', path, 'expected dense data array');
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1) fail('SHAPE', path, 'array hole or extra property');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('SHAPE', `${path}[${index}]`, 'not a data element');
  }
  return value;
}
function amount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('NUMBER', path, 'expected finite nonnegative quantity');
  return value;
}
function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail('IDENTITY', path, 'expected nonempty ID');
  return value;
}
function ownValue(host: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(host, key);
  if (!descriptor || !('value' in descriptor)) fail('SHAPE', `host.${key}`, 'expected own data property');
  return descriptor.value;
}
function entities(value: unknown, path: string, allowed: Set<string>): Data[] {
  const seen = new Set<string>();
  return array(value, path).map((row, index) => {
    const data = object(row, `${path}[${index}]`, allowed), rowId = id(data.id, `${path}[${index}].id`);
    if (seen.has(rowId)) fail('IDENTITY', path, `duplicate ID ${rowId}`);
    seen.add(rowId); return data;
  });
}
function context(host: object, world: WorldDefinition) {
  const state = object(ownValue(host, 'state'), 'state', STATE_KEYS);
  const runtime = object(ownValue(host, 'runtime'), 'runtime', RUNTIME_KEYS);
  const extension = state.extension === undefined ? undefined : object(state.extension, 'state.extension', EXTENSION_KEYS);
  if (extension?.runtime !== undefined) object(extension.runtime, 'state.extension.runtime', EXTENSION_RUNTIME_KEYS);
  object(world, 'world');
  const buildings = new Map<string, Data>();
  for (const [index, raw] of array(world.buildings, 'world.buildings').entries()) {
    const building = object(raw, `world.buildings[${index}]`), buildingId = id(building.id, 'world.building.id');
    if (!['home', 'market', 'workshop', 'bank', 'hall', 'police', 'school', 'clinic', 'station', 'core', 'pavilion', 'airport', 'starport', 'farm', 'dock'].includes(id(building.kind, `world.building.${buildingId}.kind`))) fail('SOURCE', `world.building.${buildingId}.kind`, 'unclassified building kind');
    if (buildings.has(buildingId)) fail('IDENTITY', 'world.buildings', `duplicate ${buildingId}`);
    buildings.set(buildingId, building);
  }
  const citizens = entities(state.citizens, 'state.citizens', CITIZEN_KEYS);
  if (citizens.some(citizen => citizen.id === 'player')) fail('IDENTITY', 'state.citizens', 'player is a separate wallet');
  const shops = entities(state.shops, 'state.shops', SHOP_KEYS);
  classifyNightRetailMetadata(state, runtime, shops, citizens);
  const clinical = module(state, 'clinical');
  if (clinical?.version === 2) {
    const selection = object(clinical.paidTriage, 'clinical.paidTriage', keys('policyId siteId'));
    if (selection.policyId !== 'paid-clinical-severity-wait-v1' || buildings.get(id(selection.siteId, 'clinical.paidTriage.siteId'))?.kind !== 'clinic')
      fail('SOURCE', 'clinical.paidTriage', 'declared paid queue requires a real clinic');
  } else if (clinical?.paidTriage !== undefined) fail('SOURCE', 'clinical.paidTriage', 'legacy clinical domain has no triage declaration');
  const companies = extension ? entities(extension.companies, 'state.extension.companies', COMPANY_KEYS) : [];
  const player = object(state.player, 'state.player', PLAYER_KEYS);
  for (const company of companies) {
    if (!buildings.has(id(company.buildingId, `company.${company.id}.buildingId`))) fail('SOURCE', `company.${company.id}`, 'unknown building');
    if (company.shopBindingReleasedAt !== undefined) amount(company.shopBindingReleasedAt, `company.${company.id}.shopBindingReleasedAt`);
  }
  for (const shop of shops) if (!buildings.has(id(shop.buildingId, `shop.${shop.id}.buildingId`))) fail('SOURCE', `shop.${shop.id}`, 'unknown building');
  function binding(shop: Data): Data | undefined {
    const owners = companies.filter(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId);
    if (owners.length > 1) fail('IDENTITY', `shop.${shop.id}`, 'multiple active company owners');
    return owners[0];
  }
  return { state, runtime, extension, citizens, shops, companies, player, buildings, binding };
}
function module(state: Data, name: string): Data | undefined {
  return state[name] === undefined ? undefined : object(state[name], `state.${name}`, MODULE_KEYS[name]);
}
/** The night contract never owns cash or food. Its funding fields are bounded
 * observations of the original shop/assignment at declaration; custody stays
 * in those original accounts and wage queues. Every nested field is classified
 * explicitly so a new hidden wallet cannot masquerade as this history. */
function classifyNightRetailMetadata(state: Data, runtime: Data, shops: Data[], citizens: Data[]): void {
  const body = module(state, 'nightRetail'), marked = shops.filter(shop => shop.nightRetailVersion !== undefined);
  if (!body) {
    if (marked.length || runtime.nightRetailVersion !== undefined) fail('SOURCE', 'nightRetail', 'missing marked contract history');
    return;
  }
  if (body.version !== 1 || runtime.nightRetailVersion !== 1) fail('SOURCE', 'nightRetail', 'unsupported contract marker');
  const shopIds = array(body.shopIds, 'nightRetail.shopIds'), jobs = array(body.jobs, 'nightRetail.jobs');
  if (jobs.length > 128 || shopIds.length !== marked.length || new Set(shopIds).size !== shopIds.length
    || shopIds.some(shopId => !marked.some(shop => shop.id === shopId && shop.nightRetailVersion === 1))) fail('SOURCE', 'nightRetail.shopIds', 'bidirectional shop markers');
  const jobFields = keys('id shopId buildingId operatorId startedAt endsAt lastServedAt lastObservedTick lastObservedAt servedMinutes status pauseReason endedAt demandIds funding');
  const fundingFields = keys('kind day assignmentKey ratePerMinute approvedMinutes workedMinutesAtStart attendanceMinutesAtStart fundsAtStart protectedFundsAtStart');
  for (const [index, raw] of jobs.entries()) {
    const path = `nightRetail.jobs[${index}]`, job = object(raw, path, jobFields);
    if (!shopIds.includes(job.shopId) || !shops.some(shop => shop.id === job.shopId && shop.buildingId === job.buildingId)
      || !citizens.some(citizen => citizen.id === job.operatorId)) fail('SOURCE', path, 'named original employer/operator');
    for (const field of ['startedAt', 'endsAt', 'servedMinutes']) amount(job[field], `${path}.${field}`);
    for (const field of ['lastServedAt', 'lastObservedAt', 'lastObservedTick', 'endedAt']) if (job[field] !== null) amount(job[field], `${path}.${field}`);
    array(job.demandIds, `${path}.demandIds`);
    const proof = object(job.funding, `${path}.funding`, fundingFields);
    if (proof.kind !== 'existing-private-assignment') fail('SOURCE', `${path}.funding`, 'original private labor observation required');
    id(proof.assignmentKey, `${path}.funding.assignmentKey`);
    for (const field of ['day', 'ratePerMinute', 'approvedMinutes', 'workedMinutesAtStart', 'attendanceMinutesAtStart', 'fundsAtStart', 'protectedFundsAtStart']) amount(proof[field], `${path}.funding.${field}`);
  }
}
// Account-row metadata can contain historical payment totals. Reject additional
// cash-like fields; they cannot silently become an uncounted new custody bag.
const FINANCIAL_NAMES = /cash|money|capital|funds|balance|escrow|deposit|investment|wallet|purse|funding|account/i;
function financialRow(raw: unknown, path: string, accepted: string): Data {
  const row = object(raw, path), names = keys(accepted);
  for (const name of Object.keys(row)) if (FINANCIAL_NAMES.test(name) && !names.has(name)) fail('UNKNOWN_ACCOUNT', `${path}.${name}`, 'unclassified financial field');
  return row;
}
function sumFinite(rows: readonly { id: string; amount: number }[], path: string): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) fail('IDENTITY', path, `duplicate holding ${row.id}`);
    seen.add(row.id);
  }
  const result = rows.reduce((sum, row) => sum + row.amount, 0);
  return amount(result, path);
}

/** Physical money only. Claims and legacy mirrors remain visible separately. */
export function cashSnapshot(host: object, world: WorldDefinition): CashCustodySnapshot {
  const { state: s, runtime: r, extension: e, citizens, shops, companies, player, binding } = context(host, world);
  const accounts: CustodyAccount[] = [], aliases: CustodyAlias[] = [], claims: CustodyAccount[] = [];
  const add = (accountId: string, kind: string, value: unknown) => accounts.push({ id: accountId, kind, amount: amount(value, accountId) });
  const claim = (accountId: string, kind: string, value: unknown) => claims.push({ id: accountId, kind, amount: amount(value, accountId) });
  add('state.treasury', 'treasury', s.treasury); add('runtime.taxes', 'tax-queue', r.taxes);
  add('state.player.money', 'player-wallet', player.money);
  for (const citizen of citizens) add(`citizen.${citizen.id}.money`, 'resident-wallet', citizen.money);
  if (s.banking !== undefined) {
    const bank = object(s.banking, 'state.banking', BANK_KEYS);
    add('banking.cash', 'bank-vault', bank.cash); add('banking.legacyInvestmentCash', 'legacy-investment-custody', bank.legacyInvestmentCash);
    if (amount(r.investment, 'runtime.investment') !== 0) fail('ALIAS', 'runtime.investment', 'banking migration must not retain separate investment cash');
    const bankAccounts = object(bank.accounts, 'banking.accounts'), actors = new Set(['player', ...citizens.map(citizen => String(citizen.id))]);
    for (const [actorId, raw] of Object.entries(bankAccounts)) {
      if (!actors.has(actorId)) fail('IDENTITY', `banking.accounts.${actorId}`, 'unknown account holder');
      const account = object(raw, `banking.accounts.${actorId}`, keys('deposits loanPrincipal loanInterest interestDue closed'));
      for (const field of ['deposits', 'loanPrincipal', 'loanInterest', 'interestDue']) claim(`banking.accounts.${actorId}.${field}`, 'bank-claim', account[field]);
    }
    claim('banking.legacyInvestmentPrincipal', 'legacy-investment-claim', bank.legacyInvestmentPrincipal);
    if (!Object.hasOwn(bankAccounts, 'player')) fail('IDENTITY', 'banking.accounts.player', 'missing player account');
    aliases.push({ id: 'state.bankBalance', targetId: 'banking.accounts.player.deposits', amount: amount(s.bankBalance, 'state.bankBalance'), reason: 'legacy deposit mirror; not vault cash' });
    aliases.push({ id: 'state.loan', targetId: 'banking.accounts.player.loanPrincipal+loanInterest', amount: amount(s.loan, 'state.loan'), reason: 'legacy debt mirror; not physical money' });
    const inventory = object(player.inventory, 'player.inventory');
    if (inventory.investment !== undefined) aliases.push({ id: 'player.inventory.investment', targetId: 'banking.legacyInvestmentPrincipal', amount: amount(inventory.investment, 'player.inventory.investment'), reason: 'legacy investment claim mirror' });
  } else { add('state.bankBalance', 'legacy-bank-custody', s.bankBalance); add('runtime.investment', 'legacy-investment-custody', r.investment); }
  for (const shop of shops) {
    const owner = binding(shop), value = amount(shop.cash ?? 0, `shop.${shop.id}.cash`);
    if (owner) aliases.push({ id: `shop.${shop.id}.cash`, targetId: `company.${owner.id}.capital`, amount: value, reason: 'active company owns the shop funds' });
    else add(`shop.${shop.id}.cash`, 'independent-shop', value);
  }
  for (const company of companies) add(`company.${company.id}.capital`, 'company-capital', company.capital);
  if (e) for (const organization of entities(e.organizations, 'extension.organizations', keys('id name kind members reputation funds'))) add(`organization.${organization.id}.funds`, 'organization-fund', organization.funds);
  const escrowRows = (name: string, field: string) => {
    const body = module(s, name); if (!body) return;
    for (const [index, raw] of array(body[field], `${name}.${field}`).entries()) {
      const row = financialRow(raw, `${name}.${field}[${index}]`, 'escrow funded refundedGross depositInitial depositEscrow depositToLessor depositRefunded advanceInitial advanceRefunded');
      add(`${name}.${field}.${id(row.id, `${name}.${field}[${index}].id`)}.escrow`, `${name}-escrow`, row.escrow);
    }
  };
  const single = (name: string, field: string) => {
    const body = module(s, name); if (!body || body[field] === null) return;
    const row = financialRow(body[field], `${name}.${field}`, 'escrow funded refundedGross');
    add(`${name}.${field}.${id(row.id, `${name}.${field}.id`)}.escrow`, `${name}-escrow`, row.escrow);
  };
  single('playerLabor', 'job'); single('education', 'course'); single('hydroMaintenance', 'job');
  for (const [name, field] of [['roadworks', 'jobs'], ['familyEducation', 'active'], ['residentEducation', 'active'], ['power', 'repairs'], ['clinical', 'orders'], ['hygiene', 'jobs'], ['family', 'pregnancies']]) escrowRows(name, field);
  const hygiene = module(s, 'hygiene');
  if (hygiene?.transfers !== undefined) {
    const transfers = object(hygiene.transfers, 'hygiene.transfers', keys('version rulesetId nextId tasks'));
    for (const [index, raw] of array(transfers.tasks, 'hygiene.transfers.tasks').entries()) {
      const task = financialRow(raw, `hygiene.transfers.tasks[${index}]`, 'escrow funded');
      add(`hygiene.transfers.tasks.${id(task.id, 'transfer.id')}.escrow`, 'waste-transfer-escrow', task.escrow);
    }
  }
  const family = module(s, 'family');
  if (family) for (const [index, raw] of array(family.households, 'family.households').entries()) {
    const household = financialRow(raw, `family.households[${index}]`, 'balance');
    add(`family.households.${id(household.id, 'household.id')}.balance`, 'household-fund', household.balance);
  }
  const lifecycle = module(s, 'shopLifecycle');
  if (lifecycle) {
    for (const [index, raw] of array(lifecycle.leases, 'shopLifecycle.leases').entries()) {
      const lease = financialRow(raw, `shopLifecycle.leases[${index}]`, 'depositInitial depositEscrow depositToLessor depositRefunded');
      add(`shopLifecycle.leases.${id(lease.id, 'lease.id')}.depositEscrow`, 'lease-deposit', lease.depositEscrow);
    }
    for (const [shopId, raw] of Object.entries(object(lifecycle.titles, 'shopLifecycle.titles'))) {
      const title = financialRow(raw, `shopLifecycle.titles.${shopId}`, '');
      if (title.corporation !== undefined) {
        const corporation = financialRow(title.corporation, `shopLifecycle.titles.${shopId}.corporation`, 'openingCash capitalFunding ownerCashReserved ownerCashEscrow ownerCashReturned');
        add(`shopLifecycle.titles.${shopId}.corporation.ownerCashEscrow`, 'owner-cash-escrow', corporation.ownerCashEscrow);
      }
    }
  }
  // Distributed estates, payment histories, budgets, shares, profits and bank
  // receivables are records/claims, never an additional physical money account.
  return { total: sumFinite(accounts, 'cash.total'), accounts, aliases, claims };
}

const FOOD_KINDS = new Set(['farm', 'dock', 'market']);
/** Every physical food container, with the same freight lots counted once. */
export function foodCustodySnapshot(host: object, world: WorldDefinition): FoodCustodySnapshot {
  const { state: s, runtime: r, extension: e, citizens, shops, companies, player, buildings, binding } = context(host, world);
  const holdings: FoodHolding[] = [], aliases: CustodyAlias[] = [], freightLots: FreightCustody[] = [];
  const add = (holdingId: string, kind: string, value: unknown, sourceId?: string) => {
    holdings.push({ id: holdingId, kind, amount: amount(value, holdingId), ...(sourceId === undefined ? {} : { sourceId }) });
  };
  const shopMap = new Map(shops.map(shop => [String(shop.id), shop]));
  const foodShop = (shop: Data) => FOOD_KINDS.has(String(buildings.get(String(shop.buildingId))!.kind));
  const source = (sourceId: unknown, path: string): Data => {
    const shop = shopMap.get(id(sourceId, path));
    if (!shop || !foodShop(shop)) fail('SOURCE', path, 'unknown or non-food shop');
    return shop;
  };
  for (const shop of shops) {
    amount(shop.inventory, `shop.${shop.id}.inventory`);
    if (foodShop(shop)) add(`shop.${shop.id}.inventory`, 'food-shop', shop.inventory, String(shop.id));
  }
  for (const citizen of citizens) add(`citizen.${citizen.id}.food`, 'resident-food', citizen.food ?? 0);
  const inventory = object(player.inventory, 'player.inventory');
  for (const [name, value] of Object.entries(inventory)) {
    const quantity = amount(value, `player.inventory.${name}`);
    // transferBusinessOwnership writes these exact title counters, including
    // zero when an NPC buys a shop. They are ownership metadata, not food.
    if (name === 'businesses') {
      const owned = array(r.playerBusinesses ?? [], 'runtime.playerBusinesses');
      if (!Number.isInteger(quantity) || quantity !== owned.length || new Set(owned).size !== owned.length)
        fail('OWNERSHIP_METADATA', `player.inventory.${name}`, 'count disagrees with actual runtime business IDs');
      for (const ownedId of owned) {
        const actualId = id(ownedId, 'runtime.playerBusinesses');
        if (!shopMap.has(actualId) || shopMap.get(actualId)!.ownerId !== 'player')
          fail('OWNERSHIP_METADATA', `runtime.playerBusinesses.${actualId}`, 'unknown or non-player business');
      }
      continue;
    }
    if (name.startsWith('business:')) {
      const buildingId = name.slice('business:'.length), site = buildings.get(buildingId), shop = shops.find(row => row.buildingId === buildingId);
      if (!site || !shop || quantity !== 0 && quantity !== 1 || quantity !== Number(shop.ownerId === 'player'))
        fail('OWNERSHIP_METADATA', `player.inventory.${name}`, 'unknown title or marker disagrees with actual shop owner');
      continue;
    }
    if (quantity > 0 && (['grain', 'vegetable', 'fish'].includes(name) || name.startsWith('ingredient:') || name.startsWith('dish:'))) fail('UNSUPPORTED_FOOD_TRANSFORMATION', `player.inventory.${name}`, 'ingredient/dish conversion is outside this raw-food ledger');
    if (!['block', 'food', 'investment', 'grain', 'vegetable', 'fish'].includes(name) && !['ingredient:', 'dish:', 'dishQuality:'].some(prefix => name.startsWith(prefix))) fail('UNKNOWN_FOOD', `player.inventory.${name}`, 'unclassified inventory commodity');
  }
  if (e?.cooking !== null && e?.cooking !== undefined) fail('UNSUPPORTED_FOOD_TRANSFORMATION', 'extension.cooking', 'active cooking is outside this raw-food ledger');
  add('player.inventory.food', 'player-food', inventory.food ?? 0);
  const vehicles = entities(s.vehicles, 'state.vehicles', VEHICLE_KEYS), cargoSources = object(r.cargoSources ?? {}, 'runtime.cargoSources');
  const vehicleIds = new Set(vehicles.map(vehicle => String(vehicle.id)));
  for (const vehicleId of Object.keys(cargoSources)) if (!vehicleIds.has(vehicleId)) fail('IDENTITY', `runtime.cargoSources.${vehicleId}`, 'unknown vehicle');
  for (const vehicle of vehicles) {
    const cargo = amount(vehicle.cargo, `vehicle.${vehicle.id}.cargo`);
    if (cargo > 0) { const origin = source(cargoSources[String(vehicle.id)], `runtime.cargoSources.${vehicle.id}`); add(`vehicle.${vehicle.id}.cargo`, 'food-in-transit', cargo, String(origin.id)); }
  }
  const districts = new Set(array(world.districts, 'world.districts').map((raw, index) => id(object(raw, `world.districts[${index}]`).id, 'district.id')));
  const freight = object(r.freight, 'runtime.freight'), lotsByDistrict = object(r.freightLots ?? {}, 'runtime.freightLots');
  for (const districtId of new Set([...Object.keys(freight), ...Object.keys(lotsByDistrict)])) {
    if (!districts.has(districtId)) fail('SOURCE', `runtime.freight.${districtId}`, 'unknown district');
    const quantity = amount(freight[districtId] ?? 0, `runtime.freight.${districtId}`), lots: FreightCustody['lots'] = [];
    for (const [index, raw] of array(lotsByDistrict[districtId] ?? [], `runtime.freightLots.${districtId}`).entries()) {
      const lot = object(raw, `runtime.freightLots.${districtId}[${index}]`, keys('shopId quantity'));
      const lotQuantity = amount(lot.quantity, 'freight.lot.quantity');
      // Null is the save's explicit inherited legacy food provenance.
      if (lot.shopId !== null) source(lot.shopId, 'freight.lot.shopId');
      lots.push({ shopId: lot.shopId === null ? null : String(lot.shopId), quantity: lotQuantity });
    }
    const lotTotal = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    if (!Number.isFinite(lotTotal) || Math.abs(lotTotal - quantity) > 1e-7) fail('FREIGHT_ALIAS', `runtime.freightLots.${districtId}`, 'lot quantity differs from the physical district pool');
    add(`runtime.freight.${districtId}`, 'district-food', quantity);
    freightLots.push({ districtId, quantity, lots });
    aliases.push({ id: `runtime.freightLots.${districtId}`, targetId: `runtime.freight.${districtId}`, amount: lotTotal, reason: 'provenance decomposition of the same pool' });
  }
  for (const company of companies) {
    const companyInventory = amount(company.inventory, `company.${company.id}.inventory`);
    if (!FOOD_KINDS.has(String(buildings.get(String(company.buildingId))!.kind))) continue;
    const bound = shops.find(shop => binding(shop) === company);
    if (bound) aliases.push({ id: `company.${company.id}.inventory`, targetId: `shop.${bound.id}.inventory`, amount: companyInventory, reason: 'active company inventory mirror' });
    else add(`company.${company.id}.inventory`, 'independent-company-food', companyInventory, String(company.id));
  }
  if (s.trade !== undefined) {
    const trade = object(s.trade, 'state.trade', keys('version nextLotId lots ownedLots legacyIndustrialLotIds activity stats'));
    const lotMap = object(trade.lots, 'trade.lots'), ownedMap = object(trade.ownedLots ?? {}, 'trade.ownedLots');
    const legacyIds = new Set(array(trade.legacyIndustrialLotIds ?? [], 'trade.legacyIndustrialLotIds').map((value, index) => id(value, `legacyIndustrialLotIds[${index}]`)));
    for (const shopId of new Set([...Object.keys(lotMap), ...Object.keys(ownedMap)])) {
      const retailer = source(shopId, `trade.${shopId}`); let ownership = 0;
      for (const [index, raw] of array(lotMap[shopId] ?? [], `trade.lots.${shopId}`).entries()) {
        const lot = object(raw, `trade.lots.${shopId}[${index}]`, keys('id supplierId quantity unitPrice createdAt'));
        const lotId = id(lot.id, 'trade.lot.id'), supplier = shopMap.get(id(lot.supplierId, 'trade.lot.supplierId'));
        if (!supplier || !['farm', 'dock'].includes(String(buildings.get(String(supplier.buildingId))!.kind))) {
          if (supplier && buildings.get(String(supplier.buildingId))!.kind === 'workshop' && (trade.version === 1 || legacyIds.has(lotId))) fail('UNSUPPORTED_FOOD_TRANSFORMATION', `trade.lot.${lotId}`, 'legacy industrial consignment cannot be classified as food');
          fail('SOURCE', `trade.lot.${lotId}`, 'unknown or non-food supplier');
        }
        ownership += amount(lot.quantity, 'trade.lot.quantity'); amount(lot.unitPrice, 'trade.lot.unitPrice'); amount(lot.createdAt, 'trade.lot.createdAt');
      }
      for (const [index, raw] of array(ownedMap[shopId] ?? [], `trade.ownedLots.${shopId}`).entries()) {
        const lot = object(raw, `trade.ownedLots.${shopId}[${index}]`, keys('quantity unitPrice createdAt'));
        ownership += amount(lot.quantity, 'trade.ownedLot.quantity'); amount(lot.unitPrice, 'trade.ownedLot.unitPrice'); amount(lot.createdAt, 'trade.ownedLot.createdAt');
      }
      if (!Number.isFinite(ownership) || ownership > amount(retailer.inventory, `shop.${shopId}.inventory`) + 1e-7) fail('TRADE_ALIAS', `trade.${shopId}`, 'ownership exceeds physical inventory');
      aliases.push({ id: `trade.${shopId}.lots`, targetId: `shop.${shopId}.inventory`, amount: ownership, reason: 'ownership records already included in retailer stock' });
    }
  }
  return { total: sumFinite(holdings, 'food.total'), holdings, aliases, freightLots };
}

/** NPC liabilities keep their saved employer, even after workId changes. */
export function debtSnapshot(rawRuntime: unknown): WageDebtSnapshot {
  const runtime = object(rawRuntime, 'runtime', RUNTIME_KEYS), rows: DebtRow[] = [], groups = new Map<string, EmployerDebt>();
  const totals = { arrears: 0, accruals: 0, wages: 0 };
  for (const [queue, field, allowed] of [
    ['arrears', 'wageArrears', 'citizenId shopId amount'],
    ['accruals', 'wageAccruals', 'citizenId shopId workId districtId minutes ratePerMinute amount'],
    ['wages', 'wages', 'citizenId amount districtId shopId expenseAccrued'],
  ] as const) {
    for (const [index, raw] of array(runtime[field] ?? [], `runtime.${field}`).entries()) {
      const row = object(raw, `runtime.${field}[${index}]`, keys(allowed)), citizenId = id(row.citizenId, 'debt.citizenId');
      if (citizenId === 'player') fail('IDENTITY', 'debt.citizenId', 'NPC queues cannot include player labor');
      const shopId = row.shopId === null || row.shopId === undefined ? null : id(row.shopId, 'debt.shopId');
      const value = amount(row.amount, 'debt.amount'), metadata: Data = {};
      for (const [name, item] of Object.entries(row)) {
        if (typeof item === 'number' && !Number.isFinite(item)) fail('NUMBER', `debt.${name}`, 'non-finite row metadata');
        if (item !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof item)) fail('SHAPE', `debt.${name}`, 'metadata must be primitive');
        metadata[name] = item;
      }
      if (queue === 'accruals') { amount(row.minutes, 'debt.minutes'); amount(row.ratePerMinute, 'debt.ratePerMinute'); id(row.workId, 'debt.workId'); id(row.districtId, 'debt.districtId'); }
      if (queue === 'wages') {
        id(row.districtId, 'debt.districtId');
        if (row.expenseAccrued !== undefined && typeof row.expenseAccrued !== 'boolean') fail('SHAPE', 'debt.expenseAccrued', 'expected boolean');
      }
      rows.push({ queue, citizenId, shopId, amount: value, metadata }); totals[queue] += value;
      const groupKey = JSON.stringify([citizenId, shopId]);
      const group = groups.get(groupKey) ?? { citizenId, shopId, arrears: 0, accruals: 0, wages: 0, total: 0 };
      group[queue] += value; group.total += value; groups.set(groupKey, group);
    }
  }
  const total = amount(totals.arrears + totals.accruals + totals.wages, 'debt.total');
  for (const group of groups.values()) for (const field of ['arrears', 'accruals', 'wages', 'total'] as const) amount(group[field], `debt.group.${field}`);
  return { total, ...totals, byEmployer: [...groups.values()], rows };
}
