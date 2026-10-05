import type { Building, SimState, WorldDefinition } from '../src/types';
import type { PowerGridDefinition } from '../src/simulation/power-grid';
import { createPowerGridState } from '../src/simulation/power-grid';

export function gridWorld(): WorldDefinition {
  const buildings = ['home', 'farm', 'market', 'clinic'].map((kind, index): Building => ({ id: `other-city-${kind}`, kind: kind as Building['kind'], name: kind, districtId: 'other-city', position: { x: index * 4, y: 0, z: 0 }, door: { x: index * 4, y: .6, z: 2 }, width: 3, depth: 3, height: 3, floors: 1, rotation: 0, capacity: 120, seed: index + 1 }));
  const nodes = buildings.map(site => ({ id: site.id + '-door', districtId: site.districtId, name: site.name, position: { ...site.door }, station: false }));
  const world: WorldDefinition = { seed: 923, voxelSize: .2, size: 100, buildings, nodes, edges: nodes.slice(1).map((node, index) => ({ id: 'other-road-' + index, from: nodes[index].id, to: node.id, mode: 'road', length: 4, capacity: 20, points: [nodes[index].position, node.position] })), districts: [{ id: 'other-city', name: '另一城市', kind: 'industry', center: { x: 0, y: 0, z: 0 }, radius: 40, color: '#ffffff', population: 384 }], mountains: [], spawn: { ...nodes[0].position }, river: [], waterfall: { top: { x: 30, y: 10, z: 30 }, bottom: { x: 30, y: 0, z: 30 }, width: 2 } };
  const powerNodes: PowerGridDefinition['nodes'] = ['source', 'north', 'south', 'island'].map((name, index) => ({ id: name, kind: index === 0 ? 'junction' : 'substation', position: { x: index * 4, y: 1, z: 0 }, capacityP: 100 }));
  world.powerGrid = { version: 1, kind: 'finite-storage-network', nodes: powerNodes, links: [{ id: 'north-line', from: 'source', to: 'north', capacityP: 100, closed: true, points: [powerNodes[0].position, powerNodes[1].position] }, { id: 'south-line', from: 'source', to: 'south', capacityP: 100, closed: true, points: [powerNodes[0].position, powerNodes[2].position] }], storage: [{ id: 'battery-asset', buildingId: buildings[0].id, nodeId: 'source', maximumP: 100, initialStoredPMinutes: 10000 }], buildings: buildings.map((site, index) => ({ buildingId: site.id, nodeId: index === 0 ? 'source' : index === 1 ? 'north' : 'south', baseP: 2, nightP: 1, shopP: .5 })), transport: world.edges.map(edge => ({ edgeId: edge.id, nodeId: 'source' })) };
  return world;
}
/** Pure graph fixture: no Simulation constructor, clock advance, wage or money. */
export function gridState(world: WorldDefinition): SimState {
  return { tick: 1, day: 0, hour: 8, powerGrid: createPowerGridState(world), shops: [], vehicles: [], energy: 0, districts: [] } as unknown as SimState;
}
