import type { Building, NetworkEdge, SimState, Vec3, Vehicle, WorldDefinition } from '../types';
import { isRoadOpen } from '../roads';

const POSITION_EPSILON = 1e-6, LOADING_REACH = 2, ROAD_LANE_OFFSET = 1.3;
type FreightState = Pick<SimState, 'vehicles' | 'shops' | 'roadNetwork'>;
export interface FreightPickupWitness {
  readonly vehicleId: string;
  readonly edgeId: string;
  readonly nodeId: string;
  readonly siteId: string;
  readonly producerShopId: string;
  readonly districtId: string;
  readonly vehiclePosition: Readonly<Vec3>;
}
const finitePoint = (p: Vec3): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Match the native traffic path and lane exactly. A nearby node alone does not
// prove that the actual vehicle occupies this loading stop.
function pointOn(world: WorldDefinition, edge: NetworkEdge, progress: number): Vec3 | null {
  const from = world.nodes.find(node => node.id === edge.from), to = world.nodes.find(node => node.id === edge.to);
  if (!from || !to) return null;
  const points = edge.points.length >= 2 ? edge.points : [from.position, to.position];
  if (!points.every(finitePoint)) return null;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  if (!Number.isFinite(total) || total <= 0) return null;
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    if (remaining <= length || i === points.length - 1) {
      const t = length ? Math.max(0, Math.min(1, remaining / length)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= length;
  }
  return null;
}

/**
 * Pure access evidence for the native carrier pickup phase. This is a road
 * loading contact, not permission for a person to enter or stand in a room.
 * The host still owns trusted fleet capacity, passenger limits, the actual
 * inventory transfer, and cargoSources custody. It must consume this witness
 * in that same phase, and enable the new rule only for the product ruleset.
 * This function neither unloads cargo nor creates a transport order or fee.
 */
export function freightPickupAccess(world: WorldDefinition, state: FreightState, vehicle: Vehicle, nodeId: string, site: Building): Readonly<FreightPickupWitness> | null {
  if (!state.vehicles.includes(vehicle) || !world.buildings.includes(site) || site.facility
    || !['farm', 'dock'].includes(site.kind) || !['road', 'flight'].includes(vehicle.kind)
    || !finitePoint(vehicle.position) || !finitePoint(site.door) || vehicle.cargo !== 0) return null;
  const producer = state.shops.find(shop => shop.buildingId === site.id);
  if (!producer || producer.districtId !== site.districtId || !Number.isFinite(producer.inventory) || producer.inventory < 1) return null;
  const edge = world.edges.find(row => row.id === vehicle.edgeId), node = world.nodes.find(row => row.id === nodeId);
  if (!edge || !node || edge.mode !== vehicle.kind || !isRoadOpen(state, edge.id)
    || node.id !== `${site.id}-door` || node.districtId !== site.districtId
    || !finitePoint(node.position) || distance(node.position, site.door) > POSITION_EPSILON) return null;
  const arrived = vehicle.progress === 0 && vehicle.direction === -1 && nodeId === edge.from
    || vehicle.progress === 1 && vehicle.direction === 1 && nodeId === edge.to;
  if (!arrived) return null;
  const expected = pointOn(world, edge, vehicle.progress);
  if (!expected || distance(expected, node.position) > POSITION_EPSILON) return null;
  if (vehicle.kind === 'road') {
    const front = pointOn(world, edge, Math.min(1, vehicle.progress + .001)), back = pointOn(world, edge, Math.max(0, vehicle.progress - .001));
    if (!front || !back) return null;
    const dx = front.x - back.x, dz = front.z - back.z, length = Math.hypot(dx, dz);
    if (length > .001) { expected.x -= dz / length * vehicle.direction * ROAD_LANE_OFFSET; expected.z += dx / length * vehicle.direction * ROAD_LANE_OFFSET; }
  }
  if (distance(vehicle.position, expected) > POSITION_EPSILON || distance(vehicle.position, site.door) > LOADING_REACH) return null;
  return Object.freeze({ vehicleId: vehicle.id, edgeId: edge.id, nodeId, siteId: site.id, producerShopId: producer.id,
    districtId: site.districtId, vehiclePosition: Object.freeze({ ...vehicle.position }) });
}

export const ROAD_FOOD_PICKUP_POLICY = 'road-food-pickup-v1' as const;
export type FreightPickupPolicy = typeof ROAD_FOOD_PICKUP_POLICY;

/** A new carrier contact contract is explicit in both save layers. Older
 * undeclared bodies keep their original human-presence loading predicate. */
export function validateFreightPickupPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'freightPickupPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'freightPickupPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || data.freightPickupPolicyId !== ROAD_FOOD_PICKUP_POLICY
    || data.runtime.freightPickupPolicyId !== ROAD_FOOD_PICKUP_POLICY
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2) throw new Error('无效存档字段：freight pickup policy pair。');
}
