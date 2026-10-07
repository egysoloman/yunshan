import { publicEmploymentRevision, publicEmploymentRole, publicEmploymentSite, type PublicLabor } from './public-employment';
import type { CivicEnablement, CivicOriginalOfficial } from './civic-staffing';
import type { Citizen, SimState, WorldDefinition } from '../types';
import { validateReferenceCollisionPolicy, type ReferenceCollisionPolicy } from './reference-collision';
import { validateFreightPickupPolicy, type FreightPickupPolicy } from './freight-access';
import { validateMealRoutePolicy, type MealRoutePolicy } from './meal-route';
import { validateFarmYieldPolicy, type FarmYieldPolicy } from './farm-yield';
import { hasServiceMaterialRequestEstimate, validateServiceMaterialSchedulingEnvelope } from './service-material-scheduling';

export const PRODUCT_RULESET = 'civic-local-v1' as const;
export type EffectiveRuleset = 'legacy' | typeof PRODUCT_RULESET;
export const CIVIC_HISTORY_POLICY = 'civic-history-pages-v1' as const;
export interface SimulationOptions { rulesetId: typeof PRODUCT_RULESET; historyPolicyId?: typeof CIVIC_HISTORY_POLICY; referenceCollisionPolicyId?: ReferenceCollisionPolicy; mealRoutePolicyId?: MealRoutePolicy; freightPickupPolicyId?: FreightPickupPolicy; farmYieldPolicyId?: FarmYieldPolicy }
type Document = Record<string, any>;
export type CivicInitialProfession = Pick<Citizen, 'id' | 'role' | 'workId' | 'districtId' | 'education'>;
const object = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Document, key: string) => Object.hasOwn(value, key);
const need = (condition: unknown, message: string) => { if (!condition) throw new Error(`无效存档字段：city ruleset ${message}。`); };
const exact = (value: unknown, keys: string[], label: string) => need(object(value) && Object.keys(value).sort().join(',') === keys.sort().join(','), label);
const official = (role: string): role is CivicOriginalOfficial['baseRole'] => role === '官员' || role === 'official';

/** This is structural format validation, not authorization to upgrade an old city. */
export function validateCityRulesetEnvelope(data: Document): 1 | 2 {
  need(object(data) && object(data.state) && object(data.runtime) && [1, 2, 3, 4].includes(data.version), 'envelope');
  validateReferenceCollisionPolicy(data);
  validateMealRoutePolicy(data);
  validateFreightPickupPolicy(data);
  validateFarmYieldPolicy(data);
  validateServiceMaterialSchedulingEnvelope(data);
  const state = data.state, runtime = data.runtime;
  const listed = Array.isArray(runtime.persistedModules) && runtime.persistedModules.includes('civicStaffing');
  const budgetListed = Array.isArray(runtime.persistedModules) && runtime.persistedModules.includes('budgetAuthority');
  const historyListed = Array.isArray(runtime.persistedModules) && runtime.persistedModules.includes('civicHistory');
  const noHistory = !own(data, 'historyPolicyId') && !own(state, 'civicHistory') && !own(runtime, 'civicHistoryVersion') && !historyListed;
  if (data.version !== 3 && data.version !== 4) {
    need(!own(data, 'rulesetId') && !own(data, 'motionVersion') && !own(state, 'civicStaffing') && !own(runtime, 'civicStaffingVersion') && !listed
      && !own(state, 'budgetAuthority') && !own(runtime, 'budgetAuthorityVersion') && !budgetListed && noHistory, 'legacy cannot declare product rules');
    return data.version;
  }
  need(data.rulesetId === PRODUCT_RULESET && (data.motionVersion === 1 || data.motionVersion === 2), 'product and motion versions');
  need(object(state.civicStaffing) && state.civicStaffing.version === (data.version === 4 ? 2 : 1) && runtime.civicStaffingVersion === (data.version === 4 ? 2 : 1) && listed
    && runtime.persistedModules.filter((name: unknown) => name === 'civicStaffing').length === 1, 'body marker manifest pair');
  need(object(state.budgetAuthority) && state.budgetAuthority.version === 1 && runtime.budgetAuthorityVersion === 1 && budgetListed
    && runtime.persistedModules.filter((name: unknown) => name === 'budgetAuthority').length === 1, 'budget body marker manifest pair');
  if (data.version === 3) need(noHistory && !own(state.civicStaffing, 'historyId'), 'v3 cannot silently activate history');
  else need(data.historyPolicyId === CIVIC_HISTORY_POLICY && object(state.civicHistory) && state.civicHistory.version === 1
    && state.civicHistory.policyId === CIVIC_HISTORY_POLICY && runtime.civicHistoryVersion === 1 && historyListed
    && runtime.persistedModules.filter((name: unknown) => name === 'civicHistory').length === 1
    && state.civicStaffing.historyId === state.civicHistory.id && state.civicHistory.enablementId === state.civicStaffing.enablement?.id
    && state.civicHistory.origin?.motionVersion === data.motionVersion, 'history body marker manifest policy pair');
  if (data.motionVersion === 2) need(runtime.npcMotionVersion === 2 && object(runtime.npcStairCursors) && Object.keys(runtime.npcStairCursors).length <= 1024, 'native motion body and version');
  else need(!own(runtime, 'npcMotionVersion') && !own(runtime, 'npcStairCursors'), 'legacy motion body and version');
  const enablement = state.civicStaffing.enablement;
  need(object(enablement) && (enablement.origin === 'new-city' || enablement.origin === 'host-upgrade'), 'enablement origin');
  exact(enablement, ['id', 'ruleVersion', 'origin', 'enabledAt', 'enabledTick', ...(enablement.origin === 'host-upgrade' ? ['sourceSave'] : [])], 'enablement shape');
  need(typeof enablement.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(enablement.id) && enablement.ruleVersion === 1, 'enablement identity');
  need(Number.isFinite(enablement.enabledAt) && enablement.enabledAt >= 0 && enablement.enabledAt <= 1e12
    && Number.isSafeInteger(enablement.enabledTick) && enablement.enabledTick >= 0 && enablement.enabledTick <= state.tick, 'cutover tick and clock');
  if (enablement.origin === 'new-city') {
    need(enablement.id === `civic-new-${data.worldSeed}-${data.worldFingerprint}` && enablement.enabledAt === 480 && enablement.enabledTick === 0, 'new city origin');
  } else {
    const source = enablement.sourceSave;
    exact(source, ['sha256', 'version', 'motionVersion'], 'source save shape');
    need(typeof source.sha256 === 'string' && /^[0-9a-f]{64}$/.test(source.sha256) && (source.version === 1 || source.version === 2)
      && source.motionVersion === source.version && source.motionVersion === data.motionVersion
      && enablement.id === `civic-host-${source.sha256}`, 'source save and unchanged motion');
  }
  need(state.budgetAuthority.enablementId === enablement.id
    && state.budgetAuthority.legacySourceSha256 === (enablement.sourceSave?.sha256 ?? null), 'budget cutover binding');
  return data.motionVersion;
}

/** Generic partition tooling keeps its historical partial-document contract. */
export function hasCityRulesetDeclaration(data: Document): boolean {
  return data.version === 3 || data.version === 4 || own(data, 'rulesetId') || own(data, 'motionVersion') || own(data, 'historyPolicyId') || own(data, 'referenceCollisionPolicyId') || own(data, 'mealRoutePolicyId') || own(data, 'freightPickupPolicyId') || own(data, 'farmYieldPolicyId') || hasServiceMaterialRequestEstimate(data.state)
    || object(data.state) && (own(data.state, 'civicStaffing') || own(data.state, 'budgetAuthority') || own(data.state, 'civicHistory') || own(data.state, 'serviceMaterialScheduling'))
    || object(data.runtime) && (own(data.runtime, 'civicStaffingVersion') || own(data.runtime, 'budgetAuthorityVersion') || own(data.runtime, 'civicHistoryVersion') || own(data.runtime, 'referenceCollisionPolicyId') || own(data.runtime, 'mealRoutePolicyId') || own(data.runtime, 'freightPickupPolicyId') || own(data.runtime, 'farmYieldPolicyId')
      || own(data.runtime, 'serviceMaterialSchedulingVersion') || Array.isArray(data.runtime.persistedModules) && data.runtime.persistedModules.some((name: unknown) => name === 'civicStaffing' || name === 'budgetAuthority' || name === 'civicHistory' || name === 'serviceMaterialScheduling'));
}

export function effectiveCityRuleset(state: SimState, runtime: { civicStaffingVersion?: 1 | 2; civicHistoryVersion?: 1 }): EffectiveRuleset {
  const civic = state.civicStaffing;
  const matchingBody = runtime.civicStaffingVersion === 1 && civic?.version === 1 || runtime.civicStaffingVersion === 2 && civic?.version === 2
    && runtime.civicHistoryVersion === 1 && state.civicHistory?.version === 1 && civic.historyId === state.civicHistory.id;
  return matchingBody && civic?.enablement.ruleVersion === 1 ? PRODUCT_RULESET : 'legacy';
}
export function readonlyCityEnablement(state: SimState, runtime: { civicStaffingVersion?: 1 | 2; civicHistoryVersion?: 1 }): Readonly<CivicEnablement> | null {
  if (effectiveCityRuleset(state, runtime) === 'legacy') return null;
  const source = state.civicStaffing!.enablement;
  return Object.freeze({ ...source, ...(source.sourceSave ? { sourceSave: Object.freeze({ ...source.sourceSave }) } : {}) });
}

/** Only the newly generated city may certify its trusted initial professions. */
export function initialCivicOfficials(initial: readonly CivicInitialProfession[], world: WorldDefinition): CivicOriginalOfficial[] {
  const sites = new Map(world.buildings.map(site => [site.id, site]));
  return initial.flatMap(actor => {
    const site = sites.get(actor.workId);
    return official(actor.role) && site?.kind === 'hall' && site.districtId === actor.districtId ? [{ actorId: actor.id, baseRole: actor.role, workId: actor.workId,
      districtId: actor.districtId, educationAtEnablement: actor.education ?? 0, source: { kind: 'initial-profession' as const } }] : [];
  });
}

/** No initial profession registry in an old save means no invented qualification. */
export function employmentCivicOfficials(state: SimState, labor: PublicLabor | undefined, world: WorldDefinition): CivicOriginalOfficial[] {
  if (labor?.version !== 2 || labor.employment?.version !== 2) return [];
  const sites = new Map(world.buildings.map(site => [site.id, site])), revision = publicEmploymentRevision(labor);
  return state.citizens.flatMap(actor => {
    const role = labor.employment!.baseRoles[actor.id], site = sites.get(actor.workId);
    return official(role) && actor.role === role && site?.kind === 'hall' && site.districtId === actor.districtId
      && state.extension?.actorProfiles[actor.id]?.alive !== false && labor.jobs[actor.id] === site.id
      && publicEmploymentRole(labor, actor.id, revision) === role && publicEmploymentSite(labor, actor.id, revision) === site.id
      ? [{ actorId: actor.id, baseRole: role, workId: site.id, districtId: actor.districtId, educationAtEnablement: actor.education ?? 0,
        source: { kind: 'public-employment' as const, revision } }] : [];
  });
}

/** Validate historical cutover sources against the candidate runtime, never live state. */
export function validateCivicOriginalOfficials(state: SimState, labor: PublicLabor | undefined, world: WorldDefinition, initial: readonly CivicInitialProfession[]): void {
  const body = state.civicStaffing!;
  const baseline = new Map(initialCivicOfficials(initial, world).map(row => [row.actorId, row]));
  if (body.enablement.origin === 'new-city') {
    need(Array.isArray(body.originalOfficials) && body.originalOfficials.length === baseline.size
      && new Set(body.originalOfficials.map(row => row.actorId)).size === baseline.size
      && body.originalOfficials.every(row => row.source.kind === 'initial-profession' && baseline.has(row.actorId)), 'complete immutable new-city profession roster');
  }
  for (const row of body.originalOfficials) {
    if (row.source.kind === 'initial-profession') {
      const original = baseline.get(row.actorId);
      need(body.enablement.origin === 'new-city' && original && original.baseRole === row.baseRole && original.workId === row.workId
        && original.districtId === row.districtId && original.educationAtEnablement === row.educationAtEnablement, 'trusted initial profession');
    } else {
      const revision = row.source.revision;
      need(labor?.version === 2 && labor.employment?.version === 2 && Number.isSafeInteger(revision) && revision >= 0 && revision <= publicEmploymentRevision(labor)
        && labor.employment.baseRoles[row.actorId] === row.baseRole
        && publicEmploymentRole(labor, row.actorId, revision) === row.baseRole && publicEmploymentSite(labor, row.actorId, revision) === row.workId
        && labor.employment.transfers.slice(0, revision).every(transfer => transfer.tick <= body.enablement.enabledTick), 'candidate employment qualification');
    }
  }
}
