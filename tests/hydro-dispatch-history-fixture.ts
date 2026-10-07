import type { WorldDefinition } from '../src/types';
import type { HydroPowerGridDefinition } from '../src/simulation/power-grid-hydro';
import { hydroMaintenanceWorld } from './hydro-maintenance-fixture';

export const HYDRO_HISTORY_ENCODING = 'shared-dispatch-v1' as const;
export const HYDRO_HISTORY_FIXTURE_DISCLOSURE = Object.freeze({
  small: 'Six explicitly declared other-city buildings, native constructor residents/shops and one native lightRail vehicle; independently declared healthy finite machine. No maintenance order is declared in this encoding experiment.',
  large: 'Exact archived World291 layout with only an independent powerGrid declaration added before native initialization. All 612 buildings, 691 transport edges, native 616 residents, 344 vehicles and 210 shops remain. Existing energy workplace is used without changing staffing.',
  assets: 'One explicitly declared healthy constant-head machine, two finite initial reservoirs, a source junction and eleven district substations/feeders, complete building and transport loads. This is not equipment construction or default-city activation.',
  forbidden: ['setTime', 'body/role/workplace/needs/cash/stock injection', 'vehicle/shop/history deletion', 'reservoir refill', 'budget limit increases'],
});

export function sixCityHydroHistoryWorld(shared: boolean): WorldDefinition {
  const world = hydroMaintenanceWorld({ nativeVehicle: true });
  delete world.hydroMaintenance;
  if (!world.powerGrid || world.powerGrid.version !== 2) throw new Error('Explicit finite grid required.');
  if (shared) world.powerGrid.historyEncoding = HYDRO_HISTORY_ENCODING;
  return world;
}

/** Pure declaration builder. It does not construct Simulation or alter any
 * layout, person, money, traffic or shop state in an existing city. */
export function largeCityHydroHistoryWorld(original: WorldDefinition, shared: boolean): WorldDefinition {
  if (original.powerGrid || original.hydroMaintenance) throw new Error('Expected the preserved original World291 without power declarations.');
  const world = structuredClone(original);
  if (world.buildings.length !== 612 || world.edges.length !== 691 || world.districts.length !== 11)
    throw new Error('Expected all original World291 buildings, edges and districts.');
  const site = world.buildings.find(building => building.id === 'core-energy-south' && building.facility === 'energy');
  if (!site) throw new Error('Expected the original existing energy workplace.');
  const sourceId = 'declared-world291-hydro', sourceNodeId = 'declared-source';
  const position = { x: site.position.x, y: site.position.y + 1, z: site.position.z };
  const districtNode = (id: string) => 'declared-' + id;
  const nodes: HydroPowerGridDefinition['nodes'] = [
    { id: sourceNodeId, kind: 'junction', position, capacityKW: 3000 },
    ...world.districts.map(district => ({ id: districtNode(district.id), kind: 'substation' as const,
      position: { ...district.center, y: district.center.y + 1 }, capacityKW: 3000 })),
  ];
  const intake = { x: site.position.x, y: site.position.y + 10, z: site.position.z };
  const outfall = { ...site.position };
  const fromDistrict = new Map(world.nodes.map(node => [node.id, node.districtId]));
  const grid: HydroPowerGridDefinition = {
    version: 2, kind: 'finite-hydro-network', unit: 'kW-kWh-v1', nodes,
    links: world.districts.map((district, index) => ({ id: 'declared-feeder-' + district.id,
      from: sourceNodeId, to: districtNode(district.id), capacityKW: 3000, closed: true,
      points: [{ ...position }, { ...nodes[index + 1].position }] })),
    sources: [{ id: sourceId, buildingId: site.id, nodeId: sourceNodeId,
      intake: { reservoirId: 'declared-world291-upper', position: intake, open: true },
      outfall: { reservoirId: 'declared-world291-lower', position: outfall, open: true },
      penstockPoints: [intake, outfall],
      hydro: { version: 1, kind: 'finite-constant-head-hydro', id: sourceId, enabledAt: 480,
        upstream: { id: 'declared-world291-upper', capacityM3: 10000, initialM3: 10000 },
        downstream: { id: 'declared-world291-lower', capacityM3: 20000, initialM3: 0 },
        headMeters: 10, efficiency: .9, maximumM3PerMinute: 10000, maximumKW: 3000 } }],
    buildings: world.buildings.map(building => ({ buildingId: building.id,
      nodeId: districtNode(building.districtId), baseKW: 2, nightKW: 1, shopKW: .5 })),
    transport: world.edges.map(edge => {
      const district = fromDistrict.get(edge.from);
      if (!district) throw new Error('Every original transport edge must have its original district source node.');
      return { edgeId: edge.id, nodeId: districtNode(district), vehicleKW: .08 };
    }),
  };
  if (shared) grid.historyEncoding = HYDRO_HISTORY_ENCODING;
  world.powerGrid = grid;
  return world;
}
