import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createArchivedProductCity, createCurrentProductCity, createProductWorld } from '../src/product-city';
import { COMPANY_DIVIDEND_POLICY, shareholderParts, validateCompanyDividendPolicy } from '../src/simulation/company-dividend';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import type { Simulation } from '../src/simulation';

/** A company whose shop earns and is owed nothing, given ample capital; returns what one finance hour pays out. */
function financeHour(sim: Simulation) {
  const companies = sim.state.extension!.companies.filter(c => c.shopBindingReleasedAt === undefined);
  assert.ok(companies.length > 0, 'the product city starts with companies');
  const company = companies[0], shop = sim.state.shops.find(s => s.buildingId === company.buildingId)!;
  company.capital = 6000; shop.profit = Math.max(shop.profit, 50);
  const runtime = Reflect.get(sim, 'runtime'); runtime.financeAt = sim.state.extension!.lastUpdate;
  const paid = new Map<string, number>(); let tax = 0;
  sim.onEvent('business-dividend', e => { if (e.shopId === shop.id && e.citizenId) paid.set(e.citizenId, (paid.get(e.citizenId) ?? 0) + (e.amount ?? 0)); });
  sim.onEvent('profit-tax', e => { if (e.shopId === shop.id) tax += e.amount ?? 0; });
  const before = company.capital; sim.step(.25);
  return { company, shop, paid, tax, drawn: before - company.capital };
}

test('a declared city pays company shops the shop dividend: shareholders by shares, staff their share, and the profit tax', () => {
  const world = createProductWorld();
  const declared = createCurrentProductCity(world); for (let i = 0; i < 8; i++) declared.step(.25);
  const d = financeHour(declared);
  assert.equal(declared.companyDividendPolicyId, COMPANY_DIVIDEND_POLICY);
  assert.ok(d.tax > 0, 'the company dividend is taxed like any shop dividend');
  const holders = Object.keys(d.company.shareholders).filter(id => id !== 'exchange');
  assert.ok(holders.some(id => (d.paid.get(id) ?? 0) > 0), 'a shareholder is paid');
  const staff = declared.state.citizens.filter(c => c.workId === d.company.buildingId && c.role !== '学生' && !holders.includes(c.id));
  if (staff.length) assert.ok(staff.every(c => (d.paid.get(c.id) ?? 0) > 0), 'every staff member shares the dividend');
  const undeclared = createArchivedProductCity(world); for (let i = 0; i < 8; i++) undeclared.step(.25);
  const u = financeHour(undeclared);
  assert.equal(u.tax, 0, 'an undeclared city keeps the old rule: no shop dividend from company capital');
  assert.ok(d.drawn > u.drawn, 'the declared company pays out more than the old hourly payout alone');
  // Money is moved, not made: everything drawn from capital reached people or the treasury.
  const received = [...d.paid.values()].reduce((a, b) => a + b, 0) + d.tax, oldHourly = d.drawn - received;
  assert.ok(oldHourly >= -1e-9, 'nothing is paid beyond what the capital gave');
  const saved = declared.exportSave(), reader = createCurrentProductCity(world), read = reader.importSave(saved);
  assert.ok(read.ok, read.message); assert.equal(reader.exportSave(), saved);
  assert.equal(assembleSave(partitionSave(saved, world)), saved);
});

test('the policy is declared in the save and refused when half missing; shares with the exchange keep their part', () => {
  const world = createProductWorld(), sim = createCurrentProductCity(world), doc = JSON.parse(sim.exportSave());
  assert.equal(doc.companyDividendPolicyId, COMPANY_DIVIDEND_POLICY); assert.equal(doc.runtime.companyDividendPolicyId, COMPANY_DIVIDEND_POLICY);
  assert.throws(() => validateCompanyDividendPolicy({ ...doc, companyDividendPolicyId: undefined }), /company dividend/);
  assert.throws(() => validateCompanyDividendPolicy({ ...doc, companyDividendPolicyId: 'company-dividend-v0' }), /company dividend/);
  assert.equal(createArchivedProductCity(world).exportSave().includes('companyDividend'), false);
  const parts = shareholderParts({ exchange: 400, b: 100, a: 500, dead: 0 }, 1000, 10, () => true);
  assert.deepEqual(parts, [{ id: 'a', amount: 5 }, { id: 'b', amount: 1 }]);
});
