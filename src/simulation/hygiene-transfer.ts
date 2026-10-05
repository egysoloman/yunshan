import type { Simulation } from '../simulation';
import { clinicalServiceStationsAtPosition, clinicalDoctorUsedWorkWindows } from './clinical';
import { certifiedHygieneDoctorWorkWindows } from './hygiene-public';
import { hygieneContactWindows, type HygieneReceipt, type WasteBatch } from './hygiene';
import { actorActivityAvailable, claimActorActivityMinutes } from './activity-minutes';
import { homeRestPointBlockedByVoxels } from './home-rest';
import { powerSupplyAt } from './power';
import type { ActorActivityClaim } from './activity-capacity';
import type { Citizen, CommandResult, SimState, Vec3, WorldDefinition } from '../types';
/** Voluntary resident transport between existing clinic holding stations.
 * These gameplay units are sealed custody, never licensed terminal disposal. */
export const HYGIENE_TRANSFER_RULESET = 'clinic-sealed-custody-transfer-v1' as const;
const EPS = 1e-7, LIMIT = 64, CAPACITY = 8, HANDOFF = 2, CASH_LIMIT = 1e9;
const clock = (s: SimState) => s.extension!.lastUpdate;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const transporting = (t: HygieneTransfer) => ['carried', 'awaitingIntake'].includes(t.state);
const reserving = (t: HygieneTransfer) => !['received', 'cancelled', 'stranded'].includes(t.state);
export interface TransferLabor {
    actorId: string;
    siteId: string;
    role: '医生' | 'doctor';
    age: number;
    start: number;
    end: number;
}
export interface HygieneTransfer {
    id: string;
    batchId: string;
    carrierId: 'player';
    startedAt: number;
    lastObservedAt: number;
    destinationSiteId: string;
    destinationFloor: number;
    destinationPointId: string;
    destinationPoint: Vec3;
    state: 'awaitingSupply' | 'awaitingCollection' | 'readyForPickup' | 'carried' | 'awaitingIntake' | 'received' | 'cancelled' | 'stranded';
    reason: string;
    funded: number;
    escrow: number;
    purchasePaid: number;
    refunded: number;
    receipt: HygieneReceipt | null;
    retryAt: number;
    collectionMinutes: number;
    intakeMinutes: number;
    collectionLabor: TransferLabor[];
    intakeLabor: TransferLabor[];
    pickedAt: number | null;
    pickupPoint: Vec3 | null;
    pickedContainedUnits: number;
    cargoPosition: Vec3 | null;
    traveledDistance: number;
    intakeRequestedAt: number | null;
    deliveredAt: number | null;
    cancelledAt: number | null;
    strandedAt: number | null;
}
export interface HygieneTransfers {
    version: 1;
    rulesetId: typeof HYGIENE_TRANSFER_RULESET;
    nextId: number;
    tasks: HygieneTransfer[];
}
/** Source receipts and cumulative processing totals remain immutable. */
export function transferredSourceUnits(s: SimState, batchId: string): number { return (s.hygiene?.transfers?.tasks ?? []).filter(t => t.batchId === batchId && t.pickedAt !== null).length * 2; }
export function transferStationOccupied(s: SimState, siteId: string, floor: number, pointId: string, reservations = true): number {
    return (s.hygiene?.transfers?.tasks ?? []).reduce((units, t) => {
        const source = s.hygiene!.batches.find(b => b.id === t.batchId);
        const atSource = source?.siteId === siteId && source.floor === floor && source.pointId === pointId && t.pickedAt === null;
        const heldOrReservedKit = atSource && (t.receipt !== null || reservations && reserving(t)) ? 1 : 0;
        const heldOrReservedDelivery = t.destinationSiteId === siteId && t.destinationFloor === floor && t.destinationPointId === pointId && (t.state === 'received' || reservations && reserving(t)) ? 3 : 0;
        return units + heldOrReservedKit + heldOrReservedDelivery;
    }, 0);
}
export function transferActivityClaims(s: SimState): ActorActivityClaim[] { return (s.hygiene?.transfers?.tasks ?? []).flatMap(t => [...t.collectionLabor.map((r, i) => ({ id: `hygiene-transfer:${t.id}:collection:${i}`, actorId: r.actorId, startedAt: r.start, endedAt: r.end, workedMinutes: r.end - r.start })), ...t.intakeLabor.map((r, i) => ({ id: `hygiene-transfer:${t.id}:intake:${i}`, actorId: r.actorId, startedAt: r.start, endedAt: r.end, workedMinutes: r.end - r.start }))]); }
function stationAt(sim: Simulation, siteId: string, pointId: string, floor: number, position: Vec3): boolean {
    const site = sim.worldDefinition.buildings.find(b => b.id === siteId);
    return !!site && site.kind === 'clinic' && !homeRestPointBlockedByVoxels(position, sim.state.voxels) && clinicalServiceStationsAtPosition(site, position, sim.state.player, sim.state.voxels).some(p => p.id === pointId && p.floor === floor);
}
function originalAt(sim: Simulation, b: WasteBatch): boolean { return stationAt(sim, b.siteId, b.pointId, b.floor, sim.state.player.position); }
function capacity(s: SimState, siteId: string, floor: number, pointId: string): number { return (s.hygiene?.batches ?? []).filter(b => b.siteId === siteId && b.floor === floor && b.pointId === pointId).reduce((n, b) => n + b.containedUnits, 0) + transferStationOccupied(s, siteId, floor, pointId); }
function refund(sim: Simulation, t: HygieneTransfer): void { const amount = Math.min(t.escrow, Math.max(0, CASH_LIMIT - sim.state.player.money)); t.escrow -= amount; t.refunded += amount; sim.state.player.money += amount; }
function carryObservation(sim: Simulation, t: HygieneTransfer): void {
    if (!transporting(t))
        return;
    const p = sim.state.player.position;
    if (t.cargoPosition)
        t.traveledDistance += distance(t.cargoPosition, p);
    t.cargoPosition = { ...p };
    if (!sim.state.extension!.actorProfiles.player.alive) {
        t.state = 'stranded';
        t.strandedAt = clock(sim.state);
        t.reason = '承运居民已故；三份密封货物仍留在最后实际位置，目的地预约已释放。尚无接替清运。';
    }
}
function cancel(sim: Simulation, t: HygieneTransfer): CommandResult {
    if (t.pickedAt !== null || t.state === 'cancelled')
        return { ok: false, message: '已提取货物必须具名保管，不能用取消删除货物或重复退款。' };
    t.state = 'cancelled';
    t.cancelledAt = clock(sim.state);
    t.reason = '提货前取消；源用品和已购物料仍具名留在原站点。';
    refund(sim, t);
    if (t.escrow > 0)
        t.reason += '钱包容量不足，未花预算继续托管。';
    else
        t.reason += '未花预算已退。';
    return { ok: true, message: t.reason };
}
function begin(sim: Simulation, target: string): CommandResult {
    const s = sim.state, h = s.hygiene, fail = (message: string) => ({ ok: false, message });
    let ids: unknown;
    try {
        ids = JSON.parse(target);
    }
    catch {
        return fail('请选择具名原批次和另一诊所。');
    }
    if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(id => typeof id === 'string' && id.length <= 240))
        return fail('转运目标无效。');
    const b = h?.batches.find(b => b.id === ids[0]), dest = sim.worldDefinition.buildings.find(b => b.id === ids[1] && b.kind === 'clinic');
    if (!b || !dest || b.siteId === dest.id || b.contaminatedUnits !== 0 || b.reservedUnits !== 0 || b.sealedUnits * 2 - transferredSourceUnits(s, b.id) < 2)
        return fail('仅可转运已实际封存且未认领的一对原用品和清洁残留。');
    const profile = s.extension!.actorProfiles.player;
    if (!profile.alive || profile.age < 18 || !originalAt(sim, b) || s.player.vehicleId || s.aviation?.activeAircraftId)
        return fail('成年居民须在原诊所公共保管站步行提交。');
    const tasks = h?.transfers?.tasks ?? [];
    if (tasks.length >= LIMIT || tasks.some(t => reserving(t) || t.state === 'stranded'))
        return fail('一次只可领取三份容量的具名运输包；原任务尚未结清或有限档案已满。');
    if (s.player.money < 20 || s.player.money > CASH_LIMIT)
        return fail('请用本人钱包支付20云币有限采购托管预算。');
    const point = (dest.functionPoints ?? []).filter(p => p.purpose === 'service' && p.floor === 0).find(p => stationAt(sim, dest.id, p.id, p.floor, p.position) && capacity(s, dest.id, p.floor, p.id) + 3 <= CAPACITY);
    if (!point)
        return fail('目的诊所没有可用的真实公共站点与三份有限保管容量。');
    if (capacity(s, b.siteId, b.floor, b.pointId) + 1 > CAPACITY)
        return fail('原站点已无一份运输耗材的保管空间；不能创建无限容器。');
    if (![b.siteId, dest.id].every(siteId => s.citizens.some(p => p.workId === siteId && ['医生', 'doctor'].includes(p.role) && s.extension!.actorProfiles[p.id]?.alive && s.extension!.actorProfiles[p.id].age >= 18)))
        return fail('两站须各有在册成年医生，实际交接仍等待到场和真实工资。');
    const transfers = h!.transfers ??= { version: 1, rulesetId: HYGIENE_TRANSFER_RULESET, nextId: 1, tasks: [] };
    const t: HygieneTransfer = { id: `hygiene-transfer-${transfers.nextId++}`, batchId: b.id, carrierId: 'player', startedAt: clock(s), lastObservedAt: clock(s), destinationSiteId: dest.id, destinationFloor: point.floor, destinationPointId: point.id, destinationPoint: { ...point.position }, state: 'awaitingSupply', reason: '本人20云币预算已托管，目的诊所三份空间预约；等待真实运输耗材及原医生两分钟已计薪交接。此服务只转运保管。', funded: 20, escrow: 20, purchasePaid: 0, refunded: 0, receipt: null, retryAt: clock(s), collectionMinutes: 0, intakeMinutes: 0, collectionLabor: [], intakeLabor: [], pickedAt: null, pickupPoint: null, pickedContainedUnits: 0, cargoPosition: null, traveledDistance: 0, intakeRequestedAt: null, deliveredAt: null, cancelledAt: null, strandedAt: null };
    h!.version = 2;
    Reflect.set(Reflect.get(sim, 'runtime'), 'hygieneVersion', 2);
    Reflect.set(Reflect.get(sim, 'runtime'), 'hygieneTransferVersion', 1);
    s.player.money -= 20;
    transfers.tasks.push(t);
    return { ok: true, message: t.reason };
}
function procure(sim: Simulation, t: HygieneTransfer): void {
    const s = sim.state;
    if (t.receipt || t.retryAt > clock(s) || t.state !== 'awaitingSupply')
        return;
    t.retryAt = clock(s) + 60;
    const source = s.hygiene!.batches.find(b => b.id === t.batchId)!;
    if (capacity(s, source.siteId, source.floor, source.pointId) > CAPACITY) {
        t.reason = '源站真实保管与预留容量已满，采购暂停。';
        return;
    }
    const offers = s.shops.filter(shop => sim.shopCommodity(shop) === 'materials' && shop.inventory >= 1).map(shop => ({ shop, q: sim.quoteSupply(shop.id, 1) })).filter(({ shop, q }) => q.quantity >= 1 && Number.isFinite(q.unitPrice) && q.unitPrice > 0 && q.unitPrice <= t.escrow && sim.shopFunds(shop) + q.unitPrice * (1 - s.taxRate) <= CASH_LIMIT).sort((a, b) => a.q.unitPrice - b.q.unitPrice || a.shop.id.localeCompare(b.shop.id));
    const offer = offers[0];
    if (!offer) {
        t.reason = '等候一整份实付工业运输耗材；没有免费容器或零库存进度。';
        return;
    }
    const gross = offer.q.unitPrice, tax = gross * s.taxRate, net = gross - tax;
    offer.shop.inventory--;
    sim.transferShopFunds(offer.shop, net);
    offer.shop.revenue += gross;
    offer.shop.profit += net;
    t.escrow -= gross;
    t.purchasePaid = gross;
    t.receipt = { shopId: offer.shop.id, purchasedAt: clock(s), quantity: 1, unitPrice: gross, gross, net, tax };
    t.state = 'awaitingCollection';
    sim.emitEvent({ type: 'wholesale', shopId: offer.shop.id, districtId: offer.shop.districtId, amount: gross, quantity: 1, unitPrice: gross, procurementId: `${t.id}:container`, purpose: 'hygiene-transport-material' });
}
function subtract(ranges: readonly Readonly<{
    start: number;
    end: number;
}>[], used: readonly Readonly<{
    start: number;
    end: number;
}>[]): {
    start: number;
    end: number;
}[] { return ranges.flatMap(r => { const cuts = [r.start, r.end, ...used.flatMap(u => [u.start, u.end]).filter(v => v > r.start && v < r.end)].sort((a, b) => a - b); return cuts.slice(1).map((end, i) => ({ start: cuts[i], end })).filter(v => v.end - v.start > EPS && !used.some(u => u.start <= v.start && u.end >= v.end)); }); }
function labor(sim: Simulation, t: HygieneTransfer, stage: 'collection' | 'intake', minutes: number): void {
    const s = sim.state, b = s.hygiene!.batches.find(b => b.id === t.batchId)!, siteId = stage === 'collection' ? b.siteId : t.destinationSiteId, floor = stage === 'collection' ? b.floor : t.destinationFloor, pointId = stage === 'collection' ? b.pointId : t.destinationPointId;
    if (!stationAt(sim, siteId, pointId, floor, s.player.position) || s.player.vehicleId || s.aviation?.activeAircraftId || !s.extension!.actorProfiles.player.alive || s.extension!.actorProfiles.player.age < 18 || !powerSupplyAt(s, siteId))
        return;
    const rows = stage === 'collection' ? t.collectionLabor : t.intakeLabor, worked = stage === 'collection' ? t.collectionMinutes : t.intakeMinutes;
    const doctor = s.citizens.find(p => p.workId === siteId && ['医生', 'doctor'].includes(p.role) && s.extension!.actorProfiles[p.id]?.alive && s.extension!.actorProfiles[p.id].age >= 18 && s.extension!.actorProfiles[p.id].health >= 45 && p.needs.hunger >= 40 && p.needs.fatigue >= 35 && stationAt(sim, siteId, pointId, floor, p.position) && certifiedHygieneDoctorWorkWindows(sim, p, siteId, minutes, t.startedAt).length > 0);
    if (!doctor)
        return;
    const used = [...clinicalDoctorUsedWorkWindows(sim, doctor.id), ...s.hygiene!.jobs.flatMap(j => hygieneContactWindows(sim, doctor.id, j.id, j.batchId)), ...s.hygiene!.transfers!.tasks.flatMap(task => [...task.collectionLabor, ...task.intakeLabor].filter(r => r.actorId === doctor.id).map(r => ({ start: r.start, end: r.end })))];
    const earliestAt = Math.max(t.startedAt, t.receipt!.purchasedAt, stage === 'intake' ? t.intakeRequestedAt ?? clock(s) : t.startedAt);
    const ranges = subtract(certifiedHygieneDoctorWorkWindows(sim, doctor, siteId, minutes, earliestAt), used), selected: {
        start: number;
        end: number;
    }[] = [];
    let remaining = Math.min(HANDOFF - worked, actorActivityAvailable(sim, doctor.id, minutes));
    for (const range of ranges) {
        const amount = Math.min(remaining, range.end - range.start);
        if (amount > EPS) {
            selected.push({ start: range.start, end: range.start + amount });
            remaining -= amount;
        }
    }
    const requested = selected.reduce((n, r) => n + r.end - r.start, 0), amount = claimActorActivityMinutes(sim, doctor.id, `${t.id}:${stage}`, requested, minutes);
    if (amount <= EPS)
        return;
    if (Math.abs(amount - requested) > EPS)
        throw new Error('转运交接实际劳动容量不一致。');
    for (const r of selected) {
        const last = rows.at(-1);
        if (last && last.actorId === doctor.id && Math.abs(last.end - r.start) < EPS)
            last.end = r.end;
        else
            rows.push({ actorId: doctor.id, siteId, role: doctor.role as '医生' | 'doctor', age: s.extension!.actorProfiles[doctor.id].age, ...r });
    }
    if (stage === 'collection') {
        t.collectionMinutes = Math.min(HANDOFF, worked + amount);
        if (t.collectionMinutes === HANDOFF) {
            t.state = 'readyForPickup';
            t.reason = '原医生已完成两分钟真实计薪交接；请本人现场提取三份容量的封存运输包。';
        }
    }
    else {
        t.intakeMinutes = Math.min(HANDOFF, worked + amount);
        if (t.intakeMinutes === HANDOFF) {
            t.state = 'received';
            t.deliveredAt = clock(s);
            t.cargoPosition = { ...s.player.position };
            refund(sim, t);
            t.reason = '目的医生两分钟真实计薪接收；原用品、清洁残留与运输耗材共三份仍在该站点有限保管，尚无末端处理。';
        }
    }
}
export function installHygieneTransfers(sim: Simulation): void {
    sim.registerCommandHandler(command => {
        if (command.type === 'transferWaste')
            return begin(sim, command.targetId ?? '');
        if (!['collectWasteTransfer', 'deliverWasteTransfer', 'cancelWasteTransfer'].includes(command.type))
            return null;
        const t = sim.state.hygiene?.transfers?.tasks.find(t => t.id === command.targetId);
        if (!t)
            return { ok: false, message: '没有具名转运合同。' };
        if (command.type === 'cancelWasteTransfer')
            return cancel(sim, t);
        const s = sim.state, b = s.hygiene!.batches.find(b => b.id === t.batchId)!, p = s.extension!.actorProfiles.player;
        if (!p.alive || p.age < 18 || s.player.vehicleId || s.aviation?.activeAircraftId)
            return { ok: false, message: '须由存活成年承运居民下车后现场交接。' };
        if (command.type === 'collectWasteTransfer') {
            if (t.state !== 'readyForPickup' || !originalAt(sim, b))
                return { ok: false, message: '请在原公共站点等待真实交接后提取。' };
            const inTransit = s.hygiene!.transfers!.tasks.some(other => other !== t && transporting(other));
            if (inTransit)
                return { ok: false, message: '三份运输包已被占用。' };
            t.pickedAt = clock(s);
            t.pickupPoint = { ...s.player.position };
            t.cargoPosition = { ...s.player.position };
            t.pickedContainedUnits = Math.min(2, b.containedUnits);
            b.containedUnits -= t.pickedContainedUnits;
            t.state = 'carried';
            t.reason = '三份封存货物由本人携带；原站点空间释放，须实际抵达具名目的诊所接收，不能取消删除。';
            return { ok: true, message: t.reason };
        }
        if (!transporting(t) || !stationAt(sim, t.destinationSiteId, t.destinationPointId, t.destinationFloor, s.player.position))
            return { ok: false, message: '请携带原运输包实际抵达目的诊所公共站点。' };
        carryObservation(sim, t);
        t.intakeRequestedAt ??= clock(s);
        t.state = 'awaitingIntake';
        t.reason = '本人已抵达，三份货物继续由本人保管；等待目的医生两个真实计薪接收分钟。';
        return { ok: true, message: t.reason };
    });
    sim.onPhase('people', (s, minutes) => { for (const t of s.hygiene?.transfers?.tasks ?? []) {
        t.lastObservedAt = clock(s);
        carryObservation(sim, t);
        if (!s.extension!.actorProfiles.player.alive && t.pickedAt === null && t.state !== 'cancelled')
            cancel(sim, t);
        if (t.state === 'awaitingCollection')
            labor(sim, t, 'collection', minutes);
        else if (t.state === 'awaitingIntake')
            labor(sim, t, 'intake', minutes);
    } });
    sim.onPhase('finance', s => { for (const t of s.hygiene?.transfers?.tasks ?? []) {
        if (t.state === 'awaitingSupply')
            procure(sim, t);
        if (t.state === 'received' || t.state === 'cancelled')
            refund(sim, t);
    } });
    sim.onPhase('feedback', s => { for (const t of s.hygiene?.transfers?.tasks ?? [])
        carryObservation(sim, t); });
    sim.registerSaveValidator(s => validateHygieneTransfers(s, sim.worldDefinition));
}
export function validateHygieneTransfers(s: SimState, world: WorldDefinition): void {
    const transfers = s.hygiene?.transfers;
    if (transfers === undefined) { if (s.hygiene?.version === 2) throw new Error('卫生转运存档无效：新版本不得丢失具名货物。'); return; }
    if (s.hygiene?.version !== 2) throw new Error('卫生转运存档无效：旧版本不能伪装新具名货物。');
    const ensure = (v: unknown, label: string): void => { if (!v)
        throw new Error(`卫生转运存档无效：${label}`); }, now = clock(s), siteMap = new Map(world.buildings.map(b => [b.id, b]));
    const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
    const num = (v: unknown, min: number, max: number, label: string) => ensure(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max, label), close = (a: number, b: number, label: string) => ensure(Math.abs(a - b) < EPS, label), point = (v: unknown, label: string) => ensure(obj(v) && [v.x, v.y, v.z].every(n => typeof n === 'number' && Number.isFinite(n)), label);
    ensure(obj(transfers) && transfers.version === 1 && transfers.rulesetId === HYGIENE_TRANSFER_RULESET && Array.isArray(transfers.tasks) && transfers.tasks.length <= LIMIT && transfers.nextId === transfers.tasks.length + 1, '有限版本序号');
    const sourcePicked = new Map<string, number>(), sourceClaimed = new Map<string, number>();
    let active = 0;
    for (const [index, t] of transfers.tasks.entries()) {
        const b = s.hygiene!.batches.find(b => b.id === t.batchId), dest = siteMap.get(t.destinationSiteId);
        ensure(obj(t) && t.id === `hygiene-transfer-${index + 1}` && t.carrierId === 'player' && b && dest?.kind === 'clinic' && dest.id !== b.siteId, '具名源批次与不同真实诊所');
        num(t.startedAt, b!.firstAt, now, '起点');
        num(t.lastObservedAt, t.startedAt, now, '观察');
        num(t.retryAt, t.startedAt, now + 60, '重试');
        ensure(['awaitingSupply', 'awaitingCollection', 'readyForPickup', 'carried', 'awaitingIntake', 'received', 'cancelled', 'stranded'].includes(t.state) && typeof t.reason === 'string' && t.reason.length <= 240, '状态');
        point(t.destinationPoint, '目的位置');
        ensure((dest!.functionPoints ?? []).some(p => p.id === t.destinationPointId && p.floor === t.destinationFloor && p.purpose === 'service' && p.floor === 0 && distance(p.position, t.destinationPoint) < EPS), '实际公开目的站');
        close(t.funded, 20, '有限本人预算');
        for (const key of ['escrow', 'purchasePaid', 'refunded'] as const)
            num(t[key], 0, 20, key);
        close(t.funded, t.escrow + t.purchasePaid + t.refunded, '原资金守恒');
        if (t.receipt) {
            const r = t.receipt;
            ensure(obj(r) && r.quantity === 1 && s.shops.some(shop => shop.id === r.shopId && siteMap.get(shop.buildingId)?.kind === 'workshop'), '实购物料供应');
            num(r.purchasedAt, t.startedAt, now, '购买时钟');
            num(r.gross, EPS, 20, '实付正额');
            num(r.net, 0, r.gross, '供应净额');
            num(r.tax, 0, r.gross, '税');
            close(r.gross, r.net + r.tax, '净税守恒');
            close(r.unitPrice, r.gross, '整份价');
            close(t.purchasePaid, r.gross, '采购账');
            ensure(t.state !== 'awaitingSupply', '已收货状态');
        }
        else
            ensure(t.purchasePaid === 0 && ['awaitingSupply', 'cancelled'].includes(t.state) && t.collectionMinutes === 0 && t.intakeMinutes === 0, '无物料不交接');
        for (const stage of ['collection', 'intake'] as const) {
            const rows = stage === 'collection' ? t.collectionLabor : t.intakeLabor, worked = stage === 'collection' ? t.collectionMinutes : t.intakeMinutes;
            num(worked, 0, HANDOFF, '交接时数');
            ensure(Array.isArray(rows) && rows.length <= 4096, '劳动回执');
            let sum = 0, last = stage === 'collection' ? Math.max(t.startedAt, t.receipt?.purchasedAt ?? t.startedAt) : t.intakeRequestedAt ?? t.startedAt;
            for (const r of rows) {
                ensure(obj(r) && s.citizens.some(p => p.id === r.actorId) && ['医生', 'doctor'].includes(r.role) && r.siteId === (stage === 'collection' ? b!.siteId : t.destinationSiteId), '当时合资格劳动主体');
                num(r.age, 18, s.extension!.actorProfiles[r.actorId].age, '成年资格');
                num(r.start, last, t.lastObservedAt, '工资起点');
                num(r.end, r.start + EPS, Math.min(t.lastObservedAt, stage === 'collection' ? t.pickedAt ?? t.lastObservedAt : t.deliveredAt ?? t.lastObservedAt), '工资终点');
                last = r.end;
                sum += r.end - r.start;
            }
            close(sum, worked, '实际片段分钟');
        }
        if (t.pickedAt === null) {
            ensure(t.pickupPoint === null && t.cargoPosition === null && t.pickedContainedUnits === 0 && t.traveledDistance === 0 && t.intakeMinutes === 0 && t.intakeRequestedAt === null && t.deliveredAt === null && t.strandedAt === null && !['carried', 'awaitingIntake', 'received', 'stranded'].includes(t.state), '未提取仍源地保管');
        }
        else {
            num(t.pickedAt, t.startedAt + HANDOFF, now, '提取时钟');
            point(t.pickupPoint, '原交接位置');
            point(t.cargoPosition, '当前货物位置');
            ensure(t.collectionMinutes === HANDOFF && t.receipt && ['carried', 'awaitingIntake', 'received', 'stranded'].includes(t.state) && t.cancelledAt === null, '真实物料劳动才提取');
            num(t.pickedContainedUnits, 0, 2, '原实际安全收集份额');
            ensure(Number.isInteger(t.pickedContainedUnits), '整数份额');
            sourcePicked.set(b!.id, (sourcePicked.get(b!.id) ?? 0) + 2);
            num(t.traveledDistance, 0, 1e12, '真实观察距离');
            ensure(t.traveledDistance + EPS >= distance(t.pickupPoint!, t.cargoPosition!), '不可伪造少于端点的搬运距离');
        }
        if (t.intakeRequestedAt !== null) {
            num(t.intakeRequestedAt, t.pickedAt ?? now, now, '实际提交接收起点');
            ensure(['awaitingIntake', 'received', 'stranded'].includes(t.state), '接收请求原状态');
        }
        else
            ensure(t.intakeMinutes === 0 && !['awaitingIntake', 'received'].includes(t.state), '未请求不能消耗接收劳动');
        if (t.state === 'readyForPickup')
            ensure(t.collectionMinutes === HANDOFF, '提取前真实完成');
        if (t.state === 'received') {
            num(t.deliveredAt, t.pickedAt! + HANDOFF, now, '接收时钟');
            ensure(t.intakeMinutes === HANDOFF && distance(t.cargoPosition!, t.destinationPoint) <= 2 + EPS, '三份现目的地保管');
        }
        else
            ensure(t.deliveredAt === null, '未交付无凭空接收');
        if (t.state === 'cancelled')
            num(t.cancelledAt, t.startedAt, now, '取消时钟');
        else
            ensure(t.cancelledAt === null, '取消唯一');
        if (t.state === 'stranded') {
            num(t.strandedAt, t.pickedAt!, now, '货物遗留时钟');
            ensure(!s.extension!.actorProfiles.player.alive, '承运者真实死亡');
        }
        else
            ensure(t.strandedAt === null, '遗留唯一');
        if (reserving(t)) {
            active++;
            ensure(t.refunded === 0, '活动托管不能先退');
            if (t.pickedAt === null)
                sourceClaimed.set(b!.id, (sourceClaimed.get(b!.id) ?? 0) + 2);
        }
        else if (t.state === 'received' || t.state === 'cancelled')
            ensure(t.escrow <= Math.max(0, 20 - t.purchasePaid), '退款剩余继续托管');
    }
    ensure(active <= 1, '有限三份承运容量');
    for (const b of s.hygiene!.batches) {
        ensure((sourcePicked.get(b.id) ?? 0) <= b.sealedUnits * 2 && (sourceClaimed.get(b.id) ?? 0) + (sourcePicked.get(b.id) ?? 0) <= b.sealedUnits * 2, '原封存不复制');
        ensure(b.containedUnits <= b.generatedUnits + b.cleaningResidualUnits - (sourcePicked.get(b.id) ?? 0), '搬出不仍算源地库存');
        const contained = (s.hygiene!.batches.filter(other => other.siteId === b.siteId && other.floor === b.floor && other.pointId === b.pointId).reduce((n, other) => n + other.containedUnits, 0));
        ensure(contained + transferStationOccupied(s, b.siteId, b.floor, b.pointId) <= CAPACITY, '所有真实保管和空间预约共享容量');
    }
    for (const t of transfers.tasks)
        ensure(capacity(s, t.destinationSiteId, t.destinationFloor, t.destinationPointId) <= CAPACITY, '目的无无限保管');
}
