import type { Building, WorldDefinition } from '../src/types';
import type { HydroPowerGridDefinition } from '../src/simulation/power-grid-hydro';
import { gridWorld } from './power-grid-fixture';

export interface HydroFixtureOptions {
  upstreamM3?: number;
  downstreamM3?: number;
  downstreamCapacityM3?: number;
  intakeOpen?: boolean;
  outfallOpen?: boolean;
  farmConnected?: boolean;
  farmFeeder?: boolean;
  clinicConnected?: boolean;
  clinicFeeder?: boolean;
  farmCableKW?: number;
  farmNodeKW?: number;
  zeroDemand?: boolean;
  nativeVehicle?: boolean;
  vehicleFeeder?: boolean;
  vehicleConnected?: boolean;
}

/** Explicit other-city test assets, declared before normal native initialization.
 * The four original compact buildings, roads and seed remain the old fixture's.
 * The same normal constructor algorithm initializes residents; the fifth
 * energy workplace changes their initial workplace allocation. It is a
 * declared energy asset;
 * it is not a new asset inserted into a running or legacy/default-city save.
 * There are two finite reservoirs, one constant-head machine and no storage,
 * inflow, refill, construction authorization, repair or electricity billing.
 * This function does not construct Simulation or edit bodies/needs/money/stock.
 */
export function hydroGridWorld(options: HydroFixtureOptions = {}): WorldDefinition {
  const world: WorldDefinition = gridWorld();
  delete world.powerGrid;
  const sourceSite: Building = {
    id: 'other-city-hydro-core', kind: 'core', facility: 'energy', name: '受控有限水力站',
    districtId: 'other-city', position: { x: 20, y: 0, z: 0 }, door: { x: 20, y: .6, z: 2 },
    width: 3, depth: 3, height: 3, floors: 1, rotation: 0, capacity: 120, seed: 5,
  };
  world.buildings.push(sourceSite);
  const sourceDoor = { id: sourceSite.id + '-door', districtId: sourceSite.districtId,
    name: sourceSite.name, position: { ...sourceSite.door }, station: false };
  world.nodes.push(sourceDoor);
  world.edges.push({ id: 'other-hydro-road', from: world.nodes[3].id, to: sourceDoor.id,
    mode: 'road', length: 8, capacity: 20, points: [{ ...world.nodes[3].position }, { ...sourceDoor.position }] });
  if (options.nativeVehicle) world.edges[0].mode = 'lightRail';
  const powerNodes: HydroPowerGridDefinition['nodes'] = ['source', 'north', 'south', 'clinic', 'island']
    .map((name, index) => ({ id: name, kind: index === 0 ? 'junction' : 'substation',
      position: { x: index * 4, y: 1, z: 0 }, capacityKW: name === 'north' ? options.farmNodeKW ?? 100 : 100 }));
  if (options.nativeVehicle) powerNodes.push({ id: 'traction', kind: 'substation', position: { x: 24, y: 1, z: 0 }, capacityKW: 100 });
  const intakePosition = { x: 20, y: 10, z: 0 }, outfallPosition = { x: 20, y: 0, z: 0 };
  const grid: HydroPowerGridDefinition = {
    version: 2, kind: 'finite-hydro-network', unit: 'kW-kWh-v1', nodes: powerNodes,
    links: [
      { id: 'north-line', from: 'source', to: 'north', capacityKW: options.farmCableKW ?? 100,
        closed: options.farmFeeder ?? true, points: [powerNodes[0].position, powerNodes[1].position] },
      { id: 'south-line', from: 'source', to: 'south', capacityKW: 100,
        closed: true, points: [powerNodes[0].position, powerNodes[2].position] },
      { id: 'clinic-line', from: 'source', to: 'clinic', capacityKW: 100,
        closed: options.clinicFeeder ?? true, points: [powerNodes[0].position, powerNodes[3].position] },
    ],
    sources: [{ id: 'other-hydro', buildingId: sourceSite.id, nodeId: 'source',
      intake: { reservoirId: 'other-upper-reservoir', position: intakePosition, open: options.intakeOpen ?? true },
      outfall: { reservoirId: 'other-lower-reservoir', position: outfallPosition, open: options.outfallOpen ?? true },
      penstockPoints: [intakePosition, outfallPosition],
      hydro: { version: 1, kind: 'finite-constant-head-hydro', id: 'other-hydro', enabledAt: 480,
        upstream: { id: 'other-upper-reservoir', capacityM3: 10000, initialM3: options.upstreamM3 ?? 10000 },
        downstream: { id: 'other-lower-reservoir', capacityM3: options.downstreamCapacityM3 ?? 20000,
          initialM3: options.downstreamM3 ?? 0 },
        headMeters: 10, efficiency: .9, maximumM3PerMinute: 100, maximumKW: 100 } }],
    buildings: world.buildings.map(site => ({ buildingId: site.id,
      nodeId: site.id === 'other-city-farm' ? options.farmConnected === false ? null : 'north'
        : site.id === 'other-city-market' ? 'south'
          : site.id === 'other-city-clinic' ? options.clinicConnected === false ? null : 'clinic' : 'source',
      baseKW: options.zeroDemand || site.facility === 'energy' ? 0 : 2,
      nightKW: options.zeroDemand || site.facility === 'energy' ? 0 : 1,
      shopKW: options.zeroDemand ? 0 : .5 })),
    transport: world.edges.map(edge => ({ edgeId: edge.id,
      nodeId: options.nativeVehicle && edge.id === world.edges[0].id ? options.vehicleConnected === false ? null : 'traction' : 'source', vehicleKW: .08 })),
  };
  if (options.nativeVehicle) grid.links.push({ id: 'traction-line', from: 'source', to: 'traction', capacityKW: 100,
    closed: options.vehicleFeeder ?? true, points: [powerNodes[0].position, powerNodes[5].position] });
  world.powerGrid = grid;
  return world;
}

export const HYDRO_FIXTURE_DISCLOSURE = Object.freeze({
  scope: 'Controlled other-city native integration; not primary World291, natural default-city generation, or E2 money/material maintenance.',
  initialAssets: 'Original four compact gridWorld buildings/roads/seed plus one declared energy facility, three separate feeder links, one finite constant-head hydro machine and two closed finite reservoirs.',
  nativeInitialization: 'Unmodified Simulation constructor creates residents, player wallet/needs, original shop stock/capital, payroll and all other modules.',
  positiveControls: ['speed4 command', 'one player doorway setFocus', 'actual purchase30 then purchase11', 'actual work command and ordinary .25-second steps'],
  forbiddenEdits: ['direct money/stock/needs/identity changes', 'NPC body correction', 'manual labor/wage grants', 'clock jump', 'reset water/electricity', 'generic event accepted as native wage'],
  medicineScope: 'Current native clinicalPowerAvailable gate and claimClinicalCareMinutes returning zero before consuming any doctor slot when unpowered; no claim of completed treatment.',
});
