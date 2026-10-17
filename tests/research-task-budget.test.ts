import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation';
import type { Citizen } from '../src/types';
import type { ServiceOrder } from '../src/simulation/culture';
import { core, createResearchCity, extension, marked, ok, workPoint } from './fixtures/research-city';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function continuousNpc(tier: Citizen['tier']) {
  const city = createResearchCity(), { sim, lab, point } = city;
  const actor = sim.state.citizens.find(c => c.workId === lab.id && ['科研员', 'scientist', '科学家'].includes(c.role) && (c.education ?? 0) >= 3 && extension(sim).actorProfiles[c.id].skill >= 35 && c.money >= 300)!;
  assert(actor, 'real initialized lab employee must afford its own investment'); actor.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  const pin = (person: Citizen) => { person.position = { ...point }; person.destinationId = lab.id; person.route = [{ ...point }]; person.routeIndex = 1; core(sim).activities[person.id] = 'work'; core(sim).decisionAt[person.id] = 1e9; };
  pin(actor); sim.onPhase('traffic', () => pin(actor));
  // Focus uses the real updateTiers predicate; no assignment to actor.tier.
  const offset = tier === 'active' ? 0 : tier === 'regional' ? 800 : 1800;
  sim.setFocus({ ...point, x: point.x + offset }, 'drone');
  for (let i = 0; i < 16 && !Object.values(extension(sim).runtime.researchJobs).some(j => j?.actorId === actor.id); i++) sim.step(.25);
  const [sector, job] = Object.entries(extension(sim).runtime.researchJobs).find(([, j]) => j?.actorId === actor.id)!;
  assert(job?.laborVersion === 1); assert.equal(actor.tier, tier); assert.equal(actor.state, 'working');
  return { ...city, actor, sector, job, pin };
}

test('all visual tiers complete the same120 real research minutes and keep their original tier', async t => {
  for (const tier of ['active', 'regional', 'statistical'] as const) await t.test(tier, () => {
    const { sim, actor, sector, job } = continuousNpc(tier), start = extension(sim).lastUpdate, level = extension(sim).technologies.find(t => t.sector === sector)!.level;
    let earned = 0; sim.onEvent('wage-earned', e => { if (e.citizenId === actor.id) earned += e.minutes ?? 0; });
    for (let i = 0; i < 30; i++) { sim.step(.25); assert.equal(actor.tier, tier); assert.equal(actor.state, 'working'); }
    assert.equal(extension(sim).lastUpdate - start, 120); assert.equal(job.workedMinutes, 120);
    assert.equal(extension(sim).technologies.find(t => t.sector === sector)!.level, level + 1);
    assert(earned >= 120, 'research reuses actual core-funded work; it does not fabricate attendance');
  });
});

test('statistical pending task new save resumes24 completed ticks byte-exact', () => {
  const { sim, world, actor, job } = continuousNpc('statistical');
  for (let i = 0; i < 10; i++) sim.step(.25); assert.equal(job.workedMinutes, 40);
  const saved = sim.exportSave(), restored = new Simulation(world), result = restored.importSave(saved); assert(result.ok, result.message); assert.equal(restored.exportSave(), saved);
  const restoredActor = restored.state.citizens.find(c => c.id === actor.id)!;
  for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); assert.equal(restoredActor.tier, 'statistical'); assert.equal(restored.exportSave(), sim.exportSave(), `NPC completedTick continuation${i + 1}`); }
});

test('first statistical task flush retains pending needs/wages but clips research before its actual start', () => {
  const { sim, actor, job } = continuousNpc('statistical'), pending = core(sim).peopleElapsed?.[actor.id] ?? 0, hunger = actor.needs.hunger, clock = extension(sim).lastUpdate;
  assert(pending > 0, 'real preceding deferred phases must exist before job creation');
  const events: { minutes: number; start: number; end: number }[] = [];
  sim.onEvent('wage-earned', e => { if (e.citizenId === actor.id) events.push({ minutes: e.minutes ?? 0, start: e.creditedWorkStartAt ?? NaN, end: e.creditedWorkEndAt ?? NaN }); });
  sim.step(.25); assert.equal(job.workedMinutes, 4); assert.equal(core(sim).peopleElapsed?.[actor.id], undefined);
  assert.equal(actor.tier, 'statistical'); assert.equal(events.length, 1); assert.equal(events[0].minutes, pending + 4);
  assert.equal(events[0].start, clock - pending); assert.equal(events[0].end, clock + 4);
  assert(Math.abs(actor.needs.hunger - (hunger - (pending + 4) * .05)) < 1e-7, 'pending needs are processed, never erased to make research qualify');
});

test('first flush daily-cap front segment cannot borrow old wages as newest research minutes', () => {
  const { sim, actor, job } = continuousNpc('statistical');
  const runtime = core(sim); runtime.peopleElapsed ??= {}; runtime.peopleElapsed[actor.id] = 60; runtime.attendance[actor.id] = 478;
  const clock = extension(sim).lastUpdate, hunger = actor.needs.hunger, events: { minutes: number; start: number; end: number }[] = [];
  // Controlled existing pending/day-cap boundary; real core emits/pays only2.
  sim.onEvent('wage-earned', e => { if (e.citizenId === actor.id) events.push({ minutes: e.minutes ?? 0, start: e.creditedWorkStartAt ?? NaN, end: e.creditedWorkEndAt ?? NaN }); });
  sim.step(.25); assert.equal(events.length, 1); assert.deepEqual(events[0], { minutes: 2, start: clock - 60, end: clock - 58 });
  assert.equal(job.workedMinutes, 0); assert.equal(core(sim).attendance[actor.id], 480); assert.equal(actor.tier, 'statistical');
  assert(Math.abs(actor.needs.hunger - (hunger - 64 * .05)) < 1e-7);
  sim.step(.25); assert.equal(job.workedMinutes, 0, 'no new event cannot grant new research labor');
});

test('same/different start pending actor capacity must reject coordinated excess minutes atomically', () => {
  const records: unknown[] = [];
  for (const differentStart of [false, true]) {
    const { sim } = createResearchCity(); ok(sim, { type: 'research', targetId: 'traffic', value: 100 });
    if (differentStart) sim.step(.25);
    ok(sim, { type: 'research', targetId: 'medicine', value: 100 }); if (differentStart) ok(sim, { type: 'research', targetId: 'energy', value: 100 }); sim.step(.25);
    const before = sim.exportSave(), wire = JSON.parse(before), e = wire.state.extension;
    if (differentStart) { e.runtime.researchJobs.traffic.workedMinutes = 0; e.technologies.find((t: { sector: string }) => t.sector === 'traffic').progress = 0; }
    for (const sector of differentStart ? ['medicine', 'energy'] : ['medicine']) { e.runtime.researchJobs[sector].workedMinutes = 4; e.technologies.find((t: { sector: string }) => t.sector === sector).progress = 4 / 120 * 100; }
    const result = sim.importSave(JSON.stringify(wire)); records.push({ differentStart, result, beforeSHA256: sha(before), afterSHA256: sha(sim.exportSave()), jobs: e.runtime.researchJobs, clock: e.lastUpdate });
  }
  for (const record of records as { result: { ok: boolean }; beforeSHA256: string; afterSHA256: string }[]) { assert.equal(record.result.ok, false, 'individually plausible jobs cannot exceed one actor’s elapsed suffix budget'); assert.equal(record.afterSHA256, record.beforeSHA256); }
});

test('actual public education attendance and funded research cannot spend the same NPC minute twice', () => {
  const { sim, lab, point, actor, sector, job, pin } = continuousNpc('active');
  // Controlled already-approved public service prerequisite. Its actual finite
  // supplies come through the real core purchase, and teachers earn real wages.
  // This does not claim the full civic approval lifecycle or native city input.
  const teachers = sim.state.citizens.filter(c => c.workId === lab.id && c.id !== actor.id && !Object.values(extension(sim).runtime.researchJobs).some(j => j?.actorId === c.id)).slice(0, 8);
  assert.equal(teachers.length, 8);
  for (const teacher of teachers) { teacher.role = 'teacher'; teacher.education = Math.max(2, teacher.education ?? 0); teacher.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 }; extension(sim).actorProfiles[teacher.id].health = 100; pin(teacher); sim.onPhase('traffic', () => pin(teacher)); }
  const receipt = sim.purchasePublicSupplyReceipt({ requestedGross: 200, requestedQuantity: 6, districtId: lab.districtId, siteId: lab.id, purpose: 'education' }); assert(Math.abs(receipt.quantity - 6) < 1e-7);
  const clock = extension(sim).lastUpdate, order: ServiceOrder = { id: 'service-controlled', petitionId: 'controlled-approved-prerequisite', topic: 'education', siteId: lab.id, state: 'active', scheduledAt: clock, approvedAt: clock, approvedBy: ['player'], authorizedCap: 200, spent: receipt.paid, receivedUnits: receipt.quantity, consumedUnits: 0, targetUnits: 6, requiredMinutes: 60, servedIds: [], serviceMinutes: {}, staffIds: [], receipts: [], retryAt: clock + 60, completedAt: null, lastReason: 'Controlled approved dependency; supply is an actual conserved receipt.' };
  sim.state.culture!.orders.push(order); const beforeResearch = job.workedMinutes; sim.step(.25);
  const research = job.workedMinutes - beforeResearch, education = order.serviceMinutes[actor.id] ?? 0;
  // Public tuition counts only an observed learner arrival (studying/attending after a real
  // walking leg, education.ts observePublicEducationArrival); a researcher working at the
  // same station is not a class arrival, so the class cannot take the research minutes.
  assert.equal(education, 0, 'presence at the station while working is not classroom time');
  assert(research > 0, 'the researcher keeps the research minutes');
  assert(research + education <= 4 + 1e-7, 'one actor has one 4-minute time budget across research and public class');
});
