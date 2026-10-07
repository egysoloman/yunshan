import type { Building, WorldDefinition } from '../src/types';
import { hydroGridWorld, type HydroFixtureOptions } from './power-grid-hydro-fixture';

/** Six buildings declared before the unmodified native city constructor.
 * The ordinary workshop supplies its native initial material inventory; the
 * energy workplace supplies native engineers through ordinary job allocation.
 * This helper does not construct Simulation or edit any person's body, role,
 * needs, cash, stock, attendance or wages.
 */
export function hydroMaintenanceWorld(options: HydroFixtureOptions = {}): WorldDefinition {
  const world = hydroGridWorld(options), grid = world.powerGrid;
  if (!grid || grid.version !== 2 || grid.kind !== 'finite-hydro-network')
    throw new Error('The maintenance fixture requires its declared finite hydro grid.');
  const sourceDoor = world.nodes.find(node => node.id === 'other-city-hydro-core-door');
  if (!sourceDoor) throw new Error('The declared energy workplace has no native doorway node.');
  const workshop: Building = {
    id: 'other-city-workshop', kind: 'workshop', name: '受控工业材料工坊',
    districtId: 'other-city', position: { x: 24, y: 0, z: 0 }, door: { x: 24, y: .6, z: 2 },
    width: 3, depth: 3, height: 3, floors: 1, rotation: 0, capacity: 120, seed: 6,
  };
  world.buildings.push(workshop);
  const workshopDoor = { id: workshop.id + '-door', districtId: workshop.districtId,
    name: workshop.name, position: { ...workshop.door }, station: false };
  world.nodes.push(workshopDoor);
  const workshopRoad = { id: 'other-materials-road', from: sourceDoor.id, to: workshopDoor.id,
    mode: 'road' as const, length: 4, capacity: 20,
    points: [{ ...sourceDoor.position }, { ...workshopDoor.position }] };
  world.edges.push(workshopRoad);
  grid.buildings.push({ buildingId: workshop.id, nodeId: 'source',
    baseKW: options.zeroDemand ? 0 : 2, nightKW: options.zeroDemand ? 0 : 1,
    shopKW: options.zeroDemand ? 0 : .5 });
  grid.transport.push({ edgeId: workshopRoad.id, nodeId: 'source', vehicleKW: .08 });
  world.hydroMaintenance = {
    version: 1, kind: 'paid-hydro-maintenance', sourceId: 'other-hydro',
    operatorSiteId: 'other-city-hydro-core', initialNeedsRepair: true,
    requiredMinutes: 60, materialUnits: 1, playerEscrow: 100,
  };
  return world;
}

export const HYDRO_MAINTENANCE_FIXTURE_DISCLOSURE = Object.freeze({
  scope: 'Explicit six-building other-city maintenance fixture; not primary World291 or default-city enablement.',
  initialAssets: 'The five hydroGridWorld buildings and finite hydro assets plus one ordinary workshop, its doorway, a four-metre road and complete building/transport power loads.',
  nativeInitialization: 'The unmodified constructor creates engineers from the energy workplace and the ordinary workshop shop with its original ninety material units; no people, money or stock are injected.',
  initialFault: 'The declared initial maintenance requirement is a fixture precondition, not evidence of equipment procurement, construction or a naturally occurring disaster.',
  playerPosition: 'A driver may disclose one controlled player setFocus at the workplace; that placement is not natural walking and never moves an NPC.',
  forbiddenEdits: ['NPC body/role/needs changes', 'direct money/stock changes', 'manual attendance/wage grants', 'setTime', 'reservoir refills'],
  publicApproval: 'No hall or official profession is declared; civic staffing alone supplies no legitimate public budget signers in this fixture.',
});
