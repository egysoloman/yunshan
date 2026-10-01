import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../src/simulation';
import { bankingAvailableLoanCash, bankingBalanceSheet, bankingReserveRequired, settleDeceasedAccount } from '../src/simulation/banking';
import type { WorldDefinition } from '../src/types';

function fixture(): WorldDefinition {
  const buildings = (['home', 'bank', 'hall'] as const).map((kind, i) => ({ id: kind, name: kind, kind,
    districtId: 'district', position: { x: i * 30, y: 20, z: 0 }, door: { x: i * 30, y: 20, z: 6 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 500, seed: i }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, name: site.name, districtId: 'district', position: { ...site.door }, station: false }));
  return { seed: 20261001, size: 1000, voxelSize: .2, buildings, nodes,
    edges: nodes.slice(1).map((node, i) => ({ id: `road-${i}`, from: nodes[i].id, to: node.id, mode: 'road', length: 30, capacity: 20, points: [nodes[i].position, node.position] })),
    districts: [{ id: 'district', name: '银行测试', kind: 'government', center: { x: 30, y: 20, z: 0 }, radius: 200, color: '#abc', population: 384 }],
    spawn: { ...buildings[0].door }, mountains: [], river: [], waterfall: { top: { x: 300, y: 40, z: 300 }, bottom: { x: 300, y: 20, z: 300 }, width: 10 } };
}
function create() { const sim = new Simulation(fixture()); sim.setFocus(sim.worldDefinition.buildings[1].door, 'walk'); return sim; }
function physicalCash(sim: Simulation) {
  const s = sim.state, runtime = Reflect.get(sim, 'runtime');
  return s.player.money + s.citizens.reduce((sum, person) => sum + person.money, 0) + s.treasury + runtime.taxes
    + s.banking!.cash + s.banking!.legacyInvestmentCash + s.extension!.organizations.reduce((sum, org) => sum + org.funds, 0)
    + s.extension!.companies.reduce((sum, company) => sum + company.capital, 0)
    + s.shops.filter(shop => !s.extension!.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0);
}
function command(sim: Simulation, type: 'deposit' | 'withdraw' | 'loan' | 'repay' | 'redeemLegacyInvestment' | 'invest', value: number) {
  return sim.command({ type, value, targetId: 'bank' });
}
function hour(sim: Simulation) {
  sim.state.extension!.lastUpdate += 60;
  sim.state.family!.lastUpdate = sim.state.culture!.lastUpdate = sim.state.extension!.lastUpdate;
  Reflect.get(sim, 'bus').emit({ type: 'system:finance' });
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('a new bank has no grant and every deposit, withdrawal, loan and repayment transfers actual cash', () => {
  const sim = create(), bank = sim.state.banking!, supply = physicalCash(sim), start = sim.exportSave();
  assert.equal(bank.cash, 0); assert.equal(command(sim, 'loan', 1).ok, false); assert.equal(sim.exportSave(), start);
  assert.equal(command(sim, 'deposit', 300).ok, true);
  assert.equal(bank.cash, 300); assert.equal(bank.accounts.player.deposits, 300); assert.equal(bankingReserveRequired(bank), 30);
  assert.equal(bankingAvailableLoanCash(bank), 270); near(physicalCash(sim), supply);
  assert.equal(command(sim, 'loan', 271).ok, false); assert.equal(command(sim, 'loan', 270).ok, true);
  assert.equal(bank.cash, 30); assert.equal(sim.state.loan, 270); near(physicalCash(sim), supply);
  const sheet = bankingBalanceSheet(bank); assert.equal(sheet.assets, 300); assert.equal(sheet.liabilities, 300); assert.equal(sheet.equity, 0);
  const before = sim.exportSave(); assert.equal(command(sim, 'withdraw', 31).ok, false); assert.equal(sim.exportSave(), before);
  assert.equal(command(sim, 'repay', 270).ok, true); assert.equal(command(sim, 'withdraw', 300).ok, true);
  assert.equal(bank.cash, 0); assert.equal(sim.state.bankBalance, 0); assert.equal(sim.state.loan, 0); near(physicalCash(sim), supply);
});

test('finite decimal balances never become negative through tolerance on unaffordable requests', () => {
  const sim = create(); assert.equal(command(sim, 'deposit', .1).ok, true);
  const before = sim.exportSave();
  assert.equal(command(sim, 'withdraw', .100000001).ok, false); assert.equal(sim.exportSave(), before);
  assert.equal(command(sim, 'withdraw', .1).ok, true);
  const restored = new Simulation(sim.worldDefinition); assert.equal(restored.importSave(sim.exportSave()).ok, true);
});

test('deposit earnings require collected loan interest; accrued receivables and display-time changes create no cash', () => {
  const sim = create(), bank = sim.state.banking!;
  assert.equal(command(sim, 'deposit', 300).ok, true); const supply = physicalCash(sim);
  hour(sim); assert.equal(sim.state.bankBalance, 300); assert.equal(bank.profitAvailable, 0); near(physicalCash(sim), supply);
  assert.equal(command(sim, 'loan', 200).ok, true); hour(sim);
  near(bank.accounts.player.loanInterest, .016); assert.equal(sim.state.bankBalance, 300);
  const at = sim.state.extension!.lastUpdate, due = bank.nextInterestAt;
  assert.equal(sim.command({ type: 'setTime', value: 23 }).ok, true);
  assert.equal(sim.state.extension!.lastUpdate, at); assert.equal(bank.nextInterestAt, due);
  assert.equal(command(sim, 'repay', .016).ok, true); near(bank.profitAvailable, .016);
  hour(sim); near(sim.state.bankBalance, 300.0045); near(bank.stats.depositInterestCredited, .0045);
  near(bank.profitAvailable, .0115); near(physicalCash(sim), supply);
});

test('retained collected interest can be loaned while deposit yields remain capped by available cash', () => {
  const sim = create(), bank = sim.state.banking!;
  assert.equal(command(sim, 'deposit', 100).ok, true); assert.equal(command(sim, 'loan', 90).ok, true);
  hour(sim); assert.equal(command(sim, 'repay', 90.0072).ok, true);
  assert.equal(command(sim, 'withdraw', 100).ok, true);
  near(bank.cash, .0072); near(bank.profitAvailable, .0072);
  assert.equal(command(sim, 'loan', .007).ok, true); assert.ok(bank.profitAvailable > bank.cash);
  const restored = new Simulation(sim.worldDefinition), result = restored.importSave(sim.exportSave());
  assert.equal(result.ok, true, result.message); assert.equal(restored.exportSave(), sim.exportSave());
});

test('legacy deposits and held investment cash migrate once and redemption has no invented return', () => {
  const sim = create(), legacy = JSON.parse(sim.exportSave());
  // Saves from before the module manifest did not carry its presence guarantee.
  delete legacy.runtime.persistedModules;
  delete legacy.state.banking; legacy.state.bankBalance = 75; legacy.state.loan = 20;
  legacy.runtime.investment = 100; legacy.state.player.inventory.investment = 100;
  const restored = new Simulation(sim.worldDefinition), loaded = restored.importSave(JSON.stringify(legacy));
  assert.equal(loaded.ok, true, loaded.message);
  assert.equal(restored.state.banking!.cash, 75); assert.equal(restored.state.banking!.legacyInvestmentCash, 100);
  assert.equal(Reflect.get(restored, 'runtime').investment, 0);
  const supply = physicalCash(restored);
  assert.equal(command(restored, 'redeemLegacyInvestment', 40).ok, true);
  assert.equal(restored.state.banking!.legacyInvestmentPrincipal, 60); near(physicalCash(restored), supply);
  const before = restored.exportSave(); assert.equal(command(restored, 'redeemLegacyInvestment', 60.00000001).ok, false); assert.equal(restored.exportSave(), before);
  assert.equal(command(restored, 'redeemLegacyInvestment', 60).ok, true); near(physicalCash(restored), supply);
  assert.equal(command(restored, 'redeemLegacyInvestment', 1).ok, false);
  const again = new Simulation(sim.worldDefinition); assert.equal(again.importSave(restored.exportSave()).ok, true);
  assert.equal(again.exportSave(), restored.exportSave()); assert.equal(again.state.banking!.legacyInvestmentCash, 0);
});

test('a live account cannot be settled as an estate and dead loan debt is paid before deposit inheritance', () => {
  const sim = create(), bank = sim.state.banking!, heir = sim.state.citizens[2];
  assert.equal(command(sim, 'deposit', 300).ok, true); assert.equal(command(sim, 'loan', 200).ok, true);
  const before = sim.exportSave(); assert.equal(settleDeceasedAccount(sim, 'player', [heir.id]).closed, false); assert.equal(sim.exportSave(), before);
  sim.state.extension!.actorProfiles.player.alive = false;
  const supply = physicalCash(sim), wallet = sim.state.player.money;
  const result = settleDeceasedAccount(sim, 'player', [heir.id]);
  assert.deepEqual(result, { debtPaid: 200, depositClaimsTransferred: 100, unpaidLoss: 0, closed: true });
  assert.equal(sim.state.player.money, wallet); assert.equal(bank.accounts[heir.id].deposits, 100);
  assert.equal(bank.cash, 100); assert.equal(sim.state.loan, 0); near(physicalCash(sim), supply);
  const once = sim.exportSave(); settleDeceasedAccount(sim, 'player', [heir.id]); assert.equal(sim.exportSave(), once);
});

test('unclaimed deposits remain owned rights; an insolvent estate records the real loss without charging heirs', () => {
  const sim = create(), bank = sim.state.banking!, deceased = sim.state.citizens[2], heir = sim.state.citizens[3];
  deceased.money -= 50; bank.cash += 50;
  bank.accounts[deceased.id] = { deposits: 50, loanPrincipal: 0, loanInterest: 0, interestDue: 0, closed: false };
  sim.state.extension!.actorProfiles[deceased.id].alive = false;
  const supply = physicalCash(sim), first = settleDeceasedAccount(sim, deceased.id, []);
  assert.equal(first.closed, false); assert.equal(bank.accounts[deceased.id].deposits, 50); near(physicalCash(sim), supply);
  const received = settleDeceasedAccount(sim, deceased.id, [heir.id]);
  assert.equal(received.depositClaimsTransferred, 50); assert.equal(bank.accounts[heir.id].deposits, 50); near(physicalCash(sim), supply);
  assert.equal(command(sim, 'loan', 40).ok, true); sim.state.player.money = 2;
  sim.state.extension!.actorProfiles.player.alive = false;
  const lossSupply = physicalCash(sim), beneficiaryMoney = heir.money;
  const loss = settleDeceasedAccount(sim, 'player', [heir.id]);
  assert.equal(loss.debtPaid, 2); assert.equal(loss.unpaidLoss, 38);
  assert.equal(heir.money, beneficiaryMoney); assert.equal(bank.stats.losses, 38); near(physicalCash(sim), lossSupply);
});

test('capped heirs keep equal pending entitlements instead of losing rights or receiving duplicate distributions', () => {
  const sim = create(), bank = sim.state.banking!, deceased = sim.state.citizens[2], heirs = sim.state.citizens.slice(3, 5);
  bank.accounts[deceased.id] = { deposits: 100, loanPrincipal: 0, loanInterest: 0, interestDue: 0, closed: false };
  bank.accounts[heirs[0].id] = { deposits: 1e9, loanPrincipal: 0, loanInterest: 0, interestDue: 0, closed: false };
  bank.cash = 1e9 + 100; // Fully cash-backed opening claims for the cap boundary fixture.
  sim.state.extension!.actorProfiles[deceased.id].alive = false;
  const first = settleDeceasedAccount(sim, deceased.id, heirs.map(person => person.id));
  assert.equal(first.closed, false); assert.equal(first.depositClaimsTransferred, 0);
  assert.equal(bank.accounts[deceased.id].deposits, 100); assert.equal(bank.accounts[heirs[1].id], undefined);
  const waiting = sim.exportSave(); settleDeceasedAccount(sim, deceased.id, heirs.map(person => person.id)); assert.equal(sim.exportSave(), waiting);
  bank.accounts[heirs[0].id].deposits -= 50; bank.cash -= 50; heirs[0].money += 50;
  const before = physicalCash(sim), result = settleDeceasedAccount(sim, deceased.id, heirs.map(person => person.id));
  assert.equal(result.closed, true); assert.equal(result.depositClaimsTransferred, 100);
  assert.equal(bank.accounts[heirs[0].id].deposits, 1e9); assert.equal(bank.accounts[heirs[1].id].deposits, 50); near(physicalCash(sim), before);
});

test('bank investment cannot pay a yield without an actual listed issuer and available shares', () => {
  const sim = create(), before = sim.exportSave();
  assert.equal(command(sim, 'invest', 100).ok, false); assert.equal(sim.exportSave(), before);
  assert.equal(Reflect.get(sim, 'runtime').investment, 0); hour(sim); hour(sim);
  assert.equal(sim.state.banking!.legacyInvestmentCash, 0); assert.equal(sim.state.player.money, 600);
});

test('bank brokerage acquires actual issued shares and pays the issuer without creating investment principal', () => {
  const world = fixture(), site = { ...world.buildings[0], id: 'market', name: 'market', kind: 'market' as const,
    position: { x: 90, y: 20, z: 0 }, door: { x: 90, y: 20, z: 6 } };
  world.buildings.push(site); world.nodes.push({ id: 'market-door', name: 'market', districtId: 'district', position: { ...site.door }, station: false });
  world.edges.push({ id: 'road-market', from: 'hall-door', to: 'market-door', mode: 'road', length: 30, capacity: 20, points: [world.buildings[2].door, site.door] });
  // Genuine job sites keep the generated 384-person workforce within the
  // company's existing 100-employee save contract; no roster is overwritten.
  const farm = { ...site, id: 'farm', name: 'farm', kind: 'farm' as const, position: { x: 120, y: 20, z: 0 }, door: { x: 120, y: 20, z: 6 } };
  world.buildings.push(farm); world.nodes.push({ id: 'farm-door', name: 'farm', districtId: 'district', position: { ...farm.door }, station: false });
  world.edges.push({ id: 'road-farm', from: 'market-door', to: 'farm-door', mode: 'road', length: 30, capacity: 20, points: [site.door, farm.door] });
  // Construction buys finite industrial materials, so this fixture needs an
  // actual workshop in addition to its food producer and retail company.
  const workshop = { ...farm, id: 'workshop', name: 'workshop', kind: 'workshop' as const,
    position: { x: 150, y: 20, z: 0 }, door: { x: 150, y: 20, z: 6 } };
  world.buildings.push(workshop); world.nodes.push({ id: 'workshop-door', name: 'workshop', districtId: 'district', position: { ...workshop.door }, station: false });
  world.edges.push({ id: 'road-workshop', from: 'farm-door', to: 'workshop-door', mode: 'road', length: 30, capacity: 20, points: [farm.door, workshop.door] });
  const sim = new Simulation(world); sim.state.player.identities = ['traveler', 'merchant']; sim.state.player.money = 3000;
  sim.setFocus(site.door, 'walk'); assert.equal(sim.command({ type: 'foundCompany', targetId: site.id, value: 300 }).ok, true);
  const company = sim.state.extension!.companies[0];
  const expanded = sim.command({ type: 'expandCompany', targetId: company.id, value: 1000 });
  assert.equal(expanded.ok, true, expanded.message);
  assert.equal(company.level, 1, 'ordering an expansion cannot complete its construction labor');
  sim.setFocus(world.buildings[1].door, 'walk');
  assert.equal(sim.command({ type: 'listCompany', targetId: company.id }).ok, false, 'unfinished construction cannot satisfy listing eligibility');
  sim.setFocus(site.door, 'walk'); sim.command({ type: 'setTime', value: 10 });
  const worker = sim.state.citizens.find(person => person.workId === site.id && person.role !== '学生')!;
  worker.position = { ...site.position, y: site.position.y + .6 }; worker.destinationId = site.id; worker.route = []; worker.routeIndex = 0;
  worker.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  Reflect.get(sim, 'runtime').activities[worker.id] = 'work'; Reflect.get(sim, 'runtime').decisionAt[worker.id] = sim.state.extension!.lastUpdate + 120;
  for (let tick = 0; tick < 240 && company.level === 1; tick++) sim.step(.25);
  assert.equal(company.level, 2, 'only actual attended labor and the purchased finite materials finish construction');
  sim.setFocus(world.buildings[1].door, 'walk');
  const listed = sim.command({ type: 'listCompany', targetId: company.id }); assert.equal(listed.ok, true, listed.message);
  const initialShares = company.shareholders.player, issued = company.shareholders.exchange, supply = physicalCash(sim), money = sim.state.player.money;
  const price = company.sharePrice, shares = Math.floor(100 / price);
  const result = command(sim, 'invest', 100); assert.equal(result.ok, true, result.message);
  assert.equal(company.shareholders.player, initialShares + shares); assert.equal(company.shareholders.exchange, issued - shares);
  near(sim.state.player.money, money - shares * price); near(physicalCash(sim), supply);
  assert.equal(Reflect.get(sim, 'runtime').investment, 0); assert.equal(sim.state.banking!.legacyInvestmentPrincipal, 0);
  assert.equal(sim.state.banking!.receipts.at(-1)!.counterpartyId, company.id);
  const restored = new Simulation(world), loaded = restored.importSave(sim.exportSave());
  assert.equal(loaded.ok, true, loaded.message); assert.equal(restored.exportSave(), sim.exportSave());
  const financier = sim.state.citizens.find(person => person.money >= 200 && !sim.state.banking!.accounts[person.id])!;
  financier.money -= 200; sim.state.banking!.cash += 200;
  sim.state.banking!.accounts[financier.id] = { deposits: 200, loanPrincipal: 0, loanInterest: 0, interestDue: 0, closed: false };
  assert.equal(command(sim, 'loan', 150).ok, true);
  financier.money += sim.state.player.money; sim.state.player.money = 0;
  sim.state.extension!.actorProfiles.player.alive = false;
  const cash = physicalCash(sim), held = company.shareholders.player;
  const pending = settleDeceasedAccount(sim, 'player', [financier.id]);
  assert.equal(pending.closed, false); assert.equal(pending.unpaidLoss, 0); assert.equal(pending.debtPaid, 0);
  assert.equal(sim.state.loan, 150); assert.equal(company.shareholders.player, held); near(physicalCash(sim), cash);
});

test('bank corruptions reject atomically and a funded ledger resumes with identical fixed ticks', () => {
  const sim = create(); assert.equal(command(sim, 'deposit', 300).ok, true); assert.equal(command(sim, 'loan', 100).ok, true);
  const valid = sim.exportSave();
  for (const corrupt of [
    (data: any) => { data.state.banking.cash = -.000000001; },
    (data: any) => { data.state.banking.profitAvailable = 1; },
    (data: any) => { data.state.bankBalance++; },
    (data: any) => { data.state.banking.accounts.ghost = data.state.banking.accounts.player; },
    (data: any) => { data.state.banking.receipts[0].actorId = 'ghost'; },
    (data: any) => { data.state.banking.receipts[0].cashAfter++; },
    (data: any) => { data.state.banking.nextInterestAt = data.state.extension.lastUpdate + 61; },
    (data: any) => { data.state.banking.legacyInvestmentCash = 10; },
    (data: any) => { data.state.player.inventory.investment = 10; },
    (data: any) => { data.runtime.investment = 10; },
  ]) {
    const data = JSON.parse(valid); corrupt(data);
    assert.equal(sim.importSave(JSON.stringify(data)).ok, false); assert.equal(sim.exportSave(), valid);
  }
  const restored = new Simulation(sim.worldDefinition); assert.equal(restored.importSave(valid).ok, true);
  for (let tick = 0; tick < 48; tick++) { sim.step(.25); restored.step(.25); }
  assert.equal(restored.exportSave(), sim.exportSave());
});

test('a saved module manifest prevents missing financial custody from being mistaken for a legacy save', () => {
  const sim = create(); assert.equal(command(sim, 'deposit', 300).ok, true); assert.equal(command(sim, 'loan', 100).ok, true);
  const valid = sim.exportSave(), original = JSON.parse(valid), modules: string[] = original.runtime.persistedModules;
  assert.deepEqual(modules, ['extension', 'aviation', 'banking', 'family', 'culture', 'journey', 'trade', 'playerLabor', 'clinical']);
  for (const name of modules) {
    const data = JSON.parse(valid); delete data.state[name];
    const result = sim.importSave(JSON.stringify(data));
    assert.equal(result.ok, false, `deleted ${name} must reject before migration`); assert.equal(sim.exportSave(), valid);
  }
  for (const corrupt of [
    (data: any) => { data.runtime.persistedModules.push('banking'); },
    (data: any) => { data.runtime.persistedModules[0] = 'invented'; },
    (data: any) => { data.runtime.persistedModules.pop(); },
    (data: any) => { data.state.banking = null; },
    (data: any) => { data.runtime.persistedModules = {}; },
  ]) {
    const data = JSON.parse(valid); corrupt(data);
    assert.equal(sim.importSave(JSON.stringify(data)).ok, false); assert.equal(sim.exportSave(), valid);
  }
  const unmarked = JSON.parse(valid); delete unmarked.runtime.persistedModules;
  const restored = new Simulation(sim.worldDefinition), migrated = restored.importSave(JSON.stringify(unmarked));
  assert.equal(migrated.ok, true, migrated.message); assert.equal(restored.exportSave(), valid, 'accepted old unmarked saves acquire the exact current manifest without changing their assets');
});
