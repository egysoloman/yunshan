import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation, isCanonicalNpcWage, isCanonicalCivicPresence } from '../src/simulation.ts';
import { createProductCity } from '../src/product-city.ts';
import { canAccessFloor } from '../src/access.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { CIVIC_PROOF_MINUTES, CIVIC_POLL_MINUTES, CIVIC_TERM_MINUTES, civicCouncilSourceProof, validateCivicCouncilSourceProof,
  validateCivicStaffing, civicStaffingActorReservedThisTick, type CivicTerm } from '../src/simulation/civic-staffing.ts';
import { civicFixture, civicFixtureWorld, civicUntil, civicExact24, businessClock, civicRuntime, civicArtifact } from './civic-staffing-fixture.ts';

let firstTermSave: string | undefined, firstTermWorld: ReturnType<typeof civicFixtureWorld> | undefined;
let firstTerm: CivicTerm | undefined;
function electedContext() {
  if (!firstTermSave) {
    const sim = civicFixture(), sourceRoles = new Map(sim.state.citizens.map(person => [person.id, { role: person.role, workId: person.workId, education: person.education }]));
    const earned: { actorId: string; startAt: number; endAt: number; minutes: number; amount: number }[] = [];
    const realPresence: { actorId: string; tick: number; startAt: number; endAt: number; minutes: number }[] = [];
    sim.onEvent('wage-earned', event => {
      if (isCanonicalNpcWage(event) && event.siteId?.endsWith('-hall')) earned.push({ actorId: event.citizenId!, startAt: event.creditedWorkStartAt!, endAt: event.creditedWorkEndAt!, minutes: event.minutes!, amount: event.amount! });
    });
    sim.onEvent('civic-activity-window', event => {
      assert.equal(isCanonicalCivicPresence(event), true);
      realPresence.push({ actorId: event.citizenId!, tick: event.activityObservedTick!, startAt: event.activityWindowStartAt!, endAt: event.activityWindowEndAt!, minutes: event.minutes! });
    });
    civicUntil(sim, () => !!sim.state.civicStaffing!.terms.length, 1100, 'ordinary original officials and residents must form a real finite term');
    firstTerm = structuredClone(sim.state.civicStaffing!.terms[0]);
    const poll = sim.state.civicStaffing!.polls.find(poll => poll.id === firstTerm!.pollId)!, application = sim.state.civicStaffing!.applications.find(application => application.id === poll.applicationId)!;
    const proof = sim.state.civicStaffing!.proofs.find(proof => proof.id === firstTerm!.proofId)!;
    assert.ok(earned.some(row => row.actorId === proof.actorId && row.amount > 0));
    assert.ok(realPresence.some(row => row.actorId === proof.actorId));
    assert.ok(poll.ballots.every(ballot => ballot.completedAt === null || realPresence.some(row => row.actorId === ballot.actorId)));
    assert.equal(proof.minutes, CIVIC_PROOF_MINUTES); assert.ok(proof.completedAt! <= application.startedAt);
    assert.equal(application.receipt!.amount, 120); assert.equal(application.receipt!.moneyBefore - application.receipt!.moneyAfter, 120);
    assert.equal(application.receipt!.treasuryAfter - application.receipt!.treasuryBefore, 120); assert.ok(application.receipt!.moneyAfter >= 100);
    assert.equal(application.receipt!.witnesses.length, 2); assert.ok(application.receipt!.witnesses.every(witness => witness.actorId !== proof.actorId && witness.officeId === proof.officeId && witness.paid.earned > 0));
    assert.equal(poll.closesAt - poll.openedAt, CIVIC_POLL_MINUTES); assert.ok(poll.countedAt! >= poll.closesAt);
    assert.ok(poll.count!.turnout >= poll.count!.quorum && poll.count!.support > poll.count!.retain);
    assert.equal(firstTerm.endsAt - firstTerm.startsAt, CIVIC_TERM_MINUTES);
    const person = sim.state.citizens.find(person => person.id === firstTerm!.actorId)!;
    assert.deepEqual({ role: person.role, workId: person.workId, education: person.education }, sourceRoles.get(person.id), 'election cannot rewrite original profession, employer or qualification');
    assert.equal(civicRuntime(sim).attendance[person.id] <= 480, true);
    assert.equal(sim.state.citizens.some(person => person.role === 'council' || person.role === '议员'), false);
    validateCivicStaffing(sim.state, sim.worldDefinition);
    firstTermSave = sim.exportSave(); firstTermWorld = sim.worldDefinition;
    civicArtifact('first-natural-term.save.json', firstTermSave, true); civicArtifact('first-natural-term.world.json', firstTermWorld);
    civicArtifact('first-natural-term.canonical-events.json', { earned, realPresence });
    console.log('CIVIC natural small-parameter-city source', JSON.stringify({ scope: 'PRE-constructor compact map, no runtime cash/role/needs/position/ballot grants', tick: sim.state.tick,
      businessClock: businessClock(sim), term: firstTerm, proofMinutes: proof.minutes, fee: application.receipt, count: poll.count, originalRolesPreserved: true }));
  }
  const sim = createProductCity(firstTermWorld!), result = sim.importSave(firstTermSave!); assert.equal(result.ok, true, result.message);
  return { sim, term: sim.state.civicStaffing!.terms.find(term => term.id === firstTerm!.id)! };
}

test('product civic rules start empty; generic wage and arrival events create no official proof or ballot', () => {
  const sim = civicFixture(), before = sim.exportSave(), official = sim.state.civicStaffing!.originalOfficials.find(source => source.educationAtEnablement >= 2)!;
  assert.ok(official); assert.deepEqual(sim.state.civicStaffing!.proofs, []); assert.deepEqual(sim.state.civicStaffing!.terms, []);
  const fake = Object.freeze({ type: 'wage-earned', citizenId: official.actorId, siteId: official.workId, minutes: 60, amount: 6, ratePerMinute: .1, creditedWorkStartAt: 480, creditedWorkEndAt: 540 });
  assert.equal(isCanonicalNpcWage(fake), false); sim.emitEvent(fake);
  const arrival = Object.freeze({ type: 'civic-activity-window', citizenId: official.actorId, siteId: official.workId, purpose: 'civicRegister', minutes: 4,
    activityObservedTick: sim.state.tick, activityObservedClock: businessClock(sim), activityWindowStartAt: businessClock(sim) - 4,
    activityWindowEndAt: businessClock(sim), activityPosition: Object.freeze({ ...sim.state.citizens.find(person => person.id === official.actorId)!.position }) });
  assert.equal(isCanonicalCivicPresence(arrival), false); sim.emitEvent(arrival); assert.equal(sim.exportSave(), before);
});

test('ordinary native source → paid proof → finite resident fee/two paid witnesses → real two-day ballots → secondary term', () => {
  const { sim, term } = electedContext(), source = civicCouncilSourceProof(sim.state, term.actorId);
  assert.ok(source); assert.equal(validateCivicCouncilSourceProof(sim.state, source!), true);
  assert.equal(validateCivicCouncilSourceProof(sim.state, { ...source!, untrusted: true } as typeof source & { untrusted: boolean }), false);
  assert.equal(validateCivicCouncilSourceProof(sim.state, { ...source!, signedAt: businessClock(sim) + 1 }), false);
  assert.equal(civicCouncilSourceProof(sim.state, term.actorId, term.startsAt - 1), null, 'current authority cannot be backdated');
  assert.equal(canAccessFloor({ ...sim.worldDefinition.buildings.find(site => site.id === term.officeId)!, publicFloors: 1, floorPermissions: ['public', 'council', 'council'], requiredPermission: 'council' }, 1,
    { role: 'official', identities: ['official'] }), false, 'secondary political authority adds no council-only spatial permission');
});

test('single hall slots and real unpaid voter intervals never overlap paid work or another civic actor', () => {
  const { sim } = electedContext(), civic = sim.state.civicStaffing!;
  for (const poll of civic.polls) for (const ballot of poll.ballots) {
    const worked = ballot.windows.reduce((sum, window) => sum + window.endAt - window.startAt, 0);
    assert.ok(Math.abs(worked - ballot.workedMinutes) < 1e-7);
    for (const window of ballot.windows) {
      assert.ok(window.endAt - window.startAt <= window.phaseMinutes + 1e-7); assert.ok(window.startAt >= window.observedClock - window.phaseMinutes - 1e-7);
      for (const paid of window.excludedPaid) assert.ok(window.endAt <= paid.startAt + 1e-7 || window.startAt >= paid.endAt - 1e-7);
    }
    if (ballot.completedAt !== null) assert.equal(ballot.workedMinutes, 1);
  }
  validateCivicStaffing(sim.state, sim.worldDefinition);
  assert.equal(civicStaffingActorReservedThisTick(sim, 'nonexistent'), false);
});

test('natural term body and global/partition export restore byte-exact and continue 24 actual ticks', () => {
  const { sim } = electedContext(), saved = sim.exportSave();
  assert.equal(assembleSave(partitionSave(saved, sim.worldDefinition)), saved); civicExact24(sim);
});

test('cash/proof/individual ballots/quorum/term/official registry corruption rejects atomically', () => {
  const { sim, term } = electedContext(), saved = sim.exportSave();
  const mutations: [string, (data: any) => void][] = [
    ['missing original official', data => data.state.civicStaffing.originalOfficials.pop()],
    ['paid work fabricated', data => { data.state.civicStaffing.proofs.find((proof: any) => proof.id === term.proofId).minutes = 59; }],
    ['fee erased', data => { data.state.civicStaffing.applications.find((application: any) => application.pollId === term.pollId).receipt.amount = 0; }],
    ['living reserve removed', data => { data.state.civicStaffing.applications.find((application: any) => application.pollId === term.pollId).receipt.moneyAfter = 0; }],
    ['self witness', data => { const app = data.state.civicStaffing.applications.find((application: any) => application.pollId === term.pollId); app.receipt.witnesses[0].actorId = app.actorId; }],
    ['duplicate vote', data => { const poll = data.state.civicStaffing.polls.find((poll: any) => poll.id === term.pollId); poll.ballots.push(structuredClone(poll.ballots.find((ballot: any) => ballot.completedAt !== null))); }],
    ['shrunken eligible list', data => { data.state.civicStaffing.polls.find((poll: any) => poll.id === term.pollId).eligible.pop(); }],
    ['early count', data => { const poll = data.state.civicStaffing.polls.find((poll: any) => poll.id === term.pollId); poll.countedAt = poll.openedAt + 1; }],
    ['fake quorum', data => { data.state.civicStaffing.polls.find((poll: any) => poll.id === term.pollId).count.quorum = 0; }],
    ['infinite term', data => { data.state.civicStaffing.terms.find((value: any) => value.id === term.id).endsAt += 1440; }],
    ['body without marker', data => { delete data.runtime.civicStaffingVersion; }],
  ];
  for (const [label, mutate] of mutations) { const data = JSON.parse(saved); mutate(data); const result = sim.importSave(JSON.stringify(data)); assert.equal(result.ok, false, label); assert.equal(sim.exportSave(), saved, label + ' live state must remain atomic'); }
});

test('original employer change ends new authority while retaining the historical source and every wage debt', () => {
  const { sim, term } = electedContext(), source = civicCouncilSourceProof(sim.state, term.actorId)!;
  const person = sim.state.citizens.find(person => person.id === term.actorId)!, before = structuredClone(civicRuntime(sim).wageAccruals);
  // Explicit adverse state perturbation isolates the stop-authority guard; it
  // is not a legal appointment or evidence of an autonomous job transfer.
  person.workId = sim.worldDefinition.buildings.find(site => site.kind === 'farm' && site.districtId === term.districtId)!.id;
  assert.equal(civicCouncilSourceProof(sim.state, term.actorId), null);
  sim.step(.25); assert.equal(term.endedReason, 'profession-changed'); assert.ok(term.endedAt !== null);
  assert.equal(validateCivicCouncilSourceProof(sim.state, source), true, 'past actual signature stays valid');
  for (const old of before.filter((claim: any) => claim.citizenId === term.actorId)) assert.ok(civicRuntime(sim).wageAccruals.some((claim: any) => claim.citizenId === old.citizenId && claim.workId === old.workId && claim.amount >= old.amount));
});

test('real life terminal branch ends civic authority, retains past source and cannot revive or grant a new job', () => {
  const { sim, term } = electedContext(), source = civicCouncilSourceProof(sim.state, term.actorId)!, person = sim.state.citizens.find(person => person.id === term.actorId)!;
  // Declared terminal-health fixture only. Actual source is the original life
  // phase; no fake death event, actor resurrection, term or role is inserted.
  sim.state.extension!.actorProfiles[person.id].health = 0; const profession = { role: person.role, workId: person.workId, education: person.education };
  sim.step(.25); assert.equal(sim.state.extension!.actorProfiles[person.id].alive, false); assert.equal(term.endedReason, 'death');
  assert.equal(civicCouncilSourceProof(sim.state, term.actorId), null); assert.equal(validateCivicCouncilSourceProof(sim.state, source), true);
  assert.deepEqual({ role: person.role, workId: person.workId, education: person.education }, profession); assert.equal(person.state, 'dead');
});

test('legacy city loaded into new product clears civic mode and keeps immediate plus 24-tick full bytes', () => {
  const world = civicFixtureWorld(), legacy = new Simulation(world); legacy.command({ type: 'speed', value: 16 });
  const saved = legacy.exportSave(), product = createProductCity(world); assert.equal(product.importSave(saved).ok, true);
  assert.equal(product.effectiveRuleset, 'legacy'); assert.equal(product.state.civicStaffing, undefined); assert.equal(product.exportSave(), saved);
  for (let tick = 0; tick < 24; tick++) { legacy.step(.25); product.step(.25); assert.equal(product.exportSave(), legacy.exportSave(), `disabled civic legacy continuation ${tick + 1}`); }
});

test('display-clock edits neither add paid proof nor skip the two-day civic deadline', () => {
  const sim = civicFixture(); civicUntil(sim, () => !!sim.state.civicStaffing!.polls.length, 140, 'real ordinary proof and paid registration');
  civicArtifact('first-real-registration.save.json', sim.exportSave(), true); civicArtifact('first-real-registration.world.json', sim.worldDefinition);
  const civic = structuredClone(sim.state.civicStaffing), at = businessClock(sim);
  for (const hour of [1, 23]) {
    assert.equal(sim.command({ type: 'setTime', value: hour }).ok, true); assert.equal(businessClock(sim), at);
    assert.deepEqual(sim.state.civicStaffing, civic); const saved = sim.exportSave(), restored = createProductCity(sim.worldDefinition);
    const result = restored.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(restored.exportSave(), saved);
  }
});
