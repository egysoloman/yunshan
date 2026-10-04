import type { Simulation } from '../simulation';
import type { Building, Citizen, Company, Command, CommandResult, Player, Role, Shop, SimState, WorldDefinition } from '../types';
import { homeRestPointBlockedByVoxels } from './home-rest';

const EPS = 1e-7, CASH_CAP = 1e9, REGISTER_FEE = 50, CAPITAL = 200, RESERVE = 100;
export const SHOP_REOPEN_MINUTES = 60;
export const SHOP_LEASE_PERIOD = 1440;
export interface ShopListing {
  id: string; shopId: string; sellerId: string; kind: 'sale' | 'lease'; price: number;
  deposit: number; leasePeriods: number; createdAt: number; expiresAt: number;
  state: 'offered' | 'withdrawn' | 'expired' | 'accepted'; acceptedBy: string | null; acceptedAt: number | null;
}
export interface ShopLease {
  id: string; listingId: string; shopId: string; lessorId: string; tenantId: string;
  rent: number; periods: number; startedAt: number; endsAt: number; nextDueAt: number;
  accruedPeriods: number; accruedRent: number; paidRent: number; arrears: number;
  depositInitial: number; depositEscrow: number; depositToLessor: number; depositRefunded: number;
  advanceInitial: number; advanceRefunded: number; state: 'active' | 'defaulted' | 'ended'; endedAt: number | null;
}
interface StockPurchase { supplierId: string; quantity: number; unitPrice: number; gross: number; net: number; taxRate: number; commodity: 'food' | 'materials' }
export interface ShopReopenJob {
  operatorId: string; startedAt: number; completedAt: number | null; cancelledAt: number | null; workedMinutes: number;
  materialFromExistingStock: boolean;
  materialUnits: 1; consumedUnits: 0 | 1; purchases: StockPurchase[];
  labor: { citizenId: string; minutes: number; earned: number; lastAt: number }[];
}
export interface ShopCompanyBinding {
  release?: { at: number; inventory: number; materials: number; employees: number; capital: number; wageDebt: 0; committedPayroll: 0 };
  companyId: string; founderId: string; registeredAt: number; leaseId: string | null;
  openingCash: number; capitalFunding: number;
  // A tenant cannot convert the landlord's pre-existing cash into shareholder equity.
  ownerCashReserved: number; ownerCashEscrow: number; ownerCashReturned: number;
}
export interface ShopOperatingTitle {
  corporationHistory?: ShopCompanyBinding[];
  corporation?: ShopCompanyBinding;
  shopId: string; buildingId: string;
  /** An existing operating asset and its pre-existing site permission, never building/land ownership. */
  scope: 'existing-business-and-site-use'; legacyOwnerId: string; assetOwnerId: string;
  state: 'operating' | 'suspended' | 'reopening'; suspendedAt: number | null;
  reason: 'voluntary' | 'economic-distress' | 'lease-ended' | 'lease-default' | '';
  listingId: string | null; leaseId: string | null; materialsHeld: number; reopen: ShopReopenJob | null; reopenHistory: ShopReopenJob[];
}
export interface ShopLifecycleReceipt {
  siteReturn?: NonNullable<ShopCompanyBinding['release']> & { companyId: string };
  id: number; at: number; shopId: string; actorId: string; payeeId: string;
  kind: 'sale' | 'lease-start' | 'capital' | 'rent' | 'deposit-offset' | 'deposit-refund' | 'advance-refund' | 'reopen' | 'incorporation' | 'corporate-owner-cash-return' | 'corporate-site-return';
  amount: number; listingId: string | null; leaseId: string | null;
}
export interface ShopLifecycleState {
  version: 1; nextListingId: number; nextLeaseId: number; nextReceiptId: number;
  titles: Record<string, ShopOperatingTitle>; listings: ShopListing[]; leases: ShopLease[]; receipts: ShopLifecycleReceipt[];
}
type LifecycleState = SimState & { shopLifecycle?: ShopLifecycleState };
const stateOf = (simulation: Simulation): LifecycleState => simulation.state;
const clock = (state: SimState) => state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const dictionary = (n: unknown): n is Record<string, unknown> => !!n && typeof n === 'object' && !Array.isArray(n);
const same = (a: number, b: number) => Math.abs(a - b) <= EPS;
const actor = (state: SimState, id: string): Citizen | Player | undefined => id === 'player' ? state.player : state.citizens.find(person => person.id === id);
const titleOf = (state: SimState, shopId: string) => (state as LifecycleState).shopLifecycle?.titles[shopId];
const leasesFor = (state: SimState, shopId: string) => (state as LifecycleState).shopLifecycle?.leases.filter(lease => lease.shopId === shopId) ?? [];
const activeLease = (state: SimState, shopId: string) => leasesFor(state, shopId).find(lease => lease.state !== 'ended');
const live = (state: SimState, id: string) => !!actor(state, id) && state.extension?.actorProfiles[id]?.alive === true;
const eligible = (state: SimState, id: string) => {
  const person = actor(state, id), profile = state.extension?.actorProfiles[id];
  return !!person && !!profile && profile.alive && profile.age >= 18 && profile.health >= 45
    && person.needs.hunger >= 40 && person.needs.fatigue >= 35
    && (id === 'player' ? [state.player.role, ...(state.player.identities ?? [])].includes('merchant')
      : ['merchant', '商人', '工人', '农民', '搬运工', '钱庄职员'].includes((person as Citizen).role) && profile.skill >= 45 && ((person as Citizen).education ?? 0) >= 1);
};
const eligibleOperator = (state: SimState, id: string) => {
  const person = actor(state, id), profile = state.extension?.actorProfiles[id];
  return !!person && !!profile && profile.alive && profile.age >= 18 && profile.health >= 45 && person.needs.hunger >= 40 && person.needs.fatigue >= 35
    && (id === 'player' ? [state.player.role, ...(state.player.identities ?? [])].includes('merchant') : ['merchant', '商人'].includes((person as Citizen).role));
};
const merchantPerson = (state: SimState, id: string): Pick<Player, 'role' | 'identities'> => id === 'player' ? state.player : { role: ['商人', 'merchant'].includes((actor(state, id) as Citizen).role) ? 'merchant' : 'traveler', identities: [['商人', 'merchant'].includes((actor(state, id) as Citizen).role) ? 'merchant' : 'traveler'] as Role[] };
const onsite = (simulation: Simulation, shop: Shop, id: string) => {
  const person = actor(simulation.state, id), site = simulation.worldDefinition.buildings.find(site => site.id === shop.buildingId);
  return !!person && !!site && (id !== 'player' || !simulation.state.player.vehicleId && !simulation.state.aviation?.activeAircraftId)
    && simulation.isNearBuilding(site, person.position, 2)
    && simulation.isAtBuildingFunctionPoint(site, person.position, 'work', merchantPerson(simulation.state, id))
    && !homeRestPointBlockedByVoxels(person.position, simulation.state.voxels);
};
const privateMarket = (state: SimState, world: WorldDefinition, shop: Shop) => {
  const site = world.buildings.find(site => site.id === shop.buildingId);
  const company = state.extension?.companies.find(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop.buildingId);
  return site?.kind === 'market' && !site.facility && (!company || company.shopBindingId === shop.id && titleOf(state, shop.id)?.corporation?.companyId === company.id);
};
const empty = (): ShopLifecycleState => ({ version: 1, nextListingId: 1, nextLeaseId: 1, nextReceiptId: 1, titles: {}, listings: [], leases: [], receipts: [] });
function moduleOf(simulation: Simulation): ShopLifecycleState { return stateOf(simulation).shopLifecycle ??= empty(); }
function ensureTitle(simulation: Simulation, shop: Shop): ShopOperatingTitle | undefined {
  if (!privateMarket(simulation.state, simulation.worldDefinition, shop) || !shop.ownerId) return undefined;
  const lifecycle = moduleOf(simulation);
  shop.lifecycleVersion = 1;
  return lifecycle.titles[shop.id] ??= { shopId: shop.id, buildingId: shop.buildingId, scope: 'existing-business-and-site-use', legacyOwnerId: shop.ownerId, assetOwnerId: shop.ownerId, state: 'operating', suspendedAt: null, reason: '', listingId: null, leaseId: null, materialsHeld: 0, reopen: null, reopenHistory: [] };
}
const boundCompany = (state: SimState, shopId: string) => {
  const binding = titleOf(state, shopId)?.corporation;
  return binding && state.extension?.companies.find(company => company.id === binding.companyId && company.shopBindingId === shopId);
};
const operatorId = (state: SimState, shop: Shop) => boundCompany(state, shop.id)?.ownerId ?? shop.ownerId;
const bindingLeaseAllowsUse = (state: SimState, shopId: string) => {
  const binding = titleOf(state, shopId)?.corporation;
  if (!binding?.leaseId) return true;
  const lease = leasesFor(state, shopId).find(lease => lease.id === binding.leaseId), company = boundCompany(state, shopId);
  return !!lease && !!company && lease.state === 'active' && clock(state) < lease.endsAt && live(state, lease.tenantId) && live(state, lease.lessorId)
    && (company.shareholders[lease.tenantId] ?? 0) > company.shares / 2;
};
export function shopLifecycleAssetOwnerId(state: SimState, shop: Shop): string | undefined {
  const title = titleOf(state, shop.id);
  return title?.corporation && !title.corporation.leaseId ? title.corporation.companyId : title?.assetOwnerId ?? shop.ownerId;
}
export function shopLifecycleAllowsOperation(state: SimState, shopId: string): boolean {
  const title = titleOf(state, shopId), lease = activeLease(state, shopId);
  return bindingLeaseAllowsUse(state, shopId) && (!title || title.state === 'operating') && (!lease || lease.state === 'active' && clock(state) < lease.endsAt && live(state, lease.tenantId) && live(state, lease.lessorId));
}
export function shopLifecycleAllowsNewPayroll(state: SimState, shopId: string): boolean {
  const title = titleOf(state, shopId), lease = activeLease(state, shopId);
  return bindingLeaseAllowsUse(state, shopId) && (!title || title.state !== 'suspended') && (!lease || lease.state === 'active' && clock(state) < lease.endsAt && live(state, lease.tenantId) && live(state, lease.lessorId));
}
export function shopLifecycleAllowsSpaceUse(state: SimState, shopId: string): boolean {
  const lease = activeLease(state, shopId);
  return bindingLeaseAllowsUse(state, shopId) && (!lease || lease.state === 'active' && clock(state) < lease.endsAt && live(state, lease.tenantId) && live(state, lease.lessorId));
}
export function shopLifecycleReservedFunds(state: SimState, shopId: string): number {
  return leasesFor(state, shopId).reduce((total, lease) => total + lease.arrears
    + (lease.state !== 'ended' && lease.nextDueAt < lease.endsAt ? lease.rent : 0)
    + (lease.state === 'ended' ? Math.max(0, lease.advanceInitial - lease.advanceRefunded) : 0), 0);
}
export function shopLifecycleHeldCash(state: SimState): number { const lifecycle = (state as LifecycleState).shopLifecycle; return (lifecycle?.leases.reduce((sum, lease) => sum + lease.depositEscrow, 0) ?? 0) + Object.values(lifecycle?.titles ?? {}).reduce((sum, title) => sum + (title.corporation?.ownerCashEscrow ?? 0), 0); }
export function shopLifecyclePendingEstateAssets(state: SimState, actorId: string): boolean {
  return Object.values((state as LifecycleState).shopLifecycle?.titles ?? {}).some(title => title.assetOwnerId === actorId && (!title.corporation || title.corporation.leaseId !== null))
    || !!(state as LifecycleState).shopLifecycle?.leases.some(lease => lease.tenantId === actorId && (lease.depositEscrow > EPS || lease.advanceInitial - lease.advanceRefunded > EPS)
    || lease.lessorId === actorId && (lease.state !== 'ended' || lease.arrears > EPS));
}
/** The family executor must not sell a tenant's landlord-owned assets, or end a live contract by overwriting ownerId. */
export function shopLifecycleCanDispose(state: SimState, shopId: string): boolean {
  return !titleOf(state, shopId)?.corporation && !leasesFor(state, shopId).some(lease => lease.state !== 'ended' || lease.arrears > EPS || lease.depositEscrow > EPS || lease.advanceInitial - lease.advanceRefunded > EPS);
}
/** Called only by the core authority-changing method; lawful executor transfers retain the same shop and debts. */
export function shopLifecycleBeforeBusinessTransfer(simulation: Simulation, shop: Shop, newOwnerId: string): boolean {
  const title = titleOf(simulation.state, shop.id); if (!title) return true;
  const lease = activeLease(simulation.state, shop.id);
  if (title.corporation) return lease ? newOwnerId === lease.tenantId : newOwnerId === (title.corporation.leaseId ? title.assetOwnerId : boundCompany(simulation.state, shop.id)?.ownerId);
  if (lease) return newOwnerId === lease.tenantId;
  if (newOwnerId === title.assetOwnerId) return true;
  const oldOwner = title.assetOwnerId, estate = simulation.state.family?.estates[oldOwner];
  if (!live(simulation.state, oldOwner) && shopLifecycleCanDispose(simulation.state, shop.id)
    && (estate?.heirIds.includes(newOwnerId) || simulation.state.family?.estateSales.some(sale => sale.kind === 'business' && sale.assetId === shop.id && sale.deceasedId === oldOwner && sale.state === 'offered'))) {
    title.assetOwnerId = newOwnerId;
    if (title.listingId) { const listing = stateOf(simulation).shopLifecycle!.listings.find(listing => listing.id === title.listingId); if (listing?.state === 'offered') listing.state = 'withdrawn'; title.listingId = null; }
    return true;
  }
  return false;
}
export function shopLifecycleMayIncorporate(state: SimState, shop: Shop, actorId: string): boolean {
  const title = titleOf(state, shop.id), lease = activeLease(state, shop.id);
  if (title?.corporation || shop.ownerId !== actorId || title?.listingId || title?.state === 'reopening') return false;
  if (!title) return shopLifecycleCanDispose(state, shop.id);
  return lease ? lease.tenantId === actorId && lease.state === 'active' && clock(state) < lease.endsAt && live(state, lease.lessorId) && live(state, lease.tenantId)
    : title.assetOwnerId === actorId && shopLifecycleCanDispose(state, shop.id);
}
/** No title means the original legacy registration remains unchanged. */
export function shopLifecycleCanFundIncorporation(simulation: Simulation, shop: Shop, actorId: string, capital: number): boolean {
  const state = simulation.state, title = titleOf(state, shop.id); if (!title) return true;
  const lease = activeLease(state, shop.id), opening = shop.cash ?? 0;
  const reserved = lease ? Math.max(0, opening - (lease.advanceInitial - lease.advanceRefunded)) : 0;
  return shopLifecycleMayIncorporate(state, shop, actorId) && finite(opening) && opening >= 0 && capital + opening - reserved <= CASH_CAP && capital + opening - reserved + EPS >= simulation.shopProtectedFunds(shop)
    && state.treasury + REGISTER_FEE <= 1e12 && (state as LifecycleState).shopLifecycle!.receipts.length < 4096;
}
/** Called after preflight and the actual founder debit, before adding this one company. */
export function shopLifecycleBindCompany(simulation: Simulation, shop: Shop, company: Company): number | null {
  const title = titleOf(simulation.state, shop.id); if (!title) return null;
  const lease = activeLease(simulation.state, shop.id), opening = shop.cash ?? 0, funding = company.capital;
  const reserved = lease ? Math.max(0, opening - (lease.advanceInitial - lease.advanceRefunded)) : 0;
  title.corporation = { companyId: company.id, founderId: company.ownerId, registeredAt: clock(simulation.state), leaseId: lease?.id ?? null,
    openingCash: opening, capitalFunding: funding, ownerCashReserved: reserved, ownerCashEscrow: reserved, ownerCashReturned: 0 };
  company.shopBindingId = shop.id; shop.cash = 0;
  receipt(simulation, shop.id, company.ownerId, company.id, 'incorporation', funding + opening - reserved, null, lease?.id ?? null);
  simulation.emitEvent({ type: 'company-incorporated', citizenId: company.ownerId, shopId: shop.id, amount: funding, districtId: shop.districtId });
  return opening - reserved;
}
/** A personal lease is not transferable by silently changing the company shell. */
export function shopLifecycleAllowsShareholding(state: SimState, company: Company, holdings: Record<string, number>, shares = company.shares): boolean {
  if (!company.shopBindingId || company.shopBindingReleasedAt !== undefined) return true;
  const binding = titleOf(state, company.shopBindingId)?.corporation;
  if (!binding?.leaseId) return true;
  const lease = leasesFor(state, company.shopBindingId).find(lease => lease.id === binding.leaseId);
  // Death and an ended permit do not prevent a lawful estate/share transfer, but never restore site use.
  return !lease || lease.state === 'ended' || !live(state, lease.tenantId) || !live(state, lease.lessorId)
    || (holdings[lease.tenantId] ?? 0) > shares / 2;
}

function receipt(simulation: Simulation, shopId: string, actorId: string, payeeId: string, kind: ShopLifecycleReceipt['kind'], amount: number, listingId: string | null = null, leaseId: string | null = null): void {
  const lifecycle = moduleOf(simulation);
  lifecycle.receipts.push({ id: lifecycle.nextReceiptId++, at: clock(simulation.state), shopId, actorId, payeeId, kind, amount, listingId, leaseId });
}
const fail = (message: string): CommandResult => ({ ok: false, message });
const success = (message: string): CommandResult => ({ ok: true, message });
function suspend(simulation: Simulation, shop: Shop, actorId: string, reason: ShopOperatingTitle['reason']): CommandResult {
  if (!privateMarket(simulation.state, simulation.worldDefinition, shop) || operatorId(simulation.state, shop) !== actorId || !live(simulation.state, actorId) || (simulation.state.extension?.actorProfiles[actorId]?.age ?? 0) < 18 || !onsite(simulation, shop, actorId)) return fail('只有现经营者能在原市集工作点办理停业，公司须走股权与清算程序。');
  const title = ensureTitle(simulation, shop)!;
  if (title.state === 'reopening') return fail('修缮合同尚未完成，不能抹去已购物料与真实工资。');
  title.state = 'suspended'; title.suspendedAt ??= clock(simulation.state); title.reason = reason; shop.open = false;
  return success('已暂停新经营；原库存货权、员工合同、欠薪、历史收支仍由这间店保留。');
}
function list(simulation: Simulation, shop: Shop, actorId: string, kind: ShopListing['kind'], price: number): CommandResult {
  if (!finite(price) || price < 1 || price > 100000 || !privateMarket(simulation.state, simulation.worldDefinition, shop)
    || operatorId(simulation.state, shop) !== actorId || !live(simulation.state, actorId) || (simulation.state.extension?.actorProfiles[actorId]?.age ?? 0) < 18 || !onsite(simulation, shop, actorId)
    || titleOf(simulation.state, shop.id)?.corporation || !shopLifecycleCanDispose(simulation.state, shop.id)) return fail('挂牌需要原经营资产持有人的现场同意，金额1–100000文，且原租约及垫款先结清。');
  const existingTitle = titleOf(simulation.state, shop.id);
  if (!existingTitle || existingTitle.assetOwnerId !== actorId || existingTitle.state !== 'suspended') return fail('请先由原经营者实际停业；夜间或断电关门不能代替停业授权。');
  if ((stateOf(simulation).shopLifecycle?.listings.length ?? 0) >= 256 || (stateOf(simulation).shopLifecycle?.receipts.length ?? 0) >= 4000) return fail('经营登记档案已满，请保留现有权利等待处理。');
  const title = ensureTitle(simulation, shop)!;
  if (title.listingId) return fail('已有挂牌，先撤回原报价。');
  const lifecycle = moduleOf(simulation), listing: ShopListing = { id: `shop-listing-${lifecycle.nextListingId++}`, shopId: shop.id, sellerId: actorId, kind, price, deposit: kind === 'lease' ? price * 2 : 0, leasePeriods: kind === 'lease' ? 7 : 0, createdAt: clock(simulation.state), expiresAt: clock(simulation.state) + 3 * SHOP_LEASE_PERIOD, state: 'offered', acceptedBy: null, acceptedAt: null };
  lifecycle.listings.push(listing); title.listingId = listing.id;
  simulation.appendNotice('shop-listing', `${simulation.worldDefinition.buildings.find(site => site.id === shop.buildingId)!.name}由资产持有人授权${kind === 'sale' ? `转让，价${price}文` : `出租，每日${price}文、押金${listing.deposit}文、七日租期`}；原债与寄售货主保留。`, shop.districtId);
  return success('已登记本人同意的有限期报价；租赁限既有经营资产与同址经营委托，不授予楼宇或土地所有权。');
}
function acquire(simulation: Simulation, listing: ShopListing, buyerId: string, capital: number): CommandResult {
  const state = simulation.state, shop = state.shops.find(shop => shop.id === listing.shopId), title = shop && titleOf(state, shop.id), buyer = actor(state, buyerId), seller = actor(state, listing.sellerId), at = clock(state);
  if (!shop || !title || !buyer || !seller || !privateMarket(state, simulation.worldDefinition, shop)
    || listing.state !== 'offered' || listing.expiresAt <= at || title.listingId !== listing.id || title.assetOwnerId !== listing.sellerId
    || shop.ownerId !== listing.sellerId || title.state !== 'suspended' || buyerId === listing.sellerId || !live(state, listing.sellerId) || (state.extension?.actorProfiles[listing.sellerId]?.age ?? 0) < 18
    || !eligible(state, buyerId) || !onsite(simulation, shop, buyerId) || !shopLifecycleCanDispose(state, shop.id)
    || !finite(capital) || capital < CAPITAL || capital > 100000) return fail('报价、原持有人同意、成年经营资格、现场权限或营运注资条件不成立。');
  const debit = listing.price + listing.deposit + REGISTER_FEE + capital;
  // Every credit is checked before the first debit, receipt or authority mutation.
  if (buyer.money < debit + RESERVE || seller.money + listing.price > CASH_CAP || simulation.shopFunds(shop) + capital > CASH_CAP
    || state.treasury + REGISTER_FEE > 1e12 || (stateOf(simulation).shopLifecycle!.receipts.length + 3 > 4096)
    || listing.kind === 'lease' && stateOf(simulation).shopLifecycle!.leases.length >= 128) return fail('需保留100文生活储备；付款不足或任一收款/登记账户容量不足，交割全部拒绝。');
  buyer.money -= debit; seller.money += listing.price; state.treasury += REGISTER_FEE; simulation.transferShopFunds(shop, capital);
  listing.state = 'accepted'; listing.acceptedBy = buyerId; listing.acceptedAt = at; title.listingId = null;
  if (listing.kind === 'sale') title.assetOwnerId = buyerId;
  else {
    const lifecycle = moduleOf(simulation), lease: ShopLease = { id: `shop-lease-${lifecycle.nextLeaseId++}`, listingId: listing.id, shopId: shop.id, lessorId: listing.sellerId, tenantId: buyerId, rent: listing.price, periods: listing.leasePeriods, startedAt: at, endsAt: at + listing.leasePeriods * SHOP_LEASE_PERIOD, nextDueAt: at + SHOP_LEASE_PERIOD, accruedPeriods: 1, accruedRent: listing.price, paidRent: listing.price, arrears: 0, depositInitial: listing.deposit, depositEscrow: listing.deposit, depositToLessor: 0, depositRefunded: 0, advanceInitial: capital, advanceRefunded: 0, state: 'active', endedAt: null };
    lifecycle.leases.push(lease); title.leaseId = lease.id; shop.profit -= listing.price;
  }
  // The core method updates player permission mirrors; none of its economic contracts are rebuilt.
  simulation.transferBusinessOwnership(shop.id, buyerId);
  if (buyerId !== 'player') { const citizen = buyer as Citizen; citizen.workId = shop.buildingId; citizen.role = 'merchant'; }
  receipt(simulation, shop.id, buyerId, listing.sellerId, listing.kind === 'sale' ? 'sale' : 'lease-start', listing.price, listing.id, title.leaseId);
  receipt(simulation, shop.id, buyerId, shop.id, 'capital', capital, listing.id, title.leaseId);
  receipt(simulation, shop.id, buyerId, 'public', 'capital', REGISTER_FEE, listing.id, title.leaseId);
  simulation.emitEvent({ type: 'shop-contract-accepted', citizenId: buyerId, shopId: shop.id, amount: listing.price, districtId: shop.districtId });
  return success(`真实${listing.kind === 'sale' ? '买价已付卖方' : '首期租金已付出租人，押金独立托管'}，${capital}文另入原经营账户；仍须真实采购、工资授权与60分钟员工修缮后重开。`);
}
function restart(simulation: Simulation, shop: Shop, operatorActorId: string, fundFromWallet = false): CommandResult {
  const state = simulation.state, title = titleOf(state, shop.id), lease = activeLease(state, shop.id), at = clock(state);
  if (!title || !privateMarket(state, simulation.worldDefinition, shop) || title.state !== 'suspended' || title.listingId || operatorId(state, shop) !== operatorActorId
    || !eligibleOperator(state, operatorActorId) || !onsite(simulation, shop, operatorActorId) || lease?.state === 'defaulted' || !shopLifecycleAllowsSpaceUse(state, shop.id)) return fail('请由合资格现经营者在原工作点申请重开；挂牌与违约租约须先处理。');
  if (title.reopenHistory.length >= 32) return fail('修缮历史档案已满，保留原物料和劳动记录等待处理。');
  const roster = state.citizens.filter(citizen => citizen.workId === shop.buildingId && citizen.role !== '学生' && live(state, citizen.id) && (state.extension!.actorProfiles[citizen.id].age >= 18));
  if (!roster.length || shop.employees < 1) return fail('没有实际在册成年员工；先取得合法员工合同，不能凭空生成劳工。');
  const purchases: StockPurchase[] = [], neededFood = Math.max(0, 2 - shop.inventory);
  for (const [commodity, quantityNeeded] of [['materials', title.materialsHeld >= 1 ? 0 : 1], ['food', neededFood]] as const) {
    if (quantityNeeded <= EPS) continue;
    let remaining = quantityNeeded;
    for (const supplier of state.shops.filter(other => other.id !== shop.id && other.districtId === shop.districtId && ['farm', 'workshop', 'dock'].includes(simulation.worldDefinition.buildings.find(site => site.id === other.buildingId)?.kind ?? '') && simulation.shopCommodity(other) === commodity).sort((a, b) => b.inventory - a.inventory || a.id.localeCompare(b.id))) {
      const quote = simulation.quoteSupply(supplier.id, remaining), quantity = Math.min(remaining, quote.quantity);
      if (!(quantity > EPS)) continue;
      const gross = quantity * quote.unitPrice, net = gross * (1 - state.taxRate);
      if (simulation.shopFunds(supplier) + net > CASH_CAP || supplier.revenue + gross > 1e12) return fail('实际供应者收款或流水容量不足，采购全部拒绝。');
      purchases.push({ supplierId: supplier.id, quantity, unitPrice: quote.unitPrice, gross, net, taxRate: state.taxRate, commodity }); remaining -= quantity;
      if (remaining <= EPS) break;
    }
    if (remaining > EPS || commodity === 'materials' && remaining > 0) return fail('本区真实有限物料或食品不足，不能生成重开用品。');
  }
  const gross = purchases.reduce((sum, row) => sum + row.gross, 0), tax = purchases.reduce((sum, row) => sum + row.gross - row.net, 0);
  const funds = simulation.shopFunds(shop), protectedFunds = simulation.shopProtectedFunds(shop), required = gross + 20 * 8 / 24;
  if (state.treasury + tax > 1e12) return fail('工资、租金与旧债受保护；实际采购后仍须保留营运现金。');
  if (funds - protectedFunds < required) {
    if (!fundFromWallet) return fail('工资、租金与旧债受保护；实际采购后仍须保留营运现金。');
    // A resident can choose one real wallet contribution after all procurement
    // checks. Round up to cents, then check the same addition used by fundShop:
    // cancellation against a large protected balance can otherwise lose an ulp.
    const cents = Math.ceil((required - (funds - protectedFunds)) * 100);
    let contribution = cents / 100;
    if (funds + contribution - protectedFunds < required || funds + contribution - gross - protectedFunds < 20 * 8 / 24) contribution = (cents + 1) / 100;
    const operator = actor(state, operatorActorId)!;
    if (operator.money - contribution < RESERVE) return fail('本人钱包补足真实采购和原受保护余额后仍须保留100文生活储备。');
    const funded = applyShopLifecycleCommand(simulation, { type: 'fundShop', targetId: shop.id, value: contribution }, operatorActorId)!;
    if (!funded.ok) return funded;
    // fundShop has no event callback. It preserves this active lease's reserve;
    // no further rejecting preflight follows the successful wallet transfer.
  }
  simulation.transferShopFunds(shop, -gross);
  for (const row of purchases) {
    const supplier = state.shops.find(supplier => supplier.id === row.supplierId)!;
    supplier.inventory -= row.quantity; simulation.transferShopFunds(supplier, row.net); supplier.revenue += row.gross; supplier.profit += row.net;
    simulation.emitEvent({ type: 'wholesale', shopId: supplier.id, districtId: supplier.districtId, amount: row.gross, quantity: row.quantity, unitPrice: row.unitPrice });
    if (row.commodity === 'food') { shop.inventory += row.quantity; simulation.recordOwnedStockPurchase(shop.id, row.quantity, row.unitPrice); }
  }
  shop.profit -= purchases.filter(row => row.commodity === 'materials').reduce((sum, row) => sum + row.gross, 0);
  if (title.reopen) title.reopenHistory.push(title.reopen);
  const reusedMaterial = title.materialsHeld >= 1;
  title.materialsHeld += purchases.filter(row => row.commodity === 'materials').reduce((sum, row) => sum + row.quantity, 0);
  title.reopen = { operatorId: operatorActorId, startedAt: at, completedAt: null, cancelledAt: null, workedMinutes: 0, materialFromExistingStock: reusedMaterial, materialUnits: 1, consumedUnits: 0, purchases, labor: [] };
  title.state = 'reopening'; shop.open = false;
  return success('真实物料已购入独立修缮库存、食品按原货权入账；等待已授权员工实际工作60分钟。');
}

function settleRent(simulation: Simulation, lease: ShopLease): boolean {
  const shop = simulation.state.shops.find(shop => shop.id === lease.shopId)!, lessor = actor(simulation.state, lease.lessorId)!;
  const reserve = simulation.shopProtectedFunds(shop) - shopLifecycleReservedFunds(simulation.state, shop.id);
  const amount = Math.min(lease.arrears, Math.max(0, simulation.shopFunds(shop) - reserve));
  if (!(amount > EPS) || lessor.money + amount > CASH_CAP || stateOf(simulation).shopLifecycle!.receipts.length >= 4096) return false;
  simulation.transferShopFunds(shop, -amount); lessor.money += amount; lease.arrears -= amount; lease.paidRent += amount;
  receipt(simulation, shop.id, lease.tenantId, lease.lessorId, 'rent', amount, lease.listingId, lease.id);
  return true;
}
/** Return only the rented operating asset. Corporate capital and shares are
 * retained; the inventory was always the same landlord-owned shop's stock,
 * and a company's inventory/employees were mirrors, never another asset pool.
 * Old employer claims are shop-addressed, so they must actually clear before
 * switching that shop's operating account to its returned owner's account. */
function returnCorporateSite(simulation: Simulation, lease: ShopLease): void {
  const state = simulation.state, shop = state.shops.find(shop => shop.id === lease.shopId)!, title = titleOf(state, shop.id)!, binding = title.corporation;
  if (!binding || binding.leaseId !== lease.id || lease.state !== 'ended' || lease.arrears > EPS || lease.depositEscrow > EPS || lease.advanceInitial - lease.advanceRefunded > EPS || binding.ownerCashEscrow > EPS
    || simulation.shopPayrollDebt(shop) > EPS || simulation.shopCommittedPayroll(shop) > EPS || state.playerLabor?.job?.employer.shopId === shop.id || (title.corporationHistory?.length ?? 0) >= 128 || stateOf(simulation).shopLifecycle!.receipts.length >= 4096) return;
  const company = boundCompany(state, shop.id)!, construction = Reflect.get(state.extension!, 'runtime').constructionJobs?.[company.id];
  if (construction && construction.completedAt === null) return;
  binding.release = { at: clock(state), inventory: shop.inventory, materials: title.materialsHeld, employees: shop.employees, capital: company.capital, wageDebt: 0, committedPayroll: 0 };
  company.shopBindingReleasedAt = binding.release.at; company.inventory = 0; company.employees = 0;
  (title.corporationHistory ??= []).push(binding); delete title.corporation;
  // Original goods, costs, histories and names remain on the returned shop.
  // No money is transferred from this separate company's retained capital.
  simulation.transferBusinessOwnership(shop.id, title.assetOwnerId);
  receipt(simulation, shop.id, lease.tenantId, lease.lessorId, 'corporate-site-return', 0, null, lease.id);
  stateOf(simulation).shopLifecycle!.receipts.at(-1)!.siteReturn = { companyId: company.id, ...binding.release };
  simulation.emitEvent({ type: 'corporate-site-returned', shopId: shop.id, citizenId: title.assetOwnerId, districtId: shop.districtId, quantity: shop.inventory });
}
function endLease(simulation: Simulation, lease: ShopLease): CommandResult {
  const state = simulation.state, shop = state.shops.find(shop => shop.id === lease.shopId)!, title = titleOf(state, shop.id)!, lessor = actor(state, lease.lessorId)!, tenant = actor(state, lease.tenantId)!;
  if (lease.state === 'ended') return fail('租约已解除，押金与垫款不能重复退款。');
  const offset = Math.min(lease.depositEscrow, lease.arrears), refund = lease.depositEscrow - offset;
  const binding = title.corporation, ownerRefund = binding?.ownerCashEscrow ?? 0;
  if (lessor.money + offset + ownerRefund > CASH_CAP || tenant.money + refund > CASH_CAP || stateOf(simulation).shopLifecycle!.receipts.length + 3 > 4096) return fail('押金的任一实际收款账户容量不足，解除及全部退款原子拒绝。');
  lessor.money += offset + ownerRefund; tenant.money += refund;
  if (binding) { binding.ownerCashEscrow = 0; binding.ownerCashReturned += ownerRefund; }; lease.depositEscrow = 0; lease.depositToLessor += offset; lease.depositRefunded += refund; lease.arrears -= offset; lease.paidRent += offset;
  if (title.reopen?.completedAt === null && title.reopen.cancelledAt === null) title.reopen.cancelledAt = clock(state);
  lease.state = 'ended'; lease.endedAt = clock(state); title.leaseId = null; title.state = 'suspended'; title.reason = 'lease-ended'; title.suspendedAt = clock(state); shop.open = false;
  // Tenant advances are retained as a real subordinate claim, never silently gifted to the owner.
  simulation.transferBusinessOwnership(shop.id, title.assetOwnerId);
  if (ownerRefund > EPS) receipt(simulation, shop.id, lease.tenantId, lease.lessorId, 'corporate-owner-cash-return', ownerRefund, null, lease.id);
  if (offset > EPS) receipt(simulation, shop.id, lease.tenantId, lease.lessorId, 'deposit-offset', offset, lease.listingId, lease.id);
  if (refund > EPS) receipt(simulation, shop.id, lease.tenantId, lease.tenantId, 'deposit-refund', refund, lease.listingId, lease.id);
  return success('租约已解除，押金按合同抵欠租并退余额；店内原货权及全部工资债保留，未返营运垫款继续记债。');
}
function observeFinance(simulation: Simulation): void {
  const state = simulation.state, lifecycle = stateOf(simulation).shopLifecycle; if (!lifecycle) return;
  const at = clock(state);
  for (const listing of lifecycle.listings) if (listing.state === 'offered' && (listing.expiresAt <= at || !live(state, listing.sellerId))) {
    listing.state = listing.expiresAt <= at ? 'expired' : 'withdrawn'; const title = titleOf(state, listing.shopId)!; if (title.listingId === listing.id) title.listingId = null;
  }
  for (const lease of lifecycle.leases) {
    const shop = state.shops.find(shop => shop.id === lease.shopId)!, title = titleOf(state, shop.id)!;
    if (lease.state !== 'ended') {
      while (lease.nextDueAt <= at + EPS && lease.nextDueAt < lease.endsAt - EPS) { lease.accruedPeriods++; lease.accruedRent += lease.rent; lease.arrears += lease.rent; lease.nextDueAt += SHOP_LEASE_PERIOD; shop.profit -= lease.rent; }
      settleRent(simulation, lease);
      const earliestUnpaidAt = lease.startedAt + Math.floor((lease.paidRent + EPS) / lease.rent) * SHOP_LEASE_PERIOD;
      if (lease.arrears > EPS && at >= earliestUnpaidAt + 240 - EPS) { lease.state = 'defaulted'; title.state = title.state === 'reopening' ? 'reopening' : 'suspended'; title.reason = 'lease-default'; title.suspendedAt ??= at; shop.open = false; }
      else if (lease.state === 'defaulted' && lease.arrears <= EPS && at < lease.endsAt) lease.state = 'active';
      if (at >= lease.endsAt - EPS || !live(state, lease.tenantId) || !live(state, lease.lessorId)) {
        // Expiry ends operating authority even if a capped receiver must wait for a cash refund.
        if (!endLease(simulation, lease).ok) {
          lease.state = 'defaulted'; title.state = 'suspended'; title.reason = 'lease-ended'; title.suspendedAt ??= at; shop.open = false;
          if (title.reopen?.completedAt === null && title.reopen.cancelledAt === null) title.reopen.cancelledAt = at;
        }
      }
    }
    if (lease.state === 'ended') {
      settleRent(simulation, lease);
      const tenant = actor(state, lease.tenantId)!, claim = lease.advanceInitial - lease.advanceRefunded;
      const otherProtected = simulation.shopProtectedFunds(shop) - claim;
      const amount = Math.min(claim, Math.max(0, simulation.shopFunds(shop) - otherProtected));
      if (amount > EPS && tenant.money + amount <= CASH_CAP && lifecycle.receipts.length < 4096) { simulation.transferShopFunds(shop, -amount); tenant.money += amount; lease.advanceRefunded += amount; receipt(simulation, shop.id, lease.tenantId, lease.tenantId, 'advance-refund', amount, lease.listingId, lease.id); }
      returnCorporateSite(simulation, lease);
    }
  }
}

/** Repeated distress is a new product rule, not a side effect of title registration.
 * The original proprietor's first distress and its original AND thresholds stay
 * unchanged. Registered businesses can repeat only after all other site-use
 * claims have cleared; company and tenant authority are never converted here. */
function canChooseEconomicSuspension(simulation: Simulation, shop: Shop, citizenId: string): boolean {
  const state = simulation.state, title = titleOf(state, shop.id);
  if (operatorId(state, shop) !== citizenId) return false;
  if (title && !(simulation.effectiveRuleset === 'civic-local-v1' && title.state === 'operating'
    && title.assetOwnerId === citizenId && shopLifecycleCanDispose(state, shop.id))) return false;
  return shop.profit <= -600 && shop.inventory < EPS
    && simulation.shopFunds(shop) - simulation.shopProtectedFunds(shop) < 20 * 8 / 24;
}

/** Ordinary people choice uses the same route/need/identity scoring as every other facility. This function is read-only. */
export function shopLifecycleOpportunities(simulation: Simulation, citizen: Citizen): { destination: Building; activity: 'shopLifecycle'; score: number }[] {
  const state = simulation.state, profile = state.extension?.actorProfiles[citizen.id], at = clock(state), result: { destination: Building; activity: 'shopLifecycle'; score: number }[] = [];
  if (!profile?.alive || profile.age < 18 || profile.health < 45 || profile.mood < 55 || profile.stress > 55 || citizen.needs.hunger < 50 || citizen.needs.fatigue < 45 || state.hour < 7 || state.hour >= 17) return result;
  for (const shop of state.shops) {
    if (!privateMarket(state, simulation.worldDefinition, shop)) continue;
    const title = titleOf(state, shop.id), site = simulation.worldDefinition.buildings.find(site => site.id === shop.buildingId)!;
    if (operatorId(state, shop) === citizen.id && (title?.state === 'suspended' || title?.state === 'reopening')) result.push({ destination: site, activity: 'shopLifecycle', score: 82 });
    if (canChooseEconomicSuspension(simulation, shop, citizen.id)) result.push({ destination: site, activity: 'shopLifecycle', score: 82 });
    if (!eligible(state, citizen.id) || state.shops.some(other => other.ownerId === citizen.id && other.id !== shop.id)) continue;
    for (const listing of stateOf(simulation).shopLifecycle?.listings ?? []) if (listing.shopId === shop.id && listing.state === 'offered' && listing.expiresAt > at && listing.sellerId !== citizen.id
      && citizen.money >= listing.price + listing.deposit + REGISTER_FEE + CAPITAL + RESERVE && simulation.buildingTravelDistance(citizen.homeId, shop.buildingId) <= 500) result.push({ destination: site, activity: 'shopLifecycle', score: 74 + Math.min(12, profile.skill / 10) - listing.price / 100 });
  }
  return result;
}

const installed = new WeakSet<Simulation>();
export function installShopLifecycle(simulation: Simulation): void {
  if (installed.has(simulation)) return; installed.add(simulation);
  simulation.registerSaveValidator(candidate => validateShopLifecycle(candidate, simulation.worldDefinition));
  simulation.onEvent('wage-earned', event => {
    if (!event.shopId || !event.citizenId || event.citizenId === 'player') return;
    const title = titleOf(simulation.state, event.shopId), job = title?.reopen, lease = activeLease(simulation.state, event.shopId), at = clock(simulation.state);
    const citizen = simulation.state.citizens.find(citizen => citizen.id === event.citizenId);
    if (title?.state !== 'reopening' || !job || job.completedAt !== null || job.cancelledAt !== null || !citizen || citizen.workId !== title.buildingId || lease?.state === 'defaulted'
      || !finite(event.minutes) || !finite(event.amount) || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt)
      || event.amount <= 0 || event.creditedWorkEndAt > at + EPS || event.creditedWorkEndAt <= job.startedAt || event.minutes <= 0) return;
    const lower = Math.max(job.startedAt, event.creditedWorkStartAt), upper = Math.min(at, event.creditedWorkEndAt), existing = job.labor.find(row => row.citizenId === citizen.id);
    const credited = Math.min(event.minutes, Math.max(0, upper - Math.max(lower, existing?.lastAt ?? lower)), SHOP_REOPEN_MINUTES - job.workedMinutes);
    if (!(credited > EPS)) return;
    const earned = event.amount * credited / event.minutes; if (!(earned > 0)) return;
    const row = existing ?? { citizenId: citizen.id, minutes: 0, earned: 0, lastAt: lower }; if (!existing) job.labor.push(row);
    row.minutes += credited; row.earned += earned; row.lastAt = upper; job.workedMinutes += credited;
    simulation.consumeShopLabor(event.shopId, credited);
    if (job.workedMinutes >= SHOP_REOPEN_MINUTES - EPS) { job.workedMinutes = SHOP_REOPEN_MINUTES; job.completedAt = at; job.consumedUnits = 1; title.materialsHeld = Math.max(0, title.materialsHeld - 1); title.state = 'operating'; title.reason = ''; title.suspendedAt = null; if (stateOf(simulation).shopLifecycle!.receipts.length < 4096) receipt(simulation, event.shopId, job.operatorId, event.shopId, 'reopen', 0); simulation.appendNotice('shop-reopened', '原市集用真实物料、食品库存、已资助员工修缮完成重开；历史利润、欠薪和寄售货权继续保留。'); }
  });
  simulation.onEvent('shop-lifecycle-arrived', event => {
    const citizen = simulation.state.citizens.find(citizen => citizen.id === event.citizenId), shop = simulation.state.shops.find(shop => shop.id === event.shopId);
    if (!citizen || !shop || !onsite(simulation, shop, citizen.id) || operatorId(simulation.state, shop) !== citizen.id && !eligible(simulation.state, citizen.id)) return;
    if (operatorId(simulation.state, shop) === citizen.id) {
      if (canChooseEconomicSuspension(simulation, shop, citizen.id)) suspend(simulation, shop, citizen.id, 'economic-distress');
      const current = titleOf(simulation.state, shop.id);
      if (current?.state === 'suspended' && !current.listingId) {
        const begun = eligibleOperator(simulation.state, citizen.id) && restart(simulation, shop, citizen.id, true).ok;
        if (!begun && current.assetOwnerId === citizen.id && shopLifecycleCanDispose(simulation.state, shop.id)) list(simulation, shop, citizen.id, citizen.money < 300 ? 'lease' : 'sale', citizen.money < 300 ? 25 : 100);
      }
      return;
    }
    const listing = stateOf(simulation).shopLifecycle?.listings.filter(listing => listing.shopId === shop.id && listing.state === 'offered').sort((a, b) => a.price + a.deposit - b.price - b.deposit || a.id.localeCompare(b.id))[0];
    if (listing && acquire(simulation, listing, citizen.id, CAPITAL).ok) restart(simulation, shop, citizen.id, true);
  });
  simulation.onPhase('finance', () => observeFinance(simulation));
  simulation.registerCommandHandler(command => applyShopLifecycleCommand(simulation, command, 'player'));
}

/** Shared actor-authorized transaction entry; NPC and player actions have identical preflight and cash rules. */
export function applyShopLifecycleCommand(simulation: Simulation, command: Command, actorId: string): CommandResult | null {
    const handled: Command['type'][] = ['suspendShop', 'listShopForSale', 'listShopForLease', 'withdrawShopListing', 'buyShop', 'leaseShop', 'fundShop', 'restartShop', 'endShopLease', 'payShopRent'];
    if (!handled.includes(command.type)) return null;
    const state = simulation.state, person = actor(state, actorId);
    if (!person || !live(state, actorId)) return fail('现行动人必须存活，亡故资产继续由原遗产执行人处理。');
    const lifecycle = stateOf(simulation).shopLifecycle, shop = state.shops.find(shop => shop.id === command.targetId || shop.buildingId === command.targetId);
    if (command.type === 'buyShop' || command.type === 'leaseShop') { const listing = lifecycle?.listings.find(listing => listing.id === command.targetId && listing.kind === (command.type === 'buyShop' ? 'sale' : 'lease')); return listing ? acquire(simulation, listing, actorId, command.value ?? CAPITAL) : fail('没有仍有效且同意出售/出租的挂牌。'); }
    if (!shop) return fail('请选择原市集店铺或其真实合同。');
    if (command.type === 'suspendShop') return suspend(simulation, shop, actorId, 'voluntary');
    if (command.type === 'listShopForSale' || command.type === 'listShopForLease') return list(simulation, shop, actorId, command.type === 'listShopForSale' ? 'sale' : 'lease', command.value ?? (command.type === 'listShopForSale' ? 100 : 25));
    if (command.type === 'restartShop') return restart(simulation, shop, actorId);
    if (command.type === 'withdrawShopListing') { const title = titleOf(state, shop.id), listing = lifecycle?.listings.find(listing => listing.id === title?.listingId); if (!listing || listing.sellerId !== actorId || !onsite(simulation, shop, actorId) || listing.state !== 'offered') return fail('只有原挂牌授权者能在现场撤回未成交报价。'); listing.state = 'withdrawn'; title!.listingId = null; return success('原报价已撤回，没有款项或货权变化。'); }
    if (command.type === 'fundShop') {
      const value = command.value ?? CAPITAL, lease = activeLease(state, shop.id);
      if (!privateMarket(state, simulation.worldDefinition, shop) || !finite(value) || value <= 0 || value > 100000 || operatorId(simulation.state, shop) !== actorId || (lease && (clock(state) >= lease.endsAt || !live(state, lease.tenantId) || !live(state, lease.lessorId))) || !eligibleOperator(state, actorId) || !onsite(simulation, shop, actorId) || person.money < value + RESERVE || simulation.shopFunds(shop) + value > CASH_CAP || (lease?.advanceInitial ?? 0) + value > CASH_CAP || (lifecycle?.receipts.length ?? 0) >= 4096) return fail('营运注资须本人现场、保留生活储备及所有账户/债权容量，不能造钱。');
      ensureTitle(simulation, shop);
      person.money -= value; simulation.transferShopFunds(shop, value); if (lease) lease.advanceInitial += value;
      receipt(simulation, shop.id, actorId, shop.id, 'capital', value, null, lease?.id ?? null); return success('实际钱包注资进入原经营账户；承租时记为可追回营运垫款。');
    }
    const lease = activeLease(state, shop.id);
    if (!lease || lease.tenantId !== actorId || !onsite(simulation, shop, actorId)) return fail('需要本人原租约及真实经营现场。');
    if (command.type === 'endShopLease') return endLease(simulation, lease);
    return settleRent(simulation, lease) ? success('从真实营运余额支付原租金债，工资保护不变。') : fail('无可支付欠租，或收款容量不足；可先用本人资金注资。');
}

export function validateShopLifecycle(candidate: SimState, world: WorldDefinition): void {
  const lifecycle = (candidate as LifecycleState).shopLifecycle;
  if (lifecycle === undefined) {
    if (candidate.shops.some(shop => shop.lifecycleVersion !== undefined) || candidate.extension?.companies.some(company => company.shopBindingId !== undefined)) throw new Error('店铺经营资产或租约托管模块缺失，不能退回旧经营权。');
    return;
  }
  const ensure: (condition: unknown, label: string) => asserts condition = (condition, label) => { if (!condition) throw new Error(`店铺生命周期存档无效：${label}。`); };
  const num = (value: unknown, min: number, max: number, label: string, integer = false): number => { ensure(finite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label); return value as number; };
  const rows = <T>(value: unknown, max: number, label: string): T[] => { ensure(Array.isArray(value) && value.length <= max, label); return value as T[]; };
  const at = clock(candidate), ids = new Set(['player', ...candidate.citizens.map(citizen => citizen.id)]), shops = new Map(candidate.shops.map(shop => [shop.id, shop]));
  ensure(dictionary(lifecycle) && lifecycle.version === 1 && dictionary(lifecycle.titles), '版本与权利登记');
  num(lifecycle.nextListingId, 1, 1e12, '挂牌编号', true); num(lifecycle.nextLeaseId, 1, 1e12, '租约编号', true); num(lifecycle.nextReceiptId, 1, 1e12, '回执编号', true);
  const listings = rows<ShopListing>(lifecycle.listings, 256, '挂牌'), leases = rows<ShopLease>(lifecycle.leases, 128, '租约'), receipts = rows<ShopLifecycleReceipt>(lifecycle.receipts, 4096, '回执');
  const companyIds = new Set(candidate.extension?.companies.map(company => company.id) ?? []);
  const listingIds = new Set<string>(), leaseIds = new Set<string>();
  for (const listing of listings) {
    ensure(dictionary(listing) && /^shop-listing-[1-9][0-9]*$/.test(listing.id) && Number(listing.id.slice(13)) < lifecycle.nextListingId && !listingIds.has(listing.id) && shops.has(listing.shopId) && ids.has(listing.sellerId), '授权挂牌身份'); listingIds.add(listing.id);
    ensure(['sale', 'lease'].includes(listing.kind) && ['offered', 'withdrawn', 'expired', 'accepted'].includes(listing.state), '挂牌种类状态'); num(listing.price, 1, 100000, '真实报价'); num(listing.createdAt, 0, at, '挂牌时间'); ensure(same(listing.expiresAt, listing.createdAt + 3 * SHOP_LEASE_PERIOD), '固定报价期限');
    ensure(same(listing.deposit, listing.kind === 'lease' ? listing.price * 2 : 0) && listing.leasePeriods === (listing.kind === 'lease' ? 7 : 0), '报价合同');
    if (listing.state === 'accepted') { ensure(!!listing.acceptedBy && ids.has(listing.acceptedBy) && listing.acceptedBy !== listing.sellerId, '实际买方'); num(listing.acceptedAt, listing.createdAt, Math.min(at, listing.expiresAt), '交割时间'); }
    else ensure(listing.acceptedBy === null && listing.acceptedAt === null, '未成交不造买方');
  }
  for (const lease of leases) {
    const listing = listings.find(listing => listing.id === lease.listingId);
    ensure(dictionary(lease) && /^shop-lease-[1-9][0-9]*$/.test(lease.id) && Number(lease.id.slice(11)) < lifecycle.nextLeaseId && !leaseIds.has(lease.id) && !!listing && listing.kind === 'lease' && listing.state === 'accepted' && listing.shopId === lease.shopId && listing.sellerId === lease.lessorId && listing.acceptedBy === lease.tenantId && ids.has(lease.lessorId) && ids.has(lease.tenantId), '真实租约双方及交割'); leaseIds.add(lease.id);
    ensure(same(lease.rent, listing!.price) && same(lease.depositInitial, listing!.deposit) && lease.periods === 7 && same(lease.startedAt, listing!.acceptedAt!) && same(lease.endsAt, lease.startedAt + 7 * SHOP_LEASE_PERIOD), '租约期限报价');
    num(lease.accruedPeriods, 1, 7, '已到期租期', true); ensure(same(lease.accruedRent, lease.accruedPeriods * lease.rent) && same(lease.nextDueAt, lease.startedAt + lease.accruedPeriods * SHOP_LEASE_PERIOD), '周期租金守恒');
    num(lease.accruedRent, lease.rent, 7 * lease.rent, '实际应计租金'); num(lease.paidRent, lease.rent, lease.accruedRent, '实付租金'); num(lease.arrears, 0, lease.accruedRent, '保留欠租'); ensure(same(lease.arrears + lease.paidRent, lease.accruedRent), '租债未删');
    for (const key of ['depositEscrow', 'depositToLessor', 'depositRefunded'] as const) num(lease[key], 0, lease.depositInitial, key); ensure(same(lease.depositEscrow + lease.depositToLessor + lease.depositRefunded, lease.depositInitial), '押金托管守恒');
    num(lease.advanceInitial, CAPITAL, CASH_CAP, '实付营运垫款'); num(lease.advanceRefunded, 0, lease.advanceInitial, '实退垫款'); ensure(['active', 'defaulted', 'ended'].includes(lease.state), '租约状态');
    if (lease.state === 'ended') { num(lease.endedAt, lease.startedAt, at, '解除时间'); ensure(lease.depositEscrow === 0, '解除先清押金'); } else ensure(lease.endedAt === null && lease.advanceRefunded === 0 && same(lease.depositEscrow, lease.depositInitial), '履约托管');
  }
  let lastReceiptId = 0, lastReceiptAt = 0;
  for (const row of receipts) {
    ensure(dictionary(row) && shops.has(row.shopId) && ids.has(row.actorId) && (ids.has(row.payeeId) || shops.has(row.payeeId) || row.kind === 'incorporation' && companyIds.has(row.payeeId) || row.payeeId === 'public') && ['sale', 'lease-start', 'capital', 'rent', 'deposit-offset', 'deposit-refund', 'advance-refund', 'reopen', 'incorporation', 'corporate-owner-cash-return', 'corporate-site-return'].includes(row.kind), '付款回执引用');
    ensure(row.siteReturn === undefined || row.kind === 'corporate-site-return', '返场见证只属于真实返场回执');
    num(row.id, lastReceiptId + 1, lastReceiptId + 1, '连续单调回执', true); num(row.at, lastReceiptAt, at, '回执时间'); num(row.amount, 0, CASH_CAP, '实际款项'); lastReceiptId = row.id; lastReceiptAt = row.at;
    ensure(row.listingId === null || listingIds.has(row.listingId), '回执挂牌'); ensure(row.leaseId === null || leaseIds.has(row.leaseId), '回执租约');
    const contract = leases.find(lease => lease.id === row.leaseId);
    if (['lease-start', 'rent', 'deposit-offset', 'deposit-refund', 'advance-refund', 'corporate-owner-cash-return', 'corporate-site-return'].includes(row.kind)) ensure(!!contract && row.shopId === contract.shopId && row.actorId === contract.tenantId && row.payeeId === (['deposit-refund', 'advance-refund'].includes(row.kind) ? contract.tenantId : contract.lessorId), '租约资金回执不能脱离真实双方');
    if (contract) ensure(row.shopId === contract.shopId && row.actorId === contract.tenantId && (row.listingId === null || row.listingId === contract.listingId), '租赁托管回执合同绑定');
  }
  ensure(lastReceiptId + 1 === lifecycle.nextReceiptId, '回执连续编号');
  const total = (leaseId: string, kind: ShopLifecycleReceipt['kind']) => receipts.filter(row => row.leaseId === leaseId && row.kind === kind).reduce((sum, row) => sum + row.amount, 0);
  for (const lease of leases) {
    ensure(same(total(lease.id, 'lease-start'), lease.rent) && same(total(lease.id, 'rent') + total(lease.id, 'deposit-offset') + lease.rent, lease.paidRent)
      && same(total(lease.id, 'deposit-offset'), lease.depositToLessor) && same(total(lease.id, 'deposit-refund'), lease.depositRefunded) && same(total(lease.id, 'advance-refund'), lease.advanceRefunded)
      && same(receipts.filter(row => row.leaseId === lease.id && row.kind === 'capital' && row.payeeId === lease.shopId).reduce((sum, row) => sum + row.amount, 0), lease.advanceInitial), '租约实付和托管回执一致');
  }
  ensure(Object.keys(lifecycle.titles).length <= candidate.shops.length, '权利登记数量');
  for (const shop of candidate.shops) ensure(shop.lifecycleVersion === undefined || shop.lifecycleVersion === 1 && !!lifecycle.titles[shop.id], '纳管店铺不能丢托管权利模块');
  for (const [shopId, title] of Object.entries(lifecycle.titles)) {
    const shop = shops.get(shopId), lease = leases.find(lease => lease.shopId === shopId && lease.state !== 'ended');
    ensure(dictionary(title) && !!shop && shop.lifecycleVersion === 1 && privateMarket(candidate, world, shop) && title.shopId === shopId && title.buildingId === shop.buildingId && title.scope === 'existing-business-and-site-use' && ids.has(title.legacyOwnerId) && ids.has(title.assetOwnerId) && ['operating', 'suspended', 'reopening'].includes(title.state), '经营资产范围与主体');
    ensure((title.corporation && !title.corporation.leaseId ? [title.corporation.founderId, boundCompany(candidate, shopId)?.ownerId].includes(shop!.ownerId) : shop!.ownerId === (lease?.tenantId ?? title.assetOwnerId)) && (!lease || title.assetOwnerId === lease.lessorId), '经营者与资产权/租约分离');
    ensure(leases.filter(lease => lease.shopId === shopId && lease.state !== 'ended').length <= 1 && title.leaseId === (lease?.id ?? null), '唯一真实租约');
    ensure(title.listingId === null || listings.some(listing => listing.id === title.listingId && listing.shopId === shopId && listing.sellerId === title.assetOwnerId && listing.state === 'offered'), '权利持有人挂牌');
    ensure(listings.filter(listing => listing.shopId === shopId && listing.state === 'offered').length <= 1, '唯一报价');
    if (title.state === 'operating') ensure(title.suspendedAt === null && title.reason === '', '营业与授权状态');
    else { num(title.suspendedAt, 0, at, '实际停业时钟'); ensure(['voluntary', 'economic-distress', 'lease-ended', 'lease-default'].includes(title.reason), '真实停业原因'); }
    if (title.assetOwnerId !== title.legacyOwnerId) ensure(listings.some(listing => listing.shopId === shopId && listing.kind === 'sale' && listing.state === 'accepted' && listing.acceptedBy === title.assetOwnerId)
      || Object.values(candidate.family?.estates ?? {}).some(estate => estate.businesses?.[shopId] === title.assetOwnerId)
      || candidate.family?.estateSales.some(sale => sale.kind === 'business' && sale.assetId === shopId && sale.receipts.some(row => row.buyerId === title.assetOwnerId)), '产权接续须真实买价或合法遗产回执');
    const company = candidate.extension?.companies.find(company => company.shopBindingReleasedAt === undefined && company.buildingId === shop!.buildingId);
    if (!title.corporation) ensure(!company, '不能删除公司绑定而伪装旧资产');
    const oldBindings = title.corporationHistory === undefined ? [] : rows<ShopCompanyBinding>(title.corporationHistory, 128, '原租赁公司的返场历史');
    const bindingIds = new Set<string>();
    for (const binding of [...oldBindings, ...(title.corporation ? [title.corporation] : [])]) {
      const company = candidate.extension?.companies.find(company => company.id === binding.companyId);
      ensure(dictionary(binding) && Object.keys(binding).sort().join(',') === ['companyId','founderId','registeredAt','leaseId','openingCash','capitalFunding','ownerCashReserved','ownerCashEscrow','ownerCashReturned', ...(binding.release ? ['release'] : [])].sort().join(',') && !!company && company.shopBindingId === shopId && binding.companyId === company.id && ids.has(binding.founderId), '公司权利双向绑定'); ensure(!bindingIds.has(binding.companyId), '同一公司不能重复返场'); bindingIds.add(binding.companyId);
      num(binding.registeredAt, 0, at, '公司登记时间'); ensure(same(company!.foundedAt, binding.registeredAt), '登记与原公司时间');
      num(binding.openingCash, 0, CASH_CAP, '原经营现金'); num(binding.capitalFunding, binding.founderId === 'player' ? 300 : 200, 100000, '真实新增注册资本');
      num(binding.ownerCashReserved, 0, binding.openingCash, '出租人原现金'); num(binding.ownerCashEscrow, 0, binding.ownerCashReserved, '出租人现金托管'); num(binding.ownerCashReturned, 0, binding.ownerCashReserved, '出租人原现金实退');
      ensure(same(binding.ownerCashEscrow + binding.ownerCashReturned, binding.ownerCashReserved) && (binding.release || shop!.cash === 0 && title.listingId === null), '公司单账户及独立出租人托管');
      const boundLease = leases.find(row => row.id === binding.leaseId);
      ensure(binding.leaseId === null ? binding.founderId === title.assetOwnerId && binding.ownerCashReserved === 0 : !!boundLease && boundLease.shopId === shopId && boundLease.tenantId === binding.founderId && (binding.release || boundLease.lessorId === title.assetOwnerId) && boundLease.startedAt <= binding.registeredAt && binding.registeredAt < boundLease.endsAt, '真实原产权或租赁许可');
      if (boundLease) ensure(boundLease.state === 'ended' ? binding.ownerCashEscrow === 0 : binding.ownerCashReturned === 0, '解除前保原出租人现金，解除后实际返还');
      const registered = receipts.filter(row => row.shopId === shopId && row.kind === 'incorporation' && row.payeeId === company!.id);
      ensure(registered.length === 1 && registered[0].actorId === binding.founderId && registered[0].payeeId === company!.id && registered[0].leaseId === binding.leaseId && same(registered[0].at, binding.registeredAt) && same(registered[0].amount, binding.capitalFunding + binding.openingCash - binding.ownerCashReserved), '资本转换回执保持原资金');
      const originalAdvance = boundLease ? receipts.filter(row => row.leaseId === boundLease.id && row.kind === 'capital' && row.payeeId === shopId && row.id < registered[0].id).reduce((sum, row) => sum + row.amount, 0) : 0;
      ensure(same(binding.ownerCashReserved, boundLease ? Math.max(0, binding.openingCash - originalAdvance) : 0), '原现金与登记前真实垫款不能混为股本');
      if (!binding.release) ensure(shopLifecycleAllowsShareholding(candidate, company!, company!.shareholders), '不得篡改活租约的承租控制权');
      ensure(same(receipts.filter(row => row.shopId === shopId && row.kind === 'corporate-owner-cash-return' && row.leaseId === binding.leaseId).reduce((sum, row) => sum + row.amount, 0), binding.ownerCashReturned), '出租人托管返款回执');
      if (binding.release) {
        const release = binding.release; ensure(oldBindings.includes(binding) && !!boundLease && boundLease.state === 'ended' && boundLease.arrears <= EPS && boundLease.depositEscrow === 0 && same(boundLease.advanceInitial, boundLease.advanceRefunded) && binding.ownerCashEscrow === 0, '只归还真实已清租赁资产');
        ensure(dictionary(release) && Object.keys(release).sort().join(',') === ['at','inventory','materials','employees','capital','wageDebt','committedPayroll'].sort().join(','), '返场见证字段');
        num(release.at, Math.max(binding.registeredAt, boundLease!.endedAt!), at, '真实归还时刻'); ensure(company!.shopBindingReleasedAt === release.at && company!.inventory === 0 && company!.employees === 0, '历史公司不再镜像已归还商铺');
        num(release.inventory, 0, 10000, '归还原店实物'); num(release.materials, 0, 33, '归还原店修缮用品'); num(release.employees, 0, 100, '原在册名额'); num(release.capital, 0, CASH_CAP, '公司独立资本'); ensure(release.wageDebt === 0 && release.committedPayroll === 0, '原雇主工资义务未清不得切换账户');
        const returned = receipts.filter(row => row.shopId === shopId && row.leaseId === binding.leaseId && row.kind === 'corporate-site-return'); ensure(returned.length === 1 && returned[0].amount === 0 && returned[0].at === release.at && returned[0].actorId === boundLease!.tenantId && returned[0].payeeId === boundLease!.lessorId, '归还不向自己付钱且回执完整');
        const witness = returned[0].siteReturn; ensure(dictionary(witness) && Object.keys(witness).sort().join(',') === [...Object.keys(release), 'companyId'].sort().join(',') && witness.companyId === company!.id && Object.entries(release).every(([key, value]) => Reflect.get(witness, key) === value), '返场实物与独立公司资本见证不许篡改');
        ensure(receipts.filter(row => row.leaseId === binding.leaseId && ['advance-refund','deposit-refund','deposit-offset','corporate-owner-cash-return'].includes(row.kind)).every(row => row.at <= release.at), '归还前先结清原退款');
      } else ensure(binding === title.corporation && company!.shopBindingReleasedAt === undefined, '未归还公司仍有当前绑定');
    }
    const jobs = [...rows<ShopReopenJob>(title.reopenHistory, 32, '原修缮工料历史'), ...(title.reopen ? [title.reopen] : [])];
    let lastJobEnd = 0;
    for (const job of jobs) {
      ensure(dictionary(job) && ids.has(job.operatorId), '修缮责任人'); num(job.startedAt, lastJobEnd, at, '修缮起点'); num(job.workedMinutes, 0, SHOP_REOPEN_MINUTES, '真实员工分钟'); ensure(job.materialUnits === 1 && [0, 1].includes(job.consumedUnits) && typeof job.materialFromExistingStock === 'boolean', '有限修缮材料');
      const purchases = rows<StockPurchase>(job.purchases, 32, '实际供应采购'), labor = rows<ShopReopenJob['labor'][number]>(job.labor, 1024, '真实工资劳动');
      for (const row of purchases) { const supplier = shops.get(row.supplierId); ensure(dictionary(row) && !!supplier && row.supplierId !== shopId && supplier.districtId === shop!.districtId && ['food', 'materials'].includes(row.commodity), '真实原供应者'); num(row.quantity, EPS, 2, '购料数量'); num(row.unitPrice, 4, 100000, '实际进价'); ensure(same(row.gross, row.quantity * row.unitPrice), '采购实价'); num(row.net, 0, row.gross, '供应者实收'); num(row.taxRate, 0, .3, '采购时有效税率'); ensure(same(row.net, row.gross * (1 - row.taxRate)) && (world.buildings.find(site => site.id === supplier.buildingId)?.kind === 'workshop' ? row.commodity === 'materials' : ['farm', 'dock'].includes(world.buildings.find(site => site.id === supplier.buildingId)?.kind ?? '') && row.commodity === 'food'), '供应物料种类与真实税款'); }
      ensure(same(purchases.filter(row => row.commodity === 'materials').reduce((sum, row) => sum + row.quantity, 0), job.materialFromExistingStock ? 0 : 1), '真实购买或复用保留物料');
      const jobEnd = job.completedAt ?? job.cancelledAt ?? at; num(jobEnd, job.startedAt, at, '劳动不能在完工或取消后赚取');
      const laborIds = new Set<string>(); for (const row of labor) { ensure(dictionary(row) && ids.has(row.citizenId) && row.citizenId !== 'player' && !laborIds.has(row.citizenId), '真实员工'); laborIds.add(row.citizenId); num(row.minutes, EPS, SHOP_REOPEN_MINUTES, '员工分钟'); num(row.earned, 0, CASH_CAP, '实际已赚工资'); ensure(row.earned > 0, '修缮仅使用实际正额已赚工资'); num(row.lastAt, job.startedAt, jobEnd, '员工真实时窗'); ensure(row.minutes <= row.lastAt - job.startedAt + EPS, '个体工资分钟时间容量'); }
      ensure(same(labor.reduce((sum, row) => sum + row.minutes, 0), job.workedMinutes), '累计劳动不凭空增加');
      if (job.cancelledAt !== null) { num(job.cancelledAt, job.startedAt, at, '真实取消时间'); ensure(job.completedAt === null && job.consumedUnits === 0, '取消保工料'); lastJobEnd = job.cancelledAt; }
      else if (job.completedAt === null) { ensure(job === title.reopen && job.consumedUnits === 0 && title.state === 'reopening', '在建材料保留'); lastJobEnd = at; }
      else { num(job.completedAt, job.startedAt, at, '真实完工时间'); ensure(job.workedMinutes === SHOP_REOPEN_MINUTES && job.consumedUnits === 1, '工料共同完工'); lastJobEnd = job.completedAt; }
    }
    num(title.materialsHeld, 0, 33, '独立修缮材料保管'); ensure(same(title.materialsHeld, jobs.reduce((sum, job) => sum + job.purchases.filter(row => row.commodity === 'materials').reduce((sum, row) => sum + row.quantity, 0) - job.consumedUnits, 0)), '修缮实购物料减真实消耗');
    if (!title.reopen) ensure(title.state !== 'reopening', '重开有真实合同');
  }
  for (const company of candidate.extension?.companies ?? []) if (company.shopBindingId !== undefined) { const title = lifecycle.titles[company.shopBindingId], bindings = [...(title?.corporationHistory ?? []), ...(title?.corporation ? [title.corporation] : [])]; ensure(typeof company.shopBindingId === 'string' && bindings.filter(binding => binding.companyId === company.id && (binding.release?.at === company.shopBindingReleasedAt)).length === 1, '公司不能删除原权利绑定及归还见证'); }
  for (const row of receipts) if (['incorporation','corporate-owner-cash-return', 'corporate-site-return'].includes(row.kind)) ensure(!!lifecycle.titles[row.shopId]?.corporation || !!lifecycle.titles[row.shopId]?.corporationHistory?.length, '转换回执不可删除权利');
  for (const listing of listings) ensure(!!lifecycle.titles[listing.shopId], '报价保留权利主体');
  for (const lease of leases) ensure(!!lifecycle.titles[lease.shopId], '租约保留稳定店铺债务主体');
  for (const listing of listings.filter(listing => listing.state === 'accepted')) {
    if (listing.kind === 'lease') ensure(leases.filter(lease => lease.listingId === listing.id).length === 1, '已成交租赁必须永久保留唯一租约及未退债');
    const paid = receipts.filter(row => row.listingId === listing.id && row.kind === (listing.kind === 'sale' ? 'sale' : 'lease-start'));
    ensure(paid.length === 1 && paid[0].actorId === listing.acceptedBy && paid[0].payeeId === listing.sellerId && same(paid[0].amount, listing.price) && same(paid[0].at, listing.acceptedAt!), '产权先有真实买价回执');
    const injected = receipts.filter(row => row.listingId === listing.id && row.kind === 'capital' && row.payeeId === listing.shopId), registered = receipts.filter(row => row.listingId === listing.id && row.kind === 'capital' && row.payeeId === 'public');
    ensure(injected.length === 1 && injected[0].actorId === listing.acceptedBy && same(injected[0].at, listing.acceptedAt!) && injected[0].amount >= CAPITAL && injected[0].amount <= 100000, '交割营运注资另行实际付入原店');
    ensure(registered.length === 1 && registered[0].actorId === listing.acceptedBy && same(registered[0].at, listing.acceptedAt!) && same(registered[0].amount, REGISTER_FEE), '真实登记费');
  }
}
