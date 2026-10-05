import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Simulation } from '../src/simulation.ts';
import type { SimState } from '../src/types.ts';
import { settleDeceasedAccount, type BankingState } from '../src/simulation/banking.ts';
import { cancelFamilyCourse, type FamilyEducationCourse, type FamilyEducationState } from '../src/simulation/family-education.ts';
import { advance, at, close, familyFeeCash, familyFeeFixture, partitionContinue24, pin, station } from './family-fee-education-fixture.ts';

// The actual regression reuses the established 384-resident/nine-building
// family fixture. Saved age/relationship boundaries, classroom and bank
// positions, needs and one fatal-health boundary are controlled explicitly.
// Original roles, wallets, materials, loan/deposit commands, paid teacher
// minutes, course procurement, refunds and estate execution remain real.
// The `pure contract` cases below instantiate no Simulation and are not saves.
const output = process.env.YUNSHAN_FAMILY_ESTATE_EVIDENCE;
function record(name: string, value: string | object): void {
  if (!output) return;
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

test('actual finite loan and earned child tuition refund repay deceased payer debt before inheritance and continue exactly', () => {
  const context = familyFeeFixture(), { sim, child, site, spouse, teacher, controls } = context;
  const bankSite = sim.worldDefinition.buildings.find(building => building.kind === 'bank')!;
  const lender = sim.state.citizens.filter(person => person.id !== spouse.id && person.id !== teacher.id
    && person.money >= 400 + 100 && sim.state.extension!.actorProfiles[person.id].alive)[0]
    ?? sim.state.citizens.filter(person => person.id !== spouse.id && person.id !== teacher.id
      && person.money > 400 && sim.state.extension!.actorProfiles[person.id].alive).sort((a, b) => b.money - a.money)[0];
  assert.ok(lender, 'a genuine constructor wallet can deposit original cash at the bank');
  const supply = familyFeeCash(sim), lenderWallet = lender.money;
  pin(sim, controls, lender.id, bankSite, station(bankSite));
  sim.step(.25);
  const bank = sim.state.banking!, deposit = bank.receipts.find(receipt => receipt.actorId === lender.id && receipt.kind === 'deposit');
  assert.ok(deposit && deposit.amount === 100, 'ordinary bank people phase deposits original resident cash');
  assert.equal(lender.money, lenderWallet - deposit.amount);
  assert.equal(bank.accounts[lender.id].deposits, deposit.amount);
  assert.equal(bank.accounts.player.deposits, 0, 'borrower has no deposit offset that could conceal lost debt priority');
  sim.setFocus(station(bankSite), 'walk');
  const wallet = sim.state.player.money, loan = sim.command({ type: 'loan', targetId: bankSite.id, value: 20 });
  assert.equal(loan.ok, true, loan.message);
  assert.equal(sim.state.player.money, wallet + 20);
  assert.equal(bank.accounts.player.loanPrincipal, 20);
  assert.ok(bank.receipts.some(receipt => receipt.actorId === 'player' && receipt.kind === 'loan' && receipt.amount === 20));
  sim.setFocus(station(site), 'walk');
  const enrolled = sim.command({ type: 'enrollFamilyCourse', targetId: child.id });
  assert.equal(enrolled.ok, true, enrolled.message);
  const course = sim.state.familyEducation!.active[0];
  for (let tick = 0; course.reservedUnits !== 1 && tick < 16; tick++) sim.step(.25);
  assert.equal(course.reservedUnits, 1, course.reason);
  advance(sim, 4);
  assert.ok(course.workedMinutes > 0 && course.workedMinutes < 60, 'original teacher has actually earned only part of the tuition');
  assert.ok(course.staffMinutes[teacher.id] > 0);
  assert.ok(course.receipt && course.purchasePaid > 0, 'actual supplier and paid textbook are retained');
  const organization = sim.state.extension!.organizations.find(group => group.kind === 'charity')
    ?? sim.state.extension!.organizations[0];
  assert.ok(organization);
  const donation = Math.floor(sim.state.player.money), organizationFunds = organization.funds;
  assert.ok(donation >= 10 && donation <= 10000);
  const donated = sim.command({ type: 'donate', targetId: organization.id, value: donation });
  assert.equal(donated.ok, true, donated.message);
  assert.equal(organization.funds, organizationFunds + donation);
  const account = bank.accounts.player, debt = account.loanPrincipal + account.loanInterest;
  const refundable = course.escrow, remainingWallet = sim.state.player.money, earned = course.workedMinutes;
  assert.ok(remainingWallet < 1 && refundable > debt && debt > 0, 'finite unpaid debt requires the real pending tuition refund');
  const losses = bank.stats.losses, repaid = bank.stats.repaid, purchasePaid = course.purchasePaid;
  close(familyFeeCash(sim), supply, 'native deposit, loan, procurement, salary and donation transfer cash without a grant');
  record('actual-before-death.save.json', sim.exportSave());
  record('actual-before-death.json', { actorId: 'player', lenderId: lender.id, teacherId: teacher.id, childId: child.id,
    clock: at(sim), tick: sim.state.tick, debt, refundable, remainingWallet, losses, repaid, course,
    controlledPositionsNeedsAges: true, controlledFatalHealthNext: true, fabricatedMoneyMaterialWage: false });
  // Exactly one declared fatal-health control; native life/family/tuition
  // phases perform death, refund, debt collection and lawful inheritance.
  sim.state.extension!.actorProfiles.player.health = 0;
  sim.step(.25);
  const estate = sim.state.family!.estates.player;
  record('actual-after-death.save.json', sim.exportSave());
  record('actual-after-death.json', { course, estate, bank, physicalCash: familyFeeCash(sim), expectedCash: supply,
    expectedDebtPaid: debt, expectedInherited: remainingWallet + refundable - debt });
  assert.equal(sim.state.extension!.actorProfiles.player.alive, false);
  assert.ok(estate && estate.heirIds.includes(spouse.id) && estate.heirIds.includes(child.id));
  assert.equal(course.status, 'cancelled');
  assert.equal(course.workedMinutes, earned); assert.equal(course.purchasePaid, purchasePaid);
  close(course.refunded, refundable); assert.equal(course.escrow, 0);
  assert.equal(course.consumedUnits, 0); assert.equal(sim.state.familyEducation!.stock[site.id].availableUnits, 1);
  close(bank.stats.losses, losses, 'refundable original tuition prevents premature bank debt writeoff');
  close(estate.bankSettlement!.debtPaid, debt, 'actual outstanding principal and interest are collected first');
  close(bank.stats.repaid - repaid, debt);
  assert.equal(account.loanPrincipal, 0); assert.equal(account.loanInterest, 0);
  assert.equal(account.closed, true); assert.equal(estate.bankSettlement!.closed, true);
  close(estate.cash, remainingWallet + refundable - debt, 'only net estate cash passes to original legal heirs');
  assert.equal(sim.state.player.money, 0); assert.equal(child.education, 0);
  close(familyFeeCash(sim), supply, 'refund, debt settlement and inheritance conserve every physical account');
  partitionContinue24(context);
  close(familyFeeCash(sim), supply);
  record('actual-after24.save.json', sim.exportSave());
});

function emptyBank(): BankingState {
  return { version: 1, cash: 0, legacyInvestmentCash: 0, legacyInvestmentPrincipal: 0, nextInterestAt: 60,
    nextReceiptId: 1, profitAvailable: 0, accounts: {}, nextVisitAt: {}, receipts: [],
    stats: { deposited: 0, withdrawn: 0, loaned: 0, repaid: 0, loanInterestPaid: 0, depositInterestCredited: 0, losses: 0 } };
}

/** Pure cross-module input model, deliberately not a schema-valid world/save.
 * Finite opening receivables exercise settlement guards without generating
 * loan/deposit/wage events or inventing a citizen in the actual simulator. */
function settlementContract(payerId: string, escrow?: number): Simulation {
  const bank = emptyBank();
  for (const id of ['player', payerId, 'heir']) bank.accounts[id] = { deposits: 0, loanPrincipal: 0, loanInterest: 0, interestDue: 0, closed: false };
  bank.accounts[payerId].loanPrincipal = 20;
  const state = { tick: 1, player: { money: 0, inventory: {} }, citizens: [{ id: 'payer', money: 0 }, { id: 'heir', money: 0 }], shops: [],
    banking: bank, bankBalance: 0, loan: payerId === 'player' ? 20 : 0, extension: { lastUpdate: 1, actorProfiles: { player: { alive: payerId !== 'player' }, payer: { alive: payerId !== 'payer' }, heir: { alive: true } }, companies: [] },
    ...(escrow === undefined ? {} : { familyEducation: { active: [{ payerId, escrow }] } }) } as unknown as SimState;
  return { state } as Simulation;
}

for (const payerId of ['player', 'payer']) test(`pure contract: ${payerId} original pending tuition prevents premature loss and repeated settlement does not consume escrow`, () => {
  const sim = settlementContract(payerId, 30), before = JSON.stringify(sim.state);
  assert.deepEqual(settleDeceasedAccount(sim, payerId, ['heir']), { debtPaid: 0, depositClaimsTransferred: 0, unpaidLoss: 0, closed: false });
  assert.equal(JSON.stringify(sim.state), before, 'pending claim and funds remain intact');
  assert.equal(settleDeceasedAccount(sim, payerId, ['heir']).closed, false);
  assert.equal(sim.state.banking!.accounts[payerId].loanPrincipal, 20);
  assert.equal(sim.state.familyEducation!.active[0].escrow, 30);
  assert.equal(sim.state.banking!.stats.losses, 0);
});

test('pure contract: no course retains original real-loss estate behavior and another payer custody cannot block it', () => {
  for (const escrow of [undefined, 0]) {
    const sim = settlementContract('payer', escrow);
    assert.deepEqual(settleDeceasedAccount(sim, 'payer', ['heir']), { debtPaid: 0, depositClaimsTransferred: 0, unpaidLoss: 20, closed: true });
    assert.equal(sim.state.banking!.stats.losses, 20);
    const once = JSON.stringify(sim.state); settleDeceasedAccount(sim, 'payer', ['heir']); assert.equal(JSON.stringify(sim.state), once);
  }
  const unrelated = settlementContract('payer', 30); unrelated.state.familyEducation!.active[0].payerId = 'player';
  assert.equal(settleDeceasedAccount(unrelated, 'payer', ['heir']).unpaidLoss, 20);
});

test('pure contract: capped payer retains full refundPending custody and releases exactly once after a finite external transfer', () => {
  // Explicit fully funded opening contract boundary, not generated wealth or
  // an importable citizen/save. Original cancel/refund code performs both calls.
  const course: FamilyEducationCourse = { id: 'family-course-1', actorId: 'child', payerId: 'player', guardianKind: 'parent', guardianIds: ['player'],
    siteId: 'school', pointId: 'legacy:0', point: { x: 0, y: .6, z: 0 }, floor: 0, startedAt: 0, lastObservedAt: 1,
    requiredMinutes: 60, workedMinutes: 0, staffMinutes: {}, status: 'awaitingSupply', reason: '', resumeRequired: false,
    funded: 40, escrow: 40, purchasePaid: 0, serviceFees: 0, refunded: 0, receivedUnits: 0, reusedUnits: 0,
    reservedUnits: 0, consumedUnits: 0, receipt: null, retryAt: 0, completedAt: null, cancelledAt: null };
  const education: FamilyEducationState = { version: 1, nextId: 2, lastObservedAt: 1, active: [course], pages: [], stock: {},
    totals: { funded: 40, purchasePaid: 0, serviceFees: 0, refunded: 0, workedMinutes: 0, completed: 0, cancelled: 0 } };
  const state = { tick: 1, player: { money: 1e9 }, extension: { lastUpdate: 1, actorProfiles: { player: { age: 28, alive: true } }, publicLedger: [] },
    familyEducation: education } as unknown as SimState;
  const sim = { state, worldDefinition: { buildings: [{ id: 'school', districtId: 'district' }] } } as unknown as Simulation;
  assert.equal(cancelFamilyCourse(sim, course.id).ok, true);
  assert.equal(course.status, 'refundPending'); assert.equal(course.escrow, 40); assert.equal(course.refunded, 0);
  assert.equal(education.active[0], course); assert.equal(education.pages.length, 0);
  const pending = JSON.stringify(state); assert.equal(cancelFamilyCourse(sim, course.id).ok, true); assert.equal(JSON.stringify(state), pending);
  let counterparty = 0; const physicalBefore = state.player.money + course.escrow + counterparty;
  // A bounded contract-side transfer creates receiver capacity; both sides
  // are counted, and no simulator financial event is forged for this boundary.
  state.player.money -= 40; counterparty += 40;
  assert.equal(cancelFamilyCourse(sim, course.id).ok, true);
  assert.equal(course.status, 'cancelled'); assert.equal(course.escrow, 0); assert.equal(course.refunded, 40);
  assert.equal(education.active.length, 0); assert.equal(education.pages[0][0], course);
  assert.equal(state.player.money + course.escrow + counterparty, physicalBefore);
  const settled = JSON.stringify(state); assert.equal(cancelFamilyCourse(sim, course.id).ok, false); assert.equal(JSON.stringify(state), settled);
});
