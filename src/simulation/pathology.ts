import type { Simulation } from '../simulation';
import { getBuildingBody } from '../architecture-floor-plan';
import { clinicalAtSite, clinicalServiceStationsAtPosition } from './clinical';
import type { SimState, WorldDefinition } from '../types';
import { hygieneContactWindows, type WasteBatch, type WastePathogenSource } from './hygiene';

/** Fictional game parameters. They are not medical/epidemiological estimates. */
export const YV1_RULES = Object.freeze({ id: 'YV1-contact-enteric-v1' as const, pathogenId: 'YV1' as const, label: 'YV1 接触性肠道病（虚构游戏规则）', incubationMinutes: 240, infectiousMinutes: 720, recoveryMinutes: 1440, immuneMinutes: 4320, wasteViableMinutes: 1440, doseWindowMinutes: 60, infectiousDose: 5, symptomaticHealthPerMinute: .02, recoveringHealthPerMinute: .005 });
// A 60-minute window has up to 960 genuine .0625-minute ticks at speed .25.
// Each native doctor has one credited wage interval and two medical slots:
// subtracting them leaves at most three pieces per tick; 64 pending hygiene
// jobs can additionally split a completion tick. 4096 keeps that full window.
const EPS = 1e-7, HISTORY = 64, CONTACT_HISTORY = 1024, DOSE_HISTORY = 4096;
const clock = (state: SimState) => state.extension!.lastUpdate;
export interface PathologySourceReceipt { id: string; kind: 'controlled-validation'; actorId: string; at: number; label: string; initialPhase: 'infectious' }
export interface PathologyImmunityWitness { episodeId: string; actorId: string; exposedAt: number; immuneUntil: number }
export interface PathologyExposureReceipt {
  id: string; actorId: string; sourceActorId: string; sourceEpisodeId: string; rootReceiptId: string; batchId: string; operationId: string;
  siteId: string; floor: number; pointId: string; startAt: number; endAt: number; sourceContaminatedAt: number;
  sourceInfectiousFrom: number; sourceInfectiousUntil: number; protectionFactor: number; effectiveDose: number; susceptibleFrom: number; immunityWitness: PathologyImmunityWitness | null;
}
export interface PathologyEpisode {
  id: string; actorId: string; pathogenId: 'YV1'; rootReceiptId: string; origin: 'controlled-validation' | 'waste-contact';
  exposedAt: number; incubatingUntil: number; infectiousFrom: number; infectiousUntil: number; recoveryAt: number; immuneUntil: number;
  phase: 'incubating' | 'symptomatic' | 'recovering' | 'recovered' | 'dead'; severity: number; symptomRelief: number; susceptibleFrom: number; immunityWitness: PathologyImmunityWitness | null;
  discoveredAt: number | null; lastObservedAt: number; burdenObservedAt: number; symptomaticMinutes: number; recoveringMinutes: number; healthBurden: number; exposureReceipts: PathologyExposureReceipt[];
  supportReceipts: { orderId: string; siteId: string; completedAt: number; consumedUnits: 1; minutes: 20; relief: number }[];
}
export interface PathologyState {
  version: 1; rulesetId: typeof YV1_RULES.id; nextEpisodeId: number; nextReceiptId: number; activatedAt: number; lastObservedAt: number;
  sourceReceipts: PathologySourceReceipt[]; episodes: Record<string, PathologyEpisode>; history: PathologyEpisode[];
  pendingDose: Record<string, PathologyExposureReceipt[]>; contacts: PathologyExposureReceipt[];
  archived: { episodes: number; contacts: number; contactDose: number }; stats: { episodes: number; contacts: number; contactDose: number; controlledSources: number };
}
/** Read-only dose projection. Original certified receipts remain unchanged
 * when only part of their contact interval remains in the rolling window. */
export function yv1DoseInWindow(receipts: readonly PathologyExposureReceipt[], at: number): number {
  return receipts.reduce((sum, receipt) => sum + Math.max(0, Math.min(at, receipt.endAt) - Math.max(at - YV1_RULES.doseWindowMinutes, receipt.startAt, receipt.susceptibleFrom)) * receipt.protectionFactor, 0);
}
const immunityWitness = (episode: PathologyEpisode | undefined): PathologyImmunityWitness | null => episode ? { episodeId: episode.id, actorId: episode.actorId, exposedAt: episode.exposedAt, immuneUntil: episode.immuneUntil } : null;
const sameImmunity = (a: PathologyImmunityWitness | null, b: PathologyImmunityWitness | null) => a === null && b === null || !!a && !!b && a.episodeId === b.episodeId && a.actorId === b.actorId && a.exposedAt === b.exposedAt && a.immuneUntil === b.immuneUntil;
function activate(simulation: Simulation): PathologyState {
  if (!simulation.state.pathology) {
    simulation.state.pathology = { version: 1, rulesetId: YV1_RULES.id, nextEpisodeId: 1, nextReceiptId: 1, activatedAt: clock(simulation.state), lastObservedAt: clock(simulation.state), sourceReceipts: [], episodes: {}, history: [], pendingDose: {}, contacts: [], archived: { episodes: 0, contacts: 0, contactDose: 0 }, stats: { episodes: 0, contacts: 0, contactDose: 0, controlledSources: 0 } };
    Reflect.set(Reflect.get(simulation, 'runtime'), 'pathologyVersion', 1);
  }
  return simulation.state.pathology;
}
function phaseAt(state: SimState, episode: PathologyEpisode, now: number): PathologyEpisode['phase'] {
  if (!state.extension!.actorProfiles[episode.actorId]?.alive) return 'dead';
  if (now < episode.incubatingUntil) return 'incubating';
  if (now < episode.infectiousUntil) return 'symptomatic';
  if (now < episode.recoveryAt) return 'recovering';
  return 'recovered';
}
function updateEpisode(state: SimState, episode: PathologyEpisode): void {
  episode.phase = phaseAt(state, episode, clock(state)); episode.lastObservedAt = clock(state);
  const base = episode.phase === 'symptomatic' ? 40 : episode.phase === 'recovering' ? 15 : 0;
  episode.severity = Math.max(0, base - episode.symptomRelief);
}
function applySymptomBurden(state: SimState, episode: PathologyEpisode, phaseMinutes: number): void {
  const now = clock(state), start = Math.max(episode.burdenObservedAt, now - phaseMinutes, episode.exposedAt), profile = state.extension!.actorProfiles[episode.actorId];
  episode.burdenObservedAt = now;
  if (!profile?.alive) return;
  const overlap = (from: number, until: number) => Math.max(0, Math.min(now, until) - Math.max(start, from));
  const symptomatic = overlap(episode.infectiousFrom, episode.infectiousUntil), recovering = overlap(episode.infectiousUntil, episode.recoveryAt);
  const burden = Math.min(profile.health, (symptomatic * YV1_RULES.symptomaticHealthPerMinute + recovering * YV1_RULES.recoveringHealthPerMinute) * Math.max(0, 1 - episode.symptomRelief / 40));
  profile.health -= burden; episode.symptomaticMinutes += symptomatic; episode.recoveringMinutes += recovering; episode.healthBurden += burden;
  // Core life processing owns health-zero death and ordinary care decisions.
}
function createEpisode(simulation: Simulation, actorId: string, rootReceiptId: string, origin: PathologyEpisode['origin'], exposureReceipts: PathologyExposureReceipt[]): PathologyEpisode {
  const state = simulation.state, p = activate(simulation), now = clock(state), initial = origin === 'controlled-validation';
  const old = p.episodes[actorId]; if (old) { p.history.push(old); if (p.history.length > HISTORY) { p.history.shift(); p.archived.episodes++; } }
  const episode: PathologyEpisode = { id: `yv1-episode-${p.nextEpisodeId++}`, actorId, pathogenId: 'YV1', rootReceiptId, origin, exposedAt: now, incubatingUntil: now + (initial ? 0 : YV1_RULES.incubationMinutes), infectiousFrom: now + (initial ? 0 : YV1_RULES.incubationMinutes), infectiousUntil: now + (initial ? 0 : YV1_RULES.incubationMinutes) + YV1_RULES.infectiousMinutes, recoveryAt: now + YV1_RULES.recoveryMinutes - (initial ? YV1_RULES.incubationMinutes : 0), immuneUntil: now + YV1_RULES.recoveryMinutes - (initial ? YV1_RULES.incubationMinutes : 0) + YV1_RULES.immuneMinutes, phase: initial ? 'symptomatic' : 'incubating', severity: initial ? 40 : 0, symptomRelief: 0, susceptibleFrom: 0, immunityWitness: null, discoveredAt: null, lastObservedAt: now, burdenObservedAt: now, symptomaticMinutes: 0, recoveringMinutes: 0, healthBurden: 0, exposureReceipts, supportReceipts: [] };
  episode.immunityWitness = immunityWitness(old); episode.susceptibleFrom = old?.immuneUntil ?? 0;
  p.episodes[actorId] = episode; p.stats.episodes++; delete p.pendingDose[actorId]; return episode;
}
/** Explicit controlled start for causal validation only. No game command,
 * world constructor, flight or generic health path calls this function. */
export function seedControlledYV1Source(simulation: Simulation, actorId: string, label: string): PathologyEpisode | null {
  const state = simulation.state, profile = state.extension?.actorProfiles[actorId], old = state.pathology?.episodes[actorId];
  if (!profile?.alive || !label.trim() || label.length > 160 || old && clock(state) < old.immuneUntil || (state.pathology?.sourceReceipts.length ?? 0) >= HISTORY) return null;
  const p = activate(simulation), receipt: PathologySourceReceipt = { id: `yv1-source-${p.nextReceiptId++}`, kind: 'controlled-validation', actorId, at: clock(state), label, initialPhase: 'infectious' };
  p.sourceReceipts.push(receipt); p.stats.controlledSources++; return createEpisode(simulation, actorId, receipt.id, 'controlled-validation', []);
}
export function yv1WasteSourceAt(state: SimState, actorId: string, at: number): WastePathogenSource | null {
  const episode = state.pathology?.episodes[actorId];
  if (!episode || !state.extension!.actorProfiles[actorId]?.alive || at < episode.infectiousFrom || at >= episode.infectiousUntil) return null;
  return { pathogenId: 'YV1', episodeId: episode.id, actorId, rootReceiptId: episode.rootReceiptId, infectiousFrom: episode.infectiousFrom, infectiousUntil: episode.infectiousUntil, contaminatedAt: at };
}
/** Called only after an actual hygiene labour claim, with original certified
 * ranges. Missing provenance/window gives no exposure credit. */
export function recordWasteContact(simulation: Simulation, actorId: string, batch: WasteBatch, operationId: string, startAt: number, endAt: number, protectionFactor: number): void {
  const state = simulation.state, source = batch.pathogenSource, now = clock(state), profile = state.extension!.actorProfiles[actorId], site = simulation.worldDefinition.buildings.find(site => site.id === batch.siteId), person = state.citizens.find(person => person.id === actorId);
  const job = state.hygiene?.jobs.find(job => job.id === operationId);
  if (state.hygiene?.batches.find(item => item.id === batch.id) !== batch || !job || job.batchId !== batch.id || job.siteId !== batch.siteId || job.reservedUnits !== 1 || job.cancelledAt !== null || job.completedAt !== null || !hygieneContactWindows(simulation, actorId, operationId, batch.id).some(range => range.start === startAt && range.end === endAt) || protectionFactor !== .25) return;
  if (!source || batch.hazard !== 'YV1' || batch.contaminatedUnits < 1 || !profile?.alive || !site || !person || !Number.isFinite(startAt) || !Number.isFinite(endAt) || !Number.isFinite(protectionFactor) || protectionFactor < 0 || protectionFactor > 1 || endAt <= startAt || endAt > now + EPS || startAt < Math.max(source.contaminatedAt, now - .25 * state.speed) - EPS || endAt > source.contaminatedAt + YV1_RULES.wasteViableMinutes) return;
  const identity = { role: 'traveler' as const, identities: ['traveler' as const] };
  if (getBuildingBody(site) ? !clinicalServiceStationsAtPosition(site, person.position, identity, state.voxels).some(point => point.id === batch.pointId && point.floor === batch.floor) : !clinicalAtSite(simulation, site, actorId) || Math.hypot(person.position.x - batch.point.x, person.position.y - batch.point.y, person.position.z - batch.point.z) > 2) return;
  const p = state.pathology; if (!p || !p.sourceReceipts.some(receipt => receipt.id === source.rootReceiptId)) return;
  const duplicate = p.contacts.some(receipt => receipt.actorId === actorId && receipt.operationId === operationId && receipt.startAt === startAt && receipt.endAt === endAt);
  if (duplicate) return;
  const current = p.episodes[actorId], receipt: PathologyExposureReceipt = { id: `yv1-contact-${p.nextReceiptId++}`, actorId, sourceActorId: source.actorId, sourceEpisodeId: source.episodeId, rootReceiptId: source.rootReceiptId, batchId: batch.id, operationId, siteId: batch.siteId, floor: batch.floor, pointId: batch.pointId, startAt, endAt, sourceContaminatedAt: source.contaminatedAt, sourceInfectiousFrom: source.infectiousFrom, sourceInfectiousUntil: source.infectiousUntil, protectionFactor, effectiveDose: (endAt - startAt) * protectionFactor, susceptibleFrom: current?.immuneUntil ?? 0, immunityWitness: immunityWitness(current) };
  p.contacts.push(receipt); p.stats.contacts++; p.stats.contactDose += receipt.effectiveDose;
  if (p.contacts.length > CONTACT_HISTORY) { const old = p.contacts.shift()!; p.archived.contacts++; p.archived.contactDose += old.effectiveDose; }
  if (current && now < current.immuneUntil || yv1DoseInWindow([receipt], now) <= EPS) return;
  const dose = p.pendingDose[actorId] ??= [];
  while (dose.length && dose[0].endAt <= endAt - YV1_RULES.doseWindowMinutes) dose.shift();
  dose.push(receipt);
  if (yv1DoseInWindow(dose, now) + EPS >= YV1_RULES.infectiousDose) createEpisode(simulation, actorId, source.rootReceiptId, 'waste-contact', dose.slice());
  p.lastObservedAt = now;
}
export function installPathology(simulation: Simulation): void {
  // No empty body, seed, marker, waste or money on old/new default worlds.
  simulation.onPhase('environment', (state, minutes) => {
    const p = state.pathology; if (!p) return; p.lastObservedAt = clock(state);
    for (const episode of Object.values(p.episodes)) { applySymptomBurden(state, episode, minutes); updateEpisode(state, episode); }
    for (const [id, receipts] of Object.entries(p.pendingDose)) { while (receipts.length && receipts[0].endAt <= clock(state) - YV1_RULES.doseWindowMinutes) receipts.shift(); if (!state.extension!.actorProfiles[id]?.alive || !receipts.length) delete p.pendingDose[id]; }
  });
  // Core lifecycle may mark a death later in people. Feedback commits the
  // actual final life/episode relation before a completed tick is exported.
  simulation.onPhase('feedback', state => { if (state.pathology) { state.pathology.lastObservedAt = clock(state); for (const episode of Object.values(state.pathology.episodes)) updateEpisode(state, episode); } });
  simulation.onEvent('clinical-completed', event => {
    const state = simulation.state, episode = event.citizenId && state.pathology?.episodes[event.citizenId], order = state.clinical?.orders.find(order => order.id === event.procurementId);
    if (!episode || !order || order.state !== 'completed' || order.completedAt !== clock(state) || order.patientId !== episode.actorId || event.siteId !== order.siteId || order.consumedUnits !== 1 || order.workedMinutes !== 20 || !['symptomatic', 'recovering'].includes(phaseAt(state, episode, clock(state))) || episode.supportReceipts.some(receipt => receipt.orderId === order.id)) return;
    // Real generic clinical care may relieve symptoms. It never removes YV1,
    // shortens infectiousness, diagnoses a laboratory result, or grants a drug.
    const relief = Math.min(15, Math.max(0, 40 - episode.symptomRelief)); if (relief === 0) return; episode.symptomRelief += relief;
    episode.supportReceipts.push({ orderId: order.id, siteId: order.siteId, completedAt: clock(state), consumedUnits: 1, minutes: 20, relief }); updateEpisode(state, episode);
  });
  simulation.registerSaveValidator(state => validatePathologyState(state, simulation.worldDefinition));
}

export function validatePathologyState(state: SimState, world: WorldDefinition): void {
  const p = state.pathology; if (p === undefined) return;
  const ensure = (condition: unknown, label: string): void => { if (!condition) throw new Error(`病原存档无效：${label}`); };
  const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
  const number = (value: unknown, min: number, max: number, label: string, integer = false): void => ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), label);
  const close = (a: number, b: number, label: string) => ensure(Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b)), label);
  const now = clock(state), actorIds = new Set(['player', ...state.citizens.map(person => person.id)]), sites = new Map(world.buildings.map(site => [site.id, site]));
  ensure(object(p) && p.version === 1 && p.rulesetId === YV1_RULES.id && object(p.episodes) && object(p.pendingDose) && object(p.stats) && object(p.archived), '版本和具名游戏规则'); number(p.activatedAt, 0, now, '激活时钟'); number(p.lastObservedAt, p.activatedAt, now, '观察时钟'); ensure(p.lastObservedAt === now, '完整tick观察必须闭合'); number(p.nextEpisodeId, 1, 1e9, '病例序号', true); number(p.nextReceiptId, 1, 1e9, '回执序号', true);
  ensure(Array.isArray(p.sourceReceipts) && p.sourceReceipts.length > 0 && p.sourceReceipts.length <= HISTORY && Array.isArray(p.contacts) && p.contacts.length <= CONTACT_HISTORY && Array.isArray(p.history) && p.history.length <= HISTORY && Object.keys(p.episodes).length <= actorIds.size && Object.keys(p.pendingDose).length <= actorIds.size, '有来源而非空壳');
  const sourceIds = new Set<string>(), receiptIds = new Set<string>(), episodeIds = new Set<string>();
  for (const r of p.sourceReceipts) { ensure(object(r) && /^yv1-source-[1-9]\d*$/.test(r.id) && !receiptIds.has(r.id) && Number(r.id.slice(11)) < p.nextReceiptId && r.kind === 'controlled-validation' && actorIds.has(r.actorId) && r.initialPhase === 'infectious' && typeof r.label === 'string' && r.label.trim().length > 0 && r.label.length <= 160, '明确受控来源；无天然来源能力'); number(r.at, p.activatedAt, now, '来源时钟'); receiptIds.add(r.id); sourceIds.add(r.id); }
  const knownContacts = new Map<string, PathologyExposureReceipt>();
  const validateImmunity = (actorId: string, susceptibleFrom: number, witness: PathologyImmunityWitness | null, before: number): void => {
    number(susceptibleFrom, 0, 1e12, '原易感起点');
    const retained = [...Object.values(p.episodes), ...p.history].filter(episode => episode.actorId === actorId && episode.exposedAt < before - EPS);
    ensure(retained.every(episode => susceptibleFrom + EPS >= episode.immuneUntil), '尚保留原病例的免疫资格不能删除或提前');
    if (witness === null) { ensure(susceptibleFrom === 0, '初次感染不制造旧免疫'); return; }
    ensure(object(witness) && witness.actorId === actorId && /^yv1-episode-[1-9]\d*$/.test(witness.episodeId) && Number(witness.episodeId.slice(12)) < p.nextEpisodeId && susceptibleFrom === witness.immuneUntil, '具名原免疫资格'); number(witness.exposedAt, p.activatedAt, now, '原病例起点'); number(witness.immuneUntil, witness.exposedAt, 1e12, '不可覆写免疫截止');
    const prior = [...Object.values(p.episodes), ...p.history].find(episode => episode.id === witness.episodeId); if (prior) ensure(prior.actorId === actorId && prior.exposedAt === witness.exposedAt && prior.immuneUntil === witness.immuneUntil, '尚保留原免疫病例对账');
  };
  const validateExposure = (r: PathologyExposureReceipt): void => {
    ensure(object(r) && /^yv1-contact-[1-9]\d*$/.test(r.id) && Number(r.id.slice(12)) < p.nextReceiptId && actorIds.has(r.actorId) && actorIds.has(r.sourceActorId) && sourceIds.has(r.rootReceiptId) && /^yv1-episode-[1-9]\d*$/.test(r.sourceEpisodeId) && Number(r.sourceEpisodeId.slice(12)) < p.nextEpisodeId && /^disinfection-[1-9]\d*$/.test(r.operationId) && Number(r.operationId.slice(13)) < (state.hygiene?.nextJobId ?? 0), '接触具名来源');
    const site = sites.get(r.siteId), batch = state.hygiene?.batches.find(batch => batch.id === r.batchId); ensure(site?.kind === 'clinic' && batch && batch.siteId === r.siteId && batch.floor === r.floor && batch.pointId === r.pointId && batch.hazard === 'YV1' && batch.patientId === r.sourceActorId, '真实废物和相同站点');
    const origin = batch!.pathogenSource; ensure(origin && origin.episodeId === r.sourceEpisodeId && origin.rootReceiptId === r.rootReceiptId && origin.actorId === r.sourceActorId && origin.contaminatedAt === r.sourceContaminatedAt && origin.infectiousFrom === r.sourceInfectiousFrom && origin.infectiousUntil === r.sourceInfectiousUntil, '原批次精确病原来源');
    number(r.sourceInfectiousFrom, 0, now, '源传染开始'); number(r.sourceInfectiousUntil, r.sourceInfectiousFrom, 1e12, '源传染结束'); number(r.sourceContaminatedAt, r.sourceInfectiousFrom, Math.min(now, r.sourceInfectiousUntil), '实际用后污染'); number(r.startAt, r.sourceContaminatedAt, now, '接触开始'); number(r.endAt, r.startAt + EPS, Math.min(now, r.sourceContaminatedAt + YV1_RULES.wasteViableMinutes), '接触结束'); number(r.protectionFactor, 0, 1, '游戏防护因子'); number(r.effectiveDose, 0, r.endAt - r.startAt, '实际剂量'); close(r.effectiveDose, (r.endAt - r.startAt) * r.protectionFactor, '接触剂量');
    const source = [...Object.values(p.episodes), ...p.history].find(episode => episode.id === r.sourceEpisodeId); if (source) ensure(source.actorId === r.sourceActorId && source.rootReceiptId === r.rootReceiptId && source.infectiousFrom === r.sourceInfectiousFrom && source.infectiousUntil === r.sourceInfectiousUntil, '尚保留病例来源对账');
    ensure(r.protectionFactor === .25, '当前真实清洁材料的固定游戏防护合同');
    validateImmunity(r.actorId, r.susceptibleFrom, r.immunityWitness, r.endAt);
    const job = state.hygiene?.jobs.find(job => job.id === r.operationId); if (job) { const period = job.staffWindows[r.actorId]; ensure(job.batchId === r.batchId && job.siteId === r.siteId && period && r.startAt >= period.startedAt - EPS && r.endAt <= period.endedAt + EPS && (job.staffMinutes[r.actorId] ?? 0) + EPS >= r.endAt - r.startAt, '原真实劳动订单窗口'); }
    const old = knownContacts.get(r.id); if (old) { const same = (key: string) => key === 'immunityWitness' ? sameImmunity(old.immunityWitness, r.immunityWitness) : Reflect.get(old, key) === Reflect.get(r, key); ensure(Object.keys(r).every(same) && Object.keys(old).every(same), '同一接触回执引用必须一致'); } else knownContacts.set(r.id, r);
  };
  let contactDose = p.archived.contactDose; for (const r of p.contacts) { validateExposure(r); ensure(!receiptIds.has(r.id), '接触回执唯一'); receiptIds.add(r.id); contactDose += r.effectiveDose; }
  const episodes = [...Object.values(p.episodes), ...p.history];
  for (const [actorId, e] of Object.entries(p.episodes)) ensure(actorId === e.actorId, '病例主体索引');
  for (const e of episodes) {
    ensure(object(e) && /^yv1-episode-[1-9]\d*$/.test(e.id) && !episodeIds.has(e.id) && Number(e.id.slice(12)) < p.nextEpisodeId && actorIds.has(e.actorId) && e.pathogenId === 'YV1' && sourceIds.has(e.rootReceiptId) && ['controlled-validation', 'waste-contact'].includes(e.origin), '具名病例'); episodeIds.add(e.id);
    number(e.exposedAt, p.activatedAt, now, '暴露时钟'); const initial = e.origin === 'controlled-validation', incubation = initial ? 0 : YV1_RULES.incubationMinutes;
    validateImmunity(e.actorId, e.susceptibleFrom, e.immunityWitness, e.exposedAt); ensure(e.susceptibleFrom <= e.exposedAt && (!e.immunityWitness || Number(e.immunityWitness.episodeId.slice(12)) < Number(e.id.slice(12))), '感染当时已有真实易感资格');
    for (const key of ['incubatingUntil', 'infectiousFrom', 'infectiousUntil', 'recoveryAt', 'immuneUntil'] as const) number(e[key], e.exposedAt, 1e12, key);
    close(e.incubatingUntil, e.exposedAt + incubation, '潜伏期'); close(e.infectiousFrom, e.incubatingUntil, '传染起点'); close(e.infectiousUntil, e.infectiousFrom + YV1_RULES.infectiousMinutes, '传染周期'); close(e.recoveryAt, e.exposedAt + YV1_RULES.recoveryMinutes - (initial ? YV1_RULES.incubationMinutes : 0), '恢复周期'); close(e.immuneUntil, e.recoveryAt + YV1_RULES.immuneMinutes, '免疫周期'); number(e.lastObservedAt, e.exposedAt, now, '病例观察'); number(e.burdenObservedAt, e.exposedAt, e.lastObservedAt, '症状实际观察'); number(e.symptomaticMinutes, 0, Math.max(0, Math.min(e.burdenObservedAt, e.infectiousUntil) - e.infectiousFrom) + EPS, '真实症状分钟'); number(e.recoveringMinutes, 0, Math.max(0, Math.min(e.burdenObservedAt, e.recoveryAt) - e.infectiousUntil) + EPS, '真实恢复分钟'); number(e.healthBurden, 0, e.symptomaticMinutes * YV1_RULES.symptomaticHealthPerMinute + e.recoveringMinutes * YV1_RULES.recoveringHealthPerMinute + EPS, '有限真实健康负担');
    ensure(['incubating', 'symptomatic', 'recovering', 'recovered', 'dead'].includes(e.phase) && e.discoveredAt === null, '不冒已完成具名检查或化验'); number(e.symptomRelief, 0, 40, '护理缓解'); number(e.severity, 0, 40, '游戏症状'); ensure(Array.isArray(e.exposureReceipts) && e.exposureReceipts.length <= DOSE_HISTORY && new Set(e.exposureReceipts.map(r => r.id)).size === e.exposureReceipts.length && Array.isArray(e.supportReceipts) && e.supportReceipts.length <= 64, '唯一病例回执');
    if (initial) ensure(e.exposureReceipts.length === 0 && p.sourceReceipts.some(r => r.id === e.rootReceiptId && r.actorId === e.actorId && r.at === e.exposedAt), '受控病例起点');
    else { ensure(e.exposureReceipts.length > 0, '感染须真实接触'); for (const r of e.exposureReceipts) { validateExposure(r); ensure(r.actorId === e.actorId && r.susceptibleFrom === e.susceptibleFrom && sameImmunity(r.immunityWitness, e.immunityWitness) && r.endAt <= e.exposedAt + EPS && r.endAt > e.exposedAt - YV1_RULES.doseWindowMinutes, '感染前真实滚动易感窗口'); } ensure(yv1DoseInWindow(e.exposureReceipts, e.exposedAt) + EPS >= YV1_RULES.infectiousDose, '足量真实接触'); }
    let relief = 0; const supportIds = new Set<string>(); for (const r of e.supportReceipts) { ensure(object(r) && /^clinical-[1-9]\d*$/.test(r.orderId) && !supportIds.has(r.orderId) && sites.get(r.siteId)?.kind === 'clinic' && r.consumedUnits === 1 && r.minutes === 20, '真实临床支持回执'); supportIds.add(r.orderId); number(r.completedAt, e.exposedAt, now, '支持完成'); number(r.relief, 0, 15, '支持缓解'); const order = state.clinical?.orders.find(order => order.id === r.orderId); if (order) ensure(order.state === 'completed' && order.patientId === e.actorId && order.siteId === r.siteId && order.completedAt === r.completedAt && order.consumedUnits === 1, '仍保留临床订单'); relief += r.relief; } close(e.symptomRelief, relief, '只有真实支持缓解症状');
    if (p.episodes[e.actorId] === e) { ensure(e.lastObservedAt === now && e.burdenObservedAt === now && e.phase === phaseAt(state, e, now), '当前病例完整tick真实观察必须闭合'); const base = e.phase === 'symptomatic' ? 40 : e.phase === 'recovering' ? 15 : 0; close(e.severity, Math.max(0, base - e.symptomRelief), '症状不能冒病毒清除'); }
  }
  for (const [id, receipts] of Object.entries(p.pendingDose)) { ensure(actorIds.has(id) && Array.isArray(receipts) && receipts.length > 0 && receipts.length <= DOSE_HISTORY && new Set(receipts.map(r => r.id)).size === receipts.length, '有限唯一待积累接触'); let end = -Infinity; for (const r of receipts) { validateExposure(r); ensure(r.actorId === id && r.startAt >= end - EPS && r.endAt > now - YV1_RULES.doseWindowMinutes, '真实有序未过期待感染窗口'); end = r.endAt; } ensure(yv1DoseInWindow(receipts, now) < YV1_RULES.infectiousDose + EPS, '待感染剂量窗口'); }
  const byActor = new Map<string, PathologyExposureReceipt[]>(), operationMinutes = new Map<string, number>();
  for (const r of knownContacts.values()) { const ranges = byActor.get(r.actorId) ?? []; ranges.push(r); byActor.set(r.actorId, ranges); const key = r.operationId + ':' + r.actorId; operationMinutes.set(key, (operationMinutes.get(key) ?? 0) + r.endAt - r.startAt); }
  for (const ranges of byActor.values()) { let end = -Infinity; for (const r of ranges.sort((a, b) => a.startAt - b.startAt)) { ensure(r.startAt >= end - EPS, '同一人物的接触劳动不能重叠复记'); end = r.endAt; } }
  for (const [key, minutes] of operationMinutes) { const separator = key.indexOf(':'), operationId = key.slice(0, separator), actorId = key.slice(separator + 1), job = state.hygiene?.jobs.find(job => job.id === operationId); ensure(minutes <= (job?.staffMinutes[actorId] ?? 10) + EPS, '接触总分钟不超过实际清洁劳动'); }
  for (const key of ['episodes', 'contacts', 'contactDose', 'controlledSources'] as const) number(p.stats[key], 0, 1e12, `累计${key}`, key !== 'contactDose'); number(p.archived.episodes, 0, 1e9, '病例归档', true); number(p.archived.contacts, 0, 1e9, '接触归档', true); number(p.archived.contactDose, 0, 1e12, '剂量归档'); close(p.stats.episodes, episodes.length + p.archived.episodes, '病例累计'); close(p.nextEpisodeId, p.stats.episodes + 1, '病例连续序号'); close(p.stats.contacts, p.contacts.length + p.archived.contacts, '真实接触累计'); close(p.stats.contactDose, contactDose, '真实剂量累计'); close(p.stats.controlledSources, p.sourceReceipts.length, '受控来源累计'); close(p.nextReceiptId, p.stats.contacts + p.sourceReceipts.length + 1, '回执连续序号');
}
