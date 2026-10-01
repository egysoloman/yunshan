import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWorld } from '../src/world';
import { Simulation } from '../src/simulation';
import type { CityExtensionState, Citizen, LedgerEntry, Vec3 } from '../src/types';

// One deterministic city, 10,000 fixed ticks at explicit 8x fast-forward.
// This checks resource flows and elapsed gameplay, not rendering performance.
const ticks = 10_000;
const speed = 8;
const sourceHash = Object.fromEntries(await Promise.all([
  'src/simulation.ts', 'src/simulation/extensions.ts', 'src/world.ts', 'src/access.ts',
].map(async file => [file, createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex')])));
const world = createWorld();
const sim = new Simulation(world);
assert.equal(sim.command({ type: 'speed', value: speed }).ok, true);
const extension = () => sim.state.extension! as CityExtensionState & {
  runtime: { nextCompanyAt: number; researchJobs: Record<string, {
    actorId?: string; budget: number; startedAt: number; finishAt: number;
  } | undefined> };
};
// Read-only observation of the same persisted accounting queues used by finance.
// No world, citizen, RNG or bookkeeping values are injected by this audit.
interface Bookkeeping { taxes: number; operatingCost: number; wages: { citizenId: string; amount: number }[] }
const core = () => Reflect.get(sim, 'runtime') as Bookkeeping;
const buildings = new Map(world.buildings.map(building => [building.id, building]));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const totals = { sales: 0, saleCount: 0, saleTax: 0, fares: 0, payrollPublicRequested: 0,
  payrollPublicPaid: 0, payrollPrivate: 0, wageTax: 0, operations: 0, security: 0, financeDelta: 0 };
const ledger: Record<string, { count: number; amount: number }> = {};
const seenLedger = new WeakSet<LedgerEntry>();
const deaths: Record<string, unknown>[] = [];
const deadIds = new Set<string>();
const beforeLife = new Map<string, Record<string, unknown>>();
const starts: Record<string, unknown>[] = [];
const seenJobs = new Set<string>();
const snapshots: ReturnType<typeof snapshot>[] = [];
const initialTreasury = sim.state.treasury;
const initialMinute = extension().lastUpdate;
let beforeFinance = initialTreasury;
let afterFinance = initialTreasury;
let beforeResearch: { money: Map<string, number>; wages: Bookkeeping['wages'] } | undefined;
let exactResearchDebits = 0;
let researchFunding = 0;
let failure: string | undefined;
let reconciliationResidual = 0;

sim.onEvent('sale', event => {
  totals.sales += event.amount ?? 0;
  totals.saleCount++;
  totals.saleTax += (event.amount ?? 0) * sim.state.taxRate;
});
sim.onEvent('transit-fare', event => { totals.fares += event.amount ?? 0; });
sim.onPhase('energy', () => { totals.operations += core().operatingCost; });
sim.onPhase('traffic', () => {
  for (const citizen of sim.state.citizens) if (extension().actorProfiles[citizen.id].alive) {
    beforeLife.set(citizen.id, { health: extension().actorProfiles[citizen.id].health,
      hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue, money: citizen.money,
      role: citizen.role, state: citizen.state, destinationId: citizen.destinationId, position: { ...citizen.position } });
  }
});
sim.onPhase('people', () => {
  for (const citizen of sim.state.citizens) {
    const profile = extension().actorProfiles[citizen.id];
    if (profile.alive || deadIds.has(citizen.id)) continue;
    deadIds.add(citizen.id);
    const food = sim.state.shops.filter(shop => shop.open && shop.inventory >= 1 && citizen.money >= shop.price);
    deaths.push({ id: citizen.id, tick: sim.state.tick, day: sim.state.day, age: profile.age,
      health: profile.health, hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue,
      money: citizen.money, before: beforeLife.get(citizen.id),
      homeWorkDistance: distance(buildings.get(citizen.homeId)!.door, buildings.get(citizen.workId)!.door),
      clinicDistance: Math.min(...world.buildings.filter(b => b.kind === 'clinic').map(b => distance(citizen.position, b.door))),
      foodDistance: food.length ? Math.min(...food.map(shop => distance(citizen.position, buildings.get(shop.buildingId)!.door))) : null });
  }
  beforeFinance = sim.state.treasury;
  let available = beforeFinance;
  for (const wage of core().wages) {
    const citizen = sim.state.citizens.find(c => c.id === wage.citizenId)!;
    const employer = sim.state.shops.find(shop => shop.buildingId === citizen.workId);
    const paid = employer ? wage.amount : Math.min(available, wage.amount);
    if (employer) totals.payrollPrivate += paid;
    else { totals.payrollPublicRequested += wage.amount; totals.payrollPublicPaid += paid; available -= paid; }
    totals.wageTax += paid * sim.state.taxRate;
  }
});
sim.onPhase('commerce', () => {
  if (extension().lastUpdate + 1e-7 < extension().runtime.nextCompanyAt) return;
  beforeResearch = { money: new Map(sim.state.citizens.map(c => [c.id, c.money])), wages: structuredClone(core().wages) };
});
sim.onPhase('finance', () => {
  afterFinance = sim.state.treasury;
  totals.financeDelta += afterFinance - beforeFinance;
  const e = extension();
  for (const [sector, job] of Object.entries(e.runtime.researchJobs)) {
    if (!job || !job.actorId || job.actorId === 'player') continue;
    const key = `${sector}:${job.actorId}:${job.startedAt}`;
    if (seenJobs.has(key)) continue;
    seenJobs.add(key);
    assert.ok(beforeResearch);
    const citizen = sim.state.citizens.find(c => c.id === job.actorId)!;
    const workplace = buildings.get(citizen.workId)!;
    const payment = e.publicLedger.find(row => row.tick === sim.state.tick && row.actorId === citizen.id && row.purpose.endsWith('居民科研投入'));
    assert.equal(job.budget, 200);
    assert.equal(job.finishAt - job.startedAt, 120);
    assert.ok(payment);
    assert.equal(payment.amount, 200);
    assert.ok(citizen.money >= 100 - 1e-7);
    assert.ok(citizen.needs.hunger >= 40 && citizen.needs.fatigue >= 40);
    assert.ok((citizen.education ?? 0) >= 3 && e.actorProfiles[citizen.id].skill >= 35);
    assert.ok(['scientist', '科研员', '科学家'].includes(citizen.role));
    assert.ok(sim.isNearBuilding(workplace, citizen.position));
    const grossWage = beforeResearch.wages.filter(w => w.citizenId === citizen.id).reduce((sum, w) => sum + w.amount, 0);
    const debit = beforeResearch.money.get(citizen.id)! - citizen.money;
    // A wage or company dividend can legitimately offset the same tick's debit.
    const canVerifyExact = grossWage === 0 && !e.companies.some(c => (c.shareholders[citizen.id] ?? 0) > 0);
    if (canVerifyExact) { assert.ok(Math.abs(debit - 200) < 1e-6); exactResearchDebits++; }
    researchFunding += 200;
    starts.push({ tick: sim.state.tick, day: sim.state.day, hour: sim.state.hour, id: citizen.id,
      role: citizen.role, sector, moneyBefore: beforeResearch.money.get(citizen.id), moneyAfter: citizen.money,
      grossWage, debit, exactDebitVerified: canVerifyExact, ledgerCredit: payment.amount,
      hunger: citizen.needs.hunger, fatigue: citizen.needs.fatigue, education: citizen.education,
      skill: e.actorProfiles[citizen.id].skill, workKind: workplace.kind, workFacility: workplace.facility });
  }
});
sim.onPhase('security', () => { totals.security += afterFinance - sim.state.treasury; });
sim.onPhase('feedback', () => {
  for (const row of extension().publicLedger) {
    if (seenLedger.has(row)) continue;
    seenLedger.add(row);
    if (row.account !== 'public') continue;
    const aggregate = ledger[row.purpose] ??= { count: 0, amount: 0 };
    aggregate.count++; aggregate.amount += row.amount;
  }
});

function snapshot() {
  const s = sim.state, e = extension(), actors = s.citizens;
  const alive = actors.filter(c => e.actorProfiles[c.id].alive);
  const mean = (list: Citizen[], value: (citizen: Citizen) => number) => list.length ? list.reduce((n, c) => n + value(c), 0) / list.length : 0;
  return { tick: s.tick, day: s.day, hour: s.hour, treasury: s.treasury, gdp: s.gdp,
    npcMoney: actors.reduce((n, c) => n + c.money, 0), wages: { ...totals }, ledger: structuredClone(ledger),
    shops: { total: s.shops.length, open: s.shops.filter(shop => shop.open).length,
      belowClosureThreshold: s.shops.filter(shop => shop.profit < -600).length,
      zeroEmployees: s.shops.filter(shop => shop.employees === 0).length,
      employees: s.shops.reduce((n, shop) => n + shop.employees, 0),
      averageProfit: meanShops(s.shops.map(shop => shop.profit)) },
    npc: { alive: alive.length, total: actors.length, meanHealth: mean(actors, c => e.actorProfiles[c.id].health),
      meanHunger: mean(actors, c => c.needs.hunger), meanFatigue: mean(actors, c => c.needs.fatigue),
      livingMeanHealth: mean(alive, c => e.actorProfiles[c.id].health), livingMeanHunger: mean(alive, c => c.needs.hunger),
      livingMeanFatigue: mean(alive, c => c.needs.fatigue), researchCompleted: e.stats.researchCompleted,
      companies: e.companies.length, zeroCapitalCompanies: e.companies.filter(c => c.capital === 0).length,
      playerAlive: e.actorProfiles.player.alive },
    technologies: e.technologies.map(t => ({ sector: t.sector, level: t.level })),
    companies: e.companies.map(c => ({ id: c.id, capital: c.capital, profit: c.profit, employees: c.employees })) };
}
function meanShops(profits: number[]) { return profits.length ? profits.reduce((sum, p) => sum + p, 0) / profits.length : 0; }

try {
  sim.setFocus(world.spawn, 'walk');
  snapshots.push(snapshot());
  for (let tick = 0; tick < ticks; tick++) {
    sim.step(.25);
    if (tick % 1000 === 0) sim.setFocus(world.districts[Math.floor(tick / 1000) % world.districts.length].center, tick % 2000 === 0 ? 'walk' : 'drone');
    if ([1000, 3000, 5000, 7000, ticks].includes(sim.state.tick)) {
      const sample = snapshot(); snapshots.push(sample);
      console.log(JSON.stringify({ tick: sample.tick, day: sample.day, treasury: sample.treasury, npc: sample.npc }));
    }
  }
  assert.ok(starts.length > 0 && exactResearchDebits > 0);
  assert.ok(extension().stats.researchCompleted > 0);
  // Periodic '城市…' rows summarize earlier movements; adding those again would double-count.
  const explicit = Object.entries(ledger).filter(([purpose]) => !purpose.startsWith('城市')).reduce((sum, [, row]) => sum + row.amount, 0);
  const expected = initialTreasury + totals.saleTax + totals.wageTax + totals.fares
    - totals.payrollPublicPaid - totals.operations - totals.security + explicit;
  reconciliationResidual = expected - sim.state.treasury;
  assert.ok(Math.abs(reconciliationResidual) < 1e-6, `treasury reconciliation residual ${reconciliationResidual}`);
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
}
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/economy-audit.json', import.meta.url), JSON.stringify({
  status: failure ? 'failed' : 'passed', sourceHash, speed, ticks: sim.state.tick,
  scope: 'One actual generated city at explicit 8x fast-forward; no renderer or default-speed performance claim.',
  elapsedGameMinutes: extension().lastUpdate - initialMinute, totals, ledger, snapshots, deaths, starts,
  researchFunding, exactResearchDebits, researchCompleted: extension().stats.researchCompleted,
  reconciliationResidual, ...(failure ? { failure } : {}),
}, null, 2));
console.log(JSON.stringify({ status: failure ? 'failed' : 'passed', deaths: deaths.length,
  treasury: sim.state.treasury, researchCompleted: extension().stats.researchCompleted,
  researchFunding, reconciliationResidual, artifact: 'artifacts/economy-audit.json' }));
if (failure) console.error(failure);
