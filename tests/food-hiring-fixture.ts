// One controlled starting vacancy, finite owner-wallet capital transfer, an
// expired public standing appropriation and 92 initially hungry adults. All
// people, roles, original workplaces, skills and money originate in Simulation.
// Only the owner is placed once at their actual business; no repeated pinning.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../src/simulation';
import { shopLifecycleHeldCash } from '../src/simulation/shop_lifecycle';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import type { Building, Citizen, Shop, WorldDefinition } from '../src/types';
export const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
export const call = (sim: Simulation, name: string, ...args: unknown[]) => Reflect.get(sim, name).call(sim, ...args);
export function foodHiringWorld(civic = false): WorldDefinition {
  const building = (id: string, kind: Building['kind'], x: number, capacity = 100): Building => ({ id, kind, name: id, districtId: 'food-district', position: { x, y: 20, z: 0 }, door: { x, y: 20.6, z: kind === 'home' ? 5 : 1 }, width: kind === 'home' ? 8 : 2, depth: kind === 'home' ? 8 : 2, height: 8, floors: 1, rotation: 0, capacity, seed: x });
  const buildings = [building('food-home', 'home', civic ? 350 : 0), ...Array.from({ length: 128 }, (_, i) => building(`school-${i}`, 'school', 20 + i * 3)), building('food-dock', 'dock', 450, 4), building('food-materials', 'workshop', 460, 4), ...(civic ? [building('food-hall', 'hall', 420)] : [])];
  const nodes = buildings.map(b => ({ id: `${b.id}-door`, name: b.id, districtId: b.districtId, position: { ...b.door }, station: false }));
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
  const edges: WorldDefinition['edges'] = sorted.slice(1).map((node, i) => ({ id: `food-road-${i}`, from: sorted[i].id, to: node.id, mode: 'road', length: Math.hypot(node.position.x - sorted[i].position.x, node.position.z - sorted[i].position.z), capacity: 20, points: [sorted[i].position, node.position] }));
  assert.ok(edges.every(edge => edge.length < 80), 'no initial freight/passenger fleet; walking remains the real original movement');
  return { seed: 7, voxelSize: .2, size: 1000, mountains: [], river: [], buildings, nodes, edges, spawn: { ...buildings[0].door }, districts: [{ id: 'food-district', name: '有限缺粮招聘场景', kind: 'market', center: { x: 225, y: 20, z: 0 }, radius: 600, color: '#abc', population: 384 }], waterfall: { top: { x: 900, y: 60, z: 900 }, bottom: { x: 900, y: 20, z: 900 }, width: 10 } };
}
export function cash(sim: Simulation): number {
  const s = sim.state, e = s.extension!, r = runtime(sim);
  return s.treasury + r.taxes + s.player.money + (s.banking ? s.banking.cash + s.banking.legacyInvestmentCash : s.bankBalance + r.investment) + s.citizens.reduce((n, c) => n + c.money, 0)
    + s.shops.filter(shop => !e.companies.some(c => c.buildingId === shop.buildingId)).reduce((n, shop) => n + (shop.cash ?? 0), 0) + e.companies.reduce((n, c) => n + c.capital, 0) + e.organizations.reduce((n, o) => n + o.funds, 0)
    + (s.playerLabor?.job?.escrow ?? 0) + (s.education?.course?.escrow ?? 0) + (s.clinical?.orders.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.power?.repairs.reduce((n, o) => n + o.escrow, 0) ?? 0)
    + (s.roadworks?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0) + (s.hygiene?.jobs.reduce((n, o) => n + o.escrow, 0) ?? 0) + shopLifecycleHeldCash(s)
    + (s.family?.pregnancies.reduce((n, p) => n + p.escrow, 0) ?? 0) + (s.family?.households.reduce((n, h) => n + h.balance, 0) ?? 0);
}
export function setup(civic = false) {
  const sim = new Simulation(foodHiringWorld(civic)), shop = sim.state.shops.find(s => s.buildingId === 'food-dock')!, site = sim.worldDefinition.buildings.find(b => b.id === shop.buildingId)!;
  assert.equal(sim.state.vehicles.length, 0); assert.equal(shop.inventory, 90);
  const staff = sim.state.citizens.filter(c => c.workId === site.id && c.role !== '学生'), owner = sim.state.citizens.find(c => c.id === sim.shopOwnerId(shop))!;
  assert.ok(staff.includes(owner)); assert.ok(staff.length >= 2); shop.employees = 1; // Existing headcount, with an original inactive roster entry ahead of the new applicant.
  const initialCash = cash(sim);
  // An actual zero-cash owner review records the original unfunded roster.
  // All withdrawn cash stays in the same proprietor wallet; no wage is invented.
  owner.position = { x: site.position.x, y: site.position.y + .6, z: site.position.z + .5 };
  const seedCash = sim.shopFunds(shop); owner.money += seedCash; sim.transferShopFunds(shop, -seedCash); shop.employees = staff.length;
  call(sim, 'reviewPrivateShifts'); shop.employees = 1;
  const contribution = Math.min(180, owner.money - 40);
  assert.ok(contribution > 0); owner.money -= contribution; sim.transferShopFunds(shop, contribution); assert.ok(Math.abs(cash(sim) - initialCash) < 1e-7);
  owner.position = { x: site.position.x, y: site.position.y + .6, z: site.position.z + .5 };
  const applicant = sim.state.citizens.find(c => Number(c.id.slice(8)) > Number(staff.at(-1)!.id.slice(8)) && c.role === '老师' && (c.education ?? 0) >= 2 && (c.skills?.craft ?? 0) >= 20 && sim.state.extension!.actorProfiles[c.id].age >= 18)!;
  assert.ok(applicant);
  const buyers = sim.state.citizens.filter(c => c !== owner && c !== applicant && c.role !== '学生' && c.workId !== site.id && sim.state.extension!.actorProfiles[c.id].age >= 18).slice(0, 92);
  assert.equal(buyers.length, 92); for (const c of buyers) { assert.equal(c.food ?? 0, 0); assert.ok(c.money >= shop.price); c.needs.hunger = 54; }
  const jobs: Record<string, string> = { [applicant.id]: applicant.workId };
  if (civic) for (const official of sim.state.citizens.filter(c => c.role === '官员')) jobs[official.id] = official.workId;
  runtime(sim).publicLabor = { version: 1, standingUntilDay: 0, nextReviewAt: sim.state.extension!.lastUpdate + 60, jobs, shifts: [], stats: { approvedMinutes: 0, unfundedMinutes: 0, workedMinutes: 0, privateMoves: 0 } };
  sim.setFocus({ ...site.door }, 'walk');
  assert.ok(sim.buildingTravelDistance(applicant.homeId, site.id) <= 500); assert.equal(call(sim, 'publicWorkAllowance', applicant), 0);
  return { sim, shop, site, staff, owner, applicant, buyers, initialCash, originalWorkId: applicant.workId, originalRole: applicant.role, originalHomeId: applicant.homeId };
}
export function saveObservation(sim: Simulation, name: string, detail: unknown = {}) {
  const root = process.env.FOOD_HIRING_ARTIFACTS; if (!root) return;
  mkdirSync(root, { recursive: true }); writeFileSync(join(root, `${name}.save.json`), sim.exportSave());
  writeFileSync(join(root, `${name}.json`), JSON.stringify({ tick: sim.state.tick, time: sim.state.extension!.lastUpdate, cash: cash(sim), detail }, null, 2));
}
export function exact24(sim: Simulation, name: string) {
  const saved = sim.exportSave(), parts = partitionSave(saved, sim.worldDefinition), assembled = assembleSave(parts);
  assert.equal(assembled, saved, 'all actual funding, named shifts and world refs survive partition roundtrip');
  const restored = new Simulation(sim.worldDefinition), result = restored.importSave(saved); assert.ok(result.ok, result.message); assert.equal(restored.exportSave(), saved);
  saveObservation(sim, `${name}-before`);
  for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave(), `${name}: exact full state tick ${i + 1}`); }
  saveObservation(sim, `${name}-after24`);
}
export function nativeApproval(sim: Simulation, shop: Shop) { call(sim, 'refreshWorkforce'); if (runtime(sim).privateLabor) runtime(sim).privateLabor.nextReviewAt = sim.state.extension!.lastUpdate; call(sim, 'reviewPrivateShifts'); }
export function until(sim: Simulation, predicate: () => boolean, count: number, message: string) { for (let i = 0; i < count && !predicate(); i++) sim.step(.25); if (!predicate()) saveObservation(sim, `failed-${message.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`, { activities: runtime(sim).activities, privateLabor: runtime(sim).privateLabor }); assert.ok(predicate(), message); }
