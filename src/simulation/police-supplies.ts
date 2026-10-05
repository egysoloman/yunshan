import type { Crime, SimState, WorldDefinition } from '../types';
import type { PublicPurchaseReceipt } from '../simulation';

// These are paid public materials held for an incident, not a second cash account.
export interface PoliceSupplyKit {
  crimeId: string; districtId: string; severity: number; createdAt: number;
  requiredUnits: number; retryAt: number; receivedUnits: number; consumedUnits: number; consumedAt: number | null;
  gross: number; tax: number;
  receipts: { shopId: string; quantity: number; gross: number; net: number; unitPrice: number; taxRate: number; paidAt: number }[];
}
interface Totals { receivedUnits: number; consumedUnits: number; gross: number; tax: number }
export interface PoliceSupplies {
  version: 1; kits: Record<string, PoliceSupplyKit>; legacyResponses: string[];
  totals: Totals; archived: Totals & { cases: number };
}
const zero = (): Totals => ({ receivedUnits: 0, consumedUnits: 0, gross: 0, tax: 0 });
export const createPoliceSupplies = (crimes: Crime[]): PoliceSupplies => ({ version: 1, kits: {}, legacyResponses: crimes.filter(crime => crime.status === 'responding').map(crime => crime.id), totals: zero(), archived: { ...zero(), cases: 0 } });
export const policeSupplyReady = (kit: PoliceSupplyKit | undefined): boolean => !!kit && kit.consumedAt === null && kit.receivedUnits + 1e-7 >= kit.requiredUnits;
export function recordPolicePurchase(stock: PoliceSupplies, crime: Crime, receipt: PublicPurchaseReceipt, at: number, taxRate: number): void {
  const kit = stock.kits[crime.id] ??= { crimeId: crime.id, districtId: crime.districtId, severity: crime.severity, createdAt: at, requiredUnits: 3 * crime.severity, retryAt: at + 10, receivedUnits: 0, consumedUnits: 0, consumedAt: null, gross: 0, tax: 0, receipts: [] };
  stock.legacyResponses = stock.legacyResponses.filter(id => id !== crime.id);
  kit.retryAt = at + 10;
  kit.receivedUnits += receipt.quantity; kit.gross += receipt.paid; kit.tax += receipt.tax;
  kit.receipts.push(...receipt.lots.map(lot => ({ ...lot, taxRate, paidAt: at })));
  stock.totals.receivedUnits += receipt.quantity; stock.totals.gross += receipt.paid; stock.totals.tax += receipt.tax;
}
export function consumePoliceSupply(stock: PoliceSupplies, crimeId: string, at: number): number {
  stock.legacyResponses = stock.legacyResponses.filter(id => id !== crimeId);
  const kit = stock.kits[crimeId]; if (!kit || kit.consumedAt !== null) return 0;
  kit.consumedAt = at; kit.consumedUnits = kit.receivedUnits; stock.totals.consumedUnits += kit.consumedUnits;
  return kit.consumedUnits;
}
export function archivePoliceSupplies(stock: PoliceSupplies, crimes: Crime[]): void {
  const existing = new Set(crimes.map(crime => crime.id));
  stock.legacyResponses = stock.legacyResponses.filter(id => crimes.some(crime => crime.id === id && crime.status === 'responding'));
  for (const [id, kit] of Object.entries(stock.kits)) if (!existing.has(id) && kit.consumedAt !== null) {
    for (const key of ['receivedUnits', 'consumedUnits', 'gross', 'tax'] as const) stock.archived[key] += key === 'receivedUnits' ? kit.receivedUnits : key === 'consumedUnits' ? kit.consumedUnits : kit[key];
    stock.archived.cases++; delete stock.kits[id];
  }
}
export function validatePoliceSupplies(state: SimState, runtime: { policeSuppliesVersion?: unknown; policeSupplies?: unknown; dispatches: Record<string, { crimeId: string }> }, world: WorldDefinition): void {
  const stock = runtime.policeSupplies as PoliceSupplies | undefined;
  if (stock === undefined && runtime.policeSuppliesVersion === undefined) return; // Genuine old saves remain untouched.
  const ensure = (condition: unknown, label: string): void => { if (!condition) throw new Error(`无效警务物料存档：${label}。`); };
  const object = (value: unknown, keys: string[], label: string): void => ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)), label);
  const amount = (value: unknown, label: string, max = 1e12): void => ensure(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max, label);
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1e-6, Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 64);
  ensure(runtime.policeSuppliesVersion === 1 && stock?.version === 1, '独立版本和物料body必须同时存在');
  object(stock, ['version', 'kits', 'legacyResponses', 'totals', 'archived'], '物料body');
  ensure(JSON.stringify(stock).length <= 768 * 1024, '有界物料记录大小');
  ensure(stock!.kits && typeof stock!.kits === 'object' && !Array.isArray(stock!.kits) && Object.keys(stock!.kits).length <= 200, '案件库存上限');
  ensure(Array.isArray(stock!.legacyResponses) && stock!.legacyResponses.length <= 200 && new Set(stock!.legacyResponses).size === stock!.legacyResponses.length, '旧响应白名单');
  const now = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
  const sums: Totals = zero();
  for (const field of ['totals', 'archived'] as const) {
    object(stock![field], field === 'totals' ? Object.keys(zero()) : [...Object.keys(zero()), 'cases'], field);
    for (const key of Object.keys(zero()) as (keyof Totals)[]) amount(stock![field][key], `${field}.${key}`);
  }
  amount(stock!.archived.cases, '归档件数'); ensure(Number.isInteger(stock!.archived.cases), '归档件数整数');
  ensure(close(stock!.archived.receivedUnits, stock!.archived.consumedUnits), '只归档已耗用且无案件引用物料');
  for (const [id, kit] of Object.entries(stock!.kits)) {
    object(kit, ['crimeId', 'districtId', 'severity', 'createdAt', 'requiredUnits', 'retryAt', 'receivedUnits', 'consumedUnits', 'consumedAt', 'gross', 'tax', 'receipts'], '案件物料记录');
    const crime = state.crimes.find(crime => crime.id === id);
    ensure(crime && kit.crimeId === id && kit.districtId === crime.districtId && kit.severity === crime.severity && !stock!.legacyResponses.includes(id), '真实案件引用');
    amount(kit.createdAt, '购入时刻', now); ensure(kit.requiredUnits === 3 * kit.severity, '原实物需求');
    amount(kit.retryAt, '采购重试时刻', now + 10); ensure(kit.retryAt >= kit.createdAt, '重试不得早于购入');
    for (const key of ['receivedUnits', 'consumedUnits', 'gross', 'tax'] as const) amount(kit[key], `物料.${key}`);
    ensure(kit.receivedUnits > 0 && kit.receivedUnits <= kit.requiredUnits + 1e-7 && kit.gross <= 1e9 + 1e-7, '有限实物量和采购数值上限');
    ensure(kit.consumedAt === null || Number.isFinite(kit.consumedAt) && kit.consumedAt >= kit.createdAt && kit.consumedAt <= now, '实物耗用时刻');
    ensure(kit.consumedAt === null ? kit.consumedUnits === 0 && crime!.status !== 'resolved' : crime!.status === 'resolved' && close(kit.consumedUnits, kit.receivedUnits), '结案耗用一次');
    ensure(Array.isArray(kit.receipts) && kit.receipts.length > 0 && kit.receipts.length <= 256, '实际回执上限');
    let quantity = 0, gross = 0, tax = 0, previousAt = kit.createdAt;
    for (const lot of kit.receipts) {
      object(lot, ['shopId', 'quantity', 'gross', 'net', 'unitPrice', 'taxRate', 'paidAt'], '供货回执');
      const shop = state.shops.find(shop => shop.id === lot.shopId), site = world.buildings.find(site => site.id === shop?.buildingId);
      ensure(shop && site?.kind === 'workshop' && !site.facility, '工业供货者');
      amount(lot.paidAt, '回执时刻', kit.consumedAt ?? now); ensure(lot.paidAt >= previousAt, '回执时间顺序'); previousAt = lot.paidAt;
      amount(lot.quantity, '回执数量'); amount(lot.gross, '实付总价'); amount(lot.net, '供货者实收'); amount(lot.unitPrice, '冻结单价'); amount(lot.taxRate, '交易时税率', .3);
      ensure(lot.quantity > 0 && lot.unitPrice >= 4 && close(lot.quantity * lot.unitPrice, lot.gross) && close(lot.net, lot.gross * (1 - lot.taxRate)), '货款净税守恒');
      quantity += lot.quantity; gross += lot.gross; tax += lot.gross - lot.net;
    }
    ensure(kit.retryAt === previousAt + 10, '重试时刻来自最后实际采购');
    ensure(close(quantity, kit.receivedUnits) && close(gross, kit.gross) && close(tax, kit.tax), '回执实物实付合计');
    sums.receivedUnits += kit.receivedUnits; sums.consumedUnits += kit.consumedUnits; sums.gross += kit.gross; sums.tax += kit.tax;
  }
  for (const id of stock!.legacyResponses) ensure(typeof id === 'string' && state.crimes.some(crime => crime.id === id && crime.status === 'responding') && !stock!.kits[id], '旧响应不追造历史物料');
  for (const key of Object.keys(zero()) as (keyof Totals)[]) ensure(close(sums[key] + stock!.archived[key], stock!.totals[key]), '累计回执和库存守恒');
  ensure(stock!.archived.cases > 0 || (Object.keys(zero()) as (keyof Totals)[]).every(key => stock!.archived[key] === 0), '零归档案件不能有历史物料');
  ensure(stock!.archived.receivedUnits <= 30 * stock!.archived.cases + 1e-7 && stock!.archived.gross + 1e-7 >= 4 * stock!.archived.receivedUnits && stock!.archived.tax <= .3 * stock!.archived.gross + 1e-7 && stock!.archived.cases <= state.metrics.crimesResolved, '有限归档实物货款');
  for (const crime of state.crimes.filter(crime => crime.status === 'responding')) ensure(stock!.legacyResponses.includes(crime.id) || policeSupplyReady(stock!.kits[crime.id]), '响应实物完整');
  for (const [officerId, dispatch] of Object.entries(runtime.dispatches)) {
    const crime = state.crimes.find(crime => crime.id === dispatch.crimeId);
    if (crime?.status === 'responding') {
      ensure(stock!.legacyResponses.includes(crime.id) || policeSupplyReady(stock!.kits[crime.id]), '新响应必须有完整工业物料');
      const officer = state.citizens.find(person => person.id === officerId);
      if ((dispatch as { arrived?: boolean }).arrived && !stock!.legacyResponses.includes(crime.id)) ensure(officer && Math.hypot(officer.position.x - crime.position.x, officer.position.y - crime.position.y, officer.position.z - crime.position.z) <= 3, '到场标记必须有真实脚位');
    }
  }
}
