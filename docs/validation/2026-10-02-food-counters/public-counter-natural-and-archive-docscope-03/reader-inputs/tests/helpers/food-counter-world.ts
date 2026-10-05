import type { Building } from '../../src/types';
import { locatedFreightWorld } from './located-freight-world';
// The old-layout fixture has no food retailer in the customers district.
// Stock and wallets are exclusively the model's ordinary initialization.
export function foodCounterWorld() {
  const world = locatedFreightWorld();
  world.buildings.find(b => b.id === 'market')!.kind = 'clinic';
  for (const [id, kind, x] of [['school', 'school', 630], ['hall', 'hall', 700], ['workshop', 'workshop', 800]] as const) {
    const building: Building = { id, kind, name: id, districtId: 'customers', position: { x, y: 20, z: 0 }, door: { x, y: 20, z: 5 }, width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 80, seed: x };
    world.buildings.push(building); world.nodes.push({ id: `${id}-door`, districtId: building.districtId, name: id, position: { ...building.door }, station: true });
    world.edges.push({ id: `${id}-road`, from: 'home-door', to: `${id}-door`, mode: 'road', length: x - 600, capacity: 20, points: [world.nodes.find(n => n.id === 'home-door')!.position, { ...building.door }] });
  }
  return world;
}
