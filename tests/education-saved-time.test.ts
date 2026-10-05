import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Simulation } from '../src/simulation.ts';
import { advance, attachControls, begin, cash, close, completePaidCourse, course, education, fixture, fundedMaterial, pin, restore24, setup, station, type Controls } from './education-fixture.ts';

// Recorded genuine saves use this exact controlled classroom world. Native
// teachers earn wages, actual courses each cost forty and use finite industrial
// textbooks, and the player passes the original eighty-coin scientist exam.
// The provenance records the actual commands and before-fix rejection failure.
function recorded(name: 'same' | 'different'): string {
  const saved = readFileSync(new URL(`./fixtures/education-${name}-start.save.json`, import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(saved).digest('hex'), name === 'same'
    ? '83d1cd18dc8450149fa461bd283dd12f07e27623c9e62c64c2ff577b4ae40735'
    : '5e7bfcae17a5a9eeba08eea1092d4ae23afddd223956010a413a4f5c4dc9bcb5');
  return saved;
}
function restored(saved: string): Simulation {
  const sim = new Simulation(fixture(true)), loaded = sim.importSave(saved);
  assert.equal(loaded.ok, true, loaded.message); assert.equal(sim.exportSave(), saved); return sim;
}
function forgeResearchOnly(sim: Simulation, worked: number): void {
  const genuine = sim.exportSave(), data = JSON.parse(genuine), job = data.state.extension.runtime.researchJobs.medicine;
  const technology = data.state.extension.technologies.find((item: any) => item.sector === 'medicine');
  const originalWorked = job.workedMinutes, originalProgress = technology.progress;
  assert.equal(job.actorId, 'player'); assert.equal(job.laborVersion, 1);
  job.workedMinutes = worked; technology.progress = worked / 120 * 100;
  assert.ok(worked <= data.state.extension.lastUpdate - job.startedAt + 1e-7, 'the original individual research bound still holds');
  const courses = [...data.state.education.history, ...(data.state.education.course ? [data.state.education.course] : [])];
  const cutoff = Math.min(job.startedAt, data.state.education.course?.startedAt ?? job.startedAt);
  const relevant = courses.filter(item => item.startedAt >= cutoff);
  for (const item of courses) assert.ok(item.workedMinutes <= item.lastObservedAt - item.startedAt + 1e-7, 'each original individual course bound still holds');
  assert.ok(relevant.reduce((sum, item) => sum + item.workedMinutes, worked) > data.state.extension.lastUpdate - cutoff + 1e-7, 'combined actor labor exceeds its actual suffix');
  const reverted = structuredClone(data);
  reverted.state.extension.runtime.researchJobs.medicine.workedMinutes = originalWorked;
  reverted.state.extension.technologies.find((item: any) => item.sector === 'medicine').progress = originalProgress;
  assert.equal(JSON.stringify(reverted), genuine, 'exactly the research minutes and matching technology progress were changed');
  const rejected = sim.importSave(JSON.stringify(data)); assert.equal(rejected.ok, false, 'joint saved labor must be rejected');
  assert.equal(sim.exportSave(), genuine, 'joint rejection leaves every live byte unchanged');
}
for (const name of ['same', 'different'] as const) test(`genuine ${name}-start course/research bytes continue exactly and reject the two-field coordinated forge`, () => {
  const saved = recorded(name), first = restored(saved), second = restored(saved), data = JSON.parse(saved);
  assert.equal(data.state.education.course.workedMinutes, name === 'same' ? 4 : 5);
  assert.equal(data.state.extension.runtime.researchJobs.medicine.workedMinutes, 0);
  forgeResearchOnly(first, data.state.extension.lastUpdate - data.state.extension.runtime.researchJobs.medicine.startedAt);
  for (let phase = 0; phase < 24; phase++) { first.step(.25); second.step(.25); assert.equal(first.exportSave(), second.exportSave(), `exact next phase ${phase + 1}`); }
});
test('a real completed sixty-minute course retained in history cannot be spent again by its same-start pending research', () => {
  const sim = restored(recorded('same')), current = course(sim), id = current.id, supply = cash(sim), beforeEducation = sim.state.player.education;
  const site = sim.worldDefinition.buildings.find(item => item.id === current.siteId)!;
  const teacher = sim.state.citizens.find(person => person.workId === site.id && person.role === '老师' && sim.state.extension!.actorProfiles[person.id].alive && sim.state.extension!.actorProfiles[person.id].age >= 18)!;
  const controls: Controls = new Map(); assert.ok(teacher); pin(sim, controls, teacher.id, site, station(site), 'work'); attachControls(sim, controls);
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true); advance(sim, 56);
  const completed = course(sim, id); assert.equal(completed.status, 'completed'); assert.equal(completed.workedMinutes, 60);
  assert.equal(education(sim)!.course, null); assert.equal(sim.state.player.education, beforeEducation + 1);
  const saved = sim.exportSave(), job = JSON.parse(saved).state.extension.runtime.researchJobs.medicine;
  assert.equal(job.startedAt, completed.startedAt); assert.equal(job.workedMinutes, 0); close(cash(sim), supply);
  const loaded = sim.importSave(saved); assert.equal(loaded.ok, true, loaded.message); assert.equal(sim.exportSave(), saved);
  forgeResearchOnly(sim, 60); restore24(sim, controls);
});
test('a genuinely earlier sixty-minute completed course leaves the later four-minute research suffix available', () => {
  const { sim, controls, site } = setup();
  for (let index = 0; index < 3; index++) completePaidCourse(sim, site);
  const qualified = sim.command({ type: 'exam', targetId: 'scientist' }); assert.equal(qualified.ok, true, qualified.message);
  const current = begin(sim); fundedMaterial(sim, current.id); advance(sim, 60);
  assert.equal(course(sim, current.id).status, 'completed'); advance(sim, 36);
  const result = sim.command({ type: 'research', targetId: 'medicine', value: 100 }); assert.equal(result.ok, true, result.message); advance(sim, 4);
  const saved = sim.exportSave(), job = JSON.parse(saved).state.extension.runtime.researchJobs.medicine;
  assert.ok(job.startedAt - current.startedAt >= 96); close(job.workedMinutes, 4);
  const loaded = sim.importSave(saved); assert.equal(loaded.ok, true, loaded.message); assert.equal(sim.exportSave(), saved); restore24(sim, controls);
});
test('a later present clock cannot legalize overlapping retained course windows before the previous actual clearing', () => {
  const { sim, controls } = setup();
  const first = begin(sim); fundedMaterial(sim, first.id); advance(sim, 4);
  assert.equal(first.receivedUnits, 1); assert.ok(first.receipt && first.purchasePaid > 0); assert.equal(first.workedMinutes, 4);
  const cancelled = sim.command({ type: 'cancelStudy', targetId: first.id }); assert.equal(cancelled.ok, true, cancelled.message);
  assert.equal(course(sim, first.id).status, 'cancelled'); assert.equal(first.escrow, 0); assert.ok(first.refunded > 0);
  const second = begin(sim); assert.equal(second.reusedUnits, 1); assert.equal(second.receivedUnits, 0); assert.equal(second.receipt, null);
  assert.equal(sim.command({ type: 'speed', value: 16 }).ok, true); advance(sim, 60);
  assert.equal(education(sim)!.course, null); assert.equal(course(sim, second.id).status, 'completed'); assert.equal(second.workedMinutes, 60);
  advance(sim, 60);
  const genuine = sim.exportSave(), data = JSON.parse(genuine), records = data.state.education.history;
  assert.equal(records.length, 2); assert.equal(records[0].id, first.id); assert.equal(records[1].id, second.id);
  assert.equal(records[0].workedMinutes, 4); assert.equal(records[1].workedMinutes, 60);
  const original = { startedAt: records[1].startedAt, lastObservedAt: records[1].lastObservedAt, completedAt: records[1].completedAt };
  assert.ok(original.startedAt >= records[0].cancelledAt, 'the actual reused-book course starts after the previous real cancellation');
  records[1].startedAt = records[0].startedAt;
  records[1].lastObservedAt = records[0].startedAt + 60;
  records[1].completedAt = records[0].startedAt + 60;
  assert.ok(records[1].startedAt < records[0].cancelledAt);
  for (const item of records) assert.ok(item.workedMinutes <= item.lastObservedAt - item.startedAt + 1e-7);
  assert.ok(records.reduce((sum: number, item: any) => sum + item.workedMinutes, 0) <= data.state.extension.lastUpdate - records[0].startedAt, 'the earlier suffix-to-now bound still holds');
  assert.ok(records[0].workedMinutes + records[1].workedMinutes > records[1].completedAt - records[0].startedAt);
  const reverted = structuredClone(data); Object.assign(reverted.state.education.history[1], original);
  assert.equal(JSON.stringify(reverted), genuine, 'only second-course start/last observation/completion changed; actual fees, textbooks, staff and statistics stay intact');
  const loaded = sim.importSave(genuine); assert.equal(loaded.ok, true, loaded.message); assert.equal(sim.exportSave(), genuine);
  const rejected = sim.importSave(JSON.stringify(data)); assert.equal(rejected.ok, false, 'past course contracts cannot overlap before their actual clearing');
  assert.equal(sim.exportSave(), genuine, 'historical-window rejection is atomic'); restore24(sim, controls);
});
