import type { Simulation } from '../simulation';
import { canAccessFloor } from '../access';
import { getBuildingBody } from '../architecture-floor-plan';
import type { CommandResult, Role, SimState } from '../types';

export interface BankAccount { deposits: number; loanPrincipal: number; loanInterest: number; interestDue: number; closed: boolean }
export interface BankReceipt { id: string; tick: number; at: number; actorId: string; kind: string; amount: number; cashBefore: number; cashAfter: number; principal: number; interest: number; counterpartyId?: string }
export interface BankingState {
  version: 1; cash: number; legacyInvestmentCash: number; legacyInvestmentPrincipal: number;
  nextInterestAt: number; nextReceiptId: number; profitAvailable: number;
  accounts: Record<string, BankAccount>; nextVisitAt: Record<string, number>; receipts: BankReceipt[];
  stats: { deposited: number; withdrawn: number; loaned: number; repaid: number; loanInterestPaid: number; depositInterestCredited: number; losses: number };
}
const EPS = 1e-7, HOUR = 60, DAY = 1440, ACCOUNT_LIMIT = 1e9;
const emptyAccount = (): BankAccount => ({ deposits: 0, loanPrincipal: 0, loanInterest: 0, interestDue: 0, closed: false });
const stateOf = (simulation: Simulation) => simulation.state as SimState & { banking?: BankingState };
const clock = (s: SimState) => s.extension!.lastUpdate;
const actorOf = (s: SimState, id: string) => id === 'player' ? s.player : s.citizens.find(person => person.id === id);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function bankingReserveRequired(bank: BankingState): number { return Object.values(bank.accounts).reduce((sum, account) => sum + account.deposits * .1 + account.interestDue, 0); }
export function bankingAvailableLoanCash(bank: BankingState): number { return Math.max(0, bank.cash - bankingReserveRequired(bank)); }
export function bankingBalanceSheet(bank: BankingState): { cash: number; loanPrincipal: number; loanInterestReceivable: number; deposits: number; interestPayable: number; assets: number; liabilities: number; equity: number; legacyEscrowAssets: number; legacyEscrowClaims: number } {
  const accounts = Object.values(bank.accounts);
  const loanPrincipal = accounts.reduce((sum, account) => sum + account.loanPrincipal, 0);
  const loanInterestReceivable = accounts.reduce((sum, account) => sum + account.loanInterest, 0);
  const deposits = accounts.reduce((sum, account) => sum + account.deposits, 0);
  const interestPayable = accounts.reduce((sum, account) => sum + account.interestDue, 0);
  const assets = bank.cash + loanPrincipal + loanInterestReceivable, liabilities = deposits + interestPayable;
  return { cash: bank.cash, loanPrincipal, loanInterestReceivable, deposits, interestPayable, assets, liabilities, equity: assets - liabilities,
    legacyEscrowAssets: bank.legacyInvestmentCash, legacyEscrowClaims: bank.legacyInvestmentPrincipal };
}
function projectPlayer(s: SimState & { banking?: BankingState }): void {
  const account = s.banking!.accounts.player;
  s.bankBalance = account.deposits; s.loan = account.loanPrincipal + account.loanInterest;
  if (s.banking!.legacyInvestmentPrincipal > 0 || Object.hasOwn(s.player.inventory, 'investment')) s.player.inventory.investment = s.banking!.legacyInvestmentPrincipal;
}
function receipt(s: SimState & { banking?: BankingState }, actorId: string, kind: string, amount: number, before: number, principal = 0, interest = 0, counterpartyId?: string): void {
  const bank = s.banking!;
  bank.receipts.push({ id: `bank-${bank.nextReceiptId++}`, tick: s.tick, at: clock(s), actorId, kind, amount, cashBefore: before, cashAfter: bank.cash, principal, interest, ...(counterpartyId ? { counterpartyId } : {}) });
  if (bank.receipts.length > 256) bank.receipts.splice(0, bank.receipts.length - 256);
}
function deposit(s: SimState & { banking?: BankingState }, id: string, amount: number): void {
  const bank = s.banking!, account = bank.accounts[id] ??= emptyAccount(), actor = actorOf(s, id)!;
  const before = bank.cash; actor.money -= amount; bank.cash += amount; account.deposits += amount; bank.stats.deposited += amount;
  receipt(s, id, 'deposit', amount, before); projectPlayer(s);
}
function withdraw(s: SimState & { banking?: BankingState }, id: string, amount: number): void {
  const bank = s.banking!, account = bank.accounts[id], actor = actorOf(s, id)!;
  const before = bank.cash; bank.cash -= amount; account.deposits -= amount; actor.money += amount; bank.stats.withdrawn += amount;
  receipt(s, id, 'withdraw', amount, before); projectPlayer(s);
}
function repay(s: SimState & { banking?: BankingState }, id: string, amount: number): void {
  const bank = s.banking!, account = bank.accounts[id], actor = actorOf(s, id)!;
  const interest = Math.min(amount, account.loanInterest), principal = amount - interest, before = bank.cash;
  actor.money -= amount; bank.cash += amount; account.loanInterest -= interest; account.loanPrincipal -= principal;
  bank.profitAvailable += interest; bank.stats.repaid += amount; bank.stats.loanInterestPaid += interest;
  receipt(s, id, 'repay', amount, before, principal, interest); projectPlayer(s);
}

/** Wallet, deposit rights and the bank's physical cash are separate accounts. */
export function installBanking(simulation: Simulation): void {
  const state = () => stateOf(simulation), sites = simulation.worldDefinition.buildings.filter(site => site.kind === 'bank');
  const initialize = (): BankingState => {
    const s = state(), runtime = Reflect.get(simulation, 'runtime') as { investment: number };
    const legacyInvestment = runtime.investment;
    // The old deposit/investment counters represent previously debited cash.
    // Reclassify those holdings once; neither wallet nor treasury receives a grant.
    runtime.investment = 0;
    return { version: 1, cash: s.bankBalance, legacyInvestmentCash: legacyInvestment, legacyInvestmentPrincipal: legacyInvestment,
      nextInterestAt: clock(s) + HOUR, nextReceiptId: 1, profitAvailable: 0,
      accounts: { player: { ...emptyAccount(), deposits: s.bankBalance, loanPrincipal: s.loan } }, nextVisitAt: {}, receipts: [],
      stats: { deposited: 0, withdrawn: 0, loaned: 0, repaid: 0, loanInterestPaid: 0, depositInterestCredited: 0, losses: 0 } };
  };
  state().banking = initialize(); projectPlayer(state());
  const atBank = (id: string, targetId?: string) => {
    const s = state(), actor = actorOf(s, id);
    if (!actor || !s.extension!.actorProfiles[id]?.alive) return undefined;
    return sites.find(site => {
      if (targetId && targetId !== site.id || !simulation.isNearBuilding(site, actor.position)) return false;
      const level = Math.floor((actor.position.y - site.position.y + .01) / (site.height / site.floors));
      const role = id === 'player' ? s.player.role : 'traveler' as Role;
      const identity = { role, identities: id === 'player' ? s.player.identities : [role] };
      return canAccessFloor(site, level, identity) && (!getBuildingBody(site) || simulation.isAtBuildingFunctionPoint(site, actor.position, 'service', identity));
    });
  };
  simulation.registerCommandHandler(command => {
    if (!['deposit', 'withdraw', 'loan', 'repay', 'invest', 'redeemLegacyInvestment'].includes(command.type)) return null;
    const site = atBank('player', command.targetId), s = state(), bank = s.banking!, account = bank.accounts.player;
    const fail = (message: string): CommandResult => ({ ok: false, message });
    if (!site) return fail('请亲自到公开的钱庄柜台办理金融业务。');
    if (account.closed) return fail('该账户已完成遗产清算，不能继续办理交易。');
    const amount = command.value ?? 100;
    if (!number(amount) || amount <= 0 || amount > 1e6) return fail('金额须大于0且不超过一百万。');
    if (command.type === 'deposit') {
      if (s.player.money < amount || account.deposits + amount > ACCOUNT_LIMIT) return fail('现金不足或存款超过账户上限。');
      deposit(s, 'player', amount);
    } else if (command.type === 'withdraw') {
      if (account.deposits < amount) return fail('存款权益不足。');
      if (bank.cash < amount) return fail('钱庄当前现金不足，存款权益仍保留，请等待实际回款。');
      if (s.player.money + amount > ACCOUNT_LIMIT) return fail('钱包超过上限。');
      withdraw(s, 'player', amount);
    } else if (command.type === 'loan') {
      const credit = Math.max(0, Math.min(ACCOUNT_LIMIT, 300 + s.player.reputation * 20 + s.player.experience * 30));
      if (account.loanPrincipal + account.loanInterest + amount > credit) return fail(`贷款超过信用额度${credit.toFixed(0)}。`);
      if (bankingAvailableLoanCash(bank) < amount) return fail('钱庄可贷现金不足，实际准备金不能用于新增贷款。');
      if (s.player.money + amount > ACCOUNT_LIMIT) return fail('钱包超过上限。');
      const before = bank.cash; bank.cash -= amount; s.player.money += amount; account.loanPrincipal += amount; bank.stats.loaned += amount;
      receipt(s, 'player', 'loan', amount, before, amount); projectPlayer(s);
    } else if (command.type === 'repay') {
      if (amount > account.loanPrincipal + account.loanInterest + EPS || amount > s.player.money) return fail('偿还金额超过贷款或现金。');
      repay(s, 'player', Math.min(amount, account.loanPrincipal + account.loanInterest)); s.player.reputation += .2;
    } else if (command.type === 'redeemLegacyInvestment') {
      if (amount > bank.legacyInvestmentPrincipal || amount > bank.legacyInvestmentCash) return fail('旧投资托管本金不足；已兑回部分不能重复提取。');
      if (s.player.money + amount > ACCOUNT_LIMIT) return fail('钱包超过上限。');
      bank.legacyInvestmentCash -= amount; bank.legacyInvestmentPrincipal -= amount; s.player.money += amount;
      receipt(s, 'player', 'legacy-redemption', amount, bank.cash); projectPlayer(s);
    } else {
      const company = s.extension!.companies.filter(item => item.listed && item.shareholders.exchange > 0 && item.sharePrice > 0 && item.sharePrice <= amount).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!company) return fail('当前没有可购买的上市份额；投资需要真实发行方和股份，不能凭空发放收益。');
      const shares = Math.min(company.shareholders.exchange, Math.floor(amount / company.sharePrice));
      const result = simulation.command({ type: 'buyShares', targetId: company.id, value: shares });
      if (!result.ok) return result;
      receipt(s, 'player', 'equity-purchase', shares * company.sharePrice, bank.cash, 0, 0, company.id);
      return result;
    }
    simulation.emitEvent({ type: 'bank-transaction', citizenId: 'player', amount, districtId: site.districtId });
    return { ok: true, message: `${site.name}办理完成：${command.type} ${amount.toFixed(1)}云币，账户和现金池已实际结算。` };
  });
  simulation.onPhase('people', () => {
    const s = state(), bank = s.banking!, now = clock(s);
    for (const citizen of s.citizens) {
      if (now < (bank.nextVisitAt[citizen.id] ?? 0) || !atBank(citizen.id)) continue;
      const account = bank.accounts[citizen.id] ??= emptyAccount();
      if (account.closed) continue;
      if (citizen.money < 80 && account.deposits > 0 && bank.cash > 0) withdraw(s, citizen.id, Math.min(120 - citizen.money, account.deposits, bank.cash));
      else if (citizen.money > 400 && citizen.needs.hunger >= 65 && citizen.needs.fatigue >= 60) deposit(s, citizen.id, Math.min(100, citizen.money - 300, ACCOUNT_LIMIT - account.deposits));
      bank.nextVisitAt[citizen.id] = now + DAY;
    }
  });
  simulation.onPhase('finance', () => {
    const s = state(), bank = s.banking!, now = clock(s);
    if (now + EPS < bank.nextInterestAt) return;
    const hours = Math.max(0, (now - bank.nextInterestAt + HOUR) / HOUR); bank.nextInterestAt = now + HOUR;
    for (const account of Object.values(bank.accounts)) if (!account.closed) account.loanInterest = Math.min(ACCOUNT_LIMIT - account.loanPrincipal, account.loanInterest + account.loanPrincipal * .00008 * hours);
    // Only loan interest actually collected is eligible for depositor earnings.
    const deposits = Object.values(bank.accounts).reduce((sum, a) => sum + a.deposits, 0);
    const distributable = Math.min(bank.profitAvailable, bank.cash, deposits * .000015 * hours);
    if (distributable > 0 && deposits > 0) {
      for (const [id, account] of Object.entries(bank.accounts)) if (!account.closed && account.deposits > 0) {
        const interest = Math.min(ACCOUNT_LIMIT - account.deposits, distributable * account.deposits / deposits);
        account.deposits += interest; bank.profitAvailable = Math.max(0, bank.profitAvailable - interest); bank.stats.depositInterestCredited += interest;
        receipt(s, id, 'funded-deposit-interest', interest, bank.cash, 0, interest);
      }
    }
    projectPlayer(s);
  });
  simulation.registerSaveValidator(validateBankingState);
  simulation.onLoad(() => { if (!state().banking) state().banking = initialize(); projectPlayer(state()); });
}

export function settleDeceasedAccount(simulation: Simulation, actorId: string, heirIds: string[]): { debtPaid: number; depositClaimsTransferred: number; unpaidLoss: number; closed: boolean } {
  const s = stateOf(simulation), bank = s.banking, actor = actorOf(s, actorId), result = { debtPaid: 0, depositClaimsTransferred: 0, unpaidLoss: 0, closed: true };
  if (!bank || !actor) return result;
  if (s.extension!.actorProfiles[actorId]?.alive !== false) return { ...result, closed: false };
  const account = bank.accounts[actorId]; if (!account || account.closed) return result;
  if (actorId === 'player' && bank.legacyInvestmentPrincipal > 0) {
    const redeemed = Math.min(bank.legacyInvestmentCash, Math.max(0, ACCOUNT_LIMIT - actor.money));
    actor.money += redeemed; bank.legacyInvestmentCash -= redeemed; bank.legacyInvestmentPrincipal -= redeemed;
  }
  const heirs = [...new Set(heirIds)].filter(id => id !== actorId && actorOf(s, id) && s.extension!.actorProfiles[id]?.alive);
  const offset = Math.min(account.deposits, account.loanPrincipal + account.loanInterest);
  const offsetInterest = Math.min(offset, account.loanInterest); account.deposits -= offset; account.loanInterest -= offsetInterest; account.loanPrincipal -= offset - offsetInterest;
  bank.profitAvailable += offsetInterest; bank.stats.loanInterestPaid += offsetInterest; bank.stats.repaid += offset; result.debtPaid += offset;
  if (offset > 0) receipt(s, actorId, 'estate-offset', offset, bank.cash, offset - offsetInterest, offsetInterest);
  const cashPayment = Math.min(actor.money, account.loanPrincipal + account.loanInterest);
  if (cashPayment > 0) { repay(s, actorId, cashPayment); result.debtPaid += cashPayment; }
  const hasUnsoldEstateAssets = s.extension!.companies.some(company => (company.shareholders[actorId] ?? 0) > 0)
    || s.shops.some(shop => shop.ownerId === actorId && !s.extension!.companies.some(company => company.buildingId === shop.buildingId))
    || s.family?.households.some(household => household.actorIds.includes(actorId) && household.closedAt === null && household.balance > 0)
    || s.family?.pregnancies.some(pregnancy => pregnancy.parentIds.includes(actorId) && pregnancy.escrow > 0)
    || s.clinical?.orders.some(order => order.payerId === actorId && order.escrow > 0)
    || actorId === 'player' && (s.education?.course?.escrow ?? 0) > 0
    || actorId === 'player' && bank.legacyInvestmentPrincipal > 0;
  if (account.loanPrincipal + account.loanInterest > EPS && hasUnsoldEstateAssets) {
    // A share quote is not cash. The estate executor must find a funded buyer
    // before proceeds can repay this claim; unpaid debt stays on both ledgers.
    result.closed = false; projectPlayer(s); return result;
  }
  result.unpaidLoss = account.loanPrincipal + account.loanInterest;
  bank.profitAvailable = Math.max(0, bank.profitAvailable - account.loanPrincipal);
  bank.stats.losses += result.unpaidLoss; account.loanPrincipal = 0; account.loanInterest = 0;
  if (heirs.length) {
    const claim = account.deposits, due = account.interestDue;
    // Preserve each heir's equal entitlement. A capped beneficiary cannot cause
    // repeated executor attempts to distribute their share to the other heirs.
    const canTransfer = heirs.every(id => {
      const beneficiary = bank.accounts[id] ?? emptyAccount();
      return !beneficiary.closed && beneficiary.deposits + claim / heirs.length <= ACCOUNT_LIMIT && beneficiary.interestDue + due / heirs.length <= ACCOUNT_LIMIT;
    });
    if (canTransfer) {
      for (const id of heirs) { const beneficiary = bank.accounts[id] ??= emptyAccount(); beneficiary.deposits += claim / heirs.length; beneficiary.interestDue += due / heirs.length; }
      account.deposits = 0; account.interestDue = 0; result.depositClaimsTransferred = claim; account.closed = true;
      if (claim > 0) receipt(s, actorId, 'estate-deposit-transfer', claim, bank.cash);
    } else { account.closed = false; result.closed = false; }
  } else if (account.deposits > 0 || account.interestDue > 0) result.closed = false;
  else account.closed = true;
  if (actorId === 'player' && bank.legacyInvestmentPrincipal > 0) { account.closed = false; result.closed = false; }
  projectPlayer(s); return result;
}

export function validateBankingState(candidate: SimState): void {
  const s = candidate as SimState & { banking?: BankingState }, bank = s.banking;
  if (!bank) return;
  const ensure = (condition: unknown, label: string) => { if (!condition) throw new Error(`银行存档无效：${label}。`); };
  const money = (n: unknown, max = 1e12) => ensure(number(n) && n >= 0 && n <= max, '非有限资金');
  const ids = new Set(['player', ...candidate.citizens.map(person => person.id)]);
  ensure(bank.version === 1 && candidate.extension && number(clock(s)), '版本与时钟');
  ensure(number(bank.nextInterestAt) && bank.nextInterestAt >= 0 && bank.nextInterestAt <= clock(s) + HOUR + EPS, '结算时钟');
  for (const value of [bank.cash, bank.legacyInvestmentCash, bank.legacyInvestmentPrincipal, bank.profitAvailable]) money(value);
  ensure(Math.abs(bank.legacyInvestmentCash - bank.legacyInvestmentPrincipal) <= EPS, '托管本金');
  ensure(bank.accounts && typeof bank.accounts === 'object' && !Array.isArray(bank.accounts) && Object.keys(bank.accounts).length <= ids.size && bank.accounts.player, '账户');
  for (const [id, account] of Object.entries(bank.accounts)) {
    ensure(ids.has(id) && account && typeof account.closed === 'boolean', '账户主体');
    for (const n of [account.deposits, account.loanPrincipal, account.loanInterest, account.interestDue]) money(n, ACCOUNT_LIMIT);
    ensure(account.loanPrincipal + account.loanInterest <= ACCOUNT_LIMIT + EPS && (!account.closed || account.deposits + account.loanPrincipal + account.loanInterest + account.interestDue <= EPS), '关闭账户');
  }
  ensure(Math.abs(s.bankBalance - bank.accounts.player.deposits) <= EPS && Math.abs(s.loan - bank.accounts.player.loanPrincipal - bank.accounts.player.loanInterest) <= EPS, '玩家旧字段镜像');
  if (bank.legacyInvestmentPrincipal > 0 || Object.hasOwn(s.player.inventory, 'investment')) ensure(Math.abs(s.player.inventory.investment - bank.legacyInvestmentPrincipal) <= EPS, '旧投资托管镜像');
  ensure(bank.nextVisitAt && typeof bank.nextVisitAt === 'object' && !Array.isArray(bank.nextVisitAt) && Object.keys(bank.nextVisitAt).length <= ids.size, '访问记录');
  for (const [id, time] of Object.entries(bank.nextVisitAt)) ensure(ids.has(id) && number(time) && time >= 0 && time <= clock(s) + DAY + EPS, '访问计时');
  ensure(Number.isInteger(bank.nextReceiptId) && bank.nextReceiptId > 0 && bank.nextReceiptId <= 1e9 && Array.isArray(bank.receipts) && bank.receipts.length <= 256, '回执数量');
  const receipts = new Set<string>();
  for (const row of bank.receipts) {
    ensure(row && typeof row.id === 'string' && /^bank-[1-9][0-9]*$/.test(row.id) && Number(row.id.slice(5)) < bank.nextReceiptId && !receipts.has(row.id), '回执身份'); receipts.add(row.id);
    ensure(ids.has(row.actorId) && ['deposit', 'withdraw', 'loan', 'repay', 'legacy-redemption', 'equity-purchase', 'funded-deposit-interest', 'estate-offset', 'estate-deposit-transfer'].includes(row.kind), '回执行为');
    ensure(Number.isInteger(row.tick) && row.tick >= 0 && row.tick <= s.tick && number(row.at) && row.at >= 0 && row.at <= clock(s) + EPS, '回执时间');
    for (const n of [row.amount, row.cashBefore, row.cashAfter, row.principal, row.interest]) money(n);
    const cashDelta = row.cashAfter - row.cashBefore;
    const expectedDelta = ['deposit', 'repay'].includes(row.kind) ? row.amount : ['withdraw', 'loan'].includes(row.kind) ? -row.amount : 0;
    ensure(Math.abs(cashDelta - expectedDelta) <= Math.max(EPS, Math.max(row.cashBefore, row.cashAfter) * Number.EPSILON * 8), '回执资金流');
    if (row.kind === 'repay' || row.kind === 'estate-offset') ensure(Math.abs(row.amount - row.principal - row.interest) <= EPS, '回执清债分账');
    if (row.counterpartyId) ensure(s.extension!.companies.some(company => company.id === row.counterpartyId), '投资发行方');
  }
  ensure(bank.stats && typeof bank.stats === 'object' && !Array.isArray(bank.stats), '统计');
  for (const key of ['deposited', 'withdrawn', 'loaned', 'repaid', 'loanInterestPaid', 'depositInterestCredited', 'losses'] as const) money(bank.stats[key]);
  ensure(bank.profitAvailable + bank.stats.depositInterestCredited <= bank.stats.loanInterestPaid + EPS, '收益必须来自已收贷款利息');
}
