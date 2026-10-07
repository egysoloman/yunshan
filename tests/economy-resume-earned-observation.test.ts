import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { auditPublicResponseEarned } from '../scripts/economy-resume-actual';

// Detached audit records only: zero Simulation/step, capability minting or
// source-state writes. The canonical boolean here is explicitly a pure input;
// the actual driver obtains it from the original private native event witness.
const raw = readFileSync(new URL('../docs/validation/2026-10-05-city-life-root20/ROOT20-PRIMARY-1700.save.json', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(raw).digest('hex'), '4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a');
const inherited = JSON.parse(raw);
const near = (actual: number, expected: number) => assert(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
function observedResponse() {
  const saved = structuredClone(inherited), actor = saved.state.citizens.find((item: { id: string }) => item.id === 'citizen-335');
  const route = actor.route.map((index: number) => saved.routePool[index]);
  actor.profile = saved.state.extension.actorProfiles[actor.id];
  const dispatch = saved.runtime.dispatches[actor.id], crime = saved.state.crimes.find((item: { id: string }) => item.id === dispatch.crimeId);
  // Exact native02 sequence364 observations, cross-checked against its whole
  // save and full typed bus. 26 inherited + two earlier4min windows + this4.
  const current = structuredClone(actor); current.position = { x: 1088, y: 187.50588662376308, z: -271.0588662376307 };
  current.needs.hunger = 61.082141943602124; current.needs.fatigue = 40.52768993865805;
  return { canonical: true, at: 3912, nativeMinutes: 4, walkingSpeed: 4.2, actor: current,
    event: { type: 'wage-earned', citizenId: actor.id, shopId: undefined, districtId: 'government', siteId: actor.workId,
      minutes: 38, amount: 3.496, ratePerMinute: .092, creditedWorkStartAt: 3874, creditedWorkEndAt: 3912 },
    before: { actor, dispatch: structuredClone(dispatch), pendingMinutes: saved.runtime.peopleElapsed[actor.id] + 8,
      attendance: 0, allowance: 480, claim: null, route, routeIndex: 1 },
    dispatch, crime, kit: saved.runtime.policeSupplies.kits[crime.id], attendance: 38,
    claim: { citizenId: actor.id, shopId: null, workId: actor.workId, minutes: 38, amount: 3.496, ratePerMinute: .092 },
    route, routeIndex: 14, roadRejected: false };
}

test('native02 inherited police dispatch proves real response work away from employer', () => {
  const evidence = observedResponse(), before = JSON.stringify(evidence), result = auditPublicResponseEarned(evidence);
  assert.equal(result.activity, 'public-response-in-transit'); assert.equal(result.actualIncidentArrival, false);
  assert.equal(result.employerArrivalRequiredByThisSource, false); near(result.elapsed, 38);
  near(result.routeArcDistance, 159.6); near(result.nativeDistanceBudget, 159.6);
  assert(result.displacement > 84 && result.displacement < 85); near(result.event.amount, 38 * .092);
  assert.equal(JSON.stringify(evidence), before, 'observational audit leaves its detached inputs exact');
});

test('original response does not invent a new material-kit requirement', () => {
  const evidence = observedResponse(); evidence.kit = null;
  assert.equal(auditPublicResponseEarned(evidence).activity, 'public-response-in-transit');
});

test('generic, wrong employer, inactive or unrelated dispatch observations are rejected', () => {
  for (const change of [
    (item: ReturnType<typeof observedResponse>) => { item.canonical = false; },
    (item: ReturnType<typeof observedResponse>) => { item.event.siteId = 'other-site'; },
    (item: ReturnType<typeof observedResponse>) => { item.actor.role = '商人'; },
    (item: ReturnType<typeof observedResponse>) => { item.actor.profile.alive = false; },
    (item: ReturnType<typeof observedResponse>) => { item.dispatch.crimeId = 'other-crime'; },
    (item: ReturnType<typeof observedResponse>) => { item.crime.status = 'resolved'; },
  ]) { const evidence = observedResponse(); change(evidence); assert.throws(() => auditPublicResponseEarned(evidence)); }
});

test('time, attendance, original frozen debt writer and public caps remain exact', () => {
  for (const change of [
    (item: ReturnType<typeof observedResponse>) => { item.before.pendingMinutes++; },
    (item: ReturnType<typeof observedResponse>) => { item.before.allowance = 0; },
    (item: ReturnType<typeof observedResponse>) => { item.attendance++; },
    (item: ReturnType<typeof observedResponse>) => { item.claim.amount++; },
    (item: ReturnType<typeof observedResponse>) => { item.claim.minutes++; },
    (item: ReturnType<typeof observedResponse>) => { item.event.ratePerMinute = .1; },
  ]) { const evidence = observedResponse(); change(evidence); assert.throws(() => auditPublicResponseEarned(evidence)); }
});

test('road rejection, body incapacity and routing-anchor fake arrival remain rejected', () => {
  for (const change of [
    (item: ReturnType<typeof observedResponse>) => { item.roadRejected = true; },
    (item: ReturnType<typeof observedResponse>) => { item.actor.state = 'roadWaiting'; },
    (item: ReturnType<typeof observedResponse>) => { item.actor.needs.hunger = 19; },
    (item: ReturnType<typeof observedResponse>) => { item.actor.profile.health = 34; },
    (item: ReturnType<typeof observedResponse>) => { item.routeIndex = item.route.length; },
  ]) { const evidence = observedResponse(); change(evidence); assert.throws(() => auditPublicResponseEarned(evidence)); }
});

test('source-eligible physical wait is recorded without claiming motion or incident arrival', () => {
  const evidence = observedResponse(); evidence.actor.state = 'physicalWaiting';
  evidence.actor.position = structuredClone(evidence.before.actor.position); evidence.routeIndex = evidence.before.routeIndex;
  const result = auditPublicResponseEarned(evidence);
  assert.equal(result.activity, 'public-response-physical-wait'); assert.equal(result.actualIncidentArrival, false);
  assert.equal(result.displacement, 0); assert.equal(result.routeArcDistance, 0);
});

test('already at the actual incident is genuine response work without a new movement requirement', () => {
  const evidence = observedResponse(); evidence.actor.position = structuredClone(evidence.crime.position);
  evidence.before.actor.position = structuredClone(evidence.crime.position); evidence.routeIndex = evidence.route.length;
  evidence.before.routeIndex = evidence.route.length;
  const result = auditPublicResponseEarned(evidence);
  assert.equal(result.activity, 'public-response-at-actual-incident'); assert.equal(result.actualIncidentArrival, true);
  assert.equal(result.displacement, 0); assert.equal(result.routeArcDistance, 0);
});
