import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PerspectiveCamera } from 'three';
import { PlayerController } from './source/src/controller.ts';
import { canAccessFloor, getStairPosition } from './source/src/access.ts';
import { giftContactReason } from './source/src/simulation/gift-contact.ts';
import { createArchivedProductCity } from './source/src/product-city.ts';
import { isCanonicalNpcWage } from './source/src/simulation.ts';
import { clinicalDoctorWorkWindows, clinicalDoctorUsedWorkWindows, clinicalPairAtServiceStation, clinicalVisitDeadline, clinicalHealthGain } from './source/src/simulation/clinical.ts';
import { assembleSave, partitionSave } from './source/src/persistence/partition.ts';
import { familyEducationHeldCash } from './source/src/simulation/family-education.ts';
import { shopLifecycleHeldCash } from './source/src/simulation/shop_lifecycle.ts';
import type { Command, Vec3, WorldDefinition } from './source/src/types.ts';

const out = process.argv[2]; assert(out);
assert(process.env.ROOT16_MEDICAL_RUN_COORDINATED === '1', 'Prepared candidate: root must grant the exclusive Simulation window before execution');
mkdirSync(out, { recursive: true });
const maxFrames = 512; // NEW finite supply scope; .25 <= regular delta <= 1, original main clamp and internal accumulator unchanged.
const maxMainTicks = 2048;
const base = new URL('.', import.meta.url);
const worldText = readFileSync(new URL('inherited-originals/origins/world.json', base), 'utf8');
const originalRaw = readFileSync(new URL('inherited-originals/origins/opening-policy-v4.save.json', base), 'utf8');
const originalBody = JSON.parse(originalRaw);
const prefixBase = new URL('inherited-originals/actual03/artifacts/', base);
const inherited = (name: string) => JSON.parse(readFileSync(new URL(name, prefixBase), 'utf8'));
const prefixSummary = inherited('FAIL-summary.json');
assert.equal(prefixSummary.mainFrames, 240);
const raw = readFileSync(new URL('frontier.save.json', prefixBase), 'utf8');
const route = JSON.parse(readFileSync(new URL('inherited-originals/ROUTE-PREP04.json', base), 'utf8'));
const world: WorldDefinition = JSON.parse(worldText);
const hash = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const record = (name: string, value: unknown) => writeFileSync(join(out, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
assert.equal(hash(originalRaw), '8c5a8ae47daed0b3e4f45225c2a45ee7d5fdb2a83b95eee788cd07cd3e01b7aa');
assert.equal(hash(raw), '74b488c8e3c39d762b90613f50c2cf97aa34bd89c54ef8027ebdef2f4cdeccce');
assert.equal(hash(worldText), 'abce713388422385a3754fc8d760745526d95fdb4268546057e5a748d8df6ea1');
assert.equal(route.status, 'PASS'); assert.equal(route.originSHA256, hash(originalRaw));
record('origin.save.json', raw); record('original-opening-policy-v4.save.json', originalRaw);
record('inherited-prefix-bindings.json', Object.fromEntries(['frontier.save.json','trace-events.json','trace-frames.json','FAIL-summary.json'].map(name => [name, hash(readFileSync(new URL(name, prefixBase), 'utf8'))]))); record('world.json', worldText);
const sourceInputs = JSON.parse(readFileSync(new URL('INPUTS-322.json', base), 'utf8'));
for (const [name, expected] of Object.entries(sourceInputs)) assert.equal(hash(readFileSync(new URL(`source/${name}`, base))), expected, `Frozen322 source ${name}`);
const city = createArchivedProductCity(world);
assert.equal(city.importSave(raw).ok, true); assert.equal(city.exportSave(), raw);
assert.equal(city.referenceCollisionPolicyId, 'legacy'); assert.equal(city.mealRoutePolicyId, 'legacy');
const migrations: any[] = []; // No policy cutover: original legacy reference/meal declarations remain literal.
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
for (const name of ['sale', 'food-consumed', 'stored-meal', 'private-shift-authorized', 'public-shift-authorized', 'production', 'wholesale', 'security-procurement', 'civic-procurement', 'public-procurement', 'public-health-consumed', 'hygiene-waste-generated', 'municipal-operation-accrual'] as const)
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
      used: clinicalDoctorUsedWorkWindows(city, p.id), currentDay: Math.floor(city.state.extension!.lastUpdate / 1440), currentFundedShift: Reflect.get(city, 'runtime').publicLabor?.shifts.find((s: any) => s.day === Math.floor(city.state.extension!.lastUpdate / 1440) && s.assignments.some((a: any) => a.citizenId === p.id && a.workId === clinic.id && a.minutesCap > 0)) }));
    const actual = candidates.filter(p => p.pairAtStation && p.work.length && p.used.length);
    assert(actual.length > 0, 'patient care needs a current real funded on-site doctor window');
    assert(actual.some(p => p.currentDay >= 8 && p.currentFundedShift && Math.floor(p.currentFundedShift.approvedAt / 1440) >= 8), 'Real currentday8+ signed provider wage source; expiredday7 excluded');
    assert(actual.some(p => p.canonicalWages.reduce((sum, r) => sum + r.event.minutes, 0) + 1e-7 >= increment), 'actual current core certified doctor wages cover patient credit');
    assert(actual.some(p => p.used.reduce((sum, w) => sum + w.end - w.start, 0) + 1e-7 >= increment), 'observed patient credit must be covered by real doctor claimed clock');
    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    const player = city.state.player, profile = city.state.extension!.actorProfiles.player;
    const ordinaryHealthRate = .001 + (clinicalHealthGain(city.state) - 25) * .0003 - clamp((20 - player.needs.hunger) * 3) * .00009 - clamp((25 - player.needs.fatigue) * 2) * .00006 - Math.max(0, profile.age - 75) * .0001 - (100 - city.state.extension!.environment.waterQuality) * .000007;
    care.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, phaseMinutes: mainPhaseMinutes, patientMinutes: minutes, increment,
      beforeHealth, ordinaryHealthRate, ordinaryHealthBeforeCare: clamp(beforeHealth + mainPhaseMinutes * ordinaryHealthRate), healthGain: clinicalHealthGain(city.state), healthAfter: city.state.extension!.actorProfiles.player.health, patientPosition: structuredClone(city.state.player.position), patientNeeds: structuredClone(city.state.player.needs), candidates, publicConsumed: order.consumedUnits });
  }
});
const stock = (kind: 'food' | 'materials') => city.state.shops.filter(s => city.shopCommodity(s) === kind).reduce((n, s) => n + s.inventory, 0);
const food = () => stock('food') + (city.state.player.inventory.food ?? 0) + city.state.citizens.reduce((n, c) => n + (c.food ?? 0), 0);
assert.equal(city.state.vehicles.length, 0, 'Inherited fixture has no carriers; no uncounted cargo food');
assert.equal(Object.values(Reflect.get(city, 'runtime').freight).reduce((n: number, q: any) => n + q, 0), 0);
const initialFood = food(), initialMaterials = stock('materials');
let giftsApplied = 0, maximumFoodResidual = 0, maximumMaterialResidual = 0;
const gifts: any[] = [], life: any[] = [], gates: any[] = [];
const physicalAccounts = () => {
  const producedFood = events.filter(r => r.event.type === 'production' && city.shopCommodity(city.state.shops.find(s => s.id === r.event.shopId)!) === 'food').reduce((n, r) => n + r.event.amount, 0);
  const npcRetailMeals = events.filter(r => r.event.type === 'sale' && r.event.citizenId && r.event.citizenId !== 'player' && city.shopCommodity(city.state.shops.find(s => s.id === r.event.shopId)!) === 'food').length;
  const meals = events.filter(r => ['stored-meal', 'food-consumed'].includes(r.event.type)).reduce((n, r) => n + (r.event.amount ?? 0), 0) + npcRetailMeals;
  const producedMaterials = events.filter(r => r.event.type === 'production' && city.shopCommodity(city.state.shops.find(s => s.id === r.event.shopId)!) === 'materials').reduce((n, r) => n + r.event.amount, 0);
  const procuredMaterials = events.filter(r => ['civic-procurement', 'public-procurement', 'security-procurement'].includes(r.event.type) || r.event.type === 'wholesale' && r.event.shopId && city.shopCommodity(city.state.shops.find(s => s.id === r.event.shopId)!) === 'materials').reduce((n, r) => n + (r.event.quantity ?? 0), 0);
  return { initialFood, producedFood, meals, giftsApplied, currentFood: food(), foodResidual: food() - initialFood - producedFood + meals + giftsApplied,
    initialMaterials, producedMaterials, procuredMaterials, currentMaterials: stock('materials'), materialResidual: stock('materials') - initialMaterials - producedMaterials + procuredMaterials };
};
const checkPhysical = () => {
  const a = physicalAccounts(); maximumFoodResidual = Math.max(maximumFoodResidual, Math.abs(a.foodResidual)); maximumMaterialResidual = Math.max(maximumMaterialResidual, Math.abs(a.materialResidual));
  assert(Math.abs(a.foodResidual) < 1e-6, `Finite physical food conservation ${JSON.stringify(a)}`);
  assert(Math.abs(a.materialResidual) < 1e-6, `Actual production/procurement material conservation ${JSON.stringify(a)}`);
};
const checkCash = () => { const residual = cash() - initialCash; maximumCashResidual = Math.max(maximumCashResidual, Math.abs(residual)); assert(Math.abs(residual) < 1e-6, `real cash conservation ${residual}`); };
const flush = () => { record('trace-commands.json', commands); record('trace-events.json', events); record('trace-wages.json', wages); record('trace-frames.json', frames); record('trace-care.json', care); record('trace-transitions.json', transitions); record('trace-gifts.json', gifts); record('trace-life.json', life); record('trace-gates.json', gates); record('physical-accounts.json', physicalAccounts()); record('frontier.save.json', city.exportSave()); record('frontier.summary.json', snapshot()); };
const command = (c: Command) => {
  const before = { tick: city.state.tick, clock: city.state.extension!.lastUpdate, player: structuredClone(city.state.player), profile: structuredClone(city.state.extension!.actorProfiles.player), treasury: city.state.treasury, ledgerCount: city.state.extension!.publicLedger.length };
  const result = city.command(c), after = { player: structuredClone(city.state.player), profile: structuredClone(city.state.extension!.actorProfiles.player), treasury: city.state.treasury, ledger: city.state.extension!.publicLedger.slice(before.ledgerCount) };
  commands.push({ command: c, before, result, after }); checkCash(); if (c.type !== 'gift') checkPhysical(); return { result, before, after };
};
let now = inherited('trace-frames.json').at(-1).now;
const keys = Object.assign(new EventTarget(), { closest: () => null }), canvas = new EventTarget(), doc = Object.assign(new EventTarget(), { pointerLockElement: canvas });
const originals = Object.fromEntries(['window', 'document', 'performance'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, 'window', { value: keys, configurable: true }); Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => now, timeOrigin: 1_700_000_000_000 }, configurable: true });
const controller = new PlayerController(new PerspectiveCamera(), canvas as HTMLCanvasElement, world, code => { if (code === 'KeyF') { const before = controller.position; assert(controller.inside?.id === 'civic-0-home'); assert(controller.useStairs(), 'Original physical F shaft and ACL accepted'); city.state.player.position = controller.walkingPosition; life.push({ kind: 'native-F-stair', clock: city.state.extension!.lastUpdate, before, after: controller.position, floor: controller.floor }); } }, (b, f) => canAccessFloor(b, f, city.state.player), () => city.state.voxels, () => city.state);
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
  assert(delta > 0 && delta <= 1); assert(mainFrames < maxFrames, 'NEW fixed512 regular main-frame bound');
  const before = controller.position, oldClock = city.state.extension!.lastUpdate, oldTick = city.state.tick, oldAccumulator = Reflect.get(city, 'runtime').accumulator; now += delta * 1000;
  controller.stepWalkingFrame(now, delta, false, city.state.paused);
  city.state.player.position = controller.walkingPosition;
  city.setFocus(controller.position, controller.mode);
  city.step(delta); mainFrames++;
  assert.equal(city.state.speed, originalSpeed); assert.equal(city.state.paused, false);
  const actualTicks = city.state.tick - oldTick; assert(actualTicks >= 0 && actualTicks <= 4, 'Original main delta<=1 retains at most four internal .25 ticks'); assert(city.state.tick - continuationTick <= maxMainTicks, 'NEW original internal tick maximum2048'); const accumulatorAfter = Reflect.get(city, 'runtime').accumulator;
  assert(Math.abs(city.state.extension!.lastUpdate - oldClock - actualTicks * .25 * originalSpeed) < 1e-6, 'only original fixed ticks advance clock');
  assert(Math.abs(oldAccumulator + delta - actualTicks * .25 - accumulatorAfter) < 1e-7, 'ordinary main delta is preserved by original fixed-tick accumulator');
  assert.deepEqual(city.state.player.position, controller.walkingPosition, 'published physical motor position only');
  const moved = Math.hypot(controller.position.x - before.x, controller.position.z - before.z); movedMeters += moved;
  frames.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, now, delta, actualTicks, accumulatorBefore: oldAccumulator, accumulatorAfter, from: before, to: controller.position, target, meters: moved });
  const s = snapshot(), key = JSON.stringify({ petition: s.petition, order: s.order }); if (key !== lastTransition) { lastTransition = key; transitions.push(s); }
  checkCash(); checkPhysical(); life.push({ kind: 'ordinary-frame', frame: mainFrames, tick: city.state.tick, clock: city.state.extension!.lastUpdate, player: structuredClone(city.state.player), actors: ['citizen-11', 'citizen-55', 'citizen-44'].map(id => { const c = city.state.citizens.find(p => p.id === id)!; return { id, position: structuredClone(c.position), state: c.state, needs: structuredClone(c.needs), food: c.food, health: city.state.extension!.actorProfiles[id].health }; }), physical: physicalAccounts() }); if (mainFrames % 16 === 0) { flush(); console.log(JSON.stringify({ scope: 'ROOT16 finite18-food13-gift medical continuation', frame: mainFrames, tick: s.tick, clock: s.clock, playerHealth: s.profile.health, playerNeeds: s.player.needs, petitionStatus: s.petition?.status, signers: s.petition?.signerIds, orderState: s.order?.state, consumed: s.order?.consumedUnits, playerCareMinutes: s.order?.serviceMinutes.player ?? 0 })); }
};

// Reuses ROOT15 actual frame/walk functions. Only persisted origin restore and
// ordinary W/mouse/F inputs publish the Controller walking position.
const walk = (points: Vec3[]) => {
  input('keydown', { code: 'KeyW', repeat: false });
  try { for (const target of points.slice(1)) { let guard = 0; while (Math.hypot(controller.position.x - target.x, controller.position.z - target.z) > .015) {
    eatIfNeeded(); const before = controller.position, dx = target.x - before.x, dz = target.z - before.z;
    input('mousemove', { movementX: (controller.yaw - Math.atan2(-dx, -dz)) / .003, movementY: 0, clientX: 0, clientY: 0 });
    frame(Math.min(1, Math.hypot(dx, dz) / 4.8), target);
    assert(Math.hypot(controller.position.x - before.x, controller.position.z - before.z) > 1e-7, `Actual original W blocked ${JSON.stringify({ before, target })}`); assert(++guard < 100, 'Original finite waypoint guard');
  } } } finally { input('keyup', { code: 'KeyW', repeat: false }); }
};
const restAtClinic = () => {
  const r = command({ type: 'rest', targetId: clinic.id }); assert(r.result.ok, r.result.message);
  assert.equal(r.after.player.money, r.before.player.money - 15); assert.equal(r.after.treasury, r.before.treasury + 15);
  assert.equal(r.after.player.needs.fatigue, Math.min(100, r.before.player.needs.fatigue + 23));
};
const gift = (id: string) => {
  const person = city.state.citizens.find(c => c.id === id)!;
  const before = structuredClone(person), cooldown = Reflect.get(city, 'runtime').relationshipClock;
  const role = Reflect.get(city, 'citizenIdentity').call(city, person);
  assert.equal(giftContactReason(world, city.state.player, { position: person.position, role, identities: [role] }, city.state.voxels), null, 'Current integrated2m physical support/ACL/contact guard');
  assert.equal(controller.inside?.id, person.homeId); assert.equal(controller.floor, 1); assert(canAccessFloor(controller.inside!, controller.floor, city.state.player));
  assert(Math.hypot(controller.position.x - person.position.x, controller.position.y - person.position.y, controller.position.z - person.position.z) <= 2, 'Actual instantaneous same-floor supported contact');
  const r = command({ type: 'gift', targetId: id }); assert(r.result.ok, r.result.message); giftsApplied++;
  assert.equal(r.after.player.inventory.food, r.before.player.inventory.food! - 1); assert.equal(person.needs.hunger, Math.min(100, before.needs.hunger + 20));
  assert.deepEqual(person.position, before.position); assert.equal(person.food, before.food); assert.equal(person.money, before.money); assert.equal(r.after.player.money, r.before.player.money);
  gifts.push({ id, tick: city.state.tick, clock: city.state.extension!.lastUpdate, relationshipClock: cooldown, before, after: structuredClone(person), command: r }); checkPhysical();
};
const giftRoute = JSON.parse(readFileSync(new URL('inherited-originals/GIFT-ROUTE-PREPARED.json', base), 'utf8'));
assert.equal(giftRoute.status, 'PASS'); assert.equal(giftRoute.sourceTerminalSHA256, hash(raw));
const nativeF = () => { input('keydown', { code: 'KeyF', repeat: false }); input('keyup', { code: 'KeyF', repeat: false }); };

try {
  const petition = city.state.culture!.petitions.find(p => p.id === petitionId)!;
  const originalOrder = healthOrder()!;
  assert.equal(petition.authorId, 'player'); assert.equal(petition.replyAt, petition.filedAt + 1440); assert(petition.answeredAt! >= petition.replyAt);
  assert.equal(originalOrder.id, 'service-2'); assert.equal(originalOrder.topic, 'health'); assert.equal(originalOrder.state, 'awaitingSupply');
  assert.equal(originalOrder.authorizedCap, 40); assert.equal(originalOrder.spent, 0); assert.equal(originalOrder.receivedUnits, 0); assert.equal(originalOrder.consumedUnits, 0);
  assert.equal(originalOrder.targetUnits, 6); assert.equal(originalOrder.requiredMinutes, 20); assert.equal(city.state.player.inventory.food, 1);
  assert.equal(city.state.tick, continuationTick); assert.equal(city.state.extension!.lastUpdate, continuationClock); assert.deepEqual(city.state.player, continuationInitial);
  assert(Math.hypot(controller.position.x - clinicPoint.x, controller.position.y - clinicPoint.y, controller.position.z - clinicPoint.z) < .02);
  record('scope-start-literal-terminal.save.json', city.exportSave());
  // No rental, clock command, body destination setter, business ownership, job
  // appointment, inventory/needs/health write or policy migration is permitted.
  restAtClinic();
  walk([controller.position, ...giftRoute.routes[0].targets]);
  const remote = city.state.shops.find(shop => shop.buildingId === 'civic-1-market')!;
  while (!remote.open) { eatIfNeeded(); assert(city.state.hour < 6, 'Normal [6,22) remote opening did not occur; keep real FAIL'); frame(.25); }
  const quantity = 18, beforeShop = structuredClone(remote), quotedCost = quantity * remote.price;
  assert(city.shopCommodity(remote) === 'food' && Math.floor(remote.inventory) >= quantity && city.state.player.money >= quotedCost, 'Actual finite18 food at normal open sale and actual quote; no extra stock/cash');
  assert(city.state.player.money - quotedCost >= 30, 'Preserve actual two further clinic15 rests within finite wallet');
  const bought = command({ type: 'purchase', targetId: remote.id, value: quantity }); assert(bought.result.ok, bought.result.message);
  assert.equal(bought.after.player.money, bought.before.player.money - quotedCost); assert.equal(remote.inventory, beforeShop.inventory - quantity); assert.equal(remote.revenue, beforeShop.revenue + quotedCost);
  assert.equal(bought.after.player.inventory.food, (bought.before.player.inventory.food ?? 0) + quantity - 1); assert.equal(bought.after.player.needs.hunger, Math.min(100, bought.before.player.needs.hunger + 52));
  record('after-finite18-purchase.save.json', city.exportSave());
  walk([controller.position, ...giftRoute.routes[1].targets]); assert.equal(controller.floor, 0); nativeF(); assert.equal(controller.floor, 1);
  assert(city.state.hour >= 22 || city.state.hour < 6, 'New finite13-gift schedule requires actual night home arrival; no invented body target');
  walk([controller.position, city.state.citizens.find(c => c.id === 'citizen-11')!.position]);
  for (let round = 0; round < 5; round++) {
    if (round > 0) for (let tick = 0; tick < 3; tick++) frame(.25); // Original10min cooldown; three4min ticks=12.
    if (round < 4) { gift('citizen-11'); gift('citizen-55'); }
    gift('citizen-44');
  }
  assert.equal(giftsApplied, 13); assert.equal(gifts.filter(g => g.id === 'citizen-11').length, 4); assert.equal(gifts.filter(g => g.id === 'citizen-55').length, 4); assert.equal(gifts.filter(g => g.id === 'citizen-44').length, 5);
  record('after-real13-gifts.save.json', city.exportSave());
  walk([controller.position, getStairPosition(world.buildings.find(b => b.id === 'civic-0-home')!, 1)]); nativeF(); assert.equal(controller.floor, 0);
  walk([controller.position, ...giftRoute.routes[4].targets]);
  assert(Math.hypot(controller.position.x - clinicPoint.x, controller.position.y - clinicPoint.y, controller.position.z - clinicPoint.z) < .02);
  record('actual-return-arrival.save.json', city.exportSave());
  restAtClinic(); let lastRest = city.state.extension!.lastUpdate;
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
    const runtime = Reflect.get(city, 'runtime'), day = Math.floor(city.state.extension!.lastUpdate / 1440);
    const signed = runtime.publicLabor?.shifts.find((s: any) => s.day === day)?.assignments.find((a: any) => a.citizenId === 'citizen-44' && a.workId === clinic.id);
    const currentPrivate = ['shop-civic-0-farm', 'shop-civic-0-workshop'].map(id => { const p = runtime.privateLabor?.shifts[id]; return { id, day: p?.day, current: p?.day === day, reviews: p?.reviews, assignments: p?.assignments }; });
    gates.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, day, hour: city.state.hour, order: structuredClone(order), clinicCurrentDayAssignment: structuredClone(signed), publicShifts: structuredClone(runtime.publicLabor?.shifts.map((s: any) => ({ day: s.day, approvedAt: s.approvedAt, approvedBy: s.approvedBy, siteId: s.siteId }))), currentPrivate, instantPair: clinicalPairAtServiceStation(city, clinic, 'citizen-44', 'player') });
    frame(1);
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
  for (let tick = 0; tick < 24; tick++) { city.step(.25); full.step(.25); partition.step(.25); assert.equal(full.exportSave(), city.exportSave()); assert.equal(partition.exportSave(), city.exportSave()); checkCash(); checkPhysical(); future.push({ tick: tick + 1, sha256: hash(city.exportSave()) }); }
  assert.equal(city.state.culture!.orders.find(o => o.id === order.id)!.healthConsumptions!.filter(r => r.patientId === 'player').length, 1);
  assert.equal(city.state.hygiene!.batches.filter(b => b.sourceReceipts.some(r => r.kind === 'public-health' && r.sourceId === source.id)).length, 1);
  record('complete-one-patient.after24.save.json', city.exportSave()); record('full-partition24.json', { parts: parts.length, ordinaryFutureTicks: 24, delta: .25, originalSpeed, future });
  assert.equal(commands.filter(c => c.command.type === 'purchase' && c.result.ok).length, 1); assert.equal(giftsApplied, 13);
  const fundedDoctors = [...careDoctors].map(id => { const used = wages.filter(w => w.canonical && w.event.citizenId === id && w.event.siteId === clinic.id); assert(used.every(w => Math.floor(w.clock / 1440) >= 8), 'No expiredday7 wage source'); return { id, used }; });
  assert(events.some(r => r.event.type === 'private-shift-authorized' && r.event.shopId === 'shop-civic-0-workshop' && r.clock >= initialClock));
  assert(events.some(r => r.event.type === 'production' && r.event.shopId === 'shop-civic-0-workshop' && r.event.amount > 0));
  assert(events.some(r => r.event.type === 'production' && r.event.shopId === 'shop-civic-0-farm' && r.event.amount > 0));
  const result = { status: 'PASS', scope: 'ROOT16 NEW512 ordinary main delta<=1 continuation of genuine old240FAIL terminal/current322. Exact finite18 purchase/13 physical gifts, ordinaryW/F and finite paid rests. ONE actual patient, originaltarget6 retained; no terminal sanitation claim.',
    sourceSHA256: hash(raw), worldSHA256: hash(worldText), sourceTick: initialTick, sourceClock: initialClock, originalFailedScope: { maxFrames: 240, observedFrames: prefixSummary.mainFrames, status: prefixSummary.status }, originalOpeningSHA256: hash(originalRaw), continuationTick, continuationClock, continuationInitial, inheritedMainFrames: prefixSummary.mainFrames, sourcePlayer: initial, sourceProfile: initialProfile,
    maxOrdinaryMainFrames: maxFrames, mainDelta: 'ordinary original main min(rawDelta,1); walkingfractional<=1, cooldown/openwait .25, clinicwait1', maxMainTicks, giftsApplied, physical: physicalAccounts(), maximumFoodResidual, maximumMaterialResidual, migrations, mainFrames, ordinaryAcceptedInputSeconds: frames.reduce((n, f) => n + f.delta, 0), movedMeters, originalSpeed, maximumCashResidual,
    petition: answered, order, source, batch, careDoctors: [...careDoctors], fundedDoctors, completeSHA256: hash(saved), after24SHA256: hash(city.exportSave()), parts: parts.length };
  record('PASS-summary.json', result); console.log(JSON.stringify(result));
} catch (error) { flush(); record('FAIL-summary.json', { status: 'FAIL', scope: 'ROOT16 NEW512 main delta<=1/cap900; literal old240FAIL retained; finite18food/13gifts real requirements, no weakened business assertions', error: String(error instanceof Error ? error.stack : error), maxFrames, mainDelta: 'ordinary original main min(rawDelta,1); walkingfractional<=1, cooldown/openwait .25, clinicwait1', maxMainTicks, giftsApplied, physical: physicalAccounts(), maximumFoodResidual, maximumMaterialResidual, migrations, mainFrames, inheritedMainFrames: prefixSummary.mainFrames, movedMeters, maximumCashResidual, sourceSHA256: hash(raw), frontier: snapshot() }); throw error; }
finally { controller.dispose(); for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } assert.deepEqual(world, JSON.parse(worldText), 'original World bytes preserved'); }
