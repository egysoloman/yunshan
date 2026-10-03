import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessFloor } from '../src/access.ts';
import { floorPlanSupport, getBuildingUsePoints } from '../src/architecture-floor-plan.ts';
import { Simulation } from '../src/simulation.ts';
import { clinicalAtSite, clinicalPairAtServiceStation, clinicalServiceStationsAtPosition, takeClinicalDoctorSlot } from '../src/simulation/clinical.ts';
import { homeRestPointBlockedByVoxels } from '../src/simulation/home-rest.ts';
import { createWorld } from '../src/world.ts';
import type { Building } from '../src/types.ts';
import { advance, begin, fixture, pin, restore24, runtime, setup, station } from './clinical-presence-fixture.ts';

test('same-floor distinct real stations do not pair or spend a doctor slot; two-metre station admission stays intact', () => {
  const { sim, controls, site, doctor } = setup(0, true, true);
  const west = station(site, 0), east = site.functionPoints!.find(point => point.id === '0:fixture-4:service')!.position;
  sim.setFocus(east, 'walk'); assert.equal(clinicalAtSite(sim, site, doctor.id), true); assert.equal(clinicalAtSite(sim, site), true);
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, 'player'), false);
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, 'player') && takeClinicalDoctorSlot(sim, doctor.id, 'player'), false);
  pin(sim, controls, doctor.id, site, { ...west, x: west.x - 1.8 }, 'work'); sim.setFocus({ ...west, x: west.x + 1.8 }, 'walk');
  assert.ok(Math.hypot(doctor.position.x - sim.state.player.position.x, doctor.position.z - sim.state.player.position.z) > 2, 'the new rule must not invent a doctor-patient two-metre limit');
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, 'player'), true);
  assert.equal(takeClinicalDoctorSlot(sim, doctor.id, 'player'), true);
  const patient = sim.state.citizens.find(person => person.id !== doctor.id)!; pin(sim, controls, patient.id, site, west);
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, patient.id), true); assert.equal(takeClinicalDoctorSlot(sim, doctor.id, patient.id), true);
  assert.equal(takeClinicalDoctorSlot(sim, doctor.id, sim.state.citizens.find(person => person.id !== doctor.id && person.id !== patient.id)!.id), false);
});

test('marked station pairing requires public ACL and an actual supported .35m body', () => {
  const { sim, site, doctor } = setup(0), good = { ...sim.state.player.position };
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, 'player'), true);
  for (const position of [{ ...good, y: good.y + 1 }, { ...good, x: site.position.x + site.width }, station(site, 1)]) {
    sim.setFocus(position, 'walk'); assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, 'player'), false);
  }
  sim.setFocus(good, 'walk');
  const restricted: Building = { ...site, publicFloors: 0, floorPermissions: ['official', 'public', 'public'] };
  assert.equal(clinicalPairAtServiceStation(sim, restricted, doctor.id, 'player'), false);
  assert.equal(clinicalPairAtServiceStation(sim, site, doctor.id, doctor.id), false);
  assert.equal(clinicalPairAtServiceStation(sim, site, 'absent', 'player'), false);
});

test('moving from a legitimate station preserves already earned partial treatment and exact save/24-tick continuation', () => {
  const { sim, controls, site, doctor } = setup(0), order = begin(sim, site);
  advance(sim, 8); assert.equal(order.workedMinutes, 6); const paid = order.purchasePaid, minutes = order.workedMinutes, staffMinutes = order.staffMinutes[doctor.id];
  pin(sim, controls, doctor.id, site, station(site, 1), 'work'); advance(sim, 6);
  assert.equal(order.workedMinutes, minutes); assert.equal(order.staffMinutes[doctor.id], staffMinutes); assert.equal(order.purchasePaid, paid); assert.equal(order.consumedUnits, 0);
  restore24(sim, controls); assert.equal(order.workedMinutes, minutes);
  pin(sim, controls, doctor.id, site, station(site, 0), 'work'); advance(sim, 14);
  assert.equal(order.workedMinutes, 20); assert.equal(order.consumedUnits, 1); assert.equal(order.state, 'completed'); assert.equal(order.purchasePaid + order.serviceFee, 30);
});

const fnv = (text: string) => { let value = 2166136261; for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619); return value >>> 0; };
const routingWorld = createWorld(20261001, 'current-v4');
function nativeDoctor() {
  const sim = new Simulation(routingWorld);
  const doctor = sim.state.citizens.find(person => {
    const site = routingWorld.buildings.find(site => site.id === person.workId);
    return site?.kind === 'clinic' && site.floorPlanProfile && person.role === '医生' && sim.state.extension!.actorProfiles[person.id].age >= 18 && fnv(`${person.id}:${site.id}`) % site.floors !== 0;
  });
  assert.ok(doctor, 'select a real adult doctor whose old hashed work-point order started upstairs');
  const site = routingWorld.buildings.find(site => site.id === doctor.workId)!;
  doctor.position = { ...site.door }; doctor.destinationId = null; doctor.route = []; doctor.routeIndex = 0; runtime(sim).activities[doctor.id] = 'work';
  return { sim, doctor, site };
}

test('default generated clinic has physically supported co-located points and only real doctors prefer its ground station', () => {
  const { sim, doctor, site } = nativeDoctor(), visitor = { role: 'traveler' as const, identities: ['traveler' as const] };
  const ground = site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'service')!;
  assert.ok(canAccessFloor(site, 0, visitor)); assert.equal(floorPlanSupport(site, 0, ground.position, .35)?.floor, 0);
  assert.ok(getBuildingUsePoints(site, 0).some(point => point.purpose === 'work' && Math.hypot(point.position.x - ground.position.x, point.position.y - ground.position.y, point.position.z - ground.position.z) < 1e-8));
  Reflect.get(sim, 'setDestination').call(sim, doctor, site, true);
  assert.ok(doctor.route!.length > 1); assert.deepEqual(doctor.route!.at(-1), ground.position);
  assert.equal(runtime(sim).attendance[doctor.id] ?? 0, 0, 'planning creates neither attendance nor a wage');
  doctor.role = '档案员'; doctor.position = { ...site.door }; doctor.destinationId = null;
  Reflect.get(sim, 'setDestination').call(sim, doctor, site, true);
  const oldFloor = fnv(`${doctor.id}:${site.id}`) % site.floors;
  assert.deepEqual(doctor.route!.at(-1), site.functionPoints!.find(point => point.floor === oldFloor && point.purpose === 'work')!.position, 'other clinic staff retain their original point order');
});

test('a failed preferred interior route still tries the original legal upper-floor fallback', () => {
  const { sim, doctor, site } = nativeDoctor(), calls: number[] = [], original = Reflect.get(sim, 'floorPlanRoute');
  // Route fault injection proves fallback control flow. This is not a claim
  // that default ground routes fail or a physical obstacle reproduction.
  Reflect.set(sim, 'floorPlanRoute', (building: Building, from: number, to: number, start: unknown, end: unknown) => {
    calls.push(to); return to === 0 ? null : original.call(sim, building, from, to, start, end);
  });
  Reflect.get(sim, 'setDestination').call(sim, doctor, site, true);
  assert.equal(calls[0], 0); assert.ok(calls.some(floor => floor > 0));
  const oldFloor = fnv(`${doctor.id}:${site.id}`) % site.floors;
  assert.deepEqual(doctor.route!.at(-1), site.functionPoints!.find(point => point.floor === oldFloor && point.purpose === 'work')!.position);
  assert.equal(runtime(sim).attendance[doctor.id] ?? 0, 0);
});

test('no declared ground service station keeps the original legal work-point selection', () => {
  const world = fixture(), site = world.buildings.find(site => site.kind === 'clinic')!;
  site.functionPoints = site.functionPoints!.filter(point => point.floor !== 0 || point.purpose !== 'service');
  const sim = new Simulation(world), doctor = sim.state.citizens.find(person => person.role === '医生' && person.workId === site.id && sim.state.extension!.actorProfiles[person.id].age >= 18 && fnv(`${person.id}:${site.id}`) % site.floors !== 0)!;
  assert.ok(doctor); doctor.position = { ...site.door }; runtime(sim).activities[doctor.id] = 'work';
  Reflect.get(sim, 'setDestination').call(sim, doctor, site, true);
  const oldFloor = fnv(`${doctor.id}:${site.id}`) % site.floors;
  assert.deepEqual(doctor.route!.at(-1), site.functionPoints!.find(point => point.floor === oldFloor && point.purpose === 'work')!.position);
});

test('a real default upper-floor doctor keeps the old legal target when a saved placed cube blocks ground', () => {
  const context = nativeDoctor(), { sim, site } = context, doctorId = context.doctor.id;
  const ground = site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'service')!.position;
  const data = JSON.parse(sim.exportSave()), blocks = data.state.player.inventory.block;
  assert.ok(blocks >= 1);
  data.state.voxels.push({ id: `voxel-${++data.runtime.constructionId}`, position: { x: Math.round(ground.x / .2) * .2, y: Math.round((ground.y + .8) / .2) * .2, z: Math.round(ground.z / .2) * .2 }, color: '#8fcdc9' });
  data.state.player.inventory.block--; const loaded = sim.importSave(JSON.stringify(data)); assert.equal(loaded.ok, true, loaded.message);
  assert.equal(homeRestPointBlockedByVoxels(ground, sim.state.voxels), true);
  const doctor = sim.state.citizens.find(person => person.id === doctorId)!;
  Reflect.get(sim, 'setDestination').call(sim, doctor, site, true);
  const oldFloor = fnv(`${doctor.id}:${site.id}`) % site.floors;
  assert.ok(oldFloor > 0); assert.deepEqual(doctor.route!.at(-1), site.functionPoints!.find(point => point.floor === oldFloor && point.purpose === 'work')!.position);
  assert.equal(sim.state.player.inventory.block, blocks - 1); assert.equal(runtime(sim).attendance[doctor.id] ?? 0, 0);
  const next = new Simulation(routingWorld), saved = sim.exportSave(), restored = next.importSave(saved);
  assert.equal(restored.ok, true, restored.message); assert.equal(next.exportSave(), saved);
});

test('a ground route selected earlier is replanned without rebuild when a saved placed cube blocks its station', () => {
  const context = nativeDoctor(), { sim, site } = context, doctorId = context.doctor.id;
  const ground = site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'service')!.position;
  Reflect.get(sim, 'setDestination').call(sim, context.doctor, site, true); assert.deepEqual(context.doctor.route!.at(-1), ground);
  const data = JSON.parse(sim.exportSave()); assert.ok(data.state.player.inventory.block >= 1);
  data.state.voxels.push({ id: `voxel-${++data.runtime.constructionId}`, position: { x: Math.round(ground.x / .2) * .2, y: Math.round((ground.y + .8) / .2) * .2, z: Math.round(ground.z / .2) * .2 }, color: '#8fcdc9' }); data.state.player.inventory.block--;
  const loaded = sim.importSave(JSON.stringify(data)); assert.equal(loaded.ok, true, loaded.message);
  const doctor = sim.state.citizens.find(person => person.id === doctorId)!;
  assert.deepEqual(doctor.route!.at(-1), ground);
  Reflect.get(sim, 'setDestination').call(sim, doctor, site, false);
  const oldFloor = fnv(`${doctor.id}:${site.id}`) % site.floors;
  assert.ok(oldFloor > 0); assert.deepEqual(doctor.route!.at(-1), site.functionPoints!.find(point => point.floor === oldFloor && point.purpose === 'work')!.position);
  assert.equal(runtime(sim).attendance[doctor.id] ?? 0, 0);
});

test('a clear work body within two metres does not prefer an obstructed or unsupported service centre', () => {
  for (const mode of ['placed-cube', 'unsupported-point'] as const) {
    const world = fixture(), site = world.buildings.find(site => site.kind === 'clinic')!;
    const work = site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'work')!, service = site.functionPoints!.find(point => point.floor === 0 && point.purpose === 'service')!;
    work.position = { ...work.position, x: work.position.x + 1.5 };
    if (mode === 'unsupported-point') service.position = { ...service.position, y: service.position.y + .9 };
    const sim = new Simulation(world), doctor = sim.state.citizens.find(person => person.role === '医生' && person.workId === site.id && sim.state.extension!.actorProfiles[person.id].age >= 18 && fnv(`${person.id}:${site.id}`) % site.floors !== 0)!;
    assert.ok(doctor); doctor.position = { ...site.door }; runtime(sim).activities[doctor.id] = 'work';
    if (mode === 'placed-cube') {
      const data = JSON.parse(sim.exportSave()); assert.ok(data.state.player.inventory.block >= 1);
      data.state.voxels.push({ id: `voxel-${++data.runtime.constructionId}`, position: { ...service.position, y: service.position.y + .8 }, color: '#8fcdc9' }); data.state.player.inventory.block--;
      const loaded = sim.importSave(JSON.stringify(data)); assert.equal(loaded.ok, true, loaded.message);
      assert.equal(homeRestPointBlockedByVoxels(service.position, sim.state.voxels), true);
    } else assert.equal(floorPlanSupport(site, 0, service.position, .35), null);
    assert.equal(homeRestPointBlockedByVoxels(work.position, sim.state.voxels), false);
    assert.ok(Math.hypot(service.position.x - work.position.x, service.position.y - work.position.y, service.position.z - work.position.z) <= 2);
    assert.equal(clinicalServiceStationsAtPosition(site, work.position, { role: 'traveler' }, sim.state.voxels).length, 0);
    const current = sim.state.citizens.find(person => person.id === doctor.id)!;
    Reflect.get(sim, 'setDestination').call(sim, current, site, true);
    const oldFloor = fnv(`${current.id}:${site.id}`) % site.floors;
    assert.deepEqual(current.route!.at(-1), site.functionPoints!.find(point => point.floor === oldFloor && point.purpose === 'work')!.position);
    assert.equal(runtime(sim).attendance[current.id] ?? 0, 0);
  }
});
