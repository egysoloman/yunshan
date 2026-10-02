import type { Building, WorldDefinition } from '../../src/types';

// Small trusted generated fleet: the two road freight carriers start with the
// model's ordinary 28 units each. Tests never add stock or a new vehicle ID.
export function locatedFreightWorld(): WorldDefinition {
  const buildings: Building[] = (['farm', 'market', 'home'] as const).map((kind, i) => ({
    id: kind, kind, name: kind, districtId: i ? 'customers' : 'growers',
    position: { x: i * 300, y: 20, z: 0 }, door: { x: i * 300, y: 20, z: 5 },
    width: 10, depth: 10, height: 8, floors: 1, rotation: 0, capacity: 80, seed: i,
  }));
  const nodes = buildings.map(b => ({ id: b.id + '-door', districtId: b.districtId, name: b.name, position: { ...b.door }, station: true }));
  return { seed: 20261001, voxelSize: .2, size: 1600, buildings, nodes,
    edges: [{ id: 'food-road', from: nodes[0].id, to: nodes[1].id, mode: 'road', length: 300, capacity: 20, points: [nodes[0].position, nodes[1].position] },
      { id: 'home-road', from: nodes[1].id, to: nodes[2].id, mode: 'road', length: 300, capacity: 20, points: [nodes[1].position, nodes[2].position] }],
    mountains: [], districts: [
      { id: 'growers', name: 'growers', kind: 'river', center: { x: 0, y: 20, z: 0 }, radius: 300, color: '#aaa', population: 12 },
      { id: 'customers', name: 'customers', kind: 'market', center: { x: 450, y: 20, z: 0 }, radius: 400, color: '#bbb', population: 12 }],
    spawn: { ...buildings[2].door }, waterfall: { top: { x: 900, y: 50, z: 0 }, bottom: { x: 900, y: 20, z: 0 }, width: 10 }, river: [] };
}
