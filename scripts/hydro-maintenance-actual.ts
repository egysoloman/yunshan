import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Simulation, getCanonicalNpcFullSettlement, isCanonicalNpcWage, type CanonicalNpcFullSettlement } from '../src/simulation';
import { assembleSave, partitionSave, type SavePart } from '../src/persistence/partition';
import { familyEducationHeldCash } from '../src/simulation/family-education';
import { residentEducationHeldCash } from '../src/simulation/resident-education';
import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';
import { validateJointActorActivityCapacity } from '../src/simulation/activity-capacity';
import { hydroKWhPerM3 } from '../src/simulation/power-hydro';
import { hydroGridWindows, prepareHydroBeforeTick, validateHydroGridState } from '../src/simulation/power-grid-hydro';
import { isCanonicalHydroMaintenanceReady, validateHydroMaintenanceState, type HydroMaintenanceJob } from '../src/simulation/hydro-maintenance';
import { hydroMaintenanceWorld, HYDRO_MAINTENANCE_FIXTURE_DISCLOSURE } from '../tests/hydro-maintenance-fixture';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'];
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;
const MAX_PRIMARY_WINDOWS = 160, MAX_STEP_CALLS = 232, MAX_WALL_MS = 12 * 60 * 1000;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const close = (actual: number, expected: number, label: string, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
type RawEvent = { type: string; [key: string]: unknown };
type CashSnapshot = { treasury: number; taxes: number; wallets: Record<string, number>; shopFunds: Record<string, number> };
type PaymentCausality = { before: CashSnapshot; after: CashSnapshot; citizenId: string; shopId: string | null;
  gross: number; net: number; tax: number; requestedAmount: number };
type EventReceipt = { tick: number; at: number; event: RawEvent; probe: boolean; canonicalNpcWage: boolean;
  fullSettlement: Readonly<CanonicalNpcFullSettlement> | null; paymentCausality: PaymentCausality | null };

export const ROOT22_HYDRO_MAINTENANCE_PLAN = Object.freeze({
  version: 1, actualRun: 'NOT_RUN', scope: HYDRO_MAINTENANCE_FIXTURE_DISCLOSURE,
  command: 'node --import tsx scripts/hydro-maintenance-actual.ts --out <new-absolute-directory> --plan <root-frozen-plan.json>',
  caps: { wallMilliseconds: MAX_WALL_MS, primaryOrdinaryWindows: MAX_PRIMARY_WINDOWS,
    aggregateOrdinaryStepCalls: MAX_STEP_CALLS, physicalOriginalBytes: MAX_ORIGINAL_BYTES, futureOrdinaryStepsPerBranch: 24 },
  chronology: { initialAt: 480, speed: 16, ordinaryStepSeconds: .25, playerSitePlacements: 1,
    playerEscrow: 100, engineerActualMinutes: 60, payrollStep: 135, payrollAt: 1020, firstPoweredStep: 136,
    primaryFuture24EndStep: 160, additionalFreshBranchStepCalls: 72 },
  originals: 'Every unique complete save in each branch is its own gzip UTF8 physical original, read/decompressed and checked by complete bytes plus raw/encoded SHA. Every branch also retains its entire event stream and all ten phases. Whole terminal and every actual physical part are independently written/read.',
  editsDuringRun: 0,
  forbidden: ['setTime', 'body/role/needs/cash/stock injections', 'NPC wage amount or payday changes', 'reservoir refill', '8MiB/depth24/4M domain limit increases'],
  exclusions: ['equipment construction', 'natural wear/disaster', 'refill', 'default World291 or 612-building city enablement', 'natural payer walking', 'long-term economy or Mac/GPU performance'],
});

function clock(sim: Simulation): number { return sim.state.day * 1440 + sim.state.hour * 60; }
function v2(sim: Simulation) { const grid = sim.state.powerGrid; assert(grid?.version === 2); return grid; }
function job(sim: Simulation): HydroMaintenanceJob { const value = sim.state.hydroMaintenance?.job; assert(value); return value; }

/** Complete cash custody, keeping company/shop aliases and all escrows separate. */
function moneySupply(sim: Simulation): number {
  const s = sim.state, e = s.extension!, runtime = Reflect.get(sim, 'runtime');
  return s.treasury + runtime.taxes + s.player.money
    + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + (runtime.investment ?? 0))
    + s.citizens.reduce((sum, actor) => sum + actor.money, 0)
    + s.shops.filter(shop => !e.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + e.companies.reduce((sum, company) => sum + company.capital, 0)
    + e.organizations.reduce((sum, organization) => sum + organization.funds, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.roadworks?.jobs.reduce((sum, item) => sum + item.escrow, 0) ?? 0)
    + (s.education?.course?.escrow ?? 0) + familyEducationHeldCash(s) + residentEducationHeldCash(s)
    + (s.power?.repairs.reduce((sum, item) => sum + item.escrow, 0) ?? 0)
    + (s.hydroMaintenance?.job?.escrow ?? 0)
    + (s.clinical?.orders.reduce((sum, item) => sum + item.escrow, 0) ?? 0) + shopLifecycleHeldCash(s)
    + (s.hygiene?.jobs.reduce((sum, item) => sum + item.escrow, 0) ?? 0)
    + (s.hygiene?.transfers?.tasks.reduce((sum, item) => sum + item.escrow, 0) ?? 0)
    + (s.family?.pregnancies.reduce((sum, item) => sum + item.escrow, 0) ?? 0)
    + (s.family?.households.reduce((sum, item) => sum + item.balance, 0) ?? 0);
}
function foodSupply(sim: Simulation): number {
  const s = sim.state, runtime = Reflect.get(sim, 'runtime');
  const foodSite = (id: string) => ['farm', 'dock', 'market'].includes(sim.worldDefinition.buildings.find(site => site.id === id)?.kind ?? '');
  assert.equal(s.extension!.cooking, null); assert(!Object.keys(s.player.inventory).some(key => key.startsWith('ingredient:') || key.startsWith('dish:')));
  return s.shops.filter(shop => foodSite(shop.buildingId)).reduce((sum, shop) => sum + shop.inventory, 0)
    + s.citizens.reduce((sum, actor) => sum + (actor.food ?? 0), 0) + (s.player.inventory.food ?? 0)
    + Object.values(runtime.freight as Record<string, number>).reduce((sum, quantity) => sum + quantity, 0)
    + s.vehicles.reduce((sum, vehicle) => sum + vehicle.cargo, 0)
    + s.extension!.companies.filter(company => company.shopBindingReleasedAt !== undefined && foodSite(company.buildingId)).reduce((sum, company) => sum + company.inventory, 0);
}
/** Other real procurement leaves this explicitly stated shop/maintenance boundary. */
function materialSupply(sim: Simulation): number {
  const materialsSite = (id: string) => sim.worldDefinition.buildings.find(site => site.id === id)?.kind === 'workshop';
  const j = sim.state.hydroMaintenance?.job;
  return sim.state.shops.filter(shop => materialsSite(shop.buildingId)).reduce((sum, shop) => sum + shop.inventory, 0)
    + sim.state.extension!.companies.filter(company => company.shopBindingReleasedAt !== undefined && materialsSite(company.buildingId)).reduce((sum, company) => sum + company.inventory, 0)
    + (sim.state.player.inventory.material ?? 0) + (j ? j.reservedUnits + j.returnedUnits : 0);
}
function cashSnapshot(sim: Simulation): CashSnapshot {
  return { treasury: sim.state.treasury, taxes: Reflect.get(sim, 'runtime').taxes,
    wallets: Object.fromEntries(sim.state.citizens.map(actor => [actor.id, actor.money])),
    shopFunds: Object.fromEntries(sim.state.shops.map(shop => [shop.id, sim.shopFunds(shop)])) };
}
function observe(sim: Simulation) {
  const receipts: EventReceipt[] = [], commands: { tick: number; command: unknown; result: unknown }[] = [];
  const nativeEarned = new Map<string, RawEvent[]>();
  const totals = { foodProduced: 0, foodConsumed: 0, materialProduced: 0, materialTransferredOut: 0,
    positiveNpcWageCount: 0, actualNpcPaymentCount: 0, actualFullSettlementCount: 0, npcEarnedGross: 0, npcPaidGross: 0 };
  const materialShopIds = new Set(sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'materials').map(shop => shop.id));
  const foodShopIds = new Set(sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'food').map(shop => shop.id));
  const materialExitTypes = new Set(['public-procurement', 'security-procurement', 'emergency-procurement', 'medical-procurement', 'civic-procurement']);
  let probing = false, previous = cashSnapshot(sim);
  const bus = Reflect.get(sim, 'bus') as { emit(event: RawEvent): void }, originalEmit = bus.emit.bind(bus);
  bus.emit = event => {
    const canonicalNpcWage = isCanonicalNpcWage(event, sim), fullSettlement = getCanonicalNpcFullSettlement(event, sim);
    const after = cashSnapshot(sim); let paymentCausality: PaymentCausality | null = null;
    if (!probing && event.type === 'wage-paid' && event.citizenId !== 'player' && Number(event.amount) > 0) {
      const citizenId = String(event.citizenId), shopId = typeof event.shopId === 'string' ? event.shopId : null;
      const gross = Number(event.amount), tax = gross * sim.state.taxRate, net = gross - tax;
      close(after.wallets[citizenId] - previous.wallets[citizenId], net, 'actual NPC wallet net credit', 1e-6);
      close((shopId ? previous.shopFunds[shopId] - after.shopFunds[shopId] : previous.treasury - after.treasury), gross, 'actual finite aliased wage source debit', 1e-6);
      close(after.taxes - previous.taxes, tax, 'actual NPC wage tax queue credit', 1e-6);
      assert(gross <= Number(event.requestedAmount) + 1e-7);
      paymentCausality = { before: previous, after, citizenId, shopId, gross, net, tax, requestedAmount: Number(event.requestedAmount) };
      totals.actualNpcPaymentCount++; totals.npcPaidGross += gross;
      if (fullSettlement) { totals.actualFullSettlementCount++; assert.equal(fullSettlement.amount, gross); assert.equal(fullSettlement.requestedAmount, gross); }
    }
    receipts.push({ tick: sim.state.tick, at: clock(sim), event: structuredClone(event), probe: probing, canonicalNpcWage,
      fullSettlement: fullSettlement && structuredClone(fullSettlement), paymentCausality });
    if (!probing) {
      if (event.type === 'wage-earned' && canonicalNpcWage && Number(event.amount) > 0 && Number(event.minutes) > 0) {
        totals.positiveNpcWageCount++; totals.npcEarnedGross += Number(event.amount);
        const rows = nativeEarned.get(String(event.citizenId)) ?? []; rows.push(event); nativeEarned.set(String(event.citizenId), rows);
      }
      if (event.type === 'production') {
        assert(Number(event.amount) > 0 && Number(event.minutes) > 0);
        if (foodShopIds.has(String(event.shopId))) totals.foodProduced += Number(event.amount);
        if (materialShopIds.has(String(event.shopId))) totals.materialProduced += Number(event.amount);
      }
      if (event.type === 'food-consumed' || event.type === 'stored-meal') totals.foodConsumed += Number(event.amount ?? 0);
      if (event.type === 'sale' && foodShopIds.has(String(event.shopId)) && typeof event.citizenId === 'string' && event.citizenId !== 'player') totals.foodConsumed++;
      if (materialExitTypes.has(event.type) && materialShopIds.has(String(event.shopId))) totals.materialTransferredOut += Number(event.quantity ?? 0);
    }
    originalEmit(event); previous = cashSnapshot(sim);
  };
  const command = (value: Parameters<Simulation['command']>[0]) => {
    assert.notEqual(value.type, 'setTime'); const result = sim.command(value);
    commands.push({ tick: sim.state.tick, command: structuredClone(value), result: structuredClone(result) });
    assert(result.ok, result.message); previous = cashSnapshot(sim); return result;
  };
  const probe = (value: RawEvent) => { probing = true; try { bus.emit(value); } finally { probing = false; } };
  return { receipts, commands, totals, nativeEarned, command, probe, eventsSince: (cursor: number) => receipts.slice(cursor) };
}

function sourceHashes() {
  const walk = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = directory + '/' + entry.name; assert(entry.isDirectory() || entry.isFile()); return entry.isDirectory() ? walk(path) : [path];
  });
  const files = [...walk('src'), 'tests/power-grid-fixture.ts', 'tests/power-grid-hydro-fixture.ts', 'tests/hydro-maintenance-fixture.ts',
    'tests/hydro-maintenance.test.ts', 'tests/hydro-maintenance-integration.test.ts', 'scripts/hydro-maintenance-actual.ts',
    'package.json', 'package-lock.json', 'tsconfig.json'].sort();
  return Object.fromEntries(files.map(file => { const raw = readFileSync(join(ROOT, file)); return [file, { sha256: sha(raw), bytes: raw.byteLength }]; }));
}

export function runHydroMaintenanceActual(output: string, rootPlan?: string) {
  const out = resolve(output), beganAt = Date.now(); assert(!existsSync(out)); mkdirSync(out, { recursive: false });
  let calls = 0, completeReaderCalls = 0, physicalOriginalBytes = 0, fullSaveBytes = 0, expandedUniqueFullSaveBytes = 0;
  const guard = () => assert(Date.now() - beganAt < MAX_WALL_MS, 'twelve-minute bounded native driver guard');
  const writeOriginal = (file: string, raw: string | Buffer, diagnostic = false) => {
    const path = join(out, file), bytes = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
    assert(physicalOriginalBytes + bytes <= MAX_ORIGINAL_BYTES - (diagnostic ? 0 : 16 * 1024), 'all actual encoded originals must fit the unchanged 40MiB budget including failure diagnostics');
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, raw, { flag: 'wx' }); physicalOriginalBytes += bytes;
    assert.equal(sha(readFileSync(path)), sha(raw), 'actual physical original readback');
  };
  const json = (file: string, value: unknown) => writeOriginal(file, JSON.stringify(value, null, 2) + '\n');
  const compressedOriginal = (file: string, value: unknown) => {
    const raw = JSON.stringify(value), encoded = gzipSync(Buffer.from(raw)); writeOriginal(file, encoded);
    const read = readFileSync(join(out, file)); assert.equal(gunzipSync(read).toString('utf8'), raw);
    return { file, encoding: 'gzip-utf8', bytes: Buffer.byteLength(raw), sha256: sha(raw), encodedBytes: read.byteLength, encodedSha256: sha(read) };
  };
  const fullSave = (branch: string, raw: string) => {
    const digest = sha(raw), file = branch + '/full-saves/' + digest + '.json.gz', path = join(out, file);
    if (!existsSync(path)) { const encoded = gzipSync(Buffer.from(raw)); writeOriginal(file, encoded);
      fullSaveBytes += encoded.byteLength; expandedUniqueFullSaveBytes += Buffer.byteLength(raw); }
    const encoded = readFileSync(path); assert.equal(gunzipSync(encoded).toString('utf8'), raw, 'every branch complete native save survives disk/gzip exactly');
    return { file, encoding: 'gzip-utf8', bytes: Buffer.byteLength(raw), sha256: digest, encodedBytes: encoded.byteLength, encodedSha256: sha(encoded) };
  };
  const inputs = sourceHashes(); json('SOURCE-INPUTS-BEFORE.json', inputs); json('PLAN.json', ROOT22_HYDRO_MAINTENANCE_PLAN);
  if (rootPlan) { const raw = readFileSync(rootPlan); writeOriginal('ROOT-FROZEN-PLAN.original.json', raw);
    json('ROOT-FROZEN-PLAN-RECEIPT.json', { path: resolve(rootPlan), bytes: raw.byteLength, sha256: sha(raw) }); }
  const world = hydroMaintenanceWorld(); json('World.original.json', world);
  const sim = new Simulation(world), observer = observe(sim);
  const initialMoney = moneySupply(sim), initialFood = foodSupply(sim), initialMaterial = materialSupply(sim);
  const initialEngineers = sim.state.citizens.filter(actor => actor.workId === world.hydroMaintenance!.operatorSiteId && actor.role === '工程师').map(actor => ({ id: actor.id, body: structuredClone(actor), profile: structuredClone(sim.state.extension!.actorProfiles[actor.id]) }));
  assert.equal(world.buildings.length, 6); assert(initialEngineers.length > 0, 'native declared workplace creates original engineers');
  assert.equal(sim.state.player.money, 600); assert.equal(sim.state.treasury, 80000); assert.equal(initialMaterial, 90);
  assert.equal(clock(sim), 480); assert.equal(sim.state.tick, 0);
  json('NATIVE-INITIALIZATION.json', { initialMoney, initialFood, initialMaterial, initialEngineers,
    player: structuredClone(sim.state.player), treasury: sim.state.treasury, ordinaryWorkshop: structuredClone(sim.state.shops.find(shop => shop.buildingId === 'other-city-workshop')) });
  const frames: unknown[] = [], maximumResidual = { money: 0, food: 0, material: 0, water: 0, kWh: 0 };
  const check = (owner: Simulation, events: EventReceipt[], label: string, branch: string, seen: ReturnType<typeof observe>, baseline: { money: number; food: number; material: number }) => {
    guard(); const raw = owner.exportSave(), save = fullSave(branch, raw), reader = owner.validateSave(raw); completeReaderCalls++;
    if (!reader.ok) json(branch + '/FAILED-READER-' + owner.state.tick + '.json', { save, reader }); assert(reader.ok, reader.message);
    assert.equal(owner.exportSave(), raw, 'full cold reader cannot change the live city');
    validateHydroMaintenanceState(owner.state, owner.worldDefinition); validateHydroGridState(owner.state, owner.worldDefinition); validateJointActorActivityCapacity(owner.state);
    const grid = v2(owner), definition = owner.worldDefinition.powerGrid; assert(definition?.version === 2);
    const source = definition.sources[0], water = grid.hydro, j = owner.state.hydroMaintenance?.job;
    const residual = { money: baseline.money - moneySupply(owner), food: baseline.food + seen.totals.foodProduced - seen.totals.foodConsumed - foodSupply(owner),
      material: baseline.material + seen.totals.materialProduced - seen.totals.materialTransferredOut - (j?.consumedUnits ?? 0) - materialSupply(owner),
      water: source.hydro.upstream.initialM3 + source.hydro.downstream.initialM3 - water.upstreamM3 - water.downstreamM3,
      kWh: water.generatedKWh - water.transferredM3 * hydroKWhPerM3(source.hydro) };
    for (const [kind, value] of Object.entries(residual)) assert(Math.abs(value) < (kind === 'money' ? 1e-6 : 1e-7), branch + ' finite ' + kind + ' conservation: ' + value);
    if (grid.dispatch) { close(grid.dispatch.at, clock(owner), 'real dispatch clock', 0);
      close(grid.dispatch.sources[source.id].generatedKWh, grid.dispatch.servedKW * grid.dispatch.minutes / 60, 'actual source arc equals local served kWh');
      close(grid.totals.servedKWh, water.generatedKWh, 'cumulative local kWh equals actual generation'); }
    guard(); return { raw, receipt: { label, tick: owner.state.tick, at: clock(owner), save, eventCount: events.length, allEventBytesSha256: sha(JSON.stringify(events)),
      order: [...owner.state.lastSystemOrder], residual, money: moneySupply(owner), food: foodSupply(owner), material: materialSupply(owner), counts: structuredClone(seen.totals) } };
  };
  const baseline = { money: initialMoney, food: initialFood, material: initialMaterial };
  const record = (label: string, events: EventReceipt[] = []) => { const result = check(sim, events, label, 'primary', observer, baseline);
    frames.push(result.receipt); for (const kind of Object.keys(maximumResidual) as (keyof typeof maximumResidual)[]) maximumResidual[kind] = Math.max(maximumResidual[kind], Math.abs(result.receipt.residual[kind])); return result.raw; };
  const ordinary = (label: string) => {
    guard(); assert(++calls <= MAX_STEP_CALLS); assert(sim.state.tick < MAX_PRIMARY_WINDOWS);
    const beforeTick = sim.state.tick, cursor = observer.receipts.length; sim.step(.25); assert.equal(sim.state.tick, beforeTick + 1);
    const events = observer.eventsSince(cursor); assert.deepEqual(sim.state.lastSystemOrder, ORDER);
    assert.deepEqual(events.filter(receipt => receipt.event.type.startsWith('system:')).map(receipt => receipt.event.type.slice(7)), ORDER);
    return record(label, events);
  };
  const branches: { name: string; sim: Simulation; observer: ReturnType<typeof observe>; baseline: typeof baseline; frames: unknown[] }[] = [];
  let persisted = false;
  const persist = () => {
    if (persisted) return;
    json('primary/FRAMES.json', frames); compressedOriginal('primary/ALL-NATIVE-EVENTS.original.json.gz', observer.receipts); json('primary/COMMANDS.json', observer.commands);
    for (const branch of branches) { json(branch.name + '/FRAMES.json', branch.frames); compressedOriginal(branch.name + '/ALL-NATIVE-EVENTS.original.json.gz', branch.observer.receipts); }
    persisted = true;
  };
  try {
    record('cold-native-initialization'); observer.command({ type: 'speed', value: 16 });
    const operator = world.buildings.find(site => site.id === world.hydroMaintenance!.operatorSiteId)!;
    sim.setFocus(operator.door, 'walk'); json('PAYER-SITE-PLACEMENT.json', { count: 1, tick: sim.state.tick, at: clock(sim), position: { ...operator.door }, mode: 'walk', naturalWalking: false, npcPlacementCount: 0 });
    const supplier = sim.state.shops.find(shop => shop.buildingId === 'other-city-workshop')!;
    const beforeRequest = { playerMoney: sim.state.player.money, inventory: supplier.inventory,
      supplierFunds: sim.shopFunds(supplier), taxQueue: Reflect.get(sim, 'runtime').taxes, eventCursor: observer.receipts.length };
    observer.command({ type: 'requestEnergyRepair', targetId: operator.id });
    const bought = job(sim).receipts[0]; assert(bought); assert.equal(job(sim).receipts.length, 1);
    assert.equal(beforeRequest.playerMoney - sim.state.player.money, 100); assert.equal(supplier.inventory, 89);
    close(beforeRequest.inventory - supplier.inventory, bought.quantity, 'actual original finite material stock debit');
    close(sim.shopFunds(supplier) - beforeRequest.supplierFunds, bought.net, 'actual aliased supplier net cash credit');
    close(Reflect.get(sim, 'runtime').taxes - beforeRequest.taxQueue, bought.tax, 'actual procurement tax queue credit');
    close(job(sim).escrow + bought.gross, 100, 'actual finite maintenance escrow debit');
    const procurementEvent = observer.eventsSince(beforeRequest.eventCursor).find(receipt => receipt.event.type === 'wholesale'
      && receipt.event.procurementId === job(sim).id && receipt.event.purpose === 'hydro-maintenance');
    assert(procurementEvent); assert.equal(procurementEvent.event.shopId, supplier.id);
    close(Number(procurementEvent.event.amount), bought.gross, 'original procurement event gross');
    close(Number(procurementEvent.event.quantity), bought.quantity, 'original procurement event material quantity');
    json('ACTUAL-MATERIAL-PROCUREMENT-CAUSALITY.json', { before: beforeRequest,
      after: { playerMoney: sim.state.player.money, inventory: supplier.inventory, supplierFunds: sim.shopFunds(supplier),
        taxQueue: Reflect.get(sim, 'runtime').taxes, escrow: job(sim).escrow }, receipt: bought, originalEvent: procurementEvent });
    assert.equal(job(sim).receivedUnits, 1); record('actual-100-escrow-and-one-material-purchase');
    let pendingCheckpoint: unknown = null, pendingProbed = false;
    for (let frame = 1; frame <= 135; frame++) {
      ordinary('native-' + frame); const j = job(sim);
      if (frame < 135) { assert.notEqual(j.status, 'completed'); assert.equal(j.payment, null); }
      assert.equal(v2(sim).dispatch!.servedKW, 0, 'every pre-payment energy window stays off');
      assert.equal(v2(sim).hydro.transferredM3, 0); assert.equal(v2(sim).hydro.generatedKWh, 0);
      if (!pendingProbed && j.status === 'awaitingWageSettlement') {
        assert.equal(j.workedMinutes, 60); assert.equal(j.payment, null); assert.equal(j.consumedUnits, 1); assert(j.laborCompletedAt !== null && j.laborCompletedAt < 1020);
        const before = sim.exportSave(), native = observer.nativeEarned.get(j.technicianId!)?.[0]; assert(native, 'retain the authentic earlier earned event object');
        const genericPaid: RawEvent = { type: 'wage-paid', citizenId: j.technicianId!, districtId: operator.districtId, amount: 1000, requestedAmount: 1000 };
        for (const [name, event] of [['generic-earned', { ...native }], ['copied-earned', structuredClone(native)], ['stale-original-earned', native],
          ['generic-paid', genericPaid], ['copied-paid', structuredClone(genericPaid)]] as const) {
          assert.equal(isCanonicalNpcWage(event, sim), false); assert.equal(getCanonicalNpcFullSettlement(event, sim), null);
          observer.probe(event); assert.equal(sim.exportSave(), before, name + ' cannot repair, earn cash or change complete native save');
          assert.equal(job(sim).status, 'awaitingWageSettlement'); assert.equal(job(sim).payment, null);
        }
        pendingCheckpoint = { tick: sim.state.tick, at: clock(sim), job: structuredClone(j), save: fullSave('primary', before),
          probeNames: ['generic-earned', 'copied-earned', 'stale-original-earned', 'generic-paid', 'copied-paid'], wholeSaveUnchanged: true };
        json('AWAITING-WAGE-SETTLEMENT-CHECKPOINT.json', pendingCheckpoint); pendingProbed = true;
      }
    }
    assert(pendingProbed); assert.equal(sim.state.tick, 135); close(clock(sim), 1020, 'ordinary native time reaches original 17:00', 1e-8);
    const completed = job(sim); assert.equal(completed.status, 'completed'); assert.equal(completed.workedMinutes, 60);
    assert(completed.payment); assert.equal(completed.payment.amount, completed.payment.requestedAmount);
    close(completed.completedAt!, 1020, 'completion follows original actual finance writer');
    assert.equal(completed.completedTick, 135); assert.equal(completed.payment.tick, 135);
    assert(initialEngineers.some(actor => actor.id === completed.technicianId));
    assert.equal(completed.escrow, 0); close(completed.purchasePaid + completed.serviceFees, 100, 'entire finite payer escrow settled');
    const actualPayment = observer.receipts.find(receipt => receipt.fullSettlement?.citizenId === completed.technicianId && receipt.fullSettlement.at === completed.payment!.at);
    assert(actualPayment?.paymentCausality); assert(actualPayment.fullSettlement); assert.deepEqual(completed.payment, actualPayment.fullSettlement);
    const allLaborSources = completed.laborReceipts.map(receipt => {
      const original = observer.receipts.find(row => row.canonicalNpcWage && row.tick === receipt.tick && row.event.citizenId === receipt.actorId
        && row.event.creditedWorkStartAt === receipt.source.startAt && row.event.creditedWorkEndAt === receipt.source.endAt
        && row.event.amount === receipt.source.amount && row.event.minutes === receipt.source.minutes && row.event.siteId === receipt.siteId);
      assert(original, 'every credited exact repair slice has its own original current native wage event');
      close(receipt.endAt - receipt.startAt, receipt.minutes, 'actual repair interval');
      assert(receipt.startAt >= receipt.source.startAt && receipt.endAt <= receipt.source.endAt);
      return { receipt: structuredClone(receipt), original: structuredClone(original) };
    });
    close(completed.laborReceipts.reduce((sum, receipt) => sum + receipt.minutes, 0), 60, 'all actual repair slices total precisely sixty');
    json('COMPLETED-AT-ORIGINAL-17-FINANCE.json', { tick: sim.state.tick, at: clock(sim), job: structuredClone(completed), actualPayment,
      save: fullSave('primary', sim.exportSave()), equipmentStillOffInThisEarlierEnergyWindow: true });
    compressedOriginal('COMPLETE-LABOR-SOURCE-JOINS.original.json.gz', allLaborSources);
    ordinary('first-next-energy-window'); assert.equal(sim.state.tick, 136); assert(v2(sim).dispatch!.servedKW > 0);
    assert(v2(sim).hydro.transferredM3 > 0 && v2(sim).hydro.generatedKWh > 0);
    assert(v2(sim).dispatch!.at > job(sim).completedAt!);
    assert(v2(sim).dispatch!.tick > job(sim).completedTick!);
    const checkpoint = { tick: sim.state.tick, at: clock(sim), job: structuredClone(job(sim)), grid: structuredClone(v2(sim)), maximumResidual: { ...maximumResidual }, save: fullSave('primary', sim.exportSave()) };
    json('FIRST-REAL-WATER-KWH-CHECKPOINT.json', checkpoint);

    const terminal = sim.exportSave(); writeOriginal('TERMINAL.raw.json', terminal);
    assert.equal(readFileSync(join(out, 'TERMINAL.raw.json'), 'utf8'), terminal);
    const produced = partitionSave(terminal, world), manifest = produced.map((part, index) => {
      const file = 'physical-parts/' + String(index).padStart(4, '0') + '.json'; writeOriginal(file, part.json);
      return { id: part.id, file, bytes: Buffer.byteLength(part.json), sha256: sha(part.json) };
    });
    json('PARTS-MANIFEST.json', manifest);
    const parts: SavePart[] = JSON.parse(readFileSync(join(out, 'PARTS-MANIFEST.json'), 'utf8')).map((entry: typeof manifest[number]) => {
      const raw = readFileSync(join(out, entry.file), 'utf8'); assert.equal(sha(raw), entry.sha256); assert.equal(Buffer.byteLength(raw), entry.bytes); return { id: entry.id, json: raw };
    });
    assert.equal(assembleSave(parts), terminal);
    const omitted = parts.find(part => part.id.startsWith('chunk:') && Object.values(JSON.parse(part.json).arrays ?? {}).some(value => Array.isArray(value) && value.length > 0));
    assert(omitted); assert.throws(() => assembleSave(parts.filter(part => part.id !== omitted.id)));
    assert.equal(sim.exportSave(), terminal); json('MISSING-REAL-ARRAY-PART-REJECTION.json', { omittedId: omitted.id, originalPartSha256: sha(omitted.json), rejectedAt: 'native-assemble', liveSaveUnchanged: true });
    const rejections: unknown[] = [];
    const corruptions: [string, (document: any) => void][] = [
      ['delete-material-receipts', document => { document.state.hydroMaintenance.job.receipts = []; }],
      ['delete-labor-receipts', document => { document.state.hydroMaintenance.job.laborReceipts = []; }],
      ['delete-actual-payment', document => { document.state.hydroMaintenance.job.payment = null; }],
      ['partial-payment-not-completed', document => { document.state.hydroMaintenance.job.payment.amount /= 2; }],
      ['false-equipment-history', document => { const header = document.state.powerGrid.history.pages[0][0].windows[0].loadSources;
        assert.equal(header.equipmentAvailable, false); header.equipmentAvailable = true; }],
      ['false-work-position', document => { document.state.hydroMaintenance.job.laborReceipts[0].position.x += 1000; }],
    ];
    for (const [name, mutate] of corruptions) {
      const document = JSON.parse(terminal); mutate(document); const bad = JSON.stringify(document), before = sim.exportSave();
      const coldReader = sim.validateSave(bad); assert.equal(coldReader.ok, false, name + ' cold reader'); assert.equal(sim.exportSave(), before);
      const result = sim.importSave(bad); assert.equal(result.ok, false, name); assert.equal(sim.exportSave(), before);
      rejections.push({ name, coldReader, result, badSave: fullSave('rejected', bad), beforeSha256: sha(before), afterSha256: sha(sim.exportSave()) });
    }
    json('COLD-READER-REJECTIONS.json', rejections);
    const clone = structuredClone(sim.state); validateHydroMaintenanceState(clone, world); validateHydroGridState(clone, world);
    assert.equal(isCanonicalHydroMaintenanceReady(clone, clock(sim) + 4), false);
    assert.throws(() => prepareHydroBeforeTick(world, clone, .25 * clone.speed), /水力电网契约/);
    assert.equal(sim.exportSave(), terminal);
    json('GENERIC-BODY-CLONE-AUTHORITY-REJECTION.json', { coldReadStructureAccepted: true, equipmentCapabilityRejected: true, hydroDispatchPreflightRejected: true, wholeLiveSaveUnchanged: true });
    compressedOriginal('PRIMARY-COMPLETE-136-WINDOWS.original.json.gz', [...hydroGridWindows(v2(sim))]);

    const whole = readFileSync(join(out, 'TERMINAL.raw.json'), 'utf8'), rawClone = JSON.stringify(JSON.parse(whole)), physical = assembleSave(parts);
    for (const [name, raw] of [['whole', whole], ['rawclone', rawClone], ['physicalParts', physical]] as const) {
      guard(); const owner = new Simulation(structuredClone(world)), result = owner.importSave(raw); assert(result.ok, result.message); assert.equal(owner.exportSave(), terminal);
      const seen = observe(owner), initial = { money: moneySupply(owner), food: foodSupply(owner), material: materialSupply(owner) + job(owner).consumedUnits };
      const initialFrame = check(owner, [], 'fresh-full-native-import', name, seen, initial);
      branches.push({ name, sim: owner, observer: seen, baseline: initial, frames: [initialFrame.receipt] });
    }
    for (let frame = 1; frame <= 24; frame++) {
      const cursor = observer.receipts.length, reference = ordinary('future-' + frame), allEvents = observer.eventsSince(cursor);
      for (const branch of branches) {
        guard(); assert(++calls <= MAX_STEP_CALLS); const branchCursor = branch.observer.receipts.length, beforeTick = branch.sim.state.tick;
        branch.sim.step(.25); assert.equal(branch.sim.state.tick, beforeTick + 1);
        const events = branch.observer.eventsSince(branchCursor), verified = check(branch.sim, events, 'future-' + frame, branch.name, branch.observer, branch.baseline);
        assert.equal(verified.raw, reference, branch.name + ' fresh future complete save exact');
        assert.deepEqual(events, allEvents, branch.name + ' fresh future every native bus argument/time/order/provenance exact');
        assert.deepEqual(branch.sim.state.lastSystemOrder, ORDER); assert.deepEqual(events.filter(row => row.event.type.startsWith('system:')).map(row => row.event.type.slice(7)), ORDER);
        branch.frames.push(verified.receipt);
      }
    }
    assert.equal(sim.state.tick, 160); assert.equal(calls, 232); guard(); persist(); guard();
    const after = sourceHashes(); json('SOURCE-INPUTS-AFTER.json', after); assert.deepEqual(after, inputs, 'root-frozen functional source graph stays immutable'); guard();
    const result = { status: 'ACTUAL_COMPLETED', plan: ROOT22_HYDRO_MAINTENANCE_PLAN, stepCalls: calls, primaryOrdinaryWindows: sim.state.tick,
      constructorCount: 4, freshFullImportCount: 3, completeReaderCalls, rejectedColdReaderCount: rejections.length,
      primaryFrameCount: frames.length, physicalParts: manifest.length,
      inputGraphSha256: sha(JSON.stringify(inputs)), inputCount: Object.keys(inputs).length,
      initialMoney, initialFood, initialMaterial, maximumResidual,
      maintenance: { technicianId: job(sim).technicianId, workedMinutes: job(sim).workedMinutes, laborReceiptCount: job(sim).laborReceipts.length,
        laborCompletedAt: job(sim).laborCompletedAt, completedAt: job(sim).completedAt, completedTick: job(sim).completedTick, payment: job(sim).payment,
        purchasePaid: job(sim).purchasePaid, serviceFees: job(sim).serviceFees, consumedUnits: job(sim).consumedUnits },
      future24: { branches: branches.map(branch => branch.name), everyCompleteSaveExact: true, everyNativeEventExact: true, everyTenPhaseExact: true, independentOriginals: true },
      fullSaveBytes, expandedUniqueFullSaveBytes, physicalOriginalBytesBeforeResult: physicalOriginalBytes,
      actualCounts: observer.totals, payerSitePlacementCount: 1, npcBodyPlacementCount: 0, directBodyMoneyNeedsStockIdentityEdits: 0,
      commandsThatJumpClock: 0, originalNpcWageAmountOrPaydayChanges: 0, constructionOrWearOrRefillClaim: false, defaultCityEnabled: false,
      elapsedMilliseconds: Date.now() - beganAt, sourceEditedDuringRun: false };
    guard(); json('RESULT.json', result); guard(); return result;
  } catch (error) {
    try { fullSave('failure-primary', sim.exportSave()); persist(); } catch (preservationError) {
      writeOriginal('PRESERVATION-FAILURE.json', JSON.stringify({ error: String(preservationError), physicalOriginalBytes }) + '\n', true);
    }
    writeOriginal(existsSync(join(out, 'RESULT.json')) ? 'FAILED-RESULT.json' : 'RESULT.json', JSON.stringify({ status: 'FAILED', stepCalls: calls, fullSaveBytes, physicalOriginalBytes,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) }, null, 2) + '\n', true);
    throw error;
  }
}

// Import is inert: only the root gate or the explicitly selected test executes.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) { const key = process.argv[index], value = process.argv[index + 1];
    assert(['--out', '--plan'].includes(key) && value && !args.has(key)); args.set(key, value); }
  assert(args.has('--out') && args.has('--plan')); assert.equal(resolve(args.get('--out')!), args.get('--out'));
  const result = runHydroMaintenanceActual(args.get('--out')!, args.get('--plan')!);
  console.log(JSON.stringify({ status: result.status, stepCalls: result.stepCalls, primaryOrdinaryWindows: result.primaryOrdinaryWindows,
    physicalParts: result.physicalParts, fullSaveBytes: result.fullSaveBytes, output: relative(ROOT, args.get('--out')!) }));
}
