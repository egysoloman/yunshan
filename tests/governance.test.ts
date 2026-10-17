import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { world } from './governance-fixture.ts';
import { runtime, at, advance } from './clinical-presence-fixture.ts';
import { electionCounts, ELECTION_MINUTES, MAYOR_TERM_MINUTES } from '../src/simulation/governance.ts';

// Small native city; facilities are declared before either constructor. The
// councillors, employment, wages, shops and population remain constructor data.
// Only the player's qualifications and a single initial councillor work intent
// are controlled. These cases do not prove natural commuting or fourteen-day
// default-world viability. No repeated pins, wallet, needs or role resets.

function setup() {
  const sim = new Simulation(world());
  const hall = sim.worldDefinition.buildings.find(b => b.kind === 'hall')!;
  const work = hall.functionPoints!.find(p => p.floor === 0 && p.purpose === 'work')!;
  assert.ok(work, 'native geometry supplies a real council station');
  sim.setFocus(work.position, 'walk');
  Object.assign(sim.state.player, { education: 2, experience: 4, reputation: 8 });
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  return { sim, hall, work };
}
function register(context: ReturnType<typeof setup>) {
  const { sim, hall } = context, before = sim.state.player.money, treasury = sim.state.treasury;
  const result = sim.command({ type: 'election', targetId: hall.id });
  assert.equal(result.ok, true, result.message);
  assert.equal(sim.state.player.money, before - 120);
  assert.equal(sim.state.treasury, treasury + 120);
  assert.equal(runtime(sim).campaign, null, 'new elections do not schedule aggregate legacy tally');
  return sim.state.governance!.elections.at(-1)!;
}
function clone24(sim: Simulation) {
  const restored = new Simulation(sim.worldDefinition), saved = sim.exportSave();
  assert.equal(restored.importSave(saved).ok, true);
  assert.equal(restored.exportSave(), saved);
  for (let tick = 0; tick < 24; tick++) {
    sim.step(.25); restored.step(.25);
    assert.equal(restored.exportSave(), sim.exportSave(), `actual continuation tick ${tick + 1}`);
  }
}
test('one real resident one vote; monotonic registration period, exact continuation and finite term', () => {
  const context = setup(), { sim } = context, election = register(context);
  const openedAt = at(sim);
  assert.equal(sim.command({ type: 'setTime', value: 12 }).ok, true);
  assert.equal(at(sim), openedAt, 'display clock must not advance ballot deadline');
  sim.step(.25);
  assert.ok(election.ballots.length > 0);
  assert.equal(new Set(election.ballots.map(b => b.actorId)).size, election.ballots.length);
  assert.equal(election.countedAt, null);
  clone24(sim);
  advance(sim, ELECTION_MINUTES - (at(sim) - openedAt));
  const counts = electionCounts(election);
  assert.equal(counts.turnout, counts.eligible);
  assert.ok(counts.candidate > counts.retain, `actual candidate=${counts.candidate} retain=${counts.retain}`);
  assert.equal(election.result, 'elected');
  assert.equal(sim.state.governance!.term!.endsAt - sim.state.governance!.term!.startsAt, MAYOR_TERM_MINUTES);
  assert.equal(sim.hasIdentity('mayor'), true);
  const wonSave = sim.exportSave(), missingTerm = JSON.parse(wonSave);
  missingTerm.state.governance.term = null;
  assert.equal(sim.importSave(JSON.stringify(missingTerm)).ok, false, 'new mayor cannot delete fourteen-day term');
  assert.equal(sim.exportSave(), wonSave);
  assert.equal(sim.command({ type: 'election', targetId: context.hall.id }).ok, false);
  clone24(sim);
});
test('real native council must attend funded work and approve before policy applies', () => {
  const context = setup(), { sim, hall, work } = context;
  // Legacy mandate fixture: existing ownership of mayor identity is preserved.
  sim.state.player.identities = [...sim.state.player.identities!, 'mayor'];
  sim.state.player.role = 'mayor';
  const actors = sim.state.citizens.filter(c => c.workId === hall.id && c.role === '议员' && sim.state.extension!.actorProfiles[c.id].age >= 18);
  assert.ok(actors.length >= 2, 'constructor supplies actual adult council roster');
  const result = sim.command({ type: 'policy', targetId: hall.id, taxRate: .1, policeBudget: .35 });
  assert.equal(result.ok, true, result.message);
  const motion = sim.state.governance!.motions.at(-1)!;
  assert.equal(motion.seats.length, actors.length);
  assert.equal(motion.ballots.length, 0);
  assert.equal(sim.state.policyPending, undefined);
  for (const actor of actors) {
    actor.position = { ...work.position }; actor.destinationId = hall.id;
    actor.route = [{ ...work.position }]; actor.routeIndex = 1;
    runtime(sim).activities[actor.id] = 'work'; runtime(sim).decisionAt[actor.id] = sim.state.hour * 60 + 60;
  }
  advance(sim, 16);
  assert.ok(motion.ballots.length >= motion.quorum, `funded native votes=${motion.ballots.length}/${motion.quorum}`);
  for (const ballot of motion.ballots) {
    assert.equal(ballot.workId, hall.id);
    assert.ok(runtime(sim).wageAccruals.some((w: { citizenId: string; amount: number }) => w.citizenId === ballot.actorId && w.amount > 0));
  }
  assert.equal(motion.status, 'approved');
  assert.notEqual(sim.state.taxRate, .1);
  assert.equal(sim.command({ type: 'policy', targetId: hall.id, taxRate: .2 }).ok, false);
  const approvedSave = sim.exportSave(), airborne = JSON.parse(approvedSave);
  airborne.state.governance.motions[0].ballots[0].position.y += 100;
  assert.equal(sim.importSave(JSON.stringify(airborne)).ok, false, 'real council vote needs supported physical work station');
  assert.equal(sim.exportSave(), approvedSave);
  advance(sim, motion.readyAt - at(sim));
  assert.equal(motion.status, 'applied');
  assert.equal(sim.state.taxRate, .1); assert.equal(sim.state.policeBudget, .35);
  assert.equal(sim.state.governance!.legacyMandate, true);
  clone24(sim);
});
test('bad ballot, count, term and module linkage imports reject atomically', () => {
  const context = setup(), { sim } = context; register(context); sim.step(.25);
  const saved = sim.exportSave();
  const attempts = [
    (s: any) => s.state.governance.elections[0].ballots.push({ ...s.state.governance.elections[0].ballots[0] }),
    (s: any) => { s.state.governance.elections[0].ballots[0].choice = s.state.governance.elections[0].ballots[0].choice === 'candidate' ? 'retain' : 'candidate'; },
    (s: any) => { s.state.governance.archive.registrationFees = 120; },
    (s: any) => { Object.assign(s.state.governance.elections[0].ballots[0], { choice: 'withdrawn', score: 0, threshold: 0 }); },
    (s: any) => { delete s.runtime.governanceVersion; },
    (s: any) => { delete s.state.governance; },
    (s: any) => { s.runtime.campaign = { countAt: 604, votes: 100 }; },
    (s: any) => { s.state.policyPending = { applyAt: 604, taxRate: .1, policeBudget: .5 }; },
    (s: any) => { s.runtime.persistedModules = s.runtime.persistedModules.filter((m: string) => m !== 'governance'); },
  ];
  for (const mutate of attempts) {
    const forged = JSON.parse(saved); mutate(forged);
    const rejected = sim.importSave(JSON.stringify(forged));
    assert.equal(rejected.ok, false, rejected.message);
    assert.equal(sim.exportSave(), saved, 'rejection must preserve live state and runtime');
  }
  clone24(sim);
});
test('cold supported city preserves genuine original save and every following tick before activation', () => {
  const origin = JSON.parse(readFileSync(new URL('./fixtures/governance-old18/cold.json', import.meta.url), 'utf8'));
  assert.equal(origin.sourceCommit, 'aeca2679bd984527273c334def2672ad83fe758f');
  assert.equal(origin.followingSha256.length, 24);
  const candidate = new Simulation(world());
  assert.equal(candidate.importSave(origin.save).ok, true);
  assert.equal(candidate.exportSave(), origin.save);
  assert.equal(candidate.state.governance, undefined);
  for (let tick = 0; tick < 24; tick++) {
    candidate.step(.25);
    assert.equal(createHash('sha256').update(candidate.exportSave()).digest('hex'), origin.followingSha256[tick], `genuine unactivated native tick ${tick + 1}`);
  }
});
test('last credited two-minute council slice retains actual votes at the daily attendance cap', () => {
  const { sim, hall, work } = setup();
  sim.state.player.identities = [...sim.state.player.identities!, 'mayor']; sim.state.player.role = 'mayor';
  const actors = sim.state.citizens.filter(c => c.workId === hall.id && c.role === '议员' && sim.state.extension!.actorProfiles[c.id].age >= 18);
  // Explicit daily-cap fixture. This is not a claim of 478 naturally earned
  // minutes: the next two minutes must still come from original real payroll.
  for (const actor of actors) {
    actor.position = { ...work.position }; actor.destinationId = hall.id; actor.route = [{ ...work.position }]; actor.routeIndex = 1;
    runtime(sim).attendance[actor.id] = 478; runtime(sim).activities[actor.id] = 'work'; runtime(sim).decisionAt[actor.id] = 540;
  }
  sim.setFocus(work.position, 'walk'); // Ordinary focus refresh; no direct tier edit.
  const wages: { citizenId?: string; minutes?: number }[] = [];
  sim.onEvent('wage-earned', event => wages.push({ citizenId: event.citizenId, minutes: event.minutes }));
  const submitted = sim.command({ type: 'policy', targetId: hall.id, taxRate: .1 }); assert.equal(submitted.ok, true, submitted.message);
  sim.step(.25);
  const motion = sim.state.governance!.motions.at(-1)!;
  assert.equal(motion.status, 'approved');
  assert.ok(motion.ballots.length >= motion.quorum);
  for (const ballot of motion.ballots) {
    assert.equal(runtime(sim).attendance[ballot.actorId], 480);
    assert.equal(wages.find(w => w.citizenId === ballot.actorId)?.minutes, 2);
    // Core isOnDuty describes funded shift eligibility, not its separate
    // daily attendance counter. Do not infer shift exhaustion from 480 here.
  }
});
test('genuine pending old18 campaign keeps original fee and count through thirty-two exact ticks', () => {
  const origin = JSON.parse(readFileSync(new URL('./fixtures/governance-old18/campaign.json', import.meta.url), 'utf8'));
  const candidate = new Simulation(world());
  assert.equal(origin.sourceCommit, 'aeca2679bd984527273c334def2672ad83fe758f'); assert.equal(origin.followingSha256.length, 32);
  const loaded = candidate.importSave(origin.save); assert.equal(loaded.ok, true, loaded.message); assert.equal(candidate.exportSave(), origin.save);
  assert.equal(candidate.state.governance, undefined);
  // followingSha256 are the whole-city bytes the source commit wrote. Later
  // unrelated rules (whole school levels from 9f1d9dc, then food and petitions)
  // change other residents from tick 11, so the city bytes are exact only up to
  // there; the campaign itself is checked against the source run's own result:
  // counted at tick 30 at 63.6% with no further fee, and no new political body.
  const money = candidate.state.player.money, campaign = structuredClone(runtime(candidate).campaign);
  assert.deepEqual(campaign, { countAt: 600, votes: 63.6 });
  for (let tick = 0; tick < 32; tick++) {
    candidate.step(.25);
    if (tick < 10) assert.equal(createHash('sha256').update(candidate.exportSave()).digest('hex'), origin.followingSha256[tick], `source bytes tick ${tick + 1}`);
    assert.equal(candidate.state.player.money, money, `original fee only, tick ${tick + 1}`); assert.equal(candidate.state.governance, undefined);
    if (tick < 29) assert.deepEqual(runtime(candidate).campaign, campaign, `pending campaign unchanged, tick ${tick + 1}`);
    else assert.equal(runtime(candidate).campaign ?? null, null, `counted at the source tick ${tick + 1}`);
  }
  assert.equal(candidate.hasIdentity('mayor'), true); assert.equal(candidate.state.governance, undefined);
  assert.ok(candidate.state.events.some(event => event.text === '计票完成：支持率63.6%，你当选云山市长。'));
});
