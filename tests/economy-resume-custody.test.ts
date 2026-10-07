import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { WorldDefinition } from '../src/types';
import { cashSnapshot, debtSnapshot, foodCustodySnapshot } from '../scripts/economy-resume-custody';

// Parse frozen native inputs only. No Simulation, constructor, live capability,
// time/phase execution or original-file write is used in these tests.
const saveRaw = readFileSync(new URL('../docs/validation/2026-10-05-city-life-root20/ROOT20-PRIMARY-1700.save.json', import.meta.url), 'utf8');
const trackedLargeWorld = JSON.parse(readFileSync(new URL('../docs/validation/2026-10-07-city-life-root23/ROOT23-LARGE-WORLD.original.json', import.meta.url), 'utf8'));
// ROOT23 added only this opt-in electricity declaration to World291. Verify the
// complete remaining bytes against the original SHA before treating it as input.
const { powerGrid: _encodingFixture, ...originalWorld } = trackedLargeWorld;
const world = originalWorld as WorldDefinition;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = () => { const document = JSON.parse(saveRaw); return { state: document.state, runtime: document.runtime }; };
function near(actual: number, expected: number) { assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test('custody reads the original World291/4610 bags without changing either input', () => {
  assert.equal(sha(saveRaw), '4610ab1059b52cfd4bbfa17badf209a7a33ab986735d83b8a5da8c8a9e5ddf6a');
  assert.equal(sha(JSON.stringify(originalWorld)), '2912839d3a854202d45fd1585d24d367ff6c15e8f5399bc8a669b1c91b4c8512');
  const host = fixture(), before = JSON.stringify(host), beforeWorld = JSON.stringify(world);
  const cash = cashSnapshot(host, world), food = foodCustodySnapshot(host, world), debt = debtSnapshot(host.runtime);
  near(cash.total, 280736.1579367216); near(food.total, 15814.241185989758);
  assert.equal(debt.total, 0); assert.equal(debt.rows.length, 0);
  assert.equal(cash.accounts.find(row => row.kind === 'residentEducation-escrow')?.amount, 36);
  assert.equal(food.holdings.filter(row => row.kind === 'food-in-transit').length, 16);
  assert.equal(food.holdings.filter(row => row.kind === 'food-in-transit').reduce((sum, row) => sum + row.amount, 0), 426);
  assert.equal(food.freightLots.reduce((sum, row) => sum + row.quantity, 0), 1254);
  assert.equal(new Set(cash.accounts.map(row => row.id)).size, cash.accounts.length);
  assert.equal(new Set(food.holdings.map(row => row.id)).size, food.holdings.length);
  assert.equal(JSON.stringify(host), before); assert.equal(JSON.stringify(world), beforeWorld);
});

test('bound shop cash and bank claims remain visible without becoming additional money', () => {
  const host = fixture(), before = cashSnapshot(host, world), company = host.state.extension.companies[0];
  const shop = host.state.shops.find((row: { buildingId: string }) => row.buildingId === company.buildingId);
  shop.cash = 73;
  host.state.banking.accounts.player.deposits = 900; host.state.bankBalance = 900;
  const after = cashSnapshot(host, world);
  near(after.total, before.total);
  assert.equal(after.aliases.find(row => row.id === `shop.${shop.id}.cash`)?.amount, 73);
  assert.equal(after.claims.find(row => row.id === 'banking.accounts.player.deposits')?.amount, 900);
  host.state.player.money -= 25; company.capital += 25;
  near(cashSnapshot(host, world).total, before.total);
  // Snapshots have detached numbers; later source changes do not rewrite them.
  assert.equal(before.accounts.find(row => row.id === 'state.player.money')?.amount, 600);
});

test('released company and shop hold separate cash and food inventories', () => {
  const host = fixture(), beforeCash = cashSnapshot(host, world), beforeFood = foodCustodySnapshot(host, world);
  const foodBuildingIds = new Set(world.buildings.filter(row => ['farm', 'dock', 'market'].includes(row.kind)).map(row => row.id));
  const company = host.state.extension.companies.find((row: { buildingId: string }) => foodBuildingIds.has(row.buildingId));
  const shop = host.state.shops.find((row: { buildingId: string }) => row.buildingId === company.buildingId);
  const excludedCash = shop.cash ?? 0, independentFood = company.inventory;
  company.shopBindingReleasedAt = host.state.extension.lastUpdate;
  near(cashSnapshot(host, world).total, beforeCash.total + excludedCash);
  near(foodCustodySnapshot(host, world).total, beforeFood.total + independentFood);
  assert(foodCustodySnapshot(host, world).holdings.some(row => row.id === `company.${company.id}.inventory`));
});

test('food moves from the real source to cargo and matching district lots without double custody', () => {
  const host = fixture(), initial = foodCustodySnapshot(host, world);
  const vehicle = host.state.vehicles.find((row: { cargo: number }) => row.cargo > 0);
  const sourceId = host.runtime.cargoSources[vehicle.id], sourceShop = host.state.shops.find((row: { id: string }) => row.id === sourceId);
  sourceShop.inventory -= 2; vehicle.cargo += 2;
  near(foodCustodySnapshot(host, world).total, initial.total);
  const district = sourceShop.districtId;
  vehicle.cargo -= 2; host.runtime.freight[district] += 2;
  host.runtime.freightLots[district].push({ shopId: sourceId, quantity: 2 });
  const transferred = foodCustodySnapshot(host, world);
  near(transferred.total, initial.total);
  assert(transferred.freightLots.find(row => row.districtId === district)?.lots.some(row => row.shopId === sourceId && row.quantity === 2));
});

test('unknown and industrial cargo sources and mismatched freight lots fail explicitly', () => {
  let host = fixture();
  const vehicleId = host.state.vehicles.find((row: { cargo: number }) => row.cargo > 0).id;
  delete host.runtime.cargoSources[vehicleId];
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_IDENTITY.*cargoSources/);
  host = fixture(); host.runtime.cargoSources[vehicleId] = 'unregistered-producer';
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_SOURCE/);
  const materialSites = new Set(world.buildings.filter(row => row.kind === 'workshop').map(row => row.id));
  host.runtime.cargoSources[vehicleId] = host.state.shops.find((row: { buildingId: string }) => materialSites.has(row.buildingId)).id;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_SOURCE/);
  host = fixture(); host.runtime.freightLots.river[0].quantity += 1;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_FREIGHT_ALIAS/);
});

test('trade ownership is an inventory alias; ingredients and cooking have an explicit unsupported boundary', () => {
  const host = fixture(), initial = foodCustodySnapshot(host, world), retailerId = Object.keys(host.state.trade.ownedLots)[0];
  host.state.trade.ownedLots[retailerId][0].quantity -= 1;
  near(foodCustodySnapshot(host, world).total, initial.total);
  host.state.player.inventory['ingredient:grain'] = 1;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_UNSUPPORTED_FOOD_TRANSFORMATION/);
  delete host.state.player.inventory['ingredient:grain'];
  host.state.extension.cooking = { recipeId: 'rice', startedAt: 3900, finishAt: 3930, quality: 70 };
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_UNSUPPORTED_FOOD_TRANSFORMATION/);
});

test('native business title counters are checked metadata, never extra food', () => {
  const host = fixture(), before = foodCustodySnapshot(host, world), shop = host.state.shops.find((row: { buildingId: string }) => row.buildingId === 'market-b11');
  assert(shop); assert.notEqual(shop.ownerId, 'player');
  host.state.player.inventory.businesses = 0; host.state.player.inventory['business:market-b11'] = 0;
  assert.deepEqual(foodCustodySnapshot(host, world), before, 'actual NPC title transfer writes zero counters');
  shop.ownerId = 'player'; host.runtime.playerBusinesses.push(shop.id);
  host.state.player.inventory.businesses = 1; host.state.player.inventory['business:market-b11'] = 1;
  assert.deepEqual(foodCustodySnapshot(host, world), before, 'a valid player title cannot manufacture food');
  host.state.player.inventory.businesses = 2;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_OWNERSHIP_METADATA/);
  host.state.player.inventory.businesses = 1; host.state.player.inventory['business:market-b11'] = 0;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_OWNERSHIP_METADATA/);
  host.state.player.inventory['business:market-b11'] = 1; host.state.player.inventory['business:unknown-building'] = 0;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_OWNERSHIP_METADATA/);
  delete host.state.player.inventory['business:unknown-building']; host.state.player.inventory['unknown-food'] = 0;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_UNKNOWN_FOOD/, 'even a zero unknown commodity still fails');
});

test('new unclassified accounts and nonfinite money fail rather than entering an other bucket', () => {
  let host = fixture(); host.state.emergencyWallet = 1;
  assert.throws(() => cashSnapshot(host, world), /CUSTODY_UNKNOWN_ACCOUNT.*emergencyWallet/);
  host = fixture(); host.state.extension.companies[0].extraCapital = 1;
  assert.throws(() => cashSnapshot(host, world), /CUSTODY_UNKNOWN_ACCOUNT.*extraCapital/);
  host = fixture(); host.state.banking.cash = Infinity;
  assert.throws(() => cashSnapshot(host, world), /CUSTODY_NUMBER.*banking.cash/);
  host = fixture(); host.state.banking.accounts['nonexistent-resident'] = { deposits: 1, loanPrincipal: 0, loanInterest: 0, interestDue: 0, closed: false };
  assert.throws(() => cashSnapshot(host, world), /CUSTODY_IDENTITY.*unknown account holder/);
});

test('accessors, symbols and holes are rejected without invoking observer input code', () => {
  let calls = 0, host = fixture();
  Object.defineProperty(host.state.citizens[0], 'money', { enumerable: true, get() { calls++; return 10; } });
  assert.throws(() => cashSnapshot(host, world), /CUSTODY_SHAPE/); assert.equal(calls, 0);
  host = fixture(); Object.defineProperty(host, 'runtime', { get() { calls++; return {}; } });
  assert.throws(() => cashSnapshot(host, world), /CUSTODY_SHAPE.*host.runtime/); assert.equal(calls, 0);
  host = fixture(); host.state.shops[0][Symbol('cash')] = 1;
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_SHAPE.*symbol/);
  host = fixture(); delete host.state.vehicles[0];
  assert.throws(() => foodCustodySnapshot(host, world), /CUSTODY_SHAPE.*array hole/);
});

test('NPC debt preserves old employers and queue metadata through an accrual-to-payroll transfer', () => {
  const runtime = {
    wageArrears: [{ citizenId: 'worker', shopId: 'prior-shop', amount: 7 }],
    wageAccruals: [{ citizenId: 'worker', shopId: 'prior-shop', workId: 'old-site', districtId: 'river', minutes: 10, ratePerMinute: .5, amount: 5 }],
    wages: [{ citizenId: 'worker', shopId: null as string | null, districtId: 'core', amount: 3, expenseAccrued: true }],
  };
  const before = debtSnapshot(runtime);
  assert.equal(before.total, 15);
  assert.deepEqual(before.byEmployer, [
    { citizenId: 'worker', shopId: 'prior-shop', arrears: 7, accruals: 5, wages: 0, total: 12 },
    { citizenId: 'worker', shopId: null, arrears: 0, accruals: 0, wages: 3, total: 3 },
  ]);
  assert.equal(before.rows.find(row => row.queue === 'accruals')?.metadata.workId, 'old-site');
  runtime.wageAccruals = [];
  runtime.wages.push({ citizenId: 'worker', shopId: 'prior-shop', districtId: 'river', amount: 5, expenseAccrued: true });
  const after = debtSnapshot(runtime);
  assert.equal(after.total, before.total);
  assert.equal(after.byEmployer.find(row => row.shopId === 'prior-shop')?.total, 12);
  assert.equal(before.accruals, 5);
  assert.throws(() => debtSnapshot({ wages: [{ citizenId: 'player', amount: 3, districtId: 'core' }] }), /CUSTODY_IDENTITY.*NPC queues/);
  assert.throws(() => debtSnapshot({ wageArrears: [{ citizenId: 'worker', shopId: null, amount: NaN }] }), /CUSTODY_NUMBER/);
});
