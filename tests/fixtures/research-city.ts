import assert from 'node:assert/strict';
import { Simulation } from '../../src/simulation';
import { blocksFloorPlanMovement, floorPlanSupport, getBuildingEntrance, getBuildingUsePoints } from '../../src/architecture-floor-plan';
import type { Building, Citizen, CityExtensionState, Command, ResearchJob, Vec3, WorldDefinition } from '../../src/types';

/** A controlled small World, not a natural/default-city audit. NPC count and the
 * ten phases remain the real Simulation's. No renderer or generated city needed. */
export function researchWorld(): WorldDefinition {
  const kinds: Building['kind'][] = ['home', 'school', 'market', 'clinic', 'station', 'pavilion', 'workshop'];
  const buildings = kinds.map((kind, index): Building => {
    const b: Building = { id: `research-${kind}`, districtId: 'research-town', name: kind, kind, position: { x: index * 120, y: 0, z: 0 }, width: 40, depth: 32, height: 12, floors: 3, rotation: 0, door: { x: index * 120, y: .6, z: 16 }, capacity: 50, seed: index + 7, floorPlanProfile: 'v4-program-bodies-02' };
    if (kind === 'school') b.facility = 'data';
    b.door = getBuildingEntrance(b);
    b.functionPoints = Array.from({ length: b.floors }, (_, floor) => getBuildingUsePoints(b, floor)).flat();
    return b;
  });
  const nodes = buildings.flatMap(b => [{ id: `${b.id}-door`, name: b.name, districtId: b.districtId, position: { ...b.door }, station: false }, { id: `${b.id}-street`, name: b.name, districtId: b.districtId, position: { x: b.position.x, y: .6, z: 35 }, station: b.kind === 'station' }]);
  const edges: WorldDefinition['edges'] = buildings.map((b, i) => ({ id: `door-${b.id}`, from: nodes[i * 2].id, to: nodes[i * 2 + 1].id, mode: 'road', capacity: 20, length: Math.hypot(nodes[i * 2].position.x - nodes[i * 2 + 1].position.x, nodes[i * 2].position.y - nodes[i * 2 + 1].position.y, nodes[i * 2].position.z - nodes[i * 2 + 1].position.z), points: [{ ...nodes[i * 2].position }, { ...nodes[i * 2 + 1].position }] }));
  for (let i = 1; i < buildings.length; i++) edges.push({ id: `street-${i}`, from: nodes[i * 2 - 1].id, to: nodes[i * 2 + 1].id, mode: 'road', capacity: 20, length: 120, points: [{ ...nodes[i * 2 - 1].position }, { ...nodes[i * 2 + 1].position }] });
  return { seed: 911, voxelSize: .2, size: 4000, districts: [{ id: 'research-town', name: '科研受控小城', kind: 'market', center: { x: 360, y: 0, z: 0 }, radius: 1200, color: '#888888', population: 384 }], buildings, nodes, edges, mountains: [], spawn: { ...nodes[1].position }, waterfall: { top: { x: 1800, y: 100, z: 1800 }, bottom: { x: 1800, y: 0, z: 1800 }, width: 10 }, river: [{ x: 1800, y: 0, z: 1800 }, { x: 1800, y: 0, z: 1900 }] };
}
export type ResearchExtension = CityExtensionState & { runtime: { researchLaborVersion?: 1; legacyResearchSectors?: string[]; researchJobs: Record<string, ResearchJob | undefined>; cooldowns: Record<string, number>; lastTreasury: number } };
export interface CoreFixtureRuntime {
  activities: Record<string, string>; decisionAt: Record<string, number>; attendance: Record<string, number>; peopleElapsed?: Record<string, number>;
  wageAccruals: { citizenId: string; shopId: string | null; workId: string; districtId: string; minutes: number; ratePerMinute: number; amount: number }[];
}
export function extension(sim: Simulation): ResearchExtension { return sim.state.extension as ResearchExtension; }
export function core(sim: Simulation): CoreFixtureRuntime { return Reflect.get(sim, 'runtime') as CoreFixtureRuntime; }
export function ok(sim: Simulation, command: Command) { const result = sim.command(command); assert(result.ok, `${command.type}: ${result.message}`); return result; }
export function workPoint(lab: Building, floor = 0): Vec3 {
  const point = lab.functionPoints!.find(p => p.floor === floor && p.purpose === 'work' && (() => {
    const support = floorPlanSupport(lab, floor, p.position, .35);
    return !!support && support.floor === floor && support.kind === 'room' && Math.abs(support.y - p.position.y) < 1e-7 && !blocksFloorPlanMovement(lab, floor, p.position, p.position, .35, 1.72);
  })());
  assert(point, 'the fixture must provide an actual .35-supported, clear work point'); return { ...point.position };
}
export function createResearchCity() {
  const world = researchWorld(), lab = world.buildings.find(b => b.kind === 'school')!, sim = new Simulation(world), point = workPoint(lab);
  // Controlled eligibility setup. This does not establish ordinary native travel
  // or fund a natural default-city researcher.
  sim.state.player.role = 'scientist'; sim.state.player.identities = ['traveler', 'scientist']; sim.state.player.education = 3;
  sim.state.player.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  sim.setFocus(point, 'walk'); ok(sim, { type: 'speed', value: 16 });
  return { world, lab, sim, point };
}
export function ticks(sim: Simulation, count: number) { for (let i = 0; i < count; i++) sim.step(.25); }
export function pending(sim: Simulation, sector = 'medicine') { const job = extension(sim).runtime.researchJobs[sector]; assert(job, 'research must still be pending'); return job; }
export function marked(sim: Simulation, sector = 'medicine') { const job = pending(sim, sector); assert.equal(job.laborVersion, 1); assert(job.laborVersion === 1); return job; }
export function fundedNpc(sim: Simulation, lab: Building, point: Vec3) {
  const actor = sim.state.citizens.find(c => c.workId === lab.id && ['科研员', 'scientist', '科学家'].includes(c.role) && (c.education ?? 0) >= 3 && extension(sim).actorProfiles[c.id].skill >= 35 && c.money >= 300);
  assert(actor, 'an existing generated adult qualified lab employee must fund the fixture');
  actor.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
  const pin = (city: Simulation, person: Citizen) => {
    person.position = { ...point }; person.destinationId = lab.id; person.route = [{ ...point }]; person.routeIndex = 1;
    core(city).activities[person.id] = 'work'; core(city).decisionAt[person.id] = 1e9;
  };
  sim.setFocus(point, 'drone');
  pin(sim, actor); sim.onPhase('traffic', () => pin(sim, actor));
  const startCash = actor.money;
  for (let count = 0; count < 16 && !Object.values(extension(sim).runtime.researchJobs).some(job => job?.actorId === actor.id); count++) sim.step(.25);
  const entry = Object.entries(extension(sim).runtime.researchJobs).find(([, job]) => job?.actorId === actor.id); assert(entry?.[1]);
  assert.equal(actor.money, startCash - 200, 'investment is the NPC’s own 200 cash');
  assert.equal(extension(sim).publicLedger.filter(row => row.actorId === actor.id && row.purpose.includes('居民科研投入')).length, 1);
  assert.equal(entry[1].laborVersion, 1); assert(entry[1].laborVersion === 1);
  return { actor, sector: entry[0], job: entry[1], pin };
}
