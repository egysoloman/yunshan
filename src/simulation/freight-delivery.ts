import type { NetworkEdge, Shop, SimState, WorldDefinition } from '../types';
import { isRoadOpen, roadRevision } from '../roads';
import { ROAD_FOOD_PICKUP_POLICY } from './freight-access';

export const ROAD_FOOD_DELIVERY_POLICY = 'road-food-delivery-v1' as const;
export type FreightDeliveryPolicy = typeof ROAD_FOOD_DELIVERY_POLICY;
export interface FoodRetailDeliveryOffer { readonly shopId: string; readonly nodeId: string; readonly districtId: string; readonly acceptableUnits: number }
export interface RoadFoodDeliveryLeg { readonly node: string; readonly edge: NetworkEdge }
export interface RoadFoodDeliveryRoute { readonly shopId: string; readonly nodeId: string; readonly districtId: string; readonly distance: number; readonly arrived: boolean; readonly next: RoadFoodDeliveryLeg | null }
type RoadState = Pick<SimState, 'roadNetwork'>;
interface Tree { costs: Map<string, number>; first: Map<string, RoadFoodDeliveryLeg> }
const CACHE_LIMIT = 32;
const finite = (v: number): boolean => Number.isFinite(v);

export interface FoodDeliveryAccounts {
  readonly sourceShopId: string; readonly sourceFunds: number; readonly unitPrice: number; readonly taxRate: number;
  readonly retail: readonly { readonly shopId: string; readonly funds: number; readonly protectedFunds: number }[];
  readonly suppliers: readonly { readonly shopId: string; readonly funds: number; readonly unitPrice: number }[];
  readonly freightTotals: Readonly<Record<string, number>>;
  readonly freightLots: Readonly<Record<string, readonly { readonly shopId: string | null; readonly quantity: number }[]>>;
}

const validPrice = (value: number): boolean => finite(value) && value >= 4 && value <= 100000 && Math.abs(value * 100 - Math.round(value * 100)) <= 1e-7;

/** Potential funded reception, not a sale or a reservation. Full carried cargo
 * needs retail space and free cash after wages. A bounded, read-only FIFO
 * forecast uses each prior owner's actual quote and account headroom. Three
 * ordinary 14-unit batches reach the existing inventory<36 stopping threshold;
 * no future sales, wages, price changes or reservations are assumed. */
export function foodRetailDeliveryOffers(world: WorldDefinition, shops: readonly Shop[], accounts: FoodDeliveryAccounts): readonly FoodRetailDeliveryOffer[] {
  if (!validPrice(accounts.unitPrice) || !finite(accounts.sourceFunds) || accounts.sourceFunds < 0 || accounts.sourceFunds > 1e9 || !finite(accounts.taxRate) || accounts.taxRate < 0 || accounts.taxRate >= 1) return [];
  const cash = new Map(accounts.retail.map(row => [row.shopId, row])), sites = new Map(world.buildings.map(site => [site.id, site])), nodes = new Map(world.nodes.map(node => [node.id, node]));
  const suppliers = new Map(accounts.suppliers.map(row => [row.shopId, row]));
  suppliers.set(accounts.sourceShopId, { shopId: accounts.sourceShopId, funds: accounts.sourceFunds, unitPrice: accounts.unitPrice });
  const candidates = shops.flatMap(shop => {
    const site = sites.get(shop.buildingId), account = cash.get(shop.id), node = nodes.get(`${shop.buildingId}-door`);
    if (!site || site.kind !== 'market' || site.facility || !node || node.districtId !== site.districtId || shop.districtId !== site.districtId
      || Math.hypot(node.position.x - site.door.x, node.position.y - site.door.y, node.position.z - site.door.z) > 1e-6
      || !finite(shop.inventory) || shop.inventory < 0 || shop.inventory >= 36 || !account || !finite(account.funds) || account.funds < 0 || account.funds > 1e9 || !finite(account.protectedFunds) || account.protectedFunds < 0) return [];
    return [{ shopId: shop.id, nodeId: node.id, districtId: site.districtId, inventory: shop.inventory, funds: account.funds, protectedFunds: account.protectedFunds, acceptableUnits: 0 }];
  });
  for (const districtId of new Set(candidates.map(offer => offer.districtId))) {
    const lots = accounts.freightLots[districtId] ?? [], held = lots.reduce((n, lot) => n + lot.quantity, 0);
    const total = accounts.freightTotals[districtId] ?? 0;
    if (lots.some(lot => !finite(lot.quantity) || lot.quantity < 0) || !finite(held) || !finite(total) || total < 0 || Math.abs(total - held) > 1e-6 || held >= 1e9 || lots.length > shops.length + 1 || lots.length === shops.length + 1 && !lots.some(lot => lot.shopId === accounts.sourceShopId)) continue;
    const queue = lots.map(lot => ({ shopId: lot.shopId, prior: lot.quantity, added: 0 })), existing = queue.find(lot => lot.shopId === accounts.sourceShopId);
    // cargo-arrived merges into the first matching owner's existing lot.
    if (existing) existing.added = 1e9 - held; else queue.push({ shopId: accounts.sourceShopId, prior: 0, added: 1e9 - held });
    const balances = new Map([...suppliers].map(([id, row]) => [id, row.funds])), retail = candidates.filter(offer => offer.districtId === districtId);
    for (let batch = 0; batch < 3; batch++) for (const shop of retail) {
      if (shop.inventory >= 36) continue;
      let received = 0;
      const maximumAttempts = queue.length + 2;
      for (let attempt = 0; attempt < maximumAttempts && queue.length && received < 14 && shop.inventory < 70 && shop.funds >= 4; attempt++) {
        const lot = queue[0], owner = lot.shopId === null ? undefined : suppliers.get(lot.shopId), price = lot.shopId === null ? 4 : owner?.unitPrice;
        if (price === undefined || !validPrice(price) || owner && (!finite(owner.funds) || owner.funds < 0 || owner.funds > 1e9)) break;
        const balance = owner ? balances.get(owner.shopId)! : 0;
        const quantity = Math.min(lot.prior + lot.added, 14 - received, 70 - shop.inventory, Math.floor(Math.max(0, shop.funds - shop.protectedFunds) / price), owner ? Math.max(0, 1e9 - balance) / (price * (1 - accounts.taxRate)) : Infinity);
        if (!finite(quantity) || quantity <= 1e-7) break;
        const prior = Math.min(lot.prior, quantity), added = quantity - prior;
        lot.prior -= prior; lot.added -= added; shop.acceptableUnits += added;
        shop.inventory += quantity; received += quantity; shop.funds -= quantity * price;
        if (owner) balances.set(owner.shopId, balance + quantity * price * (1 - accounts.taxRate));
        if (lot.prior + lot.added < 1e-7) queue.shift();
      }
    }
  }
  return candidates.flatMap(({ shopId, nodeId, districtId, acceptableUnits }) => finite(acceptableUnits) && acceptableUnits > 0 ? [{ shopId, nodeId, districtId, acceptableUnits }] : []);
}

/** Only topology is cached. Live stock, protected wages and quotes remain the
 * host's current-frame offers, never entries in this bounded derived cache. */
export class RoadFoodDeliveryRouter {
  private state?: RoadState;
  private signature = '';
  private readonly trees = new Map<string, Tree>();
  private readonly adjacency = new Map<string, RoadFoodDeliveryLeg[]>();
  private readonly nodeIds = new Set<string>();
  private edgeRows: readonly NetworkEdge[] = [];
  constructor(private readonly world: WorldDefinition) {}
  clear(): void { this.state = undefined; this.signature = ''; this.trees.clear(); this.adjacency.clear(); this.nodeIds.clear(); }
  private prepare(state: RoadState): void {
    // The explicit open-bit signature also catches same-revision parameter
    // changes in pure callers; production close/reopen advances roadRevision.
    const signature = `${roadRevision(state)}:${this.world.nodes.map(n => n.id).join(',')}:` + this.world.edges.map(e => `${e.id}/${e.mode}/${e.from}/${e.to}/${e.length}/${isRoadOpen(state, e.id) ? 1 : 0}`).join(';');
    if (this.state === state && this.signature === signature && this.edgeRows.length === this.world.edges.length && this.edgeRows.every((row, index) => row === this.world.edges[index])) return;
    this.state = state; this.signature = signature; this.trees.clear(); this.adjacency.clear(); this.nodeIds.clear();
    this.edgeRows = this.world.edges.slice();
    for (const node of this.world.nodes) this.nodeIds.add(node.id);
    for (const edge of this.world.edges) {
      if (edge.mode !== 'road' || !isRoadOpen(state, edge.id) || !finite(edge.length) || edge.length <= 0 || !this.nodeIds.has(edge.from) || !this.nodeIds.has(edge.to)) continue;
      for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
        const list = this.adjacency.get(from) ?? []; list.push({ node: to, edge }); this.adjacency.set(from, list);
      }
    }
    for (const list of this.adjacency.values()) list.sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.node.localeCompare(b.node));
  }
  private tree(origin: string): Tree {
    const known = this.trees.get(origin); if (known) { this.trees.delete(origin); this.trees.set(origin, known); return known; }
    const tree: Tree = { costs: new Map([[origin, 0]]), first: new Map() }, queue: { node: string; cost: number; key: string }[] = [{ node: origin, cost: 0, key: '' }], keys = new Map([[origin, '']]);
    // A binary heap keeps the complete finite road search independent of the
    // number of NPCs, with deterministic node/first-edge tie resolution.
    const less = (a: typeof queue[number], b: typeof queue[number]) => a.cost < b.cost || a.cost === b.cost && (a.key < b.key || a.key === b.key && a.node < b.node);
    const push = (row: typeof queue[number]) => { queue.push(row); let i = queue.length - 1; while (i) { const p = (i - 1) >> 1; if (!less(queue[i], queue[p])) break; [queue[i], queue[p]] = [queue[p], queue[i]]; i = p; } };
    const pop = () => { const row = queue[0], last = queue.pop()!; if (queue.length) { queue[0] = last; let i = 0; while (true) { let c = i * 2 + 1; if (c >= queue.length) break; if (c + 1 < queue.length && less(queue[c + 1], queue[c])) c++; if (!less(queue[c], queue[i])) break; [queue[i], queue[c]] = [queue[c], queue[i]]; i = c; } } return row; };
    while (queue.length) {
      const row = pop(); if (tree.costs.get(row.node) !== row.cost || keys.get(row.node) !== row.key) continue;
      for (const leg of this.adjacency.get(row.node) ?? []) {
        const cost = row.cost + leg.edge.length, first = row.node === origin ? leg : tree.first.get(row.node)!, key = `${first.edge.id}\0${first.node}`, old = tree.costs.get(leg.node);
        if (!finite(cost)) continue;
        if (old !== undefined && (cost > old || cost === old && key >= keys.get(leg.node)!)) continue;
        tree.costs.set(leg.node, cost); tree.first.set(leg.node, first); keys.set(leg.node, key); push({ node: leg.node, cost, key });
      }
    }
    if (this.trees.size >= CACHE_LIMIT) this.trees.delete(this.trees.keys().next().value!);
    this.trees.set(origin, tree); return tree;
  }
  route(state: RoadState, nodeId: string, offers: readonly FoodRetailDeliveryOffer[], cargo: number): Readonly<RoadFoodDeliveryRoute> | null {
    if (!finite(cargo) || cargo <= 0) return null;
    this.prepare(state); if (!this.nodeIds.has(nodeId)) return null;
    const tree = this.tree(nodeId);
    const choices = offers.filter(o => typeof o.shopId === 'string' && typeof o.districtId === 'string' && finite(o.acceptableUnits) && o.acceptableUnits >= cargo && tree.costs.has(o.nodeId))
      .sort((a, b) => tree.costs.get(a.nodeId)! - tree.costs.get(b.nodeId)! || a.shopId.localeCompare(b.shopId) || a.nodeId.localeCompare(b.nodeId));
    const chosen = choices[0]; if (!chosen) return null;
    const arrived = chosen.nodeId === nodeId, next = arrived ? null : tree.first.get(chosen.nodeId) ?? null;
    if (!arrived && !next) return null;
    return Object.freeze({ shopId: chosen.shopId, nodeId: chosen.nodeId, districtId: chosen.districtId, distance: tree.costs.get(chosen.nodeId)!, arrived, next });
  }
  get cachedTreeCount(): number { return this.trees.size; }
}

/** Missing declarations retain both original unloading and original RNG use. */
export function validateFreightDeliveryPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'freightDeliveryPolicyId'), runtime = !!data.runtime && Object.hasOwn(data.runtime, 'freightDeliveryPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || data.freightDeliveryPolicyId !== ROAD_FOOD_DELIVERY_POLICY || data.runtime.freightDeliveryPolicyId !== ROAD_FOOD_DELIVERY_POLICY
    || data.version !== 4 || data.motionVersion !== 2 || data.runtime.npcMotionVersion !== 2
    || data.freightPickupPolicyId !== ROAD_FOOD_PICKUP_POLICY || data.runtime.freightPickupPolicyId !== ROAD_FOOD_PICKUP_POLICY) throw new Error('无效存档字段：freight delivery policy pair。');
}
