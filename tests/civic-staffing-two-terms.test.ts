import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createProductCity } from '../src/product-city.ts';
import { isCanonicalNpcWage } from '../src/simulation.ts';
import { civicCouncilSourceProof, validateCivicCouncilSourceProof, validateCivicStaffing, CIVIC_POLL_MINUTES, CIVIC_TERM_MINUTES } from '../src/simulation/civic-staffing.ts';
import { civicArtifact, civicFixture, civicSameHallTerms, civicUntil, civicExact24, businessClock } from './civic-staffing-fixture.ts';

test('two separate natural two-day polls create two actual same-hall secondary terms and simultaneous native paid authority', () => {
  const resumeSave = process.env.CIVIC_RESUME_SAVE, resumeWorld = process.env.CIVIC_RESUME_WORLD;
  assert.equal(!!resumeSave, !!resumeWorld, 'resume provenance requires both exact original save and world');
  const sim = resumeSave ? createProductCity(JSON.parse(readFileSync(resumeWorld!, 'utf8'))) : civicFixture();
  if (resumeSave) { const saved = readFileSync(resumeSave, 'utf8'), result = sim.importSave(saved); assert.equal(result.ok, true, result.message); assert.equal(sim.exportSave(), saved); }
  const original = new Map(sim.state.citizens.map(person => [person.id, { role: person.role, workId: person.workId, education: person.education }]));
  const pair = civicSameHallTerms(sim, resumeSave ? 900 : 1650), civic = sim.state.civicStaffing!;
  assert.equal(pair[0].officeId, pair[1].officeId); assert.notEqual(pair[0].actorId, pair[1].actorId); assert.notEqual(pair[0].pollId, pair[1].pollId);
  for (const term of pair) {
    const poll = civic.polls.find(poll => poll.id === term.pollId)!, application = civic.applications.find(application => application.id === poll.applicationId)!;
    assert.equal(poll.closesAt - poll.openedAt, CIVIC_POLL_MINUTES); assert.ok(poll.countedAt! >= poll.closesAt);
    assert.equal(poll.result, 'elected'); assert.ok(poll.count!.turnout >= poll.count!.quorum && poll.count!.support > poll.count!.retain);
    assert.equal(application.receipt!.amount, 120); assert.ok(application.receipt!.moneyAfter >= 100); assert.equal(application.receipt!.witnesses.length, 2);
    assert.equal(term.endsAt - term.startsAt, CIVIC_TERM_MINUTES);
    const person = sim.state.citizens.find(person => person.id === term.actorId)!;
    assert.deepEqual({ role: person.role, workId: person.workId, education: person.education }, original.get(person.id));
  }
  const nativePaid = new Map<string, { tick: number; startAt: number; endAt: number; minutes: number; amount: number }>();
  sim.onEvent('wage-earned', event => {
    if (isCanonicalNpcWage(event) && event.siteId === pair[0].officeId && pair.some(term => term.actorId === event.citizenId))
      nativePaid.set(event.citizenId!, { tick: sim.state.tick, startAt: event.creditedWorkStartAt!, endAt: event.creditedWorkEndAt!, minutes: event.minutes!, amount: event.amount! });
  });
  const simultaneous = () => {
    const paid = pair.map(term => nativePaid.get(term.actorId));
    return paid.every(paid => paid && paid.tick === sim.state.tick && paid.minutes > 0 && paid.amount > 0)
      && Math.max(...paid.map(paid => paid!.startAt)) < Math.min(...paid.map(paid => paid!.endAt));
  };
  civicUntil(sim, simultaneous, 300, 'both elected original officials must actually return to the same paid hall at the same tick');
  const sources = pair.map(term => civicCouncilSourceProof(sim.state, term.actorId)!);
  assert.ok(sources.every(source => !!source && validateCivicCouncilSourceProof(sim.state, source)));
  validateCivicStaffing(sim.state, sim.worldDefinition);
  civicArtifact('two-natural-same-hall-terms.save.json', sim.exportSave(), true); civicArtifact('two-natural-same-hall-terms.world.json', sim.worldDefinition);
  const summary = { input: resumeSave ? 'exact prior actual first-natural-term save/world continuation' : 'declared pre-constructor compact parameter city', tick: sim.state.tick, clock: businessClock(sim),
    pair, sources, actualPaid: Object.fromEntries(nativePaid), counts: pair.map(term => civic.polls.find(poll => poll.id === term.pollId)!.count),
    finiteHistory: { proofs: civic.proofs.length, retiredProofCount: civic.retiredProofCount, applications: civic.applications.length, polls: civic.polls.length, terms: civic.terms.length } };
  civicArtifact('two-natural-same-hall-terms.summary.json', summary); console.log('CIVIC same-hall source', JSON.stringify(summary));
  civicExact24(sim); civicArtifact('two-natural-same-hall-terms-after-24.save.json', sim.exportSave(), true);
});
