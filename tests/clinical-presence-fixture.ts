import assert from 'node:assert/strict';
import { getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import { Simulation } from '../src/simulation.ts';
import { beginClinicalTreatment } from '../src/simulation/clinical.ts';
import type { Building, BuildingKind, Citizen, Vec3, WorldDefinition } from '../src/types.ts';

// Controlled positions isolate treatment pairing. These are not evidence of
// default commuting, normal input, or autonomous patient coverage.
export function fixture(marked = true, dualStations = false): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank', 'hall', 'station'];
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `pair-${kind}`, name: `配对测试${kind}`, kind, districtId: 'pair-district', position: { x: index * 60, y: 0, z: 0 }, door: { x: index * 60, y: .6, z: kind === 'clinic' ? 19 : 6 }, width: kind === 'clinic' ? 50 : 12, depth: kind === 'clinic' ? 38 : 12, height: kind === 'clinic' ? 11.4 : 12, floors: kind === 'clinic' ? 3 : 2, rotation: 0, capacity: 100, seed: index }));
  const site = buildings.find(site => site.kind === 'clinic')!;
  if (marked) {
    site.floorPlanProfile = 'v4-program-bodies-02'; site.functionPoints = Array.from({ length: site.floors }, (_, floor) => getBuildingUsePoints(site, floor)).flat();
    if (dualStations) site.functionPoints = [...site.functionPoints.filter(point => point.floor !== 0), ...[-4, 4].flatMap(x => (['work', 'service'] as const).map(purpose => ({ id: `0:fixture-${x}:${purpose}`, purpose, floor: 0, position: { x: site.position.x + x, y: .6, z: 0 } })))];
  }
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, name: site.name, districtId: site.districtId, position: { ...site.door }, station: true }));
  return { seed: 20261001, voxelSize: .2, size: 2000, buildings, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `pair-road-${index}`, mode: 'road', from: nodes[index].id, to: node.id, length: Math.hypot(node.position.x - nodes[index].position.x, node.position.y - nodes[index].position.y, node.position.z - nodes[index].position.z), capacity: 20, points: [nodes[index].position, node.position] })), mountains: [], river: [], waterfall: { top: { x: 1000, y: 60, z: 100 }, bottom: { x: 1000, y: 0, z: 100 }, width: 10 }, districts: [{ id: 'pair-district', name: '配对测试街坊', kind: 'school', center: { x: 400, y: 0, z: 0 }, radius: 1000, color: '#aac', population: 384 }], spawn: { ...buildings[0].door } };
}
export const runtime = (sim: Simulation) => Reflect.get(sim, 'runtime');
export const at = (sim: Simulation) => sim.state.extension!.lastUpdate;
export const station = (site: Building, floor: number) => site.floorPlanProfile
  ? (site.functionPoints ?? getBuildingUsePoints(site, floor)).find(point => point.floor === floor && point.purpose === 'service')!.position
  : { x: site.position.x, y: site.position.y + .6 + floor * site.height / site.floors, z: site.position.z + 1.2 };
type Pin = { siteId: string; position: Vec3; activity: 'work' | 'social' };
export type Controls = Map<string, Pin>;
export function attachControls(sim: Simulation, controls: Controls): void {
  const originalDestination = Reflect.get(sim, 'setDestination');
  // Keep this controlled fixture at its explicitly declared real station.
  // This only isolates pairing from route choice; core physical guards, finite
  // employment allowance and actual registerAttendance still execute normally.
  // The generated-world routing tests do not install these controls.
  Reflect.set(sim, 'setDestination', (person: Citizen, destination: Building, rebuild = false) => {
    const pin = controls.get(person.id);
    if (pin?.siteId === destination.id) { person.destinationId = destination.id; person.route = [{ ...pin.position }]; person.routeIndex = 1; return; }
    return originalDestination.call(sim, person, destination, rebuild);
  });
  sim.onPhase('traffic', () => {
    for (const [id, pin] of controls) {
      const person = sim.state.citizens.find(person => person.id === id)!;
      person.position = { ...pin.position }; person.destinationId = pin.siteId; person.route = [{ ...pin.position }]; person.routeIndex = 1;
      person.needs = { hunger: 100, fatigue: 100, social: 100, fun: 100 };
      runtime(sim).activities[id] = pin.activity; runtime(sim).decisionAt[id] = sim.state.day * 1440 + sim.state.hour * 60 + 10;
    }
  });
}
export function pin(sim: Simulation, controls: Controls, id: string, site: Building, position: Vec3, activity: Pin['activity'] = 'social'): void {
  controls.set(id, { siteId: site.id, position: { ...position }, activity });
  const person = sim.state.citizens.find(person => person.id === id)!;
  person.position = { ...position }; person.destinationId = site.id; person.route = [{ ...position }]; person.routeIndex = 1;
  runtime(sim).activities[id] = activity; runtime(sim).decisionAt[id] = sim.state.day * 1440 + sim.state.hour * 60 + 10;
}
export function advance(sim: Simulation, minutes: number): void {
  const deadline = at(sim) + minutes;
  for (let i = 0; at(sim) < deadline - 1e-7 && i < 10000; i++) sim.step(.25);
  assert.ok(at(sim) >= deadline - 1e-7);
}
export function setup(doctorFloor = 0, marked = true, dualStations = false) {
  const sim = new Simulation(fixture(marked, dualStations)), controls: Controls = new Map();
  assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
  const site = sim.worldDefinition.buildings.find(site => site.kind === 'clinic')!;
  const doctor = sim.state.citizens.find(person => person.workId === site.id && person.role === '医生' && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  assert.ok(doctor, 'the world constructor must supply a real employed adult doctor');
  const doctorDistance = sim.buildingTravelDistance(doctor.homeId, site.id), hall = sim.worldDefinition.buildings.find(site => site.kind === 'hall')!;
  const officials = sim.state.citizens.filter(person => person.role === '官员' && person.workId === hall.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  assert.ok(doctorDistance <= 500); assert.equal(officials.length, 2);
  const reviewerDistances = officials.map(person => ({ id: person.id, homeId: person.homeId, roadDistance: sim.buildingTravelDistance(person.homeId, hall.id) }));
  assert.ok(reviewerDistances.every(person => person.roadDistance <= 500));
  console.log('M1 fixture real-native-work precondition', JSON.stringify({ doctor: { id: doctor.id, homeId: doctor.homeId, workId: doctor.workId, role: doctor.role, roadDistance: doctorDistance }, reviewers: reviewerDistances, initialPlayerMoney: sim.state.player.money }));
  // Hold non-participating residents at real home entrances so extra doctors or
  // accidental patients do not obscure the one-doctor capacity boundary.
  for (const person of sim.state.citizens) {
    const home = sim.worldDefinition.buildings.find(site => site.id === person.homeId)!;
    pin(sim, controls, person.id, home, home.door);
  }
  pin(sim, controls, doctor.id, site, station(site, doctorFloor), 'work'); attachControls(sim, controls);
  sim.setFocus(station(site, 0), 'walk'); sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  sim.state.extension!.actorProfiles.player.health = 50;
  advance(sim, 4); assert.equal(sim.isOnDuty(doctor.id, site.id), true, 'actual people-phase attendance must establish funded duty');
  return { sim, controls, site, doctor };
}
export function begin(sim: Simulation, site: Building, patientId = 'player') {
  const result = beginClinicalTreatment(sim, { patientId, payerId: 'player', siteId: site.id }); assert.equal(result.ok, true, result.message);
  return sim.state.clinical!.orders.at(-1)!;
}
export function restore24(sim: Simulation, controls: Controls): void {
  const next = new Simulation(sim.worldDefinition), saved = sim.exportSave(), result = next.importSave(saved);
  assert.equal(result.ok, true, result.message); assert.equal(next.exportSave(), saved);
  attachControls(next, controls);
  for (let tick = 0; tick < 24; tick++) { sim.step(.25); next.step(.25); assert.equal(next.exportSave(), sim.exportSave(), `exact continuation tick ${tick + 1}`); }
}
export function cash(sim: Simulation): number {
  const s = sim.state, e = s.extension!;
  return s.treasury + runtime(sim).taxes + s.player.money + s.banking!.cash + s.banking!.legacyInvestmentCash +
    s.citizens.reduce((sum, person) => sum + person.money, 0) +
    s.shops.filter(shop => !e.companies.some(company => company.buildingId === shop.buildingId)).reduce((sum, shop) => sum + (shop.cash ?? 0), 0) +
    e.companies.reduce((sum, company) => sum + company.capital, 0) + e.organizations.reduce((sum, organization) => sum + organization.funds, 0) +
    s.family!.pregnancies.reduce((sum, pregnancy) => sum + pregnancy.escrow, 0) +
    s.family!.households.reduce((sum, account) => sum + account.balance, 0) +
    (s.playerLabor?.job?.escrow ?? 0) + s.clinical!.orders.reduce((sum, order) => sum + order.escrow, 0);
}
export function publicCare(context: ReturnType<typeof setup>) {
  const { sim, controls, site, doctor } = context, hall = sim.worldDefinition.buildings.find(building => building.kind === 'hall')!;
  sim.setFocus(hall.door, 'walk');
  const filed = sim.command({ type: 'filePetition', targetId: 'health', title: '真实同站诊疗', text: '居民请求在实际诊所安排材料有限、医生实际在岗并共同到达诊疗站的公共服务。' });
  assert.equal(filed.ok, true, filed.message);
  const petition = sim.state.culture!.petitions.at(-1)!;
  const signers = sim.state.citizens.filter(person => person.id !== doctor.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 3);
  for (const person of signers) pin(sim, controls, person.id, hall, { x: hall.position.x, y: .6, z: 1.2 });
  advance(sim, 4); assert.ok(petition.signerIds.length >= 3);
  const officials = sim.state.citizens.filter(person => person.role === '官员' && person.workId === hall.id && sim.state.extension!.actorProfiles[person.id].age >= 18).slice(0, 2);
  assert.equal(officials.length, 2);
  for (const person of officials) pin(sim, controls, person.id, hall, { x: hall.position.x, y: .6, z: 1.2 }, 'work');
  // Controlled saved deadline, as in the existing public/paid shared-capacity
  // test. This is not a natural next-day or government-election validation.
  const delta = petition.replyAt - 2 - at(sim);
  sim.state.extension!.lastUpdate += delta; sim.state.family!.lastUpdate += delta; sim.state.culture!.lastUpdate += delta;
  advance(sim, 2);
  const order = sim.state.culture!.orders.find(order => order.id === petition.executionId)!;
  assert.ok(order);
  for (let i = 0; i < 6 && order.state !== 'active'; i++) advance(sim, 2);
  assert.equal(order.state, 'active', order.lastReason); assert.equal(order.approvedBy.length, 2); assert.ok(order.receivedUnits >= 2);
  sim.setFocus(station(site, 0), 'walk');
  return order;
}
