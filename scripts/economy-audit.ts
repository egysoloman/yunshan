import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';
import { familyEducationHeldCash } from '../src/simulation/family-education';
import { commodityObserver, foodSnapshot } from './economy-observations';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createWorld } from '../src/world';
import { createArchivedProductCity, createCityLifeProductCity, createProductWorld, PRODUCT_CITY_LAYOUT } from '../src/product-city';
import { Simulation, isCanonicalNpcWage } from '../src/simulation';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { bankingBalanceSheet } from '../src/simulation/banking';
import type { CityExtensionState, Citizen, LedgerEntry, Vec3 } from '../src/types';

// One deterministic generated city; optional longer runs retain the same guards.
// This measures finite resources and gameplay, not rendering performance.
const argumentsByName = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--days', '--tax-rate', '--police-budget', '--seed', '--out', '--ruleset', '--product-recipe'].includes(name) && value !== undefined && !argumentsByName.has(name), `invalid audit argument ${name}`);
  argumentsByName.set(name, value);
}
const numeric = (name: string, fallback: number, min: number, max: number) => { const value = argumentsByName.has(name) ? Number(argumentsByName.get(name)) : fallback; assert.ok(Number.isFinite(value) && value >= min && value <= max, `invalid ${name}`); return value; };
const speed = 8;
const requestedDays = numeric('--days', 10_000 * .25 * speed / 1440, 1, 120);
const ticks = Math.ceil(requestedDays * 1440 / (.25 * speed));
const seed = numeric('--seed', 20261001, 1, 4294967295); assert.ok(Number.isInteger(seed));
const initialPolicy = { taxRate: numeric('--tax-rate', .08, 0, .3), policeBudget: numeric('--police-budget', .3, 0, 1) };
const artifact = argumentsByName.get('--out') ?? 'artifacts/economy-audit.json';
assert.ok(/^artifacts\/[a-zA-Z0-9-]+\.json$/.test(artifact), 'audit output must be a named JSON artifact');
// Freeze every current source file, including dynamically installed modules and
// their geometry/persistence dependencies. Rescan at the end to detect additions
// or deletions, rather than hashing only the initial manually maintained list.
async function sourceFiles(directory = 'src'): Promise<string[]> {
  const entries = (await readdir(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files: string[] = [];
  for (const entry of entries) {
    assert.ok(entry.isFile() || entry.isDirectory(), `audit source must be a regular file or directory: ${directory}/${entry.name}`);
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else files.push(file);
  }
  return files;
}
async function auditSourceHashes(): Promise<Record<string, string>> {
  const files = [...await sourceFiles(), 'scripts/economy-audit.ts', 'scripts/economy-observations.ts'].sort();
  return Object.fromEntries(await Promise.all(files.map(async file =>
    [file, createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex')])));
}
const sourceHash = await auditSourceHashes();
const requestedRuleset = argumentsByName.get('--ruleset') ?? 'civic-local-v1';
assert.ok(requestedRuleset === 'legacy' || requestedRuleset === 'civic-local-v1', 'audit ruleset must be explicitly recognized');
const productRecipe = argumentsByName.get('--product-recipe') ?? 'city-life-v1';
assert.ok(['city-life-v1', 'archive-v4'].includes(productRecipe), 'audit product recipe must be explicitly recognized');
assert.ok(requestedRuleset !== 'legacy' || !argumentsByName.has('--product-recipe'), 'legacy constructor cannot select a product recipe');
const world = requestedRuleset === 'civic-local-v1' ? createProductWorld(seed) : createWorld(seed);
const sim = requestedRuleset === 'civic-local-v1'
  ? productRecipe === 'city-life-v1' ? await createCityLifeProductCity(world) : createArchivedProductCity(world)
  : new Simulation(world);
assert.equal(sim.effectiveRuleset, requestedRuleset, 'requested audit ruleset must match the actual city');
const initialProductEnvelope = JSON.parse(sim.exportSave());
const actualWorldFingerprint = initialProductEnvelope.worldFingerprint;
const rulesetContext = () => ({
  requestedRuleset, requestSource: argumentsByName.has('--ruleset') ? 'explicit-cli' : 'product-default',
  effectiveRuleset: sim.effectiveRuleset, saveEnvelopeVersion: sim.saveVersion, motionVersion: sim.motionVersion,
  historyPolicyId: initialProductEnvelope.historyPolicyId ?? null,
  productRecipe: requestedRuleset === 'civic-local-v1' ? productRecipe : 'legacy-constructor',
  referenceCollisionPolicyId: sim.referenceCollisionPolicyId,
  mealRoutePolicyId: sim.mealRoutePolicyId,
  serviceMaterialSchedulingPolicyId: sim.state.serviceMaterialScheduling?.policyId ?? null,
  civicHistory: sim.state.civicHistory ? { version: sim.state.civicHistory.version, pages: sim.state.civicHistory.pages.length,
    bytes: Buffer.byteLength(JSON.stringify(sim.state.civicHistory), 'utf8'), totals: { ...sim.state.civicHistory.totals } } : null,
  enablement: sim.rulesetEnablement, requestedNewCityLayout: requestedRuleset === 'civic-local-v1' ? PRODUCT_CITY_LAYOUT : 'legacy-createWorld-default',
  actualLayoutVersion: world.layoutVersion ?? 'unversioned', actualWorldFingerprint,
  cityStateSource: 'new-city',
});
if (requestedRuleset === 'civic-local-v1') {
  assert.equal(sim.saveVersion, 4, 'new product rules need the explicit complete-history v4 envelope');
  assert.equal(initialProductEnvelope.historyPolicyId, 'civic-history-pages-v1', 'new product must declare its complete-history policy');
  assert.equal(sim.state.civicStaffing?.version, 2, 'new product needs the hot/cold civic body contract');
  assert.equal(sim.state.civicHistory?.version, 1, 'new product needs its complete bounded history');
  assert.equal(sim.state.civicHistory?.pages.length, 0, 'new city must not borrow previous civic history');
  assert.equal(sim.motionVersion, 2, 'new product cities use native physical motion');
  assert.equal(sim.rulesetEnablement?.origin, 'new-city', 'this audit did not restore or upgrade an old city');
  assert.equal(world.layoutVersion, PRODUCT_CITY_LAYOUT, 'new product audit must use its declared layout');
  if (productRecipe === 'city-life-v1') {
    assert.equal(sim.referenceCollisionPolicyId, 'continuous-upright-v1', 'audit must run the actual city-life collision policy');
    assert.equal(sim.mealRoutePolicyId, 'nearby-food-v1', 'audit must run the actual city-life meal policy');
    assert.equal(sim.state.serviceMaterialScheduling?.policyId, 'authorized-service-materials-v1', 'audit must run the actual city-life service policy');
  } else {
    assert.equal(sim.referenceCollisionPolicyId, 'legacy', 'archived product audit must retain its original collision contract');
    assert.equal(sim.mealRoutePolicyId, 'legacy', 'archived product audit must retain its original meal contract');
    assert.equal(sim.state.serviceMaterialScheduling, undefined, 'archived product audit must not acquire service scheduling');
  }
}
sim.state.taxRate = initialPolicy.taxRate; sim.state.policeBudget = initialPolicy.policeBudget;
assert.equal(sim.command({ type: 'speed', value: speed }).ok, true);
const extension = () => sim.state.extension! as CityExtensionState & {
  runtime: { nextCompanyAt: number; researchJobs: Record<string, {
    actorId?: string; budget: number; startedAt: number; finishAt: number;
  } | undefined> };
};
// Read-only observation of the same persisted accounting queues used by finance.
// No world, citizen, RNG or bookkeeping values are injected by this audit.
interface Bookkeeping { taxes: number; operatingCost: number; wages: { citizenId: string; amount: number; shopId?: string | null }[];
  wageArrears?: { citizenId: string; shopId: string | null; amount: number }[]; wageAccruals?: { citizenId: string; shopId: string | null; amount: number }[] }
const core = () => Reflect.get(sim, 'runtime') as Bookkeeping;
const buildings = new Map(world.buildings.map(building => [building.id, building]));
const commodities = commodityObserver(buildings, new Map(sim.state.shops.map(shop => [shop.id, shop.buildingId])), isCanonicalNpcWage);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const totals = { sales: 0, saleCount: 0, saleTax: 0, fares: 0, payrollPublicRequested: 0,
  payrollPublicPaid: 0, payrollPrivateRequested: 0, payrollPrivate: 0, wageTax: 0, wholesale: 0, wholesaleTax: 0,
  businessExpenses: 0, storedMeals: 0, production: 0, productionMinutes: 0, operationsRequested: 0, operations: 0, publicSupplies: 0, procurementTax: 0, civicProcurement: 0, security: 0, financeDelta: 0, roadworkPayroll: 0, roadworkMinutes: 0 };
const ledger: Record<string, { count: number; amount: number; eventObserved: number }> = {};
const seenLedger = new WeakSet<LedgerEntry>();
const deaths: Record<string, unknown>[] = [];
const deadIds = new Set<string>();
const beforeLife = new Map<string, Record<string, unknown>>();
const starts: Record<string, unknown>[] = [];
const seenJobs = new Set<string>();
const snapshots: ReturnType<typeof snapshot>[] = [];
const initialTreasury = sim.state.treasury;
const initialMinute = extension().lastUpdate;
let beforeFinance = initialTreasury;
let afterFinance = initialTreasury;
let beforeResearch: { money: Map<string, number>; wages: Bookkeeping['wages'] } | undefined;
let exactResearchDebits = 0;
let researchFunding = 0;
let failure: string | undefined;
let reconciliationResidual = 0;
let moneyConservationResidual = 0;
const initialMoneySupply = moneySupply();

sim.onEvent('sale', event => {
  commodities.sale(event);
  totals.sales += event.amount ?? 0;
  totals.saleCount++;
  totals.saleTax += (event.amount ?? 0) * sim.state.taxRate;
});
sim.onEvent('transit-fare', event => { totals.fares += event.amount ?? 0; });
sim.onEvent('wholesale', event => { totals.wholesale += event.amount ?? 0; totals.wholesaleTax += (event.amount ?? 0) * sim.state.taxRate; });
sim.onEvent('business-expense', event => { totals.businessExpenses += event.amount ?? 0; });
sim.onEvent('stored-meal', event => { totals.storedMeals += event.amount ?? 0; commodities.storedMeal(event); });
sim.onEvent('food-consumed', event => { commodities.foodConsumed(event); });
sim.onEvent('production', event => { totals.production += event.amount ?? 0; totals.productionMinutes += event.minutes ?? 0; commodities.production(event); assert.ok((event.minutes ?? 0) > 0 && (event.amount ?? 0) > 0, 'production evidence requires positive actual labor and output'); });
sim.onEvent('wage-earned', event => { commodities.wageEarned(event); if (event.shopId) totals.payrollPrivateRequested += event.amount ?? 0; else totals.payrollPublicRequested += event.amount ?? 0; });
sim.onEvent('wage-paid', event => {
  const paid = event.amount ?? 0;
  if (event.shopId) totals.payrollPrivate += paid;
  else totals.payrollPublicPaid += paid;
  totals.wageTax += paid * sim.state.taxRate;
  assert.ok(paid <= (event.requestedAmount ?? 0) + 1e-7, 'paid wage cannot exceed its actual request');
});
// Road wages are paid from the job's already-funded escrow. Its public debit
// and refund have their own ledger entries; counting gross again as treasury
// payroll would double-charge it. Only the actual remitted tax is revenue.
sim.onEvent('roadwork-wage-paid', event => {
  const gross = event.amount ?? 0, minutes = event.minutes ?? 0;
  assert.ok(gross >= 0 && minutes > 0 && Math.abs(gross - minutes * (event.ratePerMinute ?? 0)) < 1e-7, 'road wage must match actual credited minutes and its frozen rate');
  totals.roadworkPayroll += gross; totals.roadworkMinutes += minutes;
  totals.wageTax += gross * sim.state.taxRate;
});
sim.onEvent('municipal-operation-accrual', event => { totals.operationsRequested += event.amount ?? 0; });
sim.onEvent('public-procurement', event => { totals.operations += event.amount ?? 0; totals.publicSupplies += event.quantity ?? 0; totals.procurementTax += (event.amount ?? 0) * sim.state.taxRate; assert.ok((event.unitPrice ?? 0) >= 4 && Math.abs((event.amount ?? 0) - (event.quantity ?? 0) * (event.unitPrice ?? 0)) < 1e-7); });
sim.onEvent('civic-procurement', event => { totals.civicProcurement += event.amount ?? 0; totals.publicSupplies += event.quantity ?? 0; totals.procurementTax += (event.amount ?? 0) * sim.state.taxRate; });
for (const eventType of ['security-procurement', 'emergency-procurement', 'medical-procurement']) sim.onEvent(eventType, event => { totals.publicSupplies += event.quantity ?? 0; totals.procurementTax += (event.amount ?? 0) * sim.state.taxRate; assert.ok((event.unitPrice ?? 0) >= 4 && Math.abs((event.amount ?? 0) - (event.quantity ?? 0) * (event.unitPrice ?? 0)) < 1e-7); });
sim.onPhase('traffic', () => {
  for (const citizen of sim.state.citizens) if (extension().actorProfiles[citizen.id].alive) {
    beforeLife.set(citizen.id, { health: extension().actorProfiles[citizen.id].health,
      hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue, money: citizen.money,
      role: citizen.role, state: citizen.state, destinationId: citizen.destinationId, position: { ...citizen.position } });
  }
});
sim.onPhase('people', () => {
  for (const citizen of sim.state.citizens) {
    const profile = extension().actorProfiles[citizen.id];
    if (profile.alive || deadIds.has(citizen.id)) continue;
    deadIds.add(citizen.id);
    const food = sim.state.shops.filter(shop => shop.open && shop.inventory >= 1 && citizen.money >= shop.price);
    deaths.push({ id: citizen.id, tick: sim.state.tick, day: sim.state.day, age: profile.age,
      health: profile.health, hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue,
      money: citizen.money, before: beforeLife.get(citizen.id),
      homeWorkDistance: distance(buildings.get(citizen.homeId)!.door, buildings.get(citizen.workId)!.door),
      clinicDistance: Math.min(...world.buildings.filter(b => b.kind === 'clinic').map(b => distance(citizen.position, b.door))),
      foodDistance: food.length ? Math.min(...food.map(shop => distance(citizen.position, buildings.get(shop.buildingId)!.door))) : null });
  }
  beforeFinance = sim.state.treasury;
});
sim.onPhase('commerce', () => {
  if (extension().lastUpdate + 1e-7 < extension().runtime.nextCompanyAt) return;
  beforeResearch = { money: new Map(sim.state.citizens.map(c => [c.id, c.money])), wages: structuredClone(core().wages) };
});
sim.onPhase('finance', () => {
  afterFinance = sim.state.treasury;
  totals.financeDelta += afterFinance - beforeFinance;
  const e = extension();
  for (const [sector, job] of Object.entries(e.runtime.researchJobs)) {
    if (!job || !job.actorId || job.actorId === 'player') continue;
    const key = `${sector}:${job.actorId}:${job.startedAt}`;
    if (seenJobs.has(key)) continue;
    seenJobs.add(key);
    assert.ok(beforeResearch);
    const citizen = sim.state.citizens.find(c => c.id === job.actorId)!;
    const workplace = buildings.get(citizen.workId)!;
    const payment = e.publicLedger.find(row => row.tick === sim.state.tick && row.actorId === citizen.id && row.purpose.endsWith('居民科研投入'));
    assert.equal(job.budget, 200);
    assert.equal(job.finishAt - job.startedAt, 120);
    assert.ok(payment);
    assert.equal(payment.amount, 200);
    assert.ok(citizen.money >= 100 - 1e-7);
    assert.ok(citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 40);
    assert.ok((citizen.education ?? 0) >= 3 && e.actorProfiles[citizen.id].skill >= 35);
    assert.ok(['scientist', '科研员', '科学家'].includes(citizen.role));
    assert.ok(sim.isNearBuilding(workplace, citizen.position));
    const grossWage = beforeResearch.wages.filter(w => w.citizenId === citizen.id).reduce((sum, w) => sum + w.amount, 0);
    const debit = beforeResearch.money.get(citizen.id)! - citizen.money;
    // A wage or company dividend can legitimately offset the same tick's debit.
    const canVerifyExact = grossWage === 0 && !e.companies.some(c => (c.shareholders[citizen.id] ?? 0) > 0);
    if (canVerifyExact) { assert.ok(Math.abs(debit - 200) < 1e-6); exactResearchDebits++; }
    researchFunding += 200;
    starts.push({ tick: sim.state.tick, day: sim.state.day, hour: sim.state.hour, id: citizen.id,
      role: citizen.role, sector, moneyBefore: beforeResearch.money.get(citizen.id), moneyAfter: citizen.money,
      grossWage, debit, exactDebitVerified: canVerifyExact, ledgerCredit: payment.amount,
      hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue, education: citizen.education,
      skill: e.actorProfiles[citizen.id].skill, workKind: workplace.kind, workFacility: workplace.facility });
  }
});
sim.onPhase('security', () => { totals.security += afterFinance - sim.state.treasury; });
sim.onPhase('feedback', () => {
  for (const row of extension().publicLedger) {
    if (seenLedger.has(row)) continue;
    seenLedger.add(row);
    if (row.account !== 'public') continue;
    const aggregate = ledger[row.purpose] ??= { count: 0, amount: 0, eventObserved: 0 };
    aggregate.count++; aggregate.amount += row.amount;
    if (row.sourceEvent === 'transit-fare' || row.sourceEvent === 'public-payroll-escrow') aggregate.eventObserved += row.amount;
  }
});

function snapshot() {
  const s = sim.state, e = extension(), actors = s.citizens;
  const alive = actors.filter(c => e.actorProfiles[c.id].alive);
  const mean = (list: Citizen[], value: (citizen: Citizen) => number) => list.length ? list.reduce((n, c) => n + value(c), 0) / list.length : 0;
  return { tick: s.tick, day: s.day, hour: s.hour, treasury: s.treasury, gdp: s.gdp,
    npcMoney: actors.reduce((n, c) => n + c.money, 0), moneySupply: moneySupply(), wages: { ...totals },
    ruleset: rulesetContext(), commodityObservations: commodities.snapshot(), food: foodSnapshot(s, buildings),
    policeSupplies: sim.policeSupplyCoverage(),
    civicRequests: s.culture ? { residentPetitions: s.culture.petitions.filter(p => p.residentOrigin !== undefined).length, openPetitions: s.culture.petitions.filter(p => p.status === 'open').length, orders: s.culture.orders.map(o => ({ id: o.id, topic: o.topic, state: o.state, authorizedCap: o.authorizedCap, spent: o.spent, receivedUnits: o.receivedUnits, consumedUnits: o.consumedUnits, served: o.servedIds.length })) } : null,
    formalLearning: s.family?.formalLearning ? Object.values(s.family.formalLearning).map(record => ({ earnedMinutes: record.earnedMinutes, receipts: record.receipts.length, familyReceipts: record.tuitionPages?.reduce((sum, page) => sum + page.length, 0) ?? 0 })) : [],
    familyEducation: s.familyEducation ? { heldCash: familyEducationHeldCash(s), active: s.familyEducation.active.map(course => ({ id: course.id, actorId: course.actorId, payerId: course.payerId, status: course.status, workedMinutes: course.workedMinutes, escrow: course.escrow })), retainedPages: s.familyEducation.pages.length, totals: { ...s.familyEducation.totals } } : null,
    playerLabor: s.playerLabor ? { escrow: s.playerLabor.job?.escrow ?? 0, stats: { ...s.playerLabor.stats } } : null,
    roadworks: s.roadworks ? { escrow: s.roadworks.jobs.reduce((sum, job) => sum + job.escrow, 0), jobs: s.roadworks.jobs.map(job => ({ id: job.id, payerId: job.payerId, status: job.status, workedMinutes: job.workedMinutes, funded: job.funded, purchasePaid: job.purchasePaid, paidGross: job.paidGross, paidTax: job.paidTax, refunded: job.refunded, escrow: job.escrow })) } : null,
    power: s.power ? structuredClone(s.power) : null,
    hygiene: s.hygiene ? { transfers: s.hygiene.transfers ? { escrow: s.hygiene.transfers.tasks.reduce((sum, task) => sum + task.escrow, 0), tasks: structuredClone(s.hygiene.transfers.tasks), terminalDisposalImplemented: false } : null, escrow: s.hygiene.jobs.reduce((sum, job) => sum + job.escrow, 0), stats: { ...s.hygiene.stats }, retainedWasteUnits: s.hygiene.batches.reduce((sum, batch) => sum + batch.generatedUnits + batch.cleaningResidualUnits, 0), stock: structuredClone(s.hygiene.stock), publicDemands: s.hygiene.publicDemands?.map(d => ({ id: d.id, state: d.state, authorizedCap: d.authorizedCap, spent: d.spent, jobId: d.jobId })) ?? [] } : null,
    education: s.education ? { course: s.education.course ? { ...s.education.course, staffMinutes: { ...s.education.course.staffMinutes } } : null, stats: { ...s.education.stats }, stock: structuredClone(s.education.stock) } : null,
    policy: { taxRate: s.taxRate, policeBudget: s.policeBudget }, publicBudget: sim.publicBudgetSnapshot(), publicService: sim.publicServiceCoverage(), privateLabor: sim.privateLaborCoverage(),
    banking: s.banking ? { balanceSheet: bankingBalanceSheet(s.banking), cash: s.banking.cash, deposits: Object.values(s.banking.accounts).reduce((sum, account) => sum + account.deposits, 0), loans: Object.values(s.banking.accounts).reduce((sum, account) => sum + account.loanPrincipal + account.loanInterest, 0), legacyInvestmentCash: s.banking.legacyInvestmentCash } : null,
    npcBankDeposits: actors.reduce((sum, citizen) => sum + (s.banking?.accounts[citizen.id]?.deposits ?? 0), 0),
    wageArrears: { public: (core().wageArrears ?? []).filter(owed => owed.shopId === null).reduce((sum, owed) => sum + owed.amount, 0),
      private: (core().wageArrears ?? []).filter(owed => owed.shopId !== null).reduce((sum, owed) => sum + owed.amount, 0),
      publicEarnedNotDue: (core().wageAccruals ?? []).filter(owed => owed.shopId === null).reduce((sum, owed) => sum + owed.amount, 0),
      privateEarnedNotDue: (core().wageAccruals ?? []).filter(owed => owed.shopId !== null).reduce((sum, owed) => sum + owed.amount, 0) }, ledger: structuredClone(ledger),
    shops: { total: s.shops.length, open: s.shops.filter(shop => shop.open).length,
      belowClosureThreshold: s.shops.filter(shop => shop.profit < -600).length,
      zeroEmployees: s.shops.filter(shop => shop.employees === 0).length,
      employees: s.shops.reduce((n, shop) => n + shop.employees, 0),
      cash: s.shops.filter(shop => !e.companies.some(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)).reduce((sum, shop) => sum + sim.shopFunds(shop), 0),
      averageProfit: meanShops(s.shops.map(shop => shop.profit)) },
    npc: { alive: alive.length, total: actors.length, meanHealth: mean(actors, c => e.actorProfiles[c.id].health),
      meanHunger: mean(actors, c => c.needs.hunger), meanFatigue: mean(actors, c => c.needs.fatigue),
      livingMeanHealth: mean(alive, c => e.actorProfiles[c.id].health), livingMeanHunger: mean(alive, c => c.needs.hunger),
      livingMeanFatigue: mean(alive, c => c.needs.fatigue), researchCompleted: e.stats.researchCompleted,
      companies: e.companies.length, zeroCapitalCompanies: e.companies.filter(c => c.capital === 0).length,
      playerAlive: e.actorProfiles.player.alive, poor: alive.filter(c => c.money < 80).length,
      storedFood: actors.reduce((sum, c) => sum + (c.food ?? 0), 0),
      byRole: Object.fromEntries([...new Set(actors.map(c => c.role))].map(role => { const group = actors.filter(c => c.role === role); return [role, { count: group.length, money: mean(group, c => c.money), hunger: mean(group, c => c.needs.hunger), health: mean(group, c => e.actorProfiles[c.id].health) }]; })) },
    technologies: e.technologies.map(t => ({ sector: t.sector, level: t.level })),
    companies: e.companies.map(c => { const shop = s.shops.find(shop => shop.buildingId === c.buildingId)!; return { id: c.id, capital: c.capital, profit: c.profit, employees: c.employees, inventory: c.shopBindingReleasedAt === undefined ? shop.inventory : c.inventory, wageLiability: c.shopBindingReleasedAt === undefined ? sim.shopPayrollDebt(shop) : 0, revenue: c.revenue, workId: c.buildingId }; }) };
}
function meanShops(profits: number[]) { return profits.length ? profits.reduce((sum, p) => sum + p, 0) / profits.length : 0; }
function moneySupply() {
  const s = sim.state, e = extension();
  return s.treasury + core().taxes + s.player.money + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + (Reflect.get(sim, 'runtime').investment ?? 0)) + s.citizens.reduce((sum, c) => sum + c.money, 0)
    + s.shops.filter(shop => !e.companies.some(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + e.companies.reduce((sum, c) => sum + c.capital, 0) + e.organizations.reduce((sum, org) => sum + org.funds, 0)
    + (s.playerLabor?.job?.escrow ?? 0)
    + (s.roadworks?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.education?.course?.escrow ?? 0)
    + familyEducationHeldCash(s)
    + (s.power?.repairs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0)
    + shopLifecycleHeldCash(s)
    + (s.hygiene?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.hygiene?.transfers?.tasks.reduce((sum, task) => sum + task.escrow, 0) ?? 0)
    + (s.family?.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0) ?? 0) + (s.family?.households?.reduce((sum, household) => sum + household.balance, 0) ?? 0);
}

try {
  sim.setFocus(world.spawn, 'walk');
  snapshots.push(snapshot());
  for (let tick = 0; tick < ticks; tick++) {
    sim.step(.25);
    if (tick % 1000 === 0) sim.setFocus(world.districts[Math.floor(tick / 1000) % world.districts.length].center, tick % 2000 === 0 ? 'walk' : 'drone');
    // Read-only progress for long real runs; it changes no simulation state,
    // original guards, sample schedule, terminal save or continuation checks.
    if ((tick + 1) % 100 === 0) console.log(JSON.stringify({ kind: 'progress', tick: sim.state.tick, requestedTicks: ticks, elapsedGameMinutes: extension().lastUpdate - initialMinute, alive: sim.state.citizens.filter(person => extension().actorProfiles[person.id].alive).length, treasury: sim.state.treasury }));
    const dayTicks = 1440 / (.25 * speed);
    if ([1000, 3000, 5000, 7000, ticks].includes(sim.state.tick) || sim.state.tick % dayTicks === 0) {
      const sample = snapshot(); snapshots.push(sample);
      console.log(JSON.stringify({ tick: sample.tick, day: sample.day, treasury: sample.treasury, npc: sample.npc }));
    }
  }
  // Periodic '城市…' rows summarize earlier movements; adding those again would double-count.
  const explicit = Object.entries(ledger).filter(([purpose]) => !purpose.startsWith('城市')).reduce((sum, [, row]) => sum + row.amount - row.eventObserved, 0);
  const expected = initialTreasury + totals.saleTax + totals.wholesaleTax + totals.procurementTax + totals.businessExpenses + totals.wageTax + totals.fares
    - totals.payrollPublicPaid - totals.operations - totals.security - totals.civicProcurement + explicit - core().taxes - (sim.state.playerLabor?.job?.employer.kind === 'public' ? sim.state.playerLabor.job.escrow : 0);
  reconciliationResidual = expected - sim.state.treasury;
  assert.ok(Math.abs(reconciliationResidual) < 1e-6, `treasury reconciliation residual ${reconciliationResidual}`);
  moneyConservationResidual = initialMoneySupply - moneySupply();
  assert.ok(Math.abs(moneyConservationResidual) < 1e-6, `city cash conservation residual ${moneyConservationResidual}`);
  const debts = snapshot().wageArrears;
  assert.ok(Math.abs(totals.payrollPrivateRequested - totals.payrollPrivate - debts.private - debts.privateEarnedNotDue) < 1e-6, 'private earned salaries equal actual payment plus retained worker claims');
  assert.ok(Math.abs(totals.payrollPublicRequested - totals.payrollPublicPaid - debts.public - debts.publicEarnedNotDue) < 1e-6, 'public earned salaries equal actual payment plus retained worker claims');
  assert.ok(starts.length > 0 && exactResearchDebits > 0);
  assert.ok(extension().stats.researchCompleted > 0);
  assert.equal(deaths.length, 0, `baseline residents must remain alive throughout the audited ${requestedDays}-day path`);
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
}
const endSourceHash = await auditSourceHashes();
if (JSON.stringify(sourceHash) !== JSON.stringify(endSourceHash)) { failure ??= 'Simulation source changed during the audit; rerun after freezing the validated files.'; process.exitCode = 1; }
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
// Preserve the actual terminal state for later causal review. This serialization
// neither advances the city nor changes any balances or original audit guards.
const finalSavePath = artifact.slice(0, -5) + '-final.save.json';
const finalSaveText = sim.exportSave();
await writeFile(new URL(`../${finalSavePath}`, import.meta.url), finalSaveText);
const finalSave = { path: finalSavePath, bytes: Buffer.byteLength(finalSaveText), sha256: createHash('sha256').update(finalSaveText).digest('hex') };
// Capture the baseline before exercising the real terminal state and its reader.
// Audit event observers continue to run below; they must not rewrite these totals.
const baselineResult = JSON.parse(JSON.stringify({
  status: failure ? 'failed' : 'passed', sourceHash, endSourceHash, speed, seed, requestedDays, initialPolicy, ruleset: rulesetContext(), ticks: sim.state.tick,
  finalSave, terminalTreasury: sim.state.treasury,
  sourceHashScope: 'All regular src files, this audit driver and its read-only commodity observer; both ends recursively rescan the same source tree.',
  scope: 'One actual generated city at explicit 8x fast-forward; named initial policy scenarios change no cash or physical assets; no renderer or default-speed performance claim.',
  elapsedGameMinutes: extension().lastUpdate - initialMinute, totals, ledger, snapshots, deaths, starts,
  researchFunding, exactResearchDebits, researchCompleted: extension().stats.researchCompleted,
  reconciliationResidual, moneyConservationResidual, initialMoneySupply, finalMoneySupply: moneySupply(),
  economicTrend: snapshots.length ? { cashChangePercent: (snapshots.at(-1)!.npcMoney / snapshots[0].npcMoney - 1) * 100,
    unpaidPrivateWages: totals.payrollPrivateRequested - totals.payrollPrivate,
    steadyStateEstablished: false } : undefined, ...(failure ? { failure } : {}),
}));
let saveValidation: Record<string, unknown>;
try {
  const originalBytes = await readFile(new URL(`../${finalSavePath}`, import.meta.url), 'utf8');
  assert.equal(originalBytes, finalSaveText, 'written terminal save must retain the original bytes');
  const restored = new Simulation(world), result = restored.importSave(originalBytes);
  assert.ok(result.ok, result.message);
  assert.equal(restored.effectiveRuleset, requestedRuleset, 'terminal reader must retain the actually audited rules');
  assert.equal(restored.saveVersion, sim.saveVersion, 'terminal reader must retain its envelope version');
  assert.equal(restored.motionVersion, sim.motionVersion, 'terminal reader must retain its separate motion version');
  assert.deepEqual(restored.rulesetEnablement, sim.rulesetEnablement, 'terminal reader must retain exact original enablement provenance');
  assert.equal(restored.exportSave(), finalSaveText, 'terminal save must reproduce the actual terminal city');
  const parts = partitionSave(originalBytes, world);
  const partitionPath = artifact.slice(0, -5) + '-final.parts.json';
  const partitionText = JSON.stringify(parts);
  await writeFile(new URL(`../${partitionPath}`, import.meta.url), partitionText);
  assert.equal(await readFile(new URL(`../${partitionPath}`, import.meta.url), 'utf8'), partitionText,
    'written partitions must retain the actual generated parts');
  const assembled = assembleSave(parts);
  assert.equal(assembled, originalBytes, 'terminal partitions must preserve every original field and byte order');
  const partitioned = new Simulation(world), partitionResult = partitioned.importSave(assembled);
  assert.ok(partitionResult.ok, partitionResult.message);
  assert.equal(partitioned.exportSave(), finalSaveText, 'partition reader must reproduce the actual terminal city');
  for (let tick = 0; tick < 24; tick++) {
    sim.step(.25); restored.step(.25); partitioned.step(.25);
    assert.equal(restored.exportSave(), sim.exportSave(), `terminal reader diverged at future tick ${tick + 1}`);
    assert.equal(partitioned.exportSave(), sim.exportSave(), `terminal partition reader diverged at future tick ${tick + 1}`);
  }
  const futureSave = sim.exportSave();
  saveValidation = { status: 'passed', immediateEqual: true, futureTicks: 24, futureEqual: true, effectiveRuleset: restored.effectiveRuleset,
    saveEnvelopeVersion: restored.saveVersion, motionVersion: restored.motionVersion, originalEnablement: restored.rulesetEnablement,
    partition: { path: partitionPath, parts: parts.length, sha256: createHash('sha256').update(partitionText).digest('hex'),
      immediateEqual: true, futureTicks: 24, futureEqual: true },
    futureSaveSha256: createHash('sha256').update(futureSave).digest('hex') };
} catch (error) {
  const saveFailure = error instanceof Error ? error.stack ?? error.message : String(error);
  saveValidation = { status: 'failed', failure: saveFailure };
  failure ??= saveFailure; process.exitCode = 1;
}
await writeFile(new URL(`../${artifact}`, import.meta.url), JSON.stringify({ ...baselineResult,
  auditStatus: baselineResult.status, status: failure ? 'failed' : 'passed', saveValidation,
  ...(failure ? { failure } : {}) }, null, 2));
console.log(JSON.stringify({ status: failure ? 'failed' : 'passed', auditStatus: baselineResult.status,
  deaths: baselineResult.deaths.length, treasury: baselineResult.terminalTreasury,
  researchCompleted: baselineResult.researchCompleted, researchFunding: baselineResult.researchFunding,
  reconciliationResidual, moneyConservationResidual, artifact, finalSave, saveValidation }));
if (failure) console.error(failure);
