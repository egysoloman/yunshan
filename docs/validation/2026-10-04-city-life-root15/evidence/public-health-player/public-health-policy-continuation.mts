import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PerspectiveCamera } from 'three';
import { upgradeReferenceCollision } from './source/src/host/upgrade-reference-collision.ts';
import { upgradeMealRoute } from './source/src/host/upgrade-meal-route.ts';
import { PlayerController } from './source/src/controller.ts';
import { canAccessFloor } from './source/src/access.ts';
import { createArchivedProductCity } from './source/src/product-city.ts';
import { isCanonicalNpcWage } from './source/src/simulation.ts';
import { clinicalDoctorWorkWindows, clinicalDoctorUsedWorkWindows, clinicalPairAtServiceStation, clinicalVisitDeadline, clinicalHealthGain } from './source/src/simulation/clinical.ts';
import { assembleSave, partitionSave } from './source/src/persistence/partition.ts';
import { familyEducationHeldCash } from './source/src/simulation/family-education.ts';
import { shopLifecycleHeldCash } from './source/src/simulation/shop_lifecycle.ts';
import type { Command, Vec3, WorldDefinition } from './source/src/types.ts';

const out = process.argv[2]; assert(out); mkdirSync(out, { recursive: true });
const maxFrames = 512;
const base = new URL('.', import.meta.url);
const worldText = readFileSync(new URL('origins/world.json', base), 'utf8');
const originalRaw = readFileSync(new URL('origins/opening-policy-v4.save.json', base), 'utf8');
const originalBody = JSON.parse(originalRaw);
const prefixBase = new URL('actual03/artifacts/', base);
const inherited = (name: string) => JSON.parse(readFileSync(new URL(name, prefixBase), 'utf8'));
const prefixSummary = inherited('FAIL-summary.json');
assert.equal(prefixSummary.mainFrames, 240);
const raw = readFileSync(new URL('frontier.save.json', prefixBase), 'utf8');
const route = JSON.parse(readFileSync(new URL('ROUTE-PREP04.json', base), 'utf8'));
const world: WorldDefinition = JSON.parse(worldText);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const record = (name: string, value: unknown) => writeFileSync(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
assert.equal(hash(originalRaw), '8c5a8ae47daed0b3e4f45225c2a45ee7d5fdb2a83b95eee788cd07cd3e01b7aa');
assert.equal(hash(raw), '74b488c8e3c39d762b90613f50c2cf97aa34bd89c54ef8027ebdef2f4cdeccce');
assert.equal(hash(worldText), 'abce713388422385a3754fc8d760745526d95fdb4268546057e5a748d8df6ea1');
assert.equal(route.status, 'PASS'); assert.equal(route.originSHA256, hash(originalRaw));
record('origin.save.json', raw); record('original-opening-policy-v4.save.json', originalRaw);
record('inherited-prefix-bindings.json', Object.fromEntries(['frontier.save.json','trace-commands.json','trace-events.json','trace-wages.json','trace-frames.json','trace-care.json','trace-transitions.json','filing.save.json','FAIL-summary.json'].map(name => [name, hash(readFileSync(new URL(name, prefixBase), 'utf8'))]))); record('world.json', worldText);
const city = createArchivedProductCity(world);
assert.equal(city.importSave(raw).ok, true); assert.equal(city.exportSave(), raw);
assert.equal(city.referenceCollisionPolicyId, 'legacy'); assert.equal(city.mealRoutePolicyId, 'legacy');
const migrations: any[] = [];
for (const [operation, marker, upgrade] of [
  ['explicit-actual-terminal4-reference', 'referenceCollisionPolicyId', upgradeReferenceCollision],
  ['explicit-current4-after-reference-meal', 'mealRoutePolicyId', upgradeMealRoute]
] as const) {
  const before = city.exportSave(), expectedSHA256 = hash(before), result = await upgrade(city, expectedSHA256), after = city.exportSave();
  migrations.push({ operation, expectedSHA256, beforeSHA256: hash(before), afterSHA256: hash(after), result });
  record('migrations.json', migrations); record(`${operation}.before.save.json`, before); record(`${operation}.after.save.json`, after);
  assert(result.ok, result.message);
  const stripped = JSON.parse(after); delete stripped[marker]; delete stripped.runtime[marker];
  assert.equal(JSON.stringify(stripped), before, 'HOST changes exactly its two declarations, no business/rng/accumulator rewrite');
}
assert.equal(city.referenceCollisionPolicyId, 'continuous-upright-v1'); assert.equal(city.mealRoutePolicyId, 'nearby-food-v1');
const initial = structuredClone(city.state.player), initialProfile = structuredClone(city.state.extension!.actorProfiles.player), continuationInitial = structuredClone(city.state.player);
const initialClock = city.state.extension!.lastUpdate, initialTick = city.state.tick, continuationClock = city.state.extension!.lastUpdate, continuationTick = city.state.tick, originalSpeed = city.state.speed;
assert.equal(originalSpeed, 16); assert.deepEqual(world.spawn, originalBody.state.player.position);
const clinic = world.buildings.find(b => b.id === 'civic-0-clinic')!;
const clinicPoint = clinic.functionPoints!.find(p => p.floor === 0 && p.purpose === 'service')!.position;
const doctors = new Set(city.state.citizens.filter(p => p.workId === clinic.id && ['医生', 'doctor'].includes(p.role)).map(p => p.id));
const cashFor = (s: typeof city.state, rt: any) => {
  const e = s.extension!;
  return s.treasury + rt.taxes + s.player.money + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + (rt.investment ?? 0))
    + s.citizens.reduce((sum, p) => sum + p.money, 0)
    + s.shops.filter(shop => !e.companies.some(c => c.shopBindingReleasedAt === undefined && c.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0)
    + e.companies.reduce((sum, c) => sum + c.capital, 0) + e.organizations.reduce((sum, org) => sum + org.funds, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.roadworks?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.education?.course?.escrow ?? 0) + familyEducationHeldCash(s) + (s.power?.repairs.reduce((sum, job) => sum + job.escrow, 0) ?? 0)
    + (s.clinical?.orders.reduce((sum, order) => sum + order.escrow, 0) ?? 0) + shopLifecycleHeldCash(s)
    + (s.hygiene?.jobs.reduce((sum, job) => sum + job.escrow, 0) ?? 0) + (s.hygiene?.transfers?.tasks.reduce((sum, task) => sum + task.escrow, 0) ?? 0)
    + (s.family?.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0) ?? 0) + (s.family?.households?.reduce((sum, household) => sum + household.balance, 0) ?? 0);
};
const cash = () => cashFor(city.state, Reflect.get(city, 'runtime'));
const inputBody = JSON.parse(raw); const initialCash = cashFor(inputBody.state, inputBody.runtime); let maximumCashResidual = 0;
const commands: any[] = [], events: any[] = [], wages: any[] = [], frames: any[] = [], care: any[] = [], transitions: any[] = [];
let petitionId = prefixSummary.frontier.petition.id, lastTransition = '', mainFrames = 0, movedMeters = 0, mainPhaseMinutes = 0, beforeService = 0, beforeHealth = initialProfile.health;
const healthOrder = () => city.state.culture!.orders.find(o => o.petitionId === petitionId);
const snapshot = () => ({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, day: city.state.day, hour: city.state.hour,
  player: structuredClone(city.state.player), profile: structuredClone(city.state.extension!.actorProfiles.player),
  petition: structuredClone(city.state.culture!.petitions.find(p => p.id === petitionId)), order: structuredClone(healthOrder()),
  doctors: city.state.citizens.filter(p => doctors.has(p.id)).map(p => ({ id: p.id, state: p.state, position: p.position, needs: p.needs, money: p.money, health: city.state.extension!.actorProfiles[p.id].health })),
  treasury: city.state.treasury, budget: city.publicBudgetSnapshot(), materialSuppliers: city.state.shops.filter(s => city.shopCommodity(s) === 'materials').map(s => ({ id: s.id, inventory: s.inventory, cash: city.shopFunds(s), protectedCash: city.shopProtectedFunds(s) })) });
for (const name of ['sale', 'food-consumed', 'production', 'civic-procurement', 'public-procurement', 'public-health-consumed', 'hygiene-waste-generated', 'municipal-operation-accrual'] as const)
  city.onEvent(name, event => events.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, event: structuredClone(event) }));
city.onEvent('wage-earned', event => { if (doctors.has(event.citizenId!)) wages.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, canonical: isCanonicalNpcWage(event), event: structuredClone(event) }); });
city.onEvent('wage-paid', event => { if (doctors.has(event.citizenId!)) wages.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, event: structuredClone(event) }); });
city.onEvent('clinical-activity-window', event => { if (doctors.has(event.citizenId!)) wages.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, event: structuredClone(event) }); });
let collectCare = true;
city.onPhase('time', () => {
  mainPhaseMinutes = .25 * originalSpeed; beforeService = healthOrder()?.serviceMinutes.player ?? 0; beforeHealth = city.state.extension!.actorProfiles.player.health;
});
city.onPhase('people', () => {
  if (!collectCare) return;
  const order = healthOrder(); if (!order) return;
  const minutes = order.serviceMinutes.player ?? 0, increment = minutes - beforeService;
  if (increment > 1e-7) {
    const candidates = city.state.citizens.filter(p => doctors.has(p.id)).map(p => ({ id: p.id, state: p.state, position: structuredClone(p.position), needs: structuredClone(p.needs), health: city.state.extension!.actorProfiles[p.id].health,
      pairAtStation: clinicalPairAtServiceStation(city, clinic, p.id, 'player'), canonicalWages: wages.filter(r => r.tick === city.state.tick && r.canonical && r.event.citizenId === p.id && r.event.siteId === clinic.id),
      work: clinicalDoctorWorkWindows(city, p, clinic.id, mainPhaseMinutes, Math.max(order.scheduledAt, order.approvedAt ?? 0, order.receipts[0]?.purchasedAt ?? 0)),
      used: clinicalDoctorUsedWorkWindows(city, p.id) }));
    const actual = candidates.filter(p => p.pairAtStation && p.work.length && p.used.length);
    assert(actual.length > 0, 'patient care needs a current real funded on-site doctor window');
    assert(actual.some(p => p.canonicalWages.reduce((sum, r) => sum + r.event.minutes, 0) + 1e-7 >= increment), 'actual current core certified doctor wages cover patient credit');
    assert(actual.some(p => p.used.reduce((sum, w) => sum + w.end - w.start, 0) + 1e-7 >= increment), 'observed patient credit must be covered by real doctor claimed clock');
    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    const player = city.state.player, profile = city.state.extension!.actorProfiles.player;
    const ordinaryHealthRate = .001 + (clinicalHealthGain(city.state) - 25) * .0003 - clamp((20 - player.needs.hunger) * 3) * .00009 - clamp((25 - player.needs.fatigue) * 2) * .00006 - Math.max(0, profile.age - 75) * .0001 - (100 - city.state.extension!.environment.waterQuality) * .000007;
    care.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, phaseMinutes: mainPhaseMinutes, patientMinutes: minutes, increment,
      beforeHealth, ordinaryHealthRate, ordinaryHealthBeforeCare: clamp(beforeHealth + mainPhaseMinutes * ordinaryHealthRate), healthGain: clinicalHealthGain(city.state), healthAfter: city.state.extension!.actorProfiles.player.health, patientPosition: structuredClone(city.state.player.position), patientNeeds: structuredClone(city.state.player.needs), candidates, publicConsumed: order.consumedUnits });
  }
});
const checkCash = () => { const residual = cash() - initialCash; maximumCashResidual = Math.max(maximumCashResidual, Math.abs(residual)); assert(Math.abs(residual) < 1e-6, `real cash conservation ${residual}`); };
const flush = () => { record('trace-commands.json', commands); record('trace-events.json', events); record('trace-wages.json', wages); record('trace-frames.json', frames); record('trace-care.json', care); record('trace-transitions.json', transitions); record('frontier.save.json', city.exportSave()); record('frontier.summary.json', snapshot()); };
const command = (c: Command) => {
  const before = { tick: city.state.tick, clock: city.state.extension!.lastUpdate, player: structuredClone(city.state.player), profile: structuredClone(city.state.extension!.actorProfiles.player), treasury: city.state.treasury, ledgerCount: city.state.extension!.publicLedger.length };
  const result = city.command(c), after = { player: structuredClone(city.state.player), profile: structuredClone(city.state.extension!.actorProfiles.player), treasury: city.state.treasury, ledger: city.state.extension!.publicLedger.slice(before.ledgerCount) };
  commands.push({ command: c, before, result, after }); checkCash(); return { result, before, after };
};
let now = inherited('trace-frames.json').at(-1).now;
const keys = Object.assign(new EventTarget(), { closest: () => null }), canvas = new EventTarget(), doc = Object.assign(new EventTarget(), { pointerLockElement: canvas });
const originals = Object.fromEntries(['window', 'document', 'performance'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { value: keys, configurable: true }); Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => now, timeOrigin: 1_700_000_000_000 }, configurable: true });
const controller = new PlayerController(new PerspectiveCamera(), canvas as HTMLCanvasElement, world, () => {}, (b, f) => canAccessFloor(b, f, city.state.player), () => city.state.voxels, () => city.state);
assert.deepEqual(controller.position, world.spawn, 'unchanged canonical constructor spawn');
assert.equal(controller.setMode('walk', continuationInitial.position), true, 'normal load restores only the genuine persisted player position');
assert.deepEqual(controller.position, continuationInitial.position, 'no arbitrary destination relocation');
const input = (type: string, values: Record<string, unknown>) => { const e = new Event(type); Object.assign(e, values); Object.defineProperty(e, 'timeStamp', { value: now }); keys.dispatchEvent(e); };
const eatIfNeeded = () => {
  if (city.state.player.needs.hunger >= 48 || (city.state.player.inventory.food ?? 0) < 1) return;
  const r = command({ type: 'eat', targetId: 'food' }); assert(r.result.ok, r.result.message);
  assert.equal(r.after.player.inventory.food, r.before.player.inventory.food! - 1); assert.equal(r.after.player.needs.hunger, Math.min(100, r.before.player.needs.hunger + 52));
};
const frame = (delta: number, target?: Vec3) => {
  assert(delta > 0 && delta <= 1); assert(mainFrames < maxFrames, 'NEW fixed512 original quarter-second main-frame bound');
  const before = controller.position, oldClock = city.state.extension!.lastUpdate, oldTick = city.state.tick, oldAccumulator = Reflect.get(city, 'runtime').accumulator; now += delta * 1000;
  controller.stepWalkingFrame(now, delta, false, city.state.paused);
  city.state.player.position = controller.walkingPosition;
  city.setFocus(controller.position, controller.mode);
  city.step(delta); mainFrames++;
  assert.equal(city.state.speed, originalSpeed); assert.equal(city.state.paused, false);
  const actualTicks = city.state.tick - oldTick; assert.equal(actualTicks, 1, 'each NEW main .25 frame is exactly one original tick'); const accumulatorAfter = Reflect.get(city, 'runtime').accumulator;
  assert(Math.abs(city.state.extension!.lastUpdate - oldClock - actualTicks * .25 * originalSpeed) < 1e-6, 'only original fixed ticks advance clock');
  assert(Math.abs(oldAccumulator + delta - actualTicks * .25 - accumulatorAfter) < 1e-7, 'ordinary main delta is preserved by original fixed-tick accumulator');
  assert.deepEqual(city.state.player.position, controller.walkingPosition, 'published physical motor position only');
  const moved = Math.hypot(controller.position.x - before.x, controller.position.z - before.z); movedMeters += moved;
  frames.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, now, delta, actualTicks, accumulatorBefore: oldAccumulator, accumulatorAfter, from: before, to: controller.position, target, meters: moved });
  const s = snapshot(), key = JSON.stringify({ petition: s.petition, order: s.order }); if (key !== lastTransition) { lastTransition = key; transitions.push(s); }
  checkCash(); if (mainFrames % 16 === 0) { flush(); console.log(JSON.stringify({ scope: 'NEW actual-terminal-policy-public-health-player', frame: mainFrames, tick: s.tick, clock: s.clock, playerHealth: s.profile.health, playerNeeds: s.player.needs, petitionStatus: s.petition?.status, signers: s.petition?.signerIds, orderState: s.order?.state, consumed: s.order?.consumedUnits, playerCareMinutes: s.order?.serviceMinutes.player ?? 0 })); }
};

try {
  const petition = city.state.culture!.petitions.find(p => p.id === petitionId)!;
  const originalOrder = healthOrder()!;
  assert.equal(petition.authorId, 'player'); assert.equal(petition.replyAt, petition.filedAt + 1440); assert(petition.answeredAt! >= petition.replyAt);
  assert.equal(originalOrder.id, 'service-2'); assert.equal(originalOrder.topic, 'health'); assert.equal(originalOrder.state, 'awaitingSupply');
  assert.equal(originalOrder.authorizedCap, 40); assert.equal(originalOrder.spent, 0); assert.equal(originalOrder.receivedUnits, 0); assert.equal(originalOrder.consumedUnits, 0);
  assert.equal(originalOrder.targetUnits, 6); assert.equal(originalOrder.requiredMinutes, 20); assert.equal(city.state.player.inventory.food, 1);
  assert.equal(city.state.tick, continuationTick); assert.equal(city.state.extension!.lastUpdate, continuationClock); assert.deepEqual(city.state.player, continuationInitial);
  assert(Math.hypot(controller.position.x - clinicPoint.x, controller.position.y - clinicPoint.y, controller.position.z - clinicPoint.z) < .02);
  record('scope-start-after-two-HOST.save.json', city.exportSave());
  let lastRest = -Infinity;
  while (mainFrames < maxFrames) {
    eatIfNeeded();
    if (city.state.player.needs.fatigue < 55 && city.state.extension!.lastUpdate - lastRest >= 20 - 1e-7) {
      const r = command({ type: 'rest', targetId: clinic.id }); assert(r.result.ok, r.result.message); assert.equal(r.after.player.money, r.before.player.money - 15); assert.equal(r.after.treasury, r.before.treasury + 15); assert.equal(r.after.player.needs.fatigue, Math.min(100, r.before.player.needs.fatigue + 23)); lastRest = city.state.extension!.lastUpdate;
    }
    const order = healthOrder();
    if (order?.state === 'active' && !order.servedIds.includes('player') && city.state.culture!.playerServiceId !== order.id && city.state.player.needs.hunger >= 40 && city.state.player.needs.fatigue >= 35 && city.state.extension!.actorProfiles.player.health < 95 && clinicalVisitDeadline(city.state, 'player') <= city.state.extension!.lastUpdate) {
      const r = command({ type: 'attendService', targetId: order.id }); assert(r.result.ok, r.result.message); record('actual-attend.save.json', city.exportSave());
    }
    if (order?.servedIds.includes('player')) {
      const careDoctors = new Set(care.flatMap(r => r.candidates.filter((d: any) => d.pairAtStation && d.used.length).map((d: any) => d.id)));
      if (wages.some(r => r.event.type === 'wage-paid' && careDoctors.has(r.event.citizenId) && r.event.amount > 0 && r.clock >= care[0].clock)) break;
    }
    frame(.25);
  }
  flush(); const order = healthOrder()!, answered = city.state.culture!.petitions.find(p => p.id === petitionId)!;
  assert(answered.signerIds.length >= 3, 'three original real NPC signatures'); assert(answered.answeredAt! >= answered.replyAt, 'original 24h deadline');
  assert(order, 'original health service agenda'); assert.equal(order.targetUnits, 6); assert.equal(order.requiredMinutes, 20); assert.equal(order.authorizedCap, 40); assert(order.approvedBy.length === 2);
  assert(order.spent > 0 && order.spent <= 40); assert(order.receipts.length > 0); assert(order.receivedUnits >= order.consumedUnits); assert(order.consumedUnits <= 6);
  assert(order.servedIds.includes('player'), 'one genuine player public-health consumer'); assert.equal(order.serviceMinutes.player, 20); assert.equal(care.reduce((sum, r) => sum + r.increment, 0), 20);
  const sources = order.healthConsumptions!.filter(r => r.patientId === 'player'); assert.equal(sources.length, 1); const source = sources[0]; assert.equal(source.quantity, 1); assert.equal(source.minutes, 20);
  const batches = city.state.hygiene!.batches.filter(b => b.sourceReceipts.some(r => r.kind === 'public-health' && r.sourceId === source.id)); assert.equal(batches.length, 1); const batch = batches[0];
  assert.equal(batch.sourceKind, 'public-health'); assert.equal(batch.patientId, 'player'); assert.equal(batch.siteId, clinic.id); assert.equal(batch.generatedUnits, 1); assert.equal(batch.contaminatedUnits, 1); assert.equal(batch.sealedUnits, 0); assert.equal(batch.floor, source.floor); assert.equal(batch.pointId, source.pointId); assert.deepEqual(batch.point, source.point);
  assert.deepEqual(batch.sourceReceipts, [{ kind: 'public-health', sourceId: source.id, orderId: order.id, patientId: 'player', completedAt: source.consumedAt, publicConsumedAtOrder: source.consumptionIndex, quantity: 1 }]);
  const gainFrame = care.find(r => r.publicConsumed > 0 && r.patientMinutes === 20)!; assert.equal(gainFrame.healthAfter, Math.min(100, gainFrame.ordinaryHealthBeforeCare + gainFrame.healthGain));
  const careDoctors = new Set(care.flatMap(r => r.candidates.filter((d: any) => d.pairAtStation && d.used.length).map((d: any) => d.id)));
  assert(wages.some(r => r.canonical && careDoctors.has(r.event.citizenId) && r.event.minutes > 0), 'current core certified doctor earned actual wages');
  assert(wages.some(r => r.event.type === 'wage-paid' && careDoctors.has(r.event.citizenId) && r.event.amount > 0 && r.clock >= care[0].clock), 'actual care doctor received real payroll after public care began');
  const saved = city.exportSave(); record('complete-one-patient.save.json', saved); record('one-patient-health-source.json', source); record('one-patient-public-waste.json', batch);
  const full = createArchivedProductCity(world), partition = createArchivedProductCity(world), parts = partitionSave(saved, world);
  assert.equal(full.importSave(saved).ok, true); assert.equal(full.exportSave(), saved); assert.equal(partition.importSave(assembleSave(parts)).ok, true); assert.equal(partition.exportSave(), saved);
  const future: unknown[] = []; collectCare = false;
  for (let tick = 0; tick < 24; tick++) { city.step(.25); full.step(.25); partition.step(.25); assert.equal(full.exportSave(), city.exportSave()); assert.equal(partition.exportSave(), city.exportSave()); checkCash(); future.push({ tick: tick + 1, sha256: hash(city.exportSave()) }); }
  assert.equal(city.state.culture!.orders.find(o => o.id === order.id)!.healthConsumptions!.filter(r => r.patientId === 'player').length, 1);
  assert.equal(city.state.hygiene!.batches.filter(b => b.sourceReceipts.some(r => r.kind === 'public-health' && r.sourceId === source.id)).length, 1);
  record('complete-one-patient.after24.save.json', city.exportSave()); record('full-partition24.json', { parts: parts.length, ordinaryFutureTicks: 24, delta: .25, originalSpeed, future });
  const result = { status: 'PASS', scope: 'NEW 512 original .25-step continuation of genuine old240-bound FAIL terminal, after two explicit exactSHA HOST declarations. ONE actual player public-health consumer, original target6 retained; no autonomous NPC healthcare/full municipal healthcare or terminal sanitation claim.',
    sourceSHA256: hash(raw), worldSHA256: hash(worldText), sourceTick: initialTick, sourceClock: initialClock, originalFailedScope: { maxFrames: 240, observedFrames: prefixSummary.mainFrames, status: prefixSummary.status }, originalOpeningSHA256: hash(originalRaw), continuationTick, continuationClock, continuationInitial, inheritedMainFrames: prefixSummary.mainFrames, sourcePlayer: initial, sourceProfile: initialProfile,
    maxOrdinaryMainFrames: maxFrames, mainDelta: .25, migrations, mainFrames, ordinaryAcceptedInputSeconds: now / 1000, movedMeters, originalSpeed, maximumCashResidual,
    petition: answered, order, source, batch, careDoctors: [...careDoctors], completeSHA256: hash(saved), after24SHA256: hash(city.exportSave()), parts: parts.length };
  record('PASS-summary.json', result); console.log(JSON.stringify(result));
} catch (error) { flush(); record('FAIL-summary.json', { status: 'FAIL', scope: 'NEW policy continuation, original old240-bound FAIL unchanged; NEW512 quarter-second main-frame and external wall cap, no weakened target6 / altered business inputs', error: String(error instanceof Error ? error.stack : error), maxFrames, mainDelta: .25, migrations, mainFrames, inheritedMainFrames: prefixSummary.mainFrames, movedMeters, maximumCashResidual, sourceSHA256: hash(raw), frontier: snapshot() }); throw error; }
finally { controller.dispose(); for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } assert.deepEqual(world, JSON.parse(worldText), 'original World bytes preserved'); }
