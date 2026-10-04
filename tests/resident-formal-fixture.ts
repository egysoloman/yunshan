import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { advance, attachControls, fixture, pin, runtime, station, type Controls } from './education-fixture.ts';

/** Declared controlled opening WORLD, never a live-city infrastructure edit.
 * It retains the E1 384-person population and original road network, adding
 * two finite native workshops with actual connected door nodes. Every stock,
 * cash balance, owner, workforce and wage is created by the original
 * constructor/real simulator. No material or money is supplied after creation.
 * The original single-workshop failed run remains independent evidence of
 * inadequate coupled public-upkeep/material capacity. */
export function threeWorkshopSetup() {
  const world = fixture(), original = world.buildings.find(building => building.kind === 'workshop')!;
  const anchor = world.nodes.find(node => node.id === `${original.id}-door`)!;
  for (const [index, offset] of [[2, 32], [3, -32]] as const) {
    const building = { ...original, id: `education-workshop-${index}`, name: `有限教材工坊${index}`, seed: 20 + index,
      position: { ...original.position, z: original.position.z + offset }, door: { ...original.door, z: original.door.z + offset } };
    world.buildings.push(building);
    const node = { id: `${building.id}-door`, name: building.name, districtId: building.districtId, position: { ...building.door }, station: true };
    world.nodes.push(node);
    world.edges.push({ id: `education-workshop-link-${index}`, mode: 'road', from: anchor.id, to: node.id, length: Math.abs(offset), capacity: 20, points: [anchor.position, node.position] });
  }
  const sim = new Simulation(world), controls: Controls = new Map(), site = world.buildings.find(building => building.kind === 'school')!;
  assert.equal(sim.state.citizens.length, 384); assert.equal(sim.state.speed, 1); assert.equal(sim.state.shops.filter(shop => world.buildings.find(building => building.id === shop.buildingId)?.kind === 'workshop').length, 3);
  const teacher = sim.state.citizens.find(person => person.workId === site.id && person.role === '老师' && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  assert.ok(teacher); assert.ok(sim.buildingTravelDistance(teacher.homeId, site.id) <= 500); assert.equal(runtime(sim).attendance[teacher.id] ?? 0, 0);
  let earnedMinutes = 0, earnedAmount = 0;
  sim.onEvent('wage-earned', event => { if (event.citizenId === teacher.id) { earnedMinutes += event.minutes ?? 0; earnedAmount += event.amount ?? 0; } });
  for (const person of sim.state.citizens) { const home = world.buildings.find(building => building.id === person.homeId)!; pin(sim, controls, person.id, home, home.door); }
  pin(sim, controls, teacher.id, site, station(site), 'work'); attachControls(sim, controls); sim.setFocus(station(site), 'walk');
  sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  advance(sim, 4); assert.ok(earnedMinutes > 0 && earnedAmount > 0); assert.equal(sim.isOnDuty(teacher.id, site.id), true);
  return { sim, controls, site, teacher, earned: () => ({ minutes: earnedMinutes, amount: earnedAmount }) };
}
