import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, openSync, closeSync, readSync, readFileSync, readdirSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import { Simulation, getCanonicalNpcFullSettlement, isCanonicalNpcWage } from '../src/simulation';
import type { Citizen, WorldDefinition } from '../src/types';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { CIVIC_ARCHIVE_BYTE_LIMIT, FULL_SAVE_CHARACTER_LIMIT, LIVE_SAVE_CHARACTER_LIMIT, validateSaveResources } from '../src/persistence/save-resource';
import { cashSnapshot, debtSnapshot, foodCustodySnapshot } from './economy-resume-custody';
import { foodSnapshot } from './economy-observations';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['time', 'environment', 'energy', 'traffic', 'people', 'commerce', 'finance', 'security', 'politics', 'feedback'] as const;
const WORLD_SHA = '2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512';
const SAVE_SHA = '4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a';
const NATIVE03_CHECKPOINT_344_SHA = 'f0ea97daef48d4e2357536a3d1ce4b9222dbcbaaa4d5205677bde9483c5a95b6';
const MAX_BYTES = 2 * 1024 * 1024 * 1024, NEXT_STEP_RESERVE = 256 * 1024 * 1024;
const WALL_MS = 1800_000, ORDINARY_WALL_MS = 1740_000, MAX_WINDOWS = 360, EPS = 1e-6;
type Data = Record<string, any>;
type RawEvent = { type: string; [key: string]: unknown };
type Original = { file: string; encoding: 'gzip-utf8'; rawBytes: number; rawChars: number; rawSHA256: string; encodedBytes: number; encodedSHA256: string };
type DirectCash = { treasury: number; taxes: number; player: number; wallets: Record<string, number>; shops: Record<string, { funds: number; inventory: number }> };
type Frame = { label: string; tick: number; clock: number; completeWindow: boolean; save: Original | null; bus: Original | null; phases: Original | null; eventCount: number; missing: string[]; reader?: unknown; resources?: unknown };
class ResourceStop extends Error {}
const sha = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');
const minute = (sim: Simulation) => sim.state.day * 1440 + sim.state.hour * 60;
const runtime = (sim: Simulation): Data => Reflect.get(sim, 'runtime') as Data;
const clone = <T>(value: T): T => structuredClone(value);
const errorText = (error: unknown) => error instanceof Error ? error.stack ?? error.message : String(error);
function close(actual: number, expected: number, label: string) {
  assert(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < EPS, `${label}: ${actual} != ${expected}`);
}
function positive(value: unknown, label: string): number { assert(typeof value === 'number' && Number.isFinite(value) && value > 0, label); return value; }
function treeSize(value: unknown) {
  const pending = [{ value, depth: 0 }]; let visited = 0, depth = 0;
  while (pending.length) { const row = pending.pop()!; visited++; depth = Math.max(depth, row.depth);
    if (row.value !== null && typeof row.value === 'object') for (const child of Object.values(row.value)) pending.push({ value: child, depth: row.depth + 1 }); }
  return { visited, depth };
}

/** Reversible own-property encoding preserves undefined, -0, descriptors,
 * ordering, shared object identities and frozen original payloads. No getter is
 * executed. The ordinary JSON event beside it is only a convenient view. */
function typedOriginal(value: unknown): unknown {
  const seen = new Map<object, number>();
  const encode = (item: unknown): unknown => {
    if (item === undefined) return { kind: 'undefined' };
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return { kind: typeof item, value: item };
    if (typeof item === 'number') return { kind: 'number', value: Object.is(item, -0) ? '-0' : Number.isNaN(item) ? 'NaN' : item === Infinity ? '+Infinity' : item === -Infinity ? '-Infinity' : item };
    if (typeof item === 'bigint') return { kind: 'bigint', value: String(item) };
    assert(typeof item === 'object', 'native event contains an unsupported function or symbol');
    if (seen.has(item)) return { kind: 'reference', id: seen.get(item) };
    const id = seen.size; seen.set(item, id); const prototype = Object.getPrototypeOf(item);
    assert(prototype === Object.prototype || prototype === Array.prototype || prototype === null, 'native event has an unsupported prototype');
    return { kind: Array.isArray(item) ? 'array' : 'object', id, prototype: prototype === null ? null : Array.isArray(item) ? 'Array' : 'Object',
      extensible: Object.isExtensible(item), frozen: Object.isFrozen(item), properties: Reflect.ownKeys(item).map(key => {
        assert(typeof key === 'string', 'native event contains a symbol key'); const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        assert('value' in descriptor, 'native event contains an accessor');
        return { key, enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: encode(descriptor.value) };
      }) };
  };
  return encode(value);
}
function sourceHashes() {
  const walk = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    assert(entry.isFile() || entry.isDirectory(), 'source provenance cannot follow a symlink'); const file = directory + '/' + entry.name;
    return entry.isDirectory() ? walk(file) : [file];
  });
  return Object.fromEntries([...walk('src'), ...walk('tests'), ...walk('scripts'), ...walk('adapters'), ...walk('public'), 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'].sort()
    .map(file => { const raw = readFileSync(join(ROOT, file)); return [file, { bytes: raw.byteLength, sha256: sha(raw) }]; }));
}
function directCash(sim: Simulation): DirectCash {
  return { treasury: sim.state.treasury, taxes: runtime(sim).taxes, player: sim.state.player.money,
    wallets: Object.fromEntries(sim.state.citizens.map(actor => [actor.id, actor.money])),
    shops: Object.fromEntries(sim.state.shops.map(shop => [shop.id, { funds: sim.shopFunds(shop), inventory: shop.inventory }])) };
}
function body(sim: Simulation, actor: Citizen) {
  const profile = sim.state.extension!.actorProfiles[actor.id];
  return { id: actor.id, name: actor.name, workId: actor.workId, homeId: actor.homeId, role: actor.role, state: actor.state, destinationId: actor.destinationId,
    position: clone(actor.position), needs: clone(actor.needs), money: actor.money, food: actor.food ?? 0, education: actor.education ?? 0,
    profile: { alive: profile.alive, age: profile.age, health: profile.health, skill: profile.skill, stress: profile.stress, mood: profile.mood } };
}
function naturalState(sim: Simulation) {
  const r = runtime(sim), e = sim.state.extension!;
  return { at: minute(sim), extensionAt: e.lastUpdate, schedule: { commerceAt: r.commerceAt, financeAt: r.financeAt, payrollAt: r.payrollAt }, citizens: sim.state.citizens.map(actor => body(sim, actor)),
    publicLabor: clone(r.publicLabor ?? null), privateLabor: clone(r.privateLabor ?? null), publicBudgets: clone(r.publicBudgets ?? []),
    publicBudget: sim.publicBudgetSnapshot(), researchJobs: clone(Reflect.get(e, 'runtime').researchJobs), technologies: clone(e.technologies), districts: clone(sim.state.districts),
    shops: sim.state.shops.map(shop => ({ ...clone(shop), funds: sim.shopFunds(shop), debt: sim.shopPayrollDebt(shop), committed: sim.shopCommittedPayroll(shop), protected: sim.shopProtectedFunds(shop),
      labor: r.shopLabor?.[shop.id] ?? 0, poweredLabor: r.poweredShopLabor?.[shop.id] ?? null, buildingKind: sim.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.kind })) };
}

/** Pure audit of detached observations. This returns no gameplay capability;
 * the live caller must obtain canonical=true from the original event/current
 * Simulation, never from a copied payload or this diagnostic function. */
export function auditPublicResponseEarned(witness: Data): Data {
  const { event, actor, before, dispatch, crime, claim, at } = witness;
  assert(witness.canonical === true && event.type === 'wage-earned', 'response requires original current canonical NPC earned event');
  assert(event.citizenId === actor.id && claim.citizenId === actor.id && before?.actor.id === actor.id, 'response keeps original citizen/claim identity');
  assert(event.shopId === undefined && claim.shopId === null && actor.workId === event.siteId && claim.workId === event.siteId, 'response keeps original public employer');
  assert(['警察', 'police'].includes(actor.role) && actor.profile.alive === true, 'response requires real living police identity');
  assert(before && before.dispatch && dispatch && before.dispatch.crimeId === dispatch.crimeId && crime?.id === dispatch.crimeId && crime.status === 'responding', 'response requires the same actual active dispatch/incident');
  assert(actor.needs.hunger >= 20 && actor.needs.fatigue >= 15 && actor.profile.health >= 35 && before.allowance > 0, 'original response body/allowance qualification');
  assert(witness.roadRejected === false && actor.state !== 'roadWaiting', 'original response road movement rejection');
  assert(Number.isFinite(before.pendingMinutes) && before.pendingMinutes >= 0 && Number.isFinite(before.attendance) && before.attendance >= 0, 'original finite deferred time/attendance');
  const elapsed = Number(before.pendingMinutes) + positive(witness.nativeMinutes, 'original phase minutes');
  positive(event.minutes, 'response credited minutes'); positive(event.amount, 'response earned amount'); positive(event.ratePerMinute, 'response frozen rate');
  close(event.creditedWorkStartAt, at - elapsed, 'response inherited deferred interval start');
  close(event.creditedWorkEndAt - event.creditedWorkStartAt, event.minutes, 'response actual credited interval');
  assert(event.minutes <= Math.min(elapsed, before.allowance, 480 - before.attendance) + EPS, 'original response work caps');
  close(witness.attendance - before.attendance, event.minutes, 'original response attendance writer');
  assert(witness.attendance <= 480 + EPS, 'original response daily attendance cap');
  close(claim.minutes - (before.claim?.minutes ?? 0), event.minutes, 'original public response claim minutes writer');
  close(claim.amount - (before.claim?.amount ?? 0), event.amount, 'original public response claim amount writer');
  close(claim.ratePerMinute, event.ratePerMinute, 'original public response frozen claim rate');
  close(event.amount, event.minutes * event.ratePerMinute, 'actual public response earned amount');
  const pointDistance = (a: Data, b: Data) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const route = witness.route as Data[], index = witness.routeIndex as number;
  assert(Array.isArray(route) && route.length > 0 && Number.isInteger(index) && index >= 0 && index <= route.length, 'actual response route and progress');
  assert([actor.position, crime.position, ...route].every(point => point && [point.x, point.y, point.z].every(Number.isFinite)), 'finite actual response body/route/incident');
  const arrived = index >= route.length, atCrime = arrived && pointDistance(actor.position, crime.position) <= 3;
  assert(!arrived || atCrime, 'a facility/exit route endpoint is not actual incident arrival');
  assert(['responding', 'physicalWaiting'].includes(actor.state), 'original response state at earned notification');
  const sameRoute = JSON.stringify(before.route) === JSON.stringify(route), displacement = pointDistance(before.actor.position, actor.position);
  let routeArcDistance: number | null = null;
  if (sameRoute && index >= before.routeIndex) {
    let position = before.actor.position; routeArcDistance = 0;
    for (let i = before.routeIndex; i < index; i++) { routeArcDistance += pointDistance(position, route[i]); position = route[i]; }
    routeArcDistance += pointDistance(position, actor.position);
  }
  // Waiting is recorded as waiting. Original dispatch policy can credit a
  // physical wait; neither canonical wage nor that policy proves movement or
  // incident arrival. It must never become an invented onsite/task receipt.
  const activity = atCrime ? 'public-response-at-actual-incident' : actor.state === 'physicalWaiting' ? 'public-response-physical-wait' : 'public-response-in-transit';
  return { ...clone(witness), activity, elapsed, sameRoute, displacement, routeArcDistance,
    nativeDistanceBudget: elapsed * witness.walkingSpeed, actualIncidentArrival: atCrime, employerArrivalRequiredByThisSource: false,
    sourceContract: 'Original people dispatch branch credits eligible public response elapsed, including deferred source time. It does not require presence at the employing police building.',
    inheritedTimeObservation: 'The original pending time and dispatch are retained; earlier source minutes are not claimed as newly observed minute-by-minute movement.' };
}

function observe(sim: Simulation, world: WorldDefinition) {
  let events: Data[] = [], phases: Data[] = [], beforePhase: Data | null = null, activePhase = 'outside-phase', previous = directCash(sim), started = false;
  let sequence = 0; const violations: Data[] = [], captureFailures: Data[] = [], seenLedger = new WeakSet<object>(), seenLifecycle = new WeakSet<object>();
  const newLedger: Data[] = [], earned = new Map<string, number>(), paid = new Map<string, number>();
  let baseline: { cash: ReturnType<typeof cashSnapshot>; food: ReturnType<typeof foodCustodySnapshot>; debt: ReturnType<typeof debtSnapshot>; fiscal: number; aliveIds: string[] };
  const totals = { foodProduced: 0, materialProduced: 0, storedMeals: 0, counterMeals: 0, playerMeals: 0, npcEarned: 0, npcPaid: 0,
    publicNpcPaid: 0, privateNpcPaid: 0, npcPaymentCount: 0, canonicalEarnedCount: 0, fullSettlementCount: 0, fiscalEvents: 0, fiscalLedger: 0, fiscalLifecycle: 0 };
  const maxima = { cash: 0, food: 0, debt: 0, fiscal: 0 };
  const shops = new Map(sim.state.shops.map(shop => [shop.id, shop.buildingId])), sites = new Map(world.buildings.map(site => [site.id, site]));
  let beforePeople: Data | null = null;
  const foodSite = (shopId: unknown) => typeof shopId === 'string' && ['farm', 'dock', 'market'].includes(sites.get(shops.get(shopId) ?? '')?.kind ?? '');
  const failObservation = (where: string, error: unknown, missing = false) => { const row = { where, tick: sim.state.tick, clock: minute(sim), error: errorText(error) }; violations.push(row); if (missing) captureFailures.push(row); };
  const safely = (where: string, action: () => void, missing = false) => { try { action(); } catch (error) { failObservation(where, error, missing); } };
  function collectLedger() {
    if (!started) return;
    for (const row of sim.state.extension!.publicLedger) if (!seenLedger.has(row)) {
      seenLedger.add(row); const retained = { ...clone(row), observedAt: minute(sim), phase: activePhase }; newLedger.push(retained);
      if (row.account === 'public' && !row.purpose.startsWith('城市') && row.sourceEvent !== 'transit-fare' && row.sourceEvent !== 'utility-payment'
        && row.purpose !== '能源维修实际工业材料采购') totals.fiscalLedger += row.amount;
    }
    for (const row of sim.state.shopLifecycle?.receipts ?? []) if (!seenLifecycle.has(row)) {
      seenLifecycle.add(row); if (row.payeeId === 'public') { assert(row.kind === 'capital', 'unexpected lifecycle public source'); totals.fiscalLifecycle += row.amount; }
    }
  }
  function stable(phase: string) {
    collectLedger(); const cash = cashSnapshot(sim, world), food = foodCustodySnapshot(sim, world), debt = debtSnapshot(runtime(sim));
    const fiscal = sim.state.treasury + runtime(sim).taxes;
    const residual = { cash: cash.total - baseline.cash.total, food: food.total - (baseline.food.total + totals.foodProduced - totals.storedMeals - totals.counterMeals - totals.playerMeals),
      debt: debt.total - (baseline.debt.total + totals.npcEarned - totals.npcPaid), fiscal: fiscal - baseline.fiscal - totals.fiscalEvents - totals.fiscalLedger - totals.fiscalLifecycle };
    const current = beforePhase ? naturalState(sim) : null, workChanges = beforePhase && current ? current.citizens.flatMap(actor => {
      const old = beforePhase!.citizens.find((item: Data) => item.id === actor.id); return old && old.workId !== actor.workId ? [{ before: old, after: actor }] : [];
    }) : [];
    const batches = phase === 'commerce' && beforePhase && current && beforePhase.at >= beforePhase.schedule.commerceAt ? beforePhase.shops.filter((shop: Data) => ['farm', 'dock', 'workshop'].includes(shop.buildingKind)).map((shop: Data) => ({
      shopId: shop.id, kind: shop.buildingKind, laborTakenByOriginalDueBatch: shop.labor, poweredLaborBeforeBatch: shop.poweredLabor, inventoryBeforeWholeCommerce: shop.inventory,
      originalTargetInventory: 120, stockAtLeastTargetBeforeCommerce: shop.inventory >= 120, actualAfter: current.shops.find(item => item.id === shop.id),
      actualPositiveProductionReceipts: events.filter(item => item.phase === phase && item.event?.type === 'production' && item.event.shopId === shop.id).map(item => item.production),
      attribution: 'Original due commerce deletes each labor entry; whole-phase stock may also move in real supply/retail transactions. No inferred positive output or claim that stock>=120 forbids all hiring.' })) : [];
    const row = { phase, tick: sim.state.tick, clock: minute(sim), cash, food, debt, fiscal, residual, totals: { ...totals },
      publicBudget: sim.publicBudgetSnapshot(), publicBudgets: clone(runtime(sim).publicBudgets ?? []), before: beforePhase, after: current,
      newLedger: newLedger.splice(0), workChanges, productionBatches: batches, peopleWorkBefore: phase === 'people' ? beforePeople : null, completeOriginalPhaseReturned: true };
    phases.push(row); for (const key of Object.keys(maxima) as (keyof typeof maxima)[]) maxima[key] = Math.max(maxima[key], Math.abs(residual[key]));
    // These errors are retained until after the ordinary step and its originals.
    safely('stable-' + phase + '-conservation', () => {
      for (const [name, value] of Object.entries(residual)) close(value, 0, 'complete stable ' + name);
      const initialDebt = new Map(baseline.debt.byEmployer.map(item => [JSON.stringify([item.citizenId, item.shopId]), item.total]));
      const actualDebt = new Map(debt.byEmployer.map(item => [JSON.stringify([item.citizenId, item.shopId]), item.total]));
      for (const key of new Set([...initialDebt.keys(), ...actualDebt.keys(), ...earned.keys(), ...paid.keys()])) close(actualDebt.get(key) ?? 0,
        (initialDebt.get(key) ?? 0) + (earned.get(key) ?? 0) - (paid.get(key) ?? 0), 'saved-employer debt ' + key);
      for (const id of baseline.aliveIds) assert(sim.state.extension!.actorProfiles[id]?.alive === true, 'baseline resident died: ' + id);
    });
  }
  const bus = Reflect.get(sim, 'bus') as { emit(event: RawEvent): void }, originalEmit = bus.emit;
  bus.emit = event => {
    const parentPhase = activePhase; let systemPhase: string | null = null, originalCaptured = false;
    const receipt: Data = { sequence: sequence++, phase: activePhase, tick: sim.state.tick, clock: minute(sim), extensionClock: sim.state.extension?.lastUpdate };
    events.push(receipt);
    safely('event-original-' + receipt.sequence, () => { receipt.typedOriginal = typedOriginal(event); receipt.event = clone(event); originalCaptured = true;
      const type = Object.getOwnPropertyDescriptor(event, 'type')!.value; assert(typeof type === 'string'); systemPhase = type.startsWith('system:') ? type.slice(7) : null;
      if (systemPhase) activePhase = systemPhase; receipt.phase = activePhase;
    }, true);
    safely('event-source-' + receipt.sequence, () => {
      if (!originalCaptured) return;
      collectLedger(); const now = directCash(sim), amount = Number(event.amount ?? 0), taxRate = sim.state.taxRate;
      receipt.taxRate = taxRate; receipt.taxQueueBeforeForward = now.taxes; receipt.treasuryBeforeForward = now.treasury;
      receipt.canonicalNpcWage = isCanonicalNpcWage(event, sim); const full = getCanonicalNpcFullSettlement(event, sim); receipt.fullSettlement = full ? clone(full) : null;
      if (started && event.type === 'wage-earned' && event.citizenId !== 'player') {
        assert(receipt.canonicalNpcWage, 'uncertified NPC earned event'); positive(event.amount, 'earned gross'); positive(event.minutes, 'earned minutes');
        close(amount, Number(event.minutes) * Number(event.ratePerMinute), 'frozen earned rate');
        close(Number(event.creditedWorkEndAt) - Number(event.creditedWorkStartAt), Number(event.minutes), 'actual earned interval');
        const actor = sim.state.citizens.find(item => item.id === event.citizenId)!; assert(actor && actor.workId === event.siteId);
        const site = sites.get(actor.workId)!; assert(site, 'earned original employer entity');
        const assignment = event.shopId ? runtime(sim).privateLabor?.shifts[event.shopId as string]?.assignments.find((item: Data) => item.citizenId === actor.id)
          : runtime(sim).publicLabor?.shifts.find((shift: Data) => shift.day === sim.state.day)?.assignments.find((item: Data) => item.citizenId === actor.id);
        receipt.attendance = { actor: body(sim, actor), siteId: site.id, siteKind: site.kind, assignment: clone(assignment ?? null), attendance: runtime(sim).attendance[actor.id], shopLabor: runtime(sim).shopLabor?.[event.shopId as string] ?? null };
        const key = JSON.stringify([actor.id, typeof event.shopId === 'string' ? event.shopId : null]); earned.set(key, (earned.get(key) ?? 0) + amount);
        totals.npcEarned += amount; totals.canonicalEarnedCount++;
        // Account the actual canonical debt writer even if an independent
        // presence audit fails. Its latched violation still fails the run;
        // omitting a real earned row would manufacture a second debt residual.
        const dispatch = runtime(sim).dispatches[actor.id];
        if (dispatch) {
          const claim = runtime(sim).wageAccruals.find((item: Data) => item.citizenId === actor.id && item.workId === actor.workId);
          const responseWitness: Data = { canonical: receipt.canonicalNpcWage, event: clone(event), actor: body(sim, actor), employer: clone(site),
            at: sim.state.extension!.lastUpdate, nativeMinutes: Reflect.get(sim, 'minutes'), before: beforePeople?.dispatchActors[actor.id],
            dispatch: clone(dispatch), crime: clone(sim.state.crimes.find(item => item.id === dispatch.crimeId)), kit: clone(runtime(sim).policeSupplies?.kits[dispatch.crimeId] ?? null),
            attendance: runtime(sim).attendance[actor.id], claim: clone(claim), route: clone(actor.route ?? []), routeIndex: actor.routeIndex ?? 0,
            roadRejected: (Reflect.get(sim, 'citizenRoadMovementRejected') as WeakSet<Citizen>).has(actor), walkingSpeed: sim.state.weather === '雨' ? 3.1 : 4.2,
            npcStairCursor: clone(runtime(sim).npcStairCursors?.[actor.id] ?? null), rider: clone(runtime(sim).riders?.[actor.id] ?? null) };
          receipt.publicResponseSource = clone(responseWitness); receipt.publicResponse = auditPublicResponseEarned(responseWitness);
        } else assert(sim.isNearBuilding(site, actor.position, 2), 'earned actual onsite arrival');
      }
      if (started && event.type === 'wage-paid' && event.citizenId !== 'player' && amount > 0) {
        positive(event.amount, 'paid gross'); const actorId = String(event.citizenId), shopId = typeof event.shopId === 'string' ? event.shopId : null;
        const tax = amount * taxRate, net = amount - tax, payerBefore = shopId ? previous.shops[shopId].funds : previous.treasury, payerAfter = shopId ? now.shops[shopId].funds : now.treasury;
        close(now.wallets[actorId] - previous.wallets[actorId], net, 'original NPC net wallet writer'); close(payerBefore - payerAfter, amount, 'original employer gross writer');
        close(now.taxes - previous.taxes, tax, 'original wage tax writer'); assert(amount <= Number(event.requestedAmount) + EPS);
        receipt.payment = { citizenId: actorId, shopId, gross: amount, requested: event.requestedAmount, net, tax, taxRate,
          payerBefore, payerAfter, walletBefore: previous.wallets[actorId], walletAfter: now.wallets[actorId], taxQueueBefore: previous.taxes, taxQueueAfter: now.taxes };
        if (full) { assert.equal(full.amount, amount); assert.equal(full.requestedAmount, amount); totals.fullSettlementCount++; }
        const key = JSON.stringify([actorId, shopId]); paid.set(key, (paid.get(key) ?? 0) + amount); totals.npcPaid += amount; totals.npcPaymentCount++;
        if (shopId) totals.privateNpcPaid += amount; else totals.publicNpcPaid += amount;
        totals.fiscalEvents += tax - (shopId ? 0 : amount);
      }
      if (started && event.type === 'production') {
        positive(event.amount, 'positive original production'); positive(event.minutes, 'positive original production labor');
        const shopId = String(event.shopId), site = sites.get(shops.get(shopId) ?? '')!; assert(site, 'classified producer');
        receipt.production = { siteId: site.id, kind: site.kind, laborMinutes: event.minutes, inventoryAfter: now.shops[shopId].inventory,
          inventoryBeforeActualPositiveWriter: now.shops[shopId].inventory - amount, amount };
        if (foodSite(shopId)) totals.foodProduced += amount; else { assert.equal(site.kind, 'workshop'); totals.materialProduced += amount; }
      }
      if (started && event.type === 'stored-meal') totals.storedMeals += positive(event.amount, 'actual carried meal');
      if (started && event.type === 'food-consumed') { assert.equal(event.citizenId, 'player'); totals.playerMeals += positive(event.amount, 'actual player meal'); }
      if (started && event.type === 'sale') { if (foodSite(event.shopId) && typeof event.citizenId === 'string' && event.citizenId !== 'player') totals.counterMeals++; totals.fiscalEvents += amount * taxRate; }
      if (started && event.type === 'wholesale') { totals.fiscalEvents += amount * taxRate;
        const shopId = String(event.shopId); positive(event.amount, 'original wholesale gross'); close(now.shops[shopId].funds - previous.shops[shopId].funds, amount * (1 - taxRate), 'actual wholesale supplier net writer');
        positive(event.quantity, 'original wholesale quantity');
        // Consignment settlements preserve their actual gross and quantity but
        // do not publish a unitPrice field. Never supply a synthetic quote.
        if (event.unitPrice !== undefined) close(amount, Number(event.quantity) * positive(event.unitPrice, 'original wholesale quote'), 'original wholesale gross/quantity/quote');
        receipt.supplier = { shopId, gross: amount, net: amount * (1 - taxRate), quantity: event.quantity, unitPrice: event.unitPrice, observedGrossPerUnit: amount / Number(event.quantity),
          fundsBeforeLastBusBoundary: previous.shops[shopId]?.funds, fundsAfterWriter: now.shops[shopId]?.funds, stockBeforeLastBusBoundary: previous.shops[shopId]?.inventory, stockAfterWriter: now.shops[shopId]?.inventory,
          attribution: 'Original seller receipt; this payload has no universal buyer or vehicle-delivery ID.' }; }
      if (started && event.type === 'business-expense') totals.fiscalEvents += amount;
      if (started && event.type === 'transit-fare') totals.fiscalEvents += amount;
      if (started && ['public-procurement', 'security-procurement', 'emergency-procurement', 'medical-procurement', 'civic-procurement'].includes(event.type)) {
        const shopId = String(event.shopId), tax = amount * taxRate; positive(event.amount, 'actual public procurement');
        close(previous.treasury - now.treasury, amount, 'actual public payer'); close(now.shops[shopId].funds - previous.shops[shopId].funds, amount - tax, 'actual aliased supplier net');
        close(now.taxes - previous.taxes, tax, 'actual procurement tax'); close(previous.shops[shopId].inventory - now.shops[shopId].inventory, Number(event.quantity), 'actual supplier material');
        close(amount, Number(event.quantity) * Number(event.unitPrice), 'actual original procurement quote');
        receipt.procurement = { payerBefore: previous.treasury, payerAfter: now.treasury, supplierBefore: previous.shops[shopId], supplierAfter: now.shops[shopId], taxQueueBefore: previous.taxes, taxQueueAfter: now.taxes, taxRate,
          budget: clone(runtime(sim).publicBudgets?.find((item: Data) => item.id === event.budgetId) ?? null) };
        totals.fiscalEvents += tax - amount;
      }
      if (started && (event.type === 'roadwork-wage-paid' || event.type === 'wage-paid' && event.citizenId === 'player')) totals.fiscalEvents += amount * taxRate;
      if (started && systemPhase && ['people', 'commerce', 'finance', 'security', 'politics'].includes(systemPhase)) beforePhase = naturalState(sim);
      if (started && systemPhase === 'people') {
        const r = runtime(sim); beforePeople = { at: sim.state.extension!.lastUpdate, nativeMinutes: Reflect.get(sim, 'minutes'), dispatchActors: Object.fromEntries(sim.state.citizens.flatMap(actor => {
          const dispatch = r.dispatches[actor.id]; if (!dispatch) return [];
          return [[actor.id, { actor: body(sim, actor), dispatch: clone(dispatch), crime: clone(sim.state.crimes.find(item => item.id === dispatch.crimeId)),
            kit: clone(r.policeSupplies?.kits[dispatch.crimeId] ?? null), pendingMinutes: r.peopleElapsed?.[actor.id] ?? 0, attendance: r.attendance[actor.id] ?? 0,
            allowance: (Reflect.get(sim, 'policeWorkAllowance') as (actor: Citizen) => number).call(sim, actor),
            claim: clone(r.wageAccruals?.find((item: Data) => item.citizenId === actor.id && item.workId === actor.workId) ?? null),
            route: clone(actor.route ?? []), routeIndex: actor.routeIndex ?? 0, npcStairCursor: clone(r.npcStairCursors?.[actor.id] ?? null), rider: clone(r.riders?.[actor.id] ?? null) }]];
        })) };
      }
      previous = now;
    });
    // Observational failures never interrupt a native writer. Native exceptions
    // retain their original object/stack and propagate unchanged.
    let returned = false;
    try { originalEmit.call(bus, event); returned = true; }
    finally {
      safely('event-after-' + receipt.sequence, () => { receipt.originalEmitReturned = returned; receipt.typedAfterOriginalHandlers = typedOriginal(event); collectLedger(); const now = directCash(sim);
        if (started && originalCaptured && returned && ['sale', 'wholesale'].includes(event.type)) {
          receipt.nativeTaxHandler = { before: receipt.taxQueueBeforeForward, after: now.taxes, expected: Number(event.amount) * receipt.taxRate };
          close(now.taxes - receipt.taxQueueBeforeForward, Number(event.amount) * receipt.taxRate, 'original sale/wholesale tax queue handler');
        }
        if (started && originalCaptured && returned && ['business-expense', 'transit-fare'].includes(event.type)) close(now.treasury - receipt.treasuryBeforeForward, Number(event.amount), 'original public receipt handler');
        previous = now;
      }, true);
      if (returned && started && systemPhase) { const phase = systemPhase; safely('stable-' + phase, () => stable(phase), true); }
      if (systemPhase) { activePhase = parentPhase; beforePhase = null; }
    }
  };
  return {
    totals, maxima, violations, captureFailures,
    start() { started = true; for (const row of sim.state.extension!.publicLedger) seenLedger.add(row); for (const row of sim.state.shopLifecycle?.receipts ?? []) seenLifecycle.add(row);
      previous = directCash(sim); baseline = { cash: cashSnapshot(sim, world), food: foodCustodySnapshot(sim, world), debt: debtSnapshot(runtime(sim)), fiscal: sim.state.treasury + runtime(sim).taxes,
        aliveIds: sim.state.citizens.filter(actor => sim.state.extension!.actorProfiles[actor.id].alive).map(actor => actor.id) }; return clone(baseline); },
    current() { return { events, phases, violations: clone(violations), captureFailures: clone(captureFailures), totals: { ...totals }, maxima: { ...maxima } }; },
    clearFrame() { events = []; phases = []; beforePhase = null; beforePeople = null; },
  };
}

export const ROOT24_ECONOMY_RESUME_PLAN = Object.freeze({ status: 'NOT_RUN', inputWorldSHA256: WORLD_SHA, inputFullSaveSHA256: SAVE_SHA,
  scope: 'Original default World291 and exact v4 main day2 17:00 full save; one natural next day. No ROOT23 energy fixture or state injection.',
  command: 'node --max-old-space-size=3072 --import tsx scripts/economy-resume-actual.ts --out <NEW absolute dir> --world <original> --save <4610 original> --plan <ROOT-EXECUTION-PLAN.json>',
  caps: { windows: MAX_WINDOWS, physicalEvidenceBytes: MAX_BYTES, beforeNewStepFreeEvidenceBytes: NEXT_STEP_RESERVE, wallMilliseconds: WALL_MS, ordinaryWorkMilliseconds: ORDINARY_WALL_MS },
  originalResources: { liveUTF16chars: LIVE_SAVE_CHARACTER_LIMIT, civicArchiveUTF8bytes: CIVIC_ARCHIVE_BYTE_LIMIT, fullUTF16chars: FULL_SAVE_CHARACTER_LIMIT, visited: 2_000_000, depth: 24 },
  failurePolicy: 'Immediately seal every completed whole save/full typed bus/phase originals; retain prior evidence. Unknown invalid frontier/ALLbus bounds do not prohibit execution and are not guaranteed. Missing/unverified originals produce EVIDENCE_INCOMPLETE.',
});

export async function runEconomyResumeActual(output: string, worldPath: string, savePath: string, rootPlanPath: string) {
  const out = resolve(output), began = Date.now(); assert.equal(output, out, 'explicit absolute output'); assert(!existsSync(out), 'never overwrite a prior run'); mkdirSync(out, { recursive: false });
  let bytes = 0, calls = 0, completed = 0, nativeReturnedWindows = 0, readers = 0, constructors = 0, imports = 0, commands = 0, missing: Data[] = [], sim: Simulation | undefined, observer: ReturnType<typeof observe> | undefined;
  const frames: Frame[] = [], rawBusHash = createHash('sha256'), encodedBusHash = createHash('sha256'); let rawBusBytes = 0, busMembers = 0;
  let inputs: ReturnType<typeof sourceHashes> | undefined, terminalParts: unknown = null, lastRaw = '', outcome = 'FAILED', failure: unknown = null;
  let windowsToRun = MAX_WINDOWS, inheritedClock = 3900, inheritedTick = 1710, inheritedSpeed = 8, inheritedFood = 15814.241185989758, continuation: Data | null = null;
  let acceptedSaveSHA = SAVE_SHA;
  const hardGuard = () => { if (Date.now() - began >= WALL_MS) throw new ResourceStop('1800-second owned leaf wall cap'); };
  const write = (file: string, raw: string | Buffer, append = false) => {
    hardGuard(); const data = typeof raw === 'string' ? Buffer.from(raw) : raw;
    if (bytes + data.byteLength > MAX_BYTES) throw new ResourceStop('2GiB physical original evidence cap: ' + file);
    const path = join(out, file); mkdirSync(dirname(path), { recursive: true }); const offset = append && existsSync(path) ? statSync(path).size : 0;
    try { writeFileSync(path, data, { flag: append ? 'a' : 'wx' }); }
    finally { if (existsSync(path)) bytes += statSync(path).size - offset; }
    const fd = openSync(path, 'r'); try { const disk = Buffer.alloc(data.byteLength); assert.equal(readSync(fd, disk, 0, disk.byteLength, offset), disk.byteLength); assert.equal(sha(disk), sha(data)); } finally { closeSync(fd); }
    hardGuard();
  };
  const json = (file: string, value: unknown) => write(file, JSON.stringify(value, null, 2) + '\n');
  const compressed = (file: string, raw: string): Original => {
    const encoded = gzipSync(Buffer.from(raw)); write(file, encoded); const disk = readFileSync(join(out, file)); assert.equal(gunzipSync(disk).toString('utf8'), raw);
    return { file, encoding: 'gzip-utf8', rawBytes: Buffer.byteLength(raw), rawChars: raw.length, rawSHA256: sha(raw), encodedBytes: disk.byteLength, encodedSHA256: sha(disk) };
  };
  const attempt = <T>(label: string, action: () => T): T | null => { try { return action(); } catch (error) { missing.push({ label, error: errorText(error) }); return null; } };
  function persistFrame(label: string, completeWindow: boolean): { frame: Frame; raw: string } {
    assert(sim && observer); const state = sim.state, captured = observer.current(), prefix = 'frames/' + String(frames.length).padStart(4, '0') + '-' + label;
    const raw = attempt(prefix + '/whole-save', () => sim!.exportSave()) ?? ''; if (raw) lastRaw = raw;
    const frame: Frame = { label, tick: state.tick, clock: minute(sim), completeWindow, save: null, bus: null, phases: null, eventCount: captured.events.length, missing: [] };
    const firstMissing = missing.length;
    if (raw) frame.save = attempt(prefix + '/whole-save.json.gz', () => compressed(prefix + '/whole-save.json.gz', raw));
    else frame.missing.push('whole-save-export');
    const busRaw = attempt(prefix + '/all-bus-serialization', () => JSON.stringify({ label, events: captured.events }) + '\n');
    if (busRaw !== null) {
      frame.bus = attempt(prefix + '/all-bus.json.gz', () => compressed(prefix + '/all-bus.json.gz', busRaw));
      attempt(prefix + '/ALL-BUS-stream-member', () => { const encoded = gzipSync(Buffer.from(busRaw)); write('ALL-BUS.jsonl.gz', encoded, true); rawBusHash.update(busRaw); encodedBusHash.update(encoded); rawBusBytes += Buffer.byteLength(busRaw); busMembers++; return true; });
    }
    frame.phases = attempt(prefix + '/stable-phase-custody.json.gz', () => compressed(prefix + '/stable-phase-custody.json.gz', JSON.stringify({ label, phases: captured.phases, totals: captured.totals, maxima: captured.maxima,
      observerViolations: captured.violations, observerCaptureFailures: captured.captureFailures }) + '\n'));
    frame.missing.push(...missing.slice(firstMissing).map(row => row.label)); frames.push(frame);
    attempt(prefix + '/FRAME.json', () => json(prefix + '/FRAME.json', frame)); observer.clearFrame();
    return { frame, raw };
  }
  function readFrame(frame: Frame, raw: string) {
    assert(sim); assert(frame.save && frame.bus && frame.phases && frame.missing.length === 0, 'all full frame originals must be verified before analysis');
    const document = JSON.parse(raw), { civicHistory, ...liveState } = document.state;
    frame.resources = { fullUTF16chars: raw.length, fullUTF8bytes: Buffer.byteLength(raw), liveUTF16chars: document.version === 4 ? JSON.stringify({ ...document, state: liveState }).length : raw.length,
      civicArchiveUTF8bytes: document.version === 4 ? Buffer.byteLength(JSON.stringify(civicHistory)) : 0, ...treeSize(document) };
    validateSaveResources(document, raw); const resources = frame.resources as Data;
    assert(resources.fullUTF16chars <= FULL_SAVE_CHARACTER_LIMIT && resources.liveUTF16chars <= LIVE_SAVE_CHARACTER_LIMIT && resources.civicArchiveUTF8bytes <= CIVIC_ARCHIVE_BYTE_LIMIT);
    assert(resources.visited <= 2_000_000 && resources.depth <= 24, 'unchanged whole native structural resources');
    frame.reader = sim.validateSave(raw); readers++; assert((frame.reader as Data).ok, (frame.reader as Data).message); assert.equal(sim.exportSave(), raw, 'native preview leaves whole live save exact');
    if (frame.label !== 'constructor') { assert.equal(document.version, 4); assert.equal(document.rulesetId, 'civic-local-v1'); assert.equal(document.motionVersion, 2);
      assert.equal(document.historyPolicyId, 'civic-history-pages-v1'); assert.equal(document.referenceCollisionPolicyId, 'continuous-upright-v1'); assert.equal(document.mealRoutePolicyId, 'nearby-food-v1');
      assert.equal(document.freightPickupPolicyId, 'road-food-pickup-v1'); assert.equal(document.freightDeliveryPolicyId, 'road-food-delivery-v1'); assert.equal(document.residentTuitionPolicyId, 'resident-formal-tuition-v1'); }
    assert(!sim.state.powerGrid && !sim.state.hydroMaintenance, 'no implicit default-city energy declaration');
    hardGuard();
  }
  async function verifyAllBus() {
    const path = join(out, 'ALL-BUS.jsonl.gz'), encoded = createHash('sha256'), decoded = createHash('sha256'); let decodedBytes = 0;
    for await (const chunk of createReadStream(path)) { hardGuard(); encoded.update(chunk as Buffer); }
    for await (const chunk of createReadStream(path).pipe(createGunzip())) { hardGuard(); const data = chunk as Buffer; decoded.update(data); decodedBytes += data.byteLength; }
    assert.equal(encoded.digest('hex'), encodedBusHash.copy().digest('hex')); assert.equal(decoded.digest('hex'), rawBusHash.copy().digest('hex')); assert.equal(decodedBytes, rawBusBytes);
    return { file: 'ALL-BUS.jsonl.gz', encoding: 'concatenated-gzip-members-of-complete-window-jsonlines', members: busMembers, rawBytes: rawBusBytes,
      rawSHA256: rawBusHash.copy().digest('hex'), encodedBytes: statSync(path).size, encodedSHA256: encodedBusHash.copy().digest('hex'), independentWindowOriginals: frames.map(frame => frame.bus) };
  }
  try {
    inputs = sourceHashes(); json('SOURCE-INPUTS-BEFORE.json', inputs); json('DRIVER-PLAN.json', ROOT24_ECONOMY_RESUME_PLAN);
    const worldBytes = readFileSync(worldPath), saveBytes = readFileSync(savePath), planBytes = readFileSync(rootPlanPath);
    const plan = JSON.parse(planBytes.toString('utf8'));
    if (plan.continuation !== undefined) {
      continuation = plan.continuation;
      assert(continuation); assert.equal(continuation.originalMainSHA256, SAVE_SHA); assert.equal(continuation.completePrefixWindows, 344);
      assert.equal(plan.inputFullSaveSHA256, NATIVE03_CHECKPOINT_344_SHA);
      assert.equal(sha(readFileSync(continuation.parentReceiptPath)), continuation.parentReceiptSHA256);
      const parent = JSON.parse(readFileSync(continuation.parentReceiptPath, 'utf8')); assert.equal(parent.status, 'FAIL'); assert(parent.inputsStable && parent.activeDescendants.length === 0);
      acceptedSaveSHA = NATIVE03_CHECKPOINT_344_SHA; windowsToRun = 16; inheritedClock = 5276; inheritedTick = 2054; inheritedSpeed = 16; inheritedFood = 15099.982228300692;
      json('EXACT-COLD-CONTINUATION.json', { ...continuation, checkpointSHA256: acceptedSaveSHA, ordinaryWindowsInThisRun: windowsToRun,
        originalRunPhysicalCalls: 345, thisRunRepeatsPreviouslyReturnedWindow345: true, fullDayPrimaryTimelineIsTwoColdSegments: true });
    }
    assert.equal(sha(worldBytes), WORLD_SHA); assert.equal(sha(saveBytes), acceptedSaveSHA); const world = JSON.parse(worldBytes.toString('utf8')) as WorldDefinition, inherited = JSON.parse(saveBytes.toString('utf8'));
    assert.equal(plan.inputWorldSHA256, WORLD_SHA); assert.equal(plan.inputFullSaveSHA256, acceptedSaveSHA); assert.equal(plan.maximumSuccessfulWindows, windowsToRun);
    assert.equal(plan.physicalEvidenceByteCap, MAX_BYTES); assert.equal(plan.beforeNextStepChosenFreeEvidenceBytes, NEXT_STEP_RESERVE);
    write('World.original.json', worldBytes); compressed('INPUT-MAIN.original.json.gz', saveBytes.toString('utf8')); write('ROOT-EXECUTION-PLAN.original.json', planBytes);
    json('INPUT-RECEIPTS.json', { world: { path: resolve(worldPath), bytes: worldBytes.length, sha256: sha(worldBytes) }, save: { path: resolve(savePath), bytes: saveBytes.length, sha256: sha(saveBytes) },
      plan: { path: resolve(rootPlanPath), bytes: planBytes.length, sha256: sha(planBytes) }, inputEnvelope: Object.fromEntries(Object.entries(inherited).filter(([key]) => !['state', 'runtime', 'routePool'].includes(key))) });
    assert.equal(world.buildings.length, 612); assert.equal(world.nodes.length, 674); assert.equal(world.edges.length, 691); assert(!world.powerGrid && !world.hydroMaintenance);
    constructors++; sim = new Simulation(clone(world)); observer = observe(sim, sim.worldDefinition);
    const constructed = persistFrame('constructor', false); readFrame(constructed.frame, constructed.raw);
    const imported = sim.importSave(saveBytes.toString('utf8')); imports++; assert(imported.ok, imported.message); assert.equal(sim.exportSave(), saveBytes.toString('utf8'), 'exact whole inherited4610 save before any command');
    assert.equal(sim.state.tick, inheritedTick); close(minute(sim), inheritedClock, 'inherited clock'); assert.equal(sim.state.speed, inheritedSpeed); assert.equal(sim.state.paused, false);
    assert.equal(sim.state.citizens.length, 616); assert.equal(sim.state.vehicles.length, 344); assert.equal(sim.state.shops.length, 210); assert.equal(runtime(sim).payrollAt, 5340);
    const baseline = observer.start(); close(baseline.cash.total, 280736.1579367216, 'original cash custody'); close(baseline.food.total, inheritedFood, 'original food custody');
    if (continuation) close(baseline.debt.total, 11015.462652842705, 'exact checkpoint owed NPC wages');
    assert.equal(baseline.aliveIds.length, 616); json('INHERITED-CUSTODY-BASELINE.json', baseline);
    const loaded = persistFrame('imported-main', false); readFrame(loaded.frame, loaded.raw);
    if (!continuation) {
    const speedBefore = sim.exportSave(), command = { type: 'speed' as const, value: 16 }; commands++;
    const result = sim.command(command); assert(result.ok, result.message);
    const expectedSpeed = JSON.parse(speedBefore); expectedSpeed.state.speed = 16;
    assert.equal(result.message, '时间倍率：16。');
    // The public success path calls notice(): one original event ID and the
    // exact bounded FIFO notice are part of this command's saved effects.
    const speedNotice = { id: ++expectedSpeed.runtime.eventId, tick: expectedSpeed.state.tick, type: 'speed', text: result.message };
    expectedSpeed.state.events.push(speedNotice);
    const removedNotice = expectedSpeed.state.events.length > 100 ? expectedSpeed.state.events.shift() : null;
    assert.equal(sim.exportSave(), JSON.stringify(expectedSpeed), 'only public speed and exact original notice/FIFO/eventId changed the full save');
    json('ONLY-PUBLIC-COMMAND.json', { command, result, speedNotice, removedNotice, beforeSHA256: sha(speedBefore), afterSHA256: sha(sim.exportSave()), focusPlacements: 0, injectedStateFields: 0 });
    const speedFrame = persistFrame('public-speed16', false); readFrame(speedFrame.frame, speedFrame.raw);
    }
    while (completed < windowsToRun) {
      if (Date.now() - began >= ORDINARY_WALL_MS) throw new ResourceStop('1740-second ordinary-work stop; keep actual frontier');
      const disk = statfsSync(out); if (MAX_BYTES - bytes < NEXT_STEP_RESERVE || disk.bavail * disk.bsize < NEXT_STEP_RESERVE) throw new ResourceStop('chosen256MiB actual evidence/free-disk reserve before next ordinary step');
      const beforeSave: string = lastRaw;
      const before: { tick: number; at: number; busMembers: number; bytes: number; fullSaveSHA256: string } = { tick: sim.state.tick, at: minute(sim), busMembers, bytes, fullSaveSHA256: sha(beforeSave) };
      const eventCursor: number = observer.current().events.length; assert.equal(eventCursor, 0);
      calls++; assert(calls <= windowsToRun); let nativeError: unknown = null;
      try { sim.step(.25); nativeReturnedWindows++; } catch (error) { nativeError = error; }
      const captured: { events: Data[]; phases: Data[] } = observer.current();
      const recorded = persistFrame('ordinary-' + String(calls).padStart(3, '0'), nativeError === null);
      if (nativeError) { json('NATIVE-STEP-FAILURE.json', { before, after: { tick: sim.state.tick, clock: minute(sim) }, originalError: errorText(nativeError),
        stateClassification: recorded.raw === beforeSave ? 'EXACT_WHOLE_SAVE_UNCHANGED_NATIVE_FAILURE' : 'WHOLE_SAVE_CHANGED_NATIVE_FAILURE', frame: recorded.frame }); throw nativeError; }
      assert.equal(sim.state.tick, before.tick + 1); close(minute(sim), before.at + 4, 'one ordinary publicspeed16 window');
      assert.deepEqual(sim.state.lastSystemOrder, ORDER); assert.deepEqual(captured.events.filter(row => row.event?.type?.startsWith('system:')).map(row => row.event.type.slice(7)), ORDER);
      assert.deepEqual(captured.phases.map(row => row.phase), ORDER, 'stable ten phases after all original handlers');
      readFrame(recorded.frame, recorded.raw); assert.equal(observer.violations.length, 0, 'captured observer violation; full original window retained');
      completed++;
      json('frames/' + String(frames.length - 1).padStart(4, '0') + '-ordinary-' + String(calls).padStart(3, '0') + '/ANALYSIS.json', recorded.frame);
      if (completed % 30 === 0) console.log(JSON.stringify({ kind: 'progress', completedOrdinaryWindows: completed, attemptedOrdinaryCalls: calls, tick: sim.state.tick, clock: minute(sim), actualOriginalBytes: bytes, elapsedSeconds: (Date.now() - began) / 1000 }));
    }
    assert.equal(completed, windowsToRun); assert.equal(sim.state.tick, 2070); close(minute(sim), 5340, 'genuine next-day17:00');
    assert(observer.totals.npcPaymentCount > 0 && observer.totals.npcPaid > 0, 'original17:00 actual finite NPC payment must occur');
    const terminal = sim.exportSave(); assert.equal(terminal, lastRaw); const parts = partitionSave(terminal, sim.worldDefinition), manifest = parts.map((part, index) => ({ id: part.id,
      original: compressed('terminal-parts/' + String(index).padStart(4, '0') + '.json.gz', part.json) }));
    const actualParts = manifest.map(item => { const encoded = readFileSync(join(out, item.original.file)), raw = gunzipSync(encoded).toString('utf8');
      assert.equal(sha(encoded), item.original.encodedSHA256); assert.equal(sha(raw), item.original.rawSHA256); return { id: item.id, json: raw }; });
    const assembled = assembleSave(actualParts); assert.equal(assembled, terminal, 'actual physicalparts exact whole native assembly');
    const omitted = actualParts.find(part => part.id.startsWith('chunk:') && JSON.parse(part.json).arrays && Object.keys(JSON.parse(part.json).arrays).length > 0); assert(omitted, 'actual array-carrying part');
    assert.throws(() => assembleSave(actualParts.filter(part => part !== omitted))); assert.equal(sim.exportSave(), terminal);
    terminalParts = { parts: manifest, assembledSHA256: sha(assembled), missingRealPartRejection: { id: omitted.id, rawSHA256: sha(omitted.json) }, extraImports: 0, extraSimulations: 0, extraSteps: 0 };
    json('TERMINAL-PHYSICAL-PARTS.json', terminalParts); json('TERMINAL-OBSERVATIONS.json', { natural: naturalState(sim), foodAccess: foodSnapshot(sim.state, new Map(world.buildings.map(site => [site.id, site]))),
      totals: observer.totals, maximumResidual: observer.maxima, literalJobs76Claimed: false, initialFarm120IsUniversalHiringBan: false, steadyStateClaimed: false });
    outcome = 'ACTUAL_COMPLETED';
  } catch (error) {
    failure = errorText(error); outcome = error instanceof ResourceStop ? 'PARTIAL' : 'FAILED';
    if (sim && observer) attempt('failure-frontier-complete-originals', () => persistFrame('failure-frontier', false));
  }
  const allBus = busMembers ? await (async () => { try { return await verifyAllBus(); } catch (error) { missing.push({ label: 'ALL-BUS-complete-stream-readback', error: errorText(error) }); return null; } })() : null;
  if (observer?.captureFailures.length) missing.push(...observer.captureFailures.map(row => ({ label: 'original-event-or-stable-phase-capture', ...row })));
  if (inputs) attempt('SOURCE-INPUTS-AFTER.json', () => { const after = sourceHashes(); json('SOURCE-INPUTS-AFTER.json', after); assert.deepEqual(after, inputs, 'source input bytes stable'); });
  attempt('ORIGINAL-INPUT-SHA-AFTER.json', () => { const world = readFileSync(worldPath), save = readFileSync(savePath); assert.equal(sha(world), WORLD_SHA); assert.equal(sha(save), acceptedSaveSHA); json('ORIGINAL-INPUT-SHA-AFTER.json', { worldSHA256: sha(world), saveSHA256: sha(save) }); });
  attempt('FRAMES.json', () => json('FRAMES.json', frames));
  if (missing.length && outcome === 'ACTUAL_COMPLETED') outcome = 'FAILED';
  const report: Data = { status: outcome, evidence: missing.length ? 'EVIDENCE_INCOMPLETE' : 'COMPLETE_ORIGINALS', failure, missingOriginals: missing,
    constructors, imports, attemptedOrdinaryCalls: calls, nativeReturnedOrdinaryWindows: nativeReturnedWindows, completedOrdinaryWindows: completed, targetClock: 5340, targetTick: 2070,
    actualClock: sim ? minute(sim) : null, actualTick: sim?.state.tick ?? null, readers, actualOriginalBytesBeforeResult: bytes,
    physicalEvidenceByteCap: MAX_BYTES, elapsedSeconds: (Date.now() - began) / 1000, onlyPublicCommands: commands, focusPlacements: 0, injectedBodiesMoneyNeedsStockRolesTime: 0,
    allBus, terminalParts, counts: observer?.totals ?? null, maximumResidual: observer?.maxima ?? null, observerViolations: observer?.violations ?? [],
    exactColdContinuation: continuation, ordinaryWindowsTargetInThisRun: windowsToRun, acceptedInputSaveSHA256: acceptedSaveSHA,
    scope: continuation ? 'Exact native03 complete checkpoint344 cold continuation:16 ordinary windows to17:00. Prefix344 and suffix16 are two cold segments, not one fresh Simulation/360 calls; window345 is a physical replay. No steadystate/art/Mac claim.' : 'Original defaultWorld291/main4610 next ordinary day only; no long-term steadystate, default hydro activation, reference-art or Mac claim.' };
  const resultPath = outcome === 'ACTUAL_COMPLETED' ? 'RESULT.json' : 'FAILURE.json';
  const resultWritten = attempt(resultPath, () => { hardGuard(); json(resultPath, report); hardGuard(); return true; });
  if (!resultWritten) { report.status = 'FAILED'; report.evidence = 'EVIDENCE_INCOMPLETE'; report.missingOriginals = missing; }
  console.log(JSON.stringify({ kind: 'ROOT24_ECONOMY_RESUME_ACTUAL', ...report, actualOriginalBytes: bytes })); return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (name: string) => { const index = args.indexOf(name); assert(index >= 0 && args[index + 1] && !args[index + 1].startsWith('--'), 'required ' + name); return args[index + 1]; };
  runEconomyResumeActual(value('--out'), value('--world'), value('--save'), value('--plan')).then(result => { if (result.status !== 'ACTUAL_COMPLETED') process.exitCode = 1; })
    .catch(error => { console.error(errorText(error)); process.exitCode = 1; });
}
