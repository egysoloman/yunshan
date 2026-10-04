import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation';
import { PerspectiveCamera } from 'three';
import { PlayerController } from '../src/controller';
import { findBuildingFloorPlanRoute, getBuildingUsePoints } from '../src/architecture-floor-plan';
import { transferStationOccupied, transferredSourceUnits, type HygieneTransfer } from '../src/simulation/hygiene-transfer';
import { partitionSave, assembleSave } from '../src/persistence/partition';
import { fixture, pin, attachControls, station, advance, begin, cash as oldCash, runtime, type Controls } from './clinical-presence-fixture';
import { finitePublicShift, restrictRemainingShift } from './education-fixture';
import type { Building } from '../src/types';
function setup() {
    const world = fixture(), original = world.buildings.find(b => b.kind === 'clinic')!;
    const destination: Building = { ...original, id: 'pair-clinic-receiving', name: '收运保管医馆', position: { x: 360, y: 0, z: 105 }, door: { x: 360, y: .6, z: 124 }, functionPoints: undefined };
    destination.functionPoints = Array.from({ length: destination.floors }, (_, f) => getBuildingUsePoints(destination, f)).flat();
    world.buildings.push(destination);
    world.nodes.push({ id: destination.id + '-door', name: destination.name, districtId: destination.districtId, position: destination.door, station: true });
    world.edges.push({ id: 'pair-receiving-road', mode: 'road', from: original.id + '-door', to: destination.id + '-door', length: 105, capacity: 20, points: [original.door, destination.door] });
    const sim = new Simulation(world), controls: Controls = new Map();
    assert.equal(sim.command({ type: 'speed', value: 8 }).ok, true);
    const doctors = [original, destination].map(b => sim.state.citizens.find(p => p.workId === b.id && p.role === '医生' && sim.state.extension!.actorProfiles[p.id].age >= 18)!);
    assert(doctors.every(Boolean), 'real initial employment, no forged roles');
    for (const p of sim.state.citizens) {
        const home = world.buildings.find(b => b.id === p.homeId)!;
        pin(sim, controls, p.id, home, home.door);
    }
    for (let i = 0; i < 2; i++)
        pin(sim, controls, doctors[i].id, [original, destination][i], station([original, destination][i], 0), 'work');
    attachControls(sim, controls);
    sim.setFocus(station(original, 0), 'walk');
    sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
    sim.state.extension!.actorProfiles.player.health = 50;
    advance(sim, 4);
    const care = begin(sim, original);
    for (let i = 0; care.state !== 'completed' && i < 100; i++)
        advance(sim, 2);
    assert.equal(care.state, 'completed', care.lastReason);
    const batch = sim.state.hygiene!.batches[0];
    assert.equal(sim.command({ type: 'disinfectWaste', targetId: batch.id }).ok, true);
    const cleaning = sim.state.hygiene!.jobs.at(-1)!;
    for (let i = 0; cleaning.state !== 'completed' && i < 100; i++)
        advance(sim, 2);
    assert.equal(cleaning.state, 'completed', cleaning.reason);
    assert.equal(batch.sealedUnits, 1);
    assert.equal(batch.containedUnits, 2);
    return { sim, controls, original, destination, doctors, batch };
}
const cash = (sim: Simulation) => oldCash(sim) + (sim.state.hygiene?.jobs.reduce((n, j) => n + j.escrow, 0) ?? 0) + (sim.state.hygiene?.transfers?.tasks.reduce((n, t) => n + t.escrow, 0) ?? 0);
function start(c: ReturnType<typeof setup>) { const result = c.sim.command({ type: 'transferWaste', targetId: JSON.stringify([c.batch.id, c.destination.id]) }); assert.equal(result.ok, true, result.message); return c.sim.state.hygiene!.transfers!.tasks.at(-1)!; }
function ready(c: ReturnType<typeof setup>, t = start(c)) { for (let i = 0; t.state !== 'readyForPickup' && i < 50; i++)
    advance(c.sim, 2); assert.equal(t.state, 'readyForPickup', t.reason); return t; }
function pick(c: ReturnType<typeof setup>, t = ready(c)) { const r = c.sim.command({ type: 'collectWasteTransfer', targetId: t.id }); assert.equal(r.ok, true, r.message); return t; }
function snapshot(c: ReturnType<typeof setup>, label: string) { const dir = process.env.YUNSHAN_TRANSFER_ARTIFACT_DIR ?? `evidence/transfer/${process.pid}`; mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${label}.save.json`, c.sim.exportSave()); }
function restore(c: ReturnType<typeof setup>) { const saved = c.sim.exportSave(), reader = new Simulation(c.sim.worldDefinition), r = reader.importSave(saved); assert.equal(r.ok, true, r.message); assert.equal(reader.exportSave(), saved); assert.equal(assembleSave(partitionSave(saved, c.sim.worldDefinition)), saved); attachControls(reader, c.controls); for (let i = 0; i < 24; i++) {
    c.sim.step(.25);
    reader.step(.25);
    assert.equal(reader.exportSave(), c.sim.exportSave(), `full-save future ${i + 1}`);
} }
function reject(c: ReturnType<typeof setup>, mutate: (data: any) => void) { const saved = c.sim.exportSave(), d = JSON.parse(saved); mutate(d); const r = c.sim.importSave(JSON.stringify(d)); assert.equal(r.ok, false, 'bad custody must reject'); assert.equal(c.sim.exportSave(), saved, 'bad import is atomic'); }
test('real sealed source pairs retain finite paid handoffs, material, money, local capacity and native save', () => {
    const c = setup(), before = cash(c.sim), wallet = c.sim.state.player.money;
    snapshot(c, 'sealed-before-start');
    const t = start(c);
    assert.equal(c.sim.state.player.money, wallet - 20);
    assert.equal(t.receipt, null);
    assert.equal(transferStationOccupied(c.sim.state, c.destination.id, 0, t.destinationPointId), 3);
    ready(c, t);
    assert(t.purchasePaid > 0);
    assert.equal(t.receipt!.quantity, 1);
    assert.equal(t.collectionMinutes, 2);
    assert.equal(t.intakeMinutes, 0);
    assert.equal(c.batch.containedUnits, 2);
    snapshot(c, 'ready-before-pickup');
    restore(c);
    pick(c, t);
    assert.equal(c.batch.containedUnits, 0);
    assert.equal(transferredSourceUnits(c.sim.state, c.batch.id), 2);
    assert.equal(c.batch.sealedUnits, 1, 'cumulative source stays unchanged');
    assert.equal(c.sim.command({ type: 'cancelWasteTransfer', targetId: t.id }).ok, false);
    assert.equal(c.sim.command({ type: 'collectWasteTransfer', targetId: t.id }).ok, false);
    assert.equal(c.sim.command({ type: 'deliverWasteTransfer', targetId: t.id }).ok, false, 'remote acceptance forbidden');
    snapshot(c, 'carried');
    restore(c);
    // Controlled position only isolates destination wage/capacity. The separate
    // Controller-W case proves real no-reset transport; this is not ordinary UI.
    c.sim.setFocus(station(c.destination, 0), 'walk');
    assert.equal(c.sim.command({ type: 'deliverWasteTransfer', targetId: t.id }).ok, true);
    advance(c.sim, 2);
    assert.equal(t.state, 'received', t.reason);
    assert.equal(t.intakeMinutes, 2);
    assert.equal(transferStationOccupied(c.sim.state, c.destination.id, 0, t.destinationPointId), 3);
    assert.equal(t.funded, t.purchasePaid + t.refunded + t.escrow);
    assert.equal(t.escrow, 0);
    assert.ok(Math.abs(cash(c.sim) - before) < 1e-5, 'actual supplier net+tax+escrow conserved');
    assert.equal(c.batch.generatedUnits + c.batch.cleaningResidualUnits, 2);
    assert.equal(c.sim.command({ type: 'transferWaste', targetId: JSON.stringify([c.batch.id, c.destination.id]) }).ok, false, 'same pair cannot transfer twice');
    snapshot(c, 'received');
    restore(c);
});
test('no whole material stock cannot purchase or create handoff and cancelled bought kit stays source-owned', () => {
    const c = setup();
    for (const shop of c.sim.state.shops)
        if (c.sim.shopCommodity(shop) === 'materials')
            shop.inventory = 0;
    c.sim.onPhase('traffic', s => { for (const shop of s.shops)
        if (c.sim.shopCommodity(shop) === 'materials')
            shop.inventory = 0; });
    const before = cash(c.sim), t = start(c);
    advance(c.sim, 10);
    assert.equal(t.receipt, null);
    assert.equal(t.purchasePaid, 0);
    assert.equal(t.collectionMinutes, 0);
    assert.equal(c.sim.command({ type: 'cancelWasteTransfer', targetId: t.id }).ok, true);
    assert.equal(t.refunded, 20);
    assert.equal(c.batch.containedUnits, 2);
    assert.ok(Math.abs(cash(c.sim) - before) < 1e-5);
    restore(c);
    const paid = setup(), u = start(paid), total = cash(paid.sim);
    advance(paid.sim, 2);
    assert(u.receipt);
    assert.equal(paid.sim.command({ type: 'cancelWasteTransfer', targetId: u.id }).ok, true);
    assert.equal(u.receipt!.quantity, 1, 'unused purchased kit remains named at source, never silently deleted');
    assert.equal(u.purchasePaid + u.refunded, 20);
    assert.ok(Math.abs(cash(paid.sim) - total) < 1e-5);
    assert.equal(paid.sim.command({ type: 'cancelWasteTransfer', targetId: u.id }).ok, false);
    restore(paid);
});
for (const mode of ['absent', 'other-floor', 'wrong-role', 'minor', 'dead', 'no-wage'] as const)
    test(`${mode} source doctor cannot create any transfer handoff`, () => {
        const c = setup(), t = start(c), doctor = c.doctors[0], home = c.sim.worldDefinition.buildings.find(b => b.id === doctor.homeId)!;
        if (mode === 'absent')
            pin(c.sim, c.controls, doctor.id, home, home.door);
        if (mode === 'other-floor')
            pin(c.sim, c.controls, doctor.id, c.original, station(c.original, 1), 'work');
        if (mode === 'wrong-role')
            doctor.role = '商人';
        if (mode === 'minor')
            c.sim.state.extension!.actorProfiles[doctor.id].age = 17;
        if (mode === 'dead')
            c.sim.state.extension!.actorProfiles[doctor.id].health = 0;
        if (mode === 'no-wage') {
            pin(c.sim, c.controls, doctor.id, home, home.door);
            const plan = finitePublicShift({ ...c, site: c.original, teacher: doctor, earned: () => ({ minutes: runtime(c.sim).attendance[doctor.id] ?? 0, amount: 0 }) });
            restrictRemainingShift(plan, 0);
            pin(c.sim, c.controls, doctor.id, c.original, station(c.original, 0), 'work');
        }
        advance(c.sim, 10);
        assert.equal(t.collectionMinutes, 0);
        assert.equal(t.pickedAt, null);
        assert.equal(c.sim.command({ type: 'collectWasteTransfer', targetId: t.id }).ok, false);
        assert.equal(c.batch.containedUnits, 2);
    });
test('destination cannot accept remotely, without real intake doctor or with blocked station', () => {
    const c = setup(), t = pick(c), doctor = c.doctors[1], home = c.sim.worldDefinition.buildings.find(b => b.id === doctor.homeId)!;
    pin(c.sim, c.controls, doctor.id, home, home.door);
    c.sim.setFocus(station(c.destination, 0), 'walk');
    assert.equal(c.sim.command({ type: 'deliverWasteTransfer', targetId: t.id }).ok, true);
    advance(c.sim, 6);
    assert.equal(t.intakeMinutes, 0);
    assert.equal(t.state, 'awaitingIntake');
    restore(c);
    const pos = station(c.destination, 0);
    c.sim.state.voxels.push({ id: 'transfer-block', position: { x: pos.x, y: pos.y + .8, z: pos.z }, color: '#333' });
    assert.equal(c.sim.command({ type: 'deliverWasteTransfer', targetId: t.id }).ok, false);
    advance(c.sim, 2);
    assert.equal(t.intakeMinutes, 0);
});
test('finite three-unit kit, individual task and destination capacity reject fabricated unlimited packing', () => {
    const c = setup(), t = start(c);
    assert.equal(c.sim.command({ type: 'transferWaste', targetId: JSON.stringify([c.batch.id, c.destination.id]) }).ok, false);
    assert.equal(c.sim.command({ type: 'transferWaste', targetId: JSON.stringify([c.batch.id, c.original.id]) }).ok, false);
    reject(c, d => { delete d.state.hygiene.transfers; });
    reject(c, d => { delete d.runtime.hygieneTransferVersion; });
    reject(c, d => { d.runtime.hygieneTransferVersion = 2; });
    reject(c, d => { d.state.hygiene.version = 1; });
    reject(c, d => { d.runtime.hygieneVersion = 1; });
    reject(c, d => { d.state.hygiene.transfers.tasks[0].destinationPointId = 'ghost'; });
    reject(c, d => { d.state.hygiene.transfers.tasks[0].escrow += 1; });
    reject(c, d => { d.state.hygiene.transfers.tasks[0].collectionMinutes = 2; });
    reject(c, d => { d.state.hygiene.transfers.tasks[0].state = 'received'; });
    snapshot(c, 'partial');
    restore(c);
});
test('death preserves three named cargo units at last actual position and releases future destination reservation', () => {
    const c = setup(), t = pick(c), before = cash(c.sim), pos = { ...c.sim.state.player.position };
    c.sim.state.extension!.actorProfiles.player.health = 0;
    advance(c.sim, 2);
    assert.equal(t.state, 'stranded');
    assert.deepEqual(t.cargoPosition, pos);
    assert.equal(t.receipt!.quantity, 1);
    assert.equal(t.pickedAt !== null, true);
    assert.equal(transferStationOccupied(c.sim.state, c.destination.id, 0, t.destinationPointId), 0);
    assert.equal(c.sim.command({ type: 'cancelWasteTransfer', targetId: t.id }).ok, false);
    assert.equal(c.sim.command({ type: 'deliverWasteTransfer', targetId: t.id }).ok, false);
    assert.ok(Math.abs(cash(c.sim) - before) < 1e-5);
    snapshot(c, 'stranded');
    restore(c);
});
test('same-phase forged wage cannot replace native funded doctor labor', () => {
    const c = setup(), doctor = c.doctors[0], t = start(c), home = c.sim.worldDefinition.buildings.find(b => b.id === doctor.homeId)!;
    pin(c.sim, c.controls, doctor.id, home, home.door);
    const plan = finitePublicShift({ ...c, site: c.original, teacher: doctor, earned: () => ({ minutes: runtime(c.sim).attendance[doctor.id] ?? 0, amount: 0 }) });
    restrictRemainingShift(plan, 0);
    pin(c.sim, c.controls, doctor.id, c.original, station(c.original, 0), 'work');
    let forged = 0;
    c.sim.onEvent('clinical-activity-window', e => { if (e.citizenId === doctor.id) {
        forged++;
        c.sim.emitEvent({ type: 'wage-earned', citizenId: doctor.id, siteId: c.original.id, minutes: e.activityWindowEndAt! - e.activityWindowStartAt!, amount: 1, creditedWorkStartAt: e.activityWindowStartAt, creditedWorkEndAt: e.activityWindowEndAt });
    } });
    advance(c.sim, 8);
    assert(forged > 0);
    assert.equal(t.collectionMinutes, 0);
    assert.equal(t.pickedAt, null);
});
test('actual immutable old save stays byte-identical and twenty-four native ticks without backfilling transfer', () => {
    const saved = gunzipSync(readFileSync(new URL('./fixtures/public-disinfection-old-public-care-a1.json.gz', import.meta.url))).toString('utf8');
    assert.equal(createHash('sha256').update(saved).digest('hex'), '037f1bc6ae63ea062ada1268d737c22610473f9af2bfc845ab50175a87282618');
    const a = new Simulation(fixture()), b = new Simulation(fixture());
    for (const sim of [a, b]) {
        const r = sim.importSave(saved);
        assert.equal(r.ok, true, r.message);
        assert.equal(sim.exportSave(), saved);
    }
    for (let i = 0; i < 24; i++) {
        a.step(.25);
        b.step(.25);
        assert.equal(a.exportSave(), b.exportSave());
        assert.equal(a.state.hygiene?.transfers, undefined);
    }
    assert.equal(assembleSave(partitionSave(a.exportSave(), a.worldDefinition)), a.exportSave());
});
test('real clinical units filling the receiving station deny new three-unit reservation', () => {
    const c = setup();
    c.sim.setFocus(station(c.destination, 0), 'walk');
    const patients = c.sim.state.citizens.filter(p => !c.doctors.includes(p) && c.sim.state.extension!.actorProfiles[p.id].age >= 18).slice(0, 6);
    assert.equal(patients.length, 6);
    for (const patient of patients) {
        pin(c.sim, c.controls, patient.id, c.destination, station(c.destination, 0));
        c.sim.state.extension!.actorProfiles[patient.id].health = 50;
        const care = begin(c.sim, c.destination, patient.id);
        for (let i = 0; care.state !== 'completed' && i < 100; i++)
            advance(c.sim, 2);
        assert.equal(care.state, 'completed', care.lastReason);
    }
    const held = c.sim.state.hygiene!.batches.filter(b => b.siteId === c.destination.id).reduce((sum, b) => sum + b.containedUnits, 0);
    assert.equal(held, 6, 'six source units came from six actual clinical consumptions');
    c.sim.setFocus(station(c.original, 0), 'walk');
    const before = c.sim.exportSave();
    assert.equal(c.sim.command({ type: 'transferWaste', targetId: JSON.stringify([c.batch.id, c.destination.id]) }).ok, false);
    assert.equal(c.sim.exportSave(), before, 'rejected capacity creates no kit, budget or reservation');
    snapshot(c, 'destination-full');
    restore(c);
});
test('CPU Controller W carries the same three-unit package from source room along actual road to receiving room without reset', () => {
    const c = setup(), t = ready(c), keys = Object.assign(new EventTarget(), { closest: () => null }), doc = Object.assign(new EventTarget(), { pointerLockElement: null });
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'window', { value: keys, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
    const controller = new PlayerController(new PerspectiveCamera(), new EventTarget() as HTMLCanvasElement, c.sim.worldDefinition, () => { }, () => true, () => c.sim.state.voxels, () => c.sim.state);
    controller.setMode('walk', c.sim.state.player.position);
    let steps = 0, maxStep = 0, seconds = 0;
    const event = (type: string) => { const e = new Event(type); Object.assign(e, { code: 'KeyW', repeat: false }); keys.dispatchEvent(e); };
    try {
        pick(c, t);
        const source = findBuildingFloorPlanRoute(c.original, 0, 0, controller.position, c.original.door, .35);
        assert(source);
        const target = station(c.destination, 0), inside = findBuildingFloorPlanRoute(c.destination, 0, 0, c.destination.door, target, .35);
        assert(inside);
        const path = [...source, c.destination.door, ...inside.slice(1)];
        event('keydown');
        for (const point of path.slice(1)) {
            let segment = 0;
            while (Math.hypot(controller.position.x - point.x, controller.position.z - point.z) > .03) {
                const before = controller.position, dx = point.x - before.x, dz = point.z - before.z, dt = Math.min(.015, Math.hypot(dx, dz) / 4.8);
                controller.yaw = Math.atan2(-dx, -dz);
                controller.step(dt, false);
                const horizontal = Math.hypot(controller.position.x - before.x, controller.position.z - before.z);
                assert(horizontal > 1e-5, `actual W blocked ${JSON.stringify({ before, point, floor: controller.floor })}`);
                assert(horizontal <= .0720001, 'normal movement speed, no teleport');
                maxStep = Math.max(maxStep, horizontal);
                c.sim.setFocus(controller.position, 'walk');
                seconds += dt;
                steps++;
                if (steps % 17 === 0)
                    c.sim.step(.25);
                assert(++segment < 6000);
            }
        }
        event('keyup');
        assert.equal(t.state, 'carried');
        assert(c.sim.isAtBuildingFunctionPoint(c.destination, c.sim.state.player.position, 'service'));
        const r = c.sim.command({ type: 'deliverWasteTransfer', targetId: t.id });
        assert.equal(r.ok, true, r.message);
        advance(c.sim, 2);
        assert.equal(t.state, 'received', t.reason);
        assert(t.traveledDistance > 100);
        assert.equal(c.batch.containedUnits, 0);
        assert.equal(t.intakeMinutes, 2);
        assert.equal(transferStationOccupied(c.sim.state, c.destination.id, 0, t.destinationPointId), 3);
        snapshot(c, 'real-W-received');
        const dir = process.env.YUNSHAN_TRANSFER_ARTIFACT_DIR ?? `evidence/transfer/${process.pid}`;
        writeFileSync(`${dir}/real-W-receipt.json`, JSON.stringify({ scope: 'CPU EventTarget W with explicit initial standing position and controlled employed doctor stations, no reset after pickup; not normal URL or natural commuting', steps, maxStep, seconds, traveledDistance: t.traveledDistance, sourceId: c.original.id, destinationId: c.destination.id, collectionMinutes: t.collectionMinutes, intakeMinutes: t.intakeMinutes, terminalDisposalImplemented: false }, null, 2));
        restore(c);
    }
    finally {
        event('keyup');
        controller.dispose();
        if (oldWindow)
            Object.defineProperty(globalThis, 'window', oldWindow);
        else
            Reflect.deleteProperty(globalThis, 'window');
        if (oldDocument)
            Object.defineProperty(globalThis, 'document', oldDocument);
        else
            Reflect.deleteProperty(globalThis, 'document');
    }
});
test('cancelled purchased transport kits retain one actual source unit each and cannot overflow the same eight-unit station', () => {
    const c = setup(), before = cash(c.sim);
    for (let n = 0; n < 6; n++) {
        const t = start(c);
        advance(c.sim, 2);
        assert(t.receipt);
        assert.equal(c.sim.command({ type: 'cancelWasteTransfer', targetId: t.id }).ok, true);
        assert.equal(t.pickedAt, null);
        assert.equal(t.receipt!.quantity, 1);
        assert.equal(t.purchasePaid + t.refunded, 20);
    }
    assert.equal(c.batch.containedUnits, 2);
    assert.equal(transferStationOccupied(c.sim.state, c.original.id, c.batch.floor, c.batch.pointId), 6);
    const saved = c.sim.exportSave();
    assert.equal(c.sim.command({ type: 'transferWaste', targetId: JSON.stringify([c.batch.id, c.destination.id]) }).ok, false);
    assert.equal(c.sim.exportSave(), saved);
    assert.ok(Math.abs(cash(c.sim) - before) < 1e-5);
    snapshot(c, 'source-kit-capacity');
    restore(c);
});
test('impossible purchase-before-collection, pickup-before-labor and intake-before-delivery histories reject atomically', () => {
    const c = setup(), t = pick(c);
    reject(c, d => { const j = d.state.hygiene.transfers.tasks[0]; j.receipt.purchasedAt = j.pickedAt; });
    reject(c, d => { const j = d.state.hygiene.transfers.tasks[0]; j.pickedAt = j.startedAt + 2; });
    advance(c.sim, 6); // Real wait makes forged earlier delivery strictly precede actual intake labor.
    c.sim.setFocus(station(c.destination, 0), 'walk');
    assert.equal(c.sim.command({ type: 'deliverWasteTransfer', targetId: t.id }).ok, true);
    advance(c.sim, 2);
    assert.equal(t.state, 'received');
    reject(c, d => { const j = d.state.hygiene.transfers.tasks[0]; j.deliveredAt = j.pickedAt + 2; });
    reject(c, d => { const j = d.state.hygiene.transfers.tasks[0]; delete j.intakeRequestedAt; });
    // One historical picked pair and a second unpicked claim must be added,
    // rather than independently compared with the same source stock.
    reject(c, d => { const old = d.state.hygiene.transfers.tasks[0]; const fresh = structuredClone(old); Object.assign(fresh, { id: 'hygiene-transfer-2', state: 'awaitingSupply', reason: 'controlled invalid duplicate claim', escrow: 20, purchasePaid: 0, refunded: 0, receipt: null, collectionMinutes: 0, intakeMinutes: 0, collectionLabor: [], intakeLabor: [], pickedAt: null, pickupPoint: null, pickedContainedUnits: 0, cargoPosition: null, traveledDistance: 0, intakeRequestedAt: null, deliveredAt: null, cancelledAt: null, strandedAt: null }); d.state.hygiene.transfers.tasks.push(fresh); d.state.hygiene.transfers.nextId = 3; });
    restore(c);
});

test('actual medical care consumes its certified doctor front before any two-minute source transfer work', () => {
    const c = setup(), t = start(c), patient = c.sim.state.citizens.find(p => !c.doctors.includes(p) && c.sim.state.extension!.actorProfiles[p.id].age >= 18)!;
    pin(c.sim, c.controls, patient.id, c.original, station(c.original, 0));
    c.sim.state.extension!.actorProfiles[patient.id].health = 50;
    const care = begin(c.sim, c.original, patient.id);
    advance(c.sim, 2); // Both contracts procure only after the original people phase.
    assert(t.receipt);
    advance(c.sim, 8);
    assert.equal(care.workedMinutes, 8);
    assert.equal(t.collectionMinutes, 0, 'the same native funded minutes cannot perform medical care and transfer handoff twice');
    const home = c.sim.worldDefinition.buildings.find(b => b.id === patient.homeId)!;
    pin(c.sim, c.controls, patient.id, home, home.door);
    advance(c.sim, 2);
    assert.equal(t.collectionMinutes, 2);
    assert.equal(t.state, 'readyForPickup');
    assert.equal(care.workedMinutes, 8, 'paused clinical order retains its actual partial work');
    snapshot(c, 'joint-clinical-transfer');
    restore(c);
});
