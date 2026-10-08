import type { SimState, WorldDefinition } from '../types';
import type { HydroPowerGridDefinition } from './power-grid-hydro';
import { PAGED_HYDRO_WINDOW_MAX_JSON_CHARS } from './power-hydro-runtime';

const DOUBLE = 32;
const quoted = (text: string): number => JSON.stringify(text).length;
const array = (values: readonly number[]): number => 2 + Math.max(0, values.length - 1) + values.reduce((sum, value) => sum + value, 0);
const object = (values: readonly (readonly [string, number])[]): number =>
  2 + Math.max(0, values.length - 1) + values.reduce((sum, [key, value]) => sum + quoted(key) + 1 + value, 0);
const named = (ids: readonly string[], value: number): number => object(ids.map(id => [id, value] as const));

/** A future window may change every vehicle edge, every shop permit and every
 * diagnostic, and may require a new full snapshot. Use all legal identities,
 * not the present flow or observed reuse. The private grid capability binds
 * these identity sets and the frozen declaration before every time advance.
 * This is a UTF-16 JSON character bound, independent of gzip or object sharing.
 */
export function sharedHydroAppendCharUpperBound(world: WorldDefinition, state: SimState): number {
  const grid = world.powerGrid as HydroPowerGridDefinition;
  const nodeIds = grid.nodes.map(node => node.id), linkIds = grid.links.map(link => link.id);
  const buildingIds = world.buildings.map(site => site.id), vehicleIds = state.vehicles.map(vehicle => vehicle.id);
  const sourceIds = grid.sources.map(source => source.id);
  const node = nodeIds.reduce((maximum, id) => Math.max(maximum, quoted(id)), 4);
  const edge = world.edges.reduce((maximum, item) => Math.max(maximum, quoted(item.id)), 4);
  const meterFields = [['nodeId', node], ['demandKW', DOUBLE], ['servedKW', DOUBLE], ['unservedKW', DOUBLE]] as const;
  const buildings = named(buildingIds, object(meterFields));
  const vehicles = named(vehicleIds, object([...meterFields, ['edgeId', edge]]));
  const shopRows = state.shops.map(shop => object([
    ['id', quoted(shop.id)], ['buildingId', quoted(shop.buildingId)], ['allowsOperation', 5],
    // Reserve a legal future declaration before people can create its first
    // night job. The energy preflight runs earlier than that people phase.
    ...(world.buildings.find(site => site.id === shop.buildingId)?.kind === 'market' ? [['nightRetailPlan', object([
      ['jobId', quoted('night-retail-9007199254740991')], ['operatorId', 122], ['startsAt', DOUBLE], ['endsAt', DOUBLE],
    ])] as const] : []),
  ]));
  const loadSources = object([
    ['shops', array(shopRows)], ...(world.hydroMaintenance !== undefined ? [['equipmentAvailable', 5] as const] : []),
  ]);
  // Include both complete arrays as a conservative bound, even when a given
  // solution cannot make the same node both isolated and constrained.
  const diagnostics = object([
    ['unconnectedBuildings', array(buildingIds.map(quoted))], ['unconnectedVehicles', array(vehicleIds.map(quoted))],
    ['islandNodeIds', array(nodeIds.map(quoted))], ['exhaustedSourceIds', array(sourceIds.map(quoted))],
    ['constrainedLinkIds', array(linkIds.map(quoted))], ['constrainedNodeIds', array(nodeIds.map(quoted))],
  ]);
  const sourceFields = [['availableKW', DOUBLE], ['suppliedKW', DOUBLE]] as const;
  const common = [
    ['availableKW', DOUBLE], ['demandKW', DOUBLE], ['servedKW', DOUBLE], ['unservedKW', DOUBLE], ['curtailedKW', DOUBLE],
    ['links', named(linkIds, DOUBLE)], ['nodes', named(nodeIds, DOUBLE)],
    ['buildings', buildings], ['vehicles', vehicles], ['loadSources', loadSources], ['diagnostics', diagnostics],
  ] as const;
  const snapshot = object([...common, ['sources', named(sourceIds, object(sourceFields))]]);
  const dispatch = object([
    ['tick', DOUBLE], ['beforeAt', DOUBLE], ['at', DOUBLE], ['nativeMinutes', DOUBLE], ['minutes', DOUBLE],
    ...common, ['sources', named(sourceIds, object([...sourceFields, ['transferredM3', DOUBLE], ['generatedKWh', DOUBLE]]))],
  ]);
  const reference = object([['snapshotIndex', 6], ['generatedKWh', DOUBLE]]);
  // All changing root/hydro/totals scalars, three page/count envelopes and
  // branch punctuation fit below this fixed allowance. definitionKey and the
  // explicit encoding tag are already in the current exact body and stay fixed.
  return snapshot + dispatch + PAGED_HYDRO_WINDOW_MAX_JSON_CHARS + reference + 8192;
}
