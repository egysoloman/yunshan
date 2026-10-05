import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../src/simulation';
import { blocksFloorPlanMovement, buildingWorldPosition, floorPlanSupport, getBuildingFloorPlan, getBuildingUsePoints } from '../src/architecture-floor-plan';
import { researchPlayerContextReason, researchProgressInfo } from '../src/simulation/extensions';
import type { AttendedResearchJob, SimState } from '../src/types';
import type { ClinicalOrder } from '../src/simulation/clinical';
import { core, createResearchCity, extension, fundedNpc, marked, ok, researchWorld, ticks, workPoint } from './fixtures/research-city';

const approx = (a: number, b: number) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

test('onsite120 actual minutes finish once; partial new saves resume byte-exact for24 ticks', () => {
  const { world, sim } = createResearchCity(); ok(sim, { type: 'research', targetId: 'medicine', value: 200 });
  const start = extension(sim).lastUpdate, skill = extension(sim).actorProfiles.player.skill;
  ticks(sim, 15); approx(marked(sim).workedMinutes, 60);
  const saved = sim.exportSave(), restored = new Simulation(world); assert(restored.importSave(saved).ok); assert.equal(restored.exportSave(), saved);
  for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave(), `new save continuation tick${i + 1}`); }
  assert.equal(extension(sim).runtime.researchJobs.medicine, undefined);
  const tech = extension(sim).technologies.find(t => t.sector === 'medicine')!;
  assert.equal(tech.level, 1); assert.equal(tech.funding, 0); assert.equal(extension(sim).stats.researchCompleted, 1);
  assert(extension(sim).lastUpdate >= start + 120); assert(extension(sim).actorProfiles.player.skill >= skill + 2);
  assert.equal(extension(sim).publicLedger.filter(row => row.actorId === 'player' && row.purpose.includes('科研投入')).length, 1);
});

test('leave/return pauses without historical catchup; displaytime and repeated people phase do not add labour', () => {
  const { world, point, sim } = createResearchCity(); ok(sim, { type: 'research', targetId: 'medicine', value: 200 });
  ticks(sim, 10); approx(marked(sim).workedMinutes, 40);
  sim.setFocus(world.spawn, 'walk'); ticks(sim, 20); approx(marked(sim).workedMinutes, 40); assert.equal(marked(sim).state, 'paused');
  const clock = extension(sim).lastUpdate; ok(sim, { type: 'setTime', value: 23 }); assert.equal(extension(sim).lastUpdate, clock); approx(marked(sim).workedMinutes, 40);
  ok(sim, { type: 'pause', value: 1 }); const paused = sim.exportSave(); sim.step(30); assert.equal(sim.exportSave(), paused); ok(sim, { type: 'pause', value: 0 });
  sim.setFocus(point, 'walk'); sim.step(.25); approx(marked(sim).workedMinutes, 44);
  const job = clone(marked(sim));
  const bus = Reflect.get(sim, 'bus') as { emit(event: { type: string }): void }; bus.emit({ type: 'system:people' });
  assert.deepEqual(marked(sim), job, 'same monotonic clock cannot spend another research phase');
});

test('real paid-work final phase cannot also research; terminal history releases the next phase', () => {
  const { sim, lab, world } = createResearchCity();
  ok(sim, { type: 'research', targetId: 'medicine', value: 100 }); ok(sim, { type: 'work', targetId: lab.id });
  const job = sim.state.playerLabor!.job!; ticks(sim, 14); approx(job.workedMinutes, 56); approx(marked(sim).workedMinutes, 0);
  sim.step(.25); assert.equal(sim.state.playerLabor!.job, null); assert.equal(job.status, 'completed'); approx(job.paidGross, 62); approx(marked(sim).workedMinutes, 0);
  const saved = sim.exportSave(), restored = new Simulation(world); assert(restored.importSave(saved).ok); assert.equal(restored.exportSave(), saved);
  sim.step(.25); restored.step(.25); approx(marked(sim).workedMinutes, 4); assert.equal(restored.exportSave(), sim.exportSave(), 'load clears old phase latch; terminal work cannot block a new phase');
});

test('newresearch admission after real work completion ignores spent phase latch and has zero instant labor', () => {
  const { sim, lab } = createResearchCity();
  // Controlled admission boundary: defer spectators' autonomous investments so
  // traffic remains an actually free sector; their work/wages/needs still run.
  for (const actor of sim.state.citizens) extension(sim).runtime.cooldowns[`research:${actor.id}`] = 1e9;
  ok(sim, { type: 'research', targetId: 'medicine', value: 100 }); ok(sim, { type: 'work', targetId: lab.id });
  ticks(sim, 15); assert.equal(sim.state.playerLabor!.job, null); assert.equal(sim.state.playerLabor!.history.at(-1)!.status, 'completed'); approx(marked(sim).workedMinutes, 0);
  ok(sim, { type: 'research', targetId: 'traffic', value: 100 }); approx(marked(sim, 'traffic').workedMinutes, 0); approx(marked(sim).workedMinutes, 0);
  sim.step(.25); approx(marked(sim, 'traffic').workedMinutes + marked(sim).workedMinutes, 4);
});

test('one player phase is shared across sectors rather than credited once per job', () => {
  const { sim } = createResearchCity(); ok(sim, { type: 'research', targetId: 'traffic', value: 100 }); ok(sim, { type: 'research', targetId: 'medicine', value: 100 });
  sim.step(.25); approx(marked(sim, 'traffic').workedMinutes + marked(sim).workedMinutes, 4); approx(marked(sim, 'traffic').workedMinutes, 4); approx(marked(sim).workedMinutes, 0);
});

test('real different-start player jobs remain feasible and resume24 completed ticks byte-exact', () => {
  const { sim, world } = createResearchCity(); ok(sim, { type: 'research', targetId: 'traffic', value: 100 }); sim.step(.25);
  ok(sim, { type: 'research', targetId: 'medicine', value: 100 }); sim.step(.25);
  assert.equal(marked(sim, 'traffic').startedAt + 4, marked(sim).startedAt); approx(marked(sim, 'traffic').workedMinutes, 8); approx(marked(sim).workedMinutes, 0);
  const saved = sim.exportSave(), restored = new Simulation(world), result = restored.importSave(saved); assert(result.ok, result.message); assert.equal(restored.exportSave(), saved);
  for (let i = 0; i < 24; i++) { sim.step(.25); restored.step(.25); assert.equal(restored.exportSave(), sim.exportSave()); }
});

test('death, leaving boundfloor, lost role and urgent needs cannot advance a funded job', async t => {
  const cases: { name: string; change(city: ReturnType<typeof createResearchCity>): void }[] = [
    { name: 'dead', change: ({ sim }) => { extension(sim).actorProfiles.player.alive = false; extension(sim).actorProfiles.player.health = 0; } },
    { name: 'other valid lab floor', change: ({ sim, lab }) => sim.setFocus(workPoint(lab, 1), 'walk') },
    { name: 'lost scientific identity', change: ({ sim }) => { sim.state.player.role = 'traveler'; sim.state.player.identities = ['traveler']; } },
    { name: 'hunger', change: ({ sim }) => { sim.state.player.needs.hunger = 39; } },
  ];
  for (const item of cases) await t.test(item.name, () => { const city = createResearchCity(); ok(city.sim, { type: 'research', targetId: 'medicine', value: 200 }); item.change(city); city.sim.step(.25); approx(marked(city.sim).workedMinutes, 0); assert.equal(marked(city.sim).state, 'paused'); });
});

test('actual lab body and ACL guards reject without money or save mutation', async t => {
  for (const issue of ['feet', 'voxel', 'permission'] as const) await t.test(issue, () => {
    const city = createResearchCity(), { sim, lab, point } = city;
    if (issue === 'feet') sim.setFocus({ ...point, y: point.y + .6 }, 'walk');
    if (issue === 'voxel') sim.state.voxels.push({ id: 'lab-block', position: { ...point, y: point.y + .8 }, color: '#888888' });
    if (issue === 'permission') { lab.publicFloors = 0; lab.floorPermissions = ['mayor', 'mayor', 'mayor']; }
    const before = sim.exportSave(); assert.equal(sim.command({ type: 'research', targetId: 'medicine', value: 200 }).ok, false); assert.equal(sim.exportSave(), before);
  });
});

test('NPC finance start spends its own200 and grants none of the already elapsed finance tick', () => {
  const { sim, lab, point } = createResearchCity(), funded = fundedNpc(sim, lab, point);
  assert.equal(funded.job.workedMinutes, 0); assert.equal(funded.job.startedAt, extension(sim).lastUpdate);
  let earned = 0; sim.onEvent('wage-earned', event => { if (event.citizenId === funded.actor.id) earned += event.minutes ?? 0; });
  sim.step(.25); assert(earned > 0); approx(funded.job.workedMinutes, Math.min(earned, 4));
  assert.equal(funded.job.actorId, funded.actor.id); assert.equal(funded.job.siteId, lab.id);
});

test('schema-valid existing zero-rate accrual emits positive real minutes and research uses minutes, not amount', () => {
  const { world, sim, lab, point } = createResearchCity(), funded = fundedNpc(sim, lab, point);
  const wire = JSON.parse(sim.exportSave()) as { runtime: { wageAccruals: { citizenId: string; workId: string; ratePerMinute: number; amount: number }[] } };
  const claim = wire.runtime.wageAccruals.find(c => c.citizenId === funded.actor.id && c.workId === lab.id); assert(claim); claim.ratePerMinute = 0; claim.amount = 0;
  // Controlled legitimate import edge: no injected wage event, no new money,
  // no change to actual accrued minutes or the attendance conservation equation.
  const restored = new Simulation(world); const result = restored.importSave(JSON.stringify(wire)); assert(result.ok, result.message);
  const actor = restored.state.citizens.find(c => c.id === funded.actor.id)!; restored.onPhase('traffic', () => funded.pin(restored, actor)); funded.pin(restored, actor);
  const events: { minutes: number; amount: number }[] = [];
  restored.onEvent('wage-earned', event => { if (event.citizenId === actor.id) events.push({ minutes: event.minutes ?? 0, amount: event.amount ?? NaN }); });
  restored.step(.25); assert(events.some(event => event.minutes > 0 && event.amount === 0));
  approx(marked(restored, funded.sector).workedMinutes, Math.min(4, events.reduce((sum, event) => sum + event.minutes, 0)));
  assert.equal(core(restored).wageAccruals.find(c => c.citizenId === actor.id && c.workId === lab.id)!.amount, 0);
});

test('ACTIVE actual work conflicts, while paused offsite/terminal history and stale service pointers do not permanently block', () => {
  const { sim, world, lab } = createResearchCity(), state = sim.state;
  ok(sim, { type: 'work', targetId: lab.id }); assert.match(researchPlayerContextReason(state, world, () => true), /工班/);
  const original = clone(state); state.playerLabor!.job!.status = 'paused'; assert.equal(researchPlayerContextReason(state, world, () => false), '');
  state.playerLabor!.job!.status = 'completed'; assert.equal(researchPlayerContextReason(state, world, () => true), '');
  state.playerLabor!.job = null;
  // Pure query records, not claimed to be complete schema-valid imported jobs.
  state.culture!.project = { genre: 'literature', title: '受控查询', text: '只验证只读冲突查询的活动状态与实际站点条件。', siteId: lab.id, startedAt: extension(sim).lastUpdate, workedMinutes: 1, requiredMinutes: 120, paid: 60 };
  assert.match(researchPlayerContextReason(state, world, () => true), /创作/); assert.equal(researchPlayerContextReason(state, world, () => false), '');
  state.culture!.project!.workedMinutes = 120; assert.equal(researchPlayerContextReason(state, world, () => true), '');
  state.culture!.project = null; state.culture!.playerServiceId = 'stale-order'; assert.equal(researchPlayerContextReason(state, world, () => true), '');
  assert.deepEqual(original.player.position, state.player.position, 'query does not move the actor');
  const clinic = world.buildings.find(b => b.kind === 'clinic')!, service = clinic.functionPoints!.find(p => p.floor === 0 && p.purpose === 'service')!;
  sim.setFocus(service.position, 'walk');
  const order = { patientId: 'player', siteId: clinic.id, state: 'awaitingDoctor' } as ClinicalOrder; state.clinical!.orders.push(order);
  for (const status of ['awaitingSupply', 'awaitingDoctor', 'inTreatment'] as const) { order.state = status; assert.match(researchPlayerContextReason(state, world, () => true), /诊疗/); }
  for (const status of ['refundPending', 'completed', 'cancelled'] as const) { order.state = status; assert.equal(researchPlayerContextReason(state, world, () => true), '', `${status} performs no clinical labour`); }
});

test('bad markers/actor/lab/floor/progress/future cursor are rejected atomically; leaving valid pending saves is allowed', async t => {
  const { world, sim } = createResearchCity(); ok(sim, { type: 'research', targetId: 'medicine', value: 200 }); ticks(sim, 1);
  type Wire = { state: SimState & { extension: ReturnType<typeof extension> } };
  const valid = JSON.parse(sim.exportSave()) as Wire;
  const corruptions: { name: string; change(wire: Wire, job: AttendedResearchJob): void }[] = [
    { name: 'partial runtime', change: wire => { delete wire.state.extension.runtime.researchLaborVersion; } },
    { name: 'partial job', change: (_wire, job) => { Reflect.deleteProperty(job, 'siteId'); } },
    { name: 'unknown actor', change: (_wire, job) => { job.actorId = 'unknown'; } },
    { name: 'unknown lab', change: (_wire, job) => { job.siteId = 'unknown'; } },
    { name: 'outside floor', change: (_wire, job) => { job.floor = 100; } },
    { name: 'progress mismatch', change: (_wire, job) => { job.workedMinutes++; } },
    { name: 'future cursor', change: (wire, job) => { job.lastObservedAt = wire.state.extension.lastUpdate + 1; } },
    { name: 'historical cursor', change: (_wire, job) => { job.lastObservedAt--; } },
  ];
  for (const item of corruptions) await t.test(item.name, () => { const wire = clone(valid), job = wire.state.extension.runtime.researchJobs.medicine; assert(job?.laborVersion === 1); item.change(wire, job); const before = sim.exportSave(); assert.equal(sim.importSave(JSON.stringify(wire)).ok, false); assert.equal(sim.exportSave(), before); });
  sim.setFocus(world.spawn, 'walk'); const departed = sim.exportSave(), restored = new Simulation(world); assert(restored.importSave(departed).ok); assert.equal(restored.exportSave(), departed); restored.step(.25); approx(marked(restored).workedMinutes, 4); assert.equal(marked(restored).state, 'paused');
});

test('old-schema pending research is migrated once and retains its historical timer/account contract', () => {
  const { world, sim } = createResearchCity(); ok(sim, { type: 'research', targetId: 'medicine', value: 200 });
  const wire = JSON.parse(sim.exportSave()) as { state: { extension: ReturnType<typeof extension> } }, runtime = wire.state.extension.runtime, job = runtime.researchJobs.medicine!;
  runtime.researchJobs.medicine = { startedAt: job.startedAt, finishAt: job.finishAt, budget: job.budget }; delete runtime.researchLaborVersion; delete runtime.legacyResearchSectors;
  const legacyBytes = JSON.stringify(wire), restored = new Simulation(world); assert(restored.importSave(legacyBytes).ok);
  assert.equal(restored.exportSave(), legacyBytes, 'loading preserves the entire historical save until actual progress');
  assert.deepEqual(extension(restored).runtime.researchJobs.medicine, runtime.researchJobs.medicine);
  assert.equal(extension(restored).runtime.legacyResearchSectors, undefined); assert.equal(researchProgressInfo(restored.state, 'medicine')!.legacy, true);
  restored.step(.25); assert.deepEqual(extension(restored).runtime.legacyResearchSectors, ['medicine']);
  restored.setFocus(world.spawn, 'walk'); ticks(restored, 29); assert.equal(extension(restored).technologies.find(t => t.sector === 'medicine')!.level, 1);
  assert.equal(extension(restored).publicLedger.filter(row => row.actorId === 'player' && row.purpose.includes('科研投入')).length, 1);
});

test('actual old14 command save imports with grandfather120 and one-time metadata migration', { skip: !process.env.YUNSHAN_RESEARCH_OLD_PENDING_DIR }, () => {
  const dir = process.env.YUNSHAN_RESEARCH_OLD_PENDING_DIR!, raw = readFileSync(join(dir, 'pending-save.json'), 'utf8');
  const proof = JSON.parse(readFileSync(join(dir, 'pending-provenance.json'), 'utf8')) as { sourceHashes: Record<string, string>; saveSHA256: string; playerCashAfter: number; treasuryAfter: number; job: { startedAt: number; finishAt: number; budget: number } };
  assert.equal(proof.sourceHashes['simulation/extensions.ts'], 'e317b0a0660faaef0aecd0928c71386c0e9a0c1d0654608d62b229ae8187a378');
  assert.equal(createHash('sha256').update(raw).digest('hex'), proof.saveSHA256);
  const world = researchWorld(), sim = new Simulation(world), result = sim.importSave(raw); assert(result.ok, result.message);
  assert.equal(sim.state.player.money, proof.playerCashAfter); assert.equal(sim.state.treasury, proof.treasuryAfter);
  assert.equal(sim.exportSave(), raw); assert.deepEqual(extension(sim).runtime.researchJobs.medicine, proof.job); assert.equal(extension(sim).runtime.legacyResearchSectors, undefined);
  const migrated = sim.exportSave(), again = new Simulation(world); assert(again.importSave(migrated).ok); assert.equal(again.exportSave(), migrated, 'already migrated save is not mutated again');
  sim.setFocus(world.spawn, 'walk'); again.setFocus(world.spawn, 'walk');
  for (let i = 0; i < 24; i++) { sim.step(.25); again.step(.25); assert.equal(again.exportSave(), sim.exportSave()); }
  ticks(sim, 6); assert.equal(extension(sim).lastUpdate, proof.job.finishAt); assert.equal(extension(sim).technologies.find(t => t.sector === 'medicine')!.level, 1);
  assert.equal(extension(sim).publicLedger.filter(row => row.actorId === 'player' && row.purpose.includes('科研投入')).length, 1);
});

test('actual old14 command legacy+new mixed research preserves original investment and24 exact continuation', { skip: !process.env.YUNSHAN_RESEARCH_OLD_PENDING_DIR }, () => {
  const dir = process.env.YUNSHAN_RESEARCH_OLD_PENDING_DIR!, raw = readFileSync(join(dir, 'pending-save.json'), 'utf8'), proof = JSON.parse(readFileSync(join(dir, 'pending-provenance.json'), 'utf8')) as { saveSHA256: string; playerCashAfter: number; job: { startedAt: number; finishAt: number; budget: number } };
  assert.equal(createHash('sha256').update(raw).digest('hex'), proof.saveSHA256);
  const world = researchWorld(), sim = new Simulation(world), loaded = sim.importSave(raw); assert(loaded.ok, loaded.message);
  assert.equal(sim.exportSave(), raw); assert.equal(sim.state.player.money, proof.playerCashAfter); assert.deepEqual(extension(sim).runtime.researchJobs.medicine, proof.job); assert.equal(extension(sim).runtime.legacyResearchSectors, undefined);
  ok(sim, { type: 'research', targetId: 'traffic', value: 100 }); assert.equal(sim.state.player.money, proof.playerCashAfter - 100); assert.equal(marked(sim, 'traffic').workedMinutes, 0);
  assert.deepEqual(extension(sim).runtime.researchJobs.medicine, proof.job); assert.deepEqual(extension(sim).runtime.legacyResearchSectors, ['medicine']);
  assert.equal(extension(sim).publicLedger.filter(row => row.actorId === 'player' && row.purpose.includes('科研投入')).reduce((sum, row) => sum + row.amount, 0), 300);
  const saved = sim.exportSave(), again = new Simulation(world), imported = again.importSave(saved); assert(imported.ok, imported.message); assert.equal(again.exportSave(), saved);
  for (let i = 0; i < 24; i++) { sim.step(.25); again.step(.25); assert.equal(again.exportSave(), sim.exportSave()); }
  approx(marked(sim, 'traffic').workedMinutes, 96); assert.equal(extension(sim).runtime.researchJobs.medicine!.laborVersion, undefined);
});

test('a provider-supported clear table top is not newly banned as an occupied fixture', () => {
  const { sim, lab } = createResearchCity(), plan = getBuildingFloorPlan(lab, 0)!;
  const candidates = plan.fixtures.filter(f => f.kind === 'table').map(f => buildingWorldPosition(lab, { x: (f.rect.x0 + f.rect.x1) / 2, y: plan.y + f.top, z: (f.rect.z0 + f.rect.z1) / 2 }));
  const top = candidates.find(point => floorPlanSupport(lab, 0, point, .35)?.kind === 'room' && !blocksFloorPlanMovement(lab, 0, point, point, .35, 1.72) && sim.isAtBuildingFunctionPoint(lab, point, 'work'));
  assert(top, 'real table top must satisfy the existing support and work-point authorities');
  sim.setFocus(top, 'walk'); ok(sim, { type: 'research', targetId: 'medicine', value: 200 }); sim.step(.25); approx(marked(sim).workedMinutes, 4);
});

test('support alone cannot grant raised feet whose real1.72m head intersects an upper slab', () => {
  const world = researchWorld(), lab = world.buildings.find(b => b.kind === 'school')!;
  // A separate short-storey controlled fixture; production geometry is untouched.
  lab.height = 6; lab.functionPoints = Array.from({ length: lab.floors }, (_, floor) => getBuildingUsePoints(lab, floor)).flat();
  const point = workPoint(lab), raised = { ...point, y: point.y + .2 }, sim = new Simulation(world);
  sim.state.player.role = 'scientist'; sim.state.player.identities = ['scientist']; sim.state.player.education = 3; sim.state.player.needs.hunger = sim.state.player.needs.fatigue = 100;
  assert(floorPlanSupport(lab, 0, raised, .35), 'the old floor-support query alone accepts the raised feet');
  assert.equal(blocksFloorPlanMovement(lab, 0, raised, raised, .35, 1.72), true, 'actual head volume intersects the original slab');
  sim.setFocus(raised, 'walk'); const before = sim.exportSave(); assert.equal(sim.command({ type: 'research', targetId: 'medicine', value: 200 }).ok, false); assert.equal(sim.exportSave(), before);
});
