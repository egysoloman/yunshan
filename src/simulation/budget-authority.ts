import { isCanonicalNpcWage } from '../simulation';
import type { Simulation, PublicBudgetAuthorization } from '../simulation';
import type { Building, SimState, Vec3, WorldDefinition } from '../types';
import { canAccessFloor } from '../access';
import { FLOOR_PLAN_PROFILE, blocksFloorPlanMovement, floorPlanSupport, getBuildingUsePoints } from '../architecture-floor-plan';
import { homeRestPointBlockedByVoxels } from './home-rest';
import { civicCouncilSourceProof, validateCivicCouncilSourceProof, type CivicCouncilSourceProof, type CivicEnablement, type CivicStaffingState } from './civic-staffing';
import { publicEmploymentRevision, publicEmploymentRole, publicEmploymentSite, type PublicLabor } from './public-employment';
import type { CultureState } from './culture';

const EPS = 1e-7, LIMIT = 64;
export interface LegacyBudgetSignature { actorId: string; role: string; siteId: string; signedAt: number }
export interface LegacyBudgetAuthorization extends PublicBudgetAuthorization { signatureVersion?: undefined; spent: number; closedAt: number | null; signatures: LegacyBudgetSignature[] }
export interface BudgetSignatureV2 {
  signatureVersion: 2; actorId: string; role: 'council'; siteId: string; floor: number; pointId: string; position: Vec3; signedAt: number;
  profession: { baseRole: '官员' | 'official'; workId: string; employmentRevision: number };
  authority: CivicCouncilSourceProof;
  paid: { tick: number; startAt: number; endAt: number; minutes: number; ratePerMinute: number; earned: number };
}
export interface CivicBudgetAuthorization extends PublicBudgetAuthorization { signatureVersion: 2; spent: number; closedAt: number | null; signatures: BudgetSignatureV2[] }
export type BudgetAuthorization = LegacyBudgetAuthorization | CivicBudgetAuthorization;
export interface BudgetAuthorityState {
  version: 1; enablementId: string; legacySourceSha256: string | null;
  legacyAuthorizationRefs: { id: string; authorizationSha256: string }[];
  requestIds: string[];
}
export interface BudgetAuthorityRuntime { publicLabor?: PublicLabor; publicBudgets?: BudgetAuthorization[] }
export interface BudgetAuthorityHooks { enabled: () => boolean }
type AuthorityState = SimState & { civicStaffing?: CivicStaffingState; budgetAuthority?: BudgetAuthorityState };
type PaidFrame = { state: SimState; tick: number; clock: number; paid: Map<string, BudgetSignatureV2> };
const frames = new WeakMap<Simulation, PaidFrame>(), installs = new WeakSet<Simulation>();
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const same = (a: number, b: number) => Math.abs(a - b) <= EPS;
const clock = (s: SimState) => s.extension!.lastUpdate;
const body = (s: SimState) => (s as AuthorityState).budgetAuthority;
const civic = (s: SimState) => (s as AuthorityState).civicStaffing;
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const isSupplementalPurpose = (purpose: string) => /^civic-(education|health)-supplement$/.test(purpose);

/** Synchronous UTF-8 SHA-256 allows the same strict boundary reader in browser
 * and headless hosts. This is a provenance digest, not JSON authentication. */
export function budgetDescriptorSha256(text: string): string {
  const bytes = new TextEncoder().encode(text), length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length); buffer.set(bytes); buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer); view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, bytes.length * 8 >>> 0);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
  const rotate = (n: number, bits: number) => n >>> bits | n << (32 - bits);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = w[i - 16] + (rotate(a,7) ^ rotate(a,18) ^ a >>> 3) + w[i - 7] + (rotate(b,17) ^ rotate(b,19) ^ b >>> 10); }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) { const t1 = (j + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + (e & f ^ ~e & g) + k[i] + w[i]) >>> 0, t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + (a & b ^ a & c ^ b & c)) >>> 0; j = g; g = f; f = e; e = d + t1 >>> 0; d = c; c = b; b = a; a = t1 + t2 >>> 0; }
    for (const [i,n] of [a,b,c,d,e,f,g,j].entries()) h[i] = h[i] + n >>> 0;
  }
  return h.map(n => n.toString(16).padStart(8, '0')).join('');
}
/** Do not include mutable expenditure, closure or receipt state. */
export function legacyAuthorizationDescriptor(budget: LegacyBudgetAuthorization): string {
  return JSON.stringify({ id: budget.id, siteId: budget.siteId, purpose: budget.purpose, cap: budget.cap,
    approvedAt: budget.approvedAt, approvedBy: budget.approvedBy,
    signatures: budget.signatures.map(s => ({ actorId: s.actorId, role: s.role, siteId: s.siteId, signedAt: s.signedAt })) });
}
export function createBudgetAuthorityState(enablement: CivicEnablement, budgets: readonly BudgetAuthorization[], culture?: CultureState): BudgetAuthorityState {
  const requests = culture?.supplementalBudgets?.requests ?? [];
  return { version: 1, enablementId: enablement.id, legacySourceSha256: enablement.sourceSave?.sha256 ?? null,
    legacyAuthorizationRefs: enablement.origin === 'host-upgrade' ? budgets.filter((b): b is LegacyBudgetAuthorization => b.signatureVersion === undefined && isSupplementalPurpose(b.purpose) && requests.some(r => r.id === b.id && r.approvedAt !== null))
      .map(b => ({ id: b.id, authorizationSha256: budgetDescriptorSha256(legacyAuthorizationDescriptor(b)) })) : [], requestIds: requests.map(r => r.id) };
}
/** Only the core's explicit host cutover calls this on a candidate clone. */
export function upgradeSupplementalBudgetState(culture?: CultureState): void {
  const state = culture?.supplementalBudgets;
  if (state?.version === 1) culture!.supplementalBudgets = { version: 2,
    requests: state.requests.map(request => request.approvedAt === null ? { ...request, signatureVersion: 2 as const } : request) };
}
export function budgetAuthorityEnabled(sim: Simulation): boolean {
  const state = sim.state, authority = body(state), enabled = civic(state)?.enablement;
  return !!authority && authority.version === 1 && !!enabled && authority.enablementId === enabled.id && sim.effectiveRuleset === 'civic-local-v1';
}
export function recordSupplementalBudgetRequest(sim: Simulation, id: string): boolean {
  const authority = body(sim.state);
  if (!budgetAuthorityEnabled(sim) || !authority || authority.requestIds.length >= LIMIT || authority.requestIds.includes(id)) return false;
  authority.requestIds.push(id); return true;
}
function workPoint(world: WorldDefinition, siteId: string, position: Vec3): { floor: number; pointId: string } | null {
  const site = world.buildings.find(b => b.id === siteId);
  if (!site || site.kind !== 'hall' || ![position.x,position.y,position.z].every(finite)) return null;
  const floor = Math.floor((position.y - site.position.y + .01) / (site.height / site.floors));
  if (floor < 0 || floor >= site.floors || !canAccessFloor(site, floor, { role: 'official', identities: ['official'] })) return null;
  if (site.floorPlanProfile !== FLOOR_PLAN_PROFILE) {
    const dx = position.x - site.position.x, dz = position.z - site.position.z, dims = site.floorFootprints?.[floor] ?? site;
    const x = dx * Math.cos(site.rotation) + dz * Math.sin(site.rotation), z = -dx * Math.sin(site.rotation) + dz * Math.cos(site.rotation);
    return floor === 0 && distance(position, site.door) <= 2 || Math.abs(x) <= dims.width / 2 && Math.abs(z) <= dims.depth / 2 ? { floor, pointId: `legacy:${floor}:work` } : null;
  }
  const point = (site.functionPoints ?? Array.from({ length: site.floors }, (_, f) => getBuildingUsePoints(site, f)).flat())
    .find(p => p.floor === floor && p.purpose === 'work' && distance(p.position, position) <= 2);
  const support = floorPlanSupport(site, floor, position, .35);
  return point && support?.floor === floor && ['room','stairs'].includes(support.kind) && Math.abs(support.y - position.y) <= .26
    && !blocksFloorPlanMovement(site, floor, position, position, .35, 1.72) ? { floor, pointId: point.id } : null;
}
/** Hooks observe actual core wage objects, never generic emitted copies. The
 * stored signature retains the current finite paid interval for future reads. */
export function installBudgetAuthority(sim: Simulation, hooks: BudgetAuthorityHooks, runtime: () => BudgetAuthorityRuntime): void {
  if (installs.has(sim)) return; installs.add(sim);
  sim.onLoad(() => frames.delete(sim));
  sim.onPhase('time', () => {
    if (!hooks.enabled() || !body(sim.state)) { frames.delete(sim); return; }
    frames.set(sim, { state: sim.state, tick: sim.state.tick, clock: clock(sim.state), paid: new Map() });
  });
  sim.onEvent('wage-earned', event => {
    const frame = frames.get(sim), state = sim.state;
    if (!hooks.enabled() || !frame || frame.state !== state || frame.tick !== state.tick || !isCanonicalNpcWage(event)
      || event.shopId || !event.citizenId || !event.siteId || !finite(event.minutes) || event.minutes <= EPS
      || !finite(event.amount) || event.amount <= 0 || !finite(event.ratePerMinute) || event.ratePerMinute <= 0
      || !finite(event.creditedWorkStartAt) || !finite(event.creditedWorkEndAt)
      || !same(event.creditedWorkEndAt - event.creditedWorkStartAt, event.minutes) || !same(event.amount, event.minutes * event.ratePerMinute)
      || !same(event.creditedWorkEndAt, frame.clock)) return;
    const actor = state.citizens.find(c => c.id === event.citizenId), profile = actor && state.extension!.actorProfiles[actor.id];
    const authority = civicCouncilSourceProof(state, event.citizenId, frame.clock), point = actor && workPoint(sim.worldDefinition, event.siteId, actor.position);
    if (!actor || !profile?.alive || profile.age < 18 || profile.health < 45 || actor.needs.hunger < 40 || actor.needs.fatigue < 35
      || actor.state !== 'working' || actor.workId !== event.siteId || !authority || authority.officeId !== event.siteId || !point
      || homeRestPointBlockedByVoxels(actor.position, state.voxels)) return;
    const labor = runtime().publicLabor, original = civic(state)!.originalOfficials.find(row => row.actorId === actor.id);
    // The original rich-treasury wage path has no PublicLabor body. A new
    // city still has its trusted, immutable constructor profession registry;
    // the actual current canonical wage and term independently certify this
    // work. Do not initialize fictitious employment history to observe it.
    if (!original || actor.role !== original.baseRole || actor.workId !== original.workId
      || ((labor ? publicEmploymentRevision(labor) : 0) > 0 || original.source.kind !== 'initial-profession') && (!labor || publicEmploymentSite(labor, actor.id) !== actor.workId)) return;
    const startAt = Math.max(event.creditedWorkStartAt, civic(state)!.enablement.enabledAt, authority.startsAt), minutes = event.creditedWorkEndAt - startAt;
    if (minutes <= EPS) return;
    frame.paid.set(actor.id, { signatureVersion: 2, actorId: actor.id, role: 'council', siteId: actor.workId, ...point, position: copy(actor.position), signedAt: frame.clock,
      profession: { baseRole: authority.baseRole, workId: actor.workId, employmentRevision: (labor ? publicEmploymentRevision(labor) : 0) }, authority,
      paid: { tick: frame.tick, startAt, endAt: event.creditedWorkEndAt, minutes, ratePerMinute: event.ratePerMinute, earned: minutes * event.ratePerMinute } });
  });
}
export function currentCivicBudgetSignature(sim: Simulation, actorId: string): BudgetSignatureV2 | null {
  const frame = frames.get(sim), state = sim.state, actor = state.citizens.find(c => c.id === actorId), signature = frame?.paid.get(actorId);
  if (!budgetAuthorityEnabled(sim) || !frame || frame.state !== state || frame.tick !== state.tick || !same(frame.clock, clock(state))
    || !actor || !signature || !civicCouncilSourceProof(state, actorId) || actor.role !== signature.profession.baseRole || actor.workId !== signature.siteId
    || !state.extension!.actorProfiles[actor.id]?.alive || state.extension!.actorProfiles[actor.id].age < 18 || state.extension!.actorProfiles[actor.id].health < 45
    || actor.needs.hunger < 40 || actor.needs.fatigue < 35 || actor.state !== 'working' || distance(actor.position, signature.position) > EPS || homeRestPointBlockedByVoxels(actor.position, state.voxels)
    || !sim.isOnDuty(actor.id, actor.workId)) return null;
  return structuredClone(signature);
}
/** The caller supplies only a pending service request and signer IDs. Source
 * role, term and wages are generated from the current certified core frame. */
export function authorizeCivicSupplementalBudget(sim: Simulation, request: PublicBudgetAuthorization, runtime: BudgetAuthorityRuntime): boolean {
  const state = sim.state, requests = state.culture?.supplementalBudgets?.requests, service = state.culture?.orders.find(o => o.siteId === request.siteId && requests?.some(r => r.id === request.id && r.orderId === o.id));
  const pending = requests?.find(r => r.id === request.id);
  if (!budgetAuthorityEnabled(sim) || !pending || pending.signatureVersion !== 2 || pending.approvedAt !== null || pending.closedAt !== null || !service
    || !isSupplementalPurpose(request.purpose) || request.purpose !== `civic-${service.topic}-supplement` || !['education','health'].includes(service.topic)
    || service.approvedAt === null || ['fulfilled','rejected'].includes(service.state) || state.hour < 8 || state.hour >= 17
    || !finite(request.cap) || request.cap <= 0 || request.cap > 160 || request.cap !== pending.cap || !finite(request.approvedAt) || !same(request.approvedAt, clock(state))
    || !Array.isArray(request.approvedBy) || request.approvedBy.length !== 2 || new Set(request.approvedBy).size !== 2
    || !body(state)!.requestIds.includes(request.id) || (runtime.publicBudgets?.length ?? 0) >= 256 || runtime.publicBudgets?.some(b => b.id === request.id)
    || request.cap > sim.publicBudgetSnapshot().available) return false;
  const signatures = request.approvedBy.map(id => currentCivicBudgetSignature(sim, id));
  if (signatures.some(s => !s) || new Set(signatures.map(s => s!.siteId)).size !== 1) return false;
  const site = sim.worldDefinition.buildings.find(b => b.id === signatures[0]!.siteId)!;
  if (site.districtId !== sim.worldDefinition.buildings.find(b => b.id === request.siteId)?.districtId) return false;
  (runtime.publicBudgets ??= []).push({ ...request, approvedBy: [...request.approvedBy], signatureVersion: 2, spent: 0, closedAt: null, signatures: signatures as BudgetSignatureV2[] });
  pending.approvedAt = request.approvedAt; pending.signatures = structuredClone(signatures as BudgetSignatureV2[]); service.retryAt = clock(state);
  return true;
}
function need(value: unknown, label: string): asserts value { if (!value) throw new Error(`自然预算授权合同无效：${label}`); }
function shape(value: unknown, keys: string[], label: string): void { need(value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), label); }
export function validateBudgetSignatureV2(state: SimState, world: WorldDefinition, signature: BudgetSignatureV2, runtime: BudgetAuthorityRuntime, approvedAt: number): void {
  shape(signature, ['signatureVersion','actorId','role','siteId','floor','pointId','position','signedAt','profession','authority','paid'], 'signature shape');
  need(signature.signatureVersion === 2 && signature.role === 'council' && state.citizens.some(c => c.id === signature.actorId) && signature.signedAt === approvedAt, 'version / signer / time');
  shape(signature.profession, ['baseRole','workId','employmentRevision'], 'profession shape');
  shape(signature.authority, ['version','kind','ruleId','enablementId','actorId','officeId','districtId','baseRole','electionId','termId','proofId','signedAt','startsAt','endsAt'], 'term source shape');
  const source = signature.authority, profession = signature.profession, labor = runtime.publicLabor, original = civic(state)?.originalOfficials.find(o => o.actorId === signature.actorId);
  need(validateCivicCouncilSourceProof(state, source) && source.actorId === signature.actorId && source.officeId === signature.siteId && source.signedAt === approvedAt && source.baseRole === profession.baseRole, 'historical elected source');
  need(original && profession.workId === signature.siteId && Number.isInteger(profession.employmentRevision) && profession.employmentRevision >= 0 && profession.employmentRevision <= (labor ? publicEmploymentRevision(labor) : 0), 'profession revision');
  if (profession.employmentRevision === 0 && original.source.kind === 'initial-profession') {
    need(profession.workId === original.workId && profession.baseRole === original.baseRole, 'immutable actual initial profession');
  } else need(labor && publicEmploymentSite(labor, signature.actorId, profession.employmentRevision) === profession.workId
    && (publicEmploymentRole(labor, signature.actorId, profession.employmentRevision) ?? original.baseRole) === profession.baseRole, 'historical actual profession');
  const transfers = labor?.employment?.transfers ?? [];
  need(!profession.employmentRevision || transfers[profession.employmentRevision - 1].at <= approvedAt + EPS, 'revision already existed');
  need(profession.employmentRevision === transfers.length || transfers[profession.employmentRevision].at >= approvedAt - EPS, 'not an earlier profession revision');
  shape(signature.position, ['x','y','z'], 'position shape');
  const point = workPoint(world, signature.siteId, signature.position);
  need(point && signature.floor === point.floor && signature.pointId === point.pointId && Number.isInteger(signature.floor), 'actual official work point');
  shape(signature.paid, ['tick','startAt','endAt','minutes','ratePerMinute','earned'], 'paid window shape');
  const paid = signature.paid;
  need(Number.isInteger(paid.tick) && paid.tick > civic(state)!.enablement.enabledTick && paid.tick <= state.tick && finite(paid.startAt) && paid.startAt >= civic(state)!.enablement.enabledAt - EPS
    && paid.startAt >= source.startsAt - EPS && finite(paid.endAt) && same(paid.endAt, approvedAt) && finite(paid.minutes) && paid.minutes > EPS && paid.minutes <= 480
    && same(paid.endAt - paid.startAt, paid.minutes) && finite(paid.ratePerMinute) && paid.ratePerMinute > 0 && paid.ratePerMinute <= 1
    && finite(paid.earned) && paid.earned > 0 && same(paid.earned, paid.minutes * paid.ratePerMinute), 'positive canonical paid current interval');
}
export function validateBudgetAuthority(state: SimState, world: WorldDefinition, runtime: BudgetAuthorityRuntime): void {
  const authority = body(state), enabled = civic(state)?.enablement;
  if (!authority) { need(!runtime.publicBudgets?.some(b => b.signatureVersion !== undefined) && state.culture?.supplementalBudgets?.version !== 2, 'new budget missing its enabled body'); return; }
  shape(authority, ['version','enablementId','legacySourceSha256','legacyAuthorizationRefs','requestIds'], 'body shape');
  need(enabled && authority.version === 1 && authority.enablementId === enabled.id && authority.legacySourceSha256 === (enabled.sourceSave?.sha256 ?? null), 'paired enablement / cutover original');
  need(Array.isArray(authority.legacyAuthorizationRefs) && authority.legacyAuthorizationRefs.length <= LIMIT && Array.isArray(authority.requestIds) && authority.requestIds.length <= LIMIT
    && authority.requestIds.every(id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id)) && new Set(authority.requestIds).size === authority.requestIds.length, 'finite request identity trail');
  const requests = state.culture?.supplementalBudgets?.requests ?? [], budgets = runtime.publicBudgets ?? [];
  need(requests.length === authority.requestIds.length && requests.every((r,i) => r.id === authority.requestIds[i]) && (!requests.length || state.culture?.supplementalBudgets?.version === 2), 'all pending and historical bodies retained');
  const refs = new Set<string>();
  for (const ref of authority.legacyAuthorizationRefs) {
    shape(ref, ['id','authorizationSha256'], 'legacy boundary shape');
    const budget = budgets.find((b): b is LegacyBudgetAuthorization => b.id === ref.id && b.signatureVersion === undefined), request = requests.find(r => r.id === ref.id);
    need(enabled.origin === 'host-upgrade' && authority.legacySourceSha256 && !refs.has(ref.id) && budget && request && request.signatureVersion === undefined && request.approvedAt !== null
      && isSupplementalPurpose(budget.purpose) && budget.approvedAt <= enabled.enabledAt + EPS && /^[a-f0-9]{64}$/.test(ref.authorizationSha256)
      && budgetDescriptorSha256(legacyAuthorizationDescriptor(budget)) === ref.authorizationSha256, 'exact original approved immutable authorization'); refs.add(ref.id);
  }
  for (const request of requests) need(request.signatureVersion === 2 || request.signatureVersion === undefined && request.approvedAt !== null && refs.has(request.id), 'new requests cannot fall back to old role signatures');
  for (const budget of budgets.filter(b => isSupplementalPurpose(b.purpose))) {
    if (budget.signatureVersion === undefined) { need(refs.has(budget.id), 'old authorization must be an actual cutover reference'); continue; }
    shape(budget, ['id','siteId','purpose','cap','approvedAt','approvedBy','signatureVersion','spent','closedAt','signatures'], 'budget v2 shape');
    need(budget.signatureVersion === 2 && finite(budget.cap) && budget.cap > 0 && budget.cap <= 160 && budget.approvedAt >= enabled.enabledAt - EPS && budget.approvedAt <= clock(state) + EPS
      && Array.isArray(budget.signatures) && budget.signatures.length === 2 && Array.isArray(budget.approvedBy) && budget.approvedBy.length === 2
      && new Set(budget.approvedBy).size === 2 && budget.signatures.every((s,i) => s.actorId === budget.approvedBy[i]) && new Set(budget.signatures.map(s => s.siteId)).size === 1, 'two real same-hall local-term signatures');
    for (const signature of budget.signatures) validateBudgetSignatureV2(state, world, signature, runtime, budget.approvedAt);
    need(world.buildings.find(b => b.id === budget.siteId)?.districtId === world.buildings.find(b => b.id === budget.signatures[0].siteId)?.districtId, 'same district service authority');
  }
  need(budgets.every(b => b.signatureVersion === undefined || b.signatureVersion === 2 && isSupplementalPurpose(b.purpose)), 'v2 has only the declared service consumer');
}
