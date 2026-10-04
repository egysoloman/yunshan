import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation.ts';
import { createProductCity } from '../src/product-city.ts';
import { upgradeCityRuleset } from '../src/host/upgrade-city-ruleset.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { currentCivicBudgetSignature } from '../src/simulation/budget-authority.ts';
import { civicFixtureWorld } from './civic-staffing-fixture.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('BudgetAuthority1 has a complete v3 pair and rejects halves, downgrade, fake history and cutover edits atomically', () => {
  const world = civicFixtureWorld(), city = createProductCity(world), opening = city.exportSave();
  const changes: [string, (d: any) => void, boolean?][] = [
    ['body deleted', d => delete d.state.budgetAuthority, true],
    ['marker deleted', d => delete d.runtime.budgetAuthorityVersion, true],
    ['manifest omitted', d => d.runtime.persistedModules = d.runtime.persistedModules.filter((s: string) => s !== 'budgetAuthority'), true],
    ['manifest duplicate', d => d.runtime.persistedModules.push('budgetAuthority'), true],
    ['unknown body version', d => d.state.budgetAuthority.version = 2, true],
    ['unknown marker version', d => d.runtime.budgetAuthorityVersion = 2, true],
    ['wrong enablement', d => d.state.budgetAuthority.enablementId += 'wrong', true],
    ['borrowed source SHA', d => d.state.budgetAuthority.legacySourceSha256 = 'a'.repeat(64), true],
    ['downgrade native2', d => d.version = 2, true],
    ['downgrade legacy1', d => d.version = 1, true],
    ['unknown authority field', d => d.state.budgetAuthority.trusted = true],
    ['new city cannot invent original authorization', d => d.state.budgetAuthority.legacyAuthorizationRefs.push({ id: 'service-1-supplement-1', authorizationSha256: 'a'.repeat(64) })],
    ['request body missing', d => d.state.budgetAuthority.requestIds.push('service-1-supplement-1')],
    ['duplicate request identity', d => d.state.budgetAuthority.requestIds.push('service-1-supplement-1','service-1-supplement-1')],
    ['negative source marker', d => d.state.budgetAuthority.legacySourceSha256 = false, true],
    ['new role-only budget cannot bypass strict V2 reader', d => (d.runtime.publicBudgets ??= []).push({ id: 'service-1-supplement-1', siteId: 'civic-0-hall', purpose: 'civic-education-supplement', cap: 160, approvedAt: 480, approvedBy: ['citizen-1','citizen-2'], signatures: [{actorId:'citizen-1',role:'council',siteId:'civic-0-hall',signedAt:480},{actorId:'citizen-2',role:'council',siteId:'civic-0-hall',signedAt:480}], spent:0, closedAt:null })],
  ];
  for (const [label, mutate, structural] of changes) {
    const d = JSON.parse(opening); mutate(d); const raw = JSON.stringify(d);
    assert.equal(city.importSave(raw).ok, false, label);
    assert.equal(city.exportSave(), opening, `${label}: full reader leaves every byte unchanged`);
    if (structural) assert.throws(() => partitionSave(raw, world), /ruleset/, label);
  }
  const pieces = partitionSave(opening, world), global = pieces.find(p => p.id === 'global')!;
  const d = JSON.parse(global.json); delete d.document.state.budgetAuthority; global.json = JSON.stringify(d);
  assert.throws(() => assembleSave(pieces), /ruleset/);
});

test('fresh actual paid officials without elected terms and generic wage copies cannot create natural budget signatures', () => {
  const city = createProductCity(civicFixtureWorld()), officials = city.state.civicStaffing!.originalOfficials;
  assert.ok(officials.length > 2);
  const before = city.exportSave();
  for (const person of officials.slice(0,2)) {
    assert.equal(currentCivicBudgetSignature(city, person.actorId), null);
    city.emitEvent({type:'wage-earned', citizenId:person.actorId, siteId:person.workId, amount:1,minutes:1,ratePerMinute:1,creditedWorkStartAt:479,creditedWorkEndAt:480});
    assert.equal(currentCivicBudgetSignature(city, person.actorId), null);
  }
  assert.equal(city.exportSave(), before);
  assert.equal(city.authorizePublicBudget({id:'service-1-supplement-1',siteId:officials[0].workId,purpose:'civic-education-supplement',cap:160,approvedAt:480,approvedBy:officials.slice(0,2).map(o => o.actorId)}), false);
  assert.equal(city.authorizeCivicSupplementalBudget({id:'service-1-supplement-1',siteId:officials[0].workId,purpose:'civic-education-supplement',cap:160,approvedAt:480,approvedBy:officials.slice(0,2).map(o => o.actorId)}), false);
  assert.equal(city.exportSave(), before);
});

test('actual legacy native2 remains disabled until explicit stable host cutover, with whole/partition future24 byte equality', async () => {
  const world = civicFixtureWorld(), city = new Simulation(world), original = city.exportSave(), oldClone = createProductCity(world);
  assert.equal(oldClone.importSave(original).ok, true); assert.equal(oldClone.exportSave(), original);
  for (let tick = 0; tick < 24; tick++) {
    city.step(.25); oldClone.step(.25); assert.equal(oldClone.exportSave(), city.exportSave());
    assert.equal(oldClone.effectiveRuleset, 'legacy'); assert.equal(oldClone.state.budgetAuthority, undefined);
  }
  const before = city.exportSave();
  city.emitEvent({type:'upgrade-city-ruleset',purpose:'civic-local-v1'}); assert.equal(city.exportSave(), before);
  assert.equal((await upgradeCityRuleset(city, '0'.repeat(64))).ok, false); assert.equal(city.exportSave(), before);
  const result = await upgradeCityRuleset(city, hash(before)); assert.equal(result.ok, true, result.message);
  assert.equal(city.state.budgetAuthority!.legacySourceSha256, hash(before));
  assert.deepEqual(city.state.budgetAuthority!.legacyAuthorizationRefs, []);
  assert.deepEqual(city.state.budgetAuthority!.requestIds, []);
  assert.deepEqual(city.state.civicStaffing!.terms, []);
  const save = city.exportSave(), restored = new Simulation(world), partition = new Simulation(world);
  assert.equal(restored.importSave(save).ok, true); assert.equal(restored.exportSave(), save);
  assert.equal(partition.importSave(assembleSave(partitionSave(save,world))).ok, true); assert.equal(partition.exportSave(),save);
  for (let tick=0; tick<24; tick++) { city.step(.25);restored.step(.25);partition.step(.25);assert.equal(restored.exportSave(),city.exportSave());assert.equal(partition.exportSave(),city.exportSave()); }
});
