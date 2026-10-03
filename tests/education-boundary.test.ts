import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation.ts';
import { assembleSave, partitionSave, type SavePart } from '../src/persistence/partition.ts';
import { bankingAvailableLoanCash, bankingBalanceSheet, settleDeceasedAccount } from '../src/simulation/banking.ts';
import { advance, attachControls, begin, cash, close, course, education, fundedMaterial, ledger, pin, setup, station, type Controls } from './education-fixture.ts';

// CODEPREP / NOT_RUN. Install only into the later joint revision's tests directory.
// Bound to REV02 patch 93ad364c042684b85a3eee1c1f4a9afd3c7b4e680a13c8f27e9f1850bfa73551.
// The existing fixture controls classroom positions and needs. Original commands,
// procurement, paid teacher attendance, material stock and course earnings still run.
// Malformed save copies, the explicitly declared capacity opening and the
// controlled death boundary are labelled below; no paid receipt is manufactured.

function educationPartitionSnapshot(retainCancelledCourse: boolean) {
  const context = setup(), { sim, site } = context;
  const first = begin(sim);
  fundedMaterial(sim, first.id);
  assert.ok(first.receipt, 'the real finance phase must produce the original supplier receipt');
  assert.equal(first.receivedUnits, 1);
  assert.equal(first.reusedUnits, 0);
  assert.ok(first.purchasePaid > 0);
  advance(sim, 3);
  assert.ok(first.workedMinutes > 0 && first.workedMinutes < 60);
  ledger(first);

  if (retainCancelledCourse) {
    const stopped = sim.command({ type: 'cancelStudy', targetId: first.id });
    assert.equal(stopped.ok, true, stopped.message);
    assert.equal(course(sim, first.id).status, 'cancelled');
    assert.equal(course(sim, first.id).escrow, 0);
    assert.equal(education(sim)!.history.length, 1);
    assert.equal(education(sim)!.stock[site.id].availableUnits, 1);
    const reused = begin(sim);
    assert.equal(reused.reusedUnits, 1, 'the second course reserves the actual released textbook');
    assert.equal(reused.receivedUnits, 0);
    assert.equal(reused.receipt, null, 'reuse cannot invent a second purchase receipt');
    assert.equal(reused.purchasePaid, 0);
    advance(sim, 3);
  }

  const current = course(sim);
  assert.ok(current.workedMinutes > 0 && current.workedMinutes < 60);
  assert.ok(current.escrow > 0 && current.escrow < 40);
  assert.ok(current.serviceFees > 0);
  assert.equal(current.reservedUnits, 1);
  assert.equal(current.consumedUnits, 0);
  ledger(current);
  const data = education(sim)!;
  assert.equal(data.stock[site.id].receivedUnits, 1);
  assert.equal(data.stock[site.id].consumedUnits, 0);
  assert.equal(data.stock[site.id].availableUnits, 0);
  const saved = sim.exportSave(), parts = partitionSave(saved, sim.worldDefinition);
  const playerPart = parts.find(part => part.id === 'player');
  assert.ok(playerPart, 'the decomposition includes its player part');
  const stockPart = parts.find(part => part.id.startsWith('chunk:')
    && Object.hasOwn(JSON.parse(part.json).maps['state.education.stock'] ?? {}, site.id));
  assert.ok(stockPart, 'the real school stock belongs to a geographic part');
  return { ...context, saved, parts, playerPart, stockPart };
}

function educationPartsWithBody(parts: SavePart[], id: string, body: unknown): SavePart[] {
  return parts.map(part => part.id === id ? { ...part, json: JSON.stringify(body) } : part);
}

for (const retainCancelledCourse of [false, true]) {
  test(`real partial education ${retainCancelledCourse ? 'with retained purchase and reused material' : 'with its active purchase'} partitions exactly and resumes 24 ticks`, () => {
    const { sim, controls, site, saved, parts, playerPart, stockPart } = educationPartitionSnapshot(retainCancelledCourse);
    const original = JSON.parse(saved), player = JSON.parse(playerPart.json);
    const globalPart = parts.find(part => part.id === 'global');
    assert.ok(globalPart);
    const global = JSON.parse(globalPart.json), stock = JSON.parse(stockPart.json);
    assert.deepEqual(player.values['state.education.course'], original.state.education.course);
    assert.deepEqual(player.values['state.education.history'], original.state.education.history);
    assert.equal(Object.hasOwn(global.document.state.education, 'course'), false);
    assert.equal(Object.hasOwn(global.document.state.education, 'history'), false);
    assert.equal(Object.hasOwn(global.document.state.education, 'stock'), false);
    assert.ok(global.layout.playerValues.includes('state.education.course'));
    assert.ok(global.layout.playerValues.includes('state.education.history'));
    assert.ok(global.layout.maps.includes('state.education.stock'));
    assert.deepEqual(global.layout.order['state.education.stock'], Object.keys(original.state.education.stock));
    assert.deepEqual(stock.maps['state.education.stock'][site.id], original.state.education.stock[site.id]);

    const assembled = assembleSave(parts);
    assert.equal(assembled, saved, 'all original escrow, receipt, minutes, material and key order survive decomposition');
    assert.equal(sim.exportSave(), saved, 'partitioning and assembly do not mutate the live simulation');
    const next = new Simulation(sim.worldDefinition), loaded = next.importSave(assembled);
    assert.equal(loaded.ok, true, loaded.message);
    assert.equal(next.exportSave(), saved);
    attachControls(next, controls);
    for (let tick = 0; tick < 24; tick++) {
      sim.step(.25); next.step(.25);
      assert.equal(next.exportSave(), sim.exportSave(), `partition-restored education continuation tick ${tick + 1}`);
    }
    close(course(next).workedMinutes, course(sim).workedMinutes);
    ledger(course(next));
  });
}

test('assembly rejects missing player education fields and missing real school stock without deleting other chunk entities', () => {
  const { sim, site, saved, parts, playerPart, stockPart } = educationPartitionSnapshot(true);
  assert.throws(() => assembleSave(parts.filter(part => part.id !== 'player')), /存档分区不完整/);
  for (const path of ['state.education.course', 'state.education.history']) {
    const damagedPlayer = JSON.parse(playerPart.json);
    delete damagedPlayer.values[path];
    assert.throws(() => assembleSave(educationPartsWithBody(parts, 'player', damagedPlayer)), /缺失或重复玩家存档字段/);
  }

  const missingStockEntry = JSON.parse(stockPart.json);
  delete missingStockEntry.maps['state.education.stock'][site.id];
  assert.throws(() => assembleSave(educationPartsWithBody(parts, stockPart.id, missingStockEntry)), /缺失存档映射/);
  const missingStockMap = JSON.parse(stockPart.json);
  delete missingStockMap.maps['state.education.stock'];
  assert.throws(() => assembleSave(educationPartsWithBody(parts, stockPart.id, missingStockMap)), /缺失存档映射/);

  // This part can also hold citizens or other arrays. Whole-part deletion may
  // fail the earlier entity check; the isolated map deletions above prove stock.
  assert.throws(() => assembleSave(parts.filter(part => part.id !== stockPart.id)), /缺失存档实体|缺失存档映射/);
  assert.equal(sim.exportSave(), saved, 'rejected assembly never imports or changes the existing funded course');
});

test('assembly preserves present stock keys while import rejects an invalid stock body atomically', () => {
  const { sim, site, saved, parts, stockPart } = educationPartitionSnapshot(false);
  const damagedStock = JSON.parse(stockPart.json);
  damagedStock.maps['state.education.stock'][site.id] = null;
  // The assembler checks part/key membership, not the education schema or a
  // checksum. Keeping the key makes this malformed value structurally complete.
  const assembled = assembleSave(educationPartsWithBody(parts, stockPart.id, damagedStock));
  assert.equal(JSON.parse(assembled).state.education.stock[site.id], null);
  const rejected = sim.importSave(assembled);
  assert.equal(rejected.ok, false, 'education validation must reject a non-object school stock body');
  assert.equal(sim.exportSave(), saved, 'business rejection retains the real escrow, receipt, partial work and reserved material');
});

const WALLET_LIMIT = 1e9;
type CashBook = Map<string, number>;

// Count physical custodians once. Deposit claims, loan receivables, public
// authorizations, shop profit and GDP are not additional physical money.
function physicalCashBook(sim: Simulation): CashBook {
  const state = sim.state, extension = state.extension!, bank = state.banking!;
  const result: CashBook = new Map([
    ['public:treasury', state.treasury], ['public:tax-queue', Reflect.get(sim, 'runtime').taxes],
    ['wallet:player', state.player.money], ['bank:cash', bank.cash], ['bank:legacy-cash', bank.legacyInvestmentCash],
  ]);
  for (const person of state.citizens) result.set(`wallet:${person.id}`, person.money);
  const companySites = new Set(extension.companies.map(company => company.buildingId));
  for (const shop of state.shops) if (!companySites.has(shop.buildingId)) result.set(`shop:${shop.id}`, shop.cash ?? 0);
  for (const company of extension.companies) result.set(`company:${company.id}`, company.capital);
  for (const organization of extension.organizations) result.set(`organization:${organization.id}`, organization.funds);
  for (const pregnancy of state.family!.pregnancies) result.set(`pregnancy:${pregnancy.id}`, pregnancy.escrow);
  for (const household of state.family!.households) result.set(`household:${household.id}`, household.balance);
  if (state.playerLabor?.job) result.set(`player-work:${state.playerLabor.job.id}`, state.playerLabor.job.escrow);
  for (const order of state.clinical!.orders) result.set(`clinical:${order.id}`, order.escrow);
  const data = education(sim);
  for (const item of [...(data?.history ?? []), ...(data?.course ? [data.course] : [])]) result.set(`education:${item.id}`, item.escrow);
  for (const [id, value] of result) assert.ok(Number.isFinite(value) && value >= 0, `finite physical custodian ${id}`);
  return result;
}

function assertPhysicalCashUnchanged(sim: Simulation, before: CashBook, label: string): void {
  const after = physicalCashBook(sim);
  // Sum each custodian's actual delta; avoid subtracting two rounded billion-
  // sized aggregate totals. The existing money assertion tolerance is retained.
  const difference = [...new Set([...before.keys(), ...after.keys()])]
    .reduce((sum, id) => sum + ((after.get(id) ?? 0) - (before.get(id) ?? 0)), 0);
  close(difference, 0, label);
}

function partitionTwin(sim: Simulation, controls: Controls): Simulation {
  const saved = sim.exportSave(), assembled = assembleSave(partitionSave(saved, sim.worldDefinition));
  assert.equal(assembled, saved, 'the full education contract survives partition assembly byte for byte');
  const next = new Simulation(sim.worldDefinition), loaded = next.importSave(assembled);
  assert.equal(loaded.ok, true, loaded.message); assert.equal(next.exportSave(), saved);
  attachControls(next, controls); return next;
}

function stepTwins24(sim: Simulation, next: Simulation, label: string): void {
  for (let tick = 0; tick < 24; tick++) {
    sim.step(.25); next.step(.25);
    assert.equal(next.exportSave(), sim.exportSave(), `${label}: exact completed tick ${tick + 1}`);
  }
}

function declareCashBackedCapacityOpening(sim: Simulation): void {
  assert.ok(cash(sim) < WALLET_LIMIT, 'native finite opening cash cannot fund the billion-wallet boundary');
  assert.equal(education(sim), undefined, 'declare this opening before any education contract exists');
  const nativeBook = physicalCashBook(sim);
  const native = sim.exportSave(), opening = JSON.parse(native), bank = opening.state.banking;
  assert.equal(bank.cash, 0); assert.equal(bank.accounts.player.deposits, 0);
  assert.deepEqual(Object.keys(bank.accounts), ['player']); assert.equal(bank.receipts.length, 0);
  assert.equal(bank.accounts.player.loanPrincipal + bank.accounts.player.loanInterest, 0);
  // Explicit synthetic OPENING BALANCE, not a claim that the native bank earned
  // it or a fabricated in-simulation deposit/event/history. This initial bank
  // debt to the player is matched one-for-one by its physical cash asset.
  // No wallet, company, stock, wage, role, clock or attendance field is granted.
  bank.cash = WALLET_LIMIT; bank.accounts.player.deposits = WALLET_LIMIT;
  opening.state.bankBalance = WALLET_LIMIT; // projection of that single claim
  const declared = JSON.stringify(opening), loaded = sim.importSave(declared);
  assert.equal(loaded.ok, true, loaded.message); assert.equal(sim.exportSave(), declared);
  const sheet = bankingBalanceSheet(sim.state.banking!);
  assert.equal(sheet.assets, WALLET_LIMIT); assert.equal(sheet.liabilities, WALLET_LIMIT); assert.equal(sheet.equity, 0);
  assert.equal(sim.state.player.money, JSON.parse(native).state.player.money);
  assert.equal(sim.state.banking!.stats.deposited, bank.stats.deposited);
  const declaredBook = physicalCashBook(sim);
  assert.deepEqual([...declaredBook.keys()], [...nativeBook.keys()]);
  for (const [id, value] of nativeBook) assert.equal(declaredBook.get(id), id === 'bank:cash' ? WALLET_LIMIT : value,
    `the declared opening changes only its named physical bank asset: ${id}`);
}

test('declared cash-backed capacity opening uses actual withdrawals, preserves refundPending through partition and 24 ticks, then refunds once', () => {
  const { sim, controls, site } = setup();
  declareCashBackedCapacityOpening(sim);
  const originalBook = physicalCashBook(sim), grade = sim.state.player.education, experience = sim.state.player.experience;
  const current = begin(sim); fundedMaterial(sim, current.id); advance(sim, 4);
  close(current.workedMinutes, 4); assert.ok(current.purchasePaid > 0 && current.serviceFees > 0 && current.escrow > 0); ledger(current);
  assertPhysicalCashUnchanged(sim, originalBook, 'real admission, procurement, teaching and public wages preserve all declared physical cash');
  const bankSite = sim.worldDefinition.buildings.find(building => building.kind === 'bank')!;
  sim.setFocus(bankSite.door, 'walk');
  const beforeWithdrawals = physicalCashBook(sim), walletBefore = sim.state.player.money;
  const bankCashBefore = sim.state.banking!.cash, claimBefore = sim.state.bankBalance;
  for (let transfer = 0; sim.state.player.money < WALLET_LIMIT && transfer < 1001; transfer++) {
    const value = Math.min(1e6, WALLET_LIMIT - sim.state.player.money);
    const withdrawal = sim.command({ type: 'withdraw', targetId: bankSite.id, value });
    assert.equal(withdrawal.ok, true, withdrawal.message);
  }
  assert.equal(sim.state.player.money, WALLET_LIMIT, 'only original bank withdrawal commands fill the wallet');
  close(bankCashBefore - sim.state.banking!.cash, WALLET_LIMIT - walletBefore, 'bank cash is the actual withdrawal source');
  close(claimBefore - sim.state.bankBalance, WALLET_LIMIT - walletBefore, 'the same withdrawals extinguish the bank deposit claim');
  assertPhysicalCashUnchanged(sim, beforeWithdrawals, 'capacity filling transfers existing declared bank cash without duplication');

  const unearned = current.escrow, purchased = current.purchasePaid, earned = current.serviceFees, worked = current.workedMinutes;
  const cancelled = sim.command({ type: 'cancelStudy', targetId: current.id }); assert.equal(cancelled.ok, true, cancelled.message);
  assert.equal(current.status, 'refundPending'); assert.equal(current.escrow, unearned); assert.equal(current.refunded, 0);
  assert.equal(current.reservedUnits, 0); assert.equal(education(sim)!.stock[site.id].availableUnits, 1);
  assert.equal(sim.state.player.money, WALLET_LIMIT); ledger(current);
  const originalPending = sim.exportSave();
  const blocked = sim.command({ type: 'exam', targetId: 'study' });
  assert.equal(blocked.ok, false); assert.match(blocked.message, /退款|清结/);
  assert.equal(sim.exportSave(), originalPending, 'unresolved refund is a contract, not a second paid admission');

  const next = partitionTwin(sim, controls); stepTwins24(sim, next, 'wallet-full unearned escrow');
  assert.equal(course(sim, current.id).status, 'refundPending'); assert.equal(course(sim, current.id).escrow, unearned);
  assert.equal(course(sim, current.id).workedMinutes, worked); assert.equal(course(sim, current.id).purchasePaid, purchased);
  assert.equal(course(sim, current.id).serviceFees, earned); assert.equal(course(sim, current.id).refunded, 0);
  assert.equal(education(sim)!.stock[site.id].availableUnits, 1, 'repeated stop phases return the real textbook once');
  assert.equal(sim.state.player.education, grade); assert.equal(sim.state.player.experience, experience);

  const beforeCapacityFree = physicalCashBook(sim), beforeRefund = sim.state.player.money;
  const deposited = sim.command({ type: 'deposit', targetId: bankSite.id, value: 40 });
  assert.equal(deposited.ok, true, deposited.message); assert.equal(sim.state.player.money, beforeRefund - 40);
  sim.step(.25);
  assert.equal(education(sim)!.course, null);
  const stopped = course(sim, current.id);
  assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.escrow, 0); close(stopped.refunded, unearned);
  assert.equal(stopped.workedMinutes, worked); assert.equal(stopped.purchasePaid, purchased); assert.equal(stopped.serviceFees, earned);
  close(sim.state.player.money, beforeRefund - 40 + unearned, 'only unearned escrow returns after real capacity is freed');
  assert.equal(education(sim)!.stock[site.id].availableUnits, 1); ledger(stopped);
  assertPhysicalCashUnchanged(sim, beforeCapacityFree, 'bank deposit and actual education refund conserve every source account');
  const afterRefundBook = physicalCashBook(sim), afterRefundTwin = partitionTwin(sim, controls);
  stepTwins24(sim, afterRefundTwin, 'cleared refund ledger');
  assert.equal(course(sim, current.id).refunded, unearned); assert.equal(education(sim)!.history.filter(item => item.id === current.id).length, 1);
  assert.equal(education(sim)!.stock[site.id].availableUnits, 1);
  assertPhysicalCashUnchanged(sim, afterRefundBook, 'completed continuation cannot repeat the unearned refund');
  sim.setFocus(station(site), 'walk');
  const money = sim.state.player.money, reused = begin(sim);
  assert.equal(sim.state.player.money, money - 40); assert.equal(reused.workedMinutes, 0);
  assert.equal(reused.reusedUnits, 1); assert.equal(reused.receivedUnits, 0); assert.equal(reused.purchasePaid, 0); assert.equal(reused.receipt, null);
  assert.equal(course(sim, current.id).workedMinutes, worked, 'new admission cannot resurrect or reward old partial work');
  assert.equal(sim.state.player.education, grade); assert.equal(sim.state.player.experience, experience);
});

test('native depositor cash funds a real loan; death keeps its claim pending until actual course refund and estate reconciliation', () => {
  const context = setup(), { sim, controls, site, teacher } = context;
  const grade = sim.state.player.education, experience = sim.state.player.experience;
  const initialBook = physicalCashBook(sim), bankSite = sim.worldDefinition.buildings.find(building => building.kind === 'bank')!;
  const depositors = sim.state.citizens.filter(person => person.id !== teacher.id && person.money > 450
    && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  assert.equal(depositors.length, 2, 'native constructor supplies two independent finite cash holders');
  const depositorMoney = new Map(depositors.map(person => [person.id, person.money]));
  for (const person of depositors) pin(sim, controls, person.id, bankSite, bankSite.door);
  sim.step(.25); // Original banking people hook accepts their actual deposits.
  for (const person of depositors) {
    const account = sim.state.banking!.accounts[person.id]; assert.ok(account && account.deposits > 0);
    close(depositorMoney.get(person.id)! - person.money, account.deposits, 'native lender wallet backs the actual deposit claim');
    assert.ok(sim.state.banking!.receipts.some(row => row.actorId === person.id && row.kind === 'deposit'));
  }
  assert.ok(bankingAvailableLoanCash(sim.state.banking!) >= 80);
  sim.setFocus(bankSite.door, 'walk'); const wallet = sim.state.player.money;
  const loan = sim.command({ type: 'loan', targetId: bankSite.id, value: 80 }); assert.equal(loan.ok, true, loan.message);
  assert.equal(sim.state.player.money, wallet + 80); assert.equal(sim.state.loan, 80);
  assertPhysicalCashUnchanged(sim, initialBook, 'real deposits and lending reassign native finite cash');

  sim.setFocus(station(site), 'walk');
  const current = begin(sim); fundedMaterial(sim, current.id); advance(sim, 4); close(current.workedMinutes, 4); ledger(current);
  const unearned = current.escrow, earned = current.serviceFees, purchased = current.purchasePaid;
  assert.ok(unearned > 0 && unearned < 40); assert.equal(sim.state.banking!.accounts.player.deposits, 0);
  const market = sim.worldDefinition.buildings.find(building => building.kind === 'market')!;
  const shop = sim.state.shops.find(item => item.buildingId === market.id)!;
  assert.equal(sim.shopCommodity(shop), 'food'); assert.ok(shop.open && shop.price > 0 && shop.price < unearned / 2);
  sim.setFocus(market.door, 'walk');
  const beforePurchaseBook = physicalCashBook(sim), debt = sim.state.loan, target = debt - unearned / 2;
  for (let purchase = 0; sim.state.player.money >= debt && purchase < 10; purchase++) {
    const value = Math.min(30, Math.ceil((sim.state.player.money - target) / shop.price));
    assert.ok(value >= 1 && shop.inventory >= value, 'the cash-reducing transaction has existing real food stock');
    const bought = sim.command({ type: 'purchase', targetId: market.id, value }); assert.equal(bought.ok, true, bought.message);
  }
  assert.ok(sim.state.player.money > 0 && sim.state.player.money < debt);
  assert.ok(sim.state.player.money + unearned > debt, 'actual course escrow can cover the temporarily unpaid real loan');
  assertPhysicalCashUnchanged(sim, beforePurchaseBook, 'retailer and wholesale-tax sources receive the actual food expenditure');
  assert.ok(sim.state.extension!.companies.every(company => (company.shareholders.player ?? 0) === 0));
  assert.ok(sim.state.shops.every(item => item.ownerId !== 'player'));
  assert.equal(sim.state.banking!.legacyInvestmentPrincipal, 0);
  assert.ok(sim.state.family!.households.every(item => !item.actorIds.includes('player')));
  assert.ok(sim.state.family!.pregnancies.every(item => !item.parentIds.includes('player')));
  assert.ok(sim.state.clinical!.orders.every(item => item.payerId !== 'player' || item.escrow === 0));

  const walletAtDeath = sim.state.player.money, beforeDeathBook = physicalCashBook(sim), losses = sim.state.banking!.stats.losses;
  // Controlled death boundary only. Funding, debt, course labor, original
  // receipts and material remain real; this is not a natural mortality test.
  sim.state.extension!.actorProfiles.player.alive = false;
  sim.state.extension!.actorProfiles.player.health = 0; // Existing dead-actor save contract.
  const pending = settleDeceasedAccount(sim, 'player', []);
  close(pending.debtPaid, walletAtDeath); assert.equal(pending.closed, false); assert.equal(pending.unpaidLoss, 0);
  close(sim.state.loan, debt - walletAtDeath); assert.equal(sim.state.banking!.accounts.player.closed, false);
  assert.equal(sim.state.banking!.stats.losses, losses); assert.equal(current.escrow, unearned);
  assert.equal(current.cancelledAt, null, 'bank settlement has not fabricated an education stop or refund');
  assertPhysicalCashUnchanged(sim, beforeDeathBook, 'immediate estate repayment transfers only available deceased cash');

  const next = partitionTwin(sim, controls);
  sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave());
  const stopped = course(sim, current.id), estate = sim.state.family!.estates.player;
  assert.equal(education(sim)!.course, null); assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.escrow, 0);
  close(stopped.refunded, unearned); assert.equal(stopped.workedMinutes, 4); assert.equal(stopped.serviceFees, earned); assert.equal(stopped.purchasePaid, purchased);
  assert.equal(stopped.consumedUnits, 0); assert.equal(stopped.reservedUnits, 0); assert.equal(education(sim)!.stock[site.id].availableUnits, 1); ledger(stopped);
  assert.equal(sim.state.loan, 0); assert.equal(sim.state.banking!.accounts.player.closed, true); assert.equal(sim.state.banking!.stats.losses, losses);
  assert.ok(estate && estate.bankSettlement); assert.equal(estate.bankSettlement.closed, true); assert.equal(estate.bankSettlement.unpaidLoss, 0);
  close(pending.debtPaid + estate.bankSettlement.debtPaid, debt, 'refund returns before the original loan claim is finally settled');
  assert.equal(estate.heirIds.length, 0); assert.equal(estate.status, 'awaitingExecutor', 'no fabricated heir consumes the remaining lawful estate cash');
  close(sim.state.player.money, walletAtDeath + unearned - debt, 'residual escrow refund stays in the actual deceased estate wallet');
  assertPhysicalCashUnchanged(sim, beforeDeathBook, 'refund, bank recovery and residual estate cash remain conserved');
  const refunded = stopped.refunded, statsRepaid = sim.state.banking!.stats.repaid;
  stepTwins24(sim, next, 'deceased course and fully recovered bank claim');
  assert.equal(course(sim, current.id).refunded, refunded); assert.equal(sim.state.banking!.stats.repaid, statsRepaid);
  assert.equal(education(sim)!.stock[site.id].availableUnits, 1); assert.equal(sim.state.player.education, grade); assert.equal(sim.state.player.experience, experience);
  assert.equal(sim.state.loan, 0); assert.equal(sim.state.banking!.stats.losses, losses);
  assertPhysicalCashUnchanged(sim, beforeDeathBook, 'later dead-player phases cannot repeat refund or bank recovery');
});
