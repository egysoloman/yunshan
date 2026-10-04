import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation, isCanonicalNpcWage } from '../src/simulation';
import { commodityObserver } from '../scripts/economy-observations';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { call, cash, foodHiringWorld, runtime } from './food-hiring-fixture';
import type { Vec3 } from '../src/types';

/** Controlled rule regression, not a naturally generated full-city journey.
 * The old fixture's declared dock is instead a farm before construction. Its
 * native 160 stock and original 120 cap are retained. Original residents keep
 * wallets/jobs/roles/home/skills; 92 start with hunger 29, and one original owner starts
 * at their own workpoint. All other residents walk the original graph. */
test('a native farm buffer pays genuine attendance at 160, then actual customer outflow enables funded positive production', () => {
  const world = foodHiringWorld();
  const farm = world.buildings.find(site => site.id === 'food-dock')!; farm.kind = 'farm';
  const sim = new Simulation(world), shop = sim.state.shops.find(row => row.buildingId === farm.id)!;
  assert.equal(shop.inventory, 160); assert.equal(sim.state.vehicles.length, 0);
  const owner = sim.state.citizens.find(actor => actor.id === sim.shopOwnerId(shop))!;
  const staff = sim.state.citizens.filter(actor => actor.workId === farm.id && actor.role !== '学生' && sim.state.extension!.actorProfiles[actor.id].age >= 18);
  assert.ok(staff.includes(owner)); assert.ok(staff.length > 1);
  const initialCash = cash(sim), initialWallet = owner.money;
  const contribution = Math.min(180, Math.max(0, owner.money - 100));
  owner.money -= contribution; sim.transferShopFunds(shop, contribution);
  owner.position = { x: farm.position.x, y: farm.position.y + .6, z: farm.position.z + .5 };
  const buyers = sim.state.citizens.filter(actor => !staff.includes(actor) && actor.role !== '学生' && sim.state.extension!.actorProfiles[actor.id].age >= 18).slice(0, 92);
  assert.equal(buyers.length, 92);
  for (const buyer of buyers) { assert.equal(buyer.food ?? 0, 0); assert.ok(buyer.money >= shop.price); buyer.needs.hunger = 29; }
  sim.setFocus({ ...farm.door }, 'walk');
  assert.ok(Math.abs(cash(sim) - initialCash) < 1e-7);
  const premises = { farmId: farm.id, initialInventory: 160, productionTarget: 120, ownerId: owner.id, initialWallet, contribution, initiallyOnsiteOwnerOnly: owner.id, focusAndPlayerInitialPosition: { ...farm.door }, initialBuyerHunger: 29, hungryBuyerIds: buyers.map(actor => actor.id), originalStaffIds: staff.map(actor => actor.id), scope: 'Controlled finite farm fixture; no default-city natural journey or sustainability claim. The separate original hunger54 fixture failed to produce outflow while actual paid public work remained committed above hunger30.' };
  const artifactRoot = process.env.FARM_BUFFER_ARTIFACTS;
  const save = (name: string, detail: unknown = {}) => { if (!artifactRoot) return; mkdirSync(artifactRoot, { recursive: true }); writeFileSync(join(artifactRoot, `${name}.save.json`), sim.exportSave()); writeFileSync(join(artifactRoot, `${name}.json`), JSON.stringify({ tick: sim.state.tick, clock: sim.state.extension!.lastUpdate, cash: cash(sim), inventory: shop.inventory, detail }, null, 2)); };
  const observed = commodityObserver(new Map(world.buildings.map(site => [site.id, site])), new Map(sim.state.shops.map(row => [row.id, row.buildingId])), isCanonicalNpcWage);
  const wages: { citizenId: string; amount: number; minutes: number; tick: number; clock: number; position: Vec3; startAt: number; endAt: number }[] = [];
  const paid: { citizenId: string; amount: number; tick: number }[] = [];
  const production: { amount: number; minutes: number; tick: number; beforeInventory: number; energy: number; agricultureLevel: number }[] = [];
  const sales: { citizenId: string; amount: number; quantity: number; tick: number; actualUnitPrice: number; position: Vec3 }[] = [];
  const zeroOutputBatches: { tick: number; labor: number; beforeInventory: number; afterInventory: number; open: boolean }[] = [];
  let beforeBatch: { tick: number; labor: number; inventory: number; commerceAt: number } | undefined;
  sim.onEvent('wage-earned', event => {
    observed.wageEarned(event);
    if (event.shopId !== shop.id || !event.minutes) return;
    const actor = sim.state.citizens.find(person => person.id === event.citizenId)!;
    assert.ok(isCanonicalNpcWage(event)); assert.equal(actor.state, 'working'); assert.ok(sim.isNearBuilding(farm, actor.position, 2));
    const role = call(sim, 'citizenIdentity', actor);
    assert.ok(sim.isAtBuildingFunctionPoint(farm, actor.position, 'work', { role, identities: [role] }));
    assert.equal(event.siteId, farm.id);
    assert.ok(event.creditedWorkStartAt !== undefined && event.creditedWorkEndAt !== undefined);
    assert.ok(Math.abs(event.minutes - (event.creditedWorkEndAt! - event.creditedWorkStartAt!)) < 1e-7);
    assert.ok(event.creditedWorkEndAt! <= sim.state.extension!.lastUpdate + 1e-7);
    wages.push({ citizenId: actor.id, amount: event.amount!, minutes: event.minutes, tick: sim.state.tick, clock: sim.state.extension!.lastUpdate, position: { ...actor.position }, startAt: event.creditedWorkStartAt!, endAt: event.creditedWorkEndAt! });
  });
  sim.onEvent('wage-paid', event => { if (event.shopId === shop.id) paid.push({ citizenId: event.citizenId!, amount: event.amount!, tick: sim.state.tick }); });
  sim.onEvent('production', event => {
    observed.production(event);
    if (event.shopId !== shop.id) return;
    const energy = sim.state.districts.find(district => district.id === shop.districtId)!.energy;
    const agricultureLevel = sim.state.extension!.technologies.find(item => item.sector === 'agriculture')?.level ?? 0;
    const beforeInventory = shop.inventory - event.amount!;
    const expected = Math.min(Math.max(0, 120 - beforeInventory), event.minutes! / 30 * energy / 100 * (1 + agricultureLevel * .12));
    assert.ok(event.minutes! > 0 && event.amount! > 0);
    assert.ok(Math.abs(event.amount! - expected) < 1e-7);
    assert.ok(beforeBatch && event.minutes === beforeBatch.labor, 'positive production consumes the actual saved batch once');
    production.push({ amount: event.amount!, minutes: event.minutes!, tick: sim.state.tick, beforeInventory, energy, agricultureLevel });
  });
  sim.onEvent('sale', event => {
    observed.sale(event);
    if (event.shopId !== shop.id || !event.citizenId) return;
    const actor = sim.state.citizens.find(person => person.id === event.citizenId)!;
    const relation = sim.state.relationships.find(item => item.npcId === actor.id);
    const actualUnitPrice = shop.price * ((relation?.trust ?? 0) > 55 ? .95 : 1);
    assert.ok(sim.isNearBuilding(farm, actor.position, 1));
    assert.ok(Math.abs(event.amount! - event.quantity! * actualUnitPrice) < 1e-7);
    sales.push({ citizenId: actor.id, amount: event.amount!, quantity: event.quantity!, tick: sim.state.tick, actualUnitPrice, position: { ...actor.position } });
  });
  sim.onPhase('people', () => {
    if (sim.state.day * 1440 + sim.state.hour * 60 >= runtime(sim).commerceAt) beforeBatch = { tick: sim.state.tick, labor: runtime(sim).shopLabor[shop.id] ?? 0, inventory: shop.inventory, commerceAt: runtime(sim).commerceAt };
    else beforeBatch = undefined;
  });
  sim.onPhase('commerce', () => {
    if (beforeBatch && beforeBatch.tick === sim.state.tick && runtime(sim).commerceAt > beforeBatch.commerceAt && beforeBatch.labor > 0 && !production.some(row => row.tick === sim.state.tick)) zeroOutputBatches.push({ tick: sim.state.tick, labor: beforeBatch.labor, beforeInventory: beforeBatch.inventory, afterInventory: shop.inventory, open: shop.open });
  });
  const until = (predicate: () => boolean, limit: number, message: string) => { for (let i = 0; i < limit && !predicate(); i++) sim.step(.25); if (!predicate()) save('failed-boundary', { message, wages, paid, production, sales, zeroOutputBatches, observer: observed.snapshot(), privateLabor: runtime(sim).privateLabor }); assert.ok(predicate(), message); };
  const exact24 = (name: string) => {
    const text = sim.exportSave(); assert.equal(assembleSave(partitionSave(text, world)), text);
    const restored = new Simulation(world); const loaded = restored.importSave(text); assert.ok(loaded.ok, loaded.message); assert.equal(restored.exportSave(), text);
    save(`${name}-before24`);
    for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave(), `${name}: every full tick ${i + 1}`); }
    save(`${name}-after24`);
  };
  save('initial-premises', premises);
  until(() => zeroOutputBatches.some(row => row.open && row.beforeInventory === 160 && row.afterInventory === 160), 180, 'original stock-buffer cap must allow actual funded attendance with zero output');
  assert.ok(wages.length > 0); assert.equal(production.length, 0); assert.equal(sales.length, 0);
  assert.ok(observed.snapshot().attendanceBySiteKind.farm.fundedAttendanceMinutes > 0);
  assert.equal(observed.snapshot().flows.food.productionMinutes, 0);
  assert.ok(staff.some(actor => actor !== owner && !wages.some(row => row.citizenId === actor.id)), 'original offsite workers have no invented attendance');
  save('funded-idle-stock-buffer', { premises, wages, zeroOutputBatches, observer: observed.snapshot() });
  exact24('funded-idle');
  until(() => sales.length > 0, 900, 'an original hungry resident must walk to the actual farm before a receipt');
  save('first-actual-sale', { sales, wages, inventory: shop.inventory }); exact24('actual-sale');
  until(() => shop.inventory < 120 && production.length > 0, 1200, 'real finite customer outflow below 120 must precede positive funded farm production');
  assert.ok(sales.reduce((sum, row) => sum + row.quantity, 0) > 40);
  assert.ok(production[0].beforeInventory < 120);
  assert.ok(production.some(row => wages.some(wage => wage.citizenId !== owner.id && wage.tick <= row.tick)), 'an original employee must physically arrive and earn work before positive production');
  const produced = production.reduce((sum, row) => sum + row.amount, 0), sold = sales.reduce((sum, row) => sum + row.quantity, 0);
  assert.ok(Math.abs(shop.inventory - (160 + produced - sold)) < 1e-7);
  assert.ok(Math.abs(cash(sim) - initialCash) < 1e-6);
  save('first-positive-production', { premises, wages, production, sales, zeroOutputBatches, observer: observed.snapshot() }); exact24('positive-production');
  assert.ok(sim.command({ type: 'speed', value: 8 }).ok);
  until(() => paid.length > 0, 400, 'native original payroll must remit actual farm earnings from finite business cash');
  const earnedGross = wages.reduce((sum, row) => sum + row.amount, 0), paidGross = paid.reduce((sum, row) => sum + row.amount, 0);
  const retainedClaims = [...runtime(sim).wageArrears, ...runtime(sim).wageAccruals].filter(row => row.shopId === shop.id).reduce((sum, row) => sum + row.amount, 0);
  assert.ok(paidGross > 0); assert.ok(Math.abs(earnedGross - paidGross - retainedClaims) < 1e-7);
  assert.ok(Math.abs(cash(sim) - initialCash) < 1e-6);
  assert.ok(Math.abs(shop.inventory - (160 + production.reduce((sum, row) => sum + row.amount, 0) - sales.reduce((sum, row) => sum + row.quantity, 0))) < 1e-7);
  save('actual-payroll', { premises, earnedGross, paidGross, retainedClaims, wages, paid, production, sales, zeroOutputBatches, observer: observed.snapshot() }); exact24('actual-payroll');
});
