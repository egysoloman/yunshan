import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { world as governanceWorld } from './governance-fixture.ts';
import { getBuildingUsePoints, FLOOR_PLAN_PROFILE } from '../src/architecture-floor-plan.ts';
import type { Vec3 } from '../src/types.ts';
import { runtime, at } from './clinical-presence-fixture.ts';

/** This fixture declares one coherent current native city. The generic legacy
 * governance fixture retains its original recipe and saved-world evidence. */
export function coherentPublicEmploymentWorld() {
  const definition = governanceWorld();
  for (const building of definition.buildings) {
    if (building.floorPlanProfile !== FLOOR_PLAN_PROFILE) continue;
    building.stairGeometryRevision = 2;
    building.functionPoints = Array.from({ length: building.floors }, (_, floor) => getBuildingUsePoints(building, floor)).flat();
  }
  const hall = definition.buildings.find(building => building.kind === 'hall')!;
  const hallNode = definition.nodes.find(node => node.id === `${hall.id}-door`)!;
  hallNode.position = { ...hall.door };
  const outsideZ = hall.position.z + hall.depth / 2 + 1;
  const length = (points: Vec3[]) => points.slice(1).reduce((sum, point, index) => {
    const previous = points[index];
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
  }, 0);
  for (const edge of definition.edges) {
    if (edge.from !== hallNode.id && edge.to !== hallNode.id) continue;
    const from = definition.nodes.find(node => node.id === edge.from)!.position;
    const to = definition.nodes.find(node => node.id === edge.to)!.position;
    // The enlarged hall's west/east walls cannot be a walking road. Its two
    // actual road approaches meet the real doorway along the outside front.
    const neighbor = edge.from === hallNode.id ? to : from;
    const cornerX = hall.position.x + Math.sign(neighbor.x - hall.position.x) * (hall.width / 2 + 1);
    const approach = [{ ...neighbor }, { x: cornerX, y: hallNode.position.y, z: outsideZ },
      { x: hallNode.position.x, y: hallNode.position.y, z: outsideZ }, { ...hallNode.position }];
    edge.points = edge.from === hallNode.id ? approach.reverse() : approach;
    edge.length = length(edge.points);
  }
  return definition;
}

/** Declared native small-city contract regression. Only existing player prior
 * qualification and one route intent are controlled; no money, actor body,
 * needs, role appointment, native qualification or clock grants. */
export function publicEmploymentFixture() {
const sim = new Simulation(coherentPublicEmploymentWorld()), s = sim.state, hall = sim.worldDefinition.buildings.find(b => b.kind === 'hall')!;
const work = hall.functionPoints!.find(point => point.floor === 0 && point.purpose === 'work')!;
// Explicit once-only existing player qualification fixture. Election, fee,
// resident ballots, mayor mandate, native citizens and wages remain real.
Object.assign(s.player, { education: 2, experience: 4, reputation: 8 });
sim.setFocus(work.position, 'walk');
assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
const registered = sim.command({ type: 'election', targetId: hall.id });
assert.equal(registered.ok, true, registered.message);
const initialTreasury = s.treasury, initialPlayerWallet = s.player.money;
const earned: unknown[] = [], paid: unknown[] = [];
sim.onEvent('wage-earned', event => earned.push({ ...event }));
sim.onEvent('wage-paid', event => paid.push({ ...event }));
for (let i = 0; i < 32 && !sim.hasIdentity('mayor'); i++) sim.step(.25);
assert.equal(sim.hasIdentity('mayor'), true, '120-minute real election must elect this qualified fixture player');
assert.equal(s.governance!.elections.at(-1)!.result, 'elected');
const budget = sim.publicBudgetSnapshot(), cap = budget.available - budget.forecastPayroll - budget.essentialOperations;
assert.ok(cap > 0);
assert.equal(sim.authorizePublicBudget({ id: 'employment-existing-service-reserve', siteId: hall.id,
  purpose: 'protected-existing-service', cap, approvedAt: at(sim), approvedBy: ['player'] }), true);
for (let i = 0; i < 60 && !(runtime(sim).publicLabor?.shifts.length > 0); i++) sim.step(.25);
const labor = runtime(sim).publicLabor;
assert.ok(labor && labor.shifts.length > 0, 'Actual reservation must trigger finite standing-appropriation review');
assert.ok(labor.shifts.some((shift: {day:number}) => shift.day === 1));
const candidate = s.citizens.find(c => c.role === '老师' && (c.education ?? 0) >= 2
  && s.extension!.actorProfiles[c.id].alive && s.extension!.actorProfiles[c.id].age >= 18
  && !s.shops.some(shop => shop.ownerId === c.id) && !s.extension!.companies.some(company => company.ownerId === c.id)
  && runtime(sim).wageAccruals.some((claim: {citizenId:string;amount:number}) => claim.citizenId === c.id && claim.amount > 0))!;
assert.ok(candidate, 'An already-qualified native public teacher must have earned real original-site wages');
const oldWorkId = candidate.workId;
// One controlled visit intent. Position moves solely through the native route,
// time and terrain guards; no body position pins, needs resets or cash edits.
runtime(sim).activities[candidate.id] = 'social';
runtime(sim).decisionAt[candidate.id] = s.day * 1440 + s.hour * 60 + 240;
Reflect.get(sim, 'setDestination').call(sim, candidate, hall, true);
const visitStarted = { tick: s.tick, at: at(sim), position: { ...candidate.position } };
for (let i = 0; i < 60 && Math.hypot(candidate.position.x - s.player.position.x, candidate.position.y - s.player.position.y, candidate.position.z - s.player.position.z) > 24; i++) sim.step(.25);
assert.ok(Math.hypot(candidate.position.x - s.player.position.x, candidate.position.y - s.player.position.y, candidate.position.z - s.player.position.z) <= 24);
const before = { at: at(sim), tick: s.tick, treasury: s.treasury,
  guild: s.extension!.organizations.find(org => org.id === 'org-guild')!.funds,
  wallet: candidate.money, role: candidate.role, education: candidate.education,
  skills: structuredClone(candidate.skills), oldWorkId, position: { ...candidate.position },
  jobs: structuredClone(labor.jobs), originalShifts: structuredClone(labor.shifts),
  oldClaims: structuredClone(runtime(sim).wageAccruals.filter((claim: {citizenId:string}) => claim.citizenId === candidate.id)) };
const appointment = sim.command({ type: 'appoint', targetId: candidate.id, value: 1 });
assert.equal(appointment.ok, true, appointment.message);
assert.equal(s.treasury, before.treasury - 100);
assert.equal(s.extension!.organizations.find(org => org.id === 'org-guild')!.funds, before.guild + 100);
assert.equal(candidate.money, before.wallet);
assert.equal(candidate.education, before.education);
assert.deepEqual(candidate.skills, before.skills);
assert.equal(candidate.workId, hall.id);
assert.equal(candidate.role, 'council');
assert.deepEqual(labor.jobs, before.jobs, 'Original base registry must not be overwritten');
assert.deepEqual(labor.shifts, before.originalShifts, 'Appointment must not rewrite any original signed contract');
assert.deepEqual(runtime(sim).wageAccruals.filter((claim: {citizenId:string}) => claim.citizenId === candidate.id), before.oldClaims);
const afterAppointment = sim.exportSave();

// Observe the first actual review after10:00, rather than asserting approval
// four minutes before its persisted nextReviewAt=10:04 boundary.
for (let i = 0; i < 400 && !(Math.floor(at(sim) / 1440) >= 1 && s.hour > 10); i++) sim.step(.25);
assert.equal(Math.floor(at(sim) / 1440), 1, 'Normal simulated time must reach the next shift day');
const allowance = Reflect.get(sim, 'publicWorkAllowance').call(sim, candidate) as number;
const nextShift = labor.shifts.find((shift: {day:number}) => shift.day === 1);
const saved = sim.exportSave();

const restored = new Simulation(sim.worldDefinition), importResult = restored.importSave(saved);
assert.equal(importResult.ok, true, importResult.message);
assert.equal(restored.exportSave(), saved);
const bad = JSON.parse(saved); bad.runtime.publicLabor.jobs[candidate.id] = hall.id;
const originalBeforeBad = restored.exportSave(); const badImport = restored.importSave(JSON.stringify(bad));
assert.equal(badImport.ok, false, 'Naively rewriting base jobs must invalidate the actual original historical shift');
assert.equal(restored.exportSave(), originalBeforeBad);

return { sim, hall, actorId:candidate.id, before, afterAppointment, saved, earned, paid, visitStarted, initialTreasury, initialPlayerWallet };
}
