import assert from 'node:assert/strict';
import { blocksFloorPlanMovement, findFloorPlanRoute, floorPlanSupport } from '../source/src/architecture-floor-plan.ts';
import { canAccessFloor } from '../source/src/access.ts';
import { Simulation } from '../source/src/simulation.ts';
import { beginClinicalTreatment, clinicalPairAtServiceStation, clinicalServiceStationsAtPosition } from '../source/src/simulation/clinical.ts';
import { fixture } from '../source/tests/clinical-presence-fixture.ts';
import type { Building, Citizen, Role, Vec3 } from '../source/src/types.ts';
export { intervalMinutes } from './m2-window-contract.ts';

// Import only the declared nine-building World fixture. Do not call its setup,
// attachControls, pin, advance, publicCare, or any phase-pinning helper.
export const EPS = 1e-7;
export const clock = (sim: Simulation) => sim.state.extension!.lastUpdate;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
interface RuntimeView { activities: Record<string, string>; attendance: Record<string, number>; peopleElapsed?: Record<string, number> }
export const runtime = (sim: Simulation): RuntimeView => Reflect.get(sim, 'runtime') as RuntimeView;
export function nativeContext() {
  const sim = new Simulation(fixture());
  const site = sim.worldDefinition.buildings.find(building => building.id === 'pair-clinic')!;
  const point = site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'service')!;
  const doctor = sim.state.citizens.find(person => person.id === 'citizen-4')!;
  const patient = sim.state.citizens.find(person => person.id === 'citizen-1')!;
  assert.equal(doctor.role, '医生'); assert.equal(doctor.workId, site.id);
  assert.ok(sim.state.extension!.actorProfiles[doctor.id].alive);
  assert.ok(sim.state.extension!.actorProfiles[doctor.id].age >= 18);
  assert.ok(sim.state.extension!.actorProfiles[doctor.id].health >= 45);
  assert.ok(sim.state.extension!.actorProfiles[patient.id].health > 0 && sim.state.extension!.actorProfiles[patient.id].health < 100);
  assert.notEqual(patient.id, doctor.id);
  assert.ok(doctor.needs.hunger >= 40 && doctor.needs.fatigue >= 35);
  assert.ok(patient.needs.hunger >= 35 && patient.needs.fatigue >= 25);
  assert.equal(sim.state.player.money, 600);
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true);
  sim.setFocus(point.position, 'walk');
  return { sim, site, point, doctor, patient };
}
function identity(person: Citizen): { role: Role; identities: Role[] } {
  const role: Role = ['traveler', 'police', 'soldier', 'teacher', 'driver', 'merchant', 'mayor', 'scientist', 'official', 'council'].includes(person.role) ? person.role as Role : 'traveler';
  return { role, identities: [role] };
}
export function assertPhysicalPoint(site: Building, point: Vec3, person: Citizen): void {
  const support = floorPlanSupport(site, 0, point, .35);
  assert.ok(support && support.floor === 0 && support.kind === 'room', 'fixture must retain the true .35m standing disk');
  assert.ok(Math.abs(support.y - point.y) < EPS);
  assert.equal(blocksFloorPlanMovement(site, 0, point, point, .35, 1.72), false, 'the full body must be clear');
  assert.equal(canAccessFloor(site, 0, identity(person)), true);
}
export function initialIntent(sim: Simulation, person: Citizen, site: Building, point: Vec3, activity: 'work' | 'heal'): void {
  assertPhysicalPoint(site, point, person);
  // One controlled initial position/intent for the measured leg, never a hook.
  // Preserve native role, employer, tier, age, health, needs, money and wages.
  person.position = { ...point };
  runtime(sim).activities[person.id] = activity;
  const setDestination = Reflect.get(sim, 'setDestination') as (person: Citizen, site: Building, rebuild?: boolean) => void;
  setDestination.call(sim, person, site, true);
  assert.notEqual(person.state, 'unreachable', 'the unmodified real route constructor must accept the leg');
  assert.equal(person.destinationId, site.id);
}
export function remainingRouteMeters(person: Citizen): number {
  let total = 0, previous = person.position;
  for (const next of (person.route ?? []).slice(person.routeIndex ?? 0)) { total += distance(previous, next); previous = next; }
  return total;
}
export function lateStart(site: Building): Vec3 { return { x: site.position.x, y: site.position.y + .6, z: site.position.z + 12.6 }; }
export function assertActualLateRoute(sim: Simulation, person: Citizen, site: Building, station: Vec3): number {
  const independentlyDerived = findFloorPlanRoute(site, 0, person.position, station, .35);
  assert.ok(independentlyDerived, 'actual provider must produce the same-floor physical route');
  assert.equal(blocksFloorPlanMovement(site, 0, person.position, station, .35, 1.72), false);
  const meters = remainingRouteMeters(person), speed = sim.state.weather === '雨' ? 3.1 : 4.2;
  assert.ok(meters > 0 && meters < 4 * speed, 'fixture must genuinely arrive during this four-minute phase');
  assert.ok(4 - meters / speed < 4 - EPS, 'genuine travel must consume a positive interval');
  return meters;
}
export function beginNativeNpcOrder(context: ReturnType<typeof nativeContext>) {
  const { sim, site, point, patient } = context;
  initialIntent(sim, patient, site, point.position, 'heal');
  const cashBefore = sim.state.player.money;
  const result = beginClinicalTreatment(sim, { patientId: patient.id, payerId: 'player', siteId: site.id });
  assert.equal(result.ok, true, result.message);
  assert.equal(sim.state.player.money, cashBefore - 30, 'the normal entry must actually escrow the existing fee');
  const order = sim.state.clinical!.orders.at(-1)!;
  assert.equal(order.workedMinutes, 0); assert.equal(order.reservedUnits, 0);
  return order;
}
export function assertSupplied(order: ReturnType<typeof beginNativeNpcOrder>): void {
  assert.equal(order.workedMinutes, 0, 'finance procures after people; bootstrap must not borrow supply from the future');
  assert.equal(order.receivedUnits, 1); assert.equal(order.reservedUnits, 1);
  assert.equal(order.consumedUnits, 0); assert.equal(order.receipts.length, 1);
  assert.ok(order.purchasePaid > 0 && order.escrow > 0);
}
export function assertActualPair(context: ReturnType<typeof nativeContext>): void {
  const { sim, site, point, doctor, patient } = context;
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, patient.id), true);
  assert.ok(clinicalServiceStationsAtPosition(site, doctor.position, identity(doctor), sim.state.voxels).some(p => p.id === point.id));
  assert.ok(clinicalServiceStationsAtPosition(site, patient.position, identity(patient), sim.state.voxels).some(p => p.id === point.id));
  // An unexpected extra onsite doctor would invalidate this causal fixture;
  // do not pin, remove, re-role, or disable other native residents.
  const extra = sim.state.citizens.filter(p => p.id !== doctor.id && p.workId === site.id && ['医生', 'doctor'].includes(p.role) && sim.isOnDuty(p.id, site.id));
  assert.equal(extra.length, 0, 'this measured interval must have one real onsite doctor');
}
export function captureWages(sim: Simulation, actorId: string) {
  const observed: { tick: number; clock: number; citizenId?: string; siteId?: string; minutes?: number; amount?: number; start?: number; end?: number }[] = [];
  sim.onEvent('wage-earned', event => { if (event.citizenId === actorId) observed.push({ tick: sim.state.tick, clock: clock(sim), citizenId: event.citizenId, siteId: event.siteId, minutes: event.minutes, amount: event.amount, start: event.creditedWorkStartAt, end: event.creditedWorkEndAt }); });
  return observed;
}
export function currentWageWindow(rows: ReturnType<typeof captureWages>, sim: Simulation, site: Building) {
  const row = rows.find(row => row.tick === sim.state.tick);
  assert.ok(row, 'the original people phase must emit genuine credited work');
  assert.equal(row.siteId, site.id);
  assert.ok(Number.isFinite(row.minutes) && row.minutes! > 0);
  assert.ok(Number.isFinite(row.amount) && row.amount! >= 0);
  assert.ok(Number.isFinite(row.start) && Number.isFinite(row.end));
  assert.ok(row.end! <= clock(sim) + EPS && row.start! <= row.end!);
  assert.ok(Math.abs(row.end! - row.start! - row.minutes!) < EPS);
  return { start: row.start!, end: row.end!, minutes: row.minutes! };
}
export function trace(label: string, record: unknown): void { console.log(JSON.stringify({ label, status: 'ACTUAL_ONLY_IF_THIS_DRIVER_EXECUTED', record })); }
