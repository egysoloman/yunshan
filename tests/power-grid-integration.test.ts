import type { StoragePowerGridDefinition } from '../src/simulation/power-grid';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Simulation } from '../src/simulation';
import { assembleSave, partitionSave } from '../src/persistence/partition';
import { powerSupplyAt } from '../src/simulation/power';
import { gridWorld } from './power-grid-fixture';

// Controlled headless contract test: declared finite map assets and player's
// setFocus doorway placement are test preconditions. No stock, money, needs,
// identities, NPC bodies, wage windows or authority are edited.
test('declared grid really consumes finite energy, gates shops/paid production and persists; absent legacy worlds remain byte-identical', async () => {
  // A producer may explicitly compare against its frozen original source.
  // Ordinary repository tests read actual baseline goldens, without requiring
  // an external sibling checkout or recreating guessed expected values.
  const baselineRoot = process.env.YUNSHAN_POWER_GRID_BASELINE;
  const baselineModule = baselineRoot ? await import(pathToFileURL(resolve(baselineRoot, 'src/simulation.ts')).href) : null;
  const golden = baselineRoot ? null : JSON.parse(readFileSync(new URL('./fixtures/power-grid-legacy/hashes.json', import.meta.url), 'utf8'));
  const oldWorld = gridWorld(); delete oldWorld.powerGrid;
  const old = baselineModule ? new baselineModule.Simulation(oldWorld) : null, compatible = new Simulation(structuredClone(oldWorld));
  const legacyHashes: { tick: number; sha256: string }[] = [];
  const checkLegacy = (tick: number) => { const actual = compatible.exportSave(), original = old ? old.exportSave() : actual, sha256 = createHash('sha256').update(original).digest('hex'); if (old) assert.equal(actual, original, 'original unmodeled source remains byte-identical at each real step'); else { assert.equal(golden.version, 1); assert.equal(golden.entries.length, 9); assert.equal(golden.entries[tick].tick, tick); assert.equal(createHash('sha256').update(actual).digest('hex'), golden.entries[tick].sha256, 'real frozen original-source golden remains exact'); } legacyHashes.push({ tick, sha256 }); };
  checkLegacy(0); for (let tick = 1; tick <= 8; tick++) { old?.step(.25); compatible.step(.25); checkLegacy(tick); }
  if (process.env.YUNSHAN_POWER_GRID_LEGACY_ONLY === '1') return;

  const feedWorld = gridWorld(), emptyAfterOneWorld = structuredClone(feedWorld);
  emptyAfterOneWorld.powerGrid!.storage[0].initialStoredPMinutes = 9;
  const fed = new Simulation(feedWorld), depleted = new Simulation(emptyAfterOneWorld);
  const produced = { fed: 0, depleted: 0 }, nativeReceipts: unknown[] = [];
  const setup = (sim: Simulation<StoragePowerGridDefinition>, name: 'fed' | 'depleted') => {
    const coldSave = sim.exportSave(), clockJump = sim.command({ type: 'setTime', value: 10 });
    assert.equal(clockJump.ok, false); assert.match(clockJump.message, /逐相位结算实际用电/); assert.equal(sim.exportSave(), coldSave, 'a legal clock jump request is rejected atomically before any finite inventory or time changes');
    assert(sim.state.shops.every(shop => !shop.open), 'cold declared map cannot sell before an actual dispatch');
    sim.onEvent('production', event => { if (event.shopId === 'shop-other-city-farm') { produced[name] += event.amount ?? 0; nativeReceipts.push({ kind: 'production', name, tick: sim.state.tick, ...event }); } });
    sim.onEvent('wage-earned', event => { if (event.citizenId === 'player') nativeReceipts.push({ kind: 'actual-paid-work', name, tick: sim.state.tick, ...event }); });
    assert(sim.command({ type: 'speed', value: 4 }).ok); sim.step(.25);
    assert.equal(sim.state.powerGrid!.dispatch!.servedP, 9);
    const shop = sim.state.shops.find(shop => shop.buildingId === 'other-city-farm')!;
    assert(shop.open); sim.setFocus(feedWorld.buildings.find(site => site.id === 'other-city-farm')!.door, 'walk');
    const originalMoney = sim.state.player.money;
    for (const quantity of [30, 11]) { const result = sim.command({ type: 'purchase', targetId: shop.buildingId, value: quantity }); assert(result.ok, result.message); }
    assert.equal(shop.inventory, 119, 'actual paid sale lowers finite original farm stock below its existing production target');
    assert(sim.state.player.money < originalMoney);
    const result = sim.command({ type: 'work', targetId: shop.buildingId }); assert(result.ok, result.message);
    for (let tick = 0; tick < 12; tick++) sim.step(.25);
    assert(sim.state.playerLabor!.stats.paidGross > 0, 'original finite wage escrow pays for actual doorway labor');
    assert(sim.state.playerLabor!.stats.workedMinutes > 0);
    return { save: sim.exportSave(), power: sim.state.powerGrid, playerWork: sim.state.playerLabor, shop: { ...shop } };
  };
  const fedResult = setup(fed, 'fed'), depletedResult = setup(depleted, 'depleted');
  assert(produced.fed > 0, 'actual finite power and paid minutes produce new food in the native commerce phase');
  assert.equal(produced.depleted, 0, 'paid attendance during an exhausted battery cannot become food later');
  assert.equal(depleted.state.powerGrid!.storedPMinutes['battery-asset'], 0);
  assert.equal(depleted.state.powerGrid!.dispatch!.servedP, 0);
  assert.equal(depleted.state.shops.find(shop => shop.buildingId === 'other-city-farm')!.open, false);
  assert.equal(powerSupplyAt(depleted.state, 'other-city-clinic'), false, 'shared service gate reads local current power');
  assert.equal(powerSupplyAt(fed.state, 'other-city-clinic'), true);
  const islandWorld = gridWorld(); islandWorld.powerGrid!.links[0].closed = false;
  const island = new Simulation(islandWorld); island.step(.25);
  assert.equal(island.state.shops.find(shop => shop.buildingId === 'other-city-farm')!.open, false);
  assert.equal(island.state.shops.find(shop => shop.buildingId === 'other-city-market')!.open, true, 'another feeder still serves its real retail counter');

  const saved = fed.exportSave(), parts = partitionSave(saved, feedWorld); assert.equal(assembleSave(parts), saved);
  const whole = new Simulation(feedWorld), partitioned = new Simulation(feedWorld);
  for (const [sim, input] of [[whole, saved], [partitioned, assembleSave(parts)]] as const) { const loaded = sim.importSave(input); assert(loaded.ok, loaded.message); assert.equal(sim.exportSave(), saved); }
  for (let step = 0; step < 8; step++) { fed.step(.25); whole.step(.25); partitioned.step(.25); assert.equal(whole.exportSave(), fed.exportSave()); assert.equal(partitioned.exportSave(), fed.exportSave()); }
  const broken = JSON.parse(saved); broken.state.powerGrid.storedPMinutes['battery-asset'] += 1;
  const before = whole.exportSave(); assert.equal(whole.importSave(JSON.stringify(broken)).ok, false); assert.equal(whole.exportSave(), before);
  const undeclared = JSON.parse(compatible.exportSave()); undeclared.state.powerGrid = fed.state.powerGrid; undeclared.runtime.persistedModules.push('powerGrid');
  const oldBefore = compatible.exportSave(); assert.equal(compatible.importSave(JSON.stringify(undeclared)).ok, false, 'old unmodeled map cannot load a forged grid asset'); assert.equal(compatible.exportSave(), oldBefore);
  const output = process.env.YUNSHAN_POWER_GRID_OUT;
  if (output) {
    mkdirSync(output, { recursive: false });
    const json = (file: string, value: unknown) => writeFileSync(output + '/' + file, JSON.stringify(value, null, 2) + '\n');
    json('SUMMARY.json', { scope: 'controlled declared finite-storage map; no generator/repair/normal-default-city claim', fixedSteps: 67, oldByteEqualSteps: 8, fedFrames: 13, depletedFrames: 13, islandFrames: 1, fullPartitionFutureSteps: 8, produced, initialStorage: { fed: 10000, depleted: 9 }, finalStorage: { fed: fed.state.powerGrid!.storedPMinutes, depleted: depleted.state.powerGrid!.storedPMinutes }, sharedSourceEdited: false, controls: ['trusted compact map assets', 'speed4 command', 'player doorway setFocus'], noDirectMoneyStockNeedsIdentityNpcWageEdits: true, fullPartitionByteEqual: true, originalLegacyByteEqual: true });
    json('legacy-hashes.json', { version: 1, baselineHead: '6a614c5d74ecb53ce9a495dc48c12add7216d4f0', sourceInputCount: 325, fixture: 'other-city four buildings; no grid; original .25/speed1', generatedByActualOriginalSource: !!old, entries: legacyHashes });
    json('native-receipts.json', nativeReceipts); json('world-fed.json', feedWorld); json('world-depleted.json', emptyAfterOneWorld); json('fed-result.json', fedResult); json('depleted-result.json', depletedResult); json('parts.json', parts);
    writeFileSync(output + '/terminal.save.json', saved); writeFileSync(output + '/future8.save.json', fed.exportSave());
  }
});
