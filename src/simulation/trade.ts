import type { Simulation } from '../simulation';
import type { Shop, SimState, WorldDefinition } from '../types';

export interface ConsignmentLot { id: string; supplierId: string; quantity: number; unitPrice: number; createdAt: number }
export interface OwnedStockLot { quantity: number; unitPrice: number; createdAt: number }
export interface TradeActivityBucket { at: number; sold: number; supplied: number; labor: number; produced: number; shortages: number; earnedLaborCost?: number; actualUtilities?: number }
export interface TradeState {
  version: 1 | 2; nextLotId: number;
  lots: Record<string, ConsignmentLot[]>;
  ownedLots?: Record<string, OwnedStockLot[]>;
  /** Only a validated version-one archive can grandfather industrial custody.
   * These IDs disappear when its original lots are sold or returned. */
  legacyIndustrialLotIds?: string[];
  activity: Record<string, TradeActivityBucket[]>;
  stats: { suppliedUnits: number; settledUnits: number; returnedUnits: number; supplierGross: number; settlementsByPrice?: Record<string, number> };
}
const EPS = 1e-7, WINDOW = 180, BUCKET = 10, TRIAL_STOCK = 4, MAX_STOCK = 70, UNIT_PRICE = 4;
const installed = new WeakSet<Simulation>();
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dictionary = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stateOf = (simulation: Simulation) => simulation.state as SimState & { trade?: TradeState };
const clock = (state: SimState) => state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
const empty = (): TradeState => ({ version: 2, nextLotId: 1, lots: {}, legacyIndustrialLotIds: [], activity: {}, stats: { suppliedUnits: 0, settledUnits: 0, returnedUnits: 0, supplierGross: 0, settlementsByPrice: {} } });
const sourceKind = (world: WorldDefinition, shop: Shop) => ['farm', 'workshop', 'dock'].includes(world.buildings.find(site => site.id === shop.buildingId)?.kind ?? '');
const industrialSource = (world: WorldDefinition, shop: Shop) => world.buildings.find(site => site.id === shop.buildingId)?.kind === 'workshop';
const retailKind = (world: WorldDefinition, shop: Shop) => world.buildings.find(site => site.id === shop.buildingId)?.kind === 'market';
const unitsHeld = (trade: TradeState, shopId: string) => (trade.lots[shopId] ?? []).reduce((sum, lot) => sum + lot.quantity, 0);
const unitsOwned = (trade: TradeState, shopId: string) => (trade.ownedLots?.[shopId] ?? []).reduce((sum, lot) => sum + lot.quantity, 0);
const validPrice = (value: unknown): value is number => number(value) && value >= UNIT_PRICE && value <= 100000 && Math.abs(value * 100 - Math.round(value * 100)) <= EPS;
const custodySourceAllowed = (trade: TradeState, world: WorldDefinition, supplier: Shop, lot: ConsignmentLot) => sourceKind(world, supplier) && (!industrialSource(world, supplier) || trade.version === 1 || trade.legacyIndustrialLotIds?.includes(lot.id));
function seedOwnedBasis(state: SimState, world: WorldDefinition): void {
  const trade = state.trade!;
  if (trade.ownedLots !== undefined) return;
  trade.ownedLots = {};
  for (const shop of state.shops) if (retailKind(world, shop)) {
    const owned = Math.max(0, shop.inventory - unitsHeld(trade, shop.id));
    if (owned > EPS) trade.ownedLots[shop.id] = [{ quantity: owned, unitPrice: UNIT_PRICE, createdAt: clock(state) }];
  }
}

function restoreTrade(state: SimState, world: WorldDefinition): void {
  state.trade ??= empty();
  const trade = state.trade;
  if (trade.version === 1) {
    // Import validation has already checked the original ownership and totals.
    // Do not turn old material custody into a new payment or a food source.
    const shops = new Map(state.shops.map(shop => [shop.id, shop]));
    trade.legacyIndustrialLotIds = Object.values(trade.lots).flatMap(lots => lots.filter(lot => industrialSource(world, shops.get(lot.supplierId)!)).map(lot => lot.id));
    trade.version = 2;
  }
  seedOwnedBasis(state, world);
}

function pruneLegacyCustody(trade: TradeState): void {
  if (!trade.legacyIndustrialLotIds) return;
  const live = new Set(Object.values(trade.lots).flatMap(lots => lots.map(lot => lot.id)));
  trade.legacyIndustrialLotIds = trade.legacyIndustrialLotIds.filter(id => live.has(id));
}

function bucket(trade: TradeState, shopId: string, now: number): TradeActivityBucket {
  const at = Math.floor(now / BUCKET) * BUCKET, rows = trade.activity[shopId] ??= [];
  let row = rows.at(-1);
  if (!row || row.at !== at) { row = { at, sold: 0, supplied: 0, labor: 0, produced: 0, shortages: 0, earnedLaborCost: 0, actualUtilities: 0 }; rows.push(row); }
  while (rows.length && rows[0].at + BUCKET <= now - WINDOW) rows.shift();
  return row;
}

/** These sums come only from real sale quantities, attended work and production
 * events. They describe throughput, not invented supply or simulated receipts. */
export function tradeSignals(simulation: Simulation, shopId: string) {
  const state = stateOf(simulation), trade = state.trade;
  const result = { sold: 0, supplied: 0, labor: 0, produced: 0, shortages: 0, earnedLaborCost: 0, actualUtilities: 0, consigned: trade ? unitsHeld(trade, shopId) : 0 };
  if (!trade) return result;
  for (const row of trade.activity[shopId] ?? []) if (row.at + BUCKET > clock(state) - WINDOW) {
    result.sold += row.sold; result.supplied += row.supplied; result.labor += row.labor; result.produced += row.produced; result.shortages += row.shortages;
    result.earnedLaborCost += row.earnedLaborCost ?? 0; result.actualUtilities += row.actualUtilities ?? 0;
  }
  return result;
}

export interface SupplyQuote { quantity: number; unitPrice: number; costWindowUnits: number; earnedLaborCost: number; actualUtilities: number }
/** A negotiation for existing producer goods, based on observed costs only.
 * Unobserved initial/old stock keeps the historical 4 coin reference price.
 * This quote neither promises a buyer nor revalues inventory or past profit. */
export function quoteSupply(simulation: Simulation, producerId: string, requestedQuantity: number): SupplyQuote {
  const supplier = simulation.state.shops.find(shop => shop.id === producerId), signals = tradeSignals(simulation, producerId);
  const observed = signals.produced > EPS ? (signals.earnedLaborCost + signals.actualUtilities) / signals.produced / (1 - simulation.state.taxRate) : UNIT_PRICE;
  const unitPrice = Math.ceil(Math.max(UNIT_PRICE, observed) * 100 - EPS) / 100;
  const quantity = supplier && sourceKind(simulation.worldDefinition, supplier) && number(requestedQuantity) && requestedQuantity > 0 && validPrice(unitPrice) ? Math.min(requestedQuantity, supplier.inventory) : 0;
  return { quantity, unitPrice, costWindowUnits: signals.produced, earnedLaborCost: signals.earnedLaborCost, actualUtilities: signals.actualUtilities };
}

/** Called after a real paid purchase adds stock. Record its immutable gross
 * acquisition cost, without another payment or any historical profit change. */
export function recordOwnedStockPurchase(simulation: Simulation, shopId: string, quantity: number, unitPrice: number): void {
  const state = stateOf(simulation), trade = state.trade, shop = state.shops.find(shop => shop.id === shopId);
  if (!trade || !shop || !retailKind(simulation.worldDefinition, shop)) return;
  if (!number(quantity) || quantity <= 0 || !validPrice(unitPrice)) throw new Error('零售购入数量或实际进价无效。');
  if (!trade.ownedLots) throw new Error('零售成本账本尚未恢复。');
  if (Math.abs(unitsOwned(trade, shopId) + unitsHeld(trade, shopId) + quantity - shop.inventory) > EPS) throw new Error('零售购入成本需要已发生的真实库存增加。');
  const lots = trade.ownedLots[shopId] ??= [], last = lots.at(-1);
  if (last?.unitPrice === unitPrice) last.quantity += quantity;
  else lots.push({ quantity, unitPrice, createdAt: clock(state) });
}

/** Transfer custody of existing local producer stock. No cash, credit, payroll,
 * shop owner or company identity changes until a customer actually buys it. */
export function supplyConsignment(simulation: Simulation, shopId: string, requestedQuantity: number): number {
  const state = stateOf(simulation), trade = state.trade, retail = state.shops.find(shop => shop.id === shopId);
  if (!trade || !retail || !retailKind(simulation.worldDefinition, retail) || !retail.open || !number(requestedQuantity) || requestedQuantity <= 0) return 0;
  // Four unsold trial units are the entire allowance without recent customers;
  // repeated calls cannot build a warehouse out of speculative demand.
  const target = Math.min(MAX_STOCK, Math.max(TRIAL_STOCK, tradeSignals(simulation, shopId).sold));
  let remaining = Math.min(Math.floor(requestedQuantity), Math.max(0, Math.floor(target - retail.inventory + EPS)));
  if (remaining <= 0) return 0;
  const wanted = remaining;
  const suppliers = state.shops.filter(shop => shop.id !== shopId && shop.districtId === retail.districtId && shop.inventory >= 1 && sourceKind(simulation.worldDefinition, shop) && simulation.shopCommodity(shop) === 'food')
    .sort((a, b) => b.inventory - a.inventory || a.id.localeCompare(b.id));
  for (const supplier of suppliers) {
    const quoted = quoteSupply(simulation, supplier.id, remaining);
    // Custody is bounded by a retailer's current observable funded sale price;
    // higher offers can be renegotiated after actual prices/demand change.
    if (quoted.unitPrice > retail.price * (1 - state.taxRate) + EPS) continue;
    const quantity = Math.floor(quoted.quantity + EPS);
    if (quantity <= 0) continue;
    supplier.inventory -= quantity; retail.inventory += quantity;
    const lots = trade.lots[retail.id] ??= [];
    const existing = lots.at(-1)?.supplierId === supplier.id && lots.at(-1)?.unitPrice === quoted.unitPrice ? lots.at(-1) : undefined;
    if (existing) existing.quantity += quantity;
    else lots.push({ id: `consignment-${trade.nextLotId++}`, supplierId: supplier.id, quantity, unitPrice: quoted.unitPrice, createdAt: clock(state) });
    trade.stats.suppliedUnits += quantity; remaining -= quantity;
    if (remaining === 0) break;
  }
  const supplied = wanted - remaining, activity = bucket(trade, retail.id, clock(state));
  activity.supplied += supplied; activity.shortages += remaining;
  return supplied;
}

interface SalePlanRow { lot: ConsignmentLot; supplier: Shop; quantity: number; gross: number }
interface OwnedPlanRow { lot: OwnedStockLot; quantity: number; cost: number }
interface SalePlan { consigned: SalePlanRow[]; owned: OwnedPlanRow[]; supplierGross: number; inventoryCost: number }
export interface SaleQuote { supplierGross: number; inventoryCost: number }
function salePlan(simulation: Simulation, shopId: string, quantity: number, beforeInventory: number): SalePlan {
  const result: SalePlan = { consigned: [], owned: [], supplierGross: 0, inventoryCost: 0 };
  const state = stateOf(simulation), trade = state.trade, retail = state.shops.find(shop => shop.id === shopId);
  if (!trade || !retail || !number(quantity) || quantity <= 0) return result;
  if (!number(beforeInventory) || beforeInventory + EPS < quantity) throw new Error('寄售销售数量超过真实售前库存。');
  if (!retailKind(simulation.worldDefinition, retail)) return result; // Producer labour was expensed when earned.
  const lots = trade.lots[retail.id] ?? [], held = unitsHeld(trade, retail.id);
  if (held > beforeInventory + EPS) throw new Error('寄售保管量超过售前库存。');
  const owned = Math.max(0, beforeInventory - held);
  if (!trade.ownedLots || Math.abs(unitsOwned(trade, shopId) - owned) > EPS) throw new Error('零售成本账本与真实售前库存不一致。');
  let ownRemaining = Math.min(quantity, owned);
  for (const lot of trade.ownedLots[shopId] ?? []) {
    const sold = Math.min(ownRemaining, lot.quantity);
    if (sold > EPS) { result.owned.push({ lot, quantity: sold, cost: sold * lot.unitPrice }); result.inventoryCost += sold * lot.unitPrice; ownRemaining -= sold; }
    if (ownRemaining <= EPS) break;
  }
  if (ownRemaining > EPS) throw new Error('零售实际购入成本不足以覆盖销售。');
  let remaining = Math.max(0, quantity - owned);
  if (remaining <= EPS) return result;
  for (const lot of lots) {
    const supplier = state.shops.find(shop => shop.id === lot.supplierId);
    if (!supplier || supplier.districtId !== retail.districtId || !custodySourceAllowed(trade, simulation.worldDefinition, supplier, lot)) throw new Error('寄售货主引用无效。');
    const sold = Math.min(remaining, lot.quantity), gross = sold * lot.unitPrice;
    if (sold > 0) { result.consigned.push({ lot, supplier, quantity: sold, gross }); result.supplierGross += gross; result.inventoryCost += gross; remaining -= sold; }
    if (remaining <= EPS) break;
  }
  if (remaining > EPS) throw new Error('寄售库存无法覆盖实际销售。');
  // Check aggregate credit before changing a lot or emitting a tax event, so a
  // capped operating account cannot silently destroy part of the buyer's cash.
  const credits = new Map<Shop, number>();
  for (const row of result.consigned) credits.set(row.supplier, (credits.get(row.supplier) ?? 0) + row.gross * (1 - state.taxRate));
  for (const [supplier, net] of credits) if (simulation.shopFunds(supplier) + net > 1e9 + EPS) throw new Error('寄售货主经营账户已达现金上限。');
  return result;
}

/** Read-only preflight before touching the customer's wallet or stock. The
 * caller checks its net receipt against this gross and its own cash capacity. */
export function quoteConsignmentSale(simulation: Simulation, shopId: string, quantity: number, beforeInventory: number): SaleQuote {
  const retail = simulation.state.shops.find(shop => shop.id === shopId);
  if (retail && Math.abs(retail.inventory - beforeInventory) > EPS) throw new Error('寄售报价需要当前真实售前库存。');
  const { supplierGross, inventoryCost } = salePlan(simulation, shopId, quantity, beforeInventory);
  return { supplierGross, inventoryCost };
}

/** Called after the buyer's debit and stock decrement, before the retailer's
 * net receipt. Owned stock sells first; the returned gross is paid out of that
 * same customer receipt, not from an extra account or a cash advance. */
export function settleConsignmentSale(simulation: Simulation, shopId: string, quantity: number, beforeInventory: number): SaleQuote {
  const state = stateOf(simulation), trade = state.trade, retail = state.shops.find(shop => shop.id === shopId), result = { supplierGross: 0, inventoryCost: 0 };
  if (!trade || !retail || !number(quantity) || quantity <= 0) return result;
  if (!number(beforeInventory) || Math.abs(retail.inventory - (beforeInventory - quantity)) > EPS) throw new Error('寄售结算需要已发生的真实库存扣减。');
  const lots = trade.lots[retail.id] ?? [], plan = salePlan(simulation, shopId, quantity, beforeInventory);
  result.supplierGross = plan.supplierGross; result.inventoryCost = plan.inventoryCost;
  for (const row of plan.owned) row.lot.quantity -= row.quantity;
  if (retailKind(simulation.worldDefinition, retail)) {
    trade.ownedLots![retail.id] = (trade.ownedLots![retail.id] ?? []).filter(lot => lot.quantity > EPS);
    if (!trade.ownedLots![retail.id].length) delete trade.ownedLots![retail.id];
  }
  const prices = trade.stats.settlementsByPrice ??= trade.stats.settledUnits > EPS ? { '4.00': trade.stats.settledUnits } : {};
  for (const row of plan.consigned) {
    row.lot.quantity -= row.quantity;
    const net = row.gross * (1 - state.taxRate);
    simulation.transferShopFunds(row.supplier, net); row.supplier.revenue += row.gross; row.supplier.profit += net;
    trade.stats.settledUnits += row.quantity; trade.stats.supplierGross += row.gross;
    const price = row.lot.unitPrice.toFixed(2); prices[price] = (prices[price] ?? 0) + row.quantity;
    simulation.emitEvent({ type: 'wholesale', shopId: row.supplier.id, districtId: retail.districtId, amount: row.gross, quantity: row.quantity });
  }
  trade.lots[retail.id] = lots.filter(lot => lot.quantity > EPS);
  if (!trade.lots[retail.id].length) delete trade.lots[retail.id];
  pruneLegacyCustody(trade);
  return result;
}

/** Unsold custody stock returns to the original supplier. Existing retailer
 * stock and all money, company IDs and earned wage obligations remain intact. */
export function returnConsignment(simulation: Simulation, shopId: string, requestedQuantity = Infinity): number {
  const state = stateOf(simulation), trade = state.trade, retail = state.shops.find(shop => shop.id === shopId);
  if (!trade || !retail || !(number(requestedQuantity) || requestedQuantity === Infinity) || requestedQuantity <= 0) return 0;
  const lots = trade.lots[retail.id] ?? [];
  if (unitsHeld(trade, shopId) > retail.inventory + EPS) throw new Error('寄售保管量超过可归还库存。');
  let remaining = Math.min(retail.inventory, Math.floor(requestedQuantity)), returned = 0;
  for (const lot of lots) {
    const supplier = state.shops.find(shop => shop.id === lot.supplierId);
    if (!supplier || !custodySourceAllowed(trade, simulation.worldDefinition, supplier, lot) || supplier.districtId !== retail.districtId) throw new Error('寄售货主引用无效。');
    const quantity = Math.min(remaining, lot.quantity, Math.max(0, Math.floor(10000 - supplier.inventory + EPS)));
    lot.quantity -= quantity; retail.inventory -= quantity; supplier.inventory += quantity; remaining -= quantity; returned += quantity;
    if (remaining <= EPS) break;
  }
  trade.stats.returnedUnits += returned; trade.lots[retail.id] = lots.filter(lot => lot.quantity > EPS);
  if (!trade.lots[retail.id].length) delete trade.lots[retail.id];
  pruneLegacyCustody(trade);
  return returned;
}

export function installTrade(simulation: Simulation): void {
  if (installed.has(simulation)) return;
  installed.add(simulation);
  const state = () => stateOf(simulation);
  restoreTrade(state(), simulation.worldDefinition);
  simulation.onPhase('time', () => {
    const trade = state().trade!, now = clock(state());
    for (const [id, rows] of Object.entries(trade.activity)) {
      const recent = rows.filter(row => row.at + BUCKET > now - WINDOW);
      if (recent.length) trade.activity[id] = recent; else delete trade.activity[id];
    }
  });
  const activity = (shopId: string | undefined, field: 'sold' | 'labor' | 'produced' | 'earnedLaborCost' | 'actualUtilities', value: number | undefined) => {
    if (!shopId || !number(value) || value <= 0 || !state().shops.some(shop => shop.id === shopId)) return;
    const row = bucket(state().trade!, shopId, clock(state())); row[field] = (row[field] ?? 0) + value;
  };
  simulation.onEvent('sale', event => activity(event.shopId, 'sold', event.quantity));
  for (const type of ['wholesale', 'public-procurement', 'security-procurement', 'emergency-procurement', 'medical-procurement', 'civic-procurement']) simulation.onEvent(type, event => {
    const supplier = state().shops.find(shop => shop.id === event.shopId);
    if (supplier && sourceKind(simulation.worldDefinition, supplier) && number(event.amount) && event.amount > 0) activity(event.shopId, 'sold', event.quantity);
  });
  simulation.onEvent('wage-earned', event => { activity(event.shopId, 'labor', event.minutes); activity(event.shopId, 'earnedLaborCost', event.amount); });
  simulation.onEvent('production', event => activity(event.shopId, 'produced', event.amount));
  simulation.onEvent('business-expense', event => activity(event.shopId, 'actualUtilities', event.amount));
  simulation.registerSaveValidator(candidate => validateTradeState(candidate, simulation.worldDefinition));
  simulation.onLoad(() => restoreTrade(state(), simulation.worldDefinition));
}

export function validateTradeState(candidate: SimState, world: WorldDefinition): void {
  const trade = (candidate as SimState & { trade?: TradeState }).trade;
  if (trade === undefined) return; // Old saves initialize an empty custody book.
  const ensure = (condition: unknown, label: string) => { if (!condition) throw new Error(`寄售存档无效：${label}。`); };
  const amount = (value: unknown, maximum = 1e12) => ensure(number(value) && value >= 0 && value <= maximum, '非有限数量');
  ensure(dictionary(trade) && (trade.version === 1 || trade.version === 2), '版本');
  const now = clock(candidate); ensure(number(now) && now >= 0, '单调时钟');
  ensure(Number.isSafeInteger(trade.nextLotId) && trade.nextLotId > 0 && trade.nextLotId <= 1e9, '批次序号');
  ensure(dictionary(trade.lots) && dictionary(trade.activity) && dictionary(trade.stats), '寄售账本');
  const shops = new Map(candidate.shops.map(shop => [shop.id, shop])), ids = new Set<string>();
  const grandfathered = new Set<string>();
  if (trade.version === 2) {
    ensure(dictionary(trade.ownedLots), '缺失零售购入成本账本');
    ensure(Array.isArray(trade.legacyIndustrialLotIds) && trade.legacyIndustrialLotIds.length <= 10000, '历史工业保管批次');
    for (const id of trade.legacyIndustrialLotIds!) { ensure(typeof id === 'string' && !grandfathered.has(id), '重复历史工业批次'); grandfathered.add(id); }
  }
  const industrialIds = new Set<string>();
  ensure(Object.keys(trade.lots).length <= shops.size && Object.keys(trade.activity).length <= shops.size, '商铺数量');
  let custody = 0;
  for (const [retailId, lots] of Object.entries(trade.lots)) {
    const retail = shops.get(retailId);
    ensure(retail && retailKind(world, retail) && Array.isArray(lots) && lots.length > 0 && lots.length <= 10000, '保管商铺');
    let total = 0;
    for (const lot of lots) {
      ensure(dictionary(lot) && typeof lot.id === 'string' && /^consignment-[1-9][0-9]*$/.test(lot.id) && Number(lot.id.slice(12)) < trade.nextLotId && !ids.has(lot.id), '批次身份'); ids.add(lot.id);
      const supplier = shops.get(lot.supplierId);
      ensure(supplier && supplier.id !== retailId && sourceKind(world, supplier) && supplier.districtId === retail!.districtId, '原货主');
      if (supplier && industrialSource(world, supplier)) {
        industrialIds.add(lot.id);
        ensure(trade.version === 1 || grandfathered.has(lot.id), '新工业货物不得寄售为食品');
      } else ensure(!grandfathered.has(lot.id), '历史工业批次货主');
      ensure(number(lot.quantity) && lot.quantity > 0 && lot.quantity <= 10000 && validPrice(lot.unitPrice), '保管数量与进价');
      ensure(number(lot.createdAt) && lot.createdAt >= 0 && lot.createdAt <= now + EPS, '批次时间'); total += lot.quantity;
    }
    ensure(total <= retail!.inventory + EPS, '保管量超过实际库存'); custody += total;
  }
  if (trade.version === 2) ensure(grandfathered.size === industrialIds.size, '历史工业批次引用');
  if (trade.ownedLots !== undefined) {
    ensure(dictionary(trade.ownedLots) && Object.keys(trade.ownedLots).length <= shops.size, '零售购入成本账本');
    for (const [shopId, lots] of Object.entries(trade.ownedLots)) {
      const shop = shops.get(shopId);
      ensure(shop && retailKind(world, shop) && Array.isArray(lots) && lots.length > 0 && lots.length <= 10000, '成本商铺');
      for (const lot of lots) {
        ensure(dictionary(lot) && number(lot.quantity) && lot.quantity > 0 && lot.quantity <= 10000 && validPrice(lot.unitPrice), '购入成本数量与进价');
        ensure(number(lot.createdAt) && lot.createdAt >= 0 && lot.createdAt <= now + EPS, '购入时间');
      }
    }
    for (const shop of shops.values()) if (retailKind(world, shop)) ensure(Math.abs(unitsOwned(trade, shop.id) + unitsHeld(trade, shop.id) - shop.inventory) <= EPS, '零售成本数量与库存守恒');
  }
  for (const [shopId, rows] of Object.entries(trade.activity)) {
    ensure(shops.has(shopId) && Array.isArray(rows) && rows.length > 0 && rows.length <= WINDOW / BUCKET + 1, '近期活动');
    let previous = -Infinity;
    for (const row of rows) {
      ensure(dictionary(row) && number(row.at) && row.at >= 0 && row.at <= now + EPS && row.at > previous && Math.abs(row.at / BUCKET - Math.round(row.at / BUCKET)) <= EPS, '活动时间'); previous = row.at;
      for (const field of ['sold', 'supplied', 'labor', 'produced', 'shortages'] as const) amount(row[field]);
      for (const field of ['earnedLaborCost', 'actualUtilities'] as const) if (row[field] !== undefined) amount(row[field]);
      for (const field of ['supplied', 'shortages'] as const) ensure(Number.isSafeInteger(row[field]), '活动单位');
    }
  }
  for (const field of ['suppliedUnits', 'settledUnits', 'returnedUnits', 'supplierGross'] as const) amount(trade.stats[field]);
  ensure(Number.isSafeInteger(trade.stats.suppliedUnits), '累计供货单位');
  ensure(Math.abs(trade.stats.suppliedUnits - trade.stats.settledUnits - trade.stats.returnedUnits - custody) <= EPS, '货物所有权守恒');
  if (trade.stats.settlementsByPrice === undefined) ensure(Math.abs(trade.stats.supplierGross - trade.stats.settledUnits * UNIT_PRICE) <= EPS, '旧批次实收金额');
  else {
    ensure(dictionary(trade.stats.settlementsByPrice) && Object.keys(trade.stats.settlementsByPrice).length <= 10000, '冻结成交报价汇总');
    let units = 0, value = 0;
    for (const [price, quantity] of Object.entries(trade.stats.settlementsByPrice)) {
      const rate = Number(price); ensure(validPrice(rate) && rate.toFixed(2) === price, '成交报价'); amount(quantity); ensure(quantity > 0, '成交报价单位'); units += quantity; value += quantity * rate;
    }
    const close = (a: number, b: number) => Math.abs(a - b) <= EPS + Number.EPSILON * 64 * Math.max(1, Math.abs(a), Math.abs(b));
    ensure(close(units, trade.stats.settledUnits) && close(value, trade.stats.supplierGross), '实收单位与冻结报价金额');
  }
}
