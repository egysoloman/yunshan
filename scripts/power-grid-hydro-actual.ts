import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Simulation, isCanonicalNpcWage, isCanonicalPlayerLaborWage } from '../src/simulation';
import { assembleSave, partitionSave, type SavePart } from '../src/persistence/partition';
import { clinicalPowerAvailable, claimClinicalCareMinutes } from '../src/simulation/clinical';
import { familyEducationHeldCash } from '../src/simulation/family-education';
import { residentEducationHeldCash } from '../src/simulation/resident-education';
import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';
import { powerSupplyAt } from '../src/simulation/power';
import { hydroKWhPerM3 } from '../src/simulation/power-hydro';
import { hydroGridWindows, prepareHydroBeforeTick, validateHydroGridState } from '../src/simulation/power-grid-hydro';
import { hydroGridWorld, HYDRO_FIXTURE_DISCLOSURE, type HydroFixtureOptions } from '../tests/power-grid-hydro-fixture';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'];
const MAX_FULL_SAVE_BYTES = 40 * 1024 * 1024;
const MAX_STEP_CALLS = 160;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const close = (actual: number, expected: number, label: string, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
type RawEvent = { type: string; [key: string]: unknown };
type EventReceipt = { tick: number; at: number; event: RawEvent; canonicalNpcWage: boolean; canonicalPlayerWage: boolean };

export const ROOT21_HYDRO_PLAN = Object.freeze({
  version: 1, actualRun: 'NOT_RUN', scope: HYDRO_FIXTURE_DISCLOSURE,
  command: 'node --import tsx scripts/power-grid-hydro-actual.ts --out <new-absolute-directory> --plan <root-frozen-plan.json>',
  caps: { stepCalls: MAX_STEP_CALLS, physicalOriginalBytes: MAX_FULL_SAVE_BYTES, futureOrdinarySteps: 24 },
  fullSaveOriginals: 'Every unique complete UTF8 export is gzip-compressed without altering decoded bytes, written/read/decoded, and bound by raw and encoded SHA/bytes. The whole terminal is also one plain UTF8 file. Equal branch saves share the same immutable original.',
  business: { speed: 4, warmupSteps: 1, playerDoorwayPlacements: 1, purchaseQuantities: [30, 11], paidWorkSteps: 12,
    fedInitialUpstreamM3: 10000, depletedInitialUpstreamM3: 7 },
  nativeCases: ['closed-outfall', 'full-downstream', 'clinic-island', 'clinic-null', 'farm-island', 'farm-cable', 'farm-node', 'zero-demand', 'native-vehicle', 'vehicle-island', 'vehicle-null'],
  persistence: ['actual whole-file readback', 'actual all-part array readback', 'fresh whole/rawclone/parts simulations plus original; all future24 saves/events/order exact', 'missing nonempty actual array part rejected'],
  excluded: ['primary World291/4610 baseline (root separate driver)', 'natural player walking', 'completed medical treatment', 'E2 construction or maintenance', 'long-run operation beyond the bounded ledger'],
});

/** Same complete finite cash/escrow accounting as the native economy audit. */
function moneySupply(sim: Simulation): number {
  const s = sim.state, e = s.extension!, runtime = Reflect.get(sim, 'runtime');
  return s.treasury + runtime.taxes + s.player.money
    + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + (runtime.investment ?? 0))
    + s.citizens.reduce((sum, actor) => sum + actor.money, 0)
    + s.shops.filter(shop => !e.companies.some(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + e.companies.reduce((sum, company) => sum + company.capital, 0)
    + e.organizations.reduce((sum, organization) => sum + organization.funds, 0)
    + (s.playerLabor?.job?.escrow ?? 0)
    + (s.roadworks?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.education?.course?.escrow ?? 0) + familyEducationHeldCash(s) + residentEducationHeldCash(s)
    + (s.power?.repairs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0) + shopLifecycleHeldCash(s)
    + (s.hygiene?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.hygiene?.transfers?.tasks.reduce((sum, task) => sum + task.escrow, 0) ?? 0)
    + (s.family?.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0) ?? 0)
    + (s.family?.households.reduce((sum, household) => sum + household.balance, 0) ?? 0);
}

/** Short-window food mass, including custody but never double-counting titles. */
function foodSupply(sim: Simulation): number {
  const s = sim.state, runtime = Reflect.get(sim, 'runtime');
  const foodSite = (id: string) => ['farm', 'dock', 'market'].includes(sim.worldDefinition.buildings.find(site => site.id === id)?.kind ?? '');
  assert.equal(s.extension!.cooking, null, 'this window has no conversion recipe');
  assert(!Object.keys(s.player.inventory).some(key => key.startsWith('ingredient:') || key.startsWith('dish:')), 'recipe custody needs a separate conversion ledger');
  return s.shops.filter(shop => foodSite(shop.buildingId)).reduce((sum, shop) => sum + shop.inventory, 0)
    + s.citizens.reduce((sum, actor) => sum + (actor.food ?? 0), 0) + (s.player.inventory.food ?? 0)
    + Object.values(runtime.freight as Record<string, number>).reduce((sum, quantity) => sum + quantity, 0)
    + s.vehicles.reduce((sum, vehicle) => sum + vehicle.cargo, 0)
    + s.extension!.companies.filter(company => company.shopBindingReleasedAt !== undefined && foodSite(company.buildingId)).reduce((sum, company) => sum + company.inventory, 0);
}

function v2(sim: Simulation) {
  const grid = sim.state.powerGrid;
  assert(grid?.version === 2, 'the declared fixture must use the explicit kW/kWh contract');
  return grid;
}

function observe(sim: Simulation) {
  const receipts: EventReceipt[] = [], commands: { tick: number; command: unknown; result: unknown }[] = [];
  const foodShops = new Set(sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'food').map(shop => shop.id));
  const totals = { foodProduced: 0, foodConsumed: 0, farmProduced: 0, positivePlayerWageCount: 0,
    positivePlayerPaidCount: 0, positiveNpcWageCount: 0, playerEarnedGross: 0, playerPaidGross: 0, playerWorkedMinutes: 0 };
  const bus = Reflect.get(sim, 'bus') as { emit(event: RawEvent): void }, originalEmit = bus.emit.bind(bus);
  // Transparent observation of EVERY native event, including every system phase.
  // The original object is forwarded once and unchanged; provenance is queried
  // on that object before the receipt makes a detached JSON-shaped copy.
  bus.emit = event => {
    const canonicalNpcWage = isCanonicalNpcWage(event, sim), canonicalPlayerWage = isCanonicalPlayerLaborWage(event, sim);
    receipts.push({ tick: sim.state.tick, at: sim.state.day * 1440 + sim.state.hour * 60,
      event: structuredClone(event), canonicalNpcWage, canonicalPlayerWage });
    if (event.type === 'production' && typeof event.shopId === 'string' && foodShops.has(event.shopId)) {
      totals.foodProduced += Number(event.amount ?? 0);
      if (event.shopId === 'shop-other-city-farm') totals.farmProduced += Number(event.amount ?? 0);
      assert(Number(event.amount) > 0 && Number(event.minutes) > 0, 'positive native production has actual positive labor');
    }
    if (event.type === 'food-consumed' || event.type === 'stored-meal') totals.foodConsumed += Number(event.amount ?? 0);
    if (event.type === 'sale' && typeof event.shopId === 'string' && foodShops.has(event.shopId)
      && typeof event.citizenId === 'string' && event.citizenId !== 'player') totals.foodConsumed++;
    if (event.type === 'wage-earned' && Number(event.amount) > 0 && Number(event.minutes) > 0) {
      if (canonicalNpcWage) totals.positiveNpcWageCount++;
      if (canonicalPlayerWage) {
        totals.positivePlayerWageCount++; totals.playerEarnedGross += Number(event.amount); totals.playerWorkedMinutes += Number(event.minutes);
        assert.equal(event.citizenId, 'player');
        assert.equal(event.siteId, sim.state.playerLabor!.job!.siteId);
        close(Number(event.creditedWorkEndAt) - Number(event.creditedWorkStartAt), Number(event.minutes), 'actual wage interval');
      }
    }
    if (event.type === 'wage-paid' && event.citizenId === 'player' && Number(event.amount) > 0) {
      totals.positivePlayerPaidCount++; totals.playerPaidGross += Number(event.amount);
    }
    originalEmit(event);
  };
  const command = (value: Parameters<Simulation['command']>[0]) => {
    assert.notEqual(value.type, 'setTime', 'actual driver never issues a clock jump');
    const result = sim.command(value); commands.push({ tick: sim.state.tick, command: structuredClone(value), result: structuredClone(result) });
    assert(result.ok, result.message); return result;
  };
  return { receipts, commands, totals, command, eventsSince: (cursor: number) => receipts.slice(cursor) };
}

function sourceHashes() {
  const walk = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
      const path = directory + '/' + entry.name;
      assert(entry.isDirectory() || entry.isFile(), 'source graph contains only regular files/directories');
      return entry.isDirectory() ? walk(path) : [path];
    });
  const files = [...walk('src'), 'tests/power-grid-fixture.ts', 'tests/power-grid-hydro-fixture.ts',
    'tests/power-grid-hydro-integration.test.ts', 'scripts/power-grid-hydro-actual.ts', 'package.json', 'package-lock.json', 'tsconfig.json'].sort();
  return Object.fromEntries(files.map(file => [file, { sha256: sha(readFileSync(join(ROOT, file))), bytes: readFileSync(join(ROOT, file)).byteLength }]));
}

export function runHydroActual(output: string, rootPlan?: string) {
  const out = resolve(output); assert(!existsSync(out), 'actual evidence directory must be new'); mkdirSync(out, { recursive: false });
  let physicalOriginalBytes = 0;
  const writeOriginal = (file: string, raw: string | Buffer) => { const path = join(out, file), bytes = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
    assert(physicalOriginalBytes + bytes <= MAX_FULL_SAVE_BYTES, 'all physically encoded originals exceed 40MiB');
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, raw, { flag: 'wx' }); physicalOriginalBytes += bytes;
    assert.equal(sha(readFileSync(path)), sha(raw), 'every original physical writer reads back its bytes'); };
  const json = (file: string, value: unknown) => writeOriginal(file, JSON.stringify(value, null, 2) + '\n');
  const inputs = sourceHashes(); json('SOURCE-INPUTS-BEFORE.json', inputs); json('PLAN.json', ROOT21_HYDRO_PLAN);
  if (rootPlan) { const raw = readFileSync(rootPlan); writeOriginal('ROOT-FROZEN-PLAN.original.json', raw);
    json('ROOT-FROZEN-PLAN-RECEIPT.json', { path: resolve(rootPlan), bytes: raw.byteLength, sha256: sha(raw) }); }
  let calls = 0, fullSaveBytes = 0, expandedUniqueFullSaveBytes = 0;
  const fullSave = (raw: string) => {
    const digest = sha(raw), file = 'full-saves/' + digest + '.json.gz', path = join(out, file);
    if (!existsSync(path)) { const encoded = gzipSync(Buffer.from(raw, 'utf8'));
      assert(fullSaveBytes + encoded.byteLength <= MAX_FULL_SAVE_BYTES, 'bounded physical full-save originals exceed 40MiB');
      writeOriginal(file, encoded); fullSaveBytes += encoded.byteLength;
      expandedUniqueFullSaveBytes += Buffer.byteLength(raw); }
    const encoded = readFileSync(path), decoded = gunzipSync(encoded).toString('utf8');
    assert.equal(decoded, raw, 'complete full-save bytes must survive physical write/read/decompression exactly');
    return { file, encoding: 'gzip-utf8', bytes: Buffer.byteLength(raw), sha256: digest,
      encodedBytes: encoded.byteLength, encodedSha256: sha(encoded) };
  };
  const cases: Record<string, any> = {};
  const openCase = (name: string, options: HydroFixtureOptions = {}) => {
    const world = hydroGridWorld(options); json(name + '/World.original.json', world);
    const sim = new Simulation(world), observer = observe(sim), initialMoney = moneySupply(sim), initialFood = foodSupply(sim);
    const frames: unknown[] = [], residue = { money: 0, food: 0, water: 0, kWh: 0 };
    const check = (label: string, events: EventReceipt[] = []) => {
      const raw = sim.exportSave(), saveReceipt = fullSave(raw), reader = sim.validateSave(raw);
      if (!reader.ok) json(name + '/FAILED-READER-' + frames.length + '.json', { label, save: saveReceipt, reader });
      assert(reader.ok, reader.message);
      assert.equal(sim.exportSave(), raw, 'whole reader is read-only'); validateHydroGridState(sim.state, world);
      const grid = v2(sim), definition = world.powerGrid; assert(definition?.version === 2);
      const source = definition.sources[0], water = grid.hydro, expectedKWh = water.transferredM3 * hydroKWhPerM3(source.hydro);
      const residual = { money: initialMoney - moneySupply(sim), food: initialFood + observer.totals.foodProduced - observer.totals.foodConsumed - foodSupply(sim),
        water: source.hydro.upstream.initialM3 + source.hydro.downstream.initialM3 - water.upstreamM3 - water.downstreamM3,
        kWh: water.generatedKWh - expectedKWh };
      assert(Math.abs(residual.money) < 1e-6, 'every window has complete finite cash/escrow conservation');
      assert(Math.abs(residual.food) < 1e-7, 'every window has complete short-window food custody/source/sink conservation');
      assert(Math.abs(residual.water) < 1e-7 && Math.abs(residual.kWh) < 1e-7, 'every window conserves water and physical output');
      for (const key of Object.keys(residue) as (keyof typeof residue)[]) residue[key] = Math.max(residue[key], Math.abs(residual[key]));
      if (grid.dispatch) {
        close(grid.dispatch.sources[source.id].generatedKWh, grid.dispatch.servedKW * grid.dispatch.minutes / 60, 'actual source arc output equals actual served loads');
        close(grid.totals.servedKWh, water.generatedKWh, 'cumulative generation equals cumulative local load energy');
        close(grid.dispatch.at, sim.state.day * 1440 + sim.state.hour * 60, 'current real meter end clock', 0);
      }
      frames.push({ label, tick: sim.state.tick, at: sim.state.day * 1440 + sim.state.hour * 60,
        save: saveReceipt, events, order: [...sim.state.lastSystemOrder], residual, money: moneySupply(sim), food: foodSupply(sim),
        nativeCounts: structuredClone(observer.totals), grid: structuredClone(grid) });
      return raw;
    };
    const step = (label: string) => {
      assert(++calls <= MAX_STEP_CALLS, 'ordinary native step-call cap'); const tick = sim.state.tick, cursor = observer.receipts.length;
      sim.step(.25); assert.equal(sim.state.tick, tick + 1, 'one ordinary native step must really execute');
      const events = observer.eventsSince(cursor); assert.deepEqual(sim.state.lastSystemOrder, ORDER);
      assert.deepEqual(events.filter(receipt => receipt.event.type.startsWith('system:')).map(receipt => receipt.event.type.slice(7)), ORDER);
      return check(label, events);
    };
    const result = { name, world, sim, observer, frames, residue, initialMoney, initialFood, check, step };
    cases[name] = result; check('cold-native-initialization'); return result;
  };
  const persistedCases = new Set<string>();
  const persistCase = (context: ReturnType<typeof openCase>) => {
    if (persistedCases.has(context.name)) return;
    json(context.name + '/FRAMES.json', context.frames); json(context.name + '/NATIVE-EVENTS.json', context.observer.receipts);
    json(context.name + '/COMMANDS.json', context.observer.commands);
    persistedCases.add(context.name);
  };
  try {
    const business = (name: string, upstreamM3: number) => {
      const c = openCase(name, { upstreamM3 }); c.observer.command({ type: 'speed', value: 4 }); c.step('warmup');
      const farm = c.sim.state.shops.find(shop => shop.buildingId === 'other-city-farm')!; assert(farm.open);
      c.sim.setFocus(c.world.buildings.find(site => site.id === farm.buildingId)!.door, 'walk');
      for (const quantity of [30, 11]) c.observer.command({ type: 'purchase', targetId: farm.buildingId, value: quantity });
      assert.equal(farm.inventory, 119, 'actual purchases lower original finite stock'); c.check('after-actual-purchases');
      c.observer.command({ type: 'work', targetId: farm.buildingId }); c.check('after-funded-work-contract');
      for (let frame = 1; frame <= 12; frame++) c.step('paid-work-' + frame);
      assert(c.observer.totals.positivePlayerWageCount > 0 && c.observer.totals.positivePlayerPaidCount > 0, 'native writer actually earns and pays a positive finite wage');
      close(c.observer.totals.playerEarnedGross, c.sim.state.playerLabor!.stats.paidGross, 'canonical wages match actual finite wage ledger');
      close(c.observer.totals.playerPaidGross, c.sim.state.playerLabor!.stats.paidGross, 'cash writer paid ledger');
      assert(c.sim.state.playerLabor!.stats.workedMinutes > 0); return c;
    };
    const fed = business('fed', 10000), depleted = business('depleted', 7);
    assert(fed.observer.totals.farmProduced > 0, 'real routed finite hydro and paid current-window minutes produce food');
    assert.equal(depleted.observer.totals.farmProduced, 0, 'unpowered paid attendance cannot produce food later');
    assert.equal(v2(depleted.sim).hydro.upstreamM3, 0); assert.equal(v2(depleted.sim).dispatch!.servedKW, 0);
    assert.equal(powerSupplyAt(fed.sim.state, 'other-city-clinic'), true);
    assert.equal(powerSupplyAt(depleted.sim.state, 'other-city-clinic'), false);
    assert.equal(clinicalPowerAvailable(fed.sim.state, 'other-city-clinic'), true);
    assert.equal(clinicalPowerAvailable(depleted.sim.state, 'other-city-clinic'), false);
    const businessCheckpoint = Object.fromEntries([fed, depleted].map(c => [c.name, { actualCounts: structuredClone(c.observer.totals),
      actualPlayerLabor: structuredClone(c.sim.state.playerLabor), terminalTick: c.sim.state.tick, initialMoney: c.initialMoney,
      initialFood: c.initialFood, maximumResidual: { ...c.residue }, save: fullSave(c.sim.exportSave()) }]));
    json('BUSINESS-13-STEP-CHECKPOINT.json', businessCheckpoint);
    const blockedCare = (c: ReturnType<typeof openCase>) => {
      const site = c.world.buildings.find(building => building.kind === 'clinic')!, doctor = c.sim.state.citizens.find(actor => actor.workId === site.id && actor.role !== '学生')!;
      assert(doctor, 'native initialized physician must actually exist'); const raw = c.sim.exportSave();
      assert.equal(claimClinicalCareMinutes(c.sim, site, doctor, 'player', 1, 480, 20), 0, 'native unpowered medical guard consumes zero care');
      assert.equal(c.sim.exportSave(), raw); return { siteId: site.id, doctorId: doctor.id, careMinutes: 0, completedTreatment: false };
    };
    const medicalGuards: unknown[] = [blockedCare(depleted)];
    const micro = (name: string, options: HydroFixtureOptions, assertion: (context: ReturnType<typeof openCase>) => void, count = 1) => {
      const c = openCase(name, options); c.observer.command({ type: 'speed', value: 4 });
      for (let step = 1; step <= count; step++) c.step('native-' + step); assertion(c); return c;
    };
    for (const [name, options] of [['closed-outfall', { outfallOpen: false }], ['full-downstream', { downstreamM3: 20000 }]] as const) micro(name, options, c => {
      assert.equal(v2(c.sim).dispatch!.servedKW, 0); assert.equal(v2(c.sim).hydro.transferredM3, 0); assert.equal(v2(c.sim).hydro.generatedKWh, 0);
    });
    for (const [name, options] of [['clinic-island', { clinicFeeder: false }], ['clinic-null', { clinicConnected: false }]] as const) micro(name, options, c => {
      const meter = v2(c.sim).dispatch!; assert.equal(meter.buildings['other-city-clinic'].servedKW, 0);
      assert.equal(meter.buildings['other-city-farm'].servedKW, meter.buildings['other-city-farm'].demandKW);
      assert.equal(meter.buildings['other-city-market'].servedKW, meter.buildings['other-city-market'].demandKW);
      assert.equal(clinicalPowerAvailable(c.sim.state, 'other-city-clinic'), false); medicalGuards.push(blockedCare(c));
    });
    micro('farm-island', { farmFeeder: false }, c => { const d = v2(c.sim).dispatch!;
      assert.equal(d.buildings['other-city-farm'].servedKW, 0); assert.equal(c.sim.state.shops.find(shop => shop.buildingId === 'other-city-farm')!.open, false);
      assert.equal(clinicalPowerAvailable(c.sim.state, 'other-city-clinic'), true); assert.equal(c.sim.state.shops.find(shop => shop.buildingId === 'other-city-market')!.open, true); });
    micro('farm-cable', { farmCableKW: 1 }, c => { const d = v2(c.sim).dispatch!; close(d.links['north-line'], 1, 'real cable bottleneck'); assert(d.diagnostics.constrainedLinkIds.includes('north-line')); });
    micro('farm-node', { farmNodeKW: 1 }, c => { const d = v2(c.sim).dispatch!; close(d.nodes.north, 1, 'real substation bottleneck'); assert(d.diagnostics.constrainedNodeIds.includes('north')); });
    micro('zero-demand', { zeroDemand: true }, c => { const g = v2(c.sim); assert.equal(g.dispatch!.demandKW, 0); assert.equal(g.hydro.transferredM3, 0); assert.equal(g.hydro.generatedKWh, 0); assert.equal(g.hydro.upstreamM3, 10000); }, 2);
    micro('native-vehicle', { nativeVehicle: true }, c => { assert.equal(c.sim.state.vehicles.length, 1, 'normal constructor makes the declared rail vehicle');
      const vehicle = c.sim.state.vehicles[0], meter = v2(c.sim).dispatch!.vehicles[vehicle.id]; assert(meter); assert(meter.servedKW > 0);
      assert.equal(meter.edgeId, c.world.edges[0].id); close(meter.servedKW, .08, 'native rail vehicle declared local demand');
      assert(vehicle.progress > 0, 'powered ordinary traffic really advances the constructor vehicle');
      assert.notDeepEqual(vehicle.position, c.world.nodes[0].position, 'powered rail body really moves from its native spawn'); }, 2);
    for (const [name, options, count] of [['vehicle-island', { nativeVehicle: true, vehicleFeeder: false }, 2], ['vehicle-null', { nativeVehicle: true, vehicleConnected: false }, 1]] as const) micro(name, options, c => {
      const vehicle = c.sim.state.vehicles[0], d = v2(c.sim).dispatch!; assert(vehicle); assert.equal(d.vehicles[vehicle.id].servedKW, 0);
      assert.equal(vehicle.state, 'noPower'); assert.equal(vehicle.progress, 0); assert.deepEqual(vehicle.position, c.world.nodes[0].position);
      for (const id of ['other-city-farm', 'other-city-market', 'other-city-clinic']) assert.equal(d.buildings[id].servedKW, d.buildings[id].demandKW);
    }, count);

    // Every original part is a real file; reconstruct from the manifest order,
    // preserving its original id and exact bytes rather than treating an array
    // as a dictionary or assembling the in-memory producer result again.
    const terminal = fed.sim.exportSave(), terminalReceipt = fullSave(terminal), producedParts = partitionSave(terminal, fed.world);
    const wholeFile = 'TERMINAL.raw.json';
    assert(fullSaveBytes + Buffer.byteLength(terminal) <= MAX_FULL_SAVE_BYTES); writeOriginal(wholeFile, terminal);
    fullSaveBytes += Buffer.byteLength(terminal); assert.equal(readFileSync(join(out, wholeFile), 'utf8'), terminal);
    json('WHOLE-TERMINAL-RECEIPT.json', { file: wholeFile, bytes: Buffer.byteLength(terminal), sha256: sha(terminal), matchingCompleteCompressedOriginal: terminalReceipt });
    const manifest = producedParts.map((part, index) => {
      const file = 'physical-parts/' + String(index).padStart(4, '0') + '.json', raw = part.json;
      writeOriginal(file, raw);
      return { id: part.id, file, sha256: sha(raw), bytes: Buffer.byteLength(raw) };
    });
    json('PARTS-MANIFEST.json', manifest);
    const readParts: SavePart[] = JSON.parse(readFileSync(join(out, 'PARTS-MANIFEST.json'), 'utf8')).map((entry: typeof manifest[number]) => {
      const raw = readFileSync(join(out, entry.file), 'utf8'); assert.equal(sha(raw), entry.sha256); assert.equal(Buffer.byteLength(raw), entry.bytes); return { id: entry.id, json: raw };
    });
    assert.equal(readParts.length, producedParts.length); assert.equal(assembleSave(readParts), terminal);
    const omitted = readParts.find(part => part.id.startsWith('chunk:') && Object.values(JSON.parse(part.json).arrays ?? {}).some(array => Array.isArray(array) && array.length > 0));
    assert(omitted, 'choose a real physical part containing a nonempty actual array');
    const beforeMissing = fed.sim.exportSave(); assert.throws(() => assembleSave(readParts.filter(part => part.id !== omitted.id)));
    assert.equal(fed.sim.exportSave(), beforeMissing); json('MISSING-ACTUAL-ARRAY-PART-REJECTION.json', { id: omitted.id, partSha256: sha(omitted.json), stage: 'assemble', rejected: true, liveSaveUnchanged: true });

    const rejections: unknown[] = [];
    const corruptions: [string, (document: any) => void][] = [
      ['add-upstream-water', document => { document.state.powerGrid.hydro.upstreamM3++; }],
      ['add-generated-electricity', document => { document.state.powerGrid.hydro.generatedKWh++; }],
      ['erase-grid-history', document => { document.state.powerGrid.history = { count: 0, pages: [] }; }],
      ['stale-meter', document => { document.state.powerGrid.dispatch.tick--; }],
      ['clock-jump', document => { document.state.hour += 1; }],
      ['source-arc-free-electricity', document => { document.state.powerGrid.dispatch.sources['other-hydro'].generatedKWh++; }],
    ];
    for (const [name, mutate] of corruptions) { const document = JSON.parse(terminal); mutate(document); const raw = JSON.stringify(document), before = fed.sim.exportSave();
      const result = fed.sim.importSave(raw); assert.equal(result.ok, false, name); assert.equal(fed.sim.exportSave(), before, 'rejected read preserves the whole live city');
      rejections.push({ name, result, badSave: fullSave(raw), beforeSha256: sha(before), afterSha256: sha(fed.sim.exportSave()) }); }
    json('READER-REJECTIONS.json', rejections);
    const capabilityBefore = fed.sim.exportSave(), clone = structuredClone(fed.sim.state);
    // A strict cold read proves structure; it must not register source authority
    // for a detached generic clone. Only successful native import binds a city.
    validateHydroGridState(clone, fed.world);
    assert.throws(() => prepareHydroBeforeTick(fed.world, clone, .25 * clone.speed), /水力电网契约/);
    assert.equal(fed.sim.exportSave(), capabilityBefore);
    json('GENERIC-CLONE-AUTHORITY-REJECTION.json', { coldReaderAcceptedStructure: true, genericClonePreflightRejected: true, liveSaveUnchanged: true });
    const wrongWorld = hydroGridWorld({ upstreamM3: 9999 }), wrongCity = new Simulation(wrongWorld), wrongBefore = wrongCity.exportSave();
    const wrongResult = wrongCity.importSave(terminal); assert.equal(wrongResult.ok, false); assert.equal(wrongCity.exportSave(), wrongBefore);
    json('CHANGED-WORLD-REJECTION.json', { changedWorld: wrongWorld, result: wrongResult, before: fullSave(wrongBefore), afterSha256: sha(wrongCity.exportSave()) });
    const windows = [...hydroGridWindows(v2(fed.sim))]; assert.equal(windows.length, fed.sim.state.tick);
    json('FED-COMPLETE-GRID-WINDOWS.json', windows);

    const wholeRaw = readFileSync(join(out, wholeFile), 'utf8'), cloneRaw = JSON.stringify(JSON.parse(wholeRaw)), partRaw = assembleSave(readParts);
    const branches = ['whole', 'rawclone', 'parts'].map((name, index) => {
      const sim = new Simulation(structuredClone(fed.world)), raw = [wholeRaw, cloneRaw, partRaw][index];
      const result = sim.importSave(raw); assert(result.ok, result.message); assert.equal(sim.exportSave(), terminal);
      return { name, sim, observer: observe(sim), initialMoney: moneySupply(sim), initialFood: foodSupply(sim), frames: [] as unknown[] };
    });
    for (let frame = 1; frame <= 24; frame++) {
      const originalCursor = fed.observer.receipts.length, reference = fed.step('future-' + frame), originalEvents = fed.observer.eventsSince(originalCursor);
      for (const branch of branches) {
        assert(++calls <= MAX_STEP_CALLS); const cursor = branch.observer.receipts.length, beforeTick = branch.sim.state.tick; branch.sim.step(.25);
        assert.equal(branch.sim.state.tick, beforeTick + 1); const raw = branch.sim.exportSave(); assert.equal(raw, reference, 'fresh ' + branch.name + ' future full save exact');
        assert.deepEqual(branch.observer.eventsSince(cursor), originalEvents, 'fresh ' + branch.name + ' future EVERY event argument/time/order exact');
        assert.deepEqual(branch.sim.state.lastSystemOrder, ORDER); const result = branch.sim.validateSave(raw); assert(result.ok, result.message); assert.equal(branch.sim.exportSave(), raw);
        validateHydroGridState(branch.sim.state, branch.sim.worldDefinition);
        const residual = { money: branch.initialMoney - moneySupply(branch.sim), food: branch.initialFood + branch.observer.totals.foodProduced - branch.observer.totals.foodConsumed - foodSupply(branch.sim) };
        assert(Math.abs(residual.money) < 1e-6 && Math.abs(residual.food) < 1e-7, 'fresh branch finite cash/food conservation');
        branch.frames.push({ frame, tick: branch.sim.state.tick, save: fullSave(raw), events: branch.observer.eventsSince(cursor), order: [...branch.sim.state.lastSystemOrder], residual });
      }
    }
    for (const branch of branches) json('future-' + branch.name + '/FRAMES.json', branch.frames);
    for (const context of Object.values(cases)) persistCase(context);
    json('MEDICAL-POWER-GUARDS.json', medicalGuards);
    const after = sourceHashes(); json('SOURCE-INPUTS-AFTER.json', after); assert.deepEqual(after, inputs, 'actual execution input graph is immutable');
    const summary = { status: 'ACTUAL_COMPLETED', plan: ROOT21_HYDRO_PLAN, stepCalls: calls,
      inputGraphSha256: sha(JSON.stringify(inputs)), inputCount: Object.keys(inputs).length, physicalParts: manifest.length,
      future24: { branches: branches.map(branch => branch.name), everyFullSaveExact: true, everyEventExact: true, everyPhaseOrderExact: true },
      business: businessCheckpoint,
      cases: Object.fromEntries(Object.entries(cases).map(([name, c]) => [name, { ticks: c.sim.state.tick, frameCount: c.frames.length, maximumResidual: c.residue,
        initialWorldSha256: sha(readFileSync(join(out, name, 'World.original.json'))), terminalSave: fullSave(c.sim.exportSave()) }])),
      fullSaveBytes,
      expandedUniqueFullSaveBytes,
      physicalOriginalBytesBeforeResult: physicalOriginalBytes,
      commandsThatJumpClock: 0, directBodyMoneyNeedsStockIdentityEdits: 0, completedMedicalTreatment: false,
      primaryWorldComparison: 'ROOT_SEPARATE_DRIVER', sourceEditedDuringRun: false };
    json('RESULT.json', summary); return summary;
  } catch (error) {
    for (const context of Object.values(cases)) { persistCase(context); fullSave(context.sim.exportSave()); }
    json('RESULT.json', { status: 'FAILED', stepCalls: calls, fullSaveBytes, expandedUniqueFullSaveBytes, physicalOriginalBytesBeforeResult: physicalOriginalBytes,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) });
    throw error;
  }
}

// Importing this module in a test does no simulation or filesystem work.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    assert(['--out', '--plan'].includes(key) && value && !args.has(key), 'recognized nonduplicate actual-driver arguments'); args.set(key, value);
  }
  assert(args.has('--out') && args.has('--plan'), 'root must provide a new output directory and its frozen plan');
  assert.equal(resolve(args.get('--out')!), args.get('--out'), 'actual output must be absolute');
  const result = runHydroActual(args.get('--out')!, args.get('--plan')!);
  console.log(JSON.stringify({ status: result.status, stepCalls: result.stepCalls, physicalParts: result.physicalParts, fullSaveBytes: result.fullSaveBytes, output: relative(ROOT, args.get('--out')!) }));
}
