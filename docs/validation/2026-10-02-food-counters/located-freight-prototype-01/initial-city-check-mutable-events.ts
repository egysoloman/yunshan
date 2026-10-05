import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { Simulation } from '../src/simulation';
import { Simulation as BaselineSimulation } from '/tmp/yunshan-empty-freight-production14-20261001/src/simulation.ts';
import { createWorld } from '../src/world';
import { partitionSave, assembleSave } from '../src/persistence/partition';

async function files(dir: string): Promise<string[]> { const output: string[] = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const p = `${dir}/${entry.name}`; if (entry.isDirectory()) output.push(...await files(p)); else output.push(p); } return output.sort(); }
const sourceFiles = await files('src'), hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async p => [p, createHash('sha256').update(await readFile(p)).digest('hex')])));
const startSourceHash = await hashes(), world = createWorld(20261001), baseline = new BaselineSimulation(world), sim = new Simulation(world);
const core = () => Reflect.get(sim, 'runtime');
const cash = () => { const s = sim.state, e = s.extension!; return s.treasury + core().taxes + s.player.money + s.banking!.cash + s.banking!.legacyInvestmentCash + s.citizens.reduce((n, c) => n + c.money, 0) + s.shops.filter(shop => !e.companies.some(c => c.buildingId === shop.buildingId)).reduce((n, shop) => n + (shop.cash ?? 0), 0) + e.companies.reduce((n, c) => n + c.capital, 0) + e.organizations.reduce((n, o) => n + o.funds, 0) + (s.playerLabor?.job?.escrow ?? 0) + (s.clinical?.orders.reduce((n, order) => n + order.escrow, 0) ?? 0) + (s.family?.pregnancies.reduce((n, p) => n + p.escrow, 0) ?? 0) + (s.family?.households.reduce((n, h) => n + h.balance, 0) ?? 0); };
const food = () => sim.state.shops.filter(shop => sim.shopCommodity(shop) === 'food').reduce((n, shop) => n + shop.inventory, 0) + sim.state.vehicles.reduce((n, v) => n + v.cargo, 0) + Object.values(core().freight as Record<string, number>).reduce((n, q) => n + q, 0) + sim.state.citizens.reduce((n, c) => n + (c.food ?? 0), 0) + (sim.state.player.inventory.food ?? 0);
const initialCash = cash(), initialFood = food(), initialCargo = sim.state.vehicles.reduce((n, v) => n + v.cargo, 0);
let produced = 0, consumed = 0, loaded = 0, unloaded = 0;
const arrivals: any[] = [], pickups: any[] = [];
sim.onEvent('production', e => { if (sim.shopCommodity(sim.state.shops.find(shop => shop.id === e.shopId)!) === 'food') produced += e.amount ?? 0; });
sim.onEvent('sale', e => { if (sim.shopCommodity(sim.state.shops.find(shop => shop.id === e.shopId)!) === 'food' && e.citizenId) consumed++; });
sim.onEvent('stored-meal', e => consumed += e.amount ?? 0); sim.onEvent('food-consumed', e => consumed += e.amount ?? 0);
sim.onEvent('cargo-loaded', e => { loaded += e.amount ?? 0; pickups.push({ tick: sim.state.tick, ...structuredClone(e) }); });
sim.onEvent('cargo-arrived', e => { unloaded += e.amount ?? 0; const v = sim.state.vehicles.find(v => v.id === e.vehicleId)!; assert.equal(v.cargo, 0); arrivals.push({ tick: sim.state.tick, ...structuredClone(e), passengers: v.passengers }); });
assert.equal(sim.exportSave(), baseline.exportSave(), 'before real unloading, adding trusted native definitions cannot change initial save');
sim.command({ type: 'speed', value: 8 }); baseline.command({ type: 'speed', value: 8 });
function withoutTracking(json: string) {
  const s = JSON.parse(json); delete s.freightTrackingVersion; delete s.runtime.freightTracking;
  if (s.runtime.freightLots) for (const [district, lots] of Object.entries(s.runtime.freightLots) as [string, any[]][]) {
    const originalLots: any[] = [];
    for (const lot of lots) { const existing = originalLots.find(l => l.shopId === lot.shopId); if (existing) existing.quantity += lot.quantity; else originalLots.push({ shopId: lot.shopId, quantity: lot.quantity }); }
    s.runtime.freightLots[district] = originalLots;
  }
  return JSON.stringify(s);
}
const prefix: { tick: number; normalizedSaveExact: boolean }[] = [];
for (let tick = 0; tick < 80; tick++) {
  sim.step(.25); baseline.step(.25);
  assert.equal(withoutTracking(sim.exportSave()), baseline.exportSave(), `unchanged actual base rules/cash/stock/jobs at tick ${tick + 1}`);
  if ([1, 16, 40, 80].includes(tick + 1)) prefix.push({ tick: tick + 1, normalizedSaveExact: true });
}
const saved = sim.exportSave(), restored = new Simulation(world); assert.equal(restored.importSave(saved).ok, true); assert.equal(restored.exportSave(), saved);
assert.equal(assembleSave(partitionSave(saved, world)), saved, 'existing opaque global partition preserves tracking and declaration exactly');
const lots = Object.entries(core().freightLots) as [string, any[]][];
for (const [districtId, batch] of lots) { assert.ok(Math.abs(batch.reduce((n, lot) => n + lot.quantity, 0) - core().freight[districtId]) < 1e-7); for (const lot of batch) { const origin = core().freightTracking.origins[lot.id]; assert.equal(origin.districtId, districtId); assert.equal(origin.shopId, lot.shopId); assert.ok(lot.quantity <= origin.receivedQuantity + 1e-7); } }
const result = { scope: 'Isolated original coherent05 world, 80 actual default city ticks at explicit 8x (160 game minutes). No cash/goods/jobs/policy/position injections. This is not a 14/30/60-day audit or v4 build verification.', sourceFiles: sourceFiles.length, startSourceHash, endSourceHash: await hashes(), baselineSource: '/tmp/yunshan-empty-freight-production14-20261001', prefix, initialCash, finalCash: cash(), cashResidual: initialCash - cash(), initialFood, produced, consumed, finalFood: food(), foodResidual: initialFood + produced - consumed - food(), initialCargo, loaded, unloaded, finalCargo: sim.state.vehicles.reduce((n, v) => n + v.cargo, 0), cargoResidual: initialCargo + loaded - unloaded - sim.state.vehicles.reduce((n, v) => n + v.cargo, 0), liveLots: lots.reduce((n, [, batch]) => n + batch.length, 0), trackingVersion: JSON.parse(saved).freightTrackingVersion, arrivals, pickups, saveExact: true, partitionExact: true, extraContinuationTicks: 24 };
assert.ok(Math.abs(result.cashResidual) < 1e-6); assert.ok(Math.abs(result.foodResidual) < 1e-6); assert.ok(Math.abs(result.cargoResidual) < 1e-6); assert.deepEqual(result.startSourceHash, result.endSourceHash);
for (let tick = 0; tick < 24; tick++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave(), `actual city exact continuation tick ${tick + 1}`); }
assert.deepEqual(startSourceHash, await hashes());
await writeFile('artifacts/located-freight-city-check.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({sourceFiles:sourceFiles.length,actualTicks:80,continuationTicks:24,unloads:arrivals.length,pickups:pickups.length,unloaded,loaded,cashResidual:result.cashResidual,foodResidual:result.foodResidual,cargoResidual:result.cargoResidual,normalizedBaselinePrefixExact:true,partitionExact:true,saveExact:true}));
